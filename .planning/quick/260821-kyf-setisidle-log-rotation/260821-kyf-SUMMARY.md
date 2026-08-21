---
phase: quick-260821-kyf-setisidle-log-rotation
plan: 01
subsystem: terminal-ws-dispatch + backend-log-forwarder
tags: [bugfix, log-rotation, tdd, hotfix, prod-regression]
dependency_graph:
  requires:
    - src/ui/features/terminal/Terminal.tsx (WS dispatch existed pre-41-02)
    - src/backend/database/routes/debug.ts (frontend forwarder POST handler)
    - src/backend/utils/console-forward-transport.ts (backend flush)
    - src/backend/utils/console-forward-transport.test.ts (tmp-file pattern reference)
  provides:
    - src/backend/utils/console-forward-rotator.ts (rotateIfExceeds helper + MAX_FILE_BYTES + MAX_ROTATED_FILES)
    - src/backend/utils/console-forward-rotator.test.ts (6-test rotator vitest suite)
  affects:
    - production /opt/skynet/console-forward-logs/ layout (post-deploy: base + .log.1..N accumulate)
    - Terminal.tsx WS onmessage handler surface (idle-frame ReferenceError eliminated)
tech-stack:
  added: []
  patterns:
    - shared-util-extraction-from-two-callsites
    - N-file rename-chain rotation (drop-oldest, POSIX-atomic renameSync)
    - best-effort error swallow (each fs op in its own try/catch, helper never throws)
    - TDD RED → GREEN commit pair for the new helper
key-files:
  created:
    - src/backend/utils/console-forward-rotator.ts
    - src/backend/utils/console-forward-rotator.test.ts
  modified:
    - src/ui/features/terminal/Terminal.tsx  (delete msg.type==="idle" branch + comment)
    - src/backend/database/routes/debug.ts   (import rotator, delete MAX_FILE_BYTES, swap block, JSDoc)
    - src/backend/utils/console-forward-transport.ts (import rotator, delete MAX_FILE_BYTES, swap block, JSDoc)
decisions:
  - "Delete the msg.type==='idle' Terminal branch outright (no re-add of useState) — post-41-02 pane-level PrettyView consumes idle directly via its own WS subscription, per the stale comment left behind on lines 1436-1439."
  - "Extract rotation to a shared module rather than duplicate inline. Both callsites already had identical stat/rotate/write blocks; a single rotateIfExceeds(logPath) call reads better AND ensures a future bump to N=40 touches one file."
  - "Use fs.renameSync (not copy+truncate). Atomic on POSIX; a losing racer observes ENOENT on the new base file and no-ops via the early stat-catch return path."
  - "Bug found during Task 2 GREEN run: initial loop combined the .log.N unlink with a `continue`, which skipped the .log.(N-1) → .log.N rename at that iteration. Test 4 caught it. Fixed by lifting the unlink OUT of the loop as a pre-loop step so every iteration does exactly one rename."
metrics:
  duration_min: 24.6
  completed: 2026-08-21
  tests_added: 6
  suite_before: "2770 passed / 10 skipped / 1 todo (206 files)"
  suite_after:  "2776 passed / 10 skipped / 1 todo (206 files)"
---

# Quick 260821-kyf Setisidle + Log Rotation Summary

Ship two independent low-risk fixes on `feat/tab-title-from-tmux`: (a) delete the dead `msg.type==="idle"` WS dispatch branch in Terminal.tsx that was throwing ReferenceError on every backend idle-transition frame post-Phase-41-02, and (b) replace the destructive-truncation log rotation in both debug.ts and console-forward-transport.ts with a shared N=20 rename-chain helper so ~5-min-cadence log-wipes in production stop destroying forensic grep-history.

## What Shipped

**Task 1 — Terminal.tsx ReferenceError fix** (commit `284e6299`)
- Deleted the 10-line `msg.type === "idle"` branch (lines 1435–1444) that referenced the removed `setIsIdle` setter.
- Left a single-line comment marker explaining the intentional drop and citing 41-02 provenance.
- Verified: `grep -c 'setIsIdle' Terminal.tsx` = 0, `grep -c 'msg.type === "idle"' Terminal.tsx` = 0, `msg.type === "data"` branch intact, `tsc --noEmit` clean for Terminal.tsx.

**Task 2 — Shared N-file rotator** (RED `ad6fd939` → GREEN `800f4652`)
- New module `src/backend/utils/console-forward-rotator.ts` (~76 LOC): exports `rotateIfExceeds(logPath, opts?)`, `MAX_FILE_BYTES = 5 * 1024 * 1024`, `MAX_ROTATED_FILES = 20`.
- Behavior: `statSync` error or `size ≤ maxBytes` → return early; otherwise `unlink .log.N` (drop oldest) then iterate `i = N…1` renaming `.log.(i-1) → .log.i` (with i-1 === 0 meaning the base). Every op wrapped in its own try/catch — helper never throws.
- New test suite `console-forward-rotator.test.ts` (6 tests): small-file no-op, over-threshold rename, chain-bump, max-N drop-oldest, race-simulation (2nd sync call no-ops), rename-failure swallowed.
- TDD gate compliance: RED commit lands first (module missing → suite fails with "Cannot find module"), GREEN commit implements + all 6 pass.

**Task 3 — Wire both callsites** (commit `2f70521c`)
- `src/backend/database/routes/debug.ts`: added `import { rotateIfExceeds } from "../../utils/console-forward-rotator.js"`, deleted the local `MAX_FILE_BYTES` const, collapsed the 13-line stat/rotate/writeFileSync block into a single `rotateIfExceeds(logPath);` call inside the existing best-effort try/catch. Updated the header JSDoc's `File rotates at 5 MB with a [LOG_ROTATED at <ts>] marker.` line to describe delegation to the shared rotator.
- `src/backend/utils/console-forward-transport.ts`: same wiring pattern — import, delete local const, collapse the 14-line block, update JSDoc's design-notes bullet describing rotation semantics.
- Verified: `grep -c 'fs.writeFileSync'` = 0 in both files (destructive writes gone); `grep -c 'rotateIfExceeds'` = 2 in each (import + call); `grep -c 'MAX_FILE_BYTES'` = 0 in both callsites; existing `console-forward-transport.test.ts` still passes unmodified.

## Verification Battery Run

| Check | Result |
| ----- | ------ |
| `grep -c 'setIsIdle' Terminal.tsx` | 0  |
| `grep -c 'msg.type === "idle"' Terminal.tsx` | 0 |
| `grep -c 'msg.type === "data"' Terminal.tsx` | 1 |
| `grep -c 'rotateIfExceeds' debug.ts` | 2 (import + call) |
| `grep -c 'rotateIfExceeds' console-forward-transport.ts` | 2 (import + call) |
| `grep -c 'fs.writeFileSync' debug.ts + transport.ts` | 0 + 0 |
| `npx vitest run console-forward-{rotator,transport}.test.ts` | 12/12 passed |
| `npm test` (full suite) | 206 files, **2776 passed** / 10 skipped / 1 todo (+6 vs 2770 baseline, matching new rotator tests) |
| `npm run build` (frontend + backend) | exit 0, `✓ built in 10.23s` |
| `npx tsc --noEmit` on 4 touched files | clean (empty grep) |

The full suite reports one pre-existing `EnvironmentTeardownError` from `src/ui/features/pretty-view/IdentityModal.test.tsx` (unrelated to any file touched here — Vitest's own `[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`). No test failed on my touched surface. See "Deferred Issues" below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed rename-chain skipping .log.(N-1) → .log.N**
- **Found during:** Task 2 GREEN — Test 4 (max-N drop-oldest) failed with `ENOENT: no such file or directory, open '.log.3'`.
- **Issue:** The initial `rotateIfExceeds` loop combined the "unlink oldest" step (`if (i === maxFiles) { unlink; continue }`) with the rename step. The `continue` at `i === maxFiles` skipped the rename that iteration needed to perform, so `.log.(N-1)` was never bumped to `.log.N`. Downstream: `.log.(N-2)` overwrote `.log.(N-1)`, silently losing one entry.
- **Fix:** Lift the `unlink .log.N` step OUT of the loop as a pre-loop pass. The loop now always executes a single rename per iteration (`.log.(i-1) → .log.i`), high-to-low, so no rename can clobber a not-yet-moved file.
- **Files modified:** `src/backend/utils/console-forward-rotator.ts` (inside GREEN commit — never landed as its own commit since the fix happened before Task 2 GREEN was committed).
- **Commit:** `800f4652` (GREEN — final implementation with the fix baked in).

### Auto-added missing critical functionality
None — plan's contract was complete.

### Blocking issues auto-fixed
None — no build/type/import blockers surfaced.

### Architectural changes proposed
None — pure fix-in-place surgery.

## Known Stubs
None.

## Deferred Issues

**1. Pre-existing `EnvironmentTeardownError` in `src/ui/features/pretty-view/IdentityModal.test.tsx`**
- Vitest's own `[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` unhandled rejection during teardown.
- Present on baseline HEAD `cd2c8f2b` (before any commits in this quick task) — completely unrelated to the four files I touched.
- Suite still returns exit 0 with 2776 passed; the "Errors: 1 error" line is a vitest-runner infra hiccup, not a test regression.
- Logged for future cleanup but NOT in scope for quick-260821-kyf.

## Threat Flags
None. No new endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The rotator writes to the same file the callers already wrote to — no new external surface.

## Post-Deploy Sanity Check (for orchestrator/Ashley)

After `docker compose up -d --force-recreate skynet` under the 15-min deadman timer:

1. `sudo ls -la /opt/skynet/console-forward-logs/` — expect `console-forward.log` present; after ~5 MB of accumulation, a `console-forward.log.1` should appear alongside, then `.log.2`, `.log.3`, … up to `.log.20` over time. No more `[LOG_ROTATED at …]` marker lines in the base file.
2. Watch the browser DevTools console during an SSH session that goes idle — no `ReferenceError: setIsIdle is not defined` should appear when the backend fires `{type: "idle", idle: true}` or on WS attach.
3. `sudo grep -c 'ReferenceError.*setIsIdle' /opt/skynet/console-forward-logs/console-forward.log` — expect 0 for entries dated post-deploy.

## Self-Check: PASSED

- Created files exist:
  - `src/backend/utils/console-forward-rotator.ts` — FOUND
  - `src/backend/utils/console-forward-rotator.test.ts` — FOUND
- Modified files reflect the edits:
  - `src/ui/features/terminal/Terminal.tsx` — dead branch gone (grep verified above)
  - `src/backend/database/routes/debug.ts` — rotator wired, writeFileSync gone
  - `src/backend/utils/console-forward-transport.ts` — rotator wired, writeFileSync gone
- Commits exist:
  - `284e6299` — FOUND
  - `ad6fd939` — FOUND
  - `800f4652` — FOUND
  - `2f70521c` — FOUND
