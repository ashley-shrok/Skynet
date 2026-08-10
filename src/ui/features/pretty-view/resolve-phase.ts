// phase-30: pure resolveRenderedState reducer — PS30-04 + PS30-05 + PS30-06 LOCKED
/**
 * Pure pane-entry rendered-state resolver — the deterministic core of the
 * phase-30 backend-authoritative pane-state architecture (Plan 30-03).
 *
 * WHY THIS EXISTS (Phase 30 rewrite of Phase 29):
 *
 * Pre-Phase-30, this file hosted a `resolvePhase(wsState, firstFrame)`
 * reducer that took a 4×5 truth table over CLIENT-INFERRED first-frame
 * values. The client-inferred axis was populated by ~10 call sites scattered
 * across PrettyView.tsx's WS onmessage handler — every content-shape frame
 * (message / image / relay_* / malformed_line) triggered an "active"
 * capture (the old D-11 "any live message swaps back to active" rule),
 * plus explicit captures for session_holding / dormant / inactive /
 * session_changed / session_holding_cleared, plus a user-gesture hint in
 * `onResetClicked`. The state machine was in the browser, mixing backend
 * fact with client heuristics.
 *
 * Phase 30 collapses those five racing WS frame types into ONE authoritative
 * backend-emitted frame (`{type:"pane_state", state, reason?}` — see
 * src/backend/claude-session/pane-state-emitter.ts). The frontend's job is
 * now trivial: store the last-received `paneState`, combine with the
 * client-observed `wsTransportState`, and derive the rendered-state via
 * this pure reducer.
 *
 * TRUTH TABLE (LOCKED per 30-CONTEXT.md § Truth table):
 *
 *   wsTransportState        | paneState received?   | → RenderedState
 *   ------------------------|------------------------|------------------
 *   failed-permanently      | any                    | error
 *   not-connected / opening | null (never received)  | resolving
 *   not-connected / opening | non-null (previously)  | last-known paneState
 *   open                    | null (not yet)         | resolving
 *   open                    | non-null (received)    | paneState directly
 *
 * The 5th row (transport transient drop + previous paneState → keep
 * last-known) is the D-11 "don't flicker" rule — it is what makes the
 * frontend robust to WS reconnects without falling back to the resolving
 * spinner every time the socket blips.
 *
 * NO I/O IMPORTS — pure function only. No React imports, no WebSocket
 * imports, no logger imports, no timer scheduling, no wall-clock reads.
 * Enforced by the plan-30-03 structural-grep gate:
 *   grep -c "^import " src/ui/features/pretty-view/resolve-phase.ts → 0
 * This is what makes the truth-table unit tests in resolve-phase.test.ts
 * cheap to set up (import + call — no mocks, no timers, no renderHook).
 * The pattern is copied verbatim from
 * src/backend/claude-session/layer1-detect.ts's "no I/O imports" invariant.
 *
 * ARCHITECTURAL NOTE — post-resolve semantics (D-11 / D-12 inheritance):
 *
 * The old Phase-29 `usePaneResolvingMachine` hook layered a rearm-snapshot
 * pattern on top of the pure reducer to enforce "once resolved, only the
 * three named entry triggers can re-arm resolving". Phase 30 DELETES that
 * entire mechanism (entry-triggers gone; the hook is now a trivial ~30-LOC
 * wrapper — see usePaneResolvingMachine.ts). The reducer's D-11 branch (5th
 * row above) is what makes that safe: a transport transient drop after
 * paneState was received stays visually on the last-known overlay rather
 * than reverting to the resolving spinner, so the flicker regression the
 * rearm-snapshot pattern was defending against cannot occur here.
 */

// ── Resolution-input type unions (PS30-04) ──────────────────────────────────
//
// Kept as plain string-literal unions (not enums, not const objects) so
// that `resolveRenderedState`'s parameters carry structural intent at every
// call site and the exhaustiveness sentinel below has a `never` to narrow
// to. Order + spelling of members is load-bearing — the acceptance-grep in
// this plan asserts exact membership.

/**
 * WebSocket transport lifecycle from the pretty-view WS layer. Unchanged
 * from Phase 29's `WsState` (only the name changes: WsTransportState makes
 * explicit that this is TRANSPORT state — the browser's own socket — not
 * the pane-entry state which is now backend-authoritative). `"failed-
 * permanently"` is the terminal-give-up state (retry ladder exhausted with
 * no further reconnect scheduled) and is the ONLY input from transport
 * signals that resolves to `RenderedState === "error"`.
 */
export type WsTransportState =
  | "not-connected"
  | "opening"
  | "open"
  | "failed-permanently";

/**
 * Backend-authoritative pane-entry verdict from the `{type:"pane_state",
 * state, reason?}` wire frame. MUST match the backend emitter's PaneState
 * wire values EXACTLY — see src/backend/claude-session/pane-state-emitter.ts:
 *
 *   export type PaneState = "active" | "holding" | "dormant" | "inactive" | "error";
 *
 * We deliberately do NOT import the backend type — the wire is the contract,
 * cross-boundary TypeScript imports create build-tool coupling. The
 * exhaustiveness sentinel inside `resolveRenderedState` below is the
 * compile-time gate enforcing that this union stays in sync with the
 * backend's — if the backend adds a new state value without the frontend
 * matching, `npx tsc --noEmit` fails at the `_exhaust: never` line.
 */
export type PaneState =
  | "active"
  | "holding"
  | "dormant"
  | "inactive"
  | "error";

/**
 * The six overlay-mount outcomes for the pretty-view surface. Same six
 * values as Phase 29's `Phase` (only the name changes for terminology
 * cleanliness — "phase" implied a state machine, "RenderedState" is what
 * it actually is: which overlay renders). `resolving` is the transient
 * pre-verdict state (the resolving spinner phase); the other five are
 * post-resolution outcomes each with a dedicated overlay component gated
 * on the corresponding string value in PrettyView.tsx.
 */
export type RenderedState =
  | "resolving"
  | "active"
  | "holding"
  | "dormant"
  | "inactive"
  | "error";

// ── Pure truth-table resolver (PS30-06) ─────────────────────────────────────

/**
 * Map (WsTransportState × PaneState | null) → RenderedState exactly per the
 * LOCKED Phase-30 truth table above. Pure function — no side effects, no
 * I/O, no wall-clock logic.
 *
 * BRANCH ORDER (LOCKED — matches 30-CONTEXT.md § Truth table row-by-row):
 *
 *   (a) failed-permanently short-circuit — the ONLY path from transport
 *       to error rendered-state. Overrides any paneState value (paneState
 *       === "error" also collapses here to "error", so no conflict).
 *   (b) open + paneState received — the happy path: backend has spoken,
 *       transport is up, render the verdict directly. Contains the
 *       compile-time exhaustiveness sentinel that gates the PaneState
 *       union against silent drift.
 *   (c) open + no paneState — waiting for backend's initial pane_state
 *       emit; render the resolving spinner.
 *   (d) transport transient drop + previous paneState — D-11 "don't
 *       flicker" rule: keep rendering the last-known paneState's overlay
 *       rather than reverting to resolving. If paneState is "error" here,
 *       the value passes through and renders the error overlay (unified
 *       with transport-error since both routes converge on the same
 *       overlay component).
 *   (e) final catch — transport not open + no paneState received yet;
 *       render the resolving spinner.
 */
export function resolveRenderedState(
  wsTransportState: WsTransportState,
  paneState: PaneState | null,
): RenderedState {
  // (a) failed-permanently short-circuit.
  if (wsTransportState === "failed-permanently") return "error";

  // (b) Happy path: transport open + backend verdict received. Compile-time
  // exhaustiveness sentinel narrows the PaneState union — if a new PaneState
  // value is added upstream without a matching switch branch here,
  // `_exhaust: never` fails `npx tsc --noEmit` at build time.
  if (wsTransportState === "open" && paneState !== null) {
    switch (paneState) {
      case "active":
      case "holding":
      case "dormant":
      case "inactive":
      case "error":
        return paneState;
      // F1 acknowledgment (plan-checker 2026-08-10): the default branch below
      // exists SOLELY as a compile-time exhaustiveness gate. Runtime never
      // reaches it — the five case branches above cover every value of the
      // PaneState union (see resolve-phase.ts type declaration). Its purpose
      // is that if a future backend change adds a new PaneState value (e.g.
      // "waking") without updating the frontend union to match, TypeScript's
      // narrowing rule flags `_exhaust: never` as a type error at
      // `npx tsc --noEmit` time — the build fails loudly rather than the
      // frontend silently rendering a stale/wrong overlay. This is the
      // pattern's whole value; the runtime pass-through of `_exhaust` is a
      // dead-code formality required to satisfy TypeScript's return-value
      // completeness check.
      default: {
        const _exhaust: never = paneState;
        return _exhaust;
      }
    }
  }

  // (c) Transport open, no verdict yet — spinner.
  if (wsTransportState === "open" && paneState === null) return "resolving";

  // (d) Transport transient drop (not-connected / opening) with a previous
  // paneState — D-11 don't-flicker: render the last-known overlay. If
  // paneState is "error" here, that value passes through and renders the
  // error overlay (unified with transport-error).
  if (paneState !== null) return paneState;

  // (e) Final catch: transport not open + no paneState received yet.
  return "resolving";
}
