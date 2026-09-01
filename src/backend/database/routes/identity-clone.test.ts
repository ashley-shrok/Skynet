/**
 * Phase 22 (SRIC-03): Tests for the identity-clone route.
 *
 * Tests exercise POST /identities/clone via a bare Express app using Node's
 * built-in http module (supertest not in project deps — mirrors identity-
 * exists-on-host.test.ts / roles-create.test.ts pattern).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) +
 * resolveHostById + writeMarkdownFileAtomic + resolveRoleForIdentity +
 * getCandidateForBirth + consumeCandidateForBirth are mocked. The identities
 * DB is mocked via a lightweight in-memory shim that mirrors the drizzle
 * chain surface (select/from/where/all + insert/values/run).
 *
 * Test coverage (12 tests — mirror plan Task 1 <behavior> 1..12):
 *   1: POST /identities/clone with empty body → 400
 *   2: sourceIdentityKey failing IDENTITY_KEY_RE → 400
 *   3: newName failing IDENTITY_KEY_RE → 400
 *   4: hostId not owned by user → 404 (resolveHostById returns null)
 *   5: source row not found in Skynet DB → 404
 *   6: source's fleet name-file has no role frontmatter → 500 ("source has no
 *      role frontmatter" — mirrors resolveRoleForIdentity throw). NO fallback.
 *   7: newName already exists on target host → 409
 *   8: happy path (with avatarCandidateId) — 201, DB insert with locked
 *      colorHue, SSH mkdir/touch, writeMarkdownFileAtomic called with SEED
 *      COMMENT stub body (REVISION 2026-08-04: NO SSH relay-register).
 *      Assertions:
 *        - DB INSERT identities with nanoid id, identityKey=newName,
 *          displayName=newName, title=user-edited, voice=user-edited,
 *          colorHue=source.colorHue (LOCKED — user cannot edit)
 *        - avatarData=candidate.bytes, avatarMime="image/png",
 *          avatarEtag=md5(bytes)
 *        - SSH mkdir + touch for new identity folder + wakeups + handoff.md
 *        - writeMarkdownFileAtomic called with role: <sourceRole> frontmatter
 *          AND the wake-up SEED COMMENT (positive+negative style assertions)
 *        - consumeCandidateForBirth called
 *        - response 201 with publicIdentity(newRow) shape
 *   9: WITHOUT avatarCandidateId — clone uses source's avatarData buffer
 *      verbatim
 *  10: SSH connect failure → 502; DB row NOT inserted (SSH prep must succeed
 *      before DB insert)
 *  11: Missing JWT cookie → 401
 *  12: Multipart requests rejected — endpoint only accepts application/json
 *      (415 status) — sidesteps Phase 20 patch #77 trap by contract
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — controls whether a request is authenticated
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock SSH primitives + identity-artifact-reader helpers + avatar batch
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  writeMarkdownFileAtomic: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  resolveRoleForIdentity: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  },
}));

vi.mock("./identity-avatar-batch.js", () => ({
  getCandidateForBirth: vi.fn(),
  consumeCandidateForBirth: vi.fn(),
  default: express.Router(),
}));

// quick-260806-dwe: mock the extracted harness-start helper so clone tests
// don't have to simulate the ~25s tmux+sleep dance. Behavioral parity of the
// actual sequence is covered by identity-harness-start.test.ts.
vi.mock("./identity-harness-start.js", () => ({
  startHarnessOnIdentity: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// In-memory DB shim — mirrors the drizzle chain surface the route uses.
// State is reset per-test via beforeEach so cross-test isolation holds.
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: identities table narrowed to the 5 surviving columns.
// Cosmetics live on disk per shape file — tests no longer assert on them
// in the store shim. Tests 8/9/11 rewritten to check disk-inferred defaults
// on publicIdentity (safe-defaults pattern; see identity-clone.ts).
type IdentityRow = {
  id: string;
  userId: string;
  identityKey: string;
  createdAt: string;
  updatedAt: string;
};

const dbState: {
  rows: IdentityRow[];
  lastFilter: {
    userId?: string;
    identityKey?: string;
    id?: string;
  };
} = {
  rows: [],
  lastFilter: {},
};

// eq/and are stubbed to capture filter intent for `where(...)` calls.
// The chain: db.select().from(identities).where(and(eq(userId,X), eq(identityKey,Y))).all()
// We record the eq column+value pairs in a filter obj, then all() applies them.

let filterAccum: Record<string, unknown> = {};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string }, val: unknown) => {
    filterAccum[col._colName] = val;
    return { __type: "eq", col: col._colName, val };
  },
  and: (...conds: unknown[]) => ({ __type: "and", conds }),
}));

vi.mock("../db/schema.js", () => ({
  identities: {
    userId: { _colName: "userId" },
    identityKey: { _colName: "identityKey" },
    id: { _colName: "id" },
  },
}));

vi.mock("../db/index.js", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => {
      dbState.lastFilter = { ...filterAccum };
      filterAccum = {};
      return chain;
    },
    all: () => {
      const f = dbState.lastFilter;
      dbState.lastFilter = {};
      return dbState.rows.filter((r) => {
        if (f.userId !== undefined && r.userId !== f.userId) return false;
        if (f.identityKey !== undefined && r.identityKey !== f.identityKey) return false;
        if (f.id !== undefined && r.id !== f.id) return false;
        return true;
      });
    },
    insert: () => chain,
    values: (row: IdentityRow) => {
      // capture row for run() below
      (chain as unknown as { _pending: IdentityRow })._pending = row;
      return chain;
    },
    run: () => {
      const row = (chain as unknown as { _pending?: IdentityRow })._pending;
      if (row) dbState.rows.push(row);
      (chain as unknown as { _pending?: IdentityRow })._pending = undefined;
    },
  };
  return { db: chain };
});

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
  resolveRoleForIdentity,
} from "../../claude-session/identity-artifact-reader.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
import { startHarnessOnIdentity } from "./identity-harness-start.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

// Stub SSH conn + host record + source row
const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 5,
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// Phase 66 Plan 04: source row no longer carries cosmetic columns. The
// clone handler no longer copies avatar/mime/etag/colorHue from the row —
// those come from disk (or safe-defaults on publicIdentity).
const stubSourceRow: IdentityRow = {
  id: "src-id-nano",
  userId: "1",
  identityKey: "tina",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Import router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./identity-clone.js";

let server: http.Server;

// quick-260806-dwe: typed mock reference for the harness-start helper. Casted
// to Mock so tests can .mockRejectedValueOnce and inspect .mock.calls.
const mockStartHarness = startHarnessOnIdentity as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();
  mockStartHarness.mockReset().mockResolvedValue(undefined);
  dbState.rows = [];
  dbState.lastFilter = {};
  filterAccum = {};

  // Seed the source row
  dbState.rows.push({ ...stubSourceRow });

  // Default: user owns host 5; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default execCommand: return "missing" for existence probe, "/home/ubuntu"
  // for `echo $HOME`, empty string for mkdir+touch.
  (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
    if (cmd.includes("if [ -d")) return "missing";
    if (cmd.includes("echo $HOME")) return "/home/ubuntu";
    if (cmd.includes("mkdir") || cmd.includes("touch")) return "";
    return "";
  });

  (resolveRoleForIdentity as Mock).mockResolvedValue("box-maintainer");
  (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);
  (getCandidateForBirth as Mock).mockReturnValue({
    bytes: Buffer.from("candidate-avatar-bytes"),
    mime: "image/png",
  });

  const app = express();
  // Router does its own express.json() mounting per plan
  app.use("/identities/clone", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identities/clone", () => {
  it("Test 1: POST with empty body → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2: sourceIdentityKey failing IDENTITY_KEY_RE → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "BAD KEY WITH SPACES!",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/source|identityKey|invalid/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3: newName failing IDENTITY_KEY_RE → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "Bad Name!",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/newName|name|invalid/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: hostId not owned by user → 404 (resolveHostById returns null)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 99999,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 5: source row not found in Skynet DB → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "nonexistent",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/source not found/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 6: source has no role frontmatter → 500 (resolveRoleForIdentity throws — NO fallback)", async () => {
    (resolveRoleForIdentity as Mock).mockRejectedValueOnce(
      new Error("identity tina: no role frontmatter"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/source has no role frontmatter/i);
    // writeMarkdownFileAtomic must NOT have been called
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
    // No DB insert past the source read (only the seeded source row remains)
    expect(dbState.rows.length).toBe(1);
    expect(dbState.rows[0].identityKey).toBe("tina");
  });

  it("Test 7: newName already exists on target host → 409", async () => {
    // Override existence probe to return "exists"
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("if [ -d")) return "exists";
      if (cmd.includes("echo $HOME")) return "/home/ubuntu";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/identity exists on host/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
    // Only the seeded source row remains — no clone insert
    expect(dbState.rows.length).toBe(1);
    // conn.end() still fires (try/finally)
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 8: happy path with avatarCandidateId — 201, DB insert with narrow row + safe-default publicIdentity + seed-comment stub", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-2",
        title: "Cloned Op",
        voice: "Nathan.wav",
        avatarCandidateId: "cand-abc",
        path: "~",
      }),
    });

    expect(res.status).toBe(201);
    const body = res.body as {
      id: string;
      identityKey: string;
      displayName: string;
      title: string | null;
      colorHue: number | null;
      voice: string | null;
      avatarUrl: string;
      avatarMime: string;
      avatarEtag: string;
      coordinator: boolean;
    };
    expect(body.identityKey).toBe("tina-2");
    // Phase 66 Plan 04: publicIdentity uses the safe-defaults contract
    // (moved from Plan 05 to Plan 03 per checker B2). displayName falls
    // back to capitalizeFirst(identityKey); title/colorHue/voice go null;
    // avatarMime/avatarEtag go "" — cosmetics are disk-authoritative and
    // this endpoint does not disk-read (clone returns immediately post-
    // insert). Frontend Identity type's non-nullable-string contract is
    // satisfied via the "" defaults.
    expect(body.displayName).toBe("Tina-2");
    expect(body.title).toBeNull();
    expect(body.voice).toBeNull();
    expect(body.colorHue).toBeNull();
    expect(body.avatarMime).toBe("");
    expect(body.avatarEtag).toBe("");
    expect(body.avatarUrl).toBe(`/identities/${body.id}/avatar`);
    expect(body.id).toBeTruthy();
    // Phase 67 /close 2026-09-01 follow-up (H2): clone-local publicIdentity
    // must emit `coordinator: false` to satisfy the frontend Identity type's
    // non-nullable coordinator field. Freshly-cloned identities are never
    // coordinators (coordinator lives in on-disk YAML — a fresh clone has
    // no such YAML yet).
    expect(body.coordinator).toBe(false);

    // DB assertions — new row inserted alongside the source row. Store shape
    // is narrowed to the 5 surviving columns; NO cosmetic asserts remain.
    expect(dbState.rows.length).toBe(2);
    const newRow = dbState.rows.find((r) => r.identityKey === "tina-2");
    expect(newRow).toBeDefined();
    expect(newRow!.userId).toBe("1");
    expect(newRow!.id).toBeTruthy();
    expect(newRow!.createdAt).toBeTruthy();
    expect(newRow!.updatedAt).toBeTruthy();
    // No displayName/title/colorHue/voice/avatarMime/avatarData/avatarEtag
    // on the row — those keys are gone from the drizzle schema (Task 1).
    expect((newRow as unknown as Record<string, unknown>).avatarData).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).colorHue).toBeUndefined();

    // SSH assertions — mkdir + touch + writeMarkdownFileAtomic
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    // Existence probe fires
    expect(execCalls.some((c) => c.includes("if [ -d"))).toBe(true);
    // mkdir for new identity dir + wakeups
    expect(execCalls.some((c) => c.includes(`mkdir`) && c.includes("tina-2"))).toBe(true);
    // touch handoff.md
    expect(execCalls.some((c) => c.includes("touch") && c.includes("handoff.md"))).toBe(true);
    // NO relay-register per REVISION 2026-08-04 (Ashley: no SSH register from Skynet)
    // Assert none of the exec commands look like a relay-register curl
    for (const cmd of execCalls) {
      expect(cmd).not.toMatch(/matrix|_matrix\/client|register|thenasty|homeserver/i);
    }

    // writeMarkdownFileAtomic called with expected target + seed comment body
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const writeArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(writeArgs[1]).toBe("/home/ubuntu/.claude/identities/tina-2/tina-2.md");

    const stubBody = writeArgs[2] as string;
    // (a) Positive assertions: role frontmatter present + full cosmetic
    //     frontmatter emitted per Phase 66 /close 2026-09-01 follow-up.
    //     role must come first (id-skill invariant).
    expect(stubBody).toMatch(/^---\nrole: box-maintainer\n/);
    expect(stubBody).toContain("displayName: Tina-2"); // capitalized newName
    expect(stubBody).toContain("title: Cloned Op"); // user-supplied title
    expect(stubBody).toContain("voice: Nathan.wav"); // user-supplied voice
    expect(stubBody).toContain("avatar: tina-2.png"); // ext from candidate mime
    // colorHue is absent when the request body omits it (Test 8 doesn't send)
    expect(stubBody).not.toContain("colorHue:");
    // (b) Positive assertions: seed comment phrases present (REVISION 2026-08-04)
    expect(stubBody).toContain("This identity has no relay account yet");
    expect(stubBody).toContain("On first wake");
    expect(stubBody).toContain("register a Matrix relay account");
    expect(stubBody).toContain("remove this comment");
    // (c) NO "Skynet" (case-insensitive)
    expect(stubBody).not.toMatch(/skynet/i);
    // (d) NO id-skill references (case-insensitive)
    expect(stubBody).not.toMatch(/§2|§3|id skill|SKILL\.md/i);
    // (e) name + source-key reference present
    expect(stubBody).toContain("tina-2");
    expect(stubBody).toContain("tina");
    // (f) writeAvatarSiblingFile fired with the candidate ext + bytes
    expect(writeAvatarSiblingFile).toHaveBeenCalledTimes(1);
    const avatarWriteArgs = (writeAvatarSiblingFile as Mock).mock.calls[0];
    expect(avatarWriteArgs[1]).toBe("tina-2"); // identityKey
    expect(avatarWriteArgs[2]).toBe("png"); // ext derived from candidate mime

    // Candidate consumed. Patch #316 (2026-08-04) made userId a string across
    // the birth+clone flows; consumeCandidateForBirth receives the string form.
    expect(consumeCandidateForBirth).toHaveBeenCalledWith("1", "cand-abc");

    // quick-260806-dwe: startHarnessOnIdentity was called EXACTLY once with the
    // new session's name + normalized remotePath. It must be invoked AFTER the
    // tmux new-session exec (ordering invariant — the harness can only start on
    // an already-created tmux session).
    expect(mockStartHarness).toHaveBeenCalledTimes(1);
    expect(mockStartHarness).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tina-2",
        remotePath: expect.any(String),
      }),
    );
    const provisionCallIdx = (execCommand as Mock).mock.calls.findIndex(
      (c) =>
        typeof c[1] === "string" &&
        (c[1] as string).includes("tmux new-session"),
    );
    expect(provisionCallIdx).toBeGreaterThanOrEqual(0);
    const provisionInvocation = (execCommand as Mock).mock.invocationCallOrder[
      provisionCallIdx
    ];
    const harnessInvocation = mockStartHarness.mock.invocationCallOrder[0];
    expect(harnessInvocation).toBeGreaterThan(provisionInvocation);

    // Cleanup — conn.end() fired in finally
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 8b: happy path with colorHue AND voice omitted — frontmatter includes colorHue, omits voice + avatar (Phase 66 /close 2026-09-01 follow-up)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-b",
        title: "Cloned Op",
        voice: null,
        colorHue: 216,
        avatarCandidateId: null,
        path: "~",
      }),
    });

    expect(res.status).toBe(201);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    // role + displayName + title + colorHue present
    expect(stubBody).toMatch(/^---\nrole: box-maintainer\n/);
    expect(stubBody).toContain("displayName: Tina-b");
    expect(stubBody).toContain("title: Cloned Op");
    expect(stubBody).toContain("colorHue: 216");
    // voice + avatar absent (omit-if-absent rule)
    expect(stubBody).not.toContain("voice:");
    expect(stubBody).not.toContain("avatar:");
    // writeAvatarSiblingFile NOT called when no candidate provided
    expect(writeAvatarSiblingFile).not.toHaveBeenCalled();
  });

  it("Test 8c: colorHue validation — reject out-of-range or non-integer", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-c",
        title: "Cloned Op",
        voice: null,
        colorHue: 400, // out of range
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/colorHue/i);
  });

  it("Test 9: WITHOUT avatarCandidateId — inserts narrow row (no avatar-copy from source; cosmetics live on disk)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-3",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });

    expect(res.status).toBe(201);
    // Candidate cache lookup should NOT have been called
    expect(getCandidateForBirth).not.toHaveBeenCalled();
    expect(consumeCandidateForBirth).not.toHaveBeenCalled();

    // Phase 66 Plan 04: the store row is narrowed to 5 columns; the clone
    // handler no longer copies avatarData/avatarMime/etag/colorHue from
    // source. Those values live on disk (source's identity file is copied
    // separately via the fleet-standard on-disk workflow — orthogonal to
    // this endpoint). The insertRow is just the 5 surviving columns.
    const newRow = dbState.rows.find((r) => r.identityKey === "tina-3");
    expect(newRow).toBeDefined();
    expect(newRow!.userId).toBe("1");
    expect(newRow!.identityKey).toBe("tina-3");
    // No cosmetic keys on the row at all
    expect((newRow as unknown as Record<string, unknown>).avatarData).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).avatarMime).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).colorHue).toBeUndefined();
  });

  it("Test 10: SSH connect failure → 502; DB row NOT inserted", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 5000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(502);
    // Only the seeded source row remains — no clone insert
    expect(dbState.rows.length).toBe(1);
    expect(dbState.rows[0].identityKey).toBe("tina");
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 11: missing JWT → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone1",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 12: multipart requests rejected — endpoint only accepts application/json (415)", async () => {
    const boundary = "----boundary-test-42";
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="sourceIdentityKey"\r\n\r\n` +
      `tina\r\n` +
      `--${boundary}--\r\n`;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
    });
    expect(res.status).toBe(415);
    expect((res.body as { error: string }).error).toMatch(/application\/json|json body/i);
    // Never reaches the SSH path
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 13: newName already exists in DB for this user → 409 BEFORE any SSH work", async () => {
    // Seed a second identity row for the same user with the target newName.
    // Precheck (step 2b) must catch this and return 409 without touching SSH.
    dbState.rows.push({
      ...stubSourceRow,
      id: "existing-collision-id",
      identityKey: "patty",
      displayName: "patty",
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "patty",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/already in use/i);
    // Precheck short-circuits before any SSH primitive fires
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
    // No insert happened — still just source + seeded collision row
    expect(dbState.rows.length).toBe(2);
  });

  it("Test 14: missing path → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone-nopath",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        // no path field
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/path is required/i);
    // Path validation runs BEFORE any SSH work
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("Test 15: empty-string path → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "clone-emptypath",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "   ",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/path is required/i);
  });

  it("Test 16: mkdir -p AND tmux new-session fire with the given path (tilde expanded to $HOME)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-mkdir",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~/foo/bar",
      }),
    });
    expect(res.status).toBe(201);
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    // "~/foo/bar" normalizes to "$HOME/foo/bar" and is left UNQUOTED so the
    // remote shell expands $HOME. Assert both mkdir and tmux new-session are
    // in the same provisioning exec (single round-trip, matches birth's step 2).
    const provisionExec = execCalls.find(
      (c) => c.includes("mkdir -p $HOME/foo/bar") && c.includes("tmux new-session"),
    );
    expect(provisionExec).toBeDefined();
    expect(provisionExec).toContain("tmux new-session -d -s tina-mkdir -c $HOME/foo/bar");
    // has-session gate for idempotency
    expect(provisionExec).toContain("tmux has-session -t tina-mkdir");
  });

  it("Test 17: absolute path → mkdir -p AND tmux new-session are single-quoted for injection safety", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-abs",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "/opt/projects/thing",
      }),
    });
    expect(res.status).toBe(201);
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    const provisionExec = execCalls.find(
      (c) => c.includes("mkdir -p '/opt/projects/thing'") && c.includes("tmux new-session"),
    );
    expect(provisionExec).toBeDefined();
    expect(provisionExec).toContain("tmux new-session -d -s tina-abs -c '/opt/projects/thing'");
  });

  it("Test 18: startHarnessOnIdentity rejection → 502 AND DB insert does NOT run [260806-dwe]", async () => {
    // The helper's failure surface widens the clone endpoint's 502 case: any
    // rejection during the ~25s harness-start dance (trust-flag write, claude
    // launch, Enter train, /id) now returns 502 "SSH exec failed" — same
    // class as an mkdir failure, so the frontend's error UX is unchanged.
    // Critically, the DB insert must NOT run when the harness fails: a
    // half-state ("identity registered but harness dead") would leave the
    // sidebar with a row whose pretty-view shows "no active Claude session"
    // and no clean recovery path (Ashley's Rule: never leave the fleet in an
    // observable half-state).
    mockStartHarness.mockRejectedValueOnce(new Error("harness send-keys failed"));

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/clone",
      body: JSON.stringify({
        sourceIdentityKey: "tina",
        hostId: 5,
        newName: "tina-harnessfail",
        title: "Cloned Op",
        voice: null,
        avatarCandidateId: null,
        path: "~",
      }),
    });

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("SSH exec failed");

    // No DB row for the failed clone — only the seeded source row remains.
    expect(dbState.rows.length).toBe(1);
    expect(dbState.rows.filter((r) => r.identityKey === "tina-harnessfail")).toEqual([]);

    // writeMarkdownFileAtomic must NOT have been called — SFTP identity-file
    // write is downstream of harness-start in the endpoint's ordering.
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();

    // conn.end() still fires in the outer finally — connection cleanup is
    // best-effort and unconditional.
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });
});
