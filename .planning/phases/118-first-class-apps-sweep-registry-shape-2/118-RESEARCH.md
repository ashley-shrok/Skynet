# Phase 118: First-class apps — sweep + registry (shape 2) - Research

**Researched:** 2026-09-18
**Domain:** Skynet fleet-status per-box sweep + WS subscription surface + Python
sweep-script extension for `~/fleet/apps/` enumeration.
**Confidence:** HIGH — every load-bearing seam was read verbatim in this session.

## Summary

Phase 118 grows an already-mature machine. The fleet-status sweep pipeline is a
one-exec-per-host batch (Phase 92), a lenient JSONL wire schema
(`sweep-schema.ts`), a `PerHostState` map in
`ssh-poll-orchestrator.ts` that adapts sweep lines into `SessionState`
frames, a `subscription-registry.ts` fan-out hub that publishes those frames to
WS subscribers, and a `fleet-status-server.ts` shell that terminates WS
connections. Every one of those seams has an obvious sibling shape for apps —
line kind, per-host tracking Set, publish method, snapshot-on-subscribe path,
and outbound frame schema. The Python sweep script (`fleet-status-sweep.py`)
already emits multi-kind JSONL and grows by one new `main()` block + one
`_enumerate_apps` helper + one `_build_app_line` helper. No new dependencies,
no new distributor row, no DB schema.

**One material surprise for the planner:** CONTEXT D-15 says "reuse
`checkHostAccess` ... same shape identity frames are (or will be) filtered."
Ashley's paren "(or will be)" is doing all the work — identity frames are
**not** filtered today. There is exactly one call site for `checkHostAccess`
across the whole `src/backend/fleet-status/` tree, and it's inside a docblock
comment, not a real invocation. Every subscriber currently sees every host's
frames. Phase 118's app-filter is **greenfield in this codebase** and needs a
first-principles design (see § "Wire filter application"). This is not
blocking, but it changes the plan shape from "mirror the identity filter" to
"design the app filter to be reusable when identities eventually adopt it."

**Primary recommendation:** Five plans. Sweep-script extension → wire-schema
extension → orchestrator adapter + per-host reconciliation → subscription-
registry app methods + wire-protocol frames + server-side filter → test
coverage across all layers. Land in that order — each depends on the previous.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enumerate `~/fleet/apps/*` on managed box | Managed box (Python sweep) | — | Disk is the truth; per-box work belongs on the box. Same tier as identity source-B enumeration. |
| Query systemd `--user` for unit presence + active state | Managed box (Python sweep) | — | Requires local systemctl access; cannot be done from Skynet. Same tier as `stat`. |
| Parse `app.json` and extract fields | Managed box (Python sweep) | — | Server-side classification per the "wire IS the classification" discipline (see `SweepStatResult` docblock in `sweep-schema.ts`). |
| Type + validate JSONL wire contract | Skynet backend (TS) | — | `sweep-schema.ts` owns every line kind; parser lenience discipline lives here. |
| Adapt `SweepAppLine` → in-memory `AppState` | Skynet backend (TS) — `ssh-poll-orchestrator.ts` | — | Same adapter tier that turns `SweepIdentityLine` into `SessionState`. |
| Per-host reconciliation-on-success (app-gone detection) | Skynet backend (TS) — `ssh-poll-orchestrator.ts` | — | Sibling to Phase 115's `lastTickLiveTreeIdentities` diff. Sweep-success gate lives on this tier. |
| In-memory app map `Map<hostId:slug, AppState>` | Skynet backend (TS) — `subscription-registry.ts` | — | Registry is the fan-out hub; new sibling map lives here alongside `state`. |
| WS frame publish methods (snapshot / update / gone) | Skynet backend (TS) — `subscription-registry.ts` | — | Same tier as `publishSessionState` / `publishIdentityGoneByName`. |
| Per-user host-visibility filter | Skynet backend (TS) — `fleet-status-server.ts` (subscribe wrapper) OR `subscription-registry.ts` (fan-out inject) | — | See § "Wire filter application" for the design decision. Currently unfiltered — Phase 118 introduces the first filter. |
| WS frame schemas | Skynet backend (TS) — `wire-protocol.ts` | — | Every outbound frame kind lives in the discriminated union here. |
| Snapshot-on-subscribe delivery | Skynet backend (TS) — `subscription-registry.ts` (subscribe path) | — | Same site as identity/archive snapshot delivery today (L195, L216). |

## Standard Stack

No new libraries. All extensions land in existing files with existing
dependencies (`ws`, `zod`, Python 3 stdlib). The stack is:

| Component | Existing tool | Purpose |
|---------|---------|---------|
| TS wire schema | `zod` (already imported in `wire-protocol.ts`) | Discriminated union frame validation. |
| JSONL parser | `sweep-schema.ts` + `parseSweepJsonl` (already exists) | Lenient parse of the sweep's stdout. |
| WS server | `ws` (already imported in `fleet-status-server.ts`) | The frontend connection surface. |
| Python sweep | stdlib `os` / `subprocess` / `json` / `glob` / `re` (already used) | Filesystem enum + systemctl exec + JSON emission. |
| systemctl access | `subprocess.run(["systemctl", "--user", …], timeout=…)` | Matches how `_resolve_pid_to_tmux_session` calls `tmux`. |

**Version verification:** No new package installs; existing versions carry the
work. [VERIFIED: read imports in `wire-protocol.ts:8`, `fleet-status-server.ts:19`,
`sweep-schema.ts:270`, `fleet-status-sweep.py:89-96` this session.]

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────┐
                     │  Managed box (per box)                  │
                     │                                         │
   sweep exec  ──────┤  fleet-status-sweep.py                  │
   (every 2s)        │    _enumerate_identities()              │
                     │    _enumerate_pids()                    │
                     │    _enumerate_apps()   ← NEW (D-17)     │
                     │    _resolve_pid_to_tmux_session()       │
                     │    _build_app_line()   ← NEW            │
                     │      • stat folder mtime                │
                     │      • read app.json                    │
                     │      • check icon.webp                  │
                     │      • systemctl --user cat / is-active │
                     │      • extract PORT env from unit       │
                     │    _emit(line)   [line_kind: "app"]     │
                     └─────────────────┬───────────────────────┘
                                       │ JSONL on stdout
                                       │ (one exec per host per tick)
                                       ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  Skynet backend                                                │
   │                                                                │
   │  sweep-schema.ts                                               │
   │    parseSweepJsonl(raw)                                        │
   │      • dispatches on line_kind ∈ {identity, pid, app ← NEW}    │
   │      • returns { identityLines, pidLines, appLines ← NEW }     │
   │                                                                │
   │  ssh-poll-orchestrator.ts                                      │
   │    pollOneHostBatch()                                          │
   │      • parse, then                                             │
   │      • for identityLine of identityLines: compose+publish      │
   │      • for pidLine of pidLines:      compose+publish           │
   │      • for appLine of appLines:      compose+publishApp ← NEW  │
   │      • reconcile identities (existing, 67b4a7ef)               │
   │      • reconcile apps         ← NEW (D-11)                     │
   │                                                                │
   │    PerHostState                                                │
   │      lastTickLiveTreeIdentities: Set<string>  (existing)       │
   │      lastTickLiveApps: Set<string>            ← NEW            │
   │                                                                │
   │  subscription-registry.ts                                      │
   │    state: Map<hostId:tmuxSession, SessionState>  (existing)    │
   │    apps:  Map<hostId:slug,        AppState>      ← NEW         │
   │                                                                │
   │    publishAppSnapshot / publishAppUpdate /                    │
   │    publishAppGoneByHostSlug                     ← NEW          │
   │                                                                │
   │    subscribe(sendFrame, {userId})                              │
   │      • send session snapshot          (existing)               │
   │      • send archived-identity snapshot (existing)              │
   │      • send app snapshot filtered by userId  ← NEW             │
   │                                                                │
   │  wire-protocol.ts                                              │
   │    FrontendOutboundFrame discriminated union                   │
   │      + AppSnapshotFrame / AppUpdateFrame / AppGoneFrame ← NEW │
   │                                                                │
   │  fleet-status-server.ts                                        │
   │    handleFrontendConnection() — extract userId from JWT,       │
   │    thread into registry.subscribe(...)  (existing)             │
   │                                                                │
   │    NEW: per-frame filter on outbound app frames using           │
   │         checkHostAccess(hostIdNum, userId, hostUserId, "read") │
   └─────────────────┬─────────────────────────────────────────────┘
                     │ WS frames
                     ▼
   ┌───────────────────────────────────────┐
   │  Frontend (shape 3 territory)          │
   │  Consumes app-snapshot / update / gone │
   └───────────────────────────────────────┘
```

### Recommended Project Structure

No new files or folders. All changes land in these existing paths:

```
src/backend/fleet-status/
├── ssh-poll-orchestrator.ts    (adapter + reconciliation)
├── ssh-poll-orchestrator.test.ts (new sibling test cases)
├── subscription-registry.ts    (sibling map + publish methods)
├── subscription-registry.test.ts (new tests)
├── fleet-status-server.ts      (filter application)
├── fleet-status-server.test.ts (new filter tests)
├── wire-protocol.ts            (new frame schemas)
├── wire-protocol.test.ts       (new schema tests)
├── sweep-schema.ts             (SweepAppLine + parser dispatch)
└── sweep-schema.test.ts        (new parser tests)

substrate/scripts/
├── fleet-status-sweep.py       (new enumeration + emitter)
└── tests/
    └── fleet-status-sweep-apps.test.sh  (new sibling to fleet-status-sweep.test.sh)
```

### Pattern 1: Line-kind discrimination (existing, extends)

**What:** JSONL wire uses a `line_kind` string field on every line + a shared
`schema_version`. The parser dispatches on `line_kind` and drops unknown kinds
into a `unknownLines` counter (not a failure — forward-compat).

**Source:** `sweep-schema.ts:222-228` and `:307-315`.

**Extension shape:**
```typescript
// sweep-schema.ts — after the SweepPidLine interface

export interface SweepAppLine {
  line_kind: "app";
  schema_version: SweepSchemaVersion;
  slug: string;                    // folder name (kebab-case)
  title: string;                   // from app.json
  description: string;             // from app.json
  port: number | null;             // from unit PORT env; null if extract failed
  has_icon: boolean;               // icon.webp exists?
  created_at_ms: number;           // folder mtime × 1000
  is_healthy: boolean;             // D-01+D-02
  health_message: string | null;   // present only when is_healthy: false
}

export type SweepLine = SweepIdentityLine | SweepPidLine | SweepAppLine;
```

Widen `isSweepLineOfCurrentSchema` (L227) and add an `app` case to
`parseSweepJsonl` (L307), returning `appLines: SweepAppLine[]` on the result.

**Load-bearing:** The parser stays lenient — bad JSON discarded silently,
mismatched `schema_version` flips `schemaMismatch` flag but does not throw,
unknown `line_kind` bumps `unknownLines` (that's how the current code lets
a newer Python sweep script emit `app` lines against an older TS parser
during a rolling deploy — see § "Known gotchas — hot-reload deploy").

### Pattern 2: Per-host reconciliation-on-success (Phase 115 `67b4a7ef` — the template)

**What:** After a successful sweep tick, compute the set of live entities
seen this tick, diff against the set stored on `PerHostState` from the
previous tick, and call the registry's identity-scoped "gone" method for
every entity that dropped out. Update the tracking set.

**Load-bearing constraint:** Only runs on the sweep-success path. All
`{ok:false}` early-returns in `pollOneHostBatch` skip the reconciliation
block, so transient SSH failures do not cause the sidebar to flap.

**Exact site to mirror:** `ssh-poll-orchestrator.ts:1770-1792` (the identity
reconciliation block). Add a sibling block immediately after (or before —
order doesn't matter, both are pure-computation over `parsed.*Lines`).

**Extension shape:**
```typescript
// Adjacent to the existing identity reconciliation block:
const thisTickApps = new Set<string>();
for (const line of parsed.appLines) {
  thisTickApps.add(line.slug);
}
for (const previousSlug of hostState.lastTickLiveApps) {
  if (!thisTickApps.has(previousSlug)) {
    deps.registry.publishAppGoneByHostSlug(host.id, previousSlug);
  }
}
hostState.lastTickLiveApps = thisTickApps;
```

### Pattern 3: Registry publish + snapshot-on-subscribe (existing, extends)

**What:** The registry holds an in-memory `Map`, exposes publish methods
that both mutate the map and fan out a frame, and re-emits the current
map contents to every new subscriber immediately on `subscribe()`.

**Source:** `subscription-registry.ts:159-372`.

**Extension shape:**
- Add `const apps = new Map<string, AppState>()` alongside `state`.
- Add three publish methods (see § "The subscription-registry publish
  surface" below for exact signatures).
- In `subscribe()`, after the existing session-snapshot and archived-identity
  snapshot fanouts, add an app-snapshot fanout. **The subscribe path is
  where the per-user filter belongs on the snapshot side** — see § "Wire
  filter application" below.

### Pattern 4: WS frame discriminated union (existing, extends)

**What:** `FrontendOutboundFrame` is a `z.discriminatedUnion("type", [...])`
with a `makeXxxFrame` factory per kind. `FRAME_SCHEMA_VERSION` stays at 1
(additive extensions never bump it — 8-iteration lineage documented at L242-249
and L306-315 and L355-365 in `wire-protocol.ts`).

**Source:** `wire-protocol.ts:517-644`.

**Extension shape:** Add three new frame schemas + three `make…` factories +
append them to the `FrontendOutboundFrame` discriminated union.

### Anti-Patterns to Avoid

- **Do NOT introduce a per-app permission model.** D-15 is explicit — host access
  IS app access. Filtering happens at the host level via `checkHostAccess`. No
  per-app grants, no per-app ACLs, no per-app "hidden from user" flag.
- **Do NOT persist the app map anywhere.** D-10 is explicit — in-memory only.
  Restart wipes it; next sweep rebuilds it. Do not add a SQLite table, do not
  use `DatabaseSaveTrigger`, do not add anything to Drizzle.
- **Do NOT construct icon URLs on the backend.** D-06 — the wire says `has_icon:
  bool`, nothing more. Shape 4 owns the serving path.
- **Do NOT run reconciliation on `{ok:false}` sweep paths.** Copy the exact
  guard shape from Phase 115: the reconciliation block lives **inside** the
  `pollOneHostBatch` success path, after all the compose+publish loops. All
  early-returns for null-exec / schema-mismatch / empty-on-nonempty skip it.
- **Do NOT emit `app-gone` when only `isHealthy` flipped.** D-13 — health
  changes are `app-update` frames, not gone-and-re-add. The reconciliation
  block only publishes gone for slugs missing entirely from this tick's set.
- **Do NOT hand-edit installed copies on any box.** Fleet-wide rule (box-
  maintainer standing directive 2026-09-12). Editing
  `substrate/scripts/fleet-status-sweep.py` + normal deploy is the ONLY way
  to update the script on managed boxes.
- **Do NOT shell out to `bash -c "systemctl …"` from the Python sweep.** Use
  `subprocess.run(["systemctl", …], timeout=…)` argv form — matches the
  precedent set by `_resolve_pid_to_tmux_session` (L580-586) and eliminates
  shell-metachar concerns even though slug regex would already prevent them.
- **Do NOT expand health signals beyond "unit exists + active".** D-04 —
  binary axis only. No crash-loop counters, no response-time probes, no port
  collision checks. Adding these later widens the wire schema; shape 2 does
  not open that door.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-user permission check for hosts | Custom map of user→hostIds | `checkHostAccess(hostIdNum, userId, hostUserId, "read")` from `src/backend/ssh/host-resolver.ts` | Single authority across codebase (12+ call sites). Handles ownership + shared-access via `PermissionManager.canAccessHost` uniformly. |
| JSONL parse discipline | Custom lenient parser | Extend `parseSweepJsonl` with an `app` case | Existing parser owns error handling, empty-blob semantics, schema-mismatch flag. |
| Frame schema validation | Hand-crafted validator | Add a `z.object` schema to `wire-protocol.ts` and append to the discriminated union | Every existing frame does this. Free type inference + free runtime validation. |
| WS fan-out to subscribers | Custom loop | Call existing `fanOut(subscribers, frame)` helper in `subscription-registry.ts:140-154` | Handles per-subscriber try/catch already (one bad subscriber can't take down the fanout). |
| systemd unit env extraction | Regex over unit file text | `systemctl --user show -p Environment app-<slug>.service` | Reads the effective merged env, not the on-disk template. Handles `Environment=` and `EnvironmentFile=` uniformly. See § "Systemd query mechanics" for the specific command. |

**Key insight:** Every abstraction Phase 118 needs already exists in the code
being extended. There is no new pattern to invent — this is a "one more sibling
of an established shape" phase. The novel thing is the app-filter at the WS
boundary, and even that composes an existing single-source-of-truth function.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None. D-10 forbids persistence; the in-memory `apps` Map is wiped at restart. | None — the design is the mitigation. |
| Live service config | None. No external services (Datadog, n8n, etc.) hold app-related state. | None. |
| OS-registered state | Systemd `--user` units named `app-<slug>.service` on each managed box (created by shape 1's `create-app.sh`). Phase 118 **observes** these; it does not create, modify, or delete them. | None — read-only observation. |
| Secrets/env vars | The unit's `PORT=<n>` env is the app's port (D-07). Phase 118 reads it via `systemctl --user show -p Environment`. No secret handling; PORT is not sensitive. | None. |
| Build artifacts / installed packages | `~/.local/bin/fleet-status-sweep` — the installed copy of the Python script. Distributor pushes new bytes on next sweep after `substrate/scripts/fleet-status-sweep.py` changes commit. | None — normal distributor flow handles it. Executor MUST NOT hand-edit installed copy on any box. |

**Nothing found in any category that requires a migration task.** Phase 118 is
add-only: new code paths in existing files, no data migration, no config change,
no re-registration.

## Common Pitfalls

### Pitfall 1: Reconciliation on {ok:false} path

**What goes wrong:** Adding the app-reconciliation block outside the
sweep-success guard means transient SSH failures cause every previously-seen
app to be reported gone, then re-appear on the next successful sweep.
Frontend sidebar flaps.

**Why it happens:** The reconciliation block is small and looks like it
belongs "at the end" of `pollOneHostBatch`, but the {ok:false} early-returns
above it must skip it. Easy to add the block after the `return { ok: false, ... }`
statements instead of inside the `return { ok: true, ... }` scope.

**How to avoid:** Place the app reconciliation block IMMEDIATELY after the
identity reconciliation block (`ssh-poll-orchestrator.ts:1770-1792`) —
same scope, same guard. Copy the code paragraph shape exactly.

**Warning signs:** Test that mocks the sweep to fail (channel returns null) and
asserts NO `publishAppGoneByHostSlug` calls. Test that mocks the sweep to succeed
with fewer apps than the previous tick and asserts exactly the missing slugs
were called.

### Pitfall 2: Filter applied at the wrong layer

**What goes wrong:** If the filter is applied only at snapshot-on-subscribe
time (in the `subscribe()` path) but not at fan-out time (in each `publishApp*`
call), subscribers see the initial snapshot filtered correctly but leak every
subsequent update for boxes they can't access.

**Why it happens:** The snapshot is a natural insertion point (already runs at
subscribe time), and it's easy to think "I filtered the initial state so the
frontend will only ever see permitted apps." But fan-out is a separate site.

**How to avoid:** The filter belongs in BOTH places. Recommend implementation:
attach userId to each subscriber entry in the registry (extend the `subscribers`
Set to a `Map<sendFrame, {userId: string}>`), and let the registry's own
fan-out (`fanOut()` at L140-154) filter frames per-subscriber. Then the same
filter runs uniformly for snapshot + updates + gone. See § "Wire filter
application" below for the exact shape.

**Warning signs:** Filter test with two subscribers on the same registry —
subscriber A on box X, subscriber B on box Y. Trigger `publishAppUpdate` for
box X. Assert subscriber A receives, subscriber B does NOT.

### Pitfall 3: Health-flip published as gone+add

**What goes wrong:** When an app's unit stops (D-02 healthy → unhealthy
transition), the reconciliation block or a naive update path publishes
`app-gone` immediately followed by `app-update` with `is_healthy: false`.
Sidebar visually flaps.

**Why it happens:** The reconciliation set tracks slugs that "passed D-01
or D-02" — but if the implementation instead tracks "slugs that are healthy",
the unhealthy-carve-out apps drop out of the tracking set every tick they're
unhealthy, so reconciliation fires gone for them every tick.

**How to avoid:** The reconciliation set MUST track "slugs that are IN the
picture" (passed D-01 **or** D-02), not "slugs that are healthy". Every app
that gets an `AppState` entry — healthy or not — belongs in the tracking set
this tick. Health transitions are pure `publishAppUpdate` calls, driven by
the compose+publish loop over `parsed.appLines`.

**Warning signs:** Test that runs two consecutive ticks — tick 1 emits app
with `is_healthy: true`, tick 2 emits same app with `is_healthy: false`.
Assert exactly ONE `publishAppUpdate` on tick 2, ZERO `publishAppGoneByHostSlug`.

### Pitfall 4: PORT extraction from a template file, not the running unit

**What goes wrong:** The sweep script parses `app-SLUG.service.template` from
the shape-1 skill dir and reads `PORT=` from there, always getting the
template placeholder `__PORT__`.

**Why it happens:** The template is checked into the repo. The rendered unit
files live at `~/.config/systemd/user/app-<slug>.service` on each box (see
`create-app.sh:48`). Grepping "PORT=" in the source tree finds the template.

**How to avoid:** Query systemd itself — `systemctl --user show -p
Environment app-<slug>.service` returns the effective env. The rendered unit
file at `~/.config/systemd/user/app-<slug>.service` is the fallback if
`show` doesn't work for some reason, but prefer `show`.

**Warning signs:** Every app in the test emits `port: 9501` (the first
template port). Real ports must vary.

### Pitfall 5: `app.json` malformed → whole sweep fails

**What goes wrong:** A single app with malformed `app.json` causes the sweep
script to raise, which triggers the top-level `except` → exit 0 with empty
stdout → orchestrator falls back to legacy path for identities → sidebar
loses all identity data on this box.

**Why it happens:** Python's `json.loads` raises `JSONDecodeError` on
malformed input; if that raise is inside the main loop unguarded, it kills
the whole main().

**How to avoid:** Copy the `_build_identity_line` per-identity try/except
discipline (L850-862 wraps the frontmatter read in a bare `try/except OSError`
to guarantee the identity line still emits). For `_build_app_line`, wrap the
`json.loads(app_json_text)` in a per-app `try/except` — malformed → this app
is skipped from the tick (D-01 fail on inclusion check (a)) + a `_log(
"app_json_malformed", slug=slug[:40])` on stderr. The rest of the sweep
continues.

**Warning signs:** Python shell test with a fixture containing `~/fleet/apps/
good/app.json` (valid) and `~/fleet/apps/bad/app.json` (invalid). Assert
exactly ONE `line_kind: "app"` line for "good" + stderr contains
`app_json_malformed slug="bad"` + identity lines still present.

### Pitfall 6: Rolling deploy — Python sweep newer than TS parser

**What goes wrong:** The distributor pushes the new Python script to a
managed box BEFORE the container-side Skynet gets its new TS parser deploy.
The box starts emitting `line_kind: "app"` lines that the old TS parser
doesn't recognize.

**Why it happens:** Ashley's container-mutation-serialization rule means
Skynet redeploys can lag distributor sweeps by minutes.

**How to avoid:** No action needed — the lenient parser already handles this
correctly. `parseSweepJsonl` bumps `unknownLines` for unrecognized kinds and
otherwise proceeds normally (`sweep-schema.ts:311-315`). Identity and PID
lines still parse and dispatch fine. The `app` lines are silently dropped
until the TS parser catches up.

**Warning signs:** After deploy, watch `unknownLines` counter in the poll-end
log — should be 0 once both sides are current.

**Reverse direction (TS newer, Python older):** Also fine. TS parser expects
an `appLines: []` return field; older Python emits zero app lines; parser
returns empty array. No app frames get published this tick. This is the
correct "empty state" behavior — box has no apps to report yet.

### Pitfall 7: Container-per-user vs. per-container registry singleton

**What goes wrong:** Assuming a single subscription-registry instance
per-user, but the container hosts multiple users, means users leak app
frames across sessions.

**Why it happens:** The registry is a factory (`createSubscriptionRegistry()`),
but the wiring in `starter.ts` creates ONE instance for the whole process.
Every WS subscriber connects to the same registry.

**How to avoid:** This is why the filter matters. The registry stays global;
the filter enforces per-user isolation at fan-out time. Do NOT try to make
the registry per-user — that breaks Phase 39's `onFirstSubscriber` /
`onLastUnsubscriber` gating of the SSH-poll orchestrator's start/stop.

**Warning signs:** Two subscribers on different userIds — one on host A they
can access, one on host B they can access. Trigger publish for host A.
Assert only the first subscriber received. This is the "combinatorial
filter test" D-21 calls for.

## Code Examples

### Line-kind dispatch extension (sweep-schema.ts)

```typescript
// Source: sweep-schema.ts:270-319 (existing parseSweepJsonl body)
// Extension: add an appLines bucket, an `app` case in the discriminator.

export interface SweepParseResult {
  identityLines: SweepIdentityLine[];
  pidLines: SweepPidLine[];
  appLines: SweepAppLine[];    // NEW
  unknownLines: number;
  schemaMismatch: boolean;
}

// In parseSweepJsonl, after the existing pid case:
} else if (rec.line_kind === "app") {
  appLines.push(parsed as SweepAppLine);
} else {
  unknownLines += 1;
}
```

### Per-host tracking set on PerHostState (ssh-poll-orchestrator.ts)

```typescript
// Source: ssh-poll-orchestrator.ts:472-483 (existing)
// Extension: sibling field for apps.

interface PerHostState {
  // ...existing fields...
  lastTickLiveTreeIdentities: Set<string>;
  lastTickLiveApps: Set<string>;     // NEW — sibling to identities set
}
```

**Recommendation on placement (Claude's discretion per CONTEXT):** New field
right below `lastTickLiveTreeIdentities`. Do NOT create a separate struct
— the field is a `Set<string>`, structurally identical to its sibling; a new
struct would add wrapper overhead with zero benefit.

### App-scoped publish method on the registry

```typescript
// Source: subscription-registry.ts:333-347 (existing publishIdentityGoneByName)
// Extension: sibling app methods.

publishAppSnapshot(hostId: string, appStates: AppState[]): void {
  for (const appState of appStates) {
    const key = `${hostId}:${appState.slug}`;
    apps.set(key, { ...appState, hostId });
  }
  // Snapshot fanout — one frame carrying every app across every visible host.
  // Filter is applied per-subscriber inside fanOut (see § Wire filter application).
  fanOut(subscribers, makeAppSnapshotFrame(Array.from(apps.values())));
}

publishAppUpdate(hostId: string, appState: AppState): void {
  const key = `${hostId}:${appState.slug}`;
  const stamped = { ...appState, hostId };
  apps.set(key, stamped);
  fanOut(subscribers, makeAppUpdateFrame(stamped));
}

publishAppGoneByHostSlug(hostId: string, slug: string): void {
  const key = `${hostId}:${slug}`;
  if (!apps.has(key)) return;    // No-op guard, matches publishSessionGone
  apps.delete(key);
  fanOut(subscribers, makeAppGoneFrame(hostId, slug));
}
```

**Note on `publishAppSnapshot`:** the identity codebase does NOT have a
sibling for this — snapshots are only emitted at subscribe time, driven by
the subscribe path reading `state.values()` (L195). For apps, the same
snapshot-on-subscribe applies. The `publishAppSnapshot` above is only useful
if you also want to expose a "here's the full current state" broadcast
externally — which shape 2 does not need. **Recommendation: skip
`publishAppSnapshot` as a public method.** Snapshot delivery lives inside
`subscribe()` reading `apps.values()`, matching the session-snapshot shape.

### Systemctl query from Python

```python
# Source: fleet-status-sweep.py:580-596 (existing tmux subprocess pattern)
# Extension: parallel shape for systemctl.

def _systemd_is_active(slug):
    """Return True iff `systemctl --user is-active` reports active for the app.

    Non-zero exit codes for is-active mean 'inactive' / 'unknown' — NOT an
    error — so we DO NOT log; we just return False.
    """
    try:
        result = subprocess.run(
            ["systemctl", "--user", "is-active", f"app-{slug}.service"],
            capture_output=True, text=True, timeout=1.5,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return result.stdout.strip() == "active"


def _systemd_show_port(slug):
    """Extract PORT= from `systemctl --user show -p Environment`. Returns int|None."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "show", "-p", "Environment",
             f"app-{slug}.service"],
            capture_output=True, text=True, timeout=1.5,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    # Output form: `Environment=HOST=127.0.0.1 PORT=9501 NODE_ENV=production ...`
    m = re.search(r"\bPORT=(\d+)\b", result.stdout)
    return int(m.group(1)) if m else None


def _systemd_unit_exists(slug):
    """Return True iff a --user unit named app-<slug>.service is registered.

    `systemctl --user cat` returns exit 0 iff the unit file exists and is
    parseable. Faster + cheaper than list-unit-files scan.
    """
    try:
        result = subprocess.run(
            ["systemctl", "--user", "cat", f"app-{slug}.service"],
            capture_output=True, text=True, timeout=1.5,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return result.returncode == 0
```

### Per-app enumeration (Python)

```python
# Sibling to _enumerate_identities (fleet-status-sweep.py:981-1058)

# Kebab-case slug pattern from create-app.sh:32
APP_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")

def _enumerate_apps(home):
    """Return list of app-dicts for ~/fleet/apps/*/. Fail-open per D-18."""
    root = os.path.join(home, "fleet", "apps")
    out = []
    try:
        with os.scandir(root) as it:
            for entry in it:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                slug = entry.name
                if not APP_SLUG_RE.match(slug) or len(slug) > 40:
                    _log("app_slug_skipped", slug=slug[:40])
                    continue
                try:
                    line = _build_app_line(slug, entry.path)
                except Exception:
                    _log("app_build_failed", slug=slug[:40],
                         err=traceback.format_exc(limit=1).strip())
                    continue
                if line is not None:  # None = filtered by D-01 checks
                    out.append(line)
    except FileNotFoundError:
        return out  # ~/fleet/apps/ does not exist — no apps (correct empty state)
    except OSError as e:
        _log("apps_scandir_failed", errno=e.errno)
    return out


def _build_app_line(slug, folder_path):
    """Assemble a SweepAppLine dict, or return None if D-01 excludes it.

    D-01 checks (all three must pass):
      (a) app.json parses
      (b) systemd unit exists
      (c) unit is active

    D-02 carve-out: if (a) + (b) pass but (c) fails, still emit with
    is_healthy=false + health_message.
    """
    # (a) app.json
    app_json_path = os.path.join(folder_path, "app.json")
    try:
        with open(app_json_path, "r", encoding="utf-8") as fh:
            metadata = json.loads(fh.read())
    except (OSError, json.JSONDecodeError):
        _log("app_json_missing_or_malformed", slug=slug[:40])
        return None

    title = metadata.get("title") if isinstance(metadata, dict) else None
    description = metadata.get("description") if isinstance(metadata, dict) else None
    if not isinstance(title, str) or not isinstance(description, str):
        _log("app_json_bad_shape", slug=slug[:40])
        return None

    # (b) systemd unit exists
    if not _systemd_unit_exists(slug):
        return None

    # (c) unit active — D-02 fallthrough
    is_healthy = _systemd_is_active(slug)
    health_message = None
    if not is_healthy:
        health_message = "not running — ask an agent to check on it"

    # Additional fields
    port = _systemd_show_port(slug)
    has_icon = os.path.exists(os.path.join(folder_path, "icon.webp"))
    try:
        folder_mtime_ms = int(os.stat(folder_path).st_mtime * 1000)
    except OSError:
        folder_mtime_ms = 0  # improbable — the scandir just succeeded

    return {
        "line_kind": "app",
        "schema_version": SCHEMA_VERSION,
        "slug": slug,
        "title": title,
        "description": description,
        "port": port,
        "has_icon": has_icon,
        "created_at_ms": folder_mtime_ms,
        "is_healthy": is_healthy,
        "health_message": health_message,
    }
```

### Filter application at fan-out (design sketch)

```typescript
// Source: subscription-registry.ts:140-154 + subscription-registry.ts:181-272
// New shape: subscribers carry their userId; fan-out consults a per-frame filter.

type SubscriberEntry = {
  send: SendFrame;
  userId: string;
};

// In createSubscriptionRegistry():
const subscribers = new Set<SubscriberEntry>();

// New per-frame filter (dep-injected from starter.ts — see § Wire filter application):
type AppFrameFilter = (
  frame: AppSnapshotFrame | AppUpdateFrame | AppGoneFrame,
  userId: string,
) => AppSnapshotFrame | AppUpdateFrame | AppGoneFrame | null;

function fanOutApp(entries: Set<SubscriberEntry>, frame: AppFrameForFilter,
                    filter: AppFrameFilter) {
  for (const entry of entries) {
    const projected = filter(frame, entry.userId);
    if (projected === null) continue;
    try { entry.send(projected); } catch (err) { /* existing warn */ }
  }
}
```

**Why the filter has to be able to REWRITE the frame, not just accept/reject:**
snapshot frames carry `states: AppState[]` — a subscriber might have access
to some hosts in the snapshot but not others. The filter must return a
`states`-projected copy of the snapshot frame, not just "yes/no drop the
whole thing." Update and gone frames are yes/no since they're per-app.

## Sources

### Primary (HIGH confidence — read verbatim this session)
- `src/backend/fleet-status/sweep-schema.ts` — full read; line-kind dispatch
  pattern, `parseSweepJsonl`, `SweepParseResult`, `SWEEP_SCHEMA_VERSION`.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — targeted reads at
  L472-483, L1390-1400, L1450-1800, L2990-3015; `PerHostState`
  reconciliation pattern, sweep-exec timeout, batch dispatch flow.
- `src/backend/fleet-status/subscription-registry.ts` — full read;
  publish + subscribe surface, `fanOut()` shape, `makeKey()`.
- `src/backend/fleet-status/wire-protocol.ts` — full read;
  `FrontendOutboundFrame` discriminated union, `FRAME_SCHEMA_VERSION`
  additive-optional invariant lineage.
- `src/backend/fleet-status/fleet-status-server.ts` — full read; WS auth,
  userId extraction, `registry.subscribe(sendFrame, { userId })` call site.
- `src/backend/ssh/host-resolver.ts:497-518` — `checkHostAccess` signature.
- `substrate/scripts/fleet-status-sweep.py` — full script read (1183 lines);
  emission structure, `_enumerate_identities` pattern, `_resolve_pid_to_tmux_session`
  subprocess pattern, `_build_identity_line` fail-open discipline.
- `substrate/skills/app-development/create-app.sh:1-80` — slug validation
  regex, unit-file install path, port-claim locking.
- `substrate/skills/app-development/templates/app-starter/app-SLUG.service.template`
  — full read; unit shape and PORT env location.
- `substrate/skills/app-development/templates/app-starter/app.json` — the
  two-field metadata card.
- `substrate/scripts/tests/fleet-status-sweep.test.sh:1-250` — existing test
  driver seam pattern.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — targeted reads
  at L200-276 (MockRegistry seam), L325-405 (makeSweepJsonl fixture),
  L411-495 (buildDeps seam), L7965-8060 (archive-routing tests).
- `src/backend/fleet-status/subscription-registry.test.ts:1-210` — describe
  block layout for publish tests.
- `src/backend/fleet-status/fleet-status-server.test.ts:110-330` — WS test
  seam pattern.
- `src/backend/distributor/catalog.ts:375-395` — sweep-script row #8;
  installPath contract; no changes needed.
- `.planning/phases/118-first-class-apps-sweep-registry-shape-2/116-CONTEXT.md`
  — the D-01..D-23 spec, authoritative.
- Git commit `67b4a7ef` diff (verbatim) — Phase 115 reconciliation pattern.

### Secondary (MEDIUM confidence)
- `grep -rn "checkHostAccess" src/backend/` — confirmed exactly one call
  site (in `host-resolver.ts` itself as the export). No callers under
  `src/backend/fleet-status/`. This drove the § "Wire filter application"
  finding that identity frames are not filtered today.

### Tertiary (LOW confidence)
- None. Every claim in this document is backed by a verbatim read of the
  source file or the CONTEXT.md spec.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; extending existing wiring
  verified verbatim.
- Architecture: HIGH — extension shapes mirror existing shapes read this
  session. Every "add a sibling" recommendation is grounded in an existing
  sibling.
- Pitfalls: HIGH — reconciliation-on-success gate, health-flip discipline,
  and JSONL parser lenience are all in the code being extended. Filter
  layering is derived from first principles because the identity codebase
  has not implemented a filter yet, but the pattern is standard.

**Research date:** 2026-09-18
**Valid until:** 2026-10-18 (30 days — fleet-status subsystem is stable
enough that this research window is safe; the load-bearing files change
1-2× per week for behavior tweaks but not for structural refactors).

---

# Answers to the ten planner questions (indexed)

The planner asked ten specific questions. Below is the direct answer for each,
with load-bearing details up front and pointers to the sections above for
implementation shape.

## Q1 — JSONL line-type discrimination and extension shape

**Discriminator:** Explicit `line_kind` string field on every line, paired
with `schema_version: 1`. Parser dispatches on `line_kind` in a plain
`if/else` chain (`sweep-schema.ts:307-315`). Unknown `line_kind` values are
counted in `unknownLines` (forward-compat) but NOT treated as an error.

**Type-guard:** `isSweepLineOfCurrentSchema` (L223-228) checks both
`schema_version === 1` AND `line_kind ∈ {identity, pid}`.

**Extension recipe:**
1. Add `SweepAppLine` interface with `line_kind: "app"` literal (see § Pattern 1).
2. Widen the `SweepLine` union type: `SweepIdentityLine | SweepPidLine | SweepAppLine`.
3. Widen `isSweepLineOfCurrentSchema` — add `|| rec.line_kind === "app"`.
4. Extend `SweepParseResult` with `appLines: SweepAppLine[]`.
5. Add `const appLines: SweepAppLine[] = []` in `parseSweepJsonl` local scope.
6. Add `else if (rec.line_kind === "app") appLines.push(...)` after the pid case.
7. Return `appLines` in the result object.
8. Update `SWEEP_FIELD_PARITY` — optional, but consistent — add entries C0-C7
   covering the seven app fields with `field: "..."` values.

**Byte-for-byte parity discipline:** Python side must emit field names
verbatim matching TS. Take extra care: TS uses camelCase in most places but
the sweep wire uses `snake_case` (see `layer1_recycling`, `session_json`,
`per_session_stop_payload`). Follow the wire convention:
`is_healthy`, `health_message`, `has_icon`, `created_at_ms`.

## Q2 — PerHostState extension shape

**Location:** `ssh-poll-orchestrator.ts:472-483` (the existing
`lastTickLiveTreeIdentities` field on the `PerHostState` interface),
initialized at `:3004-3008` inside the per-host handler that creates the
state object.

**Recommendation:** Add a **sibling field** on the same interface, not a
new sibling struct. Rationale — `lastTickLiveTreeIdentities` is a bare
`Set<string>`; the app tracking set has the same shape (`Set<string>`);
introducing a new struct wraps two `Set<string>` in an object with no
behavioral benefit. Keeping them as siblings preserves the "one struct per
host, all state colocated" pattern.

**Exact diff shape:**
```typescript
// ssh-poll-orchestrator.ts:472-483 (existing)
interface PerHostState {
  // ...existing...
  lastTickLiveTreeIdentities: Set<string>;

  // NEW (Phase 118, D-11): mirror of the identity tracking set for apps.
  // Populated at the end of each successful sweep tick with all slugs that
  // passed D-01 (three-check inclusion) or D-02 (unhealthy carve-out).
  // Diff'd against previous tick on next success to fire publishAppGoneByHostSlug
  // for silent removals. NEVER updated on {ok:false} sweep paths.
  lastTickLiveApps: Set<string>;
}

// ssh-poll-orchestrator.ts:3004-3008 (existing initialization)
lastTickLiveTreeIdentities: new Set<string>(),
lastTickLiveApps: new Set<string>(),   // NEW — same initialization discipline
```

## Q3 — Subscription-registry publish surface

**Verbatim source of the identity-scoped gone method (subscription-registry.ts:333-347):**

```typescript
publishIdentityGoneByName(hostId: string, identityName: string): void {
  // Source-B publishes with tmuxSession = identityName, so the cache key
  // for a dormant identity composes as makeKey(hostId, identityName).
  // Look up the entry to extract its sessionId for the gone-frame fanout.
  const key = makeKey(hostId, identityName);
  const existing = state.get(key);
  if (existing === undefined) {
    return;
  }
  state.delete(key);
  fanOut(
    subscribers,
    makeGoneFrame(hostId, existing.tmuxSession, existing.sessionId),
  );
},
```

**Verbatim source of the snapshot-on-subscribe path (subscription-registry.ts:181-231):**

```typescript
subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void {
  const wasEmpty = subscribers.size === 0;
  subscribers.add(sendFrame);

  const snapshot = makeSnapshotFrame(
    Array.from(state.values()).map((s) => ({
      ...s,
      contextPct: getContextPct(s.hostId, s.tmuxSession ?? "") ?? null,
    })),
  );
  try {
    sendFrame(snapshot);
  } catch (err) { /* warn */ }

  for (const entry of archivedIdentities.values()) {
    try {
      sendFrame(makeIdentityArchivedFrame(entry.name, entry.hostId, entry.hostname));
    } catch (err) { /* warn */ }
  }

  if (wasEmpty && ctx) {
    for (const cb of firstSubCallbacks) { try { cb(ctx); } catch { /* warn */ } }
  }
  // ...disposer returned...
}
```

**Recommended app-side signatures (mirror shape):**

```typescript
// Interface additions in SubscriptionRegistry:
publishAppUpdate(hostId: string, appState: AppState): void;
publishAppGoneByHostSlug(hostId: string, slug: string): void;
// getAppSnapshot exposed for symmetry with getSnapshot; optional per shape 2:
getAppSnapshot(): AppState[];
```

**Do NOT add a `publishAppSnapshot` public method.** Snapshot delivery lives
inside the subscribe path, matching the session-snapshot shape. The compose+
publish loop in `pollOneHostBatch` calls `publishAppUpdate` for each app on
each successful tick; that populates the map. A new subscriber gets the
current map contents inside `subscribe()`.

**Key format:** `` `${hostId}:${slug}` `` — mirrors `makeKey(hostId,
tmuxSession)` at L136-138. Introduce `makeAppKey(hostId, slug)` if you want
symmetry, or inline the template literal — either is fine (Claude's discretion
per CONTEXT).

## Q4 — Wire filter application

**Critical finding:** There is currently **no per-user host-visibility filter
applied to fleet-status frames**. `grep -rn "checkHostAccess" src/backend/`
returns exactly one hit — the export site in `host-resolver.ts`. No callers
under `src/backend/fleet-status/`. Every subscriber to `/fleet-status/ws`
today receives every host's frames.

The CONTEXT D-15 phrasing "same shape identity frames are (or will be)
filtered" is telling — Ashley left the door open because it's a known gap.
Phase 118 is where the first filter lands. Do not look for an existing
identity filter to copy — there isn't one.

**Recommendation — apply the filter at the fan-out layer inside the registry:**

1. Change `subscribers: Set<SendFrame>` in `subscription-registry.ts` to
   `Set<SubscriberEntry>` where `SubscriberEntry = { send: SendFrame; userId: string }`.
   Backward-compat: keep the `subscribe(sendFrame, ctx?)` signature; when
   ctx is present, store `{send, userId: ctx.userId}`; when ctx absent, do
   NOT filter (backward-compat with any test/harness that calls without ctx).
2. Inject an async per-frame filter callback from `starter.ts` when creating
   the registry:
   ```typescript
   const registry = createSubscriptionRegistry({
     appFrameFilter: async (frame, userId) => filterAppFrame(frame, userId),
   });
   ```
   where `filterAppFrame` uses `checkHostAccess(host.id, userId, host.userId, "read")`
   plus a lightweight per-user host-id LRU cache (the check hits the
   PermissionManager which may hit SQLite — cache 30-60s).
3. Split `fanOut` into `fanOutSync` (existing session frames, no filter for
   now) and `fanOutAppFilteredAsync` (new). The async fanout awaits the filter
   per subscriber; a slow filter for one subscriber does not block others
   (use `Promise.allSettled`).
4. Apply the same filter at snapshot-on-subscribe time — the snapshot frame's
   `states: AppState[]` is projected through the filter to leave only the
   apps for hosts this user can see.

**Async filter is unavoidable:** `checkHostAccess` is async (`Promise<boolean>`).
Existing `fanOut` is sync. This is a deliberate widening — the plan should
carry a note that any test now needs `await` around fanout calls or must
poll for the frame arrival.

**Alternative (simpler but coarser):** Apply the filter at the WS server
layer (`fleet-status-server.ts` `handleFrontendConnection`) by wrapping the
`sendFrame` callback with a per-subscriber filter that runs on every outbound
frame. Pro: registry stays sync. Con: filter code is co-located with WS
plumbing, harder to unit-test in isolation; and it applies to EVERY outbound
frame kind (session, archived-identity, pong) even though shape 2 only needs
app filtering. **Recommend the registry-layer filter** because it correctly
scopes what gets filtered (only app frames) and makes the per-user filter a
first-class registry concern that identity frames can adopt cleanly later
(D-15's "or will be").

## Q5 — Python sweep script current shape

**Structure:** One `main()` (L1086-1168) that orchestrates:
1. `_enumerate_identities(home)` — walks BOTH `~/fleet/identities/` and
   `~/fleet/identities-archive/`; returns list of dicts with sentinel booleans.
2. `_enumerate_pids(home)` — globs `~/.claude/sessions/*.json`; returns
   `(pid, path)` tuples.
3. Per-PID: `_resolve_pid_to_tmux_session(pid)` folds PID → tmux session
   name (uses `subprocess.run(["tmux", "display-message", ...])` with
   `TMUX_TIMEOUT_SEC = 1.5`).
4. Per-identity: `_build_identity_line(...)` → emit via `_emit(record)` which
   writes `json.dumps(record, separators=(",", ":")) + "\n"` to stdout.
5. Per-live-PID: `_build_pid_line(...)` → same `_emit`.

**Emit pattern:** `_emit()` at L1080-1083 is a two-line function; every
emission is a single JSON object per line, compact-serialized, terminated
with `\n`. `sys.stdout.flush()` at end of main.

**Timeout budget:** The orchestrator wraps the sweep exec in `Promise.race`
against `SWEEP_EXEC_TIMEOUT_MS = 8000` (`ssh-poll-orchestrator.ts:1400`).
Not the CONTEXT's assumed 5s — it's 8s. Still plenty of headroom for
per-app work at Ashley's ~0-10 apps. The internal `TMUX_TIMEOUT_SEC = 1.5`
(L164) is the precedent for per-subprocess timeouts.

**Enumeration API:** `os.scandir()` in `_enumerate_identities` (L1019) —
prefer this over `os.listdir()` for the app enumeration too; scandir returns
`DirEntry` objects that carry cheap `is_dir()` + `stat()` without extra
syscalls.

**Where the source-C code lands (recommendation):**

- Add module-level constants near L114-165:
  - `APP_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")` (from `create-app.sh:32`)
  - `APP_SUBPROCESS_TIMEOUT_SEC = 1.5` (mirror `TMUX_TIMEOUT_SEC`)
- Add helper functions in the "Section — helper" block (around L510-812):
  - `_systemd_is_active(slug)`, `_systemd_show_port(slug)`,
    `_systemd_unit_exists(slug)` — three thin subprocess wrappers.
- Add `_enumerate_apps(home)` sibling to `_enumerate_identities` (after L1058).
- Add `_build_app_line(slug, folder_path)` sibling to `_build_identity_line`
  (after `_build_pid_line`, around L974).
- Extend `main()` (L1086-1168):
  - Add `app_records = _enumerate_apps(home)` after the pid enumeration.
  - Add a `for` loop emitting `app_records` right after the pid emit loop
    (order doesn't matter for the wire, but keeping the loop last groups
    the newest addition visually).

## Q6 — Systemd query mechanics

**Precedent for `--user` invocations in the substrate:**
- `bootstrap.sh:82` — `systemctl --user daemon-reload`
- `archive-app.sh:53` — `systemctl --user list-unit-files | grep -q "^app-$SLUG.service"`
- `create-app.sh:211` — `systemctl --user is-active --quiet "app-$SLUG.service"`

**Recommended commands for the sweep** (all `subprocess.run([...], timeout=1.5)`
form, no shell=True — matches the tmux precedent):

| Purpose | Command | Rationale |
|---------|---------|-----------|
| Unit exists (D-01 check b) | `systemctl --user cat app-<slug>.service` | Exit 0 iff the unit file is registered and parses. Cheaper than a full `list-unit-files` scan; output can be discarded. |
| Unit active (D-01 check c) | `systemctl --user is-active app-<slug>.service` | Exit 0 iff active; stdout is `active` / `inactive` / `failed` / etc. Standard, cheap, dedicated for this purpose. |
| Extract PORT (D-07) | `systemctl --user show -p Environment app-<slug>.service` | Returns the effective merged env line. `Environment=` shell-splittable KV pairs. Parse with regex `\bPORT=(\d+)\b`. |

**Timeout budget analysis:** At most three systemctl calls per app × 1.5s
timeout × ~10 apps worst case = 45s worst case IF every call times out.
Realistic per-call latency is <10ms (systemd IPC). Even a 10× slowdown
still lands well inside the 8s exec budget. **Do NOT parallelize** these
inside the Python script — systemd IPC is fast enough that sequential is
fine, and parallelism adds threading complexity for zero real gain.

**Alternative one-shot** — `systemctl --user show app-<slug>.service` returns
ActiveState + LoadState + Environment in one call. **Recommend this
consolidation:** one subprocess per app instead of three. Parse:
- `LoadState=loaded` → unit exists (D-01 check b passes)
- `ActiveState=active` → unit is active (D-01 check c passes)
- `Environment=HOST=... PORT=<n> ...` → extract PORT

Reduces to one subprocess call per app. Only downside: slightly more output
to parse. Given the small scale (Ashley's ~10 apps ceiling per box), either
approach is fine — one-shot is more elegant.

## Q7 — Test seams

**Test-file layout:** Sibling files in `src/backend/fleet-status/` matching
the source files — `*.test.ts` next to `*.ts`. Vitest. `ssh-poll-orchestrator.test.ts`
is 8976 lines and holds every batch-path and legacy-path test.

**MockRegistry seam (ssh-poll-orchestrator.test.ts:205-276):** Fake registry
class implementing `SubscriptionRegistry`, capturing every publish call into
public arrays (`publishedStates`, `publishedGone`, `publishedArchived`). To
add app-reconciliation tests:

1. Extend `MockRegistry` with `publishedAppUpdates: [...]`, `publishedAppGone: [...]`,
   and stub methods that push into these arrays.
2. Extend `SubscriptionRegistry` interface with the new methods so
   TypeScript enforces the MockRegistry stays in sync (this is exactly how
   `publishIdentityGoneByName` landed — see L253-259 comment).

**makeSweepJsonl fixture (L339-405):** Extend with an `apps: Array<Partial<SweepAppLine> & {slug: string}>` parameter and emit `line_kind: "app"` lines
alongside identity + pid lines. Follow the `...(raw.foo !== undefined ? {foo: raw.foo} : {})` pattern for optional fields so old test fixtures without `apps` still work.

**buildDeps helper (L411-495):** Add a `channel.setResponse` for the sweep
command that returns app-inclusive fixtures. Existing default sweep response
is already there via `wireBatchProbe`.

**Phase 115 hotfix test pattern (L7965-8060):** The "Test P115-06 archive-
routing-N" cases are the exact template for reconciliation tests. Each test
wires the batch probe, sets a specific sweep response, starts the
orchestrator, awaits one tick, and asserts on `deps.registry.publishedXxx`
arrays. For app-reconciliation:

- **Test A1 — first sweep publishes updates for each app; NO gone calls:** Emit two apps on the first tick, assert two `publishAppUpdate`, zero `publishAppGoneByHostSlug`.
- **Test A2 — second sweep with one app missing publishes exactly one gone:** Tick 1 emits {a, b}; tick 2 emits {a}. Assert exactly one gone for b, zero unexpected updates for a.
- **Test A3 — sweep failure between two success ticks does NOT flap:** Tick 1 emits {a}; tick 2 fails (null exec); tick 3 emits {a}. Assert ZERO gone calls across the whole sequence.
- **Test A4 — health flip is an update, not gone+update:** Tick 1 emits {a, is_healthy: true}; tick 2 emits {a, is_healthy: false}. Assert one update on tick 2, ZERO gone.
- **Test A5 — schema mismatch on app lines triggers batch fallback:** Emit an app line with `schema_version: 999`. Assert `sweepSchemaMismatchThisConnection` flag, batch path abandoned.

**Python sweep script tests:** `substrate/scripts/tests/fleet-status-sweep.test.sh`
is the existing driver. It builds a hermetic `$FIXTURE` scratch tree with
`HOME=$FIXTURE` and runs the real Python script. **Recommendation: add a
sibling file `fleet-status-sweep-apps.test.sh`** (matching the
`fleet-status-sweep-appearance.sh` precedent) with test cases:

- Case 1: `~/fleet/apps/good/` with valid `app.json` + a real user-unit → line emitted with all seven fields.
- Case 2: `~/fleet/apps/malformed/` with invalid JSON → NO line, stderr contains `app_json_malformed`, other apps unaffected.
- Case 3: `~/fleet/apps/no-unit/` with valid `app.json` but no systemd unit → NO line.
- Case 4: `~/fleet/apps/stopped/` with valid `app.json` + registered but inactive unit → line emitted with `is_healthy: false`, `health_message` present.
- Case 5: `~/fleet/apps/no-icon/` — line emitted with `has_icon: false`.
- Case 6: `~/fleet/apps/with-icon/` — line emitted with `has_icon: true`.

**Caveat:** the systemd cases (3-4) will need a real systemd `--user`
session to be present in the test environment. On this box (t1000) that's
fine. In CI (which doesn't have a user session), those test cases must be
gated on `test -S /run/systemd/private || skip` or the equivalent
availability check — matches the CONTEXT D-23 "agent-side UAT, NOT
CI-runnable" note.

**Subscription-registry tests (subscription-registry.test.ts):** Follows
the same `describe("subscription-registry", () => { it("Test N: ...") })`
pattern. Add tests:
- publishAppUpdate inserts into map + fans out `app-update` frame.
- publishAppGoneByHostSlug removes from map + fans out `app-gone` frame.
- Late subscriber gets app-snapshot frame containing all previously
  published apps.
- publishAppGoneByHostSlug for a missing key is a no-op.

## Q8 — `app.json` parse discipline

**Precedent from `_build_identity_line` (fleet-status-sweep.py:850-862):**
The identity frontmatter read is wrapped in `try/except OSError` explicitly to
guarantee the identity line still emits with null cosmetics — the "membership
must never depend on appearance reads succeeding" (T-111-04) discipline.

**For app.json (which is D-01 check (a) — a MEMBERSHIP-gating read, not an
appearance-decoration read):** Different discipline applies. Failed parse
means this app is NOT in the picture; the line is NOT emitted; other apps
continue.

**Recommended shape:**
```python
def _build_app_line(slug, folder_path):
    app_json_path = os.path.join(folder_path, "app.json")
    try:
        with open(app_json_path, "r", encoding="utf-8") as fh:
            metadata = json.loads(fh.read())
    except (OSError, json.JSONDecodeError):
        _log("app_json_missing_or_malformed", slug=slug[:40])
        return None  # <-- membership gate: this app is NOT in the picture

    # Shape validation — title + description must both be strings
    if not isinstance(metadata, dict):
        _log("app_json_not_object", slug=slug[:40])
        return None
    title = metadata.get("title")
    description = metadata.get("description")
    if not isinstance(title, str) or not isinstance(description, str):
        _log("app_json_bad_shape", slug=slug[:40])
        return None

    # ...proceed with D-01 checks (b) and (c)...
```

**Belt-and-braces at `_enumerate_apps` level:** Wrap the whole
`_build_app_line` call in a per-app `try/except Exception` so any unexpected
error (e.g., an OSError from stat on a folder that vanished mid-scan)
kills only that one app, not the whole sweep. This mirrors the outer
try/except discipline the caller of `_enumerate_identities` implicitly gets
via the top-level `except` in `main()`.

**Log key stability:** Use `_log("app_json_malformed", slug=slug[:40])` etc.
The 40-char clamp mirrors identity-name logging elsewhere in the script and
prevents log-injection from a hostile folder name.

## Q9 — Known gotchas and landmines

**SessionState map key format:** `makeKey(hostId, tmuxSession)` at L136-138 is
`` `${hostId}:${tmuxSession ?? ""}` ``. Note the empty-string fallback for
null tmuxSession — a legacy of `session_state` frames that may arrive
without a tmuxSession. For apps, `slug` is never null, so the app map key
`` `${hostId}:${slug}` `` has no such fallback. Do NOT accidentally reuse
`makeKey` for apps — slugs and tmuxSessions can theoretically collide
inside the same map, breaking the invariant that a key uniquely identifies
a session. Use a separate `Map` and a separate `makeAppKey` (or inline the
template literal).

**JSONL wire contract stability during hot-reload deploys:** Covered in
Pitfall 6. The lenient parser handles Python-newer-than-TS gracefully
(unknown line kinds counted, not errors). TS-newer-than-Python is also fine
(app lines just missing this tick).

**Global state / singleton in the fleet-status server:** The registry is a
factory (`createSubscriptionRegistry`) — but `starter.ts` creates ONE
instance for the whole container process. Every subscriber connects to the
same registry. Phase 118's app map is added to this same instance and
serves every subscriber. Combined with the filter (Q4), this is correct.
Do NOT try to make the registry per-user — that breaks Phase 39's
`onFirstSubscriber` gating.

**Sweep exec timeout is 8000ms, not the CONTEXT's assumed 5000ms.** Verified
at `ssh-poll-orchestrator.ts:1400`. Comfortable budget for D-19.

**MockRegistry pattern gap:** The existing MockRegistry `publishIdentityGoneByName`
(L253-259) puts `sessionId: ""` in the captured record because the mock
doesn't hold a state map. When adding `publishAppGoneByHostSlug` to the
mock, capture `{ hostId, slug }` directly — no need to shoe-horn into the
existing `publishedGone` array which is keyed for session frames.

**Frontmatter frontmatter cap surprise:** `FRONTMATTER_HEAD_BYTES = 4096`
(L146) caps identity/role file reads. `app.json` files are tiny — the cap
does not apply. But if a future contributor extends the sweep to read a
new large file per app, watch for this pattern. Not relevant to Phase 118.

**`create-app.sh` port-claim under lock:** Ports 9501-9599 are picked under
`~/fleet/.create-lock` exclusive flock. Two agents cannot claim the same
port. Phase 118 does not participate in this flock — it observes only.
If a create-app is mid-flight during a sweep tick, the sweep might see a
partial state (folder exists but unit not yet enabled). D-01 check (c)
(`is-active`) will fail cleanly and the app is excluded from that tick;
next tick sees the finished state. This is the fail-open discipline.

**Test fixture systemd availability:** The Python sweep tests need a real
`systemd --user` session to exercise the D-01 (b)+(c) branches. On t1000
that's fine. Vitest tests can mock the sweep JSONL entirely and never touch
systemd — the mocking happens at the JSONL boundary in
`channel.setResponse(SWEEP_CMD, ...)`. Only the Python .test.sh cases hit
real systemd, and those are the D-23 agent-UAT category — not CI.

**"container-mutation serialization" (Ashley 2026-09-12):** Applies to the
deploy motion only. Planning + executor phases are unaffected. Executor
does not push, build, or deploy. Include one plan step noting the
distributor push flow: "commit + push triggers the standard build; the
distributor's next sweep pushes the new fleet-status-sweep.py to every
managed box; the next Skynet pod restart picks up the new TS parser."

## Q10 — Concrete plan breakdown recommendation

**Recommended: 5 plans, one wave each (all sequential — each depends on the previous):**

**Plan 118-01: Python sweep — source C enumeration + emitter**
- Modifies: `substrate/scripts/fleet-status-sweep.py`
- Scope: `_systemd_*` helpers, `_enumerate_apps`, `_build_app_line`,
  extend `main()` to emit app lines.
- Adds: `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` — the
  hermetic shell test driver with 6+ cases from Q7.
- Verification: run the .test.sh; unit lifecycle covered by fixture create + systemctl.
- Deps: None (leaf work).

**Plan 118-02: TS wire schema — SweepAppLine + parser dispatch**
- Modifies: `src/backend/fleet-status/sweep-schema.ts`
- Adds: `SweepAppLine` interface, `appLines` on `SweepParseResult`, `app`
  case in `parseSweepJsonl`, widened `isSweepLineOfCurrentSchema`,
  `SWEEP_FIELD_PARITY` C0-C7 entries.
- Modifies: `src/backend/fleet-status/sweep-schema.test.ts` — extends
  round-trip + parity tests.
- Deps: 118-01 (needs the Python emission shape locked to derive the TS types).
  Note: they can be built in parallel because both sides derive from the
  D-05 field list in CONTEXT; but tests only meaningfully run after both
  land, so orchestrator sequences them.

**Plan 118-03: Wire protocol + subscription-registry app methods**
- Modifies: `src/backend/fleet-status/wire-protocol.ts`
- Adds: `AppStateSchema`, `AppSnapshotFrame`, `AppUpdateFrame`, `AppGoneFrame`
  + factories (`makeAppSnapshotFrame`, etc.) + append to the discriminated union.
- Modifies: `src/backend/fleet-status/subscription-registry.ts`
- Adds: `apps: Map<hostId:slug, AppState>` sibling, `publishAppUpdate`,
  `publishAppGoneByHostSlug`, `getAppSnapshot`, and — critically — extends
  `subscribe()` to emit app snapshot on subscribe.
- Modifies: `src/backend/fleet-status/wire-protocol.test.ts` +
  `src/backend/fleet-status/subscription-registry.test.ts`
- Deps: 118-02 (`AppState` shape derives from `SweepAppLine`).

**Plan 118-04: Orchestrator adapter + per-host reconciliation**
- Modifies: `src/backend/fleet-status/ssh-poll-orchestrator.ts`
- Adds: `lastTickLiveApps: Set<string>` field on `PerHostState`, empty-set
  init in the per-host state creation block, adapter loop over
  `parsed.appLines` in `pollOneHostBatch` calling `publishAppUpdate`, and
  the reconciliation block mirroring the identity reconciliation at L1770.
- Modifies: `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` —
  extends `MockRegistry` with the two new methods, `makeSweepJsonl` with
  `apps` param, adds 5+ reconciliation tests (Q7 A1-A5).
- Deps: 118-02 (needs `parseSweepJsonl` returning `appLines`), 118-03
  (needs `publishAppUpdate` / `publishAppGoneByHostSlug` on the registry).

**Plan 118-05: Wire filter — per-user host-visibility on app frames**
- Modifies: `src/backend/fleet-status/subscription-registry.ts` — widen
  `subscribers` to carry userId, add `appFrameFilter` factory option,
  route `publishApp*` fanouts through the async filter.
- Modifies: `src/backend/fleet-status/fleet-status-server.ts` — pass a
  `filterAppFrame` from starter's registry factory call site (starter.ts —
  no changes needed there beyond wiring the factory option).
- New helper: `src/backend/fleet-status/app-frame-filter.ts` — composes
  `checkHostAccess` per subscriber+host with a small TTL cache.
- Modifies: `src/backend/fleet-status/fleet-status-server.test.ts` +
  `src/backend/fleet-status/subscription-registry.test.ts` — combinatorial
  filter tests (two subscribers, two hosts, access matrix).
- Deps: 118-03 (needs the app methods to filter), 118-04 (needs the
  publish calls in flight to exercise). Test-wise the filter needs both
  publish sides live.

**Why 5 not 4 or 6:** Bundling 118-03 and 118-04 into one plan is tempting
but the two files can be planned independently (schema + registry surface
first; adapter after). Splitting the filter into its own plan (118-05) is
important because it's the highest-risk piece — greenfield in this
codebase, introduces async fanout — and deserves its own review + test
matrix. Splitting the Python (118-01) from the TS wire (118-02) is
important for verification independence.

**Wave structure:** All plans are single-wave. There is no natural
subdivision inside any of these plans that benefits from parallel waves.

**Ordering enforcement in the plans:** State the dep chain explicitly at
the top of each plan. Sequential landing order is 118-01 → 118-02 → 118-03
→ 118-04 → 118-05. The orchestrator's normal phase execution handles this
without special config.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ashley's fleet has 0-10 apps per box ceiling for the foreseeable future | Q6 timeout analysis | Higher app count could push the sweep past its 8s budget. Mitigation: the per-app subprocess count is 1 (with the one-shot `systemctl show` consolidation), so ~100 apps × 10ms = 1s of systemctl work. Safe well beyond ~10. |
| A2 | `systemctl --user show` reliably returns `Environment=` on a running unit | Q6 recommendation | If some units don't have `Environment=` in `show` output (very rare — units WITHOUT `Environment=` directives), port comes back None. D-05 spec allows `port: number \| null`; the frontend/shape 3 handles missing port. |
| A3 | The filter can go through Promise.allSettled fan-out without measurable UI latency | Q4 async filter | If checkHostAccess is slow (SQLite hit + user session lookup), fan-out could visibly delay frames. Mitigation: LRU cache in `filterAppFrame` (30s TTL keyed on user+host); PermissionManager likely has its own cache too. Verify at execute time. |
| A4 | Test cases 1-6 in Q7 can run on t1000 with real systemd --user | Q7 test seams | If CI ever tries to run these, they'll fail. Mitigation: gate the shell tests on a systemd-availability check (documented in CONTEXT D-23 as "agent-UAT, not CI"). |
| A5 | The `create-app.sh` slug regex `^[a-z][a-z0-9-]*$` (max 40 chars) is the canonical slug shape | multiple sections | If shape 1 later relaxes the slug rules, the sweep's `APP_SLUG_RE` needs to widen in lockstep. Currently they're independent — a small copy-paste. Consider extracting a shared regex file if this becomes a maintenance burden. Not in scope for shape 2. |

## Open Questions

1. **`app.json` shape drift.** Today the file has exactly two fields (title +
   description). If shape 1 adds a third (e.g. `category`), does shape 2
   passthrough it? — Recommendation: emit only the D-05-enumerated fields
   for now. When a new `app.json` field lands, it's a coordinated schema
   bump. Do NOT do generic passthrough — that would silently leak whatever
   any agent puts in the file.

2. **Filter LRU cache TTL.** How long can a per-user host-access answer be
   cached? Longer = fewer PermissionManager hits = less latency; shorter =
   faster propagation when a user is granted/revoked access. — Recommend
   30s TTL; PermissionManager may already have its own cache; verify at
   execute time.

3. **Reconciliation for the very first tick after Skynet restart.** The
   `lastTickLiveApps: new Set<string>()` initialization at
   `PerHostState` creation means the first successful sweep publishes NO
   gone calls (nothing to diff against). If a user is subscribed at that
   moment, they see an empty snapshot briefly then get updates. This is
   the same behavior as identities and is correct — but shape 3 UAT should
   verify no visible flap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.6+ | fleet-status-sweep.py | ✓ | 3.10+ on managed boxes | — (stdlib-only script; no venv needed) |
| systemctl (--user) | New `_systemd_*` helpers in the sweep | ✓ on managed boxes | systemd 245+ | If missing, `_systemd_*` helpers return False/None → apps excluded (D-01 fails). Fail-open. |
| Node/TypeScript build toolchain (tsc, vitest) | Skynet backend build + tests | ✓ | Existing | — |
| Bash 4+ | Python sweep test driver (.test.sh) | ✓ on t1000, CI | 5+ | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** systemctl absence is fail-open by
design — no apps get emitted on a box without systemd. Correct behavior
for a fleet box that shouldn't run apps.

## Security Domain

Phase 118 is a read-only observation layer over disk state. No secrets, no
new HTTP endpoints, no new authentication surface. The one security-relevant
addition is the per-user filter (Q4), which adopts an existing authoritative
function (`checkHostAccess`) rather than introducing a new authorization
model.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Existing WS auth (JWT via cookie/Bearer) unchanged. |
| V3 Session Management | no | Existing WS session lifecycle unchanged. |
| V4 Access Control | **yes** | `checkHostAccess(hostIdNum, userId, hostUserId, "read")` — single authority; app frames MUST be filtered through this function per subscriber. Do NOT invent a per-app permission model. |
| V5 Input Validation | **yes** | `SweepAppLine` fields validated via the existing `parseSweepJsonl` lenient parser + `z.object` schema on `AppSnapshotFrame` etc. Slug field re-validated on Python side against `APP_SLUG_RE` before path construction (defense-in-depth against path traversal, mirroring the `SAFE_NAME_RE` pattern for identities). |
| V6 Cryptography | no | No new crypto. |
| V12 File Handling | **yes** | `_build_app_line` reads `app.json` from disk. Path construction uses `os.path.join(folder_path, "app.json")` where `folder_path` came from `os.scandir`; no user-controlled path input. Slug regex + length cap gates prevent hostile folder names from reaching path construction. |

### Known Threat Patterns for the fleet-status subsystem

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slug injection (hostile folder name → arbitrary systemctl arg) | Tampering | `APP_SLUG_RE` regex + 40-char cap BEFORE any subprocess call. Slug becomes the arg to `["systemctl", "--user", "cat", f"app-{slug}.service"]` — argv form eliminates shell metachar risk, and the regex eliminates argv-level injection risk. |
| Cross-user app visibility leak | Information Disclosure | Per-frame filter at fan-out layer via `checkHostAccess`. All three app frame kinds (snapshot / update / gone) MUST go through the filter. |
| Rogue app.json emitting hostile strings into wire | Tampering, Information Disclosure | Zod schema validates AppState shape on ingest; `title` and `description` are STRING-typed but not further sanitized — the FRONTEND (shape 3, out of scope for shape 2) is responsible for HTML-escaping when rendering. Document this handoff clearly so shape 3 does not assume backend sanitization. |
| PORT env injection | Tampering | Regex extraction `\bPORT=(\d+)\b` yields only digits; parsed via `int(...)`. A hostile unit file with `PORT=$(rm -rf ~)` would just fail the regex and yield `port: null`. |

---

*Phase: 118-first-class-apps-sweep-registry-shape-2*
*Research complete: 2026-09-18*
