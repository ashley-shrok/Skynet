---
phase: 260806-bz7-clone-modal-auto-route-into-new-session-
plan: 01
type: execute
completed: 2026-08-06
commit: cb3b847
branch: feat/tab-title-from-tmux
files_modified:
  - src/ui/sidebar/NewSessionDialog.tsx
  - src/ui/AppShell.tsx
  - src/ui/sidebar/CloneAgentDialog.tsx
  - src/ui/sidebar/CloneAgentDialog.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
metrics:
  tests_total: 1471
  tests_passed: 1465
  tests_skipped: 6
  test_files: 120
  tsc_exit: 0
  vitest_exit: 0
---

# 260806-bz7 — Clone modal auto-routes into new session (parity with birth)

## One-liner

Widened `NewSessionOnCreateOpts` with a third `identityMode: "existing"` variant; wired CloneAgentDialog to fire the panel's existing `onCreateSession` prop after successful clone (before onClose); AppShell narrows all three variants explicitly and treats "existing" identically to birth for `openTab` (allowCreateTmux false, sessionName from identity).

## What Ashley sees now

Right-click a conversation row → Clone → fill name → click Create → the app auto-opens a new terminal tab attached to the cloned identity's tmux session and focuses it. Same UX as identity-birth's focus-follow. No more hunting for the new row in the sidebar.

## Task-by-task

### Task 1: Widen `NewSessionOnCreateOpts` + AppShell narrowing

- Added a third arm to the discriminated union in `NewSessionDialog.tsx`:
  ```ts
  { host: Host; sessionName: string; path: string; identityMode: "existing"; identityName: string; identityId: string }
  ```
  No birth-only fields (no brief / avatarCandidateId / colorHue / voice / title) — identity is already born server-side.
- Rewrote AppShell's `onCreateSession` truthy check on `opts.identityMode` into an explicit-discriminant `if / else if / else` cascade. `"existing"` uses `opts.identityName` for sessionName (Nelly mechanism — identity key doubles as tmux session name). `allowCreateTmux` is `opts.identityMode === false` (both `true` and `"existing"` mean "backend already created the tmux session, just attach").

### Task 2: `CloneAgentDialog` `onCreateSession` prop

- Added optional `sourceHost?: Host | null` + `onCreateSession?: (opts: NewSessionOnCreateOpts) => void` props to `CloneAgentDialogProps`.
- On successful clone: `onCloned` fires first (existing behavior; triggers identities-store + fleetSessions refresh), then `onCreateSession` fires inside try/catch (so a routing failure never blocks the modal close), then `onClose`. Path is normalized once (`path.trim()`) and reused for both the `cloneIdentity` call and the `onCreateSession` payload so they can't disagree.
- Tests: extended Test 21 to assert `onCreateSession` fires exactly once with the derived `{host, sessionName, path, identityMode: "existing", identityName, identityId}` shape BEFORE `onClose`. Added Test 21c (undefined `onCreateSession` → existing `onCloned → onClose` path unchanged) and Test 21d (throwing `onCreateSession` → `onClose` still fires — try/catch swallow).

### Task 3: Thread `onCreateSession` + `sourceHost` through the panel

- Extended `cloneDialogState` with `sourceHost: Host` (captured off `row.host` in `handleRowClone` after the existing non-null guard).
- CloneAgentDialog render site now forwards `sourceHost={cloneDialogState?.sourceHost ?? null}` and `onCreateSession={onCreateSession}` (the panel's own existing prop, passed by reference).
- The existing `onCloned` refresh callback stays wired verbatim — its order (before `onCreateSession`) is deliberate: refresh-before-route means the new tab can resolve the fresh identity when it renders (same reasoning as patch #319 for birth).
- Tests: added identities-api + VoicePicker mocks to `PrettyConversationsPanel.clone-dialog.test.tsx` (mirroring `CloneAgentDialog.test.tsx`'s pattern). Test 16 stays byte-identical as the wiring-existence check. New Test 16b: full-panel integration — right-click → Clone → fill name → Create → assert the panel's `onCreateSession` mock was called with the expected opts shape (referentially equal `host: stubHost`).

### Task 4: Full-suite gate

- `npx tsc --noEmit` → exit 0 (no new type errors).
- `npx vitest run` → exit 0. 1465 passed, 6 skipped, 120 files.
- No backend files touched, so `npm run build:backend` not required (plan explicitly excluded backend build).

## Deviations from plan

**None.** Plan executed exactly as written — chose option A (`sourceHost` prop) as the plan pre-decided, wired try/catch swallow around `onCreateSession` per the plan's best-effort spec, kept `onCloned → onCreateSession → onClose` order per the plan's rationale.

## Grep-sanity

```
$ grep -n "opts.identityMode\|!opts.identityMode" src/ui/AppShell.tsx
1452:            if (opts.identityMode === false) {
1454:            } else if (opts.identityMode === true) {
1470:              allowCreateTmux: opts.identityMode === false,
```

All three reads are explicit-discriminant. Zero bare truthy checks on `opts.identityMode` remain.

## Commit

```
cb3b847  feat(clone-modal): auto-route into new session after clone (parity with birth) [260806-bz7]
```

Six files, 328 insertions, 13 deletions. Committed on `feat/tab-title-from-tmux`. No push, no docker, no backend build.

## Self-Check: PASSED

- `src/ui/sidebar/NewSessionDialog.tsx` — FOUND
- `src/ui/AppShell.tsx` — FOUND
- `src/ui/sidebar/CloneAgentDialog.tsx` — FOUND
- `src/ui/sidebar/CloneAgentDialog.test.tsx` — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — FOUND
- commit `cb3b847` — FOUND on `feat/tab-title-from-tmux`
