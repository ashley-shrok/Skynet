/**
 * host-id-resolver.ts
 *
 * Maps a watcher's declared hostname (e.g. 'thenasty') to the Skynet database's
 * host record so frontend row keys use the same host identifier.
 *
 * Comparison is case-insensitive — both sides are lowercased before matching.
 */
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { sql } from "drizzle-orm";
import { systemLogger } from "../utils/logger.js";

export interface HostRecord {
  id: string;
  name: string;
}

/**
 * Look up a Skynet host record by hostname.
 * Returns `{ id, name }` if found, `null` if no matching record exists.
 * Name comparison is case-insensitive.
 */
export async function resolveHostRecordByName(
  name: string,
): Promise<HostRecord | null> {
  const lowerName = name.toLowerCase();

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: hosts.id,
        name: hosts.name,
      })
      .from(hosts)
      .where(sql`LOWER(${hosts.name}) = ${lowerName}`)
      .limit(1);

    if (rows.length === 0) {
      systemLogger.warn("Fleet-status host lookup miss — hostname not in DB", {
        operation: "fleet_status_host_lookup_miss",
        hostname: name,
      });
      return null;
    }

    const row = rows[0];
    return {
      id: String(row.id),
      name: row.name ?? name,
    };
  } catch (err) {
    systemLogger.warn("Fleet-status host lookup error", {
      operation: "fleet_status_host_lookup_error",
      hostname: name,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
