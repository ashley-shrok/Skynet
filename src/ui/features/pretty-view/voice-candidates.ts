/**
 * The voices a speak request offers the server, in preference order:
 *
 *   identity's own voice → its role's voice → the user's fallback voice
 *
 * The server speaks in the first one the active TTS provider offers and
 * skips the rest, falling back to the provider's default when none fits. So a
 * voice saved under another provider (e.g. a Polly "Joanna" while the
 * instance runs ElevenLabs) never errors and never goes silent — it is just
 * passed over. The app sends all candidates rather than resolving one itself
 * because only the server knows which provider is active.
 *
 * `identity.voice` is already the identity-over-role merge (own voice, else
 * the role's), and `identity.roleDefaults.voice` is the role's raw value, so
 * the pair covers "own voice, then role voice" without double-listing.
 */
export function speakVoiceCandidates(
  identity: { voice?: string | null; roleDefaults?: Record<string, unknown> | null } | null | undefined,
  fallbackVoice?: string | null,
): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  };
  add(identity?.voice);
  add(identity?.roleDefaults?.voice);
  add(fallbackVoice);
  return out;
}
