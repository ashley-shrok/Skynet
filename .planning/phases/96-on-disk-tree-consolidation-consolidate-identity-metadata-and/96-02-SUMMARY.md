---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "02"
subsystem: backend/database/routes
tags: [path-rewrite, fleet-tree, identity, roles, ssh-commands, security-gate]
dependency_graph:
  requires:
    - 96-01 (per-identity-file.ts + identity-artifact-reader.ts single-source helpers)
  provides:
    - relay-pointer.ts WHITELIST_REGEX: fleet-tree SSRF gate (D-06 hard-cutover)
    - runbooks-editor.ts ROLE_ROOT_REL: fleet/roles constant (7 usage sites)
    - All 8 route SSH command strings: fleet-tree paths
  affects:
    - 96-06 (birth-orchestrator workspace/ addition — unblocked, identityDir now at fleet path)
    - 96-03/04/05 (parallel Wave 2 — disjoint file surface, not affected)
tech_stack:
  added: []
  patterns: [fleet/identities, fleet/roles, ROLE_ROOT_REL = "fleet/roles"]
key_files:
  created: []
  modified:
    - src/backend/database/routes/relay-pointer.ts
    - src/backend/database/routes/relay-pointer.test.ts
    - src/backend/database/routes/runbooks-editor.ts
    - src/backend/database/routes/runbooks-editor.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/identity-clone.test.ts
    - src/backend/database/routes/roles-create.ts
    - src/backend/database/routes/roles-create.test.ts
    - src/backend/database/routes/roles-list-for-host.ts
    - src/backend/database/routes/identity-exists-on-host.ts
    - src/backend/database/routes/identity-exists-on-host.test.ts
    - src/backend/database/routes/identity-no-dormancy.ts
    - src/backend/database/routes/identity-no-dormancy.test.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.put-disk.test.ts
decisions:
  - D-01/D-02/D-05/D-06 applied across all 8 route files: fleet tree, no dual-path
  - relay-pointer WHITELIST_REGEX: hard D-06 cutover with Test 4d rejection assertion
  - runbooks-editor ROLE_ROOT_REL constant change propagates to 7 composition sites atomically
metrics:
  duration: "~14 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 18
---

# Phase 96 Plan 02: Wave 2 — Backend routes path rewrite (fleet tree)

**One-liner:** Fleet tree SSH command string rewrite across 8 backend route files including the WHITELIST_REGEX security gate in relay-pointer.ts, with ROLE_ROOT_REL constant fix in runbooks-editor.ts propagating to 7 usage sites.

---

## Task 1: relay-pointer.ts WHITELIST_REGEX (security gate)

### Source file edits (relay-pointer.ts)

| Location | Before | After | Type |
|----------|--------|-------|------|
| Line 42 (WHITELIST_REGEX) | `\.claude\/identities\/` in pattern | `fleet\/identities\/` | REWRITE |
| Lines 4-5 (header comment) | `~/.claude/identities/<id>/relay-state/...` | `~/fleet/identities/<id>/relay-state/...` | PROSE |
| Lines 31-32 (whitelist comment) | `~/.claude/identities/` shape | `~/fleet/identities/` shape | PROSE |
| Lines 40-41 (added comment) | — | D-06 hard-cutover note added | PROSE |

**WHITELIST_REGEX before:**
```
/^\/home\/[a-z0-9_-]+\/\.claude\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt$/
```

**WHITELIST_REGEX after:**
```
/^\/home\/[a-z0-9_-]+\/fleet\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt$/
```

All anchors (`^...$`), character classes, file-extension suffix (`\.txt$`), and segment semantics preserved. Only `.claude/` path prefix changed to `fleet/`.

### Test file edits (relay-pointer.test.ts)

| Location | Change |
|----------|--------|
| Test 1 accept paths | `/home/ubuntu/.claude/identities/...` → `/home/ubuntu/fleet/identities/...` |
| Test 2 dot-dot path | Fleet path prefix used |
| Test 4 wrong suffix | Fleet path prefix used |
| Test 4b uppercase user | Fleet path prefix used |
| Test 4c traversal in identity name | Fleet path prefix used |
| Test 4d (NEW) | D-06 hard-cutover: explicit assertion `WHITELIST_REGEX.test(".claude/identities/...")` → `false` |
| Tests 5-11 function call paths | 8 occurrences of `/home/ubuntu/.claude/identities/tina/...` → `fleet/identities/tina/...` |

**D-06 gate:** Test 4d explicitly asserts that the legacy `.claude/identities` path shape returns `false` from WHITELIST_REGEX, documenting the Phase 96 hard-cutover.

### Verification
- `grep -c "fleet/identities" relay-pointer.ts` → 2 (WHITELIST_REGEX body + comment)
- `grep -c "\.claude/identities" relay-pointer.ts | grep -v '//'` → 0 (only in D-06 comments)
- `npx vitest run relay-pointer.test.ts` → **14/14 tests pass** (including new Test 4d)

---

## Task 2: runbooks-editor.ts + 7 route files + 9 test files

### Per-file source edit summary

| File | Live-code literals rewritten | Comment/prose updates |
|------|-----------------------------|-----------------------|
| `runbooks-editor.ts` | 1 (ROLE_ROOT_REL constant) | 4 (header comment + JSDoc + JSOC + inline comment) |
| `identity-birth-orchestrator.ts` | 2 (lines 1073, 1133) | 8 (comment lines 145, 180, 273, 468, 865, 1039, 1089, 1197) |
| `identity-clone.ts` | 4 (lines 537, 569, 573, 707) | 4 (lines 46, 50-51, 264, 415) |
| `roles-create.ts` | 5 (lines 462, 486, 490, 545, 573) | 3 (lines 11, 25, 270) |
| `roles-list-for-host.ts` | 2 (lines 153, 186) | 2 (lines 9, 106) |
| `identity-exists-on-host.ts` | 1 (line 133) | 2 (lines 8, 10) |
| `identity-no-dormancy.ts` | 3 (lines 123, 227, 228) | 1 (line 11) |
| `identities.ts` | 2 (lines 701, 736) | 1 (line 33) |

**Total live-code literals rewritten:** 20 across 8 source files  
**Total comment/prose updates:** 25 across 8 source files  

**Key leverage points:**
- `runbooks-editor.ts ROLE_ROOT_REL = "fleet/roles"` propagates through 7 composition sites (`${remoteHome}/${ROLE_ROOT_REL}/${role}`) at lines 318, 477, 641, 864, 1070, 1268, 1435 automatically
- `identity-birth-orchestrator.ts` line 1133 `identityDir` variable change propagates through lines 1134 + 1140 automatically

### Per-file test edit summary

| Test file | Assertions bumped |
|-----------|------------------|
| `identity-birth-orchestrator.test.ts` | 4 (lines 1293, 1867-1868, 1900, 2111-2119) |
| `identity-birth-orchestrator.role-frontmatter.test.ts` | 3 (lines 283-284, 334, 342) |
| `identity-clone.test.ts` | 1 (line 547) |
| `roles-create.test.ts` | 2 (lines 513, 660) + 1 comment |
| `runbooks-editor.test.ts` | 4 (lines 609, 749, 845, 938) — deviation, see below |
| `identity-exists-on-host.test.ts` | 1 (line 346) |
| `identity-no-dormancy.test.ts` | 2 (lines 483, 501) |
| `identities.put-disk.test.ts` | 2 (lines 619, 870) |

### Verification
- All 8 source files: non-comment grep for `\.claude/(identities|roles)` → 0
- `runbooks-editor.ts` contains `ROLE_ROOT_REL = "fleet/roles"`
- `identity-birth-orchestrator.ts` constructs `identityDir` from `${remoteHome}/fleet/identities/${opts.name}`
- `npx vitest run src/backend/database/routes/` → **825 tests pass** across 41 of 42 test files

### Pre-existing failure (out of scope)
`relay-room-create.test.ts` — 8 tests fail pre-existing before any of this plan's changes. Confirmed by stash-revert test. No `.claude/identities` or `.claude/roles` references in that file. Not touched by this plan.

---

## Files Audited but Not Modified

| File | Reason |
|------|--------|
| `identity-birth-orchestrator.mxid-derivation.test.ts` | Orchestrator-resolved-Q3: zero fixture path assertions for identity/role paths. Confirmed by grep. |
| `identity-birth-orchestrator.role-frontmatter.test.ts` | Initially listed as "audit first" — grep revealed functional assertions at lines 284, 334, 342. Updated (see Task 2 test summary above). |

---

## Deviations from Plan

### Deviation 1 [Rule 2 - Auto-fix] runbooks-editor.test.ts required path-string updates

**Found during:** Task 2 test run
**Issue:** Plan's `files_modified` frontmatter did not list `runbooks-editor.test.ts` but the ROLE_ROOT_REL constant change caused 12 test failures at lines 609, 749, 845, 938 — all path-string assertions that expected the old `.claude/roles` prefix.
**Fix:** Applied the same fleet-path replacement (`/home/testuser/.claude/roles/` → `/home/testuser/fleet/roles/`) to 4 occurrences.
**Files modified:** `runbooks-editor.test.ts`
**Commit:** d8c4b1e0 (included in Task 2 commit)

### Deviation 2 [Rule 2 - Auto-fix] identity-birth-orchestrator.role-frontmatter.test.ts required updates

**Found during:** Task 2 planning/grep audit
**Issue:** Plan said "grep first; rewrite fixture assertions only if present." Grep confirmed real path assertions at lines 284, 334, 342 (plan's resolved-Q3 had only cleared the mxid-derivation test, not the role-frontmatter test).
**Fix:** Updated 3 assertions + 3 comment lines to fleet paths.
**Files modified:** `identity-birth-orchestrator.role-frontmatter.test.ts`
**Commit:** d8c4b1e0

### Pre-existing TypeScript build error (not caused by this plan)

`src/backend/database/routes/identity-birth-orchestrator.ts(886,20): error TS2339: Property 'hostId' does not exist` — confirmed pre-existing by Wave 1 SUMMARY.md. Build check run with `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` — no new TS errors introduced by this plan.

---

## Known Stubs

None. All edits are exact-string path rewrites. No placeholder values or TODO markers introduced.

---

## Threat Flags

No new security-relevant surface introduced. The WHITELIST_REGEX rewrite (T-96-04) strengthens the gate by removing the legacy `.claude/identities` path prefix from the admitted set — the old prefix is now a hard-reject (D-06). All existing anchors, character classes, and rejection logic preserved.

---

## Self-Check: PASSED

- [x] relay-pointer.ts: `grep -c "fleet/identities"` → 2; no live-code `.claude/identities` hits
- [x] All 8 source files: non-comment grep for `.claude/(identities|roles)` → 0
- [x] runbooks-editor.ts contains `ROLE_ROOT_REL = "fleet/roles"`
- [x] identity-birth-orchestrator.ts line 1133: `identityDir = ${remoteHome}/fleet/identities/${opts.name}`
- [x] Task 1 commit bf8569a2 exists
- [x] Task 2 commit d8c4b1e0 exists
- [x] 14 tests pass (relay-pointer.test.ts) — includes new Test 4d D-06 rejection assertion
- [x] 825 tests pass across 41 of 42 test files in routes/ suite
- [x] 8 pre-existing failures in relay-room-create.test.ts (confirmed pre-existing by stash-revert)
- [x] TS build: only pre-existing TS2339 at identity-birth-orchestrator.ts:886
