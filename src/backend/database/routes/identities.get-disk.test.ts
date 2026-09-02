/**
 * Phase 68 Plan 68-02 Task 2: Tests for the rewired GET /identities fanout handler
 * and GET /identities/:identityKey/avatar handler.
 *
 * POST Phase 68-02 contract:
 *
 * ─── GET /identities (fanout) ─────────────────────────────────────────────────
 * No DB SELECT. Fans out per unique hostId from identityHosts query param:
 *   - listIdentityKeysOnHost(conn) per host to enumerate folder names.
 *   - readIdentityFile(conn, key) per key to read cosmetics.
 *   - extractCosmeticsFromFrontmatter + extractRoleFromMarkdown → publicIdentity().
 *   - Per-host silent-swallow on error (no 5xx, no crash).
 *   - First-host-wins on cross-host identityKey collision.
 *   - Empty identityHosts → [].
 *
 * ─── publicIdentity() shape (Phase 68) ──────────────────────────────────────
 * Takes (identityKey, hostId, cosmetics, role). Returns 10 fields:
 *   identityKey, displayName, title, colorHue, voice, avatarMime, avatarUrl,
 *   avatarEtag, coordinator, role.
 * DROPPED: id, createdAt, updatedAt.
 * avatarUrl = `/identities/${identityKey}/avatar?hostId=${hostId}`.
 *
 * ─── GET /identities/:identityKey/avatar ─────────────────────────────────────
 * Route rekeyed from /:id to /:identityKey. No DB row lookup. Uses the URL
 * param directly with readAvatarSiblingFile. Same 404/502/400 contract as before.
 *
 * Test surface: 6 fanout tests + direct publicIdentity unit tests + 5 avatar tests
 *   Fanout (a)  single host, 2 identities on disk → 2 in response, hostId baked in avatarUrl
 *   Fanout (b)  two hosts, 3+2 identities → 5 in response, correct hostId per identity
 *   Fanout (c)  unreachable host (listIdentityKeysOnHost throws) → that host absent, survivor present
 *   Fanout (d)  cross-host collision on identityKey "tina" → first-host-wins
 *   Fanout (e)  empty identityHosts map → []
 *   Fanout (f)  host reachable but empty folder (listIdentityKeysOnHost returns []) → 0 identities
 *
 *   Avatar (1)  happy path: 200 + Content-Type + body bytes + Cache-Control: no-store
 *   Avatar (2)  readAvatarSiblingFile returns null → 404
 *   Avatar (3)  readAvatarSiblingFile throws → 502
 *   Avatar (4)  missing hostId → 400
 *   Avatar (5)  LOCAL branch → connectOneShot NEVER called
 *
 * Scaffold: bare Express + Node http.request, vi.mock on artifact-reader, ssh-one-shot,
 * host-resolver, tmux-helper. DB mocks kept minimal (POST / still uses DB; GET / does not).
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
// In-memory identities table shim (kept for POST / which still uses DB)
// ---------------------------------------------------------------------------

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
// Artifact-reader mock — includes listIdentityKeysOnHost (Phase 68 new export)
// ---------------------------------------------------------------------------

const readIdentityFileMock = vi.fn();
const readAvatarSiblingFileMock = vi.fn();
const isLocalHostIdMock = vi.fn();
const listIdentityKeysOnHostMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: (conn: unknown, key: string) => readIdentityFileMock(conn, key),
  listIdentityKeysOnHost: (conn: unknown) => listIdentityKeysOnHostMock(conn),
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
    if (typeof src.coordinator === "boolean") out.coordinator = src.coordinator;
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

import identitiesRouter, { publicIdentity } from "./identities.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  dbState.identities = [];
  filterAccum = {};

  // Default mocks
  listIdentityKeysOnHostMock.mockResolvedValue([]);
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
// publicIdentity unit tests (Phase 68 shape: no id/createdAt/updatedAt)
// ===========================================================================

describe("publicIdentity — Phase 68 shape (no id/createdAt/updatedAt)", () => {
  it("PUB-1: emits identityKey, displayName, title, colorHue, voice, avatarMime, avatarUrl, avatarEtag, coordinator, role", () => {
    const out = publicIdentity("tina", 1, { displayName: "Tina", title: "Dev", colorHue: 220, voice: "Elena.wav", avatarMime: "image/png", avatarEtag: "abc", coordinator: true }, "box-maintainer");
    expect(out).toHaveProperty("identityKey", "tina");
    expect(out).toHaveProperty("displayName", "Tina");
    expect(out).toHaveProperty("title", "Dev");
    expect(out).toHaveProperty("colorHue", 220);
    expect(out).toHaveProperty("voice", "Elena.wav");
    expect(out).toHaveProperty("avatarMime", "image/png");
    expect(out).toHaveProperty("avatarUrl", "/identities/tina/avatar?hostId=1");
    expect(out).toHaveProperty("avatarEtag", "abc");
    expect(out).toHaveProperty("coordinator", true);
    expect(out).toHaveProperty("role", "box-maintainer");
    // DROPPED fields must NOT be present
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("createdAt");
    expect(out).not.toHaveProperty("updatedAt");
  });

  it("PUB-2: safe-defaults: no cosmetics → capitalizeFirst(identityKey) + nulls + empty strings", () => {
    const out = publicIdentity("poppy", 5, {}, null);
    expect(out.displayName).toBe("Poppy"); // capitalizeFirst
    expect(out.title).toBeNull();
    expect(out.colorHue).toBeNull();
    expect(out.voice).toBeNull();
    expect(out.avatarMime).toBe("");
    expect(out.avatarEtag).toBe("");
    expect(out.coordinator).toBe(false);
    expect(out.role).toBeNull();
    // hostId baked into avatarUrl
    expect(out.avatarUrl).toBe("/identities/poppy/avatar?hostId=5");
  });

  it("PUB-3: coordinator safe-default is false (not null, not undefined)", () => {
    const out = publicIdentity("tina", 1, {}, null);
    expect(out.coordinator).toBe(false);
    expect(out.coordinator).not.toBeNull();
    expect(out.coordinator).not.toBeUndefined();
  });

  it("PUB-4: no cosmetics argument → same as empty cosmetics", () => {
    const out = publicIdentity("moxie", 3);
    expect(out.coordinator).toBe(false);
    expect(out.avatarUrl).toBe("/identities/moxie/avatar?hostId=3");
  });
});

// ===========================================================================
// GET /identities — fanout enumeration (Phase 68)
// ===========================================================================

describe("GET /identities — disk-fanout enumeration (Phase 68 Plan 68-02)", () => {

  // -------------------------------------------------------------------------
  // Fanout (a): single host, 2 identities on disk
  // -------------------------------------------------------------------------
  it("Fanout-a: single host, 2 identities on disk → 2 in response with hostId baked in avatarUrl", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);

    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy"]);

    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      if (key === "tina") {
        return Promise.resolve({
          markdown: "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: The Coder\ncolorHue: 220\n---\n",
        });
      }
      if (key === "poppy") {
        return Promise.resolve({
          markdown: "---\nrole: box-maintainer\ndisplayName: Poppy\ntitle: The Warden\n---\n",
        });
      }
      return Promise.resolve({ markdown: "" });
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    const tina = rows.find((r) => r.identityKey === "tina") as Record<string, unknown>;
    const poppy = rows.find((r) => r.identityKey === "poppy") as Record<string, unknown>;

    expect(tina).toBeDefined();
    expect(tina.displayName).toBe("Tina");
    expect(tina.title).toBe("The Coder");
    expect(tina.colorHue).toBe(220);
    // avatarUrl must carry hostId=1
    expect(tina.avatarUrl).toBe("/identities/tina/avatar?hostId=1");
    // No id/createdAt/updatedAt
    expect(tina).not.toHaveProperty("id");
    expect(tina).not.toHaveProperty("createdAt");
    expect(tina).not.toHaveProperty("updatedAt");

    expect(poppy).toBeDefined();
    expect(poppy.displayName).toBe("Poppy");
    expect(poppy.avatarUrl).toBe("/identities/poppy/avatar?hostId=1");
  });

  // -------------------------------------------------------------------------
  // Fanout (b): two hosts, correct hostId per identity in avatarUrl
  // -------------------------------------------------------------------------
  it("Fanout-b: two hosts with different identities → all 5 in response, each with correct hostId in avatarUrl", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);

    // host 1 (LOCAL): tina, poppy, moxie
    // host 2 (REMOTE): nelly, zoey
    listIdentityKeysOnHostMock.mockImplementation((conn: unknown) => {
      if (conn === null) {
        // LOCAL host 1
        return Promise.resolve(["tina", "poppy", "moxie"]);
      }
      // REMOTE host 2
      return Promise.resolve(["nelly", "zoey"]);
    });

    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      return Promise.resolve({
        markdown: `---\nrole: box-maintainer\ndisplayName: ${key.charAt(0).toUpperCase() + key.slice(1)}\n---\n`,
      });
    });

    // identityHosts: tina→1, poppy→1, moxie→1, nelly→2, zoey→2
    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 1, moxie: 1, nelly: 2, zoey: 2 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);

    const tina = rows.find((r) => r.identityKey === "tina") as Record<string, unknown>;
    const nelly = rows.find((r) => r.identityKey === "nelly") as Record<string, unknown>;

    // host 1 identities get hostId=1 in avatarUrl
    expect(tina.avatarUrl).toBe("/identities/tina/avatar?hostId=1");
    // host 2 identities get hostId=2 in avatarUrl
    expect(nelly.avatarUrl).toBe("/identities/nelly/avatar?hostId=2");
  });

  // -------------------------------------------------------------------------
  // Fanout (c): unreachable host → that host's identities absent, survivor present
  // -------------------------------------------------------------------------
  it("Fanout-c: unreachable host (listIdentityKeysOnHost throws) → absent from result, other host present", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);

    listIdentityKeysOnHostMock.mockImplementation((conn: unknown) => {
      if (conn === null) {
        // LOCAL host 1: works
        return Promise.resolve(["tina"]);
      }
      // REMOTE host 2: SSH failure
      return Promise.reject(new Error("Host unreachable"));
    });

    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });

    // tina→1 (LOCAL, works), nelly→2 (REMOTE, fails)
    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, nelly: 2 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200); // NOT 5xx — per-host silent-swallow
    const rows = res.body as Array<Record<string, unknown>>;

    // Only tina (from host 1) present; nelly (from host 2) absent
    const tinaRow = rows.find((r) => r.identityKey === "tina");
    const nellyRow = rows.find((r) => r.identityKey === "nelly");

    expect(tinaRow).toBeDefined();
    expect(nellyRow).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Fanout (d): cross-host collision → first-host-wins
  // -------------------------------------------------------------------------
  it("Fanout-d: cross-host identityKey collision on 'tina' → first-host-wins (host 1)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);

    // Both host 1 and host 2 have "tina"
    listIdentityKeysOnHostMock.mockImplementation((conn: unknown) => {
      // Both LOCAL and REMOTE return tina
      return Promise.resolve(["tina"]);
    });

    readIdentityFileMock.mockImplementation((conn: unknown, key: string) => {
      if (key === "tina") {
        if (conn === null) {
          // host 1's tina
          return Promise.resolve({
            markdown: "---\nrole: box-maintainer\ndisplayName: Tina-Host1\n---\n",
          });
        }
        // host 2's tina
        return Promise.resolve({
          markdown: "---\nrole: box-maintainer\ndisplayName: Tina-Host2\n---\n",
        });
      }
      return Promise.resolve({ markdown: "" });
    });

    // Both tina→1 and tina→2 in the map — since identityHosts has unique keys,
    // only one "tina" key survives. Use two different keys pointing to same identity.
    // Actually for collision testing, we need the fanout to encounter the key on both hosts.
    // identityHosts is { tina: 1 } for host 1, but host 2 also has tina (uniqueHostIds=[1,2]).
    // We need uniqueHostIds to include both 1 and 2.
    // Use: { tina: 1, poppy: 2 } so uniqueHostIds = [1, 2].
    // Host 1 returns ["tina"]; host 2 ALSO returns ["tina"].
    // First-host-wins: tina from host 1.
    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 2 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;

    // Only ONE tina in the merged result (first-host-wins dedup)
    const tinaRows = rows.filter((r) => r.identityKey === "tina");
    expect(tinaRows).toHaveLength(1);
    // displayName from host 1 (LOCAL) since host 1 is enumerated first in uniqueHostIds
    expect(tinaRows[0].displayName).toBe("Tina-Host1");
    expect(tinaRows[0].avatarUrl).toBe("/identities/tina/avatar?hostId=1");
  });

  // -------------------------------------------------------------------------
  // Fanout (e): empty identityHosts map → []
  // -------------------------------------------------------------------------
  it("Fanout-e: empty identityHosts map → [] immediately, no host fanout", async () => {
    const res = await httpGet(server, `/identities?identityHosts=${encodeURIComponent("{}")}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<unknown>;
    expect(rows).toHaveLength(0);
    expect(listIdentityKeysOnHostMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Fanout (f): host reachable but empty folder → 0 identities from that host
  // -------------------------------------------------------------------------
  it("Fanout-f: host reachable but listIdentityKeysOnHost returns [] → 0 identities from that host", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    listIdentityKeysOnHostMock.mockResolvedValue([]); // empty folder

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 5 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<unknown>;
    expect(rows).toHaveLength(0);
    // listIdentityKeysOnHost was called (host is reachable), but returned []
    expect(listIdentityKeysOnHostMock).toHaveBeenCalledTimes(1);
    // readIdentityFile NEVER called (no keys to read)
    expect(readIdentityFileMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GET /identities/:identityKey/avatar — rekeyed (Phase 68)
// ===========================================================================

describe("GET /identities/:identityKey/avatar — Phase 68 rekeyed", () => {

  it("Avatar-1: identityKey=tina + hostId=1 → 200 + Content-Type + bytes + Cache-Control: no-store", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    const pngBytes = Buffer.from("PNGDATA");
    readAvatarSiblingFileMock.mockResolvedValue({ bytes: pngBytes, mime: "image/png", ext: "png" });

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawBody.equals(pngBytes)).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
    // readAvatarSiblingFile was called with identityKey="tina" (the URL param)
    expect(readAvatarSiblingFileMock.mock.calls[0][1]).toBe("tina");
  });

  it("Avatar-2: readAvatarSiblingFile returns null → 404 with 'no avatar' error", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readAvatarSiblingFileMock.mockResolvedValue(null);

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(404);
    const body = res.body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("no avatar");
  });

  it("Avatar-3: readAvatarSiblingFile throws → 502 'identity home box unreachable'", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readAvatarSiblingFileMock.mockRejectedValue(new Error("remote exec timeout"));

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(502);
    const body = res.body as { error?: string };
    expect(body.error).toBe("identity home box unreachable");
  });

  it("Avatar-4: missing ?hostId query → 400 with 'hostId' error message", async () => {
    const res = await httpGet(server, `/identities/tina/avatar`);

    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("hostid");
    expect(readAvatarSiblingFileMock).not.toHaveBeenCalled();
  });

  it("Avatar-5: LOCAL branch (isLocalHostId=true) → connectOneShot NEVER called; readAvatarSiblingFile called with conn=null", async () => {
    isLocalHostIdMock.mockReturnValue(true);
    const pngBytes = Buffer.from("LOCALDATA");
    readAvatarSiblingFileMock.mockResolvedValue({ bytes: pngBytes, mime: "image/png", ext: "png" });

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAvatarSiblingFileMock).toHaveBeenCalledTimes(1);
    expect(readAvatarSiblingFileMock.mock.calls[0][0]).toBeNull();
  });
});
