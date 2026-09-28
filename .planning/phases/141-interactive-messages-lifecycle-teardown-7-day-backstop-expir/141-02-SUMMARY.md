---
phase: "140"
plan: "02"
subsystem: frontend/pretty-view/widget-bubble
tags: [interactive-messages, ui, widget-bubble, expired-placeholder, dark-theme, tdd, accessibility]
dependency_graph:
  requires: []
  provides: [expired-placeholder-render-branch]
  affects: [src/ui/features/pretty-view/WidgetBubble.tsx]
tech_stack:
  added: []
  patterns: [inline-expired-placeholder, role-status-accessibility, tdd-red-green]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/WidgetBubble.tsx
    - src/ui/features/pretty-view/WidgetBubble.test.tsx
decisions:
  - "setExpired(true) fires inside the existing onError handler when retryCount >= RETRY_DELAYS_MS.length — keeping all retry logic in one effect, no structural changes"
  - "Dark-theme tokens bg-black/40 + border-white/10 match sibling AddWakeupDialog and MarkdownEditor patterns confirmed by grep"
  - "Placeholder placed as early-return before iframe return — cleanest conditional with no conditional hook ordering issues"
  - "Test 11/13 tail-block checks for iframe4 before firing a 4th error, matching the actual implementation (expired fires on the error AFTER the 3rd delay elapses)"
metrics:
  duration: "~4 minutes"
  completed: "2026-09-27"
  tasks_completed: 2
  files_modified: 2
---

# Phase 141 Plan 02: WidgetBubble Expired-Placeholder Branch Summary

One-liner: Dark-theme inline expired-placeholder replaces broken iframe after 3-retry exhaustion, with `role="status"` accessibility and full vitest coverage (13 tests).

## What Was Built

Extended `WidgetBubble.tsx` with an expired-placeholder render branch. After the existing
exponential-backoff retry schedule (2s/4s/8s, 3 attempts) is fully exhausted and the iframe
still fires an error event, the component replaces the iframe with a compact inline card:

> "This interactive message expired. Ask the agent to send it again if you still need it."

The card:
- Uses dark-theme tokens (`bg-black/40`, `border-white/10`, `text-white/70`) matching sibling components
- Carries `role="status"` and `aria-label="Expired interactive message"` for assistive technology
- Is visually inert — no clickable elements, no broken-frame chrome

## TDD Cycle

**RED (commit 5f047d65):** Tests 11-13 written first, all failing — confirmed iframe still rendered, no `role="status"` node, no placeholder text.

**GREEN (commit b4dd0501):** Implementation added — `expired` state, `setExpired(true)` in the retry onError cap branch, expired-placeholder JSX early-return. All 13 tests pass.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| TDD RED | Failing tests 11-13 | 5f047d65 | WidgetBubble.test.tsx |
| Task 1 GREEN | Expired-placeholder implementation | b4dd0501 | WidgetBubble.tsx |
| Task 2 | Tests already in place from TDD RED | — | WidgetBubble.test.tsx |

## Verification Results

All plan verification checks pass:
- `grep -q 'This interactive message expired' WidgetBubble.tsx` — PASS
- `grep -q 'Ask the agent to send it again' WidgetBubble.tsx` — PASS
- `grep -q 'role="status"' WidgetBubble.tsx` — PASS
- `grep -c '^  it(' WidgetBubble.test.tsx` — 13 (PASS, ≥13 required)
- `npx vitest run WidgetBubble.test.tsx` — 13/13 passed, exit 0
- `npm run build` — clean, exit 0, no TypeScript errors

## Test Coverage Added

| Test | Description | Assertion |
|------|-------------|-----------|
| Test 11 | After 3rd retry error + delay, iframe replaced by placeholder | `queryByTitle("Interactive widget")` returns null; placeholder text present |
| Test 12 | After 2 retry errors, iframe still present (not yet expired) | `queryByTitle("Interactive widget")` not null; no placeholder text |
| Test 13 | Expired placeholder accessibility attributes | `role="status"` present; `aria-label="Expired interactive message"` |

## Deviations from Plan

None — plan executed exactly as written. The TDD RED/GREEN cycle followed the prescribed approach. Task 2 tests were written during the RED phase and verified passing after the GREEN implementation, which is the intended TDD flow.

## Threat Model Mitigations Applied

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-141-02-A11y | `role="status"` + `aria-label` on placeholder container | Applied; Test 13 asserts both attributes |
| T-141-02-XSS | Both copy strings are static literals — zero interpolation from src/props | Confirmed in code review |
| T-141-02-DoS | Retry cap unchanged (3 delays); expired branch stops all further work | Confirmed; Test 4 (existing) still asserts cap behavior |

## Known Stubs

None. Both copy strings render from static literals. No data source plumbing needed.

## Self-Check: PASSED

- `src/ui/features/pretty-view/WidgetBubble.tsx` — EXISTS, contains `expired` state, placeholder JSX, copy strings
- `src/ui/features/pretty-view/WidgetBubble.test.tsx` — EXISTS, contains 13 `it(` blocks, Tests 11-13 present
- Commit `5f047d65` — EXISTS (TDD RED)
- Commit `b4dd0501` — EXISTS (GREEN implementation)
- All 13 vitest tests pass
- Frontend build exits 0
