---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "07"
subsystem: fleet-status/distributor
tags:
  - cleanup
  - dead-code-removal
  - fleet-substrate
  - ssh-poll-orchestrator
dependency_graph:
  requires:
    - 75-01  # bundledReaderFromDisk extraction (import was removable only after extraction)
    - 75-02  # server-substrate-orchestrator (new sweep path is live before old is deleted)
    - 75-05  # server-context wired into starter.ts at boot
    - 75-06  # on-add/on-update triggers live
  provides:
    - "ssh-poll-orchestrator free of substrate-sweep logic (single-purpose: poll + stop-hook + identity-recycle)"
  affects:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/distributor/run-sweep.ts
tech_stack:
  added: []
  patterns:
    - "Wave-2 co-scheduling enforces the remove-after-replace invariant: the browser-driven hook is deleted only after the server-context path (75-05/75-06) is proven live"
key_files:
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/distributor/run-sweep.ts
decisions:
  - "D-04 delivered: browser-driven install-pass hook removed; server-context path is the sole sweep trigger"
  - "IdentityHostingHostRecord export kept — still consumed by starter.ts and starter.test.ts; updated JSDoc to remove stale 'only meaningful to sweep hook' wording"
  - "vi.mock('../distributor/run-sweep.js') and vi.mock('../distributor/log-tags.js') removed from test file — both existed solely to support the sweep hook tests"
  - "run-sweep.ts comment updated: bundledReaderFromDisk reference now correctly points to distributor/bundled-reader.ts (not ssh-poll-orchestrator.ts which no longer holds it)"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-06"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 3
---

# Phase 75 Plan 07: Remove Browser-Driven Substrate-Sweep Hook Summary

**One-liner:** Removed the Phase 72 Plan 04 browser-driven fleet-substrate sweep hook and its 7 tests from `ssh-poll-orchestrator.ts` — substrate sweeps now run exclusively through the server-context orchestrator (75-02/75-05/75-06).

## What Was Done

Deleted the browser-session-driven install-pass hook that had lived at `ssh-poll-orchestrator.ts` since Phase 72 Plan 04. The hook was redundant once the server-context orchestrator (75-02) was wired into `starter.ts` (75-05) and on-add/on-update triggers (75-06) were live. Per-item idempotence in `FLEET_SUBSTRATE_CATALOG` ensures that if both paths had fired against the same host, the second arriving sweep would see every catalog item already up-to-date and no-op — making the browser-driven hook belt-and-suspenders dead weight.

### Step A — Pre-Deletion Grep Counts

Counts in `ssh-poll-orchestrator.ts` before any deletion:

| Identifier | Count | Decision |
|---|---|---|
| `runSweepForHost` | 3 (1 import + 1 call + 1 comment) | Remove — all usages in sweep block |
| `logSweepHookError` | 3 (1 import + 1 call + 1 comment) | Remove — all usages in sweep block |
| `bundledReaderFromDisk` | 3 (1 import + 1 call + 1 comment) | Remove — sole consumer was sweep block |
| `FLEET_SUBSTRATE_CATALOG` | 2 (1 import + 1 call) | Remove — sole consumer was sweep block |
| `sweepedThisInstance` | 5 (1 decl + 2 guards + 1 mark + 1 clear) | Remove — all in sweep state/block/stop |
| `sweepInFlight` | 5 (1 decl + 2 guards + 1 delete + 1 clear) | Remove — all in sweep state/block/stop |
| `IdentityHostingHostRecord` | 2 (1 export decl + 1 cast in sweep block) | **Keep export** — used by starter.ts and starter.test.ts; only the cast in the sweep block is deleted |

### Deletions in ssh-poll-orchestrator.ts

1. **Import block** (lines 56-65 pre-edit, ~10 lines removed): The Phase 72 Plan 04 comment + 4 imports (`bundledReaderFromDisk`, `runSweepForHost`, `FLEET_SUBSTRATE_CATALOG`, `logSweepHookError`) deleted in full.

2. **State declarations** (lines 825-836 pre-edit, ~12 lines removed): `sweepedThisInstance = new Set<string>()` and `sweepInFlight = new Set<string>()` plus their surrounding comments deleted.

3. **Sweep hook block** (lines 2067-2132 pre-edit, ~66 lines removed): The entire `if (extHost.runsFleetSubstrate === true && !sweepedThisInstance.has(...))` block with the `queueMicrotask` body, `runSweepForHost` call, `sweepedThisInstance.add`, catch→`logSweepHookError`, and `sweepInFlight.delete`.

4. **stop() cleanup** (lines 2285-2290 pre-edit, ~6 lines removed): `sweepedThisInstance.clear()` and `sweepInFlight.clear()` calls with surrounding comment deleted.

5. **IdentityHostingHostRecord JSDoc updated**: Removed stale "only meaningful to the sweep hook" wording. The export remains; JSDoc now correctly describes its role as the wire-through shape between `starter.ts` and `OrchestratorDeps`.

**Line count delta:** 2301 → 2202 = **-99 lines** (within the expected 85-100 range).

### Deletions in ssh-poll-orchestrator.test.ts

**Mock blocks and imports removed** (lines 57-74 pre-edit):
- `vi.mock("../distributor/run-sweep.js", ...)` block (the no-op `runSweepForHost` stub)
- `vi.mock("../distributor/log-tags.js", ...)` block
- `import { runSweepForHost } from "../distributor/run-sweep.js"`
- `import { logSweepHookError } from "../distributor/log-tags.js"`

**Test cases deleted** (lines 6945-7219 pre-edit, entire `describe("phase-72 fleet-substrate sweep hook")` block):

| Test | What it asserted | Disposition |
|---|---|---|
| Test A | sweep fires once when `runsFleetSubstrate: true` | Deleted — exercises removed code |
| Test B | sweep does NOT fire when `runsFleetSubstrate: false` | Deleted — exercises removed code |
| Test C | sweep does NOT fire when `acquireSshChannel` returns null | Deleted — exercises removed code |
| Test D | sweep never blocks poll cadence (never-resolve mock) | Deleted — exercises removed code |
| Test E | sweep errors are contained via `logSweepHookError` | Deleted — exercises removed code |
| Test F | sweepedThisInstance is per-orchestrator-instance | Deleted — exercises removed state |
| Test G | sweepedThisInstance guard prevents re-firing across two poll ticks | Deleted — exercises removed state |

**Line count delta:** 7218 → 6926 = **-292 lines** (all sweep hook tests deleted).

**No tests adjusted** — every hit from the sweep-grep was unambiguously testing the removed behavior. No test was preserved that merely happened to set `runsFleetSubstrate: true` for an unrelated reason.

### run-sweep.ts Comment Update

Updated stale `deps.readBundledBytes` comment that referenced `bundledReaderFromDisk inside ssh-poll-orchestrator.ts` — the correct location since Phase 75-01 is `distributor/bundled-reader.ts`.

## Verification Results

| Check | Result |
|---|---|
| `sweepedThisInstance` count in ssh-poll-orchestrator.ts | 0 |
| `sweepInFlight` count in ssh-poll-orchestrator.ts | 0 |
| `runSweepForHost` count in ssh-poll-orchestrator.ts | 0 |
| `logSweepHookError` count in ssh-poll-orchestrator.ts | 0 |
| `bundledReaderFromDisk` count in ssh-poll-orchestrator.ts | 0 |
| `FLEET_SUBSTRATE_CATALOG` count in ssh-poll-orchestrator.ts | 0 |
| `Phase 72 Plan 04` comment blocks in ssh-poll-orchestrator.ts | 0 |
| `fleet-substrate sweep hook` opening comment in ssh-poll-orchestrator.ts | 0 |
| `IdentityHostingHostRecord` count in ssh-poll-orchestrator.ts | 1 (export decl — correct) |
| `bundledReaderFromDisk` live consumers in src/backend/ | server-substrate-orchestrator.ts (75-02) — alive |
| `npx vitest run ssh-poll-orchestrator.test.ts` | 122/122 pass |
| `npx tsc --noEmit` | Clean (exit 0) |

**sweepedThisInstance / sweepInFlight** still appear in `server-substrate-orchestrator.ts` (75-02's new orchestrator) — that is correct and expected. The identifiers live in the right module now.

## Deviations from Plan

None — plan executed exactly as written.

Step D (verify `readFile`/`stat` from `node:fs/promises`) confirmed no such imports existed in `ssh-poll-orchestrator.ts` — the RESEARCH.md concern was pre-empted by the fact that 75-01 had already extracted the reader to a standalone module and never left raw fs calls in the orchestrator.

## Threat Flags

None. Pure deletion of superseded code. All previously-audited security invariants remain in effect via the new server-context path (75-02, 75-03, 75-04, 75-05, 75-06).

## Self-Check: PASSED

Files verified present:
- `/home/ubuntu/skynet-tabitha/src/backend/fleet-status/ssh-poll-orchestrator.ts` — 2202 lines, no sweep-hook code
- `/home/ubuntu/skynet-tabitha/src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — 6926 lines, no sweep-hook tests
- `/home/ubuntu/skynet-tabitha/src/backend/distributor/run-sweep.ts` — comment updated

Commit `da0b23ae` exists and contains all three modified files.
