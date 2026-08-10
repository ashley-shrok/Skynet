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

// ---------------------------------------------------------------------------
// Phase 17 relay detection regexes — ported byte-for-byte from
// prototype.html § detectOutbound (2026-07-28 6/6 acceptance) — do not loosen
// ---------------------------------------------------------------------------

// OUTBOUND: all three must hit for a Bash tool_use to be a real Matrix send.
// Rejects grep, heredoc, and comment false-positives (acceptance cases 2+3).
const OUTBOUND_CURL_RE = /\bcurl\b/;
const OUTBOUND_PUT_RE = /-X\s+PUT\b/;
const OUTBOUND_URL_RE = /rooms\/[^\/\s'"]+\/send\/m\.room\.message\/[^\/\s'"`]+/;

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
// Option D (Ashley 2026-07-28): body extraction deleted from outbound detection.
// rawCommand IS the body — rendered faithfully as a mono block (scrollable).
// Fleet-standard sends use `curl -d "$(jq -n --arg b "$MSG" ...)"` forms that
// literal-JSON extraction cannot succeed on; faithful record of what happened
// beats a guessed body. No body/extractError fields on the wire type.
//
// Follow-up bounty (out of scope for this fix, 2026-07-28): opportunistic
// body-var grep (MSG=/BODY=/TEXT= shell variable extraction) could provide a
// "nice-to-have preview above command" — deferred per Ashley's explicit decision.
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
 * Option D (Ashley 2026-07-28): body extraction removed entirely.
 * rawCommand is the faithful record of what the agent did — the bubble
 * renders it as a scrollable mono block. Fleet-standard sends use
 * `curl -d "$(jq -n --arg b "$MSG" ...)"` forms that literal-JSON
 * extraction cannot succeed on; faithful record > guessed body.
 *
 * Follow-up bounty (out of scope): opportunistic body-var grep
 * (MSG=/BODY=/TEXT= shell variable extraction) as "nice-to-have preview
 * above command" — deferred per Ashley's explicit decision 2026-07-28.
 */
export function detectRelayOutbound(
  obj: Record<string, unknown>,
): {
  room: string | null;
  rawCommand: string;
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
    if (!OUTBOUND_URL_RE.test(cmd)) continue;
    if (!OUTBOUND_CURL_RE.test(cmd)) continue;
    if (!OUTBOUND_PUT_RE.test(cmd)) continue;
    // Room extraction
    const roomMatch = cmd.match(/rooms\/([^/\s'"]+)\/send\/m\.room\.message/);
    const room = roomMatch ? roomMatch[1] : null;
    return { room, rawCommand: cmd };
  }
  return null;
}

/**
 * Detect whether a parsed JSONL turn is a Matrix relay inbound notification.
 *
 * Returns a descriptor if the turn is type=user with origin.kind=
 * "task-notification" AND the text content matches the recv.sh event-line
 * format: `[room X] [@sender:server] (event $Y): BODY</event>`.
 *
 * Non-matching task-notifications (plain wakeup fires, etc.) return null so
 * the existing harness_wrapper skip path continues to apply for them.
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
  if (obj.type !== "user") return null;
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
  // Strip surrounding task-notification wrapper tags so the regex matches
  // the bare recv.sh event line inside the wrapper body.
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

export function parseSessionLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "skip", why: "empty" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { kind: "malformed", bytes: trimmed.length };
  }

  const type = obj.type;
  const isUser = type === "user";
  const isAssistant = type === "assistant";

  // Harness quirk (pv-parser-accept-queued-command-attachment, 2026-08-10):
  // Some user prompts land as type:"attachment" with attachment.type:
  // "queued_command" — Ashley typed normally in pretty view and hit enter,
  // no queue feature used, but Claude Code wrote it as a queued_command
  // attachment. Without this branch the message never renders as a bubble
  // (skipped as why:"attachment"). Treat as a user turn with attachment.prompt
  // as content. Runs BEFORE the isUser/isAssistant gate.
  if (type === "attachment") {
    const att = obj.attachment;
    if (att !== null && typeof att === "object") {
      const attObj = att as Record<string, unknown>;
      if (attObj.type === "queued_command") {
        const prompt = attObj.prompt;
        if (typeof prompt === "string" && prompt.length > 0) {
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

  // Phase 17 — relay inbound detection (RELAYBUB-02).
  // Run BEFORE the harness_wrapper skip so task-notification turns that
  // carry a recv.sh event line are surfaced as relay_inbound rather than
  // dropped. Non-matching task-notifications fall through to the existing
  // harness_wrapper skip path unchanged.
  if (isUser) {
    const inbound = detectRelayInbound(obj);
    if (inbound !== null) {
      // Build eventId + ts here (mirrors the chain below).
      const uuid = obj.uuid;
      const messageId = obj.messageId;
      const eventIdR =
        typeof uuid === "string" && uuid.length > 0
          ? uuid
          : typeof messageId === "string" && messageId.length > 0
            ? messageId
            : fallbackEventId();
      const rawTsR = obj.timestamp;
      let tsR = Date.now();
      if (typeof rawTsR === "string") {
        const parsedR = Date.parse(rawTsR);
        if (Number.isFinite(parsedR)) tsR = parsedR;
      }
      return {
        kind: "relay_inbound",
        room: inbound.room,
        sender: inbound.sender,
        matrixEventId: inbound.matrixEventId,
        body: inbound.body,
        raw: inbound.raw,
        eventId: eventIdR,
        ts: tsR,
      };
    }
  }

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
      return {
        kind: "relay_outbound",
        room: outbound.room,
        rawCommand: outbound.rawCommand,
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
    return {
      kind: "image",
      role: imageRole,
      images: imageRefs,
      text: content,
      eventId,
      ts,
    };
  }

  return {
    kind: "message",
    role,
    content,
    eventId,
    ts,
  };
}
