/**
 * Phase 15 Plan 1: /user-preferences GET + PUT tests for pinnedConversationIds.
 *
 * Tests exercise handleGetPreferences / handlePutPreferences at the function
 * level (no Express harness, no auth middleware) — matching the debug.test.ts
 * pattern (patch #146). The auth gate is verified by construction: the route
 * wires authenticateJWT before the handler, same as debug.ts / compose-drafts.ts.
 *
 * Storage layer isolation: mocks ../db/index.js with a hand-rolled in-memory
 * Map<userId, Row> so the handlers exercise real Drizzle-chain semantics without
 * booting SQLite. The 3 chains the handlers use are:
 *   - db.select().from(userPreferences).where(eq(...)).all()
 *   - db.insert(userPreferences).values(...).run()
 *   - db.update(userPreferences).set(...).where(eq(...)).run()
 *
 * Test coverage (10 pin-specific + 3 regression per plan-checker Warning #3):
 *   PIN 1-3  : GET returns [] on missing row / NULL / valid JSON
 *   PIN 4    : PUT persists JSON.stringify'd form to DB column
 *   PIN 5    : PUT response body echoes pinnedConversationIds as PARSED ARRAY
 *              (Wave 2's optimistic reconciliation depends on this — distinct test)
 *   PIN 6    : PUT with [] persists "[]" (unpin-all)
 *   PIN 7-9  : PUT input validation (non-array / non-string element / > 1000)
 *   PIN 10   : PUT-then-GET round trip
 *   REG 1-3  : reopenTabsOnLogin non-boolean 400 / theme non-string 400 /
 *              empty updates 400 still work after the extension
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// In-memory Drizzle-shape mock db
// ---------------------------------------------------------------------------

type Row = {
  userId: string;
  reopenTabsOnLogin: boolean;
  theme: string | null;
  fontSize: string | null;
  accentColor: string | null;
  language: string | null;
  pinnedConversationIds: string | null;
  hiddenConversationIds: string | null;
  updatedAt: string;
};

const rows = new Map<string, Row>();

// Track a target userId per pending .where() chain — the eq() predicate is
// captured then applied at .all() / .run() time.
let pendingWhereUserId: string | null = null;

const selectChain = {
  from(_table: unknown) {
    void _table;
    return this;
  },
  where(_predicate: unknown) {
    void _predicate; // predicate is the eq() call; we grabbed userId via eq mock
    return this;
  },
  all(): Row[] {
    const userId = pendingWhereUserId;
    pendingWhereUserId = null;
    if (userId == null) return [];
    const row = rows.get(userId);
    return row ? [row] : [];
  },
};

const insertChain = {
  values(v: Partial<Row> & { userId: string }) {
    return {
      run() {
        const existing = rows.get(v.userId);
        const next: Row = {
          userId: v.userId,
          reopenTabsOnLogin: v.reopenTabsOnLogin ?? existing?.reopenTabsOnLogin ?? false,
          theme: v.theme ?? existing?.theme ?? null,
          fontSize: v.fontSize ?? existing?.fontSize ?? null,
          accentColor: v.accentColor ?? existing?.accentColor ?? null,
          language: v.language ?? existing?.language ?? null,
          pinnedConversationIds:
            v.pinnedConversationIds ?? existing?.pinnedConversationIds ?? null,
          hiddenConversationIds:
            v.hiddenConversationIds ?? existing?.hiddenConversationIds ?? null,
          updatedAt: v.updatedAt ?? new Date().toISOString(),
        };
        rows.set(v.userId, next);
      },
    };
  },
};

const updateChain = {
  set(patch: Partial<Row>) {
    return {
      where(_predicate: unknown) {
        void _predicate;
        return {
          run() {
            const userId = pendingWhereUserId;
            pendingWhereUserId = null;
            if (userId == null) return;
            const existing = rows.get(userId);
            if (!existing) return;
            rows.set(userId, { ...existing, ...patch });
          },
        };
      },
    };
  },
};

const mockDb = {
  select() {
    return selectChain;
  },
  insert(_table: unknown) {
    void _table;
    return insertChain;
  },
  update(_table: unknown) {
    void _table;
    return updateChain;
  },
};

// vi.mock() calls are hoisted above local const declarations by vitest — the
// factory must not close over module-scoped variables directly. We defer the
// reference by grabbing the value via a getter that runs at import time (after
// the file body has executed).
vi.mock("../db/index.js", () => ({
  get db() {
    return mockDb;
  },
  // handlePutPreferences calls DatabaseSaveTrigger.forceSave after every write
  // to defeat the in-memory-DB deploy-loss trap (see the handler for context).
  // Stub as a no-op so tests exercise the write path without booting the real
  // save trigger (which needs an initialized saveFunction and would warn-spam).
  DatabaseSaveTrigger: {
    forceSave: vi.fn(async () => {}),
  },
}));

// eq() is only used to smuggle the userId to the pending where clause.
// We intercept the drizzle-orm eq() call and stash the userId argument.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      pendingWhereUserId = typeof val === "string" ? val : null;
      return { _col, val };
    },
  };
});

// AuthManager singleton init is 5s+ per debug.test.ts note — stub it so the
// route module loads instantly without side effects.
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
        next(),
    }),
  },
}));

// databaseLogger.error is called on 500 branches; stub so tests do not
// pollute the console.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Express Request/Response mocks (debug.test.ts shape)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Import the handlers under test AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  handleGetPreferences,
  handlePutPreferences,
} from "./user-preferences.js";
import { DatabaseSaveTrigger } from "../db/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-1";

beforeEach(() => {
  rows.clear();
  pendingWhereUserId = null;
  (DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>).mockClear();
});

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------

describe("handleGetPreferences: pinnedConversationIds branches", () => {
  it("Test 1 — GET returns pinnedConversationIds: [] when no row exists for user", () => {
    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { pinnedConversationIds: string[] };
    expect(body.pinnedConversationIds).toEqual([]);
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
  });

  it("Test 2 — GET returns pinnedConversationIds: [] when column is NULL", () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { pinnedConversationIds: string[] };
    expect(body.pinnedConversationIds).toEqual([]);
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
  });

  it("Test 3 — GET returns the parsed array when column has valid JSON string", () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["id1", "id2", "id3"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { pinnedConversationIds: string[] };
    expect(body.pinnedConversationIds).toEqual(["id1", "id2", "id3"]);
  });
});

// ---------------------------------------------------------------------------
// Tests — PUT
// ---------------------------------------------------------------------------

describe("handlePutPreferences: pinnedConversationIds branches", () => {
  it("Test 4 — PUT with valid string[] persists the JSON.stringify'd form to the DB column", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["a", "b"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Distinct assertion: the raw column value in the mock db is the JSON string form
    const row = rows.get(USER_ID);
    expect(row).toBeDefined();
    expect(row!.pinnedConversationIds).toBe('["a","b"]');
    expect(typeof row!.pinnedConversationIds).toBe("string");
  });

  it("Test 5 — PUT response body includes pinnedConversationIds as a parsed array (PIN-08 JSON-echo — Wave 2 depends on this)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["x", "y", "z"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const body = res._body as { pinnedConversationIds: unknown };
    // Load-bearing assertion 1: response value is an actual array, not a JSON string
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
    // Load-bearing assertion 2: deep-equals the array we PUT
    expect(body.pinnedConversationIds).toEqual(["x", "y", "z"]);
  });

  it("Test 6 — PUT with empty array [] persists (unpin-all is legal, response echoes [])", async () => {
    // Seed with existing pins so the empty PUT is a real state change
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["old-a", "old-b"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: [] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Persisted as "[]" (not "null", not undefined — unpin-all is a real state)
    expect(rows.get(USER_ID)!.pinnedConversationIds).toBe("[]");
    // Response echoes the parsed array shape
    const body = res._body as { pinnedConversationIds: unknown };
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
    expect(body.pinnedConversationIds).toEqual([]);
  });

  it("Test 7 — PUT with non-array returns 400 with specific error message + DB row unchanged", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["seed"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: "not-an-array" },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds must be an array of strings",
    });
    // Row unchanged
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("Test 8 — PUT with non-string element returns 400 + DB row unchanged", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["seed"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["a", 42] },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds must be an array of strings",
    });
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("Test 9 — PUT with length > 1000 returns 400 + DB row unchanged (DoS mitigation)", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["seed"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const huge = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: huge },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds exceeds max length of 1000",
    });
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("Test 10 — PUT round-trip: after PUT with ['x','y'], GET returns ['x','y']", async () => {
    const putRes = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["x", "y"] },
      putRes as unknown as Response,
    );
    expect(putRes._status).toBe(200);

    const getRes = makeRes();
    handleGetPreferences(USER_ID, getRes as unknown as Response);

    expect(getRes._status).toBe(200);
    const body = getRes._body as { pinnedConversationIds: string[] };
    expect(body.pinnedConversationIds).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// Regression tests — pre-existing 400 branches (per plan-checker Warning #3)
// ---------------------------------------------------------------------------

describe("handlePutPreferences: pre-existing 400 branches still work", () => {
  it("REG 1 — PUT with non-boolean reopenTabsOnLogin returns 400", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { reopenTabsOnLogin: "not-a-bool" },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "reopenTabsOnLogin must be a boolean",
    });
  });

  it("REG 2 — PUT with non-string theme returns 400", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { theme: 42 },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "theme must be a string",
    });
  });

  it("REG 3 — PUT with empty body returns 400 (no preferences provided)", async () => {
    const res = makeRes();
    await handlePutPreferences(USER_ID, {}, res as unknown as Response);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "No preferences provided",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — GET hiddenConversationIds (HIDE 1-3, mirrors PIN 1-3)
// ---------------------------------------------------------------------------

describe("handleGetPreferences: hiddenConversationIds branches", () => {
  it("HIDE 1 — GET returns hiddenConversationIds: [] when no row exists for user", () => {
    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { hiddenConversationIds: string[] };
    expect(body.hiddenConversationIds).toEqual([]);
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
  });

  it("HIDE 2 — GET returns hiddenConversationIds: [] when column is NULL", () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: null,
      updatedAt: "2026-07-31T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { hiddenConversationIds: string[] };
    expect(body.hiddenConversationIds).toEqual([]);
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
  });

  it("HIDE 3 — GET returns the parsed array when column has valid JSON string", () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["h1", "h2", "h3"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { hiddenConversationIds: string[] };
    expect(body.hiddenConversationIds).toEqual(["h1", "h2", "h3"]);
  });
});

// ---------------------------------------------------------------------------
// Tests — PUT hiddenConversationIds (HIDE 4-10, mirrors PIN 4-10)
// ---------------------------------------------------------------------------

describe("handlePutPreferences: hiddenConversationIds branches", () => {
  it("HIDE 4 — PUT with valid string[] persists the JSON.stringify'd form to the DB column", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["a", "b"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const row = rows.get(USER_ID);
    expect(row).toBeDefined();
    expect(row!.hiddenConversationIds).toBe('["a","b"]');
    expect(typeof row!.hiddenConversationIds).toBe("string");
  });

  it("HIDE 5 — PUT response body includes hiddenConversationIds as a parsed array", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["x", "y", "z"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const body = res._body as { hiddenConversationIds: unknown };
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
    expect(body.hiddenConversationIds).toEqual(["x", "y", "z"]);
  });

  it("HIDE 6 — PUT with empty array [] persists (unhide-all is legal, response echoes [])", async () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["old-h1", "old-h2"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: [] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(rows.get(USER_ID)!.hiddenConversationIds).toBe("[]");
    const body = res._body as { hiddenConversationIds: unknown };
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
    expect(body.hiddenConversationIds).toEqual([]);
  });

  it("HIDE 7 — PUT with non-array returns 400 with specific error message + DB row unchanged", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["seed"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: "not-an-array" },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds must be an array of strings",
    });
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("HIDE 8 — PUT with non-string element returns 400 + DB row unchanged", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["seed"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["a", 99] },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds must be an array of strings",
    });
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("HIDE 9 — PUT with length > 1000 returns 400 + DB row unchanged (DoS mitigation)", async () => {
    const seed = {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["seed"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    rows.set(USER_ID, seed);

    const huge = Array.from({ length: 1001 }, (_, i) => `hide-id-${i}`);
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: huge },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds exceeds max length of 1000",
    });
    expect(rows.get(USER_ID)).toEqual(seed);
  });

  it("HIDE 10 — PUT round-trip: after PUT with ['h1','h2'], GET returns ['h1','h2']", async () => {
    const putRes = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["h1", "h2"] },
      putRes as unknown as Response,
    );
    expect(putRes._status).toBe(200);

    const getRes = makeRes();
    handleGetPreferences(USER_ID, getRes as unknown as Response);

    expect(getRes._status).toBe(200);
    const body = getRes._body as { hiddenConversationIds: string[] };
    expect(body.hiddenConversationIds).toEqual(["h1", "h2"]);
  });
});

// ---------------------------------------------------------------------------
// Cross-field test: PUT with BOTH pinnedConversationIds AND hiddenConversationIds
// Load-bearing: protects against copy-paste refactor that accidentally couples the two fields.
// ---------------------------------------------------------------------------

describe("handlePutPreferences: cross-field (pinnedConversationIds + hiddenConversationIds)", () => {
  it("HIDE-X — PUT with BOTH fields persists both, response echoes both as parsed arrays", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["pin-a", "pin-b"],
        hiddenConversationIds: ["hide-x", "hide-y"],
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);

    // Both raw column values are JSON strings
    const row = rows.get(USER_ID);
    expect(row).toBeDefined();
    expect(row!.pinnedConversationIds).toBe('["pin-a","pin-b"]');
    expect(row!.hiddenConversationIds).toBe('["hide-x","hide-y"]');

    // Both response body fields are parsed arrays (NOT raw JSON strings)
    const body = res._body as {
      pinnedConversationIds: unknown;
      hiddenConversationIds: unknown;
    };
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
    expect(body.pinnedConversationIds).toEqual(["pin-a", "pin-b"]);
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
    expect(body.hiddenConversationIds).toEqual(["hide-x", "hide-y"]);
  });
});

// ---------------------------------------------------------------------------
// SAVE 1-4 — DatabaseSaveTrigger.forceSave is called on every successful
// write and NOT on validation-rejected 400 branches. Regression gate for the
// pins-lost-on-deploy fix (the whole point of introducing the call): if a
// future refactor drops the forceSave, direct db.insert/update writes go back
// to RAM-only and pins/hides silently vanish on the next deploy race.
// ---------------------------------------------------------------------------

describe("handlePutPreferences: DatabaseSaveTrigger.forceSave call sites", () => {
  it("SAVE 1 — insert branch (no row exists) triggers forceSave with the 'user_preferences_updated' reason", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["a"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "user_preferences_updated",
    );
  });

  it("SAVE 2 — update branch (row exists) also triggers forceSave", async () => {
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["existing"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["new"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
  });

  it("SAVE 3 — 400 validation branches do NOT trigger forceSave (no write happened)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: "not-an-array" },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(DatabaseSaveTrigger.forceSave).not.toHaveBeenCalled();
  });

  it("SAVE 4 — forceSave failure is caught, response still returns 200 (in-memory row is worse UX than a slow response, but a 500 is worse still)", async () => {
    (DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk-full-simulation"),
    );

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["a"] },
      res as unknown as Response,
    );

    // Response still succeeds — the write reached RAM and the client gets its
    // echo. The lost-durability event is logged via databaseLogger.warn.
    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
  });
});
