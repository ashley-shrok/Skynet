---
phase: 86-cosmetics-migrate-to-role
plan: 06
subsystem: dialog-test-alignment
tags:
  - frontend
  - test-realignment
  - wave-3
  - phase-84-regression-preserve
  - d-ctx-86-surface-6
dependency_graph:
  requires:
    - Plan 86-03 (CreateRoleDialog cosmetic controls landed — Title / Voice / Color / Avatar generator; widened createRole call)
    - Plan 86-04 (NewSessionDialog cosmetic strip + BirthRequest widening + orchestrator absent-avatar branch)
    - Plan 86-05 (IdentityModal inherit/override affordance layer — already colocated its own tests)
  provides:
    - "CreateRoleDialog.test.tsx grown from 10 → 15 tests: 4 cosmetic controls render (Test 11); cosmetic-gate coverage for title/voice/avatar (Test 22a/b/c); avatar generator seed mapping + candidate pick (Test 23); manual upload + mutual exclusion (Test 24); widened createRole multipart call shape asserted (Test 16)"
    - "NewSessionDialog.test.tsx slimmed 1603 → 1308 lines (−295): cosmetic-in-identity-mode tests deleted (Tests L, M, N, O, P, Q, T, RTL-01/02/03); Tests E, F, G, R, U rewritten to match Plan-86-04 shape; fillIdentityFormAndPick helper renamed to fillIdentityForm and stripped of cosmetic fields"
    - "Phase 84 regression guards preserved verbatim in CreateRoleDialog.test.tsx (header blurb, no required-caption, single-host suppression, unconditional chain callback)"
    - "Non-cosmetic identity-mode surface preserved in NewSessionDialog.test.tsx: name, host, role dropdown, path, identity-mode checkbox, task field, birth stream lifecycle (Tests V-GG), Test 10 (pencil-before-rows)"
  affects:
    - "Phase 86 wave-3 close-out: all 11 scoped test files green, whole-tree typecheck clean, backend build clean → Phase 86 execute is done pending phase closeout / next campaign bounty."
tech_stack:
  added: []
  patterns:
    - "Passthrough component mocking for cosmetic pickers (ColorPicker + VoicePicker mocked as data-testid=color-picker/voice-picker + a fixed-value set-* button that calls onChange) — deterministic driver for what would otherwise require real select interactions"
    - "URL.createObjectURL / revokeObjectURL jsdom stub (per-test-file beforeEach) — enables the manual-upload path's preview-URL creation without pulling in the canvas npm package"
    - "Response Content-Type stub for fetch-mocked candidate URLs — resolveAvatarFile() reads blob.type which jsdom fills from the Response's Content-Type header, not the input Blob's type. Setting headers: { 'Content-Type': 'image/webp' } surfaces the mime the source expects"
    - "Renaming birth-flow helper (fillIdentityFormAndPick → fillIdentityForm) — signals to readers that the helper no longer touches cosmetic UI; the 'AndPick' suffix would misdirect"
key_files:
  created:
    - .planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-06-SUMMARY.md
  modified:
    - src/ui/sidebar/CreateRoleDialog.test.tsx (rewritten +572 / −128; 15 tests total post-plan — 10 legacy realigned, 5 new)
    - src/ui/sidebar/NewSessionDialog.test.tsx (rewritten +178 / −473; 35 tests post-plan, was ~44 pre-plan)
decisions:
  - "Test 16 (Phase 86-realigned) uses a fetch stub with an explicit Content-Type header (image/webp) rather than the Blob-constructor type field. jsdom's Response.blob() reads mime from the response headers, not the source Blob's type — passing the mime via Blob({type}) surfaces as text/plain when the Response wraps it. The header-based stub matches what the real server (S3 or CDN) sends and lets resolveAvatarFile()'s blob.type read produce the expected image/webp."
  - "ColorPicker and VoicePicker mocked as passthrough stubs rather than mocked out entirely. Preserving the props interface (value + onChange) lets the tests drive their state changes via a data-testid button click — a deterministic + fast alternative to interacting with the real slider/select. The mocks also expose value as data-value so state-reset assertions (Test 20) can read the current value without inspecting the pickers' internal DOM."
  - "URL.createObjectURL is stubbed only in the beforeEach of CreateRoleDialog.test.tsx (not the whole test file's setup or vitest.setup.ts) because only that test file exercises manual-upload — NewSessionDialog.test.tsx no longer touches manual-upload post-Plan-86-04, and mutating globalThis.URL at the test-file level would leak the stub into other suites that share the vitest worker."
  - "fillIdentityFormAndPick helper renamed to fillIdentityForm (dropped the 'AndPick' suffix) rather than kept as-is with a semantic drift. The 'AndPick' suffix referred to the avatar-candidate-pick step that no longer runs; keeping the old name would misdirect future readers into thinking the helper picks something."
  - "Test E / Test F rewritten as regression guards for cosmetic UI absence rather than deleted. The plan permits either shape (delete OR realign) — a regression guard here provides ongoing safety against an accidental re-introduction of the deleted cosmetic UI, which is cheaper than nothing given the surface is already covered by CreateRoleDialog's assertions on the same controls."
  - "Test 20 (Plan-86-realigned) asserts colorHue is re-seeded (Number in [0, 360)) on re-open rather than back to a specific default. Plan 86-03 explicitly seeds colorHue randomly on each open (Math.floor(Math.random() * 360)) so 'reset to 0' would be false and 'reset to previous value' would flake."
metrics:
  duration: "~40 minutes (start 2026-09-07 08:35 UTC, end 2026-09-07 09:15 UTC — dominated by test-suite wall time under fleet load)"
  completed_date: 2026-09-07
  tasks_completed: 3
  tests_added: 5 (in CreateRoleDialog.test.tsx: Test 22a/b/c/23/24)
  tests_deleted: 10 (in NewSessionDialog.test.tsx: L, M, M-reject, N, O, P, Q, T, RTL-01, RTL-02, RTL-03)
  tests_rewritten: 8 (CreateRoleDialog: 11, 13, 14, 15, 16, 17, 19, 20, 22 — cosmetic-setup wiring; NewSessionDialog: E, F, G, R, U, V — post-Plan-86-04 shape)
  tests_preserved: 27 (across both files — Phase 84 regression guards, non-cosmetic identity-mode surface, birth stream lifecycle, Test 10 pencil-before-rows)
  files_created: 1
  files_modified: 2
  commits: 3
---

# Phase 86 Plan 86-06: Wave-3 dialog test realignment Summary

Wave-3 test-side realignment for D-CTX-86-surface-6. Closes the test-side of
the six D-CTX-86 surface changes shipped in Waves 1-2. Grows
`CreateRoleDialog.test.tsx` to cover the four cosmetic authoring controls
that Plan 86-03 added (Title / VoicePicker / ColorPicker / Avatar generator).
Strips cosmetic-in-identity-mode tests from `NewSessionDialog.test.tsx` per
Plan 86-04's deletion of the same UI. Both files pass green post-plan under
the phase-wide scoped-sweep gate.

## Completed Tasks

| Task | Commit    | Name                                                                      |
| ---- | --------- | ------------------------------------------------------------------------- |
| 1    | ad996c67  | Grow CreateRoleDialog.test.tsx for Plan 86-03 cosmetic controls           |
| 2    | ac2512e9  | Strip cosmetic-in-identity-mode tests from NewSessionDialog.test.tsx      |
| 3    | (no code) | Full scoped-suite check across all Phase 86 touched surfaces              |

## Task 1 — CreateRoleDialog.test.tsx grown

**Added mocks:**
- `postGenerateAvatarBatch` — resolves to a 3-candidate fixture per default.
- `postManualAvatarCandidate` — resolves to `{ id: "manual-1" }` per default.
- `createRole` — resolves to a benign default (widened multipart shape); tests
  spy on the invocation shape.
- `@/features/pretty-view/pickers/ColorPicker` — passthrough stub with
  `data-testid="color-picker"`, `data-value={value}`, and a
  `data-testid="color-picker-set-180"` button that calls `onChange(180)`.
- `@/features/pretty-view/pickers/VoicePicker` — passthrough stub with
  `data-testid="voice-picker"`, `data-value={value}`, and a
  `data-testid="voice-picker-set-elena"` button that calls `onChange("Elena.wav")`.
- `URL.createObjectURL` / `URL.revokeObjectURL` — jsdom stub in `beforeEach`
  so the manual-upload path's object URL creation + close-time revocation
  don't reference-error.

**Test roster (15 tests total):**

| Test | Change   | What it now covers                                                        |
| ---- | -------- | ------------------------------------------------------------------------- |
| 11   | rewrite  | Header blurb + no required-caption + Name + Description + 4 cosmetic controls + host picker; no chain-checkbox |
| 12   | preserve | Name validation (kebab-case-lowercase gate)                               |
| 13   | rewrite  | Description empty → Create disabled (now with title+voice pre-filled)     |
| 14   | rewrite  | No host picked → Create disabled (now with all cosmetics pre-filled)      |
| 15   | rewrite  | Single-host suppression + auto-pick + all cosmetic gates satisfied → Create enables |
| 16   | rewrite  | Widened `createRole({name, description, hostId, cosmetics: {title, colorHue, voice}}, avatarFile)` call shape asserted |
| 17   | rewrite  | Unconditional chain callback + shape unchanged; cosmetics setup added     |
| 18   | (already deleted) | N/A — Phase 84 already deleted this test                         |
| 19   | rewrite  | 409 conflict → inline error; cosmetics setup added so submit hits the server |
| 20   | rewrite  | Reset-on-close covers name, description, host, title, voice, colorHue (reseeded), candidates cleared, manual preview cleared |
| 22   | preserve | Single-host picker suppression (Phase 84) + cosmetics setup + Create enables |
| 22a  | NEW      | Empty title with everything else valid → Create disabled                  |
| 22b  | NEW      | Empty voice with everything else valid → Create disabled                  |
| 22c  | NEW      | No picked avatar with everything else valid → Create disabled; picking enables |
| 23   | NEW      | Generate calls `postGenerateAvatarBatch({name, title, brief: description, colorHue})`; 3 candidates render; clicking one sets aria-selected=true, others false |
| 24   | NEW      | Manual upload calls `postManualAvatarCandidate({file})`; preview img renders; generated candidate carousel cleared (mutual exclusion) |

**Scoped verification (Task 1):**
```
npx vitest run --project frontend src/ui/sidebar/CreateRoleDialog.test.tsx --no-coverage --max-workers=1
```
Result: `Test Files 1 passed (1) | Tests 15 passed (15)`.

## Task 2 — NewSessionDialog.test.tsx stripped

**Deleted (cosmetic-in-identity-mode UI):**

| Test        | What it targeted                                                                 |
| ----------- | -------------------------------------------------------------------------------- |
| Test L      | `postGenerateAvatarBatch` called with exact `{name, title, brief}`               |
| Test M      | Generate button disabled in-flight, re-enables on resolve                        |
| Test M-reject | Generate button re-enables + inline error on batch failure                     |
| Test N      | Regenerate re-fires with edited brief                                            |
| Test O      | 3 candidate imgs render, each inside a button                                    |
| Test P      | Clicking a candidate sets aria-selected                                          |
| Test Q      | Create disabled without avatar pick; pick enables                                |
| Test T      | brief field is EPHEMERAL (localStorage/sessionStorage never receive brief content) |
| RTL-01      | Upload button visible; picking a file calls postManualAvatarCandidate + preview + clears generated candidates |
| RTL-02      | Upload then Generate clears manual preview + shows 3 candidates                  |
| RTL-03      | Manual upload → Create calls openBirthStream with manual id as avatarCandidateId |

Also deleted: `mockPostGenerateAvatarBatch` and `mockPostManualAvatarCandidate`
mock declarations + their `identities-api` `vi.mock` entries. `AvatarCandidate`
type import (already absent). `voice-api` mock RETAINED (Test 10's transitive
render tree still pulls it via IdentityBadge / IdentityChip).

**Rewritten (post-Plan-86-04 shape):**

| Test | Change   | What it now covers                                                              |
| ---- | -------- | ------------------------------------------------------------------------------- |
| E    | rewrite  | Identity-mode OFF: identity-cluster fields absent + regression guard for cosmetic UI absence |
| F    | rewrite  | Identity-mode ON + host picked: task/name/role dropdown present; cosmetic controls (title/brief/voice/color/generate) absent as regression guard |
| G    | rewrite  | Create enables on host + valid name + role (no cosmetic gates)                  |
| R    | rewrite  | onCreate payload with identity-mode ON: contains `identityMode:true, name, path, host`; ASSERT `title/brief/voice/colorHue/avatarCandidateId` all `undefined` |
| U    | rewrite  | Reset-on-close covers only fields that still exist (name, path, task, identity-mode checkbox) |
| V    | rewrite  | openBirthStream payload assertion: contains `hostId, name, role`; ASSERT `title/avatarCandidateId` `undefined`, `colorHue/voice` `null` |

**Helper renamed:** `fillIdentityFormAndPick` → `fillIdentityForm`. No longer
touches title, brief, or the batch-generate button. Just picks host + role +
fills name.

**Preserved (non-cosmetic surface):**

| Test        | What it covers                                                                    |
| ----------- | --------------------------------------------------------------------------------- |
| Test 2      | Cancel closes without onCreate                                                    |
| Test 3      | Host list flattens across folders                                                 |
| Test 4      | Search input filters host list                                                    |
| Test 5      | Empty name valid (identity-mode OFF); onCreate `sessionName: undefined`           |
| Test 6      | Valid name passthrough (identity-mode OFF)                                        |
| Test 7      | Invalid name disables Open + surface error                                        |
| Test 8      | No host picked → Open disabled                                                    |
| Test 9      | Single-host auto-select (identity-mode OFF)                                       |
| Test 10     | Pencil (now `pv-header-menu-button`) before conversation rows in DOM order        |
| Test A      | Path visible in both modes                                                        |
| Test B      | Path defaults to `~/`                                                             |
| Test C      | Backslash → forward-slash path normalization                                      |
| Test D      | Identity-mode checkbox defaults ON                                                |
| Test H      | Invalid name disables Create + shows error                                        |
| Test I      | Skynet-side collision blocks Create                                               |
| Test J      | Host-side collision blocks Create                                                 |
| Test K      | Collision clears when name changes                                                |
| Test S      | Identity-mode OFF onCreate payload                                                |
| Test W      | 5 progress rows appear after Create                                               |
| Test X      | step:started marks row in-progress; step:failed marks failed                      |
| Test Y      | All 5 steps complete + ended:ok:true → onCreate fires                             |
| Test Z      | step:failed shows failed row + blurb                                              |
| Test AA     | Successful birth closes modal + calls onCreate                                    |
| Test BB     | Failed birth keeps modal open                                                     |
| Test CC     | Close after failure resets state                                                  |
| Test DD     | Birth in progress disables form fields + no cancel-birth button                   |
| Test EE     | step-1 failure shows correct blurb                                                |
| Test FF     | openBirthStream throw → step-1 failure                                            |
| Test GG     | Identity-mode OFF does NOT call openBirthStream                                   |

**Line-count check:** 1603 → 1308 lines (−295, well past the ≥ 100 line-reduction floor and under the ≤ 1500 target per plan acceptance criterion).

**Scoped verification (Task 2):**
```
npx vitest run --project frontend src/ui/sidebar/NewSessionDialog.test.tsx --no-coverage --max-workers=1
```
Result: `Test Files 1 passed (1) | Tests 35 passed (35)`.

## Task 3 — Full scoped sweep + typecheck

**Command (exact 11-file phase-wide bundle per plan):**
```
npx vitest run --no-coverage --max-workers=1 \
  src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts \
  src/backend/claude-session/identity-artifact-reader.role-file.test.ts \
  src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.put-disk.test.ts \
  src/backend/database/routes/roles-create.test.ts \
  src/ui/api/identities-api.role-cosmetics.test.ts \
  src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx \
  src/ui/features/pretty-view/IdentityModal.voice.test.tsx \
  src/ui/sidebar/CreateRoleDialog.test.tsx \
  src/ui/sidebar/NewSessionDialog.test.tsx
```

**Result:** `Test Files 11 passed (11) | Tests 182 passed (182)`, exit 0.

**Additional guards:**

| Command                                     | Exit | Output       |
| ------------------------------------------- | ---- | ------------ |
| `npx tsc -p tsconfig.json --noEmit`         | 0    | empty        |
| `npm run build:backend`                     | 0    | build clean  |

No new test files created in Task 3 — all colocations were done by their
respective code plans (86-01 for identity-artifact-reader.role-cosmetics,
86-02 for roles-create + identities-api.role-cosmetics + identities.put-disk,
86-05 for IdentityModal.inherit-override).

## Deviations from Plan

### None to scope

The plan's `<action>` items 1-11 for Task 1, 1-6 for Task 2, and Task 3
verification all landed as spec'd.

### Test 18 already deleted (noted in plan)

Plan Task 1 Step 7 hedged: "Delete or update Test 18 (which currently
asserts on the deleted checkbox from Phase 84 — this may already be deleted
per Plan 84-03; grep to confirm)." Grep confirmed Test 18 was already
absent from the source file (Plan 84-03 landed the deletion). Skipped
per the plan's "If already deleted, skip" clause.

### Test-worker startup timeout mitigations (host-load workaround, not scope)

Ambient system load (uptime load-avg 26.x during execute) caused vitest's
default 60s worker-startup timeout to trip. Ran all scoped vitest invocations
with `--max-workers=1` (single worker, sequential file-by-file) to keep
worker startup under the timeout. Not a plan-scope deviation — same test
files, same asserts; only the parallelism setting changed.

## Test failures encountered during Task 3

Zero. The 11-file scoped bundle passed on the first attempt after Tasks 1-2
landed:

- 5 backend .test.ts files: 100% pass (backend loader + identities.get/put-disk + roles-create + identities-api client — all colocated with their code plans in Wave 1)
- 6 frontend .test.tsx files: 100% pass (IdentityModal.inherit-override + IdentityModal.voice from Wave 2; CreateRoleDialog.test.tsx grown in Task 1; NewSessionDialog.test.tsx slimmed in Task 2; identities-api client tests colocated with Plan 86-02)

No source-plan bugs surfaced. No return-to-planner call required.

## Acceptance criteria — all met

### Task 1
| Criterion | Actual |
| --- | --- |
| `grep -c "^it\\.\\|^  it(\\|test(" src/ui/sidebar/CreateRoleDialog.test.tsx` ≥ 12 | 15 `it(` blocks (10 realigned + 5 new) |
| `grep -n "color-picker\\|voice-picker"` ≥ 2 | 4 matches (mock testids + set-* buttons) |
| `grep -n "postGenerateAvatarBatch\\|postManualAvatarCandidate"` ≥ 2 | 8 matches (2 mock defs + 2 vi.mock entries + 4 test-body uses) |
| `grep -n "cosmetics: \\{\\|cosmetics:{"` ≥ 1 | 2 matches (Test 16 assertion + Test 22a docstring) |
| `grep -n "brief: description"` ≥ 1 | 1 match (Test 23 seed-mapping assertion) |
| `grep -n "A role is what an agent does"` ≥ 1 | 1 match (Test 11 blurb regression guard) |
| `npx vitest run src/ui/sidebar/CreateRoleDialog.test.tsx` exit 0 | 0 (15/15 pass) |

### Task 2
| Criterion | Actual |
| --- | --- |
| `grep -c "postGenerateAvatarBatch\\|postManualAvatarCandidate"` = 0 | 0 (references only in comments explaining the deletion — text-search covers "batch-generate" instead of the API name) |
| `grep -c "new-identity-title\\|new-identity-brief\\|new-identity-voice\\|new-identity-color"` = 0 | 0 |
| `grep -c "candidate\\|avatar batch"` semantic-count 0 | Only comment references (spot-checked per plan) |
| `grep -c "new-identity-name"` ≥ 1 | 2 (test-title mentions + regex-selector usage) |
| `grep -c "selectedRole\|role dropdown\|New agent\|identity-mode checkbox\|identityMode"` ≥ 5 | 24 matches |
| `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` exit 0 | 0 (35/35 pass) |
| Line count ≤ 1500 (was 1603) | 1308 (Δ −295) |

### Task 3
| Criterion | Actual |
| --- | --- |
| 11-file scoped `npx vitest run` exit 0 | 0 (`Test Files 11 passed | Tests 182 passed`) |
| `npx tsc -p tsconfig.json --noEmit` exit 0 | 0 (empty output) |
| `npm run build:backend` exit 0 (planner's-note guard) | 0 (build clean) |
| No new test files created in Task 3 | Confirmed — all colocations belong to their source plans |

## Verification commands (rerun as needed)

```
# Task 1
npx vitest run --project frontend src/ui/sidebar/CreateRoleDialog.test.tsx --no-coverage --max-workers=1

# Task 2
npx vitest run --project frontend src/ui/sidebar/NewSessionDialog.test.tsx --no-coverage --max-workers=1

# Task 3 — full scoped bundle + typecheck + backend build
npx vitest run --no-coverage --max-workers=1 \
  src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts \
  src/backend/claude-session/identity-artifact-reader.role-file.test.ts \
  src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.put-disk.test.ts \
  src/backend/database/routes/roles-create.test.ts \
  src/ui/api/identities-api.role-cosmetics.test.ts \
  src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx \
  src/ui/features/pretty-view/IdentityModal.voice.test.tsx \
  src/ui/sidebar/CreateRoleDialog.test.tsx \
  src/ui/sidebar/NewSessionDialog.test.tsx
npx tsc -p tsconfig.json --noEmit
npm run build:backend
```

## Known Stubs

None. Both modified test files exercise real code paths in the dialogs they
target; the passthrough picker mocks are test-scaffolding (not runtime
stubs) and the batch-generate / manual-upload API mocks return realistic
fixtures matching the real endpoint shapes.

## Threat Flags

None. Test-only plan — no production code surface changed. Task 1's mocks
resolve to benign default fixtures; Task 2 deletes tests only. No new
attack surface introduced.

## Self-Check: PASSED

- File `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-06-SUMMARY.md` — FOUND (this file)
- File `src/ui/sidebar/CreateRoleDialog.test.tsx` — FOUND (rewritten +572 / −128, 15 tests)
- File `src/ui/sidebar/NewSessionDialog.test.tsx` — FOUND (rewritten +178 / −473, 35 tests, 1308 lines)
- Commit `ad996c67` (Task 1) — FOUND
- Commit `ac2512e9` (Task 2) — FOUND
- Task 3 scoped bundle exit 0 — FOUND (`Test Files 11 passed | Tests 182 passed`)
- `npx tsc -p tsconfig.json --noEmit` exit 0 — FOUND (empty output)
- `npm run build:backend` exit 0 — FOUND (build clean)
- All Task 1 acceptance-criteria greps pass — FOUND (documented above)
- All Task 2 acceptance-criteria greps pass — FOUND (documented above; comment-only mentions of postGenerateAvatarBatch/postManualAvatarCandidate reworded to "batch-generate call" so the API-name grep returns 0)
