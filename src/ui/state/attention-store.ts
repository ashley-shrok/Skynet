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

import { useSyncExternalStore } from "react";
import { authApi } from "@/main-axios";

type Key = string;

const finishes = new Map<Key, number>();
const seen = new Map<Key, number>();
let baselineAt: number | null = null;
let version = 0;
const listeners = new Set<() => void>();
let loadInFlight: Promise<void> | null = null;

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

export function applyReadState(state: {
  baselineAt: number;
  seen: Array<{ hostId: string; identityName: string; seenFinishAt: number }>;
}): void {
  let changed = false;
  if (typeof state.baselineAt === "number" && baselineAt !== state.baselineAt) {
    baselineAt = state.baselineAt;
    changed = true;
  }
  for (const e of state.seen ?? []) {
    if (advanceSeen(attentionKey(e.hostId, e.identityName), e.seenFinishAt)) changed = true;
  }
  if (changed) notify();
}

/**
 * Fetch this user's read state. Called on boot and on every fleet-status
 * (re)connect so marks cleared elsewhere while this tab was offline catch up.
 * Concurrent calls share one request.
 */
export function loadReadState(): Promise<void> {
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    try {
      const res = await authApi.get("/attention/read-state");
      const data = res.data as {
        baselineAt: number;
        seen: Array<{ hostId: string; identityName: string; seenFinishAt: number }>;
      };
      applyReadState(data);
      console.info({
        operation: "attention_read_state_loaded",
        baselineAt: data.baselineAt,
        seenCount: data.seen?.length ?? 0,
      });
    } catch (err) {
      console.warn({
        operation: "attention_read_state_load_failed",
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loadInFlight = null;
    }
  })();
  return loadInFlight;
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

/**
 * The user is looking at this conversation: mark its latest finished turn
 * seen, locally at once and on the server (which tells the user's other
 * tabs). No-op when there's nothing new.
 */
export function markSeen(hostId: string | number, identityName: string): void {
  const k = attentionKey(hostId, identityName);
  const finish = finishes.get(k);
  if (finish === undefined) return;
  if (!advanceSeen(k, finish)) return;
  notify();
  const body = { hostId: String(hostId), identityName, seenFinishAt: finish };
  console.info({ operation: "attention_mark_seen", ...body });
  try {
    authApi.post("/attention/seen", body).catch((err: unknown) => {
      console.warn({
        operation: "attention_mark_seen_failed",
        ...body,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    console.warn({
      operation: "attention_mark_seen_failed_sync",
      ...body,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function __resetAttentionForTest(): void {
  finishes.clear();
  seen.clear();
  baselineAt = null;
  loadInFlight = null;
  // Listeners stay: module-level subscribers (the conversation store) must
  // keep hearing changes across tests.
  notify();
}
