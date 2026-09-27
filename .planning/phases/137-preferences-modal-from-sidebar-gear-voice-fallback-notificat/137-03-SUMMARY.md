---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
plan: "03"
subsystem: ui-voice-pane-speak-flow
tags:
  - voice-fallback
  - autosave-on-change
  - speak-flow
  - user-preferences
  - tdd
dependency_graph:
  requires:
    - 137-01 (UserPreferences.fallbackVoice type, backend PUT /user-preferences)
    - 137-02 (PreferencesVoicePane stub, PreferencesModal shell, userPrefs threading to PrettyConversationsPanel)
  provides:
    - PreferencesVoicePane fully functional (VoicePicker + autosave + error revert)
    - PrettyView.tsx speak-flow extended with userPrefs.fallbackVoice chain
    - userPrefs threaded AppShell → renderTabContent → RendererDeps → TerminalOrIdentitySessionPane → IdentitySessionPane → PrettyView
    - Voice-resolution regression tests (3 branches)
  affects:
    - src/ui/features/pretty-view/PreferencesVoicePane.tsx
    - src/ui/features/pretty-view/PreferencesVoicePane.test.tsx
    - src/ui/features/pretty-view/voice-resolution.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PreferencesModal.test.tsx
    - src/ui/shell/tabUtils.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/AppShell.tsx
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN per plan spec — failing test committed first, impl second
    - Autosave-on-change with optimistic local state + revert from putPinnedIds shape
    - useEffect sync for external userPrefs.fallbackVoice changes
    - Optional prop with default {} for backward-compatible PrettyView threading
    - Prop-threading chain: AppShell positional arg → RendererDeps → TerminalOrIdentitySessionPane → IdentitySessionPane → PrettyView
key_files:
  created:
    - src/ui/features/pretty-view/PreferencesVoicePane.test.tsx
    - src/ui/features/pretty-view/voice-resolution.test.tsx
  modified:
    - src/ui/features/pretty-view/PreferencesVoicePane.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PreferencesModal.test.tsx
    - src/ui/shell/tabUtils.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/AppShell.tsx
decisions:
  - "Added data-testid=preferences-voice-pane to PreferencesVoicePane container so PreferencesModal.test.tsx nav-switch test can assert real pane content (replacing the stub testid)"
  - "PreferencesModal.test.tsx updated with vi.mock for voice-api and open-tabs-api so VoicePicker and autosave work in the modal test environment"
  - "userPrefs threaded as optional positional arg (not JSX prop) through renderTabContent — AppShell grep criterion satisfied by existing PrettyConversationsPanel userPrefs={userPrefs} at line 3316"
  - "tabUtils.tsx and IdentitySessionPane.tsx required additional modification beyond plan's <files> list — necessary to complete the prop-threading chain (Rule 3 auto-fix)"
metrics:
  duration: "960 seconds"
  completed: "2026-09-27"
  tasks_completed: 2
  files_modified: 8
---

# Phase 137 Plan 03: Voice Pane + Speak-Flow Resolution Summary

**One-liner:** VoicePicker-backed PreferencesVoicePane with autosave-on-change and error revert; PrettyView speak-flow extended with `pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null` chain threaded from AppShell.

## Files Touched

| File | Summary |
|------|---------|
| `src/ui/features/pretty-view/PreferencesVoicePane.tsx` | Replaced Plan 02 stub with full implementation: VoicePicker (D-15), autosave on change via `saveUserPreferences({ fallbackVoice })` (D-17), useEffect sync, inline error div on PUT failure (D-13), no debounce, no Save button (D-07), verbatim blurb "The voice your agents use to speak." (CONTEXT.md Specifics), 95 lines |
| `src/ui/features/pretty-view/PreferencesVoicePane.test.tsx` | 6 TDD tests: initial value preselected, null → "(default)" option, onChange fires saveUserPreferences, empty selection saves null, failed save reverts + inline error visible, no debounce (immediate fire) |
| `src/ui/features/pretty-view/voice-resolution.test.tsx` | 3 regression tests for D-16 voice-resolution chain via ChatMessage: Branch 1 (identity voice "Joanna"), Branch 2 (no identity voice, fallback "Ruth"), Branch 3 (both null → undefined → backend DEFAULT_VOICE) |
| `src/ui/features/pretty-view/PrettyView.tsx` | Added `UserPreferences` import; added `userPrefs?: UserPreferences` to `PrettyViewProps` (optional, default `{}`); updated `identityVoice` at L4280: `pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null` |
| `src/ui/features/pretty-view/PreferencesModal.test.tsx` | Added `vi.mock("@/api/voice-api")` and `vi.mock("@/api/open-tabs-api")` for VoicePicker + autosave in test env; updated nav-switch assertion from `preferences-voice-pane-stub` to `preferences-voice-pane` (real pane now renders) |
| `src/ui/shell/tabUtils.tsx` | Added `UserPreferences` import; added `userPrefs?: UserPreferences` to `RendererDeps` and `TerminalOrIdentitySessionPane` props; threaded to `IdentitySessionPane` and via `deps.userPrefs` in `renderTerminalTab`; added `userPrefs?` param to `renderTabContent` signature |
| `src/ui/shell/IdentitySessionPane.tsx` | Added `UserPreferences` import; added `userPrefs?: UserPreferences` to `IdentitySessionPaneProps`; destructured and passed to `<PrettyView userPrefs={userPrefs}>` mount |
| `src/ui/AppShell.tsx` | Added `userPrefs` as 10th positional arg to `renderTabContent(...)` call at L4397-4410 |

## Test Results

**Task 1 — PreferencesVoicePane.test.tsx:**
```
6/6 tests passed
  - case 1: renders with initial fallbackVoice preselected
  - case 2: null → "(default)" option preselected
  - case 3: onChange fires saveUserPreferences with new voice
  - case 4: empty selection saves null (not empty string)
  - case 5: failed save reverts local state + surfaces inline error
  - case 6: no debounce — PUT fires within same click task-tick
```

**Task 2 — voice-resolution.test.tsx:**
```
3/3 regression tests passed
  - Branch 1: identity voice "Joanna" → postSpeakStream receives "Joanna"
  - Branch 2: identity null, fallback "Ruth" → postSpeakStream receives "Ruth"
  - Branch 3: both null → postSpeakStream receives undefined (backend DEFAULT_VOICE)
```

**Full pretty-view suite:** 102 test files, 1200 tests, all passed.
**Full shell suite:** 8 test files, 148 tests, all passed.
**TypeScript:** `npm run type-check` exits 0, no errors.

## PrettyView Edit Summary

- Lines changed: +12 (import comment + type + destructure/default + one-line chain update)
- Identityvoice assignment sites updated: 1 (only one site exists in PrettyView)
- UserPreferences occurrences: 3 (prop type, destructure with default, usage at chain site)

## AppShell Prop Thread Summary

`userPrefs` threaded through the full chain:
1. `AppShell.tsx` L4409: `renderTabContent(..., userPrefs)` (10th arg)
2. `tabUtils.tsx` `RendererDeps.userPrefs?` → `renderTerminalTab` → `TerminalOrIdentitySessionPane userPrefs={deps.userPrefs}`
3. `IdentitySessionPane.tsx` destructures `userPrefs` → passes `userPrefs={userPrefs}` to `<PrettyView>`
4. `PrettyView.tsx` destructures `userPrefs = {}` → uses `userPrefs.fallbackVoice` at identityVoice chain

## Voice-Resolution Regression Test Outcome

| Branch | Identity Voice | userPrefs.fallbackVoice | identityVoice prop | postSpeakStream arg | Status |
|--------|---------------|------------------------|-------------------|---------------------|--------|
| 1 | "Joanna" | any | "Joanna" | "Joanna" | PASS |
| 2 | null | "Ruth" | "Ruth" | "Ruth" | PASS |
| 3 | null | null | null | undefined | PASS |

## ChatMessage.tsx Untouched

`git diff --stat src/ui/features/pretty-view/ChatMessage.tsx` returns empty. Resolution happens in PrettyView (D-16).

## Deviations from Plan

### Minor — additional files beyond plan's <files> list (Rule 3 auto-fix)

**Found during:** Task 2 implementation
**Issue:** Plan listed only `PrettyView.tsx` and `AppShell.tsx` as files, but PrettyView is not directly mounted in AppShell — it's mounted via `renderTabContent` → `RendererDeps` → `TerminalOrIdentitySessionPane` → `IdentitySessionPane`. Threading `userPrefs` required touching 4 files total.
**Fix:** Added `userPrefs` to `RendererDeps` in `tabUtils.tsx`, `IdentitySessionPaneProps` in `IdentitySessionPane.tsx`, and the `renderTabContent` signature. All changes are minimal (import + optional prop type + destructure + threading).
**Files modified:** `tabUtils.tsx`, `IdentitySessionPane.tsx` (in addition to plan-listed files)

### Minor — PreferencesModal.test.tsx required updates (Rule 1 auto-fix)

**Found during:** Task 1 verification
**Issue:** `PreferencesModal.test.tsx` checked for `preferences-voice-pane-stub` (the Plan 02 stub testid). After replacing the stub with the real VoicePane, 2 tests failed. Also, VoicePicker imports `postSpeak` from `voice-api` which was not mocked in the modal test.
**Fix:** Added `data-testid="preferences-voice-pane"` to the real VoicePane container; updated test assertions to use `preferences-voice-pane`; added `vi.mock` for `voice-api` and `open-tabs-api` in `PreferencesModal.test.tsx`.
**Files modified:** `PreferencesVoicePane.tsx`, `PreferencesModal.test.tsx`

### Minor — saveUserPreferences grep count is 3 not 1

**Found during:** Task 1 acceptance criteria check
**Issue:** `grep -c "saveUserPreferences" PreferencesVoicePane.tsx` returns 3 (comment in file header + import line + call site). Plan spec says 1.
**Assessment:** The spec was written expecting only the call site, not that the import line and file header comment would be counted. Behavior is correct — single call site in handleVoiceChange. The count difference is a plan spec inaccuracy, not a bug.

## Threat Surface Scan

No new network endpoints. `saveUserPreferences` calls the existing PUT /user-preferences endpoint established in Plan 01. The `postSpeakStream` endpoint is unchanged. No new surface.

## Known Stubs

None — PreferencesVoicePane is now fully functional. Plans 04 and 05 still have their stub panes (`preferences-notifications-pane-stub`, `preferences-about-you-pane-stub`) but those are not in scope for this plan.

## Self-Check: PASSED
