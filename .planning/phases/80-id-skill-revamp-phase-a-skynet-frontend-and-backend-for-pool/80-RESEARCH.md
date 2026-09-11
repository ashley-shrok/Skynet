# Phase 80: id skill revamp Phase A — Research

**Researched:** 2026-09-06
**Domain:** Skynet frontend + backend for pool-based naming, task-scoped identity creation, task field on disk, chat/list task display
**Confidence:** HIGH (nearly every claim traces to a read file with a line number)

## Summary

Phase 80 rides on top of a very well-established substrate: Phase 66 established the disk-as-source-of-truth pattern for identity cosmetics (`extractCosmeticsFromFrontmatter` + `buildIdentityFileBody` in the birth orchestrator), Phase 68/69 killed the identities DB table so nothing needs DB caching, Phase 77 shipped the identity-birth-orchestrator's admin-mint sequence with `matrixCreateOrUpdateUser` + `matrixLoginAsUser` primitives, and Phase 22 shipped the current new-agent modal with role selection wired via `GET /roles?hostId=<n>`.

Everything Phase 80 needs is **an additive extension of these existing patterns**, not a rewrite. Task field = one more scalar handled by `extractCosmeticsFromFrontmatter` + `buildIdentityFileBody` (both emit and read). Pool storage = the branding-config-loader pattern (JSON at `docker/pool-defaults/pool.json`, COPYed to `/app/pool-defaults/`, memoized on first read). Ordinal derivation = one new primitive in `matrix-admin-client.ts` calling `GET /_synapse/admin/v2/users?user_id=<pattern>&deactivated=true` and reading `total`. Task pill = one new absolute-positioned span in PrettyView's root, using the same `hsla(hue, …)` inline-style pattern IdentityBadge uses. Conversation-row task-primary = swap `identity.displayName` for `identity.task ?? identity.displayName` in one JSX span, and swap the aiTitle subtitle for a role-prominent-name-parens fragment when task is truthy.

The "role select bug" is NOT a missing dropdown — the dropdown is fully wired at `NewSessionDialog.tsx:961-1010`. Read carefully: the dropdown is gated on `selectedHost !== null && identityMode`. If the user opens the modal WITHOUT picking a host first, no role selector appears — this is likely what Alice experienced. Confirm during planning whether the bug is "missing role dropdown" (this) or something else, but the existing role dropdown machinery is intact.

**Primary recommendation:** Add `task` field to `extractCosmeticsFromFrontmatter` + `publicIdentity` + `buildIdentityFileBody` (all three surfaces). Add new primitive `countUsersMatching(prefix)` to `matrix-admin-client.ts`. Add pool loader at `src/backend/pool/pool-loader.ts` following branding-config pattern. Add `POST /identities/pool/pick` (returns one pool name unused-on-this-server for the requested role). Extend birth-orchestrator to accept optional `task` in `BirthOptions` and thread it into `buildIdentityFileBody`. Rebuild `NewSessionDialog` to add task-description input + pool-prefill (name field stays editable, pool is suggestion source). Rename `CloneAgentDialog` to `SpawnUnderRoleDialog` (or repurpose CloneAgentDialog to open the same unified modal pre-set to source role). Add task pill to PrettyView (absolute centered top). Swap two JSX spans in PrettyConversationRow (top-line + subtitle-line) gated on `identity.task`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pool JSON storage | CDN / Static (baked into image) | — | Same as branding-config-defaults — read-only seed data lives in the Docker image |
| Pool-name-picker endpoint | API / Backend | — | Backend queries Synapse admin API to filter pool candidates by "not-taken-on-this-server-for-this-role"; server-side keeps ordinal-derivation atomic |
| Ordinal derivation | API / Backend | — | Uses matrix-admin creds; must be server-side (D-CONTEXT §Claude's Discretion) |
| Task field on disk | Database / Storage (identity file frontmatter, on target host) | API / Backend (SFTP-write during birth) | Follows Phase 66 disk-authoritative pattern — task lives in `~/.claude/identities/<name>/<name>.md` frontmatter next to displayName/title/colorHue/voice/avatar |
| Task field read | API / Backend | — | Backend reads via `extractCosmeticsFromFrontmatter` on-demand in GET /identities (same as coordinator/colorHue) |
| New-agent modal (unified) | Frontend Server (React) | — | Client-side React modal; hits backend for pool-pick + birth |
| Task pill on chat surface | Browser / Client | — | React component in PrettyView.tsx; reads identity.task from identities-store |
| Task-primary conversation-list row | Browser / Client | — | React component in PrettyConversationRow.tsx; reads identity.task from identities-store |

## Files/Functions to Touch

### Backend (existing files to extend)

| File | What Changes | Why |
|------|--------------|-----|
| `src/backend/claude-session/identity-artifact-reader.ts` | Add `task?: string` to return type of `extractCosmeticsFromFrontmatter` (line 2095-2145); mirror the string-narrowing gate used for `title`/`voice` | Task field extends existing cosmetics pattern |
| `src/backend/database/routes/identities.ts` | Add `task?: string` to `publicIdentity` cosmetics arg + emit `task: cosmetics.task ?? null` on returned object (line 109-143) | Flow task through GET /identities to frontend |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | Add `task?: string` to `BirthOptions`; thread into `buildIdentityFileBody` (line 345-380) so task appears in emitted frontmatter | Task written on birth |
| `src/backend/database/routes/identity-birth.ts` | Accept `task?: string` in request body validation; pass to `birthIdentity` opts (line 84-127, 232-247) | HTTP surface for task input |
| `src/backend/matrix/matrix-admin-client.ts` | Add new primitive: `countUsersMatching(prefix: string): Promise<{ok: true; total: number} \| AdminErr>` calling `GET /_synapse/admin/v2/users?user_id=<encodeURIComponent(prefix)>&deactivated=true&limit=1` reading `total` from response | Ordinal derivation |
| `src/backend/database/database.ts:1836` | Mount new pool router BEFORE `/identities/birth` so `POST /identities/pool/pick` resolves to pool handler | Route order matters (existing convention) |

### Backend (new files)

| File | Purpose | Pattern |
|------|---------|---------|
| `src/backend/pool/pool-loader.ts` | Module-scope loader for vetted pool JSON. Reads `/app/pool-defaults/pool.json` (COPYed by Dockerfile) once, memoizes. Never throws (returns `[]` on missing / malformed) — same never-throws contract as `branding-config-loader.ts` | Byte-shape mirror of `src/backend/branding/branding-config-loader.ts` |
| `src/backend/pool/pool-routes.ts` | New Express router. `POST /identities/pool/pick` accepts `{ role: string, hostId: number }`, picks an unused pool name (queries `countUsersMatching(<PoolName>-<Role>)` for each candidate until a bare match returns `total: 0`, OR picks the base and lets the birth-orchestrator's ordinal-derivation step append a suffix — see "Recommended approach per work stream" below for which shape to pick during planning). Returns `{ name: string }` | Mirror `src/backend/database/routes/roles-list-for-host.ts` for JWT auth + shape |
| `docker/pool-defaults/pool.json` | Vetted-pool JSON seed. Shape: `{ "names": ["Willow", "Cinder", "Aster", "Vega", "Onyx", "Sable", "Fig", …] }`. Alice finalizes contents in parallel; Phase 80 ships with whatever is landed. | Mirror `docker/branding-defaults/branding.json` |
| `docker/Dockerfile:78` | Add `COPY --chown=node:node docker/pool-defaults /app/pool-defaults` next to the branding-defaults COPY | Mirror branding pattern |

### Frontend (existing files to rebuild / extend)

| File | What Changes | Why |
|------|--------------|-----|
| `src/ui/api/identities-api.ts` | Add `task: string \| null` to `Identity` interface (line 3-23). Add `pickPoolName(role, hostId): Promise<{name: string}>` API call. Add `task?: string` to `BirthRequest` (line 374-384). | Type/API surface for task |
| `src/ui/sidebar/NewSessionDialog.tsx` | Rebuild as unified modal: add `task` state, task-description textarea (with soft ~15-20 word cap — pick exact char count during executor implementation), auto-prefill name via `pickPoolName` when role changes. Default `identityMode` stays `true` (line 302 already does). See "role select bug" analysis below | Unified modal per shape D-01/D-04 |
| `src/ui/sidebar/CloneAgentDialog.tsx` | REPURPOSE: shape's phrase "Clone modal becomes a thin entry-point into unified new-agent modal pre-set to row's role." Either (a) delete CloneAgentDialog entirely and have `handleRowClone` open NewSessionDialog with `initialRole` + `initialHost` pre-filled; OR (b) keep CloneAgentDialog as a thin façade that opens NewSessionDialog. Also rename the context-menu label "Clone" → something like "Spawn under this role" | Per shape §Frontend creation flow "context-menu Clone gets renamed" |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:1273-1288` | The `.pv-body` JSX block. Swap `identity.displayName` (top line) for `identity.task ?? identity.displayName + "(role)"` fallback; swap the aiTitle subtitle for role-prominent + `(name)` fragment when task truthy. Gate on `identity.task` truthy for both changes | D-03 conversation-row typography |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:1352` | Rename `label: "Clone"` in context-menu items | Shape §Frontend creation flow |
| `src/ui/features/pretty-view/PrettyView.tsx:3011-3019` | Add task pill as sibling to `IdentityBadge` — absolute-positioned centered at top. Only render when `pvIdentity?.task` truthy. Use inline-style glass treatment matching IdentityBadge (see `IdentityBadge.tsx:102-116` for the exact linear-gradient + backdropFilter + border formula) | D-02 pill visual family |
| `src/ui/features/pretty-conversations/pretty-conversations.css` | Reuse existing `.pv-label`, `.pv-hostname-suffix`, `.pv-ai-title` classes verbatim per D-03. No new selectors needed if reuse holds. If pixel-tuning becomes needed during executor implementation, add small sibling classes (e.g. `.pv-role-prominent`) | D-03 typography reuse |

### Frontend (new components — optional)

| File | Purpose |
|------|---------|
| `src/ui/features/terminal/TaskPill.tsx` (new) | Extracted task-pill component for reuse; takes `{task, colorHue}` props. Alternative: inline JSX in PrettyView.tsx (fewer files). Planner's call — extracted has better test-in-isolation and future-proofs. |

## Existing Patterns to Reuse

### Pattern 1: Frontmatter scalar extraction (source: `identity-artifact-reader.ts:2095-2145`)

```typescript
export function extractCosmeticsFromFrontmatter(markdown: string): {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  avatar?: string;
  coordinator?: boolean;
  // Phase 80: add task
  task?: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  let parsed: unknown;
  try { parsed = yaml.load(match[1]); } catch { return {}; }
  if (parsed === null || typeof parsed !== "object") return {};
  const src = parsed as Record<string, unknown>;
  const out: {...} = {};
  // ... existing narrowing ...
  // Phase 80 additive:
  if (typeof src.task === "string" && src.task.length > 0) {
    out.task = src.task;
  }
  return out;
}
```

Same narrowing shape as displayName/title/voice — non-empty string check, drop on anything else.

### Pattern 2: Frontmatter scalar emission on birth (source: `identity-birth-orchestrator.ts:345-380`)

```typescript
function buildIdentityFileBody(opts: BirthOptions, displayName: string, avatarFilename: string): string {
  const pairs: Array<[string, string | number]> = [];
  pairs.push(["role", opts.role]);
  pairs.push(["displayName", displayName]);
  if (typeof opts.title === "string" && opts.title.trim().length > 0) pairs.push(["title", opts.title]);
  if (opts.colorHue !== null && opts.colorHue !== undefined) pairs.push(["colorHue", opts.colorHue]);
  if (typeof opts.voice === "string" && opts.voice.trim().length > 0) pairs.push(["voice", opts.voice]);
  pairs.push(["avatar", avatarFilename]);
  // Phase 80 additive: task after avatar (or wherever the ordering call is made)
  if (typeof opts.task === "string" && opts.task.trim().length > 0) pairs.push(["task", opts.task]);
  const yamlBody = yaml.dump(Object.fromEntries(pairs), { sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false });
  return `---\n${yamlBody}---\n\n${IDENTITY_FILE_SEED_COMMENT}\n\n# ${opts.name}\n`;
}
```

Same absent-⇒-omit invariant: empty task ⇒ no `task:` key in emitted YAML.

### Pattern 3: JSON-in-repo seed loader (source: `branding-config-loader.ts:118-160`)

```typescript
// Module-scope memoization pattern — read once at first request, cache result
let cachedPool: string[] | null = null;

export function getVettedPool(): string[] {
  if (cachedPool !== null) return cachedPool;
  const poolPath = path.join("/app/pool-defaults", "pool.json");
  try {
    const raw = readFileSync(poolPath, "utf-8");
    const parsed = JSON.parse(raw) as { names?: unknown };
    if (Array.isArray(parsed.names) && parsed.names.every(n => typeof n === "string")) {
      cachedPool = parsed.names as string[];
      return cachedPool;
    }
    sshLogger.error("pool-loader: shape invalid, returning []");
    cachedPool = [];
    return cachedPool;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") { cachedPool = []; return cachedPool; }
    sshLogger.error("pool-loader: read failed", err);
    cachedPool = [];
    return cachedPool;
  }
}
```

Same never-throws contract. Boot-time load unnecessary — first request warms the cache; subsequent requests are memoized.

### Pattern 4: Matrix admin fetch primitive (source: `matrix-admin-client.ts:66-113`)

```typescript
export async function countUsersMatching(prefix: string): Promise<{ok: true; total: number} | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  // Filter: user_id partial match (Synapse admin API v2). deactivated=true INCLUDES
  // deactivated accounts (crucial — Synapse deactivates but never deletes, and
  // deactivated usernames stay reserved per shape file §Naming). limit=1 because
  // we only need the `total` count, not the list.
  const url = `${creds.homeserverBase}/_synapse/admin/v2/users?user_id=${encodeURIComponent(prefix)}&deactivated=true&limit=1`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    const parsed = await response.json() as { total?: number };
    return { ok: true, total: typeof parsed.total === "number" ? parsed.total : 0 };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 504, error: ERR_TIMEOUT };
    databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_count_users" });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

Byte-shape mirror of `loginAsUser` / `createOrUpdateUser` — same discriminated-union return, same timeout discipline, same error taxonomy. Zero new deps.

**Key detail for ordinal derivation:** the Synapse admin API `GET /_synapse/admin/v2/users?user_id=<value>` treats `user_id` as a **substring filter** — passing `Willow-Skynet-Maintainer` returns all users whose user_id contains that string (including `Willow-Skynet-Maintainer-2`, `Willow-Skynet-Maintainer-3`, etc.). The `total` field in the response gives the count. With `deactivated=true` we include deactivated accounts (Synapse deactivates but never deletes username reservations — shape file §Naming).

### Pattern 5: Route mount ordering (source: `database.ts:1832-1856`)

```typescript
// Phase 80 addition — mount BEFORE /identities so pool subpath resolves here:
app.use("/identities/pool", identityPoolRoutes);
// Existing (unchanged):
app.use("/identities/avatar", identityAvatarBatchRoutes);
app.use("/identities/birth", identityBirthRoutes);
app.use("/identities/clone", identityCloneRoutes);
// ...
app.use("/identities", identitiesRoutes);  // Generic falls through last
```

### Pattern 6: Identity badge glass treatment (source: `IdentityBadge.tsx:102-116`)

```typescript
const hue = identity.colorHue ?? 35;
const rootStyle: React.CSSProperties = {
  borderRadius: 36,
  overflow: "hidden",
  padding: "8px 18px 8px 8px",
  background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
  backdropFilter: "blur(24px) saturate(1.4)",
  WebkitBackdropFilter: "blur(24px) saturate(1.4)",
  border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
  boxShadow: `0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(${hue}, 65%, 55%, 0.28)`,
  color: "#e8e4d8",
  animation: "pv-identity-breathe 5s ease-in-out infinite",
};
```

**For the task pill:** use this EXACT glass formula but with adjusted padding (~6-10px, smaller than the badge's 8/18/8/8) and no avatar/name/title children. Position `absolute top-4 left-1/2 -translate-x-1/2 z-[100]` (below IdentityBadge's z-[101]). Font: `Inter Variable`. Font size ~13-14px. Content: `identity.task` string.

### Pattern 7: Conversation row typography (source: `pretty-conversations.css:686-756`)

Existing classes `.pv-body`, `.pv-body .pv-label`, `.pv-body .pv-label .pv-hostname-suffix`, `.pv-body .pv-ai-title` are the top-line + subtitle-line typography vocabulary. D-03 locks reuse — new selectors NOT invented at plan time. If executor discovers pixel-mismatch at runtime, a small sibling class like `.pv-role-prominent` on the subtitle is a valid escape hatch.

**Existing top-line/subtitle-line markup for reference (PrettyConversationRow.tsx:1273-1288):**

```typescript
<div className="pv-body">
  <span className="pv-label">
    {identity ? identity.displayName : row.label}
    {(identity?.title || row.host?.name) && (
      <span className="pv-hostname-suffix">
        {" "}
        ({identity?.title || row.host?.name})
      </span>
    )}
  </span>
  {aiTitle !== null ? (
    <span className="pv-ai-title">{aiTitle}</span>
  ) : (
    <span className="pv-ai-title pv-ai-title--placeholder">…</span>
  )}
</div>
```

**Phase 80 shape when `identity.task` is truthy:**

```typescript
<div className="pv-body">
  <span className="pv-label">{identity.task}</span>
  <span className="pv-ai-title">
    <strong>{identity.role}</strong> <span className="pv-hostname-suffix">({identity.displayName})</span>
  </span>
</div>
```

When `identity.task` is null → fallback = current markup verbatim (D-06).

### Pattern 8: Frontend Identity type (source: `identities-api.ts:3-23`)

```typescript
export interface Identity {
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  role: string | null;
  avatarMime: string;
  avatarUrl: string;
  avatarEtag: string;
  coordinator: boolean;
  // Phase 80 additive:
  task: string | null;
}
```

## Landmines

### Landmine 1: Skynet in-memory SQLite + `DatabaseSaveTrigger.forceSave`

**Status for Phase 80:** NOT A LANDMINE. Task field is disk-only (D-05); no DB writes. Confirmed: `identity-birth-orchestrator.ts:191-193` says "no DB record is created; disk folder + frontmatter + avatar sibling ARE the identity's identity. forceSave also removed" — this discipline extends cleanly to task field. Do NOT add a DB column for task. Do NOT call `DatabaseSaveTrigger.forceSave` for the task-write path.

### Landmine 2: Role select is gated on host

**Where:** `NewSessionDialog.tsx:961` — `{selectedHost !== null && (` wraps the entire role dropdown.

**Impact:** If the unified modal defaults to `identityMode=true` but no host is picked, no role selector appears. This is likely what Alice experienced as "role selection isn't offered." The fix isn't "add a role dropdown" (it's already there) — it's to make sure:
- The unified modal auto-picks the sole host if only one exists (existing line 408-409 already does this when `flatHosts.length === 1`).
- The role dropdown renders visibly (or a hint like "pick a host first") even when host is null.
- Or (planner's call) the modal auto-selects the local Skynet host as default when identityMode is on.

**During planning:** confirm with Alice which of these is the actual bug she experienced. The dropdown-not-visible-until-host-picked is definitely one axis; there may be additional axes (e.g., the state resets when identityMode toggles, or the role field submits empty and backend rejects).

### Landmine 3: `identity` collision — cross-user access

**Where:** `identities.ts:181-264` GET /identities.

**Impact:** GET /identities enumerates identities on hosts owned by the calling user (via `identityHosts` param + `resolveHostById(hostId, userId)`). No cross-user isolation issue — every identity route already scopes by userId. Task field inherits this correctly.

**For pool-pick endpoint:** must call `resolveHostById(hostId, userId)` too (defense-in-depth per T-22-03-03) — the endpoint takes hostId but is really only used to determine which Synapse server to query; nevertheless, cross-user hostId spoofing should return 404 not 200.

### Landmine 4: Route mount ordering

**Where:** `database.ts:1832-1877` — mount comment reads: "identity avatar batch — mount BEFORE /identities so /identities/avatar/batch and /identities/avatar/candidate/:id don't collide with the generic /identities/:id/* routes."

**Impact:** New `POST /identities/pool/pick` MUST be mounted BEFORE `app.use("/identities", identitiesRoutes)` (line 1877) or Express will route to the identitiesRoutes generic `:identityKey` handler and get 400 "identityKey must match [a-z0-9_-]{1,64}" because "pool" fails the pattern.

### Landmine 5: Frontmatter YAML parse-error handling

**Where:** `identities.ts:397-417` — PUT /identities has explicit "malformed frontmatter → 500 and refuse overlay" (do NOT silently reset to {}). The read-side `extractCosmeticsFromFrontmatter` swallows parse errors as `{}` (line 2108-2110) which becomes safe-default display.

**Impact:** Adding `task?: string` to `extractCosmeticsFromFrontmatter` inherits the swallow semantic. If executor accidentally hardens the read path to throw on parse error, GET /identities becomes 500 on any single malformed identity — a cascade. Preserve the swallow.

### Landmine 6: In-memory pool memoization + hot-reload

**Where:** Pool loader memoizes at first read (mirrors `branding-config-loader.ts:118`). If Alice updates `/app/pool-defaults/pool.json` and reloads the container, the new pool takes effect. But if she hot-edits without restart, the memoized value stays stale.

**Impact:** Ship-time gate. Confirm during deploy motion that operator knows: to change the pool, redeploy. If a runtime reload endpoint is desired, that's out of scope for Phase 80 (D-01 locks "loaded on boot").

### Landmine 7: Matrix admin creds gate

**Where:** `identity-birth.ts:158-165` — `getMatrixAdminCreds()` returns null on a fresh non-ingested deployment; the birth handler returns 503 `matrix_admin_foundation_not_ingested` BEFORE opening SSE.

**Impact:** Pool-pick endpoint SHOULD apply the same 503 gate (calls `countUsersMatching` which hits Synapse admin API — needs creds). Ordinal-derivation code path fails the same way. Mirror the fail-early gate at pool-routes entry.

### Landmine 8: Pool exhaustion / all-taken race

**Where:** Pool-picker logic (not yet written).

**Impact:** If the vetted pool has N names and there are N+1 in-use accounts on the server for a given role, no bare pool name is unused. The shape file §Naming section states: "serial ordinal is appended when a pool name is reused for the same role — first use is bare (Willow-Skynet-Maintainer), second use becomes Willow-Skynet-Maintainer-2." So the picker should NEVER fail "no pool name available" — it always returns SOMETHING. Two shapes possible:

- **Shape A (backend picks + tags ordinal):** Backend iterates pool candidates, for each: query `countUsersMatching(<Candidate>-<Role>)`. If total==0 → return bare candidate. If all candidates have total>0 → pick the candidate with lowest total, and the birth-orchestrator's ordinal-derivation step will append the suffix. Endpoint returns just `{ name: "Willow" }` — frontend puts this in the name field; backend computes ordinal at birth time.
- **Shape B (backend picks + returns bare-or-suffixed):** Backend does the full "pick candidate + compute ordinal" work, returns `{ name: "Willow-Skynet-Maintainer-3" }` (full handle). Frontend puts this in the name field. But then the shape file says "user can edit the name to anything" — if the user edits `Willow-Skynet-Maintainer-3` to `Willow-my-custom`, the ordinal computation is meaningless.

**Recommendation:** Shape A. Backend picks the pool NAME (e.g. `Willow`); user can override; backend's birth-orchestrator does the ordinal-derivation step at creation time based on `<final-name>-<role>` (whether pool-picked or user-typed).

### Landmine 9: The identity key vs. relay handle distinction

**Where:** shape file §Naming: "The relay account for each identity combines that pool name with the role name (like `Willow-Skynet-Maintainer`)". But identity KEY (folder name, MXID localpart, sessionMatchKey axis) is just `willow` — role isn't in it.

**Impact:** Two distinct things:
- **Identity key** = pool-picked name, lowercase, e.g. `willow`. Used for folder name, IDENTITY_KEY_RE gate, sessionMatchKey.
- **Relay account MXID localpart** = `<PoolName>-<Role>-<ordinal>` PascalCase-mixed. Used for Matrix account creation via `matrixCreateOrUpdateUser`.

Currently Phase 77's `birthIdentity` uses `opts.name` (identity key) as the MXID localpart at `identity-birth-orchestrator.ts:487`: `const mxid = \`@${opts.name}:${serverName}\`;`. Phase 80 needs to compute the full handle separately from the folder name:

- `opts.name` (identity key) → folder = `~/.claude/identities/willow/`
- MXID handle = `Willow-Skynet-Maintainer` (or `Willow-Skynet-Maintainer-2` with ordinal)

This is a POTENTIAL SCOPE CREEP or PATTERN CHANGE. Two options:
- **(a)** Keep identity key === MXID localpart (i.e., folder is `willow-skynet-maintainer` lowercase). Ugly folder name, but no orchestrator changes needed.
- **(b)** Diverge them. Add `mxidLocalpart` field to BirthOptions; orchestrator uses it for MXID and `opts.name` for folder.

**During planning:** DECIDE THIS. Alice may have opinions; this is a load-bearing choice. Shape file §Naming implies (b) is intended ("The relay account for each identity combines that pool name with the role name" — implying the identity is Willow and the relay account is Willow-Skynet-Maintainer, two distinct handles). Also shape §Relay-account handle format: `<PoolName>-<Role>` PascalCase-hyphenated. Identity folder shape from Phase 66+68 is lowercase-only (`IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/`).

**Marked [ASSUMED]:** Option (b) is the shape file's intent. Planner should confirm with Alice or lock during discuss-phase.

### Landmine 10: Existing new-agent modal has many state fields — rebuild risks regression

**Where:** `NewSessionDialog.tsx` — 1400+ lines, includes: host picker, session-name input (non-identity mode), path input, identity-mode toggle, role selector, name input with collision precheck (Skynet + host), title input, brief input, avatar generation batch + manual upload + color picker + voice picker, birth-progress SSE stream consumer.

**Impact:** Any rebuild risks breaking existing tests. Existing test files: `NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`, `NewSessionDialog.role-dropdown.test.tsx`. Preserve all existing test coverage — grow, don't replace. Shape file explicitly says "if the existing modal has salvageable structure" for a reason.

### Landmine 11: `initialRole` chain pre-fill mechanism already exists

**Where:** `NewSessionDialog.tsx:399-407` — the modal accepts `initialHost` and `initialRole` props and seeds them in on-open. `CreateRoleDialog` already chains into it via `onChainToCreateIdentity`.

**Impact:** REUSE this mechanism for the clone-modal-repurposing. Instead of building a new "spawn under role" modal, open NewSessionDialog with `initialHost = row.host, initialRole = identity.role, initialBrief = task`. The existing chain-hook plumbing is directly applicable.

### Landmine 12: The identity-birth orchestrator's Q2 no-rollback invariant

**Where:** `identity-birth-orchestrator.ts:660-671` — every step failure emits step:N:failed + ended{ok:false, failedStep:N} and STOPS. NO rollback. NO folder-cleanup on failure. This is a load-bearing invariant.

**Impact:** Any Phase 80 modification of `birthIdentity` MUST preserve this. Task field emission failure (e.g., yaml.dump throws) should either be swallowed silently at step 2.5 OR fail the whole birth loudly — but must NOT leave a partial-write scenario where task is half-written or corrupted mid-file. Since task is emitted as part of `buildIdentityFileBody`'s single atomic string that goes to `writeMarkdownFileAtomic`, this is fine — the whole file is written atomically via ext_openssh_rename.

## Recommended Approach Per Work Stream

### Stream 1: Backend — Pool storage + loader (LOW risk, small blast radius)

1. Create `docker/pool-defaults/pool.json` with initial contents (e.g., 5-10 placeholder names Alice provides in parallel).
2. Add `COPY --chown=node:node docker/pool-defaults /app/pool-defaults` to `docker/Dockerfile:78`.
3. Create `src/backend/pool/pool-loader.ts` mirroring `branding-config-loader.ts` — module-scope memoization, ENOENT → empty array (never throws), same never-throws contract.
4. Test: `src/backend/pool/pool-loader.test.ts` — happy path + ENOENT + malformed JSON + non-array + non-string entries.

### Stream 2: Backend — Ordinal derivation primitive (LOW risk, isolated)

1. Add `countUsersMatching(prefix): Promise<{ok: true; total: number} | AdminErr>` to `src/backend/matrix/matrix-admin-client.ts` — byte-shape mirror of existing primitives.
2. Test: extend `src/backend/matrix/matrix-admin-client.test.ts` with `countUsersMatching` unit tests (mock fetch, assert URL shape, assert response parsing, assert `deactivated=true` in query string, assert error taxonomy).
3. Integration test (if `matrix-admin-client.integration.test.ts` is wired to a live Synapse): assert `countUsersMatching("@tina")` returns non-zero total.

### Stream 3: Backend — Pool-pick endpoint (MEDIUM risk, cross-cuts stream 1+2)

1. Create `src/backend/pool/pool-routes.ts` — new Express router with `POST /identities/pool/pick` handler.
2. Handler shape:
   - JWT auth via `AuthManager.getInstance().createAuthMiddleware()`.
   - Body: `{ role: string, hostId: number }`. Validate role against `/^[a-z0-9-]+$/` (kebab-case). Validate hostId positive integer.
   - Call `getMatrixAdminCreds()` — 503 fail-early on null (mirror `identity-birth.ts:158-165`).
   - Call `resolveHostById(hostId, userId)` — 404 on cross-user (defense).
   - Load pool via `getVettedPool()`.
   - **Picking algorithm** (recommended Shape A — see Landmine 8):
     - Shuffle pool or iterate in order.
     - For each candidate: call `countUsersMatching(\`@\${Candidate.toLowerCase()}:\`)` (with server-name suffix to prevent false-positive matches on other servers).
     - If total==0 → return `{ name: Candidate.toLowerCase() }`.
     - If all candidates busy → fall back to first pool name; birth-orchestrator's ordinal-derivation step will append suffix.
   - Response: `{ name: string }` (single unused pool name, lowercase).
3. Mount in `database.ts`: `app.use("/identities/pool", identityPoolRoutes);` BEFORE `/identities/birth` mount (line 1836) — or before generic /identities (line 1877); order matters (Landmine 4).
4. Test: `src/backend/pool/pool-routes.test.ts` — happy path, empty pool, all-taken pool, cross-user hostId, 503 no-creds.

### Stream 4: Backend — Task field wiring (LOW risk, additive extension)

1. `extractCosmeticsFromFrontmatter`: add `task?: string` narrowing (mirror displayName gate). Test in `identity-artifact-reader.avatar-read.test.ts` describe block.
2. `publicIdentity` (identities.ts:109-143): add `task: cosmetics.task ?? null` to return object. Test in `identities.get-disk.test.ts` PUB-* tests.
3. `BirthOptions` (identity-birth-orchestrator.ts:111-130): add `task?: string`. `buildIdentityFileBody`: add `task` emission after `avatar`. Test in `identity-birth-orchestrator.role-frontmatter.test.ts`.
4. `identity-birth.ts`: add body-validation for `task` (optional string, cap ~200 chars). Thread to birthIdentity opts.
5. `identity-clone.ts`: DECIDE — does clone inherit task, or is task blank on clone? Recommend: clone gets a fresh task (task is the WHY of THIS new agent, not inherited). Add `task?: string` to clone body validation + writeMarkdownFileAtomic body.

### Stream 5: Frontend — Unified modal rebuild (HIGH risk, most user-facing change)

**Shape:** Extend NewSessionDialog, don't rewrite. Preserve identity-mode toggle behavior, existing role dropdown, existing avatar batch + manual upload.

1. Add `task` state variable + textarea input (positioned above the Name input in the identity cluster). Character soft-cap ~15-20 words (executor pins exact char count at implementation time when badge pill renders at real widths).
2. Add auto-fetch of pool name when role changes: `useEffect` on `[selectedRole]` calls `pickPoolName(selectedRole, hostId)` and setNames the returned value. User can edit thereafter.
3. Confirm/fix "role select bug": on modal open with `identityMode=true` default, if `flatHosts.length === 1` the sole host is auto-picked (existing line 408-409). Also if `initialHost` provided, seed it (line 399-400). If neither: user must pick host → role dropdown appears once host picked. Add visual affordance "pick a host to see roles" when host is null (currently line 961 just hides the whole cluster).
4. Update `openBirthStream` call site to include `task` in request body.
5. Preserve all existing tests: `NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`, `NewSessionDialog.role-dropdown.test.tsx`. Add new test file `NewSessionDialog.task-input.test.tsx` for task-field-specific coverage.

### Stream 6: Frontend — Clone entry-point repurpose

**Recommended shape:** Delete `CloneAgentDialog.tsx` entirely OR keep as thin wrapper. `PrettyConversationsPanel.handleRowClone` (line 1248) opens `NewSessionDialog` with `initialHost = row.host`, `initialRole = identity.role`. Rename context-menu label from "Clone" to something like "Spawn under this role" (change `PrettyConversationRow.tsx:1352`).

**Steps:**
1. In `PrettyConversationRow.tsx:1352`, change `label: "Clone"` to `label: "Spawn under this role"` (or planner-chosen wording — shape says "renamed to reflect it just spawns another agent under the same role").
2. In `PrettyConversationsPanel.handleRowClone`, refactor from opening `CloneAgentDialog` to opening `NewSessionDialog` with `initialHost` + `initialRole` pre-filled.
3. Delete `CloneAgentDialog.tsx` + `CloneAgentDialog.test.tsx` (or mark deprecated; delete during executor pass).
4. Existing test `PrettyConversationsPanel.clone-dialog.test.tsx` needs update to assert the new flow (opens NewSessionDialog, not CloneAgentDialog).

### Stream 7: Frontend — Task pill on chat surface

1. Add a new sibling to `IdentityBadge` in `PrettyView.tsx:3011-3019`:

```tsx
{pvIdentity?.task && (
  <div
    className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] pv-identity-breathe select-none font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]"
    style={{
      borderRadius: 20,
      padding: "6px 14px",
      maxWidth: "50%",
      background: `linear-gradient(160deg, hsla(${pvHue}, 45%, 25%, 0.72), hsla(${pvHue}, 40%, 15%, 0.82))`,
      backdropFilter: "blur(24px) saturate(1.4)",
      WebkitBackdropFilter: "blur(24px) saturate(1.4)",
      border: `1px solid hsla(${pvHue}, 65%, 55%, 0.4)`,
      boxShadow: `0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.14), 0 0 24px hsla(${pvHue}, 65%, 55%, 0.24)`,
      color: "#e8e4d8",
      fontSize: 13,
      fontWeight: 500,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      animation: "pv-identity-breathe 5s ease-in-out infinite",
    }}
  >
    {pvIdentity.task}
  </div>
)}
```

2. Verify z-index: IdentityBadge is z-[101]; the pill should be z-[100] so drag interactions on the badge stay above the pill.
3. Alternative: extract to `src/ui/features/terminal/TaskPill.tsx` for test-in-isolation.
4. Test: new `PrettyView.task-pill.test.tsx` (or extend existing PrettyView tests) — pill present when task truthy, absent when null.

### Stream 8: Frontend — Task-primary conversation row

1. In `PrettyConversationRow.tsx:1273-1288`, modify the `.pv-body` block to gate on `identity?.task` truthy vs null:

```tsx
<div className="pv-body">
  {identity?.task ? (
    <>
      <span className="pv-label">{identity.task}</span>
      <span className="pv-ai-title">
        <strong>{identity.role}</strong>
        {" "}
        <span className="pv-hostname-suffix">({identity.displayName})</span>
      </span>
    </>
  ) : (
    // Current (fallback) markup — preserved verbatim per D-06:
    <>
      <span className="pv-label">
        {identity ? identity.displayName : row.label}
        {(identity?.title || row.host?.name) && (
          <span className="pv-hostname-suffix"> ({identity?.title || row.host?.name})</span>
        )}
      </span>
      {aiTitle !== null ? (
        <span className="pv-ai-title">{aiTitle}</span>
      ) : (
        <span className="pv-ai-title pv-ai-title--placeholder">…</span>
      )}
    </>
  )}
</div>
```

2. If executor discovers the role-prominent + name-parens subtitle needs a small typography tune (e.g., role weight vs current 500), add `.pv-role-prominent` sibling class as escape hatch.
3. Test: extend `PrettyConversationRow.test.tsx` — assert task-primary display when identity.task truthy, fallback when null.

## Test Surfaces to Cover

Existing tests to preserve/extend:

| Test file | Existing coverage | Phase 80 additions |
|-----------|------------------|-------------------|
| `src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` | `extractCosmeticsFromFrontmatter` narrowing (displayName, title, colorHue, voice, avatar, coordinator) | Add task narrowing tests (non-empty string, empty string dropped, non-string dropped) |
| `src/backend/database/routes/identities.get-disk.test.ts` | `publicIdentity` shape (PUB-*), GET / fanout | Add task to publicIdentity assertions; add task-in-response cases |
| `src/backend/database/routes/identities.put-disk.test.ts` | PUT / disk-write | (task is write-once at birth, not edited via PUT per D-05 — no PUT changes needed) |
| `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` | `buildIdentityFileBody` frontmatter emission | Add task emission tests (present, absent-omit) |
| `src/backend/database/routes/identity-birth.test.ts` | HTTP handler validation + orchestrator wire | Add task body validation tests |
| `src/backend/matrix/matrix-admin-client.test.ts` | Existing 4 primitives (createOrUpdateUser, loginAsUser, joinRoom, listRooms) | Add `countUsersMatching` unit tests |
| `src/ui/sidebar/NewSessionDialog.test.tsx` | Modal shell + host picker | Add task-input test file (new) |
| `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` | Role dropdown gating on host | Extend — pool-prefill of name when role picked |
| `src/ui/sidebar/CloneAgentDialog.test.tsx` | Clone flow | If CloneAgentDialog deleted: delete tests. If repurposed: rewrite to assert opens NewSessionDialog |
| `src/ui/features/pretty-view/PrettyView.tsx` (no dedicated tests today — inline within other PrettyView test files) | — | New file `PrettyView.task-pill.test.tsx` — pill present when task truthy, absent otherwise, hue-tinted from colorHue |
| `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | Row rendering | Add task-primary display tests + fallback tests |

New test files to create:

- `src/backend/pool/pool-loader.test.ts` — pool JSON loading contract
- `src/backend/pool/pool-routes.test.ts` — POST /identities/pool/pick contract
- `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` — task textarea + soft-cap behavior
- `src/ui/features/pretty-view/PrettyView.task-pill.test.tsx` — pill render + null-fallback
- `src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx` — task-primary rendering

## Package Legitimacy Audit

**No new external packages required.** Every Phase 80 concern uses existing project dependencies:
- `js-yaml` (already used in `identity-artifact-reader.ts` for frontmatter parsing) — extends to task emission
- `node:crypto`, `node:fs`, `node:path` (already used) — pool loader
- Express + existing auth middleware (already used) — pool-pick route
- React + shadcn Dialog + existing pickers (already used) — modal rebuild

Nothing needs `slopcheck` verification because nothing is being installed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Identity key (folder name) diverges from MXID localpart post-Phase-80 (folder = lowercase `willow`, MXID = `Willow-Skynet-Maintainer`) | Landmines §9 | If Alice wants identity key === MXID localpart (option (a)), the birth-orchestrator wiring changes significantly. Also affects sessionMatchKey resolution. Confirm during discuss-phase or with Alice. |
| A2 | Backend pool-pick returns just the bare pool NAME (e.g. `willow`); birth-orchestrator handles ordinal-derivation at creation time based on `<final-name>-<role>` | Landmines §8, Stream 3 | If Shape B (backend returns full handle) is desired, endpoint contract changes and user-edit-then-collide handling shifts to the birth-orchestrator retry path. Recommend Shape A but planner should lock in discuss-phase. |
| A3 | Clone should NOT inherit task (task is the WHY of THIS new spawn) | Stream 4 (identity-clone.ts) | If clone inherits task, the "clone as spawn-under-role with fresh task" reframing loses coherence. Aligns with shape §Frontend creation flow which says clone becomes a thin entry-point into unified modal — user re-inputs task each time. |
| A4 | "Role select bug" = role dropdown gated on host being picked (line 961). Fix = auto-pick sole host / add "pick host first" hint | Landmines §2 | If the actual bug is different (e.g., state resets on identityMode toggle, form submits with empty role), the fix is different. Confirm with Alice or reproduce during executor implementation. |
| A5 | Task pill should use z-[100] (below IdentityBadge's z-[101]) | Stream 7 | If task pill needs to be above IdentityBadge for drag priority, swap z-indexes. Low impact. |
| A6 | Reusing existing `.pv-label` + `.pv-ai-title` CSS classes verbatim covers D-03 requirement | Stream 8 | If pixel-tuning is needed for the role-prominent style, executor adds a small sibling class. D-03 explicitly says "any pixel-level tuning surfaces as executor decision, not planning question." |
| A7 | Character soft-cap on task input = "~15-20 words" from shape file translates to roughly 100-140 chars — executor pins exact number when badge pill renders at real widths | Stream 5 | Shape file explicitly defers this to Phase A implementation (Claude's Discretion). Not a blocker. |
| A8 | Pool loader ships with whatever Alice's vetted list is at ship time (shape file: "Phase 80 ships with whatever vetted list is landed at ship time") | Stream 1 | Alice has parallel-vetting responsibility. Coordination gate is at ship, not at plan. |

## Open Questions (RESOLVED)

*All items below were resolved during the plan-checker revision cycle 2026-09-06. Each `**Resolution:**` line captures the locked answer that downstream plans implement.*

1. **A1 (identity key vs MXID localpart divergence)** — must be answered before executor work on backend Stream 4. See Landmines §9. Recommendation: option (b), diverge.
   **Resolution:** DIVERGE per orchestrator lock (2026-09-06, shape file greenlit by Alice). Identity key = lowercase folder (e.g. `willow`, matches `IDENTITY_KEY_RE`). MXID localpart = PascalCase-hyphenated `<PoolName>-<Role>` (e.g. `Willow-Skynet-Maintainer`) with silent auto-suffix `-2`, `-3`, ... on collision. Implemented by plan 80-03b (composeMxidLocalpart + deriveMxidWithOrdinal inside Step 6 of the birth orchestrator). Legacy manually-created identities (Taylor, Tina, Tabitha, etc.) are NOT retroactively renamed — the new derivation gates on `opts.poolPicked === true`, which the frontend sets only when the name came from `pickPoolName` prefill and the user did not edit it.

2. **A2 (pool-pick endpoint response shape)** — must be answered before executor work on backend Stream 3. Recommendation: Shape A.
   **Resolution:** Shape A. Backend `POST /identities/pool/pick` returns bare lowercase pool name (e.g. `{ name: "willow" }`); birth-orchestrator handles handle composition + ordinal at creation time (plan 80-03b). The picker's "is this taken" check MUST use the FULL base-handle MXID (`@<PascalCandidate>-<PascalHyphenatedRole>:<server>`) because real Matrix accounts are minted with the PascalCase-hyphenated shape per A1 — a bare-lowercase check would return false-negatives and hand back names already taken in their real form. Plan 80-04 Task 1 encodes this correction with a grep gate against the bare-lowercase pattern and a regression test asserting the full-handle pattern in `countUsersMatching` call args.

3. **A4 (actual "role select bug" repro steps)** — request Alice reproduce or provide expected behavior. Recommendation: default identity-mode ON + auto-pick sole host + "pick host first" hint.
   **Resolution:** Fix during Phase 80 as part of the unified-modal rebuild (plan 80-06 Task 3). Executor picks Approach A (visible "Pick a host to see available roles" hint outside the role-cluster wrap when `identityMode && selectedHost === null`) OR Approach B (widen the existing `flatHosts.length === 1` auto-pick to also default to the local Skynet host when identifiable). Actual repro of the original bug is deferred to executor time — the plan's fix works for both the confirmed axis (role dropdown gated on host) and the plausible alternative axes (state reset on identityMode toggle, empty-role submit rejection).

4. **Clone label wording** — "Spawn under this role" vs "New agent for this role" vs something else. Executor decision if not locked.
   **Resolution:** "Spawn under this role" locked from plan 80-09's approach. Rationale: matches the shape file's phrasing ("context-menu Clone gets renamed to reflect it simply spawns another agent under the same role") and stays terse enough for a context-menu label. Plan 80-09 Task rename `label: "Clone"` → `label: "Spawn under this role"` in `PrettyConversationRow.tsx:1352`.

5. **Task edit escape hatch documentation** — D-05 locks "write-once at creation" but shape says "manual on-disk edit is the escape hatch." Should the plan include documentation surface (e.g., admin runbook) or is this out-of-scope? Recommendation: out of scope for Phase 80; document in Phase C's id-skill body edits.
   **Resolution:** Out of scope for Phase 80 per D-05 (locked: task field is write-once at creation, no in-UI edit affordance). The escape hatch is a manual on-disk edit of the identity file's frontmatter — same edit path any other cosmetic field (title, voice, colorHue) uses today. Documentation of the escape-hatch procedure is deferred to Phase C's id-skill body prose edits, not a Phase-80 executor concern.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | (project baseline — from package.json) | — |
| Synapse admin API (via `matrix_admin_creds`) | Pool-pick endpoint (ordinal derivation) | ✓ (on live Skynet with Phase 77 shipped) | Synapse 1.157.2 verified | 503 fail-early gate at endpoint entry (mirror `identity-birth.ts:158-165`) |
| SSH connectivity to target host | Birth flow (unchanged from Phase 77) | ✓ | — | Existing 502 error handling |
| `js-yaml` npm | Frontmatter parse/emit (existing) | ✓ | (existing project dep) | — |
| Express | Route mount (existing) | ✓ | (existing) | — |

No missing dependencies. No fallbacks needed.

## Security Domain

Task field itself is not security-sensitive (it's user-facing display text). But the following STRIDE surfaces exist:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `AuthManager.createAuthMiddleware()` on all new endpoints |
| V3 Session Management | yes (inherited) | JWT cookie auth (existing) |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` gate on pool-pick endpoint |
| V5 Input Validation | yes | Task string length cap (e.g. ≤200 chars) + trim; role name validated via `ROLE_NAME_PATTERN`; pool name from vetted seed (no user input) |
| V6 Cryptography | no | No new cryptographic ops |

### Known Threat Patterns for Phase 80

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via task string on chat pill / conversation row | Tampering (T) | React auto-escapes text content — no `dangerouslySetInnerHTML`; task rendered as plain text child |
| Task string YAML injection at birth-write time | Tampering (T) | `yaml.dump` with `forceQuotes: false` correctly quotes strings containing colons/newlines automatically (T-66-01-04 already documented) |
| Cross-user pool-pick call spoofing hostId | Elevation of Privilege (E) | `resolveHostById(hostId, userId)` 404 on unowned hostId (mirror pattern from `roles-list-for-host.ts`) |
| Task string oversized DoS | Denial of Service (D) | Length cap in body validation (recommend ≤500 chars server, ≤200 chars soft-cap client) |
| Pool JSON tampering (attacker replaces `pool.json` at runtime) | Tampering (T) | File lives inside Docker image (`/app/pool-defaults/`); readable but not writable at runtime unless attacker has container root — same threat surface as branding-defaults |
| Admin API credential leak via pool-pick logs | Info Disclosure (I) | Mirror `matrix-admin-client.ts` discipline: never log admin token, never log response bodies |

## Sources

### Primary (HIGH confidence — read files directly)

- `src/backend/database/routes/identity-birth-orchestrator.ts` (whole file, especially L107-242 BirthDeps, L345-380 buildIdentityFileBody, L456-585 runRelayMintAndWrite)
- `src/backend/database/routes/identity-birth.ts` (whole file — HTTP handler)
- `src/backend/database/routes/identities.ts:80-540` (publicIdentity + GET/PUT)
- `src/backend/database/routes/identity-clone.ts:1-160` (clone contract for repurpose reference)
- `src/backend/claude-session/identity-artifact-reader.ts:411-448` (readIdentityFile), L2079-2145 (extractCosmeticsFromFrontmatter)
- `src/backend/matrix/matrix-admin-client.ts` (whole file — existing 4 primitives, buildRelayJsonBody)
- `src/backend/matrix/matrix-admin-creds-store.ts:29,163-166` (DatabaseSaveTrigger usage pattern)
- `src/backend/branding/branding-config-loader.ts:1-160` (JSON-in-repo seed loader pattern)
- `src/backend/database/database.ts:1800-1890` (route mount ordering)
- `docker/Dockerfile:78` (branding-defaults COPY pattern)
- `src/ui/sidebar/NewSessionDialog.tsx` (whole file — 1400 lines)
- `src/ui/sidebar/CloneAgentDialog.tsx` (whole file — 651 lines)
- `src/ui/sidebar/CreateRoleDialog.tsx:14,100,190-191` (chain hook mechanism)
- `src/ui/api/identities-api.ts:1-400` (frontend Identity type + BirthRequest)
- `src/ui/state/identities-store.ts:1-80` (store loading pattern)
- `src/ui/features/pretty-view/PrettyView.tsx:2940-3020` (PrettyView root + IdentityBadge mount)
- `src/ui/features/terminal/IdentityBadge.tsx:1-200` (badge glass treatment)
- `src/ui/features/pretty-view/coordinator-watermark.ts` (hue-aware overlay pattern)
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:200-320,1245-1360` (row body markup + Clone menu)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:200-270,1240-1260` (row live wrapper + handleRowClone)
- `src/ui/features/pretty-conversations/pretty-conversations.css:686-770` (row typography classes)
- `.planning/phases/77-*/77-RESEARCH.md` (Synapse admin API patterns from Phase 77 research)
- `.planning/phases/66-*/CONTEXT.md` (disk-authoritative pattern origin)

### Secondary (MEDIUM confidence — verified via WebFetch)

- [Synapse Admin API — User Admin API](https://matrix-org.github.io/synapse/latest/admin_api/user_admin_api.html) — confirmed `GET /_synapse/admin/v2/users` supports `user_id` substring filter, `deactivated` param, returns `total` count. Direct fetch 2026-09-06.

### Tertiary (LOW confidence — search-only, needs verification during executor phase)

- None. All key claims verified against source files or authoritative docs.

## Metadata

**Confidence breakdown:**
- Backend patterns (frontmatter, disk-writes, matrix-admin): HIGH — all traced to specific lines
- Frontend patterns (modal, badge, row): HIGH — all traced to specific lines
- Pool loader / seed JSON: HIGH — direct mirror of branding-config pattern
- Ordinal-derivation Synapse endpoint: HIGH — verified via WebFetch against Synapse docs 2026-09-06
- "Role select bug" root cause: MEDIUM — inferred from code inspection; not confirmed with Alice
- Identity key vs MXID localpart divergence: MEDIUM — inferred from shape file's phrasing; needs Alice confirmation

**Research date:** 2026-09-06
**Valid until:** 2026-10-06 (30 days — stable substrate, Phase 77 shipped same day so no substrate churn expected)

