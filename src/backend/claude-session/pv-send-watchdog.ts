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
// Hash-derivation contract (load-bearing):
//   • `contentHash` MUST equal `sha256(content).slice(0, 32)` — content-
//     only, matching Plan 50-01 Task 2's dedup Map key derivation byte-
//     for-byte. If the two drift, watchdogs never notify and every real
//     send escalates through the full timing chain even on the happy
//     path. See 50-01-PLAN.md § objective "Hash-derivation contract".
//   • This module DOES NOT recompute the hash — the caller passes it
//     pre-computed to force the caller to derive it via the same
//     `createHash("sha256").update(body).digest("hex").slice(0, 32)`
//     recipe that lives in claude-session-server.ts's onLine notifyMatched
//     call site AND in Plan 50-01 Task 2's `__applyQueueDedupForTests`.
//
// The seam is a pure module — no per-connection or per-session state
// beyond the module-level `pending` Map. `__resetPvSendWatchdogForTests`
// clears the Map for hermetic unit + integration tests (upstreamed from
// Plan 50-04 per checker Warning #7).
// ─────────────────────────────────────────────────────────────────────────────

/** T+2500ms — retry Enter (per D-13; canonical value chosen from the "T+2-3s" range). */
export const RETRY_ENTER_MS = 2500;
/** T+5500ms from arm — full re-send C-u + body + Enter (per D-14; "T+5-6s"). */
export const FULL_RESEND_MS = 5500;
/** T+20000ms from arm — paste_send_failed escalation (per D-15; "T+~20s"). */
export const GIVE_UP_MS = 20_000;

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
  contentHash: string;
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
}

interface PendingWatchdog {
  sessionId: string;
  contentHash: string;
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

// Module-level Map: mqid → per-watchdog state. Lifetime spans the process; per-
// connection isolation comes from the caller supplying unique mqids per send
// and calling `clearPvSendWatchdog(mqid)` on connection teardown (see Plan 50-
// 02 Task 2's per-connection pendingMqidsForThisConnection Set).
const pending = new Map<string, PendingWatchdog>();

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
 *
 * The caller MUST pre-compute `contentHash = sha256(body).slice(0, 32)`
 * using the exact same derivation as Plan 50-01 Task 2's dedup Map key.
 * The watchdog does NOT recompute — this forces the caller to own the
 * hash-derivation contract (see file header § Hash-derivation contract).
 */
export function armPvSendWatchdog(args: ArmPvSendWatchdogArgs): void {
  const {
    sessionId,
    mqid,
    body,
    contentHash,
    execCommand,
    tmuxTarget,
    wsSend,
  } = args;
  const logger = args.logger ?? sshLogger;

  if (pending.has(mqid)) {
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
    contentHash,
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
    if (!pending.has(mqid)) return;
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
  }, RETRY_ENTER_MS);

  // Stage 2 — T+5500ms full-resend (C-u + literal body + Enter).
  entry.fullResendTimer = setTimeout(() => {
    entry.fullResendTimer = null;
    if (!pending.has(mqid)) return;

    logger.warn(
      "pv-send-watchdog: no signal within 5500ms, firing full re-send",
      {
        operation: "pv_send_watchdog_full_resend",
        mqid,
        sessionId,
        gapMs: Date.now() - entry.armedAt,
      },
    );

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
  }, FULL_RESEND_MS);

  // Stage 3 — T+20000ms give-up + emit paste_send_failed. Same wire shape as
  // the OLD terminal-layer watchdog (deleted in Task 3) for frontend backward compat.
  entry.giveUpTimer = setTimeout(() => {
    entry.giveUpTimer = null;
    if (!pending.has(mqid)) return;

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

    // Watchdog complete — drop from Map.
    cancelTimers(entry);
    pending.delete(mqid);
  }, GIVE_UP_MS);

  pending.set(mqid, entry);

  logger.debug(
    "pv-send-watchdog: armed",
    {
      operation: "pv_send_watchdog_arm",
      mqid,
      sessionId,
      contentHash,
      bodyBytes: body.length,
    },
  );
}

/**
 * Notify the watchdog module that a matching parser signal has arrived.
 * Called from claude-session-server.ts's onLine callback for every
 * kind:"message" role:"user" emission (both the direct-user-turn path
 * and the queue-operation-enqueue path from Plan 50-01).
 *
 * Clears the OLDEST pending watchdog whose (sessionId, contentHash)
 * matches — FIFO semantics for the edge case of the same body sent twice
 * within the 20s window (matches D-07 FIFO backend parity).
 */
export function notifyMatched(sessionId: string, contentHash: string): void {
  for (const [mqid, entry] of pending) {
    if (entry.sessionId === sessionId && entry.contentHash === contentHash) {
      entry.logger.debug(
        "pv-send-watchdog: matched signal — clearing pending",
        {
          operation: "pv_send_watchdog_matched",
          mqid,
          sessionId,
          gapMs: Date.now() - entry.armedAt,
        },
      );
      cancelTimers(entry);
      pending.delete(mqid);
      return; // FIFO: clear only the oldest matching entry.
    }
  }
}

/**
 * Cancel a pending watchdog by mqid. Called from claude-session-server.ts's
 * ws.on("close") handler for every mqid recorded in the per-connection
 * pendingMqidsForThisConnection Set — prevents orphan escalation frames
 * firing against a torn-down WebSocket (T-50-02-06 mitigation).
 */
export function clearPvSendWatchdog(mqid: string): void {
  const entry = pending.get(mqid);
  if (!entry) return;
  entry.logger.debug(
    "pv-send-watchdog: cleared",
    {
      operation: "pv_send_watchdog_clear",
      mqid,
      sessionId: entry.sessionId,
    },
  );
  cancelTimers(entry);
  pending.delete(mqid);
}

/**
 * Test-only reset — clears the entire module-level `pending` Map and cancels
 * every timer. Required by Plan 50-04's integration test beforeEach hook
 * so tests don't leak state across cases (checker Warning #7 upstream).
 *
 * DO NOT call from production code paths.
 */
export function __resetPvSendWatchdogForTests(): void {
  for (const [, entry] of pending) {
    cancelTimers(entry);
  }
  pending.clear();
}
