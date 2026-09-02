/**
 * Phase 68 Plan 68-02 Task 2 (PUT /:identityKey rekey): Tests for the rekeyed
 * PUT /identities/:identityKey handler.
 *
 * Post-Phase-68-02 contract:
 *
 * Route renamed from /:id to /:identityKey. Row lookup removed (no DB select
 * by id+userId). Row bump removed (no db.update updatedAt). forceSave removed
 * (disk write is fsynced by writeMarkdownFileAtomic). The URL param IS the
 * identityKey used for disk reads/writes — no indirection through the DB.
 *
 * Frontmatter mutation semantics (unchanged from Phase 66):
 *   - absent-in-payload  → leave key alone
 *   - explicit-null      → REMOVE key
 *   - present-scalar     → overlay
 *
 * Test surface: 10 tests (Tests 1-9 preserved with URL + assertion updates;
 * Test 10 was "forceSave called" which is removed — replaced with NEW Test 10
 * "disk-file-missing → 500" via :identityKey URL that doesn't exist on disk):
 *   1  present-updates-overlay: full body → yaml overlay (URL uses identityKey)
 *   2  absent-in-payload-leaves-alone
 *   3  explicit-null-removes-key
 *   4  avatar-write-same-ext (no rm exec)
 *   5  avatar-write-swap-ext (rm old sibling)
 *   6  hostId missing → 400
 *   7  connectOneShot rejects → 502
 *   8  readIdentityFile returns "" → 500 (data-integrity violation T-68-02-04)
 *   9  LOCAL branch (isLocalHostId true) → conn=null across all helpers
 *  10  NEW: PUT /identities/nonexistent-key where .md missing → 500 "identity file missing on target host"
 *  11  PUT response echoes coordinator:true from disk after write (Phase 67 H1 preserved)
 *
 * Scaffold follows identity-birth.test.ts:
 *   - bare Express + Node http.request (no supertest dep)
 *   - vi.mock() AuthManager, db/index, drizzle-orm, db/schema, logger,
 *     artifact-reader, ssh-one-shot, tmux-helper, DatabaseSaveTrigger
 *   - DB shim retained for POST / path (410 stub; not exercised here) and any
 *     other routes mounted on the router that still touch the DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Auth manager mock — always authenticates as "test-user" unless overridden
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

// ---------------------------------------------------------------------------
// nanoid mock — predictable ids
// ---------------------------------------------------------------------------

vi.mock("nanoid", () => ({
  nanoid: () => "nano-generated-id",
}));

// ---------------------------------------------------------------------------
// In-memory identities table shim + captured update .set() calls
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: identities row narrowed to 5 surviving columns.
// Cosmetics live on disk. The PUT handler was already flipped in Plan 02
// to write disk-side, and the store update only bumps `updatedAt` — Test 1
// already asserts `dbState.lastUpdateSetKeys === ["updatedAt"]`. Post-drop,
// the seed row no longer has cosmetic columns to preserve.
type IdentityRow = {
  id: string;
  userId: string;
  identityKey: string;
  createdAt: string;
  updatedAt: string;
};

const dbState: {
  identities: IdentityRow[];
  // Captures every column key passed to .set(...) — Test 1 asserts NO
  // cosmetic keys appear (only updatedAt) post-flip.
  lastUpdateSetKeys: string[] | null;
  lastFilter: { id?: string; userId?: string };
} = {
  identities: [],
  lastUpdateSetKeys: null,
  lastFilter: {},
};

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
    set: (updates: Record<string, unknown>) => {
      dbState.lastUpdateSetKeys = Object.keys(updates);
      // Apply updates to the matching row (updatedAt bump is the visible mutation).
      const f = { ...filterAccum };
      for (const row of dbState.identities) {
        if (f.userId !== undefined && row.userId !== f.userId) continue;
        if (f.id !== undefined && row.id !== f.id) continue;
        Object.assign(row, updates);
      }
      return chain;
    },
    delete: () => chain,
    run: () => {
      filterAccum = {};
    },
  };
  return { db: chain };
});

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// DatabaseSaveTrigger mock — Test 10 asserts forceSave("identity_updated")
// ---------------------------------------------------------------------------

const forceSaveMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: (reason: string) => forceSaveMock(reason),
  },
}));

// ---------------------------------------------------------------------------
// Artifact-reader mock — spies for read/write + isLocalHostId + MIME map
// ---------------------------------------------------------------------------

const readIdentityFileMock = vi.fn();
const writeIdentityFileMock = vi.fn();
const writeAvatarSiblingFileMock = vi.fn();
const isLocalHostIdMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: (
    conn: unknown,
    key: string,
  ) => readIdentityFileMock(conn, key),
  writeIdentityFile: (
    conn: unknown,
    key: string,
    body: string,
  ) => writeIdentityFileMock(conn, key, body),
  writeAvatarSiblingFile: (
    conn: unknown,
    key: string,
    ext: string,
    bytes: Buffer,
  ) => writeAvatarSiblingFileMock(conn, key, ext, bytes),
  isLocalHostId: (n: number | undefined) => isLocalHostIdMock(n),
  getLocalIdentitiesRoot: () => "/tmp/test-identities",
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
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
  // Phase 67 /close 2026-09-01 follow-up (H1): the PUT handler now re-reads
  // disk cosmetics after write and overlays them onto publicIdentity so the
  // response echoes the true disk state (crucial for the coordinator flag).
  // Mirror the get-disk.test.ts mock: parse frontmatter and hoist only the
  // whitelist of cosmetic fields.
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
// SSH mocks — connectOneShot returns a fake conn; execCommand is a spy
// ---------------------------------------------------------------------------

const fakeConn = { __fake: "ssh-conn" } as unknown;
const connectOneShotMock = vi.fn();
const execCommandMock = vi.fn();

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: (host: unknown, timeoutMs: number) =>
    connectOneShotMock(host, timeoutMs),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: (conn: unknown, cmd: string) => execCommandMock(conn, cmd),
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

// Also mock the fake `end()` since the PUT handler will call conn.end() in
// try/finally. Fake conn is a plain object — inject an end() when we return
// it from connectOneShot.
function makeFakeConnWithEnd(): { __fake: string; end: () => void } {
  return { __fake: "ssh-conn", end: vi.fn() };
}

// ---------------------------------------------------------------------------
// Import the router AFTER all mocks are installed
// ---------------------------------------------------------------------------

import identitiesRouter from "./identities.js";

// ---------------------------------------------------------------------------
// HTTP helper (multipart body construction for PUT /identities/:id)
// ---------------------------------------------------------------------------

const BOUNDARY = "----vitest66-02boundary";

function buildMultipartBody(opts: {
  data: unknown;
  file?: { filename: string; contentType: string; bytes: Buffer };
}): Buffer {
  const parts: Array<Buffer | string> = [];
  parts.push(`--${BOUNDARY}\r\n`);
  parts.push(`Content-Disposition: form-data; name="data"\r\n\r\n`);
  parts.push(JSON.stringify(opts.data));
  parts.push(`\r\n`);
  if (opts.file) {
    parts.push(`--${BOUNDARY}\r\n`);
    parts.push(
      `Content-Disposition: form-data; name="avatar"; filename="${opts.file.filename}"\r\n`,
    );
    parts.push(`Content-Type: ${opts.file.contentType}\r\n\r\n`);
    parts.push(opts.file.bytes);
    parts.push(`\r\n`);
  }
  parts.push(`--${BOUNDARY}--\r\n`);
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

function httpPut(
  server: http.Server,
  path: string,
  body: Buffer,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "PUT",
        path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;

function seedRow(overrides: Partial<IdentityRow> = {}): IdentityRow {
  const row: IdentityRow = {
    id: "test-id",
    userId: "test-user",
    identityKey: "testkey",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  dbState.identities = [seedRow()];
  dbState.lastUpdateSetKeys = null;
  dbState.lastFilter = {};
  filterAccum = {};

  // Default mock behaviors — each test overrides as needed.
  readIdentityFileMock.mockResolvedValue({
    markdown:
      "---\nrole: box-maintainer\ndisplayName: Old\ntitle: Old T\ncolorHue: 90\n---\n\n# testkey\n",
  });
  writeIdentityFileMock.mockResolvedValue(undefined);
  writeAvatarSiblingFileMock.mockResolvedValue(undefined);
  isLocalHostIdMock.mockReturnValue(false); // REMOTE by default
  connectOneShotMock.mockResolvedValue(makeFakeConnWithEnd());
  execCommandMock.mockResolvedValue("");
  forceSaveMock.mockResolvedValue(undefined);

  const app = express();
  app.use("/identities", identitiesRouter);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// Helper — extract the frontmatter block from a written body and yaml.load it
function loadWrittenFrontmatter(body: string): Record<string, unknown> {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter block in written body");
  const parsed = yaml.load(match[1]) as Record<string, unknown>;
  return parsed;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("PUT /identities/:identityKey — Phase 68-02 rekey (no row bump, no forceSave)", () => {

  // -------------------------------------------------------------------------
  // Test 1: present-updates-overlay (URL now uses identityKey, not id)
  // -------------------------------------------------------------------------
  it("Test 1: full-body present values overlay onto existing frontmatter; disk-write-only (no row bump)", async () => {
    const body = buildMultipartBody({
      data: {
        hostId: 7,
        displayName: "Newname",
        title: "New Title",
        colorHue: 180,
        voice: "Elena.wav",
      },
    });

    // Phase 68-02: URL uses identityKey ("testkey") not the nanoid id ("test-id")
    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);

    // writeIdentityFile called with (conn, "testkey", body-with-overlaid-yaml)
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    const [conn, key, writtenBody] = writeIdentityFileMock.mock.calls[0];
    expect(conn).not.toBeNull(); // REMOTE branch — real conn passed through
    expect(key).toBe("testkey");

    const fm = loadWrittenFrontmatter(writtenBody as string);
    expect(fm.role).toBe("box-maintainer"); // preserved verbatim
    expect(fm.displayName).toBe("Newname");
    expect(fm.title).toBe("New Title");
    expect(fm.colorHue).toBe(180);
    expect(fm.voice).toBe("Elena.wav");

    // Phase 68-02: no row bump — DB update NOT called at all.
    expect(dbState.lastUpdateSetKeys).toBeNull();
    // Phase 68-02: no forceSave after disk write.
    expect(forceSaveMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: absent-in-payload-leaves-alone
  // -------------------------------------------------------------------------
  it("Test 2: absent-in-payload fields leave existing frontmatter values alone", async () => {
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Keep\ntitle: KeepTitle\ncolorHue: 100\nvoice: Keep.wav\n---\n\n# testkey\n",
    });

    const body = buildMultipartBody({
      data: { hostId: 7, title: "Only Title Change" },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    const [, , writtenBody] = writeIdentityFileMock.mock.calls[0];
    const fm = loadWrittenFrontmatter(writtenBody as string);

    // title was overlaid
    expect(fm.title).toBe("Only Title Change");
    // other keys untouched from the on-disk read
    expect(fm.displayName).toBe("Keep");
    expect(fm.colorHue).toBe(100);
    expect(fm.voice).toBe("Keep.wav");
    expect(fm.role).toBe("box-maintainer");
  });

  // -------------------------------------------------------------------------
  // Test 3: explicit-null-removes-key
  // -------------------------------------------------------------------------
  it("Test 3: explicit-null-in-payload REMOVES that key from frontmatter", async () => {
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Keep\ntitle: Doomed\ncolorHue: 42\nvoice: Keep.wav\n---\n\n# testkey\n",
    });

    const body = buildMultipartBody({
      data: { hostId: 7, title: null, colorHue: null },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    const [, , writtenBody] = writeIdentityFileMock.mock.calls[0];
    const fm = loadWrittenFrontmatter(writtenBody as string);

    // title + colorHue removed
    expect("title" in fm).toBe(false);
    expect("colorHue" in fm).toBe(false);
    // others preserved
    expect(fm.role).toBe("box-maintainer");
    expect(fm.displayName).toBe("Keep");
    expect(fm.voice).toBe("Keep.wav");
  });

  // -------------------------------------------------------------------------
  // Test 4: avatar-write-same-ext (no rm exec)
  // -------------------------------------------------------------------------
  it("Test 4: avatar write with same extension calls writeAvatarSiblingFile; no rm exec fires", async () => {
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Keep\navatar: testkey.png\n---\n\n# testkey\n",
    });

    const body = buildMultipartBody({
      data: { hostId: 7 },
      file: {
        filename: "avatar.png",
        contentType: "image/png",
        bytes: Buffer.from("newpng"),
      },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    expect(writeAvatarSiblingFileMock).toHaveBeenCalledTimes(1);
    const [conn, key, ext, bytes] = writeAvatarSiblingFileMock.mock.calls[0];
    expect(conn).not.toBeNull();
    expect(key).toBe("testkey");
    expect(ext).toBe("png");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect((bytes as Buffer).toString()).toBe("newpng");

    // No rm exec — extension unchanged.
    const rmCalls = execCommandMock.mock.calls.filter(([, cmd]) =>
      String(cmd).startsWith("rm -f"),
    );
    expect(rmCalls.length).toBe(0);

    // Frontmatter still has avatar: testkey.png
    const [, , writtenBody] = writeIdentityFileMock.mock.calls[0];
    const fm = loadWrittenFrontmatter(writtenBody as string);
    expect(fm.avatar).toBe("testkey.png");
  });

  // -------------------------------------------------------------------------
  // Test 5: avatar-write-swap-ext (rm old sibling)
  // -------------------------------------------------------------------------
  it("Test 5: avatar write with new extension deletes old sibling via rm -f and updates frontmatter", async () => {
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Keep\navatar: testkey.png\n---\n\n# testkey\n",
    });

    const body = buildMultipartBody({
      data: { hostId: 7 },
      file: {
        filename: "avatar.webp",
        contentType: "image/webp",
        bytes: Buffer.from("newwebp"),
      },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    expect(writeAvatarSiblingFileMock).toHaveBeenCalledTimes(1);
    const [, , ext] = writeAvatarSiblingFileMock.mock.calls[0];
    expect(ext).toBe("webp");

    // rm -f fired for the OLD sibling (extension swap)
    const rmCalls = execCommandMock.mock.calls.filter(([, cmd]) =>
      String(cmd).includes("rm -f"),
    );
    expect(rmCalls.length).toBe(1);
    const rmCmd = String(rmCalls[0][1]);
    expect(rmCmd).toContain(
      `rm -f "$HOME/.claude/identities/testkey/testkey.png"`,
    );

    // Frontmatter now has avatar: testkey.webp
    const [, , writtenBody] = writeIdentityFileMock.mock.calls[0];
    const fm = loadWrittenFrontmatter(writtenBody as string);
    expect(fm.avatar).toBe("testkey.webp");
  });

  // -------------------------------------------------------------------------
  // Test 6: hostId missing → 400
  // -------------------------------------------------------------------------
  it("Test 6: missing hostId in body → 400 with 'hostId' error message", async () => {
    const body = buildMultipartBody({
      data: { title: "foo" },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(400);
    const errBody = res.body as { error?: string };
    expect(errBody.error).toBeDefined();
    expect(errBody.error?.toLowerCase()).toContain("hostid");

    // No SSH work happened
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: SSH connect failure → 502
  // -------------------------------------------------------------------------
  it("Test 7: connectOneShot rejects → 502 { error: 'identity home box unreachable' }", async () => {
    connectOneShotMock.mockRejectedValue(new Error("Host unreachable"));

    const body = buildMultipartBody({
      data: { hostId: 7, title: "will not land" },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(502);
    const errBody = res.body as { error?: string };
    expect(errBody.error).toBe("identity home box unreachable");

    // Read/write never happened because connect failed
    expect(readIdentityFileMock).not.toHaveBeenCalled();
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: readIdentityFile returns empty → 500 descriptive error (T-68-02-04)
  // -------------------------------------------------------------------------
  it("Test 8: readIdentityFile returns empty markdown → 500 'identity file missing on target host'", async () => {
    readIdentityFileMock.mockResolvedValue({ markdown: "" });

    const body = buildMultipartBody({
      data: { hostId: 7, title: "orphan" },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(500);
    const errBody = res.body as { error?: string };
    expect(errBody.error).toBe("identity file missing on target host");

    // Never wrote anything
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
    expect(writeAvatarSiblingFileMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 9: LOCAL branch — isLocalHostId true → conn=null across all helpers
  // -------------------------------------------------------------------------
  it("Test 9: LOCAL branch (isLocalHostId=true) → connectOneShot NEVER called; all helpers get conn=null", async () => {
    isLocalHostIdMock.mockReturnValue(true);

    const body = buildMultipartBody({
      data: { hostId: 1, title: "Local Edit" },
      file: {
        filename: "avatar.png",
        contentType: "image/png",
        bytes: Buffer.from("localpng"),
      },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    expect(connectOneShotMock).not.toHaveBeenCalled();

    // The handler re-reads the identity file post-write so the response echoes true
    // disk cosmetics. In the LOCAL branch that means readIdentityFile is called TWICE
    // (pre-write overlay parse + post-write echo re-read); both calls must pass
    // conn=null since we never opened an SSH connection.
    expect(readIdentityFileMock).toHaveBeenCalledTimes(2);
    expect(readIdentityFileMock.mock.calls[0][0]).toBeNull();
    expect(readIdentityFileMock.mock.calls[1][0]).toBeNull();

    expect(writeIdentityFileMock).toHaveBeenCalledTimes(1);
    expect(writeIdentityFileMock.mock.calls[0][0]).toBeNull();

    expect(writeAvatarSiblingFileMock).toHaveBeenCalledTimes(1);
    expect(writeAvatarSiblingFileMock.mock.calls[0][0]).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 10 (Phase 68-02): PUT /identities/nonexistent-key with missing on-disk
  // .md → 500 'identity file missing on target host' (T-68-02-04 preserved)
  // -------------------------------------------------------------------------
  it("Test 10 (NEW, Phase 68-02): PUT /identities/nonexistent-key where .md missing on disk → 500 'identity file missing on target host'", async () => {
    // The key "nonexistent-key" doesn't have a .md file on disk
    readIdentityFileMock.mockResolvedValue({ markdown: "" });

    const body = buildMultipartBody({
      data: { hostId: 7, title: "will not land" },
    });

    // Use the identityKey directly in the URL — no DB row lookup to check existence
    const res = await httpPut(server, "/identities/nonexistent-key", body);

    expect(res.status).toBe(500);
    const errBody = res.body as { error?: string };
    expect(errBody.error).toBe("identity file missing on target host");

    // Never wrote anything
    expect(writeIdentityFileMock).not.toHaveBeenCalled();
    expect(writeAvatarSiblingFileMock).not.toHaveBeenCalled();
    // Phase 68-02: no row bump, no forceSave
    expect(dbState.lastUpdateSetKeys).toBeNull();
    expect(forceSaveMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 11 (Phase 67 /close 2026-09-01 follow-up, H1): coordinator round-trip
  // -------------------------------------------------------------------------
  // The PUT response body must echo the identity's true on-disk `coordinator`
  // state. The handler re-reads disk cosmetics after write and passes them
  // through publicIdentity(..., cosmetics) so the response reflects reality —
  // coordinator=true here must round-trip as true.
  it("Test 11 (H1): PUT response echoes coordinator:true from disk after write", async () => {
    // The mock's writeIdentityFile is a spy — it does NOT actually mutate the
    // markdown fixture. So the post-write re-read returns the SAME fixture we
    // seeded. Seed with coordinator: true; the re-read + overlay must
    // surface it in the response.
    readIdentityFileMock.mockResolvedValue({
      markdown:
        "---\nrole: box-maintainer\ndisplayName: Coord\ntitle: Coordinator\ncolorHue: 216\ncoordinator: true\n---\n\n# testkey\n",
    });

    const body = buildMultipartBody({
      data: { hostId: 7, title: "New Title" },
    });

    const res = await httpPut(server, "/identities/testkey", body);

    expect(res.status).toBe(200);
    const responseBody = res.body as {
      coordinator?: boolean;
      title?: string | null;
      colorHue?: number | null;
      displayName?: string;
    };
    // Pre-fix this was false (safe-default from publicIdentity with no overlay).
    // Post-fix the disk-read overlay lifts the true value into the response.
    expect(responseBody.coordinator).toBe(true);
    // Side-benefit assertion: title/colorHue/displayName also echo from disk
    // (closes the pre-existing "stale echo" TODO).
    expect(responseBody.displayName).toBe("Coord");
    expect(responseBody.colorHue).toBe(216);
    // readIdentityFile called twice: once pre-write (to load frontmatter for
    // overlay) and once post-write (echo re-read for the response).
    expect(readIdentityFileMock).toHaveBeenCalledTimes(2);
  });

});
