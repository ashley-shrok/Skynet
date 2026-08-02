---
phase: quick-260802-tzx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/shell/tabUtils.tsx
  - src/ui/AppShell.tsx
autonomous: true
requirements:
  - bounty:url-restore-loads-only-selected-session-not-full-active-set
must_haves:
  truths:
    - "URL-restore of an active-set (e.g. {A,B,C,D} with selected=B) opens WebSockets for ALL 4 tabs, not just B"
    - "Each URL-restored ambient tab publishes isWorking into session-working-store so its PrettyConversationRow ready-dot reflects real connection state"
    - "Existing behavior preserved: WS stays alive after user switches away from a tab (no teardown on !isVisible)"
    - "Existing behavior preserved: fit / performFit / autocomplete pointer-events / resize-observer / isVisibleRef mirror still gate on isVisible (pane-visibility semantics unchanged)"
    - "`npx tsc --noEmit` passes and `npm test` passes"
  artifacts:
    - path: "src/ui/features/terminal/Terminal.tsx"
      provides: "SSHTerminalProps.attach prop; WS-open effect gated on attach instead of isVisible"
      contains: "attach: boolean"
    - path: "src/ui/shell/tabUtils.tsx"
      provides: "TerminalTabContent.attach prop; renderTabContent shouldAttach param"
      contains: "attach: boolean"
    - path: "src/ui/AppShell.tsx"
      provides: "shouldAttach = inPane || activeInline || isInActiveSet passed to renderTabContent"
      contains: "isInActiveSet"
  key_links:
    - from: "src/ui/AppShell.tsx tabs.map render loop"
      to: "renderTabContent shouldAttach arg -> TerminalTabContent attach prop -> Terminal attach prop"
      via: "prop drilling"
      pattern: "shouldAttach"
    - from: "src/ui/AppShell.tsx"
      to: "src/ui/state/conversation-store.ts useActiveSet"
      via: "hook import"
      pattern: "useActiveSet"
---

<objective>
Decouple Skynet Terminal's WebSocket lifecycle from pane visibility by adding a new `attach: boolean` prop. Currently `isVisible` double-duties as (a) "should this pane render / fit / respond to input" AND (b) "should this pane open its WebSocket". Patch #230 enrolls URL-restored ambient tabs into activeSet so they get the glow, but their WS never opens because they aren't `effectiveSelectedTabId`. Split the concerns: keep `isVisible` for pane visibility, introduce `attach` for WS lifecycle. In AppShell, compute `shouldAttach = inPane || activeInline || isInActiveSet` and pass it through renderTabContent -> TerminalTabContent -> Terminal.

Purpose: Fix bounty `url-restore-loads-only-selected-session-not-full-active-set`. Ashley's dot-semantics lock (ready-dot must mean "idle AND connected") is being violated because ambient URL-restored tabs light up their dot without an underlying WS.

Output: Single atomic commit `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)` on branch `feat/tab-title-from-tmux`. No push, no rebuild, no docker.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Target files (already loaded in planning context, cited in tasks by line number)
@src/ui/features/terminal/Terminal.tsx
@src/ui/shell/tabUtils.tsx
@src/ui/AppShell.tsx

# activeSet hook source — used by Task 3
@src/ui/state/conversation-store.ts
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add `attach` prop to Terminal.tsx and switch WS-open gate from isVisible to attach</name>
  <files>src/ui/features/terminal/Terminal.tsx</files>
  <behavior>
    - `SSHTerminalProps` exposes new `attach: boolean` field (sibling of `isVisible`).
    - WS-open effect (currently L2813-2844) opens the socket when `attach === true`, regardless of `isVisible`.
    - WS-open effect does NOT open the socket when `attach === false`, regardless of `isVisible`.
    - All other `isVisible` usages remain untouched: L562-563 isVisibleRef mirror, L603 performFit gate, L2430 resize-observer skip, L2846-2865 fit-on-visible effect, L2940 autocomplete pointer-events. Those stay gated on pane visibility.
    - No WS-teardown-on-!attach is introduced. Once opened, WS lives until unmount / SSH-close / user-close (same as today for the selected tab when user switches away).
  </behavior>
  <action>
    1. In `SSHTerminalProps` (interface starts L80), add `attach: boolean;` on a new line immediately after `isVisible: boolean;` (L82). Keep the interface alphabetization/order intent of "visibility-adjacent props are grouped."
    2. In the `TerminalInner` destructure (L109-124), add `attach,` on a new line immediately after `isVisible,` (L111). Do not add a default — it's a required prop; TypeScript will surface any caller that misses it, which is what we want for Task 2/3 wiring.
    3. Change L2814 from `if (!terminal || !hostConfig || !isVisible) return;` to `if (!terminal || !hostConfig || !attach) return;`.
    4. Change the deps array at L2844 from `[terminal, hostConfig.id, isVisible, isConnected, isConnecting]` to `[terminal, hostConfig.id, attach, isConnected, isConnecting]`.
    5. Do NOT touch any other `isVisible` reference in this file. Grep-verify by running `grep -n isVisible src/ui/features/terminal/Terminal.tsx` before and after — count of matches should decrease by exactly 2 (the L2814 predicate + the L2844 dep). If the diff shows any other line change involving `isVisible`, revert that hunk.
    6. Add a one-line comment above the modified L2814 predicate explaining the split, e.g. `// attach (not isVisible) gates WS lifecycle: URL-restored active-set tabs must open their WS even while offscreen. See bounty url-restore-loads-only-selected-session-not-full-active-set.`
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/tsc-task1.log; grep -c "Terminal.tsx" /tmp/tsc-task1.log</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` reports errors in `tabUtils.tsx` and `AppShell.tsx` (they don't yet pass `attach`) — this is EXPECTED after Task 1 in isolation.
    - `npx tsc --noEmit` reports NO errors originating inside `Terminal.tsx` itself.
    - `grep -c "isVisible" src/ui/features/terminal/Terminal.tsx` returns exactly 2 fewer matches than before the edit.
    - `grep -n "attach" src/ui/features/terminal/Terminal.tsx` shows: interface declaration, destructure, WS-effect predicate, WS-effect deps array, and the one explanatory comment. No other matches.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Thread `attach` through tabUtils.tsx (TerminalTabContent + renderTabContent)</name>
  <files>src/ui/shell/tabUtils.tsx</files>
  <behavior>
    - `TerminalTabContent` accepts a new required `attach: boolean` prop and forwards it to `<TerminalFeature>` alongside `isVisible`.
    - `renderTabContent` accepts a new `shouldAttach: boolean = false` positional parameter, inserted immediately after `isVisible` (currently L152), and passes it to `<TerminalTabContent attach={shouldAttach} .../>`.
    - Default `shouldAttach = false` is safe: any caller that hasn't been updated yet will produce dormant (non-attaching) Terminals, preserving the pre-patch "only selected tab connects" behavior for that caller. AppShell (Task 3) is the only real caller and will be updated in the same commit.
    - RDP/VNC/Telnet/dashboard branches in the switch statement are unaffected — they have independent connection lifecycles and don't need the arg.
  </behavior>
  <action>
    1. In the `TerminalTabContent` props destructure (L91-97) add `attach,` on a new line immediately after `isVisible,`.
    2. In the `TerminalTabContent` props type object (L98-106) add `attach: boolean;` on a new line immediately after `isVisible: boolean;`.
    3. In the JSX at L110-133, add `attach={attach}` on a new line immediately after `isVisible={isVisible}` (L123). Preserve existing prop order.
    4. In the `renderTabContent` signature (L138-155), add a new parameter `shouldAttach: boolean = false,` immediately after `isVisible = true,` (currently L152). Keep the default so future callers stay compile-safe.
    5. In the `terminal` case (L176-190) update the `<TerminalTabContent .../>` element to pass `attach={shouldAttach}` on a new line immediately after `isVisible={isVisible}` (L181).
    6. Leave the RDP/VNC/Telnet and dashboard branches alone — they do not receive or forward `shouldAttach`.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/tsc-task2.log; grep -cE "(tabUtils|Terminal)\.tsx" /tmp/tsc-task2.log</automated>
  </verify>
  <done>
    - After Task 2, remaining `tsc` errors are confined to `AppShell.tsx` (the sole caller of `renderTabContent` that hasn't yet been updated). Zero errors inside `tabUtils.tsx` or `Terminal.tsx`.
    - `grep -n "attach" src/ui/shell/tabUtils.tsx` shows: destructure, type field, JSX forward inside `TerminalTabContent`, param in `renderTabContent` signature, JSX forward inside the terminal case — five occurrences, all in the terminal path.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: AppShell render loop — compute shouldAttach = inPane || activeInline || isInActiveSet and pass to renderTabContent</name>
  <files>src/ui/AppShell.tsx</files>
  <behavior>
    - `AppShell` reads `activeSet` from `useActiveSet()` (already exported from `src/ui/state/conversation-store.ts` L1047, returns `ReadonlySet<string>` keyed by conversation/tab id).
    - Inside the tabs.map at L1773-1801, for each tab, compute `const isInActiveSet = activeSet.has(tab.id);` and `const shouldAttach = inPane || activeInline || isInActiveSet;`.
    - `renderTabContent(...)` at L1786-1797 receives `shouldAttach` as the new 5th arg (immediately after `inPane || activeInline` which remains as `isVisible`).
    - Net effect: URL-restored active-set of {A,B,C,D} with selected=B — B has `activeInline=true`, all four have `isInActiveSet=true`, so all four get `shouldAttach=true` and all four open their WS. User-deactivation via `removeFromActiveSet` flips `shouldAttach` to false, but existing WS lives until tab close (no teardown-on-!attach — matches Task 1 design).
  </behavior>
  <action>
    1. Add `useActiveSet` to the import from `./state/conversation-store` (or wherever the existing conversation-store imports live in this file). Grep first: `grep -n "conversation-store\|useActive\|useConversationStore" src/ui/AppShell.tsx | head -20`. Add `useActiveSet` alongside existing imports from the same module — do NOT create a duplicate import line.
    2. Inside the `AppShell` component body, at a location adjacent to other zustand hook reads (grep for an existing `useConversationStore(` or `useActiveSet(`-adjacent call), add: `const activeSet = useActiveSet();`. Placement rule: it must be inside the component body but outside the tabs.map callback (so React doesn't warn about conditional hook order).
    3. Inside the `tabs.map((tab) => { ... })` at L1773, immediately after `const activeInline = !inPane && tab.id === effectiveSelectedTabId;` (L1784), add two lines:
       ```
       const isInActiveSet = activeSet.has(tab.id);
       const shouldAttach = inPane || activeInline || isInActiveSet;
       ```
       Add these as plain `const` declarations (no comment block needed; the naming is self-descriptive).
    4. Update the `renderTabContent(...)` call at L1786-1797. Currently the 5th arg is `inPane || activeInline` (L1794). Keep that unchanged as `isVisible`, and add `shouldAttach,` as a new 6th arg immediately after it. The resulting arg order matches the updated `renderTabContent` signature from Task 2: `(tab, undefined, openTab, closeTab, inPane || activeInline, shouldAttach, handleTmuxSessionChange, handleTmuxSessionMissing)`.
    5. Do NOT modify the pane-splitting logic, portal mounting, or any other line in this render loop. The change is strictly additive.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/tsc-task3.log &amp;&amp; grep -v '^#' /tmp/tsc-task3.log | grep -cE "error TS"</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` passes with zero errors (grep count returns 0).
    - `grep -n "shouldAttach\|isInActiveSet" src/ui/AppShell.tsx` shows exactly the three additions inside the tabs.map plus the one `renderTabContent` arg reference — four matches total, all inside the tabs.map render loop.
    - `grep -n "useActiveSet" src/ui/AppShell.tsx` shows exactly two matches: one in the import statement, one in the component-body hook call.
    - Existing behavior spot-check: the deps of the effect that computes `effectiveSelectedTabId` and the split-pane arrangement are untouched — `git diff src/ui/AppShell.tsx | grep -c '^-' | ` shows minimal deletions (the only `-` line should be the old 5-arg `renderTabContent(...)` invocation if the whole call is rewritten; if you added the arg surgically, deletions may be zero).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Test coverage — update existing "!isVisible blocks WS" assertions and add multi-tab URL-restore attach assertion</name>
  <files>src/ui/features/terminal/Terminal.test.tsx, src/ui/AppShell.test.tsx</files>
  <behavior>
    - Any existing test in `Terminal.test.tsx` that asserts "WS does not open when `isVisible=false`" is refactored to assert the same about `attach=false`, and a NEW case is added: `isVisible=false + attach=true` → WS opens (this was blocked before and is the whole point of the change).
    - A NEW `AppShell.test.tsx` case: given a URL-restore scenario with a multi-tab hash producing an activeSet of size >1, assert that `renderTabContent` (or the underlying `TerminalTabContent` mock) receives `shouldAttach=true` for every tab in the activeSet, not just the selected one.
    - If either test file does not exist, or its structure makes these assertions require inventing significant scaffolding (custom render harnesses, new mocks of stores, etc.), STOP: do not fabricate scaffolding. Instead record the gap in a `TESTING-GAP` note appended to the commit message body, per the full_task_context guidance ("prefer noting the gap in commit message over inventing brittle test scaffolding").
  </behavior>
  <action>
    1. Check for existence: `ls src/ui/features/terminal/Terminal.test.tsx src/ui/AppShell.test.tsx 2>&amp;1`.
    2. For `Terminal.test.tsx` (if it exists):
       a. `grep -n "isVisible" src/ui/features/terminal/Terminal.test.tsx` to find existing coverage.
       b. For each test that renders `<Terminal ... isVisible={false} />` and asserts "no WS opened" (look for `webSocketRef`, `WebSocket` constructor spies, or connection-mock assertions), update the render prop set to also pass `attach={false}` and rewrite the assertion's narrative around `attach`.
       c. Add ONE new `it("opens WS when attach=true even if isVisible=false", ...)` case that renders `<Terminal ... isVisible={false} attach={true} />` and asserts the WS-open path was taken (mirror whatever WS-open assertion pattern the existing tests use).
       d. Every existing test that renders `<Terminal>` needs to pass `attach` now (required prop from Task 1). Grep for `<Terminal` and audit each call site. Simplest safe rewrite for pre-existing "positive" tests: pass `attach={true}` alongside `isVisible={true}` — preserves existing behavior.
    3. For `AppShell.test.tsx` (if it exists):
       a. `grep -n "activeSet\|useActiveSet\|renderTabContent" src/ui/AppShell.test.tsx` to see what's already mocked.
       b. Add ONE new test case simulating URL-restore with hash `{A,B,C,D}` and selected=B. Depending on existing patterns: either spy on `renderTabContent` (import + mock), or mock `TerminalTabContent` to a component that records its `attach` prop into a Map keyed by tab id. Assert all four tab ids show up with `attach=true`.
    4. If either file does not exist, or existing tests do not already mock the WS constructor / renderTabContent in a way that this new assertion can piggyback on, STOP the test-authoring: create a short note starting `TESTING-GAP:` describing which assertion(s) could not be added and why (one paragraph, ~3 sentences). Save this note to `/tmp/testing-gap.txt` for inclusion in the commit-message body in Task 5.
    5. Do NOT create new test files from scratch. Do NOT introduce new test harnesses, new mocking utilities, or dependency changes. This task is a surgical audit of existing tests, not a testing epic.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; npm test 2>&amp;1 | tail -50 | tee /tmp/npm-test.log; grep -cE "(FAIL|failing|failed)" /tmp/npm-test.log</automated>
  </verify>
  <done>
    - `npm test` exits 0 (no failing tests). Grep-count of `FAIL|failing|failed` is 0, OR any matches are inside neutral output (e.g. "0 failing").
    - Either: (a) new WS-attach assertions exist and pass, and every pre-existing `<Terminal>` render call now passes `attach`, OR (b) `/tmp/testing-gap.txt` exists with a short TESTING-GAP note (to be pasted into commit body in Task 5).
    - `git diff --stat src/ui/features/terminal/Terminal.test.tsx src/ui/AppShell.test.tsx` shows either surgical edits (few dozen line changes at most) OR zero changes if both test files declined the surgical audit and dropped a TESTING-GAP note instead.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Verify locally and produce a single atomic commit (no push, no build, no docker)</name>
  <files>(git state only — no source edits)</files>
  <behavior>
    - Working tree is on branch `feat/tab-title-from-tmux`.
    - `npx tsc --noEmit` passes with zero errors.
    - `npm test` exits 0.
    - A single atomic commit is created with subject `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)` and a body describing: (a) the bounty being closed, (b) the design (split `isVisible` visibility semantics from new `attach` WS-lifecycle semantics), (c) the AppShell wiring (`shouldAttach = inPane || activeInline || isInActiveSet`), (d) an explicit "no WS teardown on !attach — matches today's behavior when switching away from the selected tab", and (e) if `/tmp/testing-gap.txt` exists, its contents appended as a `TESTING-GAP:` trailer paragraph.
    - Commit touches only the 3 source files from Tasks 1–3 plus any test files updated in Task 4. Nothing else.
    - No `git push`. No `docker build`. No `docker compose up`. No `git worktree` usage.
    - The bounty JSON dir and `~/.claude/identities/tina/skynet-patches.md` are NOT touched (Tina handles them post-commit).
  </behavior>
  <action>
    1. `cd ~/skynet &amp;&amp; git status` — confirm branch is `feat/tab-title-from-tmux` and the only modified paths are the three source files (plus optionally the two test files). If any other file is dirty, `git diff` it and stop for review — do not stage foreign changes.
    2. `cd ~/skynet &amp;&amp; npx tsc --noEmit` — must exit 0. If not, fix locally before proceeding.
    3. `cd ~/skynet &amp;&amp; npm test` — must exit 0. If not, fix locally before proceeding.
    4. Stage explicitly by path: `git add src/ui/features/terminal/Terminal.tsx src/ui/shell/tabUtils.tsx src/ui/AppShell.tsx`; also add test files IF they were modified in Task 4 (`git add src/ui/features/terminal/Terminal.test.tsx src/ui/AppShell.test.tsx` — no-op if unchanged). Do NOT use `git add -A` or `git add .`.
    5. Build the commit message via HEREDOC. Include the TESTING-GAP trailer paragraph verbatim from `/tmp/testing-gap.txt` if that file exists; otherwise omit that trailer. Do NOT include a Claude co-author trailer (Ashley's fleet convention — solo commits on this repo).
    6. `git commit -m "$(cat &lt;&lt;'EOF'
feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)

Closes bounty url-restore-loads-only-selected-session-not-full-active-set.

Patch #230 enrolled URL-restored ambient tabs into activeSet so they render
with the "active-set" chrome (glow), but their WebSocket never opened
because the WS-open effect in Terminal.tsx was gated on isVisible, which
only becomes true for the currently-selected tab (effectiveSelectedTabId).
Result: ambient rows lit up the ready-dot in PrettyConversationRow while
having no live connection — violating Ashley's lock that the dot means
"idle AND connected."

Split isVisible into two orthogonal props:
  - isVisible (unchanged semantics): pane visibility — drives fit,
    performFit, resize-observer, autocomplete pointer-events, isVisibleRef.
  - attach (new): WS lifecycle — the WS-open effect is now gated on this.

AppShell computes shouldAttach = inPane || activeInline || isInActiveSet
and threads it through renderTabContent -> TerminalTabContent -> Terminal.
URL-restored active-set tabs now all open their WSes; ready-dot honest.

No WS-teardown-on-!attach: matches today's behavior when the user switches
away from the selected tab (WS lives until tab close / SSH close / unmount).
Not a regression.
EOF
)"` — then, if `/tmp/testing-gap.txt` exists, use `git commit --amend --no-edit` after appending its contents via a subsequent `git commit --amend -m` with the extended body. Simpler: build the full message (with TESTING-GAP paragraph appended if present) in one shell expression before invoking `git commit -m`.
    7. `cd ~/skynet &amp;&amp; git log -1 --stat` — verify: one new commit, subject matches, touched files match, no foreign files.
    8. Do NOT `git push`. Do NOT run any docker command. Do NOT touch the bounty JSON dir under `~/.claude/identities/tina/bounties/`.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; git log -1 --format="%s" | grep -qE "^feat\(pretty-view\): decouple Terminal WS lifecycle from pane visibility \(attach prop\)$" &amp;&amp; git log -1 --stat | tail -20</automated>
  </verify>
  <done>
    - `git log -1 --format="%s"` prints exactly `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)`.
    - `git log -1 --stat` shows: 3 source files changed (Terminal.tsx, tabUtils.tsx, AppShell.tsx), plus 0 or 2 test files, and nothing else.
    - `git status` reports a clean working tree.
    - `git branch --show-current` reports `feat/tab-title-from-tmux`.
    - No `git push` was executed. No docker commands were executed. `~/.claude/identities/tina/skynet-patches.md` and `~/.claude/identities/tina/bounties/url-restore-loads-only-selected-session-not-full-active-set/` are unmodified.
  </done>
</task>

</tasks>

<verification>
Phase-level checks after all tasks complete:

1. Type check: `cd ~/skynet && npx tsc --noEmit` exits 0.
2. Test suite: `cd ~/skynet && npm test` exits 0.
3. Grep-based structural check on the change:
   - `grep -n "attach" src/ui/features/terminal/Terminal.tsx` — 5 lines (interface, destructure, WS-effect predicate, WS-effect deps, one comment).
   - `grep -n "attach" src/ui/shell/tabUtils.tsx` — 5 lines (destructure, type, JSX in TerminalTabContent, param in renderTabContent, JSX in terminal-case forward).
   - `grep -n "shouldAttach\|isInActiveSet\|useActiveSet" src/ui/AppShell.tsx` — matches inside the tabs.map plus the hook import + call.
4. Behavior spot-check (manual, optional — not required for done):
   - Load Skynet in a browser with a URL-restore hash of 3+ tabs.
   - Verify PrettyConversationRow ready-dots for the non-selected active-set tabs light up ONLY once the underlying WS reports isWorking (i.e. reflect real state, not a phantom).
5. Git hygiene: single atomic commit on `feat/tab-title-from-tmux`, no push.
</verification>

<success_criteria>
- WebSocket-open gate in `Terminal.tsx` L2814 depends on `attach`, not `isVisible`.
- All 5 pane-visibility uses of `isVisible` in `Terminal.tsx` (L562-563 ref, L603 performFit, L2430 resize-observer, L2846-2865 fit-on-visible, L2940 pointer-events) are UNCHANGED.
- `tabUtils.tsx` `TerminalTabContent` and `renderTabContent` both accept and forward the new prop; RDP/VNC/Telnet/dashboard branches unchanged.
- `AppShell.tsx` computes `shouldAttach = inPane || activeInline || isInActiveSet` with `activeSet` sourced from `useActiveSet()` and passes it as the new positional arg to `renderTabContent`.
- URL-restored active-set of N tabs opens N WebSockets and publishes N `isWorking` signals to `session-working-store`.
- `npx tsc --noEmit` and `npm test` both pass.
- Single atomic commit `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)` on `feat/tab-title-from-tmux`. No push, no docker, no worktree, no touching Tina's bounty/patches files.
</success_criteria>

<output>
Create `.planning/quick/260802-tzx-url-restore-attach-prop-decouple-ws-life/260802-tzx-SUMMARY.md` when done, listing the commit SHA and confirming the 5 done-criteria above.
</output>
