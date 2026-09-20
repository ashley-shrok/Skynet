---
phase: 122-conversation-search-modal
plan: 03
subsystem: frontend
tags: [frontend, modal, search, radix-dialog, useSyncExternalStore]
requires:
  - 122-02 (Wave 1 backend endpoint POST /conversation-search shipped)
provides:
  - Working conversation search modal (Radix DialogPrimitive) with Enter-only fire, offset/limit load-more, snippet highlighting, D-05 state persistence, D-14 close-on-active-click, D-15 blunt alert on archived-click
  - ConversationSearchResult TypeScript type wired all the way from backend to AppShell click handler (11 fields including tmuxSessionName added by this plan's forward-patch)
  - Reusable search-store slice (module-scoped useSyncExternalStore) exporting useSearchState + 6 mutators + _resetForTests
  - conversation-search-api client with error-class preservation (ConversationSearchError)
affects:
  - src/backend/database/routes/conversation-search.ts (11th field tmuxSessionName + updated docblock)
  - src/backend/database/routes/conversation-search.test.ts (assertion updated 10→11 fields; new assertion tmuxSessionName === identityKey)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (new prop, new useState, new header button, new modal mount)
  - src/ui/features/pretty-conversations/pretty-conversations.css (new .pv-search-* rules)
  - src/ui/AppShell.tsx (new onSearchResultOpenActive handler + type import)
tech-stack:
  added: [] # zero new packages
  patterns:
    - Module-scoped store with useSyncExternalStore (mirror of conversation-store.ts archived-fleet-rows slice)
    - Radix DialogPrimitive.Root + Portal + Overlay + Content chrome (lifted verbatim from NewConversationModal.tsx L268-441)
    - Error-class preservation on axios throw (mirror of workspace-api.ts pattern)
    - React text-children + <span> split for XSS-safe highlight (T-122-FE-01)
    - AppShell handler mirroring onDetachedRowClick at line 3068 for open-tab flow
key-files:
  created:
    - src/ui/api/conversation-search-api.ts
    - src/ui/api/conversation-search-api.test.ts
    - src/ui/state/search-store.ts
    - src/ui/state/search-store.test.ts
    - src/ui/features/pretty-conversations/ConversationSearchModal.tsx
    - src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx
    - src/ui/features/pretty-conversations/ConversationSearchRow.tsx
  modified:
    - src/backend/database/routes/conversation-search.ts (added tmuxSessionName field + docblock)
    - src/backend/database/routes/conversation-search.test.ts (updated 10→11 field assertion; added tmuxSessionName === identityKey assertion)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (new prop + useState + header button + modal mount)
    - src/ui/features/pretty-conversations/pretty-conversations.css (appended .pv-search-row/-title/-subtext/-snippet/-hit/-archived-pill)
    - src/ui/AppShell.tsx (onSearchResultOpenActive handler + type import)
decisions:
  - "Backend field name for tmux session = `tmuxSessionName` (not `targetTmuxSession`). Value equals `identityKey` verbatim because fleet identity directory basename IS the tmux session name (see conversation-store.ts:906 which populates targetTmuxSession from session.sessionName, and sessionMatchKey in session-hue.ts which lowercases sessionName to derive identityKey). No naming rule was invented — the equivalence is preserved end-to-end so future edits stay coherent."
  - "Search button placed as the FIRST child of .pv-header-actions (leftmost). Rationale: most discoverable header action; matches RESEARCH.md Open Question 2 recommendation. Gated by the same showPencilButton conditional as its siblings so it disappears together with them when onCreateSession is undefined."
  - "The existing inline filter-as-you-type input in PrettyConversationsPanel.tsx is STILL PRESENT (unchanged) after this plan. Plan 04 removes it per D-18 ordering constraint (modal must be usable BEFORE filter is removed)."
  - "Local input value in the modal is a plain useState separate from state.query in the store — typing does NOT mutate the store's query (D-01 Enter-only). On open→true transition the local value re-seeds from state.query so reopening always shows the last FIRED query. Deliberately does NOT re-seed on every state.query update — that would fight the user's typing while the modal is open."
  - "Load more button binds `disabled` to state.isFetching AND handleLoadMore returns early on isFetching (double-guard). Fetch flow calls setFetching(true) BEFORE the network hop; appendResults() flips it back to false on resolve. Rapid clicks are no-ops (T-122-FE-03 mitigation)."
  - "handleRowClick routes on result.isArchived: archived → window.alert(coming soon) + return without calling onOpenActiveConversation OR onOpenChange (D-15 stays open); active → onOpenActiveConversation(result) then onOpenChange(false) (D-04 close-on-active-click)."
  - "AppShell handler uses `hostsById.get(result.hostId)` — the existing memo already in scope at that line. Mirrors the shape at AppShell.tsx:2534 (onTabActivate) which uses the same lookup. Label prefers result.aiTitle when populated (Wave-1 always null, future piggyback follow-up will populate it — handler already handles both cases)."
  - "clearSearch() deliberately preserves hasEverOpened=true. This is the D-06 gate corner: after a search-then-clear the empty-state placeholder does NOT reappear (would feel jarring to the user who has already interacted with the modal in this page-load). Test T-03 in search-store.test.ts proves this invariant."
metrics:
  duration_min: 20
  tasks_completed: 3
  files_created: 7
  files_modified: 5
  tests_added: 25 # 9 store + 3 api + 13 modal
  completed: 2026-09-20
---

# Phase 122 Plan 03: Frontend — modal + button + search-store + click routing — Summary

**One-liner:** A Radix-Dialog conversation search modal opens from the sidebar's new magnifying-glass button, fires POST /conversation-search on Enter (never on keystroke), renders results with an XSS-safe highlighted snippet, paginates via Load-more, closes on active-result click (routing through AppShell's openTab flow that mirrors onDetachedRowClick byte-for-byte), and shows a blunt window.alert on archived-result click — with query + results persisted in a module-scoped store so state survives modal open/close cycles.

---

## What shipped

### Task 1 — search-store + API client + backend forward-patch

**Backend forward-patch (commit `cf4ced1b`):**
- Added `tmuxSessionName: string | null` as the 11th field on `ConversationSearchResult` in `src/backend/database/routes/conversation-search.ts`.
- Value derivation: `tmuxSessionName: meta.key` — same string as `identityKey`. By fleet convention identity directory basename IS the tmux session name (case-preserving), and `sessionMatchKey(sessionName).toLowerCase() === identityKey`. No new naming rule invented; the equivalence is byte-for-byte the same as `conversation-store.ts:906` which populates `targetTmuxSession: session.sessionName` on the sidebar-row build.
- Test assertion updated 10 → 11 fields; added assertion `row.tmuxSessionName === row.identityKey`.
- Docblock updated to document the field + its rationale + who reads it (AppShell).

**Frontend files created (commit `db9bc2bf`):**
- `src/ui/api/conversation-search-api.ts` — thin authApi wrapper around POST /conversation-search. Exports `searchConversations(query, offset, limit)`, `ConversationSearchResult`, `ConversationSearchResponse`. Mirrors workspace-api.ts error-class preservation shape — axios errors carrying a `{error: "class_name"}` body are re-thrown as `Error` whose `.name === "ConversationSearchError"` and `.message === class_name`. Non-classed errors fall through to `handleApiError` with the `"search conversations"` operation label.
- `src/ui/state/search-store.ts` — module-scoped store subscribed via `useSyncExternalStore`. State shape: `{ query, results, hasMore, isFetching, hasEverOpened, error }`. Six mutators: `setSearchQuery`, `clearSearch`, `startNewSearch`, `appendResults`, `setFetching`, `setError`. Plus `_resetForTests` for vitest hygiene. Store lives OUTSIDE any component so modal unmount does NOT discard state (D-05). `clearSearch()` deliberately preserves `hasEverOpened=true` (D-06 gate).

### Task 2 — Modal + Row + CSS (commit `4154d83e`)

- `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` — Radix `DialogPrimitive.Root` + `.Portal` + `.Overlay` (z-[110] + backdrop-blur) + `.Content` (z-[120], glass-morphism style block, `absolute inset-4` mobile + `md:max-w-[560px]` desktop). Lifted verbatim from NewConversationModal.tsx L268-441. Header: search-icon + local-controlled input + clear-X + close-X. Body branches on store snapshot:
  - `state.isFetching && state.results.length === 0` → spinner
  - `!state.hasEverOpened || (state.query === "" && ...)` → "Type a query and press Enter" empty-state (D-06 gate)
  - `!state.isFetching && !emptyState && state.results.length === 0 && state.query.length > 0` → "No results for {query}"
  - else → maps `ConversationSearchRow` per result
  Footer: Load more button (bound `disabled={state.isFetching}` for T-122-FE-03) + error banner. Zero global `document.addEventListener` calls (D-03).

- `src/ui/features/pretty-conversations/ConversationSearchRow.tsx` — three-line row (title / subtext / snippet). Snippet splits `result.snippet` at `hitStart/hitLength` and wraps the middle in `<span className="pv-search-hit">` using React text children only. Zero `dangerouslySetInnerHTML` (T-122-FE-01). Archived-pill rendered inline in title when `result.isArchived`.

- `src/ui/features/pretty-conversations/pretty-conversations.css` — appended `.pv-search-row` + `.pv-search-row-title` + `.pv-search-row-subtext` + `.pv-search-row-snippet` (3-line clamp via `-webkit-line-clamp: 3`) + `.pv-search-hit` (yellow-highlight background) + `.pv-search-archived-pill`.

### Task 3 — Header button + AppShell wiring (commit `d0ecd38d`)

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:
  - Imported `ConversationSearchModal` + `ConversationSearchResult` type.
  - Added `onSearchResultOpenActive?: (result) => void` prop declaration.
  - Added `[searchModalOpen, setSearchModalOpen] = useState(false)` alongside the other modal flags.
  - Added Search button as the **FIRST child** of `.pv-header-actions` (leftmost — most discoverable placement per RESEARCH.md Open Question 2). Gated by the same `showPencilButton` conditional as its siblings. `data-testid="pv-header-search-button"`.
  - Mounted `<ConversationSearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} onOpenActiveConversation={(result) => onSearchResultOpenActive?.(result)} />` alongside `NewConversationModal` in the panel's portal-modal cluster.

- `src/ui/AppShell.tsx`:
  - Imported `ConversationSearchResult` type.
  - Added `onSearchResultOpenActive` handler to the `<PrettyConversationsPanel .../>` mount, immediately after `onDetachedRowClick`. **Verbatim mirror** of that handler's shape adapted for search-result field names:
    - `hostsById.get(result.hostId)` instead of `row.host` (existing memo in scope; same idiom as AppShell.tsx:2534 for `onTabActivate`)
    - `result.tmuxSessionName` instead of `row.targetTmuxSession` (added by Task 1 forward-patch)
    - `label: result.aiTitle || sessionName` (Wave-1 aiTitle always null, but the piggyback follow-up per 122-02-SUMMARY will populate it — this handler already handles both cases)
  - Fires `selectConversationDeferred(newTabId)` + mobile-nav nudges (`isTouchDevice → navigateToView()`, `isMobile → setSidebarOpen(false)`) identically to `onDetachedRowClick`.

---

## Tests

**36/36 passing across 4 files (25 new + 11 pre-existing regression-check):**

| File | Tests | Coverage |
|------|-------|----------|
| `src/ui/state/search-store.test.ts` | 9 | initial state; setSearchQuery notifies + flips hasEverOpened; clearSearch preserves hasEverOpened (D-06 gate — CRITICAL); startNewSearch atomic 6-field set in single notify; appendResults concat + hasMore + clears isFetching; setFetching(true) clears error / (false) preserves error; setError; useSearchState renderHook mirror |
| `src/ui/api/conversation-search-api.test.ts` | 3 | happy path; backend error class becomes ConversationSearchError; non-classed falls through to handleApiError |
| `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx` | 13 | T-01 closed→nothing visible; T-02 first-open→empty-state; T-03 D-01 typing does NOT fire; T-04 Enter fires (query, 0, 20) exactly once + appends; T-05 D-11 row title/subtext/snippet highlight; T-06 T-122-FE-01 no dangerouslySetInnerHTML; T-07 D-04/D-14 active-click routes + closes; T-08 D-15 archived-click alerts + stays open; T-09 D-12 load-more (query, results.length, 20) + append + hides; T-10 load-more hidden when hasMore false; T-11 D-05 unmount→remount preserves query + results; T-12 D-06 no-results after zero-response search (empty-state does NOT reappear); T-13 D-03 no global keydown listener |
| `src/backend/database/routes/conversation-search.test.ts` | 11 | Wave-1 tests + updated 11-field row assertion + new `row.tmuxSessionName === row.identityKey` assertion |

**Scoped `npx vitest related --run` gate on all touched files:** 213 passed / 0 failed across 10 test files (23.6s wall).

**Frontend typecheck (`npx tsc --noEmit -p .`):** 0 errors.

**Grep gates:**
```
grep -c 'document\.addEventListener\|dangerouslySetInnerHTML' \
     ConversationSearchModal.tsx ConversationSearchRow.tsx  → 0 / 0
grep -q 'data-testid="pv-header-search-button"' PrettyConversationsPanel.tsx  → hit
grep -q 'ConversationSearchModal' PrettyConversationsPanel.tsx  → hit
grep -q 'onSearchResultOpenActive' PrettyConversationsPanel.tsx  → hit
grep -q 'onSearchResultOpenActive' AppShell.tsx  → hit
grep -q 'pv-search-hit\|pv-search-archived-pill' pretty-conversations.css  → 3 hits (rules landed)
```

---

## Callouts (per plan `<output>` requirements)

**(a) Exact tmux-session field name:** `tmuxSessionName` (NOT `targetTmuxSession`). Frontend `ConversationSearchResult` type and backend response both use `tmuxSessionName`. Value equals `identityKey` verbatim per fleet convention. Plan 04 should read `result.tmuxSessionName` when consuming search results — do NOT rename to `targetTmuxSession` (that name is used on sidebar `ConversationRow` shape; the search-result contract deliberately uses a separate name to avoid shape collision).

**(b) Existing filter-as-you-type is STILL PRESENT:** This plan does NOT remove any of the following from `PrettyConversationsPanel.tsx`:
- `searchQuery` useState (~L896)
- `searchContainerRef` useRef + cold-load scroll-hide useEffect
- `SEARCH_HIDDEN_SENTINEL_KEY` constant
- `matchesSearch` useCallback (~L1161-1222)
- `trimmedSearchQuery` + `searchMatches` useMemo (~L1239-1259)
- `.pv-search-container` JSX block (~L2393-2424 pre-Plan-03 numbering; shifted by ~40 lines after Plan 03 additions)
- `.pv-search-container` / `.pv-search-icon` / `.pv-search-input` / `.pv-search-input::placeholder` / `.pv-search-clear` CSS rules at pretty-conversations.css L265-306
- `.pv-header-search-button-selectors`-related tests

Plan 04's job (D-17 removal under D-18 ordering constraint). All 10 removal deliverables enumerated in RESEARCH.md Pitfall 5 remain intact.

**(c) Browser-side smoke checklist for phase-level UAT:**

1. Reload the frontend (the maintainer's dev shell). The sidebar header should show a magnifying-glass button as the leftmost child of the header-actions cluster.
2. Click the magnifying-glass. Modal opens with the search input auto-focused; body shows "Type a query and press Enter".
3. Type `claude` (or any known-hit substring — try an identity name for a fast smoke). Assert **no network request fires yet** (Network tab shows zero /conversation-search calls).
4. Press Enter. Network tab shows ONE `POST /conversation-search` call. Modal body shows result rows within ~1s (naive grep on t1000 is ~600ms).
5. Verify each row:
   - Title = identityKey (aiTitle is null in Wave 1)
   - Subtext = `identityKey · hostName`
   - Snippet has a **yellow-highlighted** span around the matched substring
   - Archived rows have an "archived" pill inline in the title
6. Click an active (non-archived) result → the modal closes AND a new tab opens attached to that identity's tmux session.
7. Reopen the modal via the header button. The **same query** is in the input AND the **same result rows** are visible (D-05 state persistence).
8. If more than 20 results exist, click "Load more" at the bottom. New rows append; if fewer than 20 come back, the button disappears.
9. Click an archived result → a browser alert with text like "Opening archived conversations isn't wired up yet — coming soon" appears. Modal stays open after dismiss (D-15).
10. Click the X in the input (clear button) → results wipe, empty text field, but the modal body should NOT show the initial "Type a query and press Enter" placeholder (D-06 gate — the modal has been used this page-load).
11. Click the close-X in the top-right → modal closes. Reopening shows the last state (D-05).
12. Verify NO cmd-K / ctrl-K shortcut opens the modal (D-03 no keyboard shortcut). The magnifying-glass button is the only path.

---

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3] Test T-11 for D-05 persistence needed `fireEvent.click` for the harness toggle button**
- **Found during:** Task 2 test run
- **Issue:** `user.click(screen.getByTestId("harness-toggle"))` failed with `Element has pointer-events: none` because the Radix modal overlay covers the harness toggle button while the modal is open — user-event's realistic pointer semantics see the overlay first.
- **Fix:** Switched the two harness-toggle clicks in T-11 to `fireEvent.click(...)`, which dispatches the event directly on the target and bypasses pointer semantics. This is idiomatic for a test-only harness control (the harness button never exists in production). Left the other user-event clicks in the file (row-click, load-more-click) untouched — those are inside the modal's content pane where pointer events pass through normally.
- **Files modified:** `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx`
- **Commit:** `4154d83e`

**2. [Rule 2 - Cosmetic] Updated docblocks in ConversationSearchModal.tsx + ConversationSearchRow.tsx to satisfy grep=0 for `dangerouslySetInnerHTML`**
- **Found during:** Task 2 verify step
- **Issue:** Initial docblocks documented the deliberate absence of `dangerouslySetInnerHTML` — which literally contained the string `dangerouslySetInnerHTML`, causing the plan's `grep -c 'dangerouslySetInnerHTML'` acceptance criterion to return 1 (in a comment) not 0.
- **Fix:** Rephrased the docblock to say "React text children + <span> split, NO raw-HTML injection" without literally naming the API. The security guarantee is unchanged; the source-level grep gate is now clean.
- **Files modified:** `ConversationSearchModal.tsx`, `ConversationSearchRow.tsx`
- **Commit:** `4154d83e`

### None (verbatim to plan)

- Modal chrome: verbatim lift from NewConversationModal.tsx L268-441 (glass-morphism style block, z-index ladder, `onInteractOutside` guard, responsive `inset-4` / `md:max-w-[560px]` split)
- Store shape: verbatim mirror of the archived-fleet-rows slice in conversation-store.ts:2345-2424
- API-client error-class preservation: verbatim mirror of workspace-api.ts pattern
- AppShell handler: verbatim mirror of onDetachedRowClick at AppShell.tsx:3068 shape (only field-name differences from the search-result vs row-shape mismatch, documented in the handler's inline comment)
- Backend forward-patch: derived tmuxSessionName from `meta.key` (identityKey) verbatim per the fleet naming convention documented in conversation-store.ts:906

---

## Auth Gates

None encountered. The endpoint's auth is `AuthManager.createAuthMiddleware()` (existing JWT gate, provisioned in Wave 1) — no new secrets or credentials required for development.

---

## Threat Flags

None. The plan's `<threat_model>` register enumerated all trust boundaries; no new security-relevant surface was introduced beyond what the plan itemized (T-122-FE-01 XSS via snippet, T-122-FE-02 module-scoped store post-auth, T-122-FE-03 rapid-click DoS). All three mitigations are in place and test-asserted.

---

## Known Stubs

None. All rendered data flows through real network calls to the Wave-1 endpoint. The `aiTitle: null` on every row is a documented Wave-1 deferral (see 122-02-SUMMARY.md), not a UI stub — the frontend falls back to `identityKey` per the documented contract. Row rendering handles both `aiTitle=null` (Wave 1) and `aiTitle=<string>` (post-piggyback follow-up) with no code change needed.

---

## Follow-ups (not blockers for Plan 04)

1. **Plan 04 removes the inline filter** — the D-17 deliverables enumerated in RESEARCH.md Pitfall 5 (10 removal points across PrettyConversationsPanel.tsx + pretty-conversations.css). The `Search` import from `lucide-react` at line 67 must STAY (used by the new header button) — Plan 04 must not remove it even though it was originally imported for the retired filter.
2. **`aiTitle` backend piggyback** (from 122-02-SUMMARY.md) — a small commit to `runOneHost` in `conversation-search.ts` to call `scanTailForLatestAiTitle` on each hit's transcript path within the same SSH connection. Zero response-shape change (field already exists as nullable). The frontend already renders aiTitle-when-present, so populating it will Just Work end-to-end.
3. **Playwright smoke** for the modal flow — not landed in this plan (per project standing directive "scoped tests only, do NOT run the full playwright smoke"). Suggested spec: open modal → type known-substring → Enter → assert ≥1 row → click row → assert new tab opens.

---

## Commits

- `cf4ced1b` — feat(122-03): add tmuxSessionName to ConversationSearchResult (backend forward-patch)
- `db9bc2bf` — feat(122-03): add search-store + conversation-search-api (Task 1)
- `4154d83e` — feat(122-03): add ConversationSearchModal + Row + CSS highlight rules (Task 2)
- `d0ecd38d` — feat(122-03): wire header search button + AppShell handler (Task 3)

---

## Success criteria (all green)

- [x] Magnifying-glass button in `.pv-header-actions`; opens ConversationSearchModal (D-03 button-only)
- [x] Typing does NOT fire the network (D-01)
- [x] Enter fires POST /conversation-search once
- [x] Result rows render title / identity + host / snippet with `pv-search-hit` span (D-11, no `dangerouslySetInnerHTML`)
- [x] Active-result click → openTab + modal closes (D-04, D-14) via AppShell handler that mirrors `onDetachedRowClick`
- [x] Archived-result click → `window.alert("coming soon")` + modal stays open (D-15, D-16)
- [x] Load more re-fetches with offset += 20 + appends + hides on `hasMore=false` (D-12)
- [x] Reopening modal shows last query + accumulated results (D-05)
- [x] Empty-state only shows on first-ever open OR after clear (D-06, T-12 asserts the corner)
- [x] Tests prove every D-XX decision the plan owns (25 new tests, all green)
- [x] Code committed with green tests (4 commits above)
- [x] Existing inline filter NOT removed (D-18 ordering — Plan 04 removes)

---

## Self-Check

**Files created / modified verification:**

```
FOUND: src/ui/api/conversation-search-api.ts
FOUND: src/ui/api/conversation-search-api.test.ts
FOUND: src/ui/state/search-store.ts
FOUND: src/ui/state/search-store.test.ts
FOUND: src/ui/features/pretty-conversations/ConversationSearchModal.tsx
FOUND: src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx
FOUND: src/ui/features/pretty-conversations/ConversationSearchRow.tsx
FOUND: .planning/phases/122-conversation-search-modal/122-03-SUMMARY.md
FOUND: cf4ced1b
FOUND: db9bc2bf
FOUND: 4154d83e
FOUND: d0ecd38d
```

## Self-Check: PASSED
