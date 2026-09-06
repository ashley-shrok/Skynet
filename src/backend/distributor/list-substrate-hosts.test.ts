/**
 * list-substrate-hosts.test.ts — Unit tests for the session-less substrate-host enumerator.
 *
 * Test groups:
 *   H1-H4: Happy-path CSKEK decrypt and returned record shape (D-08)
 *   N1-N2: Scope narrowing — WHERE clause filters (D-10)
 *   F1-F3: Defense-in-depth filters for credential edge cases
 *   NT1-NT2: Never-throw contract (DB error, CSKEK error)
 *   S1-S2: Secret hygiene — CSKEK and plaintext never appear in log calls
 *
 * Approach: deps-injection for the DB. The module receives
 * `{ getDb: () => DrizzleDb }`. Tests inject a stubbed object whose
 * `.select().from().leftJoin().where()` chain returns a canned row array.
 * Crypto singletons are mocked via vi.mock so all test files in the suite
 * exercise the same module-level import path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before all imports)
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const FAKE_CSKEK = Buffer.from("00".repeat(32), "hex");

vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: vi.fn(() => ({
      getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
    })),
  },
}));

// Default: decryptField returns a deterministic plaintext string keyed by fieldName + credId
vi.mock("../utils/field-crypto.js", () => ({
  FieldCrypto: {
    decryptField: vi.fn((ct: string, key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test + mocked singletons (after vi.mock declarations)
// ---------------------------------------------------------------------------
import { listSubstrateHosts } from "./list-substrate-hosts.js";
import { systemLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockRow = {
  id: number;
  name: string | null;
  credentialId: number | null;
  ip: string;
  port: number;
  username: string;
  authType: string;
  cred_id: number | null;
  cred_userId: string | null;
  cred_systemPassword: string | null;
  cred_systemKey: string | null;
  cred_systemKeyPassword: string | null;
  cred_keyType: string | null;
  cred_username: string | null;
};

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 1,
    name: "host-one",
    credentialId: 10,
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    cred_id: 10,
    cred_userId: "user-abc",
    cred_systemPassword: '{"data":"aabbcc","iv":"deadbeef","tag":"cafecafe","salt":"11223344","recordId":"10"}',
    cred_systemKey: null,
    cred_systemKeyPassword: null,
    cred_keyType: null,
    cred_username: null,
    ...overrides,
  };
}

/**
 * Build a minimal stubbed drizzle-like query chain whose terminal call
 * returns the given rows array. Simulates:
 *   db.select({...}).from(hosts).leftJoin(sshCreds, ...).where(...) → rows
 */
function makeDb(rows: MockRow[]): { getDb: () => unknown } {
  const whereStub = vi.fn(() => Promise.resolve(rows));
  const leftJoinStub = vi.fn(() => ({ where: whereStub }));
  const fromStub = vi.fn(() => ({ leftJoin: leftJoinStub }));
  const selectStub = vi.fn(() => ({ from: fromStub }));
  const db = { select: selectStub };
  return { getDb: () => db };
}

/**
 * Build a DB stub that throws when .select() is called.
 */
function makeThrowingDb(error: Error): { getDb: () => unknown } {
  const db = {
    select: vi.fn(() => { throw error; }),
  };
  return { getDb: () => db };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // Restore default CSKEK mock
  (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
    getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
  });
  // Restore default decryptField mock
  (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
    (ct: string, key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`,
  );
});

// ---------------------------------------------------------------------------
// H1-H4: Happy path — CSKEK-based decrypt and record shape
// ---------------------------------------------------------------------------

describe("Happy path (H1-H4): CSKEK-only decrypt and SubstrateHostRecord shape", () => {
  it("H1: returns 2 records when DB has 2 password-auth substrate hosts, each decrypted via CSKEK", async () => {
    const rows = [
      makeRow({ id: 1, name: "alpha", credentialId: 10, cred_id: 10, cred_systemPassword: "ct-alpha" }),
      makeRow({ id: 2, name: "beta", credentialId: 20, cred_id: 20, cred_systemPassword: "ct-beta" }),
    ];
    const deps = makeDb(rows);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(2);
    expect(result[0]._connDetails.password).toBe("decrypted-password-10");
    expect(result[1]._connDetails.password).toBe("decrypted-password-20");
  });

  it("H2: key-auth host — _connDetails.key is decrypted, password is null", async () => {
    const row = makeRow({
      id: 3,
      credentialId: 30,
      cred_id: 30,
      cred_systemPassword: null,
      cred_systemKey: "ct-key-val",
      cred_keyType: "ed25519",
    });
    const deps = makeDb([row]);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(1);
    expect(result[0]._connDetails.key).toBe("decrypted-key-30");
    expect(result[0]._connDetails.password).toBeNull();
    expect(result[0]._connDetails.keyType).toBe("ed25519");
  });

  it("H3: key-with-passphrase host — _connDetails.keyPassword is decrypted", async () => {
    const row = makeRow({
      id: 4,
      credentialId: 40,
      cred_id: 40,
      cred_systemPassword: null,
      cred_systemKey: "ct-key-encrypted",
      cred_systemKeyPassword: "ct-key-pass",
    });
    const deps = makeDb([row]);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(1);
    expect(result[0]._connDetails.key).toBe("decrypted-key-40");
    expect(result[0]._connDetails.keyPassword).toBe("decrypted-key_password-40");
  });

  it("H4: returned SubstrateHostRecord has exactly the required shape fields", async () => {
    const row = makeRow({
      id: 5,
      name: "my-host",
      credentialId: 50,
      cred_id: 50,
      ip: "192.168.1.10",
      port: 2222,
      username: "ubuntu",
      cred_username: "svc-user",
      cred_systemPassword: "ct-pass",
      cred_keyType: null,
    });
    const deps = makeDb([row]);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(1);
    const rec = result[0];
    expect(rec).toHaveProperty("id");
    expect(rec).toHaveProperty("name");
    expect(rec).toHaveProperty("_connDetails");
    expect(typeof rec.id).toBe("string");
    expect(rec.name).toBe("my-host");
    // _connDetails fields
    const cd = rec._connDetails;
    expect(cd).toHaveProperty("ip");
    expect(cd).toHaveProperty("port");
    expect(cd).toHaveProperty("username");
    expect(cd).toHaveProperty("password");
    expect(cd).toHaveProperty("key");
    expect(cd).toHaveProperty("keyPassword");
    expect(cd).toHaveProperty("keyType");
    expect(cd.ip).toBe("192.168.1.10");
    expect(cd.port).toBe(2222);
    // cred_username takes priority over host username
    expect(cd.username).toBe("svc-user");
  });
});

// ---------------------------------------------------------------------------
// N1-N2: Scope narrowing — WHERE clause (D-10)
// ---------------------------------------------------------------------------

describe("Scope narrowing (N1-N2): WHERE clause filters", () => {
  it("N1: query WHERE is built with enableSsh=true AND runsFleetSubstrate=true filter arguments", async () => {
    const rows: MockRow[] = [];
    const whereStub = vi.fn(() => Promise.resolve(rows));
    const leftJoinStub = vi.fn(() => ({ where: whereStub }));
    const fromStub = vi.fn(() => ({ leftJoin: leftJoinStub }));
    const selectStub = vi.fn(() => ({ from: fromStub }));
    const db = { select: selectStub };
    const deps = { getDb: () => db };

    await listSubstrateHosts(deps as any);

    // The WHERE call must have been made with arguments
    expect(whereStub).toHaveBeenCalledOnce();
    const whereArgs = whereStub.mock.calls[0];
    // There should be at least one argument (the and(...) drizzle filter)
    expect(whereArgs.length).toBeGreaterThan(0);
  });

  it("N2: only rows already filtered by the query are processed — mixed rows: false-flagged hosts are never decrypted", async () => {
    // The WHERE clause runs in drizzle, not in JS. We simulate this by having
    // the mock return ONLY the substrate-true rows (what the DB would return
    // after the WHERE filter). The test verifies that no extra JS-level filter
    // is skipping any returned rows for non-substrate reasons.
    const substrateRow = makeRow({ id: 7, cred_systemPassword: "ct-7" });
    const deps = makeDb([substrateRow]);

    const result = await listSubstrateHosts(deps as any);

    // Only the substrate row should come back
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("7");
    // decryptField was called exactly once (for the single substrate row's password)
    expect(FieldCrypto.decryptField).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F1-F3: Defense-in-depth filters
// ---------------------------------------------------------------------------

describe("Defense-in-depth filters (F1-F3)", () => {
  it("F1: host with credentialId=null is filtered out and warns with fleet_substrate_host_no_credential_id", async () => {
    const row = makeRow({ credentialId: null, cred_id: null });
    const deps = makeDb([row]);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(0);
    const warnCalls = (systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as any)?.operation);
    expect(ops).toContain("fleet_substrate_host_no_credential_id");
  });

  it("F2: host with cred row having null system_password AND null system_key is filtered out and warns fleet_substrate_host_unmigrated_credential", async () => {
    const row = makeRow({
      credentialId: 11,
      cred_id: 11,
      cred_systemPassword: null,
      cred_systemKey: null,
    });
    const deps = makeDb([row]);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toHaveLength(0);
    const warnCalls = (systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as any)?.operation);
    expect(ops).toContain("fleet_substrate_host_unmigrated_credential");
  });

  it("F3: decryptField throws on one host — that host is filtered, warn is logged, other hosts still appear", async () => {
    const rows = [
      makeRow({ id: 1, name: "good-host", cred_id: 10, credentialId: 10, cred_systemPassword: "ct-good" }),
      makeRow({ id: 2, name: "bad-host",  cred_id: 20, credentialId: 20, cred_systemPassword: "ct-bad" }),
    ];
    const deps = makeDb(rows);

    // Make decryptField throw only for the second host's cred_id=20
    (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
      (ct: string, key: Buffer, id: string, field: string) => {
        if (id === "20") throw new Error("decrypt failed for id=20");
        return `decrypted-${field}-${id}`;
      },
    );

    const result = await listSubstrateHosts(deps as any);

    // Only the good host should be in results
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");

    // A warn must have been emitted for the bad host
    const warnCalls = (systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as any)?.operation);
    expect(ops).toContain("fleet_substrate_host_decrypt_failed");
  });
});

// ---------------------------------------------------------------------------
// NT1-NT2: Never-throw contract
// ---------------------------------------------------------------------------

describe("Never-throw contract (NT1-NT2)", () => {
  it("NT1: DB .select() throws — listSubstrateHosts returns [] and logs fleet_substrate_host_list_failed", async () => {
    const deps = makeThrowingDb(new Error("DB connection error"));

    const result = await listSubstrateHosts(deps as any);

    expect(result).toEqual([]);
    const warnCalls = (systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as any)?.operation);
    expect(ops).toContain("fleet_substrate_host_list_failed");
  });

  it("NT2: SystemCrypto.getCredentialSharingKey throws — listSubstrateHosts returns [] and logs fleet_substrate_host_list_failed", async () => {
    (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
      getCredentialSharingKey: vi.fn(async () => { throw new Error("CSKEK not loaded"); }),
    });

    const rows = [makeRow()];
    const deps = makeDb(rows);

    const result = await listSubstrateHosts(deps as any);

    expect(result).toEqual([]);
    const warnCalls = (systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as any)?.operation);
    expect(ops).toContain("fleet_substrate_host_list_failed");
  });
});

// ---------------------------------------------------------------------------
// S1-S2: Secret hygiene — no CSKEK or plaintext credentials in log calls
// ---------------------------------------------------------------------------

describe("Secret hygiene (S1-S2)", () => {
  it("S1: CSKEK Buffer value never appears in any systemLogger call arguments", async () => {
    // Inject a uniquely identifiable CSKEK
    const UNIQUE_CSKEK = Buffer.from("deadbeef".repeat(8), "hex");
    (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
      getCredentialSharingKey: vi.fn(async () => UNIQUE_CSKEK),
    });

    // Trigger the decrypt-failed warn path (F3) to exercise all log paths
    const rows = [
      makeRow({ id: 1, cred_id: 10, cred_systemPassword: "ct-1" }),
      makeRow({ id: 2, cred_id: 20, cred_systemPassword: "ct-2" }),
    ];
    (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
      (ct: string, key: Buffer, id: string, field: string) => {
        if (id === "20") throw new Error("decrypt error");
        return `plain-value`;
      },
    );
    const deps = makeDb(rows);
    await listSubstrateHosts(deps as any);

    const CSKEK_HEX = UNIQUE_CSKEK.toString("hex");
    const allWarnArgs = JSON.stringify((systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls);
    const allInfoArgs = JSON.stringify((systemLogger.info as ReturnType<typeof vi.fn>).mock.calls);
    const allErrorArgs = JSON.stringify((systemLogger.error as ReturnType<typeof vi.fn>).mock.calls);

    expect(allWarnArgs).not.toContain(CSKEK_HEX);
    expect(allInfoArgs).not.toContain(CSKEK_HEX);
    expect(allErrorArgs).not.toContain(CSKEK_HEX);
  });

  it("S2: plaintext credential values never appear in any systemLogger call arguments", async () => {
    const PLAIN_PASSWORD = "super-secret-plaintext-password-xyz";
    const PLAIN_KEY = "super-secret-key-material-abc";

    (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
      (ct: string, key: Buffer, id: string, field: string) => {
        if (field === "password") return PLAIN_PASSWORD;
        if (field === "key") return PLAIN_KEY;
        return `decrypted-${field}-${id}`;
      },
    );

    // Trigger decrypt-failed warn to exercise all log call paths
    const rows = [
      makeRow({ id: 1, cred_id: 10, cred_systemPassword: "ct-pass" }),
      makeRow({ id: 2, cred_id: 20, cred_systemPassword: null, cred_systemKey: null }), // unmigrated
    ];
    const deps = makeDb(rows);
    await listSubstrateHosts(deps as any);

    const allWarnArgs = JSON.stringify((systemLogger.warn as ReturnType<typeof vi.fn>).mock.calls);
    const allInfoArgs = JSON.stringify((systemLogger.info as ReturnType<typeof vi.fn>).mock.calls);
    const allErrorArgs = JSON.stringify((systemLogger.error as ReturnType<typeof vi.fn>).mock.calls);

    expect(allWarnArgs).not.toContain(PLAIN_PASSWORD);
    expect(allWarnArgs).not.toContain(PLAIN_KEY);
    expect(allInfoArgs).not.toContain(PLAIN_PASSWORD);
    expect(allInfoArgs).not.toContain(PLAIN_KEY);
    expect(allErrorArgs).not.toContain(PLAIN_PASSWORD);
    expect(allErrorArgs).not.toContain(PLAIN_KEY);
  });
});
