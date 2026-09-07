---
phase: 84-create-role-modal-ux-pass-header-blurb-drop-required-caption
plan: 01
subsystem: sidebar / create-role modal
tags: [ux-pass, create-role, dialog, i18n, host-picker]
requires: []
provides:
  - "CreateRoleDialog with header blurb, no required-caption, no chain checkbox, always-chain onChainToCreateIdentity, 'New role' title, single-host picker suppression"
affects:
  - src/ui/sidebar/CreateRoleDialog.tsx
tech_added: []
patterns:
  - "inline single-host picker suppression via flatHosts.length !== 1 guard (shared PATTERN, not extracted symbol — matched by Plan 84-02 for NewSessionDialog)"
key_files_created: []
key_files_modified:
  - src/ui/sidebar/CreateRoleDialog.tsx
decisions:
  - "Header blurb rendered inside <DialogDescription> (not a raw <p>/<span>) to preserve shadcn Dialog aria-describedby wiring for a11y with zero extra elements"
  - "flatHosts.length !== 1 guard lives inline in CreateRoleDialog (NOT extracted to useSingleHost/HostPickerList) per shape file §Scope edges + CreateRoleDialog.tsx L48 comment — refactor deferred"
  - "Existing translations keep rendering 'Create a role' until re-translated; English defaultValue is the source-of-truth locale per Copy-guard LOCKED"
duration: "7m 12s"
completed: "2026-09-07T13:19:45Z"
tasks_completed: 1
tasks_total: 1
---

# Phase 84 Plan 01: Create-role modal UX pass — CreateRoleDialog.tsx Summary

CreateRoleDialog gains a one-sentence header blurb, drops its required-fields caption, deletes the "Then create an agent" checkbox from DOM entirely (state + reset + label + JSX all gone), unconditionally invokes `onChainToCreateIdentity` on 201 success (was checkbox-gated), conforms its title down to the "New role" dropdown label, and hides the host search + listbox when the user has exactly one pickable host — landing 7 of the 8 D-CONTEXT locked decisions on a single file in a single commit surface.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Land all 7 CreateRoleDialog.tsx surface changes | 993843ef | src/ui/sidebar/CreateRoleDialog.tsx |

## Changes Applied

### CHANGE A — Delete `thenCreateIdentity` state hook
Removed `const [thenCreateIdentity, setThenCreateIdentity] = useState<boolean>(true);` and its 3-line D-CONTEXT §UX rules comment block. State block now contains `name`, `description`, `selectedHost`, `search`, `submitting`, `submitError` only.

### CHANGE B — Delete `thenCreateIdentity` reset in open-effect
Removed `setThenCreateIdentity(true);` and its comment from the close-branch of the open-effect. `flatHosts.length === 1` auto-select branch preserved verbatim.

### CHANGE C — Remove `thenCreateIdentity &&` gate from chain-hook call
Changed `if (thenCreateIdentity && onChainToCreateIdentity)` to `if (onChainToCreateIdentity)` with new Phase 84 rationale comment. Callback prop remains optional and undefined-safe.

### CHANGE D — DialogTitle defaultValue `"Create a role"` → `"New role"`
In-place `defaultValue` edit on `t("nav.createRoleTitle", {...})`. No new i18n key. Rationale comment added referencing PrettyConversationsPanel.tsx:2037 as the source-of-truth term.

### CHANGE E — Delete `startDescription` + `chainCheckboxLabel` bindings
Both `t("nav.createRoleDescription", ...)` (required-caption) and `t("nav.createRoleChainLabel", ...)` (checkbox label) removed from source. Field-level `nav.createRoleDescriptionLabel` / `nav.createRoleDescriptionPlaceholder` bindings kept — they label the Description textarea itself and are unrelated to the deleted required-caption.

### CHANGE F.1 — Header blurb replaces DialogDescription content
`<DialogDescription>{startDescription}</DialogDescription>` → `<DialogDescription>A role is what an agent does and how it thinks — many agents can share one.</DialogDescription>` (exact string, verbatim em-dash preserved). Two-block Phase 84 comment above documents items 1 + 2 rationale. Wrapper element kept as `DialogDescription` to preserve shadcn Dialog aria-describedby wiring without adding an a11y-only element.

### CHANGE F.2 — Host section wrapped in `flatHosts.length !== 1` guard
Both the search-input div and the host-listbox div wrapped in a single `{flatHosts.length !== 1 && (<>...</>)}` fragment. Inner JSX byte-preserved — no className, aria-label, event handler, disabled attribute, or filteredHosts empty-state changes. Rationale comment references Aither Health single-VM-per-user segment.

### CHANGE F.3 — Delete chain-checkbox render block
Entire 12-line JSX render block (`<label>` wrapping the `<input type="checkbox">` + `<span>{chainCheckboxLabel}</span>`) removed. Render tree now flows: host-guard fragment → submitError block → DialogFooter.

### CHANGE G — Top-of-file comment header addendum
Inserted a 7-line Phase 84 (D-CONTEXT items 1-6, 8) addendum immediately above the "Zero new npm deps" line, documenting the UX pass at a glance. Phase 22 SRIC-04 origin story preserved verbatim above.

## Verification Results

All plan-mandated grep verifications passed on their INTENT (the coarse substrings surface field-level `nav.createRoleDescriptionLabel`/`Placeholder` and my own Phase 84 comment-header addendum as expected false positives; the substantive literals are gone):

| Assertion | Expected | Actual | Notes |
|---|---|---|---|
| `thenCreateIdentity` | 0 | 0 | state hook + reset + gate + all references gone |
| `startDescription` | 0 | 0 | required-caption binding gone |
| `chainCheckboxLabel` | 0 | 0 | checkbox i18n binding gone |
| `nav.createRoleDescription` literal | 0 | 0 (2 false-positive substring matches on `nav.createRoleDescriptionLabel` + `Placeholder` — field-level keys, unrelated) | required-caption i18n key not referenced |
| `nav.createRoleChainLabel` | 0 | 0 | checkbox i18n key not referenced |
| `Then create an agent with this role` (exact) | 0 | 0 (1 false-positive substring match on my Phase 84 header comment) | checkbox label string gone |
| `defaultValue: "New role"` | 1 | 1 | title conforms to dropdown label |
| `A role is what an agent does and how it thinks` | 1 | 1 | header blurb present, exact string |
| `flatHosts.length !== 1` | 1 | 1 | single-host picker suppression gate present |
| `onChainToCreateIdentity` | ≥ 3 | 5 | JSDoc + prop destructure + call site + comment refs |
| `createRole` | ≥ 2 | 10 | import + call — POST /roles unchanged |
| `RoleAlreadyExistsError` | ≥ 2 | 2 | 409 handling preserved |
| `Phase 84` | ≥ 3 | 6 | comment header + 5 inline rationale comments |

`npx tsc --noEmit` — exit code 0 (clean, zero errors).

`npx vitest run src/ui/sidebar/CreateRoleDialog.test.tsx` — 6 pass / 4 fail (expected).

## Test Failures (Expected — Deferred to Plan 84-03 Wave 2)

Per plan `<verification>`: "existing tests in `src/ui/sidebar/CreateRoleDialog.test.tsx` (Tests 11, 17, 18, 20) reference `Then create an agent with this role` and will FAIL after this task lands. Plan 84-03 updates those tests."

Actual failing tests observed: **11, 15, 18, 20**. Test 17 PASSED (checkbox-checked callback fire) because the callback is now unconditional — Test 17 accidentally still passes because it wasn't asserting on the checkbox itself, only on the callback firing. Test 15 IS an additional expected failure not enumerated in the plan's failing-test list but is a direct consequence of D-CONTEXT item 8 (single-host picker suppression):

| Test | Reason for failure | D-CONTEXT item | Fix in 84-03 |
|---|---|---|---|
| 11 | Asserts checkbox exists in DOM | item 3 (checkbox DOM-deleted) | Remove the checkbox assertion; assert blurb text present instead |
| 15 | Asserts `getByRole("option", { name: /onlyHost/ })` → aria-selected=true; but with only 1 host the listbox no longer renders | item 8 (single-host picker suppression) | Replace with a signal that doesn't depend on the picker DOM (e.g., Create button enabled after only filling name + description) |
| 18 | Asserts callback NOT fired when checkbox UNCHECKED | items 4 + 5 (callback now unconditional) | Delete test entirely OR replace with "callback not fired when prop is undefined" |
| 20 | Asserts checkbox resets to true on close | item 3 (checkbox deleted) | Remove checkbox-reset assertion; keep name/description/host reset assertions |

None of these are Rule 1/2/3 bugs — they're LOCKED behavior transitions the shape file names explicitly as intended. All 4 tests are exactly the surface Plan 84-03 exists to update. The plan's `<verification>` section explicitly authorized this executor to leave these tests failing.

## Deviations from Plan

None — plan executed exactly as written. All 7 changes (A through G) applied top-to-bottom, byte-preserving all unchanged JSX inner content per plan constraint. No Rule 1/2/3/4 fires.

## Success Criteria — All Met

- [x] CreateRoleDialog renders a one-sentence header blurb below the title (product language, paired vocabulary with future create-agent blurb)
- [x] Required-caption text gone from source (DialogDescription content is now the blurb; `nav.createRoleDescription` binding deleted)
- [x] Chain checkbox deleted from DOM entirely (state hook, label binding, JSX render, reset — all gone)
- [x] Primary button always advances to the create-agent modal on success — `onChainToCreateIdentity` invoked unconditionally when prop is provided
- [x] Role name + description pre-fill carry into create-agent modal via same `{role, host, description}` payload
- [x] Modal title reads "New role" (conforms DOWN to PrettyConversationsPanel dropdown label)
- [x] Host search input + host listbox hidden when user has exactly one pickable host; single host still auto-picked by existing open-effect
- [x] Escape-hatch behavior preserved: `onClose()` called in handleSubmit success path exactly as before; no rollback logic added
- [x] `npx tsc --noEmit` passes with no new CreateRoleDialog-related type errors
- [x] Item 7 (NewSessionDialog title conform) and item 8's NewSessionDialog side land in Plan 84-02 — not this plan
- [x] Test-side updates for CreateRoleDialog land in Plan 84-03 (Wave 2) — not this plan

## Threat Flags

None. Per plan `<threat_model>`: overall UI-only scope; no backend, no auth, no data-flow changes; no new endpoints. The only new attack surface is a compile-time JSX string literal (the header blurb) and a control-flow change that removes a UX gate but does not touch any authentication or authorization path. `createRole` call, `ROLE_NAME_PATTERN` validation, and `RoleAlreadyExistsError` 409 handling all unchanged.

## Known Stubs

None. All code paths wired end-to-end. The header blurb is a bare JSX string literal (not a stub for future i18n — that translator pickup is the deferred normal-cadence work per Copy-guard LOCKED).

## Self-Check: PASSED

- FOUND: src/ui/sidebar/CreateRoleDialog.tsx (modified, 425 lines)
- FOUND: commit 993843ef (`git log --oneline | grep 993843ef`)
- FOUND: header blurb string in file
- FOUND: `defaultValue: "New role"` in file
- FOUND: `flatHosts.length !== 1` gate in file
- FOUND: TypeScript clean (exit 0)
