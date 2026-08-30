---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 07b
type: execute
wave: 3
depends_on: ['43-07a']
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "On connect, openClaudeSessionSocket is called with { historyWindow: INITIAL_WINDOW } for the phase's initial-window size (planner-locked at N=50)"
    - "The onmessage switch has a new `case 'fetch_older_batch':` branch that prepends the received frames (dedup by eventId) to messages[], clears fetchInFlightRef + loadingOlder state, and sets reachedBeginningRef when the server signals it"
    - "The live-append path (existing case 'message'/'image'/'relay_*' branches) is wrapped so that when messages.length would exceed WORKING_SET_CAP (planner-locked at M=150), the oldest entries are dropped from the head"
    - "A scroll listener fires a fetch_older WS request when the user scrolls within NEAR_TOP_TRIGGER_PX (planner-locked at 500px) of the top AND !reachedBeginningRef.current AND !fetchInFlightRef.current; debounced (planner-locked at 250ms) so a fast flick-scroll doesn't fire parallel fetches"
    - "The fetch_older payload sent to the server is EXACTLY { type: 'fetch_older', anchorEventId: messages[0].eventId, count: REFETCH_BATCH_SIZE } — NO anchorLine field (per 43-03 wire contract; server does eventId→line lookup on demand)"
    - "A loading hint (data-testid='pv-loading-older') appears at the top of the scroller if a fetch_older is in-flight for longer than LOADING_HINT_THRESHOLD_MS (150ms); hidden immediately when the response lands OR when send fails"
    - "reachedBeginningRef, once set to true by a fetch_older_batch response, short-circuits all subsequent near-top-scroll triggers — no more fetch_older requests fire"
    - "On fetch_older_batch with error: log via console.warn; clear loading state + fetchInFlightRef; do NOT retry (per 43-CONTEXT.md § 'Fetch failure handling' — user can scroll back down and up again to re-trigger)"
    - "The scroll listener does NOT extend useAutoScroll's return surface — it uses a composed ref pattern in PrettyView that both forwards the element to useAutoScroll.scrollRef AND stores it in a local [scrollEl, setScrollEl] state for the new listener effect"
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "historyWindow connect + drop-oldest live-append cap + fetch_older client (eventId-only wire) + prepend-dedup + loading hint + reachedBeginning short-circuit"
      contains: "fetch_older_batch"
    - path: "src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx"
      provides: "Integration coverage: initial-window bounded, fetch_older prepend, drop-oldest fires, refetch-on-scroll-back, loading hint threshold sequence, reachedBeginning short-circuit"
  key_links:
    - from: "PrettyView.tsx openClaudeSessionSocket call"
      to: "historyWindow query param on the WS URL"
      via: "opts.historyWindow forwarding"
      pattern: "historyWindow"
    - from: "PrettyView.tsx onmessage switch"
      to: "prepend-dedup branch for fetch_older_batch"
      via: "isFetchOlderBatchEvent guard from 43-05"
      pattern: "fetch_older_batch"
    - from: "PrettyView.tsx composed scroll ref (scrollRef from useAutoScroll + local scrollEl state)"
      to: "sendFetchOlder from 43-05"
      via: "near-top-scroll trigger + debounce"
      pattern: "sendFetchOlder"
    - from: "PrettyView.tsx live-append branches"
      to: "drop-oldest cap enforcement"
      via: "wrapped appendDedup or new appendDedupWithCap"
      pattern: "WORKING_SET_CAP"
---

<objective>
Add windowed-pagination behavior to the plain-DOM PrettyView from plan 43-07a. This plan is the second half of the original 43-07 split: 43-07a removed the virtualizer and installed the plain-DOM message list; 43-07b now wires the historyWindow connect, the fetch_older client trigger + prepend path, the drop-oldest live-append cap, the loading hint, and the reachedBeginning short-circuit.

Purpose: This surgery turns the phase from "the plain-DOM scroller renders correctly" into "the windowed-pagination user experience described in 43-CONTEXT.md is live." After this ships, a user with a 300-message conversation sees the last 50 on connect, scrolls up, sees a "loading older…" hint if the round-trip is slow, sees the previous batch prepend, keeps scrolling — and if they leave the tab open long enough for the cap to fire, drop-oldest happens invisibly.

Output: Modifications to `PrettyView.tsx` are TWO surgical regions (F and G, continuing 43-07a's letter sequence). A dedicated integration test file exercises windowing scenarios. NO changes to bubble components, NO changes to the observation channel (backend), NO changes to the aside-arm walk (43-07a preserved it), NO changes to any file outside PrettyView.tsx + its new test.

Phase constants locked by planner (per 43-CONTEXT.md § "Working set" giving planner authority):
- INITIAL_WINDOW N = 50 (covers ~5-8 screens of scrollback for typical bubble heights, avoids trivial-scroll triggering fetch_older)
- WORKING_SET_CAP M = 150 (3x initial window; live sessions rarely exceed this within one client session; when they do, drop-oldest happens invisibly since the user is almost certainly reading the newest)
- REFETCH_BATCH_SIZE K = 50 (same as N — feels like "load another screen")
- NEAR_TOP_TRIGGER_PX = 500 (fires fetch_older when the user is within 500px of top AND older messages exist)
- LOAD_OLDER_DEBOUNCE_MS = 250 (prevents parallel fetches from flick-scrolls)
- LOADING_HINT_THRESHOLD_MS = 150 (per 43-CONTEXT.md § "Load-older UX")
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md
@.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md
@CLAUDE.md

# The file being extended (plain-DOM scroller from 43-07a is in place)
@src/ui/features/pretty-view/PrettyView.tsx

# Wire types + runtime helpers from 43-03 and 43-05
@src/ui/api/claude-session-api.ts

# Rewritten hook from 43-06 (API surface frozen — no scrollEl exposure)
@src/ui/features/pretty-view/use-auto-scroll.ts

# Plain-DOM test from 43-07a (test infrastructure reference)
@src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx

# Test infrastructure analog — reuse ws-stub factory + fireWsMessage + ResizeObserver polyfill + offsetHeight override verbatim
@src/ui/features/pretty-view/PrettyView.virtualization.test.tsx

# Test infrastructure sibling analog for WS-frame helpers
@src/ui/features/pretty-view/PrettyView.compose-send.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — write PrettyView.windowed-pagination.test.tsx covering the windowing behaviors</name>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.virtualization.test.tsx (whole file; L38-99 imports + WS stub mock; L100-139 flipToStreaming + fireWsMessage + fireMessageBatch helpers; L246-262 ResizeObserver polyfill; L285-320 HTMLElement.prototype.offsetHeight override for [data-pv-bubble])
    - src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (43-07a's test file — the shared test infrastructure pattern, imports, ws-stub factory)
    - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx (for the WS-send assertion shape when a fetch_older payload is emitted from the client)
    - src/ui/api/claude-session-api.ts (FetchOlderPayload EXACTLY = { type, anchorEventId, count } — no anchorLine; FetchOlderBatchEvent; sendFetchOlder + isFetchOlderBatchEvent — the wire the tests will drive against)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md § "10. NEW test: PrettyView.windowed-pagination.test.tsx" (test cases in exact terms)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md `<decisions>` § "Test coverage shape" + § "Load-older UX" + § "Fetch failure handling"
  </read_first>
  <files>src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx</files>
  <behavior>
    - Test 1 (historyWindow on connect): mount PrettyView; assert the ws stub's constructor URL contains `?historyWindow=50` (the planner-locked N).
    - Test 2 (initial-window bounded — only last N frames render on initial WS stream): fire the initial WS handshake response with 100 frames streamed in (simulating an unbounded server tail even though the client asked for 50 — the client should still respect its own perception; but in production the backend caps at 50, so we assert on what actually arrives). Actually the correct test shape: mount PrettyView, complete handshake, fire ONLY 50 frames (backend's bounded reply), assert `document.querySelectorAll('[data-pv-bubble]').length === 50` — this locks that the client renders whatever the backend sends without extra padding or duplication.
    - Test 3 (fetch_older sent on near-top scroll — payload shape LOCKED): fire N=50 message frames to fill the window. Fire near-top scroll via firePrettyViewScroll(scrollEl, NEAR_TOP_TRIGGER_PX - 1). Advance timers past LOAD_OLDER_DEBOUNCE_MS (251ms). Assert `ws.send` was called EXACTLY ONCE with a JSON payload matching EXACTLY `{ type: "fetch_older", anchorEventId: <first eventId from messages[0]>, count: 50 }` — no anchorLine field, no extra fields. Parse the sent JSON and assert on Object.keys.
    - Test 4 (fetch_older_batch prepends with dedup): after firing a fetch_older, respond with a `fetch_older_batch` frame containing 3 older frames with unique eventIds; assert the rendered DOM's `[data-event-id]` order now has the 3 older ids FIRST, then the original 50. Also test: respond with a batch containing one duplicate eventId (already in messages) and 2 new — assert dedup drops the duplicate (final count = 50 + 2, not 50 + 3).
    - Test 5 (drop-oldest fires when messages exceed cap): fire M+5 = 155 message frames sequentially (each via a new WS message); assert the rendered DOM contains at most WORKING_SET_CAP=150 `[data-pv-bubble]` elements; assert the oldest 5 eventIds are absent from the DOM (query by data-event-id).
    - Test 6 (refetch-on-scroll-back rehydrates): fire 155 message frames (triggering drop-oldest). Now scroll to near-top; assert fetch_older fires with anchorEventId = current messages[0].eventId (which is NOT the original first — it's whichever survived the drop). Simulate a fetch_older_batch response containing the previously-dropped frames; assert they prepend and appear in the DOM again.
    - Test 7 (loading hint appears after threshold — full fake-timer sequence): mount PrettyView with messages > INITIAL_WINDOW loaded (but cap not exceeded). Use `vi.useFakeTimers()`. (1) Fire near-top scroll via `firePrettyViewScroll(scrollEl, NEAR_TOP_TRIGGER_PX - 1)`. (2) `vi.advanceTimersByTime(LOAD_OLDER_DEBOUNCE_MS + 1)` (251ms — debounce fires). (3) Assert `ws.send` called with fetch_older payload; assert loading-hint element `[data-testid="pv-loading-older"]` NOT yet present. (4) `vi.advanceTimersByTime(LOADING_HINT_THRESHOLD_MS + 1)` (151ms — threshold fires). (5) Assert loading-hint element IS present. (6) Dispatch mock fetch_older_batch response over ws. (7) Assert loading-hint element removed.
    - Test 8 (reachedBeginning stops further trigger): after receiving a fetch_older_batch with `reachedBeginning: true`, subsequent near-top scrolls do NOT fire another fetch_older. Verify by: fire scroll, advance debounce timers, assert ws.send was called only the ONCE (before reachedBeginning); fire a SECOND scroll, advance timers, assert ws.send call count is STILL 1 (short-circuited).
    - Test 9 (fetch failure handling — error frame clears state without retry): fire fetch_older; respond with `{ type: "fetch_older_batch", frames: [], error: "anchor-not-found" }`. Assert: (a) loading hint removed; (b) fetchInFlightRef cleared (verifiable by: fire a fresh near-top scroll after error, advance timers, assert ws.send fires a NEW fetch_older — not blocked by stale in-flight state); (c) no retry fires automatically (assert ws.send call count between error-response and the user's fresh scroll is exactly 0 additions); (d) `console.warn` was called with a string containing the error (spy on console.warn in beforeEach).
    - Test 10 (auto-scroll follows when pinned): fire a message frame while the container's scrollTop === scrollHeight - clientHeight; wait a tick; assert scrollTop was updated to (new) scrollHeight - clientHeight (or scrollHeight, depending on how the hook writes it — assert isPinnedToBottom stayed true).
    - Test 11 (no yank when scrolled up during live-append): set scrollTop = 0, fire scroll to record unpinned, fire a message frame; assert scrollTop is STILL 0.
  </behavior>
  <action>
    Create `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx`. Copy the imports + WS stub factory + flipToStreaming + fireWsMessage + fireMessageBatch + ResizeObserver polyfill + HTMLElement.prototype.offsetHeight override from `PrettyView.virtualization.test.tsx` verbatim (attribution comment: "// Test infrastructure lifted from PrettyView.virtualization.test.tsx per 43-PATTERNS.md § 10; that file is slated for deletion in plan 43-08"). Extend with two helpers:

    (1) `fireFetchOlderBatch(ws, frames, opts?)` — sends `{ type: "fetch_older_batch", frames, reachedBeginning: opts?.reachedBeginning, error: opts?.error }` via ws.onmessage under act().

    (2) `firePrettyViewScroll(el, scrollTop)` — sets `Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true })` and dispatches a scroll event under act().

    Use `vi.useFakeTimers()` in tests that need to advance debounce + loading-hint timers (Tests 3, 7, 8, 9 at minimum). In `beforeEach`, spy on `console.warn` for Test 9. Write Tests 1-11 above. Every test uses fresh WS stubs (reset in beforeEach). Run `npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` — every test must FAIL against the 43-07a-only implementation (no historyWindow on connect, no fetch_older client, no drop-oldest, no loading hint).
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx 2>&1 | grep -E "failed|FAIL" ; test $? -eq 0</automated>
  </verify>
  <acceptance_criteria>
    - Test file exists.
    - `grep -c "fetch_older" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 8.
    - `grep -c "historyWindow" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 2.
    - `grep -c "data-pv-bubble" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 3 (drop-oldest DOM query + prepend order assertion + refetch verification).
    - `grep -c "pv-loading-older" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 2 (assert-present + assert-absent).
    - `grep -c "reachedBeginning" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 2 (Test 8 setup + assertion).
    - `grep -c "anchorLine" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns EXACTLY 0 (Test 3 asserts on the wire contract's EXACT shape: no anchorLine field; testing FOR its absence).
    - `grep -c "console.warn\|consoleWarnSpy\|warnSpy" src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` returns >= 1 (Test 9).
    - All 11 tests fail with red output.
  </acceptance_criteria>
  <done>
    Failing test file committed. Commit as `test(43-07b): add failing PrettyView windowed-pagination spec`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — add historyWindow connect + drop-oldest + fetch_older client + prepend + loading hint + reachedBeginning short-circuit</name>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.tsx (targeted regions only — do NOT dump the whole file; read: L1-50 imports (Region F1 target); L180-235 appendDedup helper (Region F2 target — wrap with cap); L1219-1260 openClaudeSessionSocket call site (Region F3 target); L1290-1362 onmessage switch (Region F4 target — wrap live-append + add fetch_older_batch case); L2360+ the plain-DOM map from 43-07a (Region G target — add loading hint element at top; add composed ref for scroll listener))
    - src/ui/api/claude-session-api.ts (FetchOlderPayload = { type, anchorEventId, count } — NO anchorLine; FetchOlderBatchEvent; sendFetchOlder; isFetchOlderBatchEvent — the wire contract to consume)
    - src/ui/features/pretty-view/use-auto-scroll.ts (43-06's frozen surface — {scrollRef, scrollToBottomAndFollow, isPinnedToBottom}; DO NOT extend to expose scrollEl; the composed ref pattern in Region G obtains the element separately)
    - src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (Task 1's RED spec — the assertions to satisfy)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md § "5. PrettyView.tsx" (onmessage switch extension + drop-oldest pattern + fetch_older client trigger)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md `<decisions>` § "Load-older UX" + § "Fetch failure handling"
  </read_first>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
    Modify `src/ui/features/pretty-view/PrettyView.tsx` in TWO surgical regions (F and G, continuing 43-07a's letter sequence). Do NOT reformat code outside these regions. Do NOT touch bubble components. Do NOT touch the aside-arm walk (43-07a preserved it via anchor comments).

    Region F — imports, module constants, openClaudeSessionSocket call, onmessage switch extensions, drop-oldest wrapper.

    F1 (imports): Add `import { sendFetchOlder, isFetchOlderBatchEvent, type FetchOlderPayload, type FetchOlderBatchEvent } from "@/api/claude-session-api";` (use whatever path alias PrettyView.tsx uses for other api imports — verify by grepping existing imports).

    F2 (module constants): Near the other module-scope constants (or at the top of the module), declare:
      const INITIAL_WINDOW = 50;
      const WORKING_SET_CAP = 150;
      const REFETCH_BATCH_SIZE = 50;
      const NEAR_TOP_TRIGGER_PX = 500;
      const LOAD_OLDER_DEBOUNCE_MS = 250;
      const LOADING_HINT_THRESHOLD_MS = 150;

    F3 (drop-oldest helper): Near the existing `appendDedup` helper at L190, add a companion:
      function appendDedupWithCap<T extends { eventId: string }>(prev: T[], next: T, cap: number): T[] {
        if (prev.some((m) => m.eventId === next.eventId)) return prev;
        const withNew = [...prev, next];
        return withNew.length > cap ? withNew.slice(withNew.length - cap) : withNew;
      }
    Do NOT delete or modify the existing `appendDedup`. The new helper wraps its behavior; each `case "message"` / `case "image"` / `case "relay_*"` branch is updated to call `appendDedupWithCap` with `WORKING_SET_CAP` instead of calling `appendDedup` directly.

    F4 (openClaudeSessionSocket call): Find via `grep -n "openClaudeSessionSocket()" src/ui/features/pretty-view/PrettyView.tsx`. Change to `openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW })`.

    F5 (onmessage switch — live-append wraps): In each existing `case "message"`, `case "image"`, `case "relay_outbound"`, `case "relay_inbound"` branch (at L1290-1362), replace the `setMessages((prev) => appendDedup(prev, parsed))` call with `setMessages((prev) => appendDedupWithCap(prev, parsed, WORKING_SET_CAP))`. Preserve the existing autoplay logic inside `case "message"` and every other side-effect within each branch.

    F6 (onmessage switch — fetch_older_batch case): Add a new branch in the same switch:
      case "fetch_older_batch": {
        if (!isFetchOlderBatchEvent(parsed)) break;
        // Clear in-flight + loading state regardless of success/error.
        fetchInFlightRef.current = false;
        setLoadingOlder(false);
        if (loadingHintTimerRef.current) {
          clearTimeout(loadingHintTimerRef.current);
          loadingHintTimerRef.current = null;
        }
        if (parsed.error) {
          // Fetch failure handling per 43-CONTEXT.md § 'Fetch failure handling':
          // log, do NOT retry, user can scroll back down and up again to re-trigger.
          console.warn("[PrettyView] fetch_older_batch error:", parsed.error);
          break;
        }
        if (parsed.reachedBeginning) reachedBeginningRef.current = true;
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.eventId));
          const fresh = (parsed.frames as StreamEvent[]).filter((f) => !existing.has(f.eventId));
          return [...fresh, ...prev];
        });
        break;
      }

    Region G — composed scroll ref + near-top-scroll listener + loading hint UI + debounced fetch_older sender.

    G1 (component-level state + refs): Inside the PrettyView component, add:
      const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
      const reachedBeginningRef = useRef<boolean>(false);
      const fetchInFlightRef = useRef<boolean>(false);
      const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
      const loadingHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    G2 (composed scroll ref — LOCKED APPROACH per MED-3): Compose a local `useCallback` ref that (a) calls `useAutoScroll`'s `scrollRef` with the element, (b) stores the element in the local `scrollEl` state. Concretely:
      const autoScroll = useAutoScroll(paneKey, messages.length);
      const composedScrollRef = useCallback((el: HTMLElement | null) => {
        autoScroll.scrollRef(el);
        setScrollEl(el);
      }, [autoScroll.scrollRef]);
    Then attach `composedScrollRef` (not `autoScroll.scrollRef` directly) to the outer scroll container in the JSX.

    This approach is LOCKED — it is FORBIDDEN to extend useAutoScroll to expose scrollEl or add a 4th return field (43-06 Test 8 pins the hook's surface at exactly `{ scrollRef, scrollToBottomAndFollow, isPinnedToBottom }`). The composed ref pattern preserves the frozen hook API while still giving PrettyView direct access to the element for its own listener.

    G3 (near-top-scroll listener effect — separate from useAutoScroll's internal effect):
      useEffect(() => {
        if (!scrollEl) return;
        const handleScroll = () => {
          if (reachedBeginningRef.current) return;
          if (fetchInFlightRef.current) return;
          if (messages.length === 0) return;
          if (scrollEl.scrollTop > NEAR_TOP_TRIGGER_PX) return;
          // Debounce.
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            fireFetchOlder();
          }, LOAD_OLDER_DEBOUNCE_MS);
        };
        scrollEl.addEventListener("scroll", handleScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", handleScroll);
      }, [scrollEl, messages, /* ... other deps as needed ... */]);

    G4 (fireFetchOlder helper):
      const fireFetchOlder = useCallback(() => {
        if (fetchInFlightRef.current) return;
        if (reachedBeginningRef.current) return;
        if (messages.length === 0) return;
        const ws = wsRef.current;
        if (!ws) return;
        fetchInFlightRef.current = true;
        // Schedule loading hint after threshold.
        loadingHintTimerRef.current = setTimeout(() => {
          loadingHintTimerRef.current = null;
          setLoadingOlder(true);
        }, LOADING_HINT_THRESHOLD_MS);
        // Wire contract per 43-03: EXACTLY { type, anchorEventId, count } — no anchorLine.
        const payload: FetchOlderPayload = {
          type: "fetch_older",
          anchorEventId: messages[0].eventId,
          count: REFETCH_BATCH_SIZE,
        };
        const sent = sendFetchOlder(ws, payload);
        if (!sent) {
          // Send failed (socket not open). Clear state — no retry (per fetch-failure-handling).
          fetchInFlightRef.current = false;
          if (loadingHintTimerRef.current) {
            clearTimeout(loadingHintTimerRef.current);
            loadingHintTimerRef.current = null;
          }
          setLoadingOlder(false);
        }
      }, [messages, /* wsRef stable */]);

    G5 (loading hint element in JSX): At the top of the scroll container (inside the container, BEFORE the `messages.map` block), render:
      {loadingOlder && (
        <div data-testid="pv-loading-older" role="status" className="/* subtle warm-gray text, small, centered — align with existing pretty-view visual language */">
          loading older messages…
        </div>
      )}

    Executor: pick the exact className styling to match existing pretty-view conventions (warm-gray text, small, centered). The `data-testid="pv-loading-older"` is REQUIRED for Task 1's Test 7 assertion.

    G6 (cleanup on unmount): Ensure both `debounceTimerRef` and `loadingHintTimerRef` are cleared in a component-unmount effect (or in the same effect that owns them). Prevents state updates on unmounted component.

    CRITICAL preserves:
    - Aside-arm backwards-walk (bracketed by 43-07a's anchor comments) — DO NOT TOUCH.
    - Plain-DOM message map from 43-07a — the `{messages.map(...)}` block stays; only the surrounding container gets the composed ref and the loading hint sibling.
    - Existing `appendDedup` helper — KEEP (F3's new helper wraps it; the original may still be used elsewhere).
    - Every bubble component render.
    - Every accessory sibling (WipBubble, PlanPendingBubble, AsideBubble, WaitingBubble).
    - Existing `case "message"` autoplay logic and any side-effects in each onmessage branch.

    Run: `npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` — all 11 tests must PASS. Then run: `npx vitest run src/ui/features/pretty-view/` — only failures allowed are `PrettyView.virtualization.test.tsx` and `PrettyView.estimateSize.test.tsx` (both slated for plan 43-08 deletion). Any other regression is a bug in this plan. Confirm build: `npm run build` — exit 0.

    Post-edit sanity: `grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx` MUST return 0 — the wire contract in 43-03 is eventId-only.
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx</automated>
    <automated>npx vitest run src/ui/features/pretty-view/ 2>&1 | tail -30</automated>
    <automated>npm run build</automated>
    <automated>grep -c 'fetch_older_batch' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'WORKING_SET_CAP\|INITIAL_WINDOW\|REFETCH_BATCH_SIZE\|NEAR_TOP_TRIGGER_PX\|LOAD_OLDER_DEBOUNCE_MS\|LOADING_HINT_THRESHOLD_MS' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'sendFetchOlder' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'appendDedupWithCap' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'data-testid="pv-loading-older"' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'reachedBeginningRef' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'composedScrollRef\|setScrollEl' src/ui/features/pretty-view/PrettyView.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'fetch_older_batch' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (case label + guard call, or similar).
    - `grep -c 'WORKING_SET_CAP' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in appendDedupWithCap call).
    - `grep -c 'INITIAL_WINDOW' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in openClaudeSessionSocket call).
    - `grep -c 'REFETCH_BATCH_SIZE' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in fetch_older payload).
    - `grep -c 'NEAR_TOP_TRIGGER_PX' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in scroll listener gate).
    - `grep -c 'LOAD_OLDER_DEBOUNCE_MS' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in setTimeout).
    - `grep -c 'LOADING_HINT_THRESHOLD_MS' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (const + usage in setTimeout).
    - `grep -c 'sendFetchOlder' src/ui/features/pretty-view/PrettyView.tsx` returns >= 1 (import + call — the import may count separately depending on styling).
    - `grep -c 'appendDedupWithCap' src/ui/features/pretty-view/PrettyView.tsx` returns >= 5 (helper definition + 4 case branches using it: message/image/relay_outbound/relay_inbound).
    - `grep -c 'data-testid="pv-loading-older"' src/ui/features/pretty-view/PrettyView.tsx` returns EXACTLY 1.
    - `grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx` returns EXACTLY 0 (wire contract locked: no line-offset field).
    - `grep -c 'reachedBeginningRef' src/ui/features/pretty-view/PrettyView.tsx` returns >= 3 (declaration + set + read in guard).
    - `grep -c 'composedScrollRef\|setScrollEl' src/ui/features/pretty-view/PrettyView.tsx` returns >= 2 (composed ref pattern per MED-3 — locked, no useAutoScroll extension).
    - `grep -c 'console.warn' src/ui/features/pretty-view/PrettyView.tsx` returns >= 1 (error path per LOW-2).
    - All 11 tests from Task 1 PASS.
    - `npx vitest run src/ui/features/pretty-view/` — only failures are `PrettyView.virtualization.test.tsx` and `PrettyView.estimateSize.test.tsx` (both slated for plan 43-08 deletion).
    - `npm run build` exits 0.
  </acceptance_criteria>
  <done>
    PrettyView has windowed-pagination fully wired: historyWindow on connect, drop-oldest live-append cap, fetch_older client (eventId-only), prepend-dedup, loading hint with 150ms threshold, reachedBeginning short-circuit, error-path warn-and-clear-no-retry, composed scroll ref (no useAutoScroll surface extension). Commit as `feat(43-07b): PrettyView windowed pagination + fetch_older client`.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` — exit 0, 11+ tests passing.
- `npx vitest run src/ui/features/pretty-view/` — only `PrettyView.virtualization.test.tsx` + `PrettyView.estimateSize.test.tsx` failing (both cleanup targets for plan 43-08).
- `npm run build` — exit 0.
- `grep -c 'anchorLine' src/ui/features/pretty-view/PrettyView.tsx` — returns 0 (wire contract locked).
- `grep -c 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` — returns EXACTLY 1 (aside-arm walk still intact from 43-07a).
- `grep -c 'composedScrollRef\|setScrollEl' src/ui/features/pretty-view/PrettyView.tsx` — returns >= 2 (composed ref pattern locked, useAutoScroll unchanged).
</verification>

<success_criteria>
- Windowed-pagination fully wired: initial-window bounded on connect, fetch_older client fires on near-top scroll with eventId-only payload, prepend-dedup on batch response, drop-oldest on live-append past cap, loading hint after threshold with full fake-timer sequence coverage, reachedBeginning short-circuit, error-path warn-and-clear-no-retry.
- useAutoScroll surface UNCHANGED — composed ref pattern in PrettyView provides scrollEl access without extending the hook (43-06 Test 8 still passes).
- Aside-arm walk still byte-preserved (43-07a's anchor comments and content-based grep continue to pass).
- Only failing tests in the pretty-view directory are the two virt-specific test files, both slated for plan 43-08 deletion.
</success_criteria>

<output>
Create `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-07b-SUMMARY.md` when done.
</output>
</content>
</invoke>