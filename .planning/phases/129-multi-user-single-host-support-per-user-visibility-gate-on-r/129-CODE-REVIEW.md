# Phase 129 — Code Review

**Reviewer:** unbiased code-review sub-agent
**Branch:** `feat/tab-title-from-tmux`
**Commit range:** `e054f264^..HEAD` (129-01 → 129-08 + fix commits + close)

## Executive summary

Phase 129 lands a well-shaped visibility gate with a clean pure-function core, disciplined seam placement, and thorough matrix/behavior tests. Overall the design (call-sites-hold-authority, absent-⇒-omit, split fail-open vs fail-closed) is sound and consistent across seams. That said, **one HIGH wire-shape leak** (a role's `users` list surfaces verbatim in every REST response body via `roleDefaults`) undercuts the shape's D-6 "no evidence in the UI" promise for cohabitants; **one HIGH performance risk** (WS identity-gate opens a fresh SSH connection per subscriber per frame with no cache) has the potential to exhaust sshd `MaxSessions` on multi-user hosts under normal load; **one MEDIUM TOCTOU** on the roles-create collision probe survives from before but is now security-relevant. Findings: **2 HIGH, 3 MEDIUM, 3 LOW, 2 NIT.**

---

## Findings by severity

### HIGH-1: `roleDefaults.users` leaks role gate membership on every REST response

**Severity:** HIGH — wire-shape drift; direct violation of shape §"no evidence of it survives anywhere in that user's view."
**File:** `src/backend/fleet-status/identity-appearance.ts:221` (`resolveIdentityAppearance`), consumed by `src/backend/database/routes/identities.ts:258` (`publicIdentity()`), which is the payload for `GET /identities` and the PUT response echo.

**Evidence.** The `RawCosmetics` type was extended with `users?: string[]` (identity-appearance.ts:63). `resolveIdentityAppearance` sets `roleDefaults` to the raw roleCosmetics object verbatim:

```ts
// identity-appearance.ts:217-221
// --- roleDefaults: pass roleCosmetics through verbatim ---
// null  → no role resolvable (identity has no role: frontmatter, or role read failed)
// {}    → role exists but has no cosmetics
// {...} → role's raw cosmetic values (frontend uses for inherit-vs-override display)
const roleDefaults = roleCosmetics;
```

`publicIdentity()` then re-emits it under `roleDefaults` in the response body (identities.ts:258). Because `extractCosmeticsFromFrontmatter` now includes `users` on the returned shape (identity-artifact-reader.ts:3245-3258), every visible identity whose role frontmatter has `users: [ashley, zoe]` will send `{"roleDefaults": {"users": ["ashley", "zoe"], ...}}` to any authenticated caller that can see the identity — including the caller themselves, who then knows exactly which cohabitants share that role. This tells Ashley on a shared host "role X is scoped to me + Zoe" purely from a network trace, and it makes the gate discoverable to any curious user via DevTools even without a UI affordance.

The close-out explicitly asserts under scope-out and D-6 that "users key never leaks into response body" for `roles-list-for-host` (verified true there via the raw/narrowed split). The same discipline was NOT applied for `GET /identities` — the `roleDefaults` pass-through is silently permissive.

Note: `identity-appearance.test.ts:275-281` locks the pass-through shape but was not updated to assert `users` is stripped, so the leak has no regression guard.

**Fix.** In `resolveIdentityAppearance` (identity-appearance.ts:217-221), strip `users` from `roleDefaults` before returning:

```ts
const roleDefaults = roleCosmetics === null
  ? null
  : (() => {
      // Phase 129: strip `users:` gate list from wire projection — the field
      // is gate-only, must not surface in response body (shape §"no evidence
      // in UI"; parallel to roles-list-for-host raw/narrowed split).
      const { users: _users, ...rest } = roleCosmetics;
      return rest;
    })();
```

Simultaneously, extend the corresponding test in `identity-appearance.test.ts:275` to assert `users` is stripped even when present on input. The identity-side `cosmetics.users` is not a wire leak in `publicIdentity()` because none of the returned fields echo `cosmetics.users` — only role-side leaks today.

---

### HIGH-2: WS identity gate opens a fresh SSH connection per subscriber per frame — no cache, unbounded fan-out cost

**Severity:** HIGH — potential SSH `MaxSessions` exhaustion under normal operating load; sidebar can silently freeze mid-typing.
**File:** `src/backend/starter.ts:660-785` (`resolveIdentityGate` closure) + `src/backend/fleet-status/app-frame-filter.ts:242-261` (`canUserSeeIdentity`).

**Evidence.** The production `resolveIdentityGate` closure in `starter.ts` opens a NEW `connectOneShot` per invocation, reads identity + role frontmatter, and closes the connection. There is **no cache** — the comment at starter.ts:652-656 documents that as an intentional A3 lock ("picked up on next read" shape-file promise).

The closure is invoked from `app-frame-filter.ts` per subscriber per frame that carries an identity name. Frame types that trigger the gate:
- `update` (per SessionState change)
- `snapshot` (once per subscriber connect, one gate call per state in the snapshot)
- `gone`, `identity-archived`, `session-project-changed` (per emit)

For a subscriber connecting to a host with N identities, the initial `snapshot` frame triggers **N parallel SSH connects** (via `Promise.all` in app-frame-filter.ts:356-376). With Ashley's driver scenario ("host shared with Zoe") plus, say, 20 identities across two subscribers, that's 40 concurrent SSH connects at subscribe time — right at the sshd default `MaxSessions=10` limit that the rest of the codebase carefully rations via `getHostSemaphore` (identities.ts:380-384, cap 8) and CONVERSATION_SEARCH's `DISCOVERY_CONCURRENCY = 6` (conversation-search.ts:145).

The WS gate:
- does NOT go through the per-host semaphore (`starter.ts:660-785` has no `getHostSemaphore` call);
- does NOT cache the identity's frontmatter read;
- does NOT reuse SSH connections across gate calls in the same fan-out.

Additionally, the `snapshot` frame's Promise.all fans out identity-gate calls in parallel per state (app-frame-filter.ts:356). On any host that has more than ~8 identities, a single subscriber connecting can exhaust sshd's session cap for that host, causing legitimate SSH work (session-file discovery, other identity reads) to queue or fail with connection-refused errors during the subscribe burst.

The close-out flags this as an accepted risk "flagged as a possible follow-up if SSH profiling shows the per-frame cost is prohibitive," but the risk is a first-request smoke test away — not something a code review can wave through.

**Fix.** Two-part:

1. **Route through the per-host semaphore.** In `starter.ts:660-785`'s `resolveIdentityGate`, wrap the `readIdentityFileForGate` + `readRoleFileByNameForGate` reads with `getHostSemaphore(hostIdNum).run(...)` so the WS gate contends against the same 8-slot channel budget the REST fanout uses. Zero-cost mitigation; matches existing discipline.

2. **Add a short-TTL (2-5s) cache on the identity-gate decision.** The shape's "picked up on next read" promise is not violated by a 2s cache — that's less than one poll interval and less than the app-frame-filter's own host-access cache (30s default). Cache key: `${userId}:${hostIdNum}:${identityName}`. Bounded staleness of ≤5s is a rounding error against the shape's user-observable promise and eliminates the subscribe-burst DoS.

If the cache is deferred, at minimum add the semaphore routing so the WS gate participates in the same sshd session budget the rest of the code respects.

---

### MEDIUM-1: `roles-create` collision probe is TOCTOU-vulnerable — concurrent shared-role creates can clobber the auto-tag

**Severity:** MEDIUM — pre-existing bug, but Phase 129 makes it security-relevant (the users tag is now visibility-load-bearing, not just a display color).
**File:** `src/backend/database/routes/roles-create.ts:486-529`.

**Evidence.** The current shape is `probe → mkdir -p → write`:

```ts
// roles-create.ts:488-491
existsStdout = await execWithTimeout(
  conn,
  `if [ -d "$HOME/fleet/roles/${name}" ]; then echo exists; else echo missing; fi`,
);
```

Followed by `mkdir -p "$HOME/fleet/roles/${name}/bounties"` (idempotent, so both racers pass) and finally `writeMarkdownFileAtomic`. Two concurrent POST /roles calls from different users with the same slug on the same multi-user host both see `missing`, both mkdir -p, both write — and whichever writes second clobbers the first user's auto-tag with their own. The identity of the role's original creator (and consequently its visibility gate) is silently overwritten.

Phase 117's `createProject` fixed this exact class of bug via non-`-p` mkdir at `identity-artifact-reader.ts:830-870` and documents the rationale in-line. That fix was NOT ported to roles-create as part of Phase 129.

The shape file's §"what would make it wrong" bullet 3 ("A brand-new identity or role created on a shared host is auto-tagged with the wrong user's name") applies here — a race-loser's file gets the race-winner's users tag.

**Fix.** Port the Phase 117 pattern from `identity-artifact-reader.ts:830-870`:

```ts
// Replace the probe + mkdir -p pair with an atomic non-recursive mkdir
// that fails EEXIST when the folder already exists.
try {
  await execWithTimeout(
    conn,
    `mkdir -p "$HOME/fleet/roles" && mkdir "$HOME/fleet/roles/${name}" && mkdir "$HOME/fleet/roles/${name}/bounties"`,
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("File exists") || msg.toLowerCase().includes("already exists")) {
    res.status(409).json({ error: "role exists on host" });
    return;
  }
  throw err;
}
```

This makes 409 race-safe at the syscall level rather than the probe level.

---

### MEDIUM-2: `getUsernameForUserId` is called on every REST list request with no cache — DB round-trip per request for a rarely-changing value

**Severity:** MEDIUM — performance regression; per-request lookup on identities/sessions/roles-list-for-host/conversation-search that runs on every sidebar poll.
**File:** `src/backend/utils/host-user-counter.ts:140-149` (implementation) + all four Wave-2 call sites (`identities.ts:332`, `sessions.ts:330`, `roles-list-for-host.ts:157`, `conversation-search.ts:689`).

**Evidence.** `getUsernameForUserId` is a `SELECT username FROM users WHERE id = ?` per REST request. Ashley's frontend polls `GET /sessions/list` and `GET /identities` on page load and (based on typical Skynet frontend patterns) refreshes them frequently. A username DB lookup on every request is unnecessary overhead — the caller's userId → username mapping is effectively immutable for the lifetime of a JWT.

The JWT itself carries the userId (auth-manager.ts). Nothing in the JWT carries the username, hence the lookup — but the mapping could be cached (Map<userId, username> with a modest TTL, or even a per-process AsyncLocalStorage cache, or attached to the AuthenticatedRequest object at the auth-middleware level).

Not urgent, but the current shape hits the DB more than necessary.

**Fix.** Add a simple TTL Map cache inside `host-user-counter.ts`:

```ts
const usernameCache = new Map<string, { username: string | null; expiresAt: number }>();
const USERNAME_CACHE_TTL_MS = 60_000;

export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const cached = usernameCache.get(userId);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.username;
  const rows = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  const username = rows[0]?.username ?? null;
  usernameCache.set(userId, { username, expiresAt: Date.now() + USERNAME_CACHE_TTL_MS });
  return username;
}
```

Or, more principled: augment the JWT to carry the username at auth time and read it from `req.username` without a DB hit at all.

---

### MEDIUM-3: `isHostMultiUser` issues 2-4 sequential DB queries per POST /roles and POST /identities/birth — no batching, no cache

**Severity:** MEDIUM — same class as MEDIUM-2 but on write endpoints (lower request volume, so lower urgency).
**File:** `src/backend/utils/host-user-counter.ts:51-128`.

**Evidence.** `isHostMultiUser` runs:
1. `hosts` lookup (owner)
2. `hostAccess` for direct-user shares
3. `hostAccess` for role-scoped shares
4. `userRoles` expansion (if step 3 non-empty)

These are 3-4 round-trips per create request. Steps 2 and 3 hit the same `hostAccess` table with the same WHERE — they could be a single SELECT that returns both userId and roleId columns:

```ts
const shares = await db
  .select({ userId: hostAccess.userId, roleId: hostAccess.roleId })
  .from(hostAccess)
  .where(eq(hostAccess.hostId, hostId));
```

Then partition in JS. Cuts one round-trip per call.

Additionally, on hosts that never gain shares (the vast majority of Skynet's target world per the shape "most Skynet users are one-to-one with a single host"), `isHostMultiUser` will always return false but still costs 2 DB round-trips. A 60s TTL cache on `(hostId → boolean)` would make single-user-host creates one round-trip on cold cache and zero on warm.

**Fix.** Merge queries 2 and 3 into one SELECT. Optionally add a short TTL cache keyed on hostId.

---

### LOW-1: `identity-clone.ts` does NOT auto-tag creator on multi-user hosts — silent scope gap

**Severity:** LOW — documented in the review scope as "untouched by design," but the shape file does NOT actually carve out clone from the auto-tag scope. The shape says "When a role or identity is created through the Skynet app on a host that has more than one Skynet user with access to it, the creator's Skynet username is automatically written."
**File:** `src/backend/database/routes/identity-clone.ts:691-713`.

**Evidence.** The clone flow writes a fresh identity file with `role`, `displayName`, `title`, `colorHue`, `voice`, `avatar`, `task` — no `users` list. Cloning an identity on a multi-user host creates an untagged identity, which under the D-3 fallback is visible to every cohabitant. The shape's mental model is "creating an identity" = "author it in the UI," and clone is clearly that from a user's perspective.

The task briefing calls this "v1 exclusion — verify NOT touched." Recording as LOW because the exclusion is documented in Phase 129's own scope but is out of step with the shape file. Ashley may want to close the loop with a small follow-up.

**Fix.** Add the same isHostMultiUser + getUsernameForUserId branch that identity-birth.ts and roles-create.ts use, and append `users: [creatorUsername]` to `cloneFrontmatterPairs` at identity-clone.ts:713 when the host is multi-user. Test coverage should include one shared-host clone → users:[creator] and one single-user clone → no users key.

---

### LOW-2: `identity-visibility-gate.ts` `null` cosmetic short-circuits treat missing role file as "no gate," may fail-open more permissively than intended

**Severity:** LOW — behavior matches the docblock and tests, but the rationale isn't obvious at the call site.
**File:** `src/backend/fleet-status/identity-visibility-gate.ts:60-72`.

**Evidence.** When `roleCosmetics === null` (e.g., role-file read threw and the caller passed null per fail-open), the gate opens on the role side unconditionally, even if the identity's `users` list happens to exclude the caller (identity-side still applies — so this isn't wrong, just non-obvious). The 10-case matrix Test 10 does cover this ("null cosmetics on either side → treated as 'no gate'"). More of a documentation nit — the gate's null-side semantics might benefit from a comment at each caller explaining what null-role-cos means in that specific context (silent read failure vs. no role at all).

**Fix.** No code change required. Consider adding a one-liner at each call site pointing to the D-3 fallback and null-side semantics so future maintainers don't second-guess.

---

### LOW-3: WS identity-gate resolves username per-frame — no cache even on the hot subscriber

**Severity:** LOW — subsumed by HIGH-2 fix; noted here so the fix scope stays complete.
**File:** `src/backend/starter.ts:685`.

**Evidence.** `resolveIdentityGate` calls `getUsernameForUserIdForGate(userId)` on every frame. Same userId across every gate call for a given subscriber. If MEDIUM-2's cache lands, this becomes free; if not, it stays hot. Recording as LOW because it's per-request DB work that would trivially cache.

**Fix.** Covered by MEDIUM-2's Map cache.

---

### NIT-1: `host-user-counter.ts` has dead `isNotNull` import guarded by `void isNotNull;`

**Severity:** NIT.
**File:** `src/backend/utils/host-user-counter.ts:44, 155`.

**Evidence.** `isNotNull` is imported and then discarded via `void isNotNull;` with a docblock explanation. This is a tell that the import was kept for future use, but it's dead code today. Either remove the import (add it back when a caller materializes) or actually use it in the SELECT WHEREs (e.g., `and(eq(hostAccess.hostId, hostId), isNotNull(hostAccess.userId))`) so the DB filter runs there instead of the JS filter.

**Fix.** Remove `isNotNull` from the import block and drop the `void isNotNull;` line. Add it back if a caller ever needs it.

---

### NIT-2: `identity-artifact-reader.users.test.ts` Test 8 label misleading ("preserves inner whitespace-flanked names")

**Severity:** NIT — actual test asserts the OPPOSITE of what the title says.
**File:** `src/backend/claude-session/identity-artifact-reader.users.test.ts:71-77`.

**Evidence.** The test title says "whitespace-only + trim preserves inner whitespace-flanked names" but the assertion is `expect(result.users).toEqual(["ashley"])` — the value `'  ashley  '` is being trimmed. That's correct behavior; the title is just wrong ("preserves inner whitespace" implies internal spaces would survive, but the test doesn't cover interior spaces at all — it covers boundary trim).

**Fix.** Rename the test to "trims boundary whitespace on entries; interior whitespace is not exercised."

---

## What looked good

- **Pure-function core.** `isIdentityVisibleToUser` has zero DB / SSH / logger imports; the 10-case matrix locks the truth table and case-sensitivity semantic (Pitfall 7); the "null caller = gate disabled" bypass is documented and tested. Very clean seam.
- **Explicit fail-open vs fail-closed split.** The rationale is captured in-line at every gate seam (identities.ts:322-332, conversation-search.ts:418-451, app-frame-filter.ts:230-241), and the search's `=== true` filter shape is called out as "do NOT drift to !== false." That's exactly the kind of comment that survives future refactors.
- **Raw/narrowed split in roles-list-for-host.** The `rawCosByName` (gate input) / `cosByName` (response payload) split is the correct pattern to prevent `users:` from leaking on that endpoint — and it's the pattern that HIGH-1 would benefit from copying into `identity-appearance.ts`.
- **Absent-⇒-omit throughout.** `extractCosmeticsFromFrontmatter` drops empty `users:` lists rather than emitting them; `buildIdentityFileBody` only pushes the `users` pair when `creatorUsername` is a non-empty string; the writer never emits `users: []` or `users: null`. This preserves the zero-migration invariant end-to-end.
- **TOCTOU-safe non-recursive mkdir on Phase 117 createProject** is a good template — see MEDIUM-1 fix.
- **`resolveIdentityAppearance` cascade authority preserved.** Adding the gate as a companion function, keeping `identity-appearance.ts` free of caller-username plumbing, and letting each call site invoke `isIdentityVisibleToUser` explicitly is exactly the right shape for grep-based auditability.
- **`app-frame-filter.ts` Test J** (host gate short-circuits identity gate) prevents an efficiency regression from silently landing.
- **Case preservation end-to-end.** No `.toLowerCase()` at any seam — read, write, gate compare all case-sensitive. Locked by tests.

---

## Overall verdict

**needs-fixes-before-deploy** — HIGH-1 (`roleDefaults.users` wire leak) directly contradicts the shape's core "no evidence of it survives anywhere in that user's view" promise and lands on every REST response body today. HIGH-2 (WS SSH DoS) is a first-request smoke-test away from a visible production regression on Ashley's own driver host and needs at least the semaphore fix before this is safe to run under normal load.

Ship order recommendation:
1. Fix HIGH-1 (5-line change in `identity-appearance.ts` + test update).
2. Fix HIGH-2 by routing WS gate SSH through `getHostSemaphore` and adding a 2-5s TTL cache on the gate decision.
3. Land MEDIUM-1 (TOCTOU) as an atomic-mkdir port of the Phase 117 fix.
4. MEDIUM-2/3 and LOWs can follow as a cleanup pass — none block deploy on their own.

Once HIGH-1 and HIGH-2 are addressed, the design is otherwise deploy-ready; the plan-level testing and seam discipline are strong and the follow-up backlog is small.

---

## REVIEW COMPLETE

Severity counts: **2 HIGH, 3 MEDIUM, 3 LOW, 2 NIT.** Blockers before deploy: **HIGH-1 `roleDefaults.users` wire-shape leak** (role membership visible in every REST response body) and **HIGH-2 WS identity-gate SSH DoS** (fresh connectOneShot per subscriber per frame, no semaphore, no cache).

---

## Fixes applied — 2026-09-23 (pixel-box-maintainer-2)

Four review findings landed as atomic commits on `feat/tab-title-from-tmux`. Scoped `npx vitest related --run` green after each commit; `npm run build:backend` + `npm run build` both exit 0 after the fourth commit (no cross-boundary regression).

| # | Finding    | Commit     | Status | Summary                                                                                                                                          |
| - | ---------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | HIGH-1     | `1f02e4e2` | ✓      | `resolveIdentityAppearance` strips `users:` from `roleDefaults` before it lands on the wire; regression test locks the strip + spot-check shape. |
| 2 | HIGH-2     | `35326be8` | ✓      | WS identity-gate SSH now routed through `getHostSemaphore(hostIdNum).run(...)`; local-host bypass preserved. NO cache added — A3 lock intact.    |
| 3 | MEDIUM-1   | `1e70d6d9` | ✓      | `roles-create` collision probe replaced with atomic non-recursive `mkdir` chain (ported from Phase 117 `createProject`); R-5 + Test E updated, new R-5b locks EEXIST vs. 502 split. |
| 4 | LOW-1      | `442ab964` | ✓      | `identity-clone` now auto-tags creator on multi-user hosts via `isHostMultiUser` + `getUsernameForUserId` (mirrors identity-birth); 4 new tests cover single-user, multi-user, and both fail-open branches. |

**Deferred (not in this pass):**

- **MEDIUM-2** (`getUsernameForUserId` per-request DB cache) — noted for a follow-up cleanup pass; low urgency.
- **MEDIUM-3** (`isHostMultiUser` query batching + optional TTL cache) — same follow-up bucket.
- **LOW-2** (docblock nit on `identity-visibility-gate.ts` null-side semantics) — no code change required.
- **LOW-3** (WS per-frame `getUsernameForUserId` cache) — subsumed by MEDIUM-2's cache when it lands.
- **NIT-1** (`void isNotNull` dead-import trick in `host-user-counter.ts`) — cleanup pass.
- **NIT-2** (misleading test title in `identity-artifact-reader.users.test.ts`) — cleanup pass.

Both HIGH-severity blockers are cleared. MEDIUM-1 (TOCTOU on shared-slug role creation, now security-relevant per the `users:` tag being visibility-load-bearing) is closed. LOW-1 closes the shape-gap that made the clone flow inconsistent with birth/roles-create auto-tag semantics.
