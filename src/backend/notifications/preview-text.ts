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
 *   Assumption A5 in RESEARCH.md — Ashley may want to tweak label copy
 *   (e.g. "Voice message" like Signal instead of "audio 🎤"). Keeping the
 *   four strings in ONE named constant means a future edit is a single-line
 *   diff, and the tests + one place to audit.
 *
 * Why `PREVIEW_MAX_BODY_LEN = 100`:
 *   D-07-adjacent shipping shape from PATTERNS.md §4. 100 chars is a soft
 *   cap that fits comfortably on an iOS lock-screen preview line while
 *   preserving enough context to be useful; longer bodies also bump into
 *   Web Push's ~4KB post-encryption payload cap (aggregate cap across
 *   title + body + roomId + agentMxid — 100 is a safe budget). Also
 *   the T-128-12 mitigation for adversarial 10-MB event bodies (see
 *   128-03-PLAN.md <threat_model>).
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
 * Cap for m.text bodies. Longer bodies get sliced to this length.
 * See module-doc for the rationale (T-128-12 mitigation + iOS lock-screen
 * ergonomics + Web Push payload budget).
 */
export const PREVIEW_MAX_BODY_LEN = 100;

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the lock-screen preview text for a Matrix message event.
 *
 * Behavior (per 128-03-PLAN.md <behavior> and PATTERNS.md §4):
 *   - `m.text` (or undefined msgtype) → body verbatim, truncated at
 *     PREVIEW_MAX_BODY_LEN.
 *   - `m.image` → PREVIEW_LABELS.image (with filename in parens when set).
 *   - `m.audio` → PREVIEW_LABELS.audio.
 *   - `m.video` → PREVIEW_LABELS.video.
 *   - `m.file`  → PREVIEW_LABELS.file (with filename in parens when set).
 *   - Any other msgtype → body if present, else EMPTY_FALLBACK.
 *
 * Never throws. Never returns "" (the empty-fallback guards the tail).
 */
export function derivePreviewText(event: MatrixMessageEvent): string {
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
      // Truncate at PREVIEW_MAX_BODY_LEN. `slice` is safe for any length
      // including 0 (returns "" if body is empty — see next line).
      return body.slice(0, PREVIEW_MAX_BODY_LEN);
    default:
      // Unknown msgtype (m.location, m.notice, custom types, ...) — mirror
      // the client's best-effort "show the body" behavior. If the body is
      // empty, return the EMPTY_FALLBACK sentinel (Pitfall 3 — never let
      // iOS see an empty visible push).
      return body || EMPTY_FALLBACK;
  }
}
