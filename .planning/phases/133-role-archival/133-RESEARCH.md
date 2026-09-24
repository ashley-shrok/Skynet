# Phase 133: Role archival — Research

**Researched:** 2026-09-24
**Domain:** Full-stack — bash supervisor script + TypeScript/Express backend route + React UI + shellcheck-driven bash tests
**Confidence:** HIGH (all findings verified against the repo at HEAD on `feat/tab-title-from-tmux`)

## Summary

This is a bounded, high-analogy phase: everything the planner needs already exists in the
repo as a working reference implementation for **identity archival** (Phase 115). The
job is to clone that shape into a role-archival sibling, wire a fresh
`scan_role_archive_requested_sentinels()` supervisor scanner that cascades
`retire_identity()` calls, and refactor `retire_identity()` from cross-tick
counter-driven retries to inline per-step exponential-backoff retries — deleting the
`retire-fail-count-*` counter files and `retire-stuck` sentinel drops entirely along
the way.

Two questions the planner MUST decide before task decomposition:
(1) does the retire-refactor land as a **standalone wave** ahead of the role-cascade
wave (so both callers pick it up in one release) or interleaved with cascade work;
and (2) does the role-file-write primitive live as an extension of `writeIdentityFile`
or as a new `writeRoleFile()` sibling module (research recommends: **new sibling
module** — see §5).

**Primary recommendation:** Structure the plans as four vertical slices in strict
dependency order — (A) backend route + role-file-write primitive + frontend API
wrapper + tests; (B) `retire_identity()` inline-retry refactor + retire-stuck removal
+ scanner-cleanup + tests (both callers now benefit); (C) supervisor
`scan_role_archive_requested_sentinels()` + reconcile-loop wire-up + tests; (D)
`RolesListModal` context-menu UI + double-confirm flow + wire to (A) + id-skill docs
update. Land B before C so C's new cascade caller consumes the clean retire semantic
from birth.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger + UI**
- **D-01:** Trigger is a single operator gesture — one click producing one sentinel drop; cascade complexity lives entirely inside the supervisor. Do NOT fan out sentinels from the frontend.
- **D-02:** Affordance lives as a right-click context menu item on `RolesListModal` rows (roles-list surface), NOT on the `RoleModal` per-role detail view. Reuses `PrettyConversationContextMenu` (or a close sibling).
- **D-03:** Double confirmation. Two sequential native `window.confirm` calls after menu click.
  - **First dialog:** Lists every identity that will be cascade-archived, one line per identity. Each line uses `identity.task || identity.displayName` — same fallback the sidebar uses at `AppShell.tsx:894`. List is complete, not truncated. When zero identities hold the role, the dialog says so plainly ("archive role X? no identities hold it.").
  - **Second dialog:** Plain "are you sure? this can't be undone." — the sanity tap.
  - Both dialogs must be OK'd to proceed. Cancel at either stops.
- **D-04:** The count + task list is computed frontend-side — `Identity` type at `src/ui/api/identities-api.ts:4` already carries `role: string | null` + `hostId?: number` + `task: string | null`, so a `useIdentities()` filter gives both the count and the ordered task list with no additional RPC.

**Sentinel semantics**
- **D-05:** Sentinel filename: `.archive-requested` (same as identity), dropped at `~/fleet/roles/<name>/.archive-requested`. Path disambiguates from the identity sentinel — no filename collision because scanners walk different root dirs. Presence-only, empty file.
- **D-06:** One-shot sentinel. Deleted at end of supervisor tick that processes it, regardless of cascade success or failure. NO cross-tick persistence of archival intent.
- **D-07:** Fresh enumeration each time. Scanner walks `~/fleet/identities/*/*.md` and matches `role:` frontmatter against the role name at scan time. No snapshot.

**Cascade semantics**
- **D-08:** Fail-soft cascade. Scanner attempts to retire every enumerated identity regardless of individual failures. Does not abort after first failure.
- **D-09:** Role folder moves ONLY if every enumerated identity retired cleanly. If any identity retire failed, role folder stays put in `~/fleet/roles/<name>/`; sentinel is deleted anyway; supervisor logs LOUDLY which identities failed and why.
- **D-10:** Guard bypass for cascade identities. `.pinned`, `.no-dormancy`, and `coordinator: true` guards are BYPASSED for cascade identities — same as existing user-initiated identity archive path.
- **D-11:** Retry on failure = operator re-clicks Archive in the UI. Because scanner walks live dir fresh each time, retry naturally picks up only identities that weren't already archived.
- **D-12:** Empty cascade is a degenerate case of the same code path. If zero identities hold the role, cascade phase is a no-op and folder move happens immediately.

**Refactor of identity retirement**
- **D-13:** Refactor `retire_identity()` to use inline per-step retries with bounded exponential backoff (3 attempts, 2s/4s/8s per step). Each step (matrix deactivate, graceful harness exit, tmux kill, folder move) retries itself independently on transient failure. Retry granularity is per-step, not per-retire.
- **D-14:** Remove the cross-tick failure-count + retire-stuck-sentinel mechanism entirely. Delete `retire-fail-count-<name>` and `retire-fail-count-user-<name>` counter files in `$DORMANCY_STATE_DIR`. Delete the `retire-stuck` sentinel drop after 3 consecutive failures in both `scan_archive_requested_sentinels()` and `run_archive_scan()`. `retire_identity()` becomes atomic from the caller's perspective.
- **D-15:** Both callers of `retire_identity()` benefit. Role cascade path (new) and user-initiated identity archive path (`scan_archive_requested_sentinels`) both get the clean inline-retry semantic. The 180-day daily sweep (`run_archive_scan`) also inherits it.

**Archive location + content**
- **D-16:** Archive location: `~/fleet/roles-archive/<name>/` — sibling to `~/fleet/roles/<name>/`, exactly parallel to `~/fleet/identities-archive/`.
- **D-17:** Verbatim move, no scrubbing. Whatever lives in the role folder at the moment of archival (role file, history, runbooks, reference docs, wakeups, bounties, ad-hoc content, and yes any stray credential files) all travels along.

**Scope**
- **D-18:** Per-box only. A role and its identities are host-local (id-skill invariant: "Identities and roles are strictly 1:1 with a host"). Archival gesture, sentinel, scanner, and cascade all live on the box holding the role. No cross-box coordination.
- **D-19:** One-way, no un-archive.
- **D-20:** User-initiated only. No automated role archival.
- **D-21:** Old on-disk state from the retired mechanism is left as archaeology. Do not add cleanup logic for existing `retire-stuck` sentinels in `~/fleet/identities-archive/*/` or existing `retire-fail-count-*` files in `$DORMANCY_STATE_DIR`.

### Claude's Discretion

- Exact bash retry-loop shape inside each retire step (inline `for` loop vs helper function) — planner's call.
- Whether to introduce a per-role-file writer primitive as a separate module or extend `writeIdentityFile` to cover role paths — planner's call after checking whether an existing helper already covers the role-folder write path.
- Log format specifics for the LOUD partial-failure message — as long as it names each failed identity + the step that failed + the underlying error, format is planner's call.
- Bash unit test style + fixture setup for the substrate scanner tests — planner's call, but match the existing convention in `substrate/scripts/tests/*.test.sh`.

### Deferred Ideas (OUT OF SCOPE)

- Un-archive (role or identity).
- Automated role archival (age-based dormancy sweep).
- Cleanup of legacy retry-mechanism artifacts (old `retire-stuck` sentinels, old `retire-fail-count-*` files).
- Archive affordance on `RoleModal` (per-role detail view).
- Role-level `retire-stuck` marker.
- Reassign identity to a different role.
- Cross-box role coordination.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Right-click "Archive role" menu item on `RolesListModal` rows | Browser / Client (React UI) | — | UI-only affordance; portal-mounted context menu is pure client state |
| Cascade-preview computation (list of identities + task-or-name) | Browser / Client | — | D-04 explicit: `useIdentities()` already carries `role`, `hostId`, `task` fields; no server call needed |
| Double `window.confirm` flow | Browser / Client | — | Native browser API, zero server involvement |
| `POST /roles/:name/archive` HTTP endpoint | Frontend Server (Express, port 30001) | — | Mirrors `POST /identities/:key/archive` — auth + validation + SFTP-write role-folder sentinel |
| Sentinel drop on role folder (LOCAL fs / REMOTE SFTP) | Frontend Server | — | Same primitive shape as `writeIdentityFile()` but keyed to `~/fleet/roles/<name>/` |
| Sentinel detection (walking `~/fleet/roles/*/`) | Substrate (bash supervisor) | — | `scan_role_archive_requested_sentinels()` — new sibling of `scan_archive_requested_sentinels` |
| Enumerating identities holding the role | Substrate | — | grep frontmatter across `$IDENTITIES_DIR/*/*.md` on each cascade tick per D-07 |
| Per-identity retire (matrix deactivate → graceful exit → tmux kill → sentinel delete → workspace clean → folder move) | Substrate (bash) | — | Existing `retire_identity()` reused verbatim by cascade |
| Inline per-step retry with exponential backoff | Substrate (bash) | — | New — replaces removed cross-tick counter machinery |
| Move role folder to `~/fleet/roles-archive/<name>/` on all-clean cascade | Substrate | — | `mv` on the box holding the role |
| id-skill docs update ("On archiving a role" section) | Documentation (substrate/skills/id/SKILL.md) | — | Text-only sibling to existing "On archiving an identity" section |

**Sanity check applied:** No UI-side cascade logic (D-01 explicit). No backend-side enumeration
(D-07 makes it a supervisor concern). No supervisor-side auth (auth is at the HTTP layer, T-115-03-01 model).
No cross-box work (D-18).

## Phase Requirements

*The phase description does not map to any REQ-XX IDs in `.planning/REQUIREMENTS.md` — Phase 133
lives on the STATE.md roadmap (Phase 133 entry, 2026-09-24) rather than the v1/v2 REQUIREMENTS.md
patch #43 backlog. Traceability is via STATE.md, CONTEXT.md D-01..D-21, and shape-role-archival.md.*

## Standard Stack

### Core

| Library | Version (in repo) | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| `express` | already installed (identity-archive.ts uses it) | HTTP routing for `POST /roles/:name/archive` | Fleet-wide Skynet backend on port 30001 uses Express — cloning identity-archive.ts's router pattern |
| `ssh2` | already installed | SFTP for REMOTE role-folder writes | Same primitive `writeIdentityFile` uses in REMOTE branch |
| `axios` (`authApi` in `main-axios.ts`) | already installed | Frontend HTTP client with JWT auth attached | Mirrors `identity-archive-api.ts` exactly |
| `radix-ui` (`Dialog`) | already installed | Modal primitives for RolesListModal (already used) | RolesListModal is already Radix-based |
| bash 4+ | system | Supervisor scanner + retry loop | Existing agent-supervisor.sh convention |
| `vitest` | already installed | Backend route + frontend UI tests | Fleet-wide test runner |
| shellcheck | required by tests | Static analysis of bash | Enforced by `substrate/scripts/tests/agent-supervisor-archive-scan.sh:51` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` (`ChevronRight`, `X`, etc.) | already installed | Icons in `RolesListModal` rows | Row icons only — no new icon deps needed for context menu |
| `js-yaml` | already installed | Only if the plan chooses to parse role frontmatter in the enumeration path (it does NOT need to — a grep for `^role: <name>$` is sufficient) | Optional. Bash pattern below is simpler. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `awk` frontmatter parse | `yq`/`js-yaml` shell wrapper | awk is already used at `agent-supervisor.sh:327` for `is_coordinator` — same pattern for `role: <name>` keeps the toolchain tight |
| New `writeRoleFile()` sibling module | Extending `writeIdentityFile()` to accept a role path | New sibling is cleaner — writeIdentityFile's `ALLOWED_REL_PATHS` whitelist + `IDENTITY_KEY_RE` gate are identity-scoped by design; role names use `ROLE_NAME_PATTERN` (`/^[a-z0-9-]+$/`, no underscore), and role paths land under `~/fleet/roles/<name>/`, not identities. Widening `writeIdentityFile` would blur its H1 write/read-parity lock. **Recommendation: new module `src/backend/claude-session/per-role-file.ts` mirroring per-identity-file.ts, whitelist = `{".archive-requested"}` initially.** |
| Reuse `PrettyConversationContextMenu` for the RolesListModal rows | Build a new context-menu component | Verified: `PrettyConversationContextMenu` is decoupled — takes `{x, y, items, hue?, onClose}` props, portal-mounted to `document.body`, no coupling to conversation data. Directly reusable. **Recommendation: reuse verbatim.** |

**Installation:** All dependencies already present in the workspace. No new packages needed.

**Version verification:** Not applicable — no new external packages. All primitives referenced
are workspace-internal modules or already-installed dependencies. Verified by grepping
`package.json` and existing import sites.

## Package Legitimacy Audit

*This phase installs no external packages. Every library referenced is already in the workspace
`package.json` and imported by existing sibling routes/components. The Package Legitimacy Gate
is not applicable — nothing to install.*

## Architecture Patterns

### System Architecture Diagram

```
                             ┌──────────────────────────────────────┐
                             │  Browser (React UI)                  │
                             │                                      │
    operator right-clicks    │  RolesListModal row                  │
    a row in RolesListModal ─┼─► onContextMenu handler              │
                             │     ↓                                │
                             │  PrettyConversationContextMenu       │
                             │  (portal-mounted, item: "Archive")   │
                             │     ↓ (menu item click)              │
                             │  handleArchiveRole(role, hostId)     │
                             │     ↓                                │
                             │  useIdentities().identities.filter(  │
                             │    i => i.role === roleName          │
                             │      && i.hostId === hostId)         │
                             │     ↓                                │
                             │  window.confirm #1                   │
                             │  "archive role X? this will also     │
                             │   archive N identities:              │
                             │   • <task-or-displayName>            │
                             │   • ..."                             │
                             │     ↓ (OK)                           │
                             │  window.confirm #2                   │
                             │  "are you sure? this can't be undone"│
                             │     ↓ (OK)                           │
                             │  archiveRole(hostId, roleName)       │
                             └──────────────────┬───────────────────┘
                                                │
                                                │  POST /roles/:name/archive
                                                │  body: { hostId }
                                                ▼
                             ┌──────────────────────────────────────┐
                             │  Skynet backend (Express :30001)     │
                             │                                      │
                             │  authenticateJWT                     │
                             │     ↓                                │
                             │  ROLE_NAME_PATTERN gate + hostId     │
                             │  validation                          │
                             │     ↓                                │
                             │  resolveHostById(hostId, userId)     │
                             │     ↓                                │
                             │  isLocalHostId(hostId) ?             │
                             │    LOCAL: fs write                   │
                             │    REMOTE: connectOneShot + SFTP     │
                             │     ↓                                │
                             │  writeRoleFile(roleName,             │
                             │                ".archive-requested", │
                             │                "", {hostId, conn})   │
                             │     ↓                                │
                             │  200 { ok: true }                    │
                             └──────────────────┬───────────────────┘
                                                │
                                                │  drops file at
                                                │  ~/fleet/roles/<name>/
                                                │           .archive-requested
                                                ▼
                             ┌──────────────────────────────────────┐
                             │  Substrate: agent-supervisor.sh      │
                             │  (systemd --user service on the box) │
                             │                                      │
                             │  reconcile() [~every 15s]            │
                             │     ↓                                │
                             │  scan_role_archive_requested_        │
                             │     sentinels()  ← NEW               │
                             │     ↓                                │
                             │  for each ~/fleet/roles/<n>/         │
                             │      .archive-requested:             │
                             │     ↓                                │
                             │  enumerate identities:               │
                             │    for d in ~/fleet/identities/*/;   │
                             │      awk parses role: frontmatter    │
                             │      collect matches                 │
                             │     ↓                                │
                             │  for each identity (fail-soft):      │
                             │     retire_identity(name)  ← reused, │
                             │       now with inline per-step       │
                             │       retries (3× 2s/4s/8s)          │
                             │     ↓ track failures                 │
                             │  if all succeeded:                   │
                             │     mkdir -p ~/fleet/roles-archive/  │
                             │     mv ~/fleet/roles/<n>/            │
                             │        ~/fleet/roles-archive/<n>/    │
                             │  else:                               │
                             │     LOUD log: failed identities +    │
                             │     which step + underlying error    │
                             │     (role folder stays live)         │
                             │     ↓                                │
                             │  rm ~/fleet/roles/<n>/               │
                             │     .archive-requested  [always]     │
                             └──────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── backend/
│   ├── claude-session/
│   │   ├── per-identity-file.ts       # EXISTING — unchanged
│   │   └── per-role-file.ts           # NEW — mirrors per-identity-file.ts shape
│   └── database/
│       ├── database.ts                # EDIT — mount role-archive router BEFORE /roles routers
│       └── routes/
│           ├── identity-archive.ts    # EXISTING — reference implementation
│           ├── identity-archive.test.ts # EXISTING — reference test shape
│           ├── role-archive.ts        # NEW — mirrors identity-archive.ts byte-for-byte in structure
│           └── role-archive.test.ts   # NEW — mirrors identity-archive.test.ts, 8-test coverage
├── ui/
│   ├── api/
│   │   ├── identity-archive-api.ts    # EXISTING — reference shape
│   │   ├── identity-archive-api.test.ts # EXISTING — reference test
│   │   ├── role-archive-api.ts        # NEW — archiveRole(hostId, roleName)
│   │   └── role-archive-api.test.ts   # NEW
│   └── features/
│       ├── pretty-view/
│       │   ├── RolesListModal.tsx     # EDIT — wire onContextMenu + double confirm flow
│       │   └── RolesListModal.test.tsx # EDIT — add tests for context menu + confirm path
│       └── pretty-conversations/
│           └── PrettyConversationContextMenu.tsx # UNCHANGED — reused as-is
substrate/
├── scripts/
│   ├── agent-supervisor.sh            # EDIT — refactor retire_identity + remove counters
│   │                                  #        + add scan_role_archive_requested_sentinels
│   │                                  #        + wire into reconcile()
│   └── tests/
│       ├── agent-supervisor-archive-scan.sh   # EDIT — remove retire-stuck tests (D-14 removal)
│       └── agent-supervisor-role-archive.test.sh # NEW — cascade happy path, partial failure,
│                                                  # empty cascade, retire-refactor per-step retry
└── skills/
    └── id/
        └── SKILL.md                   # EDIT — add "On archiving a role" section, sibling to
                                       #        "On archiving an identity" (L790)
```

### Pattern 1: Sentinel-drop-then-supervisor-consume (established by Phase 115)

**What:** Frontend writes a presence-only marker file to the target directory via authenticated SFTP; supervisor's reconcile tick detects the marker on its next pass and executes the intended action; sentinel is deleted at the end of the tick regardless of success.

**When to use:** Any operator-initiated action on a resource whose supervisor already runs on the target box. Avoids inventing a bidirectional RPC channel from web layer to supervisor.

**Example (from identity-archive.ts, lines 76-158):**
```typescript
// Source: src/backend/database/routes/identity-archive.ts
router.post("/:key/archive", authenticateJWT, async (req, res) => {
  // 1. Parse + validate hostId
  // 2. Validate identity key via IDENTITY_KEY_RE
  // 3. resolveHostById(hostId, userId) → 404 on cross-user
  // 4. LOCAL vs REMOTE branch (isLocalHostId + connectOneShot)
  // 5. writeIdentityFile(key, ".archive-requested", "", {hostId, conn})
  // 6. 200 { ok: true }
});
```

**For role-archive.ts:** substitute `key` → `name`, `IDENTITY_KEY_RE` → `ROLE_NAME_PATTERN`,
`writeIdentityFile` → `writeRoleFile`. Every other line stays.

### Pattern 2: Bash per-step inline retry with exponential backoff (NEW — no prior art)

**What:** A bash for-loop wrapping each step of `retire_identity()`, retrying the step 3× with `sleep 2`, `sleep 4`, `sleep 8` between attempts before giving up and returning failure.

**Why new:** A repo grep for `retry|backoff` in `substrate/scripts/*.sh` returns zero matches for a reusable bash retry helper. The Python `role-file-watch.py` uses exponential backoff internally (lines 700-848), but that pattern is not portable into bash without translation.

**Recommended shape** (planner may adjust — this is illustrative, not prescriptive):
```bash
# Inline pattern — no helper function needed for 3-attempt loop
_step_ok=0
for _attempt in 1 2 3; do
  if <do-step>; then
    _step_ok=1
    break
  fi
  if [ "$_attempt" -lt 3 ]; then
    _delay=$((2 ** _attempt))   # 2, 4, 8
    log "'$name' retire step X attempt $_attempt failed — sleeping ${_delay}s before retry"
    sleep "$_delay"
  fi
done
[ "$_step_ok" = 1 ] || { log "ERROR: '$name' retire step X FAILED after 3 attempts"; return 1; }
```

Alternative — helper function:
```bash
retry_with_backoff() {
  local step_name="$1"; shift
  local attempt delay
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      delay=$((2 ** attempt))
      log "retry '${step_name}' attempt ${attempt} failed — sleeping ${delay}s"
      sleep "$delay"
    fi
  done
  return 1
}
```

Planner's call — the inline pattern is more explicit but repetitive; the helper is DRY-er
but adds a call-frame the caller has to reason about. Given the retire has ~4 steps that
retry, and each step has different failure semantics (matrix returns HTTP codes, mv
returns exit codes), **inline is probably cleaner** — the retry loop lives right next to
the step's `case $http_code in ... esac`. Recommend inline.

### Pattern 3: Multi-router mount on same base path (Express)

**What:** Mount multiple Express routers at the same `/roles` base path; Express chains them so requests fall through until a matching handler is found. Verified in `database.ts:2051-2061` — three `/roles` mounts (list + create + generic) coexist because their handlers cover disjoint HTTP-method/path combinations.

**Where the new mount goes:**
```typescript
// database.ts, insert BEFORE existing /roles mounts (line 2051):
app.use("/roles", roleArchiveRoutes);      // NEW — POST /:name/archive
app.use("/roles", rolesListForHostRoutes); // EXISTING
app.use("/roles", rolesCreateRoutes);      // EXISTING
app.use("/roles", rolesRoutes);            // EXISTING (has /:name/avatar)
```

**Why FIRST:** rolesRoutes at line 2061 defines `router.get("/:name/avatar")` — an exact
`POST /:name/archive` wouldn't collide, but the safest pattern is the one the identity
side already applies (Phase 115 mounts identity-archive BEFORE the generic identities
router per line 2033 comment). Mirror that discipline.

### Pattern 4: Two sequential `window.confirm` calls for double-confirmation

**What:** Two sequential `if (!window.confirm(...)) return;` calls. Simple, native, no dep. Mirrors the existing single-confirm pattern from `handleArchive` at `PrettyConversationsPanel.tsx:1492` and `IdentitySessionPane.tsx:227`.

**Example:**
```typescript
// First dialog — blast radius
const affectedIdentities = identities
  .filter(i => i.role === roleName && i.hostId === hostId);
const displayLabel = role.displayName ?? roleDisplayName(role.name);
const dialog1 = affectedIdentities.length === 0
  ? `archive role ${displayLabel}? no identities hold it.`
  : `archive role ${displayLabel}? this will also archive ${affectedIdentities.length} identities holding it:\n` +
    affectedIdentities.map(i => `• ${i.task || i.displayName}`).join("\n");
if (!window.confirm(dialog1)) return;

// Second dialog — sanity tap (matches identity-archive copy exactly)
if (!window.confirm("are you sure? this can't be undone.")) return;

// Fire-and-forget
void archiveRole(hostId, roleName).catch(err => {
  console.warn({ operation: "role_archive_failed", hostId, roleName,
                 errMessage: err instanceof Error ? err.message : String(err) });
});
```

### Anti-Patterns to Avoid

- **Fanning out N sentinels from the frontend** — one for each identity + one for the role. Violates D-01 explicitly and defeats the "cascade complexity in the supervisor" separation. The single role-folder sentinel is the whole message.
- **Persisting cascade state across ticks** — a `.role-archive-in-progress` marker or in-memory job registry. Violates D-06 (one-shot sentinel) and re-introduces the exact anti-pattern D-14 removes. The disk walk on each tick IS the state.
- **Adding a retire-stuck marker to the role path** — mirroring what we're removing from identities. Called out explicitly in shape's "Tempting-but-no" list. The refactor's whole point is to eliminate cross-tick failure state.
- **Half-archiving the role** — moving `~/fleet/roles/<name>/` before every enumerated identity is cleanly retired. Surviving identities would then point at a role that no longer exists in the live tree. D-09 lock: folder move is the LAST cascade step and gated on all-clean.
- **Reading `.pinned`/`.no-dormancy`/`is_coordinator` guards in the cascade path** — D-10 explicit bypass. The guards protect against automated retire surprises; operator click ≠ automated.
- **Silently succeeding a partial cascade** — must emit a LOUD `ERROR:` log line per failed identity, naming the identity, the step that failed, and the underlying error. This is one of the ONE explicit carve-outs in the `retire_identity()` silent-by-design discipline (see `agent-supervisor.sh:842-843` — same carve-out precedent applies here).
- **Writing to `~/fleet/roles/<name>/` from a widened `writeIdentityFile`** — the primitive's H1 write⇔read parity lock (per-identity-file.ts:14-31) is identity-scoped by design. A role-file writer belongs in a new module.
- **Awk parse of role frontmatter that misses YAML variants** — the `is_coordinator` awk at line 327 handles ONE shape: `^coordinator: true$` between the first two `---` delimiters. For role matching, the plan needs to handle `^role: <name>$` and `^role: "<name>"$` and `^role: '<name>'$` (quoted variants are possible per YAML but Skynet convention is unquoted — see any live identity file). Recommendation: match unquoted first, quoted as fallback, log a WARN if we see a quoted variant so we surface fleet-drift.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Right-click context menu with portal + Escape/click-outside + viewport clamp + drill-in | Custom `<div>` positioning | `PrettyConversationContextMenu` (existing) | 383 lines of hard-won iOS Safari fixes (patch #181, quick-260807-igo). Reuse verbatim. |
| SFTP write with atomic tmp+rename | Direct `sftp.writeFile()` | `writeMarkdownFileAtomic` (via new `writeRoleFile()`) | Ext_openssh_rename atomicity discipline; identity-birth learned this the hard way. |
| SSH connection lifecycle | `new Client().connect()` | `connectOneShot()` with try/finally `conn.end()` | Timeout + auth + error normalization already handled. |
| Host ownership check | Custom DB query | `resolveHostById(hostId, userId)` | Returns null for cross-user hosts, drives the 404 no-probe-info-leak pattern (T-115-03-01). |
| JWT auth | Custom middleware | `AuthManager.getInstance().createAuthMiddleware()` | Fleet-wide standard. |
| Identity task/displayName fallback for dialog | Custom lookup | `identity.task || identity.displayName` (mirrors `AppShell.tsx:894`) | D-03 explicit — verbatim same pattern the sidebar uses. |
| Bash retry with backoff | Custom sleep loop | (nothing exists) — planner writes inline `for _attempt in 1 2 3; do ... sleep $((2 ** _attempt)); done` | No pre-existing helper. Recommended pattern in §Pattern 2. |
| Frontmatter parse for `role:` field | Regex on file body | awk-between-`---` pattern from `is_coordinator` (line 324) | Existing pattern; frontmatter is delimited by `---` fences. |
| Test hermetic supervisor sourcing | Custom setup | `_source_supervisor` from `agent-supervisor-archive-scan.sh:89` | Existing hermetic sourcing contract with AGENT_IDENTITIES_DIR + AGENT_IDENTITIES_ARCHIVE_DIR + DORMANCY_STATE_DIR overrides + AGENT_SUPERVISOR_LIB_ONLY=1 guard. |

**Key insight:** Every layer of this phase has direct prior art in Phase 115 (identity
archive) or Phase 94 (archive scan). The plan should be almost mechanical translation
from identity → role for the write path, and a small delta on the supervisor side
(new scanner + retire refactor). New invention: only the bash inline-retry pattern.

## Runtime State Inventory

*This phase is not a rename/migration/refactor of an existing tenant/prefix. However, it DOES delete
runtime state (retire-fail-count-* files + retire-stuck sentinels) as part of D-14, so a
scoped inventory is worth carrying:*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — this phase adds new data (role-archive folder tree) and removes stale data (retire-fail-count-* + retire-stuck files); no rename of existing tenant IDs, mem0 user_ids, ChromaDB collections, etc. | none |
| Live service config | None — no n8n workflows, Datadog services, Cloudflare Tunnels, or Tailscale ACLs are involved. All state is on-box files under `$HOME/fleet/` and `$DORMANCY_STATE_DIR`. | none |
| OS-registered state | agent-supervisor is a systemd `--user` service on every fleet box. **No action required** — the refactor changes function bodies inside the script; systemd unit definitions do not reference `retire_identity` or the counter files. Verified by grepping for supervisor systemd units: none carry retire-related directives. | none — supervisor will pick up new script on next redeploy; a restart of `systemctl --user restart agent-supervisor.service` would be needed to reload if operator wants immediate uptake, but supervisor's `--once` mode invocation is also unaffected. |
| Secrets / env vars | None. The refactor does not touch `relay.json`, SOPS keys, JWT secrets, or SSH keys. Matrix deactivation credential reading (relay.json fields `base`, `user_id`, `password`, `access_token`) is unchanged — refactor only changes retry mechanics around the existing read path. | none |
| Build artifacts / installed packages | None. No pip egg-info, no npm globals, no Docker image tags carry the name of retire-fail-count-* or retire-stuck. The supervisor script is delivered as a plain bash file into `substrate/scripts/`. | none |

**Existing on-disk state from removed mechanism** (per D-21, explicit archaeology decision — do NOT sweep):
- `$DORMANCY_STATE_DIR/retire-fail-count-<name>` files on any box that had a supervised identity fail retire recently. Verified paths from tests: `agent-supervisor-archive-scan.sh:666`.
- `$IDENTITIES_ARCHIVE_DIR/<name>/retire-stuck` sentinels on any box that hit 3-fail threshold. Verified paths from tests: `agent-supervisor-archive-scan.sh:670`.
- Both classes: **left in place**. Operator can `find ~/fleet/identities-archive -name retire-stuck -delete` and `rm $DORMANCY_STATE_DIR/retire-fail-count-*` manually if desired (documented per D-21).

## Common Pitfalls

### Pitfall 1: Route mount order — role-archive shadowed by generic roles handler

**What goes wrong:** If `roleArchiveRoutes` mounts AFTER `rolesRoutes` at line 2061, then `POST /roles/:name/archive` might fall through to `rolesRoutes`'s handlers first. `rolesRoutes` currently only defines `GET /:name/avatar`, so today it wouldn't shadow, but a future edit to `rolesRoutes` adding `POST /:name` could silently break the archive route.

**Why it happens:** Express's chained routers respect declaration order for path matching within the same base path.

**How to avoid:** Mount `roleArchiveRoutes` BEFORE all other `/roles` mounts in `database.ts` (insert at line 2051 or above). Add a comment matching the identity-archive precedent at `database.ts:2027-2033`.

**Warning signs:** Test 3 (or wherever the plan puts the mount-order regression test) fails with a wrong-handler response body shape. `curl -X POST http://localhost:30001/roles/example/archive -d '{"hostId":1}'` returning HTML/404 instead of `{error: "..."}` JSON.

### Pitfall 2: Cascade enumeration matches wrong role via substring/regex sloppiness

**What goes wrong:** If the enumeration uses `grep "role: $name"` naively, then archiving a role called `foo` also cascades identities holding a role called `foo-bar`. Or, if the awk pattern is too loose, an inline mention of `role: foo` in the identity file body (not in frontmatter) is picked up.

**Why it happens:** Frontmatter parsing is delimiter-sensitive; the `is_coordinator` awk at line 327 uses `f==1` to gate matches to between the first two `---` fences. A cascade enumeration MUST do the same.

**How to avoid:** Reuse the `is_coordinator` awk shape verbatim, substituting the matcher line:
```bash
identity_has_role() {
  local identity_file="$1" want_role="$2"
  [ -f "$identity_file" ] || return 1
  awk -v w="$want_role" '
    /^---$/{f++}
    f==1 && $0 ~ ("^role: " w "$"){found=1; exit}
    END{exit !found}
  ' "$identity_file"
}
```
Also handle the quoted variants (`"$want_role"` and `'$want_role'`) — grep any of them, log a WARN on quoted so fleet-drift surfaces.

**Warning signs:** Cascade retires an identity that doesn't hold the archived role. A test with two role folders (`foo` and `foo-bar`) and identities holding each catches this.

### Pitfall 3: Retire refactor breaks existing 180-day daily sweep tests

**What goes wrong:** `substrate/scripts/tests/agent-supervisor-archive-scan.sh` has multiple tests (`retire-stuck: counter must equal $i after $i failed passes`, `retire-stuck: sentinel MUST be dropped on pass 3`, etc.) that verify the CURRENT cross-tick-counter mechanism. D-14 removes that mechanism, which means all those assertions must be deleted or rewritten to assert the NEW inline-retry semantic instead.

**Why it happens:** The existing test file at lines ~666-1017 has extensive retire-stuck test coverage. Simply removing the code without updating tests leaves the test file asserting behaviors that no longer exist → red suite on first run.

**How to avoid:** In the same wave that removes the counter mechanism from `agent-supervisor.sh`, delete the retire-stuck test blocks from `agent-supervisor-archive-scan.sh`, and add new tests asserting:
1. `retire_identity` succeeds after 2 transient failures on step 1 (retry recovers).
2. `retire_identity` returns 1 after 3 consecutive failures on step 1 (bounded).
3. The counter file (`$DORMANCY_STATE_DIR/retire-fail-count-*`) is NEVER written.
4. The retire-stuck sentinel (`$archdir/retire-stuck`) is NEVER touched.
5. Both scanner paths (`run_archive_scan` and `scan_archive_requested_sentinels`) invoke `retire_identity` and log its return value; neither writes counter files any more.

**Warning signs:** `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` fails on tests 5+ (search the file for "retire-stuck" — every match is a candidate for delete-or-rewrite).

### Pitfall 4: Retire's grand total time balloons past sensible reconcile budget

**What goes wrong:** Each of retire's 4 heavy steps (matrix deactivate, graceful exit, tmux kill, folder move) now has 3 attempts with 2s/4s/8s waits. Worst case per step: 14s of sleep + step time. Across 4 steps: 4 × ~14s = 56s of sleep alone. Add step body times, plus the existing GRACE_WAIT=11 in step 2 (which itself is intentional), and a single retire can take 90+ seconds when failing. Cascade over N identities compounds: N × 90s. The reconcile loop is sequential; a stuck cascade hangs the whole tick.

**Why it happens:** Multiplicative wait times when transient failures happen across multiple steps.

**How to avoid:**
- **Option A (recommended):** Apply retries ONLY to the steps that genuinely benefit — matrix deactivate (network flake) and folder move (fs race). tmux kill and graceful exit already have their own idempotency / bounded-timeout discipline; wrapping them in a 3-attempt retry offers little benefit and adds latency. Planner decides which subset.
- **Option B:** Cap retries at 2 attempts (2s + 4s = 6s max sleep per step). Still gives one recovery shot for transient blips.
- **Option C:** Accept the worst case as a plan-time note and document that a stuck cascade may pause reconcile for a minute or two — acceptable given D-08 fail-soft + D-09 stays-in-live-tree behavior means the operator sees the delay and retries.

**Recommendation:** Option A. Steps 1 (matrix) + 4b (folder move) benefit; steps 2 (graceful exit, already best-effort) + 3 (tmux kill, already no-op on absent) do not. The exact per-step retry mapping is a plan-time decision worth calling out for the planner.

**Warning signs:** Existing tests measure elapsed time and fail on regressions; if the plan sets 3-attempt retries on all 4 steps, expect test-elapsed-time assertions in agent-supervisor-archive-scan.sh to fail.

### Pitfall 5: Sentinel-delete race between cascade success and folder move

**What goes wrong:** D-06 says "sentinel deleted at end of tick regardless of success/failure." D-09 says "folder moves only if every identity retired cleanly." If the delete order is (a) delete sentinel, then (b) move folder, and (b) fails, we're in an intermediate state where the operator sees the role still live but the sentinel gone (matches design). If the delete order is (a) move folder, then (b) delete sentinel — the sentinel is now inside `roles-archive/<name>/` and next tick doesn't see it (because it's outside `$IDENTITIES_DIR`), still correct.

**Why it happens:** Two possible orderings both need thought.

**How to avoid:** The safer order is: **complete cascade → conditionally move folder → delete sentinel LAST**. If move succeeds, the folder + sentinel travel together into `roles-archive/<name>/.archive-requested` (harmless — nothing scans there). Then `rm ~/fleet/roles-archive/<name>/.archive-requested` cleans it up. If move fails, we `rm ~/fleet/roles/<name>/.archive-requested` in the live tree. Either way, the live-tree sentinel is gone. Simpler:

```bash
# End of cascade path
if [ "$all_clean" = 1 ]; then
  mv "$IDENTITIES_ROLES_DIR/$name" "$ROLES_ARCHIVE_DIR/$name" \
    && rm -f "$ROLES_ARCHIVE_DIR/$name/.archive-requested" \
    || { log "ERROR: role '$name' folder move FAILED after cascade"; rm -f "$IDENTITIES_ROLES_DIR/$name/.archive-requested"; }
else
  log "ERROR: role '$name' partial cascade — see per-identity failures above; role folder retained"
  rm -f "$IDENTITIES_ROLES_DIR/$name/.archive-requested"
fi
```

**Warning signs:** A test that runs a partial cascade sees the sentinel present in `roles/<name>/` after the tick (BUG) rather than deleted.

### Pitfall 6: Cascade preview + live enumeration race

**What goes wrong:** Operator's confirmation dialog says "will archive 3 identities." Between click and supervisor tick, a 4th identity spawns holding the role. Cascade archives 4 identities, but operator only consented to 3.

**Why it happens:** D-04 computes the cascade preview frontend-side; D-07 says supervisor freshly enumerates at scan time. Legitimate design gap.

**How to avoid:** Design-level, not code-level: this is D-07 explicit and D-11 addresses the mirror case (an identity that spawns AFTER a partial-failure retry will get picked up on the next click). The failure mode is honest per shape's "philosophy" — the operator sees discrepancy in log lines. No mitigation needed; document behavior in the id-skill update.

**Warning signs:** Not really a warning sign to catch — this is design, not bug. Mention explicitly in the id-skill "Archiving a role" section.

### Pitfall 7: Nginx location `/roles(/.*)?$` chunk size cap

**What goes wrong:** `docker/nginx.conf:452` sets `client_max_body_size 11M` on the `/roles` regex block (widened for avatar POST in Phase 86). This is fine for archive POST which is a tiny JSON body — no issue.

**Why it MIGHT go wrong:** If the plan for some reason widens the archive POST to a multipart body (it should NOT — CONTEXT.md is clear this is JSON, single-field `{ hostId }`), the 11M cap is already generous. **No nginx change needed for this phase.** Skip the nginx-parity dance.

**Verified:** Both `docker/nginx.conf:452` and `docker/nginx-https.conf` have the `/roles(/.*)?$` block. The new endpoint slides in under the existing regex without any nginx edits.

### Pitfall 8: RolesListModal is `modal={false}` — context menu tap coexistence

**What goes wrong:** `RolesListModal` sets `modal={false}` on Radix's Dialog primitive (line 184). Then `PrettyConversationContextMenu` portal-mounts to `document.body` (line 380). These two portals coexist but Radix's non-modal Dialog may or may not intercept clicks depending on Radix version.

**Why it might go wrong:** Radix `Dialog.Content` with `onInteractOutside` (line 197 in RolesListModal.tsx currently `e.preventDefault()`) explicitly captures outside interaction. A tap on the context menu (which is outside the Dialog content) would fire `onInteractOutside` → preventDefault stops close → menu-item's own onClick still fires — likely fine. Worth a manual test.

**How to avoid:** Test manually during development. If Radix eats the context menu click, add an escape hatch via `e.stopPropagation()` in the menu-item onClick or via a small change to RolesListModal's `onInteractOutside` gate that ignores events originating from the context menu portal.

**Warning signs:** Right-click shows menu but click on menu item does nothing; the Dialog is intercepting.

### Pitfall 9: Docker/build parity — nginx configs are the CLAUDE.md caveat

**What might go wrong:** Fleet-wide learned rule (from STATE.md 2026-08-01, Phase 19 nginx caveat): `docker/nginx.conf` and `docker/nginx-https.conf` MUST stay in sync. Missing a location block in one silently 404s the frontend for HTTPS users.

**Why it doesn't matter here:** No new nginx locations needed — `/roles(/.*)?$` regex already covers `/roles/:name/archive`. But the plan MUST NOT introduce a NEW nginx location block without editing BOTH configs.

**Warning signs:** If a plan reviewer notices any docker/nginx.conf edit without a matching docker/nginx-https.conf edit — reject.

## Code Examples

### 1. Backend HTTP route (role-archive.ts) — direct clone of identity-archive.ts

```typescript
// Source: modeled verbatim on src/backend/database/routes/identity-archive.ts
// (Phase 115 Plan 115-03). Substitutions:
//   IDENTITY_KEY_RE → ROLE_NAME_PATTERN
//   writeIdentityFile → writeRoleFile (new module)
//   :key → :name

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../../utils/role-name-pattern.js";
import { writeRoleFile } from "../../claude-session/per-role-file.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();
const SSH_CONNECT_TIMEOUT_MS = 3000;

router.post("/:name/archive", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  // 1. Validate hostId (body)
  const rawHostId = (req.body as { hostId?: unknown } | undefined)?.hostId;
  if (rawHostId === undefined || rawHostId === null || rawHostId === "")
    return res.status(400).json({ error: "hostId is required" });
  const hostId = typeof rawHostId === "number" ? rawHostId : parseInt(String(rawHostId), 10);
  if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId))
    return res.status(400).json({ error: "hostId must be a positive integer" });

  // 2. Validate role name via ROLE_NAME_PATTERN
  const name = String(req.params.name ?? "");
  if (!name || !ROLE_NAME_PATTERN.test(name))
    return res.status(400).json({ error: "role name must match [a-z0-9-]+" });

  // 3. Ownership check
  const host = await resolveHostById(hostId, userId);
  if (!host) return res.status(404).json({ error: "Host not found" });

  // 4. LOCAL vs REMOTE
  let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
  if (!isLocalHostId(hostId)) {
    try { conn = await connectOneShot(host as any, SSH_CONNECT_TIMEOUT_MS); }
    catch { return res.status(504).json({ error: "Host unreachable" }); }
  }

  // 5. Drop sentinel
  try {
    await writeRoleFile(name, ".archive-requested", "", { hostId, conn });
    databaseLogger.info(`role archive requested: userId=${userId}, hostId=${hostId}, name=${name}`);
    return res.json({ ok: true });
  } catch (err) {
    databaseLogger.error(`failed to drop role .archive-requested for name=${name} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(500).json({ error: "failed to drop archive sentinel" });
  } finally {
    if (conn) { try { conn.end(); } catch { /* ignore */ } }
  }
});

export default router;
```

### 2. per-role-file.ts — mirrors per-identity-file.ts

```typescript
// Source: modeled on src/backend/claude-session/per-identity-file.ts.
// Whitelist starts with just {".archive-requested"} — same D-01 filename-lock
// discipline as its identity sibling, ready to grow if future phases need
// other role-folder writes.

import os from "os";
import path from "path";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";
import { writeMarkdownFileAtomic } from "./identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";

// Whitelist — start small, grow with future phases
export const ALLOWED_ROLE_REL_PATHS: ReadonlySet<string> = new Set([".archive-requested"]);

function localRoleTargetPath(name: string, relPath: string): string {
  // Mirror per-identity-file.ts's env-honoring pattern
  const root = process.env.ROLES_HOST_DIR
    ?? path.join(os.homedir(), "fleet", "roles");
  return path.join(root, name, relPath);
}

function remoteRoleTargetPath(name: string, relPath: string): string {
  // SFTP resolves relative paths against the SSH user's $HOME
  return `fleet/roles/${name}/${relPath}`;
}

function assertValidRoleName(name: string): void {
  if (!ROLE_NAME_PATTERN.test(name))
    throw new Error(`invalid role name — must match ${ROLE_NAME_PATTERN.source}`);
}

function assertValidRoleRelPath(relPath: string): void {
  if (!ALLOWED_ROLE_REL_PATHS.has(relPath))
    throw new Error(`invalid relPath — allowed: ${[...ALLOWED_ROLE_REL_PATHS].join(", ")}`);
}

export interface WriteRoleFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

export async function writeRoleFile(
  name: string,
  relPath: string,
  contents: string,
  opts: WriteRoleFileOpts,
): Promise<void> {
  assertValidRoleName(name);
  assertValidRoleRelPath(relPath);
  const { isLocalHostId } = await import("./identity-artifact-reader.js");
  if (isLocalHostId(opts.hostId)) {
    const finalPath = localRoleTargetPath(name, relPath);
    const tmp = finalPath + ".tmp";
    await fs.writeFile(tmp, contents, "utf-8");
    await fs.rename(tmp, finalPath);
    return;
  }
  if (opts.conn === null) throw new Error("conn required for remote host");
  await writeMarkdownFileAtomic(opts.conn, remoteRoleTargetPath(name, relPath), contents);
}
```

### 3. Frontend API wrapper — mirrors identity-archive-api.ts

```typescript
// Source: modeled on src/ui/api/identity-archive-api.ts
import { authApi, handleApiError } from "@/main-axios";

export async function archiveRole(
  hostId: number,
  roleName: string,
): Promise<{ ok: true }> {
  try {
    const url = `/roles/${encodeURIComponent(roleName)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive role");
  }
}
```

### 4. Supervisor scanner — sibling of scan_archive_requested_sentinels

```bash
# Source: modeled on scan_archive_requested_sentinels()
# (substrate/scripts/agent-supervisor.sh:951).
# Roles-dir is $HOME/fleet/roles by default; make it env-overridable for tests
# consistent with IDENTITIES_DIR + IDENTITIES_ARCHIVE_DIR pattern.
ROLES_DIR="${AGENT_ROLES_DIR:-$HOME/fleet/roles}"
ROLES_ARCHIVE_DIR="${AGENT_ROLES_ARCHIVE_DIR:-$HOME/fleet/roles-archive}"

# Pattern-match a role: frontmatter line inside the first `---`-fenced block.
# Handles unquoted (Skynet convention) and quoted variants (WARNs on quoted so
# we surface fleet-drift). Mirrors is_coordinator's awk-between-fences shape.
identity_has_role() {
  local identity_file="$1" want_role="$2"
  [ -f "$identity_file" ] || return 1
  awk -v w="$want_role" '
    /^---$/{f++}
    f==1 && ($0 == "role: " w || $0 == "role: \"" w "\"" || $0 == "role: '\''" w "'\''"){found=1; exit}
    END{exit !found}
  ' "$identity_file"
}

scan_role_archive_requested_sentinels() {
  local d name identity_dir identity_name role_dir_name failed=0 total=0 failed_names=""
  for d in "$ROLES_DIR"/*/; do
    [ -d "$d" ] || continue
    role_dir_name="$(basename "$d")"
    [ -f "$d/.archive-requested" ] || continue

    log "role '$role_dir_name' archive: .archive-requested detected — cascading"

    # D-07: fresh enumeration on every scan
    local to_retire=()
    for identity_dir in "$IDENTITIES_DIR"/*/; do
      [ -d "$identity_dir" ] || continue
      identity_name="$(basename "$identity_dir")"
      [ -f "$identity_dir/$identity_name.md" ] || continue
      if identity_has_role "$identity_dir/$identity_name.md" "$role_dir_name"; then
        to_retire+=("$identity_name")
      fi
    done

    log "role '$role_dir_name' cascade: ${#to_retire[@]} identities hold this role"

    # D-08: fail-soft. D-10: guards already bypassed since we don't check them.
    failed=0
    total=${#to_retire[@]}
    failed_names=""
    for identity_name in "${to_retire[@]}"; do
      if retire_identity "$identity_name"; then
        log "role '$role_dir_name' cascade: identity '$identity_name' retired cleanly"
      else
        failed=$((failed + 1))
        failed_names="$failed_names $identity_name"
        log "ERROR: role '$role_dir_name' cascade: identity '$identity_name' FAILED to retire"
      fi
    done

    # D-09: folder moves only if ALL identities retired cleanly
    if [ "$failed" -eq 0 ]; then
      mkdir -p "$ROLES_ARCHIVE_DIR" 2>/dev/null
      if mv "$d" "$ROLES_ARCHIVE_DIR/$role_dir_name" 2>/dev/null; then
        # Sentinel travelled with the folder — clean it up in the archive
        rm -f "$ROLES_ARCHIVE_DIR/$role_dir_name/.archive-requested" 2>/dev/null
        log "role '$role_dir_name' cascade complete: $total identities retired, folder moved to archive"
      else
        # Move failed with all identities retired — anomaly. Log LOUD.
        log "ERROR: role '$role_dir_name' cascade: all identities retired but folder move FAILED"
        rm -f "$d/.archive-requested" 2>/dev/null   # D-06 one-shot regardless
      fi
    else
      # D-09: partial failure — role folder stays live
      log "ERROR: role '$role_dir_name' cascade PARTIAL: $failed/$total identities failed:${failed_names}. Role folder retained in live tree. Retry via UI."
      rm -f "$d/.archive-requested" 2>/dev/null     # D-06 one-shot regardless
    fi
  done
}
```

### 5. Reconcile-loop wire-up (agent-supervisor.sh:2327 area)

```bash
# Insert after existing scan_archive_requested_sentinels line
scan_archive_requested_sentinels                 # Phase 115: user-initiated identity archive
scan_role_archive_requested_sentinels            # Phase 133 D-01: user-initiated role archive
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cross-tick failure counter files (`retire-fail-count-<name>`) + retire-stuck sentinel drops after 3 consecutive fails | Inline per-step exponential-backoff retries (3× 2s/4s/8s), atomic `retire_identity()` from caller's POV | Phase 133 D-13/D-14 (THIS phase) | `retire_identity()` becomes single-tick — succeeds outright or fails terminally. Callers no longer track failure counts. Operator sees single log line per attempt, not a slow accumulation across ticks. |
| Identity archive was the sole "operator-triggered folder move" gesture | Role archive joins as sibling gesture with cascade | Phase 133 D-01 (THIS phase) | New surface area — one more sentinel type, one more supervisor scanner. Shape is identical, cost is small. |

**Deprecated/outdated after this phase:**
- Any doc referencing `retire-stuck` semantics: `substrate/skills/id/SKILL.md` L790-834 currently describes the retire flow without mentioning retire-stuck (good — already caller-agnostic). No doc drift to fix.
- Test file `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — retire-stuck test blocks at lines 660-720, 993-1017, and 861-863 become dead code and must be deleted or rewritten to assert the new inline-retry semantic (see Pitfall 3).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PrettyConversationContextMenu` will work on `RolesListModal` rows without adapter code (Radix non-modal Dialog + portal-mounted context menu coexist without click interference) | Pattern 1, Pitfall 8 | Menu shows but click does nothing. Mitigation: manual test during dev; add `e.stopPropagation()` if needed. **Recommendation for planner: budget a 30-min UAT wave-early to spike this integration.** |
| A2 | `role:` frontmatter is universally unquoted in the Skynet fleet | Pitfall 2 | Cascade misses identities with quoted `role:` values. Mitigation: the recommended awk pattern accepts unquoted + single-quoted + double-quoted and logs WARN on quoted variants. |
| A3 | Existing `writeMarkdownFileAtomic` in `identity-artifact-reader.ts` works against role-folder paths (SFTP has no per-directory permission oddities on `~/fleet/roles/`) | Code Example 2 | REMOTE role-folder write fails with permission error. Mitigation: `~/fleet/roles/` is created 755 by `roles-create.ts` mkdir; user owns it; SFTP write should succeed. |
| A4 | No existing supervisor code path outside `run_archive_scan` and `scan_archive_requested_sentinels` reads/writes `retire-fail-count-*` files or `retire-stuck` sentinels | Runtime State Inventory | Silent behavior change if some other scanner references them. Mitigation: verified via `grep -rn "retire-fail-count\|retire-stuck" substrate/` — only the two named callers (plus their tests) reference them. Confidence: HIGH. |
| A5 | Exponential-backoff waits of 2s/4s/8s are reasonable for transient Matrix/network hiccups (not too short → false failures, not too long → operator loses patience) | Pitfall 4 | Retries fail too aggressively (transient blip lasts 15s) or too slowly (operator waits 90s+ per identity). Mitigation: values match D-13 lock verbatim; planner may propose adjustment only via a CONTEXT.md amendment. |
| A6 | The `RolesListModal.tsx` row `<button>` element (line 337-441) can trivially accept an `onContextMenu` handler alongside its existing `onClick`, without disrupting the click-to-open-role behavior | Recommended Project Structure | Right-click also fires row-click and opens `RoleModal` alongside the context menu. Mitigation: standard `e.preventDefault()` in `onContextMenu`. Straightforward. |
| A7 | The frontend confirmation dialog computed at click time will typically match what the supervisor sees at tick time (D-04 vs D-07 divergence is rare) | Pitfall 6 | Operator sees "3 identities" but 4 get archived (or 2). Mitigation: design-level accepted per shape; document in id-skill update. |
| A8 | The plan can drop the retire-stuck test blocks from `agent-supervisor-archive-scan.sh` in the same wave that removes the mechanism, without breaking unrelated tests in the same file | Pitfall 3 | Test file has cross-dependencies between blocks. Mitigation: the test file structure is one-test-per-`run_test` invocation; blocks are independent. Verified by scanning the file structure at line 660+. |

**Confirmation needed from user before implementation:**
- A1 (context menu on Radix non-modal Dialog) is the only assumption worth surfacing before code lands; the rest are either code-verified or design-locked.

## Open Questions

1. **Wave ordering: retire-refactor first, or role-cascade first?**
   - What we know: D-15 says both callers benefit uniformly. D-13/D-14 refactor is independent of role-archive but must land before the role cascade caller depends on it.
   - What's unclear: whether the plan structures the refactor as a standalone wave (recommended) or interleaves it with the role-cascade wave.
   - Recommendation: **standalone wave B (refactor) between wave A (backend) and wave C (supervisor scanner)**. This lets wave B's tests land first without needing the new scanner in place, and wave C's tests can then assume the clean retire semantic. See Summary §Primary recommendation.

2. **Per-step retry mapping — 3× on all 4 steps, or subset?**
   - What we know: D-13 says "each step retries itself independently" — implies all 4. But Pitfall 4 (total elapsed time balloon) is real.
   - What's unclear: whether the D-13 intent was "retry EVERY step 3×" (strict) or "retry the steps that can benefit 3×" (pragmatic).
   - Recommendation: planner surfaces this in the plan-check and asks the user. My read of the shape is pragmatic — the language "protected by a bounded retry" is about the pattern, not the count-of-affected-steps. Recommended subset: steps 1 (matrix deactivate — network flake) + 4b (folder move — fs race). Steps 2 (graceful exit — best-effort) + 3 (tmux kill — no-op on absent) already handle their own transience.

3. **Empty-cascade dialog copy: keep the second confirm, or skip to sanity-tap alone?**
   - What we know: D-03 says first dialog when N=0 reads "archive role X? no identities hold it." followed by the plain second sanity tap.
   - What's unclear: whether the double confirm is proportional when nothing cascades. Might feel excessive.
   - Recommendation: keep D-03 as locked — consistency across all invocations matters more than the tiny UX friction on the empty-cascade path.

4. **Menu label: "Archive" or "Archive role"?**
   - What we know: CONTEXT.md specifics call it a "planner's call" and the identity archive uses plain "Archive" (`IdentitySessionPane.tsx:219`).
   - What's unclear: contextual clarity. In `RolesListModal` the row IS obviously a role, so "Archive" reads fine. But if a user right-clicks and sees a bare "Archive" it takes an extra half-second of orientation.
   - Recommendation: `Archive` — matches identity affordance, and the confirmation dialog text says "archive role X? ..." so ambiguity resolves within one click.

5. **Do we need a helper `retry_with_backoff()` bash function, or inline retry loops?**
   - What we know: D-13 says "planner's call" (Claude's Discretion).
   - Recommendation: inline. See Pattern 2 rationale.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash 4+ | supervisor script | ✓ (must be on every fleet box already, supervisor requires it) | 4+ | — |
| awk | frontmatter parse in scanner | ✓ (POSIX; on every box) | any | — |
| jq | matrix deactivate credential parse (unchanged) | ✓ (mandatory per supervisor `agent-supervisor-archive-scan.sh:51`) | any | — |
| shellcheck | test suite static analysis | ✓ (mandatory per test harness `agent-supervisor-archive-scan.sh:51`) | any | — |
| Node.js + vitest | backend + frontend tests | ✓ (already installed for existing tests) | as in package.json | — |
| ssh2 lib | REMOTE SFTP write | ✓ (already installed) | as in package.json | — |
| Radix UI / lucide-react | UI | ✓ (already installed) | as in package.json | — |
| systemd `--user` | supervisor service on fleet boxes | ✓ (fleet-wide convention) | — | — |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** none

## Validation Architecture

*Skipped per `.planning/config.json` `workflow.nyquist_validation: false`.*

## Security Domain

*`security_enforcement` is set to `true` and `security_asvs_level` is `1` in `.planning/config.json`, so this section is required.*

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `AuthManager.getInstance().createAuthMiddleware()` — JWT validation on every request, identical to `identity-archive.ts:57` |
| V3 Session Management | no | Backend is stateless per-request; session lives in the JWT itself |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` returns null for cross-user or unknown hosts → route returns 404 (not 403 — no probe info leak, per T-115-03-01) |
| V5 Input Validation | yes | `ROLE_NAME_PATTERN.test(name)` gate at route entry (prevents shell injection + path traversal); hostId validation via `Number.isInteger` + positive check; body-shape checks; SFTP writes use SFTP primitives, never shell interpolation |
| V6 Cryptography | no | No new secret handling; no new crypto surface |

### Known Threat Patterns for {express + bash supervisor + SFTP}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via role name (`../../etc/passwd`) | Tampering | `ROLE_NAME_PATTERN /^[a-z0-9-]+$/` at HTTP handler entry — same discipline as identity-archive's `IDENTITY_KEY_RE`. Backing store is `~/fleet/roles/<name>/`; the regex prevents `/` or `.` in the segment |
| Shell injection via role name in supervisor scanner | Tampering | Awk pattern uses `-v` variable passing, not string interpolation; `mv` uses bash-double-quoted `"$d"` and `"$ROLES_ARCHIVE_DIR/$role_dir_name"` (safe because `$role_dir_name` came from `basename` on a real dir entry, already sanitized) |
| Cross-user role archive (operator A archives operator B's role on a shared server) | EoP | `resolveHostById(hostId, userId)` returning null → 404. Same shape as identity-archive T-115-03-01 |
| Info disclosure via 500 body (SFTP error message leaking paths / usernames) | Info Disclosure | Generic `{ error: "failed to drop archive sentinel" }` on 500; underlying error logged server-side only (databaseLogger.error) — mirrors identity-archive T-115-03-03 |
| Repudiation — no audit trail of who archived what | Repudiation | `databaseLogger.info('role archive requested: userId=..., hostId=..., name=...')` on success — mirrors identity-archive T-115-03-05 |
| DoS via unbounded sentinel-drop calls | DoS | Single-file sentinel write is cheap; SFTP tmp+rename bounded; existing rate limits on Skynet's Express layer apply |
| Cascade retire triggers third-party (Matrix) request storm | DoS | Cascade is sequential per identity; matrix deactivate has 30s curl timeout per attempt (see agent-supervisor.sh:676); worst case per identity is bounded by retire time, not attack surface |
| Malicious role name causes cascade to enumerate ALL identities | Tampering | Awk exact-match on `role: <name>` inside frontmatter fences — no wildcard/regex from client input |
| Silent no-op on wrong Content-Type | Info Disclosure / Tampering | JSON body via `bodyParser.json()`; NOT multipart — no Content-Type gate needed; mismatched types produce parse error → 400 |

### Threat model summary

Direct clone of identity-archive.ts's threat register (T-115-03-01 through T-115-03-03 + T-115-03-05). No new attack surface; the role-archive endpoint is strictly an operator-authenticated per-role sentinel writer that reuses every access control primitive the identity-archive endpoint has been running in production since Phase 115.

The **new** attack surface (supervisor cascade) is bounded on the box holding the role: sentinel presence triggers enumeration, which reads local files only. No inbound network calls except the existing per-identity matrix-deactivate curl (already threat-modeled in Phase 94/115).

## Sources

### Primary (HIGH confidence — direct code inspection at HEAD on branch `feat/tab-title-from-tmux`)

- `src/backend/database/routes/identity-archive.ts` (176 lines) — full read
- `src/backend/database/routes/identity-archive.test.ts` — first 60 lines read, structure understood
- `src/backend/claude-session/per-identity-file.ts` (399 lines) — full read
- `src/backend/database/routes/roles-create.ts` — first 100 lines read, `ROLE_NAME_PATTERN` import verified
- `src/backend/database/routes/roles-list-for-host.ts` — grep confirmed `ROLE_NAME_PATTERN` usage and `/^[a-z0-9-]+$/` shape
- `src/backend/database/database.ts` — mount-order verified at lines 2020-2061
- `src/ui/api/identities-api.ts` — Identity interface (task, role, hostId fields) verified at lines 1-80
- `src/ui/api/identity-archive-api.ts` (32 lines) — full read
- `src/ui/state/identities-store.ts` — `useIdentities()` shape verified at lines 794-820
- `src/ui/features/pretty-view/RolesListModal.tsx` (454 lines) — full read
- `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` (382 lines) — full read
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — `handleArchive` verified at lines 1443-1504
- `src/ui/shell/IdentitySessionPane.tsx` — archive menu item verified at lines 192-242
- `substrate/scripts/agent-supervisor.sh` (2526 lines) — full read of lines 30-140 (constants), 300-350 (resolve_identities + is_coordinator), 580-1000 (retire_identity + both scanners), 2320-2360 (reconcile dispatch)
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — first 120 lines read; grep confirmed retire-stuck test blocks at lines 660-720, 993-1017
- `substrate/skills/id/SKILL.md` — "On archiving an identity" section verified at lines 790-834
- `docker/nginx.conf` — `/roles(/.*)?$` block verified at line 452
- `.planning/config.json` — full read (security_enforcement: true, nyquist_validation: false)
- `.planning/REQUIREMENTS.md` — read start (Phase 133 does NOT map to any REQ-XX ID)
- `.planning/STATE.md` — Phase 133 entry at line 703 read
- Grep verification `retire-fail-count|retire-stuck` across `substrate/` — only 2 code files reference them: `agent-supervisor.sh` (the mechanism itself) and `tests/agent-supervisor-archive-scan.sh` (its tests). Confirmed A4 assumption.
- Grep verification `retry|backoff` in `substrate/scripts/*.sh` — no reusable bash retry helper exists; confirmed Pattern 2 as new.

### Secondary (none — all findings are code-verified)

*(No WebSearch or Context7 queries were needed for this phase — every technical claim is grounded in code already in the workspace. This is a phase-of-clones, not a phase-of-invention.)*

### Tertiary (none)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already installed and used by an analogous sibling
- Architecture: HIGH — direct clone of Phase 115 identity-archive shape; no new invention except bash inline-retry pattern (which is trivial)
- Pitfalls: HIGH — 9 pitfalls surfaced, all rooted in code inspection of the existing mechanism being cloned or refactored
- Assumptions: 8 catalogued; A1 (context menu × Radix Dialog coexistence) is the only one worth manual UAT before landing code

**Research date:** 2026-09-24

**Valid until:** 2026-10-24 (30 days — this is stable-domain research; nothing here depends on external ecosystem versions or moving-target APIs). If the retire flow changes in a way that removes or renames `retire_identity()`, this research needs a re-verify pass.
