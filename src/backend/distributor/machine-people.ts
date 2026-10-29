/**
 * machine-people.ts — the people file written to every managed host.
 *
 * Each sweep's bootstrap writes ~/fleet/host/people.md: everyone with access
 * to the machine, with their relay ID. The machine-people SessionStart hook
 * (substrate/scripts/machine-people.sh) hands it to every Claude session on
 * the host, so agents know the relay IDs of the people they work for on any
 * instance without anything hand-written.
 *
 * "Access" is the same rule host-user-counter.ts uses to decide a machine is
 * shared — owner, direct shares, members of groups it's shared with, and
 * anyone who added the same box on their own — taken across every host row
 * that reaches the same home (same ip/port/SSH user; machineId is NOT used,
 * since it groups different logins whose homes, and so files, differ), so
 * every such row's sweep writes the same bytes. Expired shares don't count.
 *
 * The file states facts only: no instructions, and no product name. Every
 * field is reduced to one plain line before it's written — usernames are
 * user-chosen, and this file is read into every session on the machine.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { hostAccess, hosts, userRoles, users } from "../database/db/schema.js";
import { systemLogger } from "../utils/logger.js";
export { MACHINE_PEOPLE_REL_PATH } from "./run-bootstrap.js";

export const MACHINE_PEOPLE_HEADING =
  "People on this machine — this list of everyone with access to this machine is updated automatically.";

export type MachinePerson = { username: string; mxid: string | null };

const FIELD_MAX = 128;

/** One plain line: control characters (newlines included) become spaces, length capped. */
export function plainField(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, FIELD_MAX);
}

export function renderMachinePeopleFile(people: readonly MachinePerson[]): string {
  const lines = [...people]
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((p) => {
      const mxid = p.mxid ? plainField(p.mxid) : "";
      return `- ${plainField(p.username)} · ${mxid ? `relay ID ${mxid}` : "no relay ID"}`;
    });
  return [MACHINE_PEOPLE_HEADING, "", ...lines].join("\n") + "\n";
}

function isUnexpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t > nowMs;
}

/** Everyone with access to the box the given host row belongs to. */
export async function listMachinePeople(
  hostId: number,
  nowMs: number = Date.now(),
  database: Pick<typeof db, "select"> = db,
): Promise<MachinePerson[] | null> {
  const seed = await database
    .select({
      ip: hosts.ip,
      port: hosts.port,
      username: hosts.username,
    })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  if (seed.length === 0) return null;
  const { ip, port, username } = seed[0];

  // IP compared the way machine-id-migration.ts does (LOWER(TRIM(ip))).
  const rows = await database
    .select({ id: hosts.id, userId: hosts.userId })
    .from(hosts)
    .where(
      and(
        sql`LOWER(TRIM(${hosts.ip})) = ${ip.trim().toLowerCase()}`,
        eq(hosts.port, port),
        eq(hosts.username, username),
      ),
    );
  const rowIds = rows.map((r) => r.id);
  if (!rowIds.includes(hostId)) rowIds.push(hostId);

  const userIds = new Set<string>(rows.map((r) => r.userId));

  const grants = await database
    .select({ userId: hostAccess.userId, roleId: hostAccess.roleId, expiresAt: hostAccess.expiresAt })
    .from(hostAccess)
    .where(inArray(hostAccess.hostId, rowIds));
  const roleIds: number[] = [];
  for (const g of grants) {
    if (!isUnexpired(g.expiresAt, nowMs)) continue;
    if (g.userId != null) userIds.add(g.userId);
    if (g.roleId != null) roleIds.push(g.roleId);
  }
  if (roleIds.length > 0) {
    const members = await database
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(inArray(userRoles.roleId, roleIds));
    for (const m of members) userIds.add(m.userId);
  }

  if (userIds.size === 0) return [];
  const people = await database
    .select({ username: users.username, mxid: users.mxid })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return people.map((p) => ({ username: p.username, mxid: p.mxid ?? null }));
}

/**
 * The people file's bytes for a host, or null when it can't be worked out
 * (unknown host, DB error) — null means "leave the file as it is", so a
 * transient failure never blanks the list. Never throws.
 */
export async function machinePeopleFileFor(hostId: string): Promise<string | null> {
  const id = parseInt(hostId, 10);
  if (!Number.isFinite(id)) return null;
  try {
    const people = await listMachinePeople(id);
    if (people === null) return null;
    return renderMachinePeopleFile(people);
  } catch (err) {
    systemLogger.warn("machine-people: couldn't list the people on a host", {
      operation: "machine_people_list_failed",
      fleetHostId: hostId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
