---
quick_id: 260730-jes
type: execute
autonomous: true
files_modified:
  - src/ui/AppShell.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
must_haves:
  truths:
    - "Tapping Deactivate on an active conversation row updates the pretty-conversations list synchronously (Zustand active-set removal paints in the same frame)"
    - "The heavy tab-switch commit (unmount old PrettyView + mount next PrettyView with fresh WS setup, backfill dispatch, message-bubble render) no longer blocks the list paint"
    - "The four setState calls in doCloseTab (setActiveTabId, selectConversation, setPaneTabIds, setTabs) run inside a single React 18 startTransition"
    - "The synchronous prelude in doCloseTab (tabs.find, deleteOpenTab fire-and-forget, terminalRefs.current.delete) still runs synchronously inside the event handler"
    - "A block comment above the startTransition block documents WHY (heavy PrettyView mount blocks paint), WHAT (React prioritizes urgent Zustand active-set removal first), and the accepted trade-off (right pane may briefly show just-deactivated view)"
    - "startTransition is imported from react (first-use in the codebase)"
    - "Test coverage asserts the ordering contract: removeFromActiveSet fires synchronously; onDeactivateRow is called after in handleRowDeactivate"
    - "npx tsc --noEmit exits 0 (frontend-only change, no type regressions)"
    - "npx vitest run passes green (no test regressions in AppShell.persistence, PrettyConversationsPanel, conversation-store)"
  artifacts:
    - path: src/ui/AppShell.tsx
      provides: "doCloseTab with startTransition-wrapped state mutations and documenting block comment"
      contains: "startTransition"
    - path: src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
      provides: "Focused test asserting handleRowDeactivate calls removeFromActiveSet synchronously before onDeactivateRow"
      contains: "handleRowDeactivate"
  key_links:
    - from: "src/ui/AppShell.tsx doCloseTab"
      to: "react.startTransition"
      via: "wrap four state mutations in single transition callback"
      pattern: "startTransition\\(\\(\\) =>"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx handleRowDeactivate"
      to: "AppShell.doCloseTab via closeTab via onDeactivateRow"
      via: "props chain, unchanged"
      pattern: "onDeactivateRow\\(row\\)"
---

<objective>
Make deactivating an active conversation feel instant. Currently tapping Deactivate on an active conversation row in `PrettyConversationsPanel` blocks the UI for ~1s: React 18 batches the Zustand `removeFromActiveSet(row.id)` update together with the four setState calls inside `doCloseTab` (setActiveTabId + selectConversation + setPaneTabIds + setTabs) into a single commit. That commit unmounts the deactivated PrettyView AND mounts the newly-activated conversation's PrettyView (fresh WS setup, backfill dispatch, hundreds of message bubbles, ResizeObserver spin-up, aside timer probe) — the browser can't paint the list update until the whole render commits.

Fix: wrap the four state mutations in `doCloseTab` inside React 18's `startTransition`. React commits the urgent Zustand-driven list update first (list settles + paints immediately), then commits the tab switch as a transition (new pane mounts async without blocking the paint).

Purpose: eliminate the ~1s freeze on Deactivate tap. Ashley's fleet-management flow depends on list mutations feeling instant.

Output: two-file diff — `src/ui/AppShell.tsx` (add `startTransition` import + wrap state mutations + document the trade-off with a block comment) and `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (focused ordering assertion).

Trade-off (accepted by Ashley, must be documented in the code comment): for a fraction of a second between "list settled" and "new pane mounted," the right pane still shows the just-deactivated pretty view. Acceptable because Ashley isn't actually waiting on the session to be unloaded — she's waiting on the list to acknowledge her tap.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# Target implementation
@src/ui/AppShell.tsx  # doCloseTab at ~line 1144; React import at line 7

# Call-site context (do NOT modify — reference only)
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx  # handleRowDeactivate at ~line 453

# Existing test scaffolding to mirror patterns from
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx  # existing test file — extend, do not rewrite

# Prior art: startTransition is NOT currently used anywhere in src/ (confirmed via grep). This is a first-use of the built-in.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wrap doCloseTab state mutations in startTransition</name>
  <files>src/ui/AppShell.tsx</files>
  <behavior>
    - Test expectation (verified in Task 2, not this task): after Task 1's change, in `doCloseTab` the four setState calls (setActiveTabId, selectConversation, setPaneTabIds, setTabs) are inside a `startTransition(() => { ... })` callback; the synchronous prelude (tabs.find, deleteOpenTab, terminalRefs.current.delete) is outside it.
    - Type expectation: `startTransition` is imported from `react` alongside the existing named imports.
    - Documentation expectation: a 3-5 line block comment above the `startTransition` call explains WHY the transition exists (heavy PrettyView mount was blocking the list paint), WHAT the transition does (React prioritizes urgent Zustand active-set removal first), and the accepted trade-off (right pane may briefly show the just-deactivated view while list updates instantly). The comment names the risk explicitly so a future reader doesn't "fix" it back to a synchronous batch.
  </behavior>
  <action>
    Two edits to `src/ui/AppShell.tsx`:

    (1) Line 7 — extend the existing React import to include `startTransition`. Current form: `import { useState, useRef, useCallback, useEffect, useMemo, createRef } from "react";`. New form: same list with `startTransition` appended (any position within the braces is fine; keep the alphabetical/logical grouping the file already uses).

    (2) Inside `function doCloseTab(id: string)` at ~line 1144 — reshape the body so the synchronous prelude runs first (unchanged), then the four state mutations run inside a single `startTransition(() => { ... })` callback. Concretely:

    KEEP AS-IS (synchronous, must stay inside the event handler for correct closure over the render-time `tabs` / `activeTabId`):
      - `const tabToClose = tabs.find((t) => t.id === id);`
      - The `if (tabToClose?.instanceId && PERSISTENT_TAB_TYPES.includes(tabToClose.type)) { deleteOpenTab(...).catch(() => {}); }` block — fire-and-forget backend cleanup.
      - `terminalRefs.current.delete(id);` — synchronous ref cleanup.

    COMPUTE INSIDE the startTransition callback (so it uses the render-time closure values, which is what the current code already does):
      - The `if (id === activeTabId) { const remaining = ...; const nextId = ...; setActiveTabId(nextId); selectConversation(nextId === "dashboard" ? null : nextId); }` block — INCLUDING the `remaining` / `nextId` computation. Preserve the existing patch #180 comment block above `selectConversation(...)`.
      - `setPaneTabIds((prev) => prev.map((p) => (p === id ? null : p)));`
      - `setTabs((prev) => { const next = prev.filter((t) => t.id !== id); if (next.length === 0) return [ { id: "dashboard", instanceId: "dashboard", type: "dashboard", label: t("nav.conversations.title", { defaultValue: "Conversations" }), openedAt: Date.now(), } ]; return next; });`

    Wrap those three blocks in a single `startTransition(() => { ... })` (one transition, not three separate ones — React batches the three setState calls inside the single transition into one deferred commit).

    ADD ABOVE the startTransition block, a 3-5 line block comment. Suggested content (adapt to file's comment style — the file already uses `// Patch #NNN:` block comments as shown at line 1159, so match that voice):
      - Line 1: Bounty #5 (or the patch number this ships as — leave a placeholder like `Patch #TBD` since Tina assigns patch numbers at ingestion; do NOT invent a number).
      - Line 2: WHY — deactivating an active conversation used to freeze the UI for ~1s because the four setState calls below batched with the Zustand `removeFromActiveSet` from the caller into a single commit that unmounted the deactivated PrettyView AND mounted a fresh PrettyView (WS setup + backfill dispatch + hundreds of bubbles).
      - Line 3: WHAT — startTransition tells React to commit the urgent Zustand active-set removal first (list paints instantly), then commit the tab switch as a deferred transition (new pane mounts async without blocking the paint).
      - Line 4: TRADE-OFF — for a fraction of a second the right pane may still show the just-deactivated view while the list updates. Accepted: Ashley isn't waiting on the session unload, she's waiting on the list to acknowledge her tap.
      - Line 5: DO NOT revert to a synchronous batch — this is the whole point of the block.

    Everything else in `AppShell.tsx` — including `closeTab`, `splitTabQuick`, and every other function in the file — stays untouched. No other files touched in this task.

    Rationale for keeping the synchronous prelude OUTSIDE the transition: `deleteOpenTab` is a fire-and-forget backend request that should kick off immediately (deferring it inside a transition would add latency for no benefit and risk being cancelled if React batches transitions), and `terminalRefs.current.delete` is a Map mutation (not React state) that has no interaction with transitions.

    Rationale for keeping the `remaining` / `nextId` computation INSIDE the transition: `remaining` reads `tabs` (state) and `nextId` reads `activeTabId` (state). Both must use the render-time closure values at the moment the transition schedules — they already do because they're inside `doCloseTab`'s function body. Moving the computation outside changes nothing observable but also achieves nothing; keeping it inside the transition callback keeps the "list-paint-first, tab-switch-second" story tight in one block.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    - `src/ui/AppShell.tsx` line 7 imports `startTransition` from `react` alongside the existing named imports.
    - `doCloseTab` body: synchronous prelude (tabs.find, deleteOpenTab, terminalRefs.current.delete) is BEFORE the transition; the four state mutations (setActiveTabId, selectConversation, setPaneTabIds, setTabs) are INSIDE a single `startTransition(() => { ... })` callback.
    - A 3-5 line block comment above the `startTransition(...)` call documents WHY, WHAT, and the accepted trade-off, and warns against reverting to a synchronous batch.
    - `npx tsc --noEmit` exits 0.
    - No other file changed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add ordering-contract test in PrettyConversationsPanel.test.tsx</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    - Given a `PrettyConversationsPanel` rendered with an active row, when `handleRowDeactivate` fires (simulated by tapping the Deactivate affordance on the row, or by extracting the handler and calling it directly — whichever matches the existing test file's patterns), then:
      - `removeFromActiveSet` is called synchronously with the row's id.
      - `onDeactivateRow` is called with the row after `removeFromActiveSet`.
      - If the row has both `host` and `targetTmuxSession`, `removeFromActiveSet` is called a second time with the `fleetRowId(...)` variant (preserves the existing patch #149 followup-1 guard behavior).
    - The test verifies the CALLER-side ordering contract that makes the transition work end-to-end. The transition itself (React internals) is not directly asserted — that's a React 18 built-in whose behavior we trust. What we DO assert is that the caller fires the urgent Zustand update FIRST and the deferred handler SECOND, in that exact order. If a future refactor swaps the order, this test fails loudly.
    - The test is small: one `it(...)` block, ideally &lt;30 lines, extending the existing test file's `describe(...)` structure. No new mocking scaffolding beyond what the file already provides.
  </behavior>
  <action>
    Open `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (1866 lines; existing scaffolding already mounts the panel with mocked stores) and add ONE focused `it(...)` block inside the most relevant existing `describe(...)` group (likely one that already covers the row-actions surface — read the file's top-level structure first and pick the group that already exercises `onDeactivateRow` or row actions; if none exists, add a new `describe("handleRowDeactivate ordering contract", ...)` block at the bottom).

    The test should:
      1. Mock `removeFromActiveSet` (from the Zustand store — use the same mocking pattern the file already uses for other Zustand actions; if the file uses `vi.mock("../../state/conversation-store")` or a partial mock via `useConversationStore.setState`, mirror that).
      2. Mock `onDeactivateRow` as a `vi.fn()` prop.
      3. Render `PrettyConversationsPanel` with an active row (an entry in the mocked store's `activeSet` matching the row's id — use the same fixture-row shape the file already constructs for other tests).
      4. Trigger the deactivate path. Two acceptable ways:
         - (A) User-event: find the row's Deactivate button/affordance and fire click. This is the higher-fidelity path — use it if the existing tests already interact with row-level buttons via `getByRole` / `getByTestId`. Look for existing patterns before writing custom queries.
         - (B) Direct handler invocation: if the file already extracts the handler for isolated testing (grep for `handleRowDeactivate` in the test file), reuse that mechanism.
      5. Assert:
         - `expect(removeFromActiveSet).toHaveBeenNthCalledWith(1, row.id)` — first call with the row's id.
         - If the fixture row has `host` and `targetTmuxSession`: `expect(removeFromActiveSet).toHaveBeenNthCalledWith(2, fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession))` — second call with the fleet id variant.
         - `expect(onDeactivateRow).toHaveBeenCalledWith(row)` — deactivate handler received the row.
         - `expect(onDeactivateRow).toHaveBeenCalledAfter(removeFromActiveSet)` — ordering. If jest-extended's `toHaveBeenCalledAfter` isn't in the project's test toolkit (check the existing file for prior use), fall back to comparing `mock.invocationCallOrder`: `expect(removeFromActiveSet.mock.invocationCallOrder[0]).toBeLessThan(onDeactivateRow.mock.invocationCallOrder[0])`.

    A short 2-3 line comment above the `it(...)` block should note: "Ordering contract for bounty #5 (deactivate-conversation-instant). The urgent Zustand `removeFromActiveSet` MUST fire before `onDeactivateRow` so React commits the list update in a separate render pass from the deferred `startTransition`-wrapped tab switch inside `AppShell.doCloseTab`. Reordering these calls would collapse the two commits back into one and re-introduce the ~1s freeze."

    Do NOT modify any existing test in the file — extend only.

    Fallback (rare): if the existing test file's scaffolding turns out to be genuinely incompatible with mocking `removeFromActiveSet` (e.g. the store is instantiated in a way that resists override), fall back to writing the test at the `AppShell.persistence.test.tsx` scaffold pattern — extract `handleRowDeactivate`-analog into a minimal 20-line scaffold and test THAT. In that case, add the test to `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` as a scaffold-based test (still colocated with the code it defends). Do NOT create a new test file for this — extending an existing colocated file is the target.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/ui/state/conversation-store.test.ts src/ui/AppShell.persistence.test.tsx</automated>
  </verify>
  <done>
    - New `it(...)` block exists in `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`, asserting `removeFromActiveSet` fires before `onDeactivateRow` in `handleRowDeactivate`.
    - The new test passes.
    - Existing tests in that file, in `conversation-store.test.ts`, and in `AppShell.persistence.test.tsx` all still pass (no regressions).
    - A 2-3 line comment above the new `it(...)` block explains WHY the ordering contract matters (references the startTransition split in `AppShell.doCloseTab`).
    - No new test file created; no new mocking scaffolding beyond the file's existing patterns.
  </done>
</task>

</tasks>

<verification>
Frontend-only patch. Backend files untouched (grep for `src/backend` / `src/api` in the diff should return zero hits). Verification per patch #154 policy: `npx tsc --noEmit` + colocated vitest, NO `npm run build:backend`.

Commands (run in order, all from `/home/ubuntu/skynet`):

1. `npx tsc --noEmit` — MUST exit 0. Catches any type regression from the new `startTransition` import.
2. `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — new ordering-contract test passes, no regressions in the existing 1866-line suite.
3. `npx vitest run src/ui/AppShell.persistence.test.tsx` — Phase 6 Plan 06-02's persistence-contract smoke test still green (proves the tabNodesRef DOM-move mechanism wasn't disturbed by the doCloseTab reshape).
4. `npx vitest run src/ui/state/conversation-store.test.ts` — Zustand store contract still green (proves nothing about `removeFromActiveSet` semantics changed).
5. `npx vitest run` — full frontend vitest suite green (final backstop).

NOT run:
- `npm run build:backend` — patch touches zero backend files (per patch #154 policy).
- `npm run build` — no bundler check required; TypeScript check + vitest are the contract.
- Manual browser test — Tina fast-paths deploy validation after ingestion (per task_context constraints).
- Any push / build / deploy — stop at commit boundary per fleet rule (Ashley 2026-07-27).
</verification>

<success_criteria>
- [ ] `src/ui/AppShell.tsx` diff: React import extended with `startTransition`; `doCloseTab` reshaped with synchronous prelude before the transition and four state mutations inside a single `startTransition(() => { ... })`; 3-5 line block comment above the transition documents WHY / WHAT / trade-off.
- [ ] `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` diff: one new `it(...)` block asserts `removeFromActiveSet` fires before `onDeactivateRow`; 2-3 line comment references bounty #5 ordering contract.
- [ ] `npx tsc --noEmit` exit 0.
- [ ] `npx vitest run` on the four target files (see verification) all green, no regressions.
- [ ] Exactly 2 files modified (AppShell.tsx + PrettyConversationsPanel.test.tsx). No other files touched. No identity-side files (~/.claude/identities/tina/**, skynet-patches.md, tina.md, bounties) touched — Tina handles all identity-side bookkeeping post-executor.
- [ ] No push, no build (`npm run build`), no `npm run build:backend`, no deploy. Stop at commit boundary.
- [ ] Atomic commit on the current working branch (do NOT create a new branch; use whatever branch the working tree is on when the executor starts). Commit message references bounty #5 and the startTransition mechanism.
</success_criteria>

<output>
Create `.planning/quick/260730-jes-make-deactivating-an-active-conversation/260730-jes-SUMMARY.md` when done, following the standard SUMMARY.md template. Include:
- Files touched (exact paths, line ranges).
- Diff size (lines added / removed per file).
- Verification output (tsc exit code, vitest pass counts).
- Any deviations from this plan (e.g. if fallback test path was taken).
- Commit SHA.
- Explicit note: "NO push, NO build, NO deploy per quick-task constraints. Tina bundles this with the pinned-slate batch when Ashley greenlights ship."
</output>
