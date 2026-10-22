/**
 * Phase 128 Plan 03 Task 1 — pure `derivePreviewText(event)` utility.
 *
 * What this module does:
 *   Maps a Matrix `m.room.message` event's `content` to the lock-screen
 *   preview string per D-07 (CONTEXT.md: "content is <agent display name>:
 *   <preview> where preview mirrors app row rendering"). The label taxonomy
 *   is a byte-for-byte TS translation of the case-statement in
 *   `substrate/skills/agent-relay/recv.sh:379-381` — the same labels the
 *   agent-side inbound relay bubble shows today (Pitfall 8 in RESEARCH.md
 *   explains why the server-side derivation is our source of truth for the
 *   lock-screen preview: the client message-row silently drops non-text
 *   msgtypes, so mirroring "what the app row shows" for a voice note today
 *   is technically "nothing" — server-side derivation is the correct place
 *   to encode the taxonomy until a future phase unifies the two under
 *   `src/shared/message-preview.ts`).
 *
 * Why the labels live in a top-of-file `PREVIEW_LABELS` constant:
 *   Assumption A5 in RESEARCH.md — the user may want to tweak label copy
 *   (e.g. "Voice message" like Signal instead of "audio 🎤"). Keeping the
 *   four strings in ONE named constant means a future edit is a single-line
 *   diff, and the tests + one place to audit.
 *
 * Why `PREVIEW_MAX_BODY_LEN = 3800`:
 *   Notifications go out as Telegram messages, which hold up to 4096
 *   characters. 3800 leaves room for the header line (name + roles, capped
 *   in resolve-agent-label.ts) so nearly every agent message arrives whole
 *   and the user only has to open Skynet for the rare longer one. A cut
 *   message ends in "…" so it's clear there's more.
 *
 * Contract:
 *   - No I/O; no side effects; deterministic given input.
 *   - Never returns an empty string — Pitfall 3 (iOS invalidates silent
 *     pushes: a push event whose payload's body would render as "" on the
 *     lock screen risks the SW's `showNotification` producing an empty
 *     visible line, which is treated as "silent" by iOS's revocation
 *     heuristic). The `(message)` sentinel is the last-resort fallback.
 *   - The argument type is a minimal `MatrixMessageEvent` shape defined
 *     inline — this module MUST NOT depend on any fields beyond
 *     `event.content?.msgtype`, `.body`, `.filename`, keeping it trivially
 *     unit-testable and reusable from any caller with a `.content` object
 *     of the right shape.
 *
 * Future unification note:
 *   When the client's `pretty-view` row renderer eventually gains
 *   voice/image/file support, this module and the client renderer should
 *   unify into `src/shared/message-preview.ts` so both surfaces render the
 *   same label for the same event. That's OUT OF SCOPE for Phase 128 —
 *   Pitfall 8 in 128-RESEARCH.md documents the deferral.
 */

// ---------------------------------------------------------------------------
// Public constants — the four labels + the body-length cap.
// ---------------------------------------------------------------------------

/**
 * Non-text msgtype → label map. Byte-mirror of
 * `substrate/skills/agent-relay/recv.sh:379-381`. Kept in one object so a
 * future copy tweak (Assumption A5) is a one-file diff.
 */
export const PREVIEW_LABELS = {
  image: "image 🖼️",
  audio: "audio 🎤",
  video: "video 🎬",
  file: "file 📎",
} as const;

/**
 * Cap for the preview, "…" included. See module-doc for the rationale.
 */
export const PREVIEW_MAX_BODY_LEN = 3800;

/**
 * Absolute-last-resort placeholder — never returned when the sender has
 * anything usable. Guarantees `derivePreviewText` never returns "" (Pitfall
 * 3 defense: iOS revokes subscriptions that receive too many "silent"
 * pushes; an empty visible body counts).
 */
const EMPTY_FALLBACK = "(message)";

// ---------------------------------------------------------------------------
// Argument type — minimal Matrix message-event shape.
// ---------------------------------------------------------------------------

/**
 * The subset of a Matrix `m.room.message` event this function needs.
 * Defined inline (not imported) so the module has zero coupling to the
 * rest of the backend's Matrix event typing. Any caller with a `.content`
 * object of this shape can invoke `derivePreviewText`.
 */
export interface MatrixMessageEvent {
  content?: {
    msgtype?: string;
    body?: string;
    filename?: string;
  };
}

/**
 * Cut `text` to PREVIEW_MAX_BODY_LEN, ending in "…" when it was cut. Never
 * splits a surrogate pair — a lone half would make the send invalid UTF-8.
 */
function capPreview(text: string): string {
  if (text.length <= PREVIEW_MAX_BODY_LEN) return text;
  let cut = PREVIEW_MAX_BODY_LEN - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return text.slice(0, cut) + "…";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the lock-screen preview text for a Matrix message event.
 *
 * Behavior (per 128-03-PLAN.md <behavior> and PATTERNS.md §4):
 *   - `m.text` (or undefined msgtype) → body verbatim, truncated at
 *     PREVIEW_MAX_BODY_LEN with a trailing "…".
 *   - `m.image` → PREVIEW_LABELS.image (with filename in parens when set).
 *   - `m.audio` → PREVIEW_LABELS.audio.
 *   - `m.video` → PREVIEW_LABELS.video.
 *   - `m.file`  → PREVIEW_LABELS.file (with filename in parens when set).
 *   - Any other msgtype → body if present, else EMPTY_FALLBACK.
 *
 * Every result is capped at PREVIEW_MAX_BODY_LEN, so no event (a long
 * filename, a huge unknown-msgtype body) can push the Telegram message past
 * its limit. Never throws. Never returns "" (the empty-fallback guards the
 * tail).
 */
export function derivePreviewText(event: MatrixMessageEvent): string {
  return capPreview(uncappedPreview(event));
}

function uncappedPreview(event: MatrixMessageEvent): string {
  const msgtype = event.content?.msgtype;
  const body = event.content?.body ?? "";
  const filename = event.content?.filename;

  switch (msgtype) {
    case "m.image":
      return filename
        ? `${PREVIEW_LABELS.image} (${filename})`
        : PREVIEW_LABELS.image;
    case "m.audio":
      return PREVIEW_LABELS.audio;
    case "m.video":
      return PREVIEW_LABELS.video;
    case "m.file":
      return filename
        ? `${PREVIEW_LABELS.file} (${filename})`
        : PREVIEW_LABELS.file;
    case "m.text":
    case undefined:
      // derivePreviewText caps the length. Body may be empty (rare: some
      // Matrix clients emit m.text with body:"" for edits or pipeline
      // races). We MUST NOT let "" reach the sw.js push handler — iOS's
      // silent-revocation heuristic invalidates the subscription when the
      // rendered body is empty (Pitfall 3). Fall back to the sentinel so
      // the visible notification always has content.
      return body || EMPTY_FALLBACK;
    default:
      // Unknown msgtype (m.location, m.notice, custom types, ...) — mirror
      // the client's best-effort "show the body" behavior. If the body is
      // empty, return the EMPTY_FALLBACK sentinel (Pitfall 3 — never let
      // iOS see an empty visible push).
      return body || EMPTY_FALLBACK;
  }
}
