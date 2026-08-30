---
phase: quick-260724-aiu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/AppShell.tsx
autonomous: true
requirements:
  - PATCH-145
must_haves:
  truths:
    - "A browser tab pre-loaded pointing at a session (URL-restore path, e.g. href '#tab=tmux:thenasty:yolanda') shows that session as glowing in the sidebar without any click"
    - "A browser tab restored from persisted-tab-storage lights up the first restored tab in the sidebar without any click"
    - "state.selectedId in conversation-store is non-null at mount for both URL-restore and persisted-tab-restore paths"
    - "sessionStorage['pv-conv-active-set'] contains the URL-targeted / persisted-first tab id after mount"
    - "The patch #144 useEffect in PrettyConversationsPanel.tsx:162-164 (if (selectedId) addToActiveSet(selectedId)) fires on mount because selectedId is non-null"
    - "Zero visual regression on the sidebar click paths (AppShell.tsx:1295, 1309, 1317) — they already call both setActiveTabId and selectConversationDeferred and are untouched by this patch"
  artifacts:
    - path: "src/ui/AppShell.tsx"
      provides: "selectConversationDeferred calls in both mount-time restore paths, symmetric with the sidebar click handlers"
      contains: "selectConversationDeferred(restoredTabs[0].id)"
    - path: "src/ui/AppShell.tsx"
      provides: "selectConversationDeferred call in URL-driven initial open path"
      contains: "selectConversationDeferred(openedIds[idx])"
  key_links:
    - from: "src/ui/AppShell.tsx (persisted-tab-restore, ~line 832)"
      to: "src/ui/state/conversation-store.ts::selectConversationDeferred"
      via: "direct call after setActiveTabId(restoredTabs[0].id)"
      pattern: "setActiveTabId\\(restoredTabs\\[0\\]\\.id\\);\\s*\\n\\s*selectConversationDeferred\\(restoredTabs\\[0\\]\\.id\\)"
    - from: "src/ui/AppShell.tsx (URL-driven initial open, ~line 900)"
      to: "src/ui/state/conversation-store.ts::selectConversationDeferred"
      via: "direct call after setActiveTabId(openedIds[idx])"
      pattern: "setActiveTabId\\(openedIds\\[idx\\]\\);\\s*\\n\\s*selectConversationDeferred\\(openedIds\\[idx\\]\\)"
    - from: "src/ui/state/conversation-store.ts::selectConversationDeferred"
      to: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (patch #144 useEffect at :162-164)"
      via: "flush emit inside updateOpenTabs → state.selectedId set → useEffect on [selectedId] fires → addToActiveSet(selectedId)"
      pattern: "if \\(selectedId\\) addToActiveSet\\(selectedId\\)"
---

<objective>
Patch #145: fix active-glow on URL-restore and persisted-tab-restore paths.

Ashley UAT'd patch #144 on 2026-07-24 and reported that a browser tab pre-loaded pointing at a session (URL-restore path) does NOT show that session as glowing in the sidebar. Tina's V2 DevTools diag on Ashley's tab (href `#tab=tmux:thenasty:yolanda`) confirmed: `sessionStorage["pv-conv-active-set"]` is EMPTY, 0 `.pv-row` elements have `.active-set` class, and `state.selectedId` stays null despite the URL clearly targeting a specific tab. Only clicking on the row makes it glow.

Root cause: `AppShell.tsx:900` (URL-driven initial open) and `:832` (persisted-tab-restore) both call `setActiveTabId(id)` — local AppShell state — but neither calls `selectConversationDeferred(id)` on the conversation store. The sidebar click handlers at `AppShell.tsx:1295, 1309, 1317` correctly call both. With `state.selectedId` null, the patch #144 useEffect `if (selectedId) addToActiveSet(selectedId)` in `PrettyConversationsPanel.tsx:162-164` skips → activeSet stays empty → no glow.

The fix is symmetric with the click handlers: add ONE line of `selectConversationDeferred(id)` after each `setActiveTabId(id)` call at those two mount-time restore paths.

Purpose: Restore active-glow visual signal on the two mount-time selection paths so URL-restore and persisted-tab-restore have the same UX affordance as click-driven selection. This is the last remaining #144 UAT gap for the active-glow signal.
Output: 2-line diff in exactly ONE file (`src/ui/AppShell.tsx`), no new imports, no new tests, symmetric with existing click-handler pattern.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/AppShell.tsx
@src/ui/state/conversation-store.ts
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add selectConversationDeferred symmetric calls to both mount-time restore paths in AppShell.tsx</name>
  <files>src/ui/AppShell.tsx</files>
  <action>
Make two surgical 1-line insertions in src/ui/AppShell.tsx, symmetric with the sidebar click handlers at lines 1295/1309/1317 which all call `selectConversationDeferred(newTabId)` immediately after `openTab(...)`.

Insertion #1 — persisted-tab-restore path (currently line 832):
Locate the block:
```
setActiveTabId(restoredTabs[0].id);
```
Add IMMEDIATELY after (same indentation, new line):
```
selectConversationDeferred(restoredTabs[0].id);
```

Insertion #2 — URL-driven initial open path (currently line 900):
Locate the block:
```
setActiveTabId(openedIds[idx]);
```
Add IMMEDIATELY after (same indentation, new line):
```
selectConversationDeferred(openedIds[idx]);
```

Do NOT add any new imports — `selectConversationDeferred` is already imported at line 59 alongside the other conversation-store exports.

Do NOT touch the sidebar click handlers at lines 1295/1309/1317 — they already do the right thing and are the pattern being mirrored.

Do NOT touch any tests — no new tests are needed. Justification (record in commit body): the bug lived outside test coverage entirely (URL routing + persisted-tab restore paths); the fix is a symmetric 2-line change matching an existing tested pattern (click handlers); adding a new test file for this would double the size of the change, require simulating window.location.hash / IndexedDB persistence in the AppShell test harness (neither currently mocked), and blur the surgical intent. If a future patch chooses to add coverage here it belongs in a dedicated AppShell mount-restore test suite, not bolted onto this fix.

Do NOT include any deploy step. Deploy will be recommended after patch #146 (log-forwarder prototype) also lands (batched-deploy rule per Ashley 2026-07-23). Patch # in commit message is 145.

Do NOT write to `~/.claude/identities/tina/skynet-patches.md` — write-up is deferred per the batching rule (Ashley 2026-07-23) and will be written up alongside #146 at deploy-recommendation time.

Commit message (single atomic commit on `feat/tab-title-from-tmux`, NO Co-Authored-By trailer per fork convention):
```
patch #145: fix active-glow on URL-restore and persisted-tab-restore

Ashley UAT of #144 caught that URL-preloaded tabs (href
'#tab=tmux:thenasty:yolanda') and persisted-tab-restored tabs did
NOT light up in the sidebar. Tina's V2 DevTools diag confirmed
sessionStorage['pv-conv-active-set'] empty and 0 rows with
.active-set class on Ashley's tab.

Root cause: AppShell.tsx:832 (persisted-tab-restore) and :900
(URL-driven initial open) called setActiveTabId(id) — local AppShell
state — but not selectConversationDeferred(id) on the conversation
store. Sidebar click handlers at :1295, :1309, :1317 correctly call
both. With state.selectedId null, the patch #144 useEffect
'if (selectedId) addToActiveSet(selectedId)' in
PrettyConversationsPanel.tsx:162-164 skipped and activeSet stayed
empty.

Fix: symmetric 2-line change adding selectConversationDeferred(id)
after each setActiveTabId(id) call at the two mount-time restore
paths. No new imports (selectConversationDeferred already imported
at line 59). No new tests — bug lived outside test coverage
(URL routing + persisted-tab restore paths, neither mocked in
AppShell test harness); symmetric fix matches an existing tested
pattern. Deploy deferred: batched with #146.
```
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run type-check 2>&1 | tail -20 && echo "---TESTS---" && npm test -- pretty-conversations --run 2>&1 | tail -30 && echo "---BUILD---" && npm run build 2>&1 | tail -10 && echo "---GREP GATE---" && grep -c 'selectConversationDeferred' src/ui/AppShell.tsx && echo "---PATTERN GATE (both new insertions present, symmetric with click handlers)---" && grep -n 'selectConversationDeferred(restoredTabs\[0\]\.id)' src/ui/AppShell.tsx && grep -n 'selectConversationDeferred(openedIds\[idx\])' src/ui/AppShell.tsx</automated>
  </verify>
  <done>
- `npm run type-check` clean (no new tsc errors introduced by this patch — pre-existing type-debt at unrelated lines is not a regression)
- `npm test -- pretty-conversations --run` green (existing tests unchanged — expect same pass count as pre-patch baseline)
- `npm run build` clean (Vite build succeeds)
- `grep -c 'selectConversationDeferred' src/ui/AppShell.tsx` returns 5 (up from 3: existing at 1295/1309/1317 + 2 new at ~832 and ~900)
- Both symmetric-insertion pattern greps find their lines (one at ~832 for restoredTabs[0].id, one at ~900 for openedIds[idx])
- `git diff --stat src/ui/AppShell.tsx` shows exactly 1 file changed, +2 -0
- No changes to any other file (import block untouched, click handlers untouched, tests untouched, skynet-patches.md untouched)
- Single atomic commit on `feat/tab-title-from-tmux` with the message above, NO Co-Authored-By trailer
- No push, no deploy (batched with #146 per Ashley 2026-07-23)
  </done>
</task>

</tasks>

<verification>
Post-execution manual UAT (Ashley or Tina, deferred to next deploy — NOT gating this patch's commit):
1. Load skynet with a URL fragment targeting an active session (e.g. `#tab=tmux:thenasty:yolanda`)
2. Confirm the sidebar row for that session shows the full pretty-view active-glow bubble treatment (hue-tinted gradient, border, shadow) — NOT the flat ambient recession treatment
3. Open DevTools → Application → Session Storage, verify `pv-conv-active-set` contains the URL-targeted tab id
4. Refresh the page (persisted-tab-restore path) and confirm the first restored tab lights up automatically without any click
5. Regression check: click a different sidebar row and confirm it lights up as before (patch #137/#144 click path unchanged)
</verification>

<success_criteria>
- src/ui/AppShell.tsx contains exactly 2 new call sites of `selectConversationDeferred`, one after each mount-time `setActiveTabId` call, symmetric with the sidebar click handlers
- `grep -c 'selectConversationDeferred' src/ui/AppShell.tsx` == 5
- tsc clean, pretty-conversations tests green, npm run build clean
- Single atomic commit on `feat/tab-title-from-tmux`, no push, no deploy, no skynet-patches.md write-up
</success_criteria>

<output>
Create `.planning/quick/260724-aiu-patch-145-fix-active-glow-on-url-restore/260724-aiu-SUMMARY.md` when done
</output>
