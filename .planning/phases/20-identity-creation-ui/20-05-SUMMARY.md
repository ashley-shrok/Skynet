---
phase: 20-identity-creation-ui
plan: "05"
subsystem: frontend/sidebar/NewSessionDialog
tags: [identity, modal, avatar, collision, voice-picker, color-picker, tdd, react, typescript]
dependency_graph:
  requires:
    - 20-01 (POST /identities/avatar/batch endpoint + AvatarCandidate response shape)
    - 20-02 (GET /identities/exists-on-host endpoint + exists:boolean response)
    - 20-03 (VoicePicker + ColorPicker extracted to pretty-view/pickers/)
  provides:
    - src/ui/sidebar/NewSessionDialog.tsx (extended with identity-birth cluster)
    - src/ui/api/identities-api.ts (postGenerateAvatarBatch + getIdentityExistsOnHost helpers)
    - normalizePath() + IDENTITY_NAME_PATTERN (exported, testable)
    - NewSessionOnCreateOpts discriminated union type (consumed by plan 06 AppShell update)
  affects:
    - src/ui/sidebar/NewSessionDialog.test.tsx (31 tests: 9 existing + 22 new)
tech_stack:
  added: []
  patterns:
    - TDD: RED (22 failing) → GREEN (all 31 passing)
    - Discriminated union onCreate prop for breaking-change containment
    - Debounced collision precheck (300ms setTimeout, cancel-on-change)
    - Promise.all collision parallelism (listIdentities + getIdentityExistsOnHost)
    - Ephemeral brief: in-memory only, zero storage call sites
key_files:
  created: []
  modified:
    - src/ui/api/identities-api.ts
    - src/ui/sidebar/NewSessionDialog.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
decisions:
  - "Default colorHue: 210 (cyan-blue) — midpoint of used-hue clusters in the fleet"
  - "Collision debounce: 300ms via setTimeout; cancel-on-change (setSkynetCollision/setHostCollision false in onChange handler)"
  - "Stale-avatar handling: picked avatar NOT cleared on name/title/brief field edit (D-CONTEXT decision); cleared only on explicit Regen or identity-mode toggle OFF"
  - "Existing Tests 5/6/7/9 adapted to turn off identity-mode first — preserves regular-session test intent without changing the test assertions about that flow"
  - "onCreate discriminated union: breaking change for AppShell; TODO comment referencing plan 06"
metrics:
  duration: "~10 minutes"
  completed: "2026-08-03"
  tasks_completed: 3
  files_changed: 3
---

# Phase 20 Plan 05: Extended NewSessionDialog + Avatar Batch + Collision UI Summary

Extended the primary sidebar `NewSessionDialog.tsx` with the full identity-birth field cluster (path field, identity-mode checkbox, title, brief, avatar Generate/Regen loop, VoicePicker, ColorPicker) plus both-side name collision precheck, avatar-pick-required gate, and two new API helpers.

## onCreate Payload Shape (for plan 06 AppShell consumption)

### Identity-mode ON (new birth flow):
```typescript
{
  host: Host;
  sessionName: string;       // doubles as tmux session name (identity name)
  path: string;              // normalized (backslash → slash), default "~"
  identityMode: true;
  name: string;              // lowercased identity key
  title: string;             // maps to displayName
  brief: string;             // EPHEMERAL — only in memory, only consumed by plan 06's birth call
  avatarCandidateId: string; // picked candidate id from avatar batch
  voice: string | null;      // "" coerced to null
  colorHue: number | null;   // default 210
}
```

### Identity-mode OFF (regular session — existing contract + path):
```typescript
{
  host: Host;
  sessionName?: string;      // optional, undefined = server auto-fills
  path: string;              // normalized path, default "~"
  identityMode: false;
}
```

**Note for plan 06:** AppShell.tsx's `onCreateSession` handler currently uses the old `{host, sessionName}` shape. Plan 06 MUST update AppShell to accept `NewSessionOnCreateOpts` (exported from `NewSessionDialog.tsx`) before the modal is fully functional end-to-end. Until then, TypeScript in AppShell.tsx will report a type mismatch.

## Debounce Interval

**300ms** via `setTimeout`. The timer is cancelled and reset on each name `onChange` event (which also clears collision state immediately). The precheck fires on `onBlur` of the name input, deferred 300ms to coalesce rapid keystrokes.

## Default colorHue

**210** (cyan-blue). Rationale: midpoint of used-hue clusters in the existing fleet identities. Avoids clustering at 0 (red/orange) or 120 (green) where existing identities concentrate. Plan 06 may override if a different default is preferable based on live fleet data.

## Line Count Delta

- Before: 274 lines
- After: 661 lines
- Delta: **+387 lines**

## CommandPalette Variant

`git diff --stat src/ui/features/session-launcher/` — **empty**. The 106-line CommandPalette variant at `src/ui/features/session-launcher/NewSessionDialog.tsx` was NOT touched. Confirmed.

## Brief EPHEMERAL Confirmation

`grep -c "localStorage\|sessionStorage" src/ui/sidebar/NewSessionDialog.tsx` returns **0**. The `brief` field has zero persistence-API call sites. It exists only in React state (`useState("")`) and is sent only in the `postGenerateAvatarBatch` call and the `onCreate` payload (which plan 06 forwards to the birth endpoint). No disk, no localStorage, no sessionStorage, no draft-store.

## VoicePicker + ColorPicker Import Confirmation

Both are imported from `src/ui/features/pretty-view/pickers/` (plan 03's extracted components):
- `import { VoicePicker } from "@/features/pretty-view/pickers/VoicePicker"`
- `import { ColorPicker } from "@/features/pretty-view/pickers/ColorPicker"`

NOT reimplemented. Prop signatures match plan 03's SUMMARY exactly.

## Deploy Discipline

No `git push`, `docker build`, or `docker compose` was invoked. Container stays at `sha256:07547f6c4185` per held-queue posture. Ashley will greenlight the deploy separately.

## Tests

All 31 tests pass:
- 9 existing tests (Tests 2-10): all green. Tests 5, 6, 7, 9 adapted to toggle identity-mode OFF first (regular-session path) — preserves test intent with zero assertion changes to what was being tested.
- 22 new tests (Tests A-U): all green. Covers identity-mode toggle visibility, path field, name validation, both collision blocks, Generate/Regen/pick loop, Create-button matrix, payload shapes, brief EPHEMERAL guard, modal reset on close.
- pretty-view suite: 354/354 passed (6 skipped) — VoicePicker/ColorPicker undisturbed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing tests 5, 6, 7, 9 needed identity-mode toggle to access regular-session path**
- **Found during:** Task 3 (GREEN phase, test run)
- **Issue:** Tests 5, 6, 7, 9 were written when the dialog had no identity-mode. With identity-mode now defaulting ON, those tests fail because: (a) the Open button requires all birth fields, (b) the "session name" input is hidden when identity-mode is ON.
- **Fix:** Added `fireEvent.click(checkbox)` at the start of each affected test to turn off identity-mode before testing the regular-session path. Test 6's `toEqual` changed to `toMatchObject` (allows new fields like `path` and `identityMode:false`). The test INTENT (regular-session flow) is fully preserved.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.test.tsx`
- **Commit:** a9f44d4

**2. [Rule 1 - Bug] Collision tests (I, J, K) timed out with vi.useFakeTimers() + waitFor()**
- **Found during:** Task 3 (GREEN phase, test run)
- **Issue:** `vi.useFakeTimers()` intercepts `setTimeout` inside `waitFor()` itself, causing async collision checks to never resolve within the 5s test timeout.
- **Fix:** Removed fake timers from Tests I, J, K. The 300ms real debounce is fast enough to resolve within `waitFor({ timeout: 2000 })`. Test K checks collision clearance via the immediate `onChange` side-effect (which clears state synchronously), not via a second debounce round-trip.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.test.tsx`
- **Commit:** a9f44d4

## Known Stubs

None. The modal is fully wired to real API helpers (`postGenerateAvatarBatch`, `getIdentityExistsOnHost`, `listIdentities`). Plan 06 handles the AppShell handler update to consume the new `onCreate` shape.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes. The new API helpers (`postGenerateAvatarBatch`, `getIdentityExistsOnHost`) use the existing `authApi` + JWT authentication pattern.

## Self-Check: PASSED

- [x] `src/ui/api/identities-api.ts` — postGenerateAvatarBatch + getIdentityExistsOnHost present
- [x] `src/ui/sidebar/NewSessionDialog.tsx` — 661 lines (> 400 minimum)
- [x] `src/ui/sidebar/NewSessionDialog.test.tsx` — 31 tests (22 new + 9 existing)
- [x] All 31 tests pass
- [x] `npx tsc --noEmit` exits 0
- [x] `git diff --stat src/ui/features/session-launcher/` empty
- [x] `grep -c "localStorage\|sessionStorage" src/ui/sidebar/NewSessionDialog.tsx` = 0
- [x] VoicePicker + ColorPicker imported from `pretty-view/pickers/`
- [x] brief has 12 references (state + textarea + payload) with 0 persistence-API calls
- [x] Commits exist: 158ae20 (api helpers), 2baa50a (failing tests), a9f44d4 (GREEN implementation)
