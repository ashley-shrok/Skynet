import type { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

/**
 * Follow a remote JSONL session file forward over an SSH exec channel, invoking
 * `onLine` for every complete newline-terminated line as it lands.
 *
 * Three design choices worth naming:
 *
 * 1. `tail -F` from line 1 over polling. Claude Code writes lines incrementally to
 *    the JSONL as the conversation progresses, and rotates the file on
 *    session boundaries. Polling the whole file wastes bandwidth on backfill
 *    and racy against rotation. `tail -F` (capital) follows across
 *    truncation/renaming; `-n +1` starts the read at line 1 so we deliver
 *    the current conversation from the top before switching to live-follow.
 *    Together these satisfy BACKEND-03 ("read from the beginning, then keep
 *    emitting").
 *
 * 2. Newline-buffered. JSONL frames can span multiple TCP data chunks; we
 *    accumulate the partial tail in a closure buffer and only surface a line
 *    once its trailing `\n` arrives. Downstream parsing (parseSessionLine)
 *    trims whitespace, so we deliberately do NOT strip `\r` here — that's
 *    parse-layer responsibility.
 *
 * 3. POSIX `sh -c` trap wrapper + signal-then-close teardown. OpenSSH does
 *    NOT propagate `SSH_MSG_CHANNEL_CLOSE` as SIGHUP to the remote child
 *    (see mindrot #1424); `tail -F`'s stdout writes silently `EPIPE` and it
 *    keeps running as a PPID=1 orphan across every WS reconnect. Two-prong
 *    fix, both required:
 *      - Remote command is wrapped in `sh -c 'trap "kill $t 2>/dev/null"
 *        EXIT INT HUP TERM; tail -F -n +1 <path> & t=$!; wait $t'` so the
 *        parent shell's exit (via SIGHUP on channel close, or via any other
 *        signal) fires the trap and kills the backgrounded tail regardless
 *        of what the server did or did not propagate.
 *      - stop() calls `stream.signal("TERM")` BEFORE `stream.close()`.
 *        OpenSSH ignores channel-signal requests but Tailscale SSH and
 *        others honor them — free fast-teardown where supported, no cost
 *        where ignored. A synchronous throw from signal() is caught and
 *        logged; close() still runs.
 */

// Copied locally rather than exporting from tmux-helper.ts to keep tmux-helper's
// public surface minimal. Same 3-line implementation.
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export type TailHandle = { stop: () => void };

const STDERR_ACCUMULATION_LIMIT_BYTES = 4096;

export function tailSessionFile(
  conn: Client,
  absolutePath: string,
  onLine: (line: string) => void,
  onError: (err: Error) => void,
): TailHandle {
  let stopped = false;
  // The ssh2 ClientChannel type is not re-exported at this level; we retain
  // the loose reference so the stop() helper can call close/signal
  // without pulling ClientChannel into this file's public surface.
  let stream: {
    close?: () => void;
    signal?: (signal: string) => void;
  } | null = null;
  let buffer = "";
  let stderrBuf = "";
  let anyStdout = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    sshLogger.info(
      `[session-file-tail] stop: closing channel + signaling remote path=${absolutePath} anyStdout=${anyStdout}`,
      { operation: "session_file_tail_stop" },
    );
    if (!stream) return;
    try {
      // Prong A: try channel-signal TERM first. OpenSSH ignores this;
      // Tailscale SSH and other servers honor it. Free fast teardown
      // where supported, harmless where not. A synchronous throw here
      // MUST NOT skip close() — the trap wrapper (Prong B) still needs
      // the channel to actually close so the remote shell exits and
      // fires its EXIT trap.
      try {
        stream.signal?.("TERM");
      } catch (sigErr) {
        sshLogger.info(
          `[session-file-tail] signal TERM threw (server may not support signal channel requests): ${sigErr instanceof Error ? sigErr.message : String(sigErr)}`,
          { operation: "session_file_tail_signal_threw" },
        );
      }
      stream.close?.();
    } catch {
      /* ignore */
    }
  };

  // Prong B: `sh -c` trap wrapper. Outer arg is single-quoted so `$t` and
  // `$!` expand in the REMOTE shell, not in Node's template string. The
  // escaped path is itself already single-quoted by shellEscape, so the
  // outer single-quoted argument naturally closes/reopens around it — the
  // POSIX `'foo'\''bar'` splicing pattern extends cleanly to already-quoted
  // tokens embedded in an enclosing single-quoted string.
  const command =
    "sh -c 'trap \"kill $t 2>/dev/null\" EXIT INT HUP TERM; tail -F -n +1 " +
    shellEscape(absolutePath) +
    " & t=$!; wait $t'";

  conn.exec(command, (err, s) => {
    if (err) {
      onError(err);
      return;
    }
    if (stopped) {
      // Caller stopped before the exec channel opened. Tear down immediately.
      try {
        s.close?.();
      } catch {
        /* ignore */
      }
      return;
    }
    stream = s;

    s.on("data", (buf: Buffer) => {
      if (stopped) return;
      anyStdout = true;
      buffer += buf.toString("utf-8");
      // Extract every complete line; leave any partial trailing chunk in
      // `buffer` for the next data event.
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          onLine(line);
        } catch (cbErr) {
          onError(
            cbErr instanceof Error ? cbErr : new Error(String(cbErr)),
          );
        }
      }
    });

    s.stderr.on("data", (buf: Buffer) => {
      if (stopped) return;
      stderrBuf += buf.toString("utf-8");
      // If stderr grows past the threshold WITHOUT any stdout progress, treat
      // as fatal — usually means the path doesn't exist or permission denied.
      // Once we've seen any stdout the tail is healthy; stderr noise from
      // rotation warnings is expected and harmless.
      if (
        !anyStdout &&
        stderrBuf.length > STDERR_ACCUMULATION_LIMIT_BYTES
      ) {
        onError(new Error("tail stderr: " + stderrBuf.slice(0, 500)));
        stop();
      }
    });

    s.on("error", (streamErr: Error) => {
      if (stopped) return;
      onError(streamErr);
    });
  });

  return { stop };
}
