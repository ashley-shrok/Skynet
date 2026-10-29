// What's new — counting accounts ("seen every note that exists right now").
//
// A new account is counted the moment it is created (countNewAccount, called
// from the user-insert transactions), so a note that ships before its first
// visit still shows. Accounts that predate the feature are counted at server
// start (countUncountedAccounts) — otherwise they'd only be counted on their
// next visit, silently swallowing any note shipped in between (the feature
// rolls out, a user doesn't log in, the first note ships, they log in and the
// note is counted as already seen). The boot pass is idempotent: once every
// account has a record it touches nothing.

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

/**
 * Counts one just-created account. Safe inside the caller's transaction and
 * never throws — a failure must not block account creation (the account is
 * then counted on first load instead). Returns the error, or null.
 */
export function countNewAccount(
  sqlite: Database.Database,
  userId: string,
  notes: readonly WhatsNewNote[],
): unknown {
  try {
    sqlite
      .prepare(
        `INSERT INTO user_preferences (user_id, whats_new_seen) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET whats_new_seen = excluded.whats_new_seen
         WHERE user_preferences.whats_new_seen IS NULL`,
      )
      .run(userId, JSON.stringify(notes.map((n) => n.id)));
    return null;
  } catch (err) {
    return err;
  }
}
