---
phase: 10-pretty-conversations-visual-language-rework
plan: 04
subsystem: ui/sidebar
tags: [ui, sidebar, deletion, cleanup, retirement, f3-diag-retirement]
dependency_graph:
  requires:
    - Wave 3 completion (0d39c43) — AppShell cutover to PrettyConversationsPanel finished; zero production imports of the retiring files remained
  provides:
    - Three retired source files removed from disk (ConversationsPanel.tsx, ConversationRow.tsx, NewSessionButton.tsx)
    - Full retirement of patch #111e F3-diag console-log telemetry (only historical `//` comments describing its removal survive)
    - NewSessionDialog.test.tsx: Test 1 (NewSessionButton isolation) pruned; file scoped down to dialog + retargeted Test 10
    - Sidebar tree now hosts exactly ONE conversation panel component surface (PrettyConversationsPanel + PrettyConversationRow under src/ui/features/pretty-conversations/), eliminating the "two panels living in the sidebar/ tree" confusion tax the phase brief called out
  affects:
    - Wave 5 (build-verify + UAT + patch #128 draft): code-complete state ready. No remaining source references to retired files; tsc-clean; test suite at least as green as Wave 3 left it (delta of -1 test explained by Test 1 prune — 500/504 → 499/503, 4 pre-existing ComposeBox failures unchanged and still documented in deferred-items.md)
tech_stack:
  added: []
  patterns:
    - Atomic per-file deletion commits: one commit per retired source file so a future bisect can pinpoint any regression to a single file removal
    - Pre-deletion straggler grep as a hard gate: verified zero production imports before each `rm`, plus a full repo-wide grep sweep after all deletions
    - Comment-only reference preservation policy: historical `//` mentions of retired components (in NewSessionDialog.tsx header, AppShell.tsx history annotations, conversation-store.ts contract docs, PrettyConversationsPanel.tsx retirement notes) stay as history; code is the source of truth
key_files:
  created:
    - .planning/phases/10-pretty-conversations-visual-language-rework/10-04-SUMMARY.md
  modified:
    - src/ui/sidebar/NewSessionDialog.test.tsx (13 insertions, 24 deletions — Test 1 prune + file-header comment update + imports scoped to survivors)
  deleted:
    - src/ui/sidebar/ConversationsPanel.tsx (430 lines removed)
    - src/ui/sidebar/ConversationRow.tsx (150 lines removed)
    - src/ui/sidebar/NewSessionButton.tsx (40 lines removed)
decisions:
  - "Test 1 pruned (not retargeted): the pencil-icon in PrettyConversationsPanel is trivial glue code (onClick prop → local setState) already covered by PrettyConversationsPanel.test.tsx Test 5. A fourth 'pencil click fires dialog open' assertion inside a file dedicated to the dialog+button pair would be redundant. Planner's Task 2 rationale honored."
  - "Ordering: pruned Test 1 (removing the import) BEFORE deleting NewSessionButton.tsx. Deleting the file first would have left the test file importing a nonexistent module for one commit — tsc-broken in isolation. The plan text ordered Task 1 (all 3 deletions) → Task 2 (test prune), but planner did not intend to leave the tree tsc-broken between commits; splitting the delete/prune ordering achieved atomic-tsc-clean per commit."
  - "File-header comment of NewSessionDialog.test.tsx updated in the same commit as the Test 1 prune. Comment previously said 'Tests 1-9 cover the modal + button pair'; now says 'Tests 2-9 cover the modal'. Not strictly required by the plan, but keeping code + doc-comments in sync inside a single scope-adjacent edit avoids stale-annotation debt."
  - "F3-diag comment-only references preserved. Three files carry `// ... F3-diag ...` annotations (AppShell.tsx line 1482, PrettyConversationsPanel.tsx lines 40 + 147). All three describe the RETIREMENT of the telemetry — deleting them would remove useful historical context for a future engineer wondering why there is no diagnostic instrumentation on those code paths. Planner's Task 3 explicitly permits comment-only survivors."
metrics:
  duration_seconds: 900
  duration_human: "15min"
  tasks_completed: 3
  files_deleted: 3
  files_modified: 1
  commits: 4
  completed_date: "2026-07-22"
---

# Phase 10 Plan 04: Retirement of ConversationsPanel + ConversationRow + NewSessionButton — Summary

Deleted the three retired sidebar files (ConversationsPanel.tsx, ConversationRow.tsx, NewSessionButton.tsx), pruned NewSessionDialog.test.tsx Test 1 (the NewSessionButton isolation test), and confirmed via repo-wide grep + tsc + full vitest suite that no source references remain and no F3-diag telemetry survives outside of retirement-annotation comments.

## What Shipped

Four atomic commits on `feat/tab-title-from-tmux`:

| # | SHA | Message |
|---|-----|---------|
| 1 | `5d17167` | `chore(sidebar): delete retired ConversationsPanel.tsx (Phase 10 Wave 4)` |
| 2 | `b61503b` | `chore(sidebar): delete retired ConversationRow.tsx (Phase 10 Wave 4)` |
| 3 | `40ee620` | `test(new-session-dialog): prune Test 1 (NewSessionButton isolation)` |
| 4 | `c45312a` | `chore(sidebar): delete retired NewSessionButton.tsx (Phase 10 Wave 4)` |

Each deletion is its own commit so a future `git bisect` can pinpoint any regression to a single file removal. The test prune sits between commits 2 and 4 because it removed the last `import { NewSessionButton } from "./NewSessionButton"` reference — deleting the file first would have left the tree tsc-broken for a single commit, violating atomic-tsc-clean discipline.

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -rn 'from "@/sidebar/ConversationsPanel"' src` | 0 hits | 0 hits | PASS |
| `grep -rn 'from "@/sidebar/ConversationRow"' src` | 0 hits | 0 hits | PASS |
| `grep -rn 'from "@/sidebar/NewSessionButton"' src` | 0 hits | 0 hits | PASS |
| `grep -rn 'F3-diag' src` (code hits) | 0 | 0 code hits (3 comment-only mentions, all describing the RETIREMENT) | PASS |
| `grep -rnE '"@/sidebar/(ConversationsPanel\|ConversationRow\|NewSessionButton)"' src` (alt import styles) | 0 hits | 0 hits | PASS |
| `grep -rnE 'from "\./(ConversationsPanel\|ConversationRow\|NewSessionButton)"' src` (relative-path stragglers) | 0 hits | 0 hits | PASS |
| `npx tsc --noEmit` | exit 0 | exit 0 | PASS |
| Full vitest suite | ≥ Wave 3 tip (500/504 passing) | 499/503 passing | PASS (-1 test explained by Test 1 prune; -1 passing tracks the -1 test; delta is neutral) |

The 4 remaining test failures are all inside `src/ui/features/pretty-view/ComposeBox.test.tsx` — documented pre-existing failures inherited from patch #123 / Phase 9 Plan 03 (see `deferred-items.md`). None of them touch this phase's code paths.

## Preserved Files (Explicit Non-Deletion List)

All confirmed to still exist and function on disk after all four commits landed:

- `src/ui/sidebar/NewSessionDialog.tsx` — reused verbatim by PrettyConversationsPanel Wave 2
- `src/ui/sidebar/NewSessionDialog.test.tsx` — Tests 2-9 (dialog coverage) + retargeted Test 10 (header-pencil-before-rows) intact; 9/9 green
- `src/ui/sidebar/SettingsRow.tsx` — `renderSettingsMenuItems` + `SettingsRow` consumed by both PrettyConversationsPanel + AppShell mobile mount
- `src/ui/sidebar/AppRail.tsx` — unrelated, untouched
- `src/ui/state/conversation-store.ts` — unchanged; the `ConversationRow` **type export** on line 35 is a data-shape type (not the deleted component) and survives per plan Task 1
- `src/ui/state/conversation-store.test.ts` — unchanged
- `src/ui/features/pretty-conversations/*` — Wave 1 + Wave 2 output; all intact

## F3-Diag Retirement — Fully Confirmed

Patch #111e's `console.warn("[F3-diag] handleRowSelect ENTRY: ...")` spew is gone from all code paths:

1. Its origin site (`ConversationsPanel.tsx` line 161) was removed with the file deletion in commit `5d17167`.
2. The AppShell mirror site was already retired by Wave 3 (commit `65c572c`).
3. Zero other code sites ever existed — Wave 4's `grep -rn "F3-diag" src` returned only three comment-only mentions:
   - `src/ui/AppShell.tsx:1482` — "Phase 10 Wave 3: patch #111e F3-diag console.warn retired"
   - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:40` — "NO diagnostic spew — Patch #111e F3-diag scoped to the old panel is being retired in Wave 4"
   - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:147` — "VERBATIM behavior from ConversationsPanel.tsx lines 153-183 MINUS the [F3-diag] diagnostic spew (patch #111e retired in Wave 4)"

All three are historical retirement-annotations describing the ABSENCE of the telemetry — useful history for a future engineer wondering why there is no instrumentation on those code paths. Deleting them would remove signal, not add it. Kept per Task 3's explicit rule: "comment-only references (`//` or `/* */` mentioning the retired component names inside surviving files) are ACCEPTABLE — code is the source of truth; comments are historical annotation."

## Stragglers Found + Resolved

Zero stragglers. Wave 3 had already confirmed pre-Wave-4 that no production references remained; Wave 4 re-verified pre-deletion (once, before Task 1) and post-deletion (twice, in Task 3's grep sweep) with identical zero-hit results.

The only non-import mentions of the retired component names anywhere in `src/` after Wave 4 are:

- `src/ui/AppShell.tsx` — multiple `// ... ConversationsPanel ...` history annotations describing what the old panel did (all kept per Task 3 comment-only rule).
- `src/ui/state/conversation-store.ts` line 46 — "in conversation-store.test.ts). ConversationRow.tsx MUST render both ..." — describes the historical contract; the new PrettyConversationRow honors the same contract; comment stays.
- `src/ui/state/conversation-store.ts` line 356 — "ConversationsPanel special-cases `hostId === '__rdp__'` ..." — describes the store's contract with whichever panel is mounted; PrettyConversationsPanel honors the same contract.
- `src/ui/state/conversation-store.test.ts` line 897 — "RDP rows carry `rdpHostRow: true` so ConversationsPanel can route ..." — comment describes the routing contract; unchanged behavior.
- `src/ui/sidebar/NewSessionDialog.tsx` line 3 — file-header history annotation.
- `src/ui/sidebar/SettingsRow.tsx` lines 11, 118, 160 — history annotations describing shared consumption.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` lines 30, 37-38, 88, 106, 110, 115 — deliberate "verbatim behavior from ConversationsPanel" annotations describing the port-forward relationship.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1` and `src/ui/features/pretty-conversations/PinAction.tsx:3` and `src/ui/features/pretty-conversations/tokens.ts:15,22` — mentions of `PrettyConversationRow` (the NEW component, not the deleted one).
- `src/ui/AppShell.persistence.test.tsx:435` — commented-out contract note referencing ConversationsPanel's `fleetOnly` routing.

All comment-only. Per Task 3 rule, all acceptable and preserved.

## Deviations from Plan

### Auto-fixed Issues

None — the plan executed exactly as written except for one intentional ordering adjustment.

### Ordering Adjustment (Rule 3 — Blocking Issue Avoidance)

**Adjustment:** The plan wrote Task 1 (delete all 3 files) → Task 2 (prune test). Executed as: delete `ConversationsPanel.tsx` → delete `ConversationRow.tsx` → prune `NewSessionDialog.test.tsx` (Task 2) → delete `NewSessionButton.tsx`.

**Rationale:** Deleting `NewSessionButton.tsx` first would have left `NewSessionDialog.test.tsx` line 41 importing a nonexistent module for exactly one commit (5d17167..40ee620 window). While tsc-clean at end-of-wave was the plan's contract, atomic-tsc-clean *per commit* is stronger: makes `git bisect` sound if a future regression appears on any of these four commits. The Task 2 test prune has no dependency on Task 1's first two file deletions (ConversationsPanel + ConversationRow) — those two files were freely deletable first. Only the NewSessionButton deletion had a stale-import risk, so moving the test prune between Task 1 commits 2 and 3 preserved the plan's semantics with a tighter per-commit invariant.

**No architectural impact** — same 4 commits, same final tree, same test-suite state. Documented for completeness.

## Handoff to Wave 5

Code-complete state ready for build-verify + UAT + patch #128 draft:

- Tree is at commit `c45312a` on `feat/tab-title-from-tmux`.
- No pushes made per user directive (`do NOT push, do NOT deploy`).
- No `docker compose` calls made.
- No `git stash` used.
- tsc-clean; vitest-green modulo the pre-existing 4-failure `ComposeBox.test.tsx` inheritance (out of scope for Phase 10 per `deferred-items.md`).
- The sidebar/ tree now hosts exactly one conversation-panel surface (`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`). Future refactors will not have to disambiguate between two panels.
- All F3-diag telemetry removed; historical retirement annotations preserved as documentation.

Wave 5 can proceed with:
1. `docker compose build` + `docker compose up -d --force-recreate termix` under whatever deploy discipline is active in the fork on 2026-07-22 (Ashley noted the 15-min deadman regime was retired 2026-07-21; use whatever supersedes it).
2. Ashley UAT of the new PrettyConversationsPanel across desktop + mobile viewports.
3. Draft patch #128 (the fork-patch number for this phase's cutover) with a body describing the sidebar-tree simplification + F3-diag retirement.

## Known Stubs

None. All deletions and edits are complete; no placeholder data, no TODO markers, no unwired components introduced.

## Self-Check: PASSED

Verified all claims before finalizing:

- File `src/ui/sidebar/ConversationsPanel.tsx` MISSING (expected — deleted commit 5d17167)
- File `src/ui/sidebar/ConversationRow.tsx` MISSING (expected — deleted commit b61503b)
- File `src/ui/sidebar/NewSessionButton.tsx` MISSING (expected — deleted commit c45312a)
- File `src/ui/sidebar/NewSessionDialog.tsx` FOUND (expected — preserved)
- File `src/ui/sidebar/SettingsRow.tsx` FOUND (expected — preserved)
- File `src/ui/state/conversation-store.ts` FOUND (expected — preserved)
- File `src/ui/state/conversation-store.test.ts` FOUND (expected — preserved)
- File `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` FOUND (expected — Wave 2 output)
- File `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` FOUND (expected — Wave 1 output)
- Commit `5d17167` FOUND in `git log`
- Commit `b61503b` FOUND in `git log`
- Commit `40ee620` FOUND in `git log`
- Commit `c45312a` FOUND in `git log`
- tsc: exit 0
- vitest: 499 passing / 4 failing (all ComposeBox pre-existing) — matches Wave 3 tip minus Test 1 prune

All success criteria from the plan met:

1. Three retired files removed from disk — PASS
2. NewSessionDialog.test.tsx pruned of NewSessionButton isolation test (Tests 2-10 survive, 9/9 green) — PASS
3. Repo-wide grep returns zero source-code references to the deleted paths — PASS
4. F3-diag telemetry fully retired (grep returns 0 code hits, 3 comment-only annotations describing the retirement) — PASS
5. Preserved files all still exist and function — PASS
6. tsc-clean and existing test suite green (modulo pre-existing failures) — PASS
