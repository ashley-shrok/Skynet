/**
 * Phase 79 Plan 04 Task 1 — bot-token-file-writer unit tests (blocker B-1).
 *
 * Covers PLAN.md § Task 1 <behavior>:
 *   - writeBotTokenFile happy path (0600, no trailing newline).
 *   - writeBotTokenFile refuses traversal (assertSafeHumanName gate).
 *   - deleteBotTokenFile silent no-op on absent; unlinks when present.
 *   - syncAllBotTokenFiles writes one file per row; reports counts.
 *   - syncAllBotTokenFiles tolerates single-row failure without throwing.
 *   - NEVER logs the bot token value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock tokens-store so syncAllBotTokenFiles doesn't touch the real DB.
vi.mock("./tokens-store.js", () => ({
  listTelegramBotTokens: vi.fn(),
}));

// Structured-log capture for the "never logs bot token" invariant.
const infoSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let tempDir: string;

beforeEach(() => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-btf-"));
  process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("bot-token-file-writer.writeBotTokenFile", () => {
  it("writes file 0600 with no trailing newline; content equals bot token", async () => {
    const { writeBotTokenFile } = await import("./bot-token-file-writer.js");
    await writeBotTokenFile("alexander", "1234567890:AAA-BBB-CCC");

    const file = path.join(tempDir, "alexander.bottoken");
    expect(fs.existsSync(file)).toBe(true);

    const contents = fs.readFileSync(file, "utf8");
    expect(contents).toBe("1234567890:AAA-BBB-CCC");
    expect(contents.endsWith("\n")).toBe(false);

    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);

    // .tmp cleaned up by rename.
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("refuses traversal via assertSafeHumanName gate; nothing written", async () => {
    const { writeBotTokenFile } = await import("./bot-token-file-writer.js");
    await expect(
      writeBotTokenFile("../etc/passwd", "1234:abc"),
    ).rejects.toThrow(/humanName failed shared-volume path guard/);
    expect(fs.readdirSync(tempDir)).toHaveLength(0);
  });
});

describe("bot-token-file-writer.deleteBotTokenFile", () => {
  it("silent no-op when file is absent (does NOT throw)", async () => {
    const { deleteBotTokenFile } = await import(
      "./bot-token-file-writer.js"
    );
    await expect(
      deleteBotTokenFile("never-existed"),
    ).resolves.toBeUndefined();
  });

  it("unlinks the file when present; subsequent existsSync = false", async () => {
    const { writeBotTokenFile, deleteBotTokenFile } = await import(
      "./bot-token-file-writer.js"
    );
    await writeBotTokenFile("alexander", "1234567890:XYZ");
    const file = path.join(tempDir, "alexander.bottoken");
    expect(fs.existsSync(file)).toBe(true);

    await deleteBotTokenFile("alexander");
    expect(fs.existsSync(file)).toBe(false);

    // Idempotent second delete.
    await expect(deleteBotTokenFile("alexander")).resolves.toBeUndefined();
  });
});

describe("bot-token-file-writer.syncAllBotTokenFiles", () => {
  it("writes one .bottoken file per row; reports {written: N, failed: 0}", async () => {
    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-06T00:00:00Z",
        updatedAt: "2026-09-06T00:00:00Z",
      },
      {
        identityKey: "beatrix",
        botToken: "2222:BBB",
        botUsername: "beatrix_bot",
        humanUserId: "u2",
        telegramChatId: "-100",
        createdAt: "2026-09-06T00:00:00Z",
        updatedAt: "2026-09-06T00:00:00Z",
      },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    const result = await syncAllBotTokenFiles();
    expect(result).toEqual({ written: 2, failed: 0 });

    expect(
      fs.readFileSync(path.join(tempDir, "alexander.bottoken"), "utf8"),
    ).toBe("1111:AAA");
    expect(
      fs.readFileSync(path.join(tempDir, "beatrix.bottoken"), "utf8"),
    ).toBe("2222:BBB");
  });

  it("reports partial failure ({written:N-1, failed:1}) without throwing", async () => {
    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander", // valid
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-06T00:00:00Z",
        updatedAt: "2026-09-06T00:00:00Z",
      },
      {
        identityKey: "../evil", // will fail the assertSafeHumanName guard
        botToken: "2222:BBB",
        botUsername: "evil_bot",
        humanUserId: "u2",
        telegramChatId: null,
        createdAt: "2026-09-06T00:00:00Z",
        updatedAt: "2026-09-06T00:00:00Z",
      },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );

    // Must NOT throw despite the bad row.
    const result = await syncAllBotTokenFiles();
    expect(result).toEqual({ written: 1, failed: 1 });
    // The valid row's file must still have been written.
    expect(fs.existsSync(path.join(tempDir, "alexander.bottoken"))).toBe(true);
    // A warn should have been emitted for the failure.
    expect(warnSpy).toHaveBeenCalled();
  });

  it("NEVER logs the bot token value in any log payload", async () => {
    const { listTelegramBotTokens } = await import("./tokens-store.js");
    const SECRET = "SUPER_SECRET_BOTTOKEN_DO_NOT_LEAK_9f8e7d6c5b";
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander",
        botToken: SECRET,
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-06T00:00:00Z",
        updatedAt: "2026-09-06T00:00:00Z",
      },
    ]);

    const { syncAllBotTokenFiles, writeBotTokenFile } = await import(
      "./bot-token-file-writer.js"
    );
    await syncAllBotTokenFiles();
    await writeBotTokenFile("beatrix", SECRET);

    const allLogs = JSON.stringify([
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);
    expect(allLogs).not.toContain(SECRET);
    expect(allLogs).not.toContain("SUPER_SECRET_BOTTOKEN_DO_NOT_LEAK");
  });
});
