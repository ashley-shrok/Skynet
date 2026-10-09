/**
 * avatar-version-registry.ts — last avatar version seen per (hostId, identityKey).
 *
 * The fleet-status sweep emits `avatar_version` on every identity line; the
 * sweep path bakes it into avatarUrl as `&v=`. The request path
 * (`publicIdentity()` in GET /identities) reads files directly and has no
 * version of its own, so it looks the version up here — keeping both paths
 * emitting the SAME avatarUrl, so a row's <img src> doesn't flip (and refetch)
 * between the REST load and the first sweep frame.
 *
 * One short string per identity the sweep has seen; bounded by fleet size.
 */

const versions = new Map<string, string>();
// After forgetAvatarVersion: the just-superseded version, refused for a short
// window so a sweep that stat'd the files BEFORE the write can't put it back.
const blocked = new Map<string, { version: string; until: number }>();
const BLOCK_MS = 60_000;

const key = (hostId: number, identityKey: string) => `${hostId}:${identityKey}`;

export function recordAvatarVersion(
  hostId: number,
  identityKey: string,
  version: string | null | undefined,
): void {
  if (typeof version !== "string" || version.length === 0) return;
  const k = key(hostId, identityKey);
  const b = blocked.get(k);
  if (b) {
    if (Date.now() < b.until && b.version === version) return;
    blocked.delete(k);
  }
  versions.set(k, version);
}

export function getAvatarVersion(
  hostId: number,
  identityKey: string,
): string | null {
  return versions.get(key(hostId, identityKey)) ?? null;
}

/** Drop the known version (after an avatar write, until the next sweep). */
export function forgetAvatarVersion(hostId: number, identityKey: string): void {
  const k = key(hostId, identityKey);
  const old = versions.get(k);
  if (old !== undefined) blocked.set(k, { version: old, until: Date.now() + BLOCK_MS });
  versions.delete(k);
}

export function _clearAvatarVersionsForTest(): void {
  versions.clear();
  blocked.clear();
}
