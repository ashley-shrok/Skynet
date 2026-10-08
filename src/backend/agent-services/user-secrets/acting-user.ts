/**
 * agent-services/user-secrets/acting-user.ts — which Skynet user a request
 * acts for.
 *
 * A request arrives from a host, not a person. The people who can be behind
 * it are the host's registrants: every user with a host row for the same
 * machine (same ip + port + login; host rows are per-user, so a shared box
 * has one row per person who added it). Rules:
 *
 *   - `as_user` given (skynet-service --as <username>): that user, if they
 *     registered this host. Agents on a shared host may act for any of its
 *     registrants, the same trust agent-phone uses for who it may call.
 *   - otherwise, if exactly one user registered the host: that user.
 *   - otherwise: `ambiguous_user`, naming the registrants so the agent can
 *     retry with --as.
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../database/db/index.js";
import { hosts, users } from "../../database/db/schema.js";
import type { ActingUserResolution } from "../engine/engine.js";
import type { ActingUser } from "../engine/types.js";

/** Every user who registered the machine behind host row `hostIdNum`. */
export async function listHostRegistrants(
  hostIdNum: number,
): Promise<ActingUser[]> {
  const db = getDb();
  const origin = (
    await db
      .select({ ip: hosts.ip, port: hosts.port, username: hosts.username })
      .from(hosts)
      .where(eq(hosts.id, hostIdNum))
      .limit(1)
  )[0];
  if (!origin) return [];

  const sameMachine = await db
    .select({
      userId: hosts.userId,
      ip: hosts.ip,
      port: hosts.port,
      username: hosts.username,
    })
    .from(hosts)
    .where(eq(hosts.ip, origin.ip));
  const userIds = [
    ...new Set(
      sameMachine
        .filter((h) => h.port === origin.port && h.username === origin.username)
        .map((h) => h.userId),
    ),
  ];
  if (userIds.length === 0) return [];

  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, userIds));
  return rows.sort((a, b) => a.username.localeCompare(b.username));
}

export async function resolveActingUser(
  hostIdNum: number,
  asUser: string | undefined,
): Promise<ActingUserResolution> {
  const registrants = await listHostRegistrants(hostIdNum);

  if (asUser !== undefined) {
    const match = registrants.find((u) => u.username === asUser);
    if (match) return { ok: true, user: match };
    const exists = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, asUser))
      .limit(1);
    return exists.length === 0
      ? {
          ok: false,
          code: "unknown_user",
          message: `no Skynet user named "${asUser}"`,
        }
      : {
          ok: false,
          code: "not_permitted",
          message: `user "${asUser}" has not registered this host in Skynet`,
        };
  }

  if (registrants.length === 1) return { ok: true, user: registrants[0] };
  if (registrants.length === 0) {
    return {
      ok: false,
      code: "not_permitted",
      message: "no Skynet user has registered this host",
    };
  }
  return {
    ok: false,
    code: "ambiguous_user",
    message: `this host is registered by several Skynet users (${registrants
      .map((u) => u.username)
      .join(", ")}); say which one with --as <username>`,
  };
}
