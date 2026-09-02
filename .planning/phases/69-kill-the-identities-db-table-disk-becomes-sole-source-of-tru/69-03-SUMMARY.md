---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
plan: "03"
subsystem: identity-birth identity-clone
tags: [db-removal, disk-authoritative, tdd, birth, clone, phase-69]
dependency_graph:
  requires: [69-01, 69-02]
  provides: [no-db-inserts-in-birth-or-clone, phase68-publicidentity-in-clone]
  affects: [identity-birth.ts, identity-birth-orchestrator.ts, identity-clone.ts, birth-tests, clone-tests]
tech_stack:
  added: []
  patterns: [disk-authoritative-identity, ssh-collision-probe, re-read-for-response]
key_files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/identity-birth.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
    - src/backend/database/routes/identity-clone.test.ts
decisions:
  - "SHAPE B chosen for Step 1 collision probe: SSH connect hoisted before Step 1; Step 1 = avatar candidate check + SSH exec folder probe. SHAPE A (delete Step 1, rename steps) rejected to avoid frontend BIRTH_STEP_LABELS update in this wave."
  - "identityId in ended event now carries opts.name (identityKey). Wave 3 follow-up: CloneAgentDialog.tsx passes result.id currently — must update to result.identityKey."
  - "publicIdentity() in identity-clone.ts rewritten to 10-field Phase 69 shape with disk re-read cosmetics; no id/createdAt/updatedAt."
  - "capitalizeFirst duplicated locally in identity-clone.ts (circular-import avoidance, precedent from Phase 66 Plan 04)."
metrics:
  duration: "~2 hours (cross-session)"
  completed: "2026-09-02T03:11:00Z"
  tasks_completed: 2
  files_changed: 7
---

# Phase 69 Plan 03: Birth + Clone DB Removal Summary

Birth and clone flows rewired to disk-only. Both flows no longer INSERT into the identities table. Disk folder + frontmatter + avatar sibling ARE the identity's record. This is the precondition for Wave 4's DROP TABLE.

## Tasks Completed

### Task 1: Rewire identity-birth.ts + identity-birth-orchestrator.ts

**TDD cycles:** RED (d1238696) → GREEN (1307c84b)

**What changed:**

identity-birth-orchestrator.ts:
- `BirthDeps` interface: `createIdentityRecord` and `getIdentityRecord` callbacks removed entirely. JSDoc updated: "Phase 69: no DB record is created; disk folder + frontmatter + avatar sibling ARE the identity's identity."
- `const identityId = opts.name` moved to top of `birthIdentity()` — identityKey IS the identity handle.
- SSH connect hoisted before Step 1 (SHAPE B): `resolveHostById` + `connectOneShot` run before `runStep(1, ...)`.
- Step 1 body rewired to: avatar candidate check + SSH exec `if [ -d "$HOME/.claude/identities/<name>" ]` probe. If folder exists → `throw "identity already exists on this host"`.
- SSH connect failure now emits step:1:failed (not step:2:failed) — consequence of SHAPE B.
- Final ended event unchanged in shape: `emit({ type: "ended", ok: true, identityId, sessionName: opts.name })` — identityId now carries opts.name (the identityKey).

identity-birth.ts:
- Deleted `createIdentityRecord()` helper function.
- Deleted `getIdentityRecord()` helper function.
- Removed `createIdentityRecord` and `getIdentityRecord` from the deps object assembly.
- Removed imports: `db` (from db/index), `identities` (from db/schema), `eq`, `and` (from drizzle-orm), `DatabaseSaveTrigger`.
- File shrank from ~325 lines to ~237 lines.

**Test changes (3 files):**
- `identity-birth-orchestrator.test.ts`: `makeDeps()` drops `createIdentityRecord` and `getIdentityRecord`. `makeOpts()` changed `userId: 1` → `userId: "user-1"` (string type). Test 3 rewritten: getCandidateForBirth called + no DB helpers. Test 4 rewritten: SSH exec "exists" → step:1:failed. Test 5 rewritten: ended.identityId = opts.name (not nanoid). Test 16 updated: SSH connect timeout → step:1:failed (SHAPE B).
- `identity-birth-orchestrator.role-frontmatter.test.ts`: Same `makeDeps()` narrowing + `userId` type fix. Test 16 (call ordering): tmux-new-session is first assertion (createIdentityRecord tracking removed).
- `identity-birth.test.ts`: DB mock simplified to stub (no functional in-memory shim). Test 5 deps assertions: `createIdentityRecord` and `getIdentityRecord` expected to be `undefined`.

### Task 2: Rewire identity-clone.ts

**TDD cycles:** RED (cec41976) → GREEN (faafd355)

**What changed:**

identity-clone.ts:
- Removed imports: `nanoid`, `db` (from db/index), `DatabaseSaveTrigger`, `identities` (from db/schema), `eq`, `and` (from drizzle-orm).
- Added imports: `readIdentityFile`, `extractCosmeticsFromFrontmatter`, `extractRoleFromMarkdown` (from identity-artifact-reader).
- `publicIdentity()` rewritten: new signature `(identityKey: string, hostId: number, cosmetics: {...} = {}, role: string | null = null)`. Returns 10-field Phase 69 shape (no id/createdAt/updatedAt). avatarUrl bakes hostId into query string: `/identities/${identityKey}/avatar?hostId=${hostId}`. `capitalizeFirst` kept as local duplicate.
- Source row DB lookup block (L388-402) removed. Replaced with comment: "Phase 69: source existence is verified by SSH — resolveRoleForIdentity throws if the identity's .md file is missing. That IS the source-existence check now."
- newName DB precheck block (L414-427) removed. Replaced with comment: "Phase 69: newName collision checked exclusively by SSH-side probe."
- DB INSERT block (L732-776) + UNIQUE-constraint race backstop removed.
- `DatabaseSaveTrigger.forceSave("identity_cloned")` call removed.
- Re-select block (L792-813) removed.
- Response rewritten: `readIdentityFile(conn, newName)` → `extractCosmeticsFromFrontmatter(writtenMd)` → `extractRoleFromMarkdown(writtenMd)` → `res.status(201).json(publicIdentity(newName, hostId, cosmetics, role))`. Fallback to `publicIdentity(newName, hostId, {}, sourceRole)` with `sshLogger.warn` if re-read fails (T-69-03-06 accept pattern).

**Test changes (1 file):**
- DB shim replaced with simple stubs (`db: {}`, `identities: {}`, `eq: vi.fn()`, `and: vi.fn()`).
- `stubSourceRow` removed.
- `DEFAULT_CLONE_MARKDOWN` constant added for disk re-read default.
- `beforeEach()`: `readIdentityFile`, `extractCosmeticsFromFrontmatter`, `extractRoleFromMarkdown` mocks added.
- Test 5 rewritten: source not found → `resolveRoleForIdentity` throws → 500.
- Test 8 rewritten: Phase 69 publicIdentity shape assertions (no id/createdAt/updatedAt, has role, disk re-read cosmetics). `readIdentityFile` called once.
- Test 9 rewritten: no DB assertions; `readIdentityFile` called once; `identityKey` in response.
- Test 13 rewritten: SSH-only collision (not DB precheck). `execCommand` mock returns "exists" for the `patty` probe.
- Test 18 updated: no DB state assertions; only `writeMarkdownFileAtomic` not-called assertion.

## SHAPE Decision

**SHAPE B chosen** for Step 1 collision probe. SHAPE A (delete Step 1, rename to 4 steps) would require updating `BIRTH_STEP_LABELS` and `BIRTH_STEP_BLURBS` in `NewSessionDialog.tsx` — touching frontend in a backend-scoped plan. SHAPE B (keep Step 1 as on-disk probe, hoist SSH connect) is drop-in compatible with the existing 5-step frontend.

**SHAPE B consequence:** SSH connect failure now emits step:1:failed instead of step:2:failed. Test 16 in the orchestrator test file was updated to match. The frontend renders all `step:N:failed` the same way (shows the step as failed in the checklist), so user-visible impact is zero.

**Wave 3 follow-up:** If BIRTH_STEP_LABELS/BIRTH_STEP_BLURBS are ever cleaned up to 4 entries (dropping the DB-bookkeeping step label), that's the time to revisit SHAPE A. Not blocking.

## identityId Semantics Change

The birth orchestrator's `ended` event now emits `identityId = opts.name` (the identityKey) instead of a nanoid DB primary key. The event shape is unchanged (`{ type: "ended", ok: true, identityId, sessionName }`); only the value of `identityId` changes.

**Wave 3 required follow-up:** `CloneAgentDialog.tsx` L320 currently passes `result.id` as the identity handle in the auto-route callback. This must be updated to `result.identityKey` (or however the consumer reads identityId from the ended event). Plan 69-04 includes a Task 4 audit tracing every consumer.

## DB Touch Sweep (All Zero Post-Plan)

```
grep -c "db.insert|db.select|db.update|db.delete" identity-birth.ts        → 0
grep -c "db.insert|db.select|db.update|db.delete" identity-birth-orchestrator.ts → 0
grep -c "db.insert|db.select|db.update|db.delete" identity-clone.ts        → 0
```

## Test Results

75 tests passing across 4 files:
- `identity-birth.test.ts`: all pass
- `identity-birth-orchestrator.test.ts`: all pass
- `identity-birth-orchestrator.role-frontmatter.test.ts`: all pass
- `identity-clone.test.ts`: 20 tests pass

`npx tsc --noEmit`: clean (no output).

## Deviations from Plan

None — plan executed exactly as written. SHAPE B was the selected option per the executor decision rule.

## Wave 4 Handoff

With birth + clone + share (deleted in 69-01) all pruned of INSERT calls, the identities table has **zero live writers**. The table remains in the schema but nothing writes to it. Safe to DROP TABLE in Wave 4 (plan 69-05).

## Self-Check: PASSED

All key files found. All 4 commits verified:
- d1238696: test(69-03): RED — birth flow, drop DB helpers
- 1307c84b: feat(69-03): GREEN — birth flow, disk-only
- cec41976: test(69-03): RED — clone flow, disk-only
- faafd355: feat(69-03): GREEN — clone flow, disk-only
