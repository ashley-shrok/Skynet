---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 03b
type: execute
wave: 2
depends_on:
  - 80-02
  - 80-03
files_modified:
  - src/backend/database/routes/identity-birth-orchestrator.ts
  - src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts
  - src/backend/database/routes/identity-birth.ts
  - src/backend/database/routes/identity-birth.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Identity KEY (folder name, IDENTITY_KEY_RE gate, sessionMatchKey axis) DIVERGES from Matrix account MXID localpart per A1 DIVERGE lock: folder = lowercase pool name (e.g. `willow`); MXID localpart = PascalCase-hyphenated `<PoolName>-<Role>[-N]` (e.g. `Willow-Skynet-Maintainer`, `Willow-Skynet-Maintainer-2`, ...)."
    - "Ordinal derivation happens INSIDE `birthIdentity` (server-side, atomic per identity birth): the orchestrator composes the BASE HANDLE from opts.name + opts.role, calls `countUsersMatching` against the full MXID `@<BaseHandle>:<server>`, and if `total > 0` iterates suffix `-2`, `-3`, ... until `countUsersMatching(@<BaseHandle>-<N>:<server>)` returns `total == 0`. That MXID is then used for the admin-mint step."
    - "Casing convention (locked): PoolName PascalCase (`willow` → `Willow`, first letter uppercased, rest verbatim; pool names are single lowercase words per shape file so this is safe). Role name PascalCase-hyphenated (`skynet-maintainer` → `Skynet-Maintainer`, uppercase each hyphen-separated segment's first letter, rest verbatim). Applies to role shapes matching `/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/`; malformed role names throw at birth time (never silently produce a malformed handle)."
    - "Legacy compatibility (locked): the new MXID composition ONLY runs when `opts.poolPicked === true` — set by the frontend when the name was pool-picked (plan 80-06). Existing manually-created identities (Taylor, Tina, Tabitha, Tanya, Tiffany, etc.) with relay accounts like `@taylor:server` are NOT retroactively renamed; when `poolPicked` is unset/false, the orchestrator falls back to the legacy `@<opts.name>:<serverName>` shape at line 487 of identity-birth-orchestrator.ts."
    - "The MXID computed by the derivation step is threaded to the existing admin-mint (Step 6) via the same `mxid` local variable that already exists in `runRelayMintAndWrite` — no new orchestrator step added, no SSE wire format change. The countUsersMatching calls happen INLINE within Step 6's async closure, BEFORE the `matrixCreateOrUpdateUser` call."
    - "Ordinal-search bound (safety): the iteration caps at N=100 (arbitrary large ceiling; pool exhaustion beyond 100 accounts of the same handle indicates operator intervention needed). Exceeding the cap throws `Error('mxid_ordinal_exhausted')` which propagates through Step 6's runStep as a step-failed SSE event (Q2 no-rollback discipline preserved)."
    - "The `BirthOptions` interface (already extended for `task?: string` in plan 80-03) gains one additional field: `poolPicked?: boolean` (default false). Backward compatible — when absent, legacy behavior preserved."
    - "Admin-API failure during ordinal iteration (`countUsersMatching` returns `!ok`) throws inside Step 6's runStep and surfaces as a step-6 failure event with reason `admin_count_failed: <error> (<status>)` — mirrors the existing `admin_mint_failed` / `admin_login_failed` error-attribution pattern at lines 514-516 and 522-524."
    - "POST /identities/birth accepts optional `poolPicked?: boolean` in request body (validated as `boolean | undefined`, defaults to false). Frontend NewSessionDialog (plan 80-06) sets it to true when the name field was pre-filled by `pickPoolName`."
  artifacts:
    - path: "src/backend/database/routes/identity-birth-orchestrator.ts"
      provides: "BirthOptions.poolPicked?; new `composeMxidLocalpart(name, role): string` helper; new `deriveMxidWithOrdinal(baseHandle, serverName, countFn): Promise<string>` helper; Step 6 uses derived MXID when opts.poolPicked, else legacy @<name>:<server>"
      contains: "poolPicked"
    - path: "src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts"
      provides: "Unit tests for composeMxidLocalpart casing + deriveMxidWithOrdinal iteration + Step 6 integration"
    - path: "src/backend/database/routes/identity-birth.ts"
      provides: "POST body validates poolPicked (boolean | undefined); threaded to birthIdentity opts"
      contains: "poolPicked"
    - path: "src/backend/database/routes/identity-birth.test.ts"
      provides: "Regression cases for poolPicked body validation + threading"
      contains: "poolPicked"
  key_links:
    - from: "birthIdentity → runRelayMintAndWrite → Step 6 admin-mint"
      to: "countUsersMatching (matrix-admin-client.ts from plan 80-02)"
      via: "deriveMxidWithOrdinal iteration loop"
      pattern: "countUsersMatching"
    - from: "identity-birth.ts POST handler"
      to: "birthIdentity(opts) with opts.poolPicked"
      via: "req.body.poolPicked → parsedPoolPicked → opts"
      pattern: "poolPicked"
    - from: "composeMxidLocalpart(opts.name, opts.role)"
      to: "runRelayMintAndWrite mxid variable at L487"
      via: "MXID replaces the legacy `@${opts.name}:${serverName}` when opts.poolPicked === true"
      pattern: "composeMxidLocalpart|deriveMxidWithOrdinal"
---

<objective>
Implement the MXID handle-format DIVERGE decision (A1 lock) inside the birth orchestrator: when an identity is born via the pool-pick modal flow (plan 80-06), its Matrix account MXID becomes `@<PoolName>-<Role>[-N]:<server>` (PascalCase-hyphenated with silent auto-suffix on collision) while the identity folder key stays lowercase (e.g. `willow`). Legacy manually-created identities are NOT affected — the new derivation gates on `opts.poolPicked === true`.

This plan closes revision blocker 1 (MXID handle format + ordinal derivation unimplemented) and blocker 2 (pool-pick picker's "is this taken" check needs to use the full handle shape — addressed here by making the orchestrator own MXID uniqueness so the picker only checks the BASE handle in plan 80-04).

Purpose: Owner-agent-relay Matrix accounts land as `Willow-Skynet-Maintainer`, `Willow-Skynet-Maintainer-2`, ... per the greenlit shape file (2026-09-06). The birth-orchestrator owns MXID uniqueness end-to-end.
Output: One source file extended with two new pure helpers + Step 6 integration; one new dedicated test file; birth HTTP handler extended for `poolPicked` body field.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-CONTEXT.md
@.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-RESEARCH.md
@.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-PATTERNS.md
@src/backend/database/routes/identity-birth-orchestrator.ts
@src/backend/database/routes/identity-birth.ts
@src/backend/matrix/matrix-admin-client.ts
@~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add composeMxidLocalpart + deriveMxidWithOrdinal pure helpers + dedicated test file</name>
  <files>src/backend/database/routes/identity-birth-orchestrator.ts, src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts</files>
  <read_first>
    - src/backend/database/routes/identity-birth-orchestrator.ts:100-131 (BirthOptions interface — target of `poolPicked?: boolean` addition)
    - src/backend/database/routes/identity-birth-orchestrator.ts:195-218 (BirthDeps.matrixCreateOrUpdateUser + matrixLoginAsUser typings — new `matrixCountUsersMatching` dep type mirrors these two)
    - src/backend/database/routes/identity-birth-orchestrator.ts:463-527 (runRelayMintAndWrite Step 6 — the `mxid` local at L487 is the current point-of-modification for MXID composition; deriveMxidWithOrdinal call lands INSIDE Step 6's runStep BEFORE the matrixCreateOrUpdateUser call at L504)
    - src/backend/matrix/matrix-admin-client.ts (whole file — the `countUsersMatching` primitive from plan 80-02 that the derivation uses; note the discriminated-union return shape `{ ok: true; total: number } | AdminErr`)
    - .planning/phases/80-*/80-RESEARCH.md §Landmines §9 (identity key vs MXID localpart divergence — the load-bearing choice this task implements)
    - ~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md § Naming (canonical shape file: `<PoolName>-<Role>[-ordinal]` PascalCase-hyphenated)
  </read_first>
  <behavior>
    Two new pure helpers exported from `identity-birth-orchestrator.ts` (side-effect-free — testable in isolation without SSH / matrix mocking):

    **`composeMxidLocalpart(name: string, role: string): string`**
    - Input `name` MUST match `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` (already validated upstream at L606).
    - Input `role` MUST match `/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/` (kebab-case-lowercase with no leading digit per segment). If not, throws `Error('mxid_role_malformed: <role>')`.
    - Pool name pool-restriction: for A1 correctness, `name` must ALSO match `/^[a-z][a-z0-9]*$/` (single-word lowercase, no hyphens). If not (e.g. legacy `taylor-2` or user-typed `my-custom`), throws `Error('mxid_name_not_pool_shape: <name>')` — caller (Step 6 gate) treats this as "poolPicked is set but the name has been edited to a non-pool shape" and falls back to legacy `@<name>:<server>` (see Task 2 for the fallback logic).
    - Output: `<PascalName>-<PascalHyphenatedRole>` where:
      - `PascalName = name[0].toUpperCase() + name.slice(1)` (e.g. `willow` → `Willow`).
      - `PascalHyphenatedRole = role.split('-').map(seg => seg[0].toUpperCase() + seg.slice(1)).join('-')` (e.g. `skynet-maintainer` → `Skynet-Maintainer`).
    - Example: `composeMxidLocalpart("willow", "skynet-maintainer")` → `"Willow-Skynet-Maintainer"`.

    **`deriveMxidWithOrdinal(baseHandle: string, serverName: string, countFn: (mxid: string) => Promise<{ ok: true; total: number } | { ok: false; status: number; error: string }>): Promise<string>`**
    - Input `baseHandle` is the output of composeMxidLocalpart (e.g. `Willow-Skynet-Maintainer`).
    - Input `serverName` is the extracted-from-URL homeserver hostname (e.g. `matrix.example.com`).
    - Input `countFn` is the dep-injected `countUsersMatching` (from BirthDeps — new dep added below).
    - Algorithm:
      1. Try `mxid = @<baseHandle>:<serverName>`. Call `countFn(mxid)`. If `!ok`, throw `Error('admin_count_failed: <error> (<status>)')`. If `total === 0`, return `mxid`.
      2. Iterate `n = 2, 3, ..., 100`: try `mxid = @<baseHandle>-<n>:<serverName>`. Same countFn call. Same error-propagation. Return first `total === 0`.
      3. If loop completes without finding an unused ordinal (n reached 100 with all busy), throw `Error('mxid_ordinal_exhausted: <baseHandle>')`.
    - Silent-auto-suffix invariant: caller (Step 6) never sees the ordinal choice — the returned MXID is opaquely usable. Meets CONTEXT.md `<domain>` bullet: "silent auto-suffix if the base handle is already taken."

    **BirthDeps addition:**
    - `matrixCountUsersMatching: (mxid: string) => Promise<{ ok: true; total: number } | { ok: false; status: number; error: string }>` — new BirthDeps field. Wired in identity-birth.ts to `countUsersMatching` from matrix-admin-client.ts (plan 80-02).

    **BirthOptions addition:**
    - `poolPicked?: boolean` — optional (defaults to false).

    Both helpers are exported (via `export function ...`) so the test file can unit-test them without invoking the full birthIdentity flow.
  </behavior>
  <action>
    In `identity-birth-orchestrator.ts` `BirthOptions` interface (L111-130 region): add `poolPicked?: boolean;` field. Add JSDoc: "Phase 80 A1 lock: when true, MXID composition follows the DIVERGE shape (`<PoolName>-<Role>[-N]` PascalCase-hyphenated per shape file); when false/absent, legacy `@<name>:<serverName>` shape is used (backward compat for pre-Phase-80 identities and manually-typed names). Frontend sets true when the name field was pool-picked."

    In `BirthDeps` interface (L132-242 region, near the existing `matrixCreateOrUpdateUser` and `matrixLoginAsUser` deps at L195-218): add:
    ```
    matrixCountUsersMatching: (mxid: string) => Promise<
      | { ok: true; total: number }
      | { ok: false; status: number; error: string }
    >;
    ```
    with JSDoc citing "Phase 80 A1 lock — wired to matrix-admin-client.countUsersMatching from plan 80-02. Called by deriveMxidWithOrdinal inside Step 6 to find the first unused ordinal for the composed base handle."

    Add TWO new top-level `export function`s BEFORE the `runRelayMintAndWrite` function (or in a clearly-labeled `// ---- Phase 80 A1 MXID derivation ----` section):

    ```
    const POOL_NAME_RE = /^[a-z][a-z0-9]*$/;
    const ROLE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;
    const MXID_ORDINAL_MAX = 100;

    export function composeMxidLocalpart(name: string, role: string): string { ... }

    export async function deriveMxidWithOrdinal(
      baseHandle: string,
      serverName: string,
      countFn: (mxid: string) => Promise<{ ok: true; total: number } | { ok: false; status: number; error: string }>,
    ): Promise<string> { ... }
    ```

    Implementation per behavior spec above. Both helpers side-effect-free (deriveMxidWithOrdinal's only I/O is via the injected countFn — tests supply a mock countFn returning canned totals).

    Create new dedicated test file `identity-birth-orchestrator.mxid-derivation.test.ts` (a separate file — the existing `identity-birth-orchestrator.role-frontmatter.test.ts` covers frontmatter emission; MXID derivation is orthogonal enough to warrant its own file for locality). Test cases:

    **composeMxidLocalpart:**
    - (a) `composeMxidLocalpart("willow", "skynet-maintainer") === "Willow-Skynet-Maintainer"`.
    - (b) `composeMxidLocalpart("aster", "coordinator") === "Aster-Coordinator"`.
    - (c) `composeMxidLocalpart("willow", "foo-bar-baz") === "Willow-Foo-Bar-Baz"` (multi-segment role).
    - (d) Malformed role (uppercase in source): `composeMxidLocalpart("willow", "Skynet-Maintainer")` throws `mxid_role_malformed`.
    - (e) Malformed role (starts with digit): `composeMxidLocalpart("willow", "2maintainer")` throws `mxid_role_malformed`.
    - (f) Malformed role (empty segment `foo--bar`): throws `mxid_role_malformed`.
    - (g) Name with hyphen (not pool shape): `composeMxidLocalpart("willow-2", "skynet-maintainer")` throws `mxid_name_not_pool_shape` — signals caller to fall back to legacy shape.
    - (h) Name starting with digit: `composeMxidLocalpart("2willow", "skynet-maintainer")` throws `mxid_name_not_pool_shape`.

    **deriveMxidWithOrdinal:**
    - (i) Base free (mock returns `{ok:true, total:0}` on first call): returns `@Willow-Skynet-Maintainer:matrix.example.com`; mock called exactly once.
    - (j) Base taken, `-2` free: mock returns `{ok:true, total:1}` on call 1, `{ok:true, total:0}` on call 2; returns `@Willow-Skynet-Maintainer-2:matrix.example.com`; mock called exactly twice.
    - (k) Base + `-2` + `-3` taken, `-4` free: three busy responses then free; returns `-4` MXID; mock called four times.
    - (l) All 100 ordinals busy: mock always returns `{ok:true, total:1}`; deriveMxidWithOrdinal throws `mxid_ordinal_exhausted`; mock called exactly 100 times.
    - (m) countFn returns `{ok:false, status:502, error:"admin_api_proxy_error"}` on call 1: throws `admin_count_failed: admin_api_proxy_error (502)`.
    - (n) countFn returns error on ordinal iteration (base free at call 1, error at call 2 — should not happen in practice since we return on first free, but the code path exists if base is busy): mock returns busy on call 1, error on call 2 → throws `admin_count_failed: ... (...)`.

    Commit prefix: `feat(80-03b)` for source, `test(80-03b)` for test file (combined commit fine).
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts --reporter=verbose 2>&amp;1 | tail -50</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'export function composeMxidLocalpart' src/backend/database/routes/identity-birth-orchestrator.ts` prints `1`.
    - `grep -c 'export async function deriveMxidWithOrdinal' src/backend/database/routes/identity-birth-orchestrator.ts` prints `1`.
    - `grep -c 'poolPicked?: boolean' src/backend/database/routes/identity-birth-orchestrator.ts` prints `1`.
    - `grep -c 'matrixCountUsersMatching' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `1` (dep declaration).
    - `grep -c 'MXID_ORDINAL_MAX' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `1`.
    - `grep -c 'mxid_role_malformed\|mxid_name_not_pool_shape\|mxid_ordinal_exhausted\|admin_count_failed' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `4`.
    - `npx vitest run src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` reports at least 14 passing cases (8 composeMxidLocalpart + 6 deriveMxidWithOrdinal).
    - `grep -cE '^\s*(it|test)\(' src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` >= 14.
  </acceptance_criteria>
  <done>composeMxidLocalpart + deriveMxidWithOrdinal helpers shipped as exported pure functions; BirthOptions.poolPicked + BirthDeps.matrixCountUsersMatching typed; dedicated unit test file covers all casing + ordinal + error branches.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire helpers into runRelayMintAndWrite Step 6 (gated on opts.poolPicked); thread poolPicked through identity-birth.ts</name>
  <files>src/backend/database/routes/identity-birth-orchestrator.ts, src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts, src/backend/database/routes/identity-birth.ts, src/backend/database/routes/identity-birth.test.ts</files>
  <read_first>
    - src/backend/database/routes/identity-birth-orchestrator.ts:463-527 (runRelayMintAndWrite Step 6 — `mxid = @${opts.name}:${serverName}` at L487 is the modification point; the `mxid` local is used at L505 (matrixCreateOrUpdateUser) and L519 (matrixLoginAsUser). The derivation must land BEFORE L487 so subsequent uses pick up the derived value.)
    - src/backend/database/routes/identity-birth-orchestrator.ts:456-467 (runStep helper — Step 6's runStep wraps the async work; MXID derivation happens INSIDE the runStep so admin-API failures during derivation attribute correctly to step 6)
    - src/backend/database/routes/identity-birth.ts:84-127 (existing body validation — mirror the nullable-optional pattern for poolPicked)
    - src/backend/database/routes/identity-birth.ts:232-247 (birthIdentity call site — thread poolPicked through opts)
    - src/backend/matrix/matrix-admin-client.ts (import path for countUsersMatching — wire as BirthDeps.matrixCountUsersMatching in identity-birth.ts's `deps` construction; grep for the current wire of matrixCreateOrUpdateUser to find the analog site)
    - src/backend/database/routes/identity-birth.test.ts (existing body-validation tests — extend for poolPicked field)
  </read_first>
  <behavior>
    - Legacy behavior preserved: when `opts.poolPicked !== true` (falsy/undefined/false), Step 6 uses the legacy `const mxid = \`@${opts.name}:${serverName}\`` shape (line 487 unchanged for this branch). Existing identities born via non-pool paths (retry-only, direct API calls) remain unaffected.
    - New behavior (poolPicked=true): Step 6's runStep, BEFORE `matrixCreateOrUpdateUser`, does:
      1. Try `composeMxidLocalpart(opts.name, opts.role)` → base handle.
      2. If throws `mxid_name_not_pool_shape` (user edited name to non-pool form despite the poolPicked flag), catch and fall back to the legacy MXID `@${opts.name}:${serverName}` — silent fallback, no error surfaced (matches shape file's "user can edit the name to anything" invariant).
      3. If throws `mxid_role_malformed`, do NOT catch — role names in Skynet are gate-validated upstream and any malformed role is a genuine bug that should surface as a Step 6 failure.
      4. If composeMxidLocalpart succeeds, call `deriveMxidWithOrdinal(baseHandle, serverName, deps.matrixCountUsersMatching)` → the ordinal-suffixed MXID.
      5. Use the derived MXID for both `matrixCreateOrUpdateUser` and `matrixLoginAsUser`.
    - The `mxid` variable at L487 is REPLACED by a `let mxid: string` declaration (or moved into Step 6) so the derivation can reassign it.
    - Admin-API failure during derivation → `deriveMxidWithOrdinal` throws → Step 6's runStep catches and emits `step:6:failed` with the sanitized reason (existing runStep behavior at L474-480 — Q2 no-rollback discipline preserved).
    - identity-birth.ts POST body validation: `poolPicked` optional boolean. If present and not a boolean → 400 `{ error: "poolPicked must be a boolean" }`. Threaded to `birthIdentity({ ..., poolPicked: parsedPoolPicked, ... })`.
    - identity-birth.ts BirthDeps construction: adds `matrixCountUsersMatching: countUsersMatching` (imported from matrix-admin-client, same import path used for matrixCreateOrUpdateUser today).
    - Backward compatibility: POST body without `poolPicked` → `parsedPoolPicked === undefined` → opts.poolPicked undefined → orchestrator takes legacy branch. Zero-effect for existing clients.
  </behavior>
  <action>
    In `identity-birth-orchestrator.ts` around L483-527: refactor the `serverName` + `mxid` local declaration + Step 6 body:

    1. Move the `const mxid = ...` line INSIDE Step 6's runStep callback (currently at L487, outside runStep). Declare as `let mxid: string;` before the runStep call, then assign inside.

    2. At the top of Step 6's runStep body (before `agentPassword = generateAgentPassword();`), insert the derivation block:
       - Try/catch around `composeMxidLocalpart(opts.name, opts.role)` — catch ONLY the `mxid_name_not_pool_shape` error (rethrow other errors, e.g. `mxid_role_malformed`).
       - If poolPicked && base handle derived successfully: `mxid = await deriveMxidWithOrdinal(baseHandle, serverName, deps.matrixCountUsersMatching);`.
       - Else (legacy branch OR the name-not-pool fallback): `mxid = \`@${opts.name}:${serverName}\`;`.

    3. Ensure the existing L505 `matrixCreateOrUpdateUser(mxid, ...)` and L519 `matrixLoginAsUser(mxid)` calls see the derived `mxid` (no textual change to them; the `mxid` variable now holds the derived value).

    Extend `identity-birth-orchestrator.mxid-derivation.test.ts` (created in Task 1) with a Step 6 integration describe block:
    - (o) `runRelayMintAndWrite` with `opts.poolPicked === true` + all mocks: assert `matrixCreateOrUpdateUser` was called with `@Willow-Skynet-Maintainer:server` (derived MXID) not `@willow:server`.
    - (p) `runRelayMintAndWrite` with `opts.poolPicked === true` and mocked matrixCountUsersMatching returning `{ok:true, total:1}` first + `{ok:true, total:0}` second: assert matrixCreateOrUpdateUser called with `@Willow-Skynet-Maintainer-2:server`.
    - (q) `runRelayMintAndWrite` with `opts.poolPicked !== true` (undefined/false): assert matrixCreateOrUpdateUser called with legacy `@willow:server`; matrixCountUsersMatching NOT called.
    - (r) `runRelayMintAndWrite` with `opts.poolPicked === true` and `opts.name = "my-custom"` (user-edited non-pool name): assert composeMxidLocalpart throws `mxid_name_not_pool_shape`, orchestrator catches and falls back to legacy `@my-custom:server`; matrixCountUsersMatching NOT called (skip derivation path).
    - (s) `runRelayMintAndWrite` with `opts.poolPicked === true` and admin count failure: assert Step 6 emits `{ type: "step", n: 6, phase: "failed", reason: ... }` with the sanitized `admin_count_failed` message.

    In `identity-birth.ts` body validation block (near colorHue/voice/task validation): add:
    ```
    if (poolPicked !== undefined && typeof poolPicked !== "boolean") {
      res.status(400).json({ error: "poolPicked must be a boolean" });
      return;
    }
    const parsedPoolPicked = typeof poolPicked === "boolean" ? poolPicked : undefined;
    ```
    Thread `poolPicked: parsedPoolPicked,` into the `birthIdentity({...})` opts call site.

    In `identity-birth.ts` deps construction: add `matrixCountUsersMatching: countUsersMatching,` to the BirthDeps literal; add the import from `../../matrix/matrix-admin-client.js` (same file that already exports the mint/login primitives).

    In `identity-birth.test.ts`: extend body-validation describe with cases: (a) poolPicked=true → 200, opts.poolPicked === true; (b) poolPicked=false → 200, opts.poolPicked === false; (c) poolPicked absent → 200, opts.poolPicked undefined; (d) poolPicked="yes" (non-boolean) → 400 with error string.

    Commit prefix: `feat(80-03b)` for source, `test(80-03b)` for tests.
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts src/backend/database/routes/identity-birth.test.ts --reporter=verbose 2>&amp;1 | tail -60</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'opts.poolPicked' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `1`.
    - `grep -c 'deriveMxidWithOrdinal(' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `1` (the call site inside Step 6, in addition to the export declaration from Task 1).
    - `grep -c 'composeMxidLocalpart(' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `1` (call site inside Step 6).
    - `grep -c 'mxid_name_not_pool_shape' src/backend/database/routes/identity-birth-orchestrator.ts` prints at least `2` (thrown location + caught location).
    - `grep -c 'poolPicked must be a boolean' src/backend/database/routes/identity-birth.ts` prints `1`.
    - `grep -c 'matrixCountUsersMatching' src/backend/database/routes/identity-birth.ts` prints at least `1` (dep wiring).
    - `grep -c 'parsedPoolPicked' src/backend/database/routes/identity-birth.ts` prints at least `2` (declaration + call-site use).
    - The `mxid` variable at former L487 is no longer a `const` at top level of runRelayMintAndWrite: `grep -c "const mxid = \`@" src/backend/database/routes/identity-birth-orchestrator.ts` prints `0`; instead `grep -c "let mxid: string" src/backend/database/routes/identity-birth-orchestrator.ts` prints `1`.
    - The runStep call count is unchanged (no new SSE step): `grep -cE 'runStep\(\s*[0-9]+' src/backend/database/routes/identity-birth-orchestrator.ts` matches the pre-revision baseline of 9 (6 numbered call sites at steps 1, 2, 3, 6, 7, 8 + 3 in-file comment references also matched by the regex). MXID derivation lands INSIDE the existing Step 6 runStep — it MUST NOT introduce a new numbered runStep call site. If baseline drifts (e.g., unrelated refactor changed comment count), the semantic invariant is: `grep -cE 'await runStep\(\s*[0-9]+' src/backend/database/routes/identity-birth-orchestrator.ts` remains at 6 (call sites only, no new numbered step).
    - `npx vitest run src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts -t "Step 6"` reports >= 5 passing cases (integration tests o-s above).
    - `npx vitest run src/backend/database/routes/identity-birth.test.ts -t "poolPicked"` reports >= 4 passing cases.
    - Existing birth tests still pass: `npx vitest run src/backend/database/routes/identity-birth.test.ts` (no regressions on non-poolPicked paths).
  </acceptance_criteria>
  <done>Step 6 derives MXID from PoolName+Role with silent ordinal suffix when poolPicked=true; legacy shape preserved when poolPicked=false/absent; user-edited-non-pool-name falls back silently to legacy; admin-API failure attributes to Step 6; HTTP handler accepts and threads poolPicked.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| HTTP client → POST /identities/birth | poolPicked is user-controlled boolean (client sets true when name field was pool-prefilled) — validated as boolean-or-undefined |
| birthIdentity → Synapse admin API (via matrixCountUsersMatching) | Server-to-server; token never leaves backend; ordinal iteration bounded at 100 to prevent unbounded loops |
| composeMxidLocalpart output → matrix-admin-client → Synapse | PascalCase-derived MXID localpart; must not contain characters unsafe for MXID grammar (validated by ROLE_NAME_RE + POOL_NAME_RE regexes) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-80-03b-01 | Tampering | Malformed role name produces invalid MXID (e.g. `@Willow-Foo bar:server` with a space) | mitigate | `ROLE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/` gate in composeMxidLocalpart throws `mxid_role_malformed` before any Matrix API call; test cases d-f cover the branch. |
| T-80-03b-02 | Denial of Service | Attacker races to claim `Willow-Skynet-Maintainer-{1..100}` to exhaust ordinals | accept | MXID_ORDINAL_MAX=100 cap prevents infinite loop; exhaustion throws to Step 6 which attributes cleanly. Attacker would need admin creds to mint 100 accounts (already an insider threat); mitigation is operational (pool-list expansion or manual intervention). |
| T-80-03b-03 | Info Disclosure | Admin token leaks via ordinal-iteration error path | mitigate | `deriveMxidWithOrdinal` propagates `admin_count_failed: <error> (<status>)` — the `<error>` string is one of ERR_CREDS_MISSING / ERR_NON_2XX / ERR_TIMEOUT / ERR_PROXY (existing taxonomy from matrix-admin-client, no bearer/token leak). |
| T-80-03b-04 | Tampering | Client sets poolPicked=true but name doesn't match pool shape → silent malformed MXID | mitigate | composeMxidLocalpart throws `mxid_name_not_pool_shape`; Step 6 catches and falls back to legacy `@<name>:<server>` — no malformed MXID emitted. |
| T-80-03b-05 | Elevation of Privilege | Attacker sets poolPicked=true for existing identity name to reroute their Matrix account | accept | poolPicked only affects new mints (Step 6 runs during birth, not retry); existing identity's relay account is unchanged by this. Identity name collision is already gated at Step 1 (folder existence check) before Step 6 runs. |
| T-80-03b-06 | Tampering | Race: two concurrent births pick the same ordinal | accept | Skynet is single-user single-process; concurrent births per user are already serialized upstream. If a race did occur, Step 6's admin-mint would fail with 409 (existing behavior) and attribute correctly. Race mitigation is not a Phase 80 concern. |
| T-80-03b-07 | Tampering | Q2 no-rollback invariant violated by derivation adding a step | mitigate | Derivation lives INSIDE existing Step 6's runStep; no new SSE step number; grep gate asserts runStep count unchanged. Failure inside derivation attributes to step 6 (existing sanitizeError path). |
</threat_model>

<verification>
- mxid-derivation.test.ts reports >= 19 passing cases (14 unit + 5 Step 6 integration).
- identity-birth.test.ts poolPicked cases pass (>= 4).
- No new orchestrator SSE step introduced (grep gate: runStep call count unchanged from baseline of 3).
- BirthOptions has both `task?: string` (from 80-03) AND `poolPicked?: boolean` (from this plan).
- Legacy identity births (poolPicked absent/false) produce the exact same MXID as pre-Phase-80 code (regression test case q).
</verification>

<success_criteria>
- `composeMxidLocalpart(name, role)` and `deriveMxidWithOrdinal(base, server, countFn)` exported as pure, testable helpers.
- Step 6 uses derived MXID when `opts.poolPicked === true` AND `composeMxidLocalpart` succeeds; falls back to legacy `@<name>:<server>` otherwise.
- Silent ordinal auto-suffix (`-2`, `-3`, ..., up to `-100`) — matches CONTEXT.md `<domain>` "silent auto-suffix if the base handle is already taken."
- Casing convention locked: PoolName PascalCase, Role name PascalCase-hyphenated per shape file 2026-09-06.
- User-edited non-pool name (poolPicked=true but name mutated) silently falls back to legacy shape — no malformed MXID emitted.
- Admin API failure during derivation → Step 6 failure event with `admin_count_failed` reason.
- MXID_ORDINAL_MAX=100 cap prevents unbounded iteration.
- Q2 no-rollback invariant preserved (derivation inside existing Step 6 runStep; no new step number).
- Legacy identities and non-pool-picked identities produce unchanged MXIDs (backward compat regression test).
</success_criteria>

<output>
Create `.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-03b-SUMMARY.md` when done.
</output>
