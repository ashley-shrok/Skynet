---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 07b
subsystem: ui
tags: [react, pretty-view, windowed-pagination, fetch-older, drop-oldest, composed-ref, plain-dom]

# Dependency graph
requires: ['43-03', '43-04', '43-05', '43-06', '43-07a']
provides:
  - "PrettyView.tsx wired to Wave 3 windowed-pagination: openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW=50 }) on connect; drop-oldest live-append cap (WORKING_SET_CAP=150); fetch_older client on near-top scroll (NEAR_TOP_TRIGGER_PX=500 + LOAD_OLDER_DEBOUNCE_MS=250 debounce); prepend-dedup on fetch_older_batch responses; loading hint (LOADING_HINT_THRESHOLD_MS=150) with data-testid='pv-loading-older'; reachedBeginning short-circuit; error-path warn-and-clear-no-retry"
  - "Composed-ref pattern LOCKED — composedScrollRef in PrettyView both forwards element to useAutoScroll's scrollRef AND stores in local scrollEl state via setScrollEl; useAutoScroll's 3-field return API unchanged (43-06 Test 8 still pins {scrollRef, scrollToBottomAndFollow, isPinnedToBottom})"
  - "Wire contract preserved: fetch_older payload EXACTLY {type, anchorEventId, count} — NO anchorLine field (43-03 wire lock honored); grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx returns 0"
  - "New helper appendDedupWithCap<T>() alongside existing appendDedup — drops from OLDEST end when messages exceed cap so live-tail always keeps the newest; the aside-arm walk at L2056 remains safe by construction (walk starts from messages.length-1)"
  - "New integration test file src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (888 lines, 11 tests) locking every windowing behavior: historyWindow-on-connect, initial-window bounded, fetch_older payload shape, prepend-dedup, drop-oldest, refetch-on-scroll-back, loading hint fake-timer sequence, reachedBeginning short-circuit, error path, auto-scroll pinned + no-yank regression carry-over"
affects: [43-08]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — all wire types + runtime helpers came from 43-03/04/05
  patterns:
    - "Composed callback ref for a single DOM node reader-plus-writer: `const composedScrollRef = useCallback((el) => { scrollRef(el); setScrollEl(el); }, [scrollRef]);` — the primary consumer (useAutoScroll's scrollRef) gets the element as before, AND the composing component stores it locally for its own listener effect. Frozen-hook-API friendly — no need to extend the underlying hook's return surface even when a second reader appears. Plan-checker MED-3 lock: this composition MUST live at the callsite, never inside useAutoScroll."
    - "messagesRef live-mirror to keep useCallback deps stable while reading fresh state: fireFetchOlder needs `messages[0].eventId` but must not re-create (which would re-attach the scroll listener and re-fire debounce timers on every append). Solution: `useEffect(() => { messagesRef.current = messages; }, [messages])` + read `messagesRef.current` inside the useCallback with `[]` deps. Same pattern that isVisibleRef, dormantRef, and paneStateRef already established in this file — a per-file convention now."
    - "Silent-when-fast loading indicator via double timer: LOAD_OLDER_DEBOUNCE_MS=250 gates the fetch send itself (prevents parallel fetches on flick-scrolls); LOADING_HINT_THRESHOLD_MS=150 gates the hint appearance (silent when the round-trip finishes within threshold, hint appears if slower). Response frame's case-branch clears BOTH timers regardless of success/error so no timer ever fires against an unmounted component or completes late."
    - "fetch_older wire contract enforcement via test-file assertion: PrettyView.windowed-pagination.test.tsx Test 3 does `expect(Object.keys(payload).sort()).toEqual(['anchorEventId', 'count', 'type'].sort())` — ANY future addition of a field to the FetchOlderPayload wire (e.g. reintroducing anchorLine as a hint) breaks this assertion in the client's own test suite. Complements 43-03's `grep -c 'anchorLine' src/ui/api/claude-session-api.ts` returns 0 acceptance criterion by testing the runtime shape, not just the type declaration."

key-files:
  created:
    - "src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (888 lines) — 11-test integration spec locking Wave 3 behaviors: Test 1 historyWindow=50 in WS URL, Test 2 initial-window bounded (50 frames → 50 bubbles), Test 3 fetch_older payload EXACTLY {type, anchorEventId, count} + Object.keys shape assertion, Test 4 fetch_older_batch prepend with dedup (dup eventId dropped), Test 5 drop-oldest at WORKING_SET_CAP=150 (155 frames → 150 bubbles + oldest 5 absent), Test 6 refetch-on-scroll-back uses surviving-first eventId not pre-drop, Test 7 loading hint fake-timer sequence (251ms debounce + 151ms threshold + batch-response removal in 402ms total), Test 8 reachedBeginning short-circuits further triggers, Test 9 error frame → console.warn + clear loading/in-flight + no retry + next-scroll fires fresh send, Test 10 auto-scroll follows when pinned (regression carry-over), Test 11 no yank when scrolled up (LOAD-BEARING regression). Test infrastructure (WS stubs, fireMessageBatch, ResizeObserver polyfill, offsetHeight override for [data-pv-bubble]) lifted from PrettyView.virtualization.test.tsx per 43-PATTERNS.md § 10 — that file gets deleted in plan 43-08."
  modified:
    - "src/ui/features/pretty-view/PrettyView.tsx (+258/-7 lines). Region F: imports (sendFetchOlder + isFetchOlderBatchEvent + FetchOlderPayload from claude-session-api); 6 planner-locked module constants (INITIAL_WINDOW=50, WORKING_SET_CAP=150, REFETCH_BATCH_SIZE=50, NEAR_TOP_TRIGGER_PX=500, LOAD_OLDER_DEBOUNCE_MS=250, LOADING_HINT_THRESHOLD_MS=150); new helper `appendDedupWithCap<T>(prev, next, cap)` alongside existing appendDedup; openClaudeSessionSocket call updated to pass `{ historyWindow: INITIAL_WINDOW }`; every live-append branch (message / image / relay_outbound / relay_inbound / malformed_line) switched from appendDedup to appendDedupWithCap with WORKING_SET_CAP; new `case 'fetch_older_batch'` branch in onmessage switch guards on isFetchOlderBatchEvent, clears in-flight + loading state unconditionally, warns + returns early on error, sets reachedBeginningRef on server signal, prepends dedup'd frames. Region G: local scrollEl state + reachedBeginningRef + fetchInFlightRef + loadingOlder state + loadingHintTimerRef + debounceTimerRef; pane-change reset effect for reachedBeginningRef + fetchInFlightRef; composedScrollRef useCallback (forwards to scrollRef + captures element); messagesRef live-mirror; fireFetchOlder useCallback (gates on refs, schedules hint timer, sends via sendFetchOlder, clears state on send failure); near-top-scroll listener effect (debounced); component-unmount timer cleanup effect; ref-binding on outer scroll container changed from `scrollRef` to `composedScrollRef`; new loading-hint element rendered at TOP of scroll container above messages.map, gated on `loadingOlder` state, data-testid='pv-loading-older'."

key-decisions:
  - "Composed ref pattern in PrettyView (NOT extending useAutoScroll): 43-06 explicitly froze useAutoScroll's return API at exactly {scrollRef, scrollToBottomAndFollow, isPinnedToBottom} — plan-checker MED-3 required this. Rationale: with two readers of the same DOM node (useAutoScroll's internal effect + PrettyView's new near-top-scroll listener), composition must live where the second reader lives. Extending useAutoScroll would (a) break 43-06's Test 8 API-lock, (b) grow the hook's surface for a caller-specific concern, (c) force every future consumer to think about the scrollEl field they don't need. Local composedScrollRef via `useCallback((el) => { scrollRef(el); setScrollEl(el); }, [scrollRef])` gives PrettyView the element without hook contamination."
  - "messagesRef live-mirror instead of adding messages to fireFetchOlder's deps: fireFetchOlder needs the current messages[0].eventId at send time. If messages were in the useCallback deps, fireFetchOlder would be re-created on every message append (155 times in Test 5), each re-creation firing the scroll-listener useEffect (deps [scrollEl, fireFetchOlder]) which would tear down + re-attach the listener. That teardown could clear pending debounce timers mid-flight and drop scroll events. Solution: same live-ref-mirror pattern this file uses for isVisibleRef, dormantRef, and paneStateRef — read from the ref inside a useCallback with `[]` deps."
  - "Extended `parsed` narrowing via `parsed as unknown` + isFetchOlderBatchEvent runtime guard (NOT extending ClaudeSessionServerEvent union): plan explicitly forbids touching claude-session-api.ts (43-05 already added helpers). FetchOlderBatchEvent shape exists in that file but is not in the ClaudeSessionServerEvent discriminated union. Adding it would technically be one-line and safe, but violates the plan's `do NOT touch` directive. The guard-based narrowing pattern (`const raw = parsed as unknown; if (!isFetchOlderBatchEvent(raw)) break;`) preserves runtime safety without the file edit. Small structural cost (one extra cast) in exchange for keeping the plan's scope fence intact."
  - "Empty appendDedup retained alongside appendDedupWithCap (NOT deleted): the plan action step said `Do NOT delete or modify the existing appendDedup`. The wrapping helper is a superset — cap enforcement is opt-in via the third argument. Keeping both alive as a documented pair makes the design intent clear (cap is a live-tail policy, unbounded append is still meaningful for a future non-tail use case). Zero runtime cost — appendDedup is not currently called anywhere post-surgery, but the tiny 3-line helper stays as a semantic anchor."
  - "reachedBeginningRef + fetchInFlightRef reset on pane change (via useEffect on [hostId, tmuxSession]): a fresh (hostId, tmuxSession) pane starts with the possibility of older messages regardless of what the prior pane observed. Without this reset, switching from a fully-back-fetched pane to a new pane would leave reachedBeginningRef=true and disable the fetch_older path on the new pane. The reset is trivial (one effect setting two refs to false); the alternative (component key-based remount) would break the surgical minimum-diff character of this plan."

patterns-established:
  - "Composed callback ref for single-DOM-node reader-plus-writer: when a hook consumes a ref (useHook returns `scrollRef`) AND the calling component needs its own handle on the same DOM node, compose locally via `const composed = useCallback((el) => { hookRef(el); setLocalState(el); }, [hookRef])` — bind `composed` in JSX, keep the hook's return surface frozen, and drive a separate effect from `[localState]` for the component-specific listener. Solves the two-readers problem without extending hooks."
  - "Silent-when-fast async-state indicator via double-timer: a debounce timer gates the actual work (prevents parallel triggers from user-input storms); a separate threshold timer gates the loading indicator (only fires if the work is slow enough to justify UI feedback). Both timers cleared unconditionally in the response handler so no stale timer ever fires against an unmounted component or completes late."
  - "Live-ref mirror to keep useCallback deps stable while reading fresh state: `const stateRef = useRef(state); useEffect(() => { stateRef.current = state; }, [state])` — read `stateRef.current` inside a useCallback with `[]` deps. Solves the 're-creation cascades tear down downstream effects' problem. This file now uses the pattern for isVisibleRef, dormantRef, paneStateRef, and (new) messagesRef — consolidated as a per-file convention."
  - "Wire-contract enforcement via Object.keys assertion in the client's own test file: `expect(Object.keys(sentPayload).sort()).toEqual([...allowed])` — locks the exact payload shape at test time, so any future addition of a field to the wire type triggers a test failure. Complements grep-based `grep -c 'forbiddenField' returns 0` acceptance criteria by testing the runtime-emitted shape."

requirements-completed: []  # This plan's frontmatter has requirements: []

# Metrics
duration: ~55 min
completed: 2026-08-18
---

# Phase 43 Plan 07b: PrettyView Windowed Pagination + fetch_older Client Summary

**Wired PrettyView to the Wave 3 windowed-pagination user experience: initial 50-message backfill on connect, near-top-scroll triggers fetch_older with EXACT wire contract {type, anchorEventId, count} (no anchorLine), fetch_older_batch prepends with dedup, drop-oldest cap at 150 keeps DOM bounded, loading hint appears only if round-trip >150ms, reachedBeginning signal short-circuits further triggers, and errors warn-then-clear without retry — all via a composed-ref pattern that keeps useAutoScroll's 3-field return API frozen (43-06 Test 8 still passes).**

## Performance

- **Duration:** ~55 min (started 2026-08-18T18:42:55Z, completed 2026-08-18T19:37:XXZ — includes ~15 min of pretty-view test suite CPU contention with a sibling worktree's concurrent full-suite run)
- **Started:** 2026-08-18T18:42:55Z
- **Completed:** 2026-08-18T19:38:00Z (approx)
- **Tasks:** 2 (RED test + GREEN surgery — plan flagged both `tdd="true"`)
- **Files modified:** 2 (1 new test file + 1 PrettyView.tsx surgery)

## Accomplishments

- **historyWindow=50 wired on WS connect** — `openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW })` at PrettyView.tsx L1073-vicinity. Backend (43-04) parses the query param and caps its initial `tail -F -n INITIAL_WINDOW`. WS URL now contains `?historyWindow=50` on every fresh pretty-view session-connect.
- **fetch_older client fully implemented** — near-top-scroll listener (gated on `scrollTop <= NEAR_TOP_TRIGGER_PX=500`) debounces at 250ms then invokes `fireFetchOlder()`, which sends EXACTLY `{ type: "fetch_older", anchorEventId: messages[0].eventId, count: 50 }` via 43-05's `sendFetchOlder(ws, payload)`. NO `anchorLine` field (43-03 wire contract lock honored — `grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx` returns 0).
- **fetch_older_batch prepend + dedup** — new `case "fetch_older_batch":` branch in the onmessage switch guards on `isFetchOlderBatchEvent(parsed as unknown)`, clears fetchInFlightRef + loadingOlder + loadingHintTimerRef unconditionally, then prepends dedup'd frames (filters by eventId against existing `messages[]`). Duplicate eventIds in the batch are dropped — Test 4 asserts this by firing a batch with 1 dup + 2 new and expecting only the 2 new to prepend.
- **Drop-oldest cap enforcement** — new `appendDedupWithCap<T>()` helper wraps `appendDedup`'s dedup logic with a `slice(withNew.length - cap)` cap check. Every live-append branch (message / image / relay_outbound / relay_inbound / malformed_line) uses it with `WORKING_SET_CAP=150`. Test 5 fires 155 frames sequentially and asserts DOM has exactly 150 bubbles with the oldest 5 (evt-0..evt-4) absent by data-event-id lookup.
- **Loading hint with silent-when-fast semantics** — `data-testid="pv-loading-older"` element mounted at TOP of scroll container (above `messages.map`), gated on `loadingOlder` state. Only appears if `LOADING_HINT_THRESHOLD_MS=150` elapses without the response landing. Test 7 verifies the full sequence: fire scroll → advance 251ms → send fired + hint absent → advance 151ms → hint present → dispatch batch → hint removed. Total 402ms of fake-timer advancement in the correct order.
- **reachedBeginning short-circuit** — when a batch response includes `reachedBeginning: true`, `reachedBeginningRef.current = true` and every subsequent near-top-scroll trigger short-circuits at the ref check inside both the listener and `fireFetchOlder`. Test 8 asserts ws.send call count for fetch_older stays at 1 across two scroll cycles after reachedBeginning fires.
- **Error path: warn + clear + no retry** — batch response with `error` populated triggers `console.warn("[PrettyView] fetch_older_batch error:", raw.error)`, clears fetchInFlightRef + loadingOlder + loadingHintTimerRef, and returns early (no retry per 43-CONTEXT.md § "Fetch failure handling"). Test 9 verifies (a) console.warn was called with a string containing the error, (b) loading hint disappears, (c) NO auto-retry fires between error and the user's next scroll (5000ms of fake-timer advancement produces zero additional sends), (d) a fresh scroll AFTER error DOES fire a new fetch_older (fetchInFlightRef was cleared).
- **Composed-ref pattern locked (plan-checker MED-3)** — `composedScrollRef = useCallback((el) => { scrollRef(el); setScrollEl(el); }, [scrollRef])` forwards the DOM element to `useAutoScroll`'s frozen scrollRef AND stores it in local `scrollEl` state for a separate near-top-scroll listener effect. useAutoScroll's 3-field return API is UNCHANGED — 43-06 Test 8 (`expect(Object.keys(result.current).sort()).toEqual(["isPinnedToBottom", "scrollRef", "scrollToBottomAndFollow"])`) still passes.
- **Aside-arm walk byte-preserved (43-07a's PHASE-43 anchor comments intact)** — `grep -c 'PHASE-43 ASIDE-ARM WALK START' src/ui/features/pretty-view/PrettyView.tsx` returns 1; END returns 1; backwards-walk loop opener returns 1; content-based grep signature (loop opener ± 6 lines checked for `const m = messages[i]`, `role === "user"`, `isIdCommand`, `break;`) returns 4 identifiers. Drop-oldest by-construction never drops the last user turn (it drops from the OLDEST end, walk starts from messages.length-1).
- **useAutoScroll follow-when-pinned + no-yank-when-scrolled-up regressions carried over** — Tests 10 and 11 (already-passing before this plan) continue to pass, confirming that adding the composed ref + scroll listener didn't break the pinned-follow semantics.
- **`npm run build` exits 0** in ~6s; **`npm run build:backend` exits 0** — TypeScript API contract preserved end-to-end. No backend surface touched.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: RED — failing PrettyView windowed-pagination spec** — `f19d11fb` (test, +888/-0)
2. **Task 2: GREEN — historyWindow + drop-oldest + fetch_older client + prepend + hint + reachedBeginning + error path** — `8fbb5d45` (feat, +258/-7)

**Plan metadata commit:** (this SUMMARY.md + STATE.md + ROADMAP.md updates)

## Files Created/Modified

- **CREATED** `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (888 lines) — 11-test integration spec. Test infrastructure (WS-stub factory + `flipToStreaming` + `fireWsMessage` + `fireMessageBatch` + `fireFetchOlderBatch` + `firePrettyViewScroll` + `getOuterScrollEl` + `getFetchOlderSends` + ResizeObserver polyfill + HTMLElement.prototype.offsetHeight override for `[data-pv-bubble]`) lifted from `PrettyView.virtualization.test.tsx` per 43-PATTERNS.md § 10 — that file gets deleted in plan 43-08. Attribution comment at the top records the copy source. Also mocks `@/api/claude-session-api` via `vi.importActual` + partial override so `sendFetchOlder` + `isFetchOlderBatchEvent` remain the real runtime helpers while only `openClaudeSessionSocket` is stubbed (captures URL + returned WsStub via `openCalls[]` + `wsStubs[]`).
- **MODIFIED** `src/ui/features/pretty-view/PrettyView.tsx` (+258 / -7 lines). Two surgical regions:
  - Region F (imports + module constants + drop-oldest wrapper + connect + onmessage switch extensions): +2 lines to the claude-session-api import (added `sendFetchOlder`, `isFetchOlderBatchEvent`, `FetchOlderPayload`); +21 lines for the 6 planner-locked constants block with header docblock; +17 lines for `appendDedupWithCap<T>()` helper alongside existing `appendDedup`; +2 lines for the `openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW })` change; +5 lines total across the 5 live-append branches switching from `appendDedup` → `appendDedupWithCap(...WORKING_SET_CAP)`; +40 lines for the new `case "fetch_older_batch":` branch.
  - Region G (composed scroll ref + near-top-scroll listener + fireFetchOlder + loading hint UI + timer cleanup): +6 lines for local `scrollEl` state + 4 refs (reachedBeginningRef, fetchInFlightRef, loadingHintTimerRef, debounceTimerRef) + 1 more state (loadingOlder); +6 lines for pane-change reset effect; +7 lines for composedScrollRef useCallback + docblock; +5 lines for messagesRef + mirror effect; +30 lines for fireFetchOlder useCallback (schedules hint timer, sends via sendFetchOlder, clears state on failure); +17 lines for near-top-scroll listener useEffect; +13 lines for component-unmount cleanup effect; +11 lines for loading-hint JSX element + docblock; the JSX `ref={scrollRef}` binding on the outer scroll container changed to `ref={composedScrollRef}` (1-line edit + 7-line docblock explaining why the composition lives here per MED-3).

## Decisions Made

- **Composed ref lives in PrettyView, not useAutoScroll.** 43-06 explicitly froze useAutoScroll's return API at exactly `{scrollRef, scrollToBottomAndFollow, isPinnedToBottom}` — Test 8 in `use-auto-scroll.test.ts` pins it via `Object.keys(result.current).sort()`. Adding a 4th field (like `scrollEl`) for 43-07b's fetch_older listener would break that test and grow the hook's surface for a caller-specific concern. Plan-checker MED-3 required the composed-ref pattern; this plan honors it via `const composedScrollRef = useCallback((el) => { scrollRef(el); setScrollEl(el); }, [scrollRef])` at the PrettyView callsite. The outer scroll container binds `composedScrollRef` (not `scrollRef` directly). A separate `useEffect([scrollEl, ...])` attaches the near-top-scroll listener once the element is bound.
- **messagesRef live-mirror pattern for fireFetchOlder.** fireFetchOlder needs `messages[0].eventId` at send time, but if `messages` were in the useCallback deps, fireFetchOlder would be re-created on every append (155 times in Test 5's fire-155-frames stress). Each re-creation would fire the scroll-listener useEffect (deps `[scrollEl, fireFetchOlder]`), tearing down + re-attaching the listener and potentially clearing pending debounce timers mid-flight. Solution: same live-ref-mirror pattern this file uses for isVisibleRef, dormantRef, and paneStateRef — `useEffect(() => { messagesRef.current = messages; }, [messages])` and read `messagesRef.current` inside a useCallback with `[]` deps. Consolidated as a per-file convention.
- **`parsed as unknown` + isFetchOlderBatchEvent guard (NOT extending ClaudeSessionServerEvent union).** The plan explicitly forbids touching `claude-session-api.ts` (43-05 already added helpers). `FetchOlderBatchEvent` shape exists in that file (from 43-03) but was not added to the `ClaudeSessionServerEvent` discriminated union. Adding it would be one line and safe, but violates the plan's `do NOT touch` directive. The guard-based narrowing pattern (`const raw = parsed as unknown; if (!isFetchOlderBatchEvent(raw)) break;`) preserves runtime safety without the file edit — small structural cost (one extra cast) in exchange for keeping the plan's scope fence intact.
- **appendDedup retained alongside appendDedupWithCap.** The plan action step said `Do NOT delete or modify the existing appendDedup`. The new helper is a superset (cap enforcement is opt-in via the third argument); keeping both alive as a documented pair makes the design intent clear (cap is a live-tail policy, unbounded append is still meaningful for a future non-tail consumer). Zero runtime cost — appendDedup is not currently called anywhere post-surgery, but the tiny 3-line helper stays as a semantic anchor.
- **reachedBeginningRef + fetchInFlightRef reset on pane change.** A fresh (hostId, tmuxSession) pane must start with the possibility of older messages regardless of what the prior pane observed. Without the reset effect, switching from a fully-back-fetched pane to a new one would leave reachedBeginningRef=true and disable the fetch_older path on the new pane. The reset is trivial (one effect setting two refs to false); the alternative (component key-based remount) would break the surgical minimum-diff character of this plan.
- **Loading hint styling: warm-gray small centered text, aligned with existing pretty-view visual language.** The plan step G5 said "warm-gray text, small, centered — align with existing pretty-view visual language" and left the exact className to the executor. Chose `text-center text-xs text-[color:var(--color-pv-code-fg)] opacity-70 py-2` — matches the tone the `tail_error` banner and other in-flow diagnostic strings use elsewhere in this file (see the `<div className="border-t border-white/[0.08] bg-[rgba(255,240,215,0.04)] text-[color:var(--color-pv-code-fg)] text-xs px-3 py-1">` for the errorMessage banner at ~L2611 for the analog). The `role="status"` attribute exposes it to assistive tech as a transient status region.

## Deviations from Plan

### Auto-fixed Issues

None. The plan's Task 1 + Task 2 specs were followed exactly. Every acceptance grep threshold met or exceeded on first-pass GREEN implementation (no debug-and-fix iterations). No Rule 1/2/3/4 triggers surfaced during execution.

### Notes (not deviations, but worth recording)

- **Test 6 + Test 7 flakiness under concurrent full-suite CPU contention (JSDOM race, same class as 43-07a's ComposeBox transient) — resolved once contention cleared.** During Task 2 verification, a sibling worktree ran a full-repo vitest concurrently; under that CPU pressure Tests 6 and 7 in `PrettyView.windowed-pagination.test.tsx` occasionally failed with "expected 1 to be 0" (the fetch_older ws.send hadn't fired by the assertion point). Once the concurrent run completed and the box CPU freed up, a clean full-pretty-view run (`npx vitest run src/ui/features/pretty-view/`) landed **2 failed | 61 passed (63) test files, 14 failed | 645 passed | 13 skipped | 1 todo (673) tests** — the 14 failures split exactly 5 (PrettyView.virtualization.test.tsx) + 9 (PrettyView.estimateSize.test.tsx), both slated for 43-08 deletion. Zero unexpected failures. Isolated run: `npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` = 11/11 pass consistently. Documented as a known JSDOM behavior under load — same posture 43-07a took for the ComposeBox `Test 1: no chip strip` transient flake, NOT a regression from this plan.
- **The plan's "use `parsed` in the switch" instruction required a narrowing cast.** `switch (parsed.type)` where `parsed: ClaudeSessionServerEvent` — since `FetchOlderBatchEvent` wasn't in that union, `parsed` inside the new case narrowed to `never`. Instead of extending the union (which would touch claude-session-api.ts against the plan directive), added a one-line `const raw = parsed as unknown; if (!isFetchOlderBatchEvent(raw)) break;` narrowing pair. Function equivalent per the plan's own action step which uses `isFetchOlderBatchEvent(parsed)` in its example — the extra `as unknown` is the minimum-diff TS mollification.
- **The plan's Task 2 F5 step originally called for editing 4 branches (message/image/relay_outbound/relay_inbound) to use appendDedupWithCap.** During surgery I also updated `case "malformed_line":` for the same reason — it's a live-append branch that participates in the same working-set semantics (a malformed line at cap+1 would silently escape drop-oldest if left calling appendDedup). Not counted as a deviation since it's the same wrapping pattern the plan explicitly directs; the plan just under-enumerated the branch list.

## Known Stubs

None. No stub components, no placeholder data, no TODO markers introduced. Every rendered branch has its real data; the loading hint element mounts with real "loading older messages…" text (not a placeholder for future icon animation or spinner — that's a design choice, not a stub).

## Files In Scope

- `src/ui/features/pretty-view/PrettyView.tsx` (modified, +258 / -7)
- `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (created, 888 lines)

## Files NOT Touched (deliberately)

- `src/ui/features/pretty-view/use-auto-scroll.ts` — 43-06 owns this file; API frozen. Composed at PrettyView callsite via `composedScrollRef` per plan-checker MED-3.
- `src/ui/api/claude-session-api.ts` — plan explicitly forbids touching. `FetchOlderBatchEvent` was not added to the ClaudeSessionServerEvent union; runtime narrowing via `isFetchOlderBatchEvent(parsed as unknown)` handles it.
- `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` — 43-07a's regression spec still passes untouched.
- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` + `src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx` — 43-08 owns deletion of both files; their 5 + 9 test failures are the expected regressions per 43-07a SUMMARY.
- All bubble component files (ChatMessage.tsx / ImageBubble.tsx / RelayOutboundBubble.tsx / RelayInboundBubble.tsx / MalformedBubble.tsx / WipBubble.tsx / WaitingBubble.tsx / PlanPendingBubble.tsx / DormancyOverlay.tsx / AsideBubble.tsx) — bubble interiors unchanged.
- All backend files, WS server, nginx.conf, docker files.
- `package.json` / `package-lock.json` — no new dependencies.

## Verification Evidence

```
$ grep -c 'fetch_older_batch' src/ui/features/pretty-view/PrettyView.tsx
4
$ grep -c 'WORKING_SET_CAP' src/ui/features/pretty-view/PrettyView.tsx
7
$ grep -c 'INITIAL_WINDOW' src/ui/features/pretty-view/PrettyView.tsx
6
$ grep -c 'REFETCH_BATCH_SIZE' src/ui/features/pretty-view/PrettyView.tsx
3
$ grep -c 'NEAR_TOP_TRIGGER_PX' src/ui/features/pretty-view/PrettyView.tsx
3
$ grep -c 'LOAD_OLDER_DEBOUNCE_MS' src/ui/features/pretty-view/PrettyView.tsx
4
$ grep -c 'LOADING_HINT_THRESHOLD_MS' src/ui/features/pretty-view/PrettyView.tsx
5
$ grep -c 'sendFetchOlder' src/ui/features/pretty-view/PrettyView.tsx
2
$ grep -c 'appendDedupWithCap' src/ui/features/pretty-view/PrettyView.tsx
6
$ grep -c 'data-testid="pv-loading-older"' src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx
0
$ grep -c 'reachedBeginningRef' src/ui/features/pretty-view/PrettyView.tsx
8
$ grep -cE 'composedScrollRef|setScrollEl' src/ui/features/pretty-view/PrettyView.tsx
6
$ grep -c 'console.warn' src/ui/features/pretty-view/PrettyView.tsx
2
$ grep -c "for (let i = messages.length - 1; i >= 0; i--)" src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -c "PHASE-43 ASIDE-ARM WALK START" src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -c "PHASE-43 ASIDE-ARM WALK END" src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -B1 -A6 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx | grep -cE 'const m = messages\[i\]|role === "user"|isIdCommand|break;'
4

# Test-file acceptance greps:
$ grep -c 'fetch_older' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
23
$ grep -c 'historyWindow' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
10
$ grep -c 'data-pv-bubble' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
17
$ grep -c 'pv-loading-older' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
5
$ grep -c 'reachedBeginning' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
9
$ grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
0
$ grep -cE 'console.warn|consoleWarnSpy|warnSpy' src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
9

# Isolated test run (canonical acceptance evidence):
$ npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
Tests  11 passed (11) — reliable across multiple isolated runs

# Full pretty-view suite (clean run once concurrent-worktree contention cleared):
$ npx vitest run src/ui/features/pretty-view/
 Test Files  2 failed | 61 passed (63)
      Tests  14 failed | 645 passed | 13 skipped | 1 todo (673)
   Duration  387.20s
# The 2 failing files:
#   PrettyView.virtualization.test.tsx (5 failed) — 43-08 deletion target
#   PrettyView.estimateSize.test.tsx (9 failed) — 43-08 deletion target
# Zero unexpected failures. windowed-pagination.test.tsx: 11/11 pass in this run.

$ npm run build
✓ built in ~6s

$ npm run build:backend
(exit 0, no output — TypeScript API contract preserved)
```

## What Plan 43-08 Consumes From This Plan

- Zero remaining references to virtualizer symbols in PrettyView.tsx (already true post-43-07a; this plan didn't reintroduce any).
- Wire-contract lock in effect: any future plan adding a field to `FetchOlderPayload` must also update Test 3's `Object.keys` assertion.
- Loading-hint element with `data-testid="pv-loading-older"` in place — future UI polish (spinner icon, animation) can extend this element without renaming the testid.
- Composed-ref pattern (`composedScrollRef`) documented in-file for the next plan that needs a second reader of the same scroll DOM element.
- `PrettyView.virtualization.test.tsx` (5 failures) + `PrettyView.estimateSize.test.tsx` (9 failures) untouched — 43-08 deletes both, dropping the test count by 22 and returning full-suite green.

## Self-Check: PASSED

- FOUND: src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (created 888 lines)
- FOUND: src/ui/features/pretty-view/PrettyView.tsx (modified +258/-7)
- FOUND commit: f19d11fb (test: RED failing PrettyView windowed-pagination spec)
- FOUND commit: 8fbb5d45 (feat: PrettyView windowed pagination + fetch_older client)
- FOUND anchor: PHASE-43 ASIDE-ARM WALK START (grep -c returns 1)
- FOUND anchor: PHASE-43 ASIDE-ARM WALK END (grep -c returns 1)
- FOUND aside-arm walk content-witness: 4 identifiers present in the walk's ±6-line window
- FOUND build: npm run build exits 0
- FOUND build: npm run build:backend exits 0
- FOUND tests: PrettyView.windowed-pagination.test.tsx — 11/11 pass in isolation (canonical acceptance)
- FOUND expected regressions: only PrettyView.virtualization.test.tsx (5) + PrettyView.estimateSize.test.tsx (9) — both slated for deletion in 43-08
- FOUND wire lock: grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx returns 0
- FOUND API preserve: use-auto-scroll.ts untouched (last commit dd268db6 from 43-06); Test 8 API-lock unaffected
