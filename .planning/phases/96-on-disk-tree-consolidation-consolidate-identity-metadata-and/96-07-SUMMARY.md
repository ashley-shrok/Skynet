---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "07"
subsystem: cross-repo-audit
tags: [migration-runbook, grep-audit, fleet-tree, path-rewrite, d-15]
dependency_graph:
  requires:
    - 96-01 (per-identity-file.ts + identity-artifact-reader.ts)
    - 96-02 (backend routes)
    - 96-03 (ssh-poll-orchestrator)
    - 96-04 (substrate scripts)
    - 96-05 (skill prose)
    - 96-06 (workspace mkdir extension)
  provides:
    - MIGRATION.md per-box maintainer runbook
    - D-15 grep-clean audit: final ship-state affidavit
    - 30-file remediation of Phase 96 planning misses
  affects:
    - Ship readiness for 4-shape id-skill-revamp campaign
tech_stack:
  added: []
  patterns: []
key_files:
  created:
    - .planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/MIGRATION.md
    - .planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/96-07-SUMMARY.md
  modified:
    - src/backend/claude-session/claude-session-server.ts (8 live SSH commands)
    - src/backend/claude-session/sentinel-detect.ts (1 live SSH command)
    - src/backend/relay-sessions/enumerate-agent-mxids.ts (1 live command constant)
    - src/ui/features/pretty-view/relay-pointer-detect.ts (POINTER_REGEX)
    - substrate/skills/role/SKILL.md
    - substrate/skills/next-bounty/SKILL.md
    - substrate/skills/claude-code-harness-auth/SKILL.md
    - src/backend/claude-session/dormant-poll.test.ts
    - src/backend/claude-session/sentinel-detect.test.ts
    - src/backend/relay-sessions/enumerate-agent-mxids.test.ts
    - src/ui/features/pretty-view/RelayInboundBubble.test.tsx
    - 19 additional source + test files (comment/prose updates)
decisions:
  - "D-06 hard-cutover documentation in relay-pointer.ts/test.ts retained: Test 4d asserts .claude/identities paths are REJECTED — these 9 references must document the old (rejected) path shape and cannot be updated to fleet paths"
  - "30-file remediation: files not in D-11 canonical list but caught by D-15 repo-wide grep floor"
  - "PrettyConversationsPanel.test.tsx and relay-room-create.test.ts failures are pre-existing (confirmed pre-exist Plan 96-02)"
  - "shellcheck warnings are pre-existing; shellcheck --severity=error returns 0"
metrics:
  duration: "~29 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 32
---

# Phase 96 Plan 07: D-15 Grep Audit + Migration Runbook

**One-liner:** MIGRATION.md runbook written; D-15 repo-wide grep audit run, finding and fixing 30 files missed by Plans 96-01 through 96-06 (functional code in sentinel-detect, claude-session-server, enumerate-agent-mxids, relay-pointer-detect, and three substrate skills); ship-state confirmed.

---

## Section A: Live-code Sweep

### Commands and results

```bash
grep -rn "\.claude/identities" src/ substrate/ --include="*.ts" --include="*.sh" --include="*.py" --include="*.md"
```
**Count (after remediation):** 9 hits

```bash
grep -rn "\.claude/roles" src/ substrate/ --include="*.ts" --include="*.sh" --include="*.py" --include="*.md"
```
**Count (after remediation):** 0 hits

```bash
grep -rn "~/skynet-" substrate/ src/ --include="*.sh" --include="*.py" --include="*.md" --include="*.ts" | grep -v "^src/backend/claude-session/session-file-parser\.outbound-body\.test\.ts:"
```
**Count:** 0 hits

### The 9 remaining `.claude/identities` hits are intentional D-06 retained references

All 9 hits are in the relay-pointer module's D-06 hard-cutover documentation:

| File | Line | Nature |
|------|------|--------|
| `src/backend/database/routes/relay-pointer.ts` | 40 | Comment: "fleet tree replaces legacy .claude/identities path" |
| `src/backend/database/routes/relay-pointer.ts` | 41 | Comment: "Legacy .claude/identities paths are REJECTED" |
| `src/backend/database/routes/relay-pointer.test.ts` | 16 | Comment: "Test 4d: whitelist reject legacy .claude/identities path" |
| `src/backend/database/routes/relay-pointer.test.ts` | 192 | Test name: "Test 4d: whitelist reject..." |
| `src/backend/database/routes/relay-pointer.test.ts` | 193 | Comment: "Post-Phase-96 migration: legacy .claude/identities path shape is a hard-reject" |
| `src/backend/database/routes/relay-pointer.test.ts` | 195 | `WHITELIST_REGEX.test("/home/ubuntu/.claude/identities/tina/...")` → expected `false` |
| `src/backend/database/routes/relay-pointer.test.ts` | 197 | `WHITELIST_REGEX.test("/home/ubuntu/.claude/identities/molly/...")` → expected `false` |
| `src/ui/features/pretty-view/relay-pointer-detect.ts` | 24 | Comment: "(Updated Phase 96 D-06: fleet tree replaces legacy .claude/identities path.)" |
| `src/ui/features/pretty-view/relay-pointer-detect.ts` | 41 | Comment: "Updated Phase 96 (D-06 hard-cutover): fleet tree path replaces legacy .claude/identities path." |

**These MUST remain.** Test 4d (lines 192–197) explicitly asserts that the WHITELIST_REGEX **rejects** the old `.claude/identities` path. If these test values were changed to `fleet/identities`, the test would stop verifying the rejection of the legacy path — a security regression. The comments (lines 40–41, 24, and 41 in detect.ts) document WHY the old path is rejected, which is load-bearing for reviewer understanding of the D-06 security gate.

**All functional code hits are 0 after remediation** — no live SSH command, regex, or identity-path resolution code uses `.claude/identities` or `.claude/roles`.

---

## Section B: Retained References Enumeration (D-12/D-13/D-14)

### D-12: `~/.claude/CLAUDE.md` — stays at current location (14 hits)

| File | Lines |
|------|-------|
| `src/backend/database/routes/global-files-read-write.ts` | 5 (JSDoc) |
| `src/backend/database/routes/global-files-read-write.test.ts` | 217, 251, 268, 273, 375, 400, 408, 503, 527 (test data + assertions) |
| `substrate/skills/id/SKILL.md` | 111, 792, 794 (skill prose describing CLAUDE.md as separate retained file) |

### D-13: `~/.claude/skills/` — stays at current location (~50+ hits)

Key files (sample):
| File | Nature |
|------|--------|
| `src/backend/distributor/catalog.ts` | Install paths for all distributor-managed skills |
| `src/backend/distributor/ssh-push.ts` | Install path in shell command construction |
| `src/backend/distributor/catalog.test.ts` | Assertions on installPath prefix `~/.claude/skills/` |
| `src/backend/distributor/log-tags.test.ts`, `run-sweep.test.ts`, `sweep-logic.test.ts`, `ssh-push.test.ts` | Test fixtures for distributor |
| `src/backend/database/routes/runbooks-editor.ts` | Comment mirroring SKILL_ROOT_REL |
| `src/backend/database/routes/skills-editor.ts` | SKILL_ROOT_REL constant (`.claude/skills` — source/dest for skill CRUD) |
| `src/backend/voice/skill-catalog.ts` | LS_SKILLS_COMMAND (`ls -1 ~/.claude/skills/`) |
| `src/backend/claude-session/session-file-parser.outbound-body.test.ts` | Corpus fixture: `source ~/.claude/skills/agent-relay/lib.sh` |
| `src/backend/claude-session/layer1-detect.ts` | "Base directory for this skill: ~/.claude/skills/..." pattern |
| `substrate/skills/id/SKILL.md` | References to skill install locations |
| `substrate/skills/id/coordinator-instructions.md` | Clone-picker and actor-status prompt file paths |
| `substrate/skills/agent-relay/SKILL.md` | recv.sh install path |
| `src/ui/api/skills-api.ts` | JSDoc comment |
| `src/backend/database/routes/voice.ts` | Comment mentioning skill catalog |

### D-14: `~/.local/bin/` — stays at current location (~20+ hits)

Key files:
| File | Nature |
|------|--------|
| `src/backend/distributor/catalog.ts` | Install paths for 7 scripts (agent-supervisor, wakeup-scheduler, context-watch, role-file-watch, usage-reporter, install-usage-reporter, claude-usage-collector) |
| `src/backend/distributor/catalog.test.ts` | Assertions on installPath prefix `~/.local/bin/` |
| `src/backend/distributor/log-tags.test.ts`, `run-sweep.test.ts`, `sweep-logic.test.ts` | Test fixtures |
| `substrate/scripts/agent-supervisor.sh` | Self-install path commentary |
| `substrate/skills/id/SKILL.md` | Launch command examples (wakeup-scheduler, context-watch, role-file-watch) |
| `substrate/skills/id/coordinator-instructions.md` | wakeup-scheduler launch command |

### Additional retained references: D-06 security gate (relay-pointer module)

9 references documented in Section A above. These are intentional and security-load-bearing.

### Session-file-parser corpus captures (`~/skynet-`)

| File | Lines | Nature |
|------|-------|--------|
| `src/backend/claude-session/session-file-parser.outbound-body.test.ts` | 40, 46 | Captured relay-send message bodies containing natural-language `~/skynet-tanya` references (LITERAL DATA — verbatim agent output captured before migration, not code path references; MUST NOT be rewritten) |

---

## Section C: Historical Planning-Prose Count

`.planning/` legacy-path hits: **2,228 lines**

All are historical planning artifacts (plans, summaries, shapes, context docs from prior phases documenting what the OLD system did). Per RESEARCH.md lines 483–493, these are intentionally retained and NOT rewritten.

---

## Section D: Test Suite Results

### npm test (vitest full run)

| Result | Count |
|--------|-------|
| Test files passed | 356 |
| Test files failed | 2 (pre-existing) |
| Tests passed | 5,243 |
| Tests failed | 9 (pre-existing) |
| Tests skipped | 11 |

**Pre-existing failures (not Phase 96-caused, confirmed by Wave 1–3 SUMMARYs and pre-commit git stash verification):**
- `relay-room-create.test.ts` — 8 failures (confirmed pre-existing in Plan 96-02 SUMMARY; no `.claude/` path references)
- `PrettyConversationsPanel.test.tsx` Test 4 — 1 failure (menu ordering test; zero `.claude/` path references; confirmed pre-existing by stash revert)

**EADDRINUSE errors:** Port 30011 conflict on test host (pre-existing; affect bg-agents-async-ack and role-file tests with port binding errors; zero connection to path rewrites)

### Phase 94 archive-scan test driver

```
bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
```

Result: **PASS: 31 FAIL: 0** — 31/31 tests pass

### shellcheck agent-supervisor.sh

```
shellcheck --severity=error substrate/scripts/agent-supervisor.sh
```

Exit code: **0** (clean at error severity)

Remaining warnings/info are pre-existing (SC2034, SC1090, SC2009, SC2012, SC2046, SC2015) — present before Phase 96 changes and not introduced by this phase.

---

## Section E: Anomalies

**Zero anomalies** after remediation.

During the D-15 audit, 30 files were found with live-code or significant prose references not caught by Plans 96-01 through 96-06. These were remediated in commit `8db778a7`:

### Files remediated (functional / live-code fixes)

| File | Issue | Fix |
|------|-------|-----|
| `sentinel-detect.ts:43` | Live SSH command: `.recycle-requested` probe used old path | Changed `~/.claude/identities/` → `~/fleet/identities/` |
| `claude-session-server.ts` (8 lines) | 8 live SSH commands: `.dormant` stat/rm, identity-probe test-d, `.resume-complete` cat | Bulk sed: `~/.claude/identities/'` → `~/fleet/identities/'` |
| `enumerate-agent-mxids.ts:108` | `REMOTE_ENUMERATE_COMMAND` constant with old path | Changed to `~/fleet/identities/*/relay.json` |
| `relay-pointer-detect.ts:41` | `POINTER_REGEX` (UI-side SSRF defence-in-depth) used old path | Updated to `fleet/identities` to match backend `WHITELIST_REGEX` (Plan 96-02) |

### Substrate skill fixes (live paths read by agents at runtime)

| File | Issue | Fix |
|------|-------|-----|
| `substrate/skills/role/SKILL.md` | 5 hits: ROLE_DIR default + prose paths | Changed `.claude/roles` → `fleet/roles`, `.claude/identities` → `fleet/identities` |
| `substrate/skills/next-bounty/SKILL.md` | 2 hits: bounty pool paths | Changed `.claude/roles/<role>/bounties/` → `fleet/roles/<role>/bounties/` |
| `substrate/skills/claude-code-harness-auth/SKILL.md` | 11 hits: identity folder paths for OAuth token install marker, pending-flow state | Changed all `~/.claude/identities/<name>/` → `~/fleet/identities/<name>/` |

### Test assertion fixes (follow live code changes)

| File | Issue | Fix |
|------|-------|-----|
| `sentinel-detect.test.ts:26` | Assertion on old path | Updated to `~/fleet/identities/'tina'/.recycle-requested` |
| `dormant-poll.test.ts` (8 assertions) | Assertions on old dormant/identity-probe paths | Updated to `~/fleet/identities/'...` |
| `enumerate-agent-mxids.test.ts:55` | Assertion on REMOTE_ENUMERATE_COMMAND | Updated to `~/fleet/identities/*/relay.json` |
| `RelayInboundBubble.test.tsx` (4 hits) | Test fixture paths in relay message body — POINTER_REGEX now rejects old paths causing 2 test failures | Updated to `/home/ubuntu/fleet/identities/` format |

### Prose/comment updates (20 additional files, accuracy only)

claude-session-server.ts (2 comments), wire-protocol.ts (3), wire-protocol.test.ts (2), relay-room-create.ts (1), sessions.test.ts (1), roles.ts (2), matrix-admin-client.ts (1), matrix-admin-client.integration.test.ts (1), schema.ts (2), index.ts (1), fleet-status-types.ts (2), session-working-store.ts (3), session-working-store.test.ts (2), identities-api.ts (1), claude-session-api.ts (8), runbooks-api.ts (1), split-tree.ts (2), split-tree.test.ts (1), session-file-parser.ts (1), catalog.ts (1), relay-pointer-detect.ts (2 comments describing old path shape).

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 30 files missed by Plans 96-01 through 96-06**
- **Found during:** Task 2 (D-15 grep audit)
- **Issue:** The D-11 canonical file list did not include `claude-session-server.ts`, `sentinel-detect.ts`, `enumerate-agent-mxids.ts`, `relay-pointer-detect.ts`, three substrate skills (`role/SKILL.md`, `next-bounty/SKILL.md`, `claude-code-harness-auth/SKILL.md`), and 20+ files with comment-only references. These files contain live SSH commands, regex patterns, and skill prose that agents read at runtime — all pointing at old `~/.claude/identities/` paths.
- **Fix:** All functional code paths updated to `~/fleet/` equivalents. Comment-only references updated for accuracy.
- **Files modified:** 30 files (see Section E above for full list)
- **Commit:** 8db778a7

**2. [Rule 1 - Bug] D-06 retained reference count: 9 (not 0)**
- **Found during:** Task 2 (automated verify check)
- **Issue:** The plan's automated verify block expects `c1 = 0` for `.claude/identities` hits. After full remediation, 9 hits remain in relay-pointer.ts + relay-pointer.test.ts. These are intentional D-06 security documentation — Test 4d explicitly tests that old paths RETURN FALSE from WHITELIST_REGEX, and the comments explain why.
- **Resolution:** These 9 references are enumerated in Section A and Section B as intentional retained references. They serve as security regression tests and cannot be changed to fleet paths without breaking the test's purpose (verifying rejection of the legacy path).
- **Section E status:** EMPTY — these 9 hits are not anomalies, they are D-06 cutover documentation.

---

## Task 1: MIGRATION.md Structural Verification

| Check | Result |
|-------|--------|
| File exists at correct path | PASS |
| Line count (100–400) | PASS (274 lines) |
| Contains "Step 0" (archived identities prompt) | PASS |
| Contains "Step 7" (delete old locations) | PASS |
| Contains "workspace" | PASS |
| Contains "identities-archive" | PASS |
| Contains `mkdir -p ~/fleet/identities ~/fleet/roles ~/fleet/identities-archive` | PASS |
| Contains D-09 currently-archived-identities decision prompt | PASS |
| Contains save → cp → shutdown → deploy → verify → delete sequence | PASS |
| Contains rollback note | PASS |
| Contains fleet-substrate hand-patch anti-pattern warning | PASS |

---

## Known Stubs

None. All path references use live fleet-tree paths.

## Threat Flags

**POINTER_REGEX update (relay-pointer-detect.ts):** The client-side POINTER_REGEX is now in sync with the backend WHITELIST_REGEX (Plan 96-02). Both gates now reject the legacy `.claude/identities` path and admit only `fleet/identities` paths. Security posture improved — the two gates previously diverged, which could have caused the client-side regex to admit relay-message file paths the backend would then reject, producing confusing UX errors. No new trust boundary introduced.

---

## Self-Check: PASSED

- [x] MIGRATION.md exists at `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/MIGRATION.md` (274 lines, all 7 steps + Step 0 + rollback + anti-pattern warning)
- [x] Task 1 commit 71593e4c exists
- [x] Task 2 remediation commit 8db778a7 exists
- [x] Live-code grep: `c1` (identities) = 9 (all D-06 retained; 0 functional), `c2` (roles) = 0, `c3` (skynet-) = 0
- [x] D-12/D-13/D-14 retained references enumerated in Section B
- [x] Historical .planning/ prose: 2,228 hits (not rewritten, per RESEARCH.md guidance)
- [x] Phase 94 archive-scan: 31/31 PASS
- [x] shellcheck --severity=error: exit 0
- [x] npm test: 5,243 passed; 9 pre-existing failures (relay-room-create x8, PrettyConversationsPanel x1)
- [x] Section E: empty (no unresolved anomalies)
