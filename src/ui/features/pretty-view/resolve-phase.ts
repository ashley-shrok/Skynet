// phase-29: pure resolvePhase reducer — test-seam split per layer1-detect.ts pattern
/**
 * Pure pane-entry phase resolver — extracted from PrettyView.tsx as a
 * test-seam split so the SPEC req 4 truth table can be unit-tested
 * without any React / WS / logger setup (phase 29 — unified
 * session-entry state machine).
 *
 * WHY THIS EXISTS (Ashley's 2026-08-10 flicker report):
 *
 * The pre-phase-29 PrettyView hosted ~5 racing local state machines
 * (isBooting / isHolding+showOverlay / dormant+waking / status
 * connecting|error) that each armed their own overlay independently on
 * every entry-trigger edge (cold mount, warm hidden→visible re-focus,
 * PWA foreground). The visible UI on entry was whichever machine's
 * overlay won the paint race — Ashley empirically observed black-screen
 * "Connecting…" flashes on panes that were active moments ago,
 * "Connection lost" boxes covering half the screen briefly, and stale
 * "Waking up…" text on sessions that had been awake for a while.
 *
 * Phase 29 replaces that patchwork with a single deterministic state
 * machine whose `phase` is derived from exactly two resolution inputs
 * (SPEC req 3 + 4):
 *
 *   - wsState:            "not-connected" | "opening" | "open" | "failed-permanently"
 *   - backendFirstFrame:  "not-yet" | "active" | "inactive" | "session_holding" | "dormant"
 *
 * The `resolvePhase(wsState, backendFirstFrame): Phase` function in this
 * file encodes the entire SPEC req 4 truth table as a single pure
 * function with TypeScript exhaustiveness (the `_exhaust: never` sentinel
 * fails `tsc --noEmit` at build time if a new BackendFirstFrame variant
 * is added without updating the branch list). One function, one truth
 * table, one deterministic phase for every input combination — no race,
 * no timing heuristic, no wall-clock deadline.
 *
 * ARCHITECTURAL NOTE — post-resolve semantics (D-10 / D-11 / D-12):
 *
 * This module is imported by `usePaneResolvingMachine` (plan 29-02) but
 * does NOT itself gate on `hasEverResolved`. Post-resolve steady-state
 * (once the machine has resolved to `active`, transient WS drops must
 * NOT re-enter `resolving` — only the three named entry triggers can
 * re-arm resolving) is the hook's concern, layered on top of this pure
 * reducer's output. Keeping this file pure and axis-free is what makes
 * the truth table cheap to verify at unit granularity.
 *
 * NO I/O IMPORTS — pure function only. No React imports, no WebSocket
 * imports, no logger imports, no timer scheduling, no wall-clock reads.
 * Enforced by the plan-29-04 structural-grep gate:
 *   grep -c "^import " src/ui/features/pretty-view/resolve-phase.ts → 0
 * This is what makes the truth-table unit tests in resolve-phase.test.ts
 * cheap to set up (import + call — no mocks, no timers, no renderHook).
 * The pattern is copied verbatim from
 * src/backend/claude-session/layer1-detect.ts's "no I/O imports" invariant.
 */

// ── Resolution-input type unions (SPEC req 3) ───────────────────────────────
//
// Kept as plain string-literal unions (not enums, not const objects) so
// that `resolvePhase`'s parameters carry structural intent at every call
// site and the exhaustiveness sentinel below has a `never` to narrow to.
// Order + spelling of members is load-bearing — the acceptance-grep in
// this plan asserts exact membership, and PATTERNS.md section 1 fixes the
// canonical order of enumeration.

/**
 * WebSocket connection lifecycle from the pretty-view WS layer.
 * `"failed-permanently"` is the terminal-give-up state (retry ladder
 * exhausted with no further reconnect scheduled) and is the ONLY input
 * that resolves to `phase === "error"` per D-04.
 */
export type WsState = "not-connected" | "opening" | "open" | "failed-permanently";

/**
 * The first backend frame observed on the pretty-view WS after
 * `connectToPane` is sent. `"not-yet"` means no frame has arrived; the
 * other four values map 1:1 to existing backend frame types (SPEC req 3).
 * "Session probe in flight" is folded into `"not-yet"` — no separate axis.
 */
export type BackendFirstFrame =
  | "not-yet"
  | "active"
  | "inactive"
  | "session_holding"
  | "dormant";

/**
 * Terminal phase rendered by the pane-entry state machine. Exactly six
 * members — SPEC req 1 + 6 lock this list. `"resolving"` is the transient
 * pre-verdict state (the resolving spinner phase); the other five are
 * post-resolution terminal phases each with a dedicated overlay
 * component gated on the corresponding string value.
 */
export type Phase =
  | "resolving"
  | "active"
  | "holding"
  | "dormant"
  | "inactive"
  | "error";

// ── Pure truth-table resolver (SPEC req 4) ──────────────────────────────────

/**
 * Map (wsState × backendFirstFrame) → Phase exactly per the SPEC req 4
 * truth table. Pure function — no side effects, no I/O, no wall-clock
 * logic. Branch order is fixed per PATTERNS.md section 1:
 *
 *   1. WS terminal failure short-circuits to `"error"` regardless of
 *      backendFirstFrame (D-04: WS `"failed-permanently"` is the only
 *      path to the error phase; NO wall-clock timeout ever resolves to
 *      error).
 *   2. WS still coming up (`"not-connected"` or `"opening"`) short-
 *      circuits to `"resolving"` regardless of backendFirstFrame — the
 *      hook has not yet had a chance to observe any frame.
 *   3. WS is open and no frame has arrived yet → keep resolving. The
 *      spinner stays up until the backend reports a first-frame verdict.
 *   4-7. WS is open and a first frame arrived → map 1:1 to the matching
 *      terminal phase.
 *   8. Exhaustiveness sentinel: `_exhaust: never` narrows the union to
 *      empty; adding a new BackendFirstFrame variant without updating
 *      the branch list fails `tsc --noEmit` at build time.
 *
 * Truth table (all 4×5 = 20 combinations):
 *
 *   wsState              | backendFirstFrame  | → Phase
 *   ---------------------|--------------------|----------
 *   not-connected        | any                | resolving
 *   opening              | any                | resolving
 *   open                 | not-yet            | resolving
 *   open                 | active             | active
 *   open                 | session_holding    | holding
 *   open                 | dormant            | dormant
 *   open                 | inactive           | inactive
 *   failed-permanently   | any                | error
 */
export function resolvePhase(
  wsState: WsState,
  backendFirstFrame: BackendFirstFrame,
): Phase {
  // (1) WS terminal give-up — the ONLY path to "error" phase (D-04).
  if (wsState === "failed-permanently") return "error";

  // (2) WS still coming up — resolving regardless of any frame the
  // backend might have queued. The spinner stays up until the WS is
  // fully open AND the first frame arrives.
  if (wsState === "not-connected" || wsState === "opening") return "resolving";

  // wsState === "open" past this point (narrowed via elimination).

  // (3) WS is open but the backend has not yet emitted a first frame.
  // Keep resolving; the spinner waits as long as inputs need. No wall-
  // clock deadline (SPEC req 5).
  if (backendFirstFrame === "not-yet") return "resolving";

  // (4-7) WS is open and the backend has reported its first-frame
  // verdict — map 1:1 to the matching terminal phase.
  if (backendFirstFrame === "active") return "active";
  if (backendFirstFrame === "session_holding") return "holding";
  if (backendFirstFrame === "dormant") return "dormant";
  if (backendFirstFrame === "inactive") return "inactive";

  // (8) Compile-time exhaustiveness gate. If a new BackendFirstFrame
  // variant is added upstream without a matching branch above,
  // `backendFirstFrame` here would carry the un-narrowed variant and
  // `_exhaust: never` would fail `tsc --noEmit`. This is how the plan
  // 29-04 exhaustiveness assertion is enforced without a runtime check.
  const _exhaust: never = backendFirstFrame;
  return _exhaust;
}
