---
phase: 70-rewrite-prettyview-auto-scroll-from-first-principles-two-sta
plan: "04"
subsystem: pretty-view/auto-scroll
tags:
  - contamination-sweep
  - human-verify
  - phase-71
  - grep-gates

dependency_graph:
  requires:
    - src/ui/features/pretty-view/auto-scroll-machine.ts (Plan 70-01)
    - src/ui/features/pretty-view/use-auto-scroll.ts (Plan 70-02)
    - src/ui/features/pretty-view/PrettyView.tsx (Plan 70-03)
  provides:
    - .planning/phases/70-.../71-04-SWEEP-REPORT.md (sweep report — all gates GREEN)
  affects:
    - Ashley real-browser verification (Task 2 — awaiting orchestrator ship)

tech_stack:
  added: []
  patterns:
    - "Exact-key-set toEqual assertion is sufficient to enforce no-legacy-API invariant — explicit per-prop toBeUndefined assertions are redundant and create naming noise that trips grep gates"

key_files:
  created:
    - .planning/phases/71-rewrite-prettyview-auto-scroll-from-first-principles-two-sta/71-04-SWEEP-REPORT.md
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.test.tsx (T14: remove redundant legacy-name assertions)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (rename pinnedRef → pinnedRowsRef)

decisions:
  - "T14 negative-assertion cleanup: removed three explicit toBeUndefined() calls that named old API identifiers; L820 exact-key-set assertion is sufficient and stronger"
  - "pinnedRef in PrettyConversationsPanel renamed to pinnedRowsRef — unambiguous name for pinned conversation rows, eliminates false-positive grep collision with auto-scroll domain"
  - "Task 2 (human-verify) returns checkpoint — awaiting orchestrator ship to production + Ashley real-browser walk"

metrics:
  duration_seconds: 600
  completed_date: "2026-09-04"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 71 Plan 04: Contamination Sweep + Human-Verify Handoff — Summary

**One-liner:** Whole-repo grep-gate sweep confirmed all 11 structural invariants GREEN after two inline fixes (redundant test assertions removed, `pinnedRef` in conversations panel renamed to `pinnedRowsRef`); Task 2 returns checkpoint for Ashley real-browser verification post-ship.

## What Was Built

### Task 1: Codebase-Wide Contamination Sweep

All 11 sweep gates run independently against the full `src/` and `tests/` trees:

**5 contamination gates** — verify old auto-scroll API names are absent from all code:
- `sentinelRef` → 0 files (after inline fix)
- `scrollToBottomAndFollow` → 0 files (after inline fix)
- `isPinnedToBottom` → 0 files (after inline fix)
- `data-pv-scroll-sentinel` → 0 files (clean from Wave 3)
- `pinnedRef|didFirstContentScrollRef` → 0 files (after inline fix)

**3 observer-invariant gates** — scoped to `use-auto-scroll.ts`:
- `IntersectionObserver` → 0 (forbidden)
- `new MutationObserver` → exactly 1
- `new ResizeObserver` → exactly 1

**3 log-prefix gates**:
- `[pv-scroll-diag]` in pretty-view/ + shell/ (excl. PrettyConversationsPanel) → 0
- `[pv-scroll]` in use-auto-scroll.ts → 8 (≥3 required)
- `[pv-scroll]` in PrettyView.tsx → 1 (≥1 required)

**1 smooth-scroll gate**, **2 deferred-scope gates** → all PASS.

**Test suite:** 60/60 passing (45 reducer + 15 hook).
**TypeScript:** 0 errors in any Phase-70-touched or sweep-modified files.

Full gate-by-gate results: `.planning/phases/70-.../71-04-SWEEP-REPORT.md`
**Overall sweep verdict: GREEN.**

### Task 2: Human-Verify (CHECKPOINT — awaiting orchestrator ship + Ashley)

Task 2 is a `checkpoint:human-verify` gate. The orchestrator must ship the code to production
before Ashley can walk the four bounty scenarios in a real browser. This plan does NOT attempt
to simulate or substitute for that verification.

**Bounties awaiting Ashley's real-browser sign-off:**
1. `pretty-view-auto-scroll-three-bug-rewrite` — primary Phase 71 bounty
2. `conversations-scroll-to-bottom-on-load` — cold-load bottom anchor
3. `pretty-view-scroll-to-bottom-after-send` — send flips mode to at-bottom
4. `conversation-list-scroll-delay-on-load` — left panel (informational; Phase 71 did not
   touch `PrettyConversationsPanel`; may or may not close on ship)

Ashley's verification protocol is in the plan's Task 2 `<how-to-verify>` block (8 numbered
scenario groups: 3a-3e, 4a, 5a-5b, 6a-6b, 7a-7b, 8a, 9a-iOS-only, 10a-informational).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T14 in use-auto-scroll.test.tsx named old API identifiers explicitly**
- **Found during:** Task 1, contamination gates C-01/C-02/C-03
- **Issue:** Lines 826-828 of the test used `expect(asRecord.sentinelRef).toBeUndefined()`,
  `expect(asRecord.scrollToBottomAndFollow).toBeUndefined()`, and
  `expect(asRecord.isPinnedToBottom).toBeUndefined()` — mentioning old API names by
  string in test source, tripping the grep gates with counts of 1 instead of 0.
- **Fix:** Removed L826-828. The L820 assertion `expect(keys).toEqual([...exact set...])` is
  fully sufficient and stronger — any extra key in the hook return would fail it immediately.
  The removed lines added naming noise with no correctness benefit.
- **Files modified:** `src/ui/features/pretty-view/use-auto-scroll.test.tsx`
- **Commit:** `082d0742`

**2. [Rule 1 - Bug] `pinnedRef` in PrettyConversationsPanel tripped contamination gate C-05**
- **Found during:** Task 1, contamination gate C-05
- **Issue:** `PrettyConversationsPanel.tsx` (explicitly out-of-scope for Phase 71 per CONTEXT.md)
  used `pinnedRef` as a local variable name for `useRef(pinned)` — holding pinned conversation
  rows. The grep pattern `pinnedRef` was designed to catch the old auto-scroll hook's internal
  boolean ref. This was a naming collision — different domain, different type, different file.
- **Fix:** Renamed `pinnedRef` → `pinnedRowsRef` at 7 sites (declaration, mutation, loop body,
  cache type field, cache initializer, cache identity check, cache write). Semantics unchanged;
  TypeScript clean.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Commit:** `082d0742`

## Sweep Verdict

**SWEEP-REPORT.md overall verdict: GREEN.**

All 11 structural gates PASS after inline fixes. No residual auto-scroll contamination
remains in `src/` or `tests/`. The codebase is clean for ship.

## Task 2 Status

**AWAITING ORCHESTRATOR SHIP + ASHLEY REAL-BROWSER VERIFICATION.**

The plan closes Phase 71's code work. Orchestrator must:
1. Run full test suite + docker build
2. Deploy to production (term.gigaashley.click)
3. Ask Ashley to walk the 8 scenario groups (Task 2 `<how-to-verify>`)
4. Return `approved` if all primary scenarios pass, or describe failures for 70-05

## Known Stubs

None. Phase 71 landed complete implementation with no placeholder values.

## Threat Flags

None. This plan ran grep sweeps and renamed a local variable — no new network endpoints,
auth paths, file access, or schema changes.

## Self-Check: PASSED

- FOUND: `.planning/phases/70-.../71-04-SWEEP-REPORT.md`
- FOUND: `src/ui/features/pretty-view/use-auto-scroll.test.tsx` (modified)
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (modified)
- FOUND commit `082d0742`
- All 11 sweep gates PASS (verified by running plan's `<verify>` block verbatim)
- 60/60 tests passing
- 0 TypeScript errors in Phase-70-touched files
