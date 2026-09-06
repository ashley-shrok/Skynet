/**
 * user-crypto.test.ts — Tests for UserCrypto.deriveDekForMigration
 *
 * Plan 75-08 Task 1: sessionless DEK derivation for one-shot operator migrations.
 *
 * Test suite (D1-D5):
 *   D1: Happy path — returns a 32-byte Buffer
 *   D2: Wrong password throws (AES-GCM authTag mismatch)
 *   D3: Nonexistent user throws (no KEK salt on record)
 *   D4: Sessionless — does NOT populate userSessions after derive
 *   D5: Repeatable — two consecutive calls return equal DEK bytes
 *
 * Approach: mock getDb with an in-memory KV store that faithfully simulates the
 * settings-table read/write pattern used by UserCrypto internals. This gives
 * real PBKDF2/AES crypto behavior without requiring the native better-sqlite3
 * bindings in the test environment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory settings store — simulates the settings table KV operations
// ---------------------------------------------------------------------------

let store: Map<string, string>;

function makeSettingsDb() {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation((condition: unknown) => {
          // Extract key from the eq() condition — the condition is built as
          // eq(settings.key, keyValue). We capture the key via the mock below.
          return {
            // Settle on the promise interface used in getKEKSalt / getEncryptedDEK
            then: undefined, // not a promise itself
            // vitest awaits the result of the drizzle chain. drizzle returns an
            // array of rows. We simulate: if key is in store, return [{key, value}], else []
            // The condition carries the key via __queryKey__ set by the eq mock.
            __condition: condition,
          };
        }),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([]),
    })),
  };
}

// ---------------------------------------------------------------------------
// The real problem: drizzle's fluent chain is awaitable (it's a promise).
// We need the `where()` call to return a thenable that resolves to the right rows.
//
// Pattern used by UserCrypto:
//   await getDb().select().from(settings).where(eq(settings.key, key))
//   → resolves to: [] or [{key, value}]
//
//   await getDb().update(settings).set({value}).where(eq(settings.key, key))
//   → fire-and-forget, result ignored
//
//   await getDb().insert(settings).values({key, value})
//   → fire-and-forget, result ignored
//
// We build a fake DB that tracks eq() calls to extract the key being queried.
// ---------------------------------------------------------------------------

// Track what key the current eq() call is operating on
let _currentEqKey: string | null = null;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((_col: unknown, val: unknown) => {
      _currentEqKey = val as string;
      return { __eq: true, key: val };
    }),
  };
});

// Mock getDb to return a DB-like object whose methods use the in-memory store
vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(),
  db: {},
}));

vi.mock("./logger.js", () => ({
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are established
import { UserCrypto } from "./user-crypto.js";
import { getDb } from "../database/db/index.js";

// ---------------------------------------------------------------------------
// Build a mock DB that uses the in-memory store Map
// ---------------------------------------------------------------------------

function buildMockDb() {
  const select = vi.fn(() => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn((_condition: unknown) => {
        // At the time where() is called, _currentEqKey holds the key
        const queriedKey = _currentEqKey;
        _currentEqKey = null;
        if (queriedKey !== null && store.has(queriedKey)) {
          return Promise.resolve([{ key: queriedKey, value: store.get(queriedKey) }]);
        }
        return Promise.resolve([]);
      }),
    };
    return chain;
  });

  const update = vi.fn((_table: unknown) => ({
    set: vi.fn((data: { value: string }) => ({
      where: vi.fn((_condition: unknown) => {
        const updatedKey = _currentEqKey;
        _currentEqKey = null;
        if (updatedKey !== null) {
          store.set(updatedKey, data.value);
        }
        return Promise.resolve([]);
      }),
    })),
  }));

  const insert = vi.fn((_table: unknown) => ({
    values: vi.fn((data: { key: string; value: string }) => {
      store.set(data.key, data.value);
      return Promise.resolve([]);
    }),
  }));

  return { select, update, insert };
}

beforeEach(() => {
  // Fresh store + fresh mock DB per test
  store = new Map();
  const mockDb = buildMockDb();
  vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

  // Reset the UserCrypto singleton so each test starts clean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (UserCrypto as any).instance = undefined;
});

describe("UserCrypto.deriveDekForMigration (D1-D5)", () => {
  it("D1: happy path — returns a Buffer of length 32", async () => {
    const crypto = UserCrypto.getInstance();
    await crypto.setupUserEncryption("u1", "correct-pass");

    const dek = await crypto.deriveDekForMigration("u1", "correct-pass");

    expect(dek instanceof Buffer).toBe(true);
    expect(dek.length).toBe(32);

    // Caller cleanup
    dek.fill(0);
  });

  it("D2: wrong password throws (AES-GCM authTag mismatch)", async () => {
    const crypto = UserCrypto.getInstance();
    await crypto.setupUserEncryption("u1", "correct-pass");

    await expect(
      crypto.deriveDekForMigration("u1", "wrong-pass"),
    ).rejects.toThrow();
  });

  it("D3: nonexistent user throws (no KEK salt on record)", async () => {
    const crypto = UserCrypto.getInstance();
    // No setupUserEncryption call — user has no KEK salt

    await expect(
      crypto.deriveDekForMigration("no-such-user", "any-pass"),
    ).rejects.toThrow();
  });

  it("D4: sessionless — isUserUnlocked is false before AND after deriveDekForMigration", async () => {
    const crypto = UserCrypto.getInstance();
    await crypto.setupUserEncryption("u1", "correct-pass");

    // Before derive: definitely not unlocked (no authenticateUser call)
    expect(crypto.isUserUnlocked("u1")).toBe(false);

    const dek = await crypto.deriveDekForMigration("u1", "correct-pass");
    dek.fill(0);

    // After derive: must STILL be not unlocked (no session created)
    expect(crypto.isUserUnlocked("u1")).toBe(false);
  });

  it("D5: repeatable — two consecutive derives return equal DEK bytes", async () => {
    const crypto = UserCrypto.getInstance();
    await crypto.setupUserEncryption("u1", "correct-pass");

    const dek1 = await crypto.deriveDekForMigration("u1", "correct-pass");
    const dek2 = await crypto.deriveDekForMigration("u1", "correct-pass");

    expect(dek1.equals(dek2)).toBe(true);

    dek1.fill(0);
    dek2.fill(0);
  });
});
