import { sshLogger } from "../utils/logger.js";

// ─── Phase 50 Plan 02 Task 1 — signal-driven send-path watchdog ─────────────
//
// Replaces the PTY-activity-proxy watchdog formerly at src/backend/ssh/
// (patch quick 260803-1xw, deleted in Phase 50 Plan 02 Task 3). The old watchdog snapshot
// `session.lastActivityAt` at arm time and used pane byte-activity as a
// PROXY for "the Enter landed" — a noisy signal that mis-fires on unrelated
// pane output. This new watchdog fires only on the ABSENCE of the specific
// parser signal Plan 50-01 introduced (kind:"message" role:"user" for either
// the direct-user-turn path OR the queue-operation-enqueue path). Same
// three-stage escalation shape (retry Enter → full re-send → give-up-and-
// emit-frame) with a specific-signal trigger.
//
// Timing chain (from arm time T=0):
//   • T+2500ms → retry Enter (`tmux send-keys -t <target> Enter`) — safe
//                no-op if the initial Enter DID land (Claude ignores empty-
//                input Enter per D-16).
//   • T+5500ms → full re-send: `tmux send-keys -t <target> C-u` to clear
//                the harness composebox, then a literal-flag write with
//                `-l` to retype the body, then `tmux send-keys -t
//                <target> Enter` to submit. Scoped to the harness compose-
//                box only (D-17); does NOT touch Skynet's own compose UI.
//   • T+20000ms → emit `{type:'paste_send_failed', mqid, reason}` on the
//                claude-session WS. Frontend consumers see the same wire
//                shape as the OLD watchdog for backward compatibility
//                (matches the OLD terminal-layer watchdog wire shape).
//
// Invariants (checker-enforced):
//   • Retry Enter fires AT MOST ONCE per pending send (Fleet directive +
//     D-06 discretion note). Tracked via per-mqid `retryFired` flag.
//   • Second `armPvSendWatchdog` with the same mqid while one is pending
//     is a no-op — guard against cascading retry loops.
//   • Full-resend body write goes through `shellQuote` — the `-l` literal
//     flag makes tmux treat the bytes as raw input to the pane, but the
//     surrounding shell command still needs quoting to prevent metachar
//     escapes at the SSH exec layer (T-50-02-01 mitigation).
//
// Match primitive (quick-260908-bqx):
//   • notifyMatched(sessionId) pops the OLDEST pending watchdog on the
//     given session — FIFO head-pop, matching the frontend order-based
//     semantic at PrettyView.tsx:1961-1979 (quick-260823-fzy). CC processes
//     input serially, JSONL is written in order, WS preserves order —
//     SEND ORDER is the match signal.
//
// The seam is a pure module — no per-connection or per-session state
// beyond the module-level `pendingByMqid` + `fifoBySession` maps.
// `__resetPvSendWatchdogForTests` clears both maps for hermetic unit +
// integration tests (upstreamed from Plan 50-04 per checker Warning #7).
// ─────────────────────────────────────────────────────────────────────────────

/** T+2500ms — retry Enter (per D-13; canonical value chosen from the "T+2-3s" range). */
export const RETRY_ENTER_MS = 2500;
/** T+5500ms from arm — full re-send C-u + body + Enter (per D-14; "T+5-6s"). */
export const FULL_RESEND_MS = 5500;
/** T+20000ms from arm — paste_send_failed escalation (per D-15; "T+~20s"). */
export const GIVE_UP_MS = 20_000;

// ─── Phase 56 Plan 02 — widened window for dormant-triggered sends ──────────
//
// When a send is dispatched while the pane is dormant (Plan 01's send-while-
// dormant branch in claude-session-server.ts fires), the send-path first drops
// the .dormant sentinel, waits up to MARKER_FALLBACK_MS (90_000ms) for the
// harness's .resume-complete marker, THEN dispatches send-keys. The watchdog
// arms at that send-keys moment — but if we used the normal 20_000ms give-up
// window, a healthy ~90-second wake would trip paste_send_failed even though
// the send is landing correctly. Widen the timing chain: retry-Enter still
// fires at ~T+2500ms (bare Enter is harmless per D-16), but full-resend and
// give-up push out past the marker window.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors MARKER_FALLBACK_MS at claude-session-server.ts:773 — MUST stay in sync.
 * The two files cannot import each other (circular), so this file re-declares
 * the constant with a header comment. Test WW-5 in pv-send-watchdog.test.ts
 * reads both files and asserts they match to guard against drift.
 */
export const MARKER_FALLBACK_MS_MIRROR = 90_000;

/**
 * Phase 56: retry-Enter timing for dormant-triggered sends. Pushed out past
 * the marker-wait window so the retry Enter fires AFTER the send-path's own
 * marker wait would have completed. = 92_500ms.
 */
export const RETRY_ENTER_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + RETRY_ENTER_MS;

/** Phase 56: full-resend timing for dormant-triggered sends. = 95_500ms. */
export const FULL_RESEND_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + FULL_RESEND_MS;

/**
 * Phase 56: give-up window for dormant-triggered sends. MARKER_FALLBACK_MS
 * (90s) + normal GIVE_UP_MS (20s) + 10s buffer = 120_000ms — comfortable
 * margin above a healthy ~90s wake.
 */
export const GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000;

/**
 * Wrap a string in single quotes and escape embedded single quotes via the
 * shell-standard `'\''` sequence. Byte-identical to the shellQuote helper in
 * src/backend/ssh/terminal.ts L123 and the OLD terminal-layer watchdog module
 * (deleted in Phase 50 Plan 02 Task 3). Defense-in-depth against a
 * regression in the client-side SESSION_NAME_PATTERN — T-50-02-01 mitigation.
 */
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;

/** Minimal ws-send signature — accepts the wire-frame object; caller stringifies + guards ws.readyState. */
export type WsSendCallback = (frame: object) => void;
/** Minimal exec-command signature — matches claude-session-server.ts's `execCommand` shape modulo the conn param, which is captured in the caller's closure. */
export type ExecCommand = (cmd: string) => Promise<string>;

export interface ArmPvSendWatchdogArgs {
  sessionId: string;
  mqid: string;
  body: string;
  execCommand: ExecCommand;
  tmuxTarget: string;
  wsSend: WsSendCallback;
  /** Optional custom logger; falls back to sshLogger. Kept for test injection. */
  logger?: {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => void;
  };
  /**
   * When true, schedule ONLY Stage 1 (retry Enter at T+2500ms) — do NOT
   * schedule Stage 2 (full-resend) or Stage 3 (give-up + paste_send_failed).
   *
   * Purpose: the non-split-path safety net. When the frontend's mqid is lost
   * somewhere in the WS chain and the backend takes the non-split path
   * (`send-keys -l <body>\r`), the literal `\r` inside the bracketed-paste
   * wrapper lands as a newline in the harness composer instead of submitting.
   * A bare Enter at T+2500ms recovers this — safe by D-16 (Claude ignores
   * empty-input Enter). But the full-resend (C-u + retype + Enter) is NOT
   * safe here: if the retry Enter submitted the message but the tail-watcher
   * emitted a slightly different content string (e.g. trailing newline
   * differences), notifyMatched wouldn't clear this pending → full-resend
   * fires → re-types + submits AGAIN → double-submit. The
   * paste_send_failed frame is also useless here because the frontend's
   * PendingSend has a different mqid (frontend generated its own; this
   * watchdog was armed with a synthetic backend-side mqid).
   *
   * When absent/false, the full three-stage escalation runs as documented
   * in the file header. (2026-08-21, tina — added after diagnosing that
   * ~2/6 sends this session went through the non-split path due to mqid loss,
   * and the existing three-stage watchdog wasn't armed on that branch.)
   */
  retryEnterOnly?: boolean;
  /**
   * Phase 56: when true, use widened timing constants
   * (RETRY_ENTER_MS_DORMANT / FULL_RESEND_MS_DORMANT / GIVE_UP_MS_DORMANT)
   * so a healthy ~90-second invisible wake (send-path drops sentinel + waits
   * for .resume-complete, then dispatches send-keys) doesn't trip the
   * paste_send_failed red-bubble. Orthogonal to retryEnterOnly — the two
   * flags can coexist; if both are true, only retry-Enter is scheduled but
   * at the widened T+92500ms cadence.
   *
   * Set by claude-session-server.ts's __applyInputMessageForTests dormant
   * branch based on the value of `dormantLastEmitted` at input-handler entry
   * — NEVER from a WS payload field (see T-56-02-01).
   */
  dormantSend?: boolean;
}

interface PendingWatchdog {
  sessionId: string;
  body: string;
  tmuxTarget: string;
  execCommand: ExecCommand;
  wsSend: WsSendCallback;
  logger: NonNullable<ArmPvSendWatchdogArgs["logger"]>;
  retryTimer: NodeJS.Timeout | null;
  fullResendTimer: NodeJS.Timeout | null;
  giveUpTimer: NodeJS.Timeout | null;
  retryFired: boolean;
  armedAt: number;
}

// Two-map structure for O(1) cancel-by-mqid and FIFO head-pop by sessionId.
//
// pendingByMqid — mqid → per-watchdog state. Lets clearPvSendWatchdog and
//   the internal timer-guard reads stay O(1). Lifetime spans the process;
//   per-connection isolation comes from the caller supplying unique mqids per
//   send and calling `clearPvSendWatchdog(mqid)` on connection teardown (see
//   Plan 50-02 Task 2's per-connection pendingMqidsForThisConnection Set).
//
// fifoBySession — sessionId → ordered list of live mqids. notifyMatched
//   shifts the head off to cancel the OLDEST pending arm on that session.
//   Push at arm time, shift at notify, splice at explicit cancel. Queue depth
//   is bounded by concurrent in-flight sends per pane (single-digit in
//   practice) so O(n) splice on explicit cancel is fine.
const pendingByMqid = new Map<string, PendingWatchdog>();
const fifoBySession = new Map<string, string[]>();

function cancelTimers(entry: PendingWatchdog): void {
  if (entry.retryTimer !== null) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
  if (entry.fullResendTimer !== null) {
    clearTimeout(entry.fullResendTimer);
    entry.fullResendTimer = null;
  }
  if (entry.giveUpTimer !== null) {
    clearTimeout(entry.giveUpTimer);
    entry.giveUpTimer = null;
  }
}

/**
 * Arm the three-stage timer chain for a pretty-view compose-send.
 *
 * Idempotent per mqid: a second `armPvSendWatchdog` with the same mqid
 * while one is pending is a no-op (logged at debug + returned early). This
 * guards against cascading retry loops per Fleet directive.
 */
export function armPvSendWatchdog(args: ArmPvSendWatchdogArgs): void {
  const {
    sessionId,
    mqid,
    body,
    execCommand,
    tmuxTarget,
    wsSend,
  } = args;
  const logger = args.logger ?? sshLogger;

  // Phase 56 Plan 02 — widened window when the send was dispatched during
  // pane dormancy. Compute local timing values once so the three setTimeout
  // sites below pick the right cadence uniformly. Orthogonal to
  // retryEnterOnly (both can be true; only retry-Enter is scheduled but at
  // the widened T+92500ms cadence).
  const retryDelay = args.dormantSend ? RETRY_ENTER_MS_DORMANT : RETRY_ENTER_MS;
  const fullResendDelay = args.dormantSend ? FULL_RESEND_MS_DORMANT : FULL_RESEND_MS;
  const giveUpDelay = args.dormantSend ? GIVE_UP_MS_DORMANT : GIVE_UP_MS;

  if (pendingByMqid.has(mqid)) {
    logger.debug(
      "pv-send-watchdog: arm ignored — mqid already pending",
      {
        operation: "pv_send_watchdog_arm_dup",
        mqid,
        sessionId,
      },
    );
    return;
  }

  const entry: PendingWatchdog = {
    sessionId,
    body,
    tmuxTarget,
    execCommand,
    wsSend,
    logger,
    retryTimer: null,
    fullResendTimer: null,
    giveUpTimer: null,
    retryFired: false,
    armedAt: Date.now(),
  };

  // Stage 1 — T+2500ms retry Enter. Fires AT MOST ONCE per pending send.
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    // Guard: if we've been cleared / notified between schedule and fire, bail.
    if (!pendingByMqid.has(mqid)) return;
    if (entry.retryFired) return;
    entry.retryFired = true;

    logger.warn(
      "pv-send-watchdog: no signal within 2500ms, firing retry Enter",
      {
        operation: "pv_send_watchdog_retry",
        mqid,
        sessionId,
        gapMs: Date.now() - entry.armedAt,
      },
    );
    logger.info("[diag-dormant-send] watchdog-fire-retry-enter", { operation: "diag_dormant_watchdog_retry", mqid, sessionId, elapsedMs: Date.now() - entry.armedAt });

    const cmd = `tmux send-keys -t ${shellQuote(tmuxTarget)} Enter`;
    // Fire-and-forget; do not block downstream timers on this promise.
    void execCommand(cmd).catch((err) => {
      logger.error(
        "pv-send-watchdog: retry Enter exec failed",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "pv_send_watchdog_retry_exec_failed",
          mqid,
          sessionId,
        },
      );
      // Do NOT re-throw or cancel timers — escalation continues per D-15.
    });
  }, retryDelay);

  // Retry-Enter-only mode: skip Stages 2 + 3 for the non-split-path safety
  // net (see ArmPvSendWatchdogArgs.retryEnterOnly for rationale).
  if (args.retryEnterOnly) {
    pendingByMqid.set(mqid, entry);
    const list = fifoBySession.get(sessionId) ?? [];
    list.push(mqid);
    fifoBySession.set(sessionId, list);
    logger.debug("pv-send-watchdog: armed (retry-Enter-only)", {
      operation: "pv_send_watchdog_arm_retry_only",
      mqid,
      sessionId,
      matched_by: "fifo",
      bodyBytes: body.length,
      dormantSend: args.dormantSend === true,
    });
    logger.info("[diag-dormant-send] watchdog-arm-complete", { operation: "diag_dormant_watchdog_arm", mqid, sessionId, matched_by: "fifo", bodyBytes: body.length, dormantSend: args.dormantSend === true, retryEnterOnly: true, retryDelayMs: retryDelay, fullResendDelayMs: null, giveUpDelayMs: null });
    return;
  }

  // Stage 2 — T+5500ms full-resend (C-u + literal body + Enter).
  entry.fullResendTimer = setTimeout(() => {
    entry.fullResendTimer = null;
    if (!pendingByMqid.has(mqid)) return;

    logger.warn(
      "pv-send-watchdog: no signal within 5500ms, firing full re-send",
      {
        operation: "pv_send_watchdog_full_resend",
        mqid,
        sessionId,
        gapMs: Date.now() - entry.armedAt,
      },
    );
    logger.info("[diag-dormant-send] watchdog-fire-full-resend", { operation: "diag_dormant_watchdog_full_resend", mqid, sessionId, elapsedMs: Date.now() - entry.armedAt });

    void (async () => {
      const clearCmd = `tmux send-keys -t ${shellQuote(tmuxTarget)} C-u`;
      const bodyCmd = `tmux send-keys -l -t ${shellQuote(tmuxTarget)} ${shellQuote(body)}`;
      const enterCmd = `tmux send-keys -t ${shellQuote(tmuxTarget)} Enter`;

      // Each step wrapped in its own try/catch — one failing must NOT abort
      // the next. Log-and-continue posture matches D-15's "give the retry a
      // fair chance to produce its own signal" invariant.
      try {
        await execCommand(clearCmd);
      } catch (err) {
        logger.error(
          "pv-send-watchdog: full-resend C-u exec failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "pv_send_watchdog_full_resend_clear_failed",
            mqid,
            sessionId,
          },
        );
      }
      try {
        await execCommand(bodyCmd);
      } catch (err) {
        logger.error(
          "pv-send-watchdog: full-resend body exec failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "pv_send_watchdog_full_resend_body_failed",
            mqid,
            sessionId,
          },
        );
      }
      try {
        await execCommand(enterCmd);
      } catch (err) {
        logger.error(
          "pv-send-watchdog: full-resend Enter exec failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "pv_send_watchdog_full_resend_enter_failed",
            mqid,
            sessionId,
          },
        );
      }
    })();
  }, fullResendDelay);

  // Stage 3 — T+20000ms give-up + emit paste_send_failed. Same wire shape as
  // the OLD terminal-layer watchdog (deleted in Task 3) for frontend backward compat.
  entry.giveUpTimer = setTimeout(() => {
    entry.giveUpTimer = null;
    if (!pendingByMqid.has(mqid)) return;

    logger.error(
      "pv-send-watchdog: no signal within 20000ms — emitting paste_send_failed",
      undefined,
      {
        operation: "pv_send_watchdog_escalate",
        mqid,
        sessionId,
        gapMs: Date.now() - entry.armedAt,
      },
    );
    logger.info("[diag-dormant-send] watchdog-fire-give-up", { operation: "diag_dormant_watchdog_give_up", mqid, sessionId, elapsedMs: Date.now() - entry.armedAt, branch: "paste_send_failed_emitted" });

    try {
      wsSend({
        type: "paste_send_failed",
        mqid,
        reason: "no_signal_after_full_resend",
      });
    } catch (err) {
      logger.error(
        "pv-send-watchdog: wsSend threw during escalation",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "pv_send_watchdog_ws_send_failed",
          mqid,
          sessionId,
        },
      );
    }

    // Watchdog complete — drop from both maps.
    cancelTimers(entry);
    pendingByMqid.delete(mqid);
    const giveUpList = fifoBySession.get(sessionId);
    if (giveUpList) {
      const giveUpIdx = giveUpList.indexOf(mqid);
      if (giveUpIdx !== -1) giveUpList.splice(giveUpIdx, 1);
      if (giveUpList.length === 0) fifoBySession.delete(sessionId);
    }
  }, giveUpDelay);

  pendingByMqid.set(mqid, entry);
  const list = fifoBySession.get(sessionId) ?? [];
  list.push(mqid);
  fifoBySession.set(sessionId, list);

  logger.debug(
    "pv-send-watchdog: armed",
    {
      operation: "pv_send_watchdog_arm",
      mqid,
      sessionId,
      matched_by: "fifo",
      bodyBytes: body.length,
      dormantSend: args.dormantSend === true,
    },
  );
  logger.info("[diag-dormant-send] watchdog-arm-complete", { operation: "diag_dormant_watchdog_arm", mqid, sessionId, matched_by: "fifo", bodyBytes: body.length, dormantSend: args.dormantSend === true, retryEnterOnly: args.retryEnterOnly === true, retryDelayMs: retryDelay, fullResendDelayMs: args.retryEnterOnly ? null : fullResendDelay, giveUpDelayMs: args.retryEnterOnly ? null : giveUpDelay });
}

/**
 * Clears the OLDEST pending watchdog on the given sessionId — FIFO head-pop.
 * Matches the frontend order-based semantic at PrettyView.tsx:1961-1979
 * (quick-260823-fzy). Same reasoning: CC processes input serially, JSONL is
 * written in order, WS preserves order — SEND ORDER is the match signal.
 *
 * Called from claude-session-server.ts's onLine callback for every
 * kind:"message" role:"user" emission (both the direct-user-turn path
 * and the queue-operation-enqueue path from Plan 50-01).
 *
 * notifyMatched on a sessionId with no pending arms is a silent no-op.
 * notifyMatched on sess-A does NOT touch pending arms on sess-B.
 */
export function notifyMatched(sessionId: string): void {
  const list = fifoBySession.get(sessionId);
  if (!list || list.length === 0) return;

  const headMqid = list.shift()!;
  if (list.length === 0) fifoBySession.delete(sessionId);

  const entry = pendingByMqid.get(headMqid);
  if (!entry) return; // defensive — should not happen

  entry.logger.debug(
    "pv-send-watchdog: matched signal — clearing pending",
    {
      operation: "pv_send_watchdog_matched",
      mqid: headMqid,
      sessionId,
      gapMs: Date.now() - entry.armedAt,
    },
  );
  entry.logger.info("[diag-dormant-send] watchdog-matched", { operation: "diag_dormant_watchdog_matched", mqid: headMqid, sessionId, elapsedMs: Date.now() - entry.armedAt, matched_by: "fifo_head" });
  cancelTimers(entry);
  pendingByMqid.delete(headMqid);
}

/**
 * Cancel a pending watchdog by mqid. Called from claude-session-server.ts's
 * ws.on("close") handler for every mqid recorded in the per-connection
 * pendingMqidsForThisConnection Set — prevents orphan escalation frames
 * firing against a torn-down WebSocket (T-50-02-06 mitigation).
 */
export function clearPvSendWatchdog(mqid: string): void {
  const entry = pendingByMqid.get(mqid);
  if (!entry) return;
  entry.logger.debug(
    "pv-send-watchdog: cleared",
    {
      operation: "pv_send_watchdog_clear",
      mqid,
      sessionId: entry.sessionId,
    },
  );
  entry.logger.info("[diag-dormant-send] watchdog-cleared", { operation: "diag_dormant_watchdog_cleared", mqid, sessionId: entry.sessionId, elapsedMs: Date.now() - entry.armedAt, reason: "explicit_clear_or_ws_close" });
  cancelTimers(entry);
  pendingByMqid.delete(mqid);
  const list = fifoBySession.get(entry.sessionId);
  if (list) {
    const idx = list.indexOf(mqid);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) fifoBySession.delete(entry.sessionId);
  }
}

/**
 * Fix #2 (post-Phase-50 code review): clear every pending watchdog whose
 * sessionId matches. Called from claude-session-server.ts's
 * transitionToActiveNew when a session recycles.
 *
 * DISTINCT from `__resetPvSendWatchdogForTests` (which clears the ENTIRE
 * module-level pending maps — hermetic-test-only) and from
 * `clearPvSendWatchdog(mqid)` (which clears exactly one by mqid).
 *
 * Rationale: without this, a watchdog armed against the OLD session can
 * fire its full-resend stage AFTER the session recycled — retyping the
 * OLD body into the NEW Claude session's composebox. That directly
 * violates the shape invariant "retry never submits an unintended
 * message" and can leak private OLD-session content into a NEW session
 * whose transcript is being replayed via `tail -F -n +1`.
 *
 * Returns the number of watchdogs cleared. The caller uses this to
 * decide whether to also scrub the per-connection
 * pendingMqidsForThisConnection Set (see transitionToActiveNew).
 */
export function clearPvSendWatchdogsForSession(sessionId: string): string[] {
  const clearedMqids: string[] = [];
  for (const [mqid, entry] of pendingByMqid) {
    if (entry.sessionId === sessionId) {
      entry.logger.debug(
        "pv-send-watchdog: cleared (session recycle)",
        {
          operation: "pv_send_watchdog_clear_session",
          mqid,
          sessionId: entry.sessionId,
        },
      );
      entry.logger.info("[diag-dormant-send] watchdog-cleared", { operation: "diag_dormant_watchdog_cleared", mqid, sessionId: entry.sessionId, elapsedMs: Date.now() - entry.armedAt, reason: "session_recycle" });
      cancelTimers(entry);
      clearedMqids.push(mqid);
    }
  }
  for (const mqid of clearedMqids) {
    pendingByMqid.delete(mqid);
  }
  fifoBySession.delete(sessionId);
  return clearedMqids;
}

/**
 * Test-only reset — clears the entire module-level pending maps and cancels
 * every timer. Required by Plan 50-04's integration test beforeEach hook
 * so tests don't leak state across cases (checker Warning #7 upstream).
 *
 * DO NOT call from production code paths.
 */
export function __resetPvSendWatchdogForTests(): void {
  for (const [, entry] of pendingByMqid) {
    cancelTimers(entry);
  }
  pendingByMqid.clear();
  fifoBySession.clear();
}
