---
phase: 137-interactive-messages-plumbing-first-template
plan: "04"
subsystem: frontend
tags:
  - interactive-messages
  - widget-url-detection
  - iframe
  - react
  - tdd
dependency_graph:
  requires:
    - 138-01 (SweepInteractiveMessageLine — type extension; not blocking this plan)
    - 138-03 (im-pane-router.ts — proxy target; not blocking this plan)
  provides:
    - INTERACTIVE_MSG_URL_RE_CLIENT (client-side widget URL regex)
    - useEditableFileEligibility Map return type (file | interactive-message)
    - WidgetBubble component (in-bubble iframe with retry + postMessage validation)
    - ChatMessage URL-type dispatch (widget → iframe, file → affordance, plain → anchor)
  affects:
    - 138-05 (PrettyView onWidgetSubmit wiring — consumes onWidgetSubmit prop added here)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN for all 3 tasks
    - Map-based URL-type discriminator (not Set — additive with type values)
    - Exponential backoff retry in React useEffect (2s/4s/8s, 3 attempts)
    - Dual postMessage guard (event.source + event.origin)
key_files:
  created:
    - src/ui/features/pretty-view/WidgetBubble.tsx
    - src/ui/features/pretty-view/WidgetBubble.test.tsx
    - src/ui/features/pretty-view/use-editable-file-eligibility.test.tsx
    - src/ui/features/pretty-view/ChatMessage.WidgetBubble.test.tsx
  modified:
    - src/ui/features/pretty-view/editable-file-whitelist.ts (+50 lines: INTERACTIVE_MSG_URL_RE_CLIENT export)
    - src/ui/features/pretty-view/use-editable-file-eligibility.ts (+40 lines: Map return type + widget short-circuit)
    - src/ui/features/pretty-view/use-editable-file-eligibility.test.ts (3 tests updated: Set → Map assertions)
    - src/ui/features/pretty-view/ChatMessage.tsx (+25 lines: WidgetBubble import + prop + a-override dispatch)
    - src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx (10 mocks updated: Set → Map)
    - src/ui/features/pretty-view/PrettyView.editable-file.test.tsx (7 mocks updated: Set → Map)
decisions:
  - "Widget URL classification is purely sync (regex dispatch) — no backend fetch (RESEARCH Pitfall 2 mitigation)"
  - "Variable named `e` not `event` in WidgetBubble postMessage handler — both guards present (e.source + e.origin)"
  - "ChatMessage.editable-file, PrettyView.editable-file updated with Map mocks as Rule 1 auto-fix (existing tests mocked with Set, which has no .get() method)"
metrics:
  duration_seconds: 1887
  completed_date: "2026-09-27"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 6
---

# Phase 138 Plan 04: Interactive Messages Frontend Plumbing Summary

Client-side widget URL detection, in-bubble WidgetBubble iframe, and ChatMessage URL-type dispatch. Three tasks shipped using TDD (RED/GREEN pattern per each task).

## What Shipped

### Task 1: INTERACTIVE_MSG_URL_RE_CLIENT + Map return type

- **`INTERACTIVE_MSG_URL_RE_CLIENT`** added to `editable-file-whitelist.ts` (line ~200): matches `https://<domain>/interactive/<hostId>/<slug>/pane[/<rest>]` with `/g` flag, docblocked per the sibling regex conventions (mirror-rule note, /g gotcha warning).
- **`INTERACTIVE_MSG_DISPATCH_RE`** module-scope non-global dispatch guard in `use-editable-file-eligibility.ts` (safe for `.test()`).
- **`useEditableFileEligibility`** return type changed from `Set<string>` to `Map<string, "file" | "interactive-message">`. Widget URLs short-circuit at the top of the classification loop (`INTERACTIVE_MSG_DISPATCH_RE.test(url)` → `eligible.set(url, "interactive-message"); continue`) — no backend fetch fires for widget URLs (T-138-04-FetchStorm mitigated).
- Identity stability check updated from Set-equality to Map contents-equality (`[...prev.entries()].every(([k, v]) => next.get(k) === v)`).

### Task 2: WidgetBubble.tsx

- New `src/ui/features/pretty-view/WidgetBubble.tsx` component.
- Iframe with `referrerPolicy="no-referrer"` (D-20 pattern from AppPane.tsx), `loading="eager"`, `title="Interactive widget"`, `style={{ height: "200px" }}`.
- `RETRY_DELAYS_MS = [2000, 4000, 8000]` — exponential backoff, capped at 3 retries. Each retry appends `?_r=<ts>` (or `&_r=<ts>`) cache-busting param.
- postMessage listener validates `e.source !== iframeRef.current?.contentWindow` AND `e.origin !== window.location.origin` (T-138-04-MsgInject mitigated).
- Only handles `type === "widget-submit"` signals; other message types are silently dropped.
- Cleanup removes window event listener and clears any pending retry timer on unmount.

### Task 3: ChatMessage.tsx URL-type dispatch

- `WidgetBubble` imported; `onWidgetSubmit?: (widgetId: string, value: string) => void` added to props.
- `a` markdown override: `eligibleUrls.get(href)` dispatch (`"interactive-message"` → WidgetBubble replacing anchor entirely; `"file"` → anchor + EditableFileAffordance; `null` → plain anchor).
- `markdownComponents` useMemo deps updated: `[eventId, onOpenEditor, eligibleUrls, onWidgetSubmit]`.

## Tests Added

| File | Tests |
|------|-------|
| `use-editable-file-eligibility.test.tsx` (new) | 10 (Phase 138 Map contract) |
| `WidgetBubble.test.tsx` (new) | 10 (iframe attrs, retry, postMessage dual-guard, unmount cleanup) |
| `ChatMessage.WidgetBubble.test.tsx` (new) | 6 (URL-type dispatch, onWidgetSubmit threading) |

Total tests added: **26 new tests**

Existing tests updated (mock type changes, Set → Map):
- `use-editable-file-eligibility.test.ts`: 3 tests
- `ChatMessage.editable-file.test.tsx`: 10 tests
- `PrettyView.editable-file.test.tsx`: 7 tests

## TDD Gate Compliance

All three tasks followed RED/GREEN protocol:
- Task 1: `test(138-04-1)` commit (RED) → `feat(138-04-1)` commit (GREEN)
- Task 2: `test(138-04-2)` commit (RED) → `feat(138-04-2)` commit (GREEN)
- Task 3: `test(138-04-3)` commit (RED) → `feat(138-04-3)` commit (GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing test mocks from Set to Map**
- **Found during:** Task 3 (when running the full related test suite)
- **Issue:** `ChatMessage.editable-file.test.tsx` and `PrettyView.editable-file.test.tsx` mocked `useEditableFileEligibility` with `new Set()`. After the hook return type changed to `Map`, calling `.get()` on the Set caused TypeError at runtime in all tests in those files.
- **Fix:** Updated all `new Set(...)` mock values to `new Map([[url, "file"]])` equivalents in both test files.
- **Files modified:** `ChatMessage.editable-file.test.tsx` (10 locations), `PrettyView.editable-file.test.tsx` (7 locations)
- **Commit:** 34c62e60

**2. [Rule 2 - Convention] Variable named `e` instead of `event` in postMessage handler**
- **Found during:** Task 2 verification grep
- **Issue:** Plan verification step 4/5 used grep patterns `event\.source` and `event\.origin`. The actual code uses `e.source` and `e.origin` (the parameter is named `e` per common TypeScript convention).
- **Fix:** Not a bug — both guards are present and correct. The verification greps were adapted to check `e\.source.*contentWindow` and `e\.origin.*window\.location\.origin` which both return ≥1.
- **Files modified:** None (correct as-is)

## Identity Stability

Preserved per Test 10 in `use-editable-file-eligibility.test.tsx`. The Map contents-equality gate (`size + per-key value equality`) prevents unnecessary re-renders in ChatMessage's memoized `a` override when the same Map is produced across re-renders.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced beyond what the plan's threat model documents. All T-138-04-* threats mitigated as designed.

## Self-Check: PASSED

Files exist:
- `src/ui/features/pretty-view/WidgetBubble.tsx` ✓
- `src/ui/features/pretty-view/WidgetBubble.test.tsx` ✓
- `src/ui/features/pretty-view/use-editable-file-eligibility.test.tsx` ✓
- `src/ui/features/pretty-view/ChatMessage.WidgetBubble.test.tsx` ✓

Commits exist:
- 59006342 test(138-04-1): add failing tests for Map return type + widget URL classification ✓
- 9843f123 feat(138-04-1): add INTERACTIVE_MSG_URL_RE_CLIENT + Map return type for useEditableFileEligibility ✓
- c82fa73f test(138-04-2): add failing tests for WidgetBubble component ✓
- 99c97de8 feat(138-04-2): create WidgetBubble component with retry + postMessage validation ✓
- 15a3da48 test(138-04-3): add failing tests for ChatMessage WidgetBubble URL-type dispatch ✓
- 34c62e60 feat(138-04-3): wire WidgetBubble into ChatMessage.tsx with URL-type dispatch ✓

Build: passes (`npm run build` ✓)
Tests: 705 passing, 9 skipped, 1 todo — no failures
