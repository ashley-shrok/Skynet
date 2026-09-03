/**
 * quick-260806-dwe: Extracted post-tmux Claude-harness bootstrap sequence.
 *
 * This is the VERBATIM body of identity-birth-orchestrator.ts steps 3-5,
 * lifted into a single reusable module so both birth AND clone can bring up
 * a live Claude harness with `/id <name>` already sent on a freshly-created
 * tmux session. Without this, clone's onCreate callback was routing users
 * into a bare login shell that pretty-view rendered as "no active Claude
 * session" (patch #321 UAT gap).
 *
 * The sequence (Nelly-verbatim, cribbed from ~/vms-apps/apps/home/agent-
 * supervisor.sh:105-142 + 326-340):
 *   1. Pre-write `hasTrustDialogAccepted: true` for the working-dir into
 *      ~/.claude.json via a node -e one-liner (avoids the interactive
 *      trust-dialog prompt on first claude launch).
 *   2. tmux send-keys -t <name> -l '<claude launch cmd>' — literal-mode so
 *      env-vars don't get pre-expanded by the shell before tmux sees them.
 *   3. tmux send-keys -t <name> Enter — separate Enter (Nelly §1(e): two
 *      distinct send-keys calls). No -l on the Enter itself.
 *   4. sleep 2000ms (STEP_3_SLEEP_MS) — let the claude REPL come up.
 *   5. Blind Enter train × 7 at 3s spacing (ENTER_TRAIN_COUNT ×
 *      ENTER_TRAIN_SPACING_MS). Deliberately timing-based, NOT scrape-based
 *      (Nelly §1(g)). Overshoot at an empty REPL is a no-op.
 *   6. tmux send-keys -t <name> -l '/id <name>' — literal-mode so the slash
 *      command hits the Claude REPL cleanly.
 *   7. tmux send-keys -t <name> Enter — dispatch the /id command.
 *
 * Constants (CLAUDE_LAUNCH_CMD_PREFIX, STEP_3_SLEEP_MS, ENTER_TRAIN_COUNT,
 * ENTER_TRAIN_SPACING_MS) are IMPORTED from identity-birth-orchestrator.ts
 * — birth stays the authoritative source (they carry "Nelly §..." tags +
 * cross-reference agent-supervisor.sh:333). Do NOT duplicate them here.
 *
 * The caller MUST:
 *   - Pre-validate `name` against the tmux-safe pattern (IDENTITY_KEY_RE at
 *     minimum; birth also gates via TMUX_SAFE_NAME_RE). This helper does no
 *     re-validation — clone gates via IDENTITY_KEY_RE at the HTTP body
 *     validation layer, birth gates in birthIdentity().
 *   - Pre-normalize `remotePath` so tildes are already expanded to $HOME
 *     (birth's step 0b handles that). Helper does NOT re-run tilde-to-$HOME
 *     rewriting; it assumes the caller has already done so.
 *   - Provide an `exec` closure that runs the command over the caller's
 *     transport (SSH exec channel for remote hosts, child_process for local).
 */

import {
  CLAUDE_LAUNCH_CMD_PREFIX,
  STEP_3_SLEEP_MS,
  ENTER_TRAIN_COUNT,
  ENTER_TRAIN_SPACING_MS,
} from "./identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Local helpers (copied verbatim from identity-birth-orchestrator.ts — kept
// standalone so this module has no circular dep on birth's private helpers).
// ---------------------------------------------------------------------------

/** POSIX single-quote escape. Wraps s in '...' and escapes embedded ' as '\''. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** await-friendly sleep that works with vi.useFakeTimers. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface StartHarnessOnIdentityOpts {
  /**
   * Runs a shell command on the target host. Caller builds the closure so
   * this helper is transport-agnostic (SSH exec / local child_process).
   * Rejections propagate to the caller so failure attribution stays with
   * the caller's step wrapper.
   */
  exec: (cmd: string) => Promise<string>;
  /**
   * The tmux session name. MUST be pre-validated by the caller against a
   * tmux-safe pattern (IDENTITY_KEY_RE at minimum; birth also uses
   * TMUX_SAFE_NAME_RE). Interpolated directly into `-t <name>` and single-
   * quoted inside the `/id <name>` payload.
   */
  name: string;
  /**
   * The working directory path for the identity, already normalized by the
   * caller (tildes expanded to $HOME per birth's step 0b). Passed as the
   * trailing argv to the trust-flag node one-liner, single-quoted for shell
   * safety.
   */
  remotePath: string;
}

/**
 * Fire the 11-command post-tmux Claude-harness bootstrap sequence. Assumes
 * the tmux session `<name>` already exists (caller ran `tmux new-session`).
 *
 * On any exec rejection, the returned promise rejects with the underlying
 * error — the caller decides how to attribute the failure (birth wraps
 * this call inside runStep(3) so a helper rejection surfaces as
 * step:3:failed; clone lets it propagate to the 502 catch block).
 */
export async function startHarnessOnIdentity(
  opts: StartHarnessOnIdentityOpts,
): Promise<void> {
  const { exec, name, remotePath } = opts;

  // -------------------------------------------------------------------------
  // 1. Pre-write hasTrustDialogAccepted=true for the working-dir.
  //    The node -e one-liner is cribbed VERBATIM from birth's step 3
  //    (identity-birth-orchestrator.ts L523-536), which was itself cribbed
  //    from agent-supervisor.sh:125 accept_trust_for_workdir().
  //    The path is passed as process.argv[1] (single-quoted trailing argv)
  //    to avoid embedding it inside the JS string with complex escaping.
  // -------------------------------------------------------------------------
  const trustCmd =
    `node -e ` +
    shellSingleQuote(
      `const fs=require("fs"),os=require("os"),p=require("path");` +
      `const f=p.join(os.homedir(),".claude.json");` +
      `const wd=process.argv[1];` +
      `let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"));}catch(e){}` +
      `if(typeof d!=="object"||!d||Array.isArray(d))d={};` +
      `d.projects=(d.projects&&typeof d.projects==="object")?d.projects:{};` +
      `d.projects[wd]=(d.projects[wd]&&typeof d.projects[wd]==="object")?d.projects[wd]:{};` +
      `d.projects[wd].hasTrustDialogAccepted=true;` +
      `try{fs.writeFileSync(f,JSON.stringify(d,null,2)+"\\n");console.log("set");}catch(e){console.log("skip");}`,
    ) +
    ` ${shellSingleQuote(remotePath)}`;

  await exec(trustCmd);

  // -------------------------------------------------------------------------
  // 2. Claude launch via tmux send-keys -l (literal mode so env-vars aren't
  //    pre-expanded by the shell before tmux sees them). Nelly §1(d-e).
  // -------------------------------------------------------------------------
  // `--model opus` pins the Opus 4.7 [1m] variant explicitly (Ashley 2026-09-03).
  // Claude Code v2.1.150's client-side default silently flipped from Opus → Sonnet
  // sometime between 2026-09-02 15:58Z and 2026-09-03 02:02Z, catching every
  // fresh-recycled fleet identity on Sonnet 4.6 (200K ctx) instead of Opus 4.7 [1m]
  // (1M ctx). The `opus` alias resolves to the 1M-context Opus variant (Opus never
  // had a 200K variant); auto-tracks future Opus versions.
  const claudeCmd = `${CLAUDE_LAUNCH_CMD_PREFIX} claude --model opus --dangerously-skip-permissions`;
  await exec(`tmux send-keys -t ${name} -l ${shellSingleQuote(claudeCmd)}`);

  // -------------------------------------------------------------------------
  // 3. Separate Enter (Nelly §1(e): two distinct send-keys calls, no -l on
  //    the Enter itself).
  // -------------------------------------------------------------------------
  await exec(`tmux send-keys -t ${name} Enter`);

  // -------------------------------------------------------------------------
  // 4. Sleep 2s before starting the Enter train (Nelly §1(f)) — lets the
  //    Claude REPL come up before we start blind-Entering.
  // -------------------------------------------------------------------------
  await sleep(STEP_3_SLEEP_MS);

  // -------------------------------------------------------------------------
  // 5. Blind Enter train × ENTER_TRAIN_COUNT at ENTER_TRAIN_SPACING_MS.
  //    Deliberately fire-and-forget, timing-based, NOT scrape-based (Nelly
  //    §1(g)). Last Enter has no post-sleep so we don't add ~3s of dead time
  //    before the /id call.
  // -------------------------------------------------------------------------
  for (let i = 0; i < ENTER_TRAIN_COUNT; i++) {
    await exec(`tmux send-keys -t ${name} Enter`);
    if (i < ENTER_TRAIN_COUNT - 1) {
      await sleep(ENTER_TRAIN_SPACING_MS);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Send /id <name> in literal mode + 7. Enter to dispatch. Nelly §1(h-i).
  // -------------------------------------------------------------------------
  await exec(`tmux send-keys -t ${name} -l ${shellSingleQuote(`/id ${name}`)}`);
  await exec(`tmux send-keys -t ${name} Enter`);
}
