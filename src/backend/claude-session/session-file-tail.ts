import type { Client } from "ssh2";

/**
 * Follow a remote JSONL session file forward over an SSH exec channel, invoking
 * `onLine` for every complete newline-terminated line as it lands.
 *
 * Two design choices worth naming:
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
  // Phase 43: optional bounded-initial-slice. When set to a positive
  // finite integer within [1, 1_000_000], the tail command switches from
  // `-n +1` (start at file line 1, unbounded backfill) to `-n N` (start
  // at last N lines from EOF, then follow). Missing / invalid values
  // fall through to the current `-n +1` default byte-for-byte —
  // backcompat mandated by .planning/phases/43-.../43-CONTEXT.md
  // § "Backcompat / migration": *legacy callers get the current
  // unbounded initial replay*.
  initialLines?: number,
): TailHandle {
  let stopped = false;
  // The ssh2 ClientChannel type is not re-exported at this level; we retain
  // the loose reference so the stop() helper can call close/signal/end
  // without pulling ClientChannel into this file's public surface.
  let stream: {
    close?: () => void;
    signal?: (signal: string) => void;
    end?: () => void;
  } | null = null;
  let buffer = "";
  let stderrBuf = "";
  let anyStdout = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!stream) return;
    try {
      // Prefer close() if the ssh2 version supports it; fall back to signal
      // then end() so we don't leave the remote tail process running.
      if (typeof stream.close === "function") {
        stream.close();
      } else {
        try {
          stream.signal?.("KILL");
        } catch {
          /* ignore */
        }
        try {
          stream.end?.();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  // Phase 43: validate `initialLines` into `boundedN` — the source of truth
  // for the command branch below. The 1_000_000 upper bound is a defensive
  // cap so a runaway caller can't hand `tail` an absurd arg; anything
  // outside the finite-positive-int-≤-cap window falls back to the legacy
  // `-n +1` default. `Math.floor` normalizes fractional inputs to integer
  // line counts before they hit the shell.
  const boundedN: number | null =
    typeof initialLines === "number" &&
    Number.isFinite(initialLines) &&
    initialLines > 0 &&
    initialLines <= 1_000_000
      ? Math.floor(initialLines)
      : null;

  const command =
    boundedN !== null
      ? "tail -F -n " + boundedN + " " + shellEscape(absolutePath)
      : "tail -F -n +1 " + shellEscape(absolutePath);

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
