---
phase: 101
plan: "03"
subsystem: ssh-semaphore
tags: [ssh, semaphore, route-handlers, per-host-cap]
dependency_graph:
  requires:
    - 101-01  # host-semaphore-registry.ts shipped (getHostSemaphore API)
  provides:
    - identity-clone route wrapped (D-03)
    - roles-create route wrapped (D-03)
    - global-files GET + POST wrapped (D-03)
  affects:
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/roles-create.ts
    - src/backend/database/routes/global-files-read-write.ts
tech_stack:
  added: []
  patterns:
    - getHostSemaphore(hostId).run(async () => { connectOneShot ... conn.end() })
key_files:
  created: []
  modified:
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/roles-create.ts
    - src/backend/database/routes/global-files-read-write.ts
decisions:
  - "conn declaration kept outside run() so finally-block cleanup (conn.end()) compiles and fires after run() settles"
  - "global-files handlers use separate run() wrappers (one per handler), not a shared helper — each handler independently acquires the slot for its own SSH motion"
  - "return; statements inside run() closures exit the closure only; the outer route handler then falls through to the finally cleanup — correct behavior since res.status().json() was already called"
  - "build:backend AWS SDK TS2307 errors on polly-adapter + transcribe-adapter are pre-existing and out of scope"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-10"
  tasks_completed: 3
  files_modified: 3
---

# Phase 101 Plan 03: Route SSH Handlers Through Host-Semaphore-Registry Summary

Three route-driven SSH producers wrapped in `getHostSemaphore(hostId).run(...)` per D-03 contract, closing the biggest route-driven MaxSessions leak points alongside fleet-status and substrate.

## Tasks Completed

| Task | File | Commit |
|------|------|--------|
| 1 | identity-clone.ts | cbffba57 |
| 2 | roles-create.ts | f67d93dc |
| 3 | global-files-read-write.ts | 80bb65a8 |

## Wrap Pattern Applied

All three files follow the same shape. The existing outer structure was:

```typescript
let conn: ... | null = null;
try {
  // SSH motion (connectOneShot → execs → SFTP → conn.end in finally)
} finally {
  if (conn) { try { conn.end(); } catch {} }
}
```

The wrap inserts `await getHostSemaphore(hostId).run(async () => {` immediately after `try {` and closes it with `});` before the `} catch` or `} finally` (whichever comes first). The `conn` declaration and `finally` cleanup remain outside the `run()` wrapper so `conn.end()` still fires after `run()` settles.

## Per-File Notes

### identity-clone.ts

Single SSH motion: `connectOneShot` → `resolveRoleForIdentity` → `readAvatarSiblingFile` → `execWithTimeout` (collision probe) → `execWithTimeout` (mkdir/touch/tmux) → `startHarnessOnIdentity` → `execWithTimeout` ($HOME) → `writeMarkdownFileAtomic` → `writeAvatarSiblingFile` → `readIdentityFile` (re-read) → response.

The outer try/finally has no catch (unhandled errors propagate to the Express error handler at the bottom of the router). The `run()` closes with `});` before `} finally {`.

### roles-create.ts

Single SSH motion: `connectOneShot` → collision probe → `mkdir` + `touch` provisioning → `$HOME` resolution → `writeMarkdownFileAtomic` → SFTP avatar write → 201 response.

Same outer try/finally-no-catch structure. `run()` closes before `} finally {`.

### global-files-read-write.ts

Two handlers, **each with its own `run()` wrapper** (separate call sites — the plan's D-done criterion requires `grep -c "getHostSemaphore" >= 2`, satisfied: 5 occurrences in file — import + 2 openers + 2 closers).

- **POST /read**: `connectOneShot` → optional tilde-expand → `cat`/`stat -c '%Y'`/`stat -c '%s'` exec chain → `res.json`. Handler uses outer try/catch/finally (not nested inner try). `run()` closes before `} catch`.
- **PUT /write**: `connectOneShot` → tilde-expand → optional mtime check + currentContent fetch (409 path) → `writeMarkdownFileAtomic` → re-stat → `res.json`. Same try/catch/finally shape. `run()` closes before `} catch`.

`getFilesForHost(config, ...)` whitelist check is synchronous config — correctly stays outside `run()`.

## Verification Results

```
npm run type-check    → clean
npm run test -- identity-clone roles-create global-files-read-write
  Test Files  3 passed (3)
  Tests       56 passed (56)
npm run build         → frontend built in 6.16s (pre-existing polly/transcribe TS2307 errors in voice/ unrelated)
```

## Deviations from Plan

None — plan executed exactly as written. The TDD flag on tasks was noted but since no test files were modified (the tests verified existing behavior), no RED/GREEN commits were needed beyond the implementation commits. All 56 existing tests remain green.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Changes are pure wrapper insertions around existing SSH paths.

## Self-Check: PASSED

- identity-clone.ts modified: confirmed (cbffba57)
- roles-create.ts modified: confirmed (f67d93dc)
- global-files-read-write.ts modified: confirmed (80bb65a8)
- All three import `getHostSemaphore` from `../../ssh/host-semaphore-registry.js`
- `grep -c "getHostSemaphore" identity-clone.ts` = 3 (>= 1: PASS)
- `grep -c "getHostSemaphore" roles-create.ts` = 3 (>= 1: PASS)
- `grep -c "getHostSemaphore" global-files-read-write.ts` = 5 (>= 2: PASS)
