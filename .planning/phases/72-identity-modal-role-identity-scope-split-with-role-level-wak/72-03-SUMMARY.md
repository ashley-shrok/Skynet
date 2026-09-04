---
phase: 72-identity-modal-role-identity-scope-split-with-role-level-wak
plan: 03
subsystem: frontend
tags: [identity-modal, scope-switch, zustand-store, per-scope-tabs, wakeup-crud-wiring, role-view, identity-view]

requires:
  - phase: 72
    plan: 01
    provides: "6 backend WS handlers (identity:*-role-wakeup + identity:create-wakeup + identity:delete-wakeup) consumed by the 6 new CRUD handlers in this plan"
  - phase: 72
    plan: 02
    provides: "WakeupsTab (scope prop + onCreate/onDelete callback contract) + AddWakeupDialog sub-modal + WakeupSpecWire wire type"
  - phase: 67
    plan: 01
    provides: "identity.coordinator boolean (non-nullable, derived from on-disk YAML frontmatter) — consumed for coord-vs-actor default scope on modal open"

provides:
  - "Segmented Role/Identity scope switch at the top of IdentityModal body, above the Tabs component"
  - "Per-identity scope memory via modal-scope-store (Zustand-shaped, browser-session lifetime, no persistence)"
  - "Per-scope conditional NAV_SECTIONS in the bottom icon-bar (4 tabs Role, 3 tabs Identity)"
  - "Two Wakeups tab panes (value=identity-wakeups + value=role-wakeups), each wired to its scope's WS handlers"
  - "6 new CRUD handlers on IdentityModal: createIdentityWakeup, deleteIdentityWakeup, updateRoleWakeup, createRoleWakeup, deleteRoleWakeup (existing updateWakeup preserved for identity-scope update)"
  - "Wave 2's WakeupsTab call-site stubs REPLACED — no more no-op onCreate/onDelete, no more TODO Wave 3 comment"
  - "8-test coverage of scope switch behavior + 4-test WS-message integration coverage of wakeup CRUD wire types"

affects: [72-04, identity-modal, role-view, identity-view, wakeups-tab]

tech-stack:
  added: []
  patterns:
    - "Zustand-shaped module-scoped store keyed by identityKey with in-memory-only lifetime (mirrors bounty-counts-store.ts shape adapted for scalar value)"
    - "useSyncExternalStore-backed React subscription semantics with subscriber notify on every write"
    - "Scope-conditional NAV_SECTIONS derived from a single `scope === 'role' ? ROLE : IDENTITY` ternary — no runtime allocation cost per render (arrays are const-declared inside the component body)"
    - "Scope-flip auto-resets activeTab to the new scope's default landing tab via a useEffect on scope — solves the stale-tab-not-in-new-NAV_SECTIONS problem"
    - "Radix TabsContent id-suffix (`content-<value>`) as the reliable pane-identity assertion (no data-value attribute is emitted; the id encodes the value)"

key-files:
  created:
    - "src/ui/state/modal-scope-store.ts (~113 lines, 5 exports + module-scoped Map + subscribe/notify)"
    - "src/ui/state/modal-scope-store.test.ts (~175 lines, 8 unit tests)"
    - "src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx (~305 lines, 8 tests S1-S8)"
    - "src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx (~370 lines, 4 tests W1-W4)"
  modified:
    - "src/ui/features/pretty-view/IdentityModal.tsx (+segmented scope switch UI, +useModalScope wiring, +5 CRUD handlers, +roleWakeupsState + parallel fetch, +2 wakeups panes, NAV_SECTIONS split into ROLE + IDENTITY variants, activeTab scope-derived + auto-reset on flip)"
    - "src/ui/features/pretty-view/IdentityModal.test.tsx (+defensive switchScope helper below renderModal — no test-body rewrites needed)"
    - "src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx (tests 21-24 REWRITTEN for scope-split: 21a/21b coord-vs-actor defaults, 22a/22b per-scope NAV_SECTIONS counts, 23/24 switchScope('role') preamble)"
    - "src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx (+switchScope helper, renderModalOnBountiesTab prepends switchScope('role'), test K migrated to shared helper)"
    - "src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx (+switchScope helper, renderModal appends switchScope('role') + Bounties nav click so archive accordion is reachable via getByRole)"
    - "src/ui/features/pretty-view/IdentityModal.voice.test.tsx (+defensive __resetModalScopeForTest in beforeEach)"
    - "src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx (+defensive __resetModalScopeForTest in beforeEach)"

key-decisions:
  - "Radix TabsContent id-suffix pattern used to assert active pane identity — Radix does NOT emit data-value on TabsContent, but does encode value in id (`radix-<hash>-content-<value>`). Initial attempt at data-value failed; switched to id-regex matching (`/content-<value>$/`)"
  - "activeTab auto-reset via useEffect on scope-change rather than lazy tab-existence check — cleaner semantics (user always lands on the scope's default) + avoids the DOM-error edge case of trying to render a TabsContent whose value isn't in the current NAV_SECTIONS"
  - "Wakeups tab labels stayed as 'Wakeups' under both scopes — the top segmented switch already disambiguates scope; adding 'Role wakeups' / 'Identity wakeups' labels would violate CONTEXT.md's 'picker-in-tab is redundant' rule"
  - "First-tab labels moved from 'Role' / 'Identity' (position-0 in the pre-72 flat NAV_SECTIONS) to 'Role file' / 'Identity file' — the scope switch owns scope, so the tab label describes the artifact. Ashley's shape file variant D mockup matches this treatment"
  - "Coord-vs-actor default computed at IdentityModal call site (not inside modal-scope-store) — keeps the store's single responsibility (remember user choice) and lets future callers pick their own default"
  - "modal-scope-store notify fires on every setModalScope call, even when value is unchanged — user taps are intent signals; spurious no-op re-renders are cheap and preferable to swallowing a tap"
  - "wakeupsState → identityWakeupsState rename made COMPLETE (word-boundary grep = 0) — the old name no longer disambiguates now that a parallel roleWakeupsState lives beside it. Every code + comment reference updated in one commit"
  - "Both wakeups WS fetches (identity + role) fire on modal open, not gated on scope — pre-fetching both means a scope switch reveals the list without a wait; the extra WS is cheap"
  - "Test-side switchScope helper duplicated inline into each affected test file (per plan spec) rather than extracted to shared util — keeps each test-file diff independently reviewable + isolated"

patterns-established:
  - "Radix TabsContent active-pane assertion via id-suffix: `activePanel.getAttribute('id')?.match(/content-<value>$/)` — reliable across Radix versions since the value-encoding into id is documented behavior"
  - "Module-scoped scope-store: keyed by identityKey, notify on every write, browser-session lifetime, no localStorage — appropriate default for per-entity UI state memory"

requirements-completed: []

# Metrics
duration: 40min
completed: 2026-09-04
---

# Phase 72 Plan 03: IdentityModal scope switch + per-scope Wakeups panes Summary

**The load-bearing structural change of Phase 72 is now landed. IdentityModal renders a segmented Role/Identity scope switch at the top; the bottom icon-bar reshuffles per scope (4 tabs Role, 3 tabs Identity); scope is remembered per-identity within a browser session via a Zustand-shaped store; both scopes' Wakeups tabs list the correct scope's wakeups and route create/update/delete through the matching scope's WS handlers.**

## Performance

- **Duration:** ~40 minutes end-to-end (3 tasks + 4 commits + tsc + scoped tests across all 9 files)
- **Started:** 2026-09-04T08:47Z (approx, per pre-Task-1 file reads)
- **Completed:** 2026-09-04T09:27Z (at final commit time)
- **Tasks:** 3 / 3 completed
- **Files created:** 4 (modal-scope-store.ts + .test.ts + IdentityModal.scope-switch.test.tsx + IdentityModal.wakeup-crud.test.tsx)
- **Files modified:** 7 (IdentityModal.tsx + 6 IdentityModal.*.test.tsx test files)

## Accomplishments

### Task 1 — modal-scope-store.ts + 8 unit tests (commit cc99d4af)

New module-scoped Zustand-shaped store `src/ui/state/modal-scope-store.ts`:

| Export | Type | Purpose |
| ------ | ---- | ------- |
| `ModalScope` | type | `"role" \| "identity"` |
| `useModalScope(identityKey)` | React hook | useSyncExternalStore-backed subscription; returns `undefined` when key is null or no entry exists |
| `setModalScope(identityKey, scope)` | function | writes to the map + notifies all subscribers |
| `getModalScope(identityKey)` | function | synchronous non-hook read (no subscription side-effect) |
| `__resetModalScopeForTest` | function | test-only reset used in every consumer test's beforeEach |

Mirrors `bounty-counts-store.ts` shape (listeners Set + notify + reset-for-test), adapted for scalar value model. Zero browser-storage APIs touched (auditable via `grep -cE 'localStorage|sessionStorage' src/ui/state/modal-scope-store.ts` returning 0). No module-load side effects.

`modal-scope-store.test.ts` — 8 unit tests: null-key short-circuit, pre-write undefined, round-trip read/write, per-identity isolation (no cross-key leak), sequential-write latest-wins, subscriber re-render count, reset clears map, getModalScope non-hook read matches hook.

### Task 2a — IdentityModal.tsx production changes (commit ad308adc)

**Segmented scope switch UI** — mounts at `IdentityModal.tsx:1745-1795` (approximate line range in post-edit file), ABOVE the `<Tabs>` component at L1806 and BELOW the title/avatar editor region. Two rounded-pill buttons in a hue-tinted glass capsule; `aria-pressed` encodes selection; `data-testid="scope-switch-role"` / `data-testid="scope-switch-identity"` for tests. Visual grounded against the sketch's variant D coordinator + actor mockups at `.planning/sketches/001-identity-modal-role-vs-identity-split/index.html`.

**State + default derivation** at L245-262:
```ts
const storedScope = useModalScope(identity.identityKey);
const defaultScope: ModalScope = identity.coordinator ? "role" : "identity";
const scope: ModalScope = storedScope ?? defaultScope;
const onScopeChange = useCallback(
  (next: ModalScope) => setModalScope(identity.identityKey, next),
  [identity.identityKey],
);
const [activeTab, setActiveTab] = useState<string>(scope === "role" ? "role" : "identity");
useEffect(() => {
  setActiveTab(scope === "role" ? "role" : "identity");
}, [scope]);
```

**NAV_SECTIONS split** at L308-319:
```ts
const NAV_SECTIONS_ROLE = [
  { value: "role",         label: "Role file",     Icon: Users },
  { value: "bounties",     label: "Bounties",      Icon: Target },
  { value: "history",      label: "History",       Icon: Clock },
  { value: "role-wakeups", label: "Wakeups",       Icon: AlarmClock },
] as const;
const NAV_SECTIONS_IDENTITY = [
  { value: "identity",         label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups",       Icon: AlarmClock },
  { value: "handoff",          label: "Handoff",       Icon: Handshake },
] as const;
const NAV_SECTIONS = scope === "role" ? NAV_SECTIONS_ROLE : NAV_SECTIONS_IDENTITY;
```

**Two Wakeups state slots** at L336-337:
- `identityWakeupsState` (renamed from `wakeupsState` — word-boundary grep = 0 post-rename)
- `roleWakeupsState` (new)

Both fed by parallel WS fetches on modal open (`identity:list-wakeups` + `identity:list-role-wakeups`).

**Six wakeup CRUD handlers:**

| Handler | Line (approx) | Wire type sent |
| ------- | ------------- | -------------- |
| `updateWakeup` (existing, updated to set `identityWakeupsState`) | 738 | `identity:update-wakeup` |
| `createIdentityWakeup` | 766 | `identity:create-wakeup` |
| `deleteIdentityWakeup` | 784 | `identity:delete-wakeup` |
| `updateRoleWakeup` | 803 | `identity:update-role-wakeup` |
| `createRoleWakeup` | 824 | `identity:create-role-wakeup` |
| `deleteRoleWakeup` | 841 | `identity:delete-role-wakeup` |

All six return `Promise<void>` with reject-on-error semantics so AddWakeupDialog / trash-confirm can surface errors inline.

**TabsContent panes** at L2144-2170 (approximate): the old `value="wakeups"` pane split into two:
- `value="identity-wakeups"` wired to `identityWakeupsState` + identity-scope callbacks
- `value="role-wakeups"` wired to `roleWakeupsState` + role-scope callbacks

Wave 2's stub trio (`scope="identity"` + no-op onCreate/onDelete + TODO Wave 3 comment) fully REMOVED — real props now wired.

**IdentityModal.test.tsx** — added defensive `switchScope` helper below `renderModal`. No test-body rewrites needed (this file has no scope-conditional tab assertions today).

### Task 2b — Test file surgery + 2 new test files (commit ff225269)

**5 existing test files updated:**

- **`IdentityModal.role-tab.test.tsx`** — tests 21-24 REWRITTEN. 21/22 split into a/b variants (per-coordinator-flag defaults + per-scope button counts). 23/24 preserved but prepended with `switchScope('role')` because actor default is now scope='identity' where the Role nav button isn't rendered.
  * OLD 21: "opens with default = 'bounties'" (bogus post-72 — no such flat default any more)
  * NEW 21a/21b: actor→identity + coord→role default assertions
  * OLD 22: "6 nav buttons; first = Role"
  * NEW 22a/22b: 4-under-role + 3-under-identity + "Role file" / "Identity file" first-label
- **`IdentityModal.bounties-filter.test.tsx`** — `renderModalOnBountiesTab` helper prepends `switchScope('role')` before clicking Bounties (Bounties tab now under Role scope). Test K (no-autofocus) migrated to use the shared helper.
- **`IdentityModal.lazy-archive.test.tsx`** — `renderModal` helper appends `switchScope('role')` + Bounties nav click so the Archive accordion (inside the Bounties tab pane) is reachable via `getByRole` for every test.
- **`IdentityModal.voice.test.tsx` + `IdentityModal.stays-awake.test.tsx`** — defensive `__resetModalScopeForTest` in beforeEach only. Voice + stays-awake live in the header ABOVE the scope switch; no test-body changes needed.

**2 new test files:**

- **`IdentityModal.scope-switch.test.tsx`** — 8 tests (S1-S8) covering the segmented control's render + memory behavior:
  * S1: segmented control renders 2 buttons with data-testid scope-switch-role / scope-switch-identity
  * S2/S3: actor → aria-pressed on identity; coordinator → aria-pressed on role
  * S4/S5: tap flips scope + activates the scope's default landing tab
  * S6: memory across open/close of same identity (store persists selection within session)
  * S7: no leak across identityKey (nelly gets actor default after tina's flip to role)
  * S8: activeTab auto-resets to scope's default when scope flips (handoff → role, not stuck on handoff)
- **`IdentityModal.wakeup-crud.test.tsx`** — 4 WS-message integration tests (W1-W4):
  * W1: identity-scope Save → `identity:create-wakeup` with `spec.name`, `spec.instruction`, `spec.enabled=true`, non-null `spec.schedule`
  * W2: identity-scope trash+confirm → `identity:delete-wakeup` with correct `wakeupSlug`
  * W3: role-scope Save (coord mount) → `identity:create-role-wakeup` (same payload shape as W1, role-scope wire type)
  * W4: role-scope trash+confirm → `identity:delete-role-wakeup` with correct `wakeupSlug`

## Deviations from Plan

**Rule 3 (blocking issue): data-value attribute assumption was wrong**

- **Found during:** Task 2b initial run of role-tab.test.tsx (tests 21a/21b).
- **Issue:** Plan spec instructed asserting active TabsContent pane identity via `data-value="identity"` / `data-value="role"`. Radix TabsContent does NOT emit a `data-value` attribute; the value IS encoded in the pane's `id` attribute as `radix-<hash>-content-<value>`.
- **Fix:** Switched assertion to `activePanels[0].getAttribute('id')?.match(/content-identity$/)` (and similar for role). Applied uniformly in role-tab.test.tsx + scope-switch.test.tsx.
- **Files modified:** src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx, src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
- **Commit:** ff225269 (fix rolled into Task 2b's initial commit — the failing intermediate state was never committed)

**Rule 3 (blocking issue): bounties-filter Test K (autofocus) relied on stale default**

- **Found during:** Task 2b run of bounties-filter.test.tsx.
- **Issue:** Test K called `renderModal()` directly (not `renderModalOnBountiesTab()`) and then queried the search input via `getByRole("textbox", { name: /search bounties/i })`. Under the pre-72 default of activeTab='bounties' this worked because the search input was in the active pane. Under the new actor default of scope='identity' the Bounties pane is inactive and Radix hides its children from the accessibility tree — so getByRole failed.
- **Fix:** Migrated Test K to use the shared `renderModalOnBountiesTab()` helper, which now prepends `switchScope('role')` + clicks the Bounties nav. Autofocus assertion (`document.activeElement).not.toBe(input)`) still holds — the intent (no autofocus on modal open) is preserved.
- **Files modified:** src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx
- **Commit:** ff225269

**Rule 3 (grep-acceptance-criteria false-negative on modal-scope-store.ts)**

- **Found during:** Task 1 grep acceptance verification.
- **Issue:** Plan's acceptance grep `grep -cE "localStorage|sessionStorage" src/ui/state/modal-scope-store.ts` demands 0, but the plan's own action step instructed writing a header comment that describes the absence of persistence — including the exact words "no localStorage / sessionStorage persistence." The comment triggered the grep.
- **Fix:** Reworded the header comment to reference the audit grep by intent ("no browser-storage APIs touched") rather than by keyword. Semantic content preserved: reader still learns that no persistence exists.
- **Files modified:** src/ui/state/modal-scope-store.ts
- **Commit:** cc99d4af (fix rolled into Task 1's commit)

## Verification

**Task 1 acceptance greps — all pass:**
- 5 exports (target 5) ✓
- 1 useSyncExternalStore call (target 1, ignoring 2 doc-mention hits which are informational) ✓
- 0 localStorage/sessionStorage refs (target 0) ✓

**Task 2a acceptance greps — all pass:**
- 2 scope-switch button testids ✓
- 3 NAV_SECTIONS_ROLE/IDENTITY mentions ✓
- 5 wakeups-panes value= mentions (target 2 for panes; extra 3 are doc comments) ✓
- 6 useModalScope/setModalScope refs ✓
- 0 old @ts-expect-error refs ✓
- 0 wakeupsState orphan word-boundary matches ✓
- 1 coord-vs-actor default derivation ✓
- 11 CRUD handler name refs (target ≥5) ✓
- 8 wakeups state slot refs (target ≥6) ✓
- 11 invalidateBountyCount refs (unchanged from pre-72) ✓

**Task 2b acceptance greps — all pass:**
- switchScope helper in all 3 target test files ✓
- 0 stale "default activeTab is 'bounties'" comment refs ✓
- 0 stale `navButtons.length === 6` assertions ✓
- ≥1 switchScope('role') in bounties-filter + lazy-archive helpers ✓
- 8 tests S1-S8 in scope-switch.test.tsx ✓
- 4 tests W1-W4 in wakeup-crud.test.tsx ✓
- 16 wire-type string refs across the 4 wakeup-CRUD wire types (target ≥4) ✓
- 8 __resetModalScopeForTest refs across 4 test files (target ≥4) ✓

**Scoped test results — all 9 files green:**
- `src/ui/state/modal-scope-store.test.ts` → 8/8
- `src/ui/features/pretty-view/IdentityModal.test.tsx` → 12/12
- `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` → 8/8
- `src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx` → 6/6 (up from 4 — 21a/21b + 22a/22b split)
- `src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx` → 6/6
- `src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx` → 11/11
- `src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx` → 6/6
- `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` → 8/8 (NEW)
- `src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx` → 4/4 (NEW)
- **Total: 69 tests across 9 files, 0 failures.**

**TypeScript:** `npx tsc --noEmit` exits 0.

**Confirmations requested by output spec:**

1. **Segmented scope switch line range:** `IdentityModal.tsx:1745-1795` (from the opening comment block through the closing `</div>` of the segmented control's capsule). Mounts between the title/avatar editor (ends L1725) and the `<Tabs>` component (opens L1806).
2. **New role-scope state + handler line ranges:**
   - `roleWakeupsState` declaration: L337
   - `createIdentityWakeup` / `deleteIdentityWakeup`: L766, L784
   - `updateRoleWakeup` / `createRoleWakeup` / `deleteRoleWakeup`: L803, L824, L841
3. **NAV_SECTIONS arrays with labels:**
   - `NAV_SECTIONS_ROLE`: Role file / Bounties / History / Wakeups (4 tabs)
   - `NAV_SECTIONS_IDENTITY`: Identity file / Wakeups / Handoff (3 tabs)
4. **Test file update list + why:** documented in Accomplishments § Task 2b above.
5. **IdentityModal.bounties-filter + IdentityModal.lazy-archive both pass** with the switchScope('role') helper prepended in their mount helpers — confirmed above (11/11 + 6/6 green).
6. **wakeupsState → identityWakeupsState rename left no orphans:** word-boundary grep = 0 confirmed above.
7. **activeTab-reset-on-scope-flip decision:** implemented as `useEffect(() => setActiveTab(scope === 'role' ? 'role' : 'identity'), [scope])` — happens automatically on scope tap, not user-driven. Test S8 in scope-switch.test.tsx locks this behavior: clicking Handoff nav then flipping scope resets activeTab to "role" (not stuck on "handoff" which no longer exists in Role scope's NAV_SECTIONS).

No existing tests regressed. No nginx / docker-compose / deploy surface touched. No worktrees used (sequential executor on main working tree).

## Known Stubs

None. Wave 2's WakeupsTab call-site stubs (`scope="identity"` + no-op onCreate/onDelete + TODO Wave 3 comment) are fully REPLACED with real WS wiring. Both scopes' create + delete affordances now round-trip through the backend Plan 01 handlers.

## Self-Check: PASSED

Files created:
- FOUND: src/ui/state/modal-scope-store.ts
- FOUND: src/ui/state/modal-scope-store.test.ts
- FOUND: src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
- FOUND: src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx
- FOUND: .planning/phases/72-identity-modal-role-identity-scope-split-with-role-level-wak/72-03-SUMMARY.md (this file)

Commits:
- FOUND: cc99d4af — feat(72-03): add modal-scope-store (Zustand-shaped per-identity scope memory)
- FOUND: ad308adc — feat(72-03): IdentityModal scope switch + per-scope tab shuffle + wakeup CRUD handlers
- FOUND: ff225269 — test(72-03): scope-split test-file surgery + scope-switch + wakeup-crud coverage
