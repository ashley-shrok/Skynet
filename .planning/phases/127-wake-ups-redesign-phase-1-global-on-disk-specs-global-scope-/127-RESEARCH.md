# Phase 127: Wake-ups Redesign Phase 1 — Global On-Disk Specs + Global-Scope Scheduler — Research

**Researched:** 2026-09-21
**Domain:** Fleet substrate scripts (Python/Bash) + Skynet backend TypeScript (spawn-requests pipeline)
**Confidence:** HIGH — every claim in this document is verified directly from source files in this session.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**On-disk spec layout**
- D-01: Global wake-up specs live at `~/fleet/wakeups/<slug>/wakeup.json` on each host — slug-folder with fixed sentinel filename, mirroring the newer fleet convention (bounties use `<slug>/bounty.json`, runbooks use `<slug>/runbook.md`, skills use `<slug>/SKILL.md`).
- D-02: Folder-per-slug shape lets companions drop naturally in the same folder — migration provenance for specs converted from per-role wake-ups, ad-hoc scratch files, or a small last-fired log. Companions not in scope but the folder shape enables them.
- D-03: Slug is kebab-case, same rules as bounty/runbook/skill slugs.

**Spec field shape**
- D-04: Extend with three fields: `name` (short label), `roles: [...]` (one or more role names the newborn takes on), `skills: [...]` (optional list of skill names).
- D-05: All fields today's scheduler already supports stay verbatim: `enabled`, `schedule` (with `interval`/`daily`/`weekly`/`one_shot` kinds, `timezone` optional, `days` optional), `instruction` (renamed to `prompt` in the new shape).
- D-06: `prompt` is a plain string; long prompts use the existing `<state_dir>/<slug>.wake` pattern.

**Scheduler at global scope**
- D-07: Add a mode flag to `substrate/scripts/wakeup-scheduler.py` distinguishing per-identity mode (existing behavior — print `⏰ [scheduled: ...]` to stdout) from global mode (new behavior — drop a create-identity request file at fire time).
- D-08: In global mode, the scheduler reads specs from `~/fleet/wakeups/<slug>/wakeup.json` (folder-per-slug), NOT the flat `<folder>/wakeups/*.json` shape.
- D-09: Agent-supervisor spawns the global-scope scheduler once per host at supervisor startup, session-independent.
- D-10: State dir for the global scheduler: `~/fleet/wakeups/.state/`.

**Fire path → identity birth**
- D-11: On fire, the global-scope scheduler drops a create-identity request file at `~/fleet/spawn-requests/<uuid>.json` — the path Skynet's existing coordinator-birthing pipeline already watches.
- D-12: Extend the request file's shape: `role:` becomes `roles: [...]`, add `skills: [...]`, add `prompt` field. `task` field stays (for backwards compat with coord-drops; wake-up fires may set it to `null`).
- D-13: Phase 1 defines the request-file extension. Whether multi-role track has already locked any of these fields is a judgment call at plan time (see findings below — it has not landed yet).

**Per-role sunset**
- D-14: Hand-migration during phase 1. Fleet-wide count likely 0–5. Zero on this host.
- D-15: If fleet-wide count > ~10, swap to automation script at execution time.
- D-16: After migration, remove: (a) per-role scheduler-spawn in `ambient-monitor.py` (IS_COORDINATOR branch), (b) coordinator Type C wake-up dispatch in `coordinator-instructions.md`, (c) any config or docs referencing the per-role wake-up path.

**Rollout & backwards-compat**
- D-17: Hard cutover — no backwards-compat window.
- D-18: Deploy via standard fleet-substrate distributor. Scheduler + agent-supervisor changes land in `substrate/scripts/`; distributor pushes to every managed host on its next sweep.

### Claude's Discretion
- Which side of the multi-role/wake-up boundary implements the request-file extension (see D-13). Judgment call at plan time.
- Exact JSON field ordering, key naming conventions, and any minor spec-shape polish beyond the extensions named above.
- Migration escalation threshold (see D-15). Judgment call at execution time.
- Any tests / logging conventions the fleet-substrate scripts already use — mirror them, don't invent new ones.

### Deferred Ideas (OUT OF SCOPE)
- Skynet backend CRUD API for global wake-up specs → phase 2.
- Skynet UI modal (list view + create/edit form + header button) → phase 3.
- A dual-mode compat period where per-role and global wake-ups both fire.
- An automated migration script (deferred unless count balloons per D-15).
- A wake-up-provided continuity affordance across recurring fires.
- Cross-host wake-ups.
- Wake-up templates / duplicate-and-edit.
- A history-of-past-fires view.
</user_constraints>

---

## Summary

Phase 127 is a purely mechanical extension + cleanup job. The hard-won scheduler infrastructure already exists and is dir-agnostic by design — the entire change is: add a `--mode global` flag that changes (a) where it reads specs from and (b) what it does when a spec fires. The fire path drops a JSON file into a directory the scan-orchestrator already polls every 10 seconds.

The second half of the work is a removal job: `ambient-monitor.py` contains exactly one `IS_COORDINATOR` branch (lines 326–355) that spawns a `wakeup-scheduler-role` child; it must be deleted. The coordinator-instructions.md Type C section is fleet-side only (retired from catalog on 2026-09-20) and must be edited directly on managed hosts. The Skynet spawn-requests pipeline needs its schema extended (`role → roles[]`, add `skills[]`, add `prompt`); this is a self-contained change in three files (`types.ts`, `parse-request-body.ts`, `worker.ts` or `PendingBirth` constructor).

No migration specimens exist on this host — the `box-maintainer` role's `~/fleet/roles/box-maintainer/wakeups/` folder is empty of `.json` files (only `.state/` is present). Migration steps will be a sweep + write, not a transform.

**Primary recommendation:** Plan in three logical waves: (1) wakeup-scheduler.py global-mode extension, (2) agent-supervisor spawn + spawn-requests schema extension, (3) per-role sunset + coordinator-instructions.md cleanup.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Global spec on-disk layout (`~/fleet/wakeups/<slug>/wakeup.json`) | Fleet substrate (per-host filesystem) | — | Spec files live on the managed host; Skynet reads them in phase 2 via SSH |
| Spec polling + due-time detection | Fleet substrate script (`wakeup-scheduler.py`) | — | Long-lived Python process per host; all schedule math is there |
| Global scheduler lifecycle (spawn/restart) | Fleet substrate script (`agent-supervisor.sh`) | — | Already owns spawning ambient-monitor children; global spawn follows the same pattern |
| Fire path (request-file drop) | Fleet substrate script (`wakeup-scheduler.py` global mode) | — | Script writes `~/fleet/spawn-requests/<uuid>.json` directly at fire time |
| Request-file consumption + birth dispatch | Skynet backend (`scan-orchestrator.ts` + `worker.ts`) | — | Always-on 10s poller; birthIdentity invoked from worker |
| Request-file schema validation | Skynet backend (`parse-request-body.ts`) | — | Single pure-validation function; extension goes here and in `types.ts` |
| Per-role scheduler spawn (TO REMOVE) | Fleet substrate script (`ambient-monitor.py` IS_COORDINATOR branch) | — | Exactly lines 326–355 in ambient-monitor.py |
| Type C coordinator dispatch (TO REMOVE) | Coordinator instructions doc (fleet-side only) | — | coordinator-instructions.md, no longer in distributor catalog |

---

## Planning-Critical Findings

### 1. Existing Scheduler: Spec Discovery, Fire Format, State Layout, Lifecycle

**Spec discovery (current per-identity mode):**
- `wdir = os.path.join(ident_dir, "wakeups")` — resolves to `<identity_dir>/wakeups/`
- `glob.glob(os.path.join(wdir, "*.json"))` — flat glob, picks up every `.json` directly in `wakeups/`
- State dir: `os.path.join(wdir, ".state")` — i.e., `<identity_dir>/wakeups/.state/`
- Spec must have both `"instruction"` AND `"schedule"` fields to be loaded (`_load_specs`, lines 176–189)
- Key: `spec.get("name") or os.path.splitext(os.path.basename(p))[0]` — name field wins, falls back to filename stem

**Fire output (current):**
```
⏰ [scheduled: <key> @ <UTC-ISO-Z>] <instruction>              # short (≤300 chars)
⏰ [scheduled: <key> @ <UTC-ISO-Z>] [long instruction, N chars — full text at <state_dir>/<key>.wake — Read it]  # long
```
Printed via `print(..., flush=True)`. The harness picks this up as an async wake.

**State-dir files:**
- `scheduler.pid` — newest-wins guard; PID of current process
- `<key>.last` — epoch float of last-fired time (first-sight anchor; anchored to now on first sight without firing)
- `<key>.wake` — full long prompt text (if instruction > LONG_INSTRUCTION_CHARS=300)
- `<key>.fired` — one-shot double-fire sentinel (written BEFORE spec auto-delete)

**Lifecycle:**
- Orphan-monitor guard (lines 246–275): reads `AMBIENT_MONITOR_HARNESS_PID` env OR walks grandparent PID; exits when harness PID disappears
- Single-instance guard (`_single_instance`): checks `/proc/<old_pid>/cmdline` for both "wakeup-scheduler" AND `ident_dir` in command; kills old instance if found; writes new PID to `scheduler.pid`

**What changes in global mode (D-07, D-08, D-10):**

| Aspect | Per-identity mode (current) | Global mode (new) |
|--------|----------------------------|-------------------|
| Spec discovery | `glob(<ident_dir>/wakeups/*.json)` | `glob(~/fleet/wakeups/*/wakeup.json)` — folder-per-slug |
| Field name | `"instruction"` | `"prompt"` (D-05) |
| Additional fields | — | `"roles"`, `"skills"` |
| State dir | `<ident_dir>/wakeups/.state/` | `~/fleet/wakeups/.state/` (D-10) |
| Fire action | Print `⏰ [scheduled: ...]` to stdout | Drop `~/fleet/spawn-requests/<uuid>.json` |
| Orphan-monitor guard | Active (harness PID watched) | **DISABLED** — no harness; must skip entirely in global mode |
| Key derivation | `spec.get("name") or filename_stem` | `spec.get("name") or slug` (slug = containing folder name) |
| One-shot self-delete | `os.unlink(<ident_dir>/wakeups/<slug>.json)` — flat path | `os.unlink(~/fleet/wakeups/<slug>/wakeup.json)` — nested path |

**Mode flag implementation:** Add CLI argument e.g. `--mode global` (or `--global`). The `main()` function already takes `sys.argv[1]` as `ident_dir`; add `sys.argv[2]` check or `argparse`. In global mode, `ident_dir` argument is not the identity directory — it's `~/fleet/wakeups/` (the global wakeups root). Or: pass `~/fleet/wakeups` as the positional arg and let mode flag change how the script interprets it.

**_single_instance uniqueness:** Current check uses `ident_dir in cmd` to distinguish instances for different identities. For the global instance, the `ident_dir`-equivalent is `~/fleet/wakeups` — already unique since no identity will be named `wakeups` at the fleet level. The existing check works correctly as long as the global scheduler is started with the fleet wakeups root path as its argument.

---

### 2. Agent-Supervisor Spawn Pattern

**Current per-identity spawning (NOT in agent-supervisor — in ambient-monitor):**
The per-identity wakeup-scheduler is spawned by `ambient-monitor.py`, not by `agent-supervisor.sh` directly. Confirmed at lines 313–318 of `ambient-monitor.py`:
```python
CHILDREN.append({
    "name": "wakeup-scheduler",
    "cmd": ["python3", str(HOME / ".local/bin/wakeup-scheduler"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```

**The global scheduler spawn goes in `agent-supervisor.sh` main section (D-09):**
The main entry point (lines 2371–2388) currently:
```bash
[ "${AGENT_SUPERVISOR_LIB_ONLY:-0}" = 1 ] && return 0 2>/dev/null || true

# ---- main ----
ensure_agent_teams_env
ensure_inotifywait
resolve_memory_wrapper
case "${1:-}" in
  --once) VERBOSE=1 reconcile ;;
  *)
    log "agent-supervisor up: interval=${CHECK_INTERVAL}s, claude=$CLAUDE"
    for d in "$IDENTITIES_DIR"/*/; do rm -f "$d/.resume-complete" 2>/dev/null; done
    while :; do reconcile; sleep "${CHECK_INTERVAL:-30}"; done
    ;;
esac
```
The new global scheduler spawn inserts after `resolve_memory_wrapper` and before the `case` block — alongside the other startup steps, run once at supervisor startup.

**Spawn pattern to follow:** `start_ambient_monitor()` at lines 1245–1265 shows the pattern:
```bash
setsid nohup "$AMBIENT_MONITOR" "$IDENTITIES_DIR/$name" \
    --inject-to "$sess" --harness-pid "$hpid" \
    > "$logf" 2>&1 < /dev/null & disown
```
For the global scheduler: no `--inject-to` or `--harness-pid` needed (no harness). Pattern becomes:
```bash
setsid nohup python3 "$WAKEUP_SCHEDULER" "$FLEET_DIR/wakeups" --mode global \
    > "$FLEET_DIR/wakeups/global-scheduler.log" 2>&1 < /dev/null & disown
```

**PID tracking for the global instance:**
The existing `_single_instance()` in `wakeup-scheduler.py` writes to `<state_dir>/scheduler.pid` where `state_dir = <wdir>/.state`. For global mode `wdir = ~/fleet/wakeups`, so `state_dir = ~/fleet/wakeups/.state/` and PID file = `~/fleet/wakeups/.state/scheduler.pid`. This is D-10 compliant and the existing uniqueness check works (cmdline will contain the fleet wakeups path).

**agent-supervisor.sh variable context:**
- `IDENTITIES_DIR` is established early in supervisor init
- `HOME` is the user home
- `FLEET_DIR` or similar may not exist yet — the spawn line should use `"$HOME/fleet"` or a new local variable `GLOBAL_WAKEUPS_DIR="$HOME/fleet/wakeups"` established at the top of the main block

**`restartHook` behavior:** `agent-supervisor` has `restartHook: "agent-supervisor.service"` in `catalog.ts`. Any byte change to `agent-supervisor.sh` triggers `systemctl --user restart agent-supervisor.service` on the managed host — so the global scheduler will be re-spawned automatically when the new agent-supervisor lands.

**`wakeup-scheduler` restartHook:** Currently `null`. The scheduler is spawned as a child process; new bytes land on the next time it's spawned. Since agent-supervisor restarts and re-spawns the global scheduler at startup, and ambient-monitor restarts spawn new per-identity schedulers, no restart hook is needed for `wakeup-scheduler` — unchanged.

---

### 3. Spawn-Requests Pipeline: Exact Schema, Path, Consumption Trigger, Extension Points

**Drop path (where the global scheduler writes the fire request):**
`~/fleet/spawn-requests/<uuid>.json`

UUID must be exactly 36 characters (checked by `SPAWN_REQUESTS_SCAN_CMD` bash filter: `[ ${#base} -eq 36 ] || continue`). The Python `uuid` stdlib module generates standard 36-char UUIDs.

**Scan cadence:** The `scan-orchestrator.ts` polls every 10 seconds. Always-on (not gated on browser subscribers — decoupled from fleet-status orchestrator after that bug).

**Atomic claim mechanism:** The scan command does `mv "$f" "$tmp" 2>/dev/null || continue` — atomic rename claims the file. Only successfully claimed files are parsed and enqueued.

**Current request body schema** (`src/backend/spawn-requests/types.ts`):
```typescript
export interface SpawnRequestBody {
  role: string;        // single role — BEING REPLACED with roles[]
  task: string | null;
  requested_at: string; // ISO-Z timestamp
}
```

**Validation strictness** (`parse-request-body.ts`): `parseRequestBody` validates exactly `role`, `task`, `requested_at`. The docstring explicitly says "Extra fields (coord_mxid, target-host, priority, retry_count, ordinal) are rejected as malformed (D-05)." — this means adding `roles`, `skills`, `prompt` fields to a request body will cause `malformed` failures under the CURRENT validation code. **The schema extension in `types.ts` and `parse-request-body.ts` is REQUIRED before the global scheduler can drop its extended request files.**

**What needs changing in the spawn-requests pipeline (D-12):**

1. **`types.ts`:** Replace `role: string` with `roles: string[]`. Add `skills?: string[]`. Add `prompt: string`. Update `PendingBirth` to carry `roles: string[]` instead of `role: string`, and add `skills?: string[]` and `prompt: string`.

2. **`parse-request-body.ts`:** Update `parseRequestBody()` to:
   - Accept `roles` array (validate each element against `ROLE_NAME_PATTERN`)
   - Accept optional `skills` array (validate each is a non-empty string)
   - Accept `prompt` field (non-empty string, no length cap specified — D-06 says it's a plain string)
   - Remove validation of `role` (single string) — **OR** keep `role` as a backwards-compat optional field alongside `roles[]` if coordinator drops still use the old schema. Decision: D-12 says `role:` BECOMES `roles: [...]` — clean replacement; coordinator drops should also be updated.

3. **`worker.ts`:** Update `processBirth()` to pass `roles` to `BirthOptions`. Since `BirthOptions.role` is a single string today (see finding 4 below), the worker needs to either (a) use `roles[0]` for now and log a warning if `roles.length > 1`, or (b) wait for multi-role work to land. D-13 says phase 1 does NOT wait on multi-role — use `roles[0]` with a `// TODO: multi-role` comment is the pragmatic approach.

**`ROLE_NAME_PATTERN`:** Used by `parse-request-body.ts`; imported from `"../utils/role-name-pattern.js"`. Each element of `roles[]` must pass this pattern.

**Response files:** `~/fleet/spawn-requests/<uuid>.success.json` and `~/fleet/spawn-requests/<uuid>.failure.json` — unchanged, not relevant to phase 1 global scheduler (which doesn't consume responses).

---

### 4. Multi-Role Work State

**Current state: NOT LANDED.** [VERIFIED: direct source read]

`BirthOptions` in `src/backend/database/routes/identity-birth-orchestrator.ts`:
- `role: string` — single string, no `roles[]` field
- No `skills` field

`SpawnRequestBody` in `src/backend/spawn-requests/types.ts`:
- `role: string` — single string, no `roles[]` field
- No `skills` or `prompt` fields

`PendingBirth` in `src/backend/spawn-requests/types.ts`:
- `role: string` — single string

**Coordination strategy for D-13:** Phase 1 defines and implements the schema extension on the spawn-requests side. When multi-role work lands, it adopts `roles[]` from `SpawnRequestBody` / `BirthOptions` — it doesn't need to define it. The bridge at `worker.ts` uses `roles[0]` as a temporary single-role passthrough until `BirthOptions` is updated.

---

### 5. Per-Role Sunset: Exact Code to Remove

**a) Per-role scheduler spawn in `ambient-monitor.py` (lines 326–355):**
```python
if IS_COORDINATOR:
    role_folder = None
    if ROLE_NAME is not None:
        candidate = HOME / "fleet" / "roles" / ROLE_NAME
        if candidate.is_dir():
            role_folder = candidate
    if role_folder is not None:
        CHILDREN.append({
            "name": "wakeup-scheduler-role",
            "cmd": ["python3", str(HOME / ".local/bin/wakeup-scheduler"), str(role_folder)],
            "env_extra": {},
            "critical": False,
        })
    else:
        # Couldn't resolve or find the role folder — spawn file-watch so its
        # own SETUP FAILED wake surfaces the underlying misconfig loudly.
        CHILDREN.append({
            "name": "role-file-watch",
            ...
        })
else:
    CHILDREN.append({
        "name": "role-file-watch",
        ...
    })
```
**The else branch and the non-coordinator `role-file-watch` spawn MUST STAY.** Only the `if role_folder is not None: CHILDREN.append({"name": "wakeup-scheduler-role", ...})` block is removed. After removal, the IS_COORDINATOR branch becomes: resolve role_folder (it's still needed for other uses if any), but always fall into the `else` path for spawning `role-file-watch`. Actually: after removing the per-role scheduler spawn, the IS_COORDINATOR branch only controls whether `role-file-watch` is spawned — which happens in the `else` branch either way. The full simplification:

```python
# After removal — both coordinator and non-coordinator spawn role-file-watch
CHILDREN.append({
    "name": "role-file-watch",
    "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```
The IS_COORDINATOR detection and role_folder resolution blocks (lines 326–339) can be removed entirely since the only thing they gated was the per-role scheduler spawn and the role-file-watch-as-fallback.

**Caution:** Verify IS_COORDINATOR is not used anywhere else in `ambient-monitor.py` before removing its resolution block. If it is used elsewhere, keep the detection and only remove the `wakeup-scheduler-role` append.

**b) Coordinator-instructions.md — Type C section:**
File lives at `/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` (fleet-side, NOT in the distributor catalog — retired 2026-09-20 per catalog.ts comment at line 48–49). Changes needed:

- Remove entire "Type C: Scheduled wake-up (from your wake-up scheduler) → ROUTE-AND-DROP variant" section (approximately lines 117–138 in the file as read during research)
- Remove reference at line ~22: "AND an extra role-scoped wake-up scheduler (so role-general wakes fire on you)"
- Remove reference at lines ~496–499: the paragraph about "constructing a `python3 ~/.local/bin/wakeup-scheduler ~/fleet/roles/<role>` invocation"

Since coordinator-instructions.md is no longer catalog-distributed, updates must be made directly on the fleet-side copy. The distributor will NOT push this file. Direct edit via Skynet's SSH-based file writer or manual edit on managed hosts.

**c) Any other docs referencing per-role wake-up path:**
- `substrate/skills/id/SKILL.md` — check the "Scheduled wake-ups" section; it describes per-identity wake-ups at `~/fleet/identities/<name>/wakeups/<slug>.json`. This file IS in the catalog (slug: "id-skill"). Phase 1 should update it to document the new global convention at `~/fleet/wakeups/<slug>/wakeup.json`. The existing per-identity section stays (per-identity wake-ups continue unchanged); add a new "Global wake-ups" subsection.

---

### 6. Migration Protocol

**On this host (box-maintainer role):**
- `~/fleet/roles/box-maintainer/wakeups/` directory exists but contains ZERO `.json` spec files. Only `.state/` subdirectory present (holds `scheduler.pid` from the running per-role scheduler).
- D-14 confirmed: zero migration specimens on this host.

**Migration steps per host (for any found per-role specs elsewhere):**
1. `for spec in ~/fleet/roles/*/wakeups/*.json`: read `schedule`, `instruction`, `name` fields
2. Derive slug from spec filename stem (or generate a new kebab-case slug)
3. Create `~/fleet/wakeups/<slug>/wakeup.json` with: `enabled`, `schedule`, `prompt` (= old `instruction`), `name`, `roles: [<role-name>]`
4. Write `~/fleet/wakeups/<slug>/migrated-from.md` with original path + timestamp
5. Delete original `~/fleet/roles/<role>/wakeups/<slug>.json`

**D-15 threshold:** If fleet-wide sweep finds > ~10 specs, escalate to a small automation script. Otherwise hand-migrate per the steps above.

---

### 7. Substrate Distribution

**Files changed in phase 1 and their catalog entries:**

| File | Catalog slug | `restartHook` | Effect on deploy |
|------|-------------|---------------|-----------------|
| `substrate/scripts/wakeup-scheduler.py` | `wakeup-scheduler` | `null` | New bytes land on managed host; next global scheduler spawn picks them up (agent-supervisor restart also picks them up) |
| `substrate/scripts/agent-supervisor.sh` | `agent-supervisor` | `"agent-supervisor.service"` | Byte change → distributor fires `systemctl --user restart agent-supervisor.service` → supervisor restarts with global spawn logic |
| `substrate/scripts/ambient-monitor.py` | `ambient-monitor` | `null` | New bytes land; picked up on next ambient-monitor spawn (i.e., next harness launch for each identity) |
| `substrate/skills/id/SKILL.md` | `id-skill` | `null` | New bytes land; picked up on next `/id` load |

**No new catalog entries needed for phase 1.** All four files already have catalog rows.

**coordinator-instructions.md:** NOT in catalog (retired 2026-09-20). Must be edited directly on managed hosts via SSH (not via distributor sweep). Planner should include a task for direct-edit of fleet-side file.

**Distributor sweep cadence:** The distributor runs on the next container image build + sweep push. `agent-supervisor.sh` byte change triggers `agent-supervisor.service` restart. The global scheduler begins running immediately after that restart.

**Deploy sequencing notes (D-17 hard cutover):**
- Per-role scheduler (ambient-monitor.py change) is removed AND new agent-supervisor (global spawn) lands in the same distributor push.
- Between supervisor restart and the first identity recycle, per-identity schedulers continue running (unaffected — ambient-monitor.py is only reloaded on next identity harness start).
- The global scheduler starts immediately on supervisor restart.
- The per-role `~/fleet/roles/*/wakeups/` paths will no longer be polled once `ambient-monitor.py` picks up new bytes (next identity recycle).

---

## Standard Stack

No new packages. This phase modifies existing Python 2-stdlib-only scripts and TypeScript files. All dependencies are already installed.

**Python scheduler changes:** stdlib only — `glob`, `json`, `os`, `sys`, `time`, `datetime`, `uuid` (for generating request-file UUIDs), `pathlib.Path` (optional convenience).

**TypeScript spawn-requests changes:** No new imports beyond what `parse-request-body.ts` already imports (`ROLE_NAME_PATTERN` from `../utils/role-name-pattern.js`).

---

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages.

---

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Fleet Managed Host (per-host)           │
                    │                                                       │
  User writes ──→   │  ~/fleet/wakeups/<slug>/wakeup.json                  │
  spec files        │          │                                            │
                    │          ▼  poll every WAKEUP_POLL_SEC (30s)         │
                    │  wakeup-scheduler.py --mode global                   │
                    │  (spawned by agent-supervisor.sh at startup)         │
                    │          │                                            │
                    │   due?   ├─ NO  → continue polling                   │
                    │          │                                            │
                    │          ▼ YES                                        │
                    │  write ~/fleet/wakeups/.state/<slug>.fired            │
                    │  write ~/fleet/spawn-requests/<uuid>.json             │
                    │   {roles:[...], skills:[...], prompt:...,             │
                    │    task:null, requested_at:<ISO-Z>}                   │
                    │                                                       │
                    └───────────────────────────────┬─────────────────────┘
                                                    │
                                SSH scan (10s tick) │
                                                    ▼
                    ┌─────────────────────────────────────────────────────┐
                    │                  Skynet Backend                      │
                    │                                                       │
                    │  scan-orchestrator.ts ──→ atomic mv claim            │
                    │          │                                            │
                    │          ▼                                            │
                    │  parseRequestBody() (parse-request-body.ts)          │
                    │  validates roles[], skills?, prompt, requested_at    │
                    │          │                                            │
                    │          ▼                                            │
                    │  queue.enqueue(PendingBirth)                          │
                    │          │                                            │
                    │          ▼                                            │
                    │  worker.ts processBirth()                             │
                    │  └─ birthIdentity(BirthOptions{role:roles[0], ...})  │
                    │                                                       │
                    └─────────────────────────────────────────────────────┘
```

### Anti-Patterns to Avoid

- **Do NOT skip the orphan-monitor guard removal for global mode.** The guard at lines 270–275 calls `sys.exit(0)` when the harness PID disappears. In global mode there is no harness, so `harness_pid` will be `None`, and the guard is already skipped (the `if harness_pid is not None:` branch). But the initialization block (lines 247–267) still attempts grandparent PID walk if no env var is set. In global mode, the grandparent is `agent-supervisor.sh`'s bash process, not a Claude harness — this PID will eventually vanish (on supervisor restart) causing spurious exits. The safest fix: in global mode, set `harness_pid = None` unconditionally and print a note, skipping all harness-PID resolution.

- **Do NOT use `glob(<global_wakeups_dir>/*.json)` for global mode.** The spec layout is `<slug>/wakeup.json`, not flat `*.json`. Global-mode spec discovery must be `glob(<global_wakeups_dir>/*/wakeup.json)` (or `glob(<global_wakeups_dir>/*/*.json)` to be layout-forgiving).

- **Do NOT add `wakeup-scheduler` to the catalog's restartHook.** Adding a restart hook would kill live per-identity schedulers mid-session on every distributor push, orphaning their identities. The existing `null` restartHook is intentional and documented in catalog.ts lines 592–614.

- **Do NOT extend `PendingBirth.role` to an array without checking `worker.ts`.** `PendingBirth.role` flows directly into `BirthOptions.role: string` in `processBirth`. Change `PendingBirth.roles: string[]` and update the call site in worker to use `roles[0]` pending multi-role support.

- **Do NOT fork wakeup-scheduler.py into a new file.** D-07 explicitly locks reuse with a mode flag. Single file, two modes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schedule due-time math (interval, daily, weekly, one_shot) | Custom schedule evaluator | Existing `_due()` and `_parse_at_ts()` in wakeup-scheduler.py | Already handles DST, timezone, weekday gate, one-shot catch-up |
| Unique request-file ID | Custom ID generator | Python `uuid.uuid4()` → `str(uuid.uuid4())` | Produces 36-char UUID matching `UUID_RE` and the bash filter's `${#base} -eq 36` check |
| State-dir management | Custom state tracking | Existing pattern: `makedirs(state_dir, exist_ok=True)` + key-based `.last`/`.fired` files | First-sight anchor and one-shot sentinel semantics are already correct |
| Role name validation | Custom pattern | `ROLE_NAME_PATTERN` from `src/backend/utils/role-name-pattern.js` | Already used by `parse-request-body.ts`; import it |

---

## Common Pitfalls

### Pitfall 1: _single_instance collision between global and per-identity schedulers
**What goes wrong:** If a managed host's identity is literally named "wakeups", the global scheduler's `ident_dir in cmd` check in `_single_instance` would clash with a hypothetical identity scheduler for that identity.
**Why it happens:** The uniqueness key is the path argument passed to the script, and both use the same `scheduler.pid` filename (in different `.state/` dirs, but the kill check is cmdline-based).
**How to avoid:** This is not a real risk — no identity will be named "wakeups" — but document the assumption in a comment in the code.
**Warning signs:** N/A — theoretical only.

### Pitfall 2: Flat glob in global mode
**What goes wrong:** Using `glob(wdir + "/*.json")` in global mode would find nothing (specs are at `<slug>/wakeup.json`).
**Why it happens:** The mode-flag change must ALSO change the discovery glob, not just the fire action.
**How to avoid:** Separate `_load_specs_global(wdir)` function using `glob.glob(os.path.join(wdir, "*/wakeup.json"))` with slug derived from `os.path.basename(os.path.dirname(p))`.
**Warning signs:** Scheduler starts, runs forever, never fires anything, no errors.

### Pitfall 3: Extended request body rejected as malformed
**What goes wrong:** Global scheduler drops `{roles:[...], skills:[...], prompt:..., task:null, requested_at:...}` but `parseRequestBody` rejects it as malformed because it validates only `role`, `task`, `requested_at` and extra fields are rejected.
**Why it happens:** The schema extension must land in `types.ts` + `parse-request-body.ts` BEFORE the global scheduler can drop extended request files that are consumed correctly.
**How to avoid:** The TypeScript schema extension must be in the same deploy as the scheduler changes. Plan should put schema extension before or in the same wave as scheduler fire-path testing.
**Warning signs:** `~/fleet/spawn-requests/<uuid>.failure.json` with `{reason:"malformed"}` after global scheduler fires.

### Pitfall 4: coordinator-instructions.md not updated (not in catalog)
**What goes wrong:** The Type C dispatch section remains in coordinator-instructions.md on managed hosts. Coordinators will attempt to route to a per-role scheduler that no longer exists.
**Why it happens:** coordinator-instructions.md was retired from the catalog on 2026-09-20. Distributor won't push it. Manual edit required.
**How to avoid:** Plan must include a direct-edit task for fleet-side coordinator-instructions.md on each managed host (or a one-time sweep script). Verify with `grep -r "Type C\|wakeup-scheduler-role" ~/fleet/.claude/skills/id/` post-deploy.
**Warning signs:** Coordinator receives a per-role wake-up event (which can never fire again) and escalates confusion to user.

### Pitfall 5: IS_COORDINATOR branch removal breaks role-file-watch spawn
**What goes wrong:** After removing the per-role scheduler spawn from `ambient-monitor.py`, if the `else` branch is accidentally removed too, coordinator identities lose their role-file-watch child.
**Why it happens:** The IS_COORDINATOR branch controls BOTH the per-role scheduler spawn AND the role-file-watch fallback. Removing the wrong part.
**How to avoid:** After the change, both coordinator and non-coordinator identities should get `role-file-watch`. Test by checking that the IS_COORDINATOR path still results in a `role-file-watch` child being added.
**Warning signs:** Coordinator identity loses SKILL file watch; no SETUP FAILED alert surfaces if coordinator misconfigured.

### Pitfall 6: Global scheduler log file location
**What goes wrong:** No log file configured for the global scheduler; diagnostics disappear into the void or clutter agent-supervisor.sh's own log.
**Why it happens:** The per-identity scheduler's stdout goes to `ambient-monitor.log` via the ambient-monitor process. The global scheduler has no ambient-monitor parent.
**How to avoid:** Use `> "$HOME/fleet/wakeups/global-scheduler.log" 2>&1` in the `nohup` spawn line in agent-supervisor.sh. Mirror the pattern used by `start_ambient_monitor()`.
**Warning signs:** Silent misfires; no audit trail for global wake-up fires.

---

## Runtime State Inventory

> Per-role sunset is a renaming/migration phase component.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data (on-disk spec files) | `~/fleet/roles/box-maintainer/wakeups/` — zero `.json` files on this host; only `.state/scheduler.pid` | No migration needed on this host; sweep other managed hosts |
| Live service state (running scheduler) | `~/fleet/roles/box-maintainer/wakeups/.state/scheduler.pid` — per-role scheduler PID running on this host | Process will die when ambient-monitor.py is updated and identities recycle; no manual kill needed |
| OS-registered state | None — schedulers are child processes managed by ambient-monitor/agent-supervisor, not systemd units | None |
| Secrets/env vars | `AMBIENT_MONITOR_HARNESS_PID` env var used by per-identity schedulers — NOT used by global mode | None; global mode explicitly skips this env |
| Build artifacts | None — Python scripts; no compiled artifacts | None |

**Nothing found in category** "OS-registered state", "Secrets/env vars", "Build artifacts" — verified by source read and bash checks.

---

## Code Examples

Verified patterns from source files in this session:

### Global-mode spec discovery (new function to add)
```python
# Source: inferred from wakeup-scheduler.py _load_specs() pattern (lines 176-189)
# Global mode: specs at ~/fleet/wakeups/<slug>/wakeup.json
def _load_specs_global(wakeups_root):
    out = []
    for p in sorted(glob.glob(os.path.join(wakeups_root, "*/wakeup.json"))):
        try:
            spec = json.load(open(p))
        except Exception:
            continue
        if not spec.get("enabled", True):
            continue
        slug = os.path.basename(os.path.dirname(p))
        spec["_key"] = spec.get("name") or slug
        spec["_slug"] = slug
        spec["_path"] = p
        # Global mode uses "prompt" field (D-05); per-identity uses "instruction"
        if spec.get("prompt") and spec.get("schedule"):
            out.append(spec)
    return out
```

### Global-mode fire action (drop spawn request)
```python
# Source: types.ts SpawnRequestBody + ssh-poll-orchestrator.ts SPAWN_REQUESTS_SCAN_CMD
# Drops ~/fleet/spawn-requests/<uuid>.json with extended schema
import uuid as _uuid

def _drop_spawn_request(spec, state_dir):
    """Drop a create-identity request file for the spawn-requests pipeline."""
    req_id = str(_uuid.uuid4())
    req_dir = os.path.join(os.path.expanduser("~"), "fleet", "spawn-requests")
    os.makedirs(req_dir, exist_ok=True)
    body = {
        "roles": spec.get("roles", []),
        "skills": spec.get("skills", []),
        "prompt": spec.get("prompt", ""),
        "task": None,
        "requested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    req_path = os.path.join(req_dir, req_id + ".json")
    with open(req_path, "w") as f:
        json.dump(body, f)
    return req_id, req_path
```

### Extended SpawnRequestBody (types.ts)
```typescript
// Source: types.ts current schema (verified this session)
// Replace existing SpawnRequestBody with:
export interface SpawnRequestBody {
  roles: string[];       // one or more role names (replaces single role: string)
  skills?: string[];     // optional list of skill slugs the newborn has ready
  prompt: string;        // first user message to the newborn agent
  task: string | null;   // kept for coord-drops backwards compat; wake fires set null
  requested_at: string;  // ISO-Z timestamp for debug tracing
}
```

### Agent-supervisor global spawn (agent-supervisor.sh insertion point)
```bash
# Source: agent-supervisor.sh lines 2371-2388 (verified this session)
# Insert after resolve_memory_wrapper, before case block:
GLOBAL_WAKEUPS_DIR="$HOME/fleet/wakeups"
GLOBAL_WAKEUPS_LOG="$GLOBAL_WAKEUPS_DIR/global-scheduler.log"
mkdir -p "$GLOBAL_WAKEUPS_DIR/.state"
if [ -x "$HOME/.local/bin/wakeup-scheduler" ]; then
  setsid nohup python3 "$HOME/.local/bin/wakeup-scheduler" "$GLOBAL_WAKEUPS_DIR" --mode global \
    > "$GLOBAL_WAKEUPS_LOG" 2>&1 < /dev/null & disown
  log "global wake-up scheduler started (dir=$GLOBAL_WAKEUPS_DIR, log=$GLOBAL_WAKEUPS_LOG)"
else
  log "WARNING: global wake-up scheduler NOT started — $HOME/.local/bin/wakeup-scheduler missing"
fi
```

### per-role spawn removal (ambient-monitor.py before/after)
```python
# BEFORE (lines 326-362, ambient-monitor.py):
if IS_COORDINATOR:
    role_folder = None
    if ROLE_NAME is not None:
        candidate = HOME / "fleet" / "roles" / ROLE_NAME
        if candidate.is_dir():
            role_folder = candidate
    if role_folder is not None:
        CHILDREN.append({
            "name": "wakeup-scheduler-role",
            ...
        })
    else:
        CHILDREN.append({
            "name": "role-file-watch",
            ...
        })
else:
    CHILDREN.append({
        "name": "role-file-watch",
        ...
    })

# AFTER (simplified — verify IS_COORDINATOR not used elsewhere first):
CHILDREN.append({
    "name": "role-file-watch",
    "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 (`python3`) | wakeup-scheduler.py global mode | Pre-confirmed (existing script runs) | 3.x | — |
| `uuid` stdlib | New spawn-request UUID generation | Built-in stdlib | — | — |
| `~/fleet/spawn-requests/` dir | Global scheduler fire path | Already exists (spawn-requests pipeline uses it) | — | `mkdir -p` in scheduler |
| `~/fleet/wakeups/` dir | Global spec root | Does NOT yet exist on managed hosts | — | Create in agent-supervisor spawn block |

---

## Validation Architecture

Per `.planning/config.json` — if `nyquist_validation` is unset, treat as enabled. The spawn-requests pipeline has existing tests that will be affected by the schema extension.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TypeScript) |
| Config file | `vite.config.ts` or project root |
| Quick run command | `npx vitest run src/backend/spawn-requests/` |
| Full suite command | `npx vitest run` |

### Affected Existing Tests
| File | What changes | Why |
|------|-------------|-----|
| `src/backend/spawn-requests/worker.test.ts` | Tests that call `parseRequestBody` with `{role, task, requested_at}` will break | `role` is removed, `roles[]` is added |
| `src/backend/spawn-requests/scan-orchestrator.test.ts` | Tests that construct `PendingBirth` objects | `PendingBirth.role` becomes `PendingBirth.roles[]` |

### Phase 127 Test Requirements
| Behavior | Test Type | Notes |
|----------|-----------|-------|
| `parseRequestBody` accepts `{roles:[...], skills:[...], prompt:..., task:null, requested_at:...}` | Unit | Add to `worker.test.ts` or `parse-request-body.ts` test file |
| `parseRequestBody` rejects empty `roles: []` | Unit | Guard against empty array |
| `parseRequestBody` rejects `roles` with invalid role-name-pattern element | Unit | Per-element validation |
| Global-mode spec discovery reads `*/wakeup.json` not `*.json` | Unit | Python test if test harness exists; else integration |
| Orphan-monitor guard skipped in global mode | Unit | Python test |

---

## Security Domain

This phase has no authentication, session management, or cryptography changes. The spawn-requests file-drop mechanism is an existing trusted-filesystem pattern — the threat model is unchanged.

**ASVS V5 (Input Validation) note:** `parseRequestBody` validates `roles[]` elements against `ROLE_NAME_PATTERN` and `skills[]` elements as non-empty strings. Sufficient for the trusted-filesystem context (request files are written by local processes on managed hosts).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `IS_COORDINATOR` is not used anywhere else in `ambient-monitor.py` besides the per-role scheduler spawn block | Per-role sunset | If IS_COORDINATOR gates other behavior, removing its detection block breaks that behavior — verify with grep before removal |
| A2 | No managed hosts other than this one have per-role wakeup specs | Migration protocol | If other hosts have specs, they'll lose scheduled fires without migration — sweep all hosts before code push |
| A3 | `~/fleet/spawn-requests/` already exists on all managed hosts | Global scheduler fire path | If absent, scheduler's first fire will fail with `FileNotFoundError` — add `mkdir -p` as safeguard |

---

## Open Questions

1. **IS_COORDINATOR usage elsewhere in ambient-monitor.py**
   - What we know: The IS_COORDINATOR detection block (lines 326–355) is confirmed to control the per-role scheduler spawn
   - What's unclear: Whether IS_COORDINATOR is referenced in any other section of ambient-monitor.py (the file was only partially read)
   - Recommendation: Planner should grep `ambient-monitor.py` for `IS_COORDINATOR` before writing the removal task

2. **coordinator-instructions.md update delivery mechanism**
   - What we know: The file is fleet-side at `/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md`; it is NOT in the distributor catalog
   - What's unclear: Whether the planner should include a direct SSH-based edit task (requires the Skynet SSH machinery) or whether the user will do it manually
   - Recommendation: Include as a manual task with exact diff; user or orchestrator edits fleet-side directly

3. **`task` field in extended schema**
   - What we know: Current `SpawnRequestBody.task: string | null` is used by coord-drops
   - What's unclear: Whether coordinator dispatch still drops `task` alongside the new fields, or whether coord-drops should also adopt `roles[]` instead of `role`
   - Recommendation: Keep `task: string | null` for backwards compat; migrate coordinator drops to use `roles[]` in the same phase (D-12 says `role:` BECOMES `roles: [...]`)

---

## Sources

### Primary (HIGH confidence — direct source file reads this session)
- `substrate/scripts/wakeup-scheduler.py` — full file read; all scheduler details verified
- `substrate/scripts/agent-supervisor.sh` — lines 1240–1265 + 2360–2389 read; spawn pattern + main entry verified
- `substrate/scripts/ambient-monitor.py` — lines 300–380 read; per-role spawn exact code verified
- `src/backend/spawn-requests/types.ts` — full file read; SpawnRequestBody schema verified
- `src/backend/spawn-requests/parse-request-body.ts` — full file read; validation logic verified
- `src/backend/spawn-requests/worker.ts` — lines 1–80 read; BirthOptions.role: string confirmed
- `src/backend/distributor/catalog.ts` — full file read; restartHooks and catalog entries verified
- `src/backend/spawn-requests/scan-orchestrator.ts` — lines 1–80 read; architecture confirmed
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — SPAWN_REQUESTS_SCAN_CMD verified (lines 1259–1269)
- Bash: `ls ~/fleet/roles/box-maintainer/wakeups/` — zero .json files confirmed

### Secondary (MEDIUM confidence)
- `src/backend/spawn-requests/scan-orchestrator.ts` line 27: `~/fleet/spawn-requests/` confirmed as canonical drop path (self-documenting comment)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing
- Architecture: HIGH — all key files read directly
- Pitfalls: HIGH — derived from direct code reading, not speculation
- Migration state: HIGH — bash verified zero specs on this host

**Research date:** 2026-09-21
**Valid until:** 2026-10-21 (stable scripts; only risk is if spawn-requests pipeline schema changes)
