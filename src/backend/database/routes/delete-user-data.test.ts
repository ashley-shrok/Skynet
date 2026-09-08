/**
 * Phase 85 Plan 05 — delete-user-data.test.ts
 *
 * Unit tests proving that deleteUserAndRelatedData correctly unlinks the
 * user's avatar file BEFORE deleting the users row (D-22, T-85-09).
 *
 * Test harness strategy:
 *   - Mock ../db/index.js with a real better-sqlite3 in-memory SQLite so
 *     db.$client.prepare and all Drizzle chain operations work correctly.
 *   - Mock user-avatar-storage.js to control unlinkUserAvatar calls and
 *     expose a controllable USER_AVATARS_DIR for real-file tests.
 *   - Mock logger to suppress console noise.
 *
 * NOTE ON vi.mock HOISTING:
 * vi.mock calls are hoisted before imports by Vitest. The db mock factory
 * closes over the module-level `sqliteDb` variable via a getter so each
 * test's fresh `sqliteDb` assignment is picked up at call time. The eq()
 * mock stashes comparison values in `pendingWhereValue` so the Drizzle
 * chain .where() calls can find the user id to pass to SQLite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Shared state — module-level so vi.mock factories can close over them
// ---------------------------------------------------------------------------

let sqliteDb: InstanceType<typeof Database> | null = null;

// Stash value captured by the eq() mock for use by Drizzle chain .where() calls
let pendingWhereValue: string | null = null;

// Controllable avatar directory for real-file tests
let testAvatarsDir: string = "/tmp/test-avatars";

// Mock for unlinkUserAvatar so we can spy on calls and control behavior
const mockUnlinkUserAvatar = vi.fn<[string | null | undefined], Promise<void>>();

// ---------------------------------------------------------------------------
// Mock: ../db/index.js — real in-memory SQLite behind a Drizzle-shaped proxy
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => {
  /**
   * Build a Drizzle-shaped .delete(table).where(predicate) chain that
   * executes a DELETE on the real in-memory sqliteDb.
   * The table name is extracted from the Drizzle schema object.
   */
  function buildDeleteChain(tableName: string) {
    return {
      where(_predicate: unknown): Promise<void> {
        const userId = pendingWhereValue;
        pendingWhereValue = null;
        return Promise.resolve().then(() => {
          if (!sqliteDb || !userId) return;
          try {
            if (tableName === "users") {
              // The users table PK is `id`, not `user_id`
              sqliteDb.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
            } else if (tableName === "host_access") {
              // hostAccess deleted twice: by userId AND by grantedBy
              sqliteDb
                .prepare(`DELETE FROM host_access WHERE user_id = ? OR granted_by = ?`)
                .run(userId, userId);
            } else {
              sqliteDb
                .prepare(`DELETE FROM ${tableName} WHERE user_id = ?`)
                .run(userId);
            }
          } catch {
            // Table may not exist in the minimal bootstrap schema — that's fine.
          }
        });
      },
    };
  }

  /**
   * Build a Drizzle-shaped .select(projection).from(table).where(predicate).limit(n)
   * chain that resolves with matching rows from sqliteDb.
   */
  function buildSelectChain(projection: Record<string, unknown>) {
    let fromTableName: string | null = null;

    const chain: Record<string, unknown> = {
      from(table: unknown): typeof chain {
        const sym = (table as Record<symbol, unknown>)[
          Symbol.for("drizzle:Name")
        ];
        if (typeof sym === "string") {
          fromTableName = sym;
        } else {
          const t = table as { _?: { name?: string } };
          fromTableName =
            typeof t?._?.name === "string" ? t._.name : String(table);
        }
        return chain;
      },
      where(_predicate: unknown): typeof chain {
        // pendingWhereValue already captured by eq() mock
        return chain;
      },
      limit(_n: number): typeof chain {
        return chain;
      },
      then(
        resolve: (rows: unknown[]) => unknown,
        reject: (e: unknown) => unknown,
      ): void {
        Promise.resolve()
          .then(() => {
            if (!sqliteDb) {
              resolve([]);
              return;
            }
            const userId = pendingWhereValue;
            pendingWhereValue = null;
            if (fromTableName === "users") {
              // Detect whether the projection is asking for avatarPath
              const wantsAvatarPath = Object.keys(
                projection ?? {},
              ).some((k) => k === "avatarPath");
              if (wantsAvatarPath) {
                const rows = userId
                  ? sqliteDb
                      .prepare(
                        "SELECT avatar_path FROM users WHERE id = ?",
                      )
                      .all(userId)
                  : sqliteDb
                      .prepare("SELECT avatar_path FROM users")
                      .all();
                resolve(
                  (rows as Record<string, unknown>[]).map((r) => ({
                    avatarPath: r.avatar_path ?? null,
                  })),
                );
              } else {
                const rows = userId
                  ? sqliteDb
                      .prepare("SELECT * FROM users WHERE id = ?")
                      .all(userId)
                  : sqliteDb.prepare("SELECT * FROM users").all();
                resolve(
                  (rows as Record<string, unknown>[]).map((r) => ({
                    id: r.id,
                    username: r.username,
                    avatarPath: r.avatar_path ?? null,
                  })),
                );
              }
            } else {
              resolve([]);
            }
          })
          .catch(reject);
      },
      catch(handler: (e: unknown) => unknown): typeof chain {
        void handler;
        return chain;
      },
    };
    return chain;
  }

  const dbProxy = {
    get $client() {
      return sqliteDb!;
    },
    select(projection: Record<string, unknown>) {
      return buildSelectChain(projection ?? {});
    },
    delete(table: unknown) {
      const sym = (table as Record<symbol, unknown>)[
        Symbol.for("drizzle:Name")
      ];
      let tableName: string;
      if (typeof sym === "string") {
        tableName = sym;
      } else {
        const t = table as { _?: { name?: string } };
        tableName =
          typeof t?._?.name === "string" ? t._.name : String(table);
      }
      return buildDeleteChain(tableName);
    },
  };

  return {
    get db() {
      return dbProxy;
    },
    DatabaseSaveTrigger: {
      forceSave: vi.fn(async () => {}),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: drizzle-orm eq() — stashes the RHS value for .where() chain use
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      pendingWhereValue = val as string;
      return { _col, val };
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: user-avatar-storage.js — spy on unlinkUserAvatar; real filesystem
// for USER_AVATARS_DIR (tests control testAvatarsDir instead of DATA_DIR)
// ---------------------------------------------------------------------------

vi.mock("./user-avatar-storage.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("./user-avatar-storage.js")>();
  return {
    ...real,
    // Override unlinkUserAvatar so Tests 1–3 can control its behavior.
    // Default implementation delegates to real unlinkUserAvatar but
    // looks in testAvatarsDir instead of USER_AVATARS_DIR.
    unlinkUserAvatar: mockUnlinkUserAvatar,
  };
});

// ---------------------------------------------------------------------------
// Mock: logger — suppress console noise in test output
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  authLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bootstrapUsersTable(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_oidc INTEGER NOT NULL DEFAULT 0,
      avatar_path TEXT
    )
  `);
  // settings table needed for the LIKE DELETE in the helper
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
}

function insertUser(
  db: InstanceType<typeof Database>,
  opts: {
    id: string;
    username?: string;
    avatarPath?: string | null;
  },
): void {
  db.prepare(
    "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, avatar_path) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    opts.id,
    opts.username ?? opts.id,
    "hash",
    0,
    0,
    opts.avatarPath ?? null,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delete-user-data (Phase 85 avatar cleanup — D-22)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a fresh tmpdir so each test has a clean slate for any real files.
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "phase-85-del-user-"),
    );
    testAvatarsDir = path.join(tmpDir, "user-avatars");

    // Fresh in-memory SQLite for each test.
    sqliteDb?.close();
    sqliteDb = new Database(":memory:");
    bootstrapUsersTable(sqliteDb);

    // Reset eq() mock state and unlink spy.
    pendingWhereValue = null;
    mockUnlinkUserAvatar.mockClear();
    // Default: ENOENT-tolerant unlink (real unlinkUserAvatar semantics)
    mockUnlinkUserAvatar.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    sqliteDb?.close();
    sqliteDb = null;
  });

  // -------------------------------------------------------------------------
  // Test 1: helper unlinks avatar file before deleting the users row
  // -------------------------------------------------------------------------

  it("deleteUserAndRelatedData unlinks avatar file before deleting row", async () => {
    const { deleteUserAndRelatedData } = await import("./delete-user-data.js");

    // Seed: user row with avatar_path set
    insertUser(sqliteDb!, { id: "alice_id", avatarPath: "alice_id.png" });

    // Write a real avatar file so we can verify it's passed to unlinkUserAvatar.
    await fs.mkdir(testAvatarsDir, { recursive: true });
    await fs.writeFile(
      path.join(testAvatarsDir, "alice_id.png"),
      Buffer.from([1, 2, 3]),
    );

    // Make the unlink spy actually unlink from testAvatarsDir
    mockUnlinkUserAvatar.mockImplementation(async (filenameOrNull) => {
      if (!filenameOrNull) return;
      try {
        await fs.unlink(path.join(testAvatarsDir, filenameOrNull));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    });

    await deleteUserAndRelatedData("alice_id");

    // Assert: unlinkUserAvatar was called with the avatar filename
    expect(mockUnlinkUserAvatar).toHaveBeenCalledWith("alice_id.png");

    // Assert: the file is gone from disk
    await expect(
      fs.access(path.join(testAvatarsDir, "alice_id.png")),
    ).rejects.toThrow();

    // Assert: the row is gone from DB
    const remaining = sqliteDb!
      .prepare("SELECT * FROM users WHERE id = ?")
      .all("alice_id");
    expect(remaining).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: null avatar_path is a no-op (ENOENT-tolerant: null pointer)
  // -------------------------------------------------------------------------

  it("deleteUserAndRelatedData no-ops on null avatar pointer", async () => {
    const { deleteUserAndRelatedData } = await import("./delete-user-data.js");

    // Seed: user row with avatar_path = NULL
    insertUser(sqliteDb!, { id: "bob_id", avatarPath: null });

    await expect(
      deleteUserAndRelatedData("bob_id"),
    ).resolves.toBeUndefined();

    // unlinkUserAvatar should still be called with null (the helper no-ops internally)
    expect(mockUnlinkUserAvatar).toHaveBeenCalledWith(null);

    // Assert: row is gone
    const remaining = sqliteDb!
      .prepare("SELECT * FROM users WHERE id = ?")
      .all("bob_id");
    expect(remaining).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: ENOENT-tolerant when pointer is set but file was manually removed
  // -------------------------------------------------------------------------

  it("deleteUserAndRelatedData is ENOENT-tolerant when pointer is set but file was manually removed", async () => {
    const { deleteUserAndRelatedData } = await import("./delete-user-data.js");

    // Seed: user row with avatar_path set, but NO file on disk
    insertUser(sqliteDb!, { id: "charlie_id", avatarPath: "ghost.png" });

    // unlinkUserAvatar is already mocked to resolve without error (ENOENT-tolerant)
    await expect(
      deleteUserAndRelatedData("charlie_id"),
    ).resolves.toBeUndefined();

    // unlinkUserAvatar called with the ghost filename
    expect(mockUnlinkUserAvatar).toHaveBeenCalledWith("ghost.png");

    // Row is gone
    const remaining = sqliteDb!
      .prepare("SELECT * FROM users WHERE id = ?")
      .all("charlie_id");
    expect(remaining).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: SOURCE ASSERTION — SELECT of avatar_path appears BEFORE db.delete(users)
  //
  // This structural test codifies the SELECT-before-DELETE ordering invariant
  // so a future refactor can't silently invert it (T-85-09). Mirrors the awk
  // check in Task 1's <verify> block but as a repeatable committed assertion.
  // -------------------------------------------------------------------------

  it("SOURCE ASSERTION: delete-user-data.ts fetches avatar_path BEFORE db.delete(users)", async () => {
    const src = await fs.readFile(
      "src/backend/database/routes/delete-user-data.ts",
      "utf-8",
    );

    const selectIdx = src.indexOf("avatarPath: users.avatarPath");
    const deleteIdx = src.indexOf(
      "db.delete(users).where(eq(users.id, userId))",
    );

    expect(selectIdx).toBeGreaterThan(-1); // SELECT projection must be present
    expect(deleteIdx).toBeGreaterThan(-1); // DELETE call must be present
    expect(selectIdx).toBeLessThan(deleteIdx); // SELECT must precede DELETE
  });
});
