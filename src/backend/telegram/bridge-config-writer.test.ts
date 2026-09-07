/**
 * Phase 79 Plan 04 Task 2 — bridge-config-writer unit tests.
 *
 * Covers PLAN.md § Task 2 <behavior>:
 *   - writeBridgeConfigEnv happy path: writes MATRIX_ROOT + STT_URL to
 *     /state/config.env with the header comment.
 *   - writeBridgeConfigEnv when getMatrixHomeserverBase returns null:
 *     does NOT write, returns {ok:false, reason:"no matrix admin creds ingested"}.
 *   - writeBridgeConfigEnv unsafe-chars guard: rejects '#' and '\n' in URL.
 *   - rewriteRegistryFromCurrentState orchestration: calls listTelegramBotTokens,
 *     users query, syncAllBotTokenFiles, mintAndWriteHumanToken, buildRegistryFromRows,
 *     writeRegistry.
 *   - rewriteRegistryFromCurrentState re-callability (blocker B-2): back-to-back
 *     calls both return clean result shape; no unhandled rejections.
 *   - rewriteRegistryFromCurrentState never throws — always returns
 *     {ok:true,...} or {ok:false, error} even on internal exception.
 *   - ensureBridgeConfigWritten calls both; skips rewrite if config write fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// --- Mock all downstream dependencies. -----------------------------

vi.mock("../config/media-endpoints.js", () => ({
  STT_URL: "http://100.80.122.111:8000/v1/audio/transcriptions",
  getMatrixHomeserverBase: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-client.js", () => ({
  getSharedDMRoom: vi.fn(),
}));

vi.mock("./tokens-store.js", () => ({
  listTelegramBotTokens: vi.fn(),
}));

vi.mock("./bot-token-file-writer.js", () => ({
  syncAllBotTokenFiles: vi.fn(),
}));

vi.mock("./human-token-writer.js", () => ({
  mintAndWriteHumanToken: vi.fn(),
}));

vi.mock("./registry-writer.js", () => ({
  buildRegistryFromRows: vi.fn(),
  writeRegistry: vi.fn(),
}));

// Mock the db + schema import so the users-table select does not touch
// the real DB. Only the bridge-config-writer imports these — the writer
// modules under test in Task 1 do not, so this mock stays local.
const usersSelectResult = { execute: vi.fn() };
const dbSelectChain = {
  from: vi.fn().mockReturnValue(usersSelectResult),
};
vi.mock("../database/db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue(dbSelectChain),
  },
}));

vi.mock("../database/db/schema.js", () => ({
  users: {
    id: "id",
    username: "username",
    mxid: "mxid",
  },
}));

const infoSpy = vi.fn();
const warnSpy = vi.fn();
const errorSpy = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
    debug: vi.fn(),
  },
}));

let tempDir: string;

beforeEach(async () => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-bcw-"));
  process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
  vi.resetModules();

  // Reset all mock call histories so per-test assertions like
  // toHaveBeenCalledOnce() are not polluted by previous tests.
  const mep = await import("../config/media-endpoints.js");
  vi.mocked(mep.getMatrixHomeserverBase).mockReset();
  const mac = await import("../matrix/matrix-admin-creds-store.js");
  vi.mocked(mac.getMatrixAdminCreds).mockReset();
  // Default: admin creds present, canonical server_name. Individual tests
  // override for null/malformed cases.
  vi.mocked(mac.getMatrixAdminCreds).mockResolvedValue({
    homeserverBase: "http://100.113.23.63:8008",
    userId: "@skynet-admin:thenasty.taild9b663.ts.net",
    accessToken: "admin-token",
    password: "admin-pw",
  });
  const ts = await import("./tokens-store.js");
  vi.mocked(ts.listTelegramBotTokens).mockReset();
  const btfw = await import("./bot-token-file-writer.js");
  vi.mocked(btfw.syncAllBotTokenFiles).mockReset();
  const htw = await import("./human-token-writer.js");
  vi.mocked(htw.mintAndWriteHumanToken).mockReset();
  const rw = await import("./registry-writer.js");
  vi.mocked(rw.buildRegistryFromRows).mockReset();
  vi.mocked(rw.writeRegistry).mockReset();
  const mac2 = await import("../matrix/matrix-admin-client.js");
  vi.mocked(mac2.getSharedDMRoom).mockReset();
  // Default: no shared room discovered. Individual tests override.
  vi.mocked(mac2.getSharedDMRoom).mockResolvedValue(null);

  usersSelectResult.execute.mockReset();
  // The db.select().from(users) chain returns a thenable/awaitable array in
  // production drizzle usage. Emulate by making the terminal object itself
  // then-able via Promise.resolve wrapper below in each test.
});

afterEach(() => {
  delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// --- Helpers -------------------------------------------------------

/**
 * Rig the drizzle `db.select().from(users)` chain to resolve to the given
 * rows. In production, `await db.select({...}).from(users)` is itself the
 * awaited value (drizzle's chain-terminator returns a PromiseLike). We
 * emulate by making the terminal object's `.then` resolve with the rows.
 */
async function stubUsersQuery(
  rows: Array<{ id: string; username: string; mxid: string | null }>,
): Promise<void> {
  const { db } = await import("../database/db/index.js");
  vi.mocked(db.select).mockImplementation((..._args: unknown[]) => {
    const chain = {
      from: vi.fn(() => Promise.resolve(rows)),
    };
    return chain as unknown as ReturnType<typeof db.select>;
  });
}

// --- Tests ---------------------------------------------------------

describe("bridge-config-writer.writeBridgeConfigEnv", () => {
  it("happy path — writes MATRIX_ROOT + STT_URL to /state/config.env", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { writeBridgeConfigEnv } = await import(
      "./bridge-config-writer.js"
    );
    const result = await writeBridgeConfigEnv();
    expect(result).toEqual({ ok: true });

    const envFile = path.join(tempDir, "config.env");
    expect(fs.existsSync(envFile)).toBe(true);
    const contents = fs.readFileSync(envFile, "utf8");
    expect(contents).toContain("MATRIX_ROOT=http://100.113.23.63:8008");
    expect(contents).toContain(
      "STT_URL=http://100.80.122.111:8000/v1/audio/transcriptions",
    );
    expect(contents).toContain("Phase 79 Plan 04");
    // .tmp cleaned up
    expect(fs.existsSync(`${envFile}.tmp`)).toBe(false);
  });

  it("no admin creds — returns ok:false, does not write disk", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(null);

    const { writeBridgeConfigEnv } = await import(
      "./bridge-config-writer.js"
    );
    const result = await writeBridgeConfigEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/admin creds/i);
    }
    expect(fs.existsSync(path.join(tempDir, "config.env"))).toBe(false);
  });

  it("rejects unsafe chars (# or newline) in the URL", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://foo\nbar:8008",
    );

    const { writeBridgeConfigEnv } = await import(
      "./bridge-config-writer.js"
    );
    const result = await writeBridgeConfigEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unsafe/i);
    }
    expect(fs.existsSync(path.join(tempDir, "config.env"))).toBe(false);
  });
});

describe("bridge-config-writer.rewriteRegistryFromCurrentState", () => {
  it("orchestrates the full pipeline: list → users → syncBotFiles → mintTokens → buildRegistry → writeRegistry", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

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
    ]);

    await stubUsersQuery([
      { id: "u1", username: "ashley", mxid: "@ashley:100.113.23.63" },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 1,
      failed: 0,
    });

    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({
      agents: [
        {
          name: "alexander",
          mxid: "@alexander:100.113.23.63",
          humans: [],
        },
      ],
    });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentCount).toBeGreaterThanOrEqual(1);
      expect(result.humanCount).toBeGreaterThanOrEqual(1);
    }

    expect(listTelegramBotTokens).toHaveBeenCalled();
    expect(syncAllBotTokenFiles).toHaveBeenCalled();
    expect(mintAndWriteHumanToken).toHaveBeenCalledWith(
      "@ashley:100.113.23.63",
      "ashley",
    );
    expect(buildRegistryFromRows).toHaveBeenCalled();
    expect(writeRegistry).toHaveBeenCalled();
  });

  it("re-callable (blocker B-2): back-to-back calls both succeed with clean shape", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([]);
    await stubUsersQuery([]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 0,
      failed: 0,
    });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const r1 = await rewriteRegistryFromCurrentState();
    const r2 = await rewriteRegistryFromCurrentState();

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("does NOT throw on internal exception; returns {ok:false, error}", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockRejectedValue(
      new Error("simulated DB failure"),
    );

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/simulated DB failure/);
    }
  });

  it("mxid derivation: agent mxid uses server_name from admin creds userId, NOT hostname parsed from homeserverBase URL (2026-09-07 fix)", async () => {
    // Regression: bridge-config-writer used to derive server_name via
    // `new URL(homeserverBase).hostname`, which yielded `100.113.23.63`
    // when the URL was `http://100.113.23.63:8008`. The correct
    // server_name lives in matrix_admin_creds.userId (`@name:server`).
    // MX→TG routing scans events by sender mxid; a wrong-namespace mxid
    // silently drops every outbound message.
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    // Deliberately IP-based URL — the OLD code would produce
    // `@tina:100.113.23.63`, which is what the fix eliminates.
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { getMatrixAdminCreds } = await import(
      "../matrix/matrix-admin-creds-store.js"
    );
    vi.mocked(getMatrixAdminCreds).mockResolvedValue({
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      accessToken: "admin-token",
      password: "admin-pw",
    });

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "tina",
        botToken: "1111:AAA",
        botUsername: "tina_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await stubUsersQuery([
      { id: "u1", username: "ashley", mxid: "@ashley:thenasty.taild9b663.ts.net" },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({ written: 1, failed: 0 });
    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    await rewriteRegistryFromCurrentState();

    // Assertion: the agents map passed to buildRegistryFromRows has the
    // CORRECT server_name (from admin creds userId), NOT the URL hostname.
    expect(buildRegistryFromRows).toHaveBeenCalled();
    const callArgs = vi.mocked(buildRegistryFromRows).mock.calls[0];
    // buildRegistryFromRows(rows, humansByUserId, agentsByIdentityKey)
    // — signature verified via registry-writer.ts. Agents map is arg index 2.
    const agentsArg = callArgs[2] as Map<string, { name: string; mxid: string }>;
    const tinaAgent = agentsArg.get("tina");
    expect(tinaAgent).toBeDefined();
    expect(tinaAgent!.mxid).toBe("@tina:thenasty.taild9b663.ts.net");
    // Anti-regression — the wrong (URL-hostname) derivation must NEVER appear.
    expect(tinaAgent!.mxid).not.toContain("100.113.23.63");
  });

  it("mxid derivation: skips agent when admin creds is null (no way to build a safe mxid)", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { getMatrixAdminCreds } = await import(
      "../matrix/matrix-admin-creds-store.js"
    );
    vi.mocked(getMatrixAdminCreds).mockResolvedValue(null);

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "tina",
        botToken: "1111:AAA",
        botUsername: "tina_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await stubUsersQuery([]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({ written: 0, failed: 0 });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    await rewriteRegistryFromCurrentState();

    // With no admin creds, no agent mxid can be built — agents map empty.
    expect(buildRegistryFromRows).toHaveBeenCalled();
    const agentsArg = vi.mocked(buildRegistryFromRows).mock.calls[0][2] as Map<
      string,
      unknown
    >;
    expect(agentsArg.size).toBe(0);
  });

  it("serverNameFromMxid: extracts server_name portion", async () => {
    const { serverNameFromMxid } = await import("./bridge-config-writer.js");
    expect(serverNameFromMxid("@skynet-admin:thenasty.taild9b663.ts.net")).toBe(
      "thenasty.taild9b663.ts.net",
    );
    expect(serverNameFromMxid("@ashley:matrix.org")).toBe("matrix.org");
    expect(serverNameFromMxid("@a:b")).toBe("b");
    // Malformed input returns null (not empty string).
    expect(serverNameFromMxid("no-colon")).toBeNull();
    expect(serverNameFromMxid(":no-localpart")).toBeNull();
    expect(serverNameFromMxid("@trailing-colon:")).toBeNull();
  });

  // ------------------------------------------------------------------
  // Phase 83 Plan 04 — getSharedDMRoom per-pair thread + map assembly.
  // ------------------------------------------------------------------

  it("BCW-M1: computes (agent, human) pairs from rows, calls getSharedDMRoom per pair, threads Map into buildRegistryFromRows", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: "-100001",
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u2",
        telegramChatId: "-100002",
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await stubUsersQuery([
      {
        id: "u1",
        username: "ashley",
        mxid: "@ashley:thenasty.taild9b663.ts.net",
      },
      {
        id: "u2",
        username: "zoey",
        mxid: "@zoey:thenasty.taild9b663.ts.net",
      },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 1,
      failed: 0,
    });
    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    const { getSharedDMRoom } = await import(
      "../matrix/matrix-admin-client.js"
    );
    vi.mocked(getSharedDMRoom).mockImplementation(
      async (_agent: string, human: string) => {
        if (human === "@ashley:thenasty.taild9b663.ts.net") return "!ashley-room";
        if (human === "@zoey:thenasty.taild9b663.ts.net") return "!zoey-room";
        return null;
      },
    );

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    expect(result.ok).toBe(true);

    // getSharedDMRoom called exactly twice (one per pair).
    expect(getSharedDMRoom).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(getSharedDMRoom).mock.calls;
    const callArgSets = calls.map((c) => new Set(c));
    // Assert both pair-arg-sets exist among the calls (order-independent).
    expect(
      callArgSets.some(
        (s) =>
          s.has("@alexander:thenasty.taild9b663.ts.net") &&
          s.has("@ashley:thenasty.taild9b663.ts.net"),
      ),
    ).toBe(true);
    expect(
      callArgSets.some(
        (s) =>
          s.has("@alexander:thenasty.taild9b663.ts.net") &&
          s.has("@zoey:thenasty.taild9b663.ts.net"),
      ),
    ).toBe(true);

    // buildRegistryFromRows called with a 4th argument that is a Map with
    // both pair keys populated to the mocked room ids.
    expect(buildRegistryFromRows).toHaveBeenCalled();
    const bcwArgs = vi.mocked(buildRegistryFromRows).mock.calls[0];
    const roomMap = bcwArgs[3] as Map<string, string | null> | undefined;
    expect(roomMap).toBeInstanceOf(Map);
    expect(roomMap!.size).toBe(2);
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@ashley:thenasty.taild9b663.ts.net",
      ),
    ).toBe("!ashley-room");
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@zoey:thenasty.taild9b663.ts.net",
      ),
    ).toBe("!zoey-room");
  });

  it("BCW-M2: getSharedDMRoom returns null for one pair — map has explicit null; rewrite still succeeds", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u2",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await stubUsersQuery([
      {
        id: "u1",
        username: "ashley",
        mxid: "@ashley:thenasty.taild9b663.ts.net",
      },
      {
        id: "u2",
        username: "zoey",
        mxid: "@zoey:thenasty.taild9b663.ts.net",
      },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 1,
      failed: 0,
    });
    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    const { getSharedDMRoom } = await import(
      "../matrix/matrix-admin-client.js"
    );
    vi.mocked(getSharedDMRoom).mockImplementation(
      async (_agent: string, human: string) => {
        if (human === "@ashley:thenasty.taild9b663.ts.net") return "!ashley-room";
        return null; // zoey: no shared DM room discovered
      },
    );

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    expect(result.ok).toBe(true);

    const roomMap = vi.mocked(buildRegistryFromRows).mock.calls[0][3] as
      | Map<string, string | null>
      | undefined;
    expect(roomMap).toBeInstanceOf(Map);
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@ashley:thenasty.taild9b663.ts.net",
      ),
    ).toBe("!ashley-room");
    // Zoey key present but value is null (not undefined).
    expect(
      roomMap!.has(
        "@alexander:thenasty.taild9b663.ts.net\t@zoey:thenasty.taild9b663.ts.net",
      ),
    ).toBe(true);
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@zoey:thenasty.taild9b663.ts.net",
      ),
    ).toBeNull();
  });

  it("BCW-M3: getSharedDMRoom throws for a pair — pair collapses to null, other pairs unaffected, warn logged, no propagation", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
      {
        identityKey: "alexander",
        botToken: "1111:AAA",
        botUsername: "alexander_bot",
        humanUserId: "u2",
        telegramChatId: null,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await stubUsersQuery([
      {
        id: "u1",
        username: "ashley",
        mxid: "@ashley:thenasty.taild9b663.ts.net",
      },
      {
        id: "u2",
        username: "zoey",
        mxid: "@zoey:thenasty.taild9b663.ts.net",
      },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 1,
      failed: 0,
    });
    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    const { getSharedDMRoom } = await import(
      "../matrix/matrix-admin-client.js"
    );
    vi.mocked(getSharedDMRoom).mockImplementation(
      async (_agent: string, human: string) => {
        if (human === "@ashley:thenasty.taild9b663.ts.net") return "!ashley-room";
        throw new Error("simulated admin API failure for zoey");
      },
    );

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    // Overall pipeline still succeeds — no throw propagation.
    expect(result.ok).toBe(true);

    const roomMap = vi.mocked(buildRegistryFromRows).mock.calls[0][3] as
      | Map<string, string | null>
      | undefined;
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@ashley:thenasty.taild9b663.ts.net",
      ),
    ).toBe("!ashley-room");
    expect(
      roomMap!.get(
        "@alexander:thenasty.taild9b663.ts.net\t@zoey:thenasty.taild9b663.ts.net",
      ),
    ).toBeNull();

    // Structured warn logged for the failed pair.
    const failCall = warnSpy.mock.calls.find((c) => {
      const meta = c[1] as { operation?: string } | undefined;
      return meta?.operation === "bridge_registry_room_lookup_failed";
    });
    expect(failCall).toBeDefined();
    const failMeta = failCall![1] as {
      agentMxid?: string;
      humanMxid?: string;
      error?: string;
    };
    expect(failMeta.agentMxid).toBe("@alexander:thenasty.taild9b663.ts.net");
    expect(failMeta.humanMxid).toBe("@zoey:thenasty.taild9b663.ts.net");
    expect(failMeta.error).toMatch(/simulated admin API failure/);
  });

  it("BCW-M4: no rows → getSharedDMRoom NOT called; buildRegistryFromRows receives an empty Map as 4th arg", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([]);
    await stubUsersQuery([]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 0,
      failed: 0,
    });

    const { getSharedDMRoom } = await import(
      "../matrix/matrix-admin-client.js"
    );

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    expect(result.ok).toBe(true);

    expect(getSharedDMRoom).not.toHaveBeenCalled();
    const roomMap = vi.mocked(buildRegistryFromRows).mock.calls[0][3] as
      | Map<string, string | null>
      | undefined;
    expect(roomMap).toBeInstanceOf(Map);
    expect(roomMap!.size).toBe(0);
  });

  it("tolerates single mintAndWriteHumanToken failure (best-effort loop)", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

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
    ]);

    await stubUsersQuery([
      { id: "u1", username: "ashley", mxid: "@ashley:100.113.23.63" },
    ]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 1,
      failed: 0,
    });

    const { mintAndWriteHumanToken } = await import(
      "./human-token-writer.js"
    );
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({
      ok: false,
      error: "loginAsUser failed",
    });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { rewriteRegistryFromCurrentState } = await import(
      "./bridge-config-writer.js"
    );
    const result = await rewriteRegistryFromCurrentState();
    // Overall still succeeds even though one token mint failed.
    expect(result.ok).toBe(true);
    // The buildRegistry + writeRegistry steps still ran.
    expect(writeRegistry).toHaveBeenCalled();
  });
});

describe("bridge-config-writer.ensureBridgeConfigWritten", () => {
  it("calls writeBridgeConfigEnv then rewriteRegistryFromCurrentState when config succeeds", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(
      "http://100.113.23.63:8008",
    );

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([]);
    await stubUsersQuery([]);

    const { syncAllBotTokenFiles } = await import(
      "./bot-token-file-writer.js"
    );
    vi.mocked(syncAllBotTokenFiles).mockResolvedValue({
      written: 0,
      failed: 0,
    });

    const { buildRegistryFromRows, writeRegistry } = await import(
      "./registry-writer.js"
    );
    vi.mocked(buildRegistryFromRows).mockReturnValue({ agents: [] });
    vi.mocked(writeRegistry).mockResolvedValue(undefined);

    const { ensureBridgeConfigWritten } = await import(
      "./bridge-config-writer.js"
    );
    await expect(ensureBridgeConfigWritten()).resolves.toBeUndefined();

    // Both underlying pieces should have been exercised.
    expect(getMatrixHomeserverBase).toHaveBeenCalled();
    expect(listTelegramBotTokens).toHaveBeenCalled();
    expect(syncAllBotTokenFiles).toHaveBeenCalled();
    expect(writeRegistry).toHaveBeenCalled();
    // The config file was written to disk.
    expect(fs.existsSync(path.join(tempDir, "config.env"))).toBe(true);
  });

  it("skips registry rewrite when config write fails (no admin creds)", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockResolvedValue(null);

    const { listTelegramBotTokens } = await import("./tokens-store.js");
    vi.mocked(listTelegramBotTokens).mockResolvedValue([]);

    const { ensureBridgeConfigWritten } = await import(
      "./bridge-config-writer.js"
    );
    await expect(ensureBridgeConfigWritten()).resolves.toBeUndefined();

    // listTelegramBotTokens should NOT be called because the rewrite step
    // is short-circuited when the config write returns ok:false.
    expect(listTelegramBotTokens).not.toHaveBeenCalled();
    // No config.env on disk.
    expect(fs.existsSync(path.join(tempDir, "config.env"))).toBe(false);
  });

  it("never throws even when everything fails (fire-and-forget-safe)", async () => {
    const { getMatrixHomeserverBase } = await import(
      "../config/media-endpoints.js"
    );
    vi.mocked(getMatrixHomeserverBase).mockRejectedValue(
      new Error("simulated boom"),
    );

    const { ensureBridgeConfigWritten } = await import(
      "./bridge-config-writer.js"
    );
    await expect(ensureBridgeConfigWritten()).resolves.toBeUndefined();
    // A warn/error log should have been emitted.
    expect(warnSpy.mock.calls.length + errorSpy.mock.calls.length).toBeGreaterThan(
      0,
    );
  });
});
