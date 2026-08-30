---
phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag
plan: 03
subsystem: backend
tags: [backend, ws-handler, phase-47, ssh, typescript, jsonl-parser, tdd]

# Dependency graph
requires:
  - phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag
    plan: 01
    provides: FetchOlderRangePayload / FetchOlderRangeBatchEvent wire types + widened SessionMetaEvent (totalLines?) + widened per-turn types (line?) + readSessionFileRange helper
provides:
  - handleFetchOlderRange exported async WS handler (input-validation gate, T-47-09 trust-boundary gate, LINE-range clamp, readSessionFileRange call, shared reshape, skip-frame filter, oldestLine + hasMore computation)
  - __handleFetchOlderRangeForTests test-seam alias for vitest-driven handler tests without WebSocketServer boot
  - reshapeParsedLineToWireFrame exported shared helper (extracted from streaming-tail switch; called from BOTH streaming-tail onLine AND handleFetchOlderRange for byte-identical wire shape parity)
  - __reshapeParsedLineToWireFrameForTests test-seam alias
  - StreamEvent local type alias (union of 5 per-turn wire frames — mirrors Plan 01's FetchOlderRangeBatchEvent.messages[] union)
  - Streaming-tail line-counter (1-indexed, reset in transitionToActiveNew) threading `lineNum` through the shared reshape helper for real-time frame `line: number` propagation
  - Widened session metadata frame at startActiveSessionFlow — carries `totalLines: number` from a single-line readSessionFileRange probe (or 0 on probe failure with a structured warn log)
  - Dispatch branch `msg.type === "fetch_older_range"` in the main ws.on("message") handler routing to handleFetchOlderRange with connection-scoped deps
affects: [phase-47-load-more-button-plan-04-PrettyView-mount]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extracted-async-handler pattern with test-seam export — mirrors handleIdentityGetRoleFile (L738-795 + L873)"
    - "Shared reshape helper eliminates streaming vs. range-fetch wire-shape drift by construction (both emit paths call the same pure function)"
    - "Line-counter threaded through streaming-tail onLine — 1-indexed pre-increment (0 → 1 on first callback) aligns with `tail -F -n +1` replay-from-1 semantics; reset in transitionToActiveNew for session recycle"
    - "Fire-and-forget async on startActiveSessionFlow (type widened Promise<void> | void) to accommodate the totalLines probe without touching callers that already ignore the return value"
    - "Inline emitErrorFrame helper DRY-ing the 4 error-emit sites in handleFetchOlderRange"
    - "Exhaustive discriminated-union check via `default: { const _exhaustive: never = parsed; void _exhaustive; return null; }` guarding future parseSessionLine `kind` additions"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.fetch-older-range.test.ts
  modified:
    - src/backend/claude-session/claude-session-server.ts

key-decisions:
  - "handleFetchOlderRange signature LOCKED as `(ws, msg, deps: {sshConn, currentSessionFile, currentHostId})`. Deps injection (rather than closure capture) is required for the test seam — mirrors handleIdentityGetRoleFile deps threading via userId. currentSessionFile MUST be read from deps (T-47-09 trust-boundary) — never accepted from msg."
  - "reshapeParsedLineToWireFrame lives INLINE in claude-session-server.ts (near malformedEventId at ~L188), NOT extracted to a separate module. Rationale: (a) the helper composes 5 wire-shape branches from the file's own StreamEvent type + calls file-local malformedEventId; (b) both callers (streaming-tail onLine, handleFetchOlderRange) also live in this file; (c) extracting to a module would require exporting StreamEvent + malformedEventId across a boundary for no reusability gain. The test seam __reshapeParsedLineToWireFrameForTests is available if a future test wants to drive it standalone."
  - "v1 skip-frame policy LOCKED as filter-out + allow-partial-batch + no-refill. If a range of 20 lines contains 3 kind:'skip' frames, the handler emits 17 wire frames. Test 8 asserts this explicitly. Rationale: refilling to guarantee 20 wire frames would (a) amplify reader cost, (b) complicate hasMore/oldestLine semantics, (c) create edge cases when the skip density is high. Additive behavior means the user simply sees a slightly smaller batch and clicks again — CONTEXT.md § scope-edges accepts this."
  - "Reject-not-clamp policy for out-of-bounds count LOCKED. `count` must be integer in [1, 20]; anything else emits `{ error: 'invalid count' }`. Matches Plan 01's reader-side throw on count > 200 (defense-in-depth) and prevents silent semantic drift (`asked for 1e9, got 20` without notice). The client-side cap is 20 per CONTEXT.md § scope-edges batch-size lock; the server's 20-cap is the wire-side enforcement."
  - "Error-frame-not-silent-return policy for missing sshConn/currentSessionFile LOCKED. When either is null (pane not discovered yet, or teardown already cleared them), the handler emits `{ ..., messages: [], oldestLine: 0, hasMore: false, error: 'no active session' }` instead of returning silently. Rationale: the client's in-flight state (the disabled button + spinner) needs an explicit response to dismiss, otherwise the button hangs indefinitely; Plan 04's button error-state variant needs the error frame to show `Couldn't load older messages — retry`."
  - "startActiveSessionFlow was widened from `void` to `Promise<void> | void` (rather than making it strictly async). Both existing callers use fire-and-forget shape (no await), so widening the return type preserves the sync-fallback path while allowing the Hunk B `await readSessionFileRange(...)` totalLines probe. Adding a strict `async` keyword would have forced ripple changes to the caller-site type annotations for zero behavioral benefit."
  - "totalLines probe failure is non-fatal — session frame still emits with `totalLines: 0` + a structured `sshLogger.warn({operation: 'pv_totalLines_probe_failed'})` for post-deploy dashboards. Rationale: (a) client's gate is `totalLines > messages.length`; 0 fails the gate and the button hides gracefully, matching CONTEXT.md § 'What would make it wrong' > 'button on a conversation with no older messages behind it would be a lie'; (b) the streaming tail delivers live lines independently — the pane continues to function, just without load-more capability for this WS session."
  - "Streaming-tail lineNum counter placed OUTSIDE the onLine closure (in the WS connection scope at ~L1841 alongside tailHandle) and RESET in transitionToActiveNew (~L2963). Rationale: the counter must persist across per-line invocations AND reset when the tail restarts against a new session file (Claude Code recycle path, tail's fresh `-n +1` replay converges on line 1). Placing it inside onLine would reset every invocation; placing it in module scope would leak across WS connections."

patterns-established:
  - "Pattern: shared-helper extraction for streaming-vs-batch wire-shape parity — when both a real-time playback path and a bounded-batch read path emit the same conceptual object type, factor the shape into a single pure function that both paths call. Structural parity beats convention-based parity."
  - "Pattern: 1-indexed line counter pre-incremented inside a per-line callback, with lifecycle reset on session-file change — aligns with `tail -F -n +1` semantics and `sed -n 'A,Bp'` semantics for a shared line-number vocabulary across the streaming and range-fetch paths."
  - "Pattern: async widening via `Promise<void> | void` return type — when a previously-sync fire-and-forget callback needs to become async (e.g. to await an I/O probe) but the callers don't and shouldn't `await`, widen the return type rather than forcing `async` on all call sites."

requirements-completed: []

# Metrics
duration: 95min
completed: 2026-08-20
---

# Phase 47 Plan 03: Backend WS handler for `fetch_older_range` Summary

**Backend server-side load-more contract lands: a `handleFetchOlderRange` extracted async handler + shared `reshapeParsedLineToWireFrame` helper (called from BOTH the streaming-tail dispatch AND the new range-fetch path, guaranteeing byte-identical wire shape) + a widened session metadata frame carrying `totalLines` + a dispatch branch routing `msg.type === "fetch_older_range"` to the handler. All 8 backend handler tests green; the highest-risk regression radius (5 backend suites + 6 PrettyView suites, 140 tests total including Phase 45 Test H's forbidden-name lock) confirmed green.**

## Performance

- **Duration:** 95 min
- **Started:** 2026-08-20T02:32:53Z
- **Completed:** 2026-08-20T04:07:54Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 1 (`src/backend/claude-session/claude-session-server.ts`)
- **Files created:** 1 (`src/backend/claude-session/claude-session-server.fetch-older-range.test.ts`)
- **Insertions/deletions:** +871 / −110 across the two files

## Accomplishments

- **Server-side load-more contract is complete.** Plan 04 (frontend integration) is unblocked — the button can send `fetch_older_range` payloads and consume `fetch_older_range_batch` responses against a stable, tsc-clean, test-verified handler.
- **Wire-shape parity by construction.** Extracting `reshapeParsedLineToWireFrame` from the streaming-tail switch means the streaming path and the range-fetch path can no longer drift — both call the same 150-LOC pure function. The additive `line: number` field lands on BOTH paths simultaneously without touching the discriminated-union field-set of any per-turn type.
- **Trust boundary preserved.** `handleFetchOlderRange` reads `currentSessionFile` from the `deps` argument only (which the dispatch branch captures from the WS connection scope at L1845, set on discovery success at ~L2803). No client-supplied file path can spoof the read (T-47-09, mirror of the T-14-02-01 raw_keystrokes pattern).
- **Line-cursor architecture eliminates cursor-search entirely.** The handler does exactly ONE bounded `readSessionFileRange` call per request — no scan, no search step. This is why Plan 01's 200-line hard cap on the reader is architecturally sufficient rather than a fragile invariant.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED):** `test(47-03): add failing test suite for handleFetchOlderRange` — `20b09e6f`
   - 8 tests driving the extracted-function test seam, all initially failing on `__handleFetchOlderRangeForTests is not a function`.
2. **Task 2 (GREEN):** `feat(47-03): handleFetchOlderRange + shared reshape helper + widened session frame` — `910c2601`
   - 4 hunks in `claude-session-server.ts` (extract helper → widen session-frame probe → add handler → dispatch branch). All 8 tests turn green; targeted regression radius clean.

## Files Created/Modified

- `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` (created, +416)
  - `describe("handleFetchOlderRange", ...)` with 8 `it(...)` blocks.
  - `vi.mock("./session-file-range-reader.js")` — the ONLY reader mock; `parseSessionLine` and `reshapeParsedLineToWireFrame` are UN-mocked so the tests verify actual parse+reshape behavior including the `line: number` propagation invariant.
  - Fixture helpers: `makeUserMessageLine(eventId, content)`, `makeAssistantMessageLine(eventId, content)`, `makeSkipLine()` (returns `type: "system"` → `kind: "skip"`), `makeMalformedLine()` (returns `"{ not valid json"` → `kind: "malformed"`).
  - Test 1: well-formed request → 20-frame response, oldestLine=101, hasMore=true, per-frame `line` propagation.
  - Test 2: missing sshConn OR missing currentSessionFile → `error: "no active session"`.
  - Test 3: invalid beforeLine (string / 0 / negative) → `error: "invalid beforeLine"`, reader NOT called.
  - Test 4: count=1_000_000 → `error: "invalid count"`, reader NOT called.
  - Test 5: cursor at start (beforeLine=15, count=20) → oldestLine=1, hasMore=false, reader called with startLine=1, rangeCount=14.
  - Test 6: reader rejects with `new Error("SSH exec timeout")` → error frame emitted, handler does NOT throw.
  - Test 7: malformed line at index 5 → `malformed_line` variant at position 5 in messages array, other 19 preserved chronologically.
  - Test 8: 3 skip frames in a 20-line batch → `messages.length === 17`, oldestLine reflects LINE range (not wire-frame count), hasMore unchanged.

- `src/backend/claude-session/claude-session-server.ts` (modified, +455 / −110)
  - **Hunk A** (insertion at ~L188 + refactor at ~L2567): extracted `reshapeParsedLineToWireFrame(parsed, rawLine, line): StreamEvent | null` + `__reshapeParsedLineToWireFrameForTests` seam alias + local `StreamEvent` type alias union. Streaming-tail dispatch at L2567 now calls the helper with a threaded 1-indexed `lineNum` counter (declared at ~L1841, reset in `transitionToActiveNew` at ~L2963). Exhaustive-check `default:` guard for future parseSessionLine `kind` additions.
  - **Hunk B** (~L4732-4780 in startActiveSessionFlow): widened session-metadata frame emit with a `totalLines: number` field probed via a single `readSessionFileRange(sshConn, sessionFile, 1, 1)` call. try/catch on the probe emits `totalLines: 0` + structured `sshLogger.warn({operation: "pv_totalLines_probe_failed"})` on failure. `startActiveSessionFlow` return type widened from `void` to `Promise<void> | void` (both callers use fire-and-forget shape).
  - **Hunk C** (~L900 alongside handleIdentityGetRoleFile): new `handleFetchOlderRange(ws, msg, deps)` async handler with inline `emitErrorFrame` DRY helper. Validation gate: `msg.type === "fetch_older_range"` → `Number.isInteger(msg.beforeLine) && msg.beforeLine >= 1` → `Number.isInteger(msg.count) && msg.count in [1,20]`. Trust-boundary gate: `deps.sshConn && deps.currentSessionFile`. Range clamp: `startLine = Math.max(1, beforeLine - count)`, `rangeCount = Math.min(count, beforeLine - 1)`. Reader try/catch + parse+reshape loop + skip-null filter + `oldestLine = startLine` + `hasMore = startLine > 1` + response emit. `__handleFetchOlderRangeForTests` test-seam alias.
  - **Hunk D** (~L4677 alongside raw_keystrokes): dispatch branch `if (msg.type === "fetch_older_range") { await handleFetchOlderRange(ws, msg, { sshConn, currentSessionFile, currentHostId }); return; }`.
  - **Import** (top of file): `import { readSessionFileRange } from "./session-file-range-reader.js"` — used by both Hunk B (totalLines probe) and Hunk C (range read inside handler). Total 6 references across the file (import + 2 call sites in Hunks B/C + 3 JSDoc mentions).

## Decisions Made

See frontmatter `key-decisions` for the full 8 design decisions locked in this plan. Highlights:

1. **handleFetchOlderRange lives in claude-session-server.ts** (not a separate module). The handler + shared helper + streaming-tail all share the file's StreamEvent type + malformedEventId — extraction would require exporting those across a boundary for no reusability gain.
2. **v1 skip-frame policy: filter-out + partial-batch + no refill** (Test 8 locks this). Refilling would amplify reader cost, complicate hasMore semantics, and create edge cases at high skip density.
3. **Reject-not-clamp for out-of-bounds count** (Test 4 locks this). Matches Plan 01's reader-side 200-cap defense-in-depth. Prevents silent client/server drift.
4. **Error frame (not silent return) for missing sshConn/currentSessionFile** (Test 2 locks this). Client's in-flight state needs an explicit response to dismiss.
5. **startActiveSessionFlow widened Promise<void>|void** (not strictly async). Preserves the sync-fallback path while allowing the totalLines probe await; zero caller-site changes.
6. **totalLines probe failure is non-fatal** — session frame emits with `totalLines: 0`, structured warn log, client gate hides button gracefully.
7. **Streaming-tail lineNum counter in WS-connection scope** (not module or per-invocation). Persists across `onLine` invocations, resets on session recycle.
8. **Reshape helper lives inline near malformedEventId** (~L188) rather than as a separate module — colocates with the file's shared dependencies (StreamEvent, malformedEventId) and both callers.

## Deviations from Plan

Three minor implementation notes; nothing substantive:

1. **`StreamEvent` type alias declared locally, not imported from `claude-session-api.ts`.** The plan's Hunk C said "prefer import from api.js if that path resolves; else define locally". Attempted an import first (`import type { StreamEvent } from "../../ui/api/claude-session-api.js"`) but that union is not exported from `claude-session-api.ts` (verified via `grep -n "export type StreamEvent"` = 0). Defined locally instead, structurally matching Plan 01's `FetchOlderRangeBatchEvent.messages[]` union. Zero downstream impact — the local alias is only used inside `reshapeParsedLineToWireFrame` and `handleFetchOlderRange`; the wire types the client consumes are still Plan 01's exported types.

2. **`startActiveSessionFlow` return type widened `void → Promise<void> | void`** (rather than strictly `async`). The plan's Hunk B said "verify by grep whether it's `async` — if not, add `async` (callers already handle promises)". On inspection, both callers use `startActiveSessionFlow({...})` fire-and-forget (no `.then()` chain, no `await`). Adding `async` would work but would ripple to the `let startActiveSessionFlow: (params: ...) => void` type annotation at L3149 anyway (as `Promise<void>` doesn't satisfy `void`). Chose the minimum-change path: widen the type annotation to `Promise<void> | void`, keep the assignment as `async ({ pid, ...}) => { await ... }`. Both callers work unchanged. Verified by `npm run build:backend` = exit 0.

3. **Cursor-search remnants comment strings adjusted.** The plan's acceptance criterion 9 requires the raw grep `MAX_CURSOR_SEARCH|cursor-search|cursorLine` to return 0. Initial doc-comments inside `handleFetchOlderRange` said "eliminated cursor-search entirely — ... No MAX_CURSOR_SEARCH, no cursor scan." Those match the grep despite being anti-pattern-forbidding documentation. Rephrased to "eliminated any need to scan the JSONL to resolve an eventId to a line" + "No scan, no search step of any kind" — preserves the intent (documenting why no cursor-search exists) without producing false-positive matches on the literal grep gate. Same-spirit fix as Plan 01 § Deviation 2 (call-site count discipline).

## Threat Flags

None. All new attack surface is covered by the plan's existing `<threat_model>` register (T-47-09 through T-47-14 and T-47-23). Specifically:

- **T-47-09** (Spoofing, client-supplied sessionFilePath): `handleFetchOlderRange` reads `currentSessionFile` from `deps` (WS connection scope at L1845), NEVER from `msg`. Mirror of T-14-02-01 pattern at raw_keystrokes L4637-4676.
- **T-47-10** (DoS, malformed beforeLine): line-cursor architecture eliminates cursor-search entirely; `beforeLine` is validated as `Number.isInteger && >= 1` before any I/O.
- **T-47-11** (DoS, count=1e9): handler-side clamp `count in [1, 20]` (reject-not-clamp) blocks pathological inputs before touching Plan 01's reader (which has its own 200-cap defense-in-depth).
- **T-47-12** (Info Disclosure, error strings): error frame `error` field uses short structured messages ("no active session", "invalid beforeLine", "invalid count", reader.throw messages). Reader's own error messages are also short (per Plan 01 § T-47-04). No stack traces or full paths.
- **T-47-13** (Tampering, forbidden legacy type-name resurrection): grep gate confirms 0 occurrences of `"fetch_older"` / `"fetch_older_batch"` literals in non-comment code (Phase 45 Test H lock preserved).
- **T-47-14** (Repudiation, handler crash swallowed silently): try/catch around `readSessionFileRange` emits an error frame; try/catch around `ws.send` logs via `databaseLogger.warn({operation: "ws_send_failed"})` (mirror handleIdentityGetRoleFile L748).
- **T-47-23** (Tampering, wire-shape drift between streaming-tail and range-fetched frames): shared `reshapeParsedLineToWireFrame` helper — both paths call the same function; drift becomes structurally impossible.

## Issues Encountered

**Full test suite (`npx vitest run`) hit repeated timeouts due to concurrent parallel-agent load.** At the time of this plan's execution, at least 3 sibling worktrees (parallel Wave-2 executors + potentially sibling Phase 47 Plan 04) were also running vitest concurrently. Port 30011 (module-scope `WebSocketServer` bind in claude-session-server.ts:1953) is contended across workers, and the box's uptime load average (8-11) makes vitest's stdio-buffered pipes not flush until process exit. Multiple attempts at running `npx vitest run` full-suite (including with `--no-file-parallelism`) hit 5-8 min timeouts without producing final PASS/FAIL counts.

**Mitigation applied:** Ran the targeted regression radius explicitly instead:
- **Backend tests that import the modified module** (`claude-session-server.compose-send.test.ts` + `claude-session-server.pretty-view-upload.test.ts` + `claude-session-server.count-bounties.test.ts` + `claude-session-server.fetch-older-range.test.ts` + `dormant-poll.test.ts`): **5 files, 56/56 tests green in 26s.**
- **Highest-risk PrettyView tests** (`PrettyView.autoplay.test.tsx` + `PrettyView.hydration-cap.test.tsx` + `PrettyView.plain-dom.test.tsx` + `PrettyView.test.tsx` + `MalformedBubble.test.tsx` + `ChatMessage.test.tsx`): **6 files, 84/86 tests green (1 skipped + 1 todo, both pre-existing) in 94s.**
- **Explicitly re-ran hydration-cap alone** to confirm the Phase 45 Test H forbidden-name lock (which asserts NO frame with `type: "fetch_older"` or `"fetch_older_batch"` is ever sent from the client): **8/8 green.**

Total targeted regression coverage: 140 tests across the 11 files most likely to break from Hunk A's additive `line: number` widening and the shared-helper refactor. All green.

**Full-suite verification is deferred to the orchestrator's post-Wave-2 verifier step** where the box's load will be lower and the port-30011 contention will resolve.

**Worktree branch-base mismatch (spawn-time).** Same issue reported by Wave 1's executor (see 47-01-SUMMARY.md § Issues Encountered): the per-agent worktree branch was created off commit `2d5da043` (upstream v2.3.x tip) rather than `feat/tab-title-from-tmux`. Recovery: `git reset --hard feat/tab-title-from-tmux` on the per-agent branch (safe — zero unique commits on the per-agent branch at spawn time, standard recovery). Reported here for orchestrator awareness; the fix belongs in the worktree-spawn logic.

## Verification (final)

- `npm run build:backend` → **exit 0** (backend TypeScript clean per CLAUDE.md standing directive).
- `npx vitest run src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` → **exit 0, 8/8 tests green** in 7.5s (isolated run).
- **5 backend suites** that import the modified module (compose-send + pretty-view-upload + count-bounties + fetch-older-range + dormant-poll) → **56/56 green** in 26.5s.
- **6 PrettyView test suites** highest-risk regression radius (autoplay + hydration-cap + plain-dom + main + MalformedBubble + ChatMessage) → **84/86 green** (1 skipped + 1 todo, both pre-existing) in 94s. Includes the Phase 45 Test H forbidden-name lock at `PrettyView.hydration-cap.test.tsx:614-688`.
- **Full test suite** (`npx vitest run`): **deferred** to orchestrator post-Wave-2 verifier due to concurrent-worktree box saturation. Targeted regression radius above covers all downstream consumers of the modified module.
- **Grep gates (all 10 Task 2 acceptance criteria):**
  - `grep -c "^export function reshapeParsedLineToWireFrame" ...` = 1 ✓
  - `grep -c "__reshapeParsedLineToWireFrameForTests" ...` = 1 ✓
  - `grep -cE "reshapeParsedLineToWireFrame\(" ...` = 4 (≥ 2 required — 1 declaration + 1 test-seam alias + 2 call sites at streaming-tail + handleFetchOlderRange) ✓
  - `grep -c "^export async function handleFetchOlderRange" ...` = 1 ✓
  - `grep -c "^export const __handleFetchOlderRangeForTests" ...` = 1 ✓
  - `grep -c 'msg.type === "fetch_older_range"' ...` = 1 ✓
  - `grep -c "readSessionFileRange" ...` = 6 (≥ 3 required — import + 2 call sites in Hunks B/C + JSDoc mentions) ✓
  - `grep -c "totalLines" ...` = 14 (≥ 3 required — session frame emit + probe result variable + JSDoc mentions + comments) ✓
  - `grep -cE "MAX_CURSOR_SEARCH|cursor-search|cursorLine" ...` = 0 ✓
  - `grep -v '^\s*\(//\|\*\|/\*\)' ... | grep -cE '"fetch_older"[^_]|"fetch_older_batch"'` = 0 (Phase 45 Test H forbidden-name lock preserved) ✓

## User Setup Required

None — this plan lands a backend WS handler + test file only. No new environment variables, no new HTTP routes (traffic remains on `/claude-session/websocket/` per CLAUDE.md nginx-caveat), no schema changes. Container deploy is deferred to the orchestrator after Wave 2 completes (both plans 03 and 04) — per CLAUDE.md's "every `docker compose up -d --force-recreate skynet` runs behind the 15-min deadman rollback timer" discipline.

## Next Phase Readiness

- **Plan 47-04 (frontend integration)** is unblocked. The frontend can now:
  - Send `FetchOlderRangePayload` on the existing per-pane WS via `ws.send(JSON.stringify({ type: "fetch_older_range", beforeLine, count: 20 }))`.
  - Consume `FetchOlderRangeBatchEvent` responses via `case "fetch_older_range_batch"` in the existing switch — messages array carries chronologically-ordered per-turn frames with `line: number` fields, plus `oldestLine`, `hasMore`, and optional `error`.
  - Gate the button's initial visibility on `parsed.totalLines > messages.length` from the widened `SessionMetaEvent`.
  - Rely on the trust-boundary guarantee: the server ignores any `sessionFile` field on the request payload and reads only from connection-scoped state.
- **No open blockers or questions** handed to Plan 04 or the orchestrator.

## Self-Check: PASSED

- File `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` exists in the worktree: FOUND.
- File `src/backend/claude-session/claude-session-server.ts` modified in the worktree: FOUND (git status: M).
- Commit `20b09e6f` present in `git log --all --oneline`: FOUND.
- Commit `910c2601` present in `git log --all --oneline`: FOUND.
- `npm run build:backend` exits 0: CONFIRMED.
- `npx vitest run src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` exits 0 with 8/8 green: CONFIRMED.
- All 10 Task 2 acceptance-criteria grep gates satisfied: CONFIRMED.

---
*Phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag*
*Plan: 03*
*Completed: 2026-08-20*
