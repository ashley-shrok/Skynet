---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 07a
type: execute
wave: 3
depends_on: ['43-04', '43-05', '43-06']
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "PrettyView.tsx no longer imports useVirtualizer, VirtualItem, or anything from @tanstack/react-virtual"
    - "The message list renders each entry of messages[] as a plain in-flow child of the scroll container (no absolute positioning, no measurement observer, no virtualized item mapping)"
    - "The outer scroll container's className no longer contains [overflow-anchor:none] — the browser default overflow-anchor:auto is load-bearing"
    - "estimatePvBubbleSize, getItemKey, observeElementRect, initialRect, scrollMargin are ALL removed (dead code)"
    - "getMessageText is also removed (dead code after estimatePvBubbleSize deletion)"
    - "The aside-arm backwards-walk at PrettyView.tsx:2056 is byte-preserved — verified via content-based grep (survives line shifts caused by deletions above)"
    - "Every existing rendered bubble component (ChatMessage, ImageBubble, RelayInboundBubble, RelayOutboundBubble, MalformedBubble, WipBubble, PlanPendingBubble, AsideBubble, WaitingBubble) continues to render identically — only the container changes"
    - "No windowing behavior added in this plan — plan 43-07b handles historyWindow connect, fetch_older client, drop-oldest cap, prepend-dedup, loading hint"
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Plain-DOM message list scroller (virtualizer removed); bubble rendering preserved verbatim; overflow-anchor default enabled"
      contains: "data-pv-bubble"
    - path: "src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx"
      provides: "Coverage locking (a) plain-DOM render, (b) overflow-anchor NOT disabled, (c) aside-arm walk preserved, (d) accessory bubbles (Wip/PlanPending/Aside) still render as siblings, (e) all message frames render as data-pv-bubble children"
  key_links:
    - from: "PrettyView.tsx message list JSX"
      to: "in-flow map over messages[] rendering data-pv-bubble children"
      via: "plain-DOM (no useVirtualizer, no absolute positioning)"
      pattern: "data-pv-bubble"
    - from: "PrettyView.tsx outer scroll container"
      to: "browser default overflow-anchor:auto (load-bearing)"
      via: "className omits [overflow-anchor:none]"
      pattern: "overflow-anchor"
    - from: "PrettyView.tsx aside-arm suppression walk"
      to: "backwards walk from messages.length-1 finding last user turn"
      via: "unchanged from Phase 27+"
      pattern: "for \\(let i = messages\\.length - 1"
---

<objective>
Remove TanStack Virtual from PrettyView and replace the message list with a plain-DOM scroller. NO windowing behavior in this plan — this is the pure "virtualizer out, plain-DOM in" surgery. Plan 43-07b runs immediately after and adds windowed pagination (historyWindow connect, fetch_older client, drop-oldest, prepend-dedup, loading hint) on top of the plain-DOM base.

Purpose: Splitting the PrettyView surgery into two sequential plans within Wave 3 bounds executor scope. 43-07a handles the deletion + rendering-shape change (5 surgical regions, 4-6 tests). 43-07b handles the new behavior (2 surgical regions, 5-7 tests). Both together match the total scope of the original monolithic 43-07 while keeping each plan's context cost within the ~40% budget for surgical work.

Sequencing: 43-07b `depends_on: ['43-07a']` so it runs strictly after this plan in the same wave. Both share the file `src/ui/features/pretty-view/PrettyView.tsx`, which mandates sequential execution.

Output: PrettyView.tsx with the virtualizer cluster removed and replaced with plain-DOM message rendering. A dedicated test file locking the plain-DOM behavior. Aside-arm walk byte-preserved. No changes to bubble components or any file outside PrettyView.tsx + its new test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md
@.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md
@CLAUDE.md

# The file being heavily modified
@src/ui/features/pretty-view/PrettyView.tsx

# Rewritten hook from 43-06 (API surface preserved — {scrollRef, scrollToBottomAndFollow, isPinnedToBottom})
@src/ui/features/pretty-view/use-auto-scroll.ts

# Test infrastructure analog — reuse ws-stub factory + fireWsMessage + ResizeObserver polyfill + offsetHeight override verbatim
@src/ui/features/pretty-view/PrettyView.virtualization.test.tsx

# Test infrastructure sibling analog for WS-frame helpers
@src/ui/features/pretty-view/PrettyView.compose-send.test.tsx

# Test infrastructure sibling for RO polyfill widening
@src/ui/features/pretty-view/PrettyView.aside.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — write PrettyView.plain-dom.test.tsx locking the plain-DOM render + preserves</name>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.virtualization.test.tsx (whole file; L38-99 imports + WS stub mock; L100-139 flipToStreaming + fireWsMessage + fireMessageBatch helpers; L246-262 ResizeObserver polyfill; L285-320 HTMLElement.prototype.offsetHeight override for [data-pv-bubble])
    - src/ui/features/pretty-view/PrettyView.aside.test.tsx (analog for aside-related rendering assertions)
    - src/ui/features/pretty-view/PrettyView.tsx (READ TARGET REGIONS ONLY: L2054-2075 to see the aside-arm backwards-walk that must be preserved; L2354-2358 to see the outer scroll container className that must lose `[overflow-anchor:none]`)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md § "5. PrettyView.tsx — delete virtualizer, add plain-DOM scroller" (deletion targets + new plain-DOM skeleton)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md `<decisions>` § "Deletion scope" + § "Aside-arm suppression walk"
  </read_first>
  <files>src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx</files>
  <behavior>
    - Test 1 (plain-DOM render): mount PrettyView; fire a batch of 20 message frames via the ws stub; assert `document.querySelectorAll('[data-pv-bubble]').length === 20`. Assert that each `[data-pv-bubble]` element is a DIRECT in-flow child (no absolute positioning: `getComputedStyle(el).position !== 'absolute'`, or query for the presence of `style="transform: translateY(..."` and assert it's absent).
    - Test 2 (overflow-anchor NOT disabled): query the scroll container (via a data-testid the executor adds in Region D, or via the same ref path PrettyView.tsx uses); assert its className string does NOT contain "overflow-anchor:none" nor "[overflow-anchor:none]"; either the class is absent (browser default overflow-anchor:auto wins) or the class explicitly sets "overflow-anchor:auto".
    - Test 3 (aside-arm walk preserved — behavioral): fire a message batch including an assistant turn, a tool call, and a user turn saying "/id foo". Fire the aside-arm trigger (however PrettyView.aside.test.tsx exercises it). Assert the aside-arm walk finds the last user turn correctly and the aside bubble suppression behaves identically to pre-plan behavior. (This test is the behavioral proxy for "the backwards walk at line 2056 was not touched" — if the walk is byte-preserved, this test passes; if the walk was accidentally deleted or reordered, this test fails.)
    - Test 4 (accessory bubbles render as siblings): fire a message batch, then fire whatever ws frames trigger WipBubble / PlanPendingBubble / AsideBubble to render. Assert each accessory bubble is present in the DOM AND is a sibling of the message-list container (or inside the same outer scroll container), preserving the pre-plan layout invariant established in Phase 27.
    - Test 5 (all five bubble types render): fire one message of each type (message/image/relay_outbound/relay_inbound/malformed). Assert all five render inside their respective `[data-pv-bubble]` wrappers with the correct bubble component subtree (check for characteristic classnames or text).
    - Test 6 (data-event-id preserved on each bubble): after firing 5 frames with unique eventIds, assert each `[data-pv-bubble]` has a matching `data-event-id` attribute equal to the frame's eventId.
  </behavior>
  <action>
    Create `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx`. Copy the imports + WS stub factory + flipToStreaming + fireWsMessage + fireMessageBatch + ResizeObserver polyfill + HTMLElement.prototype.offsetHeight override from `PrettyView.virtualization.test.tsx` verbatim (attribution comment: "// Test infrastructure lifted from PrettyView.virtualization.test.tsx per 43-PATTERNS.md § 10; that file is slated for deletion in plan 43-08"). Do NOT include fetch_older / windowing helpers — those belong in plan 43-07b's test file. Write Tests 1-6 above. Every test uses fresh WS stubs (reset in beforeEach). Run `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` — every test must FAIL against the current virtualizer-based implementation (data-pv-bubble count assertion fails because virtualizer only renders visible items; overflow-anchor assertion fails because current className includes `[overflow-anchor:none]`; etc.).
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx 2>&1 | grep -E "failed|FAIL" ; test $? -eq 0</automated>
  </verify>
  <acceptance_criteria>
    - Test file exists.
    - `grep -c "data-pv-bubble" src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` returns >= 3 (render count + accessory sibling + data-event-id assertions).
    - `grep -c "overflow-anchor" src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` returns >= 1.
    - `grep -c "aside" src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` returns >= 1 (Test 3).
    - All 6 tests fail with red output.
  </acceptance_criteria>
  <done>
    Failing test file committed. Commit as `test(43-07a): add failing PrettyView plain-DOM render spec`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — add aside-arm walk anchor comments (pre-edit), snapshot, remove virtualizer + add plain-DOM scroller, byte-verify aside-arm walk unchanged</name>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.tsx (targeted regions only — do NOT dump 2732 lines — read: L1-50 imports; L180-235 for estimatePvBubbleSize + getMessageText (Region B deletion target); L920-1030 virtualizer setup cluster (Region C deletion target); L2054-2075 aside-arm backwards-walk (anchor comment insertion + byte-preserve); L2354-2358 outer scroll container className (Region D edit target — REMOVE [overflow-anchor:none]); L2360-2450 virtualized render (Region E deletion + replacement target))
    - src/ui/features/pretty-view/use-auto-scroll.ts (rewritten in 43-06 — the API surface {scrollRef, scrollToBottomAndFollow, isPinnedToBottom} is stable and frozen)
    - src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (Task 1's RED spec — the assertions to satisfy)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md § "5. PrettyView.tsx" (deletion targets + new plain-DOM skeleton)
    - .planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md `<decisions>` § "Deletion scope" + § "Aside-arm suppression walk"
  </read_first>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
    Modify `src/ui/features/pretty-view/PrettyView.tsx` in FIVE surgical regions (A-E), preceded by a pre-edit anchor-comment insertion around the aside-arm walk. Do NOT reformat code outside these regions. Do NOT touch bubble components.

    PRE-EDIT STEP — insert aside-arm walk anchor comments FIRST, snapshot the region, then edit everything else:
    1. Locate the aside-arm backwards-walk (search: `grep -n "for (let i = messages.length - 1; i >= 0; i--)" src/ui/features/pretty-view/PrettyView.tsx` — expected around L2056). Immediately BEFORE that line, insert the anchor comment on its own line: `// ── PHASE-43 ASIDE-ARM WALK START — DO NOT EDIT; byte-preserved per 43-CONTEXT.md aside-arm suppression walk decision ──`
    2. Locate the walk's terminating `break;` inside the loop (or the loop's closing `}` if there is no early break — verify by reading L2056-L2075). Immediately AFTER the loop closes, insert on its own line: `// ── PHASE-43 ASIDE-ARM WALK END ──`
    3. Snapshot the region into `/tmp/43-07a-aside-before.txt`:
       `awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx > /tmp/43-07a-aside-before.txt`
    4. Do NOT commit yet; the anchor comments land with the rest of the changes.

    Region A — imports. Remove `useVirtualizer` and `VirtualItem` from the `@tanstack/react-virtual` import; then remove the entire import line if nothing else was imported from that package. Do NOT add any new imports in this plan — plan 43-07b will add `sendFetchOlder / isFetchOlderBatchEvent / FetchOlderPayload / FetchOlderBatchEvent`.

    Region B — delete dead-code helpers. Remove `estimatePvBubbleSize` and `getMessageText` at L199-232 in their entirety.

    Region C — delete the virtualizer setup cluster at L920-1030. This removes `observeElementRect`, `useVirtualizer` call, `getItemKey`, `estimateSize`, `initialRect`, `scrollMargin`, and the entire `rowVirtualizer` const. If a `virtualScrollRef` composed ref was in use, replace it in the outer container with the plain `scrollRef` from useAutoScroll (which now IS the scroll container ref per plan 43-06).

    Region D — remove `[overflow-anchor:none]` from the outer scroll container className at L2354-2358. The className string becomes (or similar — the executor preserves every OTHER class): `"flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3"` (i.e. drop just the `[overflow-anchor:none]` Tailwind arbitrary-value class; leave every other class). Update or delete the surrounding comment about "quick 260810-ia4 Fix 3" — replace with a new comment: `// Phase 43: [overflow-anchor:none] REMOVED — browser default overflow-anchor:auto is load-bearing for prepend/growth preservation.` Also add a `data-testid="pv-scroll-container"` (or similar identifier) if the test needs a query hook — executor's call; if the existing ref path is sufficient for Task 1's Test 2 assertion, skip.

    Region E — replace virtualized render at L2360-2450 with plain-DOM. Where the JSX previously had `<div style={{ height: totalSize }}>{ rowVirtualizer.getVirtualItems().map(...) }</div>` (or similar absolute-positioned wrapper), replace with `{messages.map((m) => (<div key={m.eventId} data-pv-bubble data-event-id={m.eventId}>{ /* SAME bubble-branch expression that was inside the virtual item body — ChatMessage / ImageBubble / RelayOutboundBubble / RelayInboundBubble / MalformedBubble — copied verbatim */ }</div>))}`. Preserve the `data-pv-bubble` attribute — it is load-bearing for tests. Preserve every existing accessory sibling (WipBubble, PlanPendingBubble, AsideBubble, WaitingBubble) as siblings inside the outer scroll container, at the SAME structural position they occupied before (below the message-list map).

    CRITICAL preserves:
    - Aside-arm backwards-walk at L2056 (now bracketed by anchor comments) — DO NOT TOUCH the walk body.
    - Every bubble component render — copy the branch expression verbatim from inside the old virtual item body.
    - Every accessory sibling (WipBubble, PlanPendingBubble, AsideBubble, WaitingBubble) — same structural position relative to the message-list container.
    - Existing appendDedup helper at L190 — do NOT touch; plan 43-07b will wrap it with cap enforcement.
    - Existing `case "message"` / `case "image"` / `case "relay_*"` onmessage branches — DO NOT touch in this plan; plan 43-07b handles those.
    - Existing `openClaudeSessionSocket()` call at ~L1219 — DO NOT touch in this plan; plan 43-07b changes it to pass `{ historyWindow: INITIAL_WINDOW }`.

    POST-EDIT BYTE-VERIFY — after all Region A-E edits complete:
    1. Extract the anchored aside-arm region:
       `awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx > /tmp/43-07a-aside-after.txt`
    2. Diff against the pre-edit snapshot:
       `diff /tmp/43-07a-aside-before.txt /tmp/43-07a-aside-after.txt`
    3. Exit code MUST be 0 (empty diff — the aside-arm walk body is byte-identical to pre-edit). If the diff is non-empty, revert the accidental changes to the walk before proceeding.
    4. Additionally: content-based grep (survives line shifts from Region B/C deletions above):
       - `grep -c 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` MUST return exactly 1 (the walk exists once — not deleted, not duplicated).
       - `grep -B1 -A6 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` MUST contain ALL of: `const m = messages[i];`, `if (m.type === "message" && m.role === "user")`, `if (isIdCommand(m.content)) return;`, `break;` — the walk's body identifiers/keywords are all still present (byte-preserved).

    Run: `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` — all 6 tests from Task 1 must PASS. Then run the full pretty-view suite: `npx vitest run src/ui/features/pretty-view/` — every non-virt-specific test must still pass (some virt-specific tests will remain broken until plan 43-08 deletes them; the failing subset MUST be limited to `PrettyView.virtualization.test.tsx` and `PrettyView.estimateSize.test.tsx` — any other regression is a bug in this plan). Confirm build: `npm run build` — exit 0.
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx</automated>
    <automated>npx vitest run src/ui/features/pretty-view/ 2>&1 | tail -30</automated>
    <automated>npm run build</automated>
    <automated>grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c 'useVirtualizer\|VirtualItem\|observeElementRect\|estimatePvBubbleSize\|getItemKey\|initialRect\|scrollMargin\|getMessageText'</automated>
    <automated>grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c '\[overflow-anchor:none\]'</automated>
    <automated>grep -c 'data-pv-bubble' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -B1 -A6 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx | grep -c 'const m = messages\[i\]\|role === "user"\|isIdCommand\|break;'</automated>
    <automated>grep -c 'PHASE-43 ASIDE-ARM WALK START' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>grep -c 'PHASE-43 ASIDE-ARM WALK END' src/ui/features/pretty-view/PrettyView.tsx</automated>
    <automated>awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx > /tmp/43-07a-aside-after.txt && diff /tmp/43-07a-aside-before.txt /tmp/43-07a-aside-after.txt</automated>
  </verify>
  <acceptance_criteria>
    - `grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c 'useVirtualizer\|VirtualItem\|observeElementRect\|estimatePvBubbleSize\|getItemKey\|initialRect\|scrollMargin\|getMessageText'` returns 0 (all seven symbols removed from non-comment code).
    - `grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c '\[overflow-anchor:none\]'` returns 0 (Tailwind class removed).
    - `grep -c 'data-pv-bubble' src/ui/features/pretty-view/PrettyView.tsx` returns >= 1 (preserved on the new plain-DOM map).
    - `grep -c 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` returns EXACTLY 1 (aside-arm walk exists once — not deleted, not duplicated; this is the content-based byte-verify surviving line shifts).
    - `grep -B1 -A6 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` output contains ALL of: `const m = messages[i];`, `role === "user"`, `isIdCommand`, `break;` (the walk's body byte-preserved by content signature).
    - `grep -c 'PHASE-43 ASIDE-ARM WALK START' src/ui/features/pretty-view/PrettyView.tsx` returns EXACTLY 1.
    - `grep -c 'PHASE-43 ASIDE-ARM WALK END' src/ui/features/pretty-view/PrettyView.tsx` returns EXACTLY 1.
    - `awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx | diff /tmp/43-07a-aside-before.txt -` returns exit 0 (delimiter-anchored byte-verify — walk region byte-unchanged).
    - All 6 tests from Task 1 PASS.
    - `npx vitest run src/ui/features/pretty-view/` — only failures are `PrettyView.virtualization.test.tsx` and `PrettyView.estimateSize.test.tsx` (both slated for deletion in plan 43-08). Enumerate failing files to confirm nothing else regressed.
    - `npm run build` exits 0.
  </acceptance_criteria>
  <done>
    Virtualizer removed from PrettyView; plain-DOM map in place; aside-arm walk byte-preserved (proven via both delimiter-anchored diff AND content-based grep signature); overflow-anchor class dropped; all plain-DOM tests green; only virt-specific tests fail (43-08 cleans them); build clean. Commit as `refactor(43-07a): remove TanStack Virtual + plain-DOM PrettyView scroller`.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` — exit 0, 6+ tests passing.
- `npx vitest run src/ui/features/pretty-view/` — only `PrettyView.virtualization.test.tsx` + `PrettyView.estimateSize.test.tsx` failing (both cleanup targets for plan 43-08).
- `npm run build` — exit 0.
- `grep -c 'useVirtualizer' src/ui/features/pretty-view/PrettyView.tsx` — returns 0.
- `grep -c '\[overflow-anchor:none\]' src/ui/features/pretty-view/PrettyView.tsx` — returns 0.
- `grep -c '@tanstack/react-virtual' src/ui/features/pretty-view/PrettyView.tsx` — returns 0.
- `grep -c 'for (let i = messages.length - 1; i >= 0; i--)' src/ui/features/pretty-view/PrettyView.tsx` — returns EXACTLY 1 (aside-arm walk survived).
- `awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx | diff /tmp/43-07a-aside-before.txt -` — exit 0.
</verification>

<success_criteria>
- Virtualizer completely gone from PrettyView.tsx.
- Plain-DOM scroller renders every message as an in-flow child.
- Aside-arm walk byte-preserved (proven by delimiter-anchored diff + content-based grep).
- All bubble components render identically (per-bubble output byte-equivalent).
- Only failing tests in the pretty-view directory are the two virt-specific test files, both slated for plan 43-08 deletion.
- Plan 43-07b immediately follows in the same wave, sharing PrettyView.tsx sequentially.
</success_criteria>

<output>
Create `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-07a-SUMMARY.md` when done.
</output>
</content>
</invoke>