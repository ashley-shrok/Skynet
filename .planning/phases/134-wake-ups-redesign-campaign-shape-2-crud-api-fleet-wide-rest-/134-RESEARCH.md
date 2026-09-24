# Phase 134: wake-ups-redesign campaign shape 2 (CRUD API) - Research

**Researched:** 2026-09-21
**Domain:** Skynet backend REST endpoints over the new global on-disk wake-up spec convention (fleet-wide LIST, per-host writes) + wholesale retirement of the still-live per-role wake-up CRUD surface.
**Confidence:** HIGH (every recommendation traces to a locked CONTEXT.md decision, an existing in-repo pattern, or a concrete file cited below — no new stack, no new libraries, no new philosophy).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Verbatim from `134-CONTEXT.md`:

- **D-01: HTTP REST endpoint style** (NOT WebSocket wire ops). Mirrors `src/backend/database/routes/roles-*.ts`, `identities.*.ts`. Departure from existing per-role/per-identity wake-up CRUD (which uses WS) is defensible because fleet-wide sweep aggregation is a natural REST shape.
- **D-02: Fleet-wide sweep on list; host param on writes.** LIST enumerates `~/fleet/wakeups/<slug>/wakeup.json` across every managed host and returns aggregated results with a `host` field per item. CREATE/UPDATE/DELETE/TOGGLE take a `host` param and dispatch to exactly one host.
- **D-03: Thin API — no DB shadow, no server-side smarts.** On-disk files stay the source of truth. Skynet's in-memory-DB `forceSave` rule does NOT apply (wake-up specs never touch SQLite).
- **D-04: Enumeration endpoints — roles ONLY.** LIST-roles-for-host reuses/extends `roles-list-for-host.ts`. Skills picker is OUT.
- **D-05: Atomic writes** — write-to-`.tmp` + rename-into-place.
- **D-06: HARD DELETE** — remove `~/fleet/wakeups/<slug>/` folder entirely + cleanup `~/fleet/wakeups/.state/<slug>.fired` sentinel if it exists. No archive, no soft-delete.
- **D-07: Slug generation on create — kebab-case from name; 409 on collision.**
- **D-08: Validation matches `wakeup-scheduler.py`'s parser exactly.** API isn't a validation opinion layer.
- **D-09: `WakeupsTab.tsx` stays intact** — reusable component still used by IdentityModal for per-identity wake-ups.
- **D-10: Backend removal — service functions** in `identity-artifact-reader.ts` (`readRoleWakeups`, `readRoleWakeupsByName`, `writeRoleWakeupCreate`, `writeRoleWakeupUpdate`, `writeRoleWakeupDelete`, `writeRoleWakeupByName`).
- **D-11: Backend removal — WS handlers** in `claude-session-server.ts` (identity:list/update/create/delete-role-wakeup + role:list/create/update/delete-wakeup + their response types + wire-op JSDoc block).
- **D-12: Frontend API removal** in `claude-session-api.ts` (`listRoleWakeups`, `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`). `WakeupSpecWire` stays.
- **D-13: Test removal — full-file deletion for 4 files; 2 need audit** (`claude-session-api.role-reads.test.ts` + `PrettyView.role-modal-swap.test.tsx`). `identity-artifact-reader.wakeup-crud.test.ts` STAYS.
- **D-14: Order-of-operations** — new global CRUD lands FIRST + green in tests; then role-scope removal + `RoleModal` tab deletion + test-file deletions.
- **D-15: SSH fan-out pattern reused** from `identity-artifact-reader.ts` (delimiter-based one-liner per host, single SSH round-trip per host, aggregated response).
- **D-16: `skynet` host itself is a managed host** from the API's perspective — LIST fan-out includes t1000.
- **D-17: Nginx paired blocks** in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.
- **D-18: Container mutation required.** Standard docker build + `docker compose up --force-recreate skynet`.
- **D-19: Full test suite is the pre-deploy gate.** `npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` BEFORE `docker build`.

### Claude's Discretion

- Exact URL paths — `/wakeups`? `/api/wakeups`? Path-vs-query for `host` param?
- TTL value for the LIST cache — mirror fleet-status if a single value applies.
- Enable-toggle endpoint shape — dedicated `PATCH /wakeups/<slug>/toggle-enabled` vs generic `PATCH /wakeups/<slug>` with partial body.
- Return shape on aggregated LIST — flat array with `host` field per item vs `{ [host]: [...] }` grouped.
- Wave decomposition — 1 vs 2 plans.
- JSON key ordering / minor spec-field polish.

### Deferred Ideas (OUT OF SCOPE)

- **Deferred to shape 3 (UI modal):** header button, list view, filter bar, create/edit form, delete confirmation, deep-link vs fleet-wide default, UI hint text about "Do this first" contract.
- **Excluded:** skill enumeration endpoint + skill picker; archive/soft-delete; server-side auto-suffix on slug collision; DB shadow; streaming/websockets for spec-change notifications; history-of-past-fires endpoint; cross-host wake-up management (moving spec host A → host B).
</user_constraints>

## Summary

Shape 2 delivers the Skynet-backend REST API layer that the (future) shape-3 modal will consume, and — folded into the same phase — the wholesale removal of the still-live per-role wake-up CRUD surface (a silent-fail failure mode after Phase 127 stopped the scheduler from reading role-scope dirs).

The new surface is a thin HTTP/REST layer over the disk convention shape 1 already landed: **LIST fan-out** over every reachable host reading `~/fleet/wakeups/<slug>/wakeup.json`, aggregated with a `host` field per row; **per-host CREATE/UPDATE/DELETE/TOGGLE** taking a host param and writing atomically via `.tmp` + rename. The role enumeration endpoint (chip-picker in shape 3) is reused-as-is from `roles-list-for-host.ts` — no extension needed. Validation mirrors `substrate/scripts/wakeup-scheduler.py`'s parser exactly per D-08. All new endpoints get paired nginx `location` blocks per D-17.

The retirement half is a mechanical delete: six exported functions from `identity-artifact-reader.ts`, eight WS handlers from `claude-session-server.ts`, five API functions from `src/ui/api/claude-session-api.ts`, the `role-wakeups` NAV_SECTIONS entry + wakeup-related state/effects/callbacks/imports in `RoleModal.tsx`, and four test files. Two more test files need surgical wakeup-block excision.

**Primary recommendation:** One plan is enough (1200-1500 lines of new backend, ~600 lines of deletions, one wave decomposition into 3 tasks: new surface → role-scope removal → nginx + wire-through). Wave order per D-14 (new surface green first, then removal). Everything reuses established patterns; nothing new invented.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fleet-wide wake-up LIST (aggregated) | API / Backend | — | Endpoint fans out SSH per host, aggregates, returns JSON. Follows `conversation-search.ts` pattern (fleet-fanout). |
| Per-host wake-up CREATE / UPDATE / DELETE / TOGGLE | API / Backend | — | REST endpoint takes host param, dispatches to one host via SSH SFTP+shell, atomic write. Same tier as `roles-create.ts`. |
| Wake-up spec validation | API / Backend | — | Validation lives with the writer; scheduler-parser-equivalent per D-08. |
| Role enumeration (for future modal picker) | API / Backend | — | Reuse `roles-list-for-host.ts` as-is (D-04). |
| Nginx paired location blocks | Infrastructure (edge) | — | Container-mutation deploy; `location ~ ^/wakeups(/.*)?$` in both nginx.conf and nginx-https.conf. |
| Removal of retired per-role WS handlers | API / Backend | — | Deletion inside `claude-session-server.ts`. No tier change. |
| Removal of `role-wakeups` tab | Frontend (React) | — | `RoleModal.tsx` NAV_SECTIONS + state + effects + callbacks + TabsContent block deleted. |
| Removal of retired frontend API helpers | Frontend (client-lib) | — | `claude-session-api.ts` deletions. |

**No new tier crossings.** Everything mirrors existing Drizzle-backend REST routing + existing SSH fan-out + existing frontend API/component ownership.

## Phase Requirements

This phase has no formal REQ-IDs — it operates from D-01..D-19 in `134-CONTEXT.md` (matches Phase 123/127 pattern per STATE.md). The 19 decisions ARE the requirements; each maps to a task in the plan.

## Project Constraints (from PROJECT.md + box-maintainer role file)

Extracted directives the planner MUST honor:

- **Nginx caveat (PROJECT.md § Constraints):** every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`. **Load-bearing — enforced by D-17.**
- **Test discipline (box-maintainer.md):** scoped tests during dev + executor + push-prep (`npx vitest related --run <files>` on touched paths). Full suite ONLY at deployment gate, as the FIRST step before `docker build`. Full suite = `npx vitest run` (exit 0) + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` (exit 0). **Executor prompts say "scoped tests"; the deploy gate is orchestrator-managed** (D-19).
- **Executor boundary:** subagents (executors) don't deploy — orchestrator only. Executors' remit is code + commit + tests green. Plans MUST NOT include executor-scoped ship tasks.
- **Container mutation serialization:** Ashley coordinates manually. Only ONE identity mutates Skynet state at a time. Motion: `docker build` + `docker compose up --force-recreate`. Gate on Ashley's deploy greenlight.
- **Deploy boundary: `git push`, not `docker compose up --force-recreate`.** "Hit bounty X" / "fix X" authorizes CODE motion only. After commit + full-suite green, STOP and report; wait for explicit greenlight before push. "Push it" = `git push` only. Deploy needs separate greenlight for `docker build` + `docker compose up`.
- **Backend TS strictness:** frontend `tsc --noEmit` doesn't catch backend TS errors. For any patch touching `src/backend/` or wire types, pre-push typecheck is `npm run build:backend && npm run build`.
- **In-memory-DB `forceSave` rule:** after backend writes to Skynet's own DB, call `await DatabaseSaveTrigger.forceSave("<reason>")`. **NOT applicable here** — wake-up specs never touch SQLite (D-03).
- **NO worktrees fleet rule.** Do NOT spawn Agents with `isolation: "worktree"`, do NOT `git worktree add`. All work on current branch `feat/tab-title-from-tmux`.
- **SSH to peer boxes as root, not ubuntu** (learned preference).
- **No message streaming — ever, anywhere** (Skynet-wide). Not relevant to a REST route but flagged so planners don't invent a WS surface for "spec changed on disk" notifications.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` (already installed) | current fork version | HTTP routing | Every Drizzle-backend REST route uses it (`roles-list-for-host.ts`, `identities.ts`, `conversation-search.ts`). |
| `ssh2` (via `connectOneShot` + `execCommand`) | current | Per-host SSH + SFTP | Every remote-host write path uses these two primitives. |
| Node `fs/promises` | stdlib | LOCAL branch writes when host is skynet-container itself | LOCAL bind-mount fast path per `isLocalHostId()` in `identity-artifact-reader.ts`. |
| Drizzle ORM + `hosts` schema (already installed) | current | Fleet-wide host enumeration for LIST fan-out | Same pattern `conversation-search.ts` uses (`db.select().from(hosts).where(eq(hosts.userId, userId))`). |
| `AuthManager.createAuthMiddleware()` (already installed) | current | JWT gate on every endpoint | Universal across every routes/ file. |
| `resolveHostById(hostId, userId)` (already installed) | current | Per-user host isolation | Used by every route that touches a specific host (returns null for cross-user/unknown). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `getHostSemaphore(hostId).run(...)` | already installed | Serialize concurrent writes to the same host | Wrap all CREATE/UPDATE/DELETE handlers to avoid clobber races (mirrors `roles-create.ts` L455). |
| `sshLogger` (from `../utils/logger.ts`) | already installed | Structured logging | Every SSH exec/write path logs on failure — `sshLogger.warn/error` with `operation` tag. |
| ROLE_NAME_PATTERN / IDENTITY_SLUG_RE (already installed) | current | Kebab-case gate for shell interpolation safety | Slug validation before SSH interpolation (identity-artifact-reader.ts exports IDENTITY_SLUG_RE `/^[a-z0-9_-]{1,80}$/i`). |
| `humanizeWakeupSchedule()` from `identity-artifact-reader.ts` | already installed | Convert schedule object → human string | Useful for LIST response to save the modal (shape 3) a round-trip. Already used by per-identity wakeup read path. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| REST HTTP (D-01) | WebSocket wire ops | REJECTED per D-01 — REST fits fleet-wide aggregation naturally; existing WS pattern was designed for one-host-per-connection semantics. |
| Fleet-wide LIST (D-02) | Per-host LIST with `host` in query param | REJECTED per D-02 — modal renders everything fleet-wide by default, filterable per-host client-side. Backend does one fan-out call, not N. |
| DB shadow (D-03) | SQLite table `wakeups` synced with disk | REJECTED per D-03 — "two paths in, one truth out." Files are the truth. |
| Skills enumeration (D-04) | `GET /skills?hostId=<n>` | REJECTED for THIS shape; may return later. Newborn identity invokes any available skill regardless of picker. |
| Soft delete via `enabled: false` (D-06) | Toggle-disabled sub-op stays; DELETE moves to archive rename | REJECTED per D-06 — delete/disable stay as two ops but DELETE is a hard delete. |
| WS notifications on spec-changed (excluded) | Backend broadcasts `wakeup:changed` events | REJECTED per shape philosophy — no streaming; refetch on modal open + on write. |

**Installation:**
```bash
# No new packages. Every dependency is already in the Skynet package.json.
```

**Version verification:** N/A — no new dependencies introduced.

## Package Legitimacy Audit

**Not applicable.** No external packages installed by this phase. Every dependency (express, ssh2, drizzle-orm, `fs/promises`, `AuthManager`, `resolveHostById`, `connectOneShot`, `execCommand`, `js-yaml`, etc.) is already vendored + shipped in the Skynet container's baseline. Slopcheck gate skipped by design — nothing to audit.

## Architecture Patterns

### System Architecture Diagram

```
Client (Skynet UI / future shape-3 modal / agent-supervisor scripts)
    │
    │  HTTP (JWT-gated)
    ▼
Skynet backend (Express, port 30001)
    │
    ├─── nginx passthrough ──── location ~ ^/wakeups(/.*)?$
    │                              (docker/nginx.conf + nginx-https.conf)
    │
    ▼
new /wakeups router (this phase)
    │
    ├─── GET / (fleet-wide LIST)
    │     │
    │     ├─ Drizzle host projection: db.select().from(hosts).where(eq(hosts.userId, userId))
    │     ├─ candidates.filter(enableSsh + autoTmux) (mirror conversation-search.ts:551-563)
    │     ├─ Promise.all(candidates.map(host => runOneHost(host, userId)))
    │     │     │
    │     │     ├─ resolveHostById(hostId, userId) → null? → skip
    │     │     ├─ isLocalHostId(hostId)? → LOCAL branch (fs.readdir on bind-mount)
    │     │     └─ REMOTE branch → connectOneShot → execCommand with delimiter one-liner:
    │     │           `cd ~/fleet/wakeups && for d in */; do
    │     │              echo "===SLUG:$d==="; cat "$d/wakeup.json"; done`
    │     ├─ parse per-host stdout, emit {slug, host, name, enabled, schedule, prompt, roles[], skills[], scheduleHuman}
    │     └─ aggregate + TTL cache (opt-in — see § Discretion)
    │
    ├─── POST / (CREATE)
    │     │
    │     ├─ Body: { host: string|number, spec: WakeupSpec }
    │     ├─ Validate spec per wakeup-scheduler.py parser (D-08)
    │     ├─ Kebab-case slug from spec.name (D-07)
    │     ├─ resolveHostById(host, userId)
    │     ├─ getHostSemaphore(hostId).run(async () => {
    │     │     LOCAL: fs.mkdir(~/fleet/wakeups/<slug>) + fs.writeFile(...tmp) + fs.rename
    │     │     REMOTE: connectOneShot → mkdir -p + SFTP writeFile to .tmp + ext_openssh_rename
    │     │   })
    │     ├─ 409 on clobber (existence probe before write)
    │     └─ 201 { slug, host, spec } echo
    │
    ├─── PATCH /:slug (UPDATE — full-spec overwrite, mirrors writeRoleWakeupByName semantics)
    │     ├─ Body: { host, spec: WakeupSpec }
    │     ├─ Same write path as CREATE minus the clobber check
    │     └─ 200 { slug, host, spec }
    │
    ├─── PATCH /:slug/toggle-enabled (or PATCH /:slug with partial body — planner picks)
    │     ├─ Body: { host, enabled: boolean }
    │     ├─ Read wakeup.json, flip enabled field, atomic-write
    │     └─ 200 { slug, host, enabled }
    │
    └─── DELETE /:slug
          ├─ Body: { host }
          ├─ Hard delete: rm -rf ~/fleet/wakeups/<slug>/ (D-06)
          ├─ Cleanup: rm -f ~/fleet/wakeups/.state/<slug>.fired
          └─ 204

Disk (each supervisor host):
    ~/fleet/wakeups/<slug>/wakeup.json    ← spec (source of truth, per D-03)
    ~/fleet/wakeups/.state/<slug>.fired   ← one-shot sentinel (cleared on delete)
    ~/fleet/wakeups/.state/<slug>.last    ← last-fired epoch for interval/daily/weekly
    ~/fleet/wakeups/.state/scheduler.pid  ← global scheduler process id
    ↑
    │  polled at WAKEUP_POLL_SEC intervals by substrate/scripts/wakeup-scheduler.py
    │  (--mode global — session-independent, spawned by agent-supervisor.sh)
    │
On fire:
    substrate/scripts/wakeup-scheduler.py drops
    ~/fleet/spawn-requests/<uuid>.json → consumed by Skynet birth pipeline
```

### Recommended Project Structure

```
src/backend/database/routes/
├── wakeups-list.ts          # GET / — fleet-wide fan-out
├── wakeups-write.ts         # POST/PATCH/DELETE handlers (single-host writes)
└── (existing routes)

Mount in src/backend/database/database.ts:
  app.use("/wakeups", wakeupsListRoutes);        # GET / — chained
  app.use("/wakeups", wakeupsWriteRoutes);       # POST/PATCH/DELETE — chained
```

(Or one file if scope is small. Two-file split mirrors `roles-list-for-host.ts` + `roles-create.ts` pattern.)

### Pattern 1: JWT-gated REST endpoint with per-user host isolation
**What:** Every endpoint runs behind `authenticateJWT` middleware, then `resolveHostById(hostId, userId)` returns null for cross-user/unknown hosts (T-22-04-03 mitigation).
**When to use:** Every endpoint (all 5 new ones).
**Example:**
```typescript
// Source: src/backend/database/routes/roles-list-for-host.ts:108-128
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseInt(String(req.query.hostId), 10);
  if (!Number.isFinite(hostId) || hostId <= 0) {
    return res.status(400).json({ error: "hostId must be a positive integer" });
  }
  const host = await resolveHostById(hostId, userId);
  if (!host) return res.status(404).json({ error: "Host not found" });
  // ...
});
```

### Pattern 2: Delimiter-based one-liner batched SSH read
**What:** Read every wake-up spec on a host in ONE SSH round-trip using a `===SLUG:$d===` delimiter + `for` loop.
**When to use:** LIST endpoint's per-host read.
**Example:**
```typescript
// Source: src/backend/claude-session/identity-artifact-reader.ts:1486-1533 (readIdentityWakeups REMOTE branch)
const cmd =
  `cd "$HOME/fleet/wakeups" 2>/dev/null && ` +
  'for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/wakeup.json" 2>/dev/null; done';
const stdout = await execWithTimeout(conn, cmd);
const chunks = stdout.split("===SLUG:");
for (const chunk of chunks) {
  if (!chunk.trim()) continue;
  const separatorIdx = chunk.indexOf("===");
  if (separatorIdx === -1) continue;
  const slug = chunk.slice(0, separatorIdx).trim();
  const jsonContent = chunk.slice(separatorIdx + 3).trim();
  // Parse JSON, extract fields, push to result...
}
```

### Pattern 3: LOCAL bind-mount fast path via `isLocalHostId(hostId)`
**What:** t1000 (Skynet's own host, hostId in `IDENTITIES_LOCAL_HOST_IDS`) reads/writes the fleet subtree through the container's bind mount (`/host-home/fleet/...`) via Node `fs/promises` — no loopback SSH.
**When to use:** Fan-out branch selection, per-host CRUD branch selection. Mirrors D-16 ("skynet host is a managed host from the API's perspective").
**Example:**
```typescript
// Source: src/backend/claude-session/identity-artifact-reader.ts:1438-1483 (readIdentityWakeups LOCAL branch)
if (conn === null) {  // LOCAL — hostId is in IDENTITIES_LOCAL_HOST_IDS
  const root = getLocalIdentitiesRoot();  // or an analog for wakeups
  // For wakeups: fleetRoot = path.dirname(getLocalIdentitiesRoot()) → then <fleetRoot>/wakeups
  const wakeupsDir = path.join(fleetRoot, "wakeups");
  const dirEntries = await fs.readdir(wakeupsDir);
  // ... read each <slug>/wakeup.json...
}
```

**Recommendation:** add a small `getLocalWakeupsRoot()` helper next to `getLocalIdentitiesRoot()` in `identity-artifact-reader.ts` (or a companion module) that returns `<fleetRoot>/wakeups` using the same HOME_HOST_DIR-derived resolution. Uses one place to derive the fleet root. Mirrors Phase 117 M-K pattern.

### Pattern 4: Atomic write via `.tmp` + rename (both branches)
**What:** LOCAL uses `fs.writeFile(tmp) + fs.rename(tmp, target)`. REMOTE uses SFTP `writeFile(tmp)` + `ext_openssh_rename(tmp, target)` (POSIX rename semantics; `sftp.rename` cannot atomically overwrite an existing target per the ext_openssh_rename comment block in `identity-artifact-reader.ts` L2547-2582).
**When to use:** CREATE, UPDATE, TOGGLE.
**Example:**
```typescript
// Source: identity-artifact-reader.ts:2583-2700 (writeMarkdownFileAtomic)
// LOCAL branch
const tmpPath = filePath + ".tmp";
await fs.writeFile(tmpPath, contents, "utf-8");
await fs.rename(tmpPath, filePath);

// REMOTE branch
const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
  conn.sftp((err, s) => err ? reject(err) : resolve(s));
});
try {
  await new Promise<void>((resolve, reject) =>
    sftp.writeFile(resolvedTmp, buf, { mode: 0o644 }, (err) => err ? reject(err) : resolve()));
  await new Promise<void>((resolve, reject) =>
    sftp.ext_openssh_rename(resolvedTmp, resolvedTarget, (err) => err ? reject(err) : resolve()));
} finally {
  try { sftp.end(); } catch { /* ignore */ }
}
```

**CAUTION:** `writeMarkdownFileAtomic` is markdown-only-typed. For a JSON writer, follow the same shape but pass a JSON string; do NOT reuse the name to avoid confusion. Consider a new `writeJsonFileAtomic(conn, targetPath, obj)` helper alongside it — or, since the existing per-role writers use an inline `python3` script for JSON-with-merge, mirror that shape (see identity-artifact-reader.ts:2065-2079 script). For the wake-ups CRUD case where we OVERWRITE the whole spec, a plain SFTP writeFile + ext_openssh_rename is enough (no python3 needed).

### Pattern 5: Fleet fan-out with per-host timeout + graceful degradation
**What:** `Promise.all(candidates.map(host => Promise.race([work, timeout(30s)]).catch(_ => [])))`. One slow/dead host contributes `[]` to the aggregated response rather than failing the whole LIST.
**When to use:** LIST endpoint fan-out.
**Example:**
```typescript
// Source: src/backend/database/routes/conversation-search.ts:576-622
const perHost = await Promise.all(
  candidates.map(async (h): Promise<WakeupListItem[]> => {
    const hostId = h.id as number;
    try {
      const resolved = await resolveHostById(hostId, userId);
      if (!resolved) return [];
      const conn = await connectOneShot(resolved, CONNECT_TIMEOUT_MS);
      try {
        return await Promise.race<WakeupListItem[]>([
          runOneHost(conn, hostId, hostName),
          new Promise<WakeupListItem[]>((_, reject) =>
            setTimeout(() => reject(new Error("per_host_timeout")), 25_000)),
        ]);
      } finally { try { conn.end(); } catch {} }
    } catch (e) {
      sshLogger.debug("wakeups-list: host skipped", {
        operation: "wakeups_list_host_skip", hostId, hostName, error: e instanceof Error ? e.message : "unknown"
      });
      return [];
    }
  })
);
const flat = perHost.flat();
```

### Pattern 6: Host candidate filter (userId scope + enableSsh + autoTmux)
**What:** Drizzle projection scoped by `eq(hosts.userId, userId)`, filtered by `enableSsh` + `terminalConfig.autoTmux !== false`.
**When to use:** LIST fan-out — matches the same set of hosts every fleet-scope endpoint uses.
**Example:**
```typescript
// Source: conversation-search.ts:543-563
const rows = await SimpleDBOps.select(
  db.select().from(hosts).where(eq(hosts.userId, userId)),
  "ssh_data",
  userId,
);
const candidates = rows.filter((h) => {
  if (!h.enableSsh) return false;
  let cfg: Record<string, unknown> = {};
  if (typeof h.terminalConfig === "string" && h.terminalConfig) {
    try { cfg = JSON.parse(h.terminalConfig); } catch {}
  } else if (h.terminalConfig && typeof h.terminalConfig === "object") {
    cfg = h.terminalConfig;
  }
  return cfg.autoTmux !== false;
});
```

### Anti-Patterns to Avoid

- **Do NOT invent a SQLite `wakeups` table.** D-03. Files are the truth. There is no DB shadow.
- **Do NOT reuse `writeMarkdownFileAtomic` for JSON writes** — the name lies. Add a `writeJsonFileAtomic` helper or inline the SFTP writeFile + ext_openssh_rename pair. The name-mistmatch bug catches you at code review.
- **Do NOT hand-roll a mkdir-p + write-JSON script when SFTP.writeFile suffices.** Existing writeRoleWakeupCreate uses `python3` because it also does JSON merge; the new CREATE endpoint is a full overwrite — no merge needed. Simpler = better.
- **Do NOT skip the semaphore.** Two concurrent CREATE calls to the same slug on the same host can both pass the existence probe. Wrap every WRITE handler in `getHostSemaphore(hostId).run(...)` per the roles-create.ts pattern (L455).
- **Do NOT add validation the scheduler wouldn't reject.** D-08. If `wakeup-scheduler.py` accepts `{schedule: {type: "custom-experimental-kind"}}`, the API accepts it.
- **Do NOT emit `error` fields in the LIST response for host-level failures.** Follow conversation-search.ts's pattern: one host down contributes `[]`, log via sshLogger.debug, aggregate silently. The modal renders everything the API can see; unreachable hosts just don't contribute rows.
- **Do NOT use `sftp.rename()` — must use `sftp.ext_openssh_rename()`** (the EEXIST-atomic-overwrite issue). See `identity-artifact-reader.ts` L2547-2582 for the full explanation + the regression test at `identity-artifact-reader.remote-writes.test.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT authentication | Session-cookie or bearer-token check yourself | `authenticateJWT = AuthManager.getInstance().createAuthMiddleware()` | Same middleware every other route uses; already covers 401 uniformly. |
| Per-user host isolation | Custom "does this user own this host" query | `resolveHostById(hostId, userId)` | Load-bearing across every host-scoped route. Returns null for cross-user/unknown → 404. |
| SSH connection lifecycle | `new ssh2.Client()` + wire up auth | `connectOneShot(host, timeout)` | Handles auth, jump-hosts, key selection, timeouts. try/finally .end() everywhere. |
| SSH command execution | Native ssh2 exec API | `execCommand(conn, cmd)` from `tmux-helper.ts` | Standard exec wrapper; every route uses it. Race with a timeout Promise for bounded response time. |
| Atomic file overwrite over SSH | `sftp.rename` | `sftp.ext_openssh_rename(tmp, target)` | POSIX-semantics atomic overwrite (see prologue at identity-artifact-reader.ts L2547-2582). `sftp.rename` fails on existing target with confusing `Error: Failure`. |
| Host semaphore for concurrent writes | Custom `Map<hostId, Promise>` mutex | `getHostSemaphore(hostId).run(fn)` | Existing serialization primitive; roles-create.ts uses this exact idiom for concurrent role-folder creation. |
| Kebab-case slug normalization | Custom regex + munging | `normalizeWakeupSlug(name)` from identity-artifact-reader.ts:2183 | Existing helper: `name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`. Kept in ONE place. Import + reuse. |
| Wakeup-schedule humanization for the LIST response | Rebuild it in the router | `humanizeWakeupSchedule(schedule)` from identity-artifact-reader.ts:116 | Existing helper handles interval/daily/weekly/one_shot + optional days-gate + timezone. Full behavior already tested. |
| Slug regex gate | Custom `/^[a-z0-9-]+$/` | `IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i` from identity-artifact-reader.ts:1431 | Existing shell-safety gate. Match once at handler entry. |
| Local-vs-remote host detection | Custom check | `isLocalHostId(hostId)` from identity-artifact-reader.ts:233 | Existing predicate. Handles the "container-inside-t1000-has-fleet-bind-mount" fast path uniformly. |
| Local fleet root resolution | Path constants | Extend `getLocalIdentitiesRoot()` pattern → add `getLocalWakeupsRoot()` helper that returns `<fleetRoot>/wakeups` | Existing HOME_HOST_DIR-derived resolution. One env var (HOME_HOST_DIR) covers all fleet subtrees. |
| Structured logging | `console.log` | `sshLogger.warn(...)` / `sshLogger.error(...)` / `sshLogger.debug(...)` | Every route logs through this; consistent operation tags for grep-triage. |

**Key insight:** The wake-ups CRUD domain has essentially zero "new mechanism" content — every primitive already exists in the codebase from prior similar work (identity CRUD, role CRUD, conversation-search fan-out). The value in this phase is the ASSEMBLY, not the invention.

## Runtime State Inventory

Applies because this phase RENAMES / REMOVES a subsystem (per-role wake-up CRUD). Runtime state that survives after code delete:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | Zero fleet-wide. Phase 127 already migrated + deleted all per-role wake-up specs (`~/fleet/roles/<role>/wakeups/`) — verified 2026-09-21 in shape-1 close-out (28 specs migrated on workstation + thenasty; zero remaining). **No new data migration needed for this phase.** | None — Phase 127 already handled. |
| **Live service config** | `~/fleet/wakeups/<slug>/wakeup.json` on each host — these ARE the source of truth. No config elsewhere. The Python scheduler (`substrate/scripts/wakeup-scheduler.py --mode global`) polls this directory on every managed host. | None — API reads/writes this path in-place. |
| **OS-registered state** | Global scheduler process spawned by `substrate/scripts/agent-supervisor.sh` at supervisor startup. Session-independent. Pidfile at `~/fleet/wakeups/.state/scheduler.pid`. **Untouched by this phase** — API is separate from scheduler. | None. |
| **Secrets/env vars** | `IDENTITIES_LOCAL_HOST_IDS` — used by `isLocalHostId()` to decide LOCAL vs REMOTE branch. **Already set** in the Skynet container. Wake-up API reuses the same predicate — nothing new to set. | None. `HOME_HOST_DIR` also unchanged. |
| **Build artifacts** | None — this is a pure code change. Container rebuild picks up new routes automatically. | Standard `docker build` at deploy time. |
| **Stale WS handler registrations** | Once WS handlers are deleted from `claude-session-server.ts` (D-11), any browser tab still on an OLD frontend build would send `role:list-wakeups` and get NO response. Not a runtime-state item per se, but a **hard-cutover risk**: if user has a stale tab open at the moment of the deploy, `RoleModal`'s wake-ups tab would hang loading. | Deploy protocol: this is why `RoleModal.tsx`'s tab is ALSO removed in the same phase — the frontend build no longer even TRIES to call the deleted handlers. Same container mutation ships both halves. |

**Nothing found in any additional category — verified by grepping the codebase for `readRoleWakeup`, `writeRoleWakeup`, `role-wakeup`, `role:wakeup`, `role:list-wakeups`, `identity:role-wakeup`, `identity:list-role-wakeups` and cross-referencing every hit with D-10..D-13.**

## Common Pitfalls

### Pitfall 1: sftp.rename cannot atomically overwrite (EEXIST → SSH2_FX_FAILURE)
**What goes wrong:** `sftp.rename(tmp, target)` fails when `target` already exists (returns generic `Error: Failure`). Confusion: "sometimes it works, sometimes it doesn't" — because it works for first-writes and fails on every overwrite.
**Why it happens:** OpenSSH's SFTPv3 process_rename tries `link()` first; when `new` exists, link() returns EEXIST; OpenSSH's `errno_to_portable()` has no case for EEXIST and falls through to SSH2_FX_FAILURE.
**How to avoid:** Use `sftp.ext_openssh_rename(tmp, target)` — POSIX rename semantics. Advertised by every OpenSSH ≥5.1 (2008+). No fallback needed on Ashley's fleet.
**Warning signs:** `Error: Failure` code 4 with empty error string on any UPDATE-of-existing-spec code path. Regression test at `identity-artifact-reader.remote-writes.test.ts` installs a throwing trap on `sftp.rename` — mirror that trap in the new writer's tests.

### Pitfall 2: One-shot `.fired` sentinel orphaned after DELETE
**What goes wrong:** Hard delete removes `~/fleet/wakeups/<slug>/` but leaves `~/fleet/wakeups/.state/<slug>.fired` behind. Later, someone creates a new wake-up whose name kebabs to the same slug — the orphaned sentinel makes the scheduler think that slug already fired, and the new spec silently doesn't fire.
**Why it happens:** Scheduler's stale-sentinel detection is mtime-based (spec_mtime > sentinel_mtime → clear), but a completely-deleted-then-recreated spec has no mtime relationship to the old sentinel.
**How to avoid:** DELETE endpoint MUST cleanup `.state/<slug>.fired` alongside the folder removal (D-06 explicitly names this). Do it in ONE SSH exec on REMOTE, in one shot with the rmdir:
```bash
rm -rf "$HOME/fleet/wakeups/<slug>" && rm -f "$HOME/fleet/wakeups/.state/<slug>.fired"
```
LOCAL: `fs.rm(dir, {recursive: true, force: true})` + `fs.unlink(sentinel).catch(() => {})`.
**Warning signs:** Slug reuse for a new wake-up (agent hand-rolls a spec on disk with a name that kebabs the same way). Rare in practice but the shape file calls out "orphaned sentinel is silent-fail territory."

### Pitfall 3: Nginx paired-blocks miss (missing HTTPS)
**What goes wrong:** New `/wakeups` route works in local dev (HTTP) but 200s with `index.html` in production (HTTPS via Caddy → nginx-https.conf) — frontend crashes on `.map` fetch.
**Why it happens:** Both nginx configs must carry the same location block (docker/nginx.conf for HTTP dev + internal, docker/nginx-https.conf for prod). Missing HTTPS conf entry = requests fall through to `location /` static-serve, which returns SPA index.
**How to avoid:** Every plan task that adds a route also adds nginx blocks IN BOTH FILES. Reviewer checks by grepping for the block name in both files.
**Warning signs:** Frontend "Failed to fetch" on the new endpoint in prod but works in dev. Missing entries in `docker/nginx-https.conf` will not fail tests — this is a manual review + deploy-verify gate.

### Pitfall 4: Scheduler-parser drift creates "API-created specs fail differently than agent-created ones"
**What goes wrong:** API adds a validation constraint the scheduler doesn't have (e.g., "prompt must be at least 10 chars"). User creates a wake-up through the modal; it works. Later, agent hand-writes an 8-char-prompt spec on disk directly; scheduler happily fires it. Now two paths in have different truths.
**Why it happens:** API tries to be helpful with extra validation; forgets D-08 says validation MIRRORS the scheduler, not exceeds it.
**How to avoid:** Read `substrate/scripts/wakeup-scheduler.py`'s `_load_specs_global()` at L224-248. It accepts any dict with `enabled != False` AND `prompt` AND `schedule`. Schedule must be an object; type must be one of `interval|daily|weekly|one_shot`; each type has its own field requirements (parsed in `_due()` at L180-205 and `_parse_at_ts()` at L160-177). Anything else the scheduler drops. **API mirrors THIS.** Nothing beyond.
**Warning signs:** Test case names like "reject spec with too-long prompt" or "require minimum roles count" — every one of those is a drift bug. Test cases should be "reject spec the scheduler would reject" — not "reject spec the modal wouldn't want."

### Pitfall 5: One host down blocks the whole LIST response
**What goes wrong:** LIST fan-out awaits every host; one unreachable host stalls all 30s and returns a timeout error for the whole request.
**Why it happens:** Naive `await Promise.all([...])` with no per-host timeout + no catch — a rejection propagates.
**How to avoid:** Wrap each host in `Promise.race([work, timeout])` + `.catch(() => [])`. One host down contributes `[]`. Aggregated response returns whatever we could reach. See conversation-search.ts:576-622 for the exact idiom.
**Warning signs:** "LIST timed out" in prod when one host is asleep. Fix at the fan-out, not at the query.

### Pitfall 6: File-scope-only test-file deletion, but test-body edits missed for the two audit files
**What goes wrong:** D-13 says 4 files get deleted wholesale + 2 need audit. The 2 audit files (`claude-session-api.role-reads.test.ts` + `PrettyView.role-modal-swap.test.tsx`) also cover NON-wakeup surfaces (role-file reads, role-bounties list, modal swap coordination). Deleting them wholesale removes non-wakeup coverage.
**Why it happens:** Copy-paste from the D-13 "delete these" list into the plan without reading the file first.
**How to avoid:** The audit is documented in this research (below in § Existing tests to touch): `role-reads.test.ts` has tests R1 (getRoleFileByName), R3 (listBountiesForRoleName), R5+R6 (listRoleWakeups — DELETE these two `describe` blocks); `PrettyView.role-modal-swap.test.tsx` mocks 4 wakeup helpers but the tests themselves are about swap coordination — REMOVE the 4 wakeup helper mocks + keep the swap-coordination test bodies.
**Warning signs:** Executor cost-estimate says "delete 6 test files" — the correct number is 4 deletions + 2 in-place surgical edits.

### Pitfall 7: Backend `tsc` doesn't run under frontend build
**What goes wrong:** Executor runs `npx tsc --noEmit`, sees green, commits. Backend has a type error. `docker build` fails at container build time.
**Why it happens:** Frontend `tsconfig.json` differs from `tsconfig.node.json`. Edits under `src/backend/` can pass frontend checks but fail backend.
**How to avoid:** Pre-push typecheck IS `npm run build:backend && npm run build` — the strictest local check short of docker build.
**Warning signs:** Executor completes; deploy-gate `docker build` fails with a backend TS error. Fleet-wide learned preference documented in box-maintainer.md.

## Code Examples

### List handler skeleton
```typescript
// Source: assembled from conversation-search.ts:471-635 + identity-artifact-reader.ts:1486-1533
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { sshLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { humanizeWakeupSchedule, isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import fs from "fs/promises";
import path from "path";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const CONNECT_TIMEOUT_MS = 5_000;
const PER_HOST_TIMEOUT_MS = 15_000;

type WakeupListItem = {
  slug: string;
  host: string;          // host.name or host.ip
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  skills: string[];
};

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  // 1. Host candidate projection (scoped by userId + enableSsh + autoTmux)
  const rows = await SimpleDBOps.select(
    db.select().from(hosts).where(eq(hosts.userId, userId)),
    "ssh_data",
    userId,
  );
  const candidates = rows.filter((h) => {
    if (!h.enableSsh) return false;
    let cfg: Record<string, unknown> = {};
    if (typeof h.terminalConfig === "string" && h.terminalConfig) {
      try { cfg = JSON.parse(h.terminalConfig); } catch {}
    }
    return cfg.autoTmux !== false;
  });

  // 2. Fan out per host with per-host timeout + graceful degradation
  const perHost = await Promise.all(candidates.map(async (h): Promise<WakeupListItem[]> => {
    const hostId = h.id as number;
    const hostName = ((h.name as string) || (h.ip as string) || "") as string;
    try {
      return await Promise.race<WakeupListItem[]>([
        readWakeupsForHost(hostId, hostName, userId),
        new Promise<WakeupListItem[]>((_, reject) =>
          setTimeout(() => reject(new Error("per_host_timeout")), PER_HOST_TIMEOUT_MS)),
      ]);
    } catch (e) {
      sshLogger.debug("wakeups-list: host skipped", {
        operation: "wakeups_list_host_skip", hostId, hostName,
        error: e instanceof Error ? e.message : "unknown",
      });
      return [];
    }
  }));

  return res.json({ items: perHost.flat() });
});

async function readWakeupsForHost(hostId: number, hostName: string, userId: string): Promise<WakeupListItem[]> {
  const host = await resolveHostById(hostId, userId);
  if (!host) return [];

  if (isLocalHostId(hostId)) {
    // LOCAL bind-mount branch — reads via fs.promises against ~/host-home/fleet/wakeups
    // See getLocalWakeupsRoot() helper (add if missing) — mirrors getLocalIdentitiesRoot pattern
    return readWakeupsLocal(hostId, hostName);
  }

  // REMOTE branch — one SSH round-trip via delimiter one-liner
  const conn = await connectOneShot(host, CONNECT_TIMEOUT_MS);
  try {
    const cmd =
      `cd "$HOME/fleet/wakeups" 2>/dev/null && ` +
      'for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/wakeup.json" 2>/dev/null; done';
    const stdout = await execCommand(conn, cmd);
    return parseWakeupsStdout(stdout, hostId, hostName);
  } finally {
    try { conn.end(); } catch {}
  }
}

function parseWakeupsStdout(stdout: string, hostId: number, hostName: string): WakeupListItem[] {
  const chunks = stdout.split("===SLUG:");
  const out: WakeupListItem[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const sepIdx = chunk.indexOf("===");
    if (sepIdx === -1) continue;
    const slug = chunk.slice(0, sepIdx).trim();
    const jsonContent = chunk.slice(sepIdx + 3).trim();
    if (!jsonContent) continue;
    try {
      const spec = JSON.parse(jsonContent) as Record<string, unknown>;
      out.push({
        slug,
        host: hostName,
        hostId,
        name: typeof spec.name === "string" ? spec.name : slug,
        enabled: typeof spec.enabled === "boolean" ? spec.enabled : true,
        schedule: spec.schedule ?? null,
        scheduleHuman: humanizeWakeupSchedule(spec.schedule),
        prompt: typeof spec.prompt === "string" ? spec.prompt : "",
        roles: Array.isArray(spec.roles) ? (spec.roles as string[]) : [],
        skills: Array.isArray(spec.skills) ? (spec.skills as string[]) : [],
      });
    } catch (err) {
      sshLogger.warn("wakeups-list: parse error for host slug", {
        operation: "wakeups_list_parse_error", hostId, hostName, slug,
      });
      // Skip poisoned entry — one bad file must not poison the list.
    }
  }
  return out;
}

export default router;
```

### Write handler skeleton (POST / — CREATE)
```typescript
// Assembled from roles-create.ts:286-629 + identity-artifact-reader.ts:2583-2700
router.post("/", authenticateJWT, bodyParser.json({ limit: "64kb" }), async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { host: hostId, spec } = req.body as { host?: number; spec?: WakeupSpec };

  // ── Validate ────────────────────────────────────────────
  if (typeof hostId !== "number" || !Number.isInteger(hostId) || hostId <= 0) {
    return res.status(400).json({ error: "host must be a positive integer" });
  }
  const validationError = validateWakeupSpecMatchingScheduler(spec);  // D-08
  if (validationError) return res.status(400).json({ error: validationError });

  // ── Derive slug + shell-safety gate ─────────────────────
  const slug = normalizeWakeupSlug(spec.name);  // reuse from identity-artifact-reader.ts
  if (!IDENTITY_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "name normalizes to empty or invalid slug" });
  }

  // ── Resolve host + serialize per host ───────────────────
  const host = await resolveHostById(hostId, userId);
  if (!host) return res.status(404).json({ error: "Host not found" });

  await getHostSemaphore(hostId).run(async () => {
    if (isLocalHostId(hostId)) {
      return writeWakeupCreateLocal(hostId, slug, spec, res);
    }
    return writeWakeupCreateRemote(host, slug, spec, res);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-role wake-up dispatch (coordinator Type C) | Global on-disk specs at `~/fleet/wakeups/<slug>/wakeup.json` fired by session-independent scheduler | Phase 127 (2026-09-21, shape 1 of this campaign) | Per-role wake-up subsystem retired fleet-wide; 28 specs migrated. This phase closes the loop by deleting the still-live per-role CRUD API surface. |
| Wake-up CRUD via WebSocket wire ops | REST HTTP for the new global surface | This phase (D-01) | REST fits fleet-wide aggregation naturally. Existing per-identity WS surface (`identity:list-wakeups`, `identity:update-wakeup`, etc.) STAYS for per-identity wake-ups — a different subsystem. |
| `sftp.rename(tmp, target)` for atomic overwrites | `sftp.ext_openssh_rename(tmp, target)` | Root-caused 2026-08-02 (Stacy on ceo-skynet) → landed in Skynet fleet-wide | POSIX-semantics atomic overwrite; universal on OpenSSH ≥5.1. Regression test installed at identity-artifact-reader.remote-writes.test.ts. |

**Deprecated/outdated:**
- **Per-role wake-up specs at `~/fleet/roles/<role>/wakeups/*.json`** — retired Phase 127. Zero remaining fleet-wide. This phase removes the API surface that was still serving them.
- **`identity:list-role-wakeups` + `identity:update-role-wakeup` + `identity:create-role-wakeup` + `identity:delete-role-wakeup`** (Phase 72 Plan 01 per-identity two-step) — being removed (D-11).
- **`role:list-wakeups` + `role:create-wakeup` + `role:update-wakeup` + `role:delete-wakeup`** (Phase 90 Plan 90-07 role-name-keyed) — being removed (D-11).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The frontend's per-tab open state can't out-live the deploy (i.e., a stale tab won't try to hit a WS handler that's been deleted, because RoleModal's role-wakeup tab is also deleted in the same phase). If Ashley has a browser tab open at the deploy moment on the OLD build, it CAN fire a `role:list-wakeups` message that gets no response. | Runtime State Inventory | Very low. Ashley's own usage pattern: hard-refresh after deploy is standard. Worst case: modal's role-wakeup tab shows loading forever until refresh. No data loss, no crash. |
| A2 | The LIST fan-out's per-host timeout of 15s is enough for a healthy host (typical read time < 500ms). The 25s in conversation-search.ts includes JSONL grep across every identity — much heavier than a directory-list of small JSON files. | Code Examples (list handler) | Low. Even a heavily-loaded box reads `<20> JSON files in <2s`. 15s gives 10× headroom. Planner can bump if smoke test surfaces stragglers. |
| A3 | `~/fleet/wakeups/` may not exist on a host that never had a wake-up spec written yet. The `for d in */; do` shell loop returns empty output cleanly on a missing dir when `cd 2>/dev/null` short-circuits (via the `&&` chain). Verified in the readIdentityWakeups pattern which does exactly this. | Pattern 2 | Low. Same pattern shipped in Phase 72; well-tested. |
| A4 | Adding a `getLocalWakeupsRoot()` helper alongside `getLocalIdentitiesRoot()` in `identity-artifact-reader.ts` (or a companion module) is a low-touch change. The existing `getLocalIdentitiesRoot()` is HOME_HOST_DIR-derived; add a peer that returns `<fleetRoot>/wakeups` = `path.dirname(getLocalIdentitiesRoot()) + "/wakeups"`. | Pattern 3 | Very low. Follows Phase 117 M-K pattern verbatim. |
| A5 | The `Wakeup` type currently defined in `identity-artifact-reader.ts` L1384 is per-identity-focused (has `instruction` field). The new global-wake-up LIST response uses different fields (`prompt`, `roles[]`, `skills[]`, `host`). A NEW type `WakeupListItem` is the right shape — do NOT try to extend the existing `Wakeup` type. | Code Examples | Very low. Naming clarity matters; keep the two types distinct. |

**Signal to planner:** All assumptions above are LOW risk. None require user confirmation before execution. Every one is a shape / naming call inside Claude's discretion per D-01..D-19.

## Environment Availability

Skipped — this phase adds code + config, no external tools introduced. All required primitives (ssh2, drizzle-orm, express, node fs) are already vendored in the Skynet container.

## Existing tests to touch

**Delete wholesale (4 files, D-13):**
1. `src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts`
2. `src/backend/claude-session/claude-session-server.role-wakeups.test.ts`
3. `src/backend/claude-session/claude-session-server.role-wakeup-crud.test.ts`
4. `src/ui/api/claude-session-api.role-wakeup-crud.test.ts`

**Surgical edits (2 files, D-13 — audit results below):**

5. **`src/ui/api/claude-session-api.role-reads.test.ts`** (241 lines). Header docstring says the file covers R1 (getRoleFileByName), R3 (listBountiesForRoleName), R5+R6 (listRoleWakeupsByName). Only R5+R6 come out. The two other test blocks stay. Grep says the wakeup tests are contained in a single `describe("listRoleWakeupsByName one-shot helper", ...)` block starting ~L180 — delete that whole block. R1 + R3 stay. **File stays.**

6. **`src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx`** (357 lines). Header says "Phase 90 Plan 90-06 Task 2 — PrettyView role-modal-swap coordination." The 4 wakeup helpers appear ONLY as mocks in the `vi.mock("@/api/claude-session-api", ...)` block at L72-90: `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`. Delete those 4 mock lines. The test bodies themselves (starting L261 "PrettyView role-modal swap coordination (Phase 90 D-04)") stay. **File stays.**

**Keep untouched (D-13 explicit):**
- `src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts` — per-identity wake-up CRUD, still live.

**New tests to add (LIST + write endpoints):** mirror the shape of `roles-list-for-host.test.ts` (mocks connectOneShot + execCommand + resolveHostById; test via a bare Express app on a random port; 10-15 test cases covering: missing/invalid host, 404 for unknown, LIST fan-out with one host down, LOCAL branch, REMOTE branch, atomic write, 409 clobber, hard-delete + sentinel cleanup, invalid-slug rejection, oversized-prompt rejection...).

## Validation Architecture

Nyquist validation is `false` in `.planning/config.json` — SKIP this section per research instructions.

*(For orchestrator reference: the executor runs scoped tests via `npx vitest related --run <files>` on touched paths. The full-suite gate at deploy time runs `npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` — orchestrator-managed per box-maintainer.md § Test discipline.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `AuthManager.createAuthMiddleware()` (JWT via cookie or Authorization header — same middleware every route uses). |
| V3 Session Management | yes | Existing session-cookie flow; 24h admin cookie. No new session state introduced. |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` gates per-user host isolation. Returns null for cross-user/unknown → 404. |
| V5 Input Validation | yes | `IDENTITY_SLUG_RE` gate on slug (kebab-case, shell-safe); `wakeup-scheduler.py`-parity gate on spec fields (D-08); `bodyParser.json({limit: 64kb})` to cap request size. |
| V6 Cryptography | no | No new crypto. Existing TLS at Caddy edge, encrypted-SQLite for host creds — unchanged. |
| V7 Error Handling & Logging | yes | `sshLogger.warn/error/debug` with operation tags; no upstream stderr in response bodies. |
| V8 Data Protection | yes | Wake-up specs live on host disks; no new secret material introduced. |
| V10 Malicious Code | yes | Do not execute user-supplied strings as shell — every slug + name + prompt goes through the SFTP writeFile path or through single-quoted shell interpolation of a pre-validated slug. |

### Known Threat Patterns for {backend REST + SSH fan-out}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via slug in remote command | Tampering | Slug passes `IDENTITY_SLUG_RE` gate at handler entry; interpolated into double-quoted shell path; also single-quoted at the JS command-string boundary via `shellEscape()` (defense in depth). |
| Path traversal via slug (`..`) | Tampering | `IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i` — no `.` allowed. Traversal structurally impossible. |
| Cross-user host provisioning (T-22-04-03 parallel) | Tampering / Elevation | `resolveHostById(hostId, userId)` returns null for cross-user → 404. Same gate every route uses. |
| Information disclosure via SSH stderr in response | Info disclosure | Generic 5xx bodies ("SSH connect failed" / "SSH exec failed"); upstream detail logged via sshLogger only. |
| DoS via unbounded prompt or unbounded schedule field | Availability | `bodyParser.json({limit: 64kb})`; per-field cap on prompt (mirror `SPEAK_TEXT_MAX = 25000` cap from voice.ts if we want a hard cap, or leave uncapped like the scheduler — planner picks based on D-08 strict reading). |
| DoS via one slow host stalling the LIST | Availability | Per-host `Promise.race([work, timeout(15s)])` + `.catch(() => [])`. |
| CORS-preflight bypass via multipart | Elevation of privilege | N/A — this phase uses `application/json`, not multipart. No `multipartOriginGuard` needed. |
| Slug reuse after hard delete (orphan sentinel) | Availability (silent-fail) | DELETE cleans up `.state/<slug>.fired` alongside folder removal (D-06). |
| Race between two concurrent CREATEs on the same slug | Tampering | `getHostSemaphore(hostId).run(...)` serializes per-host writes. Second CREATE sees the freshly-written file and 409s. |
| Scheduler-parser drift (API validates something scheduler doesn't) | N/A (correctness) | D-08 makes API validation MIRROR the scheduler's `_load_specs_global()` at wakeup-scheduler.py L224-248. |

## Sources

### Primary (HIGH confidence — read directly this session)

- **CONTEXT.md** — `.planning/phases/134-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-/134-CONTEXT.md`. Every locked decision.
- **Shape file** — `.planning/campaigns/wake-ups-redesign/shape-wake-ups-crud-api.md`. Philosophy + "what would make it wrong" + scope edges.
- **Campaign artifact** — `.planning/campaigns/wake-ups-redesign/campaign-wake-ups-redesign.md`. Sequencing (shape 1 closed → shape 2 → shape 3).
- **Shape 1 close-out** — `.planning/campaigns/wake-ups-redesign/shape-wake-ups-backend.closed.md`. On-disk convention, scheduler, birth pipeline.
- **Phase 127 CONTEXT** — `.planning/phases/127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-/127-CONTEXT.md`. D-04 spec field shape, D-11 spawn-request drop, D-12 roles[]/skills[]/prompt.
- **PROJECT.md § Constraints** — `.planning/PROJECT.md`. Nginx paired-blocks rule (verbatim: "Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`.").
- **Box-maintainer role file** — `~/fleet/roles/box-maintainer/box-maintainer.md`. Fleet-wide test discipline, container mutation coordination, deploy boundary, backend TS quirks, no-worktrees rule, no-streaming rule.
- **wakeup-scheduler.py** — `substrate/scripts/wakeup-scheduler.py` (D-08 validation source of truth). Read L1-248 to understand `_load_specs_global()` acceptance criteria.
- **identity-artifact-reader.ts** — `src/backend/claude-session/identity-artifact-reader.ts`. Home of:
  - `humanizeWakeupSchedule` (L116) — reuse for LIST response.
  - `readIdentityWakeups` (L1434) — SSH-fan-out delimiter pattern.
  - `writeIdentityWakeupCreate` (L2359), `writeIdentityWakeupUpdate` (L2003), `writeIdentityWakeupDelete` (L2437) — atomic-write shape (STAYS, per-identity).
  - `readRoleWakeups` (L1558), `readRoleWakeupsByName` (L4042), `writeRoleWakeupCreate` (L2215), `writeRoleWakeupUpdate` (L2098), `writeRoleWakeupDelete` (L2309), `writeRoleWakeupByName` (L4174) — DELETE these six per D-10.
  - `writeMarkdownFileAtomic` (L2583) — atomic-write reference impl; prologue at L2547-2582 documents the ext_openssh_rename requirement.
  - `IDENTITY_SLUG_RE` (L1431), `IDENTITY_KEY_RE` (L175), `isLocalHostId()` (L233) — shared primitives.
  - `WakeupSpec` (L1972), `WakeupUpdate` (L1953) — existing types (may need a new `GlobalWakeupSpec` type with `prompt`/`roles`/`skills` shape, since these use `instruction` and no roles/skills).
  - `normalizeWakeupSlug` (L2183), `validateWakeupSpec` (L2190) — reuse the slug helper; extend/replace the spec validator to match scheduler shape (D-08).
- **claude-session-server.ts** — `src/backend/claude-session/claude-session-server.ts`. WS handlers being deleted:
  - Wire-op JSDoc block L124-211 — remove role-wakeup entries (both response types + payloads).
  - `role:list-wakeups` handler at ~L1780-1830.
  - `handleRoleWriteWakeup` at ~L1839-1906 (`role:wakeup-created` + `role:wakeup-updated`).
  - `role:delete-wakeup` at ~L1918-1976.
  - `identity:list-role-wakeups` at ~L2050-2108.
  - `identity:update-role-wakeup` at ~L2117-2195.
  - `identity:create-role-wakeup` at ~L2225-2260.
  - `identity:delete-role-wakeup` at ~L2299-2325.
  - Imports at L81-89 (`readRoleWakeupsByName`, `readRoleWakeups`, `writeRoleWakeupUpdate`, `writeRoleWakeupCreate`, `writeRoleWakeupDelete`, `writeRoleWakeupByName`) — drop after removing handlers.
- **claude-session-api.ts** — `src/ui/api/claude-session-api.ts`. Frontend helpers being deleted (D-12):
  - `listRoleWakeupsByName` (L1499-1549)
  - `createRoleWakeupByName` (L1556-1608)
  - `updateRoleWakeupByName` (L1615-1667)
  - `deleteRoleWakeupByName` (L1673-1725)
  - Payload/event types L1301-1374 (RoleGetFilePayload STAYS; RoleListWakeupsPayload/RoleWakeupsLoadedEvent + all Create/Update/Delete Wakeup payloads/events go).
  - `WakeupSpecWire` (L729) STAYS — used by per-identity wake-ups + future global.
  - The old JSDoc comment block L710-713 (identity:list-role-wakeups etc.) — clean up.
- **RoleModal.tsx** — `src/ui/features/pretty-view/RoleModal.tsx`. Tab removal:
  - Imports L64-70 (`listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`) + `WakeupsTab` import L74 (audit: only used by role-wakeups tab, so remove).
  - `NAV_SECTIONS` line 89 (`{ value: "role-wakeups", ... }`) + `AlarmClock` import L46 (only used by this entry).
  - `roleWakeupsState` state L244-246.
  - Fetch block L307-321 (`listRoleWakeupsByName`).
  - `updateRoleWakeup`, `createRoleWakeup`, `deleteRoleWakeup` callbacks L340-390.
  - `<TabsContent value="role-wakeups">` block L656-669.
  - Any imports rendered orphaned by these deletions (e.g., `AlarmClock` from lucide-react — audit).
- **WakeupsTab.tsx** — `src/ui/features/pretty-view/WakeupsTab.tsx`. STAYS UNTOUCHED. Still consumed by IdentityModal.tsx at L1580-1595 for per-identity wake-ups.
- **roles-list-for-host.ts** — `src/backend/database/routes/roles-list-for-host.ts`. Direct reuse for the role-picker enumeration endpoint (D-04). Extract or re-use as-is; no extension needed unless shape-3 modal picker wants fleet-wide role enumeration (currently host-scoped).
- **roles-create.ts** — `src/backend/database/routes/roles-create.ts`. Reference POST-write pattern (multipart, but the JSON-body POST for wakeups is simpler — mirror the JWT auth + resolveHostById + connectOneShot + `getHostSemaphore(hostId).run(...)` + writeMarkdownFileAtomic shape).
- **conversation-search.ts** — `src/backend/database/routes/conversation-search.ts`. Reference FLEET-FAN-OUT pattern (host projection + Promise.all with per-host timeout + graceful [] on failure).
- **wakeup-scheduler.py** — `substrate/scripts/wakeup-scheduler.py`. Validation source of truth per D-08. `_load_specs_global()` at L224-248 defines what specs are ACCEPTED.
- **docker/nginx.conf** — `docker/nginx.conf`. Pattern for adding a `location ~ ^/wakeups(/.*)?$` block; see the `/roles` block at L440-449, `/global-files` at L462-471, `/workspace` at L525-534.

### Secondary (MEDIUM confidence)

- **ROADMAP.md § Phase 134** — describes the phase at a high level; `134-CONTEXT.md` is authoritative.
- **STATE.md** — 1MB file; not read wholesale. Known via prior context: campaign structure + roadmap-evolution notes reference the D-XX pattern.

### Tertiary (LOW confidence — none)

No tertiary sources. Every claim in this research is grounded in either a locked CONTEXT.md decision or a specific line in the codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already vendored + used by peer routes.
- Architecture: HIGH — every pattern is a copy-paste-adapt from an existing route (roles-list-for-host.ts, roles-create.ts, conversation-search.ts, identity-artifact-reader.ts).
- Pitfalls: HIGH — every pitfall is either explicitly called out in the shape file's "what would make it wrong" section OR documented as a learned preference in box-maintainer.md OR carried in an inline comment prologue in the codebase.
- Removal scope: HIGH — every filename + function name + line number verified by grep this session.

**Research date:** 2026-09-21
**Valid until:** 2026-10-21 (stable — no upstream churn expected in this domain over 30 days; the Skynet fork is on a numbered-patch cadence, not upstream-driven for this subsystem).
