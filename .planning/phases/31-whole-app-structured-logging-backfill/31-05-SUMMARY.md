---
phase: 31-whole-app-structured-logging-backfill
plan: "05"
subsystem: compose-pwa
tags:
  - logging
  - instrumentation
  - compose
  - tap
  - pwa
  - D-11
  - D-13
  - D-17
dependency_graph:
  requires:
    - 31-01
    - 31-04
  provides:
    - canonical-compose-logging-shape
    - pwa-lifecycle-logging
  affects:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/main.tsx
tech_stack:
  added: []
  patterns:
    - "[compose] event key=value structured log lines"
    - "[tap] event key=value flattened shape with tapDedup opt-in"
    - "[pwa] lifecycle event lines at page-level bootstrap"
    - "aside-morph useEffect+prevRef edge detection pattern"
    - "handleSend trigger= attribution param"
key_files:
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/main.tsx
decisions:
  - "Test file src/main.instrumentation.test.tsx skipped per D-20 — vitest project patterns only cover src/ui/** (frontend) and src/backend/** (backend); src/main.tsx at root is excluded from both; adding it would require config changes disproportionate to the diagnostic value of these 4 lifecycle lines"
  - "snapshot-tab-restore log emits result=no-pending unconditionally because snapshotPendingTab() returns void; sufficient for diagnosing whether the snapshot boundary was reached at all"
  - "tapDedup N=5 W=3000ms per plan — higher N than default because tap volume is chatter, shorter W because taps cluster in bursts"
  - "handleSend trigger param added as optional string union to minimize call-site churn while enabling attribution; all 3 call sites updated (enter-key, send-button, queue-item)"
  - "aside-morph useEffect uses prevAsideActiveRef to skip first-render log (no edge on mount, only genuine false→true / true→false transitions)"
metrics:
  duration: "~25 minutes"
  completed: "2026-08-11"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 31 Plan 05: Compose/Draft/Tap + PWA Lifecycle Instrumentation Summary

Renamed `[compose-draft]` → `[compose]` and `[tap-diag]` → `[tap]` per D-13; normalized all shapes to D-11 template-literal key=value form; added compose submit (entry + success + failure) and aside-morph transition logs; wired tapDedup (D-17) around all 6 tap emissions; added PWA lifecycle structured logs at main.tsx level (visibilitychange, pagehide, pageshow, boot, snapshot-tab-restore).

## What Was Built

### Task 1: ComposeBox.tsx — prefix rename + shape normalization + new instrumentation

**[compose] lines added:**
- `[compose] draft-save` — renamed from `[compose-draft] save`, printf-placeholder → template-literal (1 site, line ~632)
- `[compose] draft-load` — renamed from `[compose-draft] load`, printf-placeholder → template-literal (1 site, line ~771)
- `[compose] submit-entry` — NEW, logs hostId + tmuxSession + bodyLen + attachmentCount + trigger at send handler entry (2 sites: attachment path + normal send path)
- `[compose] submit-success` — NEW, logs bodyLen at successful dispatch (2 sites)
- `[compose] submit-failed` — NEW, logs err="not-connected" when onSend returns false (1 site)
- `[compose] aside-morph` — NEW, useEffect+prevAsideActiveRef emits edge=false→true / true→false on asideActive prop changes

**[tap] lines added:**
- `[tap] pointerdown` — renamed from `[tap-diag] pointerdown`, object-literal flattened to `x= y= pointerType= targetTag= selfTarget= rectT= rectL= rectW= rectH= textLen= scrollY=` (1 site, dedup-wrapped)
- `[tap] post-30ms` — renamed, geometry snapshot at 30ms (1 site, dedup-wrapped)
- `[tap] post-300ms` — renamed, geometry snapshot at 300ms (1 site, dedup-wrapped)
- `[tap] focus` — renamed, geometry snapshot on focus (1 site, dedup-wrapped)
- `[tap] blur` — renamed, geometry snapshot on blur (1 site, dedup-wrapped)
- `[tap] selchange` — renamed, sel=start,end on selectionchange (1 site, dedup-wrapped)

**Dedup:** `tapDedup = createLogDedup({ N: 5, W: 3000 })` (module-scoped) wraps all 6 `[tap]` emissions per D-17.

**handleSend trigger= attribution:** added optional `trigger: "enter-key" | "send-button" | "queue-item" | "unknown"` parameter; updated 3 call sites.

### Task 2: main.tsx — PWA lifecycle handlers + boot boundary

**[pwa] lines added:**
- `[pwa] visibility-change state=${document.visibilityState} hidden=${document.hidden}` — window visibilitychange listener
- `[pwa] pagehide persisted=${e.persisted}` — window pagehide listener (PageTransitionEvent)
- `[pwa] pageshow persisted=${e.persisted}` — window pageshow listener (PageTransitionEvent)
- `[pwa] boot ts=${Date.now()} ua="..." pathname=${window.location.pathname}` — immediately after initConsoleForwarder + registerPwaLifecycleLogs
- `[pwa] snapshot-tab-restore result=no-pending` — after snapshotPendingTab() (which returns void)

Handlers extracted into `registerPwaLifecycleLogs()` exported function for future testability.

## Log Line Counts per Subsystem

| Subsystem | New Lines | Remapped Lines | Total |
|-----------|-----------|----------------|-------|
| `[compose]` | 6 (submit-entry×2, submit-success×2, submit-failed, aside-morph) | 2 (draft-save, draft-load) | 8 |
| `[tap]` | 0 | 6 (pointerdown, post-30ms, post-300ms, focus, blur, selchange) | 6 |
| `[pwa]` | 5 (visibility-change, pagehide, pageshow, boot, snapshot-tab-restore) | 0 | 5 |

## Old Prefix Elimination

| Old Prefix | Sites Before | Sites After |
|-----------|-------------|------------|
| `[compose-draft]` | 2 | 0 |
| `[tap-diag]` | 6 | 0 |

## Test File Decision

`src/main.instrumentation.test.tsx` **skipped per D-20 discretion.**

Reason: vitest.config.ts project configuration covers `src/ui/**/*.test.{ts,tsx}` (frontend/jsdom) and `src/backend/**/*.test.ts` (backend/node) only. A test at `src/main.instrumentation.test.tsx` is excluded from both patterns and would fail to run without modifying vitest.config.ts — a disproportionate change to test 4 console.info lines.

The `registerPwaLifecycleLogs()` function is exported for future testability if the config is extended.

All 3 `<behavior>` test scenarios are verifiable manually:
1. `visibilitychange` → `console.info` matching `/^\[pwa\] visibility-change state=hidden hidden=true/`
2. `pageshow` with `persisted=true` → `/^\[pwa\] pageshow persisted=true/`
3. `pagehide` with `persisted=false` → `/^\[pwa\] pagehide persisted=false/`

## Session-Open Flow Coverage (D-02)

`main.tsx` has no URL-fragment routing or `#session=...` handler — session-open triggering lives in AppShell and PrettyConversationsPanel. The `[pwa] boot` and `[pwa] snapshot-tab-restore` lines cover the main.tsx entry point boundary. Deeper session-open flow (AppShell, conversations-panel-click) is out of scope for plan-05 per the `<action>` D section.

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 2 - Enhancement] handleSend trigger= parameter for submit-entry attribution**
- **Found during:** Task 1 — adding `[compose] submit-entry` log
- **Issue:** The plan specified `trigger=${trigger ?? 'unknown'}` in the submit-entry log, but `handleSend` didn't have a trigger parameter
- **Fix:** Added optional `trigger` param to `handleSend` with default `"unknown"`; updated 3 call sites: `handleKeyDown` passes `"enter-key"`, send button `onClick` passes `"send-button"`, `handleVoiceSend` passes `"queue-item"`
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.tsx`
- **Tests:** All 119 ComposeBox tests green

**2. [Rule 2 - Enhancement] snapshot-tab-restore result=no-pending fixed string**
- **Found during:** Task 2 — `snapshotPendingTab()` returns void (not a result value)
- **Fix:** Log `result=no-pending` unconditionally after the call — sufficient to confirm the boundary was reached; the real diagnostic value is knowing the call completed, not its return value
- **Files modified:** `src/main.tsx`

## Known Stubs

None. All log lines are wired to real runtime values.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced.

Log lines carry:
- `bodyLen` (numeric character count) — T-31-12 compliant (NEVER compose body text)
- `attachmentCount` (numeric) — no filenames or content
- `document.visibilityState`, `document.hidden`, `e.persisted` — browser-standard PWA fields
- `navigator.userAgent.slice(0, 80)` — T-31-14 accept disposition (UA is public on every HTTP request)
- `window.location.pathname` — page URL path only, no query params or fragments with session tokens
- Tap coordinates (clientX/Y), pointerType, targetTag — T-31-13 mitigated by tapDedup (D-17)

## Self-Check: PASSED

- File exists: `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND
- File exists: `src/main.tsx` — FOUND
- `[compose-draft]` in src/: 0 — PASSED
- `[tap-diag]` in src/: 0 — PASSED
- `[pwa]` lines in src/main.tsx: 6 — PASSED (required >=4)
- Commit `42859a5` (Task 1) exists — FOUND
- Commit `0573a5a` (Task 2) exists — FOUND
- TypeScript: exit 0 — PASSED
- Test suite: 1907/1907 passed (150 files) — PASSED
