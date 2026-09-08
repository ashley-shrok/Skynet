/**
 * identity-send-log-store.test.ts — unit coverage for the Phase 85-02
 * single-seam store module.
 *
 * Contract under test (10 cases):
 *   Test 1: insert path (no row) → row lands with correct values;
 *           persistence flush fires once with the Phase-79 reason.
 *   Test 2: update path (existing row, newer ts) → row advances;
 *           persistence flush fires again.
 *   Test 3: monotonic skip (existing row, older ts) → row unchanged;
 *           persistence flush NOT called.
 *   Test 4: monotonic skip (existing row, equal ts) → row unchanged;
 *           persistence flush NOT called.
 *   Test 5: round-trip read via getIdentityLastSend → returns latest ts.
 *   Test 6: getIdentityLastSend for unknown identity → null (no throw).
 *   Test 7: validation-skip (empty identityName) → no write, no flush.
 *   Test 8: validation-skip (NaN ts) → no write, no flush.
 *   Test 9: persistence-flush throw → write completes, no propagation.
 *   Test 10: distinct identities keep distinct rows (no cross-contamination).
 *
 * Mocking strategy — mirrors user-preferences.test.ts and
 * compose-drafts.test.ts:
 *   - vi.mock("../database/db/index.js") swaps `db` for a Map-backed mock
 *     that speaks the drizzle chain shape (.insert(...).values(...)
 *     .onConflictDoUpdate(...), .select(...).from(...).where(...).limit(...)).
 *   - vi.mock("drizzle-orm") stubs `eq` (captures the identityName arg) and
 *     `sql` (no-op token; the mock DB doesn't evaluate CURRENT_TIMESTAMP).
 *   - vi.mock for DatabaseSaveTrigger.forceSave is a vi.fn spy — assert call
 *     count + reason arg per test. Test 9 overrides once with mockRejectedValueOnce.
 *   - vi.mock for the logger stubs info/warn/debug/error to keep tests quiet.
 *
 * Focus: THIS module's contract only. Underlying drizzle transaction and
 * SQLite CREATE TABLE semantics are covered by Plan 85-01's migration test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory storage — a Map<identityName, { lastSendAt }>
// ---------------------------------------------------------------------------

type Row = { identityName: string; lastSendAt: number };

const rows = new Map<string, Row>();

// Capture the identityName passed to eq() so the .where().limit() chain
// knows which row to return.
let capturedIdentityName: string | null = null;

// ---------------------------------------------------------------------------
// Mock db — simulates drizzle chains used by the store module
// ---------------------------------------------------------------------------

const selectChain = {
  from(_table: unknown) {
    void _table;
    return this;
  },
  where(_pred: unknown) {
    void _pred;
    return this;
  },
  async limit(n: number): Promise<Row[]> {
    void n;
    if (capturedIdentityName === null) return [];
    const row = rows.get(capturedIdentityName);
    capturedIdentityName = null;
    return row ? [row] : [];
  },
};

// The insert chain: db.insert(table).values(v).onConflictDoUpdate({target, set})
// The await point is onConflictDoUpdate. We stash the values() args on the
// chain so onConflictDoUpdate can commit them.
type PendingInsert = { identityName: string; lastSendAt: number };
let pendingInsert: PendingInsert | null = null;

const insertChain = {
  values(v: PendingInsert) {
    pendingInsert = v;
    return this;
  },
  async onConflictDoUpdate(opts: {
    target: unknown;
    set: { lastSendAt: number; updatedAt: unknown };
  }): Promise<void> {
    void opts;
    if (!pendingInsert) return;
    const existing = rows.get(pendingInsert.identityName);
    if (existing) {
      // ON CONFLICT DO UPDATE — set the new lastSendAt from opts.set
      existing.lastSendAt = opts.set.lastSendAt;
    } else {
      rows.set(pendingInsert.identityName, {
        identityName: pendingInsert.identityName,
        lastSendAt: pendingInsert.lastSendAt,
      });
    }
    pendingInsert = null;
  },
};

const mockDb = {
  select(_fields?: unknown) {
    void _fields;
    return selectChain;
  },
  insert(_table: unknown) {
    void _table;
    return insertChain;
  },
};

// vi.mock factories are hoisted — must not close over test-scope state
// directly. Use a getter that resolves at import time (after the module
// body finishes executing).
vi.mock("../database/db/index.js", () => ({
  get db() {
    return mockDb;
  },
}));

vi.mock("../database/db/schema.js", () => ({
  identitySendLog: {
    identityName: { name: "identity_name" },
    lastSendAt: { name: "last_send_at" },
    updatedAt: { name: "updated_at" },
  },
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      capturedIdentityName = typeof val === "string" ? val : null;
      return { _col, val };
    },
    // sql template tag — return a token; the mock DB ignores its value.
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _tag: "sql",
        raw: strings.join("?"),
        values,
      }),
      actual.sql,
    ),
  };
});

vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: vi.fn(async () => {}),
  },
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test + the DatabaseSaveTrigger spy AFTER mocks
// ---------------------------------------------------------------------------

import {
  stampIdentityLastSend,
  getIdentityLastSend,
} from "./identity-send-log-store.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  rows.clear();
  capturedIdentityName = null;
  pendingInsert = null;
  forceSaveSpy.mockClear();
  forceSaveSpy.mockImplementation(async () => {});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stampIdentityLastSend — write path", () => {
  it("Test 1 — insert path (no existing row) writes row and calls forceSave once", async () => {
    await stampIdentityLastSend("ivy", 1000);

    // Row exists via belt-and-suspenders raw check
    const raw = rows.get("ivy");
    expect(raw).toBeDefined();
    expect(raw?.lastSendAt).toBe(1000);

    // Round-trip via the module's read path
    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(1000);

    // forceSave called exactly once with Phase-79 reason
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledWith("phase-85-stamp-identity-send");
  });

  it("Test 2 — update path (newer ts) advances row and calls forceSave again", async () => {
    // Seed via first stamp
    await stampIdentityLastSend("ivy", 1000);
    forceSaveSpy.mockClear();

    // Second stamp with newer ts
    await stampIdentityLastSend("ivy", 2000);

    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(2000);

    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledWith("phase-85-stamp-identity-send");
  });

  it("Test 3 — monotonic skip (older ts) leaves row unchanged and does NOT call forceSave", async () => {
    // Seed
    await stampIdentityLastSend("ivy", 2000);
    forceSaveSpy.mockClear();

    // Attempt older stamp
    await stampIdentityLastSend("ivy", 1500);

    // Row still at 2000
    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(2000);

    // No write happened → no flush
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });

  it("Test 4 — monotonic skip (equal ts) leaves row unchanged and does NOT call forceSave", async () => {
    await stampIdentityLastSend("ivy", 2000);
    forceSaveSpy.mockClear();

    // Attempt equal stamp
    await stampIdentityLastSend("ivy", 2000);

    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(2000);

    expect(forceSaveSpy).not.toHaveBeenCalled();
  });
});

describe("getIdentityLastSend — read path", () => {
  it("Test 5 — round-trip returns the latest written ts", async () => {
    await stampIdentityLastSend("ivy", 1000);
    await stampIdentityLastSend("ivy", 2000);

    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(2000);
  });

  it("Test 6 — unknown identity returns null (no throw)", async () => {
    // No writes at all
    const result = await getIdentityLastSend("nonexistent");
    expect(result).toBeNull();
  });
});

describe("stampIdentityLastSend — validation-skip path", () => {
  it("Test 7 — empty identity name skips write and forceSave", async () => {
    await stampIdentityLastSend("", 1000);

    expect(rows.size).toBe(0);
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });

  it("Test 8 — NaN ts skips write and forceSave", async () => {
    await stampIdentityLastSend("ivy", NaN);

    expect(rows.size).toBe(0);
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });
});

describe("stampIdentityLastSend — persistence-flush failure", () => {
  it("Test 9 — forceSave throw is caught, write completes, function does not propagate", async () => {
    forceSaveSpy.mockRejectedValueOnce(new Error("save failed"));

    // Must not throw
    await expect(stampIdentityLastSend("ivy", 3000)).resolves.toBeUndefined();

    // Write still landed
    const readBack = await getIdentityLastSend("ivy");
    expect(readBack).toBe(3000);

    // forceSave was still attempted exactly once
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledWith("phase-85-stamp-identity-send");
  });
});

describe("stampIdentityLastSend — multi-identity isolation", () => {
  it("Test 10 — distinct identity names get distinct rows (no cross-contamination)", async () => {
    await stampIdentityLastSend("ivy", 2000);
    await stampIdentityLastSend("lulabelle", 500);

    expect(rows.size).toBe(2);

    const ivyTs = await getIdentityLastSend("ivy");
    const lulaTs = await getIdentityLastSend("lulabelle");

    expect(ivyTs).toBe(2000);
    expect(lulaTs).toBe(500);

    // Belt-and-suspenders raw check
    expect(rows.get("ivy")?.lastSendAt).toBe(2000);
    expect(rows.get("lulabelle")?.lastSendAt).toBe(500);
  });
});
