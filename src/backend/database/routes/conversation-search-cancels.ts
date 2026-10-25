/**
 * Cancelled-message check for conversation search (fix-search-hides-cancelled).
 *
 * A message the user withdrew with Stop before the agent started on it stays
 * in the transcript; the conversation hides it once the NEXT prompt shows it
 * was a dead end (interrupt-cancel-tracker.ts). Search only sees the lines
 * that matched, so it can't tell on its own. For a user message that matched,
 * this asks the transcript once more for just what the tracker needs to
 * decide — the lines that hang off the message and the lines that branch from
 * the same point after it — then replays them through the conversation's own
 * tracker. One remote awk pass per host, run only on transcripts whose
 * deciding matches are the user's; it stops reading a file once every asked-
 * about message is settled, which is usually a few lines past the last one.
 *
 * The awk side is a coarse cut, never the judge: it reads each line's own
 * `"uuid":"…"` / `"parentUuid":"…"` keys (one of each per transcript line;
 * quotes inside message text are stored escaped) and stops following a
 * message at its first reply or first branch-mate. Anything it gets wrong
 * leans toward "not cancelled" — the message stays findable, as before.
 */

import { InterruptCancelTracker } from "../../claude-session/interrupt-cancel-tracker.js";

/**
 * awk program, run per transcript with the asked-about line numbers in
 * ENVIRON["T"] (comma list) and the path in ENVIRON["P"]. Emits
 * `<path>\t<asked line>\t<line no>\t<line>` for:
 *   - each asked line itself, whole;
 *   - each line hanging off it, until the first that is not an attachment
 *     (the harness had started on it). The tracker reads only their kind and
 *     ids, so they go out as just that — a skill body or attachment under a
 *     prompt can be very large;
 *   - each later line branching from the same point, until the first that
 *     could be a new prompt (a user line that is not machinery or a tool
 *     result). Those go out whole: the tracker reads a prompt's text to tell
 *     it from a stop marker or command output. Anything else goes out as its
 *     kind and ids.
 * No single quotes: it is embedded in a single-quoted sh -c script.
 */
export const CANCEL_PASS_AWK =
  "function key(k,   s) { " +
  '  if (!match($0, "\\"" k "\\":\\"[^\\"]*\\"")) return ""; ' +
  "  s = substr($0, RSTART + length(k) + 4, RLENGTH - length(k) - 5); return s } " +
  "function out(t, whole,   l) { " +
  "  if (whole) l = $0; " +
  '  else l = "{\\"type\\":\\"" (index($0, "\\"type\\":\\"attachment\\"") ? "attachment" : "other") ' +
  '    "\\",\\"uuid\\":\\"" u "\\",\\"parentUuid\\":" (p == "" ? "null" : "\\"" p "\\"") "}"; ' +
  '  print ENVIRON["P"] "\\t" t "\\t" NR "\\t" l } ' +
  "function settle(t) { if (open[t]) { open[t] = 0; left-- } } " +
  'BEGIN { n = split(ENVIRON["T"], a, ","); left = 0; last = 0; ' +
  "  for (i = 1; i <= n; i++) { want[a[i] + 0] = 1; if (a[i] + 0 > last) last = a[i] + 0 } } " +
  '{ u = key("uuid"); if (u == "") { if (NR > last && left == 0) exit; next } ' +
  '  p = key("parentUuid"); ' +
  '  prompt = index($0, "\\"type\\":\\"user\\"") && !index($0, "\\"isMeta\\":true") && ' +
  '    !index($0, "\\"type\\":\\"tool_result\\""); ' +
  '  if (p != "" && (p in owner)) { t = owner[p]; if (open[t]) { owner[u] = t; out(t, 0); ' +
  '    if (!index($0, "\\"type\\":\\"attachment\\"")) settle(t) } } ' +
  '  if (p != "" && (p in mates)) { m = split(mates[p], b, " "); for (j = 1; j <= m; j++) { t = b[j] + 0; ' +
  "    if (open[t] && t != NR) { out(t, prompt); if (prompt) settle(t) } } } " +
  "  if (NR in want) { out(NR, 1); owner[u] = NR; open[NR] = 1; left++; " +
  '    if (p != "") mates[p] = mates[p] " " NR } ' +
  "  if (NR >= last && left == 0) exit }";

function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Remote command: `sh -c '<script>' -- <path1> <lines1> <path2> <lines2> …`.
 * Paths and line lists are positional arguments, never shell syntax.
 */
export function composeCancelPassCommand(targets: Map<string, number[]>): string {
  const script =
    'while [ "$#" -gt 1 ]; do ' +
    `  P="$1" T="$2" awk '${CANCEL_PASS_AWK}' "$1" 2>/dev/null; ` +
    "  shift 2; " +
    "done";
  const parts = ["sh", "-c", shellSingleQuote(script), "--"];
  for (const [path, lines] of targets) {
    if (lines.length === 0) continue;
    parts.push(shellSingleQuote(path), shellSingleQuote(lines.join(",")));
  }
  return parts.join(" ");
}

/** `${path}\t${lineno}` keys of the asked-about lines that were cancelled. */
export function cancelledFromPassOutput(stdout: string): Set<string> {
  // path → asked line → its lines, in file order.
  const groups = new Map<string, Map<number, string[]>>();
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const t1 = line.indexOf("\t");
    const t2 = t1 === -1 ? -1 : line.indexOf("\t", t1 + 1);
    const t3 = t2 === -1 ? -1 : line.indexOf("\t", t2 + 1);
    if (t3 === -1) continue;
    const path = line.slice(0, t1);
    const asked = Number(line.slice(t1 + 1, t2));
    if (!Number.isFinite(asked)) continue;
    let byAsked = groups.get(path);
    if (!byAsked) {
      byAsked = new Map();
      groups.set(path, byAsked);
    }
    let lines = byAsked.get(asked);
    if (!lines) {
      lines = [];
      byAsked.set(asked, lines);
    }
    lines.push(line.slice(t3 + 1));
  }

  const cancelled = new Set<string>();
  for (const [path, byAsked] of groups) {
    for (const [asked, lines] of byAsked) {
      if (isCancelled(lines)) cancelled.add(`${path}\t${asked}`);
    }
  }
  return cancelled;
}

/**
 * Replays a message line and what followed it through the conversation's
 * cancel tracker. `lines[0]` is the message itself.
 */
export function isCancelled(lines: string[]): boolean {
  if (lines.length < 2) return false;
  let target: string | null = null;
  const tracker = new InterruptCancelTracker();
  const hidden = new Set<string>();
  for (const raw of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
    const rec = obj as Record<string, unknown>;
    if (target === null) {
      if (typeof rec.uuid !== "string") return false;
      target = rec.uuid;
    }
    const { hide, unhide } = tracker.observe(rec, null);
    for (const u of hide) hidden.add(u);
    for (const u of unhide) hidden.delete(u);
  }
  return target !== null && hidden.has(target);
}
