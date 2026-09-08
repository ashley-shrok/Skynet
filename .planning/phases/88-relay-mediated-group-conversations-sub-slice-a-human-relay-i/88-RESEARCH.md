# Phase 88: relay-mediated-group-conversations-sub-slice-a-human-relay-i — Research

**Researched:** 2026-09-08
**Domain:** Synapse admin API integration, user lifecycle wiring, bijective sanitizer
**Confidence:** HIGH

## Summary

Phase 88 slice A extends two existing routes (POST /users/create and both delete paths) to mint and deactivate Synapse Matrix accounts as a lifecycle side-effect of Skynet user management. All infrastructure already exists: `createOrUpdateUser` in `matrix-admin-client.ts`, `getMatrixAdminCreds` in the creds store, `randomBytes(24).toString("hex")` in identity-birth-orchestrator. The single genuinely new primitive is `deactivateUser` — Synapse's deactivation endpoint is a **separate** `POST /_synapse/admin/v1/deactivate/{mxid}` (not the PUT v2 endpoint), and it does not exist yet in `matrix-admin-client.ts`. The sanitizer helper is also net-new. All test files use Vitest with `vi.stubGlobal("fetch", vi.fn())` for Synapse mocking and a real `better-sqlite3` in-memory DB for row-level assertions — the new tests follow the same pattern.

**Primary recommendation:** Add `deactivateUser` to `matrix-admin-client.ts` first (it's the only new admin primitive), put the sanitizer at `src/backend/matrix/username-to-mxid.ts` (adjacent to client, same naming convention as files in that directory), then extend the three route sites.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- D-01: Skip discovery-first. Promotion is already done (Phase 75). Gap is eager provisioning at create-time + deactivation at delete-time.
- D-02: No backfill code. Existing users hand-migrated by maintainer. Zero sweep code in this slice.
- D-03: Skynet mints the whole account (mxid + Matrix account), not just the association. Existing `POST /users/:id/mxid` admin endpoint is NOT touched.
- D-04: Refuse account creation if Synapse unreachable. Hard dependency on Synapse — mint failure → 500, no user row created.
- D-05: Mint FIRST, then insert (avatar write, row INSERT, encryption setup). Mint failure before any local side effect. Rollback after mint success must deactivate.
- D-06: mxid format `@<sanitized-username>_human:<server_name>`.
- D-07: Bijective escape sanitizer: `_` → `__`, `@` → `_at_`, `.` → `_dot_`, and analogous escapes for other Synapse-rejected localpart chars. Deterministic, collision-free.
- D-08: Skynet-generated password `randomBytes(24).toString("hex")`, discarded immediately after mint returns success.
- D-09: Both delete paths deactivate Synapse account if `users.mxid` is populated.
- D-10: Delete is best-effort — Synapse failure logs with mxid and proceeds with row deletion.
- D-11: Set displayname at mint time (human-friendly form, e.g. title-cased username part before `@`).
- D-12: OIDC-callback path (`registerOIDCUser`) is OUT OF SCOPE.
- D-13: Runtime access-token retrieval is DEFERRED to a later sub-slice.
- D-14: Schema comment on `users.mxid` (lines 35-40) and `matrix_admin_creds` (lines 694-697) get updated to reflect Skynet-owned provisioning.

### Claude's Discretion

- Where the sanitizer helper lives on disk.
- Rollback path structure (extend avatar-unlink-plus-row-delete with deactivate call).
- Which specific test files get new coverage and which existing patterns to follow.
- Whether to introduce a shared `provisionRelayIdentity(userId, username)` helper vs. inline in POST /users/create.

### Deferred Ideas (OUT OF SCOPE)

- OIDC-callback user creation (`registerOIDCUser`).
- Backfill sweep for existing users without mxids.
- Runtime access-token retrieval path.
- Cleanup sweep for orphaned Matrix accounts.
- Regenerate-token / view-mxid / unlink-and-re-provision user-facing settings.
- Rename of Skynet usernames.
- Human ability to log into Element as themselves.
</user_constraints>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mint Synapse account at user-create | API / Backend (users.ts POST /create) | Matrix admin API (Synapse) | Pure backend side-effect; no user-facing response carries Synapse data |
| Deactivate Synapse account at user-delete | API / Backend (users.ts DELETE + delete-user-data.ts) | Matrix admin API (Synapse) | Same tier as the route it extends; best-effort means no user-facing Synapse error |
| Username → mxid sanitizer | API / Backend (pure helper module) | — | Pure function; no I/O; tested in isolation |
| deactivateUser primitive | API / Backend (matrix-admin-client.ts) | — | All admin primitives live here; follows discriminated-union pattern |
| Schema comment cleanup | Database / Storage (schema.ts) | — | Comment-only; no migration impact |

## Standard Stack

All libraries are already in the project. No new installs.

### Core (already present)
| Module | Location | Purpose |
|--------|----------|---------|
| `matrix-admin-client.ts` | `src/backend/matrix/` | Synapse admin API wrapper; `createOrUpdateUser` is the mint primitive |
| `matrix-admin-creds-store.ts` | `src/backend/matrix/` | `getMatrixAdminCreds()` resolves encrypted admin creds |
| `node:crypto` `randomBytes` | Node built-in | Password generation: `randomBytes(24).toString("hex")` |
| `DatabaseSaveTrigger.forceSave` | `src/backend/database/db/index.js` | In-memory SQLite crown-jewel invariant |
| `better-sqlite3` | dev dependency | In-memory DB for tests |
| `vitest` | dev dependency | Test runner; `vi.stubGlobal("fetch", vi.fn())` pattern for Synapse mocking |

## Package Legitimacy Audit

No new packages are installed in this phase.

## Architecture Patterns

### System Architecture Diagram

```
POST /users/create
  │
  ├─ Step 0: registration-allowed check
  ├─ Step 1: avatar mandatoriness (D-07 Phase 85)
  ├─ Step 2: username/password validation
  ├─ Step 3: username uniqueness check
  ├─ [NEW] Step 3.5: sanitize username → localpart; build mxid; generatePassword(); createOrUpdateUser(mxid, pw, displayname)
  │           └─ FAIL → 500, no local side effects (abort before avatar write)
  ├─ Step 4: avatar file write
  │           └─ FAIL → deactivateUser(mxid) [best-effort log]; return 500
  ├─ Step 5: row INSERT (sets mxid column)
  │           └─ FAIL → unlinkAvatar; deactivateUser(mxid) [best-effort log]; return 500
  ├─ Step 6: default role assignment
  ├─ Step 7: authManager.registerUser (encryption setup)
  │           └─ FAIL → unlinkAvatar; db.delete row; deactivateUser(mxid) [best-effort log]; return 500
  └─ Step 8: DatabaseSaveTrigger.forceSave("phase-88-user-create")

DELETE /users/delete-account
  │
  ├─ auth, password check, last-admin guard
  ├─ avatar unlink (Phase 85)
  ├─ [NEW] if mxid: deactivateUser(mxid) [best-effort: log failure, proceed]
  ├─ db.delete users row
  └─ DatabaseSaveTrigger.forceSave("phase-85-user-delete-account") [already wired]

deleteUserAndRelatedData(userId)
  │
  ├─ delete related data rows ...
  ├─ avatar unlink (Phase 85)
  ├─ [NEW] if mxid: deactivateUser(mxid) [best-effort: log failure, proceed]
  └─ db.delete users row
     [NOTE: no forceSave here — caller is responsible or it's fire-and-forget]
```

### Recommended Project Structure

New files:
```
src/backend/matrix/
├─ username-to-mxid.ts          # NEW — pure bijective sanitizer + mxid builder
├─ username-to-mxid.test.ts     # NEW — unit tests for sanitizer
├─ matrix-admin-client.ts       # EXTEND — add deactivateUser primitive
├─ matrix-admin-client.test.ts  # EXTEND — new describe block for deactivateUser
```

Modified files:
```
src/backend/database/routes/users.ts           # EXTEND — mint in /create, deactivate in /delete-account
src/backend/database/routes/delete-user-data.ts  # EXTEND — deactivate before row DELETE
src/backend/database/routes/users.test.ts      # EXTEND — new tests for mint/deactivate paths
src/backend/database/db/schema.ts              # EXTEND — update 2 comments only
```

### Pattern 1: deactivateUser primitive (NEW)

**What:** `POST /_synapse/admin/v1/deactivate/{mxid}` — Synapse-official deactivation endpoint. Body: `{}` (erase defaults to false, which preserves room history). Returns 200 on success.

**When to use:** Best-effort before any Skynet-side user-row DELETE where `users.mxid` is non-null.

```typescript
// Source: Synapse admin API docs (element-hq.github.io/synapse/latest/admin_api/user_admin_api.html)
// Pattern matches existing primitives in matrix-admin-client.ts exactly.
export type DeactivateUserOk = { ok: true };

export async function deactivateUser(mxid: string): Promise<DeactivateUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }
  const url = `${creds.homeserverBase}/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    return { ok: true };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_deactivate_user" });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**CRITICAL:** Return type is `{ ok: true }` (not `AdminOk<Record<string, never>>`) — the existing `MakeRoomAdminOk = { ok: true }` pattern in the file proves this is the right approach when there's no payload. [VERIFIED: matrix-admin-client.ts line 237]

### Pattern 2: password generation (existing, mirror exactly)

```typescript
// Source: src/backend/database/routes/identity-birth-orchestrator.ts line 460
// [VERIFIED: codebase grep]
function generateHumanRelayPassword(): string {
  return randomBytes(24).toString("hex"); // 48-char hex, 96 bits entropy
}
```

Note: identity-birth-orchestrator uses `.toString("hex")` not `.toString("base64")`. The CONTEXT.md said "base64 or similar" but the actual codebase uses hex. Mirror hex. [VERIFIED: codebase]

### Pattern 3: bijective sanitizer

```typescript
// Source: CONTEXT.md D-07 (locked decision)
// Escape table — bijective: the escape char `_` is itself escaped first
// so `_at_` in input cannot collide with the `@` → `_at_` escape.
const ESCAPE_TABLE: [RegExp, string][] = [
  [/_/g,  "__"],    // MUST be first — escape the escape character itself
  [/@/g,  "_at_"],
  [/\./g, "_dot_"],
  // Add analogous escapes for any other char outside [a-z0-9._=/+-]:
  // Synapse localpart grammar: [a-z0-9._=/+-]
  // Skynet usernames may be uppercase — lowercase everything first.
];

export function sanitizeUsernameToLocalpart(username: string): string {
  let s = username.toLowerCase();
  for (const [pattern, replacement] of ESCAPE_TABLE) {
    s = s.replace(pattern, replacement);
  }
  // Append _human suffix AFTER escaping (suffix uses _ which is already escaped)
  // Wait — suffix is appended by the caller building the mxid, not here.
  return s;
}

export function buildHumanMxid(username: string, serverName: string): string {
  return `@${sanitizeUsernameToLocalpart(username)}_human:${serverName}`;
}
```

**MXID_RE validation gate:** `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/` (matrix-admin-routes.ts line 27). The sanitizer's output must always satisfy this on the localpart segment. Test with email input `ashley@aitherhealth.com` → `@ashley_at_aitherhealth_dot_com_human:<server>`. [VERIFIED: codebase, matrix-admin-routes.ts line 27]

**Bijectivity proof obligation:** Test suite MUST include a round-trip property test (or at minimum explicit test that `__`, `_at_`, `_dot_` in a raw username survive without collision). The escape-the-escape-char-first ordering is the proof mechanism.

### Pattern 4: mint-first ordering with post-mint rollback

```typescript
// In POST /users/create — after uniqueness check, before avatar write:
const serverName = extractServerName(creds.homeserverBase); // see identity-birth-orchestrator.ts:470
const mxid = buildHumanMxid(username, serverName);
const relayPassword = generateHumanRelayPassword();
const displayname = deriveDisplayname(username); // title-case part before '@'
const mintResult = await createOrUpdateUser(mxid, relayPassword, displayname);
if (mintResult.ok === false) {
  authLogger.error("Matrix account mint failed during user create", { mxid, error: mintResult.error, status: mintResult.status });
  return res.status(500).json({ error: "relay identity provisioning failed" });
}
// relayPassword discarded here — not stored, not logged

// ... existing avatar write ...
// On avatar write failure:
await deactivateUser(mxid); // best-effort log, don't surface deactivation failure to caller
return res.status(500).json({ error: "avatar write failed" });
```

### Pattern 5: best-effort deactivation on delete paths

```typescript
// In DELETE /users/delete-account — before row DELETE, after avatar unlink:
if (userRecord.mxid) {
  const deactivateResult = await deactivateUser(userRecord.mxid);
  if (deactivateResult.ok === false) {
    authLogger.warn("Matrix account deactivation failed on user delete (orphaned mxid logged for future sweep)", {
      operation: "delete_account_matrix_deactivate_failed",
      mxid: userRecord.mxid,
      error: deactivateResult.error,
      status: deactivateResult.status,
    });
    // Proceed anyway per D-10 — refusing to delete Skynet account due to Synapse infra is worse UX
  }
}
// Then: db.delete(users).where(eq(users.id, userId));
```

The same pattern applies verbatim in `deleteUserAndRelatedData` before its `db.delete(users)` call.

### Anti-Patterns to Avoid

- **Deactivation using PUT v2 with `deactivated: true`:** While that field exists on the PUT endpoint, the official deactivation endpoint is `POST /_synapse/admin/v1/deactivate/{mxid}`. The PUT route sets `deactivated: false` explicitly on mint (create) per current `createOrUpdateUser` code — don't confuse the two.
- **Using `_dot_com_human` vs `_dot_com__human`:** The `_human` suffix is appended AFTER escaping; if a username somehow literally contains `_human`, the bijectivity property must still hold (the `_` in `_human` suffix gets escaped as `__human` when the suffix is appended... wait — the suffix is NOT escaped through the sanitizer; it's appended after). This is safe as long as `_human` is concatenated as a literal suffix outside the sanitizer and is not user-controlled input.
- **Logging the relay password:** Never log `relayPassword`. The existing identity-birth-orchestrator uses the same `generateAgentPassword` → pass to createOrUpdateUser → discard pattern; no logging of the value.
- **Missing forceSave after mxid column update:** The mxid column is now SET as part of the row INSERT (inline, not a separate UPDATE), so the existing `forceSave("phase-85-user-avatar-create")` call after the INSERT already covers it. No additional forceSave needed for the mxid field.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Synapse account provisioning | Custom HTTP fetch to `/_synapse/admin/v2/users` | `createOrUpdateUser` in matrix-admin-client.ts | Already handles auth, timeout, discriminated-union error, encodeURIComponent path safety |
| Synapse account deactivation | Inline fetch in users.ts | New `deactivateUser` in matrix-admin-client.ts | Follows established pattern; keeps all admin API calls in one file; reusable for future sub-slices |
| Server-name extraction from homeserver URL | Custom string split | `extractServerName` in identity-birth-orchestrator.ts (lines 470-478) | Pure function, already handles https://, ports, paths. Copy or re-export. |
| Admin creds resolution | Direct env-var read | `getMatrixAdminCreds()` | Handles decryption, null safety, and creds-missing error |

## Key Research Answers (10 questions from brief)

### Q1: Does matrix-admin-client have a `deactivateUser` primitive today?

**No.** [VERIFIED: full file read + grep] The file has six primitives: `createOrUpdateUser`, `loginAsUser`, `joinRoom`, `makeRoomAdmin`, `listRooms`, `countUsersMatching`, plus `buildRelayJsonBody` (pure) and `getSharedDMRoom` (composed). No `deactivateUser`. Must add.

**Synapse endpoint:** `POST /_synapse/admin/v1/deactivate/{mxid}` with body `{}` (erase defaults false). [CITED: element-hq.github.io/synapse/latest/admin_api/user_admin_api.html] Returns 200 on success.

**Suggested return type:** `{ ok: true }` — same as `MakeRoomAdminOk` (line 237) since there is no payload. Do not use `AdminOk<Record<string, never>>` (file comment at line 233 explains why that pattern is rejected by strict tsc).

### Q2: Password generation pattern to mirror exactly

```typescript
// identity-birth-orchestrator.ts line 455-461 [VERIFIED: codebase]
function generateAgentPassword(): string {
  return randomBytes(24).toString("hex");
}
```

Mirror as `generateHumanRelayPassword(): string { return randomBytes(24).toString("hex"); }`. Note: CONTEXT.md said "base64 or similar" but actual code uses hex. Use hex to match codebase convention. [VERIFIED: codebase]

### Q3: Does DELETE /users/delete-account have `DatabaseSaveTrigger.forceSave` wired?

**Yes, already wired.** [VERIFIED: users.ts lines 2351-2358] `DatabaseSaveTrigger.forceSave("phase-85-user-delete-account")` is called after `db.delete(users)`, wrapped in try/catch with log-and-proceed. This was wired by the Phase 87 fixup commit `e2f4e038`. The deactivation call slice A adds goes BEFORE this existing forceSave (deactivate → db.delete row → existing forceSave). No changes needed to the forceSave wiring.

**`deleteUserAndRelatedData` status:** Does NOT have forceSave. That function is called by admin-delete and OIDC-merge paths; callers are responsible for persistence. Slice A does not add forceSave to this helper — it's the existing behavior and out of scope.

### Q4: Test patterns for POST /users/create + DELETE routes

**Existing test files to extend:**

- `src/backend/database/routes/users.test.ts` — contains:
  - `describe("POST /users/create (Phase 85 — multipart with mandatory avatar)")` at line 633 — **extend this describe block** with new `it` cases for mint-success, mint-failure (Synapse unreachable → 500), mint-success-then-avatar-failure (rollback deactivation call).
  - `describe("DELETE /users/delete-account (M5 — forceSave after row deletion)")` at line 1794 — **extend this describe block** with mxid-present deactivation call, mxid-null skips deactivation, Synapse-unreachable on delete logs and proceeds.

**Mock pattern for matrix-admin-client:** The file does NOT yet mock `../matrix/matrix-admin-client.js` (since users.ts doesn't import it today). The plan must add a `vi.mock("../../matrix/matrix-admin-client.js", ...)` block — following the same pattern as the existing `vi.mock("./delete-user-data.js", ...)` at line 330.

**Matrix-admin-client test file to extend:**

- `src/backend/matrix/matrix-admin-client.test.ts` — add a `describe("deactivateUser")` block following the exact pattern of the existing `describe("makeRoomAdmin")` at line 315 (same return type shape, same `vi.stubGlobal("fetch", vi.fn())` approach).

**New test file for sanitizer:**

- `src/backend/matrix/username-to-mxid.test.ts` — pure unit tests, no mocking needed. Cover: simple username, email username, username with literal `_`, username with `@` and `.`, bijectivity edge cases (literal `_at_` in username), empty output guard.

**Test count that will need mock updates:** All 7 existing `POST /users/create` tests will need the new `vi.mock("../../matrix/matrix-admin-client.js")` mock to be present, with `createOrUpdateUser` returning `{ ok: true, mxid, password, status: 201 }` by default for happy paths. The 1 existing `DELETE /users/delete-account` test also needs the mock present. Total: **8 existing tests need the new mock added** (they will still pass without change to their assertions, but the import will fail without the mock).

### Q5: Where does the sanitizer helper naturally live?

`src/backend/matrix/username-to-mxid.ts` — adjacent to `matrix-admin-client.ts`. Rationale:
- All matrix directory files follow `matrix-<noun>.ts` or `<noun>-to-<noun>.ts` naming.
- `extractServerName` in identity-birth-orchestrator.ts is the only comparable pure helper in this domain and it's currently private (unexported). The sanitizer is too specific to users for `src/backend/utils/`; it belongs in `src/backend/matrix/` alongside the admin client it supports.
- Export `sanitizeUsernameToLocalpart`, `buildHumanMxid`, and optionally `extractServerName` (consider re-exporting from this file to consolidate mxid-building helpers in one place). [ASSUMED: naming convention preference; file structure is Claude's discretion per CONTEXT.md]

### Q6: Schema comment update — Drizzle migration behavior?

Schema comment changes (inside the `// comment` text, not structural schema changes) do not affect Drizzle's schema signature. Drizzle diffs only DDL (column types, constraints, table definitions) — TypeScript comments have no presence in the emitted SQL. No migration file will be generated. [ASSUMED: standard Drizzle ORM behavior; not verified against project's drizzle.config.ts but this is standard behavior across all Drizzle versions]

### Q7: Displayname for existing users (legacy mxids)

Legacy users (Ashley, Zoey, Laura) have mxids without the `_human` suffix from the one-shot import. The `createOrUpdateUser` primitive is idempotent and the PUT v2 endpoint updates the `displayname` field on existing accounts. However, slice A only calls `createOrUpdateUser` on NEW user creation, not on existing users — so legacy users' displaynames are not touched. No conflict. [VERIFIED: CONTEXT.md D-02, createOrUpdateUser implementation]

### Q8: Nginx routes — do any new routes need nginx config?

**No.** [VERIFIED: CONTEXT.md scope] Slice A extends existing routes (`POST /users/create` and `DELETE /users/delete-account`) which are already served through nginx. The mint and deactivate calls are internal backend → Synapse admin API calls, not user-facing served paths. `docker/nginx.conf` and `docker/nginx-https.conf` are unchanged.

### Q9: Existing tests that could break

All 7 `POST /users/create` tests will fail with an import error at test startup if `../../matrix/matrix-admin-client.js` is imported by `users.ts` but not mocked. The fix is adding one `vi.mock("../../matrix/matrix-admin-client.js", ...)` block in the test file's mock section (around line 330 where the other mocks are). This mock must expose `createOrUpdateUser: vi.fn()` defaulting to `{ ok: true, mxid: '...', password: '...', status: 201 }` for the happy-path tests to remain green.

The 1 `DELETE /users/delete-account` test similarly needs `deactivateUser: vi.fn()` mocked.

The `delete-user-data.test.ts` tests for `deleteUserAndRelatedData` will need the same mock if that module imports `matrix-admin-client`. Plan must include updating that test file.

**Total tests requiring mock updates (not assertion changes): ~9 existing tests across 2 files.**

### Q10: Rollback path — exact deactivation call sequence when post-mint create-flow step fails

```
mint succeeds → agentPassword discarded
  │
  ├─ avatar write fails:
  │    deactivateUser(mxid) [best-effort: log if fails, do not surface to caller]
  │    return res.status(500).json({ error: "avatar write failed" })
  │
  ├─ SQL INSERT fails:
  │    unlinkUserAvatar(avatarFilename)  [existing]
  │    deactivateUser(mxid) [best-effort]
  │    return res.status(500).json({ error: "user create failed" })
  │
  └─ authManager.registerUser (encryption setup) fails:
       await unlinkUserAvatar(avatarFilename)  [existing]
       await db.delete(users).where(eq(users.id, id))  [existing]
       deactivateUser(mxid) [best-effort]
       return res.status(500).json({ error: "Failed to setup user security..." })
```

Best-effort means: `const deactivateResult = await deactivateUser(mxid); if (!deactivateResult.ok) { authLogger.error("orphaned Matrix account", { mxid, error: deactivateResult.error }); }` — then proceed to the 500 response regardless. The mxid in the log enables future sweep per the deferred cleanup tracker.

## Common Pitfalls

### Pitfall 1: Row INSERT does not include `mxid` column today — must extend the INSERT statement

**What goes wrong:** The existing raw SQLite INSERT at users.ts lines 181-202 is a hardcoded column list that does NOT include `mxid`. A minted mxid not included in the INSERT will silently not be persisted.

**Why it happens:** The column was added in Phase 75 but the hand-rolled INSERT string was never updated (the Drizzle ORM path would auto-include it; the raw `db.$client.prepare("INSERT INTO users ...")` does not).

**How to avoid:** Either (a) add `mxid` to the column list and `?` placeholder in the raw INSERT, passing the minted mxid value, or (b) after the INSERT, run `db.update(users).set({ mxid }).where(eq(users.id, id))`. Option (a) is cleaner. The forceSave after the block already covers this.

**Warning signs:** Test passes but `users.mxid` remains null after create.

### Pitfall 2: Using PUT v2 with `deactivated: true` instead of POST v1/deactivate

**What goes wrong:** `createOrUpdateUser(mxid, somePassword, undefined)` with `deactivated: true` in the body feels like the right approach (we already use that endpoint) but the canonical deactivation endpoint is `POST /_synapse/admin/v1/deactivate/{mxid}`.

**Why it happens:** The PUT v2 endpoint exposes a `deactivated` field, tempting reuse. But `createOrUpdateUser` hardcodes `deactivated: false` in the body — modifying it for deactivation creates a code path that can confuse re-activation semantics. The POST v1/deactivate endpoint performs comprehensive token revocation and device cleanup.

**How to avoid:** New `deactivateUser` primitive uses `POST /_synapse/admin/v1/deactivate/{mxid}`.

### Pitfall 3: Sanitizer bijectivity — escape-the-escape-char ordering

**What goes wrong:** If `@` → `_at_` is applied before `_` → `__`, a username containing `_at_` (literal) becomes `__at__` via the `_` escape, but a username containing `@` followed by `at` with surrounding chars also maps through `@` → `_at_` → then `_` in `_at_` → `__at__`. Collision.

**Why it happens:** Character escape tables are often written in arbitrary order.

**How to avoid:** Always apply `_` → `__` FIRST in the escape table. This ensures that any literal `_` characters in the input are doubled before any other escape sequences (which all begin with `_`) are applied. The resulting escape sequences use `_` which has already been escaped, so no collision is possible.

**Warning signs:** Two distinct usernames produce the same sanitized localpart.

### Pitfall 4: The mxid is written to the DB before deactivation on rollback

**What goes wrong:** If the row INSERT succeeds (writing the mxid) and then encryption setup fails, the rollback deletes the row but must also deactivate the Matrix account. If deactivation is skipped (thinking "the row is gone, so no reference exists"), a phantom Matrix account persists.

**Why it happens:** Rollback focus on "undo what we wrote to our DB" without thinking about the external system.

**How to avoid:** The rollback for encryption failure must deactivate AFTER `db.delete(users)` — the Matrix account outlives the Skynet row unless explicitly deactivated.

### Pitfall 5: `deleteUserAndRelatedData` — mxid must be fetched BEFORE row delete

**What goes wrong:** `deleteUserAndRelatedData` deletes the `users` row. If deactivation is attempted after the row delete, `users.mxid` is gone and there's no mxid to pass to `deactivateUser`.

**Why it happens:** The deactivation call is added after the row delete instead of before.

**How to avoid:** The deactivation call in `deleteUserAndRelatedData` goes IMMEDIATELY before `db.delete(users)` (line 109 of current file). The mxid must be fetched from the row first — pattern matches how `avatarRow` is fetched at line 101 of the same file before deletion.

## Code Examples

### extractServerName (copy from identity-birth-orchestrator, make it exportable)

```typescript
// Source: src/backend/database/routes/identity-birth-orchestrator.ts lines 470-478 [VERIFIED]
function extractServerName(homeserverBase: string): string {
  let s = homeserverBase.replace(/^https?:\/\//, "");
  s = s.split("/")[0];
  s = s.split(":")[0];
  return s;
}
```

This can be duplicated in `username-to-mxid.ts` or re-exported from `identity-birth-orchestrator.ts` (currently unexported/private). Duplication is simpler since identity-birth-orchestrator is a large file with unrelated concerns.

### Mocking matrix-admin-client in users.test.ts

```typescript
// Add to vi.mock section (around line 330 in users.test.ts):
const mockCreateOrUpdateUser = vi.fn<[string, string, string?], Promise<{ ok: true; mxid: string; password: string; status: number } | { ok: false; status: number; error: string }>>();
const mockDeactivateUser = vi.fn<[string], Promise<{ ok: true } | { ok: false; status: number; error: string }>>();

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  createOrUpdateUser: (...args: [string, string, string?]) => mockCreateOrUpdateUser(...args),
  deactivateUser: (...args: [string]) => mockDeactivateUser(...args),
}));

// In beforeEach:
mockCreateOrUpdateUser.mockResolvedValue({ ok: true, mxid: "@alice_human:thenasty.taild9b663.ts.net", password: "test-pw", status: 201 });
mockDeactivateUser.mockResolvedValue({ ok: true });
```

### getMatrixAdminCreds usage for serverName extraction

```typescript
// In users.ts POST /create — after the uniqueness check:
const adminCreds = await getMatrixAdminCreds();
if (!adminCreds) {
  return res.status(500).json({ error: "relay identity provisioning failed: admin creds missing" });
}
const serverName = extractServerName(adminCreds.homeserverBase);
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| mxid populated only via admin manual endpoint or one-shot import | mxid minted by Skynet at user create time | Every new user guaranteed to have mxid |
| No Matrix account deactivation on user delete | Matrix account deactivated (best-effort) on user delete | Prevents mxid namespace squatting after delete |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drizzle comment-only changes don't generate migration files | Q6 / schema comment cleanup | Low — worst case a no-op migration is generated; apply and proceed |
| A2 | `username-to-mxid.ts` naming is the right file location | Q5 / sanitizer location | Negligible — this is Claude's discretion per CONTEXT.md |
| A3 | `deactivateUser` with empty body `{}` and `erase: false` (default) preserves historical room messages | deactivateUser primitive pattern | If wrong, room history is erased — use explicit `{ erase: false }` in body as defensive measure |

## Open Questions

1. **Should `extractServerName` be re-exported from identity-birth-orchestrator.ts or duplicated?**
   - What we know: Currently private/unexported in a large file.
   - What's unclear: Whether the planner wants cross-file imports from that module.
   - Recommendation: Duplicate in `username-to-mxid.ts` (simpler, no cross-file coupling between unrelated modules).

2. **Should the provisioning logic be a shared `provisionRelayIdentity(userId, username, serverName)` helper?**
   - What we know: CONTEXT.md lists this as Claude's discretion.
   - Recommendation: YES — a named helper makes it easier for the future OIDC path to call the same logic. The helper takes `(username, serverName)` → returns `{ ok: true, mxid } | { ok: false, error }`. The route handler wires the result into the create flow.

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Synapse homeserver | deactivateUser, createOrUpdateUser | ✓ (runtime) | Tests mock fetch — no live Synapse needed for test suite |
| `node:crypto` randomBytes | password generation | ✓ | Node built-in |
| `better-sqlite3` | test DB | ✓ | Already in devDependencies |
| `vitest` | test runner | ✓ | Already in devDependencies |

## Security Domain

`security_enforcement: true` in config.json. ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Matrix accounts have no human-held password |
| V3 Session Management | no | No new session tokens in this slice |
| V4 Access Control | yes | Only backend code (not user-facing) can call mint/deactivate; no new endpoints |
| V5 Input Validation | yes | Username → localpart sanitizer must reject/escape all chars outside `[a-z0-9._=/+-]`; MXID_RE validates output |
| V6 Cryptography | yes | `randomBytes(24).toString("hex")` — uses Node built-in CSPRNG, discarded immediately |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via mxid in Synapse URL | Tampering | `encodeURIComponent(mxid)` in deactivateUser (matching createOrUpdateUser line 76 pattern T-75-05) |
| Relay password logged or stored | Information Disclosure | Never log relayPassword; discard immediately after createOrUpdateUser returns ok |
| Sanitizer collision (two usernames same mxid) | Tampering | Bijective escape-the-escape-char-first ordering + uniqueness check at registration time (username already unique in Skynet) |
| Matrix account orphaned after failed rollback | Denial of Service | Log mxid on deactivation failure; manual sweep via log grep |
| Admin creds null on Synapse-unreachable | Spoofing | `getMatrixAdminCreds()` → null → return 500 error code `matrix_admin_creds_missing` |

## Sources

### Primary (HIGH confidence)
- `src/backend/matrix/matrix-admin-client.ts` — full file read; confirmed no `deactivateUser`, confirmed all existing primitives and their return types
- `src/backend/database/routes/users.ts` lines 90-289, 2279-2366 — full create and delete route code
- `src/backend/database/routes/delete-user-data.ts` — full file read; confirmed no forceSave
- `src/backend/database/routes/identity-birth-orchestrator.ts` lines 455-461, 680-774 — password generation pattern, createOrUpdateUser call shape
- `src/backend/matrix/matrix-admin-routes.ts` line 27 — MXID_RE regex
- `src/backend/database/db/schema.ts` lines 12-51, 684-710 — users.mxid column and matrix_admin_creds comment
- `src/backend/database/routes/users.test.ts` — full test file structure; mock patterns; existing describe blocks
- `src/backend/matrix/matrix-admin-client.test.ts` — mock pattern (`vi.stubGlobal("fetch", vi.fn())`, `vi.mock("./matrix-admin-creds-store.js", ...)`)

### Secondary (MEDIUM confidence)
- [element-hq.github.io/synapse/latest/admin_api/user_admin_api.html](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html) — Synapse deactivation endpoint (`POST /_synapse/admin/v1/deactivate/{mxid}`) confirmed as distinct from PUT v2

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from verified codebase reads
- Architecture: HIGH — all routes verified by direct file read
- Pitfalls: HIGH (pitfalls 1-2, 4-5) / MEDIUM (pitfall 3 — sanitizer bijectivity is logical, not empirically tested)
- Synapse deactivation endpoint: MEDIUM — confirmed via official docs WebFetch

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 (Synapse admin API is stable; internal code is frozen until this phase ships)
