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
  resolveRoleForIdentity: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

vi.mock("./identity-avatar-batch.js", () => ({
  getCandidateForBirth: vi.fn(),
  consumeCandidateForBirth: vi.fn(),
  default: express.Router(),
}));

// ---------------------------------------------------------------------------
// In-memory DB shim — mirrors the drizzle chain surface the route uses.
// State is reset per-test via beforeEach so cross-test isolation holds.
// ---------------------------------------------------------------------------

type IdentityRow = {
  id: string;
  userId: string;
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  avatarMime: string;
  avatarData: Buffer;
  avatarEtag: string;
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
  resolveRoleForIdentity,
} from "../../claude-session/identity-artifact-reader.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";

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

const sourceAvatarBytes = Buffer.from("source-avatar-bytes-verbatim");

const stubSourceRow: IdentityRow = {
  id: "src-id-nano",
  userId: "1",
  identityKey: "tina",
  displayName: "tina",
  title: "Fleet Operator",
  colorHue: 128,
  voice: "Elena.wav",
  avatarMime: "image/png",
  avatarData: sourceAvatarBytes,
  avatarEtag: "src-etag-md5",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Import router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./identity-clone.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();
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

  it("Test 8: happy path with avatarCandidateId — 201, DB insert with locked colorHue, seed-comment stub", async () => {
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
      avatarEtag: string;
    };
    expect(body.identityKey).toBe("tina-2");
    expect(body.displayName).toBe("tina-2");
    expect(body.title).toBe("Cloned Op");
    expect(body.voice).toBe("Nathan.wav");
    // colorHue is LOCKED to source (user cannot edit — REVISION locked field)
    expect(body.colorHue).toBe(128);
    expect(body.avatarUrl).toBe(`/identities/${body.id}/avatar`);
    expect(body.id).toBeTruthy();

    // DB assertions — new row inserted alongside the source row
    expect(dbState.rows.length).toBe(2);
    const newRow = dbState.rows.find((r) => r.identityKey === "tina-2");
    expect(newRow).toBeDefined();
    expect(newRow!.userId).toBe("1");
    expect(newRow!.displayName).toBe("tina-2");
    expect(newRow!.title).toBe("Cloned Op");
    expect(newRow!.voice).toBe("Nathan.wav");
    expect(newRow!.colorHue).toBe(128);
    expect(newRow!.avatarMime).toBe("image/png");
    // avatarData is the candidate's bytes (not source's)
    expect(newRow!.avatarData.equals(Buffer.from("candidate-avatar-bytes"))).toBe(true);
    // avatarEtag is a fresh md5 of the candidate bytes
    expect(newRow!.avatarEtag).toBeTruthy();
    expect(newRow!.avatarEtag).not.toBe("src-etag-md5");

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
    // (a) Positive assertions: role frontmatter present
    expect(stubBody).toMatch(/^---\nrole: box-maintainer\n---/);
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

    // Candidate consumed. Patch #316 (2026-08-04) made userId a string across
    // the birth+clone flows; consumeCandidateForBirth receives the string form.
    expect(consumeCandidateForBirth).toHaveBeenCalledWith("1", "cand-abc");

    // Cleanup — conn.end() fired in finally
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 9: WITHOUT avatarCandidateId — clone uses source's avatarData buffer verbatim", async () => {
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
      }),
    });

    expect(res.status).toBe(201);
    // Candidate cache lookup should NOT have been called
    expect(getCandidateForBirth).not.toHaveBeenCalled();
    expect(consumeCandidateForBirth).not.toHaveBeenCalled();

    // New row's avatarData deep-equals source's buffer
    const newRow = dbState.rows.find((r) => r.identityKey === "tina-3");
    expect(newRow).toBeDefined();
    expect(newRow!.avatarData.equals(sourceAvatarBytes)).toBe(true);
    expect(newRow!.avatarMime).toBe("image/png");
    // colorHue still locked to source
    expect(newRow!.colorHue).toBe(128);
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
});
