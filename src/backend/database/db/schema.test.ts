/**
 * Notification schema: the retired push_subscriptions table is dropped on
 * boot, and the Drizzle schema no longer refers to it.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as schema from "./schema.js";

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

describe("push_subscriptions retirement", () => {
  it("drops an existing push_subscriptions table and its old unique index", async () => {
    const { runRetiredNotificationTablesDrop } = await import("./index.js");
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT);
      CREATE UNIQUE INDEX push_subscriptions_user_endpoint_unique ON push_subscriptions (user_id, endpoint);
      INSERT INTO push_subscriptions VALUES ('r1', 'u1', 'e1');
    `);
    runRetiredNotificationTablesDrop(db);
    expect(tableExists(db, "push_subscriptions")).toBe(false);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='push_subscriptions_user_endpoint_unique'").get(),
    ).toBeUndefined();
  });

  it("is a no-op on a fresh database and safe to run repeatedly", async () => {
    const { runRetiredNotificationTablesDrop } = await import("./index.js");
    const db = new Database(":memory:");
    expect(() => {
      runRetiredNotificationTablesDrop(db);
      runRetiredNotificationTablesDrop(db);
    }).not.toThrow();
    expect(tableExists(db, "push_subscriptions")).toBe(false);
  });

  it("the Drizzle schema no longer exports pushSubscriptions", () => {
    expect("pushSubscriptions" in schema).toBe(false);
    expect("telegramBots" in schema).toBe(true);
  });
});
