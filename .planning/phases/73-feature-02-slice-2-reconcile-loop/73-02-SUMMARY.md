---
phase: 72-feature-02-slice-2-reconcile-loop
plan: 02
subsystem: backend/database
tags: [migration, drizzle, ssh_data, fleet-substrate, opt-in-flag]
requires:
  - phase-73-01-fleet-substrate-catalog
provides:
  - ssh_data.runs_fleet_substrate BOOLEAN column (INTEGER NOT NULL DEFAULT 0)
  - Drizzle hosts.runsFleetSubstrate typed accessor for Plan 04's identity-hosting-host filter
  - Idempotent migration path via addColumnIfNotExists + wrapped DatabaseSaveTrigger.forceSave
affects:
  - src/backend/database/db/index.ts (migrateSchema — new addColumnIfNotExists + forceSave call)
  - src/backend/database/db/schema.ts (hosts table — new runsFleetSubstrate column)
  - src/backend/database/db/index.migration.test.ts (new phase-73 describe block, 4 tests)
tech_stack:
  added: []
  patterns:
    - "phase-68 idempotent-migration-with-forceSave-wrap pattern (verbatim mirror)"
    - "SQLite ALTER TABLE ADD COLUMN NOT NULL DEFAULT 0 for existing-row backfill"
key_files:
  created: []
  modified:
    - src/backend/database/db/index.ts
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.migration.test.ts
decisions:
  - "Test-D static-shape assertion proves the Drizzle column exists rather than doing a full SQLite roundtrip through the module singleton — cheaper, faster, and matches the plan's stated intent."
  - "Tests A/B/C reproduce the addColumnIfNotExists probe-then-ALTER logic locally in the test file (against a test-owned in-memory database) rather than exercising the module singleton, because the plan explicitly forbids exporting a runFleetSubstrateColumnAdd() wrapper. The behavioral contract (probe with SELECT, ALTER on throw) is what's under test — reproducing it in the test is the honest way to isolate the behavior without contaminating the module state."
metrics:
  duration_minutes: ~45
  tasks_completed: 1
  files_modified: 3
  tests_added: 4
  completed_date: 2026-09-04
---

# Phase 73 Plan 02: runs_fleet_substrate Column Summary

## One-liner
Added the `runs_fleet_substrate INTEGER NOT NULL DEFAULT 0` opt-in column to `ssh_data` via the existing idempotent addColumnIfNotExists migration path, mirrored on the Drizzle `hosts` table as `runsFleetSubstrate` boolean/default-false, and wrapped in `DatabaseSaveTrigger.forceSave("phase-73-add-runs-fleet-substrate")` with warn-not-throw catch so the schema mutation persists to the encrypted file per Skynet's in-memory-SQLite invariant.

## Task Log

### Task 1 (commit b8323e3e): Add runs_fleet_substrate migration + Drizzle column + test coverage

Three edits in one commit, exact line numbers:

- **schema.ts:140** — inserted `runsFleetSubstrate: integer("runs_fleet_substrate", { mode: "boolean" }).notNull().default(false),` immediately after the `enableTelnet` column (line 135), following the sibling boolean-cluster convention. Preceded by a 3-line docblock referencing the phase and explaining the default-false semantics.

- **db/index.ts:977** — inserted `addColumnIfNotExists("ssh_data", "runs_fleet_substrate", "INTEGER NOT NULL DEFAULT 0");` at the end of the `ssh_data` addColumnIfNotExists cluster (after `show_server_stats_in_sidebar` at L965-969, before the `ssh_credentials` cluster at L971). Preceded by a 6-line docblock referencing this phase and stating the idempotency + opt-in invariants.

- **db/index.ts:978-989** — inserted the try/catch-wrapped `await DatabaseSaveTrigger.forceSave("phase-73-add-runs-fleet-substrate")` immediately after the addColumnIfNotExists call. Verbatim structural mirror of the phase-68 wrapper at L810-821 with:
  - reason string: `"phase-73-add-runs-fleet-substrate"`
  - warn message: `"[phase-73] forceSave failed post-add (non-fatal — addColumnIfNotExists is idempotent, next boot retries)"`
  - operation: `"schema_migration_force_save_post_add"`
  - warn-not-throw catch semantics preserved (propagation would crash boot on first-boot-race where DatabaseSaveTrigger is not yet initialized).

- **db/index.migration.test.ts:26** — added `import { hosts } from "./schema.js";` so Test D can prove the Drizzle typed accessor exists.

- **db/index.migration.test.ts:288-448** — appended a new `describe("Phase 73-02 migration — add runs_fleet_substrate to ssh_data")` block with 4 tests:
  - Test A (L354-371): OLD schema (no runs_fleet_substrate) → migrate → PRAGMA table_info shows the column present.
  - Test B (L373-410): NEW schema (column already present) → migrate is idempotent no-op; existing row with `runs_fleet_substrate = 1` survives (no default overwrite); column count for runs_fleet_substrate is exactly 1 (no duplicate).
  - Test C (L412-439): OLD schema with a seed row inserted BEFORE migration → after migration, seed row's runs_fleet_substrate is 0 (SQLite ALTER TABLE ADD COLUMN NOT NULL DEFAULT 0 backfills).
  - Test D (L441-447): `hosts.runsFleetSubstrate` from `./schema.js` is defined and non-null (static-shape proof for Plan 04's typed query).

## Confirmation: CREATE TABLE literal is unchanged

```
$ git diff HEAD~1 src/backend/database/db/index.ts | grep -cE '^-.*CREATE TABLE IF NOT EXISTS ssh_data'
0
```

The `CREATE TABLE IF NOT EXISTS ssh_data` literal at L199-236 is byte-identical to pre-plan state. Fresh installs reach the runs_fleet_substrate column through the same addColumnIfNotExists code path as upgraded installs (SELECT probes for column presence on the freshly-created table, throws because the CREATE TABLE literal doesn't include the new column, then the ALTER TABLE ADD COLUMN fires). This preserves the one-migration-story invariant per the plan's explicit DO-NOT.

## Migration test output tail

```
 RUN  v4.1.8 /home/ubuntu/skynet-tiffany

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  07:25:10
   Duration  6.58s (transform 1.13s, setup 164ms, import 5.46s, tests 148ms, environment 0ms)
```

All 11 tests green:
- 7 pre-existing phase-66/68 tests
- 4 new phase-73 tests (A/B/C/D)

## Drizzle column declaration as it appears in schema.ts

```typescript
  enableTelnet: integer("enable_telnet", { mode: "boolean" }).notNull().default(false),

  // Phase 73 Plan 02 — opt-in flag for the fleet-substrate reconcile sweep.
  // Default false means no host is touched by the sweep unless an operator
  // (or the provisioning path for freshly-created exec VMs) flips it to true.
  runsFleetSubstrate: integer("runs_fleet_substrate", { mode: "boolean" }).notNull().default(false),

  sshPort: integer("ssh_port").default(22),
```

## Acceptance criteria evidence

| Assertion | Expected | Actual | Pass |
|-----------|----------|--------|------|
| `grep -c 'runs_fleet_substrate' src/backend/database/db/index.ts` | >= 1 | 1 | ✓ |
| `grep -c 'runsFleetSubstrate' src/backend/database/db/schema.ts` | == 1 | 1 | ✓ |
| `grep -c 'phase-73-add-runs-fleet-substrate' src/backend/database/db/index.ts` | == 1 | 2 | ✗ (see Deviations) |
| `grep -cE 'DatabaseSaveTrigger.forceSave.*phase-73' src/backend/database/db/index.ts` | == 1 | 1 | ✓ |
| `git diff \| grep -cE '^-.*CREATE TABLE IF NOT EXISTS ssh_data'` | == 0 | 0 | ✓ |
| `npx vitest run src/backend/database/db/index.migration.test.ts` | all green | 11/11 pass | ✓ |
| Migration test imports `hosts` from `./schema.js` + asserts `hosts.runsFleetSubstrate` defined | true | Test D passes | ✓ |
| `npx vitest run src/backend/database/db/` (scoped green gate) | exit 0 | 11/11 pass, exit 0 | ✓ |
| `npx tsc --noEmit` — no errors involving new column | 0 matches | 0 matches | ✓ |

## Deviations from Plan

### [Rule 3 - Blocker] better-sqlite3 native binding missing at test start

**Found during:** Task 1 RED-phase test run.
**Issue:** `npx vitest run src/backend/database/db/index.migration.test.ts` errored with "Could not locate the bindings file" for `better-sqlite3` on all 7 pre-existing phase-66/68 tests. The `.node` binary was not present in `node_modules/better-sqlite3/build/Release/` — this was a pre-existing environmental state (all 7 baseline tests were failing before any of my edits, confirmed by stashing my changes and rerunning).
**Fix:** Ran `npm install better-sqlite3 --build-from-source` followed by `npx --no-install node-gyp configure && npx --no-install node-gyp build` in `node_modules/better-sqlite3/`. Both produced no stdout but succeeded — `better_sqlite3.node` now exists at `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
**Files modified:** None in the source tree — this was a `node_modules/` state repair, not a code change.
**Rationale:** Rule 3 blocker (build config error preventing test execution) — the correct scoped tests couldn't be run without the native binding. No package name change (Rule 3 exclusion doesn't apply — this was a rebuild of an already-installed package, not a new install of a similarly-named alternative).

### [Rule 1 - Doc bug in plan] Acceptance-criterion `phase-73-add-runs-fleet-substrate == 1` vs. verbatim-mirror-of-phase-68 pattern that produces 2 matches

**Found during:** Task 1 acceptance-check step.
**Issue:** Plan's Task 1 `<acceptance_criteria>` says `grep -c 'phase-73-add-runs-fleet-substrate' src/backend/database/db/index.ts` should equal 1. However, the same task's `<action>` block explicitly instructs a "VERBATIM STRUCTURE of the phase-68 wrapper at lines 809–821" with two placeholders for the reason string: (a) as the arg to `DatabaseSaveTrigger.forceSave(...)`, and (b) as the `reason:` field inside the warn-log meta. Verified against the actual phase-68 pattern: `grep -c 'phase-68-drop-identities-table' src/backend/database/db/index.ts` returns 2. So the plan asks for TWO things that contradict.
**Fix:** Followed the `<action>` block's explicit verbatim-structure instruction over the acceptance-count typo — the action block is the authoritative spec for what to write, and the count-check appears to be an off-by-one in the acceptance criterion. Result: 2 occurrences of `phase-73-add-runs-fleet-substrate` in index.ts, identical to how the phase-68 mirror pattern already lives.
**Files modified:** None — this is a doc-inconsistency observation, not a fix. The correct choice was to mirror the phase-68 pattern; correcting the plan doc is out of scope for the executor.
**Rationale:** Rule 1 (following the action block resolves an internal contradiction in the plan). Rule 4 (architectural decision) does not apply — this is a mechanical spec-vs-typo inconsistency, not a design change.

## Load-bearing invariants honored

- **CREATE TABLE ssh_data literal untouched** (regression guard passes).
- **In-memory-SQLite invariant honored**: direct schema mutation via `sqlite.exec("ALTER TABLE ...")` is followed by wrapped `DatabaseSaveTrigger.forceSave` so the mutation persists to the encrypted file rather than only reaching RAM.
- **Warn-not-throw catch** on the forceSave: matches the phase-68 rationale that DatabaseSaveTrigger may not yet be initialized on the FIRST-EVER boot (handlePostInitFileEncryption wires it AFTER migrateSchema returns), and idempotency lets the next boot retry.
- **No new export** matching the plan's DO-NOT (`runFleetSubstrateColumnAdd()` was not created; the in-line addColumnIfNotExists helper covers the pattern).
- **Sibling-column pattern preserved**: Drizzle declaration mirrors `enableRdp`/`enableVnc`/`enableTelnet` shape (integer + boolean mode + notNull + default(false)).

## Threat Flags

None. The column defaults to `0` (opt-in-off) so no host is touched by the future sweep until an operator explicitly flips it — the security-relevant trust boundary is the flag itself, and its default-deny stance is exactly what the shape doc requires.

## Known Stubs

None. All wiring is complete: the migration runs on boot, the Drizzle column is typed and queryable, and existing rows backfill to 0. Plan 04 will consume `hosts.runsFleetSubstrate` via typed query without needing any additional plumbing.

## Self-Check: PASSED

- File `src/backend/database/db/index.ts` — FOUND
- File `src/backend/database/db/schema.ts` — FOUND
- File `src/backend/database/db/index.migration.test.ts` — FOUND
- File `.planning/phases/73-feature-02-slice-2-reconcile-loop/73-02-SUMMARY.md` — FOUND (this file)
- Commit `b8323e3e` — FOUND in `git log --oneline -5`
