---
phase: 86-cosmetics-migrate-to-role
plan: 04
subsystem: new-session-dialog + identity-birth-route + identity-birth-orchestrator + identities-api
tags:
  - frontend
  - backend
  - cosmetics-inheritance
  - identity-birth
  - absent-⇒-omit
dependency_graph:
  requires:
    - Plan 86-01 (Identity.roleDefaults type + publicIdentity role merge + GET /:key/avatar role-folder fallback landed in Wave 1)
  provides:
    - "NewSessionDialog identity-mode branch stripped of cosmetic UI (no title / brief / voice / colorHue / avatar generator+upload)"
    - "NewSessionOnCreateOpts identityMode:true variant narrowed — five cosmetic fields removed"
    - "BirthRequest type widened: title? + avatarCandidateId? optional"
    - "POST /identities/birth accepts absent title + absent avatarCandidateId (bodies with only hostId/name/path/role/task succeed)"
    - "identity-birth-orchestrator handles empty avatarCandidateId: skip Step 1 candidate lookup, skip Step 2.5 sibling-file write, omit `avatar:` frontmatter key"
    - "buildIdentityFileBody absent-⇒-omit invariant extended to the avatar frontmatter key"
  affects:
    - Plan 86-05 IdentityModal inherit-vs-override affordances (Wave 3 — receives identities born with empty cosmetic frontmatter and must render inherited-from-role affordances against roleDefaults from Plan 86-01)
    - Plan 86-06 NewSessionDialog test realignment (Wave 3 — stale cosmetic-UI test assertions expected to break; will be updated to match the stripped shape)
tech_stack:
  added: []
  patterns:
    - "Absent-⇒-omit YAML frontmatter emission (buildIdentityFileBody now omits avatar: key when avatarFilename is empty — matches existing title / voice / task pattern)"
    - "Empty-string sentinel between HTTP route parser and orchestrator (route's parsedAvatarCandidateId='' signals orchestrator to take the role-inherit branch)"
    - "Strictly-narrowing discriminated union variant (NewSessionOnCreateOpts identityMode:true — safe because preflight verified no consumer destructures the removed fields)"
key_files:
  created:
    - .planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-04-SUMMARY.md
  modified:
    - src/ui/sidebar/NewSessionDialog.tsx (1416 → 1158 lines; −258)
    - src/ui/api/identities-api.ts (BirthRequest widening only)
    - src/backend/database/routes/identity-birth.ts (required gates deleted; empty-string fallback threading; finally-block consume guard)
    - src/backend/database/routes/identity-birth-orchestrator.ts (Step 1 candidate-lookup guard; Step 2.5 sibling-write skip; buildIdentityFileBody avatar-emission gate)
    - src/backend/database/routes/identity-birth.test.ts (+5 Phase 86 tests)
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts (+3 Phase 86 tests)
    - .planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-04-PLAN.md (files_modified extended to include orchestrator per orchestrator-approved Option A resolution)
decisions:
  - "Option A resolution of Task 1 Step 4(iv) STOP-and-surface: extended files_modified to include src/backend/database/routes/identity-birth-orchestrator.ts. Rationale (per orchestrator's 2026-09-08 approval): (a) Option A matches D-CTX-86-inherit's LOCKED promise 'identity born with empty cosmetics inheriting from role'; Option B would break that promise. (b) Orchestrator edits are strictly additive — existing candidate-present path is untouched, empty-candidate path is a new branch. (c) identity-birth-orchestrator.ts does not overlap with any other Wave 1/Wave 2 plan's files_modified (86-01/86-02/86-03/86-05 don't touch it). No file-ownership conflict. (d) The plan explicitly hedged with 'OR stop-and-report if the change surface extends' — surfacing was the right call, and Option A was orchestrator-authorized to extend."
  - "Empty-string sentinel (not null / undefined) for parsedAvatarCandidateId at the HTTP-route → orchestrator boundary. Rationale: orchestrator's opts.avatarCandidateId type stays `string` (no BirthOptions type change; keeps the interface stable across Phase 20/22/75/80 call sites that always pass a real candidate id), and `.length > 0` is a natural absent-check for a string field with a defined empty-⇒-inherit contract. Alternative was widening opts.avatarCandidateId to `string | null` — would have cascaded through every existing test and required updating unrelated Phase 80 tests. Empty string keeps the type surface minimal and the diff surgical."
  - "buildIdentityFileBody's avatar key promoted from always-emitted to absent-⇒-omit (matching title / voice / task pattern). Alternative was emitting `avatar: ''` (empty string) — would have poisoned Plan 86-01's publicIdentity merge (which uses `identity ?? role ?? null` — an empty string is truthy per JS coercion in `??`, so it would win over the role's value). Absent-⇒-omit is the only shape consistent with the merge semantics."
  - "initialBrief prop retained in NewSessionDialog signature (marked deprecated in JSDoc) rather than removed. Rationale: PrettyConversationsPanel.tsx L1956 still passes `initialBrief={chainPrefill?.description ?? null}`; removing the prop would require touching PrettyConversationsPanel, which is NOT in files_modified. Deprecating-in-place preserves the file-ownership graph and lets a future cleanup remove both sides atomically."
metrics:
  duration: ~85 minutes (start 2026-09-07 06:20 UTC checkpoint; end 2026-09-08 06:57 UTC after Option A approval + implementation + scoped tests + SUMMARY)
  completed_date: 2026-09-08
  tasks_completed: 1
  tests_added: 8 (5 route-layer + 3 orchestrator-layer)
  tests_passing: 155 (scoped sweep across identity-birth, identity-birth-orchestrator*, identities.get-disk, identities.put-disk, identities-api.role-cosmetics)
  files_created: 1
  files_modified: 7
---

# Phase 86 Plan 86-04: NewSessionDialog cosmetic-strip + identity-birth widening Summary

Wave-2 frontend + backend delivery of D-CTX-86-surface-4 + D-CTX-86-inherit.
Strips cosmetic authoring UI from `NewSessionDialog` (title / brief / voice /
colorHue / avatar generator+upload), widens the birth backend to accept
absent-cosmetics bodies, and teaches the birth orchestrator to skip its
identity-side avatar write when the request omits `avatarCandidateId`. Newly
born identities land with cosmetics-free frontmatter and inherit their role's
face on landing via Plan 86-01's publicIdentity merge + GET /:key/avatar
role-folder fallback.

## Completed Tasks

| Task | Commit    | Name                                                                                  |
| ---- | --------- | ------------------------------------------------------------------------------------- |
| 1    | 368eef11  | Strip cosmetic UI + widen birth backend + orchestrator absent-avatar branch + tests   |

## What Shipped

### Frontend — NewSessionDialog cosmetic strip

`src/ui/sidebar/NewSessionDialog.tsx` (1416 → 1158 lines, −258):

- **Deleted JSX** (identity-mode branch): Title input, Brief textarea,
  VoicePicker, ColorPicker, entire Avatar section (Generate button, Upload
  button, gen/upload error strips, candidate carousel, manual preview).
- **Deleted state**: `title`, `brief`, `voice`, `colorHue`, `candidates`,
  `pickedCandidateId`, `genLoading`, `genError`, `manualPreviewUrl`,
  `uploadLoading`, `uploadError`, `manualUrlRef`.
- **Deleted handlers**: `handleGenerate`, `handleManualUpload`.
- **Deleted imports**: `VoicePicker`, `ColorPicker`, `postGenerateAvatarBatch`,
  `postManualAvatarCandidate`, `AvatarCandidate`. `Loader2` retained (still
  used by the `BirthProgress` sub-component's in-progress step icon).
- **Narrowed** `NewSessionOnCreateOpts` `identityMode: true` variant — dropped
  `title`, `brief`, `avatarCandidateId`, `voice`, `colorHue`. Preflight
  verified no consumer destructures these fields (see "Downstream Consumers"
  below).
- **Updated `handleBirth`** to omit `title`, `colorHue` (sent as `null`),
  `voice` (sent as `null`), and `avatarCandidateId` from the
  `openBirthStream` call; `onCreate` callback also updated to the narrower
  shape.
- **Updated `canOpen` predicate**: dropped `title.trim().length > 0`,
  `brief.trim().length > 0`, `avatarReady` gates. Identity-mode still
  requires: `selectedHost !== null && nameValid && !skynetCollision &&
  !hostCollision && !collisionChecking && selectedRole !== ""`.
- **initialBrief prop deprecated-in-place**: signature preserved (still
  accepted from PrettyConversationsPanel.tsx L1956) but the value is now
  ignored — the brief textarea no longer exists.
- **Updated the file header comment** and inline comments to reflect the new
  shape and reference D-CTX-86-surface-4 + D-CTX-86-inherit + Plan 86-05
  (per-identity override affordances) + Plan 86-06 (test realignment).

### Frontend — BirthRequest type widening

`src/ui/api/identities-api.ts`:

- `BirthRequest.title` widened from `string` → `title?: string`.
- `BirthRequest.avatarCandidateId` widened from `string` → `avatarCandidateId?: string`.
- No other change (Plan 86-01 Task 3's `createRole` widening owns the rest of
  this file). The change is strictly widening — no existing caller breaks
  because passing a value still typechecks.

### Backend — identity-birth HTTP route

`src/backend/database/routes/identity-birth.ts`:

- **Deleted** the `title is required` 400 gate (was L116-119).
- **Deleted** the `avatarCandidateId is required` 400 gate (was L121-124).
- **Added** type-only guards: 400 on non-string / non-null title;
  400 on non-string / non-null avatarCandidateId. Client bugs still surface
  loudly (Test T-86-04-birth-d + T-86-04-birth-e cover both).
- **Added** `parsedTitle` + `parsedAvatarCandidateId` empty-string fallbacks
  threaded into the `birthIdentity(...)` invocation. The orchestrator's
  absent-⇒-omit branches handle the sentinels from there.
- **Guarded** the `finally`-block `consumeCandidateForBirth(userId, ...)`
  call on `parsedAvatarCandidateId` being non-empty. Role-inherited-avatar
  births never touch the candidate cache, so there is nothing to consume.

### Backend — identity-birth orchestrator (files_modified extended per Option A)

`src/backend/database/routes/identity-birth-orchestrator.ts`:

- **Step 1 (L987-1008)**: gated the `deps.getCandidateForBirth(...)` lookup
  on `opts.avatarCandidateId.length > 0`. Empty-string sentinel → skip the
  cache lookup entirely; `birthCandidate` stays `null`. The on-disk
  collision probe at L999-1007 remains unconditional (defense-in-depth
  against a re-birth of an existing folder).
- **Step 2.5 (L1072-1121)**: when `birthCandidate === null`, skip the avatar
  extension derivation, skip the sibling-file write, and pass an empty
  `avatarFilename` to `buildIdentityFileBody`. The role folder's avatar file
  at `~/.claude/roles/<role>/<file>` is served via Plan 86-01's
  `GET /:key/avatar` role-folder fallback branch.
- **buildIdentityFileBody (L404-412)**: promoted the `avatar` key from
  always-emitted to absent-⇒-omit — only push `["avatar", avatarFilename]`
  when `avatarFilename.length > 0`. Matches the existing pattern for
  title / voice / task. Critical for the Plan 86-01 publicIdentity merge:
  the merge uses `identity ?? role ?? null` semantics, so an empty-string
  avatar on the identity would poison the role's value (empty string is
  truthy per JS `??` coercion).

### Tests (scoped — no full-suite run per campaign constraint)

`src/backend/database/routes/identity-birth.test.ts` (+5 tests):

1. **T-86-04-birth-a**: body omitting title / avatarCandidateId / colorHue /
   voice → 200 SSE opens; orchestrator receives empty-string sentinels for
   title + avatarCandidateId; parsedColorHue = null; parsedVoice = null;
   required fields (hostId / name / role) still threaded through.
2. **T-86-04-birth-b**: body omitting avatarCandidateId →
   `consumeCandidateForBirth` NOT called (skip-on-empty regression guard).
3. **T-86-04-birth-c**: body includes avatarCandidateId →
   `consumeCandidateForBirth` IS called exactly once with the id (backward-
   compat regression guard for the explicit-avatar path).
4. **T-86-04-birth-d**: `title=42` (non-string, non-null) → 400 with
   `title must be a string or null`; orchestrator not called.
5. **T-86-04-birth-e**: `avatarCandidateId=42` → 400 with
   `avatarCandidateId must be a string or null`; orchestrator not called.

`src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts`
(+3 tests):

1. **T-86-04-orch-a**: `opts.avatarCandidateId=""` → `getCandidateForBirth`
   NOT called; `writeAvatarSiblingFile` NOT called; identity frontmatter has
   no `avatar:` key; role + displayName still present.
2. **T-86-04-orch-b**: `opts.avatarCandidateId='cand-legacy'` (explicit
   path) → `writeAvatarSiblingFile` called once with correct args;
   frontmatter contains `avatar: willow.png` (backward-compat regression
   guard).
3. **T-86-04-orch-c**: full cosmetic-inherit shape (`opts.title=""`,
   `opts.colorHue=null`, `opts.voice=null`, `opts.avatarCandidateId=""`) →
   frontmatter contains only `role` + `displayName`; no `title`, `colorHue`,
   `voice`, `avatar` keys; `writeAvatarSiblingFile` not called.

**Scoped verification command**:

```
npx vitest run \
  src/backend/database/routes/identity-birth.test.ts \
  src/backend/database/routes/identity-birth-orchestrator.test.ts \
  src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts \
  src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.put-disk.test.ts \
  src/ui/api/identities-api.role-cosmetics.test.ts
```

Result: `Test Files 7 passed (7) | Tests 155 passed (155)`.

Additional guards:

- `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npm run build:backend` — clean.

## BirthRequest widening path chosen

**Option (a) LOCKED per plan** — widen `title` and `avatarCandidateId` to
optional (`title?: string`, `avatarCandidateId?: string`) in the frontend
`BirthRequest` type + relax the backend HTTP-route required-gates to
type-only guards. Alternative option (b) — force the frontend to send
role-derived placeholder values so the birth stream still carries real
strings — was rejected at plan-check time (would defer the "identity
inherits role's face on landing" promise to a follow-up phase, and every
IdentityModal render would need to distinguish placeholder from override).

## Downstream Consumers of `NewSessionOnCreateOpts` (preflight sweep)

The `NewSessionOnCreateOpts identityMode:true` variant lost five fields
(`title`, `brief`, `avatarCandidateId`, `voice`, `colorHue`). Two consumers
wire the callback:

- **`src/ui/AppShell.tsx` L2040**: narrows on `opts.identityMode` and
  destructures only `host` + `sessionName` + `name`. **No edit required.**
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
  L1945**: forwards `opts` opaquely to `onCreateSession!(opts)`. **No edit
  required.**

Preflight regression grep confirmed the invariant post-plan:

```
$ grep -c 'opts\.title\|opts\.brief\|opts\.voice\|opts\.colorHue\|opts\.avatarCandidateId' \
    src/ui/AppShell.tsx \
    src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
src/ui/AppShell.tsx:0
src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:0
```

## Deviations from Plan

### Files-modified extension (orchestrator surface, Option A resolution)

**Rule 4 architectural checkpoint hit** at Task 1 Step 4(iv). The plan
explicitly hedged: "If the orchestrator lives in a file this plan does NOT
list in files_modified, STOP and surface — the file-ownership graph needs
to be extended before this edit proceeds."

Preflight verification confirmed the orchestrator hard-crashes at Step 1
when `opts.avatarCandidateId` is empty (`getCandidateForBirth` returns
`undefined` → the `!cand` throw fires → whole birth aborts with
`step:1:failed`). Step 2.5 also unconditionally reads `birthCandidate!` +
calls `writeAvatarSiblingFile`, and `buildIdentityFileBody` unconditionally
emits `["avatar", avatarFilename]`.

Executor halted with a structured checkpoint. Orchestrator approved
Option A (extend `files_modified` to include
`src/backend/database/routes/identity-birth-orchestrator.ts`) on
2026-09-08 with the rationale that (a) Option A matches D-CTX-86-inherit's
LOCKED promise; (b) orchestrator edits are strictly additive; (c) no
file-ownership conflict with any other Wave-1/Wave-2 plan; (d) the plan
explicitly authorized this via the "OR stop-and-report if the change
surface extends" hedge.

**Consequence for the plan file**: `86-04-PLAN.md`'s `files_modified`
frontmatter now lists four files (was three), with a comment explaining
the extension is the orchestrator-approved Option A resolution.

No other deviations.

## Known Stubs

None. All wired data flows to a real consumer path:

- Cosmetic-absent birth requests produce cosmetic-absent identity
  frontmatter, and Plan 86-01's `publicIdentity` merge resolves the
  displayed values from the role's frontmatter at read time.
- Cosmetic-absent identity folders have no avatar sibling file; Plan
  86-01's `GET /:key/avatar` role-folder fallback branch serves the role's
  avatar file.

## Threat Flags

None. The change strictly REDUCES surface — the HTTP route now accepts
fewer required fields (widening tolerance, not restricting), the
orchestrator has a new absent-branch that skips writes rather than
performing new ones, and the frontend deletes UI (fewer input paths).

## NewSessionDialog test assertions expected to break (for Plan 86-06)

Plan 86-06 will realign these existing test files. This plan does not touch
them because the campaign constraint requires scoped test runs only, and
the failures are expected + planned-for downstream:

- **`src/ui/sidebar/NewSessionDialog.test.tsx`**: any test asserting
  presence of a `title` input, `brief` textarea, `voice` picker, `color`
  picker, `avatar` generator button, `upload` button, or candidate carousel
  will fail. Same for tests that fill those fields and assert the birth
  stream call payload includes them. Tests that fill only host / role /
  name / task / path and assert the birth stream call payload OMITS the
  five cosmetic fields will need to be added.
- **`src/ui/sidebar/NewSessionDialog.chain.test.tsx` Test 10a/10b**
  (`initialBrief` pre-fills the Brief textarea): the `initialBrief` prop
  is still accepted but no longer wired to any UI element (deprecated-in-
  place). Both sub-tests will fail because there is no brief textarea to
  read; Plan 86-06 can either delete these tests or convert them into a
  regression guard confirming `initialBrief` is silently ignored.

## Self-Check: PASSED

- File `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-04-SUMMARY.md` — FOUND (this file)
- File `src/ui/sidebar/NewSessionDialog.tsx` — FOUND (modified)
- File `src/ui/api/identities-api.ts` — FOUND (modified)
- File `src/backend/database/routes/identity-birth.ts` — FOUND (modified)
- File `src/backend/database/routes/identity-birth-orchestrator.ts` — FOUND (modified)
- File `src/backend/database/routes/identity-birth.test.ts` — FOUND (modified, +5 tests)
- File `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` — FOUND (modified, +3 tests)
- Commit `368eef11` — FOUND (Task 1)
- Scoped test bundle exit code 0 — FOUND (155 tests pass across 7 files)
- `npm run build:backend` exit code 0 — FOUND
- `npx tsc -p tsconfig.json --noEmit` exit code 0 — FOUND
- Line count `src/ui/sidebar/NewSessionDialog.tsx` — 1158 (target: ≤ 1216; delta from pre-plan 1416: −258, target ≥ 200 line reduction met)
- Grep gates (all pass): ColorPicker=0, VoicePicker=0, postGenerateAvatarBatch|postManualAvatarCandidate|handleGenerate|handleManualUpload=0, `^  const [title` = 0, brief/voice/colorHue/candidates/pickedCandidateId/manualPreviewUrl states=0, avatarReady=0, new-identity-title|brief|voice|color=0, new-identity-name=2, path/setPath/selectedRole/identityMode count=48 (≥ 10), title?/avatarCandidateId? in identities-api.ts=2+, title/avatarCandidateId "required" 400 messages in identity-birth.ts=0, consumer cosmetic destructuring in AppShell.tsx + PrettyConversationsPanel.tsx=0.
