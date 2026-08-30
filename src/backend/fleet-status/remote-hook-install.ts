/**
 * remote-hook-install.ts — One-time-per-host fleet-status hook install helper.
 *
 * ## Purpose (Phase 62 extended shape)
 * Installs THREE fleet-status hook scripts onto an identity-hosting box by:
 *   (a) Dropping THREE .sh scripts atomically over SSH (`.tmp` + `mv` + `chmod +x`):
 *         - `stop-hook.sh`     at ~/.claude/hooks/skynet-fleet-status-stop.sh
 *           (unchanged — still writes the box-wide + per-session background-tasks
 *           payload for the orthogonal Phase 59 consumer path).
 *         - `activity-hook.sh` at ~/.claude/hooks/skynet-fleet-status-activity.sh
 *           (Phase 62 — touches per-session `activity` marker on UserPromptSubmit
 *           + PreToolUse events; feeds `activity_mtime > stopped_mtime` predicate).
 *         - `stopped-hook.sh`  at ~/.claude/hooks/skynet-fleet-status-stopped.sh
 *           (Phase 62 — touches per-session `stopped` marker on Stop + StopFailure
 *           + PermissionRequest events; is the RHS of the predicate above).
 *   (b) SSH-reading ~/.claude/settings.json, merging SIX hook entries in-memory
 *       (idempotent — no-op on second run), and writing back atomically via
 *       heredoc .tmp + mv:
 *         - hooks.Stop[]              ← stop-hook  (existing, unchanged)
 *         - hooks.Stop[]              ← stopped-hook (Phase 62 — Stop fires BOTH)
 *         - hooks.UserPromptSubmit[]  ← activity-hook
 *         - hooks.PreToolUse[]        ← activity-hook
 *         - hooks.StopFailure[]       ← stopped-hook
 *         - hooks.PermissionRequest[] ← stopped-hook
 *   (c) Protecting ~/.claude/settings.json from clobbering if it contains
 *       invalid JSON — log + throw rather than overwriting.
 *
 * ## Retained function name (starter.ts callsite compat)
 * The public export stays `installStopHook` — the single callsite in
 * src/backend/starter.ts line 249 does not need to change. The name has
 * historical value; the shape now includes activity + stopped alongside stop.
 *
 * ## D-CTX § PIVOT 2026-08-13 (LOCKED)
 * This module is a one-time install helper, NOT a persistent process.
 * The ssh-poll-orchestrator calls this once per newly-discovered identity-hosting
 * host. It does not run continuously.
 *
 * ## Settings.json hook registration schema (RESEARCH §2)
 * Three-level nesting per hook event:
 *   hooks.<Event>[0].hooks[N] = { type: 'command', command: '<path>' }
 * Hooks MERGE across levels (they do not override). Our entries append to
 * <Event>[0].hooks[] — if <Event>[0] doesn't exist we create the minimal
 * structure. Preserves any third-party entries already present in the same
 * hooks[] group (shallow-copy discipline in readAndMergeHookSettings).
 *
 * ## Import pattern for the three .sh scripts
 * All three shell script contents are inlined at module load as constants
 * (STOP_HOOK_SCRIPT_CONTENTS, ACTIVITY_HOOK_SCRIPT_CONTENTS,
 * STOPPED_HOOK_SCRIPT_CONTENTS) — no runtime filesystem read is required for
 * the default install path. This eliminates a fleet-wide ENOENT bug caused
 * by `tsc` not copying `.sh` sibling assets into `dist/`. The
 * `opts.localHookScriptPath` escape hatch is retained for tests and uses a
 * dynamic `node:fs` import so the production path pays no fs import cost.
 * Byte-drift detection tests in remote-hook-install.test.ts assert each
 * constant is byte-identical to its sibling .sh file.
 */
import { systemLogger } from "../utils/logger.js";
import type { SshChannel } from "./ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOpts {
  /** Remote path where the stop-hook script is dropped. Default: ~/.claude/hooks/skynet-fleet-status-stop.sh */
  remoteHookPath?: string;
  /** Remote path where the activity-hook script is dropped. Default: ~/.claude/hooks/skynet-fleet-status-activity.sh */
  remoteActivityHookPath?: string;
  /** Remote path where the stopped-hook script is dropped. Default: ~/.claude/hooks/skynet-fleet-status-stopped.sh */
  remoteStoppedHookPath?: string;
  /** Remote directory for the (legacy) payload file. Default: ~/.claude/fleet-status */
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
const DEFAULT_REMOTE_ACTIVITY_HOOK_PATH =
  "~/.claude/hooks/skynet-fleet-status-activity.sh";
const DEFAULT_REMOTE_STOPPED_HOOK_PATH =
  "~/.claude/hooks/skynet-fleet-status-stopped.sh";
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
# Phase 59 Plan 01 (2026-08-29): additive per-session file write. In addition
# to the existing box-wide payload file (which continues to carry
# background-tasks for the box-wide consumer path), we also atomic-write a
# per-session file keyed on the session identifier extracted from the piped
# stdin JSON. The per-session file's mtime becomes the backend's lastStopAt
# signal for the WIP-shell-idle-gate predicate.
#
# The session identifier is extracted via a strict bash regex whose character
# class rejects any path-traversal metacharacter. Extraction failure is
# fail-open: the box-wide write still fires unconditionally, and the hook
# still exits 0. This is a Tampering defense (T-59-01-01): an attacker-
# controlled session identifier cannot escape to arbitrary paths.
#
# The interpreter of the inner block is bash (not sh) because the regex
# operator is bash-specific (not POSIX-portable to dash/ash). The outer
# script's shebang already guarantees bash is available on every managed
# box (per remote-hook-install.ts install path).
#
set -eu
PAYLOAD_DIR="\${HOME}/.claude/fleet-status"
PAYLOAD_FILE="\${PAYLOAD_DIR}/last-stop-payload.json"
BOX_TMP_FILE="\${PAYLOAD_FILE}.\$\$.tmp"
mkdir -p "\${PAYLOAD_DIR}"
# Belt-and-braces: wrap the write in a timeout so a full disk cannot hang
# the hook indefinitely. Fire-and-forget beyond this point.
timeout 2 bash -c '
  payload="\$(cat)"
  # Box-wide write (unchanged behavior — carries background-tasks for the
  # existing box-wide consumer path). MUST fire unconditionally, before the
  # per-session extraction, so a malformed/missing session identifier never
  # blocks the box-wide file.
  printf "%s" "\$payload" > "'"\${BOX_TMP_FILE}"'" && mv "'"\${BOX_TMP_FILE}"'" "'"\${PAYLOAD_FILE}"'"
  # Phase 59: extract session identifier via strict bash regex. The character
  # class is the Tampering defense — any other character fails the match and
  # skips the per-session write.
  if [[ "\$payload" =~ \\"session_id\\"[[:space:]]*:[[:space:]]*\\"([a-zA-Z0-9_-]+)\\" ]]; then
    sid="\${BASH_REMATCH[1]}"
    per_session_file="'"\${PAYLOAD_DIR}"'/stop-\${sid}.json"
    per_session_tmp="\${per_session_file}.\$\$.tmp"
    printf "%s" "\$payload" > "\$per_session_tmp" && mv "\$per_session_tmp" "\$per_session_file"
  fi
' || true
exit 0
`;

// SOURCE OF TRUTH: keep this string byte-for-byte in sync with
// src/backend/fleet-status/activity-hook.sh. The drift-detection test in
// remote-hook-install.test.ts asserts byte-exact equality against the on-disk
// file so drift is caught at test time (mirrors STOP_HOOK_SCRIPT_CONTENTS
// pattern — Test 11 above). This constant exists because `tsc` compiles
// .ts → .js but does not copy sibling .sh assets into dist/, so a runtime
// readFileSync of the sibling activity-hook.sh fails with ENOENT on every
// deployed host.
export const ACTIVITY_HOOK_SCRIPT_CONTENTS = `#!/bin/bash
#
# Skynet fleet-status Activity hook — dropped onto each identity-hosting box
# by remote-hook-install.ts (Plan 62-02). Reads the harness JSON payload from
# stdin and atomic-touches the per-session activity marker file, whose mtime
# is read by the Skynet backend over SSH (via \`stat -c %Y\`) to answer the
# affordance's one question: "should Ashley look at this row?"
#
# Wired by Plan 62-02's installer to BOTH of these settings.json hooks:
#   - hooks.UserPromptSubmit[0].hooks[]  (Ashley submitted a prompt)
#   - hooks.PreToolUse[0].hooks[]         (agent began invoking a tool)
# This script is EVENT-AGNOSTIC — it does not branch on hook_event_name; the
# installer's routing (which events pipe to this script) is the entire event
# discrimination. Both events mean "activity happened, touch the marker."
#
# Marker path convention (matches stopped-hook.sh — Plan 62-03's backend
# predicate depends on the per-session directory invariant that BOTH scripts
# write into the same \${HOME}/.claude/fleet-status/hooks/<sid>/ dir, with only
# the filename differing: \`activity\` vs \`stopped\`):
#   \${HOME}/.claude/fleet-status/hooks/<sid>/activity
#
# Shape file: .planning/shapes/shape-wip-indicator-hook-based-rewrite.md.
# The predicate the Plan 62-03 backend evaluates:
#   activity_marker_mtime > stopped_marker_mtime → working (affordance lit)
# is what this script feeds. No smoothing, no state machine — just a fresh
# mtime on every activity event.
#
# MUST NOT block Claude Code — the hook fires synchronously during the turn
# lifecycle. All work is wrapped in \`timeout 2 bash -c '...' || true\` so a full
# disk or unreachable filesystem cannot hang the harness turn indefinitely.
#
# Path-traversal defense (T-62-01-01 Tampering): session_id is extracted from
# the piped stdin JSON via a strict bash regex whose character class rejects
# any path-traversal metacharacter (mirrors stop-hook.sh line 47). Any other
# character — \`/\`, \`.\`, \`..\`, \`\\\`, \`\$\`, \`\\\`\`, \`;\`, \`(\`, \`)\`, \`&\`, \`|\`, \`>\`,
# \`<\`, whitespace — fails the regex match and skips the touch entirely
# (fail-open: exit 0 with no marker created).
#
# The interpreter of the inner block is bash (not sh) because the \`=~\` regex
# operator is bash-specific (not POSIX-portable to dash/ash). The outer
# script's shebang already guarantees bash is available on every managed box.
#
set -eu
MARKER_ROOT="\${HOME}/.claude/fleet-status/hooks"
mkdir -p "\${MARKER_ROOT}"
# Belt-and-braces: wrap the extract-and-touch in a timeout so a full disk or
# unreachable filesystem cannot hang the hook indefinitely. Fire-and-forget
# beyond this point — inner failure is swallowed by \`|| true\`, outer \`exit 0\`
# fires unconditionally.
timeout 2 bash -c '
  payload="\$(cat)"
  # Extract session_id via strict bash regex. The character class is the
  # Tampering defense — any other character fails the match and skips the
  # touch. Mirrors stop-hook.sh line 47 verbatim.
  if [[ "\$payload" =~ \\"session_id\\"[[:space:]]*:[[:space:]]*\\"([a-zA-Z0-9_-]+)\\" ]]; then
    sid="\${BASH_REMATCH[1]}"
    session_dir="'"\${MARKER_ROOT}"'/\${sid}"
    mkdir -p "\$session_dir"
    touch "\${session_dir}/activity"
  fi
' || true
exit 0
`;

// SOURCE OF TRUTH: keep this string byte-for-byte in sync with
// src/backend/fleet-status/stopped-hook.sh. The drift-detection test in
// remote-hook-install.test.ts asserts byte-exact equality against the on-disk
// file so drift is caught at test time (mirrors STOP_HOOK_SCRIPT_CONTENTS
// pattern — Test 11 above). This constant exists because `tsc` compiles
// .ts → .js but does not copy sibling .sh assets into dist/, so a runtime
// readFileSync of the sibling stopped-hook.sh fails with ENOENT on every
// deployed host.
export const STOPPED_HOOK_SCRIPT_CONTENTS = `#!/bin/bash
#
# Skynet fleet-status Stopped hook — dropped onto each identity-hosting box
# by remote-hook-install.ts (Plan 62-02). Reads the harness JSON payload from
# stdin and atomic-touches the per-session STOPPED marker file, whose mtime
# is read by the Skynet backend over SSH (via \`stat -c %Y\`) to answer the
# affordance's one question: "should Ashley look at this row?"
#
# Wired by Plan 62-02's installer to ALL THREE of these settings.json hooks:
#   - hooks.Stop[0].hooks[]              (turn finished cleanly)
#   - hooks.StopFailure[0].hooks[]       (turn ended in error)
#   - hooks.PermissionRequest[0].hooks[] (agent blocked waiting on Ashley)
#
# The last one is a deliberate design choice per the shape file: from the
# affordance's perspective, "agent is waiting on you" is the same as "agent
# is done" — both mean the row deserves Ashley's attention right now. This
# script is EVENT-AGNOSTIC — it does not branch on hook_event_name; the
# installer's routing (which events pipe to this script) is the entire event
# discrimination.
#
# Marker path convention (matches activity-hook.sh — Plan 62-03's backend
# predicate depends on the per-session directory invariant that BOTH scripts
# write into the same \${HOME}/.claude/fleet-status/hooks/<sid>/ dir, with only
# the filename differing: \`stopped\` vs \`activity\`):
#   \${HOME}/.claude/fleet-status/hooks/<sid>/stopped
#
# Shape file: .planning/shapes/shape-wip-indicator-hook-based-rewrite.md.
# The predicate the Plan 62-03 backend evaluates:
#   activity_marker_mtime > stopped_marker_mtime → working (affordance lit)
# is what this script feeds (as the RHS of the comparison). Every Stop /
# StopFailure / PermissionRequest bumps this marker's mtime; the affordance
# goes dark unless a later activity-hook firing bumps its marker past ours.
#
# This script does NOT write to any legacy payload path — the old Phase 59
# per-session file at ~/.claude/fleet-status/stop-<sid>.json and the box-wide
# ~/.claude/fleet-status/last-stop-payload.json remain the responsibility of
# the legacy stop-hook.sh, which stays installed alongside this new script
# during the migration window (Plan 62-02 installer merges BOTH entries into
# hooks.Stop). The background-tasks-list consumer path is orthogonal and out
# of Phase 62's mutation scope per shape §Out of scope.
#
# MUST NOT block Claude Code — the hook fires synchronously during the turn
# lifecycle. All work is wrapped in \`timeout 2 bash -c '...' || true\` so a full
# disk or unreachable filesystem cannot hang the harness turn indefinitely.
#
# Path-traversal defense (T-62-01-01 Tampering): session_id is extracted from
# the piped stdin JSON via a strict bash regex whose character class rejects
# any path-traversal metacharacter (mirrors stop-hook.sh line 47). Any other
# character — \`/\`, \`.\`, \`..\`, \`\\\`, \`\$\`, \`\\\`\`, \`;\`, \`(\`, \`)\`, \`&\`, \`|\`, \`>\`,
# \`<\`, whitespace — fails the regex match and skips the touch entirely
# (fail-open: exit 0 with no marker created).
#
# The interpreter of the inner block is bash (not sh) because the \`=~\` regex
# operator is bash-specific (not POSIX-portable to dash/ash). The outer
# script's shebang already guarantees bash is available on every managed box.
#
set -eu
MARKER_ROOT="\${HOME}/.claude/fleet-status/hooks"
mkdir -p "\${MARKER_ROOT}"
# Belt-and-braces: wrap the extract-and-touch in a timeout so a full disk or
# unreachable filesystem cannot hang the hook indefinitely. Fire-and-forget
# beyond this point — inner failure is swallowed by \`|| true\`, outer \`exit 0\`
# fires unconditionally.
timeout 2 bash -c '
  payload="\$(cat)"
  # Extract session_id via strict bash regex. The character class is the
  # Tampering defense — any other character fails the match and skips the
  # touch. Mirrors stop-hook.sh line 47 verbatim.
  if [[ "\$payload" =~ \\"session_id\\"[[:space:]]*:[[:space:]]*\\"([a-zA-Z0-9_-]+)\\" ]]; then
    sid="\${BASH_REMATCH[1]}"
    session_dir="'"\${MARKER_ROOT}"'/\${sid}"
    mkdir -p "\$session_dir"
    touch "\${session_dir}/stopped"
  fi
' || true
exit 0
`;

// ---------------------------------------------------------------------------
// readAndMergeHookSettings — PURE FUNCTION, no SSH (Phase 62 generalized)
// ---------------------------------------------------------------------------

/**
 * Merge a fleet-status hook entry into a settings object at the specified
 * hook event key (`Stop`, `UserPromptSubmit`, `PreToolUse`, `StopFailure`,
 * `PermissionRequest`, or any other Claude Code hook event name).
 *
 * Returns `{ merged, alreadyInstalled }`. If any entry already present in
 * `hooks.<hookEventName>[*].hooks[*]` has `command === remoteHookPath`, returns
 * the input unchanged with `alreadyInstalled: true`. Otherwise creates the
 * three-level `hooks.<hookEventName>[0].hooks[]` structure if needed and
 * appends the entry — preserving any third-party entries already present in
 * the same hooks[] group (shallow-copy discipline).
 *
 * This function NEVER mutates its input — all spreads are shallow copies.
 * Callers thread the returned `merged` object through successive calls to
 * accumulate merges across multiple hook events (see installStopHook step 6b).
 */
export function readAndMergeHookSettings(
  currentSettings: Record<string, unknown>,
  hookEventName: string,
  remoteHookPath: string,
): MergeResult {
  // Check if already installed (any hooks[hookEventName][*].hooks[*].command matches)
  const hooks = currentSettings.hooks as Record<string, unknown> | undefined;
  if (hooks) {
    const eventArr = hooks[hookEventName] as
      | Array<{ hooks?: Array<{ command?: string }> }>
      | undefined;
    if (Array.isArray(eventArr)) {
      for (const group of eventArr) {
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

  // Ensure event array exists
  const existingEventArr =
    (newHooks[hookEventName] as Array<Record<string, unknown>> | undefined) ?? [];
  let newEventArr: Array<Record<string, unknown>>;

  if (existingEventArr.length === 0) {
    // Create the first group with our entry
    newEventArr = [{ hooks: [newEntry] }];
  } else {
    // Append to <event>[0].hooks (create hooks[] if missing)
    const firstGroup = { ...existingEventArr[0] };
    const existingGroupHooks =
      (firstGroup.hooks as Array<Record<string, unknown>> | undefined) ?? [];
    firstGroup.hooks = [...existingGroupHooks, newEntry];
    newEventArr = [firstGroup, ...existingEventArr.slice(1)];
  }

  newHooks[hookEventName] = newEventArr;
  merged.hooks = newHooks;

  return { merged, alreadyInstalled: false };
}

// ---------------------------------------------------------------------------
// readAndMergeStopHookSettings — back-compat façade over readAndMergeHookSettings
// ---------------------------------------------------------------------------

/**
 * Legacy Stop-key-hardcoded facade retained for back-compat with existing
 * unit tests (Tests 3, 5, 6, 7 in remote-hook-install.test.ts) and any
 * external caller. Delegates to `readAndMergeHookSettings` with the "Stop"
 * event key. New code should call `readAndMergeHookSettings` directly.
 */
export function readAndMergeStopHookSettings(
  currentSettings: Record<string, unknown>,
  remoteHookPath: string,
): MergeResult {
  return readAndMergeHookSettings(currentSettings, "Stop", remoteHookPath);
}

// ---------------------------------------------------------------------------
// installStopHook (retained name — starter.ts callsite compat; extended shape)
// ---------------------------------------------------------------------------

/**
 * Install the fleet-status hook set on a remote host via the injected SSH
 * channel. Drops THREE scripts + merges SIX settings.json hook entries.
 *
 * Steps:
 *   1. Resolve remote $HOME once (tilde-expand `~/…` defaults to absolute
 *      paths so shell double-quoted args resolve correctly — patch #453/#454).
 *   2. Legacy-litter cleanup: `rm -rf "$HOME/~"` reaps the literal `~` subdir
 *      left by pre-#454 installs.
 *   3. mkdir -p for hook dir + payload dir.
 *   4. Drop THREE scripts atomically via heredoc `.tmp` + `mv` + `chmod +x`
 *      (distinct heredoc sentinels per script — STOPHOOK_EOF, ACTIVITY_HOOK_EOF,
 *      STOPPED_HOOK_EOF — so one script's contents cannot prematurely close
 *      another's heredoc).
 *   5. Verify ALL THREE scripts are executable via `test -x`; throw with a
 *      script-specific error message on any failure (so operators can diagnose
 *      partial-install states).
 *   6. Read ~/.claude/settings.json; parse; migrate legacy tilde-form entry
 *      (if any); call readAndMergeHookSettings SIX times, threading the merged
 *      object through each call to accumulate:
 *        - Stop[]              ← stop-hook path       (existing)
 *        - Stop[]              ← stopped-hook path    (Phase 62; Stop fires BOTH)
 *        - UserPromptSubmit[]  ← activity-hook path   (Phase 62)
 *        - PreToolUse[]        ← activity-hook path   (Phase 62)
 *        - StopFailure[]       ← stopped-hook path    (Phase 62)
 *        - PermissionRequest[] ← stopped-hook path    (Phase 62)
 *   7. If ALL SIX merges report alreadyInstalled=true → skip write; return
 *      { hookInstalled: true, settingsUpdated: false } (idempotency invariant).
 *   8. Otherwise write final merged settings atomically via heredoc .tmp + mv.
 *   9. Log with forensic fields for all three remote paths and return.
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
  const legacyActivityHookPath =
    opts.remoteActivityHookPath ?? DEFAULT_REMOTE_ACTIVITY_HOOK_PATH;
  const legacyStoppedHookPath =
    opts.remoteStoppedHookPath ?? DEFAULT_REMOTE_STOPPED_HOOK_PATH;
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
  const remoteActivityHookPath = expandTilde(legacyActivityHookPath);
  const remoteStoppedHookPath = expandTilde(legacyStoppedHookPath);
  const remotePayloadDir = expandTilde(legacyPayloadDir);
  const remoteHookDir = remoteHookPath.replace(/\/[^/]+$/, ""); // dirname

  // Migration: remove the literal `~` subdirectory left by prior installs
  // where tilde was suppressed inside double-quoted shell strings (fleet
  // shipped by patch #453 before this fix). Belt-and-suspenders — even if
  // the settings.json merge below also strips the legacy entry, the on-disk
  // litter would confuse future maintainers. `rm -rf "$home/~"` is bounded
  // to a single directory name; ignored quietly if it doesn't exist.
  await channel.exec(`rm -rf "${home}/~"`);

  // Step 1: Resolve stop-hook script contents. Activity + stopped-hook
  // contents always come from the inlined constants (no localHookScriptPath
  // escape hatch for them — the escape hatch predates Phase 62 and is Stop-
  // only).
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
  const activityHookScriptContents = ACTIVITY_HOOK_SCRIPT_CONTENTS;
  const stoppedHookScriptContents = STOPPED_HOOK_SCRIPT_CONTENTS;

  // Step 2: mkdir for both directories
  await channel.exec(
    `mkdir -p "${remoteHookDir}" "${remotePayloadDir}"`,
  );

  // Step 3: Write THREE hook scripts atomically via heredoc.
  // Distinct heredoc sentinels per script (STOPHOOK_EOF, ACTIVITY_HOOK_EOF,
  // STOPPED_HOOK_EOF) prevent the theoretical case where one script's contents
  // contain another's sentinel string — mitigation for T-62-02-04.
  // We use a unique tmp path to avoid races; mv is atomic on POSIX.
  const writeStopScriptCmd = [
    `cat > "${remoteHookPath}.tmp" <<'STOPHOOK_EOF'`,
    hookScriptContents,
    `STOPHOOK_EOF`,
    `mv "${remoteHookPath}.tmp" "${remoteHookPath}" && chmod +x "${remoteHookPath}"`,
  ].join("\n");
  await channel.exec(writeStopScriptCmd);

  const writeActivityScriptCmd = [
    `cat > "${remoteActivityHookPath}.tmp" <<'ACTIVITY_HOOK_EOF'`,
    activityHookScriptContents,
    `ACTIVITY_HOOK_EOF`,
    `mv "${remoteActivityHookPath}.tmp" "${remoteActivityHookPath}" && chmod +x "${remoteActivityHookPath}"`,
  ].join("\n");
  await channel.exec(writeActivityScriptCmd);

  const writeStoppedScriptCmd = [
    `cat > "${remoteStoppedHookPath}.tmp" <<'STOPPED_HOOK_EOF'`,
    stoppedHookScriptContents,
    `STOPPED_HOOK_EOF`,
    `mv "${remoteStoppedHookPath}.tmp" "${remoteStoppedHookPath}" && chmod +x "${remoteStoppedHookPath}"`,
  ].join("\n");
  await channel.exec(writeStoppedScriptCmd);

  // Step 4: Verify ALL THREE scripts are executable. Script-specific error
  // messages so operators can diagnose partial-install states (T-62-02-05
  // mitigation).
  const verifyPairs: Array<{ label: string; path: string }> = [
    { label: "stop-hook", path: remoteHookPath },
    { label: "activity-hook", path: remoteActivityHookPath },
    { label: "stopped-hook", path: remoteStoppedHookPath },
  ];
  for (const { label, path } of verifyPairs) {
    const verifyResult = await channel.exec(`test -x "${path}" && echo OK`);
    if (verifyResult?.trim() !== "OK") {
      systemLogger.warn(
        "Fleet-status: hook script write verification failed",
        {
          operation: "fleet_status_hook_install_verify_failed",
          scriptLabel: label,
          remoteScriptPath: path,
        },
      );
      throw new Error(
        `Hook script write verification failed: test -x "${path}" (${label}) did not return OK`,
      );
    }
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
  // actually happened (legacyHookPath !== remoteHookPath). Note: only the
  // stop-hook has a legacy tilde-form to migrate; the Phase-62 activity/
  // stopped-hook entries never existed pre-tilde-fix.
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

  // Step 6b: Merge SIX times, threading the running merged object through
  // each call. `allAlreadyInstalled` is the AND of all six merge results —
  // if every single merge reports the entry already present, we skip the
  // settings write entirely (idempotency invariant per plan §Behavior).
  const mergePlan: Array<{ event: string; path: string }> = [
    { event: "Stop", path: remoteHookPath },
    { event: "Stop", path: remoteStoppedHookPath },
    { event: "UserPromptSubmit", path: remoteActivityHookPath },
    { event: "PreToolUse", path: remoteActivityHookPath },
    { event: "StopFailure", path: remoteStoppedHookPath },
    { event: "PermissionRequest", path: remoteStoppedHookPath },
  ];
  let running: Record<string, unknown> = settingsForMerge;
  let allAlreadyInstalled = true;
  for (const { event, path } of mergePlan) {
    const { merged, alreadyInstalled } = readAndMergeHookSettings(
      running,
      event,
      path,
    );
    running = merged;
    if (!alreadyInstalled) {
      allAlreadyInstalled = false;
    }
  }

  if (allAlreadyInstalled) {
    systemLogger.info(
      "Fleet-status: all six hook entries already present in settings.json — skipping write",
      {
        operation: "fleet_status_hook_install_already_present",
        remoteHookPath,
        remoteActivityHookPath,
        remoteStoppedHookPath,
      },
    );
    return { hookInstalled: true, settingsUpdated: false };
  }

  // Step 7: Write settings atomically via heredoc .tmp + mv
  const settingsJson = JSON.stringify(running, null, 2);
  const writeSettingsCmd = [
    `cat > ~/.claude/settings.json.tmp.$$ <<'SETTINGS_EOF'`,
    settingsJson,
    `SETTINGS_EOF`,
    `mv ~/.claude/settings.json.tmp.$$ ~/.claude/settings.json`,
  ].join("\n");

  await channel.exec(writeSettingsCmd);

  // Step 8: Log + return
  systemLogger.info(
    "Fleet-status: hook set installed and settings.json updated",
    {
      operation: "fleet_status_hook_install_complete",
      remoteHookPath,
      remoteActivityHookPath,
      remoteStoppedHookPath,
    },
  );

  return { hookInstalled: true, settingsUpdated: true };
}

// ---------------------------------------------------------------------------
// uninstallStopHook (extended for Phase 62 — removes ALL FIVE hook entries
// and deletes ALL THREE remote script files)
// ---------------------------------------------------------------------------

/**
 * Remove ALL FIVE fleet-status hook entries from ~/.claude/settings.json and
 * delete ALL THREE hook script files from the remote host:
 *   - hooks.Stop entries matching stop-hook path OR stopped-hook path
 *   - hooks.UserPromptSubmit entries matching activity-hook path
 *   - hooks.PreToolUse entries matching activity-hook path
 *   - hooks.StopFailure entries matching stopped-hook path
 *   - hooks.PermissionRequest entries matching stopped-hook path
 *
 * Does NOT remove the payload directory or payload file — the operator may
 * want to inspect the last-captured payload for post-mortem after uninstall.
 * The per-session marker directory (~/.claude/fleet-status/hooks/<sid>/) is
 * likewise preserved so a partial-uninstall post-mortem can still read the
 * final marker mtimes.
 */
export async function uninstallStopHook(
  channel: SshChannel,
  opts: InstallOpts = {},
): Promise<void> {
  const remoteHookPath = opts.remoteHookPath ?? DEFAULT_REMOTE_HOOK_PATH;
  const remoteActivityHookPath =
    opts.remoteActivityHookPath ?? DEFAULT_REMOTE_ACTIVITY_HOOK_PATH;
  const remoteStoppedHookPath =
    opts.remoteStoppedHookPath ?? DEFAULT_REMOTE_STOPPED_HOOK_PATH;

  // Map hook event key → set of paths whose entries should be removed from
  // that event's hooks[] array. Mirrors the install-side mergePlan.
  const removePlan: Record<string, Set<string>> = {
    Stop: new Set([remoteHookPath, remoteStoppedHookPath]),
    UserPromptSubmit: new Set([remoteActivityHookPath]),
    PreToolUse: new Set([remoteActivityHookPath]),
    StopFailure: new Set([remoteStoppedHookPath]),
    PermissionRequest: new Set([remoteStoppedHookPath]),
  };

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

    // Remove any matching entries across all five hook event keys
    const hooks = currentSettings.hooks as Record<string, unknown> | undefined;
    if (hooks) {
      const mutatedHooks: Record<string, unknown> = { ...hooks };
      let anyMutation = false;
      for (const [eventName, pathsToRemove] of Object.entries(removePlan)) {
        const eventArr = hooks[eventName] as
          | Array<{ hooks?: Array<{ command?: string }> }>
          | undefined;
        if (!Array.isArray(eventArr)) continue;
        const newArr = eventArr.map((group) => {
          if (!Array.isArray(group.hooks)) return group;
          return {
            ...group,
            hooks: group.hooks.filter(
              (e) => !e.command || !pathsToRemove.has(e.command),
            ),
          };
        });
        mutatedHooks[eventName] = newArr;
        anyMutation = true;
      }

      if (anyMutation) {
        const mutated: Record<string, unknown> = {
          ...currentSettings,
          hooks: mutatedHooks,
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
          "Fleet-status: hook entries removed from settings.json",
          {
            operation: "fleet_status_hook_uninstall_settings_updated",
            remoteHookPath,
            remoteActivityHookPath,
            remoteStoppedHookPath,
          },
        );
      }
    }
  }

  // Remove ALL THREE hook scripts (payload dir + per-session marker dir
  // intentionally preserved for post-mortem inspection).
  await channel.exec(
    `rm -f "${remoteHookPath}" "${remoteActivityHookPath}" "${remoteStoppedHookPath}"`,
  );

  systemLogger.info("Fleet-status: hook set uninstalled", {
    operation: "fleet_status_hook_uninstall_complete",
    remoteHookPath,
    remoteActivityHookPath,
    remoteStoppedHookPath,
  });
}
