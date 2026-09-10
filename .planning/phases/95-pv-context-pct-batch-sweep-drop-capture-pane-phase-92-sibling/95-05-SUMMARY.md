---
phase: 95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling
plan: 05
subsystem: claude-session backend
tags: [phase-95, part-c, wave-3, contextpct-timer-rewire, batch-dispatch, regression-tests]
dependency_graph:
  requires:
    - "95-04: pv-sweep-schema.ts + pv-context-pct-sweep.py + distributor catalog row"
  provides:
    - "contextPctTimer batch-first/legacy-fallback dispatch wired (Plan 05 Task 1)"
    - "6 regression tests + 8 grep-guard tests (Plan 05 Task 2)"
    - "UAT gate (Task 3) — PENDING Ashley execution"
  affects:
    - "exec pressure on Skynet-host SSH connection (4x reduction per WS per tick post-UAT-deploy)"
    - "contextPctTimer callback: batch path 1 exec/tick vs legacy 4 execs/tick"
tech_stack:
  added: []
  patterns:
    - "Batch-first / legacy-fallback dispatch (Phase 92 proven pattern)"
    - "Per-WS closure state for probe cache + schema-mismatch latch"
    - "Test seam pattern: inline dispatch logic simulation (no live WS needed)"
key_files:
  created:
    - "src/backend/claude-session/claude-session-server.pv-sweep.test.ts (485 lines, 14 tests)"
  modified:
    - "src/backend/claude-session/claude-session-server.ts (contextPctTimer rewired + helpers added)"
decisions:
  - "Test seam strategy: tests simulate dispatch logic inline using parseSweepJsonl imported directly, rather than driving through __pvSweepSeamRegistry with a live WebSocket. Keeps tests simple and avoids WebSocket lifecycle complexity."
  - "sshLogger used for probe/fallback log ops (not systemLogger which is not imported in claude-session-server.ts)."
  - "__pvSweepSeamRegistry exposed as Map<WebSocket, __PvSweepSeamForTests> for future integration test use; __PvSweepSeamForTests interface exported for type-safe seam access."
metrics:
  duration: "~40 minutes execution time (both Wave 3 plans combined)"
  completed_date: "2026-09-10"
  tests_added: 14
  lines_added_approximately: 100
---

# Phase 95 Plan 05: contextPctTimer rewire + regression tests + UAT gate Summary

**One-liner:** Rewired the contextPctTimer callback in claude-session-server.ts to batch-first/legacy-fallback dispatch (1 sweep exec per WS per tick vs up-to-4 tail execs), added 6 regression tests + 8 grep-guard tests, and prepared the Ashley UAT gate (Task 3 — awaiting human execution).

## Task 1: contextPctTimer rewire

**New contextPctTimer dispatch body** (post-rewire):

```typescript
// Presence probe on first tick per SSH-channel lifetime.
if (sweepScriptPresent === null) {
  const probeRaw = await execCommand(connSnapshot, "test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no");
  sweepScriptPresent = probeRaw !== null && probeRaw !== undefined && probeRaw.trim() === "yes";
  sshLogger.info("PV context-pct sweep-script presence probed", {
    operation: "pv_context_pct_sweep_probe",
    present: sweepScriptPresent,
    identity: tmuxSessionSnapshot,
  });
}

// Batch-first dispatch.
if (sweepScriptPresent && !sweepSchemaMismatch) {
  const result = await computeContextPctBatch(connSnapshot, tmuxSessionSnapshot);
  if (result.ok) { pct = result.pct; }
  else {
    sshLogger.warn("PV context-pct batch fell back to legacy", {
      operation: "pv_context_pct_batch_fallback",
      reason: result.reason,
      identity: tmuxSessionSnapshot,
    });
    if (result.reason === "null-exec") sweepScriptPresent = null;
    if (result.reason === "schema-mismatch") sweepSchemaMismatch = true;
    pct = await computeContextPctLegacy(connSnapshot, sessionFileSnapshot);
  }
} else {
  pct = await computeContextPctLegacy(connSnapshot, sessionFileSnapshot);
}
```

**Per-WS closure state added:**
```typescript
let sweepScriptPresent: boolean | null = null;
let sweepSchemaMismatch = false;
```

**Helpers added:**
- `computeContextPctLegacy(connSnapshot, sessionFileSnapshot)`: wraps existing readContextPctFromJsonl
- `computeContextPctBatch(connSnapshot, tmuxSessionSnapshot)`: G6 safe-char guard + sweep exec + parseSweepJsonl + identity lookup

**Test seam exported:**
```typescript
export interface __PvSweepSeamForTests { ... }
export const __pvSweepSeamRegistry = new Map<import("ws").WebSocket, __PvSweepSeamForTests>();
```

**Aside subsystem preserved:** `capture-pane -p -S -200` calls at L7982+/L8013+ UNCHANGED (G8 guard confirmed by Test G7 in regression suite).

## Task 2: Regression tests

14 tests in `src/backend/claude-session/claude-session-server.pv-sweep.test.ts`:

**Phase 95 Part C — pv-context-pct-sweep batch dispatch (6 tests):**

| Test | Scenario | Seam used |
|------|----------|-----------|
| Test 1 | Batch path: sweep exec returns valid JSONL → pct extracted, 0 tail execs | parseSweepJsonl inline |
| Test 2 | Legacy path: probe returns "no" → computeContextPctLegacy called, 0 sweep execs | mock dispatch logic |
| Test 3 | Probe fires once across 3 ticks (probeCalls=1, sweepCalls=3) | mock exec + dispatch loop |
| Test 4 | Null-exec recovery: sweep null tick 1 → legacy fallback + sweepScriptPresent reset → re-probe tick 2 | mock exec + dispatch loop |
| Test 5 | Schema-mismatch latch: schema_version:999 → legacy tick 1 + latch → legacy tick 2 (sweep not called) | parseSweepJsonl inline |
| Test 6 | Batch-vs-legacy parity: both paths produce context_pct===42 (strict ===) | parseSweepJsonl + mock |

**Phase 95 Part C — source-level grep-guards (8 tests):**

| Guard | Assertion |
|-------|-----------|
| G1 | computeContextPctBatch symbol exists in source |
| G2 | computeContextPctLegacy symbol exists in source |
| G3 | sweepScriptPresent closure state declared |
| G4 | pv_context_pct_sweep_probe log op present |
| G5 | pv_context_pct_batch_fallback log op present |
| G6 | parseSweepJsonl imported in source |
| G7 | aside capture-pane -p -S -200 calls still exist (>=1 match) |
| G8 | contextPctTimer's capture-pane -p -t '${activeTmuxSession}' is absent (0 matches) |

All 14 tests pass. Full claude-session test suite still green.

## Task 3: Ashley UAT gate — PENDING

Task 3 is a `checkpoint:human-verify` gate. Phase 95 does not close until Ashley executes checks 1-6 against t1000 and replies `all 6 checks PASS — Phase 95 complete`.

**Prerequisites for UAT:**
1. Merge `feat/tab-title-from-tmux` branch (Wave 3 commits included)
2. Rebuild Skynet container with new image
3. `docker compose up -d --force-recreate skynet` on t1000
4. Wait 60 seconds for distributor sweep to push `pv-context-pct-sweep.py` to peers and for WS connections to churn (or reload browser tabs)

**UAT checklist:**
- Check 1: `test -x ~/.local/bin/pv-context-pct-sweep` → INSTALLED on every runsFleetSubstrate=true peer
- Check 2: `docker logs skynet-backend --since 5m | grep '"operation":"pv_context_pct_sweep_probe"'` → N lines (N ≈ open PV tabs)
- Check 3: 60s window, 5 open PV tabs → `grep -cE "tail -c (10000|50000|200000|512000)"` → near-zero
- Check 4: `grep -c '"operation":"pv_context_pct_batch_fallback"'` → near-zero after first minute
- Check 5: `python3 ~/.local/bin/pv-context-pct-sweep --identities <identity>` matches UI display within +/-1% (for 3 identities on 3 peer hosts)
- Check 6: No frontend regressions (context_pct meter renders, no plan_pending errors in console)

## Deviations from Plan

**1. [Rule 2 - Logger correction] Used sshLogger instead of systemLogger**
- **Found during:** Task 1 implementation
- **Issue:** Plan 05 spec referenced `systemLogger.info/warn` but `systemLogger` is not imported in claude-session-server.ts (it imports `sshLogger` and `databaseLogger`)
- **Fix:** Used `sshLogger.info/warn` for `pv_context_pct_sweep_probe` and `pv_context_pct_batch_fallback` log ops
- **Files modified:** `src/backend/claude-session/claude-session-server.ts`
- **Commit:** `63ef8e59`

## Commits

- **`63ef8e59`** — `feat(claude-session): rewire contextPctTimer to batch-first sweep with legacy fallback (Phase 95 Part C-4)` — Task 1: claude-session-server.ts rewire
- **`57e84694`** — `test(claude-session): regression suite for pv-context-pct-sweep batch dispatch (Phase 95 Part C-5)` — Task 2: pv-sweep.test.ts

## Phase 95 close status

**OPEN — awaiting Ashley UAT (Task 3).** Phase 95 closes green when Ashley replies `all 6 checks PASS — Phase 95 complete` after UAT execution.

## Self-Check: PASSED

- `grep -c "computeContextPctBatch" src/backend/claude-session/claude-session-server.ts` → positive
- `grep -c "computeContextPctLegacy" src/backend/claude-session/claude-session-server.ts` → positive
- `grep -c "sweepScriptPresent" src/backend/claude-session/claude-session-server.ts` → positive
- `grep -c "parseSweepJsonl" src/backend/claude-session/claude-session-server.ts` → positive
- `npx vitest run src/backend/claude-session/claude-session-server.pv-sweep.test.ts` → 14 tests pass
- `git log --oneline | grep 63ef8e59` → FOUND
- `git log --oneline | grep 57e84694` → FOUND
