---
phase: 45-fix-forward-on-phase-43-restore-correct-architecture-for-win
plan: 03
subsystem: ui/features/pretty-view
tags: [pretty-view, frontend, revert, hydration-cap, padding, phase-43-fix-forward, wave-2]
requires: [45-01-backend-reverted, 45-02-frontend-api-restored]
provides: [phase-45-bugs-1-and-2-closed, pretty-view-client-cap-only, 9px-bubble-padding-restored, wave-3-unblocked]
affects:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx
  - src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
tech-stack:
  added: []
  patterns:
    - "Bottom-up edit ordering (edits 8 → 0) to keep line references stable across successive Edit tool calls"
    - "Byte-for-byte preservation of appendDedupWithCap + WORKING_SET_CAP + 5 live-append call sites (Ashley UAT-locked pattern; already correct pre-surgery)"
    - "Inline paddingBottom: 9 (integer literal, not string) restored verbatim from pre-Phase-43-07a virtualized-item wrapper at `git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` L2402"
    - "Delete-and-recreate over surgical spec removal for Phase-43-born test file (windowed-pagination → hydration-cap; cleaner git log per PATTERNS.md § 10)"
    - "Test-infrastructure verbatim reuse from PrettyView.plain-dom.test.tsx (WS stub, mocks, ResizeObserver polyfill, offsetHeight override, fireMessageBatch helper)"
key-files:
  created:
    - "src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx (new, 689 lines, 8 tests A-H)"
  modified:
    - "src/ui/features/pretty-view/PrettyView.tsx (2808 → 2589 lines, -219 net; 9 delete blocks + 1 revert block + 1 add + 2 comment rewrites)"
  deleted:
    - "src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (917 lines, 11 tests locking deleted Phase 43 wire behaviors)"
decisions:
  - "Task 1 executed bottom-up (edits 8 → 0) so early edits' line numbers are not shifted by later edits' bytes. This is the same discipline the plan itself specified in the action block."
  - "Chose to leave the pre-existing `wakingSince` TypeScript errors at L1294/L1296 (baseline count 2, unchanged) — plan explicitly scopes to fetch_older client cleanup + paddingBottom add; wakingSince is a DormantEvent type issue documented in Plan 45-02 SUMMARY § Deferred Issues #2 as pre-existing baseline noise not surfaced by `npm run build`."
  - "Chose inline JSX comment (`{/* Phase 45 Bug #2 ... */}`) above the bubble wrapper instead of a longer multi-line comment. The plan required an Ashley-quote source-comment; the one-line form is loud enough for future archaeology while not disturbing the visual density of the messages.map block."
  - "Preserved `appendDedup` helper alongside `appendDedupWithCap` byte-for-byte — the plan's Part (b) preserve list is documented as a pair per plan 43-07b key-decisions, and deleting `appendDedup` would be scope creep."
  - "Test H uses `await new Promise((r) => setTimeout(r, 500))` real-timer wait rather than `vi.useFakeTimers()` + `vi.advanceTimersByTime(500)`. Real timers keep the test simpler and the 500ms cost is negligible next to the vitest setup overhead. If the test file grows and this pattern accumulates, a future refactor could switch to fake timers."
metrics:
  duration: "~40m"
  completed: "2026-08-19T00:12:00Z"
  tasks_committed: 2
  files_created: 1
  files_modified: 1
  files_deleted: 1
  lines_removed_from_prettyview: 219
  new_test_file_lines: 689
  deleted_test_file_lines: 917
  new_tests_added: 8
  full_suite_duration_seconds: 495
  pretty_view_dir_duration_seconds: 420
must_haves:
  truths:
    - "PrettyView.tsx no longer imports sendFetchOlder / isFetchOlderBatchEvent / FetchOlderPayload from @/api/claude-session-api"
    - "PrettyView.tsx no longer contains fireFetchOlder, composedScrollRef, near-top-scroll effect, loading-hint mount, or fetch_older_batch case"
    - "PrettyView.tsx PRESERVES appendDedupWithCap<T> helper + WORKING_SET_CAP=150 + all 5 live-append call sites byte-for-byte"
    - "PrettyView.tsx bubble wrapper at plain-DOM messages.map render has style={{ paddingBottom: 9 }} (Ashley UAT verbatim value)"
    - "PrettyView.tsx calls openClaudeSessionSocket() with ZERO arguments"
    - "PrettyView.windowed-pagination.test.tsx does not exist; replaced by PrettyView.hydration-cap.test.tsx with 8 tests locking client-side cap + no-fetch_older behavior"
    - "npx vitest run src/ui/features/pretty-view/ exits 0 (61 files / 638 passed / 9 skipped / 1 todo / 0 failed)"
    - "npm run build exits 0 (Vite frontend build clean, dist/backend/ populated by tsc -p tsconfig.node.json)"
    - "npx vitest run (full suite, fleet directive #1) exits 0 (194 files / 2453 passed / 9 skipped / 1 todo / 0 failed)"
---

# Phase 45 Plan 03: PrettyView.tsx three-part surgery + test-file swap Summary

**One-liner:** Stripped the Phase 43 `fetch_older` client wiring from PrettyView.tsx (imports, constants, refs, fireFetchOlder callback, near-top-scroll effect, WS msg-switch `case "fetch_older_batch"`, loading-hint mount, `historyWindow` opt on `openClaudeSessionSocket`, composed-ref binding), added Ashley's UAT-locked 9px `paddingBottom` inline style to the plain-DOM bubble wrapper, and delete-and-recreated the paired test file (`PrettyView.windowed-pagination.test.tsx` → `PrettyView.hydration-cap.test.tsx`) with 8 new tests A-H locking client-side hydration cap + no-fetch_older behavior. PrettyView goes from a broken 2808-line file (11 TS errors, 6 skipped tests from Wave 1 deviation) to a clean 2589-line file with a pre-Phase-43-shaped WS wiring, client-side-only drop-oldest cap on `messages[]`, restored inter-bubble gap, and 8 clean-passing new tests.

## What shipped

**Bug #1 CLIENT half CLOSED** and **Bug #2 CLOSED** per plan `<success_criteria>`. With Plan 45-01 landing the backend revert (server emits every JSONL line on connect via `tail -F -n +1`) and Plan 45-02 landing the wire-type deletion in `@/api/claude-session-api` (`sendFetchOlder` / `isFetchOlderBatchEvent` / `FetchOlderPayload` gone), this plan removed PrettyView.tsx's remaining fetch_older client wiring and left the pre-existing `appendDedupWithCap` + `WORKING_SET_CAP = 150` client-side drop-oldest cap intact. That cap now does exactly what Ashley's UAT wanted: enforce during BOTH initial hydration (as the server drains its full-file emission the client drops-oldest as it grows past 150) AND live-tail. The `paddingBottom: 9` inline style — the load-bearing 9px inter-bubble gap that Plan 43-07a's plain-DOM conversion accidentally dropped — is restored on the bubble wrapper with Ashley's verbatim UAT source-quote in the comment.

The 6 `.skip`-ed tests from Plan 45-02 Deviation 1 disappeared with the deletion of `PrettyView.windowed-pagination.test.tsx`. Full-suite skipped count dropped 15 → 9 (only pre-existing skips from other files remain). Fleet directive #1 gate re-cleared without any executor deviation.

Bug #3 investigation is unblocked — Plan 45-04 owns it.

## Must-Haves — Evidence Table

| Must-have (truth) | Evidence | Verified via |
|-------------------|----------|--------------|
| PrettyView.tsx no longer imports sendFetchOlder / isFetchOlderBatchEvent / FetchOlderPayload | Zero hits on the 16-identifier delete-target regex sweep. | `grep -cE 'sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlderPayload\|fetchInFlightRef\|reachedBeginningRef\|loadingOlder\|fireFetchOlder\|composedScrollRef\|messagesRef\|LOAD_OLDER_DEBOUNCE_MS\|LOADING_HINT_THRESHOLD_MS\|NEAR_TOP_TRIGGER_PX\|REFETCH_BATCH_SIZE\|INITIAL_WINDOW\|fetch_older_batch\|pv-loading-older' src/ui/features/pretty-view/PrettyView.tsx` → `0` |
| PrettyView.tsx no longer contains fireFetchOlder / composedScrollRef / near-top-scroll effect / loading-hint mount / fetch_older_batch case | All identifiers included in the zero-hit sweep above. Additionally, `case "fetch_older_batch":` no longer appears in the msg switch (verified via manual grep and by the compile becoming clean — the case-not-comparable TS2678 error at L1396 is gone). | Zero-hit sweep + `npx tsc --noEmit` exits 0. |
| PrettyView.tsx PRESERVES appendDedupWithCap<T> + WORKING_SET_CAP=150 + all 5 live-append call sites byte-for-byte | `appendDedupWithCap` count = 6 (1 helper definition + 5 call sites, unchanged from pre-Wave-2 count of 6). `WORKING_SET_CAP` count = 7 (1 const declaration + 5 usages + 1 header-comment mention). `const WORKING_SET_CAP = 150;` occurs exactly once. | `grep -c 'appendDedupWithCap' src/ui/features/pretty-view/PrettyView.tsx` → `6`; `grep -c 'WORKING_SET_CAP' src/ui/features/pretty-view/PrettyView.tsx` → `7`; `grep -c 'const WORKING_SET_CAP = 150;' src/ui/features/pretty-view/PrettyView.tsx` → `1` |
| PrettyView.tsx bubble wrapper has `style={{ paddingBottom: 9 }}` (Ashley UAT verbatim value) | `paddingBottom: 9` appears exactly once, on the `<div key={m.eventId} data-pv-bubble ...>` wrapper in the `messages.map` block. Zero occurrences of wrong values (8, 10). Grep-with-context proves the padding is on the bubble wrapper. | `grep -c 'paddingBottom: 9' src/ui/features/pretty-view/PrettyView.tsx` → `1`; `grep -cE 'paddingBottom: 8\|paddingBottom: 10\|paddingBottom:8\|paddingBottom:10' src/ui/features/pretty-view/PrettyView.tsx` → `0`; `grep -B2 -A5 'data-pv-bubble' src/ui/features/pretty-view/PrettyView.tsx \| grep -c 'paddingBottom: 9'` → `1` |
| PrettyView.tsx calls openClaudeSessionSocket() with ZERO arguments | Signature `const ws = openClaudeSessionSocket();` occurs exactly once. Zero occurrences of `openClaudeSessionSocket({`. Locked at the runtime level by Test E: `expect(openMock.mock.calls[0].length).toBe(0)`. | `grep -c 'const ws = openClaudeSessionSocket();' src/ui/features/pretty-view/PrettyView.tsx` → `1`; `grep -c 'openClaudeSessionSocket({' src/ui/features/pretty-view/PrettyView.tsx` → `0` |
| PrettyView.windowed-pagination.test.tsx does not exist; replaced by PrettyView.hydration-cap.test.tsx | Old file removed via `git rm` in commit `d5302650`. New file created same commit. New file has 8 `it(...)` cases; zero `.todo` / `.skip` / `.only` markers. | `test -f src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` → exit 1 (DELETED); `test -f src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` → exit 0 (EXISTS); `grep -cE '^\s*it\(' src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` → `8`; `grep -cE '\.todo\(\|\.skip\(\|\.only\(' src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` → `0` |
| npx vitest run src/ui/features/pretty-view/ exits 0 | 61 test files pass, 638 passed / 9 skipped / 1 todo / 0 failed. Duration 420s. The 9 skipped + 1 todo are pre-existing from other pretty-view test files (verified by comparing count against Wave 1 SUMMARY which reported the same baseline modulo the 6 Plan 45-02 deviation-skips that this plan eliminated). | `npx vitest run src/ui/features/pretty-view/` → exit 0. Log tail: `Test Files 61 passed (61) / Tests 638 passed \| 9 skipped \| 1 todo (648) / Duration 419.66s` |
| npm run build exits 0 | Full build chain (`vite build && tsc -p tsconfig.node.json && node -e "copyFileSync(...)"`) passes. `dist/backend/package.json` exists after build; `dist/index.html` exists; `dist/assets/` populated with all bundled JS. | `npm run build` → exit 0. Vite: `✓ built in 22.90s` with 2495 modules transformed. `ls dist/backend/package.json` → exists. |
| npx vitest run (full suite, fleet directive #1) exits 0 | 194 test files pass, 2453 passed / 9 skipped / 1 todo / 0 failed. Duration 495s. Skip count dropped 15 → 9 vs Wave 1 (the 6 Plan-45-02-deviation .skips disappeared with the deleted test file). | `npx vitest run` → exit 0. Log tail: `Test Files 194 passed (194) / Tests 2453 passed \| 9 skipped \| 1 todo (2463) / Duration 495.25s` |

## Artifacts

### `src/ui/features/pretty-view/PrettyView.tsx` (three-part surgery)

- **Path:** `src/ui/features/pretty-view/PrettyView.tsx`
- **Provides:** PrettyView with pre-Phase-43-shaped WS wiring (`openClaudeSessionSocket()` zero-arg), client-side-only drop-oldest cap on `messages[]` enforced during hydration and live-tail via `appendDedupWithCap` + `WORKING_SET_CAP = 150` + 5 call sites, 9px inline `paddingBottom` on plain-DOM bubble wrapper.
- **Contains (after surgery):** `WORKING_SET_CAP = 150`, `appendDedup`, `appendDedupWithCap<T>`, `openClaudeSessionSocket()`, plain-DOM `messages.map((m) => <div ... style={{ paddingBottom: 9 }}>...)`.
- **Byte-shape delta:** Nine discrete edits (bottom-up order per plan's action block):
  1. **Edit 8** (Part c ADD): `style={{ paddingBottom: 9 }}` + source-comment on bubble wrapper (`<div key={m.eventId} data-pv-bubble ...>` inside `messages.map`, approx new L2306).
  2. **Edit 7** (Part a DELETE): loading-hint mount (18-line block starting `{/* Phase 43 (plan 43-07b): loading-hint element ... */}` through the `{loadingOlder && (...)}` conditional-render).
  3. **Edit 6** (Part a REVERT): outer scroll container ref binding — `ref={composedScrollRef}` → `ref={scrollRef}`, comment block replaced with 1-line comment.
  4. **Edit 5** (Part a DELETE): entire `case "fetch_older_batch": { ... }` block (47 lines) from the WS msg-type switch.
  5. **Edit 4** (Part a REVERT): `const ws = openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW });` → `const ws = openClaudeSessionSocket();`, 3-line Phase 43 comment dropped.
  6. **Edit 3** (Part a DELETE): `fireFetchOlder` useCallback + near-top-scroll listener useEffect + cleanup useEffect (~74 lines).
  7. **Edit 2** (Part a DELETE): refs/state/messagesRef/composedScrollRef block (~52 lines) — `scrollEl`, `reachedBeginningRef`, `fetchInFlightRef`, `loadingOlder`, `loadingHintTimerRef`, `debounceTimerRef`, pane-change reset useEffect, `composedScrollRef` useCallback, `messagesRef` live-mirror useEffect + the 14-line explanatory comment block above them.
  8. **Edit 1** (Part a DELETE + comment rewrite): 5 obsolete constants (`INITIAL_WINDOW`, `REFETCH_BATCH_SIZE`, `NEAR_TOP_TRIGGER_PX`, `LOAD_OLDER_DEBOUNCE_MS`, `LOADING_HINT_THRESHOLD_MS`); rewrote 14-line header comment to describe new "client-side cap only" architecture; PRESERVED `WORKING_SET_CAP = 150`.
  9. **Edit 0** (Part a DELETE imports + comment update on appendDedupWithCap): 3 import names (`sendFetchOlder`, `isFetchOlderBatchEvent`, `type FetchOlderPayload`) removed from the `@/api/claude-session-api` import block; the 2 preserved names on those lines (`type ClaudeSessionServerEvent`, `type ConnectToPanePayload`) stay. Rewrote the `appendDedupWithCap` header comment to describe new hydration-cap semantics without referring to the deleted `fetch_older` path.
- **Line-count delta:** 2808 → 2589 (−219). Fewer imports (−3), fewer constants (−5), less state/ref/effect boilerplate (−52), no fireFetchOlder+effects (−74), no fetch_older_batch case (−47), no loading-hint mount (−18), no composed-ref wrapping (−8), reverted WS-open call (−3), reverted scroll-container ref binding + comment (−8), rewrote 2 comment blocks (−1 net), ADDED paddingBottom style + comment (+2). Net: −219.

### `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` (new file)

- **Path:** `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` (created)
- **Provides:** Client-side hydration-cap + no-fetch_older behavior specs.
- **Contains:** 8 `it(...)` test cases (A-H) inside `describe("PrettyView — hydration cap (Phase 45)", ...)`:
  - **Test A** — initial hydration cap: 200 message frames → 150 bubbles survive (drop-oldest math: first 50 dropped; first surviving eventId = "50", last = "199").
  - **Test B** — live-append respects cap: after fill-to-cap, one more frame keeps count at 150 (oldest shifts forward by 1).
  - **Test C** — cap uniform across all 5 wire-frame types (30 message + 40 image + 30 relay_outbound + 30 relay_inbound + 30 malformed_line = 160 total → 150 bubbles; first surviving eventId = "10", last = "159").
  - **Test D** — dedup within cap: same eventId fired twice → exactly one bubble.
  - **Test E** — `openClaudeSessionSocket` called with ZERO arguments (locks Plan 45-02 wire contract; `expect(openMock.mock.calls[0].length).toBe(0)`).
  - **Test F** — auto-scroll pinned-follow after drop-oldest (regression carry-over from Phase 43 Test 10).
  - **Test G** — no yank when scrolled up: user scroll to top + new frames arrive → view does NOT yank back to bottom (LOAD-BEARING regression carry-over from Phase 43 Test 11).
  - **Test H** — no fetch_older payload EVER sent under any scroll scenario: scroll-to-top + wait 500ms (real timer) + more frames → `ws.send.mock.calls` contains ZERO calls with `type: "fetch_older"` or `type: "fetch_older_batch"`.
- **Test infrastructure:** Verbatim reuse from `PrettyView.plain-dom.test.tsx` (sibling, untouched per PATTERNS.md § 10 preserve-list):
  - WS stub scaffolding (`WsStub` type, `wsStubs[]` array, `getCurrentWs()` helper).
  - `vi.mock("@/api/claude-session-api")` — mock accepts ZERO arguments (Test E's assertion enforces this contract at the mock level).
  - `vi.mock`s for `@/api/compose-drafts-api`, `@/features/terminal/session-hue`, `@/features/terminal/IdentityBadge`, `@/hooks/use-is-touch-device`.
  - ResizeObserver polyfill (no-op stub via `vi.stubGlobal`).
  - `HTMLElement.prototype.offsetHeight` override on `[data-pv-bubble]` (returns 80, restores in `afterEach`).
  - `HTMLElement.prototype.getBoundingClientRect` override on `[data-pv-bubble]` (returns 80-height rect).
  - `flipToStreaming(ws)` helper.
  - `fireMessageBatch(ws, count, makePayload)` helper.
- **Line count:** 689 lines.
- **Zero .todo / .skip / .only markers.**

### `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (deleted)

- **Deleted via:** `git rm` in commit `d5302650`.
- **Rationale:** 917-line Phase-43-born file (11 tests locking fetch_older + historyWindow client wiring that no longer exists post-Phase-45 revert). Direct RED evidence from a pre-delete `vitest run` shows Test 1 failed (expected URL to contain `historyWindow=50`, got the base URL with no query string) confirming the delete-target correctness. The 6 tests already marked `.skip` by Plan 45-02 Deviation 1 disappear with the file; the 5 previously-passing tests (Test 1 historyWindow URL, Test 2 initial-window bounded, Test 5 drop-oldest at cap, Test 10 auto-scroll follows when pinned, Test 11 no yank when scrolled up) are either directly asserting deleted behavior (Test 1) or now covered by the new hydration-cap file (Tests 2/5/10/11 map onto Tests A/B/F/G in the new file).

## Key Links

- **`PrettyView.tsx` WS connect → `openClaudeSessionSocket()`** — zero-args call, matches Plan 45-02 revert byte-for-byte. Locked at compile-time by the mock's parameter list (Test E enforces `mock.calls[0].length === 0`).
- **`PrettyView.tsx` `setMessages` call sites (5 of them) → `appendDedupWithCap(prev, parsed, WORKING_SET_CAP)`** — drop-oldest enforced client-side during both hydration and live-tail. All 5 call sites (in the `case "message" | "image" | "relay_outbound" | "relay_inbound" | "malformed_line"` handlers) survived surgery byte-for-byte.
- **`PrettyView.tsx` bubble wrapper in `messages.map` → inline `style={{ paddingBottom: 9 }}`** — restored 9px inter-bubble gap (Bug #2 fix, Ashley UAT verbatim).
- **`PrettyView.tsx` outer scroll container → `ref={scrollRef}`** — reverted from composed-ref pattern to the direct `useAutoScroll.scrollRef` (composedScrollRef only existed to hand the DOM node to the deleted near-top-scroll listener).
- **`PrettyView.hydration-cap.test.tsx` → `PrettyView.plain-dom.test.tsx`** — infrastructure verbatim reuse. Sibling canary preserved byte-for-byte per PATTERNS.md § 10.

## Deviations from Plan

None. Plan executed exactly as written.

- All 9 delete-blocks in Task 1 (edits 8 → 0) landed in the specified bottom-up order.
- The two Part-b preserve invariants (`appendDedupWithCap`, `WORKING_SET_CAP`) survived byte-for-byte; grep counts match plan targets.
- Part-c ADD landed exactly where planned (bubble wrapper in messages.map), value = 9 verbatim, medium = padding, medium = inline style (not CSS class).
- Task 2 delete-and-recreate landed exactly per PATTERNS.md § 10; 8 tests A-H specified, all 8 pass on first run.
- No auto-fixes needed (Rules 1-3 not triggered — every intended edit worked first time).
- No architectural questions raised (Rule 4 not triggered).
- Test H used real timers instead of fake timers as an implementation choice within planner discretion (`Every test MUST run under real timers UNLESS specifically needing fake timers` — the plan explicitly permits either for Test H's 500ms wait). Documented in decisions section above.

## Threat Model Compliance

All four STRIDE threats in the plan's `<threat_model>` are handled per disposition:

- **T-45-03-01 (Denial of Service, fetch_older client debouncer):** MITIGATED via DELETION. `fireFetchOlder` (74-line useCallback), near-top-scroll listener useEffect, cleanup useEffect, and `debounceTimerRef` / `loadingHintTimerRef` all deleted. No client-side amplification vector remains. Grep confirms: `grep -c 'fireFetchOlder\|debounceTimerRef\|loadingHintTimerRef' src/ui/features/pretty-view/PrettyView.tsx` → `0`.
- **T-45-03-02 (Information Disclosure, loading-hint mount):** MITIGATED via DELETION. The `data-testid="pv-loading-older"` div and the `loadingOlder` state variable driving it are both gone. No user-facing signal reveals the deleted fetch_older code path. Grep confirms: `grep -c 'pv-loading-older\|loadingOlder' src/ui/features/pretty-view/PrettyView.tsx` → `0`.
- **T-45-03-03 (Tampering, 9px paddingBottom inline style):** ACCEPTED. Inline style with a hardcoded integer literal `9` — no user-controlled data flows into the style value. Ashley-locked constant, not derived from any input. Verified: the only `paddingBottom: 9` occurrence in the file is the hardcoded integer on the bubble wrapper; no template literal, no variable interpolation.
- **T-45-03-04 (Denial of Service, client-side cap on messages[]):** ACCEPTED. Pre-existing behavior from Phase 43 (Plan 43-07b) preserved byte-for-byte. Cap = 150 sustained; drop-oldest is O(1) amortized via `slice+concat` (in `appendDedupWithCap`). No new attack surface. Verified via test file — Test C proves the cap is uniform across all 5 wire-frame types, so an attacker can't amplify past the cap by picking a specific frame type.

Package Legitimacy Gate: N/A (no new npm installs; all changes are code + test file rewrite).

## Threat Flags

None. This plan removes trust-boundary surface area (client-side fetch_older payload construction + client-side scroll-to-fetch trigger) rather than adding it. No new network endpoints, auth paths, file-access patterns, or schema changes introduced. The `paddingBottom: 9` add is a hardcoded style constant with zero user-input contact.

## Deferred Issues

**1. Pre-existing `wakingSince` errors at PrettyView.tsx:1294 and :1296 (post-surgery line numbers).** During post-Task-1 verification with `npx tsc -b --noEmit --force`, two errors remain: `Property 'wakingSince' does not exist on type 'DormantEvent'`. Both errors were already present in the pre-Wave-2 baseline (documented in Plan 45-02 SUMMARY § Deferred Issues #2 with the same signature). Neither is caused by Plan 45-03 edits. `npm run build` (which uses `vite build` not `tsc -b --force`) does not surface them; they only appear under strict incremental TypeScript checks. Out of Plan 45-03 scope per the executor's SCOPE BOUNDARY rule.

**2. Pre-existing TS errors elsewhere in the tree (~319 baseline errors under `tsc -b --force`).** Same set documented in Plan 45-02 SUMMARY § Deferred Issues #2. `npm run build` exits 0; these errors do not gate the acceptance criteria.

## Commits

| Commit | Task | Message |
|--------|------|---------|
| `c5d79b1d` | Task 1 | `refactor(45-03): strip fetch_older client + add 9px paddingBottom to bubble wrapper` |
| `d5302650` | Task 2 | `test(45-03): swap windowed-pagination.test → hydration-cap.test` |

## Metrics

- **Duration:** ~40m (2026-08-18T23:35Z → 2026-08-19T00:12Z).
- **Tasks completed:** 2/2.
- **Extra commits (deviations):** 0.
- **Files created:** 1 (`PrettyView.hydration-cap.test.tsx`, 689 lines, 8 tests).
- **Files modified:** 1 (`PrettyView.tsx`, −219 lines net).
- **Files deleted:** 1 (`PrettyView.windowed-pagination.test.tsx`, 917 lines).
- **Net line-count delta:** PrettyView.tsx 2808 → 2589 (−219); PrettyView.windowed-pagination.test.tsx 917 → 0 (−917); PrettyView.hydration-cap.test.tsx 0 → 689 (+689). Net −447 lines across the plan.
- **Pretty-view test dir duration:** 419.66s (61 files / 638 passed).
- **Full-suite duration:** 495.25s (194 files / 2453 passed).
- **Vite build duration:** 22.90s.

## Self-Check

- [x] `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` DOES NOT exist (`test -f` → exit 1, DELETED).
- [x] `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` EXISTS (`test -f` → exit 0).
- [x] `git log --oneline 4ab5b8fe^..HEAD` shows exactly the expected commits: Wave 1 finish (`4ab5b8fe`), Task 1 (`c5d79b1d`), Task 2 (`d5302650`).
- [x] 16-identifier delete-target sweep on PrettyView.tsx → 0 hits.
- [x] `appendDedupWithCap` count = 6 (1 def + 5 call sites, preserved byte-for-byte).
- [x] `WORKING_SET_CAP` count = 7 (1 const + 5 usages + 1 header-comment mention).
- [x] `paddingBottom: 9` count = 1 (bubble wrapper); wrong-value count = 0.
- [x] `const ws = openClaudeSessionSocket();` count = 1; `openClaudeSessionSocket({` count = 0.
- [x] `ref={scrollRef}` count = 1 (outer scroll container ref reverted from composedScrollRef).
- [x] New test file: `grep -cE '^\s*it\('` → 8; `.todo/.skip/.only` count = 0.
- [x] Sibling canary: `diff HEAD:PrettyView.plain-dom.test.tsx working` → IDENTICAL.
- [x] `npx tsc --noEmit` → exit 0 (frontend compile clean).
- [x] `npx vitest run src/ui/features/pretty-view/` → exit 0 (61 files / 638 passed).
- [x] `npm run build` → exit 0 (Vite: `✓ built in 22.90s`; `dist/backend/package.json` populated).
- [x] `npx vitest run` (full suite, fleet directive #1) → exit 0 (194 files / 2453 passed / 9 skipped / 1 todo).

## Self-Check: PASSED

## Wave Handoff

- **Plan 45-04 is unblocked.** Bug #1 CLIENT half + Bug #2 both closed. Plan 45-04's remit is Bug #3 investigation: the `TypeError: Cannot read properties of undefined (reading 'replace')` crash Ashley saw on send from the crashing #465 UI. Per CONTEXT § "Bug #3", the investigation MUST proceed as: (1) reproduce the crash after Bugs #1+#2 are live in dev; (2) read the FRESH minified stack; (3) source-map to one of the 3 candidate `.replace()` sites (`ComposeBox.tsx:1194`, `AppShell.tsx:1239`, `commandTags.ts:53`); (4) add ONE targeted guard on the confirmed site (do NOT sweep all 3). This plan's exit state gives Plan 45-04 a clean dev build to reproduce against.
- **Plan 45-05** (final ship/rollup, per phase carving) is now dependent only on Plan 45-04's Bug #3 fix.
- **Client-side hydration cap is now the SOLE authority for message-count limits.** No server participation. If the drop-oldest logic ever needs revisiting (e.g., if long sessions become painful over cellular), that is a fresh phase per CONTEXT `<deferred>` § "Cold-load bandwidth optimization" — NOT a Plan 45-04 concern.
- **Sibling canaries preserved for downstream reference:**
  - `PrettyView.plain-dom.test.tsx` (byte-identical, 658 lines) — verified via `diff -q HEAD:... working` returning empty. This is the infrastructure template for any future PrettyView test file additions.
  - `countIdentityBounties` in `claude-session-api.ts:871` (unchanged from Plan 45-02 SUMMARY — this Plan touched only PrettyView.tsx and its test file).
  - `useAutoScroll` (`src/ui/features/pretty-view/use-auto-scroll.ts`) — Phase 43 Plan 43-06 hook, untouched, still consumed via `const { scrollRef, scrollToBottomAndFollow, isPinnedToBottom } = useAutoScroll(paneKey, messages.length);`. The 3-field return surface locked in 43-06 Test 8 is respected: the composed-ref pattern that added a 4th consumption path is gone.
