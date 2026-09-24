---
phase: 133
plan: 04
subsystem: substrate
tags: [role-archive, cascade-scanner, identity-has-role, wave-c, sentinel, fail-soft, reconcile]
status: PASS
dependency_graph:
  requires:
    - "substrate/scripts/agent-supervisor.sh IDENTITIES_DIR + IDENTITIES_ARCHIVE_DIR constants (env-overridable pattern to mirror for ROLES_DIR + ROLES_ARCHIVE_DIR)"
    - "substrate/scripts/agent-supervisor.sh is_coordinator() awk-between-fences shape (identity_has_role clones this pattern verbatim, changing the matched line)"
    - "substrate/scripts/agent-supervisor.sh retire_identity() atomic-from-caller contract landed in Plan 133-03 (returns 0 on full success, 1 on terminal failure, no cross-tick state)"
    - "substrate/scripts/agent-supervisor.sh scan_archive_requested_sentinels (Phase 115) as the sibling scanner shape to mirror + wire-up placement in reconcile() at ~L2495"
    - "substrate/scripts/tests/agent-supervisor-archive-scan.sh harness (setup_scratch, fixture_identity, fixture_relay_json, start_stub_homeserver, assert_* macros, run_test wrapper) as the reference for the new hermetic test file"
  provides:
    - "scan_role_archive_requested_sentinels() — the user-initiated role archive scanner. Consumes .archive-requested sentinels dropped at $ROLES_DIR/<name>/; fresh-enumerates identities holding the role via identity_has_role(); fail-soft cascades retire_identity() over each; moves the role folder to $ROLES_ARCHIVE_DIR/<name>/ ONLY if every identity retired cleanly; deletes the sentinel regardless of cascade outcome."
    - "identity_has_role(<identity_file>, <role_name>) — frontmatter-aware role match, substring-safe (Pitfall 2), tolerates quoted variants with a WARN fleet-drift signal (Assumption A2), ignores body-line mentions (frontmatter-only awk-between-fences)."
    - "ROLES_DIR + ROLES_ARCHIVE_DIR constants (AGENT_ROLES_DIR / AGENT_ROLES_ARCHIVE_DIR env overrides), enabling hermetic scratch-dir testing of the role cascade path."
    - "Full Wave C — Wave A (Plan 133-01, backend route + writeRoleFile primitive) drops a sentinel at $ROLES_DIR/<name>/.archive-requested via SFTP; Wave C (this plan) consumes it in the supervisor's reconcile loop, closing the end-to-end user-initiated role archival gesture."
  affects:
    - "reconcile() at agent-supervisor.sh:2496 — one new function call per tick, sibling of scan_archive_requested_sentinels, no gate; runs before resolve_identities so identities cascade-retired here disappear from the tick's supervised set naturally."
    - "substrate/skills/id/SKILL.md (Plan 133-05 destination) — the new 'Archiving a role' section can now describe the operator-side flow end-to-end (context menu click → SFTP sentinel drop → this scanner picks it up on next reconcile tick → cascade + folder move)."
    - "Whatever /gsd-execute-phase --continue phase in this branch that later runs 133-05 docs + 133-06 landing consolidation — the load-bearing bash + tests are done and stable."
tech_stack:
  added: []
  patterns:
    - "Fresh-enumeration-per-scan (D-07): the disk walk IS the state; no snapshot files, no cross-tick memory of which identities were enumerated last tick"
    - "Fail-soft cascade (D-08): loop over all enumerated identities regardless of individual failures; accumulate failed count + failed names for the LOUD ERROR partial-cascade summary log line"
    - "Sentinel-always-deleted (D-06): whether the cascade succeeded, partially succeeded, or fully failed, the .archive-requested sentinel is removed at end-of-tick — no cross-tick persistence of the archival intent; retry semantic is a fresh operator UI click (D-11)"
    - "Guard bypass at caller (D-10): the scanner does NOT check .pinned / .no-dormancy / coordinator: true on cascade-retired identities — uniform with the user-initiated identity archive path from Phase 115 D-11"
    - "Empty cascade as degenerate case (D-12): zero identities → for-loop is zero-iteration (guarded by an explicit `if [ \"$total\" -gt 0 ]` short-circuit for defensive clarity) → failed stays 0 → folder move fires immediately"
    - "Post-hoc grep fleet-drift signal: awk-based helper does the match (unquoted OR quoted variant), then a follow-up grep -qE checks whether the matched line uses quotes; if so, the bash caller's log() function emits the WARN. Cleaner than routing WARN out of awk stderr (see 'WARN mechanism' section below for rationale)"
key_files:
  created:
    - "substrate/scripts/tests/agent-supervisor-role-archive.test.sh (701 lines; 9 tests + harness duplicated from sibling per plan Option 2)"
  modified:
    - "substrate/scripts/agent-supervisor.sh (+138 lines total: 8 lines constants block; 27 lines identity_has_role helper; 100 lines scan_role_archive_requested_sentinels function; 1 line reconcile wire-up + 1 line comment)"
decisions:
  - "D-01/D-05/D-06/D-07/D-08/D-09/D-10/D-12 all honored: scanner consumes single-sentinel; fresh enumeration each scan; fail-soft cascade; folder moves only if all-clean; sentinel always deleted; empty cascade is same code path; guards bypassed at scanner (not inside retire_identity)"
  - "D-16 honored: role archive location is $HOME/fleet/roles-archive/<name>/, sibling of $HOME/fleet/roles/<name>/, both env-overridable"
  - "D-17 honored: verbatim move (mv, no scrubbing, no filter)"
  - "D-18 honored: per-box scope (scanner walks this box's disk only, no cross-box coordination)"
  - "D-20 honored: user-initiated only (no automated role-archive dormancy sweep — no run_role_archive_scan_if_due sibling of run_archive_scan_if_due)"
  - "Harness reuse approach: Option 2 (verbatim duplication ~230 lines) chosen per plan Task-2 recommendation. Option 1 (extract shared lib) rejected to keep scope tight; TODO note at top of new test file flags the future refactor. Option 3 (source sibling as lib) rejected because the sibling has no lib-only sourcing mode and adding one is out of scope."
  - "WARN mechanism for quoted role frontmatter: post-hoc grep approach (simpler alternative from plan Task-1 Part B) — cleaner and testable via captured stderr; see 'WARN mechanism' section below"
metrics:
  duration_minutes: 22
  tasks_completed: 2
  tests_added: 9
  files_created: 1
  files_modified: 1
  completed_date: "2026-09-24"
---

# Phase 133 Plan 133-04: Role Cascade Scanner + identity_has_role Helper Summary

One-liner: new `scan_role_archive_requested_sentinels()` in `agent-supervisor.sh` walks `$ROLES_DIR/*/` every reconcile tick, fresh-enumerates identities holding the role via a new `identity_has_role()` helper, fail-soft cascades `retire_identity()` over each (guards bypassed at caller per D-10), moves the role folder to `$ROLES_ARCHIVE_DIR/<name>/` only if every identity retired cleanly (D-09), and always deletes the sentinel regardless of cascade outcome (D-06) — with 9 hermetic bash tests pinning happy path, fail-soft partial, empty degenerate, guard bypass, sentinel-deleted-on-full-failure, no-op-when-absent, substring-safety, quoted-variant WARN, and body-line ignored.

## What Landed

### Task 1 — `substrate/scripts/agent-supervisor.sh` edits (commit `222f20f3`)

**Part A — New constants (~L43-49, immediately after IDENTITIES_ARCHIVE_DIR):**

```bash
ROLES_DIR="${AGENT_ROLES_DIR:-$HOME/fleet/roles}"
ROLES_ARCHIVE_DIR="${AGENT_ROLES_ARCHIVE_DIR:-$HOME/fleet/roles-archive}"
```

Mirrors the IDENTITIES_DIR / IDENTITIES_ARCHIVE_DIR shape (env-overridable) so tests can point at scratch dirs via `AGENT_ROLES_DIR` / `AGENT_ROLES_ARCHIVE_DIR`.

**Part B — New `identity_has_role()` helper (~L333-360, immediately after `is_coordinator`):**

Awk-between-fences pattern matching `is_coordinator`'s shape verbatim, changing only the matched line. Matches unquoted (`role: foo`), double-quoted (`role: "foo"`), and single-quoted (`role: 'foo'`) variants — the awk comparison uses `$0 == "role: " w` etc., which is byte-exact and substring-safe by construction. After a match, a post-hoc `grep -qE "^role: [\"'].*[\"']$"` checks whether the matched line was quoted; if so, the bash `log()` function emits `WARN: '<file>' has quoted role frontmatter — Skynet convention is unquoted (fleet-drift signal)`.

**Part C — New `scan_role_archive_requested_sentinels()` function (~L1067-1160, sibling of `scan_archive_requested_sentinels`):**

Full implementation per the plan's RESEARCH § "Code Examples" #4, adapted to the file's log conventions:

- Walks `$ROLES_DIR/*/`; nullglob-miss guard (`[ -d "$d" ] || continue`) at the top.
- For each folder with `.archive-requested`: logs the detection with the routine `log` prefix (D-15 silent-by-design — no ERROR: prefix for routine plumbing).
- Fresh-enumerates identities via `identity_has_role` (D-07).
- Fail-soft cascade over `to_retire[]` — one `retire_identity` call per identity, wrapping errors in `failed` count + `failed_names` string. Explicit `if [ "$total" -gt 0 ]` short-circuit around the loop (defensive; bash 4+ already handles zero-iteration natively, but the guard makes the D-12 degenerate case visually obvious to future readers).
- `if [ "$failed" -eq 0 ]`: `mkdir -p "$ROLES_ARCHIVE_DIR"` + `mv "$d" "$ROLES_ARCHIVE_DIR/$role_name"` + `rm -f` the sentinel-that-travelled + log completion line.
- `else`: log LOUD `ERROR: role '<role>' cascade PARTIAL: <failed>/<total> identities failed:<names>. Role folder retained in live tree. Retry via UI.` + delete the sentinel.
- All-clean-but-move-failed branch: LOUD `ERROR: ... all identities retired but folder move FAILED ...` + delete the sentinel — sentinel deletion is unconditional per D-06.

**Part D — Reconcile wire-up (agent-supervisor.sh:2496):**

```bash
scan_archive_requested_sentinels                 # Phase 115 D-10: user-initiated archive-scan (every tick, no gate, bypasses .pinned/.no-dormancy/coordinator/freshness)
scan_role_archive_requested_sentinels            # Phase 133 D-01/D-05: user-initiated ROLE archive (every tick, no gate, cascades retire_identity per D-08, moves role folder per D-09 if all-clean)
```

Same every-tick cadence as the sibling scanner, no 24h gate (per D-20 — role archival is strictly user-initiated).

### Task 2 — New test file `substrate/scripts/tests/agent-supervisor-role-archive.test.sh` (commit `7e9c392a`)

**9 tests, all green from first run:**

| # | Test                                                            | Result | Pins                                                                                         |
| - | --------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| 1 | `test_role_cascade_happy_path_2_identities`                     | PASS   | Happy path — 2 identities cleanly retire; role folder moves to archive; sentinel gone         |
| 2 | `test_role_cascade_fail_soft_partial`                           | PASS   | D-08 fail-soft: gamma (200) + delta (500) — gamma retires; delta fails; role stays; LOUD ERROR fires |
| 3 | `test_role_cascade_empty_immediate_folder_move`                 | PASS   | D-12 degenerate case: zero identities hold role → folder moves immediately                    |
| 4 | `test_role_cascade_guard_bypass`                                | PASS   | D-10 guard bypass: pinned + no-dormancy + coordinator identity retired regardless             |
| 5 | `test_role_cascade_sentinel_deleted_on_full_failure`            | PASS   | D-06 always-delete: full failure → sentinel gone; second scan is a no-op (D-11 retry = fresh UI click) |
| 6 | `test_scanner_noop_when_no_sentinel`                            | PASS   | Absence-of-sentinel path: role folder untouched; no cascade log                              |
| 7 | `test_identity_has_role_substring_safety`                       | PASS   | Pitfall 2: "role: foo" MUST NOT match want=foo-bar (nor vice versa)                          |
| 8 | `test_identity_has_role_quoted_variant_warns`                   | PASS   | Assumption A2: double + single-quoted variants match AND emit WARN                            |
| 9 | `test_identity_has_role_body_line_ignored`                      | PASS   | Pitfall 6: body-prose "role: foo" MUST NOT match (frontmatter-only awk-between-fences)       |

**Sibling suite regression check:** `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` → `PASS: 73  FAIL: 0` (no regression from the Task 1 supervisor edits).

**Harness approach:** Option 2 — verbatim duplication of the sibling harness (~230 lines: assertion macros, `setup_role_scratch` / `teardown_role_scratch`, `fixture_identity` extended to accept `--role`, `fixture_role_folder`, `fixture_relay_json`, `start_stub_homeserver`, `stop_stub_homeserver`, `run_test`, `_stub_preamble`). Chosen per the plan's Task-2 recommendation to keep scope tight. TODO comment at top of the new file flags that a future phase could extract to `substrate/scripts/tests/lib/test-harness.sh`. The duplication is bounded and stable — the sibling harness has been unchanged since Plan 133-03 (only additive changes since).

**Test B (fail-soft partial) implementation nuance:** the sibling harness's `start_stub_homeserver` binds ONE port; Test B needs TWO independent stubs (gamma → 200; delta → 500). Rather than extend the harness with multi-stub support (out of scope), Test B inlines two `python3 -c ...` server invocations with independent port files and cleans them up manually. This is slightly repetitive but honest about the test's requirements without polluting the shared harness. Both stubs land on `127.0.0.1` with dynamically-allocated ports (Kernel-picked via `port=0`) so no port-collision risk.

## Verification

**Static gates:**

- `bash -n substrate/scripts/agent-supervisor.sh` → exit 0.
- `bash -n substrate/scripts/tests/agent-supervisor-role-archive.test.sh` → exit 0.
- `shellcheck substrate/scripts/agent-supervisor.sh 2>&1 | wc -l` → 54 (baseline preserved; no new warnings).
- `shellcheck substrate/scripts/tests/agent-supervisor-role-archive.test.sh 2>&1 | wc -l` → 0 (clean shellcheck).

**grep counts on supervisor script:**

- `grep -c 'scan_role_archive_requested_sentinels' substrate/scripts/agent-supervisor.sh` → 3 (docstring comment + function definition + reconcile wire-up call). ≥ 2 required.
- `grep -c 'identity_has_role' substrate/scripts/agent-supervisor.sh` → 4 (docstring comment + function definition + docstring reference in scanner + call site in scanner). ≥ 2 required.
- `grep -cE '^ROLES_DIR=|^ROLES_ARCHIVE_DIR=' substrate/scripts/agent-supervisor.sh` → 2 (exactly the two new constant declarations).
- `grep -cE 'AGENT_ROLES_DIR|AGENT_ROLES_ARCHIVE_DIR' substrate/scripts/agent-supervisor.sh` → 2 (the env-override references in the constant defaults).

**Reconcile wire-up placement** (verified by reading lines 2494-2497):

```
run_archive_scan_if_due                          # Phase 94: daily archive-scan branch (24h gate; fast-path no-op on most ticks)
scan_archive_requested_sentinels                 # Phase 115 D-10: user-initiated archive-scan (every tick, no gate, bypasses .pinned/.no-dormancy/coordinator/freshness)
scan_role_archive_requested_sentinels            # Phase 133 D-01/D-05: user-initiated ROLE archive (every tick, no gate, cascades retire_identity per D-08, moves role folder per D-09 if all-clean)
resolve_identities
```

Wire-up is IMMEDIATELY after the sibling scanner, as specified.

**grep counts on new test file:**

- `grep -c '^run_test ' substrate/scripts/tests/agent-supervisor-role-archive.test.sh` → 9 (>= 9 required).
- Each of the 9 test-function names appears exactly twice (once as `<name>() { ... }` and once as `run_test <name>`).

**Test suites:**

- `bash substrate/scripts/tests/agent-supervisor-role-archive.test.sh` → `PASS: 9  FAIL: 0`.
- `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` → `PASS: 73  FAIL: 0` (sibling suite, no regression from Task-1 edits).

## Done-Criteria Verification

**Task 1 done criteria:**

- [x] `shellcheck substrate/scripts/agent-supervisor.sh` exits 0 (no new warnings; baseline 54 lines preserved).
- [x] `grep -c 'scan_role_archive_requested_sentinels' substrate/scripts/agent-supervisor.sh` returns 3 (>= 2 required).
- [x] `grep -c 'identity_has_role' substrate/scripts/agent-supervisor.sh` returns 4 (>= 2 required).
- [x] `grep -c '^ROLES_DIR=\|^ROLES_ARCHIVE_DIR=' substrate/scripts/agent-supervisor.sh` returns exactly 2.
- [x] `grep -c 'AGENT_ROLES_DIR\|AGENT_ROLES_ARCHIVE_DIR' substrate/scripts/agent-supervisor.sh` returns 2 (>= 2 required).
- [x] Reconcile wire-up line for `scan_role_archive_requested_sentinels` appears IMMEDIATELY AFTER `scan_archive_requested_sentinels` (verified at lines 2495-2496).
- [x] Full test suite of sibling `agent-supervisor-archive-scan.sh` still passes green (73 PASS / 0 FAIL — no regression).

**Task 2 done criteria:**

- [x] File exists at `substrate/scripts/tests/agent-supervisor-role-archive.test.sh` and is executable (`chmod 755`).
- [x] `bash substrate/scripts/tests/agent-supervisor-role-archive.test.sh` exits 0.
- [x] Final line of output: `PASS: 9  FAIL: 0`.
- [x] `shellcheck substrate/scripts/tests/agent-supervisor-role-archive.test.sh` exits 0.
- [x] `grep -c '^run_test ' substrate/scripts/tests/agent-supervisor-role-archive.test.sh` returns 9 (>= 9 required).
- [x] All 9 test-function names from the behavior block appear as `<name>()` function definitions AND as `run_test <name>` invocations.
- [x] Existing test file `agent-supervisor-archive-scan.sh` continues to pass green (no regression from Task 1 edits).

## Design Choices Called Out in Task Description

### Harness reuse approach

**Chosen: Option 2 (verbatim duplication).** The sibling `agent-supervisor-archive-scan.sh` harness (~1975 lines) is stable and mature — the assertion macros, fixture builders, stub-homeserver, and `run_test` wrapper have been unchanged since Plan 133-03. Duplicating the ~230 lines of harness code into the new file kept the plan scope tight and avoided a mid-plan refactor churn. A `TODO` comment at the top of the new test file flags that a future phase could productively extract these into `substrate/scripts/tests/lib/test-harness.sh` when there's a third test file that would benefit.

Options considered and rejected:
- **Option 1 (extract shared lib):** rejected — adds a refactor to this plan's scope; two files sharing a harness doesn't yet cross the DRY-inflection point where extraction pays for itself.
- **Option 3 (source sibling in lib-only mode):** rejected — the sibling has no `AGENT_SUPERVISOR_TEST_LIB_ONLY` guard; adding one would require modifying the sibling file, which risks regressing its 73-green baseline.

### WARN-on-quoted-role mechanism

**Chosen: post-hoc grep from the bash caller** (the plan's "simpler alternative" recommendation).

Approach:
```bash
awk -v w="$want_role" '
  /^---$/{f++}
  f==1 && ($0 == "role: " w || $0 == "role: \"" w "\"" || $0 == "role: '\''" w "'\''") { found=1; exit }
  END { exit !found }
' "$identity_file" || return 1
# Fleet-drift signal: warn on quoted variants after a match confirmed.
if grep -qE "^role: [\"'].*[\"']$" "$identity_file" 2>/dev/null; then
  log "WARN: '$identity_file' has quoted role frontmatter — Skynet convention is unquoted (fleet-drift signal)"
fi
return 0
```

Why not awk-stderr:
- The alternative (routing WARN out of awk's END block via `print ... > "/dev/stderr"`) works, but the WARN then lands on the process's stderr channel rather than the supervisor's `log()` stream. The supervisor's `log()` function goes to stdout (see agent-supervisor.sh:44 — `log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }`), so an awk-stderr WARN would appear in a different place than every other supervisor log line — surprising for operators reading a single log tail.
- The post-hoc grep runs only when a match was confirmed (cheap: file is already in the page cache from the awk read). Overhead is negligible.
- The `assert_grep "WARN" "$out"` check in Test H captured both stdout AND stderr via `2>&1` — and now the WARN travels via `log()` on stdout as expected. Clean end-to-end.

### Scanner-vs-retire-refactor integration surprises

**None.** Plan 133-03 landed the atomic `retire_identity()` contract exactly as promised: single return code (0/1), no cross-tick state, inline retries live inside the function. The cascade caller here consumes it via a plain `if retire_identity "$ident"; then` — no counter files to plumb, no retire-stuck-skip guard to duplicate, no sentinel-drop bookkeeping.

One nuance worth calling out: the Test B fail-soft-partial test needed to exercise `retire_identity()` returning 1 for `delta`. Because 133-03 added inline retries (3 attempts against a 500 stub with 2s + 4s backoff), Test B's wall time is dominated by that ~6s retry burst. This is acceptable — it's the same wall-time envelope as `test_retire_step1_terminal_after_3_5xx` in the sibling test file (6s), and Test B still completes in ~10s wall total on the CI-class host running the test. No plan-level accommodation needed; it's just a side effect of the cascade calling into inline-retried retire.

## Deviations from Plan

None. Both tasks executed exactly as the plan wrote them. No Rule 1/2/3 auto-fixes were needed; the sibling `retire_identity()` contract from 133-03 was honored end-to-end. No Rule 4 architectural questions arose.

The one small implementation choice within Task 1 (post-hoc grep vs awk-stderr for the WARN) is explicitly enumerated in the plan as a "planner's call" alternative — chose the simpler alternative that the plan explicitly recommended.

## Self-Check: PASSED

- `substrate/scripts/agent-supervisor.sh` — modified in-place, +138 lines. Constants block, `identity_has_role`, `scan_role_archive_requested_sentinels`, and reconcile wire-up all verified present via grep.
- `substrate/scripts/tests/agent-supervisor-role-archive.test.sh` — created, 701 lines, executable, shellcheck-clean, 9/9 green.
- Commit `222f20f3` (Task 1) — present in git log.
- Commit `7e9c392a` (Task 2) — present in git log.
- New test suite green: `PASS: 9  FAIL: 0`.
- Sibling test suite green (no regression): `PASS: 73  FAIL: 0`.

## Downstream Impact

Wave C is complete. The end-to-end user-initiated role archival gesture is now wired:

1. **UI** (Plan 133-06, still ahead): operator right-clicks a row on `RolesListModal`, confirms twice.
2. **Frontend** (Plan 133-02, ✅ landed): `archiveRole(hostId, name)` posts to `POST /roles/:name/archive`.
3. **Backend** (Plan 133-01, ✅ landed): route uses `writeRoleFile` primitive to SFTP a `.archive-requested` sentinel onto `~/fleet/roles/<name>/`.
4. **Substrate scanner** (Plan 133-04, ✅ this plan): reconcile-loop tick picks up the sentinel via `scan_role_archive_requested_sentinels`; fresh-enumerates identities holding the role; fail-soft cascades `retire_identity()` (from Plan 133-03 refactor); moves the role folder to `~/fleet/roles-archive/<name>/` if all-clean; deletes the sentinel regardless.

Plan 133-05 (id-skill docs update in `substrate/skills/id/SKILL.md`) can now describe the flow end-to-end. Plan 133-06 (UI polish + wire-up in `RolesListModal`) is the last wave.
