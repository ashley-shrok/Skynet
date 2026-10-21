import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Response } from "express";

// In-memory user_preferences rows — only the fields the route touches.
type Row = { userId: string; whatsNewSeen: string | null; updatedAt: string };
const rows = new Map<string, Row>();
let pendingUserId: string | null = null;

const mockDb = {
  select() {
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      all(): Row[] {
        const id = pendingUserId;
        pendingUserId = null;
        const row = id == null ? undefined : rows.get(id);
        return row ? [row] : [];
      },
    };
  },
  insert() {
    return {
      values(v: Row) {
        return {
          run() {
            rows.set(v.userId, { ...v });
          },
        };
      },
    };
  },
  update() {
    return {
      set(patch: Partial<Row>) {
        return {
          where() {
            return {
              run() {
                const id = pendingUserId;
                pendingUserId = null;
                const existing = id == null ? undefined : rows.get(id);
                if (existing) rows.set(existing.userId, { ...existing, ...patch });
              },
            };
          },
        };
      },
    };
  },
};

const forceSave = vi.fn(async () => {});
vi.mock("../db/index.js", () => ({
  get db() {
    return mockDb;
  },
  DatabaseSaveTrigger: {
    get forceSave() {
      return forceSave;
    },
  },
}));
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      pendingUserId = typeof val === "string" ? val : null;
      return { _col, val };
    },
  };
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    }),
  },
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { handleGetWhatsNew, handleMarkWhatsNewSeen } from "./whats-new.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as typeof res & Response;
}

const n = (id: string) => ({ id, text: `Text for ${id}.` });

async function get(userId: string, notes: { id: string; text: string }[]) {
  const res = mockRes();
  await handleGetWhatsNew(userId, res, notes);
  return (res.body as { notes: { id: string; text: string }[] }).notes.map((x) => x.id);
}

async function seen(userId: string, ids: unknown, notes: { id: string; text: string }[]) {
  const res = mockRes();
  await handleMarkWhatsNewSeen(userId, { ids }, res, notes);
  return res.statusCode;
}

beforeEach(() => {
  rows.clear();
  forceSave.mockClear();
});

describe("what's new across updates (one person, several builds)", () => {
  it("first rollout shows nothing; later notes show once, newest first; missed updates all show", async () => {
    // Existing user with a preferences row but no what's-new record.
    rows.set("u1", { userId: "u1", whatsNewSeen: null, updatedAt: "x" });

    // Build 1: the feature arrives with no notes → nothing, but counted.
    expect(await get("u1", [])).toEqual([]);
    expect(rows.get("u1")!.whatsNewSeen).toBe("[]");
    expect(forceSave).toHaveBeenCalledWith("whats_new_counted");

    // Build 2: one note → shown.
    const b2 = [n("a")];
    expect(await get("u1", b2)).toEqual(["a"]);
    // Reloading again before closing still shows it.
    expect(await get("u1", b2)).toEqual(["a"]);
    expect(await seen("u1", ["a"], b2)).toBe(204);
    expect(await get("u1", b2)).toEqual([]);

    // Builds 3 and 4 shipped while they were away → both notes, newest first.
    const b4 = [n("a"), n("b"), n("c")];
    expect(await get("u1", b4)).toEqual(["c", "b"]);
    expect(await seen("u1", ["c", "b"], b4)).toBe(204);

    // Build 5 with no new notes → nothing.
    expect(await get("u1", b4)).toEqual([]);
  });

  it("a new account with no preferences row sees no history", async () => {
    expect(await get("new", [n("a"), n("b")])).toEqual([]);
    expect(JSON.parse(rows.get("new")!.whatsNewSeen!)).toEqual(["a", "b"]);
    expect(await get("new", [n("a"), n("b"), n("c")])).toEqual(["c"]);
  });

  it("seen on one device means not shown on another (record is per account)", async () => {
    rows.set("u2", { userId: "u2", whatsNewSeen: "[]", updatedAt: "x" });
    const notes = [n("a")];
    expect(await get("u2", notes)).toEqual(["a"]); // phone
    expect(await get("u2", notes)).toEqual(["a"]); // desktop, before phone closes
    await seen("u2", ["a"], notes); // phone closes
    expect(await get("u2", notes)).toEqual([]); // desktop reloads
  });

  it("people are tracked separately", async () => {
    rows.set("x", { userId: "x", whatsNewSeen: "[]", updatedAt: "x" });
    rows.set("y", { userId: "y", whatsNewSeen: "[]", updatedAt: "x" });
    await seen("x", ["a"], [n("a")]);
    expect(await get("x", [n("a")])).toEqual([]);
    expect(await get("y", [n("a")])).toEqual(["a"]);
  });
});

describe("POST /whats-new/seen validation", () => {
  it("rejects non-array or non-string ids", async () => {
    expect(await seen("u", "a", [n("a")])).toBe(400);
    expect(await seen("u", [1], [n("a")])).toBe(400);
    expect(await seen("u", undefined, [n("a")])).toBe(400);
    expect(await seen("u", ["x".repeat(101)], [n("a")])).toBe(400);
  });
  it("ignores ids that aren't notes and doesn't write", async () => {
    rows.set("u", { userId: "u", whatsNewSeen: "[]", updatedAt: "x" });
    expect(await seen("u", ["nope"], [n("a")])).toBe(204);
    expect(rows.get("u")!.whatsNewSeen).toBe("[]");
    expect(forceSave).not.toHaveBeenCalled();
  });
});
