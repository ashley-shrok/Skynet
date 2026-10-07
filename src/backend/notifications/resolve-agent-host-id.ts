/**
 * resolveAgentHostId — mxid → local fleet hostId resolver for push routing.
 *
 * Push notifications need to carry a numeric fleet hostId in the payload so
 * the frontend's tap handler can route to the correct harness view without
 * depending on the phone's cached identity list being loaded (see
 * shape-notifications-to-harness.md § Philosophy: "The tap is deterministic.
 * The payload carries what the phone needs to route.").
 *
 * The push-trigger loop fires only for LOCAL agents' outbound DMs to the
 * local human user (D-01/D-02 in push-trigger-loop.ts), so the sender's
 * identity file lives on this box's `~/fleet/identities/` filesystem, and
 * its home host is one of the entries in the IDENTITIES_LOCAL_HOST_IDS
 * env var (parsed once at module load by identity-artifact-reader.ts).
 *
 * Resolution:
 *   1. Match mxid against `@localpart:server`; malformed → null.
 *   2. `fs.lstat` the identity folder under getLocalIdentitiesRoot(), then
 *      under getLocalArchivedIdentitiesRoot(); missing from both → null.
 *      The archive probe matters because identities routinely DM the user
 *      and then archive themselves — the push loop can observe that final
 *      DM after the folder has moved to `~/fleet/identities-archive/`.
 *      This is the belt-and-suspenders check that ensures we don't
 *      ship a hostId in the payload for an mxid whose identity file isn't
 *      actually on this box (D-01/D-02 shouldn't allow that case, but the
 *      resolver stays honest even if the classifier ever regresses).
 *   3. Return the first entry from LOCAL_HOST_IDS (production has exactly
 *      one entry per box; a multi-entry deploy would need a per-hostId
 *      probe, which we can add if that config ever materializes).
 *
 * Never throws. All failure modes return null; the caller (push-trigger-loop)
 * treats null as "cannot route, drop the push."
 */

import { lstat as fspLstat } from "fs/promises";
import path from "path";
import {
  getLocalIdentitiesRoot,
  IDENTITY_KEY_RE,
} from "../claude-session/identity-artifact-reader.js";
import { getLocalArchivedIdentitiesRoot } from "../claude-session/list-archived-identity-keys.js";
import { databaseLogger } from "../utils/logger.js";

const MXID_PATTERN = /^@([^:]+):(.+)$/;

/** Parsed once at module load. Same env var as identity-artifact-reader.ts. */
const LOCAL_HOST_IDS: number[] = (() => {
  const raw = process.env.IDENTITIES_LOCAL_HOST_IDS ?? "";
  const parsed: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) continue;
    parsed.push(n);
  }
  return parsed;
})();

// If the env var contains multiple hostIds, we still pick the FIRST for
// routing (the classifier is local-only per D-01/D-02 and production has
// exactly one entry per box). Warn once at module load so ops sees the
// ambiguity — a legitimately-multi-hostId deploy would need a per-hostId
// probe here, not the current first-wins fallback.
if (LOCAL_HOST_IDS.length > 1) {
  databaseLogger.warn(
    "resolveAgentHostId — IDENTITIES_LOCAL_HOST_IDS has multiple entries; first-wins used for push routing",
    {
      operation: "resolve_agent_host_id_multi_entry_env",
      count: LOCAL_HOST_IDS.length,
      chosenHostId: LOCAL_HOST_IDS[0],
    },
  );
}

/**
 * Resolve a sender mxid to the local fleet hostId whose identity folder
 * holds this identity. Returns null on any failure mode.
 */
export async function resolveAgentHostId(mxid: string): Promise<number | null> {
  const match = mxid.match(MXID_PATTERN);
  if (!match) return null;

  const localpart = match[1].toLowerCase();
  if (localpart.length === 0) return null;
  if (!IDENTITY_KEY_RE.test(localpart)) return null;

  if (LOCAL_HOST_IDS.length === 0) {
    databaseLogger.warn(
      "resolveAgentHostId — IDENTITIES_LOCAL_HOST_IDS is empty; cannot route push",
      {
        operation: "resolve_agent_host_id_no_local_hosts",
        mxid,
      },
    );
    return null;
  }

  const found =
    (await isIdentityDirIn(getLocalIdentitiesRoot(), localpart)) ||
    (await isIdentityDirIn(getLocalArchivedIdentitiesRoot(), localpart));
  if (!found) return null;

  return LOCAL_HOST_IDS[0];
}

/** True when `<root>/<localpart>` is a real (non-symlink) directory. */
async function isIdentityDirIn(root: string, localpart: string): Promise<boolean> {
  const identityDir = path.join(root, localpart);

  // Belt-and-suspenders against a hypothetical classifier regression: even
  // though IDENTITY_KEY_RE already rules out `.` and `/` so path.join
  // cannot escape the root, we still normalize the resolved path and
  // prefix-check it before touching the filesystem — if either ever
  // loosens, the check fails closed rather than following a symlink or
  // traversal out of the root. lstat (not stat) additionally refuses to
  // follow a symlinked identity folder.
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(identityDir);
  if (
    resolvedDir !== resolvedRoot &&
    !resolvedDir.startsWith(resolvedRoot + path.sep)
  ) {
    return false;
  }

  try {
    const stats = await fspLstat(identityDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
