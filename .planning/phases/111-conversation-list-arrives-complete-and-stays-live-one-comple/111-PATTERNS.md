# Phase 111: Conversation list arrives complete and stays live — Pattern Map

**Mapped:** 2026-09-16
**Files analyzed:** 11 modified + 1 optional new + 8 test files
**Analogs found:** 11 / 12 (one genuinely-new seam: row create/remove from the live channel — best partial analog documented)

**Reading rule for this document:** every excerpt is quoted from source read this session. Line
numbers pair with a symbol name or a quoted string because this is an active tree — grep the symbol
if a number has drifted. `read_first` entries in plans should cite **file + symbol + line**, not
line alone.

**The single most valuable finding for this phase:** Phase 62's `activityMtime` + `stoppedMtime`
addition (commits `1a8b9d4e` RED → `02226aac` GREEN wire, `89cac8ac` RED → `0b586bfd` GREEN
orchestrator) is a *field-for-field, site-for-site* precedent for item 2 — a new optional
`SessionState` field that had to touch the schema, the block-comment lineage, the cache entry
interface, the fingerprint template literal, **and both cache-write branches**. Its commit message
enumerates the exact seven sites. Phase 90's `contextPct` (`3014d8f0`) is the second precedent and
covers the type-mirror + registry-restamp half that Phase 62 does not. **Plan 2 should be written
by reading these two diffs.**

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `substrate/scripts/fleet-status-sweep.py` | host-side emitter (Python) | file-I/O + batch | `substrate/scripts/ambient-monitor.py` `_read_frontmatter` `:240-281` (parser) + the script's own `_enumerate_identities` `:783-816` (call site) | exact (two analogs, one per concern) |
| `src/backend/fleet-status/sweep-schema.ts` | wire contract / type + parser | transform | its own `SweepIdentityLine` `:79-88` + `SWEEP_FIELD_PARITY` `:286-356` | exact (self-extension) |
| `src/backend/fleet-status/wire-protocol.ts` | model / zod schema | pub-sub | Phase 62 `activityMtime`/`stoppedMtime` (`:379-382` + block `:236-273`); Phase 90 `contextPct` (`:383-388` + block `:275-316`) | **exact** |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | service / poll orchestrator | batch + publish-gate | Phase 62 diff `0b586bfd` — same 7 sites: cache iface, fingerprint, both cache branches | **exact** |
| `src/backend/fleet-status/subscription-registry.ts` | registry / fanout | pub-sub | Phase 90 `contextPct` re-stamp at all three read paths (`:141-151`, `:203-219`, `:240-248`) | exact — **but see § Do NOT Copy** |
| `src/ui/api/fleet-status-types.ts` | type mirror (hand-maintained) | — | `contextPct?: number \| null` `:216-230` | exact |
| `src/ui/api/fleet-status-client.ts` | transport client | event-driven | reconnect: its own `onclose` ladder `:197-236`; visibility: `console-forwarder.ts:209-214` (non-React) + `PrettyView.tsx:2970-3001` (guard set) | exact (two analogs, one per concern) |
| `src/ui/state/identities-store.ts` (**new** `mergeIdentityAppearance`) | store / narrow mutator | event-driven merge | `patchIdentityFlag` `:426-448` (shape + idempotence) ⚠ + `session-working-store.ts` `advanceSessionAiTitle` `:870-906` (**the additive-merge-without-clobbering pattern**) | role-match — composite of two |
| `src/ui/state/conversation-store.ts` (**new** `upsertFleetSession`) | store / narrow mutator | event-driven CRUD | `removeFleetSession` `:1163-1182` (the sibling this mirrors) | role-match — see § No Full Analog |
| `src/ui/AppShell.tsx` | container / wiring | event-driven + request-response | WS callback body `:533-567`; one-shot effect `:706-793`; `parseInt` coercion `:2396-2400` | exact |
| `substrate/scripts/tests/<new>.sh` (**optional new**) | test driver (bash) | — | `substrate/scripts/tests/agent-supervisor-archive-scan.sh` + `tests/README.md` | exact |

**Test files (all pre-existing, all modified):** see § Test Analogs.

---

## Pattern Assignments

### 1. `substrate/scripts/fleet-status-sweep.py` (host-side emitter, file-I/O + batch)

Four sub-changes. Each has its own analog **inside files already on disk** — nothing here is new
mechanism.

#### 1a. Sentinel stat on an already-open `scandir` entry — extend in place

**Analog:** the same function, three lines above.

```python
# Source: substrate/scripts/fleet-status-sweep.py:796-810 (verbatim)
                name = entry.name
                if not SAFE_NAME_RE.match(name):
                    _log("identity_name_skipped", name=name[:40])
                    continue
                dormant = os.path.exists(os.path.join(entry.path, ".dormant"))
                recycled_at = os.path.exists(os.path.join(entry.path, ".recycled-at"))
                recycle_requested = os.path.exists(
                    os.path.join(entry.path, ".recycle-requested"),
                )
                out.append({
                    "name": name,
                    "dormant": dormant,
                    "recycled_at": recycled_at,
                    "recycle_requested": recycle_requested,
                })
```

`.pinned` / `.hidden` are two more `os.path.exists` lines in this block plus two more dict keys.
`entry.path` is already in hand. **Note the docstring at `:784` names the returned dict shape
explicitly** (`"""Return list of dicts {name, dormant, recycled_at, recycle_requested}.`) — it must
be updated or it becomes a lie.

#### 1b. Frontmatter fence-scan, stdlib only — extend the **ambient-monitor** shape

**Analog:** `substrate/scripts/ambient-monitor.py:240-281`. Its docstring (`:248-254`) states the
security rationale the planner must preserve verbatim in spirit.

```python
# Source: substrate/scripts/ambient-monitor.py:237, 256-281 (abridged, structure intact)
_ROLE_NAME_OK = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

def _read_frontmatter(identity_file):
    try:
        with open(identity_file, encoding="utf-8-sig") as f:
            lines = f.readlines()
    except OSError:
        return None, False
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return None, False
    role = None
    is_coord = False
    for line in lines[fences[0] + 1: fences[1]]:
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        m_role = re.match(r"^role:\s*(.+?)\s*(#.*)?$", line.rstrip("\n"))
        if m_role and role is None:
            raw = m_role.group(1).strip().strip('"').strip("'").strip()
            if _ROLE_NAME_OK.match(raw):
                role = raw
            continue
        # Strict coordinator detection: top-level YAML key (col 0), unquoted bare
        # `true`, optionally followed by a trailing YAML comment.
        if re.match(r"^coordinator:\s*true\s*(#.*)?$", line.rstrip("\n")):
            is_coord = True
    return role, is_coord
```

Five properties to carry across, in order of load-bearingness:
1. **`encoding="utf-8-sig"`** — BOM-safe, or the first `---` fence silently fails to match.
2. **`_ROLE_NAME_OK` validation BEFORE the value is used in a path join.** The docstring at
   `:250-254` names the threat: *"a malformed role like `role: ../../tmp` returns (None, ...) so the
   caller falls through to the unresolved-role branch rather than doing a path-traversal makedirs."*
3. **`except OSError: return <safe default>`** — never propagate.
4. **`#`-comment skip** + **quote strip** on values.
5. **Strict col-0 anchoring** (`^role:` not `\s*role:`) so a nested key does not win.

The parser needs four new keys (`displayName`, `title`, `colorHue`, `task`). `colorHue` needs
numeric narrowing to `0..359` to match the TS authority — copy the range from
`identity-artifact-reader.ts:2407-2414`:

```typescript
// Source: src/backend/claude-session/identity-artifact-reader.ts:2407-2414
  if (
    typeof src.colorHue === "number" &&
    Number.isFinite(src.colorHue) &&
    src.colorHue >= 0 &&
    src.colorHue <= 359
  ) {
    out.colorHue = src.colorHue;
  }
```

**Do NOT mirror `substrate/scripts/role-file-watch.py:58-84`** — it is the weaker sibling (no BOM
handling, no comment skip, `import re` inside the loop, `^role:\s*(\S+)` which breaks on quoted
values). RESEARCH flagged this; confirmed by reading both.

#### 1c. Bounded head-read for the 44KB role files

**Analog:** the sweep's own discovery read, which already establishes both the constant and the
byte-mode idiom.

```python
# Source: substrate/scripts/fleet-status-sweep.py:127-130 and :265-267
DISCOVERY_HEAD_BYTES = 4096
...
                with open(fpath, "rb") as fh:
                    head = fh.read(DISCOVERY_HEAD_BYTES)
```

Note the tension: `1b`'s analog opens in **text** mode with `utf-8-sig`; `1c`'s opens in **binary**
with a byte cap. Both are correct for their purpose. The composed read wants the cap AND the BOM
handling — either `open(path, encoding="utf-8-sig")` then `f.read(N)` (text chars, not bytes — fine
for a 4096-char cap), or binary read + `.decode("utf-8-sig", errors="replace")`. **Pick one and
state it in the plan**; a silent mismatch here is how the fence-match breaks on exactly the files
that have a BOM.

The unbounded helper that must NOT be used for role files:

```python
# Source: substrate/scripts/fleet-status-sweep.py:598-605 — reads the WHOLE file
def _read_text_file(path):
    """Read whole file as decoded str (errors=replace) or None on OSError."""
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    return data.decode("utf-8", errors="replace")
```

#### 1d. Per-tick role memo — lifetime + placement

**Analog for placement:** `main()` already establishes "per-tick dict beside its sibling", twice.

```python
# Source: substrate/scripts/fleet-status-sweep.py:882-890 (verbatim)
    # ---- Per-identity discovery (Phase 32 port, server-side). ----
    identity_jsonl_paths = {}  # name -> str | None
    for rec in identity_records:
        identity_jsonl_paths[rec["name"]] = discover_identity_jsonl_path(
            rec["name"], home,
        )

    # ---- Emit identity lines first (all Layer-1 tail scans run here). ----
    jsonl_tail_cache = {}  # name -> str | None (populated by _build_identity_line)
```

`jsonl_tail_cache` is the closer analog of the two: it is threaded **into** `_build_identity_line`
as a parameter (`:660`, `:901`) and populated inside it (`:674` `jsonl_tail_cache[name] = tail_str`).
A `role_cosmetics_memo` dict follows exactly that shape. **Semantic reference is Phase 85's
`roleReadCache` (`identities.ts:382-407`) but the Python equivalent is a plain dict — the sweep is
synchronous, so there is no in-flight promise to collapse.**

#### 1e. Emission target + the fail-closed/log discipline

```python
# Source: substrate/scripts/fleet-status-sweep.py:675-684 (verbatim — the dict to extend)
    return {
        "line_kind": "identity",
        "schema_version": SCHEMA_VERSION,
        "identity": name,
        "dormant": sentinels["dormant"],
        "recycled_at": sentinels["recycled_at"],
        "recycle_requested": sentinels["recycle_requested"],
        "jsonl_path": jsonl_path,
        "layer1_recycling": layer1,
    }
```

```python
# Source: substrate/scripts/fleet-status-sweep.py:156-169 — stderr ONLY (stdout is the wire)
def _log(op, **fields):
    """Emit ONE stderr line in a rough loose-JSON-with-op shape.

    Uses stderr because stdout is the JSONL wire and MUST remain silent when
    there is nothing to emit. Never raise from here ...
    """
```

```python
# Source: substrate/scripts/fleet-status-sweep.py:589-595 — the fail-closed-per-read idiom
def _mtime_ms(path):
    """Return int(st_mtime * 1000) or None on ENOENT / OSError."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return int(st.st_mtime * 1000)
```

**Constraints written into the file itself that the plan must restate:**
- `:80-82` — *"Python 3.6+ stdlib ONLY (no pip installs)."* → **no `import yaml`.**
- `:33-43` — stdout is JSONL only; unhandled exception → stderr + exit 0 + empty stdout
  (`:919-931`).
- `:24-31` — the execute bit is load-bearing; a mode-drift *"would ship a non-executable script to
  every managed box and permanently pin the fleet on the legacy fallback path."* **Do not `chmod`.**
- `:14-19` — *"Field names + types below must be BYTE-IDENTICAL to the TypeScript."*
- `SCHEMA_VERSION = 1` at `:102`. **D-04: do not touch it.**

---

### 2. Wire widening + BOTH fingerprints — the highest-value analog in this document

#### 2a. `wire-protocol.ts` — additive-optional field (schema + lineage comment)

**Analog: Phase 62 (`02226aac`, 74 insertions, one file) and Phase 90 (`3014d8f0`, wire-protocol
+49).** Both add a field as `.nullable().optional()`, both add a preceding block comment, both
append one line to the lineage table.

```typescript
// Source: src/backend/fleet-status/wire-protocol.ts:375-388 — the field lines to extend
  // Phase 59 Plan 01 — mtime of the per-session Stop file (see block comment above).
  lastStopAt: z.number().nullable().optional(),
  // Phase 59 Plan 01 — server-derived status-transition timestamp (see block comment above).
  lastStatusChangeAt: z.number().nullable().optional(),
  // Phase 62 Plan 03 — mtime of the per-session activity marker (see block comment above).
  activityMtime: z.number().nullable().optional(),
  // Phase 62 Plan 03 — mtime of the per-session stopped marker (see block comment above).
  stoppedMtime: z.number().nullable().optional(),
  // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism) — per-session context %
  // fill (0-100, integer). Populated by subscription-registry.publishSessionState
  // + getSnapshot at frame-publish time from the contextpct-store shared map,
  // which is dual-written by the two `context_pct` WS emission sites in
  // claude-session-server.ts. See block comment above.
  contextPct: z.number().nullable().optional(),
```

The lineage table — **append one row, do not bump:**

```typescript
// Source: src/backend/fleet-status/wire-protocol.ts:307-316 (verbatim)
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// — seventh iteration of the T-41-03-05 mitigation. Lineage:
//   Phase 41 lastMessageAt                       → held at 1
//   Phase 47 aiTitle                             → held at 1
//   Phase 52 dormant                             → held at 1
//   Phase 53 recycling                           → held at 1
//   Phase 59 lastStopAt + lastStatusChangeAt     → held at 1
//   Phase 62 activityMtime + stoppedMtime        → held at 1
//   Phase 90 contextPct  (2026-09-08)            → held at 1 (this)
```

Every block comment in this file follows the same four-part template — copy it:
**(1) what + when**, **(2) source of the value**, **(3) three-valued semantics
(`value` / `null` / `undefined`)**, **(4) the held-at-1 invariant + lineage**. Phase 90's block at
`:275-316` is the cleanest instance.

#### 2b. `ssh-poll-orchestrator.ts` — the SEVEN sites, enumerated by the Phase 62 commit itself

`git show 0b586bfd` (Phase 62, +197/-1, one file) lists them in its own message. Reproduced because
it *is* the checklist:

> 5. SessionState composition + fleet_status_session_state_published log +
>    livenessMap.set **BOTH branches** (fingerprint-changed AND fingerprint-unchanged) stamp both
>    derived values. **Missing either branch would Pitfall-3 the cache** — Phase 59's identical
>    invariant applies here.
> 6. computeFingerprint appends both new axes **at the END** of the template literal (preserves the
>    existing delta contract for any future axis).

**Site 1 — the cache interface** (source A):
```typescript
// Source: src/backend/fleet-status/ssh-poll-orchestrator.ts — PidCacheEntry, Phase 62 added:
  activityMtime: number | null;
  stoppedMtime: number | null;
```
with a ~38-line block comment above naming: the two source paths, the three-valued semantics
(`null` on cold-start / missing file / SSH hiccup — cache-preserved in all three), the rollout note,
and the **sessionId-rotation reset invariant**. Read `git show 0b586bfd` lines around
`@@ -207,6 +207,44 @@` for the full text — it is the model comment for this phase.

**Source B's cache interface** is the one appearance actually needs:
```typescript
// Source: src/backend/fleet-status/ssh-poll-orchestrator.ts:391-398
interface IdentityRecycleCacheEntry {
  dormant: boolean;
  recycling: boolean;
  layer1RecyclingCached: boolean;
  jsonlPath: string | null;
  staleTailTickCount: number;
  lastPublishedFingerprint: string;
}
```

**Site 2 — `computeFingerprint` (source A), 12 segments, append at END:**
```typescript
// Source: src/backend/fleet-status/ssh-poll-orchestrator.ts:981 (single line, the whole contract)
  return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}|${state.activityMtime ?? ""}|${state.stoppedMtime ?? ""}`;
```
The append-at-END rule is stated **twice** in the comment above it (`:968-970` and `:978-980`):
> *"Fingerprint segments MUST live at the END of the template literal so any future axis is
> appended after these two without disturbing the delta contract."*

Normalization conventions to copy: strings/numbers → `?? ""`; booleans → tri-valued
`x === true ? "1" : x === false ? "0" : ""` so *"a first-time undefined publish is distinguishable
from cold cache"* (`:954-957`).

**Site 3 — source B's SEPARATE 2-segment inline fingerprint, ~940 lines away:**
```typescript
// Source: src/backend/fleet-status/ssh-poll-orchestrator.ts:1922-1923
    // Phase 6 — fingerprint + publish/suppress.
    const fingerprint = `${isDormant ? "1" : "0"}|${isRecycling ? "1" : "0"}`;
```
⚠ **This is where identity-keyed data (i.e. appearance) naturally arrives.** It is an inline local,
not a named helper, so a grep for `computeFingerprint` will not find it. There is **no precedent
commit for extending this one** — Phases 59/62/90 all touched only source A. Plan 2 is the first to
widen source B's fingerprint, so it inherits the *discipline* from Phase 62 but not a diff.

**Sites 4 + 5 — source B writes its cache on BOTH branches:**
```typescript
// Source: :1925-1936 — SUPPRESS branch (cache-hit, fingerprint identical)
    if (cached !== undefined && cached.lastPublishedFingerprint === fingerprint) {
      identityRecycleState.set(name, {
        dormant: isDormant,
        recycling: isRecycling,
        layer1RecyclingCached,
        jsonlPath,
        staleTailTickCount: nextStaleTailTickCount,
        lastPublishedFingerprint: fingerprint,
      });
      return;
    }
// Source: :1943-1950 — PUBLISH branch (fingerprint delta / first appearance)
    identityRecycleState.set(name, { /* same six fields */ });
```
The rule, stated for source A at `:2527-2529`:
> *"Update procStart + tmux + fresh derivations in case they changed without a state-change
> (Research § Pitfall 3 — **every axis MUST be stamped on both branches so the cache stays lockstep
> with derivation**)."*

**Sites 6 + 7 — source B builds its `SessionState` frame at TWO hardcoded places:**
```typescript
// Source: :1890-1903 — the PRE-EVICT recycling-false transition frame
        const state: SessionState = {
          hostId: host.id,
          tmuxSession: name,
          sessionId: "__dormant__",
          pid: null,
          status: "idle",
          waitingFor: undefined,
          backgroundTasks: [],
          updatedAt: deps.now(),
          lastMessageAt: null,
          aiTitle: null,
          dormant: isDormant,
          recycling: false,
        };
        deps.registry.publishSessionState(host.id, state);
// Source: :1952-1966 — the NORMAL source-B frame (identical shape, recycling: isRecycling)
```
Both are literal object constructions with **no shared factory**. Appearance must be added to both,
or the recycling-transition frame blanks appearance and the row undresses on that one edge (D-09
violation). ⚠ **A factory extraction here would be a real improvement but is a refactor with its own
blast radius in an 8,072-line test file — planner's call, but call it explicitly.**

**Site 8 (source A, for completeness) — the gate + both cache branches:**
```typescript
// Source: :2492-2496
    // Delta semantics — only publish if fingerprint changed.
    const newFingerprint = computeFingerprint(state);
    const lastFingerprint = livenessMap.get(pid)?.lastPublishedFingerprint;

    if (newFingerprint !== lastFingerprint) {
```

#### 2c. The adapter that carries appearance from sweep line → fetched struct

**Analog:** the existing adapter, which already shows the fail-open-with-cache-preserve idiom.
```typescript
// Source: src/backend/fleet-status/ssh-poll-orchestrator.ts:1611-1632
  function identityLineToPerIdentityFetched(
    identityLine: SweepIdentityLine,
    hostState: PerHostState,
  ): PerIdentityFetchedState {
    const cached = hostState.identityRecycleState.get(identityLine.identity);
    // B5 fail-open — null tail-scan preserves cached layer1RecyclingCached.
    const layer1RecyclingCached =
      identityLine.layer1_recycling !== null
        ? identityLine.layer1_recycling
        : (cached?.layer1RecyclingCached ?? false);
    return {
      name: identityLine.identity,
      isDormant: identityLine.dormant,
      isRecycledAt: identityLine.recycled_at,
      isRecycleRequested: identityLine.recycle_requested,
      layer1RecyclingCached,
      jsonlPath: identityLine.jsonl_path,
      // Batch-path scripts perform per-tick discovery server-side; the multi-
      // tick rotation defense does not apply here.
      nextStaleTailTickCount: 0,
    };
  }
```
`PerIdentityFetchedState` is declared at `:544-568` — every field carries a `/** Bn — ... */`
docblock naming its parity row. New appearance fields should follow that convention.

**Dispatch site** (where appearance flows per tick), `:1545-1550`:
```typescript
    // Source B — dispatch each SweepIdentityLine into the SAME compose helper.
    for (const identityLine of parsed.identityLines) {
      const fetched = identityLineToPerIdentityFetched(identityLine, hostState);
      const cached = hostState.identityRecycleState.get(identityLine.identity);
      composeAndPublishPerIdentity(hostState, liveTmuxSet, fetched, cached);
    }
```

#### 2d. `sweep-schema.ts` — optional fields at v1 + the parity map

```typescript
// Source: src/backend/fleet-status/sweep-schema.ts:67-88 — docblock + interface, both extended
/**
 * Field ↔ RESEARCH.md exec-site parity (see SWEEP_FIELD_PARITY):
 *   • dormant           ↔ B1 (`.dormant` sentinel present)
 *   • recycled_at       ↔ B2 (`.recycled-at` sentinel present)
 *   • recycle_requested ↔ B3 (`.recycle-requested` sentinel present)
 *   • jsonl_path        ↔ B4 (Phase 32 discovery result, null when no match)
 *   • layer1_recycling  ↔ B5 (tail-scan verdict; null = tail unreadable this
 *                          tick, caller preserves cached value — fail-open)
 */
export interface SweepIdentityLine {
  line_kind: "identity";
  schema_version: SweepSchemaVersion;
  identity: string;
  dormant: boolean;
  recycled_at: boolean;
  recycle_requested: boolean;
  jsonl_path: string | null;
  layer1_recycling: boolean | null;
}
```

**Why optional (`?:`) fields at v1 are safe — the parser proves it:**
```typescript
// Source: src/backend/fleet-status/sweep-schema.ts:236-250
    if (rec.schema_version !== SWEEP_SCHEMA_VERSION) {
      // Any mismatched-version line flips the flag; caller decides policy.
      schemaMismatch = true;
      continue;
    }

    if (rec.line_kind === "identity") {
      identityLines.push(parsed as SweepIdentityLine);   // ← bare cast, no field validation
```
plus `isSweepLineOfCurrentSchema` `:158-163`, which checks **only** `schema_version` and
`line_kind`. Absent appearance keys arrive as `undefined`; the adapter's `?? null` handles them.

**The `?:`-optional-for-rollout precedent to copy verbatim in spirit:**
```typescript
// Source: src/ui/state/conversation-store.ts:181-184
  // ... Optional so pre-Phase-44 backend responses (or a v1 cache
  // rehydrate that predates this field) deserialize into a FleetSession object
  // that simply omits the field — seed loop then calls with `?? null`.
  lastMessageAt?: number | null;
```

**Parity map extension** (`SWEEP_FIELD_PARITY` `:286-356`) — the entry shapes:
```typescript
// Source: src/backend/fleet-status/sweep-schema.ts:351-355 (mapped rows)
  B1: { field: "dormant" },
  B2: { field: "recycled_at" },
  B3: { field: "recycle_requested" },
  B4: { field: "jsonl_path" },
  B5: { field: "layer1_recycling" },
// Source: :314-318 (a SKIPPED row — the other legal shape)
  B0: {
    field: null,
    skipped_reason:
      "server-side enumeration driver (find ~/.claude/identities/) — no wire field needed; each identity folder becomes its own SweepIdentityLine",
  },
```
Its stated purpose (`:276-281`) is **typo protection + documentation protection**, both of which
still apply to four new field names. RESEARCH § Open Question 4 recommends `B6`..`B9`.

#### 2e. `fleet-status-types.ts` — the hand-maintained browser mirror

```typescript
// Source: src/ui/api/fleet-status-types.ts:216-230
  // Phase 90 Plan 00 (Wave 0, 2026-09-08 — D-10 delivery mechanism): per-session
  // context% (0-100). Populated by subscription-registry at frame-publish time
  // ...
  // Semantics: `number` → context% present; `null` → no reading yet (fresh
  // session, dormant, or SSH hiccup — hold-last discipline applies at the
  // consumer); `undefined` → emitting backend pre-dates Phase 90 Plan 00,
  // frontend treats as null. Mirrors backend `SessionStateSchema.contextPct`.
  contextPct?: number | null;
```
Note the closing sentence pattern every field in this file ends with — *"Mirrors backend
`SessionStateSchema.X`. MUST stay in lockstep with the backend schema"* (`:211-213`). The file
header (`:1-16`) states the browser does **no** runtime validation, which is why the mirror is the
only guardrail.

**Type-mirror inventory for the plan checklist (each is a distinct file):**
| # | File | Definition |
|---|------|-----------|
| 1 | `src/backend/fleet-status/wire-protocol.ts:355-389` | `SessionStateSchema` (zod) — source of truth |
| 2 | `src/ui/api/fleet-status-types.ts:88-231` | `interface SessionState` — hand-mirrored, `hostId: string` at `:89` |
| 3 | `src/backend/fleet-status/sweep-schema.ts:79-88` | `SweepIdentityLine` — host→server hop |
| 4 | `substrate/scripts/fleet-status-sweep.py:675-684` | the Python dict — cross-language copy |
| 5 | `src/backend/fleet-status/ssh-poll-orchestrator.ts:544-568` | `PerIdentityFetchedState` |
| 6 | `src/backend/fleet-status/ssh-poll-orchestrator.ts:391-398` | `IdentityRecycleCacheEntry` |
| (7) | `src/ui/state/conversation-store.ts:172-222` | `FleetSession` — **only if** appearance rides rows; see § Do NOT Copy |

---

### 3. Row appear/disappear on the pulse — the one seam with NO full analog

**Nothing in the codebase creates or removes a conversation row from a WS frame today.** Confirmed
by grep: the only non-test callers of the two mutators are `AppShell.tsx:728, 752, 779, 2370`
(`updateFleetSessions`) and `AppShell.tsx:2400` (`removeFleetSession`) — all four are
request-response or manual-action paths, none is a WS callback.

#### 3a. Removal — the function already exists; wire `onGone` to it

**Analog: exact — this IS the target.**
```typescript
// Source: src/ui/state/conversation-store.ts:1163-1182 (verbatim)
export function removeFleetSession(hostId: number, sessionName: string): void {
  const nextFleetSessions = state.fleetSessions.filter(
    (s) => !(s.hostId === hostId && s.sessionName === sessionName),
  );
  // No-op path: tuple was not present — no state mutation, no cache write, no notify.
  if (nextFleetSessions.length === state.fleetSessions.length) return;

  state = { ...state, fleetSessions: nextFleetSessions };
  notify();

  // Cache trim. Silent on write failure — mirrors writeFleetSessionsCache's
  // own failure policy. Do NOT block or unwind the in-memory update if the
  // cache write throws (localStorage quota, disabled storage, private mode).
  try {
    writeFleetSessionsCache(nextFleetSessions);
  } catch {
    // Silent — cache-write failure is non-fatal; ...
  }
}
```
Its JSDoc (`:1148-1162`) documents three properties an `upsertFleetSession` sibling should mirror:
narrow `(hostId, sessionName)` tuple match, **idempotent no-op when nothing changed**, and cache
sync. Note it does **not** touch `fleetSessionsLoaded` — that is the property that makes it the
right model.

**The existing caller, which is also the `hostId` coercion analog:**
```typescript
// Source: src/ui/AppShell.tsx:2394-2400
            try {
              await killTmuxSession(
                parseInt(row.host.id, 10),
                row.targetTmuxSession,
              );
              closeTab(row.id);
              removeFleetSession(parseInt(row.host.id, 10), row.targetTmuxSession);
```

#### 3b. Upsert — closest analog is `removeFleetSession`'s sibling shape, NOT `updateFleetSessions`

`updateFleetSessions` is the wrong door for the pulse. Its own body says why:
```typescript
// Source: src/ui/state/conversation-store.ts:1129-1144
  const needsFlagFlip = !state.fleetSessionsLoaded;

  // Full no-op path: sessions are a shallow no-op AND the flag is already
  // true. Nothing has changed — do NOT bump snapshotVersion.
  if (sessionsShallowEqual && !needsFlagFlip) return;
  ...
  state = {
    ...state,
    fleetSessions: nextSessions,
    fleetSessionsLoaded: true,      // ← UNCONDITIONAL (quick-260727-kbw)
  };
```
`fleetSessionsLoaded: true` is unconditional, and that flag gates the panel hydrate effect:
```typescript
// Source: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:556-558
  useEffect(() => {
    if (!fleetSessionsLoaded) return;
    if (!identitiesLoaded) return;
```
The comment block above it (`:548-555`) names the pin-pruner interaction. This is the
`fleetSessionsLoaded` twin of the D-10 hazard — same class of bug, different flag.

**The additive-write-that-preserves-unknown-fields pattern (best in-repo analog for the merge
semantics of an upsert):**
```typescript
// Source: src/ui/state/session-working-store.ts:870-906 — advanceSessionAiTitle
function advanceSessionAiTitle(key: string, title: string | null): void {
  if (title === null) return;                                    // ← 1. null is a no-op, never a clear

  const existing = state.map.get(key);
  if (existing !== undefined && existing.aiTitle === title) {
    // Cache already holds this exact string — last-wins no-op + no-notify.
    return;                                                      // ← 2. idempotence guard
  }

  const nextRecord: WorkingRecord = {
    isWorking: existing?.isWorking ?? false,                     // ← 3. EVERY other axis preserved
    lastMessageAt: existing?.lastMessageAt ?? null,
    aiTitle: title,
    dormant: existing?.dormant ?? false,
    recycling: existing?.recycling ?? false,
    lastStopAt: existing?.lastStopAt ?? null,
    lastStatusChangeAt: existing?.lastStatusChangeAt ?? null,
    activityMtime: existing?.activityMtime ?? null,
    stoppedMtime: existing?.stoppedMtime ?? null,
  };
  ...
  const nextMap = new Map(state.map);
  nextMap.set(key, nextRecord);
  state = { map: nextMap };
  notify();
}
```
Its JSDoc (`:860-868`) names the design property: *"Single reconciliation chokepoint — any future
contract tweak is a one-place change."* Note **every** field is explicitly re-listed with
`existing?.X ?? default` — Phase 59 and Phase 62 both had to add lines here, and the comments
(`:885-892`) say so. That enumerate-everything style is exactly what D-09 asks for.

#### 3c. What a pulse-created row needs, and where each field comes from

`FleetSession` (`conversation-store.ts:172-222`) requires four non-optional fields:
```typescript
export type FleetSession = {
  hostId: number;          // wire has hostId: STRING → parseInt at the AppShell boundary
  hostName: string;        // NOT on the fleet-status wire → resolve from state.hostsFlat
  sessionName: string;     // = SessionState.tmuxSession (nullable on the wire — guard)
  created: number;         // NOT on the wire
  role: string | null;     // NOT on the wire (unless appearance carries it)
  ...
};
```
`hostName` resolution analog — the row-builder already tolerates a miss:
```typescript
// Source: src/ui/state/conversation-store.ts:728-732
  // Host resolution: prefer state.hostsFlat.get(hostId) (a real Host with all
  // fields); fall back to undefined when hostsFlat hasn't populated yet (Test 28).
  // Also collect per-fleet-hostId hostName fallback so the HostGroup header can
  // render even when the host is absent from hostTree AND hostsFlat (Test 28).
  const fleetHostNameFallback = new Map<string, string>();
```
`state.hostsFlat` is a `Map<number, Host>` (`:377`, written by `updateHostsFlat` `:1432-1436`,
driven from `AppShell.tsx:800-815`). A miss degrades to today's behaviour rather than breaking.

#### 3d. The relay-room guard the upsert must not trip

```typescript
// Source: src/ui/state/conversation-store.ts:735-742
    // Phase 91 UAT fix 2026-09-09 (user): relay-room sessions on the wire
    // have a completely different shape from harness sessions — no hostId,
    // no hostName, no sessionName, no role. Passing them through the harness
    // synthetic-row loop below produces a malformed row (host:undefined,
    // id="fleet::undefined::undefined") that never surfaces in the sidebar.
    // Build a proper relay-room row here and continue.
    if (session.kind === "relay-room") {
      if (session.id === undefined || session.roomId === undefined) continue;
```
The branch-on-`kind`-FIRST-then-`continue` shape is the pattern. A pulse upsert must emit
harness-shaped sessions only; a `gone` frame with `tmuxSession: null` (legal per
`wire-protocol.ts` gone-frame schema) needs an explicit guard so it matches nothing unintended.

#### 3e. Row id + appearance-lookup shapes the upsert must produce keys compatible with

```typescript
// Source: src/ui/state/conversation-store.ts:597-599
export function fleetRowId(hostId: number, sessionName: string): string {
  return `fleet::${hostId}::${sessionName}`;
}
```
```typescript
// Source: src/ui/features/pretty-conversations/PrettyConversationRow.tsx:341-351
  const rowHostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;

  const identity: Identity | null = (() => {
    if (!key) return null;
    if (Number.isFinite(rowHostIdNum)) {
      const scoped = identitiesByHostKey?.get(`${rowHostIdNum}::${key}`);
      if (scoped) return scoped;
    }
    return identitiesByKey?.get(key) ?? null;
  })();
  const hue: number | null = identity?.colorHue ?? null;
```
**This is the consumer that decides whether a row paints dressed.** It reads `byHostKey` from
`identities-store` — *not* `SessionState`. Which is why item 4 exists, and why appearance must land
in `identities-store` **before** the row upsert inside the same callback body.

#### 3f. Where the ordering happens — the callback body to modify

```typescript
// Source: src/ui/AppShell.tsx:539-563 (verbatim — the whole wiring surface)
      onSnapshot: (states) => {
        for (const state of states) {
          publishFleetStatusSessionState(state.hostId, state);
          publishFleetStatusWaitingFor(
            state.hostId,
            state.tmuxSession,
            state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
          );
          publishFleetStatusTmuxSession(state.hostId, state.tmuxSession);
        }
      },
      onUpdate: (state) => {
        publishFleetStatusSessionState(state.hostId, state);
        publishFleetStatusWaitingFor(
          state.hostId,
          state.tmuxSession,
          state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
        );
        publishFleetStatusTmuxSession(state.hostId, state.tmuxSession);
      },
      onGone: (hostId, tmuxSession, sessionId) => {
        publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
        publishFleetStatusTmuxSessionGone(hostId, tmuxSession);
      },
```
Note the **existing ordering discipline** already documented one layer up in the client:
```typescript
// Source: src/ui/api/fleet-status-client.ts:138-145
          // ... The
          // user's onSnapshot callback fires AFTER — matches the existing
          // ordering discipline in AppShell where session-working-store,
          // session-waiting-store, session-tmux-store all publish first.
          for (const s of parsed.states) {
            publishSessionContextPct(s.hostId, s.tmuxSession, s.contextPct ?? null);
          }
          onSnapshot(parsed.states);
```
So "appearance first, then row" has a documented precedent for *where* to put an ordered write.

---

### 4. Additive appearance merge that cannot touch `loaded` (D-09 + D-10)

#### 4a. Why the existing door cannot be reused — the unconditional line

```typescript
// Source: src/ui/state/identities-store.ts:64-94 (the single existing write door)
function setIdentities(list: Identity[]) {
  const normalized = list.map(withDisplayCap);
  // byKey is bare-name — retained additively for existence-check consumers
  // ... With the backend
  // now returning multiple rows for the same name across hosts, byKey.set
  // collides on name — last wire-order wins for the bare-name map, which is
  // fine because those consumers only ask `.has(name)` / `.get(name)` ...
  // Cosmetics consumers MUST use byHostKey — see quick-260912-0t4 rationale.
  const byKey = new Map<string, Identity>();
  const byHostKey = new Map<string, Identity>();
  for (const i of normalized) {
    const nameLc = i.identityKey.toLowerCase();
    byKey.set(nameLc, i);
    // Only index rows that carry a hostId — pre-quick-260912-0t4 fixtures
    // (test mocks) may omit it; skip those in the composite map rather than
    // seeding a `undefined::name` bucket that would silently mis-serve
    // production lookups.
    if (typeof i.hostId === "number" && Number.isFinite(i.hostId)) {
      byHostKey.set(`${i.hostId}::${nameLc}`, i);
    }
  }
  state = {
    identities: normalized,
    byKey,
    byHostKey,
    loaded: true,          // ← UNCONDITIONAL. No branch. This is the D-10 trap.
  };
  notify();
}
```
**All four existing writers go through it:** `fetchOnce` (`:288`), `refreshIdentities` (`:346`),
`applyIdentityChange` (`:406`), `patchIdentityFlag` (`:447`).

Two reusable sub-patterns inside it that the new door **should** copy:
- the `byKey` + `byHostKey` dual rebuild loop (`:74-86`), including the
  `typeof i.hostId === "number" && Number.isFinite(i.hostId)` guard;
- `withDisplayCap` normalization (`:56-62`) — so both doors produce the same shape.

#### 4b. The bug D-10 protects, in the store's own words

```typescript
// Source: src/ui/state/identities-store.ts:258-277 (verbatim — fetchOnce's skip-guard)
  // 2026-09-08 (user): on cold reload, fleetSessions is empty until the WS
  // fleet-status frame arrives, so buildIdentityHostsFromFleet returns {}.
  // With Phase 69's disk-fanout backend, GET /identities?identityHosts={}
  // returns []; that response flips state.loaded=true with byKey=empty,
  // which sabotages TerminalOrIdentitySessionPane's hydration-race guard
  // in tabUtils.tsx (byKey.has(k) || !loaded evaluates to false → Terminal
  // component mounts for identity-shape panes during the ms window before
  // the fleet-status subscription fires refreshIdentities). Terminal boots
  // an xterm + real SSH WS + then unmounts when the discriminator flips,
  // leaking listeners (bounty: terminal-first-flash-on-reload-plus-listener-
  // leak). Skip the empty-map fetch entirely — stay loaded=false and let
  // ensureFleetSubscription's fleet-arrival callback fire the first real
  // fetch when it has non-empty identityHosts. Safe fallback if fleet-status
  // never arrives: loaded stays false forever, discriminator keeps assuming
  // identity, PVs render fine (they read tab props, not identity metadata —
  // see d4d87217 rationale).
  const identityHostsPrecheck = buildIdentityHostsFromFleet(
    getFleetSessionsSnapshot(),
  );
  if (Object.keys(identityHostsPrecheck).length === 0) return;
```

The consumer:
```typescript
// Source: src/ui/shell/tabUtils.tsx:282-284
  const isIdentityPane =
    identityKey != null &&
    (identitiesByKey.has(identityKey) || !identitiesLoaded);
```
⚠ **Correction of record for the planner:** CONTEXT.md cites `tabUtils.tsx:205` for the
discriminator. `:205` is the `useIdentities()` hook call; the **expression** is at `:282-284`. Cite
the symbol `isIdentityPane`.

The one dangerous transition: `loaded` true while `byKey` is missing a key → the Terminal branch.
A pulse-fed `setIdentities` with a one-entry list makes this **worse** than the original bug —
originally a ms window, now every other identity pane in the tab set.

#### 4c. Closest existing analog for the new door — `patchIdentityFlag`

```typescript
// Source: src/ui/state/identities-store.ts:426-448 (verbatim)
export function patchIdentityFlag(
  identityKey: string,
  hostId: number | null,
  field: "pinned" | "hidden",
  value: boolean,
): void {
  const keyLc = identityKey.toLowerCase();
  let changed = false;
  const nextList = state.identities.map((i) => {
    const keyMatches = i.identityKey.toLowerCase() === keyLc;
    if (!keyMatches) return i;
    const hostMatches =
      hostId === null ||
      typeof i.hostId !== "number" ||
      i.hostId === hostId;
    if (!hostMatches) return i;
    if (i[field] === value) return i;      // ← per-field no-op
    changed = true;
    return { ...i, [field]: value };       // ← spread-preserve: never drops a field
  });
  if (!changed) return;                    // ← COPY THIS: no-op suppression, no notify
  setIdentities(nextList);                 // ← ⚠ DO NOT COPY THIS LINE — sets loaded:true
}
```
**Copy:** the `(hostId, identityKey)` narrow match with the `hostId === null` bare-name fallback; the
`{ ...i, ... }` spread-preserve; the per-field equality skip; the `if (!changed) return` guard.
**Do not copy:** the `setIdentities(nextList)` tail.

Its JSDoc (`:409-425`) is also the model for *why* the new door needs a docblock: it names the exact
regression it prevents (*"the pin/hide silently reverts on mobile navigate-away-and-back"*).

#### 4d. Explicitly NOT the analog — `applyIdentityChange`

```typescript
// Source: src/ui/state/identities-store.ts:389-406 (the wholesale-replacement half)
  } else if (next) {
    const nextKeyLc = next.identityKey.toLowerCase();
    const idx =
      typeof next.hostId === "number" && Number.isFinite(next.hostId)
        ? list.findIndex(
            (i) =>
              i.identityKey.toLowerCase() === nextKeyLc &&
              i.hostId === next.hostId,
          )
        : list.findIndex((i) => i.identityKey.toLowerCase() === nextKeyLc);
    if (idx >= 0) list[idx] = next;     // ← WHOLESALE REPLACE — D-09 forbids this
    else list.push(next);               // ← APPENDS a partial row — D-10 hazard
  }
  setIdentities(list);                  // ← and sets loaded
```
It takes a **whole** `Identity`, replaces the row outright, appends on miss, and ends in
`setIdentities`. All three behaviours are the ones D-09/D-10 rule out. Its `findIndex` composite
match (`:395-402`) is still worth copying as the *locate* half.

**Worth reusing from this function:** the `removedHostId` JSDoc at `:363-370` documents the
composite-vs-bare-name fallback tradeoff in prose — good precedent language for the new door's
docblock.

#### 4e. The field set to merge — mirror `publicIdentity()` names exactly

```typescript
// Source: src/backend/database/routes/identities.ts:229-276 (the canonical returned shape)
  return {
    identityKey,
    hostId,
    displayName:
      typeof cosmetics.displayName === "string" && cosmetics.displayName.length > 0
        ? cosmetics.displayName
        : capitalizeFirst(identityKey),
    title: mergedTitle,
    colorHue: mergedColorHue,
    voice: mergedVoice,
    task: typeof cosmetics.task === "string" ? cosmetics.task : null,
    avatarMime: ...,
    avatarUrl: `/identities/${identityKey}/avatar?hostId=${hostId}`,
    avatarEtag: ...,
    coordinator: typeof cosmetics.coordinator === "boolean" ? cosmetics.coordinator : false,
    role,
    roleDefaults: roleCosmetics,
    pinned,
    hidden,
  };
```
And the canonical identity-over-role merge — **do not re-derive:**
```typescript
// Source: src/backend/database/routes/identities.ts:207-227
  // Phase 85: per-field merge — identity ?? role ?? null. The narrowing
  // guards (typeof/range) live in extractCosmeticsFromFrontmatter; here we
  // only need presence-check fall-through.
  const mergedTitle =
    typeof cosmetics.title === "string"
      ? cosmetics.title
      : typeof roleCosmetics?.title === "string"
        ? roleCosmetics.title
        : null;
  const mergedColorHue =
    typeof cosmetics.colorHue === "number"
      ? cosmetics.colorHue
      : typeof roleCosmetics?.colorHue === "number"
        ? roleCosmetics.colorHue
        : null;
```
⚠ **Two carve-outs a naive "merge everything" would get wrong:** `task` is NOT inherited from the
role (`:243-247` — *"task is per-identity (D-05 write-once at birth)"*), and `displayName` falls back
to `capitalizeFirst(identityKey)`, **not** to the role.

The frontend `Identity` type is at `src/ui/api/identities-api.ts:3-70` — every optional field there
(`hostId?`, `pinned?`, `hidden?`) carries a "why optional" JSDoc, which is the convention for any
new field.

---

### 5. Reconnect resilience + wake-on-visible (D-11..D-13)

#### 5a. The block to change — the whole `onclose` tail

```typescript
// Source: src/ui/api/fleet-status-client.ts:197-236 (verbatim)
    ws.onclose = (evt: CloseEvent) => {
      if (disposed) return;
      ws = null;

      console.info({
        operation: "fleet_status_client_close",
        url,
        code: evt.code,
        reason: evt.reason,
        attempt: reconnectAttempts,
      });

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn({
          operation: "fleet_status_client_gave_up",
          url,
          totalAttempts: reconnectAttempts,
        });
        return;                                          // ← BARE RETURN. No timer. D-11 target.
      }

      // R-54-07: full-jitter — uniform random draw in [0, capMs) prevents 10-tab restore from re-clumping the herd on the reconnect ladder.
      const capMs = BACKOFF_SCHEDULE_MS[
        Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)   // ← already clamps
      ];
      const delayMs = Math.floor(Math.random() * capMs);              // ← PRESERVE VERBATIM (D-13)
      reconnectAttempts += 1;

      console.info({
        operation: "fleet_status_client_retry_scheduled",
        url,
        delayMs,
        attempt: reconnectAttempts,
      });

      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delayMs);
    };
```
Constants at `:35-36`: `MAX_RECONNECT_ATTEMPTS = 5`,
`BACKOFF_SCHEDULE_MS = [2000, 4000, 6000, 8000, 8000] as const`.
Attempt reset on open at `:92-93`. File header `:8-11` documents the give-up behaviour and must be
amended alongside the code.

#### 5b. Visibility listener — the cleanest analog for a NON-React module

`fleet-status-client.ts` is a plain factory, not a component, so the nine React `useEffect`
listeners are structurally wrong models. The right one is:

```typescript
// Source: src/ui/lib/console-forwarder.ts:209-214 (verbatim — plain module, no React)
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });
  window.addEventListener("pagehide", flushBeacon);
```
Simple, but note it never removes the listener — acceptable for a process-lifetime forwarder,
**not** acceptable here because `dispose()` exists. The disposer to extend:
```typescript
// Source: src/ui/api/fleet-status-client.ts:242-265
  return {
    dispose(): void {
      disposed = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      if (ws !== null) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }

      console.info({ operation: "fleet_status_client_disposed", url });
    },
  };
```

#### 5c. The guard SET to copy — from `PrettyView.tsx` (the iOS-PWA-hardened one)

```typescript
// Source: src/ui/features/pretty-view/PrettyView.tsx:2970-3001 (verbatim)
  useEffect(() => {
    if (!isIosPwa()) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: cancel any pending reconnect timer.
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        return;
      }
      // Tab visible: reconnect if needed.
      if (statusRef.current === 'inactive') return;
      // Quick 260808-b74: if the pane itself is hidden (isVisible=false), a PWA
      // foreground event must NOT reopen the WS behind the WS-pause effect's back.
      // ...
      if (!isVisibleRef.current) return;
      if (wsRef.current?.readyState === 1) return; // still OPEN
      // Fresh budget for this foreground event (user iOS PWA fix).
      reconnectAttemptsRef.current = 0;
      ...
      setRetryKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Six properties, mapped to this phase's client:

| PrettyView guard | fleet-status-client equivalent | Why |
|---|---|---|
| `if (!isIosPwa()) return;` | ⚠ **do NOT copy** | The header at `:2950-2957` explains the gate exists because *"on Chrome desktop / Android / non-PWA Safari, WebSockets survive tab-switches and force-reconnect creates a session-attachment race"*. **That race is specific to session-attachment; fleet-status is read-only fanout.** D-12 wants wake-on-visible on every platform. State this divergence in the plan — copying the gate would silently deliver nothing on desktop. |
| `if (document.hidden) { clearTimeout(...) ; return; }` | clear `retryTimer` on hidden, **do not** reset `reconnectAttempts` | Comment `:2964-2967`: *"a hide during a retry sequence should NOT drop the accumulated attempt count."* |
| `if (statusRef.current === 'inactive') return;` | `if (disposed) return;` | Every handler in the client early-returns on `disposed` — match it. |
| `if (wsRef.current?.readyState === 1) return;` | `if (ws !== null) return;` | The double-fire guard. iOS PWA fires `visibilitychange` spuriously. |
| `reconnectAttemptsRef.current = 0;` | `reconnectAttempts = 0;` | Comment `:2919`: *"No further timer scheduled. visibilitychange:visible gives a fresh budget."* |
| paired `removeEventListener` in cleanup | do it in `dispose()` | See 5b. |

⚠ **One counter-warning from the same file** (`:1633`): *"NOT reset on ws.onopen (defeats the cap on
rapid cycles)."* The client **already** resets on open at `:92-93`. Do not add a *second* reset path
without deciding which one owns the budget.

Also relevant: `src/ui/lib/is-ios-pwa.ts:2` explicitly names *"(PrettyView.tsx) visibilitychange
force-reconnect useEffects"* as a known pair — evidence the multi-listener pattern is accepted here,
so a tenth listener is not a smell.

#### 5d. The one-shot fetch effect + the TG-17 lock comment to amend (D-07)

```typescript
// Source: src/ui/AppShell.tsx:706-718 (the lock, verbatim)
  // ─── Plan 07-01: fleet-native store extension (TG-12, TG-14, TG-17) ──────
  // Two additional inputs feed the conversation-store: a one-shot fleet-
  // discovery snapshot (getSessionList()) and a flat hostId → Host lookup
  // derived from realHostTree.
  //
  // TG-17 hard shape lock: fleet fetch is EXACTLY ONCE per page-load. No
  // polling, no interval, no focus/visibility refetch, NOT wired to
  // skynet:hosts-changed. Cross-device staleness acceptable — user
  // refreshes to update. The empty-dep-array useEffect enforces the lock.
  //
  // Silent try/catch on fetch failure — a network error just leaves
  // fleetSessions empty; the list falls back to Phase 6 openTabs-only
  // rendering. No toast, no retry, no user-visible surface.
```
and its closing line at `:793`:
`}, []); // EMPTY DEP ARRAY — TG-17 shape lock: exactly once per mount.`

⚠ **The trap inside the body that a naive "extract and call twice" refactor imports:**
```typescript
// Source: src/ui/AppShell.tsx:769-779
      } catch {
        // quick-260821-m36: flag-flip on failure so cold-cache clients
        // don't stay stuck at "Loading agents…". updateFleetSessions([])
        // is safe — the empty array is a shallow no-op on the
        // fleetSessions field, but the fleetSessionsLoaded false→true
        // transition is unconditional per quick-260727-kbw ...
        if (!cancelled) updateFleetSessions([]);
```
On a **re-ask**, `fleetSessionsLoaded` is already true, so this branch's only purpose is spent —
and an empty array would wipe every row on a transient blip. **The re-ask path must not run it.**

Two more mount-only-by-design pieces in the same body: the cache seed (`:726-744`) and the
`seedSessionLastMessageAt`/`seedSessionAiTitle` loop (`:740-743`, `:762-765`).

**In-flight coalescing analog** (for rapid mobile hidden/visible cycling):
```typescript
// Source: src/ui/state/identities-store.ts:239-251
  let refreshInflight = false;
  subscribeConversationStore(() => {
    if (hasRefreshedAfterFleetLoad || refreshInflight) return;
    const snapshot = getFleetSessionsSnapshot();
    if (snapshot.length === 0) return; // still empty — wait for the load flip
    refreshInflight = true;
    void refreshIdentities().then((ok) => {
      refreshInflight = false;
      // Only a successful refresh spends the latch. On failure the next
      // fleetSessions notification retries instead of leaving the user
      // stuck with safe-defaults.
      if (ok) hasRefreshedAfterFleetLoad = true;
    });
  });
```
Note the latch-on-success-not-attempt discipline (`:228-235` explains the regression that taught it)
— the same reasoning applies to a re-ask guard.

---

## Shared Patterns

### Fail-closed on a failed read
**Sources:** `identities.ts:426-442`; `fleet-status-sweep.py:589-595`, `:476-491`
**Apply to:** every new appearance read, Python and TS
```typescript
// Source: src/backend/database/routes/identities.ts:437-442
                  const hiddenPromise = withSlot(() =>
                    identityFileExists(identityKey, ".hidden", {
                      hostId,
                      conn,
                    }),
                  ).catch(() => false); // fail-closed per D-01 (HID-107-03)
```
A stat failure must NEVER paint an identity as pinned/hidden — and extended to appearance, must
never remove a row. Fail to safe-default appearance, never to absence.

### Per-unit swallow WITH a log line
**Source:** `identities.ts:468-501`
**Apply to:** every per-identity and per-host error path added by this phase
```typescript
// Source: src/backend/database/routes/identities.ts:468-479
                } catch (err) {
                  // Skip this key, but say so: an identity that is absent from
                  // disk and one whose read was refused are very different
                  // facts, and collapsing them silently made an SSH channel
                  // exhaustion present as a UI glitch (stacy, 2026-09-15).
                  databaseLogger.warn("Dropping identity from roster — read failed", {
                    operation: "list_identities_key_read",
                    hostId,
                    identityKey,
                    error: err instanceof Error ? err.message : String(err),
                  });
                  return null;
                }
```
On the Python side the equivalent is `_log(...)` to **stderr** (`fleet-status-sweep.py:156-169`) —
never stdout.

### Composite `${hostId}::${identityKey}` keying for anything appearance-shaped
**Source:** `identities-store.ts:18-27, 83-85`; `PrettyConversationRow.tsx:343-350`
```typescript
// Source: src/ui/state/identities-store.ts:83-85
    if (typeof i.hostId === "number" && Number.isFinite(i.hostId)) {
      byHostKey.set(`${i.hostId}::${nameLc}`, i);
    }
```
`byKey` **collides by design** (`:66-73`: *"last wire-order wins ... fine because those consumers
only ask `.has(name)`"*). Never use `byKey` for appearance.

### `hostId` string↔number — coerce ONCE at the AppShell boundary
| Space | Type | Evidence |
|---|---|---|
| `SessionState.hostId` (both ends) | **string** | `wire-protocol.ts:356` `hostId: z.string()`; `fleet-status-types.ts:89` |
| `FleetSession.hostId` | **number** | `conversation-store.ts:173` |
| `Identity.hostId` | **number** | `identities-api.ts:11`; guarded `Number.isFinite` at `identities-store.ts:83` |
| `Host.id` (UI type) | string | `PrettyConversationRow.tsx:341` does `parseInt(row.host.id, 10)` |

The trap: `` `${"6"}::willow` `` and `` `${6}::willow` `` both stringify to `"6::willow"`, so a naive
template join *appears* to work until a `typeof hostId !== "number"` filter drops the entry silently.
Both derive functions `continue` on non-number (`identities-store.ts:173`, `:217`).
**Coercion analog:** `AppShell.tsx:2396-2400`.

### Idempotence guard before `notify()`
Present in every store mutator this phase touches — copy the shape, not just the intent:
- `patchIdentityFlag`: `if (!changed) return;` (`identities-store.ts:446`)
- `removeFleetSession`: `if (nextFleetSessions.length === state.fleetSessions.length) return;` (`:1168`)
- `advanceSessionAiTitle`: `if (existing !== undefined && existing.aiTitle === title) return;` (`session-working-store.ts:874-877`)
- `updateHostsFlat`: `if (hostsById === state.hostsFlat) return; // reference-equal no-op` (`:1433`)
- `publishFleetStatusSessionGone`: `if (!state.map.has(key)) return; // no-op` (`session-working-store.ts:737`)
- server-side `publishSessionGone`: `if (!state.has(key)) { return; }` — *"prevents false churn on watcher restarts"* (`subscription-registry.ts:228-231`)

---

## Do NOT Copy (analogs that look right and are wrong here)

| Tempting analog | Why it is wrong for Phase 111 | Evidence |
|---|---|---|
| `setIdentities(nextList)` tail of `patchIdentityFlag` | Sets `loaded: true` unconditionally → D-10 violation, amplified | `identities-store.ts:91`, `:447` |
| `applyIdentityChange` as the merge door | Wholesale-replaces the row and appends partials → D-09 + D-10 | `identities-store.ts:403-406` |
| `updateFleetSessions(array)` for the pulse upsert | Flips `fleetSessionsLoaded` unconditionally + replaces the whole array | `conversation-store.ts:1129-1144`; gate at `PrettyConversationsPanel.tsx:556-558` |
| Bumping `SWEEP_SCHEMA_VERSION` (an earlier D-04 draft said to) | Equality check `:236` → latched `schema-mismatch` for the whole SSH-channel lifetime → legacy ~75-90-exec fan-out. And the mismatch runs **new server vs old scripts**, the opposite direction from the draft's assumption. | `sweep-schema.ts:236`; `ssh-poll-orchestrator.ts:1315-1317`; `catalog.ts:253-262`; `starter.ts:874-890` |
| Bumping `FRAME_SCHEMA_VERSION` | Every frame schema uses `z.literal(FRAME_SCHEMA_VERSION)` — a bump rejects all frames at once, not a graceful degrade | `wire-protocol.ts:398` et al.; lineage `:307-316` |
| Putting appearance on `FleetSession` | Requires bumping `FLEET_CACHE_KEY` (v4, `:1228`), extending the `writeFleetSessionsCache` **whitelist** (`:1379-1381`: *"Serializes only the 4 canonical FleetSession fields so future field additions on FleetSession don't silently leak to storage"*), and extending `isFleetSession` (`:1230`). Three coupled edits for a value the server re-serves instantly on connect. | `conversation-store.ts:1191-1228, 1379-1409, 1230` |
| `if (!isIosPwa()) return;` on the new visibility listener | The gate exists for a session-attachment race specific to PrettyView's WS; fleet-status is read-only fanout, and D-12 wants wake-on-visible everywhere | `PrettyView.tsx:2950-2957` |
| Extracting the whole AppShell effect body and calling it twice | Imports the `updateFleetSessions([])` catch-branch into the re-ask path → wipes every row on a transient blip | `AppShell.tsx:769-779` |
| `role-file-watch.py:58-84` as the frontmatter-parser model | Weaker sibling: no BOM handling, no comment skip, `^role:\s*(\S+)` breaks on quoted values | read this session |
| `_read_text_file` (`:598-605`) for role files | Unbounded whole-file read; the largest measured role file is 44,642 bytes for ~4 lines of frontmatter | `fleet-status-sweep.py:598-605` |
| A third `line_kind` for appearance | `parseSweepJsonl` counts unrecognised kinds into `unknownLines` and **drops them** | `sweep-schema.ts:246-250` |
| `subscription-registry`'s `contextPct` re-stamp-at-publish pattern | ⚠ Correct as a *mechanism* analog, but `contextPct` re-stamps because its source is a **separate mutable store** written out-of-band. Appearance arrives **on** the frame from the sweep, so re-stamping would need a second server-side appearance store — a second authority. **Default: no registry change at all; appearance rides `SessionState` through untouched.** | `subscription-registry.ts:141-151, 205-219, 241-248` |

---

## Test Analogs

| Test file | Lines | Analog / what to mirror |
|---|---|---|
| `src/backend/fleet-status/sweep-schema.test.ts` | 369 | Fixture builders `makeIdentityLine()` / `makePidLine({overrides})` at `:40-66` — appearance fields go in the identity builder's defaults. `SWEEP_SCHEMA_VERSION === 1` assertion `:72-76` **stays green** under no-bump. Parity walk `:264-344` asserts an **exact 19-key `EXPECTED_KEYS` array** `:271-291` plus a hand-listed `identityFields` Set `:301-310` — both need the new field names or the typo protection lapses. Equality-mismatch lock `:151-169`. |
| `src/backend/fleet-status/wire-protocol.test.ts` | 609 | Schema-shape assertions; Phase 62 landed its RED here first (`1a8b9d4e` test → `02226aac` impl) — same TDD order available. |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | **8,072** | The fingerprint-axis test template is well established: *"Test P52-01-T2-iv: two consecutive ticks with SAME dormant value (all other axes unchanged) → second tick fingerprint-suppressed (no second publish)"* `:2645` and *"Test P52-01-T2-v: dormant flips (all other axes unchanged) → second tick publishes (fingerprint delta on dormant axis)"* `:2685`. Copy this **pair** per new appearance axis, and once more for source B (`:5379` is the source-B analog). Budget explicitly — largest file in the phase. |
| `src/backend/fleet-status/subscription-registry.test.ts` | 393 | Only if the registry changes (default: it should not). Phase 90 added 111 lines here for the three re-stamp paths. |
| `src/ui/state/identities-store.enrichment.test.ts` | 564 | Home for `mergeIdentityAppearance`. Mirror `describe("patchIdentityFlag — pure mutator contract")` `:435-493` — six `it` blocks covering patch, independence, idempotence, null-hostId bare-name fallback, mismatched-hostId no-op. Setup at `:1-75`: `vi.mock` **before** the SUT import, `makeSession()` fixture builder `:54-62`, four resets in `beforeEach`. ⚠ `__resetIdentitiesStoreForTest` (`identities-store.ts:483-493`) resets `hasRefreshedAfterFleetLoad` but **NOT** `hasSubscribedToFleet` — a real cross-test leak. **Add: `loaded === false` after a cold merge (D-10); absent-key merge does not append; undefined/null skipped (D-09); `byHostKey` composite preserved.** |
| `src/ui/state/conversation-store.test.ts` | **3,962** | Home for `upsertFleetSession` + `onGone`-driven removal + the relay-row regression. `__resetFleetSessionsForTest` `:1972-1976` is the isolation helper and its comment explains the flag-flip subtlety. |
| `src/ui/api/fleet-status-client.test.ts` | 830 | ⚠ **TWO tests lock give-up, both must be updated deliberately (D-11), neither deleted.** Test 5 `:199-259` asserts `instances.length` stays 6 after the 6th close (`:243-245`) AND that `gave_up` was logged (`:248-255`). Test 9's fourth case `:647-682` is stricter: `expect(setTimeoutSpy).not.toHaveBeenCalled()` at `:671`. The jitter cases `:540-645` must stay green **untouched** (D-13) — note `:640-644` asserts the delay is in `[0, 4000)`, i.e. it already tests the full-jitter draw. |
| `src/ui/AppShell.persistence.test.tsx` | 548 | D-07's split touches it. `conversation-store.ts:228-234` exposes `fleetSessions`/`fleetSessionsLoaded` on `SnapshotForTest` *"for exactly this test"* (quick-260821-m36's flag-flip-on-failure assertion). |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 4,906 | **Prefer not to touch.** The both-loaded gate is freshly fixed (quick-260912-5q2) and it is the largest UI test file. |
| **NEW (optional)** `substrate/scripts/tests/<name>.sh` | — | `substrate/scripts/tests/agent-supervisor-archive-scan.sh` is the sole existing driver and the convention model: `#!/usr/bin/env bash` + `shellcheck shell=bash`, `set -u` (**not** `-e` — *"the script uses explicit assert helpers so a failing assert does not silently skip subsequent tests"*), a documented hermetic env contract, scratch fixture dirs, `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, exit 0 on all-pass / 1 with a diagnostic naming the failing test. `tests/README.md` declares the convention as bash-native, no BATS, no vitest coupling. **There is no existing Python test for the sweep** — and fixture-based coverage in `sweep-schema.test.ts` tests the TS *parser*, not the Python *emitter*, so it cannot exercise the new hand-rolled frontmatter parser at all. |

---

## No Analog Found

| File / change | Role | Data Flow | Reason |
|---|---|---|---|
| `conversation-store.ts` — **row creation from a WS frame** | store mutator | event-driven CRUD | **No WS path anywhere calls `updateFleetSessions` or `removeFleetSession`** (grep-verified: the four `updateFleetSessions` call sites are `AppShell.tsx:728, 752, 779, 2370`; the one `removeFleetSession` call site is `:2400` — all request-response or manual). The `gone` frame is fully wired end-to-end (`makeGoneFrame` `wire-protocol.ts:497` → `subscription-registry.ts:221-238` → `fleet-status-client.ts:163-175` → `AppShell.tsx:559-563`) but **every consumer only marks per-session state**, never row membership. Best partial analogs, in order: `removeFleetSession` for the *shape* (§3a), `advanceSessionAiTitle` for the *additive-merge semantics* (§3b), `publishFleetStatusSessionGone` (`session-working-store.ts:731-751`) for *how a WS-driven store deletion is written*. |
| `ssh-poll-orchestrator.ts` — **widening source B's inline 2-segment fingerprint** | service | publish-gate | Phases 52/53/59/62/90 all widened **only** `computeFingerprint` (source A). No commit has ever extended the source-B fingerprint at `:1923`. The *discipline* transfers from Phase 62 (`0b586bfd`); the *diff* does not exist. Treat as new work with a borrowed rulebook. |

---

## Metadata

**Analog search scope:** `substrate/scripts/`, `src/backend/fleet-status/`,
`src/backend/database/routes/`, `src/backend/claude-session/`, `src/backend/distributor/`,
`src/ui/api/`, `src/ui/state/`, `src/ui/features/pretty-view/`,
`src/ui/features/pretty-conversations/`, `src/ui/features/terminal/`, `src/ui/lib/`,
`src/ui/shell/`, `src/ui/AppShell.tsx`, plus git history (`git log -S` on `contextPct`,
`activityMtime`, `dormant`).

**Files read this session:** 24 source files + 5 test files + 2 planning artifacts.
**Git archaeology:** 6 commits examined (`3014d8f0`, `8a467af1`, `02226aac`, `1a8b9d4e`,
`0b586bfd`, `89cac8ac`).
**Greps run:** visibilitychange listeners (10 sites), `updateFleetSessions`/`removeFleetSession`
callers, fingerprint sites, `upsert` in `src/ui`, `contextPct` sites, `dormant` sites,
conversation-store exports.

**Project-instruction check:** no `./CLAUDE.md` in the repo root; no `.claude/skills/` or
`.agents/skills/` directory present. User-level preferences apply but constrain workflow, not
patterns.

**Pattern extraction date:** 2026-09-16
