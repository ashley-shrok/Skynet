---
phase: quick-260829-nzn
plan: "01"
subsystem: fleet-status/sessions
tags: [predicate, recency, conversation-list, byte-parallel]
dependency_graph:
  requires: []
  provides: [isAshleyRealUserTurn-2026-08-29-refinement]
  affects: [conversation-list-ordering, lastMessageAt]
tech_stack:
  added: []
  patterns: [byte-parallel predicate copies, TDD predicate matrix]
key_files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/database/routes/sessions.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/database/routes/sessions.test.ts
decisions:
  - Prefix-anchored sentinel check (startsWith) rather than includes to avoid matching quoted mentions in real Ashley prose
  - Control-char check operates on trimmed t (regular whitespace already stripped) for minimal surface
  - /exit check on raw content (not trimmed) so the substring match is reliable regardless of leading space
metrics:
  duration_seconds: 320
  completed: "2026-08-29"
  tasks_completed: 2
  files_changed: 4
---

# Phase quick-260829-nzn Plan 01: Tighten isAshleyRealUserTurn Predicate Summary

**One-liner:** Three 2026-08-29 exclusion gates (Ctrl-C kill, /exit slash-command, resumed-injection sentinel) added to isAshleyRealUserTurn in both byte-parallel copies to fix spurious recency inflation on Tabitha's conversation row.

## What Was Built

The `isAshleyRealUserTurn` predicate had three harness-injected shapes that passed all existing gates and spuriously bumped `lastMessageAt`, floating agents Ashley hadn't messaged in days to the top of the conversation list:

1. **Ctrl-C kill signal** (`"\x03\x03"`) — delivered by the supervisor as plain-string content; was passing the XML-wrapper gate because it is not an XML wrapper.
2. **`/exit` slash-command** — agent-supervisor fires this before recycle; content starts with `<command-` so the existing `isCommand` check kept it alive.
3. **Resumed-injection sentinel** — supervisor injects `"Your session was just resumed by the agent-supervisor…"` as `type:"user"` in some code paths.

Both copies of the predicate (canonical in `ssh-poll-orchestrator.ts`, byte-parallel in `sessions.ts`) were updated with three new Step 5/6/7 gates inserted after the existing XML-wrapper exclusion (Step 4) and before the `rawTs` extraction.

Both docblocks were extended with a 2026-08-29 refinement paragraph listing all three new exclusions with one-line rationales.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add three new exclusions + refresh docblocks | 86d28678 | ssh-poll-orchestrator.ts, sessions.ts |
| 2 | Add mirrored predicate-matrix cases (8, 9, 10) to both test files | 86d28678 | ssh-poll-orchestrator.test.ts, sessions.test.ts |

Note: Both tasks landed in the same commit per byte-parallel discipline requirement.

## Test Results

- Baseline: 124 tests passing
- After changes: 132 tests passing (+8 new)
- Scoped gate: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts` — all green
- TypeScript: `tsc --noEmit` clean, zero new errors

## Byte-Parallel Verification

```
diff <(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/fleet-status/ssh-poll-orchestrator.ts) \
     <(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/database/routes/sessions.ts)
# → zero output (BYTE-PARALLEL OK)
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — predicate change is purely filter-tightening with no new network surface, auth paths, or schema changes.

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — modified, contains three new gates
- `src/backend/database/routes/sessions.ts` — modified, byte-parallel
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — modified, Cases 8/9/10 + positive regressions + extended Mixed-tail
- `src/backend/database/routes/sessions.test.ts` — modified, identical test additions
- Commit `86d28678` exists in git log
