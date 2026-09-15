/**
 * GET /identities must not exceed the per-host SSH channel cap.
 *
 * Regression guard for the exhaustion stacy reported 2026-09-15: the disk
 * fanout opened 3 channels per identity (identity file + `.pinned` +
 * `.hidden`) plus one per distinct role, all uncapped on a single
 * connection. sshd's default MaxSessions=10 refused the overflow, the
 * per-identity catch swallowed the refusal, and the identity silently
 * vanished from the roster — durably, since a reload hit the same ceiling.
 *
 * The invariant these tests lock is PEAK CONCURRENT CHANNELS, counted across
 * every channel type together. Asserting per-identity slots instead would
 * pass while still permitting 8 × 3 = 24 concurrent channels, which is the
 * bug. The cap must therefore be observed at the leaf channel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

let mockUserId: string | null = "test-user";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
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
  },
}));

vi.mock("nanoid", () => ({ nanoid: () => "nano-generated-id" }));

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
// Channel accounting — every mocked SSH read enters/exits through these, so
// `peak` is the real concurrent-channel high-water mark for the request.
// ---------------------------------------------------------------------------

let live = 0;
let peak = 0;

/** Simulates one SSH channel that stays open across a macrotask. */
async function channel<T>(value: T): Promise<T> {
  live++;
  if (live > peak) peak = live;
  try {
    // Two awaits: long enough that a truly-parallel wave overlaps here.
    await new Promise((r) => setTimeout(r, 1));
    await new Promise((r) => setTimeout(r, 1));
    return value;
  } finally {
    live--;
  }
}

const IDENTITY_MD = "---\nrole: box-maintainer\n---\n# body\n";

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: () => channel({ markdown: IDENTITY_MD }),
  listIdentityKeysOnHost: () => channel(currentKeys),
  readRoleFileByName: () => channel({ markdown: "---\ncolorHue: 100\n---\n" }),
  readAvatarSiblingFileByRole: () => channel(null),
  readAvatarSiblingFile: () => channel(null),
  writeIdentityFile: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  isLocalHostId: () => false,
  getLocalIdentitiesRoot: () => "/tmp/test-identities",
  MIME_TO_AVATAR_EXT: { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" },
  AVATAR_MIME_FROM_EXT: { webp: "image/webp", png: "image/png", jpg: "image/jpeg" },
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  extractRoleFromMarkdown: (md: string) =>
    md.includes("role: box-maintainer") ? "box-maintainer" : null,
  extractCosmeticsFromFrontmatter: () => ({}),
}));

vi.mock("../../claude-session/per-identity-file.js", () => ({
  identityFileExists: () => channel(false),
  writeIdentityFile: vi.fn(),
  removeIdentityFile: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  ALLOWED_REL_PATHS: new Set([".pinned", ".hidden"]),
}));

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: () => Promise.resolve({ __fake: "conn", end: vi.fn() }),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn().mockResolvedValue({
    ip: "10.0.0.5", port: 22, username: "ubuntu", authType: "key", key: "fake-key",
  }),
}));

let currentKeys: string[] = [];

import identitiesRouter from "./identities.js";
import { __resetHostSemaphoreRegistryForTests } from "../../ssh/host-semaphore-registry.js";

/**
 * sshd's default MaxSessions. getHostSemaphore defaults to 8, leaving 2
 * channels of headroom, so anything at or above this number is a refusal.
 */
const MAX_SESSIONS = 10;

function httpGet(server: http.Server, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request({ hostname: "127.0.0.1", port, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* leave as text */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  live = 0;
  peak = 0;
  __resetHostSemaphoreRegistryForTests();

  const app = express();
  app.use("/identities", identitiesRouter);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

function query(keys: string[]): string {
  currentKeys = keys;
  const map = Object.fromEntries(keys.map((k) => [k, 11]));
  return `/identities?identityHosts=${encodeURIComponent(JSON.stringify(map))}`;
}

describe("GET /identities — per-host SSH channel cap", () => {
  it("returns all 4 identities without exceeding MaxSessions (the reported repro)", async () => {
    const res = await httpGet(server, query(["balor", "cairo", "merit", "zeus"]));
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBe(4);
    expect((res.body as { identityKey: string }[]).map((i) => i.identityKey)).toContain("zeus");
    expect(peak).toBeLessThan(MAX_SESSIONS);
  });

  it("holds the cap at 12 identities (36 channels' worth of demand)", async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `agent${i}`);
    const res = await httpGet(server, query(keys));
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBe(12);
    expect(peak).toBeLessThan(MAX_SESSIONS);
  });

  it("caps at 8, not merely under MaxSessions", async () => {
    const keys = Array.from({ length: 8 }, (_, i) => `agent${i}`);
    await httpGet(server, query(keys));
    expect(peak).toBeLessThanOrEqual(8);
  });
});
