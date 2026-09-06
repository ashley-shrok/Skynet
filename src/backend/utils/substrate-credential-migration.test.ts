/**
 * substrate-credential-migration.test.ts
 *
 * Plan 75-08 Task 2: Migration module tests.
 *
 * Test groups:
 *   PC1-PC2: Pre-check (inline-credential substrate hosts abort migration)
 *   H0: PASSPHRASE-CANARY — end-to-end fieldName chain (load-bearing for drift detection)
 *   H1: Password-only cred happy path + D-19 round-trip
 *   H2: Multiple hosts per user
 *   H3: Multiple users
 *   F1: Wrong password for one user does not break others
 *   F2: One corrupt cred row does not break the rest of the user's batch
 *   S1: Non-substrate hosts untouched
 *   S2: Hosts owned by users not in input are untouched
 *   P1: DatabaseSaveTrigger.forceSave called after each user batch
 *   SEC1: No plaintext passwords/keys appear in log call arguments
 *   SEC2: DEK Buffers derived during migration are zeroed after use
 *
 * Approach: all DB, crypto, and logger dependencies are mocked. An in-memory
 * store (Map) simulates sshCredentials and hosts rows. FieldCrypto uses real
 * AES-256-GCM via helpers so the fieldName context is correctly enforced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before all imports
// ---------------------------------------------------------------------------

vi.mock("./logger.js", () => ({
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

const FAKE_CSKEK = Buffer.from("cc".repeat(32), "hex");

vi.mock("./system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: vi.fn(() => ({
      getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
    })),
  },
}));

vi.mock("./database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: vi.fn().mockResolvedValue(undefined),
  },
}));

// UserCrypto mock — deriveDekForMigration returns a DEK from the registered map
const USER_DEKS: Map<string, Buffer> = new Map();

vi.mock("./user-crypto.js", () => ({
  UserCrypto: {
    getInstance: vi.fn(() => ({
      deriveDekForMigration: vi.fn(async (userId: string, password: string) => {
        const key = `${userId}:${password}`;
        if (!USER_DEKS.has(key)) {
          throw new Error(`Wrong password or user not onboarded: ${userId}`);
        }
        return Buffer.from(USER_DEKS.get(key)!);
      }),
    })),
  },
}));

// FieldCrypto: real AES-256-GCM so fieldName context is properly enforced
function realEncrypt(plaintext: string, key: Buffer, recordId: string, fieldName: string): string {
  const salt = crypto.randomBytes(16);
  const context = `${recordId}:${fieldName}`;
  const fieldKey = Buffer.from(crypto.hkdfSync("sha256", key, salt, context, 32));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", fieldKey, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = (cipher as crypto.CipherGCM).getAuthTag();
  return JSON.stringify({
    data: enc,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
    recordId,
  });
}

function realDecrypt(ciphertext: string, key: Buffer, recordId: string, fieldName: string): string {
  const parsed = JSON.parse(ciphertext);
  const salt = Buffer.from(parsed.salt, "hex");
  const context = `${parsed.recordId}:${fieldName}`;
  const fieldKey = Buffer.from(crypto.hkdfSync("sha256", key, salt, context, 32));
  const decipher = crypto.createDecipheriv("aes-256-gcm", fieldKey, Buffer.from(parsed.iv, "hex"));
  (decipher as crypto.DecipherGCM).setAuthTag(Buffer.from(parsed.tag, "hex"));
  let dec = decipher.update(parsed.data, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

vi.mock("./field-crypto.js", () => ({
  FieldCrypto: {
    encryptField: vi.fn(),
    decryptField: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// In-memory DB stores
// ---------------------------------------------------------------------------

interface CredRow {
  id: number;
  userId: string;
  password: string | null;
  key: string | null;
  keyPassword: string | null;
  systemPassword: string | null;
  systemKey: string | null;
  systemKeyPassword: string | null;
  updatedAt: string;
}

interface HostRow {
  id: number;
  credentialId: number | null;
  runsFleetSubstrate: boolean;
}

let credStore: Map<number, CredRow>;
let hostStore: Map<number, HostRow>;

// The mock DB needs to know which userId the per-user query is for.
// We extract this from the eq() mock's captured values.
let _capturedUserId: string = "";
let _capturedUpdateCredId: number | null = null;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((_col: unknown, val: unknown) => {
      if (typeof val === "string") {
        _capturedUserId = val;
      }
      if (typeof val === "number") {
        _capturedUpdateCredId = val;
      }
      return { __eq: true, val };
    }),
    and: vi.fn((...args: unknown[]) => ({ __and: true, args })),
    isNull: vi.fn((_col: unknown) => ({ __isNull: true })),
  };
});

// Track which query context we are in
type QueryContext = "precheck" | "per-user-join" | "unknown";
let _selectContext: QueryContext = "unknown";

function buildMockDb() {
  const select = vi.fn((cols?: Record<string, unknown>) => {
    if (cols && "hostId" in cols && !("credId" in cols)) {
      _selectContext = "precheck";
    } else if (cols && "credId" in cols) {
      _selectContext = "per-user-join";
    } else {
      _selectContext = "unknown";
    }

    const chainObj = {
      from: vi.fn(() => chainObj),
      innerJoin: vi.fn(() => chainObj),
      where: vi.fn((_cond: unknown) => {
        if (_selectContext === "precheck") {
          const bad: { hostId: number }[] = [];
          for (const [, host] of hostStore) {
            if (host.runsFleetSubstrate && host.credentialId === null) {
              bad.push({ hostId: host.id });
            }
          }
          return Promise.resolve(bad);
        }
        if (_selectContext === "per-user-join") {
          const userId = _capturedUserId;
          const rows: Record<string, unknown>[] = [];
          for (const [, host] of hostStore) {
            if (host.runsFleetSubstrate && host.credentialId !== null) {
              const cred = credStore.get(host.credentialId);
              if (cred && cred.userId === userId) {
                rows.push({
                  credId: cred.id,
                  credPassword: cred.password,
                  credKey: cred.key,
                  credKeyPassword: cred.keyPassword,
                  hostId: host.id,
                });
              }
            }
          }
          return Promise.resolve(rows);
        }
        return Promise.resolve([]);
      }),
    };
    return chainObj;
  });

  const update = vi.fn((_table: unknown) => ({
    set: vi.fn((data: { systemPassword?: string | null; systemKey?: string | null; systemKeyPassword?: string | null; updatedAt?: string }) => ({
      where: vi.fn((_cond: unknown) => {
        const credId = _capturedUpdateCredId;
        _capturedUpdateCredId = null;
        if (credId !== null && credStore.has(credId)) {
          const row = credStore.get(credId)!;
          if (data.systemPassword !== undefined) row.systemPassword = data.systemPassword ?? null;
          if (data.systemKey !== undefined) row.systemKey = data.systemKey ?? null;
          if (data.systemKeyPassword !== undefined) row.systemKeyPassword = data.systemKeyPassword ?? null;
          if (data.updatedAt) row.updatedAt = data.updatedAt;
        }
        return Promise.resolve([]);
      }),
    })),
  }));

  return { select, update };
}

vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(),
  db: {},
}));

vi.mock("../database/db/schema.js", () => ({
  sshCredentials: {
    id: "sshCred.id",
    userId: "sshCred.userId",
    password: "sshCred.password",
    key: "sshCred.key",
    keyPassword: "sshCred.keyPassword",
  },
  hosts: {
    id: "hosts.id",
    credentialId: "hosts.credentialId",
    runsFleetSubstrate: "hosts.runsFleetSubstrate",
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { migrateSubstrateCredentials } from "./substrate-credential-migration.js";
import { getDb } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "./database-save-trigger.js";
import { databaseLogger } from "./logger.js";
import { SystemCrypto } from "./system-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { UserCrypto } from "./user-crypto.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let nextCredId = 100;
let nextHostId = 200;

function makeCredRow(overrides: Partial<CredRow> & { userId: string }): CredRow {
  return {
    id: nextCredId++,
    password: null,
    key: null,
    keyPassword: null,
    systemPassword: null,
    systemKey: null,
    systemKeyPassword: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeHostRow(id: number, credentialId: number | null, runsFleetSubstrate: boolean): HostRow {
  return { id, credentialId, runsFleetSubstrate };
}

function registerUserDek(userId: string, password: string): Buffer {
  const dek = crypto.randomBytes(32);
  USER_DEKS.set(`${userId}:${password}`, dek);
  return dek;
}

function encryptWithDek(plain: string, dek: Buffer, credId: number, fieldName: string): string {
  return realEncrypt(plain, dek, String(credId), fieldName);
}

beforeEach(() => {
  credStore = new Map();
  hostStore = new Map();
  nextCredId = 100;
  nextHostId = 200;
  USER_DEKS.clear();
  _capturedUserId = "";
  _capturedUpdateCredId = null;
  _selectContext = "unknown";

  vi.clearAllMocks();

  vi.mocked(SystemCrypto.getInstance).mockReturnValue({
    getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
  });
  vi.mocked(DatabaseSaveTrigger.forceSave).mockResolvedValue(undefined);
  vi.mocked(FieldCrypto.encryptField).mockImplementation(realEncrypt);
  vi.mocked(FieldCrypto.decryptField).mockImplementation(realDecrypt);
  vi.mocked(UserCrypto.getInstance).mockReturnValue({
    deriveDekForMigration: vi.fn(async (userId: string, password: string) => {
      const k = `${userId}:${password}`;
      if (!USER_DEKS.has(k)) throw new Error(`Wrong password or not onboarded: ${userId}`);
      return Buffer.from(USER_DEKS.get(k)!);
    }),
  } as ReturnType<typeof UserCrypto.getInstance>);

  const mockDb = buildMockDb();
  vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
});

// ---------------------------------------------------------------------------
// PC1-PC2: Pre-check
// ---------------------------------------------------------------------------

describe("Pre-check (PC1-PC2)", () => {
  it("PC1: inline-credential substrate host (credentialId=null) → aborts migration with host ID in preCheck", async () => {
    hostStore.set(200, makeHostRow(200, null, true));

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.aborted).toBe(true);
    expect(result.preCheck.inlineCredentialSubstrateHosts).toContain(200);
    expect(result.perUser).toHaveLength(0);
  });

  it("PC2: no inline-credential substrate hosts → pre-check passes, migration proceeds", async () => {
    const u1Dek = registerUserDek("u1", "pw1");
    const credId = nextCredId;
    const cred = makeCredRow({ userId: "u1", password: encryptWithDek("pw", u1Dek, credId, "password") });
    credStore.set(cred.id, cred);
    hostStore.set(200, makeHostRow(200, cred.id, true));

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.aborted).toBe(false);
    expect(result.preCheck.inlineCredentialSubstrateHosts).toHaveLength(0);
    expect(result.perUser).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H0: PASSPHRASE-CANARY (load-bearing test for fieldName drift)
// ---------------------------------------------------------------------------

describe("H0: Passphrase-protected key round-trip (fieldName drift canary)", () => {
  it("H0: user-DEK encrypt 'keyPassword'(camelCase) → migration decrypt 'keyPassword' → CSKEK re-encrypt 'key_password'(snake_case) → CSKEK decrypt 'key_password' recovers original passphrase", async () => {
    const PLAIN_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nfakeKeyMaterial\n-----END OPENSSH PRIVATE KEY-----";
    const PLAIN_PASSPHRASE = "test-passphrase-with-symbols-!@#";

    const u1Dek = registerUserDek("u1", "pw1");
    const credId = nextCredId;

    // Encrypt with user DEK using camelCase "keyPassword" (production write path — line 67)
    const encKey = encryptWithDek(PLAIN_KEY, u1Dek, credId, "key");
    const encKeyPassword = encryptWithDek(PLAIN_PASSPHRASE, u1Dek, credId, "keyPassword"); // camelCase

    const cred = makeCredRow({
      userId: "u1",
      key: encKey,
      keyPassword: encKeyPassword,
    });
    credStore.set(cred.id, cred);
    hostStore.set(200, makeHostRow(200, cred.id, true));

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.aborted).toBe(false);
    expect(result.perUser[0].migrated).toBe(1);
    expect(result.perUser[0].failed).toBe(0);

    const updatedCred = credStore.get(cred.id)!;
    expect(updatedCred.systemKey).not.toBeNull();
    expect(updatedCred.systemKeyPassword).not.toBeNull();

    // CSKEK decrypt: "key" for the key field, "key_password" (snake_case) for passphrase — line 94
    const recoveredKey = realDecrypt(updatedCred.systemKey!, FAKE_CSKEK, String(cred.id), "key");
    const recoveredPassphrase = realDecrypt(updatedCred.systemKeyPassword!, FAKE_CSKEK, String(cred.id), "key_password");

    expect(recoveredKey).toBe(PLAIN_KEY);
    expect(recoveredPassphrase).toBe(PLAIN_PASSPHRASE);
  });
});

// ---------------------------------------------------------------------------
// H1: Password-only cred happy path + D-19 round-trip
// ---------------------------------------------------------------------------

describe("H1: Password-only credential happy path (D-13, D-14, D-19)", () => {
  it("H1: migrates password cred + CSKEK decrypt recovers original plaintext (D-19 round-trip)", async () => {
    const PLAIN_PW = "super-secret-ssh-password";
    const u1Dek = registerUserDek("u1", "pw1");
    const credId = nextCredId;

    const cred = makeCredRow({
      userId: "u1",
      password: encryptWithDek(PLAIN_PW, u1Dek, credId, "password"),
    });
    credStore.set(cred.id, cred);
    hostStore.set(200, makeHostRow(200, cred.id, true));

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.perUser[0].migrated).toBe(1);
    expect(result.perUser[0].failed).toBe(0);

    const updatedCred = credStore.get(cred.id)!;
    expect(updatedCred.systemPassword).not.toBeNull();

    const recovered = realDecrypt(updatedCred.systemPassword!, FAKE_CSKEK, String(cred.id), "password");
    expect(recovered).toBe(PLAIN_PW);
  });
});

// ---------------------------------------------------------------------------
// H2: Multiple hosts per user
// ---------------------------------------------------------------------------

describe("H2: Multiple substrate hosts per user", () => {
  it("H2: 3 substrate hosts for u1 — all 3 migrated", async () => {
    const u1Dek = registerUserDek("u1", "pw1");

    for (let i = 0; i < 3; i++) {
      const credId = nextCredId;
      const hostId = nextHostId++;
      const cred = makeCredRow({
        userId: "u1",
        password: encryptWithDek(`password-${i}`, u1Dek, credId, "password"),
      });
      credStore.set(cred.id, cred);
      hostStore.set(hostId, makeHostRow(hostId, cred.id, true));
    }

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.perUser[0].migrated).toBe(3);
    expect(result.perUser[0].failed).toBe(0);
    expect(result.perUser[0].hosts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// H3: Multiple users
// ---------------------------------------------------------------------------

describe("H3: Multiple users", () => {
  it("H3: u1 has 2 hosts, u2 has 1 host — both migrated in respective passes", async () => {
    const u1Dek = registerUserDek("u1", "pw1");
    const u2Dek = registerUserDek("u2", "pw2");

    for (let i = 0; i < 2; i++) {
      const credId = nextCredId;
      const hostId = nextHostId++;
      const cred = makeCredRow({
        userId: "u1",
        password: encryptWithDek(`u1-pw-${i}`, u1Dek, credId, "password"),
      });
      credStore.set(cred.id, cred);
      hostStore.set(hostId, makeHostRow(hostId, cred.id, true));
    }

    const u2CredId = nextCredId;
    const u2Cred = makeCredRow({
      userId: "u2",
      password: encryptWithDek("u2-pw", u2Dek, u2CredId, "password"),
    });
    credStore.set(u2Cred.id, u2Cred);
    hostStore.set(nextHostId, makeHostRow(nextHostId++, u2Cred.id, true));

    const result = await migrateSubstrateCredentials([
      { userId: "u1", password: "pw1" },
      { userId: "u2", password: "pw2" },
    ]);

    expect(result.perUser).toHaveLength(2);
    const u1Result = result.perUser.find(r => r.userId === "u1");
    const u2Result = result.perUser.find(r => r.userId === "u2");
    expect(u1Result?.migrated).toBe(2);
    expect(u2Result?.migrated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F1: Wrong password for one user does not break others
// ---------------------------------------------------------------------------

describe("F1: Failure isolation — wrong password", () => {
  it("F1: u1 correct password + u2 wrong password → u1 migrated, u2 has error, no throw", async () => {
    const u1Dek = registerUserDek("u1", "correct-pw1");
    const credId1 = nextCredId;
    const cred1 = makeCredRow({
      userId: "u1",
      password: encryptWithDek("u1-secret", u1Dek, credId1, "password"),
    });
    credStore.set(cred1.id, cred1);
    hostStore.set(200, makeHostRow(200, cred1.id, true));

    // u2 has a cred but we pass wrong password
    registerUserDek("u2", "correct-pw2");
    const credId2 = nextCredId;
    const cred2 = makeCredRow({ userId: "u2", password: "encrypted-u2-pw" });
    credStore.set(cred2.id, cred2);
    hostStore.set(201, makeHostRow(201, cred2.id, true));

    const result = await migrateSubstrateCredentials([
      { userId: "u1", password: "correct-pw1" },
      { userId: "u2", password: "WRONG-PASSWORD" },
    ]);

    const u1Result = result.perUser.find(r => r.userId === "u1");
    const u2Result = result.perUser.find(r => r.userId === "u2");

    expect(u1Result?.migrated).toBeGreaterThanOrEqual(1);
    expect(u2Result?.error).toBeTruthy();
    expect(credStore.get(cred1.id)?.systemPassword).not.toBeNull();
    expect(credStore.get(cred2.id)?.systemPassword).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F2: One corrupt cred row does not break the rest
// ---------------------------------------------------------------------------

describe("F2: Per-row failure isolation", () => {
  it("F2: corrupt cred in user batch — other creds still migrate, failed count incremented", async () => {
    const u1Dek = registerUserDek("u1", "pw1");

    // cred A: normal
    const credIdA = nextCredId;
    const credA = makeCredRow({
      userId: "u1",
      password: encryptWithDek("good-pw", u1Dek, credIdA, "password"),
    });
    credStore.set(credA.id, credA);
    hostStore.set(200, makeHostRow(200, credA.id, true));

    // cred B: corrupt — decryptField will throw for this one
    const credIdB = nextCredId;
    const credB = makeCredRow({ userId: "u1", password: "CORRUPT_CIPHERTEXT" });
    credStore.set(credB.id, credB);
    hostStore.set(201, makeHostRow(201, credB.id, true));

    vi.mocked(FieldCrypto.decryptField).mockImplementation(
      (ciphertext: string, key: Buffer, recordId: string, fieldName: string) => {
        if (recordId === String(credB.id)) throw new Error("corrupt ciphertext");
        return realDecrypt(ciphertext, key, recordId, fieldName);
      }
    );

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    const u1Result = result.perUser[0];
    expect(u1Result.migrated).toBeGreaterThanOrEqual(1);
    expect(u1Result.failed).toBeGreaterThanOrEqual(1);
    expect(credStore.get(credA.id)?.systemPassword).not.toBeNull();
    expect(credStore.get(credB.id)?.systemPassword).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S1: Non-substrate hosts untouched
// ---------------------------------------------------------------------------

describe("S1: Non-substrate hosts are not migrated", () => {
  it("S1: non-substrate host credential system_* columns remain null after migration", async () => {
    const u1Dek = registerUserDek("u1", "pw1");

    const subCredId = nextCredId;
    const subCred = makeCredRow({
      userId: "u1",
      password: encryptWithDek("sub-pw", u1Dek, subCredId, "password"),
    });
    credStore.set(subCred.id, subCred);
    hostStore.set(200, makeHostRow(200, subCred.id, true));

    const nonSubCredId = nextCredId;
    const nonSubCred = makeCredRow({
      userId: "u1",
      password: encryptWithDek("non-sub-pw", u1Dek, nonSubCredId, "password"),
    });
    credStore.set(nonSubCred.id, nonSubCred);
    hostStore.set(201, makeHostRow(201, nonSubCred.id, false)); // NOT substrate

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.perUser[0].migrated).toBe(1);
    expect(credStore.get(subCred.id)?.systemPassword).not.toBeNull();
    expect(credStore.get(nonSubCred.id)?.systemPassword).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S2: Hosts owned by users not in input untouched
// ---------------------------------------------------------------------------

describe("S2: Hosts owned by users not in input are untouched", () => {
  it("S2: u3 not in migration input — u3 substrate hosts remain un-migrated", async () => {
    const u1Dek = registerUserDek("u1", "pw1");

    const u1CredId = nextCredId;
    const u1Cred = makeCredRow({
      userId: "u1",
      password: encryptWithDek("u1-pw", u1Dek, u1CredId, "password"),
    });
    credStore.set(u1Cred.id, u1Cred);
    hostStore.set(200, makeHostRow(200, u1Cred.id, true));

    // u3 not in input
    const u3CredId = nextCredId;
    const u3Cred = makeCredRow({ userId: "u3", password: "u3-encrypted" });
    credStore.set(u3Cred.id, u3Cred);
    hostStore.set(201, makeHostRow(201, u3Cred.id, true));

    const result = await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(result.perUser).toHaveLength(1);
    expect(result.perUser[0].userId).toBe("u1");
    expect(credStore.get(u3Cred.id)?.systemPassword).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P1: DatabaseSaveTrigger.forceSave called after each user batch
// ---------------------------------------------------------------------------

describe("P1: DatabaseSaveTrigger.forceSave called per user batch", () => {
  it("P1: forceSave called once per user (2 users → 2 calls), each with a descriptive reason string", async () => {
    const u1Dek = registerUserDek("u1", "pw1");
    const u2Dek = registerUserDek("u2", "pw2");

    const cred1 = makeCredRow({
      userId: "u1",
      password: encryptWithDek("pw", u1Dek, nextCredId, "password"),
    });
    credStore.set(cred1.id, cred1);
    hostStore.set(200, makeHostRow(200, cred1.id, true));

    const cred2 = makeCredRow({
      userId: "u2",
      password: encryptWithDek("pw2", u2Dek, nextCredId, "password"),
    });
    credStore.set(cred2.id, cred2);
    hostStore.set(201, makeHostRow(201, cred2.id, true));

    await migrateSubstrateCredentials([
      { userId: "u1", password: "pw1" },
      { userId: "u2", password: "pw2" },
    ]);

    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(2);
    for (const [reason] of vi.mocked(DatabaseSaveTrigger.forceSave).mock.calls) {
      expect(typeof reason).toBe("string");
      expect((reason as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SEC1: No plaintext credential material in log calls
// ---------------------------------------------------------------------------

describe("SEC1: No plaintext credential material in log calls", () => {
  it("SEC1: plaintext passwords and DEK hex never appear in databaseLogger calls", async () => {
    const SECRET_PW = "absolutely-secret-password-DO-NOT-LOG";
    const u1Dek = registerUserDek("u1", "input-pw");
    const DEK_HEX = USER_DEKS.get("u1:input-pw")!.toString("hex");

    const cred = makeCredRow({
      userId: "u1",
      password: encryptWithDek(SECRET_PW, u1Dek, nextCredId, "password"),
    });
    credStore.set(cred.id, cred);
    hostStore.set(200, makeHostRow(200, cred.id, true));

    // Trigger a per-row failure to exercise the warn log path
    vi.mocked(FieldCrypto.decryptField).mockImplementationOnce(() => {
      throw new Error("simulated decrypt failure");
    });

    await migrateSubstrateCredentials([{ userId: "u1", password: "input-pw" }]);

    const allLogArgs = JSON.stringify([
      ...(vi.mocked(databaseLogger.warn) as ReturnType<typeof vi.fn>).mock.calls,
      ...(vi.mocked(databaseLogger.info) as ReturnType<typeof vi.fn>).mock.calls,
      ...(vi.mocked(databaseLogger.error) as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(allLogArgs).not.toContain(SECRET_PW);
    expect(allLogArgs).not.toContain(DEK_HEX);
    expect(allLogArgs).not.toContain(FAKE_CSKEK.toString("hex"));
  });
});

// ---------------------------------------------------------------------------
// SEC2: DEK Buffers zeroed after migration
// ---------------------------------------------------------------------------

describe("SEC2: DEK Buffers zeroed after migration completes", () => {
  it("SEC2: the DEK Buffer returned by deriveDekForMigration is all-zero after the user batch completes", async () => {
    const capturedDeks: Buffer[] = [];

    vi.mocked(UserCrypto.getInstance).mockReturnValue({
      deriveDekForMigration: vi.fn(async (userId: string, password: string) => {
        const k = `${userId}:${password}`;
        if (!USER_DEKS.has(k)) throw new Error(`No DEK for ${userId}`);
        const dek = Buffer.from(USER_DEKS.get(k)!);
        capturedDeks.push(dek);
        return dek;
      }),
    } as ReturnType<typeof UserCrypto.getInstance>);

    const u1Dek = registerUserDek("u1", "pw1");
    const cred = makeCredRow({
      userId: "u1",
      password: encryptWithDek("secret", u1Dek, nextCredId, "password"),
    });
    credStore.set(cred.id, cred);
    hostStore.set(200, makeHostRow(200, cred.id, true));

    await migrateSubstrateCredentials([{ userId: "u1", password: "pw1" }]);

    expect(capturedDeks.length).toBeGreaterThan(0);
    for (const dek of capturedDeks) {
      const allZero = dek.every(b => b === 0);
      expect(allZero).toBe(true);
    }
  });
});
