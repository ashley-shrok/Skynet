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
  readAndMergeHookSettings,
  installStopHook,
  uninstallStopHook,
  STOP_HOOK_SCRIPT_CONTENTS,
  ACTIVITY_HOOK_SCRIPT_CONTENTS,
  STOPPED_HOOK_SCRIPT_CONTENTS,
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

  it("Test 1a (Phase 62): exports readAndMergeHookSettings generalized helper", () => {
    expect(typeof readAndMergeHookSettings).toBe("function");
  });

  it("Test 1b (Phase 62): exports ACTIVITY_HOOK_SCRIPT_CONTENTS + STOPPED_HOOK_SCRIPT_CONTENTS constants", () => {
    expect(typeof ACTIVITY_HOOK_SCRIPT_CONTENTS).toBe("string");
    expect(ACTIVITY_HOOK_SCRIPT_CONTENTS.length).toBeGreaterThan(0);
    expect(typeof STOPPED_HOOK_SCRIPT_CONTENTS).toBe("string");
    expect(STOPPED_HOOK_SCRIPT_CONTENTS.length).toBeGreaterThan(0);
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
    // remote $HOME resolution (patch #454) — must come before other responses
    // so callers get an absolute-path expansion of `~/…` defaults.
    channel.setResponse("echo $HOME", "/home/testuser\n");
    // literal `~` cleanup (patch #454) — no-op response OK
    channel.setResponse('rm -rf "/home/testuser/~"', "");
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

  it("Test 4: idempotent — second install skips settings write when ALL SIX entries already present (Phase 62 full-shape)", async () => {
    // Post-Phase-62: settings.json must contain ALL SIX entries (two Stop
    // entries, one each for UserPromptSubmit / PreToolUse / StopFailure /
    // PermissionRequest) for the idempotency short-circuit to fire.
    // Post-patch-#454: all commands are ABSOLUTE (tilde-expanded) paths.
    const stopPath = "/home/testuser/.claude/hooks/skynet-fleet-status-stop.sh";
    const activityPath =
      "/home/testuser/.claude/hooks/skynet-fleet-status-activity.sh";
    const stoppedPath =
      "/home/testuser/.claude/hooks/skynet-fleet-status-stopped.sh";
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: stopPath },
              { type: "command", command: stoppedPath },
            ],
          },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: activityPath }] },
        ],
        PreToolUse: [{ hooks: [{ type: "command", command: activityPath }] }],
        StopFailure: [{ hooks: [{ type: "command", command: stoppedPath }] }],
        PermissionRequest: [
          { hooks: [{ type: "command", command: stoppedPath }] },
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

  // ---------------------------------------------------------------------------
  // Patch #454 additions: tilde-expansion + legacy-tilde-entry migration
  // ---------------------------------------------------------------------------

  it("Test 12: tilde in default paths is expanded to $HOME before shell commands", async () => {
    const channel = buildChannel();
    await installStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    // echo $HOME must have been dispatched
    expect(channel.countCallsMatching("echo $HOME")).toBeGreaterThan(0);

    // Every mkdir/mv/test command must have the absolute path — NO literal `~/`
    // inside double-quoted paths (the bug this patch fixes).
    const mkdirCall = channel.callLog.find((c) => c.command.startsWith("mkdir -p"));
    expect(mkdirCall).toBeDefined();
    expect(mkdirCall!.command).toContain("/home/testuser/.claude/hooks");
    expect(mkdirCall!.command).not.toMatch(/"~\//);

    const testCall = channel.callLog.find((c) => c.command.startsWith("test -x"));
    expect(testCall).toBeDefined();
    expect(testCall!.command).toContain("/home/testuser/.claude/hooks");
    expect(testCall!.command).not.toMatch(/"~\//);
  });

  it("Test 13: legacy tilde-form Stop hook entry gets migrated to absolute-form on next install", async () => {
    // Simulates a box previously "installed" by patch #453 (pre-tilde-fix):
    // settings.json has a Stop hook entry whose command is `~/.claude/hooks/...`
    // (relative tilde). The new install must (a) NOT return alreadyInstalled=true
    // (that would leave the broken tilde entry stranded), (b) strip the tilde
    // entry and (c) add the absolute-form entry, resulting in exactly ONE
    // Stop hook entry for our hook in the merged settings.
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
    expect(result.settingsUpdated).toBe(true); // legacy stripped, absolute merged in

    // Find the SETTINGS_EOF write payload and inspect the JSON that was written.
    const settingsWrite = channel.callLog.find((c) => c.command.includes("SETTINGS_EOF"));
    expect(settingsWrite).toBeDefined();

    // Extract the JSON body between the SETTINGS_EOF markers.
    const cmdBody = settingsWrite!.command;
    const jsonMatch = cmdBody.match(/<<'SETTINGS_EOF'\n([\s\S]*?)\nSETTINGS_EOF/);
    expect(jsonMatch).not.toBeNull();
    const writtenSettings = JSON.parse(jsonMatch![1]) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    // Exactly one hook entry for our path, in ABSOLUTE form — no tilde entry lingers.
    const allCommands = writtenSettings.hooks.Stop.flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    const ourEntries = allCommands.filter((c) =>
      c.endsWith("/skynet-fleet-status-stop.sh"),
    );
    expect(ourEntries).toHaveLength(1);
    expect(ourEntries[0]).toBe("/home/testuser/.claude/hooks/skynet-fleet-status-stop.sh");
    // The legacy tilde-form entry must be gone.
    expect(allCommands).not.toContain("~/.claude/hooks/skynet-fleet-status-stop.sh");
  });

  it("Test 14: literal `~` subdirectory cleanup is dispatched after $HOME resolution", async () => {
    const channel = buildChannel();
    await installStopHook(channel, {
      remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
    });

    // The `rm -rf "$HOME/~"` migration cleanup must have been dispatched to
    // reap the literal `~` subdirectory left by patch #453 pre-tilde-fix.
    const rmCall = channel.callLog.find(
      (c) => c.command === 'rm -rf "/home/testuser/~"',
    );
    expect(rmCall).toBeDefined();
  });

  it("Test 15: echo $HOME returning empty/tilde/non-absolute throws with structured log", async () => {
    const channel = new MockSshChannel();
    // $HOME resolution comes back empty (SSH exec succeeded but returned nothing)
    channel.setResponse("echo $HOME", "");

    await expect(
      installStopHook(channel, {
        remoteHookPath: "~/.claude/hooks/skynet-fleet-status-stop.sh",
      }),
    ).rejects.toThrow(/fleet_status_hook_install_home_resolve_failed/);

    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "fleet_status_hook_install_home_resolve_failed",
      }),
    );

    // Must NOT have proceeded to mkdir / script write
    expect(channel.countCallsMatching("mkdir -p")).toBe(0);
    expect(channel.countCallsMatching("STOPHOOK_EOF")).toBe(0);
  });

  it("Test 9: SSH read error on settings.json → throws with structured log", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("echo $HOME", "/home/testuser\n");
    channel.setResponse('rm -rf "/home/testuser/~"', "");
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
    channel.setResponse("echo $HOME", "/home/testuser\n");
    channel.setResponse('rm -rf "/home/testuser/~"', "");
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

  it("Test 11a (Phase 62): ACTIVITY_HOOK_SCRIPT_CONTENTS byte-matches activity-hook.sh on disk", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const testDir = dirname(fileURLToPath(import.meta.url));
    const diskPath = join(testDir, "activity-hook.sh");
    const diskContents = readFileSync(diskPath, "utf-8");
    expect(ACTIVITY_HOOK_SCRIPT_CONTENTS).toBe(diskContents);
  });

  it("Test 11b (Phase 62): STOPPED_HOOK_SCRIPT_CONTENTS byte-matches stopped-hook.sh on disk", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const testDir = dirname(fileURLToPath(import.meta.url));
    const diskPath = join(testDir, "stopped-hook.sh");
    const diskContents = readFileSync(diskPath, "utf-8");
    expect(STOPPED_HOOK_SCRIPT_CONTENTS).toBe(diskContents);
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

// ---------------------------------------------------------------------------
// Phase 62 tests: three-script drop, five-key merge, idempotency across all
// five keys, partial-upgrade, third-party-preservation, uninstall-all-three,
// per-script verify-failure identification.
// ---------------------------------------------------------------------------

/**
 * Extract the last SETTINGS_EOF heredoc body from a MockSshChannel's callLog
 * and JSON-parse it. Used by the Phase-62 tests that assert the exact shape
 * of the final settings.json write.
 *
 * Returns `null` if no SETTINGS_EOF write was performed (idempotency path).
 */
function extractLastSettingsWrite(
  callLog: Array<{ command: string }>,
): Record<string, unknown> | null {
  const settingsWrites = callLog.filter((c) =>
    c.command.includes("SETTINGS_EOF"),
  );
  if (settingsWrites.length === 0) return null;
  const last = settingsWrites[settingsWrites.length - 1];
  const match = last.command.match(/<<'SETTINGS_EOF'\n([\s\S]*?)\nSETTINGS_EOF/);
  if (!match) return null;
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/**
 * Produce a Phase-62-shaped settings.json string with ALL SIX hook entries
 * present at absolute paths (post-tilde-expansion). Simulates the state of
 * a fully-installed managed box for idempotency + uninstall tests.
 */
function makePhase62Settings(
  stopHookPath: string,
  activityHookPath: string,
  stoppedHookPath: string,
): string {
  return JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            { type: "command", command: stopHookPath },
            { type: "command", command: stoppedHookPath },
          ],
        },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: activityHookPath }] },
      ],
      PreToolUse: [
        { hooks: [{ type: "command", command: activityHookPath }] },
      ],
      StopFailure: [
        { hooks: [{ type: "command", command: stoppedHookPath }] },
      ],
      PermissionRequest: [
        { hooks: [{ type: "command", command: stoppedHookPath }] },
      ],
    },
  });
}

// The absolute (tilde-expanded) forms of the three default script paths as
// resolved by the test $HOME "/home/testuser". Shared across the Phase 62
// tests.
const P62_STOP_PATH =
  "/home/testuser/.claude/hooks/skynet-fleet-status-stop.sh";
const P62_ACTIVITY_PATH =
  "/home/testuser/.claude/hooks/skynet-fleet-status-activity.sh";
const P62_STOPPED_PATH =
  "/home/testuser/.claude/hooks/skynet-fleet-status-stopped.sh";

describe("installStopHook (Phase 62 extended shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildPhase62Channel(settingsJson?: string): MockSshChannel {
    const channel = new MockSshChannel();
    channel.setResponse("echo $HOME", "/home/testuser\n");
    channel.setResponse('rm -rf "/home/testuser/~"', "");
    channel.setResponse("mkdir -p", "");
    channel.setResponse("STOPHOOK_EOF", "");
    channel.setResponse("ACTIVITY_HOOK_EOF", "");
    channel.setResponse("STOPPED_HOOK_EOF", "");
    // test -x → OK (any script path)
    channel.setResponse("test -x", "OK");
    channel.setResponse(
      "cat ~/.claude/settings.json",
      settingsJson ?? "",
    );
    channel.setResponse("SETTINGS_EOF", "");
    return channel;
  }

  it("Test P62-1: installStopHook drops all THREE scripts, each via atomic .tmp + mv + chmod +x", async () => {
    const channel = buildPhase62Channel();
    await installStopHook(channel, {});

    // Each script drop uses its distinct heredoc sentinel. Assert each sentinel
    // appears in the callLog exactly once (single sequential drop per script).
    const stopHookDrops = channel.callLog.filter((c) =>
      c.command.includes("STOPHOOK_EOF"),
    );
    const activityHookDrops = channel.callLog.filter((c) =>
      c.command.includes("ACTIVITY_HOOK_EOF"),
    );
    const stoppedHookDrops = channel.callLog.filter((c) =>
      c.command.includes("STOPPED_HOOK_EOF"),
    );
    expect(stopHookDrops).toHaveLength(1);
    expect(activityHookDrops).toHaveLength(1);
    expect(stoppedHookDrops).toHaveLength(1);

    // Each drop command must include the .tmp + mv + chmod +x sequence.
    for (const drop of [
      stopHookDrops[0],
      activityHookDrops[0],
      stoppedHookDrops[0],
    ]) {
      expect(drop.command).toMatch(/cat > "\S+\.tmp" <<'/);
      expect(drop.command).toMatch(/mv "\S+\.tmp" "\S+" && chmod \+x /);
    }

    // Each script path must appear in the corresponding drop.
    expect(stopHookDrops[0].command).toContain(P62_STOP_PATH);
    expect(activityHookDrops[0].command).toContain(P62_ACTIVITY_PATH);
    expect(stoppedHookDrops[0].command).toContain(P62_STOPPED_PATH);

    // test -x must have been called for all three scripts.
    const testXCalls = channel.callLog.filter((c) =>
      c.command.startsWith("test -x"),
    );
    expect(testXCalls.length).toBeGreaterThanOrEqual(3);
    const testXPaths = testXCalls.map((c) => c.command);
    expect(testXPaths.some((cmd) => cmd.includes(P62_STOP_PATH))).toBe(true);
    expect(testXPaths.some((cmd) => cmd.includes(P62_ACTIVITY_PATH))).toBe(true);
    expect(testXPaths.some((cmd) => cmd.includes(P62_STOPPED_PATH))).toBe(true);
  });

  it("Test P62-2: installStopHook merges all FIVE hook keys with correct entry counts (empty settings.json start)", async () => {
    const channel = buildPhase62Channel();
    const result = await installStopHook(channel, {});
    expect(result.hookInstalled).toBe(true);
    expect(result.settingsUpdated).toBe(true);

    const written = extractLastSettingsWrite(channel.callLog);
    expect(written).not.toBeNull();
    const hooks = written!.hooks as Record<string, unknown>;

    // Stop should have TWO entries (stop-hook + stopped-hook — Stop fires BOTH).
    const stop = hooks.Stop as Array<{ hooks: Array<{ command: string }> }>;
    expect(stop).toHaveLength(1);
    expect(stop[0].hooks.map((h) => h.command)).toEqual([
      P62_STOP_PATH,
      P62_STOPPED_PATH,
    ]);

    // UserPromptSubmit → activity-hook (ONE entry).
    const ups = hooks.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
    expect(ups).toHaveLength(1);
    expect(ups[0].hooks.map((h) => h.command)).toEqual([P62_ACTIVITY_PATH]);

    // PreToolUse → activity-hook (ONE entry).
    const ptu = hooks.PreToolUse as Array<{ hooks: Array<{ command: string }> }>;
    expect(ptu).toHaveLength(1);
    expect(ptu[0].hooks.map((h) => h.command)).toEqual([P62_ACTIVITY_PATH]);

    // StopFailure → stopped-hook (ONE entry).
    const sf = hooks.StopFailure as Array<{ hooks: Array<{ command: string }> }>;
    expect(sf).toHaveLength(1);
    expect(sf[0].hooks.map((h) => h.command)).toEqual([P62_STOPPED_PATH]);

    // PermissionRequest → stopped-hook (ONE entry).
    const pr = hooks.PermissionRequest as Array<{ hooks: Array<{ command: string }> }>;
    expect(pr).toHaveLength(1);
    expect(pr[0].hooks.map((h) => h.command)).toEqual([P62_STOPPED_PATH]);
  });

  it("Test P62-3: idempotency across all five keys — second install writes zero settings.json changes", async () => {
    // First install into empty settings.
    const channel = buildPhase62Channel();
    const first = await installStopHook(channel, {});
    expect(first.settingsUpdated).toBe(true);
    const writtenAfterFirst = extractLastSettingsWrite(channel.callLog);
    expect(writtenAfterFirst).not.toBeNull();

    // Second install: seed the channel with the exact JSON the first install
    // produced. The idempotency short-circuit must fire.
    const channel2 = buildPhase62Channel(JSON.stringify(writtenAfterFirst));
    const second = await installStopHook(channel2, {});
    expect(second.hookInstalled).toBe(true);
    expect(second.settingsUpdated).toBe(false);

    // ZERO SETTINGS_EOF writes on the second install.
    const secondWrites = channel2.callLog.filter((c) =>
      c.command.includes("SETTINGS_EOF"),
    );
    expect(secondWrites).toHaveLength(0);

    // Zero settings.json.tmp mv calls too — the whole tmp+mv pipeline was
    // skipped, not just the heredoc.
    expect(channel2.countCallsMatching("settings.json.tmp")).toBe(0);
  });

  it("Test P62-4: partial upgrade — pre-existing legacy stop-hook entry only; installer adds the other FIVE (Stop appended with stopped-hook, plus four new event keys populated) without duplicating the existing Stop entry", async () => {
    // Simulate a box previously installed under Phase 59 (stop-hook only, at
    // its ABSOLUTE path — post-tilde-fix). The Phase-62 installer must add
    // exactly five new entries.
    const legacyPhase59Settings = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: P62_STOP_PATH }],
          },
        ],
      },
    });
    const channel = buildPhase62Channel(legacyPhase59Settings);
    const result = await installStopHook(channel, {});
    expect(result.settingsUpdated).toBe(true);

    const written = extractLastSettingsWrite(channel.callLog);
    expect(written).not.toBeNull();
    const hooks = written!.hooks as Record<string, unknown>;

    // Stop must have EXACTLY two entries: the pre-existing stop-hook (position
    // preserved) + the newly-appended stopped-hook. No duplicate stop-hook.
    const stop = hooks.Stop as Array<{ hooks: Array<{ command: string }> }>;
    expect(stop[0].hooks).toHaveLength(2);
    expect(stop[0].hooks[0].command).toBe(P62_STOP_PATH);
    expect(stop[0].hooks[1].command).toBe(P62_STOPPED_PATH);

    // The four new event keys must now be populated.
    expect(
      (hooks.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>)[0]
        .hooks[0].command,
    ).toBe(P62_ACTIVITY_PATH);
    expect(
      (hooks.PreToolUse as Array<{ hooks: Array<{ command: string }> }>)[0]
        .hooks[0].command,
    ).toBe(P62_ACTIVITY_PATH);
    expect(
      (hooks.StopFailure as Array<{ hooks: Array<{ command: string }> }>)[0]
        .hooks[0].command,
    ).toBe(P62_STOPPED_PATH);
    expect(
      (hooks.PermissionRequest as Array<{ hooks: Array<{ command: string }> }>)[0]
        .hooks[0].command,
    ).toBe(P62_STOPPED_PATH);
  });

  it("Test P62-5 (Concern #6 regression proof): third-party entries in ALL FIVE hook keys are preserved intact + fleet-status entries added without duplication + second install idempotent", async () => {
    // Seed settings.json with pre-existing third-party (non-fleet-status)
    // entries in EACH of the four new event keys AND alongside the existing
    // Stop entry. The shallow-copy discipline in readAndMergeHookSettings
    // must preserve every third-party entry across every key.
    const withThirdParty = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "/opt/user-stop-hook.sh" }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "/opt/user-prompt-hook.sh" }] },
        ],
        PreToolUse: [
          { hooks: [{ type: "command", command: "/opt/user-tool-hook.sh" }] },
        ],
        StopFailure: [
          { hooks: [{ type: "command", command: "/opt/user-fail-hook.sh" }] },
        ],
        PermissionRequest: [
          { hooks: [{ type: "command", command: "/opt/user-perm-hook.sh" }] },
        ],
      },
    });

    const channel = buildPhase62Channel(withThirdParty);
    const first = await installStopHook(channel, {});
    expect(first.settingsUpdated).toBe(true);

    const written = extractLastSettingsWrite(channel.callLog);
    expect(written).not.toBeNull();
    const hooks = written!.hooks as Record<string, unknown>;

    // Collect ALL command strings across all five hook keys for the
    // preservation + no-duplication assertions.
    const collectCommands = (event: string): string[] => {
      const arr = hooks[event] as Array<{ hooks: Array<{ command: string }> }>;
      return arr.flatMap((g) => g.hooks.map((h) => h.command));
    };
    const stopCmds = collectCommands("Stop");
    const upsCmds = collectCommands("UserPromptSubmit");
    const ptuCmds = collectCommands("PreToolUse");
    const sfCmds = collectCommands("StopFailure");
    const prCmds = collectCommands("PermissionRequest");

    // (a) All five third-party entries preserved intact.
    expect(stopCmds).toContain("/opt/user-stop-hook.sh");
    expect(upsCmds).toContain("/opt/user-prompt-hook.sh");
    expect(ptuCmds).toContain("/opt/user-tool-hook.sh");
    expect(sfCmds).toContain("/opt/user-fail-hook.sh");
    expect(prCmds).toContain("/opt/user-perm-hook.sh");

    // (b) Our fleet-status entries added — Stop has BOTH stop + stopped;
    // UserPromptSubmit + PreToolUse have activity; StopFailure +
    // PermissionRequest have stopped.
    expect(stopCmds).toContain(P62_STOP_PATH);
    expect(stopCmds).toContain(P62_STOPPED_PATH);
    expect(upsCmds).toContain(P62_ACTIVITY_PATH);
    expect(ptuCmds).toContain(P62_ACTIVITY_PATH);
    expect(sfCmds).toContain(P62_STOPPED_PATH);
    expect(prCmds).toContain(P62_STOPPED_PATH);

    // (c) Every third-party command appears EXACTLY ONCE (no accidental
    // duplication from the merge helper's shallow copies).
    const thirdPartyCmds = [
      "/opt/user-stop-hook.sh",
      "/opt/user-prompt-hook.sh",
      "/opt/user-tool-hook.sh",
      "/opt/user-fail-hook.sh",
      "/opt/user-perm-hook.sh",
    ];
    const allCmds = [
      ...stopCmds,
      ...upsCmds,
      ...ptuCmds,
      ...sfCmds,
      ...prCmds,
    ];
    for (const tp of thirdPartyCmds) {
      expect(allCmds.filter((c) => c === tp)).toHaveLength(1);
    }

    // (d) Second install against the merged settings is idempotent — zero
    // writes, no third-party mutation, no fleet-status duplication.
    const channel2 = buildPhase62Channel(JSON.stringify(written));
    const second = await installStopHook(channel2, {});
    expect(second.settingsUpdated).toBe(false);
    expect(channel2.countCallsMatching("SETTINGS_EOF")).toBe(0);
    expect(channel2.countCallsMatching("settings.json.tmp")).toBe(0);
  });

  it("Test P62-6: uninstallStopHook removes ALL FIVE hook entries + rm -f's ALL THREE script paths; payload dir + per-session marker dir preserved", async () => {
    // Seed a Phase-62-shaped settings.json (with a third-party entry alongside
    // to verify uninstall does not clobber it).
    const phase62WithThirdParty = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: P62_STOP_PATH },
              { type: "command", command: P62_STOPPED_PATH },
              { type: "command", command: "/opt/user-stop-hook.sh" },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: P62_ACTIVITY_PATH },
              { type: "command", command: "/opt/user-prompt-hook.sh" },
            ],
          },
        ],
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: P62_ACTIVITY_PATH },
              { type: "command", command: "/opt/user-tool-hook.sh" },
            ],
          },
        ],
        StopFailure: [
          {
            hooks: [
              { type: "command", command: P62_STOPPED_PATH },
              { type: "command", command: "/opt/user-fail-hook.sh" },
            ],
          },
        ],
        PermissionRequest: [
          {
            hooks: [
              { type: "command", command: P62_STOPPED_PATH },
              { type: "command", command: "/opt/user-perm-hook.sh" },
            ],
          },
        ],
      },
    });

    const channel = new MockSshChannel();
    channel.setResponse("cat ~/.claude/settings.json", phase62WithThirdParty);
    channel.setResponse("SETTINGS_EOF", "");
    channel.setResponse("rm -f", "");

    await uninstallStopHook(channel, {
      remoteHookPath: P62_STOP_PATH,
      remoteActivityHookPath: P62_ACTIVITY_PATH,
      remoteStoppedHookPath: P62_STOPPED_PATH,
    });

    // Extract the written settings and verify:
    // - Every fleet-status command is GONE from every event key.
    // - Every third-party command is PRESERVED intact.
    const written = extractLastSettingsWrite(channel.callLog);
    expect(written).not.toBeNull();
    const hooks = written!.hooks as Record<string, unknown>;
    const collectCommands = (event: string): string[] => {
      const arr = hooks[event] as Array<{ hooks: Array<{ command: string }> }>;
      return arr.flatMap((g) => g.hooks.map((h) => h.command));
    };
    const fleetPaths = [P62_STOP_PATH, P62_ACTIVITY_PATH, P62_STOPPED_PATH];
    for (const event of [
      "Stop",
      "UserPromptSubmit",
      "PreToolUse",
      "StopFailure",
      "PermissionRequest",
    ]) {
      const cmds = collectCommands(event);
      for (const p of fleetPaths) {
        expect(cmds).not.toContain(p);
      }
    }
    expect(collectCommands("Stop")).toContain("/opt/user-stop-hook.sh");
    expect(collectCommands("UserPromptSubmit")).toContain(
      "/opt/user-prompt-hook.sh",
    );
    expect(collectCommands("PreToolUse")).toContain("/opt/user-tool-hook.sh");
    expect(collectCommands("StopFailure")).toContain("/opt/user-fail-hook.sh");
    expect(collectCommands("PermissionRequest")).toContain(
      "/opt/user-perm-hook.sh",
    );

    // rm -f must have targeted ALL THREE script paths.
    const rmCall = channel.callLog.find(
      (c) => c.command.startsWith("rm -f") && c.command.includes(P62_STOP_PATH),
    );
    expect(rmCall).toBeDefined();
    expect(rmCall!.command).toContain(P62_STOP_PATH);
    expect(rmCall!.command).toContain(P62_ACTIVITY_PATH);
    expect(rmCall!.command).toContain(P62_STOPPED_PATH);

    // Payload dir + per-session marker dir NOT deleted (post-mortem preservation).
    const preservedRmCalls = channel.callLog.filter(
      (c) =>
        c.command.startsWith("rm") &&
        (c.command.includes("last-stop-payload") ||
          c.command.includes("/.claude/fleet-status/hooks") ||
          c.command.match(/rm -rf .*\.claude\/fleet-status\b/)),
    );
    expect(preservedRmCalls).toHaveLength(0);
  });

  it("Test P62-7: activity-hook verify failure throws with a script-specific error message identifying WHICH script failed", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("echo $HOME", "/home/testuser\n");
    channel.setResponse('rm -rf "/home/testuser/~"', "");
    channel.setResponse("mkdir -p", "");
    channel.setResponse("STOPHOOK_EOF", "");
    channel.setResponse("ACTIVITY_HOOK_EOF", "");
    channel.setResponse("STOPPED_HOOK_EOF", "");
    // Only the activity-hook test -x fails; stop-hook test -x succeeds.
    channel.setResponse(`test -x "${P62_STOP_PATH}"`, "OK");
    channel.setResponse(`test -x "${P62_ACTIVITY_PATH}"`, "NOT-OK");
    channel.setResponse(`test -x "${P62_STOPPED_PATH}"`, "OK");

    await expect(installStopHook(channel, {})).rejects.toThrow(
      /activity-hook/,
    );

    // Structured log must identify the failing script.
    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "fleet_status_hook_install_verify_failed",
        scriptLabel: "activity-hook",
      }),
    );

    // Must NOT have proceeded to the settings.json read/write.
    expect(channel.countCallsMatching("cat ~/.claude/settings.json")).toBe(0);
    expect(channel.countCallsMatching("SETTINGS_EOF")).toBe(0);
  });

  it("Test P62-8: stopped-hook verify failure throws with a script-specific error message identifying WHICH script failed", async () => {
    // Same as P62-7 but stopped-hook is the failing script — proves the
    // per-script identification is not hard-coded to activity-hook.
    const channel = new MockSshChannel();
    channel.setResponse("echo $HOME", "/home/testuser\n");
    channel.setResponse('rm -rf "/home/testuser/~"', "");
    channel.setResponse("mkdir -p", "");
    channel.setResponse("STOPHOOK_EOF", "");
    channel.setResponse("ACTIVITY_HOOK_EOF", "");
    channel.setResponse("STOPPED_HOOK_EOF", "");
    channel.setResponse(`test -x "${P62_STOP_PATH}"`, "OK");
    channel.setResponse(`test -x "${P62_ACTIVITY_PATH}"`, "OK");
    channel.setResponse(`test -x "${P62_STOPPED_PATH}"`, "NOT-OK");

    await expect(installStopHook(channel, {})).rejects.toThrow(
      /stopped-hook/,
    );

    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "fleet_status_hook_install_verify_failed",
        scriptLabel: "stopped-hook",
      }),
    );
  });

  it("Test P62-9: install completion log records forensic fields for all three remote script paths", async () => {
    const channel = buildPhase62Channel();
    await installStopHook(channel, {});

    expect(systemLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("hook set installed"),
      expect.objectContaining({
        operation: "fleet_status_hook_install_complete",
        remoteHookPath: P62_STOP_PATH,
        remoteActivityHookPath: P62_ACTIVITY_PATH,
        remoteStoppedHookPath: P62_STOPPED_PATH,
      }),
    );
  });
});
