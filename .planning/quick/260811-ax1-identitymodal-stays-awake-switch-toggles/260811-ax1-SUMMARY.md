---
phase: quick-260811-ax1
plan: "01"
subsystem: identity-modal
tags: [switch, dormancy, identity, backend-route, radix]
dependency_graph:
  requires: []
  provides: [identity-no-dormancy-route, stays-awake-switch]
  affects: [IdentityModal, identities-api, database-routes]
tech_stack:
  added: []
  patterns: [express-router, radix-switch, optimistic-ui, toast-sonner]
key_files:
  created:
    - src/backend/database/routes/identity-no-dormancy.ts
    - src/backend/database/routes/identity-no-dormancy.test.ts
    - src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx
  modified:
    - src/backend/database/database.ts
    - src/ui/api/identities-api.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - "Use fs namespace import (not named import) in identity-no-dormancy.ts so vi.mock('fs/promises') patches all methods correctly in tests"
  - "IDENTITY_KEY_RE imported from identity-artifact-reader.ts, not copied — single-sourced gate per plan requirement"
  - "String(req.params.key ?? '') cast needed because Express types params as string | string[]"
  - "Test assertions for SSH commands use toContain with exact string rather than regex to avoid && escaping issues"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-11"
  tasks_completed: 3
  files_changed: 6
---

# Quick 260811-ax1: IdentityModal 'Stays Awake' Radix Switch Summary

**One-liner:** GET/PUT `/identities/:key/no-dormancy` route wired to a Radix Switch in the IdentityModal DialogHeader, toggling `~/.claude/identities/<key>/.no-dormancy` on the identity's local or SSH host.

## What Was Built

### Task 1: Backend route + tests + mount + frontend API client

**`src/backend/database/routes/identity-no-dormancy.ts`** — Express router with:
- `GET /:key/no-dormancy?hostId=<n>` → `{ present: boolean }` — checks sentinel via `fs.stat` (LOCAL) or `test -e` shell command (SSH)
- `PUT /:key/no-dormancy?hostId=<n>` body `{ present: boolean }` → `{ present: boolean }` — `writeFile`/`unlink` (LOCAL) or `touch`/`rm -f` (SSH), both idempotent
- Full threat mitigations: IDENTITY_KEY_RE gate (T-ax1-01, T-ax1-02), resolveHostById 404 (T-ax1-03), generic 504 on SSH failure (T-ax1-04/05), authenticateJWT 401 (T-ax1-06), boolean body gate (T-ax1-07)

**`src/backend/database/routes/identity-no-dormancy.test.ts`** — 24 vitest tests covering local + SSH branches, key validation, idempotency (ENOENT swallow), body validation, error paths, 401 without JWT.

**`src/backend/database/database.ts`** — `identityNoDormancyRoutes` imported and mounted with `app.use("/identities", identityNoDormancyRoutes)` BEFORE the generic `identitiesRoutes` at line ~1818.

**`src/ui/api/identities-api.ts`** — `getIdentityNoDormancy` and `setIdentityNoDormancy` appended, matching the `getIdentityExistsOnHost` byte-shape.

### Task 2: IdentityModal UI + load/toggle wiring + tests

**`src/ui/features/pretty-view/IdentityModal.tsx`** — additive changes only:
- Imports: `Switch` from `@/components/switch`, `toast` from `sonner`, `getIdentityNoDormancy + setIdentityNoDormancy` from `@/api/identities-api`
- State: `staysAwake: boolean | null` (null = loading) + `staysAwakeSaving: boolean`
- `useEffect` on `[open, identity.identityKey, hostId]` — loads sentinel, resets on re-open, cancellable, `toast.error` on load failure
- `onStaysAwakeToggle` — optimistic flip, `setIdentityNoDormancy` call, revert on error + `toast.error`
- JSX in DialogHeader: `<label>` containing `<Switch checked={staysAwake === true} ... disabled={staysAwake === null || staysAwakeSaving} />` + "Stays awake" span, positioned between name/title div and pencil button

**`src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx`** — 6 tests: mount/load false, mount/load true, toggle unchecked→checked, toggle checked→unchecked, revert on error + toast, disabled while loading.

### Task 3: Full suite gate

- `npx vitest run` → **148 test files passed, 1900 tests passed, 0 failures**
- `npm run build:backend` → clean (no TypeScript errors)
- `npm run build` → clean (✓ built in ~5s)
- No deploy attempted (fleet rule).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Express params type string | string[] caused tsc error**
- **Found during:** Task 1 backend build (`npm run build:backend`)
- **Issue:** `req.params.key` is typed as `string | string[]` in Express; IDENTITY_KEY_RE.test() only accepts `string`
- **Fix:** `String(req.params.key ?? "")` cast in both GET and PUT handlers
- **Files modified:** `src/backend/database/routes/identity-no-dormancy.ts`
- **Commit:** 6ae1baf

**2. [Rule 1 - Bug] Test regex for SSH touch command failed to match `&&` in actual command**
- **Found during:** Task 1 test run (Test 7 failure)
- **Issue:** Regex `/mkdir -p .*\.claude\/identities\/moxie && touch .../` doesn't match the actual shell command because `&&` in a regex is not special but the surrounding double-quotes in the actual command confused the pattern
- **Fix:** Changed both SSH command assertions (Tests 7 and 8) to use `toContain()` with exact command strings instead of regex matching
- **Files modified:** `src/backend/database/routes/identity-no-dormancy.test.ts`
- **Commit:** 6ae1baf

## Known Stubs

None — `getIdentityNoDormancy` and `setIdentityNoDormancy` are fully wired; the switch renders real server state.

## Threat Surface Scan

All threat mitigations from the plan's threat register are implemented and tested:
- T-ax1-01/02 (shell injection / path traversal): IDENTITY_KEY_RE gate; test 9 covers `..`, dot-names, length >64
- T-ax1-03 (cross-user): resolveHostById → null → 404; test 10
- T-ax1-04 (SSH detail leak): generic 504 "Host unreachable"; test 12
- T-ax1-05 (SSH hang): Promise.race with 3000ms timeout
- T-ax1-06 (unauthenticated): authenticateJWT on both routes; test 13
- T-ax1-07 (non-boolean present): explicit `typeof present !== "boolean"` gate; test 11

No new threat surface beyond the planned scope.

## Self-Check: PASSED

All created files verified to exist on disk. Both commits (6ae1baf, 2b5db6f) verified in git log.
