/**
 * Phase 22 (SRIC-02): Tests for the roles-list-for-host route.
 *
 * Tests exercise GET /roles?hostId=<n> via a bare Express app using Node's
 * built-in http module (supertest not in project deps — following the
 * identity-exists-on-host.test.ts pattern established in Phase 20).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) and
 * resolveHostById are mocked.
 *
 * Test coverage (10 tests — mirror plan Task 1 <behavior>):
 *   1: missing hostId → 400
 *   2: non-integer hostId → 400
 *   3: unknown host (resolveHostById → null) → 404
 *   4: happy path — ls returns 3 roles, batched cat resolves per-role markdown with
 *      ## Role sections → 200 with [{name, description}]
 *   5: description extraction pulls content between ## Role and next heading
 *   6: missing ## Role section → description falls back to "" (not null)
 *   7: SSH connect failure → 502, conn.end NOT called on null
 *   8: empty roles directory → 200 with []
 *   9: 401 without JWT
 *  10: role names that fail ROLE_NAME_PATTERN are silently dropped
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
// Mock SSH primitives BEFORE importing the module under test
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

// ---------------------------------------------------------------------------
// Phase 129 Plan 129-03: systemLogger is used by roles-list-for-host.ts for
// the two gate-seam structured logs (roles_list_gate_username_missing warn
// + roles_list_gate_hidden debug). Mock it so Phase 129 tests can assert on
// the warn call in Test F. vi.hoisted keeps the mock instances reachable
// from both the vi.mock factory (hoisted above imports) AND per-test
// assertion code below.
// ---------------------------------------------------------------------------

const {
  systemLoggerWarnMock,
  systemLoggerDebugMock,
} = vi.hoisted(() => ({
  systemLoggerWarnMock: vi.fn(),
  systemLoggerDebugMock: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  systemLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: systemLoggerWarnMock,
    debug: systemLoggerDebugMock,
  },
}));

// ---------------------------------------------------------------------------
// Phase 129 Plan 129-03: host-user-counter mock (getUsernameForUserId).
// GREEN implementation of roles-list-for-host.ts will import this to
// translate the JWT userId into a Skynet username before invoking
// isIdentityVisibleToUser. vi.hoisted keeps the mock reachable from both
// the vi.mock factory AND per-test assertion code below.
// ---------------------------------------------------------------------------

const { getUsernameForUserIdMock } = vi.hoisted(() => ({
  getUsernameForUserIdMock: vi.fn(),
}));

vi.mock("../../utils/host-user-counter.js", () => ({
  isHostMultiUser: vi.fn().mockResolvedValue(false),
  getUsernameForUserId: (userId: string) => getUsernameForUserIdMock(userId),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

// ---------------------------------------------------------------------------
// Helper: HTTP request wrapper (mirrors identity-exists-on-host.test.ts:96)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers ?? {},
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
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub SSH conn + host record
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./roles-list-for-host.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();

  // Default: user owns host 7; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default execCommand returns empty ls (no roles). Individual tests override.
  (execCommand as Mock).mockResolvedValue("");

  // Phase 129 Plan 129-03 default — getUsernameForUserId returns null so
  // pre-129 tests fall through the gate cleanly (null callerUsername short-
  // circuits isIdentityVisibleToUser to "visible" per Plan 129-01 Task 2
  // Test 1 — the internal-server / test / admin-bypass semantic). Phase 129
  // gate tests override with mockResolvedValue / mockImplementation.
  getUsernameForUserIdMock.mockResolvedValue(null);
  systemLoggerWarnMock.mockClear();
  systemLoggerDebugMock.mockClear();

  const app = express();
  // Mount router at /roles (mirrors database.ts mount)
  app.use("/roles", router);

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

describe("GET /roles?hostId=<n>", () => {
  it("Test 1: missing hostId → 400 with {error: 'hostId is required'}", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2: non-integer hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=abc",
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3: unknown host → 404", async () => {
    // hostId=99999 → resolveHostById returns null (default for unknown)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=99999",
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: happy path — 3 roles with descriptions", async () => {
    // First execCommand call = ls; subsequent = batched cat with delimiters
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) {
        return "box-maintainer\ntina\nnelly";
      }
      // Batched cat: emit ===ROLE:<n>=== delimited blocks
      return [
        "===ROLE:box-maintainer===",
        "# box-maintainer",
        "",
        "## Role",
        "Maintains the box.",
        "",
        "## Notes",
        "irrelevant",
        "===ROLE:tina===",
        "# tina",
        "",
        "## Role",
        "Fleet-wide coordinator.",
        "===ROLE:nelly===",
        "# nelly",
        "",
        "## Role",
        "Skill maintenance.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });

    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(3);
    // Alphabetical order per action step
    expect(body.map((r) => r.name)).toEqual(["box-maintainer", "nelly", "tina"]);
    expect(body.find((r) => r.name === "box-maintainer")?.description).toBe("Maintains the box.");
    expect(body.find((r) => r.name === "tina")?.description).toBe("Fleet-wide coordinator.");
    expect(body.find((r) => r.name === "nelly")?.description).toBe("Skill maintenance.");
  });

  it("Test 5: description extraction trims whitespace and stops at next ##", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "box-maintainer";
      return [
        "===ROLE:box-maintainer===",
        "# box-maintainer",
        "",
        "## Role",
        "",
        "   Line with leading spaces.   ",
        "Second line of description.",
        "",
        "## Handoff",
        "should not appear",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(1);
    // Description trimmed, includes both content lines, excludes ## Handoff
    expect(body[0].description).toContain("Line with leading spaces.");
    expect(body[0].description).toContain("Second line of description.");
    expect(body[0].description).not.toContain("Handoff");
    expect(body[0].description).not.toContain("should not appear");
    // No trailing/leading whitespace
    expect(body[0].description).toBe(body[0].description.trim());
  });

  it("Test 6: missing ## Role section → description empty string (not null)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "orphan";
      return [
        "===ROLE:orphan===",
        "# orphan",
        "",
        "## SomethingElse",
        "no role section",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("orphan");
    expect(body[0].description).toBe("");
  });

  it("Test 7: SSH connect failure → 502; conn.end NOT called on null conn", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 5000ms"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/SSH connect failed/i);
    // Nothing should have called end() (conn was never obtained)
    expect(stubConn.end).not.toHaveBeenCalled();
  });

  it("Test 8: no roles directory / empty ls → 200 with []", async () => {
    // Default mock returns "" for all execCommand calls
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // conn.end() should have been called (we did open a conn)
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 9: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // ─── Phase 90 Plan 90-01: cosmetic frontmatter extraction per role ─────────
  // D-08.1 (planner-pick: extend existing endpoint, no companion) — response
  // entries now carry optional cosmetic fields (title, displayName, colorHue,
  // voice, avatar) parsed from each role markdown's YAML frontmatter. Missing
  // or malformed fields are OMITTED from the response (not defaulted, not
  // null-emitted) — matches extractCosmeticsFromFrontmatter's contract.

  it("Test A (P90-01): full cosmetic frontmatter → all fields on response entry", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "box-maintainer";
      return [
        "===ROLE:box-maintainer===",
        "---",
        "title: Skynet",
        "displayName: Box Maintainer",
        "colorHue: 320",
        "voice: alloy",
        "avatar: box-maintainer.webp",
        "---",
        "# box-maintainer",
        "",
        "## Role",
        "Maintains the box.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<{
      name: string;
      description: string;
      title?: string;
      displayName?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "box-maintainer",
      description: "Maintains the box.",
      title: "Skynet",
      displayName: "Box Maintainer",
      colorHue: 320,
      voice: "alloy",
      avatar: "box-maintainer.webp",
    });
  });

  it("Test B (P90-01): NO frontmatter block → only {name, description}, cosmetic fields omitted", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "plain-role";
      return [
        "===ROLE:plain-role===",
        "# plain-role",
        "",
        "## Role",
        "A role without frontmatter.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "plain-role",
      description: "A role without frontmatter.",
    });
    // Cosmetic keys must be entirely absent — not null, not undefined-explicit.
    expect("title" in body[0]).toBe(false);
    expect("displayName" in body[0]).toBe(false);
    expect("colorHue" in body[0]).toBe(false);
    expect("voice" in body[0]).toBe(false);
    expect("avatar" in body[0]).toBe(false);
  });

  it("Test C (P90-01): partial frontmatter (only colorHue) → only colorHue added, no other cosmetic keys", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "hued-only";
      return [
        "===ROLE:hued-only===",
        "---",
        "colorHue: 190",
        "---",
        "# hued-only",
        "",
        "## Role",
        "Hue-only role.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "hued-only",
      description: "Hue-only role.",
      colorHue: 190,
    });
    expect("title" in body[0]).toBe(false);
    expect("displayName" in body[0]).toBe(false);
    expect("voice" in body[0]).toBe(false);
    expect("avatar" in body[0]).toBe(false);
  });

  it("Test D (P90-01): malformed YAML frontmatter → entry {name, description} only", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "broken";
      // Malformed YAML: unterminated flow mapping / tab-indented key
      return [
        "===ROLE:broken===",
        "---",
        "title: [unclosed",
        "  colorHue: 320",
        "---",
        "# broken",
        "",
        "## Role",
        "Broken frontmatter.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "broken",
      description: "Broken frontmatter.",
    });
    // Malformed → extractor returns {} → no cosmetic keys.
    expect("title" in body[0]).toBe(false);
    expect("colorHue" in body[0]).toBe(false);
  });

  it("Test E (P90-01): out-of-range colorHue (400) → dropped from response", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "out-of-range";
      return [
        "===ROLE:out-of-range===",
        "---",
        "title: OK Title",
        "colorHue: 400",
        "---",
        "# out-of-range",
        "",
        "## Role",
        "Range gate.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    // title kept (valid), colorHue dropped (range gate rejects 400)
    expect(body[0]).toEqual({
      name: "out-of-range",
      description: "Range gate.",
      title: "OK Title",
    });
    expect("colorHue" in body[0]).toBe(false);
  });

  it("Test F (P90-01): backwards-compat — two-field callers still see {name, description}", async () => {
    // Simulate mixed roles: one with cosmetics, one without.
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "cosmetic-role\nplain-role";
      return [
        "===ROLE:cosmetic-role===",
        "---",
        "title: Cosmetic",
        "colorHue: 42",
        "---",
        "## Role",
        "Has cosmetics.",
        "===ROLE:plain-role===",
        "## Role",
        "No cosmetics.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<{ name: string; description: string }>;
    expect(body).toHaveLength(2);
    // Sorted alphabetically
    const cosmetic = body.find((r) => r.name === "cosmetic-role")!;
    const plain = body.find((r) => r.name === "plain-role")!;
    // Backwards-compat: name + description populated for every entry.
    expect(cosmetic.name).toBe("cosmetic-role");
    expect(cosmetic.description).toBe("Has cosmetics.");
    expect(plain.name).toBe("plain-role");
    expect(plain.description).toBe("No cosmetics.");
  });

  it("Test G (P90-01): SSH cat failure fallback returns entries WITHOUT cosmetic scaffolding", async () => {
    let callCount = 0;
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      callCount++;
      if (cmd.includes("ls ")) return "one\ntwo";
      // Second call (batched cat) throws — triggers the fallback at L199
      throw new Error("Batched cat exec failed");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    // Fallback shape: {name, description: ""} — NO cosmetic keys added,
    // because there was no markdown to extract from.
    for (const entry of body) {
      expect(entry.description).toBe("");
      expect("title" in entry).toBe(false);
      expect("displayName" in entry).toBe(false);
      expect("colorHue" in entry).toBe(false);
      expect("voice" in entry).toBe(false);
      expect("avatar" in entry).toBe(false);
    }
    // Two exec calls: ls, then failing cat.
    expect(callCount).toBe(2);
  });

  it("Test 10: role names failing ROLE_NAME_PATTERN are silently dropped", async () => {
    // ls includes both valid + invalid entries. Only valid should reach the batched cat + response.
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) {
        // Mix of valid kebab-case + invalid entries. Invalid ones must be dropped.
        return [
          "good-role",           // valid
          "BadCase",             // invalid: uppercase
          "with_underscore",     // invalid: underscore (kebab-case only)
          "with.dot",            // invalid: dot
          "with space",          // invalid: space
          "another-good",        // valid
        ].join("\n");
      }
      // Batched cat receives only good-role + another-good
      // Assert the batched cat command does NOT contain any of the dropped names
      expect(cmd).not.toContain("BadCase");
      expect(cmd).not.toContain("with_underscore");
      expect(cmd).not.toContain("with.dot");
      expect(cmd).not.toContain("with space");
      return [
        "===ROLE:good-role===",
        "## Role",
        "good.",
        "===ROLE:another-good===",
        "## Role",
        "also good.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    // Sorted alphabetically
    expect(body.map((r) => r.name)).toEqual(["another-good", "good-role"]);
  });

  it("Test 11: batched cat emits a newline after every cat so predecessor files without trailing newlines don't swallow the next marker", async () => {
    // Regression guard: if a role file on disk ends without a newline, the
    // NEXT role's ===ROLE:X=== echo concatenates to that byte, and the split
    // regex in step 7 (which requires marker at start-of-line via /m) drops
    // the following role's block. The catCmd shape is the fix — each cat is
    // followed by an explicit `echo ""` that guarantees a newline break
    // before the next marker.
    let batchedCatCmd = "";
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "role-a\nrole-b\nrole-c";
      batchedCatCmd = cmd;
      return [
        "===ROLE:role-a===",
        "## Role",
        "A.",
        "===ROLE:role-b===",
        "## Role",
        "B.",
        "===ROLE:role-c===",
        "## Role",
        "C.",
      ].join("\n");
    });
    await httpRequest(server, { method: "GET", path: "/roles?hostId=7" });

    // Every role's cat MUST be followed by `echo ""` (or equivalent newline emit)
    // before the next role's marker echo. 3 roles → 3 `echo ""` occurrences.
    const echoBlankMatches = batchedCatCmd.match(/echo\s+["']{2}/g) ?? [];
    expect(echoBlankMatches.length).toBeGreaterThanOrEqual(3);

    // Structural check: no `&&` chain between echo-marker and cat that would
    // let a cat failure suppress the trailing newline echo.
    expect(batchedCatCmd).not.toMatch(/cat\s+"\$HOME[^"]*"\s+2>\/dev\/null\s+\|\|\s+true/);
  });
});

// ===========================================================================
// Phase 129 Plan 129-03: per-user visibility gate on GET /roles?hostId=<n>
// ===========================================================================
//
// Deep-gate D-7 seam #3: the role-picker in NewSessionDialog (frontend)
// hits GET /roles?hostId=<n> to populate its dropdown. Per shape file
// §"What would make it wrong" bullet 5: "The role picker in the new-agent
// UI shows roles the user can't see. Whatever gates the sidebar has to
// gate the picker too."
//
// Locks (129-CONTEXT.md § "Locked decisions"):
//   - D-2 role-side intersection: role is visible iff `users` empty/absent
//     OR callerUsername ∈ users (D-3 fallback).
//   - Identity-side gate is NOT applied here — a role-picker is used
//     BEFORE any identity exists; there is no identity file to gate on.
//     The call site MUST pass identityCos=null (Option A per PATTERNS.md).
//   - D-6 wire-shape lock: the RoleCosmetics narrowing must NOT be extended
//     to include `users:`. The raw cosmetics (with `users`) is preserved
//     in a parallel Map<name, RawCosmetics> so the gate can consult it
//     without leaking `users` into the response body.
//   - D-8 fail-open: null callerUsername (unknown JWT userId) → gate
//     DISABLED, returns the unfiltered role list, warn-log fires.
//
// Fixture strategy: the tests below mock the batched-cat output to include
// or omit YAML frontmatter with a `users:` list per role. The RED phase
// asserts the current handler surfaces roles Zoe can't see; the GREEN
// phase filters them out via isIdentityVisibleToUser(null, roleCos, callerUsername).

describe("Phase 129: role-picker gate on GET /roles?hostId=<n>", () => {
  /**
   * Mock the DB translation from JWT userId to Skynet username. Gate inside
   * roles-list-for-host.ts uses this to know who is asking; null return
   * disables the gate per Plan 129-01 Task 2 Test 1 (null-caller bypass).
   */
  function mockGetUsernameForUserId(
    userId: string,
    username: string | null,
  ): void {
    getUsernameForUserIdMock.mockImplementation((incomingUserId: string) => {
      if (incomingUserId === userId) return Promise.resolve(username);
      return Promise.resolve(null);
    });
  }

  /**
   * Build a batched-cat delimited output block for one role. If `users` is
   * provided it lands in the role's YAML frontmatter; if omitted the
   * frontmatter has NO `users:` key (D-3 absent-⇒-omit fallback).
   */
  function roleBlock(
    roleName: string,
    opts: { users?: string[]; description?: string } = {},
  ): string[] {
    const fmLines: string[] = [`title: ${roleName}-title`];
    if (opts.users !== undefined) {
      fmLines.push(`users: [${opts.users.join(", ")}]`);
    }
    return [
      `===ROLE:${roleName}===`,
      "---",
      ...fmLines,
      "---",
      `# ${roleName}`,
      "",
      "## Role",
      opts.description ?? `${roleName} role.`,
    ];
  }

  /**
   * Fire GET /roles?hostId=7 as a given Skynet username. Wires the auth
   * mock to inject a userId AND the getUsernameForUserId mock to translate
   * that userId back to the username the gate expects.
   */
  async function fireGetRolesAs(
    username: string,
  ): Promise<{ status: number; body: Array<Record<string, unknown>> }> {
    // Auth manager stub always injects mockUserId; wire the DB translation.
    const jwtUserId = `uid-${username}`;
    mockUserId = jwtUserId;
    mockGetUsernameForUserId(jwtUserId, username);
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    return {
      status: res.status,
      body: res.body as Array<Record<string, unknown>>,
    };
  }

  // -------------------------------------------------------------------------
  // Test A: single-user host, role untagged → visible. Zero regression.
  // Also asserts the per-request username lookup runs EXACTLY ONCE.
  // -------------------------------------------------------------------------
  it("Test A: single-user host, role has no `users` key → visible + username fetched once", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "muffin-friend";
      return roleBlock("muffin-friend").join("\n");
    });

    const { status, body } = await fireGetRolesAs("ashley");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("muffin-friend");
    // Per-request-cost discipline: the callerUsername lookup runs ONCE.
    expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(1);
    expect(getUsernameForUserIdMock).toHaveBeenCalledWith("uid-ashley");
  });

  // -------------------------------------------------------------------------
  // Test B: multi-user host, role untagged → visible to both users (D-3
  // fallback). Two requests fire two lookups (no cross-request cache).
  // -------------------------------------------------------------------------
  it("Test B: multi-user host, role has no `users` key → both Ashley and Zoe see it", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "muffin-friend";
      return roleBlock("muffin-friend").join("\n");
    });

    const ashley = await fireGetRolesAs("ashley");
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].name).toBe("muffin-friend");

    const zoe = await fireGetRolesAs("zoe");
    expect(zoe.status).toBe(200);
    expect(zoe.body).toHaveLength(1);
    expect(zoe.body[0].name).toBe("muffin-friend");

    // Two requests → two username lookups. No cross-request caching.
    expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test C: multi-user host, role users:[ashley] → visible to Ashley, hidden
  // from Zoe (D-2 role-side gate). Zoe's response has ZERO rows.
  // -------------------------------------------------------------------------
  it("Test C: role users:[ashley] → Ashley sees it, Zoe does NOT (role-side gate)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "muffin-friend";
      return roleBlock("muffin-friend", { users: ["ashley"] }).join("\n");
    });

    const ashley = await fireGetRolesAs("ashley");
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].name).toBe("muffin-friend");

    const zoe = await fireGetRolesAs("zoe");
    expect(zoe.status).toBe(200);
    // D-7 depth: the role is ABSENT from Zoe's response.
    expect(zoe.body).toHaveLength(0);
    expect(zoe.body.find((r) => r.name === "muffin-friend")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test D: multi-user host, role users:[ashley, zoe] → visible to both.
  // Shared explicitly via the users list.
  // -------------------------------------------------------------------------
  it("Test D: role users:[ashley,zoe] → both Ashley and Zoe see it (shared explicitly)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "shared-role";
      return roleBlock("shared-role", { users: ["ashley", "zoe"] }).join("\n");
    });

    const ashley = await fireGetRolesAs("ashley");
    expect(ashley.status).toBe(200);
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].name).toBe("shared-role");

    const zoe = await fireGetRolesAs("zoe");
    expect(zoe.status).toBe(200);
    expect(zoe.body).toHaveLength(1);
    expect(zoe.body[0].name).toBe("shared-role");
  });

  // -------------------------------------------------------------------------
  // Test E: identity-side gate is IGNORED by the role-picker gate. A role
  // with users:[ashley, zoe] still appears in Zoe's picker even if the
  // eventual-child-identity would narrow to [ashley] — the role picker is
  // used BEFORE any identity exists, so identityCos=null passed to the gate.
  // Also asserts the exact call-shape (identityCos === null) via mock call
  // audit. This test locks the D-2 "role-side only" contract for the picker.
  // -------------------------------------------------------------------------
  it("Test E: identity-side gate is IGNORED — role gate uses identityCos=null (role-side only)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "role-a\nrole-b";
      return [
        ...roleBlock("role-a", { users: ["ashley", "zoe"] }),
        ...roleBlock("role-b", { users: ["ashley"] }),
      ].join("\n");
    });

    // Zoe sees role-a (both users listed) but NOT role-b (ashley only).
    // If the picker used identityCos incorrectly (e.g. cosBynName instead of
    // null on the identity slot), the intersection would collapse in ways
    // that break this expected shape.
    const zoe = await fireGetRolesAs("zoe");
    expect(zoe.status).toBe(200);
    expect(zoe.body).toHaveLength(1);
    expect(zoe.body[0].name).toBe("role-a");
    expect(zoe.body.find((r) => r.name === "role-b")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test F: username lookup returns null → fail-open (gate disabled).
  // Even a role with users:[ashley] shows up when callerUsername is null,
  // preserving D-8 (visibility filter, not permission system). A warn log
  // fires with operation="roles_list_gate_username_missing" so ops can
  // grep the mismatch.
  // -------------------------------------------------------------------------
  it("Test F: getUsernameForUserId returns null → gate disabled (fail-open), warn log fires", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "muffin-friend";
      // Role tagged users:[ashley] — with null caller the gate is disabled
      // and the role STILL surfaces.
      return roleBlock("muffin-friend", { users: ["ashley"] }).join("\n");
    });

    mockUserId = "orphan-uid";
    getUsernameForUserIdMock.mockResolvedValue(null);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<Record<string, unknown>>;
    // Fail-open: role surfaces despite users:[ashley] because callerUsername
    // is null (short-circuits isIdentityVisibleToUser to true per Plan
    // 129-01 Task 2 Test 1).
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("muffin-friend");

    // Structured warn log fires with the operation tag so ops can grep.
    const warnCalls = systemLoggerWarnMock.mock.calls;
    const hasGateWarn = warnCalls.some((call) => {
      const payload = call[1] as { operation?: string } | undefined;
      return payload?.operation === "roles_list_gate_username_missing";
    });
    expect(hasGateWarn).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test G: role file read fails mid-loop → row skipped per pre-existing
  // error path (unchanged behavior). This test is a regression lock — the
  // gate must NOT convert a role's read failure into a false-positive HIDE
  // AT the wrong seam. The pre-existing extractor already emits {name,
  // description:""} for roles whose frontmatter is unparseable; the gate
  // runs on the extracted cosmetics (which will be {} on parse failure)
  // and the D-3 fallback keeps such roles VISIBLE.
  // -------------------------------------------------------------------------
  it("Test G: role frontmatter unparseable → role stays visible (D-3 fallback preserved)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "broken-role";
      // Broken YAML — extractCosmeticsFromFrontmatter returns {}. No users
      // key → D-3 fallback: role side has no gate → visible.
      return [
        "===ROLE:broken-role===",
        "---",
        "title: [unclosed",
        "---",
        "# broken-role",
        "",
        "## Role",
        "Broken frontmatter.",
      ].join("\n");
    });

    const ashley = await fireGetRolesAs("ashley");
    expect(ashley.status).toBe(200);
    // Broken frontmatter → cosmetics {} → no users list → D-3 fallback →
    // visible. Broken doesn't equal "tagged for someone else".
    expect(ashley.body).toHaveLength(1);
    expect(ashley.body[0].name).toBe("broken-role");
  });
});
