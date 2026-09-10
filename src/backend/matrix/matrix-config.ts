/**
 * Phase 98 Plan 10 — matrix-config.
 *
 * Houses `getMatrixHomeserverBase`, the single non-STT/non-TTS export that
 * used to live in `src/backend/config/media-endpoints.ts`. Moved here as
 * part of D-Kill-list (Phase 98 clean cutover) so `media-endpoints.ts`
 * can be deleted outright.
 *
 * Why the move:
 *   media-endpoints.ts was a Phase 79-Plan-02 shared-constant module for the
 *   old Chatterbox tailnet URLs (`http://100.80.122.111:8000` / `:8001`) that
 *   Skynet's STT/TTS proxy and the tg-bridge both referenced. Phase 98
 *   replaced Chatterbox with AWS Polly + Amazon Transcribe (clean cutover,
 *   no dual-provider seam). Once the URL constants were unused, the file
 *   had ONE remaining export (`getMatrixHomeserverBase`) that is a Matrix
 *   concern, not a voice-endpoint concern. It moves here.
 *
 * Consumer:
 *   `src/backend/telegram/bridge-config-writer.ts` — imports
 *   `getMatrixHomeserverBase` to determine which Matrix homeserver base URL
 *   to write into `/state/config.env` for the tg-bridge container.
 *
 * Behavior:
 *   Byte-for-byte carry-over of the old media-endpoints.ts function body.
 *   Same dynamic-import pattern to avoid the static-import cycle
 *   (matrix-admin-creds-store transitively loads the database layer at
 *   module-load; keeping the dep lazy means importing this file has zero
 *   side effects and does not touch the DB).
 */

/**
 * Resolve the Matrix homeserver base URL from the singleton
 * `matrix_admin_creds` row (Phase 77's admin foundation).
 *
 * Async because `matrix_admin_creds` may not yet be ingested on a fresh
 * Skynet install. Returns `null` in that case. Consumers (the
 * bridge-config-writer) MUST handle null by refusing to write
 * `config.env` until admin creds are present.
 *
 * Dynamic-imports `getMatrixAdminCreds` to avoid a static-import cycle:
 * `matrix-admin-creds-store` transitively loads the database layer at
 * module-load; keeping the dep lazy means importing this file has zero
 * side effects and does not touch the DB.
 */
export async function getMatrixHomeserverBase(): Promise<string | null> {
  const { getMatrixAdminCreds } = await import(
    "./matrix-admin-creds-store.js"
  );
  const creds = await getMatrixAdminCreds();
  return creds?.homeserverBase ?? null;
}
