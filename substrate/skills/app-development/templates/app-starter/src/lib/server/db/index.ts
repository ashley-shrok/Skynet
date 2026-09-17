import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import path from 'node:path';
import * as schema from './schema.js';

// The app runs under systemd with WorkingDirectory=<app dir>, so cwd is the
// app folder and db.sqlite lives right next to package.json.
const dbPath = path.join(process.cwd(), 'db.sqlite');
const sqlite = new Database(dbPath);

// WAL mode for concurrent readers; foreign keys enforced.
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Apply any pending migrations at boot. First run applies everything; every
// subsequent boot applies only newly-generated migrations.
migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
