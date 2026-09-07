---
phase: 84-create-role-modal-ux-pass-header-blurb-drop-required-caption
plan: 03
subsystem: sidebar / pretty-conversations — test-side realignment
tags: [ux-pass, create-role, create-agent, dialog, tests, realignment]
requires:
  - 84-01
  - 84-02
provides:
  - "CreateRoleDialog test suite aligned with Phase 84 landed code — checkbox tests removed/updated, header blurb assertion added, single-host picker-suppression test added"
  - "PrettyConversationsPanel.test.tsx Test 5 title assertion updated to /new agent/i (matches Plan 84-02's title conform)"
  - "PrettyConversationsPanel.new-role-button.test.tsx Test 21c CreateRoleDialog-detection swapped from deleted checkbox text to a stable Phase-84 signal"
affects:
  - src/ui/sidebar/CreateRoleDialog.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
tech_added: []
patterns:
  - "test-file realignment after landed source changes — assertions swapped for stable signals, deleted-behavior tests replaced with audit-trail comments, new tests added for new behavior"
key_files_created: []
key_files_modified:
  - src/ui/sidebar/CreateRoleDialog.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
decisions:
  - "Test 18 (checkbox UNCHECKED → chain does NOT fire) DELETED with an audit-trail comment in place — the behavior it verified is gone per D-CONTEXT item 4 LOCKED (primary button ALWAYS advances); comment preserves reasoning so a future grep for 'Test 18' finds context, not a phantom-deletion"
  - "Test 21c detection signal swapped to the header blurb 'a role is what an agent does' (not the /new role/ title) — blurb is more resilient to future two-word title tweaks and uniquely identifies CreateRoleDialog vs NewSessionDialog which both now use two-word titles"
  - "Test 15 assertion shifted from listbox-option aria-selected to picker-suppression + canOpen predicate — the sole host is still auto-picked (Plan 84-01 CHANGE B kept the open-effect intact) but the listbox is now HIDDEN (CHANGE F.2), so evidence-of-auto-select shifts to Create-button-enable after valid name + desc"
  - "New Test 22 added directly implements Plan 84-01 CHANGE F.2 acceptance: single-host tree → no listbox, no search input, no option button, but Create enables with valid inputs — end-to-end verification of the picker-suppression primitive"
duration: "~7m"
completed: "2026-09-07T13:50:00Z"
tasks_completed: 2
tasks_total: 2
---

# Phase 84 Plan 03: Test-side realignment for Phase 84 UX pass Summary

Test files realigned to match the CreateRoleDialog + NewSessionDialog behavior that landed in Waves 1-2 (Plans 84-01, 84-02). The chain-checkbox tests are gone (behavior deleted per D-CONTEXT item 4); a new header-blurb assertion covers Plan 84-01 CHANGE F.1; a new Test 22 covers Plan 84-01 CHANGE F.2 (single-host picker suppression) end-to-end; the sibling-dialog title assertion in PrettyConversationsPanel.test.tsx flips to `/new agent/i` (Plan 84-02); and PrettyConversationsPanel.new-role-button.test.tsx swaps its CreateRoleDialog-detection signal from the deleted checkbox text to the Phase-84-stable header blurb. Three scoped `npx vitest run` invocations (one per touched file) all exit 0 — the campaign-constraint-compliant acceptance signal.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update PrettyConversationsPanel.test.tsx Test 5 + PrettyConversationsPanel.new-role-button.test.tsx Test 21c | d33418d1 | src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx |
| 2 | Realign CreateRoleDialog.test.tsx (Tests 11/15/17/20 updated; Test 18 deleted; Test 22 added) | c308278d | src/ui/sidebar/CreateRoleDialog.test.tsx |

## Changes Applied

### Task 1 — Sibling-dialog + dialog-detection assertions

**PrettyConversationsPanel.test.tsx Test 5 (L1259-1299)**

- it-title gains "Phase 84 Plan 02 title-conform" addendum
- Title assertion `expect(dialog!.textContent).toMatch(/start a new agent/i)` → `toMatch(/new agent/i)`
- Rationale comment above the assertion documents Plan 84-02's title conform to the dropdown source-of-truth at PrettyConversationsPanel.tsx:2036 and notes the i18n key `nav.newSessionTitle` is unchanged (only `defaultValue`)

**PrettyConversationsPanel.new-role-button.test.tsx Test 21c (L204-226)**

- it-title gains "Phase 84 Plan 01 signal swap" addendum
- Detection signal swapped: `toMatch(/then create an agent with this role/i)` → `toMatch(/a role is what an agent does/i)`
- Rationale comment documents that the checkbox this suite used as its CreateRoleDialog-detection anchor was DELETED in Plan 84-01 (per D-CONTEXT item 3) and that the header blurb uniquely identifies CreateRoleDialog vs NewSessionDialog (which both now have two-word titles that a `/new role/` regex would collide with)

### Task 2 — CreateRoleDialog.test.tsx per-test realignment

**EDIT HEADER — Top-of-file Phase 84 addendum block**

29-line addendum inserted immediately after the pre-existing L28-29 comment closing (`// so those mocks are omitted.`). Enumerates the Test 11/15/17/18/20/22 deltas as a single audit anchor for future readers grepping the file.

**EDIT 11 — Test 11 (renders … + chain-checkbox CHECKED by default)**

- it-title now: `Test 11 (Phase 84 Plan 03): renders Name input, Description textarea, Host picker; header blurb present below title; required-caption + chain-checkbox both DELETED from DOM`
- The 6-line `screen.getByRole("checkbox", ...)` block replaced with three assertion clusters:
  1. `queryByRole("checkbox", { name: /then create an agent with this role/i })` returns null (chain-checkbox DELETED per Plan 84-01 CHANGE F.3)
  2. `getByText(/A role is what an agent does and how it thinks — many agents can share one\./)` returns truthy (header blurb present per Plan 84-01 CHANGE F.1)
  3. `queryByText(/Name and description are required/i)` returns null (required-caption DELETED per Plan 84-01 CHANGE E.1 + F.1)

**EDIT 15 — Test 15 (auto-select single host on open)**

- it-title now: `Test 15 (Phase 84 Plan 03): Auto-select single host on open — listbox is HIDDEN per Plan 84-01 CHANGE F.2, but sole host is still auto-picked as evidenced by canOpen predicate`
- Old assertion (aria-selected on the listbox option) removed — listbox no longer rendered at length===1
- New assertion cluster: `queryByRole("listbox")` null + `queryByPlaceholderText(/search hosts/i)` null + fill name+desc → Create button enabled (evidence that `selectedHost !== null` in `canOpen` predicate, which is only true if the open-effect's auto-select-single-host branch fired)

**EDIT 17 — Test 17 (chain callback fires + undefined-safe)**

- it-title now: `Test 17 (Phase 84 Plan 03): On successful submit, onChainToCreateIdentity is invoked UNCONDITIONALLY when the callback prop is provided (checkbox gate removed per Plan 84-01 CHANGE C); also safe when the callback prop is undefined`
- Body rebuilt: no checkbox interaction (checkbox no longer in DOM); the two-part semantic (cb-provided fires, cb-undefined is safe) preserved via the same rerender-with-undefined pattern
- Payload assertion unchanged: `chainSpy` called with `{ role, host, description }` shape

**EDIT 18 — Test 18 DELETED**

- The 25-line Test 18 block (`checkbox UNCHECKED → chain does NOT fire`) replaced with a 5-line audit-trail comment citing D-CONTEXT item 4 LOCKED. The behavior it verified no longer exists; the comment preserves reasoning so future `grep -n 'Test 18'` yields context, not a phantom-deletion.

**EDIT 20 — Test 20 (state reset on modal close)**

- it-title now: `Test 20 (Phase 84 Plan 03): On modal close, all state resets (name, description, host). The checkbox reset assertion is DELETED — the state hook itself was deleted (Plan 84-01 CHANGE A).`
- Body: checkbox interaction removed (no checkbox to click/uncheck); the `expect(checkbox.checked).toBe(true)` reset assertion replaced with `queryByRole("checkbox", ...)` null assertion (checkbox not in re-opened dialog at all)
- Name / description / host-aria-selected reset assertions preserved verbatim

**EDIT 22 — NEW Test 22 (single-host picker suppression)**

Inserted immediately before the closing `});` of the outer `describe("CreateRoleDialog", () => { ... });` block:

- it-title: `Test 22 (Phase 84 Plan 03; implements Plan 84-01 CHANGE F.2): with a single-host hostTree, the search input and the host listbox are NOT rendered; the sole host is still auto-picked into selectedHost, so Create becomes enabled once name + description are valid`
- Assertions: `queryByRole("listbox")` null + `queryByPlaceholderText(/search hosts/i)` null + `queryByRole("option", { name: /onlyHost/ })` null + valid name/desc → Create button enabled

## Verification Results

### Grep acceptance checks

Executed per plan `<verification>` section:

| Assertion | Expected | Actual | Result |
|---|---|---|---|
| `grep -c 'it("Test 18' src/ui/sidebar/CreateRoleDialog.test.tsx` | 0 | 0 | PASS |
| `grep -c 'it("Test 22' src/ui/sidebar/CreateRoleDialog.test.tsx` | 1 | 1 | PASS |
| `grep -c 'A role is what an agent does and how it thinks' src/ui/sidebar/CreateRoleDialog.test.tsx` | ≥ 1 (verify) / 1 (done) | 2 | PASS-verify, note-inconsistent-with-done |
| `grep -c 'thenCreateIdentity' src/ui/sidebar/CreateRoleDialog.test.tsx` | 0 (done) | 2 | note-inconsistent-with-done |
| `grep -c 'toMatch(/new agent/i)' src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | ≥ 1 | 1 | PASS |
| `grep -c 'toMatch(/start a new agent/i)' src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 0 | 0 | PASS |
| `grep -c 'a role is what an agent does' src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` | ≥ 1 | 1 | PASS |
| `grep -c 'then create an agent with this role' src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` | 0 | 0 | PASS |
| `grep -c 'Phase 84' src/ui/sidebar/CreateRoleDialog.test.tsx` | ≥ 6 | 13 | PASS |
| `grep -c 'queryByRole("listbox")' src/ui/sidebar/CreateRoleDialog.test.tsx` | ≥ 2 | 2 | PASS |

**Plan-internal inconsistency note (`thenCreateIdentity` count):** The plan's `<done>` block asserts `grep -c 'thenCreateIdentity'` returns 0, but the plan's `<action>` block for EDIT HEADER and EDIT 20 mandates comment content that explicitly names `thenCreateIdentity` (in the addendum block: `(no more thenCreateIdentity gate)` and in EDIT 20: `the thenCreateIdentity state hook was DELETED`). The executable-code count of `thenCreateIdentity` references is 0 (the state hook is neither imported nor exercised anywhere); the two remaining references are the plan-mandated explanatory comments. Same shape for the "A role is what an agent does…" blurb string: the addendum block plan-mandated content contains it (line 29 addendum lists Test 11 delta including the blurb text), and the executable assertion at Test 11 also contains it — so `grep -c` returns 2. The plan `<verification>` section (authoritative operational block; uses `| grep -v '^0$'` = "at least 1") passes; the `<done>` bullet strict-1 counts don't match the plan's own edit instructions. Executable behavior is correct per plan `<action>`.

### Scoped test runs (campaign-constraint-compliant)

| Command | Result |
|---|---|
| `npx vitest run src/ui/sidebar/CreateRoleDialog.test.tsx` | **10 passed / 0 failed** (exit 0) |
| `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | **112 passed / 0 failed** (exit 0) |
| `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` | **3 passed / 0 failed** (exit 0) |

Total: **125 tests pass across three scoped runs.** CreateRoleDialog.test.tsx went from 10 tests (pre-Phase-84) to 10 tests (Test 18 deleted, Test 22 added, net-zero count change).

## Deviations from Plan

### Auto-fixed Issues

None. Two tasks executed per plan `<action>` blocks with zero Rule 1/2/3/4 fires. No source-file changes (test-only plan per campaign directive).

### Plan-internal inconsistencies observed (not deviations — noted for planner)

Two of the plan's `<done>` bullets specify strict counts that conflict with the plan's own `<action>` block-mandated comment content:

1. **`grep -c 'thenCreateIdentity' … returns exactly 0`** — but the plan's EDIT HEADER addendum text (line 44 of PLAN.md) and EDIT 20 rationale comment (line 495-496 of PLAN.md) both name `thenCreateIdentity` explicitly. Actual: 2 references, both in plan-mandated explanatory comments. No executable-code references (the state hook is genuinely gone from the test suite).

2. **`grep -c 'A role is what an agent does and how it thinks' … returns exactly 1`** — but the plan's EDIT HEADER addendum text (line 227-228 of PLAN.md) also names the blurb string. Actual: 2 references (once in addendum comment, once in Test 11 assertion regex).

**Interpretation:** The `<verification>` block (authoritative for automated verification — uses `| grep -v '^0$'` for both) treats these as "at least 1" checks and passes both. The `<done>` block appears to have miscounted the effect of the plan's own EDIT HEADER instructions. Followed `<action>` block verbatim; noted the inconsistency here so a future planner can tighten the `<done>` bullet phrasing to match `<verification>`.

## Test Failures

None. All 125 tests across the three scoped runs pass on the first invocation post-edit.

## Success Criteria — All Met

- [x] PrettyConversationsPanel.test.tsx Test 5 assertion flipped from `/start a new agent/i` to `/new agent/i` — matches Plan 84-02's title conform
- [x] PrettyConversationsPanel.new-role-button.test.tsx Test 21c dialog-detection signal swapped from the deleted checkbox text to the Phase-84-stable blurb regex — resilient to future title tweaks in either dialog
- [x] CreateRoleDialog.test.tsx Tests 11, 15, 17, 20 updated in place; Test 18 deleted with an audit-trail comment; new Test 22 added for single-host picker suppression
- [x] The top-of-file comment header in CreateRoleDialog.test.tsx documents every Test 11/15/17/18/20/22 delta as a single audit anchor
- [x] Every plan-mandated grep-based acceptance check hits its expected count (using the `<verification>` block's "at least 1" phrasing where the `<done>` block's strict count conflicts with the plan's own edit instructions)
- [x] Three scoped `npx vitest run <file>` invocations all exit 0 (125 tests pass total)
- [x] Campaign constraint honored: no full-suite run, no docker build, no docker cp, no deploy, no push
- [x] Phase 84 test-side complete; the executable spec accurately describes the Phase 84 landed code across all three touched test files
- [x] No source-file changes (test-only plan per campaign directive; no Rule 4 architectural triggers)

## Threat Flags

None. Per plan `<threat_model>`: pure test-file edit, no `package.json`/`package-lock.json` changes, no new npm installs, no backend surface, no data-flow changes. T-84-03-01 (repudiation risk for Test 18 deletion) mitigated via the audit-trail comment in place + the top-of-file addendum block enumerating the delta.

## Known Stubs

None. All test assertions are wired to real DOM queries against the actual Phase 84 landed component behavior; no placeholders, no TODO, no "coming soon" copy.

## Self-Check: PASSED

- FOUND: src/ui/sidebar/CreateRoleDialog.test.tsx (modified, +146/-58 diff)
- FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (modified)
- FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx (modified)
- FOUND: commit d33418d1 (Task 1) in `git log --oneline`
- FOUND: commit c308278d (Task 2) in `git log --oneline`
- FOUND: scoped vitest run 1 (CreateRoleDialog): 10 passed
- FOUND: scoped vitest run 2 (PrettyConversationsPanel): 112 passed
- FOUND: scoped vitest run 3 (new-role-button): 3 passed
- FOUND: campaign constraint honored — no full-suite run, no docker, no push
