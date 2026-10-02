---
phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-
plan: 03
subsystem: frontend
tags: [ntfy, notifications, preferences-pane, service-worker, frontend, tdd]

# Dependency graph
requires:
  - "144-01: assertNtfyConfigAtBoot, getNtfyBaseUrl available"
provides:
  - "ntfy-setup-api.ts: 5 exports (getNtfySetup, postNtfySetup, postNtfyTest, postNtfyRegenerate, deleteNtfySetup) using authApi+JWT pattern"
  - "PreferencesNotificationsPane.tsx rebuilt: two-state ntfy setup pane, no browser-push API refs, window.confirm gate on regenerate"
  - "public/sw.js trimmed: only install/activate/fetch handlers remain"
affects:
  - "144-04: SKILL.md update (explicitly out of scope for this plan per MC-5)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ntfy-setup-api.ts mirrors apps-archive-api.ts authApi+handleApiError pattern"
    - "TDD RED/GREEN: test files committed first, implementation second"
    - "vi.spyOn(window, 'confirm') for deterministic confirm/cancel branch testing (MC-2)"

key-files:
  created:
    - src/ui/features/notifications/ntfy-setup-api.ts
    - src/ui/features/notifications/ntfy-setup-api.test.ts
  modified:
    - src/ui/features/pretty-view/PreferencesNotificationsPane.tsx
    - src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx
    - public/sw.js
  deleted:
    - src/ui/features/notifications/sw-pushsubscriptionchange.test.ts

key-decisions:
  - "MC-2 window.confirm: vi.spyOn(window, 'confirm') used in PANE-06a/06b to deterministically control confirm/cancel branches"
  - "ntfy-setup-api uses plain fetch (authApi) not the old VAPID-era global fetch pattern"
  - "sw.js stripped to lifecycle+cache only: 251 lines → 98 lines; notificationclick deleted (dead without browser push)"
  - "pushsubscriptionchange test deleted in this plan (its subject is gone); other push tests deferred to plan 04 deletion sweep per task scope"

# Metrics
duration: 4min
completed: 2026-10-02
---

# Phase 144 Plan 03: Frontend Rebuild Summary

**ntfy setup API client + rebuilt notifications pane + service worker push handler cleanup — pure cutover frontend half**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-10-02T22:27:19Z
- **Completed:** 2026-10-02T22:31:55Z
- **Tasks:** 2 (Task 1 TDD RED/GREEN, Task 2 direct)
- **Files modified:** 5 (2 created, 2 modified, 1 deleted)

## Accomplishments

- Created `ntfy-setup-api.ts` with 5 exports (getNtfySetup, postNtfySetup, postNtfyTest, postNtfyRegenerate, deleteNtfySetup) using the authApi+handleApiError pattern from `main-axios`; TypeScript interface `NtfySetup` exported
- Rewrote `PreferencesNotificationsPane.tsx` from 173 lines to 436 lines: two-state ntfy pane, backend-truthful isSetUp derivation, window.confirm gate on regenerate (T-144-15), three value rows with copy-to-clipboard affordances, inline test result (10s auto-clear), zero browser-push API refs
- Rewrote `PreferencesNotificationsPane.test.tsx`: 9 tests covering PANE-01..PANE-08 with MC-2 PANE-06a/06b (vi.spyOn window.confirm), vi.restoreAllMocks() in afterEach
- Stripped `public/sw.js` from 251 to 98 lines: deleted push, notificationclick, pushsubscriptionchange handlers, and arrayBufferToBase64Url helper; install/activate/fetch preserved; node --check passes
- Deleted `sw-pushsubscriptionchange.test.ts` (its handler subject is gone)

## Task Commits

1. **Task 1 RED: test files** — `ea03a2e3` (test)
2. **Task 1 GREEN: ntfy-setup-api.ts + rebuilt pane** — `ed93e635` (feat)
3. **Task 2: sw.js trimmed + obsolete test deleted** — `49a397b8` (feat)

## Files Created/Modified

- `src/ui/features/notifications/ntfy-setup-api.ts` — 5 exports for ntfy setup endpoints; NtfySetup + NtfyTestResult interfaces
- `src/ui/features/notifications/ntfy-setup-api.test.ts` — 12 tests covering API-01..API-05 (happy + error paths for all 5 methods)
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` — Rebuilt from scratch; 436 lines; ValueRow, NotSetUpView, SetUpView sub-components; no Notification/pushManager refs
- `src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx` — 9 tests; PANE-06a/06b use vi.spyOn(window, "confirm")
- `public/sw.js` — Stripped from 251 to 98 lines; lifecycle+cache only
- `src/ui/features/notifications/sw-pushsubscriptionchange.test.ts` — DELETED

## Decisions Made

- **MC-2 vi.spyOn pattern:** jsdom's window.confirm returns undefined without blocking — vi.spyOn is required to test both confirm=true and confirm=false branches deterministically. The spy is installed in each test and cleaned via vi.restoreAllMocks() in afterEach.
- **notificationclick deleted:** The handler fires on showNotification() taps which only originate from the push handler (now deleted). Dead code removal is correct; ntfy iOS app handles tap routing natively via the click URL field.
- **authApi vs global fetch:** ntfy-setup-api uses authApi (withCredentials: true, JWT cookie) mirroring the existing pattern for authenticated endpoints. The old push-subscription-api used raw global fetch with `credentials: "include"` — same security posture, cleaner with the axios instance.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all five API methods are wired to the real backend endpoints. The pane renders live data from getNtfySetup() on mount.

## Threat Flags

None — all threat mitigations from the plan's threat_model are implemented:
- T-144-14 (accepted): reading_credential rendered in DOM as user-intended; no new surface
- T-144-15 (mitigated): window.confirm gate before every postNtfyRegenerate call; MC-2 tests verify both branches
- T-144-16 (accepted): test result shows inline error message; no auto-retry
- T-144-17 (mitigated): sw.js hash changes (content changed); browsers re-register SW; activate handler already includes skipWaiting + clients.claim()

## TDD Gate Compliance

- RED gate: `ea03a2e3` (test commit — failing tests at import resolution)
- GREEN gate: `ed93e635` (feat commit — 22 tests pass)
- REFACTOR: none required — implementation was clean on first pass

## Self-Check: PASSED

- `src/ui/features/notifications/ntfy-setup-api.ts` exists with 5+ exports: VERIFIED (7 exports including interface exports)
- `src/ui/features/notifications/ntfy-setup-api.test.ts` exists with 12 tests: VERIFIED
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` exists with 436 lines: VERIFIED
- `src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx` exists with vi.spyOn(window, "confirm"): VERIFIED (2 occurrences)
- `public/sw.js` 98 lines (< 160), node --check passes: VERIFIED
- `sw-pushsubscriptionchange.test.ts` does NOT exist: VERIFIED
- All 42 tests pass (22 Task-1 + 12 ntfy-api + 8 open-harness retained): VERIFIED
- `npm run build` exits 0: VERIFIED
- Commits present: `ea03a2e3`, `ed93e635`, `49a397b8`: VERIFIED

---
*Phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-*
*Completed: 2026-10-02*
