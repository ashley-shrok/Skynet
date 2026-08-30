---
quick: 260823-9tw
status: complete
branch: feat/tab-title-from-tmux
requirements:
  - BUG-260823-9tw
commits:
  red: 96db98c2
  green: 259e37aa
files_touched:
  - src/backend/claude-session/session-file-tail.ts
  - src/backend/claude-session/session-file-tail.test.ts
tests_added: 4  # A, B, C, D (net new assertions)
tests_replaced: 2  # old byte-for-byte Tests 1 and 2 replaced by regex-based A and B
tests_kept_as_regression: 2  # E (idempotent), F (stopped-before-exec-callback) — passed pre-fix, still pass
---

# 260823-9tw — SSH tail-watcher orphan-on-close fix (trap wrapper + explicit signal)

## Summary

Fixed the remote `tail -F` orphan leak in `session-file-tail.ts` that caused workstation
load 143 today (88 orphan tails, cascading systemd-logind failures). Root cause: OpenSSH
does not propagate `SSH_MSG_CHANNEL_CLOSE` as SIGHUP to the child (mindrot #1424), so
`stream.close()` alone leaves `tail -F` running as a PPID=1 orphan on every WS reconnect.

Two-prong fix landed as RED-then-GREEN atomic commits on `feat/tab-title-from-tmux`:

- **Prong A** — `stop()` calls `stream.signal("TERM")` BEFORE `stream.close()`. The signal
  call is wrapped in its own try/catch: a synchronous throw does not skip `close()`.
- **Prong B** — remote command becomes a POSIX `sh -c` wrapper that traps
  `EXIT INT HUP TERM` and kills the backgrounded `tail -F` PID. When the parent shell dies
  (SIGHUP on channel close, or stdout write failure), the trap fires regardless of what the
  server propagated.

Also removed the dead `else` branch that fell back to `signal("KILL")` + `end()` when
`close` was unavailable — modern ssh2 always exposes `close`, and the trap wrapper is the
real teardown mechanism. Two new INFO logs (`session_file_tail_stop`,
`session_file_tail_signal_threw`) give operators a timeline correlated with SSH channel
events.

## Files touched

| File                                                       | Change                           | Commit      |
| ---------------------------------------------------------- | -------------------------------- | ----------- |
| `src/backend/claude-session/session-file-tail.test.ts`     | RED: 4 new + 2 replaced tests    | `96db98c2`  |
| `src/backend/claude-session/session-file-tail.ts`          | GREEN: trap wrapper + signal-then-close + INFO logs | `259e37aa` |

## Test count

- **Added:** 4 (Test C signal-order, Test D signal-throws-close-still-runs, plus Tests E and F which are pre-existing behaviors surfaced as regression controls). Total new `it()` blocks: 6 (A, B, C, D, E, F).
- **Replaced:** 2 (old Tests 1 and 2 that byte-for-byte pinned `tail -F -n +1 <path>` — coverage preserved by Tests A and B via regex/`toContain`, tolerant to the wrapper).
- **RED evidence:** `/tmp/9tw-red.txt` — 4 failed / 2 passed (A, B, C, D failed as designed; E and F passed as regression controls). Pattern proves the tests genuinely exercise the fix.

## Scoped test results (post-GREEN)

- `npx vitest run src/backend/claude-session/session-file-tail.test.ts` — **6/6 pass**. Log: `/tmp/9tw-green.txt`.
- `npx vitest run src/backend/claude-session/claude-session-server.dormant-tail.test.ts` (tightly-coupled — identified via `grep -rln "session-file-tail\|tailSessionFile" src/backend`) — **7/7 pass**.
- `npx tsc --noEmit` — clean exit 0.
- `npm run build:backend` — clean exit 0.

## Comment-stripped shape checks

Plan `<verification>` sanity greps:

- `grep -v '^\s*\*' src/backend/claude-session/session-file-tail.ts | grep -c "sh -c"` → **2** (both real code, JSDoc mentions correctly stripped).
- `grep -v '^\s*\*' src/backend/claude-session/session-file-tail.ts | grep -c 'signal("TERM")'` → **0**.
  - **Deviation note (benign):** the actual call site uses optional-chain syntax `stream.signal?.("TERM")`, not `signal("TERM")`. The plan's grep regex is over-literal; `grep -n 'signal.*TERM'` confirms the TERM signal call is present at line 50 and precedes `stream.close?.()` at line 56. Test C additionally locks the signal-before-close call order at the assertion layer, which is stronger than the grep.

## Decisions / edge cases

1. **Optional-chain on signal call.** I used `stream.signal?.("TERM")` rather than `stream.signal("TERM")` to preserve compatibility with the loose stream type (`signal?: (signal: string) => void`) already established in the file. Tests exercise the signal-present branch explicitly, so the optional-chain does not weaken coverage. If someday the ssh2 typings are tightened to require `signal`, this can drop the `?.` without touching tests.
2. **`stream.close?.()` also uses optional-chain**, mirroring the pre-existing pattern and the loose stream type. Test C asserts `close` was called exactly once, so a missing `close` method would surface loudly there.
3. **Outer try/catch around the signal-then-close block kept** as a defense-in-depth net. The inner try/catch around `signal` is the one the plan mandates; the outer one catches any weirdness from `close()` itself. Documented in code comments.
4. **JSDoc updated** — the "Two design choices worth naming" list is now three, with the new bullet explaining OpenSSH channel-close semantics, mindrot #1424, and why both prongs are needed together. Future maintainers should not need to re-derive this.
5. **Regression controls kept as-is.** Tests E (idempotence) and F (stopped-before-exec-callback) pass against BOTH the old and new implementations. They lock behavior that must NOT regress; keeping them explicit in the file catches any accidental future removal of the `if (stopped) return;` guards.

## Fleet-rule compliance

- **NO worktree:** all commits on `feat/tab-title-from-tmux` in the main tree.
- **NO `git push`:** confirmed — orchestrator handles ship-time push.
- **NO Docker:** none run.
- **NO full-suite vitest:** only `session-file-tail.test.ts` and `claude-session-server.dormant-tail.test.ts` (the one file that imports the module) were run. Ashley 2026-08-20 rule respected.
- **NO `~/.claude/roles/box-maintainer/skynet-patches.md` touch:** confirmed.
- **NO `--no-verify` / `--no-gpg-sign`:** both commits used the default hook path.
- **Atomic commits:** RED test-only commit at `96db98c2` landed BEFORE the GREEN implementation commit at `259e37aa`.
- **Logging:** two INFO logs added (stop-entry + signal-throw), no new WARN/ERROR paths.
- **POSIX shell only:** `trap`, `EXIT INT HUP TERM`, `&`, `$!`, `wait $t` — all POSIX. No bashisms.

## Expected fleet effect (operator-verifiable, out of scope of this task)

Future WS reconnects to remote hosts (workstation, thenasty, AWS boxes) should no longer
leave PPID=1 `tail -F` orphans behind. Operator can verify post-deploy with
`ssh <host> "ps -ef | grep 'tail -F' | grep -v grep | awk '\$3 == 1'"` — expected count is 0
after a full reconnect cycle. Existing orphans from before the deploy will remain and can
be `pkill -f "tail -F -n \+1"` cleaned once (they will not be re-created).

## Self-Check: PASSED

- `src/backend/claude-session/session-file-tail.ts` exists and contains the trap wrapper (line 108-111) and signal-then-close teardown (lines 42-63): **FOUND**.
- `src/backend/claude-session/session-file-tail.test.ts` exists with all 6 tests: **FOUND**.
- Commit `96db98c2` (RED) present in `git log --oneline`: **FOUND**.
- Commit `259e37aa` (GREEN) present in `git log --oneline`: **FOUND**.
- Scoped vitest green (6/6). Tightly-coupled dormant-tail green (7/7). Typecheck + backend build clean.
