/**
 * Layer 1 fast-path recycle detector — pure helpers extracted from
 * claude-session-server.ts (quick 260808-ohn / bounty
 * session-holding-layer1-detect-id-reset-not-exit).
 *
 * WHY THIS EXISTS (Ashley's design point 2):
 *
 * The pre-refactor Layer 1 was an edge-triggered scan for the string
 * `<command-name>/exit</command-name>` inside a raw JSONL line. That
 * detector was broken across WS reconnects because:
 *
 *   (a) `hasSeenExit` was a per-connection boolean that reset on every
 *       teardownPane call, and the tail replays with `-n +1` on every
 *       reconnect — so every historical /exit line in the JSONL
 *       re-fires transitionToHolding("exit_marker"), flashing the
 *       SessionHoldingOverlay for a few seconds on every conversation-
 *       list revisit (Ashley empirically saw 14 arm+clear pairs in ~1h
 *       on a single session).
 *
 *   (b) /exit itself is not a reliable signal of "the tmux session is
 *       recycling right now" — historical /exit turns from prior
 *       recycles land in the same JSONL file when Claude Code
 *       recover-in-same-cwd's, and old /exit lines have zero predictive
 *       power for the CURRENT session's state.
 *
 * The tail-state-derived model in this file replaces that scan with:
 * "the SessionHoldingOverlay is armed IFF the file's MOST-RECENT user
 * turn is `/id reset`." Computed uniformly across `-n +1` replay AND
 * live-append — same code path, same invariants, no reconnect drift.
 * The reducer is a pure state machine; the caller (claude-session-server
 * onLine) reacts to the returned action by calling the real transition
 * helpers.
 *
 * WHY /id reset (and not /exit) IS THE RIGHT SIGNAL:
 *
 * `/id reset` is the ONE Claude Code slash-command that means "please
 * hard-recycle this session so I can adopt a new identity". Every other
 * /id subcommand (/id save, /id tanya, /id list, ...) does NOT recycle
 * the session — it only mutates identity artifacts. So `/id reset` is
 * both necessary (there is no other UI path to a hard recycle) and
 * sufficient (it always triggers the recycle) to arm the overlay.
 *
 * All helpers here are PURE (no I/O, no imports from ssh2 / WebSocket /
 * logger / anything I/O-shaped). This is what makes them cheap to
 * unit-test at layer1-detect.test.ts granularity; the integration seam
 * __applyLayer1LineForTests below composes them into the exact shape
 * the production onLine handler uses, so the two cannot drift.
 */

// ── Pure line predicates (no JSON.parse) ────────────────────────────────────
//
// Both predicates operate on the raw JSONL line via line.includes. This is
// intentionally cheaper than JSON.parse and matches the shape used
// elsewhere in this file. Verified byte-shape (session-file-parser.ts:213
// filters on obj.type !== "user" AFTER JSON.parse): the substring
// `"type":"user"` occurs in the serialized form iff the parsed object has
// type: "user", because JSON.stringify emits keys unquoted-of-whitespace
// in that exact order for our writer. (Claude Code writes these lines
// with the same stringify shape.)

/**
 * Cheapest raw-string check that the JSONL line represents a Claude Code
 * user-role turn. Does NOT JSON.parse — the caller may still parse later
 * for other purposes.
 */
export function isUserTurn(line: string): boolean {
  return line.includes('"type":"user"');
}

/**
 * True iff the line is a user turn AND its content contains BOTH the
 * `<command-name>/id</command-name>` tag AND the `<command-args>reset`
 * tag-prefix. The `<command-args>reset` check is intentionally a
 * PREFIX match (args STARTS with `reset`) so Ashley's freeform
 * explanations (e.g. `<command-args>reset because I want to change
 * roles</command-args>`) still fire.
 *
 * This is the ONLY function that decides "this line is an /id reset
 * user turn". If the byte-shape assumption ever changes upstream, this
 * is the single place to update.
 */
export function isIdResetUserTurn(line: string): boolean {
  if (!isUserTurn(line)) return false;
  if (!line.includes("<command-name>/id</command-name>")) return false;
  if (!line.includes("<command-args>reset")) return false;
  return true;
}

// ── Tail-state reducer ──────────────────────────────────────────────────────

/**
 * Mutable per-connection state for the Layer 1 detector. `null` means
 * "no user turn observed yet"; once ANY user turn arrives it becomes
 * a boolean tracking whether that most-recent user turn was /id reset.
 *
 * Lives in the caller's connection scope (claude-session-server.ts, next
 * to `changeoverState`). Reset to `{mostRecentUserTurnIsIdReset: null}`
 * on teardownPane and on transitionToActiveNew (both are per-connection
 * resets where a fresh tail is about to start).
 */
export type Layer1State = {
  mostRecentUserTurnIsIdReset: boolean | null;
};

/**
 * Decision returned by the reducer. The caller MUST call the appropriate
 * transition helper for "arm_holding" / "clear_holding" — the reducer
 * itself does not fire side effects.
 */
export type Layer1Action = "none" | "arm_holding" | "clear_holding";

/**
 * ChangeoverState mirror — kept as a plain string union rather than
 * importing from claude-session-server.ts to preserve the "no I/O
 * imports" property of this helper module. The caller ensures the two
 * unions stay in sync (they are compile-time-checked at the call site
 * because the argument type matches the closure-scoped
 * `changeoverState` variable's type).
 */
type ChangeoverState = "active" | "holding" | "dead";

/**
 * Apply one JSONL line to the Layer 1 tail-state and decide whether
 * the caller should arm or clear the SessionHoldingOverlay. Mutates
 * `state.mostRecentUserTurnIsIdReset` in-place iff the line is a user
 * turn (assistant / tool_use / tool_result / thinking /
 * system-reminder / any non-user line: no state change, returns
 * "none").
 *
 * Decision table (after the state update):
 *   - user turn + now isIdReset=true + changeoverState="active"
 *       → "arm_holding"
 *   - user turn + now isIdReset=false + changeoverState="holding"
 *       → "clear_holding"
 *   - otherwise
 *       → "none"
 *
 * `dead` is terminal — no action ever fires while dead, and this
 * function does NOT mutate state in the dead branch (the caller has
 * already stopped the tail; state consistency doesn't matter).
 *
 * This same logic applies uniformly on `-n +1` replay AND live appends —
 * that is the load-bearing property of the tail-state-derived model.
 */
export function applyLineToLayer1State(
  line: string,
  state: Layer1State,
  currentChangeoverState: ChangeoverState,
): Layer1Action {
  // dead is terminal: no state changes, no actions. Guard first so we
  // never accidentally mutate state after the pane has been declared
  // permanently inactive.
  if (currentChangeoverState === "dead") return "none";

  // Non-user turns never change state and never trigger an action.
  if (!isUserTurn(line)) return "none";

  // User turn: update state to reflect whether THIS turn is /id reset.
  const isReset = isIdResetUserTurn(line);
  state.mostRecentUserTurnIsIdReset = isReset;

  // Decide action from the new state + current changeoverState.
  if (isReset && currentChangeoverState === "active") return "arm_holding";
  if (!isReset && currentChangeoverState === "holding") return "clear_holding";
  return "none";
}

// ── Integration seam: __applyLayer1LineForTests ─────────────────────────────
//
// Mirrors the __applyRepollResultForTests pattern in claude-session-server.ts
// exactly: a pure function that composes the reducer with injectable
// helpers, so vitest can drive the exact code path production onLine will
// use without spinning up a WebSocketServer + ssh2 pair.
//
// Co-located with the reducer (not in claude-session-server.ts) so the
// seam and the production dispatch cannot drift — the seam IS the
// production dispatch, just wrapped for injection.

/** Mutable state box shared between the per-connection closure and the test seam. */
export type __Layer1StateForTests = {
  changeoverState: "active" | "holding" | "dead";
  layer1: Layer1State;
};

/** Helpers injected into the Layer 1 dispatch logic. */
export type __Layer1HelpersForTests = {
  transitionToHolding: (reason: "id_reset" | "discovery_diff") => void;
  transitionFromHoldingToActiveSameFile: () => void;
};

/**
 * Apply one JSONL line through the Layer 1 pipeline: update tail-state
 * via applyLineToLayer1State, then dispatch the returned action to the
 * appropriate helper. Mirrors the production onLine handler's Layer 1
 * block byte-for-byte (modulo the closure vs. injection).
 *
 * Returns immediately if state.changeoverState is "dead" — same
 * idempotent guard as the reducer, kept here so the seam is unambiguous
 * about the dead-terminal invariant.
 *
 * Reads state.changeoverState AT DISPATCH TIME (not at reducer-return
 * time), so if the injected transitionToHolding stub mutates
 * state.changeoverState, subsequent lines correctly see the new value.
 * This matches production: transitionToHolding flips changeoverState to
 * "holding" as its first side effect.
 */
export function __applyLayer1LineForTests(
  line: string,
  state: __Layer1StateForTests,
  helpers: __Layer1HelpersForTests,
): void {
  if (state.changeoverState === "dead") return;
  const action = applyLineToLayer1State(line, state.layer1, state.changeoverState);
  if (action === "arm_holding") {
    helpers.transitionToHolding("id_reset");
  } else if (action === "clear_holding") {
    helpers.transitionFromHoldingToActiveSameFile();
  }
}
