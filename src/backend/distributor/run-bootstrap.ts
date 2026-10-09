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
 *   1b. interactive-messages-gc.timer enable (Phase 140):
 *       Idempotently enable + start the seven-day widget backstop timer on
 *       every managed host. Same is-enabled-first pattern as agent-supervisor
 *       above: one cheap probe per sweep; only fresh hosts pay the one-time
 *       enable-and-start cost. daemon-reload has already fired above, so
 *       systemd has the fresh unit bytes before we probe.
 *
 *   2. settings.json patch:
 *      Ensure ~/.claude/settings.json has every fleet-required key set:
 *        - permissions.deny includes "AskUserQuestion" (pretty-view hangs
 *          indefinitely on deferred-journaled MCQ tool_use)
 *        - askUserQuestionTimeout: "never" (belt-and-braces same)
 *        - env.DISABLE_AUTOUPDATER: "1" (prevents silent mid-session CLI upgrade)
 *        - env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" (fleet-wide feature enable)
 *        - skipDangerousModePermissionPrompt: true
 *        - hooks.UserPromptSubmit contains a "task-field-check" entry (nudges
 *          agents whose identity file's `task:` field is still "Untitled
 *          conversation" — see substrate/scripts/task-field-check.sh)
 *        - hooks.PreToolUse contains an "allow-all-tools" entry with NO
 *          matcher — universal auto-allow that eliminates residual permission
 *          prompts the harness's --dangerously-skip-permissions flag doesn't
 *          cover (rm -rf $HOME / rm -rf / circuit-breaker patterns). See
 *          substrate/scripts/allow-all-tools.sh.
 *        - hooks.PostToolUse contains a "self-edit-baseline-sync" entry
 *          matching Write|Edit|MultiEdit|NotebookEdit|Bash — suppresses
 *          role-file-watch events on the agent's own edits. See
 *          substrate/scripts/self-edit-baseline-sync.sh.
 *      Merges the flags in without clobbering any other keys (OAuth token,
 *      other hooks, statusLine, theme, etc.). Creates the file if absent.
 *      Idempotent — a jq predicate short-circuits when all are already
 *      correct. Exact count lives in SETTINGS_REQUIRED_KEY_COUNT (derived
 *      from SETTINGS_CHECK_JQ so log lines never drift).
 *
 *   3. gsd-context-monitor cleanup (fleet-wide retirement):
 *      Strip any `.hooks.PostToolUse[]` entry whose command references
 *      `gsd-context-monitor.js` from ~/.claude/settings.json AND remove the
 *      hook file at ~/.claude/hooks/gsd-context-monitor.js if present. The
 *      hook is redundant with the ambient context-watch.py Monitor and gave
 *      false pressure warnings (the harness context meter overstates actual
 *      usage). Idempotent — no-op after first sweep on each host.
 *
 *   4. host-parent write (Phase 75 D-03):
 *      Write ~/fleet/host/parent with the parent-fleet HTTPS URL
 *      (single-line, newline-terminated). Read the URL from
 *      process.env.SKYNET_PUBLIC_URL. Idempotent: content-diff check
 *      short-circuits when the file already matches (RESEARCH Pitfall 3 —
 *      prevents mtime churn on every 2s sweep). Missing or malformed env
 *      var: skip entirely (do NOT write empty string; agents surface a
 *      clean "host config missing" error per D-03 when the file is
 *      absent). Failure to write is logged and marked in hadError; the
 *      never-throw contract is preserved. Also removes the legacy
 *      ~/.claude/skynet-parent file on every sweep (rebrand-neutrality —
 *      the file was moved out of the harness folder into the fleet folder).
 *
 *   5. host-name write:
 *      Write ~/fleet/host/name with the box's canonical host.name
 *      (single-line, newline-terminated). Written on every sweep
 *      (host.name is always in scope) with content-diff idempotency
 *      (RESEARCH Pitfall 3 — no rewrite → no mtime churn). Agents read this
 *      file in place of `$(hostname)` when constructing fleet passthrough
 *      file URLs, so cloud-VM boxes whose OS hostname is a meaningless
 *      string (e.g. "ip-172-31-243-143") stop 404'ing with unknown_host.
 *      Failure to write is logged and marked in hadError; the never-throw
 *      contract is preserved. Also removes the legacy ~/.claude/skynet-hostname
 *      file on every sweep (rebrand-neutrality).
 *
 *   6. usage-reporter retirement (the usage meter + its collector are gone):
 *      If ~/.claude/settings.json.statusLine.command is still the
 *      usage-reporter wrapper, restore the original command captured in
 *      ~/.claude/usage/usage-reporter.conf (WRAPPED=), or drop statusLine
 *      entirely when there was no real original. Only once settings.json no
 *      longer points at the wrapper, remove the wrapper, the reporter, the
 *      collector script, the retired install script, and ~/.claude/usage/.
 *      A statusLine that is NOT the wrapper is never touched. Idempotent —
 *      after the first sweep it's a jq read + rm -f on absent paths.
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
  /** Whether the settings.json patch was applied or already present.
   *  Covers every fleet-required key defined in SETTINGS_MERGE_JQ /
   *  SETTINGS_CHECK_JQ below (SETTINGS_REQUIRED_KEY_COUNT is derived from
   *  the CHECK expression, so log lines never drift when a key is added). */
  settingsPatchOk: boolean;
  /** Whether the gsd-context-monitor cleanup ran (settings strip + hook rm). */
  gsdContextMonitorCleanupOk: boolean;
  /** Whether the ~/fleet/host/parent write succeeded (or was skipped
   *  cleanly because SKYNET_PUBLIC_URL was missing/malformed). Phase 75 D-03.
   *  A false value here does NOT by itself imply hadError — a missing env var
   *  is a documented skip (RESEARCH Pitfall 4), not a per-host failure. */
  hostParentOk: boolean;
  /** Whether the ~/fleet/host/name write succeeded. Step 5 always runs
   *  (host.name is always in scope); a false value here always implies hadError. */
  hostNameOk: boolean;
  /** Whether the ~/fleet/host/id write succeeded. Step 5b always runs
   *  (host.id is always in scope); a false value here always implies hadError.
   *  Consumers: create-app.sh (app-development skill) reads this file to burn
   *  the numeric fleet-DB hostId into PANE_BASE at scaffold time — agents
   *  never need to know or look up the integer themselves. */
  hostIdOk: boolean;
  /** Whether the usage-reporter retirement step succeeded. Step 6 is
   *  idempotent and always runs; a false value implies hadError. */
  usageReporterRetireOk: boolean;
  /** Whether interactive-messages-gc.timer was already enabled before Step 1b.
   *  True = cheap probe only; false = enable-and-start ran (or was skipped due
   *  to an earlier Step 1 channel failure that prevented daemon-reload). */
  gcTimerAlreadyEnabled: boolean;
  /** Whether Step 1b ran the enable-now command successfully. Mutually
   *  exclusive with gcTimerAlreadyEnabled. False on both already-enabled AND
   *  error paths. */
  gcTimerBootstrapped: boolean;
  /** Whether scheduled-agents-scheduler.service was already enabled before
   *  Step 1c. True = cheap probe only; false = enable-and-start ran (or was
   *  skipped due to an earlier channel failure). */
  scheduledAgentsSchedulerAlreadyEnabled: boolean;
  /** Whether Step 1c ran the enable-now command successfully. Mutually
   *  exclusive with scheduledAgentsSchedulerAlreadyEnabled. False on both
   *  already-enabled AND error paths. */
  scheduledAgentsSchedulerBootstrapped: boolean;
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

// ---------------------------------------------------------------------------
// Exported jq templates — single source of truth. Both the SSH-bootstrap
// (this file) AND the local-fleet bootstrap (local-fleet-install.ts) apply
// the identical expressions so a change here propagates to both surfaces.
// ---------------------------------------------------------------------------

/**
 * MERGE jq expression. Idempotently sets the fleet-required settings.json
 * keys, preserving any other keys. Note: hook commands are stored as LITERAL
 * strings (e.g. `$HOME/.local/bin/task-field-check`) — bash single-quotes in
 * the SSH-path template don't expand $HOME, so the value written to disk is
 * a literal that Claude Code's hook runner expands at execution time via its
 * shell. Local jq invocation must NOT expand it either (pass the expression
 * as an argv arg, not through a shell).
 *
 * Currently sets eight keys total: five simple flags/env vars, plus three
 * hook entries under .hooks —
 *   - task-field-check on UserPromptSubmit (identity `task:` placeholder nudge).
 *   - allow-all-tools on PreToolUse (fleet-wide auto-allow — no matcher,
 *     fires for every tool; completes "no prompts, ever" by overriding the
 *     harness's residual circuit-breaker that survives
 *     --dangerously-skip-permissions).
 *   - self-edit-baseline-sync on PostToolUse (self-edit suppression for the
 *     role-file-watch ambient watcher; matcher covers every tool that can
 *     write to disk — Write|Edit|MultiEdit|NotebookEdit|Bash).
 */
export const SETTINGS_MERGE_JQ =
  `.permissions = ((.permissions // {}) | .deny = (((.deny // []) + ["AskUserQuestion"]) | unique))` +
  `  | .askUserQuestionTimeout = "never"` +
  `  | .env = ((.env // {}) | .DISABLE_AUTOUPDATER = "1" | .CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1")` +
  `  | .skipDangerousModePermissionPrompt = true` +
  `  | .hooks = ((.hooks // {})` +
  `      | .UserPromptSubmit = ((.UserPromptSubmit // []) | if any(.[]?.hooks[]?.command // ""; test("task-field-check")) then . else . + [{"hooks":[{"type":"command","command":"$HOME/.local/bin/task-field-check"}]}] end)` +
  `      | .PreToolUse = ((.PreToolUse // []) | if any(.[]?.hooks[]?.command // ""; test("allow-all-tools")) then . else . + [{"hooks":[{"type":"command","command":"$HOME/.local/bin/allow-all-tools"}]}] end)` +
  `      | .PostToolUse = ((.PostToolUse // []) | if any(.[]?.hooks[]?.command // ""; test("self-edit-baseline-sync")) then . else . + [{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"$HOME/.local/bin/self-edit-baseline-sync"}]}] end)` +
  `    )`;

/** CHECK jq expression. Returns true iff every required key is set. */
export const SETTINGS_CHECK_JQ =
  `(.skipDangerousModePermissionPrompt == true)` +
  `  and (.askUserQuestionTimeout == "never")` +
  `  and ((.permissions.deny // []) | contains(["AskUserQuestion"]))` +
  `  and (.env.DISABLE_AUTOUPDATER == "1")` +
  `  and (.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS == "1")` +
  `  and ((.hooks.UserPromptSubmit // []) | any(.[]?.hooks[]?.command // ""; test("task-field-check")))` +
  `  and ((.hooks.PreToolUse // []) | any(.[]?.hooks[]?.command // ""; test("allow-all-tools")))` +
  `  and ((.hooks.PostToolUse // []) | any(.[]?.hooks[]?.command // ""; test("self-edit-baseline-sync")))`;

/**
 * Number of required keys enforced by SETTINGS_CHECK_JQ, derived from the
 * expression itself so log lines / docstrings never drift when a clause is
 * added or removed. Split on ` and ` — an N-clause conjunction has N-1 such
 * joins, so `.length` on the split array IS the clause count. Whitespace on
 * both sides guards against a stray `and` inside a nested subexpression
 * (none of the current clauses contain that literal, and any new clause
 * following the same shape as its siblings won't either).
 *
 * When you add a new required key, extend SETTINGS_CHECK_JQ with another
 * `\`  and (...\`` clause AND update SETTINGS_MERGE_JQ to actually set that
 * key. This constant updates automatically; every consumer log line reads
 * from it via template interpolation.
 */
export const SETTINGS_REQUIRED_KEY_COUNT =
  SETTINGS_CHECK_JQ.split(/\s+and\s+/).length;

/** DETECT jq: true iff any PostToolUse entry references gsd-context-monitor. */
export const GSD_MONITOR_DETECT_JQ =
  `.hooks.PostToolUse // [] | any(.[]?.hooks[]?.command // ""; test("gsd-context-monitor"))`;

/**
 * STRIP jq: filter out any PostToolUse entry whose inner hooks reference
 * gsd-context-monitor. Byte-parallel with the historical SSH-path expression;
 * matches at the OUTER-drop level (if a group has multiple inner hooks and
 * ONE matches, the whole group is dropped — sibling non-matching hooks in
 * the same group are collateral).
 */
export const GSD_MONITOR_STRIP_JQ =
  `.hooks.PostToolUse |= map(select(any(.hooks[]?.command // ""; test("gsd-context-monitor")) | not))`;

/**
 * Step 6 — usage-reporter retirement. Paths (relative to $HOME) removed once
 * settings.json.statusLine no longer points at the wrapper. Shared with the
 * local-fleet surface (local-fleet-install.ts). ~/.claude/usage/ (conf,
 * throttle stamp, legacy dup copies) is removed as a whole directory.
 */
export const USAGE_REPORTER_RETIRED_FILES = [
  ".local/bin/usage-reporter",
  ".local/bin/usage-report",
  ".local/bin/claude-usage-collector",
  ".local/bin/install-usage-reporter",
] as const;
export const USAGE_REPORTER_RETIRED_DIR = ".claude/usage";

/**
 * Run idempotent pre-sweep bootstrap on a managed host.
 *
 * Called by runSweepForHost BEFORE the catalog loop. The two jobs:
 *   1. agent-supervisor systemd linger + enable (first install only) +
 *      unconditional daemon-reload (every sweep).
 *   2. settings.json patch: ensure every fleet-required key is set.
 *      The specific keys and count live in SETTINGS_MERGE_JQ /
 *      SETTINGS_CHECK_JQ; SETTINGS_REQUIRED_KEY_COUNT is derived from CHECK.
 *
 * NEVER REJECTS.
 */
export async function runBootstrapForHost(
  channel: SshChannel,
  host: { id: string; name: string; machineId?: string },
): Promise<BootstrapResult> {
  // Phase 75 D-03: parent Skynet's HTTPS URL, read at function top so it flows
  // directly into step 4 without threading it through SweepDeps +
  // ssh-poll-orchestrator + starter (per RESEARCH § Assumption A6).
  const skynetPublicUrl = process.env.SKYNET_PUBLIC_URL ?? "";

  let alreadyEnabled = false;
  let bootstrapRan = false;
  let daemonReloadRan = false;
  let settingsPatchOk = false;
  let gsdContextMonitorCleanupOk = false;
  let hostParentOk = false;
  let hostNameOk = false;
  let hostIdOk = false;
  let gcTimerAlreadyEnabled = false;
  let gcTimerBootstrapped = false;
  let scheduledAgentsSchedulerAlreadyEnabled = false;
  let scheduledAgentsSchedulerBootstrapped = false;
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
    // XDG_RUNTIME_DIR is required for `systemctl --user` to reach the user
    // dbus socket. Bare SSH-exec on Ubuntu does NOT set it (no logind session
    // is created), so without the explicit prefix every `systemctl --user`
    // call silently fails with "Failed to connect to bus: No medium found"
    // and exits 1 — which the distributor previously misread as "not
    // enabled, run bootstrap" while the bootstrap sequence + restart hook
    // both silently no-op'd on the same missing bus. `$(id -u)` is evaluated
    // by the remote shell so this is UID-agnostic across managed hosts.
    const checkCmd =
      `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-enabled agent-supervisor.service 2>/dev/null; echo "EXIT:$?"`;
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
        // `loginctl` operates on system-level state and does NOT need
        // XDG_RUNTIME_DIR. The two `systemctl --user` calls do — see the
        // is-enabled-check note above for why.
        const bootstrapCmd = [
          `loginctl enable-linger "$(whoami)"`,
          `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user daemon-reload`,
          `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user enable --now agent-supervisor.service`,
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
          `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user daemon-reload && echo "__RELOAD_OK__"`;
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
  // Step 1b (Phase 140): Idempotently enable + start the
  // interactive-messages-gc.timer on every managed host. This is the
  // seven-day backstop timer that tears down widgets older than 7 days.
  // Same is-enabled-first pattern as agent-supervisor above: one cheap probe
  // per sweep; only fresh hosts pay the one-time enable-and-start cost.
  // daemon-reload has already fired above, so systemd has the fresh unit bytes
  // before we probe.
  //
  // Runs inside its own try/catch (NEVER-THROW contract). Skipped silently
  // if the Step 1 block encountered a channel error (daemonReloadRan===false
  // implies the channel may be in a bad state), but that skip doesn't set
  // hadError — a channel-level failure was already recorded in Step 1.
  // -------------------------------------------------------------------------
  try {
    const isEnabledCmdGc =
      `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-enabled interactive-messages-gc.timer 2>/dev/null; echo "EXIT:$?"`;
    const gcCheckRaw = await channel.exec(isEnabledCmdGc);

    if (gcCheckRaw === null) {
      logBootstrapFailed(host, "gc-timer-is-enabled-check", "channel returned null");
      hadError = true;
    } else {
      const gcTrimmed = gcCheckRaw.trimEnd();
      const gcMatch = /EXIT:(\d+)$/.exec(gcTrimmed);
      const gcExitCode = gcMatch ? parseInt(gcMatch[1], 10) : -1;

      if (gcExitCode === 0) {
        // Already enabled — nothing to do.
        gcTimerAlreadyEnabled = true;
        systemLogger.info(
          `Fleet-substrate bootstrap: interactive-messages-gc.timer already enabled on ${host.name}`,
          {
            operation: "fleet_substrate_bootstrap_result",
            fleetHostId: host.id,
            hostName: host.name,
            step: "gc-timer-is-enabled-check",
            gcTimerAlreadyEnabled: true,
          },
        );
      } else {
        // Not enabled — enable + start now. daemon-reload has already fired
        // above (agent-supervisor block), so systemd has the fresh unit bytes.
        const enableGcCmd =
          `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user enable --now interactive-messages-gc.timer && echo "__GC_TIMER_OK__"`;
        const enableGcRaw = await channel.exec(enableGcCmd);

        if (enableGcRaw === null) {
          logBootstrapFailed(host, "gc-timer-enable", "channel returned null");
          hadError = true;
        } else if (!enableGcRaw.trimEnd().endsWith("__GC_TIMER_OK__")) {
          logBootstrapFailed(
            host,
            "gc-timer-enable",
            enableGcRaw.trimEnd().slice(0, 500) || "gc-timer enable failed",
          );
          hadError = true;
        } else {
          gcTimerBootstrapped = true;
          systemLogger.info(
            `Fleet-substrate bootstrap: interactive-messages-gc.timer enabled+started on ${host.name}`,
            {
              operation: "fleet_substrate_bootstrap_result",
              fleetHostId: host.id,
              hostName: host.name,
              step: "gc-timer-enable",
              gcTimerBootstrapped: true,
            },
          );
        }
      }
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "gc-timer-is-enabled-check",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 1c: Idempotently enable + start the scheduled-agents-scheduler.service
  // on every managed host. This is the systemd user unit that owns the
  // box-level scheduled-agents scheduler (wakeup-scheduler --mode
  // scheduled-agents). Same is-enabled-first pattern as Step 1 / 1b:
  // one cheap probe per sweep; only fresh hosts pay the one-time enable-and-
  // start cost. daemon-reload has already fired above (Step 1), so systemd
  // has the fresh unit bytes before we probe.
  //
  // Fresh-box ordering note: on the FIRST sweep of a brand-new box, the
  // .service unit-file itself hasn't been pushed to disk yet (that happens
  // later in the catalog loop). enable-and-start will fail this tick with
  // "Unit ... does not exist", hadError=true will be set, and the sweep's
  // fire-and-forget contract means the whole run continues. On the NEXT
  // sweep tick, the file is on disk, daemon-reload picks it up, this step
  // runs cleanly. Identical convergence shape as Step 1b (gc-timer).
  //
  // Runs inside its own try/catch (NEVER-THROW contract).
  // -------------------------------------------------------------------------
  try {
    const isEnabledCmdSched =
      `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-enabled scheduled-agents-scheduler.service 2>/dev/null; echo "EXIT:$?"`;
    const schedCheckRaw = await channel.exec(isEnabledCmdSched);

    if (schedCheckRaw === null) {
      logBootstrapFailed(
        host,
        "scheduled-agents-scheduler-is-enabled-check",
        "channel returned null",
      );
      hadError = true;
    } else {
      const schedTrimmed = schedCheckRaw.trimEnd();
      const schedMatch = /EXIT:(\d+)$/.exec(schedTrimmed);
      const schedExitCode = schedMatch ? parseInt(schedMatch[1], 10) : -1;

      if (schedExitCode === 0) {
        scheduledAgentsSchedulerAlreadyEnabled = true;
        systemLogger.info(
          `Fleet-substrate bootstrap: scheduled-agents-scheduler.service already enabled on ${host.name}`,
          {
            operation: "fleet_substrate_bootstrap_result",
            fleetHostId: host.id,
            hostName: host.name,
            step: "scheduled-agents-scheduler-is-enabled-check",
            scheduledAgentsSchedulerAlreadyEnabled: true,
          },
        );
      } else {
        const enableSchedCmd =
          `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user enable --now scheduled-agents-scheduler.service && echo "__SCHED_OK__"`;
        const enableSchedRaw = await channel.exec(enableSchedCmd);

        if (enableSchedRaw === null) {
          logBootstrapFailed(
            host,
            "scheduled-agents-scheduler-enable",
            "channel returned null",
          );
          hadError = true;
        } else if (!enableSchedRaw.trimEnd().endsWith("__SCHED_OK__")) {
          logBootstrapFailed(
            host,
            "scheduled-agents-scheduler-enable",
            enableSchedRaw.trimEnd().slice(0, 500) ||
              "scheduled-agents-scheduler enable failed",
          );
          hadError = true;
        } else {
          scheduledAgentsSchedulerBootstrapped = true;
          systemLogger.info(
            `Fleet-substrate bootstrap: scheduled-agents-scheduler.service enabled+started on ${host.name}`,
            {
              operation: "fleet_substrate_bootstrap_result",
              fleetHostId: host.id,
              hostName: host.name,
              step: "scheduled-agents-scheduler-enable",
              scheduledAgentsSchedulerBootstrapped: true,
            },
          );
        }
      }
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "scheduled-agents-scheduler-is-enabled-check",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: Patch ~/.claude/settings.json — ensure every fleet-required key
  //         is set. Idempotent: skip if all correct. Preserves all other keys.
  //         The keys (rationale in file docblock):
  //           - permissions.deny includes "AskUserQuestion"
  //           - askUserQuestionTimeout: "never"
  //           - env.DISABLE_AUTOUPDATER: "1"
  //           - env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"
  //           - skipDangerousModePermissionPrompt: true
  //           - hooks.UserPromptSubmit contains an entry that runs
  //             $HOME/.local/bin/task-field-check (nudges the agent when its
  //             identity file's `task:` frontmatter is still "Untitled
  //             conversation"). Match on the string "task-field-check" in the
  //             command so future path re-organizations don't invalidate the
  //             idempotency check.
  //           - hooks.PreToolUse contains an entry that runs
  //             $HOME/.local/bin/allow-all-tools with NO matcher (universal
  //             auto-allow for every tool call). Match on the string
  //             "allow-all-tools" for the same idempotency-check reason.
  //           - hooks.PostToolUse contains an entry matching
  //             Write|Edit|MultiEdit|NotebookEdit|Bash that runs
  //             $HOME/.local/bin/self-edit-baseline-sync (suppresses
  //             role-file-watch events on the agent's own edits).
  // Exact count lives in SETTINGS_REQUIRED_KEY_COUNT — derived from
  // SETTINGS_CHECK_JQ so log lines never need manual updates when a key
  // is added or removed.
  // -------------------------------------------------------------------------
  try {
    // Single SSH exec that handles three cases:
    //   (a) File exists + all already correct → no-op, echoes __SETTINGS_OK__
    //   (b) File exists + any missing/wrong → jq-merge, echoes __SETTINGS_OK__
    //   (c) File absent → create with all (jq applied to {}), echoes __SETTINGS_OK__
    // Uses a .new temp file + mv for atomic write (no partial-write state).
    // Same MERGE template drives both (b) and (c) paths so the truth of "what
    // the fleet enforces" lives in exactly one jq expression.
    // NB: MERGE + CHECK jq bodies are shared constants (SETTINGS_MERGE_JQ,
    // SETTINGS_CHECK_JQ) so the local-fleet bootstrap in local-fleet-install.ts
    // executes byte-parallel expressions. Do NOT edit inline — edit the
    // exported constants above.
    const settingsCmd = [
      `SETTINGS="$HOME/.claude/settings.json"`,
      `MERGE='${SETTINGS_MERGE_JQ}'`,
      `CHECK='${SETTINGS_CHECK_JQ}'`,
      `if [ -f "$SETTINGS" ]; then`,
      `  jq -e "$CHECK" "$SETTINGS" > /dev/null 2>&1 || {`,
      `    jq "$MERGE" "$SETTINGS" > "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS"`,
      `  }`,
      `else`,
      `  mkdir -p "$(dirname "$SETTINGS")"`,
      `  echo '{}' | jq "$MERGE" > "$SETTINGS"`,
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
    // NB: DETECT + STRIP jq bodies are shared constants
    // (GSD_MONITOR_DETECT_JQ, GSD_MONITOR_STRIP_JQ) so the local-fleet
    // bootstrap in local-fleet-install.ts executes byte-parallel expressions.
    // Do NOT edit inline — edit the exported constants above. Regression
    // note from 2026-09-05: DETECT uses `.[]?.hooks[]?.command` — iterate
    // the PostToolUse array THEN dive into each entry's inner hooks. An
    // earlier `.hooks[]?.command` (without the outer `.[]?`) tried to index
    // the array with "hooks", jq exited 5, the `if` treated that as false,
    // the strip was silently skipped, and every host got fleet-wide
    // "PostToolUse:Bash hook error" noise on every tool call. Guarded by test (k).
    const cleanupCmd = [
      `S_FILE="$HOME/.claude/settings.json"`,
      `if [ -f "$S_FILE" ] && jq -e '${GSD_MONITOR_DETECT_JQ}' "$S_FILE" > /dev/null 2>&1; then`,
      `  jq '${GSD_MONITOR_STRIP_JQ}' "$S_FILE" > "$S_FILE.new" && mv "$S_FILE.new" "$S_FILE"`,
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

  // -------------------------------------------------------------------------
  // Step 4: Write ~/fleet/host/parent — parent-fleet-URL config for agent
  //         URL construction (Phase 75 D-03). Idempotent: content-diff
  //         check short-circuits when the file already matches (RESEARCH
  //         Pitfall 3 — no rewrite → no mtime churn). If SKYNET_PUBLIC_URL is
  //         missing OR does not start with https://, skip entirely (do NOT
  //         write an empty string; agents' D-03 fresh-box behavior surfaces a
  //         clean "host config missing" error when the file is absent).
  //         Missing env is a documented skip, not a per-host failure
  //         — hadError is NOT set on the skip path (RESEARCH Pitfall 4).
  //
  //         Also removes the legacy ~/.claude/skynet-parent file on every
  //         sweep — the file was moved out of the harness folder into the
  //         fleet folder to keep the vendor brand name from leaking into
  //         agent-visible file paths on rebranded fleet instances.
  // -------------------------------------------------------------------------
  try {
    if (!skynetPublicUrl || !/^https:\/\//.test(skynetPublicUrl)) {
      // Skip path — log for observability but do not mark as error.
      systemLogger.warn(
        `Fleet-substrate bootstrap: SKYNET_PUBLIC_URL missing or malformed, skipping host-parent write for ${host.name}`,
        {
          operation: "fleet_substrate_bootstrap_result",
          fleetHostId: host.id,
          hostName: host.name,
          step: "host-parent-write",
        },
      );
    } else {
      // Shell-safe single-quote escape: close-quote, escape a literal quote,
      // reopen-quote. Keeps the NEW='...' assignment valid even when the URL
      // itself contains an embedded single-quote character.
      const safeUrl = skynetPublicUrl.replace(/'/g, "'\\''");
      const cmd = [
        `SP="$HOME/fleet/host/parent"`,
        `mkdir -p "$HOME/fleet/host"`,
        `NEW='${safeUrl}'`,
        `if [ -f "$SP" ] && [ "$(cat "$SP")" = "$NEW" ]; then`,
        `  :  # idempotent no-op (RESEARCH Pitfall 3 — do not churn mtime)`,
        `else`,
        `  printf '%s\\n' "$NEW" > "$SP.new" && mv "$SP.new" "$SP"`,
        `fi`,
        `rm -f "$HOME/.claude/skynet-parent"`,
        `echo "__HOST_PARENT_OK__"`,
      ].join("\n");

      const raw = await channel.exec(cmd);

      if (raw === null) {
        hadError = true;
        logBootstrapFailed(host, "host-parent-write", "channel returned null");
      } else if (!raw.trimEnd().endsWith("__HOST_PARENT_OK__")) {
        hadError = true;
        logBootstrapFailed(
          host,
          "host-parent-write",
          raw.trimEnd().slice(0, 500) || "host-parent write failed",
        );
      } else {
        hostParentOk = true;
      }
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "host-parent-write",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 5: Write ~/fleet/host/name — fleet's canonical host.name for this
  //         box. Written on every sweep (host.name is always in scope) with
  //         content-diff idempotency (RESEARCH Pitfall 3 — no rewrite → no
  //         mtime churn). Agents read this file in place of `$(hostname)`
  //         when constructing fleet passthrough file URLs, so cloud-VM boxes
  //         whose OS hostname (e.g. "ip-172-31-243-143") does not match the
  //         fleet's resolver name stop 404'ing with unknown_host.
  //         NEVER-THROW contract preserved: channel-null, missing-sentinel,
  //         and thrown-error branches each mark hadError without rejecting.
  //
  //         Also removes the legacy ~/.claude/skynet-hostname file on every
  //         sweep (rebrand-neutrality — same rationale as Step 4).
  // -------------------------------------------------------------------------
  try {
    // Shell-safe single-quote escape: close-quote, escape a literal quote,
    // reopen-quote. Keeps the NEW='...' assignment valid even when host.name
    // contains an embedded single-quote character.
    const safeHostname = host.name.replace(/'/g, "'\\''");
    const cmd = [
      `SH="$HOME/fleet/host/name"`,
      `mkdir -p "$HOME/fleet/host"`,
      `NEW='${safeHostname}'`,
      `if [ -f "$SH" ] && [ "$(cat "$SH")" = "$NEW" ]; then`,
      `  :  # idempotent no-op (RESEARCH Pitfall 3 — do not churn mtime)`,
      `else`,
      `  printf '%s\\n' "$NEW" > "$SH.new" && mv "$SH.new" "$SH"`,
      `fi`,
      `rm -f "$HOME/.claude/skynet-hostname"`,
      `echo "__HOST_NAME_OK__"`,
    ].join("\n");

    const raw = await channel.exec(cmd);

    if (raw === null) {
      hadError = true;
      logBootstrapFailed(host, "host-name-write", "channel returned null");
    } else if (!raw.trimEnd().endsWith("__HOST_NAME_OK__")) {
      hadError = true;
      logBootstrapFailed(
        host,
        "host-name-write",
        raw.trimEnd().slice(0, 500) || "host-name write failed",
      );
    } else {
      hostNameOk = true;
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "host-name-write",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 5b: Write ~/fleet/host/id — the box's machine id (shared by every
  //          user's row for this box, so all sweeps agree and URLs minted
  //          from it resolve for every user; falls back to the row id).
  //          Written on every sweep (host.id is always in scope) with
  //          content-diff idempotency. Consumers: the app-development skill's
  //          create-app.sh reads this file to burn the numeric hostId into
  //          scaffolded PANE_BASE at scaffold time, so agents never need to
  //          know or look up the integer themselves. Same fail-soft shape as
  //          Step 5 (host-name).
  //
  //          Also removes the legacy ~/.claude/skynet-hostid file on every
  //          sweep (rebrand-neutrality — same rationale as Step 4).
  // -------------------------------------------------------------------------
  try {
    const safeHostid = (host.machineId ?? host.id).replace(/'/g, "'\\''");
    const cmd = [
      `SH="$HOME/fleet/host/id"`,
      `mkdir -p "$HOME/fleet/host"`,
      `NEW='${safeHostid}'`,
      `if [ -f "$SH" ] && [ "$(cat "$SH")" = "$NEW" ]; then`,
      `  :  # idempotent no-op (same rationale as Step 5)`,
      `else`,
      `  printf '%s\\n' "$NEW" > "$SH.new" && mv "$SH.new" "$SH"`,
      `fi`,
      `rm -f "$HOME/.claude/skynet-hostid"`,
      `echo "__HOST_ID_OK__"`,
    ].join("\n");

    const raw = await channel.exec(cmd);

    if (raw === null) {
      hadError = true;
      logBootstrapFailed(host, "host-id-write", "channel returned null");
    } else if (!raw.trimEnd().endsWith("__HOST_ID_OK__")) {
      hadError = true;
      logBootstrapFailed(
        host,
        "host-id-write",
        raw.trimEnd().slice(0, 500) || "host-id write failed",
      );
    } else {
      hostIdOk = true;
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "host-id-write",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  // -------------------------------------------------------------------------
  // Step 6: usage-reporter retirement.
  //   (a) Read the current settings.json.statusLine.command.
  //   (b) If it's the wrapper (any path ending /.local/bin/usage-reporter —
  //       also catches the old co-located `/host-home/...` mis-write):
  //       source WRAPPED= from the conf in a subshell (same read the wrapper
  //       itself did every tick). A real original → restore it as
  //       statusLine.command (keeps other statusLine keys); empty or itself
  //       a usage-reporter path → del(.statusLine).
  //   (c) Only if (b) succeeded or wasn't needed: rm the retired files +
  //       ~/.claude/usage/. Ordering matters — never delete the wrapper while
  //       settings.json still execs it.
  // -------------------------------------------------------------------------
  let usageReporterRetireOk = false;
  try {
    const rmFiles = USAGE_REPORTER_RETIRED_FILES.map((rel) => `"$HOME/${rel}"`).join(" ");
    const retireCmd = [
      `SETTINGS="$HOME/.claude/settings.json"`,
      `CONF="$HOME/${USAGE_REPORTER_RETIRED_DIR}/usage-reporter.conf"`,
      `CUR=""`,
      `if [ -f "$SETTINGS" ]; then`,
      `  CUR=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null || printf '')`,
      `fi`,
      `UNWRAP_OK=1`,
      `case "$CUR" in`,
      `  */.local/bin/usage-reporter)`,
      `    ORIG=""`,
      `    if [ -f "$CONF" ]; then ORIG=$(WRAPPED=""; . "$CONF" >/dev/null 2>&1; printf '%s' "$WRAPPED"); fi`,
      `    case "$ORIG" in *usage-reporter*) ORIG="" ;; esac`,
      `    if [ -n "$ORIG" ]; then`,
      `      jq --arg cmd "$ORIG" '.statusLine.command = $cmd' "$SETTINGS" > "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS" || UNWRAP_OK=0`,
      `    else`,
      `      jq 'del(.statusLine)' "$SETTINGS" > "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS" || UNWRAP_OK=0`,
      `    fi`,
      `    ;;`,
      `esac`,
      `if [ "$UNWRAP_OK" = "1" ]; then`,
      `  rm -f ${rmFiles}`,
      `  rm -rf "$HOME/${USAGE_REPORTER_RETIRED_DIR}"`,
      `  echo "__USAGE_REPORTER_RETIRED__"`,
      `fi`,
    ].join("\n");

    const raw = await channel.exec(retireCmd);

    if (raw === null) {
      hadError = true;
      logBootstrapFailed(host, "usage-reporter-retire", "channel returned null");
    } else if (!raw.trimEnd().endsWith("__USAGE_REPORTER_RETIRED__")) {
      hadError = true;
      logBootstrapFailed(
        host,
        "usage-reporter-retire",
        raw.trimEnd().slice(0, 500) || "usage-reporter retirement failed",
      );
    } else {
      usageReporterRetireOk = true;
    }
  } catch (err) {
    hadError = true;
    logBootstrapFailed(
      host,
      "usage-reporter-retire",
      err instanceof Error ? err.message : "unknown throw",
    );
  }

  const result: BootstrapResult = {
    alreadyEnabled,
    bootstrapRan,
    daemonReloadRan,
    settingsPatchOk,
    gsdContextMonitorCleanupOk,
    hostParentOk,
    hostNameOk,
    hostIdOk,
    usageReporterRetireOk,
    gcTimerAlreadyEnabled,
    gcTimerBootstrapped,
    scheduledAgentsSchedulerAlreadyEnabled,
    scheduledAgentsSchedulerBootstrapped,
    hadError,
  };

  logBootstrapResult(host, result);
  return result;
}
