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

/**
 * Assign machine_id to any row missing one, oldest rows first. Runs the same
 * UPDATE as the insert trigger (same SAME_MACHINE expression) so backfilled
 * and newly inserted rows can never be grouped by different rules.
 */
export function backfillMachineIds(sqlite: Database): number {
  const pending = sqlite
    .prepare("SELECT id FROM ssh_data WHERE machine_id IS NULL ORDER BY id")
    .all() as Array<{ id: number }>;

  const assign = sqlite.prepare(`
    UPDATE ssh_data SET machine_id = COALESCE(
      (SELECT o.machine_id FROM ssh_data o, ssh_data r
        WHERE r.id = @id AND o.id != r.id AND o.machine_id IS NOT NULL
          AND ${SAME_MACHINE("o", "r")}
        ORDER BY o.id LIMIT 1),
      @id)
    WHERE id = @id
  `);

  sqlite.transaction(() => {
    for (const { id } of pending) assign.run({ id });
  })();
  return pending.length;
}
