# Phase 118: First-class apps — sweep + registry (shape 2) - Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 11 (6 source + 5 test)
**Analogs found:** 10 / 11 (one greenfield — the wire filter)

**Read-only extraction.** Every analog range below was read verbatim in this session; excerpts are cited by file + line numbers so the executor can jump straight to them. RESEARCH.md's Q1-Q10 already scoped the extension shapes; this document nails each new file to its concrete analog code paragraph.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `substrate/scripts/fleet-status-sweep.py` | script (enumerator) | file-I/O + subprocess → JSONL stdout | Same file — `_enumerate_identities` + `_build_identity_line` + `_resolve_pid_to_tmux_session` (siblings) | exact (sibling within same script) |
| `src/backend/fleet-status/sweep-schema.ts` | wire schema + lenient parser | JSONL string → typed buckets | Same file — `SweepIdentityLine` + `parseSweepJsonl` (sibling additions) | exact |
| `src/backend/fleet-status/wire-protocol.ts` | frame schema (zod discriminated union) | in-memory frame → WS-serializable object | Same file — `FrontendIdentityArchivedFrameSchema` + `makeIdentityArchivedFrame` (Phase 115 sibling, the freshest additive-only extension) | exact |
| `src/backend/fleet-status/subscription-registry.ts` | in-memory registry + publish + snapshot-on-subscribe | orchestrator publishes → fan-out to WS subscribers | Same file — the `SessionState` map + `publishIdentityGoneByName` + `publishIdentityArchived` + subscribe path | exact |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | per-host sweep adapter + reconciliation | JSONL parse result → publish calls | Same file — the identity reconciliation block at L1770-1792 (Phase 115 `67b4a7ef` — the exact template CONTEXT D-11 calls out) | exact |
| `src/backend/fleet-status/fleet-status-server.ts` | WS termination + subscribe wiring + **wire filter attach point** | inbound `{type:'subscribe'}` → `registry.subscribe(sendFrame, {userId})` | Same file — `handleFrontendConnection` at L164-285. **The filter itself is greenfield** — see § "Greenfield: wire filter" below. | partial (subscribe wiring exists; per-user filter does NOT) |
| `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` (NEW) | shell test driver | fixture tree → run sweep → assert JSONL | `substrate/scripts/tests/fleet-status-sweep.test.sh` (Phase 115 sibling driver, 395 lines) | exact |
| `src/backend/fleet-status/sweep-schema.test.ts` | vitest parser test | JSONL fixtures → typed buckets | Same file — the existing `makeIdentityLine`/`makePidLine` fixture helpers + round-trip tests | exact |
| `src/backend/fleet-status/subscription-registry.test.ts` | vitest publish/subscribe tests | publish call → assertions on received frames | Same file — Tests 1-7 (publish + snapshot + late-subscriber) | exact |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | vitest per-host reconciliation tests | mocked SSH channel + JSONL fixture → assert `MockRegistry.published*` arrays | Same file — Phase 115 "Test P115-06 archive-routing-N" cases (L7965-8060) + `MockRegistry` (L205-276) + `makeSweepJsonl` (L339-405) + `buildDeps` (L411-495) | exact |
| `src/backend/fleet-status/fleet-status-server.test.ts` | vitest WS integration test with **combinatorial filter matrix** | two subscribers with different userIds → publish → assert per-subscriber deliveries | Same file — the ephemeral-port WS harness pattern (L54-105) is the seam; the filter matrix itself is greenfield | partial (WS harness exists; filter matrix is new territory) |

---

## Pattern Assignments

### 1. `substrate/scripts/fleet-status-sweep.py` (script, file-I/O + subprocess → JSONL)

**Analogs (all in the same file):**
- `_enumerate_identities` (L981-1058) — the sibling directory-walk pattern for `~/fleet/apps/`.
- `_resolve_pid_to_tmux_session` (L548-597) — the subprocess-with-timeout precedent for `systemctl --user` calls.
- `_build_identity_line` (L818+) — the per-item builder pattern with per-item try/except containment.
- `main()` (L1086-1168) — the orchestration + emit-loop pattern.
- `_emit` (L1080-1083) — the compact JSONL emitter.

**Enumeration pattern to mirror** (`_enumerate_identities`, L1005-1058):

```python
1005:    out = []
1013:    seen_names: set[str] = set()
1014:    for root, archived_flag, root_label in (
1015:        (os.path.join(home, "fleet", "identities"), False, "identities"),
1016:        (os.path.join(home, "fleet", "identities-archive"), True, "identities-archive"),
1017:    ):
1018:        try:
1019:            with os.scandir(root) as it:
1020:                for entry in it:
1021:                    if not entry.is_dir(follow_symlinks=False):
1022:                        continue
1023:                    name = entry.name
1024:                    if not SAFE_NAME_RE.match(name):
1025:                        _log("identity_name_skipped", name=name[:40])
1026:                        continue
...
1049:        except FileNotFoundError:
1050:            # Either the live tree or archive tree may be absent — the
1051:            # archive tree in particular is only created on first retire.
1054:            continue
1055:        except OSError as e:
1056:            _log("identities_scandir_failed", errno=e.errno, root=root)
1057:            continue
1058:    return out
```

**Subprocess pattern to mirror** (`_resolve_pid_to_tmux_session`, L579-597):

```python
579:    try:
580:        result = subprocess.run(
581:            ["tmux", "display-message", "-p", "-t", pane, "#{session_name}"],
582:            capture_output=True,
583:            text=True,
584:            timeout=TMUX_TIMEOUT_SEC,
585:            env=child_env,
586:        )
587:    except subprocess.TimeoutExpired:
588:        _log("tmux_timeout", pid=pid, pane=pane)
589:        return None
590:    except Exception:
591:        _log("tmux_exec_failed", pid=pid, pane=pane,
592:             err=traceback.format_exc(limit=1).strip())
593:        return None
594:    if result.returncode != 0:
595:        return None
596:    name = result.stdout.strip()
597:    return name if name else None
```

**Emit pattern to reuse verbatim** (`_emit`, L1080-1083):

```python
1080:def _emit(record):
1081:    """Write one JSON line to stdout — compact, terminated with \\n."""
1082:    sys.stdout.write(json.dumps(record, separators=(",", ":")))
1083:    sys.stdout.write("\n")
```

**Main-loop orchestration to append into** (`main()`, L1092-1167):

```python
1092:    # ---- Enumerate identities from folder + PIDs from sessions dir. ----
1093:    identity_records = _enumerate_identities(home)
1094:    pid_records = _enumerate_pids(home)
...
1137:    # ---- Emit identity lines first (all Layer-1 tail scans run here). ----
1140:    for rec in identity_records:
1141:        line = _build_identity_line(...)
1155:        _emit(line)
1157:    # ---- Emit pid lines. Skip PIDs with no resolved identity ...
1159:    for pid, identity in resolved_pids:
1160:        if identity is None:
1161:            continue
1162:        line = _build_pid_line(...)
1165:        _emit(line)
1167:    sys.stdout.flush()
```

**Constants precedent to mirror** (L102, L114, L164):

```python
102:SCHEMA_VERSION = 1
114:SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
# (TMUX_TIMEOUT_SEC = 1.5 near L164 — the per-subprocess timeout precedent)
```

**Deltas from the identity analog:**
- New enumeration root: `os.path.join(home, "fleet", "apps")` (single root, no live/archive split).
- New slug regex: `APP_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")` (kebab-case + digit-inclusive, mirrors `create-app.sh:32`); 40-char cap.
- Add three thin `_systemd_*` helpers (or one `_systemd_show(slug)` one-shot per RESEARCH § Q6) that follow the tmux subprocess shape.
- `_build_app_line` returns `None` when D-01 checks (a) or (b) fail; returns a dict with `is_healthy=false` + `health_message` when (c) fails (D-02 carve-out); returns a fully-populated dict when all three pass.
- **Wire-name discipline (RESEARCH § Q1):** emit `snake_case` names — `line_kind`, `schema_version`, `slug`, `title`, `description`, `port`, `has_icon`, `created_at_ms`, `is_healthy`, `health_message`. Byte-identical to the TS `SweepAppLine` interface.
- **Per-app try/except discipline (RESEARCH § Pitfall 5):** unlike `_build_identity_line` (which fail-opens membership + nulls cosmetics), `_build_app_line` FAIL-CLOSES membership — a malformed `app.json` means the app is NOT emitted, not "emitted with null title". The per-app `try/except Exception` wrapper in `_enumerate_apps` guarantees other apps still emit.
- **healthMessage phrasing (CONTEXT D-03):** literal string `"not running — ask an agent to check on it"` (the user's steer; conversational register).

---

### 2. `src/backend/fleet-status/sweep-schema.ts` (wire schema + lenient parser)

**Analogs (all in the same file):**
- `SweepIdentityLine` (L126-153) — the sibling interface shape for `SweepAppLine`.
- `SweepPidLine` (L194-207) — the alternate sibling shape (simpler, shows a variant with no optional-nullable fields).
- `isSweepLineOfCurrentSchema` (L223-228) — the type guard to widen.
- `SweepParseResult` (L234-253) — the result shape to extend.
- `parseSweepJsonl` (L270-319) — the lenient parser to extend.
- `SWEEP_FIELD_PARITY` (L347-438) — the parity map to extend with C0-C7 (or leave alone with a comment; both are consistent with the existing discipline).

**Interface pattern to mirror** (`SweepIdentityLine`, L126-153):

```typescript
126:export interface SweepIdentityLine {
127:  line_kind: "identity";
128:  schema_version: SweepSchemaVersion;
129:  identity: string;
130:  dormant: boolean;
131:  recycled_at: boolean;
132:  recycle_requested: boolean;
133:  jsonl_path: string | null;
134:  layer1_recycling: boolean | null;
...
142:  role?: string | null;
143:  identity_cosmetics?: SweepRawCosmetics | null;
```

**Type-guard pattern to widen** (`isSweepLineOfCurrentSchema`, L223-228):

```typescript
223:export function isSweepLineOfCurrentSchema(obj: unknown): obj is SweepLine {
224:  if (obj === null || typeof obj !== "object") return false;
225:  const rec = obj as Record<string, unknown>;
226:  if (rec.schema_version !== SWEEP_SCHEMA_VERSION) return false;
227:  return rec.line_kind === "identity" || rec.line_kind === "pid";
228:}
```

**Parser dispatch pattern to extend** (`parseSweepJsonl`, L270-319):

```typescript
270:export function parseSweepJsonl(raw: string): SweepParseResult {
271:  const identityLines: SweepIdentityLine[] = [];
272:  const pidLines: SweepPidLine[] = [];
273:  let unknownLines = 0;
274:  let schemaMismatch = false;
...
280:  for (const rawLine of raw.split("\n")) {
...
307:    if (rec.line_kind === "identity") {
308:      identityLines.push(parsed as SweepIdentityLine);
309:    } else if (rec.line_kind === "pid") {
310:      pidLines.push(parsed as SweepPidLine);
311:    } else {
312:      // Unknown line_kind at the current schema version — forward-compat
313:      // marker, not a failure. Bump the counter for observability.
314:      unknownLines += 1;
315:    }
316:  }
317:
318:  return { identityLines, pidLines, unknownLines, schemaMismatch };
319:}
```

**Deltas from the identity analog:**
- Add `SweepAppLine` interface with `line_kind: "app"` + the seven D-05 fields (`slug`, `title`, `description`, `port: number | null`, `has_icon: boolean`, `created_at_ms: number`, `is_healthy: boolean`, `health_message: string | null`).
- Widen `SweepLine` union to `SweepIdentityLine | SweepPidLine | SweepAppLine`.
- Widen `isSweepLineOfCurrentSchema` L227 to include `|| rec.line_kind === "app"`.
- Add `appLines: SweepAppLine[]` to `SweepParseResult`.
- Add `const appLines: SweepAppLine[] = []` in parser locals; add `else if (rec.line_kind === "app") appLines.push(parsed as SweepAppLine)` between L310 and L311; return `appLines` in the result.
- **Do NOT bump `SWEEP_SCHEMA_VERSION`.** Adding a line kind is additive per the discipline that `unknownLines` documents — a newer Python emitting `app` lines against an older TS parser must degrade gracefully to `unknownLines += 1` (this is the rolling-deploy safety RESEARCH § Pitfall 6 relies on).
- Optional: add `C0..C7` entries to `SWEEP_FIELD_PARITY` (or add a docblock explaining why apps skip the parity table — either is fine per the existing convention; the parity table's type-safety benefit is real, so extending is preferred).

---

### 3. `src/backend/fleet-status/wire-protocol.ts` (frame schema)

**Analogs (all in the same file):**
- `FrontendIdentityArchivedFrameSchema` (L577-583) + `makeIdentityArchivedFrame` (L632-644) — the **freshest** additive-only frame addition (Phase 115 Plan 115-06). Exact template CONTEXT D-14 mirrors.
- `FrontendSnapshotFrameSchema` / `FrontendUpdateFrameSchema` / `FrontendGoneFrameSchema` (L518-536) — the three-shape session precedent (snapshot=array, update=one, gone=identifier).
- `FrontendOutboundFrame` discriminated union (L585-591) — the union to append to.
- `makeSnapshotFrame` / `makeUpdateFrame` / `makeGoneFrame` (L599-621) — the factory pattern with `schemaVersion` stamped automatically.

**Schema pattern to mirror** (`FrontendIdentityArchivedFrameSchema` + factory, L577-583 + L632-644):

```typescript
577:const FrontendIdentityArchivedFrameSchema = z.object({
578:  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
579:  type: z.literal("identity-archived"),
580:  name: z.string(),
581:  hostId: z.string(),
582:  hostname: z.string(),
583:});
...
632:export function makeIdentityArchivedFrame(
633:  name: string,
634:  hostId: string,
635:  hostname: string,
636:): FrontendOutboundFrameType {
637:  return {
638:    schemaVersion: FRAME_SCHEMA_VERSION,
639:    type: "identity-archived",
640:    name,
641:    hostId,
642:    hostname,
643:  };
644:}
```

**Discriminated union pattern to extend** (L585-591):

```typescript
585:export const FrontendOutboundFrame = z.discriminatedUnion("type", [
586:  FrontendSnapshotFrameSchema,
587:  FrontendUpdateFrameSchema,
588:  FrontendGoneFrameSchema,
589:  FrontendPongFrameSchema,
590:  FrontendIdentityArchivedFrameSchema,
591:]);
```

**Three-frame trio precedent to mirror** (`FrontendSnapshotFrame` / `FrontendUpdateFrame` / `FrontendGoneFrame`, L518-536):

```typescript
518:const FrontendSnapshotFrameSchema = z.object({
519:  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
520:  type: z.literal("snapshot"),
521:  states: z.array(SessionStateSchema),
522:});
524:const FrontendUpdateFrameSchema = z.object({
525:  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
526:  type: z.literal("update"),
527:  state: SessionStateSchema,
528:});
530:const FrontendGoneFrameSchema = z.object({
531:  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
532:  type: z.literal("gone"),
533:  hostId: z.string(),
534:  tmuxSession: z.string().nullable(),
535:  sessionId: z.string(),
536:});
```

**Deltas from the identity analogs:**
- Define an `AppStateSchema = z.object({...})` mirroring the seven `SweepAppLine` fields (camelCase on the wire since this is the frontend-facing shape — `hostId`, `slug`, `title`, `description`, `port: z.number().nullable()`, `hasIcon: z.boolean()`, `createdAt: z.string()` OR `createdAtMs: z.number()` per executor discretion, `isHealthy: z.boolean()`, `healthMessage: z.string().nullable()`).
- Add three frame schemas: `AppSnapshotFrameSchema` (`type: "app-snapshot"`, `apps: z.array(AppStateSchema)`), `AppUpdateFrameSchema` (`type: "app-update"`, `app: AppStateSchema`), `AppGoneFrameSchema` (`type: "app-gone"`, `hostId: z.string()`, `slug: z.string()`).
- Add three factories: `makeAppSnapshotFrame(apps)`, `makeAppUpdateFrame(app)`, `makeAppGoneFrame(hostId, slug)`.
- Append the three new schemas to the `FrontendOutboundFrame` discriminated union (L585-591).
- **Do NOT bump `FRAME_SCHEMA_VERSION`** — per the L542-575 docblock (Phase 115 lineage: additive extensions never bump; older clients drop unknown frame types at `default:` in `fleet-status-client.ts`). Same invariant every prior appearance/session/archived extension has followed since Phase 41.
- **Naming (CONTEXT Claude's Discretion):** kebab-`type` literals (`"app-snapshot"` / `"app-update"` / `"app-gone"`) match `"identity-archived"`. Consistent with existing verbs.

---

### 4. `src/backend/fleet-status/subscription-registry.ts` (in-memory registry + fan-out)

**Analogs (all in the same file):**
- The `SessionState` map + `subscribers` set (L160-161) — the sibling map pattern.
- `fanOut()` helper (L140-154) — the per-subscriber try/catch fan-out.
- `subscribe()` (L181-272) — the snapshot-on-subscribe path (particularly L195-208 for session snapshot, L216-230 for archived snapshot re-emit).
- `publishSessionState` (L274-290) — the publish-with-fan-out pattern.
- `publishIdentityArchived` (L292-312) — the idempotent-insert-with-fan-out pattern (the closest analog for `publishAppUpdate` since apps also need per-slug idempotence).
- `publishSessionGone` (L314-331) + `publishIdentityGoneByName` (L333-347) — the no-op-guard-then-delete-and-fan-out pattern.
- `makeKey` (L136-138) — the key composition precedent.
- `archivedIdentities` map (L175-178) — the sibling-map-plus-snapshot-re-emit pattern (the exact structural precedent for the new `apps` map + subscribe-path snapshot re-emit).

**Sibling-map pattern to mirror** (L160-178):

```typescript
159:export function createSubscriptionRegistry(): SubscriptionRegistry {
160:  const state = new Map<string, SessionState>();
161:  const subscribers = new Set<SendFrame>();
...
175:  const archivedIdentities = new Map<
176:    string,
177:    { name: string; hostId: string; hostname: string }
178:  >();
```

**Fan-out helper (unchanged, reused)** (L140-154):

```typescript
140:function fanOut(
141:  subscribers: Set<SendFrame>,
142:  frame: FrontendOutboundFrameType,
143:): void {
144:  for (const send of subscribers) {
145:    try {
146:      send(frame);
147:    } catch (err) {
148:      systemLogger.warn("Fleet-status fan-out failed for one subscriber", {
149:        operation: "fleet_status_fanout_failed",
150:        error: err instanceof Error ? err.message : "unknown",
151:      });
152:    }
153:  }
154:}
```

**Snapshot-on-subscribe pattern to mirror** (L181-231):

```typescript
181:    subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void {
182:      const wasEmpty = subscribers.size === 0;
183:      subscribers.add(sendFrame);
...
195:      const snapshot = makeSnapshotFrame(
196:        Array.from(state.values()).map((s) => ({
197:          ...s,
198:          contextPct: getContextPct(s.hostId, s.tmuxSession ?? "") ?? null,
199:        })),
200:      );
201:      try {
202:        sendFrame(snapshot);
203:      } catch (err) { /* warn */ }
...
216:      for (const entry of archivedIdentities.values()) {
217:        try {
218:          sendFrame(
219:            makeIdentityArchivedFrame(entry.name, entry.hostId, entry.hostname),
220:          );
221:        } catch (err) { /* warn */ }
222:      }
```

**Idempotent publish pattern to mirror** (`publishIdentityArchived`, L292-312):

```typescript
292:    publishIdentityArchived(
293:      name: string,
294:      hostId: string,
295:      hostname: string,
296:    ): void {
297:      const key = `${hostId}::${name}`;
298:      const existing = archivedIdentities.get(key);
299:      // Idempotent: if the registry already knows this archived identity
300:      // with byte-identical fields, no fanout. Prevents per-tick churn ...
301:      if (
302:        existing !== undefined &&
303:        existing.name === name &&
304:        existing.hostId === hostId &&
305:        existing.hostname === hostname
306:      ) {
307:        return;
307:        return;
308:      }
309:      archivedIdentities.set(key, { name, hostId, hostname });
310:      fanOut(subscribers, makeIdentityArchivedFrame(name, hostId, hostname));
311:    },
```

**Gone-with-no-op-guard pattern to mirror** (`publishIdentityGoneByName`, L333-347):

```typescript
333:    publishIdentityGoneByName(hostId: string, identityName: string): void {
334:      const key = makeKey(hostId, identityName);
335:      const existing = state.get(key);
336:      if (existing === undefined) {
337:        return;
338:      }
339:      state.delete(key);
340:      fanOut(
341:        subscribers,
342:        makeGoneFrame(hostId, existing.tmuxSession, existing.sessionId),
343:      );
344:    },
```

**Deltas from the identity analogs:**
- Add sibling map: `const apps = new Map<string, AppState>()` (key `` `${hostId}:${slug}` `` — do NOT reuse `makeKey` because RESEARCH § Q9 flagged the tmuxSession-vs-slug collision risk; introduce a small `makeAppKey(hostId, slug)` or inline the template literal).
- Add three interface methods on `SubscriptionRegistry`: `publishAppUpdate(hostId: string, app: AppState): void`, `publishAppGoneByHostSlug(hostId: string, slug: string): void`, `getAppSnapshot(): AppState[]`. **Do NOT add `publishAppSnapshot` as a public method** — per RESEARCH § Q3 the identity codebase does not have one either; snapshot-on-subscribe reads `apps.values()` at subscribe time.
- Extend `subscribe()` (L216-230 site): after the existing `archivedIdentities` re-emit loop, add an app-snapshot emit: `sendFrame(makeAppSnapshotFrame(Array.from(apps.values())))`. The per-user filter (see § below) is applied to the emitted list.
- `publishAppUpdate`: set map entry + `fanOut(subscribers, makeAppUpdateFrame(app))`. Idempotence discipline optional — health-flips need to fan out, so byte-equality guard would suppress the wrong thing. Skip the guard; every publish call fans out.
- `publishAppGoneByHostSlug`: mirror `publishIdentityGoneByName` shape — key lookup, no-op-if-missing (prevents churn), delete, fan out `makeAppGoneFrame(hostId, slug)`.

---

### 5. `src/backend/fleet-status/ssh-poll-orchestrator.ts` (per-host adapter + reconciliation)

**Analogs (all in the same file, from Phase 115 `67b4a7ef`):**
- `PerHostState` interface (L426-486) — the struct to extend.
- `lastTickLiveTreeIdentities` field declaration + docblock (L476-485) — the exact template for `lastTickLiveApps`.
- The identity reconciliation block (L1770-1792) — the exact code paragraph CONTEXT D-11 says to mirror verbatim.
- The `PerHostState` initialization site (L2994-3015) — where the new `lastTickLiveApps: new Set<string>()` goes.
- The compose-and-publish loop above the reconciliation (L1760-1768) — the analog for the app compose+publish loop.

**PerHostState field pattern to mirror** (L476-485):

```typescript
476:  // Phase 115 hotfix (2026-09-18): per-host reconciliation set of live-tree
477:  // identity names seen in the last successful sweep tick. Used at the end of
478:  // each successful sweep to diff against the current tick's live-tree set
479:  // and emit publishSessionGone for any identity that was cached but is no
480:  // longer emitted (e.g. archived, folder deleted, folder renamed). Closes
481:  // the "cache diverges from sweep" gap surfaced by sky's archive UAT
482:  // 2026-09-17. Reconciliation ONLY runs on sweep success (parsed.identityLines
483:  // is a full answer) — never on {ok:false} sweep failures, so transient SSH
484:  // hiccups don't flap the sidebar.
485:  lastTickLiveTreeIdentities: Set<string>;
```

**Init-site pattern to mirror** (L3004-3008):

```typescript
3004:        // Phase 115 hotfix (2026-09-18): initialized empty so the FIRST
3005:        // successful sweep for this host publishes nothing gone (no previous
3006:        // tick to diff against). Subsequent ticks compare against this and
3007:        // emit publishSessionGone for anything that dropped from the live tree.
3008:        lastTickLiveTreeIdentities: new Set<string>(),
```

**Reconciliation block to mirror verbatim** (L1770-1792 — THE key template):

```typescript
1770:    // Phase 115 hotfix (2026-09-18): reconcile cache with sweep.
1771:    // Any identity that was in the previous tick's live-tree set but is NOT
1772:    // in this tick's live-tree set (because she archived, or her folder was
1773:    // deleted/renamed, or she stopped existing for any other silent reason)
1774:    // gets a publishSessionGone so the registry drops her from the cached
1775:    // state map. Without this, the cache holds stale identities forever
1776:    // whenever they transition off the live tree via a path that doesn't
1777:    // emit an explicit lifecycle event (archive is one such path — sky UAT
1778:    // 2026-09-17 root cause). This runs ONLY on sweep-success — the {ok:false}
1779:    // early returns above never reach here, so transient SSH failures don't
1780:    // flap the sidebar.
1781:    const thisTickLiveTreeIdentities = new Set<string>();
1782:    for (const line of parsed.identityLines) {
1783:      if (line.archived !== true) {
1784:        thisTickLiveTreeIdentities.add(line.identity);
1785:      }
1786:    }
1787:    for (const previousName of hostState.lastTickLiveTreeIdentities) {
1788:      if (!thisTickLiveTreeIdentities.has(previousName)) {
1789:        deps.registry.publishIdentityGoneByName(host.id, previousName);
1790:      }
1791:    }
1792:    hostState.lastTickLiveTreeIdentities = thisTickLiveTreeIdentities;
```

**Compose-and-publish loop pattern to mirror** (L1760-1768):

```typescript
1760:          host.id,
1761:          host.name,
1762:        );
1763:        continue;
1764:      }
1765:      const fetched = identityLineToPerIdentityFetched(identityLine, hostState);
1766:      const cached = hostState.identityRecycleState.get(identityLine.identity);
1767:      composeAndPublishPerIdentity(hostState, liveTmuxSet, fetched, cached);
1768:    }
```

**Deltas from the identity analog:**
- **New PerHostState field:** `lastTickLiveApps: Set<string>` immediately below `lastTickLiveTreeIdentities` at L485. Recommendation per RESEARCH § Q2: sibling field, NOT new struct. Same docblock discipline as L476-485 (Phase 118 stanza citing D-11/D-12).
- **New init at L3008:** `lastTickLiveApps: new Set<string>(),` immediately after the existing `lastTickLiveTreeIdentities: new Set<string>(),`.
- **New compose-and-publish loop** just before or after the identity loop (L1760-1768 site): iterate `parsed.appLines`, for each call `deps.registry.publishAppUpdate(host.id, adaptAppLineToState(appLine))`. The adapter is a straight field-copy (Python `is_healthy` → TS `isHealthy`, `has_icon` → `hasIcon`, etc.) — mirrors `identityLineToPerIdentityFetched` in shape.
- **New reconciliation block** immediately after the identity reconciliation at L1792 (Claude's discretion per CONTEXT — inline next to identity is the recommendation):
  ```typescript
  const thisTickLiveApps = new Set<string>();
  for (const line of parsed.appLines) {
    thisTickLiveApps.add(line.slug);   // ALL slugs in the picture — healthy OR unhealthy (D-02)
  }
  for (const previousSlug of hostState.lastTickLiveApps) {
    if (!thisTickLiveApps.has(previousSlug)) {
      deps.registry.publishAppGoneByHostSlug(host.id, previousSlug);
    }
  }
  hostState.lastTickLiveApps = thisTickLiveApps;
  ```
- **Load-bearing constraint (RESEARCH § Pitfall 3):** the reconciliation set tracks slugs that PASSED D-01 OR D-02 (i.e. every app that received a publish this tick), NOT "slugs that are healthy". Otherwise unhealthy apps get gone-and-re-added every tick, defeating D-13.
- **Load-bearing constraint (RESEARCH § Pitfall 1):** the block sits INSIDE the sweep-success scope, AFTER the compose-publish loops, BEFORE the `return { ok: true, ... }`. All `{ok:false}` early-returns above must skip it — same guard the identity reconciliation already gets by virtue of its position.

---

### 6. `src/backend/fleet-status/fleet-status-server.ts` (WS termination + subscribe wiring)

**Analogs (in the same file):**
- `handleFrontendConnection` (L164-285) — the WS auth → subscribe → fan-out termination pattern.
- The `registry.subscribe(sendFrame, {userId})` call site (L254-258) — where userId is already threaded through.
- Auth block (L174-214) — where `userId` gets extracted from the JWT.

**Subscribe-wiring pattern already in place** (L247-258):

```typescript
247:    if (frame.type === "subscribe" && !subscribeHandled) {
248:      subscribeHandled = true;
249:      systemLogger.info("Fleet-status frontend subscribed", {
250:        operation: "fleet_status_subscribed",
251:        userId,
252:        sessionId,
253:      });
254:      disposer = registry.subscribe((outFrame) => {
255:        if (ws.readyState === WebSocket.OPEN) {
256:          ws.send(JSON.stringify(outFrame));
257:        }
258:      }, { userId: userId! });
```

**Deltas from the analog — see § "Greenfield: wire filter" below.** The subscribe wiring is fine as-is; the per-user filter is a new concern that layers ON the existing plumbing.

---

## Greenfield: wire filter (per-user host-visibility on app frames)

**Critical finding (from RESEARCH § Q4, verified in this session):** `grep -rn "checkHostAccess" src/backend/` returns exactly ONE hit — the export site in `host-resolver.ts:497`. **No callers under `src/backend/fleet-status/`.** Every subscriber to `/fleet-status/ws` currently receives every host's frames. There is no existing identity filter to copy.

Phase 118 lands the FIRST wire filter in fleet-status. The "analog" is `checkHostAccess` itself as a composed dependency, not a pattern-mimic of an existing filter.

**checkHostAccess signature (`src/backend/ssh/host-resolver.ts:497-518`):**

```typescript
497:export async function checkHostAccess(
498:  hostId: number,
499:  userId: string,
500:  hostUserId: string,
501:  requiredPermission: "read" | "execute" = "execute",
502:): Promise<boolean> {
503:  if (userId === hostUserId) return true;
504:
505:  try {
506:    const { PermissionManager } =
507:      await import("../utils/permission-manager.js");
508:    const permissionManager = PermissionManager.getInstance();
509:    const accessInfo = await permissionManager.canAccessHost(
510:      userId,
511:      hostId,
512:      requiredPermission,
513:    );
514:    return accessInfo.hasAccess;
515:  } catch {
516:    return false;
517:  }
518:  }
```

**Filter placement recommendation (RESEARCH § Q4 — read verbatim in that section):** apply at the **registry fan-out layer**, not at the WS server layer. Rationale:
1. Correctly scopes to app frames only (session frames stay sync).
2. Same filter runs uniformly for snapshot + updates + gone.
3. First-class registry concern → identity frames can adopt cleanly later (D-15's "or will be").

**Design sketch (RESEARCH § Q4 Code Examples, lines 712-738):**

```typescript
type SubscriberEntry = {
  send: SendFrame;
  userId: string;
};
const subscribers = new Set<SubscriberEntry>();  // widened from Set<SendFrame>

type AppFrameFilter = (
  frame: AppSnapshotFrame | AppUpdateFrame | AppGoneFrame,
  userId: string,
) => AppSnapshotFrame | AppUpdateFrame | AppGoneFrame | null;

async function fanOutApp(
  entries: Set<SubscriberEntry>,
  frame: AppFrameForFilter,
  filter: AppFrameFilter,
) {
  for (const entry of entries) {
    const projected = filter(frame, entry.userId);
    if (projected === null) continue;
    try { entry.send(projected); } catch (err) { /* existing warn */ }
  }
}
```

**Load-bearing filter properties:**
- **Async unavoidable.** `checkHostAccess` returns `Promise<boolean>`. Split `fanOut` into sync (`fanOut` for session frames) and async (`fanOutApp` for app frames using `Promise.allSettled`). A slow filter for one subscriber must not block the others.
- **Snapshot needs REWRITE, not accept/reject.** A snapshot carries `apps: AppState[]`; a subscriber may see some hosts but not others. The filter returns a projected copy of the snapshot with only visible-host apps. Update and gone are yes/no since they're per-app.
- **Backward-compat with no-ctx subscribers.** Existing session-only tests call `subscribe(sendFrame)` with no ctx. When ctx is absent, DO NOT apply the filter (skip filtering, deliver as before). This preserves the existing session-frame semantics.
- **LRU cache recommended.** `filterAppFrame` should keep a per-user host-access LRU (30-60s TTL) to avoid re-hitting PermissionManager on every frame. RESEARCH § Q4 A3 flagged this; PermissionManager may already cache internally — verify at execute time.
- **Wire-boundary application both at snapshot-on-subscribe AND fan-out.** RESEARCH § Pitfall 2: filter at BOTH sites. If it's only applied on subscribe, subsequent updates leak forbidden hosts. Best implementation: attach userId to each subscriber entry so `publishApp*` fan-out consults it uniformly.

**Where the filter code goes:**
- New helper: `src/backend/fleet-status/app-frame-filter.ts` — composes `checkHostAccess` per subscriber+host with a small TTL cache. Consumes host records (needs the `HostRecord.userId` for `checkHostAccess`'s `hostUserId` argument) — the registry doesn't know host owners, so this needs a `resolveHostOwnerById(hostIdStr) → Promise<{hostIdNum, hostUserId}|null>` dependency injected from `starter.ts`. Match the pattern of `resolveHostRecordByName` already threaded through `startFleetStatusServer`.
- Registry factory takes an optional `appFrameFilter` option; when absent (unit tests) fan-out is unfiltered.

---

## Shared Patterns

### Additive extension discipline
**Source:** `src/backend/fleet-status/wire-protocol.ts:542-575` docblock (Phase 115) + `src/backend/fleet-status/sweep-schema.ts:307-315` parser (Phase 92).
**Apply to:** every new schema, frame, and JSONL line kind in this phase.

Rule: never bump the version constant for additive changes. The frontend has a `default: /* drop */` branch (`fleet-status-client.ts`) and the TS parser has a `unknownLines += 1` branch — both are the load-bearing forward-compat mechanisms that make hot-reload deploys safe (RESEARCH § Pitfall 6).

### Lenient-parser + fail-open-per-item
**Source:** `substrate/scripts/fleet-status-sweep.py:1049-1057` (scandir fail-open) + `substrate/scripts/fleet-status-sweep.py:850-862` (per-identity try/except; noted by RESEARCH § Q8).
**Apply to:** `_build_app_line` per-app try/except; `_enumerate_apps` outer try/except; the `sweep-schema.ts` app-line dispatch.

Rule: one bad app must never break the whole sweep. One bad JSONL line must never break parseSweepJsonl. Log to stderr with a stable structured operation key; return None / continue.

### Reconciliation-on-success gate
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts:1770-1792` (Phase 115 `67b4a7ef`).
**Apply to:** the new app-reconciliation block. Must sit INSIDE the sweep-success scope; all `{ok:false}` early-returns above must bypass it. Transient SSH failure must not flap the sidebar.

### Presence-is-meaning (no persistence)
**Source:** the entire fleet-status subsystem discipline (CONTEXT D-10; `subscription-registry.ts` has no DB imports).
**Apply to:** the new `apps` map. Restart wipes it; next sweep rebuilds it. No `DatabaseSaveTrigger` calls. No SQLite tables. No Drizzle additions.

### Subprocess argv discipline
**Source:** `substrate/scripts/fleet-status-sweep.py:580-586` (tmux).
**Apply to:** every new `systemctl --user` call in `_build_app_line`. Use argv `["systemctl", ...]` form with `subprocess.run(..., timeout=1.5)`. Never shell=True. The slug regex (`APP_SLUG_RE`) is a defense-in-depth belt against argv injection (RESEARCH § Security Domain).

---

## Test Pattern Assignments

### `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` (NEW)

**Analog:** `substrate/scripts/tests/fleet-status-sweep.test.sh` (395 lines) — the existing Phase 115 driver for the archive-tree branch. Also `fleet-status-sweep-appearance.sh` (529 lines) — sibling driver for appearance/frontmatter branch.

**Harness pattern to mirror** (L1-105 of the analog):

```bash
1:#!/usr/bin/env bash
27:set -u  # -e is NOT set — the script uses explicit assert helpers so a failing
28:        # assert does not silently skip subsequent tests.
30:# ---- path resolution ----
31:SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
32:REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
33:SWEEP="$REPO_ROOT/substrate/scripts/fleet-status-sweep.py"
...
45:# ---- scratch fixture ----
46:FIXTURE=""
47:FIXTURE=$(mktemp -d)
49:cleanup() {
50:  [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"
51:}
52:trap cleanup EXIT
...
67:assert_eq() {
68:  local expected="$1" actual="$2" msg="${3:-assert_eq}"
69:  if [ "$expected" != "$actual" ]; then
70:    fail "$msg: expected='$expected' got='$actual'"
71:  fi
72:}
...
74:run_test() {
```

**Deltas from the analog:**
- Test cases per RESEARCH § Q7 (Case 1-6): good-app, malformed-json, no-unit, stopped-unit, no-icon, with-icon.
- **CI gate for systemd cases (per RESEARCH A4):** cases 3 (no-unit) + 4 (stopped-unit) need real `systemctl --user` — gate on `systemctl --user is-system-running >/dev/null 2>&1 || skip` or the equivalent per fleet-status-sweep.test.sh precedent. Documented in CONTEXT D-23 as agent-UAT territory.

---

### `src/backend/fleet-status/sweep-schema.test.ts` (extend)

**Analogs (all in the same file):**
- `makeIdentityLine` (L29-43) + `makePidLine` (L45-66) — the fixture helpers to sibling.
- Existing round-trip + schema-mismatch + malformed-line tests (rest of file).

**Fixture pattern to mirror** (`makeIdentityLine`, L29-43):

```typescript
29:function makeIdentityLine(
30:  overrides: Partial<SweepIdentityLine> = {},
31:): SweepIdentityLine {
32:  return {
33:    line_kind: "identity",
34:    schema_version: 1,
35:    identity: "tabitha",
36:    dormant: false,
37:    recycled_at: false,
...
43:}
```

**Deltas:**
- Add `makeAppLine(overrides: Partial<SweepAppLine> = {}): SweepAppLine` fixture.
- Add tests: `parseSweepJsonl` dispatches `app` lines into `appLines`; unknown line kinds still bump `unknownLines`; schema-mismatch on an app line flips `schemaMismatch`; empty app lines yield empty `appLines` array; type guard accepts `line_kind: "app"` at schema version 1.
- Optional: extend `SWEEP_FIELD_PARITY` walk with the C0-C7 entries + walk assertion.

---

### `src/backend/fleet-status/subscription-registry.test.ts` (extend)

**Analog:** existing Tests 1-7 (L52-210) — publish + snapshot + late-subscriber patterns.

**Test pattern to mirror** (Test 2 — publish-then-fan-out, L58-76):

```typescript
58:  it("Test 2: publishSessionState inserts state at correct key and fans out update frames", () => {
59:    const registry = createSubscriptionRegistry();
60:    const receivedFrames: FrontendOutboundFrameType[] = [];
61:    registry.subscribe((frame) => receivedFrames.push(frame));
62:
63:    // Clear the snapshot frame
64:    receivedFrames.length = 0;
65:
66:    const state = makeState("host-42", "tina", "session-1");
67:    registry.publishSessionState("host-42", state);
68:
69:    const updateFrames = receivedFrames.filter((f) => f.type === "update");
70:    expect(updateFrames).toHaveLength(1);
71:    expect(updateFrames[0]).toMatchObject({...});
```

**Deltas:**
- Add tests: `publishAppUpdate` inserts into map + fans out `app-update` frame; late subscriber gets `app-snapshot` frame containing all previously published apps; `publishAppGoneByHostSlug` removes from map + fans out `app-gone` frame; `publishAppGoneByHostSlug` for a missing key is a no-op.
- If filter widening lands here (Plan 118-05): tests for the `subscribers` widening to `SubscriberEntry` + backward-compat with no-ctx subscribers.

---

### `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (extend)

**Analogs (all in the same file):**
- `MockRegistry` class (L205-276) — extend with `publishedAppUpdates` + `publishedAppGone` arrays + `publishAppUpdate` + `publishAppGoneByHostSlug` stubs.
- `makeSweepJsonl` (L339-405) — extend with an `apps` parameter emitting `line_kind: "app"` lines.
- `buildDeps` (L411-495) — no change needed; already accepts `overrides`.
- Phase 115 archive-routing tests (L7965-8060) — the exact template for the new reconciliation tests.

**MockRegistry-extension pattern to mirror** (L253-259 — the Phase 115 identity-scoped gone stub):

```typescript
247:  // Phase 115 hotfix (2026-09-18): identity-scoped gone routes through the
248:  // same publishedGone list so existing assertions still see it. tmuxSession
249:  // and sessionId here are the identity name and the empty string respectively
250:  // — the mock doesn't hold a state map, so we surface what we know from the
251:  // call, mirroring the real registry's read-then-emit shape at the level of
252:  // fidelity these tests need.
253:  publishIdentityGoneByName(hostId: string, identityName: string): void {
254:    this.publishedGone.push({
255:      hostId,
256:      tmuxSession: identityName,
257:      sessionId: "",
258:    });
259:  }
```

**makeSweepJsonl-extension pattern to mirror** (L339-372 — the identity branch of the fixture):

```typescript
339:function makeSweepJsonl(input: {
340:  identities: Array<Partial<SweepIdentityLine> & { identity: string }>;
341:  pids: Array<Partial<SweepPidLine> & { identity: string; pid: number }>;
342:  schemaVersionOverride?: number;
343:}): string {
...
346:  for (const raw of input.identities) {
347:    const line: SweepIdentityLine = {
348:      line_kind: "identity",
349:      schema_version: version,
350:      identity: raw.identity,
...
371:    lines.push(JSON.stringify(line));
372:  }
```

**Deltas:**
- Extend `MockRegistry` with `publishedAppUpdates: Array<{ hostId: string; app: AppState }>`, `publishedAppGone: Array<{ hostId: string; slug: string }>` (per RESEARCH § Q9 recommendation — do NOT shoehorn into `publishedGone`; keep app-scoped arrays distinct). Add stub methods that push into these arrays. Add `publishAppUpdate` + `publishAppGoneByHostSlug` to the interface so TypeScript catches drift.
- Extend `makeSweepJsonl` fixture with `apps?: Array<Partial<SweepAppLine> & { slug: string }>`. Emit `line_kind: "app"` lines with sensible defaults.
- Add reconciliation tests per RESEARCH § Q7 A1-A5:
  - A1 first sweep publishes updates, no gone.
  - A2 second sweep with one app missing publishes exactly one gone.
  - A3 sweep failure between two success ticks does NOT flap (zero gone across the sequence).
  - A4 health flip → one `publishAppUpdate` on tick 2, zero `publishAppGoneByHostSlug`.
  - A5 schema mismatch on app lines triggers batch fallback (latches `sweepSchemaMismatchThisConnection`).

---

### `src/backend/fleet-status/fleet-status-server.test.ts` (extend)

**Analog:** the ephemeral-port WS harness pattern (L54-105) — `connectAndReceive` helper + `beforeEach`/`afterEach` server lifecycle (L107-140+).

**Harness pattern to mirror** (`connectAndReceive`, L54-105):

```typescript
54:function connectAndReceive(
55:  url: string,
56:  headers: Record<string, string>,
57:  firstMessage?: string,
58:): Promise<{ frames: FrontendOutboundFrameType[]; closeCode?: number }> {
59:  return new Promise((resolve, reject) => {
60:    const frames: FrontendOutboundFrameType[] = [];
61:    let closeCode: number | undefined;
62:
63:    const ws = new WebSocket(url, { headers });
...
76:    ws.on("message", (raw) => {
77:      try {
78:        const frame = JSON.parse(raw.toString()) as FrontendOutboundFrameType;
79:        frames.push(frame);
```

**Deltas (per RESEARCH § Q7 filter tests + CONTEXT D-21 combinatorial matrix):**
- Extend `makeStubAuthManager` to accept a token→userId map so tests can auth two different users.
- Add combinatorial filter tests: two subscribers with distinct userIds; publish `app-update` for a host only one of them can access via a stubbed `checkHostAccess`; assert only the accessing subscriber received. Repeat for `app-snapshot` (projected list) and `app-gone` (yes/no).
- Since the filter needs `checkHostAccess`, either inject a filter factory into `createSubscriptionRegistry` (recommended per § Greenfield above) or `vi.mock` the host-resolver module. Prefer injection for testability.

---

## No Analog Found

| File | Reason |
|------|--------|
| `src/backend/fleet-status/app-frame-filter.ts` (NEW — per Plan 118-05) | No existing per-frame filter in `src/backend/fleet-status/`. `checkHostAccess` exists as a single-authority function but has ZERO callers in the fleet-status tree today. Phase 118 lands the first invocation. Build against `checkHostAccess`'s signature + `PermissionManager.canAccessHost` semantics (documented above); model the LRU wrapper on the general async-memoize shape (no direct fleet-status precedent). See § "Greenfield: wire filter" above for the full design derivation. |

---

## Metadata

**Analog search scope:**
- `src/backend/fleet-status/` (full directory — every source + test file listed via `ls`)
- `substrate/scripts/` + `substrate/scripts/tests/` (Python sweep + shell test drivers)
- `src/backend/ssh/host-resolver.ts` (checkHostAccess authority)

**Files scanned:** 41 (34 fleet-status TS + 3 Python scripts + 3 shell test drivers + 1 host-resolver)

**Verbatim reads this session:**
- `substrate/scripts/fleet-status-sweep.py` (L102, L114, L164, L548-597, L818-870, L981-1058, L1061-1083, L1086-1183 — every load-bearing anchor RESEARCH cites)
- `src/backend/fleet-status/sweep-schema.ts` (L1-438 in full)
- `src/backend/fleet-status/subscription-registry.ts` (L1-377 in full)
- `src/backend/fleet-status/wire-protocol.ts` (L515-644 — outbound frame surface)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (L426-486, L1760-1799, L2980-3016)
- `src/backend/fleet-status/fleet-status-server.ts` (L160-285)
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (L200-405)
- `src/backend/fleet-status/sweep-schema.test.ts` (L1-90)
- `src/backend/fleet-status/subscription-registry.test.ts` (L1-130)
- `src/backend/fleet-status/fleet-status-server.test.ts` (L1-120)
- `substrate/scripts/tests/fleet-status-sweep.test.sh` (L1-100)
- `src/backend/ssh/host-resolver.ts` (L490-518)
- Commit `67b4a7ef` metadata (verified via `git log`)

**Pattern extraction date:** 2026-09-18

**Grep-verified findings:**
- `checkHostAccess` callers in `src/backend/`: exactly 1 (the export site in `host-resolver.ts:497`). No fleet-status callers. **Confirms RESEARCH's critical finding: Plan 118-05 is greenfield in this codebase.**

## PATTERN MAPPING COMPLETE
