---
phase: quick-260817-qfg-retire-activeset-zone-pinned-header
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
autonomous: true
requirements:
  - UAT-42-AMEND-2026-08-17

must_haves:
  truths:
    - "Sessions in the client's active set no longer surface above the pinned area at the top of the list."
    - "Active-and-not-pinned sessions land in the middle zone, sorted by recency alongside every other non-pinned session."
    - "Active-and-pinned sessions land in the pinned zone (they were already going there via the pin gate; now with no Tier 1 to overtake into)."
    - "The 'Pinned' divider chip (Pin icon + uppercase 'Pinned' label + gradient rule) no longer renders above the pinned tier."
    - "The `.active-set` classname continues to gate the deactivate-action hover-reveal on every remaining row render site (pinned, middle, RDP, search-flat) — no regression to that CSS behavior."
    - "Swipe machinery and context-menu Deactivate item gating continue to work for active-set rows on every render site."
    - "`npx vitest run` exits 0. `npm run build:backend && npm run build` both exit 0."
  artifacts:
    - path: "src/ui/state/conversation-store.ts"
      provides: "computeSnapshot without Tier 1 activeSet emit; snapshot returns activeSet: [] as always-empty array"
      contains: "activeSet: []"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Panel render without data-active-set-group wrapper and without pinned-divider chip"
    - path: "src/ui/state/conversation-store.test.ts"
      provides: "Tests updated to reflect empty activeSet snapshot field + rows-flow-to-pinned-or-middle behavior"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "Tests updated to reflect no data-active-set-group wrapper and no pinned-divider chip in render"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      via: "inActiveSet={activeSet.has(row.id)} prop threaded on every surviving PrettyConversationRowLive call site (pinned map, middle map, RDP map, search-flat map)"
      pattern: "inActiveSet=\\{activeSet\\.has"
    - from: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      to: "src/ui/features/pretty-conversations/pretty-conversations.css"
      via: "className 'active-set' toggle driven by inActiveSet prop; gates deactivate-action hover-reveal at CSS selectors :not(.active-set) and .active-set:not(:hover)"
      pattern: "'active-set'"
---

<objective>
Retire the Tier 1 active-set top zone from the pretty-conversations list AND remove the "Pinned" divider chip above the pinned tier, per Ashley UAT 2026-08-17 amendment to Phase 42.

Purpose: Ashley UAT 2026-08-17 verbatim: *"sessions are still showing above the pinned area when they are active in the current instance of the client. That shouldn't happen. Also the pinned header should go away entirely."* Phase 42 shipped a three-zone list (activeSet → pinned → middle → RDP); this quick collapses activeSet into middle (or into pinned, if pinned) and kills the "Pinned" section header. Load-bearing preservation: the per-row `inActiveSet` prop and its `.active-set` CSS gate — which drives the deactivate-action hover-reveal, swipe machinery, and context-menu Deactivate item gating — MUST survive intact at every remaining render site.

Output: Store snapshot with `activeSet: []` always-empty (field kept to avoid destructure churn); panel renders no top active-set zone and no "Pinned" chip; both test files updated in place; full vitest + build suites green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@.planning/phases/42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd/42-CONTEXT.md
@src/ui/state/conversation-store.ts
@src/ui/state/conversation-store.test.ts
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
</context>

<tasks>

<task type="auto">
  <name>Task 1: Retire Tier 1 activeSet emit in conversation-store.ts + update store tests</name>
  <files>src/ui/state/conversation-store.ts, src/ui/state/conversation-store.test.ts</files>
  <action>
Two-part edit inside `computeSnapshot()` and its test suite.

**Part A — `src/ui/state/conversation-store.ts` (L622-644, L820-831):**

Delete the entire Tier 1 activeSet emit block spanning approximately L622-644. That block is:
- The `emittedIds` Set declaration comment (L622-624) — KEEP the `emittedIds` Set itself (Tier 2 pinned dedup still uses it). Just remove the "Tier 1" framing from the comment; retitle the comment to reflect that `emittedIds` now only tracks Tier 2 pinned emissions for Tier 3 dedup.
- The `── Tier 1 (activeSet) ──` section header comment (L626-632).
- The `const activeSetRows: ConversationRow[] = [];` declaration (L633).
- Both `for (const tab of conversationTabs)` and `for (const { row } of fleetSyntheticRows)` loops that populate `activeSetRows` and add ids to `emittedIds` (L634-643).
- The `activeSetRows.sort(compareByHostRoleLabel);` call (L644).

Then in the return-shape assembly at the bottom of `computeSnapshot()` (L818-831):
- The `if (state.hiddenIds.size > 0)` branch computes `filteredActiveSet = activeSetRows.filter(...)` — replace this with `const filteredActiveSet: ConversationRow[] = [];` (or just inline `activeSet: []` in the returned object). The `activeSet` field in the returned shape MUST be an always-empty `ConversationRow[]` so the panel's `const { activeSet: activeSetRows, ... } = useConversations();` destructure at PrettyConversationsPanel.tsx L266 still compiles and returns an empty array.
- The final `return { activeSet: activeSetRows, pinned, middle: middleRows, rdpGroup };` at L831 becomes `return { activeSet: [], pinned, middle: middleRows, rdpGroup };`.
- Do NOT change the type of the `activeSet` field in the return type / ConversationList shape; keep it typed as `ConversationRow[]`.

Preservation callouts (do NOT touch):
- `state.activeSet: Set<string>` field — still populated/mutated by `addToActiveSet`/`removeFromActiveSet` and hydrated from sessionStorage. It's still consumed by `useActiveSet()` for the per-row `inActiveSet` prop lookup in the panel.
- `useActiveSet()` hook — unchanged.
- The Tier 2 pinned block's "if (emittedIds.has(tab.id)) continue" checks are now trivially unreachable (no Tier 1 emissions ever add to `emittedIds`), but LEAVE them — they document intent and are defensively correct. The `emittedIds` Set is still populated by the Tier 2 pinned loops themselves for Tier 3 middle dedup, which continues to be load-bearing.
- The Tier 3 middle-zone loop's `if (emittedIds.has(...))` check is load-bearing (skips pinned rows from also appearing in middle) — leave untouched.
- `compareByHostRoleLabel` is still consumed by the pinned tier sort (L682) and the RDP tier sort (L798) — leave the import/definition intact.

**Part B — `src/ui/state/conversation-store.test.ts` — update 4 assertion sites:**

1. **L1146-1156 "empty state exposes activeSet field"**: The `expect(convs.current.activeSet).toEqual([]);` assertion stays valid (activeSet is now always empty). Update the describe/it copy to reflect the new contract — rename to reflect "activeSet is always empty (Phase 42 UAT amendment 2026-08-17)" or similar. The assertion itself is unchanged.

2. **L1270-1296 "Test 30c — active-set row overtakes pinned tier"**: Behavior has flipped. When a pinned fleet id is also added to activeSet, the row now stays in the PINNED tier (not promoted to activeSet). Rewrite the test to assert:
   - `snap.activeSet.length === 0` (activeSet is always empty)
   - `snap.pinned.length === 1` and `snap.pinned[0].id === "fleet::1::work"` (still in pinned; pin wins)
   - `snap.middle` does NOT contain the fleet id (pinned dedup still works)
   - Update the describe/it title to reflect the new contract (e.g., "active-set + pinned row stays in pinned tier"). Reference the UAT amendment date in the comment.

3. **L1298-1319 "Test 30d — activeSet-only row (not pinned)"**: Behavior flipped. An activeSet-only row (not pinned) now lands in MIDDLE, not activeSet. Rewrite the test to assert:
   - `snap.activeSet.length === 0`
   - `snap.pinned.length === 0`
   - `snap.middle` DOES contain the fleet id (`snap.middle.some(r => r.id === "fleet::1::work")` is true)
   - Update the describe/it title accordingly.

4. **L1321-1343 "Test 30e — openTab pinned + activeSet → activeSet only"**: Behavior flipped. openTab in both pinnedIds and activeSet now stays in PINNED (not promoted to activeSet). Rewrite:
   - `snap.activeSet.length === 0`
   - `snap.pinned.length === 1` and `snap.pinned[0].id === "t1"`
   - `snap.middle` does NOT contain "t1"
   - Update the describe/it title.

5. **L2394-2418 "host is outer sort key in ActiveSet — same-role rows from different hosts stay host-ordered"**: This test asserts `snap.activeSet.map((r) => r.host?.name)).toEqual(["alpha", "beta"])`. The active-set tier is now always empty, so this test's premise is invalid. Retarget the test to assert host-outer sort semantics on a SURVIVING tier — the natural retarget is PINNED (the block at L2422+ already does this for pinned; if that block already exhaustively covers the case, DELETE this test with a comment linking to the pinned equivalent). If the pinned-equivalent test doesn't cover the exact same-role two-host scenario, retarget this test by pinning both `t-a` and `t-b` instead of `addToActiveSet`, and change the assertion to `snap.pinned.map((r) => r.host?.name)).toEqual(["alpha", "beta"])`. Update the it/describe title accordingly. Preserve the comment block's intent (host-outer sort semantics survive at their remaining sort sites).

Ashley reason to embed in each rewritten test's block comment: `// Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): "sessions are still showing above the pinned area when they are active in the current instance of the client. That shouldn't happen." — activeSet render tier retired; activeSet-and-pinned rows stay in pinned, activeSet-only rows fall through to middle by recency.`

**Verify BOTH** the store change and the test rewrites in a single vitest pass on just the store test file (fast — ~2s). Do not run the full suite yet; Task 2 does that.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/state/conversation-store.test.ts 2>&1 | tail -60</automated>
  </verify>
  <done>
`src/ui/state/conversation-store.ts` no longer contains the `── Tier 1 (activeSet)` section header or the `const activeSetRows: ConversationRow[] = [];` declaration. `computeSnapshot()` returns `{ activeSet: [], pinned, middle, rdpGroup }` (empty activeSet always). `src/ui/state/conversation-store.test.ts` compiles and all its tests pass. The 4 assertion sites in Part B have been rewritten to assert the new behavior. No unrelated tests broken in the store test file. `emittedIds` still populated by Tier 2 pinned loops. `state.activeSet: Set<string>` and `useActiveSet()` untouched.
  </done>
</task>

<task type="auto">
  <name>Task 2: Delete active-set render + pinned divider in PrettyConversationsPanel + update panel tests + full-suite green</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <action>
Two deletions in the panel + a set of test updates + full-suite green.

**Part A — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:**

Deletion 1 (L1192-1214) — the entire `{displayedActiveSetRows.length > 0 && ( … )}` block. That includes:
- The `<div className="pv-panel-group" data-active-set-group="true">` opening tag.
- The `{displayedActiveSetRows.map((row) => ( <PrettyConversationRowLive ... /> ))}` inner map.
- The closing `</div>` and the outer `)}`.
- The comment header at L1183-1191 (`Patch #149 B+C: active-set rows overtake pinned per Ashley 2026-07-24. ...` through the `subtitleMode="identityTitle"` block-comment) — replace with a one-line comment: `// Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): active-set top zone retired — active-set rows now flow through to pinned (if pinned) or middle (by recency).`

Deletion 2 (L1230-1249) — the "Pinned" divider chip inside the pinned-group wrapper. That's the `{displayedPinned.length > 0 && ( <div className="flex items-center gap-2 px-4 pb-1.5 ..." data-testid="pinned-divider"> … </div> )}` block containing the `<Pin>` icon + "Pinned" label span + gradient-rule span. Delete the entire conditional and its inner markup. The surrounding `<div className="pv-panel-group" data-pinned-group="true">` wrapper (L1229) and the `{displayedPinned.map(...)}` inside it (L1250-1268) STAY unchanged.

Also update the comment block at L1215-1228 to reflect that the divider chip is gone — collapse it to a short comment noting the pinned tier still renders inside `.pv-panel-group[data-pinned-group="true"]` with per-row `inActiveSet={activeSet.has(row.id)}` wiring preserved.

Cleanup:
- `displayedActiveSetRows` (L598, `const displayedActiveSetRows = activeSetRows;`) becomes dead after the render deletion. It's ONLY referenced inside the deleted `displayedActiveSetRows.length > 0 && (...)` block and the deleted pinned-divider `displayedActiveSetRows.length > 0 ? "pt-3" : "pt-0.5"` ternary. After both deletions, grep to confirm zero remaining references, then delete the `displayedActiveSetRows` declaration at L598 AND the comment stub above it about "D-06 exemption" (L586-597 comment referring to the active-set tier). Retire the comment mention of `displayedActiveSetRows` in the block comment at L585.
- `activeSetRowsRef` (L370, `const activeSetRowsRef = useRef(activeSetRows);`, its bump at L377 `activeSetRowsRef.current = activeSetRows;`, and its ONE consumer at L399 `for (const row of activeSetRowsRef.current) collect(row);` in the bounty-count poller getTargets closure). After Task 1, `activeSetRows` is always an empty array from the destructure at L266, so the ref-and-iterate is a trivially-empty no-op that adds one branch per poll. Retire it: delete L370, L377, and L399. Leave `activeSetRows` in the L266 destructure alone (still needed for the `for (const r of activeSetRows) knownRowsRef.current.set(...)` walk at L668 and the `for (const r of activeSetRows) pushIfMatches(r);` walk at L758 — both are trivially empty no-ops but keeping them makes future re-wiring easy and avoids destructure churn). Similarly retain the `[hiddenIds, activeSetRows, pinned, middle, rdpGroup]` dep array at L686 and the `[trimmedSearchQuery, activeSetRows, pinned, middle, rdpGroup, matchesSearch]` at L767 — deleting `activeSetRows` from them would risk stale-closure regressions and offers no benefit since the array reference is stable (always the same `[]` from the snapshot after Task 1).

**Load-bearing PRESERVATION (verify after edits, do NOT touch):**
- `const activeSet = useActiveSet();` at L280 — STAYS.
- Every remaining `<PrettyConversationRowLive ... inActiveSet={activeSet.has(row.id)} ... />` call site (the search-flat map at L1158-1178, the pinned map at L1250-1268, the middle map at L1279+, and the RDP map wherever it lives below) — all four surviving call sites MUST continue to thread `inActiveSet={activeSet.has(row.id)}`.
- The `.active-set` CSS classname on the row (driven by `inActiveSet` in `PrettyConversationRow.tsx`) — that gates `pretty-conversations.css` L1004 (`.pv-row.pv-row--desktop.active-set:not(:hover):not(:focus-within) .pv-deactivate-action { opacity: 0 }`), L1008 (`.pv-row.pv-row--desktop.active-set:not(:hover) .pv-meta [data-testid="deactivate-action"] { pointer-events: none }`), and L1020 (`.pv-row.pv-row--desktop:not(.active-set) .pv-deactivate-action { display: none }`). These CSS rules are the deactivate-action hover-reveal gate, locked 2026-07-23 (role-file lock); regression-critical. Verify by grepping post-edit that at least four `inActiveSet=` occurrences remain in PrettyConversationsPanel.tsx.

**Part B — `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — update these assertion sites (rewrite in place; do NOT blanket-delete):**

1. **L485-544 describe "active-set group above pinned (Patch #149 B+C)"** — both Test 18 and Test 18b are premised on `data-active-set-group="true"` rendering. The zone is gone. Rewrite the describe block:
   - Rename to `"PrettyConversationsPanel: active-set top zone RETIRED (Phase 42 UAT amendment 2026-08-17)"`.
   - Test 18 → assert `container.querySelector('[data-active-set-group="true"]')` is NULL when the store's activeSet snapshot field is empty (which it now always is). Set up: `setSnapshot({ activeSet: [], pinned: [makeConversationRow({...})], middle: [] })`. Assert the pinned row still renders inside `[data-pinned-group="true"]`.
   - Test 18b → assert `container.querySelector('[data-active-set-group="true"]')` is NULL even when the mock snapshot is seeded with `activeSet: [...]` rows (defensive — the panel does not render an active-set wrapper regardless of what the mock reports, since the render block was deleted).

2. **L585-642 describe "'Pinned' divider chip (patch #234) — per-host chip RETIRED in Phase 41 Plan 01"** — both Test 3 and Test 3B assert the chip renders / doesn't render. The chip is gone unconditionally. Rewrite:
   - Rename describe to `"'Pinned' divider chip RETIRED (Phase 42 UAT amendment 2026-08-17)"`.
   - Test 3 → assert `container.querySelector('[data-testid="pinned-divider"]')` is NULL when pinned tier has rows (was: assert Truthy). Keep the sibling assertion that per-host chip stays null.
   - Test 3B → assertion body is unchanged (still asserts `pinnedChip` is `null`); just update the describe copy so it's not misleading. Optionally consolidate Test 3 + Test 3B into a single test since they now assert the same behavior — a judgment call; keeping both separate is fine and preserves git blame.

3. **L696-731 "Test 19B (rewritten): active-set + pinned + middle → NO host-divider chip renders anywhere in the panel"** — asserts `container.querySelector('[data-active-set-group="true"]')` is truthy at L720-722. Update: change the truthy assertion to `toBeNull()` (the wrapper no longer renders). The pinned wrapper assertion stays truthy. The middle row assertion stays. Update the test's it-title if the "active-set + pinned + middle" framing becomes misleading (retitle to "pinned + middle rows render without host-divider chips" or similar; active-set is no longer a rendered zone).

4. **Test 3143-3152 "Test F" (the pinned-divider-truthy assertion at L3147) and L3373 (also truthy) in the search-related describe block** — both assert `[data-testid="pinned-divider"]` is truthy in the non-filter state. Update both to `toBeNull()`. The RDP divider assertions on adjacent lines (`[data-testid="rdp-divider"]`) STAY unchanged. Update the surrounding it-title / comment to reflect that the pinned-divider is now retired unconditionally (present neither during filter nor in the three-zone view).

5. **L3193, L3361 (both `[data-testid="pinned-divider"]).toBeNull()`)** — assertion body unchanged (still `.toBeNull()`); leave in place. These assert the chip is absent during filter — post-retirement the chip is absent always, so the assertion trivially still holds.

6. **Test 20A at L828-877 and follow-on Test 20-series (L900-1300ish) using `activeSet: [activeRow]` in `setSnapshot()`** — these tests seed the store mock with `activeSet: [...]` to exercise deactivate-action logic. The panel no longer reads `activeSet` from the snapshot for rendering (it reads `useActiveSet()` for the per-row `inActiveSet` prop). These tests ALREADY set `mockActiveSet = new Set<string>([...])` alongside the snapshot seed for exactly that reason (see L841 `mockActiveSet = new Set<string>(["active-1"]);`). The `activeSet: [activeRow]` seed in the snapshot MAY become redundant — but since the panel's destructure still reads `activeSet` and iterates it in a couple of no-op walks (knownRowsRef accumulator, searchMatches union), passing a non-empty activeSet in the snapshot doesn't break anything. LEAVE these seeds in place; they harmlessly populate a snapshot field the panel no longer surfaces as a rendered zone. Verify Test 20-series still passes without further edit.

7. **Any other test that asserts `data-active-set-group="true"` is truthy** — grep the file for the string; there should be exactly two truthy call sites (L501, L721). Both are covered above.

**Part C — Full-suite green (Fork rule):**

Run in order (halt on first non-zero exit):
1. `npx vitest run` — must exit 0. If pre-existing failures surface, fix them in-plan (fork rule: never leave tests failing regardless of provenance). Common candidates: type errors from removed variables, snapshot files if any, other tests that grep for `data-active-set-group` or `data-testid="pinned-divider"` elsewhere in the tree.
2. `npm run build:backend` — must exit 0. Change is frontend-only but the fork-rule check is cheap and catches shared-type regressions.
3. `npm run build` — must exit 0. This runs `tsc --noEmit` + vite build; catches TSX regressions the vitest run missed (e.g., unused variables when strict mode).

**ORCHESTRATOR-ONLY EXCLUSIONS (do NOT do in this task, per Ashley 2026-08-08 fleet rule):** no `git push`, no `docker build`, no `docker compose up`, no coord-room posts, no skynet-patches.md entry, no fast-path vite-watch launch. This task ends at "code changed, tests green, builds green, ready for commit." The orchestrator picks up the deploy motion.

`git status` should show exactly four modified files (the two source + two test files) and zero untracked. No commit in this task — quick flow commits at the orchestrator layer.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run 2>&1 | tail -40 && echo "--- backend build ---" && npm run build:backend 2>&1 | tail -15 && echo "--- frontend build ---" && npm run build 2>&1 | tail -15 && echo "--- git status ---" && git status --short</automated>
  </verify>
  <done>
`PrettyConversationsPanel.tsx` no longer contains the `data-active-set-group="true"` render block or the `data-testid="pinned-divider"` divider chip. `displayedActiveSetRows` declaration and `activeSetRowsRef` ref + its bump + its poller-loop consumer are deleted. `useActiveSet()` hook + `activeSet.has(row.id)` prop threading survive at all four remaining PrettyConversationRowLive call sites (search-flat, pinned, middle, RDP). Panel test file updated in place at all six assertion clusters above; no test blanket-deleted. Full `npx vitest run` exits 0. `npm run build:backend` exits 0. `npm run build` exits 0. `git status --short` shows exactly four modified files: the two production sources + the two test files. No untracked artifacts. Ready for orchestrator to commit + deploy.
  </done>
</task>

</tasks>

<verification>
Full phase-level verification:

1. **Automated:** `npx vitest run` exits 0 (both target test files updated; no other file damage).
2. **Automated:** `npm run build:backend` exits 0.
3. **Automated:** `npm run build` exits 0.
4. **Grep check — retirement:** `grep -n "data-active-set-group\|data-testid=\"pinned-divider\"" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns nothing (both strings gone from production source).
5. **Grep check — Tier 1 emit gone:** `grep -n "Tier 1 (activeSet)" src/ui/state/conversation-store.ts` returns nothing.
6. **Grep check — snapshot still has field:** `grep -n "activeSet: \[\]" src/ui/state/conversation-store.ts` returns at least one match (the always-empty return).
7. **Grep check — CSS gate preserved:** `grep -c "active-set" src/ui/features/pretty-conversations/pretty-conversations.css` returns ≥ 5 (the `.active-set` selector rules survive intact).
8. **Grep check — inActiveSet prop preserved:** `grep -c "inActiveSet=" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns ≥ 4 (search-flat + pinned + middle + RDP render sites all still thread the prop).
9. **Human verify (post-deploy, orchestrator's problem — not this plan's):** Ashley loads the app, confirms active sessions no longer surface above pinned area and the "Pinned" section header no longer renders.
</verification>

<success_criteria>
- The panel's DOM never contains `[data-active-set-group="true"]` or `[data-testid="pinned-divider"]` under any input state.
- The store's snapshot's `activeSet` field is an always-empty `ConversationRow[]`.
- Active-and-pinned sessions render in the pinned tier; active-and-not-pinned sessions render in the middle tier by recency.
- Per-row `inActiveSet` prop threading survives at every render site (search-flat, pinned, middle, RDP); `.active-set` CSS gate for deactivate-action hover-reveal continues to work.
- `npx vitest run`, `npm run build:backend`, `npm run build` all exit 0.
- `git status --short` shows exactly the four expected file mods (no stray artifacts, no accidental deletion).
</success_criteria>

<output>
Create `.planning/quick/260817-qfg-retire-activeset-zone-pinned-header/260817-qfg-SUMMARY.md` when both tasks complete, documenting:
- What shipped (Tier 1 emit retired, pinned-chip retired, activeSet snapshot field kept as empty array for destructure stability).
- Preservation confirmed (inActiveSet prop, .active-set CSS gate, useActiveSet hook, state.activeSet mutation API, swipe machinery, context-menu Deactivate item gating).
- Test file assertion sites updated (list them by line-range).
- Full-suite green confirmation (vitest + build:backend + build all exited 0).
- Files modified: src/ui/state/conversation-store.ts, src/ui/state/conversation-store.test.ts, src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx.
- Handoff note for orchestrator: ready to commit + rebase-past-origin + coord-room BEFORE + docker build/force-recreate + HTTPS verify + coord-room AFTER + git push + skynet-patches.md entry.
</output>
