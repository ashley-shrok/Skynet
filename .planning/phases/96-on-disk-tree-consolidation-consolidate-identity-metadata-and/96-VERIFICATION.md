---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
verified: 2026-09-10T02:15:00Z
status: passed
score: 19/19 must-haves verified
overrides_applied: 0
re_verification: false
gaps: []
human_verification: []
---

# Phase 96: On-Disk Tree Consolidation Verification Report

**Phase Goal:** Consolidate every piece of on-disk state that describes an identity or a role, along with the working directory each identity actually works in, into one canonical `~/fleet/` tree with three siblings (`roles/`, `identities/`, `identities-archive/`); each identity's folder gains a `workspace/` sub-part. Ship as one coordinated release covering: id-skill body + coordinator companions + agent-supervisor + four ambient monitor scripts + Skynet backend identity-birth SFTP target + Skynet backend path helpers + WHITELIST_REGEX security gate. No dual-path fallback in code — single canonical location everywhere.

**Verified:** 2026-09-10T02:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Tree layout: hardcoded paths in touched files point at `~/fleet/roles/`, `~/fleet/identities/`, or `~/fleet/identities-archive/` (D-01, D-02) | VERIFIED | `per-identity-file.ts:103` uses `path.join(os.homedir(), "fleet", "identities", name, relPath)`; `identity-artifact-reader.ts:220/240` returns `fleet/identities` and `fleet/roles`; `relay-pointer.ts:44` WHITELIST_REGEX uses `fleet/identities`; `agent-supervisor.sh:32` sets `$HOME/fleet/identities`; `agent-supervisor.sh:36` sets `$HOME/fleet/identities-archive` |
| 2 | Identity folder internal layout preserved (D-03): wakeups/, ctxwatch/, role-file-watch/, relay-state/ remain siblings at identity folder root — no meta/ bundling | VERIFIED | SKILL.md lines 1087-1093 list all sub-folders flat at identity root; no meta/ bundling introduced in any code change |
| 3 | workspace/ sub-part: identity-birth-orchestrator Step 2 mkdir creates workspace/ alongside wakeups/ (D-04, resolved-Q4) | VERIFIED | `identity-birth-orchestrator.ts:1141`: `mkdir -p "${identityDir}/wakeups" "${identityDir}/workspace"` — single command, both sub-parts |
| 4 | coordinator-instructions.md workspace/ step: spawn flow includes `mkdir workspace/` (D-04) | VERIFIED | `coordinator-instructions.md:279`: `3. mkdir -p ~/fleet/identities/<name>/workspace — generic working directory per D-04` with verify gate at step 7 |
| 5 | No grandfathering: no `~/skynet-<name>` prose references remain in live code (D-05). Known corpus captures in session-file-parser.outbound-body.test.ts are LITERAL DATA and exempt | VERIFIED | `grep -rn "~/skynet-" src/ substrate/ --include="*.ts" --include="*.sh" --include="*.py" --include="*.md" | grep -v session-file-parser.outbound-body.test.ts` → 0 hits; corpus captures at lines 40, 46 confirmed as verbatim agent message bodies |
| 6 | No dual-path fallback: no "try old location, fall back to new" branching (D-06) | VERIFIED | Grep for `if.*\.claude.*identities.*else.*fleet` across src/ and substrate/ → 0 hits; `IDENTITIES_HOST_DIR` env-var override in identity-artifact-reader.ts is a test seam (not production dual-path); all "fallback" grep hits are HTTP 500 handlers |
| 7 | WHITELIST_REGEX security gate: accepts `fleet/identities` path shape AND rejects `.claude/identities` path shape (Test 4d) | VERIFIED | `relay-pointer.ts:44`: regex is `/^\/home\/[a-z0-9_-]+\/fleet\/identities\/...$/`; `relay-pointer.test.ts:195,197`: `WHITELIST_REGEX.test("/home/ubuntu/.claude/identities/tina/...")` → `false` (Test 4d) |
| 8 | agent-supervisor `IDENTITIES_ARCHIVE_DIR` is a separate sibling variable, not `$IDENTITIES_DIR/archive` derivation (D-02) | VERIFIED | `agent-supervisor.sh:36`: `IDENTITIES_ARCHIVE_DIR="${AGENT_IDENTITIES_ARCHIVE_DIR:-$HOME/fleet/identities-archive}"` — declared independently with D-02 comment; comment at line 33-35 explicitly documents non-derivation |
| 9 | agent-supervisor `retire_identity` moves to `$IDENTITIES_ARCHIVE_DIR/$name/`, not `$IDENTITIES_DIR/archive/$name/` | VERIFIED | `agent-supervisor.sh:287`: `local archdir="$IDENTITIES_ARCHIVE_DIR/$name"`; `agent-supervisor.sh:293`: `mkdir -p "$IDENTITIES_ARCHIVE_DIR" 2>/dev/null` |
| 10 | Dead `archive` skip filter REMOVED from resolve_identities and run_archive_scan | VERIFIED | `grep '[ "$name" = archive ] && continue' agent-supervisor.sh` → 0 hits; resolve_identities (lines 217-232) only uses `.md` file guard; run_archive_scan (lines 416-423) only uses `.md` file guard |
| 11 | agent-supervisor convention workdir = `$IDENTITIES_DIR/$name/workspace`, not `~/skynet-<name>` or identity dir root | VERIFIED | `agent-supervisor.sh:1044-1045`: `elif [ -d "$IDENTITIES_DIR/$name/workspace" ]; then cwd="$IDENTITIES_DIR/$name/workspace"` |
| 12 | Phase 94 archive-scan test driver at `substrate/scripts/tests/agent-supervisor-archive-scan.sh` updated to use sibling archive scratch dir; 31/31 tests pass | VERIFIED | Test driver line 93: `export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"` (sibling layout); setup_scratch creates `${s}-archive`; actual test run: PASS: 31 FAIL: 0 |
| 13 | role-file-watch.py line 236: only hardcoded path rewritten to `~/fleet/roles/` | VERIFIED | `role-file-watch.py:236`: `role_file_path = os.path.expanduser("~/fleet/roles/%s/%s.md" % (role, role))` |
| 14 | id-skill body + 4 coordinator/agent-relay companions: all `~/.claude/identities/` and `~/.claude/roles/` prose references rewritten to `~/fleet/...`; agent-relay SKILL.md line 481 rewritten from `~/skynet-<name>/` to `~/fleet/identities/<name>/workspace/` | VERIFIED | `grep -c "\.claude/identities\|\.claude/roles" substrate/skills/id/SKILL.md` → 0; coordinator-instructions.md, clone-picker-prompt.md, actor-status-prompt.md all show only fleet paths; `agent-relay/SKILL.md:481` now reads `~/fleet/identities/<name>/workspace/substrate/skills/agent-relay/` |
| 15 | MIGRATION.md exists at `.planning/phases/96-.../MIGRATION.md` (D-10), covers D-07's 7-step sequence + D-09's archived-identities decision prompt | VERIFIED | File exists at `8584` bytes; contains Step 0 (D-09 decision prompt), Steps 1-7 per D-07 sequence, rollback note, fleet-substrate hand-patch anti-pattern warning |
| 16 | Skynet backend `per-identity-file.ts` writes to `~/fleet/identities/<name>/` (D-11 canonical file) | VERIFIED | `per-identity-file.ts:103`: `localTargetPath()` returns `path.join(os.homedir(), "fleet", "identities", name, relPath)` — single source of truth for local writes; `remoteTargetPath()` at line 121 returns `$HOME/fleet/identities/${name}/${relPath}` — single source of truth for remote writes |
| 17 | Repo-wide grep-clean audit: 0 live-code hits for `~/.claude/identities/`, `~/.claude/roles/`, `~/skynet-` in `src/` + `substrate/` (excluding known-retained corpus) | VERIFIED | `.claude/identities` → 9 hits all in relay-pointer module (D-06 security documentation only, no live code); `.claude/roles` → 0 hits; `~/skynet-` (excluding session-file-parser corpus) → 0 hits |
| 18 | Retained references intact (D-12/D-13/D-14): `~/.claude/CLAUDE.md`, `~/.claude/skills/`, `~/.local/bin/` remain unchanged | VERIFIED | `SKILL.md:111/792/794`: CLAUDE.md referenced intact; `catalog.ts:74-225`: `.claude/skills/` and `.local/bin/` install paths all intact; distributor install targets unchanged |
| 19 | Fleet-substrate distributor catalog UNCHANGED: install locations at `~/.local/bin/`, `~/.claude/skills/agent-relay/` remain | VERIFIED | `catalog.ts:99,105,111,117,125,131,189,195,201,207...` — all installPath entries retain their `~/.claude/skills/` and `~/.local/bin/` install locations; only file CONTENTS changed |

**Score:** 19/19 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/claude-session/per-identity-file.ts` | Fleet tree path for identity file writes | VERIFIED | `localTargetPath()` returns `fleet/identities` path; 0 legacy hits |
| `src/backend/claude-session/identity-artifact-reader.ts` | Fleet tree roots for identities + roles | VERIFIED | Lines 220/240: `fleet/identities` and `fleet/roles`; 0 legacy hits |
| `src/backend/database/routes/relay-pointer.ts` | WHITELIST_REGEX accepts fleet/identities, rejects .claude/identities | VERIFIED | Regex pattern confirmed fleet tree; Test 4d rejection confirmed |
| `substrate/scripts/agent-supervisor.sh` | Fleet paths + IDENTITIES_ARCHIVE_DIR sibling + workspace workdir | VERIFIED | Lines 32/36/1044-1045 confirmed; dead archive filter absent |
| `substrate/scripts/tests/agent-supervisor-archive-scan.sh` | Updated to sibling archive scratch dir; 31/31 pass | VERIFIED | AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"; actual run: 31/31 PASS |
| `substrate/scripts/role-file-watch.py` | Line 236 rewritten to fleet/roles | VERIFIED | `~/fleet/roles/%s/%s.md` confirmed |
| `substrate/skills/id/SKILL.md` | 0 legacy paths; workspace/ documented; fleet tree section | VERIFIED | 0 legacy hits; workspace/ at line 1093; file locations section rewritten |
| `substrate/skills/id/coordinator-instructions.md` | workspace/ mkdir step; fleet paths throughout | VERIFIED | Step 3 workspace mkdir confirmed; lines 278-342 fleet paths confirmed |
| `substrate/skills/id/clone-picker-prompt.md` | Fleet paths | VERIFIED | 3 fleet path rewrites confirmed |
| `substrate/skills/id/actor-status-prompt.md` | Fleet paths | VERIFIED | 3 fleet path rewrites confirmed |
| `substrate/skills/agent-relay/SKILL.md` | Line 481 ~/skynet-<name>/ → workspace/; fleet identity paths | VERIFIED | Line 481 now reads fleet/identities/<name>/workspace/; 7 total rewrites confirmed |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | workspace/ mkdir + fleet identityDir | VERIFIED | Line 1133: fleet identityDir; line 1141: wakeups + workspace mkdir |
| `.planning/phases/96-.../MIGRATION.md` | Exists; covers D-07 7-step sequence + D-09 prompt | VERIFIED | 8584 bytes; Step 0 D-09 prompt + Steps 1-7 + rollback + anti-pattern warning confirmed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `identity-artifact-reader.ts:getLocalIdentitiesRoot()` | `~/fleet/identities` | `path.join(os.homedir(), "fleet", "identities")` | WIRED | Line 220 confirmed |
| `per-identity-file.ts:localTargetPath()` | `~/fleet/identities/<name>/<relPath>` | `path.join(os.homedir(), "fleet", "identities", name, relPath)` | WIRED | Line 103 confirmed |
| `relay-pointer.ts:WHITELIST_REGEX` | accepts fleet/identities, rejects .claude/identities | Regex pattern | WIRED | Pattern confirmed; Test 4d rejection confirmed |
| `agent-supervisor.sh:IDENTITIES_ARCHIVE_DIR` | `~/fleet/identities-archive` | standalone variable (not derived) | WIRED | Line 36 confirmed; comment documents non-derivation |
| `agent-supervisor.sh:retire_identity` | `$IDENTITIES_ARCHIVE_DIR/$name` | `local archdir="$IDENTITIES_ARCHIVE_DIR/$name"` | WIRED | Line 287 confirmed |
| `agent-supervisor.sh:convention workdir` | `$IDENTITIES_DIR/$name/workspace` | `elif [ -d "$IDENTITIES_DIR/$name/workspace" ]` | WIRED | Lines 1044-1045 confirmed |
| `identity-birth-orchestrator.ts:Step 2 mkdir` | `wakeups/ + workspace/` under fleet identityDir | `mkdir -p "${identityDir}/wakeups" "${identityDir}/workspace"` | WIRED | Line 1141 confirmed; Test 6b asserts both sub-parts |
| `coordinator-instructions.md:spawn step 3` | `mkdir workspace/` at identity birth | prose instruction | WIRED | Line 279 confirmed |
| `archive-scan test driver` | sibling `${scratch}-archive` dir | `AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"` | WIRED | Line 93 confirmed; 31/31 test pass confirmed by actual run |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 94 archive-scan test driver — 31 tests | `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` | PASS: 31 FAIL: 0 | PASS |
| No legacy `.claude/identities` in live code | `grep -rn "\.claude/identities" src/ substrate/ ... \| wc -l` | 9 (all D-06 documentation only) | PASS |
| No legacy `.claude/roles` in live code | `grep -rn "\.claude/roles" src/ substrate/ ... \| wc -l` | 0 | PASS |
| No `~/skynet-` in live code (excluding corpus) | `grep -rn "~/skynet-" substrate/ src/ ... \| grep -v session-file-parser.outbound-body.test.ts` | 0 | PASS |
| IDENTITIES_ARCHIVE_DIR is sibling not derived | `grep "IDENTITIES_ARCHIVE_DIR" agent-supervisor.sh \| head -3` | Standalone declaration `$HOME/fleet/identities-archive`; comment confirms non-derivation | PASS |
| workspace/ mkdir in birth orchestrator | `grep "mkdir.*workspace" identity-birth-orchestrator.ts` | Line 1141: single-command with wakeups | PASS |

---

### Requirements Coverage

Phase 96 requirements are expressed as D-01..D-18 decisions in CONTEXT.md. All 18 decisions verified:

| Decision | Description | Status | Evidence |
|----------|-------------|--------|----------|
| D-01 | Tree root at `~/fleet/` | SATISFIED | All touched files use fleet/ prefix |
| D-02 | Three siblings: roles/, identities/, identities-archive/ (sibling archive) | SATISFIED | IDENTITIES_ARCHIVE_DIR declared as sibling; fleet/identities-archive in agent-supervisor |
| D-03 | Identity folder internal layout preserved exactly | SATISFIED | SKILL.md file locations section lists all original sub-folders at root; no meta/ bundling |
| D-04 | workspace/ added as new sub-part | SATISFIED | birth-orchestrator mkdir; coordinator-instructions step 3; SKILL.md documentation |
| D-05 | No grandfathering — ~/skynet-<name> moved | SATISFIED | 0 live code ~/skynet- hits (corpus captures exempt as literal data) |
| D-06 | No dual-path fallback | SATISFIED | 0 "try old, fall back to new" patterns found; Test 4d hard-rejects legacy path |
| D-07 | Per-box migration sequence | SATISFIED | MIGRATION.md Steps 1-7 cover save→copy→shutdown→deploy→verify→delete |
| D-08 | Migration timing is maintainer-coordinated | SATISFIED | MIGRATION.md documents "no sessions busy" coordination expectation |
| D-09 | Currently-archived identities decided at migration-time | SATISFIED | MIGRATION.md Step 0 prompts maintainer for decision; absent = skip |
| D-10 | Migration runbook at phase planning dir | SATISFIED | File exists at `.planning/phases/96-.../MIGRATION.md` (8584 bytes) |
| D-11 | Path rewrites land in canonical file list | SATISFIED | All D-11 files modified; 30-file D-15 audit found and fixed additional files |
| D-12 | `~/.claude/CLAUDE.md` stays in place | SATISFIED | Referenced intact in SKILL.md; not moved |
| D-13 | `~/.claude/skills/` stays in place | SATISFIED | catalog.ts install paths unchanged; SKILL.md binary paths unchanged |
| D-14 | `~/.local/bin/` stays in place | SATISFIED | catalog.ts install paths unchanged |
| D-15 | Repo-wide grep sweep audit | SATISFIED | 96-07 Plan ran full sweep; 30 additional files found and fixed; final count: 9 intentional D-06 refs, 0 roles, 0 skynet- |
| D-16 | All changes ship as one coordinated release | SATISFIED | All changes in one repo branch; distributor + backend ship together |
| D-17 | Per-box migration timing is maintainer's choice | SATISFIED | MIGRATION.md is per-box instruction, not fleet-synchronized |
| D-18 | Shape 3 code held-from-ship until 4-shape campaign lands | SATISFIED | On `feat/tab-title-from-tmux` branch, held per campaign policy |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TBD, FIXME, XXX, or placeholder patterns found in any Phase 96 modified files.

---

### Section E Confirmation

Section E of 96-07-SUMMARY.md documents **zero anomalies** after remediation. The 30 files found during the D-15 audit were remediated in commit `8db778a7` — this represents the D-15 audit doing its job correctly (catching misses from D-11 canonical file list). Not anomalies in the final ship state.

---

### D-06 Security Gate Documentation (9 Intentional Retained References)

The 9 remaining `.claude/identities` hits in `relay-pointer.ts` and `relay-pointer.test.ts` are intentional security-load-bearing documentation:

- `relay-pointer.ts:40-41` — comments explaining WHY legacy path is rejected (D-06 hard-cutover rationale)
- `relay-pointer.test.ts:16,192,193,195,197` — Test 4d explicitly asserts `WHITELIST_REGEX.test(".claude/identities/...")` returns `false`
- `relay-pointer-detect.ts:24,41` — client-side comments documenting the fleet tree replacement

These are not code leaks. Rewriting them to `fleet/identities` would break Test 4d's purpose (verifying rejection of the legacy path) and remove the D-06 security rationale documentation.

---

### Human Verification Required

None. All must-haves are verifiable through code inspection and the archive-scan test driver run.

---

## Gaps Summary

No gaps. All 19 must-haves pass. Phase 96 goal is achieved: every piece of on-disk identity and role state in code points to `~/fleet/` with no dual-path fallback, the WHITELIST_REGEX security gate is updated, the migration runbook is complete, and the archive-scan test suite passes 31/31.

---

_Verified: 2026-09-10T02:15:00Z_
_Verifier: Claude (gsd-verifier)_
