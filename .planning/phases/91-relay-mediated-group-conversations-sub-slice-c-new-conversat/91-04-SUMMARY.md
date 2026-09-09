---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: 04
subsystem: frontend-sub-components
tags: [frontend, api-client, sub-components, tdd, slice-c]
dependency_graph:
  requires: [91-00, 91-01, 91-02, 91-03]
  provides:
    - createRelayRoom() frontend api client
    - ParticipantChip
    - ParticipantChipStrip
    - ParticipantSearchInput
    - ParticipantList
  affects:
    - src/ui/api/relay-room-create-api.ts
    - src/ui/api/relay-room-create-api.test.ts
    - src/ui/features/pretty-conversations/ParticipantChip.tsx
    - src/ui/features/pretty-conversations/ParticipantChipStrip.tsx
    - src/ui/features/pretty-conversations/ParticipantSearchInput.tsx
    - src/ui/features/pretty-conversations/ParticipantSubComponents.test.tsx
    - src/ui/features/pretty-conversations/ParticipantList.tsx
    - src/ui/features/pretty-conversations/ParticipantList.test.tsx
tech_stack:
  added: []
  patterns:
    - authApi-post-handleApiError-wrapper
    - hsl-hue-tinted-chip-with-NEUTRAL_GREY-fallback
    - pv-search-css-class-reuse
    - pv-hue-inline-custom-property-emission
    - data-attribute-for-jsdom-HSL-testability
    - role-listbox-option-sectioned-picker
key_files:
  created:
    - src/ui/api/relay-room-create-api.ts
    - src/ui/api/relay-room-create-api.test.ts
    - src/ui/features/pretty-conversations/ParticipantChip.tsx
    - src/ui/features/pretty-conversations/ParticipantChipStrip.tsx
    - src/ui/features/pretty-conversations/ParticipantSearchInput.tsx
    - src/ui/features/pretty-conversations/ParticipantSubComponents.test.tsx
    - src/ui/features/pretty-conversations/ParticipantList.tsx
    - src/ui/features/pretty-conversations/ParticipantList.test.tsx
  modified: []
decisions:
  - "data-swatch-color and data-avatar-color attributes added to chip swatch and avatar disc to preserve HSL string for test assertions — jsdom normalizes inline style.background from hsl() to rgb() making direct style assertions unreliable"
  - "ParticipantSearchInput reuses pv-search-container/pv-search-input/pv-search-icon/pv-search-clear CSS classes verbatim from PrettyConversationsPanel; zero new CSS defined"
  - "ParticipantList section headers always render (even when section is empty) per 'both sections always visible' PATTERNS.md decision; empty-section placeholder text shown inside section body"
  - "hsl(colorHue, 80%, 60%) formula from RelayInboundBubble.tsx:82 used for chip swatches; hsl(hue, 60%, 45%) for avatar disc backgrounds (per PATTERNS.md ParticipantList sketch)"
  - "colorHue derivation NOT done in ParticipantList — component consumes whatever colorHue is on the passed PickedParticipant; Plan 05 (modal shell) handles hueFromSessionName() derivation at construction time per plan spec"
  - "Test 6 (empty humans section): getByText(/Humans/i) ambiguous when 'No humans available' placeholder present; fixed by querying role=separator elements instead"
  - "Test 10 (avatar img): img with alt='' has presentation role in a11y tree, not 'img'; fixed by querying via DOM selector querySelector('img[src=...]')"
metrics:
  duration: "~7 minutes"
  completed: "2026-09-09"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 8
  tests_added: 21
  tests_total: 21
---

# Phase 91 Plan 04: Frontend API Client + Presentational Sub-Components Summary

**One-liner:** Five new frontend files (createRelayRoom api client + ParticipantChip/ChipStrip/SearchInput/List) with 21 tests, zero new CSS, reusing existing pv-search-* classes and hsl-hue-tint patterns from the pretty-conversations feature dir.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| RED-1 | Failing tests for api client + chip/strip/search | f233ffae | relay-room-create-api.test.ts, ParticipantSubComponents.test.tsx |
| GREEN-1 | Implement api client + chip/strip/search components | 6e453ee7 | relay-room-create-api.ts, ParticipantChip.tsx, ParticipantChipStrip.tsx, ParticipantSearchInput.tsx |
| RED-2 | Failing tests for ParticipantList | 5f1fc70e | ParticipantList.test.tsx |
| GREEN-2 | Implement ParticipantList sectioned picker | c2564097 | ParticipantList.tsx, ParticipantList.test.tsx (updated) |

## What Was Built

### relay-room-create-api.ts

`createRelayRoom(req: CreateRelayRoomRequest): Promise<CreateRelayRoomResponse>` — thin wrapper over `authApi.post("/relay-room/create", req)` with `handleApiError(error, "create relay room")` in the catch branch. Imports `authApi` + `handleApiError` from `@/main-axios` (same pattern as user-management-api.ts). Types from `participant-types.ts` (Plan 01).

### ParticipantChip.tsx

Single participant chip: color swatch (hsl(colorHue, 80%, 60%) or NEUTRAL_GREY hsl(210, 8%, 50%) fallback, locked from RelayInboundBubble.tsx:82) + truncated displayName (React text-content only) + X-remove Button with aria-label. `data-swatch-color` attribute preserves the HSL string for test assertions — jsdom normalizes inline style to RGB. `role="listitem"` for strip a11y.

### ParticipantChipStrip.tsx

Strip wrapper: empty state returns a muted italic "No participants selected yet" placeholder (no `role="list"` emitted — an empty list is not a list). Populated: `role="list"` + `aria-label="Selected participants"` div mapping chips. Zero CSS defined — reuses flex/gap Tailwind utilities.

### ParticipantSearchInput.tsx

Verbatim adaptation of PrettyConversationsPanel.tsx:1698-1729. Reuses `.pv-search-container`, `.pv-search-input`, `.pv-search-icon`, `.pv-search-clear` CSS classes without defining any new styles. Controlled: `onChange(e.target.value)` and `onChange("")` on clear. aria-label/placeholder defaulting to "Search participants".

### ParticipantList.tsx

Sectioned listbox (`role="listbox"`, `aria-label="Participant picker"`) with two `role="separator"` section headers (Humans + Agents). Each header shows "Label (N of M)" when `filterActive=true` and `humansTotal/agentsTotal` supplied. Empty sections show muted italic placeholder.

`ParticipantRow` (private): `role="option"`, `aria-selected={selected}`, `tabIndex={0}`, onClick + onKeyDown (Enter/Space, Space calls `e.preventDefault()`). `--pv-hue` emitted inline per PrettyConversationRow.tsx:1083-1089 pattern. Avatar disc: hsl(hue, 60%, 45%) background with `data-avatar-color` attribute for test assertions; `<img src alt="">` when avatarUrl truthy, else initial letter span. Agent subtitle via `data-testid="row-subtitle"`. Check circle: emerald filled when selected, quiet ring border when not.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] jsdom HSL-to-RGB normalization broke style assertions**
- **Found during:** Task 1 GREEN
- **Issue:** jsdom normalizes `hsl(200, 80%, 60%)` to `rgb(71, 180, 235)` when reading back any inline style property (`.style.background`, `.style.cssText`, `getAttribute("style")`). Tests 3 and 5 (chip swatch color) failed.
- **Fix:** Added `data-swatch-color={swatchColor}` attribute to the swatch span in `ParticipantChip.tsx`. Tests assert `getAttribute("data-swatch-color")` which preserves the original HSL string. Same pattern applied to avatar disc (`data-avatar-color` in ParticipantList.tsx) for Test 11.
- **Files modified:** ParticipantChip.tsx, ParticipantList.tsx, ParticipantSubComponents.test.tsx, ParticipantList.test.tsx
- **Impact:** Zero runtime behavior change; the `data-*` attributes are decorative for testing and invisible to users.

**2. [Rule 1 - Bug] Test 6 ambiguous text match**
- **Found during:** Task 2 GREEN
- **Issue:** `screen.getByText(/Humans/i)` matched both the section header text "Humans" AND the empty-section placeholder "No humans available" when humans=[], agents=[x].
- **Fix:** Updated Test 6 to use `screen.getAllByRole("separator")[0]` + `textContent` assertion, which unambiguously targets the section header.
- **Files modified:** ParticipantList.test.tsx

**3. [Rule 1 - Bug] Test 10 img with alt="" not found by role "img"**
- **Found during:** Task 2 GREEN
- **Issue:** `screen.getByRole("img", { hidden: true })` failed — an `<img alt="">` has implicit role "presentation" in the a11y tree, not "img".
- **Fix:** Updated Test 10 to use `document.querySelector("img[src='https://x/a.png']")` which directly matches the element regardless of ARIA role.
- **Files modified:** ParticipantList.test.tsx

## TDD Gate Compliance

- [x] RED gate: `test(91-04)` commits (f233ffae, 5f1fc70e) exist before GREEN commits
- [x] GREEN gate: `feat(91-04)` commits (6e453ee7, c2564097) exist after RED commits
- [x] All 21 tests pass at GREEN gate

## Known Stubs

None. All five source files are fully implemented. `colorHue` derivation is explicitly deferred to Plan 05 per plan spec — `ParticipantList` consumes whatever `colorHue` is on the passed participant, and Plan 05 will supply `hueFromSessionName(mxid)` for humans without a persisted hue. This is not a stub — it's a clean interface boundary.

## Threat Flags

None. This plan adds five purely presentational frontend files and one api client wrapper. No new network endpoints. No new auth paths. All text rendered via React text-content only (no dangerouslySetInnerHTML). The new `createRelayRoom` api client calls the existing `/relay-room/create` endpoint established in Plan 03 with its full threat model. No new trust-boundary surfaces introduced.

## Self-Check: PASSED

- [x] `src/ui/api/relay-room-create-api.ts` exists
- [x] `src/ui/api/relay-room-create-api.test.ts` exists
- [x] `src/ui/features/pretty-conversations/ParticipantChip.tsx` exists
- [x] `src/ui/features/pretty-conversations/ParticipantChipStrip.tsx` exists
- [x] `src/ui/features/pretty-conversations/ParticipantSearchInput.tsx` exists
- [x] `src/ui/features/pretty-conversations/ParticipantSubComponents.test.tsx` exists
- [x] `src/ui/features/pretty-conversations/ParticipantList.tsx` exists
- [x] `src/ui/features/pretty-conversations/ParticipantList.test.tsx` exists
- [x] Commits f233ffae, 6e453ee7, 5f1fc70e, c2564097 exist in git log
- [x] `npx vitest run` — 21/21 tests pass
- [x] `npx tsc --noEmit` — 0 errors
- [x] All acceptance criteria grep gates satisfied
- [x] `git diff --stat` limited to 8 files in `files_modified` (5 source + test companion pair + consolidated test file)
- [x] No modal-shell touches (Plan 05). No backend touches. No PrettyConversationsPanel touches.
