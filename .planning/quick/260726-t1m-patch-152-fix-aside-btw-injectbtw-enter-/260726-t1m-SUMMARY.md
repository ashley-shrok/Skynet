---
phase: 260726-t1m-patch-152-fix-aside-btw-injectbtw-enter-
plan: "01"
subsystem: claude-session/aside
tags: [patch-152, injectBtw, tmux, bracketed-paste, tdd, quick]
dependency_graph:
  requires: []
  provides: [injectBtw-two-call-shape]
  affects: [aside-pipeline, btw-overlay-submission]
tech_stack:
  added: []
  patterns: [test-seam-re-export, fake-timers-gate]
key_files:
  created: []
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.aside.test.ts
decisions:
  - "Patch #152: split injectBtw into two execCommand calls with 200ms gap — bracketed-paste-mode absorption hypothesis confirmed live against Claude Code v2.1.150"
  - "Test assertion uses __asideShellQuoteForTests(BTW_PROMPT) rather than raw BTW_PROMPT since shellQuote escapes apostrophes (whatever's, don't) — toContain requires exact substring match"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-26T21:01:00Z"
  tasks: 1
  files: 2
---

# Phase 260726-t1m Plan 01: Patch #152 — Fix injectBtw Enter Absorption Summary

**One-liner:** Split injectBtw from one send-keys call into two (text then 200ms then Enter) to prevent Claude Code v2.1.150 Ink REPL from absorbing Enter into paste buffer.

## What Was Built

### Source change (`claude-session-server.ts`)

Replaced the single `execCommand` in `injectBtw` (which sent `tmux send-keys -t <target> "<BTW_PROMPT>" Enter` as one atomic call — ~300 chars that Claude Code's Ink REPL treated as a paste, absorbing the trailing Enter) with:

1. `await execCommand(conn, \`tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_PROMPT)}\`)` — text only, no trailing Enter
2. `await new Promise((resolve) => setTimeout(resolve, 200))` — 200ms gap lets Ink paste buffer flush
3. `await execCommand(conn, \`tmux send-keys -t ${shellQuote(tmuxSession)} Enter\`)` — Enter as a distinct keystroke

Both calls remain inside the original `try { ... } catch (err) { sshLogger.info(...) }` so log-and-swallow is preserved for both calls (including partial failure where text lands but Enter throws).

Added `export const __injectBtwForTests = injectBtw` test seam (same underscore-prefix convention as existing `__asideShellQuoteForTests`).

Added explanatory comment block referencing the 2026-07-26 live reproduction and the bounty path.

### Test additions (`claude-session-server.aside.test.ts`)

Added `vi.mock("../ssh/tmux-helper.js", () => ({ execCommand: vi.fn() }))` at module level (inert for existing tests that don't call execCommand).

Added 4 new assertions in new describe block "Phase 14 Patch #152 — injectBtw two-call shape":

- **Test 1:** `execCommand` called exactly twice; call #1 contains shellQuote(BTW_PROMPT) and does NOT end with " Enter"; call #2 ends with " Enter" and does NOT contain shellQuote(BTW_PROMPT).
- **Test 2:** Fake-timers gate — at 199ms only 1 call has fired; at 200ms call #2 fires. Locks the delay AT 200ms.
- **Test 3A:** Call #1 throws → function resolves without rethrowing (log-and-swallow).
- **Test 3B:** Call #1 succeeds, call #2 throws → function still resolves (log-and-swallow covers both paths).

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `ed36f4b` | RED test | `test(quick/260726-t1m): add failing tests for injectBtw two-call shape` |
| `0d333d4` | GREEN fix | `fix(quick/260726-t1m): split injectBtw into text + Enter with 200ms gap for Claude Code v2.1.150 REPL paste-mode` |

## Verification Results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | Exit 0 — clean |
| `npx vitest run claude-session-server.aside.test.ts` | 25/25 pass (21 pre-existing + 4 new) |
| `npx vitest run claude-session-server.aside.integration.test.ts` | 5/5 pass (collateral-damage gate) |
| `npx vitest run` (full suite) | 600/600 pass (was 596, +4 new) |
| `npm run build` | Exit 0, built in 4.21s |
| `grep setTimeout dist/backend/...claude-session-server.js` | `setTimeout(resolve, 200)` found — two-call form shipped |
| `git diff --name-only` | Exactly 2 files: `claude-session-server.ts` + `claude-session-server.aside.test.ts` |

## Diff Size

- `claude-session-server.ts`: +20 lines (6-line comment block + 3-line impl + 1-line delete old + 4-line export) — within the ~25-line sanity bound
- `claude-session-server.aside.test.ts`: +108 lines (vi.mock + import + 4 tests)
- Total: 126 insertions, 2 deletions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion used raw BTW_PROMPT instead of shellQuote(BTW_PROMPT)**

- **Found during:** GREEN verification (Test 1 failure after implementation)
- **Issue:** The plan's `<behavior>` block said "contains BTW_PROMPT (imported from the module)". However `injectBtw` applies `shellQuote(BTW_PROMPT)` which escapes the apostrophes in "whatever's" and "don't" via POSIX `'\''` idiom — making the raw BTW_PROMPT string NOT a substring of the command string.
- **Fix:** Changed `expect(cmd1).toContain(BTW_PROMPT)` to `expect(cmd1).toContain(__asideShellQuoteForTests(BTW_PROMPT))` (and the negation on cmd2). The same function (`shellQuote`) produces identical output so the semantic assertion is equivalent — we're verifying the payload IS the BTW_PROMPT content, just properly quoted.
- **Files modified:** `claude-session-server.aside.test.ts` (test fix only, no source change)
- **Commit:** Folded into `0d333d4` (GREEN commit, same task)

## Known Stubs

None — injectBtw now calls real execCommand via two concrete calls; no placeholder values.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Bounty Update

Updated `~/.claude/identities/tina/bounties/aside-btw-enter-not-submitting/bounty.json`:
- Timeline entry appended with commit SHA and test count
- First two todos marked `done: true` (ship fix, update tests)
- Remaining todos (rebuild+deploy, Ashley UAT, pin) unchanged — pending Phase 14 bundled deploy

## Self-Check: PASSED

- `src/backend/claude-session/claude-session-server.ts` exists and contains `__injectBtwForTests` and `setTimeout(resolve, 200)`
- `src/backend/claude-session/claude-session-server.aside.test.ts` exists and contains `__injectBtwForTests`
- Commits `ed36f4b` and `0d333d4` exist on branch `feat/tab-title-from-tmux`
- 600/600 tests pass, tsc clean, build succeeds
- Only 2 files modified (scope locked)
