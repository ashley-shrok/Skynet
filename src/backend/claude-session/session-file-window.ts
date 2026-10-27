import type { Client } from "ssh2";
import { StringDecoder } from "string_decoder";
import { sshLogger } from "../utils/logger.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { parseSessionLineQuietly } from "./session-file-parser.js";
import { tailSessionFile, type TailHandle } from "./session-file-tail.js";

/**
 * Open a conversation's session file the fast way: only the recent window
 * crosses the network.
 *
 * Opening used to `tail -F -n +1` the whole JSONL — on a long-lived agent
 * that is tens of MB (screenshots, tool output) pulled over the host's
 * uplink before the newest bubbles appear, even though the client keeps only
 * the newest twenty. Reading on the host is nearly free; moving bytes is not.
 *
 * Flow:
 *   1. Snapshot: the host counts the file's complete lines (N). Lines 1..N are
 *      the past; N+1 onward is live.
 *   2. Backwards read: the host streams lines N..1 newest-first (`tac`). We
 *      count the lines that become client-visible items and hang up once we
 *      have `targetItems`. The window is lines S..N.
 *   3. Whole-history search: facts that need lines before S (background work
 *      started earlier and maybe still running) come from `loadHistory`,
 *      which searches on the host — concurrently with step 2 — and returns
 *      only the matching lines; those before S are kept.
 *   4. Replay: history lines go to `onHistoryLine`, then the window goes to
 *      `onLine` oldest-first with `onWindowStart(S)` called first, so
 *      line-numbering and every front-to-back state machine behave as if the
 *      whole file had been read.
 *   5. `onWindowDone` fires, then live follow starts at line N+1 — nothing
 *      written during the open is lost or replayed twice.
 *
 * Fallback: if the snapshot or backwards read can't run on the host (missing
 * file, no `tac`, exec error), we fall back to the full read from line 1 and
 * fire `onWindowDone` once the snapshot's N lines have gone by (immediately
 * when N is unknown). Slow but correct; logged at warn.
 */

/** Parsed kinds that become a counted item in the client's twenty. */
const VISIBLE_KINDS = new Set([
  "message",
  "image",
  "relay_outbound",
  "relay_inbound",
  "compaction",
  "compaction_guidance",
  "malformed",
]);

export type WindowStats = {
  path: string;
  /** Lines in the file at snapshot time; null when unknown (fallback). */
  totalLines: number | null;
  /** First line of the replayed window (1 on fallback). */
  startLine: number;
  windowLines: number;
  windowBytes: number;
  items: number;
  historyLines: number;
  historyBytes: number;
  durationMs: number;
  fallback: null | string;
};

export type WindowedTailOptions = {
  targetItems: number;
  /** Called before the window replays, with its first line number. */
  onWindowStart: (startLine: number) => void;
  /** Lines before the window that matter to whole-history state, in file order. */
  onHistoryLine?: (line: string) => void;
  /**
   * Search the host for the lines `onHistoryLine` needs, as [lineNo, line]
   * pairs. Started at the same time as the backwards read — run after it, its
   * small answer would queue behind the read's in-flight overshoot — so it
   * searches the whole file and the lines before the window are kept.
   */
  loadHistory?: () => Promise<Array<[number, string]>>;
  /** The window has been replayed (or, on fallback, the snapshot reached). */
  onWindowDone: (stats: WindowStats) => void;
  /** Runs a short SSH exec under the host's channel limiter (defaults to direct). */
  runExec?: RunExec;
};

export type RunExec = <T>(fn: () => Promise<T>) => Promise<T>;
const runDirect: RunExec = (fn) => fn();

/** No data for this long from the backwards read = the host is stuck; fall back. */
const BACKWARDS_STALL_MS = 30_000;

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Counting key for a line, or null when it isn't a client-visible item. */
export function visibleItemKey(line: string, sessionId?: string): string | null {
  const parsed = parseSessionLineQuietly(line, sessionId);
  if (!VISIBLE_KINDS.has(parsed.kind)) return null;
  if (parsed.kind === "relay_inbound" && parsed.matrixEventId) return `mx:${parsed.matrixEventId}`;
  const id = (parsed as { eventId?: unknown }).eventId;
  return typeof id === "string" && id !== "" ? id : `raw:${line.length}:${line.slice(0, 64)}`;
}

type BackwardsResult =
  | { ok: true; totalLines: number; newestFirst: string[]; items: number; bytes: number }
  | { ok: false; reason: string; totalLines: number | null };

/**
 * Snapshot + newest-first read. Resolves once `targetItems` items have been
 * seen (the channel is hung up) or the top of the file is reached.
 */
function readBackwards(
  conn: Client,
  path: string,
  targetItems: number,
  sessionId: string | undefined,
  isStopped: () => boolean,
  registerStop: (fn: () => void) => void,
): Promise<BackwardsResult> {
  const command =
    `f=${shellEscape(path)}; n=$(wc -l < "$f") || exit 3; echo "$n"; ` +
    `command -v tac >/dev/null 2>&1 || exit 4; head -n "$n" "$f" | tac`;
  return new Promise((resolve) => {
    let settled = false;
    let totalLines: number | null = null;
    const newestFirst: string[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let stderrBuf = "";
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const armStall = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () => finish({ ok: false, reason: `stalled (no data for ${BACKWARDS_STALL_MS} ms)`, totalLines }),
        BACKWARDS_STALL_MS,
      );
    };
    let stream: { close?: () => void; signal?: (s: string) => void } | null = null;
    const hangUp = () => {
      try { stream?.signal?.("TERM"); } catch { /* not supported */ }
      try { stream?.close?.(); } catch { /* already closed */ }
    };
    const finish = (r: BackwardsResult) => {
      if (settled) return;
      settled = true;
      if (stallTimer !== null) clearTimeout(stallTimer);
      hangUp();
      resolve(r);
    };
    registerStop(() => finish({ ok: false, reason: "stopped", totalLines }));
    // Stopped while queued for a channel slot: settle at once so the slot frees.
    if (isStopped()) return finish({ ok: false, reason: "stopped", totalLines });
    armStall();
    conn.exec(command, (err, s) => {
      if (err) {
        finish({ ok: false, reason: `exec: ${err.message}`, totalLines: null });
        return;
      }
      stream = s;
      if (isStopped()) return finish({ ok: false, reason: "stopped", totalLines });
      if (settled) {
        hangUp();
        return;
      }
      const takeLine = (line: string) => {
        if (totalLines === null) {
          const n = Number.parseInt(line.trim(), 10);
          if (!Number.isFinite(n) || n < 0) {
            finish({ ok: false, reason: `bad snapshot "${line.slice(0, 40)}"`, totalLines: null });
            return;
          }
          totalLines = n;
          if (n === 0) finish({ ok: true, totalLines: 0, newestFirst, items: 0, bytes: 0 });
          return;
        }
        newestFirst.push(line);
        bytes += Buffer.byteLength(line) + 1;
        const key = visibleItemKey(line, sessionId);
        if (key !== null) seen.add(key);
        if (seen.size >= targetItems || newestFirst.length >= totalLines) {
          finish({ ok: true, totalLines, newestFirst, items: seen.size, bytes });
        }
      };
      s.on("data", (buf: Buffer) => {
        if (settled) return;
        armStall();
        buffer += decoder.write(buf);
        let nl: number;
        while (!settled && (nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          takeLine(line);
        }
      });
      s.stderr.on("data", (buf: Buffer) => {
        if (stderrBuf.length < 2000) stderrBuf += buf.toString("utf-8");
      });
      s.on("close", (code: number | null) => {
        if (settled) return;
        if (code === 3) return finish({ ok: false, reason: `snapshot failed: ${stderrBuf.trim().slice(0, 200)}`, totalLines: null });
        if (code === 4) return finish({ ok: false, reason: "no tac on host", totalLines });
        if (totalLines === null) return finish({ ok: false, reason: `no snapshot (exit ${code}) ${stderrBuf.trim().slice(0, 200)}`, totalLines: null });
        // Reaching the top of the file settles in takeLine; a close before
        // that means the read was cut short (channel torn down, pipeline
        // died) — fall back rather than show a short window.
        finish({ ok: false, reason: `truncated read (exit ${code}, ${newestFirst.length}/${totalLines} lines)`, totalLines });
      });
      s.on("error", (e: Error) => finish({ ok: false, reason: `stream: ${e.message}`, totalLines }));
    });
  });
}

export function tailSessionFileWindowed(
  conn: Client,
  path: string,
  onLine: (line: string) => void,
  onError: (err: Error) => void,
  opts: WindowedTailOptions,
): TailHandle {
  let stopped = false;
  let live: TailHandle | null = null;
  let abortRead: (() => void) | null = null;
  const t0 = performance.now();
  const sessionId = path.split("/").pop()?.replace(/\.jsonl$/, "");

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abortRead?.();
    live?.stop();
  };

  const fallBack = (reason: string, totalLines: number | null) => {
    sshLogger.warn(
      `[session-window] fallback to full read path=${path} reason=${reason} totalLines=${totalLines ?? "?"}`,
      { operation: "session_window_fallback", reason, totalLines },
    );
    let seenLines = 0;
    let seenBytes = 0;
    const stats = (): WindowStats => ({
      path, totalLines, startLine: 1, windowLines: seenLines, windowBytes: seenBytes, items: 0,
      historyLines: 0, historyBytes: 0, durationMs: Math.round(performance.now() - t0), fallback: reason,
    });
    opts.onWindowStart(1);
    let done = false;
    const markDone = () => {
      if (done) return;
      done = true;
      const st = stats();
      sshLogger.warn(
        `[session-window] opened via fallback path=${path} reason=${reason} totalLines=${totalLines ?? "?"} windowLines=${st.windowLines} windowBytes=${st.windowBytes} duration_ms=${st.durationMs}`,
        { operation: "session_window_opened", ...st },
      );
      opts.onWindowDone(st);
    };
    if (totalLines === null || totalLines === 0) markDone();
    live = tailSessionFile(
      conn,
      path,
      (line) => {
        onLine(line);
        seenLines += 1;
        seenBytes += Buffer.byteLength(line) + 1;
        if (!done && totalLines !== null && seenLines >= totalLines) markDone();
      },
      onError,
    );
  };

  void (async () => {
    const historyP: Promise<Array<[number, string]>> = opts.loadHistory
      ? opts.loadHistory().catch((err) => {
          sshLogger.warn(
            `[session-window] history search failed path=${path} err=${err instanceof Error ? err.message : String(err)}`,
            { operation: "session_window_history_failed" },
          );
          return [];
        })
      : Promise.resolve([]);
    const runExec = opts.runExec ?? runDirect;
    const r = await runExec(() =>
      readBackwards(conn, path, opts.targetItems, sessionId, () => stopped, (fn) => { abortRead = fn; }),
    );
    if (stopped) return;
    if (r.ok === false) {
      fallBack(r.reason, r.totalLines);
      return;
    }
    const startLine = r.totalLines - r.newestFirst.length + 1;
    const history = (await historyP).filter(([n]) => n < startLine).map(([, l]) => l);
    if (stopped) return;
    // Per-line guards, like the live tail: one bad line must not drop the rest.
    const safely = (fn: () => void) => {
      try {
        fn();
      } catch (cbErr) {
        onError(cbErr instanceof Error ? cbErr : new Error(String(cbErr)));
      }
    };
    for (const line of history) safely(() => opts.onHistoryLine?.(line));
    safely(() => opts.onWindowStart(startLine));
    for (let i = r.newestFirst.length - 1; i >= 0 && !stopped; i--) {
      const line = r.newestFirst[i]!;
      safely(() => onLine(line));
    }
    if (stopped) return;
    const stats: WindowStats = {
      path,
      totalLines: r.totalLines,
      startLine,
      windowLines: r.newestFirst.length,
      windowBytes: r.bytes,
      items: r.items,
      historyLines: history.length,
      historyBytes: history.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0),
      durationMs: Math.round(performance.now() - t0),
      fallback: null,
    };
    sshLogger.info(
      `[session-window] opened path=${path} totalLines=${stats.totalLines} startLine=${startLine} windowLines=${stats.windowLines} windowBytes=${stats.windowBytes} items=${stats.items} historyLines=${stats.historyLines} historyBytes=${stats.historyBytes} duration_ms=${stats.durationMs}`,
      { operation: "session_window_opened", ...stats },
    );
    opts.onWindowDone(stats);
    live = tailSessionFile(conn, path, onLine, onError, { fromLine: r.totalLines + 1 });
  })();

  return { stop };
}

// Anchored to the record structure (unescaped JSON keys), so prose that
// merely mentions these words — pasted text, skill bodies, raw API request
// records — doesn't match and cross the wire.
const BACKGROUND_WORK_PATTERNS = [
  // Agent launches and stops (any Agent: its result decides background-ness)
  '"type":"tool_use","id":"[^"]+","name":"(Agent|TaskStop|KillShell)"',
  // Background shell launches
  '"type":"tool_use","id":"[^"]+","name":"Bash","input":\\{.*"run_in_background":true',
  // Launch acknowledgements carrying the task id
  '"toolUseResult":\\{.*("backgroundTaskId":"|"isAsync":true)',
  // Completion notices, bare or inside a harness paste envelope
  '"(prompt|content)":"(<pasted_content[^>]{0,160}>(\\\\n)?)?<task-notification>',
];

/**
 * Host-side search of the whole file for lines that carry background-work
 * facts. Two passes, both run on the host so only matches cross the wire:
 *   1. lines that start, acknowledge, stop or report on background work;
 *   2. the tool results of whatever pass 1 leaves open (`openIds`), which
 *      can close it.
 * Returns [lineNo, line] pairs in file order.
 */
export async function searchBackgroundWorkHistory(
  conn: Client,
  path: string,
  openIds: (linesInOrder: string[]) => string[],
  runExec: RunExec = runDirect,
): Promise<Array<[number, string]>> {
  const file = shellEscape(path);
  const pass1 = await runExec(() => execCommand(
    conn,
    `grep -n -E ${BACKGROUND_WORK_PATTERNS.map((p) => `-e ${shellEscape(p)}`).join(" ")} ${file} | grep -v '"type":"api-request-'; exit 0`,
    { timeoutMs: 20000 },
  ));
  const byLine = new Map<number, string>();
  const collect = (out: string) => {
    for (const raw of out.split("\n")) {
      const colon = raw.indexOf(":");
      if (colon <= 0) continue;
      const n = Number.parseInt(raw.slice(0, colon), 10);
      if (Number.isFinite(n)) byLine.set(n, raw.slice(colon + 1));
    }
  };
  const ordered = () => [...byLine.entries()].sort((a, b) => a[0] - b[0]);
  collect(pass1);
  const ids = openIds(ordered().map(([, l]) => l)).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id)).slice(0, 500);
  if (ids.length > 0) {
    const pats = ids.map((id) => `-e ${shellEscape(`"tool_use_id":"${id}"`)}`).join(" ");
    const pass2 = await runExec(() => execCommand(conn, `grep -n -F ${pats} ${file}; exit 0`, { timeoutMs: 20000 }));
    collect(pass2);
  }
  return ordered();
}
