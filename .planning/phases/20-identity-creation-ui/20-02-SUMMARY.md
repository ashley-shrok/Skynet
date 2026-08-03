---
phase: 20-identity-creation-ui
plan: "02"
subsystem: backend
tags: [identity, ssh, collision-check, nginx, tdd]
dependency_graph:
  requires:
    - 20-01 (nginx ordering pattern established; /identities/avatar already declared above /identities)
  provides:
    - GET /identities/exists-on-host
  affects:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
tech_stack:
  added: []
  patterns:
    - connectOneShot + execCommand SSH one-shot probe (3s connect + 3s exec Promise.race)
    - isLocalHostId branch selector (IDENTITIES_LOCAL_HOST_IDS env var)
    - fs.stat local branch for self-host check
    - IDENTITY_KEY_RE regex gate before any SSH/fs work
    - Single-quoted name in SSH shell command as defense-in-depth
key_files:
  created:
    - src/backend/database/routes/identity-exists-on-host.ts
    - src/backend/database/routes/identity-exists-on-host.test.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "isLocalHostId imported from identity-artifact-reader.ts (not re-implemented)"
  - "fs/promises used as named import (import { stat as fspStat }) to match vi.mock named-export mock shape"
  - "SSH shell string: if [ -d \"$HOME/.claude/identities/'<name>'\" ]; then echo exists; else echo missing; fi — name single-quoted"
  - "connectOneShot timeout 3s + Promise.race exec timeout 3s; nginx proxy_read_timeout 10s"
  - "mockUserId reset in afterEach to prevent state leak between Test 9 (401) and Test 10 (shell safety)"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-03"
  tasks_completed: 3
  files_changed: 5
---

# Phase 20 Plan 02: Identity Exists On Host Probe Summary

Target-host-side identity name-collision probe endpoint with SSH + local-fs branches,
IDENTITY_KEY_RE shell-injection gate, and both nginx configs updated above /identities.

## What Was Built

### GET /identities/exists-on-host

- Accepts `?hostId=<n>&name=<slug>` query parameters (both required)
- JWT-gated via authenticateJWT middleware
- Validates `hostId` as a positive integer → 400 on invalid/missing
- Validates `name` against `IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/` → 400 with `{error: "name must match [a-z0-9._=/+-]+"}` on failure
- Verifies host ownership via `resolveHostById(hostId, userId)` → 404 `{error: "Host not found"}` if null
- Returns `{exists: boolean}` on success

**Local branch (isLocalHostId=true):**
- Probes `path.join(os.homedir(), ".claude", "identities", name)` via `fs.stat`
- ENOENT → `{exists: false}`; stat success → `{exists: true}`; other errors → 500

**SSH branch (isLocalHostId=false):**
- Opens `connectOneShot(host, 3000)` (3s connect timeout)
- Runs `execCommand` in `Promise.race` with 3s timeout:
  ```
  if [ -d "$HOME/.claude/identities/'<name>'" ]; then echo exists; else echo missing; fi
  ```
- `output.trim() === "exists"` → `{exists: true}`; else `{exists: false}`
- Any error (connect timeout, exec timeout, SSH error) → 504 `{error: "Host unreachable"}` (no detail leak)
- `conn.end()` in `finally` block

### Exact SSH probe shell string (for plan 05 debounce-timing reference)

```
if [ -d "$HOME/.claude/identities/'${name}'" ]; then echo exists; else echo missing; fi
```

The name is single-quoted inside the double-quoted outer string. Since IDENTITY_KEY_RE
already rejects chars outside `[a-z0-9._=/+-]`, single-quoting is defense-in-depth
mirroring `identity-artifact-reader.ts` §SHELL SAFETY.

### Timeout values

- **SSH connect**: 3000ms (second arg to `connectOneShot`)
- **SSH exec race**: 3000ms (`Promise.race` with `setTimeout` inside SSH branch)
- **Nginx outer**: `proxy_read_timeout 10s` (set in both nginx configs)

### isLocalHostId

Imported from `../../claude-session/identity-artifact-reader.js`. Not re-implemented.
The module parses `IDENTITIES_LOCAL_HOST_IDS` env var once at load time.

### database.ts mount

Imported as `identityExistsOnHostRoutes`. Mounted with `app.use("/identities", identityExistsOnHostRoutes)` BEFORE `app.use("/identities", identitiesRoutes)`, so `/identities/exists-on-host` resolves to this router before falling through to the generic identities handlers.

### Nginx

Both `docker/nginx.conf` and `docker/nginx-https.conf` have:
- `location ~ ^/identities/exists-on-host(/.*)?$` declared AFTER the `/identities/avatar` block and BEFORE the generic `/identities` block
- `proxy_pass http://127.0.0.1:30001`
- `proxy_read_timeout 10s`

## Tests

All 10 tests pass:
- Test 1: local branch — existing folder returns {exists: true} (fs.stat succeeds)
- Test 2: local branch — missing folder returns {exists: false} (fs.stat ENOENT)
- Test 3: SSH branch — execCommand returns "exists" → {exists: true}
- Test 4: SSH branch — execCommand returns "missing" → {exists: false}
- Test 5: SSH branch — connectOneShot rejects → 504 {error: "Host unreachable"}
- Test 6: host-not-owned — resolveHostById returns null → 404 {error: "Host not found"}
- Test 7: invalid name (space) — fails IDENTITY_KEY_RE → 400 with error message
- Test 8: missing hostId → 400
- Test 9: no JWT → 401, no DB/SSH work attempted
- Test 10: shell safety — evil name rejected by IDENTITY_KEY_RE (400); valid name's execCommand arg contains `'<name>'` single-quotes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fs/promises mock shape mismatch**
- **Found during:** Task 2 GREEN phase (Tests 1 & 2 returning 500)
- **Issue:** Route imported `fs/promises` as default (`import fsp from "fs/promises"`), but `vi.mock("fs/promises", () => ({ stat: vi.fn() }))` creates a named export mock. Default import of a mocked-with-named-exports module resolves to `undefined` or the module object, so `fsp.stat` was not the mock function.
- **Fix:** Changed route to named import `import { stat as fspStat } from "fs/promises"` and updated test to import and reference `fspStat` directly. Mock updated to include `default: { stat: vi.fn() }` as belt-and-suspenders.
- **Files modified:** `identity-exists-on-host.ts`, `identity-exists-on-host.test.ts`
- **Commit:** 7ed0537

**2. [Rule 1 - Bug] mockUserId state leak between Test 9 and Test 10**
- **Found during:** Task 2 GREEN phase (Test 10 getting 401 instead of 400)
- **Issue:** Test 9 sets `mockUserId = null` to trigger 401. The module-level variable persisted into Test 10 because `beforeEach` didn't reset it (only sets up the server — the auth middleware closes over `mockUserId` at request time).
- **Fix:** Added `mockUserId = "1"` reset in `afterEach`.
- **Files modified:** `identity-exists-on-host.test.ts`
- **Commit:** 7ed0537

## No Push / Build / Deploy

No `git push`, `docker build`, or `docker compose` was invoked. Container stays at
`sha256:07547f6c4185` per held-queue posture.

## Known Stubs

None. The route is fully wired to real SSH machinery and fs.stat.

## Threat Flags

No new threat surface beyond what was planned. The route:
- Requires JWT authentication (no unauthed paths)
- Validates name via regex before any SSH/fs work
- Does not leak SSH error messages (generic 504 on all SSH failures)
- Scopes host access by userId via resolveHostById

## Self-Check: PASSED

Files exist:
- `src/backend/database/routes/identity-exists-on-host.ts` — FOUND
- `src/backend/database/routes/identity-exists-on-host.test.ts` — FOUND
- `docker/nginx.conf` location block for /identities/exists-on-host — FOUND
- `docker/nginx-https.conf` location block for /identities/exists-on-host — FOUND
- `src/backend/database/database.ts` import + mount — FOUND (2 occurrences)

Commits exist:
- aa270f8: test(20-02): add failing tests — FOUND
- 7ed0537: feat(20-02): implement identity-exists-on-host router — FOUND
- ea5fd65: feat(20-02): add nginx location blocks — FOUND

Build:
- `npm run build:backend` exits 0 — VERIFIED
- All 10 tests pass — VERIFIED
- nginx block ordering check (awk): OK for both configs — VERIFIED
