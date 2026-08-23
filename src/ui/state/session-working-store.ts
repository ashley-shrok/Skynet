// ─── Session working-state store (Phase 34 Plan 06 — fleet-status cutover) ───
// Module-scoped in-memory store for per-(host, tmuxSession) "is the session
// working?" composite state. Sourced exclusively from the fleet-status
// WebSocket channel (the backend-authoritative signal). Two old feeders
// (PTY-idle from Terminal.tsx + backgrounded-work from PrettyView.tsx)
// were REMOVED in Plan 06 — see 34-06-SUMMARY.md for the retired symbols.
//
// Composite formula:
//   main      = status === "busy" || status === "shell"
//   waiting   = status === "waiting"   // separate axis — NOT working, bubble-only
//   bg        = backgroundTasks.length > 0
//   isWorking = main || bg
//
// The ambient filter runs at the WATCHER (Plan 04), not here. By the time
// SessionState arrives at the browser, backgroundTasks[] is already
// ambient-filtered — every entry is non-ambient work.
//
// History note on `shell`:
//   Patch #442 (2026-08-14, bounty phase-39-uat-regression-wip-always-on-
//   idle-dot-missing) EXCLUDED `shell` from `main` after diagnosing that
//   ambient Monitors were pinning status=shell → WIP-always-on. Fleet-
//   status watcher-side ambient filtering had already stripped the same
//   Monitors from `background_tasks[]`, so the fix targeted the foreground
//   `status` axis in the store.
//
// inline-260823-wip-shell-is-work (Ashley 2026-08-23): RESTORED to include
//   `shell` in `main`. Empirical: three idle sessions on tina's box (all
//   with 4 ambient Monitors each) are `status: idle`, not `shell` — the
//   original "shell always" symptom is no longer reproducible on the same
//   harness version. Meanwhile every real work turn oscillates busy →
//   shell → busy → shell (assistant tokens + tool executions), and the
//   post-#442 predicate flipped isWorking=false for the entire duration
//   of every tool execution — producing the "flickers on and off" +
//   "many sessions working but no indicator" symptoms Ashley reported
//   2026-08-23. Evidence: patricia + molly + wendy + carly + stephanie
//   + vicky logs 10:03-10:06Z all showed busy↔shell oscillation flipping
//   isWorking every 10-30s during continuous work.
//
// Ambient Monitors remain filtered on the bg axis via the watcher-side
// [ambient]- prefix strip, so they still cannot flip isWorking. `idle`
// and `waiting` remain excluded from main — idle correctly means
// "waiting for the user"; waiting drives WaitingBubble on its own axis.
//
// Internal state shape: Map<string, { isWorking: boolean }>
// Key format: `${hostId}:${tmuxSession ?? ""}` — unchanged convention.
//
// Per-key no-op notify guard: if the new isWorking === existing isWorking AND
// the key already exists, skip notify. First-time publish always notifies.
//
// publishFleetStatusSessionGone: deletes the key from the map and notifies.
// Unlike publishFleetStatusSessionState, gone always notifies (deletion is
// always a change).
//
// Storage layer: NONE. In-memory Map only. A page refresh resets the store;
// the fleet-status WS snapshot on re-connect repopulates all keys.
//
// Phase 44 (Plan 03): the store now consolidates lastMessageAt writes from
// both feeds (fleet-status WS + /sessions/list seed) through a single
// max-wins chokepoint (advanceSessionLastMessageAt). The WS publish path
// calls the chokepoint after the isWorking swap; the seed path calls it
// directly. See 43-CONTEXT.md § Reconciliation helper.
//
// Phase 47 (Plan 03): the store now carries a THIRD axis, aiTitle, with
// LAST-WINS semantics (not max-wins). Publish path grows an Axis C block
// that routes through advanceSessionAiTitle (unconditional call after
// Axis B; the helper's own predicate handles null/no-op/write). Seed path
// via seedSessionAiTitle mirrors the seedSessionLastMessageAt API. On
// frames that co-change all three axes, publishFleetStatusSessionState
// fires exactly 3 notifies (one per axis) — the correct observable
// contract of the three-axis single-chokepoint architecture. See
// 47-CONTEXT.md § Working-store third axis.
//
// Phase 53 (Plan 02): the store now carries a FIFTH axis, recycling, with
// direct swap-and-notify semantics (like dormant Axis D). Publish path grows
// an Axis E block below Axis D; sourced from the backend-authoritative
// `.recycled-at` sentinel plumbed by Plan 53-01; consumed by BOTH the
// PrettyView holding overlay AND the PrettyConversationRow row spinner via
// useSessionIsRecycling — retires the client-side recycling bridge store
// (Plan 53-03, deleted) which required a mounted pane to publish; see
// 53-CONTEXT.md § Shape (one source for both surfaces).
//
// Store pattern mirrors src/ui/state/conversation-store.ts: module-scoped
// `state` object + Map + Set<() => void> listener registry + snapshotVersion
// counter; notify() bumps + iterates; subscribe() returns disposer.

import { useSyncExternalStore } from "react";
import type { SessionState } from "../api/fleet-status-types.js";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type WorkingRecord = {
  isWorking: boolean;
  // Phase 41 Plan 03 — the "message either direction" recency signal mirrored
  // from the fleet-status wire frame (SessionState.lastMessageAt). `null` when
  // the wire frame carried `null` (session with no message-bearing history) OR
  // when the wire frame omitted the field entirely (pre-Phase-41-03 watcher).
  // The conversation-store row-derivation reads this via getSessionLastMessageAt
  // and stamps row.lastMessageAt so compareByRecencyDesc can drive the flat
  // middle-zone sort. See §Sort model — middle section in 41-CONTEXT.md.
  lastMessageAt: number | null;
  // Phase 47 — the current-work hint sourced from the harness-emitted
  // ai-title JSONL line. `null` when the wire frame carried `null` (no
  // ai-title yet) OR when the wire frame omitted the field entirely
  // (pre-Phase-47 backend). Reconciliation is LAST-WINS (not max-wins like
  // lastMessageAt) because ai-title EVOLVES: as the session's topic drifts
  // across turns, the freshest value from either source (WS or
  // /sessions/list seed) is the correct one. See 47-CONTEXT.md § Working-
  // store third axis.
  aiTitle: string | null;
  // Phase 52 Plan 01 — the inline supervisor-dormancy signal. Source: the
  // ~/.claude/identities/<tmuxSession>/.dormant sentinel file on the target
  // host. `true` when the sentinel is present (identity parked by supervisor),
  // `false` otherwise. Default `false` on cold-start and on frames from
  // pre-Phase-52 backends that omit the field entirely. Strict boolean at
  // the store boundary — three-valued wire input (true/false/null/undefined)
  // collapses to boolean here so the Ready predicate (!isWorking && !dormant)
  // in Plan 03 reads a simple boolean. Reconciliation: direct swap-and-notify
  // (no max-wins, no last-wins — just a boolean gate on the sentinel).
  dormant: boolean;
  // Phase 53 Plan 02 — the backend-authoritative recycling signal mirrored
  // from the fleet-status wire frame (SessionState.recycling).
  // `true` when the wire frame carried `recycling: true` (the caretaker's
  // `.recycled-at` sentinel present, identity being replaced via /id-reset).
  // `false` when the wire frame carried `false`, `null`, or omitted the field
  // entirely (safe default — no false positives). Wire's three-valued input
  // (true / false / null / undefined) collapses to strict boolean at the store
  // boundary in the Axis E block below via `state_arg.recycling === true`.
  // Hook consumers read a simple boolean. Reconciliation is direct
  // swap-and-notify (no max-wins, no last-wins) — recycling is a strict
  // boolean gate on the sentinel file's presence. Preserved across Axis A
  // (isWorking) republishes via `recycling: existing?.recycling ?? false` in
  // the Axis A nextMap write (defensive against the Pitfall-3 pattern
  // documented in Phase 53 RESEARCH.md). Consumed by useSessionIsRecycling(key),
  // which Plan 53-03 wires into both the PrettyView holding overlay mount gate
  // AND the PrettyConversationRow row-spinner input.
  recycling: boolean;
};

type State = {
  map: Map<string, WorkingRecord>;
};

let state: State = {
  map: new Map<string, WorkingRecord>(),
};

let snapshotVersion = 0;

const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Phase 41 Plan 03 — public subscribe API for cross-store bridges.
 *
 * Exposes the internal listener registry so other stores (specifically
 * conversation-store, whose middle-zone snapshot must re-derive when a
 * session's cached lastMessageAt advances) can register a callback that
 * fires on ANY working-store mutation. Returns a disposer.
 *
 * The alternative — having conversation-store poll working-store on every
 * getSnapshot() — would still work because the snapshot's row derivation
 * reads getSessionLastMessageAt() at derivation time, but the snapshot
 * memoization would then hold a stale snapshot until some other event
 * bumped conversation-store's own version counter. The subscribe bridge
 * closes that gap: a working-store publish triggers a conversation-store
 * notify(), invalidates its cached snapshot, and the next getSnapshot()
 * picks up fresh lastMessageAt values.
 */
export function subscribeSessionWorkingStore(cb: () => void): () => void {
  return subscribe(cb);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Publish a new or updated SessionState from the fleet-status channel.
 * Computes isWorking from the D-CTX composite formula and updates the map.
 *
 * Per-key no-op notify guard: if isWorking is unchanged AND the key already
 * exists in the map, skip notify. This prevents spurious re-renders when the
 * backend sends repeated frames with identical effective states.
 *
 * Structured logging: logs every state transition at the hostId + tmuxSession
 * level so dot regressions can be traced through the browser console.
 * Per T-34-20 (Repudiation mitigation).
 */
export function publishFleetStatusSessionState(
  hostId: string,
  state_arg: SessionState,
): void {
  const key = `${hostId}:${state_arg.tmuxSession ?? ""}`;

  // inline-260823-wip-shell-is-work (Ashley 2026-08-23): `shell` is
  // real foreground tool-execution work. See header comment above.
  const main =
    state_arg.status === "busy" || state_arg.status === "shell";
  const bg = state_arg.backgroundTasks.length > 0;
  const isWorking = main || bg;

  const existing = state.map.get(key);

  // Phase 44 (Plan 03) — single-chokepoint architecture per 43-CONTEXT.md §
  // Reconciliation helper. isWorking axis handled inline; lastMessageAt axis
  // routes through advanceSessionLastMessageAt so BOTH the WS-publish path
  // and the /sessions/list-seed path funnel through the same reconciliation
  // predicate. Two notify events on frames that co-change both axes is the
  // correct observable contract.
  //
  // Phase 47 (Plan 03) — extended to a THIRD axis (aiTitle) via
  // advanceSessionAiTitle (Axis C below). Distinct LAST-WINS semantics
  // (freshest positive string wins; null does NOT overwrite). Co-change
  // frames now emit 3 notifies (one per axis) — extends Phase 44's
  // two-axes-two-notifies contract to three. See 47-CONTEXT.md § Working-
  // store third axis.

  // ── Axis A — isWorking swap-and-notify block ──
  // Fire only when isWorking actually changed OR the key is brand-new.
  // The lastMessageAt value written into the record here is the
  // CURRENTLY-CACHED value (preserved unchanged); Axis B below handles
  // any lastMessageAt update via advanceSessionLastMessageAt. Similarly
  // the aiTitle value is preserved as the currently-cached string;
  // Axis C below handles any aiTitle update via advanceSessionAiTitle.
  // The dormant value is ALSO preserved from cache here (Axis D below
  // handles the dormant update independently). This ensures Axis A
  // republishes do not wipe a dormant:true set by a prior frame.
  if (existing === undefined || existing.isWorking !== isWorking) {
    console.info({
      operation: "fleet_status_working_state_change",
      hostId,
      tmuxSession: state_arg.tmuxSession,
      sessionId: state_arg.sessionId,
      status: state_arg.status,
      backgroundTaskCount: state_arg.backgroundTasks.length,
      isWorking,
      lastMessageAt: existing?.lastMessageAt ?? null,
      aiTitle: existing?.aiTitle ?? null,
      dormant: existing?.dormant ?? false,
      recycling: existing?.recycling ?? false,
      previous: existing?.isWorking ?? null,
      previousLastMessageAt: existing?.lastMessageAt ?? null,
      previousAiTitle: existing?.aiTitle ?? null,
      previousDormant: existing?.dormant ?? false,
      previousRecycling: existing?.recycling ?? false,
    });

    const nextMap = new Map(state.map);
    nextMap.set(key, {
      isWorking,
      lastMessageAt: existing?.lastMessageAt ?? null,
      aiTitle: existing?.aiTitle ?? null,
      dormant: existing?.dormant ?? false,
      recycling: existing?.recycling ?? false,
    });
    state = { map: nextMap };
    notify();
  }

  // ── Axis B — lastMessageAt reconciliation via the chokepoint ──
  // Unconditional call; the helper's own predicate handles null/stale/fresher.
  // If Axis A just wrote, this sees the fresh isWorking with the OLD
  // lastMessageAt so the max-wins compare works correctly.
  advanceSessionLastMessageAt(key, state_arg.lastMessageAt ?? null);

  // ── Axis C — aiTitle reconciliation via the chokepoint ──
  // Unconditional call after Axis B; the helper's own predicate handles
  // null/no-op/write (LAST-WINS: null does NOT overwrite an existing
  // string; a fresh non-null string overwrites any previous value;
  // identical strings are a no-op-no-notify via Object.is guard).
  // Distinct from Axis B's max-wins because ai-title has no numeric
  // ordering — the freshest ARRIVAL is the correct value. Frames that
  // co-change all three axes emit 3 notifies (one per axis), the correct
  // observable contract of the three-axis single-chokepoint architecture
  // per 47-CONTEXT.md § Working-store third axis.
  advanceSessionAiTitle(key, state_arg.aiTitle ?? null);

  // ── Axis D — dormant swap-and-notify block (Phase 52 Plan 01) ──
  // Wire semantic (optional field): `dormant: true` sets true, `dormant: false`
  // sets false (explicit reset), `dormant` absent (undefined) preserves the
  // cached value — an Axis-A-only republish that carries no dormant signal
  // must NOT wipe a dormant:true set by a prior frame. This matches the
  // optional-field convention on the wire (dormant?: boolean).
  //
  // Direct swap-and-notify: no max-wins, no last-wins — when we DO have a
  // signal, dormant is a strict boolean gate on the sentinel file's presence.
  // Fire only when we have an explicit signal AND it differs from cache.
  // Brand-new-key case is handled above in Axis A; here we only fire on change.
  if (state_arg.dormant !== undefined) {
    const dormant = state_arg.dormant === true;
    const existingAfterAxes = state.map.get(key);
    if (
      existingAfterAxes !== undefined &&
      existingAfterAxes.dormant !== dormant
    ) {
      const nextMap = new Map(state.map);
      nextMap.set(key, {
        isWorking: existingAfterAxes.isWorking,
        lastMessageAt: existingAfterAxes.lastMessageAt,
        aiTitle: existingAfterAxes.aiTitle,
        dormant,
        recycling: existingAfterAxes.recycling,
      });
      state = { map: nextMap };
      notify();
    }
  }

  // ── Axis E — recycling swap-and-notify block (Phase 53 Plan 02) ──
  // Wire semantic (optional field): `recycling: true` sets true; `recycling:
  // false` sets false (explicit reset); `recycling` absent (undefined)
  // preserves the cached value — an Axis-A-only republish that carries no
  // recycling signal must NOT wipe a recycling:true set by a prior frame;
  // matches the optional-field convention on the wire (recycling?: boolean).
  //
  // Direct swap-and-notify: no max-wins, no last-wins — recycling is a strict
  // boolean gate on the `.recycled-at` sentinel file's presence. Fire only
  // when we have an explicit signal AND it differs from cache. Brand-new-key
  // case is handled above in Axis A which now also preserves recycling in its
  // nextMap write; here we only fire on change.
  if (state_arg.recycling !== undefined) {
    const recycling = state_arg.recycling === true;
    const existingAfterAxes = state.map.get(key);
    if (
      existingAfterAxes !== undefined &&
      existingAfterAxes.recycling !== recycling
    ) {
      const nextMap = new Map(state.map);
      nextMap.set(key, {
        isWorking: existingAfterAxes.isWorking,
        lastMessageAt: existingAfterAxes.lastMessageAt,
        aiTitle: existingAfterAxes.aiTitle,
        dormant: existingAfterAxes.dormant,
        recycling,
      });
      state = { map: nextMap };
      notify();
    }
  }
}

/**
 * Mark a session as gone (session ended or watcher lost track of it).
 * Deletes the key from the map and notifies subscribers so the dot
 * clears immediately. If the key does not exist, this is a no-op
 * (prevents double-delete churn from watcher restart cycles — mirrors
 * the server-side SubscriptionRegistry.publishSessionGone behavior).
 */
export function publishFleetStatusSessionGone(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): void {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  if (!state.map.has(key)) return; // no-op

  console.info({
    operation: "fleet_status_session_gone",
    hostId,
    tmuxSession,
    sessionId,
    key,
  });

  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}

/**
 * Phase 44 (Plan 03) — the ONLY writer of WorkingRecord.lastMessageAt.
 *
 * Max-wins contract (per 43-CONTEXT.md § Reconciliation helper):
 *   - If `ts === null`: no-op + no-notify (never regresses cache to null).
 *   - If no record exists for `key`: create `{ isWorking: false, lastMessageAt: ts }`, notify.
 *   - If record exists AND record.lastMessageAt is null: write ts, notify.
 *   - If record exists AND ts > record.lastMessageAt: write ts, notify.
 *   - If record exists AND ts <= record.lastMessageAt: no-op + no-notify.
 *
 * The `isWorking` axis is preserved verbatim on existing records — never
 * mutated by this helper. New-record writes default `isWorking: false`
 * (dormant sessions never touch the isWorking axis).
 *
 * Called from BOTH the WS publish path (via publishFleetStatusSessionState's
 * Axis B block) AND the /sessions/list seed path (via
 * seedSessionLastMessageAt). Single reconciliation chokepoint — any future
 * contract tweak (e.g., accepting `null` as "clear the value") is a
 * one-place change.
 */
function advanceSessionLastMessageAt(key: string, ts: number | null): void {
  if (ts === null) return;

  const existing = state.map.get(key);
  if (
    existing !== undefined &&
    existing.lastMessageAt !== null &&
    ts <= existing.lastMessageAt
  ) {
    // Cache already at or beyond ts — max-wins no-op + no-notify.
    return;
  }

  const nextRecord: WorkingRecord = {
    isWorking: existing?.isWorking ?? false,
    lastMessageAt: ts,
    aiTitle: existing?.aiTitle ?? null,
    dormant: existing?.dormant ?? false,
    recycling: existing?.recycling ?? false,
  };

  console.info({
    operation: "session_last_message_at_advance",
    key,
    ts,
    previous: existing?.lastMessageAt ?? null,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, nextRecord);
  state = { map: nextMap };
  notify();
}

/**
 * Phase 44 (Plan 03) — public seed API for the /sessions/list payload.
 *
 * Wrapper around advanceSessionLastMessageAt that computes the working-store
 * key format `${String(hostId)}:${tmuxSession}` (matching the existing
 * convention documented at the store header — hostId numeric here per the
 * fleet-session type, so stringified explicitly).
 *
 * `tmuxSession` is a required string (not nullable): Plan 44-01's route
 * always emits a non-null sessionName; the CONTEXT.md decision explicitly
 * locks "identity name === tmux session name === /id target" so this seed
 * path never fires for null tmuxSession. If no WorkingRecord exists yet for
 * the key, advanceSessionLastMessageAt creates one with `isWorking: false`
 * (dormant sessions have no isWorking signal). See 43-CONTEXT.md §
 * Reconciliation helper.
 */
export function seedSessionLastMessageAt(
  hostId: number,
  tmuxSession: string,
  ts: number | null,
): void {
  const key = `${String(hostId)}:${tmuxSession}`;
  advanceSessionLastMessageAt(key, ts);
}

/**
 * Phase 47 (Plan 03) — the ONLY writer of WorkingRecord.aiTitle.
 *
 * LAST-WINS contract (per 47-CONTEXT.md § Working-store third axis):
 *   - If `title === null`: no-op + no-notify (null NEVER overwrites; the
 *     ai-title axis only advances on positive signal — fail-open so a
 *     transient WS frame lacking aiTitle cannot blank the cached string).
 *   - If no record exists for `key`: create
 *     `{ isWorking: false, lastMessageAt: null, aiTitle: title }`, notify.
 *   - If record exists AND `record.aiTitle === title` (Object.is via `===`
 *     for string primitives): no-op + no-notify (prevents needless
 *     re-renders when a WS frame carries the same title as the cached one).
 *   - Otherwise: write `title` (overwriting any prior string OR any prior
 *     null-with-record case), notify.
 *
 * The `isWorking` + `lastMessageAt` axes are preserved verbatim on
 * existing records — never mutated by this helper. New-record writes
 * default `isWorking: false` + `lastMessageAt: null` (dormant seed case).
 *
 * Distinct from advanceSessionLastMessageAt's max-wins because ai-title
 * EVOLVES: as the session's topic drifts across turns, the freshest
 * ARRIVAL is the correct value — strings have no numeric ordering, only
 * recency of arrival. Ashley 2026-08-19: "If WS says Debug X and later
 * WS says Fix Y, we want Fix Y."
 *
 * Called from BOTH the WS publish path (via publishFleetStatusSessionState's
 * Axis C block) AND the /sessions/list seed path (via seedSessionAiTitle).
 * Single reconciliation chokepoint — any future contract tweak is a
 * one-place change.
 */
function advanceSessionAiTitle(key: string, title: string | null): void {
  if (title === null) return;

  const existing = state.map.get(key);
  if (existing !== undefined && existing.aiTitle === title) {
    // Cache already holds this exact string — last-wins no-op + no-notify.
    return;
  }

  const nextRecord: WorkingRecord = {
    isWorking: existing?.isWorking ?? false,
    lastMessageAt: existing?.lastMessageAt ?? null,
    aiTitle: title,
    dormant: existing?.dormant ?? false,
    recycling: existing?.recycling ?? false,
  };

  console.info({
    operation: "session_ai_title_advance",
    key,
    title,
    previous: existing?.aiTitle ?? null,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, nextRecord);
  state = { map: nextMap };
  notify();
}

/**
 * Phase 47 (Plan 03) — public seed API for the /sessions/list payload.
 *
 * Wrapper around advanceSessionAiTitle that computes the working-store
 * key format `${String(hostId)}:${tmuxSession}` (matching the existing
 * convention documented at the store header — hostId numeric here per
 * the fleet-session type, so stringified explicitly).
 *
 * `tmuxSession` is a required string (not nullable): the Phase 47
 * /sessions/list route always emits a non-null sessionName; CONTEXT.md
 * locks "identity name === tmux session name === /id target" so this
 * seed path never fires for null tmuxSession. If no WorkingRecord exists
 * yet for the key, advanceSessionAiTitle creates one with
 * `isWorking: false` + `lastMessageAt: null` (dormant seed default).
 * See 47-CONTEXT.md § Working-store third axis.
 */
export function seedSessionAiTitle(
  hostId: number,
  tmuxSession: string,
  title: string | null,
): void {
  const key = `${String(hostId)}:${tmuxSession}`;
  advanceSessionAiTitle(key, title);
}

/**
 * Hook: derive "is this session working?" for a single key.
 * Returns a plain boolean.
 *
 *   - Null key → false (short-circuit; no useSyncExternalStore work).
 *   - Unknown key → false (key never published — suppress dot until first frame).
 *   - isWorking === false (idle, no bg work, or waiting) → false.
 *   - isWorking === true (busy, shell, or bg work present) → true.
 *
 * NOTE: waiting status returns FALSE — waiting is a SEPARATE axis from
 * working. The WaitingBubble (session-waiting-store) handles the waiting
 * axis. Per D-CTX § Composite state (LOCKED).
 */
export function useSessionIsWorking(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.isWorking;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook: three-state variant of useSessionIsWorking.
 * Preserves the "never heard from this session" null signal needed for
 * aside-arm and ComposeBox idle-gate correctness:
 *
 *   - Null key         → null  (no key, no data)
 *   - Unknown key      → null  (key never published — "never heard"; NOT false)
 *   - isWorking true   → true  (session actively working)
 *   - isWorking false  → false (session published + idle)
 *
 * DISTINCTION from useSessionIsWorking: the non-raw variant collapses
 * "unknown key" and "idle" both to false (legacy WipBubble semantics).
 * This raw variant preserves the third state so PrettyView can distinguish
 * "first broadcast not yet landed" (null → don't fire aside-arm) from
 * "broadcast says idle" (false → isIdleDerived true → aside-arm may fire).
 *
 * Both hooks read from the SAME internal Map — no additional state.
 */
export function useSessionIsWorkingRaw(key: string | null): boolean | null {
  const getSnapshot = (): boolean | null => {
    if (key === null) return null;
    const record = state.map.get(key);
    if (record === undefined) return null;
    return record.isWorking;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Phase 52 Plan 01 — Hook: derive "is this session dormant?" for a single key.
 * Returns a strict boolean (never null/undefined).
 *
 *   - Null key          → false (short-circuit; no useSyncExternalStore work).
 *   - Unknown key       → false (key never published — default-open state).
 *   - dormant === false → false (sentinel absent; identity in normal operation).
 *   - dormant === true  → true  (sentinel present; identity parked by supervisor).
 *
 * Source: ~/.claude/identities/<tmuxSession>/.dormant sentinel file on the
 * target host, plumbed via ssh-poll-orchestrator source A (live-PID tick) and
 * source B (dormant-only enumeration). See Phase 52 Plan 01 for both sources.
 *
 * Consumed by Plan 03's Ready predicate: rows are "ready" when
 * !isWorking && !isDormant — both hooks read from the same WorkingRecord.
 */
export function useSessionIsDormant(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.dormant;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Phase 53 Plan 02 — Hook: derive 'is this session recycling?' for a single
 * key. Returns a strict boolean (never null/undefined).
 *
 *   - Null key              → false (short-circuit; no useSyncExternalStore work).
 *   - Unknown key           → false (key never published — default-safe).
 *   - recycling === false   → false (sentinel absent; no recycle in flight).
 *   - recycling === true    → true  (sentinel present; identity being replaced
 *                                    via /id-reset).
 *
 * Source: caretaker's ~/.claude/identities/<tmuxSession>/.recycled-at sentinel,
 * plumbed via ssh-poll-orchestrator source A per Phase 53 RESEARCH § Assumption
 * A1, see Phase 53 Plan 01.
 *
 * Consumer surfaces: PrettyView holding overlay mount gate + PrettyConversationRow
 * row-spinner input in Plan 53-03. Retires the client-side recycling bridge store
 * (deleted in 53-03) that previously bridged them — required a mounted pane to
 * publish; any unmounted row was blind to its own session's recycling state.
 */
export function useSessionIsRecycling(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.recycling;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Return the raw internal Map as a ReadonlyMap view.
 * NOT for production callers. Kept exported (rather than gated on
 * import.meta.env.MODE === "test") because Vite's tree-shaker drops it from
 * the production bundle if no production code imports it.
 */
export function getSessionWorkingSnapshot(): ReadonlyMap<
  string,
  { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean; recycling: boolean }
> {
  return state.map;
}

// ─── Phase 41 Plan 03 — lastMessageAt cache read paths ───────────────────────

/**
 * Plain getter — return the cached `lastMessageAt` unix millis for the given
 * session-working-key, or `null` when the key is not in the cache OR when the
 * cache holds an explicit null (session with no message-bearing history).
 *
 * PRIMARY caller: conversation-store's row-derivation site — every middle-
 * zone / pinned / RDP row's construction stamps `row.lastMessageAt` by
 * calling this function with the row's derived sessionKey. compareByRecencyDesc
 * then reads row.lastMessageAt directly.
 *
 * Non-React entry point: does NOT subscribe. The conversation-store's snapshot
 * memoization is bumped by subscribeSessionWorkingStore's bridge — see
 * conversation-store.ts's module-init bridge registration.
 */
export function getSessionLastMessageAt(sessionKey: string | null): number | null {
  if (sessionKey === null) return null;
  const record = state.map.get(sessionKey);
  if (record === undefined) return null;
  return record.lastMessageAt;
}

/**
 * React hook — subscribe to a single session's cached `lastMessageAt` and
 * re-render on change. Returns null when the key is absent OR when the
 * cache holds an explicit null.
 *
 * Not currently consumed by production code (conversation-store reads via
 * the plain getter above at snapshot-derivation time), but exported so any
 * future per-row surface that wants to observe the raw recency signal
 * (e.g. a hypothetical "last activity: 3m ago" label) can subscribe
 * cheaply. Signature parallels useSessionIsWorking.
 */
export function useSessionLastMessageAt(sessionKey: string | null): number | null {
  const getSnapshot = (): number | null => getSessionLastMessageAt(sessionKey);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── Phase 47 Plan 03 — aiTitle cache read paths ─────────────────────────────

/**
 * Plain getter — return the cached `aiTitle` string for the given session-
 * working-key, or `null` when the key is not in the cache OR when the cache
 * holds an explicit null (session with no ai-title yet).
 *
 * PRIMARY caller: Plan 47-04's PrettyConversationRow subtitle consumer —
 * every middle-zone row's subtitle is derived from this cache entry via
 * the useSessionAiTitle hook below. Non-React entry point: does NOT
 * subscribe. Mirrors getSessionLastMessageAt's shape (Phase 41 Plan 03).
 */
export function getSessionAiTitle(sessionKey: string | null): string | null {
  if (sessionKey === null) return null;
  const record = state.map.get(sessionKey);
  if (record === undefined) return null;
  return record.aiTitle;
}

/**
 * React hook — subscribe to a single session's cached `aiTitle` and
 * re-render on change. Returns null when the key is absent OR when the
 * cache holds an explicit null (session with no ai-title yet).
 *
 * Consumed by Plan 47-04's PrettyConversationRow (per-row subtitle).
 * Signature parallels useSessionLastMessageAt. Notify cadence is
 * controlled by advanceSessionAiTitle's LAST-WINS + Object.is guard so
 * successive frames carrying the same title do NOT re-render this hook.
 */
export function useSessionAiTitle(sessionKey: string | null): string | null {
  const getSnapshot = (): string | null => getSessionAiTitle(sessionKey);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Unused variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion if nothing else uses it. The notify() caller bumps it.
void snapshotVersion;

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-working-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, WorkingRecord>() };
  notify();
}
