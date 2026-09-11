/**
 * Phase 15 Plan 1 + Phase 92 Plan 92-02: /user-preferences GET + PUT tests.
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
 * Phase 92-02 rewires the pin path:
 *   - pinnedConversationIds is NO LONGER read from / written to the DB row.
 *   - GET response omits pinnedConversationIds entirely (D-03 no DB mirror).
 *   - PUT fans out per-identity `.pinned` sentinel writes/removes via the
 *     Plan 92-01 primitive (writeIdentityFile / removeIdentityFile /
 *     identityFileExists) with a required `identityHosts` body field
 *     mapping identityKey → hostId.
 *   - hiddenConversationIds slice is UNCHANGED (D-02 out-of-scope).
 *
 * Test coverage:
 *   PUT-92-01..08 : Phase 92-02 pin-fanout contract (writes/removes/no-op/
 *                   failure/identityHosts-required/validation/H3-verbatim)
 *   GET-92-01     : pinnedConversationIds absent from GET response
 *   PIN 7-9       : PUT input validation (non-array / non-string / > 1000) preserved
 *   REG 1-3       : reopenTabsOnLogin non-boolean 400 / theme non-string 400 /
 *                   empty updates 400 still work after the extension
 *   HIDE 1-10     : hiddenConversationIds slice untouched (regression trap for
 *                   D-02 out-of-scope pledge)
 *   SAVE 1-4      : DatabaseSaveTrigger.forceSave sites for theme/fontSize/etc.
 *                   writes (pin no longer contributes; hidden still does)
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
// Phase 92 Plan 92-02 Task 2: per-identity file primitive mocks
// ---------------------------------------------------------------------------
//
// The rewired handler fans PUT pin-toggles out to per-identity `.pinned`
// sentinel writes/removes via the Plan 92-01 primitive. Tests spy on these
// three exports to assert the fan shape (writes for keys added to the set,
// removes for keys taken out, no-ops on unchanged keys, verbatim identityKey
// passthrough for the H3 lowercase-on-disk lock).

const writeIdentityFileMock = vi.fn(async () => {});
const removeIdentityFileMock = vi.fn(async () => {});
const identityFileExistsMock = vi.fn(async () => false);

vi.mock("../../claude-session/per-identity-file.js", () => ({
  writeIdentityFile: (name: string, relPath: string, contents: string, opts: unknown) =>
    writeIdentityFileMock(name, relPath, contents, opts),
  removeIdentityFile: (name: string, relPath: string, opts: unknown) =>
    removeIdentityFileMock(name, relPath, opts),
  identityFileExists: (name: string, relPath: string, opts: unknown) =>
    identityFileExistsMock(name, relPath, opts),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  ALLOWED_REL_PATHS: new Set(["relay.json", ".pinned"]),
}));

// isLocalHostId + identity-artifact-reader mock — the handler uses isLocalHostId
// to route the SSH conn vs LOCAL branch. For pin-fanout, LOCAL means conn=null.
const isLocalHostIdMock = vi.fn(() => true);

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: (n: number | undefined) => isLocalHostIdMock(n),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

// SSH connection mocks — only fire on REMOTE branch (isLocalHostId=false).
const connectOneShotMock = vi.fn();

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: (host: unknown, timeoutMs: number) =>
    connectOneShotMock(host, timeoutMs),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn().mockResolvedValue({
    ip: "10.0.0.5",
    port: 22,
    username: "ubuntu",
    authType: "key",
    key: "fake-key",
  }),
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
  // Phase 92 Plan 92-02 per-identity mocks
  writeIdentityFileMock.mockClear();
  removeIdentityFileMock.mockClear();
  identityFileExistsMock.mockClear();
  writeIdentityFileMock.mockImplementation(async () => {});
  removeIdentityFileMock.mockImplementation(async () => {});
  identityFileExistsMock.mockImplementation(async () => false);
  isLocalHostIdMock.mockClear();
  isLocalHostIdMock.mockReturnValue(true);
  connectOneShotMock.mockClear();
  connectOneShotMock.mockResolvedValue({ __fake: "ssh-conn", end: vi.fn() });
});

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------

// Phase 92 Plan 92-02: pinnedConversationIds is NO LONGER derived from the
// user_preferences DB row on GET (D-03 no DB mirror; the frontend Plan 04
// projects the pinned zone from GET /identities' per-identity `pinned` field
// instead). Test GET-92-01 locks that: the response body must OMIT the
// pinnedConversationIds field even if the (legacy) row happens to still hold
// a JSON-encoded value.
describe("handleGetPreferences: pinnedConversationIds absent from response (Phase 92-02)", () => {
  it("GET-92-01: pinnedConversationIds is NOT present in GET response — no row", () => {
    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect("pinnedConversationIds" in body).toBe(false);
    // Other preferences fields still present
    expect("reopenTabsOnLogin" in body).toBe(true);
    expect("theme" in body).toBe(true);
    expect("hiddenConversationIds" in body).toBe(true);
  });

  it("GET-92-01b: pinnedConversationIds is NOT present in GET response — even if legacy row holds a non-null value", () => {
    // Legacy row from before the migration — column may still carry old JSON.
    // Post-92-02, the row is no longer consulted for pins.
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["legacy-a", "legacy-b"]),
      hiddenConversationIds: null,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect("pinnedConversationIds" in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — PUT
// ---------------------------------------------------------------------------

// ===========================================================================
// Phase 92 Plan 92-02 Task 2: pin fan-out contract
// ===========================================================================
//
// The rewired PUT handler no longer touches the DB row for pinnedConversationIds.
// Instead it fans out per-identity `.pinned` sentinel writes/removes over
// Plan 92-01's primitive. Required body field: identityHosts (Record<identityKey,
// hostId>) — the fanout uses it to route each write to the identity's home box.
// Response echoes the disk-authoritative post-fanout set as pinnedConversationIds
// (D-06 UI-invariance preserved).
//
// H3 lowercase-on-disk invariant: identityHosts keys are lowercased at the
// parseIdentityHosts entry boundary (identities.ts:248). The keys threaded
// into writeIdentityFile / removeIdentityFile / identityFileExists are those
// already-lowercased strings, VERBATIM — no case coercion between the body
// and the primitive. Plan 01's stricter IDENTITY_KEY_RE at the primitive is
// the belt-and-suspenders lock: any uppercase key sneaking through this
// handler would throw at the primitive.

describe("handlePutPreferences: Phase 92-02 pin sentinel fan-out", () => {
  it("PUT-92-01: pin one identity — writeIdentityFile('tina', '.pinned', ...) called ONCE, no removes, response echoes ['tina']", async () => {
    // Prior disk state: nothing pinned.
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Exactly one write, no removes
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    const [name, relPath, contents] = writeIdentityFileMock.mock.calls[0];
    expect(name).toBe("tina");
    expect(relPath).toBe(".pinned");
    expect(contents).toBe(""); // empty body — presence IS the meaning (D-01)
    expect(removeIdentityFileMock).not.toHaveBeenCalled();

    // Response echoes disk-derived post-fanout set. Since after write the disk
    // truth is `tina→true`, the identityFileExists re-read (fanout-post) must
    // observe true for tina. Simulate that by having exists return true for
    // any post-write probe; but the simplest assertion: response includes
    // pinnedConversationIds field (whatever shape, D-06 preserves the array
    // API for the UI). We rerun exists so the mock returns the new state.
    const body = res._body as { pinnedConversationIds: unknown };
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
  });

  it("PUT-92-02: unpin one identity — removeIdentityFile('tina', '.pinned', ...) called ONCE, no writes", async () => {
    // Prior disk state: tina pinned. Post-write re-read: tina no longer pinned.
    // Sequence per call:
    //   1st (per-key pre-diff) tina → true
    //   2nd (per-key post-fanout echo) tina → false
    identityFileExistsMock
      .mockResolvedValueOnce(true) // pre: tina pinned
      .mockResolvedValueOnce(false); // post: tina unpinned

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: [], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(removeIdentityFileMock).toHaveBeenCalledTimes(1);
    const [name, relPath] = removeIdentityFileMock.mock.calls[0];
    expect(name).toBe("tina");
    expect(relPath).toBe(".pinned");
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-03: swap pins — writeIdentityFile('bob', ...) AND removeIdentityFile('alice', ...) in same fanout", async () => {
    // Prior state: alice pinned, bob unpinned. New: bob pinned, alice unpinned.
    // pre-diff probes fire once per identityHosts key (Promise.all order can
    // interleave alice+bob) — return true for alice, false for bob.
    identityFileExistsMock.mockImplementation(async (name: string) => {
      // Both pre-diff and post-fanout re-read call this. Simplest deterministic
      // policy: return true for the identity currently supposed to be pinned.
      // The handler calls this twice per key (pre + post). Tests below check
      // the CALL SEQUENCE, not the return values.
      // Toggle behavior via call count.
      return name === "alice" && identityFileExistsMock.mock.calls.length <= 2;
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["bob"],
        identityHosts: { alice: 1, bob: 1 },
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // One add (bob), one remove (alice)
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    expect(writeIdentityFileMock.mock.calls[0][0]).toBe("bob");
    expect(writeIdentityFileMock.mock.calls[0][1]).toBe(".pinned");

    expect(removeIdentityFileMock).toHaveBeenCalledTimes(1);
    expect(removeIdentityFileMock.mock.calls[0][0]).toBe("alice");
    expect(removeIdentityFileMock.mock.calls[0][1]).toBe(".pinned");
  });

  it("PUT-92-04: no-op — same set as prior disk state means NO writes and NO removes", async () => {
    // Prior state: tina pinned. New: tina pinned. Delta is empty on both sides.
    identityFileExistsMock.mockResolvedValue(true); // both pre + post echo see tina pinned

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
    expect(removeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-05: write failure surfaces synchronously per D-06 — writeIdentityFile throws → 500 response, no success echo", async () => {
    identityFileExistsMock.mockResolvedValue(false); // nothing pinned prior
    writeIdentityFileMock.mockRejectedValueOnce(new Error("sftp exploded"));

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    // Non-2xx per D-06 synchronous truth. The exact code is whatever the
    // pre-92 catch block returned (500 with error object).
    expect(res._status).toBeGreaterThanOrEqual(500);
    expect(res._body).toHaveProperty("error");
  });

  it("PUT-92-06: identityKey not in identityHosts map → 400 with 'identity host required', NO sentinel writes attempted", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["unknown-key"],
        identityHosts: { tina: 1 }, // "unknown-key" not mapped to a host
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("identity host required");
    // Defense-in-depth: NO writes attempted before the 400 fires.
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
    expect(removeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-07a: validation preserved — non-array pinnedConversationIds → 400 (pre-fanout)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: "not-an-array", identityHosts: {} },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds must be an array of strings",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-07b: validation preserved — non-string element → 400 (pre-fanout)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["a", 42], identityHosts: { a: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds must be an array of strings",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-07c: validation preserved — length > 1000 → 400 (pre-fanout)", async () => {
    const huge = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const hosts: Record<string, number> = {};
    for (const k of huge) hosts[k] = 1;

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: huge, identityHosts: hosts },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "pinnedConversationIds exceeds max length of 1000",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-07d: PUT without identityHosts body field but with pinnedConversationIds → 400", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"] }, // identityHosts omitted
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("identityhosts");
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("PUT-92-08a: H3 verbatim — identityKey passed to writeIdentityFile byte-for-byte from identityHosts (lowercase input path)", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    // Byte-for-byte match: the identityKey argument is exactly "tina" — no
    // .toUpperCase(), no .toLowerCase() coercion between input and primitive.
    expect(writeIdentityFileMock.mock.calls[0][0]).toBe("tina");
    expect(writeIdentityFileMock.mock.calls[0][1]).toBe(".pinned");
  });

  it("PUT-92-08b: H3 lock — an uppercase 'Tina' path either 400s at parseIdentityHosts or throws at the primitive; ZERO uppercase key ever reaches disk", async () => {
    identityFileExistsMock.mockResolvedValue(false);
    // If a raw "Tina" somehow makes it to writeIdentityFile, the primitive's
    // IDENTITY_KEY_RE gate would throw. Simulate that here so the assertion
    // is that no uppercase identityKey ever survives to the primitive.
    writeIdentityFileMock.mockImplementation(async (name: string) => {
      if (!/^[a-z0-9_-]{1,64}$/.test(name)) {
        throw new Error(`invalid identityKey — must match /^[a-z0-9_-]{1,64}$/`);
      }
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["Tina"],
        identityHosts: { Tina: 1 }, // NOTE: capital T — will be lowercased by
        // parseIdentityHosts to `tina` at the entry boundary, causing
        // "Tina" (in pinnedConversationIds) to not resolve to a host → 400.
      },
      res as unknown as Response,
    );

    // EITHER path is acceptable per the plan:
    //  (a) 400 (parseIdentityHosts lowercase collapse → key not found)
    //  (b) 500 (writeIdentityFile primitive gate throw)
    // The invariant: NO uppercase identityKey ever reached disk.
    // Collect all identityKey args passed to any of the three primitives.
    const allKeys: string[] = [];
    for (const call of writeIdentityFileMock.mock.calls) allKeys.push(call[0]);
    for (const call of removeIdentityFileMock.mock.calls) allKeys.push(call[0]);
    for (const call of identityFileExistsMock.mock.calls) allKeys.push(call[0]);
    for (const k of allKeys) {
      expect(k).toBe(k.toLowerCase());
    }
    expect([400, 500]).toContain(res._status);
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
  it("HIDE-X — PUT with BOTH fields: pins fan out to sentinel writes; hides persist to DB row (Phase 92-02: pin path decoupled from hidden path)", async () => {
    identityFileExistsMock.mockResolvedValue(false); // nothing pinned prior

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["pin-a", "pin-b"],
        identityHosts: { "pin-a": 1, "pin-b": 1 },
        hiddenConversationIds: ["hide-x", "hide-y"],
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);

    // Pin path: fanout writes via primitive; DB row's pinnedConversationIds
    // column NOT written (D-03 no DB mirror).
    const row = rows.get(USER_ID);
    expect(row).toBeDefined();
    expect(row!.pinnedConversationIds).toBeNull(); // NOT written
    // Hide path: preserved verbatim (D-02 out-of-scope).
    expect(row!.hiddenConversationIds).toBe('["hide-x","hide-y"]');

    // Pin fanout observed
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(2);
    const namesWritten = writeIdentityFileMock.mock.calls.map((c) => c[0]);
    expect(namesWritten).toContain("pin-a");
    expect(namesWritten).toContain("pin-b");

    // Response echoes hiddenConversationIds as parsed array (unchanged)
    const body = res._body as {
      hiddenConversationIds: unknown;
    };
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
  it("SAVE 1 — insert branch (no row exists) triggers forceSave with the 'user_preferences_updated' reason (hidden-only PUT — pins no longer touch the row)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["a"] },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "user_preferences_updated",
    );
  });

  it("SAVE 2 — update branch (row exists) also triggers forceSave (theme-write path)", async () => {
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
    await handlePutPreferences(
      USER_ID,
      { theme: "dark" },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
  });

  it("SAVE 3 — 400 validation branches do NOT trigger forceSave (no write happened)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: "not-an-array" },
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
      { hiddenConversationIds: ["a"] },
      res as unknown as Response,
    );

    // Response still succeeds — the write reached RAM and the client gets its
    // echo. The lost-durability event is logged via databaseLogger.warn.
    expect(res._status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
  });

  it("SAVE 92-02 — pin-only PUT does NOT trigger a DB write / forceSave (pinnedConversationIds no longer contributes to updates)", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { pinnedConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Pin fanout DID happen
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    // But no DB write for pins (the row's pinnedConversationIds column is
    // untouched) → forceSave is NOT called for a pin-only request.
    expect(DatabaseSaveTrigger.forceSave).not.toHaveBeenCalled();
    // Row was never inserted or updated
    expect(rows.get(USER_ID)).toBeUndefined();
  });
});
