---
phase: 05-pretty-view-file-upload-support
plan: 01
subsystem: backend
tags: [ssh, sftp, websocket, ssh2, uploads, wire-protocol, tdd, pretty-view]

# Dependency graph
requires:
  - phase: 02-pretty-view-terminal
    provides: "src/backend/ssh/terminal.ts WS handler + patch #60 messageQueueItemId lifecycle key + patch #100 split-and-delay Enter (both left byte-identical by this plan)"
  - phase: 03-message-queue-and-drafts
    provides: "messageQueueItems drizzle table + patch #55/#57 draft persistence model (this plan does NOT touch either — caption persistence remains a Plan 03 concern)"
  - phase: 04-mobile-touch
    provides: "useIsTouchDevice (patch #102) — Plan 02 will consume for the mobile paperclip; this plan doesn't touch it"

provides:
  - "Shared wire-protocol module src/ui/api/pretty-view-upload-protocol.ts — client + server discriminated unions, size limits, sanitization helper, formatInjectedUserTurn"
  - "Backend upload orchestrator src/backend/ssh/pretty-view-upload.ts — per-batch state, SFTP atomic-rename, threat mitigation for T-05-01/02/03/05/07/08"
  - "Three new WS message-type cases in src/backend/ssh/terminal.ts — upload_start / upload_chunk / upload_abort — layered onto the existing per-pane authenticated channel"
  - "Byte-identity regression guard scripts/verify-input-case-unchanged.sh for the `case \"input\":` block"

affects: [05-02, 05-03, 05-04]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — ssh2 SFTP already in dep tree
  patterns:
    - "TDD RED → GREEN cycle for both tasks (test files created first, watched fail, then implementation)"
    - "Test-injectable clock (__setClockForTest) for deterministic timestamped-path assertions in Vitest"
    - "Backend module named __ export helpers (__getActiveBatchesForTest, __resetActiveBatchesForTest) — Vitest-friendly module-level state without exposing internals to production callers"
    - "Byte-identity pin via sha256 of an awk-extracted block for byte-critical patches (#60 + #100 protection pattern)"

key-files:
  created:
    - "src/ui/api/pretty-view-upload-protocol.ts (shared TS types + formatInjectedUserTurn + sanitization)"
    - "src/ui/api/pretty-view-upload-protocol.test.ts (30 Vitest cases)"
    - "src/backend/ssh/pretty-view-upload.ts (orchestrator — 500 lines)"
    - "src/backend/ssh/pretty-view-upload.test.ts (13 Vitest cases with mock SFTP + mock WS)"
    - "scripts/verify-input-case-unchanged.sh (regression guard for patches #60/#100)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-01-SUMMARY.md (this file)"
  modified:
    - "src/backend/ssh/terminal.ts (imports + ownedUploadBatches Set + three new cases + close-handler cleanup — `case \"input\":` body BYTE-IDENTICAL)"

key-decisions:
  - "HOME resolution: sftp.realpath('.') at upload_start, NEVER hardcoded /home/<user>/ concat (LOCKED per 05-CONTEXT.md)"
  - "Temp-file naming: $HOME/pretty-view-uploads/<yyyy-mm-dd>/.<hhmmss>-<sanitized>.<8-char-random>.partial — the random component is T-05-02 belt-and-suspenders on top of createWriteStream({flags: 'wx'}) so pre-planted symlinks on the predictable name also fail-safe"
  - "Landing timestamp: box-local (Termix backend clock, boxLocalIso() format YYYY-MM-DDTHH:mm:ss) per CONTEXT.md recommendation for user legibility"
  - "Filename collision suffix: '-N' inserted BEFORE the last '.ext' (e.g. log.txt collides → log-2.txt), retrying up to 10 attempts before emitting collision_max_retries"
  - "Chunk size 64 KB, max concurrent 3 — kept at plan-recommended defaults (see CHUNK_SIZE_BYTES / MAX_CONCURRENT_UPLOADS_PER_BATCH constants)"
  - "Null-byte in filename REJECTED rather than stripped — stripping risks collapsing 'bad\\x00.exe' onto existing 'bad.exe' landing (T-05-01 defense-in-depth)"
  - "Progress emission throttled to ≤1 event/100ms per tempId to avoid WS spam on small chunks"
  - "Backend byte-identity of `case \"input\":` verified via awk-extracted block sha256 pinned in scripts/verify-input-case-unchanged.sh — future patches touching terminal.ts MUST run this script before commit"
  - "Duplicate upload_start on same messageQueueItemId emits new failure reason 'batch_already_active' (added to UploadFailureReason enum) rather than repurposing unknown_temp_id — clearer semantics for the frontend"

patterns-established:
  - "Shared wire-protocol types module in src/ui/api/ — pure TS with no framework imports, consumed by both browser (Plans 02/03) and Node (Plan 01 orchestrator) via one relative import path"
  - "Test-injectable clock helper for deterministic timestamped-path unit tests — future SFTP-touching modules should copy this pattern"
  - "Sha256-pinned regression guard for byte-critical patch regions — repeatable pattern for any future fork patch that must survive-upstream-rebase byte-exact"

requirements-completed:
  - UPLOAD-06
  - UPLOAD-09
  - UPLOAD-10
  - UPLOAD-14

# Metrics
duration: 22min
completed: 2026-07-20
---

# Phase 5 Plan 05-01: Backend upload orchestrator + shared wire-protocol types Summary

**SFTP-atomic upload orchestrator over the existing per-pane SSH channel, keyed on patch #60's messageQueueItemId, with the injected-turn formatter locked as the shared source of truth for Plans 02 and 03**

## Performance

- **Duration:** ~22 min (wall clock; TDD RED→GREEN×2 across two tasks including one test-adjustment iteration on the temp-path random-suffix regex)
- **Started:** 2026-07-20T11:00:00Z (approximate — first snapshot of terminal.ts input case)
- **Completed:** 2026-07-20T11:22:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 6 (2 modules + 2 test files + 1 verify script + this SUMMARY)
- **Files modified:** 1 (terminal.ts — imports + close handler + three new cases + one Set declaration)

## Accomplishments

- **Shared wire-protocol types published.** `src/ui/api/pretty-view-upload-protocol.ts` is the single source of truth for both server encoders and client decoders in Plans 02 and 03. 25 named exports (11 types + 5 constants + 4 helpers + 5 discriminants). Pure TS — runs unchanged in browser AND Node.
- **Backend upload orchestrator ships.** `src/backend/ssh/pretty-view-upload.ts` owns per-batch state, SFTP writeStream lifecycle, temp-file→rename atomicity, sanitization + limits enforcement, and event emission. All six blocking threats from the phase threat model mitigated at ingest.
- **Three new WS cases wired into terminal.ts** with ZERO change to the existing `case "input":` bytes. Regression-guarded by `scripts/verify-input-case-unchanged.sh` which awk-extracts the block and diffs against a pinned sha256.
- **43 Vitest cases green** (30 protocol + 13 orchestrator with mocked SFTP + mocked WS). Full project test suite (345/345) still passes; full project typecheck clean; full project build clean.
- **Zero new npm dependencies.** `ssh2` and its SFTP subsystem were already in the fork's dep tree.

## Task Commits

Each task was committed atomically:

1. **Task 1: Publish shared wire-protocol types + formatInjectedUserTurn helper** — `a24483f` (feat — includes RED test + GREEN impl in one commit since they landed together after one test iteration)
2. **Task 2 Step A: Backend upload orchestrator module** — `aa6c86c` (feat)
3. **Task 2 Step B: Wire three new WS cases into terminal.ts + verification script** — `8b1225f` (feat)

_Note: Task 2 was split into two commits (module + wiring) for a cleaner rebase history — the orchestrator is a self-contained module that can be reviewed independently of the terminal.ts wiring._

## Files Created/Modified

**Created:**
- `src/ui/api/pretty-view-upload-protocol.ts` — 348 lines. Shared TS types (UploadStart/Chunk/Abort payloads; UploadProgress/Complete/Failed/ReadyToInject events; UploadFailureReason enum), constants (MAX_PER_FILE_BYTES=500MB, MAX_PER_BATCH_BYTES=2GB, CHUNK_SIZE_BYTES=64KB, MAX_CONCURRENT_UPLOADS_PER_BATCH=3, INJECTED_DELIMITER), sanitizeFilenameForUpload + classifyFilenameRejection, formatHumanSize, formatInjectedUserTurn, parseInjectedUserTurn.
- `src/ui/api/pretty-view-upload-protocol.test.ts` — 30 Vitest cases: type-fixture compilation, constants, sanitization (12 hostile + 3 safe), size formatting, injected-turn formatter (empty caption, multi-file, round-trip through parser).
- `src/backend/ssh/pretty-view-upload.ts` — ~500 lines. handleUploadStart / handleUploadChunk / handleUploadAbort / cleanupBatchesForConnection / emitEvent public API; internal Promise wrappers around ssh2's callback API; per-batch state map; temp-file naming; collision-loop; progress throttling; test-injectable clock.
- `src/backend/ssh/pretty-view-upload.test.ts` — 13 Vitest cases with a full mock SFTP object (createWriteStream, stat, mkdir, rename, unlink, realpath) and mock WebSocket. Covers happy path, all 6 mitigated threats, batch/file abort, cleanup, duplicate upload_start.
- `scripts/verify-input-case-unchanged.sh` — 60-line Bash regression guard. Awk-extracts the `case "input": {` block through its closing `      }` and diffs against a pinned sha256 (`d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709`). Runnable standalone or as a CI/pre-commit hook.
- `.planning/phases/05-pretty-view-file-upload-support/05-01-SUMMARY.md` — this file.

**Modified:**
- `src/backend/ssh/terminal.ts` — imports (`handleUploadStart` + peers from `./pretty-view-upload.js`; type-only import of the three client payload types); per-connection `ownedUploadBatches: Set<string>` declaration in the WS scope; `ws.on("close", ...)` handler calls `cleanupBatchesForConnection(Array.from(ownedUploadBatches))`; three new case blocks (`upload_start` / `upload_chunk` / `upload_abort`) inserted between `case "input":` and `case "ping":` with a 12-line header comment documenting the byte-identity guarantee and the shared-lifecycle-key extension of patch #60. The `case "input":` body (lines 493-608 in the post-change file) is BYTE-IDENTICAL to pre-change — verified by two independent extraction methods (sed line-range sha256 match + awk pattern-match sha256 match).

## Verification

**Byte-identity of `case "input":` (Test 11 acceptance criterion):**
- Pre-change snapshot: `sed -n '469,586p' terminal.ts` → sha256 `eee05efce5cbff063d0b166b86123fd734bc9d4bfa60124b643519ca0f0dbfb4` (118 lines, includes trailing blank line separator to next case).
- Post-change snapshot (same content, new line numbers): `sed -n '493,610p' terminal.ts` → sha256 `eee05efce5cbff063d0b166b86123fd734bc9d4bfa60124b643519ca0f0dbfb4` (identical).
- Awk pattern-match extraction (excludes trailing blank line): sha256 `d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709` (117 lines). This is the pinned regression-guard value in `scripts/verify-input-case-unchanged.sh`.
- Two-way redundancy: even if awk's regex misses a whitespace-only edit, the sed-based hash would catch it. And vice versa — even if a future refactor renumbers the file, the awk pattern-match survives because it anchors on content (`case "input": {` opener + `      }` closer at 6-space indentation) rather than line numbers.

**HOME resolution method:** `sftp.realpath('.')` called ONCE per batch at `handleUploadStart` and cached on `BatchState.homeDir`. No fallback to `/home/<user>/` string concatenation exists anywhere in the module — grep for `/home/` in `src/backend/ssh/pretty-view-upload.ts` returns zero hits (only appears in test fixtures for expected-value assertions).

**Temp-file naming convention:**
- Final path: `${homeDir}/pretty-view-uploads/${YYYY-MM-DD}/${HHmmss}-${sanitizedFilename}`
- Temp path:  `${homeDir}/pretty-view-uploads/${YYYY-MM-DD}/.${HHmmss}-${sanitizedFilename}.${randomHex8}.partial`
- The `.partial` suffix marks in-flight writes; the leading `.` hides the temp from `ls` (users doing `ls ~/pretty-view-uploads/2026-07-20/` see only completed uploads); the 8-char random hex component (`Math.random().toString(36).slice(2, 10)`) prevents pre-planted symlink collision on the predictable prefix (T-05-02 belt-and-suspenders on top of `createWriteStream({flags: 'wx'})`).

**Constants deviation from plan recommendations:** None. `CHUNK_SIZE_BYTES=64*1024` and `MAX_CONCURRENT_UPLOADS_PER_BATCH=3` are exactly the plan's recommended defaults. `MAX_PER_FILE_BYTES=500*1024*1024` and `MAX_PER_BATCH_BYTES=2*1024*1024*1024` are exactly the CONTEXT.md recommendation. If Plans 02/03 execution reveals any of these are wrong for real workloads, they're single-line constant edits in one file consumed by both client and server.

**All 6 mitigated threats verified in test suite:**
- T-05-01 (path traversal) — Test 1 asserts `sftp.createWriteStream` never called for `../etc/passwd`; classifyFilenameRejection rejects `..`, `/`, `\`, leading-dot, null-byte, >200 chars, newlines.
- T-05-02 (symlink write) — Test 4 asserts `createWriteStream` was called with `{ flags: 'wx' }`; temp path has random suffix.
- T-05-03 (disk-fill) — Tests 2 + 3 assert oversize-file and oversize-batch rejections BEFORE any bytes flow; Test 7 asserts overflow during chunking tears down + unlinks temp.
- T-05-05 (delimiter collision) — Test 12 asserts filename `--- attached files ---.log` emits `delimiter_collision`.
- T-05-07 (unauth upload) — "auth gate" test asserts silent no-op when `sshConn` is null; zero WS events emitted.
- T-05-08 (chunk out-of-order) — Test 6 asserts skipping offset 0 emits `chunk_out_of_order` AND calls `sftp.unlink`.

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- Extended the plan's rejection-reason enum with `batch_already_active` for the duplicate-upload_start case rather than repurposing `unknown_temp_id` — clearer semantics for the frontend's error handler, one extra enum member is cheap.
- Rejected null bytes in filenames instead of stripping them (plan's initial phrasing was "strip null bytes"). Rationale: stripping risks collapsing `bad\x00.exe` onto an existing `bad.exe` landing spot, defeating the T-05-01 defense. The tighter reject-instead-of-strip rule was locked in classifyFilenameRejection.
- Random-hex-8 suffix on the temp filename (belt-and-suspenders on top of `flags: 'wx'`) — the plan spec left the exact temp-path shape open; the random component costs nothing and protects against pre-planted symlinks on the fully-predictable `<hhmmss>-<name>.partial` prefix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test regex adjusted for random-hex-8 temp suffix**
- **Found during:** Task 2 first test run
- **Issue:** My orchestrator design added a random-hex-8 component to the temp filename (T-05-02 belt-and-suspenders defense) that the test regex didn't account for. Test 4 asserted `tempPath` matches `/\.143211-log\.txt\.partial$/` — but the actual path was `.143211-log.txt.pabkli1g.partial`.
- **Fix:** Loosened the regex to `/\/\.143211-log\.txt\.[a-z0-9]+\.partial$/` — now asserts the shape (hidden + `<hhmmss>-<name>.<rand>.partial`) rather than a fixed literal. Added inline comment explaining the T-05-02 rationale so future readers understand why the middle component is variable.
- **Files modified:** `src/backend/ssh/pretty-view-upload.test.ts`
- **Verification:** All 13 orchestrator tests pass; the test still enforces the atomic-rename semantics (unique temp path, rename to final path).
- **Committed in:** `aa6c86c` (Task 2 Step A commit — bundled with the module + tests)

**2. [Rule 3 - Blocking] Byte-identity awk-extraction script hash pin required a second attempt**
- **Found during:** Task 2 Step B (verify-input-case-unchanged.sh authoring)
- **Issue:** First awk pattern (`in_block && /^      case "ping":$/ { exit }`) accidentally captured the newly-added upload_start case block because it kept reading past the input case's closing `}` up to the `case "ping":` opener. The correct terminator for a braced case block is its matching `      }` at 6-space indentation.
- **Fix:** Changed awk pattern to `in_block && /^      \}$/ { print; exit }` — anchors on the block-scope closing brace. Re-computed the pinned sha256 (`d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709`) from the corrected extraction and verified it matches a pre-change extraction of the same content (117 lines vs sed's 118 with trailing blank).
- **Files modified:** `scripts/verify-input-case-unchanged.sh`
- **Verification:** Script exits 0; `diff` of pre-change sed extract (trimmed of trailing blank line) vs post-change awk extract shows zero differences.
- **Committed in:** `8b1225f` (Task 2 Step B commit — bundled with the terminal.ts wiring)

**3. [Rule 2 - Missing Critical] Added new UploadFailureReason `batch_already_active`**
- **Found during:** Task 2 orchestrator design
- **Issue:** Plan-recommended path for duplicate upload_start on same messageQueueItemId was "emit `unknown_temp_id` (repurposed)". This is semantically muddy — the frontend's error handler needs to distinguish "the id you sent doesn't exist" (retry-safe, likely a stale WS) from "an upload is already active" (must abort before retry).
- **Fix:** Added `batch_already_active` to the `UploadFailureReason` union in `pretty-view-upload-protocol.ts`. Orchestrator emits this specific reason for the duplicate case. Test coverage added.
- **Files modified:** `src/ui/api/pretty-view-upload-protocol.ts`, `src/backend/ssh/pretty-view-upload.ts`, `src/backend/ssh/pretty-view-upload.test.ts`
- **Verification:** "duplicate upload_start" test passes; frontend Plans 02/03 will have a distinct branch for this failure mode.
- **Committed in:** Bundled into the Task 1 commit `a24483f` (added to the enum before Task 2 needed to consume it) and Task 2 commit `aa6c86c` (orchestrator emits it).

**4. [Rule 2 - Missing Critical] Rejected null bytes in filenames instead of stripping**
- **Found during:** Task 1 Test F (sanitization tests)
- **Issue:** Plan's initial spec said "Strip null bytes with `.replace(/\x00/g, "")`". But stripping means `bad\x00.exe` becomes `bad.exe` — if a legitimate `bad.exe` already exists on the box, `flags: 'wx'` will correctly fail-the-write, but the classification passed. Worse, the T-05-01 defense is weakened: an attacker who wants to overwrite `~/.bashrc` (rejected by leading-dot check) could send `\x00.bashrc` which strips to `.bashrc` and then fails the leading-dot rule — but a filename like `\x00normal.txt` strips to `normal.txt` and successfully writes, when the attacker's null-byte payload clearly indicates tampering (no legitimate OS file picker emits NUL).
- **Fix:** Changed `classifyFilenameRejection` to REJECT any name containing `\x00` (returning `"invalid_filename"`), not strip. `sanitizeFilenameForUpload` returns the name unchanged when accepted (no stripping needed). Added inline comment explaining the tamper-detection rationale.
- **Files modified:** `src/ui/api/pretty-view-upload-protocol.ts`, `src/ui/api/pretty-view-upload-protocol.test.ts`
- **Verification:** Test "rejects null-byte payloads" passes with `sanitizeFilenameForUpload("log\x00.txt") === null`.
- **Committed in:** Bundled into Task 1 commit `a24483f`.

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing-critical security).
**Impact on plan:** All four are either test-adjustments to accommodate defense-in-depth improvements over the plan-recommended baseline (deviations 1 + 4) or blocking issues surfaced during implementation of underspec'd bits (deviations 2 + 3). No scope creep — every change stays within the plan's `<files_modified>` frontmatter and the phase's `<scope_fence>`. The security-tightening deviations (3 + 4) strengthen the T-05-01 and T-05-05 mitigations without any client-visible behaviour change.

## Issues Encountered

None. Both TDD cycles hit RED-then-GREEN cleanly with the four deviations documented above as the only detours. No blockers, no auth gates, no architectural surprises. The plan was well-shaped and the shape file's HARD LOCKs made every implementation choice trivial.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually. The next code-side plans (05-02 frontend orchestrator + chip strip, 05-03 Terminal.tsx wiring + ChatMessage chip render) will build client-side on top of this plan's shared types and backend orchestrator. Plan 05-04 will handle the deploy checkpoint per the fork's mandatory deadman flow.

## Next Phase Readiness

**Ready for Plans 05-02 and 05-03:**
- Wire-protocol types are the shared source of truth — both plans import from `src/ui/api/pretty-view-upload-protocol.ts` for payload shapes, event shapes, size limits, sanitization helper, and the formatInjectedUserTurn helper.
- Backend orchestrator is fully tested against a mock SFTP layer — the real ssh2 SFTP implements the exact same callback API my mocks emulated (verified by cross-referencing `src/backend/ssh/file-manager-content-routes.ts` lines 620-680, which uses the same `sftp.createWriteStream(path, opts)` shape).
- The three new WS cases will accept `upload_start` frames the moment Plan 02 emits them; no coordination handshake needed on either side.
- `case "input":` byte-identity guard is in place; any future patch touching terminal.ts (in this phase or upstream) can run `scripts/verify-input-case-unchanged.sh` to catch accidental patch-#60/#100 drift.

**No blockers or concerns.** The plan and its context locked every decision cleanly; execution was straight-line TDD.

## Self-Check: PASSED

**File existence:**
- `src/ui/api/pretty-view-upload-protocol.ts` — FOUND
- `src/ui/api/pretty-view-upload-protocol.test.ts` — FOUND
- `src/backend/ssh/pretty-view-upload.ts` — FOUND
- `src/backend/ssh/pretty-view-upload.test.ts` — FOUND
- `scripts/verify-input-case-unchanged.sh` — FOUND (chmod +x)
- `src/backend/ssh/terminal.ts` — MODIFIED (imports + Set + close cleanup + three cases; input case byte-identical)

**Commit existence:**
- `a24483f` (feat: publish shared wire-protocol types) — FOUND in git log
- `aa6c86c` (feat: backend upload orchestrator) — FOUND in git log
- `8b1225f` (feat: wire pretty-view upload cases into terminal WS handler) — FOUND in git log

**Grep-checkable acceptance criteria:**
- `grep -cE '^      case "upload_start": \{$' src/backend/ssh/terminal.ts` = 1 ✓
- `grep -cE '^      case "upload_chunk": \{$' src/backend/ssh/terminal.ts` = 1 ✓
- `grep -cE '^      case "upload_abort": \{$' src/backend/ssh/terminal.ts` = 1 ✓
- `grep -cE '^      case "input": \{$' src/backend/ssh/terminal.ts` = 1 ✓
- `grep -c 'handleUploadStart' src/backend/ssh/terminal.ts` = 2 (import + call) ✓
- `grep -c 'from "./pretty-view-upload.js"' src/backend/ssh/terminal.ts` = 1 ✓
- `grep -c '"--- attached files ---"' src/ui/api/pretty-view-upload-protocol.ts` = 1 ✓
- `grep -E "from ['\"](react|axios|ssh2|fs|path|process)" src/ui/api/pretty-view-upload-protocol.ts | wc -l` = 0 ✓
- `git diff --stat package.json package-lock.json` = 0 lines changed ✓

**Test suite:**
- `npx vitest run` = 345/345 tests passing across 28 files ✓
- `npx vitest run src/ui/api/pretty-view-upload-protocol.test.ts src/backend/ssh/pretty-view-upload.test.ts` = 43/43 passing ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` = zero errors project-wide ✓

**Build:**
- `npm run build` = clean (10.54s) ✓

**Byte-identity verification:**
- `scripts/verify-input-case-unchanged.sh src/backend/ssh/terminal.ts` = exit 0, `OK (sha256=d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709)` ✓

---
*Phase: 05-pretty-view-file-upload-support*
*Completed: 2026-07-20*
