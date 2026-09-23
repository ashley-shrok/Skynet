# Phase 129: multi-user-single-host support - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 13 (11 backend modifications + 2 new backend modules; frontend passive-only)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/fleet-status/identity-appearance.ts` (MODIFY) | pure-function lib (merge authority) | transform | self (extend types + delegate gate to companion) | exact-self |
| `src/backend/fleet-status/identity-visibility-gate.ts` (NEW) | pure-function lib | transform | `src/backend/fleet-status/identity-appearance.ts` (sibling pure module, zero DB/express imports) | role-match, sibling |
| `src/backend/utils/host-user-counter.ts` (NEW) | db-utility lib | request-response (single SQL SELECT) | `src/backend/utils/role-name-pattern.ts` (shared util) + `src/backend/ssh/host-resolver.ts` (drizzle SELECT) | role+data-flow match |
| `src/backend/claude-session/identity-artifact-reader.ts` (MODIFY: `extractCosmeticsFromFrontmatter` L3128-3236) | file-I/O + parse utility | transform | self (extend narrowing block for `users?: string[]`) | exact-self |
| `src/backend/database/routes/identities.ts` (MODIFY: GET fanout L294-485) | controller / route | CRUD (read) | self (per-host fanout with `roleReadCache` memo) | exact-self |
| `src/backend/database/routes/sessions.ts` (MODIFY: GET `/list` L294-425) | controller / route | request-response | `src/backend/database/routes/identities.ts` (per-host fanout w/ role read memo) | role+data-flow match |
| `src/backend/database/routes/roles-list-for-host.ts` (MODIFY) | controller / route | request-response | self (already reads cosmetics via `extractCosmeticsFromFrontmatter`) | exact-self |
| `src/backend/database/routes/roles-create.ts` (MODIFY: L541-563 pre-yaml.dump) | controller / route | CRUD (write) | self (frontmatter build via `yaml.dump(stringifyColorHueForYaml(...))`) | exact-self |
| `src/backend/database/routes/identity-birth-orchestrator.ts` (MODIFY: `buildIdentityFileBody` L544-604 + `BirthOptions` L196) | orchestrator (pure, injected deps) | event-driven (SSE emit) + file-I/O | self (`pairs.push(["field", value])` absent-⇒-omit pattern) | exact-self |
| `src/backend/database/routes/identity-birth.ts` (MODIFY: POST handler L94-380) | controller / route | event-driven (SSE) | self (feeds `birthIdentity` orchestrator; validation gates + DB lookups) | exact-self |
| `src/backend/database/routes/conversation-search.ts` (MODIFY: POST L498-628) | controller / route | request-response (per-host fanout + post-filter) | self (per-host fanout mirroring `sessions.ts:319-566`) | exact-self |
| `src/backend/fleet-status/app-frame-filter.ts` (MODIFY: extend frame branches L200-283) | ws-filter (pure with injected deps) | pub-sub (per-subscriber filter) | self (add identity-gate branch alongside `canUserSee` host-gate) | exact-self |
| Tests: `identity-visibility-gate.test.ts` (NEW), extensions to `identity-appearance.test.ts` / `identities.get-disk.test.ts` / `identity-birth-orchestrator.test.ts` / `app-frame-filter.test.ts` | test | request-response / pure | `identity-appearance.test.ts` (pure-fn `makeArgs` fixture builder); `identities.get-disk.test.ts` (bare-Express + `vi.mock` scaffold) | exact fixture reuse |

**No frontend changes required.** `conversation-store.ts` and `NewSessionDialog.tsx` (both variants) naturally render shorter API responses; no code edit.

---

## Pattern Assignments

### `src/backend/fleet-status/identity-appearance.ts` (MODIFY — pure-function merge authority)

**Analog:** self (extend types + delegate gate to companion pure module — Phase 111 T-111-08 single-cascade invariant preserved).

**RawCosmetics extension pattern** (identity-appearance.ts L31-47 — add `users?: string[]` alongside `project?: string`):

```typescript
export type RawCosmetics = {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  task?: string;
  avatar?: string;
  coordinator?: boolean;
  project?: string;
  /**
   * Phase 129: per-user visibility gate — YAML list of Skynet usernames.
   * Empty / absent = "no gate on this side" (fallback rule; zero-migration
   * semantic). Case-sensitive comparison, matching the DB's users.username
   * as-typed storage discipline.
   */
  users?: string[];
};
```

**Signature stability** (identity-appearance.ts L142-149 — DO NOT extend):

```typescript
// The signature stays exactly as it is. The visibility gate lives in a
// companion pure function (isIdentityVisibleToUser) that every caller
// invokes SEPARATELY. This preserves the T-111-08 "one cascade authority"
// invariant AND makes the "did we gate this call site?" audit visible as a
// grep for `isIdentityVisibleToUser(`.
export function resolveIdentityAppearance(args: {
  identityKey: string;
  hostId: number;
  cosmetics: RawCosmetics | null;
  roleCosmetics: RawCosmetics | null;
  role: string | null;
  pinned: boolean;
}): ResolvedIdentityAppearance {
  // unchanged
}
```

---

### `src/backend/fleet-status/identity-visibility-gate.ts` (NEW — pure gate function)

**Analog:** `src/backend/fleet-status/identity-appearance.ts` (sibling pure module — zero imports from `src/backend/database/` or `express`; both route layer and fleet-status can depend on it without cycles; see identity-appearance.ts L9-15).

**File-header discipline pattern** (identity-appearance.ts L1-16):

```typescript
/**
 * identity-visibility-gate.ts — Phase 129 per-user visibility gate on roles + identities.
 *
 * Companion pure function to resolveIdentityAppearance's cosmetics merge.
 * Every caller of resolveIdentityAppearance whose output is user-facing MUST
 * also call this gate on the same (cosmetics, roleCosmetics) and drop null
 * results before surfacing to the frontend.
 *
 * Design constraints:
 *   - Zero imports from `src/backend/database/` — pure function so route
 *     layer and fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — the route layer owns those.
 *   - CASE-SENSITIVE comparison — matches DB users.username storage
 *     (users.ts L172 `eq(users.username, username)`).
 *   - `callerUsername === null` DISABLES the gate (returns true) — used by
 *     internal-server consumers, tests, admin bypass sites if any exist.
 */
```

**Pure-function body pattern** (from RESEARCH § "Intersection gate as a pure function" — verbatim recommendation):

```typescript
import type { RawCosmetics } from "./identity-appearance.js";

export function isIdentityVisibleToUser(
  identityCosmetics: RawCosmetics | null,
  roleCosmetics: RawCosmetics | null,
  callerUsername: string | null,
): boolean {
  if (callerUsername === null) return true;

  const identityUsers = identityCosmetics?.users;
  const roleUsers = roleCosmetics?.users;

  const identityGateOpen =
    !Array.isArray(identityUsers)
    || identityUsers.length === 0
    || identityUsers.includes(callerUsername);
  const roleGateOpen =
    !Array.isArray(roleUsers)
    || roleUsers.length === 0
    || roleUsers.includes(callerUsername);

  return identityGateOpen && roleGateOpen;
}
```

---

### `src/backend/utils/host-user-counter.ts` (NEW — DB utility)

**Analog:** `src/backend/utils/role-name-pattern.ts` (shared util location; MODULE_LOCATION analog) + `src/backend/ssh/host-resolver.ts` (drizzle SELECT usage pattern).

**Imports + `db.select(...)` shape** (from RESEARCH § "Multi-user detection helper" — verbatim recommendation):

```typescript
import { db } from "../database/db/index.js";
import { hosts, hostAccess, users } from "../database/db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Phase 129: returns true iff MORE THAN ONE distinct Skynet user has access
 * to the given hostId. Access = row owner (hosts.userId) OR any user granted
 * via hostAccess.
 *
 * Assumption A1/A6 lock (RESEARCH): naive query counts hostAccess.userId only.
 * If the user+Zoe share via a Skynet RBAC role (hostAccess.roleId non-null,
 * userId null), this query underreports and auto-tag stays silent. Verify at
 * plan-time by reading `permission-manager.ts canAccessHost` — the primitive
 * that Skynet uses as the authoritative host-access check.
 */
export async function isHostMultiUser(hostId: number): Promise<boolean> {
  const shares = await db
    .select({ userId: hostAccess.userId })
    .from(hostAccess)
    .where(eq(hostAccess.hostId, hostId));

  const ownerRow = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);

  if (ownerRow.length === 0) return false;

  const distinctUsers = new Set<string>([ownerRow[0].userId]);
  for (const s of shares) {
    if (s.userId !== null) distinctUsers.add(s.userId);
  }
  return distinctUsers.size > 1;
}

/**
 * Phase 129: DB lookup for the caller's username. userId → username via a
 * single-row SELECT. Needed because JWT gives only userId (auth-manager.ts
 * L949-951 sets `req.userId` but not `req.user.username`); auto-tag write
 * side and gate-comparison read side both need the username string.
 */
export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? null;
}
```

**Schema references** (schema.ts L12 users, L103 hosts, L500 hostAccess — all already exported).

---

### `src/backend/claude-session/identity-artifact-reader.ts` (MODIFY — `extractCosmeticsFromFrontmatter`)

**Analog:** self. The extractor is field-narrowing (README-verified anti-pattern at L428-446 — DO NOT use as round-tripper). Extend the return-type declaration AND the `out` local, AND add a narrowing block near L3232.

**Return-type extension pattern** (identity-artifact-reader.ts L3128-3150 — add after `project?: string`):

```typescript
export function extractCosmeticsFromFrontmatter(markdown: string): {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  avatar?: string;
  coordinator?: boolean;
  task?: string;
  project?: string;
  /**
   * Phase 129: YAML list of Skynet usernames. Absent-⇒-omit — an empty or
   * missing list means "no gate on this side" (visible to everyone with
   * host access). Case-sensitive strings are compared against the caller's
   * username at gate-apply time.
   */
  users?: string[];
} {
```

**Narrowing block pattern** (identity-artifact-reader.ts L3232-3234 — mirror `project` shape at end of function, before `return out`):

```typescript
// Phase 129: users:[username, ...] narrowing — array-of-non-empty-strings.
// Empty array → out.users stays absent (absent-⇒-omit fallback semantic).
if (Array.isArray(src.users)) {
  const normalized = src.users
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (normalized.length > 0) {
    out.users = normalized;
  }
}
```

**Fail-open contract** (identity-artifact-reader.ts L3162-3168 — YAML parse failure returns {}). Do NOT touch this branch; it applies uniformly.

---

### `src/backend/database/routes/identities.ts` (MODIFY — GET / fanout L294-485)

**Analog:** self (already has per-host `roleReadCache` memo + per-key `Promise.all` fanout). Extend the same shape.

**Gate application pattern** (identities.ts L389-450 — inside `identityKeys.map` block, after cosmetics + roleCosmetics extraction, before `publicIdentity` call):

```typescript
// Existing (unchanged):
const cosmetics = extractCosmeticsFromFrontmatter(markdown);
const role = extractRoleFromMarkdown(markdown) ?? null;
const roleCosmetics =
  role !== null
    ? await readRoleCosmeticsMemoized(role)
    : null;

// NEW Phase 129 — gate BEFORE publicIdentity, drop hidden identities:
if (!isIdentityVisibleToUser(cosmetics, roleCosmetics, callerUsername)) {
  return null;  // Collapses cleanly with existing L445 null-return path.
}

return publicIdentity(
  identityKey, hostId, cosmetics, role, roleCosmetics, pinned,
);
```

**Caller-username fetch pattern** (fetch ONCE per request, before the per-host fanout at identities.ts L316):

```typescript
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const callerUsername = await getUsernameForUserId(userId);  // NEW
  // ...existing identityHosts parse + fanout unchanged.
});
```

**Null-filter already exists** (identities.ts L450 — `.filter((x): x is ReturnType<typeof publicIdentity> => x !== null)`). Gate-hidden identities flow through the same null-drop path.

---

### `src/backend/database/routes/sessions.ts` (MODIFY — GET /list L294-425)

**Analog:** `identities.ts` fanout with per-host role memo (same reasoning). Pitfall 3 from RESEARCH is load-bearing: this route reads only `role:` via `resolveRoleForIdentity`; the identity-side users list is NOT in scope today.

**Extend the roleResolveBlock area** (sessions.ts L404-425 — call `readIdentityFile` once for BOTH role name AND identity cosmetics; add role-file read + gate):

```typescript
// Per-request, ONCE, before the per-host fanout:
const callerUsername = await getUsernameForUserId(userId);

// Per-session role-memo (mirror identities.ts L361-386 roleReadCache):
const roleReadCache = new Map<
  string,
  Promise<ReturnType<typeof extractCosmeticsFromFrontmatter>>
>();
const readRoleCosmeticsMemoized = (roleName: string) => { /* same shape */ };

// Inside the per-session Promise.all — replace resolveRoleForIdentity with a
// single readIdentityFile that yields BOTH role AND cosmetics:
const roleResolveBlock = (async () => {
  try {
    const { markdown } = await readIdentityFile(conn, row.sessionName);
    const role = extractRoleFromMarkdown(markdown);
    row.role = role;
    const identityCos = extractCosmeticsFromFrontmatter(markdown);
    const roleCos = role !== null ? await readRoleCosmeticsMemoized(role) : null;
    row._visible = isIdentityVisibleToUser(identityCos, roleCos, callerUsername);
  } catch {
    row.role = null;
    row._visible = true;  // fail-open on read error — matches identities.ts silent-swallow contract
  }
})();

// After Promise.all, filter:
const visible = rows.filter((r) => r._visible);
return visible;
```

**Note:** `_visible` is a transient row field; drop before response emit if the shape matters (or use a parallel Map<sessionName, boolean> and filter without mutation).

---

### `src/backend/database/routes/roles-list-for-host.ts` (MODIFY — GET /)

**Analog:** self (already extracts cosmetics per role via `extractCosmeticsFromFrontmatter` at L249). Extend the loop at L238-259 to filter by `role.users`.

**Filter pattern** (roles-list-for-host.ts L261-266 — before building `result`):

```typescript
// NEW Phase 129 — after the loop that builds cosByName, filter valid roles
// by gate. Fetch caller username once above (mirrors identities.ts pattern).
const callerUsername = await getUsernameForUserId(userId);

// Note: extract users field from raw cosmetics before narrowing to
// RoleCosmetics (which drops it — L251-257 only forwards 5 fields). Store
// users separately, OR change the narrowing to include users.
const gatedRoles = validRoles.filter((name) => {
  const raw = cosByName.get(name);  // NB: adjust narrowing to preserve users
  return isIdentityVisibleToUser(
    /* identityCos */ null,          // identity side is out of scope for role picker
    /* roleCos */ raw ?? null,
    callerUsername,
  );
});

const result = gatedRoles.map((name) => ({ name, description: descByName.get(name) ?? "", ...(cosByName.get(name) ?? {}) }));
```

**Design detail:** The role-picker gate only checks the ROLE side (identity side irrelevant when picking a role at new-identity-creation time). Passing `identityCos: null` to `isIdentityVisibleToUser` reduces the intersection to just the role gate.

---

### `src/backend/database/routes/roles-create.ts` (MODIFY — POST / L541-563)

**Analog:** self (existing `hasCosmetics`-gated `yaml.dump(stringifyColorHueForYaml(...))` at L554-563). Auto-tag inserts BEFORE the dump.

**Pre-yaml.dump auto-tag pattern** (roles-create.ts L541 — before `hasCosmetics` check):

```typescript
// NEW Phase 129 — auto-tag creator on multi-user hosts BEFORE the
// hasCosmetics check (so the dump includes users if we add it).
const isMultiUser = await isHostMultiUser(hostId);
if (isMultiUser) {
  const creatorUsername = await getUsernameForUserId(userId);
  if (creatorUsername) {
    (cosmetics as Record<string, unknown>).users = [creatorUsername];
  } else {
    // Defensive: userId that doesn't map to a users row shouldn't be
    // possible past authenticateJWT — but if it happens, treat like a
    // single-user host (skip auto-tag) and LOG loudly.
    sshLogger.warn("roles-create: userId lookup failed — auto-tag skipped", {
      operation: "roles_create_username_lookup_failed",
      userId, hostId,
    });
  }
}

// Existing hasCosmetics-gated yaml.dump at L551-563 now picks up users
// automatically because it dumps the full cosmetics dict:
const hasCosmetics = Object.keys(cosmetics).length > 0;
const stubMarkdown = hasCosmetics
  ? `---\n${yaml.dump(
      stringifyColorHueForYaml(cosmetics as Record<string, unknown>),
      { sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false },
    )}---\n\n${bodyLines}`
  : bodyLines;
```

**Guard rails from RESEARCH § Pitfall 5:** auto-tag lives ONLY inside the initial-write code path. The collision probe at L472-496 already fires 409 before this code runs; auto-tag never touches an existing file.

---

### `src/backend/database/routes/identity-birth-orchestrator.ts` (MODIFY — `BirthOptions` L196 + `buildIdentityFileBody` L544-604)

**Analog:** self (`pairs.push(["field", value])` absent-⇒-omit at L556-585).

**BirthOptions extension pattern** (identity-birth-orchestrator.ts L196-260 — add after `task?: string` at L223):

```typescript
export interface BirthOptions {
  // ...existing fields...
  task?: string;
  /**
   * Phase 129: when the target host has more than one Skynet user with
   * access, the route handler resolves this to the creator's username
   * and passes it through. On single-user hosts, this field is left
   * undefined — the frontmatter file omits the users: key entirely
   * (fallback rule: no gate on this identity).
   *
   * Route handler MUST NOT pass this through on single-user hosts.
   */
  creatorUsername?: string;
  // ...other existing fields...
}
```

**buildIdentityFileBody extension** (identity-birth-orchestrator.ts L556-585 — add pair after `task` at L583-585):

```typescript
// Phase 80: task (existing, unchanged).
if (typeof opts.task === "string" && opts.task.trim().length > 0) {
  pairs.push(["task", opts.task]);
}

// NEW Phase 129: users list — absent-⇒-omit. Only emitted when the route
// handler passed creatorUsername (multi-user host); yaml.dump handles
// arrays cleanly via the same sortKeys:false, lineWidth:-1 options.
if (typeof opts.creatorUsername === "string" && opts.creatorUsername.length > 0) {
  pairs.push(["users", [opts.creatorUsername]]);
}

// Existing yaml.dump call at L587-595 unchanged — arrays of strings
// serialize as YAML flow-or-block sequences correctly with these options.
```

---

### `src/backend/database/routes/identity-birth.ts` (MODIFY — POST handler L94-380)

**Analog:** self (route handler feeds `birthIdentity` orchestrator with `BirthOptions`).

**Pre-orchestrator DB lookup pattern** (identity-birth.ts L94-380 — after body validation, before `birthIdentity` call):

```typescript
// NEW Phase 129 — check multi-user-ness AND resolve creator username so
// the orchestrator can auto-tag frontmatter. Both queries are cheap
// (in-memory SQLite) so no ordering concern with the SSE opening below.
const isMultiUser = await isHostMultiUser(hostId);
const creatorUsername = isMultiUser
  ? await getUsernameForUserId(userId)
  : null;

// Thread through to orchestrator opts (mirrors existing opts-building shape):
await birthIdentity({
  userId,
  hostId,
  name,
  title,
  path,
  colorHue,
  voice,
  avatarCandidateId,
  role,
  task,
  poolPicked,
  abortSignal,
  bodyContent,
  creatorUsername: creatorUsername ?? undefined,  // NEW
}, emit, deps);
```

**Note:** Defensive branch — if `isMultiUser` is true but `creatorUsername` is null (userId lookup failed), treat as single-user (no auto-tag) and log loudly. The RESEARCH Pitfall 6 explicitly notes this shape.

---

### `src/backend/database/routes/conversation-search.ts` (MODIFY — POST L498-628)

**Analog:** self + `sessions.ts` fanout shape (already documented mirror at L573 header comment). Extend after `runOneHost` returns, before flatten + slice.

**Post-filter pattern** (conversation-search.ts L604 — inside per-host block, after `runOneHost` returns rows for that host):

```typescript
// NEW Phase 129 — batch-fetch identity+role frontmatter for the unique
// identityKeys in this host's search results, then apply the gate.
// This is O(unique identityKeys in the result page), bounded by DEFAULT_LIMIT.
const uniqueKeys = Array.from(new Set(rows.map((r) => r.identityKey)));
const gateMap = new Map<string, boolean>();
await Promise.all(uniqueKeys.map(async (key) => {
  try {
    const { markdown } = await readIdentityFile(conn, key);
    const identityCos = extractCosmeticsFromFrontmatter(markdown);
    const role = extractRoleFromMarkdown(markdown);
    const roleCos = role !== null
      ? await readRoleFileByName(conn, role).then(
          ({ markdown: rm }) => rm ? extractCosmeticsFromFrontmatter(rm) : null,
        ).catch(() => null)
      : null;
    gateMap.set(key, isIdentityVisibleToUser(identityCos, roleCos, callerUsername));
  } catch {
    // Read failure → drop the row (fail-closed for search results — the
    // caller shouldn't see a hit for an identity we couldn't verify).
    gateMap.set(key, false);
  }
}));
return rows.filter((r) => gateMap.get(r.identityKey) === true);
```

**Note:** `callerUsername` fetched once per request at L502-503 (adjacent to `userId` extract). The archive path (if it appears in `runOneHost`) uses the same gate.

---

### `src/backend/fleet-status/app-frame-filter.ts` (MODIFY — L200-283)

**Analog:** self (existing `canUserSee(hostIdStr)` pattern per branch). Add a parallel `canUserSeeIdentity(identityName, hostIdStr)` shim + call it inside each frame branch that carries an identity name.

**Cache shape extension** (app-frame-filter.ts L84-132 — mirror `AccessCache` for identity gate, OR skip cache per RESEARCH Pattern 3 note about the "picked up on next read" shape promise). Recommend **no cache in v1** (see RESEARCH Assumption A3 discussion).

**canUserSeeIdentity shim pattern** (add adjacent to `canUserSee` at app-frame-filter.ts L162-202):

```typescript
async function canUserSeeIdentity(
  identityName: string,
  hostIdStr: string,
): Promise<boolean> {
  // Fetch cosmetics + role from disk, apply gate. Fail-closed on read
  // error (same discipline as canUserSee's catch branch at L185-198).
  try {
    // NB: this shim needs a resolveHostOwnerById-style deps injection to
    // reach the SSH connection. Extend ctx.resolveIdentityGate: (identityName,
    // hostIdStr, userId) => Promise<boolean> so this file stays free of
    // artifact-reader and ssh-one-shot imports (matches app-frame-filter's
    // "this file owns no DB access" discipline at L66-68).
    return await ctx.resolveIdentityGate(identityName, hostIdStr, userId);
  } catch (err) {
    systemLogger.warn(
      "Fleet-status app-frame filter — identity gate resolver threw; denying",
      { operation: "app_frame_filter_identity_gate_error", userId, hostIdStr, identityName,
        error: err instanceof Error ? err.message : "unknown" },
    );
    return false;
  }
}
```

**Frame-branch extension pattern** (app-frame-filter.ts L204-283 — add identity check alongside host check per branch):

```typescript
// Existing update branch at L220-222:
if (frame.type === "update") {
  if (!(await canUserSee(frame.state.hostId))) return null;
  // NEW: also gate by identity
  if (frame.state.tmuxSession
      && !(await canUserSeeIdentity(frame.state.tmuxSession, frame.state.hostId))) {
    return null;
  }
  return frame;
}

// snapshot at L224-243 — project through the same per-state check:
if (frame.type === "snapshot") {
  const states = frame.states;
  if (states.length === 0) return frame;
  const projectedStates = await Promise.all(states.map(async (s) => {
    if (!(await canUserSee(s.hostId))) return null;
    if (s.tmuxSession && !(await canUserSeeIdentity(s.tmuxSession, s.hostId))) return null;
    return s;
  }));
  return makeSnapshotFrame(projectedStates.filter((s): s is SessionState => s !== null));
}

// gone at L212-214 + identity-archived at L216-218 — add identity gate on
// frame.identityKey (or equivalent field per wire-protocol.ts).
```

**Frame-type enumeration:** RESEARCH Open Question 3 flags `session-project-changed` and `project-list-changed` as identity-adjacent frames to also gate. Plan-time verification via `grep -n "makeUpdateFrame\|makeSnapshotFrame\|make.*Frame" src/backend/fleet-status/wire-protocol.ts` per RESEARCH recommendation.

**Ctx extension** (app-frame-filter.ts L69-74 — add `resolveIdentityGate` to `AppFrameFilterCtx`):

```typescript
export interface AppFrameFilterCtx {
  userId?: string;
  resolveHostOwnerById: (hostIdStr: string) => Promise<{ hostIdNum: number; hostUserId: string } | null>;
  // NEW Phase 129 — injected by starter.ts / fleet-status-server.ts to
  // reach the artifact-reader + ssh-one-shot layer without this file
  // owning those imports.
  resolveIdentityGate: (identityName: string, hostIdStr: string, userId: string) => Promise<boolean>;
}
```

---

### Test files

**Analog:** `identity-appearance.test.ts` (pure-fn tests with `makeArgs` fixture builder) + `identities.get-disk.test.ts` (bare-Express + `vi.mock` scaffold at L47-77 auth-manager mock, L100-145 drizzle+db mocks, L147-150 logger mock).

**NEW `identity-visibility-gate.test.ts`** — pure-fn matrix of `[nullCaller, emptyLists, userOnBoth, userOnRoleOnly, userOnIdOnly, userOnNeither, zoeOnBothUserEmpty]`. Copy the `makeArgs` fixture builder shape from identity-appearance.test.ts L25-41 and adapt.

**MODIFY `identities.get-disk.test.ts`** — add cross-user tests. Mock `getUsernameForUserId` to return "user" or "zoe" per test; assert identity A (`users:[user]`) shows for the user's request, absent from Zoe's response. Fixture pattern from L47-77 (mockUserId variable + auth middleware mock).

**MODIFY `identity-birth-orchestrator.test.ts`** — add test cases for `opts.creatorUsername` present/absent → frontmatter contains/omits `users:` key. Assert against the yaml.dump output byte-shape.

**MODIFY `app-frame-filter.test.ts`** — mirror existing test 9/10 fail-closed shape (see file header L26-34). Add identity-gate branch tests with mocked `resolveIdentityGate` returning true/false; assert frame drop.

---

## Shared Patterns

### Absent-⇒-Omit Frontmatter Field (zero-migration invariant)

**Source:** `src/backend/database/routes/identity-birth-orchestrator.ts` L556-585 (canonical `pairs.push` pattern).
**Apply to:** `roles-create.ts` (via `cosmetics` dict mutation) + `identity-birth-orchestrator.ts` (via `pairs.push`).

Pattern excerpt already shown in per-file assignments. Load-bearing invariant: an empty or missing `users` list in frontmatter MUST mean "no gate on this side" (falls open). This mirrors every other cosmetic field (title, colorHue, voice, task, project) and guarantees zero migration cost — every existing role and identity file on every host is untouched.

### YAML dump canonical options

**Source:** `src/backend/claude-session/identity-artifact-reader.ts` L570-575 (canonical options), used at `roles-create.ts` L557-562 and `identity-birth-orchestrator.ts` L589-594.
**Apply to:** Both create endpoints.

```typescript
yaml.dump(
  stringifyColorHueForYaml(Object.fromEntries(pairs)),
  { sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false },
);
```

- `sortKeys: false` — preserves insertion order (byte-shape parity per Phase A / CONTEXT.md)
- `lineWidth: -1` — no wrapping; keeps arrays of strings on a single line
- `noRefs: true` — no `&anchor` / `*alias` emission
- `forceQuotes: false` — let js-yaml quote per-value (colons, newlines auto-quoted; T-66-01-04 precedent)

### Read-path fail-open, write-path fail-closed

**Source:** `identity-artifact-reader.ts` L3162-3168 (parse failure returns `{}`); `app-frame-filter.ts` L185-198 (checkHostAccess error → `false`); `roles-create.ts` L510-517 (SSH exec fail → 502).
**Apply to:**
- Read path (list endpoints + WS filter): read fail → treat identity as visible (falls open — matches existing null-cosmetics contract; visibility filter is not a permission system per shape).
- **Exception:** `app-frame-filter.ts` and `conversation-search.ts` post-filter — fail-closed on identity-gate resolver error (deny-by-default matches the existing `canUserSee` catch-and-return-false discipline).
- Write path (auto-tag): userId lookup fail → skip auto-tag + LOG loudly (fail-open behavior on the write side because a wrong-user auto-tag is a shape-file bullet-3 "would make it wrong" violation).

### Per-host SSH resource discipline

**Source:** `identities.ts` L342-346 `withSlot` semaphore + L361-386 `roleReadCache` per-host memo; `roles-list-for-host.ts` L191-196 batched-cat single-round-trip.
**Apply to:** `sessions.ts` gate extension + `conversation-search.ts` post-filter.

Every SSH read must go through `getHostSemaphore(hostId).run(...)` (cap default 8, sized against sshd MaxSessions=10). Reuse identity's markdown for BOTH role-name AND identity-cosmetics extraction (RESEARCH Assumption A5) — do NOT issue two SSH round-trips per identity.

### Case-sensitive username comparison

**Source:** DB-storage discipline (`src/backend/database/routes/users.ts` L172 `eq(users.username, username)`).
**Apply to:** `identity-visibility-gate.ts` (`includes` uses `===`), auto-tag write (`creatorUsername` passed through as-is from DB), all gate call sites.

Locked as **case-sensitive** per RESEARCH § Common Pitfall 7 + Assumption A2. Document in code comment on the gate function. If operator confusion becomes a footgun, revisit with `.toLowerCase()` on both sides.

---

## No Analog Found

*None.* Every file to be created or modified has a strong existing analog in the codebase — this is a compositional phase, not a construction one (RESEARCH § "Don't Hand-Roll" key insight).

---

## Metadata

**Analog search scope:**
- `src/backend/fleet-status/` (single-authority merge, WS filter machinery)
- `src/backend/claude-session/` (frontmatter parse/emit primitives)
- `src/backend/database/routes/` (route handlers for identities, sessions, roles, conversation-search, birth orchestrator)
- `src/backend/database/db/schema.ts` (users, hosts, hostAccess table definitions)
- `src/backend/utils/` (shared util location for new host-user-counter.ts)
- `src/ui/` (spot-check — no frontend changes needed per RESEARCH)

**Files scanned:** ~15 primary + schema + spot-checked ~5 frontend for zero-change verification.

**Pattern extraction date:** 2026-09-23
