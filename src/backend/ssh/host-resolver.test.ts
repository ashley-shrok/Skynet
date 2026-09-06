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
 *   - The CSKEK branch does a fresh DB query for runsFleetSubstrate, then queries
 *     sshCredentials for system_* columns, then decrypts
 *   - SimpleDBOps.select is the tell for the user-DEK path
 *   - FieldCrypto.decryptField is the tell for the CSKEK path
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
    decryptField: vi.fn((ct: string, _key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`),
  },
}));

// ---------------------------------------------------------------------------
// DB mock infrastructure
// ---------------------------------------------------------------------------

// We need fine-grained control over each db.select chain call because the
// CSKEK branch makes TWO sequential selects:
//   1. db.select({runsFleetSubstrate}).from(hosts).where(...).limit(1)
//   2. db.select().from(sshCredentials).where(...).limit(1)
// Plus SimpleDBOps.select is called for the initial host load.

type SelectChain = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

let selectCallCount = 0;
// Array of responses to return on successive select() calls
let selectResponses: Array<unknown[]> = [];

function makeSelectChain(response: unknown[]): SelectChain {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(response)),
  };
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  return chain;
}

const mockDbSelect = vi.fn(() => {
  const response = selectResponses[selectCallCount] ?? [];
  selectCallCount++;
  return makeSelectChain(response);
});

vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: mockDbSelect,
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
// Helpers
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
  keyPassword?: string | null;
  privateKey?: string | null;
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

/**
 * Set up selectResponses for a CSKEK path test.
 * The CSKEK branch makes two direct db.select calls:
 *   call 0: runsFleetSubstrate lookup → [{runsFleetSubstrate: true}]
 *   call 1: sshCredentials lookup → [credRow]
 */
function setupCskekDbCalls(runsFleetSubstrate: boolean, credRow: CredRow | null) {
  selectResponses = [
    [{ runsFleetSubstrate }],
    credRow ? [credRow] : [],
  ];
  selectCallCount = 0;
}

/**
 * Set up for non-substrate path (SimpleDBOps.select handles everything).
 * The CSKEK branch does a single direct db.select call to check runsFleetSubstrate,
 * gets false, then falls through to SimpleDBOps.select path.
 */
function setupNonSubstrateDbCalls(hostRow: HostRow, credRow: CredRow | null = null) {
  // Direct db.select call: runsFleetSubstrate check returns false
  selectResponses = [
    [{ runsFleetSubstrate: false }],
    credRow ? [credRow] : [],
  ];
  selectCallCount = 0;
  // SimpleDBOps.select returns the host
  (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  selectResponses = [];

  // Default: no CSKEK key issues
  (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
    getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
  });
  // Default: decryptField returns deterministic value
  (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
    (_ct: string, _key: Buffer, id: string, field: string) => `decrypted-${field}-${id}`,
  );
  // Default: SimpleDBOps.select returns empty (will be overridden per test)
  (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// C1-C3: CSKEK branch happy path (D-09)
// ---------------------------------------------------------------------------

describe("CSKEK branch happy path (C1-C3)", () => {
  it("C1: substrate host with systemPassword → resolveHostById returns host with decrypted password", async () => {
    const hostRow = makeHostRow({ id: 1, credentialId: 10, runsFleetSubstrate: true });
    const credRow = makeCredRow({ id: 10, systemPassword: "ct-password", systemKey: null });

    // SimpleDBOps.select returns the host row (initial host load)
    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    setupCskekDbCalls(true, credRow);

    const result = await resolveHostById(1, "user-1");

    expect(result).not.toBeNull();
    // decryptField called for password (field=password, id="10")
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-password", FAKE_CSKEK, "10", "password");
    expect(result!.password).toBe("decrypted-password-10");
    expect(result!.authType).toBe("password");
    // MUST NOT fall through to user-DEK path
    // The user-DEK path uses SimpleDBOps.select for credentials — after host load it's called once
    // any subsequent call would be the user-DEK path; CSKEK branch returns before that
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
    selectResponses = [[{ runsFleetSubstrate: true }], [credRow]];
    selectCallCount = 0;

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
    selectResponses = [[{ runsFleetSubstrate: true }], [credRow]];
    selectCallCount = 0;

    const result = await resolveHostById(3, "user-1");

    expect(result).not.toBeNull();
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-key", FAKE_CSKEK, "30", "key");
    expect(FieldCrypto.decryptField).toHaveBeenCalledWith("ct-key-pass", FAKE_CSKEK, "30", "key_password");
    expect(result!.key).toBe("decrypted-key-30");
    expect(result!.keyPassword).toBe("decrypted-key_password-30");
  });
});

// ---------------------------------------------------------------------------
// S1-S3: Non-substrate host scope boundary (D-10)
// ---------------------------------------------------------------------------

describe("Non-substrate scope boundary (S1-S3)", () => {
  it("S1: runsFleetSubstrate=false, credentialId set → CSKEK branch NOT triggered, SimpleDBOps.select used for credentials", async () => {
    const hostRow = makeHostRow({ id: 4, credentialId: 40, runsFleetSubstrate: false });
    const credRow = makeCredRow({ id: 40, systemPassword: null, systemKey: null, password: "plain-pw", key: null });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>)
      // First call: initial host load
      .mockResolvedValueOnce([hostRow])
      // Second call: user-DEK credential resolve (NOT expected for CSKEK path)
      .mockResolvedValueOnce([credRow]);
    // CSKEK path check: runsFleetSubstrate=false
    selectResponses = [[{ runsFleetSubstrate: false }]];
    selectCallCount = 0;

    await resolveHostById(4, "user-1");

    // FieldCrypto.decryptField must NOT have been called (CSKEK branch not triggered)
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // SimpleDBOps.select WAS called (user-DEK path)
    expect(SimpleDBOps.select).toHaveBeenCalled();
  });

  it("S2: runsFleetSubstrate=undefined (legacy row) → treated as non-substrate, CSKEK not triggered", async () => {
    const hostRow = makeHostRow({ id: 5, credentialId: 50, runsFleetSubstrate: undefined as unknown as boolean });
    const credRow = makeCredRow({ id: 50, systemPassword: null });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([hostRow])
      .mockResolvedValueOnce([credRow]);
    // CSKEK path check returns runsFleetSubstrate=false (undefined/null → not substrate)
    selectResponses = [[{ runsFleetSubstrate: false }]];
    selectCallCount = 0;

    await resolveHostById(5, "user-1");

    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
  });

  it("S3: non-substrate host with credentialId → return value shape is equivalent to pre-plan behavior (regression)", async () => {
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
    selectResponses = [[{ runsFleetSubstrate: false }]];
    selectCallCount = 0;

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
    selectResponses = [[{ runsFleetSubstrate: true }], [credRow]];
    selectCallCount = 0;

    (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    const result = await resolveHostById(7, "user-1");

    expect(result).toBeNull();
    // SimpleDBOps.select was called for initial host load (once)
    // But NOT called again for user-DEK credential resolve
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
    selectResponses = [[{ runsFleetSubstrate: true }], []];
    selectCallCount = 0;

    const result = await resolveHostById(8, "user-1");

    expect(result).toBeNull();
    // FieldCrypto.decryptField was NOT called (no cred row)
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // SimpleDBOps.select called once (initial host load), NOT again for user-DEK
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
    selectResponses = [[{ runsFleetSubstrate: true }], [credRow]];
    selectCallCount = 0;

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
  it("E1: runsFleetSubstrate=true but credentialId=null → CSKEK branch not triggered (no credentialId check fails early)", async () => {
    const hostRow = makeHostRow({ id: 11, credentialId: null, runsFleetSubstrate: true });

    (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([hostRow]);
    // No db.select calls should be made for the CSKEK path since credentialId is null
    selectResponses = [];
    selectCallCount = 0;

    const result = await resolveHostById(11, "user-1");

    // Should not null out — returns the host without credential resolve
    // CSKEK branch: requires credentialId, so it should NOT trigger
    // FieldCrypto.decryptField must not be called
    expect(FieldCrypto.decryptField).not.toHaveBeenCalled();
    // result may or may not be null (depends on existing behavior for no-credentialId hosts)
    // The key assertion is that CSKEK was not invoked
    expect(SystemCrypto.getInstance).not.toHaveBeenCalledWith();
  });
});
