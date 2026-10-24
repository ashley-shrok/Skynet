// Attention store — what the sidebar needs to mark conversations unread.
//
// Two inputs, both keyed `${hostId}:${identityName}` (the same key shape the
// session-working-store uses, so rows resolve with one helper):
//
//   - lastFinishAt: when the agent last finished a turn. Arrives on every
//     fleet-status session frame (live and dormant). Max-wins — a frame that
//     lacks it, or carries an older value, never regresses it.
//   - seen: the newest finished turn THIS USER has seen, per conversation.
//     Loaded from the server (GET /attention/read-state), advanced locally
//     when the user looks at a conversation (POST /attention/seen), and
//     advanced by read-state-changed frames when they look on another tab or
//     device. Max-wins too.
//
// A conversation is unread when its lastFinishAt is newer than both its seen
// mark and the user's baseline (when read tracking started for them, so
// launch day starts with nothing marked). Until the read state has loaded
// nothing is unread — a reload never flashes marks that then vanish.
//
// The seen mark is always a lastFinishAt value echoed back, never a clock
// reading, so clock differences between machines can't create or hide marks.
//
// DM marks work the same way. When an agent DMs this user the server records
// the DM's time (lastDmAt) and pushes it here (dm-state-changed frames, plus
// the dms list in the read state). Looking at the conversation echoes that
// time back as the seen DM (POST /attention/dm-seen). A conversation is DM'd
// while its lastDmAt is newer than its seen DM. No baseline: the server only
// records DMs sent after it started watching, so launch day has none.

import { useSyncExternalStore } from "react";
import { authApi } from "@/main-axios";

type Key = string;

const finishes = new Map<Key, number>();
const seen = new Map<Key, number>();
const dms = new Map<Key, number>();
const dmSeen = new Map<Key, number>();
let baselineAt: number | null = null;
let version = 0;
const listeners = new Set<() => void>();
let loadInFlight: Promise<void> | null = null;
let reloadQueued = false;
// Seen marks whose save failed (flaky connection). Re-sent after the next
// successful read-state load so the user's other devices catch up; the
// server ignores anything that isn't newer, so re-sending is safe.
const unsynced = new Map<Key, { hostId: string; identityName: string }>();
const unsyncedDm = new Map<Key, { hostId: string; identityName: string }>();

export function attentionKey(hostId: string | number, identityName: string): Key {
  return `${hostId}:${identityName}`;
}

function notify(): void {
  version++;
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      console.warn({
        operation: "attention_store_listener_failed",
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function subscribeAttention(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAttentionVersion(): number {
  return version;
}

/** Re-render on any attention change. Returns a version number. */
export function useAttentionVersion(): number {
  return useSyncExternalStore(subscribeAttention, getAttentionVersion, getAttentionVersion);
}

/** Fold a session frame's lastFinishAt in (max-wins). */
export function publishLastFinishAt(
  hostId: string | number,
  identityName: string | null | undefined,
  lastFinishAt: number | null | undefined,
): void {
  if (!identityName || typeof lastFinishAt !== "number" || !Number.isFinite(lastFinishAt)) return;
  const k = attentionKey(hostId, identityName);
  const prev = finishes.get(k);
  if (prev !== undefined && prev >= lastFinishAt) return;
  finishes.set(k, lastFinishAt);
  notify();
}

/** Fold a seen mark in (max-wins). Returns true iff it advanced. */
function advanceSeen(k: Key, seenFinishAt: number): boolean {
  const prev = seen.get(k);
  if (prev !== undefined && prev >= seenFinishAt) return false;
  seen.set(k, seenFinishAt);
  return true;
}

/** A read-state-changed frame from another tab/device of this user. */
export function applyRemoteSeen(hostId: string, identityName: string, seenFinishAt: number): void {
  if (!identityName || typeof seenFinishAt !== "number") return;
  if (advanceSeen(attentionKey(hostId, identityName), seenFinishAt)) {
    console.info({
      operation: "attention_remote_seen_applied",
      hostId,
      identityName,
      seenFinishAt,
    });
    notify();
  }
}

/** Fold a DM time into a map (max-wins). Returns true iff it advanced. */
function advanceMax(map: Map<Key, number>, k: Key, at: number): boolean {
  if (typeof at !== "number" || !Number.isFinite(at)) return false;
  const prev = map.get(k);
  if (prev !== undefined && prev >= at) return false;
  map.set(k, at);
  return true;
}

function applyDmEntry(e: DmEntry): boolean {
  if (!e || typeof e.hostId !== "string" || !e.identityName) return false;
  const k = attentionKey(e.hostId, e.identityName);
  const a = advanceMax(dms, k, e.lastDmAt);
  const b = e.seenDmAt > 0 && advanceMax(dmSeen, k, e.seenDmAt);
  return a || b;
}

/**
 * A dm-state-changed frame: an agent DM'd this user, or they saw a DM on
 * another tab/device (the echo of this tab's own is a max-wins no-op).
 */
export function applyRemoteDm(entry: DmEntry): void {
  if (applyDmEntry(entry)) {
    console.info({
      operation: "attention_remote_dm_applied",
      hostId: entry.hostId,
      identityName: entry.identityName,
      lastDmAt: entry.lastDmAt,
      seenDmAt: entry.seenDmAt,
    });
    notify();
  }
}

type DmEntry = { hostId: string; identityName: string; lastDmAt: number; seenDmAt: number };

export function applyReadState(state: {
  baselineAt: number;
  seen: Array<{ hostId: string; identityName: string; seenFinishAt: number }>;
  dms?: DmEntry[];
}): void {
  let changed = false;
  if (typeof state.baselineAt === "number" && baselineAt !== state.baselineAt) {
    baselineAt = state.baselineAt;
    changed = true;
  }
  for (const e of state.seen ?? []) {
    if (advanceSeen(attentionKey(e.hostId, e.identityName), e.seenFinishAt)) changed = true;
  }
  for (const e of state.dms ?? []) {
    if (applyDmEntry(e)) changed = true;
  }
  if (changed) notify();
}

/**
 * Fetch this user's read state. Called on boot and on every fleet-status
 * (re)connect so marks cleared elsewhere while this tab was offline catch up.
 * A call that lands while a fetch is in flight queues one fresh fetch after
 * it (the in-flight answer may predate what the caller needs).
 */
export function loadReadState(): Promise<void> {
  if (loadInFlight) {
    reloadQueued = true;
    return loadInFlight;
  }
  loadInFlight = (async () => {
    try {
      const res = await authApi.get("/attention/read-state");
      const data = res.data as {
        baselineAt: number;
        seen: Array<{ hostId: string; identityName: string; seenFinishAt: number }>;
        dms?: DmEntry[];
      };
      applyReadState(data);
      console.info({
        operation: "attention_read_state_loaded",
        baselineAt: data.baselineAt,
        seenCount: data.seen?.length ?? 0,
        dmCount: data.dms?.length ?? 0,
        resending: unsynced.size + unsyncedDm.size,
      });
      for (const [k, t] of [...unsynced]) {
        const at = seen.get(k);
        if (at !== undefined) postSeen(k, t.hostId, t.identityName, at);
      }
      for (const [k, t] of [...unsyncedDm]) {
        const at = dmSeen.get(k);
        if (at !== undefined) postDmSeen(k, t.hostId, t.identityName, at);
      }
    } catch (err) {
      console.warn({
        operation: "attention_read_state_load_failed",
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loadInFlight = null;
      if (reloadQueued) {
        reloadQueued = false;
        void loadReadState();
      }
    }
  })();
  return loadInFlight;
}

function postSeen(k: Key, hostId: string, identityName: string, seenFinishAt: number): void {
  const body = { hostId, identityName, seenFinishAt };
  const failed = (err: unknown, operation: string) => {
    unsynced.set(k, { hostId, identityName });
    console.warn({
      operation,
      ...body,
      err: err instanceof Error ? err.message : String(err),
    });
  };
  try {
    authApi
      .post("/attention/seen", body)
      .then(() => {
        if (seen.get(k) === seenFinishAt) unsynced.delete(k);
      })
      .catch((err: unknown) => failed(err, "attention_mark_seen_failed"));
  } catch (err) {
    failed(err, "attention_mark_seen_failed_sync");
  }
}

function postDmSeen(k: Key, hostId: string, identityName: string, seenDmAt: number): void {
  const body = { hostId, identityName, seenDmAt };
  const failed = (err: unknown, operation: string) => {
    unsyncedDm.set(k, { hostId, identityName });
    console.warn({
      operation,
      ...body,
      err: err instanceof Error ? err.message : String(err),
    });
  };
  try {
    authApi
      .post("/attention/dm-seen", body)
      .then(() => {
        if (dmSeen.get(k) === seenDmAt) unsyncedDm.delete(k);
      })
      .catch((err: unknown) => failed(err, "attention_mark_dm_seen_failed"));
  } catch (err) {
    failed(err, "attention_mark_dm_seen_failed_sync");
  }
}

export function getLastFinishAt(k: Key | null): number | null {
  if (k === null) return null;
  return finishes.get(k) ?? null;
}

export function isUnread(k: Key | null): boolean {
  if (k === null || baselineAt === null) return false;
  const finish = finishes.get(k);
  if (finish === undefined) return false;
  const s = seen.get(k);
  const threshold = s !== undefined ? Math.max(s, baselineAt) : baselineAt;
  return finish > threshold;
}

/** The time of this conversation's latest DM, seen or not; null if none. */
export function getLastDmAt(k: Key | null): number | null {
  if (k === null) return null;
  return dms.get(k) ?? null;
}

/** The time of this conversation's unseen DM, or null when it isn't DM'd. */
export function getUnseenDmAt(k: Key | null): number | null {
  if (k === null) return null;
  const dm = dms.get(k);
  if (dm === undefined) return null;
  const s = dmSeen.get(k);
  return s !== undefined && s >= dm ? null : dm;
}

export function isDmd(k: Key | null): boolean {
  return getUnseenDmAt(k) !== null;
}

// A DM cleared because the user just arrived at the conversation (it came on
// screen, or its read state loaded right after it did): the conversation view
// jumps to the oldest message it hasn't seen. `since` is the seen mark before
// this clear. Not raised for DMs that land while the user is already watching.
const dmArrivalListeners = new Map<Key, Set<(since: number) => void>>();
// An arrival raised before the conversation's view was there to hear it (its
// code still loading): handed to the view when it subscribes, if still fresh.
const pendingDmArrival = new Map<Key, { since: number; at: number }>();
const PENDING_DM_ARRIVAL_MS = 15_000;

export function subscribeDmArrival(k: Key, cb: (since: number) => void): () => void {
  let set = dmArrivalListeners.get(k);
  if (!set) {
    set = new Set();
    dmArrivalListeners.set(k, set);
  }
  set.add(cb);
  const pending = pendingDmArrival.get(k);
  if (pending) {
    pendingDmArrival.delete(k);
    if (Date.now() - pending.at < PENDING_DM_ARRIVAL_MS) cb(pending.since);
  }
  return () => {
    set!.delete(cb);
    if (set!.size === 0) dmArrivalListeners.delete(k);
  };
}

/**
 * The user is looking at this conversation: mark its latest finished turn
 * and its latest DM seen, locally at once and on the server (which tells the
 * user's other tabs). No-op when there's nothing new. `arrived`: the user
 * has just come to it (see subscribeDmArrival).
 */
export function markSeen(hostId: string | number, identityName: string, arrived = false): void {
  const k = attentionKey(hostId, identityName);
  let changed = false;
  // DMs need no baseline: a DM in the map is always one to clear.
  const dm = getUnseenDmAt(k);
  const seenBefore = dmSeen.get(k) ?? 0;
  if (dm !== null && advanceMax(dmSeen, k, dm)) {
    changed = true;
    if (arrived) {
      const listeners = dmArrivalListeners.get(k);
      if (!listeners || listeners.size === 0) pendingDmArrival.set(k, { since: seenBefore, at: Date.now() });
      for (const cb of listeners ?? []) {
        try {
          cb(seenBefore);
        } catch (err) {
          console.warn({ operation: "attention_dm_arrival_listener_threw", error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    console.info({ operation: "attention_mark_dm_seen", hostId: String(hostId), identityName, seenDmAt: dm });
    postDmSeen(k, String(hostId), identityName, dm);
  }
  // Until the read state has loaded nothing shows as unread, and the load
  // itself notifies — the seen tracker re-runs then.
  const finish = finishes.get(k);
  if (baselineAt !== null && finish !== undefined && advanceSeen(k, finish)) {
    changed = true;
    console.info({ operation: "attention_mark_seen", hostId: String(hostId), identityName, seenFinishAt: finish });
    postSeen(k, String(hostId), identityName, finish);
  }
  if (changed) notify();
}

export function __resetAttentionForTest(): void {
  finishes.clear();
  pendingDmArrival.clear();
  seen.clear();
  dms.clear();
  dmSeen.clear();
  unsyncedDm.clear();
  baselineAt = null;
  loadInFlight = null;
  reloadQueued = false;
  unsynced.clear();
  // Listeners stay: module-level subscribers (the conversation store) must
  // keep hearing changes across tests.
  notify();
}
