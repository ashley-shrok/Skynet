---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "08"
subsystem: testing
tags: [react, vitest, testing-library, iframe, postmessage, widget-bubble, interactive-messages]

# Dependency graph
requires:
  - phase: 137-widget-bubble
    provides: WidgetBubble component with source+origin postMessage guards
  - phase: 140-01
    provides: interactive-message URL classification and eligibleUrls Map
  - phase: 140-04
    provides: ChatMessage `a` override wiring WidgetBubble per interactive-message URL

provides:
  - Automated proof that N widget URLs in one ChatMessage render N independent iframes
  - Automated proof that per-mount postMessage source-guard scales to N concurrent WidgetBubble mounts
  - Automated proof that per-mount useEffect cleanup removes only that mount's listener on unmount

affects: [phase-140, any phase touching WidgetBubble or ChatMessage multi-widget rendering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "multi-widget test pattern: mockedHook.mockReturnValue with N-entry Map, getAllByTitle assertions"
    - "per-mount source-guard test pattern: distinct {} contentWindow objects, per-iframe Object.defineProperty"
    - "unmount cleanup test pattern: unmount+remount to get clean listener state, removeEventListener spy for confirmation"

key-files:
  created:
    - src/ui/features/pretty-view/ChatMessage.multi-widget.test.tsx
    - src/ui/features/pretty-view/WidgetBubble.multi-mount.test.tsx
  modified: []

key-decisions:
  - "Test 4 (WidgetBubble multi-mount): used full unmount+remount pattern rather than rerender — React reconciles component position when switching from a fragment to a single component, making pre-rerender contentWindow assignments unreliable as source-guard targets"
  - "Did not mock WidgetBubble in ChatMessage multi-widget tests — real component used so source-guard (iframeRef instance-local check) is exercised meaningfully"
  - "No production code changes required — WidgetBubble.tsx and ChatMessage.tsx are correct as-is"

patterns-established:
  - "Pattern: getAllByTitle('Interactive widget') is the canonical selector for asserting N-widget renders"
  - "Pattern: assign distinct {} fake contentWindows via Object.defineProperty before dispatching MessageEvents to exercise per-mount source guards"

requirements-completed: []

# Metrics
duration: 11min
completed: 2026-09-27
---

# Phase 140 Plan 08: Multi-Widget Frontend Verification Summary

**Nine automated tests proving N independent iframes per ChatMessage and per-mount postMessage source-guard isolation, with no production code changes needed**

## Performance

- **Duration:** 11 min
- **Started:** 2026-09-27T22:14:11Z
- **Completed:** 2026-09-27T22:24:33Z
- **Tasks:** 2
- **Files modified:** 2 (created)

## Accomplishments
- `ChatMessage.multi-widget.test.tsx` — 5 tests: 2-URL render, 3-URL render, mixed-content render, per-mount onWidgetSubmit routing, cross-source guard rejection
- `WidgetBubble.multi-mount.test.tsx` — 4 tests: 2-iframe render, per-mount onSubmit isolation, cross-source rejection on N mounts, per-mount cleanup on unmount
- Full pretty-view suite (104 test files, 1223 tests) remained green after both files were added

## Task Commits

Each task was committed atomically:

1. **Task 1: ChatMessage multi-widget rendering test** - `f4d8fab1` (test)
2. **Task 2: WidgetBubble multi-mount independence test** - `07202222` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `src/ui/features/pretty-view/ChatMessage.multi-widget.test.tsx` — 5-case vitest file verifying ChatMessage renders N iframes for N interactive-message URLs, with correct per-mount onWidgetSubmit dispatch and cross-source guard enforcement
- `src/ui/features/pretty-view/WidgetBubble.multi-mount.test.tsx` — 4-case vitest file verifying two concurrent WidgetBubble mounts have independent listeners, independent onSubmit callbacks, and per-mount cleanup on unmount

## Decisions Made
- Used real WidgetBubble (not a mock) in ChatMessage tests so the source-guard comparison (`e.source !== iframeRef.current?.contentWindow`) is exercised with actual instance-local iframeRef objects
- Test 4 (multi-mount cleanup) uses full unmount+remount cycle rather than `rerender` with a reduced fragment. Reason: when `rerender` switches from `<><A/><B/></>` to `<B/>` React reconciles B to position 0, potentially reusing A's DOM element (which has A's fake contentWindow). This makes pre-rerender contentWindow assignments unreliable source-guard targets. Full unmount+remount gives clean state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 4 initial design had unreliable contentWindow identity after rerender**
- **Found during:** Task 2 (WidgetBubble multi-mount test — Test 4)
- **Issue:** Initial implementation used `rerender(<WidgetBubble src={SRC_W2} onSubmit={fnB} />)` after setting contentWindows pre-rerender. After rerender, React reused DOM element at position 0 (mount A's old iframe, which had `fakeContentWindowA`), making mount B's iframeRef point to the element with mount A's contentWindow. Dispatching msgA then called fnB (2 total calls instead of 1).
- **Fix:** Replaced `rerender` pattern with `unmount` + fresh `render` so mount B gets a clean DOM element with no pre-assigned contentWindow. Used `removeEventListener` spy to confirm listeners were removed on unmount, then set contentWindow on the freshly-mounted surviving iframe.
- **Files modified:** `src/ui/features/pretty-view/WidgetBubble.multi-mount.test.tsx`
- **Verification:** `npx vitest run WidgetBubble.multi-mount.test.tsx` exits 0, all 4 tests pass
- **Committed in:** `07202222` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test design bug in initial approach)
**Impact on plan:** Minor test-design correction; no production code affected; cleanup proof is now stronger (uses removeEventListener spy in addition to behavioral assertion).

## Issues Encountered
React DOM reconciliation behavior: when `rerender` reduces a `<><A/><B/></>` fragment to `<B/>`, component B is reconciled to position 0 in the DOM tree and may reuse the DOM element previously occupied by A. Any `Object.defineProperty` assignments on A's iframe survive on that DOM element, causing mount B's `iframeRef.current` to resolve to an element with A's contentWindow. This is expected React behavior — not a WidgetBubble bug. The fix (unmount+remount) is the standard pattern for testing cleanup in isolation.

## Threat Model Coverage

| Threat ID | Mitigation | Test(s) |
|-----------|-----------|---------|
| T-140-08-CrossMountLeak | Source-guard is per-iframeRef instance | ChatMessage Test 4 + 5, WidgetBubble Test 2 + 3 |
| T-140-08-StaleListener | useEffect cleanup removes listener on unmount | WidgetBubble Test 4 (removeEventListener spy) |
| T-140-08-SourceGuardBypass | Foreign source {} fires zero callbacks | ChatMessage Test 5, WidgetBubble Test 3 |
| T-140-08-CoverageGap | Multi-angle coverage: 2-URL, 3-URL, mixed, per-mount routing | ChatMessage Tests 1-4, WidgetBubble Tests 1-2 |

## No Bugs Found in Production Code

`WidgetBubble.tsx` and `ChatMessage.tsx` are correct as-is. Each `useState`, `useRef`, and `useEffect` in WidgetBubble is instance-local by React semantics. The module-scope `RETRY_DELAYS_MS` is a constant (not mutable state) — safe to share. The postMessage source+origin dual guard scales correctly to N concurrent mounts because `iframeRef` is a per-mount `useRef`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 140 deliverable C (multi-widget verification) complete
- Multi-widget rendering proven correct via automated tests
- Source-guard isolation proven for N concurrent mounts
- Full test suite green — no regressions introduced

---
*Phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget*
*Completed: 2026-09-27*

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/ChatMessage.multi-widget.test.tsx`
- FOUND: `src/ui/features/pretty-view/WidgetBubble.multi-mount.test.tsx`
- FOUND: `.planning/phases/140-.../140-08-SUMMARY.md`
- FOUND commit: `f4d8fab1` (Task 1)
- FOUND commit: `07202222` (Task 2)
- FOUND commit: `b064b766` (plan metadata)
