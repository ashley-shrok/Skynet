/**
 * Phase 75 Plan 01 Task 2 — matrix-admin-creds-store unit tests.
 *
 * Covers the four behavior cases from PLAN.md:
 *   Test 1: setMatrixAdminCreds → getMatrixAdminCreds round-trips plaintext.
 *   Test 2: After setMatrixAdminCreds, the RAW SQLite row's access_token +
 *           password columns are NOT plaintext — they parse as FieldCrypto
 *           JSON with keys {data, iv, tag, salt, recordId}.
 *   Test 3: getMatrixAdminCreds() returns null on a fresh DB with no row.
 *   Test 4: setMatrixAdminCreds called twice UPDATES the singleton row
 *           (id=1 preserved), does NOT INSERT a second row.
 *
 * Test infrastructure: in-memory better-sqlite3 wired through Drizzle,
 * mirroring the field-crypto.test.ts + identities.put-disk.test.ts pattern.
 * SystemCrypto.getInstance().getEncryptionKey() is mocked to return a
 * deterministic random Buffer for reproducible ciphertext.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

// The store module and its dependencies must be import-mocked BEFORE the
// module under test is loaded, so the SystemCrypto singleton returns our
// deterministic key and the Drizzle db points at the test-owned in-memory
// SQLite. We deliberately re-import the store inside each test via a
// dynamic import so the vi.mock hoisting sees a fresh module cache per
// case.

// Master key held at module scope so the SystemCrypto mock + the raw-row
// decryption assertion in Test 2 use the SAME bytes.
const TEST_MASTER_KEY = crypto.randomBytes(32);

// Test-owned in-memory SQLite. Replaced in beforeEach per test.
let sqliteInstance: Database.Database;
let drizzleInstance: ReturnType<typeof drizzle>;

vi.mock("../database/db/index.js", () => ({
  // The store imports `db` (drizzle instance) and `DatabaseSaveTrigger` from
  // this path — mirror the same export shape so imports resolve.
  get db() {
    return drizzleInstance;
  },
}));

vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => TEST_MASTER_KEY,
    }),
  },
}));

vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn().mockResolvedValue(undefined),
    forceSave: vi.fn().mockResolvedValue(undefined),
  },
}));

// The migration SQL for matrix_admin_creds — mirrors the exact shape added
// to db/index.ts in Task 1.
const MATRIX_ADMIN_CREDS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS matrix_admin_creds (
    id INTEGER PRIMARY KEY,
    homeserver_base TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

beforeEach(() => {
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec(MATRIX_ADMIN_CREDS_CREATE_SQL);
  drizzleInstance = drizzle(sqliteInstance);
});

describe("matrix-admin-creds-store", () => {
  it("Test 1: setMatrixAdminCreds → getMatrixAdminCreds round-trips plaintext via FieldCrypto", async () => {
    const { setMatrixAdminCreds, getMatrixAdminCreds } = await import(
      "./matrix-admin-creds-store.js"
    );

    const creds = {
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      accessToken: "syt_c2t5bmV0LWFkbWlu_deadbeef_test",
      password: "hunter2-plaintext-should-round-trip",
    };

    await setMatrixAdminCreds(creds);
    const readBack = await getMatrixAdminCreds();

    expect(readBack).not.toBeNull();
    expect(readBack).toEqual(creds);
  });

  it("Test 2: After setMatrixAdminCreds, raw access_token + password columns are FieldCrypto JSON (not plaintext)", async () => {
    const { setMatrixAdminCreds } = await import(
      "./matrix-admin-creds-store.js"
    );

    const plaintextToken = "syt_UNIQUE_MARKER_TOKEN_do_not_leak_plaintext";
    const plaintextPassword = "UNIQUE_MARKER_PASSWORD_do_not_leak_plaintext";

    await setMatrixAdminCreds({
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      accessToken: plaintextToken,
      password: plaintextPassword,
    });

    // Read the raw row directly, bypassing the store's decryption.
    const rawRow = sqliteInstance
      .prepare(
        "SELECT id, access_token, password FROM matrix_admin_creds WHERE id = 1",
      )
      .get() as {
      id: number;
      access_token: string;
      password: string;
    };

    expect(rawRow).toBeDefined();
    expect(rawRow.id).toBe(1);

    // Plaintext leak assertion — the stored strings must NOT equal the
    // plaintext we wrote.
    expect(rawRow.access_token).not.toBe(plaintextToken);
    expect(rawRow.password).not.toBe(plaintextPassword);

    // Substring check — plaintext bytes should NOT appear inside the
    // ciphertext blob (a working AES-GCM encryption produces bytes that
    // never contain the plaintext as a substring, save for pathological
    // ~2^-128 collisions).
    expect(rawRow.access_token).not.toContain(plaintextToken);
    expect(rawRow.password).not.toContain(plaintextPassword);

    // Shape assertion — the stored strings parse as FieldCrypto JSON with
    // {data, iv, tag, salt, recordId}.
    const parsedToken = JSON.parse(rawRow.access_token);
    expect(parsedToken).toHaveProperty("data");
    expect(parsedToken).toHaveProperty("iv");
    expect(parsedToken).toHaveProperty("tag");
    expect(parsedToken).toHaveProperty("salt");
    expect(parsedToken).toHaveProperty("recordId");

    const parsedPassword = JSON.parse(rawRow.password);
    expect(parsedPassword).toHaveProperty("data");
    expect(parsedPassword).toHaveProperty("iv");
    expect(parsedPassword).toHaveProperty("tag");
    expect(parsedPassword).toHaveProperty("salt");
    expect(parsedPassword).toHaveProperty("recordId");

    // recordId is bound to the row id (per FieldCrypto's context =
    // `${recordId}:${fieldName}` HKDF derivation).
    expect(parsedToken.recordId).toBe("1");
    expect(parsedPassword.recordId).toBe("1");
  });

  it("Test 3: getMatrixAdminCreds returns null when the singleton row does not exist", async () => {
    const { getMatrixAdminCreds } = await import(
      "./matrix-admin-creds-store.js"
    );

    const result = await getMatrixAdminCreds();
    expect(result).toBeNull();
  });

  it("Test 4: setMatrixAdminCreds called twice UPDATES the singleton row (id=1 preserved, no second row)", async () => {
    const { setMatrixAdminCreds, getMatrixAdminCreds } = await import(
      "./matrix-admin-creds-store.js"
    );

    await setMatrixAdminCreds({
      homeserverBase: "http://old-base:8008",
      userId: "@old-admin:example.com",
      accessToken: "syt_old_token",
      password: "old-password",
    });

    // Confirm one row exists post-write-1.
    const rowsAfterWrite1 = sqliteInstance
      .prepare("SELECT COUNT(*) as n FROM matrix_admin_creds")
      .get() as { n: number };
    expect(rowsAfterWrite1.n).toBe(1);

    // Second write with different values.
    await setMatrixAdminCreds({
      homeserverBase: "http://new-base:8008",
      userId: "@new-admin:example.com",
      accessToken: "syt_new_token",
      password: "new-password",
    });

    // Still exactly ONE row (UPDATE, not INSERT).
    const rowsAfterWrite2 = sqliteInstance
      .prepare("SELECT COUNT(*) as n FROM matrix_admin_creds")
      .get() as { n: number };
    expect(rowsAfterWrite2.n).toBe(1);

    // The singleton row is still id=1.
    const idRow = sqliteInstance
      .prepare("SELECT id FROM matrix_admin_creds LIMIT 1")
      .get() as { id: number };
    expect(idRow.id).toBe(1);

    // getMatrixAdminCreds returns the NEW values.
    const readBack = await getMatrixAdminCreds();
    expect(readBack).toEqual({
      homeserverBase: "http://new-base:8008",
      userId: "@new-admin:example.com",
      accessToken: "syt_new_token",
      password: "new-password",
    });
  });
});
