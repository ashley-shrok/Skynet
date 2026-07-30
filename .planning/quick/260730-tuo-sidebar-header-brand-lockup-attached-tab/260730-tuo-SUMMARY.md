---
phase: quick-260730-tuo
plan: 01
subsystem: frontend/ui-shell
tags: [visual-polish, brand-identity, sidebar, chevron, browser-tab-title, i18n-retirement, patch-214]
requires:
  - patch-193 (persistent chevron anchored to left: sidebarWidth+8px on desktop-open)
  - patch-142 (Fix 5: .pv-panel-header padding-left: 48px clearance rule)
  - patch-144 (Fix f: mobile + desktop header render identical .pv-title element)
  - patch-167 (pinned-bounty filter toggle in header — layout dependency)
provides:
  - "Attached-tab treatment for the persistent sidebar-toggle chevron on desktop-open"
  - "Skynet brand lockup (20x20 logo + text) in sidebar-header .pv-title"
  - "document.title = 'Skynet' on cold-load AND all-tabs-closed → dashboard-recreate path"
  - "Retirement of the nav.conversations.title i18n binding for the panel header (brand mark is not localizable)"
affects:
  - "src/ui/AppShell.tsx dashboard-tab label initializers (2 sites: L178 + L1189)"
  - "src/ui/AppShell.tsx PrettyConversationsPanel sidebarToggleOverlaps prop (L1382)"
  - "src/ui/AppShell.tsx persistent sidebar-toggle chevron block (L1506-L1555)"
  - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx header title render (L546)"
  - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx Tests 7 + 8"
tech-stack:
  added: []
  patterns:
    - "Inline-flex brand-lockup pattern (image + text as one .pv-title unit, no i18n binding)"
    - "State-conditional className via inline ternary on className string (attached-tab vs floating-pill treatment)"
    - "Hardcoded brand-mark strings (retirement of i18n for non-localizable identity copy)"
key-files:
  created: []
  modified:
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Brand marks are not localizable — hardcode 'Skynet' rather than routing through i18next, matches how upstream products treat their own product-name copy"
  - "Removed the now-unused headerLabel const at PrettyConversationsPanel.tsx:494 (grep-confirmed zero remaining references) rather than leaving as dead code for future maintainers"
  - "Attached-tab treatment reads .pv-base bg + omits left border/rounding so the sidebar's right border visually extrudes the chevron as a tab — no gap even LOOKS needed after this treatment (double-remedy alongside the padding-clearance prop-flip)"
  - "Kept the closed-state + touch/mobile back-affordance chevron on the prior floating-pill treatment via inline ternary — visual regression avoided for those two states"
  - "Frontend-only patch: skipped backend build per patch #154 rule (tsc + vitest + npm run build sufficient for zero-backend-file changes)"
metrics:
  duration: 5m 2s
  completed: 2026-07-30T21:40:41Z
  tasks_completed: 2
  files_modified: 3
  files_created: 0
  commits: 1
  vitest_baseline_before: "76 files / 861 passed / 6 skipped / 0 failed (patch #213)"
  vitest_baseline_after: "76 files / 861 passed / 6 skipped / 0 failed (matches — no net test count change)"
---

# Quick 260730-tuo: Sidebar-Header Skynet Brand Lockup + Attached-Tab Chevron Summary

One-liner: Ship four already-in-working-tree design polish changes (chevron attached-tab treatment, Skynet brand lockup in sidebar-header, browser tab title hardcoded to "Skynet", padding-clearance prop-flip) as one atomic patch (#214), closing pinned bounty `sidebar-header-left-gap-after-collapse-button-moved`.

## Overview

Two purposes rolled into one atomic patch:

1. **Close pinned bounty `sidebar-header-left-gap-after-collapse-button-moved`** (parked 2026-07-30 in Ashley's tina identity). Root cause: patch #193 (commit `1e14cba`) moved the persistent sidebar-toggle chevron from viewport-left to `left: sidebarWidth + 8px` on desktop-open, but the 48px padding-left clearance in `.pv-panel-header` (patch #142 Fix 5) was still firing on desktop-open — reserving space for a chevron that had already moved elsewhere. The prop-flip (change #1) stops the clearance from firing when the chevron isn't at viewport-left. The attached-tab treatment (change #2) makes the chevron read as visually part of the sidebar so no gap even looks needed.

2. **Ship the Skynet brand identity** into the two surfaces where it belongs — sidebar-header (brand lockup with logo, change #3) and browser tab title (hardcoded string, change #4).

Result: 3 files changed in one atomic commit (`f1ab681`) landing all four visual changes + two test updates. Verification green across tsc/build/vitest. NO push, NO docker build, NO deploy performed — stopped at commit boundary per fleet rule.

## Tasks Completed

### Task 1: Verify working-tree changes + update tests + optional const cleanup

**Commit:** `f1ab681` (single atomic commit covers both tasks per plan)
**Duration:** ~3 minutes

Verified via `git diff` that all four working-tree changes were present as spec'd (tina-authored via docker cp fast-path, eyeballed live by Ashley — executor did NOT reimplement):

1. **AppShell.tsx L178** — `label: t("nav.conversations.title", ...)` → `label: "Skynet"` (dashboard tab initial useState)
2. **AppShell.tsx L1189** — same substitution in the re-create-dashboard-when-all-tabs-closed path
3. **AppShell.tsx L1382** — `sidebarToggleOverlaps={!isMobile && !isTouchDevice && sidebarOpen}` → `sidebarToggleOverlaps={isMobile && !isTouchDevice && sidebarOpen}`
4. **AppShell.tsx L1529-1541** — chevron `className` split into inline ternary (attached-tab vs floating-pill states) + `left` drops the `+ 8` gap → sits flush against sidebar's right border
5. **PrettyConversationsPanel.tsx L546** — `<span className="pv-title">{headerLabel}</span>` → inline-flex span with brand-lockup img (`/apple-touch-icon-192.png`, 20×20, aria-hidden, alt="") + literal "Skynet"

Updated test assertions in `PrettyConversationsPanel.test.tsx`:

- **Test 7** (desktop header title, L1148-1178) — renamed `it()` description, flipped `queryByText(/^conversations$/i)` → `queryByText(/^skynet$/i)`, added 4 new assertions on the brand-img shape (element present, src=`/apple-touch-icon-192.png`, alt=`""`, aria-hidden=`"true"`). Preserved `.pv-title` class assertion + `.pv-panel-header` descendant assertion.
- **Test 8** (mobile header title, L1184-1211) — mirror-symmetric update: renamed description, flipped regex, added identical 4 brand-img assertions. Preserved `.pv-title` + `.pv-panel-header` + pencil-role assertions.
- **File-header comment index** (L9-L10) — updated from `Desktop header shows title "Conversations"` / `Mobile header omits title text` to `Desktop header shows Skynet brand lockup (img + text) — quick-260730-tuo` / `Mobile header shows Skynet brand lockup (same shape as desktop) — quick-260730-tuo` to keep the file-header table of contents accurate.

**Optional cleanup applied:** `headerLabel` const at `PrettyConversationsPanel.tsx:494` was grep-confirmed to have 1 total reference (only the declaration) after change #3 stopped using it. Deleted the 3-line `const headerLabel = t("nav.conversations.title", { defaultValue: "Conversations" });` block to avoid leaving dead code for future maintainers.

**Grep scope-check:** Ran `grep -rn '/^conversations$/i\|queryByText.*Conversations\|getByText.*Conversations' src/` — only the two Tests 7/8 hits appeared, both handled. No other test file references broke from the copy change.

**Files:**
- `src/ui/AppShell.tsx` (working-tree diff only, no executor edits)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (headerLabel const deletion, working-tree brand-lockup already present)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (Tests 7 + 8 assertions rewritten, file-header comment updated)

### Task 2: Full verification pass + atomic commit

**Commit:** `f1ab681` (same atomic commit)
**Duration:** ~2 minutes

Ran the three verification gates in order:

1. **`npx tsc --noEmit`** — EXIT 0 (no new type errors from inline-flex img style, chevron className ternary, or test assertion updates).
2. **`npm run build`** — EXIT 0, built in 3.85s. Vite bundled the frontend cleanly; `/apple-touch-icon-192.png` already in `public/` so no asset-resolution issue.
3. **`npx vitest run`** — full frontend suite: **76 files passed / 861 passed / 6 skipped / 0 failed**. Exactly matches the patch #213 baseline (no net test-count change; Tests 7 + 8 still pass with new brand-lockup assertions). Grep-gate on `FAIL|✗` in the vitest log came back clean per L508 learned preference.

Backend build skipped per patch #154 rule (zero backend files touched — `src/backend/` untouched).

**Scope check** via `git diff --name-only`: exactly 3 files (AppShell.tsx, PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx). No backend, no docker, no identity dirs, no nginx configs — stayed inside the plan's declared scope.

**Staged explicitly** with `git add <path> <path> <path>` (never `-A` / `.` per Standing Directive), then committed atomically with a HEREDOC message covering all four visual changes + the test updates + the `headerLabel` const cleanup, on branch `feat/tab-title-from-tmux`. Commit hash: `f1ab681`, +58/-19 across 3 files.

**Post-commit sanity:** `git log --oneline -1` shows the new commit, `git status --short` shows a clean tracked-file working tree (only untracked planning dirs from this quick + a different unrelated quick remain — as expected).

## Deviations from Plan

None — plan executed exactly as written. The optional `headerLabel` cleanup was applied per Step 5 (grep confirmed 1 reference, i.e., only the declaration line, satisfying the plan's "if count is 1, DELETE" branch).

Zero Rule-1/2/3/4 deviations triggered. Zero authentication gates. Zero blockers.

## Fleet Guardrails Observed

- NO `git push` performed.
- NO `docker compose` invoked (no restart, no --force-recreate, no deploy).
- NO `docker build` invoked.
- NO edits under `src/backend/` (frontend-only patch, backend build correctly skipped).
- NO edits under `~/.claude/identities/tina/**` (patches file + bounty archiving are post-executor tina jobs).
- Post-commit branch still `feat/tab-title-from-tmux`; deploy queue extends to #198→#214, still HELD per Ashley's not-shipping-until-shape-lock rule.
- Changes are already visible in the running container via tina's docker cp fast-path (no deadman armed).

## Verification Results

| Gate                       | Result   | Notes                                                                                    |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`         | EXIT 0   | No new type errors                                                                       |
| `npm run build`            | EXIT 0   | 3.85s; Vite bundled all locale chunks cleanly                                            |
| `npx vitest run` (full)    | EXIT 0   | 76 files / 861 passed / 6 skipped / 0 failed — matches patch #213 baseline exactly       |
| Grep-gate `FAIL\|✗` log    | Clean    | Zero failure lines in `/tmp/vitest-260730-tuo.log` per L508 learned preference           |
| `git diff HEAD~1 HEAD`     | 3 files  | AppShell.tsx + PrettyConversationsPanel.tsx + PrettyConversationsPanel.test.tsx          |
| Commit deletion check      | Clean    | No accidental tracked-file deletions in the commit                                       |

## Commits Landed

| Hash       | Type   | Scope                    | Description                                                                                  |
| ---------- | ------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| `f1ab681`  | feat   | quick-260730-tuo         | sidebar-header Skynet brand lockup + attached-tab chevron + document.title=Skynet (patch #214) |

## Known Stubs

None. All rendered UI is wired to real data or literal brand copy; no placeholder text, no "coming soon" strings, no mock-data flows introduced.

## Post-Executor Follow-Up (NOT this workflow's scope)

Handled by the /gsd-quick orchestrator after this SUMMARY.md:
- Docs commit landing PLAN + SUMMARY + STATE row (executor MUST NOT commit docs per plan constraints).
- New row in `.planning/STATE.md` "Quick Tasks Completed" table matching patch #213 (`260730-sjf`) format.

Handled by tina identity holder (outside this repo, outside this workflow):
- Add patch #214 entry to `~/.claude/identities/tina/skynet-patches.md`.
- Archive `~/.claude/identities/tina/bounties/sidebar-header-left-gap-after-collapse-button-moved/` to `bounties/archive/`.

## Self-Check: PASSED

- ✓ Commit `f1ab681` exists in `git log`.
- ✓ `.planning/quick/260730-tuo-sidebar-header-brand-lockup-attached-tab/260730-tuo-SUMMARY.md` written (this file).
- ✓ All three modified files exist and match the commit contents.
- ✓ Verification gates (tsc + build + vitest + grep-gate) all green.
- ✓ Fleet guardrails all observed (no push, no docker, no backend edits, no identity dir edits).
