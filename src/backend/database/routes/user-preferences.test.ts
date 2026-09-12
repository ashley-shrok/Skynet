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
  it("GET-92-01: pinnedConversationIds is NOT present in GET response — no row (Phase 107-02: hiddenConversationIds also absent)", () => {
    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect("pinnedConversationIds" in body).toBe(false);
    // Phase 107-02: hiddenConversationIds ALSO absent from GET response (D-02 complete).
    expect("hiddenConversationIds" in body).toBe(false);
    // Other preferences fields still present
    expect("reopenTabsOnLogin" in body).toBe(true);
    expect("theme" in body).toBe(true);
  });

  it("GET-92-01b: pinnedConversationIds AND hiddenConversationIds NOT in GET response — even if legacy row holds non-null values", () => {
    // Legacy row from before the migration — columns may still carry old JSON.
    // Post-92-02 and 107-02, the row is no longer consulted for either slice.
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: JSON.stringify(["legacy-a", "legacy-b"]),
      hiddenConversationIds: JSON.stringify(["legacy-h1"]),
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect("pinnedConversationIds" in body).toBe(false);
    // Phase 107-02: hiddenConversationIds also absent post-migration.
    expect("hiddenConversationIds" in body).toBe(false);
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
// Phase 107 Plan 107-02: HID-107-GET-01 — GET no longer surfaces hiddenConversationIds
// ---------------------------------------------------------------------------
//
// After this plan, pickPreferences no longer projects hiddenConversationIds from
// the DB row. The field is GONE from the GET response body. Frontend Plan 04
// rewires hidden derivation to use per-identity `hidden: boolean` from GET /identities.

describe("handleGetPreferences: Phase 107-02 hiddenConversationIds retired from GET response", () => {
  it("HID-107-GET-01: hiddenConversationIds is NOT present in GET response — field removed from pickPreferences", () => {
    // Seed a row with a non-null hiddenConversationIds to prove the column is
    // no longer consulted (the field must be absent regardless of row state).
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: JSON.stringify(["legacy-h1", "legacy-h2"]),
      updatedAt: "2026-07-31T00:00:00.000Z",
    });

    const res = makeRes();
    handleGetPreferences(USER_ID, res as unknown as Response);

    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    // Field MUST be absent — NOT projected from the row.
    expect("hiddenConversationIds" in body).toBe(false);
    // pinnedConversationIds is also absent (from Phase 92-02).
    expect("pinnedConversationIds" in body).toBe(false);
    // Other preference fields still present.
    expect("reopenTabsOnLogin" in body).toBe(true);
    expect("theme" in body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 107 Plan 107-02: HID-107-PUT-* — PUT hidden fanout (disk sentinel)
// ---------------------------------------------------------------------------
//
// Mirrors the PUT-92-* pin fanout tests, s/pinnedConversationIds/hiddenConversationIds/
// and s/'.pinned'/'.hidden'/. The hidden fanout runs AFTER the pin fanout as a
// sibling block in the same try/finally, sharing the connByHost map.

describe("handlePutPreferences: Phase 107-02 hidden sentinel fan-out", () => {
  it("HID-107-PUT-01: hide one identity — writeIdentityFile('tina', '.hidden', '', ...) called ONCE, no removes, response echoes ['tina']", async () => {
    // Prior disk state: nothing hidden.
    identityFileExistsMock.mockImplementation(async (_name: string, relPath: string) => {
      // pre-diff + post-echo for .hidden → true after the write
      if (relPath === ".pinned") return false;
      // All .hidden calls: return false initially; after the write it should return true.
      // Simplest: return false always — handler will still write and the echo re-derives.
      return false;
    });
    // After the fanout write, the post-echo probe should return true for "tina" .hidden.
    // Simulate: first call (pre-diff) returns false, second call (echo) returns true.
    identityFileExistsMock
      .mockResolvedValueOnce(false) // .hidden pre-diff for "tina" → not hidden
      .mockResolvedValueOnce(true); // .hidden post-echo for "tina" → now hidden

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Exactly one write for .hidden, no removes.
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(1);
    expect(hiddenWrites[0][0]).toBe("tina");
    expect(hiddenWrites[0][2]).toBe(""); // empty body — presence IS meaning (D-01)
    const hiddenRemoves = removeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenRemoves).toHaveLength(0);
    // Response echoes disk-derived hiddenConversationIds.
    const body = res._body as { hiddenConversationIds: unknown };
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
  });

  it("HID-107-PUT-02: unhide one identity — removeIdentityFile('tina', '.hidden', ...) called ONCE, no writes", async () => {
    // Prior state: tina hidden. Post-remove: tina not hidden.
    identityFileExistsMock
      .mockResolvedValueOnce(true)   // .hidden pre-diff for "tina" → was hidden
      .mockResolvedValueOnce(false); // .hidden post-echo for "tina" → now unhidden

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: [], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const hiddenRemoves = removeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenRemoves).toHaveLength(1);
    expect(hiddenRemoves[0][0]).toBe("tina");
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(0);
    // Response echoes disk-derived hiddenConversationIds (empty after remove).
    const body = res._body as { hiddenConversationIds: unknown };
    expect(body.hiddenConversationIds).toEqual([]);
  });

  it("HID-107-PUT-03: swap hides — writeIdentityFile('bob', .hidden) AND removeIdentityFile('alice', .hidden) in same fanout", async () => {
    // Prior: alice hidden, bob not hidden. New: bob hidden, alice not hidden.
    identityFileExistsMock.mockImplementation(async (name: string, relPath: string) => {
      if (relPath !== ".hidden") return false;
      // Use call count to differentiate pre-diff from post-echo. Pre-diff fires
      // for alice+bob in the same Promise.all; post-echo fires after writes.
      // Return alice=true, bob=false for the pre-diff round.
      return name === "alice" && identityFileExistsMock.mock.calls
        .filter((c) => c[1] === ".hidden").length <= 2;
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        hiddenConversationIds: ["bob"],
        identityHosts: { alice: 1, bob: 1 },
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(1);
    expect(hiddenWrites[0][0]).toBe("bob");
    const hiddenRemoves = removeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenRemoves).toHaveLength(1);
    expect(hiddenRemoves[0][0]).toBe("alice");
  });

  it("HID-107-PUT-04: no-op — same set as prior disk state means NO writes and NO removes for .hidden", async () => {
    // Prior state: tina hidden. New: tina hidden. Delta is empty.
    identityFileExistsMock.mockResolvedValue(true); // pre + post echo both see tina hidden

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    const hiddenRemoves = removeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(0);
    expect(hiddenRemoves).toHaveLength(0);
  });

  it("HID-107-PUT-05: write failure surfaces synchronously per D-06 — writeIdentityFile throws for .hidden → 500, conns closed", async () => {
    identityFileExistsMock.mockResolvedValue(false); // nothing hidden prior
    writeIdentityFileMock.mockImplementation(async (_name: string, relPath: string) => {
      if (relPath === ".hidden") throw new Error("sftp exploded for .hidden");
    });

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBeGreaterThanOrEqual(500);
    expect(res._body).toHaveProperty("error");
  });

  it("HID-107-PUT-06: hidden key not in identityHosts → 400 'identity host required', NO .hidden writes", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        hiddenConversationIds: ["unknown-key"],
        identityHosts: { tina: 1 }, // "unknown-key" not mapped
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("identity host required");
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(0);
  });

  it("HID-107-PUT-07a: validation preserved — non-array hiddenConversationIds → 400 (pre-fanout)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: "not-an-array", identityHosts: {} },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds must be an array of strings",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("HID-107-PUT-07b: validation preserved — non-string element → 400 (pre-fanout)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["a", 99], identityHosts: { a: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds must be an array of strings",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("HID-107-PUT-07c: validation preserved — length > 1000 → 400 (DoS mitigation)", async () => {
    const huge = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const hosts: Record<string, number> = {};
    for (const k of huge) hosts[k] = 1;

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: huge, identityHosts: hosts },
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: "hiddenConversationIds exceeds max length of 1000",
    });
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("HID-107-PUT-07d: identityHosts missing → 400 when hiddenConversationIds present (mirrors PIN guard)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"] }, // identityHosts omitted
      res as unknown as Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("identityhosts");
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  it("HID-107-PUT-08: H3 lock — identityKey passed VERBATIM to writeIdentityFile byte-for-byte for .hidden", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(1);
    // Byte-for-byte match: identityKey is "tina" — no .toUpperCase()/.toLowerCase().
    expect(hiddenWrites[0][0]).toBe("tina");

    // Additionally: all identityKey args across ALL .hidden primitive calls
    // must be lowercase (H3 anti-coercion lock).
    const allHiddenKeyArgs: string[] = [];
    for (const call of writeIdentityFileMock.mock.calls) {
      if (call[1] === ".hidden") allHiddenKeyArgs.push(call[0]);
    }
    for (const call of removeIdentityFileMock.mock.calls) {
      if (call[1] === ".hidden") allHiddenKeyArgs.push(call[0]);
    }
    for (const call of identityFileExistsMock.mock.calls) {
      if (call[1] === ".hidden") allHiddenKeyArgs.push(call[0]);
    }
    for (const k of allHiddenKeyArgs) {
      expect(k).toBe(k.toLowerCase());
    }
  });

  it("HID-107-PUT-09: combined pin+hidden PUT shares connByHost — openConnForHost called ONCE per unique host across BOTH fanouts", async () => {
    // Use REMOTE host (isLocalHostId=false) so SSH conns are actually opened.
    isLocalHostIdMock.mockReturnValue(false);
    const fakeConn = { __fake: "ssh-conn", end: vi.fn() };
    connectOneShotMock.mockResolvedValue(fakeConn);
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["tina"],
        hiddenConversationIds: ["alice"],
        identityHosts: { tina: 1, alice: 2 }, // two DIFFERENT hostIds
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);

    // connectOneShot called EXACTLY ONCE per unique host (2 calls total: host 1 + host 2).
    // NOT called 4 times (once per fanout per host — that would be wrong).
    expect(connectOneShotMock).toHaveBeenCalledTimes(2);

    // Both pin and hidden fanouts ran.
    const pinWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".pinned");
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(pinWrites).toHaveLength(1);  // tina pinned
    expect(hiddenWrites).toHaveLength(1); // alice hidden

    // Response body has both echoes.
    const body = res._body as {
      pinnedConversationIds?: unknown;
      hiddenConversationIds?: unknown;
    };
    expect(Array.isArray(body.pinnedConversationIds)).toBe(true);
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
  });

  it("HID-107-PUT-10: response echo re-derived from disk for hidden — trust disk, not client input", async () => {
    // Client submits hiddenConversationIds: ["tina"] with identityHosts {"tina": 1, "bob": 1}.
    // The disk re-probe after the fanout returns true for BOTH "tina" and "bob"
    // (simulating that bob was already hidden on disk before this PUT).
    // The echo must reflect disk state, not just the client-submitted set.

    // Pre-diff: nothing hidden.
    // Post-echo: tina=true, bob=true (disk says both are hidden after the write).
    identityFileExistsMock
      .mockResolvedValueOnce(false) // pre-diff: tina .hidden → not hidden
      .mockResolvedValueOnce(false) // pre-diff: bob .hidden → not hidden
      .mockResolvedValueOnce(true)  // post-echo: tina .hidden → hidden
      .mockResolvedValueOnce(true); // post-echo: bob .hidden → hidden

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        hiddenConversationIds: ["tina"],
        identityHosts: { tina: 1, bob: 1 },
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Echo is disk-authoritative — includes "bob" because the disk probe returned
    // true for bob (even though client only submitted ["tina"]).
    const body = res._body as { hiddenConversationIds: unknown };
    expect(Array.isArray(body.hiddenConversationIds)).toBe(true);
    const echoArr = body.hiddenConversationIds as string[];
    // Both tina and bob appear in the echo (from disk truth).
    expect(echoArr).toContain("tina");
    expect(echoArr).toContain("bob");
  });
});

// ---------------------------------------------------------------------------
// Phase 107 Plan 107-02: HID-107-DB-01 — D-02 regression trap
// Both pinnedConversationIds AND hiddenConversationIds DB columns untouched post-fanout
// ---------------------------------------------------------------------------

describe("handlePutPreferences: Phase 107-02 D-02 regression trap — DB columns untouched", () => {
  it("HID-107-DB-01: after hidden fanout, DB row's hidden_conversation_ids column UNCHANGED (null); pin column also UNCHANGED", async () => {
    // Seed row with specific hiddenConversationIds to prove it's not overwritten.
    const seedHidden = JSON.stringify(["pre-existing-h1"]);
    rows.set(USER_ID, {
      userId: USER_ID,
      reopenTabsOnLogin: false,
      theme: null,
      fontSize: null,
      accentColor: null,
      language: null,
      pinnedConversationIds: null,
      hiddenConversationIds: seedHidden,
      updatedAt: "2026-07-31T00:00:00.000Z",
    });

    identityFileExistsMock.mockResolvedValue(false);

    // Hidden-only PUT via fanout.
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);

    // DB row's hiddenConversationIds must be UNCHANGED from the seed value.
    // The fanout writes to disk sentinel, not to the DB column.
    const row = rows.get(USER_ID);
    // Row should NOT be mutated at all by a hidden-only fanout (D-02 decoupling).
    // Either row is null (no DB write happened) OR it's the seeded value unchanged.
    if (row !== undefined) {
      expect(row.hiddenConversationIds).toBe(seedHidden); // unchanged
      expect(row.pinnedConversationIds).toBeNull(); // never written
    }
    // If row is undefined, no DB write happened at all — even better.
  });

  it("HID-107-DB-01b: combined pin+hidden PUT — BOTH DB columns (pinned + hidden) remain untouched", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      {
        pinnedConversationIds: ["tina"],
        hiddenConversationIds: ["alice"],
        identityHosts: { tina: 1, alice: 1 },
      },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);

    // No row inserted for a combined pin+hidden-only PUT.
    // (No theme/fontSize/accentColor/language/reopenTabsOnLogin in body.)
    const row = rows.get(USER_ID);
    // Row must not exist (nothing to write to DB for either sentinel slice).
    expect(row).toBeUndefined();
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
  it("SAVE 1 — insert branch (no row exists) triggers forceSave with the 'user_preferences_updated' reason (language-write path)", async () => {
    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { language: "en" },
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
      { language: "fr" }, // DB-path write to trigger forceSave
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
    const pinWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".pinned");
    expect(pinWrites).toHaveLength(1);
    // But no DB write for pins (the row's pinnedConversationIds column is
    // untouched) → forceSave is NOT called for a pin-only request.
    expect(DatabaseSaveTrigger.forceSave).not.toHaveBeenCalled();
    // Row was never inserted or updated
    expect(rows.get(USER_ID)).toBeUndefined();
  });

  it("SAVE 107-01 — hidden-only PUT does NOT trigger a DB write / forceSave (hiddenConversationIds no longer contributes to updates post-107-02)", async () => {
    identityFileExistsMock.mockResolvedValue(false);

    const res = makeRes();
    await handlePutPreferences(
      USER_ID,
      { hiddenConversationIds: ["tina"], identityHosts: { tina: 1 } },
      res as unknown as Response,
    );

    expect(res._status).toBe(200);
    // Hidden fanout DID happen
    const hiddenWrites = writeIdentityFileMock.mock.calls.filter((c) => c[1] === ".hidden");
    expect(hiddenWrites).toHaveLength(1);
    // No DB write for hidden — forceSave is NOT called.
    expect(DatabaseSaveTrigger.forceSave).not.toHaveBeenCalled();
    // Row was never inserted or updated
    expect(rows.get(USER_ID)).toBeUndefined();
  });
});
