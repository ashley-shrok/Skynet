/**
 * Pane-state wire-frame emitter (Phase 30 Plan 30-01).
 *
 * WHY THIS EXISTS (per 30-CONTEXT.md § Signal set LOCKED + § Migration):
 *
 * Pre-Phase-30, five racing WS frame types (dormant / session_holding /
 * session_holding_cleared / session_changed / inactive) drove the pretty-view
 * pane-entry state machine via CLIENT-SIDE inference. Every one of those
 * emits carries partial truth about "what state is this pane in now?" — but
 * the machine that combined them lived in the browser, mixing backend-observed
 * fact with client-side heuristics (patch #381 in particular, which used a
 * user-gesture hint to preemptively arm the holding overlay).
 *
 * Phase 30 collapses those five emit sites into ONE authoritative frame:
 *
 *   { type: "pane_state", state: PaneState, reason?: string }
 *
 * The emitter is INSTANTIATED PER CONNECTION (closure-scoped per WS in
 * claude-session-server.ts) and dedupes against its own last emit — mirrors
 * the existing `dormantLastEmitted` boolean pattern at claude-session-server.ts
 * lines 1010-1022 exactly, so back-to-back identical transitions produce ONE
 * wire frame (T-30-02 mitigation).
 *
 * THIS MODULE IS PURE. It imports nothing I/O-shaped (no ws / ssh2 / logger /
 * fs). All side effects go through the injected `wsSend` callback. Same
 * "pure module, testable in isolation" property as layer1-detect.ts — the
 * caller in claude-session-server.ts owns the WebSocket-open guard and the
 * try/catch around ws.send, and passes a closure that does exactly what the
 * pre-Phase-30 emit sites did.
 *
 * MIGRATION POSTURE (per 30-CONTEXT.md § Deferred "backward compat this
 * phase"): the legacy dormant / session_holding / session_holding_cleared /
 * session_changed / inactive frames STAY on the wire alongside the new
 * pane_state frame. Deprecation is deferred to a follow-up phase once no
 * client depends on them. The funnel work in Plan 30-01 Task 2 is ADDITIVE
 * — every existing ws.send(...) gains a matching paneStateEmitter.emit(...)
 * call, and neither is deleted.
 *
 * REASON VOCABULARY (per 30-CONTEXT.md § Backend observations):
 *   holding:  id_reset | discovery_diff | pid_death | exit_scan
 *   active:   (none) | same_file_recovery | session_changed | dormancy_cleared
 *   dormant:  (none)
 *   inactive: holding_timeout | no_session | session_marked_inactive |
 *             + any string surfaced by discoverClaudeSession's result.reason
 *             (not_claude / no_pid_session_file / no_open_session_file /
 *              no_tmux_session / exec_error) — these were already reaching
 *             the wire pre-Phase-30 via the legacy inactive frame, so the
 *             T-30-01 information-disclosure mitigation still applies: no
 *             user input, no session-file bytes, no filesystem paths.
 *   error:    file_unreadable | tracking_error
 *
 * The `reason` field is deliberately typed `string | undefined` at the wire
 * level — NOT a literal union — so backend observations can add new reason
 * codes over time without a wire-schema bump (per D-migration in
 * 30-CONTEXT.md). The frontend treats `reason` as free-form diagnostic text.
 */

import { databaseLogger } from "../utils/logger.js";

// ── Type surface ────────────────────────────────────────────────────────────

/**
 * Authoritative pane-entry state values per D-signal-set (LOCKED in
 * 30-CONTEXT.md § Signal set). This union is closed — any new state variant
 * requires a wire-schema decision + frontend reducer update. The
 * `_exhaust: never` sentinel inside `emit()` below is the compile-time gate
 * enforcing that no new variant can slip in without being handled.
 */
export type PaneState =
  | "active"
  | "holding"
  | "dormant"
  | "inactive"
  | "error";

/**
 * The wire frame shape. `reason` is optional-string diagnostics; when the
 * caller omits it, the key is OMITTED from the JSON (not sent as
 * `reason: null` or `reason: undefined`) — matches the T-30-01 "no
 * undefined leaks" mitigation and keeps the wire payload minimal.
 */
export type PaneStateWireFrame =
  | { type: "pane_state"; state: PaneState }
  | { type: "pane_state"; state: PaneState; reason: string };

/**
 * Return type of `createPaneStateEmitter`. Named alias (not inline) so
 * consumers in claude-session-server.ts can annotate the per-connection
 * closure variable without repeating the shape.
 *
 * - `emit(state, reason?)` — the primary funnel. Dedupes against the last
 *   (state, reason) pair; if identical, does NOT call wsSend.
 * - `emitCurrent()` — bypass-dedupe re-emit for attach-time forced re-sends
 *   (e.g. a WS re-attach after transient drop — deferred use case per
 *   30-CONTEXT.md § Deferred; API exists so downstream plans can wire it
 *   without another factory bump). No-op when nothing has been emitted yet.
 * - `getCurrent()` — introspection for tests / debug (returns `null` before
 *   any emit, else `{state, reason}` reflecting the last emit).
 */
export type PaneStateEmitter = {
  emit(state: PaneState, reason?: string): void;
  emitCurrent(): void;
  getCurrent(): { state: PaneState; reason: string | undefined } | null;
};

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a per-connection pane-state emitter. The returned emitter closes
 * over `deps.wsSend` — the caller supplies a closure that does exactly what
 * the pre-Phase-30 emit sites did (open-guard + try/catch around ws.send).
 *
 * Instantiation lives in the WS connection scope in claude-session-server.ts
 * (per Plan 30-01 Task 2 Step 3, right after the `layer1: Layer1State`
 * declaration). One emitter per WS; per-pane-switch teardown does NOT tear
 * down the emitter — the connection lifetime is the emitter's lifetime.
 * (A subsequent connectToPane on the same WS reuses the emitter; the dedupe
 * on last-emit correctly re-fires when the new pane's first transition
 * differs from whatever the old pane last emitted.)
 */
export function createPaneStateEmitter(
  deps: { wsSend: (data: string) => void },
): PaneStateEmitter {
  const { wsSend } = deps;

  // Per-instance mutable state. `null` = nothing emitted yet on this
  // emitter's lifetime. Once ANY emit lands, becomes `{state, reason}`
  // where `reason` may be `undefined` (a value, not a wildcard — dedupe
  // compares undefined === undefined strictly).
  let current: { state: PaneState; reason: string | undefined } | null = null;

  const buildFrame = (
    state: PaneState,
    reason: string | undefined,
  ): PaneStateWireFrame => {
    // Conditional-key construction: when `reason` is undefined, OMIT the key
    // from the wire frame (per T-30-01 mitigation — no undefined leaks; also
    // keeps the JSON minimal for the common no-reason case like the initial
    // active emit at attach).
    if (reason !== undefined) {
      return { type: "pane_state", state, reason };
    }
    return { type: "pane_state", state };
  };

  const emit = (state: PaneState, reason?: string): void => {
    // Compile-time exhaustiveness gate: after the five known values below,
    // `state` should narrow to `never`. If a new PaneState variant is added
    // upstream without a matching branch here, the `_exhaust: never`
    // assignment fails `tsc --noEmit`. Same pattern as resolve-phase.ts:166.
    //
    // Because `strict: false` in tsconfig.node.json we can't rely on
    // exhaustive-switch narrowing alone — enumerate each case explicitly so
    // the assertion runs on the last remaining branch.
    switch (state) {
      case "active":
      case "holding":
      case "dormant":
      case "inactive":
      case "error":
        break;
      default: {
        // If any of the above cases is removed OR a new PaneState variant
        // is added without a matching case, TypeScript will fail here
        // because `state` will still carry the un-narrowed variant.
        const _exhaust: never = state;
        // Runtime fallthrough — if the compile-time gate is somehow
        // bypassed (JS caller), still send the frame with whatever string
        // the caller passed. Return early via `return _exhaust` is not
        // helpful (void function), so we just no-op and let the code below
        // handle it. In practice tsc catches this at compile time.
        void _exhaust;
      }
    }

    // Dedupe against the LAST emit ONLY (not any prior emit) — strict
    // equality on BOTH state AND reason, treating undefined as a value.
    // Mirrors dormantLastEmitted at claude-session-server.ts:1010-1022:
    // back-to-back identical transitions produce ONE wire frame.
    if (
      current !== null &&
      current.state === state &&
      current.reason === reason
    ) {
      databaseLogger.info(`[pane-state-emitter] emit-suppressed-dedupe state=${state} reason="${reason ?? ''}" prevState=${current.state} prevReason="${current.reason ?? ''}"`, { operation: "pane_state_emit_dedupe" });
      return;
    }

    databaseLogger.info(`[pane-state-emitter] emit state=${state} reason="${reason ?? ''}" prevState=${current?.state ?? 'null'} prevReason="${current?.reason ?? ''}"`, { operation: "pane_state_emit" });
    current = { state, reason };
    wsSend(JSON.stringify(buildFrame(state, reason)));
  };

  const emitCurrent = (): void => {
    // Attach-time forced re-emit. If nothing has been emitted yet, there is
    // nothing to re-send — return early. Otherwise BYPASS dedupe (this is
    // the whole point of emitCurrent — a fresh client that missed the
    // original emit needs the frame regardless of the server's dedupe
    // bookkeeping).
    if (current === null) return;
    wsSend(JSON.stringify(buildFrame(current.state, current.reason)));
  };

  const getCurrent = (): { state: PaneState; reason: string | undefined } | null => {
    return current;
  };

  return { emit, emitCurrent, getCurrent };
}
