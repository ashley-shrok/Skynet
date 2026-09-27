---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
plan: "02"
subsystem: ui-modal-preferences-avatar
tags:
  - preferences-modal
  - avatar-upload
  - sidebar-live-sync
  - modal-chrome
dependency_graph:
  requires:
    - 137-01 (UserPreferences.fallbackVoice type, UserInfo.avatarPath type)
  provides:
    - PreferencesModal shell with left-nav (4 tabs: General, Voice, Notifications, About you)
    - PreferencesGeneralPane fully functional (upload, remove, preview, error revert)
    - Sidebar footer gear button opens PreferencesModal (D-08)
    - Sidebar footer avatar live-sync after upload without page refresh (D-12, D-30)
    - uploadUserAvatar / removeUserAvatar helpers in user-preferences-api.ts
    - meUserId + meAvatarPath state atoms in AppShell
    - Three stub panes (PreferencesVoicePane, PreferencesNotificationsPane, PreferencesAboutYouPane) ready for Plans 03/04/05
  affects:
    - src/ui/features/pretty-view/PreferencesModal.tsx
    - src/ui/features/pretty-view/PreferencesGeneralPane.tsx
    - src/ui/features/pretty-view/PreferencesVoicePane.tsx
    - src/ui/features/pretty-view/PreferencesNotificationsPane.tsx
    - src/ui/features/pretty-view/PreferencesAboutYouPane.tsx
    - src/ui/features/pretty-view/PreferencesModal.test.tsx
    - src/ui/features/pretty-view/PreferencesGeneralPane.test.tsx
    - src/ui/api/user-preferences-api.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/AppShell.tsx
tech_stack:
  added: []
  patterns:
    - Modal chrome from EnableNotificationsModal (byte-copy with size/testid swaps)
    - Glass close button from GlobalFilesModal L252-276
    - NAV_SECTIONS array from IdentityModal L308-314 (adapted vertical layout)
    - D-05 tab reset from EnableNotificationsModal L72-82 useEffect pattern
    - URL.createObjectURL + revokeObjectURL from VoicePicker cleanup pattern
    - authApi + handleApiError multipart PUT shape from identities-api.ts
    - Cache-bust ?f={avatarPath} for sidebar footer avatar src
key_files:
  created:
    - src/ui/features/pretty-view/PreferencesModal.tsx
    - src/ui/features/pretty-view/PreferencesGeneralPane.tsx
    - src/ui/features/pretty-view/PreferencesVoicePane.tsx
    - src/ui/features/pretty-view/PreferencesNotificationsPane.tsx
    - src/ui/features/pretty-view/PreferencesAboutYouPane.tsx
    - src/ui/features/pretty-view/PreferencesModal.test.tsx
    - src/ui/features/pretty-view/PreferencesGeneralPane.test.tsx
  modified:
    - src/ui/api/user-preferences-api.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/AppShell.tsx
decisions:
  - "NAV_SECTIONS rendered via Array.map with template literal data-testid — one grep line vs four; all 4 testids still generated at runtime and tested"
  - "Added meUserId state atom alongside meAvatarPath — required to thread userId into PreferencesModal for PUT/DELETE avatar endpoint"
  - "userPrefs prop on PrettyConversationsPanel typed as optional import type to avoid circular import concerns"
  - "enable-notifications kebab item NOT removed (Plan 04 owns); Globe button NOT removed (Plan 05 owns)"
metrics:
  duration: "543 seconds"
  completed: "2026-09-27"
  tasks_completed: 3
  files_modified: 10
---

# Phase 137 Plan 02: PreferencesModal Shell + General Pane + Sidebar Wiring Summary

**One-liner:** Radix-based Preferences modal with 4-tab left-nav, fully-functional avatar upload/remove in the General pane, and sidebar footer gear button + live-sync wiring without page refresh.

## Files Touched

| File | Summary |
|------|---------|
| `src/ui/features/pretty-view/PreferencesModal.tsx` | New modal shell: Radix DialogPrimitive chrome (verbatim from EnableNotificationsModal), md:max-w-[760px] md:max-h-[600px], left-nav with 4 NAV_SECTIONS (General/Voice/Notifications/About you), glass close button (verbatim from GlobalFilesModal), D-04 backdrop-click prevention, D-05 tab reset on close, dispatches to 4 pane components |
| `src/ui/features/pretty-view/PreferencesGeneralPane.tsx` | Avatar upload/remove UI: 72px preview circle, Choose image button (hidden file input accept=image/*), Remove button, URL.createObjectURL local preview, revokeObjectURL cleanup, uploadUserAvatar on file select, removeUserAvatar on Remove click, inline error on failure (no toast — D-13), onAvatarChanged callback for sidebar live-sync |
| `src/ui/features/pretty-view/PreferencesVoicePane.tsx` | Stub: single placeholder div with data-testid=preferences-voice-pane-stub, typed props for Plan 03 |
| `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` | Stub: single placeholder div with data-testid=preferences-notifications-pane-stub, typed props for Plan 04 |
| `src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` | Stub: single placeholder div with data-testid=preferences-about-you-pane-stub, typed props for Plan 05 |
| `src/ui/features/pretty-view/PreferencesModal.test.tsx` | 7 test cases: open/close renders, all 4 nav switches (by data-testid), Escape close, D-05 tab-reset-on-reopen invariant |
| `src/ui/features/pretty-view/PreferencesGeneralPane.test.tsx` | 7 test cases: initials fallback, img render, local preview, upload success, upload failure + inline error, remove success, remove failure + inline error |
| `src/ui/api/user-preferences-api.ts` | Added uploadUserAvatar (PUT multipart /users/:id/avatar) and removeUserAvatar (DELETE /users/:id/avatar), both using authApi + handleApiError |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Added PreferencesModal import; added preferencesModalOpen useState atom; replaced inert gear `<span>` with real `<button data-testid=pv-footer-preferences-button>`; replaced static initials `<span>` with conditional `<img data-testid=pv-footer-avatar-image>` when avatarPath truthy; added `<PreferencesModal>` mount; extended props with userId/avatarPath/onAvatarChanged/userPrefs |
| `src/ui/AppShell.tsx` | Added meUserId + meAvatarPath state atoms; populated both from getUserInfo().userId/avatarPath; threaded userId/avatarPath/onAvatarChanged/userPrefs into PrettyConversationsPanel mount |

## Test Results

```
PreferencesModal.test.tsx      1 file   7 tests  PASSED
PreferencesGeneralPane.test.tsx 1 file  7 tests  PASSED
TOTAL: 2 test files, 14 tests, all PASSED
```

## Typecheck State

`npm run type-check` exits 0 with no errors.

Note: The Plan 01 SUMMARY warned about 3 `reopenTabsOnLogin` sites in AppShell.tsx that
would produce compile errors (deferred to Plan 06). In practice, TypeScript did not
flag the `{ reopenTabsOnLogin: false }` seed as an error (likely due to the project's
tsconfig excess-property-check settings). Plan 06 should still clean these up.

## Known Stubs

The following stubs are **intentional** per the plan spec — downstream plans fill them:

| File | data-testid | Plan that fills it | Reason |
|------|-------------|-------------------|--------|
| `PreferencesVoicePane.tsx` | `preferences-voice-pane-stub` | Plan 03 | VoicePicker + autosave wiring |
| `PreferencesNotificationsPane.tsx` | `preferences-notifications-pane-stub` | Plan 04 | EnableNotificationsModal fold-in |
| `PreferencesAboutYouPane.tsx` | `preferences-about-you-pane-stub` | Plan 05 | GlobalFilesModal fold-in |

These stubs do NOT block the plan goal: modal shell + General pane + sidebar live-sync are all
fully functional. The stubs exist as typed scaffolding so Plans 03/04/05 can fill their bodies
without touching the modal shell or PrettyConversationsPanel.

## Deferred Items

| Item | Owner | Notes |
|------|-------|-------|
| Globe button removal | Plan 05 | `data-testid=pv-footer-global-files-button` preserved |
| Enable notifications kebab item removal | Plan 04 | Kebab item `"Enable notifications…"` preserved |
| reopenTabsOnLogin cleanup in AppShell.tsx | Plan 06 | Lines 362, 1589, 1631 |
| Voice pane body | Plan 03 | VoicePicker + saveUserPreferences({ fallbackVoice }) |
| Notifications pane body | Plan 04 | EnableNotificationsModal interior + gesture-gate test |
| About you pane body | Plan 05 | GlobalFilesModal interior + MDXEditor |

## Deviations from Plan

### Minor — NAV_SECTIONS template literal (pattern, not behavioral)

**Found during:** Task 1
**Issue:** Plan acceptance criterion `grep -c 'data-testid="preferences-nav-'` expects 4 (one per nav item). Implementation uses `NAV_SECTIONS.map()` with a template literal `data-testid={\`preferences-nav-${value}\`}`, which generates all 4 testids at runtime but only produces 1 grep line.
**Why:** Array.map is idiomatic React; duplicating 4 static identical-structure buttons is redundant. The tests verify all 4 testids work correctly (nav-general, nav-voice, nav-notifications, nav-about-you).
**Fix:** None needed — behavior is correct. Tests pass.

### Minor — enable-notifications grep criterion mismatch

**Found during:** Task 3 verification
**Issue:** Plan acceptance criterion `grep -c "enable-notifications"` expects ≥1 (kebab item not removed). The actual code uses `"Enable notifications…"` (capitalized, spaces, with ellipsis) not the hyphenated form.
**Why:** This is a pre-existing condition — the text was always `"Enable notifications…"` in the kebab array. The item IS present (line 3501) and was NOT removed.
**Fix:** None needed — the kebab item is correctly preserved.

### Minor — meUserId added (not in original plan)

**Found during:** Task 3 (Rule 2 — missing critical functionality)
**Issue:** PreferencesModal requires `userId` for the avatar PUT/DELETE endpoint. The plan mentioned threading userId but didn't explicitly add a `meUserId` state atom — it only mentioned `meAvatarPath`. Without `meUserId`, the avatar upload endpoint couldn't be called.
**Fix:** Added `meUserId` state atom alongside `meAvatarPath` in AppShell; populated from `getUserInfo().userId`; threaded as `userId` prop to PrettyConversationsPanel and into PreferencesModal.
**Files modified:** `src/ui/AppShell.tsx`

## Threat Surface Scan

No new network endpoints introduced. The avatar upload/remove helpers call existing Phase-85 backend endpoints (PUT /users/:id/avatar, DELETE /users/:id/avatar) already in the threat register (T-137-05, T-137-06, T-137-07, T-137-08, T-137-SC). No new surface.

## Self-Check: PASSED

Files exist:
- `src/ui/features/pretty-view/PreferencesModal.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesGeneralPane.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesVoicePane.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesModal.test.tsx` — FOUND
- `src/ui/features/pretty-view/PreferencesGeneralPane.test.tsx` — FOUND
- `src/ui/api/user-preferences-api.ts` — FOUND (contains uploadUserAvatar, removeUserAvatar)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND (contains PreferencesModal mount)
- `src/ui/AppShell.tsx` — FOUND (contains meAvatarPath, meUserId)

Commits exist:
- `e375c818` — Task 1: PreferencesModal shell + stub panes + avatar API helpers
- `979b35b8` — Task 2: full PreferencesGeneralPane + test suite
- `ec2fd0ae` — Task 3: sidebar gear button + avatar live-sync + AppShell threading
