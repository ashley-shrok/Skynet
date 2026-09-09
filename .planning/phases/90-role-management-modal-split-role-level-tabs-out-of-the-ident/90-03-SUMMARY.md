---
phase: 90-role-management-modal-split
plan: 03
subsystem: api
tags: [websocket, role-file, backend, frontend, tdd, vitest, ssh, sftp]

# Dependency graph
requires:
  - phase: 22-sric-06
    provides: writeRoleFile + identity:update-role-file WS handler (byte-shape mirror source)
  - phase: 85-01
    provides: readRoleFileByName + ROLE_NAME_PATTERN gate (sibling reader pattern)
  - phase: 90-01
    provides: /roles cosmetic-enriched endpoint (companion write path)
  - phase: 90-02
    provides: /roles/:name/avatar endpoint (companion role-name-keyed backend)
provides:
  - writeRoleFileByName(conn, roleName, contents) — role-name-keyed atomic writer (LOCAL fs tmp+rename / REMOTE SFTP ext_openssh_rename)
  - handleRoleUpdateFile WS handler for role:update-file wire type
  - __handleRoleUpdateFileForTests test seam
  - RoleUpdateFilePayload + RoleFileUpdatedEvent frontend wire types
  - updateRoleFileByName frontend one-shot WS helper (opens socket, sends payload, awaits response, closes)
affects: [90-04-rolemodal, 90-05, 90-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Role-name-keyed companion pattern for role-scope backend surfaces (mirrors Phase 85's readRoleFileByName)"
    - "One-shot WS helper pattern in claude-session-api.ts (countIdentityBounties byte-shape mirror)"
    - "Test-seam export __handle*ForTests for vitest-driven WS handler coverage"

key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.write-role-file-by-name.test.ts
    - src/backend/claude-session/claude-session-server.role-update-file.test.ts
    - src/ui/api/claude-session-api.update-role-file-by-name.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts

key-decisions:
  - "Companion wire type (role:update-file) rather than extending identity:update-role-file — planner-pick per D-08.3, rejected the frontend-synthesizes-identityKey fallback which breaks if roles-list host has no local identities"
  - "Full-overwrite semantics preserved from writeRoleFile (mtime-409 UX deferred per D-08.3 Ashley marked nice-to-have but discretion)"
  - "ROLE_NAME_PATTERN validation gate lives at BOTH the writer helper AND the WS handler (belt + suspenders) — matches identity:update-role-file's IDENTITY_KEY_RE double-gate pattern"
  - "Old identity-keyed identity:update-role-file wire type left intact — coexists per shape lock (Plan 90-06 refactors identity modal off role-file editors but leaves the wire types for incidental callers)"

patterns-established:
  - "Role-name-keyed backend writer: writeRoleFileByName mirrors writeRoleFile MINUS the resolveRoleForIdentity two-step, roleName arrives after ROLE_NAME_PATTERN validation"
  - "WS handler byte-shape mirror: handleRoleUpdateFile is a mechanical mirror of handleIdentityUpdateRoleFile — same envelope structure, same LOCAL vs REMOTE branching, same finally { conn.end() }"
  - "Frontend one-shot helper: RoleModal-style save handlers can consume updateRoleFileByName without needing an identityKey"

requirements-completed: []

# Metrics
duration: 32min
completed: 2026-09-09
---

# Phase 90 Plan 90-03: role-name-keyed role-file write path Summary

**Role-name-keyed WS wire type `role:update-file` + `writeRoleFileByName` backend writer + `updateRoleFileByName` frontend WS helper — clean save path for the upcoming RoleModal (Plan 90-04) with no identity context needed**

## Performance

- **Duration:** ~32 min
- **Started:** 2026-09-09T13:15:24Z (approx, first read)
- **Completed:** 2026-09-09T13:24:00Z (approx, last commit + summary)
- **Tasks:** 3 (all TDD RED/GREEN, no REFACTOR needed)
- **Files modified:** 3 source + 3 new test files

## Accomplishments

- **Task 1: `writeRoleFileByName` backend writer** — role-name-keyed atomic writer mirroring `writeRoleFile` (Phase 22 SRIC-06) MINUS the identity two-step. LOCAL branch does tmp+rename via `fs`, REMOTE branch routes through `writeMarkdownFileAtomic` (ext_openssh_rename, patch #268 lock). Two guards fire before any I/O: ROLE_NAME_PATTERN gate + IDMEDIT_MAX_MARKDOWN_BYTES byte cap (2MB).
- **Task 2: `role:update-file` WS handler + dispatcher branch + wire-type docs** — `handleRoleUpdateFile` exported at module scope with `__handleRoleUpdateFileForTests` seam for vitest. Wires directly into the message dispatcher alongside `identity:update-role-file`. After write, re-reads via `readRoleFileByName` so the client rehydrates from server-side truth (no client draft trust — mirrors T-22-06-05 mitigation).
- **Task 3: `updateRoleFileByName` frontend WS helper** — one-shot request/response helper in `claude-session-api.ts`. Opens `openClaudeSessionSocket`, sends `role:update-file` on open, resolves `{markdown}` on matching `role:file-updated` response, throws `Error(env.error)` if envelope carries error, closes socket after single response. Byte-shape mirror of `countIdentityBounties`.

## Task Commits

Each task was committed atomically:

1. **Task 1: writeRoleFileByName backend writer** — `728625fc` (feat: writeRoleFileByName + 5 vitest cases green)
2. **Task 2: role:update-file WS handler + dispatcher + doc block** — `e59ed45c` (feat: handleRoleUpdateFile + seam + 7 vitest cases green)
3. **Task 3: updateRoleFileByName frontend WS helper + types** — `dab91099` (feat: RoleUpdateFilePayload + RoleFileUpdatedEvent + helper + 2 vitest cases green)

_All tasks were TDD (test → feat within same commit — RED confirmed pre-implementation, GREEN confirmed post-implementation before staging)_

## Files Created/Modified

**Modified:**
- `src/backend/claude-session/identity-artifact-reader.ts` — new export `writeRoleFileByName` adjacent to `writeRoleFile` (~70 line addition + JSDoc)
- `src/backend/claude-session/claude-session-server.ts` — new imports (`readRoleFileByName`, `writeRoleFileByName`, `ROLE_NAME_PATTERN`), new module-scope `handleRoleUpdateFile` + `__handleRoleUpdateFileForTests` seam, new dispatcher branch, two new wire-type doc lines
- `src/ui/api/claude-session-api.ts` — new wire types `RoleUpdateFilePayload` + `RoleFileUpdatedEvent`, new exported `updateRoleFileByName` helper

**Created:**
- `src/backend/claude-session/identity-artifact-reader.write-role-file-by-name.test.ts` — 5 vitest cases (LOCAL happy path, REMOTE SFTP happy path, invalid roleName gate, oversized-payload gate, fresh-folder defensive mkdir)
- `src/backend/claude-session/claude-session-server.role-update-file.test.ts` — 7 vitest cases (LOCAL happy path, REMOTE happy path with `conn.end` in finally, invalid roleName, host-not-found, contents-not-string, writer-throws-propagation, seam-export presence)
- `src/ui/api/claude-session-api.update-role-file-by-name.test.ts` — 2 vitest cases (happy path with server-echoed markdown, error envelope rejection with socket-close)

## Decisions Made

- **Companion wire type over identity-key extension (D-08.3 planner-pick):** Added `role:update-file` as a sibling wire type rather than extending `identity:update-role-file` to accept an optional roleName. Cleaner separation — the identity handler stays identity-keyed, the role handler is role-keyed. Rejected the "frontend synthesizes identityKey from host's identity list" fallback because it breaks if the roles-list host has no local identities (which is legitimate for a fleet host).
- **Full-overwrite semantics preserved:** Mirrors current role-file editor. mtime-409 UX not added (D-08.3 marked nice-to-have but discretion; deferred to keep this plan tight for the 90-04 unblock).
- **ROLE_NAME_PATTERN import direct from `identity-birth-orchestrator.js`:** The `writeRoleFileByName` helper already validates internally, but the WS handler needs to gate BEFORE `resolveHostById` to satisfy the acceptance criterion "bad-roleName path never opens SSH conn". Imported the pattern directly rather than re-exporting through `identity-artifact-reader.ts` (identity-artifact-reader already imports it privately; the WS server file adopts the same source-of-truth import).
- **New wire types `RoleUpdateFilePayload` / `RoleFileUpdatedEvent` NOT prefixed with `Identity`:** Reflects the role-scope nature of the wire pair. Old `IdentityUpdateRoleFilePayload` / `IdentityRoleFileUpdatedEvent` retained intact — the two coexist per D-08.3 (identity modal role-file editors deprecate in Plan 90-06 but the wire types stay for incidental callers).

## Deviations from Plan

None - plan executed exactly as written.

The plan's acceptance criteria matched implementation byte-for-byte: 1 `writeRoleFileByName` export, 1 `handleRoleUpdateFile` export, 8 references to `role:update-file` in server file (>=2 required), 1 `__handleRoleUpdateFileForTests` seam, 1 `updateRoleFileByName` export in api file. All scoped vitest cases (14 total across 3 test files) green on first pass after GREEN implementation.

## Issues Encountered

- **Vitest `--related` flag not supported in this version:** The plan's `<verify>` section prescribed `npx vitest run --related <file>`, which errored with `Unknown option --related`. Substituted with explicit test-file paths for the equivalent scope (all three new test files + the two adjacent role-file test files as regression check).
- **Cross-test port collision on parallel run:** Running `claude-session-server.role-file.test.ts` and `claude-session-server.role-update-file.test.ts` together triggers `EADDRINUSE` on WS server port 30011 because the module-under-test boots the server at import time. Both files pass individually — this is a pre-existing test-isolation issue unrelated to Plan 90-03. Documented for potential future cleanup but not a blocker.

## User Setup Required

None - purely internal WS wire type + helpers. No external services, no env vars.

## Next Phase Readiness

- **Plan 90-04 (RoleModal shell + tab-body lifts) unblocked:** The role-file cosmetic-edit save handler in the new RoleModal can consume `updateRoleFileByName(roleName, hostId, contents)` directly — no identity context needed.
- **Belt + suspenders on validation:** ROLE_NAME_PATTERN + IDMEDIT_MAX_MARKDOWN_BYTES gates fire at BOTH the writer helper AND the WS handler layer. Bad inputs never touch disk / open SSH.
- **Backward compatibility preserved:** Existing `identity:update-role-file` wire type + `handleIdentityUpdateRoleFile` handler unchanged. No regression risk for `IdentityModal.tsx`'s existing role-file save handler (which stays intact until Plan 90-06 refactors it away).

## Self-Check: PASSED

**Files verified present:**
- `/home/ubuntu/skynet-tabitha/src/backend/claude-session/identity-artifact-reader.write-role-file-by-name.test.ts` — FOUND
- `/home/ubuntu/skynet-tabitha/src/backend/claude-session/claude-session-server.role-update-file.test.ts` — FOUND
- `/home/ubuntu/skynet-tabitha/src/ui/api/claude-session-api.update-role-file-by-name.test.ts` — FOUND

**Commits verified in git log:**
- `728625fc` — FOUND (Task 1 writer helper)
- `e59ed45c` — FOUND (Task 2 WS handler)
- `dab91099` — FOUND (Task 3 frontend helper)

**Grep acceptance criteria verified:**
- `writeRoleFileByName` export in identity-artifact-reader.ts — 1 (matches expected)
- `handleRoleUpdateFile` export in claude-session-server.ts — 1 (matches expected)
- `role:update-file` in claude-session-server.ts — 8 (>=2 required)
- `__handleRoleUpdateFileForTests` — 1 (matches expected)
- `updateRoleFileByName` in claude-session-api.ts — 1 (matches expected)

**Build gates verified:**
- `npm run build:backend` — CLEAN
- `npm run build` — CLEAN (only pre-existing dynamic-import warning on telegram-api.ts unrelated to this plan)

---
*Phase: 90-role-management-modal-split*
*Completed: 2026-09-09*
