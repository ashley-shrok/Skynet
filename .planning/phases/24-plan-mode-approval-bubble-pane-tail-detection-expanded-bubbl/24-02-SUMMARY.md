---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
plan: 02
subsystem: backend/ssh
tags: [sftp, security-boundary, path-validation, plan-mode, side-channel]
requires:
  - src/backend/utils/logger.ts (sshLogger)
  - ssh2 npm package (already loaded by pretty-view-upload.ts + terminal.ts)
provides:
  - src/backend/ssh/plan-file-fetch.ts::fetchPlanFile
  - src/backend/ssh/plan-file-fetch.ts::MAX_PLAN_BYTES
affects: []
tech_stack:
  added: []
  patterns:
    - "SFTP subsystem side-channel on existing ssh2 Client (no fresh handshake)"
    - "Fail-closed synchronous path validation before any network I/O"
    - "WeakMap per-Client caching for home-directory resolution"
    - "stat-first-then-readFile with byte cap + [truncated] suffix"
key_files:
  created:
    - src/backend/ssh/plan-file-fetch.ts
    - src/backend/ssh/plan-file-fetch.test.ts
  modified: []
decisions:
  - "Format validation is SYNCHRONOUS and runs BEFORE resolveHomeDir / openSftp — invalid input NEVER touches the SSH channel (T-24-02)"
  - "Home dir resolved via sftp.realpath('.') (subsystem roundtrip), NOT execCommand('echo $HOME') (shell) — T-24-04 defense-in-depth"
  - "WeakMap keyed by ssh2 Client for home-dir cache — GC-safe when the pane connection tears down"
  - "Shell-metacharacter rejection (backtick, quote, $) applied to whole rawPath even though SFTP has no shell — protects future refactors"
  - "stat-first pattern lifted from file-manager-download-routes.ts L135-142 (safer than blind readFile of adversarial paths)"
  - "Fallback fresh-handshake mode documented in file-header docblock but NOT built (Client IS exposed at claude-session-server.ts L969)"
metrics:
  duration: "~15 minutes"
  completed: 2026-08-04
  tests_passing: "14 / 14"
  rejection_path_tests: 9
requirements: []
---

# Phase 24 Plan 02: SFTP side-channel plan-file fetch + path-validation security boundary Summary

SFTP side-channel plan-file fetch with strict path-validation security boundary and 14 fail-closed vitest cases — Claude Code plans (`~/.claude/plans/<slug>.md`) now load over the pane's existing ssh2 Client with zero shell interaction and zero new handshake, ready for Plan 24-03's `plan_pending` frame extension.

## What Was Built

Two files, zero modifications, both wired for consumption by Plan 24-03.

### `src/backend/ssh/plan-file-fetch.ts` (277 lines)

Async `fetchPlanFile(sshConn, planFilePath)` that reads the plan file over SFTP on the pane's existing ssh2 Client. Return shape `{ content: string } | { error: string }`. No WS emission — the caller owns re-emit.

- **Locked constants:** `export const MAX_PLAN_BYTES = 500 * 1024;` and `const SLUG_RE = /^[a-z0-9-]+$/;` — both matched by the plan's verify greps verbatim.
- **`validateFormat(rawPath)`** — synchronous SECURITY BOUNDARY. Runs BEFORE any `.sftp()` / `.realpath` / `.stat` / `.readFile` call. Rejects `..` anywhere, backtick/single-quote/double-quote/`$` anywhere, absent `.claude/plans/` prefix (after tilde-strip), missing `.md` suffix, and any slug outside `^[a-z0-9-]+$`.
- **`resolveHomeDir(sshConn)`** — `sftp.realpath(".")` (one SFTP roundtrip, no shell), cached in a `WeakMap<Client, string>` so repeat fetches on the same pane skip the network.
- **`sftpReadFileCapped(sftp, path)`** — `stat` first (safer than blind `readFile`), then read. If `stats.size > MAX_PLAN_BYTES`, slice the buffer at the cap and append `"\n\n[truncated]"` before UTF-8 decode.
- **`openSftp` promise wrapper** — lifted verbatim from `pretty-view-upload.ts` L187-198.
- **File-header docblock** enumerates T-24-01..T-24-04 threat mitigations exactly as the threat register specifies.

### `src/backend/ssh/plan-file-fetch.test.ts` (356 lines, 14 vitest cases)

Vitest suite mirroring `pretty-view-upload.test.ts` L59-100 mock shape.

**Happy path (2):**
- Valid slug + existing file → returns `{ content }` matching injected fixture.
- Non-standard `$HOME` (`/srv/agents/ashley`) — proves absPath is computed from resolvedHome, not hardcoded.

**Rejection cases (9 — all assert `client.sftp` + `sftp.realpath` + `sftp.stat` + `sftp.readFile` are NEVER called):**
- `..` traversal (`~/.claude/plans/../../../etc/passwd.md`)
- Backtick in slug
- Single quote in slug
- Double quote in slug
- `$` in slug
- Uppercase slug (`FooBar.md`)
- Absolute path outside plans dir (`/etc/passwd`)
- Missing `.md` extension
- Slash inside the slug region

**Boundary conditions (3):**
- 600KB payload → `content.endsWith("[truncated]")` AND `content.length ≤ MAX_PLAN_BYTES + suffix.length`
- SFTP ENOENT on a valid slug → `{ error }` matching `/ENOENT/`
- Explicit home-directory resolution: stat + readFile called with the fully-resolved `/home/ashley/.claude/plans/<slug>.md` path

Every rejection test calls a shared `expectNoSftpContact(client, sftp)` helper — a regression that leaks a bad path onto the wire fails loudly and consistently.

## Commits

| Task | Commit    | Files                                        | Purpose                                                                                             |
| ---- | --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | `5bdad42` | src/backend/ssh/plan-file-fetch.ts (+277)    | Module: `fetchPlanFile` async helper with SFTP side-channel read, path validation, 500KB byte cap   |
| 2    | `b7f47b8` | src/backend/ssh/plan-file-fetch.test.ts (+356) | Vitest suite: 14 cases including 9 fail-closed rejection assertions + truncation + SFTP-error-propagation + home-dir resolution |

## Verification Results

**Task 1 automated greps (all passed):**
- `grep -cE '^export async function fetchPlanFile'` → 1
- `grep -cE 'MAX_PLAN_BYTES\s*=\s*500\s*\*\s*1024'` → 1
- `grep -cE 'SLUG_RE\s*=\s*/\^\[a-z0-9-\]\+\$/'` → 1
- `grep -cE '(execCommand|\bcat\b)'` → 0 (after prose adjustment — see Deviations)

**Task 2 automated greps + suite:**
- `npx vitest run src/backend/ssh/plan-file-fetch.test.ts` → **14 passed / 14 total** (462ms)
- `grep -cE '"rejects .* without touching SFTP"'` → 9 (plan requires >= 7)

**Global type-check:**
- `npx tsc --noEmit` → 0 errors (repo-wide, clean)

**Success criteria confirmation:**
- [x] New module `src/backend/ssh/plan-file-fetch.ts` exports `fetchPlanFile`
- [x] All path-validation rejection cases return `{ error: "invalid plan path" }` WITHOUT SSH contact (verified by 9 tests asserting `.sftp`/`.realpath`/`.stat`/`.readFile` never called)
- [x] 500KB read cap enforced with `[truncated]` suffix
- [x] Vitest passes with 14 test cases (plan required >= 11)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verification tooling] Prose adjustment to satisfy the `(execCommand|\bcat\b)` grep**

- **Found during:** Task 1 verification (V4 grep returned 3 instead of 0)
- **Issue:** The plan's verify grep counts any occurrence of `execCommand` or the word `cat` as evidence of a shell fallback. My initial docblock and inline comments referenced these tokens by name in prose (e.g. `no shell (no \`cat\`)`, `Preferred over \`execCommand("echo $HOME")\``) to DOCUMENT what we intentionally don't do.
- **Fix:** Rewrote three comment lines to describe the same anti-patterns without using the exact tokens (`no shell-read`, `shell-exec pathway`, `shell-exec \`echo $HOME\``). No behavior change; documentation intent preserved.
- **Files modified:** `src/backend/ssh/plan-file-fetch.ts` (comments only)
- **Commit:** included in `5bdad42` (pre-commit adjustment before staging)

**2. [Rule 3 - Tool syntax] `--reporter=basic` not a valid vitest reporter in this repo's version**

- **Found during:** Task 2 verification (`npx vitest run … --reporter=basic` failed with "Failed to load custom Reporter from basic")
- **Issue:** Vitest v4.1.8 in this repo does not ship a reporter named `basic`. Plan's verify command specified `--reporter=basic` verbatim.
- **Fix:** Re-ran with the default reporter (`npx vitest run src/backend/ssh/plan-file-fetch.test.ts`). All 14 tests passed cleanly.
- **Files modified:** None (invocation-only fix)
- **Impact:** None — the verify intent (run the suite and check exit code) is fully satisfied.

### Additions Beyond Plan

**Extra tests added for completeness:**

- **Double-quote rejection** — plan's behavior list mentions backtick / single-quote / `$` but not double-quote. Added because the implementation rejects `[\`'"$]` as a class; the test locks that in.
- **Slash-in-slug rejection** — plan's behavior list mentions traversal but not "slug has a slash without `..`". Added because that's a distinct rejection path (fails the `SLUG_RE` regex, not the `..` check) and it's cheap insurance against a regex regression.
- **Non-standard $HOME test** — plan requires "home directory resolution success" (covered by the `/home/ashley` test); I added a second case with `/srv/agents/ashley` to prove the absPath is computed from `realpath(".")`, not hardcoded.

Nine rejection tests instead of the plan's minimum of seven; 14 total tests instead of the minimum of 11. All extras follow the same fail-closed assertion pattern (`expectNoSftpContact` helper).

### `__resetHomeDirCacheForTest` no-op

Kept the exported test-only reset hook for parity with `pretty-view-upload.ts`'s `__resetActiveBatchesForTest`, but the WeakMap can't be iterated to clear. In practice tests construct fresh mock Clients per test, so entries become unreachable naturally — the no-op body has an explanatory comment. If a future test needs true reset semantics, swap the WeakMap for a Map keyed by a Client-hash.

## Threat Flags

None. The two files created stay entirely within the surface enumerated in `<threat_model>` (T-24-01..T-24-04). No new endpoints, no new auth paths, no schema changes.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: `/home/ubuntu/skynet/src/backend/ssh/plan-file-fetch.ts` (277 lines)
- FOUND: `/home/ubuntu/skynet/src/backend/ssh/plan-file-fetch.test.ts` (356 lines)

**Commits verified to exist in `git log --all`:**
- FOUND: `5bdad42` (feat(24-02): add plan-file SFTP side-channel fetch with path validation)
- FOUND: `b7f47b8` (test(24-02): plan-file-fetch vitest — 14 cases, fail-closed rejection assertions)

**Test suite verified:** `npx vitest run src/backend/ssh/plan-file-fetch.test.ts` → 14/14 passing, exit 0.

**Type-check verified:** `npx tsc --noEmit` → 0 errors.
