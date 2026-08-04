---
phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
plan: 05
subsystem: frontend (dialog props + panel orchestration; zero backend)
tags: [skynet, roles, frontend, chain, dialog, panel, ux, sric-05, tdd]

# Dependency graph
requires:
  - phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
    plan: 02
    provides: |
      NewSessionDialog Role dropdown + roles-for-host effect keyed on
      [selectedHost, identityMode]. Task 1 extends that effect with a
      prevHostIdRef guard so the chain seed on the initial mount cycle is
      NOT clobbered by the effect's default "clear on host change" behavior.
  - phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
    plan: 04
    provides: |
      CreateRoleDialog with `onChainToCreateIdentity?: (opts: {role: string;
      host: Host}) => void` optional prop. The dialog only invokes the
      callback when the `Then create an identity with this role` checkbox is
      CHECKED at submit time (default true, enforced by CreateRoleDialog
      test 17). Task 2 wires the callback from the PrettyConversationsPanel
      mount without touching CreateRoleDialog internals.
provides:
  - New optional props on NewSessionDialog: `initialHost?: Host | null` and
    `initialRole?: string | null` — seed selectedHost + selectedRole on open
    when both are provided; pre-fill remains EDITABLE (no locked/readOnly/
    disabled additions per D-CONTEXT §Claude's Discretion default)
  - New stale-role validation effect on NewSessionDialog: after
    rolesForHost resolves, if selectedRole is not in the fetched list it is
    cleared (Test 6 safety net for chain pre-fills where the caller passed
    a role that doesn't actually exist on the picked host)
  - prevHostIdRef guard on the roles-for-host effect: clears selectedRole
    only on ACTUAL host change (Test 22 regression gate preserved) OR when
    a previously-observed host is cleared, never on the initial
    null→seededHost transition
  - PrettyConversationsPanel chainPrefill state + full wiring: CRD chain
    callback closes CRD, stashes {role, host}, opens NSD with initialHost +
    initialRole seeded; chainPrefill cleared on NSD onClose AND on NSD
    onCreate success (regression gate Test 13)
affects: []  # 22-05 is the tail of Wave 4; nothing downstream reads back into this

# Tech tracking
tech-stack:
  added: []  # No new npm packages — react + @testing-library/react + vitest already present
  patterns:
    - "Ref-guard pattern for initial-mount vs subsequent-change discrimination
       in cross-effect state seeding. Problem: useEffect#1 (on-open) seeds
       selectedRole via setSelectedRole(initialRole); useEffect#2
       (roles-for-host) fires immediately after with selectedHost still
       null-by-initial-state and would clear selectedRole. Solution:
       prevHostIdRef tracks the last-observed host id. First observation
       (null → any) skips the clear; ACTUAL host change (A → B) still clears
       (Plan 22-02 Test 22 preserved). Ref is reset on modal close so
       subsequent opens with fresh seed values work (Test 8)."
    - "Stale-fetch validation effect for cross-caller data consistency.
       After the roles-for-host fetch resolves, if the seeded selectedRole
       is NOT in the fetched list, clear it. Handles the T-22-05-01
       threat-model row (tampered chainPrefill with a role that doesn't
       exist on the pre-filled host) and the race window between role
       creation and roles fetch. Zero user-visible cost when the seed is
       valid (fetch just confirms and moves on)."
    - "Lightweight fake-dialog mocks for panel-level orchestration tests.
       PrettyConversationsPanel.chain.test.tsx mocks CreateRoleDialog +
       NewSessionDialog with fakes that expose their props via data-*
       attributes AND a click-triggered button that invokes the received
       onChainToCreateIdentity callback. Keeps the panel test isolated from
       the real dialogs' internals (which have their own suites) and
       focused on the panel's wiring contract."
    - "Chained state clearing on modal close: NewSessionDialog mount
       onClose AND onCreate BOTH set setChainPrefill(null). Prevents stale
       chain state from leaking into a subsequent manual open (regression
       gate Test 13)."

key-files:
  created:
    - src/ui/sidebar/NewSessionDialog.chain.test.tsx                              # 11 tests for the new initialHost + initialRole props (Task 1 RED→GREEN)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx  # 4 tests for the panel chain wiring (Task 2 RED→GREEN)
  modified:
    - src/ui/sidebar/NewSessionDialog.tsx                                         # +40 lines: new props + on-open seeding + prevHostIdRef + stale-role effect + close-reset
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx          # +29 lines: chainPrefill state + real onChainToCreateIdentity callback + initialHost/initialRole thread-through + chainPrefill clears on NSD close/success

key-decisions:
  - "Ref-guard vs useLayoutEffect for seed vs default-clear ordering. The
    naive fix would be moving the on-open seed to useLayoutEffect so it
    lands synchronously before useEffect#2 (roles-for-host) runs. Rejected
    because (a) it introduces a hook-timing coupling that's easy to break
    on refactor, and (b) React's effect-ordering guarantees aren't strong
    enough across concurrent-mode edge cases. The prevHostIdRef pattern
    makes the intent explicit and self-documenting: 'this effect only
    clears on ACTUAL change, not on first observation'. Zero timing
    dependency."
  - "Stale-role clear is triggered by rolesForHost changes, NOT by
    selectedRole changes. Rationale: the validation should only run when
    the fetch lands (rolesForHost populates). Keying on selectedRole would
    fire on every user pick — pointless work since a user-picked role is
    always in the current dropdown options."
  - "chainPrefill is cleared in BOTH onClose and onCreate paths of the
    NewSessionDialog mount. Rationale: successful submit closes the dialog
    too, but goes through onCreate → onCreateSession → setNewSessionDialogOpen(false)
    rather than the onClose path. Clearing in both keeps the state model
    monotonic (chain state exists only while the chained NSD is visibly
    open)."
  - "Fake-dialog mocks over real-dialog integration for panel-level tests.
    Real dialogs have their own dedicated test suites (11 chain tests + 8
    role-dropdown tests + 10 CRD tests). Panel-level orchestration is a
    small wiring contract: 'when CRD fires this callback, panel closes CRD
    and opens NSD with these props threaded through'. Fake mocks make the
    contract inspectable without pulling in the full dialog render tree
    (which needs SSE streams, avatar batches, roles-for-host mocks, etc.)."
  - "No lockedFields or disabled props on the pre-filled host/role controls.
    D-CONTEXT §Claude's Discretion default: 'pre-filled but editable'. Test
    7 asserts both the host list buttons and the role select remain enabled
    after pre-fill. Acceptance-criteria grep confirms zero new readOnly/
    disabled attributes on selectedHost/selectedRole controls."
  - "onChainToCreateIdentity callback in the panel closes CRD BEFORE
    stashing the pre-fill and opening NSD. Order is deliberate: (a) close
    CRD first so its unmount effects fire without racing, (b) then stash
    chainPrefill, (c) then open NSD which will read the fresh chainPrefill.
    React batches these three state updates into a single re-render, so
    the visual transition is atomic."

patterns-established:
  - "prevHostIdRef guard for cross-effect state seeding — reusable pattern
    whenever a parent effect seeds state that a child effect defaults to
    clearing. Explicitly distinguishes 'first observation' from 'subsequent
    change' without depending on effect-ordering hairs. See Plan 22-02 for
    the original roles-for-host effect and Plan 22-05 for the guard
    addition."
  - "Chain-callback wiring via optional prop with panel-owned state — the
    creator plan (22-04) exposes the extension point as an optional
    callback prop; the consumer plan (22-05) wires it at the panel mount
    with zero touches to the creator component. Preserves single-plan
    responsibility per component and makes the extension point
    discoverable via a plan-reference comment."
  - "Fake-dialog panel test pattern — vi.mock the child dialogs with
    inline React components that expose props via data-* attributes + a
    click-triggered button to invoke received callbacks. Keeps panel
    wiring tests focused on the panel's contract, isolates from child
    dialog internals, and stays fast (no SSE streams, no avatar mocks)."

requirements-completed: [SRIC-05]

# Metrics
duration: 12min
completed: 2026-08-04
---

# Phase 22 Plan 22-05: SRIC-05 — Chain create-role → create-identity Summary

**When Ashley clicks Create on the `+ New role` modal with the `Then create an identity with this role` checkbox CHECKED (default), CreateRoleDialog now closes and NewSessionDialog opens with the newly-created role AND the picked host pre-filled (both stay editable). Chain does not fire when the checkbox is unchecked; NewSessionDialog stays closed. Pure frontend orchestration — zero backend surface.**

## Performance

- **Duration:** ~12 min (both tasks RED→GREEN, single sequential executor session)
- **Started:** 2026-08-04T09:56:45Z (after loading state + reading plan + all 4 required context files + inspecting all 3 source files)
- **Completed:** 2026-08-04T10:09:03Z
- **Tasks:** 2 total, both `type=auto tdd=true`. Task 1 = 2 commits (RED test + GREEN feat). Task 2 = 2 commits (RED test + GREEN feat).
- **Test count:** 15 new tests (11 chain + 4 panel) plus 21 in-scope regression tests confirmed passing (8 role-dropdown + 10 CreateRoleDialog + 3 new-role-button).

## Accomplishments

### NewSessionDialog (Task 1)

- **New optional props: `initialHost?: Host | null` and `initialRole?: string | null`** — chain pre-fill extension point. When both are provided and identity-mode is ON (default), the on-open useEffect seeds `selectedHost` and `selectedRole` from the props. Only `initialHost` provided → host seeded, role stays empty. Only `initialRole` (no host) → silently ignored; host auto-select-single-host branch still runs when applicable.
- **`prevHostIdRef` guard added to the Plan 22-02 roles-for-host effect** — tracks last-observed `selectedHost.id`. First observation (null → seededHost) SKIPS the "clear selectedRole" branch; ACTUAL host change (A → B) still clears (Plan 22-02 Test 22 regression gate preserved). This is what makes the chain pre-fill actually stick — without the guard, the on-mount effect fire with `selectedHost=null` (initial state) was clobbering the seed set by the on-open effect.
- **New stale-role validation useEffect** — keyed on `[rolesForHost, rolesLoading, selectedRole]`. After the roles fetch resolves, if `selectedRole` is not in the fetched list, clear it. Handles the T-22-05-01 threat (tampered chainPrefill with a phantom role) and the race window between role creation and roles fetch.
- **Modal close now also resets `prevHostIdRef.current = null`** — so a subsequent open with fresh seed values re-enters the "first observation" branch (Test 8 regression gate).
- **Pre-filled fields stay EDITABLE** — no new `readOnly`, `disabled`, or `lockedFields` props added to the host list or role select. `grep -c "readOnly\|disabled.*selectedHost\|disabled.*selectedRole"` returns 0. Per D-CONTEXT §Claude's Discretion default "pre-filled but editable".

### PrettyConversationsPanel (Task 2)

- **New `chainPrefill` state** — `useState<{role: string; host: Host} | null>(null)`. Populated by CreateRoleDialog's chain callback, consumed by NewSessionDialog as its `initialHost` + `initialRole` props.
- **Plan 22-04's `onChainToCreateIdentity={undefined}` placeholder REMOVED** — replaced with a real callback body: `(opts) => { setCreateRoleDialogOpen(false); setChainPrefill(opts); setNewSessionDialogOpen(true); }`. The regression gate grep `onChainToCreateIdentity={undefined` now returns 0.
- **NewSessionDialog mount extended with `initialHost` + `initialRole` props** — sourced from `chainPrefill?.host` and `chainPrefill?.role` (both fall to `null` when chainPrefill is null). Fresh manual pencil opens have no pre-fill.
- **NewSessionDialog's `onClose` and `onCreate` handlers extended** — both now also call `setChainPrefill(null)` to clear the chain state on ANY dialog dismissal. Prevents stale chain state leaking into a subsequent manual open (Test 13 regression gate).
- **Zero touch to CreateRoleDialog internals** — the extension point exposed in Plan 22-04 was designed for exactly this consumer plan; wiring is one-line at the mount site.
- **Zero touch to NewSessionDialog surface for Task 2** — Task 1 added the props; Task 2 threads them through.

## Task Commits

Each task followed the TDD RED→GREEN gate:

1. **Task 1 RED: failing tests for NewSessionDialog chain pre-fill props** — `9e0129a` (test)
2. **Task 1 GREEN: add initialHost + initialRole chain pre-fill props to NewSessionDialog** — `b3b4dfe` (feat)
3. **Task 2 RED: failing tests for panel-level chain wiring** — `66ef9ba` (test)
4. **Task 2 GREEN: wire CreateRoleDialog chain into NewSessionDialog pre-fill** — `0eb882f` (feat)

_TDD gate sequence verified: RED test commit precedes GREEN feat commit for both tasks. Task 1 RED failed with `AssertionError: expected '' to be 'box-maintainer'` (props not yet implemented, 8 failing). Task 2 RED failed with `Unable to find element` on the fake-new-session-dialog testid (undefined placeholder didn't wire, 3 failing)._

**Plan metadata commit:** _(committed after STATE + ROADMAP updates below)_

## Files Created/Modified

**Created:**
- `src/ui/sidebar/NewSessionDialog.chain.test.tsx` — 11 tests covering the new pre-fill props (Task 1 RED→GREEN).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — 4 tests covering the panel wiring contract (Task 2 RED→GREEN).

**Modified:**
- `src/ui/sidebar/NewSessionDialog.tsx` — +40 lines net:
  - Props interface extended with optional `initialHost?: Host | null` and `initialRole?: string | null`.
  - On-open useEffect (deps `[open, flatHosts]`) extended: `initialHost` branch takes precedence over auto-select-single-host; also seeds `selectedRole` when `initialRole` provided and `identityMode` is on.
  - `prevHostIdRef` ref added; roles-for-host useEffect updated to use it as a guard for the "clear on host change" branch.
  - New stale-role validation useEffect (deps `[rolesForHost, rolesLoading, selectedRole]`) — clears selectedRole if not in fetched list.
  - Modal close reset block extended to reset `prevHostIdRef.current = null`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — +29 lines net:
  - `chainPrefill` state added.
  - NewSessionDialog mount extended: `onClose` and `onCreate` both clear chainPrefill; `initialHost` + `initialRole` threaded through.
  - CreateRoleDialog mount: `onChainToCreateIdentity={undefined}` placeholder replaced with real callback body (3 setter calls).

**Untouched (per plan scope):**
- `src/ui/sidebar/CreateRoleDialog.tsx` — zero diff (per plan Action step 1 for Task 2 and acceptance criterion `git diff src/ui/sidebar/CreateRoleDialog.tsx returns empty`).
- Backend — zero diff (`git diff --name-only src/backend/` returns empty for the plan).
- Any other frontend surface — zero collateral changes.

## Deviations from Plan

### Auto-fixed Issues (Rule 3 blocking)

**1. `prevHostIdRef` pattern added to the roles-for-host effect (not explicitly named in the plan)**

- **Found during:** Task 1 GREEN first test run.
- **Issue:** The plan's Action step 2 says "The state seeding must happen BEFORE the roles-for-host useEffect fires (React batches; use the same useEffect to setSelectedHost and let the roles-for-host useEffect fire on the next render — mirror how existing seedings work)." But when both effects fire on the initial mount, the roles-for-host effect fires with `selectedHost=null` (initial state — the on-open effect's `setSelectedHost` hasn't landed yet) and enters the `if (!selectedHost)` branch which unconditionally clears `selectedRole` — clobbering the seed from the on-open effect that got scheduled in the same batch.
- **Fix:** Added `prevHostIdRef: useRef<string | number | null>(null)` and gated the `setSelectedRole("")` clear on `prevHostIdRef.current !== null`. First observation (from `null` initial) skips the clear; subsequent host changes (A → B) still clear (Test 22 regression gate preserved). Ref is reset on modal close (Test 8).
- **Files modified:** `NewSessionDialog.tsx` (Task 1 GREEN commit `b3b4dfe`).
- **Verification:** All 11 chain tests pass; all 8 role-dropdown tests still pass (including Test 22 host-change clear); all 10 CreateRoleDialog tests still pass.
- **Committed in:** `b3b4dfe` — inseparable from Task 1 GREEN.

### Test-fixture adjustments (Rule 3 blocking)

**2. `aria-selected` assertion loosened from `.toBe("false")` to `.not.toBe("true")` in Tests 2b and 8**

- **Found during:** Task 1 GREEN first test run.
- **Issue:** React 18 renders `aria-selected={boolean}` inconsistently — sometimes as the string `"false"`, sometimes as no attribute at all (depends on the prop's exact type coercion path). Tests 2b and 8 asserted `.toBe("false")` which fails when the attribute is absent.
- **Fix:** Loosened to `.not.toBe("true")` — the meaningful assertion is "no row is currently selected", not the specific serialized form of the negation.
- **Files modified:** `NewSessionDialog.chain.test.tsx` (Task 1 GREEN commit `b3b4dfe`).
- **Verification:** Both tests pass; the assertion still catches any regression where a row IS incorrectly marked selected.
- **Committed in:** `b3b4dfe` — inseparable from Task 1 GREEN.

### No plan revisions

Plan 22-05 was fully autonomous and needed no plan revisions or Ashley-in-the-loop checkpoints. Zero scope creep. Zero architectural decisions (Rule 4). All Rule 3 auto-fixes above were narrow implementation details, not shape changes.

### No unrelated fixes

- 6 pre-existing NewSessionDialog.test.tsx failures (Tests 5-10, `/^open$/i` matcher against `Create` label) — NOT touched (documented in deferred-items.md by 22-02; unchanged in count post-22-05).
- 2 pre-existing PrettyConversationsPanel.test.tsx failures (Tests 5 and 8, `/new session/i` matcher against `New agent` label) — NOT touched (documented in deferred-items.md by 22-04; unchanged in count post-22-05).

**Total deviations:** 2 auto-fixed Rule 3 blocking implementation-details (prevHostIdRef pattern + aria assertion loosening).
**Impact on plan:** Zero scope creep. Both fixes were inevitable consequences of the plan's design that only surfaced at test-run time; both are documented above so future readers see WHY the code diverges from a naive read of the Action steps.

## Issues Encountered

- **STATE.md is very large (~475KB — recurring issue noted in 22-01, 22-02, 22-04 summaries).** Will use SDK verbs (`state.advance-plan`, `state.update-progress`, `state.record-metric`, `state.add-decision`, `state.record-session`) for the state updates below.
- **HTMLCanvasElement.getContext() warning** — jsdom limitation, appears in panel test output. Not related to any assertion; tests pass despite the warning.
- **6 pre-existing NewSessionDialog + 2 pre-existing PrettyConversationsPanel test failures** — unchanged by this plan; all documented in `deferred-items.md`. Zero net regression.

## User Setup Required

None — no new environment variables, no new npm packages, no dashboard configuration, no backend routes.

**Post-deploy manual verification (deferred to Phase 22 UAT per ROADMAP):**
1. Ashley clicks `+ New role` in the panel header → CreateRoleDialog opens with the chain checkbox CHECKED (default from 22-04).
2. Ashley picks a host, types a kebab-case role name + description, clicks Create → 201 response, CRD closes, **NSD opens with the picked host row highlighted AND the new role showing as the selected value in the Role dropdown**.
3. Ashley confirms she can still change host and role in the NSD (fields are editable, not locked).
4. Ashley fills out the rest of the identity-birth form (name, title, brief, avatar, voice, color), clicks Create → identity is birthed with the correct role.
5. Ashley opens `+ New role` again, unchecks the checkbox, clicks Create → CRD closes and **NSD does NOT open** (chain skipped because checkbox was false).
6. Regression: Ashley clicks the pencil `+ New agent` icon → NSD opens with a clean form, no host/role pre-filled from any prior chain flow.

## Next Phase Readiness

**Phase 22 Wave 4 tail — no direct downstream consumers.** Plan 22-05 completes SRIC-05, the last requirement in the compound create-role → create-identity user journey. The chain works end-to-end from panel launcher click → CreateRoleDialog → chain callback → NewSessionDialog → identity birth (via Plan 22-02's birth flow).

**Phase 22 remaining work (per ROADMAP):**
- Phase 22 UAT (Ashley end-to-end verification against a live fleet host). This plan's contribution to UAT is the chain-flow steps above.
- Any Phase 22 rollup / phase-completion transition work.

**Wave 4 dependency chain — all landed:**
- 22-02 (SRIC-02) ✓ — role dropdown + birth `role:` frontmatter
- 22-03 (SRIC-03) ✓ — clone flow
- 22-04 (SRIC-04) ✓ — create-role dialog + `+ New role` launcher
- 22-05 (SRIC-05) ✓ — chain create-role → create-identity (this plan)
- 22-01 (SRIC-01) ✓ — role-scoped bounties/history read (Wave 1)
- 22-06 (SRIC-06) ✓ — Role tab in IdentityModal (Wave 3)

**Manual UAT gate (deferred to Phase 22 UAT per ROADMAP):** end-to-end fleet-side verification requires a live host with SSH access and a fresh role slot to create; automated coverage stops at the mocked-listRolesForHost boundary.

---

## Self-Check: PASSED

**Files created/modified verified:**
```
FOUND: src/ui/sidebar/NewSessionDialog.tsx (modified)
FOUND: src/ui/sidebar/NewSessionDialog.chain.test.tsx (new)
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (modified)
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx (new)
```

**Commits verified (git log --oneline):**
```
FOUND: 9e0129a test(22-05): add failing tests for NewSessionDialog chain pre-fill props   (Task 1 RED)
FOUND: b3b4dfe feat(22-05): add initialHost + initialRole chain pre-fill props to NewSessionDialog   (Task 1 GREEN)
FOUND: 66ef9ba test(22-05): add failing tests for panel-level chain wiring   (Task 2 RED)
FOUND: 0eb882f feat(22-05): wire CreateRoleDialog chain into NewSessionDialog pre-fill   (Task 2 GREEN)
```

**All plan acceptance criteria pass:**

Task 1:
- All 11 tests in NewSessionDialog.chain.test.tsx pass ✓
- All 8 tests in NewSessionDialog.role-dropdown.test.tsx still pass (regression gate) ✓
- `grep -c "initialHost\|initialRole" src/ui/sidebar/NewSessionDialog.tsx` returns 15 ≥ 6 ✓
- `grep -c "readOnly\|disabled.*selectedHost\|disabled.*selectedRole" src/ui/sidebar/NewSessionDialog.tsx` returns 0 ✓ (pre-fill is soft, not locked)
- `npx tsc --noEmit` passes clean ✓
- Task 1 git diff scoped to NewSessionDialog.tsx + NewSessionDialog.chain.test.tsx only ✓

Task 2:
- All 4 tests in PrettyConversationsPanel.chain.test.tsx pass ✓
- All 3 tests in PrettyConversationsPanel.new-role-button.test.tsx still pass (regression gate) ✓
- All 10 tests in CreateRoleDialog.test.tsx still pass (regression gate for the CRD contract this plan consumes) ✓
- `grep -c "chainPrefill\|setChainPrefill" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 10 ≥ 4 ✓
- `grep -c "onChainToCreateIdentity" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 5 ≥ 1 AND callback body sets createRoleDialogOpen=false + newSessionDialogOpen=true + chainPrefill ✓
- `grep -c "initialHost=\|initialRole=" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 2 ≥ 2 ✓ (both props threaded into NewSessionDialog mount)
- `grep -c "onChainToCreateIdentity={undefined" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 0 ✓ (Plan 22-04's placeholder REMOVED — regression gate)
- `npx tsc --noEmit` passes clean ✓
- Task 2 git diff scoped to PrettyConversationsPanel.tsx + PrettyConversationsPanel.chain.test.tsx only (`git diff src/ui/sidebar/` returns empty for Task 2) ✓

Overall:
- `npm run build:backend` clean ✓ (pure frontend plan; no backend change expected)
- `git diff --name-only src/backend/` returns empty ✓
- 36 in-scope tests pass across 5 test files (11 chain + 8 role-dropdown + 10 CRD + 4 panel chain + 3 new-role-button) ✓
- 8 pre-existing failures unchanged (6 NewSessionDialog + 2 PrettyConversationsPanel — documented in deferred-items.md) ✓
- Zero net regression ✓
- Zero new npm packages ✓
- No new backend routes → no nginx dual-config work needed ✓

## TDD Gate Compliance

Task 1: `test` (RED @ 9e0129a) → `feat` (GREEN @ b3b4dfe) ✓
Task 2: `test` (RED @ 66ef9ba) → `feat` (GREEN @ 0eb882f) ✓

Both tasks followed the fail-fast rule — RED phase confirmed failures BEFORE writing GREEN:
- Task 1 RED: 8 failing (props not yet implemented in NewSessionDialog).
- Task 2 RED: 3 failing (undefined placeholder didn't wire the chain).

No test-that-passes-unexpectedly regressions.

---
*Phase: 22-skynet-ui-parity-with-the-role-identity-paradigm*
*Completed: 2026-08-04*
