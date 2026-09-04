# Phase 71 Plan 04 — Codebase Contamination Sweep Report

**Generated:** 2026-09-04T05:23:20Z  
**Finalized:** 2026-09-04T05:30:00Z (after inline fixes applied)  
**Branch:** feat/tab-title-from-tmux  
**Sweep scope:** `src/` and `tests/` (`.planning/` excluded per gate spec)

---

## Inline Fixes Applied During Sweep

Two inline fixes were applied to bring all contamination gates to zero. Both are
documented in the deviations section of 71-04-SUMMARY.md.

**Fix 1 (C-01/C-02/C-03):** `src/ui/features/pretty-view/use-auto-scroll.test.tsx` L826-828
removed three redundant negative-assertion lines that named old API identifiers
(`sentinelRef`, `scrollToBottomAndFollow`, `isPinnedToBottom`) explicitly. The removal is
safe: the L820 exact-key-set assertion already enforces the same invariant more strongly —
any extra key in the hook return would fail `expect(keys).toEqual([...])`. The redundant
lines did not add correctness; they only added naming noise that tripped the grep gates.

**Fix 2 (C-05):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` —
renamed local ref variable `pinnedRef` (holding pinned conversation rows, a conversation-UI
concept) to `pinnedRowsRef`. This was a naming collision: the auto-scroll gate pattern
`pinnedRef` was intended to catch the old hook-internal boolean ref, but the conversations
panel happened to use the same name for a completely different purpose. Renamed to
`pinnedRowsRef` throughout (7 sites: variable declaration, mutation, loop, cache type field,
cache initializer, cache read, cache write). TypeScript clean, 60/60 tests still pass.

---

## 1. Contamination Sweep (5 gates)

| Gate | Name | Expected | Actual | Status |
|------|------|----------|--------|--------|
| C-01 | `sentinelRef` | 0 files | 0 files | PASS (fix applied) |
| C-02 | `scrollToBottomAndFollow` | 0 files | 0 files | PASS (fix applied) |
| C-03 | `isPinnedToBottom` | 0 files | 0 files | PASS (fix applied) |
| C-04 | `data-pv-scroll-sentinel` | 0 files | 0 files | PASS |
| C-05 | `pinnedRef\|didFirstContentScrollRef` | 0 files | 0 files | PASS (fix applied) |

All five contamination gates PASS after inline fixes. No stale auto-scroll API references
remain anywhere in `src/` or `tests/`.

---

## 2. Observer-Invariant Sweep (3 gates)

| Gate | Name | Expected | Actual | Status |
|------|------|----------|--------|--------|
| OI-01 | `IntersectionObserver` in use-auto-scroll.ts | 0 | 0 | PASS |
| OI-02 | `new MutationObserver` in use-auto-scroll.ts | exactly 1 | 1 | PASS |
| OI-03 | `new ResizeObserver` in use-auto-scroll.ts | exactly 1 | 1 | PASS |

The hook uses exactly one MutationObserver (watches scroll container children for content
changes) and one ResizeObserver (watches scroll container for size changes). No
IntersectionObserver — the Phase 71 design explicitly forbids it (sentinel div deleted,
IO-based approach abandoned).

---

## 3. Log-Prefix Sweep (3 gates)

| Gate | Name | Expected | Actual | Status |
|------|------|----------|--------|--------|
| LP-01 | `[pv-scroll-diag]` absent in pretty-view/ + shell/ (excl. PrettyConversationsPanel) | 0 | 0 | PASS |
| LP-02 | `[pv-scroll]` present in use-auto-scroll.ts | ≥3 | 8 | PASS |
| LP-03 | `[pv-scroll]` present in PrettyView.tsx | ≥1 | 1 | PASS |

The old `-diag` suffix is fully retired from Phase 71 scope. The new `[pv-scroll]` prefix
lands in 8 log sites in use-auto-scroll.ts (mount-land, mode-out, mode-in, chase-write,
chase-skip, user-gesture per state machine event classes) and 1 site in PrettyView.tsx
(L407/L411 rename from Plan 70-03 Task 3).

---

## 4. Smooth-Scroll Absolute-Prohibition Sweep (1 gate)

| Gate | Name | Expected | Actual | Status |
|------|------|----------|--------|--------|
| SS-01 | `behavior: 'smooth'` in 3 Phase-70 files | 0 | 0 | PASS |

Files checked: `use-auto-scroll.ts`, `auto-scroll-machine.ts`, `PrettyView.tsx`.
All writes to `scrollTop` are instant per shape § Chase behavior LOCKED.

---

## 5. Test-Suite Check

**Method:** `npx vitest run --reporter=verbose` per-file (the `--reporter=basic` flag aborts
in this project's vitest version — pre-existing, documented in 71-03-SUMMARY.md).

| File | Tests | Passing | Failing | Status |
|------|-------|---------|---------|--------|
| auto-scroll-machine.test.ts | 45 | 45 | 0 | PASS |
| use-auto-scroll.test.tsx | 15 | 15 | 0 | PASS |
| **Total** | **60** | **60** | **0** | **PASS** |

No failing tests. No regressions relative to 71-03-SUMMARY.md (which also reported 60/60).
T14 ("no legacy props") continues to pass after removing the three redundant explicit
assertions — the L820 exact-key-set check is fully sufficient.

---

## 6. Type-Check

**Command:** `npx tsc --noEmit 2>&1 | grep -Ec "pretty-view/(use-auto-scroll|auto-scroll-machine|PrettyView)\.tsx?"`
**Additional check:** `npx tsc --noEmit 2>&1 | grep -E "PrettyConversationsPanel"` (for the renamed file)

| Files checked | tsc errors | Status |
|---------------|-----------|--------|
| use-auto-scroll.ts, auto-scroll-machine.ts, PrettyView.tsx | 0 | PASS |
| PrettyConversationsPanel.tsx (rename side-effect) | 0 | PASS |

Zero TypeScript errors in any Phase-70-affected or sweep-modified files.
(Overall tsc exit code is 1 due to pre-existing errors in unrelated files — those are
out-of-scope per the gate spec.)

---

## 7. Deferred-Scope Sanity (2 gates)

| Gate | Name | Expected | Actual | Status |
|------|------|----------|--------|--------|
| DS-01 | `load-more.*anchor\|load-more.*preserve` in auto-scroll files | 0 | 0 | PASS |
| DS-02 | `unread\|badge` near scroll context in hook + PrettyView | 0 | 0 | PASS |

No load-more anchor deferred logic bled into Phase 71. No unread-count badge added to the
jump-to-bottom pill (per shape § Scope edges "Tempting-but-no").

---

## 8. Overall Verdict

**GREEN** — All 11 gates PASS (after 2 inline fixes).

| Category | Gates | Passed | Failed |
|----------|-------|--------|--------|
| Contamination | 5 | 5 | 0 |
| Observer-invariant | 3 | 3 | 0 |
| Log-prefix | 3 | 3 | 0 |
| Smooth-scroll | 1 | 1 | 0 |
| Test suite | — | 60/60 | 0 |
| TypeScript | — | 0 errors | — |
| Deferred-scope | 2 | 2 | 0 |

**Ready for Task 2 (Ashley human-verify checkpoint).**
