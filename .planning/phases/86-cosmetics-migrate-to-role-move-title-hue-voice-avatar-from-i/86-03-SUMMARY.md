---
phase: 86-cosmetics-migrate-to-role
plan: 03
subsystem: create-role-dialog
tags:
  - frontend
  - cosmetic-authoring
  - avatar-generator
  - multipart-caller
  - phase-84-regression-preserve
dependency_graph:
  requires:
    - Plan 86-01 Task 3 (createRole multipart client — RoleCosmeticInput type,
      widened signature, avatar File arg)
    - Plan 86-02 (POST /roles multipart endpoint with cosmetics + role-folder
      avatar sibling write — the endpoint this dialog now calls end-to-end)
  provides:
    - CreateRoleDialog with four cosmetic authoring controls (Title, Voice,
      Color, Avatar) inserted between Description and Host picker
    - Inline avatar generator (Generate/Regenerate + Upload) mirroring
      NewSessionDialog L1257-1366 pattern with role-scoped seeds
    - Required-field validation on all four cosmetic controls
      (D-CTX-86-empty-not-scenario enforcement)
    - Raw-File-in-multipart avatar transport (D-CTX-86-surface-3 LOCKED)
  affects:
    - Plan 86-04 (NewSessionDialog strip — mirror deletion of the same
      cosmetic controls from the identity-mode branch)
    - Plan 86-06 (test-side updates — 7 Phase 84 tests will need to be
      re-written to set the new required cosmetic gates before asserting
      canOpen; enumerated in "Test failures for Plan 86-06" below)
tech_stack:
  added: []
  patterns:
    - "Reused ColorPicker + VoicePicker imports from @/features/pretty-view/pickers
      (mirrors NewSessionDialog L62-63 + IdentityModal L1763-1772 usage) —
      zero new picker code"
    - "Inline avatar-generator flow (D-CTX-86-surface-3 planner's discretion
      option b) — Generate/Regenerate + Upload + carousel copied from
      NewSessionDialog L1257-1366 verbatim with role-scoped seed mapping"
    - "Random-hue seed on each dialog open (Math.floor(Math.random() * 360))
      matching NewSessionDialog L320 — never-touched roles vary in hue"
    - "Raw File in multipart for avatar transport — for generated candidate:
      fetch(candidate.url).blob() → new File([blob], `${name}.${ext}`, {type: mime});
      for manual upload: File captured at input.change time in a
      manualFileRef so handleSubmit can pass it directly to createRole()"
    - "manualUrlRef + manualFileRef separation — the URL is for the
      <img> preview + must be revoked on cleanup; the File is for
      the multipart body. Kept in refs (not state) to avoid stale-closure
      inside handleSubmit"
key_files:
  created: []
  modified:
    - src/ui/sidebar/CreateRoleDialog.tsx (+425 / -13; cosmetic state,
      generate/upload handlers, resolveAvatarFile helper, JSX for four new
      controls, extended canOpen predicate, extended reset-on-close effect)
decisions:
  - "Avatar transport: raw File in multipart (LOCKED by D-CTX-86-surface-3
    and Plan 86-02's already-landed endpoint contract). The alternative
    candidateId-indirection variant would have required retroactively
    adjusting Plan 86-02, which is structurally impossible in this wave
    graph."
  - "Batch generator inlined into CreateRoleDialog (D-CTX-86-surface-3
    planner's discretion option b). Only one caller remains post-phase
    (NewSessionDialog's cosmetic strip goes in Plan 86-04), so a separate
    extracted component would add surface for a single caller. Extraction
    can happen later if a third caller emerges — same precedent used by
    Plan 86-02 for the SFTP avatar-write helper (documented in that
    plan's SUMMARY)."
  - "Placement of the new controls: BELOW Description, ABOVE Host picker
    (per plan step 7). Field order mirrors NewSessionDialog L1186-1366
    (Title → Voice → Color → Avatar) so the two dialogs feel consistent to
    a wearer who's used to authoring identity cosmetics."
  - "canOpen predicate extended to require titleValid && voiceValid &&
    avatarValid (pickedCandidateId !== null). colorHue is always non-null
    because we seed it randomly on open — no separate colorHue gate needed
    (D-CTX-86-empty-not-scenario satisfied without a user-visible 'pick a
    color' error state)."
  - "resolveAvatarFile() runs BEFORE the createRole call so a fetch failure
    on the generated-candidate path surfaces inline as submitError without
    leaving the role folder half-created on the server. The widened
    createRole client is only invoked once we hold a real File in hand."
  - "manualUrlRef + manualFileRef kept as SEPARATE refs. The URL is for
    the <img> preview and MUST be URL.revokeObjectURL'd on cleanup; the
    File is for the multipart body and does not need revocation. Coupling
    them into one ref would risk revoking the URL while still holding the
    File and letting a stale-preview render."
metrics:
  duration: "~30 minutes (start 2026-09-07 06:00 UTC, end 2026-09-07 06:30 UTC)"
  completed_date: 2026-09-07
  tasks_completed: 1
  tests_added: 0 (Plan 86-06 owns test-side updates per D-CTX-86-test-plan)
  tests_passing_in_touched_test_file: 3 / 10 (Tests 11, 12, 20 pass;
    Tests 13/14/15/16/17/19/22 fail as expected — see below)
  files_created: 0
  files_modified: 1
  commits: 1
---

# Phase 86 Plan 86-03: CreateRoleDialog cosmetic authoring wire-up

Wave-2 frontend delivery of D-CTX-86-surface-3. Grows CreateRoleDialog with
the four cosmetic authoring controls (Title, Voice, Color, Avatar) and
wires the submit handler to the multipart `createRole()` client widened in
Plan 86-01 Task 3, against the widened POST /roles endpoint shipped in Plan
86-02. End-to-end integration point for the two Wave-1 backend plans.

## Completed Tasks

| Task | Commit    | Name                                                                            |
| ---- | --------- | ------------------------------------------------------------------------------- |
| 1    | 83601483  | Add cosmetic authoring controls + avatar generator to CreateRoleDialog          |

## What Shipped

### Cosmetic state added (mirrors NewSessionDialog L317-337)

- `title` (string, default "")
- `voice` (string, default "")
- `colorHue` (number, default `Math.floor(Math.random() * 360)` — seeded
  randomly per open so never-touched roles vary in hue)
- `candidates` (`AvatarCandidate[]`, default `[]`)
- `pickedCandidateId` (`string | null`, default null)
- `manualPreviewUrl` (`string | null`, default null) — object URL for
  `<img>` preview
- `manualUrlRef` (`useRef<string | null>`) — tracks the object URL for
  cleanup on close/unmount (mirrors NewSessionDialog L337)
- `manualFileRef` (`useRef<File | null>`) — Phase 86 addition; holds the
  raw File captured at input.change time so `handleSubmit` can pass it
  directly to the multipart `createRole()` call without a candidateId
  indirection
- `genLoading`, `genError`, `uploadLoading`, `uploadError` (mirror
  NewSessionDialog L329-337)

### Reset-on-close effect extended

The existing `useEffect` at the pre-Phase-86 L148-161 was extended to:
- On open: seed `colorHue` randomly (`Math.floor(Math.random() * 360)`)
  in addition to the existing auto-select-single-host behavior
- On close: clear all Phase 86 cosmetic state (title, voice, candidates,
  pickedCandidateId, all avatar-loading/error slots, revoke + clear
  manualUrlRef, clear manualFileRef, clear manualPreviewUrl)

A second `useEffect` was added for unmount cleanup — revokes any dangling
object URL held by `manualUrlRef` if the component unmounts while a manual
preview is still active.

### `handleGenerate()` (inlined per D-CTX-86-surface-3)

Mirrors NewSessionDialog L654-676 with the D-CTX-86-surface-3 seed mapping:

```
postGenerateAvatarBatch({
  name,                    // role name (kebab-case)
  title,                   // role Title field
  brief: description,      // role Description doubles as brief per D-CTX-86-surface-3
  colorHue,                // role ColorPicker value
})
```

Mutual exclusion preserved: generating clears any manual upload state
(URL.revokeObjectURL + reset all manual refs/state). Regenerate clears
`pickedCandidateId` so the user must pick from the fresh set.

### `handleManualUpload(e)` (inlined per D-CTX-86-surface-3)

Mirrors NewSessionDialog L678-704. Mutual exclusion preserved: uploading
clears `candidates` and any `genError`. Additionally captures the raw
`File` object into `manualFileRef` at input.change time — this is the
Phase 86 delta vs the NewSessionDialog pattern (which uses candidateId
indirection because its birth stream orchestrates the actual upload
later; CreateRoleDialog does not have a birth stream, so it must ship
the File directly).

### `resolveAvatarFile()` helper

New helper that produces the `File` to pass into `createRole()`:

- Manual upload path: returns `manualFileRef.current` verbatim.
- Generated candidate path: `fetch(candidate.url)` → `.blob()` → wraps in
  `new File([blob], `${name}.${ext}`, {type: mime})`. Extension derived
  from `blob.type` via a `MIME_TO_EXT` map (webp/png/jpg), defaulting to
  `webp` (what the batch generator emits).

Runs BEFORE the `createRole` call so a fetch failure surfaces inline as
`submitError` without leaving the role folder half-created on the server.

### `handleSubmit()` extended

The Phase 22 `createRole({name, description, hostId: hostIdNum})` 3-key
call is replaced with the widened multipart call:

```
await createRole(
  { name, description, hostId: hostIdNum,
    cosmetics: { title, colorHue, voice } },
  avatarFile,
);
```

The 409 → `RoleAlreadyExistsError` branch, `onChainToCreateIdentity` +
`onCreated` + `onClose` sequence, and inline error rendering are all
preserved unchanged (Phase 84 regression guard).

### `canOpen` predicate extended

The Phase 84 predicate was `nameValid && descriptionValid && hostValid &&
!submitting`. Phase 86 adds three cosmetic gates:

```
const titleValid = title.trim().length > 0;
const voiceValid = voice.length > 0;
const avatarValid = pickedCandidateId !== null;
// canOpen extended:
const canOpen =
  nameValid && descriptionValid && hostValid &&
  titleValid && voiceValid && avatarValid &&
  !submitting;
```

No separate `colorHue` gate: colorHue is always non-null because we seed
it randomly on open. This satisfies D-CTX-86-empty-not-scenario without
introducing a user-visible "pick a color" error state.

### New JSX blocks (inserted between Description and Host picker)

Layout order matches NewSessionDialog L1186-1366:

1. **Title input** (id `create-role-title`, aria-label `Title`,
   placeholder `e.g. Box Maintainer`) — new lines 568-583
2. **Voice picker** (id `create-role-voice`, aria-label `Voice`) —
   new lines 585-599
3. **Color picker** (id `create-role-color`) — new lines 601-615
4. **Avatar section** (Generate/Regenerate button + Upload button +
   3-candidate horizontal carousel + manual preview + inline error
   strips for generate + upload) — new lines 617-720

The Phase 84 host picker + submit-error + DialogFooter blocks follow
verbatim after the new avatar section (lines 722+).

### Phase 84 additions preserved (regression guards)

Verified per plan `<action>` step 10:

- Header blurb "A role is what an agent does and how it thinks…" at
  DialogDescription (line 515) — UNCHANGED
- Required-caption absence — no `<DialogDescription>` mentioning
  "required" — UNCHANGED
- Host picker suppression when `flatHosts.length === 1` (line 724+) —
  UNCHANGED
- Modal title conforms to "New role" via
  `t("nav.createRoleTitle", { defaultValue: "New role" })` — UNCHANGED
- `onChainToCreateIdentity` invoked UNCONDITIONALLY on success —
  UNCHANGED

Six `Phase 84` comment blocks preserved (verified via `grep -c "Phase 84"`
returning 6, meeting the plan's ≥5 acceptance criterion).

## Avatar-file-transport path chosen (with rationale)

**Raw File in multipart** — LOCKED by both D-CTX-86-surface-3 and Plan
86-02's already-landed endpoint contract. For a generated candidate we
fetch bytes and re-package as a `File`; for a manual upload we hold onto
the raw `File` in a ref. The `File` is then passed to
`createRole(input, avatarFile)`.

The alternative candidateId-indirection variant (as used by
NewSessionDialog for its identity birth stream) was explicitly excluded
by the plan text — that variant would have required retroactively
adjusting Plan 86-02's endpoint contract (which is already committed to
`data` JSON field + `avatar` file part in the multipart body). Since
Plan 86-02 landed first in Wave 1, the raw-File shape is not just the
locked choice but the only structurally-available one.

## Exact placement of new controls (line ranges post-edit)

- Title input: lines 568-583
- Voice picker: lines 585-599
- Color picker: lines 601-615
- Avatar section (Generate/Upload buttons + candidate carousel + manual
  preview + inline error strips): lines 617-720
- Host picker section (Phase 84 pre-existing, unchanged): lines 722+
- Submit-error inline block (Phase 84 pre-existing, unchanged): lines
  end-of-fields
- DialogFooter (Cancel + Create, canOpen-gated): unchanged

The insertion sits below Description (which ends around line 552) and
above the `{flatHosts.length !== 1 && ( ... )}` Host picker block.

## Phase 84 test assertions that will break under this plan

Per the plan `<output>` item 3, listed here for Plan 86-06 to consume.
Scoped test run against `src/ui/sidebar/CreateRoleDialog.test.tsx`:

**Passing (3/10):**
- Test 11 — renders header blurb + no required-caption (Phase 84 regression
  guards; unaffected by Phase 86 gates because it only asserts UI presence)
- Test 12 — name validation kebab-case gate
- Test 20 — modal state reset on close

**Failing (7/10):**
All 7 failures share ONE root cause: the tests set only Phase-84-era
required fields (name + description + host click) and then assert
`Create` becomes enabled. Phase 86 extends `canOpen` to also require
title + voice + a picked avatar, so `Create` stays disabled and the
subsequent `fireEvent.click(createBtn)` no-ops. Plan 86-06 must extend
each test's setup to also set title (`create-role-title` input), voice
(`create-role-voice` select), and generate/pick an avatar (mock
`postGenerateAvatarBatch` + click a candidate button).

| Test | Assertion that regresses                                    | Plan 86-06 fix                                            |
| ---- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 13   | Description empty → Create disabled                          | Fill title/voice/avatar first; assert same disabled state |
| 14   | No host picked → Create disabled                             | Fill title/voice/avatar first; assert same disabled state |
| 15   | Auto-select single host → Create enabled once name+desc set  | Fill title/voice/avatar too before asserting              |
| 16   | On submit, createRole called with `{name, description, hostId}` | Update assertion to widened call `{..., cosmetics}` + File arg; setup must set cosmetics |
| 17   | onChainToCreateIdentity invoked on successful submit         | Setup must set cosmetics so submit fires                  |
| 19   | 409 conflict → inline error rendered                         | Setup must set cosmetics so submit fires and hits 409     |
| 22   | Single-host tree → Create enable-able w/o host click         | Fill title/voice/avatar too before asserting              |

Additional Phase 86 tests Plan 86-06 should add (from the plan's
`<behavior>` Test 1-12 spec):
- Test 1: Title input renders with `id=create-role-title`
- Test 2: ColorPicker renders with random initial hue on open
- Test 3: VoicePicker renders with empty initial value + `id=create-role-voice`
- Test 4: Generate button disabled until name+title+description are all set
- Test 5: Generate calls `postGenerateAvatarBatch` with brief=description
- Test 6: 3 candidate images render; clicking one sets pickedCandidateId
- Test 7: Manual upload sets preview AND pickedCandidateId; clears carousel
- Test 8: Create disabled until name+desc+host+title+voice+avatar all set
- Test 9: Successful submit calls widened createRole with cosmetics + File
- Test 10: onChainToCreateIdentity + onCreated invoked; state resets on next open
- Test 11: Failed generate surfaces error inline; dialog stays open
- Test 12: Phase 84 regressions preserved

## Deviation from D-CTX-86-empty-not-scenario: NONE

The `canOpen` gate implementation matches D-CTX-86-empty-not-scenario
verbatim ("Rolls can't have empty cosmetics with the flows that we have
set up, so it's not an issue to solve").

Every cosmetic field is explicitly required by `canOpen`:
- `title` → `titleValid = title.trim().length > 0` (explicit gate)
- `voice` → `voiceValid = voice.length > 0` (explicit gate)
- `colorHue` → always non-null (random seed on open — implicit gate that
  can never fail; matches Ashley's note that "the flows that we have set
  up" prevent the empty case rather than surfacing a user-visible error)
- `avatar` → `avatarValid = pickedCandidateId !== null` (explicit gate;
  covers BOTH generated-then-picked and manual-upload paths since the
  upload handler also sets `pickedCandidateId`)

Submission is impossible via the `Create` button when any cosmetic is
absent — the button is `disabled` and click no-ops. The `handleSubmit`
function also re-checks `canOpen` as a defensive guard.

## Acceptance criteria — all 8 met

| Criterion                                                                                              | Actual                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------- |
| `grep -n "import.*ColorPicker.*pickers/ColorPicker" src/ui/sidebar/CreateRoleDialog.tsx` = 1           | 1 match (line 86)         |
| `grep -n "import.*VoicePicker.*pickers/VoicePicker" src/ui/sidebar/CreateRoleDialog.tsx` = 1           | 1 match (line 85)         |
| `grep -n "postGenerateAvatarBatch\|postManualAvatarCandidate" src/ui/sidebar/CreateRoleDialog.tsx` ≥ 2 | 4 matches (2 imports + 2 call sites) |
| `grep -n "brief:.*description\|brief: description" src/ui/sidebar/CreateRoleDialog.tsx` ≥ 1            | 1 match (line 326)        |
| `grep -n "cosmetics:" src/ui/sidebar/CreateRoleDialog.tsx` ≥ 1                                         | 1 match (line 417)        |
| `grep -n "id=\"create-role-title\"\|id=\"create-role-voice\"\|id=\"create-role-color\""` = 3           | 3 matches (lines 576, 597, 614) |
| `grep -c "Phase 84" src/ui/sidebar/CreateRoleDialog.tsx` ≥ 5                                           | 6 matches                 |
| `grep -n "A role is what an agent does" src/ui/sidebar/CreateRoleDialog.tsx` = 1                       | 1 match (line 515)        |
| `npx tsc -p tsconfig.json --noEmit 2>&1 \| grep -E "CreateRoleDialog\.tsx" \| wc -l` = 0               | 0 (typecheck clean)       |

## Verification command

```
npx tsc -p tsconfig.json --noEmit
```

Result: **exit 0, empty output** — no TypeScript errors anywhere in the
codebase. The widened `createRole` client from Plan 86-01 is called with
the full 4-key input shape (`{name, description, hostId, cosmetics}`) +
the optional File; no cascading type errors in any other consumer.

## Known Stubs

None. Every wired path now flows end-to-end:

- Cosmetic input state → `createRole()` multipart body → POST /roles
  handler → role frontmatter YAML block (via Plan 86-02) → sibling avatar
  file at `~/.claude/roles/<name>/<name>.<ext>` (via Plan 86-02)
- On subsequent GET /identities, the backend reader (Plan 86-01) reads
  the role frontmatter, merges it under identity frontmatter per the
  `identity ?? role ?? null` rule, and surfaces the resolved values +
  `roleDefaults` field to the frontend

## Self-Check: PASSED

- File `src/ui/sidebar/CreateRoleDialog.tsx` — FOUND (modified, +425 / -13)
- Commit `83601483` — FOUND (Task 1 in git log)
- `npx tsc -p tsconfig.json --noEmit` exit 0 — FOUND (typecheck clean,
  no CreateRoleDialog errors, no cascading errors elsewhere)
- All 8 acceptance-criteria greps pass — FOUND (documented above)
- Phase 84 regression-guard content preserved (blurb + no required-caption
  + single-host suppression + title conform + unconditional chain) —
  FOUND (verified via targeted greps + line-range inspection)
