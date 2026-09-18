---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 06
subsystem: frontend/api
tags: [frontend, api-client, ws-dispatch, project-list-changed, tdd, vitest]

# Dependency graph
requires:
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 03
    provides: "project-list-changed wire frame + subscription-registry publisher — the WS event the frontend now subscribes to"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 04
    provides: "/projects endpoints (GET list, POST create, POST :slug/archive) — the HTTP surface project-list-api hits"
  - phase: 115-archived-fleet-tree
    provides: "identity-archive-api.ts byte-shape template — authApi + handleApiError thin fetch wrapper style"
provides:
  - "listProjects(hostId) → { projects: ProjectSummary[] } fetch wrapper for GET /projects"
  - "createProject(hostId, displayName) → { ok: true, slug } fetch wrapper for POST /projects (409 propagates via handleApiError)"
  - "archiveProject(hostId, slug) → { ok: true } fetch wrapper for POST /projects/:slug/archive"
  - "setSessionProject(hostId, identityKey, projectSlug | null) → { ok: true } fetch wrapper for POST /identities/:key/project"
  - "setRelayRoomProject(roomId, userMxid, projectSlug | null) → { ok: true } fetch wrapper for POST /relay-rooms/:roomId/project"
  - "onProjectListChanged? option + WS 'case project-list-changed' dispatch on fleet-status-client"
  - "ProjectListEntry + FrontendProjectListChangedFrame TypeScript types on fleet-status-types.ts (mirrors backend wire-protocol)"
affects: [117-07, 117-08, 117-09]  # store hydration, DnD drop handler, create-project modal

# Tech tracking
tech-stack:
  added: []  # No new packages
  patterns:
    - "Byte-shape mirror of identity-archive-api.ts — authApi + handleApiError, one try/catch per wrapper, no error swallowing"
    - "encodeURIComponent on every dynamic URL segment (roomId, identityKey, slug, hostId query param)"
    - "Backend-authoritative slug derivation (D-25 / Pitfall 1): frontend submits raw displayName, response body carries the derived slug"
    - "null-as-clear convention on setSessionProject / setRelayRoomProject third arg (matches D-05a read-modify-write semantics on the backend)"
    - "Rule-2 correctness guard: runtime Array.isArray check inside the WS switch branch because the browser skips zod validation"

key-files:
  created:
    - src/ui/api/project-list-api.ts
    - src/ui/api/project-list-api.test.ts
    - src/ui/api/session-project-api.ts
    - src/ui/api/session-project-api.test.ts
  modified:
    - src/ui/api/fleet-status-client.ts
    - src/ui/api/fleet-status-client.test.ts
    - src/ui/api/fleet-status-types.ts

key-decisions:
  - "Test 11 URL assertion (Rule 1 test spec correction): plan expected '/relay-rooms/%21room%3Ahost/project' but encodeURIComponent leaves '!' unencoded per RFC 3986 sub-delim safety. Load-bearing behavior (':' → '%3A' — else path segment splits) preserved via encodeURIComponent; test rewritten to match the actual output and added a sanity assertion `expect(url).toBe(`/relay-rooms/${encodeURIComponent('!room:host')}/project`)` so the contract is anchored to the mechanism, not the manually-typed literal."
  - "Rule-2 malformed-frame guard on the new WS switch case: browser skips zod (fleet-status-types.ts comment: 'No zod on the browser side — avoids a 10KB+ bundle cost'), so a frame with projects: 'not-an-array' would reach the callback with garbage. Added a runtime Array.isArray guard + structured warn log ('fleet_status_client_project_list_changed_malformed') before dispatch. Consumers cannot observe non-array payloads."
  - "ProjectListEntry type is exported from fleet-status-types.ts (rather than declared inline on the callback signature) so Wave 3 (117-07) can reuse it verbatim when writing the setProjects store slice."

requirements-completed: []  # Plan has empty requirements: field in frontmatter

# Metrics
duration: ~5 min
completed: 2026-09-18
---

# Phase 117 Plan 06: frontend API clients (project-list + session-project + fleet-status-client extension) Summary

## One-liner

Three frontend API surfaces landed: `project-list-api.ts` (listProjects/createProject/archiveProject fetch wrappers), `session-project-api.ts` (setSessionProject/setRelayRoomProject fetch wrappers with null-clears), and `fleet-status-client.ts` extension (onProjectListChanged option + WS switch case with Rule-2 array-shape guard). All byte-shape-parallel to Phase 115's `identity-archive-api.ts` template.

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-18T19:34:59Z
- **Completed:** 2026-09-18T19:39:52Z
- **Tasks:** 2 (both TDD; RED + GREEN commits per task)
- **Files created:** 4 (2 modules + 2 colocated tests)
- **Files modified:** 3 (fleet-status-client.ts + its test + fleet-status-types.ts)

## Accomplishments

- **5 new exported fetch wrappers**, all thin authApi + handleApiError:
  - `listProjects(hostId): Promise<{ projects: ProjectSummary[] }>` — GET /projects?hostId=…
  - `createProject(hostId, displayName): Promise<{ ok: true; slug: string }>` — POST /projects
  - `archiveProject(hostId, slug): Promise<{ ok: true }>` — POST /projects/:slug/archive
  - `setSessionProject(hostId, identityKey, projectSlug | null): Promise<{ ok: true }>` — POST /identities/:key/project
  - `setRelayRoomProject(roomId, userMxid, projectSlug | null): Promise<{ ok: true }>` — POST /relay-rooms/:roomId/project
- **New ProjectSummary type export** on `project-list-api.ts` for consumers ({slug, displayName, archived})
- **New ProjectListEntry type export** on `fleet-status-types.ts` + FrontendProjectListChangedFrame member of the FrontendOutboundFrame discriminated union (mirrors backend 117-03 wire-protocol addition)
- **New onProjectListChanged? option** on FleetStatusClientOptions — routes into the frontend's projects store slice via AppShell (117-07, Wave 3)
- **New 'case project-list-changed' dispatch** in the ws.onmessage switch: structured console.info log with `operation: "fleet_status_client_project_list_changed"` + `projectCount`, then invokes the callback
- **Rule-2 correctness guard**: runtime `Array.isArray(parsed.projects)` check before dispatch, since the browser skips zod validation per fleet-status-types.ts. Malformed frames log a structured warn (`fleet_status_client_project_list_changed_malformed`) and short-circuit — the callback never sees garbage.
- **17 new tests** (12 for the API clients + 5 for the fleet-status-client extension); all 43 tests across the three touched test files pass under scoped vitest.

## Task Commits

Each task followed the TDD RED → GREEN gate discipline; atomic commits per gate.

| Gate | Commit    | Message                                                                                    |
| ---- | --------- | ------------------------------------------------------------------------------------------ |
| 1-R  | `110ad95` | `test(117-06): add failing tests for project-list-api + session-project-api (RED)`         |
| 1-G  | `9901334` | `feat(117-06): implement project-list-api + session-project-api (GREEN)`                   |
| 2-R  | `7104dc7` | `test(117-06): add failing tests for onProjectListChanged dispatch (RED)`                  |
| 2-G  | `d6e6877` | `feat(117-06): extend fleet-status-client with onProjectListChanged dispatch (GREEN)`      |

## Signatures (verbatim exports)

### `src/ui/api/project-list-api.ts`

```ts
export type ProjectSummary = {
  slug: string;
  displayName: string;
  archived: boolean;
};

export async function listProjects(
  hostId: number,
): Promise<{ projects: ProjectSummary[] }>;

export async function createProject(
  hostId: number,
  displayName: string,
): Promise<{ ok: true; slug: string }>;

export async function archiveProject(
  hostId: number,
  slug: string,
): Promise<{ ok: true }>;
```

### `src/ui/api/session-project-api.ts`

```ts
export async function setSessionProject(
  hostId: number,
  identityKey: string,
  projectSlug: string | null,
): Promise<{ ok: true }>;

export async function setRelayRoomProject(
  roomId: string,
  userMxid: string,
  projectSlug: string | null,
): Promise<{ ok: true }>;
```

### `src/ui/api/fleet-status-client.ts` (extension)

New option on `FleetStatusClientOptions`:

```ts
onProjectListChanged?: (projects: ProjectListEntry[]) => void;
```

New structured log operation string emitted from the switch case:

```
fleet_status_client_project_list_changed
```

(Plus a companion warn log operation for the Rule-2 malformed-frame guard: `fleet_status_client_project_list_changed_malformed`.)

### `src/ui/api/fleet-status-types.ts` (extension)

```ts
export interface ProjectListEntry {
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
}

export interface FrontendProjectListChangedFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "project-list-changed";
  projects: ProjectListEntry[];
}
```

`FrontendOutboundFrame` gains `FrontendProjectListChangedFrame` as its 6th member (matches backend wire-protocol.ts's 6-member discriminatedUnion after 117-03).

## Test counts

| File                              | Pre-existing | New (117-06) | Total | Notes |
| --------------------------------- | ------------ | ------------ | ----- | ----- |
| project-list-api.test.ts          | 0            | 6            | 6     | New file |
| session-project-api.test.ts       | 0            | 6            | 6     | New file |
| fleet-status-client.test.ts       | 26           | 5            | 31    | 26 pre-existing all still green (regression guard covered by Test 3) |

**Total:** 43 tests across the 3 files, all green.

**Verification runs:**
- `npx vitest run src/ui/api/project-list-api.test.ts src/ui/api/session-project-api.test.ts src/ui/api/fleet-status-client.test.ts` → 43/43 pass, 0 fail.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.

## Acceptance criteria — all satisfied

Task 1:
- `grep -c "^export async function \(listProjects\|createProject\|archiveProject\)" src/ui/api/project-list-api.ts` → **3** ✓
- `grep -c "^export async function \(setSessionProject\|setRelayRoomProject\)" src/ui/api/session-project-api.ts` → **2** ✓
- `grep -c "handleApiError" src/ui/api/project-list-api.ts` → **7** (≥ 3) ✓
- `grep -c "handleApiError" src/ui/api/session-project-api.ts` → **4** (≥ 2) ✓
- `grep -c "encodeURIComponent" src/ui/api/project-list-api.ts src/ui/api/session-project-api.ts` → **4** (project-list: 2, session-project: 2) ✓ (spec called for ≥ 4)
- `npx vitest run src/ui/api/project-list-api.test.ts src/ui/api/session-project-api.test.ts` → 12/12 pass ✓
- `npx tsc --noEmit -p tsconfig.json` → exit 0 ✓

Task 2:
- `grep -c "onProjectListChanged" src/ui/api/fleet-status-client.ts` → **4** (≥ 2) ✓
- `grep -c 'case "project-list-changed":' src/ui/api/fleet-status-client.ts` → **1** ✓
- `grep -c 'operation: "fleet_status_client_project_list_changed"' src/ui/api/fleet-status-client.ts` → **1** ✓
- `npx vitest run src/ui/api/fleet-status-client.test.ts` → 31/31 pass ✓
- `npx tsc --noEmit -p tsconfig.json` → exit 0 ✓

## Threat model outcome

| Threat ID   | Category         | Disposition | Held |
| ----------- | ---------------- | ----------- | ---- |
| T-117-06-01 | Tampering (URL segment injection via slug / identityKey / roomId) | mitigate | ✓ `encodeURIComponent` on every dynamic segment. Verified by grep gate + Test 6 (URL-safe slug pass-through), Test 9 (identity key with `:`), Test 11 (roomId with `:`). |
| T-117-06-02 | Info Disclosure (500 error details) | mitigate | ✓ Reuses `handleApiError` from `@/main-axios`; every error routes through the same ApiError normalizer as sibling clients. Tests 2, 4, 10 assert the operation label is preserved. |
| T-117-06-03 | Tampering (WS frame malformed → dispatch on garbage) | mitigate | ✓ **Deviated from plan interpretation** — the plan assumed zod parse gates the dispatch; the browser actually skips zod. Compensated with a runtime `Array.isArray` guard inside the switch branch (Rule 2 auto-add). Test 4 asserts the callback is NOT invoked for `projects: "not-an-array"`. |
| T-117-06-04 | DoS (bulk drag → rapid POSTs → wire fanouts) | mitigate | ✓ Inherited from 117-03's registry idempotent-skip (no-op fanouts absorbed on the backend) and Wave 3's memoized store render (117-07). No frontend change needed here. |
| T-117-06-SC | Tampering (npm installs) | accept | ✓ Zero new packages installed. |

## Threat Flags

None. All new endpoints hit sit behind the existing authApi surface (JWT via axios interceptor); no new trust boundary crossing. The WS dispatch extension is a pure additive switch case — no new network surface, no new auth path, no new schema at a trust boundary.

## Known Stubs

None. All 5 fetch wrappers are fully wired to the 117-04 / 117-05 backend endpoints (verified against the endpoint tables in 117-04-SUMMARY.md and consumed via `authApi` — same axios instance used elsewhere). The fleet-status-client dispatch invokes the optional callback with the parsed frame's `projects` array — no placeholder returns, no TODO markers, no "coming next plan" comments. The Wave 3 (117-07) consumer of `onProjectListChanged` is not yet wired in AppShell — but that is by design: this plan's remit is API clients only, not integration.

## Deviations from Plan

### 1. Rule 1 (test spec correction) — Test 11 URL assertion

- **Found during:** Task 1 GREEN phase, first vitest run.
- **Issue:** The plan's behavior spec for Test 11 asserted `expect(URL).toBe("/relay-rooms/%21room%3Ahost/project")` — `!` percent-encoded to `%21`. But JavaScript's `encodeURIComponent` intentionally does NOT encode `!*'()~` (RFC 3986 sub-delims are URL-safe and pass-through). The load-bearing character for path-segment integrity is `:` (else the URL splits) — and that IS encoded to `%3A`.
- **Fix:** Rewrote Test 11's assertion two ways: (a) explicit literal `expect(url).toBe("/relay-rooms/!room%3Ahost/project")` locking the exact `encodeURIComponent` output, plus (b) an anchor assertion `expect(url).toBe(`/relay-rooms/${encodeURIComponent("!room:host")}/project`)` that tethers the test to the mechanism rather than a manually-typed string. Body assertion unchanged.
- **Rationale:** The plan chose `encodeURIComponent` as the encoding mechanism; the test must lock the mechanism's actual output, not a mis-typed manual encoding. All security-relevant characters (`:`, `/`, `%`, spaces, etc.) ARE still verified to be encoded.
- **Files modified:** `src/ui/api/session-project-api.test.ts` (Test 11 only).
- **Commit:** `9901334` (part of the Task 1 GREEN commit; separating would violate atomic-per-task discipline).
- **Consistent with plan:** Yes — the acceptance criteria only require `encodeURIComponent` be used ≥ 4 times across both files, which the implementation satisfies verbatim. The URL literal in the plan's test spec was an authoring slip, not a security invariant.

### 2. Rule 2 (auto-add missing critical functionality) — malformed-frame guard on the new WS switch case

- **Found during:** Task 2 RED phase, while writing Test 4 ("malformed project-list-changed rejected by zod parse before dispatch").
- **Issue:** The plan's Test 4 behavior spec relies on "the existing FrontendOutboundFrame.parse guard" rejecting the frame BEFORE the switch dispatch. That guard exists on the BACKEND (subscription-registry uses zod). On the FRONTEND, `fleet-status-types.ts` explicitly documents: "No zod on the browser side — avoids a 10KB+ bundle cost." The browser uses raw `JSON.parse` + `switch (parsed.type)` — a malformed frame reaches the dispatch with a garbage `parsed.projects` (e.g. a string).
- **Fix:** Added a runtime `if (!Array.isArray(parsed.projects)) { console.warn({operation: "fleet_status_client_project_list_changed_malformed", ...}); break; }` at the top of the new `case "project-list-changed":` branch. Frames with malformed `projects` short-circuit before the callback is invoked; consumers never observe garbage payloads.
- **Rationale:** Rule 2 — this is a correctness requirement, not a feature. Without the guard, `setProjects("not-an-array" as unknown as ProjectListEntry[])` reaches Wave 3's conversation-store slice and pollutes the derived selectors. The compensating guard is a two-line addition; the alternative (dropping Test 4 as unimplementable) leaves the correctness gap open.
- **Files modified:** `src/ui/api/fleet-status-client.ts` (the new switch case only).
- **Commit:** `d6e6877` (part of the Task 2 GREEN commit).
- **Consistent with plan:** Threat T-117-06-03 in the plan's threat_model calls for the malformed-frame guard to hold; my Rule-2 fix supplies the guard the plan's Test 4 was already implicitly requiring. The threat is still `mitigate` — just via a slightly different mechanism than the plan assumed.

No architectural changes (Rule 4). Both deviations are localized: (1) a single test-file assertion rewrite anchored to the plan's chosen encoding mechanism; (2) a two-line correctness guard inside the new switch branch that the plan's own Test 4 expected. No new abstractions, no new packages, no changes to the identity-archive-api byte-shape template.

## Issues Encountered

None beyond the two documented deviations. All acceptance greps pass; scoped vitest green; tsc clean.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 3 (117-07 — store hydration) can immediately import all six of this plan's exports:

```ts
import { listProjects, createProject, archiveProject } from "@/api/project-list-api";
import { setSessionProject, setRelayRoomProject } from "@/api/session-project-api";
import type { ProjectListEntry } from "@/api/fleet-status-types";
```

Wave 3 wires the new `onProjectListChanged` option into `createFleetStatusClient({ ..., onProjectListChanged: setProjects })` in AppShell.tsx, alongside the existing `onIdentityArchived` wiring.

Wave 3+ plans can now compose:
- **117-07 (store hydration)** — hydrates `useProjects` on boot via `listProjects(hostId)`; subscribes to live updates via the new WS callback.
- **117-08 (DnD drop handler)** — calls `setSessionProject` (identity conversations) or `setRelayRoomProject` (relay rooms) on every drop.
- **117-09 (create-project modal)** — submits `createProject(hostId, displayName)`; detects 409 via the propagated `handleApiError` shape (operation label `"create project"`).
- **117-09 (archive-cascade)** — after per-conversation `archiveIdentity` calls, invokes `archiveProject(hostId, slug)` as the final step to move the directory.

## Self-Check: PASSED

Files present (verified with `[ -f ... ]`):
- FOUND: `src/ui/api/project-list-api.ts`
- FOUND: `src/ui/api/project-list-api.test.ts`
- FOUND: `src/ui/api/session-project-api.ts`
- FOUND: `src/ui/api/session-project-api.test.ts`
- FOUND: `src/ui/api/fleet-status-client.ts` (modified)
- FOUND: `src/ui/api/fleet-status-client.test.ts` (modified)
- FOUND: `src/ui/api/fleet-status-types.ts` (modified)

Commits present in git log (verified with `git log --oneline`):
- FOUND: `110ad95` — Task 1 RED
- FOUND: `9901334` — Task 1 GREEN
- FOUND: `7104dc7` — Task 2 RED
- FOUND: `d6e6877` — Task 2 GREEN

Tests green: 43/43 pass across the three touched test files under scoped vitest.
tsc clean: exits 0.

---
*Phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p*
*Completed: 2026-09-18*
