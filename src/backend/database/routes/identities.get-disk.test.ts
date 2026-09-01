/**
 * Phase 66 Plan 66-03 (READ — disk-derived cosmetics flip): Tests for the
 * flipped GET /identities and GET /identities/:id/avatar handlers.
 *
 * Post-flip contract (see .planning/phases/66-.../66-03-PLAN.md):
 *
 * ─── GET /identities ─────────────────────────────────────────────────────
 * Optional query `identityHosts` = URL-encoded JSON `{ identityKey: hostId }`
 * map. For each store row:
 *   - If identityKey is IN the map: attempt to read <key>.md via the
 *     artifact-reader on that hostId's box (isLocalHostId LOCAL/REMOTE
 *     split; connectOneShot for REMOTE). Overlay cosmetics from the parsed
 *     frontmatter onto publicIdentity(). Failures (unreachable / missing
 *     frontmatter / bad YAML) → row returned with SAFE-DEFAULT cosmetics
 *     for that row only (accept-the-ugly-render per Ashley's greenlight;
 *     endpoint never errors 5xx for a per-row fetch failure).
 *   - If identityKey is NOT in the map: row returned with SAFE-DEFAULT
 *     cosmetics — displayName = capitalizeFirst(identityKey); title/
 *     colorHue/voice = null; avatarMime = "" ; avatarEtag = "".
 *     (Plan 05 will thread identityHosts populated from fleetSessions;
 *     transition-window degradation is deliberate.)
 *
 * ─── GET /identities/:id/avatar ──────────────────────────────────────────
 * Required query `hostId=<positive int>`. Reads sibling avatar file from
 * disk via readAvatarSiblingFile:
 *   - Success → 200 with Content-Type = readResult.mime; body = bytes;
 *     ETag = "disk-<md5>" (per-response; not stored server-side).
 *   - Null result → 404 { error: "no avatar on disk for this identity" }.
 *   - SSH throw → 502 { error: "identity home box unreachable" }.
 *   - Missing/invalid hostId query → 400.
 *   - LOCAL branch (isLocalHostId=true) → conn=null; connectOneShot NEVER
 *     called; readAvatarSiblingFile called with conn=null.
 *
 * ─── publicIdentity() safe-defaults (moved from Plan 05 per checker B2) ──
 * Emits safe non-null defaults for the frontend Identity type's non-nullable-
 * string fields (displayName/avatarMime/avatarEtag) when disk-overlay is
 * absent — matches the wire type contract without widening it.
 *
 * Test surface: 8 tests
 *   1  Happy path GET / — full map, both rows overlay from disk, third row
 *      has no hostId supplied → safe-defaults for that row.
 *   2  Unreachable box scoped to row — nelly's connectOneShot rejects;
 *      tina's LOCAL branch works; both rows in 200 response, nelly safe-def.
 *   3  Missing-frontmatter fixture ("unreachable-test") → row returned with
 *      safe-default cosmetics. 200, no error on whole endpoint.
 *   4  GET /:id/avatar happy path: 200 + Content-Type + body bytes match.
 *   5  GET /:id/avatar disk-empty → 404.
 *   6  GET /:id/avatar SSH-fail → 502.
 *   7  GET /:id/avatar missing hostId → 400.
 *   8  GET /:id/avatar LOCAL branch → connectOneShot NEVER called.
 *
 * Scaffold: mirrors identities.put-disk.test.ts (bare Express + Node http.request,
 * vi.mock db chain, vi.mock artifact-reader, vi.mock ssh-one-shot,
 * vi.mock host-resolver, in-memory identities table).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Auth manager mock — always authenticates as "test-user"
// ---------------------------------------------------------------------------

let mockUserId: string | null = "test-user";

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

vi.mock("nanoid", () => ({ nanoid: () => "nano-generated-id" }));

// ---------------------------------------------------------------------------
// In-memory identities table shim
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: identities row narrowed to 5 surviving columns.
// The stale-store cosmetic seed values Test 1 previously used are gone —
// publicIdentity() no longer reads them from the row; it either overlays
// from the disk-read cosmetics map or emits the safe-default contract.
type IdentityRow = {
  id: string;
  userId: string;
  identityKey: string;
  createdAt: string;
  updatedAt: string;
};

const dbState: {
  identities: IdentityRow[];
  lastFilter: { id?: string; userId?: string };
} = { identities: [], lastFilter: {} };

let filterAccum: { id?: string; userId?: string } = {};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string }, val: unknown) => {
    if (col._colName === "userId") filterAccum.userId = val as string;
    else if (col._colName === "id") filterAccum.id = val as string;
    return { __type: "eq", col: col._colName, val };
  },
  and: (...conds: unknown[]) => ({ __type: "and", conds }),
}));

// Phase 66 Plan 04: schema mock narrowed to 5 surviving columns.
vi.mock("../db/schema.js", () => ({
  identities: {
    id: { _colName: "id" },
    userId: { _colName: "userId" },
    identityKey: { _colName: "identityKey" },
    createdAt: { _colName: "createdAt" },
    updatedAt: { _colName: "updatedAt" },
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
      return dbState.identities.filter((r) => {
        if (f.userId !== undefined && r.userId !== f.userId) return false;
        if (f.id !== undefined && r.id !== f.id) return false;
        return true;
      });
    },
    insert: () => chain,
    values: () => chain,
    update: () => chain,
    set: () => chain,
    delete: () => chain,
    run: () => { filterAccum = {}; },
  };
  return { db: chain };
});

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn().mockResolvedValue(undefined) },
}));

// ---------------------------------------------------------------------------
// Artifact-reader mock
// ---------------------------------------------------------------------------

const readIdentityFileMock = vi.fn();
const readAvatarSiblingFileMock = vi.fn();
const isLocalHostIdMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: (conn: unknown, key: string) => readIdentityFileMock(conn, key),
  writeIdentityFile: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  readAvatarSiblingFile: (conn: unknown, key: string) =>
    readAvatarSiblingFileMock(conn, key),
  isLocalHostId: (n: number | undefined) => isLocalHostIdMock(n),
  getLocalIdentitiesRoot: () => "/tmp/test-identities",
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  },
  AVATAR_MIME_FROM_EXT: {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
  },
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  extractRoleFromMarkdown: (markdown: string): string | null => {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    try {
      const parsed = yaml.load(match[1]) as Record<string, unknown> | null;
      if (parsed === null || typeof parsed !== "object") return null;
      const role = parsed.role;
      return typeof role === "string" && role.length > 0 ? role : null;
    } catch {
      return null;
    }
  },
  extractCosmeticsFromFrontmatter: (markdown: string) => {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    let parsed: unknown;
    try { parsed = yaml.load(match[1]); } catch { return {}; }
    if (parsed === null || typeof parsed !== "object") return {};
    const src = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof src.displayName === "string" && src.displayName.length > 0) out.displayName = src.displayName;
    if (typeof src.title === "string" && src.title.length > 0) out.title = src.title;
    if (typeof src.colorHue === "number" && src.colorHue >= 0 && src.colorHue <= 359) out.colorHue = src.colorHue;
    if (typeof src.voice === "string" && src.voice.length > 0) out.voice = src.voice;
    if (typeof src.avatar === "string" && src.avatar.length > 0) out.avatar = src.avatar;
    return out;
  },
}));

// ---------------------------------------------------------------------------
// SSH mocks
// ---------------------------------------------------------------------------

const connectOneShotMock = vi.fn();

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: (host: unknown, timeoutMs: number) => connectOneShotMock(host, timeoutMs),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn().mockResolvedValue({
    ip: "10.0.0.5", port: 22, username: "ubuntu", authType: "key", key: "fake-key",
  }),
}));

function makeFakeConnWithEnd() {
  return { __fake: "ssh-conn", end: vi.fn() };
}

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import identitiesRouter from "./identities.js";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders; rawBody: Buffer }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "GET", path },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          const text = rawBody.toString();
          let parsed: unknown = text;
          const ct = res.headers["content-type"] || "";
          if (typeof ct === "string" && ct.includes("application/json")) {
            try { parsed = JSON.parse(text); } catch { /* leave as text */ }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers, rawBody });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;

// Phase 66 Plan 04: rows narrow to the 5 surviving columns. The stale-store
// cosmetic values that Plan 03 tests used to prove "response ignores store
// cosmetics" no longer exist anywhere in the codebase — the store shim
// couldn't hold them if it wanted to.
function seedThreeRows() {
  dbState.identities = [
    {
      id: "tina-id",
      userId: "test-user",
      identityKey: "tina",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "nelly-id",
      userId: "test-user",
      identityKey: "nelly",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "unreachable-id",
      userId: "test-user",
      identityKey: "unreachable-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  seedThreeRows();
  filterAccum = {};

  // Default mocks
  readIdentityFileMock.mockResolvedValue({ markdown: "" });
  readAvatarSiblingFileMock.mockResolvedValue(null);
  isLocalHostIdMock.mockReturnValue(false);
  connectOneShotMock.mockResolvedValue(makeFakeConnWithEnd());

  const app = express();
  app.use("/identities", identitiesRouter);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ===========================================================================
// Tests
// ===========================================================================

describe("GET /identities — disk-derived cosmetics (Phase 66 Plan 66-03)", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy path — full identityHosts map, mixed disk-overlay + safe-def
  // -------------------------------------------------------------------------
  it("Test 1: identityHosts={tina:1,nelly:5} → tina full disk-overlay, nelly partial disk-overlay + nulls, unreachable-test safe-defaults", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);

    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      if (key === "tina") {
        return Promise.resolve({
          markdown:
            "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: The Coder\ncolorHue: 220\nvoice: Elena.wav\navatar: tina.png\n---\n",
        });
      }
      if (key === "nelly") {
        // 3 of 5 present — colorHue + voice absent
        return Promise.resolve({
          markdown:
            "---\nrole: box-maintainer\ndisplayName: Nelly\ntitle: The Fleet Warden\navatar: nelly.webp\n---\n",
        });
      }
      return Promise.resolve({ markdown: "" });
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, nelly: 5 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);

    const tina = rows.find((r) => r.identityKey === "tina") as Record<string, unknown>;
    const nelly = rows.find((r) => r.identityKey === "nelly") as Record<string, unknown>;
    const ut = rows.find((r) => r.identityKey === "unreachable-test") as Record<string, unknown>;

    // Tina: full disk-overlay
    expect(tina.displayName).toBe("Tina");
    expect(tina.title).toBe("The Coder");
    expect(tina.colorHue).toBe(220);
    expect(tina.voice).toBe("Elena.wav");

    // Nelly: partial disk-overlay (displayName + title from disk; colorHue+voice null)
    expect(nelly.displayName).toBe("Nelly");
    expect(nelly.title).toBe("The Fleet Warden");
    expect(nelly.colorHue).toBeNull();
    expect(nelly.voice).toBeNull();

    // unreachable-test: no hostId in map → SAFE-DEFAULTS
    expect(ut.displayName).toBe("Unreachable-test"); // capitalizeFirst
    expect(ut.title).toBeNull();
    expect(ut.colorHue).toBeNull();
    expect(ut.voice).toBeNull();
    expect(ut.avatarMime).toBe(""); // non-nullable string safe-default
    expect(ut.avatarEtag).toBe(""); // non-nullable string safe-default
  });

  // -------------------------------------------------------------------------
  // Test 2: unreachable box scoped to row — nelly connect fails, tina works
  // -------------------------------------------------------------------------
  it("Test 2: nelly's connectOneShot rejects → tina disk-overlay + nelly safe-defaults; 200 (not 502)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1); // tina=LOCAL, nelly=REMOTE

    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      if (key === "tina") {
        return Promise.resolve({
          markdown:
            "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: The Coder\ncolorHue: 220\nvoice: Elena.wav\navatar: tina.png\n---\n",
        });
      }
      // Nelly should not be READ — the SSH connect fails first, so this
      // branch only fires if the caller misroutes.
      return Promise.resolve({ markdown: "" });
    });

    connectOneShotMock.mockRejectedValue(new Error("Host unreachable"));

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, nelly: 5 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200); // NOT 502 — per-row degradation
    const rows = res.body as Array<Record<string, unknown>>;
    const tina = rows.find((r) => r.identityKey === "tina") as Record<string, unknown>;
    const nelly = rows.find((r) => r.identityKey === "nelly") as Record<string, unknown>;

    expect(tina.displayName).toBe("Tina");
    expect(tina.title).toBe("The Coder");

    // Nelly: SAFE-DEFAULTS (SSH connect failed for this row only)
    expect(nelly.displayName).toBe("Nelly"); // capitalizeFirst
    expect(nelly.title).toBeNull();
    expect(nelly.colorHue).toBeNull();
    expect(nelly.voice).toBeNull();
    expect(nelly.avatarMime).toBe("");
    expect(nelly.avatarEtag).toBe("");
  });

  // -------------------------------------------------------------------------
  // Test 3: unreachable-test-fixture missing folder — empty markdown → safe-def
  // -------------------------------------------------------------------------
  it("Test 3: identityHosts={unreachable-test:7} + readIdentityFile returns empty → safe-defaults for that row; 200", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      if (key === "unreachable-test") return Promise.resolve({ markdown: "" });
      return Promise.resolve({ markdown: "" });
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ "unreachable-test": 7 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    const ut = rows.find((r) => r.identityKey === "unreachable-test") as Record<string, unknown>;
    expect(ut.displayName).toBe("Unreachable-test"); // capitalizeFirst
    expect(ut.title).toBeNull();
    expect(ut.colorHue).toBeNull();
    expect(ut.voice).toBeNull();
    expect(ut.avatarMime).toBe("");
    expect(ut.avatarEtag).toBe("");
  });
});

describe("GET /identities/:id/avatar — disk-derived (Phase 66 Plan 66-03)", () => {
  // -------------------------------------------------------------------------
  // Test 4: happy path
  // -------------------------------------------------------------------------
  it("Test 4: identityId=tina + hostId=1 + readAvatarSiblingFile returns PNG bytes → 200 + Content-Type + body bytes + Cache-Control: no-store", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    const pngBytes = Buffer.from("PNGDATA");
    readAvatarSiblingFileMock.mockResolvedValue({ bytes: pngBytes, mime: "image/png", ext: "png" });

    const res = await httpGet(server, `/identities/tina-id/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawBody.equals(pngBytes)).toBe(true);
    // Every render on every viewer reaches the identity's home for the current
    // bytes — no browser caching (Ashley /close 2026-09-01).
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // -------------------------------------------------------------------------
  // Test 5: disk-empty → 404
  // -------------------------------------------------------------------------
  it("Test 5: readAvatarSiblingFile returns null → 404 with 'no avatar' error", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readAvatarSiblingFileMock.mockResolvedValue(null);

    const res = await httpGet(server, `/identities/tina-id/avatar?hostId=1`);

    expect(res.status).toBe(404);
    const body = res.body as { error?: string };
    expect(body.error).toBeDefined();
    expect(body.error?.toLowerCase()).toContain("no avatar");
  });

  // -------------------------------------------------------------------------
  // Test 6: SSH-fail → 502
  // -------------------------------------------------------------------------
  it("Test 6: readAvatarSiblingFile throws → 502 'identity home box unreachable'", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readAvatarSiblingFileMock.mockRejectedValue(new Error("remote exec timeout"));

    const res = await httpGet(server, `/identities/tina-id/avatar?hostId=1`);

    expect(res.status).toBe(502);
    const body = res.body as { error?: string };
    expect(body.error).toBe("identity home box unreachable");
  });

  // -------------------------------------------------------------------------
  // Test 7: missing hostId → 400
  // -------------------------------------------------------------------------
  it("Test 7: missing ?hostId query → 400 with 'hostId' error message", async () => {
    const res = await httpGet(server, `/identities/tina-id/avatar`);

    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error).toBeDefined();
    expect(body.error?.toLowerCase()).toContain("hostid");
    expect(readAvatarSiblingFileMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: LOCAL branch → connectOneShot never called
  // -------------------------------------------------------------------------
  it("Test 8: LOCAL branch (isLocalHostId=true) → connectOneShot NEVER called; readAvatarSiblingFile called with conn=null", async () => {
    isLocalHostIdMock.mockReturnValue(true);
    const pngBytes = Buffer.from("LOCALDATA");
    readAvatarSiblingFileMock.mockResolvedValue({ bytes: pngBytes, mime: "image/png", ext: "png" });

    const res = await httpGet(server, `/identities/tina-id/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAvatarSiblingFileMock).toHaveBeenCalledTimes(1);
    expect(readAvatarSiblingFileMock.mock.calls[0][0]).toBeNull();
  });
});
