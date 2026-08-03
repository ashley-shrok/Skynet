import { WebSocket } from "ws";
import type { Client, ClientChannel } from "ssh2";
import { sshLogger } from "../utils/logger.js";
import { sessionManager, type TerminalSession } from "./terminal-session-manager.js";

// Patch (quick 260803-1xw / bounty pv-paste-to-terminal-lands-as-unsent-
// bracket-paste): Ashley's design is to fix at the outcome layer — detect
// stuck PV submits and auto-retry Enter — rather than continue fighting Ink's
// paste-detection state machine at the byte layer (which patches #100/#111/
// #118 kept losing at the next scale of paste body).
//
// This helper is a mechanical extraction of the watchdog-arming block from
// the isPrettyViewSubmit branch in `terminal.ts` so it can be unit-tested
// under `vi.useFakeTimers()` without mounting the full WebSocket dispatcher.
// The call-site inside `terminal.ts` is a single line: `armPvSubmitWatchdog(
// session, submitConn, tmuxTarget, mqid, userId, sessionId)`.
//
// Semantics:
//   - T+2.5s watchdog: snapshot `session.lastActivityAt` at arm-time. If it
//     hasn't advanced by T+2.5s, fire a retry `tmux send-keys ... Enter`
//     over `submitConn.exec` and arm the second watchdog.
//   - T+5.0s watchdog: snapshot `session.lastActivityAt` again at retry-fire
//     time. If it hasn't advanced by T+2.5s from retry (i.e. T+5.0s total),
//     emit `{type:"paste_send_failed", mqid, reason}` on `session.attachedWs`.
//   - Both timers are tracked on `session.pvSubmitWatchdogs` (a Set) so
//     `destroySession` and `detachWs` can cancel them before firing.
//   - Non-tmux fallback path (missing `submitConn` or `tmuxTarget`) arms NO
//     watchdog — the non-tmux branch has its own fallback path and doesn't
//     dispatch via send-keys.
//
// Ashley 2026-08-02: "hitting enter on an otherwise empty box does nothing" —
// the retry is safe even if the initial send actually did land (rare) and the
// user was already typing a follow-up.

const FIRST_WATCHDOG_MS = 2500;
const SECOND_WATCHDOG_MS = 2500;

// Local copy of shell-quoter (kept file-local in terminal.ts as `shellQuote`;
// duplicating a 2-line helper is cheaper than exporting + importing it, and
// keeps the two callsites decoupled). Wraps tmux target in single quotes
// with embedded quote escaping via `'\''` — defense-in-depth against a
// regression in the client-side SESSION_NAME_PATTERN.
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// Minimal subset of the ssh2 Client surface we actually call. Kept as an
// interface rather than importing `Client` directly so tests can pass a
// hand-rolled mock without pulling in the full ssh2 module.
//
// The `exec` callback signature accepts `Error | undefined` for `err` because
// ssh2's own overloads type it as `Error` but always deliver `undefined` on
// success — our runtime guard `if (retryErr || !retryChannel)` covers both.
export interface WatchdogSSHConn {
  exec(
    command: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cb: (err: any, channel: ClientChannel) => void,
  ): boolean | void;
}

export interface ArmPvSubmitWatchdogArgs {
  session: TerminalSession;
  submitConn: WatchdogSSHConn | Client | null | undefined;
  tmuxTarget: string | null | undefined;
  mqid: string;
  userId: string;
  sessionId: string;
}

/**
 * Arm the pair of post-send idle watchdogs for a PV submit. See file header.
 *
 * Returns true if the watchdog pair was armed, false if the call was skipped
 * (non-tmux path or missing conn/target). The boolean is convenient for the
 * non-tmux early-return test T-6.
 */
export function armPvSubmitWatchdog(args: ArmPvSubmitWatchdogArgs): boolean {
  const { session, submitConn, tmuxTarget, mqid, userId, sessionId } = args;

  // Non-tmux fallback path: no target for send-keys, so no retry to fire.
  // Explicit guard for readability + future-refactor safety (the call site's
  // `isPrettyViewSubmit && submitConn && tmuxTarget` guard is redundant with
  // the tmux-only branch we're inside, but a helper that does the wrong
  // thing on the wrong branch is a footgun).
  if (!submitConn || !tmuxTarget) {
    return false;
  }

  const watchdogSession = session;
  const lastActivityAtAtSend = watchdogSession.lastActivityAt;
  const watchdogMqid = mqid;
  const watchdogTarget = tmuxTarget;
  // `submitConn` may be a real ssh2 `Client` or a hand-rolled mock in tests;
  // the retry does not use it directly — it re-reads `session.sshConn` at
  // fire time to guard against sshConn being torn down between arm + fire.

  // T+2.5s: first watchdog. Runs the retry Enter if no activity was seen.
  const firstHandle: NodeJS.Timeout = setTimeout(() => {
    watchdogSession.pvSubmitWatchdogs.delete(firstHandle);

    // Race-guard: session could have been destroyed between arm and fire.
    const s = sessionManager.getSession(sessionId);
    if (!s) return;

    if (s.lastActivityAt > lastActivityAtAtSend) {
      sshLogger.debug(
        "PV submit watchdog: activity within 2.5s, submit succeeded",
        {
          operation: "pv_submit_watchdog_ok",
          userId,
          mqid: watchdogMqid,
          sessionId,
          gapMs: Date.now() - lastActivityAtAtSend,
        },
      );
      return;
    }

    sshLogger.warn(
      "PV submit watchdog: no activity within 2.5s, firing retry Enter",
      {
        operation: "pv_submit_watchdog_retry",
        userId,
        mqid: watchdogMqid,
        sessionId,
        gapMs: Date.now() - lastActivityAtAtSend,
      },
    );

    // Retry: same shape as the initial isPrettyViewSubmit send-keys call.
    const retryConn = (s.sshConn as unknown as WatchdogSSHConn | null) ?? null;
    if (!retryConn) {
      sshLogger.warn(
        "PV submit watchdog: sshConn gone before retry could fire",
        {
          operation: "pv_submit_watchdog_retry_no_conn",
          userId,
          mqid: watchdogMqid,
          sessionId,
        },
      );
      return;
    }
    try {
      retryConn.exec(
        `tmux send-keys -t ${shellQuote(watchdogTarget)} Enter`,
        (retryErr, retryChannel) => {
          if (retryErr || !retryChannel) {
            sshLogger.error(
              "PV submit watchdog: retry exec_open_failed",
              retryErr,
              {
                operation: "pv_submit_watchdog_retry_failed",
                userId,
                mqid: watchdogMqid,
              },
            );
            return;
          }
          // tmux send-keys writes nothing on success. Drain + drop.
          retryChannel.on("data", () => {});
          retryChannel.stderr?.on("data", () => {});
          retryChannel.on("close", () => {
            try {
              retryChannel.end();
            } catch {
              /* already closed */
            }
          });
          retryChannel.on("error", (e: Error) =>
            sshLogger.error(
              "PV submit watchdog: retry channel error",
              e,
              {
                operation: "pv_submit_watchdog_retry_channel_error",
                userId,
                mqid: watchdogMqid,
              },
            ),
          );
        },
      );
    } catch (e) {
      sshLogger.error(
        "PV submit watchdog: retry sync throw",
        e instanceof Error ? e : new Error(String(e)),
        {
          operation: "pv_submit_watchdog_retry_sync_throw",
          userId,
          mqid: watchdogMqid,
        },
      );
      return;
    }

    // Snapshot again for the second watchdog. Read `s.lastActivityAt`
    // (not the stale `lastActivityAtAtSend`) so if activity DID arrive
    // between the arm-fire boundary but was consumed by us reading a
    // stale snapshot, the second watchdog gives the retry Enter a fair
    // chance to produce its own new activity before escalating.
    const lastActivityAtAtRetry = s.lastActivityAt;

    // T+5.0s (from initial send): second watchdog. Escalates on stagnation.
    const secondHandle: NodeJS.Timeout = setTimeout(() => {
      s.pvSubmitWatchdogs.delete(secondHandle);

      const s2 = sessionManager.getSession(sessionId);
      if (!s2) return;

      if (s2.lastActivityAt > lastActivityAtAtRetry) {
        sshLogger.info("PV submit watchdog: retry succeeded", {
          operation: "pv_submit_watchdog_retry_ok",
          userId,
          mqid: watchdogMqid,
          sessionId,
        });
        return;
      }

      sshLogger.error(
        "PV submit watchdog: retry also failed — surfacing to frontend",
        undefined,
        {
          operation: "pv_submit_watchdog_escalate",
          userId,
          mqid: watchdogMqid,
          sessionId,
        },
      );

      if (s2.attachedWs?.readyState === WebSocket.OPEN) {
        try {
          s2.attachedWs.send(
            JSON.stringify({
              type: "paste_send_failed",
              mqid: watchdogMqid,
              reason: "no_activity_after_2_retries",
            }),
          );
        } catch (wsErr) {
          sshLogger.error(
            "PV submit watchdog: WS send failed",
            wsErr instanceof Error ? wsErr : new Error(String(wsErr)),
            {
              operation: "pv_submit_watchdog_ws_send_failed",
              userId,
              mqid: watchdogMqid,
            },
          );
        }
      }
    }, SECOND_WATCHDOG_MS);
    s.pvSubmitWatchdogs.add(secondHandle);
  }, FIRST_WATCHDOG_MS);

  watchdogSession.pvSubmitWatchdogs.add(firstHandle);
  return true;
}
