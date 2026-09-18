# Phase 118: First-class apps — sweep + registry (shape 2) - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning
**Source:** Shape file at `.planning/campaigns/first-class-apps/shape-sweep-and-registry-api.md` (opened + greenlit 2026-09-18 via /build → /open). This CONTEXT.md is seeded from that shape file per the build-skill rule "seed discuss-phase from the shape file — do not re-do the discovery /open already did." Discuss-phase surfaced no additional unresolved decisions; the shape file's `## Scope edges` and `## Philosophy` sections are the locked ruleset.

<domain>
## Phase Boundary

Extend the existing per-box fleet-status sweep to also enumerate `~/fleet/apps/*/` on each managed box, cross-check each app against systemd (unit present + active), and emit per-app findings inside the same one-shot SSH exec that already carries identity discovery. Skynet holds a new in-memory picture keyed by `hostId:slug` (no DB, no schema, no migration — identity-discovery discipline). Per-host reconciliation-on-success removes disappeared apps from the picture. New frame types (`app-snapshot` / `app-update` / `app-gone`) piggyback on the existing fleet-status live subscription channel — not a separate HTTP endpoint — filtered per-user by the existing host-visibility function.

**Cross-repo scope:** Skynet backend (TS: orchestrator + subscription registry + wire protocol) + fleet-substrate `fleet-status-sweep.py` (Python, one line-type added to the JSONL contract) + `sweep-schema.ts` (the wire schema for what a sweep sees). All three codebases live in this repo (`~/skynet-vision`). The Python sweep script is distributed to every managed host by Skynet's fleet-substrate distributor.

**Relation to prior phases and adjacent shapes.** Phase 115 (identity-archiving, `67b4a7ef`) landed the per-host reconciliation-on-success pattern for identities in `ssh-poll-orchestrator.ts` — Phase 118 adopts the same shape for apps. Phase 92 built the batched sweep script itself; Phase 118 grows it by one line-type. Phase 39 wired userId into the subscription-registry `onFirstSubscriber` callback — Phase 118 leans on that to gate app frames by `checkHostAccess`. Shape 1 of the first-class-apps campaign (closed 2026-09-18) delivered the disk side: the canonical `~/fleet/apps/<slug>/` convention, the two-field `app.json` metadata card (title + description), the systemd unit that runs each app. Shape 3 (sidebar surface) and shape 4 (app-pane content type + proxy) both depend on shape 2's picture landing and can proceed in parallel afterward.

</domain>

<decisions>
## Implementation Decisions

### Inclusion filter — "not usable" means "not in the picture"

- **D-01: Three functional checks decide inclusion.** For each folder under `~/fleet/apps/` on a reachable box, the app enters the picture if and only if: (a) the folder contains a readable `app.json` that parses as JSON, (b) a corresponding systemd `--user` unit exists (named per shape 1's convention `app-<slug>.service`), and (c) that unit is currently active per `systemctl --user is-active`. Any miss on (a), (b), or (c) means the app does not appear. **Rationale (shape 2 grill, Ashley 2026-09-18):** "you can't actually use the app."

- **D-02: The one carve-out — unit exists but currently stopped emits as unhealthy.** If (a) and (b) pass but (c) fails, the app STILL appears in the picture with `isHealthy: false` and a short human-readable `healthMessage` string. Rationale: this is the "definitely-was-an-app, definitely-broken-right-now" state — silent disappearance would confuse the user, and the systemctl status check is already free. **All other misses (no folder, no card, no unit) are truly "not really an app present" and correctly emit nothing.**

- **D-03: Backend authors the healthMessage.** For the one health case, the backend emits a ready-to-render string (e.g. "not running — ask an agent to check on it"). Frontend renders verbatim. Rationale: the backend knows the diagnostic; future health types are backend-only changes with no frontend rewrite. **The healthMessage string content is Claude's discretion at execute time — pick a phrase in the same "ask an agent to check on it" register.**

- **D-04: One health tier, not many.** Shape 2 exposes ONE binary axis (`isHealthy` + optional `healthMessage`). It does NOT chase crash-loop counting, port collisions, application-level healthchecks, response-time probes, or any other failure surface. A future shape may add more tiers by widening the wire schema — shape 2 does not open that door.

### Per-app emitted fields

- **D-05: Emit exactly seven fields per app.** For each app that passes D-01 (or D-02's carve-out): `hostId` (which box), `slug` (folder name), `title` + `description` (from `app.json`), `port` (from the systemd unit's `PORT` env), `hasIcon` (boolean: is there an `icon.webp` file in the folder?), `createdAt` (folder mtime as ISO), `isHealthy` (boolean), and — only when `isHealthy: false` — `healthMessage` (string). No other fields. **Deliberately not included: owning-agent / provenance** (shape 2 grill, Ashley: "no benefit to knowing which agent created or owns an app").

- **D-06: Icon is BOOLEAN, not URL.** Shape 2 does not construct URLs. The wire says whether an icon file exists; the client (shape 3) constructs the fetch URL once the serving path lands. Rationale: shape 4 owns the proxy design for the app itself, and icons may travel the same road; shape 2 declaring a URL now would lock in a guess. **Falls back naturally: if the boolean lies (icon deleted between sweeps), the client's fetch 404s and shape 3 renders a generic glyph.**

- **D-07: Port comes from the unit, not the card.** The systemd unit template shape 1 wrote has a `PORT=<n>` env; that's the truth (it's what actually serves traffic). `app.json` deliberately does NOT store the port (shape 1 discipline: "only fields with no natural home elsewhere"). The Python sweep script reads the port by parsing the unit or by asking systemctl for its environment.

- **D-08: Created-at is folder mtime, not a stored field.** Same shape-1 discipline. The sweep script `stat`s the folder to get mtime; no field lives on disk for it.

### In-memory picture

- **D-09: Separate map from the existing SessionState map.** Apps are per-host, not per-tmux-session, so the existing `Map<hostId:tmuxSession, SessionState>` in `subscription-registry.ts` cannot hold app rows. Phase 118 adds a sibling `Map<hostId:slug, AppState>` in the same registry, populated by a parallel per-host reconciliation pass. Both live in the same subscription-registry surface so the wire-broadcast machinery is shared.

- **D-10: No database, no schema, no migration.** Same discipline identity discovery already uses. Restart wipes the map; next successful sweep rebuilds it from disk-on-boxes. Do NOT persist the app registry anywhere — persistence would introduce Skynet-authored state above disk and violate the shape's "disk is the truth" invariant.

### Per-host reconciliation

- **D-11: Adopt Phase 115's reconciliation pattern verbatim, for apps.** Add a `lastTickLiveTreeApps: Map<string, Set<string>>` (or per-`PerHostState` `Set<string>`) tracking last-tick app slugs by host. After each successful per-host sweep, compute `thisTickApps` (all slugs that passed D-01/D-02 for this host), diff previous vs current, and for each slug in previous-but-not-current call the new `publishAppGoneByHostSlug(hostId, slug)` on the subscription registry. Update the tracking set to this tick's set.

- **D-12: Reconciliation ONLY runs on sweep success.** Just like Phase 115's identity reconciliation, the `{ok:false}` early-return paths in the orchestrator's per-host handler skip the app reconciliation block. A box that can't be reached this tick keeps its last-known apps — transient SSH failures do not flap. This is the exact same guard the identity path already enforces; do NOT invent a second one.

- **D-13: Health changes are updates, not gone+add.** If an app's `isHealthy` state flips between ticks (say the unit stops), the reconciliation does NOT gone-and-re-add — it emits an `app-update` frame. Add/remove-vs-mutate distinction is standard for delta protocols; frontend can then patch its in-memory list without visual flap.

### Wire — new frame types on the existing subscription

- **D-14: Three new frame types on the fleet-status WS channel.** `app-snapshot` (full list of apps this user can see, sent on subscribe alongside the existing session snapshot), `app-update` (one app added or its state changed), `app-gone` (one app removed, keyed by hostId + slug). Piggyback on the existing `/fleet-status/ws` connection — no new WS endpoint, no separate REST endpoint.

- **D-15: Per-user host-visibility filter applied at the wire boundary.** Reuse `checkHostAccess(hostId, userId, hostUserId, requiredPermission)` from `host-resolver.ts`. Every app frame is filtered against the subscriber's userId before broadcast — same shape identity frames are (or will be) filtered. Do NOT invent a per-app permission model; host access IS app access (shape philosophy).

- **D-16: Snapshot on subscribe is required.** When a new subscriber connects, the registry immediately sends a snapshot frame carrying every app across every box the subscriber can see. Without this, a fresh client shows an empty sidebar until the next successful sweep tick pushes deltas — up to 2s of blank state. Matches how session snapshots work today (Phase 39 wired the subscribe path).

### Python sweep script — one line-type addition

- **D-17: Add one new JSONL line-type to `fleet-status-sweep.py`.** The script currently emits identity lines (source A: live PIDs, source B: `~/.claude/identities/*` folders) as JSONL. Add a third line-type: **source C = `~/fleet/apps/*` folders**. For each subfolder, `stat` the folder, read `app.json`, check for `icon.webp`, check for the systemd unit (`systemctl --user cat app-<slug>.service` or equivalent presence probe), check active state (`systemctl --user is-active app-<slug>.service`), and emit ONE JSONL line per app that passes D-01 or D-02.

- **D-18: Sweep script parse-failure discipline — fail-open per-app, never fail-whole-sweep.** If the `app.json` for one app is malformed JSON, or the systemd check for one app times out, or the folder is a broken symlink — that ONE app is skipped from this tick's output and a warning is logged. The sweep script MUST NOT propagate the failure to affect other apps or identities on the same box. Matches the existing sweep script's discipline for per-identity parse failures.

- **D-19: Sweep script stays within the existing exec timeout.** The orchestrator wraps the sweep exec in `Promise.race(~5s)`. Adding app enumeration must NOT push the script past that budget on realistic app counts (Ashley's fleet has ~0 apps today, ~10 conceivable). Each app requires a small handful of cheap system calls (stat, cat one file, one systemctl call); budget is comfortable but the planner MUST NOT introduce network calls or heavy work into the per-app path.

- **D-20: Extend `sweep-schema.ts` to type the new line.** Add a `SweepAppLine` schema alongside `SweepIdentityLine` in `substrate/scripts/sweep-schema.ts`. The TypeScript-side parser (also in `sweep-schema.ts` per Phase 92 conventions) grows a discriminator on the line kind and dispatches app lines into a new handler in the orchestrator. Keep the parser lenient — same "never throws, reports schema mismatch via a flag" discipline the existing schema uses.

### Testing

- **D-21: Test at four layers — parse, reconciliation, wire, filter.** Coverage required:
  - **Parse:** malformed `app.json` skipped; missing `app.json` skipped; missing unit skipped; inactive unit emitted with `isHealthy: false`; well-formed app emitted with all seven fields; icon presence detected correctly.
  - **Reconciliation:** app disappears from disk between ticks → `app-gone` published exactly once; app added between ticks → `app-update` (or snapshot on next subscribe); box unreachable one tick then reachable next → NO spurious app-gone; health state flips between ticks → `app-update` not `app-gone` + `app-update`.
  - **Wire:** `app-snapshot` frame emitted to new subscriber; frames obey the schema; frames get broadcast to all subscribers.
  - **Filter:** subscriber A sees only apps on boxes A can access; subscriber B sees only apps on boxes B can access; both subscriptions run against the same registry without cross-contamination.

- **D-22: Executor uses scoped test runs, deploy uses full suite.** Per fleet directive 2026-09-07: executor's green gate is `npx vitest related --run <touched files>` OR targeted paths under `src/backend/fleet-status/` / `substrate/scripts/`. Full suite + Playwright smoke are the ORCHESTRATOR's pre-deploy gate, NOT baked into executor prompts. Standard fleet rule; called out so the planner doesn't seed a full-suite invocation into an executor.

- **D-23: Real end-to-end integration test on this box.** Because shape 2 spans TS + Python + SSH + systemd, at least one integration test drives the whole loop against this box's real environment: create a scratch `~/fleet/apps/scratch-test/` on t1000 with a real `app.json` + a real systemd `--user` unit, trigger a sweep, assert the `app-snapshot` frame contains it, remove the folder, assert the next tick's `app-gone` fires, restore, verify unhealthy-when-stopped. Cleanup after. This is agent-side UAT (per /build step 6), NOT a CI-runnable test — it runs by hand as part of the pre-deploy verification.

### Claude's Discretion (planner + executor decide)

- The exact TypeScript name of the sibling map on the subscription registry (`appMap`? `appsByHostSlug`? `appRegistry`?) — pick whatever is coherent with existing naming.
- Whether the per-app data holder is called `AppState` or `AppInfo` — pick whatever mirrors the existing `SessionState` convention.
- The exact healthMessage string phrasing for the "unit stopped" case — user-facing register, "ask an agent to check on it" is Ashley's steer.
- Whether the reconciliation code lives inline in `ssh-poll-orchestrator.ts` (next to the existing identity reconciliation) or a small sibling module. Recommendation: inline next to the identity code, since it's structurally the same pattern applied to a parallel data set.
- Exact route/subscription-frame naming — `app-snapshot` vs `app-add` vs `app-init`, `app-update` vs `app-changed`, `app-gone` vs `app-removed`. Pick verbs consistent with the existing session frame types in `wire-protocol.ts`.
- Whether the Python sweep script's per-app enumeration uses a single `find`/`stat` batch or one iteration per app — either is fine within the D-19 timing budget.
- How the systemd `PORT` env is extracted — parse the unit file text, or use `systemctl --user show -p Environment` — either works; whichever is cleaner given the unit template shape 1 wrote.
- Whether the `PerHostState` type extension is a new field or a whole new sibling struct — pick whatever integrates cleanly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/campaigns/first-class-apps/shape-sweep-and-registry-api.md` — the LOCKED agreement from the /open pass 2026-09-18. All D-01..D-23 above derive from it. Read first.
- `.planning/campaigns/first-class-apps/campaign-first-class-apps.md` — the campaign artifact naming the four-shape arc + cross-shape sequencing. Shape 3 and shape 4 both depend on this phase landing.
- `.planning/campaigns/first-class-apps/shape-app-runtime-and-skill.closed.md` — the closed shape 1 artifact defining the disk-side conventions this phase observes (`~/fleet/apps/` layout, `app.json` shape, systemd unit template, icon convention).

### The Skynet-side sweep + subscription code being extended
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (3115 lines) — the per-host sweep engine. **Phase 115 added the per-host identity reconciliation pattern at commit `67b4a7ef`; Phase 118 extends that pattern for apps.** Read the identity reconciliation block first — it's the template.
- `src/backend/fleet-status/subscription-registry.ts` — the WS-client subscription surface + in-memory `Map<hostId:tmuxSession, SessionState>` for sessions. Phase 118 adds a sibling `Map<hostId:slug, AppState>` here plus `publishAppSnapshot / publishAppUpdate / publishAppGoneByHostSlug` methods.
- `src/backend/fleet-status/fleet-status-server.ts` — HTTP + WS surface. The WS subscribe path is where Phase 118 emits the initial `app-snapshot` frame to a new subscriber; the filter is applied here.
- `src/backend/fleet-status/wire-protocol.ts` — the frame schemas broadcast to clients. Phase 118 adds `app-snapshot` / `app-update` / `app-gone` frame types matching the discipline of the existing session frames.
- `src/backend/fleet-status/types.ts` — the inbound harness payload shapes.

### Host visibility filter (reused as-is)
- `src/backend/database/host-resolver.ts` — `checkHostAccess(hostId, userId, hostUserId, requiredPermission)` is the SINGLE authority for "can this user see this box." Phase 118 composes it at the wire boundary; do NOT invent a per-app filter.

### The Python sweep script + its wire schema (the fleet-side thing)
- `substrate/scripts/fleet-status-sweep.py` — the batch sweep executed via SSH once per box per tick. Phase 118 adds a third line-type (source C: apps) to the JSONL output.
- `src/backend/fleet-status/sweep-schema.ts` (412 lines) — the TypeScript wire schema for what a sweep sees. Phase 118 adds `SweepAppLine` alongside `SweepIdentityLine` and extends the lenient parser to dispatch.

### Prior phase context (heavy relevance)
- `.planning/phases/115-identity-archiving-from-the-frontend/115-CONTEXT.md` — Phase 115 landed the reconciliation pattern Phase 118 leans on. Especially the fleet-status sweep + reconciliation-on-success discipline (Phase 115 D-13 territory + the `67b4a7ef` fix that added it). Read for context on how identity discovery got its reconciliation.
- `.planning/phases/92-*/92-CONTEXT.md` — Phase 92 built the batched fleet-status sweep script itself. Read for the shape of the JSONL wire contract and the per-line schema discipline.
- `.planning/phases/39-*/` — Phase 39 wired userId into the subscription-registry `onFirstSubscriber` callback. Establishes that userId is available at frame-broadcast time for filtering.

### Files this phase MODIFIES

**Skynet backend (TypeScript):**
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — extend per-host handler to consume `SweepAppLine` items from the JSONL response; add per-host app reconciliation on success (mirror the identity reconciliation block); update the sibling `PerHostState` fields.
- `src/backend/fleet-status/subscription-registry.ts` — add `Map<hostId:slug, AppState>` sibling to the existing `SessionState` map; add publish methods for app-snapshot / app-update / app-gone; extend subscribe path to include app snapshot.
- `src/backend/fleet-status/fleet-status-server.ts` — extend WS subscribe path to send initial `app-snapshot` frame filtered per-user by `checkHostAccess`.
- `src/backend/fleet-status/wire-protocol.ts` — declare `AppSnapshotFrame` / `AppUpdateFrame` / `AppGoneFrame` schemas and their outbound serializers.
- `src/backend/fleet-status/sweep-schema.ts` — add `SweepAppLine` schema; extend parser to dispatch line kinds; add discriminator field if needed.

**Fleet substrate (Python):**
- `substrate/scripts/fleet-status-sweep.py` — add source C (`~/fleet/apps/*` enumeration) to the sweep output. Emit one JSONL line per app that passes D-01 or D-02.

**Distribution (no changes expected):**
- `src/backend/distributor/catalog.ts` — `fleet-status-sweep.py` is already row #8 in the catalog. Editing the script + normal deploy is enough to reach every managed box on the next distributor sweep.

**Tests:**
- `src/backend/fleet-status/sweep-schema.test.ts` — extend for the new `SweepAppLine` parser cases.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (8860-line existing test file) — add app-reconciliation cases mirroring the identity reconciliation tests Phase 115 landed.
- `src/backend/fleet-status/subscription-registry.test.ts` — add tests for the app-side publish methods + snapshot emission.
- `src/backend/fleet-status/fleet-status-server.test.ts` — add tests for per-user filter application to app frames.
- New: a Python test or a shell harness for `fleet-status-sweep.py`'s app-enumeration branch (per Phase 92 conventions — check what's under `substrate/scripts/tests/` if that dir exists).

### Files this phase READS (contract references, no changes)
- `substrate/skills/app-development/SKILL.md` — the shape 1 skill that provisions apps. Read to confirm the on-disk contract this phase observes (`~/fleet/apps/<slug>/`, `app.json`, systemd unit naming, `icon.webp` convention).
- `substrate/skills/app-development/templates/app-starter/app.json` — the literal shape of the metadata card (title + description only).
- `substrate/skills/app-development/templates/app-starter/app-SLUG.service.template` — the unit template; the `PORT=<n>` env is the source of truth for the app's port.
- `substrate/skills/app-development/create-app.sh` / `archive-app.sh` — the disk-side flows shape 1 authored. Shape 2 does not touch these; it observes their output.

### Fleet-wide standing rules
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Standing directives" — especially the container-mutation serialization rule (Ashley 2026-09-12), the executor-scope test discipline (Ashley 2026-09-07), and the deploy-boundary-at-push rule (Ashley 2026-08-29). Planner and executor must honor these.
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Load-bearing invariants" — the DatabaseSaveTrigger discipline (learned 2026-08-19). **Not applicable to this phase** because the app registry is in-memory only (D-10), but flagged so the executor doesn't accidentally introduce a DB write somewhere.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **The per-host identity reconciliation block Phase 115 landed at `67b4a7ef`** — this IS the template for D-11/D-12. Same shape applied to a parallel data set (apps). Look at how `lastTickLiveTreeIdentities: Set<string>` is stored on `PerHostState`, how the "compute this-tick set" step happens after the identity loop completes successfully, and how the diff-then-publish-gone step runs before the tracking-set update. Copy the shape.
- **`checkHostAccess` in `host-resolver.ts`** — the single visibility function reused across the codebase. Phase 118 composes it at the wire boundary in `fleet-status-server.ts` and/or `subscription-registry.ts` (wherever session frames are already filtered).
- **The subscription registry's `Map<string, SessionState>` + `Set<SendFrame>` broadcast pattern** — Phase 118's sibling app map + publish methods copy this structure. The registry is already the fan-out hub; new frame types slot in cleanly.
- **The `fleet-status-sweep.py` JSONL emit pattern** — the script already emits one JSON object per line to stdout, buffered per-line, one-shot. Adding a third source kind (apps) is one more `for` loop and one more `print(json.dumps(...))` call per hit.
- **`sweep-schema.ts`'s lenient-parser discipline** — parse never throws; on schema mismatch it emits a flag the caller checks. The new `SweepAppLine` follows the same pattern.
- **Phase 39's userId-in-subscription plumbing** — the userId is already available at frame-broadcast time; Phase 118 reuses it for the app-frame filter.
- **`systemctl --user` invocations already scattered through fleet-substrate scripts** — the sweep script can shell out to `systemctl --user is-active app-<slug>.service` and `systemctl --user show -p Environment app-<slug>.service`. Straight subprocess calls, no new dependency.

### Established Patterns

- **In-memory-only registries with no persistence** — the existing `SessionState` map has no DB. Restart wipes it; the next sweep rebuilds it. Phase 118's app map follows the same discipline (D-10).
- **Sweep is per-box, batched as one exec** — 200+ per-identity round trips were consolidated into one call per box (Phase 92). Phase 118 does not fan out per-app SSH calls; the sweep script does all the work in the one batch exec (D-19).
- **Reconciliation-on-success, not on failure** — the identity reconciliation Phase 115 added ONLY runs when the sweep exec succeeded. Same guard for apps (D-12) — SSH failures don't flap the sidebar.
- **Presence-is-meaning, not stored-state** — like the `.pinned` / `.no-dormancy` / `.hidden` sentinels for identities, app existence on disk IS the truth. Skynet observes; it doesn't remember above disk (D-10).
- **Line-type discrimination in JSONL contract** — the sweep script emits multiple line kinds (identity source A, source B); Phase 118 adds a third (source C = apps). Parser discriminates on a `kind` field or line schema shape.
- **The Skynet DB in-memory-decrypted-into-RAM discipline** — writes need `DatabaseSaveTrigger.forceSave` calls (load-bearing invariant, learned 2026-08-19). **Phase 118 explicitly does not write to the DB**, so this doesn't apply — but flagged so no drift creeps in during execution.

### Integration Points

- **Sweep-script → orchestrator boundary.** Adding a new JSONL line-type requires BOTH the Python emit AND the TS parse to land in one deploy. Since both are in the same repo and both ship via the standard build + distributor sweep, this is atomic per deploy. Do NOT split into separate deploys — a partial deploy where Python emits app lines that TS doesn't parse would just get logged-and-skipped by the lenient parser, but the reverse (TS expects app lines that Python doesn't emit) would work fine (empty is a valid state).
- **Subscription-registry snapshot semantics.** The existing snapshot-on-subscribe pattern for sessions is per-map; Phase 118's app map adds a parallel snapshot emit. Verify the WS frame envelope can carry both snapshots (session + app) on subscribe without ordering issues.
- **The `fleet-status-sweep.py` script is one of the substrate-distributor's rows** (catalog.ts row #8 as of Phase 118's start). Editing the script + normal deploy → next distributor sweep pushes the new bytes to every managed box → next per-box sweep on Skynet exec's the new script. No manual distribution step.
- **Container-mutation serialization** (Ashley 2026-09-12): only ONE identity mutates this box's Skynet container state at a time. Applies to Phase 118's deploy motion, not its planning or executor phases.

### Test Considerations

- **Full sweep loop is expensive to unit-test in isolation.** Existing `ssh-poll-orchestrator.test.ts` is 8860 lines because it mocks the SSH exec layer. Phase 118's new tests add to this file rather than a new file, following the existing seam patterns.
- **Real-systemd + real-disk integration is agent-UAT territory**, not CI. The D-23 integration test runs by hand on this box as part of pre-deploy verification. Do NOT bake systemd invocations into the CI test suite — they'd require a running systemd user session in CI which the current fork does not have.
- **Reconciliation timing tests must exercise the "success" gate.** A test that mocks the sweep to succeed → confirm gone-fires; mock to fail → confirm gone-does-NOT-fire. Copy the existing identity reconciliation tests as a template.
- **Filter tests are combinatorial per subscriber.** Two subscribers with different userIds, three boxes with different owners + hostAccess grants — the matrix should exercise "sees own", "sees granted", "does not see denied" for each subscriber.
- **The Python sweep script's parse-failure test** — hand it a folder with malformed `app.json`, assert one WARN log line + no app line emitted + the identity output unaffected. Similarly for missing unit / inactive unit.

</code_context>

<specifics>
## Specific Ideas

- **The healthMessage register** — Ashley's steer during the /open grill was "unhealthy, ask an agent to check on it." Match that tone. Not "SERVICE FAILED" or "err_start_failure"; conversational and action-oriented.
- **Icon file convention `icon.webp`** — from shape 1. Not "icon.png", not "logo.webp", not "app-icon.svg". Locked by shape 1's on-disk contract; shape 2 observes the specific filename.
- **App folder convention `~/fleet/apps/<slug>/`** — from shape 1. The sweep script enumerates this specific path. Slugs are the folder names (kebab-case, per shape 1).
- **Systemd unit naming convention `app-<slug>.service`** — from shape 1's `app-SLUG.service.template`. The sweep script's systemctl calls use this specific pattern to find each app's unit.
- **The reconciliation pattern's exact commit** — `67b4a7ef` on trunk. Reading the DIFF of that commit is the fastest way to understand the pattern.
- **Ashley's inclusion-filter framing (2026-09-18)** — "you can't actually use the app" = not in the picture, EXCEPT the stopped-unit case where "ask an agent to check on it" is the sensible message. This IS the design principle for D-01 + D-02.

</specifics>

<deferred>
## Deferred Ideas

- **Eager-refresh signal for just-created apps** — the natural 2s sweep cadence means create-to-visible latency is up to 2s. If shape 3's UAT reveals this feels laggy, a small nudge (agent touches a sentinel file, or the create-app script pings the Skynet backend) is a follow-up. Not part of shape 2. The `~/fleet/.create-lock` file shape 1 already uses could be a natural place to hang such a signal.
- **A plain HTTP snapshot endpoint alongside the WS subscription** — for curl-driven clients, non-WS surfaces, or a future SSR path. YAGNI until asked. Deferred.
- **Additional health tiers** — application-level healthchecks, crash-loop counters, response-time probes, port collision detection, "was healthy recently" grace windows. All out for shape 2. When Ashley asks for one, the wire schema widens; nothing else has to move.
- **Server-authored per-user app state** — favorites, hidden tiles, custom labels, sort preferences. Shape 3 owns any client-side state; shape 2 owns none.
- **Skynet-authored app metadata beyond what disk exposes** — timestamps of last click, aggregate usage stats, per-app tags. Not in shape 2's model.
- **Push / register API on the app side** — an app announcing itself to Skynet on startup. Not the pattern. Disk is the truth; the sweep observes. Shape 2 doesn't open this door.
- **Backend-constructed icon URLs** — deferred to whichever shape lands the serving side (shape 4 for the proxy). Shape 2 gives a boolean.
- **Owning-agent / provenance display** — explicitly ruled out during the /open grill (Ashley: "no benefit"). Not deferred — closed.
- **Orphan systemd unit cleanup when an app folder is deleted** — belongs to shape 1's disk-side flow (specifically `archive-app.sh` / a hypothetical `delete-app.sh`). Shape 2 only observes; it does not touch systemd for cleanup.
- **Cross-shape ordering optimization** — shape 3 and shape 4 could conceivably discover something that requires a small shape 2 tweak; if that happens, the campaign artifact absorbs it as a lingerer.

</deferred>

---

*Phase: 118-first-class-apps-sweep-registry-shape-2*
*Context gathered: 2026-09-18*
