/**
 * Phase 79 Plan 04 Task 1 — registry-writer unit tests.
 *
 * Covers PLAN.md § Task 1 <behavior>:
 *   - buildRegistryFromRows shape (no bot_token, no cred field).
 *   - buildRegistryFromRows with empty rows → {agents: []}.
 *   - writeRegistry writes atomically and readback parses.
 *   - writeRegistry rename failure cleans up .tmp.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-regw-"));
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

describe("registry-writer.buildRegistryFromRows", () => {
  it("returns {agents: []} for empty rows", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");
    const registry = buildRegistryFromRows([], new Map(), new Map());
    expect(registry).toEqual({ agents: [] });
  });

  it("emits Nina-shape agents entry (no bot_token, no cred field)", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");

    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "user-uuid-1",
        telegramChatId: "-100123",
      },
    ];
    const humansByUserId = new Map([
      [
        "user-uuid-1",
        { name: "ashley", mxid: "@ashley:thenasty.taild9b663.ts.net" },
      ],
    ]);
    const agentsByIdentityKey = new Map([
      [
        "alexander",
        {
          name: "alexander",
          mxid: "@alexander:thenasty.taild9b663.ts.net",
        },
      ],
    ]);

    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
    );

    expect(registry.agents).toHaveLength(1);
    const agent = registry.agents[0];
    expect(agent.name).toBe("alexander");
    expect(agent.mxid).toBe("@alexander:thenasty.taild9b663.ts.net");
    expect(agent.humans).toHaveLength(1);
    expect(agent.humans[0]).toEqual({
      name: "ashley",
      mxid: "@ashley:thenasty.taild9b663.ts.net",
      chat_id: "-100123",
      room: null,
      token: "ashley.token",
    });

    // Serialization check — absolutely no bot_token or cred field present.
    const serialized = JSON.stringify(registry);
    expect(serialized).not.toMatch(/bot_token/);
    expect(serialized).not.toMatch(/\bcred\b/);
  });

  it("emits multiple agents (one per identityKey)", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");

    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
      },
      {
        identityKey: "beatrix",
        botUsername: "beatrix_bot",
        humanUserId: "u2",
        telegramChatId: "-100999",
      },
    ];
    const humansByUserId = new Map([
      ["u1", { name: "ashley", mxid: "@ashley:h" }],
      ["u2", { name: "zoey", mxid: "@zoey:h" }],
    ]);
    const agentsByIdentityKey = new Map([
      ["alexander", { name: "alexander", mxid: "@alexander:h" }],
      ["beatrix", { name: "beatrix", mxid: "@beatrix:h" }],
    ]);

    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
    );

    expect(registry.agents).toHaveLength(2);
    const alex = registry.agents.find((a) => a.name === "alexander")!;
    const bea = registry.agents.find((a) => a.name === "beatrix")!;
    expect(alex.humans[0].name).toBe("ashley");
    expect(alex.humans[0].chat_id).toBeNull();
    expect(bea.humans[0].name).toBe("zoey");
    expect(bea.humans[0].chat_id).toBe("-100999");
  });

  it("skips rows whose humanUserId does not resolve in the humans map", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");
    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "no-such-user",
        telegramChatId: null,
      },
    ];
    const agentsByIdentityKey = new Map([
      ["alexander", { name: "alexander", mxid: "@alexander:h" }],
    ]);
    const registry = buildRegistryFromRows(
      rows,
      new Map(),
      agentsByIdentityKey,
    );
    // Agent emitted with empty humans[] — bridge treats zero-humans agents
    // as inactive and does not spawn a poller for them.
    expect(registry.agents).toHaveLength(1);
    expect(registry.agents[0].humans).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Phase 83 Plan 04 — roomByAgentHumanMxidPair map (optional 4th arg).
  // Key format: `${agentMxid}\t${humanMxid}` (tab separator; tab is
  // never valid inside a Matrix mxid, so no collision risk).
  // ------------------------------------------------------------------

  it("RW-M2: map fully populated — humans[].room is looked up by (agent, human) mxid pair", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");

    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "user-uuid-1",
        telegramChatId: "-100123",
      },
    ];
    const humansByUserId = new Map([
      [
        "user-uuid-1",
        { name: "ashley", mxid: "@ashley:server" },
      ],
    ]);
    const agentsByIdentityKey = new Map([
      [
        "alexander",
        { name: "alexander", mxid: "@alexander:server" },
      ],
    ]);
    const roomByAgentHumanMxidPair = new Map<string, string | null>([
      ["@alexander:server\t@ashley:server", "!dmroom1:server"],
    ]);

    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
      roomByAgentHumanMxidPair,
    );

    expect(registry.agents).toHaveLength(1);
    expect(registry.agents[0].humans[0]).toEqual({
      name: "ashley",
      mxid: "@ashley:server",
      chat_id: "-100123",
      room: "!dmroom1:server",
      token: "ashley.token",
    });
  });

  it("RW-M3: map partial — pairs present populate, absent pairs fall back to null", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");

    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: "-100001",
      },
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "u2",
        telegramChatId: "-100002",
      },
    ];
    const humansByUserId = new Map([
      ["u1", { name: "ashley", mxid: "@ashley:server" }],
      ["u2", { name: "zoey", mxid: "@zoey:server" }],
    ]);
    const agentsByIdentityKey = new Map([
      ["alexander", { name: "alexander", mxid: "@alexander:server" }],
    ]);
    // Only Ashley's pair is in the map — Zoey's key is absent.
    const roomByAgentHumanMxidPair = new Map<string, string | null>([
      ["@alexander:server\t@ashley:server", "!dmroom-ashley"],
    ]);

    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
      roomByAgentHumanMxidPair,
    );

    expect(registry.agents).toHaveLength(1);
    const humans = registry.agents[0].humans;
    expect(humans).toHaveLength(2);
    const ashley = humans.find((h) => h.name === "ashley")!;
    const zoey = humans.find((h) => h.name === "zoey")!;
    expect(ashley.room).toBe("!dmroom-ashley");
    expect(zoey.room).toBeNull();
  });

  it("RW-M4: map has explicit null for a pair — passes through as null (not undefined)", async () => {
    const { buildRegistryFromRows } = await import("./registry-writer.js");

    const rows = [
      {
        identityKey: "alexander",
        botUsername: "alexander_bot",
        humanUserId: "u1",
        telegramChatId: null,
      },
    ];
    const humansByUserId = new Map([
      ["u1", { name: "ashley", mxid: "@ashley:server" }],
    ]);
    const agentsByIdentityKey = new Map([
      ["alexander", { name: "alexander", mxid: "@alexander:server" }],
    ]);
    const roomByAgentHumanMxidPair = new Map<string, string | null>([
      ["@alexander:server\t@ashley:server", null],
    ]);

    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
      roomByAgentHumanMxidPair,
    );

    expect(registry.agents[0].humans[0].room).toBeNull();
  });
});

describe("registry-writer.writeRegistry", () => {
  it("writes atomically and readback JSON.parses to the same object", async () => {
    const { writeRegistry } = await import("./registry-writer.js");

    const registry = {
      agents: [
        {
          name: "alexander",
          mxid: "@alexander:h",
          humans: [
            {
              name: "ashley",
              mxid: "@ashley:h",
              chat_id: "-100123",
              room: null,
              token: "ashley.token",
            },
          ],
        },
      ],
    };

    await writeRegistry(registry);

    const registryFile = path.join(tempDir, "registry.json");
    expect(fs.existsSync(registryFile)).toBe(true);
    expect(fs.existsSync(`${registryFile}.tmp`)).toBe(false);

    const parsed = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    expect(parsed).toEqual(registry);

    // Mode 0o644 — readable by bridge, writable only by us.
    const mode = fs.statSync(registryFile).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("cleans up .tmp file on rename failure", async () => {
    const { writeRegistry } = await import("./registry-writer.js");

    // Force fs.rename to fail by shadowing it via vi.spyOn.
    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(new Error("simulated rename failure"));

    const registry = {
      agents: [
        {
          name: "alexander",
          mxid: "@alexander:h",
          humans: [],
        },
      ],
    };

    await expect(writeRegistry(registry)).rejects.toThrow(
      /simulated rename failure/,
    );

    // .tmp file must have been unlinked in the cleanup path.
    expect(fs.existsSync(path.join(tempDir, "registry.json.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "registry.json"))).toBe(false);

    renameSpy.mockRestore();
  });
});
