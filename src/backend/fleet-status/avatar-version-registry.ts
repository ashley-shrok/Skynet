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

const key = (hostId: number, identityKey: string) => `${hostId}:${identityKey}`;

export function recordAvatarVersion(
  hostId: number,
  identityKey: string,
  version: string | null | undefined,
): void {
  if (typeof version === "string" && version.length > 0) {
    versions.set(key(hostId, identityKey), version);
  }
}

export function getAvatarVersion(
  hostId: number,
  identityKey: string,
): string | null {
  return versions.get(key(hostId, identityKey)) ?? null;
}

/** Drop the known version (after an avatar write, until the next sweep). */
export function forgetAvatarVersion(hostId: number, identityKey: string): void {
  versions.delete(key(hostId, identityKey));
}

export function _clearAvatarVersionsForTest(): void {
  versions.clear();
}
