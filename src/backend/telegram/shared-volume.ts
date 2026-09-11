/**
 * Phase 79 Plan 03/04 — shared-volume path constants for the tg-bridge
 * Docker service.
 *
 * Origin note: this module was created by Plan 03 Task 1 as the source of
 * truth for `/state/…` paths (registry.json, per-human .token files, etc).
 * Plan 04 Task 1 extended it with the `botTokenFilePath` helper AND
 * promoted the previously-private `assertSafeHumanName` guard to a public
 * export so both this plan's `bot-token-file-writer.ts` and Plan 08's
 * `reconcile-dead-tokens.ts` can import it. Plans 04 and 03 land in the
 * same wave; whichever executor writes this file first wins and the
 * other treats it as a read-only dependency.
 *
 * All helpers live inside the shared Docker volume mounted at `/state/`
 * inside both the `skynet` and `tg-bridge` containers. The container
 * mount point never changes at runtime; `TG_BRIDGE_STATE_DIR_OVERRIDE`
 * exists ONLY for unit tests that want to redirect writes into a tmpdir.
 */

// Test-only override — set by unit tests to redirect fs writes into a
// tmpdir. Origin: Plan 04 Task 1 (bot-token-file-writer + registry-writer
// + human-token-writer tests all lean on this). NEVER read this at
// container runtime — the compose file does not set it and must not.
const OVERRIDE = process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;

export const TG_BRIDGE_STATE_DIR: string = OVERRIDE || "/state";

/**
 * Guard against path traversal + shell-active characters in file-name
 * segments. Applied at every helper that composes a path from a human
 * name or an identityKey. Exported (per Plan 04 Task 1) so downstream
 * modules can validate at their own boundary too.
 *
 * Regex: lowercase-slug, 1..64 chars, must start with alphanumeric,
 * remainder may include `_` and `-`. Matches the shape of every
 * identity slug + human username currently seen in prod (verified
 * against `docker logs skynet | grep username:` for Alice + Zoey).
 *
 * Throws — callers must not swallow. A malformed name at a writer
 * boundary is a hard programming error, not a soft warning.
 */
export function assertSafeHumanName(name: string): void {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      `humanName failed shared-volume path guard: ${JSON.stringify(name)}`,
    );
  }
}

export function registryPath(): string {
  return `${TG_BRIDGE_STATE_DIR}/registry.json`;
}

export function configEnvPath(): string {
  return `${TG_BRIDGE_STATE_DIR}/config.env`;
}

export function humanTokenPath(humanName: string): string {
  assertSafeHumanName(humanName);
  return `${TG_BRIDGE_STATE_DIR}/${humanName}.token`;
}

export function humanSincePath(humanName: string): string {
  assertSafeHumanName(humanName);
  return `${TG_BRIDGE_STATE_DIR}/${humanName}.since`;
}

export function humanTokenDeadPath(humanName: string): string {
  assertSafeHumanName(humanName);
  return `${TG_BRIDGE_STATE_DIR}/${humanName}.token-dead`;
}

/**
 * Path to the per-agent bot-token file the tg-bridge reads to authenticate
 * to Telegram (Nina's live convention — `<identityKey>.bottoken`, 0600).
 * Introduced by Plan 04 Task 1 (blocker B-1 fix); Plan 03 imports this
 * helper from routes.ts so activate/disconnect can write/unlink the file
 * as part of the same handler that writes the DB row.
 */
export function botTokenFilePath(identityKey: string): string {
  // identityKey slugs conform to the same regex per Phase 79 Assumption A5.
  assertSafeHumanName(identityKey);
  return `${TG_BRIDGE_STATE_DIR}/${identityKey}.bottoken`;
}

/**
 * Path to the per-agent pending-chat-id sentinel file the tg-bridge writes
 * when its poller sees a message from an unknown chat_id (Plan 83-01).
 * Skynet's reconcile-pending-chat-ids loop (Plan 83-03) reads this file,
 * parses the raw signed-integer chat_id, updates telegram_bot_tokens, and
 * unlinks the sentinel.
 *
 * agentName is the identityKey slug — same shape as identityKey slugs
 * validated at /telegram/activate (IDENTITY_KEY_RE at routes.ts:51) and
 * matching the assertSafeHumanName regex here.
 */
export function pendingChatIdPath(agentName: string): string {
  assertSafeHumanName(agentName);
  return `${TG_BRIDGE_STATE_DIR}/${agentName}.pending-chat-id`;
}
