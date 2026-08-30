---
phase: quick-260724-czu
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
  - patch-149-slice-B
  - patch-149-slice-C

must_haves:
  truths:
    - "Any conversation row whose id is in state.activeSet renders in a new top-of-list active-set tier, above pinned rows"
    - "Any conversation row whose id is in state.pinnedIds and NOT in state.activeSet renders in the pinned tier (this now includes fleet-derived rows, not only openTab rows)"
    - "Any conversation row that is neither in activeSet nor pinnedIds renders in the existing grouped-by-host section (Tier 3)"
    - "Every derived row appears in EXACTLY ONE of the three tiers — strict dedup across activeSet + pinned + grouped"
    - "RDP rows continue to render inside the __rdp__ sentinel group at the bottom of grouped[] — they NEVER appear in Tier 1 or Tier 2"
    - "PrettyConversationsPanel renders the new active-set group ABOVE the existing pinned group, using the same .pv-panel-group wrapper (no visual separator per Telegram-shape flat-list lock)"
    - "The full conversation-store.test.ts + pretty-conversations test suites stay green after the shape change"
  artifacts:
    - path: src/ui/state/conversation-store.ts
      provides: "ConversationList shape with new activeSet field; computeSnapshot emitting three tiers with strict dedup; SnapshotForTest shape mirrors the new field"
      contains: "activeSet: ConversationRow[]"
    - path: src/ui/state/conversation-store.test.ts
      provides: "Extended Test 30 + new Tests 30b/30c/30d/30e covering the three-tier + dedup contract"
      contains: "snap.activeSet"
    - path: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
      provides: "Active-set group rendered above pinned group via new data-active-set-group=true wrapper"
      contains: "data-active-set-group"
    - path: src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
      provides: "Mock store shape includes activeSet: [] so useConversations() returns the new field"
      contains: "activeSet:"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/state/conversation-store.ts"
      via: "const { activeSet: activeSetRows, pinned, grouped } = useConversations();"
      pattern: "useConversations\\(\\)"
    - from: "src/ui/state/conversation-store.test.ts"
      to: "src/ui/state/conversation-store.ts"
      via: "__getSnapshotForTest exposes .activeSet slice for assertions"
      pattern: "snap\\.activeSet"
---

<objective>
Patch #149 Slice B+C — Rework the derived ConversationList so it emits rows in three strictly-deduped tiers (activeSet → pinned → grouped), and update PrettyConversationsPanel to render the new active-set tier ABOVE the existing pinned tier. Also update the pinned tier so it surfaces BOTH openTab-derived AND fleet-derived pinned rows (Slice A already removed the pin guard; this slice makes those fleet ids actually surface at the top).

Purpose: Ashley's ask (verbatim) — "we should definitely be sorting active sessions to the top, even overtaking pinned ones, because the most important thing is being able to bounce between the sessions that are active when you've already made some of them active. and then besides that the pinned ones stay to the top."

Output: Three-tier derived list, panel rendering the new tier above pinned, extended + new tests. Bundled with Slice A (cf624a4) for a single deploy at end.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@src/ui/state/conversation-store.ts
@src/ui/state/conversation-store.test.ts
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Reshape ConversationList + computeSnapshot to emit three tiers with strict dedup</name>
  <files>src/ui/state/conversation-store.ts, src/ui/state/conversation-store.test.ts</files>
  <behavior>
    Tier semantics (top to bottom):
    - Tier 1 (activeSet): Any row whose id is in state.activeSet. Openttabs order first, then fleet-session order.
    - Tier 2 (pinned, not in activeSet): Any row whose id is in state.pinnedIds AND NOT in state.activeSet. Openttabs order first, then fleet-session order.
    - Tier 3 (grouped): Everything else, bucketed by host. RDP sentinel group stays at the bottom, untouched.

    Dedup invariant: every emitted row appears in EXACTLY one tier. RDP rows are never eligible for Tier 1 or Tier 2 (patch #137 excludes them from activeSet; the panel wires rdpNoopTogglePin so they can't reach pinnedIds via UI — but the store makes no assumption; the tier-selection code path for RDP is simply "always emit through the existing __rdp__ sentinel branch, do not run activeSet/pinned dedup on rdp-host::* ids").

    Test coverage (append after existing Test 30, KEEP Test 30 as-is for Slice A regression coverage):
    - Test 30b — Pinned fleet row appears in snap.pinned. Setup: 1 host in hostTree + hostsFlat, 1 fleet session (hostId=1, sessionName="work"), pin "fleet::1::work". Assert `snap.pinned.length === 1`, `snap.pinned[0].id === "fleet::1::work"`, `snap.pinned[0].fleetOnly === true`. Assert the row is NOT present in any grouped[] group (concat all grouped[*].rows and check).
    - Test 30c — Active-set row overtakes pinned tier. Setup as 30b, then ALSO addToActiveSet("fleet::1::work"). Assert `snap.activeSet.length === 1`, `snap.activeSet[0].id === "fleet::1::work"`, `snap.pinned.length === 0` (fleet id promoted OUT of pinned into activeSet), and the row is NOT present in grouped[].
    - Test 30d — activeSet-only row (not pinned). Setup: 1 host, 1 fleet session, addToActiveSet("fleet::1::work") but do NOT pin. Assert `snap.activeSet[0].id === "fleet::1::work"`, `snap.pinned.length === 0`, and row NOT in grouped[].
    - Test 30e — openTab row: pinned + activeSet → activeSet only. Setup: hostA + open tab t1 (terminal, host=hostA, targetTmuxSession="s1"). Pin "t1" AND addToActiveSet("t1"). Assert `snap.activeSet[0].id === "t1"`, `snap.pinned.length === 0`, and t1 NOT in grouped[]. (Proves dedup applies to openTab code path too.)

    Also add: minimal shape-guard extension of Test 1 ("empty state") — assert `convs.current.activeSet` equals [] so the shape change is visible on the happy-empty path.
  </behavior>
  <action>
    Edit `src/ui/state/conversation-store.ts`:

    1. **Extend the `ConversationList` type** (~lines 71-74). Add a new field `activeSet: ConversationRow[]` alongside `pinned` and `grouped`. Keep field order `activeSet, pinned, grouped` in the type declaration so serialization/inspection reads top-to-bottom.

    2. **Extend `SnapshotForTest`** (~lines 89-92). Add `activeSet: ConversationRow[]` (the ConversationList intersection already picks it up via `ConversationList & { ... }`, so this is automatic — but eyeball it and DO NOT re-declare pinned/grouped there).

    3. **Rewrite `computeSnapshot`** (~lines 265-443). Restructure the tier-derivation as follows. Keep the fleet-derivation + host-resolution logic (openTabsSessionKeys building, fleet dedup by (hostId, sessionName), fleetHostNameFallback map, hostsFlat host enrichment, RDP row synthesis at the bottom via `__rdp__` sentinel group) — those blocks are correct and load-bearing.

       New tier-selection flow, inside computeSnapshot:

       a. `const conversationTabs = state.openTabs.filter(isConversationTab);` (unchanged first line).

       b. Build the fleet-derivation dedup set (`openTabsSessionKeys`) BEFORE tier assignment. This currently lives inside the grouped-tabs loop — extract it into its OWN pass over conversationTabs first, so the tier assignment loops below can iterate conversationTabs from scratch with clean semantics:
          ```
          const openTabsSessionKeys = new Set<string>();
          for (const tab of conversationTabs) {
            if (!tab.host) continue;
            const tmux = tab.targetTmuxSession;
            if (tmux !== null && tmux !== "") {
              openTabsSessionKeys.add(dedupKey(String(parseInt(tab.host.id)), tmux));
            }
          }
          ```

       c. Build the merged fleet-derived synthetic-row list `fleetSyntheticRows: ConversationRow[]` in fleetSessions order (skipping ones whose dedup key is in openTabsSessionKeys). Same construction as the existing fleet loop, same fallback host resolution via state.hostsFlat, same fleetOnly:true marker. Also build fleetHostNameFallback in the same pass (map hostIdStr → session.hostName on first appearance) so the Tier 3 grouped fallback code below can still consume it.

       d. **Tier 1 (activeSet):** Iterate `conversationTabs` in order; for each tab where `state.activeSet.has(tab.id)` is true, push `rowFromTab(tab)` into `activeSetRows`. Then iterate `fleetSyntheticRows` in order; for each fleet row where `state.activeSet.has(row.id)` is true, push into `activeSetRows`. Track emitted ids in a `Set<string> emittedIds` so Tier 2 and Tier 3 can skip them cheaply.

       e. **Tier 2 (pinned, not activeSet):** Iterate `conversationTabs` in order; for each tab where `state.pinnedIds.has(tab.id) && !emittedIds.has(tab.id)`, push `rowFromTab(tab)` into `pinned` and add to emittedIds. Then iterate `fleetSyntheticRows` in order; for each fleet row where `state.pinnedIds.has(row.id) && !emittedIds.has(row.id)`, push into `pinned` and add to emittedIds. (This is the new behavior: previously the pinned tier iterated ONLY openTabs. Now it also iterates fleet rows.)

       f. **Tier 3 (grouped):** Iterate `conversationTabs`; for each tab where `!emittedIds.has(tab.id) && tab.host`, bucket into `byHostId` via `rowFromTab(tab)`. Then iterate `fleetSyntheticRows`; for each fleet row where `!emittedIds.has(row.id)`, bucket into `byHostId` under its `hostIdStr` (extract from the fleet id: the fleet id format is `fleet::${hostId}::${sessionName}`; simpler — construct the fleet synthetic rows in step (c) as `{ hostIdStr, row }` tuples so this loop has both without re-parsing).

          Emit HostGroups in the existing order — `orderedHosts` from `collectHostOrder(state.hostTree)` first, then the fallback loop over remaining byHostId entries (unchanged fallback: hostName preferring `firstRow.host?.name ?? fleetHostNameFallback.get(hostId) ?? hostId`).

       g. **RDP sentinel group** (~lines 405-440): Unchanged. Append `{ hostId: "__rdp__", hostName: "", rows: rdpRows }` to grouped as before. RDP rows are NEVER considered for Tier 1 or Tier 2 by construction: activeSet excludes them via patch #137 contract, and the tier loops in (d)/(e) only iterate conversationTabs + fleetSyntheticRows (rdpRows is a separate synthesized list that never joins conversationTabs or fleetSyntheticRows).

       h. `return { activeSet: activeSetRows, pinned, grouped };` — note field order in the returned object literal.

    4. **Row-shape assertion for fleet rows in the pinned tier:** When pushing a fleet synthetic row into `pinned` (Tier 2 step (e)), reuse the same `ConversationRow` object built in step (c) — do NOT re-synthesize with different field values. Same for pushing into activeSetRows in step (d). This preserves the `fleetOnly: true` marker so downstream row-rendering (PrettyConversationRow) sees a consistent shape regardless of tier.

    5. **DO NOT modify** the following (out of scope for this slice):
       - `pinConversation` / `unpinConversation` / `togglePinConversation` — Slice A already removed the openTabs guard; behavior is correct.
       - `addToActiveSet` / `hydrateActiveSetFromStorage` — activeSet mutation semantics are unchanged.
       - The `updateOpenTabs` pruning behavior for pinnedIds. Note: this DOES still prune pinnedIds for ids not in openTabs; that means a fleet-only pinned id (fleet::1::work) will NOT survive an updateOpenTabs call that lacks it. Ashley's post-#149-A design accepts this as a known limitation (fleet rows can be pinned per-session; page refresh drops the pin). Do NOT try to fix here; leave the pruning code alone.

    Edit `src/ui/state/conversation-store.test.ts`:

    6. Update the empty-state Test 1 (~line 90) to also assert `convs.current.activeSet).toEqual([])`. This makes the new shape field visible on the happy path.

    7. Append Test 30b, 30c, 30d, 30e after the existing Test 30 (~line 873). Use the existing `makeHost`, `makeTab`, `updateHostTree`, `updateHostsFlat`, `updateFleetSessions`, `updateOpenTabs`, `pinConversation`, `addToActiveSet`, `__getSnapshotForTest` helpers. Test structure mirrors existing Test 30 (single `describe` per new test with an inline `it`, or grouped under one `describe("conversation-store (Patch #149 B+C): three-tier sort", ...)` block — pick whichever matches surrounding style; the existing file uses one describe per test with an inline it, so match that).

       For Tests 30b/30c/30d, the setup is a single host `hostA = makeHost("1", "hostA")`, `updateHostTree({ name: "root", children: [hostA] })`, `updateHostsFlat(new Map([[1, hostA]]))`, `updateFleetSessions([{ hostId: 1, hostName: "hostA", sessionName: "work", created: 100 }])`. Then act() the specific pin / addToActiveSet mutation the test targets. Read snapshot via `__getSnapshotForTest()`.

       For Test 30e, the setup is `hostA = makeHost("hA", "hostA")`, `updateHostTree({ name: "root", children: [hostA] })`, `updateOpenTabs([makeTab("t1", "terminal", hostA, "s1", "t1-label")])`, then `pinConversation("t1")` + `addToActiveSet("t1")`. Assert exactly as specified in <behavior>.

    8. Check the whole test file for any assertion that indexes `snap.pinned[0]` or `snap.grouped[0]` with a hard-coded expectation that could now shift due to the extended pinned/tiering. Rerun mentally against each test to confirm no regression. From the grep results the risky ones are Tests around L158-L235, L279-L299, L337-L341 (pinning + host-tree tests). Those tests do NOT populate activeSet and do NOT pin fleet rows, so the three-tier behavior collapses to the pre-existing two-tier behavior for them — activeSet stays [], pinned stays as it was, grouped stays as it was. No changes needed. Confirm by running the suite.

    Constraints:
    - No new imports at module scope of conversation-store.ts.
    - Do not touch fleetOnly / rdpHostRow field semantics.
    - Do not add a removeFromActiveSet API.
    - Keep computeSnapshot pure (no side effects; no notify() calls).
    - Match existing 2-space indentation + trailing-comma style + `//` single-line comment cadence.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/state/conversation-store.test.ts 2>&1 | tail -40</automated>
  </verify>
  <done>
    - `ConversationList` type has three fields: `activeSet`, `pinned`, `grouped` (in that order).
    - `computeSnapshot` returns three tiers with strict dedup: every derived row appears in exactly one tier.
    - Test 30 (Slice A regression) still passes verbatim.
    - New Tests 30b, 30c, 30d, 30e all pass.
    - Empty-state Test 1 asserts activeSet === [].
    - Full conversation-store.test.ts passes 100%.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Render new active-set tier above pinned in PrettyConversationsPanel + reconcile mock</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    - The panel renders a new `.pv-panel-group[data-active-set-group=true]` wrapper containing the Tier-1 rows ABOVE the existing `.pv-panel-group[data-pinned-group=true]` wrapper.
    - Row-render props per tier:
      * Tier 1 rows: `pinned={pinnedIds.has(row.id)}` (a row that IS pinned AND active gets .pinned class → pin glyph shows).
      * Tier 2 rows: `pinned={true}` hardcoded (they're in the tier because they're pinned — unchanged from existing pinned render site).
      * Tier 3 rows: `pinned={pinnedIds.has(row.id)}` (unchanged — defensive; guaranteed false by tier logic after this slice).
    - `isEmpty` check accounts for the new tier: empty iff `activeSetRows.length === 0 && pinned.length === 0 && grouped.length === 0`.
    - No visual separator between the three tiers — the existing `.pv-panel-group` gap CSS gives adequate visual coherence per Ashley's Telegram-shape flat-list lock.
    - The Vitest mock at PrettyConversationsPanel.test.tsx returns an `activeSet: []` field on `useConversations()` so all existing panel tests continue to pass without shape errors.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:

    1. **Destructure the new field** (~line 145). Change:
       ```
       const { pinned, grouped } = useConversations();
       ```
       to:
       ```
       const { activeSet: activeSetRows, pinned, grouped } = useConversations();
       ```
       Renamed to `activeSetRows` to avoid a name collision with the existing `activeSet` local (line 151) which holds the ReadonlySet<string> from `useActiveSet()` — that hook is still needed for row-level `inActiveSet={activeSet.has(row.id)}` prop wiring on every row-render site (Tier 1, Tier 2, Tier 3). Do NOT remove or rewire the useActiveSet call.

    2. **Update the `isEmpty` check** (~line 178). Change:
       ```
       const isEmpty = pinned.length === 0 && grouped.length === 0;
       ```
       to:
       ```
       const isEmpty = activeSetRows.length === 0 && pinned.length === 0 && grouped.length === 0;
       ```

    3. **Add the new active-set group render block** immediately BEFORE the existing `<div className="pv-panel-group" data-pinned-group="true">` block (~line 331). Structure mirrors the pinned block VERBATIM except:
       - `data-active-set-group="true"` instead of `data-pinned-group="true"`.
       - `pinned={pinnedIds.has(row.id)}` prop (dynamic per row) instead of `pinned={true}`.
       - Comment above the block: `{/* Patch #149 B+C: active-set rows overtake pinned per Ashley 2026-07-24. Rows here get pinned={pinnedIds.has(row.id)} so a row that IS pinned AND active still shows the pin glyph. */}`
       - All other row props identical to the pinned render site: `key={row.id}`, `row={row}`, `selected={row.id === selectedId}`, `variant={variant}`, `onSelect={() => handleRowSelect(row)}`, `onTogglePin={() => togglePinConversation(row.id)}`, `onSwipeOpenChange={isMobileVariant ? (open) => handleSwipeOpenChange(row.id, open) : undefined}`, `forceClosed={forceClosedFor(row.id)}`, `inActiveSet={activeSet.has(row.id)}`, `sessionKey={sessionWorkingKey(row)}`.

       Exact placement: inside the `<>...</>` fragment (line 320), as the FIRST child, ABOVE the existing pinned-group `<div>`. Do NOT wrap in additional containers.

    4. **Leave the existing pinned-group render block unchanged** (~lines 331-351). It continues to iterate `pinned.map(...)` with `pinned={true}` hardcoded. Correct — Tier 2 rows are pinned by definition. The Tier 2 pinned array now includes fleet rows (new from Task 1); the pinned render site handles fleet rows identically to openTab rows (PrettyConversationRow's shape-tolerant contract per Plan 07-01, TG-13).

    5. **Leave the grouped render block unchanged** (~lines 355-425). It continues iterating grouped[] with special-cased __rdp__ handling. Correct — after Task 1's dedup, no activeSet or pinned row leaks into grouped, so the existing `pinned={pinnedIds.has(row.id)}` prop on regular-host rows is defensive-but-inert (always false).

    Edit `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`:

    6. **Extend the MockSnapshot type** (~lines 80-85). Add `activeSet: MockRow[];` as the FIRST field of MockSnapshot, matching the new type order.

    7. **Extend the module-level `snapshot` seed** (~lines 87-92). Add `activeSet: [],`.

    8. **Extend `setSnapshot`** (~lines 94-101). Add `activeSet: next.activeSet ?? [],` at the top of the returned literal.

    9. **Extend the `useConversations` mock** (~line 111). Return:
       ```
       useConversations: () => ({
         activeSet: snapshot.activeSet,
         pinned: snapshot.pinned,
         grouped: snapshot.grouped,
       }),
       ```

    10. **Extend the `beforeEach` reset** (~line 193). Include `activeSet: []` in the setSnapshot call so no prior test's activeSet writes leak forward. Also inspect every `setSnapshot({...})` call in the file (grep found roughly 8 call sites): if any of them relies on the field NOT being present, add `activeSet: []` explicitly. From the grep results all existing setSnapshot calls pass a partial with `pinned/grouped` and rely on the `??` fallbacks — those already default activeSet to [] via step 8's `??` clause. No further changes needed at those call sites.

    Constraints:
    - No changes to CSS (pretty-conversations.css untouched — no new selectors needed; the existing .pv-panel-group gap rules handle the new group).
    - No changes to PrettyConversationRow.tsx.
    - No new imports at panel top (activeSet field comes through the existing useConversations import).
    - Rebase-ability: keep the new render block visually adjacent to the pinned block for easy reading during upstream-rebase conflict resolution.
    - CLAUDE.md Nginx caveat: N/A — no new backend routes.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-conversations/ 2>&1 | tail -40</automated>
  </verify>
  <done>
    - PrettyConversationsPanel destructures `activeSet: activeSetRows` from useConversations().
    - New `.pv-panel-group[data-active-set-group=true]` renders above `.pv-panel-group[data-pinned-group=true]`.
    - `isEmpty` accounts for all three tiers.
    - Panel test mock returns `activeSet: []`.
    - Full pretty-conversations test suite passes 100%.
  </done>
</task>

<task type="auto">
  <name>Task 3: End-to-end type-check + full targeted test run</name>
  <files>(no code edits — verification only)</files>
  <action>
    Run the two guardrail commands the spec calls out:

    1. Type-check the whole repo:
       ```
       cd /home/ubuntu/skynet && npx tsc --noEmit
       ```
       MUST exit 0. If any type error surfaces in a file OUTSIDE the four Task 1+2 files, investigate — it likely means another consumer of `ConversationList` needs to be updated too (grep for `useConversations()` and `ConversationList` across src/ to find them). Common candidates: `ConversationsPanel.tsx` (the older sibling panel; may or may not still consume the shape — check first before editing). If found, apply the same rename/destructure pattern from Task 2 step 1. If NOT found (dead file), leave it alone.

    2. Full targeted vitest run (the two suites the spec calls out):
       ```
       cd /home/ubuntu/skynet && npx vitest run src/ui/state/conversation-store.test.ts src/ui/features/pretty-conversations/
       ```
       MUST report all tests green across both files.

    3. Do NOT run:
       - `npm run build` (not requested by spec; type-check is the guardrail).
       - Docker build or docker compose commands (deploy is batched with Slice A, deferred to Ashley greenlight).
       - Fork-specific patches.md updates (deferred to deploy-recommendation time per Ashley 2026-07-23 batch-writeups-until-deploy rule).

    4. After both pass, `git status` + `git diff --stat` to show the surface area. Expected: 4 files modified (2 store, 2 panel), zero new files, zero deletions.

    5. Report back: (a) type-check clean, (b) vitest pass counts, (c) diff-stat summary. Do NOT git commit — the parent orchestrator decides commit timing (this slice may want to be a single commit bundled with the docs/skynet-patches.md deploy write-up, or it may be a standalone commit for local review; that's the orchestrator's call).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit && npx vitest run src/ui/state/conversation-store.test.ts src/ui/features/pretty-conversations/ 2>&1 | tail -20</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0 with no errors.
    - Both vitest suites report all tests green.
    - `git diff --stat` shows exactly the 4 files from Tasks 1+2 modified.
    - Findings reported back to orchestrator with pass counts.
  </done>
</task>

</tasks>

<verification>
Final phase checks:
- Three tiers observable in the derived list (activeSet, pinned, grouped) with strict dedup.
- Fleet-derived rows can appear in pinned tier when their id is in pinnedIds AND not in activeSet.
- Fleet-derived rows appear in activeSet tier when their id is in activeSet (regardless of pin).
- RDP rows never surface in Tier 1 or Tier 2.
- Panel renders `data-active-set-group=true` above `data-pinned-group=true`.
- Full conversation-store.test.ts + pretty-conversations test files green.
- `npx tsc --noEmit` clean.
</verification>

<success_criteria>
- Ashley's ask satisfied: active-set rows overtake pinned rows at the top of the panel.
- Slice A's pinnedIds-can-hold-fleet-ids capability now visible in the UI (Slice B: fleet pinned rows surface in the pinned tier).
- All existing tests remain green; new tests 30b/30c/30d/30e prove the tier + dedup contract.
- Rebase-ability preserved: no upstream file surface widened beyond the four fork-owned files.
- No deploy — bundled with Slice A (cf624a4) for one deploy at Ashley greenlight.
</success_criteria>

<output>
Report to orchestrator: type-check status, both vitest suite pass counts, git diff --stat summary. Do NOT auto-commit — orchestrator decides commit boundary for the bundled Slice A+B+C landing.
</output>
