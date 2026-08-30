---
phase: quick-260823-bap
plan: 01
subsystem: fleet-status/recency
tags: [predicate-inversion, lastMessageAt, tdd, ashley-lock-2026-08-23]
decisions:
  - "isAshleyRealUserTurn returns {ok:true, ts} | {ok:false} to avoid double JSON.parse on the keep path"
  - "parseSessionLine no longer used in scanTailForNewestMessageAt (removed import from ssh-poll-orchestrator.ts)"
  - "Byte-parallel discipline preserved: isAshleyRealUserTurn function bodies are textually identical at both sites (diff is empty)"
metrics:
  duration: "~25 min"
  completed: "2026-08-23"
  tasks_completed: 3
  files_modified: 4
key_files:
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/database/routes/sessions.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/database/routes/sessions.test.ts
---

# Phase quick-260823-bap Plan 01: Ashley 2026-08-23 msg-only-recency Predicate Summary

**One-liner:** Replaced `MESSAGE_BEARING_KINDS` kind-set predicate with `isAshleyRealUserTurn` at both JSONL tail-scan sites, inverting recency signal from "message either direction" to "only Ashley's real outbound user turns."

## Commits

| Task | Commit | Message |
|------|--------|---------|
| RED  | `ddf49380` | `test(quick-260823-bap): RED — Ashley 2026-08-23 msg-only-recency predicate matrix` |
| GREEN | `496f8646` | `feat(quick-260823-bap): GREEN — Ashley 2026-08-23 msg-only-recency predicate at both sites` |
| Invert | `5fcb9a95` | `test(quick-260823-bap): invert existing tests to Ashley 2026-08-23 msg-only-recency lock` |

## Test Count Delta

- **New tests added (Task 1):** 8 per file × 2 files = **16 new tests total** (7 predicate-matrix cases + 1 mixed-tail integration per file)
- **Existing tests inverted (Task 3):**
  - `ssh-poll-orchestrator.test.ts`: Test D (renamed), Test H (fixture changed), aiTitle Test 3 corroboration, aiTitle Test 5 corroboration — **4 tests updated**
  - `sessions.test.ts`: Test 1, Test 2, Test 3 (discovery throws/hangs), Test 5 — **4 tests updated**
  - Total inverted: **8 tests**
- **Existing tests unchanged:** 84 tests
- **Final suite:** 108 tests, all passing

## Predicate Behavior (Ashley 2026-08-23 lock)

```
isAshleyRealUserTurn(rawLine) → {ok: true, ts} | {ok: false}

Returns {ok:true, ts} iff ALL:
  1. rawLine.trim() non-empty AND parseable as JSON
  2. top-level type === "user"
  3. message.content is a plain string (typeof === "string")
  4. Either:
     (a) trimmed content starts with "<command-" → KEEP
     (b) NOT (trimmed content starts with "<" AND ends with ">") → KEEP
  Otherwise → {ok: false}
```

## Verification Checks

### MESSAGE_BEARING_KINDS deleted
`grep -rn 'MESSAGE_BEARING_KINDS' src/` → 0 hits in production files (3 hits in test comments — expected).

### isAshleyRealUserTurn present at both sites
- `ssh-poll-orchestrator.ts`: 3 occurrences (docblock + helper decl + scanTail call)
- `sessions.ts`: 4 occurrences (docblock + helper decl + scanTail call + comment)

### Docblocks cite 2026-08-23 lock
- `ssh-poll-orchestrator.ts`: 2 occurrences of "Ashley 2026-08-23 lock"
- `sessions.ts`: 3 occurrences of "Ashley 2026-08-23 lock"

### Byte-parallel discipline
`diff <(sed -n '/function isAshleyRealUserTurn/,/^}/p' ssh-poll-orchestrator.ts) <(sed -n '/function isAshleyRealUserTurn/,/^}/p' sessions.ts)` → empty diff (implementations identical).

### Test cite Ashley 2026-08-23 lock
- `ssh-poll-orchestrator.test.ts`: 12 occurrences
- `sessions.test.ts`: 13 occurrences

## Deviations from Plan

### Implementation deviation: {ok, ts} return shape

The plan (Task 2 step (c)) suggested refactoring the helper to return `{ok: true, ts: number} | {ok: false}` to avoid double JSON.parse. This was implemented exactly as described. The helper name remains `isAshleyRealUserTurn` per the plan's instruction ("the object return is the internal contract, the semantic name stays").

### parseSessionLine import removed

`parseSessionLine` was imported in `ssh-poll-orchestrator.ts` but only used in the now-replaced `scanTailForNewestMessageAt` (via `MESSAGE_BEARING_KINDS`). After the swap, `parseSessionLine` was no longer called anywhere in the file, so the import was removed. `detectIdReset` (co-imported from the same module) is still used in `scanTailForLayer1RecyclingSignal` and retained.

In `sessions.ts`, the `parseSessionLine` import was also removed (it was only used in `scanTailForNewestMessageAt`).

### RED state: 4 new failures (not 14+)

The plan anticipated "at least 7 new failing tests per file (14+ new failures total)" because it expected all 7-8 new tests to fail with the old predicate. In practice, many new tests PASS with the old predicate by coincidence:
- Cases 3 and 4 (task-notification, system-reminder): already dropped by `parseSessionLine` returning `kind:"skip"` → old predicate also drops them → tests pass coincidentally
- Case 5 (tool_result list): already dropped by `parseSessionLine` → old predicate also drops it → test passes coincidentally
- Cases 1 and 2 (typed prose, slash-command): correctly counted by old predicate → KEEP tests pass
- Mixed-tail: T2 is KEEP under both predicates → passes coincidentally

Only Cases 6 (skill-body list → old code wrongly counted via kind:"message") and Case 7 (assistant turn → old code wrongly counted) truly fail in RED state (2 per file = 4 total). This is valid RED: these 4 failures represent the exact behavioral differences the new predicate introduces.

### Test H fixture change

Test H (stale-tail rediscovery threshold) used `jsonlMessageLine(1000, "assistant", "one and done")` to seed the "HAD a signal" state. After the predicate change, assistant turns don't count → `derivedLastMessageAt` stays null → stale counter never increments → discovery never refires. The fixture was changed to `jsonlMessageLine(1000, "user", "one and done")` so the test still validates the stale-tail threshold mechanism.

## Known Stubs

None.

## Threat Flags

None — this change only modifies an internal predicate function; no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Pre-existing Test Files Outside Scoped Files

Several test files use assistant message fixtures but were NOT in scope (Ashley 2026-08-20 directive: full-suite is the orchestrator's ship-gate, not the executor's job). The following files likely have tests that assert on `lastMessageAt` derived from assistant turns and may fail at ship-gate:

- Any test file that exercises `scanTailForNewestMessageAt` behavior indirectly (not in the two scoped files) with assistant-only fixtures.

Flagged for orchestrator ship-gate review. The two scoped files are clean (108/108 passing).

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` exists and contains `isAshleyRealUserTurn`: FOUND
- `src/backend/database/routes/sessions.ts` exists and contains `isAshleyRealUserTurn`: FOUND
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` exists and contains new describe block: FOUND
- `src/backend/database/routes/sessions.test.ts` exists and contains new describe block: FOUND
- Commit `ddf49380` (RED): FOUND
- Commit `496f8646` (GREEN): FOUND
- Commit `5fcb9a95` (invert): FOUND
- All 108 scoped tests pass: CONFIRMED
