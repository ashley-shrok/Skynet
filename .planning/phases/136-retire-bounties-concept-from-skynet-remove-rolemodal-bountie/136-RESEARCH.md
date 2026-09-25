# Phase 136: Retire bounties concept from Skynet — Research

**Researched:** 2026-09-23
**Domain:** Dead-code removal (retire a fleet-level concept from a React+Express/WS codebase)
**Confidence:** HIGH — every reference site was enumerated with `grep -rEw`, classified by opening the actual file, and cross-checked against consumer/importer graphs.

## Summary

Bounties are DEAD in the id-skill/fleet layer as of 2026-09-20. Skynet still carries **the entire vertical slice** — a Bounties tab on `RoleModal`, a `RoleBountiesTab` + `BountyCard` component pair, a role-name-keyed axios helper (`listBountiesForRoleName`), a `role:list-bounties` WS handler, and a **massive** set of legacy identity-scoped bounty read/write/archive/delete methods and their WS handlers on `claude-session-server.ts` + `identity-artifact-reader.ts` (~2500 lines between them). Every bounty-serving artifact is behind exactly ONE UI entry point (RoleModal's Bounties tab) — nothing else in the UI drives a bounty read or write.

The retirement is a clean amputation, not a rewire. There is no successor concept to migrate anything to. Bounties on disk (`~/fleet/roles/<role>/bounties/`) become orphans on the host filesystem; Skynet stops looking at them. The `substrate/skills/role/SKILL.md` file — a DISTRIBUTED skill pushed to fleet hosts by the Skynet substrate distributor — still writes `mkdir -p "$ROLE_DIR/bounties"` and still describes bounties as the "shared knowledge home" for a role. That file is the SOURCE-OF-TRUTH for the `/role` skill on managed hosts; if it stays as-is, new roles created via `/role` will continue to spawn a `bounties/` folder even though nothing reads it.

**Primary recommendation:**
1. Delete the ENTIRE identity-scoped bounty vertical (WS handlers, readers, writers, types, tests) — nothing consumes it except tests.
2. Delete the role-scoped bounty vertical (`role:list-bounties` handler, `readRoleBountiesByName`, `listBountiesForRoleName`, `RoleBountiesTab`, `BountyCard`, `Bounty` type + WS event types).
3. Edit — don't delete — `RoleModal.tsx` (strip Bounties nav entry + TabsContent + import) and `RoleModal.test.tsx` (strip Test A's 4-tabs assertion + all setup mocks that touch `listBountiesForRoleName`).
4. Edit `substrate/skills/role/SKILL.md` (delete the `mkdir bounties/` line + rewrite the "bounty pool" phrasing) AND `src/backend/database/routes/roles-create.ts` (delete `mkdir "$HOME/fleet/roles/${name}/bounties"` from the atomic-mkdir chain) AND update the R-5 comment in `roles-create.test.ts`.
5. Sweep the frontend `filterPinnedBounties` dead label from `PrettyConversationsPanel.tsx`.
6. Do NOT touch comments/docstrings/pre-existing historical bounty prose (the ~90 files that carry only "Bounty foo-bar-baz" GSD-workflow-context comments) — that would be scope creep and reduces the phase to a mechanical sweep.

## User Constraints (from CONTEXT.md)

*No CONTEXT.md exists for this phase yet — the phase description in the roadmap is the constraint document. Extracted directives:*

### Locked Decisions

- **Bounties are RETIRED, not renamed.** No successor concept, no migration path, no replacement API. The task-scoped identity model means "the identity FILE BODY is the record."
- **Full retire, not just the visible modal tab.** RoleModal Bounties tab + companion UI components + backend identity-artifact-reader bounty methods + associated tests + axios call sites all go.
- **Per-site classification required** for the reference-heavy files (starter.ts, distributor/catalog.ts, PrettyView.tsx, etc.) — many hits are comments referencing the OLD GSD-workflow bounty concept (e.g., "Bounty b31a5c8e — per-connection SSH exec pool") and are unrelated to the id-skill bounty concept being retired. Do NOT scrub those.

### Claude's Discretion

- Wave breakdown for parallel execution.
- Whether the `substrate/skills/role/SKILL.md` update belongs in this phase (recommendation: YES — see § Runtime State Inventory).
- Whether to preserve or delete the historical GSD-workflow "Bounty foo-bar" comments across the codebase (recommendation: LEAVE ALONE — they're historical context, not live pointers).

### Deferred Ideas (OUT OF SCOPE)

- **Handoffs retirement.** The id-skill retirement commit mentioned "identity file body is the record" which encompasses handoffs (`readIdentityHandoff` / `writeIdentityHandoff` / `identity:handoff` wire). The phase description says "bounties" only. Leave handoff code alone.
- **History retirement.** Same rationale — `readIdentityHistory` and its WS handler stay untouched even though it lives in the same file.
- **Historical GSD-workflow comment scrub.** ~40+ files carry decorative "Bounty <slug>" comments that were the way work was tracked pre-retirement. Not the same concept as what's being retired. Not in scope.
- **On-disk bounty folder cleanup on managed hosts.** No `rm -rf ~/fleet/roles/*/bounties/` motion — that's a fleet-side data cleanup and out of scope for the Skynet retirement.
- **Replacement task-scoped identity model wiring.** Not part of this phase (per the phase description — "correctly removed" is the ask).

## Phase Requirements

*No phase requirement IDs were provided by the orchestrator — this is a code-cleanup / dead-code retirement phase, not a feature phase. The roadmap declares "Requirements: TBD".*

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RoleModal Bounties tab UI removal | Browser / Client | — | Pure React component surgery |
| Frontend WS/axios bounty helper deletion | Browser / Client | — | `src/ui/api/claude-session-api.ts` — client-side WS wire type deletion |
| WS handler + reader/writer deletion | API / Backend | — | `claude-session-server.ts` (handlers) + `identity-artifact-reader.ts` (readers/writers) — no HTTP routes involved; all bounty ops flow through WebSocket |
| `mkdir bounties/` retirement at role creation | API / Backend | Filesystem / Storage | `roles-create.ts` — one SSH exec's mkdir chain no longer creates the folder; on-disk stale folders on managed hosts are OUT OF SCOPE |
| Distributed `role` skill scrub | Distributed / Fleet | Filesystem / Storage | `substrate/skills/role/SKILL.md` — this file is pushed by the substrate distributor (`src/backend/distributor/catalog.ts`) to managed hosts and re-installed on next sweep after this ships |

## Standard Stack

*No new packages. This is a deletion phase.*

## Package Legitimacy Audit

*N/A — phase installs zero packages.*

## Architecture Patterns

### Skynet Bounty Wire Architecture (existing → post-retirement)

```
BEFORE (retiring these paths):
┌────────────────────────────────────────────────────────────────────────────┐
│ RoleModal.tsx (Bounties tab)                                                │
│    └─→ <RoleBountiesTab roleName hostId hue />                              │
│           └─→ BountyCard × N                                                │
│           └─→ listBountiesForRoleName({roleName, hostId, includeArchived})  │
│                (src/ui/api/claude-session-api.ts)                           │
│                  ↓ WS: {type: "role:list-bounties", roleName, hostId?, …}   │
│                  ↑ WS: {type: "role:bounties-loaded", bounties, archived…}  │
│    handleRoleListBounties() ← claude-session-server.ts L1719                │
│      └─→ readRoleBountiesByName() ← identity-artifact-reader.ts L3916       │
│            SSH `for … cat bounties/*/bounty.json` on managed host           │
│                                                                             │
│ [Additional 8 identity-scoped WS handlers still exist for legacy IdentityModal │
│  bounty ops — but IdentityModal already stopped rendering those in Phase 90. │
│  Handlers are pure dead weight.]                                            │
└────────────────────────────────────────────────────────────────────────────┘

AFTER (target):
┌────────────────────────────────────────────────────────────────────────────┐
│ RoleModal.tsx: 3 tabs (Role file / Runbooks / Wakeups) — no Bounties nav    │
│ RoleBountiesTab.tsx: DELETED                                                │
│ BountyCard.tsx: DELETED                                                     │
│ listBountiesForRoleName: DELETED                                            │
│ role:list-bounties, identity:list-bounties, and 6 identity:update-bounty-*  │
│   WS handlers: DELETED                                                      │
│ readRoleBountiesByName, readIdentityBounties, writeIdentityBounty*,         │
│   archiveIdentityBounty, deleteIdentityBounty, normalizeBounty,             │
│   BOUNTY_PRIORITY_VALUES, BOUNTY_STATUS_VALUES, TERMINAL_BOUNTY_STATUSES,   │
│   BountyPriority, BountyStatus, BountyFieldsPatch,                          │
│   IDMEDIT_MAX_BOUNTY_JSON_BYTES: DELETED                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Pattern 1: WS handler + reader + api helper — three-file amputation unit

Every wire type retires as a coordinated triple:
1. **Backend handler** in `claude-session-server.ts` (`if (msg.type === "...")` block or extracted `handleFoo` function)
2. **Backend reader/writer** in `identity-artifact-reader.ts` (an exported async function)
3. **Frontend helper** in `src/ui/api/claude-session-api.ts` (an exported function returning a Promise + wire-type union entry + Event type)

For this phase, that triple covers 10 wire types (see § Backend API Surface below). Delete all three files' entries for each wire type in the SAME commit — leaving one side behind causes typecheck errors on the other side.

**Order within a commit:** delete UI consumer → delete api helper → delete WS handler → delete reader/writer. `tsc --noEmit` catches missed references at any step.

### Anti-Patterns to Avoid

- **Do NOT run `sed -i s/bounty//g`.** The word "bounty" appears in ~90 files as historical GSD-workflow comments (`"Bounty pretty-view-per-pane-cost-diag"`, `"Bounty b31a5c8e Phase 101"`, etc.). These are historical context markers, not live pointers. Blanket removal would delete real documentation.
- **Do NOT delete `readIdentityHistory` or `readIdentityHandoff`.** The 2026-09-20 commit message ("identity file body is the record") retired handoffs+history too *in id-skill*, but the phase description says "bounties" only. Handoff/history stays in Skynet until a follow-on phase.
- **Do NOT delete the `identity-artifact-reader.two-step.test.ts` file wholesale.** It mixes bounty tests (tests 10, 12, 14) with history tests (11, 13, 15) and non-bounty setup tests (1-9). Only tests 10, 12, 14 and the shared bounty-fixture describe blocks retire.

## Don't Hand-Roll

*N/A — pure deletion phase.*

## Runtime State Inventory

*Skynet is a rename/retire phase — this section is mandatory.*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Managed host filesystems:** `~/fleet/roles/<role>/bounties/<slug>/bounty.json` folders exist on every host where roles have been created via `/role` (dozens of dirs across the fleet per user's own workflow). These are ORPHANED after retirement — no reader touches them. | **OUT OF SCOPE per phase description** (no data migration proposed). Managed-host cleanup is a manual `rm -rf` sweep at fleet-admin's discretion. |
| Live service config | None. Skynet backend has no DB rows, no external service config, no persisted registrations that reference bounties. | None. |
| OS-registered state | None. No systemd unit, no launchd plist, no cron / Windows Task Scheduler entry references bounties. Verified by `grep -rE "bount" scripts/ docker/ substrate/scripts/`. | None. |
| Secrets / env vars | None. `SOPS`, `.env`, and `wsl-relay` credential files don't carry bounty-named keys. | None. |
| Build artifacts / installed packages | `substrate/skills/role/SKILL.md` — a **distributed** skill file that gets pushed by `src/backend/distributor/` to every managed host on next sweep. If unchanged, new roles created via `/role <name>` on managed hosts will keep creating `bounties/` dirs even after Skynet stops reading them. Also: `catalog.ts` L48–L51 header comment already correctly documents the fleet-side retirement — sibling to the file we need to edit here. | **Edit `substrate/skills/role/SKILL.md`** — delete the `mkdir -p "$ROLE_DIR/bounties"` line, rewrite the "bounty pool" prose in the top-of-file description, and delete the L96 announcement's "empty `bounties/`" mention. Distributor will re-push on next sweep (catalog row already present in `substrate/skills/role`). |

**The canonical question:** After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?

**Answer:** (1) On-disk `bounties/` folders on managed hosts stay behind as inert data (OUT OF SCOPE); (2) The `substrate/skills/role/SKILL.md` `mkdir bounties/` line will continue to create empty folders on future `/role` calls unless updated in this phase (IN SCOPE — added as a wave item).

## Common Pitfalls

### Pitfall 1: TypeScript orphan-import cascade

**What goes wrong:** Delete `RoleBountiesTab.tsx` first, then `tsc` fails because `RoleModal.tsx` still imports it. Fix `RoleModal.tsx`, `tsc` still fails because `RoleModal.test.tsx` mocks `listBountiesForRoleName` from an export that got deleted.

**Why it happens:** Bounty types + helpers form a chain: `identity-artifact-reader.ts` exports → `claude-session-server.ts` imports + re-exports handler symbols → `claude-session-api.ts` exports helper → `RoleBountiesTab.tsx` imports helper + type → `RoleModal.tsx` imports component.

**How to avoid:** Delete top-down (consumer first, reader last) in a single wave OR split into per-file commits within a wave and run `tsc --noEmit` after every commit. The planner should mandate `npm run build:backend` AND `npx tsc --noEmit -p tsconfig.app.json` (frontend) after each commit — see § Verification Approach.

**Warning signs:** `tsc` errors "Cannot find name 'Bounty'" or "Property 'listBountiesForRoleName' does not exist on type 'typeof …'". These are load-bearing signals; do NOT `// @ts-ignore` past them.

### Pitfall 2: Mocked test setup leaves orphan references

**What goes wrong:** `RoleModal.test.tsx` uses `mockListBountiesForRoleName` in `beforeEach` even for tests that don't touch bounties (Test G role-file save, Test I runbook-click, Test J close, Test K avatar upload, Test L clear title, Test M no-identity-prop). If you delete `listBountiesForRoleName` but leave the mock, `vi.mock` still resolves to the stub which no longer matches the real module.

**Why it happens:** The vi.mock at L81-L108 of RoleModal.test.tsx mocks the entire module surface and injects a fake `listBountiesForRoleName` that non-bounty tests inherit for setup convenience.

**How to avoid:** When editing `RoleModal.test.tsx`, remove ALL mock-scaffold references to `listBountiesForRoleName` (L83–L88, L102–L103, L157–L160), not just Test A's Bounties assertion at L183.

**Warning signs:** vitest surfaces "Cannot destructure property 'listBountiesForRoleName' of module" at test-load time (before any test body runs).

### Pitfall 3: `filterPinnedBounties` label variable is dead but declared

**What goes wrong:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2317` declares `const filterLabel = t("nav.conversations.filterPinnedBounties", …)` but never uses `filterLabel` anywhere. It's a dead reference to a bounty-shaped i18n key. Left as-is, `eslint --max-warnings=0` may flag the unused variable, but the current lint config likely tolerates it (needs verification during execution).

**Why it happens:** Legacy from the pre-Phase-104 filter-toggle-by-bounty-count feature — the toggle was retired but its label variable outlived it.

**How to avoid:** Delete lines 2317-2319 as part of the frontend UI wave. Also check `src/ui/i18n/` (if present) for `filterPinnedBounties` key definition — that key may only exist in en/de/ja/etc translation JSON files and can be safely removed too. Grep verifies presence.

**Warning signs:** After delete, `tsc` clean but eslint may complain about `filterLabel` (unused var) if the lint scope was configured earlier. Better to just remove.

### Pitfall 4: The `identity-artifact-reader.two-step.test.ts` file is a shared-fixture test

**What goes wrong:** Deleting the file wholesale kills the history-side tests (11, 13, 15) and the resolveRoleForIdentity tests (6-8) that are LOAD-BEARING for the Phase 22 two-step reader pattern. Handoff/history are staying, so their coverage must stay.

**How to avoid:** Edit the file — delete only the bounty-specific describe blocks and the tests referencing `readIdentityBounties` (tests 10, 12, 14, 16). Leave describe blocks for `extractRoleFromMarkdown`, `extractCosmeticsFromFrontmatter`, `resolveRoleForIdentity`, `getLocalRolesRoot`, and `readIdentityHistory` tests intact.

**Warning signs:** After deletion, tests 11+13+15 (readIdentityHistory) fail because their shared fixture setup expected the bounty tests' side-effects. Run vitest scoped to this file after every edit.

### Pitfall 5: Substrate SKILL.md is fleet-visible source-of-truth

**What goes wrong:** Editing `substrate/skills/role/SKILL.md` doesn't take effect until (a) code ships to Skynet, (b) Skynet's distributor sweeps managed hosts, (c) each host restarts its supervisor or the file is re-read. Meanwhile new `/role <name>` calls on managed hosts still create `bounties/` from the OLD skill file. This isn't a bug in this phase — but the planner should NOT put this edit in a wave that assumes immediate effect.

**How to avoid:** Treat the SKILL.md edit as fire-and-forget for THIS phase (it ships with the Skynet deploy; managed hosts pick it up on next distributor sweep, which happens automatically per Phase 72). No follow-up verification needed within this phase — the distributor is trusted.

## Complete Enumeration of Bounty Reference Sites

**Discipline:** Every file that matches `grep -rEw "bounty|bounties|Bounty|Bounties|BOUNTY|BOUNTIES" src/` was opened and its hits classified. Files where every hit is a comment or false-positive are LEAVE_ALONE unless noted. Files listed here are ONLY files with load-bearing bounty content.

### Frontend UI

| File | Classification | Notes |
|------|----------------|-------|
| `src/ui/features/pretty-view/RoleModal.tsx` | EDIT_REMOVE | Strip `Target` icon import (L48), strip `RoleBountiesTab` import (L75), remove `{ value: "bounties", label: "Bounties", Icon: Target }` from NAV_SECTIONS (L88), remove `<TabsContent value="bounties">…</TabsContent>` block (L645-654), update the class-doc header at L18 that mentions "bounties" as a role-scope tab. |
| `src/ui/features/pretty-view/RoleBountiesTab.tsx` | DELETE_FILE | 385 lines, purely bounty UI. Only consumer is RoleModal.tsx. |
| `src/ui/features/pretty-view/BountyCard.tsx` | DELETE_FILE | 1561 lines, purely bounty UI. Only consumer is RoleBountiesTab.tsx. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | EDIT_REMOVE | Delete dead `filterLabel` declaration + `filterPinnedBounties` i18n key reference at L2317-L2319. Leave the ~15 comment-only references above (all describe RETIRED wires — historical context). |
| `src/ui/features/pretty-view/IdentityModal.tsx` | LEAVE_ALONE | 10 hits, all comments explaining what already got moved to RoleModal in Phase 90. Removing them removes historical wayfinding. |
| `src/ui/features/pretty-view/PrettyView.tsx` | LEAVE_ALONE | 14 hits, all "bounty pretty-view-*" GSD-workflow comments (unrelated concept) EXCEPT L3889 (`Patch #87: identity bounties modal…`) — a stale comment on the surviving IdentityModal block. Optionally scrub L3889 comment; not load-bearing. |
| `src/ui/features/pretty-view/ComposeBox.tsx` | LEAVE_ALONE | 32 hits, all "Bounty message-queue-in-pretty-view" style GSD-workflow comments — unrelated. |
| `src/ui/features/pretty-view/WakeupsTab.tsx` | LEAVE_ALONE | 1 hit — comment referencing BountyCard glass tokens for visual mirror. Since BountyCard is deleted, replace the comment with the token names (or delete the comment). Minor cleanup. |
| `src/ui/features/pretty-view/RoleModal.test.tsx` | EDIT_REMOVE | Strip `mockListBountiesForRoleName` block (L83-L88), strip mock injection (L102-L103), strip `beforeEach` bounty setup (L157-L160), strip "Bounties" assertion in Test A (L172-L193 needs revised 3-tab expectation), strip `mockListBountiesForRoleName.mockResolvedValue` references from other tests. 14 tests total; test A retitles to "renders 3 tabs — Role file / Runbooks / Wakeups". |
| `src/ui/features/pretty-view/RoleBountiesTab.test.tsx` | DELETE_FILE | 6 tests, all bounty-specific. |
| `src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx` | LEAVE_ALONE | Contains Test E "no Bounties nav button" — an assertion that IdentityModal doesn't render bounties. Post-retirement this test remains VALID and useful. |
| `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` | LEAVE_ALONE | Contains "does NOT render role-scope tabs (Role file / Runbooks / Bounties)" assertion. Same rationale as above. |
| `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` | EDIT_REMOVE | Line 78 comment references RoleBountiesTab + line 86-88 mocks listBountiesForRoleName. Delete both — test doesn't exercise bounty behavior. |

### Frontend API / State

| File | Classification | Notes |
|------|----------------|-------|
| `src/ui/api/claude-session-api.ts` | EDIT_REMOVE | Bulk deletion — see § Frontend API Surface for exact symbol list. Removes ~200 lines: `Bounty` type (L615-650), `BountyPriority`, `BOUNTY_PRIORITY_VALUES`, `BountyStatus`, `BOUNTY_STATUS_VALUES`, `BountyFieldsPatch`, all Identity*Bounty*Payload / Event types, all Role*Bounties*Event types, `listBountiesForRoleName` (L1531), and their entries in the discriminated union `ClaudeSessionServerFrame` (L495, L512-516). |
| `src/ui/api/claude-session-api.role-reads.test.ts` | EDIT_REMOVE | Delete describe block `listBountiesForRoleName one-shot helper` (L114-L179 — 2 tests: R3, R4). Leave getRoleFileByName + listRoleWakeupsByName describe blocks intact (4 tests). |
| `src/ui/main-axios.ts` | LEAVE_ALONE | Single-line comment (L378) — `close-out of bounty auth-slow-requests-on-pwa-boot` — historical GSD-workflow context. |
| `src/ui/api/compose-drafts-api.ts` | LEAVE_ALONE | Single comment about message-queue-in-pretty-view bounty (unrelated). |

### Backend WS Handlers + Route Wiring

| File | Classification | Notes |
|------|----------------|-------|
| `src/backend/claude-session/claude-session-server.ts` | EDIT_REMOVE | Bulk deletion — see § Backend API Surface for exact WS handler list. Removes: 10 imports from identity-artifact-reader (L78-L110 minus preserved history/handoff imports), doc header comment about all bounty wire types (L123-L212), `handleRoleListBounties` function (L1719-L1780) + `__handleRoleListBountiesForTests` export (L1986), the `if (msg.type === "role:list-bounties")` router branch (L6213), and the 8 `if (msg.type === "identity:*-bounty*")` router branches (L5692-L6810 approx). Total ~600 lines of straight deletion. |
| `src/backend/claude-session/identity-artifact-reader.ts` | EDIT_REMOVE | Delete: `normalizeBounty` (L1055-1096), `BOUNTY_PRIORITY_VALUES` + `BountyPriority` (L1418-1425), `BOUNTY_STATUS_VALUES` + `BountyStatus` + `TERMINAL_BOUNTY_STATUSES` (L1438-1450), `readIdentityBounties` (L1762+ ~200 lines), `BountyFieldsPatch` type (L2014), `IDMEDIT_MAX_BOUNTY_JSON_BYTES` constant (L2568), `readRoleBountiesByName` (L3916+ ~175 lines), `writeIdentityBountyPriority` (L4349+), `writeIdentityBountyStatus` (L4433+), `writeIdentityBountyPinned` (L4512+), `writeIdentityBountyNeedsDesk` (L4594+), `writeIdentityBountyFields` (L4703+ ~200 lines), `archiveIdentityBounty` (L4901+), `deleteIdentityBounty` (L5040+). Total ~1500 lines. Preserve `readIdentityFile`, `readIdentityHistory`, `readIdentityHandoff`, `resolveRoleForIdentity`, `readRoleFileByName`, all wakeup helpers, all avatar helpers, `readIdentityTrappedWork`. |
| `src/backend/database/routes/roles-create.ts` | EDIT_REMOVE | Delete ` && mkdir "$HOME/fleet/roles/${name}/bounties"` from the exec chain at L509. Update L44 docblock ("mkdir -p bounties/") and L292 ("+ bounties/") and L500 comment ("The nested `bounties/` subdir is added…"). |
| `src/backend/database/routes/roles-create.test.ts` | EDIT_REMOVE | Update the R-5 test comment at L406-407 (`mkdir CHILD/bounties`) to reflect the new atomic chain. Test behavior unchanged (still asserts 409 on EEXIST from the mkdir CHILD step). |

### Backend Reader Tests

| File | Classification | Notes |
|------|----------------|-------|
| `src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts` | DELETE_FILE | Whole file tests `archiveIdentityBounty`. |
| `src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts` | DELETE_FILE | Whole file tests `deleteIdentityBounty`. |
| `src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts` | DELETE_FILE | Whole file tests `writeIdentityBountyPinned`. |
| `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` | DELETE_FILE | Whole file tests `writeIdentityBountyStatus`. |
| `src/backend/claude-session/identity-artifact-reader.include-archived.test.ts` | DELETE_FILE | Whole file tests `readIdentityBounties` includeArchived semantics + WS handler. |
| `src/backend/claude-session/identity-artifact-reader.empty-bounties-remote.test.ts` | DELETE_FILE | Whole file tests `readIdentityBounties` empty-dir tolerance. |
| `src/backend/claude-session/identity-artifact-reader.two-step.test.ts` | EDIT_REMOVE | Delete tests 10, 12, 14 (readIdentityBounties two-step) + describe block wrapper for "readIdentityBounties + readIdentityHistory — two-step" at L273; PRESERVE tests 11, 13, 15 for readIdentityHistory (put them in a fresh `describe("readIdentityHistory — two-step")` block) + all `extractRoleFromMarkdown`, `extractCosmeticsFromFrontmatter`, `resolveRoleForIdentity`, `getLocalRolesRoot` tests (unchanged). Also delete the bounty import + fixture setup at L77 + L280-L306. |
| `src/backend/claude-session/identity-artifact-reader.trapped-work.test.ts` | LEAVE_ALONE | Two comment-only refs (`count-bounties.test.ts` file that no longer exists). Optional cleanup; not load-bearing. |
| `src/backend/claude-session/claude-session-server.role-reads.test.ts` | EDIT_REMOVE | Delete describe block `role:list-bounties WS handler` (L190-L299 — 6 tests) + `readRoleBountiesByName: vi.fn()` mock (L31) + `readRoleBountiesByName` import (L40) + `__handleRoleListBountiesForTests` import (L45) + `bounties?` + `archivedBounties?` fields in the SendPayload type (L56-57) + the `vi.mocked(readRoleBountiesByName).mockReset()` call (L79). Preserve role:get-file (5 tests) + role:list-wakeups (5 tests) describes. |
| `src/backend/claude-session/claude-session-server.role-file.test.ts` | LEAVE_ALONE | Comment-only refs to count-bounties.test.ts pattern (historical). |
| `src/backend/claude-session/claude-session-server.compose-send.test.ts` | LEAVE_ALONE | Comments about `pv-claude-session-ws-zombie-after-tmux-teardown` bounty — unrelated GSD-workflow. |
| `src/backend/claude-session/claude-session-server.layer1.test.ts` | LEAVE_ALONE | Comment-only. |
| `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` | LEAVE_ALONE | Comment about `count-bounties.test.ts` pattern (historical). |
| `src/backend/claude-session/layer1-detect.test.ts` | LEAVE_ALONE | 4 comment-only hits about bounty spec files. |
| `src/backend/claude-session/session-file-parser.test.ts` | LEAVE_ALONE | 4 comment-only + fixture bounty prose. |
| `src/backend/claude-session/session-file-parser.outbound-body.test.ts` | LEAVE_ALONE | 5 comment/fixture bounty prose. |

### Substrate / Distributed Skill

| File | Classification | Notes |
|------|----------------|-------|
| `substrate/skills/role/SKILL.md` | EDIT_REMOVE | LOAD-BEARING: this file is pushed by `src/backend/distributor/` to managed hosts and drives `/role <name>` behavior. Delete `mkdir -p "$ROLE_DIR/bounties"` at L64 + the "bounty pool" phrase from L4/L18 description + the "empty bounties/" mention in the L96 announcement + the "war-stories live in bounties" note at L89. |
| `src/backend/distributor/catalog.ts` | LEAVE_ALONE | Only comment refs — L48-52 already correctly documents the fleet-side retirement in a header comment. L8 reference to `~/fleet/roles/box-maintainer/bounties/ai-plus-mvp-project/` is historical shape-source-of-truth pointer. |

### Other Backend Files (all comment-only)

| File | Classification | Notes |
|------|----------------|-------|
| `src/backend/starter.ts` | LEAVE_ALONE | 11 hits, all "Bounty b31a5c8e-…" style GSD-workflow markers (unrelated concept). |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | LEAVE_ALONE | 8 comment refs to "bounty 9c8d4a72" (unrelated). |
| `src/backend/spawn-requests/scan-orchestrator.ts` | LEAVE_ALONE | 1 comment ref. |
| `src/backend/voice/*` | LEAVE_ALONE | All 4 files have comment-only refs to voice bounties (unrelated to id-skill bounties). |
| `src/backend/branding/*` | LEAVE_ALONE | 2 files with comment refs to branding-favicon bounty. |
| `src/backend/database/routes/compose-drafts.ts` + `users.ts` + `voice.test.ts` + `compose-drafts.test.ts` | LEAVE_ALONE | All comment-only refs. |
| `src/backend/matrix/matrix-admin-client.integration.test.ts` | LEAVE_ALONE | Single comment. |
| `src/backend/identity-birth/global-throttle.ts` | LEAVE_ALONE | Single comment. |
| `src/backend/ssh/host-semaphore-registry.ts` | LEAVE_ALONE | 3 comment refs to bounty b31a5c8e (unrelated). |
| `src/backend/distributor/run-sweep.ts` + `run-bootstrap.ts` | LEAVE_ALONE | Comment refs to substrate-sweep bounty (unrelated). |

## Backend API Surface (WS handlers to delete)

The following are ALL WebSocket message types served by Skynet for bounties. All 10 delete cleanly; no HTTP routes are involved (bounties never had a REST surface).

| WS incoming message type | WS response type | Handler location | Reader/writer function |
|--------------------------|------------------|------------------|------------------------|
| `identity:list-bounties` | `identity:bounties` | `claude-session-server.ts` L5695 branch | `readIdentityBounties` |
| `identity:update-bounty-priority` | `identity:bounty-priority-updated` | `claude-session-server.ts` — need to grep for exact line (branch not shown in first pass) | `writeIdentityBountyPriority` |
| `identity:update-bounty-status` | `identity:bounty-status-updated` | `claude-session-server.ts` L6521 branch | `writeIdentityBountyStatus` |
| `identity:update-bounty-pinned` | `identity:bounty-pinned-updated` | `claude-session-server.ts` L6599 branch | `writeIdentityBountyPinned` |
| `identity:update-bounty-needs-desk` | `identity:bounty-needs-desk-updated` | `claude-session-server.ts` L6675 branch | `writeIdentityBountyNeedsDesk` |
| `identity:update-bounty-fields` | `identity:bounty-fields-updated` | `claude-session-server.ts` L6751 branch | `writeIdentityBountyFields` |
| `identity:archive-bounty` | `identity:bounty-archived` | `claude-session-server.ts` L6378 branch | `archiveIdentityBounty` + `readIdentityBounties` |
| `identity:delete-bounty` | `identity:bounty-deleted` | `claude-session-server.ts` L6450 branch | `deleteIdentityBounty` + `readIdentityBounties` |
| `role:list-bounties` | `role:bounties-loaded` | `claude-session-server.ts` L1719 (`handleRoleListBounties`) + L6213 router branch | `readRoleBountiesByName` |

**Reader / writer exports from `identity-artifact-reader.ts` to delete** (all confirmed as having ZERO consumers outside `claude-session-server.ts` + bounty test files):

- `normalizeBounty` (internal helper, not exported)
- `readIdentityBounties`
- `readRoleBountiesByName`
- `writeIdentityBountyPriority`
- `writeIdentityBountyStatus`
- `writeIdentityBountyPinned`
- `writeIdentityBountyNeedsDesk`
- `writeIdentityBountyFields`
- `archiveIdentityBounty`
- `deleteIdentityBounty`

**Types + constants from `identity-artifact-reader.ts` to delete:**

- `BOUNTY_PRIORITY_VALUES` (readonly array)
- `BountyPriority` (union type)
- `BOUNTY_STATUS_VALUES` (readonly array)
- `BountyStatus` (union type)
- `TERMINAL_BOUNTY_STATUSES` (readonly array)
- `BountyFieldsPatch` (type)
- `IDMEDIT_MAX_BOUNTY_JSON_BYTES` (constant)

## Frontend API Surface (helpers + types to delete)

**From `src/ui/api/claude-session-api.ts`** (all confirmed as having ZERO consumers outside RoleBountiesTab.tsx + bounty test files):

**Function exports:**
- `listBountiesForRoleName` (L1531)

**Type exports (all under the "Patch #87: identity bounties WS wire types" doc block starting L602):**
- `Bounty` (interface)
- `BOUNTY_PRIORITY_VALUES` (readonly array + `BountyPriority` union)
- `BOUNTY_STATUS_VALUES` (readonly array + `BountyStatus` union)
- `BountyFieldsPatch` (type)
- `IdentityListBountiesPayload`, `IdentityBountiesEvent`
- `IdentityUpdateBountyPriorityPayload`, `IdentityBountyPriorityUpdatedEvent`
- `IdentityUpdateBountyStatusPayload`, `IdentityBountyStatusUpdatedEvent`
- `IdentityUpdateBountyPinnedPayload`, `IdentityBountyPinnedUpdatedEvent`
- `IdentityUpdateBountyNeedsDeskPayload`, `IdentityBountyNeedsDeskUpdatedEvent`
- `IdentityUpdateBountyFieldsPayload`, `IdentityBountyFieldsUpdatedEvent`
- `IdentityArchiveBountyPayload`, `IdentityBountyArchivedEvent`
- `IdentityDeleteBountyPayload`, `IdentityBountyDeletedEvent`
- `RoleListBountiesPayload`, `RoleBountiesLoadedEvent`

**Discriminated union entries to remove from `ClaudeSessionServerFrame` (or equivalent server-frame union):**
- L495: `| IdentityBountiesEvent`
- L512-L516: 5 more `Identity*Updated`/`*Deleted` entries

## Test File Impact — Detailed Enumeration

**DELETE_FILE (7 files, ~800 lines of test code):**
1. `src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts`
2. `src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts`
3. `src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts`
4. `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts`
5. `src/backend/claude-session/identity-artifact-reader.include-archived.test.ts`
6. `src/backend/claude-session/identity-artifact-reader.empty-bounties-remote.test.ts`
7. `src/ui/features/pretty-view/RoleBountiesTab.test.tsx`

**EDIT_REMOVE (5 files):**
1. `src/backend/claude-session/identity-artifact-reader.two-step.test.ts` — remove tests 10/12/14/16 + shared bounty fixture setup at L280-306; preserve tests for extract/resolve/getLocalRolesRoot/readIdentityHistory.
2. `src/backend/claude-session/claude-session-server.role-reads.test.ts` — remove `role:list-bounties WS handler` describe (6 tests) + `readRoleBountiesByName` mock/import + `__handleRoleListBountiesForTests` import + bounty fields on SendPayload type.
3. `src/backend/database/routes/roles-create.test.ts` — update R-5 test comment referencing `mkdir CHILD/bounties` (the shell command in the test's mock is unchanged in effect, but comment text should reflect the new atomic chain).
4. `src/ui/api/claude-session-api.role-reads.test.ts` — remove `listBountiesForRoleName one-shot helper` describe (2 tests).
5. `src/ui/features/pretty-view/RoleModal.test.tsx` — retitle Test A (4 tabs → 3 tabs), strip Bounties nav assertion, strip `mockListBountiesForRoleName` scaffold, strip all `mockListBountiesForRoleName.mockResolvedValue(…)` calls from bodies of Test B-M.
6. `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` — strip `listBountiesForRoleName` mock at L86-88.

**LEAVE_ALONE (no bounty tests, only historical comments):**
- `identity-artifact-reader.trapped-work.test.ts`, `claude-session-server.role-file.test.ts`, `claude-session-server.compose-send.test.ts`, `claude-session-server.layer1.test.ts`, `claude-session-server.fetch-older-range.test.ts`, `layer1-detect.test.ts`, `session-file-parser.test.ts`, `session-file-parser.outbound-body.test.ts`, `IdentityModal.title-line-jump.test.tsx`, `IdentityModal.scope-switch.test.tsx` — the last two ASSERT ABSENCE of Bounties nav, which is still valuable post-retirement.

## Types and Schemas

All bounty-shaped types live in exactly 2 files, both edited in this phase:

1. **Backend:** `src/backend/claude-session/identity-artifact-reader.ts` — `BountyPriority`, `BountyStatus`, `BountyFieldsPatch`, `BOUNTY_PRIORITY_VALUES`, `BOUNTY_STATUS_VALUES`, `TERMINAL_BOUNTY_STATUSES`, `IDMEDIT_MAX_BOUNTY_JSON_BYTES`. Only imported by `claude-session-server.ts` (which is being edited to drop the imports) and the bounty-scoped test files (being deleted).
2. **Frontend wire types:** `src/ui/api/claude-session-api.ts` — `Bounty`, `BountyPriority`, `BountyStatus`, `BountyFieldsPatch`, ~14 `Identity*Bounty*` payload/event types, 2 `Role*Bounties*` payload/event types. Only imported by `RoleBountiesTab.tsx` (`Bounty` type) and the test file (being deleted).

**Zero cross-domain re-exports.** No barrel file re-exports Bounty types; no shared `types/` module contains them. Deletion is surgical.

## File-system Side Effects

**Skynet backend startup routines** were audited for any code that enumerates or requires `bounties/` directories:

- `src/backend/fleet-status/*` — polls for identity status; does NOT touch bounties.
- `src/backend/identity-birth/*` — creates identities; does NOT touch bounties (role folder creation is separate via `/roles` POST endpoint).
- `src/backend/database/routes/roles-create.ts` — DOES create `bounties/` at role creation time (L509 exec chain). Being edited.
- `src/backend/distributor/*` — pushes substrate files; does NOT enumerate `bounties/`.
- `src/backend/spawn-requests/*` — scans for spawn requests; does NOT touch bounties.
- `src/backend/starter.ts` — server bootstrap; does NOT touch bounties.

**Verified:** No startup routine assumes `bounties/` exists. Deleting the mkdir at L509 is safe — no other Skynet code will crash on missing `bounties/`.

**Managed host side:** `~/fleet/roles/<role>/bounties/` directories exist on every host where roles were created via `/role` (dozens across the fleet per user's workflow — box-maintainer, tina, tabitha, etc.). After retirement these are orphan directories with `.json` files inside. NO cleanup motion is proposed in this phase per user's scope directive.

**Substrate-pushed skill:** `substrate/skills/role/SKILL.md` L64 also writes `mkdir -p "$ROLE_DIR/bounties"` — this is the SOURCE-OF-TRUTH for `/role` on managed hosts. Editing this file causes the distributor to re-push it on next sweep, at which point managed-host `/role <new-name>` calls will no longer spawn `bounties/` folders. Belongs in this phase.

## Suggested Wave Structure

Dependencies flow: **UI consumer → API helper → WS handler → reader/writer** (top-to-bottom). Deletions can occur in either direction; TypeScript enforces synchronization. Given the risk of orphan-import cascades (§ Pitfall 1), a **bottom-up** approach (delete leaves first) minimizes intermediate-state broken commits.

### Wave 0: SKILL.md + roles-create.ts foundation edits (parallel, independent)

Two files that are logically independent from the TypeScript deletion chain:

- **T-0A:** `substrate/skills/role/SKILL.md` — delete mkdir line + rewrite bounty prose. Independent from all TS code.
- **T-0B:** `src/backend/database/routes/roles-create.ts` (delete `&& mkdir "…/bounties"` from L509 exec chain) + `src/backend/database/routes/roles-create.test.ts` (update R-5 comment). Independent from the bounty reader/handler chain — only touches the `POST /roles` endpoint's SSH exec string.

Both can execute in parallel. Wave-0 gate: full scoped vitest on `roles-create.test.ts` + `npm run build:backend`.

### Wave 1: Leaf deletions (parallel, no cross-file dependencies)

Files that ONLY contain bounty content and have no non-bounty siblings. All 7 test files + 2 UI components delete cleanly in parallel.

- **T-1A:** DELETE `src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts`
- **T-1B:** DELETE `src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts`
- **T-1C:** DELETE `src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts`
- **T-1D:** DELETE `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts`
- **T-1E:** DELETE `src/backend/claude-session/identity-artifact-reader.include-archived.test.ts`
- **T-1F:** DELETE `src/backend/claude-session/identity-artifact-reader.empty-bounties-remote.test.ts`
- **T-1G:** DELETE `src/ui/features/pretty-view/RoleBountiesTab.test.tsx`

Wave-1 gate: nothing breaks — deleting a test file cannot break `tsc` or other tests. Full vitest run confirms remaining tests still pass.

### Wave 2: UI surgery (sequential in a single task, or 2 parallel tasks)

Frontend changes that MUST happen atomically because they share type imports:

- **T-2A:** `src/ui/features/pretty-view/RoleModal.tsx` + `src/ui/features/pretty-view/RoleModal.test.tsx` — edit both in same commit (strip Bounties tab + nav entry + import + test setup + Test A retitle).
- **T-2B:** `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` — strip listBountiesForRoleName mock (independent from T-2A; can parallelize).
- **T-2C:** DELETE `src/ui/features/pretty-view/RoleBountiesTab.tsx` (only import lives in RoleModal.tsx, gone in T-2A).
- **T-2D:** DELETE `src/ui/features/pretty-view/BountyCard.tsx` (only import was RoleBountiesTab, gone in T-2C).
- **T-2E:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — delete dead `filterLabel` + `filterPinnedBounties` i18n key (independent; can parallelize).

**Sequencing note:** T-2A must land before T-2C; T-2C must land before T-2D. T-2A/T-2B/T-2E can parallelize. Recommendation: single sequential task for T-2A → T-2C → T-2D; parallel tasks for T-2B + T-2E.

Wave-2 gate: `npx tsc --noEmit -p tsconfig.app.json` + scoped vitest on `src/ui/features/pretty-view/**/*.test.tsx` + `src/ui/features/pretty-conversations/**/*.test.tsx`.

### Wave 3: Frontend API layer

- **T-3A:** `src/ui/api/claude-session-api.ts` — delete `listBountiesForRoleName`, all `Bounty` types, all `Identity*Bounty*` + `Role*Bounties*` payload/event types, remove entries from `ClaudeSessionServerFrame` union.
- **T-3B:** `src/ui/api/claude-session-api.role-reads.test.ts` — delete `listBountiesForRoleName one-shot helper` describe block.

Sequential: T-3A then T-3B (types disappear first). Wave-3 gate: `npx tsc --noEmit -p tsconfig.app.json` clean + scoped vitest on api-role-reads.

### Wave 4: Backend WS handlers + router

- **T-4A:** `src/backend/claude-session/claude-session-server.ts` — delete all 10 bounty WS handler branches (identity:*-bounty* × 8, identity:list-bounties, role:list-bounties) + `handleRoleListBounties` function + `__handleRoleListBountiesForTests` export + imports from identity-artifact-reader for bounty helpers + doc-header comment updates for the WS wire type inventory (L123-L212).
- **T-4B:** `src/backend/claude-session/claude-session-server.role-reads.test.ts` — delete `role:list-bounties WS handler` describe + `readRoleBountiesByName` mock/import + `__handleRoleListBountiesForTests` import + bounty fields on SendPayload.

Sequential: T-4A then T-4B. Wave-4 gate: `npm run build:backend` clean + scoped vitest on `src/backend/claude-session/**/*.test.ts`.

### Wave 5: Backend readers/writers + types

- **T-5A:** `src/backend/claude-session/identity-artifact-reader.ts` — delete all bounty readers/writers + `normalizeBounty` + `BountyPriority`/`BountyStatus`/`BountyFieldsPatch`/constants.
- **T-5B:** `src/backend/claude-session/identity-artifact-reader.two-step.test.ts` — remove tests 10/12/14/16 + bounty fixtures; preserve history + resolve tests.

Sequential: T-5A then T-5B. Wave-5 gate: `npm run build:backend` clean + scoped vitest on `src/backend/claude-session/identity-artifact-reader.*.test.ts`.

### Wave 6: Phase-wide gate

- **T-6A:** `npm run build:backend` + `npm run build` (frontend build) + `npx vitest run` (full suite) + `grep -rEw "Bounty|Bounties|bounty|bounties" src/` audit — output should ONLY match retained historical-comment references (starter.ts, fleet-status, voice/, etc. from the LEAVE_ALONE bucket).

**Total waves:** 6. **Parallelism payoff:** Wave 1 has 7-way parallelism; Wave 2 has 3-way; other waves are sequential-in-a-single-task by dependency shape.

## Risks and Landmines

### R-1: Bounty types re-exported from a barrel file
**Investigation:** `grep -rn "export.*\{.*Bounty" src/` shows exports ONLY in `identity-artifact-reader.ts` and `claude-session-api.ts`. No barrel file re-exports Bounty types. **CLEAR.**

### R-2: WebSocket message types with `bounty:*` prefix in the wire protocol
**Investigation:** All bounty wire types use `identity:*-bounty-*` or `role:*-bounties` prefixes and are handled in explicit `if (msg.type === "identity:xxx")` router branches within `claude-session-server.ts`. No dynamic dispatch table, no message-type array to update elsewhere. Deletion of the branches is sufficient. **CLEAR.**

### R-3: Database schema references
**Investigation:** `grep -nE "bount|Bount" src/backend/database/db/schema.ts` returns 1 hit — a comment referencing a `bounty)` in a different context (host-side-base URL migration commentary). No DB tables named `bounties`, no columns holding bounty IDs. **CLEAR.**

### R-4: Skynet-side stub `bounties/` directory creation code
**Investigation:** ONE creation site — `src/backend/database/routes/roles-create.ts` L509. Also ONE in the distributed substrate skill — `substrate/skills/role/SKILL.md` L64. Both in scope. **HANDLED via Wave 0.**

### R-5: `filterPinnedBounties` i18n key
**Investigation:** Dead variable in `PrettyConversationsPanel.tsx` L2317. The `t()` translation resolver may look up the key at runtime and fall back to `defaultValue`. If translation JSON files carry `filterPinnedBounties` as an actual key, delete those too. Grep `crowdin.yml` config + any `src/ui/i18n/` files during Wave 2. **LOW RISK** — even if the JSON key stays, it's inert.

### R-6: The Bounty tab appears in identity modal too
**Investigation:** Phase 90 already removed the Bounties tab from IdentityModal (verified in `IdentityModal.tsx` L1503/L1521 with load-bearing comments + `IdentityModal.title-line-jump.test.tsx` Test E asserts absence of the tab). NO surgery needed on IdentityModal — the retirement propagates through unchanged. **CLEAR.**

### R-7: The comment-only bounty references form documentation
**Investigation:** ~40 files carry comments like "Bounty b31a5c8e Phase 101" or "Bounty pretty-view-per-pane-cost-diag" — these are historical GSD-workflow markers, not references to the retired id-skill bounty concept. Scrubbing them would delete valuable "why does this code look this way" prose. Explicitly LEAVE_ALONE. **NON-ISSUE if left alone; MAJOR ISSUE if scrubbed.**

### R-8: RoleBountiesTab's `type Bounty` is imported for a reason
**Investigation:** `RoleBountiesTab.tsx` imports `type Bounty` and uses it in a sort-helper signature (`function sortBounties(bounties: Bounty[]): Bounty[]`) and the tab's state. Since the entire file is deleted in Wave 2, the type-consumer disappears cleanly. **CLEAR.**

## Verification Approach

After each wave, run:

**Per-commit (per task):**
- Frontend: `npx tsc --noEmit -p tsconfig.app.json`
- Backend: `npm run build:backend`
- Scoped tests: `npx vitest run <path/to/touched/tests>`

**Per-wave merge:**
- Full vitest: `npx vitest run` (all unit + integration tests)

**Phase gate (Wave 6):**
1. `npm run build:backend` — exit 0 (backend TypeScript typechecks)
2. `npm run build` — exit 0 (frontend Vite build succeeds — this catches type errors in .tsx files that only surface through the Vite pipeline)
3. `npx vitest run` — full suite passes
4. `git grep -nE "\b(readIdentityBounties|readRoleBountiesByName|writeIdentityBounty[A-Z]|archiveIdentityBounty|deleteIdentityBounty|listBountiesForRoleName|RoleBountiesTab|BountyCard|BountyPriority|BountyStatus|BountyFieldsPatch|BOUNTY_PRIORITY_VALUES|BOUNTY_STATUS_VALUES|TERMINAL_BOUNTY_STATUSES|IDMEDIT_MAX_BOUNTY_JSON_BYTES|handleRoleListBounties|__handleRoleListBountiesForTests|normalizeBounty)\b" src/` — MUST return zero hits (all surface symbols gone)
5. `git grep -nE "\brole:list-bounties\b|\brole:bounties-loaded\b|\bidentity:list-bounties\b|\bidentity:bounties\b|\bidentity:update-bounty|\bidentity:bounty-|\bidentity:archive-bounty\b|\bidentity:delete-bounty\b" src/` — MUST return zero hits (all wire type strings gone)
6. `git grep -nE "\b(bount|Bount)" src/` — Human review pass: every remaining hit should be a comment/prose reference to a HISTORICAL GSD-workflow bounty (unrelated concept), NOT to the retired id-skill bounty concept. Expected surviving hits: ~40 files, ~150 occurrences, all in comments.

**Optional bonus:** Playwright smoke on the RoleModal open flow to verify the 3-tab UI renders without JavaScript errors.

## Environment Availability

*Skip — this phase has no external dependencies. Pure code/config deletion.*

## Validation Architecture

*Skip — `workflow.nyquist_validation` is `false` in `.planning/config.json`.*

## Security Domain

*This phase has minimal security surface:*

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (no auth changes) |
| V3 Session Management | no | (no session changes) |
| V4 Access Control | no | (no access changes) |
| V5 Input Validation | no | (all deleted handlers already validated identityKey/bountySlug against IDENTITY_KEY_RE / IDENTITY_SLUG_RE; validation deletes with the handlers — no residual attack surface) |
| V6 Cryptography | no | (no crypto) |

**Threat model:** No new attack surface introduced. Deletion of validated WS handlers cannot regress security. The `mkdir "$HOME/fleet/roles/${name}/bounties"` command being removed from `roles-create.ts` uses a shell interpolation but `name` is pre-validated by `ROLE_NAME_PATTERN` (see L503 comment) — deletion is neutral.

**One subtle note:** The `writeIdentityBountyFields` handler (~200 lines being deleted) contained the most complex input-validation logic in the bounty surface. When deleting, do NOT preserve pieces of that validation for other uses — the validation is coupled to the `BountyFieldsPatch` schema which is going away. Full amputation is cleanest.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The substrate skill file `substrate/skills/role/SKILL.md` is pushed unmodified by the distributor to managed hosts on next sweep — no build-time transformation. | Runtime State Inventory | If a transformation exists, the edit might not propagate. `src/backend/distributor/catalog.ts` L48 header comment implies verbatim push; safe assumption. **[ASSUMED]** |
| A2 | Deleting `filterPinnedBounties` i18n key from the panel is safe even if translation JSON files carry it as a key. | Pitfall 3 | LOW — inert if left; also harmless to delete. **[ASSUMED]** |
| A3 | The user's "correctly removed" phrasing includes the substrate SKILL.md edit + the roles-create mkdir edit, not just the visible modal. | Locked Decisions | HIGH if wrong — phase would need re-plan. Cross-referenced against phase description ("full retire, not just the visible modal tab") which supports this reading. **[ASSUMED]** |
| A4 | Handoffs + history stay untouched (out of scope). | Deferred Ideas | LOW — phase description explicitly names bounties only; the id-skill commit `aa9d36b9` retired handoffs+history too but that's a separate follow-on. **[ASSUMED — worth user confirmation in discuss-phase]** |
| A5 | No hidden HTTP route serves bounty data — all bounty ops flow through WebSocket. | Backend API Surface | Verified via `grep -rn "bount" src/backend/database/routes/`  — only the roles-create `mkdir bounties/` line showed up, which is a filesystem side-effect not an HTTP endpoint. **HIGH confidence.** |

## Open Questions

1. **Should we scrub the L3889 comment in `PrettyView.tsx`?**
   - What we know: The comment `Patch #87: identity bounties modal…` sits above the `<IdentityModal>` mount. IdentityModal no longer serves bounties (Phase 90 retirement).
   - What's unclear: Whether the comment is orienting readers to a historical patch context (has value) or just stale (has no value).
   - Recommendation: Update the comment to remove "bounties" but keep the Patch #87 context marker — one-line cleanup.

2. **Are there RESTful HTTP endpoints under `/api/*` that mention bounties?**
   - What we know: `grep -rn "bount" src/backend/*/routes/` only surfaces `roles-create.ts` (in-scope) and `users.ts` / `compose-drafts.ts` (comment-only, unrelated GSD-workflow).
   - What's unclear: Whether any HTTP endpoint exists that isn't under a `routes/` directory (unlikely given the codebase convention).
   - Recommendation: During Wave 6 verification, add a `git grep -rE "app\.(get|post|put|delete|patch).*bount" src/` — if this returns any hits, they're additional retirement targets.

3. **Is `~/fleet/roles/box-maintainer/bounties/` referenced as a shape-source in comments that a follow-on phase would need to preserve?**
   - What we know: `distributor/catalog.ts` L8 and `session-file-parser.ts` L247 reference specific bounty folders as shape-source-of-truth for OTHER work products (design docs, corpus samples).
   - What's unclear: Whether the fleet-side data cleanup phase would want to preserve those specific `bounty.json` files as historical artifacts.
   - Recommendation: OUT OF SCOPE for this phase. Flag for the follow-on managed-host-cleanup phase (if user schedules one).

## Sources

### Primary (HIGH confidence)
- Direct `grep -rilEw "bounty|bounties|Bounty|Bounties" src/` + per-file `Read` tool inspection of all 40+ files with non-trivial hit counts.
- Direct `Read` of load-bearing files: `RoleModal.tsx`, `RoleBountiesTab.tsx` (partial), `identity-artifact-reader.ts` (partial), `claude-session-server.ts` (partial), `claude-session-api.ts` (partial), `roles-create.ts` (partial), `substrate/skills/role/SKILL.md` (full).
- `.planning/ROADMAP.md` L49 (Phase 22 origin) + L2857 (Phase 136 declaration) + L703 (recent-additions log).
- `git log` referenced commits: `fc98066d`, `aa9d36b9` (retirement commits in id-skill/substrate — via user-provided phase description; not directly inspected in this session).

### Secondary (MEDIUM confidence)
- Test-file structure derived from `grep -nE "^describe|^\s*it"` outputs (not full-file reads for every test).
- Line-number estimates for backend WS handler branches derived from single-pass greps; planner should re-grep for exact numbers before editing.

### Tertiary (LOW confidence)
- Assumption A3 (user-intent scope) — extracted from phase description prose, not from an explicit CONTEXT.md.
- Assumption A4 (handoffs stay in scope for a future phase) — inferred from phase description narrowness.

## Metadata

**Confidence breakdown:**
- Complete enumeration of reference sites: HIGH — every file was word-boundary grepped, ranked by hit count, and sampled by opening.
- Backend/frontend API surface enumeration: HIGH — every symbol grep-verified.
- Wave breakdown: MEDIUM — depends on TS compile-order assumption; verified against the dependency graph but not empirically compiled.
- Substrate SKILL.md scope inclusion: MEDIUM — Assumption A3 needs user confirmation.

**Research date:** 2026-09-23
**Valid until:** 2026-10-23 (stable dead-code retirement scope; only ROADMAP additions or new bounty-referencing code would invalidate).
