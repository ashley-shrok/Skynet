---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "01"
subsystem: backend/claude-session
tags: [path-rewrite, fleet-tree, identity, roles, sftp, ssh-templates]
dependency_graph:
  requires: []
  provides:
    - per-identity-file.ts SFTP wire: fleet tree single source of truth
    - identity-artifact-reader.ts LOCAL roots + REMOTE SSH templates: fleet tree
  affects:
    - identity-birth-orchestrator.ts (inherits via writeIdentityFile)
    - user-preferences.ts (inherits via writeIdentityFile)
    - identities.ts (inherits via writeIdentityFile)
    - all identity-artifact-reader callers (inherit via getLocalIdentitiesRoot/getLocalRolesRoot)
tech_stack:
  added: []
  patterns: [path.join(os.homedir(), "fleet", ...)]
key_files:
  created: []
  modified:
    - src/backend/claude-session/per-identity-file.ts
    - src/backend/claude-session/per-identity-file.test.ts
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.two-step.test.ts
    - src/backend/claude-session/identity-artifact-reader.include-archived.test.ts
    - src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts
    - src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts
    - src/backend/claude-session/identity-artifact-reader.role-file.test.ts
    - src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts
    - src/backend/claude-session/identity-artifact-reader.empty-bounties-remote.test.ts
    - src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts
    - src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
    - src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts
    - src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts
    - src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts
    - src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts
    - src/backend/claude-session/identity-artifact-reader.write-role-file-by-name.test.ts
decisions:
  - D-01/D-05/D-06 applied: fleet tree single-source, no dual-path
  - All 92 .claude/identities and .claude/roles references in identity-artifact-reader.ts replaced
  - 11 additional test files beyond the 3 named in the plan required path-string updates (verified by test run)
metrics:
  duration: "~4 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 17
---

# Phase 96 Plan 01: Wave 1 — Single-source path helpers fleet tree rewrite

**One-liner:** Fleet tree path rewrite at the two lowest-level TypeScript path-helper sources, propagating `~/fleet/identities` and `~/fleet/roles` to all callers via inheritance.

## Task 1: per-identity-file.ts + per-identity-file.test.ts

### Source file edits (per-identity-file.ts)

| Line | Before | After | Type |
|------|--------|-------|------|
| 35 (comment) | `${os.homedir()}/.claude/identities/${name}/${relPath}` | `${os.homedir()}/fleet/identities/${name}/${relPath}` | PROSE |
| 103 (localTargetPath body) | `path.join(os.homedir(), ".claude", "identities", name, relPath)` | `path.join(os.homedir(), "fleet", "identities", name, relPath)` | REWRITE |
| 110 (remoteTargetPath JSDoc) | `$HOME/.claude/identities/${name}/${relPath}` | `$HOME/fleet/identities/${name}/${relPath}` (rewrote to non-historical form) | PROSE |
| 122 (remoteTargetPath body) | `` `$HOME/.claude/identities/${name}/${relPath}` `` | `` `$HOME/fleet/identities/${name}/${relPath}` `` | REWRITE |
| 158 (writeIdentityFile JSDoc) | `~/.claude/identities/<name>/<relPath>` | `~/fleet/identities/<name>/<relPath>` | PROSE |

Total fleet/identities references in source: 4 (≥2 required).

### Test file edits (per-identity-file.test.ts)

| Location | What changed |
|----------|-------------|
| Line 303 (test description) | `.pinned file at $HOME/.claude/identities/` → `$HOME/fleet/identities/` |
| Lines 315-321 (LOCAL write expected path) | `path.join(os.homedir(), ".claude", "identities", ...)` → `"fleet"` |
| Line 354 (REMOTE ext_openssh_rename to) | `"$HOME/.claude/identities/tina/.pinned"` → `"$HOME/fleet/identities/tina/.pinned"` |
| Line 361 (REMOTE sftp.writeFile path) | `"$HOME/.claude/identities/tina/.pinned.tmp"` → `"$HOME/fleet/identities/tina/.pinned.tmp"` |
| Line 375 (test description) | `fs.unlink at $HOME/.claude/identities/` → `$HOME/fleet/identities/` |
| Lines 384-390 (LOCAL remove expected path) | `path.join(os.homedir(), ".claude", "identities", ...)` → `"fleet"` |
| Line 430 (REMOTE sftp.unlink path) | `"$HOME/.claude/identities/tina/.pinned"` → `"$HOME/fleet/identities/tina/.pinned"` |
| Lines 462-468 (LOCAL exists expected path) | `path.join(os.homedir(), ".claude", "identities", ...)` → `"fleet"` |
| Line 535 (Test 9 comment) | `$HOME/.claude/identities/` → removed/updated reference |
| Line 540 (Test 9 rename.to) | `"$HOME/.claude/identities/tina/relay.json"` → `"$HOME/fleet/identities/tina/relay.json"` |
| Lines 599-605 (LOCAL chmod expected path) | `path.join(os.homedir(), ".claude", "identities", ...)` → `"fleet"` |

### Verification
- `grep -c "\.claude/identities" per-identity-file.ts` → 0
- `grep -c "\.claude/identities" per-identity-file.test.ts` → 0
- `grep -c "fleet/identities" per-identity-file.ts` → 4
- `npm test -- src/backend/claude-session/per-identity-file.test.ts` → **28/28 tests pass**

---

## Task 2: identity-artifact-reader.ts + 3 primary test files + 11 additional test files

### Source file edits (identity-artifact-reader.ts)

**Root function rewrites:**
| Function | Before (fallback) | After (fallback) |
|----------|-------------------|------------------|
| `getLocalIdentitiesRoot()` line 220 | `path.join(os.homedir(), ".claude", "identities")` | `path.join(os.homedir(), "fleet", "identities")` |
| `getLocalRolesRoot()` line 240 | `path.join(os.homedir(), ".claude", "roles")` | `path.join(os.homedir(), "fleet", "roles")` |

Env-var overrides (`IDENTITIES_HOST_DIR`, `ROLES_HOST_DIR`) preserved — test seams remain intact.

**REMOTE SSH template literal rewrites:**
- Total `.claude/identities` + `.claude/roles` occurrences before: **92**
- After bulk sed replacement: **0** remaining
- Replacement strategy: `sed -i 's/\.claude\/identities/fleet\/identities/g; s/\.claude\/roles/fleet\/roles/g'`
- All occurrences were live-code or comments describing current behavior — none were historical narrative that needed preserving

Categories of REMOTE template rewrites (examples):
- `cat "$HOME/.claude/identities/${identityKey}/${identityKey}.md"` → `fleet/identities`
- `find "$HOME/.claude/identities"` → `fleet/identities`
- `cd "$HOME/.claude/roles/${role}/bounties"` → `fleet/roles`
- `$HOME/.claude/identities/${identityKey}/wakeups/${slug}.json` → `fleet/identities`
- `$HOME/.claude/roles/${role}/wakeups/${slug}.json` → `fleet/roles`
- `${remoteHome}/.claude/identities/${identityKey}/...` → `fleet/identities`
- `${remoteHome}/.claude/roles/${roleName}/...` → `fleet/roles`

### Test file updates

**3 primary test files (named in the plan):**
| File | Hits replaced |
|------|--------------|
| `identity-artifact-reader.two-step.test.ts` | ~15 path strings + 1 `path.join(os.homedir(), ".claude", "roles")` assertion at line 144 |
| `identity-artifact-reader.include-archived.test.ts` | 6 path strings |
| `identity-artifact-reader.role-cosmetics.test.ts` | 4 path strings |

**11 additional test files (discovered via test run — all had real path-string assertions):**

| File | Nature of hits |
|------|---------------|
| `identity-artifact-reader.remote-writes.test.ts` | `/home/tester/.claude/identities/tina/...` assertions |
| `identity-artifact-reader.role-file.test.ts` | `$HOME/.claude/roles/...` toContain assertions |
| `identity-artifact-reader.role-wakeups.test.ts` | `cmd.includes(".claude/roles/...")` routing + assertions |
| `identity-artifact-reader.empty-bounties-remote.test.ts` | `cmd.includes(".claude/identities/")` routing |
| `identity-artifact-reader.wakeup-crud.test.ts` | Test description strings |
| `identity-artifact-reader.count-bounties.test.ts` | Comment with old path |
| `identity-artifact-reader.archive-bounty.test.ts` | Comment with old path |
| `identity-artifact-reader.delete-bounty.test.ts` | Comment with old path |
| `identity-artifact-reader.write-bounty-status.test.ts` | Comment with old path |
| `identity-artifact-reader.write-bounty-pinned.test.ts` | Comment with old path |
| `identity-artifact-reader.write-role-file-by-name.test.ts` | `/home/tester/.claude/roles/...` path assertions |

### Verification
- `grep -cE "\.claude/(identities|roles)" identity-artifact-reader.ts` → 0
- `grep -c '"fleet", "identities"' identity-artifact-reader.ts` → 1
- `grep -c '"fleet", "roles"' identity-artifact-reader.ts` → 1
- `npm test -- identity-artifact-reader` → **17 test files, 165 tests pass**

---

## Deviations from Plan

### Deviation 1 [Rule 2 - Auto-fix] Additional test files required path-string updates

**Found during:** Task 2
**Issue:** The plan named 3 primary test files but said to "audit each with grep and only rewrite files with real assertion strings on identity/role paths." Running the test suite revealed 11 additional test files with failing path-string assertions (not just IDENTITIES_HOST_DIR test-seam setups).
**Fix:** Applied the same sed replacement to all 11 additional test files with real assertions.
**Files modified:** 11 additional test files as listed above
**Commits:** d6dbcd9d

### Pre-existing TypeScript build error (not caused by this plan)

`src/backend/database/routes/identity-birth-orchestrator.ts(886,20): error TS2339: Property 'hostId' does not exist` — pre-exists this plan's changes. Confirmed by reverting all changes and running `npm run build:backend` — same error. Documented here for completeness; not addressed in this plan (out of scope per deviation rule scope boundary).

---

## Historical-Narrative Comments Intentionally Retained

None. All 92 `.claude/identities` and `.claude/roles` occurrences in `identity-artifact-reader.ts` described current behavior (either live code or comments stating where files currently live). No historical-narrative comments explicitly retained.

---

## Self-Check: PASSED

- [x] per-identity-file.ts: 0 `.claude/identities` hits, 4 `fleet/identities` hits
- [x] per-identity-file.test.ts: 0 `.claude/identities` hits
- [x] identity-artifact-reader.ts: 0 `.claude/identities|roles` hits, 1 `"fleet", "identities"`, 1 `"fleet", "roles"`
- [x] Task 1 commit d1d2d91d exists
- [x] Task 2 commit d6dbcd9d exists
- [x] 28 tests pass (per-identity-file)
- [x] 165 tests pass across 17 files (identity-artifact-reader)
