/**
 * Phase 90 Plan 90-08: POST /roles/:name/avatar upload endpoint tests.
 *
 * Byte-shape mirror of the identity-avatar-serve tests (roles.test.ts) — same
 * bare-Express-app + vi.mock scaffold. Multipart file uploads use Node's
 * built-in FormData/Blob (Node 18+ has both globally) so we don't have to
 * hand-roll multipart boundary strings.
 *
 * Test coverage (10 cases — plan spec):
 *   A: happy path — 201 with {filename, avatarUrl}; both writers called
 *      with the expected arguments; frontmatter round-trip carries `avatar:`
 *      overwrite via readRoleFileByName + writeRoleFileByName.
 *   B: invalid roleName (UPPERCASE_INVALID) → 400 BEFORE multer or writers.
 *   C: missing hostId → 400 before writers.
 *   D: missing file part → 400 { error: "no avatar file" }
 *   E: unsupported MIME → 415 with allowed-list.
 *   F: oversize payload (>ROLE_AVATAR_MAX_BYTES) → 413 with max-bytes.
 *   G: unresolvable host (resolveHostById returns null) → 502.
 *   H: writeRoleAvatarByName throws → 502 with generic error (no upstream leakage).
 *   I: backward-compat A — role frontmatter WITHOUT `avatar:` key gains it.
 *   J: backward-compat B — role frontmatter WITH prior `avatar:` value is
 *      OVERWRITTEN to the new filename (not appended/duplicated).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — same pattern as roles.test.ts
// ---------------------------------------------------------------------------

let mockUserId: string | null = "user-1";

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
            return res.status(401).json({ error: "Missing authentication token" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Host resolver / SSH mocks
// ---------------------------------------------------------------------------

let mockResolvedHost: unknown = { id: 3, host: "t1000", user: "user-1" };

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(async () => mockResolvedHost),
}));

const MOCK_CONN = { __mock: "ssh-conn", end: vi.fn() };

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => MOCK_CONN),
}));

// ---------------------------------------------------------------------------
// identity-artifact-reader mock — captures reader/writer args + toggles.
// ---------------------------------------------------------------------------

let mockIsLocal = false;
let mockReadRoleFile: (
  conn: unknown,
  roleName: string,
) => Promise<{ markdown: string }> = async () => ({
  markdown: "---\ntitle: Box Maintainer\ncolorHue: 200\n---\n\nrole body\n",
});
let mockWriteRoleAvatarShouldThrow = false;
let mockWriteRoleFileShouldThrow = false;

// Recorded calls — asserted per-test.
const recordedRoleAvatarWrites: Array<{
  conn: unknown;
  roleName: string;
  filename: string;
  bytes: Buffer;
}> = [];
const recordedRoleFileWrites: Array<{
  conn: unknown;
  roleName: string;
  contents: string;
}> = [];
const recordedRoleFileReads: Array<{ conn: unknown; roleName: string }> = [];

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: (hostId: number | undefined) =>
    mockIsLocal && hostId !== undefined,
  readRoleFileByName: (conn: unknown, roleName: string) => {
    recordedRoleFileReads.push({ conn, roleName });
    return mockReadRoleFile(conn, roleName);
  },
  // These are still imported by roles.ts but only used by the GET handler —
  // tests here don't exercise GET. Provide no-op defaults.
  readAvatarSiblingFileByRole: async () => null,
  extractCosmeticsFromFrontmatter: () => ({}),
  writeRoleAvatarByName: async (
    conn: unknown,
    roleName: string,
    filename: string,
    bytes: Buffer,
  ) => {
    if (mockWriteRoleAvatarShouldThrow) {
      throw new Error("simulated writeRoleAvatarByName failure");
    }
    recordedRoleAvatarWrites.push({ conn, roleName, filename, bytes });
  },
  writeRoleFileByName: async (
    conn: unknown,
    roleName: string,
    contents: string,
  ) => {
    if (mockWriteRoleFileShouldThrow) {
      throw new Error("simulated writeRoleFileByName failure");
    }
    recordedRoleFileWrites.push({ conn, roleName, contents });
  },
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
}));

// Silence sshLogger + databaseLogger noise from the route under test.
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
  databaseLogger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Multipart HTTP helper — uses Node 18+ FormData/Blob to POST a multipart
// body without hand-rolling boundary strings.
// ---------------------------------------------------------------------------

async function postMultipart(
  server: http.Server,
  urlPath: string,
  file: { field: string; name: string; type: string; bytes: Buffer } | null,
): Promise<{ status: number; body: unknown; rawBuffer: Buffer }> {
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}${urlPath}`;

  // Build FormData with an optional file part. Blob accepts Buffer / Uint8Array
  // in Node 18+ via the undici implementation.
  const fd = new FormData();
  if (file) {
    fd.append(
      file.field,
      new Blob([new Uint8Array(file.bytes)], { type: file.type }),
      file.name,
    );
  }

  const response = await fetch(url, { method: "POST", body: fd });
  const raw = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get("content-type") ?? "");
  let parsed: unknown;
  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      parsed = raw.toString();
    }
  } else {
    parsed = raw;
  }
  return { status: response.status, body: parsed, rawBuffer: raw };
}

// A "POST but with NO body at all" flavor for cases where we want to hit the
// handler chain without multer receiving a multipart payload. We still send
// a Content-Type that multer accepts, but with an empty body — multer sees
// no fields, so req.file stays undefined.
async function postEmptyMultipart(
  server: http.Server,
  urlPath: string,
): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}${urlPath}`;
  const fd = new FormData();
  const response = await fetch(url, { method: "POST", body: fd });
  const contentType = String(response.headers.get("content-type") ?? "");
  const rawText = await response.text();
  let parsed: unknown = rawText;
  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      /* keep as text */
    }
  }
  return { status: response.status, body: parsed };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;

async function startServer(): Promise<http.Server> {
  const mod = await import("./roles.js");
  const router = mod.default;
  const app = express();
  app.use("/roles", router);
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

beforeEach(async () => {
  mockUserId = "user-1";
  mockResolvedHost = { id: 3, host: "t1000", user: "user-1" };
  mockIsLocal = false;
  mockWriteRoleAvatarShouldThrow = false;
  mockWriteRoleFileShouldThrow = false;
  mockReadRoleFile = async () => ({
    markdown: "---\ntitle: Box Maintainer\ncolorHue: 200\n---\n\nrole body\n",
  });
  recordedRoleAvatarWrites.length = 0;
  recordedRoleFileWrites.length = 0;
  recordedRoleFileReads.length = 0;
  MOCK_CONN.end.mockClear?.();
  server = await startServer();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Fixture: a plausible PNG-header byte payload (just for shape; contents
// don't matter — the mocked writeRoleAvatarByName doesn't inspect them).
// ---------------------------------------------------------------------------

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 90 Plan 90-08: POST /roles/:name/avatar", () => {
  // -------------------------------------------------------------------------
  // Test A: happy path
  // -------------------------------------------------------------------------

  it("A: happy path — 201 with {filename, avatarUrl}; both writers called with expected args", async () => {
    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "picked-by-user.png",
        type: "image/png",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(201);
    const body = res.body as { filename: string; avatarUrl: string };
    // Filename derived server-side from MIME → `<roleName>.<ext>`. Client's
    // "picked-by-user.png" is intentionally DISCARDED per T-90-08-01.
    expect(body.filename).toBe("box-maintainer.png");
    expect(body.avatarUrl).toBe("/roles/box-maintainer/avatar?hostId=3");

    // writeRoleAvatarByName invoked once with (MOCK_CONN, roleName, filename, buffer).
    expect(recordedRoleAvatarWrites).toHaveLength(1);
    expect(recordedRoleAvatarWrites[0].conn).toBe(MOCK_CONN);
    expect(recordedRoleAvatarWrites[0].roleName).toBe("box-maintainer");
    expect(recordedRoleAvatarWrites[0].filename).toBe("box-maintainer.png");
    expect(Buffer.compare(recordedRoleAvatarWrites[0].bytes, PNG_HEADER)).toBe(0);

    // Frontmatter round-trip: readRoleFileByName called, writeRoleFileByName
    // called with a new markdown body carrying `avatar: box-maintainer.png`.
    expect(recordedRoleFileReads).toHaveLength(1);
    expect(recordedRoleFileWrites).toHaveLength(1);
    const rewritten = recordedRoleFileWrites[0].contents;
    expect(rewritten).toMatch(/^---\n/);
    expect(rewritten).toContain("avatar: box-maintainer.png");
    // Prior frontmatter keys (title, colorHue) preserved.
    expect(rewritten).toContain("title: Box Maintainer");
    expect(rewritten).toContain("colorHue: 200");
    // Body preserved after frontmatter.
    expect(rewritten).toContain("role body");
  });

  // -------------------------------------------------------------------------
  // Test B: invalid roleName → 400 BEFORE any writer
  // -------------------------------------------------------------------------

  it("B: invalid roleName (UPPERCASE_INVALID) → 400 before writers fire", async () => {
    const res = await postMultipart(
      server,
      "/roles/UPPERCASE_INVALID/avatar?hostId=3",
      {
        field: "avatar",
        name: "avatar.png",
        type: "image/png",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/name must match/i);
    // Never reached the writer OR the reader.
    expect(recordedRoleAvatarWrites).toHaveLength(0);
    expect(recordedRoleFileReads).toHaveLength(0);
    expect(recordedRoleFileWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test C: missing hostId → 400
  // -------------------------------------------------------------------------

  it("C: missing hostId query → 400 before writers fire", async () => {
    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar",
      {
        field: "avatar",
        name: "avatar.png",
        type: "image/png",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(400);
    expect(recordedRoleAvatarWrites).toHaveLength(0);
    expect(recordedRoleFileReads).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test D: missing file part → 400 { error: "no avatar file" }
  // -------------------------------------------------------------------------

  it("D: missing multipart file part → 400 { error: 'no avatar file' }", async () => {
    const res = await postEmptyMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
    );

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("no avatar file");
    expect(recordedRoleAvatarWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test E: unsupported MIME → 415
  // -------------------------------------------------------------------------

  it("E: unsupported MIME (image/bmp) → 415 with allowed-list", async () => {
    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "sad-attempt.bmp",
        type: "image/bmp",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(415);
    const body = res.body as { error: string; allowed: string[] };
    expect(body.error).toBe("unsupported avatar format");
    expect(Array.isArray(body.allowed)).toBe(true);
    // Allowed list must include the four raster MIMEs.
    expect(body.allowed).toEqual(
      expect.arrayContaining(["image/webp", "image/png", "image/jpeg", "image/gif"]),
    );
    expect(recordedRoleAvatarWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test F: oversize → 413
  // -------------------------------------------------------------------------

  it("F: oversize payload (>5 MB) → 413 with max-bytes", async () => {
    // Build a 6 MB buffer (well over the 5 MB cap).
    const bigPayload = Buffer.alloc(6 * 1024 * 1024, 0x77);

    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "too-big.png",
        type: "image/png",
        bytes: bigPayload,
      },
    );

    expect(res.status).toBe(413);
    const body = res.body as { error: string; maxBytes: number };
    expect(body.error).toBe("avatar too large");
    expect(body.maxBytes).toBe(5 * 1024 * 1024);
    expect(recordedRoleAvatarWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test G: unresolvable host → 502
  // -------------------------------------------------------------------------

  it("G: resolveHostById returns null → 502", async () => {
    mockResolvedHost = null;

    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "avatar.png",
        type: "image/png",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/unreachable/i);
    // Writers never fired — host resolution failed before we got there.
    expect(recordedRoleAvatarWrites).toHaveLength(0);
    expect(recordedRoleFileWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test H: writeRoleAvatarByName throws → 502 with GENERIC error (no leak)
  // -------------------------------------------------------------------------

  it("H: writeRoleAvatarByName throws → 502 with generic error (no upstream leak)", async () => {
    mockWriteRoleAvatarShouldThrow = true;

    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "avatar.png",
        type: "image/png",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(502);
    const body = res.body as { error: string };
    // Generic error only — no upstream detail like "simulated ... failure".
    expect(body.error).toMatch(/unreachable/i);
    expect(JSON.stringify(res.body)).not.toContain("simulated");
    // Frontmatter write must not have fired (writer threw first).
    expect(recordedRoleFileWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test I: backward-compat A — frontmatter WITHOUT `avatar:` key gains it
  // -------------------------------------------------------------------------

  it("I: role frontmatter WITHOUT `avatar:` key gains the new avatar filename", async () => {
    // Note: current default has no avatar key already. Add explicit test.
    mockReadRoleFile = async () => ({
      markdown: "---\ntitle: Box Maintainer\n---\n\nsome body\n",
    });

    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "picked.webp",
        type: "image/webp",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(201);
    expect(recordedRoleFileWrites).toHaveLength(1);
    const rewritten = recordedRoleFileWrites[0].contents;
    // avatar key was ADDED (didn't exist before).
    expect(rewritten).toContain("avatar: box-maintainer.webp");
    // Prior key preserved.
    expect(rewritten).toContain("title: Box Maintainer");
    // Body preserved.
    expect(rewritten).toContain("some body");
    // Only ONE avatar line — not duplicated.
    const avatarLines = rewritten
      .split("\n")
      .filter((l) => l.trim().startsWith("avatar:"));
    expect(avatarLines).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test J: backward-compat B — prior `avatar:` value is OVERWRITTEN
  // -------------------------------------------------------------------------

  it("J: existing `avatar:` value is OVERWRITTEN to the new filename (not duplicated)", async () => {
    mockReadRoleFile = async () => ({
      markdown:
        "---\ntitle: Box Maintainer\navatar: old-value.png\ncolorHue: 200\n---\n\nbody\n",
    });

    const res = await postMultipart(
      server,
      "/roles/box-maintainer/avatar?hostId=3",
      {
        field: "avatar",
        name: "new-upload.webp",
        type: "image/webp",
        bytes: PNG_HEADER,
      },
    );

    expect(res.status).toBe(201);
    expect(recordedRoleFileWrites).toHaveLength(1);
    const rewritten = recordedRoleFileWrites[0].contents;
    // Old value gone.
    expect(rewritten).not.toContain("old-value.png");
    // New value present.
    expect(rewritten).toContain("avatar: box-maintainer.webp");
    // Only one avatar line — not appended alongside the old one.
    const avatarLines = rewritten
      .split("\n")
      .filter((l) => l.trim().startsWith("avatar:"));
    expect(avatarLines).toHaveLength(1);
    // Other cosmetic keys preserved.
    expect(rewritten).toContain("title: Box Maintainer");
    expect(rewritten).toContain("colorHue: 200");
  });
});
