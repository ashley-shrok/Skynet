---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "01"
subsystem: backend/distributor
tags: [refactor, extraction, fleet-substrate, bundled-reader, tdd]
dependency_graph:
  requires: []
  provides: [src/backend/distributor/bundled-reader.ts]
  affects:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
tech_stack:
  added: []
  patterns:
    - Pure fs adapter module extracted to distributor/ for shared consumption
    - TDD RED/GREEN cycle for the extracted module
key_files:
  created:
    - src/backend/distributor/bundled-reader.ts
    - src/backend/distributor/bundled-reader.test.ts
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
decisions:
  - "D-04 prerequisite: extracted bundledReaderFromDisk before the legacy sweep hook is removed in 75-07 — both the legacy hook and the new server-substrate-orchestrator (75-02) now import from the same module"
metrics:
  duration: "5m 12s"
  completed_date: "2026-09-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
  tests_added: 4
---

# Phase 75 Plan 01: bundled-reader extraction Summary

**One-liner:** Extracted `bundledReaderFromDisk` from `ssh-poll-orchestrator.ts` into `src/backend/distributor/bundled-reader.ts` as a shared pure fs adapter with its own 4-test unit suite covering success/ENOENT/EACCES/never-throw contracts.

## What Was Built

### Task 1 — Create bundled-reader.ts + unit tests (TDD)

**RED:** Created `src/backend/distributor/bundled-reader.test.ts` with 4 tests (success, ENOENT, EACCES, never-throw). Confirmed "Cannot find module" failure — commit `8538c732`.

**GREEN:** Created `src/backend/distributor/bundled-reader.ts`. Implementation body is a byte-for-byte lift-and-shift of `ssh-poll-orchestrator.ts` lines 2048-2056 (Promise.all([readFile, stat]), catch returns null). All 4 tests pass — commit `4eeae8d6`.

### Task 2 — Rewire ssh-poll-orchestrator.ts

- Added `import { bundledReaderFromDisk } from "../distributor/bundled-reader.js"` (grouped with the other Phase 72 Plan 04 imports at line 59)
- Removed `import { readFile, stat } from "node:fs/promises"` — these were only used by the removed block
- Removed the local `const bundledReaderFromDisk` declaration and its doc comment (the 21-line block at former lines 2039-2060)
- Call site `readBundledBytes: bundledReaderFromDisk` at line 2103 resolves to the imported symbol unchanged
- `npx tsc --noEmit` exit 0; 133/133 tests pass (129 orchestrator + 4 bundled-reader) — commit `11a97e10`

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `src/backend/distributor/bundled-reader.ts` exists | PASS |
| `grep -c "^export const bundledReaderFromDisk"` returns 1 | PASS (result: 1) |
| `src/backend/distributor/bundled-reader.test.ts` exists with >=3 `it(` blocks | PASS (result: 4) |
| `npx vitest run bundled-reader.test.ts` exits 0 | PASS |
| Extracted function body byte-equivalent to ssh-poll-orchestrator.ts:2048-2056 | PASS (verified by reading both) |
| `grep -c 'from "../distributor/bundled-reader.js"'` in orchestrator returns 1 | PASS |
| `grep -c "const bundledReaderFromDisk"` in orchestrator returns 0 | PASS |
| `readBundledBytes: bundledReaderFromDisk` call site count: 1 | PASS |
| `npx tsc --noEmit` exits 0 | PASS |
| Existing ssh-poll-orchestrator tests still pass | PASS (129/129) |

## Deviations from Plan

### Auto-fixed Issues

None.

### Notes

- The `--related` flag for vitest is not supported in the installed version (v4.1.8). Used explicit test file paths instead — functionally equivalent.
- `readFile` and `stat` from `node:fs/promises` were imported only for the removed block, confirmed by grep, so the import was removed as instructed.

## Threat Flags

None — this is a pure code-motion refactor with no I/O surface changes, no new trust boundaries, and no auth/crypto changes. The STRIDE threat register confirms no load-bearing threats for this plan (T-75-01-01 and T-75-01-02 are both accepted/pre-existing behaviors unchanged by the refactor).

## Known Stubs

None — the extracted function is a complete, production-ready implementation. No stub patterns introduced.

## Self-Check: PASSED

- `src/backend/distributor/bundled-reader.ts`: FOUND
- `src/backend/distributor/bundled-reader.test.ts`: FOUND
- Commit `8538c732` (RED): FOUND
- Commit `4eeae8d6` (GREEN): FOUND
- Commit `11a97e10` (Task 2 rewire): FOUND
- All 133 tests pass, `npx tsc --noEmit` exits 0
