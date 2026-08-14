/**
 * remote-hook-install.test.ts
 *
 * Unit tests for the one-time-per-host Stop-hook install helper.
 * All SSH operations go through MockSshChannel — no real SSH, no real disk I/O
 * (except for stop-hook.sh syntax checking in Test 1, done via bash -n in
 * acceptance criteria; here we test the TS logic only).
 *
 * Tests cover:
 *  1. stop-hook.sh syntax validity (verified via bash -n in acceptance criteria)
 *  2. installStopHook: mkdir, script drop, settings merge
 *  3. readAndMergeStopHookSettings: creates three-level structure from scratch
 *  4. Idempotency: second install skips settings write
 *  5. readAndMergeStopHookSettings creates from empty object
 *  6. Append (not replace): two hooks coexist
 *  7. Preserves existing keys
 *  8. uninstallStopHook: removes entry + script file
 *  9. SSH read error on settings.json throws
 *  10. Invalid JSON in settings.json throws without overwriting
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readAndMergeStopHookSettings,
  installStopHook,
  uninstallStopHook,
  STOP_HOOK_SCRIPT_CONTENTS,
} from "./remote-hook-install.js";
import type { SshChannel } from "./ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock systemLogger
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// MockSshChannel (reused from Task 1 approach)
// ---------------------------------------------------------------------------

class MockSshChannel implements SshChannel {
  private responses = new Map<string, string | null>();
  public callLog: Array<{ command: string; response: string | null }> = [];

  setResponse(pattern: string, response: string | null): void {
    this.responses.set(pattern, response);
  }

  countCallsMatching(pattern: string): number {
    return this.callLog.filter((c) => c.command.includes(pattern)).length;
  }

  async exec(command: string): Promise<string | null> {
    let response: string | null = null;
    for (const [pattern, resp] of this.responses.entries()) {
      if (command.includes(pattern)) {
        response = resp;
        break;
      }
    }
    this.callLog.push({ command, response });
    return response;
  }
}

// ---------------------------------------------------------------------------
// Helper: make a minimal valid settings.json
// ---------------------------------------------------------------------------

function makeSettings(stopHooks: unknown[] = []): string {
  return JSON.stringify({
    hooks: {
      Stop: stopHooks,
    },
  });
}

// ---------------------------------------------------------------------------
// Test 1: stop-hook.sh syntax validity
// This test is a TS-level sanity check. Actual bash -n runs in acceptance
// criteria. Here we import the module and verify it exists + exports functions.
// ---------------------------------------------------------------------------

describe("remote-hook-install module exports", () => {
  it("Test 1: exports readAndMergeStopHookSettings, installStopHook, uninstallStopHook", () => {
    expect(typeof readAndMergeStopHookSettings).toBe("function");
    expect(typeof installStopHook).toBe("function");
    expect(typeof uninstallStopHook).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Tests 3, 5, 6, 7: readAndMergeStopHookSettings (pure function)
// ---------------------------------------------------------------------------

describe("readAndMergeStopHookSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 5: creates full three-level structure from empty object", () => {
    const result = readAndMergeStopHookSettings({}, "/path/to/hook.sh");
    expect(result.alreadyInstalled).toBe(false);
    const merged = result.merged as {
      hooks: { Stop: Array<{ hooks: Array<{ type: string; command: string }> }> };
    };
    expect(merged.hooks.Stop).toBeDefined();
    expect(merged.hooks.Stop[0]).toBeDefined();
    expect(merged.hooks.Stop[0].hooks).toHaveLength(1);
    expect(merged.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "/path/to/hook.sh",
    });
  });

  it("Test 3: Settings.json merge creates correct three-level nesting", () => {
    const result = readAndMergeStopHookSettings({}, "/my/hook.sh");
    expect(result.alreadyInstalled).toBe(false);
    const merged = result.merged as Record<string, unknown>;
    const hooks = merged.hooks as Record<string, unknown>;
    expect(hooks).toBeDefined();
    const Stop = hooks.Stop as Array<{ hooks: Array<{ type: string; command: string }> }>;
    expect(Array.isArray(Stop)).toBe(true);
    expect(Stop[0].hooks[0].type).toBe("command");
    expect(Stop[0].hooks[0].command).toBe("/my/hook.sh");
  });

  it("Test 6: appends hook when existing hooks present (does NOT replace)", () => {
    const existing = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "/other/hook.sh" }],
          },
        ],
      },
    };
    const result = readAndMergeStopHookSettings(existing, "/path/to/hook.sh");
    expect(result.alreadyInstalled).toBe(false);
    const merged = result.merged as {
      hooks: { Stop: Array<{ hooks: Array<{ type: string; command: string }> }> };
    };
    expect(merged.hooks.Stop[0].hooks).toHaveLength(2);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe("/other/hook.sh");
    expect(merged.hooks.Stop[0].hooks[1].command).toBe("/path/to/hook.sh");
  });

  it("Test 7: preserves existing unrelated keys (mcpServers, SessionStart, permissions)", () => {
    const existing = {
      mcpServers: { someServer: { command: "node" } },
      permissions: { allow: ["Bash"] },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "/start.sh" }] }],
        Stop: [],
      },
    };
    const result = readAndMergeStopHookSettings(existing, "/my/hook.sh");
    const merged = result.merged as Record<string, unknown>;
    expect((merged.mcpServers as Record<string, unknown>).someServer).toBeDefined();
    expect((merged.permissions as { allow: string[] }).allow).toContain("Bash");
    const hooks = merged.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toBeDefined();
  });

  it("Idempotent: returns alreadyInstalled=true when entry already present", () => {
    const existing = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "/my/hook.sh" }],
          },
        ],
      },
    };
    const result = readAndMergeStopHookSettings(existing, "/my/hook.sh");
    expect(result.alreadyInstalled).toBe(true);
    // Merged should be identical to input (no mutation)
    expect(result.merged).toEqual(existing);
  });

  it("Handles Stop array that exists but is empty", () => {
    const existing = {
      hooks: {
        Stop: [],
      },
    };
    const result = readAndMergeStopHookSettings(existing, "/hook.sh");
    expect(result.alreadyInstalled).toBe(false);
    const merged = result.merged as {
      hooks: { Stop: Array<{ hooks: Array<{ type: string; command: string }> }> };
    };
    expect(merged.hooks.Stop[0].hooks[0].command).toBe("/hook.sh");
  });

  it("Handles hooks.Stop[0] missing hooks array", () => {
    const existing = {
      hooks: {
        Stop: [{}],
      },
    };
    const result = readAndMergeStopHookSettings(existing, "/hook.sh");
    expect(result.alreadyInstalled).toBe(false);
    const merged = result.merged as {
      hooks: { Stop: Array<{ hooks: Array<{ type: string; command: string }> }> };
    };
    expect(merged.hooks.Stop[0].hooks[0].command).toBe("/hook.sh");
  });
});

// ---------------------------------------------------------------------------
// Tests 2, 4, 8, 9, 10: installStopHook + uninstallStopHook (async with channel)
// ---------------------------------------------------------------------------

describe("installStopHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildChannel(settingsJson?: string): MockSshChannel {
    const channel = new MockSshChannel();
    // mkdir succeeds
    channel.setResponse("mkdir -p", "");
    // script write succeeds (any heredoc/tmp/mv pattern)
    channel.setResponse("STOPHOOK_EOF", "");
    // test -x → OK
    channel.setResponse("test -x", "OK");
    // settings.json read
    channel.setResponse(
      "cat ~/.claude/settings.json",
      settingsJson ?? "",
    );
    // settings.json write (anything with SETTINGS_EOF)
    channel.setResponse("SETTINGS_EOF", "");
    return channel;
  }

  it("Test 2: installStopHook executes mkdir, script drop, test -x, settings merge in order", async () => {
    const channel = buildChannel();
    const result = await installStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    expect(result.hookInstalled).toBe(true);
    expect(result.settingsUpdated).toBe(true);

    // mkdir was called
    const mkdirCalls = channel.countCallsMatching("mkdir -p");
    expect(mkdirCalls).toBeGreaterThan(0);

    // test -x was called
    const testCalls = channel.countCallsMatching("test -x");
    expect(testCalls).toBeGreaterThan(0);

    // Settings write happened (has SETTINGS_EOF heredoc)
    const settingsWriteCalls = channel.countCallsMatching("SETTINGS_EOF");
    expect(settingsWriteCalls).toBeGreaterThan(0);
  });

  it("Test 4: idempotent — second install skips settings write when entry already present", async () => {
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "~/.claude/hooks/skynet-fleet-status-stop.sh",
              },
            ],
          },
        ],
      },
    });

    const channel = buildChannel(existingSettings);
    const result = await installStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    expect(result.hookInstalled).toBe(true);
    expect(result.settingsUpdated).toBe(false);

    // Settings write must NOT have been called
    const settingsWriteCalls = channel.countCallsMatching("settings.json.tmp");
    expect(settingsWriteCalls).toBe(0);
  });

  it("Test 9: SSH read error on settings.json → throws with structured log", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("mkdir -p", "");
    channel.setResponse("STOPHOOK_EOF", "");
    channel.setResponse("test -x", "OK");
    // settings.json read returns null (SSH error)
    channel.setResponse("cat ~/.claude/settings.json", null);

    await expect(
      installStopHook(channel, {
        remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
      }),
    ).rejects.toThrow();

    // Structured log emitted
    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "fleet_status_hook_install_settings_read_failed",
      }),
    );
  });

  it("Test 10: invalid JSON in settings.json → throws, does NOT overwrite", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("mkdir -p", "");
    channel.setResponse("STOPHOOK_EOF", "");
    channel.setResponse("test -x", "OK");
    // settings.json contains invalid JSON
    channel.setResponse("cat ~/.claude/settings.json", "{invalid json");

    await expect(
      installStopHook(channel, {
        remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
      }),
    ).rejects.toThrow();

    // Must NOT have attempted to write settings
    const settingsWriteCalls = channel.countCallsMatching("settings.json.tmp");
    expect(settingsWriteCalls).toBe(0);

    // Structured log emitted
    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "fleet_status_hook_install_settings_invalid_json",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 11: STOP_HOOK_SCRIPT_CONTENTS byte-matches stop-hook.sh on disk.
// Prevents drift: if someone edits the .sh file but forgets to update the
// inlined constant (or vice versa), this test fails immediately.
// The tree-agnostic path is built from import.meta.url in the test file (not
// in the runtime module) so this works from any identity's worktree.
// ---------------------------------------------------------------------------

describe("STOP_HOOK_SCRIPT_CONTENTS", () => {
  it("Test 11: STOP_HOOK_SCRIPT_CONTENTS byte-matches stop-hook.sh on disk", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const testDir = dirname(fileURLToPath(import.meta.url));
    const diskPath = join(testDir, "stop-hook.sh");
    const diskContents = readFileSync(diskPath, "utf-8");
    expect(STOP_HOOK_SCRIPT_CONTENTS).toBe(diskContents);
  });
});

describe("uninstallStopHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 8: uninstallStopHook removes matching entry and deletes script file", async () => {
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "~/.claude/hooks/skynet-fleet-status-stop.sh",
              },
              {
                type: "command",
                command: "/other/hook.sh",
              },
            ],
          },
        ],
      },
    });

    const channel = new MockSshChannel();
    channel.setResponse("cat ~/.claude/settings.json", existingSettings);
    channel.setResponse("SETTINGS_EOF", "");
    channel.setResponse("rm -f", "");

    await uninstallStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    // rm -f should have been called for the hook script
    const rmCalls = channel.countCallsMatching("rm -f");
    expect(rmCalls).toBeGreaterThan(0);

    // Settings write should have occurred (removed one entry)
    const settingsWriteCalls = channel.countCallsMatching("SETTINGS_EOF");
    expect(settingsWriteCalls).toBeGreaterThan(0);
  });

  it("uninstallStopHook does NOT remove payload dir or payload file", async () => {
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "~/.claude/hooks/skynet-fleet-status-stop.sh",
              },
            ],
          },
        ],
      },
    });

    const channel = new MockSshChannel();
    channel.setResponse("cat ~/.claude/settings.json", existingSettings);
    channel.setResponse("SETTINGS_EOF", "");
    channel.setResponse("rm -f", "");

    await uninstallStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    // Must NOT have removed the payload directory or last-stop-payload.json
    const payloadRmCalls = channel.callLog.filter(
      (c) =>
        c.command.includes("rm") &&
        (c.command.includes("last-stop-payload") ||
          c.command.includes(".claude/fleet-status")),
    );
    expect(payloadRmCalls).toHaveLength(0);
  });
});
