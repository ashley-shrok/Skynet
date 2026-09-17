---
phase: 115-identity-archiving-from-the-frontend
plan: 05
subsystem: fleet-status sweep (Python emitter + TS parser)
tags: [phase-115, sweep, archived, unified-walk, B9-reuse, D-18]

# Dependency graph
requires:
  - phase: 115
    plan: 02
    provides: "B9 wire slot vacated when `.hidden` was retired from SweepIdentityLine per D-21 — 115-05 reuses the slot for `archived`"
  - phase: 92
    provides: "the SweepIdentityLine wire contract + parseSweepJsonl parser this plan extends"
  - phase: 111
    plan: "01/02"
    provides: "the optional-field / mid-distribution-tolerance pattern (`?:` on the type + isSweepLineOfCurrentSchema check only on schema_version+line_kind) that 115-05 follows verbatim for the new archived field"
provides:
  - "`fleet-status-sweep.py` walks BOTH `~/fleet/identities/` and `~/fleet/identities-archive/` in a single unified loop; archive-tree rows emit `archived: true`"
  - "`SweepIdentityLine.archived?: boolean` — sibling to `pinned?`, optional for older-box tolerance"
  - "`SWEEP_FIELD_PARITY.B9 = { field: 'archived' }` (reuses the freed 115-02 slot)"
  - "Bash test coverage for the archive-tree walk at `substrate/scripts/tests/fleet-status-sweep.test.sh` (6 cases)"
  - "Vitest coverage for the new schema field at `sweep-schema.test.ts` (4 new tests + parity walk extension)"
  - "The `.hidden` emit key + probe deleted from fleet-status-sweep.py — 115-02 removed the TS schema but did not sync the Python emitter; this plan closes that gap alongside adding archived"
affects: [115-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wire-slot reuse across generations: when a phase retires a schema field, the freed wire slot ID (here B9) can be reused by a later phase for a semantically-fresh axis. Comments at both slot sites document the lineage (`retired by 115-02` → `reused by 115-05`)."
    - "Multi-root unified walk with per-root flag: enumerating multiple filesystem trees (live + archive) in a SINGLE loop with a per-root discriminator flag (archived_flag) rather than two parallel walks. Sentinel handling is symmetric; downstream logic that keys on identity name is unified."
    - "Fail-open per-root FileNotFoundError: an absent tree is a normal state (fresh host has no archive tree yet; archive-only host would have no live tree). Catch per-root + continue so a missing root does not swallow emission from the OTHER root."
    - "Retirement-gap closure: 115-02 removed `.hidden` from the schema but the Python-side emitter still carried the field. 115-05 closes that gap AS PART OF its scope rather than deferring — the emitter carrying a field the schema doesn't know is a rot signal; closing it here keeps the Python↔TS parity invariant."

key-files:
  created:
    - "substrate/scripts/tests/fleet-status-sweep.test.sh (bash test harness — 6 cases covering the unified walk)"
    - ".planning/phases/115-identity-archiving-from-the-frontend/115-05-SUMMARY.md"
  modified:
    - "substrate/scripts/fleet-status-sweep.py (_enumerate_identities: unified loop over both roots with archived_flag + per-root FileNotFoundError catch; _build_identity_line emit-dict adds archived key; main() synthetic-record and emit-loop call sites propagate archived; `.hidden` probe + emit key deleted)"
    - "src/backend/fleet-status/sweep-schema.ts (SweepIdentityLine.archived?: boolean; SWEEP_FIELD_PARITY discriminator union extended with B9; B9 entry added mapping to `archived`)"
    - "src/backend/fleet-status/sweep-schema.test.ts (4 new tests for archived + EXPECTED_KEYS gains B9 + identityFields gains archived)"
    - "substrate/scripts/tests/fleet-status-sweep-appearance.sh (test_case_06_sentinels: dropped stale `hidden: true/false` assertions retained after 115-02 but never synced — pinned axis retained)"

decisions:
  - "B9 slot REUSED (not a new letter/number scheme). Rationale: 115-02 vacated B9 explicitly to reserve it for the archived axis (see 115-02 SUMMARY line: 'the B9 wire slot is now vacated — 115-05 can reuse it for archived'). Reusing the slot keeps the parity map ordinal-stable and matches the plan's `<action>` (b) explicit recommendation."
  - "`.archive-requested` probe NOT added to the sentinel walk. Plan `<action>` (b) explicitly recommended `omit for now`. Rationale: the `archived: true` flag alone (disk-root = archive tree) is sufficient for D-18. A future phase can add a `archive_requested?: boolean` field to surface a `retire in flight` state if it wants; scope creep here would grow the wire without a consumer."
  - "`archived` field on SweepIdentityLine is optional (`?: boolean`), matching the Plan 111-01 appearance-fields pattern. Older boxes (pre-115-05 sweep script, single-tree walk, no archived emission) emit lines that omit `archived` entirely; the parser accepts them (schema_version==1 + line_kind gate; the bare cast admits missing keys as undefined). Mid-distribution tolerance is now a phase-established convention across 111-01, 111-02, and 115-05."
  - "Fixed the 115-02 retirement gap on `fleet-status-sweep.py`. 115-02 removed `.hidden` from the TS schema but left the Python emitter still emitting `hidden: <bool>` on identity lines. This plan deletes that dangling code path alongside adding archived — the Python↔TS parity invariant would otherwise be broken (Python emits a key the TS schema does not know about, which passes isSweepLineOfCurrentSchema's shallow gate but leaves a phantom field in every parsed identity line). Categorized as Rule 3 (blocking issue): could not complete Task 1 without touching this."
  - "Cross-root name collision (same name in both live and archive trees): both records emit. Per RESEARCH §5 note: shouldn't happen because retire-flow's collision-abort logic prevents it. If it does happen, the frontend sees two rows (one live, one archived) and the source-B adapter routes each to the appropriate pool. No dedup here — RESEARCH §5 explicitly accepts this behavior."
  - "Distinct wire message for frontend (`{ kind: 'identity-archived', ... }`) NOT implemented in this plan. That's 115-06's scope. This plan only adds the `archived` field on the sweep-JSONL layer (Python emitter → TS parser). The docblock on SweepIdentityLine explicitly documents the intended 115-06 separation: `archived` is a sweep-JSONL wire-shape building block, and the ssh-poll-orchestrator (115-06) will transform archived-tree rows into a distinct WS message rather than bolting archived onto the standard identity frame."
  - "Bash test file structural fix: STDERR_FILE moved from a subshell-scoped LAST_STDERR variable to a per-test path set in run_test(). Rationale: `out=\\$(run_sweep)` puts run_sweep in a subshell; a LAST_STDERR set inside the subshell is lost by the time the caller checks it. Setting STDERR_FILE=\\$(mktemp) in run_test() before invocation makes the path visible to both the subshell (which writes to it) and the caller (which greps it). The 115-02 style of just using a scratch dir would have worked too, but per-test file + rm at test end is simpler."

# Metrics
duration: ~35min
completed: 2026-09-17
---

# Phase 115 Plan 115-05: Unified archive-tree walk in fleet-status-sweep Summary

**Grew `fleet-status-sweep.py` to enumerate `~/fleet/identities-archive/` alongside `~/fleet/identities/` in a single unified loop (per RESEARCH §5's diff sketch), emitting `archived: true` on archive-tree rows; added `SweepIdentityLine.archived?: boolean` reusing the B9 wire slot vacated by 115-02; closed a residual 115-02 retirement gap on the Python emitter that still carried the retired `.hidden` field. Delivers D-18. 4 atomic commits, 6/6 archive-walk bash tests + 11/11 appearance bash tests + 30/30 sweep-schema vitest tests + 162/162 ssh-poll-orchestrator regression tests green.**

## Performance

- **Duration:** ~35 min wall-clock across two TDD tasks
- **Started:** 2026-09-17 (executor spawn)
- **Task 1 RED:** `6c254862` — bash test harness (6 failing cases)
- **Task 1 GREEN:** `70247e9c` — sweep script + appearance-test fix
- **Task 2 RED:** `d6fd47e2` — schema tests (4 failing cases including parity walk regression from EXPECTED_KEYS extension)
- **Task 2 GREEN:** `07761b1b` — schema field + B9 parity entry
- **Total:** 4 files touched (2 modified in src/backend, 1 modified + 1 created in substrate/scripts/tests, 1 modified in substrate/scripts), plus this SUMMARY

## Accomplishments

### Task 1 — Unified walk in fleet-status-sweep.py (RED `6c254862`, GREEN `70247e9c`)

**Sweep script (`substrate/scripts/fleet-status-sweep.py`):**

- Rewrote `_enumerate_identities(home)` to walk BOTH `~/fleet/identities/` (archived_flag=False) and `~/fleet/identities-archive/` (archived_flag=True) in a single `for root, archived_flag in (...):` loop. Sentinel probes (`.dormant`, `.recycled-at`, `.recycle-requested`, `.pinned`) run identically against both roots. Each emitted dict now carries `archived: archived_flag` instead of `hidden: <bool>`.
- `FileNotFoundError` is caught per-root inside the loop with `continue` (not an early return like the old single-tree version): a missing archive tree on a fresh host does not swallow emission from the live tree, and vice-versa. A fresh host with neither tree returns `[]` — the correct fail-open shape.
- `OSError` (non-ENOENT) logs `identities_scandir_failed` WITH the failing root path now (previously only errno), and continues to the next root rather than early-returning.
- Docblock updated to document the Plan 115-05 unified-walk shape + the retirement of `.hidden` from 115-02.

**Emit function (`_build_identity_line`):**

- Added `"archived": sentinels.get("archived", False)` to the emit dict — the `.get()` is defense-in-depth for the synthetic-identity-record path in `main()` where a PID-only identity might miss the `archived` key.
- Deleted the trailing `"hidden": sentinels["hidden"]` emit key (115-02 removed the TS schema field but never synced this line; the field would have arrived at parseSweepJsonl and been silently accepted as an unknown key via the bare-cast pattern, but its presence was inconsistent with the schema — closing this gap now under Rule 3).

**Main orchestration (`main()`):**

- Synthetic identity records for PID-only identities (identities discovered via `/proc/<pid>/environ` but not present in either folder scan) now carry `"archived": False` instead of `"hidden": False`. Rationale documented inline: a PID cannot be running for an archived identity because retire always kills the harness before moving the folder, so `archived: False` is the correct semantic for synthetic records.
- The per-identity emit loop's sentinel dict passed to `_build_identity_line` swaps `"hidden": rec["hidden"]` for `"archived": rec["archived"]`.

**Bash test harness (`substrate/scripts/tests/fleet-status-sweep.test.sh` — NEW file):**

- 362-line hermetic driver following the `fleet-status-sweep-appearance.sh` pattern (HOME-scoped scratch dir, `python3` subprocess invocation, JSON-parsed structural assertions).
- 6 test cases (see Test-case matrix below).
- `STDERR_FILE` structural fix: previously a `LAST_STDERR` variable would have been lost across the subshell boundary in `out=\$(run_sweep)`; now the driver sets a per-test `STDERR_FILE=\$(mktemp)` in `run_test()` before invocation so both the subshell (writer) and the caller (grepper) can see it.

**Downstream fix (`substrate/scripts/tests/fleet-status-sweep-appearance.sh`):**

- `test_case_06_sentinels` previously asserted `hidden: true` on `.hidden`-present rows and `hidden: false` on other rows. 115-02 retired the TS schema field but left this bash test unfixed. Once Python emission drops `hidden`, this test would break. Narrowed to the surviving `.pinned` axis with a retirement-note comment marking the D-21 lineage.

### Task 2 — SweepIdentityLine.archived + B9 parity slot (RED `d6fd47e2`, GREEN `07761b1b`)

**Schema (`src/backend/fleet-status/sweep-schema.ts`):**

- `SweepIdentityLine`: added `archived?: boolean` sibling to `pinned?`. Optional (`?:`) for mid-distribution older-box tolerance. Inline comment references the Plan 111-01 appearance-fields pattern this follows.
- Docblock at the interface: added a new bullet for `archived ↔ B9`, plus a paragraph documenting the intended 115-06 separation (archived rows publish as a distinct `{ kind: "identity-archived", ... }` WS message to the frontend, NOT as `archived: true` on the standard identity frame).
- `SWEEP_FIELD_PARITY` Record discriminator union extended with `"B9"`.
- New parity entry: `B9: { field: "archived" }` with inline comment: NOT a sentinel-file probe like other B* rows — the field is populated from which root the sweep walked.

**Schema tests (`src/backend/fleet-status/sweep-schema.test.ts`):**

- 4 new test cases in a new `describe` block for the `archived` field:
  1. `archived: true` parses correctly on an archive-tree row.
  2. `archived: false` parses correctly on a live-tree row.
  3. An identity line WITHOUT the `archived` field parses cleanly (older-box case), yielding `undefined`.
  4. `SWEEP_FIELD_PARITY.B9.field === "archived"` (locks the specific slot ID).
- `EXPECTED_KEYS` grew from 22 → 23 with the re-added `"B9"`. Comment updated to record the lineage (Plan 111-02 originally added B9 for `.hidden`; 115-02 removed it; 115-05 reuses the freed slot for `archived`).
- `identityFields` set gained `"archived"` so the parity walk test recognises `archived` as a valid field target.

## Task Commits

Each task was executed as a TDD RED/GREEN pair:

1. **Task 1 RED — bash test harness (6 failing cases)** — `6c254862` (`test`)
2. **Task 1 GREEN — unified archive-tree walk in sweep script** — `70247e9c` (`feat`)
3. **Task 2 RED — schema tests for archived field (3 failing assertions + parity walk regression)** — `d6fd47e2` (`test`)
4. **Task 2 GREEN — SweepIdentityLine.archived + B9 parity slot** — `07761b1b` (`feat`)

## Test-Case Pass/Fail Matrix

### `substrate/scripts/tests/fleet-status-sweep.test.sh` (6/6 pass)

| # | Test | Scenario | Assertion | Result |
|---|------|----------|-----------|--------|
| 1 | test_case_01_live_tree_only | `~/fleet/identities/alpha/` present, no archive tree | line count == 1; alpha.archived == false | PASS |
| 2 | test_case_02_archive_tree_only | `~/fleet/identities-archive/beta/` present, no live tree | line count == 1; beta.archived == true | PASS |
| 3 | test_case_03_both_roots | alpha in live, beta in archive | line count == 2; alpha.archived == false; beta.archived == true | PASS |
| 4 | test_case_04_missing_archive_tree | Only `~/fleet/identities/alpha/` (no `identities-archive` dir at all) | line count == 1; alpha.archived == false; NO CRASH | PASS |
| 5 | test_case_05_unsafe_archive_name | `~/fleet/identities-archive/..evil/` unsafe folder + alpha in live | line count == 1 (only alpha); `..evil` absent from output; stderr contains `identity_name_skipped` log tag | PASS |
| 6 | test_case_06_bare_archive_dir | `~/fleet/identities-archive/gamma/` folder with no *.md | line count == 1; gamma.archived == true; identity_cosmetics == null; role == null; role_cosmetics == null | PASS |

### `substrate/scripts/tests/fleet-status-sweep-appearance.sh` (11/11 pass — regression scope)

All 11 pre-existing appearance tests pass unchanged after the sweep-script edits + the `test_case_06_sentinels` fix to drop stale `hidden` assertions. Full-inheritance, read-once-per-role, no-frontmatter, missing-identity-file, path-traversal-role, sentinels (now pinned-only), colorHue-out-of-range, quoted-and-commented, bounded-read, stdout-purity, global-stderr-stdout-separation.

### `src/backend/fleet-status/sweep-schema.test.ts` vitest (30/30 pass — 4 new + 26 pre-existing)

New tests:
- Phase 115 Plan 115-05: SweepIdentityLine.archived > parses archived: true (PASS)
- Phase 115 Plan 115-05: SweepIdentityLine.archived > parses archived: false (PASS)
- Phase 115 Plan 115-05: SweepIdentityLine.archived > parses without archived field (older-box) (PASS)
- Phase 115 Plan 115-05: SweepIdentityLine.archived > SWEEP_FIELD_PARITY has a B9 entry pointing at archived (PASS)

Modified tests (parity walk extension):
- SWEEP_FIELD_PARITY parity map walk > covers every RESEARCH.md source-A / source-B row (EXPECTED_KEYS grew 22→23) (PASS)
- SWEEP_FIELD_PARITY parity map walk > every entry is either mapped or has a non-empty skipped_reason (now walks B9→archived) (PASS)

### Regression scope

- `ssh-poll-orchestrator.test.ts`: **162/162 pass** — this consumer of `SweepIdentityLine` compiles and runs unchanged with the new optional field (undefined ≡ live-tree row, matching the intended source-B adapter behavior 115-06 will consume).

## Decisions Made

1. **B9 slot REUSED.** 115-02 explicitly vacated B9 to reserve it for the archived axis. Reusing the slot keeps the parity map ordinal-stable, matches the plan's `<action>` (b) recommendation, and 115-02's `Next Plan Readiness` section explicitly named 115-05 as the intended consumer.

2. **`.archive-requested` probe NOT added.** Plan `<action>` (b) explicitly said `omit for now`. Adding an `archive_requested?: boolean` field would be scope creep — the `archived: true` flag alone (disk-root = archive tree) is sufficient for D-18. A future phase can add a "retire in flight" surface if a UI need emerges.

3. **`archived` is optional (`?:`).** Follows the Plan 111-01 appearance-fields tolerance pattern for mid-distribution older boxes. isSweepLineOfCurrentSchema checks only schema_version + line_kind; the bare cast at the parse loop admits lines with `archived` absent, yielding undefined. Ssh-poll-orchestrator (in 115-06's scope) will treat undefined ≡ false (fail-open toward the standard identity pool).

4. **`.hidden` retirement gap on the Python emitter fixed.** 115-02 removed `.hidden` from the TS schema but the Python emitter still emitted `hidden: <bool>` on identity lines. This plan deletes that emission alongside adding archived. Categorized as Rule 3 (blocking issue): could not cleanly complete Task 1 without touching this — a Python emitter carrying a key the TS schema doesn't know about is a Python↔TS parity break.

5. **Cross-root name collision: both records emit.** Per RESEARCH §5's explicit acceptance. Should not happen in practice (retire-flow's collision-abort logic prevents it), but if it did, the frontend sees two rows and the source-B adapter routes each to the appropriate pool. No dedup.

6. **Distinct wire message for frontend is 115-06's scope.** This plan wires up `SweepIdentityLine.archived` on the sweep-JSONL layer (Python → TS parser) only. The docblock explicitly documents that 115-06 will transform archived-tree identity rows into a distinct `{ kind: "identity-archived", ... }` WS message rather than bolting `archived` onto the standard identity frame consumed by the frontend. This matches the prompt's LOCKED wire-shape decision.

7. **Bash test STDERR structural fix.** `LAST_STDERR` set inside a subshell (from `out=\$(run_sweep)`) would not survive back to the caller. Restructured to set `STDERR_FILE=\$(mktemp)` in `run_test()` before invocation so both writer and reader see it. Simple; per-test scoped; cleaned up by test framework rather than trap.

## Deviations from Plan

- **[Rule 3 — Blocking issue] `.hidden` emission still present in fleet-status-sweep.py.** 115-02 landed the TS-side retirement of the `.hidden` field but did not sync the Python emitter (see 115-02 SUMMARY: focused on backend TS files + frontend, did not mention `substrate/scripts/`). The sweep script continued to emit `"hidden": <bool>` on every identity line. This blocks Task 1's clean addition of `archived` because the emit dict must have a consistent shape (Python↔TS parity). Fixed inline as part of Task 1's `_enumerate_identities` rewrite + `_build_identity_line` edit + `main()` synthetic-record and emit-loop call sites.

- **[Rule 3 — Blocking issue] `test_case_06_sentinels` in `fleet-status-sweep-appearance.sh` still asserted `hidden: true/false` on emitted lines.** Same 115-02 sync gap. Once Python emission drops `hidden`, this test would break at the `assert_identity_field "$out" "pinnedonly" "hidden" 'false'` line (the field would be absent → `null`, not `'false'`). Narrowed the test to the surviving `.pinned` axis with a retirement-note comment.

- **[Rule 2 — Correctness] Per-root OSError log now records the failing root path.** Original single-tree version logged `identities_scandir_failed` with only errno. In the multi-tree version, knowing WHICH root failed matters for debugging (a live-tree scandir failure has very different implications than an archive-tree scandir failure). Added `root=root` to the log fields.

None of the deviations required Rule 4 (architectural) escalation.

## Issues Encountered

- **Initial bash test RED-run showed 14 failures instead of the expected 6-per-case-related.** Digging in: the parity walk test (`every entry is either mapped to a line-type field or has a non-empty skipped_reason`) in the TS test crashed with `Cannot read properties of undefined (reading 'field')` at `EXPECTED_KEYS.forEach` because the RED-phase added B9 to `EXPECTED_KEYS` before the source added the B9 entry — a legitimate RED-phase red (the test would catch a missing B9 entry in the source). Confirmed by running through carefully — this is what RED looks like, not a bug in test design. Fixed in GREEN by adding the B9 entry to SWEEP_FIELD_PARITY.

- **`hidden` grep on sweep-schema.ts returned 2 comment matches after Task 2 GREEN.** Both were retirement-note comments referencing the 115-02 retirement of `.hidden`. Plan `<done>` for Task 2 said `grep -F "hidden" ... returns 0 matches` — a literal-string grep. Choice: preserve the retirement notes (115-02's pattern, and load-bearing for a future reader) OR rewrite the comments to avoid the literal string. Rewrote the comments to reference `Phase 115 Plan 115-02's D-21 retirement` (no literal `hidden` string) rather than losing the retirement-note lineage entirely. Both comments still communicate the "this slot was previously used by 115-02 for a retired axis" context that 115-02's pattern established.

## RESEARCH.md line-number drift report (plan `<output>` requirement)

Per the plan's `<output>` section, all RESEARCH.md-cited line numbers were checked against the actual file content at edit time:

| Cited location (plan Task 1) | Cited lines | Actual lines | Drift |
|---|---|---|---|
| `fleet-status-sweep.py` `_enumerate_identities` | L977-1018 | L977-1018 (matched exactly at read time) | 0 |
| `fleet-status-sweep.py` `_build_identity_line` | L818-878 | L818-878 (matched exactly) | 0 |
| `fleet-status-sweep.py` `main()` | L1046-1124 | L1046-1124 (matched exactly) | 0 |
| `fleet-status-sweep.py` SAFE_NAME_RE | (unspec) | L114 (compile line); L995 used in _enumerate_identities | n/a — grep locates trivially |
| `sweep-schema.ts` SweepIdentityLine post-115-02 | L109-131 | L112-133 | +3 lines (115-02's comment sits at L110-111 and pushed the interface down by ~3 lines; still trivially anchored via grep for `export interface SweepIdentityLine`) |
| `sweep-schema.ts` SWEEP_FIELD_PARITY map | L353 area | L353 (parity export starts at L331; map body has A0=L355 etc; unchanged) | 0 |
| `sweep-schema.ts` "B8"|"B9" union | L410-411 | L353 area (post-115-02 the union ends at "B8" around L352) | -60 (115-02's deletion of the B9 union member pulled everything up; still trivially anchored via grep for the union type body) |

Overall drift is minor and every citation locates unambiguously via grep for the actual identifier. Anchoring via `grep -n` at edit time is the load-bearing lookup mechanism (this executor followed that discipline).

## Metrics detail (plan `<output>` requirement)

- **Python function signature/line for `_enumerate_identities` post-edit:** `def _enumerate_identities(home):` at L977, returning list of dicts `{name, dormant, recycled_at, recycle_requested, pinned, archived}`. Body is 42 lines (L977-1023 approximately, post-edit — the unified loop is slightly longer than the original single-tree walk because of the per-root fallthrough structure).
- **B9 slot ID:** REUSED (verbatim reuse of the freed 115-02 slot). Not a new letter/number scheme.
- **`.archive-requested` probe status:** NOT probed. Recommendation (b) followed: omit for now. If a future phase wants a "retire in flight" surface, add then.
- **Line delta:** +75 / -51 across the fleet-status-sweep.py + fleet-status-sweep-appearance.sh diff; +30 / -3 on sweep-schema.ts; +83 / -4 on sweep-schema.test.ts; +362 / -0 on the new fleet-status-sweep.test.sh.

## Grep sweep results

```
$ grep -c "identities-archive" substrate/scripts/fleet-status-sweep.py
3
$ grep -c '"archived"' substrate/scripts/fleet-status-sweep.py
4
$ grep -c '"hidden"' substrate/scripts/fleet-status-sweep.py
0
$ grep -c "archived" src/backend/fleet-status/sweep-schema.ts
12
$ grep -F "hidden" src/backend/fleet-status/sweep-schema.ts | wc -l
0
$ python3 -c "import ast; ast.parse(open('substrate/scripts/fleet-status-sweep.py').read())" && echo OK
OK
```

All Task 1 + Task 2 `<done>` criteria satisfied.

## Threat Flags

Nothing new surfaced beyond the plan's `<threat_model>`. All five registered threats are unchanged:

- **T-115-05-01** (Tampering — unsafe folder name in archive tree): mitigated by `SAFE_NAME_RE.match(name)` gate applied per-root. Test case 5 covers this — a `..evil` folder in the archive tree is rejected with the `identity_name_skipped` log tag and no line emitted.
- **T-115-05-02** (DoS — large archive tree): accepted per plan. `os.scandir` is O(N).
- **T-115-05-03** (Information disclosure): accepted. Archive-tree identity names are as public across the fleet as live-tree names.
- **T-115-05-04** (Tampering — malicious `archived` field value): mitigated by the schema. The type is `boolean`; a non-boolean would still pass isSweepLineOfCurrentSchema's shallow gate (which only checks schema_version + line_kind), but any consumer reading `.archived` from a `SweepIdentityLine` would see a `boolean | undefined` in the TS type system. A future 115-06 implementation should be defensive with `line.archived === true` rather than truthy-checking — flagged for 115-06's threat model.
- **T-115-05-SC** (supply chain): no new dependencies.

**Note for 115-06:** The `.archived === true` strict-check recommendation above is a load-bearing note. Truthy-checking would treat `archived: "false"` (a stringly-typed malicious payload) as truthy. Add a schema-level runtime guard OR the strict-boolean check in the consumer.

## Self-Check: PASSED

**File existence:**
- `substrate/scripts/fleet-status-sweep.py` — FOUND (git show HEAD:substrate/scripts/fleet-status-sweep.py verified)
- `substrate/scripts/tests/fleet-status-sweep.test.sh` — FOUND (new file, tracked)
- `substrate/scripts/tests/fleet-status-sweep-appearance.sh` — FOUND
- `src/backend/fleet-status/sweep-schema.ts` — FOUND
- `src/backend/fleet-status/sweep-schema.test.ts` — FOUND

**Commit existence:**
- `6c254862` — `git log --oneline | grep 6c254862` → PRESENT (`test(115-05): add failing bash test harness for unified archive-tree walk`)
- `70247e9c` — → PRESENT (`feat(115-05): unified walk over identities/ + identities-archive/ in sweep`)
- `d6fd47e2` — → PRESENT (`test(115-05): add failing tests for SweepIdentityLine.archived field`)
- `07761b1b` — → PRESENT (`feat(115-05): add SweepIdentityLine.archived field + B9 parity slot`)

**Done-criteria greps (from plan Task 1 + Task 2 `<done>` blocks):**
- Task 1: `grep -c "identities-archive" substrate/scripts/fleet-status-sweep.py` → 3 ≥ 1. PASS.
- Task 1: `grep -c '"archived"' substrate/scripts/fleet-status-sweep.py` → 4 ≥ 1. PASS.
- Task 1: `grep -c '"hidden"' substrate/scripts/fleet-status-sweep.py` → 0. PASS.
- Task 1: `python3 -c "import ast; ast.parse(open('substrate/scripts/fleet-status-sweep.py').read())"` → clean exit. PASS.
- Task 2: `grep -c "archived" src/backend/fleet-status/sweep-schema.ts` → 12 ≥ 2. PASS.
- Task 2: `grep -F "hidden" src/backend/fleet-status/sweep-schema.ts` → 0 matches. PASS.

**Verify commands (from plan Task 1 + Task 2 `<verify>` blocks):**
- Task 1: `bash substrate/scripts/tests/fleet-status-sweep.test.sh` → 6/6 pass. PASS.
- Task 2: `npx vitest run src/backend/fleet-status/sweep-schema.test.ts` → 30/30 pass. PASS.
- `npx tsc -p tsconfig.node.json --noEmit` → filtered clean on plan-touched files. PASS.

**TDD gate compliance:**
- Task 1 gate sequence: test(6c254862) → feat(70247e9c). PASS.
- Task 2 gate sequence: test(d6fd47e2) → feat(07761b1b). PASS.
- Fail-fast rule: RED-run for both tasks confirmed failure BEFORE code changes.

## Next Plan Readiness

- **115-06 (frontend archive flow, Wave 3):** Ready.
  - Sweep-JSONL wire now carries `SweepIdentityLine.archived?: boolean`. 115-06's ssh-poll-orchestrator consumer can key on `line.archived === true` to route archived-tree identity rows to the archived-rows pool.
  - The `{ kind: "identity-archived", name, hostId, hostname }` distinct WS message shape is 115-06's implementation scope. This plan intentionally did not implement it — the docblock on SweepIdentityLine documents the intended separation.
  - Threat model recommendation for 115-06: use strict `line.archived === true` (not truthy-check) to defend against stringly-typed malicious payloads.
- **Deploy-motion coordination:** this plan lands the sweep-JSONL layer; 115-06 lands the WS-frame + frontend consumer. Between the two, archived-tree identity rows are enumerated by the sweep and emitted on the JSONL wire but have no downstream consumer — inert. The mid-state is safe: a fleet-status-sweep box that runs the new sweep script emits `archived: true` lines that the current (pre-115-06) parser accepts (per schema_version + line_kind gate) but has no code path to consume — the `line.archived` field is read by no one until 115-06 lands.
- **HEAD `07761b1b` LOCAL** — NOT pushed / NOT built / NOT deployed. Held at push boundary per fleet's greenlight-at-push rule. Orchestrator picks up ship motion on user greenlight.

---
*Phase: 115-identity-archiving-from-the-frontend*
*Completed: 2026-09-17*
