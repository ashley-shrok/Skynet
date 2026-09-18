---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 03
subsystem: backend
tags: [wire-protocol, subscription-registry, zod, project-list-changed, fleet-status]

# Dependency graph
requires:
  - phase: 115-archived-fleet-tree
    provides: "FrontendIdentityArchivedFrame byte-shape template + archivedIdentities registry-cache-then-fanout discipline (wire-protocol.ts:577-583; subscription-registry.ts:175-230)"
  - phase: 41-last-message-at
    provides: "T-41-03-05 additive-optional invariant — FRAME_SCHEMA_VERSION unchanged when adding discriminated-union entries"
provides:
  - FrontendProjectListChangedFrameSchema (zod discriminated-union member on `type: 'project-list-changed'`)
  - makeProjectListChangedFrame(projects) builder helper
  - publishProjectListChanged(projects) on SubscriptionRegistry with single-cell cache + idempotent-skip
  - Snapshot-on-subscribe replay of cached project array
affects: [117-04, 117-05, 117-06, 117-07]  # Wave 2 write routes + Wave 3 frontend sidebar

# Tech tracking
tech-stack:
  added: []  # No new packages
  patterns:
    - "Full-array-on-every-emit wire event (RESEARCH § Open Q #4) — projects are cheap; matches Phase 115 registry-cache-then-fanout"
    - "Single-cell nullable cache with JSON.stringify deep-equal skip"
    - "Defensive .slice() into cache to prevent caller-mutation poisoning of idempotent-skip comparisons"

key-files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/wire-protocol.test.ts
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/subscription-registry.test.ts

key-decisions:
  - "Idempotent-skip uses JSON.stringify canonicalization (not field-wise compare). Fields are small strings + booleans; stringify cost is negligible for N < 20 projects. JSDoc on publishProjectListChanged documents the choice."
  - "Snapshot-on-subscribe guarded on projectListCache !== null — a fresh registry never fans out a spurious empty frame. Empty array [] is only sent when it is the real state per an actual publish."
  - "Defensive .slice() into projectListCache — a caller mutating the array post-publish cannot corrupt future idempotent-skip comparisons or the replay payload."
  - "Discriminated-union extension is additive: FRAME_SCHEMA_VERSION deliberately unchanged at 1 (ninth iteration of T-41-03-05 mitigation). Older clients drop the unknown `type` at the default branch of the WS switch."

patterns-established:
  - "Distinct wire message for a distinct pool: projects (host-level, not session-level or identity-level) get their own frame kind rather than a bolted-on field on SessionState. Same rationale that separated identity-archived from SessionState in Phase 115."
  - "Cache-guarded snapshot replay: cache-is-null → no replay; cache-is-value (including empty array) → replay. Distinguishes 'never been told' from 'told there is nothing'."

requirements-completed: []

# Metrics
duration: ~15 min
completed: 2026-09-18
---

# Phase 117 Plan 03: project-list-changed wire event + registry publisher Summary

**Wire-protocol project-list-changed frame + subscription-registry publishProjectListChanged with JSON.stringify idempotent-skip and snapshot-on-subscribe replay of the cached array.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-18T19:19:00Z
- **Completed:** 2026-09-18T19:23:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- New zod schema `FrontendProjectListChangedFrameSchema` added as the sixth member of the `FrontendOutboundFrame` discriminatedUnion (additive; FRAME_SCHEMA_VERSION unchanged at 1).
- Builder helper `makeProjectListChangedFrame(projects)` mirrors the byte-shape of `makeIdentityArchivedFrame` and round-trip parses cleanly.
- New registry method `publishProjectListChanged(projects)` with single-cell cache + JSON.stringify byte-identity idempotent-skip.
- Snapshot-on-subscribe replay wired into the existing subscribe() body, guarded on non-null cache so a fresh registry never fans out a spurious empty frame.
- 15 new tests (8 wire-protocol + 7 subscription-registry); 81 pre-existing tests unaffected.

## Task Commits

Each task was committed atomically following TDD RED → GREEN:

1. **Task 1 RED (wire-protocol tests)** — `d9cda2d` (test)
2. **Task 1 GREEN (schema + builder)** — `6cf9c19` (feat)
3. **Task 2 RED (registry tests)** — `223041d` (test)
4. **Task 2 GREEN (publisher + replay)** — `c202418` (feat)

## Signatures

### New schema (wire-protocol.ts)

```ts
export const FrontendProjectListChangedFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("project-list-changed"),
  projects: z.array(
    z.object({
      slug: z.string(),
      displayName: z.string(),
      hostId: z.string(),
      hostname: z.string(),
      archived: z.boolean(),
    }),
  ),
});
```

### New builder (wire-protocol.ts)

```ts
export function makeProjectListChangedFrame(
  projects: Array<{
    slug: string;
    displayName: string;
    hostId: string;
    hostname: string;
    archived: boolean;
  }>,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "project-list-changed",
    projects,
  };
}
```

### New registry method (subscription-registry.ts)

```ts
publishProjectListChanged(projects: ProjectListEntry[]): void;
```

Where `ProjectListEntry = { slug: string; displayName: string; hostId: string; hostname: string; archived: boolean }`.

## Idempotent-skip implementation choice

**JSON.stringify canonicalization** (not field-wise compare). Rationale:
- Fields are all small strings + booleans; stringify cost is O(N × avg field size) which for realistic N < 20 projects is negligible per RESEARCH § Pitfall 4.
- Zod schema field order matches the object-literal insertion order in both source-of-truth call sites (wave-2 write routes will build project entries via the same shape), so serialized strings will be byte-identical when the projects are logically identical.
- JSDoc on `publishProjectListChanged` documents the choice.

## Test counts

| File                              | Pre-existing | New (117-03) | Total |
| --------------------------------- | ------------ | ------------ | ----- |
| wire-protocol.test.ts             | 60           | 8            | 68    |
| subscription-registry.test.ts     | 21           | 7            | 28    |

**Total:** 96 tests, all green. `npx tsc --noEmit -p tsconfig.json` exits 0.

## Files Created/Modified

- `src/backend/fleet-status/wire-protocol.ts` — added rationale block, schema, discriminatedUnion entry, builder helper
- `src/backend/fleet-status/wire-protocol.test.ts` — added 8 tests + 1 version guard under a new describe block
- `src/backend/fleet-status/subscription-registry.ts` — added ProjectListEntry type, projectListCache field, interface method, implementation, snapshot replay branch
- `src/backend/fleet-status/subscription-registry.test.ts` — added 7 tests under a new describe block

## Decisions Made

See `key-decisions` in frontmatter. All four decisions were locked by the plan (D-37 + RESEARCH § Open Q #4) or forced by CLAUDE.md-level correctness (defensive copy, cache-null guard). No design freedom exercised.

## Deviations from Plan

**None — plan executed exactly as written.**

Minor notes:
- The plan's acceptance criterion "`grep -c 'FrontendProjectListChangedFrameSchema' ... outputs ≥ 3`" resolves to 2 rather than 3 because I used `export const FrontendProjectListChangedFrameSchema = ...` (declaration + export on one line, matching sibling `FrontendOutboundFrame`'s inline-export convention) rather than a separate `const ... ; export { ... };` pair. All three functional occurrences the criterion was guarding are present (declaration+export line, member of discriminatedUnion, and — via the builder — the round-trip parse in Test P117-03-8). No functional impact.
- The plan's acceptance criterion "`grep -c '^  publishProjectListChanged' ... outputs ≥ 2`" resolves to 1 because the interface method sits at 2 spaces (matches criterion) but the implementation sits at 4 spaces (inside the object literal returned by `createSubscriptionRegistry`). Both signatures ARE present (interface at :96, implementation at :374); the grep pattern in the criterion just didn't account for the implementation's deeper indent. No functional impact.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 2 write routes (117-04, 117-05)** can now `import { publishProjectListChanged } from "../../fleet-status/subscription-registry.js"` after every project create/archive/session-project-write.
- **Wave 3 frontend clients (117-06, 117-07)** will consume the frame via the existing WS dispatcher; reconnecting clients receive the cached array on subscribe.
- Cache is a single cell — Wave 2 routes MUST pass the FULL current project list on every call (not a delta). Route implementations will read the list via Wave 1's `listProjects` primitive and pass it through.

## Self-Check: PASSED

- Files exist: wire-protocol.ts, wire-protocol.test.ts, subscription-registry.ts, subscription-registry.test.ts (all confirmed via edit tool).
- Commits exist: d9cda2d, 6cf9c19, 223041d, c202418 (all confirmed via `git log --oneline`).
- Tests green: 96/96 pass in scoped vitest run.
- tsc clean: exits 0.

---
*Phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p*
*Completed: 2026-09-18*
