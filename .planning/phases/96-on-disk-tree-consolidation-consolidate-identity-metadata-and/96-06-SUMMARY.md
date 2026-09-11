---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "06"
subsystem: backend/database/routes
tags: [identity, ssh-commands, fleet-tree, birth-orchestrator, mkdir, workspace]

dependency_graph:
  requires:
    - 96-01 (per-identity-file.ts writeIdentityFile — relay.json routing)
    - 96-02 (identity-birth-orchestrator.ts identityDir rewritten to fleet/identities path)
  provides:
    - identity-birth-orchestrator.ts Step 2 mkdir now creates wakeups/ + workspace/ atomically
    - Test 6b assertion covering workspace/ sub-part creation per D-04
  affects:
    - Migration runbook (96-04) — on-disk tree shape now consistent between birth flow and migration flow

tech-stack:
  added: []
  patterns:
    - "Single mkdir -p invocation for both wakeups/ and workspace/ sub-parts at identity birth"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts

key-decisions:
  - "Extended existing mkdir -p command with workspace/ as a second path argument (no separate SSH round-trip)"
  - "New workspace/ assertion added as standalone Test 6b rather than appended to Test 6's tmux+mkdir matcher"

requirements-completed: []

duration: ~8min
completed: 2026-09-10
---

# Phase 96 Plan 06: Wave 3 — identity-birth workspace/ mkdir extension

**identity-birth-orchestrator Step 2 extended to create workspace/ alongside wakeups/ in a single mkdir -p, with Test 6b asserting both sub-parts and the fleet-tree path**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-10T01:33:00Z
- **Completed:** 2026-09-10T01:36:30Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Extended `identity-birth-orchestrator.ts` Step 2 remote mkdir from single `wakeups/` to both `wakeups/` and `workspace/` in one `mkdir -p` invocation (D-04)
- Updated comment to reference workspace/ and D-04 (generic working directory)
- Added Test 6b in `identity-birth-orchestrator.test.ts` asserting the identity-tree mkdir command contains both `wakeups` and `workspace` sub-parts and uses the fleet-tree path
- 48/48 tests pass (47 original + 1 new Test 6b)

## Before / After

**Before (Plan 96-02 shape):**
```
// 1. Create the identity folder tree (mkdir wakeups also creates parent).
//    touch handoff.md to satisfy id skill's load-existing branch.
await deps.execCommand(
  conn,
  `mkdir -p "${identityDir}/wakeups" && touch "${identityDir}/handoff.md"`,
);
```

**After:**
```
// 1. Create the identity folder tree — wakeups/ + workspace/ (generic working dir per D-04)
//    plus touch handoff.md to satisfy id skill's load-existing branch.
//    Single mkdir -p covers both sub-parts and the parent identityDir.
await deps.execCommand(
  conn,
  `mkdir -p "${identityDir}/wakeups" "${identityDir}/workspace" && touch "${identityDir}/handoff.md"`,
);
```

## Test Assertion Added

**Test 6b** (new, standalone):
```typescript
it("Test 6b: Step 2 identity-tree mkdir creates both wakeups/ and workspace/ sub-parts per D-04", async () => {
  // ... setup ...
  const identityTreeMkdir = mockExecCommand.mock.calls.find(
    (call) => typeof call[1] === "string" && (call[1] as string).includes("wakeups"),
  );
  expect(identityTreeMkdir).toBeDefined();
  const mkdirCmd = identityTreeMkdir![1] as string;
  expect(mkdirCmd).toContain("mkdir -p");
  expect(mkdirCmd).toContain("wakeups");
  expect(mkdirCmd).toContain("workspace"); // D-04
  expect(mkdirCmd).toContain("fleet/identities/agent1"); // Plan 96-02 regression guard
}, 10_000);
```

Note: Test 6 (the existing test) finds the tmux+mkdir command that sends `mkdir -p /workspace/name && tmux new-session ...` — it does NOT match the identity-tree mkdir which is a separate `deps.execCommand(conn, ...)` call. Test 6b uses `includes("wakeups")` to find the correct SSH-exec call.

## Plan 96-02 Regression Verification

- Line 1133 `identityDir` in `identity-birth-orchestrator.ts`: `${remoteHome}/fleet/identities/${opts.name}` — unchanged from Plan 96-02
- Test 6b asserts `fleet/identities/agent1` in the mkdir command, locking the fleet-tree path
- `grep -c "mkdir.*workspace" identity-birth-orchestrator.ts` → 1

## Task Commits

1. **Task 1: Extend Step 2 mkdir + add Test 6b** — `6163a397` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Workspace/wakeups assertions placed in wrong test context**
- **Found during:** Task 1 (first test run)
- **Issue:** Initially added `expect(cmd).toContain("wakeups")` and `expect(cmd).toContain("workspace")` inside Test 6, which locates the `mkdir -p /workspace/name && tmux new-session` command (line 1106) rather than the identity-tree `deps.execCommand(conn, "mkdir ... wakeups ... workspace")` call (line 1141). The tmux+mkdir command does not contain "wakeups", so Test 6 failed.
- **Fix:** Reverted the Test 6 additions; added standalone Test 6b that locates the identity-tree mkdir by `includes("wakeups")` — the correct selector.
- **Files modified:** `identity-birth-orchestrator.test.ts`
- **Committed in:** 6163a397

---

**Total deviations:** 1 auto-fixed (Rule 1 - incorrect test selector)
**Impact on plan:** Fix was necessary for test correctness. No scope change.

## Issues Encountered

None beyond the test-selector issue described above.

## Known Stubs

None.

## Threat Flags

No new security surface introduced. The `workspace` path segment is a static literal — the same `opts.name` interpolation surface as the existing `wakeups` segment, which passes through IDENTITY_KEY_RE + TMUX_SAFE_NAME_RE gates. No new trust boundary.

## Next Phase Readiness

Plan 96-06 completes Wave 3. The on-disk identity tree for UI-birthed identities now matches the fleet tree shape the migration runbook creates for existing identities: `fleet/identities/<name>/wakeups/` + `fleet/identities/<name>/workspace/`.

---
*Phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and*
*Completed: 2026-09-10*
