---
phase: 260909-dls
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/identities.ts
  - src/backend/database/routes/identities.put-disk.test.ts
  - src/ui/features/pretty-view/IdentityModal.tsx
autonomous: true
requirements:
  - 260909-dls-avatar-revert-end-to-end
user_setup: []

must_haves:
  truths:
    - "PUT /identities/:identityKey with meta.avatar=null deletes the identity's `avatar:` frontmatter key on disk."
    - "PUT /identities/:identityKey with meta.avatar=null hard-deletes the identity's sibling avatar file on disk (best-effort)."
    - "Post-revert GET /identities/:key/avatar falls back to the role's avatar via Phase 86 Plan 86-01."
    - "Idempotent: revert on an identity with no avatar override is a safe no-op (no crash, no 5xx)."
    - "IdentityModal comment at L1373-1387 no longer claims backend does not read meta.avatar."
    - "Existing PUT tests (put-disk.test.ts Tests 1-11) still pass — no regression to IdentityMetadata-consuming branches."
  artifacts:
    - path: "src/backend/database/routes/identities.ts"
      provides: "avatar?: string | null on IdentityMetadata + null-delete overlay branch + sibling-file unlink"
      contains: "meta.avatar === null"
    - path: "src/backend/database/routes/identities.put-disk.test.ts"
      provides: "New Test 12 (LOCAL avatar-null delete): frontmatter avatar key gone + sibling file gone + role fallback via avatarUrl"
      contains: "avatar: null"
    - path: "src/ui/features/pretty-view/IdentityModal.tsx"
      provides: "Sweep of stale wire-only-no-op comment at L1373-1387"
      contains: "avatarReverting"
  key_links:
    - from: "src/backend/database/routes/identities.ts (PUT overlay branch, ~L595)"
      to: "fs.unlink(getLocalIdentitiesRoot()/:key/:oldAvatar) OR execCommand(conn, rm -f $HOME/.claude/identities/:key/:oldAvatar)"
      via: "post-writeIdentityFile best-effort unlink, mirrors ext-swap cleanup at L634-651"
      pattern: "meta\\.avatar === null.*(fs\\.unlink|rm -f)"
    - from: "IdentityModal.tsx avatarReverting branch (L1385-1387)"
      to: "backend PUT handler avatar-null delete branch"
      via: "meta.avatar = null in multipart data payload; backend now honors it end-to-end"
      pattern: "meta\\.avatar = null"
---

<objective>
Close the avatar-revert wire gap flagged by the fix-mode shape spec at
.planning/shapes/fix-identity-avatar-revert-completes-end-to-end.md. The
IdentityModal already emits `meta.avatar = null` on Revert click (Phase 86
Plan 86-05 wire), but the backend PUT handler's `IdentityMetadata` type omits
`avatar`, so `JSON.parse` pass-through drops the key and no overlay branch ever
sees it. Result: frontmatter `avatar:` and sibling file linger on disk; the
wearer still sees their identity-scope avatar even though the UI reported
success. This plan widens the type, adds the null-delete overlay branch, hard-
deletes the sibling file post-write, adds ONE colocated LOCAL-path test
(RED-first), and sweeps the stale frontend comment.

Purpose: Make the Revert affordance functional end-to-end so the wearer no
longer needs to hand-edit their identity file to shed the override.

Output: 3 files touched, 2 commits (RED, GREEN — optional third commit for
comment sweep if not folded).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/shapes/fix-identity-avatar-revert-completes-end-to-end.md
@src/backend/database/routes/identities.ts
@src/backend/database/routes/identities.put-disk.test.ts
@src/backend/claude-session/identity-artifact-reader.ts

# Read only lines 1370-1410 of IdentityModal.tsx for the stale-comment sweep;
# do NOT read the whole file (2000+ lines, wastes context).
@src/ui/features/pretty-view/IdentityModal.tsx
</context>

<tasks>

<!-- =================================================================== -->
<!-- Task 1: RED — failing colocated test for LOCAL avatar-null delete   -->
<!-- =================================================================== -->
<task type="tdd" tdd="true">
  <name>Task 1: RED — add failing Test 12 (LOCAL avatar-null delete → frontmatter key + sibling file gone)</name>
  <files>src/backend/database/routes/identities.put-disk.test.ts</files>
  <behavior>
    New Test 12 in the existing describe block "PUT /identities/:identityKey — Phase 68-02 rekey (no row bump, no forceSave)". Follows the existing mock-based scaffold (readIdentityFileMock, writeIdentityFileMock, execCommandMock, isLocalHostIdMock — see put-disk.test.ts:198-262 for the mock surface; do NOT switch to real filesystem tmpdirs — the file uses spy-based mocks throughout).

    Test 12 assertions (all against the LOCAL branch, isLocalHostId → true):
    - Test 12a (LOCAL): PUT /identities/testkey with data={hostId:1, avatar:null}, seed markdown containing `avatar: testkey.webp` in frontmatter, isLocalHostIdMock=true. After request:
      * res.status === 200
      * writeIdentityFile was called once with a body whose parsed frontmatter has `"avatar" in fm === false` (key deleted).
      * fs-side sibling cleanup fired via fs.unlink (LOCAL path uses fs.unlink NOT execCommand — so execCommand rm -f calls MUST be zero for this test; assert via execCommandMock.mock.calls.filter for `rm -f` count === 0).
      * Because LOCAL uses real fs.unlink (not a spy in the current test file), the assertion for sibling deletion is: capture the writeIdentityFile body's frontmatter → assert `"avatar" in fm === false`. For the actual fs.unlink call itself, mock `fs/promises` at the top of the test file (add a new vi.mock block for `node:fs/promises` that spies unlink; keep other fs methods pass-through via `vi.importActual`). Assert unlinkMock was called once with a path containing `testkey/testkey.webp` (use expect.stringContaining).
      * Response body's `avatarUrl` still resolves to `/identities/testkey/avatar?hostId=1` (publicIdentity always emits this URL shape — the fallback happens server-side in GET /:key/avatar, not in the URL).

    - Test 12b (REMOTE, sibling assertion via execCommand): PUT /identities/testkey with data={hostId:7, avatar:null}, seed markdown with `avatar: testkey.png`, isLocalHostIdMock=false (default). After request:
      * res.status === 200
      * writeIdentityFile body frontmatter has `"avatar" in fm === false`.
      * execCommandMock was called with a cmd matching `rm -f "$HOME/.claude/identities/testkey/testkey.png"` (use expect.stringContaining on the second arg, filter execCommandMock.mock.calls for the rm -f prefix, assert exactly one such call).

    - Test 12c (idempotent no-op): PUT /identities/testkey with data={hostId:1, avatar:null}, seed markdown with NO `avatar:` key (identity has no override). After request:
      * res.status === 200 (no crash).
      * writeIdentityFile was called (frontmatter still gets re-emitted with other fields untouched).
      * Neither fs.unlink NOR execCommand rm -f fired (oldAvatar was null so the sibling-cleanup branch is skipped).

    All three assertions live in ONE `it()` block titled "Test 12 (260909-dls): PUT avatar-null deletes frontmatter key + sibling file (LOCAL + REMOTE) and no-ops when no override exists" — OR split into 3 sibling it() blocks named "Test 12a/b/c" if that reads cleaner (executor's call, follow existing file style at Tests 4/5 which are separate it() blocks per branch).
  </behavior>
  <action>
    Read src/backend/database/routes/identities.put-disk.test.ts fully (already in context above) to internalize the mock scaffold. Add a `vi.mock("node:fs/promises", ...)` block near the top (after the existing tmux-helper mock at L277) that uses `vi.importActual` to preserve real fs.promises for non-unlink methods, and injects a `vi.fn()` for `unlink` — export the spy as a module-scoped `fsUnlinkMock` variable so tests can assert on it. Reset fsUnlinkMock in the `beforeEach` block (add `fsUnlinkMock.mockResolvedValue(undefined)` alongside the other `.mockResolvedValue(undefined)` setup calls at L397-402).

    Append the new Test 12 block(s) inside the existing describe (after Test 11 at ~L771, before the closing `});` at L773). Follow the exact scaffold of Test 5 (ext-swap rm -f assertion) as the template for the REMOTE sibling-delete assertion pattern (see L569-605 in the current file). Use `buildMultipartBody({ data: { hostId: N, avatar: null } })` — no `file` field (revert is JSON-only, no upload).

    Run the test file in isolation and CAPTURE the failure output:
      `npx vitest run src/backend/database/routes/identities.put-disk.test.ts 2>&1 | tail -80`
    The test MUST fail — the backend has no avatar-null delete branch yet, so:
      - Test 12a: assertion `"avatar" in fm === false` will fail (avatar key still present in written frontmatter).
      - Test 12b: `rm -f` execCommand call count will be 0 instead of 1.
      - Test 12c: probably passes accidentally (no-op path is trivially satisfied by current code); it is documentation of the invariant to preserve.

    Commit the failing test ALONE (no implementation changes) with the RED commit message below. Paste the trimmed failure output (last ~40 lines showing the failing assertions) into the commit body so the RED evidence lives in git history per fleet TDD discipline.

    Commit message:
      `test(260909-dls): RED — assert PUT avatar-null deletes frontmatter key + sibling file`
    Body: the vitest failure output tail (assertion diffs for 12a and 12b).

    Do NOT run the full suite. Do NOT run any other test file. Do NOT push.
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identities.put-disk.test.ts 2>&1 | grep -E "(Test 12|FAIL|passed|failed)" | head -20</automated>
  </verify>
  <done>
    - Test 12 (or 12a/12b/12c triplet) added to put-disk.test.ts inside the existing describe block.
    - `node:fs/promises` vi.mock block added with fsUnlinkMock spy (unlink only; other fs methods pass-through via vi.importActual).
    - `npx vitest run src/backend/database/routes/identities.put-disk.test.ts` shows the new test(s) FAILING with the expected assertion diffs (avatar key still in fm, rm -f count 0 instead of 1).
    - RED commit made with the failure output pasted into the commit body.
    - No other files touched in this commit (test file + optional co-touched fs mock scaffold only — identities.ts and IdentityModal.tsx untouched).
  </done>
</task>

<!-- =================================================================== -->
<!-- Task 2: GREEN — backend impl (type + branch + sibling unlink)       -->
<!-- =================================================================== -->
<task type="tdd" tdd="true">
  <name>Task 2: GREEN — widen IdentityMetadata, add null-delete overlay branch, hard-delete sibling file post-write</name>
  <files>src/backend/database/routes/identities.ts</files>
  <behavior>
    After this task the RED test from Task 1 turns GREEN. Three atomic edits to identities.ts:

    1. Type widening at L58-70 (IdentityMetadata declaration): add one field
       `  avatar?: string | null;`
       after the voice line and before the hostId JSDoc block. Keep the JSDoc comment on hostId intact. No other type fields change.

    2. Overlay null-delete branch after L595 (voice branch closes at L595 with `}`). Insert immediately after the voice `if (meta.voice !== undefined) { ... }` block, before the "---- Avatar handling ----" comment at L597:
       ```
       if (meta.avatar !== undefined) {
         if (meta.avatar === null) delete overlaid.avatar;
         // Non-null values in meta.avatar are silently ignored — avatar bytes
         // arrive via req.file (multipart upload) at the "---- Avatar handling
         // ----" block below, NOT via the JSON meta payload. Only the null-
         // revert case is meaningful here.
       }
       ```
       Do NOT add an else-branch for non-null (that path is owned by the req.file handling that starts at L599).

    3. Sibling file unlink on revert. Place AFTER the writeIdentityFile call at L620 and AFTER the "Write avatar sibling" block (L622-653), NOT inside the `if (req.file && newExt)` branch (mutually exclusive — revert has no req.file). Add a new block:
       ```
       // 260909-dls: avatar-revert sibling-file cleanup. When the null-delete
       // branch above ran AND the identity previously had an avatar override,
       // hard-delete the sibling file on disk. Best-effort (missing file is
       // fine — matches the ext-swap cleanup pattern at L634-651). Ordering:
       // this runs AFTER writeIdentityFile so the frontmatter delete is
       // persisted before the sibling removal. A mid-motion crash between
       // the two steps leaves an orphaned sibling file, but readers correctly
       // fall back to the role's avatar via Phase 86 Plan 86-01, so the
       // invariant holds.
       if (meta.avatar === null && oldAvatar) {
         if (local) {
           const oldPath = path.join(
             getLocalIdentitiesRoot(),
             identityKey,
             oldAvatar,
           );
           await fs.unlink(oldPath).catch(() => {
             /* best-effort */
           });
         } else if (conn) {
           await execCommand(
             conn,
             `rm -f "$HOME/.claude/identities/${identityKey}/${oldAvatar}"`,
           ).catch(() => {
             /* best-effort */
           });
         }
       }
       ```
       Note: `oldAvatar` (the full filename e.g. `testkey.webp`) is what we unlink — not `${identityKey}.${oldExt}`. `oldAvatar` was captured at L571-572 from the pre-write frontmatter. The ext-swap block at L634-651 reconstructs it as `${identityKey}.${oldExt}` because it re-derives the ext for symmetry, but here we already have the exact filename in `oldAvatar` — use it verbatim.

    After edits: re-run the scoped test file. All 11 pre-existing tests plus the new Test 12 MUST pass. If any pre-existing test breaks (e.g. Test 9 LOCAL branch expects readIdentityFileMock called twice), inspect the diff — the avatar-null path adds no new readIdentityFile calls (the unlink block only touches fs/execCommand, not readIdentityFile), so pre-existing tests should be unaffected.
  </behavior>
  <action>
    Apply the three edits to src/backend/database/routes/identities.ts using the Edit tool:

    Edit A (type widening at L58-70):
      Insert `  avatar?: string | null;` on a new line after the `voice?: string | null;` line (currently L63) and before the `/** Phase 66 Plan 66-02: required for the PUT disk-write flip.` JSDoc block that opens on L64.

    Edit B (overlay null-delete branch after L595):
      Insert the 5-line if/delete block (with the inline comment about non-null being req.file territory) immediately after the closing `}` of the voice branch at L595, before the blank line preceding `// ---- Avatar handling ----` at L597.

    Edit C (sibling unlink after writeIdentityFile block ends at L653):
      Insert the ~20-line if block (LOCAL fs.unlink / REMOTE execCommand rm -f, both best-effort) between the closing `}` of the `if (req.file && newExt) { ... }` block at L653 and the `// ---- Post-write re-read for response echo ----` comment at L655.

    After edits, run the scoped tests:
      `npx vitest run src/backend/database/routes/identities.put-disk.test.ts 2>&1 | tail -60`
    Confirm all 12 tests pass. If Test 12a/b/c still fail, inspect the assertion output — typical causes:
      - fsUnlinkMock not receiving the call: verify `import * as fs from "node:fs/promises";` at L5 of identities.ts is used (fs.unlink) rather than a separate import; the vi.mock block in the test file must intercept the same module identifier.
      - Wrong sibling filename: assert `oldAvatar` (verbatim from frontmatter) is passed to unlink, not a reconstructed `${identityKey}.${oldExt}`.

    Sanity-check the GET-disk test (unaffected by this change, but part of the fleet directive scope):
      `npx vitest run src/backend/database/routes/identities.get-disk.test.ts 2>&1 | tail -20`
    Confirm zero regressions.

    Optional TS-check for backend confidence (per role-file preference — frontend tsc doesn't cover backend):
      `npm run build:backend 2>&1 | tail -30`
    Confirm no new type errors from the IdentityMetadata widening.

    Commit the impl + test-turning-green with:
      `feat(260909-dls): PUT identities avatar-null revert deletes frontmatter + sibling file end-to-end`
    Body: brief note that this closes the shape gap at .planning/shapes/fix-identity-avatar-revert-completes-end-to-end.md; Task 1's RED test is now GREEN; the frontend wire at IdentityModal.tsx:1385-1387 (unchanged this commit) now functions end-to-end.

    Do NOT run the full suite. Do NOT push. Do NOT docker build.
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identities.put-disk.test.ts src/backend/database/routes/identities.get-disk.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    - IdentityMetadata type at src/backend/database/routes/identities.ts:58-70 now includes `avatar?: string | null;`.
    - Overlay branch `if (meta.avatar !== undefined) { if (meta.avatar === null) delete overlaid.avatar; }` present after L595.
    - Post-write sibling-unlink block present after the ext-swap cleanup, uses `oldAvatar` verbatim, branches on `local` for fs.unlink vs execCommand rm -f, both best-effort via `.catch(() => {})`.
    - `npx vitest run src/backend/database/routes/identities.put-disk.test.ts` — all 12 tests GREEN (11 pre-existing + Test 12).
    - `npx vitest run src/backend/database/routes/identities.get-disk.test.ts` — no regressions.
    - `npm run build:backend` — no new type errors (optional but recommended).
    - GREEN commit made with the feat(260909-dls) message.
  </done>
</task>

<!-- =================================================================== -->
<!-- Task 3: Stale-comment sweep in IdentityModal                        -->
<!-- =================================================================== -->
<task type="auto">
  <name>Task 3: Replace stale wire-only-no-op comment at IdentityModal.tsx L1373-1387 with a one-liner</name>
  <files>src/ui/features/pretty-view/IdentityModal.tsx</files>
  <action>
    Read only lines 1370-1410 of src/ui/features/pretty-view/IdentityModal.tsx (already in the context above; do NOT read the whole file — 2000+ lines wastes context).

    Replace the multi-line comment block at L1373-1384 (from `// Phase 86 Plan 86-05: avatar-revert wire — send meta.avatar = null so` through `// the identity already had its own avatar.`) with a single-line comment:
      `// 260909-dls: avatar-revert wire — backend PUT handler deletes the identity's `avatar:` frontmatter key + sibling file on disk (see src/backend/database/routes/identities.ts null-delete branch). Post-revert GET falls back to the role's avatar via Phase 86 Plan 86-01.`

    Keep the `if (avatarReverting) { meta.avatar = null; }` code block at L1385-1387 UNCHANGED — the wire is correct, only the explanatory prose is stale. Also keep the Phase 86 Plan 86-05 colorHue-revert bypass comment block at L1398-1403 UNCHANGED — that comment is about the colorHue guard, not the avatar path.

    Use the Edit tool with the old_string being the exact 12-line comment block (L1373-1384) and the new_string being the single-line comment (line breaks acceptable if the linter prefers ≤120 cols; if so, split into 2-3 lines but keep the content tight — do NOT reintroduce the old multi-paragraph prose).

    Bundle this commit with Task 2's GREEN commit IF the executor already staged Task 2 and wants a single-conceptual-change commit — the shape file at Vehicle section explicitly permits folding "IdentityModal.tsx — remove the stale ... comment" into the fix commit. Otherwise commit separately as:
      `docs(260909-dls): sweep stale wire-only-no-op comment in IdentityModal`

    Do NOT run any tests here — this is a comment-only change with no behavioral impact. Do NOT push. Do NOT build.
  </action>
  <verify>
    <automated>grep -c "backend PUT handler does not read meta.avatar" src/ui/features/pretty-view/IdentityModal.tsx</automated>
  </verify>
  <done>
    - The stale phrase "backend PUT handler does not read meta.avatar" is GONE from IdentityModal.tsx (grep count === 0).
    - The `if (avatarReverting) { meta.avatar = null; }` wire code is unchanged.
    - A short accurate comment referencing 260909-dls and the backend PUT handler is in place at ~L1373.
    - Commit made (either folded into Task 2's GREEN commit or as a separate docs(260909-dls) commit).
    - No other files touched.
  </done>
</task>

</tasks>

<verification>
Scoped test gates per fleet directive (no full suite):

1. Primary — new test passes + no regressions in the same file:
   `npx vitest run src/backend/database/routes/identities.put-disk.test.ts`
   Expected: 12 tests pass (11 pre-existing + Test 12 / or 12a+12b+12c triplet).

2. Sanity — GET-disk unaffected:
   `npx vitest run src/backend/database/routes/identities.get-disk.test.ts`
   Expected: all pre-existing tests pass; no regressions from the IdentityMetadata type widening.

3. Optional TS-check for backend (per role-file preference):
   `npm run build:backend`
   Expected: no new type errors.

4. Stale comment removed:
   `grep -c "backend PUT handler does not read meta.avatar" src/ui/features/pretty-view/IdentityModal.tsx`
   Expected: 0.

5. Overlay branch present:
   `grep -c "meta.avatar === null" src/backend/database/routes/identities.ts`
   Expected: ≥ 1 (the delete branch; may be 2 if the sibling-unlink block re-references it, which is fine).

6. Commit shape:
   `git log --oneline -3`
   Expected: RED commit → GREEN commit → (optional) docs commit. The RED commit body contains the vitest failure output tail.
</verification>

<success_criteria>
- Shape file's done-condition satisfied: scoped put-disk.test.ts passes with the new test GREEN + RED-then-GREEN evidence in commit log + no other identities.* test regressed + IdentityModal stale comment removed + no changes outside the three named files.
- Wearer flow: clicking Revert on the avatar field in IdentityModal → backend deletes frontmatter `avatar:` key + hard-deletes sibling file → subsequent GET /identities/:key/avatar returns the role's avatar via Phase 86 Plan 86-01 fallback (or 404 if the role also has no avatar). Affordance is end-to-end; no hand-editing required.
- Idempotency preserved: revert on an already-role-inherited identity is a safe no-op (Test 12c).
- Push-only ship: no docker build, no docker cp, no --force-recreate, no deploy this session. Push happens at the campaign ship gate per Ashley 2026-09-07, batched with the other 7 completed bounties.
</success_criteria>

<output>
No SUMMARY file needed for this quick task — the shape file's done-condition is the single source of truth for close verification. Commit log alone (RED → GREEN → optional docs) provides the audit trail.

If a SUMMARY is nonetheless requested by the orchestrator at close time, write it to `.planning/quick/260909-dls-fix-identity-avatar-revert-wire-only-no-/260909-dls-SUMMARY.md` with:
- Objective (one line)
- What changed (3 files, 3 edits)
- How it was verified (scoped vitest + grep gates listed under `<verification>`)
- Commit hashes (RED + GREEN + optional docs)
</output>
