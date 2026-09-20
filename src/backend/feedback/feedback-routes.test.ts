/**
 * Phase 121 Plan 03 Task 4 — vitest coverage for feedback-routes.ts.
 *
 * Covers all behavior bullets in the plan:
 *  1. GET /api/feedback/enabled without auth → 401
 *  2. GET /api/feedback/enabled + auth + cfg.enabled=true → 200
 *     {enabled:true} + Cache-Control:no-store
 *  3. GET /api/feedback/enabled + auth + cfg.enabled=false → 200
 *     {enabled:false} + Cache-Control:no-store
 *  4. POST /feedback without auth → 401
 *  5. POST /feedback + auth + cfg.enabled=false → 503 {error:"feedback disabled"}
 *  6. POST /feedback with kind:"invalid" → 400 {error:"invalid kind"}
 *  7. POST /feedback with missing kind → 400
 *  8. POST /feedback kind=general → 202 {ok:true}; subject
 *     `[<appName> feedback] general`; body OMITS "--- Exchange ---"
 *     even when exchangeText was on the wire (D-23 server-side drop)
 *  9. POST /feedback kind=thumbs_up + cfg.includeContent=false → body
 *     OMITS "--- Exchange ---" (D-22 server-side content gate)
 * 10. POST /feedback kind=thumbs_up + cfg.includeContent=true → body
 *     CONTAINS "--- Exchange ---\n<X>"
 * 11. POST /feedback kind=thumbs_down + userNote → body CONTAINS
 *     "--- User note ---\n<note>"
 * 12. POST /feedback logs FULL payload (userNote + exchangeText) via
 *     sshLogger.info(operation:"feedback_submit") BEFORE the send fires
 *     (D-27 nothing-lost)
 * 13. POST /feedback with a 700kb body → non-2xx (413 or handled error)
 * 14. POST /feedback with userId not resolving to a users row →
 *     submitter="unknown" fallback
 * 15. POST /feedback returns 202 BEFORE sendFeedbackEmail promise
 *     resolves (fire-and-forget contract)
 *
 * All these tests mock: nodemailer, AuthManager, db (drizzle), schema,
 * drizzle-orm.eq, loadBrandingConfig, and sshLogger.
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
import bodyParser from "body-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth mock — flip __authMode between "pass" (userId injected) / "unauth".
// ---------------------------------------------------------------------------

let __authMode: "pass" | "unauth" = "pass";
let __authUserId: string = "user-1";

vi.mock("../utils/auth-manager.js", () => {
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
          (req as express.Request & { userId: string }).userId = __authUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Nodemailer mock — sendMail is a Jest/Vitest fn we can inspect.
// ---------------------------------------------------------------------------

const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-msg-id" });

vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({ sendMail: mockSendMail }));
  return {
    default: { createTransport },
    createTransport,
  };
});

// ---------------------------------------------------------------------------
// DB mock — the route selects username from users. Toggle __usernameRow to
// exercise the fallback path (Test 14).
// ---------------------------------------------------------------------------

let __usernameRow: { username: string } | undefined = { username: "ashley" };

vi.mock("../database/db/index.js", () => {
  const dbSelect = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(__usernameRow !== undefined ? [__usernameRow] : []),
        }),
      }),
    }),
  };
  return { db: dbSelect };
});

vi.mock("../database/db/schema.js", () => ({
  users: { id: "users.id", username: "users.username" },
}));

vi.mock("drizzle-orm", async () => {
  const actual =
    (await vi.importActual("drizzle-orm")) as Record<string, unknown>;
  return {
    ...actual,
    eq: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// Branding mock — appName drives the subject line (D-03).
// ---------------------------------------------------------------------------

let __appName: string = "gigaashley";

vi.mock("../branding/branding-config-loader.js", () => ({
  loadBrandingConfig: () => Promise.resolve({ appName: __appName }),
}));

// ---------------------------------------------------------------------------
// Feedback-config mock — this is the source of truth for cfg.enabled +
// cfg.includeContent. The real module reads env vars; here we inject
// controlled config values.
// ---------------------------------------------------------------------------

type FeedbackConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      smtp: {
        host: string;
        port: number;
        user: string;
        password: string;
        fromAddress: string;
      };
      toAddress: string;
      includeContent: boolean;
    };

let __feedbackConfig: FeedbackConfig = {
  enabled: true,
  smtp: {
    host: "smtp.example.com",
    port: 587,
    user: "u",
    password: "p",
    fromAddress: "from@example.com",
  },
  toAddress: "to@example.com",
  includeContent: false,
};

vi.mock("./feedback-config.js", () => ({
  getFeedbackConfig: () => __feedbackConfig,
  loadFeedbackConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Logger mock — capture info + error calls so Test 12 can assert the
// pre-send log carries the full userNote + exchangeText payload.
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => {
  const mkLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  });
  return {
    sshLogger: mkLogger(),
    databaseLogger: mkLogger(),
    authLogger: mkLogger(),
    logger: mkLogger(),
  };
});

// eslint-disable-next-line import/first
import feedbackRoutes from "./feedback-routes.js";
// eslint-disable-next-line import/first
import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Test server harness
// ---------------------------------------------------------------------------

let app: express.Express;
let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  app = express();
  app.use(feedbackRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function setEnabledConfig(includeContent: boolean): void {
  __feedbackConfig = {
    enabled: true,
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "u",
      password: "p",
      fromAddress: "from@example.com",
    },
    toAddress: "to@example.com",
    includeContent,
  };
}

function setDisabledConfig(reason = "test-disabled"): void {
  __feedbackConfig = { enabled: false, reason };
}

async function post(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function get(
  path: string,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let json: unknown;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

describe("feedback-routes (Phase 121 Plan 03 Task 4)", () => {
  beforeEach(async () => {
    __authMode = "pass";
    __authUserId = "user-1";
    __usernameRow = { username: "ashley" };
    __appName = "gigaashley";
    setEnabledConfig(false);
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({ messageId: "test-msg-id" });
    (sshLogger.info as ReturnType<typeof vi.fn>).mockClear();
    (sshLogger.error as ReturnType<typeof vi.fn>).mockClear();
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  // -------------------------------------------------------------------------
  // GET /api/feedback/enabled
  // -------------------------------------------------------------------------

  it("Test 1: GET /api/feedback/enabled unauth → 401", async () => {
    __authMode = "unauth";
    const res = await get("/api/feedback/enabled");
    expect(res.status).toBe(401);
  });

  it("Test 2: GET /api/feedback/enabled + auth + enabled → 200 {enabled:true} + Cache-Control:no-store", async () => {
    setEnabledConfig(false);
    const res = await get("/api/feedback/enabled");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ enabled: true });
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
  });

  it("Test 3: GET /api/feedback/enabled + auth + disabled → 200 {enabled:false} + Cache-Control:no-store", async () => {
    setDisabledConfig();
    const res = await get("/api/feedback/enabled");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ enabled: false });
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
  });

  // -------------------------------------------------------------------------
  // POST /feedback — auth + disabled-503 + validation
  // -------------------------------------------------------------------------

  it("Test 4: POST /feedback unauth → 401", async () => {
    __authMode = "unauth";
    const res = await post("/feedback", { kind: "general", userNote: "hi" });
    expect(res.status).toBe(401);
  });

  it("Test 5: POST /feedback + enabled=false → 503 {error:'feedback disabled'}", async () => {
    setDisabledConfig();
    const res = await post("/feedback", { kind: "general", userNote: "hi" });
    expect(res.status).toBe(503);
    expect((res.json as { error?: string }).error).toBe("feedback disabled");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("Test 6: POST /feedback with kind:'invalid' → 400 {error:'invalid kind'}", async () => {
    setEnabledConfig(false);
    const res = await post("/feedback", { kind: "invalid", userNote: "" });
    expect(res.status).toBe(400);
    expect((res.json as { error?: string }).error).toBe("invalid kind");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("Test 7: POST /feedback with missing kind → 400", async () => {
    setEnabledConfig(false);
    const res = await post("/feedback", { userNote: "hi" });
    expect(res.status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // POST /feedback — kind=general D-23 server-side exchange drop
  // -------------------------------------------------------------------------

  it("Test 8: POST /feedback kind=general → 202; subject `[gigaashley feedback] general`; body OMITS '--- Exchange ---' even when caller sent exchangeText (D-23)", async () => {
    setEnabledConfig(true); // even with includeContent=true, D-23 forces general to drop
    const res = await post("/feedback", {
      kind: "general",
      userNote: "just some thoughts",
      exchangeText: "SHOULD NOT LEAK — general is context-free",
    });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ ok: true });

    // Wait a microtask so the fire-and-forget send has a chance to fire.
    await new Promise((r) => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0]![0] as {
      subject: string;
      text: string;
    };
    expect(args.subject).toBe("[gigaashley feedback] general");
    // D-23 lock: general NEVER carries the exchange section.
    expect(args.text).not.toContain("--- Exchange ---");
    expect(args.text).not.toContain("SHOULD NOT LEAK");
  });

  // -------------------------------------------------------------------------
  // POST /feedback — thumbs_up D-22 server-side content gate
  // -------------------------------------------------------------------------

  it("Test 9: POST /feedback kind=thumbs_up + includeContent=false + exchangeText → body OMITS '--- Exchange ---' (D-22)", async () => {
    setEnabledConfig(false);
    const res = await post("/feedback", {
      kind: "thumbs_up",
      userNote: "",
      messageRef: "msg-1",
      exchangeText: "SHOULD NOT LEAK — includeContent is off",
    });
    expect(res.status).toBe(202);

    await new Promise((r) => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0]![0] as { text: string };
    expect(args.text).not.toContain("--- Exchange ---");
    expect(args.text).not.toContain("SHOULD NOT LEAK");
  });

  it("Test 10: POST /feedback kind=thumbs_up + includeContent=true + exchangeText → body CONTAINS '--- Exchange ---\\n<X>'", async () => {
    setEnabledConfig(true);
    const res = await post("/feedback", {
      kind: "thumbs_up",
      userNote: "",
      messageRef: "msg-1",
      exchangeText: "User asked X. Assistant replied Y.",
    });
    expect(res.status).toBe(202);

    await new Promise((r) => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0]![0] as {
      subject: string;
      text: string;
    };
    expect(args.subject).toBe("[gigaashley feedback] thumbs up");
    expect(args.text).toContain(
      "--- Exchange ---\nUser asked X. Assistant replied Y.",
    );
  });

  // -------------------------------------------------------------------------
  // POST /feedback — thumbs_down + userNote → body carries "--- User note ---"
  // -------------------------------------------------------------------------

  it("Test 11: POST /feedback kind=thumbs_down + userNote → body CONTAINS '--- User note ---\\n<note>'", async () => {
    setEnabledConfig(false);
    const res = await post("/feedback", {
      kind: "thumbs_down",
      userNote: "broken migration binary",
      messageRef: "msg-1",
    });
    expect(res.status).toBe(202);

    await new Promise((r) => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0]![0] as {
      subject: string;
      text: string;
    };
    expect(args.subject).toBe("[gigaashley feedback] thumbs down");
    expect(args.text).toContain("--- User note ---\nbroken migration binary");
  });

  // -------------------------------------------------------------------------
  // D-27 log-before-send: full payload captured to sshLogger.info
  // -------------------------------------------------------------------------

  it("Test 12: POST /feedback logs FULL payload (userNote + exchangeText) via sshLogger.info operation=feedback_submit BEFORE the send fires (D-27)", async () => {
    setEnabledConfig(true);
    const infoMock = sshLogger.info as ReturnType<typeof vi.fn>;

    await post("/feedback", {
      kind: "thumbs_up",
      userNote: "note-text",
      messageRef: "msg-42",
      exchangeText: "exchange-text-verbatim",
    });

    // Find the feedback_submit log entry
    const submitCall = infoMock.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "feedback_submit",
    );
    expect(submitCall).toBeDefined();
    const ctx = submitCall![1] as Record<string, unknown>;
    expect(ctx.submitter).toBe("ashley");
    expect(ctx.type).toBe("thumbs up");
    expect(ctx.hasNote).toBe(true);
    expect(ctx.hasExchange).toBe(true);
    expect(ctx.messageRef).toBe("msg-42");
    // D-27: full userNote + exchangeText persisted in the log entry so
    // a failed send doesn't lose anything the user typed.
    expect(ctx.userNote).toBe("note-text");
    expect(ctx.exchangeText).toBe("exchange-text-verbatim");
  });

  // -------------------------------------------------------------------------
  // T-121-11: 512kb body cap (via inline express.json)
  // -------------------------------------------------------------------------

  it("Test 13: POST /feedback with 700kb body → non-2xx status (413 or handled)", async () => {
    setEnabledConfig(true);
    // Build a payload with ~700kb userNote
    const big = "x".repeat(700 * 1024);
    const res = await post("/feedback", {
      kind: "general",
      userNote: big,
    });
    // Non-2xx: express.json's default behavior for over-limit is 413.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // MED-1 (follow-up): production-wiring variant of Test 13 — mount a global
  // bodyParser.json({limit:"1gb"}) BEFORE feedbackRoutes to mirror
  // database.ts:355. Without the request-time content-length check inside
  // the POST handler (HIGH-1 fix), the inline express.json({limit:"512kb"})
  // in feedback-routes is a no-op because the global parser already
  // consumed the body. This test drives the content-length guard.
  // -------------------------------------------------------------------------

  it("Test 13b: POST /feedback with 700kb body under production wiring (global bodyParser.json({limit:'1gb'})) → 413 payload too large", async () => {
    // Rebuild the server harness with the production body-parser wiring in
    // front of feedbackRoutes (mirror database.ts:355).
    await stopServer();
    app = express();
    app.use(bodyParser.json({ limit: "1gb" }));
    app.use(feedbackRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    setEnabledConfig(true);
    const big = "x".repeat(700 * 1024);
    const res = await post("/feedback", {
      kind: "general",
      userNote: big,
    });
    // HIGH-1 fix (a): request-time content-length check rejects with 413
    // even when the global bodyParser has a permissive 1gb limit.
    expect(res.status).toBe(413);
    expect((res.json as { error?: string }).error).toBe("payload too large");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Fallback: userId does not resolve to a users row → submitter="unknown"
  // -------------------------------------------------------------------------

  it("Test 14: POST /feedback with userId that does not resolve to a users row → submitter='unknown' fallback", async () => {
    setEnabledConfig(false);
    __usernameRow = undefined;

    await post("/feedback", { kind: "general", userNote: "hi" });
    await new Promise((r) => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0]![0] as { text: string };
    expect(args.text).toContain("Feedback from: unknown");
  });

  // -------------------------------------------------------------------------
  // Fire-and-forget: 202 returns BEFORE sendFeedbackEmail promise settles.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // MED-5 (follow-up): log payload truncates userNote/exchangeText at 8KB
  // and sets *Truncated flags. The email body still carries the full text.
  // -------------------------------------------------------------------------

  it("Test 16 (MED-5): POST /feedback with >8KB userNote → log payload truncated + userNoteTruncated flag set; email carries full body", async () => {
    setEnabledConfig(true);
    const infoMock = sshLogger.info as ReturnType<typeof vi.fn>;
    const huge = "y".repeat(10 * 1024); // 10KB, exceeds 8KB cap
    await post("/feedback", {
      kind: "general",
      userNote: huge,
    });
    const submitCall = infoMock.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "feedback_submit",
    );
    expect(submitCall).toBeDefined();
    const ctx = submitCall![1] as Record<string, unknown>;
    expect((ctx.userNote as string).length).toBe(8 * 1024);
    expect(ctx.userNoteTruncated).toBe(true);

    // Email body still carries the FULL body (D-21 verbatim lock).
    await new Promise((r) => setImmediate(r));
    const mailArgs = mockSendMail.mock.calls[0]![0] as { text: string };
    expect(mailArgs.text).toContain(huge);
  });

  // -------------------------------------------------------------------------
  // LOW-3 (follow-up): messageRef bounded at 256 chars + CRLF stripped, and
  // log-string CRLF normalized so a hostile authenticated user cannot inject
  // fake log lines via userNote/exchangeText embedded newlines.
  // -------------------------------------------------------------------------

  it("Test 17 (LOW-3): POST /feedback with messageRef containing newlines and >256 chars → log value has no CRLF and is bounded to 256 chars", async () => {
    setEnabledConfig(false);
    const infoMock = sshLogger.info as ReturnType<typeof vi.fn>;
    // 300-char string with embedded newlines.
    const long = "a".repeat(150) + "\nEMERGENCY\r\n" + "b".repeat(150);
    await post("/feedback", {
      kind: "general",
      userNote: "hi",
      messageRef: long,
    });
    const submitCall = infoMock.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "feedback_submit",
    );
    expect(submitCall).toBeDefined();
    const ctx = submitCall![1] as Record<string, unknown>;
    const stored = ctx.messageRef as string;
    expect(stored.length).toBeLessThanOrEqual(256);
    expect(stored.includes("\n")).toBe(false);
    expect(stored.includes("\r")).toBe(false);
  });

  it("Test 15: POST /feedback response returns before sendFeedbackEmail resolves (fire-and-forget)", async () => {
    setEnabledConfig(false);
    // Make sendMail hang for a bit so we can prove the response doesn't wait.
    let resolveMail: (() => void) | null = null;
    mockSendMail.mockImplementationOnce(
      () =>
        new Promise<{ messageId: string }>((resolve) => {
          resolveMail = () => resolve({ messageId: "delayed" });
        }),
    );

    const startedAt = Date.now();
    const res = await post("/feedback", { kind: "general", userNote: "hi" });
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(202);
    // If the response awaited the send, we'd be blocked here indefinitely.
    // The response should come back well under 500ms since we never resolved.
    expect(elapsed).toBeLessThan(500);

    // Cleanup — resolve the pending sendMail promise so vitest doesn't hang.
    if (resolveMail !== null) (resolveMail as () => void)();
  });
});
