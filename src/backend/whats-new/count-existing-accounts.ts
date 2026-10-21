// What's new — count every account that has no seen record yet, at server
// start. Without this, an existing account would only be counted on its
// next visit, silently swallowing any note that shipped in between (e.g. the
// feature rolls out, Zoey doesn't log in, the first note ships, she logs in
// and the note is counted as already seen). Runs every boot; after the first
// boot on this feature only accounts created since the last boot that have
// never opened the app are still uncounted, and treating them as "no
// history" is the agreed behaviour for new accounts.

import type Database from "better-sqlite3";
import type { WhatsNewNote } from "./notes.js";

export function countUncountedAccounts(
  sqlite: Database.Database,
  notes: readonly WhatsNewNote[],
): number {
  const ids = JSON.stringify(notes.map((n) => n.id));
  const tx = sqlite.transaction(() => {
    const inserted = sqlite
      .prepare(
        `INSERT INTO user_preferences (user_id, whats_new_seen)
         SELECT id, ? FROM users
         WHERE id NOT IN (SELECT user_id FROM user_preferences)`,
      )
      .run(ids).changes;
    const updated = sqlite
      .prepare(
        `UPDATE user_preferences SET whats_new_seen = ? WHERE whats_new_seen IS NULL`,
      )
      .run(ids).changes;
    return inserted + updated;
  });
  return tx();
}
