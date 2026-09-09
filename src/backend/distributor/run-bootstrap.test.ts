/**
 * run-bootstrap.test.ts — Unit tests for runBootstrapForHost.
 *
 * Tests cover:
 *   (a) Already-enabled host: no linger/enable commands fired, daemon-reload
 *       still runs, settings check still runs.
 *   (b) Fresh host (is-enabled exit 1): linger + daemon-reload + enable --now
 *       fires in order as a single chained command; no separate daemon-reload.
 *   (c) settings.json already has all 5 fleet-required keys correct —
 *       the patch command still runs but the jq branch is not reached (we
 *       verify via the __SETTINGS_OK__ sentinel).
 *   (d) settings.json missing — file created with all 5 keys (sentinel ok).
 *   (e) settings.json exists without some keys — jq merge applied (sentinel ok).
 *   (e2) command shape: settings patch command references all 5 fleet-required
 *       keys AND the idempotency check covers all 5 (regression guard against
 *       accidental key drop).
 *   (f) Channel returns null on is-enabled check — hadError=true, still resolves.
 *   (g) Channel returns null on settings patch — hadError=true, still resolves.
 *   (h) Already-enabled host with daemon-reload failure — hadError=true, resolves.
 *
 * Phase 75 D-03 additions (step 4 — skynet-parent write):
 *   (sp-1) BootstrapResult has skynetParentOk: boolean field.
 *   (sp-2) SKYNET_PUBLIC_URL unset → step 4 skipped, no exec, no hadError.
 *   (sp-3) SKYNET_PUBLIC_URL malformed (non-https) → step 4 skipped, no hadError.
 *   (sp-4) SKYNET_PUBLIC_URL https → shell command shape check (mkdir, NEW=, diff, printf, sentinel).
 *   (sp-5) Sentinel present → skynetParentOk=true, hadError not set.
 *   (sp-6) Channel returns null → hadError=true, skynetParentOk=false, logBootstrapFailed(skynet-parent-write, "channel returned null").
 *   (sp-7) Missing sentinel → hadError=true, logBootstrapFailed with trimmed output.
 *   (sp-8) Channel throws → hadError=true, function still resolves (NEVER-THROW).
 *   (sp-9) URL containing single-quote is shell-escaped safely ('\'' pattern).
 *   (sp-10) logBootstrapResult receives payload containing skynetParentOk field.
 *   (sp-11) Existing steps 1-3 outcomes unchanged (regression gate — implicit in
 *           all pre-existing tests above; explicit assertion on skynetParentOk field
 *           presence via sp-1).
 *
 * Step 5 additions (skynet-hostname write):
 *   (hn-1) BootstrapResult has skynetHostnameOk: boolean field.
 *   (hn-2) logBootstrapResult payload includes skynetHostnameOk field (mirror of sp-10).
 *   (hn-3) Sentinel present → skynetHostnameOk=true, hadError=false (happy path).
 *   (hn-4) Channel returns null → hadError=true, skynetHostnameOk=false,
 *          logBootstrapFailed(skynet-hostname-write, "channel returned null").
 *   (hn-5) Missing sentinel → hadError=true, logBootstrapFailed with trimmed output.
 *   (hn-6) Channel throws → hadError=true, function still resolves (NEVER-THROW).
 *   (hn-7) host.name containing a single-quote is shell-escaped safely with the
 *          '\'' pattern.
 *   (hn-8) Content-diff no-op path (file already matches) — indistinguishable from
 *          happy path at the channel-mock level (both emit the sentinel); assert
 *          skynetHostnameOk=true with no error.
 *
 * NEVER-THROW contract: every test calls runBootstrapForHost and awaits the
 * result with `resolves` — it must never reject.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { runBootstrapForHost } from "./run-bootstrap.js";
import { systemLogger } from "../utils/logger.js";

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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it("(e2) settings command references all 5 fleet-required keys in both merge and check", async () => {
    // Regression guard: the settings.json patch must enforce ALL 5 keys, not
    // regress to a subset. Both the MERGE (what gets written) and the CHECK
    // (the idempotency short-circuit predicate) must name each key.
    const { channel, exec } = makeChannel({
      "is-enabled": "enabled\nEXIT:0",
      "daemon-reload": "__RELOAD_OK__",
      "SETTINGS": "__SETTINGS_OK__",
      "gsd-context-monitor": "__CLEANUP_OK__",
    });

    await runBootstrapForHost(channel, HOST);

    const cmds = captureCommands(exec);
    const settingsCmd = cmds.find(
      (c) => c.includes("SETTINGS=") && c.includes("MERGE=") && c.includes("CHECK="),
    );
    expect(settingsCmd).toBeDefined();
    if (!settingsCmd) return;

    // All 5 keys must appear in the MERGE side (what gets written to disk).
    expect(settingsCmd).toContain(`"AskUserQuestion"`);
    expect(settingsCmd).toContain(`.askUserQuestionTimeout = "never"`);
    expect(settingsCmd).toContain(`.DISABLE_AUTOUPDATER = "1"`);
    expect(settingsCmd).toContain(`.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"`);
    expect(settingsCmd).toContain(`.skipDangerousModePermissionPrompt = true`);

    // All 5 keys must also appear in the CHECK side (idempotency predicate).
    // Without this, a partial-state settings.json would keep getting rewritten
    // every sweep, OR a missing key would go undetected.
    expect(settingsCmd).toContain(`.skipDangerousModePermissionPrompt == true`);
    expect(settingsCmd).toContain(`.askUserQuestionTimeout == "never"`);
    expect(settingsCmd).toContain(`.permissions.deny // []) | contains(["AskUserQuestion"])`);
    expect(settingsCmd).toContain(`.env.DISABLE_AUTOUPDATER == "1"`);
    expect(settingsCmd).toContain(`.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS == "1"`);

    // Absent-file path must use the same MERGE template applied to {}
    // (single source of truth for what "correct" means).
    expect(settingsCmd).toContain(`echo '{}' | jq "$MERGE"`);
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
      "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
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
    // Guard filter MUST iterate the array with `.[]?.hooks[]?` — an earlier
    // `.hooks[]?` (without the outer `.[]?`) tried to index the array itself
    // with "hooks", jq exited 5, the shell `if` treated that as false, the
    // strip was silently skipped, and every host got fleet-wide
    // "PostToolUse:Bash hook error" noise on every tool call (2026-09-05
    // regression guard).
    expect(cleanupCmd).toContain(".[]?.hooks[]?.command");
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

  // -------------------------------------------------------------------------
  // Phase 75 D-03: Step 4 — write ~/.claude/skynet-parent
  // -------------------------------------------------------------------------

  describe("step 4: skynet-parent write (Phase 75 D-03)", () => {
    const ORIGINAL_ENV = process.env.SKYNET_PUBLIC_URL;

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.SKYNET_PUBLIC_URL;
      } else {
        process.env.SKYNET_PUBLIC_URL = ORIGINAL_ENV;
      }
    });

    it("(sp-1) BootstrapResult has skynetParentOk: boolean field", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("skynetParentOk");
      expect(typeof result.skynetParentOk).toBe("boolean");
    });

    it("(sp-2) SKYNET_PUBLIC_URL unset → step 4 skipped cleanly (no exec of skynet-parent command, skynetParentOk=false, hadError NOT set solely due to missing env)", async () => {
      delete process.env.SKYNET_PUBLIC_URL;
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(false);
      // Missing env is a clean skip, not a per-host failure (RESEARCH Pitfall 4).
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      // No command should mention the skynet-parent write path.
      expect(cmds.some((c) => c.includes("skynet-parent"))).toBe(false);
      expect(cmds.some((c) => c.includes("__SKYNET_PARENT_OK__"))).toBe(false);
    });

    it("(sp-3) SKYNET_PUBLIC_URL malformed (non-https) → step 4 skipped cleanly (same as unset)", async () => {
      process.env.SKYNET_PUBLIC_URL = "http://foo.example";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(cmds.some((c) => c.includes("__SKYNET_PARENT_OK__"))).toBe(false);
    });

    it("(sp-3b) SKYNET_PUBLIC_URL is 'just a string' → step 4 skipped cleanly", async () => {
      process.env.SKYNET_PUBLIC_URL = "just a string";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(cmds.some((c) => c.includes("__SKYNET_PARENT_OK__"))).toBe(false);
    });

    it("(sp-4) valid https URL → shell command contains mkdir, NEW= assignment, content-diff, printf atomic write, sentinel", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const cmds = captureCommands(exec);
      const spCmd = cmds.find((c) => c.includes("__SKYNET_PARENT_OK__"));
      expect(spCmd).toBeDefined();
      if (!spCmd) return;

      // Must set the target path variable and mkdir the parent dir
      expect(spCmd).toContain(`SP="$HOME/.claude/skynet-parent"`);
      expect(spCmd).toContain(`mkdir -p "$HOME/.claude"`);
      // Must define NEW as single-quoted URL literal
      expect(spCmd).toContain(`NEW='https://term.gigaashley.click'`);
      // Must include content-diff idempotency guard (RESEARCH Pitfall 3)
      expect(spCmd).toContain(`[ -f "$SP" ]`);
      expect(spCmd).toContain(`[ "$(cat "$SP")" = "$NEW" ]`);
      // Must include atomic printf-then-mv write with newline termination
      expect(spCmd).toContain(`printf '%s\\n' "$NEW"`);
      expect(spCmd).toContain(`mv "$SP.new" "$SP"`);
      // Must echo the sentinel at the end
      expect(spCmd).toContain(`echo "__SKYNET_PARENT_OK__"`);
    });

    it("(sp-5) sentinel present → skynetParentOk=true, hadError=false", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "some benign chatter\n__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(sp-6) channel returns null on skynet-parent write → hadError=true, skynetParentOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-parent-write") &&
          c.step === "skynet-parent-write" &&
          c.errorMessage === "channel returned null"
        );
      });
      expect(found).toBe(true);
    });

    it("(sp-7) missing sentinel → hadError=true, logBootstrapFailed called with trimmed output", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "mv: cannot move: Read-only file system\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-parent-write") &&
          c.step === "skynet-parent-write" &&
          typeof c.errorMessage === "string" &&
          (c.errorMessage as string).includes("Read-only file system")
        );
      });
      expect(found).toBe(true);
    });

    it("(sp-8) channel.exec throws during step 4 → hadError=true, function still resolves (NEVER-THROW)", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("skynet-parent")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      const result = await runBootstrapForHost(throwingChannel, HOST);

      expect(result.skynetParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-parent-write") &&
          c.step === "skynet-parent-write" &&
          c.errorMessage === "boom"
        );
      });
      expect(found).toBe(true);
    });

    it("(sp-9) URL containing single-quote is shell-escaped safely with the '\\'' pattern", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://example.com/a'b";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);
      expect(result.skynetParentOk).toBe(true);

      const cmds = captureCommands(exec);
      const spCmd = cmds.find((c) => c.includes("__SKYNET_PARENT_OK__"));
      expect(spCmd).toBeDefined();
      if (!spCmd) return;

      // The generated assignment must escape the embedded single-quote via
      // '\'' (close-quote, escaped literal quote, reopen-quote) so the assign
      // stays within a valid single-quoted string.
      expect(spCmd).toContain(`NEW='https://example.com/a'\\''b'`);
    });

    it("(sp-10) logBootstrapResult payload includes skynetParentOk field", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.gigaashley.click";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const infoCalls = vi.mocked(systemLogger.info).mock.calls;
      const summary = infoCalls.find(([_msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return c.operation === "fleet_substrate_bootstrap_result" && "hadError" in c;
      });
      expect(summary).toBeDefined();
      if (!summary) return;
      const ctx = summary[1] as Record<string, unknown>;
      expect(ctx).toHaveProperty("skynetParentOk");
      expect(ctx.skynetParentOk).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5: write ~/.claude/skynet-hostname
  // -------------------------------------------------------------------------

  describe("step 5: skynet-hostname write", () => {
    it("(hn-1) BootstrapResult has skynetHostnameOk: boolean field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("skynetHostnameOk");
      expect(typeof result.skynetHostnameOk).toBe("boolean");
    });

    it("(hn-2) logBootstrapResult payload includes skynetHostnameOk field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const infoCalls = vi.mocked(systemLogger.info).mock.calls;
      const summary = infoCalls.find(([_msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return c.operation === "fleet_substrate_bootstrap_result" && "hadError" in c;
      });
      expect(summary).toBeDefined();
      if (!summary) return;
      const ctx = summary[1] as Record<string, unknown>;
      expect(ctx).toHaveProperty("skynetHostnameOk");
      expect(ctx.skynetHostnameOk).toBe(true);
    });

    it("(hn-3) sentinel present → skynetHostnameOk=true, hadError=false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "some benign chatter\n__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetHostnameOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(hn-4) channel returns null on skynet-hostname write → hadError=true, skynetHostnameOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetHostnameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-hostname-write") &&
          c.step === "skynet-hostname-write" &&
          c.errorMessage === "channel returned null"
        );
      });
      expect(found).toBe(true);
    });

    it("(hn-5) missing sentinel → hadError=true, logBootstrapFailed called with trimmed output", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "mv: cannot move: Read-only file system\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetHostnameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-hostname-write") &&
          c.step === "skynet-hostname-write" &&
          typeof c.errorMessage === "string" &&
          (c.errorMessage as string).includes("Read-only file system")
        );
      });
      expect(found).toBe(true);
    });

    it("(hn-6) channel.exec throws during step 5 → hadError=true, function still resolves (NEVER-THROW)", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("skynet-parent")) return "__SKYNET_PARENT_OK__";
        if (cmd.includes("skynet-hostname")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      const result = await runBootstrapForHost(throwingChannel, HOST);

      expect(result.skynetHostnameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("skynet-hostname-write") &&
          c.step === "skynet-hostname-write" &&
          c.errorMessage === "boom"
        );
      });
      expect(found).toBe(true);
    });

    it("(hn-7) host.name containing a single-quote is shell-escaped safely with the '\\'' pattern", async () => {
      const HOST_SQ = { id: "h1", name: "o'brien-box" };
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST_SQ);
      expect(result.skynetHostnameOk).toBe(true);

      const cmds = captureCommands(exec);
      const shCmd = cmds.find((c) => c.includes("__SKYNET_HOSTNAME_OK__"));
      expect(shCmd).toBeDefined();
      if (!shCmd) return;

      // The generated assignment must escape the embedded single-quote via
      // '\'' (close-quote, escaped literal quote, reopen-quote) so the assign
      // stays within a valid single-quoted string.
      expect(shCmd).toContain(`NEW='o'\\''brien-box'`);
    });

    it("(hn-8) content-diff no-op path — file already matches, sentinel still emitted → skynetHostnameOk=true, hadError=false", async () => {
      // hn-8: The no-op path (file already matches on the remote) still emits
      // the sentinel because the shell's `:` branch falls through to the final
      // `echo "__SKYNET_HOSTNAME_OK__"`. From the test's POV (channel-mock
      // level), the happy path and the no-op path are indistinguishable — both
      // return the sentinel. This is intentional: idempotency is a property of
      // the remote shell, not of the client-side result parsing.
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "skynet-parent": "__SKYNET_PARENT_OK__",
        "skynet-hostname": "__SKYNET_HOSTNAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.skynetHostnameOk).toBe(true);
      expect(result.hadError).toBe(false);
    });
  });
});
