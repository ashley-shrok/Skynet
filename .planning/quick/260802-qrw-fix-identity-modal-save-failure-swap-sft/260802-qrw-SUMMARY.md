---
phase: 260802-qrw
plan: 01
subsystem: backend/claude-session/identity-artifact-reader
tags: [bugfix, sftp, ssh2, identity-modal, atomic-rename, tdd]
requires: []
provides:
  - writeMarkdownFileAtomic-uses-ext_openssh_rename
  - remote-writes-regression-test
affects:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts
tech-stack:
  added: []
  patterns:
    - vi.mock("../ssh/tmux-helper.js") to stub execCommand → "/home/tester\n"
    - throwing-trap mock: rename: vi.fn(() => { throw ... }) as regression pin
    - posix-rename@openssh.com SFTP extension (POSIX rename(2) semantics)
key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
decisions:
  - "Use sftp.ext_openssh_rename (posix-rename@openssh.com) unconditionally — every OpenSSH ≥5.1 (2008+) advertises it; Ashley's fleet is fully modern; a fallback would add an untestable code path."
  - "Pin the fix with a throwing rename trap in the mock so a future revert to sftp.rename fails LOUDLY with a diagnostic that names the fix, not silently green."
  - "Update JSDoc prologue to record WHY the extension is required so a future refactor that 'cleans up' back to sftp.rename fails at review-time in addition to test-time."
  - "Keep scope narrow: do NOT touch src/backend/ssh/pretty-view-upload.ts — its sftp.rename target is guaranteed non-existent by resolveNonCollidingFinal."
metrics:
  duration: ~7 minutes
  completed: 2026-08-02
  tasks_completed: 1
  files_changed: 2
  test_count_new: 3
  test_count_suite_after: 26
requirements_satisfied: [QRW-01, QRW-02, QRW-03]
---

# Quick 260802-qrw: Fix IdentityModal Save Failure — Swap sftp.rename → ext_openssh_rename Summary

**One-liner:** Root-cause fix for Ashley's IdentityModal generic "Error: Failure" on saves — swap SFTP rename call site to posix-rename@openssh.com extension so existing identity files can be overwritten atomically, pinned by a regression test with a throwing rename trap.

## What Shipped

**Single call-site swap** at `src/backend/claude-session/identity-artifact-reader.ts:855`:

```diff
- sftp.rename(tmpPath, targetPath, (err) => {
+ sftp.ext_openssh_rename(tmpPath, targetPath, (err) => {
```

Because all four remote identity markdown writers (`writeIdentityFile`, `writeIdentityHistory`, `writeIdentityHandoff`, `writeIdentityBountyFields`) delegate their atomic rename to `writeMarkdownFileAtomic`, the one-line swap transitively fixes the entire IdentityModal save surface.

**JSDoc prologue** on `writeMarkdownFileAtomic` (lines ~817-848) rewritten to record WHY the extension is required. Documents the SFTPv3 SSH_FXP_RENAME → link(old,new) → EEXIST → SSH2_FX_FAILURE trap, the POSIX rename(2) semantics of `posix-rename@openssh.com`, OpenSSH ≥5.1 universality, and the @stacy 2026-08-02 root-cause reference. The prologue's mention of the promise chain now names `ext_openssh_rename` (not `rename`), so the file contains zero executable references to the buggy API.

**New regression test file** `src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts` (3 tests, 208 lines). Load-bearing mechanism: the mock ssh2 SFTP wrapper installs a throwing trap on `.rename` — any future refactor that reverts the swap will fail LOUDLY with the diagnostic `must not call sftp.rename — use ext_openssh_rename` rather than silently pass. Covers `writeIdentityFile`, `writeIdentityHistory`, and `writeIdentityHandoff` (defensive coverage documenting that the shared helper swap covers all three writers).

## Verification (all gates green)

| Gate | Command | Result |
|------|---------|--------|
| RED (pre-swap) | `npx vitest run …remote-writes` | ❌ 3 tests fail with `must not call sftp.rename — use ext_openssh_rename` diagnostic (proves trap fires) |
| GREEN (post-swap) | `npx vitest run …remote-writes` | ✅ 3 tests pass |
| Full identity suite | `npx vitest run …identity-artifact-reader` | ✅ 6 files, 26 tests pass |
| Strict backend TS | `npm run build:backend` | ✅ pass (Tina's learned rule — frontend `tsc --noEmit` alone does NOT catch backend TS errors) |
| Full build | `npm run build` | ✅ pass (frontend + backend) |
| Grep gate | `grep -c 'sftp\.rename(' src/backend/claude-session/identity-artifact-reader.ts` | ✅ 0 |

## Root Cause (for the historical record)

Root-caused by @stacy on ceo-skynet 2026-08-02 (full handoff at `~/pretty-view-uploads/2026-08-02/190204-TINA-HANDOFF.md`).

The pre-fix code called `sftp.rename(tmp, target, cb)`, which sends SFTPv3 `SSH_FXP_RENAME`. OpenSSH's `process_rename` tries `link(old, new)` first. When `new` already exists, `link()` returns `EEXIST`. OpenSSH's `errno_to_portable()` has no case for `EEXIST` and falls through to `SSH2_FX_FAILURE` — the ssh2 client surfaces a generic `Error: Failure` with code `4` and an empty error string.

Symptom in Ashley's fleet: every save of an EXISTING identity file failed; only first-time writes (target missing) succeeded. Matches her "sometimes it works, sometimes it doesn't" report — all her IdentityModal edits are on existing identities.

Fix mechanism: `posix-rename@openssh.com` extension (`ext_openssh_rename`) has POSIX `rename(2)` semantics — atomic overwrite of an existing target, no `link()`/`EEXIST` detour. Advertised by every OpenSSH ≥5.1 (2008+); universal across Ashley's fleet.

## Deviations from Plan

None — plan executed exactly as written. RED→GREEN→gates flow followed to the letter.

## Commit

- **Branch:** `feat/tab-title-from-tmux`
- **Hash:** `042235e`
- **Message header:** `fix(260802-qrw): swap sftp.rename → ext_openssh_rename in writeMarkdownFileAtomic`
- **Files changed:** 2 (+242 insertions, -4 deletions)
  - Modified: `src/backend/claude-session/identity-artifact-reader.ts` (swap + JSDoc rewrite)
  - Created: `src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts` (208 lines)

## Follow-ups (not this task's scope)

- Orchestrator: redeploy skynet so Ashley can smoke-test the IdentityModal on an existing identity (any of the four writable fields). Expected outcome: no generic "Error: Failure" toast.
- Orchestrator: update `~/.claude/identities/tina/skynet-patches.md` with the codified `npm run build:backend` gate rule (already established, this quick task honored it).

## Self-Check: PASSED

- Files exist:
  - FOUND: `src/backend/claude-session/identity-artifact-reader.ts` (modified — verified via `git show HEAD --stat`)
  - FOUND: `src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts` (created)
- Commit exists on branch: FOUND `042235e` via `git log --oneline -1`.
- Executable grep for `sftp.rename(` in identity-artifact-reader.ts: 0 (verified).
- All named test IDs pass (verified via last `npx vitest run` output above).
