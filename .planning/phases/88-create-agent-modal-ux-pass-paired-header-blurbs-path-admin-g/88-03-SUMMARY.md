---
phase: 88-create-agent-modal-ux-pass-paired-header-blurbs-path-admin-g
plan: 03
subsystem: ui-sidebar-dialog
tags: [test-rewrite, semantic-inversion, admin-gate, wave-3, green-restore, phase-86-drift-cleanup]
dependency_graph:
  requires:
    - "Plan 88-02: Wave 2 shipped source changes (blurb revisions, admin-gates, shellOnly rename, submit invariant, non-admin path-clear)"
    - "Plan 88-01: isAdmin prop plumbed to NewSessionDialog + backend ~/<name>/ substitution"
  provides:
    - "Green scoped test gate across all 5 plan-named test files (89/89 passing, was 29 failing)"
    - "New regression coverage: T1 (admin-gate hide), T2 (admin-gate render + defaults), T3 (non-admin path='' wire contract)"
    - "Phase-86 drift cleanup: 8 tests that referenced Phase-86-deleted UI (title, brief, generate, avatar-pick, single-host listbox) rewritten to reflect current source"
  affects:
    - "Phase 88 create-agent-modal-ux-pass campaign is complete: modal UX pass with paired blurbs + admin gates + backend substitution shipped and locked with regression coverage"
tech-stack:
  added: []
  patterns:
    - "Shared regex constant IDENTITY_MODE_CHECKBOX_RE (=/just a shell.*no agent/i) at top of each of the 4 NewSessionDialog test files — single source of truth for the checkbox label"
    - "renderDialog helper accepts isAdmin?: boolean with default `true` — least-churn admin-gate migration; existing tests keep admin-surface visibility assumptions, new non-admin tests pass isAdmin:false explicitly"
    - "Semantic-inversion prose refresh: describe/it strings + comments updated so 'click to reach shell mode' language replaces 'click to toggle off identity mode'"
    - "T3 wire-contract test pattern: mock openBirthStream via existing vi.mock scaffolding, assert payload.path === '' under isAdmin=false submit"
key-files:
  created: []
  modified:
    - src/ui/sidebar/CreateRoleDialog.test.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
    - src/ui/sidebar/NewSessionDialog.chain.test.tsx
    - src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx
    - src/ui/sidebar/NewSessionDialog.task-input.test.tsx
decisions:
  - "T3 (non-admin submit → path:'' wire contract) used the existing mockOpenBirthStream + createMockStream + mock.calls[0][0] pattern from Test V (Plan 86-06 sibling). Not a placeholder — real assertion on payload.path === '' plus a sanity check on payload.name === 'alicia' so backend substitution has a name to substitute."
  - "Semantic-inversion strategy for existing checkbox-click tests: the fireEvent.click call REMAINS at each site (still needed to reach shell mode after Phase 88; the click just has inverted intent). Only the surrounding describe/it strings + comment prose were updated. Assertions on `arg.identityMode` (public payload discriminant) were left UNCHANGED per Plan 88-02 Edit D's decision to preserve the wire contract."
  - "Task 3 + Task 4 + Task 5 folded in Wave-1 pre-existing Phase-86-drift cleanup (per Wave 2 SUMMARY §Wave 3 Unblock Contract: 'plan will also carry the pre-existing Wave-1 Phase-86 title/brief drift cleanup'). Eight tests across three files that referenced Phase-86-deleted UI (title input, brief textarea, generate button, avatar candidate img, single-host tree listbox) were rewritten to reflect current source: Test 2a + Test 4b (chain, single-host listbox suppressed by Phase 84 bc07561e), Tests 10a/10b/10c (chain, brief textarea stripped in Phase 86), Test 23 + Test 24 (role-dropdown, title/brief/generate/img stripped), fillFormForSubmit helper (task-input, same UI stripped)."
  - "Task 4's plan text said role-dropdown.test.tsx has 0 references to the checkbox-label regex. That was inaccurate — Test 27 at L405 had one occurrence which was updated as part of the isAdmin helper edit. No plan deviation; the acceptance criteria did not require the fix but the tests would not have passed without it."
metrics:
  duration: ~28 min
  tasks_completed: 5
  files_modified: 5
  completed_date: 2026-09-08
---

# Phase 88 Plan 03: Test-file semantic-inversion rewrites Summary

**Wave 3 of 3.** Test-file rewrites to reflect Wave 2's shipped semantic-inversion + admin-gate + label flip + default flip + blurb revision, plus three new lock-tests for admin-gate behavior and non-admin backend substitution. Restores green across all 5 plan-named test files (0 failures) and gains three new assertions that did not exist pre-Phase 88.

## What Shipped

### Task 1 — CreateRoleDialog.test.tsx Test 11 blurb regex refresh (commit `1453063f`)

- Replaced the Test 11 blurb regex assertion (was: `/A role is what an agent does and how it thinks — many agents can share one\./`) with the Phase-88 LOCKED two-sentence form: `/Roles are the expertise your agents adopt\. Every agent using this role inherits its goals, rules, and knowledge\./`. Both periods `\.`-escaped.
- Refreshed the surrounding Phase-84 rationale comment to name Phase 88 (Plan 88-02 Task 1) as the paired-vocabulary source; shared verb ADOPT with sibling agent blurb at NewSessionDialog.tsx `startDescription`.
- Preserved every other Test 11 assertion byte-identical (including the required-caption absence at L306-312, which stays valid — the caption stays deleted in Phase 88).
- Scoped run: 15/15 passing (was 1 failing pre-Wave-3).

### Task 2 — NewSessionDialog.test.tsx multi-region rewrite (commit `85a59be8`)

**Edit A — IDENTITY_MODE_CHECKBOX_RE constant** at top of file (`=/just a shell.*no agent/i`) with a Phase-88 comment anchoring the label flip's source.

**Edit B — renderDialog helper** gains `isAdmin?: boolean` with default `true` (least-churn migration). Existing tests keep their admin-surface visibility assumptions; new non-admin tests pass `isAdmin: false` explicitly.

**Edit C — Label regex replacement** — all 11 `/create with new identity/i` sites replaced with `IDENTITY_MODE_CHECKBOX_RE` (mechanical replace_all).

**Edit D — Test D rewrite** — default flipped from checked-true to unchecked-false. Wave 2 renamed `identityMode` → `shellOnly` and flipped useState default from `true` to `false`. Assertion is now `expect(checkbox.checked).toBe(false)` under `isAdmin: true` (the renderDialog helper default renders the checkbox to inspect).

**Edit E — Semantic-inversion audit** on existing checkbox-click tests:

- Tests 5, 6, 7, 9 (inline `<NewSessionDialog>` renders, no renderDialog helper): forward `isAdmin={true}` inline so the admin-gated checkbox renders. `fireEvent.click(checkbox)` remains at each site (still valid — click now OPTS INTO shell mode; same DOM effect, inverted intent).
- Test A, C, E, S, GG (via renderDialog helper): describe/it strings + comments refreshed to describe click-opts-into-shell semantics. Assertions on `arg.identityMode` (public payload discriminant) unchanged per Plan 88-02 Edit D's wire-contract preservation.
- Test U rerender + Test CC rerender: added `isAdmin={true}` to both rerender-JSX blocks (renderDialog helper default does not propagate through raw `utils.rerender(...)`). Test U's default-check assertion flipped from `.toBe(true)` to `.toBe(false)` (new default).
- Test DD gained a `checkbox.disabled === true` assertion using IDENTITY_MODE_CHECKBOX_RE — strengthens the "form fields disabled during birth" test and lifted IDENTITY_MODE_CHECKBOX_RE usage count to 15.

**Edit F — Three new lock-tests** appended near end of file, before the Manual avatar upload comment block:

- **Phase 88 T1** — `renderDialog({ isAdmin: false })` → NEITHER Path input NOR shell-only checkbox rendered. Asserts both `queryByLabelText(/^path$/i)` and `queryByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE })` are null.
- **Phase 88 T2** — `renderDialog({ isAdmin: true })` → BOTH Path input (default value `~/`) and shell-only checkbox (default UNCHECKED) rendered.
- **Phase 88 T3** — `isAdmin=false` submit round-trip: mocks `openBirthStream` via existing `createMockStream([])`, calls `fillIdentityForm(utils)` to complete the required identity-mode fields (host auto-selects on threeHostTree — no wait, threeHostTree has 3 hosts; fillIdentityForm picks alpha), clicks Create, waits for `mockOpenBirthStream.mock.calls.length === 1`, then asserts `payload.path === ""` (the wire signal Plan 88-01's `identity-birth.ts:206` backend narrow substitutes to `~/<name>/`). Sanity check `payload.name === "alicia"` proves the name is present so backend substitution has something to substitute.

**Anti-pattern gate**: T3 ships with a REAL assertion. The plan-shipped placeholder `expect(true).toBe(true)` is NOT present anywhere in the file.

Scoped run: 38/38 passing (was 12 failing pre-Wave-3).

### Task 3 — NewSessionDialog.chain.test.tsx rewrite (commit `665b7335`)

- Added IDENTITY_MODE_CHECKBOX_RE constant at top of file.
- Test 10c + Test 9 inline renders forward `isAdmin={true}` so their admin-gated checkbox interaction reaches the DOM.
- Both label regex sites replaced with the constant.
- Test 9 describe/it strings refreshed for the click-opts-into-shell semantic.
- Test 2a + Test 4b rewritten for Phase-84 hide-picker-when-1-host (`bc07561e`): single-host tree suppresses the listbox, so `getByRole("option", { name: /box-a/i })` was returning empty. Rewritten to observe auto-selection via role-dropdown appearance (dropdown is inside the `{selectedHost !== null && …}` gate — its presence is the observable proof of auto-selection).
- Tests 10a/10b/10c rewritten as regression guards asserting the brief textarea STAYS absent post-Phase-86-04 (`initialBrief` prop kept for chain-prefill API compat with PrettyConversationsPanel, no UI consumer). Test 10c preserved as a click-into-shell-mode regression guard on the admin-gate + label + click semantics.

Scoped run: 14/14 passing (was 6 failing pre-Wave-3).

### Task 4 — NewSessionDialog.role-dropdown.test.tsx helper + label (commit `affd0fb5`)

- renderDialog helper accepts `isAdmin?: boolean` with default `true`. Phase-88 anchor comment above the helper.
- Test 27 label regex updated: `/create with new identity/i` → `/just a shell.*no agent/i`. Describe/it string refreshed for the click-opts-into-shell semantic.
- Test 23 + Test 24 rewritten to remove references to Phase 86-deleted UI (title, brief, generate button, avatar candidate img). The original tests' real assertions — "Create disabled without role; enabled after role pick" (Test 23) and "birth body carries role" (Test 24) — are preserved intact; only the deleted-UI setup scaffolding was stripped.

Scoped run: 8/8 passing (was 2 failing pre-Wave-3).

### Task 5 — NewSessionDialog.task-input.test.tsx rewrite (commit `d7c130e3`)

- Added IDENTITY_MODE_CHECKBOX_RE constant at top of file (2 literal `just a shell.*no agent` occurrences: constant declaration + comment reference).
- renderDialog helper accepts `isAdmin?: boolean` with default `true`.
- Both label regex sites (Task 1b, Task 3e) replaced with the constant.
- Task 1a describe/it string updated: removed `identityMode=true` language, describes agent-mode-is-default semantics.
- Task 1b describe/it string + comment updated for semantic-inversion (click OPTS INTO shell mode).
- Task 3c/3d describe/it strings updated to "agent mode (default)".
- Task 3e describe/it string + comment updated for semantic-inversion.
- fillFormForSubmit helper stripped of title/brief/generate/img scaffolding (Phase 86 UI deleted). Post-Plan-86-04 canOpen requires only host + valid name + role — helper matches. Unblocks Tasks 1d/1e/1f/3a/3b/3e which flow through this helper.

Scoped run: 14/14 passing (was 7 failing pre-Wave-3).

## Verification Results

### Combined green gate

```
npx vitest run src/ui/sidebar/CreateRoleDialog.test.tsx \
               src/ui/sidebar/NewSessionDialog.test.tsx \
               src/ui/sidebar/NewSessionDialog.chain.test.tsx \
               src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx \
               src/ui/sidebar/NewSessionDialog.task-input.test.tsx --run
```

**Result: 5 Test Files passed / 89 Tests passed / 0 failing.** Wave-2 baseline was 29 failures across the same 5 files. All 29 failures resolved: 21 semantic-inversion + label-flip + admin-gate + default-flip + blurb casualties (Wave 2 remit), plus 8 pre-existing Phase-86-drift casualties (Wave 3 gets-you-to-green scope).

### Grep source assertions (all plan `<verification>` gates)

| Assertion                                                                                                     | Expected | Actual |
| ------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| `grep -c 'Roles are the expertise your agents adopt' src/ui/sidebar/CreateRoleDialog.test.tsx`                | 1        | 1      |
| `grep -c 'A role is what an agent does and how it thinks' src/ui/sidebar/CreateRoleDialog.test.tsx`           | 0        | 0      |
| `grep -c 'IDENTITY_MODE_CHECKBOX_RE' src/ui/sidebar/NewSessionDialog.test.tsx`                                | ≥15      | 15     |
| `grep -c '/create with new identity/i' src/ui/sidebar/NewSessionDialog.test.tsx`                              | 0        | 0      |
| `grep -c '/create with new identity/i' src/ui/sidebar/NewSessionDialog.chain.test.tsx`                        | 0        | 0      |
| `grep -c '/create with new identity/i' src/ui/sidebar/NewSessionDialog.task-input.test.tsx`                   | 0        | 0      |
| `grep -c '/create with new identity/i' src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`                | 0        | 0      |
| `grep -c 'isAdmin: false' src/ui/sidebar/NewSessionDialog.test.tsx`                                           | ≥2       | 3      |
| `grep -c 'isAdmin' src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`                                    | ≥2       | 3      |
| `grep -c 'Phase 88' src/ui/sidebar/CreateRoleDialog.test.tsx`                                                 | ≥1       | 1      |
| `grep -c 'Phase 88' src/ui/sidebar/NewSessionDialog.test.tsx`                                                 | ≥3       | 21     |
| `grep -c 'Phase 88' src/ui/sidebar/NewSessionDialog.chain.test.tsx`                                           | ≥1       | 3      |
| `grep -c 'Phase 88' src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`                                   | ≥1       | 3      |
| `grep -c 'Phase 88' src/ui/sidebar/NewSessionDialog.task-input.test.tsx`                                      | ≥2       | 8      |
| `grep -c 'expect(true).toBe(true)' src/ui/sidebar/NewSessionDialog.test.tsx` (T3 anti-pattern gate)           | 0        | 0      |
| `grep -cE 'identityMode(=true\|=false)' src/ui/sidebar/NewSessionDialog.task-input.test.tsx`                  | 0        | 0      |
| `grep -c 'just a shell.*no agent' src/ui/sidebar/NewSessionDialog.chain.test.tsx`                             | ≥1       | 1      |
| `grep -c 'just a shell.*no agent' src/ui/sidebar/NewSessionDialog.task-input.test.tsx`                        | ≥2       | 2      |

All grep gates pass.

## Threat Model Notes

STRIDE items from the plan's `<threat_model>` are all addressed:

- **T-88-03-01 (Repudiation — test refactor hides a real Phase 88 bug):** Mitigated by mirroring source shape from Plan 88-02 in every new/rewritten assertion. T1 asserts the two admin-gated DOM elements are absent when isAdmin=false; T2 asserts they are present with the defaults Plan 88-02 shipped (path='~/', checkbox unchecked); T3 asserts the wire contract from Plan 88-02 Edit F (`isAdmin ? normalizedPath : ""`). Rewrites for existing tests preserve check semantics — only describe/it strings + label regex change; assertion bodies stay against the pre-Phase-88 shape of `arg.identityMode` (public payload discriminant, unchanged). Coverage does not decrease.
- **T-88-03-02 (Denial of Service — test file grows too large):** Mitigated. Edit C was a mechanical regex-replacement. Edit F added ~68 lines (three tests). File grew from 1309 → 1440 lines (+131); well under the executable context budget for a scoped vitest run (which ran in ~11s).
- **T-88-03-03 (Information Disclosure — credentials in test setup):** Accepted. Tests use fake paths (`~/`), mock host IPs (`10.0.0.1`), synthetic identity names (`test-agent`, `alicia`), and vi.fn() mocks. No real filesystem paths, credentials, or environment secrets.
- **T-88-03-SC (Tampering — zero new deps):** Accepted. Pure TSX/test edits. No package.json / package-lock.json changes.

## Deviations from Plan

**Three deviations, all Rule 3 (blocking issues) that folded in scope required to bring the wave to green:**

**[Rule 3 — Blocking issue] Task 3 chain.test.tsx pre-existing Phase-86 drift**

- **Found during:** Task 3 initial test run.
- **Issue:** Tests 2a, 4b (host listbox suppressed by Phase 84 `hide-picker-when-1-host`), and Tests 10a/10b/10c (brief textarea stripped by Phase 86 Plan 86-04) were failing on causes UNRELATED to Wave 2. The plan Task 3 §Anti-patterns says "Do NOT delete tests"; the Wave 2 SUMMARY §Wave 3 Unblock Contract says "plan will also carry the pre-existing Wave-1 Phase-86 title/brief drift cleanup."
- **Fix:** Rewrote all 5 tests to reflect current source: Test 2a + Test 4b observe auto-selection via role-dropdown appearance (dropdown is inside `{selectedHost !== null && …}` gate); Tests 10a/10b as regression guards asserting brief STAYS absent; Test 10c as click-into-shell-mode regression guard.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.chain.test.tsx` (5 tests rewritten).
- **Commit:** folded into `665b7335` (Task 3).

**[Rule 3 — Blocking issue] Task 4 role-dropdown.test.tsx Test 23 + Test 24 + missed label regex**

- **Found during:** Task 4 initial test run.
- **Issue:** (a) Plan Task 4's read_first note said role-dropdown.test.tsx has "0 references to the checkbox-label regex" — inaccurate. Test 27 at L405 had one occurrence. (b) Tests 23 + 24 referenced Phase-86-deleted UI (title, brief, generate, avatar-pick img) and were failing on the deleted-UI setup, not the admin-gate.
- **Fix:** (a) Updated the L405 label regex site inline (didn't add IDENTITY_MODE_CHECKBOX_RE constant since only one site — plan Task 4 §Anti-patterns explicitly says "Do NOT add checkbox-label regex constants to this file — no test exercises the checkbox. Adding a constant that isn't used is dead code" — but only one usage isn't dead, it's just one usage). (b) Rewrote Test 23 + Test 24 to remove the deleted-UI setup; preserved the real assertions ("Create disabled without role, enabled after pick"; "birth body carries role").
- **Files modified:** `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` (3 tests updated).
- **Commit:** folded into `affd0fb5` (Task 4).

**[Rule 3 — Blocking issue] Task 5 fillFormForSubmit helper referenced deleted UI**

- **Found during:** Task 5 initial test run.
- **Issue:** The `fillFormForSubmit` helper at L165 filled `title` and `brief` inputs and clicked `generate` button then `img` selection — all Phase-86-deleted UI. 5 tests (Tasks 1d/1e/1f/3a/3b) flow through this helper and were failing on the deleted-UI setup.
- **Fix:** Stripped the title/brief/generate/img scaffolding from the helper. Post-Plan-86-04 canOpen requires only host + valid name + role — the helper's remaining scaffolding (name field fill + optional task text + wait for enabled Create) matches.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` (fillFormForSubmit helper).
- **Commit:** folded into `d7c130e3` (Task 5).

## Auth Gates

None. This plan required no authentication.

## Self-Check: PASSED

### Files exist verification

- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/CreateRoleDialog.test.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/NewSessionDialog.test.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/NewSessionDialog.chain.test.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/NewSessionDialog.task-input.test.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/.planning/phases/88-create-agent-modal-ux-pass-paired-header-blurbs-path-admin-g/88-03-SUMMARY.md` (this file)

### Commits exist verification

- [FOUND] `1453063f` — Task 1: update CreateRoleDialog Test 11 blurb regex + Phase-88 comment refresh
- [FOUND] `85a59be8` — Task 2: rewrite NewSessionDialog.test.tsx — helper + label + Test D + admin-gate tests
- [FOUND] `665b7335` — Task 3: rewrite NewSessionDialog.chain.test.tsx — label + admin-gate + brief-defunct
- [FOUND] `affd0fb5` — Task 4: update NewSessionDialog.role-dropdown.test.tsx — isAdmin helper + label + Phase-86 drift
- [FOUND] `d7c130e3` — Task 5: rewrite NewSessionDialog.task-input.test.tsx — helper + label + Task 1/3 strings

## Commits

| Task | Commit     | Files                                                       |
| ---- | ---------- | ----------------------------------------------------------- |
| 1    | `1453063f` | `src/ui/sidebar/CreateRoleDialog.test.tsx`                  |
| 2    | `85a59be8` | `src/ui/sidebar/NewSessionDialog.test.tsx`                  |
| 3    | `665b7335` | `src/ui/sidebar/NewSessionDialog.chain.test.tsx`            |
| 4    | `affd0fb5` | `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`    |
| 5    | `d7c130e3` | `src/ui/sidebar/NewSessionDialog.task-input.test.tsx`       |

## Wave Completion

Phase 88 (create-agent-modal-ux-pass) is now complete across all three waves:

- **Wave 1 (Plan 88-01, commits `9eb60747`, `873c73dd`, `59be09d1`):** `isAdmin?: boolean` prop plumbed to NewSessionDialog + PrettyConversationsPanel prop-forward + backend `identity-birth.ts` `~/<name>/` substitution when body.path is empty/absent.
- **Wave 2 (Plan 88-02, commits `252dd712`, `0595a0a9`, `ecad9a84`):** CreateRoleDialog blurb revised to paired two-sentence form; NewSessionDialog agent blurb revised; Path admin-gate wrapped; identity-mode checkbox admin-gate wrapped + label flipped to "Just a shell — no agent"; local state var renamed `identityMode` → `shellOnly` with default flipped (public wire-contract discriminant preserved); submit invariant `isAdmin && shellOnly` at onclick; `handleBirth` sends `path: isAdmin ? normalizedPath : ""`.
- **Wave 3 (Plan 88-03, this plan, commits `1453063f`, `85a59be8`, `665b7335`, `affd0fb5`, `d7c130e3`):** Restored green + locked new coverage. 5 test files rewritten to reflect Wave 2's semantic-inversion + admin-gate + label flip + default flip + blurb revision, plus 3 new lock-tests for admin-gate behavior + non-admin backend substitution wire contract.

Test coverage GAINS three new assertions (admin-gate hide, admin-gate render + defaults, non-admin backend substitution wire contract) that did not exist pre-Phase 88; total coverage is a strict superset of pre-Phase-88 coverage. Green gate: 89/89 tests passing across all 5 plan-named test files, 0 failures.
