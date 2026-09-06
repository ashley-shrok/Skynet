/**
 * Phase 79 Plan 02 (Ashley-locked D-03) — shared media endpoint constants.
 *
 * Consumers: `voice.ts` (existing — Skynet's STT/TTS reverse-proxy) AND the
 * tg-bridge Docker service via the bridge-config-writer (Plan 04, which
 * serializes STT_URL + MATRIX_HOMESERVER_BASE into `/state/config.env` for
 * the tg-bridge container, per CONTEXT § Locked decisions #3 and the ship-gate
 * reliability check that `bridge.sh` must contain zero hardcoded Tailscale IPs).
 *
 * Values are byte-for-byte migrated from `voice.ts:28-34`. If they need to
 * change in the future, change them HERE — both `voice.ts` and the bridge
 * (via bridge-config-writer) inherit the update. That's the whole point of
 * the shared source of truth.
 *
 * Ashley verbatim (CONTEXT § Locked decisions #1): "if we come out of this
 * and the bridge is not using the config values for where to get speech to
 * text from that Skynet also uses, then that will have been a mistake."
 */

// --- Locked STT endpoint (Nelly-verified live, 2026-07-27) ---
// Verbatim from voice.ts:28.
export const STT_URL = "http://100.80.122.111:8000/v1/audio/transcriptions";

// --- Patch #223: TTS endpoints (Chatterbox on tailnet) ---
// Verbatim from voice.ts:31.
export const TTS_URL = "http://100.80.122.111:8001/v1/audio/speech";

// --- Patch #237: Streaming TTS endpoint (Chatterbox /tts, not /v1/audio/speech) ---
// Verbatim from voice.ts:33.
export const TTS_STREAM_URL = "http://100.80.122.111:8001/tts";

// Verbatim from voice.ts:34.
export const VOICES_URL = "http://100.80.122.111:8001/get_predefined_voices";

/**
 * Resolve the Matrix homeserver base URL from the singleton
 * `matrix_admin_creds` row (Phase 77's admin foundation).
 *
 * Async because `matrix_admin_creds` may not yet be ingested on a fresh
 * Skynet install. Returns `null` in that case. Consumers (the
 * bridge-config-writer in Plan 04) MUST handle null by refusing to write
 * `config.env` until admin creds are present — per RESEARCH § Pitfall 6
 * Option 1: "bridge cannot start until Phase 77's admin ingestion has run"
 * is an explicit Phase 79 precondition.
 *
 * Dynamic-imports `getMatrixAdminCreds` to avoid a static-import cycle:
 * `matrix-admin-creds-store` transitively loads the database layer at
 * module-load; keeping the dep lazy means importing this file has zero
 * side effects and does not touch the DB. See threat model T-79-02-03.
 */
export async function getMatrixHomeserverBase(): Promise<string | null> {
  const { getMatrixAdminCreds } = await import(
    "../matrix/matrix-admin-creds-store.js"
  );
  const creds = await getMatrixAdminCreds();
  return creds?.homeserverBase ?? null;
}
