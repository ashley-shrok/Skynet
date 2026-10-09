/**
 * run-bootstrap.test.ts — Unit tests for runBootstrapForHost.
 *
 * Tests cover:
 *   (a) Already-enabled host: no linger/enable commands fired, daemon-reload
 *       still runs, settings check still runs.
 *   (b) Fresh host (is-enabled exit 1): linger + daemon-reload + enable --now
 *       fires in order as a single chained command; no separate daemon-reload.
 *   (c) settings.json already has all 7 fleet-required keys correct —
 *       the patch command still runs but the jq branch is not reached (we
 *       verify via the __SETTINGS_OK__ sentinel).
 *   (d) settings.json missing — file created with all 7 keys (sentinel ok).
 *   (e) settings.json exists without some keys — jq merge applied (sentinel ok).
 *   (e2) command shape: settings patch command references all 7 fleet-required
 *       keys AND the idempotency check covers all 7 (regression guard against
 *       accidental key drop).
 *   (f) Channel returns null on is-enabled check — hadError=true, still resolves.
 *   (g) Channel returns null on settings patch — hadError=true, still resolves.
 *   (h) Already-enabled host with daemon-reload failure — hadError=true, resolves.
 *
 * Phase 75 D-03 additions (step 4 — host-parent write):
 *   (sp-1) BootstrapResult has hostParentOk: boolean field.
 *   (sp-2) SKYNET_PUBLIC_URL unset → step 4 skipped, no exec, no hadError.
 *   (sp-3) SKYNET_PUBLIC_URL malformed (non-https) → step 4 skipped, no hadError.
 *   (sp-4) SKYNET_PUBLIC_URL https → shell command shape check (mkdir, NEW=, diff, printf, sentinel).
 *   (sp-5) Sentinel present → hostParentOk=true, hadError not set.
 *   (sp-6) Channel returns null → hadError=true, hostParentOk=false, logBootstrapFailed(host-parent-write, "channel returned null").
 *   (sp-7) Missing sentinel → hadError=true, logBootstrapFailed with trimmed output.
 *   (sp-8) Channel throws → hadError=true, function still resolves (NEVER-THROW).
 *   (sp-9) URL containing single-quote is shell-escaped safely ('\'' pattern).
 *   (sp-10) logBootstrapResult receives payload containing hostParentOk field.
 *   (sp-11) Existing steps 1-3 outcomes unchanged (regression gate — implicit in
 *           all pre-existing tests above; explicit assertion on hostParentOk field
 *           presence via sp-1).
 *
 * Step 5 additions (host-name write):
 *   (hn-1) BootstrapResult has hostNameOk: boolean field.
 *   (hn-2) logBootstrapResult payload includes hostNameOk field (mirror of sp-10).
 *   (hn-3) Sentinel present → hostNameOk=true, hadError=false (happy path).
 *   (hn-4) Channel returns null → hadError=true, hostNameOk=false,
 *          logBootstrapFailed(host-name-write, "channel returned null").
 *   (hn-5) Missing sentinel → hadError=true, logBootstrapFailed with trimmed output.
 *   (hn-6) Channel throws → hadError=true, function still resolves (NEVER-THROW).
 *   (hn-7) host.name containing a single-quote is shell-escaped safely with the
 *          '\'' pattern.
 *   (hn-8) Content-diff no-op path (file already matches) — indistinguishable from
 *          happy path at the channel-mock level (both emit the sentinel); assert
 *          hostNameOk=true with no error.
 *
 * Step 6 additions (usage-reporter retirement):
 *   (sl-1) BootstrapResult has usageReporterRetireOk: boolean field.
 *   (sl-2) Shell command shape — wrapper match, WRAPPED= restore or
 *          del(.statusLine), rm of retired files + ~/.claude/usage, sentinel.
 *   (sl-3) Sentinel present → usageReporterRetireOk=true, hadError=false.
 *   (sl-4) Channel returns null → hadError=true, usageReporterRetireOk=false,
 *          logBootstrapFailed(usage-reporter-retire, "channel returned null").
 *   (sl-5) Missing sentinel → hadError=true with trimmed remote output.
 *   (sl-6) Channel throws → hadError=true, function still resolves (NEVER-THROW).
 *   (sl-7) logBootstrapResult payload includes usageReporterRetireOk field.
 *   (sl-8) Retire script executed under real `sh` against a temp $HOME —
 *          restore / spicy / empty / no-conf / self-wrap / not-wrapped.
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
  // Seed handlers with happy-path sentinels for steps that most tests don't
  // care about individually. Per-test handlers with the same key override
  // (spread order: seeded first, user handlers second, later keys win in the
  // Object.entries iteration order). Tests specifically about a seeded step
  // override with their own value (including null for failure paths).
  const seeded: Record<string, string | null> = {
    __USAGE_REPORTER_RETIRED__: "__USAGE_REPORTER_RETIRED__",
    // Default happy-path for Step 5b (host-id). Tests specifically
    // exercising the hostid step override this key with their own value.
    // Same shape as tests explicitly seeding "host/name" for Step 5.
    "host/id": "__HOST_ID_OK__",
    // Default happy-path for Step 1b (gc-timer is-enabled check). Returns
    // EXIT:0 so existing tests see gcTimerAlreadyEnabled=true and no hadError.
    // Tests specifically exercising Step 1b override this key.
    "interactive-messages-gc.timer": "enabled\nEXIT:0",
    // Default happy-path for Step 1c (scheduled-agents-scheduler is-enabled
    // check). Same shape as gc-timer above — EXIT:0 keeps unrelated tests
    // green; tests specifically exercising Step 1c override this key.
    "scheduled-agents-scheduler.service": "enabled\nEXIT:0",
    ...handlers,
  };
  const exec = vi.fn(async (cmd: string) => {
    for (const [key, response] of Object.entries(seeded)) {
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
      "host/name": "__HOST_NAME_OK__",
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
      "host/name": "__HOST_NAME_OK__",
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
      "host/name": "__HOST_NAME_OK__",
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
      "host/name": "__HOST_NAME_OK__",
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
      "host/name": "__HOST_NAME_OK__",
    });

    const result = await runBootstrapForHost(channel, HOST);

    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it("(e2) settings command references all 7 fleet-required keys in both merge and check", async () => {
    // Regression guard: the settings.json patch must enforce ALL 7 keys, not
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

    // All 7 keys must appear in the MERGE side (what gets written to disk).
    expect(settingsCmd).toContain(`"AskUserQuestion"`);
    expect(settingsCmd).toContain(`.askUserQuestionTimeout = "never"`);
    expect(settingsCmd).toContain(`.DISABLE_AUTOUPDATER = "1"`);
    expect(settingsCmd).toContain(`.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"`);
    expect(settingsCmd).toContain(`.skipDangerousModePermissionPrompt = true`);
    // task-field-check UserPromptSubmit hook — the merge must add an entry
    // whose command references task-field-check when absent.
    expect(settingsCmd).toContain(`.UserPromptSubmit`);
    expect(settingsCmd).toContain(`$HOME/.local/bin/task-field-check`);
    // allow-all-tools PreToolUse hook — the merge must add an entry
    // whose command references allow-all-tools when absent. NO matcher
    // field on the entry (universal auto-allow); the shape lives inside
    // the jq template as `{"hooks":[{"type":"command","command":"$HOME/.local/bin/allow-all-tools"}]}`
    // with no `matcher` key. The behavioral test in local-fleet-install.test.ts
    // exercises the end-to-end applied shape via real jq.
    expect(settingsCmd).toContain(`.PreToolUse`);
    expect(settingsCmd).toContain(`$HOME/.local/bin/allow-all-tools`);

    // All 7 keys must also appear in the CHECK side (idempotency predicate).
    // Without this, a partial-state settings.json would keep getting rewritten
    // every sweep, OR a missing key would go undetected.
    expect(settingsCmd).toContain(`.skipDangerousModePermissionPrompt == true`);
    expect(settingsCmd).toContain(`.askUserQuestionTimeout == "never"`);
    expect(settingsCmd).toContain(`.permissions.deny // []) | contains(["AskUserQuestion"])`);
    expect(settingsCmd).toContain(`.env.DISABLE_AUTOUPDATER == "1"`);
    expect(settingsCmd).toContain(`.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS == "1"`);
    // task-field-check idempotency predicate — the CHECK side must recognize
    // an already-present entry so we don't rewrite the file every sweep.
    expect(settingsCmd).toContain(`.hooks.UserPromptSubmit // []`);
    expect(settingsCmd).toContain(`test("task-field-check")`);
    // allow-all-tools idempotency predicate — same rationale.
    expect(settingsCmd).toContain(`.hooks.PreToolUse // []`);
    expect(settingsCmd).toContain(`test("allow-all-tools")`);

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
      "host/name": "__HOST_NAME_OK__",
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
  // Phase 75 D-03: Step 4 — write ~/fleet/host/parent
  // -------------------------------------------------------------------------

  describe("step 4: host-parent write (Phase 75 D-03)", () => {
    const ORIGINAL_ENV = process.env.SKYNET_PUBLIC_URL;

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.SKYNET_PUBLIC_URL;
      } else {
        process.env.SKYNET_PUBLIC_URL = ORIGINAL_ENV;
      }
    });

    it("(sp-1) BootstrapResult has hostParentOk: boolean field", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("hostParentOk");
      expect(typeof result.hostParentOk).toBe("boolean");
    });

    it("(sp-2) SKYNET_PUBLIC_URL unset → step 4 skipped cleanly (no exec of host-parent command, hostParentOk=false, hadError NOT set solely due to missing env)", async () => {
      delete process.env.SKYNET_PUBLIC_URL;
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(false);
      // Missing env is a clean skip, not a per-host failure (RESEARCH Pitfall 4).
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      // No command should mention the host-parent write path.
      expect(cmds.some((c) => c.includes("host/parent"))).toBe(false);
      expect(cmds.some((c) => c.includes("__HOST_PARENT_OK__"))).toBe(false);
    });

    it("(sp-3) SKYNET_PUBLIC_URL malformed (non-https) → step 4 skipped cleanly (same as unset)", async () => {
      process.env.SKYNET_PUBLIC_URL = "http://foo.example";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(cmds.some((c) => c.includes("__HOST_PARENT_OK__"))).toBe(false);
    });

    it("(sp-3b) SKYNET_PUBLIC_URL is 'just a string' → step 4 skipped cleanly", async () => {
      process.env.SKYNET_PUBLIC_URL = "just a string";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(cmds.some((c) => c.includes("__HOST_PARENT_OK__"))).toBe(false);
    });

    it("(sp-4) valid https URL → shell command contains mkdir, NEW= assignment, content-diff, printf atomic write, sentinel", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const cmds = captureCommands(exec);
      const spCmd = cmds.find((c) => c.includes("__HOST_PARENT_OK__"));
      expect(spCmd).toBeDefined();
      if (!spCmd) return;

      // Must set the target path variable and mkdir the parent dir
      expect(spCmd).toContain(`SP="$HOME/fleet/host/parent"`);
      expect(spCmd).toContain(`mkdir -p "$HOME/fleet/host"`);
      // Must remove legacy ~/.claude/skynet-parent file (brand-neutrality
      // migration — the file moved out of the harness folder).
      expect(spCmd).toContain(`rm -f "$HOME/.claude/skynet-parent"`);
      // Must define NEW as single-quoted URL literal
      expect(spCmd).toContain(`NEW='https://term.example.com'`);
      // Must include content-diff idempotency guard (RESEARCH Pitfall 3)
      expect(spCmd).toContain(`[ -f "$SP" ]`);
      expect(spCmd).toContain(`[ "$(cat "$SP")" = "$NEW" ]`);
      // Must include atomic printf-then-mv write with newline termination
      expect(spCmd).toContain(`printf '%s\\n' "$NEW"`);
      expect(spCmd).toContain(`mv "$SP.new" "$SP"`);
      // Must echo the sentinel at the end
      expect(spCmd).toContain(`echo "__HOST_PARENT_OK__"`);
    });

    it("(sp-5) sentinel present → hostParentOk=true, hadError=false", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "some benign chatter\n__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(sp-6) channel returns null on host-parent write → hadError=true, hostParentOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-parent-write") &&
          c.step === "host-parent-write" &&
          c.errorMessage === "channel returned null"
        );
      });
      expect(found).toBe(true);
    });

    it("(sp-7) missing sentinel → hadError=true, logBootstrapFailed called with trimmed output", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "mv: cannot move: Read-only file system\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-parent-write") &&
          c.step === "host-parent-write" &&
          typeof c.errorMessage === "string" &&
          (c.errorMessage as string).includes("Read-only file system")
        );
      });
      expect(found).toBe(true);
    });

    it("(sp-8) channel.exec throws during step 4 → hadError=true, function still resolves (NEVER-THROW)", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      const result = await runBootstrapForHost(throwingChannel, HOST);

      expect(result.hostParentOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-parent-write") &&
          c.step === "host-parent-write" &&
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
        "host/parent": "__HOST_PARENT_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);
      expect(result.hostParentOk).toBe(true);

      const cmds = captureCommands(exec);
      const spCmd = cmds.find((c) => c.includes("__HOST_PARENT_OK__"));
      expect(spCmd).toBeDefined();
      if (!spCmd) return;

      // The generated assignment must escape the embedded single-quote via
      // '\'' (close-quote, escaped literal quote, reopen-quote) so the assign
      // stays within a valid single-quoted string.
      expect(spCmd).toContain(`NEW='https://example.com/a'\\''b'`);
    });

    it("(sp-10) logBootstrapResult payload includes hostParentOk field", async () => {
      process.env.SKYNET_PUBLIC_URL = "https://term.example.com";
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
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
      expect(ctx).toHaveProperty("hostParentOk");
      expect(ctx.hostParentOk).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5: write ~/fleet/host/name
  // -------------------------------------------------------------------------

  describe("step 5: host-name write", () => {
    it("(hn-1) BootstrapResult has hostNameOk: boolean field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("hostNameOk");
      expect(typeof result.hostNameOk).toBe("boolean");
    });

    it("(hn-2) logBootstrapResult payload includes hostNameOk field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
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
      expect(ctx).toHaveProperty("hostNameOk");
      expect(ctx.hostNameOk).toBe(true);
    });

    it("(hn-3) sentinel present → hostNameOk=true, hadError=false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "some benign chatter\n__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostNameOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(hn-4) channel returns null on host-name write → hadError=true, hostNameOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostNameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-name-write") &&
          c.step === "host-name-write" &&
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
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "mv: cannot move: Read-only file system\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostNameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-name-write") &&
          c.step === "host-name-write" &&
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
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      const result = await runBootstrapForHost(throwingChannel, HOST);

      expect(result.hostNameOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-name-write") &&
          c.step === "host-name-write" &&
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
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST_SQ);
      expect(result.hostNameOk).toBe(true);

      const cmds = captureCommands(exec);
      const shCmd = cmds.find((c) => c.includes("__HOST_NAME_OK__"));
      expect(shCmd).toBeDefined();
      if (!shCmd) return;

      // The generated assignment must escape the embedded single-quote via
      // '\'' (close-quote, escaped literal quote, reopen-quote) so the assign
      // stays within a valid single-quoted string.
      expect(shCmd).toContain(`NEW='o'\\''brien-box'`);
    });

    it("(hn-8) content-diff no-op path — file already matches, sentinel still emitted → hostNameOk=true, hadError=false", async () => {
      // hn-8: The no-op path (file already matches on the remote) still emits
      // the sentinel because the shell's `:` branch falls through to the final
      // `echo "__HOST_NAME_OK__"`. From the test's POV (channel-mock
      // level), the happy path and the no-op path are indistinguishable — both
      // return the sentinel. This is intentional: idempotency is a property of
      // the remote shell, not of the client-side result parsing.
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostNameOk).toBe(true);
      expect(result.hadError).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5b: write ~/fleet/host/id
  //
  // Numeric Skynet DB id, written on every sweep with content-diff
  // idempotency. Same fail-soft shape as Step 5 (host-name).
  // Consumer: app-development skill's create-app.sh reads this at scaffold
  // time to burn the numeric hostId into PANE_BASE.
  //
  // The seeded default in makeChannel supplies __HOST_ID_OK__ so all
  // pre-existing tests keep passing; these tests explicitly override.
  // -------------------------------------------------------------------------

  describe("step 5b: host-id write", () => {
    it("writes the machine id (shared across users' rows) when present, else the row id", async () => {
      const withMachine = makeChannel({});
      await runBootstrapForHost(withMachine.channel, { ...HOST, machineId: "7" });
      const cmdA = withMachine.exec.mock.calls
        .map(([c]) => String(c))
        .find((c) => c.includes("host/id"));
      expect(cmdA).toContain("NEW='7'");

      const rowOnly = makeChannel({});
      await runBootstrapForHost(rowOnly.channel, HOST);
      const cmdB = rowOnly.exec.mock.calls
        .map(([c]) => String(c))
        .find((c) => c.includes("host/id"));
      expect(cmdB).toContain("NEW='h1'");
    });

    it("(hid-1) BootstrapResult has hostIdOk: boolean field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": "__HOST_ID_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("hostIdOk");
      expect(typeof result.hostIdOk).toBe("boolean");
    });

    it("(hid-2) logBootstrapResult payload includes hostIdOk field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": "__HOST_ID_OK__",
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
      expect(ctx).toHaveProperty("hostIdOk");
      expect(ctx.hostIdOk).toBe(true);
    });

    it("(hid-3) sentinel present → hostIdOk=true, hadError=false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": "some benign chatter\n__HOST_ID_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostIdOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(hid-4) channel returns null on host-id write → hadError=true, hostIdOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostIdOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-id-write") &&
          c.step === "host-id-write" &&
          c.errorMessage === "channel returned null"
        );
      });
      expect(found).toBe(true);
    });

    it("(hid-5) missing sentinel → hadError=true, logBootstrapFailed called with trimmed output", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": "mv: cannot move: Read-only file system\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.hostIdOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-id-write") &&
          c.step === "host-id-write" &&
          typeof c.errorMessage === "string" &&
          (c.errorMessage as string).includes("Read-only file system")
        );
      });
      expect(found).toBe(true);
    });

    it("(hid-6) channel.exec throws during step 5b → hadError=true, function still resolves (NEVER-THROW)", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      const result = await runBootstrapForHost(throwingChannel, HOST);

      expect(result.hostIdOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("host-id-write") &&
          c.step === "host-id-write" &&
          c.errorMessage === "boom"
        );
      });
      expect(found).toBe(true);
    });

    it("(hid-7) writes host.id (numeric string) as the file content", async () => {
      const HOST_NUM = { id: "42", name: "the-nasty" };
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/parent": "__HOST_PARENT_OK__",
        "host/name": "__HOST_NAME_OK__",
        "host/id": "__HOST_ID_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST_NUM);
      expect(result.hostIdOk).toBe(true);

      const cmds = captureCommands(exec);
      const shCmd = cmds.find((c) => c.includes("__HOST_ID_OK__"));
      expect(shCmd).toBeDefined();
      if (!shCmd) return;

      // host.id "42" gets shell-escaped (no-op — pure digits) into NEW='42'.
      expect(shCmd).toContain(`NEW='42'`);
      // Target path is ~/fleet/host/id.
      expect(shCmd).toContain(`SH="$HOME/fleet/host/id"`);
    });
  });

  // -------------------------------------------------------------------------
  // Step 6: usage-reporter retirement.
  //   (sl-1) BootstrapResult has usageReporterRetireOk: boolean field.
  //   (sl-2) Shell command shape — wrapper match, WRAPPED= restore or
  //          del(.statusLine), rm of retired files + ~/.claude/usage, sentinel.
  //   (sl-3) Sentinel present → usageReporterRetireOk=true, hadError=false.
  //   (sl-4) Channel returns null → hadError=true, usageReporterRetireOk=false,
  //          logBootstrapFailed(usage-reporter-retire, "channel returned null").
  //   (sl-5) Missing sentinel → hadError=true with trimmed remote output.
  //   (sl-6) Channel throws → hadError=true, function still resolves (NEVER-THROW).
  //   (sl-7) logBootstrapResult payload includes usageReporterRetireOk field.
  //
  // The seeded default in makeChannel supplies __USAGE_REPORTER_RETIRED__ so all
  // pre-existing tests keep passing; these tests explicitly override.
  // -------------------------------------------------------------------------
  describe("step 6: usage-reporter retirement", () => {
    it("(sl-1) BootstrapResult has usageReporterRetireOk: boolean field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });
      const result = await runBootstrapForHost(channel, HOST);
      expect(typeof result.usageReporterRetireOk).toBe("boolean");
    });

    it("(sl-2) shell command shape — unwrap before removing files, sentinel", async () => {
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const cmds = captureCommands(exec);
      const retireCmd = cmds.find((c) => c.includes("__USAGE_REPORTER_RETIRED__"));
      expect(retireCmd).toBeDefined();
      if (!retireCmd) return;

      // Read current statusLine.command; only the wrapper path is unwrapped.
      expect(retireCmd).toContain(`jq -r '.statusLine.command // ""' "$SETTINGS"`);
      expect(retireCmd).toContain(`*/.local/bin/usage-reporter)`);
      // Original comes from the conf's WRAPPED=, read in a subshell.
      expect(retireCmd).toContain(`CONF="$HOME/.claude/usage/usage-reporter.conf"`);
      expect(retireCmd).toContain(`. "$CONF"`);
      // A wrapper-of-the-wrapper original is treated as no original.
      expect(retireCmd).toContain(`case "$ORIG" in *usage-reporter*) ORIG="" ;; esac`);
      // Restore or drop, atomically.
      expect(retireCmd).toContain(`jq --arg cmd "$ORIG" '.statusLine.command = $cmd'`);
      expect(retireCmd).toContain(`jq 'del(.statusLine)'`);
      expect(retireCmd).toContain(`mv "$SETTINGS.new" "$SETTINGS"`);
      // Files only removed after the unwrap succeeded.
      const rmIdx = retireCmd.indexOf("rm -f");
      expect(rmIdx).toBeGreaterThan(retireCmd.indexOf(`if [ "$UNWRAP_OK" = "1" ]`));
      for (const rel of [
        ".local/bin/usage-reporter",
        ".local/bin/usage-report",
        ".local/bin/claude-usage-collector",
        ".local/bin/install-usage-reporter",
      ]) {
        expect(retireCmd).toContain(`"$HOME/${rel}"`);
      }
      expect(retireCmd).toContain(`rm -rf "$HOME/.claude/usage"`);
      expect(retireCmd).toContain(`echo "__USAGE_REPORTER_RETIRED__"`);
    });

    it("(sl-3) sentinel present → usageReporterRetireOk=true, hadError=false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
        __USAGE_REPORTER_RETIRED__: "some benign chatter\n__USAGE_REPORTER_RETIRED__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.usageReporterRetireOk).toBe(true);
      expect(result.hadError).toBe(false);
    });

    it("(sl-4) channel returns null on usage-reporter-retire → hadError=true, usageReporterRetireOk=false, logBootstrapFailed called with 'channel returned null'", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
        __USAGE_REPORTER_RETIRED__: null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.usageReporterRetireOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("usage-reporter-retire") &&
          c.step === "usage-reporter-retire" &&
          c.errorMessage === "channel returned null"
        );
      });
      expect(found).toBe(true);
    });

    it("(sl-5) missing sentinel → hadError=true, logBootstrapFailed called with trimmed output", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
        __USAGE_REPORTER_RETIRED__: "jq: parse error at line 1\n",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.usageReporterRetireOk).toBe(false);
      expect(result.hadError).toBe(true);

      const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
      const found = warnCalls.some(([msg, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return (
          typeof msg === "string" &&
          msg.includes("usage-reporter-retire") &&
          c.step === "usage-reporter-retire" &&
          typeof c.errorMessage === "string" &&
          (c.errorMessage as string).includes("jq: parse error")
        );
      });
      expect(found).toBe(true);
    });

    it("(sl-6) channel.exec throws during step 6 → hadError=true, function still resolves (NEVER-THROW)", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("SETTINGS=") && !cmd.includes("__USAGE_REPORTER_RETIRED__"))
          return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) {
          throw new Error("boom");
        }
        return null;
      });
      const throwingChannel: SshChannel = { exec };

      await expect(
        runBootstrapForHost(throwingChannel, HOST),
      ).resolves.toBeDefined();

      const result = await runBootstrapForHost(throwingChannel, HOST);
      expect(result.hadError).toBe(true);
      expect(result.usageReporterRetireOk).toBe(false);
    });

    it("(sl-7) logBootstrapResult payload includes usageReporterRetireOk field", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      await runBootstrapForHost(channel, HOST);

      const infoCalls = vi.mocked(systemLogger.info).mock.calls;
      const summary = infoCalls.find(([, ctx]) => {
        const c = (ctx ?? {}) as Record<string, unknown>;
        return c.operation === "fleet_substrate_bootstrap_result" && "usageReporterRetireOk" in c;
      });
      expect(summary).toBeDefined();
      if (!summary) return;
      const ctx = summary[1] as Record<string, unknown>;
      expect(ctx.usageReporterRetireOk).toBe(true);
    });

    it("(sl-8) retire script, executed under a real POSIX shell against a temp $HOME", async () => {
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        SETTINGS: "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });
      await runBootstrapForHost(channel, HOST);
      const retireCmd = captureCommands(exec).find((c) =>
        c.includes("__USAGE_REPORTER_RETIRED__"),
      );
      expect(retireCmd).toBeDefined();
      if (!retireCmd) return;

      const fsp = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const nodeOs = await import("node:os");
      const { execFileSync } = await import("node:child_process");

      const spicy = `my-status --arg "hi $USER's world" -x`;
      const cases: Array<{
        name: string;
        cmd: string;
        conf: string | null;
        expectCmd: string | undefined;
      }> = [
        { name: "restore", cmd: "WRAP", conf: `WRAPPED='my-status --x'\n`, expectCmd: "my-status --x" },
        {
          name: "spicy",
          cmd: "WRAP",
          conf: `WRAPPED='${spicy.replace(/'/g, "'\\''")}'\n`,
          expectCmd: spicy,
        },
        { name: "empty", cmd: "WRAP", conf: `WRAPPED=''\n`, expectCmd: undefined },
        { name: "no-conf", cmd: "WRAP", conf: null, expectCmd: undefined },
        {
          name: "self-wrap",
          cmd: "/host-home/.local/bin/usage-reporter",
          conf: `WRAPPED='/host-home/.local/bin/usage-reporter'\n`,
          expectCmd: undefined,
        },
        { name: "not-wrapped", cmd: "my-own-status", conf: `WRAPPED='x'\n`, expectCmd: "my-own-status" },
      ];

      for (const c of cases) {
        const home = await fsp.mkdtemp(nodePath.join(nodeOs.tmpdir(), `retire-${c.name}-`));
        try {
          const bin = nodePath.join(home, ".local/bin");
          const usage = nodePath.join(home, ".claude/usage");
          await fsp.mkdir(bin, { recursive: true });
          await fsp.mkdir(usage, { recursive: true });
          for (const f of ["usage-reporter", "usage-report", "claude-usage-collector", "install-usage-reporter"]) {
            await fsp.writeFile(nodePath.join(bin, f), "#!/bin/sh\n");
          }
          if (c.conf !== null) {
            await fsp.writeFile(nodePath.join(usage, "usage-reporter.conf"), c.conf);
          }
          const wrapper = c.cmd === "WRAP" ? nodePath.join(home, ".local/bin/usage-reporter") : c.cmd;
          const settingsPath = nodePath.join(home, ".claude/settings.json");
          await fsp.writeFile(
            settingsPath,
            JSON.stringify({ theme: "dark", statusLine: { type: "command", command: wrapper, padding: 0 } }),
          );

          const out = execFileSync("sh", ["-c", retireCmd], {
            env: { PATH: process.env.PATH, HOME: home, USER: "u" },
            encoding: "utf-8",
          });
          expect(out.trimEnd().endsWith("__USAGE_REPORTER_RETIRED__"), c.name).toBe(true);

          const parsed = JSON.parse(await fsp.readFile(settingsPath, "utf-8"));
          expect(parsed.theme, c.name).toBe("dark");
          expect(parsed.statusLine?.command, c.name).toBe(c.expectCmd);
          if (c.expectCmd !== undefined) expect(parsed.statusLine.padding, c.name).toBe(0);
          expect((await fsp.readdir(bin)).length, c.name).toBe(0);
          await expect(fsp.access(usage), c.name).rejects.toThrow();
        } finally {
          await fsp.rm(home, { recursive: true, force: true });
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Step 1b: interactive-messages-gc.timer enable (Phase 140).
  //   (gc-1) BootstrapResult has gcTimerAlreadyEnabled and gcTimerBootstrapped fields.
  //   (gc-2) Already-enabled host → gcTimerAlreadyEnabled=true, gcTimerBootstrapped=false,
  //          no enable --now command fired.
  //   (gc-3) Not-enabled host → gcTimerBootstrapped=true, gcTimerAlreadyEnabled=false,
  //          enable --now command fired with interactive-messages-gc.timer.
  //   (gc-4) Channel returns null on is-enabled check → hadError=true,
  //          gcTimerAlreadyEnabled=false, gcTimerBootstrapped=false.
  //   (gc-5) Channel returns null on enable-now command → hadError=true,
  //          gcTimerBootstrapped=false.
  //   (gc-6) enable-now returns without sentinel → hadError=true, gcTimerBootstrapped=false.
  //
  // The seeded default in makeChannel supplies "enabled\nEXIT:0" for the
  // "interactive-messages-gc.timer" key so all pre-existing tests keep passing.
  // -------------------------------------------------------------------------
  describe("step 1b: interactive-messages-gc.timer enable (Phase 140)", () => {
    it("(gc-1) BootstrapResult has gcTimerAlreadyEnabled and gcTimerBootstrapped fields", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
        "interactive-messages-gc.timer": "enabled\nEXIT:0",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("gcTimerAlreadyEnabled");
      expect(result).toHaveProperty("gcTimerBootstrapped");
      expect(typeof result.gcTimerAlreadyEnabled).toBe("boolean");
      expect(typeof result.gcTimerBootstrapped).toBe("boolean");
    });

    it("(gc-2) timer already enabled → gcTimerAlreadyEnabled=true, gcTimerBootstrapped=false, no enable --now fired", async () => {
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
        "interactive-messages-gc.timer": "enabled\nEXIT:0",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.gcTimerAlreadyEnabled).toBe(true);
      expect(result.gcTimerBootstrapped).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      // The is-enabled probe must be sent.
      expect(cmds.some((c) => c.includes("is-enabled interactive-messages-gc.timer"))).toBe(true);
      // enable --now must NOT be sent (timer is already enabled).
      expect(cmds.some((c) => c.includes("enable --now interactive-messages-gc.timer"))).toBe(false);
    });

    it("(gc-3) timer not enabled → gcTimerBootstrapped=true, enable --now interactive-messages-gc.timer fired", async () => {
      // Use a custom exec that distinguishes the is-enabled probe from the
      // enable-now command by looking for "enable --now" specifically.
      // Order matters: more specific patterns before general ones.
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        // Step 1b: enable-now BEFORE is-enabled so the --now variant matches first.
        if (cmd.includes("enable --now interactive-messages-gc.timer")) return "__GC_TIMER_OK__";
        // Step 1b: is-enabled probe for gc.timer.
        if (cmd.includes("is-enabled interactive-messages-gc.timer")) return "disabled\nEXIT:1";
        // Step 1c: happy-path skip for scheduled-agents-scheduler (this
        // test is scoped to Step 1b behavior; Step 1c shouldn't affect it).
        if (cmd.includes("is-enabled scheduled-agents-scheduler.service")) return "enabled\nEXIT:0";
        // Step 6 usage-reporter retire: check sentinel first since cmd also has SETTINGS=.
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.gcTimerAlreadyEnabled).toBe(false);
      expect(result.gcTimerBootstrapped).toBe(true);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      // enable --now must be sent.
      expect(cmds.some((c) => c.includes("enable --now interactive-messages-gc.timer"))).toBe(true);
    });

    it("(gc-4) channel returns null on gc-timer is-enabled check → hadError=true, gcTimerAlreadyEnabled=false, gcTimerBootstrapped=false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        // Override: null for gc-timer probe.
        "interactive-messages-gc.timer": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.gcTimerAlreadyEnabled).toBe(false);
      expect(result.gcTimerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });

    it("(gc-5) channel returns null on gc-timer enable-now → hadError=true, gcTimerBootstrapped=false", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("enable --now interactive-messages-gc.timer")) return null;
        if (cmd.includes("is-enabled interactive-messages-gc.timer")) return "disabled\nEXIT:1";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.gcTimerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });

    it("(gc-6) enable-now returns without sentinel → hadError=true, gcTimerBootstrapped=false", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("enable --now interactive-messages-gc.timer"))
          return "Failed to start interactive-messages-gc.timer\n";
        if (cmd.includes("is-enabled interactive-messages-gc.timer")) return "disabled\nEXIT:1";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.gcTimerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });
  });

  describe("step 1c: scheduled-agents-scheduler.service enable", () => {
    it("(sched-1) BootstrapResult has scheduledAgentsSchedulerAlreadyEnabled and scheduledAgentsSchedulerBootstrapped fields", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result).toHaveProperty("scheduledAgentsSchedulerAlreadyEnabled");
      expect(result).toHaveProperty("scheduledAgentsSchedulerBootstrapped");
      expect(typeof result.scheduledAgentsSchedulerAlreadyEnabled).toBe(
        "boolean",
      );
      expect(typeof result.scheduledAgentsSchedulerBootstrapped).toBe("boolean");
    });

    it("(sched-2) scheduler already enabled → alreadyEnabled=true, bootstrapped=false, no enable --now fired", async () => {
      const { channel, exec } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "host/name": "__HOST_NAME_OK__",
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.scheduledAgentsSchedulerAlreadyEnabled).toBe(true);
      expect(result.scheduledAgentsSchedulerBootstrapped).toBe(false);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(
        cmds.some((c) =>
          c.includes("is-enabled scheduled-agents-scheduler.service"),
        ),
      ).toBe(true);
      expect(
        cmds.some((c) =>
          c.includes("enable --now scheduled-agents-scheduler.service"),
        ),
      ).toBe(false);
    });

    it("(sched-3) scheduler not enabled → bootstrapped=true, enable --now scheduled-agents-scheduler.service fired", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("is-enabled interactive-messages-gc.timer"))
          return "enabled\nEXIT:0";
        // Step 1c: enable-now BEFORE is-enabled so the --now variant matches first.
        if (cmd.includes("enable --now scheduled-agents-scheduler.service"))
          return "__SCHED_OK__";
        if (cmd.includes("is-enabled scheduled-agents-scheduler.service"))
          return "disabled\nEXIT:1";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.scheduledAgentsSchedulerAlreadyEnabled).toBe(false);
      expect(result.scheduledAgentsSchedulerBootstrapped).toBe(true);
      expect(result.hadError).toBe(false);

      const cmds = captureCommands(exec);
      expect(
        cmds.some((c) =>
          c.includes("enable --now scheduled-agents-scheduler.service"),
        ),
      ).toBe(true);
    });

    it("(sched-4) channel returns null on scheduler is-enabled check → hadError=true, both fields false", async () => {
      const { channel } = makeChannel({
        "is-enabled": "enabled\nEXIT:0",
        "daemon-reload": "__RELOAD_OK__",
        "SETTINGS": "__SETTINGS_OK__",
        "gsd-context-monitor": "__CLEANUP_OK__",
        "scheduled-agents-scheduler.service": null,
      });

      const result = await runBootstrapForHost(channel, HOST);

      expect(result.scheduledAgentsSchedulerAlreadyEnabled).toBe(false);
      expect(result.scheduledAgentsSchedulerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });

    it("(sched-5) channel returns null on scheduler enable-now → hadError=true, bootstrapped=false", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("is-enabled interactive-messages-gc.timer"))
          return "enabled\nEXIT:0";
        if (cmd.includes("enable --now scheduled-agents-scheduler.service"))
          return null;
        if (cmd.includes("is-enabled scheduled-agents-scheduler.service"))
          return "disabled\nEXIT:1";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.scheduledAgentsSchedulerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });

    it("(sched-6) enable-now returns without sentinel → hadError=true, bootstrapped=false", async () => {
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.includes("is-enabled agent-supervisor")) return "enabled\nEXIT:0";
        if (cmd.includes("daemon-reload")) return "__RELOAD_OK__";
        if (cmd.includes("is-enabled interactive-messages-gc.timer"))
          return "enabled\nEXIT:0";
        if (cmd.includes("enable --now scheduled-agents-scheduler.service"))
          return "Failed to start scheduled-agents-scheduler.service\n";
        if (cmd.includes("is-enabled scheduled-agents-scheduler.service"))
          return "disabled\nEXIT:1";
        if (cmd.includes("__USAGE_REPORTER_RETIRED__")) return "__USAGE_REPORTER_RETIRED__";
        if (cmd.includes("SETTINGS=")) return "__SETTINGS_OK__";
        if (cmd.includes("gsd-context-monitor")) return "__CLEANUP_OK__";
        if (cmd.includes("host/parent")) return "__HOST_PARENT_OK__";
        if (cmd.includes("host/name")) return "__HOST_NAME_OK__";
        if (cmd.includes("host/id")) return "__HOST_ID_OK__";
        return null;
      });
      const ch: SshChannel = { exec };

      const result = await runBootstrapForHost(ch, HOST);

      expect(result.scheduledAgentsSchedulerBootstrapped).toBe(false);
      expect(result.hadError).toBe(true);
    });
  });
});
