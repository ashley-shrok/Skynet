/**
 * Parse one line of a Claude Code JSONL session file into a conversational
 * message event, or classify it as skip/malformed.
 *
 * V1 scope was a HARD LOCK (RENDER-01, .planning/shapes/shape-pretty-session-view.md
 * "aggressive minimalism, IMAGES EXCEPTED (patch #86)"): only user-typed
 * text and Claude's text replies became messages. Anthropic content blocks
 * come in four shapes — text, tool_use, tool_result, thinking — and V1
 * emitted ONLY text. tool_use, non-image tool_result, and thinking are
 * still dropped structurally (never surfaced as content).
 *
 * Patch #86 lifts the restriction for IMAGES ONLY. Turns carrying inline
 * base64 image content (either as a bare `image` content block or as an
 * `image` inner block inside a `tool_result`, or via the Claude-Code-local
 * `toolUseResult.file.base64` convenience path) are now surfaced as a
 * `kind:"image"` variant. Non-image tool_results still drop.
 *
 * Phase 17 (RELAYBUB-01, RELAYBUB-02, RELAYBUB-05) adds two more variants:
 * `kind:"relay_outbound"` for Claude Bash turns that are a real Matrix
 * relay send (curl + -X PUT + URL shape conjunction), and
 * `kind:"relay_inbound"` for task-notification user turns whose body
 * matches the recv.sh event-line format. Detection is ported byte-for-byte
 * from prototype.html (2026-07-28, 6/6 acceptance battery). See
 * detectRelayOutbound / detectRelayInbound exports below.
 *
 * Informational-only prior art (NOT a dependency): github.com/delexw/claude-code-trace
 * has already worked out the file format; we reimplement here because the
 * scope is narrower than what the library does.
 */

import { createHash } from "node:crypto";
import { databaseLogger as sessionParserLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Relay outbound detection — three-signal conjunction. The original URL_RE
// (2026-07-28 6/6 prototype acceptance) parsed the URL SHAPE with a strict
// character class for the room slot, which over-fit and lost bubbles for
// identities who URL-encode the room ID via `$(python3 -c '...quote...')`
// (Yolanda 2026-08-28 was the trigger; fleet corpus showed 40 other real
// sends silently unclassified the same way). Replaced with a plain sentinel
// substring — the sentinel `m.room.message` is Matrix-protocol-specific and
// carries the discrimination signal at zero shape-parsing cost. CURL_RE +
// PUT_RE stay: they contribute real verb-level discrimination (rejects coord
// GETs and non-curl analysis scripts) at zero implementation risk.
// Corpus-validated 2026-08-28 against 716 candidate commands from t1000 +
// thenasty + workstation (14-day window): +86 rescues over the old shape,
// zero false positives, zero regressions (SENTINEL is a strict superset of
// the old URL_RE — every command that passed URL_RE contained the sentinel).
// Bounty: detector-fleet-corpus-sentinel-eval (REPORT.md has the full table).
const OUTBOUND_CURL_RE = /\bcurl\b/;
const OUTBOUND_PUT_RE = /-X\s+PUT\b/;
const OUTBOUND_SENTINEL_RE = /m\.room\.message/;

// INBOUND: recv.sh event-line format emitted via Monitor task-notification.
// Strict variant (INBOUND_REGEX_STRICT from prototype.html line 227).
const INBOUND_REGEX = /\[room\s+(\S+)\]\s*\[(\@\S+)\]\s*\(event\s+(\S+)\):\s*([\s\S]*?)(?:<\/event>|$)/;

export type ConversationalMessage = {
  kind: "message";
  role: "user" | "assistant";
  content: string;
  eventId: string;
  ts: number;
};

export type ImageBlock = {
  data: string; // raw b64, no data-URI prefix
  mediaType: string;
  toolUseId?: string;
};

export type ImageMessage = {
  kind: "image";
  role: "user" | "assistant" | "tool_result";
  images: ImageBlock[];
  text: string;
  eventId: string;
  ts: number;
};

// Phase 17 — relay event variants (RELAYBUB-01 outbound, RELAYBUB-02 inbound)
//
// wire eventId = outer JSONL uuid (same chain as ConversationalMessage.eventId)
// matrixEventId = the $EVENT_ID from the recv.sh line (distinct field to
// avoid collision with the JSONL uuid above).
//
// Update (2026-08-18, bounty pretty-view-outgoing-relay-render):
// The July "extraction unreliable" premise was disproved by a 530-record
// survey — see PATTERNS.md in the bounty folder. 7 named regex strategies
// now cover 96.4% of real fleet sends. `extractOutboundBody(cmd)` below
// runs after the 3-way classifier gate confirms the turn is a real outbound
// send, and returns `body: string | null` (null = fallback to rawCommand
// mono block, unchanged from the July behavior — 3.6% cross-turn +
// python-heredoc tail).
//
// Security note (T-17-01-02, accepted): rawCommand contains the full Bash
// command including any curl args (may include bearer tokens if the agent
// inlined them). This is the same disclosure surface the tmux pane already
// presents — pretty view is a rendering of what is already in the session
// file. No new attack surface beyond what the existing session viewer shows.
export type RelayOutboundMessage = {
  kind: "relay_outbound";
  room: string | null;
  rawCommand: string;
  body: string | null;
  eventId: string;
  ts: number;
};

export type RelayInboundMessage = {
  kind: "relay_inbound";
  room: string;
  sender: string;
  matrixEventId: string;
  body: string;
  raw: string;
  eventId: string;
  ts: number;
};

export type ParsedLine =
  | ConversationalMessage
  | ImageMessage
  | RelayOutboundMessage
  | RelayInboundMessage
  | { kind: "skip"; why: string }
  // `bytes` carries the trimmed byte length of the unparseable line so the
  // consumer can surface a placeholder bubble with diagnostic info (see
  // pv-malformed-jsonl-placeholder-bubble bounty, 2026-08-10: Claude Code's
  // JSONL writer occasionally concatenates two records on the same line
  // AND truncates the first mid-string — content is unrecoverable, but a
  // byte-count placeholder tells Ashley something was lost).
  | { kind: "malformed"; bytes: number };

type ContentBlock = { type?: string; text?: string; [k: string]: unknown };

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        parts.push(block.text);
      }
    }
    return parts.join("");
  }
  return "";
}

/**
 * Detect whether a parsed JSONL turn is a real Matrix relay outbound send.
 *
 * Returns a descriptor if the turn is type=assistant with a Bash tool_use
 * whose command satisfies ALL THREE of:
 *   1. contains /\bcurl\b/
 *   2. contains /-X\s+PUT\b/
 *   3. contains the rooms/.../send/m.room.message/... URL shape
 *
 * The three-way conjunction is the validated detection truth signal from the
 * prototype (2026-07-28, 6/6 acceptance). Loosening to any single-condition
 * variant was explicitly rejected (false-positive grep + heredoc cases).
 *
 * Body extraction (2026-08-18, bounty pretty-view-outgoing-relay-render):
 * `extractOutboundBody(cmd)` runs on the confirmed-outbound command and
 * returns `body: string | null`. Extraction is opportunistic (7 named
 * strategies, 96.4% corpus coverage) — null falls back to rawCommand-only
 * render in the bubble, preserving July "faithful record" semantics for
 * the 3.6% tail (cross-turn file refs, python-scripted sends).
 */
export function detectRelayOutbound(
  obj: Record<string, unknown>,
): {
  room: string | null;
  rawCommand: string;
  body: string | null;
} | null {
  if (obj.type !== "assistant") return null;
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return null;
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  for (const block of content as unknown[]) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    if (b.name !== "Bash") continue;
    const input = b.input;
    if (!input || typeof input !== "object") continue;
    const cmd = (input as Record<string, unknown>).command;
    if (typeof cmd !== "string") continue;
    // All three regexes must match — ported byte-for-byte from prototype.html
    // § detectOutbound (2026-07-28 6/6 acceptance) — do not loosen
    if (!OUTBOUND_SENTINEL_RE.test(cmd)) continue;
    if (!OUTBOUND_CURL_RE.test(cmd)) continue;
    if (!OUTBOUND_PUT_RE.test(cmd)) continue;
    // Room extraction
    const roomMatch = cmd.match(/rooms\/([^/\s'"]+)\/send\/m\.room\.message/);
    const room = roomMatch ? roomMatch[1] : null;
    const body = extractOutboundBody(cmd);
    return { room, rawCommand: cmd, body };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 49: sanitize-pass helpers — port of parsers.py extract_sanitized
// (2026-08-20). Replace both bash single-quote-escape idioms with a
// private-use-area placeholder before regex, restore apostrophes at return.
// ---------------------------------------------------------------------------

const APOS_MARKER = "";

function sanitizeBashSqEscapeIdioms(cmd: string): string {
  // Replace bash's two single-quote-escape idioms with a private-use-area
  // placeholder that regex captures can traverse. Restored to `'` post-match.
  //   '"'"'  — close-sq + "'" + open-sq  → literal '
  //   '\''   — close-sq + \' + open-sq   → literal '
  return cmd.replace(/'"'"'/g, APOS_MARKER).replace(/'\\''/g, APOS_MARKER);
}

function restoreApostrophes(body: string | null): string | null {
  if (body === null) return null;
  return body.replaceAll(APOS_MARKER, "'");
}

// ---------------------------------------------------------------------------
// quick-260823-hd6: substituteShellVars extended to 6 assignment shapes.
// Ported verbatim from ~/.claude/roles/box-maintainer/bounties/
//   relay-outbound-cmdsub-heredoc-body/extractor_v3.py — corpus-validated
// against 787 real fleet outbound cmds (t1000 + workstation, 2 weeks):
// 96.3% ok extraction, 0 regressions vs v0, catches 2 latent wrong-body
// bugs (secondary --arg captured before primary heredoc). Residual 15
// unrecoverable = external files + runtime-conditional picks.
//
// Original quick-260822-9qf motivation preserved: Some relay outbound cmds
// stash the body in a non-canonical shell variable and inline the var
// reference via `--arg b "$VAR" '{msgtype:...`. Pre-fix Strategy 6 captured
// the raw literal `$VAR` instead of the resolved body text.
//
// v3 extends the assignment builder from 2 shapes (sq, dq) to 6:
//   (A) cmd-sub cat heredoc:  VAR=$(cat <<'EOF' … EOF)
//   (B) cmd-sub jq -n[c]:     VAR=$(jq -nc '{…body:"X"…}')
//   (C) ANSI-C bash quoting:  VAR=$'…\\n…'
//   (D) bash read heredoc:    read [flags] VAR <<'EOF' … EOF
//   (E) single-quoted:        VAR='…'
//   (F) double-quoted:        VAR="…"
// Shape order = A→B→C→D→E→F with first-assignment-wins. Specialized shapes
// run BEFORE bare sq/dq so E/F don't swallow parts of A-D as bare quotes.
//
// First-assignment-wins, length-descending substitution order (guards
// $BODY_LONG vs $BODY collision), word-boundary guard on `$name`,
// plus `${name}` braces form.
//
// No-op when zero var references are found (guarantees existing corpus
// fixtures see byte-identical input) — no log line emitted in that case.
// ---------------------------------------------------------------------------

// Shape B helper: extract `body:"X"` from a jq filter string, decode
// backslashes. Mirrors extractor_v3.py JQ_BODY_RE + _extract_jq_body.
const JQ_BODY_RE_TS =
  /['"]?body['"]?\s*:\s*"((?:\\.|[^"\\])*)"/;

function _extractJqBody(jqFilter: string): string | null {
  const m = jqFilter.match(JQ_BODY_RE_TS);
  if (!m) return null;
  return m[1].replace(/\\(.)/g, "$1");
}

// Shape C helper: decode ANSI-C escape sequences in bash $'...' quoting.
// Character-by-character state machine (NOT regex substitution) to match
// extractor_v3.py _decode_ansi_c lines 45-64 byte-exact.
const _ANSI_C_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\x08",
  f: "\f",
  v: "\v",
  "0": "\x00",
};

function _decodeAnsiC(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const nxt = s[i + 1];
      if (nxt in _ANSI_C_ESCAPES) {
        out.push(_ANSI_C_ESCAPES[nxt]);
        i += 2;
        continue;
      }
      if (nxt === "x" && i + 3 < s.length) {
        const hex = s.substring(i + 2, i + 4);
        const n = parseInt(hex, 16);
        if (!Number.isNaN(n) && /^[0-9a-fA-F]{2}$/.test(hex)) {
          out.push(String.fromCharCode(n));
          i += 4;
          continue;
        }
      }
      out.push(nxt);
      i += 2;
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join("");
}

// Shape A: cmd-sub cat heredoc — VAR=$(cat <<'EOF' … EOF)
const _ASSIGN_CAT_HEREDOC_RE =
  /(?:^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)=\$\(\s*cat\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\2\s*\n?\s*\)/g;

// Shape B: cmd-sub jq -n[c] — VAR=$(jq -nc '…')
const _ASSIGN_JQ_NC_RE =
  /(?:^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)=\$\(\s*jq\s+-nc?\s*'([\s\S]*?)'\s*\)/g;

// Shape C: ANSI-C — VAR=$'…'
const _ASSIGN_ANSI_C_RE =
  /(?:^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)=\$'((?:\\.|[^'\\])*)'/g;

// Shape D: bash read heredoc — read [flags] VAR <<'EOF' … EOF
const _ASSIGN_READ_HEREDOC_RE =
  /(?:^|[\s;\n]|&&|\|\|)read\s+(?:-\w+(?:\s+(?:''|""|\S+))?\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\2\b/g;

// Shape E: single-quoted — VAR='…'
const _ASSIGN_SQ_RE =
  /(?:^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)='([\s\S]*?)'/g;

// Shape F: double-quoted — VAR="…"
const _ASSIGN_DQ_RE =
  /(?:^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"\\])*)"/g;

/**
 * Build the shared assignment map from the (already-sanitized) ORIGINAL cmd.
 * First-assignment-wins across ALL six passes. Order matters:
 *   A → B → C → D → E → F.
 * The specialized shapes (heredoc/ANSI-C/jq) match MORE-SPECIFIC patterns
 * than the bare sq/dq regexes would otherwise; running them first prevents
 * E/F from swallowing parts of A-D as bare quoted assigns.
 *
 * Mirrors extractor_v3.py _build_assignments (lines 67-100) verbatim.
 */
function _buildAssignments(cmd: string): Record<string, string> {
  const a: Record<string, string> = {};
  let m: RegExpExecArray | null;

  // (A) cmd-sub cat heredoc
  _ASSIGN_CAT_HEREDOC_RE.lastIndex = 0;
  while ((m = _ASSIGN_CAT_HEREDOC_RE.exec(cmd)) !== null) {
    if (a[m[1]] === undefined) a[m[1]] = m[3];
  }

  // (B) cmd-sub jq -n[c]
  _ASSIGN_JQ_NC_RE.lastIndex = 0;
  while ((m = _ASSIGN_JQ_NC_RE.exec(cmd)) !== null) {
    const body = _extractJqBody(m[2]);
    if (body !== null && a[m[1]] === undefined) a[m[1]] = body;
  }

  // (C) ANSI-C
  _ASSIGN_ANSI_C_RE.lastIndex = 0;
  while ((m = _ASSIGN_ANSI_C_RE.exec(cmd)) !== null) {
    if (a[m[1]] === undefined) a[m[1]] = _decodeAnsiC(m[2]);
  }

  // (D) read heredoc
  _ASSIGN_READ_HEREDOC_RE.lastIndex = 0;
  while ((m = _ASSIGN_READ_HEREDOC_RE.exec(cmd)) !== null) {
    if (a[m[1]] === undefined) a[m[1]] = m[3];
  }

  // (E) sq
  _ASSIGN_SQ_RE.lastIndex = 0;
  while ((m = _ASSIGN_SQ_RE.exec(cmd)) !== null) {
    if (a[m[1]] === undefined) a[m[1]] = m[2];
  }

  // (F) dq
  _ASSIGN_DQ_RE.lastIndex = 0;
  while ((m = _ASSIGN_DQ_RE.exec(cmd)) !== null) {
    if (a[m[1]] === undefined) a[m[1]] = m[2].replace(/\\(.)/g, "$1");
  }

  return a;
}

function substituteShellVars(
  cmd: string,
  assignments?: Record<string, string>,
): string {
  const a = assignments ?? _buildAssignments(cmd);
  const names = Object.keys(a);
  if (names.length === 0) return cmd;

  // Length-descending: $BODY_LONG must resolve to BODY_LONG value, NOT
  // $BODY value + literal "_LONG" suffix.
  names.sort((a2, b2) => b2.length - a2.length);

  const escapeRegex = (s: string): string =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let out = cmd;
  let subCount = 0;
  for (const name of names) {
    const value = a[name];

    // ${name} braces form — no word-boundary guard needed (braces close).
    const bracesToken = "${" + name + "}";
    if (out.includes(bracesToken)) {
      const parts = out.split(bracesToken);
      subCount += parts.length - 1;
      out = parts.join(value);
    }

    // $name form with word-boundary guard so $BODY_LONG isn't partially
    // consumed by $BODY (defense-in-depth alongside length-desc sort).
    const bareRe = new RegExp(
      "\\$" + escapeRegex(name) + "(?![A-Za-z0-9_])",
      "g",
    );
    let matchCount = 0;
    out = out.replace(bareRe, () => {
      matchCount++;
      return value;
    });
    subCount += matchCount;
  }

  if (subCount > 0) {
    sessionParserLogger.debug(
      `[session-parser] extract preprocess vars-substituted=${subCount} uniqueVars=${names.length}`,
      { operation: "session_extract" },
    );
  }

  return out;
}

// Strategy 12 preflight: jq-arg-passthrough-known-var
// Pattern: --arg <argname> "$<varname>" ... '{msgtype:"m.text", body:$<argname>}'
// The \1 backreference guarantees the argname inside body:$X is the same as
// the outer --arg name. When matched, look up the $VAR reference in the
// assignments map and return its value directly, bypassing the fragility of
// post-substitution regex-parsing when body has embedded double quotes.
// Mirrors extractor_v3.py JQ_ARG_PASSTHROUGH_RE (lines 138-141).
const JQ_ARG_PASSTHROUGH_RE =
  /--arg\s+(\w+)\s+"\$(\w+)"\s+'\{\s*msgtype\s*:\s*"m\.text"\s*,\s*body\s*:\s*\$\1\s*\}'/;

/**
 * Opportunistically extract the human message body from a confirmed Matrix
 * relay outbound send command.
 *
 * Implements 9 strategies in FIRST-MATCH-WINS priority order. Strategy name
 * is logged at DEBUG for diagnostics; never exposed on the wire type.
 *
 * Coverage on 530-record real-corpus survey (bounty pretty-view-outgoing-relay-render,
 * 2026-08-18): 96.4% (511/530). Failures are cross-turn file refs and
 * python-scripted sends — see PATTERNS.md in the bounty folder.
 *
 * Strategy priority (first match wins):
 *  1. BODY-sq  — BODY='...' shell-var assign (single-quoted, '\'' decoded)
 *  2. BODY-dq  — BODY="..." shell-var assign (double-quoted, backslash decoded)
 *  3. MSG-sq   — MSG='...'  (same as BODY-sq, different var name)
 *  4. MSG-dq   — MSG="..."  (same as BODY-dq, different var name)
 *  5. TEXT/MESSAGE variants — symmetric sq/dq forms for TEXT= and MESSAGE=
 *  6. jq-arg-inline-dq — --arg <word> "literal" '{msgtype:...' inline jq filter
 *  7. jq-arg-inline-sq — --arg <word> 'literal' '{msgtype:...' inline jq filter
 *  8. heredoc-to-file  — cat > <path> <<'EOF' ... EOF (canonical agent-relay skill shape)
 *  9. heredoc-inline   — cat <<'EOF' ... EOF (without file redirection)
 * 10. inline-json      — -d '{"msgtype":"m.text","body":"..."}' literal JSON
 */
export function extractOutboundBody(cmd: string): string | null {
  const s0 = sanitizeBashSqEscapeIdioms(cmd);

  // Build the shared assignments map from the ORIGINAL sanitized cmd so
  // Strategy 12 preflight can look up $VAR references BEFORE substitution
  // rewrites the cmd. Mirrors extractor_v3.py line 147.
  const assignments = _buildAssignments(s0);

  // ---------------------------------------------------------------------------
  // Strategy 12 (preflight): jq-arg-passthrough-known-var
  // Runs BEFORE substituteShellVars. When `--arg <name> "$<var>" '{…body:$<name>}'`
  // matches AND <var> has a known assignment, return the value directly. This
  // bypasses post-substitution regex fragility for bodies containing embedded
  // double quotes (the aqua chromehist / isabella-heredoc-with-quotes bug).
  // Mirrors extractor_v3.py lines 149-153.
  // ---------------------------------------------------------------------------
  const s12Match = s0.match(JQ_ARG_PASSTHROUGH_RE);
  if (s12Match) {
    const varname = s12Match[2];
    if (assignments[varname] !== undefined) {
      const body = assignments[varname];
      sessionParserLogger.debug(
        `[session-parser] extract result=outbound_body strategy=jq-arg-passthrough-known-var bodyLen=${body.length}`,
        { operation: "session_extract" },
      );
      return restoreApostrophes(body);
    }
  }

  const s = substituteShellVars(s0, assignments);

  // ---------------------------------------------------------------------------
  // Strategy 1: BODY-sq — BODY='...' (sanitize pass removed escape idioms)
  // ---------------------------------------------------------------------------
  const bodySqMatch = s.match(/(?:^|\s)BODY='([^']*)'/);
  if (bodySqMatch) {
    const body = bodySqMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=BODY-sq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 2: BODY-dq — BODY="..." with backslash decoding
  // ---------------------------------------------------------------------------
  const bodyDqMatch = s.match(/(?:^|\s)BODY="((?:\\.|[^"\\])*)"/);
  if (bodyDqMatch) {
    const body = bodyDqMatch[1].replace(/\\(.)/g, "$1");
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=BODY-dq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 3: MSG-sq — MSG='...' (sanitize pass removed escape idioms)
  // ---------------------------------------------------------------------------
  const msgSqMatch = s.match(/(?:^|\s)MSG='([^']*)'/);
  if (msgSqMatch) {
    const body = msgSqMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=MSG-sq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 4: MSG-dq — MSG="..." with backslash decoding
  // ---------------------------------------------------------------------------
  const msgDqMatch = s.match(/(?:^|\s)MSG="((?:\\.|[^"\\])*)"/);
  if (msgDqMatch) {
    const body = msgDqMatch[1].replace(/\\(.)/g, "$1");
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=MSG-dq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 5: TEXT/MESSAGE variants — sq and dq, same handling as BODY/MSG
  // ---------------------------------------------------------------------------
  const textSqMatch = s.match(/(?:^|\s)(?:TEXT|MESSAGE)='([^']*)'/);
  if (textSqMatch) {
    const body = textSqMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=TEXT/MESSAGE-sq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }
  const textDqMatch = s.match(/(?:^|\s)(?:TEXT|MESSAGE)="((?:\\.|[^"\\])*)"/);
  if (textDqMatch) {
    const body = textDqMatch[1].replace(/\\(.)/g, "$1");
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=TEXT/MESSAGE-dq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 6: jq-arg-inline-dq
  // --arg <word> "literal" '{msgtype: ... (trailing '{msgtype:' disambiguates
  // from unrelated jq --arg u "$USER" uses)
  // ---------------------------------------------------------------------------
  const jqArgDqMatch = s.match(
    /--arg\s+\w+\s+"((?:\\.|[^"\\])*)"\s+'\{msgtype:/,
  );
  if (jqArgDqMatch) {
    const body = jqArgDqMatch[1].replace(/\\(.)/g, "$1");
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=jq-arg-inline-dq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 7: jq-arg-inline-sq
  // --arg <word> 'literal' '{msgtype: ... (symmetric single-quote variant)
  // ---------------------------------------------------------------------------
  const jqArgSqMatch = s.match(
    /--arg\s+\w+\s+'([^']*)'\s+'\{msgtype:/,
  );
  if (jqArgSqMatch) {
    const body = jqArgSqMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=jq-arg-inline-sq bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 8: heredoc-to-file
  // cat > <path> <<'EOF' (or <<EOF) ... \nEOF — captures body between markers.
  // Body is verbatim (no shell-escape decoding: single-quoted heredoc is literal).
  // More specific than heredoc-inline (has the '>' redirection), so wins first.
  // ---------------------------------------------------------------------------
  const heredocToFileMatch = s.match(
    /cat\s*>\s*(?:"[^"]*"|'[^']*'|\S+)\s*<<\s*'?EOF'?\s*\n([\s\S]*?)\n\s*EOF\b/,
  );
  if (heredocToFileMatch) {
    const body = heredocToFileMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=heredoc-to-file bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 9: heredoc-inline
  // cat <<'EOF' (or <<EOF) ... \nEOF — WITHOUT file redirection.
  // Priority AFTER heredoc-to-file so the more specific pattern wins first.
  // Note: BODY=$(cat <<'EOF' ... EOF) is also matched here because the regex
  // anchors on 'cat <<' regardless of what surrounds it.
  // ---------------------------------------------------------------------------
  const heredocInlineMatch = s.match(
    /cat\s*<<\s*'?EOF'?\s*\n([\s\S]*?)\n\s*EOF\b/,
  );
  if (heredocInlineMatch) {
    const body = heredocInlineMatch[1];
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=heredoc-inline bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  // ---------------------------------------------------------------------------
  // Strategy 10: inline-json
  // -d '{"msgtype":"m.text","body":"..."}' literal JSON object.
  // Parse body via JSON.parse; on failure return null (do not throw).
  // ---------------------------------------------------------------------------
  const inlineJsonMatch = s.match(
    /-d\s+'(\{"msgtype":"m\.text","body":"(?:\\.|[^"\\])*"\})'/,
  );
  if (inlineJsonMatch) {
    try {
      const parsed = JSON.parse(inlineJsonMatch[1]) as { body?: unknown };
      if (typeof parsed.body === "string") {
        const body = parsed.body;
        sessionParserLogger.debug(
          `[session-parser] extract result=outbound_body strategy=inline-json bodyLen=${body.length}`,
          { operation: "session_extract" },
        );
        return restoreApostrophes(body);
      }
    } catch {
      // JSON parse failure → fall through to null
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy 11: json-envelope-any — final catch-all for `{msgtype:"m.text",
  // body:"X"}` envelopes with quoted or unquoted keys. Catches envelopes that
  // Strategy 10 (inline-json) misses because they aren't inside `-d '…'`
  // (e.g. bodies substituted into curl positional args or piped through echo).
  // Mirrors extractor_v3.py STRATEGIES_V3 entry "json-envelope-any" (lines 129-131).
  // ---------------------------------------------------------------------------
  const jsonEnvelopeAnyMatch = s.match(
    /\{\s*['"]?msgtype['"]?\s*:\s*"m\.text"\s*,\s*['"]?body['"]?\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/,
  );
  if (jsonEnvelopeAnyMatch) {
    const body = jsonEnvelopeAnyMatch[1].replace(/\\(.)/g, "$1");
    sessionParserLogger.debug(
      `[session-parser] extract result=outbound_body strategy=json-envelope-any bodyLen=${body.length}`,
      { operation: "session_extract" },
    );
    return restoreApostrophes(body);
  }

  return restoreApostrophes(null);
}

/**
 * Extract a recv.sh event-line from a raw string. The raw string is typically
 * a task-notification wrapper body carrying the bracket-form event line
 * emitted by recv.sh. Handles the wrapper strip + INBOUND_REGEX match in one
 * place so all three carrying envelopes (task-notification user turn,
 * queue-operation enqueue, queued_command attachment) can share the same
 * detection logic. Returns null when the string doesn't carry an inbound.
 */
function extractInboundFromWrapper(raw: string): {
  room: string;
  sender: string;
  matrixEventId: string;
  body: string;
  raw: string;
} | null {
  const stripped = raw
    .replace(/<task-notification>/g, "")
    .replace(/<\/task-notification>/g, "")
    .trim();
  const m = stripped.match(INBOUND_REGEX);
  if (!m) return null;
  const [, room, sender, matrixEventId, bodyRaw] = m;
  return {
    room,
    sender,
    matrixEventId,
    body: (bodyRaw ?? "").trim(),
    raw,
  };
}

/**
 * Detect whether a parsed JSONL turn is a Matrix relay inbound notification.
 *
 * Three carrying envelopes today (all recognized via the same recv.sh
 * bracket-form signal `[room X] [@sender:server] (event $Y): body</event>`):
 *
 *   1. `type: "user"` + `origin.kind: "task-notification"` — the original
 *      shape, agent-not-busy path. Content in `message.content` (string or
 *      array of {text} blocks).
 *
 *   2. `type: "queue-operation"` + `operation: "enqueue"` — busy-turn arrival.
 *      Claude Code queues the wake instead of interrupting. Content in
 *      `obj.content` (string). Corpus 2026-08-28 (bounty
 *      inbound-detector-queued-envelopes-corpus): 1029 real inbounds landed
 *      in this envelope in the last 2 weeks, all previously dropped.
 *
 *   3. `type: "attachment"` + `attachment.type: "queued_command"` — sibling
 *      shape of (2), also busy-turn arrival. Content in `attachment.prompt`
 *      (string). Corpus: 359 real inbounds in the last 2 weeks.
 *
 * Non-matching envelopes of any shape return null so existing skip / message-
 * emission paths continue to apply. Zero false positives fleet-wide (recv.sh
 * bracket-form is uniquely emitted; nothing else produces the exact shape).
 * See REPORT.md in the corpus bounty for the full table.
 */
export function detectRelayInbound(
  obj: Record<string, unknown>,
): {
  room: string;
  sender: string;
  matrixEventId: string;
  body: string;
  raw: string;
} | null {
  const type = obj.type;

  // Envelope 1: type=user + origin.kind=task-notification (original path).
  if (type === "user") {
    const origin = obj.origin;
    if (!origin || typeof origin !== "object") return null;
    if ((origin as Record<string, unknown>).kind !== "task-notification")
      return null;
    // Extract text content — mirrors extractText but also handles plain string
    // at message.content level (task-notification turns often use string form).
    const msg = obj.message;
    if (!msg || typeof msg !== "object") return null;
    const msgContent = (msg as Record<string, unknown>).content;
    let raw: string;
    if (typeof msgContent === "string") {
      raw = msgContent;
    } else if (Array.isArray(msgContent)) {
      raw = (msgContent as unknown[])
        .map((x) => {
          if (typeof x === "string") return x;
          if (x && typeof x === "object") {
            const xo = x as Record<string, unknown>;
            return typeof xo.text === "string" ? xo.text : "";
          }
          return "";
        })
        .join("\n");
    } else {
      return null;
    }
    return extractInboundFromWrapper(raw);
  }

  // Envelope 2: type=queue-operation + operation=enqueue (busy-turn arrival).
  if (type === "queue-operation" && obj.operation === "enqueue") {
    const content = obj.content;
    if (typeof content !== "string") return null;
    return extractInboundFromWrapper(content);
  }

  // Envelope 3: type=attachment + attachment.type=queued_command (busy-turn arrival).
  if (type === "attachment") {
    const att = obj.attachment;
    if (!att || typeof att !== "object") return null;
    const attObj = att as Record<string, unknown>;
    if (attObj.type !== "queued_command") return null;
    const prompt = attObj.prompt;
    if (typeof prompt !== "string") return null;
    return extractInboundFromWrapper(prompt);
  }

  return null;
}

/**
 * Detect whether a parsed JSONL turn is a real `/id reset` user turn — the
 * earliest real "recycling starts now" signal per Phase 30 Plan 30-02
 * (PS30-02). This is a PURE OBSERVATION PREDICATE.
 *
 * Returns true iff ALL FOUR conditions hold:
 *   1. obj.type === "user"                       (mirrors layer1-detect.ts:83 isUserTurn gate)
 *   2. obj.isMeta !== true                       (harness-injected turns are never real user speech; matches parseSessionLine's L449 gate)
 *   3. message.content is a STRING               (tool_result feedback for user turns lives in ARRAY-shaped content per Anthropic content-block shape; this mirrors layer1-detect.ts:85 `"tool_result"` exclusion but implemented at the object level — array-shaped user content is where tool_results live)
 *   4. the content string contains BOTH `<command-name>/id</command-name>`
 *      AND `<command-args>reset` (PREFIX match so freeform explanations
 *      like `<command-args>reset because I want to change roles</command-args>`
 *      still fire — mirrors layer1-detect.ts:104 exactly)
 *
 * INVARIANT (Test 12 in session-file-parser.id-reset.test.ts): for any raw
 * JSONL line, `detectIdReset(JSON.parse(line))` and
 * `isIdResetUserTurn(line)` (from `./layer1-detect`) MUST agree on truth.
 * The two disjoint code paths (object-based here, raw-string in
 * layer1-detect) exist as defense-in-depth — one catches regressions in the
 * other — and the emitter's dedupe (Plan 30-01) safely collapses any
 * double-fire to ONE wire frame only IF the two detectors agree. If this
 * invariant is ever violated, the emitter dedupe is unsafe.
 *
 * OBSERVATION-CHANNEL SEMANTICS (per revised 30-CONTEXT.md § domain +
 * § decisions "Migration strategy" + § test-strategy — B1 revision
 * 2026-08-10): this predicate does NOT modify parseSessionLine's
 * message-emission path. Callers that want to react to /id reset call
 * this predicate directly on the raw JSON object; the emission channel
 * is independent. Post quick-260829-r9i (2026-08-29): parseSessionLine
 * now SKIPS all `/id` user turns as session-lifecycle noise (Ashley
 * reversed the prior HARD LOCK on slash-command visibility). The state
 * transition remains orthogonal — whether the bubble renders or is
 * skipped does not affect the pane_state:holding emission.
 *
 * ORTHOGONALITY PROOF (Test 13 in session-file-parser.id-reset.test.ts):
 * for a real /id reset line, `detectIdReset(JSON.parse(line)) === true`
 * (channel fires) AND `parseSessionLine(line).kind === "skip"` with
 * `why === "slash_id"` (bubble suppressed under the r9i policy). The
 * detection channel and the message-emission channel are orthogonal —
 * one line produces both signals independently. This is the load-bearing
 * invariant the B1-revised design depends on; r9i only changed the
 * emission channel's OUTCOME for /id turns (message → skip), not the
 * orthogonality itself.
 */
export function detectIdReset(obj: Record<string, unknown>): boolean {
  if (obj.type !== "user") return false;
  if (obj.isMeta === true) return false;
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return false;
  const content = (msg as Record<string, unknown>).content;
  // Array-shaped user content is where tool_result feedback lives (agent-
  // side synthetic user turns). Exclude at the object level — mirrors
  // layer1-detect.ts:85 `line.includes('"tool_result"')` exclusion.
  if (Array.isArray(content)) return false;
  if (typeof content !== "string") return false;
  if (!content.includes("<command-name>/id</command-name>")) return false;
  if (!content.includes("<command-args>reset")) return false;
  return true;
}

/**
 * Scan a parsed JSONL turn for inline base64 image references.
 *
 * Returns an array of ImageBlock descriptors (empty if none). Two canonical
 * paths are scanned within `message.content[]`:
 *   1. `tool_result` blocks with `content[]` containing `image` inner blocks
 *      whose `source.type === "base64"`. The outer tool_result's
 *      `tool_use_id` is preserved on each ImageBlock.
 *   2. Bare `image` content blocks with `source.type === "base64"` (per
 *      Anthropic API valid on any role; rare in Claude Code JSONL).
 *
 * DEDUP: the Claude-Code-local convenience path (`toolUseResult.file.base64`)
 * carries the SAME base64 as the canonical path in the common case. To avoid
 * double-emitting, the CC-local scan runs ONLY when the canonical scan
 * yielded ZERO refs. `originalSize` is intentionally dropped — out of scope
 * for the wire type.
 */
export function extractImageRefs(obj: Record<string, unknown>): ImageBlock[] {
  const refs: ImageBlock[] = [];
  const msg = obj.message;
  if (msg && typeof msg === "object") {
    const content = (msg as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const outer of content as unknown[]) {
        if (!outer || typeof outer !== "object") continue;
        const outerObj = outer as Record<string, unknown>;

        // Canonical path: tool_result carrying image inner blocks.
        if (
          outerObj.type === "tool_result" &&
          Array.isArray(outerObj.content)
        ) {
          const toolUseId =
            typeof outerObj.tool_use_id === "string"
              ? outerObj.tool_use_id
              : undefined;
          for (const inner of outerObj.content as unknown[]) {
            if (!inner || typeof inner !== "object") continue;
            const innerObj = inner as Record<string, unknown>;
            if (innerObj.type !== "image") continue;
            const source = innerObj.source;
            if (!source || typeof source !== "object") continue;
            const sourceObj = source as Record<string, unknown>;
            if (
              sourceObj.type === "base64" &&
              typeof sourceObj.data === "string"
            ) {
              const mediaType =
                typeof sourceObj.media_type === "string"
                  ? sourceObj.media_type
                  : "image/png";
              const ref: ImageBlock = {
                data: sourceObj.data,
                mediaType,
              };
              if (toolUseId !== undefined) ref.toolUseId = toolUseId;
              refs.push(ref);
            }
          }
          continue;
        }

        // Bare image content block.
        if (outerObj.type === "image") {
          const source = outerObj.source;
          if (!source || typeof source !== "object") continue;
          const sourceObj = source as Record<string, unknown>;
          if (
            sourceObj.type === "base64" &&
            typeof sourceObj.data === "string"
          ) {
            const mediaType =
              typeof sourceObj.media_type === "string"
                ? sourceObj.media_type
                : "image/png";
            refs.push({ data: sourceObj.data, mediaType });
          }
        }
      }
    }
  }

  // Claude-Code-local convenience path — only if canonical scan was empty
  // (dedup: same b64, different field names).
  if (refs.length === 0) {
    const tur = obj.toolUseResult;
    if (tur && typeof tur === "object") {
      const turObj = tur as Record<string, unknown>;
      if (turObj.type === "image") {
        const file = turObj.file;
        if (file && typeof file === "object") {
          const fileObj = file as Record<string, unknown>;
          if (typeof fileObj.base64 === "string") {
            const mediaType =
              typeof fileObj.type === "string" ? fileObj.type : "image/png";
            refs.push({ data: fileObj.base64, mediaType });
          }
        }
      }
    }
  }

  return refs;
}

function fallbackEventId(): string {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
}

export function parseSessionLine(line: string, sessionId?: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "skip", why: "empty" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    sessionParserLogger.info(`[session-parser] classify result=malformed bytesRead=${trimmed.length}`, { operation: "session_classify" });
    return { kind: "malformed", bytes: trimmed.length };
  }

  const type = obj.type;
  const isUser = type === "user";
  const isAssistant = type === "assistant";

  // Relay-inbound detection runs FIRST across all three carrying envelopes
  // (user_task_notification, queue_operation_enqueue, attachment_queued_command).
  // Corpus 2026-08-28 (bounty inbound-detector-queued-envelopes-corpus): the
  // busy-turn queued envelopes carried 1388 real inbound messages in the last
  // 2 weeks that the parser was silently dropping — every peer DM / coord-room
  // reply that arrived while the agent was working. Zero false positives across
  // the fleet — recv.sh bracket-form is uniquely emitted. Runs before the
  // queued_command attachment branch and the queue-operation enqueue branch
  // below because both of those explicitly strip/reject task-notification
  // wrappers (correct for the completion-detection / plain-queued-wakeup
  // cases; wrong for real inbound sends that happen to land in the same
  // envelope). Non-matching envelopes fall through unchanged to the existing
  // logic. See detectRelayInbound above for envelope-shape docs.
  {
    const inbound = detectRelayInbound(obj);
    if (inbound !== null) {
      const uuidI = obj.uuid;
      const messageIdI = obj.messageId;
      const eventIdI =
        typeof uuidI === "string" && uuidI.length > 0
          ? uuidI
          : typeof messageIdI === "string" && messageIdI.length > 0
            ? messageIdI
            : fallbackEventId();
      const rawTsI = obj.timestamp;
      let tsI = Date.now();
      if (typeof rawTsI === "string") {
        const parsedI = Date.parse(rawTsI);
        if (Number.isFinite(parsedI)) tsI = parsedI;
      }
      sessionParserLogger.info(
        `[session-parser] classify result=relay_inbound envelope=${type} room="${inbound.room}" eventId=${eventIdI}`,
        { operation: "session_classify" },
      );
      return {
        kind: "relay_inbound",
        room: inbound.room,
        sender: inbound.sender,
        matrixEventId: inbound.matrixEventId,
        body: inbound.body,
        raw: inbound.raw,
        eventId: eventIdI,
        ts: tsI,
      };
    }
  }

  // Harness quirk (pv-parser-accept-queued-command-attachment, 2026-08-10):
  // Some user prompts land as type:"attachment" with attachment.type:
  // "queued_command" — Ashley typed normally in pretty view and hit enter,
  // no queue feature used, but Claude Code wrote it as a queued_command
  // attachment. Without this branch the message never renders as a bubble
  // (skipped as why:"attachment"). Treat as a user turn with attachment.prompt
  // as content. Runs BEFORE the isUser/isAssistant gate.
  //
  // Followup (same day, 2026-08-10): Claude Code also queues task-notifications
  // and other harness-injected turns the same way when they arrive mid-turn.
  // A queued_command whose prompt is ONLY <task-notification>/<system-reminder>
  // wrappers must NOT render as a user bubble — it should silently drop, same
  // as the isUser wrapper-strip path below. Apply the identical strip before
  // deciding to emit.
  if (type === "attachment") {
    const att = obj.attachment;
    if (att !== null && typeof att === "object") {
      const attObj = att as Record<string, unknown>;
      if (attObj.type === "queued_command") {
        const prompt = attObj.prompt;
        if (typeof prompt === "string" && prompt.length > 0) {
          const stripped = prompt
            .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
            .trim();
          if (stripped.length > 0) {
            const uuid = obj.uuid;
            const messageId = obj.messageId;
            const eventId =
              typeof uuid === "string" && uuid.length > 0
                ? uuid
                : typeof messageId === "string" && messageId.length > 0
                  ? messageId
                  : fallbackEventId();
            const rawTs = obj.timestamp;
            let ts = Date.now();
            if (typeof rawTs === "string") {
              const parsed = Date.parse(rawTs);
              if (Number.isFinite(parsed)) ts = parsed;
            }
            return {
              kind: "message",
              role: "user",
              content: prompt,
              eventId,
              ts,
            };
          }
        }
      }
    }
  }

  // Phase 50 Plan 01 Task 1 (D-09, D-10, D-11) — treat normal-content
  // queue-operation enqueue entries as first-class user messages.
  //
  // The Claude Code harness writes a `type:"queue-operation"` +
  // `operation:"enqueue"` entry the instant it slots an incoming user
  // message into its own queue (busy-turn path — Claude was still
  // processing something else). This entry lands ~111ms after send
  // (empirical, see 50-CONTEXT.md § Empirical evidence) and is currently
  // silently ignored by the message-emission path (only the patch #66
  // task-notification branch in claude-session-server.ts reads
  // queue-operation entries at all, and only for background-agent
  // completion detection). Extending here means a queued user turn
  // renders as a bubble at enqueue-time rather than waiting for the
  // eventual dequeue that can arrive minutes later — the load-bearing
  // signal that lets the frontend clear its optimistic spinner honestly.
  //
  // Guards:
  //   - operation MUST be "enqueue" (dequeue / other operations skip).
  //   - content MUST be a string with non-empty trimmed body.
  //   - content MUST NOT start with "<task-notification>" — the
  //     patch #66 completion-detection branch owns that path (unchanged
  //     for shapes 1/2/3 in claude-session-server.ts L2582-2623).
  //   - content MUST NOT start with "<system-reminder>" — same rationale
  //     as the isUser wrapper-strip below.
  //
  // Two-hash contract (see 50-01-PLAN.md § objective "Hash-derivation
  // contract" — LOAD-BEARING across Plans 50-01, 50-02, 50-04):
  //   (a) eventId = sha256(`${sessionId}\n${timestamp}\n${content}`).slice(0, 32)
  //       — used ONLY by the frontend per-eventId dedup Set (Plan 50-03).
  //       Includes sessionId + timestamp because it is line-scoped.
  //   (b) contentHash = sha256(content).slice(0, 32) — content-only.
  //       Used by BOTH the parser's per-session dedup Map key (Task 2 in
  //       claude-session-server.ts) AND the watchdog's arm-time key
  //       (Plan 50-02). Content-only because the enqueue timestamp
  //       (~T+0) and the later dequeue timestamp (~T+2min) differ, so
  //       any timestamp-inclusive key would fail to match across the
  //       enqueue → dequeue span.
  //
  // sessionId is optional here purely for back-compat with existing
  // test callers that don't thread a sessionId through; production
  // callers in claude-session-server.ts pass `sessionIdFromFile` from
  // the tail-watcher closure. Absent sessionId → fall back to
  // fallbackEventId() (random) — this only affects the frontend dedup
  // Set behavior for the test seam, not any production path.
  if (
    type === "queue-operation" &&
    obj.operation === "enqueue" &&
    typeof obj.content === "string"
  ) {
    const qopContent = obj.content;
    if (qopContent.trim().length > 0
        && !qopContent.startsWith("<task-notification>")
        && !qopContent.startsWith("<system-reminder>")) {
      const rawTs = obj.timestamp;
      let ts = Date.now();
      let tsStrForHash = "";
      if (typeof rawTs === "string") {
        tsStrForHash = rawTs;
        const parsed = Date.parse(rawTs);
        if (Number.isFinite(parsed)) ts = parsed;
      }
      // Deterministic eventId per (sessionId, timestamp, content) — see the
      // hash-derivation contract in the block comment above.
      const eventId =
        typeof sessionId === "string" && sessionId.length > 0
          ? createHash("sha256")
              .update(`${sessionId}\n${tsStrForHash}\n${qopContent}`)
              .digest("hex")
              .slice(0, 32)
          : fallbackEventId();
      sessionParserLogger.info(
        `[session-parser] classify result=queue_enqueue_message contentLen=${qopContent.length} eventId=${eventId}`,
        { operation: "session_classify" },
      );
      return {
        kind: "message",
        role: "user",
        content: qopContent,
        eventId,
        ts,
      };
    }
  }

  if (!isUser && !isAssistant) {
    return { kind: "skip", why: String(type ?? "unknown") };
  }
  const role: "user" | "assistant" = isUser ? "user" : "assistant";

  // Skip machinery-injected turns (skill bodies, <local-command-caveat>
  // notices). Real user speech is never `isMeta: true`; cross-verified on
  // 4 live sessions with 0 false positives.
  if (obj.isMeta === true) {
    return { kind: "skip", why: "meta" };
  }

  // (Relay inbound detection moved earlier — runs BEFORE queued-envelope
  // branches to cover all three carrying envelope shapes uniformly. See
  // detectRelayInbound above + block near start of parseSessionLine.)

  const msg = obj.message as Record<string, unknown> | null | undefined;
  if (msg == null) return { kind: "skip", why: "no_message" };

  // Phase 17 — relay outbound detection (RELAYBUB-01).
  // Run for assistant turns BEFORE extractText + content-based extraction.
  // When the turn is a real Matrix relay send (curl + -X PUT + URL shape
  // conjunction), we return relay_outbound and do NOT fall through to
  // kind:"message". The 3-way conjunction is the validated truth signal
  // from the prototype — do not loosen (T-17-01-01 mitigate).
  if (isAssistant) {
    const outbound = detectRelayOutbound(obj);
    if (outbound !== null) {
      const uuid = obj.uuid;
      const messageId = obj.messageId;
      const eventIdO =
        typeof uuid === "string" && uuid.length > 0
          ? uuid
          : typeof messageId === "string" && messageId.length > 0
            ? messageId
            : fallbackEventId();
      const rawTsO = obj.timestamp;
      let tsO = Date.now();
      if (typeof rawTsO === "string") {
        const parsedO = Date.parse(rawTsO);
        if (Number.isFinite(parsedO)) tsO = parsedO;
      }
      sessionParserLogger.info(`[session-parser] classify result=relay_outbound room="${outbound.room}" eventId=${eventIdO}`, { operation: "session_classify" });
      return {
        kind: "relay_outbound",
        room: outbound.room,
        rawCommand: outbound.rawCommand,
        body: outbound.body,
        eventId: eventIdO,
        ts: tsO,
      };
    }
  }

  const content = extractText(msg.content);
  const imageRefs = extractImageRefs(obj);

  // Empty-content skip only applies when there are no images. If images are
  // present, the image bubble carries the turn even when text is empty.
  if (content === "" && imageRefs.length === 0) {
    return { kind: "skip", why: "empty_content" };
  }

  // Quick-260829-r9i: skip 5 session-lifecycle noise shapes that render as
  // user-role bubbles in PrettyView but aren't real user speech — they're
  // supervisor-injected slash commands, resume sentinels, goodbye echoes, and
  // Ctrl-C kill payloads. All cheap substring/prefix checks, placed BEFORE
  // the harness_wrapper regex strip so they short-circuit first.
  //
  // Mirrors the isAshleyRealUserTurn predicate in
  // src/backend/fleet-status/ssh-poll-orchestrator.ts for slash_exit,
  // resume_injection, and ctrl_c_kill. slash_id is NOT excluded there
  // (backend uses /id as an "Ashley present" signal) but IS excluded here
  // (bubble noise). goodbye_echo is deliberately narrow to the literal
  // "Goodbye!" stdout — other <local-command-stdout>...</local-command-stdout>
  // blocks still render because Ashley intentionally invokes other
  // slash-commands whose output is useful context.
  if (isUser && imageRefs.length === 0 && typeof content === "string") {
    if (content.includes("<command-name>/exit</command-name>")) {
      return { kind: "skip", why: "slash_exit" };
    }
    if (content.includes("<command-name>/id</command-name>")) {
      return { kind: "skip", why: "slash_id" };
    }
    if (content.trim() === "<local-command-stdout>Goodbye!</local-command-stdout>") {
      return { kind: "skip", why: "goodbye_echo" };
    }
    if (content.startsWith("Your session was just resumed by the agent-supervisor")) {
      return { kind: "skip", why: "resume_injection" };
    }
    if (content.trim().replace(/[\x00-\x1F]/g, "") === "") {
      return { kind: "skip", why: "ctrl_c_kill" };
    }
  }

  // Skip harness-injected wrapper-only user turns. The Monitor tool
  // ("<task-notification>") and stop-hook nudges ("<system-reminder>")
  // land as user turns because the harness stitches them into the user
  // stream — but they're not real user speech and add noise to pretty
  // view.
  //
  // Patch #97 — strip-all-known-wrappers approach: rather than a strict
  // startsWith/endsWith match (which only caught single, lone-wrapper
  // turns), we now strip EVERY <task-notification>…</task-notification>
  // and <system-reminder>…</system-reminder> block from the content
  // (globally, non-greedy, dotall-capable via [\s\S]*? to handle
  // multi-line wrapper bodies) and skip only when nothing else remains
  // after trimming. This catches combined turns where the Claude Code
  // harness emits both blocks in the same user-role event (either order,
  // possibly repeated, possibly separated by whitespace) — these combined
  // turns were slipping through the old strict check, reaching pretty-view
  // as user-role messages, and resetting the patch #96 clamp-anchor under
  // rapid-fire relay wakes (making the scroll ceiling unstable). A user
  // turn that MIXES a wrapper block with real typed speech still falls
  // through so the user's words are preserved and rendered.
  //
  // Patch #86 edge case: when images are present, the wrapper-only skip
  // is bypassed — an image bubble is worth showing even if the
  // accompanying text is a harness wrapper.
  if (isUser && imageRefs.length === 0) {
    const stripped = content
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .trim();
    if (stripped === "") {
      return { kind: "skip", why: "harness_wrapper" };
    }
  }

  const uuid = obj.uuid;
  const messageId = obj.messageId;
  const eventId =
    typeof uuid === "string" && uuid.length > 0
      ? uuid
      : typeof messageId === "string" && messageId.length > 0
        ? messageId
        : fallbackEventId();

  const rawTs = obj.timestamp;
  let ts = Date.now();
  if (typeof rawTs === "string") {
    const parsed = Date.parse(rawTs);
    if (Number.isFinite(parsed)) ts = parsed;
  }

  if (imageRefs.length > 0) {
    // Role derivation: images that arrived via ANY tool_result path get
    // role "tool_result" — that includes both (a) the canonical Anthropic
    // path where an image block sits inside `tool_result.content[]` (any
    // resulting ref carries a toolUseId), AND (b) the Claude-Code-local
    // convenience path via `obj.toolUseResult` which is by construction a
    // tool_result payload (Claude Code never populates that key for
    // user-typed or assistant-generated bare images). Bare image content
    // blocks with no tool_result wrapping keep their JSONL role
    // (user/assistant) since they represent direct user/assistant image
    // content rather than a tool response.
    const anyToolUseId = imageRefs.some((r) => r.toolUseId !== undefined);
    const cameFromToolUseResult =
      obj.toolUseResult !== undefined && obj.toolUseResult !== null;
    const imageRole: "user" | "assistant" | "tool_result" =
      anyToolUseId || cameFromToolUseResult ? "tool_result" : role;
    sessionParserLogger.info(`[session-parser] classify result=image role=${imageRole} imageCount=${imageRefs.length} eventId=${eventId}`, { operation: "session_classify" });
    return {
      kind: "image",
      role: imageRole,
      images: imageRefs,
      text: content,
      eventId,
      ts,
    };
  }

  sessionParserLogger.info(`[session-parser] classify result=message role=${role} contentLen=${content.length} eventId=${eventId}`, { operation: "session_classify" });
  return {
    kind: "message",
    role,
    content,
    eventId,
    ts,
  };
}
