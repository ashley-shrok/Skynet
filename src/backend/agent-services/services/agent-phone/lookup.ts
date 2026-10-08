/**
 * agent-phone DB lookups: who to call, and whether this host may call them.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../../../database/db/index.js";
import { hosts, users } from "../../../database/db/schema.js";

/** `{ id, phoneE164 }` for a Skynet username, or null if there is no such user. */
export async function getUserByUsername(
  username: string,
): Promise<{ id: string; phoneE164: string | null } | null> {
  const rows = await getDb()
    .select({ id: users.id, phoneE164: users.phoneE164 })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, phoneE164: row.phoneE164 ?? null };
}

/**
 * True when `userId` has registered the machine behind host row
 * `hostIdNum` — either they own that row, or they own another row that
 * points at the same machine (same ip + port + login). `ssh_data` rows are
 * per-user, so a box two users both registered appears as two rows, and
 * the scan that claims a request file may be either one.
 *
 * This gates outbound calls: an agent may only phone the people who
 * registered the host it runs on.
 */
export async function userHasRegisteredHost(
  userId: string,
  hostIdNum: number,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({
      userId: hosts.userId,
      ip: hosts.ip,
      port: hosts.port,
      username: hosts.username,
    })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);
  const origin = rows[0];
  if (!origin) return false;
  if (origin.userId === userId) return true;
  const sameMachine = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(
      and(
        eq(hosts.userId, userId),
        eq(hosts.ip, origin.ip),
        eq(hosts.port, origin.port),
        eq(hosts.username, origin.username),
      ),
    )
    .limit(1);
  return sameMachine.length > 0;
}
