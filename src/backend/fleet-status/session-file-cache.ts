/**
 * session-file-cache.ts
 *
 * Shared module-level cache that maps a (hostId, tmuxSession) pair to the
 * most-recently-resolved session file for that identity on that host.
 *
 * DESIGN PRINCIPLES (Phase 55 shape):
 * - No lifecycle. No TTL. No start/stop. No invalidation protocol beyond
 *   overwrite-on-write (last-writer-wins).
 * - Opportunistic read: reads for absent keys return null (no throw).
 * - Single-tenant, process-local: the Map lives only in this Node process.
 *   Cross-user / cross-process concerns are explicitly out of scope (T-55-02).
 * - Bounded growth: only identity-shaped tmux sessions are keyed here; fleet
 *   size is typically <20 identities (T-55-03).
 *
 * KEY FORMAT: `${String(hostId)}::${tmuxSession}`
 * Both writer (fleet-status poller, string hostId from HostRecord.id) and
 * reader (claude-session-attach, numeric hostId from connectToPane message)
 * coerce hostId via String() before joining — same entry, always (T-55-01).
 *
 * CALL SHAPE: always (hostId, tmuxSession). No exported buildKey() helper.
 * Prevents accidental key-format drift between call sites.
 */

export interface SessionFileCacheEntry {
  sessionFile: string;
  pid: number;
  /** Date.now() at write time — for downstream observability only; no TTL logic. */
  writtenAt: number;
}

/** Process-local singleton. NOT exported — only the accessors below may mutate it. */
const cache = new Map<string, SessionFileCacheEntry>();

/** Build the canonical cache key (coerces hostId at both write and read). */
function buildKey(hostId: string | number, tmuxSession: string): string {
  return `${String(hostId)}::${tmuxSession}`;
}

/**
 * Write (or overwrite) the cache entry for a given (hostId, tmuxSession) pair.
 * Stamps writtenAt with Date.now(). Last-writer-wins; no merge, no TTL.
 */
export function writeSessionFileCache(
  hostId: string | number,
  tmuxSession: string,
  entry: { sessionFile: string; pid: number },
): void {
  cache.set(buildKey(hostId, tmuxSession), {
    sessionFile: entry.sessionFile,
    pid: entry.pid,
    writtenAt: Date.now(),
  });
}

/**
 * Read the cache entry for (hostId, tmuxSession).
 * Returns null on cold-start or if the key has never been written — no throw.
 */
export function readSessionFileCache(
  hostId: string | number,
  tmuxSession: string,
): SessionFileCacheEntry | null {
  return cache.get(buildKey(hostId, tmuxSession)) ?? null;
}

/**
 * Remove all entries whose key starts with `${String(hostId)}::`.
 * Leaves entries for other hostIds untouched.
 */
export function clearSessionFileCacheForHost(hostId: string | number): void {
  const prefix = `${String(hostId)}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * TEST ONLY — do not call from production code paths.
 * Empties the entire cache so each test runs from a clean slate.
 */
export function __clearAllSessionFileCacheForTests(): void {
  cache.clear();
}
