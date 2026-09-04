---
phase: 72-identity-modal-role-identity-scope-split-with-role-level-wak
plan: 01
subsystem: backend
tags: [wakeups, role-scope, identity-scope, ws-handlers, crud, backend]

requires:
  - phase: 22
    provides: "readRoleFile / writeRoleFile two-step pattern, resolveRoleForIdentity, getLocalRolesRoot"
  - phase: 17g
    provides: "identity:list-wakeups + identity:update-wakeup wire types + WS handlers"
  - phase: 67
    provides: "coordinator boolean on Identity type (consumed downstream in Wave 3)"

provides:
  - "Six new backend functions in identity-artifact-reader.ts for role-scope wakeup read + full CRUD"
  - "Two new backend functions closing the identity-scope wakeup create/delete parity gap"
  - "Six new WS handlers on claude-session-server (routed by isLocalHostId, LOCAL + REMOTE branches)"
  - "Twelve new wire types + WakeupSpecWire alias + ClaudeSessionEvent union extension"
  - "18 backend unit tests + 14 WS handler integration tests (all green)"

affects: [72-02, 72-03, 72-04, wakeups-tab, identity-modal, role-view]

tech-stack:
  added: []
  patterns:
    - "Backend two-step (identity file frontmatter → role folder) applied to wakeup CRUD"
    - "Kebab-case slug normalization from spec.name (server-derived, never client-supplied)"
    - "Non-overwriting create with `wakeup with this name already exists` throw + LOCAL fs.access / REMOTE `[ -e ]` clobber guards"
    - "Idempotent delete (LOCAL: swallow ENOENT, REMOTE: rm -f)"
    - "Post-write re-list-in-response so client atomically re-renders without follow-up read"
    - "Test-seam extraction pattern (handleX + __handleXForTests alias) mirroring Plan 22-06"

key-files:
  created:
    - "src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts (10 tests)"
    - "src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts (8 tests)"
    - "src/backend/claude-session/claude-session-server.role-wakeups.test.ts (14 tests)"
  modified:
    - "src/backend/claude-session/identity-artifact-reader.ts (+6 exports, +1 shared type, +2 file-private helpers)"
    - "src/backend/claude-session/claude-session-server.ts (+6 extracted handlers, +6 test seams, +6 dispatch cases, +10 lines of msg-type doc)"
    - "src/ui/api/claude-session-api.ts (+12 wire types, +1 shared alias, +6 union members)"

key-decisions:
  - "Reused the writeIdentityWakeupUpdate REMOTE python3 pattern for the four new role-scope + identity-scope create writers (byte-shape parity, one script)"
  - "Slug derivation is server-side only — spec.name is authoritative, client cannot pre-compute or override the slug (defense against slug/name mismatch)"
  - "Create writers throw on clobber rather than last-writer-wins (rushed double-tap protection); update writers keep last-writer-wins per existing convention"
  - "Delete writers are idempotent — LOCAL swallows ENOENT, REMOTE uses `rm -f` (matches bounty-delete pattern from patch #183)"
  - "New WS handlers extracted as top-level functions with __handle*ForTests seams (mirrors Plan 22-06 role-file convention) rather than inline in the msg.type block — needed for the mocked handler tests"
  - "Shared WakeupSpec (backend) + WakeupSpecWire (frontend) so both create writers reference the same field shape without cross-boundary import"
  - "Sub-repos not touched — this is a single-repo project (no `sub_repos` config); commit-to-subrepo not applicable"

patterns-established:
  - "Two-step role-scope CRUD: reader/writer resolves role via resolveRoleForIdentity BEFORE the LOCAL/REMOTE branch split, then substitutes identities/<key>/wakeups → roles/<role>/wakeups in both branches"
  - "Test-seam pair: top-level `handleX(ws, msg, userId)` + `export const __handleXForTests = handleX` — vitest drives the handler directly with mocked reader/writer helpers and mocked ssh-one-shot"

requirements-completed: []

# Metrics
duration: 25min
completed: 2026-09-04
---

# Phase 72 Plan 01: Backend wakeup CRUD parity Summary

**Backend now has full CRUD parity on role-scope wakeups (four ops, via the same two-step pattern that already backs role-file / bounties / history) plus the parity-gap closure on identity-scope wakeups (create + delete added on top of the existing list + update).**

## Performance

- **Duration:** ~25 minutes end-to-end (both tasks + tests + commits)
- **Started:** 2026-09-04T07:26:40Z (per STATE.md)
- **Completed:** 2026-09-04T07:52:00Z (approx, at commit time)
- **Tasks:** 2 / 2 completed
- **Files modified:** 3 (+ 3 new test files)

## Accomplishments

### Task 1 — identity-artifact-reader.ts (commit 3b75e633)

Six new exported functions + one shared type + two file-private helpers:

| Function                        | Line range (approx) | Purpose                                                            |
| ------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `readRoleWakeups`               | 824–954             | List role-scope wakeups via two-step; byte-shape mirror of readIdentityWakeups |
| `writeRoleWakeupUpdate`         | 1364–1447           | Patch a role-scope wakeup (mirrors writeIdentityWakeupUpdate)      |
| `writeRoleWakeupCreate`         | 1481–1573           | Create a role-scope wakeup; clobber-guarded; returns fresh list    |
| `writeRoleWakeupDelete`         | 1575–1623           | Idempotent delete of a role-scope wakeup; returns fresh list       |
| `writeIdentityWakeupCreate`     | 1625–1701           | Identity-scope parity-gap: create wakeup with clobber guard        |
| `writeIdentityWakeupDelete`     | 1703–1747           | Identity-scope parity-gap: idempotent delete                       |

Support additions:
- `export type WakeupSpec` at L1238 — shared shape for both create writers (name / enabled / schedule / instruction).
- `function normalizeWakeupSlug` at L1449 — kebab-case slug derivation from `spec.name`.
- `function validateWakeupSpec` at L1456 — shared field-shape validator.

Test coverage:
- `identity-artifact-reader.role-wakeups.test.ts` — 10 tests covering read (LOCAL happy path + missing dir + REMOTE happy path + throws on missing role frontmatter), update (LOCAL patch), create (LOCAL happy path + clobber + empty-slug throw), delete (LOCAL happy path + idempotent + invalid-slug throw).
- `identity-artifact-reader.wakeup-crud.test.ts` — 8 tests covering identity-scope create + delete (happy path, clobber, empty-slug throw, schedule-type throw, idempotent-on-missing, invalid-slug throw, invalid-identityKey throw).

### Task 2 — WS handlers + wire types (commit 0e837451)

Six new WS handlers on claude-session-server.ts, dispatched from msg.type switch (L5613+) and extracted as top-level exports (L1530+) with matching `__handle*ForTests` test seams (L1947–1952):

| Handler                             | Line (extracted) | Wire request                       | Wire response                    |
| ----------------------------------- | ---------------- | ---------------------------------- | -------------------------------- |
| `handleIdentityListRoleWakeups`     | 1530             | `identity:list-role-wakeups`       | `identity:role-wakeups`          |
| `handleIdentityUpdateRoleWakeup`    | 1589             | `identity:update-role-wakeup`      | `identity:role-wakeup-updated`   |
| `handleIdentityCreateRoleWakeup`    | 1690             | `identity:create-role-wakeup`      | `identity:role-wakeup-created`   |
| `handleIdentityDeleteRoleWakeup`    | 1755             | `identity:delete-role-wakeup`      | `identity:role-wakeup-deleted`   |
| `handleIdentityCreateWakeup`        | 1817             | `identity:create-wakeup`           | `identity:wakeup-created`        |
| `handleIdentityDeleteWakeup`        | 1882             | `identity:delete-wakeup`           | `identity:wakeup-deleted`        |

Twelve new wire types in `src/ui/api/claude-session-api.ts` (6 payloads + 6 events) at L769–849 plus `WakeupSpecWire` at L760 (shared alias for both create payloads). All six event types added to the `ClaudeSessionEvent` union at L404–413.

Test coverage:
- `claude-session-server.role-wakeups.test.ts` — 14 tests: one happy-path per handler (6 total) + one validation-rejection per handler proving the writer helper is NEVER called on bad input (belt-and-suspenders — the helper also validates internally per Task 1).

Doc-consistency updates:
- Message-type union comment near L100 extended with the 6 new client→server messages.
- Response-shape comment near L160 extended with the 6 new server→client messages.

## Deviations from Plan

**None** — plan executed exactly as written. Both tasks landed the exact set of exports, wire types, and test coverage the plan specified. Grep acceptance criteria all pass:

- 6 new exported functions (target: 6) ✓
- 1 `WakeupSpec` type (target: 1) ✓
- 5 `roles/${role}/wakeups` paths (target: ≥4) ✓
- 6 WS handler dispatches (target: 6) ✓
- 12 wire type exports (target: 12) ✓
- 6 union extensions (target: 6) ✓
- 1 `WakeupSpecWire` alias (target: 1) ✓
- 12 `role-wakeup` mentions (target: ≥12) ✓

TypeScript both backends pass:
- `npx tsc -p tsconfig.node.json --noEmit` — clean
- `npx tsc --noEmit` — clean

## Verification

Scoped test results (all green):
- `npx vitest run src/backend/claude-session/identity-artifact-reader` → 142/142 tests pass (was 124, +18 new)
- `npx vitest run src/backend/claude-session/claude-session-server` → 185 passed | 1 skipped (was 171, +14 new)
- Backend + frontend TypeScript type-check both clean

No existing tests regressed. No changes to nginx, docker-compose, or any deploy surface (this plan adds new WS handlers on an existing WSS port — the frontend WakeupsTab (Wave 2) will be the first consumer; Wave 3 wires the scope switch).

## Known Stubs

None. This plan lands wire+handler infrastructure that Wave 2's frontend refactor will consume. The plan intentionally has no UI-side changes; the "stub" of no scope-aware UI is by design (Wave 2 → 3 → 4 gate progressive frontend integration per the phase's four-wave shape).

## Self-Check: PASSED

Files created:
- FOUND: src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts
- FOUND: src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts
- FOUND: src/backend/claude-session/claude-session-server.role-wakeups.test.ts

Commits:
- FOUND: 3b75e633 — feat(72-01): add role-scope wakeup reader/writers + identity-scope create/delete parity
- FOUND: 0e837451 — feat(72-01): add 6 WS handlers for role-scope wakeup CRUD + identity-scope create/delete
