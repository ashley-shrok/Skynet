/**
 * identity-avatar-cache.ts — in-memory cache for GET /identities/:key/avatar.
 *
 * Without it every avatar request opened a fresh SSH connection to the
 * identity's home box and walked identity-file → role-file → role-avatar
 * reads. A sidebar paint fires one request per row at once, so a remote box
 * with dozens of identities took ~9s per avatar under that burst.
 *
 * Entries hold NORMALIZED bytes (avatar-normalize.ts), so legacy oversized
 * avatars on disk are shrunk once here rather than re-shipped on every load.
 *
 * Freshness:
 *   - Versioned request (`v` = sweep avatar digest): hit iff the entry was
 *     filled for that same version. A new version always misses.
 *   - Unversioned request: hit iff the entry is younger than UNVERSIONED_FRESH_MS.
 *   - Concurrent misses for the same (host, identity, version) share one load.
 *
 * Bounded by total bytes with LRU eviction (target host is a 4 GB box).
 */

import { createHash } from "crypto";

export type CachedAvatar = { bytes: Buffer; mime: string; etag: string };

type Entry = {
  avatar: CachedAvatar | null; // null = "no avatar on disk" (negative entry)
  version: string | null;
  fetchedAt: number;
};

const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const UNVERSIONED_FRESH_MS = 60_000;
const NEGATIVE_TTL_MS = 60_000;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<CachedAvatar | null>>();
let totalBytes = 0;

const entryKey = (hostId: number, identityKey: string) => `${hostId}:${identityKey}`;

function sizeOf(e: Entry): number {
  return e.avatar ? e.avatar.bytes.byteLength : 0;
}

function remove(k: string): void {
  const e = entries.get(k);
  if (!e) return;
  totalBytes -= sizeOf(e);
  entries.delete(k);
}

function put(k: string, e: Entry): void {
  remove(k);
  entries.set(k, e);
  totalBytes += sizeOf(e);
  // Map iteration order is insertion order → first key is least recently used.
  for (const oldest of entries.keys()) {
    if (totalBytes <= MAX_TOTAL_BYTES || oldest === k) break;
    remove(oldest);
  }
}

function isFresh(e: Entry, version: string | null, now: number): boolean {
  const age = now - e.fetchedAt;
  if (e.avatar === null && age >= NEGATIVE_TTL_MS) return false;
  if (version !== null) return e.version === version;
  return age < UNVERSIONED_FRESH_MS;
}

/**
 * Return the avatar for (hostId, identityKey, version), calling `load` on a
 * miss. `load` returns already-normalized bytes or null (no avatar on disk);
 * a throw propagates to the caller and is NOT cached.
 */
export async function getCachedAvatar(
  hostId: number,
  identityKey: string,
  version: string | null,
  load: () => Promise<{ bytes: Buffer; mime: string } | null>,
): Promise<{ avatar: CachedAvatar | null; hit: boolean }> {
  const k = entryKey(hostId, identityKey);
  const e = entries.get(k);
  if (e && isFresh(e, version, Date.now())) {
    // LRU touch
    entries.delete(k);
    entries.set(k, e);
    return { avatar: e.avatar, hit: true };
  }

  const flightKey = `${k}:${version ?? ""}`;
  let p = inflight.get(flightKey);
  if (!p) {
    p = (async () => {
      const loaded = await load();
      const avatar: CachedAvatar | null = loaded
        ? {
            bytes: loaded.bytes,
            mime: loaded.mime,
            etag: `"disk-${createHash("md5").update(loaded.bytes).digest("hex")}"`,
          }
        : null;
      put(k, { avatar, version, fetchedAt: Date.now() });
      return avatar;
    })().finally(() => {
      inflight.delete(flightKey);
    });
    inflight.set(flightKey, p);
  }
  return { avatar: await p, hit: false };
}

/** Drop the cached avatar for one identity (call after an avatar write). */
export function invalidateCachedAvatar(hostId: number, identityKey: string): void {
  remove(entryKey(hostId, identityKey));
}

export function _resetAvatarCacheForTest(): void {
  entries.clear();
  inflight.clear();
  totalBytes = 0;
}

export function _avatarCacheStatsForTest(): { entries: number; totalBytes: number } {
  return { entries: entries.size, totalBytes };
}
