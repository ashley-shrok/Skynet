/**
 * attention-schema.ts — tables behind the sidebar's unread marks.
 *
 *   identity_turn_log       — per (host, identity): when its agent last
 *                             finished a turn (the per-session Stop file
 *                             mtime, max-wins). Survives dormancy, recycles
 *                             and restarts, which the live session frame
 *                             does not.
 *   conversation_read_state — per (user, host, identity): the newest finished
 *                             turn that user has seen. Compared against the
 *                             turn log value itself, never against a clock,
 *                             so host/server clock skew cannot create or
 *                             swallow a mark.
 *   user_read_baseline      — per user: when read tracking started for them.
 *                             A conversation with no read row counts as read
 *                             for every turn that finished before this, so
 *                             nothing lights up on launch day.
 *
 * No imports: db/index.ts execs this at boot and tests exec it against an
 * in-memory database.
 */
export const ATTENTION_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS identity_turn_log (
      host_id TEXT NOT NULL,
      identity_name TEXT NOT NULL,
      last_finish_at INTEGER NOT NULL,
      PRIMARY KEY (host_id, identity_name)
  );
  CREATE TABLE IF NOT EXISTS conversation_read_state (
      user_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      identity_name TEXT NOT NULL,
      seen_finish_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, host_id, identity_name),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_read_baseline (
      user_id TEXT PRIMARY KEY,
      baseline_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`;
