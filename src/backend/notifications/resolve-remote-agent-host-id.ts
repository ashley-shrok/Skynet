/**
 * resolveRemoteAgentHostId — mxid → fleet hostId resolver for agents whose
 * identity folder lives on a PEER box, not the box running Skynet.
 *
 * resolveAgentHostId only probes this box's `~/fleet/identities/` and
 * `~/fleet/identities-archive/`. In a multi-box fleet, agents on peer boxes
 * DM the user through the same homeserver and are members of the same
 * agents-registry room, so the classifier marks their DMs `harness_dm` —
 * but the local probe misses and the push was dropped
 * (`push_trigger_tick_no_host_id`). This module is the fallback the
 * push-trigger starter chains after the local probe.
 *
 * Resolution:
 *   1. Match mxid against `@localpart:server`; reject anything that fails
 *      IDENTITY_KEY_RE (the localpart is interpolated into a remote shell
 *      command — validate-then-interpolate, same as identity-exists-on-host).
 *   2. List candidate hostIds: SSH-enabled hosts that are NOT local
 *      (local hosts were already covered by resolveAgentHostId).
 *   3. Probe every candidate in parallel for `identities/<localpart>` or
 *      `identities-archive/<localpart>` (the archive matters for the same
 *      reason as the local resolver: identities DM the user and then
 *      archive themselves). The probe resolves the host as `userId`, so a
 *      host the user cannot access never matches — the returned hostId is
 *      always one the user's tap can route to.
 *   4. Lowest matching hostId wins (deterministic when two of the user's
 *      host rows point at the same box).
 *
 * Results are cached per (userId, localpart): a hit for
 * REMOTE_HOST_ID_HIT_TTL_MS, a miss for REMOTE_HOST_ID_MISS_TTL_MS. The
 * loop ticks every 2s and probes departed senders on every event, so
 * without the cache a single unresolvable sender would fan SSH out to
 * every host on every tick. Concurrent lookups for the same key share one
 * in-flight probe.
 *
 * Never throws. All failure modes resolve to null.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import {
  IDENTITY_KEY_RE,
  isLocalHostId,
} from "../claude-session/identity-artifact-reader.js";
import { databaseLogger } from "../utils/logger.js";

const MXID_PATTERN = /^@([^:]+):(.+)$/;

/** SSH connect + exec budget per host probe. */
const REMOTE_PROBE_TIMEOUT_MS = 3000;

/** How long a resolved hostId is trusted before re-probing. */
export const REMOTE_HOST_ID_HIT_TTL_MS = 10 * 60_000;

/**
 * How long a miss is remembered. Short, so an identity born on a peer box
 * starts pushing within a minute, but long enough that an unresolvable
 * sender doesn't trigger an SSH fanout on every 2s tick.
 */
export const REMOTE_HOST_ID_MISS_TTL_MS = 60_000;

export interface RemoteAgentHostIdDeps {
  /** Candidate hostIds to probe — remote (non-local) SSH-enabled hosts. */
  listCandidateHostIds(): Promise<number[]>;
  /**
   * True when `localpart` has a live or archived identity folder on
   * `hostId`, probed with `userId`'s access. May throw; the caller treats
   * a throw as "not on this host".
   */
  probeHost(hostId: number, userId: string, localpart: string): Promise<boolean>;
  now(): number;
}

type CacheEntry = { hostId: number | null; expiresAt: number };

/**
 * Build a resolver with its own cache. Exported for tests; production uses
 * the module-level `resolveRemoteAgentHostId` below.
 */
export function createRemoteAgentHostIdResolver(
  deps: RemoteAgentHostIdDeps,
): (mxid: string, userId: string) => Promise<number | null> {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<number | null>>();

  async function lookup(localpart: string, userId: string): Promise<number | null> {
    let candidates: number[];
    try {
      candidates = await deps.listCandidateHostIds();
    } catch (err) {
      databaseLogger.warn(
        "resolveRemoteAgentHostId — candidate host list failed",
        {
          operation: "resolve_remote_agent_host_id_list_failed",
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      return null;
    }

    const sorted = [...new Set(candidates)].sort((a, b) => a - b);
    const matches = await Promise.all(
      sorted.map((hostId) =>
        deps.probeHost(hostId, userId, localpart).catch(() => false),
      ),
    );
    const index = matches.indexOf(true);
    return index === -1 ? null : sorted[index];
  }

  return async function resolveRemote(mxid, userId) {
    const match = mxid.match(MXID_PATTERN);
    if (!match) return null;
    const localpart = match[1].toLowerCase();
    if (!IDENTITY_KEY_RE.test(localpart)) return null;

    const key = `${userId}::${localpart}`;
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > deps.now()) {
      return cached.hostId;
    }

    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;

    const p = lookup(localpart, userId)
      .catch(() => null)
      .then((hostId) => {
        cache.set(key, {
          hostId,
          expiresAt:
            deps.now() +
            (hostId === null ? REMOTE_HOST_ID_MISS_TTL_MS : REMOTE_HOST_ID_HIT_TTL_MS),
        });
        return hostId;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

async function listRemoteSshHostIds(): Promise<number[]> {
  const rows = await getDb()
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.enableSsh, true));
  return rows.map((r) => r.id).filter((id) => !isLocalHostId(id));
}

async function probeRemoteHost(
  hostId: number,
  userId: string,
  localpart: string,
): Promise<boolean> {
  // Null when the host is unknown or the user lacks access to it.
  const host = await resolveHostById(hostId, userId);
  if (!host) return false;

  // SHELL SAFETY: localpart passed IDENTITY_KEY_RE (/^[a-z0-9_-]{1,64}$/)
  // before reaching here, so raw interpolation inside double quotes is safe.
  // `! -L` mirrors the local resolver's lstat refusal to follow symlinks.
  const cmd =
    `for d in "$HOME/fleet/identities/${localpart}" "$HOME/fleet/identities-archive/${localpart}"; do ` +
    `if [ -d "$d" ] && [ ! -L "$d" ]; then echo found; break; fi; done`;

  return getHostSemaphore(hostId).run(async () => {
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      conn = await connectOneShot(
        host as unknown as Parameters<typeof connectOneShot>[0],
        REMOTE_PROBE_TIMEOUT_MS,
      );
      const output = await Promise.race([
        execCommand(conn, cmd),
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`remote probe timeout after ${REMOTE_PROBE_TIMEOUT_MS}ms`)),
            REMOTE_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      return output.trim() === "found";
    } catch (err) {
      databaseLogger.debug("resolveRemoteAgentHostId — host probe failed", {
        operation: "resolve_remote_agent_host_id_probe_failed",
        hostId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  });
}

/**
 * Resolve a sender mxid to the hostId of the peer box holding its identity
 * folder, as seen by `userId`. Returns null on any failure mode.
 */
export const resolveRemoteAgentHostId = createRemoteAgentHostIdResolver({
  listCandidateHostIds: listRemoteSshHostIds,
  probeHost: probeRemoteHost,
  now: () => Date.now(),
});
