---
mode: quick
slug: 260911-wd1-host-side-base-column
type: execute
status: complete
wave: 1
commits:
  - task: 1
    hash: eed58fb6
    scope: schema + store setter
  - task: 2
    hash: 7f0545be
    scope: PATCH endpoint + GET extension
  - task: 3
    hash: 0205f171
    scope: birth-orchestrator wiring
files_modified:
  - src/backend/database/db/schema.ts
  - src/backend/matrix/matrix-admin-creds-store.ts
  - src/backend/matrix/matrix-admin-creds-store.test.ts
  - src/backend/matrix/matrix-admin-routes.ts
  - src/backend/matrix/matrix-admin-routes.test.ts
  - src/backend/database/routes/identity-birth-orchestrator.ts
  - src/backend/database/routes/identity-birth-orchestrator.test.ts
  - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
  - src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts
  - src/backend/database/routes/identity-birth.ts
  - src/backend/database/routes/identity-birth.test.ts
  - src/backend/spawn-requests/worker.ts
---

# 260911-wd1: host-side-base column — SUMMARY

## What shipped

### Task 1 — hostSideBase column + store plumbing + setter (commit `eed58fb6`)

- **`src/backend/database/db/schema.ts`** — added nullable `host_side_base TEXT`
  column to `matrixAdminCreds` immediately after `serverName`, with a comment
  block explaining the URL-split rationale (docker-internal vs host-reachable).
- **`src/backend/matrix/matrix-admin-creds-store.ts`**:
  - Added `hostSideBase: string | null` to `MatrixAdminCreds` interface.
  - Extended `getMatrixAdminCreds()` return to include `hostSideBase: row.hostSideBase ?? null`.
  - Widened `setMatrixAdminCreds`'s input type from `Omit<..., "serverName">`
    to `Omit<..., "serverName" | "hostSideBase">` — sibling-setter split
    discipline preserved (encrypted-fields-only writes go through
    `setMatrixAdminCreds`; override columns are PATCHed separately).
  - New `setMatrixAdminHostSideBase(hostSideBase: string | null): Promise<boolean>`
    exported — copy-mirrors `setMatrixAdminServerName` exactly (row-existence
    check → UPDATE with updatedAt → `DatabaseSaveTrigger.triggerSave` in try/catch
    with non-fatal warn on failure).
- **`src/backend/matrix/matrix-admin-creds-store.test.ts`**:
  - Extended `MATRIX_ADMIN_CREDS_CREATE_SQL` to include `host_side_base TEXT`.
  - Extended Tests 1, 4, 5 to assert `hostSideBase: null` on default rows.
  - Added **Test 9**: `setMatrixAdminHostSideBase` round-trips through
    `getMatrixAdminCreds`; other fields (including serverName, siblings-
    independent) stay unchanged.
  - Added **Test 10**: null clear behavior.
  - Added **Test 11**: returns false when no singleton row exists.
  - Added **Test 12**: `setMatrixAdminServerName` does NOT clobber a
    previously-set hostSideBase (sibling independence invariant).

### Task 2 — PATCH endpoint + GET extension (commit `7f0545be`)

- **`src/backend/matrix/matrix-admin-routes.ts`**:
  - Extended `matrix-admin-creds-store` import to include `setMatrixAdminHostSideBase`.
  - GET /matrix-admin/creds response now includes `hostSideBase: creds.hostSideBase`
    alongside `mxid`/`homeserverBase`/`serverName`.
  - Added PATCH `/creds/host-side-base` handler (admin-gated):
    - Validates `hostSideBase` is `string | null`.
    - String values must match `^https?://[^\s]+$` (same regex as POST /creds's
      homeserverBase validation).
    - 400 for non-string non-null / empty string / non-http(s) URL.
    - 409 when creds not yet ingested (mirrors server-name PATCH's response
      wording so tooling treats both alike).
    - 500 on unexpected error.
    - Logs `matrix_admin_creds_host_side_base_patch` info (URL not secret).
- **`src/backend/matrix/matrix-admin-routes.test.ts`**:
  - Hoisted `setMatrixAdminHostSideBaseMock` into the vi.hoisted() block
    and wired it into the `matrix-admin-creds-store.js` mock.
  - Extended existing GET tests to include `hostSideBase: null` in default
    payload assertions.
  - Added **two new GET tests**: `surfaces hostSideBase when set` and
    `surfaces hostSideBase:null when the override has not been patched`.
  - Added new **`describe("PATCH /matrix-admin/creds/host-side-base")`** block
    with 10 tests covering 401/403/400×3/409/200×3 (http + https + null clear).

### Task 3 — Wire relayJsonHomeserverBase through birth-orchestrator (commit `0205f171`)

- **`src/backend/database/routes/identity-birth-orchestrator.ts`**:
  - Added `relayJsonHomeserverBase: string` to `BirthDeps` (immediately after
    `matrixServerName`), with jsdoc explaining the split rationale +
    D-OQ7 no-hardcoded-fallback lock.
  - Step 7's `buildRelayJsonBody` call now consumes `deps.relayJsonHomeserverBase`
    instead of `deps.matrixHomeserver`.
  - Step 6's `extractServerName(deps.matrixHomeserver)` call is **unchanged**
    (verified by grep — 1 match, unchanged) — Skynet's admin-API path continues
    to use the container-internal URL.
- **`src/backend/database/routes/identity-birth.ts`**:
  - Primary deps block: added `relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase`
    with inline comment.
  - Retry-route deps block: extended `Pick<BirthDeps, ...>` union with
    `"relayJsonHomeserverBase"`; added the same value.
- **`src/backend/spawn-requests/worker.ts`** (Rule 3 blocking issue — third
  BirthDeps caller not in the plan; tsc broke without it):
  - Added `relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase`
    to the pool-picked worker's BirthDeps assembly.
- **`src/backend/database/routes/identity-birth.test.ts`**:
  - Wrapped `getMatrixAdminCredsMock` in `vi.hoisted()` (hoisting fix — the
    inline module-scope declaration failed vitest's hoisting order).
  - Default mock now returns `serverName: null, hostSideBase: null`.
  - Extended **Test 5** with two assertions: `d.relayJsonHomeserverBase` equals
    `homeserverBase` on the fallback branch, and `d.matrixHomeserver` unchanged.
  - Added **Test 5a**: override branch — hostSideBase set → deps.relayJsonHomeserverBase
    equals hostSideBase, matrixHomeserver unchanged (Skynet admin-API URL
    stays as container-internal).
  - Added **Test 5b**: explicit fallback branch coverage (hostSideBase null
    → both slots equal homeserverBase; single-URL fleet behavior preserved).
- **`src/backend/database/routes/identity-birth-orchestrator.test.ts` +
  `.role-frontmatter.test.ts` + `.mxid-derivation.test.ts`** (Rule 3 blocking
  — makeDeps helpers construct full BirthDeps and require the new field):
  - Extended each `makeDeps` default set to include
    `relayJsonHomeserverBase` matching the local `matrixHomeserver` default
    (fallback-branch semantics preserved for existing tests).

## Test results

All scoped test files run green:

| File | Tests |
|---|---|
| `src/backend/matrix/matrix-admin-creds-store.test.ts` | 12 passed |
| `src/backend/matrix/matrix-admin-routes.test.ts` | 43 passed |
| `src/backend/database/routes/identity-birth.test.ts` | 27 passed |
| `src/backend/database/routes/identity-birth-orchestrator.test.ts` | (verified in Task 3) 46 passed |
| `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` | 24 passed |
| `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` | 22 passed |
| `src/backend/spawn-requests/worker.test.ts` | 25 passed |

Combined final run of the three plan-verification files: **82 passed / 0 failed**.

`npx tsc -p tsconfig.node.json --noEmit`: clean (0 errors).
`npm run build:backend`: clean.

## Deviations from plan

**Rule 3 — auto-fix blocking issues (2 out-of-plan files touched to keep tsc green):**

1. **`src/backend/spawn-requests/worker.ts`** — the plan enumerated three
   BirthDeps consumers (identity-birth.ts primary + retry) but there is a third
   at `spawn-requests/worker.ts:373` for pool-picked worker births. Adding
   `relayJsonHomeserverBase` to BirthDeps made this file fail to compile
   (`Property 'relayJsonHomeserverBase' is missing in type ... but required in
   type 'BirthDeps'`). Applied the same wiring as identity-birth.ts:
   `creds.hostSideBase ?? creds.homeserverBase`. Same fallback discipline
   (single-URL fleets unaffected).

2. **`identity-birth-orchestrator.test.ts` + `.role-frontmatter.test.ts` +
   `.mxid-derivation.test.ts`** — each of these has a `makeDeps` helper that
   constructs a full `BirthDeps` object with static defaults. Adding a required
   field to `BirthDeps` broke type-checking on these makeDeps returns. Extended
   each default set with `relayJsonHomeserverBase` matching the file's local
   `matrixHomeserver` default (fallback-branch semantics — existing behavior
   preserved).

Both changes are pure Rule 3 fixes (blocking tsc errors caused by the plan's
BirthDeps widening); no scope expansion.

**Minor: `vi.hoisted()` wrap in identity-birth.test.ts** — the plan's Step E
described "extend the existing mock's default return to include hostSideBase:
null so existing tests don't break". Initially declared the mock as a
module-scope const above `vi.mock()`, but vitest's mock-hoisting produced a
`ReferenceError: Cannot access 'getMatrixAdminCredsMock' before initialization`.
Wrapped in `vi.hoisted(() => ({...}))` per vitest's documented pattern
(same pattern already used in matrix-admin-routes.test.ts for its mocks).
Behavior identical, just the mock declaration idiom that vitest requires.

## Deferred items

None. All success criteria met, all scoped tests green, tsc + backend build clean.
