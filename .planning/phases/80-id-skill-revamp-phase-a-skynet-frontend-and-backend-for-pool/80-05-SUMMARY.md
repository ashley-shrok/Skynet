---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 05
subsystem: api
tags: [typescript, react, api-client, axios, identity, pool-picker]

# Dependency graph
requires:
  - phase: 80
    provides: Identity.task disk-read (Plan 80-03) + BirthRequest.poolPicked A1 DIVERGE branch (Plan 80-03b) + POST /identities/pool/pick endpoint (Plan 80-04)
provides:
  - Identity.task typed field on the frontend Identity interface (readable type-safely by chat + list surfaces)
  - BirthRequest.task + BirthRequest.poolPicked optional wire fields on the birth-request payload (settable by NewSessionDialog)
  - pickPoolName(role, hostId) API client exported from identities-api.ts (POST /identities/pool/pick)
affects:
  - Plan 80-06 (NewSessionDialog rebuild — consumes pickPoolName + sets BirthRequest.task/poolPicked)
  - Plan 80-07 (task pill on chat surface — reads identity.task)
  - Plan 80-08 (task-primary conversation row — reads identity.task with D-06 fallback)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional wire fields on BirthRequest (task?, poolPicked?) — undefined ⇒ omit from JSON body ⇒ backend treats as unset (legacy MXID shape / no task frontmatter)"
    - "Nullable typed field on Identity (task: string | null) — null preserves fallback for pre-Phase-80 identities per D-06 semantics"
    - "pickPoolName mirrors listRolesForHost shape: authApi.post + try/catch + handleApiError(error, 'pick pool name')"

key-files:
  created: []
  modified:
    - src/ui/api/identities-api.ts

key-decisions:
  - "task typed non-optional (`string | null`) on Identity to force call-site null handling in downstream plans 80-07/08; matches title/voice/role/colorHue precedent."
  - "task and poolPicked typed optional (`?:`) on BirthRequest so pre-Phase-80 code paths (if any hit birth without a task) omit the fields entirely and the backend gets `undefined` at the JSON layer — cleaner than always sending null."
  - "pickPoolName placed immediately after listRolesForHost (the closest analog for a POST-to-identity-scoped-endpoint that returns a small typed object). Groups with the SRIC-02 identity-scope calls; preserves file's chronological ordering."

patterns-established:
  - "Additive-only frontend api-client extensions for phased rollout: new fields marked optional to keep older callers compiling, new typed non-null fields added only when every consumer will be updated in the same phase."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-09-06
---

# Phase 80 Plan 05: Frontend Identity + BirthRequest + pickPoolName Summary

**Four additive changes to `src/ui/api/identities-api.ts` — `Identity.task: string | null`, `BirthRequest.task?: string`, `BirthRequest.poolPicked?: boolean`, and `pickPoolName(role, hostId)` — unblocking plans 80-06/07/08 to consume Phase 80's task-scoped identity model type-safely.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-06T15:09:39Z (approximate — matches STATE.md `last_updated` at plan start)
- **Completed:** 2026-09-06
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `Identity` interface gains `task: string | null` — components on chat + list surfaces can now branch on `identity.task` type-safely (D-06 fallback semantics: null ⇒ fall back to current display).
- `BirthRequest` interface gains optional `task?: string` — NewSessionDialog (plan 80-06) can include a task string in POST `/identities/birth` bodies without breaking any current call site that omits it.
- `BirthRequest` interface gains optional `poolPicked?: boolean` — the A1 DIVERGE wire signal for plan 80-03b's MXID shape decision (true ⇒ backend derives PascalCase-hyphenated `@<PoolName>-<Role>[-N]:<server>` MXID; false/absent ⇒ legacy `@<name>:<server>` MXID for backward compat with manually-typed names and pre-Phase-80 identities).
- New exported `pickPoolName(role, hostId): Promise<{ name: string }>` — POSTs to `/identities/pool/pick` (delivered by plan 80-04); mirrors `listRolesForHost`'s shape (try/catch around `authApi.post`, `handleApiError(error, "pick pool name")` on the catch branch).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add task + poolPicked fields to Identity/BirthRequest interfaces + pickPoolName API** — `aa55ea06` (feat)

## Files Created/Modified

- `src/ui/api/identities-api.ts` — +39 lines: `Identity.task` field + JSDoc (5 lines), `BirthRequest.task` field + JSDoc (2 lines), `BirthRequest.poolPicked` field + JSDoc (7 lines), section banner comment for the new pool-picker function (4 lines), `pickPoolName` function + JSDoc (16 lines).

## Decisions Made

- **`task` typed non-optional on `Identity`, optional on `BirthRequest`.** Rationale: identity-read consumers (chat pill in 80-07, conversation row in 80-08) MUST handle absence explicitly per D-06 fallback semantics; the type system forces them to. Birth-request producers (NewSessionDialog in 80-06) have a legitimate "no task provided" path (though the shape file expects a task field always shown in the modal; the optional typing preserves backwards compat).
- **`poolPicked` typed optional on `BirthRequest` (not nullable).** Absent field ⇒ backend receives `undefined` ⇒ treated identically to `false` ⇒ legacy MXID shape. Cleaner than three-valued (`true` | `false` | `undefined`) semantics; matches the plan's stated wire contract.
- **`pickPoolName` placement.** Grouped immediately after `listRolesForHost` because both are SRIC-scoped GET/POST calls that return small typed objects tied to (role, hostId). Preserves the file's chronological/topical ordering; keeps future readers finding related endpoints together.
- **Section banner comment.** Added a `// ─── Phase 80 Plan 80-05: pool name picker ──` block preceding `pickPoolName`, matching the file's established convention for delimiting phase-added endpoints (see the identically-shaped banners at L207 for Quick 260811-ax1 no-dormancy, L245 for Phase 22 SRIC-02 roles list, L261 for SRIC-03 clone identity, L321 for SRIC-04 create role). Documents the backing route location and consumer.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 1 was marked `tdd="true"` but the plan's own `<verify>` block and objective note ("this is a type-add only, no tests required beyond compile") explicitly waive the RED/GREEN test cycle for this specific plan. No test file was created; the acceptance criteria are grep + `tsc --noEmit` and both pass. This is consistent with the plan's stated success criteria ("Zero TypeScript regressions", "Four additive changes committed").

**Total deviations:** 0
**Impact on plan:** None — additive-only, no behavior touched, no existing code path modified.

## Issues Encountered

None. TypeScript compiled clean on first attempt; all 8 acceptance-criteria greps returned the expected counts (`task: string | null` = 1, `task?: string` = 1, `poolPicked?: boolean` = 1, `export async function pickPoolName` = 1, `"/identities/pool/pick"` = 1, `"pick pool name"` = 1, `identities-api.ts` compile errors = 0, `^export (async function|interface)` count = 18 = baseline 17 + 1 for pickPoolName).

## Threat-Model Verification

Plan's `<threat_model>` items T-80-05-01 (response-shape tampering — mitigated by consumer-side validation in 80-06), T-80-05-02 (XSS via identity.task — deferred to 80-07/08 which render as React text children with auto-escaping), and T-80-05-03 (client claims `poolPicked=true` with manual name — accepted; backend's `composeMxidLocalpart` shape check silently falls back per plan 80-03b) all documented as expected. No new surface introduced beyond the pool-picker endpoint call (which reuses existing `authApi` JWT-cookie auth — no new auth surface).

## User Setup Required

None — no external service configuration; no environment variables added.

## Next Phase Readiness

- **Plan 80-06 (NewSessionDialog rebuild):** unblocked. Can now import `pickPoolName` for name-field prefill and set `BirthRequest.task` + `BirthRequest.poolPicked` on submit.
- **Plan 80-07 (task pill on chat):** unblocked. Can now read `identity.task` type-safely; null-branch renders no pill (D-06).
- **Plan 80-08 (task-primary conversation row):** unblocked. Can now read `identity.task` type-safely; null-branch renders name-primary fallback (D-06).
- No blockers introduced.

## Self-Check: PASSED

- `src/ui/api/identities-api.ts` — FOUND (contains `task: string | null`, `task?: string`, `poolPicked?: boolean`, `export async function pickPoolName`, `"/identities/pool/pick"`, `"pick pool name"`).
- Commit `aa55ea06` — FOUND on `feat/tab-title-from-tmux`.
- `npx tsc --noEmit` — clean (0 errors in identities-api.ts).

---
*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Completed: 2026-09-06*
