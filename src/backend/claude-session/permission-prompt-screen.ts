// Parses a Claude Code tool-permission prompt out of a `tmux capture-pane -p`
// snapshot, so pretty-view's WaitingBubble can show what the agent wants to do
// and answer it with a single keystroke.
//
// The prompt Claude Code draws at the bottom of the pane looks like:
//
//   ────────────────────────────────────────   ← solid top border
//    Bash command                               ← title
//    Stop dev server, remove scratch DB         ← description
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌   ← dashed separator
//    S=/tmp/x; rm -f $S/*.db*                   ← command (may wrap)
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//    Dangerous rm operation on ...              ← why it was flagged
//    ⚠ Claude Code will automatically deny this request in 0:20, ...
//
//    Do you want to proceed?
//    ❯ 1. Yes
//      2. No
//
// Pressing an option's digit answers the prompt immediately (verified on
// v2.1.302). Only the shape above with a "Yes" and a "No" option is returned;
// anything else (trust dialog, idle screen, unknown layout) parses to null so
// the bubble falls back to its presence-only form and no key is ever sent.

import { createHash } from "node:crypto";

export interface PermissionPromptScreen {
  /** First line under the border, e.g. "Bash command". */
  title: string;
  /** Tool-supplied one-liner, e.g. "Stop dev server, remove scratch DB". */
  description: string | null;
  /** The command / payload block, wrapped lines preserved. */
  body: string;
  /** Why Claude Code is asking (safety-check or hook text). */
  reason: string | null;
  /** Seconds left on the unattended-session auto-deny, when shown. */
  autoDenySeconds: number | null;
  /** Digit that selects "Yes". */
  yesKey: string;
  /** Digit that selects "No". */
  noKey: string;
  /** Stable id of this prompt (excludes the ticking countdown). */
  fingerprint: string;
}

const QUESTION_RE = /^Do you want to .+\?$/;
const OPTION_RE = /^(?:❯\s*)?(\d)\.\s+(.+)$/;
const SOLID_BORDER_RE = /^─{10,}$/;
const DASHED_SEP_RE = /^╌{10,}$/;
const COUNTDOWN_RE = /automatically deny this request in (\d+):(\d{2})/;

function stripGutter(line: string): string {
  return line.replace(/^\s*│\s?/, "").trim();
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start += 1;
  while (end > start && lines[end - 1]!.trim() === "") end -= 1;
  return lines.slice(start, end);
}

function joinProse(lines: string[]): string | null {
  const text = lines
    .map(stripGutter)
    .filter((l) => l.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

export function parsePermissionPromptScreen(
  screen: string,
): PermissionPromptScreen | null {
  const lines = screen.split("\n").map((l) => l.replace(/\s+$/, ""));

  let q = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (QUESTION_RE.test(lines[i]!.trim())) {
      q = i;
      break;
    }
  }
  if (q === -1) return null;

  // Options block directly under the question.
  const options: Array<{ key: string; label: string }> = [];
  for (let i = q + 1; i < lines.length; i += 1) {
    const m = OPTION_RE.exec(lines[i]!.trim());
    if (!m) break;
    options.push({ key: m[1]!, label: m[2]!.trim() });
  }
  const yes =
    options.find((o) => o.label === "Yes") ??
    options.find((o) => /^Yes\b/.test(o.label));
  const no = options.find((o) => /^No\b/.test(o.label));
  if (!yes || !no) return null;

  let border = -1;
  for (let i = q - 1; i >= 0; i -= 1) {
    if (SOLID_BORDER_RE.test(lines[i]!.trim())) {
      border = i;
      break;
    }
  }
  if (border === -1) return null;

  let region = lines.slice(border + 1, q);

  // Pull the auto-deny notice out of the region (it can wrap onto the next
  // line; it runs until the next blank line).
  let autoDenySeconds: number | null = null;
  const cd = region.findIndex((l) => COUNTDOWN_RE.test(l));
  if (cd !== -1) {
    const m = COUNTDOWN_RE.exec(region[cd]!)!;
    autoDenySeconds = Number(m[1]) * 60 + Number(m[2]);
    let start = cd;
    if (!/⚠/.test(region[cd]!) && cd > 0 && /⚠/.test(region[cd - 1]!)) {
      start = cd - 1;
    }
    let end = cd + 1;
    while (end < region.length && region[end]!.trim() !== "") end += 1;
    region = [...region.slice(0, start), ...region.slice(end)];
  }

  region = trimBlankEdges(region);
  if (region.length === 0) return null;
  const title = region[0]!.trim();
  const rest = region.slice(1);

  const seps: number[] = [];
  rest.forEach((l, i) => {
    if (DASHED_SEP_RE.test(l.trim())) seps.push(i);
  });

  let description: string | null = null;
  let bodyLines: string[];
  let reason: string | null = null;
  if (seps.length >= 2) {
    description = joinProse(rest.slice(0, seps[0]));
    bodyLines = rest.slice(seps[0]! + 1, seps[1]);
    reason = joinProse(rest.slice(seps[1]! + 1));
  } else {
    bodyLines = rest.filter((l) => !DASHED_SEP_RE.test(l.trim()));
  }
  const body = trimBlankEdges(bodyLines)
    .map((l) => l.replace(/^ /, ""))
    .join("\n");

  const fingerprint = createHash("sha256")
    .update([title, description ?? "", body, reason ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 16);

  return {
    title,
    description,
    body,
    reason,
    autoDenySeconds,
    yesKey: yes.key,
    noKey: no.key,
    fingerprint,
  };
}
