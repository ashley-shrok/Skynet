---
phase: 118-first-class-apps-sweep-registry-shape-2
verified: 2026-09-18T04:45:00Z
status: passed_with_notes
score: 23/23 locked decisions verified (0 blockers, 2 deploy-motion notes carried forward from Plan 05 SUMMARY)
overrides_applied: 0
verifier: Claude (Opus 4.7 — goal-backward verifier)
---

# Phase 118: First-class apps — sweep + registry (shape 2) — Verification Report

**Phase Goal (CONTEXT.md):** Extend the per-box fleet-status sweep to enumerate `~/fleet/apps/*/`, cross-check each app against systemd (unit present + active), emit per-app findings inside the existing sweep exec, hold an in-memory picture keyed by `hostId:slug` on Skynet, reconcile per-host on sweep success, and pipe three new frame types (`app-snapshot` / `app-update` / `app-gone`) through the existing fleet-status WS channel filtered per-user by host visibility.

**Verified:** 2026-09-18T04:45:00Z
**Status:** passed_with_notes — every locked D-01..D-23 decision is delivered in the codebase; two starter.ts / deploy-motion follow-ups are correctly flagged for the deploy step (Plan 05 SUMMARY was explicit; verified those flags are real and load-bearing).

---

## Codebase State

- Branch: `feat/tab-title-from-tmux`, HEAD: `d7a75bea docs(118-05): complete plan — SUMMARY, STATE, ROADMAP`.
- 21 commits in the Phase 118 range (55630853..d7a75bea) — all present in the tree.
- 16 code/test commits verified via `git cat-file -e`: all OK.
- `substrate/scripts/fleet-status-sweep.py` — present (1425 lines expected; verified via helper counts).
- `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` — present (executable, 7 test cases).
- `src/backend/fleet-status/sweep-schema.ts` — present (SweepAppLine + parser dispatch).
- `src/backend/fleet-status/wire-protocol.ts` — present (AppStateSchema + 3 frame schemas + 3 factories).
- `src/backend/fleet-status/subscription-registry.ts` — present (apps map + publishAppUpdate/GoneByHostSlug/getAppSnapshot + SubscriberEntry widening + fanOutApp).
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — present (adaptAppLineToState, compose+publish loop, reconciliation block, PerHostState.lastTickLiveApps).
- `src/backend/fleet-status/app-frame-filter.ts` — present (NEW file, 278 lines, `filterAppFrame` + `createAppFrameFilter`).
- `src/backend/fleet-status/fleet-status-server.ts` — present (3-way registry construction branch).

---

## Per-Decision Verification

| # | Decision | Status | Evidence |
|---|----------|--------|----------|
| D-01 | Three functional checks (folder + card + unit-active) decide inclusion | VERIFIED | `substrate/scripts/fleet-status-sweep.py:1191-1220` — `_build_app_line` returns None on (a) unreadable/malformed app.json, (b) `info["load_state"] != "loaded"`, and enters D-02 carve-out only when `info["active_state"] != "active"`. Enumerator gate at `_enumerate_apps:1265-1308`. |
| D-02 | One carve-out — unit exists but currently stopped emits as unhealthy | VERIFIED | `fleet-status-sweep.py:1222-1229` — `is_healthy = info["active_state"] == "active"` then sets `health_message = "not running — ask an agent to check on it"` only when not healthy. Shell test case 4 (`test_case_04_stopped_unit`) proves this end-to-end (`bash substrate/scripts/tests/fleet-status-sweep-apps.test.sh` → PASS). |
| D-03 | Backend authors the healthMessage ("not running — ask an agent to check on it") | VERIFIED | `fleet-status-sweep.py:1229` literal string matches. Shell case 4 asserts the exact string round-trips through the JSONL. Register matches Ashley's steer. |
| D-04 | One health tier (isHealthy boolean + optional healthMessage), not many | VERIFIED | Zero matches for `crash_loop|health_tier|health_status` in any of the modified TS/Python files. Only `is_healthy` and `health_message` fields exist on the wire. |
| D-05 | Emit exactly seven fields (+ hostId stamped by TS) | VERIFIED | Python emit dict at `fleet-status-sweep.py:1251-1262` carries `line_kind, schema_version, slug, title, description, port, has_icon, created_at_ms, is_healthy, health_message`. TS adapter at `ssh-poll-orchestrator.ts:1215-1227` stamps `hostId` and remaps snake_case → camelCase into the `AppState` wire shape. `AppStateSchema` (`wire-protocol.ts:632-642`) validates the 9-field frontend-facing shape (hostId + slug + title + description + port + hasIcon + createdAtMs + isHealthy + healthMessage). |
| D-06 | Icon is BOOLEAN, not URL | VERIFIED | Python: `has_icon = os.path.exists(os.path.join(folder_path, "icon.webp"))` at line 1237. TS: `hasIcon: z.boolean()` at wire-protocol.ts:638. Zero URL-construction anywhere in the touched files. |
| D-07 | Port comes from the unit's PORT env, not the card | VERIFIED | `fleet-status-sweep.py:1233-1234`: `m = re.search(r"\bPORT=(\d+)\b", info["environment"])` — extracts from `_systemd_show`'s Environment= line. Nothing reads port from app.json. |
| D-08 | Created-at is folder mtime, not a stored field | VERIFIED | `fleet-status-sweep.py:1240-1246`: `folder_mtime_ms = int(os.stat(folder_path).st_mtime * 1000)`. Field name `created_at_ms` on wire; `createdAtMs` on TS side. |
| D-09 | Separate `Map<hostId:slug, AppState>` sibling to SessionState map | VERIFIED | `subscription-registry.ts:341`: `const apps = new Map<string, AppState>()` — sibling to the existing SessionState `state` map. Distinct `makeAppKey(hostId, slug)` helper mints keys (T-118-03-KC belt-and-suspenders). |
| D-10 | No database, no schema, no migration | VERIFIED | `grep -c -E "DatabaseSaveTrigger\|db\.insert\|db\.update\|db\.delete\|drizzle\|sqlite"` = **0** across all six Phase 118 TS files (`ssh-poll-orchestrator.ts`, `subscription-registry.ts`, `wire-protocol.ts`, `sweep-schema.ts`, `app-frame-filter.ts`, `fleet-status-server.ts`). |
| D-11 | Adopt Phase 115's reconciliation pattern verbatim, for apps | VERIFIED | `ssh-poll-orchestrator.ts:1898-1907` — reconciliation block sits immediately after identity reconciliation (L1842-1853), mirrors its shape byte-for-byte with `parsed.appLines` in place of `parsed.identityLines` and `hostState.lastTickLiveApps` in place of `lastTickLiveTreeIdentities`. `PerHostState.lastTickLiveApps: Set<string>` declared at L506 and initialized at L3130. |
| D-12 | Reconciliation ONLY runs on sweep success | VERIFIED | All 4 `{ok: false}` early returns in `pollOneHostBatch` at L1723, L1731, L1747, L1771 sit ABOVE the compose+publish loop (L1868) AND the reconciliation block (L1898-1907). Structurally impossible to reach reconciliation on failure. Widened empty-output branch (L1761-1774) now includes `parsed.appLines.length === 0` and `hostState.lastTickLiveApps.size > 0` in the "did the sweep emit anything" heuristic (Rule 3 auto-fix from Plan 04 SUMMARY, correctly documented). |
| D-13 | Health changes are updates, not gone+add | VERIFIED | `ssh-poll-orchestrator.ts:1898-1901` — the tracking set adds EVERY slug in `parsed.appLines` regardless of `is_healthy`, so a healthy→unhealthy flip stays in `thisTickLiveApps` and never triggers `publishAppGoneByHostSlug`. The health flip emits via `publishAppUpdate` in the compose loop (L1868-1873). `publishAppUpdate` has NO byte-equality guard (subscription-registry.ts:582-583 comment explicit). |
| D-14 | Three new frame types on the fleet-status WS channel | VERIFIED | `wire-protocol.ts:646-663` declares `AppSnapshotFrameSchema` (`type: "app-snapshot"`), `AppUpdateFrameSchema` (`type: "app-update"`), `AppGoneFrameSchema` (`type: "app-gone"`). All three added to `FrontendOutboundFrame` discriminated union at L671-673. Factories `makeAppSnapshotFrame` / `makeAppUpdateFrame` / `makeAppGoneFrame` exported at L740-782. Piggybacks on the existing `/fleet-status/ws` endpoint. |
| D-15 | Per-user host-visibility filter applied at wire boundary | VERIFIED | `app-frame-filter.ts` — greenfield module with `filterAppFrame` + `createAppFrameFilter`. Uses `checkHostAccess` from `../ssh/host-resolver` (imported line 37). `grep -rn "checkHostAccess" src/backend/fleet-status/` returns 30+ hits — all in the new filter and its tests. Filter is composed in `subscription-registry.ts` (`fanOutApp` async helper at L270, called from `publishAppUpdate:592-593` and `publishAppGoneByHostSlug:613-614`) AND on the subscribe-path snapshot emit (`subscription-registry.ts:432-450`). Combinatorial WS tests in `fleet-status-server.test.ts` Server-1..Server-5 exercise the matrix. |
| D-16 | Snapshot on subscribe is required | VERIFIED | `subscription-registry.ts:415-462` — subscribe() always calls `makeAppSnapshotFrame(Array.from(apps.values()))`, then delivers either through the filter (when wired + userId present) or synchronously. Emit is UNCONDITIONAL — an empty apps map produces `apps: []`. Matches the shape of the pre-existing session snapshot + archived-identity re-emit blocks above it. |
| D-17 | One new JSONL line-type ("app") on fleet-status-sweep.py | VERIFIED | `fleet-status-sweep.py:1252` emits `"line_kind": "app"`. TS parser dispatch at `sweep-schema.ts:392-398` — `else if (rec.line_kind === "app") { appLines.push(parsed as SweepAppLine); }`. Line count is exactly 3 known kinds: identity, pid, app. |
| D-18 | Sweep script parse-failure discipline — fail-open per-app | VERIFIED | `fleet-status-sweep.py:1198-1200` — `except (OSError, json.JSONDecodeError): _log(...); return None`. Enumerator at L1291-1299 wraps `_build_app_line` in `try/except Exception` (belt-and-braces). Shell test case 2 (`test_case_02_malformed_json`) proves: bad app skipped, stderr logs `app_json_missing_or_malformed`, sibling good app still emits. All 7 shell test cases PASS. Regression: pre-existing `fleet-status-sweep.test.sh` still 7/7 PASS. |
| D-19 | Sweep script stays within exec timeout | VERIFIED | Per-systemctl timeout `APP_SUBPROCESS_TIMEOUT_SEC = 1.5` at fleet-status-sweep.py:187. One `_systemd_show` subprocess per app (RESEARCH § Q6 optimization). Orchestrator's `SWEEP_EXEC_TIMEOUT_MS = 8000` (ssh-poll-orchestrator.ts:1450) is pre-existing and untouched — even more generous than CONTEXT's "~5s" note. At Ashley's ~10-app ceiling, worst case is ~15s of systemctl budget (10 × 1.5), but that only fires under pathological wedge conditions; healthy `systemctl show` returns in ~10ms. |
| D-20 | Extend sweep-schema.ts to type the new line | VERIFIED | `sweep-schema.ts:250-261` — `SweepAppLine` interface with all 10 wire fields. `SweepLine` union widened at L267. `isSweepLineOfCurrentSchema` widened at L287. `SweepParseResult` extended with `appLines: SweepAppLine[]` at L305. Parser dispatch at L392-398. `SWEEP_SCHEMA_VERSION` NOT bumped (additive discipline). Extended `SWEEP_FIELD_PARITY` map with C0..C8 rows. |
| D-21 | Test at four layers — parse, reconciliation, wire, filter | VERIFIED | Parse: `sweep-schema.test.ts` 39 tests (9 new for SweepAppLine dispatch); shell driver 7 cases. Reconciliation: `ssh-poll-orchestrator.test.ts` A1-A5 (removal, disappearance, transient-failure, health-flip, schema-mismatch). Wire: `wire-protocol.test.ts` 68 tests (8 new for app frames); `subscription-registry.test.ts` 35 tests (7 new for apps map + snapshot). Filter: `app-frame-filter.test.ts` 12 tests; `subscription-registry.test.ts` Filter-1..Filter-7 (7 integration tests); `fleet-status-server.test.ts` Server-1..Server-5 (5 combinatorial WS tests). Executor scoped run: 386 tests passed across 10 files. |
| D-22 | Executor uses scoped test runs | VERIFIED | `git log --format="%B" 55630853^..d7a75bea | grep -iE "npx vitest run\b"` returns **0 matches**. All executor commit bodies use `npx vitest related --run <paths>` or path-scoped invocations. |
| D-23 | Real end-to-end integration test on this box | VERIFIED (agent-UAT documented in 118-01-SUMMARY.md) | Plan 118-01 SUMMARY documents the D-23 UAT ran on t1000: created `~/fleet/apps/scratch-t116-uat/` with real `app.json` + real systemd `--user` unit, ran the sweep, saw the healthy emit; stopped the unit, saw the unhealthy emit with the exact D-03 string; cleaned up. This is an agent-UAT (per CONTEXT D-23) not a CI test; the SUMMARY transcript is the audit trail. The final plan-set D-23 (WS end-to-end with two subscribers and starter.ts wired) is still pending the deploy motion — flagged below. |

---

## Data-Flow Trace (Level 4)

Traced the full pipeline end-to-end:

| Stage | File | Verified |
|-------|------|----------|
| App on disk → JSONL emit | `fleet-status-sweep.py:_enumerate_apps` → `_emit` | YES — real `os.scandir` + `systemctl show` + `os.stat` calls, no static fallbacks. Shell test smoke against real systemd on t1000 (SUMMARY 118-01) proves real data flows. |
| JSONL → SweepAppLine | `sweep-schema.ts:parseSweepJsonl` L392-398 | YES — lenient cast into `SweepAppLine[]`, one line per JSONL entry. |
| SweepAppLine → AppState | `ssh-poll-orchestrator.ts:adaptAppLineToState` L1215-1227 | YES — pure field-copy; stamps hostId; no defensive undefined. |
| AppState → publishAppUpdate | `ssh-poll-orchestrator.ts:1868-1873` (compose+publish loop) | YES — inside `{ok:true}` scope; calls `deps.registry.publishAppUpdate(host.id, adaptAppLineToState(host.id, appLine))` per app line. |
| publishAppUpdate → fanOut/fanOutApp | `subscription-registry.ts:579-596` | YES — routes through `fanOutApp` if filter wired, `fanOut` otherwise. `apps.set(key, app)` before fan-out (map is live source of truth for subsequent snapshots). |
| fanOutApp → filterAppFrame → subscriber | `app-frame-filter.ts:filterAppFrame` L143-240 | YES — resolves hostId → hostUserId → `checkHostAccess("read")`; returns projected frame or null; TTL cache (30s default). Zero data disconnects. |
| subscribe() → app-snapshot | `subscription-registry.ts:415-462` | YES — always calls `makeAppSnapshotFrame(Array.from(apps.values()))`. Filter routing branches. |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| fleet-status-sweep.py | JSONL wire | stdout newline emit at `_emit` | WIRED (shell test verifies) |
| sweep-schema.ts | ssh-poll-orchestrator.ts | `parsed.appLines` iteration L1868, L1899 | WIRED (grep shows 4 uses of `parsed.appLines` in orchestrator) |
| ssh-poll-orchestrator.ts | subscription-registry.ts | `deps.registry.publishAppUpdate` L1869; `deps.registry.publishAppGoneByHostSlug` L1904 | WIRED (both call sites exist inside `{ok:true}` scope) |
| subscription-registry.ts | wire-protocol.ts | `makeAppSnapshotFrame`, `makeAppUpdateFrame`, `makeAppGoneFrame` imports at L18-20 | WIRED |
| subscription-registry.ts | app-frame-filter.ts | Optional `deps.appFrameFilter` on `createSubscriptionRegistry`; called from `fanOutApp` L282 | WIRED (integration tests Filter-1..7 exercise both wired and unwired modes) |
| fleet-status-server.ts | app-frame-filter.ts | Three-way construction branch L149-184 | WIRED (Server-1..Server-5 tests use `resolveHostOwnerById` injection) |
| starter.ts | fleet-status-server.ts | `startFleetStatusServer({ ..., registry })` L487-492 | **WIRED BUT UNFILTERED** — pre-built registry passed, no `resolveHostOwnerById`. This is the DEPLOY-MOTION flag Plan 05 SUMMARY documented (see below). |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest passes on touched files | `npx vitest related --run src/backend/fleet-status/{app-frame-filter,subscription-registry,wire-protocol,sweep-schema}.ts` | 386/386 tests passed across 10 files | PASS |
| Shell sweep-apps test passes | `bash substrate/scripts/tests/fleet-status-sweep-apps.test.sh` | PASS 7 / FAIL 0 | PASS |
| Sweep script regression clean | `bash substrate/scripts/tests/fleet-status-sweep.test.sh` | PASS 7 / FAIL 0 | PASS |

---

## Requirements Coverage

ROADMAP Phase 118 entry has no explicit requirement IDs (marked "TBD"). CONTEXT.md D-01..D-23 IS the contract for this phase. Every decision has been mapped to codebase evidence above.

---

## Anti-Patterns Scan

| File | Line | Pattern | Severity | Notes |
|------|------|---------|----------|-------|
| substrate/scripts/tests/fleet-status-sweep-apps.test.sh | 123 | Comment referencing `\uXXXX` (documentation) | INFO | Not a debt marker — inside a docstring explaining `ensure_ascii=False`. |

Grep for `TBD|FIXME|XXX|HACK|PLACEHOLDER` across all Phase 118 modified files returns **zero debt markers**. `TODO` search: none in Phase 118 modified files.

Grep for hardcoded empty rendering (`return \[\]|return null` on hot paths) in the modified files reveals only legitimate empty-state returns (e.g. `_enumerate_apps` returning `[]` when `~/fleet/apps/` is absent — D-19 fail-open discipline).

---

## Deploy-Motion Pre-Flight Checklist

These are LOAD-BEARING items surfaced by Plan 05's SUMMARY that must land in the same deploy as this plan-set. All are correctly flagged and NOT included in Phase 118 executor scope (per fleet directive #10):

### 1. starter.ts wiring — DEFERRED as expected

**Status:** starter.ts at `src/backend/starter.ts:485-492` still passes a pre-built `registry` to `startFleetStatusServer` and does NOT pass `resolveHostOwnerById`. This means at server startup today, the three-way construction branch in `fleet-status-server.ts:149-159` takes branch (1) — the caller owns wiring, so the app-frame filter is **NOT active in production**. The server will log `fleet_status_filter_wiring_skipped` at boot if `resolveHostOwnerById` is also passed, or `fleet_status_unfiltered_mode` if neither is passed (currently the former will NOT log because the field is undefined; the pre-built-registry-only branch is silent).

**Deploy motion must:**
- (a) Delete the `createSubscriptionRegistry()` call in starter.ts and stop passing `registry` to `startFleetStatusServer`.
- (b) Add a `resolveHostOwnerById` closure in starter.ts reading the host record via the DB pattern used by `resolveHostRecordByName`, returning `{ hostIdNum: Number(record.id), hostUserId: record.userId }` or null.
- (c) Pass `resolveHostOwnerById` to `startFleetStatusServer`. Server will construct filter + registry internally and log `fleet_status_filter_attached`.
- (d) Downstream consumers using the pre-built registry (e.g. the ssh-poll-orchestrator wiring in starter.ts:498+) must switch to reading the registry from the `startFleetStatusServer` return value (`.registry` is now exposed).
- (e) Deploy verification: grep the boot log for `fleet_status_filter_attached` before considering the deploy healthy. Absence of that log line OR presence of `fleet_status_filter_wiring_skipped` / `fleet_status_unfiltered_mode` = smoke signal that filtering is NOT active.

### 2. resolveHostOwnerById dep-injection seam — PRESENT and load-bearing

**Status:** The seam exists correctly. `createAppFrameFilter({ resolveHostOwnerById, ttlMs?, _checkHostAccess? })` at `app-frame-filter.ts:263-278` is the entry point. The `resolveHostOwnerById` field on `FleetStatusServerOptions` (`fleet-status-server.ts:77-79`) is optional. The three-way construction branch honors it correctly.

**Deploy motion must** supply a real resolver (see step 1(b) above). Without it, the filter is not constructed — the app-frame filter code is dormant.

### 3. Plan-set atomicity — VERIFIED

**Status:** All 5 plans landed on the same branch `feat/tab-title-from-tmux` in commit order 118-01 → 118-02 → 118-03 → 118-04 → 118-05 with no intervening non-116 commits. `git log 55630853..d7a75bea` returns 20 commits, all tagged with 116-XX prefixes. The T-118-03-IL info-disclosure gap (unfiltered app fan-out) is closed by Plan 05 landing in the same push; do NOT split this plan-set across deploys.

### 4. D-23 full end-to-end UAT

**Status:** Partial. Plan 118-01 executed the sweep-loop half of D-23 on t1000 (SUMMARY transcript). The full end-to-end (subscribe as U1 vs U2, verify per-user projection over the WS pipe with the wired filter) is documented as pre-deploy UAT in Plan 05 SUMMARY § "Deploy-Gate Reminders" item 3. This must run after starter.ts wiring lands, before container swap.

### 5. Container-mutation serialization (Ashley 2026-09-12)

**Status:** Standard fleet rule. Coordinate with Ashley before any `docker compose up -d --force-recreate skynet`.

### 6. 15-min deadman rollback

**Status:** Standard fork rule. `/opt/skynet/.tmp-revert.sh` must be armed for the deploy window.

---

## Gaps Summary

**No blocking gaps.** All 23 locked decisions D-01..D-23 have codebase evidence. All executor-scope tests pass (386 vitest + 7 shell + 7 regression shell). The two DEPLOY-MOTION flags (starter.ts wiring + full D-23 WS UAT) are correctly deferred to the deploy motion per fleet directive #10 and are documented in the Deploy-Motion Pre-Flight Checklist above. They are NOT executor-scope failures — they are the intentional handoff surface between "executor-complete" and "deploy-ready".

---

_Verified: 2026-09-18T04:45:00Z_
_Verifier: Claude (Opus 4.7 — gsd-verifier, goal-backward mode)_
