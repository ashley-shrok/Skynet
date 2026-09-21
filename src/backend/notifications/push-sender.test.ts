/**
 * Phase 128 Plan 02 Task 3 — push-sender tests.
 *
 * Covers the seven behaviors from PLAN.md § Task 3:
 *   Test 1: Happy path — 2 subscriptions, both succeed, no prune, forceSave
 *           NOT called (gate: `if (prunedAny)` — successful sends do NOT
 *           churn the disk; T-128-10 mitigation).
 *   Test 2: 410 prune — one subscription, sendNotification throws
 *           {statusCode: 410}, row DELETEd from push_subscriptions,
 *           forceSave called once with "push-subscription-prune-dead"
 *           label, info log emitted with endpoint truncated to 40 chars
 *           only (T-128-07 mitigation).
 *   Test 3: 404 prune — same as Test 2 but with statusCode 404.
 *   Test 4: Mixed — 2 subscriptions, one succeeds one 410-throws, ONLY
 *           the dead row deleted, alive row preserved, forceSave called
 *           exactly once.
 *   Test 5: Non-410 error — sendNotification throws {statusCode: 500}
 *           (or no statusCode), warn logged with truncated endpoint,
 *           row NOT deleted, forceSave NOT called.
 *   Test 6: forceSave-failure warn-fallback — prune happens, forceSave
 *           rejects, .warn logged with "push subscription prune forceSave
 *           failed" shape, function does NOT re-throw (T-128-09
 *           mitigation — never-throw contract).
 *   Test 7: Empty subscriptions — zero rows for userId, function returns
 *           immediately, sendNotification NOT called, forceSave NOT called,
 *           no logs.
 *
 * Test infrastructure — mirrors relay-room-sessions-store.test.ts:
 *   - vi.mock("web-push") — spy on setVapidDetails (module-load-time call)
 *     and mock sendNotification per test.
 *   - vi.mock("./vapid-config.js") — return valid VAPID env so module load
 *     doesn't throw.
 *   - vi.mock("../database/db/index.js") — swap db + DatabaseSaveTrigger
 *     for spy-able versions; db.$client is a fresh in-memory sqlite per test.
 *   - vi.mock("../utils/logger.js") — spy on databaseLogger .info + .warn.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Fresh in-memory DB per test — mirrors relay-room-sessions-store.test.ts.
// ---------------------------------------------------------------------------

let sqliteInstance: Database.Database;

const PUSH_SUBSCRIPTIONS_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_delivered_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_unique
    ON push_subscriptions(user_id, endpoint);
`;

// ---------------------------------------------------------------------------
// Mocks — hoisted before push-sender import.
// ---------------------------------------------------------------------------

// web-push mock: sendNotification is per-test mutable; setVapidDetails is a spy
// that we assert is called ONCE at module load. vi.hoisted is required because
// vi.mock factories run BEFORE any top-level `const` declarations — the
// hoisted() block is the sanctioned escape hatch.
const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
  setVapidDetails: setVapidDetailsMock,
  sendNotification: sendNotificationMock,
}));

// vapid-config mock: return well-formed values so module-load's setVapidDetails
// call succeeds without env stubbing.
vi.mock("./vapid-config.js", () => ({
  getVapidDetails: () => ({
    subject: "mailto:test@example.com",
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  }),
  assertVapidConfigAtBoot: vi.fn(),
}));

// db + DatabaseSaveTrigger mock — both come from ../database/db/index.js per
// push-sender.ts's imports.
vi.mock("../database/db/index.js", () => ({
  get db() {
    return { $client: sqliteInstance };
  },
  DatabaseSaveTrigger: {
    forceSave: vi.fn().mockResolvedValue(undefined),
    triggerSave: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------

import { sendPushToUser, type PushPayload } from "./push-sender.js";
import { DatabaseSaveTrigger } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;
const infoSpy = databaseLogger.info as ReturnType<typeof vi.fn>;
const warnSpy = databaseLogger.warn as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const USER = "user-A";
const OTHER_USER = "user-B";

const SAMPLE_PAYLOAD: PushPayload = {
  title: "Fanny",
  body: "hey",
  roomId: "!room1:server",
  agentMxid: "@fanny:example.com",
};

const FCM_ENDPOINT =
  "https://fcm.googleapis.com/fcm/send/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-real-looking-endpoint-xyz";
const APPLE_ENDPOINT =
  "https://web.push.apple.com/QCzXQBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB-different-apple-endpoint-abc";

function insertSubscription(
  id: string,
  userId: string,
  endpoint: string,
): void {
  sqliteInstance
    .prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, userId, endpoint, "p256dh-value", "auth-value");
}

function countSubscriptions(userId: string): number {
  const row = sqliteInstance
    .prepare(
      "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?",
    )
    .get(userId) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqliteInstance?.close();
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec("PRAGMA foreign_keys = ON");
  sqliteInstance.exec(PUSH_SUBSCRIPTIONS_DDL);
  sqliteInstance
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run(USER, "ashley");
  sqliteInstance
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run(OTHER_USER, "other");

  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
  infoSpy.mockClear();
  warnSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Module-load contract: setVapidDetails called once with tuple from
// vapid-config.getVapidDetails().
// ---------------------------------------------------------------------------

describe("push-sender module load", () => {
  it("calls webpush.setVapidDetails once at module load with vapid-config tuple", () => {
    expect(setVapidDetailsMock).toHaveBeenCalled();
    // First call args: (subject, publicKey, privateKey)
    const firstCallArgs = setVapidDetailsMock.mock.calls[0];
    expect(firstCallArgs).toEqual([
      "mailto:test@example.com",
      "test-public-key",
      "test-private-key",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Behavior tests
// ---------------------------------------------------------------------------

describe("sendPushToUser", () => {
  it("Test 1: happy path — 2 subs both succeed, no prune, forceSave NOT called", async () => {
    insertSubscription("sub-1", USER, FCM_ENDPOINT);
    insertSubscription("sub-2", USER, APPLE_ENDPOINT);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    // Payload is JSON-stringified; TTL:60 + urgency:"high" (Pattern 2).
    const [subscription, payloadJson, options] =
      sendNotificationMock.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: FCM_ENDPOINT,
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    });
    expect(JSON.parse(payloadJson as string)).toEqual(SAMPLE_PAYLOAD);
    expect(options).toEqual({ TTL: 60, urgency: "high" });

    expect(countSubscriptions(USER)).toBe(2);
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });

  it("Test 2: 410 prune — sub deleted, forceSave called, info log with truncated endpoint", async () => {
    insertSubscription("sub-1", USER, FCM_ENDPOINT);
    sendNotificationMock.mockRejectedValue({
      statusCode: 410,
      body: "Gone",
    });

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(countSubscriptions(USER)).toBe(0);
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledWith("push-subscription-prune-dead");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [msg, ctx] = infoSpy.mock.calls[0];
    expect(msg).toMatch(/pruned/i);
    // Log must contain the truncated endpoint only — NEVER the full URL.
    const endpointInLog = (ctx as { endpoint?: string }).endpoint;
    expect(endpointInLog).toBe(FCM_ENDPOINT.slice(0, 40));
    expect(endpointInLog!.length).toBe(40);
    // Sanity: full URL is NOT anywhere in the log payload.
    expect(JSON.stringify({ msg, ctx })).not.toContain(
      FCM_ENDPOINT.slice(41),
    );
  });

  it("Test 3: 404 prune — same behavior as 410 with statusCode 404", async () => {
    insertSubscription("sub-1", USER, APPLE_ENDPOINT);
    sendNotificationMock.mockRejectedValue({
      statusCode: 404,
      body: "Not Found",
    });

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    expect(countSubscriptions(USER)).toBe(0);
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledWith("push-subscription-prune-dead");
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 4: mixed — one succeeds one 410-throws — dead pruned, alive kept, forceSave once", async () => {
    insertSubscription("sub-alive", USER, FCM_ENDPOINT);
    insertSubscription("sub-dead", USER, APPLE_ENDPOINT);

    // Route sendNotification by endpoint: FCM → success, Apple → 410.
    sendNotificationMock.mockImplementation(
      async (sub: { endpoint: string }) => {
        if (sub.endpoint === APPLE_ENDPOINT) {
          throw { statusCode: 410, body: "Gone" };
        }
        return undefined;
      },
    );

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(countSubscriptions(USER)).toBe(1);
    // Confirm the surviving row is the FCM one.
    const survivor = sqliteInstance
      .prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?")
      .get(USER) as { endpoint: string };
    expect(survivor.endpoint).toBe(FCM_ENDPOINT);
    // forceSave fires ONCE for the wave, not once per pruned row.
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 5: non-410 error — warn logged with truncated endpoint, row kept, forceSave NOT called", async () => {
    insertSubscription("sub-1", USER, FCM_ENDPOINT);
    sendNotificationMock.mockRejectedValue({
      statusCode: 500,
      message: "server exploded",
    });

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    // Row NOT deleted — a 500 is transient, not a "dead endpoint" signal.
    expect(countSubscriptions(USER)).toBe(1);
    expect(forceSaveSpy).not.toHaveBeenCalled();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, ctx] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/send failed/i);
    const c = ctx as { statusCode?: number; endpoint?: string };
    expect(c.statusCode).toBe(500);
    expect(c.endpoint).toBe(FCM_ENDPOINT.slice(0, 40));
  });

  it("Test 6: forceSave failure — warn logged, does NOT re-throw (never-throw contract)", async () => {
    insertSubscription("sub-1", USER, FCM_ENDPOINT);
    sendNotificationMock.mockRejectedValue({ statusCode: 410 });
    forceSaveSpy.mockRejectedValueOnce(new Error("disk full"));

    // MUST NOT throw — trigger loop (Plan 06) depends on this contract.
    await expect(sendPushToUser(USER, SAMPLE_PAYLOAD)).resolves.toBeUndefined();

    // Prune DID happen (DELETE ran before forceSave); the forceSave failure
    // is absorbed but a warn is emitted.
    expect(countSubscriptions(USER)).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/forceSave failed|force[-_]save/i);
  });

  it("Test 7: empty subscriptions — no fetch, no forceSave, no logs, no throw", async () => {
    // No rows inserted for USER.
    await expect(sendPushToUser(USER, SAMPLE_PAYLOAD)).resolves.toBeUndefined();

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(forceSaveSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("scopes to the given userId only — OTHER_USER's rows are not touched", async () => {
    insertSubscription("sub-me", USER, FCM_ENDPOINT);
    insertSubscription("sub-them", OTHER_USER, APPLE_ENDPOINT);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser(USER, SAMPLE_PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock.mock.calls[0][0].endpoint).toBe(FCM_ENDPOINT);
    // OTHER_USER's row is preserved.
    expect(countSubscriptions(OTHER_USER)).toBe(1);
  });
});
