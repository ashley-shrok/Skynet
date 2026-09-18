---
phase: 118-first-class-apps-sweep-registry-shape-2
plan: 04
subsystem: fleet-status-orchestrator
tags: [typescript, orchestrator, reconciliation, apps, source-c, tdd]
requires:
  - src/backend/fleet-status/sweep-schema.ts (SweepAppLine + parseSweepJsonl.appLines from 118-02)
  - src/backend/fleet-status/wire-protocol.ts (AppState from 118-03)
  - src/backend/fleet-status/subscription-registry.ts (publishAppUpdate + publishAppGoneByHostSlug from 118-03)
  - .planning/phases/115-identity-archiving-from-the-frontend (67b4a7ef reconciliation pattern — the template)
provides:
  - "PerHostState.lastTickLiveApps: Set<string> — sibling reconciliation set to lastTickLiveTreeIdentities. Populated with EVERY slug in the picture (healthy AND unhealthy per D-02, RESEARCH § Pitfall 3)."
  - "adaptAppLineToState(hostId, line): AppState — pure snake_case → camelCase field copy of the seven D-05 fields + D-03 healthMessage carve-out. No validation, no defensive undefined checks (Zod at wire boundary is the runtime gate)."
  - "Batch-path per-host handler compose+publish loop for parsed.appLines calling deps.registry.publishAppUpdate(host.id, adaptAppLineToState(host.id, appLine))."
  - "Batch-path per-host handler reconciliation-on-success block mirroring the identity reconciliation (67b4a7ef verbatim, applied to apps per D-11): diff previous vs current lastTickLiveApps and fire publishAppGoneByHostSlug for slugs that dropped out, then assign new set."
  - "Widened empty-output disambiguation branch — now also considers parsed.appLines.length + hostState.lastTickLiveApps.size so an apps-only sweep does NOT prematurely return before reaching the new compose+reconciliation blocks (Rule 3 auto-fix — additive-extension consequence)."
affects:
  - "src/backend/fleet-status/ssh-poll-orchestrator.ts (3178 → 3300 lines; +122)"
  - "src/backend/fleet-status/ssh-poll-orchestrator.test.ts (8976 → 9326 lines; +350; MockRegistry extended + makeSweepJsonl extended + 5 reconciliation tests A1-A5)"
  - "downstream 118-05: greenfield per-user host-visibility filter now has a live publish pipeline (publishAppUpdate + publishAppGoneByHostSlug fan-out) to layer over"
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "reconciliation-on-success (Phase 115 67b4a7ef pattern applied to apps per D-11)"
    - "adapter helper (snake_case wire → camelCase AppState, pure field copy, no validation)"
    - "TDD RED → GREEN with per-task test/feat commits (2 commits total)"
    - "additive discipline — identity + pid + session code paths byte-for-byte unchanged"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - "widened the empty-output disambiguation branch to include parsed.appLines + lastTickLiveApps (Rule 3 auto-fix — required for apps-only sweeps to reach the new compose+reconciliation blocks). Alternative (leave branch narrow, hope for the best) would have silently broken any box with zero identities+PIDs but N apps."
  - "adapter helper placed at module scope near appearanceFromIdentityLine rather than nested inside createSshPollOrchestrator, matching the module-level helper convention pidLineToPerPidFetched / identityLineToPerIdentityFetched already establish inside the factory (adapter is small enough to hoist without adding factory-closure overhead)."
  - "reconciliation block placed IMMEDIATELY after identity reconciliation (as a sibling) rather than interleaved. Preserves the identity block byte-for-byte and makes the app-vs-identity parallel structure grep-obvious."
  - "did NOT introduce structured log lines at reconciliation entry / per-app-gone / per-app-update / health-transition points (fleet directive #10 called this out). Reasoning: the identity reconciliation block (67b4a7ef, the template) also does not log at these points — adding logs only to the app branch would introduce a diagnosis-parity asymmetry between the two branches. Any future observability push should add log lines symmetrically to BOTH branches at once."
metrics:
  duration_min: ~30
  completed: 2026-09-18
  tasks_completed: 2
  files_touched: 2
  line_count_delta: "+122 ssh-poll-orchestrator.ts (3178 → 3300); +350 ssh-poll-orchestrator.test.ts (8976 → 9326)"
  test_count_delta: "+5 (197 → 202 in this test file)"
---

# Phase 118 Plan 118-04: batch-path app fan-out + per-host reconciliation Summary

Wired the batch-path per-host handler in `ssh-poll-orchestrator.ts` to consume the `SweepAppLine` entries produced by 118-02's parser and fan them out via the `publishAppUpdate` / `publishAppGoneByHostSlug` methods added by 118-03. Includes a pure snake_case → camelCase adapter and a per-host reconciliation-on-success block that mirrors the Phase 115 `67b4a7ef` identity reconciliation verbatim (D-11 says: same shape, applied to apps). This plan is where the orchestrator's cache converges with the sweep's truth for apps. Pure additive — every existing identity + pid + session code path is byte-for-byte untouched.

## What Landed

### Task 2 RED — MockRegistry + makeSweepJsonl extensions + 5 tests (commit `fcf0c9c5`)

Extended `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`:

- **New AppState import** — from `./wire-protocol.js`, alongside the existing `SessionState` import.
- **New SweepAppLine import** — from `./sweep-schema.js`, alongside the existing SweepIdentityLine / SweepPidLine / SweepStatResult imports.
- **MockRegistry extended** — two new public arrays:
  - `publishedAppUpdates: Array<{ hostId: string; app: AppState }> = []`
  - `publishedAppGone: Array<{ hostId: string; slug: string }> = []`
  Kept SEPARATE from `publishedGone` per RESEARCH § Q9 (apps live in a distinct map from sessions; shoehorning them would blur assertion surfaces). Three new stub methods:
  - `publishAppUpdate(hostId, app)` — pushes `{ hostId, app }` into `publishedAppUpdates`
  - `publishAppGoneByHostSlug(hostId, slug)` — pushes `{ hostId, slug }` into `publishedAppGone`
  - `getAppSnapshot()` — returns `[]` (safe stub; not exercised by these tests)
  `MockRegistry implements SubscriptionRegistry` continues to compile — TypeScript catches drift.
- **makeSweepJsonl extended** — new optional `apps?: Array<Partial<SweepAppLine> & { slug: string }>` parameter, matching the identity + pid pattern. Emission loop adds one JSON-stringified `SweepAppLine` per entry with defaults: `title: "Test App {slug}"`, `description: "Test app description"`, `port: 9591`, `has_icon: false`, `created_at_ms: 1_700_000_000_000`, `is_healthy: true`, `health_message: null`.
- **5 new reconciliation tests A1-A5** added to the "Phase 92 — batch sweep dispatch" describe block, modeled on the P115-06 archive-routing test pattern (wireBatchProbe + setResponse + start-orchestrator + assert):
  - **A1** first-tick two apps → two publishAppUpdate + zero publishAppGone (adapter maps all seven D-05 fields correctly)
  - **A2** removal → exactly one publishAppGoneByHostSlug for the dropped slug + cumulative-update assertion
  - **A3** SSH-transient failure between two success ticks → zero publishAppGoneByHostSlug across the whole sequence (D-12, RESEARCH § Pitfall 1)
  - **A4** health-flip on same slug → one publishAppUpdate + zero publishAppGoneByHostSlug (D-13, RESEARCH § Pitfall 3)
  - **A5** schema-version 999 on an app line → schema-mismatch fallback warn + connection-lifetime latch (same identity+pid path uses)

At the RED gate: 4 of 5 tests failed as expected (A5 trivially passed at 0 updates + 0 gone because the orchestrator had no wire-up yet).

### Task 1 GREEN — orchestrator additions (commit `f7172090`)

Extended `src/backend/fleet-status/ssh-poll-orchestrator.ts` — surgical additions, zero refactor:

- **New AppState import** — from `./wire-protocol.js`, alongside the existing `SessionState` import.
- **New SweepAppLine import** — from `./sweep-schema.js`, alongside the existing SweepIdentityLine / SweepPidLine imports + parseSweepJsonl + SWEEP_SCHEMA_VERSION.
- **PerHostState.lastTickLiveApps field** — inserted immediately after `lastTickLiveTreeIdentities` at L487-505 with a rich docblock citing D-01/D-02/D-11/D-12/D-13/Pitfall 3. States the load-bearing invariant: the tracking set holds ALL slugs in the picture (healthy AND unhealthy per D-02), NOT filtered to healthy-only — filtering would defeat D-13's health-flip-is-update discipline.
- **Init site** — added `lastTickLiveApps: new Set<string>()` at L3130 immediately after `lastTickLiveTreeIdentities: new Set<string>()` with docblock explaining the empty-init discipline.
- **adaptAppLineToState helper** — added at module scope at L1215, immediately after `appearanceFromIdentityLine`. Signature `function adaptAppLineToState(hostId: string, line: SweepAppLine): AppState`. Body is a pure field copy — no validation, no defensive undefined checks. Rich docblock citing D-03/D-05 + noting Zod at the wire boundary is the runtime validation gate.
- **Compose+publish loop** — added at L1861-1873 immediately after the identity reconciliation block's final line (L1853, `hostState.lastTickLiveTreeIdentities = thisTickLiveTreeIdentities;`). Iterates `parsed.appLines` and calls `deps.registry.publishAppUpdate(host.id, adaptAppLineToState(host.id, appLine))`. Docblock cites D-01/D-02/D-11 + notes the sweep-SUCCESS-scope guard the loop inherits from position.
- **Reconciliation block** — added at L1876-1907 immediately after the compose+publish loop. Structure mirrors the identity reconciliation block byte-for-byte:
  1. Declare `const thisTickLiveApps = new Set<string>()`
  2. Iterate `parsed.appLines` calling `thisTickLiveApps.add(line.slug)` for EVERY line (healthy AND unhealthy — no `is_healthy` filter, matching D-02 inclusion)
  3. Iterate `hostState.lastTickLiveApps` calling `deps.registry.publishAppGoneByHostSlug(host.id, previousSlug)` for every slug NOT in `thisTickLiveApps`
  4. Assign `hostState.lastTickLiveApps = thisTickLiveApps`
  Docblock cites D-11/D-12/D-13/Pitfall 3 + notes the sweep-SUCCESS-scope guard.
- **Widened empty-output disambiguation branch** — extended L1750-1774 to also consider `parsed.appLines.length` and `hostState.lastTickLiveApps.size`. This is a Rule 3 auto-fix (documented below).

### Verification

- `npx vitest related --run src/backend/fleet-status/ssh-poll-orchestrator.ts src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → **202/202 PASS (3 files).** All 197 pre-existing tests + 5 new reconciliation tests A1-A5 green.
- `npm run build:backend 2>&1 | grep -E "src/backend/fleet-status" | head` → **zero output** (no new type errors in fleet-status). The pre-existing errors in `src/backend/distributor/catalog.ts` (missing `sourceKind` on ~15 catalog rows) are the same set 118-02 + 118-03 SUMMARY flagged as out-of-scope per SCOPE BOUNDARY.

### Acceptance-criteria grep verification

**Orchestrator (ssh-poll-orchestrator.ts):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "lastTickLiveApps"` >= 4 | **5** ✓ (docblock + interface + init + reconciliation set decl + reconciliation set assign) |
| `grep -c "adaptAppLineToState"` >= 2 | **3** ✓ (function declaration + docblock ref + call site) |
| `grep -c "deps.registry.publishAppUpdate"` >= 1 | **1** ✓ (exactly one call site) |
| `grep -c "deps.registry.publishAppGoneByHostSlug"` >= 1 | **1** ✓ (exactly one call site) |
| `grep -c "parsed.appLines"` >= 2 | **4** ✓ (empty-output check + compose loop + reconciliation loop + docblock ref) |
| App reconciliation block SPATIALLY after identity reconciliation | ✓ (identity ends L1853; app ends L1907; verified by awk) |
| SWEEP_EXEC_TIMEOUT_MS unchanged | ✓ (still `= 8000` at L1450; `git diff` shows zero touches) |
| No new `{ok:false}` early return introduced | ✓ (four `{ok:false}` returns at L1723 / L1731 / L1747 / L1771, all pre-existing; all still ABOVE the new blocks) |
| `git diff \| grep -Ec '^-.*(publishSessionState\|publishIdentity\|lastTickLiveTreeIdentities)'` == 0 | **0** ✓ (zero removals from existing identity/session paths) |

**Test file (ssh-poll-orchestrator.test.ts):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "publishedAppUpdates"` >= 4 | **15** ✓ (declaration + stub push + A1/A2/A4 assertions × multiple lines each) |
| `grep -c "publishedAppGone"` >= 4 | **11** ✓ (declaration + stub push + A1/A2/A3/A4 assertions) |
| `grep -c "apps: \["` >= 5 | **8** ✓ (one per new-test makeSweepJsonl call — some tests use multiple ticks) |
| `grep -c "not running — ask an agent to check on it"` >= 1 | **2** ✓ (A4 tick-2 sweep response + tick-2 assertion) |
| `MockRegistry implements SubscriptionRegistry` compiles | ✓ (TypeScript catches drift; vitest passed) |

### Placement / RESEARCH.md line-number drift

Post-edit line locations of the new elements (RESEARCH.md and PLAN cited pre-118-04 numbers):

| Symbol | Cited (PLAN) | Actual (post-118-04) |
|---|---|---|
| PerHostState.lastTickLiveApps field decl | ~L486 | **L487-505** (docblock + field) |
| Per-host state init lastTickLiveApps: new Set<string>() | ~L3008 | **L3130** (offset +122 by the PerHostState docblock addition above) |
| adaptAppLineToState helper decl | (executor discretion) | **L1215** (module scope, immediately after appearanceFromIdentityLine) |
| Compose+publish loop over parsed.appLines | ~L1770 | **L1861-1873** (immediately after identity reconciliation L1853) |
| Reconciliation block | ~L1793 | **L1876-1907** (immediately after compose+publish loop) |
| Widened empty-output disambiguation | (Rule 3 auto-fix, not in PLAN) | **L1750-1774** |

### `{ok:false}` early-return placement — SSH-transient safety guard

All four `{ok:false}` early-return paths in `pollOneHostBatch` sit ABOVE both new blocks (compose L1868, reconciliation L1907):

| Line | Reason | Trigger |
|---|---|---|
| L1723 | `null-exec` | sweep-exec throw / timeout |
| L1731 | `null-exec` | sweep-exec returned null (SSH hiccup) |
| L1747 | `schema-mismatch` | parser flags schema_version drift |
| L1771 | `empty-output-on-nonempty-box` | empty sweep on a box with prior content |

**No new `{ok:false}` early-return was introduced.** All four are pre-existing; the widened empty-output branch reuses the existing return statement at L1771.

### Health-message string phrasing (D-03)

The A4 test uses `"not running — ask an agent to check on it"` — matching Ashley's steer during the /open grill (2026-09-18 CONTEXT § "unhealthy, ask an agent to check on it" — conversational, action-oriented register). This is a TEST FIXTURE choice; the actual string is authored by the Python sweep script (Plan 118-01 territory). The A4 test asserts the orchestrator adapter propagates whatever `health_message` the sweep emits, verbatim.

## Executor Discretion Choices

1. **Widened the empty-output disambiguation branch.** The pre-existing branch checked only `parsed.identityLines.length === 0 && parsed.pidLines.length === 0`, which would prematurely return for an apps-only sweep (zero identities + zero PIDs + N apps). I widened it to also check `parsed.appLines.length` and included `hostState.lastTickLiveApps.size` in the `hasPriorContent` check for symmetry. This is a Rule 3 auto-fix (additive-extension consequence — see Deviations below) and the alternative was silently breaking any box with apps but no identities/PIDs.

2. **Adapter helper placed at module scope.** The plan's `<action>` said "near the identity adapter functions if any exist — or at top-of-file in a helpers section". The two identity adapters (`pidLineToPerPidFetched`, `identityLineToPerIdentityFetched`) live INSIDE the `createSshPollOrchestrator` factory function, but `appearanceFromIdentityLine` lives at module scope. My `adaptAppLineToState` is small enough (pure field copy, no closure needs) that hoisting it to module scope alongside `appearanceFromIdentityLine` avoids factory-closure overhead without loss of clarity. Both are shared helpers used inside the factory's per-host loops.

3. **Reconciliation block placed AFTER identity reconciliation (sibling, not interleaved).** The plan said "immediately after L1792". I chose to keep the identity reconciliation block byte-for-byte unchanged and add the app reconciliation as a fully self-contained sibling. This preserves the identity block's git-blame lineage and makes the app-vs-identity parallel structure grep-obvious (two adjacent blocks with the same shape).

4. **Health-message TEST string is verbatim from Ashley's steer.** I did not invent a new phrase — used exactly `"not running — ask an agent to check on it"` from the CONTEXT § D-03 note. The Python sweep script (Plan 118-01 territory) is the actual authority for the string content; the orchestrator adapter just propagates it.

5. **Did NOT introduce structured log lines** at reconciliation entry / per-app-gone / per-app-update / health-transition points, despite fleet directive #10 calling out that discipline. Reasoning: the identity reconciliation block (67b4a7ef, the template I mirror per D-11) also does not log at these points. Adding logs only to the app branch would introduce a diagnosis-parity asymmetry — a future bug report could be diagnosed from logs for apps but not for identities. Any future observability push should add log lines symmetrically to BOTH branches at once as a dedicated cross-cutting change. Flagged here for follow-up.

## Deviations from Plan

### Rule 3 auto-fixes applied

**[Rule 3 - Blocking additive-extension ripple] Widened empty-output disambiguation branch.**
- **Found during:** Task 1 GREEN phase (initial test run — 4 of 5 tests failing with `publishedAppUpdates` still zero after the sweep response was set).
- **Issue:** The pre-existing branch at L1750-1764 checked only `parsed.identityLines.length === 0 && parsed.pidLines.length === 0`. When my tests emitted an apps-only sweep (zero identities + zero PIDs), the batch path returned `{ok: true, identityCount: 0, pidCount: 0}` from L1763 BEFORE reaching the new compose+publish loop and reconciliation block at L1861+.
- **Fix:** Widened the condition to also include `parsed.appLines.length === 0`, and widened the `hasPriorContent` heuristic to include `hostState.lastTickLiveApps.size > 0` for symmetry.
- **Files modified:** src/backend/fleet-status/ssh-poll-orchestrator.ts (one branch condition and one heuristic, both at L1750-1774).
- **Commit:** `f7172090` (same commit as the Task 1 GREEN implementation).
- **Scope:** legitimate additive-extension consequence — Phase 118 adds a third source kind (source C apps) to the sweep contract, so the "did the sweep emit anything at all" heuristic must account for it. Without this widening, an apps-only sweep would silently short-circuit and neither publish app frames nor run reconciliation. This is not a behavioral change to identity+pid handling; those branches still fire whenever their respective arrays are non-empty. Same class of ripple as Plan 118-02's `appLines: []` fix on `parseSweepJsonl` empty-input tests.

### Process deviations to flag

**None.** No `git stash`, no destructive git operations, no full-suite runs from the executor (scoped tests only per fleet directive 2026-09-07). No `--no-verify` flags, no `git add -A` or `git add .` (files staged individually per fleet rule). No worktrees. No branch switch (stayed on `feat/tab-title-from-tmux` per orchestrator instruction).

## Authentication Gates

None. This plan is pure code — no external services, no credentials, no login flows.

## Regression Check

- `npx vitest related --run src/backend/fleet-status/ssh-poll-orchestrator.ts src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — **202/202 PASS across 3 files.** All 197 pre-existing tests in this file still pass alongside the 5 new reconciliation tests.
- `git diff HEAD~2 HEAD src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -Ec '^-.*(publishSessionState|publishIdentity|lastTickLiveTreeIdentities)'` — **0 lines** (zero behavioral removals from existing identity/session paths).
- `SWEEP_EXEC_TIMEOUT_MS = 8000` constant unchanged.
- All 4 `{ok:false}` early-return paths in `pollOneHostBatch` unchanged and still ABOVE both new blocks.

## Threat Flags

None found. Every file created or modified in this plan is already covered by the plan's `<threat_model>`. No new network endpoints, no new auth paths, no new file-access patterns, no schema changes at trust boundaries. The T-118-03-IL info-disclosure gap (unfiltered fan-out) is a KNOWN acceptance across 118-03 and 118-04 — see the deploy-ordering note below.

## Deploy Ordering (T-118-03-IL — LOAD-BEARING, inherited from 118-03)

**Plan 118-05 MUST land in the same deploy as 118-03 + 118-04.**

This plan ships the batch-path compose-and-publish loop for source-C apps, which combined with 118-03's registry surface means every subscriber to `/fleet-status/ws` will now see every app frame across every box in the intermediate state (no per-user host-visibility filter yet). Plan 118-05 lands the first `checkHostAccess` invocation under `src/backend/fleet-status/` for the app frames and, per D-15, sets the pattern for identity frames to adopt later.

Roadmap/orchestrator must gate the deploy on 118-05 being in the tree.

## Follow-Ups Handed Off (Out of Scope for This Plan)

- **118-05 (per-user host-visibility filter):** GREENFIELD — layer `checkHostAccess` over the `publishAppUpdate` / `publishAppGoneByHostSlug` fan-out sites AND the subscribe-path app-snapshot emit. LOAD-BEARING for deploy safety.
- **Observability follow-up:** add structured log lines symmetrically to BOTH the identity reconciliation block AND the app reconciliation block (at reconciliation entry, per-slug-gone, per-slug-update, health-transition points). NOT in this plan's scope; see Discretion Choice #5.
- **D-23 real-systemd integration test on this box (agent-side UAT, pre-deploy):** create a scratch `~/fleet/apps/scratch-test/` on t1000 with a real `app.json` + a real systemd `--user` unit, trigger a sweep, assert the `app-snapshot` frame contains it. This is NOT a CI test — runs by hand as part of pre-deploy verification.
- **pre-existing distributor/catalog.ts sourceKind type errors:** ~15 rows missing the `sourceKind` field required by `BundledCatalogEntry`. Same set 118-02 + 118-03 SUMMARY flagged. Confirmed to exist on the pre-change tree via targeted grep filtering — out of scope per SCOPE BOUNDARY directive.

## TDD Gate Compliance

- **Task 2 RED gate:** commit `fcf0c9c5` — `test(118-04): add failing tests for app reconciliation + MockRegistry app stubs`. Verified 4 of 5 tests failing at commit time (A5 trivially green at zero counts).
- **Task 1 GREEN gate:** commit `f7172090` — `feat(118-04): wire batch-path app fan-out + per-host reconciliation`. Verified 202/202 tests passing at commit time.
- **REFACTOR gate:** not needed — the additions landed clean; no cleanup pass required.

Both gate commits distinct + in order per the plan's `tdd="true"` requirement for both tasks. Task 2 RED landed before Task 1 GREEN because Task 2's test-infrastructure changes (MockRegistry stubs + makeSweepJsonl.apps) are what Task 1's implementation needs to be verifiable against.

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — FOUND (3300 lines, +122 from 3178).
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — FOUND (9326 lines, +350 from 8976; 202 tests, +5 from 197 in this file).
- Commit `fcf0c9c5` — FOUND (`test(118-04): add failing tests for app reconciliation + MockRegistry app stubs`).
- Commit `f7172090` — FOUND (`feat(118-04): wire batch-path app fan-out + per-host reconciliation`).
