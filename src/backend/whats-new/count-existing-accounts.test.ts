import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { countUncountedAccounts, countNewAccount } from "./count-existing-accounts.js";
import { resolveUnseen } from "./whats-new-state.js";

let db: Database.Database;
const seenOf = (id: string) =>
  (db.prepare("SELECT whats_new_seen AS s FROM user_preferences WHERE user_id = ?").get(id) as
    | { s: string | null }
    | undefined)?.s;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY, theme TEXT, whats_new_seen TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(`INSERT INTO users VALUES ('noRow','a'), ('nullRec','b'), ('counted','c');
           INSERT INTO user_preferences (user_id, theme) VALUES ('nullRec','dark');
           INSERT INTO user_preferences (user_id, whats_new_seen) VALUES ('counted','["x"]');`);
});

describe("countUncountedAccounts", () => {
  it("counts accounts with no row or no record; leaves real records alone", () => {
    expect(countUncountedAccounts(db, [{ id: "a", text: "A" }])).toBe(2);
    expect(seenOf("noRow")).toBe('["a"]');
    expect(seenOf("nullRec")).toBe('["a"]');
    expect(seenOf("counted")).toBe('["x"]');
    // the other preference on the existing row is untouched
    expect((db.prepare("SELECT theme FROM user_preferences WHERE user_id='nullRec'").get() as { theme: string }).theme).toBe("dark");
  });

  it("is idempotent", () => {
    countUncountedAccounts(db, []);
    expect(countUncountedAccounts(db, [{ id: "a", text: "A" }])).toBe(0);
  });

  it("an account that stays away through the first note still sees it", () => {
    countUncountedAccounts(db, []); // feature rollout boot, no notes
    const later = [{ id: "a", text: "A" }]; // first note ships; they finally visit
    expect(resolveUnseen(seenOf("noRow"), later).unseen.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("countNewAccount", () => {
  it("records the notes existing at creation, so later notes still show", () => {
    db.exec("INSERT INTO users VALUES ('zoey','z')");
    countNewAccount(db, "zoey", [{ id: "x", text: "X" }]);
    expect(seenOf("zoey")).toBe('["x"]');
    // next deploy adds y and the boot pass runs before Zoey's first visit
    const later = [{ id: "x", text: "X" }, { id: "y", text: "Y" }];
    countUncountedAccounts(db, later);
    expect(resolveUnseen(seenOf("zoey"), later).unseen.map((n) => n.id)).toEqual(["y"]);
  });

  it("returns the error instead of throwing when it can't write", () => {
    db.exec("DROP TABLE user_preferences");
    expect(countNewAccount(db, "noRow", [])).toBeInstanceOf(Error);
  });

  it("never overwrites an existing record", () => {
    countNewAccount(db, "counted", [{ id: "a", text: "A" }]);
    expect(seenOf("counted")).toBe('["x"]');
  });
});
