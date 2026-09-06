/**
 * host-resolver.test.ts — Unit tests for the CSKEK decrypt branch in resolveHostById.
 *
 * Plan 75-04 Task 2 (D-09):
 *   Substrate hosts (runsFleetSubstrate=true) decrypt via CSKEK path
 *   Non-substrate hosts unchanged (D-10)
 *   Fail-closed: CSKEK errors return null, never fall through to user-DEK
 *
 * Testing approach:
 *   - vi.mock for getDb, SimpleDBOps, SystemCrypto, FieldCrypto, logger
 *   - The CSKEK branch makes TWO direct db.select calls (inside the implementation,
 *     not via SimpleDBOps.select):
 *       1. db.select({runsFleetSubstrate}).from(hosts).where(...).limit(1)
 *       2. db.select().from(sshCredentials).where(...).limit(1)
 *   - The initial host load goes through SimpleDBOps.select (mocked separately)
 *   - NOTE: db.select() is also called as the query-builder argument to SimpleDBOps.select.
 *     These calls build a chain but do NOT call .limit() — we differentiate by tracking
 *     which chains have .limit() awaited on them.
 *
 * Test groups:
 *   C1-C3: CSKEK branch happy path (D-09)
 *   S1-S3: Non-substrate hosts — CSKEK branch not triggered (D-10)
 *   FC1-FC3: Fail-closed contract
 *   E1: Edge case — runsFleetSubstrate=true but no credentialId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const FAKE_CSKEK = Buffer.from("ab".repeat(32), "hex");

vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: vi.fn(() => ({
      getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
    })),
  },
}));

vi.mock("../utils/field-crypto.js", () => ({
  FieldCrypto: {
    decryptField: vi.fn((_ct: string, _key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`),
  },
}));

// ---------------------------------------------------------------------------
// DB mock infrastructure
//
// The key challenge: db.select() is called in TWO contexts in resolveHostById:
//   1. As a query-builder argument to SimpleDBOps.select: db.select().from(hosts)...
//      → .limit() is never called on this chain (SimpleDBOps.select handles query execution)
//   2. Directly in the CSKEK branch (two calls): .limit(1) IS awaited
//
// We track .limit() calls to differentiate. limitCallCount is what counts.
// ---------------------------------------------------------------------------

// Queue of responses for direct db.select chains that DO call .limit()
let limitCallQueue: Array<unknown[]> = [];

function enqueueLimitResponse(response: unknown[]) {
  limitCallQueue.push(response);
}

function makeSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => {
      const response = limitCallQueue.shift() ?? [];
      return response;
    }),
  };
  return chain;
}

const mockDbSelectFn = vi.fn(() => makeSelectChain());

vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: mockDbSelectFn,
  })),
}));

vi.mock("../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: vi.fn(async () => []),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test + mocked singletons
// ---------------------------------------------------------------------------

import { resolveHostById } from "./host-resolver.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type HostRow = {
  id: number;
  userId: string;
  ip: string;
  port: number;
  username: string;
  authType: string;
  credentialId: number | null;
  runsFleetSubstrate: boolean;
  name: string;
  connectionType: string;
  overrideCredentialUsername?: boolean;
  [key: string]: unknown;
};

function makeHostRow(overrides: Partial<HostRow> = {}): HostRow {
  return {
    id: 1,
    userId: "user-1",
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: 10,
    runsFleetSubstrate: false,
    name: "test-host",
    connectionType: "ssh",
    overrideCredentialUsername: false,
    ...overrides,
  };
}

type CredRow = {
  id: number;
  userId: string;
  username: string | null;
  systemPassword: string | null;
  systemKey: string | null;
  systemKeyPassword: string | null;
  keyType: string | null;
  password?: string | null;
  key?: string | null;
  privateKey?: string | null;
  keyPassword?: string | null;
  certPublicKey?: string | null;
};

function makeCredRow(overrides: Partial<CredRow> = {}): CredRow {
  return {
    id: 10,
    userId: "user-1",
    username: "cred-user",
    systemPassword: '{"data":"aabb","iv":"dead","tag":"cafe","salt":"1122","recordId":"10"}',
    systemKey: null,
    systemKeyPassword: null,
    keyType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  limitCallQueue = [];

  // Restore fresh select chain factory
  mockDbSelectFn.mockImplementation(() => makeSelectChain());

  // Default: CSKEK works
  (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
    getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
  });
  // Default: decryptField returns deterministic value
  (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
    (_ct: string, _key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`,
  );
  // Default: SimpleDBOps.select returns empty
  (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// C1-C3: CSKEK branch happy path (D-09)
// ---------------------------------------------------------------------------

describe("CSKEK branch happy path (C1-C3)", () => {
  it("C1: substrate host with systemPassword → resolveHostById returns host with decrypted password", async () => {
    const hostRow = makeHostRow({ id: 1, credentialId: 10, runsFleetSubstrate: true });
    const credRow = makeCredRow({ id: 10, systemPassword: "ct-password", systemKey: null });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    // CSKEK branch will call .limit() twice:
    //   1. runsFleetSubstrate lookup → [{runsFleetSubstrate: true}]
    //   2. sshCredentials lookup → [credRow]
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([credRow]);

    const result = await resolveHostById(1, "user-1");

    expect(result).not.toBeNull();
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-password", FAKE_CSKEK, "10", "password");
    expect(result!.password).toBe("decrypted-password-10");
    expect(result!.authType).toBe("password");
  });

  it("C2: substrate host with systemKey (key auth) → decrypted key, password null", async () => {
    const hostRow = makeHostRow({ id: 2, credentialId: 20, runsFleetSubstrate: true });
    const credRow = makeCredRow({
      id: 20,
      systemPassword: null,
      systemKey: "ct-key-val",
      systemKeyPassword: null,
      keyType: "ed25519",
    });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([credRow]);

    const result = await resolveHostById(2, "user-1");

    expect(result).not.toBeNull();
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-key-val", FAKE_CSKEK, "20", "key");
    expect(result!.key).toBe("decrypted-key-20");
    expect(result!.password).toBeNull();
    expect(result!.authType).toBe("key");
  });

  it("C3: substrate host with systemKey AND systemKeyPassword → both fields decrypted", async () => {
    const hostRow = makeHostRow({ id: 3, credentialId: 30, runsFleetSubstrate: true });
    const credRow = makeCredRow({
      id: 30,
      systemPassword: null,
      systemKey: "ct-key",
      systemKeyPassword: "ct-key-pass",
    });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([credRow]);

    const result = await resolveHostById(3, "user-1");

    expect(result).not.toBeNull();
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-key", FAKE_CSKEK, "30", "key");
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-key-pass", FAKE_CSKEK, "30", "key_password");
    expect(result!.key).toBe("decrypted-key-30");
    expect(result!.keyPassword).toBe("decrypted-key_password-30");
  });
});

// ---------------------------------------------------------------------------
// S1-S3: Non-substrate scope boundary (D-10)
// ---------------------------------------------------------------------------

describe("Non-substrate scope boundary (S1-S3)", () => {
  it("S1: runsFleetSubstrate=false, credentialId set → CSKEK branch NOT triggered, SimpleDBOps.select used for credentials", async () => {
    const hostRow = makeHostRow({ id: 4, credentialId: 40, runsFleetSubstrate: false });
    const credRow = makeCredRow({ id: 40, systemPassword: null, systemKey: null, password: "plain-pw", key: null });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>)
      // First call: initial host load
      .mockResolvedValueOnce([hostRow])
      // Second call: user-DEK credential resolve
      .mockResolvedValueOnce([credRow]);
    // CSKEK branch checks runsFleetSubstrate → false
    enqueueLimitResponse([{ runsFleetSubstrate: false }]);

    await resolveHostById(4, "user-1");

    // FieldCrypto.decryptField must NOT have been called (CSKEK branch not triggered)
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // SimpleDBOps.select WAS called for both host load and credential resolve
    expect(SimpleDBOps.select).toHaveBeenCalled();
  });

  it("S2: runsFleetSubstrate=undefined (legacy row) → treated as non-substrate, CSKEK not triggered", async () => {
    const hostRow = makeHostRow({ id: 5, credentialId: 50, runsFleetSubstrate: undefined as unknown as boolean });
    const credRow = makeCredRow({ id: 50, systemPassword: null, password: "old-pw" });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([hostRow])
      .mockResolvedValueOnce([credRow]);
    // runsFleetSubstrate lookup returns null/undefined/0 → not true → non-substrate
    enqueueLimitResponse([{ runsFleetSubstrate: null }]);

    await resolveHostById(5, "user-1");

    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
  });

  it("S3: non-substrate host with credentialId → password comes from user-DEK SimpleDBOps.select path (regression)", async () => {
    const hostRow = makeHostRow({
      id: 6,
      credentialId: 60,
      runsFleetSubstrate: false,
      username: "host-user",
    });
    const credRow = {
      id: 60,
      userId: "user-1",
      username: "cred-user",
      password: "plain-password",
      key: null,
      privateKey: null,
      keyPassword: null,
      keyType: null,
      certPublicKey: null,
    };

    (SimpleDBOps.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([hostRow])
      .mockResolvedValueOnce([credRow]);
    enqueueLimitResponse([{ runsFleetSubstrate: false }]);

    const result = await resolveHostById(6, "user-1");

    expect(result).not.toBeNull();
    // Credential resolved from credRow via user-DEK path
    expect(result!.password).toBe("plain-password");
    expect(result!.username).toBe("cred-user");
    // No CSKEK involved
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FC1-FC3: Fail-closed contract
// ---------------------------------------------------------------------------

describe("Fail-closed contract (FC1-FC3)", () => {
  it("FC1: CSKEK branch — FieldCrypto.decryptField throws → resolveHostById returns null, no fall-through to user-DEK", async () => {
    const hostRow = makeHostRow({ id: 7, credentialId: 70, runsFleetSubstrate: true });
    const credRow = makeCredRow({ id: 70, systemPassword: "ct-pass" });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([credRow]);

    (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    const result = await resolveHostById(7, "user-1");

    expect(result).toBeNull();
    // SimpleDBOps.select called once (initial host load) — NOT again for user-DEK
    expect(SimpleDBOps.select).toHaveBeenCalledTimes(1);
    // Warn logged
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as Record<string, unknown>)?.operation);
    expect(ops.some((op) => op === "host_resolver_substrate_cskek")).toBe(true);
  });

  it("FC2: CSKEK branch — sshCredentials query returns 0 rows → returns null, no fall-through", async () => {
    const hostRow = makeHostRow({ id: 8, credentialId: 80, runsFleetSubstrate: true });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    // runsFleetSubstrate=true, then credential query returns empty
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([]); // empty cred result

    const result = await resolveHostById(8, "user-1");

    expect(result).toBeNull();
    // FieldCrypto.decryptField was NOT called (no cred row)
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // SimpleDBOps.select called once (initial host load) — NOT again for user-DEK
    expect(SimpleDBOps.select).toHaveBeenCalledTimes(1);
    // Warn logged
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as Record<string, unknown>)?.operation);
    expect(ops.some((op) => op === "host_resolver_substrate_missing_credential")).toBe(true);
  });

  it("FC3: CSKEK branch — SystemCrypto.getCredentialSharingKey() throws → returns null, logs warn, no fall-through", async () => {
    const hostRow = makeHostRow({ id: 9, credentialId: 90, runsFleetSubstrate: true });
    const credRow = makeCredRow({ id: 90, systemPassword: "ct-pass" });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    enqueueLimitResponse([{ runsFleetSubstrate: true }]);
    enqueueLimitResponse([credRow]);

    (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
      getCredentialSharingKey: vi.fn(async () => {
        throw new Error("CSKEK not loaded");
      }),
    });

    const result = await resolveHostById(9, "user-1");

    expect(result).toBeNull();
    // SimpleDBOps.select called once only (initial host load)
    expect(SimpleDBOps.select).toHaveBeenCalledTimes(1);
    // Warn logged with host_resolver_substrate_cskek operation
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const ops = warnCalls.map((c) => (c[1] as Record<string, unknown>)?.operation);
    expect(ops.some((op) => op === "host_resolver_substrate_cskek")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E1: Edge case — runsFleetSubstrate=true but credentialId=null
// ---------------------------------------------------------------------------

describe("Edge cases (E1)", () => {
  it("E1: runsFleetSubstrate=true but credentialId=null → CSKEK branch not triggered (credentialId guard fails early)", async () => {
    const hostRow = makeHostRow({ id: 11, credentialId: null, runsFleetSubstrate: true });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    // No limit-queue entries needed — CSKEK branch won't run (credentialId null skips entire block)
    limitCallQueue = [];

    const result = await resolveHostById(11, "user-1");

    // CSKEK branch: requires credentialId, so it should NOT trigger
    // FieldCrypto.decryptField must not be called
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // No substrate check DB query needed
    // The host is returned as-is (no credentials resolved)
    expect(result).not.toBeNull();
    expect(result!.id).toBe(11);
  });
});
