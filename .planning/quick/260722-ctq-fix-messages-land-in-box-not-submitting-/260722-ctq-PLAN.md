---
phase: 260722-ctq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/ssh/terminal.ts
autonomous: true
requirements:
  - Q-260722-CTQ-01
user_setup: []

must_haves:
  truths:
    - "Pretty-view compose-box submits arrive as a real Enter keypress event to Claude Code (not a CR embedded in a bracketed-paste framing)"
    - "Single-line messages submit reliably at realistic cadence (10/10 confirmed in prototype)"
    - "Multi-line messages submit as ONE message with internal newlines preserved (no premature split)"
    - "Targets without tmux (or where the send-keys exec fails) fall back to the pre-patch CR-in-PTY behavior so non-tmux SSH panes never regress"
    - "A fallback path warning is logged when tmux send-keys fails so operators can diagnose without silent behavior change"
    - "Patch #118 is committed to feat/tab-title-from-tmux following the fork's numbered-patch commit-message convention"
    - "skynet-patches.md is updated with the #118 entry, the header patch-count bumped from 117 to 118, and the 'Patch drift caveat' file list updated to include src/backend/ssh/terminal.ts's new tmux-send-keys submit-tail block"
  artifacts:
    - path: "src/backend/ssh/terminal.ts"
      provides: "Hybrid submit path: PTY-write text WITHOUT trailing CR, then invoke `tmux send-keys -t <session> Enter` via a fresh exec on the SAME sshConn"
      contains: "isPrettyViewSubmit"
    - path: "/home/ubuntu/.claude/identities/tina/skynet-patches.md"
      provides: "Patch #118 catalog entry + updated drift caveat"
      contains: "118."
  key_links:
    - from: "src/backend/ssh/terminal.ts case \"input\":"
      to: "session.sshConn.exec(\"tmux send-keys ...\")"
      via: "sessionManager.getSession(currentSessionId).sshConn"
      pattern: "sshConn\\.exec\\(.*send-keys"
    - from: "src/backend/ssh/terminal.ts hybrid path"
      to: "session.tmuxSessionName"
      via: "cached at tmux_attach time (line ~690)"
      pattern: "session\\.tmuxSessionName"
    - from: "skynet-patches.md header"
      to: "patch count"
      via: "ONE HUNDRED EIGHTEEN (was ONE HUNDRED SEVENTEEN)"
      pattern: "ONE HUNDRED EIGHTEEN"
---

<objective>
Fix the "messages land in Claude Code's compose box but don't submit" bug by
replacing the current CR-in-PTY submit tail with a hybrid path: the body still
goes through the existing PTY write, but the confirming Enter becomes a
`tmux send-keys -t <session> Enter` invoked over a separate exec channel on
the SAME multiplexed sshConn — a real keypress event, delivered outside the
paste framing that Ink's compose-box reader treats as literal newline content.

Purpose: Patches #100 (split-and-delay Enter, 50ms) and #111a (delay bump to
250ms) both tried to give Claude Code's Ink paste-detection state machine
enough headroom to exit paste mode before the CR arrived. Empirically that
never fully worked — Ashley UAT hit it again during Phase 9 UAT on a message
that wasn't even flagged as [pasted]. Root cause pinned in this session: any
CR arriving through the SAME PTY channel that just delivered body bytes is
subject to Ink's paste-detection framing and can be absorbed as content
instead of firing submit. The empirically-validated fix (10/10 single-line
+ multi-line preservation in local prototype 2026-07-22 09:XXZ) is to
dispatch the Enter as a proper keyboard event via `tmux send-keys`, which
tmux delivers to the process as a real key input outside any paste framing.

Output: A single fork-patch-style commit (patch #118) on
`feat/tab-title-from-tmux` that modifies `src/backend/ssh/terminal.ts`
only, plus an updated `skynet-patches.md` catalog entry (identity dir,
not committed to the repo).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

# The single file we're modifying
@src/backend/ssh/terminal.ts

# Session shape — sshConn + tmuxSessionName are cached per-session here
@src/backend/ssh/terminal-session-manager.ts

# Confirms sshConn.exec surface — one-shot helper is NOT used here (we
# reuse the already-connected session sshConn), but this file shows
# the exec-over-ssh2-Client pattern the fork already uses.
@src/backend/ssh/ssh-one-shot.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement hybrid submit path — PTY-write body then send-keys Enter over exec on same sshConn</name>
  <files>src/backend/ssh/terminal.ts</files>
  <action>
Locate the pretty-view submit branch in the `case "input":` handler at approximately terminal.ts:509-557 — the `isPrettyViewSubmit && ... endsWith("\r")` branch that currently (a) writes `inputData.slice(0, -1)` (body without the CR) to the PTY, then (b) schedules a `setTimeout(() => inputStream.write("\r"), 250)` to deliver the CR as a delayed second PTY write.

Replace the delayed `inputStream.write("\r")` with a `tmux send-keys` exec dispatched over the SAME sshConn used by the current session. Keep the body PTY-write unchanged.

Concrete steps:

1. Above the existing branch, resolve the session ONCE at the top of the branch:
   - const session = currentSessionId ? sessionManager.getSession(currentSessionId) : null;
   - const tmuxTarget = session?.tmuxSessionName ?? null;
   - const submitConn = session?.sshConn ?? sshConn;
   - Cache these locals — do not re-look-up inside the setTimeout.

2. Keep the existing body-write block that writes `inputData.slice(0, -1)` as UTF-8 (with the latin1 fallback) exactly as-is. Do NOT change the drain / encoding logic — this is the load-bearing text delivery, patch #100's byte-identity there is what patch #43's SUMMARY hash-pins.

3. Replace the `setTimeout(() => { inputStream.write("\r"); ... }, 250)` block with a new `setTimeout(() => { ... }, 250)` that dispatches the Enter via tmux send-keys when possible, and falls back to the pre-patch CR-in-PTY write when it's not:

   - If `submitConn && tmuxTarget` are both truthy: invoke `submitConn.exec("tmux send-keys -t " + shellQuote(tmuxTarget) + " Enter", (err, stream) => { ... })`.
     - On err (exec failed to open, e.g. tmux binary missing on target or SSH channel closed): log at INFO level via sshLogger.info with operation "ssh_input_tmux_send_keys_fallback", include userId + tmuxTarget + err.message, then write "\r" to `inputStream` as the fallback so the message still submits with the old (flaky) behavior. Never silently regress.
     - On successful exec: attach a one-shot `stream.on("close", ...)` handler that logs at debug level (via sshLogger.debug or a comparable existing helper — grep the file for logger.debug usage first; if debug isn't already used in this file, drop to just closing the channel without an explicit log). Do NOT block on stream.on("data") — tmux send-keys writes nothing on success. Consume-and-discard any stdout/stderr to avoid backpressure on the exec channel.
     - If exec throws synchronously (e.g. sshConn was ended between the schedule and the fire): catch and fall back to `inputStream.write("\r")` with the same INFO-level warning.

   - If `submitConn` OR `tmuxTarget` is falsy: skip the exec entirely and write "\r" to `inputStream` as the fallback. This is the non-tmux-attached path — session hasn't been through tmux_attach, so we have no target name to give send-keys. Behavior matches pre-patch.

4. Add a shell-quoting helper inline (do not import a new lib). A minimal `shellQuote` that wraps the target in single quotes and escapes any embedded single quotes via `'\''` is sufficient — tmux session names in this fork are constrained by SESSION_NAME_PATTERN client-side (Plan 06-04 T-06-04-01) plus tmux itself rejects most special chars, but defense-in-depth here is cheap and avoids any command-injection surface if the pattern regresses. Keep the helper local to the file (module-scope const above the WS handler).

5. Update the block-comment above the branch to reflect the new mechanism. Preserve the patch #100 and #111 history lines (they're load-bearing context for anyone reading blame). Append a new paragraph documenting patch #118:
   - Note the empirical failure of #100/#111a delay-bump strategy (Ashley 2026-07-22T07:40Z UAT — non-paste-tagged message still hung).
   - Note the pinned root cause: CR arriving through the same PTY as the body bytes gets absorbed by Ink's paste-detection framing regardless of delay.
   - Note the fix mechanism: tmux send-keys dispatches Enter as a real keypress event outside the PTY paste framing.
   - Note the fallback: if the session isn't tmux-attached (no tmuxSessionName cached) or the send-keys exec fails, we write CR to the PTY exactly like the pre-patch path so non-tmux targets don't regress.
   - Note the multi-line preservation: because we strip only the trailing CR (not internal CRs/LFs) and dispatch Enter as a keypress, a 3-line message arrives as one submit with newlines intact (empirically validated in prototype).

6. Do NOT touch the atomic delete-on-send block at ~line 599 (`if (isPrettyViewSubmit && userId)`). That's patch #60 and stays byte-identical.

7. Do NOT touch the other branches of the `case "input":` handler (tab, escape sequences, generic UTF-8 write). Only the `isPrettyViewSubmit && endsWith("\r")` branch changes.

8. Type discipline: this file compiles under strict TS. `sshConn.exec` on ssh2's Client returns via a Node-style callback `(err: Error | undefined, channel: ClientChannel) => void`. Import `ClientChannel` from ssh2 if not already imported at the top of the file — check the existing imports first and reuse the imported symbols.

9. No new modules, no new files, no new deps. Backend-only change.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx tsc --noEmit --project tsconfig.json 2>&amp;1 | grep -E "terminal\.ts|error TS" | head -20</automated>
  </verify>
  <done>
- src/backend/ssh/terminal.ts compiles under strict TS with no new errors introduced.
- The `isPrettyViewSubmit && endsWith("\r")` branch writes body via existing PTY logic (unchanged), then after 250ms either dispatches `tmux send-keys -t <session> Enter` via `sshConn.exec` (when session is tmux-attached) OR falls back to `inputStream.write("\r")` (when session is not tmux-attached, when submitConn/tmuxTarget resolution failed, or when the exec errored).
- Fallback path logs a warning at INFO level via sshLogger with operation "ssh_input_tmux_send_keys_fallback" including userId + tmuxTarget + err.message.
- Comment above the branch documents patch #118: root cause, mechanism, fallback behavior, multi-line preservation guarantee.
- Grep confirms: `grep -c 'send-keys' src/backend/ssh/terminal.ts` returns at least 1 new match beyond any pre-existing ones (the pre-existing matches are all inside tmux-helper.ts template strings, so any hit in terminal.ts is new).
- Atomic delete-on-send block (patch #60) at ~line 599 is byte-identical (unchanged).
  </done>
</task>

<task type="auto">
  <name>Task 2: Commit patch #118 to feat/tab-title-from-tmux + update skynet-patches.md</name>
  <files>
    /home/ubuntu/.claude/identities/tina/skynet-patches.md,
    (git commit on feat/tab-title-from-tmux in /home/ubuntu/skynet)
  </files>
  <action>
Two parallel updates, both required before this task is done:

**A. Commit the code change to the fork branch.**

1. Confirm branch: `git -C /home/ubuntu/skynet branch --show-current` — should be `feat/tab-title-from-tmux`. If not, stop and surface to Ashley; do NOT switch branches automatically (fork discipline: rebase-safety is Ashley's call).

2. Stage ONLY the modified file: `git -C /home/ubuntu/skynet add src/backend/ssh/terminal.ts`.

3. Confirm nothing else got staged: `git -C /home/ubuntu/skynet diff --cached --name-only` should print exactly `src/backend/ssh/terminal.ts` and nothing else.

4. Commit with a fork-patch-style message. Study the recent commit style via `git -C /home/ubuntu/skynet log --oneline -10` — recent fork-patch commits look like `fix(compose): Phase 9 UAT round 1 — reset on LEFT, textarea min-h-8!, uniform-band meter (patch #117)` or `feat(09-02): rotate meter well 90° to horizontal, SEG_COUNT 11→12`. Match that shape:
   - Type: `fix(compose-submit)` or `fix(pty)` — pick the one closest to prior fork usage; if unsure, `fix(compose-submit)`.
   - Subject: `hybrid tmux send-keys Enter for pretty-view submit (patch #118)`.
   - Body (heredoc): explain the root cause pinned in this session (CR-in-PTY absorbed by Ink paste-detection framing regardless of delay), the mechanism swap (send-keys over exec on same sshConn), the fallback (write CR to PTY when non-tmux or exec fails), the empirical validation (10/10 prototype), and reference the bounty ID `messages-land-in-box-not-submitting` for cross-linking.
   - Do NOT include `Co-Authored-By: Claude` in fork-patch commits — the fork's numbered-patch style is single-author. Match prior fork commits.

5. Verify commit landed: `git -C /home/ubuntu/skynet log --oneline -1` should show the new patch #118 commit at HEAD.

6. Do NOT push. Do NOT run build-skynet.sh. Do NOT run `docker compose up`. Deploy is Ashley-gated and lives outside this quick task per fork DEPLOY DISCIPLINE.

**B. Update skynet-patches.md (identity dir — outside the repo, no commit).**

1. Read /home/ubuntu/.claude/identities/tina/skynet-patches.md.

2. Header patch-count bump: find the line reading `The branch carries ONE HUNDRED SEVENTEEN numbered patches on top of upstream main,` (near the top of the file) and change to `ONE HUNDRED EIGHTEEN`.

3. Add the patch #118 entry directly after the existing patch #117 entry (which currently ends the numbered-list block near line ~8121). Match the shape of #117's entry — a numbered list item with backticked commit subject, then indented prose describing motivation / root cause / fix mechanism / files touched / rebase risk. Include:
   - Numbered list entry: `` 118. `fix(compose-submit): hybrid tmux send-keys Enter for pretty-view submit (patch #118)` ``
   - Motivation: Ashley 2026-07-22T07:40Z UAT hit the messages-land-in-box-not-submitting bug on a non-paste-tagged message during Phase 9 UAT. Patches #100 (split-and-delay 50ms) and #111a (delay bump to 250ms) both tried to give Ink's paste-detection state machine enough headroom to exit paste mode before the CR arrived — never fully worked because CR arriving through the same PTY as body bytes is subject to the paste framing regardless of delay.
   - Root cause: Confirmed by hybrid-path prototype 2026-07-22T09:XXZ — text delivered via bracketed-paste PTY write with trailing CR gets treated as literal newline inside the paste framing by Ink. Only path that reliably fires submit is a real keyboard event outside the paste framing.
   - Fix mechanism: In `src/backend/ssh/terminal.ts` `case "input":` `isPrettyViewSubmit` branch, keep the body PTY-write unchanged, but replace the 250ms-delayed `inputStream.write("\r")` with a `sshConn.exec("tmux send-keys -t <session> Enter", ...)` dispatched on the SAME multiplexed SSH connection. tmux delivers Enter to the target process as a real keypress event, outside any paste framing.
   - Target discovery: uses the `tmuxSessionName` already cached per-session at `tmux_attach` time (see `TerminalSession` in `terminal-session-manager.ts`). No new lifecycle, no new WS event, no new DB column.
   - Fallback: if `session.tmuxSessionName` is null (session not tmux-attached) OR the `sshConn.exec` errors (tmux binary missing on target, SSH channel closed, etc.), falls back to writing "\r" to the PTY exactly like the pre-patch path. Logs at INFO level via sshLogger with operation `ssh_input_tmux_send_keys_fallback` including userId + tmuxTarget + err.message. Non-tmux SSH panes never regress; they retain the pre-patch (flaky) behavior but no regression.
   - Multi-line preservation: only the trailing CR is stripped (existing `slice(0, -1)`); internal CRs/LFs stay in the body PTY-write, so a 3-line pretty-view message arrives as one submit with newlines intact. Empirically validated in prototype.
   - Supersedes: The submit-timing logic from patch #100 (2026-07-20) and patch #111a (2026-07-21) is superseded by patch #118. Patches #100 and #111a remain in git history (fork discipline: no squashes) but their behavior is overwritten by #118.
   - Files touched: `src/backend/ssh/terminal.ts` only.
   - Rebase risk: LOW. The patch modifies one branch of one WS case-handler that has been touched by patches #60/#100/#110/#111a — all still land clean because #118 replaces the delayed-write body of the same conditional block, and #60's atomic-delete block (~line 599) is left byte-identical. If upstream ever refactors the `case "input":` handler shape, this patch needs a manual re-target — search for `isPrettyViewSubmit`.
   - Test coverage: no new automated tests. The fork's `Terminal.wiring.test.ts` covers the FRONTEND WS-shape (mqid + text+\\r single event) which is unchanged by this patch. Backend send-path is validated by manual UAT (10/10 single-line + multi-line preservation prototype 2026-07-22).

4. Update the "Patch drift caveat" file list (currently around line ~6652) — add `src/backend/ssh/terminal.ts` to the list of files with a callout that the `case "input":` handler now dispatches Enter via a fresh sshConn.exec ("tmux send-keys ... Enter") outside the PTY channel when the session is tmux-attached, and that any upstream rebase touching this case-handler needs to preserve the `isPrettyViewSubmit && endsWith("\\r")` branch's send-keys exec path or messages will silently stop submitting again.

5. This file lives OUTSIDE the git repo — no commit needed. Just Write to it. Confirm the update landed by grepping for `118` and for `ONE HUNDRED EIGHTEEN`.
  </action>
  <verify>
    <automated>git -C /home/ubuntu/skynet log --oneline -1 | grep -c "patch #118" &amp;&amp; grep -c "^   118\." /home/ubuntu/.claude/identities/tina/skynet-patches.md &amp;&amp; grep -c "ONE HUNDRED EIGHTEEN" /home/ubuntu/.claude/identities/tina/skynet-patches.md</automated>
  </verify>
  <done>
- Exactly one new commit exists at HEAD of feat/tab-title-from-tmux with subject matching `fix(compose-submit): hybrid tmux send-keys Enter for pretty-view submit (patch #118)` (or the closest fork-patch-style variant).
- `git diff HEAD~1 HEAD --name-only` shows exactly `src/backend/ssh/terminal.ts` and nothing else.
- skynet-patches.md header patch-count is `ONE HUNDRED EIGHTEEN`.
- skynet-patches.md has a numbered list entry `118.` with full per-patch write-up (motivation / root cause / fix / files touched / rebase risk / test coverage).
- skynet-patches.md "Patch drift caveat" file list mentions `src/backend/ssh/terminal.ts` with the send-keys exec callout.
- No push. No deploy. No build. Ashley-gated steps remain Ashley-gated.
  </done>
</task>

</tasks>

<verification>
End-to-end verification of this quick task (patch #118) is:

1. **Compile check** (Task 1 automated): `npx tsc --noEmit` produces no new errors in terminal.ts.
2. **Commit shape check** (Task 2 automated): HEAD commit on feat/tab-title-from-tmux has subject matching patch #118 convention; diff touches exactly src/backend/ssh/terminal.ts.
3. **Catalog update check** (Task 2 automated): skynet-patches.md has ONE HUNDRED EIGHTEEN in the header and a numbered `118.` entry in the patch list.
4. **Post-deploy manual verification (OUT OF SCOPE for this task — Ashley-gated):**
   - Build fork: `sudo bash /opt/skynet/skynet-patches/build-skynet.sh`
   - Deploy behind deadman: standard fork deploy runbook.
   - Manual UAT: open pretty view against a Claude Code target, send 10 normal messages, verify all submit reliably (target: 10/10, matching prototype).
   - Multi-line UAT: paste a 3-line message, verify it submits as ONE message with newlines preserved.
   - Fallback UAT: point a Skynet host at a target where tmux isn't attached (or kill the tmux session), send a message, verify the INFO-level warning fires AND the message still delivers via the CR-in-PTY fallback (retaining pre-patch flakiness but no regression).

This task ends at step 3. Steps 4a-4d are Ashley-gated deploy work.
</verification>

<success_criteria>
- src/backend/ssh/terminal.ts hybrid path implemented + compiles clean.
- Patch #118 commit landed at HEAD of feat/tab-title-from-tmux.
- skynet-patches.md updated (header count + numbered entry + drift caveat file list).
- No push, no build, no deploy — all Ashley-gated.
- Bounty `messages-land-in-box-not-submitting` remains in_progress until Ashley UATs the deployed patch; do NOT flip its status in this task.
</success_criteria>

<output>
Create `.planning/quick/260722-ctq-fix-messages-land-in-box-not-submitting-/260722-ctq-SUMMARY.md` when done, including:
- The exact commit SHA of patch #118.
- A confirming grep of `send-keys` in `src/backend/ssh/terminal.ts` showing the new match count.
- Confirmation that skynet-patches.md was updated (header + entry + drift caveat).
- Explicit note that deploy was NOT run (Ashley-gated).
</output>
