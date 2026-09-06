---
phase: 76-optimistic-bubbles-must-survive-the-wait-when-the-agent-was-
plan: 02
subsystem: pretty-view
tags:
  - failed-bubble-visual
  - whole-bubble-red
  - chat-message
  - pretty-view
  - semantic-upgrade
  - d-06
dependency_graph:
  requires:
    - src/ui/features/pretty-view/ChatMessage.tsx (bubbleInlineStyle showFailedBubble branch)
    - Phase 76 Plan 01 (signal unification — upstream; D-06 visual upgrade is independent but ships in same phase)
  provides:
    - Whole-bubble red fill on flip-to-failed (D-06: saturated red overrides base blue-gray gradient)
    - Test 4b pin test — locks exact CSS values so silent visual drift is caught in CI
  affects:
    - src/ui/features/pretty-view/ChatMessage.tsx (bubbleInlineStyle inline style values)
    - src/ui/features/pretty-view/ChatMessage.test.tsx (new Test 4b + updated comment)
tech_stack:
  added: []
  patterns:
    - "background shorthand (not backgroundColor) in inline style — defeats background-image (gradient) via CSS cascade; backgroundColor alone layers over the gradient without replacing it"
    - "TDD RED-then-GREEN: test commit 42b47484 before implementation commit 7aaf0548"
    - "jsdom hsla→rgba normalization: test assertions use rgba() form that jsdom produces"
key_files:
  created: []
  modified:
    - path: src/ui/features/pretty-view/ChatMessage.tsx
      lines: "390-408 (bubbleInlineStyle showFailedBubble branch — comment rewrite + background shorthand + borderColor values)"
    - path: src/ui/features/pretty-view/ChatMessage.test.tsx
      lines: "392-439 (new Test 4b — 29 added lines)"
decisions:
  - "D-06: Use background shorthand (not backgroundColor) to override the base linear-gradient className at ChatMessage.tsx:451 — backgroundColor alone loses to the gradient in the CSS cascade"
  - "CSS tuple shipped: background hsla(0,60%,35%,0.90) + borderColor hsla(0,70%,50%,0.85)"
  - "jsdom normalizes hsla→rgba in computed style: test asserts rgba(143,36,36,0.9) and rgba(217,38,38,0.85)"
  - "deviation: test assertion updated from hsla() to rgba() to match jsdom normalization (Rule 1 auto-fix)"
metrics:
  duration_min: 13
  completed_date: "2026-09-06"
  tasks_completed: 2
  files_modified: 2
  commits: 2
  tests_added: 1
requirements:
  - D-06
---

# Phase 76 Plan 02: Whole-Bubble Red Visual Summary

**One-liner:** Replace muted-red border + 8%-alpha tint with whole-bubble saturated red fill using CSS `background` shorthand to defeat the base blue-gray gradient — D-06 semantic upgrade so a failed bubble reads as a truly-failed event.

## What Shipped

### Task 1: RED — Test 4b (commit `42b47484`)

Added Test 4b immediately after Test 4 in `ChatMessage.test.tsx` (lines 392-439). Test exercises:
1. Renders `<ChatMessage role="user" content="hello" pendingState="failed" />`
2. Queries `document.querySelector('[data-pv-bubble-failed]')` — asserts non-null
3. Asserts `bubble.style.background` matches saturated-red target value
4. Asserts `bubble.style.borderColor` matches saturated-red target value

**RED evidence** (from `/tmp/76-02-task1-red.log`):
- Test fails at `bubble.style.background` assertion: `expected '' to be 'hsla(0, 60%, 35%, 0.9)'`
- The empty string confirms the current impl uses `backgroundColor` (not the `background` shorthand), which is what the test was written to detect
- ChatMessage.tsx: zero diff in this commit

### Task 2: GREEN — ChatMessage.tsx bubbleInlineStyle (commit `7aaf0548`)

In `ChatMessage.tsx` at lines 390-408, changed `showFailedBubble` branch of `bubbleInlineStyle`:

**Before:**
```typescript
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      borderColor: "hsla(0, 60%, 55%, 0.4)",
      backgroundColor: "hsla(0, 40%, 50%, 0.08)",
    }
  : { position: "relative" };
```

**After:**
```typescript
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      background: "hsla(0, 60%, 35%, 0.90)",
      borderColor: "hsla(0, 70%, 50%, 0.85)",
    }
  : { position: "relative" };
```

Also rewrote the comment block (lines 389-408) to document:
- Phase 76 Plan 02 D-06 semantic upgrade rationale
- Ashley 2026-09-06 verbatim intent
- Why `background` shorthand (not `backgroundColor`) is critical for defeating the gradient

## Exact CSS Tuple Shipped (Ashley's End-of-Phase UAT Reference)

| Property | Value (source code) | jsdom normalized |
|----------|--------------------|----|
| `background` | `hsla(0, 60%, 35%, 0.90)` | `rgba(143, 36, 36, 0.9)` |
| `borderColor` | `hsla(0, 70%, 50%, 0.85)` | `rgba(217, 38, 38, 0.85)` |

**Visual result:** The entire bubble surface is a dark saturated red (hue=0deg, lightness=35%, 90% opaque). The base `linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))` blue-gray gradient is completely replaced — not tinted over — because `background` shorthand overrides `background-image` via CSS specificity.

**Ashley UAT note:** End-of-phase UAT (bundled into orchestrator's post-ship UAT per `human_verify_mode: end-of-phase`). Force-fail a bubble via DevTools console delivering `paste_send_failed` frame OR wait for natural dormant-wake failure. Confirm the failed bubble reads as WHOLE-BUBBLE RED — the entire bubble surface is saturated red, NOT "blue-gray gradient with a red outline."

## TDD Evidence

- RED log at `/tmp/76-02-task1-red.log` — failure: `expected '' to be 'hsla(0, 60%, 35%, 0.9)'` — confirms `bubble.style.background` was empty (current impl used `backgroundColor` shorthand only)
- GREEN: `npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx` — 26/26 pass (including new Test 4b)
- Test 4b: GREEN (was RED in Task 1)
- Tests 4, 5, 6: all pass (existing failed-bubble tests unchanged)
- PrettyView.optimistic-bubbles.test.tsx: 21/21 pass (Plan 01 Test 5c still green)
- `npx tsc --noEmit`: exit 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] jsdom normalizes hsla() to rgba() in bubble.style assertions**
- **Found during:** Task 2 — GREEN run failed at test assertion despite correct implementation
- **Issue:** The plan stated "jsdom normalizes hsla by dropping trailing zeros (`0.90` → `0.9`)" but jsdom actually converts hsla() to rgba() entirely. `bubble.style.background` returned `'rgba(143, 36, 36, 0.9)'` not `'hsla(0, 60%, 35%, 0.9)'`.
- **Fix:** Updated Test 4b assertions to use the jsdom-normalized rgba() values:
  - `background`: `"rgba(143, 36, 36, 0.9)"`
  - `borderColor`: `"rgba(217, 38, 38, 0.85)"`
- **Files modified:** `src/ui/features/pretty-view/ChatMessage.test.tsx` (assertion values only; the test structure, described behavior, and semantic intent are identical to the plan spec)
- **Commit:** `7aaf0548` (included in the GREEN commit alongside ChatMessage.tsx)

## Commit History (TDD RED-then-GREEN)

1. `42b47484` — `test(76-02): RED — add Test 4b pin test for whole-bubble red per D-06`
2. `7aaf0548` — `feat(76-02): GREEN — whole-bubble red fill on flip-to-failed per D-06`

## Files Touched with Line Ranges

| File | Lines | Change |
|------|-------|--------|
| `src/ui/features/pretty-view/ChatMessage.tsx` | 390-408 | Rewrite comment + replace `borderColor`/`backgroundColor` with `background`/`borderColor` saturated-red values |
| `src/ui/features/pretty-view/ChatMessage.test.tsx` | 392-439 | Add Test 4b (29 lines) + rgba() assertion fix |

## Grep Gate Verification

| Gate | Command | Result |
|------|---------|--------|
| background shorthand present | `grep -cE 'background: "hsla\(0,' ChatMessage.tsx` | 1 |
| old tint removed | `grep -c 'hsla(0, 40%, 50%, 0.08)' ChatMessage.tsx` | 0 |
| data attribute preserved | `grep -c 'data-pv-bubble-failed' ChatMessage.tsx` | 2 |
| Test 4b in test file | `grep -c 'Test 4b' ChatMessage.test.tsx` | 2 |

## Known Stubs

None — no stubs in files created or modified by this plan. Both the background and borderColor values are wired to the inline style; no placeholder text or empty data flows.

## Threat Flags

No new threat surface introduced. Pure CSS/inline-style change to a leaf component. Matches STRIDE analysis T-76-02-01 and T-76-02-SC dispositions in plan threat model.

## Self-Check

PASSED — see below.
