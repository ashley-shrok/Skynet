/**
 * Machine identity for ssh_data rows.
 *
 * Skynet keeps one ssh_data row per (user, box): two users who both have a
 * box each own a separate row with its own id. `machine_id` ties those rows
 * together so a URL carrying a host id (app pane, widget pane, serve
 * subdomain) can be resolved to whichever row the *viewer* owns for the same
 * physical machine.
 *
 * Rules:
 *  - Same machine = same LOWER(TRIM(ip)) + same port. The SSH login user is
 *    deliberately ignored: ports belong to the box, not to a login.
 *  - A group's machine_id is the id of the first row created for it. ids are
 *    AUTOINCREMENT, so a machine_id is never reused by an unrelated row.
 *  - Maintained entirely by triggers, so every insert path (host create,
 *    bulk import, DB restore) is covered without app-code changes.
 *  - Re-addressing a row (ip/port change) moves it into the matching group,
 *    or a group of its own. If it anchored its old group, the remaining rows
 *    are re-anchored to the oldest of them so ids never collide.
 */
import type { Database } from "better-sqlite3";

const SAME_MACHINE = (a: string, b: string) =>
  `LOWER(TRIM(${a}.ip)) = LOWER(TRIM(${b}.ip)) AND ${a}.port IS ${b}.port`;

export function applyMachineIdSchema(sqlite: Database): void {
  try {
    sqlite.prepare("SELECT machine_id FROM ssh_data LIMIT 1").get();
  } catch {
    sqlite.exec("ALTER TABLE ssh_data ADD COLUMN machine_id INTEGER");
  }

  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_ssh_data_machine_user ON ssh_data(machine_id, user_id)",
  );

  backfillMachineIds(sqlite);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS ssh_data_machine_id_on_insert
    AFTER INSERT ON ssh_data
    WHEN NEW.machine_id IS NULL
    BEGIN
      UPDATE ssh_data SET machine_id = COALESCE(
        (SELECT o.machine_id FROM ssh_data o
          WHERE o.id != NEW.id AND o.machine_id IS NOT NULL
            AND ${SAME_MACHINE("o", "NEW")}
          ORDER BY o.id LIMIT 1),
        NEW.id)
      WHERE id = NEW.id;
    END;
  `);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS ssh_data_machine_id_on_readdress
    AFTER UPDATE OF ip, port ON ssh_data
    WHEN NOT (${SAME_MACHINE("NEW", "OLD")})
    BEGIN
      UPDATE ssh_data SET machine_id = (
        SELECT MIN(o.id) FROM ssh_data o
          WHERE o.machine_id = OLD.machine_id AND o.id != NEW.id)
      WHERE OLD.machine_id = NEW.id
        AND machine_id = OLD.machine_id AND id != NEW.id;
      UPDATE ssh_data SET machine_id = COALESCE(
        (SELECT o.machine_id FROM ssh_data o
          WHERE o.id != NEW.id AND o.machine_id IS NOT NULL
            AND ${SAME_MACHINE("o", "NEW")}
          ORDER BY o.id LIMIT 1),
        NEW.id)
      WHERE id = NEW.id;
    END;
  `);
}

/** Assign machine_id to any row missing one, oldest rows first. */
export function backfillMachineIds(sqlite: Database): number {
  const rows = sqlite
    .prepare("SELECT id, ip, port, machine_id FROM ssh_data ORDER BY id")
    .all() as Array<{
    id: number;
    ip: string | null;
    port: number | null;
    machine_id: number | null;
  }>;

  const keyOf = (r: { ip: string | null; port: number | null }) =>
    `${(r.ip ?? "").trim().toLowerCase()}|${r.port ?? ""}`;

  const groups = new Map<string, number>();
  for (const r of rows) {
    if (r.machine_id !== null && !groups.has(keyOf(r))) {
      groups.set(keyOf(r), r.machine_id);
    }
  }

  const update = sqlite.prepare(
    "UPDATE ssh_data SET machine_id = ? WHERE id = ?",
  );
  let assigned = 0;
  const run = sqlite.transaction(() => {
    for (const r of rows) {
      if (r.machine_id !== null) continue;
      const key = keyOf(r);
      const machineId = groups.get(key) ?? r.id;
      groups.set(key, machineId);
      update.run(machineId, r.id);
      assigned++;
    }
  });
  run();
  return assigned;
}
