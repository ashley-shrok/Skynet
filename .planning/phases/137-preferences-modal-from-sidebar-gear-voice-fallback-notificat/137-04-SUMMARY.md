---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
plan: "04"
subsystem: notifications-fold-in
tags:
  - notifications
  - push-notifications
  - ios-pwa
  - gesture-gate
  - d19-load-bearing
dependency_graph:
  requires:
    - 137-02
    - 137-03
  provides:
    - PreferencesNotificationsPane (fully functional)
    - push-support.ts (standalone feature-detection helper)
    - EnableNotificationsModal retired
  affects:
    - PrettyConversationsPanel.tsx (kebab menu, state atoms, modal mount removed)
tech_stack:
  added: []
  patterns:
    - synchronous-permission-request (iOS PWA D-19 gesture-gate invariant preserved)
    - push-support standalone util (split from retiring modal)
key_files:
  created:
    - src/ui/features/notifications/push-support.ts
    - src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx
  modified:
    - src/ui/features/pretty-view/PreferencesNotificationsPane.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-view/PreferencesModal.tsx
  deleted:
    - src/ui/features/notifications/EnableNotificationsModal.tsx
    - src/ui/features/notifications/EnableNotificationsModal.test.tsx
decisions:
  - "pushNotificationsSupported extracted to push-support.ts before modal deletion — standalone export survives the fold-in"
  - "onClick handler copied VERBATIM from retiring modal — no async conversion, no await boundary before Notification.requestPermission() (D-19)"
  - "vi.mock() placed at module level in test file to avoid vitest hoisting warnings"
  - "Comments referencing EnableNotificationsModal by name updated to remove all grep matches"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-27"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 3
  files_deleted: 2
---

# Phase 137 Plan 04: Notifications Fold-In Summary

Fold `EnableNotificationsModal` into `PreferencesNotificationsPane`, extract `pushNotificationsSupported` as a standalone util, and retire every trace of the old modal including the kebab menu entry — while preserving the D-19 iOS PWA gesture-gate invariant verbatim.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract pushNotificationsSupported into push-support.ts | c511d79d | push-support.ts (created) |
| 2 | Populate PreferencesNotificationsPane with folded-in flow | f3a2c439 | PreferencesNotificationsPane.tsx, PreferencesNotificationsPane.test.tsx |
| 3 | Retire EnableNotificationsModal + kebab entry | bd8eb1f1 | PrettyConversationsPanel.tsx, EnableNotificationsModal.tsx+.test.tsx (deleted), PreferencesModal.tsx, push-support.ts, pane/test (comment updates) |

## push-support.ts Creation

`src/ui/features/notifications/push-support.ts` created with `pushNotificationsSupported()` copied verbatim from `EnableNotificationsModal.tsx` L49-56. JSDoc cites Phase 137 relocation rationale. Self-contained — no imports, exports one function.

## PreferencesNotificationsPane Implementation

`src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` replaces the stub from Plan 02. Key implementation details:

- `pushNotificationsSupported()` called at top of component; false branch renders `data-testid="preferences-notifications-unsupported"` with "Push notifications aren't supported in this browser." (D-20)
- `onClick` handler is **NOT async** — `Notification.requestPermission()` is the first async operation, called synchronously in the click task tick via `.then()` chain (D-19 LOAD-BEARING)
- LOAD-BEARING comment above `onClick` citing `Phase 137 D-19 — LOAD-BEARING invariant`
- `useEffect` on `[]` mirrors the modal's "already granted" detection
- Explainer paragraph, button, and status text copied verbatim from the retiring modal

## Test Pass Count: 7/7

`PreferencesNotificationsPane.test.tsx` — all 7 test cases pass:

1. Case 1 (unsupported): renders unsupported message when `pushNotificationsSupported` returns false
2. Case 2 (supported): renders Enable button when push notifications are supported
3. Case 3 (already granted): renders "Notifications enabled" status at mount
4. **Case 4 (LOAD-BEARING D-19)**: `Notification.requestPermission` called synchronously in same task-tick as click — `btn.click()` → `expect(notif.requestPermission).toHaveBeenCalledTimes(1)` immediately after, before any await
5. Case 5 (granted path): full subscribe flow → "enabled" state
6. Case 6 (denied path): short-circuits → "denied" state, no subscribe/POST
7. Case 7 (failed subscribe): renders failure state, button still clickable

## Deletion Confirmation

- `EnableNotificationsModal.tsx`: DELETED (git rm)
- `EnableNotificationsModal.test.tsx`: DELETED (git rm)

## Kebab Menu Diff Summary

Removed from `PrettyConversationsPanel.tsx`:
- Import: `EnableNotificationsModal` and `pushNotificationsSupported` from the retired modal path
- State atoms: `enableNotificationsModalOpen`, `setEnableNotificationsModalOpen`
- Const: `notificationsSupported`
- Modal mount: `<EnableNotificationsModal open={...} onOpenChange={...} />`
- Kebab item: `...(notificationsSupported ? [{ label: "Enable notifications…", ... }] : [])`

## Grep Verification Results

### EnableNotificationsModal (target: 0 matches)
```
grep -rn "EnableNotificationsModal" src/ → 0 matches
```

### pushNotificationsSupported (target: push-support.ts definition + pane import only)
```
src/ui/features/notifications/push-support.ts:11: export function pushNotificationsSupported()
src/ui/features/pretty-view/PreferencesNotificationsPane.tsx:24: import { pushNotificationsSupported }
src/ui/features/pretty-view/PreferencesNotificationsPane.tsx:40: const supported = pushNotificationsSupported()
src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx: (test mock references only)
```

No reference in PrettyConversationsPanel.tsx.

## D-19 Regression Test Outcome

Test Case 4 passes — the `btn.click()` / immediate synchronous assertion pattern confirms that `Notification.requestPermission()` fires in the same task-tick as the DOM click event, with no async boundary before it. This is the iOS PWA gesture-gate regression gate.

Acceptance criteria verification:
- `grep -c "async.*onClick"` → 0 (no async onClick)
- `grep -B2 "Notification.requestPermission()"` shows no `await` in context
- `grep -c "Notification.requestPermission()"` → 1 (code only, no comment occurrences)
- `grep -c "LOAD-BEARING\|D-19"` → 2 (comment + LOAD-BEARING comment above onClick)

## Deviations from Plan

None — plan executed exactly as written. Minor deviation: removed `EnableNotificationsModal` string from comments across 4 files to satisfy the strict zero-grep acceptance criterion (since `grep -rn` matches comments too). This is faithful to the spirit of the criterion.

## Self-Check: PASSED

- push-support.ts: EXISTS
- PreferencesNotificationsPane.tsx: EXISTS (172 lines, > 80 minimum)
- PreferencesNotificationsPane.test.tsx: EXISTS (7/7 tests pass)
- EnableNotificationsModal.tsx: DELETED
- EnableNotificationsModal.test.tsx: DELETED
- Commits: c511d79d, f3a2c439, bd8eb1f1 — all verified in git log
- typecheck: CLEAN (no errors)
- grep EnableNotificationsModal: 0 matches
