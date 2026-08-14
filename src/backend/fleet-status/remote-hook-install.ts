/**
 * remote-hook-install.ts — One-time-per-host Stop-hook install helper.
 *
 * ## Purpose
 * Installs the fleet-status Stop hook onto an identity-hosting box by:
 *   (a) Dropping `stop-hook.sh` at ~/.claude/hooks/skynet-fleet-status-stop.sh
 *       over SSH (atomic write via .tmp + mv, chmod +x).
 *   (b) SSH-reading ~/.claude/settings.json, merging the hooks.Stop entry
 *       in-memory (idempotent — no-op on second run), and writing back
 *       atomically via heredoc .tmp + mv.
 *   (c) Protecting ~/.claude/settings.json from clobbering if it contains
 *       invalid JSON — log + throw rather than overwriting.
 *
 * ## D-CTX § PIVOT 2026-08-13 (LOCKED)
 * This module is a one-time install helper, NOT a persistent process.
 * The ssh-poll-orchestrator calls this once per newly-discovered identity-hosting
 * host. It does not run continuously.
 *
 * ## Settings.json hook registration schema (RESEARCH §2)
 * Three-level nesting:
 *   hooks.Stop[0].hooks[N] = { type: 'command', command: '<path>' }
 * Hooks MERGE across levels (they do not override). Our entry appends to
 * Stop[0].hooks[] — if Stop[0] doesn't exist we create the minimal structure.
 *
 * ## Import pattern for stop-hook.sh
 * The `stop-hook.sh` shell script contents are inlined at module load as the
 * `STOP_HOOK_SCRIPT_CONTENTS` constant — no runtime filesystem read is required
 * for the default install path. This eliminates a fleet-wide ENOENT bug caused
 * by `tsc` not copying `.sh` sibling assets into `dist/`. The
 * `opts.localHookScriptPath` escape hatch is retained for tests and uses a
 * dynamic `node:fs` import so the production path pays no fs import cost.
 */
import { systemLogger } from "../utils/logger.js";
import type { SshChannel } from "./ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOpts {
  /** Remote path where the hook script is dropped. Default: ~/.claude/hooks/skynet-fleet-status-stop.sh */
  remoteHookPath?: string;
  /** Remote directory for the payload file. Default: ~/.claude/fleet-status */
  remotePayloadDir?: string;
  /** Local path to stop-hook.sh. Default: sibling file resolved via import.meta.url */
  localHookScriptPath?: string;
}

export interface InstallResult {
  hookInstalled: boolean;
  settingsUpdated: boolean;
}

export interface MergeResult {
  merged: Record<string, unknown>;
  alreadyInstalled: boolean;
}

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

const DEFAULT_REMOTE_HOOK_PATH =
  "~/.claude/hooks/skynet-fleet-status-stop.sh";
const DEFAULT_REMOTE_PAYLOAD_DIR = "~/.claude/fleet-status";

// SOURCE OF TRUTH: keep this string byte-for-byte in sync with
// src/backend/fleet-status/stop-hook.sh. Test 11 in remote-hook-install.test.ts
// asserts byte-exact equality against the on-disk file so drift is caught at
// test time. This constant exists because `tsc` compiles .ts → .js but does
// not copy sibling .sh assets into dist/, so a runtime readFileSync of the
// sibling stop-hook.sh fails with ENOENT on every deployed host.
export const STOP_HOOK_SCRIPT_CONTENTS = `#!/bin/bash
#
# Skynet fleet-status Stop hook — dropped onto each identity-hosting box by
# remote-hook-install.ts. Reads the Stop hook payload from stdin and writes
# it atomically to the well-known payload file, which the Skynet backend
# polls over SSH every 2s.
#
# MUST NOT block Claude Code — the hook fires synchronously during turn
# completion, so we do the minimum work possible: read stdin, atomic-write
# to disk, exit 0.
#
set -eu
PAYLOAD_DIR="\${HOME}/.claude/fleet-status"
PAYLOAD_FILE="\${PAYLOAD_DIR}/last-stop-payload.json"
TMP_FILE="\${PAYLOAD_FILE}.\$\$.tmp"
mkdir -p "\${PAYLOAD_DIR}"
# Belt-and-braces: wrap the write in a timeout so a full disk cannot hang
# the hook indefinitely. Fire-and-forget beyond this point.
timeout 2 sh -c "cat > '\${TMP_FILE}' && mv '\${TMP_FILE}' '\${PAYLOAD_FILE}'" || true
exit 0
`;

// ---------------------------------------------------------------------------
// readAndMergeStopHookSettings — PURE FUNCTION, no SSH
// ---------------------------------------------------------------------------

/**
 * Merge the fleet-status Stop hook entry into a settings object.
 *
 * Returns `{ merged, alreadyInstalled }`. If the entry is already present
 * (`command === remoteHookPath`), returns the input unchanged with
 * `alreadyInstalled: true`. Otherwise creates the three-level
 * hooks.Stop[0].hooks[] structure if needed and appends the entry.
 *
 * This function NEVER mutates its input — all spreads are shallow copies.
 */
export function readAndMergeStopHookSettings(
  currentSettings: Record<string, unknown>,
  remoteHookPath: string,
): MergeResult {
  // Check if already installed (any Stop[*].hooks[*].command matches)
  const hooks = currentSettings.hooks as Record<string, unknown> | undefined;
  if (hooks) {
    const Stop = hooks.Stop as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
    if (Array.isArray(Stop)) {
      for (const group of Stop) {
        if (Array.isArray(group?.hooks)) {
          for (const entry of group.hooks) {
            if (entry?.command === remoteHookPath) {
              return { merged: currentSettings, alreadyInstalled: true };
            }
          }
        }
      }
    }
  }

  // Not installed — merge the entry
  const newEntry = { type: "command", command: remoteHookPath };

  // Shallow-copy settings
  const merged: Record<string, unknown> = { ...currentSettings };

  // Ensure hooks exists
  const existingHooks = (merged.hooks as Record<string, unknown> | undefined) ?? {};
  const newHooks: Record<string, unknown> = { ...existingHooks };

  // Ensure Stop array exists
  const existingStop = (newHooks.Stop as Array<Record<string, unknown>> | undefined) ?? [];
  let newStop: Array<Record<string, unknown>>;

  if (existingStop.length === 0) {
    // Create the first group with our entry
    newStop = [{ hooks: [newEntry] }];
  } else {
    // Append to Stop[0].hooks (create hooks[] if missing)
    const firstGroup = { ...existingStop[0] };
    const existingGroupHooks = (firstGroup.hooks as Array<Record<string, unknown>> | undefined) ?? [];
    firstGroup.hooks = [...existingGroupHooks, newEntry];
    newStop = [firstGroup, ...existingStop.slice(1)];
  }

  newHooks.Stop = newStop;
  merged.hooks = newHooks;

  return { merged, alreadyInstalled: false };
}

// ---------------------------------------------------------------------------
// installStopHook
// ---------------------------------------------------------------------------

/**
 * Install the Stop hook on a remote host via the injected SSH channel.
 *
 * Steps:
 *   1. Use inlined STOP_HOOK_SCRIPT_CONTENTS (or dynamically read
 *      opts.localHookScriptPath if provided — test-only escape hatch).
 *   2. SSH mkdir -p for the hook dir and payload dir.
 *   3. Write hook script atomically via heredoc .tmp + mv + chmod +x.
 *   4. Verify: `test -x <remoteHookPath> && echo OK`.
 *   5. Read ~/.claude/settings.json; parse; call readAndMergeStopHookSettings.
 *   6. If alreadyInstalled → skip write; return { hookInstalled: true, settingsUpdated: false }.
 *   7. Otherwise write settings atomically via heredoc .tmp + mv.
 *   8. Log and return { hookInstalled: true, settingsUpdated: true }.
 *
 * Throws on SSH read error or invalid JSON in settings.json — these are
 * hard failures for the install step (poll loop is unaffected; install is
 * called out-of-band, not from inside the poll).
 */
export async function installStopHook(
  channel: SshChannel,
  opts: InstallOpts = {},
): Promise<InstallResult> {
  const legacyHookPath = opts.remoteHookPath ?? DEFAULT_REMOTE_HOOK_PATH;
  const legacyPayloadDir = opts.remotePayloadDir ?? DEFAULT_REMOTE_PAYLOAD_DIR;

  // Resolve remote $HOME once and substitute for `~/` prefix in the defaults.
  // bash suppresses tilde expansion inside DOUBLE-QUOTED shell strings, and
  // the mkdir/cat/mv/test commands below all quote their path arguments (safe
  // for paths with spaces). Without this substitution, `mkdir -p "~/.claude/..."`
  // creates a literal `~` subdirectory under cwd instead of expanding to
  // $HOME (patch #453 aftermath — file landed at /home/ubuntu/~/.claude/…).
  // Resolving to an absolute path also means settings.json stores an absolute
  // command (not `~/...`), which is what Claude Code's hook runner expects.
  const homeRaw = await channel.exec("echo $HOME");
  const home = homeRaw?.trim() ?? "";
  if (!home || home.startsWith("~") || !home.startsWith("/")) {
    systemLogger.warn(
      "Fleet-status: remote $HOME resolution failed",
      {
        operation: "fleet_status_hook_install_home_resolve_failed",
        homeRaw,
      },
    );
    throw new Error(
      `fleet_status_hook_install_home_resolve_failed: echo $HOME returned ${JSON.stringify(homeRaw)}`,
    );
  }
  const expandTilde = (p: string): string =>
    p.startsWith("~/") ? `${home}${p.slice(1)}` : p;

  const remoteHookPath = expandTilde(legacyHookPath);
  const remotePayloadDir = expandTilde(legacyPayloadDir);
  const remoteHookDir = remoteHookPath.replace(/\/[^/]+$/, ""); // dirname

  // Migration: remove the literal `~` subdirectory left by prior installs
  // where tilde was suppressed inside double-quoted shell strings (fleet
  // shipped by patch #453 before this fix). Belt-and-suspenders — even if
  // the settings.json merge below also strips the legacy entry, the on-disk
  // litter would confuse future maintainers. `rm -rf "$home/~"` is bounded
  // to a single directory name; ignored quietly if it doesn't exist.
  await channel.exec(`rm -rf "${home}/~"`);

  // Step 1: Resolve hook script contents.
  // Default path uses the inlined STOP_HOOK_SCRIPT_CONTENTS constant — no
  // filesystem read, no fs import at module load. The opts.localHookScriptPath
  // escape hatch (test-only) dynamically imports node:fs on demand so the
  // production install path pays zero fs import cost.
  let hookScriptContents: string;
  if (opts.localHookScriptPath) {
    const { readFileSync } = await import("node:fs");
    hookScriptContents = readFileSync(opts.localHookScriptPath, "utf-8");
  } else {
    hookScriptContents = STOP_HOOK_SCRIPT_CONTENTS;
  }

  // Step 2: mkdir for both directories
  await channel.exec(
    `mkdir -p "${remoteHookDir}" "${remotePayloadDir}"`,
  );

  // Step 3: Write hook script atomically via heredoc
  // We use a unique tmp path to avoid races; mv is atomic on POSIX.
  const writeScriptCmd = [
    `cat > "${remoteHookPath}.tmp" <<'STOPHOOK_EOF'`,
    hookScriptContents,
    `STOPHOOK_EOF`,
    `mv "${remoteHookPath}.tmp" "${remoteHookPath}" && chmod +x "${remoteHookPath}"`,
  ].join("\n");

  await channel.exec(writeScriptCmd);

  // Step 4: Verify the script is executable
  const verifyResult = await channel.exec(
    `test -x "${remoteHookPath}" && echo OK`,
  );
  if (verifyResult?.trim() !== "OK") {
    systemLogger.warn(
      "Fleet-status: hook script write verification failed",
      {
        operation: "fleet_status_hook_install_verify_failed",
        remoteHookPath,
      },
    );
    throw new Error(
      `Hook script write verification failed: test -x "${remoteHookPath}" did not return OK`,
    );
  }

  // Step 5: Read settings.json
  const settingsRaw = await channel.exec(
    `cat ~/.claude/settings.json 2>/dev/null`,
  );

  if (settingsRaw === null) {
    // SSH exec returned null = SSH-level error
    systemLogger.warn(
      "Fleet-status: SSH read of settings.json returned null",
      {
        operation: "fleet_status_hook_install_settings_read_failed",
        remoteHookPath,
      },
    );
    throw new Error(
      "fleet_status_hook_install_settings_read_failed: SSH exec returned null",
    );
  }

  // Empty = file doesn't exist yet; start fresh
  let currentSettings: Record<string, unknown> = {};
  if (settingsRaw.trim() !== "") {
    try {
      currentSettings = JSON.parse(settingsRaw) as Record<string, unknown>;
    } catch (err) {
      systemLogger.warn(
        "Fleet-status: settings.json contains invalid JSON — refusing to overwrite",
        {
          operation: "fleet_status_hook_install_settings_invalid_json",
          remoteHookPath,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      throw new Error(
        `fleet_status_hook_install_settings_invalid_json: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  // Step 6a: Migration — strip any legacy tilde-form Stop hook entry before
  // merging the new absolute-form entry. Boxes previously "installed" by
  // patch #453 (pre-tilde-fix) have `command: "~/.claude/hooks/..."` which
  // won't match the absolute `remoteHookPath` we merge below; leaving it
  // would create a duplicate Stop hook entry. Only strip when the substitution
  // actually happened (legacyHookPath !== remoteHookPath).
  let settingsForMerge: Record<string, unknown> = currentSettings;
  if (legacyHookPath !== remoteHookPath) {
    const hooks = currentSettings.hooks as Record<string, unknown> | undefined;
    const Stop = hooks?.Stop as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
    if (Array.isArray(Stop)) {
      const strippedStop = Stop.map((group) => {
        if (!Array.isArray(group.hooks)) return group;
        return {
          ...group,
          hooks: group.hooks.filter((e) => e.command !== legacyHookPath),
        };
      });
      settingsForMerge = {
        ...currentSettings,
        hooks: { ...(hooks ?? {}), Stop: strippedStop },
      };
    }
  }

  // Step 6b: Merge (pure, no mutation)
  const { merged, alreadyInstalled } = readAndMergeStopHookSettings(
    settingsForMerge,
    remoteHookPath,
  );

  if (alreadyInstalled) {
    systemLogger.info(
      "Fleet-status: Stop hook already present in settings.json — skipping write",
      {
        operation: "fleet_status_hook_install_already_present",
        remoteHookPath,
      },
    );
    return { hookInstalled: true, settingsUpdated: false };
  }

  // Step 7: Write settings atomically via heredoc .tmp + mv
  const settingsJson = JSON.stringify(merged, null, 2);
  const writeSettingsCmd = [
    `cat > ~/.claude/settings.json.tmp.$$ <<'SETTINGS_EOF'`,
    settingsJson,
    `SETTINGS_EOF`,
    `mv ~/.claude/settings.json.tmp.$$ ~/.claude/settings.json`,
  ].join("\n");

  await channel.exec(writeSettingsCmd);

  // Step 8: Log + return
  systemLogger.info(
    "Fleet-status: Stop hook installed and settings.json updated",
    {
      operation: "fleet_status_hook_install_complete",
      remoteHookPath,
    },
  );

  return { hookInstalled: true, settingsUpdated: true };
}

// ---------------------------------------------------------------------------
// uninstallStopHook
// ---------------------------------------------------------------------------

/**
 * Remove the Stop hook entry from ~/.claude/settings.json and delete the
 * hook script from the remote host.
 *
 * Does NOT remove the payload directory or payload file — the operator may
 * want to inspect the last-captured payload for post-mortem after uninstall.
 */
export async function uninstallStopHook(
  channel: SshChannel,
  opts: InstallOpts = {},
): Promise<void> {
  const remoteHookPath = opts.remoteHookPath ?? DEFAULT_REMOTE_HOOK_PATH;

  // Read current settings.json
  const settingsRaw = await channel.exec(
    `cat ~/.claude/settings.json 2>/dev/null`,
  );

  if (settingsRaw === null) {
    systemLogger.warn(
      "Fleet-status: SSH read of settings.json returned null during uninstall",
      {
        operation: "fleet_status_hook_uninstall_settings_read_failed",
        remoteHookPath,
      },
    );
    return; // best-effort
  }

  if (settingsRaw.trim() === "") {
    // No settings file — nothing to remove
    systemLogger.info(
      "Fleet-status: settings.json empty/missing during uninstall — nothing to remove",
      {
        operation: "fleet_status_hook_uninstall_noop",
        remoteHookPath,
      },
    );
  } else {
    let currentSettings: Record<string, unknown>;
    try {
      currentSettings = JSON.parse(settingsRaw) as Record<string, unknown>;
    } catch (err) {
      systemLogger.warn(
        "Fleet-status: settings.json invalid JSON during uninstall — skipping settings edit",
        {
          operation: "fleet_status_hook_uninstall_invalid_json",
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      currentSettings = {}; // will proceed to rm only
    }

    // Remove any entry with matching command in hooks.Stop[*].hooks[*]
    const hooks = currentSettings.hooks as Record<string, unknown> | undefined;
    if (hooks) {
      const Stop = hooks.Stop as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
      if (Array.isArray(Stop)) {
        const newStop = Stop.map((group) => {
          if (!Array.isArray(group.hooks)) return group;
          return {
            ...group,
            hooks: group.hooks.filter((e) => e.command !== remoteHookPath),
          };
        });

        const mutated: Record<string, unknown> = {
          ...currentSettings,
          hooks: { ...hooks, Stop: newStop },
        };

        // Write back atomically
        const settingsJson = JSON.stringify(mutated, null, 2);
        const writeCmd = [
          `cat > ~/.claude/settings.json.tmp.$$ <<'SETTINGS_EOF'`,
          settingsJson,
          `SETTINGS_EOF`,
          `mv ~/.claude/settings.json.tmp.$$ ~/.claude/settings.json`,
        ].join("\n");

        await channel.exec(writeCmd);

        systemLogger.info(
          "Fleet-status: Stop hook entry removed from settings.json",
          {
            operation: "fleet_status_hook_uninstall_settings_updated",
            remoteHookPath,
          },
        );
      }
    }
  }

  // Remove the hook script (payload dir + file intentionally preserved)
  await channel.exec(`rm -f "${remoteHookPath}"`);

  systemLogger.info("Fleet-status: Stop hook uninstalled", {
    operation: "fleet_status_hook_uninstall_complete",
    remoteHookPath,
  });
}
