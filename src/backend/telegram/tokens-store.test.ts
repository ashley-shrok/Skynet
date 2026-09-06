/**
 * Phase 79 Plan 01 Task 2 — telegram-tokens-store unit tests.
 *
 * Mirrors the test setup pattern from
 * src/backend/matrix/matrix-admin-creds-store.test.ts exactly:
 *   - in-memory better-sqlite3 wired through Drizzle
 *   - vi.mock of db/index.js + system-crypto.js + database-save-trigger.js
 *   - deterministic master key at module scope
 *   - fresh SQLite per test via beforeEach
 *
 * Covers the five behavior cases from PLAN.md § Task 2:
 *   Test 1: setTelegramBotToken → getTelegramBotToken round-trips plaintext.
 *   Test 2: After setTelegramBotToken, the RAW SQLite row's bot_token
 *           column does NOT contain the plaintext (proves at-rest encryption)
 *           and parses as FieldCrypto JSON.
 *   Test 3: setTelegramBotToken called twice for the SAME identityKey
 *           UPDATEs (no dup row); createdAt preserved, updatedAt bumped.
 *   Test 4: listTelegramBotTokens returns all rows, each decrypted.
 *   Test 5: deleteTelegramBotToken removes the row; subsequent get → null.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

// Master key held at module scope so the SystemCrypto mock + any raw-row
// decryption assertions use the SAME bytes.
const TEST_MASTER_KEY = crypto.randomBytes(32);

// Test-owned in-memory SQLite. Replaced in beforeEach per test.
let sqliteInstance: Database.Database;
let drizzleInstance: ReturnType<typeof drizzle>;

vi.mock("../database/db/index.js", () => ({
  get db() {
    return drizzleInstance;
  },
}));

vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => TEST_MASTER_KEY,
    }),
  },
}));

vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn().mockResolvedValue(undefined),
    forceSave: vi.fn().mockResolvedValue(undefined),
  },
}));

// The migration SQL for telegram_bot_tokens — mirrors the exact shape
// added to db/index.ts in Task 1.
const TELEGRAM_BOT_TOKENS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS telegram_bot_tokens (
    identity_key TEXT PRIMARY KEY,
    bot_token TEXT NOT NULL,
    bot_username TEXT NOT NULL,
    human_user_id TEXT NOT NULL,
    telegram_chat_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

beforeEach(() => {
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec(TELEGRAM_BOT_TOKENS_CREATE_SQL);
  drizzleInstance = drizzle(sqliteInstance);
});

describe("telegram-tokens-store", () => {
  it("Test 1: setTelegramBotToken → getTelegramBotToken round-trips plaintext via FieldCrypto", async () => {
    const { setTelegramBotToken, getTelegramBotToken } = await import(
      "./tokens-store.js"
    );

    await setTelegramBotToken("alexander", {
      botToken: "1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLLLMMM",
      botUsername: "alexander_bot",
      humanUserId: "user-uuid-1",
      telegramChatId: null,
    });

    const readBack = await getTelegramBotToken("alexander");

    expect(readBack).not.toBeNull();
    expect(readBack?.identityKey).toBe("alexander");
    expect(readBack?.botToken).toBe(
      "1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLLLMMM",
    );
    expect(readBack?.botUsername).toBe("alexander_bot");
    expect(readBack?.humanUserId).toBe("user-uuid-1");
    expect(readBack?.telegramChatId).toBeNull();
    expect(typeof readBack?.createdAt).toBe("string");
    expect(typeof readBack?.updatedAt).toBe("string");
  });

  it("Test 2: After setTelegramBotToken, raw bot_token column is FieldCrypto JSON (not plaintext)", async () => {
    const { setTelegramBotToken } = await import("./tokens-store.js");

    const uniqueMarkerToken =
      "9999999999:UNIQUE_MARKER_TOKEN_do_not_leak_plaintext_XYZ";

    await setTelegramBotToken("alexander", {
      botToken: uniqueMarkerToken,
      botUsername: "alexander_bot",
      humanUserId: "user-uuid-1",
      telegramChatId: null,
    });

    const rawRow = sqliteInstance
      .prepare(
        "SELECT identity_key, bot_token, bot_username, human_user_id FROM telegram_bot_tokens WHERE identity_key = 'alexander'",
      )
      .get() as {
      identity_key: string;
      bot_token: string;
      bot_username: string;
      human_user_id: string;
    };

    expect(rawRow).toBeDefined();
    expect(rawRow.identity_key).toBe("alexander");

    // Encrypted-at-rest assertions: raw bot_token must NOT contain the plaintext.
    expect(rawRow.bot_token).not.toBe(uniqueMarkerToken);
    expect(rawRow.bot_token).not.toContain(uniqueMarkerToken);
    expect(rawRow.bot_token).not.toContain(
      "UNIQUE_MARKER_TOKEN_do_not_leak_plaintext",
    );

    // bot_username is NOT encrypted — display-only, should be plaintext.
    expect(rawRow.bot_username).toBe("alexander_bot");
    expect(rawRow.human_user_id).toBe("user-uuid-1");

    // Shape: parses as FieldCrypto JSON with {data, iv, tag, salt, recordId}.
    const parsed = JSON.parse(rawRow.bot_token);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("tag");
    expect(parsed).toHaveProperty("salt");
    expect(parsed).toHaveProperty("recordId");

    // recordId is bound to identity_key per HKDF context.
    expect(parsed.recordId).toBe("alexander");
  });

  it("Test 3: setTelegramBotToken twice for same identityKey UPDATEs (createdAt preserved, updatedAt bumped)", async () => {
    const { setTelegramBotToken, getTelegramBotToken } = await import(
      "./tokens-store.js"
    );

    await setTelegramBotToken("alexander", {
      botToken: "1234567890:FIRST_TOKEN_AAAAAAAAAAAAAAAAAAAAAAAAAA",
      botUsername: "alexander_bot",
      humanUserId: "user-uuid-1",
      telegramChatId: null,
    });

    const afterFirst = await getTelegramBotToken("alexander");
    const originalCreatedAt = afterFirst?.createdAt;
    expect(originalCreatedAt).toBeDefined();

    // Small sleep so updatedAt is deterministically > createdAt for the
    // ISO-string comparison at the end. 20ms is enough for
    // Date.now()/toISOString() to tick.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await setTelegramBotToken("alexander", {
      botToken: "9876543210:SECOND_TOKEN_BBBBBBBBBBBBBBBBBBBBBBBBB",
      botUsername: "alexander_bot_v2",
      humanUserId: "user-uuid-1",
      telegramChatId: "-100987654321",
    });

    // Exactly one row still (UPDATE, not INSERT).
    const rowCount = sqliteInstance
      .prepare("SELECT COUNT(*) as n FROM telegram_bot_tokens")
      .get() as { n: number };
    expect(rowCount.n).toBe(1);

    const afterSecond = await getTelegramBotToken("alexander");
    expect(afterSecond?.botToken).toBe(
      "9876543210:SECOND_TOKEN_BBBBBBBBBBBBBBBBBBBBBBBBB",
    );
    expect(afterSecond?.botUsername).toBe("alexander_bot_v2");
    expect(afterSecond?.telegramChatId).toBe("-100987654321");

    // createdAt preserved from the first write; updatedAt strictly later.
    expect(afterSecond?.createdAt).toBe(originalCreatedAt);
    expect(afterSecond?.updatedAt).not.toBe(originalCreatedAt);
    expect(
      new Date(afterSecond!.updatedAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(originalCreatedAt!).getTime());
  });

  it("Test 4: listTelegramBotTokens returns all rows, each decrypted", async () => {
    const { setTelegramBotToken, listTelegramBotTokens } = await import(
      "./tokens-store.js"
    );

    await setTelegramBotToken("alexander", {
      botToken: "1111111111:ALEXANDER_TOKEN_CCCCCCCCCCCCCCCCCCCCCC",
      botUsername: "alexander_bot",
      humanUserId: "user-uuid-1",
      telegramChatId: null,
    });
    await setTelegramBotToken("zoe", {
      botToken: "2222222222:ZOE_TOKEN_DDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      botUsername: "zoe_bot",
      humanUserId: "user-uuid-2",
      telegramChatId: "-100111222333",
    });
    await setTelegramBotToken("laura", {
      botToken: "3333333333:LAURA_TOKEN_EEEEEEEEEEEEEEEEEEEEEEEEEEE",
      botUsername: "laura_bot",
      humanUserId: "user-uuid-3",
      telegramChatId: null,
    });

    const rows = await listTelegramBotTokens();
    expect(rows.length).toBe(3);

    const byKey = new Map(rows.map((r) => [r.identityKey, r]));

    expect(byKey.get("alexander")?.botToken).toBe(
      "1111111111:ALEXANDER_TOKEN_CCCCCCCCCCCCCCCCCCCCCC",
    );
    expect(byKey.get("alexander")?.botUsername).toBe("alexander_bot");
    expect(byKey.get("alexander")?.telegramChatId).toBeNull();

    expect(byKey.get("zoe")?.botToken).toBe(
      "2222222222:ZOE_TOKEN_DDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    );
    expect(byKey.get("zoe")?.telegramChatId).toBe("-100111222333");

    expect(byKey.get("laura")?.botToken).toBe(
      "3333333333:LAURA_TOKEN_EEEEEEEEEEEEEEEEEEEEEEEEEEE",
    );
  });

  it("Test 5: deleteTelegramBotToken removes row; subsequent get returns null; silent no-op if row absent", async () => {
    const {
      setTelegramBotToken,
      getTelegramBotToken,
      deleteTelegramBotToken,
    } = await import("./tokens-store.js");

    await setTelegramBotToken("alexander", {
      botToken: "1234567890:TO_BE_DELETED_FFFFFFFFFFFFFFFFFFFFFFFFF",
      botUsername: "alexander_bot",
      humanUserId: "user-uuid-1",
      telegramChatId: null,
    });

    // Confirm present.
    expect(await getTelegramBotToken("alexander")).not.toBeNull();

    await deleteTelegramBotToken("alexander");

    // Gone.
    expect(await getTelegramBotToken("alexander")).toBeNull();

    // Second delete on absent row is a silent no-op (does not throw).
    await expect(deleteTelegramBotToken("alexander")).resolves.toBeUndefined();
    await expect(
      deleteTelegramBotToken("never-existed"),
    ).resolves.toBeUndefined();
  });
});
