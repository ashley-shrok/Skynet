/**
 * Bounty message-queue-in-pretty-view: backend tests for compose-drafts
 * queueSlots extension.
 *
 * Tests the exported handler functions handleGetDraft / handlePutDraft
 * and the validation/parsing helpers directly, using an in-memory map
 * to simulate the SQLite storage layer.
 *
 * Pattern mirrors user-preferences.test.ts: mock ../db/index.js so the
 * handlers exercise logic without booting SQLite.
 *
 * Test coverage:
 *   BQ 1: GET (no existing row) → { body: "", queueSlots: [] }
 *   BQ 2: GET after PUT with queueSlots array → populated queueSlots returned
 *   BQ 3: PUT with valid queueSlots persists; GET reflects the array
 *   BQ 4: PUT with queueSlots NOT an array → 400
 *   BQ 5: PUT with queueSlots item missing id → 400
 *   BQ 6: PUT with queueSlots item missing text → 400
 *   BQ 7: PUT with queueSlots item having non-string id → 400
 *   BQ 8: PUT with queueSlots item having non-string text → 400
 *   BQ 9: GET when queue_slots has corrupt JSON → queueSlots: [] (defensive parse)
 *   BQ 10: body-only PUT (queueSlots = undefined) preserves pre-existing queueSlots
 *   BQ 11: PUT with empty queueSlots array [] is valid (204)
 *   PARSE 1-3: parseQueueSlotsFromStorage edge cases
 *   VALIDATE 1-4: validateQueueSlotsFromRequest edge cases
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Response } from "express";

// ---------------------------------------------------------------------------
// In-memory storage: simulate compose_drafts table rows
// ---------------------------------------------------------------------------

type Row = {
  userId: string;
  hostId: number;
  tmuxSession: string;
  body: string;
  queueSlots: string;
  updatedAt: string;
};

const rows = new Map<string, Row>();

function rowKey(userId: string, hostId: number, tmuxSession: string): string {
  return `${userId}:${hostId}:${tmuxSession}`;
}

// Capture parameters from eq() calls so the .where().get() chain can look up rows.
// The handlers call: eq(composeDrafts.userId, userId), eq(composeDrafts.hostId, hostId),
// eq(composeDrafts.tmuxSession, storageTmuxSession) — we need to stash all three.
let capturedUserId: string | null = null;
let capturedHostId: number | null = null;
let capturedTmuxSession: string | null = null;
let eqCallCount = 0;

// ---------------------------------------------------------------------------
// Mock db — simulates drizzle chains used by handleGetDraft / handlePutDraft
// ---------------------------------------------------------------------------

const mockDb = {
  select(_fields?: unknown) {
    return {
      from(_table: unknown) {
        return {
          where(_pred: unknown) {
            return {
              get(): Row | undefined {
                if (capturedUserId === null || capturedHostId === null || capturedTmuxSession === null) {
                  return undefined;
                }
                const key = rowKey(capturedUserId, capturedHostId, capturedTmuxSession);
                const row = rows.get(key);
                capturedUserId = null;
                capturedHostId = null;
                capturedTmuxSession = null;
                eqCallCount = 0;
                return row;
              },
            };
          },
        };
      },
    };
  },
  run(sqlStatement: { params?: unknown[] }) {
    // Simulate db.run(sql`INSERT ... VALUES (userId, hostId, tmuxSession, body, queueSlots, ...) ON CONFLICT DO UPDATE ...`)
    // The params array from our sql template mock is: [userId, hostId, tmuxSession, body, queueSlotsJson]
    // for the WITH queueSlots branch.
    // For the body-only branch: [userId, hostId, tmuxSession, body, '[]']
    const params = sqlStatement.params ?? [];
    if (params.length < 4) return { changes: 0 };

    const [userId, hostId, tmuxSession, body] = params as [string, number, string, string];
    const key = rowKey(userId as string, hostId as number, tmuxSession as string);
    const existing = rows.get(key);

    // Determine if this is a with-queueSlots or body-only upsert.
    // We detect this by checking if params[4] is a JSON string of slots
    // (the with-slots branch) vs '[]' as the default from body-only branch.
    // The actual SQL string distinguishes the two, but since we can't parse
    // the actual SQL in the mock, we instead use a flag set by handlePutDraft.
    // NOTE: We rely on the `_isQueueSlotsUpsert` property injected into the
    // sql statement object by our mock of the sql tag.
    const isQueueSlotsUpsert = (sqlStatement as { _isQueueSlotsUpsert?: boolean })._isQueueSlotsUpsert ?? false;

    if (isQueueSlotsUpsert) {
      const queueSlotsJson = params[4] as string;
      rows.set(key, {
        userId: userId as string,
        hostId: hostId as number,
        tmuxSession: tmuxSession as string,
        body: body as string,
        queueSlots: queueSlotsJson,
        updatedAt: new Date().toISOString(),
      });
    } else {
      // body-only: preserve existing queueSlots if row exists
      rows.set(key, {
        userId: userId as string,
        hostId: hostId as number,
        tmuxSession: tmuxSession as string,
        body: body as string,
        queueSlots: existing?.queueSlots ?? "[]",
        updatedAt: new Date().toISOString(),
      });
    }
    return { changes: 1 };
  },
};

vi.mock("../db/index.js", () => ({
  get db() {
    return mockDb;
  },
}));

// Mock drizzle-orm: eq() captures values; and() is a no-op; sql tag returns
// an object our db.run mock can inspect.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      eqCallCount++;
      // Heuristic: 1st eq = userId (string), 2nd eq = hostId (number), 3rd eq = tmuxSession (string)
      if (eqCallCount === 1) capturedUserId = val as string;
      else if (eqCallCount === 2) capturedHostId = val as number;
      else if (eqCallCount === 3) capturedTmuxSession = val as string;
      return { _col, val };
    },
    and: (...args: unknown[]) => ({ _args: args }),
    // sql template tag: return an object with params extracted from the template values
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Detect if this SQL contains queue_slots in the SET clause
        // (the with-queueSlots upsert branch includes "queue_slots = excluded.queue_slots")
        const rawSql = strings.join("?");
        const isQueueSlotsUpsert = rawSql.includes("queue_slots = excluded.queue_slots");
        return {
          sql: rawSql,
          params: values,
          _isQueueSlotsUpsert: isQueueSlotsUpsert,
          _: "sql" as const,
        };
      },
      // Preserve any static properties from the actual sql tag
      actual.sql,
    ),
  };
});

vi.mock("../db/schema.js", () => ({
  composeDrafts: {
    body: { name: "body" },
    queueSlots: { name: "queue_slots" },
    userId: { name: "user_id" },
    hostId: { name: "host_id" },
    tmuxSession: { name: "tmux_session" },
  },
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    }),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import handlers and helpers AFTER mocks
// ---------------------------------------------------------------------------

import {
  handleGetDraft,
  handlePutDraft,
  parseQueueSlotsFromStorage,
  validateQueueSlotsFromRequest,
} from "./compose-drafts.js";

// ---------------------------------------------------------------------------
// Express Response mock (debug.test.ts shape)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: () => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "test-user-1";
const HOST_ID = 42;
const TMUX_SESSION = "main";

beforeEach(() => {
  rows.clear();
  capturedUserId = null;
  capturedHostId = null;
  capturedTmuxSession = null;
  eqCallCount = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: prepare the eq capture state so .get() returns the correct row
// ---------------------------------------------------------------------------

function prepareSelect(userId: string, hostId: number, tmuxSession: string) {
  capturedUserId = userId;
  capturedHostId = hostId;
  capturedTmuxSession = tmuxSession;
  eqCallCount = 3; // mark as already captured so next eq() calls start fresh
}

// ---------------------------------------------------------------------------
// Helper: seed a row directly
// ---------------------------------------------------------------------------

function seedRow(body: string, queueSlots: string, tmuxSession = TMUX_SESSION) {
  const key = rowKey(USER_ID, HOST_ID, tmuxSession);
  rows.set(key, {
    userId: USER_ID,
    hostId: HOST_ID,
    tmuxSession,
    body,
    queueSlots,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe("handleGetDraft: queueSlots", () => {
  it("BQ 1 — GET (no existing row) returns { body: '', queueSlots: [] }", () => {
    // No row seeded — capturedUserId etc will be set by eq() calls in the handler
    eqCallCount = 0;
    const res = makeRes();
    handleGetDraft(USER_ID, HOST_ID, TMUX_SESSION, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { body: string; queueSlots: unknown[] };
    expect(body.body).toBe("");
    expect(body.queueSlots).toEqual([]);
    expect(Array.isArray(body.queueSlots)).toBe(true);
  });

  it("BQ 2 — GET with seeded row returns parsed queueSlots", () => {
    const slots = [{ id: "a", text: "hi" }, { id: "b", text: "bye" }];
    seedRow("some body", JSON.stringify(slots));
    eqCallCount = 0;

    const res = makeRes();
    handleGetDraft(USER_ID, HOST_ID, TMUX_SESSION, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { body: string; queueSlots: unknown[] };
    expect(body.body).toBe("some body");
    expect(body.queueSlots).toEqual(slots);
  });

  it("BQ 9 — GET when queue_slots has corrupt JSON returns queueSlots: []", () => {
    seedRow("body text", "NOT VALID JSON {{{{");
    eqCallCount = 0;

    const res = makeRes();
    handleGetDraft(USER_ID, HOST_ID, TMUX_SESSION, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as { body: string; queueSlots: unknown[] };
    expect(body.queueSlots).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUT tests (validation via handlePutDraft with pre-validated queueSlots)
// ---------------------------------------------------------------------------

describe("handlePutDraft: queueSlots", () => {
  it("BQ 3 — PUT with valid queueSlots persists; GET reflects the array", () => {
    const slots = [{ id: "x", text: "hello" }];
    const putRes = makeRes();
    handlePutDraft(USER_ID, HOST_ID, TMUX_SESSION, "my body", slots, putRes as unknown as Response);

    expect(putRes._status).toBe(204);
    expect(putRes._ended).toBe(true);

    // GET to verify persistence
    eqCallCount = 0;
    const getRes = makeRes();
    handleGetDraft(USER_ID, HOST_ID, TMUX_SESSION, getRes as unknown as Response);

    const body = getRes._body as { body: string; queueSlots: unknown[] };
    expect(body.queueSlots).toEqual(slots);
    expect(body.body).toBe("my body");
  });

  it("BQ 10 — body-only PUT (queueSlots = undefined) preserves pre-existing queueSlots", () => {
    const existingSlots = [{ id: "existing", text: "keep me" }];
    seedRow("old body", JSON.stringify(existingSlots));

    const putRes = makeRes();
    handlePutDraft(USER_ID, HOST_ID, TMUX_SESSION, "new body", undefined, putRes as unknown as Response);

    expect(putRes._status).toBe(204);

    // GET should return updated body but preserved queueSlots
    eqCallCount = 0;
    const getRes = makeRes();
    handleGetDraft(USER_ID, HOST_ID, TMUX_SESSION, getRes as unknown as Response);

    const body = getRes._body as { body: string; queueSlots: unknown[] };
    expect(body.body).toBe("new body");
    expect(body.queueSlots).toEqual(existingSlots);
  });

  it("BQ 11 — PUT with empty queueSlots array [] is valid (204)", () => {
    const res = makeRes();
    handlePutDraft(USER_ID, HOST_ID, TMUX_SESSION, "body", [], res as unknown as Response);

    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation helper tests (validateQueueSlotsFromRequest)
// ---------------------------------------------------------------------------

describe("validateQueueSlotsFromRequest", () => {
  it("BQ 4 — non-array input → { ok: false, error: 'invalid queueSlots shape' }", () => {
    const result = validateQueueSlotsFromRequest("not-an-array");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid queueSlots shape");
  });

  it("BQ 5 — item missing id → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest([{ text: "hello" }]);
    expect(result.ok).toBe(false);
  });

  it("BQ 6 — item missing text → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest([{ id: "x" }]);
    expect(result.ok).toBe(false);
  });

  it("BQ 7 — item with non-string id → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest([{ id: 42, text: "hello" }]);
    expect(result.ok).toBe(false);
  });

  it("BQ 8 — item with non-string text → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest([{ id: "x", text: 99 }]);
    expect(result.ok).toBe(false);
  });

  it("VALIDATE 1 — valid array → { ok: true, value: [...] }", () => {
    const slots = [{ id: "a", text: "hi" }, { id: "b", text: "bye" }];
    const result = validateQueueSlotsFromRequest(slots);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(slots);
  });

  it("VALIDATE 2 — empty array [] is valid", () => {
    const result = validateQueueSlotsFromRequest([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("VALIDATE 3 — null input → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest(null);
    expect(result.ok).toBe(false);
  });

  it("VALIDATE 4 — number input → { ok: false }", () => {
    const result = validateQueueSlotsFromRequest(42);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parsing helper tests (parseQueueSlotsFromStorage)
// ---------------------------------------------------------------------------

describe("parseQueueSlotsFromStorage", () => {
  it("PARSE 1 — null/undefined/empty string returns []", () => {
    expect(parseQueueSlotsFromStorage(null)).toEqual([]);
    expect(parseQueueSlotsFromStorage(undefined)).toEqual([]);
    expect(parseQueueSlotsFromStorage("")).toEqual([]);
  });

  it("PARSE 2 — valid JSON array of {id,text} objects parsed correctly", () => {
    const slots = [{ id: "a", text: "hello" }];
    expect(parseQueueSlotsFromStorage(JSON.stringify(slots))).toEqual(slots);
  });

  it("PARSE 3 — invalid JSON returns [] without throwing", () => {
    expect(parseQueueSlotsFromStorage("{{{invalid}}}")).toEqual([]);
  });

  it("PARSE 4 — JSON that is not an array returns []", () => {
    expect(parseQueueSlotsFromStorage('{"id":"x","text":"y"}')).toEqual([]);
  });

  it("PARSE 5 — array items with missing/wrong-type fields returns []", () => {
    expect(parseQueueSlotsFromStorage('[{"id":42,"text":"hi"}]')).toEqual([]);
    expect(parseQueueSlotsFromStorage('[{"text":"hi"}]')).toEqual([]);
  });
});
