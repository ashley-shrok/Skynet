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
 *   - Cross-host identityKey collisions surface as SEPARATE rows (one per
 *     (hostId, identityKey) tuple; per quick-260912-0t4). Frontend
 *     disambiguates via byHostKey composite key.
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
 *   Fanout (d)  cross-host collision on identityKey "tina" → BOTH rows surface (one per hostId)
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

// Phase 129 Plan 129-02: systemLogger is used by identities.ts for the two
// gate-seam structured logs (identities_gate_username_missing warn +
// identities_gate_hidden debug). Must be mocked here so tests can assert on
// the warn call in Test F. vi.hoisted keeps the mock instances reachable
// from both the vi.mock factory (which is hoisted above imports) AND the
// per-test assertion code below.
const {
  systemLoggerWarnMock,
  systemLoggerDebugMock,
} = vi.hoisted(() => {
  return {
    systemLoggerWarnMock: vi.fn(),
    systemLoggerDebugMock: vi.fn(),
  };
});

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  systemLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: systemLoggerWarnMock,
    debug: systemLoggerDebugMock,
  },
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
// Phase 85 Plan 85-01 Task 2: role-cosmetic merge + role-avatar fallback.
const readRoleFileByNameMock = vi.fn();
const readAvatarSiblingFileByRoleMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  stringifyColorHueForYaml: (obj: Record<string, unknown>) => (typeof obj.colorHue === "number" ? { ...obj, colorHue: String(obj.colorHue) } : obj),
  readIdentityFile: (conn: unknown, key: string) => readIdentityFileMock(conn, key),
  listIdentityKeysOnHost: (conn: unknown) => listIdentityKeysOnHostMock(conn),
  writeIdentityFile: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  readAvatarSiblingFile: (conn: unknown, key: string) =>
    readAvatarSiblingFileMock(conn, key),
  // Phase 85 Plan 85-01: new readers added in Task 1.
  readRoleFileByName: (conn: unknown, roleName: string) =>
    readRoleFileByNameMock(conn, roleName),
  readAvatarSiblingFileByRole: (
    conn: unknown,
    roleName: string,
    avatarFilename: string,
  ) => readAvatarSiblingFileByRoleMock(conn, roleName, avatarFilename),
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
    // Mirror the real extractCosmeticsFromFrontmatter tolerance — accept
    // number OR numeric string (MDXEditor + Skynet writers now emit `'324'`).
    const rawHue = src.colorHue;
    const parsedHue =
      typeof rawHue === "number"
        ? rawHue
        : typeof rawHue === "string" && rawHue.trim() !== ""
          ? Number(rawHue)
          : Number.NaN;
    if (Number.isFinite(parsedHue) && parsedHue >= 0 && parsedHue <= 359) out.colorHue = parsedHue;
    if (typeof src.voice === "string" && src.voice.length > 0) out.voice = src.voice;
    if (typeof src.avatar === "string" && src.avatar.length > 0) out.avatar = src.avatar;
    if (typeof src.coordinator === "boolean") out.coordinator = src.coordinator;
    // Phase 80 Plan 80-03: task scalar narrowing — non-empty string kept, everything else dropped.
    if (typeof src.task === "string" && src.task.length > 0) out.task = src.task;
    // Phase 129 Plan 129-02: propagate `users: string[]` when present so the
    // per-user visibility gate in the fanout has real data to intersect on.
    // Mirrors the real narrower discipline (identity-artifact-reader.ts):
    // Array.isArray + typeof-string + trim + drop-empties + only emit when
    // normalized.length > 0 (D-3 absent-⇒-omit fallback preserved).
    if (Array.isArray(src.users)) {
      const normalized = src.users
        .filter((u): u is string => typeof u === "string")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      if (normalized.length > 0) out.users = normalized;
    }
    return out;
  },
}));

// ---------------------------------------------------------------------------
// Phase 129 Plan 129-02: host-user-counter mock (getUsernameForUserId).
// Task 2 (GREEN) will make identities.ts import this to translate the JWT
// userId into a Skynet username before invoking isIdentityVisibleToUser.
// ---------------------------------------------------------------------------

const { getUsernameForUserIdMock } = vi.hoisted(() => ({
  getUsernameForUserIdMock: vi.fn(),
}));

vi.mock("../../utils/host-user-counter.js", () => ({
  isHostMultiUser: vi.fn().mockResolvedValue(false),
  getUsernameForUserId: (userId: string) => getUsernameForUserIdMock(userId),
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
  // Phase 85 Plan 85-01 Task 2 defaults — role has no defaults; role folder
  // has no fallback avatar. Individual tests override as needed.
  readRoleFileByNameMock.mockResolvedValue({ markdown: "" });
  readAvatarSiblingFileByRoleMock.mockResolvedValue(null);
  // Phase 129 Plan 129-02 defaults — every pre-129 test uses mockUserId
  // "test-user" and every gate-relevant test uses fireGetIdentitiesAs to
  // override this per-username. Default returns "test-user" so pre-existing
  // tests without a `users` frontmatter still fall through the gate (D-3
  // fallback = visible when identity/role users list is empty/absent).
  getUsernameForUserIdMock.mockResolvedValue("test-user");
  systemLoggerWarnMock.mockClear();
  systemLoggerDebugMock.mockClear();

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
    const out = publicIdentity("tina", 1, { displayName: "Tina", title: "Dev", colorHue: 220, voice: "Joanna", avatarMime: "image/png", avatarEtag: "abc", coordinator: true }, "box-maintainer");
    expect(out).toHaveProperty("identityKey", "tina");
    expect(out).toHaveProperty("displayName", "Tina");
    expect(out).toHaveProperty("title", "Dev");
    expect(out).toHaveProperty("colorHue", 220);
    expect(out).toHaveProperty("voice", "Joanna");
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

  // Phase 80 Plan 80-03: task field surfaces on every publicIdentity result.
  it("PUB-5: task present in cosmetics → emitted verbatim", () => {
    const out = publicIdentity(
      "tina",
      1,
      { displayName: "Tina", task: "wire the pool-pick endpoint" },
      "box-maintainer",
    );
    expect(out).toHaveProperty("task", "wire the pool-pick endpoint");
  });

  it("PUB-6: task absent from cosmetics → emitted as null (matches voice/title null-fallback shape)", () => {
    const out = publicIdentity("poppy", 5, {}, null);
    expect(out).toHaveProperty("task", null);
  });

  it("PUB-7: task present but not a string → emitted as null (defensive; extractCosmeticsFromFrontmatter already narrows)", () => {
    const out = publicIdentity(
      "moxie",
      3,
      { task: 42 as unknown as string },
      null,
    );
    expect(out).toHaveProperty("task", null);
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
  // Fanout (d): cross-host collision → BOTH rows surface (one per hostId)
  // Post quick-260912-0t4: the first-host-wins dedup was removed. Both rows
  // are returned to the wire; frontend disambiguates via byHostKey.
  // -------------------------------------------------------------------------
  it("Fanout-d: cross-host identityKey collision on 'tina' → BOTH rows surface (one per hostId)", async () => {
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
    // Post quick-260912-0t4: BOTH tinas surface (one per hostId).
    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 2 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;

    // BOTH tina rows in the merged result (one per hostId; dedup removed)
    const tinaRows = rows.filter((r) => r.identityKey === "tina");
    expect(tinaRows).toHaveLength(2);

    const tinaHost1 = tinaRows.find((r) => r.hostId === 1);
    const tinaHost2 = tinaRows.find((r) => r.hostId === 2);

    expect(tinaHost1).toBeDefined();
    expect(tinaHost1?.displayName).toBe("Tina-Host1");
    expect(tinaHost1?.avatarUrl).toBe("/identities/tina/avatar?hostId=1");

    expect(tinaHost2).toBeDefined();
    expect(tinaHost2?.displayName).toBe("Tina-Host2");
    expect(tinaHost2?.avatarUrl).toBe("/identities/tina/avatar?hostId=2");
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

  // -------------------------------------------------------------------------
  // Phase 80 Plan 80-03: task field surfaces on GET /identities response
  // -------------------------------------------------------------------------
  it("Fanout-task-present: frontmatter has task → response body includes task string", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Tina\ntask: wire the pool-pick endpoint\n---\n",
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);
    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].task).toBe("wire the pool-pick endpoint");
  });

  it("Fanout-task-absent: frontmatter has no task key → response body has task: null", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);
    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("task", null);
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

// ===========================================================================
// Phase 85 Plan 85-01 Task 2: publicIdentity + roleCosmetics merge tests
// ===========================================================================
//
// The Phase 85 signature extension adds a fifth positional argument
// `roleCosmetics` — nullable per-field object surfacing the role's raw
// cosmetic values. Per-field merge semantics locked in D-CTX-85-inherit:
//
//   resolved_value = identity_cosmetic ?? role_cosmetic ?? null
//
// The response gains a new field `roleDefaults` echoing roleCosmetics
// verbatim when non-null (so the frontend Identity modal can render
// inherit-vs-override affordances — Plan 85-05). null when no role.
//
// Test PUB-M-1..M-5: direct unit tests on publicIdentity's per-field merge.
// Test GET-M-1..M-2: route integration tests for role-cosmetic merge + memo.
// Test AVATAR-M-1..M-3: role-folder fallback on GET /:key/avatar.

describe("Phase 85 publicIdentity — identity ?? role ?? null merge + roleDefaults", () => {
  it("PUB-M-1: identity overrides role per field; role fills where identity absent; roleDefaults echoes role verbatim", () => {
    const out = publicIdentity(
      "tina",
      1,
      { title: "id-title", colorHue: 200 },
      "box-maintainer",
      { title: "role-title", voice: "Kate.wav", colorHue: 190, avatar: "role.webp" },
    );
    // identity wins per field
    expect(out.title).toBe("id-title");
    expect(out.colorHue).toBe(200);
    // voice inherits from role
    expect(out.voice).toBe("Kate.wav");
    // role field passes through unchanged
    expect(out.role).toBe("box-maintainer");
    // roleDefaults echoes role's raw values verbatim
    expect(out.roleDefaults).toEqual({
      title: "role-title",
      voice: "Kate.wav",
      colorHue: 190,
      avatar: "role.webp",
    });
  });

  it("PUB-M-2: empty identity cosmetics + role has subset → resolved falls through to role; roleDefaults contains only present keys", () => {
    const out = publicIdentity(
      "tina",
      1,
      {},
      "role-x",
      { title: "role-title", colorHue: 190 },
    );
    expect(out.title).toBe("role-title");
    expect(out.colorHue).toBe(190);
    expect(out.voice).toBeNull(); // absent on both → null
    // roleDefaults carries only the present keys (voice/avatar NOT in the object)
    expect(out.roleDefaults).toEqual({ title: "role-title", colorHue: 190 });
    expect("voice" in (out.roleDefaults as object)).toBe(false);
    expect("avatar" in (out.roleDefaults as object)).toBe(false);
  });

  it("PUB-M-3: empty identity cosmetics + empty role cosmetics → resolved all null; roleDefaults is {} (not null)", () => {
    const out = publicIdentity("tina", 1, {}, "role-x", {});
    expect(out.title).toBeNull();
    expect(out.colorHue).toBeNull();
    expect(out.voice).toBeNull();
    // Empty role: role name is non-null but role has no cosmetic frontmatter.
    // roleDefaults must be {} (empty object) — distinguishes from "no role"
    // (which is null). Frontend uses this + `role` field to differentiate.
    expect(out.roleDefaults).toEqual({});
    expect(out.role).toBe("role-x");
  });

  it("PUB-M-4: no role at all → roleDefaults is null; identity cosmetics still resolve normally", () => {
    const out = publicIdentity("tina", 1, { title: "id-title" }, null, null);
    expect(out.title).toBe("id-title");
    expect(out.role).toBeNull();
    expect(out.roleDefaults).toBeNull();
  });

  it("PUB-M-5: avatarUrl stays `/identities/${key}/avatar?hostId=${hostId}` regardless of role merge", () => {
    // Even with a role that has its own avatar, the URL shape does NOT change.
    // Backend does the fallback internally; the URL is what the frontend renders.
    const out = publicIdentity(
      "tina",
      7,
      {},
      "box-maintainer",
      { avatar: "role.webp" },
    );
    expect(out.avatarUrl).toBe("/identities/tina/avatar?hostId=7");
  });
});

// ===========================================================================
// GET /identities — role-cosmetic merge + per-host memo (Phase 85)
// ===========================================================================

describe("GET /identities — Phase 85 role-cosmetic merge + per-host role-read memo", () => {
  it("GET-M-1: identity has title, role has title+voice → response resolves title from identity, voice from role, roleDefaults echoes role", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: id-title\n---\n",
    });
    readRoleFileByNameMock.mockResolvedValue({
      markdown:
        "---\ntitle: role-title\nvoice: Kate.wav\n---\n\n# Box maintainer\n",
    });

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const tina = rows[0];
    // identity's title wins
    expect(tina.title).toBe("id-title");
    // voice inherits from role
    expect(tina.voice).toBe("Kate.wav");
    // roleDefaults echoes role frontmatter verbatim
    expect(tina.roleDefaults).toEqual({ title: "role-title", voice: "Kate.wav" });
  });

  it("GET-M-2: two identities on same host sharing the same role → readRoleFileByName called exactly ONCE (per-host memo)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy"]);
    // Both identities point to the same role.
    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      return Promise.resolve({
        markdown: `---\nrole: box-maintainer\ndisplayName: ${key}\n---\n`,
      });
    });
    readRoleFileByNameMock.mockResolvedValue({
      markdown: "---\ntitle: role-title\n---\n",
    });

    const hostsJson = encodeURIComponent(
      JSON.stringify({ tina: 1, poppy: 1 }),
    );
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // Both got the role's title inherited
    for (const row of rows) {
      expect(row.roleDefaults).toEqual({ title: "role-title" });
    }
    // Per-host memo: role file read AT MOST ONCE for this host despite two
    // identities sharing the role (T-85-01-03 DoS mitigation).
    expect(readRoleFileByNameMock).toHaveBeenCalledTimes(1);
    expect(readRoleFileByNameMock.mock.calls[0][1]).toBe("box-maintainer");
  });

  it("GET-M-3: role-read throws → identity still returns with roleDefaults={} (silent-swallow)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: id-title\n---\n",
    });
    // Role read fails — identity should still surface with its own cosmetics.
    readRoleFileByNameMock.mockRejectedValue(new Error("SSH exec failed"));

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("id-title");
    // roleDefaults is {} — role read failed, but role name is still known
    expect(rows[0].roleDefaults).toEqual({});
  });
});

// ===========================================================================
// GET /identities/:key/avatar — role folder fallback (Phase 85)
// ===========================================================================

describe("GET /identities/:key/avatar — Phase 85 role-folder fallback", () => {
  it("AVATAR-M-1: identity's sibling avatar exists → returns identity bytes (existing behavior preserved)", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    const pngBytes = Buffer.from("IDENTITYPNG");
    readAvatarSiblingFileMock.mockResolvedValue({
      bytes: pngBytes,
      mime: "image/png",
      ext: "png",
    });

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawBody.equals(pngBytes)).toBe(true);
    // Role-side fallback never consulted
    expect(readAvatarSiblingFileByRoleMock).not.toHaveBeenCalled();
  });

  it("AVATAR-M-2: identity has NO sibling but role has avatar frontmatter + role folder has that sibling → returns role bytes", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    // Identity-side avatar returns null
    readAvatarSiblingFileMock.mockResolvedValue(null);
    // Identity markdown carries role name
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // Role file carries avatar frontmatter
    readRoleFileByNameMock.mockResolvedValue({
      markdown:
        '---\ntitle: role-title\navatar: "box-maintainer.webp"\n---\n',
    });
    // Role folder has the sibling image
    const webpBytes = Buffer.from("ROLEWEBP");
    readAvatarSiblingFileByRoleMock.mockResolvedValue({
      bytes: webpBytes,
      mime: "image/webp",
      ext: "webp",
    });

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.rawBody.equals(webpBytes)).toBe(true);
    // Role-side fallback was called with the correct roleName + filename
    expect(readAvatarSiblingFileByRoleMock).toHaveBeenCalledTimes(1);
    const [, roleName, filename] =
      readAvatarSiblingFileByRoleMock.mock.calls[0];
    expect(roleName).toBe("box-maintainer");
    expect(filename).toBe("box-maintainer.webp");
  });

  it("AVATAR-M-3: neither identity nor role has an avatar → 404 preserved with 'no avatar' error", async () => {
    isLocalHostIdMock.mockReturnValue(false);
    readAvatarSiblingFileMock.mockResolvedValue(null);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // Role has no avatar frontmatter
    readRoleFileByNameMock.mockResolvedValue({
      markdown: "---\ntitle: role-title\n---\n",
    });

    const res = await httpGet(server, `/identities/tina/avatar?hostId=1`);

    expect(res.status).toBe(404);
    const body = res.body as { error?: string };
    expect(body.error?.toLowerCase()).toContain("no avatar");
    // Role-avatar reader NOT called (no avatar filename in role frontmatter)
    expect(readAvatarSiblingFileByRoleMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Phase 129 Plan 129-02: per-user visibility gate on GET /identities
// ===========================================================================
//
// Deep-gate D-7 seam #1 (see 129-CONTEXT.md § "Locked decisions"):
//   - D-2 intersection: identity is visible iff BOTH the identity's `users`
//     gate AND the role's `users` gate pass.
//   - D-3 fallback: empty or absent `users` list = "no gate on this side"
//     (falls open — preserves zero-migration invariant across the fleet).
//   - D-7 depth: hidden identity leaves NO evidence in the response — no
//     stripped-down cosmetics row, no ghost. The row is simply absent.
//   - D-8 not a permission system: the visibility gate is a filter; defensive
//     branches (unknown userId → username) fail-OPEN, not fail-closed.
//
// Wire-shape assertions: every test parses the JSON array response body
// and looks for identityKey presence/absence. No cosmetic inspection past
// what's needed to confirm the row is real (not a stripped ghost).
//
// TDD RED note: at file creation the gate has not been wired in identities.ts
// yet. Tests C, D, E MUST fail (the hidden identity currently surfaces).
// Test F MUST fail (no warn log for missing username). Tests A, B, G may
// currently pass by accident (the gate not existing = no filtering) — they
// are locked as regressions that the GREEN implementation must not break.
//
// Fixture helpers below encapsulate the three axes of variation:
//   - callerUsername (via getUsernameForUserIdMock)
//   - identity-side `users` frontmatter (via mockIdentityWithUsers)
//   - role-side `users` frontmatter (via mockIdentityWithUsers)
//
// The HTTP fire helper wires mockUserId and getUsernameForUserIdMock in one
// call so tests read as "Ashley fires GET /identities" rather than a manual
// two-step mock-fiddle preamble.

/**
 * Mock the DB translation from a JWT userId to a Skynet username. The gate
 * inside identities.ts uses this to know who is asking; a null return
 * disables the gate per Plan 129-01 Task 2 Test 1 (null-caller bypass).
 */
function mockGetUsernameForUserId(userId: string, username: string | null): void {
  getUsernameForUserIdMock.mockImplementation((incomingUserId: string) => {
    if (incomingUserId === userId) return Promise.resolve(username);
    return Promise.resolve(null);
  });
}

/**
 * Wire an identity's frontmatter fixture. If identityUsers is provided the
 * identity file's YAML gets a `users:` array; if roleUsers is provided the
 * role file's YAML gets one too. Absent parameters mean the corresponding
 * frontmatter key is NOT written — mirrors the D-3 absent-⇒-omit fallback
 * that keeps pre-129 files unchanged.
 *
 * Only supports a single (identityKey, hostId, roleName) combo per call —
 * each test either calls it once or overrides listIdentityKeysOnHostMock +
 * readIdentityFileMock manually for multi-identity fixtures (Test D).
 */
function mockIdentityWithUsers(
  identityKey: string,
  _hostId: number,
  roleName: string,
  identityUsers?: string[],
  roleUsers?: string[],
): void {
  listIdentityKeysOnHostMock.mockResolvedValue([identityKey]);
  const idFm: string[] = [`role: ${roleName}`, `displayName: ${identityKey}`];
  if (identityUsers !== undefined) {
    idFm.push(`users: [${identityUsers.join(", ")}]`);
  }
  readIdentityFileMock.mockResolvedValue({
    markdown: `---\n${idFm.join("\n")}\n---\n`,
  });
  const roleFm: string[] = [`title: ${roleName}-title`];
  if (roleUsers !== undefined) {
    roleFm.push(`users: [${roleUsers.join(", ")}]`);
  }
  readRoleFileByNameMock.mockResolvedValue({
    markdown: `---\n${roleFm.join("\n")}\n---\n`,
  });
}

/**
 * Fire GET /identities as a given Skynet username. Assigns req.userId via
 * the auth manager mock AND wires getUsernameForUserId to translate that
 * userId back to the username string the gate expects.
 */
async function fireGetIdentitiesAs(
  username: string,
  identityHostsQuery: Record<string, number>,
): Promise<{ status: number; body: Array<Record<string, unknown>> }> {
  const jwtUserId = `uid-${username}`;
  mockUserId = jwtUserId;
  mockGetUsernameForUserId(jwtUserId, username);
  const qs = encodeURIComponent(JSON.stringify(identityHostsQuery));
  const res = await httpGet(server, `/identities?identityHosts=${qs}`);
  return {
    status: res.status,
    body: res.body as Array<Record<string, unknown>>,
  };
}

describe("Phase 129: per-user visibility gate", () => {

  // -------------------------------------------------------------------------
  // Test A: single-user host — no evidence of the feature (D-4 + shape file
  // §"What would make it wrong" bullet 1). A single-user-host identity with
  // NO users: key must still surface exactly as it did pre-129.
  //
  // Additionally asserts the per-request username lookup happens EXACTLY
  // ONCE. This is the wire-level guarantee that Task 2 fetches the caller's
  // username once per request (not once per host, not once per identity).
  // On RED (gate not yet wired) getUsernameForUserId is never called, so
  // this test fails until Task 2 lands.
  // -------------------------------------------------------------------------
  it("Test A: single-user host, identity has no `users` key → identity surfaces + username fetched once per request", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers("muffin", 1, "box-maintainer"); // no users on either side

    const res = await fireGetIdentitiesAs("ashley", { muffin: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].identityKey).toBe("muffin");
    // Per-request-cost discipline: the callerUsername lookup runs ONCE
    // per request, not per-host or per-identity (matches identities.ts's
    // roleReadCache memo pattern for the analogous per-host DoS mitigation).
    expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(1);
    expect(getUsernameForUserIdMock).toHaveBeenCalledWith("uid-ashley");
  });

  // -------------------------------------------------------------------------
  // Test B: multi-user host, identity untagged → visible to both users
  // (D-3 fallback = "no gate on this side"). Confirms the empty-list rule
  // at the WIRE (not just the pure gate unit test).
  //
  // Also asserts the second request re-fetches the username — the lookup
  // is per-request, not memoized module-globally. On RED the lookup is
  // never called at all, so this fails until Task 2 wires it.
  // -------------------------------------------------------------------------
  it("Test B: multi-user host, identity has no `users` key → both Ashley and Zoe see it (each request re-fetches username)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers("muffin", 1, "box-maintainer"); // no users on either side

    const ashley = await fireGetIdentitiesAs("ashley", { muffin: 1 });
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].identityKey).toBe("muffin");

    const zoe = await fireGetIdentitiesAs("zoe", { muffin: 1 });
    expect(zoe.status).toBe(200);
    expect(zoe.body).toHaveLength(1);
    expect(zoe.body[0].identityKey).toBe("muffin");

    // Two requests → two username lookups. Confirms no cross-request
    // caching of caller identity (would be a critical bug — user A's
    // cached username used to gate user B's request).
    expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(2);
    expect(getUsernameForUserIdMock).toHaveBeenNthCalledWith(1, "uid-ashley");
    expect(getUsernameForUserIdMock).toHaveBeenNthCalledWith(2, "uid-zoe");
  });

  // -------------------------------------------------------------------------
  // Test C: multi-user host, identity tagged users:[ashley] → visible to
  // Ashley, hidden from Zoe (D-2). Zoe's response has ZERO rows — the
  // hidden identity does not appear as a stripped ghost (D-7 deep gate).
  // -------------------------------------------------------------------------
  it("Test C: identity tagged users:[ashley] → Ashley sees it, Zoe does NOT (no ghost row)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers("muffin", 1, "box-maintainer", ["ashley"]);

    const ashley = await fireGetIdentitiesAs("ashley", { muffin: 1 });
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].identityKey).toBe("muffin");

    const zoe = await fireGetIdentitiesAs("zoe", { muffin: 1 });
    expect(zoe.status).toBe(200);
    // D-7 deep gate: the row is ABSENT from the array. No stripped-down
    // cosmetics row, no ghost — Zoe gets zero identities.
    expect(zoe.body).toHaveLength(0);
    expect(zoe.body.find((r) => r.identityKey === "muffin")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test D: multi-user host, role tagged users:[ashley] → identity in that
  // role is hidden from Zoe (D-2 intersection). Identity has NO users key,
  // so the role-side gate is what closes the door on Zoe.
  // -------------------------------------------------------------------------
  it("Test D: role tagged users:[ashley] (identity untagged) → Ashley sees identity, Zoe does not", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers(
      "muffin",
      1,
      "box-maintainer",
      undefined, // identity has no users
      ["ashley"], // role has users:[ashley]
    );

    const ashley = await fireGetIdentitiesAs("ashley", { muffin: 1 });
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].identityKey).toBe("muffin");

    const zoe = await fireGetIdentitiesAs("zoe", { muffin: 1 });
    expect(zoe.status).toBe(200);
    // Role gate closes for Zoe → the identity vanishes entirely from her
    // sidebar even though her host access is fine.
    expect(zoe.body).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test E: both sides tagged with overlapping-but-not-identical lists.
  // role users:[ashley, zoe], identity users:[ashley] → the identity is
  // the narrower side and closes the gate for Zoe (D-2 intersection).
  // -------------------------------------------------------------------------
  it("Test E: role users:[ashley,zoe] + identity users:[ashley] → Ashley sees it, Zoe does not (intersection)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers(
      "muffin",
      1,
      "box-maintainer",
      ["ashley"], // identity narrows to Ashley
      ["ashley", "zoe"], // role allows both
    );

    const ashley = await fireGetIdentitiesAs("ashley", { muffin: 1 });
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].identityKey).toBe("muffin");

    const zoe = await fireGetIdentitiesAs("zoe", { muffin: 1 });
    expect(zoe.status).toBe(200);
    // Intersection: identity-side narrows to Ashley → Zoe sees nothing.
    expect(zoe.body).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test F: unknown username defensive branch. If getUsernameForUserId
  // returns null (a JWT with a userId that no longer has a users row —
  // shape-violation but MUST NOT throw), the gate is DISABLED and the
  // caller sees rows their host-access allows. A warn log fires so ops
  // can trace the mismatch.
  //
  // Fail-open per D-8: the visibility gate is not a permission system;
  // a defective username lookup must not empty the sidebar.
  // -------------------------------------------------------------------------
  it("Test F: getUsernameForUserId returns null → gate disabled (fail-open), warn log fires", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    mockIdentityWithUsers(
      "muffin",
      1,
      "box-maintainer",
      ["ashley"], // even Ashley-only identity — with null caller username the gate is bypassed
    );

    // JWT userId is set but the username lookup returns null (row missing).
    mockUserId = "orphan-uid";
    getUsernameForUserIdMock.mockResolvedValue(null);

    const hostsJson = encodeURIComponent(JSON.stringify({ muffin: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    // Fail-open: the identity DOES surface because callerUsername=null
    // short-circuits the gate to "visible" (Plan 129-01 Task 2 Test 1).
    expect(rows).toHaveLength(1);
    expect(rows[0].identityKey).toBe("muffin");

    // Structured warn log fires with the operation tag so ops can grep
    // "why did the gate not run for this request?" in prod.
    const warnCalls = systemLoggerWarnMock.mock.calls;
    const hasGateWarn = warnCalls.some((call) => {
      const payload = call[1] as { operation?: string } | undefined;
      return payload?.operation === "identities_gate_username_missing";
    });
    expect(hasGateWarn).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test G: existing fail-open contract on identity-file read failure. The
  // gate MUST NOT convert an existing null-drop (readIdentityFile throws)
  // into a false-positive visibility. The pre-129 behavior (drop the row,
  // log a warn) must be preserved.
  //
  // Two identities: one reads OK and is tagged users:[ashley]; the other
  // throws on read. Ashley must see ONLY the first (readable) identity.
  // -------------------------------------------------------------------------
  it("Test G: identity file read throws mid-fanout → dropped (existing contract), other identity still gates correctly", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["muffin", "broken"]);
    readIdentityFileMock.mockImplementation((_conn: unknown, key: string) => {
      if (key === "muffin") {
        return Promise.resolve({
          markdown:
            "---\nrole: box-maintainer\ndisplayName: Muffin\nusers: [ashley]\n---\n",
        });
      }
      // "broken" read throws — pre-129 contract drops it via the L445
      // null-return + .filter((x) => x !== null) on L450.
      return Promise.reject(new Error("SSH exec timeout"));
    });
    readRoleFileByNameMock.mockResolvedValue({
      markdown: "---\ntitle: role-title\n---\n",
    });

    const ashley = await fireGetIdentitiesAs("ashley", {
      muffin: 1,
      broken: 1,
    });
    expect(ashley.status).toBe(200);
    // muffin surfaces (Ashley is in identity.users). "broken" is dropped
    // by the pre-existing read-fail contract, NOT by the gate.
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].identityKey).toBe("muffin");
    // Confirm the drop was not a stealth-visibility bypass: Zoe still
    // does NOT see muffin even in the presence of a sibling read failure.
    const zoe = await fireGetIdentitiesAs("zoe", { muffin: 1, broken: 1 });
    expect(zoe.status).toBe(200);
    expect(zoe.body).toHaveLength(0);
  });
});
