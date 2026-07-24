---
phase: 02-toggle-compose-and-native-web-ergonomics
plan: "03"
subsystem: settings-ui
tags: [settings, i18n, keyboard-chord, pretty-view]
dependency_graph:
  requires:
    - 02-01  # chord hook use-keyboard-toggle-pretty-mode.ts
    - 02-02  # ComposeBox + PrettyView integration
  provides:
    - runtime toggle for Ctrl+Shift+O chord in User Profile settings
    - i18n keys keyboardTogglePrettyMode / keyboardTogglePrettyModeDesc
  affects:
    - src/ui/sidebar/UserProfilePanel.tsx
    - src/ui/locales/en.json
tech_stack:
  added: []
  patterns:
    - localStorage-backed FakeSwitch state pattern (matches patches #31/#37/#39)
    - window.dispatchEvent for cross-component hook sync
key_files:
  modified:
    - src/ui/sidebar/UserProfilePanel.tsx
    - src/ui/locales/en.json
decisions:
  - "Default keyboardTogglePrettyModeEnabled=true (matches three sibling chord toggles)"
  - "SettingRow placed immediately after keyboardMessageQueue, before reopenTabsOnLogin — maintains chord-toggle cluster convention"
  - "Event name keyboardTogglePrettyModeEnabledChanged matches the hook's window.addEventListener in use-keyboard-toggle-pretty-mode.ts (Waves 1+2)"
metrics:
  duration: "~5 minutes"
  completed: "2026-07-17"
  tasks_completed: 2
  files_changed: 2
---

# Phase 02 Plan 03: Settings Toggle + i18n (Code Only) Summary

> **IMPORTANT:** Task 3 (deploy checkpoint) NOT executed by this agent; handled inline by orchestrator per fleet rule "GSD is CODE-ONLY."

One-liner: Fourth keyboard-chord SettingRow in UserProfilePanel (FakeSwitch + localStorage + dispatchEvent) wiring the Ctrl+Shift+O pretty-mode toggle chord, plus matching en.json i18n key pair.

## What Was Built

### Task 1 — UserProfilePanel SettingRow

Added two localized edits to `src/ui/sidebar/UserProfilePanel.tsx`:

1. **State initializer** (after the `keyboardMessageQueueEnabled` block, line ~506):
   ```tsx
   const [keyboardTogglePrettyModeEnabled, setKeyboardTogglePrettyModeEnabled] =
     useState(() => {
       const v = localStorage.getItem("keyboardTogglePrettyModeEnabled");
       return v !== null ? v === "true" : true;
     });
   ```
   Defaults `true` when localStorage key is absent — matches all three sibling chord toggles.

2. **SettingRow** (immediately after `keyboardMessageQueue` SettingRow, before `reopenTabsOnLogin`):
   - label: `t("newUi.sidebar.userProfile.keyboardTogglePrettyMode")`
   - description: `t("newUi.sidebar.userProfile.keyboardTogglePrettyModeDesc")`
   - FakeSwitch onChange: `localStorage.setItem("keyboardTogglePrettyModeEnabled", ...)` + `window.dispatchEvent(new Event("keyboardTogglePrettyModeEnabledChanged"))`

   Shape is byte-for-byte parallel to the three sibling SettingRows (patches #31, #37, #39).

**Commit:** `d4f22a2` — `feat(pretty-view): settings toggle for Ctrl+Shift+O chord`

### Task 2 — en.json i18n Keys

Added two JSON keys under `newUi.sidebar.userProfile` in `src/ui/locales/en.json`, immediately after `keyboardMessageQueueDesc`:

```json
"keyboardTogglePrettyMode": "Pretty Mode Toggle Shortcut",
"keyboardTogglePrettyModeDesc": "Ctrl+Shift+O to flip between tmux and pretty modes",
```

File remains valid JSON (verified with `python3 -c "import json; json.load(...)"` → OK).

**Commit:** `c5c96ad` — `feat(pretty-view): i18n keys for pretty mode toggle setting`

## Deviations from Plan

None — plan executed exactly as written. The two edits in each file were made at the exact lines specified.

## Known Stubs

None. These are pure wiring additions with no placeholder values.

## Self-Check

- `src/ui/sidebar/UserProfilePanel.tsx`: 4+ grep hits for `keyboardTogglePrettyMode` (useState init, localStorage.setItem, i18n keys x2, dispatchEvent) — FOUND
- `src/ui/locales/en.json`: 2 grep hits for `keyboardTogglePrettyMode` — FOUND
- Commit `d4f22a2`: exists on `feat/tab-title-from-tmux` — VERIFIED
- Commit `c5c96ad`: exists on `feat/tab-title-from-tmux` — VERIFIED
- `git diff --stat feat/tab-title-from-tmux~2 -- ':!.planning'` shows only 2 files changed — VERIFIED
- TypeScript: `npx tsc --noEmit` | grep for UserProfilePanel errors → zero errors — PASSED

## Self-Check: PASSED

## Task 3 Status

Task 3 (deploy checkpoint) deliberately not executed by this agent. Scope = code only per orchestrator instruction: "GSD is CODE-ONLY." The deploy sequence (build-skynet.sh, docker compose up, deadman rollback arm, UAT-1 through UAT-9) is operational work for Tina/Ashley to run directly.
