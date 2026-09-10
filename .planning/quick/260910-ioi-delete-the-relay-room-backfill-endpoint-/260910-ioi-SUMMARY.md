---
phase: quick-260910-ioi
plan: 01
status: complete
subsystem: backend/relay-sessions + backend/database
tags: [quick, delete, backfill, registry-rooms, cleanup]
requires: []
provides: []
affects:
  - src/backend/database/database.ts (removed 1 import + 1 mount + 5-line comment block)
  - src/backend/relay-sessions/observation-loop-starter.ts (rewrote D-12 docblock section + deleted 6-line sub-comment)
  - src/backend/relay-sessions/observation-loop-starter.test.ts (removed runRegistryRoomsBackfill mock/hoist/reset/default + 2 assertions + rewrote top-of-file docblock)
  - src/backend/database/routes/users.ts (rewrote D-11 hook comment block + refreshed import comment)
  - src/backend/database/routes/identity-birth-orchestrator.ts (rewrote D-11 hook comment block + refreshed import comment)
deleted:
  - src/backend/database/routes/relay-registry-backfill.ts
  - src/backend/database/routes/relay-registry-backfill.test.ts
  - src/backend/relay-sessions/registry-rooms-backfill.ts
  - src/backend/relay-sessions/registry-rooms-backfill.test.ts
  - src/backend/relay-sessions/enumerate-agent-mxids.ts
  - src/backend/relay-sessions/enumerate-agent-mxids.test.ts
tech-stack:
  added: []
  patterns: [surface-removal, docblock-alignment-to-source-of-truth]
key-files:
  created: []
  deleted:
    - src/backend/database/routes/relay-registry-backfill.ts
    - src/backend/database/routes/relay-registry-backfill.test.ts
    - src/backend/relay-sessions/registry-rooms-backfill.ts
    - src/backend/relay-sessions/registry-rooms-backfill.test.ts
    - src/backend/relay-sessions/enumerate-agent-mxids.ts
    - src/backend/relay-sessions/enumerate-agent-mxids.test.ts
  modified:
    - src/backend/database/database.ts
    - src/backend/relay-sessions/observation-loop-starter.ts
    - src/backend/relay-sessions/observation-loop-starter.test.ts
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
decisions:
  - "Deleted `POST /relay-room/backfill` endpoint + `runRegistryRoomsBackfill` utility + orphan `enumerateAgentMxids` helper wholesale. Per Ashley 2026-09-10: backfill of pre-existing users/agents into the registry rooms is FULLY MANUAL (SSH-based dance if ever needed). Removes dead-and-brittle in-process surface + its docblock/runbook noise. D-11 mint hooks in `registry-rooms.ts` remain intact so new accounts still auto-join on create."
  - "Rewrote all D-12 docblock/comment references in five active files to the new source of truth ('no in-process backfill path; SSH dance if ever needed; D-11 mint hooks cover all new accounts'). This is the substantive point of the cleanup — the deleted files were already MANUAL per prior refinement; this quick task removes the utility surface entirely so the code and its comments finally agree."
  - "Extended docblock/comment rewrite scope by two small edits beyond the plan's explicit line ranges to preserve consistency: the parenthetical at `observation-loop-starter.ts:116-117` (previously 'D-12 backfill is manual per instance-deployer; see module docblock' — after the docblock rewrite it no longer said 'D-12', so this stale pointer was updated to match the new docblock language) and the import comment at `users.ts:44-46` + `identity-birth-orchestrator.ts:32-34` (previously said 'backfill is the safety net' — factually wrong post-deletion). All within Task 2's declared purpose of pruning dangling refs + docblock cleanup; verified by all three gates."
  - "Preserved the two string literals 'best-effort per D-12' inside `authLogger.warn(...)` / `databaseLogger.warn(...)` messages at `users.ts:354` / `users.ts:366` / `identity-birth-orchestrator.ts:807` / `identity-birth-orchestrator.ts:818`. Plan constraint: 'Do NOT change the try/catch body — only the comment above it.' These are runtime log messages inside the try/catch bodies, not comments; touching them would violate the constraint AND change grep-able structured-log surface for anyone monitoring these events."
metrics:
  duration_min: 15
  completed: 2026-09-10
---

# Quick 260910-ioi: Delete /relay-room/backfill endpoint + runRegistryRoomsBackfill utility + orphan enumerator — Summary

## One-liner

Deleted the `POST /relay-room/backfill` HTTP endpoint, its `runRegistryRoomsBackfill` utility, and the fully-orphan `enumerateAgentMxids` helper (6 files removed); pruned all dangling imports, mounts, mocks, and D-12 docblock references from the 5 remaining source files that touched them. Backfill of pre-existing users/agents into the registry rooms is now FULLY MANUAL (SSH dance if ever needed) — there is no in-process path. D-11 mint hooks in `registry-rooms.ts` remain untouched so new accounts still auto-join on create.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `1d106691` | `chore(quick-260910-ioi): delete /relay-room/backfill endpoint + runRegistryRoomsBackfill utility + orphan enumerate-agent-mxids` |
| 2 | `6be74b9a` | `chore(quick-260910-ioi): prune dangling refs after backfill deletion (imports, mounts, mocks, docblocks)` |

Both commits on `feat/tab-title-from-tmux`. HEAD `6be74b9a` LOCAL — NOT pushed / NOT built / NOT deployed per code-work-doesn't-authorize-ship rule.

Commit 1: 6 files changed, 1406 deletions(-). Commit 2: 5 files changed, 32 insertions(+), 79 deletions(-).

## Files deleted (6)

1. `src/backend/database/routes/relay-registry-backfill.ts` — HTTP route file for `POST /relay-room/backfill`
2. `src/backend/database/routes/relay-registry-backfill.test.ts` — route test
3. `src/backend/relay-sessions/registry-rooms-backfill.ts` — `runRegistryRoomsBackfill` utility
4. `src/backend/relay-sessions/registry-rooms-backfill.test.ts` — utility test
5. `src/backend/relay-sessions/enumerate-agent-mxids.ts` — zero-caller orphan helper
6. `src/backend/relay-sessions/enumerate-agent-mxids.test.ts` — orphan helper test

Deletion via `git rm` (all six staged in a single deletions-only commit for reviewability).

## Files edited (5)

**`src/backend/database/database.ts`** (commit 2)
- Deleted line 84 import: `import relayRegistryBackfillRoutes from "./routes/relay-registry-backfill.js";`
- Deleted the 6-line mount block at lines 1964-1969 (5 lines of admin one-shot comment + the `app.use("/relay-room", relayRegistryBackfillRoutes);` mount).
- Kept the surrounding `app.use("/relay-room", relayRoomParticipantsRoutes);` (above) and `app.use("/user-preferences", userPreferencesRoutes);` (below) exactly as-is.

**`src/backend/relay-sessions/observation-loop-starter.ts`** (commit 2)
- Replaced the `## D-12 backfill is MANUAL per instance-deployer` docblock section (18 lines) with a 10-line `## Backfill is fully manual (SSH-based dance if ever needed)` section reflecting the new source of truth (Ashley 2026-09-10: no in-process path; D-11 mint hooks cover new accounts).
- Deleted the 6-line sub-comment at lines 63-68 that referenced `./registry-rooms-backfill.js` and "SUMMARY.md § Manual backfill runbook" — that import is no longer here and the utility no longer exists.
- Replaced the parenthetical at lines 116-117 (was `(Auto-backfill DELIBERATELY OMITTED — D-12 backfill is manual per instance-deployer; see module docblock.)`) with a 3-line version aligned to the rewritten docblock (`(No in-process backfill step — see module docblock; if pre-existing accounts ever need adding, the instance-deployer does it manually via SSH.)`). This was a small extension beyond the plan's declared line ranges to preserve doc consistency — the old text pointed to a docblock section that no longer said "D-12".
- Kept the imports for `ensureRegistryRoomsExist` and `getAgentsRegistryRoomId` from `./registry-rooms.js` exactly as-is.

**`src/backend/relay-sessions/observation-loop-starter.test.ts`** (commit 2)
- Deleted the hoisted mock handle `mockRunRegistryRoomsBackfill` from the `vi.hoisted(() => ({...}))` block AND from the destructuring immediately below.
- Deleted the entire `vi.mock("./registry-rooms-backfill.js", () => ({ runRegistryRoomsBackfill: hoisted.mockRunRegistryRoomsBackfill }));` block (3 lines).
- Deleted `mockRunRegistryRoomsBackfill.mockReset();` from `beforeEach`.
- Deleted the 7-line `mockRunRegistryRoomsBackfill.mockResolvedValue({...})` default-happy-path block from `beforeEach`.
- Test 1: deleted the 3-line docblock/comment about the regression guard AND the `expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();` assertion. Shortened Test 1's `it()` description string per plan spec — new description: `"Test 1: happy path — ensure → enumerate → loop.start called in order"`.
- Test 2: deleted the `expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();` assertion. Kept surrounding assertions (mockLoopStart not called, `result.ok` false, `reason === 'creds_missing'`).
- Test 3: verified it doesn't reference `mockRunRegistryRoomsBackfill` — no edit needed.
- Rewrote the top-of-file docblock: dropped the "Auto-backfill is DELIBERATELY OMITTED" sentence + the "registry-rooms-backfill mock is retained..." sentence; replaced with a single sentence matching the new source of truth.

**`src/backend/database/routes/users.ts`** (commit 2)
- Replaced the 5-line D-11-hook comment block above the try/catch at line 341 with a 7-line block per plan spec — removes D-12 language, removes "Manual backfill runbook" reference; keeps the "hook fires AFTER the INSERT transaction commits and BEFORE forceSave" invariant note.
- Refreshed the 3-line import comment at line 44 above `import { joinHumanToHumansRegistry }` (was "Best-effort per D-12 — a failed join does NOT fail the create; backfill is the safety net" — factually wrong post-deletion; now says "there is no in-process backfill safety net (backfill is fully manual, SSH-based)"). Small extension beyond the plan's declared line range — same purpose (docblock alignment to source of truth) and required to prevent the tree from carrying a stale claim.
- Did NOT change the try/catch body — the 4-line `authLogger.warn` string literals at lines 354/366 still contain "best-effort per D-12" text. These are runtime log messages, not comments; touching them would violate the plan's explicit constraint AND change grep-able structured-log surface. Any future runbook rename can update them as a separate concern.

**`src/backend/database/routes/identity-birth-orchestrator.ts`** (commit 2)
- Replaced the 7-line D-11-hook comment block above the try/catch at line 795 with a 5-line block per plan spec — same shape as the users.ts edit.
- Refreshed the 3-line import comment at line 32 above `import { joinAgentToAgentsRegistry }` — same rationale as users.ts (was "backfill is the safety net" — factually wrong; now says "no in-process backfill safety net (SSH-based dance)").
- Did NOT change the try/catch body — string literals at lines 807/818 still contain "best-effort per D-12" text. Same reasoning as users.ts.

## Verification gates

All three post-change gates pass:

### Gate 1 — grep-zero orphan refs

```
$ grep -rn "runRegistryRoomsBackfill\|registry-rooms-backfill\|enumerate-agent-mxids\|relay-registry-backfill" src/
$ echo "count: $(grep -rn '...' src/ | wc -l)"
count: 0
```

Zero hits anywhere in `src/` for any of the four orphan patterns.

### Gate 2 — TypeScript clean

```
$ npx tsc --noEmit
$ echo "exit=$?"
exit=0
```

No output, exit code 0 (project-wide clean).

### Gate 3 — relay-sessions vitest suite green

```
$ npx vitest run src/backend/relay-sessions/
 Test Files  6 passed (6)
      Tests  65 passed (65)
   Duration  1.71s
$ echo "exit=$?"
exit=0
```

All 6 test files, 65 tests pass (down from 7 files / test count before deletion — the 2 deleted test files removed their tests, and the observation-loop-starter test now has one fewer assertion in Tests 1+2 but keeps all 3 test blocks).

### Regression guard — D-11 mint hooks still wired

```
$ grep -n "joinHumanToHumansRegistry\|joinAgentToAgentsRegistry" \
    src/backend/database/routes/users.ts \
    src/backend/database/routes/identity-birth-orchestrator.ts
identity-birth-orchestrator.ts:35: import { joinAgentToAgentsRegistry } from "../../relay-sessions/registry-rooms.js";
identity-birth-orchestrator.ts:802:      const joinResult = await joinAgentToAgentsRegistry(mxid);
users.ts:47: import { joinHumanToHumansRegistry } from "../../relay-sessions/registry-rooms.js";
users.ts:349:      const joinResult = await joinHumanToHumansRegistry(mintedMxid);
```

Both mint hooks still imported from `registry-rooms.js` (untouched base module) and still invoked inside their respective `try{...}` blocks. The observation loop's boot sequence in `observation-loop-starter.ts` still runs `ensureRegistryRoomsExist → enumerate users → loop.start` — untouched.

## Constraint compliance

- **Zero `git stash` invocations at any point.** Used direct file reads (`Read` tool) for all baseline context; no `git stash`, `git stash push`, `git stash pop`, `git stash apply`, or `git stash drop` invoked. Recovered from zero sibling-worktree contamination events (there were none because zero stash operations happened).
- **Zero destructive git commands.** No `git clean`, `git reset --hard`, `git checkout -- .`, `git restore .`, `git rm` on unrelated files, or protected-ref rewinds.
- **Scope discipline.** Exactly the 11 files listed in the plan touched (6 deleted + 5 edited). `registry-rooms.ts` (base D-11 mint-hook module) untouched — verified.
- **No .planning/ files in the two code commits.** Both commits are pure `src/` changes; `.planning/` is bundled into the follow-up docs commit per the plan's atomicity discipline.

## Reminder

Backfill of pre-existing users/agents into the registry rooms is now fully manual (SSH-based dance if ever needed) — there is no in-process path. Between deploy and any manual backfill, pre-existing accounts are NOT in the registry rooms and the classifier's D-09 fallthrough conservatively materializes their two-party DMs. The D-11 mint hooks (`registry-rooms.ts`) cover ALL new accounts from create onward, automatically.

## Self-Check: PASSED

- All 6 target files deleted from working tree: verified via `test ! -e` for each.
- All 5 target files edited: staged + committed in `6be74b9a` (git status showed 5 M lines before commit).
- Both commits present in git log: `1d106691` (Task 1) + `6be74b9a` (Task 2).
- `registry-rooms.ts` untouched: `git diff HEAD~2 -- src/backend/relay-sessions/registry-rooms.ts | wc -l` = 0.
- D-11 mint hooks still exported from `registry-rooms.ts`: `grep -c "export.*joinAgentToAgentsRegistry\|export.*joinHumanToHumansRegistry"` = 2.
- All three verification gates green.
