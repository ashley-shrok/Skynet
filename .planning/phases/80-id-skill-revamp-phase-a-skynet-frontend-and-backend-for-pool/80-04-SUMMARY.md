---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 04
subsystem: api
tags: [express, matrix-synapse-admin, pool-picker, jwt-auth, host-isolation]

# Dependency graph
requires:
  - phase: 80
    provides: getVettedPool loader (Plan 80-01) + countUsersMatching admin primitive (Plan 80-02) + composeMxidLocalpart casing rule (Plan 80-03b)
provides:
  - POST /identities/pool/pick endpoint returning bare lowercase pool name
  - FULL base-handle MXID picker (@<PascalCandidate>-<PascalHyphenatedRole>:<server>) — blocker 2 fix
  - Route mount at /identities/pool BEFORE generic /identities (mount-order landmine 4 preserved)
affects:
  - Plan 80-06 (NewSessionDialog frontend consumes this endpoint for name prefill)
  - Plan 80-03b (birth-orchestrator receives bare lowercase name; re-derives full MXID via composeMxidLocalpart + deriveMxidWithOrdinal at birth)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PascalCase-hyphenated MXID base-handle probe: split kebab-role on '-', uppercase each segment's first char, join with '-'; matches composeMxidLocalpart discipline"
    - "Local duplication of private cross-module regexes (ROLE_NAME_PATTERN) for defense-in-depth; kept synced with identity-birth-orchestrator's ROLE_NAME_RE"
    - "Pool-picker fail-early gate order: JWT → hostId → role → creds (503) → host-ownership (404) → pool (503) → picker"

key-files:
  created:
    - src/backend/pool/pool-routes.ts
    - src/backend/pool/pool-routes.test.ts
  modified:
    - src/backend/database/database.ts

key-decisions:
  - "Duplicated ROLE_NAME_PATTERN locally (not imported from identity-birth-orchestrator) because ROLE_NAME_RE is a private const there. Mirrors identity-birth.ts:63's IDENTITY_KEY_RE local-duplication pattern. Comment documents the sync requirement."
  - "Blocker 2 defense implemented as a per-file grep-gate PLUS positive/negative assertions in Test 10: countUsersMatching call args MUST match /@(Willow|Aster)-Skynet-Maintainer:.../ AND must NOT match /@(willow|aster):/."
  - "Casing-drift normalization applied to pool candidates (Test 14): lowercase entries in pool.json still produce the canonical PascalCase base handle in the probe. Defense-in-depth against pool.json seed drift."

patterns-established:
  - "Full base-handle picker: any handler that asks 'is this Matrix name taken?' must compose the FULL MXID shape the orchestrator would actually mint, not a bare-lowercase surrogate."
  - "Router mount-order comment format: '// Phase XX Plan YY: <what> — mount BEFORE /identities so ...' matches the avatar/birth/clone precedent."

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-09-06
---

# Phase 80 Plan 04: Pool-Pick Backend Endpoint Summary

**POST /identities/pool/pick returns a bare lowercase pool name after probing FULL base-handle MXIDs (@PascalCandidate-PascalHyphenatedRole:server) via countUsersMatching — blocker 2 (bare-lowercase false-negative) permanently gated by grep + test.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-06T14:55:11Z
- **Completed:** 2026-09-06T15:06:38Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Shipped POST /identities/pool/pick with the full gate chain (auth → hostId → role → creds 503 → host-ownership 404 → pool 503 → picker).
- Picker composes FULL PascalCase-hyphenated base-handle MXID (`@Willow-Skynet-Maintainer:matrix.example.com` shape) — the correct "is this taken?" question that matches what birth-orchestrator's composeMxidLocalpart actually mints (A1 DIVERGE lock).
- Response is ALWAYS bare lowercase pool name matching IDENTITY_KEY_RE; orchestrator owns full-handle composition + ordinal derivation at birth time (Shape A per RESEARCH §8).
- 14-case test suite passes; Test 10 is the blocker-2 regression guard asserting call-args match the PascalCase-hyphenated shape and never the bare-lowercase surrogate.
- Route mounted at `/identities/pool` at database.ts:1850, BEFORE the generic `/identities` mount at L1887 (awk ordering gate: 1850 < 1887, exit 0). Existing avatar/birth/clone/exists-on-host mounts unchanged.

## Task Commits

TDD-style per Task 1 (RED test commit → GREEN implementation commit):

1. **Task 1 RED — failing tests for POST /identities/pool/pick** — `cd70e382` (test)
2. **Task 1 GREEN — implement POST /identities/pool/pick router** — `e8b32154` (feat)
3. **Task 2 — mount /identities/pool router before generic /identities** — `c1deb44b` (feat)

## Files Created/Modified

- `src/backend/pool/pool-routes.ts` (**created**, 217 lines) — Express router exporting POST /pick handler. Full auth/creds/host-ownership/pool gates, PascalCase-hyphenated base-handle picker, shuffle + iterate with Math.random once, all-busy fallback returns first shuffled candidate lowercased, generic 500 error handler at router base. Never logs admin token; 502 on countUsersMatching failure without leaking pool state.
- `src/backend/pool/pool-routes.test.ts` (**created**, 438 lines) — 14 test cases covering all validation + gate + happy + fallback + error branches. Test 10 is the blocker-2 regression guard (positive assertion: `@Willow-Skynet-Maintainer:matrix.example.com` shape; negative assertion: NEVER `@willow:matrix.example.com`). Test 13 pins multi-segment role composition (`foo-bar-baz` → `@Willow-Foo-Bar-Baz:...`). Test 14 pins casing-drift defense (lowercase pool entry still probed as `@Willow-...`).
- `src/backend/database/database.ts` (**modified**, +10 lines) — Import for identityPoolRoutes from `../pool/pool-routes.js` (L26-29) + mount `app.use("/identities/pool", identityPoolRoutes)` at L1850, positioned in the /identities/xxx sub-mount block between /identities/clone and /identities existsOnHost mounts. Landmine 4 preservation comment matches the avatar/birth/clone precedent.

## Decisions Made

- **Local duplication of ROLE_NAME_PATTERN (rather than importing ROLE_NAME_RE from identity-birth-orchestrator).** ROLE_NAME_RE is a private const in identity-birth-orchestrator.ts (L517, not exported). Mirrors the local-duplication pattern of IDENTITY_KEY_RE in identity-birth.ts:63. The pool-routes.ts JSDoc for `ROLE_NAME_PATTERN` explicitly documents the sync requirement with identity-birth-orchestrator's ROLE_NAME_RE.
- **`// prettier-ignore` on the router.post line.** Required to keep `router.post("/pick", ...)` on a single line to satisfy the plan's strict grep acceptance criterion `grep -c 'router.post("/pick"' ... == 1`. Prettier would otherwise split it across lines for readability. Behavior-neutral formatting choice.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with the exact behavior, ordering, and acceptance criteria specified in `80-04-PLAN.md`.

## Issues Encountered

- **Initial `router.post("/pick"` grep failure:** After first implementation pass, `grep -c 'router.post("/pick"'` returned 0 because the function signature was split across 5 lines (a common formatting choice for long argument lists). Resolved by collapsing the signature to a single line with a `// prettier-ignore` comment so the strict grep acceptance criterion passes without behavior change. Documented in Decisions Made.

## User Setup Required

None — this plan ships a JWT-gated backend endpoint that reuses the existing matrix-admin creds already ingested by Phase 75. No new env vars, no dashboard config, no external service setup.

## Next Phase Readiness

- **Plan 80-06 (NewSessionDialog frontend)** — ready. Frontend can call `POST /identities/pool/pick` with `{ role, hostId }` and receive `{ name: string }` (bare lowercase, matches IDENTITY_KEY_RE).
- **Plan 80-03b (birth-orchestrator)** — already shipped; consumes bare lowercase pool name from this endpoint via NewSessionDialog and re-derives the full PascalCase-hyphenated MXID + ordinal suffix at birth time via composeMxidLocalpart + deriveMxidWithOrdinal.
- **Ship smoke test** (orchestrator ship-gate, out of executor scope): `curl -X POST -H "Content-Type: application/json" -H "Cookie: <jwt>" -d '{"role":"skynet-maintainer","hostId":1}' http://localhost:PORT/identities/pool/pick` → `{"name":"<lowercase-pool-name>"}`.

## Self-Check: PASSED

- Files created/modified: pool-routes.ts, pool-routes.test.ts, database.ts, 80-04-SUMMARY.md — all present.
- Commits: cd70e382 (test), e8b32154 (feat router), c1deb44b (feat mount) — all present in git log.
- Mount ordering: `app.use("/identities/pool", identityPoolRoutes)` at L1850, before generic `app.use("/identities", identitiesRoutes)` at L1887 (awk gate exit 0).
- Test count: 14 tests, all passing (`npx vitest run src/backend/pool/pool-routes.test.ts` — 14/14 green).
- Backend type-check: `npx tsc -p tsconfig.node.json --noEmit` completed exit 0 (no pool-routes / database.ts errors).

---
*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Completed: 2026-09-06*
