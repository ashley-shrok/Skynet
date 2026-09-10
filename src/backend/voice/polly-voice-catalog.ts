/**
 * Phase 98 plan 02 — static catalog of the 7 Amazon Polly generative-engine
 * voices Skynet supports for voice-out, plus a whitelist validator (pure kernel).
 *
 * This module is the single source of truth on the backend for which Polly
 * voice IDs are legal for identity/role voice bindings. Consumers:
 *
 *   - `src/backend/database/routes/identities.ts` (Phase 98) — replaces the
 *     old `IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/` regex with the
 *     `isValidPollyVoice` whitelist call.
 *   - `src/backend/database/routes/voice.ts` (Phase 98) — validates
 *     `body.voice` on /voice/speak and /voice/speak-stream requests before
 *     passing through to the Polly adapter.
 *   - `src/backend/voice/voice-migration.ts` (Phase 98) — the startup
 *     one-shot uses `POLLY_VOICE_IDS` to detect already-migrated frontmatter
 *     values (idempotency guard) so it no-ops on subsequent restarts.
 *
 * Locked design decisions (from 98-CONTEXT.md § Voice catalog + § Claude's
 * discretion + § Per-identity voice binding — do NOT deviate):
 *
 * - The catalog is EXACTLY 7 voices: Danielle, Joanna, Ruth, Salli, Tiffany
 *   (female) and Matthew, Stephen (male). These are the only en-US voices
 *   Polly's `generative` engine supports. Neural / standard / long-form
 *   engines are out of scope for this phase.
 *
 * - Array ordering is 5 female voices first (alphabetical), then 2 male
 *   voices (alphabetical). This ordering is the default render order in
 *   the identity modal's VoicePicker; the frontend mirrors the same order
 *   in its inlined copy of the catalog.
 *
 * - The validator is EXACT-MATCH, CASE-SENSITIVE (Polly voice IDs are
 *   proper nouns — "Joanna" is legal, "joanna" is not; see 98-RESEARCH.md
 *   § V5 for the case-sensitivity rationale).
 *
 * - No `getVoices()` fetch endpoint. Per D-Voice-catalog + Claude's-
 *   discretion decision in CONTEXT: "DROP endpoint; inline the 7-voice
 *   const." The frontend `VoicePicker.tsx` owns its own copy of the
 *   catalog — two-source-of-truth is acceptable for 7 static strings.
 *
 * This module is pure — no SDK imports, no async, no I/O, no side effects.
 * Safe to import from the identities validator on hot-path requests.
 */

/**
 * One entry in the Polly voice catalog. Shape mirrors the frontend copy in
 * `src/ui/features/pretty-view/pickers/VoicePicker.tsx` so the picker can
 * render `displayName` while persisting `voiceId` to identity frontmatter.
 */
export interface PollyVoice {
  /** Polly VoiceId (exact-match, case-sensitive). Passed to SynthesizeSpeech. */
  voiceId: string;
  /** Human-facing label rendered in the identity modal's voice dropdown. */
  displayName: string;
  /** Voice gender — used by the frontend for grouped rendering if desired. */
  gender: "female" | "male";
}

/**
 * The 7-voice hand-maintained catalog. 5 female voices alphabetically first
 * (Danielle, Joanna, Ruth, Salli, Tiffany), then 2 male voices alphabetically
 * (Matthew, Stephen). Order is load-bearing — matches the frontend picker's
 * render order.
 */
export const POLLY_VOICES: readonly PollyVoice[] = [
  { voiceId: "Danielle", displayName: "Danielle", gender: "female" },
  { voiceId: "Joanna", displayName: "Joanna", gender: "female" },
  { voiceId: "Ruth", displayName: "Ruth", gender: "female" },
  { voiceId: "Salli", displayName: "Salli", gender: "female" },
  { voiceId: "Tiffany", displayName: "Tiffany", gender: "female" },
  { voiceId: "Matthew", displayName: "Matthew", gender: "male" },
  { voiceId: "Stephen", displayName: "Stephen", gender: "male" },
];

/**
 * Set-view of every legal Polly voice ID, derived from `POLLY_VOICES`. Used
 * by `isValidPollyVoice` for O(1) whitelist membership checks and by the
 * migration script for idempotency (already-migrated values pass through).
 */
export const POLLY_VOICE_IDS: Set<string> = new Set(POLLY_VOICES.map((v) => v.voiceId));

/**
 * Type guard: `id` is one of the 7 supported Polly voice IDs.
 *
 * Contract:
 *   - Only `string` inputs can pass. Non-strings (null, undefined, numbers,
 *     objects) return false without throwing — this is the validator that
 *     replaces the old `.wav` regex on the identities PUT handler, and
 *     that handler receives raw JSON where `voice` may be any type.
 *   - Match is EXACT and CASE-SENSITIVE. "danielle" fails; "Danielle" passes.
 *   - Old Chatterbox `.wav` filenames (e.g. "Elena.wav", "Danielle.wav")
 *     ALL fail — the hard-reset migration relies on this being airtight.
 */
export function isValidPollyVoice(id: unknown): id is string {
  return typeof id === "string" && POLLY_VOICE_IDS.has(id);
}
