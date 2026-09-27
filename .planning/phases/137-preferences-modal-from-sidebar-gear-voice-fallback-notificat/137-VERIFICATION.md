---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
verified: 2026-09-27T00:00:00Z
status: passed
score: 32/32
overrides_applied: 0
---

# Phase 137: Preferences Modal Verification Report

**Phase Goal:** New user-scope preferences home replacing the decorative gear placeholder in the sidebar footer with a real button that opens a left-nav modal with 4 categories (General/Voice/Notifications/About-you). Fold in notifications + about-you (rebranded from global-files); add avatar upload UI with sidebar footer mirror; retire dead reopenTabsOnLogin preference + Globe button entry point.
**Verified:** 2026-09-27
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Gear button opens preferences modal (D-08) | VERIFIED | `pv-footer-preferences-button` `<button>` with `onClick={() => setPreferencesModalOpen(true)}` at PrettyConversationsPanel.tsx:3133; `preferencesModalOpen` state at line 924 |
| 2 | Modal has left-nav with 4 items: General, Voice, Notifications, About you (D-02) | VERIFIED | NAV_SECTIONS const at PreferencesModal.tsx:39-42; dynamic `data-testid={preferences-nav-${value}}` at line 163; 4 section dispatches at lines 185-204 |
| 3 | Escape and X close; backdrop-click does NOT close (D-04) | VERIFIED | `onInteractOutside={(e) => e.preventDefault()}` at PreferencesModal.tsx:94; glass X close button present |
| 4 | Default tab is General; resets on close/reopen (D-05) | VERIFIED | `useState<SectionValue>("general")` at PreferencesModal.tsx:72; `useEffect(() => { if (!open) setActiveSection("general"); }, [open])` at line 77 |
| 5 | Modal size ~760x600 (D-03) | VERIFIED | `md:max-w-[760px] md:max-h-[600px]` at PreferencesModal.tsx:100 |
| 6 | General pane: avatar upload preview, choose, remove (D-10, D-11) | VERIFIED | `URL.createObjectURL` + `URL.revokeObjectURL` in PreferencesGeneralPane.tsx; `uploadUserAvatar` + `removeUserAvatar` calls; `onAvatarChanged` callback threaded out |
| 7 | Upload failure reverts preview + inline error, no toast (D-13) | VERIFIED | Error revert in onFileChosen catch; `grep -c 'toast\|Toast' PreferencesGeneralPane.tsx` returns 0 |
| 8 | Sidebar footer conditionally renders `<img>` for avatar vs initials span (D-12, D-30) | VERIFIED | Conditional render at PrettyConversationsPanel.tsx:3098-3108; `data-testid="pv-footer-avatar-image"` and `data-testid="pv-footer-initials"` on separate branches |
| 9 | meAvatarPath state atom in AppShell; threaded to PrettyConversationsPanel (D-30) | VERIFIED | `const [meAvatarPath, setMeAvatarPath] = useState<string | null>(null)` at AppShell.tsx:450; `avatarPath={meAvatarPath}` prop binding at line 3161 |
| 10 | Voice pane preloaded with current fallbackVoice; autosave on change; no debounce, no toast (D-15, D-17) | VERIFIED | `<VoicePicker>` at PreferencesVoicePane.tsx:74; `saveUserPreferences` called directly in onChange handler; grep for debounce/setTimeout/useDeferredValue returns 0 |
| 11 | Voice pane header wording verbatim: "The voice your agents use to speak." (D-15 context) | VERIFIED | PreferencesVoicePane.tsx:71 + ariaLabel at line 81 |
| 12 | Voice pane error revert on PUT failure (D-13 pattern) | VERIFIED | prev value captured; revert in catch block; `data-testid="preferences-voice-error"` present |
| 13 | Frontend voice resolution: identityVoice ?? userPrefs.fallbackVoice ?? null (D-16) | VERIFIED | `identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}` at PrettyView.tsx:4280 |
| 14 | ChatMessage.tsx untouched (D-16) | VERIFIED | `git log --oneline ChatMessage.tsx` shows no Phase 137 commits (newest is Phase 122 era); no `fallbackVoice` reference in ChatMessage.tsx |
| 15 | userPrefs threaded from AppShell to PrettyView (D-16 prerequisite) | VERIFIED | `// Phase 137 Plan 03 (D-16)` comment at AppShell.tsx:4259; `userPrefs` in the pass-through props at line 4262 |
| 16 | D-19 LOAD-BEARING: Notification.requestPermission() fires synchronously inside onClick — no await boundary before it | VERIFIED | PreferencesNotificationsPane.tsx:78-84: onClick is `useCallback(() => {`, not async; `const permPromise = Notification.requestPermission()` at line 84 is the first async op; grep for `async.*onClick` returns 0 |
| 17 | Notifications pane: unsupported browser shows fallback message (D-20) | VERIFIED | `pushNotificationsSupported()` check at pane top; `data-testid="preferences-notifications-unsupported"` renders when false |
| 18 | pushNotificationsSupported moved to push-support.ts (D-18/RESEARCH Q2) | VERIFIED | `src/ui/features/notifications/push-support.ts` exists; `export function pushNotificationsSupported()` at line 11 |
| 19 | EnableNotificationsModal fully retired (D-21) | VERIFIED | File deleted; `grep -rn "EnableNotificationsModal" src/` returns 0 matches |
| 20 | Kebab "Enable notifications…" entry removed (D-21) | VERIFIED | `grep -n 'enableNotificationsModalOpen\|Enable notifications' PrettyConversationsPanel.tsx` returns 0 matches |
| 21 | About-you pane uses MarkdownEditor, not raw textarea (D-24) | VERIFIED | `<MarkdownEditor` at PreferencesAboutYouPane.tsx:348; `grep -c '<textarea'` returns 0 |
| 22 | About-you blurb verbatim: "Tell your agents anything you want them to know about you — how you work, your preferences, anything." (D-22) | VERIFIED | PreferencesAboutYouPane.tsx:248 |
| 23 | About-you multi-host picker renders for 2+ hosts; hidden for single-host (D-27) | VERIFIED | `data-testid="preferences-about-you-host-picker"` at line 253; wrapped in `{flatHosts.length > 1 && ...}` conditional |
| 24 | About-you first tab labeled "About you" for IMPLICIT_GLOBAL_FILE path (D-28) | VERIFIED | `if (isFirst && file.path === IMPLICIT_ABOUT_YOU_PATH) return "About you"` at PreferencesAboutYouPane.tsx:234 |
| 25 | About-you explicit Save button; mtime-optimistic-concurrency 409 conflict UX preserved (D-25, D-26) | VERIFIED | `handleSave` useCallback at line 181; `window.confirm` at line 204; Save button at line 340 |
| 26 | Globe button (pv-footer-global-files-button) removed from sidebar footer (D-29) | VERIFIED | `grep -rn 'pv-footer-global-files-button' src/` returns only comments (retirement breadcrumbs and tests asserting `toBeNull()`) |
| 27 | GlobalFilesModal fully retired (D-29) | VERIFIED | File deleted; surviving references in src/ are all narrative comments citing GlobalFilesModal as the chrome ancestor (no live imports of it) |
| 28 | fallbackVoice column added to user_preferences schema; reopenTabsOnLogin column dropped (D-14, D-31, D-32) | VERIFIED | `fallbackVoice: text("fallback_voice")` at schema.ts:841; `reopenTabsOnLogin: DELETED` comment; `runReopenTabsColumnDrop` at db/index.ts:979 + called at line 1135; `addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")` at line 1182 |
| 29 | Backend GET /user-preferences returns fallbackVoice; no reopenTabsOnLogin (D-14, D-31) | VERIFIED | `fallbackVoice: row?.fallbackVoice ?? null` at user-preferences.ts:70; all reopenTabsOnLogin references are deletion comments |
| 30 | Frontend UserPreferences type has fallbackVoice; no reopenTabsOnLogin (D-31) | VERIFIED | `fallbackVoice?: string | null` at open-tabs-api.ts:100; `reopenTabsOnLogin: DELETED per Phase 137` comment |
| 31 | AppShell no longer seeds or reads reopenTabsOnLogin (D-31) | VERIFIED | `grep -rn 'reopenTabsOnLogin' AppShell.tsx` returns 0 matches; confirmed by AppShell.app-tab-restore-fix.test.tsx regression test at line 68 |
| 32 | Playwright smoke spec covers open/nav/close (D-06 Plan 06 success criterion) | VERIFIED | `tests/e2e/preferences-modal.spec.ts` — 3 test() blocks, 4 nav item clicks, Escape close; note: located in `tests/e2e/` (correct location for this repo) rather than `tests/playwright/` as specified in Plan 06 |

**Score:** 32/32 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/features/pretty-view/PreferencesModal.tsx` | Modal chrome + left-nav shell | VERIFIED | 214 lines; `data-testid="preferences-modal"`; 4 NAV_SECTIONS; `onInteractOutside` |
| `src/ui/features/pretty-view/PreferencesGeneralPane.tsx` | Avatar upload/remove/preview | VERIFIED | URL.createObjectURL + revokeObjectURL; uploadUserAvatar + removeUserAvatar; onAvatarChanged |
| `src/ui/features/pretty-view/PreferencesVoicePane.tsx` | Voice fallback picker + autosave | VERIFIED | VoicePicker mounted; saveUserPreferences on change; no debounce |
| `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` | Folded-in notifications enable flow | VERIFIED | synchronous onClick; pushNotificationsSupported; LOAD-BEARING comment present |
| `src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` | About-you editor with host picker + tab strip | VERIFIED | 400+ lines; MarkdownEditor; writeGlobalFile; window.confirm 409 UX; blurb verbatim |
| `src/ui/features/notifications/push-support.ts` | pushNotificationsSupported() export | VERIFIED | Exists; `export function pushNotificationsSupported()` at line 11 |
| `src/ui/api/user-preferences-api.ts` | uploadUserAvatar + removeUserAvatar | VERIFIED | Both exported; FormData multipart PUT; authApi |
| `src/backend/database/db/schema.ts` | fallbackVoice column; no reopenTabsOnLogin | VERIFIED | `fallbackVoice: text("fallback_voice")` at line 841 |
| `src/backend/database/db/index.ts` | runReopenTabsColumnDrop + addColumnIfNotExists sweep | VERIFIED | Function at line 979; migrateSchema call at 1135; addColumnIfNotExists at 1182 |
| `src/backend/database/routes/user-preferences.ts` | fallbackVoice GET/PUT; no reopenTabsOnLogin | VERIFIED | 5+ fallbackVoice sites; all reopenTabsOnLogin are deletion comments |
| `src/backend/database/routes/users.ts` | /users/me surfaces avatarPath | VERIFIED | `avatarPath: user[0].avatarPath ?? null` at line 1949 |
| `src/ui/main-axios.ts` | UserInfo.avatarPath | VERIFIED | `avatarPath?: string | null` at line 141 |
| `src/ui/api/open-tabs-api.ts` | UserPreferences.fallbackVoice; no reopenTabsOnLogin | VERIFIED | fallbackVoice at line 100; reopenTabsOnLogin is a deletion comment |
| `src/ui/features/pretty-view/PrettyView.tsx` | Voice resolution chain with fallbackVoice | VERIFIED | `pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null` at line 4280 |
| `tests/e2e/preferences-modal.spec.ts` | Playwright smoke: open/nav/close | VERIFIED | 97 lines; 3 test() blocks; all 4 nav items; Escape close |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| PrettyConversationsPanel.tsx | PreferencesModal.tsx | `<PreferencesModal open={preferencesModalOpen}` | VERIFIED | Mount at line 3307 |
| AppShell.tsx | PrettyConversationsPanel.tsx | `avatarPath={meAvatarPath}` + `onAvatarChanged={setMeAvatarPath}` | VERIFIED | Props at line 3161 |
| PreferencesGeneralPane.tsx | user-preferences-api.ts | `uploadUserAvatar` / `removeUserAvatar` | VERIFIED | Both imported and called |
| PrettyConversationsPanel.tsx | pv-footer-avatar-image | conditional `<img>` with cache-busting `?f=` param | VERIFIED | Lines 3098-3108 |
| PreferencesVoicePane.tsx | saveUserPreferences (open-tabs-api.ts) | onChange handler calls `saveUserPreferences({ fallbackVoice: ... })` | VERIFIED | Line 54 |
| PrettyView.tsx → ChatMessage.tsx | userPrefs.fallbackVoice | `identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}` | VERIFIED | PrettyView.tsx:4280 |
| PreferencesNotificationsPane.tsx | Notification.requestPermission() | synchronous onClick — first async op | VERIFIED | Line 84; onClick not async; no await before it |
| PrettyConversationsPanel.tsx | EnableNotificationsModal (retired) | deletion: zero remaining references | VERIFIED | `grep EnableNotificationsModal src/` returns 0 |
| PrettyConversationsPanel.tsx | GlobalFilesModal (retired) | deletion: zero live imports remaining | VERIFIED | No import of GlobalFilesModal in any live file |
| PreferencesAboutYouPane.tsx | MarkdownEditor.tsx | `<MarkdownEditor` mount | VERIFIED | Line 348; no direct MDXEditor mount; no textarea |
| AppShell.tsx | PrettyView.tsx | `userPrefs` prop threaded | VERIFIED | Line 4262 (Phase 137 Plan 03 comment) |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| D-19: no `async` before Notification.requestPermission | `grep 'async.*onClick' PreferencesNotificationsPane.tsx` | 0 matches | PASS |
| D-24: no `<textarea>` in AboutYouPane | `grep -c '<textarea' PreferencesAboutYouPane.tsx` | 0 | PASS |
| D-16: ChatMessage.tsx unmodified | `git log --oneline ChatMessage.tsx` | No Phase 137 commits (newest: Phase 122 era) | PASS |
| D-29: Globe button removed | `grep 'pv-footer-global-files-button' src/` | Only comments and negative test assertions | PASS |
| D-31: reopenTabsOnLogin gone from live code | `grep 'reopenTabsOnLogin' src/ui/AppShell.tsx` + `tab-url.ts` | 0 matches each | PASS |
| D-08: real gear button | `grep 'pv-footer-preferences-button' PrettyConversationsPanel.tsx` | `<button` at line 3133 with `onClick` | PASS |
| GlobalFilesModal retired | `ls src/ui/features/pretty-view/GlobalFilesModal.tsx` | File deleted | PASS |
| EnableNotificationsModal retired | `ls src/ui/features/notifications/EnableNotificationsModal.tsx` | File deleted | PASS |
| D-21: kebab "Enable notifications" removed | `grep 'enableNotificationsModalOpen' PrettyConversationsPanel.tsx` | 0 matches | PASS |

---

## Anti-Patterns Found

No blockers. One informational note:

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/ui/locales/en.json` + 25 translated locale files | `reopenTabsOnLogin` translation keys still present | INFO | Dead i18n data — no UI code references these keys (confirmed: `grep '"reopenTabsOnLogin"' src/ui/ --include="*.tsx" --include="*.ts" \| grep -v locales` returns 0). The translation strings are archaeology. Not a blocker; cleanup deferred to a later locale audit. |

---

## Playwright Spec Path Deviation (Non-Blocking)

Plan 06 specified `tests/playwright/preferences-modal.spec.ts`. The file was created at `tests/e2e/preferences-modal.spec.ts`, which is where all other Playwright e2e specs in this codebase live (the `tests/playwright/` directory does not exist). The spec is substantive: 97 lines, 3 test blocks covering open/nav all 4 panes/close-via-Escape, 4 nav item selectors. Path deviation is acceptable — the correct location was used.

---

## Human Verification Required

| # | Test | Expected | Why Human |
|---|------|----------|-----------|
| 1 | Click gear button in sidebar, navigate all 4 tabs, upload an avatar, verify sidebar footer updates to the photo | Modal opens on General; tabs switch content; avatar preview shown in pane and in sidebar footer circle without page reload | Live browser interaction; avatar upload requires a real image file and backend |
| 2 | Go to Voice tab, change picker, verify autosave feedback | No explicit "Saved" toast; picker shows selected voice on next modal open | Autosave timing and optimistic state are hard to assert in unit tests |
| 3 | Go to Notifications tab; if supported browser, click Enable | Permission dialog appears on first click; no prior `await` delay before dialog | iOS PWA gesture-gate is a physical device check |
| 4 | Go to About you tab; edit content, click Save; re-open modal and verify content persisted | Editor shows updated content; no data loss on re-open | Requires live SFTP write to backend |

---

## Gaps Summary

No gaps. All 32 D-decisions from CONTEXT.md are implemented. All must-have truths from Plans 01–06 are verified in the codebase.

The phase goal is fully achieved:
- Gear placeholder replaced with real button wired to a working 4-pane modal
- General pane: avatar upload with sidebar footer live-sync
- Voice pane: per-user fallback voice picker with frontend resolution chain
- Notifications pane: folded-in EnableNotificationsModal with D-19 gesture-gate preserved
- About-you pane: rebranded GlobalFilesModal interior with MarkdownEditor
- Globe button retired; EnableNotificationsModal retired; GlobalFilesModal retired
- reopenTabsOnLogin fully scrubbed from live code (schema + routes + frontend types + AppShell)

---

_Verified: 2026-09-27_
_Verifier: Claude (gsd-verifier)_
