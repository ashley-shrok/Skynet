/**
 * Sentinel-present recycle detector — third arm signal for the
 * SessionHoldingOverlay alongside Layer 1 (/id reset in JSONL) and
 * Layer 2 (discovery-repoll sees a changed session file).
 *
 * WHY THIS EXISTS (Ashley 2026-08-18):
 *
 * The pre-existing arm signals only cover the case where the agent
 * itself runs `/id reset` (Layer 1 sees it in the JSONL) or the
 * session file swap has already happened (Layer 2). Neither catches
 * the window between "agent drops the `.recycle-requested` sentinel"
 * and "supervisor tears down the claude process". During that window
 * the pane still looks active to Skynet, but a recycle is IMMINENT —
 * the agent-supervisor's next reconcile tick will kill claude.
 *
 * The sentinel path is `~/.claude/identities/<name>/.recycle-requested`
 * on the box where the agent is running. Presence = "recycle in flight"
 * from the agent's or supervisor's perspective; the overlay should
 * mirror that state.
 *
 * All helpers here are PURE (no I/O, no imports from ssh2 / WebSocket /
 * logger / anything I/O-shaped) — same architecture rules as
 * layer1-detect.ts. This keeps them cheap to unit-test at
 * sentinel-detect.test.ts granularity; the integration seam
 * __applySentinelCheckForTests below composes them into the exact
 * shape the production context-pct tick uses, so the two cannot drift.
 */

// ── Command builder ─────────────────────────────────────────────────────────

/**
 * Build the SSH exec command that probes the sentinel. Emits `yes` on stdout
 * when the file is present, `no` otherwise. Same output shape as the
 * `.dormant` sentinel probe at claude-session-server.ts:1536, so the
 * response parser (`isSentinelPresent` below) matches that byte-shape.
 *
 * `identityName` is single-quote-wrapped when interpolated — the caller is
 * responsible for having validated the name to a shell-safe subset
 * (tmux session names are validated at frontend `sanitizeTmuxSessionName`
 * to alphanumeric + dash + underscore, same subset accepted here).
 */
export function buildSentinelCheckCommand(identityName: string): string {
  return `test -f ~/.claude/identities/'${identityName}'/.recycle-requested 2>/dev/null && echo yes || echo no`;
}

// ── Pure predicates ────────────────────────────────────────────────────────

/**
 * True iff the SSH exec output indicates the sentinel is present.
 * Matches `buildSentinelCheckCommand`'s output byte-shape verbatim.
 * Any other output (SSH error, unexpected shell state, empty line) →
 * false, so a transient probe failure never spuriously arms the overlay.
 */
export function isSentinelPresent(execOutput: string): boolean {
  return execOutput.trim() === "yes";
}

// ── State reducer ──────────────────────────────────────────────────────────

/** ChangeoverState mirror — kept as a plain string union rather than
 * importing from claude-session-server.ts to preserve the "no I/O
 * imports" property of this helper module. Caller ensures the two
 * unions stay in sync (compile-time-checked at the call site because
 * the argument type matches the closure-scoped `changeoverState`). */
type ChangeoverState = "active" | "holding" | "dead";

/** Decision returned by the reducer. Caller MUST call the appropriate
 * transition helper for `"arm_holding"` — the reducer itself does not
 * fire side effects. */
export type SentinelAction = "none" | "arm_holding";

/**
 * Decide whether to arm the SessionHoldingOverlay from a sentinel probe.
 *
 * Rules:
 *   - sentinel present + changeoverState === "active"  → "arm_holding"
 *   - sentinel present + changeoverState === "holding" → "none"
 *       (already armed; transitionToHolding is idempotent but no point calling)
 *   - sentinel present + changeoverState === "dead"    → "none"
 *       (terminal; never arm)
 *   - sentinel absent                                  → "none"
 *       (we do NOT clear on disappearance — the clear path is
 *        transitionToActiveNew when the new session file appears,
 *        matching id_reset semantics; if the sentinel disappears
 *        without a real recycle, the 45s holding timeout catches it)
 */
export function decideSentinelAction(
  sentinelPresent: boolean,
  currentChangeoverState: ChangeoverState,
): SentinelAction {
  if (!sentinelPresent) return "none";
  if (currentChangeoverState !== "active") return "none";
  return "arm_holding";
}

// ── Integration seam: __applySentinelCheckForTests ─────────────────────────
//
// Mirrors __applyLayer1LineForTests / __applyDormantPollWithRediscoveryForTests
// pattern: a pure function that composes the probe + reducer with injectable
// helpers, so vitest can drive the exact code path the production tick will
// use without spinning up a WebSocketServer + ssh2 pair.
//
// Co-located with the reducer (not in claude-session-server.ts) so the
// seam and the production dispatch cannot drift — the seam IS the
// production dispatch, just wrapped for injection.

/** Mutable state box shared between the per-connection closure and the seam. */
export type __SentinelStateForTests = {
  changeoverState: ChangeoverState;
};

/** Helpers injected into the sentinel-check dispatch logic. */
export type __SentinelHelpersForTests = {
  transitionToHolding: (reason: "sentinel") => void;
};

/**
 * Run one sentinel probe + dispatch. Returns immediately if
 * state.changeoverState is "dead" or "holding" (no need to probe — no
 * action would fire regardless), saving the SSH round-trip.
 *
 * Catches SSH errors silently — same posture as
 * __applyDormantPollWithRediscoveryForTests. A transient probe failure
 * never spuriously arms the overlay because the catch skips this tick
 * entirely; the next tick re-probes.
 */
export async function __applySentinelCheckForTests(
  deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connSnapshot: any;
    identityName: string;
    execCommand: (conn: unknown, cmd: string) => Promise<string>;
  },
  state: __SentinelStateForTests,
  helpers: __SentinelHelpersForTests,
): Promise<void> {
  if (state.changeoverState !== "active") return;
  try {
    const output = await deps.execCommand(
      deps.connSnapshot,
      buildSentinelCheckCommand(deps.identityName),
    );
    const present = isSentinelPresent(output);
    const action = decideSentinelAction(present, state.changeoverState);
    if (action === "arm_holding") {
      helpers.transitionToHolding("sentinel");
    }
  } catch {
    // SSH error — skip this tick silently. Next tick re-probes.
  }
}
