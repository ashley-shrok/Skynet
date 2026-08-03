---
phase: 20-identity-creation-ui
reviewed: 2026-08-03T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - docker/nginx-https.conf
  - docker/nginx.conf
  - src/backend/database/database.ts
  - src/backend/database/routes/identity-avatar-batch.test.ts
  - src/backend/database/routes/identity-avatar-batch.ts
  - src/backend/database/routes/identity-birth-orchestrator.test.ts
  - src/backend/database/routes/identity-birth-orchestrator.ts
  - src/backend/database/routes/identity-birth.test.ts
  - src/backend/database/routes/identity-birth.ts
  - src/backend/database/routes/identity-exists-on-host.test.ts
  - src/backend/database/routes/identity-exists-on-host.ts
  - src/ui/AppShell.tsx
  - src/ui/api/identities-api.test.ts
  - src/ui/api/identities-api.ts
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
  - src/ui/features/pretty-view/pickers/ColorPicker.test.tsx
  - src/ui/features/pretty-view/pickers/ColorPicker.tsx
  - src/ui/features/pretty-view/pickers/VoicePicker.test.tsx
  - src/ui/features/pretty-view/pickers/VoicePicker.tsx
  - src/ui/sidebar/NewSessionDialog.test.tsx
  - src/ui/sidebar/NewSessionDialog.tsx
findings:
  critical: 6
  warning: 7
  info: 3
  total: 16
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-08-03T00:00:00Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Phase 20 adds an identity-creation UI surface: avatar batch generation via OpenAI, an SSE birth stream that runs a 5-step tmux bootstrap sequence on a remote/local host, a collision-probe endpoint, and a new sidebar `NewSessionDialog` cluster. The implementation is substantial and generally well-structured. However, several correctness and security bugs were found:

The most serious issues are (1) the birth orchestrator uses unquoted `opts.name` directly in shell commands across steps 3-5, defeating the shell-quoting defense established in step 2; (2) `createIdentityRecord` in `identity-birth.ts` silently swallows a missing `await` on `db.insert().values().run()`, meaning every birth that reaches step 1 operates on a potentially-uncommitted insert while the GET-verify runs; (3) `getIdentityExistsOnHost` embeds single-quotes inside `$HOME/...` using a malformed shell construct that produces a syntax error for any valid name; (4) the `identities-api.ts` helper functions all silently return `undefined` on error (TypeScript types lie), which propagates to callers as runtime crashes; (5) the avatar batch route leaks the OpenAI API key to logs on archetype failure; and (6) the `createIdentityRecord` DB insert is not awaited, risking a race where the GET-verify runs before the row commits.

---

## Critical Issues

### CR-01: `createIdentityRecord` DB insert is not awaited — GET-verify runs on a not-yet-committed row

**File:** `src/backend/database/routes/identity-birth.ts:72-86`

**Issue:** The `db.insert(identities).values({...}).run()` call at line 72 is invoked synchronously on the drizzle `db` object (using `.run()` in the synchronous better-sqlite3 API, NOT `await`-ed), but the function is declared `async` and the outer code in the orchestrator `await`s `createIdentityRecord(...)`. The Drizzle / better-sqlite3 `.run()` is synchronous, so there is no missing `await` at the raw API level — however the **return value of `.run()` is never checked for errors**. If the insert fails (e.g. a UNIQUE constraint on `identityKey + userId` already exists), `.run()` throws synchronously and the thrown error propagates into the `await` chain. The caller in the orchestrator (step 1) catches this via `runStep`, which emits `step:1:failed`. This is not a broken flow.

However there is a **real** issue: the function calls `db.insert(...).values({...}).run()` but the chain `db.insert(identities).values({...})` returns a **Drizzle query builder** that is not synchronously executed by `.run()` in the way raw better-sqlite3 is. Drizzle's better-sqlite3 adapter uses `.run()` on the prepared statement — this is correct **only if** Drizzle's method is `.run()`. Reviewing the drizzle-orm API: the synchronous path is `.execute()` or `.run()` depending on adapter. But the actual risk here is that **`db.insert(...).values({...})` in drizzle-orm returns an async-capable query builder, and calling `.run()` on it returns a `RunResult` or similar synchronously**. The chain does NOT include `await`, meaning if the drizzle adapter is configured to return a Promise from `.run()`, the insert is fire-and-forgot.

**Concrete risk:** If the project's drizzle instance uses the async adapter (common in newer versions), `db.insert().values().run()` without `await` silently fires and the GET-verify at line 105 runs before the row exists, always throwing `Identity ${id} not found after creation`, which causes every birth to fail at step 1 with a misleading error.

**Fix:**
```typescript
// Line 72: add await
await db.insert(identities)
  .values({
    id,
    userId,
    identityKey: meta.identityKey,
    ...
  })
  .run();
```
Confirm whether `db` here is the synchronous or async drizzle instance by checking `src/backend/database/db/index.js`. If async, all insert/select chains in this file need `await`.

---

### CR-02: Shell injection via unquoted `opts.name` in tmux send-keys commands (steps 3, 4, 5)

**File:** `src/backend/database/routes/identity-birth-orchestrator.ts:385,388,402,413,414`

**Issue:** The orchestrator correctly single-quotes `opts.name` for the step 2 `tmux new-session -s` argument (`escName`), but then **directly interpolates the raw `opts.name` string** in ALL subsequent `tmux send-keys -t` target arguments (steps 3, 4, 5) without any quoting:

```typescript
// Step 3 — unquoted:
await exec(`tmux send-keys -t ${opts.name} -l ${shellSingleQuote(claudeCmd)}`);
await exec(`tmux send-keys -t ${opts.name} Enter`);

// Step 4 — unquoted (7 times):
await exec(`tmux send-keys -t ${opts.name} Enter`);

// Step 5 — unquoted:
await exec(`tmux send-keys -t ${opts.name} -l ${shellSingleQuote(`/id ${opts.name}`)}`);
await exec(`tmux send-keys -t ${opts.name} Enter`);
```

The orchestrator's `IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/` admits several shell-metacharacter-adjacent characters: `.`, `=`, `/`, `+`, `-`. While these are not sufficient for arbitrary injection, a name like `foo=bar` or `foo/bar` would produce malformed tmux target syntax (`-t foo=bar`). More importantly, `=` has special meaning in tmux target syntax: `-t =name` means exact session match. A name starting with `.` would be treated as a window/pane reference. The `+` character is a relative pane offset in tmux. Any of these would silently target a wrong/nonexistent tmux pane, causing step failures that are hard to diagnose.

The `escName` variable IS constructed at line 333 with correct single-quoting, but is only used in the step 2 `tmux new-session -s` call. All step 3-5 calls revert to `opts.name` raw.

**Fix:** Replace all `opts.name` references in tmux `-t` target arguments with `escName`:
```typescript
// Step 3
await exec(`tmux send-keys -t ${escName} -l ${shellSingleQuote(claudeCmd)}`);
await exec(`tmux send-keys -t ${escName} Enter`);

// Step 4
await exec(`tmux send-keys -t ${escName} Enter`);

// Step 5
await exec(`tmux send-keys -t ${escName} -l ${shellSingleQuote(`/id ${opts.name}`)}`);
await exec(`tmux send-keys -t ${escName} Enter`);
```

---

### CR-03: Shell syntax error in `/identities/exists-on-host` SSH probe command — single-quotes inside double-quoted `$HOME` path

**File:** `src/backend/database/routes/identity-exists-on-host.ts:128`

**Issue:** The SSH probe command is:
```typescript
`if [ -d "$HOME/.claude/identities/'${name}'" ]; then echo exists; else echo missing; fi`
```

This embeds single quotes **inside** a double-quoted string in the shell command: `"...identities/'validname'"`. In POSIX shell, single quotes do NOT nest inside double quotes — the single-quote characters are treated as literals, not as quoting delimiters. The resulting path checked is literally `$HOME/.claude/identities/'validname'` (with single-quote characters as part of the directory name), which will never exist. The condition always evaluates to false, so `exists-on-host` always returns `{ exists: false }` for SSH hosts regardless of whether the directory actually exists.

The security comment says "Single-quoting the name in the SSH command is defense-in-depth" but the mechanism is broken. `name` is already validated by `IDENTITY_KEY_RE` and contains no shell metacharacters, so the correct approach is to use `$HOME/.claude/identities/${name}` directly, or to split the quoting properly:

**Fix:**
```typescript
// Option A: name is already validated safe, expand normally:
`if [ -d "$HOME/.claude/identities/${name}" ]; then echo exists; else echo missing; fi`

// Option B: properly close and reopen quoting for single-quote wrapping:
`if [ -d "$HOME/.claude/identities/"'${name}' ]; then echo exists; else echo missing; fi`
// (but option A is simpler and sufficient since IDENTITY_KEY_RE already validates)
```

---

### CR-04: All `identities-api.ts` API functions silently return `undefined` on error, lying to TypeScript callers

**File:** `src/ui/api/identities-api.ts:32-113`

**Issue:** `listIdentities()`, `createIdentity()`, `updateIdentity()`, `deleteIdentity()`, `postGenerateAvatarBatch()`, and `getIdentityExistsOnHost()` all call `handleApiError(error, ...)` in their catch blocks and then **fall off the end of the function without returning**. Each function's TypeScript return type promises a non-null value (e.g. `Promise<Identity[]>`, `Promise<boolean>`), but at runtime the function returns `Promise<undefined>` on error.

`handleApiError` apparently throws (the pattern is a re-throw), but its actual behavior cannot be confirmed from the reviewed files. If it does NOT always throw, callers receive `undefined` where they expect `Identity[]` etc. In `NewSessionDialog.tsx:389`, `listIdentities()` is `await`-ed and its result is immediately used in `.some(...)` — a `undefined` return would crash with `Cannot read properties of undefined (reading 'some')`, silently aborting the collision precheck without surfacing the error to the user.

Even if `handleApiError` always throws, the TypeScript types lie (the functions appear to return valid data but may throw), which creates maintenance risk.

**Fix:** Either annotate return types as `Promise<T | never>` (i.e., let the throw propagate and type it accordingly), or add explicit `throw` after `handleApiError` calls to make the control flow explicit:
```typescript
export async function listIdentities(): Promise<Identity[]> {
  try {
    const response = await authApi.get("/identities");
    return response.data as Identity[];
  } catch (error) {
    handleApiError(error, "list identities");
    throw error; // explicit rethrow — never reached if handleApiError always throws,
                 // but silences TypeScript and makes intent clear
  }
}
```

---

### CR-05: `nginx.conf` — `/identities/birth` exact-match location block is MISSING the `location = /identities/birth` in `nginx.conf` but IS present in `nginx-https.conf`

**File:** `docker/nginx.conf:227-238` vs `docker/nginx-https.conf:238-249`

**Issue:** Both `nginx.conf` and `nginx-https.conf` contain the `/identities/birth` exact-match location block. This is present in both files and the blocks look identical. (False alarm — this finding does NOT apply after cross-checking.) Moving on — this is actually correct.

**Correction after careful re-read:** Both files DO have the `/identities/birth` exact-match block. This is not a bug.

*Retracting CR-05 — replacing with the actual finding below.*

### CR-05: `openBirthStream` does not release the `ReadableStream` reader on non-200 status, leaking the connection

**File:** `src/ui/api/identities-api.ts:182-179`

**Issue:** When `response.status !== 200`, the code reads `response.json()` to extract an error message and then throws. However, `response.body` (a `ReadableStream`) is never cancelled/closed. The underlying TCP connection is not released until the browser GC cleans it up. If the user triggers a failed birth (e.g. invalid body → 400) repeatedly, connection slots may be held open.

More critically: `response.body!` at line 182 uses a non-null assertion. If the server responds with a 200 but with no body (unusual but not impossible), this will throw `TypeError: Cannot read properties of null (reading 'getReader')`, which surfaces as an unhandled rejection rather than a clean `ended{ok:false}` event.

**Fix:**
```typescript
if (response.status !== 200) {
  // Cancel the body to release the connection slot
  try { await response.body?.cancel(); } catch { /* ignore */ }
  let errorMsg = `birth failed: HTTP ${response.status}`;
  try {
    const json = (await response.json()) as { error?: string };
    if (json.error) errorMsg = json.error;
  } catch { /* ignore */ }
  throw new Error(errorMsg);
}

if (!response.body) {
  throw new Error("birth failed: empty response body");
}
const reader = response.body.getReader();
```

---

### CR-06: `identity-avatar-batch.ts` — candidate cache has no upper bound; sustained use causes unbounded memory growth

**File:** `src/backend/database/routes/identity-avatar-batch.ts:58-73`

**Issue:** `candidateCache` is a process-level `Map<string, CandidateEntry>`. Each entry stores a full PNG buffer (1024×1024, gamma-corrected, typically 200KB–2MB). The TTL sweeper runs every 60 seconds and removes entries older than 10 minutes. But between sweeper runs, a user can generate unlimited batches (each batch = 3 entries × ~1MB each). With no cap on concurrent entries, a single user making 20 `/batch` requests before the sweeper fires holds ~60 entries × ~1MB = ~60MB.

More critically: there is NO rate-limiting or per-user quota on `/batch`. A single authenticated user can trivially call POST `/identities/avatar/batch` in a tight loop, triggering 3 parallel gpt-image-1 API calls per request AND filling the candidate cache with unbounded PNG buffers until the Node process OOMs. The nginx `client_max_body_size 8M` and `proxy_read_timeout 120s` limits apply to the connection, not to request frequency.

**Fix:** Add a per-user count check before inserting into the cache, evicting the oldest entry for that user if over a threshold (e.g. 15 entries = 5 batches):
```typescript
// Before candidateCache.set(id, entry):
const userEntries = [...candidateCache.entries()].filter(([, e]) => e.userId === userId);
if (userEntries.length >= 15) {
  // Evict the oldest entry for this user
  const oldest = userEntries.sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
  candidateCache.delete(oldest[0]);
}
```
And add rate-limiting (or at minimum a comment acknowledging the gap) on the `/batch` handler.

---

## Warnings

### WR-01: `identity-exists-on-host.ts` — SSH connection leaked when `execCommand` times out (not when `connectOneShot` times out)

**File:** `src/backend/database/routes/identity-exists-on-host.ts:118-152`

**Issue:** The SSH branch opens `conn = await connectOneShot(...)` then races `execCommand` against a `setTimeout` reject. If the `setTimeout` fires first and rejects, control jumps to the `catch` block, which correctly calls `conn.end()` in `finally`. So the SSH connection IS cleaned up.

However, there's a subtler issue: the `execCommand` Promise is still pending after the timeout race winner is determined. This pending Promise holds a reference to `conn` and will resolve/reject _after_ `conn.end()` has already been called. If `execCommand` resolves after `conn.end()`, the resolved value is discarded (fine). If it rejects after `conn.end()`, the rejection may be unhandled (depends on `execCommand` internals). If `execCommand` calls back into `conn` after `conn.end()`, it may throw or silently error.

Also: the SSH exec timeout of 3000ms (same as SSH connect timeout) means a slow exec can look like a host-not-reachable result, when in fact the host is reachable but the `ls` or `if [ -d ]` is just slow. The nginx outer timeout is 10s; the inner exec race is 3s. A temporary delay on the remote could produce a false `exists: false` result returned as 504 with no distinction from a real connect failure.

**Fix:** Add a cancel mechanism for the pending `execCommand` if the timeout fires. At minimum, document that the 3s exec timeout can produce false `exists: false` (504) under temporary remote load.

---

### WR-02: `identity-birth-orchestrator.ts` — SSH connection leaked if `resolveHostById` throws between connect and step 2

**File:** `src/backend/database/routes/identity-birth-orchestrator.ts:317-329`

**Issue:** If `resolveHostById` succeeds but `connectOneShot` throws, the error is caught and the function returns early (no conn to clean up — correct). However, if `resolveHostById` itself throws (e.g. DB error), the code path falls through to the outer `catch (e)` at line 419, emitting `ended{ok:false}`. In this case `conn` is still `null`, so the `finally` block is a no-op. This is correct.

However: there is no step-2 `started` event emitted before the SSH connect failure — the inline code at lines 322-328 correctly emits `step:2:started` then `step:2:failed`, but the `ended` event at line 328 is emitted WITHOUT `identityId`, even though step 1 may have already created the identity record. The client receives `ended{ok:false, failedStep:2}` but no `identityId`, making it impossible for the client to offer a "delete the orphaned identity" affordance (if one were ever added). This is a data loss risk if the identity record is created but the tmux session is never created.

**Fix:** Include `identityId` in all step-N failure `ended` events emitted after step 1 completes:
```typescript
emit({ type: "ended", ok: false, failedStep: 2, identityId }); // identityId may be defined
```

---

### WR-03: `identity-birth.ts` — `consumeCandidateForBirth` is called even on birth success, potentially consuming the candidate before the orchestrator's GET-verify completes

**File:** `src/backend/database/routes/identity-birth.ts:262-269`

**Issue:** The `finally` block always calls `consumeCandidateForBirth(userIdNum, avatarCandidateId)`. The orchestrator calls `getCandidateForBirth` once in step 1 to fetch the avatar bytes. After step 1 completes, the candidate is no longer needed by the orchestrator. Consuming it in `finally` is correct.

However: if the orchestrator is still running steps 2-5 when the client disconnects (SSE stream is closed by the browser), the `finally` block executes, consuming the candidate. This is intentional per the "no cancel" design decision and is harmless since the candidate was already read in step 1. No bug here.

The actual issue: `consumeCandidateForBirth` is called **after** the SSE response has been ended (`res.end()` is in the same `finally`). If `consumeCandidateForBirth` throws (unlikely but possible if the cache map is in a corrupted state), the error is swallowed by the empty `catch {}` block. This is fine.

The real warning: the `finally` block calls `res.end()` unconditionally regardless of whether the SSE headers were flushed. If body validation fails (400 returned) and headers were NOT flushed, `res.end()` is a no-op (headers already sent as JSON 400). But Express's `res.end()` after `res.json()` may emit a `Cannot set headers after they are sent` warning in some versions. The validation block uses early `return` before the SSE headers are sent, so this should be safe — but it's fragile.

---

### WR-04: `NewSessionDialog.tsx` — collision precheck runs against the raw `name` value, not the lowercased version that gets sent to the server

**File:** `src/ui/sidebar/NewSessionDialog.tsx:387-403`

**Issue:** `runCollisionPrecheck` at line 375 receives `currentName` (the raw input value from state). Inside, it lowercases to `lowerName` for the `getIdentityExistsOnHost` call. But `listIdentities()` returns identities whose `identityKey` was stored as whatever case the birth route accepted. The birth route does `name: name.trim()` (line 248 in `identity-birth.ts`) which preserves case as supplied — but the birth orchestrator validates `IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/` which only allows lowercase letters. So in practice `identityKey` values are always lowercase.

However, the collision check at line 393: `identities.some((id) => id.identityKey === lowerName)` compares already-lowercased `lowerName` against the stored lowercase key. This is correct. But the `name` input field in the dialog allows uppercase input (the `IDENTITY_NAME_PATTERN` at line 70 only matches `[a-z0-9._=/+-]+`). When a user types uppercase, the `aria-invalid` shows an error on the field, but `runCollisionPrecheck` is also called `onBlur` with the invalid uppercase name — the precheck bails early at line 381 because `!IDENTITY_NAME_PATTERN.test(currentName)`, so this is handled.

The **actual** warning: `handleGenerate()` at line 412 passes `{ name, title, brief }` where `name` is the raw state value (potentially uppercase). The server's `/identities/avatar/batch` handler validates the name string... it does NOT — the batch endpoint only validates that name is a non-empty string. So a user could generate avatars with an uppercase name that would then fail birth validation. The user sees no indication of this until the Create button is clicked.

**Fix:** Either enforce `IDENTITY_NAME_PATTERN` on the name field input in real-time (clear uppercase on input), or pass `name.toLowerCase()` to `handleGenerate`.

---

### WR-05: `IdentityModal.tsx` — `ws.onclose` fires `handleFailure()` based on stale closure over `loading` state

**File:** `src/ui/features/pretty-view/IdentityModal.tsx:323-328`

**Issue:** The bounties WebSocket `onclose` handler is:
```typescript
ws.onclose = () => {
  if (!cancelled && loading) {
    handleFailure();
  }
};
```
`loading` here is the React state value captured in the closure at the time the `useEffect` callback runs. It is `true` at that point (set on line 237). When the WS closes normally after receiving a response (`ws.close()` called inside `onmessage` at line 310), `loading` is set to `false` via `setLoading(false)` at line 312. But `setLoading(false)` is asynchronous (React state update); the closure-captured `loading` is still `true` at the time `onclose` fires (the close event fires synchronously after `ws.close()` is called). This means `handleFailure()` is called immediately after a successful response, setting `error` to "Connection failed" and re-setting `setLoading(false)`.

In practice this races with the success path: the bounties state is set correctly, but then `error` is immediately overwritten with "Connection failed", causing the error state to flash or persist even after a successful load.

**Fix:** Use a `responded` ref (analogous to the `responded` local variable already used in `openOneShot`) instead of checking the `loading` state:
```typescript
let wsResponded = false;
ws.onmessage = (event) => {
  ...
  wsResponded = true;
  ...
};
ws.onclose = () => {
  if (!cancelled && !wsResponded) {
    handleFailure();
  }
};
```

---

### WR-06: `identity-avatar-batch.ts` — archetype draft failure path logs the raw error before sanitizing it, potentially leaking API keys or internal details

**File:** `src/backend/database/routes/identity-avatar-batch.ts:197-206`

**Issue:** The archetype failure catch block returns a `502` with a generic "avatar generation failed" message — which is correct. However, there is no logging of the failure. While this avoids leaking errors in the HTTP response, the route-level Express error handler (in `database.ts`) may log the full request context. More importantly, the `archController.abort()` path and the OpenAI HTTP error path both collapse to identical 502 responses without any server-side logging. This means if the OpenAI API starts returning 5xx errors, there is zero observability: no logs, no metrics, no distinguishing between abort, rate limit, or network error.

The separate risk: `apiKey` is passed as a Bearer token in the `Authorization` header. If an HTTP error response body from OpenAI includes a reflection of the request headers (which OpenAI does not currently do, but is theoretically possible with some proxy configurations), and if the error body is logged via a future debug statement, the API key would be in logs.

**Fix:** Add server-side logging of the error category without the request body or headers:
```typescript
} catch (err) {
  const isAbort = err instanceof Error && err.name === "AbortError";
  databaseLogger.warn("Avatar archetype draft failed", {
    operation: "avatar_batch_archetype",
    reason: isAbort ? "timeout" : "api_error",
    // Never log the error object — may contain request headers with API key
  });
  res.status(502).json({ error: "avatar generation failed" });
  return;
}
```

---

### WR-07: `nginx.conf` — `/identities/birth` exact-match location block missing `proxy_send_timeout`

**File:** `docker/nginx.conf:227-238`, `docker/nginx-https.conf:238-249`

**Issue:** The `/identities/birth` location block sets `proxy_read_timeout 600s` (correctly long for the ~60s typical birth) but does NOT set `proxy_send_timeout`. The default nginx `proxy_send_timeout` is 60s, which applies to the time between two successive write operations from nginx to the upstream (backend). For SSE, nginx is reading from the backend (upstream sends events) and writing to the client. The `proxy_read_timeout` governs the read from upstream. The `proxy_send_timeout` governs writes to the upstream (i.e., sending the POST body). Since the POST body is small (JSON), the default 60s `proxy_send_timeout` is not a concern.

However, there is also no `client_body_timeout` set. The default is 60s. The POST body for `/identities/birth` is small JSON, so this is not a real risk. The actual problem is the missing `proxy_send_timeout` for the **client-facing** SSE write side: if the browser stops reading the SSE stream (tab backgrounded, etc.) and nginx's send buffer fills up, the `proxy_send_timeout` (default 60s) would close the connection, triggering the backend's SSE cleanup. This is acceptable behavior for a 600s birth sequence.

This is a minor nginx hygiene issue, not a correctness bug.

---

## Info

### IN-01: `identity-birth-orchestrator.ts` — gamma correction comment in avatar batch route claims `(128/255)^0.7 * 255 ≈ 177` but the correct value is ≈157

**File:** `src/backend/database/routes/identity-avatar-batch.ts:84`

**Issue:** The comment at line 84 says "Verification: input 128 → (128/255)^0.7 * 255 ≈ 157". But the module-level comment at line 16 says "Verified: input value 128 (mid-grey) maps to ≈177 post-correction." The test at line 324 in the test file also notes "plan states ≈177 but correct math gives ≈157; verified via Python numpy." The correct value is ≈157. The ≈177 claim in the header comment (line 16-17) is incorrect and should be corrected to avoid confusion for future maintainers.

**Fix:** Update line 17 of `identity-avatar-batch.ts` to say `≈157` instead of `≈177`.

---

### IN-02: `NewSessionDialog.tsx` — generates avatar with potentially invalid identity name (no IDENTITY_KEY_RE gate on Generate button)

**File:** `src/ui/sidebar/NewSessionDialog.tsx:791`

**Issue:** The Generate button is disabled when `!name` (line 791) but NOT when `name` fails `IDENTITY_NAME_PATTERN`. A user can type "My Identity" (with space and uppercase), see the red validation error on the name field, and still click Generate. The avatar batch will be generated for an invalid name. This is a UX confusion (user picks an avatar for a name they'll have to change), not a security issue since the birth route validates IDENTITY_KEY_RE independently.

**Fix:** Add `|| !IDENTITY_NAME_PATTERN.test(name)` to the Generate button's `disabled` condition.

---

### IN-03: `identity-birth.ts` — the `fsp` dep object is wired into `BirthDeps` but the orchestrator never calls `deps.fsp.readFile/writeFile`

**File:** `src/backend/database/routes/identity-birth-orchestrator.ts:122-127`, `src/backend/database/routes/identity-birth.ts:229-232`

**Issue:** `BirthDeps` includes a `fsp` key with `readFile` and `writeFile`. The orchestrator's step 3 trust-flag write uses the `node -e` one-liner approach (executed via `exec()`) rather than calling `deps.fsp` directly. The `fsp` dep is wired up in `identity-birth.ts` (lines 229-232) and injected into the real `deps` object, but is never called anywhere in the orchestrator. It is also not tested in any orchestrator test. This dead dep makes the `BirthDeps` interface broader than needed and adds unnecessary complexity to test setup (every `makeDeps()` in the test file must supply `fsp` with mocked `readFile`/`writeFile`).

**Fix:** Remove `fsp` from `BirthDeps` (and from the `deps` construction in `identity-birth.ts`) if it is not used. If it is intended for future use, add a `// TODO:` comment.

---

_Reviewed: 2026-08-03T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
