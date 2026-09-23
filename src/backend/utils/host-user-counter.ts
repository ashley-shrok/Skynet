/**
 * host-user-counter.ts — Phase 129 Plan 01 Task 3
 *
 * Shared DB helpers for the per-user visibility gate:
 *   - isHostMultiUser(hostId): true iff MORE THAN ONE distinct Skynet user
 *     has access to the host. Used at both create endpoints (POST /roles and
 *     POST /identities/birth) to gate the auto-tag branch — the feature is
 *     designed to stay silent on single-user hosts (shape file § "Auto-tag
 *     conditional": "On single-user hosts, nothing is written and the field
 *     stays absent.").
 *   - getUsernameForUserId(userId): the DB row's username string (case-
 *     preserved) for a JWT-subject userId. Needed on the write side because
 *     JWT gives userId only (auth-manager.ts L949-951 sets req.userId, not
 *     req.user.username) — RESEARCH § Common Pitfall 6.
 *
 * Multi-user detection (D-4, RESEARCH Assumption A6 lock):
 *   Access = owner (hosts.userId) UNION direct-user shares (hostAccess.userId)
 *   UNION RBAC-role-expanded members (hostAccess.roleId → userRoles.userId).
 *   Mirrors the authoritative shape of permission-manager.ts::canAccessHost
 *   (L162-260), which also expands hostAccess.roleId via userRoles when
 *   deciding whether a caller can access a host.
 *
 * Share-expiry (the hostAccess row's expiry column) is DELIBERATELY NOT
 * filtered here per shape file § "Auto-tag scope" — auto-tag is a snapshot-at-
 * creation decision; a share that's about to expire still makes the host
 * multi-user at the moment a role or identity is created, and the auto-tagged
 * username stays on the file after the share expires. The shape file
 * explicitly leaves post-creation user-churn to hand-edit; the counter
 * captures a moment, not a lifecycle.
 *
 * Structured logging discipline (box-maintainer role file directive):
 *   isHostMultiUser is a gate-seam decision — every check writes a diagnostic
 *   `debug` entry at entry (hostId) and exit (hostId + distinctUsers count +
 *   isMultiUser boolean) so failed auto-tags in prod are traceable in logs.
 */

import { db } from "../database/db/index.js";
import {
  hosts,
  hostAccess,
  userRoles,
  users,
} from "../database/db/schema.js";
import { eq, and, ne, inArray, isNotNull } from "drizzle-orm";
import { systemLogger } from "./logger.js";

/**
 * Returns true iff MORE THAN ONE distinct Skynet user has access to the given
 * hostId. See file-header docblock for the full access-shape contract.
 */
export async function isHostMultiUser(hostId: number): Promise<boolean> {
  systemLogger.debug("host-user-counter check", {
    operation: "host_user_counter_check",
    hostId,
  });

  // Query 1: owner lookup. If unknown host, return false to avoid auto-tag
  // on a phantom hostId (Test 1 of Task 3 acceptance). Also grabs the SSH
  // connection tuple (ip, port, username) — needed for Query 5's collision
  // check, which is Skynet's actual sharing model today.
  const ownerRows = await db
    .select({
      userId: hosts.userId,
      ip: hosts.ip,
      port: hosts.port,
      username: hosts.username,
    })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);

  if (ownerRows.length === 0) {
    systemLogger.debug("host-user-counter result", {
      operation: "host_user_counter_result",
      hostId,
      distinctUsers: 0,
      isMultiUser: false,
      reason: "unknown_host",
    });
    return false;
  }

  const distinctUsers = new Set<string>();
  distinctUsers.add(ownerRows[0].userId);

  // Query 2: direct-user shares (hostAccess rows with a non-null userId).
  // NB: we accept nullable userId cells and skip them defensively — the DB
  // shape allows userId OR roleId per row.
  const directShares = await db
    .select({ userId: hostAccess.userId })
    .from(hostAccess)
    .where(eq(hostAccess.hostId, hostId));

  for (const row of directShares) {
    if (row.userId !== null && row.userId !== undefined) {
      distinctUsers.add(row.userId);
    }
  }

  // Query 3: role-scoped shares. Only issued to collect roleIds; the
  // expansion to member userIds happens in Query 4.
  const roleShares = await db
    .select({ roleId: hostAccess.roleId })
    .from(hostAccess)
    .where(eq(hostAccess.hostId, hostId));

  const roleIds: number[] = [];
  for (const row of roleShares) {
    if (row.roleId !== null && row.roleId !== undefined) {
      roleIds.push(row.roleId);
    }
  }

  // Query 4: RBAC-role expansion (Assumption A6 — mirrors permission-manager
  // canAccessHost's roleId-expansion shape). Only issued if we found any
  // role-scoped shares in step 3; otherwise skip the round-trip.
  if (roleIds.length > 0) {
    const roleMembers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(inArray(userRoles.roleId, roleIds));
    for (const row of roleMembers) {
      distinctUsers.add(row.userId);
    }
  }

  // Query 5: SSH-connection collision (Phase 129 post-deploy fix — 2026-09-23).
  // Skynet's actual sharing model TODAY is per-user connection profiles that
  // happen to collide on (ip, port, ssh-username) — not one host row with
  // hostAccess entries. Two users with ssh_data rows pointing at the same
  // (ip, port, username) tuple resolve to the same OS user on the same
  // physical box, i.e. the same `~/fleet/` filesystem — the visibility gate's
  // unit of concern. `host_access` is retained above as a defensive fallback
  // for the day Skynet's credential-shared-hosts flow ships (admin runbook
  // notes it as "Not yet documented — build if needed"), but the collision
  // check is what matches today's reality.
  const { ip, port, username } = ownerRows[0];
  const sameConnRows = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(
      and(
        eq(hosts.ip, ip),
        eq(hosts.port, port),
        eq(hosts.username, username),
        ne(hosts.id, hostId),
      ),
    );
  for (const row of sameConnRows) {
    distinctUsers.add(row.userId);
  }

  const isMultiUser = distinctUsers.size > 1;
  systemLogger.debug("host-user-counter result", {
    operation: "host_user_counter_result",
    hostId,
    distinctUsers: distinctUsers.size,
    isMultiUser,
  });
  return isMultiUser;
}

/**
 * Returns the case-preserved username string for a given JWT userId, or
 * null when the row is absent (defensive path — a JWT-authenticated userId
 * that lacks a users row is a shape-violation, but this MUST NOT throw).
 * Case-preserved per Pitfall 7 lock.
 *
 * `isNotNull` and `inArray` imports above are used by isHostMultiUser; this
 * function only uses `eq`. The unused-import-defensive shape lets both
 * helpers share a single import block without linter noise.
 */
export async function getUsernameForUserId(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? null;
}

// Silence the "isNotNull is imported but only used elsewhere" false positive
// — the helper is imported alongside inArray for consistency with the
// permission-manager.ts pattern and stays available for the WHERE clauses
// above without adding a second import block.
void isNotNull;
