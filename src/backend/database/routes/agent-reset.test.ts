/**
 * agent-reset.test.ts — Phase 90 Plan 00 Wave 0 Task 3 endpoint tests.
 *
 * Covers behaviors 1-8 per 90-00-PLAN.md § Task 3 <behavior>:
 *   Test 1: unauthenticated → 401 (JWT middleware intercepts)
 *   Test 2: not-owner OR not-found → 404 (same status, no oracle)
 *   Test 3: owned + reachable → 200 + `/id reset` dispatched
 *   Test 4: invalid hostId (non-numeric) → 400
 *   Test 5: invalid tmuxSessionName (fails grammar) → 400
 *   Test 6: optional body → `/id reset (<body>)` (mirrors ComposeBox)
 *   Test 7: structured logging on ok / denied / failed paths
 *   Test 8: NO user-row DB write (DatabaseSaveTrigger.forceSave invariant)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — canned userId "1" for authed tests; test-driven flip to
// 401 by pointing __authMode below at "unauth".
// ---------------------------------------------------------------------------

let __authMode: "pass" | "unauth" = "pass";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (__authMode === "unauth") {
            res.status(401).json({ ok: false, error: "unauthenticated" });
            return;
          }
          (req as express.Request & { userId: string }).userId = "1";
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock SSH primitives BEFORE importing the route module.
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

// Mock the DatabaseSaveTrigger so Test 8 can assert it was NEVER called
// (invariant: this endpoint does not write to any user row).
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn() },
}));

// Mock loggers (structured-logging assertion in Test 7 uses these spies).
vi.mock("../../utils/logger.js", () => ({
  sshLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { databaseLogger, sshLogger } from "../../utils/logger.js";

const mockedConnectOneShot = vi.mocked(connectOneShot);
const mockedExecCommand = vi.mocked(execCommand);
const mockedResolveHostById = vi.mocked(resolveHostById);
const mockedForceSave = vi.mocked(DatabaseSaveTrigger.forceSave);
const dbInfo = vi.mocked(databaseLogger.info);
const dbWarn = vi.mocked(databaseLogger.warn);
const dbError = vi.mocked(databaseLogger.error);

// ---------------------------------------------------------------------------
// Import the router AFTER mocks
// ---------------------------------------------------------------------------

import agentResetRoutes from "./agent-reset.js";

// ---------------------------------------------------------------------------
// HTTP helper (mirrors sessions.test.ts pattern)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
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
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Fake SSH connection object — resolveHostById returns an SSHHost-shaped
// record; connectOneShot returns a mock conn we don't dereference (execCommand
// is mocked at module level so `conn` is opaque).
const fakeConn = { end: vi.fn() } as unknown as import("ssh2").Client;

// Owned host (Ashley owns hostId=42 as userId=1).
const stubResolvedHost = {
  id: 42,
  ip: "10.0.0.42",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------

let server: http.Server;

beforeEach(async () => {
  vi.clearAllMocks();
  __authMode = "pass";
  // Default happy path: host owned, connect succeeds, execs no-op resolve.
  mockedResolveHostById.mockResolvedValue(
    stubResolvedHost as unknown as Awaited<
      ReturnType<typeof resolveHostById>
    >,
  );
  mockedConnectOneShot.mockResolvedValue(fakeConn);
  mockedExecCommand.mockResolvedValue("");

  const app = express();
  app.use(express.json());
  app.use("/agent-reset", agentResetRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /agent-reset/:hostId/:tmuxSessionName", () => {
  it("Test 1: unauthenticated → 401 (JWT middleware intercepts)", async () => {
    __authMode = "unauth";
    const res = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/42/tina",
    });
    expect(res.status).toBe(401);
    // Downstream mocks must NOT have been called.
    expect(mockedResolveHostById).not.toHaveBeenCalled();
    expect(mockedConnectOneShot).not.toHaveBeenCalled();
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });

  it("Test 2: authenticated user tries to reset a host they don't own → 404 (no oracle for 'not owner' vs 'not found')", async () => {
    // resolveHostById filters by (hostId AND userId) — null means either
    // 'not found' or 'not owned'. Same status returned either way (no
    // oracle per Security V8).
    mockedResolveHostById.mockResolvedValue(null);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/42/tina",
    });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe("not_found");
    // Dispatch must NOT have fired.
    expect(mockedConnectOneShot).not.toHaveBeenCalled();
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });

  it("Test 3: owned + reachable → 200 and the /id reset input is dispatched via body-then-Enter split-send", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/42/tina",
    });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);

    // Two execCommand calls — body + Enter (mirrors pv-input split-send).
    expect(mockedExecCommand).toHaveBeenCalledTimes(2);
    const bodyCmd = mockedExecCommand.mock.calls[0][1] as string;
    const enterCmd = mockedExecCommand.mock.calls[1][1] as string;
    expect(bodyCmd).toContain("tmux send-keys -l");
    expect(bodyCmd).toContain("'tina'");
    expect(bodyCmd).toContain("'/id reset'");
    expect(enterCmd).toBe("tmux send-keys -t 'tina' Enter");
  });

  it("Test 4: invalid hostId (non-numeric) → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/notanumber/tina",
    });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe(
      "invalid_host_id",
    );
    expect(mockedResolveHostById).not.toHaveBeenCalled();
  });

  it("Test 4b: zero or negative hostId → 400", async () => {
    const r0 = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/0/tina",
    });
    expect(r0.status).toBe(400);
    const rNeg = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/-5/tina",
    });
    expect(rNeg.status).toBe(400);
  });

  it("Test 5: invalid tmuxSessionName (fails /^[a-zA-Z0-9_-]{1,64}$/ grammar) → 400", async () => {
    // Metacharacter attempt.
    const rMeta = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/42/foo%3B%20rm%20-rf%20%2F",
    });
    expect(rMeta.status).toBe(400);
    expect((rMeta.body as Record<string, unknown>).error).toBe(
      "invalid_tmux_session",
    );
    // Empty (would 404 at route match, but explicit test for a bad char).
    const rBad = await httpRequest(server, {
      method: "POST",
      path: "/agent-reset/42/has.dot",
    });
    expect(rBad.status).toBe(400);
    // Over-length.
    const rLong = await httpRequest(server, {
      method: "POST",
      path: `/agent-reset/42/${"a".repeat(65)}`,
    });
    expect(rLong.status).toBe(400);
    // Dispatch must NOT have fired.
    expect(mockedConnectOneShot).not.toHaveBeenCalled();
  });

  it(
    "Test 6: optional body → constructs `/id reset (<body>)` (mirrors ComposeBox verbatim, including newline collapse)",
    async () => {
      const res = await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
        body: { body: "hello\nfrom endpoint" },
      });
      expect(res.status).toBe(200);
      // Body cmd should contain the collapsed payload.
      const bodyCmd = mockedExecCommand.mock.calls[0][1] as string;
      // Newline collapsed to a single space, wrapped in parens.
      expect(bodyCmd).toContain("'/id reset (hello from endpoint)'");
    },
  );

  it(
    "Test 6b: empty body → just `/id reset` (matches ComposeBox trimmed-empty branch)",
    async () => {
      const res = await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
        body: { body: "   " }, // whitespace-only → trimmed empty
      });
      expect(res.status).toBe(200);
      const bodyCmd = mockedExecCommand.mock.calls[0][1] as string;
      expect(bodyCmd).toContain("'/id reset'");
      expect(bodyCmd).not.toContain("(");
    },
  );

  it(
    "Test 7: structured logging — agent_reset_ok on success; agent_reset_denied on 404; agent_reset_dispatch_failed on 502",
    async () => {
      // Success path.
      await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
      });
      expect(
        dbInfo.mock.calls.some(
          ([, ctx]) =>
            (ctx as Record<string, unknown> | undefined)?.operation ===
            "agent_reset_ok",
        ),
      ).toBe(true);

      // Denied path.
      mockedResolveHostById.mockResolvedValueOnce(null);
      await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/99/tina",
      });
      expect(
        dbWarn.mock.calls.some(
          ([, ctx]) =>
            (ctx as Record<string, unknown> | undefined)?.operation ===
            "agent_reset_denied",
        ),
      ).toBe(true);

      // Dispatch-failure path (execCommand throws).
      mockedExecCommand.mockRejectedValueOnce(new Error("ssh boom"));
      const rFail = await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
      });
      expect(rFail.status).toBe(502);
      // Endpoint emits BOTH a databaseLogger.error and an sshLogger.warn for
      // grep symmetry — assert at least one carries the failed operation tag.
      const dbFailed = dbError.mock.calls.some(
        ([, , ctx]) =>
          (ctx as Record<string, unknown> | undefined)?.operation ===
          "agent_reset_dispatch_failed",
      );
      const sshFailed = vi
        .mocked(sshLogger.warn)
        .mock.calls.some(
          ([, ctx]) =>
            (ctx as Record<string, unknown> | undefined)?.operation ===
            "agent_reset_dispatch_failed",
        );
      expect(dbFailed || sshFailed).toBe(true);
    },
  );

  it(
    "Test 8: NO user-row DB write — DatabaseSaveTrigger.forceSave invariant NOT triggered",
    async () => {
      await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
      });
      expect(mockedForceSave).not.toHaveBeenCalled();

      // Also on 404 + 502 paths.
      mockedResolveHostById.mockResolvedValueOnce(null);
      await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
      });
      expect(mockedForceSave).not.toHaveBeenCalled();

      mockedExecCommand.mockRejectedValueOnce(new Error("boom"));
      await httpRequest(server, {
        method: "POST",
        path: "/agent-reset/42/tina",
      });
      expect(mockedForceSave).not.toHaveBeenCalled();
    },
  );
});
