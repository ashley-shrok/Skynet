---
phase: quick
plan: 260731-tgg
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/db/schema.ts
  - src/backend/database/db/index.ts
  - src/backend/database/routes/user-preferences.ts
  - src/backend/database/routes/user-preferences.test.ts
  - src/ui/api/user-preferences-api.ts
  - src/ui/state/conversation-store.ts
  - src/ui/features/pretty-conversations/HideAction.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
autonomous: true
requirements:
  - quick-260731-tgg
must_haves:
  truths:
    - "GET /user-preferences returns hiddenConversationIds:[] when column is null/absent (same shape as pinnedConversationIds)"
    - "PUT /user-preferences with hiddenConversationIds:[...] persists JSON, echoes parsed array, enforces 400 for non-array/non-string/>1000"
    - "Ashley can right-click any non-RDP conversation row and see Hide (or Show, when already hidden) between Pin/Unpin and Deactivate"
    - "Clicking Hide on a row currently in the active set auto-closes its tab first (onDeactivate path), then flips the hidden flag; the row disappears from active-set / grouped / pinned tiers"
    - "Hiding a pinned row auto-unpins; pinning a hidden row auto-unhides (mutual exclusion) — panel handlers orchestrate, row stays a dumb consumer"
    - "A collapsed 'Hidden' section renders BELOW the __rdp__ group iff hiddenIds.size > 0; header chip mirrors the pinned/RDP chip (EyeOff glyph + uppercase label + gradient rule + ChevronRight/ChevronDown caret); starts collapsed on every mount"
    - "Mobile swipe on an AMBIENT (non-active-set, non-RDP) row reveals a Hide button in the same swipe strip Deactivate uses on active-set rows; swipe on a row inside the expanded Hidden section reveals Show"
    - "Selecting a row whose id is in hiddenIds (handleRowSelect) auto-unhides it before routing"
    - "Hidden state survives page reload — hydrated on mount by the same fleet-loaded-gated effect that hydrates pinnedIds"
  artifacts:
    - path: "src/backend/database/db/schema.ts"
      provides: "hiddenConversationIds TEXT column on userPreferences (Drizzle)"
      contains: "hiddenConversationIds: text(\"hidden_conversation_ids\")"
    - path: "src/backend/database/db/index.ts"
      provides: "addColumnIfNotExists migration for hidden_conversation_ids"
      contains: "hidden_conversation_ids"
    - path: "src/backend/database/routes/user-preferences.ts"
      provides: "GET+PUT read/write for hiddenConversationIds — mirror of pin path (parse, validate, 1000-cap, JSON echo)"
      exports: ["handleGetPreferences", "handlePutPreferences"]
    - path: "src/backend/database/routes/user-preferences.test.ts"
      provides: "hidden-branch tests mirroring PIN 1-10 + REG 1-3"
    - path: "src/ui/api/user-preferences-api.ts"
      provides: "getHiddenIds / putHiddenIds wrappers (mirror of getPinnedIds/putPinnedIds)"
      exports: ["getHiddenIds", "putHiddenIds"]
    - path: "src/ui/state/conversation-store.ts"
      provides: "state.hiddenIds Set + hideConversation/unhideConversation/toggleHideConversation/hydrateHiddenIdsFromServer + useHiddenIds hook + snapshot filter that removes hidden ids from activeSet/pinned/grouped tiers"
      exports: ["hideConversation", "unhideConversation", "toggleHideConversation", "hydrateHiddenIdsFromServer", "useHiddenIds"]
    - path: "src/ui/features/pretty-conversations/HideAction.tsx"
      provides: "Mobile swipe button component (visual twin of DeactivateAction; renders EyeOff for hide / Eye for show)"
      exports: ["HideAction"]
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "hidden prop + onToggleHide prop; context menu Hide/Show item; mobile swipe strip HideAction wiring on ambient + hidden rows"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "hiddenIds filter of active/pinned/grouped; Hidden section below __rdp__ group; togglePinConversation/togglePinConversation orchestration (mutual exclusion); handleRowSelect auto-unhide; hide-implies-deactivate composition"
    - path: "src/ui/features/pretty-conversations/pretty-conversations.css"
      provides: ".pv-hide-action visual (mirror of .pv-deactivate-action treatment) + .pv-hidden-section container styling"
  key_links:
    - from: "src/ui/state/conversation-store.ts::pinConversation"
      to: "hiddenIds via panel-level orchestration in togglePinConversation handler"
      via: "panel handler removes id from hiddenIds before delegating to togglePinConversation"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx::handleRowSelect"
      to: "unhideConversation"
      via: "if (hiddenIds.has(row.id)) unhideConversation(row.id) BEFORE routing"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx::onToggleHide (active-set row)"
      to: "handleRowDeactivate(row) THEN hideConversation(row.id)"
      via: "hide-implies-deactivate composition when activeSet.has(row.id)"
    - from: "src/backend/database/routes/user-preferences.ts::PUT"
      to: "src/ui/api/user-preferences-api.ts::putHiddenIds echo verification"
      via: "response body { hiddenConversationIds: string[] } (parsed array, mirror of pinned echo)"
---

<objective>
Add a per-Skynet-account **Hide** feature for conversations. New `hiddenConversationIds` column on `user_preferences` mirrors `pinnedConversationIds` byte-for-byte end-to-end. Panel renders a collapsed **Hidden** section at the bottom (below the `__rdp__` group) that is gated on non-empty. Context menu gains a Hide/Show item between Pin/Unpin and Deactivate; mobile swipe reveals Hide on ambient rows and Show on hidden rows. Mutual exclusion with pin (Hide auto-unpins; Pin auto-unhides). Hide on an active-set row auto-closes its tab first via the existing Deactivate path.

Purpose: Ashley wants to declutter the pretty-conversations panel per Skynet account without permanently deactivating agents. Hidden rows should stay recoverable via the collapsible section — same durability model as pinning (server-backed, cross-device via the account's row in `user_preferences`).

Output: New DB column + route field + client API wrappers + store slice + panel section + row prop/menu-item + HideAction component + full test coverage mirroring the pinned test suite.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/backend/database/db/schema.ts
@src/backend/database/db/index.ts
@src/backend/database/routes/user-preferences.ts
@src/backend/database/routes/user-preferences.test.ts
@src/ui/api/user-preferences-api.ts
@src/ui/state/conversation-store.ts
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/DeactivateAction.tsx
@src/ui/features/pretty-conversations/PinAction.tsx
@src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
@src/ui/features/pretty-conversations/tokens.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend — schema + migration + route + tests (mirror pinnedConversationIds byte-for-byte)</name>
  <files>src/backend/database/db/schema.ts, src/backend/database/db/index.ts, src/backend/database/routes/user-preferences.ts, src/backend/database/routes/user-preferences.test.ts</files>
  <behavior>
    - GET /user-preferences returns `hiddenConversationIds: []` when no row exists for user
    - GET returns `hiddenConversationIds: []` when the column is NULL
    - GET returns the parsed string[] when the column holds valid JSON (e.g. `["id1","id2","id3"]`)
    - PUT with valid string[] persists `JSON.stringify(ids)` to the `hidden_conversation_ids` TEXT column
    - PUT response body echoes `hiddenConversationIds` as a parsed ARRAY (not the raw JSON string) — the frontend's optimistic reconciliation depends on this
    - PUT with `[]` persists `"[]"` (unhide-all is a legal state)
    - PUT with a non-array returns 400 `{ error: "hiddenConversationIds must be an array of strings" }`
    - PUT with a non-string element returns 400 same error message
    - PUT with length > 1000 returns 400 `{ error: "hiddenConversationIds exceeds max length of 1000" }`
    - PUT round-trip: after PUT with `["x","y"]`, GET returns `["x","y"]`
    - Regressions: existing pinnedConversationIds branches (PIN 1-10) and reopenTabsOnLogin/theme/empty-body 400 branches all continue to pass
    - Both hidden AND pinned may be PUT in the same request body; each is validated independently and persisted independently
  </behavior>
  <action>
    Add hidden-conversation storage that is a byte-for-byte mirror of the existing pinned path. Do NOT refactor the pin path into a shared helper — mirror the code inline to keep the diff atomic and to match tina's "just add the column, don't refactor" preference on Phase 15 follow-ups.

    Files:

    (1) `src/backend/database/db/schema.ts` — In the `userPreferences` sqliteTable at ~L737, add a new column immediately AFTER `pinnedConversationIds`:
        `hiddenConversationIds: text("hidden_conversation_ids"),`

    (2) `src/backend/database/db/index.ts` — In `migrateSchema()` at ~L672-677, add a new line immediately AFTER the `pinned_conversation_ids` migration line:
        `addColumnIfNotExists("user_preferences", "hidden_conversation_ids", "TEXT");`
        Do NOT touch the `CREATE TABLE IF NOT EXISTS user_preferences` block at L527 — that block predates the pinnedConversationIds column too and both columns rely on `addColumnIfNotExists` for existing installs. Fresh installs pick up the column via `addColumnIfNotExists` running against the newly-created table (the existing pinnedConversationIds pattern confirms this works).

    (3) `src/backend/database/routes/user-preferences.ts` — Mirror every pinned code path:
        - Add a `HIDDEN_CONVERSATION_IDS_MAX_LENGTH = 1000` const next to `PINNED_CONVERSATION_IDS_MAX_LENGTH`
        - Add a `parseHiddenConversationIds()` helper that is a verbatim structural mirror of `parsePinnedConversationIds()` (same silent-catch, same non-array/non-string-element defenses)
        - Extend `pickPreferences()` to include `hiddenConversationIds: parseHiddenConversationIds(row?.hiddenConversationIds)`
        - In `handlePutPreferences()`, destructure `hiddenConversationIds` from the body alongside `pinnedConversationIds`, then add a validation+serialization block that is a verbatim structural mirror of the pinned block (non-array → 400, non-string element → 400, length > cap → 400, else `updates.hiddenConversationIds = JSON.stringify(hiddenConversationIds)`)
        - Update the openapi block comments on both GET and PUT to include `hiddenConversationIds` in the properties schema (same shape as pinnedConversationIds)

    (4) `src/backend/database/routes/user-preferences.test.ts` — Extend the in-memory Row type with `hiddenConversationIds: string | null` (mirror the pinned field). Add a new describe block `describe("handleGetPreferences: hiddenConversationIds branches", ...)` with 3 tests (HIDE 1-3) that mirror PIN 1-3. Add `describe("handlePutPreferences: hiddenConversationIds branches", ...)` with 7 tests (HIDE 4-10) that mirror PIN 4-10 verbatim except operating on `hiddenConversationIds`. Add ONE cross-field test: `PUT with BOTH pinnedConversationIds AND hiddenConversationIds in the same body persists both, response echoes both as parsed arrays` (this is a load-bearing test — it protects against a copy-paste refactor that accidentally coupled the two fields).

    Do NOT touch `docker/nginx.conf` or `docker/nginx-https.conf` — the `/user-preferences` location blocks already exist in both (confirmed via grep during planning), and no new route is being added.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/backend/database/routes/user-preferences.test.ts 2>&amp;1 | tee /tmp/tgg-t1-vitest.log &amp;&amp; npm run build:backend 2>&amp;1 | tee /tmp/tgg-t1-be.log &amp;&amp; npm run build 2>&amp;1 | tee /tmp/tgg-t1-fe.log &amp;&amp; grep -E "FAIL|failed|✗|error TS" /tmp/tgg-t1-vitest.log /tmp/tgg-t1-be.log /tmp/tgg-t1-fe.log | grep -v -E "^[^:]+:[0-9]+ passed|0 failed" || echo "TASK1_CLEAN"</automated>
  </verify>
  <done>
    - New `hiddenConversationIds` column exists on the `userPreferences` Drizzle table and in the `migrateSchema()` SQLite migration path
    - GET returns `hiddenConversationIds: string[]` (empty array when null/missing) alongside `pinnedConversationIds`
    - PUT validates + persists + echoes `hiddenConversationIds` with the same 400 semantics as pinnedConversationIds (non-array, non-string element, >1000)
    - `user-preferences.test.ts` gains 11 new hidden-branch tests (3 GET + 7 PUT + 1 cross-field) + zero regressions in PIN/REG tests
    - `npx vitest run src/backend/database/routes/user-preferences.test.ts` shows all tests green
    - Both `npm run build:backend` AND `npm run build` succeed with zero TS errors
    - Post-run grep gate confirms no FAIL/failed/✗/error TS in any log (TASK1_CLEAN emitted)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Frontend store + API + panel filter + Hidden section (mirror pinnedIds slice; panel-level orchestration)</name>
  <files>src/ui/api/user-preferences-api.ts, src/ui/state/conversation-store.ts, src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx, src/ui/features/pretty-conversations/pretty-conversations.css</files>
  <behavior>
    - `getHiddenIds()` returns `string[]` from `response.data.hiddenConversationIds`, silent `[]` fallback for non-arrays or non-string elements
    - `putHiddenIds(ids)` PUTs `{ hiddenConversationIds: ids }`, warns on echo divergence (mirror of putPinnedIds SC6 scaffold), returns echoed array
    - `hideConversation(id)` adds id to `state.hiddenIds`, calls `void putHiddenIds([...next])`, notifies
    - `unhideConversation(id)` removes id, calls `void putHiddenIds([...next])`, notifies
    - `toggleHideConversation(id)` dispatches to hide/unhide
    - `hydrateHiddenIdsFromServer(ids)` replaces the set, same-content guard skips notify
    - `useHiddenIds()` React hook returns `ReadonlySet<string>` via useSyncExternalStore, stable identity across no-ops
    - `computeSnapshot()` (or a new derivation layer applied at snapshot time) filters `hiddenIds` OUT of the `activeSet`, `pinned`, and `grouped` tiers so hidden rows are removed from the three normally-visible tiers regardless of whether they still exist as openTabs / fleet sessions / pinnedIds. Hidden rows are NOT auto-pruned from `hiddenIds` even if their openTab / fleet session vanishes (unlike pinnedIds pruner) — Ashley may want to keep a stale hidden id so it re-hides if the session reappears.
    - Panel renders a new "Hidden" section BELOW the `__rdp__` group, gated on `hiddenIds.size > 0`. Header is a chip mirroring the pinned/RDP chip: EyeOff glyph (lucide) + uppercase "Hidden" label + gradient rule filler + right-side ChevronRight (collapsed) / ChevronDown (expanded) caret. Local `useState<boolean>(false)` for expand/collapse; collapsed by default on every mount (no persistence). Chip is a `<button>` with `aria-expanded` reflecting state.
    - When expanded, the Hidden section lists rows whose id is in `hiddenIds`, resolved from the panel's `activeSetRows ∪ pinned ∪ grouped` pre-filter source (i.e. resolve to the row object BEFORE the hiddenIds filter is applied). Each hidden row passes `hidden={true}` to the row component and gets `onToggleHide={() => togglePin/hide-safe handler}` (see Task 3 for row prop plumbing).
    - Panel's `togglePinConversation` handler (renamed to a local `handleTogglePin(row.id)`) removes id from `hiddenIds` first (`unhideConversation(row.id)` if `hiddenIds.has(row.id)`) THEN calls the store's `togglePinConversation(row.id)`. This enforces the mutual-exclusion rule at the panel, not the row (row stays a dumb consumer).
    - Panel's `handleRowSelect(row)` gains a first-line check: `if (hiddenIds.has(row.id)) unhideConversation(row.id);` BEFORE the existing rdp/fleet/select routing. Opening a hidden row auto-unhides it.
    - Panel's mount-hydration effect (currently at ~L248-265) fetches `getHiddenIds()` in parallel with `getPinnedIds()` and calls `hydrateHiddenIdsFromServer(ids)` on success. Same fleet-loaded gate, same silent-catch, same `hydratedRef` dedupe (extend the ref to a `{ pin: boolean; hidden: boolean }` object OR add a sibling `hiddenHydratedRef` — either shape is fine; comment which and why).
    - Test coverage added to `PrettyConversationsPanel.test.tsx`: (a) Hidden section not rendered when `hiddenIds.size === 0`; (b) Hidden section renders with EyeOff+"Hidden" chip when `hiddenIds.size > 0`, collapsed by default (rows not in DOM); (c) clicking chip expands (rows in DOM, ChevronDown visible); (d) hidden ids are FILTERED OUT of active-set / pinned / grouped tiers; (e) mount-hydration fires `getHiddenIds()` and dispatches to `hydrateHiddenIdsFromServer`; (f) clicking Pin on a hidden row unhides it first then pins.
  </behavior>
  <action>
    (1) `src/ui/api/user-preferences-api.ts` — Add `getHiddenIds()` and `putHiddenIds()` as verbatim structural mirrors of `getPinnedIds()` and `putPinnedIds()`. Same silent-catch, same echo-divergence `console.warn("[hide-persistence] server echo mismatch", ...)` guard. Do NOT extract a shared helper — mirror the code so the diff is atomic and the pinned path is unchanged.

    (2) `src/ui/state/conversation-store.ts` — Mirror the pinnedIds slice:
        - Add `hiddenIds: Set<string>` to the `State` type at ~L148-186, initialised as `new Set<string>()` in the module `state` object at ~L188-197
        - Extend `SnapshotForTest` at ~L94-97 to include `hiddenIds: ReadonlySet<string>`
        - Add `hideConversation(id)` / `unhideConversation(id)` / `toggleHideConversation(id)` mirroring the pin/unpin/toggle exports at ~L818-863 — same fire-and-forget `void putHiddenIds([...next])` pattern with silent-catch
        - Add `hydrateHiddenIdsFromServer(ids: string[])` mirroring `hydratePinnedIdsFromServer` at ~L871-885 (same-content guard)
        - Add `useHiddenIds()` hook + `getHiddenIdsSnapshot()` mirroring `usePinnedIds` at ~L906-918
        - In the reset helper at ~L997-1001, reset `hiddenIds: new Set<string>()` alongside `pinnedIds`
        - In `computeSnapshot()` (find via the existing pinnedIds tier partitioning), add a final derivation pass that filters `hiddenIds` OUT of the three emitted tiers (`activeSet`, `pinned`, `grouped[*].rows`). Do this AFTER all existing tier logic so it acts as a final render-time filter — hidden rows are still in `openTabs` and can still be operated on via store APIs, they just don't render in the three normally-visible tiers. Groups whose `rows` collapse to `[]` after the filter are dropped from the emitted `grouped` (mirror the pinned-bounty filter's drop-empty-groups behaviour in the panel).
        - Do NOT extend the openTabs pruner at ~L554-591 to touch `hiddenIds` — hidden ids are intentionally sticky across openTab churn (see behavior rule above).
        - Import `putHiddenIds` and `getHiddenIds` from `@/api/user-preferences-api` at the top alongside the existing pinned imports.

    (3) `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:
        - Import `EyeOff`, `Eye`, `ChevronRight`, `ChevronDown` from `lucide-react` (extend the existing lucide import at ~L43)
        - Import `useHiddenIds`, `hideConversation`, `unhideConversation`, `toggleHideConversation`, `hydrateHiddenIdsFromServer` from `@/state/conversation-store`; import `getHiddenIds` from `@/api/user-preferences-api`
        - Subscribe: `const hiddenIds = useHiddenIds();`
        - In the mount-hydration effect at ~L248-265, add a parallel `getHiddenIds()` fetch + `hydrateHiddenIdsFromServer` dispatch inside the same async IIFE (either `await Promise.allSettled([getPinnedIds(), getHiddenIds()])` and dispatch each result independently, OR two sequential try/catches inside the IIFE). Preserve the silent-catch semantics — a network failure on either fetch must NOT prevent the other from succeeding.
        - Add local `const [hiddenExpanded, setHiddenExpanded] = useState(false);` — collapsed by default per Ashley's lock
        - Compute the resolved list of hidden rows for the Hidden section: `const hiddenRows = useMemo(() => { const all = [...activeSetRows, ...pinned, ...grouped.flatMap(g => g.rows)]; const seen = new Set<string>(); const out: ConversationRowShape[] = []; for (const r of all) { if (hiddenIds.has(r.id) && !seen.has(r.id)) { seen.add(r.id); out.push(r); } } return out; }, [activeSetRows, pinned, grouped, hiddenIds]);` — resolves against the PRE-filter tiers (see store note in behavior)
        - Rewrite `handleRowSelect` at ~L416-431 to add a first-line `if (hiddenIds.has(row.id)) unhideConversation(row.id);` BEFORE the mobile-swipe-close/addToActiveSet/branch dispatch. This is the "opening a hidden row auto-unhides" behavior.
        - Add a panel-level `handleTogglePin(rowId: string)` helper that: `if (hiddenIds.has(rowId)) unhideConversation(rowId); togglePinConversation(rowId);` — mutual exclusion, panel-level orchestration. Replace every `onTogglePin={() => togglePinConversation(row.id)}` call site (four sites at ~L649, L704, L761 rdp no-op leave alone, L807) with `onTogglePin={() => handleTogglePin(row.id)}`. The RDP row's `rdpNoopTogglePin` stays a no-op untouched.
        - Add a panel-level `handleToggleHide(row: ConversationRowShape)` helper: if the row is currently in the active-set (`activeSet.has(row.id)`), call `handleRowDeactivate(row)` FIRST (which fires `removeFromActiveSet` + `onDeactivateRow(row)` — the existing pretty-view close-tab path), THEN call `hideConversation(row.id)`. If the row is NOT in the active-set, call `hideConversation(row.id)` directly (no deactivate needed). If the row is already hidden (called from a Show button/menu), call `unhideConversation(row.id)` instead. Use one dispatcher: `handleToggleHide(row: ConversationRowShape) { if (hiddenIds.has(row.id)) { unhideConversation(row.id); return; } if (activeSet.has(row.id)) { handleRowDeactivate(row); } hideConversation(row.id); }`.
        - Thread the new `hidden` and `onToggleHide` props through every `<PrettyConversationRowLive>` call site (four render sites; matches the existing pattern of threading `pinned` and `onTogglePin`). For each row: `hidden={hiddenIds.has(row.id)} onToggleHide={() => handleToggleHide(row)}`. `PrettyConversationRowLive` (the micro-wrapper at ~L93) needs its prop signature extended to accept + forward these to `PrettyConversationRow` — mirror the existing `pinned` / `onTogglePin` forwarding pattern.
        - Add the new Hidden section AFTER the `displayedGrouped.map((group) => ...)` block at ~L822 but INSIDE the `<>` fragment. Structure:
          ```
          {hiddenRows.length > 0 && (
            <div className="pv-panel-group pv-hidden-section" data-hidden-group="true">
              <button type="button" className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full" data-testid="hidden-divider" aria-expanded={hiddenExpanded} onClick={() => setHiddenExpanded(v => !v)}>
                <EyeOff className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">Hidden</span>
                <span aria-hidden="true" className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]" />
                {hiddenExpanded ? <ChevronDown className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />}
              </button>
              {hiddenExpanded && hiddenRows.map(row => (
                <PrettyConversationRowLive
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  pinned={false}
                  hidden={true}
                  variant={variant}
                  onSelect={() => handleRowSelect(row)}
                  onTogglePin={() => handleTogglePin(row.id)}
                  onToggleHide={() => handleToggleHide(row)}
                  onSwipeOpenChange={isMobileVariant ? (open) => handleSwipeOpenChange(row.id, open) : undefined}
                  forceClosed={forceClosedFor(row.id)}
                  inActiveSet={activeSet.has(row.id)}
                  sessionKey={sessionWorkingKey(row)}
                  subtitleMode="identityTitle"
                />
              ))}
            </div>
          )}
          ```

    (4) `src/ui/features/pretty-conversations/pretty-conversations.css` — Add:
        - `.pv-hidden-section` container styling (mirror of `.pv-panel-group` — no unique treatment needed, existing group class handles gap)
        - The hidden-divider button already uses inline Tailwind for chip layout (same as pinned-divider); no new CSS for the chip itself needed
        - Optional: `.pv-hidden-section button[data-testid="hidden-divider"]:hover span { color: rgba(255,255,255,0.9); }` for hover feedback on the collapse-toggle chip

    (5) `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — Extend the `snapshot` mock helper to include `hiddenIds: Set<string>`; extend the mocked `useHiddenIds` / `hydrateHiddenIdsFromServer` / `hideConversation` / etc. Mock `getHiddenIds` from `@/api/user-preferences-api` alongside the existing `getPinnedIds` mock. Add a new describe block `describe("PrettyConversationsPanel: Hidden section (quick-260731-tgg)", ...)` with the 6 tests enumerated in the behavior block (a-f). Reuse existing mock scaffolding — do NOT rewrite the mock setup.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/ui/state/conversation-store 2>&amp;1 | tee /tmp/tgg-t2-vitest.log &amp;&amp; npm run build 2>&amp;1 | tee /tmp/tgg-t2-fe.log &amp;&amp; grep -E "FAIL|failed|✗|error TS" /tmp/tgg-t2-vitest.log /tmp/tgg-t2-fe.log | grep -v -E "^[^:]+:[0-9]+ passed|0 failed" || echo "TASK2_CLEAN"</automated>
  </verify>
  <done>
    - `getHiddenIds` / `putHiddenIds` exist in `user-preferences-api.ts`, are structural mirrors of the pinned wrappers, and console.warn on echo divergence
    - `state.hiddenIds` slice + `hideConversation` / `unhideConversation` / `toggleHideConversation` / `hydrateHiddenIdsFromServer` / `useHiddenIds` all exist and follow the pinnedIds patterns
    - `computeSnapshot()` filters hiddenIds OUT of activeSet / pinned / grouped tiers (verified by a store-level test in the vitest run)
    - Panel renders a collapsed Hidden chip (EyeOff + "Hidden" + gradient rule + ChevronRight) below the `__rdp__` group iff `hiddenIds.size > 0`; expanding shows the rows and swaps the chevron to ChevronDown
    - Panel's mount-hydration effect fetches hiddenIds in parallel with pinnedIds under the same fleet-loaded gate
    - `handleRowSelect` auto-unhides before routing; `handleTogglePin` unhides then pins; `handleToggleHide` on active-set rows deactivates FIRST then hides
    - 6 new panel tests pass; all existing panel tests still pass (regression-clean)
    - `npm run build` succeeds with zero TS errors
    - Post-run grep gate confirms no FAIL/failed/✗/error TS in any log (TASK2_CLEAN emitted)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Row wiring — context menu Hide/Show + mobile swipe HideAction + row prop plumbing + tests + full-suite sweep</name>
  <files>src/ui/features/pretty-conversations/HideAction.tsx, src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/pretty-conversations.css, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    - New `HideAction` component renders `<EyeOff />` when the row is not hidden (Hide affordance) and `<Eye />` when the row is hidden (Show affordance). Same dumb-visual contract as `DeactivateAction`: props are `hue`, `size: "mobile" | "desktop"`, `hidden: boolean`, `onClick`, `data-testid`. Uses `.pv-hide-action` CSS class with `data-size` variant, mirroring `.pv-deactivate-action`'s treatment (bare glyph, no filled pill). Uses hue=4 (red-orange) OR a distinct hue chosen to visually differentiate from Deactivate — pick a neutral gray (`.pv-hide-action` gets a `color: var(--color-pv-fg-muted)` treatment) so Hide reads as "less destructive than Deactivate but still a removal action". No motion, no animation.
    - `PrettyConversationRow` gains `hidden: boolean` and `onToggleHide?: () => void` props. Passed through from `PrettyConversationRowLive` in the panel.
    - Context menu items (~L571-584): Hide/Show item is inserted BETWEEN the Pin/Unpin item and the Deactivate item. Label is `"Hide"` when `!hidden`, `"Show"` when `hidden`. Only rendered when `onToggleHide` is provided (RDP rows never get it — `PrettyConversationContextMenu` only opens for non-RDP rows already). Non-`danger` styling (Hide is not destructive; Deactivate is the destructive action).
    - Mobile swipe strip (~L402-422): the Hide button appears in the same strip that currently hosts PinAction (+ DeactivateAction when in active-set). Placement rules:
        - AMBIENT rows (non-active-set, non-RDP, non-hidden): strip contains `[PinAction, HideAction]` — no Deactivate (ambient rows can't be deactivated). HideAction shows the Hide affordance (EyeOff).
        - ACTIVE-SET rows (non-RDP, non-hidden): strip contains `[PinAction, DeactivateAction]` verbatim — swipe stays Deactivate, per design lock ("to hide an active-set row on mobile, long-press → context menu → Hide"). NO HideAction in the swipe strip here.
        - HIDDEN rows (rendered inside the expanded Hidden section, mobile): strip contains `[HideAction]` only — showing the Show affordance (Eye). No Pin, no Deactivate (a hidden row is already excluded from active-set and pinned by the store filter).
    - Desktop context menu: Hide/Show item works on every non-RDP row (ambient, active-set, hidden alike) — mobile long-press path routes through the same menu.
    - `PC_SWIPE_REVEAL` (currently 132px in `tokens.ts`) does NOT need to grow — ambient rows add HideAction and drop DeactivateAction (same 2-icon width as active-set), active-set rows are unchanged, hidden rows use only 1 icon (fits well within 132px).
    - Row-level tests added to `PrettyConversationsPanel.test.tsx` (extend the existing describe blocks or add a new `describe("PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)")`):
        (g) Context menu on a non-hidden row shows Hide between Pin/Unpin and Deactivate
        (h) Context menu on a hidden row shows Show in the same slot
        (i) Clicking Hide from context menu on an ambient row calls hideConversation only (no deactivate)
        (j) Clicking Hide from context menu on an active-set row triggers handleRowDeactivate FIRST then hideConversation (assert call order via mock)
        (k) Mobile swipe strip on an ambient row renders HideAction (EyeOff), no DeactivateAction
        (l) Mobile swipe strip on a hidden row (inside expanded Hidden section) renders HideAction (Eye)
        (m) Mobile swipe strip on an active-set row still renders DeactivateAction, NO HideAction (design lock — swipe stays Deactivate)
  </behavior>
  <action>
    (1) `src/ui/features/pretty-conversations/HideAction.tsx` — NEW file. Structural mirror of `DeactivateAction.tsx`:
        - Import `EyeOff` and `Eye` from `lucide-react`, `useTranslation` from `react-i18next`
        - Component `HideAction({ hue, size, hidden, onClick, "data-testid": dataTestId })` renders `<button type="button" className="pv-hide-action" data-size={size} data-hidden={hidden ? "true" : "false"} onClick={onClick} title={label} aria-label={label} data-testid={dataTestId ?? "hide-action"}>{hidden ? <Eye /> : <EyeOff />}</button>`
        - Label pulled from i18n: `t("nav.conversations.hide", { defaultValue: "Hide" })` / `t("nav.conversations.show", { defaultValue: "Show" })` depending on `hidden` prop
        - Block comment at top explaining the design-locked placement rules (ambient=swipe/EyeOff, active-set=NEVER-swipe-only-context-menu, hidden=swipe/Eye) and the "no animation, no motion" Phase 10 non-negotiable

    (2) `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:
        - Add `hidden: boolean` and `onToggleHide?: () => void` to the prop type (~L100-155). Document them in the same doc-comment style as `onDeactivate` / `pinned`.
        - Add `import { HideAction } from "./HideAction";` alongside the existing imports at ~L66-68
        - Add `onHideClick` callback near `onDeactivateClick` (~L304-310), same `e.stopPropagation()` + `onToggleHide?.()` shape
        - Add `hidden && "hidden"` to the `rowClassName` `cn(...)` call at ~L334-344 so CSS can key visual states off `.pv-row.hidden` if needed (not used in this task, but sets up the door for future work)
        - Mobile swipe strip at ~L402-422 — rewrite the strip's children to enforce the placement rules from behavior:
          ```
          {isMobile && !isRdp && (
            <div className="absolute top-0 right-0 bottom-0 flex items-center justify-center gap-3 z-0" style={{ width: `${PC_SWIPE_REVEAL}px` }} aria-hidden={!effectiveOpen}>
              {hidden ? (
                <HideAction hue={hue} size="mobile" hidden={true} onClick={onHideClick} />
              ) : (
                <>
                  <PinAction hue={hue} pinned={pinned} size="mobile" onClick={onPinClick} />
                  {inActiveSet ? (
                    <DeactivateAction hue={hue} size="mobile" onClick={onDeactivateClick} />
                  ) : (
                    onToggleHide && <HideAction hue={hue} size="mobile" hidden={false} onClick={onHideClick} />
                  )}
                </>
              )}
            </div>
          )}
          ```
        - Context menu at ~L571-584 — insert the Hide/Show item BETWEEN the existing Pin/Unpin push and the Deactivate conditional push:
          ```
          items.push({ label: pinned ? "Unpin" : "Pin", onClick: onTogglePin });
          if (onToggleHide) {
            items.push({ label: hidden ? "Show" : "Hide", onClick: onToggleHide });
          }
          if (inActiveSet && onDeactivate) {
            items.push({ label: "Deactivate", onClick: onDeactivate, danger: true });
          }
          ```

    (3) `src/ui/features/pretty-conversations/pretty-conversations.css` — Add `.pv-hide-action` styling as a structural mirror of `.pv-deactivate-action` (~L765-810), but use a neutral gray palette (`color: var(--color-pv-fg-muted)`) rather than the red-tinted deactivate palette. Include the `[data-size="mobile"]` and desktop hover-reveal variants (the desktop hover-reveal `.pv-row.pv-row--desktop:not(:hover):not(:focus-within) .pv-hide-action { display: none }` mirrors the pin's hover-reveal). Document in an inline comment that the "no hover-reveal on hidden rows because the whole row is inside a collapsed section" edge is inert (the section itself gates visibility).

    (4) `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — Add the 7 new tests (g-m) from the behavior block. Reuse the mocked snapshot / hide/show action mocks introduced in Task 2. Assert call order in test (j) via `vi.fn()` invocationCallOrder — `handleRowDeactivate` must be called before `hideConversation`.

    (5) End-of-task full-suite sweep:
        - Run `npx vitest run` (full suite, no filter) to catch any regression across the frontend test surface
        - Run `npm run build:backend && npm run build` (both, per tina's Phase 15 preference — backend files were touched in Task 1 and are still on the tree)
        - Apply the grep gate to every log file BEFORE trusting the "0 failed" summary: `grep -E "FAIL|failed|✗|error TS" /tmp/tgg-*.log | grep -v -E "^[^:]+:[0-9]+ passed|0 failed"` — tina's learned discipline
        - Commit the three tasks as ONE git commit (do NOT split — this is a single feature, atomic delivery). Follow the existing commit message style from `git log`. Sign with `-S` (do NOT skip signing). Do NOT `--no-verify`. Do NOT `git push`. Do NOT `docker build`. Do NOT `docker compose up --force-recreate`. STOP after commit.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run 2>&amp;1 | tee /tmp/tgg-t3-vitest-full.log &amp;&amp; npm run build:backend 2>&amp;1 | tee /tmp/tgg-t3-be.log &amp;&amp; npm run build 2>&amp;1 | tee /tmp/tgg-t3-fe.log &amp;&amp; grep -E "FAIL|failed|✗|error TS" /tmp/tgg-t3-vitest-full.log /tmp/tgg-t3-be.log /tmp/tgg-t3-fe.log | grep -v -E "^[^:]+:[0-9]+ passed|0 failed|\s0 failed" || echo "TASK3_CLEAN"</automated>
  </verify>
  <done>
    - `HideAction.tsx` exists as a structural mirror of `DeactivateAction.tsx`, renders `EyeOff` when `!hidden` and `Eye` when `hidden`
    - `PrettyConversationRow` accepts + forwards `hidden` and `onToggleHide`; context menu inserts Hide/Show between Pin/Unpin and Deactivate
    - Mobile swipe strip renders per the design-locked matrix (ambient=Pin+Hide, active-set=Pin+Deactivate unchanged, hidden=Show only)
    - `.pv-hide-action` CSS class exists and mirrors `.pv-deactivate-action` structurally with a neutral-gray palette
    - 7 new row-wiring tests pass (g-m); test (j) asserts handleRowDeactivate-before-hideConversation call order
    - Full frontend suite `npx vitest run` passes clean (no regressions in any existing file)
    - Both `npm run build:backend` AND `npm run build` succeed with zero TS errors
    - Post-run grep gate confirms no FAIL/failed/✗/error TS in any log (TASK3_CLEAN emitted)
    - Single git commit created (signed, hook-enforced), no push, no docker actions
  </done>
</task>

</tasks>

<verification>
Post-execution verification (all tasks):

1. All three tasks report their CLEAN sentinel (`TASK1_CLEAN`, `TASK2_CLEAN`, `TASK3_CLEAN`) via their `<verify>` gate
2. `git log -1 --format=%H` returns a single new commit (three-task atomic delivery, per Task 3 action)
3. `git diff HEAD~1 --stat` shows changes ONLY to the files listed in `files_modified` frontmatter (11 files: 4 backend + 7 frontend + 1 CSS — HideAction.tsx is a new file, counted in the 7)
4. `grep -n "hiddenConversationIds\|hidden_conversation_ids" src/backend/database/db/schema.ts src/backend/database/db/index.ts src/backend/database/routes/user-preferences.ts` returns non-empty from all three files
5. `grep -n "useHiddenIds\|hideConversation\|hydrateHiddenIdsFromServer" src/ui/state/conversation-store.ts src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns non-empty from both files
6. `grep -n "HideAction" src/ui/features/pretty-conversations/PrettyConversationRow.tsx src/ui/features/pretty-conversations/HideAction.tsx` returns non-empty from both files
7. `grep -c "Hide\|Show" src/ui/features/pretty-conversations/PrettyConversationRow.tsx | grep -v "^0$"` — Hide/Show tokens appear in the context menu items
8. No changes to `docker/nginx.conf` or `docker/nginx-https.conf` (git diff shows these files untouched — new column, no new route)
9. No changes to `~/.claude/identities/*` (executor stays in-repo)
10. No `git push`, no `docker build`, no `docker compose up --force-recreate` in the shell history for this session (executor STOPPED after commit)
</verification>

<success_criteria>
- New `hidden_conversation_ids` TEXT column exists on `user_preferences`; migration is idempotent (existing DBs pick it up via `addColumnIfNotExists`)
- GET/PUT /user-preferences fully symmetric with pinnedConversationIds: 400 branches for non-array, non-string element, and >1000; response body echoes parsed array
- 11 new backend tests + 13 new frontend tests (6 Task-2 + 7 Task-3) pass; zero regressions in existing pin/panel/row tests
- Panel renders collapsed Hidden section BELOW the `__rdp__` group only when hiddenIds is non-empty; expands via click on chip; chip mirrors pinned/RDP treatment (EyeOff + uppercase label + gradient rule) with an added ChevronRight/ChevronDown caret
- Context menu shows Hide/Show item between Pin/Unpin and Deactivate on every non-RDP row
- Mobile swipe: ambient → Pin+Hide, active-set → Pin+Deactivate (unchanged, no Hide on swipe here — long-press for menu), hidden → Show only
- Mutual exclusion enforced at the panel: Hide auto-unpins, Pin auto-unhides
- Hide on an active-set row auto-fires Deactivate FIRST (closes the tab via the existing onDeactivate path) THEN flips hidden
- Opening (selecting) a hidden row auto-unhides it before routing
- Hidden state persists across page reload (server-backed, hydrated on mount under the same fleet-loaded gate as pinnedIds)
- Both `npm run build:backend` and `npm run build` succeed
- Full frontend test suite passes; grep gate applied to every log confirms no FAIL/failed/✗/error TS lines
- Single signed git commit (no push, no docker actions)
</success_criteria>

<output>
Create `.planning/quick/260731-tgg-add-per-skynet-account-hide-feature-for-/260731-tgg-SUMMARY.md` when done, following `$HOME/.claude/get-shit-done/templates/summary.md`.
</output>
