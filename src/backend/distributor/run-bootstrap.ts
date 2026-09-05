/**
 * run-bootstrap.ts — Pre-sweep bootstrap for managed hosts.
 *
 * RESPONSIBILITY:
 *   Runs BEFORE the catalog loop in runSweepForHost. Two idempotent jobs:
 *
 *   1. agent-supervisor systemd bootstrap:
 *      Check whether agent-supervisor.service is already enabled. If not,
 *      run the one-time setup sequence (loginctl enable-linger, daemon-reload,
 *      enable --now). Also runs `systemctl --user daemon-reload` unconditionally
 *      on every sweep — this ensures that when the agent-supervisor.service
 *      UNIT FILE bytes change (via the catalog entry added in this bounty),
 *      systemd has re-read the updated unit before the catalog loop fires the
 *      restart hook.
 *
 *   2. settings.json patch:
 *      Ensure ~/.claude/settings.json has `skipDangerousModePermissionPrompt:
 *      true`. Merges the flag in without clobbering any other keys (OAuth
 *      token, permissions, env, etc.). Creates the file if absent. Idempotent.
 *
 *   3. gsd-context-monitor cleanup (fleet-wide retirement):
 *      Strip any `.hooks.PostToolUse[]` entry whose command references
 *      `gsd-context-monitor.js` from ~/.claude/settings.json AND remove the
 *      hook file at ~/.claude/hooks/gsd-context-monitor.js if present. The
 *      hook is redundant with the ambient context-watch.py Monitor and gave
 *      false pressure warnings (the harness context meter overstates actual
 *      usage). Idempotent — no-op after first sweep on each host.
 *
 * NEVER-THROW CONTRACT:
 *   runBootstrapForHost NEVER rejects. All risky calls are wrapped in
 *   try/catch; failures are logged and the function resolves. The caller
 *   (runSweepForHost) depends on this — an unhandled rejection here would
 *   propagate through the sweep's fire-and-forget contract.
 *
 * LOG TAGS:
 *   fleet_substrate_bootstrap_result — always emitted once per call
 *   fleet_substrate_bootstrap_failed — emitted on any sub-step failure
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { systemLogger } from "../utils/logger.js";

/**
 * Result shape returned by runBootstrapForHost. Used in tests to assert
 * which sub-steps ran.
 */
export interface BootstrapResult {
  /** Whether agent-supervisor.service was already enabled before this call. */
  alreadyEnabled: boolean;
  /** Whether the linger+daemon-reload+enable sequence ran successfully. */
  bootstrapRan: boolean;
  /** Whether daemon-reload ran (always true when SSH channel is healthy). */
  daemonReloadRan: boolean;
  /** Whether the settings.json patch was applied or already present. */
  settingsPatchOk: boolean;
  /** Whether the gsd-context-monitor cleanup ran (settings strip + hook rm). */
  gsdContextMonitorCleanupOk: boolean;
  /** True if any sub-step encountered an error. */
  hadError: boolean;
}

/**
 * Emit the always-on bootstrap summary. One per sweep per host.
 */
function logBootstrapResult(
  host: { id: string; name: string },
  result: BootstrapResult & { errorMessage?: string },
): void {
  const level = result.hadError ? "warn" : "info";
  systemLogger[level](
    `Fleet-substrate bootstrap completed for host ${host.name}`,
    {
      operation: "fleet_substrate_bootstrap_result",
      fleetHostId: host.id,
      hostName: host.name,
      ...result,
    },
  );
}

/**
 * Emit a per-step failure detail line. Warn level.
 */
function logBootstrapFailed(
  host: { id: string; name: string },
  step: string,
  errorMessage: string,
): void {
  systemLogger.warn(
    `Fleet-substrate bootstrap step failed: ${step} on ${host.name}`,
    {
      operation: "fleet_substrate_bootstrap_failed",
      fleetHostId: host.id,
      hostName: host.name,
      step,
      errorMessage,
    },
  );
}

/**
 * Run idempotent pre-sweep bootstrap on a managed host.
 *
 * Called by runSweepForHost BEFORE the catalog loop. The two jobs:
 *   1. agent-supervisor systemd linger + enable (first install only) +
 *      unconditional daemon-reload (every sweep).
 *   2. settings.json patch: ensure skipDangerousModePermissionPrompt is true.
 *
 * NEVER REJECTS.
 */
export async function runBootstrapForHost(
  channel: SshChannel,
  host: { id: string; name: string },
): Promise<BootstrapResult> {
  let alreadyEnabled = false;
  let bootstrapRan = false;
  let daemonReloadRan = false;
  let settingsPatchOk = false;
  let gsdContextMonitorCleanupOk = false;
  let hadError = false;

  // -------------------------------------------------------------------------
  // Step 1: Check whether agent-supervisor.service is already enabled.
  //         Then run daemon-reload unconditionally (ensures any unit-file byte
  //         change from the catalog loop is visible to systemd before restart).
  // -------------------------------------------------------------------------
  try {
    // Sentinel-based exit-code capture: echo "EXIT:$?" after the check so we
    // can distinguish "enabled" (exit 0) from "not enabled / unit not found"
    // (exit 1+) without relying on stdout text parsing across systemd versions.
    const checkCmd =
      `systemctl --user is-enabled agent-supervisor.service 2>/dev/null; echo "EXIT:$?"`;
    const checkRaw = await channel.exec(checkCmd);

    if (checkRaw === null) {
      hadError = true;
      logBootstrapFailed(host, "is-enabled-check", "channel returned null");
    } else {
      const trimmed = checkRaw.trimEnd();
      // Extract exit code from the last "EXIT:<n>" sentinel line.
      const match = trimmed.match(/EXIT:(\d+)$/m);
      const exitCode = match ? parseInt(match[1], 10) : -1;

      if (exitCode === 0) {
        // Already enabled — skip the linger+enable sequence.
        alreadyEnabled = true;
        systemLogger.info(
          `Fleet-substrate bootstrap: agent-supervisor already enabled on ${host.name}`,
          {
            operation: "fleet_substrate_bootstrap_result",
            fleetHostId: host.id,
            hostName: host.name,
            step: "is-enabled-check",
            alreadyEnabled: true,
          },
        );
      } else {
        // Not enabled (fresh host or unit not found). Run the full setup:
        //   loginctl enable-linger  — persist systemd-user across logout
        //   systemctl --user daemon-reload  — pick up newly-installed unit file
        //   systemctl --user enable --now   — enable + start
        const bootstrapCmd = [
          `loginctl enable-linger "$(whoami)"`,
          `systemctl --user daemon-reload`,
          `systemctl --user enable --now agent-supervisor.service`,
          `echo "__BOOTSTRAP_OK__"`,
        ].join(" && ");

        const bootstrapRaw = await channel.exec(bootstrapCmd);

        if (bootstrapRaw === null) {
          hadError = true;
          logBootstrapFailed(
            host,
            "linger-enable-sequence",
            "channel returned null",
          );
        } else if (!bootstrapRaw.trimEnd().endsWith("__BOOTSTRAP_OK__")) {
          hadError = true;
          logBootstrapFailed(
            host,
            "linger-enable-sequence",
            bootstrapRaw.trimEnd().slice(0, 500) || "unknown bootstrap failure",
          );
        } else {
          bootstrapRan = true;
          // daemon-reload ran as part of the bootstrap sequence.
          daemonReloadRan = true;
        }
      }

      // Unconditional daemon-reload (even if already-enabled) — ensures the
      // catalog loop's restart hook sees any unit-file byte changes pushed
      // earlier in this sweep (or in a future sweep when bytes differ again).
      // Skip if daemon-reload already ran as part of the bootstrap sequence.
      if (!daemonReloadRan) {
        const reloadCmd =
          `systemctl --user daemon-reload && echo "__RELOAD_OK__"`;
        const reloadRaw = await channel.exec(reloadCmd);

        if (reloadRaw === null) {
          hadError = true;
          logBootstrapFailed(host, "daemon-reload", "channel returned null");
        } else if (!reloadRaw.trimEnd().endsWith("__RELOAD_OK__")) {
          hadError = true;
          logBootstrapFailed(
            host,
            "daemon-reload",
            reloadRaw.trimEnd().slice(0, 500) || "daemon-reload failed",
          );
        } else {
          daemonReloadRan = true;
        }
      }
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "is-enabled-check",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: Patch ~/.claude/settings.json — ensure
  //         skipDangerousModePermissionPrompt is true.
  //         Idempotent: skip if already set. Preserves all other keys.
  // -------------------------------------------------------------------------
  try {
    // Single SSH exec that handles three cases:
    //   (a) File exists + flag already true  → no-op, echoes __SETTINGS_OK__
    //   (b) File exists + flag missing/false → jq-merge, echoes __SETTINGS_OK__
    //   (c) File absent                      → create with flag, echoes __SETTINGS_OK__
    // Uses a .new temp file + mv for atomic write (no partial-write state).
    const settingsCmd = [
      `SETTINGS="$HOME/.claude/settings.json"`,
      `if [ -f "$SETTINGS" ]; then`,
      `  jq -e '.skipDangerousModePermissionPrompt == true' "$SETTINGS" > /dev/null 2>&1 || {`,
      `    jq '. + {skipDangerousModePermissionPrompt: true}' "$SETTINGS" > "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS"`,
      `  }`,
      `else`,
      `  mkdir -p "$(dirname "$SETTINGS")"`,
      `  printf '{"skipDangerousModePermissionPrompt": true}\\n' > "$SETTINGS"`,
      `fi`,
      `echo "__SETTINGS_OK__"`,
    ].join("\n");

    const settingsRaw = await channel.exec(settingsCmd);

    if (settingsRaw === null) {
      hadError = true;
      logBootstrapFailed(host, "settings-patch", "channel returned null");
    } else if (!settingsRaw.trimEnd().endsWith("__SETTINGS_OK__")) {
      hadError = true;
      logBootstrapFailed(
        host,
        "settings-patch",
        settingsRaw.trimEnd().slice(0, 500) || "settings patch failed",
      );
    } else {
      settingsPatchOk = true;
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "settings-patch",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 3: gsd-context-monitor cleanup — fleet-wide retirement.
  //         (a) Strip any settings.json .hooks.PostToolUse[] entry whose
  //             command references gsd-context-monitor.js.
  //         (b) rm -f the hook file at ~/.claude/hooks/gsd-context-monitor.js.
  //         Idempotent: no-op after first sweep on each host.
  // -------------------------------------------------------------------------
  try {
    // The jq strip is guarded by an `any(...)` check so we only rewrite the
    // file when a matching entry is actually present — keeps the sweep cheap
    // on already-clean hosts. rm -f is unconditionally idempotent (no error
    // if the file is absent) so no guard needed there.
    const cleanupCmd = [
      `S_FILE="$HOME/.claude/settings.json"`,
      `if [ -f "$S_FILE" ] && jq -e '.hooks.PostToolUse // [] | any(.hooks[]?.command // ""; test("gsd-context-monitor"))' "$S_FILE" > /dev/null 2>&1; then`,
      `  jq '.hooks.PostToolUse |= map(select(any(.hooks[]?.command // ""; test("gsd-context-monitor")) | not))' "$S_FILE" > "$S_FILE.new" && mv "$S_FILE.new" "$S_FILE"`,
      `fi`,
      `rm -f "$HOME/.claude/hooks/gsd-context-monitor.js"`,
      `echo "__CLEANUP_OK__"`,
    ].join("\n");

    const cleanupRaw = await channel.exec(cleanupCmd);

    if (cleanupRaw === null) {
      hadError = true;
      logBootstrapFailed(host, "gsd-context-monitor-cleanup", "channel returned null");
    } else if (!cleanupRaw.trimEnd().endsWith("__CLEANUP_OK__")) {
      hadError = true;
      logBootstrapFailed(
        host,
        "gsd-context-monitor-cleanup",
        cleanupRaw.trimEnd().slice(0, 500) || "cleanup failed",
      );
    } else {
      gsdContextMonitorCleanupOk = true;
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "gsd-context-monitor-cleanup",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  const result: BootstrapResult = {
    alreadyEnabled,
    bootstrapRan,
    daemonReloadRan,
    settingsPatchOk,
    gsdContextMonitorCleanupOk,
    hadError,
  };

  logBootstrapResult(host, result);
  return result;
}
