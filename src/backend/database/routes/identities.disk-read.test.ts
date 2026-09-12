/**
 * Phase 92 Plan 92-02 Task 1: Tests for the pinned:boolean field on publicIdentity
 * + the disk-fanout `.pinned` probe in GET /identities.
 *
 * ─── publicIdentity() shape extension (Phase 92) ────────────────────────────
 * Signature grows a SIXTH argument `pinned: boolean` (default false → fail-closed
 * per D-01). Returned object gains `pinned` alongside the existing 12 fields
 * (identityKey, displayName, title, colorHue, voice, task, avatarMime, avatarUrl,
 * avatarEtag, coordinator, role, roleDefaults).
 *
 * ─── GET /identities disk-fanout extension (Phase 92) ───────────────────────
 * The per-host inner Promise.all that reads role frontmatter for each identityKey
 * ALSO probes identityFileExists(identityKey, ".pinned", { hostId, conn }) in
 * the SAME wave (not a second serial round-trip). The resolved boolean threads
 * into the publicIdentity call as the sixth argument. Any exists-failure →
 * pinned:false (fail-closed, D-01 "presence is meaning" — a stat failure MUST
 * NOT paint an identity as pinned).
 *
 * ─── H3 lowercase-on-disk invariant (Phase 92) ──────────────────────────────
 * identityKey passed to identityFileExists MUST be the raw folder name returned
 * by listIdentityKeysOnHost — VERBATIM, no case coercion. The reader regex
 * (identity-artifact-reader.ts:174 IDENTITY_KEY_RE `/^[a-z0-9_-]{1,64}$/`)
 * guarantees this string is already lowercase, so the primitive's on-disk
 * folder segment MATCHES byte-for-byte. PUB-92-06 asserts this positively:
 * the identityFileExists spy receives the same string listIdentityKeysOnHost
 * returned.
 *
 * Test surface: 6 tests
 *   PUB-92-01  pinned:false when identityFileExists returns false
 *   PUB-92-02  pinned:true when identityFileExists returns true
 *   PUB-92-03  pinned:false when identityFileExists throws (fail-closed)
 *   PUB-92-04  disk-fanout probes .pinned in the SAME Promise.all wave as role frontmatter
 *   PUB-92-05  no per-identity memo — each identity gets its own identityFileExists call
 *   PUB-92-06  H3 lock: identityKey passed VERBATIM to identityFileExists byte-for-byte
 *
 * Scaffold mirrors identities.get-disk.test.ts: bare Express + node http.request,
 * vi.mock on identity-artifact-reader, ssh-one-shot, host-resolver, tmux-helper,
 * PLUS per-identity-file.
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
// In-memory identities table shim (kept minimal — GET / uses no DB)
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: () => ({ __type: "eq" }),
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
    where: () => chain,
    all: () => [],
    insert: () => chain,
    values: () => chain,
    update: () => chain,
    set: () => chain,
    delete: () => chain,
    run: () => {},
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
const listIdentityKeysOnHostMock = vi.fn();
const readRoleFileByNameMock = vi.fn();
const readAvatarSiblingFileByRoleMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: (conn: unknown, key: string) => readIdentityFileMock(conn, key),
  listIdentityKeysOnHost: (conn: unknown) => listIdentityKeysOnHostMock(conn),
  writeIdentityFile: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  readAvatarSiblingFile: (conn: unknown, key: string) =>
    readAvatarSiblingFileMock(conn, key),
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
    if (typeof src.colorHue === "number" && src.colorHue >= 0 && src.colorHue <= 359) out.colorHue = src.colorHue;
    if (typeof src.voice === "string" && src.voice.length > 0) out.voice = src.voice;
    if (typeof src.avatar === "string" && src.avatar.length > 0) out.avatar = src.avatar;
    if (typeof src.coordinator === "boolean") out.coordinator = src.coordinator;
    if (typeof src.task === "string" && src.task.length > 0) out.task = src.task;
    return out;
  },
}));

// ---------------------------------------------------------------------------
// per-identity-file mock — Phase 92 Plan 92-02 wires identityFileExists
// ---------------------------------------------------------------------------

const identityFileExistsMock = vi.fn();

vi.mock("../../claude-session/per-identity-file.js", () => ({
  identityFileExists: (name: string, relPath: string, opts: unknown) =>
    identityFileExistsMock(name, relPath, opts),
  writeIdentityFile: vi.fn(),
  removeIdentityFile: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  ALLOWED_REL_PATHS: new Set(["relay.json", ".pinned"]),
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
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "GET", path },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: unknown = text;
          const ct = res.headers["content-type"] || "";
          if (typeof ct === "string" && ct.includes("application/json")) {
            try { parsed = JSON.parse(text); } catch { /* leave as text */ }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
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

  // Default mocks
  listIdentityKeysOnHostMock.mockResolvedValue([]);
  readIdentityFileMock.mockResolvedValue({ markdown: "" });
  readAvatarSiblingFileMock.mockResolvedValue(null);
  isLocalHostIdMock.mockReturnValue(false);
  connectOneShotMock.mockResolvedValue(makeFakeConnWithEnd());
  readRoleFileByNameMock.mockResolvedValue({ markdown: "" });
  readAvatarSiblingFileByRoleMock.mockResolvedValue(null);
  // Default pinned probe → false (fail-closed)
  identityFileExistsMock.mockResolvedValue(false);

  const app = express();
  app.use("/identities", identitiesRouter);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ===========================================================================
// publicIdentity direct unit tests — the sixth `pinned` argument
// ===========================================================================

describe("publicIdentity — Phase 92 pinned:boolean field", () => {
  it("PUB-92-signature-1: publicIdentity accepts a sixth `pinned` arg + emits it verbatim in the returned object", () => {
    const out = publicIdentity(
      "tina",
      1,
      { displayName: "Tina" },
      "box-maintainer",
      null,
      true,
    );
    expect(out).toHaveProperty("pinned", true);
  });

  it("PUB-92-signature-2: pinned arg defaults to false when omitted (fail-closed per D-01)", () => {
    const out = publicIdentity("poppy", 5, {}, null);
    expect(out).toHaveProperty("pinned", false);
  });

  it("PUB-92-signature-3: pinned=false → pinned:false emitted (round-trip)", () => {
    const out = publicIdentity(
      "moxie",
      3,
      { displayName: "Moxie" },
      "role-x",
      null,
      false,
    );
    expect(out.pinned).toBe(false);
  });
});

// ===========================================================================
// GET /identities disk-fanout — .pinned probe wiring
// ===========================================================================

describe("GET /identities — Phase 92 disk-fanout .pinned probe", () => {
  it("PUB-92-01: identityFileExists returns false → response has pinned:false", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("pinned", false);
  });

  it("PUB-92-02: identityFileExists returns true → response has pinned:true", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(true);

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("pinned", true);
  });

  it("PUB-92-03: identityFileExists throws → response has pinned:false (fail-closed per D-01)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // Simulate a stat failure — the primitive itself is fail-closed on REMOTE,
    // but on LOCAL an unlucky throw could bubble. The fanout MUST swallow.
    identityFileExistsMock.mockRejectedValue(new Error("stat failed"));

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    // Response must NOT be 5xx — a bad .pinned probe must not fail the fanout.
    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // pinned:false — fail-closed. A stat failure must NEVER paint pinned:true.
    expect(rows[0]).toHaveProperty("pinned", false);
  });

  it("PUB-92-04: pin probe runs in parallel with the per-identity disk read (same Promise.all wave, not a serial second round-trip)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy"]);

    // Hold readIdentityFile pending so the fanout STOPS at the per-identity
    // fan. If the pin probe were serialized AFTER readIdentityFile, it would
    // never be called until readIdentityFile resolved. It fires here BEFORE
    // that resolution because it sits in the SAME Promise.all wave.
    let readIdentityResolvers: Array<() => void> = [];
    readIdentityFileMock.mockImplementation(() => {
      return new Promise((resolve) => {
        readIdentityResolvers.push(() =>
          resolve({
            markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
          }),
        );
      });
    });

    identityFileExistsMock.mockResolvedValue(true);

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 1 }));
    const inFlight = httpGet(server, `/identities?identityHosts=${hostsJson}`);

    // Let microtasks settle so listIdentityKeysOnHost + per-key fanout dispatch.
    await new Promise((r) => setTimeout(r, 30));

    // With readIdentityFile still pending, the pin probe MUST have already
    // been called for each identity — proving the fanout kicks the probe off
    // in the SAME Promise.all wave as readIdentityFile, not after it resolves.
    expect(identityFileExistsMock.mock.calls.length).toBe(2);
    // Sanity check: readIdentityFile has been called too (both are in-flight).
    expect(readIdentityFileMock.mock.calls.length).toBe(2);

    // Resolve everything so the request completes.
    for (const r of readIdentityResolvers) r();
    const res = await inFlight;
    expect(res.status).toBe(200);
  });

  it("PUB-92-05: no per-identity memo — identityFileExists called ONCE PER IDENTITY (not deduplicated)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy", "moxie"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(
      JSON.stringify({ tina: 1, poppy: 1, moxie: 1 }),
    );
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    // Three identities → three probes (unlike role-cosmetics which shares across
    // identities via the per-host memo).
    expect(identityFileExistsMock).toHaveBeenCalledTimes(3);
  });

  it("PUB-92-06: H3 lock — identityKey passed VERBATIM to identityFileExists byte-for-byte (no case coercion, no reconstruction)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    // Include an underscore + hyphen-digit key to cover the reader regex range.
    // No uppercase in this list — the reader regex forbids uppercase folder
    // names, so any key the fanout sees is guaranteed lowercase; the test
    // asserts the fanout does NOT re-introduce a capitalized variant.
    const folderNames = ["tina", "alice-01", "role_underscore"];
    listIdentityKeysOnHostMock.mockResolvedValue(folderNames);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(
      JSON.stringify({ tina: 1, "alice-01": 1, role_underscore: 1 }),
    );
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);
    expect(res.status).toBe(200);

    // Collect every identityFileExists call's first arg (the identityKey).
    const receivedKeys = identityFileExistsMock.mock.calls.map(
      (c) => c[0] as string,
    );

    // Every folder name enumerated by listIdentityKeysOnHost MUST appear in
    // identityFileExists calls — verbatim, byte-for-byte.
    for (const expected of folderNames) {
      expect(receivedKeys).toContain(expected);
    }

    // Positive-shape lock: no uppercase-containing identityKey argument ever
    // reaches the primitive from this handler (the reader regex forbids
    // uppercase folder names; the fanout must not re-introduce them via
    // displayName substitution or any other cosmetic derivation).
    for (const k of receivedKeys) {
      expect(k).toBe(k.toLowerCase());
    }

    // Every call also uses the ".pinned" relPath verbatim.
    for (const call of identityFileExistsMock.mock.calls) {
      expect(call[1]).toBe(".pinned");
    }
  });
});

// ===========================================================================
// Phase 107 Plan 107-02: publicIdentity.hidden + disk-fanout .hidden probe
// ===========================================================================
//
// Mirrors the PUB-92-* topology exactly for the `.hidden` axis:
//   PUB-107-signature-1/2/3 — publicIdentity's seventh `hidden` arg
//   HID-107-01..06          — GET /identities disk-fanout .hidden probe wiring
//
// identityFileExists spy is extended via mockImplementation to differentiate
// `.pinned` vs `.hidden` via the second argument, per Task 1 action guidance.

describe("publicIdentity — Phase 107 Plan 107-02: hidden:boolean field (seventh arg)", () => {
  it("PUB-107-signature-1: publicIdentity with SIX args (omitting hidden) returns hidden:false (fail-closed default per D-01)", () => {
    const out = publicIdentity(
      "tina",
      1,
      { displayName: "Tina" },
      "box-maintainer",
      null,
      false, // pinned — sixth arg
      // hidden omitted — seventh arg defaults to false
    );
    expect(out).toHaveProperty("hidden", false);
  });

  it("PUB-107-signature-2: publicIdentity with SEVEN args (hidden:true) surfaces hidden:true in the returned object", () => {
    const out = publicIdentity(
      "tina",
      1,
      { displayName: "Tina" },
      "box-maintainer",
      null,
      false, // pinned
      true,  // hidden — seventh arg
    );
    expect(out).toHaveProperty("hidden", true);
  });

  it("PUB-107-signature-3: pinned and hidden are INDEPENDENT axes — passing pinned:true hidden:false returns both values correctly", () => {
    const out = publicIdentity(
      "tina",
      1,
      { displayName: "Tina" },
      "box-maintainer",
      null,
      true,  // pinned
      false, // hidden
    );
    expect(out.pinned).toBe(true);
    expect(out.hidden).toBe(false);
  });
});

describe("GET /identities — Phase 107 Plan 107-02 disk-fanout .hidden probe", () => {
  it("HID-107-01: identityFileExists returns false for .hidden → response.hidden:false; pinned unaffected", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // .pinned=true, .hidden=false
    identityFileExistsMock.mockImplementation(
      (_key: string, relPath: string) =>
        Promise.resolve(relPath === ".pinned"),
    );

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("hidden", false);
    expect(rows[0]).toHaveProperty("pinned", true);
  });

  it("HID-107-02: identityFileExists returns true for .hidden → response.hidden:true; pinned unaffected", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // .pinned=false, .hidden=true
    identityFileExistsMock.mockImplementation(
      (_key: string, relPath: string) =>
        Promise.resolve(relPath === ".hidden"),
    );

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("hidden", true);
    expect(rows[0]).toHaveProperty("pinned", false);
  });

  it("HID-107-03: identityFileExists throws for .hidden → response.hidden:false (fail-closed per D-01); pinned probe unaffected", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: Tina\n---\n",
    });
    // .pinned → true (resolves); .hidden → throws
    identityFileExistsMock.mockImplementation(
      (_key: string, relPath: string) => {
        if (relPath === ".hidden") {
          return Promise.reject(new Error("stat failed for .hidden"));
        }
        return Promise.resolve(true); // .pinned succeeds
      },
    );

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1 }));
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    // Must NOT be 5xx — the fanout swallows .hidden probe failures.
    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // fail-closed: .hidden throw → hidden:false, MUST NOT paint identity as hidden.
    expect(rows[0]).toHaveProperty("hidden", false);
    // .pinned probe is unaffected — its result still surfaces.
    expect(rows[0]).toHaveProperty("pinned", true);
  });

  it("HID-107-04: .hidden probe runs in parallel with .pinned + readIdentityFile (same Promise.all wave, not serial)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy"]);

    // Hold readIdentityFile pending. If .hidden were serialized after
    // readIdentityFile, it wouldn't fire until readIdentityFile resolved.
    let readIdentityResolvers: Array<() => void> = [];
    readIdentityFileMock.mockImplementation(() => {
      return new Promise((resolve) => {
        readIdentityResolvers.push(() =>
          resolve({
            markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
          }),
        );
      });
    });

    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(JSON.stringify({ tina: 1, poppy: 1 }));
    const inFlight = httpGet(server, `/identities?identityHosts=${hostsJson}`);

    // Let microtasks settle so the per-key fanout dispatches.
    await new Promise((r) => setTimeout(r, 30));

    // With readIdentityFile still pending, BOTH .pinned and .hidden probes
    // MUST have already fired for each identity (2 identities × 2 probes = 4
    // calls) — proving they run in the SAME Promise.all wave.
    expect(identityFileExistsMock.mock.calls.length).toBe(4);
    // Both readIdentityFile calls are also in-flight.
    expect(readIdentityFileMock.mock.calls.length).toBe(2);

    // Resolve everything.
    for (const r of readIdentityResolvers) r();
    const res = await inFlight;
    expect(res.status).toBe(200);
  });

  it("HID-107-05: no per-identity memo — identityFileExists called ONCE PER IDENTITY PER SENTINEL TYPE (2 calls per identity: .pinned + .hidden)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    listIdentityKeysOnHostMock.mockResolvedValue(["tina", "poppy", "moxie"]);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(
      JSON.stringify({ tina: 1, poppy: 1, moxie: 1 }),
    );
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);

    expect(res.status).toBe(200);
    // 3 identities × 2 probes (.pinned + .hidden) = 6 total calls.
    expect(identityFileExistsMock).toHaveBeenCalledTimes(6);
    // Each identity gets exactly one .pinned call and one .hidden call.
    const pinnedCalls = identityFileExistsMock.mock.calls.filter(
      (c) => c[1] === ".pinned",
    );
    const hiddenCalls = identityFileExistsMock.mock.calls.filter(
      (c) => c[1] === ".hidden",
    );
    expect(pinnedCalls).toHaveLength(3);
    expect(hiddenCalls).toHaveLength(3);
  });

  it("HID-107-06: H3 lock — identityKey passed VERBATIM to identityFileExists for .hidden (byte-for-byte, no case coercion)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 1);
    const folderNames = ["tina", "alice-01", "role_underscore"];
    listIdentityKeysOnHostMock.mockResolvedValue(folderNames);
    readIdentityFileMock.mockResolvedValue({
      markdown: "---\nrole: box-maintainer\ndisplayName: X\n---\n",
    });
    identityFileExistsMock.mockResolvedValue(false);

    const hostsJson = encodeURIComponent(
      JSON.stringify({ tina: 1, "alice-01": 1, role_underscore: 1 }),
    );
    const res = await httpGet(server, `/identities?identityHosts=${hostsJson}`);
    expect(res.status).toBe(200);

    // Filter to .hidden probe calls only.
    const hiddenCalls = identityFileExistsMock.mock.calls.filter(
      (c) => c[1] === ".hidden",
    );
    const receivedKeys = hiddenCalls.map((c) => c[0] as string);

    // Every folder name from listIdentityKeysOnHost MUST appear in .hidden
    // probe calls byte-for-byte.
    for (const expected of folderNames) {
      expect(receivedKeys).toContain(expected);
    }

    // Positive-shape lock: no uppercase key ever reaches the primitive from
    // this fanout (the reader regex forbids uppercase folder names; this lock
    // catches any future refactor that accidentally re-introduces coercion).
    for (const k of receivedKeys) {
      expect(k).toBe(k.toLowerCase());
    }
  });
});
