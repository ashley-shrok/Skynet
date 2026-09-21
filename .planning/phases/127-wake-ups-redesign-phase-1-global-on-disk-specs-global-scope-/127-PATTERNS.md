# Phase 127: Wake-ups Redesign Phase 1 — Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 8 files to create or modify
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `substrate/scripts/wakeup-scheduler.py` | utility/daemon | event-driven (poll + fire) | self (existing per-identity mode in same file) | exact — mode flag added to existing script |
| `substrate/scripts/agent-supervisor.sh` | orchestrator/supervisor | event-driven (startup spawn) | `start_ambient_monitor()` in same file (lines 1245-1265) | exact |
| `substrate/scripts/ambient-monitor.py` | utility/daemon | event-driven (child process list) | existing IS_COORDINATOR block in same file (lines 326-362) | exact — removal, not addition |
| `src/backend/spawn-requests/types.ts` | types/model | CRUD (schema definition) | self (existing `SpawnRequestBody` / `PendingBirth` interfaces) | exact — field extension |
| `src/backend/spawn-requests/parse-request-body.ts` | utility/validator | request-response | self (existing `parseRequestBody()` function) | exact — validator extension |
| `src/backend/spawn-requests/worker.ts` | service/worker | CRUD | self (existing `processBirth()` call site for `BirthOptions`) | exact — call-site update |
| `src/backend/spawn-requests/worker.test.ts` | test | — | self (existing `parseRequestBody` tests, Tests 1-7) | exact — add new cases to existing describe block |
| `substrate/skills/id/SKILL.md` | doc | — | existing `## Scheduled wake-ups` section (lines 804-873) | exact — add new subsection alongside |
| `~/fleet/wakeups/<slug>/migrated-from.md` | doc (provenance file) | — | bounty companion files (`RECON.md`, `RESULTS-*.md` patterns in bounty folders) | role-match |
| `/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` | doc | — | existing Type C section (lines 117-138) | exact — removal |

---

## Pattern Assignments

### `substrate/scripts/wakeup-scheduler.py` — global mode extension

**Analog:** existing `main()` and `_load_specs()` in the same file

**Entry point / argument parsing pattern** (lines 209-217):
```python
def main():
    if len(sys.argv) < 2:
        print("usage: python3 wakeup-scheduler.py <identity_dir>", file=sys.stderr)
        sys.exit(2)
    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    wdir = os.path.join(ident_dir, "wakeups")
    state_dir = os.path.join(wdir, ".state")
    os.makedirs(state_dir, exist_ok=True)
    _single_instance(state_dir, ident_dir)
```
Extension: replace `sys.argv` positional-only parse with `argparse`. Add `--mode global` flag. In global mode, `wdir = ident_dir` (the caller passes `~/fleet/wakeups` directly as the positional arg); `state_dir = os.path.join(wdir, ".state")`.

**Existing spec-loading pattern** (lines 176-189) — per-identity mode:
```python
def _load_specs(wdir):
    out = []
    for p in sorted(glob.glob(os.path.join(wdir, "*.json"))):
        try:
            spec = json.load(open(p))
        except Exception:
            continue
        if not spec.get("enabled", True):
            continue
        spec["_key"] = spec.get("name") or os.path.splitext(os.path.basename(p))[0]
        spec["_path"] = p
        if spec.get("instruction") and spec.get("schedule"):
            out.append(spec)
    return out
```
New global-mode analog function (structure to mirror, different glob and field):
```python
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
        if spec.get("prompt") and spec.get("schedule"):   # "prompt" not "instruction" (D-05)
            out.append(spec)
    return out
```

**Existing fire output pattern** (lines 84-99) — per-identity mode prints to stdout:
```python
def _emit_wake(key, utc, instruction, state_dir):
    if len(instruction) <= LONG_INSTRUCTION_CHARS:
        print("⏰ [scheduled: %s @ %s] %s" % (key, utc, instruction), flush=True)
        return
    wake_path = os.path.join(state_dir, key + ".wake")
    try:
        with open(wake_path, "w") as f:
            f.write(instruction)
    except OSError as e:
        print("⚠️ [wakeup-scheduler: %s] could not write wake file (%s); "
              "emitting inline (may truncate)" % (key, e), flush=True)
        print("⏰ [scheduled: %s @ %s] %s" % (key, utc, instruction), flush=True)
        return
    print("⏰ [scheduled: %s @ %s] [long instruction, %d chars — full text at %s "
          "— Read it]" % (key, utc, len(instruction), wake_path), flush=True)
```
New global-mode fire action drops a JSON file instead of printing. Structure the new function (`_drop_spawn_request`) as a separate function called where `_emit_wake` is called in the existing loop:
```python
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

**Orphan-monitor guard pattern** (lines 246-275) — existing per-identity logic:
```python
harness_pid = None
env_override = os.environ.get("AMBIENT_MONITOR_HARNESS_PID")
if env_override:
    try:
        p = int(env_override)
        if p > 1:
            harness_pid = p
    except ValueError:
        pass
if harness_pid is None:
    try:
        with open("/proc/%d/status" % os.getppid()) as f:
            for line in f:
                if line.startswith("PPid:"):
                    p = int(line.split()[1])
                    if p > 1:
                        harness_pid = p
                    break
    except (OSError, ValueError):
        pass
if harness_pid is None:
    print("wakeup-scheduler: orphan-check disabled (couldn't resolve grandparent)",
          file=sys.stderr, flush=True)
```
In global mode: set `harness_pid = None` unconditionally and skip all resolution above. Print a single diagnostic note to stderr: `"wakeup-scheduler: running in global mode — orphan-check disabled (no harness)"`. The `while True:` loop's guard `if harness_pid is not None: os.kill(harness_pid, 0)` already skips when `harness_pid is None` — no further change needed in the loop.

**One-shot spec path for deletion** (lines 343-358) — per-identity mode:
```python
try:
    os.unlink(os.path.join(wdir, key + ".json"))
except FileNotFoundError:
    for p in glob.glob(os.path.join(wdir, "*.json")):
        try:
            s = json.load(open(p))
        except Exception:
            continue
        if (s.get("name") or os.path.splitext(os.path.basename(p))[0]) == key:
            try:
                os.unlink(p)
            except OSError:
                pass
            break
```
Global mode analog — spec path comes from `spec["_path"]`, so use `os.unlink(spec["_path"])` directly. The fallback glob uses `glob.glob(os.path.join(wdir, "*/wakeup.json"))` and matches by `_slug`.

**`_single_instance` guard** (lines 192-206) — unchanged; receives `ident_dir` which in global mode is `~/fleet/wakeups`. The `ident_dir in cmd` check works because no identity will be named `wakeups` at the fleet level. Add a comment to document this assumption.

---

### `substrate/scripts/agent-supervisor.sh` — global scheduler spawn

**Analog:** `start_ambient_monitor()` (lines 1245-1265) and main block (lines 2373-2388)

**Spawn pattern to mirror** (lines 1260-1264):
```bash
setsid nohup "$AMBIENT_MONITOR" "$IDENTITIES_DIR/$name" \
    --inject-to "$sess" --harness-pid "$hpid" \
    > "$logf" 2>&1 < /dev/null & disown
log "'$name' ambient monitor started (harness_pid=$hpid, session='$sess', log=$logf)"
```

**Main block insertion point** (lines 2373-2388) — insert after `resolve_memory_wrapper`, before `case`:
```bash
# ---- main ----
ensure_agent_teams_env
ensure_inotifywait
resolve_memory_wrapper
# INSERT HERE: global wake-up scheduler spawn
case "${1:-}" in
  --once) VERBOSE=1 reconcile ;;
  *)
    log "agent-supervisor up: interval=${CHECK_INTERVAL}s, claude=$CLAUDE"
    for d in "$IDENTITIES_DIR"/*/; do rm -f "$d/.resume-complete" 2>/dev/null; done
    while :; do reconcile; sleep "${CHECK_INTERVAL:-30}"; done
    ;;
esac
```

**New spawn block pattern** (modeled on `start_ambient_monitor`, no `--inject-to` or `--harness-pid`):
```bash
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

**Logging convention** (from `start_ambient_monitor` and surrounding supervisor code): `log "..."` not `echo`. Use `metric event=...` for structured metrics if this is a sufficiently important lifecycle event (compare: `metric event=ambient-monitor-start identity="$name" session="$sess" harness_pid="$hpid"` at line 1264). The global scheduler spawn is a one-time startup event; a `log` line is sufficient.

---

### `substrate/scripts/ambient-monitor.py` — per-role scheduler spawn removal

**Analog:** existing IS_COORDINATOR block (lines 326-362) — read in full before editing

**Before** (lines 326-362):
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
        CHILDREN.append({
            "name": "role-file-watch",
            "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
            "env_extra": {},
            "critical": False,
        })
else:
    CHILDREN.append({
        "name": "role-file-watch",
        "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
        "env_extra": {},
        "critical": False,
    })
```

**After** (simplified — verify IS_COORDINATOR not used elsewhere first via grep):
```python
# Both coordinator and non-coordinator identities get role-file-watch.
# Per-role wake-up scheduler (wakeup-scheduler-role) removed in phase 127:
# the global wake-up scheduler in agent-supervisor.sh handles role-general
# wake-ups at host scope.
CHILDREN.append({
    "name": "role-file-watch",
    "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```

**Pre-edit check required:** grep `ambient-monitor.py` for `IS_COORDINATOR` before removing its detection block (lines 326-339). If IS_COORDINATOR is used only in this one block, remove the full detection block too. If used elsewhere, keep the detection and remove only the `wakeup-scheduler-role` append and `if role_folder is not None` branch.

**Adjacent child-append pattern to mirror** (lines 313-318 — the per-identity wakeup-scheduler append for reference):
```python
CHILDREN.append({
    "name": "wakeup-scheduler",
    "cmd": ["python3", str(HOME / ".local/bin/wakeup-scheduler"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```

---

### `src/backend/spawn-requests/types.ts` — schema extension

**Analog:** existing `SpawnRequestBody` and `PendingBirth` interfaces (lines 16-52 of same file)

**Current `SpawnRequestBody`** (lines 16-20):
```typescript
export interface SpawnRequestBody {
  role: string;
  task: string | null;
  requested_at: string; // ISO-Z timestamp for debug tracing
}
```

**Extended `SpawnRequestBody`** — replace `role: string` with `roles: string[]`, add `skills?` and `prompt`:
```typescript
export interface SpawnRequestBody {
  roles: string[];       // one or more role names (replaces single role: string — D-12)
  skills?: string[];     // optional list of skill slugs the newborn has ready (D-04)
  prompt: string;        // first user message to the newborn agent (D-05)
  task: string | null;   // kept for coord-drop backwards compat; wake fires set null (D-12)
  requested_at: string;  // ISO-Z timestamp for debug tracing
}
```

**Current `PendingBirth`** (lines 27-52) — `role: string` field:
```typescript
export interface PendingBirth {
  hostId: string;
  hostIdNum: number;
  uuid: string;
  role: string;        // ← becomes roles: string[]
  task: string | null;
  requested_at: string;
  userId: string;
  malformedReason?: string;
}
```

**Extended `PendingBirth`** — same pattern, rename field and add new ones:
```typescript
export interface PendingBirth {
  hostId: string;
  hostIdNum: number;
  uuid: string;
  roles: string[];       // replaces role: string (D-12)
  skills?: string[];     // optional (D-04)
  prompt: string;        // (D-05)
  task: string | null;
  requested_at: string;
  userId: string;
  malformedReason?: string;
}
```

**Doc-comment style** — every interface field carries a JSDoc inline comment explaining its purpose and the relevant D-number. Mirror the existing pattern exactly.

---

### `src/backend/spawn-requests/parse-request-body.ts` — validator extension

**Analog:** existing `parseRequestBody()` function body (lines 35-91 of same file)

**Existing validation pattern per field** (lines 56-88) — mirror this structure for each new field:
```typescript
// role field validation (existing — REPLACE with roles[] validation):
const role = obj["role"];
if (typeof role !== "string" || role.length === 0) {
  return { ok: false, reason: "malformed", message: "missing required field: role" };
}
if (!ROLE_NAME_PATTERN.test(role)) {
  return {
    ok: false,
    reason: "malformed",
    message: `role does not match pattern ${ROLE_NAME_PATTERN}: ${JSON.stringify(role)}`,
  };
}

// task field validation (existing — KEEP):
const task = obj["task"];
if (task !== null && typeof task !== "string") {
  return { ok: false, reason: "malformed", message: "task must be string or null" };
}
if (typeof task === "string" && task.length > TASK_MAX_LENGTH) {
  return {
    ok: false,
    reason: "malformed",
    message: `task exceeds ${TASK_MAX_LENGTH} character limit (got ${task.length})`,
  };
}
```

**New fields to validate** — add AFTER removing old `role` validation, BEFORE `task`:
```typescript
// roles[] validation (replaces single role field):
const roles = obj["roles"];
if (!Array.isArray(roles) || roles.length === 0) {
  return { ok: false, reason: "malformed", message: "missing required field: roles (must be non-empty array)" };
}
for (const r of roles) {
  if (typeof r !== "string" || r.length === 0) {
    return { ok: false, reason: "malformed", message: "roles: each element must be a non-empty string" };
  }
  if (!ROLE_NAME_PATTERN.test(r)) {
    return {
      ok: false,
      reason: "malformed",
      message: `roles: element does not match pattern ${ROLE_NAME_PATTERN}: ${JSON.stringify(r)}`,
    };
  }
}

// skills[] validation (optional):
const skills = obj["skills"];
if (skills !== undefined) {
  if (!Array.isArray(skills)) {
    return { ok: false, reason: "malformed", message: "skills must be an array if present" };
  }
  for (const s of skills) {
    if (typeof s !== "string" || s.length === 0) {
      return { ok: false, reason: "malformed", message: "skills: each element must be a non-empty string" };
    }
  }
}

// prompt validation:
const prompt = obj["prompt"];
if (typeof prompt !== "string" || prompt.length === 0) {
  return { ok: false, reason: "malformed", message: "missing required field: prompt" };
}
```

**Return shape** — mirror existing (line 87-90):
```typescript
return {
  ok: true,
  body: { role, task: task as string | null, requested_at },  // ← update to new fields
};
// After extension:
return {
  ok: true,
  body: { roles, skills: skills as string[] | undefined, prompt, task: task as string | null, requested_at },
};
```

**Module-level doc-comment** (lines 1-16) — update the "Extra fields ... are rejected as malformed (D-05)" sentence to list the new accepted fields alongside the still-rejected ones.

---

### `src/backend/spawn-requests/worker.ts` — call-site update

**Analog:** existing `processBirth()` call to `birthIdentity` with `BirthOptions`

**Locate the call site** — search `worker.ts` for `birthIdentity(` and the `BirthOptions` object construction. Current pattern passes `role: item.role` (a single string). After extension:

```typescript
// BEFORE (current):
birthIdentity({ ..., role: item.role, ... }, emit, birthDeps)

// AFTER (D-13 bridge — roles[0] until BirthOptions is extended by multi-role work):
birthIdentity({
  ...,
  role: item.roles[0],   // TODO: multi-role — use full roles[] once BirthOptions supports it
  ...
}, emit, birthDeps)
```

**`makePendingBirth` in worker.test.ts** (line 117-128) — update default `role:` to `roles:`:
```typescript
// BEFORE:
function makePendingBirth(overrides?: Partial<PendingBirth>): PendingBirth {
  return {
    ...,
    role: "coordinator",
    ...
  };
}
// AFTER:
function makePendingBirth(overrides?: Partial<PendingBirth>): PendingBirth {
  return {
    ...,
    roles: ["coordinator"],
    prompt: "",
    ...
  };
}
```

---

### `src/backend/spawn-requests/worker.test.ts` — new parseRequestBody test cases

**Analog:** existing `describe("parseRequestBody", ...)` block (lines 181-264 of same file)

**Test structure pattern** (lines 182-193 — Test 1 as template):
```typescript
it("Test 1: valid JSON returns ok:true + SpawnRequestBody", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ role: "coordinator", task: "do a thing", requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.body.role).toBe("coordinator");
    expect(result.body.task).toBe("do a thing");
    expect(result.body.requested_at).toBe("2026-09-10T00:00:00Z");
  }
});
```

**New test cases to add** — copy the pattern exactly, number them sequentially after the highest existing test number (currently Test 7 is last in the `parseRequestBody` describe):
```typescript
it("Test N: valid extended body {roles, skills, prompt} returns ok:true + SpawnRequestBody", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({
      roles: ["coordinator"],
      skills: ["id"],
      prompt: "Check the Kanban",
      task: null,
      requested_at: "2026-09-10T00:00:00Z",
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.body.roles).toEqual(["coordinator"]);
    expect(result.body.skills).toEqual(["id"]);
    expect(result.body.prompt).toBe("Check the Kanban");
  }
});

it("Test N+1: empty roles array rejected as malformed", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ roles: [], prompt: "do something", task: null, requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.message).toMatch(/roles/i);
  }
});

it("Test N+2: roles element failing ROLE_NAME_PATTERN rejected as malformed", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ roles: ["INVALID ROLE"], prompt: "x", task: null, requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.message).toMatch(/role/i);
  }
});

it("Test N+3: missing prompt rejected as malformed", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ roles: ["coordinator"], task: null, requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.message).toMatch(/prompt/i);
  }
});

it("Test N+4: skills present as non-array rejected as malformed", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ roles: ["coordinator"], skills: "id", prompt: "x", task: null, requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.message).toMatch(/skills/i);
  }
});

it("Test N+5: skills absent (undefined) accepted — field is optional", () => {
  const result = parseRequestBody(
    "test-uuid",
    JSON.stringify({ roles: ["coordinator"], prompt: "x", task: null, requested_at: "2026-09-10T00:00:00Z" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.body.skills).toBeUndefined();
  }
});
```

**Also update existing Test 1** (and any other tests that construct a valid body) to use the new `roles` + `prompt` fields. Tests 2-7 that test _invalid_ bodies don't need `roles`/`prompt` in the valid parts (they're testing specific error paths), but Test 1 (the "valid JSON returns ok:true" case) must be updated to use the new schema.

---

### `substrate/skills/id/SKILL.md` — add global wake-ups subsection

**Analog:** existing `## Scheduled wake-ups` section (lines 804-873 of same file) — add a new `### Global wake-ups` subsection after the existing `### Role-level` description (around line 832), or after `### Scope: identity-level vs role-level` section.

**Structure to mirror** — the existing spec format block (lines 836-854):
```markdown
### Spec format

One JSON file per wake-up. Path depends on scope (see § Scope above): identity-level
at `~/fleet/identities/<name>/wakeups/<slug>.json`, role-level at
`~/fleet/roles/<role>/wakeups/<slug>.json`. Contents are the same either way:

```jsonc
{
  "name": "standup-check",
  ...
  "instruction": "Check the work Kanban..."
}
```
```

**New subsection to add** after the role-level bullet (line 832), updating the Scope section:
```markdown
- **Global** — `~/fleet/wakeups/<slug>/wakeup.json`. Fires a **fresh identity** — when the
  schedule fires, the agent-supervisor's global scheduler drops a create-identity request that
  Skynet's backend consumes to birth a new identity with the spec's `roles` and `skills`.
  The spec's `prompt` becomes that identity's first turn. No running session is woken; the new
  identity is the wake-up. Global specs live in slug-named folders under `~/fleet/wakeups/`;
  the folder shape lets companion files (provenance records, scratch notes) sit alongside the
  spec naturally.
```

**Update the spec format block** to document the new global-scope fields alongside the existing ones:
```jsonc
{
  "name": "standup-check",    // short label shown in the wake line / UI
  "enabled": true,
  // For GLOBAL scope (~/fleet/wakeups/<slug>/wakeup.json):
  "roles": ["box-maintainer"],   // one or more roles the newborn takes on
  "skills": ["id"],              // optional skills the newborn has ready
  "prompt": "Check the work Kanban and triage any unassigned cards.",  // newborn's first turn
  // For IDENTITY scope (~/fleet/identities/<name>/wakeups/<slug>.json):
  // "instruction": "Check the work Kanban..."  (prints to running harness)
  "schedule": { "type": "interval", "every": "2h" },
}
```

---

### `~/fleet/wakeups/<slug>/migrated-from.md` — migration provenance file

**Analog:** companion files in bounty folders (e.g., `RECON.md`, `RESULTS-2026-09-12.md` in `bounties/stt-nova-sonic-migration/`); also the `bounty.json` `"timeline"` field pattern.

**No exact analog in the codebase** — the pattern is inferred from how companion files work in bounty and skill folders. There is no existing `migrated-from.md` template.

**Closest structural reference:** the `bounty.json` `timeline` field pattern — plain prose lines with timestamps:
```json
"timeline": [
  "2026-09-20T08:55:00Z created",
  "2026-09-20T08:55:00Z started by vector"
]
```

**Recommended `migrated-from.md` shape** — minimal, self-explanatory plain markdown (self-documenting per the "field names must be readable to a cold reader" principle in the shape):
```markdown
# migrated-from

Migrated from per-role wake-up on 2026-09-21.

**Original path:** `~/fleet/roles/<role>/wakeups/<slug>.json`
**Migrated at:** 2026-09-21T<HH:MM:SS>Z
**Original fields preserved:**
- `schedule`: <schedule type> / <schedule value>
- `instruction` → `prompt`: verbatim
- `name`: verbatim (if present)
**Roles added:** `["<role>"]` (derived from original path's role name)
```

---

### `/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` — Type C removal

**File location:** `/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` (fleet-side, NOT in distributor catalog — direct edit only, no distributor push).

**Section to remove** (lines 117-138):
```markdown
### Type C: Scheduled wake-up (from your wake-up scheduler) → ROUTE-AND-DROP variant

Wake-up specs in the ROLE folder `~/fleet/roles/<role>/wakeups/` fire on your session.
...
3. You're done. The actor runs the check silently unless something urgent surfaces.
```

**References to also remove** (verified by grep output above):
- Line ~22: "AND an extra role-scoped wake-up scheduler (so role-general wakes fire on you)" — remove this clause from the sentence
- Lines ~486-487: "an identity-scoped wake-up scheduler, AND an extra role-scoped wake-up scheduler against `~/fleet/roles/<role>/wakeups/` so role-general wakes fire on you"
- Lines ~496-499: paragraph about constructing a `python3 ~/.local/bin/wakeup-scheduler ~/fleet/roles/<role>` invocation
- Line ~55: "a wake-up is Type C based on how it was delivered (wake-up scheduler" — update the Type detection reference or remove Type C from the enumeration

---

## Shared Patterns

### State-dir creation and PID tracking
**Source:** `wakeup-scheduler.py` lines 215-217 and `_single_instance()` lines 192-206
**Apply to:** global mode extension of `wakeup-scheduler.py`
```python
state_dir = os.path.join(wdir, ".state")
os.makedirs(state_dir, exist_ok=True)
_single_instance(state_dir, ident_dir)
```
In global mode: `wdir = ident_dir = ~/fleet/wakeups`; `state_dir = ~/fleet/wakeups/.state`. The `_single_instance` function is unchanged — it uses `ident_dir in cmd` as uniqueness key, which works because no identity is named `wakeups`.

### One-shot `.fired` sentinel pattern
**Source:** `wakeup-scheduler.py` lines 300-362
**Apply to:** global mode extension — sentinel semantics carry over verbatim. The sentinel path is `os.path.join(state_dir, key + ".fired")`. The `spec_mtime > sentinel_mtime` stale-sentinel clearance logic (lines 309-324) is unchanged. In global mode the spec delete uses `os.unlink(spec["_path"])` (the nested path) instead of `os.unlink(os.path.join(wdir, key + ".json"))` (the flat path).

### TypeScript union-return pattern for validation
**Source:** `parse-request-body.ts` lines 36-38
**Apply to:** all new field validations in `parseRequestBody`
```typescript
export function parseRequestBody(
  _uuid: string,
  rawBody: string,
): { ok: true; body: SpawnRequestBody } | { ok: false; reason: "malformed"; message: string }
```
Every new validation failure returns `{ ok: false, reason: "malformed", message: "<descriptive message>" }`. Every new accepted field is included in the `{ ok: true, body: ... }` return.

### `setsid nohup ... < /dev/null & disown` spawn pattern
**Source:** `agent-supervisor.sh` line 1260-1262
**Apply to:** global scheduler spawn in `agent-supervisor.sh`
```bash
setsid nohup <cmd> > <logfile> 2>&1 < /dev/null & disown
```
`setsid` detaches from terminal; `nohup` protects from SIGHUP; `< /dev/null` prevents stdin reads; `& disown` prevents supervisor from waiting. All four parts required for a proper background daemon spawn.

### Vitest mock and describe block structure
**Source:** `worker.test.ts` lines 34-175 (imports, mocks, helpers)
**Apply to:** new test cases added to `worker.test.ts`
- All new `parseRequestBody` tests go inside the existing `describe("parseRequestBody", ...)` block
- Use the same `it("Test N: <description>", ...)` naming convention
- No new `vi.mock(...)` calls needed — all mocks already present

---

## No Analog Found

No files in this phase are entirely new with no analog. All files are either:
- Extensions of existing files (same file, different mode/fields)
- Reductions of existing files (removals from existing code)
- The `migrated-from.md` provenance file has a partial analog (bounty companion files), which is documented above

---

## Metadata

**Analog search scope:** `substrate/scripts/`, `src/backend/spawn-requests/`, `src/backend/claude-session/`, `substrate/scripts/tests/`, `/home/ubuntu/fleet/.claude/skills/id/`, `/home/ubuntu/fleet/` (for bounty companion file pattern)
**Files read:** 14 source files + 3 test files
**Pattern extraction date:** 2026-09-21
