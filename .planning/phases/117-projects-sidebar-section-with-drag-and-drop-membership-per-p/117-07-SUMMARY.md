---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 07
subsystem: frontend/state + backend/identity-emitter + backend/relay-room-hydration
tags: [frontend, store, projects, derived-selector, identity-project-field, relay-room-hydration, tdd, vitest]

# Dependency graph
requires:
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 06
    provides: "listProjects/createProject/archiveProject + fleet-status-client onProjectListChanged option + ProjectListEntry type"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 03
    provides: "publishProjectListChanged wire event + FrontendProjectListChangedFrame"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 02
    provides: "getRoomTags + setRoomProjectTag on matrix-room-tag-client.ts"
  - phase: 115-archived-fleet-tree
    provides: "archivedFleetRows slice byte-shape template at conversation-store.ts:391-432 + :1888-1967"
provides:
  - "ProjectRow type + state.projects slice + setProjects/useProjects hook on conversation-store.ts"
  - "identityProjectAssignments/roomProjectAssignments maps + their setters"
  - "Projects-derived selector emitting {pinnedUnassigned, projectSections, rdp} in the ConversationList snapshot"
  - "useCollapsedProjectSlugs hook — localStorage-backed per-project collapse state (D-40)"
  - "AppShell onProjectListChanged wiring + boot-time listProjects + listRelayRoomProjectTags hydration"
  - "Backend Identity project field surface (extractCosmeticsFromFrontmatter + resolveIdentityAppearance + publicIdentity + frontend Identity type)"
  - "GET /relay-rooms/project-tags?hostId=<n> endpoint — boot-time enumerator for u.project.<slug> account_data"
  - "listRelayRoomProjectTags(hostId) fetch wrapper on project-list-api.ts"
affects: [117-08, 117-09]  # Wave 4 sidebar reads projectSections; Wave 4 modal reads useProjects; Wave 4 chevrons drive useCollapsedProjectSlugs

# Tech tracking
tech-stack:
  added: []  # No new packages
  patterns:
    - "Byte-shape mirror of archivedFleetRows slice at conversation-store.ts:391-432 + :1888-1967 (setter identity-equal skip + useSyncExternalStore hook)"
    - "localStorage hydrate/persist pattern from ACTIVE_SET_STORAGE_KEY (:270-330) — silent try/catch, empty-Set fallback, non-string entry filter"
    - "Additive extension of ConversationList snapshot shape (new fields — old fields preserved) so pre-Phase-117 consumers keep working"
    - "Backend-authoritative slug via publicIdentity emitter — frontend Identity.project surfaces the raw slug, projects-derived selector filters dangling refs via D-07"
    - "Partial-hydration discipline on relay-room-project-tags-list — per-room getRoomTags AdminErr is logged + skipped, does NOT abort the whole scan"
    - "Two-source setProjects: boot-time listProjects AND wire event onProjectListChanged funnel through the same setter — identity-equal skip absorbs the redundant emit"

key-files:
  created:
    - src/ui/state/conversation-store.projects.test.ts
    - src/ui/state/use-collapsed-project-slugs.ts
    - src/ui/state/use-collapsed-project-slugs.test.ts
    - src/backend/database/routes/relay-room-project-tags-list.ts
    - src/backend/database/routes/relay-room-project-tags-list.test.ts
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/identities-store.ts
    - src/ui/AppShell.tsx
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/fleet-status/identity-appearance.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/database.ts
    - src/ui/api/identities-api.ts
    - src/ui/api/project-list-api.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/state/identities-store.enrichment.test.ts
    # Fixture-only project:null additions (14 test files):
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
    - src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
    - src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx
    - src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx
    - src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx
    - src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx
    - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx
    - src/ui/features/pretty-view/PrettyView.task-pill.test.tsx
    - src/ui/features/pretty-view/RelayInboundBubble.test.tsx
    - src/ui/features/pretty-view/RelayInboundBubble.speak.test.tsx
    - src/ui/features/pretty-view/relay-mxid-resolve.test.ts
    - src/ui/features/terminal/IdentityBadge.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx

key-decisions:
  - "Additive extension of ConversationList (new pinnedUnassigned/projectSections/rdp fields; pinned/middle/rdpGroup preserved) rather than a breaking rewrite — Wave 4 sidebar switches; existing Phase 41+ tests keep passing verbatim."
  - "Frontend Identity.project is NON-optional (string | null) matching plan's spec — required patching 14 pre-existing test-file Identity fixtures. Rationale: matches the backend emitter's always-emit posture (publicIdentity emits null when the field is absent on disk); optional-with-fallback would soften the type contract for no gain."
  - "Wire schema IdentityAppearanceSchema in wire-protocol.ts NOT extended with project this plan. Rationale: adding a field to the zod schema at a wire boundary is a schema-version-bump risk (per the 8-iteration held-at-1 T-41-03-05 discipline in wire-protocol.ts:355-364), and the wire-side path is a secondary source — GET /identities is the authoritative source for the identityProjectAssignments map. If Wave 4 needs the wire-side push for tighter freshness, a follow-up plan handles the additive schema extension."
  - "middle field returns rows-without-project (D-39 semantics) — but state.projects starts empty on boot, so pre-Phase-117 code paths see middle unchanged (all non-pinned non-RDP rows). Backward-compat holds naturally; no explicit guard needed."
  - "relay-room-project-tags-list emits partial hydration on per-room Matrix errors (logged, skipped) rather than fail-closed on any single hiccup. Rationale: an unreachable Matrix homeserver on one room shouldn't blank the entire sidebar's project bucketing."

requirements-completed: []  # Plan has empty requirements: field in frontmatter

# Metrics
duration: ~31 min
completed: 2026-09-18
---

# Phase 117 Plan 07: frontend store slice + derived selector + backend Identity project field + relay-room hydration Summary

## One-liner

Store slice + derived selector land alongside two backend extensions: (1) the frontend Identity type gains a `project: string | null` field surfaced through publicIdentity → identity-appearance → identity-artifact-reader (Fix 2 gates 5a/5b/5c/5d); (2) a new GET /relay-rooms/project-tags endpoint walks Matrix account_data to hydrate roomProjectAssignments at boot (Fix 1 gate — D-05 relay-room carrier is NOT deferred). AppShell wires both the WS event + boot hydration through a single setProjects funnel.

## Performance

- **Duration:** ~31 min
- **Started:** 2026-09-18T19:53:35Z
- **Completed:** 2026-09-18T20:24:13Z
- **Tasks:** 3 (Task 1 + 2 both TDD RED+GREEN; Task 3 GREEN-only, integration-shaped)
- **Files created:** 5 (1 hook + 2 tests + 1 backend route + its test)
- **Files modified:** 26 (11 primary + 14 fixture-only Identity{project:null} adds + AppShell)
- **Commits:** 5 total across all 3 tasks

## Accomplishments

### Task 1 — store slice + derived selector + backend Identity project + relay-room hydration endpoint

- **New `ProjectRow` type** on conversation-store.ts:
  ```ts
  export type ProjectRow = {
    slug: string;
    displayName: string;
    hostId: string;
    hostname: string;
    archived: boolean;
  };
  ```

- **New state slice** (three new fields on the `State` type):
  - `projects: ProjectRow[]` — backend-authoritative list.
  - `identityProjectAssignments: Map<string, string>` — keyed on `${hostId}::${identityKey}`.
  - `roomProjectAssignments: Map<string, string>` — keyed on Matrix roomId.

- **Three new setters** (all identity-equal-skip, byte-shape parallel to `setArchivedFleetRows`):
  - `setProjects(rows: readonly ProjectRow[]): void`
  - `setIdentityProjectAssignments(map: ReadonlyMap<string, string>): void`
  - `setRoomProjectAssignments(map: ReadonlyMap<string, string>): void`

- **New `useProjects` hook** via `useSyncExternalStore`.

- **`ConversationList` type extended** with three new fields (additive — pre-Phase-117 `pinned/middle/rdpGroup` fields preserved for backward-compat):
  ```ts
  pinnedUnassigned: ConversationRow[];
  projectSections: Array<{ slug: string; displayName: string; rows: ConversationRow[] }>;
  rdp: HostGroup | null;
  ```

- **Derived selector inside `computeSnapshot`** implements every locked semantic:
  - **D-19 pinning contextual scope**: pinned + no project → pinnedUnassigned; pinned + in-project → top of that section.
  - **D-15 alphabetical by displayName**: sections sorted by displayName (NOT slug); rows within sorted by displayName.
  - **D-16 rowDisplayName** helper resolves per conversation kind (identity displayName from identitiesByKey, relay-room roomTitle).
  - **D-07 graceful degradation**: dangling slug (assignment points to nonexistent project) → row falls to middle.
  - **D-08 RDP exclusion** defense-in-depth: `row.rdpHostRow === true` short-circuits to null assignment.
  - **D-11 empty sections still emit**: every project in `state.projects` gets a section, even with zero rows.

### Task 1 — Backend Identity project field (Fix 2 gates 5a/5b/5c/5d)

- **5a — `identity-artifact-reader.ts::extractCosmeticsFromFrontmatter`** extended:
  - Return type gains optional `project?: string`.
  - Narrowing body adds `if (typeof src.project === "string" && src.project.length > 0) out.project = src.project;` — permissive per plan (PROJECT_SLUG_RE strict check lives at the WRITE path in 117-01).

- **5b — `identity-appearance.ts::RawCosmetics` + `ResolvedIdentityAppearance`** extended:
  - Both types gain `project?: string` / `project: string | null` respectively.
  - `resolveIdentityAppearance` returns `project = typeof cosmetics.project === "string" ? cosmetics.project : null` — NOT inherited from role (same discipline as `task` per D-05).

- **5c — `identities.ts::publicIdentity`** extended:
  - `cosmetics` parameter type gains optional `project?: string`.
  - Return object surfaces `project: resolved.project` alongside `task`.

- **5d — Frontend `Identity` interface at identities-api.ts** extended:
  - Non-optional `project: string | null;` — matches backend emitter's always-emit posture.
  - `identities-store.ts` append + cache round-trip preserve the field.

### Task 1 — Relay-room project-tag hydration endpoint (Fix 1 gate — D-05 relay-room carrier)

- **New `src/backend/database/routes/relay-room-project-tags-list.ts`**:
  - Route: `GET /relay-rooms/project-tags?hostId=<n>` — JWT-gated, host-isolation-gated (404 on cross-user), mxid-defense-gated (403 on legacy no-mxid user).
  - Walks `getUserJoinedRooms(callerMxid)` (from matrix-admin-client), then per-room `getRoomTags(callerMxid, roomId)` (from matrix-room-tag-client).
  - Filters tag keys matching `u.project.<slug>` prefix; emits `{roomId, slug}` pairs.
  - **Partial-hydration discipline**: per-room AdminErr is logged as warn and skipped (does NOT abort the whole scan).
  - Response shape: `{ assignments: Array<{roomId: string, slug: string}> }`.
  - 6 tests all green (happy path, empty rooms, cross-user 404, per-room error skipped, unauth 401, legacy-no-mxid 403).

- **Mounted at `/relay-rooms` in database.ts** — chains cleanly with 117-05's `/:roomId/project` write route (non-overlapping sub-paths).

- **Frontend `listRelayRoomProjectTags(hostId)` fetch wrapper** on project-list-api.ts.

### Task 2 — useCollapsedProjectSlugs hook (D-40)

- **New `src/ui/state/use-collapsed-project-slugs.ts`**:
  ```ts
  export function useCollapsedProjectSlugs(): {
    collapsed: ReadonlySet<string>;
    toggle: (slug: string) => void;
  };
  ```
- **Storage key** literal: `"pv-collapsed-project-slugs"` (locked; Wave 4 UI cross-references it).
- **Silent try/catch on every read + write** — mobile Safari private mode + quota-exceeded browsers do NOT crash the sidebar.
- **`toggle(slug)`**: in-memory state updates even when persist throws (test 8 asserts).
- 8 tests all green (empty hydrate, valid JSON, corrupt JSON silent, non-array silent, non-string filter, add+persist, remove+persist, setItem-throw silent).

### Task 3 — AppShell wiring

- **`onProjectListChanged: (projects) => setProjects(projects)`** added to `createFleetStatusClient({...})` options block alongside `onIdentityArchived`.

- **Boot-time hydration `useEffect` keyed on `allHosts`**:
  - `Promise.all(hosts.map(listProjects))` — aggregates the per-host `{projects}` into a flat `ProjectRow[]` (enriched with hostId + hostname) and calls `setProjects`.
  - `Promise.all(hosts.map(listRelayRoomProjectTags))` — aggregates the per-host `{assignments}` into a `Map<roomId, slug>` (dedupe last-write-wins on roomId since Matrix rooms are fleet-wide) and calls `setRoomProjectAssignments`.
  - Cancellation flag guards against late writes on unmount.
  - Per-host `try/catch` returns `[]` on failure — partial hydration is better than nothing.

- **Fix 1 gate held**: `grep -c "listRelayRoomProjectTags" src/ui/AppShell.tsx` returns 4 — relay-room hydration is NOT deferred, both endpoint + boot-time hydration land in this plan.

## Task Commits

Each task followed the TDD RED → GREEN gate discipline for Tasks 1 + 2; Task 3 is GREEN-only (integration wiring, no meaningful TDD split).

| Gate | Commit    | Message                                                                                                                                                                                                              |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-R  | `053e89e` | `test(117-07): add failing tests for projects slice + derived selector + relay-room-project-tags-list (RED)`                                                                                                         |
| 1-G  | `784ca68` | `feat(117-07): implement ProjectRow slice + derived selector + Identity project field + relay-room-project-tags-list (GREEN)`                                                                                        |
| 2-R  | `0ed9fde` | `test(117-07): add failing tests for useCollapsedProjectSlugs hook (RED)`                                                                                                                                            |
| 2-G  | `8781d9d` | `feat(117-07): implement useCollapsedProjectSlugs hook (GREEN)`                                                                                                                                                      |
| 3-G  | `9ac1cf9` | `feat(117-07): wire AppShell — onProjectListChanged + boot-time projects/relay-tags hydration (GREEN)`                                                                                                               |

## Signatures (verbatim exports)

### `src/ui/state/conversation-store.ts` (extensions)

```ts
export type ProjectRow = {
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
};

export function setProjects(rows: readonly ProjectRow[]): void;
export function useProjects(): readonly ProjectRow[];

export function setIdentityProjectAssignments(
  map: ReadonlyMap<string, string>,
): void;

export function setRoomProjectAssignments(
  map: ReadonlyMap<string, string>,
): void;

export function __resetProjectsForTest(): void;
```

`ConversationList` gains three new fields (see key-decisions for the additive-extension rationale):

```ts
export type ConversationList = {
  // ...pre-Phase-117 fields preserved (activeSet, pinned, middle, rdpGroup)...
  pinnedUnassigned: ConversationRow[];
  projectSections: Array<{
    slug: string;
    displayName: string;
    rows: ConversationRow[];
  }>;
  rdp: HostGroup | null;
};
```

### `src/ui/state/use-collapsed-project-slugs.ts` (new)

```ts
export function useCollapsedProjectSlugs(): {
  collapsed: ReadonlySet<string>;
  toggle: (slug: string) => void;
};
```

### `src/ui/api/project-list-api.ts` (extension)

```ts
export async function listRelayRoomProjectTags(
  hostId: number,
): Promise<{ assignments: Array<{ roomId: string; slug: string }> }>;
```

### Backend Identity project field surface (Fix 2 gates)

- `identity-artifact-reader.ts::extractCosmeticsFromFrontmatter` → return type gains `project?: string`; body adds narrowing branch.
- `identity-appearance.ts::RawCosmetics` gains `project?: string`; `ResolvedIdentityAppearance` gains `project: string | null`.
- `identities.ts::publicIdentity` → parameter type gains `project?: string`; return object emits `project: resolved.project`.
- Frontend `Identity` interface at identities-api.ts:34 gains `project: string | null;` (non-optional).

### Backend relay-room hydration endpoint (Fix 1 gate)

- New route: `GET /relay-rooms/project-tags?hostId=<n>` → `{ assignments: Array<{roomId: string, slug: string}> }`.
- Mounted in `database.ts` under `/relay-rooms` alongside 117-05's `/:roomId/project` write route.

## Test counts

| File                                                     | Pre-existing | New (117-07) | Total | Notes                                    |
| -------------------------------------------------------- | ------------ | ------------ | ----- | ---------------------------------------- |
| conversation-store.projects.test.ts                      | 0            | 12           | 12    | New file — projects slice + selector     |
| use-collapsed-project-slugs.test.ts                      | 0            | 8            | 8     | New file — hook                          |
| relay-room-project-tags-list.test.ts                     | 0            | 6            | 6     | New file — backend route                 |
| conversation-store.test.ts                               | 130          | 0            | 130   | Regression guard — all still green       |
| identities-store.enrichment.test.ts                      | ~30          | 0            | ~30   | Regression guard (project: null fixture) |
| identity-appearance.test.ts                              | 33           | 0            | 33    | Regression guard — project field added   |
| identities.get-disk.test.ts                              | 40           | 0            | 40    | Regression guard                         |
| AppShell.persistence.test.tsx                            | 13           | 0            | 13    | Regression guard — wiring untouched      |
| 14 Identity fixture-only test files (IdentityModal, etc) | 244          | 0            | 244   | Regression guards — project:null fixture add |

**Total scoped verification: 525 tests across 25 test files, all green.**

**Verification runs:**
- `npx vitest run <scoped list>` — 525/525 pass, 0 fail.
- `npx tsc --noEmit -p tsconfig.app.json` — 561 errors (all pre-existing; base was 603 — we IMPROVED the tsc error count by 42 through adding missing Identity fixtures).

## Acceptance criteria — all satisfied

### Task 1

- `grep -c "^export type ProjectRow" src/ui/state/conversation-store.ts` → **1** ✓
- `grep -c "^export function \(setProjects\|useProjects\)" src/ui/state/conversation-store.ts` → **2** ✓
- `grep -c "^  projects:" src/ui/state/conversation-store.ts` → **2** (State type + initial state) ✓
- `grep -c "projectSections" src/ui/state/conversation-store.ts` → **10** (≥ 2) ✓

Backend Identity project (Fix 2 gates):
- `grep -c "project?: string" src/backend/claude-session/identity-artifact-reader.ts` → **2** (≥ 1) ✓
- `grep -n "out.project = src.project" src/backend/claude-session/identity-artifact-reader.ts` → **1 line** (≥ 1) ✓
- `grep -c "project" src/backend/fleet-status/identity-appearance.ts` → **12** (≥ 2) ✓
- `grep -c "project: resolved.project\|project?: string" src/backend/database/routes/identities.ts` → **2** (≥ 1) ✓
- `grep -c "^  project: string \| null" src/ui/api/identities-api.ts` → **1** ✓

Relay-room-project-tags-list endpoint (Fix 1 gate):
- `grep -c '"/project-tags"\|/relay-rooms/project-tags' src/backend/database/routes/relay-room-project-tags-list.ts` → **3** (≥ 1) ✓
- `grep -c "relayRoomProjectTagsListRoutes\|relay-room-project-tags-list" src/backend/database/database.ts` → **2** (≥ 2) ✓
- `npx vitest run src/backend/database/routes/relay-room-project-tags-list.test.ts` → 6/6 pass ✓

Test 10 + Test 11 both green — identity project assignment AND relay-room project assignment paths both proven ✓

`npx vitest run src/ui/state/conversation-store.projects.test.ts src/ui/state/conversation-store.test.ts` → 142/142 pass ✓

### Task 2

- `grep -c "^export function useCollapsedProjectSlugs" src/ui/state/use-collapsed-project-slugs.ts` → **1** ✓
- `grep -c 'COLLAPSED_PROJECT_SLUGS_STORAGE_KEY = "pv-collapsed-project-slugs"' src/ui/state/use-collapsed-project-slugs.ts` → **1** ✓
- `grep -c "try\|catch" src/ui/state/use-collapsed-project-slugs.ts` → **9** (≥ 2) ✓
- `npx vitest run src/ui/state/use-collapsed-project-slugs.test.ts` → 8/8 pass ✓

### Task 3

- `grep -c "onProjectListChanged" src/ui/AppShell.tsx` → **2** (≥ 1) ✓
- `grep -c "setProjects\|listProjects\|listRelayRoomProjectTags\|setRoomProjectAssignments" src/ui/AppShell.tsx` → **18** (≥ 5) ✓
- `grep -c "listRelayRoomProjectTags" src/ui/AppShell.tsx` → **4** (≥ 1, Fix 1 gate) ✓
- `grep -n "createFleetStatusClient" src/ui/AppShell.tsx` → **3 lines** (1 import + 1 comment + 1 callsite) ✓ (only 1 actual callsite — no duplicated wiring)
- `npx tsc --noEmit -p tsconfig.json` → 0 errors ✓

## Threat model outcome

| Threat ID    | Category                                                                            | Disposition | Held |
| ------------ | ----------------------------------------------------------------------------------- | ----------- | ---- |
| T-117-07-01  | Tampering (malformed frame reaches setProjects with garbage projects field)         | mitigate    | ✓ FrontendOutboundFrame.parse + fleet-status-client Rule-2 Array.isArray guard from 117-06 pre-filter malformed frames BEFORE onProjectListChanged fires. |
| T-117-07-02  | Denial of Service (massive projects array crashes client)                           | accept      | ✓ Realistic project count is < 20; selector is O(N × M) bounded. |
| T-117-07-03  | Info Disclosure (sensitive data in localStorage collapse state)                     | accept      | ✓ Only kebab-case slugs stored (not sensitive). |
| T-117-07-04  | Tampering (dangling project slug in identity frontmatter poisons UI)                | mitigate    | ✓ D-07 graceful-degradation in projectForRow — dangling refs → null → row falls to middle. Test 7 asserts. |
| T-117-07-05  | Tampering (terminal row assigned a project poisons UI)                              | mitigate    | ✓ projectForRow defensively short-circuits on `row.rdpHostRow === true`. Test 8 asserts. Backend does not enforce this today (accepted in 117-05); this frontend gate is the primary defense. |
| T-117-07-SC  | Tampering (npm installs)                                                            | accept      | ✓ Zero new packages installed. |

Additional (new in this plan):

| Threat ID              | Category                                                                  | Disposition | Held |
| ---------------------- | ------------------------------------------------------------------------- | ----------- | ---- |
| T-117-07-relay-list-01 | Info Disclosure (relay-room-project-tags-list leaks other users' rooms)   | mitigate    | ✓ callerMxid resolved from users.mxid (NOT accepted from wire); getUserJoinedRooms is scoped to callerMxid; getRoomTags mints a per-user token scoped to callerMxid — homeserver enforces per-user isolation on account_data reads. |
| T-117-07-relay-list-02 | DoS (per-room Matrix hiccup blocks entire scan)                           | mitigate    | ✓ Per-room getRoomTags AdminErr logged + skipped; scan continues. Test 4 asserts. |
| T-117-07-relay-list-03 | Info Disclosure (500 body leaks err.message)                              | mitigate    | ✓ Fixed error shapes throughout; err.message routed to databaseLogger only. |

## Threat Flags

None. No new network endpoints beyond `/relay-rooms/project-tags` (which sits behind the same JWT + mxid defense-in-depth as 117-05's write route). No new auth path. No new schema at a trust boundary. The frontend Identity type extension is a pure additive field on an existing GET /identities response — no new endpoint, no new authz decision.

## Known Stubs

None. All new setters + hook + endpoint are fully wired to real data sources:
- setProjects ← fleet-status-client wire event + listProjects boot fetch.
- setRoomProjectAssignments ← listRelayRoomProjectTags boot fetch.
- setIdentityProjectAssignments — exposed as a public setter but NOT yet wired by AppShell (Wave 4 sidebar will hydrate it from useIdentities()'s new `project` field; the setter itself is ready to consume that data). This is documented as INTENTIONAL — the identity project data is already available on the Identity type (5d landed here); Wave 4 wires the last-mile setter call. Not a stub in the "placeholder that hides missing wiring" sense — the setter exists for a specific downstream caller.

## Deviations from Plan

### 1. Rule 2 (auto-add missing critical functionality) — Identity fixture updates across 14 pre-existing test files

- **Found during:** Task 1 GREEN, after the frontend Identity type was extended with non-optional `project: string | null`.
- **Issue:** 14 pre-existing test files construct `Identity`-shaped fixtures directly (not via spread from a base). Adding a required field breaks these fixtures at TypeScript-compile time.
- **Fix:** Added `project: null` to each fixture. Choice matrix: (a) make `project` optional (contradicts plan spec — plan explicitly requires non-optional to match backend emitter's always-emit posture); (b) update fixtures (this option). Option (b) is the correct one because the plan chose the type discipline deliberately.
- **Rationale:** Rule 2 correctness requirement — 14 fixture-only compile fixes are the cost of type discipline. The alternative (soften the type contract to optional) would silently accept undefined-carrying wire responses on the frontend and defeat the point of making `project` a first-class Identity field.
- **Files modified:** 14 test files listed under `key-files.modified` (all fixture-only edits — added `project: null` alongside existing `task: null`).
- **Commit:** `784ca68` (part of Task 1 GREEN — atomic per-task discipline).
- **Consistent with plan:** Yes — the plan's frontend Identity spec is unchanged. The fixture updates are the compile-time consequence.

### 2. Rule 3 (auto-fix blocking issue) — `identities-store.ts` cache round-trip + append-branch preserve `project`

- **Found during:** Task 1 GREEN, after the frontend Identity type extension.
- **Issue:** `identities-store.ts` has two places that construct Identity objects manually (the pulse-append branch of `mergeIdentityAppearance` at :606-624 and the `readAppearanceCache` filter at :871-891 + `writeAppearanceCache` mapper at :902-917). Without adding `project` at these sites, the identity list drops the field on cache round-trip.
- **Fix:** Added `project` to both the append branch (defaults to null since the wire-side `identityAppearance` schema does not yet carry it) and the cache read + write round-trip. Documented in key-decisions section 3.
- **Rationale:** Rule 3 — a page-refresh cache-hit would otherwise lose the identity's project assignment until the next GET /identities completes, blanking the projects-derived selector for the transition window. Correctness fix, no scope expansion.
- **Files modified:** `src/ui/state/identities-store.ts`.
- **Commit:** `784ca68` (part of Task 1 GREEN).
- **Consistent with plan:** Yes — the plan's spec is that the Identity type carries `project` end-to-end; this fix closes the cache-round-trip corner the plan implicitly assumed would be handled.

### 3. Rule 3 (auto-fix blocking issue) — extend `__getSnapshotForTest` to include the new derived-selector fields

- **Found during:** Task 1 GREEN, after `ConversationList` was extended with `pinnedUnassigned/projectSections/rdp`.
- **Issue:** `SnapshotForTest = ConversationList & {...}` — but the test helper's explicit constructor at :2464-2476 did NOT enumerate the new fields, causing a tsc error "properties pinnedUnassigned/projectSections/rdp missing".
- **Fix:** Added the three new field pass-throughs to the constructor body.
- **Files modified:** `src/ui/state/conversation-store.ts` (test helper only).
- **Commit:** `784ca68`.

### 4. Rule 3 (auto-fix blocking issue) — the `middle` field returns rows-without-project rather than all-non-pinned-non-RDP

- **Found during:** Task 1 GREEN, initial test run after implementing derived selector.
- **Issue:** Test 10 + Test 11 asserted `expect(snap.middle).toEqual([])` when a project section absorbed the identity's / relay-room's row. My first implementation preserved the pre-Phase-117 `middle` (all non-pinned non-RDP rows) verbatim, which meant rows appeared in BOTH `middle` AND `projectSections[i].rows`. The plan's semantic (see plan action step 4) says "middle = <rows that are not pinned, not RDP, and either have no project OR reference a nonexistent project>" — i.e., project-absorbed rows should NOT be in middle.
- **Fix:** Switched `middle: middleRows` → `middle: derivedMiddle` (the filtered variant excluding project-absorbed rows). Since `state.projects` starts empty on boot, pre-Phase-117 code paths see `middle === middleRows` (no rows are ever promoted), so backward-compat holds naturally.
- **Commit:** `784ca68`.

No architectural changes (Rule 4). All four deviations are localized correctness fixes.

## Issues Encountered

None beyond the four documented deviations. Every acceptance grep passes; every scoped test file (25 files, 525 tests) is green.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 4 (117-08 — sidebar rendering) can immediately:

```ts
import { useProjects, type ProjectRow } from "@/state/conversation-store";
import { useCollapsedProjectSlugs } from "@/state/use-collapsed-project-slugs";
// ...
const list = useConversations();
const projects = useProjects();
const { collapsed, toggle } = useCollapsedProjectSlugs();
// Render list.projectSections; toggle chevron on click.
```

Wave 4+ can compose:

- **117-08 (sidebar)** — reads `list.projectSections` for the projects zone, `list.pinnedUnassigned` for the top pinned zone, `list.rdp` for the bottom RDP zone (mirrors pre-Phase-117 order per D-09). `useCollapsedProjectSlugs` drives chevron state.
- **117-09 (create-project modal)** — enumerates `useProjects()` to check for duplicate slugs before submit.
- **117-09 (drag-and-drop)** — after every drop, fire `setSessionProject` (identity conversations) or `setRelayRoomProject` (relay rooms); the wire event from 117-03 flushes the update through `onProjectListChanged` → `setProjects` automatically (no additional store hydration needed on the drop-handler callsite).

## Self-Check: PASSED

Files present (verified with `[ -f ... ]`):
- FOUND: `src/ui/state/conversation-store.projects.test.ts`
- FOUND: `src/ui/state/use-collapsed-project-slugs.ts`
- FOUND: `src/ui/state/use-collapsed-project-slugs.test.ts`
- FOUND: `src/backend/database/routes/relay-room-project-tags-list.ts`
- FOUND: `src/backend/database/routes/relay-room-project-tags-list.test.ts`

Commits present in git log (verified with `git log --oneline`):
- FOUND: `053e89e` — Task 1 RED
- FOUND: `784ca68` — Task 1 GREEN
- FOUND: `0ed9fde` — Task 2 RED
- FOUND: `8781d9d` — Task 2 GREEN
- FOUND: `9ac1cf9` — Task 3 GREEN

Tests green: 525/525 pass across 25 scoped test files.
tsc: 561 errors (all pre-existing; base was 603 — improved by 42).

---
*Phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p*
*Completed: 2026-09-18*
