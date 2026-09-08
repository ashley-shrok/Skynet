---
phase: 85-user-avatars-baseline-backend-support
plan: 02
subsystem: api
tags: [phase-85, user-avatars, multer, helper-module, storage, vitest]

# Dependency graph
requires:
  - phase: 85-user-avatars-baseline-backend-support plan 01
    provides: avatar_path column on users table and USER_AVATARS_DIR on-disk convention
provides:
  - user-avatar-storage.ts shared helper module (D-12): multer instance, error handler, writeUserAvatar, unlinkUserAvatar, readUserAvatar, USER_AVATARS_DIR
  - 10-test suite proving all 9 required behaviors (mime accept/reject, size cap, write round-trip, ext derivation, ENOENT-tolerant unlink, read, ENOENT propagation, bad-extension throw, error handler routing)
affects: [85-03, 85-04, 85-05, 85-06, 85-07]

# Tech tracking
tech-stack:
  added: []  # no new packages — helper reuses in-tree multer, node:fs/promises, node:path
  patterns:
    - "vi.resetModules() + dynamic await import() to isolate module-level DATA_DIR capture in vitest tests"
    - "MIME_TO_EXT / EXT_TO_MIME local scoped maps (3 whitelisted mimes only, no cross-file coupling to identity system)"
    - "ENOENT-tolerant unlink: catch err.code !== ENOENT, rethrow everything else"
    - "readUserAvatar propagates ENOENT for serve endpoint 404 mapping (Pitfall 4)"

key-files:
  created:
    - src/backend/database/routes/user-avatar-storage.ts
    - src/backend/database/routes/user-avatar-storage.test.ts
  modified: []

key-decisions:
  - "Local MIME_TO_EXT/EXT_TO_MIME maps covering only png/jpeg/webp — no cross-file coupling to identity-avatar-batch or identity-artifact-reader (RESEARCH § 8, D-14)"
  - "readUserAvatar propagates ENOENT rather than catching it — serve endpoint (Plan 05) must see err.code === ENOENT to map to 404 (Pitfall 4)"
  - "writeUserAvatar throws defensively on unwhitelisted mime even though multer fileFilter runs first — helper is safe when called directly from tests"
  - "vi.resetModules() + dynamic import pattern to work around module-level DATA_DIR capture in test isolation"

patterns-established:
  - "Pattern: shared user-avatar helper module — all Phase 85 write/read/unlink endpoints import from user-avatar-storage.ts, never redefine the filename convention or mime whitelist"

requirements-completed: [D-01, D-02, D-03, D-05, D-12, D-14, D-15, D-16]

# Metrics
duration: 18min
completed: 2026-09-08
---

# Phase 85 Plan 02: User Avatar Storage Helper Summary

**Shared multer + file-I/O helper module (user-avatar-storage.ts) with 5MB/png-jpeg-webp cap, deterministic ${userId}.${ext} filename convention, and 10-test vitest suite proving all 9 D-12 behavior contracts**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-08T03:30:00Z
- **Completed:** 2026-09-08T03:48:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `user-avatar-storage.ts` — the shared D-12 helper module exporting the 6 named symbols Plans 03, 04, 05, 06, 07 will import
- multer instance mirrors `identity-avatar-batch.ts:406-422` verbatim: `memoryStorage()` + 5MB `fileSize` limit + png/jpeg/webp `fileFilter` (D-14/D-15/D-16)
- `writeUserAvatar(userId, mime, bytes)` composes deterministic filename `${userId}.${ext}` (D-05), calls `mkdir({ recursive: true })` for first-call bootstrap, writes bytes, returns bare filename for `users.avatar_path`
- `unlinkUserAvatar(filenameOrNull)` is ENOENT-tolerant (D-22): null/undefined guard + catch ENOENT, rethrow everything else
- `readUserAvatar(filename)` derives Content-Type from extension via local `EXT_TO_MIME` map, propagates ENOENT for serve endpoint 404 mapping (Pitfall 4), throws on unrecognized extension (fails closed)
- 10-test vitest suite (9 required behaviors + 1 extra explicit mkdir test) — all 10 pass

## Task Commits

1. **Task 1: Create user-avatar-storage.ts helper module** - `ae7d2285` (feat)
2. **Task 2: Create user-avatar-storage.test.ts with behavior tests** - `1fcfadde` (test)

## Exported Symbols (D-12 single source of truth)

| Symbol | Type | Signature |
|--------|------|-----------|
| `USER_AVATARS_DIR` | constant | `string` — `path.join(DATA_DIR, "user-avatars")` |
| `userAvatarUpload` | multer instance | `Multer` — memoryStorage + 5MB limit + png/jpeg/webp fileFilter |
| `userAvatarMulterErrorHandler` | Express error handler | `(err, req, res, next) => void` — LIMIT_FILE_SIZE→413, LIMIT_UNEXPECTED_FILE→400, mime-error→400, other→500 |
| `writeUserAvatar` | async function | `(userId: string, mime: string, bytes: Buffer) => Promise<string>` |
| `unlinkUserAvatar` | async function | `(filenameOrNull: string \| null \| undefined) => Promise<void>` |
| `readUserAvatar` | async function | `(filename: string) => Promise<{ bytes: Buffer; mime: string }>` |

## Whitelisted Mimes (D-14) and Size Cap (D-15)

| Mime | Extension | Included |
|------|-----------|---------|
| `image/png` | `.png` | YES |
| `image/jpeg` | `.jpg` | YES |
| `image/webp` | `.webp` | YES |
| `image/gif` | `.gif` | NO — explicitly excluded |
| `image/svg+xml` | `.svg` | NO — explicitly excluded (XSS risk) |

**Size cap:** 5 MB (`5 * 1024 * 1024` bytes) — enforced at multer before bytes touch disk (D-16)

## Filename Convention (D-05)

`${userId}.${ext}` — deterministic and resolvable from `DATA_DIR` alone:
- `userId` is caller-supplied (nanoid at create, authenticated targetUserId at change)
- `ext` is derived from whitelisted mime via `MIME_TO_EXT` — never from `req.file.originalname`
- `image/jpeg` → `.jpg` (not `.jpeg`) — standard browser/HTTP convention

## Test Run Output

```
RUN  v4.1.8 /home/ubuntu/skynet-tina

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  03:34:03
   Duration  5.64s (transform 937ms, setup 845ms, import 292ms, tests 1.09s, environment 0ms)
```

Test descriptions:
1. `userAvatarUpload rejects image/gif via fileFilter` — verifies mime whitelist (D-14)
2. `userAvatarUpload has fileSize limit of 5 MB` — verifies size cap (D-15)
3. `writeUserAvatar creates file at USER_AVATARS_DIR/${userId}.${ext} and returns filename` — write round-trip
4. `writeUserAvatar produces .jpg for image/jpeg, .webp for image/webp` — ext derivation
5. `unlinkUserAvatar is ENOENT-tolerant and removes existing files` — three sub-cases (null, nonexistent, existing)
6. `readUserAvatar returns bytes + derived mime from extension` — read round-trip
7. `readUserAvatar propagates ENOENT (does not silently 404)` — ENOENT passthrough for serve endpoint
8. `readUserAvatar throws on unrecognized extension` — corrupt.bin throws /unrecognized avatar file extension/
9. `userAvatarMulterErrorHandler routes to correct status codes` — all 4 branches
10. `writeUserAvatar succeeds even when USER_AVATARS_DIR does not exist yet (mkdir recursive)` — extra explicit test

## Cross-File Coupling Confirmation

```
grep -c 'from "./identity-avatar-batch|from "../claude-session/identity-artifact-reader'
  src/backend/database/routes/user-avatar-storage.ts
→ 0 (no cross-file coupling to identity system)
```

The local `MIME_TO_EXT` / `EXT_TO_MIME` maps cover ONLY the 3 whitelisted mimes (png/jpeg/webp). The identity system's `MIME_TO_AVATAR_EXT` includes gif and svg — reusing it would silently expand the whitelist and violate D-14.

## Files Created/Modified

- `/home/ubuntu/skynet-tina/src/backend/database/routes/user-avatar-storage.ts` — shared helper module (216 lines)
- `/home/ubuntu/skynet-tina/src/backend/database/routes/user-avatar-storage.test.ts` — test suite (294 lines, 10 tests)

## Decisions Made

1. **Local mime maps** — `MIME_TO_EXT` / `EXT_TO_MIME` defined locally rather than importing from `identity-artifact-reader`. Rationale: identity system maps include gif/svg; importing would silently expand the D-14 whitelist. Zero cross-file coupling to the identity system per RESEARCH.md § 8.

2. **ENOENT propagation in readUserAvatar** — ENOENT is NOT caught so the serve endpoint (Plan 05) sees `err.code === "ENOENT"` and maps to 404. Catching and re-throwing would lose the `code` property on some Node versions.

3. **vi.resetModules() + dynamic import** — chosen over a `_setDataDirForTests()` escape hatch because the escape hatch couples production code to tests. The dynamic-import pattern is slightly more verbose but keeps the module clean.

4. **10th test (extra mkdir explicit test)** — added beyond the 9 required behaviors because the mkdir behavior is load-bearing (USER_AVATARS_DIR may not exist on fresh deployments) and deserves its own unambiguous assertion separate from the write round-trip test.

## Deviations from Plan

None — plan executed exactly as written. All 9 required behaviors implemented and tested. TypeScript compiles clean. No cross-file coupling introduced.

## Issues Encountered

None.

## Known Stubs

None — the module is fully implemented. All 6 exported symbols are production-ready.

## Threat Flags

No new security surface introduced beyond what the plan's `<threat_model>` documents. This is a pure internal helper module with no network endpoints, no auth paths, and no direct schema changes. The T-85-02 path-traversal mitigation (never using `req.file.originalname`) is implemented: `writeUserAvatar` composes filename from `userId` + whitelisted `MIME_TO_EXT` lookup only.

## Next Phase Readiness

Plans 03, 04, 05, 06, 07 can import the 6 named exports from `user-avatar-storage.ts` without redefining the mime whitelist, size cap, filename convention, or file-I/O primitives. The single source of truth (D-12) is in place.

---
*Phase: 85-user-avatars-baseline-backend-support*
*Completed: 2026-09-08*
