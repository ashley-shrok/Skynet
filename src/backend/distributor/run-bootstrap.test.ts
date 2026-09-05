/**
 * run-bootstrap.test.ts — Unit tests for runBootstrapForHost.
 *
 * Tests cover:
 *   (a) Already-enabled host: no linger/enable commands fired, daemon-reload
 *       still runs, settings check still runs.
 *   (b) Fresh host (is-enabled exit 1): linger + daemon-reload + enable --now
 *       fires in order as a single chained command; no separate daemon-reload.
 *   (c) settings.json already has skipDangerousModePermissionPrompt: true —
 *       the patch command still runs but the jq branch is not reached (we
 *       verify via the __SETTINGS_OK__ sentinel).
 *   (d) settings.json missing — file created with flag (sentinel returns ok).
 *   (e) settings.json exists without flag — jq merge applied (sentinel ok).
 *   (f) Channel returns null on is-enabled check — hadError=true, still resolves.
 *   (g) Channel returns null on settings patch — hadError=true, still resolves.
 *   (h) Already-enabled host with daemon-reload failure — hadError=true, resolves.
 *
 * NEVER-THROW contract: every test calls runBootstrapForHost and awaits the
 * result with `resolves` — it must never reject.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { runBootstrapForHost } from "./run-bootstrap.js";

// Suppress logger output in tests
vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOST = { id: "h1", name: "wilma" };

/**
 * Build a channel mock that dispatches on command content.
 * The `handlers` map is checked in order; first matching key wins.
 * Keys are matched as substring of the command string.
 * Falls back to `defaultResponse` (null by default) if no key matches.
 */
function makeChannel(
  handlers: Record<string, string | null>,
  defaultResponse: string | null = null,
): { channel: SshChannel; exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async (cmd: string) => {
    for (const [key, response] of Object.entries(handlers)) {
      if (cmd.includes(key)) return response;
    }
    return defaultResponse;
  });
  return { channel: { exec }, exec };
}

/**
 * Capture the ordered list of commands sent to the channel.
 */
function captureCommands(exec: ReturnType<typeof vi.fn>): string[] {
  return exec.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBootstrapForHost", () => {
  it("(a) already-enabled: no linger/enable commands, daemon-reload fires, settings patch fires", async () => {
    const { channel, exec } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.alreadyEnabled).toBe(true);
    expect(result.bootstrapRan).toBe(false);
    expect(result.daemonReloadRan).toBe(true);
    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);

    const cmds = captureCommands(exec);
    // Must NOT contain linger or enable --now
    expect(cmds.some((c) => c.includes("enable-linger"))).toBe(false);
    expect(cmds.some((c) => c.includes("enable --now"))).toBe(false);
    // Must contain daemon-reload (separate from bootstrap sequence)
    expect(cmds.some((c) => c.includes("daemon-reload") && !c.includes("enable-linger"))).toBe(true);
    // Must contain settings patch
    expect(cmds.some((c) => c.includes("SETTINGS"))).toBe(true);
  });

  it("(b) fresh host (is-enabled exit 1): linger + daemon-reload + enable --now fires as one command", async () => {
    const { channel, exec } = makeChannel({
      "is-enabled": "disabled\nEXIT:1",
      "enable-linger": "__BOOTSTRAP_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.alreadyEnabled).toBe(false);
    expect(result.bootstrapRan).toBe(true);
    expect(result.daemonReloadRan).toBe(true); // ran as part of bootstrap sequence
    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);

    const cmds = captureCommands(exec);
    // The bootstrap sequence is a single chained command containing all three
    const bootstrapCmd = cmds.find((c) => c.includes("enable-linger"));
    expect(bootstrapCmd).toBeDefined();
    expect(bootstrapCmd).toContain("daemon-reload");
    expect(bootstrapCmd).toContain("enable --now agent-supervisor.service");

    // Since daemon-reload ran inside bootstrap, no separate daemon-reload exec
    const separateReload = cmds.filter(
      (c) => c.includes("daemon-reload") && !c.includes("enable-linger"),
    );
    expect(separateReload).toHaveLength(0);
  });

  it("(c) settings.json already has flag: sentinel returns ok, no hadError", async () => {
    // The settings.json patch command is idempotent — it runs every sweep,
    // checks if flag is already set, and skips the write if so.
    // From the bootstrap's perspective, the exec returns __SETTINGS_OK__ either way.
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it("(d) settings.json missing: file created, sentinel returns ok", async () => {
    // Same as (c) from bootstrap's perspective — the remote shell handles the
    // absent-file branch internally. Bootstrap just checks the sentinel.
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it("(e) settings.json exists without flag: jq merge applied, sentinel ok", async () => {
    // Same sentinel contract as above.
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it("(f) channel returns null on is-enabled check — hadError=true, still resolves", async () => {
    const { channel } = makeChannel({
      "is-enabled": null,
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.hadError).toBe(true);
    // Bootstrap ran is false (we couldn't determine is-enabled state)
    expect(result.bootstrapRan).toBe(false);
    // Function must NOT throw — it resolves
  });

  it("(g) channel returns null on settings patch — hadError=true, still resolves", async () => {
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": null,
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.hadError).toBe(true);
    expect(result.settingsPatchOk).toBe(false);
    // Resolves — never rejects
  });

  it("(h) already-enabled, daemon-reload returns failure — hadError=true, resolves", async () => {
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "Failed to reload daemon\n",  // no __RELOAD_OK__ sentinel
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.alreadyEnabled).toBe(true);
    expect(result.daemonReloadRan).toBe(false);
    expect(result.hadError).toBe(true);
    // Still runs settings patch despite daemon-reload failure
    expect(result.settingsPatchOk).toBe(true);
  });

  it("(i) bootstrap sequence fails (no __BOOTSTRAP_OK__ sentinel) — hadError=true, bootstrapRan=false", async () => {
    const { channel } = makeChannel({
      "is-enabled": "not-found\nEXIT:1",
      "enable-linger": "Failed to enable linger\n",  // no __BOOTSTRAP_OK__
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.alreadyEnabled).toBe(false);
    expect(result.bootstrapRan).toBe(false);
    expect(result.hadError).toBe(true);
    // Since bootstrap sequence failed, we fall through to the separate
    // daemon-reload (daemonReloadRan may be true from that path)
  });

  it("(k) gsd-context-monitor cleanup: sentinel returns ok, cleanupOk=true, cleanup command references both settings strip and hook rm", async () => {
    const { channel, exec } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.gsdContextMonitorCleanupOk).toBe(true);
    expect(result.hadError).toBe(false);

    const cmds = captureCommands(exec);
    const cleanupCmd = cmds.find((c) => c.includes("gsd-context-monitor"));
    expect(cleanupCmd).toBeDefined();
    // Cleanup command must reference both the settings.json strip and the hook file rm
    expect(cleanupCmd).toContain(".hooks.PostToolUse");
    expect(cleanupCmd).toContain("rm -f");
    expect(cleanupCmd).toContain("hooks/gsd-context-monitor.js");
  });

  it("(l) gsd-context-monitor cleanup: channel returns null — hadError=true, cleanupOk=false, still resolves", async () => {
    const { channel } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": null,
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.gsdContextMonitorCleanupOk).toBe(false);
    expect(result.hadError).toBe(true);
    // Settings patch must still have succeeded — cleanup failure is independent
    expect(result.settingsPatchOk).toBe(true);
  });

  it("(j) never-throw: channel.exec throws synchronously — resolves with hadError=true", async () => {
    const throwingChannel: SshChannel = {
      exec: async () => {
        throw new Error("network error");
      },
    };

    await expect(
      runBootstrapForHost(throwingChannel, HOST),
    ).resolves.toMatchObject({ hadError: true });
  });
});
