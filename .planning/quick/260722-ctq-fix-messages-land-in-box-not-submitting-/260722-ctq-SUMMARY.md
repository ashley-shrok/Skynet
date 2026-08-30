---
phase: 260722-ctq
plan: 01
subsystem: ssh-terminal
tags: [pretty-view, submit, tmux, send-keys, patch-118, fork]
tech_stack:
  added: []
  patterns:
    - "hybrid PTY-write + tmux send-keys Enter over separate exec channel on the same multiplexed sshConn"
    - "shellQuote() defense-in-depth for tmux target names (local, no new deps)"
    - "INFO-level fallback logging via sshLogger with operation ssh_input_tmux_send_keys_fallback"
key_files:
  created: []
  modified:
    - src/backend/ssh/terminal.ts
    - /home/ubuntu/.claude/identities/tina/skynet-patches.md
decisions:
  - "Enter is dispatched as a real keypress via `tmux send-keys` over a fresh exec on the SAME sshConn, NOT via the PTY channel — Ink's paste-detection framing absorbs any CR-in-PTY regardless of delay (root cause pinned this session)."
  - "Fallback to CR-in-PTY when session is not tmux-attached OR the exec errors — non-tmux SSH panes retain pre-patch (flaky) behavior but NEVER regress."
  - "shellQuote() kept local to terminal.ts (single-quote wrap + `'\\''` escape) — no new dep, defense-in-depth against SESSION_NAME_PATTERN regression."
  - "Body PTY-write and patch #60 atomic delete-on-send block left BYTE-IDENTICAL — patch #43 SUMMARY hash-pin and #60 semantics preserved."
metrics:
  duration: "~35 min"
  completed_date: "2026-07-22"
---

# Phase 260722-ctq Plan 01: Fix messages-land-in-box-not-submitting Summary

Replaced the CR-in-PTY submit tail on the pretty-view `case "input":`
branch with a hybrid path — body still goes through the existing PTY
write, but the confirming Enter is now dispatched as a real keypress
via `tmux send-keys -t <session> Enter` over a separate exec channel
on the same multiplexed sshConn. Committed as patch #118 to
`feat/tab-title-from-tmux` (backend-only, one file, no new deps).

## What was built

**Patch #118 commit:** `7d6506faa2cd9e958d3e9c4114066ca050f64a21`
(short SHA: `7d6506f`)

**Commit subject:** `fix(compose-submit): hybrid tmux send-keys Enter for pretty-view submit (patch #118)`

**Diff scope:**
```
$ git diff HEAD~1 HEAD --name-only
src/backend/ssh/terminal.ts
```
Exactly one file, as required by the plan.

**`send-keys` occurrences in terminal.ts (new — pre-patch was 0):**
```
$ grep -c "send-keys" src/backend/ssh/terminal.ts
8
```
All 8 matches are inside the new patch #118 block (comment references
+ exec command string + fallback log context). Pre-patch, all
`send-keys` references in the codebase lived in `tmux-helper.ts`
template strings — none in `terminal.ts`. So any hit in terminal.ts
is new-to-#118.

## Files touched

### `src/backend/ssh/terminal.ts` — backend-only, one branch of one WS handler

1. **Module-scope `shellQuote()` helper** added above `wss` construction
   (~line 115). Wraps target in single quotes, escapes embedded single
   quotes via `'\''`. Defense-in-depth for the `tmux send-keys -t
   <session>` target.
2. **`case "input":` `isPrettyViewSubmit && endsWith("\r")` branch**
   (~line 509+):
   - Body PTY-write (`inputStream.write(Buffer.from(body, "utf8"))`
     on `slice(0, -1)`) UNCHANGED — byte-identical to patch #100.
   - `setTimeout(..., 250)` still fires 250ms after the body write.
   - Inside the setTimeout: resolve `session`, `tmuxTarget`,
     `submitConn` locals, then either:
     - **When `submitConn && tmuxTarget` both truthy:** invoke
       `submitConn.exec("tmux send-keys -t <shellQuote(tmuxTarget)>
       Enter", ...)` on the SAME multiplexed sshConn. Attach
       consume-and-discard `data` / `stderr` handlers, `close` closes
       the channel, `error` triggers fallback.
     - **When `submitConn` or `tmuxTarget` is falsy** (session not
       tmux-attached): fall straight to `inputStream.write("\r")` —
       preserves pre-patch behavior for raw SSH panes.
     - **On exec err or sync throw:** falls back to
       `inputStream.write("\r")` with an INFO-level
       `sshLogger.info` log, operation
       `ssh_input_tmux_send_keys_fallback`, including `userId`,
       `tmuxTarget`, `reason` (`exec_open_failed` /
       `exec_stream_error` / `exec_sync_throw`), and `err.message`.
3. **Comment block above the branch** preserves the historical #100
   and #111 rationale (load-bearing blame context) and appends the
   #118 paragraph documenting root cause, mechanism, fallback, and
   multi-line preservation guarantee.
4. **Atomic delete-on-send block (patch #60)** at the tail of the
   handler is BYTE-IDENTICAL. Confirmed via grep:
   `grep -n "isPrettyViewSubmit && userId\|Atomic delete-on-send"
   src/backend/ssh/terminal.ts` returns lines 716 (comment) + 724
   (guard) — the block itself is unmoved beyond the line-number
   shift caused by the earlier insertion.

### `/home/ubuntu/.claude/identities/tina/skynet-patches.md` — catalog (outside repo, no commit)

1. Header patch-count bumped: `ONE HUNDRED SEVENTEEN` → `ONE HUNDRED EIGHTEEN`.
2. New numbered entry `118.` appended after #117, following the
   #117 shape (numbered-list item + indented per-patch write-up
   with motivation / root cause / fix / target discovery /
   shell-quoting / fallback / multi-line / supersedes / files /
   test coverage / rebase risk).
3. "Patch drift caveat" `src/backend/ssh/terminal.ts` block updated
   with the patch #118 callout — describes the `case "input":`
   handler change, the `shellQuote()` helper, the fallback path,
   and flags that any upstream rebase touching the
   `isPrettyViewSubmit && endsWith("\r")` branch must preserve the
   send-keys exec path or messages silently stop submitting again.

Verification greps:
```
$ grep -c "ONE HUNDRED EIGHTEEN" /home/ubuntu/.claude/identities/tina/skynet-patches.md
1
$ grep -c "^   118\." /home/ubuntu/.claude/identities/tina/skynet-patches.md
1
$ grep -c "patch 118 replaces the setTimeout tail" /home/ubuntu/.claude/identities/tina/skynet-patches.md
1
```
All three markers land exactly once.

## Verification results

**Task 1 automated verify (compile check):**
```
$ npx tsc --noEmit --project tsconfig.json 2>&1 | grep -E "terminal\.ts|error TS" | head -20
(empty output — no errors introduced)
```
Clean compile under strict TS.

**Task 2 automated verify (commit shape + catalog):**
```
$ git log --oneline -1 | grep -c "patch #118"
1
$ grep -c "^   118\." /home/ubuntu/.claude/identities/tina/skynet-patches.md
1
$ grep -c "ONE HUNDRED EIGHTEEN" /home/ubuntu/.claude/identities/tina/skynet-patches.md
1
```
All three checks return `1`.

**Diff scope:**
```
$ git diff HEAD~1 HEAD --name-only
src/backend/ssh/terminal.ts
```
Exactly one file — no accidental drift.

## Deviations from Plan

None — plan executed exactly as written. Notes:

- Plan step 3 mentioned "attach a one-shot `stream.on("close", ...)`
  handler that logs at debug level (via sshLogger.debug or a
  comparable existing helper — grep the file for logger.debug usage
  first; if debug isn't already used in this file, drop to just
  closing the channel without an explicit log)". Grep confirmed
  `sshLogger.debug` is NOT used anywhere in terminal.ts (all logging
  is `.info` / `.warn` / `.error` / `.success`). Per the plan's
  fallback instruction, the `close` handler just calls
  `channel.end()` inside a try/catch and moves on — no explicit
  log.
- The pre-existing `sshLogger.error` "Delayed Enter write failed"
  path from patch #111a was preserved as the write-error safety
  net inside both the tmux-attached fallback branch AND the
  non-tmux-attached branch. Both branches share the same defensive
  write structure so any inputStream failure gets logged
  consistently.

## Auth gates encountered

None — this is a pure backend code change on a checked-out branch,
no external service calls.

## Deploy status

**NOT DEPLOYED** — Ashley-gated per CLAUDE.md deploy discipline and
per the plan's `<what_to_do>` step 1 hard constraint. This task ends
at "commit landed at HEAD of feat/tab-title-from-tmux".

Post-deploy manual UAT (out of scope for this quick task, per plan
`<verification>` section 4):
1. Build fork: `sudo bash /opt/skynet/skynet-patches/build-skynet.sh`
2. Deploy behind the 15-min deadman: standard fork deploy runbook.
3. Open pretty view against a Claude Code target, send 10 normal
   messages, verify all submit reliably (target: 10/10, matching
   local prototype).
4. Paste a 3-line message, verify it submits as ONE message with
   newlines preserved.
5. Point a Skynet host at a target where tmux isn't attached (or
   kill the tmux session), send a message, verify the INFO-level
   `ssh_input_tmux_send_keys_fallback` warning fires AND the
   message still delivers via the CR-in-PTY fallback (retaining
   pre-patch flakiness but no regression).

Bounty `messages-land-in-box-not-submitting` remains **in_progress**
until Ashley UATs the deployed patch (do NOT flip status here per
plan `<success_criteria>`).

## Self-Check: PASSED

- FOUND: src/backend/ssh/terminal.ts (modified, staged, committed)
- FOUND: commit 7d6506f (git log --oneline -1)
- FOUND: patch #118 entry in /home/ubuntu/.claude/identities/tina/skynet-patches.md
- FOUND: ONE HUNDRED EIGHTEEN header in /home/ubuntu/.claude/identities/tina/skynet-patches.md
- FOUND: drift caveat update for src/backend/ssh/terminal.ts (patch 118 callout)
- CONFIRMED: no push, no build, no deploy — all Ashley-gated steps remain Ashley-gated.
