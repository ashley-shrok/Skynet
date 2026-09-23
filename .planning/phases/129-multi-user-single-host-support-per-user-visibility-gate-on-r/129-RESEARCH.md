# Phase 129: multi-user-single-host support — Research

**Researched:** 2026-09-23
**Domain:** Skynet backend read path (identity/role frontmatter merge) + creation-time auto-tag + frontend role picker
**Confidence:** HIGH

## Summary

The Skynet codebase is unusually well-positioned for this phase. The identity/role cosmetics merge already has a single authority (`resolveIdentityAppearance` in `src/backend/fleet-status/identity-appearance.ts`) that ALL three read paths delegate to: the request-time `GET /identities` fanout, the 2s SSH-poll orchestrator's WS-live frames, and the SSE birth stream's post-write echo. Adding a `users?: string[]` field to `RawCosmetics`, parsing it in `extractCosmeticsFromFrontmatter`, and computing the intersection gate inside `resolveIdentityAppearance` covers cosmetics-level gating with a single edit.

The deep-gate requirement (no orphan session rows) is the harder half. Three distinct wire surfaces expose identity keys: (1) `GET /identities` returns per-identity rows via `publicIdentity()`, (2) `GET /sessions/list` returns tmux session rows keyed by sessionName===identityKey, (3) the WS fleet-status stream emits `snapshot`/`update`/`gone`/`identity-archived` frames whose payloads carry identity names. There is already a `AppFrameFilter` per-subscriber projection layer (`src/backend/fleet-status/app-frame-filter.ts`, Phase 118 Plan 118-05) that routes ALL frame types (not just apps) through per-subscriber checks — currently it only checks host access, but it's the natural seam to extend for identity-level gating. `GET /identities` and `GET /sessions/list` need per-user filtering added directly in their handlers.

Creation-time auto-tag has two clean hook points: `POST /roles` (`roles-create.ts` L554-564, where the frontmatter dict is built via `yaml.dump`) and `POST /identities/birth` → `identity-birth-orchestrator.ts`'s `buildIdentityFileBody` (L544-604, same yaml.dump pattern). Both already build the frontmatter as a `pairs[]` array with absent-⇒-omit semantics — adding a conditional `users` entry is a 3-line change per site. Multi-user detection is a cheap DB query against the `hostAccess` table (Skynet's existing sharing mechanism).

Zero migration is guaranteed by the fallback rule (absent `users:` field = visible to everyone with host access); this is already the shape of every other cosmetic field in `extractCosmeticsFromFrontmatter`.

**Primary recommendation:** Ship in this task order — (a) add `users?: string[]` to `RawCosmetics` and `extractCosmeticsFromFrontmatter`; (b) add gate logic to `resolveIdentityAppearance` (returns `null` when hidden, distinguishable from resolved-with-no-cosmetics); (c) filter at `GET /identities` and `GET /sessions/list` handlers; (d) extend `filterAppFrame` with identity-name gate on `update`/`snapshot`/`gone`/`identity-archived` and `identity-cosmetics-changed`-if-any; (e) filter `roles-list-for-host.ts`; (f) auto-tag at both create endpoints; (g) tests + a `POST /conversation-search` filter pass; (h) any missed surfaces from the "no leaks" audit table below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `users:` frontmatter field parsing | Backend / read-path lib | — | `extractCosmeticsFromFrontmatter` is already the one authority; every read path funnels through it |
| Intersection gate application | Backend / read-path lib | — | Belongs in `resolveIdentityAppearance` next to the identity ?? role cascade; single authority survives (Phase 111 T-111-08 invariant) |
| Multi-user host detection | Backend / DB layer | — | Query against `hostAccess` table + `hosts.userId` owner; cheap synchronous SQL, no cross-service call |
| Auto-tag on role/identity creation | Backend / route handler | — | Both `POST /roles` and `POST /identities/birth` already own the frontmatter build step; no new SSH round-trip needed |
| Deep-gate on session list | Backend / route handler + WS filter | — | `GET /sessions/list` filters directly; `AppFrameFilter` on the WS extended to identity-name gate |
| Role picker gate | Backend / route handler | — | Backend-side filter in `roles-list-for-host.ts` — client just renders what it gets, and this keeps the gate on the same authority as the sidebar's identity read |
| Frontend rendering | Frontend / passive | — | No new UI affordance — sidebar just renders fewer rows; role dropdown just shows a shorter list. No code change in `conversation-store.ts` or `NewSessionDialog.tsx` beyond what falls out of shorter API responses |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| Storage | New `users:` YAML list on both role AND identity frontmatter | § "Frontmatter write pattern" below — both files use `yaml.dump(pairs, {sortKeys:false, ...})` with absent-⇒-omit; adding `["users", [...]]` conditionally is a 3-line change per site |
| Gate semantics | Intersection: `(role.users empty OR user ∈ role.users) AND (identity.users empty OR user ∈ identity.users)` | § "Gate application seam" — belongs inside `resolveIdentityAppearance`; returning `null` for hidden identities gives every caller a single sentinel to filter on |
| Fallback | Empty/absent `users` = visible to everyone with host access | § "Zero-migration invariant" — mirrors the existing absent-⇒-omit pattern that every other cosmetic field already uses; no schema migration, no defaulting |
| Auto-tag on multi-user hosts only | Backend writes creator's username to new file ONLY when host has >1 Skynet user with access | § "Multi-user detection" — one DB SELECT per create request; count = 1 (owner alone) + rows in `hostAccess` where `hostId=?` |
| Deep gate | Hidden identity leaves NO evidence anywhere — no orphan session rows | § "No-leak audit" table lists every surface; filter at each seam |
| Role picker gate | GET `/roles?hostId=<n>` respects role.users | § "Role picker filter" — extend `roles-list-for-host.ts` (already reads role frontmatter, already knows userId) |
| NO new UI affordance | Sharing = manual frontmatter edit | No frontend code change beyond passively rendering shorter API responses |
| Not a permission system | Visibility filter only; no backend permission enforcement beyond current host-access gate | § "Threat model" — no new SSH gates, no new write endpoints, no admin override |

## Standard Stack

### Core (already in the codebase — reuse verbatim)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `js-yaml` | ^4.1.1 (verified `package.json:64`) | Parse + emit frontmatter YAML | Every existing read/write path uses `yaml.load`/`yaml.dump` with `sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false` [VERIFIED: package.json + `identity-artifact-reader.ts:40, 570-575`] |
| `drizzle-orm` | ^0.45.2 (verified `package.json:59`) | DB query for `hostAccess` fanout | Already used everywhere; multi-user detection is one `select({count: sql`count(*)`})` |
| `vitest` | ^3.x (`package.json:20-23`) | Unit test framework | Mirror `identity-appearance.test.ts`, `identities.get-disk.test.ts`, `identity-birth-orchestrator.test.ts` patterns |

**No new libraries needed.**

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Gate inside `resolveIdentityAppearance` | Gate outside at each call site | Rejected — violates the T-111-08 "one cascade authority" invariant and creates three drift risks (fanout, poll, birth). The three callers are exactly the places that would drift. |
| Gate returns `null` for hidden identities | Gate returns a special `{hidden: true}` marker | Rejected — every caller would have to branch on a new state; `null` collapses cleanly with the existing "identity missing from disk" and "readIdentityFile failed" null paths |
| Auto-tag inside a shared frontmatter helper | Inline auto-tag at both create sites | Recommended INLINE — the two build paths are already divergent (`roles-create.ts` uses `yaml.dump({title,voice,avatar,colorHue})`, `identity-birth-orchestrator.ts` uses `buildIdentityFileBody(opts, displayName, avatarFilename)` with a `pairs[]` array). Two 3-line insertions beat a shared abstraction. |

**Installation:** No new packages.

## Package Legitimacy Audit

Not applicable — no new packages installed in this phase.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────┐
                        │  ROLE / IDENTITY FRONTMATTER (on disk)  │
                        │  ~/fleet/roles/<slug>/<slug>.md         │
                        │  ~/fleet/identities/<key>/<key>.md      │
                        │  + NEW: users?: [<skynet-usernames>]    │
                        └───────────────────┬─────────────────────┘
                                            │ SSH read (per request or per 2s tick)
                                            ▼
                        ┌─────────────────────────────────────────┐
                        │  identity-artifact-reader.ts            │
                        │  extractCosmeticsFromFrontmatter()      │
                        │  → RawCosmetics {…, users?: string[]}   │  ◀── EDIT #1 (parse)
                        └───────────────────┬─────────────────────┘
                                            │
             ┌──────────────────────────────┼───────────────────────────────┐
             ▼                              ▼                               ▼
   GET /identities                GET /sessions/list           2s SSH poll (ssh-poll-orchestrator)
   (identities.ts L294)           (sessions.ts L294)           (Python sweep script → SweepIdentityLine)
             │                              │                               │
             │ per-identity call            │ per-session role lookup       │ per-identity call
             ▼                              ▼                               ▼
     resolveIdentityAppearance ── (shared single authority) ── resolveIdentityAppearance
     ({identityKey, roleCosmetics, cosmetics, role, pinned, users?})
     → ResolvedIdentityAppearance | null   ◀── EDIT #2 (gate)
             │                              │                               │
             ▼                              ▼                               ▼
        publicIdentity()             (session row)              subscription-registry
        → JSON row                                              .publishSessionState()
             │                              │                               │
             │                              │                               ▼
             │                              │              filterAppFrame(frame, userId)  ◀── EDIT #3 (WS filter extension)
             │                              │                (already exists — extend to identity-name gate)
             │                              │                               │
             ▼                              ▼                               ▼
       [caller-side null-drop]    [caller-side null-drop]     [per-subscriber projection]
             │                              │                               │
             └──────────────────────────────┴───────────────────────────────┘
                                            │
                                            ▼
                                   Skynet frontend
                                   (conversation-store.ts joins /identities + /sessions/list)


     CREATE FLOWS (auto-tag on multi-user hosts only)

     POST /roles                                    POST /identities/birth
     (roles-create.ts L554-564)                     (identity-birth-orchestrator.ts L544-604)
             │                                              │
             │ userId from JWT                              │ userId from JWT (BirthOptions.userId)
             ▼                                              ▼
     countUsersWithHostAccess(hostId, db)  ← NEW helper (one SQL query, shared)
             │                                              │
             │ if count > 1:                                │ if count > 1:
             │   users = [creatorUsername]                  │   users = [creatorUsername]
             ▼                                              ▼
     yaml.dump({..., users}, {sortKeys:false})     buildIdentityFileBody adds ["users", [creator]]
             │                                              │
             ▼                                              ▼
     writeMarkdownFileAtomic(conn, targetPath, body)  (both go through this SFTP tmp+rename primitive)
```

### Recommended Component Responsibilities

| File | Responsibility | Edit Type |
|------|---------------|-----------|
| `src/backend/fleet-status/identity-appearance.ts` | Add `users?: string[]` to `RawCosmetics`; add gate to `resolveIdentityAppearance`; return `null` when hidden | Extend types + one gate branch |
| `src/backend/claude-session/identity-artifact-reader.ts` L3128-3236 | Parse `users:` in `extractCosmeticsFromFrontmatter` (array-of-strings narrowing) | Add one field to output type + parse block |
| `src/backend/database/routes/identities.ts` L294 | Filter identityList by gate result (drop nulls) | `.filter((x) => x !== null)` already exists — the resolver returning null is the new signal |
| `src/backend/database/routes/sessions.ts` L294 | Filter session rows by identity gate — lookup identity frontmatter for each session's `sessionName` and drop if hidden | New per-session gate call in the roleResolveBlock area (reuses same conn) |
| `src/backend/database/routes/roles-list-for-host.ts` L237-266 | Filter role list by `role.users` intersected with caller's username | New filter after cosmetics extract, before response |
| `src/backend/fleet-status/app-frame-filter.ts` | Extend `filterAppFrame` to also check identity-name against a `resolveIdentityGate(identityName, hostIdStr, userId)` shim | New async helper + branches for `update`/`snapshot`/`gone`/`identity-archived` |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` L1152-1198 (`appearanceFromIdentityLine`) | No change — resolver returning null flows through cleanly if callers filter | Verify downstream tolerates null (currently returns null for pre-111-01 hosts, so path already exists) |
| `src/backend/database/routes/roles-create.ts` L554-564 | Auto-tag: if `countUsersWithHostAccess(hostId) > 1`, append `["users", [creatorUsername]]` before `yaml.dump` | 3-line addition |
| `src/backend/database/routes/identity-birth-orchestrator.ts` L544-604 (`buildIdentityFileBody`) | Same auto-tag pattern, using new `BirthOptions.creatorUsername?: string` (threaded from `identity-birth.ts` after DB lookup) | 3-line addition + thread creatorUsername through opts |
| `src/backend/database/routes/identity-birth.ts` L92-345 | DB SELECT for creator username; DB call for `countUsersWithHostAccess`; pass both to orchestrator | 6-8 lines pre-orchestrator |
| `src/backend/database/routes/conversation-search.ts` | Filter results by identity gate — one extra frontmatter read per hit OR bulk-fetch identities-per-host to build a hidden set | New filter pass in per-host branch |
| **NEW** `src/backend/database/routes/host-user-counter.ts` (or inline helper) | Shared `countUsersWithHostAccess(hostId, db)` — used by both create endpoints | New module |

### Pattern 1: Absent-⇒-Omit Frontmatter Field (the invariant that guarantees zero migration)

**What:** Every optional field in the frontmatter dict is only emitted when it has a non-empty value. Consumers distinguish "absent" from "present-but-empty" and never emit `field: null` or `field: ''`.

**When to use:** Any new frontmatter field on the identity or role side. Load-bearing for zero-migration semantics.

**Example (verified from `identity-birth-orchestrator.ts` L544-604):**
```typescript
// Source: identity-birth-orchestrator.ts (L556-585, verbatim shape)
function buildIdentityFileBody(opts, displayName, avatarFilename) {
  const pairs: Array<[string, string | number | string[]]> = [];
  pairs.push(["role", opts.role]);            // always present
  pairs.push(["displayName", displayName]);   // always present
  if (typeof opts.title === "string" && opts.title.trim().length > 0) {
    pairs.push(["title", opts.title]);
  }
  // colorHue: skip if null (integer 0 is a valid hue)
  if (opts.colorHue !== null && opts.colorHue !== undefined) {
    pairs.push(["colorHue", opts.colorHue]);
  }
  // NEW for phase 129 — same shape:
  if (Array.isArray(opts.users) && opts.users.length > 0) {
    pairs.push(["users", opts.users]);  // yaml.dump handles arrays cleanly
  }
  const yamlBody = yaml.dump(
    stringifyColorHueForYaml(Object.fromEntries(pairs)),
    { sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false },
  );
  return `---\n${yamlBody}---\n\n# ${opts.name}\n`;
}
```

### Pattern 2: Single-authority merge with fail-closed null-cosmetics contract

**What:** All identity+role cosmetics merges route through ONE call to `resolveIdentityAppearance`. Fail-closed contract: a `null` cosmetics arg (unreadable file) is treated identically to `{}` — every field falls through to its role value or safe default.

**When to use:** Any new cosmetic-adjacent field added to the merge. The gate is exactly this kind of field.

**Example (verified from `identity-appearance.ts` L142-222):**
```typescript
// Source: identity-appearance.ts:142
export function resolveIdentityAppearance(args: {
  identityKey: string;
  hostId: number;
  cosmetics: RawCosmetics | null;
  roleCosmetics: RawCosmetics | null;
  role: string | null;
  pinned: boolean;
  // NEW for phase 129:
  callerUsername: string | null;  // null = no gate applied (backward-compat + tests)
}): ResolvedIdentityAppearance | null {  // NEW nullable return
  const cosmetics = args.cosmetics ?? {};
  const roleCos = args.roleCosmetics ?? {};

  // Intersection gate — both must pass. Empty/absent list = "no gate on this side".
  if (args.callerUsername !== null) {
    const roleGateOpen = !Array.isArray(roleCos.users)
      || roleCos.users.length === 0
      || roleCos.users.includes(args.callerUsername);
    const identityGateOpen = !Array.isArray(cosmetics.users)
      || cosmetics.users.length === 0
      || cosmetics.users.includes(args.callerUsername);
    if (!(roleGateOpen && identityGateOpen)) return null;  // HIDDEN
  }

  // …rest of merge unchanged…
}
```

**Decision to lock:** Should the gate use case-insensitive comparison? Skynet's `users.username` column is stored as-typed (no normalization at register — see `users.ts` L172 `eq(users.username, username)`). Frontmatter is authored manually. Recommend **case-sensitive** comparison to match how the DB compares — the user + Zoe can agree on lowercase and both editing surfaces (frontmatter + Skynet register) will match. Document this in CONTEXT if it becomes a footgun.

### Pattern 3: Per-subscriber WS filter (leveraging the existing AppFrameFilter machinery)

**What:** The `subscription-registry.ts` already routes ALL frames (session, identity-archived, project-list, apps) through `filterAppFrame` per-subscriber when a filter is wired. This is done by Phase 118 Plan 118-05 primarily for host-access gating, but the plumbing is frame-type-agnostic.

**When to use:** Every WS-side gate. The identity gate is a natural extension — call `resolveIdentityGate(identityName, hostIdStr, userId)` alongside the existing `canUserSee(hostIdStr)` check.

**Example (verified from `app-frame-filter.ts` L200-283):**
```typescript
// Source: app-frame-filter.ts:200 (existing structure — extend inside each branch)
if (frame.type === "update") {
  if (!(await canUserSee(frame.state.hostId))) return null;
  // NEW: also check identity gate
  if (frame.state.tmuxSession
      && !(await canUserSeeIdentity(frame.state.tmuxSession, frame.state.hostId))) {
    return null;
  }
  return frame;
}

if (frame.type === "snapshot") {
  const states = frame.states;
  if (states.length === 0) return frame;
  const filtered = await Promise.all(states.map(async (s) => {
    const hostOK = await canUserSee(s.hostId);
    if (!hostOK) return null;
    const idOK = s.tmuxSession ? await canUserSeeIdentity(s.tmuxSession, s.hostId) : true;
    return idOK ? s : null;
  }));
  return makeSnapshotFrame(filtered.filter((s): s is SessionState => s !== null));
}
```

The `canUserSeeIdentity` shim reads the identity's + role's frontmatter over SSH, runs the intersection gate, and caches the boolean per `(userId, hostId, identityKey)`. Cache TTL should match `AccessCache`'s 30s default (`app-frame-filter.ts` L104 `DEFAULT_TTL_MS = 30_000`) — frontmatter changes propagate on the same latency window as host-access grants. This is consistent with the shape file's line: "Changing a role's or identity's `users` list requires a redeploy or a restart to take effect. This is on-disk frontmatter and should be picked up on the next read, the same way a display-name change is today."

**Note:** 30s cache violates the shape's stated intent slightly — a `users` list edit today would surface within one 2s poll (unfiltered path). Since we're layering a filter on top, the strictest reading of the shape suggests either (a) no cache at all (accepting the SSH cost per fanout), or (b) cache invalidation on identity-cosmetics-changed events. Recommend **(a) no cache in v1** for correctness — a 2s poll already implies per-tick freshness, and adding a 30s stale layer would visibly regress the "picked up on the next read" promise for the very field this phase is defining. Optimize later if profiling shows it's hot.

### Anti-Patterns to Avoid

- **Duplicating the merge cascade:** Do NOT compute the gate outside `resolveIdentityAppearance`. Phase 111 collapsed three parallel copies into one; a fourth caller adding a parallel gate would recreate exactly the T-111-08 drift risk that phase closed.
- **Gating with a boolean added to `ResolvedIdentityAppearance`:** Do NOT return `{...resolved, hidden: true}` — every downstream consumer would have to branch on a new state. `null` collapses cleanly with existing null paths (identity missing from disk, readIdentityFile failed).
- **Filtering only at the identity-list endpoint:** The shape file's §"What would make it wrong" bullet 2 explicitly says session-list, notifications, search all need gating too. Every table row below is load-bearing.
- **Applying the auto-tag anywhere besides brand-new file creation:** Shape §"Auto-tag scope": "Never rewrites existing values." The auto-tag lives ONLY inside the initial write path; PUT `/identities/:key` and the yaml.dump round-tripper in `writeSessionProjectField` must NOT touch `users:`.
- **Auto-tagging on single-user hosts:** Shape §"Auto-tag conditional": "On single-user hosts, nothing is written and the field stays absent." Every existing operator's UX must be unchanged.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parse/emit | Custom YAML parser or string-splice | `yaml.load` / `yaml.dump` (already imported everywhere with canonical options `{sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false}`) | `identity-artifact-reader.ts` §"LOAD-BEARING CONSTRAINT" at L428-446 spells out why any narrowing-based writer silently drops unknown keys — the auto-tag write path must round-trip through full yaml.load/dump preserving `role:`, `title:`, `project:`, etc. |
| Multi-user host detection | Grep-based "does this host appear in multiple hostAccess rows" | Single SQL: `SELECT COUNT(DISTINCT userId) FROM (SELECT userId FROM hosts WHERE id=? UNION SELECT userId FROM host_access WHERE host_id=?)` | Owner+shares composition is the existing shape; `hostAccess` is the RBAC sharing table (`schema.ts` L500-530), `hosts.userId` is the row owner. Both together = "who can access this host". |
| Per-user-visibility caching on WS | New cache module | Reuse `AccessCache` from `app-frame-filter.ts` L84-132 (30s TTL, per-(userId, key) map) — OR skip cache entirely (recommended for v1 per Pattern 3 note above) | Zero-cost when the frame filter is not wired; deterministic when it is |
| SFTP atomic write for the new frontmatter | Custom tmp+rename | `writeMarkdownFileAtomic` (identity-artifact-reader.ts L2583) — LOCAL+REMOTE branches, `ext_openssh_rename` for atomic overwrite | This primitive already handles the crash-safety + $HOME expansion + local vs remote branching that both create paths need |
| Frontmatter round-trip preserving all keys | `extractCosmeticsFromFrontmatter` + rewrite | Full `yaml.load` / mutate / `yaml.dump` pair — see `writeSessionProjectField` L500-580 for the canonical pattern | The narrowing extractor is READ-ONLY; using it as a round-tripper silently drops `role:`, `project:`, unknown keys — well-documented anti-pattern with a bounty history |

**Key insight:** Almost every primitive this phase needs already exists. The work is composition, not construction.

## Runtime State Inventory

**Not a rename/refactor phase.** N/A.

Every existing on-disk role and identity file across the fleet remains untouched by this phase (no migration). Every existing DB row remains untouched. No new DB table, no new SQLite column, no new sentinel file, no new env var, no new secret. The only runtime state this phase introduces is:

- **New disk state (on multi-user hosts only, per-file):** `users:` YAML key added to newly-created role and identity frontmatter files. Existing files stay as they are; the fallback rule makes them visible-to-everyone.
- **New in-memory WS state:** If the filter extension caches gate decisions, an in-process Map<`${userId}:${hostId}:${identityKey}`, boolean>. Dies with the process.

Nothing else changes at runtime.

## Common Pitfalls

### Pitfall 1: `extractCosmeticsFromFrontmatter` is field-narrowing (not full-parse)

**What goes wrong:** A future edit uses `extractCosmeticsFromFrontmatter` to READ the frontmatter, mutates the returned dict, and writes it back. This silently drops every non-cosmetic field (role, project, custom user-added keys).

**Why it happens:** The extractor's declared output type looks like a full frontmatter representation. It isn't — it's a narrowed subset.

**How to avoid:** For any WRITE-side round-trip through frontmatter, use `yaml.load` / `yaml.dump` directly (see `writeSessionProjectField` L500-580 or the Pitfall 5 note at `identity-artifact-reader.ts:428-446`). For the READ-side gate application, `extractCosmeticsFromFrontmatter` is fine — just add `users?: string[]` to its output type and its narrowing block.

**Warning signs:** A test that writes to an identity file and reads it back sees the frontmatter length shrink. `role:` disappearing from a file is the loud alarm; a bug report of "identity dropped its role" is the silent one.

### Pitfall 2: `resolveIdentityAppearance` is called from THREE sites — all three must pass `callerUsername`

**What goes wrong:** The gate is added but only two of the three call sites are updated. The 2s SSH poll continues to emit un-gated appearance frames, and the WS filter (if kept) hides them again. A test that goes through GET `/identities` passes; a test that goes through the WS shows the identity leaking.

**Why it happens:** The three sites are: `publicIdentity()` in `identities.ts` L153-254, `appearanceFromIdentityLine()` in `ssh-poll-orchestrator.ts` L1152-1198, and the retry echo in `identity-clone.ts` L795-796. The first is easy to find, the second is buried in a 3000-line file, the third is not obviously an "appearance" caller.

**How to avoid:** grep for `resolveIdentityAppearance(` before considering the gate wired. Verify each site threads a `callerUsername` (or `null` when the gate shouldn't apply — e.g., internal-server calls, tests, non-user-facing consumers like fleet-status-sweep-writer-side).

**Alternative design that sidesteps this:** Do NOT put `callerUsername` in `resolveIdentityAppearance`'s signature. Return `ResolvedIdentityAppearance` unchanged from the resolver AND add a companion `isVisibleToUser(cosmetics, roleCosmetics, callerUsername): boolean` pure function that every caller invokes separately. This keeps the resolver's shape stable (Phase 111's T-111-08 invariant is preserved) and makes the "did we gate this call site?" audit visible as a grep for `isVisibleToUser(`. **Recommend this alternative** unless the resolver-signature approach demonstrates a strong benefit.

**Warning signs:** WS `snapshot`/`update` frames arriving for identity keys that the sidebar shouldn't be showing.

### Pitfall 3: `sessions.ts /list` uses `resolveRoleForIdentity`, not `readIdentityFile` — the identity's own `users` list is NOT in scope

**What goes wrong:** The gate is applied only at the role level for session-list rows, because `sessions.ts` L407 reads only the role name (`resolveRoleForIdentity`), not the identity's full frontmatter. Identity-level `users:` narrowing (e.g., a role `[user, zoe]` containing identities each scoped to just one of them) silently doesn't work in the session list.

**Why it happens:** `sessions.ts` was written before this phase and only needed the role name for row grouping. It reads the identity file just enough to extract `role:`.

**How to avoid:** In the roleResolveBlock area (`sessions.ts` L403-425), also extract the identity's OWN cosmetics via `extractCosmeticsFromFrontmatter(markdown)` and the role's cosmetics via `readRoleFileByName(conn, roleName)` + `extractCosmeticsFromFrontmatter`, then run the intersection gate. This adds ONE more SSH round-trip per row (the identity file was already read for role extraction, so we can reuse it — see `resolveRoleForIdentity` at `identity-artifact-reader.ts:400-417` — it internally calls `readIdentityFile`; extract cosmetics from the same markdown result). Role file DOES need a fresh read; memoize per-host per-fetch (mirror the roleReadCache pattern in `identities.ts` L361-386).

**Warning signs:** Two rows appear in the sidebar for the same identity — one from `/identities` (gated correctly and hidden) and one from `/sessions/list` (ungated) as a fleet-synthetic row (`conversation-store.ts` L849-918).

### Pitfall 4: `conversation-search` reads across all identities on all caller hosts

**What goes wrong:** A hidden identity's transcript matches a search query, its `identityKey` and `hostId` leak in the response.

**Why it happens:** `conversation-search.ts` L546-563 selects all `hosts` for the caller, then reads `~/fleet/identities/` and `~/fleet/identities-archive/` on each. No identity-level filter.

**How to avoid:** After building the per-hit results but BEFORE returning, filter by identity gate. For efficiency, batch-fetch the identity+role frontmatter for the unique identity keys that appear in the result list and apply the intersection gate. This is O(unique identities in the result page) not O(all identities on all hosts) — bounded by `DEFAULT_LIMIT`.

**Warning signs:** Search returns hits for identities the user can't see in the sidebar.

### Pitfall 5: Frontmatter round-trip in auto-tag must NOT rewrite existing values

**What goes wrong:** An auto-tag write on a NON-brand-new file rewrites the `users:` list with only the creator's name, blowing away previously-shared entries.

**Why it happens:** The two create paths (`roles-create.ts`, `identity-birth-orchestrator.ts`) always produce a fresh file from scratch — but a future refactor that consolidates auto-tag into a shared "add username to existing frontmatter" helper could accidentally get called on an existing file.

**How to avoid:** Auto-tag lives ONLY inside the initial file-build code path — never touch existing files. Both create endpoints already have a collision probe BEFORE the write (`roles-create.ts` L473-496 checks `if [ -d "$HOME/fleet/roles/${name}" ]`; identity-birth Step 1 in orchestrator similarly). Auto-tag runs AFTER the collision probe passes, on the yaml.dump build path only.

**Warning signs:** A shared-role file has its `users` list unexpectedly reset to just the last person who "did something" in the UI.

### Pitfall 6: JWT gives userId but not username — a DB SELECT is required at both create endpoints

**What goes wrong:** Auto-tag writes the userId (an nanoid-shaped opaque string) into the frontmatter instead of the username. Frontmatter becomes unreadable to humans; the intersection gate compares against `req.userId` and only works accidentally when the code stays consistent.

**Why it happens:** `AuthenticatedRequest.userId` (types/index.ts L780) is the JWT subject — a string like `"JqbJ5OmBQhQ-..."`. `AuthenticatedRequest.user?.username` exists in the type but is NOT populated by `createAuthMiddleware` (auth-manager.ts L949-951 sets only `userId` and `sessionId`).

**How to avoid:** Both create endpoints must add a `db.select({username: users.username}).from(users).where(eq(users.id, userId)).limit(1)` before the auto-tag decision. Same for the gate-apply site — `resolveIdentityAppearance` / the companion `isVisibleToUser` needs the username string, so `publicIdentity` / `filterAppFrame` must lookup once per request/subscriber.

**Warning signs:** Frontmatter files show `users: [JqbJ5OmBQhQ-...]` (opaque IDs).

### Pitfall 7: Case-sensitivity of username comparison — Skynet does NOT normalize on register

**What goes wrong:** the user registers her Skynet account as "user"; Zoe hand-edits a role's frontmatter as `users: [user, Zoe]`. Zoe registered as "zoe" — she doesn't see the shared role.

**Why it happens:** `users.ts` L172 registers with `eq(users.username, username)` — case is stored as-typed. Frontmatter is authored manually. There is no ANY normalization layer between the two.

**How to avoid:** Lock the comparison as case-sensitive AND document it visibly (in the shape's follow-up, in a code comment on the intersection gate, and ideally in the frontmatter linter if one exists). This matches how Skynet already treats usernames elsewhere. The operator responsibility is: match the case of the target's registered Skynet username.

**Alternative:** Lowercase both sides at comparison time. Downside — a lowercase gate then wouldn't visibly show "which username is being tagged" (the user registered as the user but her name is now `user` in every autotagged file). **Recommend case-sensitive** for symmetry with the existing DB shape.

**Warning signs:** Users report "I added them to the users list and it doesn't work" and the diff is only case.

## Code Examples

### Extending `extractCosmeticsFromFrontmatter` to parse `users:`

```typescript
// Source: identity-artifact-reader.ts L3128 (extension pattern)
// Add to output type (both the return signature at :3128-3150 AND the `out` local at :3172-3181):
   users?: string[];

// Add narrowing block (near L3232, alongside other permissive narrowers):
if (Array.isArray(src.users)) {
  const normalized = src.users
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (normalized.length > 0) {
    out.users = normalized;
  }
  // Empty array → out.users stays absent (absent-⇒-omit semantic: caller sees
  // "no gate on this side" via `!Array.isArray(out.users) || out.users.length === 0`).
}
```

### Intersection gate as a pure function (recommended alternative to signature-widening `resolveIdentityAppearance`)

```typescript
// New file: src/backend/fleet-status/identity-visibility-gate.ts
import type { RawCosmetics } from "./identity-appearance.js";

/**
 * Phase 129: per-user visibility gate on roles + identities.
 *
 * Returns true iff BOTH the role's users gate AND the identity's users gate
 * pass for `callerUsername`. An empty/absent list on either side is treated
 * as "no gate on that side" (falls open — matches the shape file's fallback:
 * empty `users` means "visible to everyone with host access").
 *
 * `callerUsername === null` disables the gate entirely (returns true) — used
 * by internal-server consumers (fleet-status sweep writer side, tests, admin
 * bypass sites if any exist).
 *
 * CASE-SENSITIVE comparison. Matches the DB's own username storage discipline
 * (users.username stored as-typed at register; users.ts L172 uses
 * eq(users.username, username)). Documented in phase 129 CONTEXT.md.
 */
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

### Multi-user detection helper

```typescript
// New: src/backend/utils/host-user-counter.ts (or inline into a shared utils file)
import { db } from "../database/db/index.js";
import { hosts, hostAccess } from "../database/db/schema.js";
import { eq, sql } from "drizzle-orm";

/**
 * Phase 129: returns true iff MORE THAN ONE distinct Skynet user has access
 * to the given hostId. Access = row owner (hosts.userId) OR any user granted
 * via hostAccess (permission_level > "view" per Skynet's RBAC gate).
 *
 * A synchronous single-query DB read — cheap enough to invoke on every
 * create request without noticeable latency. In-memory SQLite (Skynet's
 * default per box-maintainer.md invariant §"Skynet DB is in-memory SQLite")
 * makes the query sub-millisecond.
 *
 * Semantics: "> 1 users" NOT "≥ 1 users" — a single-user host (only its
 * owner) must return false so the auto-tag branch stays silent on the
 * common case.
 */
export async function isHostMultiUser(hostId: number): Promise<boolean> {
  // Owner is always one user. Count DISTINCT hostAccess.userId entries; if
  // any exist (whether they include owner or not), we have > 1 user.
  // hostAccess is Skynet's sharing table — a row here means someone besides
  // the owner has been granted access.
  const shares = await db
    .select({ userId: hostAccess.userId })
    .from(hostAccess)
    .where(eq(hostAccess.hostId, hostId));
  // Deduplicate against the owner (a share back to owner would be a UI bug
  // but let's be defensive)
  const ownerRow = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  if (ownerRow.length === 0) return false;  // unknown host → not multi-user
  const distinctUsers = new Set<string>([ownerRow[0].userId]);
  for (const s of shares) {
    if (s.userId !== null) distinctUsers.add(s.userId);
  }
  return distinctUsers.size > 1;
}

/**
 * Phase 129: DB lookup for the caller's username (needed for auto-tag write
 * and gate comparison). userId → username via a single-row SELECT.
 */
export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const { users } = await import("../database/db/schema.js");
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? null;
}
```

### Auto-tag insertion at `POST /roles`

```typescript
// Source: roles-create.ts L541 (context) — insertion after L541 hasCosmetics check
// L541: const hasCosmetics = Object.keys(cosmetics).length > 0;

// NEW pre-yaml.dump block:
const isMultiUser = await isHostMultiUser(hostId);
if (isMultiUser) {
  const creatorUsername = await getUsernameForUserId(userId);
  if (creatorUsername) {
    (cosmetics as Record<string, unknown>).users = [creatorUsername];
  } else {
    // Defensive: a userId that doesn't map to a users row shouldn't be
    // possible past authenticateJWT — but if it happens, treat like
    // single-user host (no gate). Log loudly.
    sshLogger.warn("roles-create: userId lookup failed — auto-tag skipped", {
      operation: "roles_create_username_lookup_failed",
      userId, hostId,
    });
  }
}
// The existing hasCosmetics-gated yaml.dump at L554-564 already picks up the
// new `users` field because it dumps the full cosmetics dict.
```

### Auto-tag insertion at `POST /identities/birth`

Threaded through `BirthOptions` (add `creatorUsername?: string`) and consumed by `buildIdentityFileBody`:

```typescript
// Source: identity-birth.ts route handler — pre-orchestrator step
const isMultiUser = await isHostMultiUser(hostId);
const creatorUsername = isMultiUser ? await getUsernameForUserId(userId) : null;

// Pass into orchestrator opts:
await birthIdentity({
  ...existingOpts,
  creatorUsername: creatorUsername ?? undefined,
}, emit, deps);

// Source: identity-birth-orchestrator.ts buildIdentityFileBody at L544
// Add after L585 (task block), before L587 (yaml.dump call):
if (Array.isArray(opts.creatorUsername ? [opts.creatorUsername] : undefined)
    && opts.creatorUsername) {
  pairs.push(["users", [opts.creatorUsername]]);
}
```

### Applying the gate at `GET /identities`

```typescript
// Source: identities.ts L426 (publicIdentity() call site)
// Post-fanout, before returning res.json(merged):

// Fetch caller's username once per request
const callerUsername = await getUsernameForUserId(userId);

// After merged is built (L475), filter:
const visible = merged.filter((row) => {
  // row.roleDefaults is either null OR the role's raw cosmetics dict OR {}
  const roleCos = row.roleDefaults;  // includes `users?` if role file had it
  // We need the identity's raw cosmetics — reconstruct from the row's
  // fields OR (better) plumb the raw cosmetics through publicIdentity to
  // the row so we don't lose the users:[…] on the way out.
  // ↑ THIS IS A DESIGN QUESTION — see § Open Questions.
  const identityCos = { users: /* need to plumb this through */ };
  return isIdentityVisibleToUser(identityCos, roleCos, callerUsername);
});
return res.json(visible);
```

**Note:** `publicIdentity()`'s returned row currently does NOT carry a `users:` field. To apply the gate at the identities.ts route, either: (a) plumb the raw identity cosmetics through and gate BEFORE calling `publicIdentity`, or (b) add `users` to the returned row (frontend would ignore it), and gate on the row. Option (a) is cleaner — apply the gate on `(cosmetics, roleCosmetics)` at the L426 call site and drop nulls before including in `identityList`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cosmetics merge in three places (identities.ts, ssh-poll-orchestrator, birth echo) | Single-authority `resolveIdentityAppearance` (Phase 111 Plan 111-02) | 2026-09-16 | Any new merge-time field lives in one place; phase 129 gate benefits from this |
| Session-frame filtering not routed through per-subscriber gate | `AppFrameFilter` extended to cover all frame types with per-subscriber projection (Phase 118 Plan 118-05) | 2026-09-18 | Phase 129 identity-name gate can extend `filterAppFrame` rather than build a new mechanism |
| DB-backed identity rows | Fully disk-fanout on `GET /identities` (Phase 68 Plan 68-02) | 2026-08 | Every request reads fresh frontmatter from disk — no cache-invalidation problem for the new `users` field |

**No deprecated approaches to avoid — everything here builds on current, actively-used primitives.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `hostAccess` table is the authoritative source for "who else can see this host" | Multi-user detection | If some other mechanism (RBAC roles, external ACL) also grants host access, single-user hosts might auto-tag inappropriately. Verified `hostAccess` in `schema.ts` L500-530 and it references `roleId` (Skynet RBAC role); a full-fidelity count needs to expand roleId → members too. **Recommend the planner verify by reading `permission-manager.ts canAccessHost` implementation** to be sure the count matches what `checkHostAccess` uses. |
| A2 | Case-sensitive username comparison is the right default | Common Pitfall 7 | If shape/user intent is case-insensitive, needs a `.toLowerCase()` on both sides. Locked as case-sensitive here based on how DB stores usernames; user can override. |
| A3 | 30s cache on the WS filter would over-stale the "picks up on next read" promise; skip cache | Pattern 3 | If SSH cost of reading frontmatter every 2s per identity per subscriber is prohibitive under load, a shorter cache (e.g. 5s aligned with 2s poll cadence) is a reasonable compromise |
| A4 | `sessions.ts` `/list` needs a NEW per-row identity-cosmetics read to apply the identity-side of the gate (not just the role side) | Common Pitfall 3 | If a partial fix (role-side only) is acceptable, we could ship narrower. Shape file bullet 2 ("If the gate hides you, the gate hides you everywhere") strongly suggests full gate. |
| A5 | Reusing the identity file's markdown read across role-name-extract AND cosmetics-extract for the sessions.ts branch (not two SSH round-trips) | Common Pitfall 3 recommendation | Verified: `resolveRoleForIdentity` internally calls `readIdentityFile` and only uses the `role:` field. If we call `readIdentityFile` directly and derive both, we avoid the duplicate read. |
| A6 | No `hostAccess.roleId`-based grant needs to be expanded into member users for the count | Multi-user detection | Depends on whether Skynet uses RBAC-role-scoped host sharing in the user+Zoe's environment. The shape file describes the user + Zoe directly sharing t1000 → almost certainly a direct-user hostAccess row, but plan should sanity-check by running the query on a real dataset. |

## Open Questions

1. **Should the gate return null from `resolveIdentityAppearance` or from a companion `isIdentityVisibleToUser` pure function?**
   - What we know: Both work. The companion-function approach preserves the Phase 111 T-111-08 "single cascade authority" invariant more cleanly.
   - What's unclear: Which pattern the discussion-log or user prefers as a house convention.
   - Recommendation: Companion pure function (§ Common Pitfall 2 alternative). Signal to planner: this is a stylistic call, not a correctness call.

2. **Does `hostAccess.roleId` need to expand into member users for multi-user detection?**
   - What we know: `hostAccess` can grant to `userId` OR `roleId` (Skynet RBAC role, `schema.ts` L506-509). If the user + Zoe share t1000 via a Skynet role that both belong to, the naive `SELECT DISTINCT userId FROM hostAccess WHERE hostId=?` query misses them.
   - What's unclear: Whether operators in practice use `roleId`-based sharing.
   - Recommendation: Plan should either (a) use the same authoritative primitive `permission-manager.ts canAccessHost` uses, or (b) explicitly document that only direct-user shares count for auto-tag detection.

3. **Does the WS `AppFrameFilter` need to also filter `identity-cosmetics-changed` or other identity-carrying frame types beyond the six listed?**
   - What we know: Six frame types carry identity/session data (`update`, `snapshot`, `gone`, `identity-archived`, `session-project-changed`, `project-list-changed`). Verified in `wire-protocol.ts` and `subscription-registry.ts`.
   - What's unclear: Whether new frame types have been added since or are planned.
   - Recommendation: `grep -n "makeUpdateFrame\|makeSnapshotFrame\|make.*Frame" src/backend/fleet-status/wire-protocol.ts` at plan-time to enumerate; add every frame carrying identityKey/tmuxSession/hostId to the filter branches.

4. **Should the auto-tag include the creator on a role file when only the identity file will have `users:` narrowing (or vice versa)?**
   - What we know: Both files independently gate. Shape says both files auto-tag on multi-user hosts.
   - What's unclear: Is there a scenario where auto-tagging both makes the identity un-shareable without the operator remembering to widen BOTH? (Yes — that's the intersection semantics. the user creates role "quiet-ops" on shared t1000, becomes `role.users: [user]`; then creates identity "muffin" under it, becomes `identity.users: [user]`. To share muffin with Zoe, the user must edit both the role frontmatter AND the identity frontmatter.)
   - Recommendation: Document this consequence in a short note in the phase EXECUTE summary — the user should know that a shared identity requires widening both the role's `users` and the identity's `users`. This isn't a bug, it's the intersection semantics landing in practice.

5. **Frontend `conversation-store.ts` — does the sidebar composition need any change?**
   - What we know: The store joins `/identities` + `/sessions/list` into rows (L849-918 fleetSyntheticRows). If both API responses are pre-filtered, the join naturally shrinks. `state.identitiesByKey` (used for lookups) also naturally shrinks.
   - What's unclear: Whether any store-side derived selector accidentally re-surfaces hidden identities from cached state.
   - Recommendation: Test 4 in the phase's test plan: verify that toggling a `users:` list at the frontmatter level (via SSH) and waiting one 2s tick removes the identity from the sidebar entirely, including any WS-live row and any static `/identities` row and any fleet-synthetic row.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `js-yaml` | Frontmatter parse/emit | ✓ | ^4.1.1 | — |
| `drizzle-orm` | DB query | ✓ | ^0.45.2 | — |
| `vitest` | Tests | ✓ | ^3.x (indirect via package.json scripts) | — |
| `ssh2` | SFTP + SSH exec | ✓ (already in code path) | (indirect) | — |
| SQLite (in-memory) | `hostAccess` + `users` lookups | ✓ | Skynet default | — |
| Docker + docker-compose | Deploy — backend TS changes require rebuild + up --force-recreate | ✓ (`docker/Dockerfile`, `docker/docker-compose.yml`) | — | — |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** none

**Deploy note (for orchestrator, not for executor plans):** Backend TypeScript changes require `docker build` + `docker compose up --force-recreate` — the Skynet container serves the compiled backend, not a live-reloaded source. Static-asset refresh alone (frontend hot-reload) is not sufficient because this phase changes backend behavior (WS filter, route handlers, birth orchestrator). Deploy is orchestrator-owned per box-maintainer standing directives — plan tasks MUST NOT include ship/deploy steps.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (already gated by authenticateJWT everywhere) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Existing `checkHostAccess` (host-resolver.ts L497) + NEW identity-level `isIdentityVisibleToUser` (composed at each route handler + WS filter) |
| V5 Input Validation | yes | `Array.isArray` + `typeof === "string"` narrowing at `extractCosmeticsFromFrontmatter`; `users` list normalized (trim + drop non-strings + drop empties) before use |
| V6 Cryptography | no | — |

### Known Threat Patterns for {this phase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Un-gated frame leaks identity name via WS | Info Disclosure | Extend `filterAppFrame` to all identity-carrying frames; deny on missing lookup (same fail-closed shape `AppFrameFilter` already uses at L172-184) |
| Un-gated conversation-search leaks transcript hits | Info Disclosure | Post-filter per-hit against `isIdentityVisibleToUser` before response emit |
| YAML injection via crafted `users:` value | Tampering (write side) | `js-yaml` safe-parse; write side emits array-of-strings only; strings coming from `getUsernameForUserId` are DB values, not user-input at the request layer |
| Path traversal via frontmatter-controlled field | Tampering | Not applicable — the `users` values are compared as opaque strings; never interpolated into paths or shell commands |
| Auto-tag with wrong userId (a bug that leaks visibility) | Tampering | Auto-tag happens only under `isMultiUser` guard; test that single-user hosts NEVER get an auto-tag written (loud regression signal — shape §"What would make it wrong" bullet 1) |
| Case-mismatch causing operator confusion → silent leak or silent hide | Human error | Documented case-sensitive rule; frontmatter editor / follow-up phase can validate against known usernames |

**This is a visibility filter, NOT a permission system.** On-disk bypass (agent editing frontmatter directly, SSH access to the file) is explicitly out of scope per the shape file's §Philosophy. The gate hides identities from the sidebar's view; it does not enforce write-side gating on SSH access, does not block API calls with a known identityKey, does not block the direct read path if a caller has the identity name (e.g., `GET /identities/:key/avatar?hostId=<n>` returns bytes if the caller knows the URL — this is by design because the shape file explicitly limits scope to visibility).

## Complete no-leak audit — every surface that exposes identity or role names

| Endpoint / Frame | File | Currently gates on | Add `users` gate? |
|------------------|------|-------------------|-------------------|
| `GET /identities` | `identities.ts` L294-485 | host access via `resolveHostById(hostId, userId)` | **YES** — filter identities inside per-host block AFTER cosmetics + role extract |
| `GET /identities/:identityKey/avatar` | `identities.ts` L863 | host access | **NO** by shape scope — visibility gate only; direct-URL avatar fetch stays open (see Security Domain note) |
| `POST /identities/birth` | `identity-birth.ts` L94 | host access | Auto-tag on creation; existing streams don't need gating (creator is naturally visible to themselves) |
| `PUT /identities/:identityKey` | `identities.ts` L501 | host access | **NO** — edit path; if caller can see it, caller can edit it (shape §Philosophy) |
| `POST /identities/clone` | `identity-clone.ts` | host access | **NO** — treat like new-identity write. Optionally auto-tag clone target if multi-user; recommend gating this the same way as birth for symmetry. Flag as follow-up if needed. |
| `POST /identities/:key/archive` | `identity-archive.ts` | host access | **NO** — user-initiated on an identity they can see |
| `GET /sessions/list` | `sessions.ts` L294 | host access via `hosts.userId=userId` | **YES** — filter session rows by identity gate (Pitfall 3) |
| `GET /roles?hostId=<n>` | `roles-list-for-host.ts` L108 | host access | **YES** — filter role list by role.users intersected with caller username |
| `POST /roles` | `roles-create.ts` L286 | host access | Auto-tag on creation |
| `GET /roles/:name/avatar?hostId=<n>` | `roles.ts` L135 | host access | **NO** by shape — direct-URL avatar fetch |
| `POST /roles/:name/avatar?hostId=<n>` | `roles.ts` L317 | host access + role owner check | Consider (out-of-scope but a leak if a hidden role can have its avatar overwritten by a user who "shouldn't see it"). Recommend flagging but deferring — a caller who knows the role name and can hit the endpoint can already write. |
| `POST /conversation-search` | `conversation-search.ts` L498 | host access via `hosts.userId=userId` | **YES** — post-filter per-hit against identity gate (Pitfall 4) |
| `POST /agent-reset` | `agent-reset.ts` L129 | host access | **Optional but recommended** — a hidden identity's `/id reset` dispatch shouldn't be reachable via known-URL from a user who shouldn't see it. |
| WS fleet-status `update` frame | subscription-registry via `filterAppFrame` | host access | **YES** — extend `filterAppFrame` with identity-name gate |
| WS fleet-status `snapshot` frame | same | host access | **YES** |
| WS fleet-status `gone` frame | same | host access | **YES** |
| WS fleet-status `identity-archived` frame | same | host access | **YES** |
| WS fleet-status `session-project-changed` frame | same | host access | **YES** — carries identityKey |
| WS fleet-status `project-list-changed` frame | same | host access | Depends on whether project membership leaks identity presence indirectly. Verify at plan-time. |
| WS fleet-status `app-snapshot` / `app-update` / `app-gone` | same | host access only | **NO** — apps don't carry identity info |
| WS fleet-status `pong` | same | pass-through | **NO** |

**Every "YES" row needs to be a specific task in the plan.** The "NO" rows are documented so the plan-check pass sees they were considered.

## Test Patterns (existing fixtures to mirror)

- **`identity-appearance.test.ts`** (`src/backend/fleet-status/`) — pure-function unit tests with `makeArgs` fixture builder. Add tests for the intersection gate: role-empty/id-empty/both-populated cross-matrix (6-8 assertions).
- **`identities.get-disk.test.ts`** (`src/backend/database/routes/`) — bare Express + Node http.request scaffold, `vi.mock` on artifact-reader/ssh/host-resolver. Add cross-user tests: identity A is on shared host, users list includes only the user; test that the user's request sees it and Zoe's request does not.
- **`identity-birth-orchestrator.test.ts`** (`src/backend/database/routes/`) — pure orchestrator with injected deps. Add tests for the auto-tag branch: `creatorUsername` present + `isMultiUser=true` → frontmatter contains `users:`; `isMultiUser=false` → no `users:` key; already-present `users:` on an existing file is never rewritten (though this last one is unreachable given the collision probe — assert as an invariant).
- **`ssh-poll-orchestrator.test.ts`** — heavy fixture. If the resolver returns null for hidden identities, verify the sweep path produces no session state for that identity.
- **NEW: `identity-visibility-gate.test.ts`** — pure unit tests for `isIdentityVisibleToUser` (matrix of `[nullCaller, emptyLists, userOnBoth, userOnRoleOnly, userOnIdOnly, userOnNeither, zoeOnBothUserEmpty]`).
- **NEW: fixture for multi-user host detection** — mock the `hosts` + `hostAccess` tables. Assert `isHostMultiUser` returns true when owner + share, false when only owner.

## Sources

### Primary (HIGH confidence)
- `src/backend/fleet-status/identity-appearance.ts` — the single merge authority (Phase 111 T-111-08 mitigation)
- `src/backend/claude-session/identity-artifact-reader.ts` — `extractCosmeticsFromFrontmatter` L3128-3236, `writeMarkdownFileAtomic` L2583, canonical yaml.dump options at L570-575
- `src/backend/database/routes/identities.ts` — fanout at L294, `publicIdentity()` at L153
- `src/backend/database/routes/sessions.ts` — `/list` handler at L294
- `src/backend/database/routes/roles-list-for-host.ts` — full file (300 lines)
- `src/backend/database/routes/roles-create.ts` — full file, yaml.dump at L554
- `src/backend/database/routes/identity-birth-orchestrator.ts` — `buildIdentityFileBody` L544, `BirthOptions` L196
- `src/backend/database/routes/identity-birth.ts` — SSE route L94-380
- `src/backend/fleet-status/app-frame-filter.ts` — full file (327 lines) — Phase 118 filter mechanism
- `src/backend/fleet-status/subscription-registry.ts` — filter wiring at L799-970
- `src/backend/database/db/schema.ts` — `users` L12, `hosts` L103, `hostAccess` L500
- `src/backend/utils/auth-manager.ts` — createAuthMiddleware L807-953 (sets `req.userId`, not `req.user.username`)
- `src/backend/ssh/host-resolver.ts` — `checkHostAccess` L497

### Secondary (MEDIUM confidence)
- `src/backend/database/routes/conversation-search.ts` — cross-identity search surface
- `src/backend/database/routes/identity-clone.ts` — clone endpoint (auto-tag applicability)
- `src/ui/state/conversation-store.ts` — fleet-synthetic row derivation L849-918
- `src/ui/api/identities-api.ts` — `listRolesForHost` L321
- `src/ui/sidebar/CreateRoleDialog.tsx` — role create dialog (no client-side change needed)
- `src/ui/sidebar/NewSessionDialog.tsx` — role picker consumer L490-547

### Tertiary (LOW confidence — verify at plan-time)
- `permission-manager.ts canAccessHost` — assumed to be the authoritative host-access predicate that also expands roleId-based grants; not read in this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every needed primitive already exists in the codebase
- Architecture: HIGH — single-authority merge (Phase 111) and per-subscriber filter (Phase 118) are the exact patterns to extend
- Pitfalls: HIGH — every pitfall listed is grounded in a specific file+line, not speculative
- Auto-tag flow: HIGH — both create endpoints already build frontmatter via yaml.dump with absent-⇒-omit
- Deep-gate coverage: MEDIUM — the no-leak audit table is derived from a full grep for identity-name-carrying surfaces, but a few "NO" rows are judgment calls; plan-check should re-verify
- Multi-user detection: MEDIUM — Assumption A1 (hostAccess is authoritative) is the biggest risk; verify against `permission-manager.canAccessHost`
- WS filter extension: HIGH — the exact pattern to mirror is `filterAppFrame` L216 `if (frame.type === "identity-archived")`

**Research date:** 2026-09-23
**Valid until:** 2026-10-23 (30 days — codebase is stable, no in-flight refactors of the touched files noted in STATE.md's recent phase entries)
