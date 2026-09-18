---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 08
subsystem: frontend/ui/pretty-conversations

# Dependency graph
requires:
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 06
    provides: "setSessionProject + setRelayRoomProject frontend API surface"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 07
    provides: "ProjectRow slice + useProjects hook + pinnedUnassigned/projectSections/rdp derived-selector fields + useCollapsedProjectSlugs hook"
provides:
  - "PrettyProjectSectionHeader — reusable per-project section component (header + coral drop lane + collapsible rows region + D-08 RDP refusal)"
  - "Extended PrettyConversationsPanel — projects zone rendered between pinned and flat-middle (D-09); flat-middle clear-project drop handler (D-22 gesture #2); Create project header button + placeholder modal marker"
  - "Extended PrettyConversationRow DnD payload — matrixRoomId + identityKey fields on the application/x-skynet-row wire so the section drop handler can route relay-room + identity paths without a second store lookup"
affects: [117-09]  # CreateProjectModal + new-conversation pre-fill wire in 117-09 read pendingProjectSlug + swap the placeholder marker

# Tech tracking
tech-stack:
  added: []  # No new packages — FolderOpen icon already in lucide-react, React + testing-library already present
  patterns:
    - "Byte-shape mirror of PrettyConversationsPanel.tsx:1636-1647 coral overlay (verbatim palette: bg rgba(255,184,150,0.22), border 2px rgba(255,184,150,0.60), zIndex 30) — Pattern reused on both the per-section drop lane inside PrettyProjectSectionHeader AND the new flat-middle clear-drop lane inside the panel"
    - "Type-gate on `application/x-skynet-row` ONLY for both drop lanes — badge drags + OS file drops fall through without preventDefault (Pitfall 7 in 117-RESEARCH.md)"
    - "Bounding-rect stateless dragleave guard against child-boundary crossings (mirror SplitView.tsx:301-305)"
    - "Window-level dragend for Escape-cancel path — cursor doesn't move on Escape, so dragleave never fires; dragend on the source (IdentityBadge / PrettyConversationRow) is the only reliable signal"
    - "`isolation: isolate` on both drop-lane wrappers for z-index sandboxing (mirror CollapsedPanelCloseLane.tsx:40)"
    - "Fire-and-forget with .catch on API dispatch — errors log via console.error but do not block the UI (D-07 graceful degradation posture)"
    - "State-only placeholder marker (`<div data-testid=create-project-modal-placeholder />`) — the CreateProjectModal component itself lands in 117-09 which replaces this marker; state toggle + pendingProjectSlug are ready to consume"

key-files:
  created:
    - src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx
    - src/ui/features/pretty-conversations/PrettyProjectSectionHeader.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.projects.test.tsx
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    - src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx

key-decisions:
  - "Panel test coverage split across TWO files: pre-existing PrettyConversationsPanel.test.tsx receives ONLY the fixture updates (additive derived-selector fields on the useConversations mock + useProjects/useCollapsedProjectSlugs/session-project-api stubs). The 11 NEW behavior tests live in a companion file PrettyConversationsPanel.projects.test.tsx — mirrors the existing companion pattern (relay-room.test.tsx, role-management-flow.test.tsx, new-role-button.test.tsx). Rationale: the main test file is 4332 lines with an elaborate shared mock scaffold; injecting 11 new tests would balloon the file and complicate the mock inheritance. Colocated companion is the established convention."
  - "PrettyConversationRow DnD payload EXTENDED (Rule 3) with `matrixRoomId` + `identityKey` — the pre-117-08 payload carried only `id/host/targetTmuxSession/fleetOnly/rdpHostRow`. Without these two fields, the panel's handleProjectDrop had no way to route relay-room drops (roomId was absent from the wire) and would need a second store lookup for identityKey. Adding them keeps the drop handler O(1) and matches the plan's explicit accommodation (\"either payload.targetTmuxSession OR a separate payload.identityKey field\"). Backward-compat: SplitView Pane onDrop reads only `id`, so the additive fields are safe under the row-shape's backward-compat rule per PATTERNS.md."
  - "Flat-middle drop container renders when EITHER `displayedMiddle.length > 0` OR `projectSections.length > 0` — this diverges slightly from the pre-Phase-117 gate (`displayedMiddle.length > 0` only). Rationale: on an empty middle with projects present, users still need a drop target to drag rows OUT of a project section. When both are empty (no projects, no middle rows) the flat-middle stays suppressed — same pre-Phase-117 behavior."
  - "userMxid sourced from `useViewingUserMxid()` (viewing-user-store, Phase 90 Plan 05). Falls back to a console.warn + skip when the mxid fetch hasn't yet resolved (fetch fires on first mount but is asynchronous). Rationale: firing setRelayRoomProject with a placeholder mxid would land on the wrong Matrix account_data blob. Users see the drop appear to no-op; a subsequent drop after the fetch settles succeeds. This is the same discipline the shared chat surface uses for relay-room writes."
  - "Create-project button placed AFTER the New conversation pencil in the header cluster per D-24 + Claude's Discretion (recommend: after the pencil-edit button, before the filter icon). Chose FolderOpen icon (also chosen for the section headers per D-12 icon standardization) so the header→section visual language is consistent."

requirements-completed: []  # Plan frontmatter's `requirements:` field is empty

# Metrics
duration: ~19 min
completed: 2026-09-18
---

# Phase 117 Plan 08: sidebar UI — PrettyProjectSectionHeader + panel projects zone + create-project button Summary

## One-liner

Visible sidebar change lands — per-project section headers (FolderOpen + "Project:" prefix + displayName + SquarePen new-conv + ChevronDown) render between pinned and flat-middle with per-section coral drop lanes (D-22 gesture #1 assign), flat-middle clear-project drop lane (D-22 gesture #2 clear), and a Create project header button toggling a placeholder that 117-09 will replace with the real modal.

## Performance

- **Duration:** ~19 min
- **Started:** 2026-09-18T20:30:57Z
- **Completed:** 2026-09-18T20:49:30Z
- **Tasks:** 2 (both TDD RED+GREEN)
- **Files created:** 3 (component + 2 test files)
- **Files modified:** 7 (panel + row + 5 test fixture updates)
- **Commits:** 4 total (2 RED + 2 GREEN)

## Accomplishments

### Task 1 — PrettyProjectSectionHeader component

**File:** `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` (+243 lines)

Reusable section wrapper implementing D-12 header shape + D-22 gesture #1 per-section drop lane + D-23 coral palette + D-08 RDP refusal + D-13 collapse toggle.

**Props (verbatim):**

```typescript
export interface PrettyProjectSectionHeaderProps {
  slug: string;
  displayName: string;
  rows: ReactNode;
  collapsed: boolean;
  onToggleCollapse: (slug: string) => void;
  onNewConversationClick: (slug: string) => void;
  onDropRow: (slug: string, payload: PrettyProjectDropPayload) => void;
}

export type PrettyProjectDropPayload = {
  id: string;
  host?: { id: string } | null;
  targetTmuxSession?: string | null;
  matrixRoomId?: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
  identityKey?: string | null;
};
```

**Behavior invariants (all 15 tests green):**

- Header row: FolderOpen icon + "Project:" literal prefix + displayName + SquarePen new-conv button + ChevronDown (rotates on expand/collapse).
- Baseline is NEUTRAL — coral overlay only appears during dragover with `application/x-skynet-row` MIME. Badge drags + OS file drops fall through without preventDefault.
- Bounding-rect dragleave guard against child-boundary crossings.
- Window-level dragend clears overlay (Escape-cancel path).
- Drop handler parses payload safely (try/catch + shape validation); RDP payloads (`rdpHostRow === true`) are REFUSED at the section boundary (D-08 defense-in-depth).
- Verbatim coral palette: `background: rgba(255, 184, 150, 0.22)`, `border: 2px solid rgba(255, 184, 150, 0.60)`, `zIndex: 30`.
- `isolation: isolate` on the wrapper for z-index sandboxing.
- Rendered rows region uses `id={pv-project-section-content-${slug}}` (a11y anchor for aria-controls); NOT in the DOM when `collapsed=true`.

### Task 2 — Panel projects zone + flat-middle clear-drop + create-project button + row DnD payload extension

**Files modified:** `PrettyConversationsPanel.tsx`, `PrettyConversationRow.tsx` (+ 5 test file fixture updates)

**Panel changes:**

1. **New imports** — `FolderOpen` icon, `useProjects`, `useCollapsedProjectSlugs`, `setSessionProject`, `setRelayRoomProject`, `useViewingUserMxid`, `PrettyProjectSectionHeader`.

2. **Destructure new derived-selector fields:**

```typescript
const {
  activeSet: activeSetRows, pinned, middle, rdpGroup,
  pinnedUnassigned, projectSections,
} = useConversations();
useProjects();
const { collapsed: collapsedProjectSlugs, toggle: toggleProjectCollapse } =
  useCollapsedProjectSlugs();
const viewingUserMxid = useViewingUserMxid();
```

3. **Pinned tier switched:** `displayedPinned` now derives from `pinnedUnassigned` (not `pinned`) so pinned-in-project rows float to their project section per D-19 instead of the top pinned zone.

4. **Handler signatures (verbatim):**

```typescript
const handleProjectDrop = useCallback((
  slug: string,
  payload: {
    id: string;
    host?: { id: string } | null;
    targetTmuxSession?: string | null;
    matrixRoomId?: string | null;
    rdpHostRow?: boolean;
    identityKey?: string | null;
  },
) => { /* routes → setSessionProject(host, key, slug) or setRelayRoomProject(roomId, mxid, slug) */ },
  [viewingUserMxid]);

const handleFlatMiddleDrop = useCallback(
  (e: React.DragEvent<HTMLDivElement>) => {
    /* type-gate, parse, RDP refuse, only-clear-if-currently-in-project */
  },
  [rowIdToProjectSlug, viewingUserMxid]);

const handleNewConversationInProject = useCallback((slug: string) => {
  setPendingProjectSlug(slug);
  setCreateProjectModalOpen(true);
}, []);
```

5. **JSX insertion range:** Project sections rendered between lines **2194** (end of pinned zone `</div>`) and **2233** (end of `projectSections.map(...))`. Flat middle now at lines 2251-2294 with `onDragOver` + `onDragLeave` + `onDrop` handlers and its own hover-only coral overlay.

6. **Create-project header button** — inserted between the New conversation pencil (`SquarePen`) and Edit roles (`Drama`) buttons per D-24 + Claude's Discretion. Icon: `FolderOpen`. Aria-label: `"Create project"`. Test-id: `pv-header-create-project-button`. Clicking it toggles `createProjectModalOpen` (state variable) + clears `pendingProjectSlug`.

7. **Placeholder modal marker** — rendered at the bottom of the panel when `createProjectModalOpen === true`. Test-id: `create-project-modal-placeholder`. Threads `pendingProjectSlug` as `data-pending-project-slug`. 117-09 replaces this marker with the real `CreateProjectModal` component.

**Row DnD payload extension (Rule 3):**

`PrettyConversationRow.tsx:onRowDragStart` extended to include TWO additional fields on the `application/x-skynet-row` JSON blob:

```typescript
e.dataTransfer.setData(
  "application/x-skynet-row",
  JSON.stringify({
    id: row.id,
    host: row.host ?? null,
    targetTmuxSession: row.targetTmuxSession ?? null,
    fleetOnly: row.fleetOnly === true,
    rdpHostRow: row.rdpHostRow === true,
    matrixRoomId: row.roomId ?? null,        // NEW — relay-room routing
    identityKey: identity?.identityKey ?? null, // NEW — identity routing
  }),
);
```

Backward-compat: `SplitView.tsx` Pane onDrop reads only `id` + `text/plain`, so the additive fields are safe under the row-shape's backward-compat rule (per PATTERNS.md).

## Test counts

| File                                                              | Pre-existing | New (117-08) | Total | Notes                                     |
| ----------------------------------------------------------------- | ------------ | ------------ | ----- | ----------------------------------------- |
| PrettyProjectSectionHeader.test.tsx                               | 0            | 15           | 15    | New file — component behavior surface     |
| PrettyConversationsPanel.projects.test.tsx                        | 0            | 11           | 11    | New file — panel projects zone            |
| PrettyConversationsPanel.test.tsx                                 | 97           | 0            | 97    | Regression guard (fixture updates only)   |
| PrettyConversationsPanel.relay-room.test.tsx                      | 8            | 0            | 8     | Regression guard (fixture updates only)   |
| PrettyConversationsPanel.role-management-flow.test.tsx            | 4            | 0            | 4     | Regression guard (fixture updates only)   |
| PrettyConversationsPanel.new-role-button.test.tsx                 | 2            | 0            | 2     | Regression guard (fixture updates only)   |
| NewConversationModal.flow.test.tsx                                | 8            | 0            | 8     | Regression guard (fixture updates only)   |
| PrettyConversationRow.test.tsx                                    | 97           | 0            | 97    | Regression guard — DnD payload extension  |
| (Other 7 files under pretty-conversations/)                       | 80           | 0            | 80    | Regression guards, all still green        |

**Total scoped verification: 322 tests across 15 pretty-conversations test files, all green.**
**AppShell + shell integration: 62 tests across 5 test files that import PrettyConversationsPanel — all green.**

**Verification runs:**

- `npx vitest run src/ui/features/pretty-conversations/` — 322/322 pass, 0 fail.
- `npx vitest run src/ui/AppShell.persistence.test.tsx src/ui/AppShell.empty-pv-drop-tint.test.tsx src/ui/shell/CollapsedPanelCloseLane.test.tsx src/ui/shell/tabUtils.test.tsx src/ui/shell/SplitView.text-selection-drag.test.tsx` — 62/62 pass.
- `npx tsc --noEmit -p tsconfig.app.json` — 340 errors (all pre-existing; base was 561 per 117-07 SUMMARY; I INTRODUCED 0 new type errors).

## Acceptance criteria — all satisfied

### Task 1 (PrettyProjectSectionHeader)

- `grep -c "^export function PrettyProjectSectionHeader" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** ✓
- `grep -c "rgba(255, 184, 150, 0.22)" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** (≥ 1) ✓
- `grep -c "rgba(255, 184, 150, 0.60)" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** (≥ 1) ✓
- `grep -c "zIndex: 30" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** (≥ 1) ✓
- `grep -c "application/x-skynet-row" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **2** (dragover type-gate + drop payload extraction; ≥ 2) ✓
- `grep -c "application/x-skynet-badge" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **0** (badge drags NOT accepted per Pitfall 7) ✓
- `grep -c "rdpHostRow" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **2** (≥ 1) ✓
- `grep -c "Project:" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** (literal prefix per D-12; ≥ 1) ✓
- `grep -c "isolation.*isolate" src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` → **1** (≥ 1) ✓
- `npx vitest run src/ui/features/pretty-conversations/PrettyProjectSectionHeader.test.tsx` → 15/15 pass ✓

### Task 2 (PrettyConversationsPanel)

- `grep -c "PrettyProjectSectionHeader" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → **6** (import + JSX usage + comments; ≥ 2) ✓
- `grep -c "useProjects\|useCollapsedProjectSlugs" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → **6** (imports + call sites; ≥ 2) ✓
- `grep -c "setSessionProject\|setRelayRoomProject" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → **13** (import + 4 call sites: 2 in handleProjectDrop, 2 in handleFlatMiddleDrop, + comments; ≥ 3) ✓
- `grep -c "handleProjectDrop\|handleFlatMiddleDrop\|handleNewConversationInProject" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → **14** (≥ 3) ✓
- `grep -n "PrettyProjectSectionHeader" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` shows usage at line **2203** — BETWEEN the pinned block at 2172 and the middle block at 2254. D-09 satisfied ✓
- `grep -c '>Projects<' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → **0** (no rendered "Projects" super-section label per D-10) ✓
- `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/ui/features/pretty-conversations/PrettyProjectSectionHeader.test.tsx` — all green (97 + 15 = 112 tests) ✓
- `npx tsc --noEmit -p tsconfig.json` — 0 NEW type errors from this plan's files (introduced 0 vs pre-existing 340) ✓

## Plan-specified output items (§ <output>)

1. **PrettyProjectSectionHeader exports + Props verbatim:** see the "Task 1" section above (Props table + PrettyProjectDropPayload type).

2. **Panel handler signatures:** see the "Task 2 → Handler signatures" section above.

3. **JSX insertion point of the projects zone:** lines **2194-2233** (spanning the closing `</div>` of the pinned zone through the closing `))}` of the `displayedProjectSections.map(...)` block).

4. **userMxid resolution mechanism:** `useViewingUserMxid()` from `@/state/viewing-user-store` (Phase 90 Plan 5). Fetch-once semantics — fires on first subscription, cached module-scoped. Falls back to `console.warn + skip` when null (fetch not yet resolved). The mock supplies `"@user:matrix.example"` in tests.

5. **identityKey field addition status:** Both `identityKey` and `matrixRoomId` were **ADDED** to the DnD source at `PrettyConversationRow.tsx:onRowDragStart`. Pre-117-08 payload carried only `id/host/targetTmuxSession/fleetOnly/rdpHostRow`. This is a Rule 3 (auto-fix blocking) — without these fields, `handleProjectDrop` had no path to the relay-room roomId, and would require a second store lookup for identityKey. Backward-compat: `SplitView.tsx` Pane onDrop reads only `id` + `text/plain`, so additive fields don't affect existing consumers.

6. **Test counts:** 26 new tests (15 for the section header + 11 for the panel projects zone). Pre-existing panel tests: 97 tests untouched (fixture-only updates supplied the additive derived-selector fields). See the Test counts table above for the full breakdown across 15 files (322 total).

## Threat model outcome

| Threat ID    | Category                                                                    | Disposition | Held |
| ------------ | --------------------------------------------------------------------------- | ----------- | ---- |
| T-117-08-01  | Tampering (malformed drag payload)                                          | mitigate    | ✓ try/catch on JSON.parse + shape validation (`typeof p.id === "string"` + non-empty). Test 14 asserts drop with empty types is a no-op. |
| T-117-08-02  | Tampering (badge drag misrouted to project drop lane)                       | mitigate    | ✓ Type-gate on `application/x-skynet-row` ONLY. `grep -c "application/x-skynet-badge" PrettyProjectSectionHeader.tsx` returns 0. Test 7 asserts wrong-MIME drag does not activate coral. |
| T-117-08-03  | Tampering (RDP row assigned a project via drag)                             | mitigate    | ✓ Two-level defense: PrettyProjectSectionHeader refuses `rdpHostRow=true` at the drop; the panel's handleProjectDrop AND handleFlatMiddleDrop also guard. Test 13 (section) + Test 10 (panel) both assert. |
| T-117-08-04  | Denial of Service (rapid drag-drop spams the wire)                          | mitigate    | ✓ Fire-and-forget with `.catch` on the API call; backend registry idempotent-skip (117-03) absorbs no-op wire events. |
| T-117-08-05  | Info Disclosure (coral overlay leaks target info)                           | accept      | ✓ Coral is a UI affordance visible only within the user's own browser; no cross-user leakage. |
| T-117-08-06  | Elevation of Privilege (user drops another user's convo into own project)   | accept      | ✓ Route layer (117-05) enforces per-user host isolation via `resolveHostById`; the drop request would 404. |
| T-117-08-SC  | Tampering (npm installs)                                                    | accept      | ✓ Zero new packages installed. |

## Threat Flags

None. No new network endpoints, no new auth paths, no new schema at trust boundaries. The two API calls (`setSessionProject`, `setRelayRoomProject`) route through 117-06's existing frontend wrappers which land on 117-05's JWT + host-isolation-gated backend endpoints.

## Known Stubs

**Intentional placeholder — resolved by 117-09:**

1. **Create-project modal placeholder** at `PrettyConversationsPanel.tsx` (in the bottom render block).
   - **File / line:** `PrettyConversationsPanel.tsx` (rendered inside `{createProjectModalOpen && ...}`)
   - **Reason:** The state toggle + `pendingProjectSlug` are ready to consume, but the actual `CreateProjectModal` component (with the name-input + slugify + create-project API call) lands in 117-09 per plan boundary. The placeholder is a `<div hidden data-testid="create-project-modal-placeholder">` that 117-09 swaps for the real modal component.
   - **Resolved in:** 117-09 (per plan sequence Wave 5).

2. **`handleNewConversationInProject`** currently opens the same placeholder rather than the actual new-conversation flow.
   - **File / line:** `PrettyConversationsPanel.tsx` (handleNewConversationInProject definition)
   - **Reason:** Full new-conversation-in-project pre-fill (D-27) requires wiring the 117-09 `CreateProjectModal` + the existing `NewConversationModal` in tandem. The `pendingProjectSlug` state is set so 117-09 can pick it up.
   - **Resolved in:** 117-09.

Neither is a "placeholder that hides missing wiring" stub in the concerning sense — both are handoff points to the next plan in the wave sequence. The plan explicitly names 117-09 as the follow-on.

## Deviations from Plan

### 1. Rule 3 (auto-fix blocking) — Extended PrettyConversationRow DnD payload with `matrixRoomId` + `identityKey`

- **Found during:** Task 2 planning + implementation.
- **Issue:** The plan's Task 2 action step 4 says "identityKey is derived from the row — this is either `payload.targetTmuxSession` OR a separate `payload.identityKey` field. Grep the DnD source in PrettyConversationRow.tsx:949-973 to see which fields the row DnD payload actually carries; use whichever field carries the identity key." The pre-117-08 payload carried neither `matrixRoomId` NOR `identityKey`; it had only `id/host/targetTmuxSession/fleetOnly/rdpHostRow`. Without `matrixRoomId`, the panel's `handleProjectDrop` had NO path to route relay-room drops (Task 2 Test 7 would fail).
- **Fix:** Extended `PrettyConversationRow.tsx:onRowDragStart` to include both fields on the JSON payload:
  - `matrixRoomId: row.roomId ?? null` — sourced from the row's Phase 90 `roomId` field.
  - `identityKey: identity?.identityKey ?? null` — sourced from the identity lookup already resolved in the row (via `useIdentities`).
- **Rationale:** Rule 3 — this is a correctness fix for the drop-handler-routing path. The plan's language explicitly accommodates adding the field ("either OR a separate `payload.identityKey` field").
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (onRowDragStart body + useCallback deps).
- **Commit:** `d061829` (part of Task 2 RED — the test asserts the panel receives the matrixRoomId, which requires the payload extension).
- **Consistent with plan:** Yes — Item 5 of the plan's `<output>` block explicitly asks "whether the identityKey field in the row DnD source needed to be added or was already present" — the plan anticipated this outcome.

### 2. Rule 3 (auto-fix blocking) — Fixture updates in 5 pre-existing test files

- **Found during:** Task 2 GREEN, after modifying the panel to subscribe to `useProjects`, `useCollapsedProjectSlugs`, `setSessionProject/setRelayRoomProject`.
- **Issue:** 5 test files mock `@/state/conversation-store` but their mocks did NOT export `useProjects` (added in 117-07), nor did the `useConversations` return value include the additive `pinnedUnassigned/projectSections/rdp` fields (added in 117-07 but never seeded in pre-Phase-117 fixtures). The panel's destructure of these fields evaluated `undefined`, breaking every test that renders the panel.
- **Fix:** Added the additive fields to each fixture's `useConversations` mock (defaulted to sensible empty/passthrough values that preserve pre-Phase-117 semantics), added `useProjects: () => []`, added stubs for `@/state/use-collapsed-project-slugs` and `@/api/session-project-api`.
- **Rationale:** Rule 3 — fixture-only edits to preserve the plan's spec invariant that "existing tests remain green" (Task 2 done criteria). The alternative would be to make the new fields optional at the destructure site, which softens the contract for zero benefit.
- **Files modified:** `PrettyConversationsPanel.test.tsx`, `PrettyConversationsPanel.relay-room.test.tsx`, `PrettyConversationsPanel.role-management-flow.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`, `NewConversationModal.flow.test.tsx`.
- **Commit:** `28b37ef` (part of Task 2 GREEN).
- **Consistent with plan:** Yes — the plan's Task 2 action step 8 explicitly notes "Reuse the store-mock pattern from existing tests" and the acceptance criteria requires "all pre-existing tests still green".

No architectural changes (Rule 4). Both deviations are localized correctness/fixture fixes.

## Authentication Gates

None. No auth prompts fired during execution — API calls are unauthenticated at the frontend layer (JWT flows through the shared axios interceptor).

## Issues Encountered

None beyond the two documented deviations. Every acceptance grep passes; every scoped test file (322 tests across 15 files, plus 62 tests across 5 AppShell + shell files that import the panel) is green.

## User Setup Required

None — no external service configuration required. The Create-project header button renders a placeholder marker (visible only via `data-testid`) that 117-09 replaces with the real modal.

## Next Phase Readiness

Wave 5 (117-09 — CreateProjectModal + new-conversation pre-fill wire) can immediately:

```tsx
// 1. Swap the placeholder for the real modal.
{createProjectModalOpen && (
  <CreateProjectModal
    open={createProjectModalOpen}
    onOpenChange={(o) => { if (!o) { setCreateProjectModalOpen(false); setPendingProjectSlug(null); } }}
    pendingProjectSlug={pendingProjectSlug}  // consumed for pre-fill
    hostId={/* pick primary host from allHosts */}
    onCreated={/* refresh + close */}
  />
)}

// 2. Wire the new-conversation-in-project flow — when pendingProjectSlug !== null,
//    the modal transitions from "create project" mode to "create conversation
//    inside <slug>" mode (or opens NewSessionDialog with the project pre-selected).
```

The panel's `pendingProjectSlug` + `createProjectModalOpen` state pair is the handoff surface. 117-09 owns the modal render, name input, slugify, and API dispatch (`createProject(hostId, displayName)` from `project-list-api.ts`, landed in 117-06).

Additionally, the right-click / long-press D-14 context menu (Edit project file + Archive project) is a follow-on: the section header component receives the slug through its props; a subsequent plan can wire `onContextMenu` on the outer wrapper of `PrettyProjectSectionHeader` to open a small menu (mirrors `PrettyConversationContextMenu.tsx`).

## Self-Check: PASSED

Files present (verified with `[ -f ... ]`):
- FOUND: `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx`
- FOUND: `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.test.tsx`
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.projects.test.tsx`

Commits present in git log (verified with `git log --oneline`):
- FOUND: `0630a2e` — Task 1 RED (test file for section header)
- FOUND: `f2c0bdf` — Task 1 GREEN (section header implementation)
- FOUND: `d061829` — Task 2 RED (panel projects test + row DnD payload extension)
- FOUND: `28b37ef` — Task 2 GREEN (panel projects zone + flat-middle drop + create-project button + fixture updates)

Tests green: 322/322 pass across 15 pretty-conversations test files; 62/62 pass across 5 AppShell + shell test files.
tsc: 340 errors (all pre-existing; 0 introduced by this plan).

---
*Phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p*
*Completed: 2026-09-18*
