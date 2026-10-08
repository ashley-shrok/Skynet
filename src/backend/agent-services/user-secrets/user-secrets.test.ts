/**
 * Store + acting-user resolution against a real in-memory SQLite, with the
 * real FieldCrypto. Only the system key and the save trigger are stubbed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

let sqlite: Database.Database;
let drizzleInstance: ReturnType<typeof drizzle>;
const systemKey = crypto.randomBytes(32);

vi.mock("../../database/db/index.js", () => ({ getDb: () => drizzleInstance }));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({ getEncryptionKey: async () => systemKey }) },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { triggerSave: vi.fn(async () => {}) },
}));
vi.mock("../../utils/logger.js", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { databaseLogger: stub, systemLogger: stub };
});

import {
  clearUserSecret,
  getUserSecret,
  listUserSecretStatus,
  setUserSecret,
} from "./store.js";
import { listHostRegistrants, resolveActingUser } from "./acting-user.js";
import { declaredUserSecrets } from "./declared.js";

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL,
      ip TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL
    );
    CREATE TABLE agent_service_user_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, service TEXT NOT NULL, name TEXT NOT NULL,
      value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT,
      UNIQUE (user_id, service, name)
    );
  `);
  const u = sqlite.prepare("INSERT INTO users (id, username) VALUES (?, ?)");
  u.run("u-alice", "alice");
  u.run("u-bob", "bob");
  u.run("u-carol", "carol");
  const h = sqlite.prepare("INSERT INTO ssh_data (id, user_id, ip, port, username) VALUES (?, ?, ?, ?, ?)");
  h.run(1, "u-alice", "10.0.0.5", 22, "agent"); // shared box: alice + bob
  h.run(2, "u-bob", "10.0.0.5", 22, "agent");
  h.run(3, "u-carol", "10.0.0.9", 22, "agent"); // carol's own box
  h.run(4, "u-alice", "10.0.0.9", 2222, "agent"); // same ip, other port
  drizzleInstance = drizzle(sqlite);
});

describe("user secret store", () => {
  it("round-trips a value and never stores it in plain text", async () => {
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "s3cret-token", "u-admin");
    expect(await getUserSecret("u-alice", "zoho", "ZOHO_TOKEN")).toBe("s3cret-token");
    const raw = sqlite.prepare("SELECT value, updated_by FROM agent_service_user_secrets").get() as {
      value: string;
      updated_by: string;
    };
    expect(raw.value).not.toContain("s3cret-token");
    expect(raw.updated_by).toBe("u-admin");
  });

  it("replaces on set and reports status without values", async () => {
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "one", "u-alice");
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "two", "u-alice");
    expect(await getUserSecret("u-alice", "zoho", "ZOHO_TOKEN")).toBe("two");
    const status = await listUserSecretStatus("u-alice");
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ service: "zoho", name: "ZOHO_TOKEN" });
    expect(Object.keys(status[0]).sort()).toEqual(["name", "service", "updatedAt"]);
  });

  it("keeps users, services and names separate", async () => {
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "alice", "x");
    expect(await getUserSecret("u-bob", "zoho", "ZOHO_TOKEN")).toBeNull();
    expect(await getUserSecret("u-alice", "other", "ZOHO_TOKEN")).toBeNull();
    expect(await getUserSecret("u-alice", "zoho", "OTHER")).toBeNull();
  });

  it("refuses a ciphertext copied onto another user's row", async () => {
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "alice-only", "x");
    sqlite.exec(`
      INSERT INTO agent_service_user_secrets (user_id, service, name, value, updated_at)
      SELECT 'u-bob', service, name, value, updated_at FROM agent_service_user_secrets
    `);
    await expect(getUserSecret("u-bob", "zoho", "ZOHO_TOKEN")).rejects.toThrow(/does not belong/);
  });

  it("clears", async () => {
    await setUserSecret("u-alice", "zoho", "ZOHO_TOKEN", "v", "x");
    expect(await clearUserSecret("u-alice", "zoho", "ZOHO_TOKEN")).toBe(true);
    expect(await clearUserSecret("u-alice", "zoho", "ZOHO_TOKEN")).toBe(false);
    expect(await getUserSecret("u-alice", "zoho", "ZOHO_TOKEN")).toBeNull();
  });
});

describe("acting user", () => {
  it("lists everyone who registered the same machine", async () => {
    expect((await listHostRegistrants(1)).map((u) => u.username)).toEqual(["alice", "bob"]);
    expect((await listHostRegistrants(3)).map((u) => u.username)).toEqual(["carol"]);
    expect(await listHostRegistrants(999)).toEqual([]);
  });

  it("uses the only registrant when there is one", async () => {
    expect(await resolveActingUser(3, undefined)).toEqual({
      ok: true,
      user: { id: "u-carol", username: "carol" },
    });
  });

  it("asks for --as on a shared host", async () => {
    const r = await resolveActingUser(1, undefined);
    expect(r).toMatchObject({ ok: false, code: "ambiguous_user" });
    expect(r.ok === false && r.message).toMatch(/alice, bob.*--as/);
  });

  it("accepts any registrant named with --as", async () => {
    expect(await resolveActingUser(1, "bob")).toEqual({ ok: true, user: { id: "u-bob", username: "bob" } });
    expect(await resolveActingUser(2, "alice")).toEqual({
      ok: true,
      user: { id: "u-alice", username: "alice" },
    });
  });

  it("refuses non-registrants and unknown names", async () => {
    expect(await resolveActingUser(3, "alice")).toMatchObject({ ok: false, code: "not_permitted" });
    expect(await resolveActingUser(3, "mallory")).toMatchObject({ ok: false, code: "unknown_user" });
  });
});

describe("declaredUserSecrets", () => {
  it("flattens service declarations and reports fallbacks", () => {
    const services = [
      {
        name: "zoho",
        description: "Zoho CRM",
        userSecrets: {
          ZOHO_TOKEN: { label: "Zoho token", managedBy: "admin" as const, fallbackEnv: "ZOHO_DEFAULT" },
          NOTE: { label: "Note", managedBy: "user" as const },
        },
      },
      { name: "plain", description: "no secrets" },
    ] as never;
    expect(declaredUserSecrets(services, { ZOHO_DEFAULT: "x" })).toEqual([
      {
        service: "zoho",
        serviceDescription: "Zoho CRM",
        name: "ZOHO_TOKEN",
        label: "Zoho token",
        managedBy: "admin",
        hasFallback: true,
      },
      {
        service: "zoho",
        serviceDescription: "Zoho CRM",
        name: "NOTE",
        label: "Note",
        managedBy: "user",
        hasFallback: false,
      },
    ]);
  });
});
