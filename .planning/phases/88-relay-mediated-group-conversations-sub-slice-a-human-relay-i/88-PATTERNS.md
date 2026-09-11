# Phase 88: relay-mediated-group-conversations-sub-slice-a-human-relay-i — Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 10 (2 new, 8 modified)
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/backend/matrix/username-to-mxid.ts` | pure helper / utility | transform | `src/backend/database/routes/identity-birth-orchestrator.ts` (lines 459-478) | role-match (same domain: mxid construction + password gen) |
| `src/backend/matrix/matrix-admin-client.ts` | admin-client primitive | request-response | Self (existing primitives at lines 245-283 `makeRoomAdmin`) | exact (same file, add sibling primitive) |
| `src/backend/database/routes/users.ts` (POST /users/create) | route handler | CRUD | Self (lines 90-289 existing create flow) | exact (extend same handler) |
| `src/backend/database/routes/users.ts` (DELETE /users/delete-account) | route handler | CRUD | Self (lines 2279-2366 existing delete flow) | exact (extend same handler) |
| `src/backend/database/routes/delete-user-data.ts` | service helper | CRUD | Self (lines 88-109 existing avatar-unlink-before-row-delete pattern) | exact (extend same helper) |
| `src/backend/database/db/schema.ts` | schema / config | — | Self (lines 35-40 and 694-697 — comment-only update) | exact |
| `src/backend/matrix/username-to-mxid.test.ts` | test suite (unit) | — | `src/backend/matrix/matrix-admin-client.test.ts` (lines 99-221 `describe("createOrUpdateUser")`) | exact (same directory, same vi.stubGlobal-free pure-function pattern) |
| `src/backend/matrix/matrix-admin-client.test.ts` | test suite (unit) | request-response | Self (lines 315-339 `describe("makeRoomAdmin")`) | exact (add sibling describe block) |
| `src/backend/database/routes/users.test.ts` | test suite (integration) | CRUD | Self (lines 300-360 mock section; lines 633-714 describe block) | exact (extend existing describe blocks + add vi.mock) |
| `src/backend/database/routes/delete-user-data.test.ts` | test suite (unit) | CRUD | Self (lines 297-441 existing describe block) | exact (add cases to existing describe) |

---

## Pattern Assignments

---

### `src/backend/matrix/username-to-mxid.ts` (pure helper, transform)

**Analog:** `src/backend/database/routes/identity-birth-orchestrator.ts` lines 455-478

**Imports pattern** — mirror the crypto import from identity-birth-orchestrator:
```typescript
// identity-birth-orchestrator.ts (implied — randomBytes is imported at top of that file)
import { randomBytes } from "node:crypto";
```
For the sanitizer module itself no external imports are needed beyond `node:crypto` for the password generator function (if co-located here) and the local `getMatrixAdminCreds` is NOT imported here — this is a pure transform module.

**Core helper pattern** (identity-birth-orchestrator.ts lines 459-478):
```typescript
// Lines 459-461: password generation
function generateAgentPassword(): string {
  return randomBytes(24).toString("hex");
}

// Lines 470-478: extractServerName (private there; duplicate here)
function extractServerName(homeserverBase: string): string {
  // Strip scheme prefix if present (http:// or https://)
  let s = homeserverBase.replace(/^https?:\/\//, "");
  // Strip trailing slash and any path
  s = s.split("/")[0];
  // Strip port suffix
  s = s.split(":")[0];
  return s;
}
```

**What differs for username-to-mxid.ts:**
- Exports `sanitizeUsernameToLocalpart(username: string): string` — the bijective escape table (D-07): apply `_` → `__` FIRST, then `@` → `_at_`, `.` → `_dot_`. Also lowercase the input first.
- Exports `buildHumanMxid(username: string, serverName: string): string` — `@${sanitizeUsernameToLocalpart(username)}_human:${serverName}`.
- Exports `generateHumanRelayPassword(): string` — verbatim mirror of `generateAgentPassword()` but renamed.
- Optionally exports `extractServerName(homeserverBase: string): string` — duplicated from identity-birth-orchestrator (simpler than re-exporting from a large unrelated module).
- The MXID_RE from `src/backend/matrix/matrix-admin-routes.ts` line 27 (`/^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/`) is the validation gate the output must satisfy; do NOT import it — just document the constraint in a comment.

---

### `src/backend/matrix/matrix-admin-client.ts` — add `deactivateUser` (admin-client primitive, request-response)

**Analog:** `makeRoomAdmin` in the same file, lines 237-283 — this is the closest match because it:
- has no response payload (return type is `{ ok: true }` not `AdminOk<...>`)
- uses `POST` method with a JSON body
- follows the identical 5-step pattern (creds check → URL build → AbortController → fetch → clearTimeout)

**Return type pattern** (lines 233-237):
```typescript
// `AdminOk<Record<string, never>>` collapses to an impossible type under
// strict build settings (Docker build's tsc rejects `{ok:true}` as violating
// Record<string, never>). This primitive has no payload beyond the ok flag —
// just declare that directly.
export type MakeRoomAdminOk = { ok: true };
```
Mirror verbatim: `export type DeactivateUserOk = { ok: true };`

**Core primitive pattern** (lines 245-283):
```typescript
export async function makeRoomAdmin(
  roomIdOrAlias: string,
  userId?: string,
): Promise<MakeRoomAdminOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomIdOrAlias)}/make_room_admin`;
  const body = { user_id: userId ?? creds.userId };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_make_room_admin",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**What differs for `deactivateUser`:**
- URL: `/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}` (POST, not path under rooms/)
- Body: `{ erase: false }` (explicit defensive default per Assumption A3 in RESEARCH.md — prevents accidental history erasure)
- No `userId` override parameter — takes only `mxid: string`
- `operation` label in databaseLogger: `"matrix_admin_deactivate_user"`
- Return type: `DeactivateUserOk = { ok: true }` (no payload)
- Section comment header: `// deactivateUser — POST /_synapse/admin/v1/deactivate/{mxid}`

---

### `src/backend/database/routes/users.ts` — POST /users/create extension (route handler, CRUD)

**Analog:** The same handler, lines 90-289. The extension inserts a new step (3.5) between the uniqueness check (line 144) and the avatar file write (line 156).

**Step insertion anchor pattern** (lines 133-156 — uniqueness check that Step 3.5 follows):
```typescript
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (existing && existing.length > 0) {
      authLogger.warn("Registration failed - username exists", { ... });
      return res.status(409).json({ error: "Username already exists" });
    }

    // ... (Step 3.5 inserts HERE — after uniqueness check, before avatar write)

    // Step 4 (T-85-07, file-then-row ordering): Write avatar file BEFORE the SQL INSERT
    let avatarFilename: string;
    try {
      avatarFilename = await writeUserAvatar(id, req.file.mimetype, req.file.buffer);
    } catch (writeErr) {
      ...
      return res.status(500).json({ error: "avatar write failed" });
    }
```

**Rollback extension pattern** — extend the EXISTING avatar-write failure handler (lines 154-170) to also deactivate:
```typescript
    // Existing avatar-write catch block — extend to also call deactivateUser:
    } catch (writeErr) {
      // [NEW] best-effort deactivation — existing block returns 500 below
      ...
      return res.status(500).json({ error: "avatar write failed" });
    }
```

**SQL INSERT column list** — the raw INSERT at lines 181-202 is the critical gap (RESEARCH Pitfall 1). The column list:
```typescript
    db.$client
      .prepare(
        "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes, avatar_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id, username, password_hash, first ? 1 : 0, 0,
        "", "", "", "", "", "", "", "openid email profile",
        null, 0, null, avatarFilename,
      );
```
Must become: add `mxid` at end of column list, add `?` placeholder, pass `mxid` as last positional arg.

**forceSave pattern** (lines 262-272) — already wired; no change needed:
```typescript
    try {
      await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create");
    } catch (saveError) {
      authLogger.error("Failed to persist user creation to disk", saveError, {
        operation: "user_create_save_failed",
        userId: id,
      });
    }
```

**Import additions needed** — add to existing import block at top of file:
```typescript
import { createOrUpdateUser, deactivateUser } from "../../matrix/matrix-admin-client.js";
import { buildHumanMxid, generateHumanRelayPassword, extractServerName } from "../../matrix/username-to-mxid.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";
```

---

### `src/backend/database/routes/users.ts` — DELETE /users/delete-account extension (route handler, CRUD)

**Analog:** The same handler, lines 2279-2366. The extension inserts deactivation between avatar-unlink and `db.delete(users)`.

**Avatar-unlink-then-row-delete pattern to extend** (lines 2323-2345):
```typescript
    // Phase 85 (D-22) — remove this user's avatar file before deleting the row.
    try {
      const avatarRow = await db.select({ avatarPath: users.avatarPath })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (avatarRow.length > 0) {
        await unlinkUserAvatar(avatarRow[0].avatarPath);
      }
    } catch (unlinkErr) {
      authLogger.warn(
        "[phase-85] avatar unlink failed on delete-account (non-fatal — proceeding with row DELETE)",
        { operation: "delete_account_avatar_unlink_failed", userId, error: unlinkErr },
      );
    }

    await db.delete(users).where(eq(users.id, userId));
```
New deactivation step goes between the end of the `unlinkErr` catch block and the `db.delete(users)` call. The mxid must be fetched in the same `avatarRow` select (add `mxid: users.mxid` to the projection) OR fetched from the already-selected `userRecord` (which comes from `db.select().from(users).where(eq(users.id, userId))` at lines 2289-2293 — `userRecord.mxid` is the cleaner choice since the row is already loaded).

**forceSave is already wired** (lines 2351-2358) — no change:
```typescript
    try {
      await DatabaseSaveTrigger.forceSave("phase-85-user-delete-account");
    } catch (saveError) {
      authLogger.error("Failed to persist delete-account to disk", saveError, { ... });
    }
```

---

### `src/backend/database/routes/delete-user-data.ts` (service helper, CRUD)

**Analog:** Self — the avatar-fetch-before-delete pattern at lines 101-109:
```typescript
    // Phase 85 (D-22) — remove this user's avatar file from disk BEFORE deleting
    // the row. We fetch the pointer first because the row is our source of truth
    // for the filename; deleting the row first would lose the pointer forever.
    const avatarRow = await db.select({ avatarPath: users.avatarPath })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (avatarRow.length > 0) {
      await unlinkUserAvatar(avatarRow[0].avatarPath);
    }

    await db.delete(users).where(eq(users.id, userId));
```
The deactivation insertion point is identical in structure: fetch mxid from `avatarRow` (extend projection to `{ avatarPath: users.avatarPath, mxid: users.mxid }`) or fetch separately, then call `deactivateUser(mxid)` in a best-effort block BEFORE `db.delete(users)`.

**Import additions needed:**
```typescript
import { deactivateUser } from "../../matrix/matrix-admin-client.js";
```

**What differs:**
- No `forceSave` in this helper (caller's responsibility per RESEARCH Q3) — do NOT add one.
- Error handling is best-effort + log + proceed (D-10), not throw (unlike avatar unlink which does throw and surface to caller per the comment at lines 97-100).

---

### `src/backend/database/db/schema.ts` — comment-only update (schema, —)

**Analog:** Self — the two comment blocks:

**Block 1** (lines 35-40, `users.mxid` column comment):
```typescript
  // Phase 75 Plan 01 (Q3 locked decision) — mxid mapping for the Matrix
  // relay. Nullable: only humans with a registered relay account have one,
  // and it's populated via POST /users/:id/mxid (Plan 03) or the one-shot
  // import for Alice/Zoe/Laura. Not a credential; agents' relay identifiers
  // live on-disk in ~/.claude/identities/<name>/relay.json per fleet convention.
  mxid: text("mxid"),
```
Update: replace the body of the comment to reflect Skynet-owned provisioning (minted by Skynet at user-create time via `createOrUpdateUser`, password discarded; the manual `POST /users/:id/mxid` endpoint remains for legacy/admin use; legacy users without `_human` suffix continue to work).

**Block 2** (lines 694-697, `matrix_admin_creds` comment):
```typescript
// This is the ONLY relay credential that lives in Skynet's own storage.
// Agent relay creds live on-disk at ~/.claude/identities/<name>/relay.json
// (fleet convention, Phase 69); human relay creds are owned by the human
// and never stored anywhere in Skynet.
```
Update: replace lines 694-697 to reflect that human relay creds are NOT owned by the human — Skynet mints and discards the password at create time; access tokens come from admin `loginAsUser`; humans never log in to Matrix clients directly.

**What differs:** Comment text only. No DDL, no migration generated.

---

### `src/backend/matrix/username-to-mxid.test.ts` (unit test, —)

**Analog:** `src/backend/matrix/matrix-admin-client.test.ts` — specifically the `describe("buildRelayJsonBody")` block at lines 493-532, which is the closest match because `buildRelayJsonBody` is also a **pure helper with no fetch/creds mocking needed**:

```typescript
// matrix-admin-client.test.ts lines 493-532
describe("buildRelayJsonBody", () => {
  const BUILD_OPTS = {
    mxid: "@bob:thenasty.taild9b663.ts.net",
    password: "bob-pw",
    accessToken: "syt_bob_token",
    homeserverBase: "http://100.113.23.63:8008",
  };

  it("base ends in /_matrix/client/v3 (recv.sh strips this to derive MROOT)", async () => {
    const json = buildRelayJsonBody(BUILD_OPTS);
    const parsed = JSON.parse(json);
    expect(parsed.base.endsWith("/_matrix/client/v3")).toBe(true);
  });

  it("both token and access_token keys are present with the same value", async () => {
    const parsed = JSON.parse(buildRelayJsonBody(BUILD_OPTS));
    expect(parsed.token).toBe("syt_bob_token");
    expect(parsed.access_token).toBe("syt_bob_token");
  });
  ...
});
```

**Test file structure pattern** (matrix-admin-client.test.ts lines 1-45):
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));
vi.mock("../utils/logger.js", () => ({ ... }));

import { ... } from "./matrix-admin-client.js";
```
For `username-to-mxid.test.ts` — NO mocks needed (pure functions). The import section is just:
```typescript
import { describe, it, expect } from "vitest";
import {
  sanitizeUsernameToLocalpart,
  buildHumanMxid,
  generateHumanRelayPassword,
  extractServerName,
} from "./username-to-mxid.js";
```

**What differs — specific test cases to write:**
1. Simple username (`alice`) → localpart `alice_human` (lowercase passthrough)
2. Email username (`alice@example.com`) → `alice_at_example_dot_com_human`
3. Username with literal `_` (`snake_case`) → `snake__case_human` (escape-the-escape)
4. Bijectivity: literal `_at_` in username → `__at__human` (not same as `@` → `_at_`)
5. `buildHumanMxid` output satisfies `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/` (from matrix-admin-routes.ts line 27)
6. `generateHumanRelayPassword()` returns a 48-char hex string (24 bytes × 2 hex digits)
7. `extractServerName("https://matrix.example.com:8448")` → `"matrix.example.com"`
8. `extractServerName("http://100.113.23.63:8008")` → `"100.113.23.63"`

---

### `src/backend/matrix/matrix-admin-client.test.ts` — add `deactivateUser` describe block (unit test, request-response)

**Analog:** `describe("makeRoomAdmin")` at lines 315-339 — the closest match because `makeRoomAdmin` also:
- returns `{ ok: true }` with no payload
- uses POST method

```typescript
// matrix-admin-client.test.ts lines 315-339
describe("makeRoomAdmin", () => {
  it("happy path returns {ok:true}", async () => {
    stubFetchOk(200, {});
    const result = await makeRoomAdmin("!abc:host");
    expect(result.ok).toBe(true);
  });

  it("non-2xx propagates status", async () => {
    stubFetchOk(403, { errcode: "M_FORBIDDEN" });
    const result = await makeRoomAdmin("!abc:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("posts user_id defaulting to creds.userId", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await makeRoomAdmin("!abc:host");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_id).toBe(HAPPY_CREDS.userId);
  });
});
```

**What differs — specific test cases:**
1. Happy path 200 → `{ ok: true }` (no payload to assert beyond `ok`)
2. Non-2xx 403 → `{ ok: false, status: 403, error: "admin_api_non_2xx" }` — no upstream body leak
3. AbortError (timeout) → `{ ok: false, status: 504, error: "admin_api_timeout" }`
4. Network error → `{ ok: false, status: 502, error: "admin_api_proxy_error" }`
5. No creds → `{ ok: false, status: 500, error: "matrix_admin_creds_missing" }`, fetch NOT called
6. mxid is `encodeURIComponent`'d in URL (path-traversal defense — mirror createOrUpdateUser test at lines 203-211)
7. Request body contains `{ erase: false }` — verify defensive default is sent

**Import addition:** `deactivateUser` must be added to the import at line 34-43:
```typescript
import {
  createOrUpdateUser,
  loginAsUser,
  joinRoom,
  makeRoomAdmin,
  listRooms,
  buildRelayJsonBody,
  countUsersMatching,
  getSharedDMRoom,
  deactivateUser,  // NEW
} from "./matrix-admin-client.js";
```

---

### `src/backend/database/routes/users.test.ts` — extend with mint/deactivate coverage (test suite, CRUD)

**Analog:** Self — the existing mock section (lines 300-360) and `describe("POST /users/create")` block (lines 633+) and `describe("DELETE /users/delete-account")` block (lines 1794+).

**Mock addition pattern** (follow lines 330-332 for the new `vi.mock` placement):
```typescript
// Existing at lines 330-332:
vi.mock("./delete-user-data.js", () => ({
  deleteUserAndRelatedData: vi.fn(async () => {}),
}));

// ADD after the block above — new mock for matrix-admin-client:
const mockCreateOrUpdateUser = vi.fn<
  [string, string, string?],
  Promise<{ ok: true; mxid: string; password: string; status: number } | { ok: false; status: number; error: string }>
>();
const mockDeactivateUser = vi.fn<
  [string],
  Promise<{ ok: true } | { ok: false; status: number; error: string }>
>();

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  createOrUpdateUser: (...args: [string, string, string?]) => mockCreateOrUpdateUser(...args),
  deactivateUser: (...args: [string]) => mockDeactivateUser(...args),
}));
```

**beforeEach default mock values** (add to existing beforeEach around lines 674-695):
```typescript
    mockCreateOrUpdateUser.mockClear();
    mockDeactivateUser.mockClear();
    // Happy-path default: mint succeeds
    mockCreateOrUpdateUser.mockResolvedValue({
      ok: true,
      mxid: "@alice_human:thenasty.taild9b663.ts.net",
      password: "test-pw",
      status: 201,
    });
    mockDeactivateUser.mockResolvedValue({ ok: true });
```

**New test cases for POST /users/create describe block:**
- `mint-success: createOrUpdateUser called once, mxid written to users row`
- `mint-failure (Synapse unreachable): returns 500, no users row created, no avatar written`
- `mint-success then avatar-write-failure: deactivateUser called once with the minted mxid`

**New test cases for DELETE /users/delete-account describe block:**
- `mxid present: deactivateUser called before row DELETE`
- `mxid null/absent: deactivateUser NOT called`
- `Synapse unreachable on delete: deactivateUser returns error, log called, row DELETE still runs, returns 200`

**Existing 8 tests that need mock present (no assertion changes):** All 7 `POST /users/create` tests and the 1 `DELETE /users/delete-account` test will require the new `vi.mock("../../matrix/matrix-admin-client.js", ...)` block to be present — they will import correctly once the mock is there and the default `mockResolvedValue` is set in `beforeEach`.

**Also need vi.mock for `getMatrixAdminCreds`** if `users.ts` imports `matrix-admin-creds-store.js` directly (for the `getMatrixAdminCreds()` call to extract `serverName`):
```typescript
vi.mock("../../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(async () => ({
    homeserverBase: "http://100.113.23.63:8008",
    userId: "@skynet-admin:thenasty.taild9b663.ts.net",
    accessToken: "syt_admin_token",
    password: "admin-pw",
  })),
}));
```
(Only needed if `users.ts` imports the creds store directly for `extractServerName`. If users.ts instead calls `getMatrixAdminCreds` internally through `createOrUpdateUser`/`deactivateUser`, this is already covered by the matrix-admin-client mock.)

**Also need vi.mock for `username-to-mxid.js`:**
```typescript
vi.mock("../../matrix/username-to-mxid.js", () => ({
  buildHumanMxid: vi.fn((_username: string, _serverName: string) =>
    "@alice_human:thenasty.taild9b663.ts.net"),
  generateHumanRelayPassword: vi.fn(() => "deadbeef00112233445566778899aabbccddeeff00112233"),
  extractServerName: vi.fn(() => "thenasty.taild9b663.ts.net"),
}));
```

---

### `src/backend/database/routes/user-avatars.integration.test.ts` — mock update (test suite, CRUD)

**Analog:** Self — the existing mock block (lines 79-332). The integration test has a single `it("create → serve → change → serve → delete → verify-clean")` test.

**Update needed:** Add `vi.mock("../../matrix/matrix-admin-client.js", ...)` and `vi.mock("../../matrix/username-to-mxid.js", ...)` to the mock section (around lines 317-332). The DB proxy already includes `mxid` in the schema at line 590 — no change needed there. The mocks follow the exact same pattern as what users.test.ts adds (no assertions on Synapse calls in the integration test; the mocks just need to be present so the import doesn't fail).

```typescript
// Add alongside the other vi.mock blocks at lines 317-332:
vi.mock("../../matrix/matrix-admin-client.js", () => ({
  createOrUpdateUser: vi.fn(async () => ({
    ok: true,
    mxid: "@alice_human:thenasty.taild9b663.ts.net",
    password: "test-pw",
    status: 201,
  })),
  deactivateUser: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../matrix/username-to-mxid.js", () => ({
  buildHumanMxid: vi.fn(() => "@alice_human:thenasty.taild9b663.ts.net"),
  generateHumanRelayPassword: vi.fn(() => "deadbeef00112233445566778899aabbccddeeff00112233"),
  extractServerName: vi.fn(() => "thenasty.taild9b663.ts.net"),
}));
```
Also add `vi.mock("../../matrix/matrix-admin-creds-store.js", ...)` if `users.ts` imports it directly.

The `INSERT INTO users` in `bootstrapUsersTable` (line 637) does NOT need updating — the mxid is set via the test's `createOrUpdateUser` mock + the INSERT column list fix in `users.ts`. The bootstrap schema already has `mxid TEXT` at line 590.

---

### `src/backend/database/routes/delete-user-data.test.ts` — add deactivate-path cases (unit test, CRUD)

**Analog:** Self — existing describe block at lines 297-441. The two new tests mirror the pattern of Test 1 (happy path) and Test 2 (null pointer no-op).

**Mock addition needed** — add to the mock section (around line 224) alongside existing mocks:
```typescript
// In the mock section, add alongside mockUnlinkUserAvatar:
const mockDeactivateUser = vi.fn<[string], Promise<{ ok: true } | { ok: false; status: number; error: string }>>();

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  deactivateUser: (...args: [string]) => mockDeactivateUser(...args),
}));
```

**beforeEach reset** (add to lines 313-316):
```typescript
    mockDeactivateUser.mockClear();
    mockDeactivateUser.mockResolvedValue({ ok: true });
```

**bootstrapUsersTable update** (lines 253-271) — add `mxid TEXT` column to the CREATE TABLE statement so deactivation tests can set a non-null mxid:
```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_oidc INTEGER NOT NULL DEFAULT 0,
      avatar_path TEXT,
      mxid TEXT      -- ADD THIS
    )
  `);
```

**`insertUser` helper update** — add optional `mxid` param:
```typescript
function insertUser(
  db: InstanceType<typeof Database>,
  opts: { id: string; username?: string; avatarPath?: string | null; mxid?: string | null },
): void {
  db.prepare(
    "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, avatar_path, mxid) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(opts.id, opts.username ?? opts.id, "hash", 0, 0, opts.avatarPath ?? null, opts.mxid ?? null);
}
```

**New test cases:**
1. `deactivateUser called with mxid when mxid is non-null (before row DELETE)`
2. `deactivateUser NOT called when mxid is null`
3. `deactivateUser failure (Synapse unreachable) — logs error, proceeds to delete row anyway`

**Pattern for Test 3** (best-effort mirror of Test 2 null no-op from lines 373-391):
```typescript
it("Synapse deactivation failure proceeds with row delete (D-10 best-effort)", async () => {
  const { deleteUserAndRelatedData } = await import("./delete-user-data.js");

  insertUser(sqliteDb!, { id: "dave_id", avatarPath: null, mxid: "@dave_human:server" });
  mockDeactivateUser.mockResolvedValue({ ok: false, status: 504, error: "admin_api_timeout" });

  // Must NOT throw — best-effort proceeds
  await expect(deleteUserAndRelatedData("dave_id")).resolves.toBeUndefined();

  // deactivateUser was called
  expect(mockDeactivateUser).toHaveBeenCalledWith("@dave_human:server");

  // Row is still deleted despite Synapse failure
  const remaining = sqliteDb!.prepare("SELECT * FROM users WHERE id = ?").all("dave_id");
  expect(remaining).toHaveLength(0);
});
```

---

## Shared Patterns

### Discriminated-union return type (all admin primitives)
**Source:** `src/backend/matrix/matrix-admin-client.ts` lines 41-43
```typescript
type AdminOk<T> = { ok: true } & T;
type AdminErr = { ok: false; status: number; error: string };
```
Apply to: `deactivateUser` (uses `DeactivateUserOk = { ok: true }` variant — not the generic `AdminOk<T>` form per the strict-tsc comment at line 233).

### Error constant pattern (all admin primitives)
**Source:** `src/backend/matrix/matrix-admin-client.ts` lines 30-38
```typescript
const ERR_CREDS_MISSING = "matrix_admin_creds_missing";
const ERR_NON_2XX = "admin_api_non_2xx";
const ERR_TIMEOUT = "admin_api_timeout";
const ERR_PROXY = "admin_api_proxy_error";
```
Apply to: `deactivateUser` — reuses all four constants (already module-scoped, no new declarations needed).

### AbortController + clearTimeout in both branches
**Source:** `src/backend/matrix/matrix-admin-client.ts` lines 86-111 (createOrUpdateUser)
Apply to: `deactivateUser` — mandatory per the module's invariant list at lines 1-18 (item 4: "wraps in AbortController with REQUEST_TIMEOUT_MS = 30_000" and item 6: "clearTimeout() in both success and error paths").

### Best-effort pattern (delete paths only)
**Source:** RESEARCH.md Pattern 5 — does not yet exist in codebase (first use). The pattern is:
```typescript
const deactivateResult = await deactivateUser(mxid);
if (!deactivateResult.ok) {
  authLogger.warn("Matrix account deactivation failed on user delete (orphaned mxid logged for future sweep)", {
    operation: "delete_account_matrix_deactivate_failed",
    mxid,
    error: deactivateResult.error,
    status: deactivateResult.status,
  });
  // Proceed anyway per D-10
}
```
Apply to: `DELETE /users/delete-account` in `users.ts` and `deleteUserAndRelatedData` in `delete-user-data.ts`. NOT applied to the create-flow rollback (there, deactivation is also best-effort-log but the caller still returns 500 regardless).

### vi.mock pattern for new modules (all extended test files)
**Source:** `src/backend/database/routes/users.test.ts` lines 330-332
```typescript
vi.mock("./delete-user-data.js", () => ({
  deleteUserAndRelatedData: vi.fn(async () => {}),
}));
```
Apply to: Add `vi.mock("../../matrix/matrix-admin-client.js", ...)` and `vi.mock("../../matrix/username-to-mxid.js", ...)` in both `users.test.ts` and `user-avatars.integration.test.ts`. Add `vi.mock("../../matrix/matrix-admin-client.js", ...)` in `delete-user-data.test.ts`.

### vi.stubGlobal fetch pattern (matrix-admin-client.test.ts)
**Source:** `src/backend/matrix/matrix-admin-client.test.ts` lines 68-87
```typescript
function stubFetchOk(status: number, body: unknown): void {
  const mock = vi.fn(async () => mockFetchResponse(status, body));
  vi.stubGlobal("fetch", mock);
}
function stubFetchAbort(): void {
  const mock = vi.fn(async () => {
    throw new DOMException("The user aborted a request.", "AbortError");
  });
  vi.stubGlobal("fetch", mock);
}
function stubFetchNetworkError(): void {
  const mock = vi.fn(async () => { throw new TypeError("network dropped"); });
  vi.stubGlobal("fetch", mock);
}
```
Apply to: `describe("deactivateUser")` in `matrix-admin-client.test.ts` — reuse these helper functions (already in scope, no new declarations needed).

---

## No Analog Found

None — all 10 files have close analogs in the codebase. The sanitizer (`username-to-mxid.ts`) has a role-match analog; `deactivateUser` has an exact structural analog (`makeRoomAdmin`); all test extensions have direct analogs in the same file.

---

## Metadata

**Analog search scope:** `src/backend/matrix/`, `src/backend/database/routes/`, `src/backend/database/db/`
**Files read:** `matrix-admin-client.ts`, `matrix-admin-client.test.ts`, `users.ts` (lines 1-90, 90-289, 2270-2369), `delete-user-data.ts`, `delete-user-data.test.ts`, `users.test.ts` (lines 1-80, 300-360, 620-715, 1790-1869), `user-avatars.integration.test.ts` (lines 1-80, 80-240), `schema.ts` (lines 12-51, 684-718), `identity-birth-orchestrator.ts` (lines 450-478)
**Pattern extraction date:** 2026-09-08
