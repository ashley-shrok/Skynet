---
phase: quick-260821-kyf-setisidle-log-rotation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/terminal/Terminal.tsx
  - src/backend/utils/console-forward-rotator.ts
  - src/backend/utils/console-forward-rotator.test.ts
  - src/backend/database/routes/debug.ts
  - src/backend/utils/console-forward-transport.ts
autonomous: true
requirements:
  - QUICK-260821-KYF-01  # Terminal.tsx setIsIdle ReferenceError fix
  - QUICK-260821-KYF-02  # console-forward.log N-file rotation

must_haves:
  truths:
    - "Terminal.tsx no longer references setIsIdle anywhere (grep -c 'setIsIdle' = 0)"
    - "A 'idle' WS frame arriving at Terminal.tsx does NOT throw ReferenceError — the entire msg.type==='idle' branch is deleted (dispatch just falls through, since Terminal no longer consumes isIdle post-Phase 41-02)"
    - "When console-forward.log exceeds 5 MB, the file is renamed to console-forward.log.1 (with chain-bump of older log.1→log.2, log.2→log.3, …, log.N deleted) — NEVER truncated"
    - "After N=20 rotations, exactly 21 files exist on disk at max (console-forward.log + .log.1 through .log.20); .log.21 does not accumulate"
    - "The path console-forward.log (unchanged) still contains the newest entries; grep tooling that reads that path keeps working"
    - "Both writers (debug.ts frontend forwarder and console-forward-transport.ts backend flush) call the same rotateIfExceeds helper — a second racing writer that finds the file already rotated (size < threshold) is a no-op, and neither writer ever calls fs.writeFileSync to blank the file"
  artifacts:
    - path: "src/backend/utils/console-forward-rotator.ts"
      provides: "Shared N-file rotation helper — rotateIfExceeds(logPath, opts?)"
      exports: ["rotateIfExceeds", "MAX_FILE_BYTES", "MAX_ROTATED_FILES"]
      min_lines: 30
    - path: "src/backend/utils/console-forward-rotator.test.ts"
      provides: "Vitest suite covering small-file/rotate/max-N/race-simulation"
      min_lines: 60
    - path: "src/ui/features/terminal/Terminal.tsx"
      provides: "Terminal WS dispatch without dead setIsIdle branch"
      contains: "msg.type === \"data\""  # data branch remains
  key_links:
    - from: "src/backend/database/routes/debug.ts"
      to: "src/backend/utils/console-forward-rotator.ts"
      via: "import { rotateIfExceeds } from ../../utils/console-forward-rotator.js"
      pattern: "rotateIfExceeds\\("
    - from: "src/backend/utils/console-forward-transport.ts"
      to: "src/backend/utils/console-forward-rotator.ts"
      via: "import { rotateIfExceeds } from ./console-forward-rotator.js"
      pattern: "rotateIfExceeds\\("
---

<objective>
Ship two independent, low-risk fixes in a single deploy on `feat/tab-title-from-tmux`:

1. **Terminal.tsx setIsIdle ReferenceError regression.** Phase 41-02 commit
   `a997630f` stripped the `useState<boolean|null>` for `isIdle` from Terminal
   (comment on line 1436–1439 explicitly says PrettyView owns this signal now
   via patch #51 rework, and pane-tint patch #26 doesn't consume it). But the
   dispatch branch `if (msg.type === "idle") { … setIsIdle(msg.idle); … }` at
   lines 1435–1444 was left behind — every backend idle-transition frame now
   throws ReferenceError inside the WS onmessage handler and burns the try/catch.
   Delete the entire `msg.type === "idle"` branch so those frames silently
   fall through.

2. **console-forward.log destructive-truncation → N-file rotation.** Both
   `src/backend/database/routes/debug.ts` (frontend forwarder POST handler)
   and `src/backend/utils/console-forward-transport.ts` (backend flush) share
   one log file and both currently DESTROY all history when it exceeds
   `MAX_FILE_BYTES = 5 * 1024 * 1024` by calling
   `fs.writeFileSync(logPath, "[LOG_ROTATED at <ts>]\n")`. In production this
   truncates roughly every ~5 minutes, making post-hoc greps useless.

   Replace both destructive-truncation blocks with a shared N-file rotation
   helper (`src/backend/utils/console-forward-rotator.ts`) that renames
   `console-forward.log` → `.log.1` (bumping older files `.log.1→.log.2`, …,
   deleting `.log.N` if present) using `fs.renameSync` — atomic on POSIX. Both
   writers import and call it; a second racing writer that arrives after the
   rename finds `fs.statSync(logPath).size` under threshold and no-ops.

Purpose: Fix a live production regression (ReferenceError on every idle frame)
AND restore forensic log history (~100 MB / N=20 rolling window) so grep-based
debugging works again.

Output:
- Terminal.tsx surgically stripped of the dead branch.
- New shared rotator module + tests.
- Both existing rotation blocks in debug.ts and console-forward-transport.ts
  swapped for a single `rotateIfExceeds(logPath)` call.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@CLAUDE.md

# Source files being modified (read these before editing)
@src/ui/features/terminal/Terminal.tsx
@src/backend/database/routes/debug.ts
@src/backend/utils/console-forward-transport.ts
@src/backend/utils/console-forward-transport.test.ts
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Strip dead msg.type==="idle" dispatch branch in Terminal.tsx</name>
  <files>src/ui/features/terminal/Terminal.tsx</files>
  <behavior>
    - Before: line 1441 calls `setIsIdle(msg.idle)` — `setIsIdle` is undefined
      (removed in Phase 41-02 commit a997630f), throws ReferenceError on every
      backend idle-transition frame + WS-attach initial-state frame.
    - After: the entire `if (msg.type === "idle") { ... return; }` block
      (lines 1435–1444 in the current file) is deleted. The dispatch falls
      through to subsequent branches (`msg.type === "data"`, etc.). Idle
      frames become no-ops at the Terminal layer, which is the correct
      behavior post-Phase 41-02 (identity/PrettyView pane owns idle rendering).
    - No other file in `src/ui/features/terminal/` should change.
    - `grep -c 'setIsIdle' src/ui/features/terminal/Terminal.tsx` MUST return 0.
    - `grep -c 'msg.type === "idle"' src/ui/features/terminal/Terminal.tsx` MUST return 0.
  </behavior>
  <action>
    Open `src/ui/features/terminal/Terminal.tsx` and locate the WS onmessage
    handler around line 1425–1445 (inside the JSON.parse try). Delete the ENTIRE
    branch spanning approximately lines 1435–1444:

    - Start of deletion: the line `if (msg.type === "idle") {`
    - End of deletion: the matching closing `}` immediately before `if (msg.type === "data") {`
    - Include the 4-line explanatory comment above the `if` (lines 1436–1439
      that begin with `// Backend emits idle transitions (patch #13)…`) — it
      describes the deleted branch and becomes stale.
    - Do NOT touch the `msg.type === "pong"` branch above or the
      `msg.type === "data"` branch below.
    - Do NOT touch the `wsMsgDedup` line above — dispatch dedup logging stays.

    Rationale reference to leave in a single-line inline comment where the
    branch used to be (optional, one line only):
      `// idle frames intentionally ignored — pane-level PrettyView owns this signal (Phase 41-02 a997630f)`
    OR simply delete the branch with no replacement comment. Executor discretion.

    Do NOT introduce a `useState` re-add. Do NOT reintroduce `setIsIdle`. Do
    NOT thread the signal anywhere else in Terminal.tsx — pane-level consumers
    already receive it directly via their own WS subscriptions (per the
    original comment).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; test $(grep -c 'setIsIdle' src/ui/features/terminal/Terminal.tsx) -eq 0 &amp;&amp; test $(grep -c 'msg.type === "idle"' src/ui/features/terminal/Terminal.tsx) -eq 0 &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E 'Terminal\.tsx' | grep -v 'error TS0' | head -5 ; echo "--- tsc exit code above; empty output = clean for Terminal.tsx"</automated>
  </verify>
  <done>
    - `grep -c 'setIsIdle' src/ui/features/terminal/Terminal.tsx` returns 0.
    - `grep -c 'msg.type === "idle"' src/ui/features/terminal/Terminal.tsx` returns 0.
    - `npx tsc --noEmit` reports no Terminal.tsx errors related to this edit.
    - The `msg.type === "pong"` and `msg.type === "data"` branches remain intact
      and directly adjacent (or separated only by the optional one-line comment).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create shared N-file rotation helper + tests (RED then GREEN)</name>
  <files>src/backend/utils/console-forward-rotator.ts, src/backend/utils/console-forward-rotator.test.ts</files>
  <behavior>
    New module `src/backend/utils/console-forward-rotator.ts` exports:

    - `MAX_FILE_BYTES = 5 * 1024 * 1024` (mirrors current threshold in both callsites)
    - `MAX_ROTATED_FILES = 20` (N=20 → ~100 MB rolling retention as spec)
    - `rotateIfExceeds(logPath: string, opts?: { maxBytes?: number; maxFiles?: number }): void`

    Behavior of `rotateIfExceeds(logPath)`:
    1. `fs.statSync(logPath).size` — if the file does not exist OR size ≤ `maxBytes`, return immediately (no-op). The stat error path (ENOENT) is swallowed as "no rotation needed".
    2. If size > `maxBytes`, perform the rename chain synchronously:
       - Iterate `i` from `maxFiles` down to 1:
         - If `${logPath}.${i}` exists AND `i === maxFiles`: `fs.unlinkSync` it (drop the oldest).
         - Otherwise if `${logPath}.${i-1}` exists (where `i-1 === 0` means the base `logPath`): `fs.renameSync(${logPath}.${i-1}, ${logPath}.${i})`. Treat `${logPath}.0` as `logPath`.
       - Rename ordering MUST go from highest index down to base so no rename clobbers an existing file.
    3. `fs.renameSync` is atomic on POSIX — a concurrent second caller that arrives after the rename observes `size ≤ maxBytes` (the new empty base does not exist yet, ENOENT path) and returns a no-op. Never call `fs.writeFileSync` and never truncate.
    4. Errors from `unlinkSync`/`renameSync` are swallowed (best-effort, mirrors existing callsite semantics — file-mirror is never allowed to crash the process). Wrap each rename in try/catch, do not throw.

    Tests in `src/backend/utils/console-forward-rotator.test.ts` (mirror the
    tmp-file pattern from `console-forward-transport.test.ts`):

    - **Test 1** (small-file no-op): Write a 100-byte file, call `rotateIfExceeds` with `maxBytes: 5*1024*1024`, assert the base file still exists at that size and `.log.1` does NOT exist.
    - **Test 2** (over-threshold rotates): Write a file &gt; `maxBytes` (use `maxBytes: 1024` to keep test fast — write ~2 KB), call `rotateIfExceeds`. Assert base is gone (ENOENT) and `.log.1` exists with the original content.
    - **Test 3** (chain-bump): Pre-create `.log`, `.log.1`, `.log.2` with distinct contents "base"/"one"/"two"; write base &gt; threshold. Call `rotateIfExceeds`. Assert `.log.1` == "base", `.log.2` == "one", `.log.3` == "two", base does not exist.
    - **Test 4** (max-N drop-oldest): With `maxFiles: 3`, pre-create `.log`, `.log.1`, `.log.2`, `.log.3` all with distinct content; over-threshold base. After `rotateIfExceeds`: `.log.3` == old ".log.2" content, `.log.2` == old ".log.1", `.log.1` == old base, `.log.4` does NOT exist. Old `.log.3` was unlinked.
    - **Test 5** (race-simulation): Write over-threshold base; call `rotateIfExceeds` twice back-to-back synchronously. Second call must be a no-op — the original base content is preserved in `.log.1`, `.log.2` does NOT exist (i.e. the second call did NOT further rotate an already-rotated chain since base is gone).
    - **Test 6** (rename-failure swallowed): Spy on `fs.renameSync` to throw, expect `rotateIfExceeds` not to throw.

    RED first (executor writes the tests, runs, confirms they fail because module doesn't exist), commits the failing test, then GREEN (implements the helper, runs, all 6 pass).
  </behavior>
  <action>
    RED phase:
    1. Create `src/backend/utils/console-forward-rotator.test.ts` with the 6
       tests described above. Follow the exact patterns from
       `src/backend/utils/console-forward-transport.test.ts`:
       - `import fs from "fs"; import os from "os"; import path from "path";`
       - `beforeEach`: allocate unique `tmpLog = path.join(os.tmpdir(), \`cfr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log\`)`.
       - `afterEach`: `try { fs.unlinkSync(tmpLog) } catch {}` and for each rotated suffix `.1` through `.20`, same swallow-unlink pattern. Call `vi.restoreAllMocks()`.
       - Import from `./console-forward-rotator.js` (the .js extension is required — mirrors the existing test file).
    2. Run `cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/utils/console-forward-rotator.test.ts 2>&amp;1 | tail -30` — MUST fail (module not found).
    3. Commit: `test(quick-260821-kyf): add failing rotator suite (RED)`.

    GREEN phase:
    4. Create `src/backend/utils/console-forward-rotator.ts` implementing the
       described behavior. Structure:

       - Top-of-file JSDoc block: 4–6 lines explaining that this module is the
         shared rotation helper for both `debug.ts` and
         `console-forward-transport.ts` (used to be duplicated destructive-truncation
         logic, replaced with N-file rotation per quick-260821-kyf).
       - `export const MAX_FILE_BYTES = 5 * 1024 * 1024;`
       - `export const MAX_ROTATED_FILES = 20;`
       - `export function rotateIfExceeds(logPath: string, opts?: { maxBytes?: number; maxFiles?: number }): void { … }`
       - Internal iteration: `for (let i = maxFiles; i >= 1; i--)`, treating index 0 as the base path.
       - Wrap each `fs.renameSync` and `fs.unlinkSync` in its own try/catch so a
         single failed rename does not abort the chain — but do NOT log anywhere
         (callers do their own best-effort error handling).
       - Do NOT `import fs from "fs"` at top-level twice — one import.
       - No dependencies on debug.ts or console-forward-transport.ts (would
         create circular / heavy imports).
    5. Run the tests: `npx vitest run src/backend/utils/console-forward-rotator.test.ts` — all 6 MUST pass.
    6. Commit: `feat(quick-260821-kyf): implement N-file console-forward rotator (GREEN)`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/utils/console-forward-rotator.test.ts 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    - `src/backend/utils/console-forward-rotator.ts` exists and exports `rotateIfExceeds`, `MAX_FILE_BYTES`, `MAX_ROTATED_FILES`.
    - `src/backend/utils/console-forward-rotator.test.ts` has ≥ 6 tests, all pass under `npx vitest run`.
    - Two commits present: RED (failing test) then GREEN (implementation + passing test).
    - No calls to `fs.writeFileSync(logPath, …)` anywhere in the new module — grep-verifiable.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Swap both writer callsites to use shared rotator</name>
  <files>src/backend/database/routes/debug.ts, src/backend/utils/console-forward-transport.ts</files>
  <behavior>
    - `src/backend/database/routes/debug.ts` `handleConsoleLog`: the current
      block at lines 100–116 (`try { … currentSize = fs.statSync … if (currentSize > MAX_FILE_BYTES) { fs.writeFileSync(...) } … }`) — the `fs.statSync` + `if (currentSize > MAX_FILE_BYTES)` + `fs.writeFileSync` sub-block is replaced with a single call `rotateIfExceeds(logPath);`. The `fs.appendFileSync` call and the surrounding try/catch that swallows errors via `apiLogger.error` are UNCHANGED.
    - The `MAX_FILE_BYTES = 5 * 1024 * 1024` module constant in `debug.ts` is deleted (moved into the shared rotator). If `MAX_FILE_BYTES` is referenced elsewhere in debug.ts, keep the local const — grep the file first; per the file we already read, it appears only on lines 60 and 111, so both callsites go away.
    - `src/backend/utils/console-forward-transport.ts` `flush()`: the equivalent block at lines 68–82 is replaced with `rotateIfExceeds(logPath);`. `fs.appendFileSync` and surrounding try/catch are unchanged. The `MAX_FILE_BYTES = 5 * 1024 * 1024` constant on line 51 is deleted.
    - After both swaps, the ONLY `fs.writeFileSync` calls remaining that touch `logPath` are ZERO — verified by grep.
    - Existing test file `console-forward-transport.test.ts` must still pass unmodified (rotation was never covered there; the swap is behavior-preserving for the small-file case tested).
    - Header JSDoc blocks in both files: update the outdated "File rotates at 5 MB with a [LOG_ROTATED at <ts>] marker" comment in debug.ts (line 25) and the equivalent lines in console-forward-transport.ts (lines 11–13) to describe the new N-file rotation. Keep the update short (1–2 sentences pointing to `console-forward-rotator.ts`).
  </behavior>
  <action>
    In `src/backend/database/routes/debug.ts`:
    1. Add `import { rotateIfExceeds } from "../../utils/console-forward-rotator.js";` alongside the existing imports at the top (before `apiLogger` import to keep alpha order, or grouped with the other utils import — executor discretion, follow the file's existing convention).
    2. Delete `const MAX_FILE_BYTES = 5 * 1024 * 1024;` on line 60.
    3. In `handleConsoleLog`, replace the block starting with `let currentSize = 0;` through `);` of the `fs.writeFileSync` call (lines 103–116) with a single call:
       ```
       rotateIfExceeds(logPath);
       ```
       (Do NOT wrap in fenced code in the file — this is literal source. The
       `rotateIfExceeds(logPath);` line replaces ~13 lines of the current
       stat/rotate/writeFileSync block.)
    4. Preserve the surrounding `try { … } catch (err) { apiLogger.error(…) }` block wrapping the `logPath = getLogPath()` + rotator + appendFileSync sequence.
    5. Update the header JSDoc line "File rotates at 5 MB with a [LOG_ROTATED at &lt;ts&gt;] marker." to something like: "File rotation delegated to console-forward-rotator.ts (N-file rename chain, N=20)."

    In `src/backend/utils/console-forward-transport.ts`:
    6. Add `import { rotateIfExceeds } from "./console-forward-rotator.js";` alongside `import fs from "fs";`.
    7. Delete `const MAX_FILE_BYTES = 5 * 1024 * 1024;` on line 51.
    8. In `flush()`, replace the block starting `let currentSize = 0;` through the closing `}` of the `if (currentSize > MAX_FILE_BYTES)` writeFileSync branch (lines 69–82) with `rotateIfExceeds(logPath);`.
    9. Preserve the surrounding try/catch that swallows errors via `process.stderr.write` (D-19 pattern).
    10. Update the JSDoc bullet "Log rotation mirrors debug.ts: file > 5 MB → overwrite with rotation marker, then append. Simultaneous rotation with frontend handler is safe on Linux (both use synchronous fs.writeFileSync/appendFileSync; T-31-17)." to: "Log rotation delegated to shared console-forward-rotator.ts (N-file rename chain, N=20). Concurrent rotation with debug.ts is safe: fs.renameSync is atomic on POSIX; a losing racer observes size &lt; threshold and no-ops (T-31-17 concern preserved — never truncates)."

    After both edits:
    11. Run `cd /home/ubuntu/skynet-tina &amp;&amp; grep -n 'fs.writeFileSync' src/backend/database/routes/debug.ts src/backend/utils/console-forward-transport.ts` — MUST produce zero output (both destructive writes gone).
    12. Run `cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/utils/console-forward-transport.test.ts` — all existing tests MUST still pass unmodified.
    13. Run `cd /home/ubuntu/skynet-tina &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E 'debug\.ts|console-forward-transport\.ts|console-forward-rotator\.ts' | head -10` — MUST be empty (no new tsc errors introduced).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; test $(grep -c 'fs.writeFileSync' src/backend/database/routes/debug.ts) -eq 0 &amp;&amp; test $(grep -c 'fs.writeFileSync' src/backend/utils/console-forward-transport.ts) -eq 0 &amp;&amp; test $(grep -c 'rotateIfExceeds' src/backend/database/routes/debug.ts) -ge 1 &amp;&amp; test $(grep -c 'rotateIfExceeds' src/backend/utils/console-forward-transport.ts) -ge 1 &amp;&amp; npx vitest run src/backend/utils/console-forward-transport.test.ts src/backend/utils/console-forward-rotator.test.ts 2>&amp;1 | tail -15</automated>
  </verify>
  <done>
    - Both `debug.ts` and `console-forward-transport.ts` import `rotateIfExceeds` from the new module.
    - Both files contain exactly zero `fs.writeFileSync` calls (grep-verifiable).
    - Both files call `rotateIfExceeds(logPath);` inside their existing best-effort try/catch, immediately before the preserved `fs.appendFileSync` call.
    - `MAX_FILE_BYTES` local constants deleted from both files.
    - Header JSDoc blocks updated to describe delegation to the shared rotator.
    - Full suite `npx vitest run src/backend/utils/console-forward-transport.test.ts src/backend/utils/console-forward-rotator.test.ts` passes with no regressions.
    - `npx tsc --noEmit` reports no new errors for the three touched backend files.
  </done>
</task>

</tasks>

<verification>
Overall phase checks (Claude runs after all three tasks complete):

1. **Regression check on Terminal.tsx WS dispatch:**
   ```
   grep -c 'setIsIdle' src/ui/features/terminal/Terminal.tsx  # → 0
   grep -c 'msg.type === "idle"' src/ui/features/terminal/Terminal.tsx  # → 0
   grep -c 'msg.type === "data"' src/ui/features/terminal/Terminal.tsx  # → ≥ 1 (unchanged branch)
   ```

2. **Rotator wiring check:**
   ```
   grep -c 'rotateIfExceeds' src/backend/database/routes/debug.ts  # → ≥ 1
   grep -c 'rotateIfExceeds' src/backend/utils/console-forward-transport.ts  # → ≥ 1
   grep -c 'fs.writeFileSync' src/backend/database/routes/debug.ts src/backend/utils/console-forward-transport.ts  # → 0
   ```

3. **Test suite:**
   ```
   npx vitest run src/backend/utils/console-forward-rotator.test.ts src/backend/utils/console-forward-transport.test.ts
   ```
   All tests pass, ≥ 6 new rotator tests + all pre-existing transport tests.

4. **Typecheck:**
   ```
   npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'Terminal\.tsx|debug\.ts|console-forward-transport\.ts|console-forward-rotator\.ts'
   ```
   MUST be empty (no new errors on any of the four touched files).

5. **No Nginx changes required** (no new backend routes — the console-log POST endpoint already exists and its route is unchanged).

6. **Deploy readiness:**
   - Backend changed (both `debug.ts` and `console-forward-transport.ts`) → `docker compose up -d --force-recreate skynet` required.
   - Frontend changed (`Terminal.tsx`) → same force-recreate covers it (single container).
   - Deploy MUST run under the 15-minute deadman rollback timer (CLAUDE.md hard constraint, no exceptions per Ashley 2026-07-03).
</verification>

<success_criteria>
Ship-ready when:

- Terminal.tsx no longer throws `ReferenceError: setIsIdle is not defined` when a backend `{type: "idle", idle: <bool>}` WS frame arrives (verified by production logs post-deploy showing zero such errors on the first idle transition).
- console-forward.log rotation preserves history: after ~5 MB write, `console-forward.log.1` exists carrying the previously-current content; `console-forward.log` continues receiving new appends; existing `sudo cat /opt/skynet/console-forward-logs/console-forward.log` grep workflows keep working (path unchanged).
- Post-deploy, `ls -la /opt/skynet/console-forward-logs/` on the EC2 shows `console-forward.log` plus `.log.1` (and `.log.2` etc. accumulating over time up to `.log.20`) — no more sudden emptying.
- All vitest suites for `console-forward-*` pass locally before push.
- Deploy behind 15-min deadman rollback timer as always.
</success_criteria>

<output>
Create `.planning/quick/260821-kyf-setisidle-log-rotation/260821-kyf-SUMMARY.md` when done, following the standard SUMMARY template.
</output>
