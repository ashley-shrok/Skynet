---
phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd
plan: 02
subsystem: ui
tags:
  - conversation-list
  - search
  - filter
  - one-shot-scroll
  - session-storage-sentinel

# Dependency graph
requires:
  - phase: 41
    plan: 01
    provides: three-zone ConversationList shape (activeSet, pinned, middle, rdpGroup) — the flatten-and-filter union consumes these fields
  - phase: 15
    provides: sessionStorage try/catch shape (ACTIVE_SET_STORAGE_KEY, only=1 guard) — SEARCH_HIDDEN_SENTINEL_KEY reuses the pattern verbatim
provides:
  - "Always-in-DOM search input at the top of `.pv-panel-scroll` — `<input type=\"search\">` inside `.pv-search-container` wrapper, present regardless of snapshot state"
  - "One-shot cold-load scroll-hide effect — `useEffect(() => {...}, [])` gated by `sessionStorage['pv-conv-search-hidden-once']` sentinel; fires exactly once per browser session; StrictMode double-mount / any future remount no-op on second run"
  - "sessionStorage sentinel key `pv-conv-search-hidden-once` — cleared by the store's `only=1` new-window opener guard alongside the existing `pv-conv-active-set` clear (T-42-02-01)"
  - "`matchesSearch(row, query)` predicate — label + sublabel case-insensitive substring match; reproduces PrettyConversationRow's identity + hostname resolution; no regex; no HTML"
  - "`searchMatches` useMemo — flat union of activeSet + pinned + middle + rdpGroup.rows filtered by matchesSearch; hidden rows EXCLUDED; deduplicated by row.id"
  - "Flat-match render branch — `data-search-flat-group=\"true\"` container renders matches with NO divider chips (no pinned-divider, no rdp-divider, no host-divider); row-level actions (deactivate/pin/hide/kill) preserved per row"
affects:
  - 42-03-fleet-status-recency-signal-wiring (search is orthogonal — no interaction)
  - future-panel-work-any-scroll-region (sentinel-based one-shot scroll pattern reusable)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sessionStorage-sentinel one-shot cold-load scroll-hide — reusable pattern for any future panel that wants to hide top chrome on first visit per session"
    - "Ternary-branched render tree for filter modes — three-zone ↔ flat single container, keyed on `searchMatches !== null` from a useMemo derivation"
    - "Panel-scoped label+sublabel filter predicate — reproduces the row's visible-text resolution at the panel level so what the user sees IS what the filter searches"

key-files:
  created: []
  modified:
    - "src/ui/state/conversation-store.ts — added SEARCH_HIDDEN_SENTINEL_KEY module constant; extended hydrateActiveSetFromStorage's only=1 guard to also clear the new sentinel key"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — imported Search + X lucide icons; added SEARCH_HIDDEN_SENTINEL_KEY module constant; added searchQuery state, scrollContainerRef + searchContainerRef refs, one-shot scroll-hide useEffect; added matchesSearch useCallback + searchMatches useMemo; branched render tree between flat search-matches container and three-zone view; mounted always-in-DOM search input container as FIRST child of .pv-panel-scroll"
    - "src/ui/features/pretty-conversations/pretty-conversations.css — added .pv-search-container, .pv-search-input, .pv-search-icon, .pv-search-clear rules; suppressed browser-default -webkit-search-*-decoration pseudo-elements so only the explicit × affordance renders"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx — added 17 new tests (Tests A/A2/B/C/D/E/E2 for search mount + scroll-hide; Tests F/G/H/I/I2/J/K/L/M for filter + flatten)"

key-decisions:
  - "Two per-task commits — Task 1 (input mount + scroll-hide + only=1 clear extension) and Task 2 (filter predicate + flat render branch) shipped as separate atomic commits per the plan spec. Neither introduced runtime coupling that forced a joint commit (unlike Plan 42-01's Task 1+2 coupling); Task 1's full-suite-green state left Task 2 free to build on top."
  - "Search input placement — inside .pv-panel-scroll as the FIRST child (above the loading affordance, above activeSet). This makes cold-load scroll-hide cover it: setScrollTop(searchContainer.offsetHeight) puts the whole 40px container just above the viewport."
  - "Sentinel key naming — `pv-conv-search-hidden-once` mirrors the `pv-conv-*` prefix of the sibling active-set key so both are grouped in DevTools and both are collected by the store's only=1 guard's `sessionStorage.removeItem` calls."
  - "Store-side only=1 guard extension (not panel-side) — the extension lives in conversation-store.ts's hydrateActiveSetFromStorage() because that function already parses the URL hash for only=1 and is the module-load entry point. Adding a sibling clear-call is 4 lines and reuses the existing try/catch; duplicating the URL-hash-parse in the panel would add 15 lines and split the invariant across two files. Store owns the module-level clear; panel owns the effect-level read+write."
  - "matchesSearch reproduces row-level resolution at the panel level — rather than pre-computing a `searchableText` field on ConversationRow and threading it through the store, the panel resolves identity+label+sublabel identically to PrettyConversationRow.tsx:1003-1024. This keeps ConversationRow's shape unchanged (no Plan 03 coupling risk) and keeps the predicate co-located with the render branch that uses it."
  - "Hidden rows excluded from filter union — Ashley lock #3 verbatim: 'hidden rows do NOT appear in filter matches. Hiding is a user choice; the filter respects it.' The union deliberately walks activeSetRows + pinned + middle + rdpGroup?.rows and does NOT walk hiddenRows. T-42-02-04 mitigation locked via Tests I + I2."
  - "Trimmed query for the null-vs-flat branch decision — `searchQuery.trim() === ''` gates whether searchMatches returns null. Whitespace-only queries treated as empty so a user typing then deleting doesn't produce a briefly-empty flat view before the tree flip."
  - "No auto-focus on mount — Ashley lock #4 uniform on mobile + desktop. Rejected the discretion to auto-focus on desktop per the shape's 'no separate mobile vs. desktop shape' clause."

patterns-established:
  - "sessionStorage-sentinel one-shot mount effect (SEARCH_HIDDEN_SENTINEL_KEY): declare a module-scoped key, wrap read+write in silent try/catch, gate the effect body on getItem !== '1', setItem '1' after the body runs. Reusable for any 'do X exactly once per browser session' pattern."
  - "Store-side sessionStorage sentinel registry: keys owned by the panel/component still get their clear entries in conversation-store.ts's only=1 guard because that guard fires at module init BEFORE any component mounts. New session-scoped keys should be added there to inherit the guard automatically."
  - "Ternary render branch on `derivedValue !== null`: useMemo returns null when the branch condition is false (three-zone view) OR a concrete value when it's true (flat matches). Keeps the JSX branch a single ternary; the memo carries all the branch logic + input dependencies."
  - "Predicate co-location: when the visible text resolution logic lives at the row level (PrettyConversationRow), the filter predicate at the panel level reproduces the SAME resolution so filter results match what the user sees. Alternative — pre-computing a `searchableText` field on ConversationRow at store-derivation time — would work but couples the store to the row's visual contract, which is a maintenance liability given the row's subtitleMode branching per render site."

requirements-completed: []

# Metrics
duration: ~30m
completed: 2026-08-15
---

# Phase 42 Plan 02: Always-in-DOM search input + one-shot cold-load scroll-hide + label-only flatten filter Summary

**Adds an always-mounted `<input type="search">` at the top of `.pv-panel-scroll` that hides itself via scroll on first cold load per browser session (sessionStorage-sentinel gated); typing collapses the three-zone view (pinned + middle + rdp) into ONE flat container of matches against visible row label + sublabel text; hidden rows deliberately excluded from matches; clearing restores the three-zone view exactly.**

## Performance

- **Duration:** ~30m (Task 1: ~15m, Task 2: ~15m — TDD RED-GREEN per task)
- **Started:** 2026-08-15T01:28:00Z (approx.)
- **Completed:** 2026-08-15T02:00:00Z
- **Tasks:** 2 (Task 1 = search mount + scroll-hide; Task 2 = filter predicate + flat render)
- **Files modified:** 4 (2 source .tsx/.ts + 1 CSS + 1 test)
- **Commits:** 2 atomic task commits (afc5a98a, 5466b91d)
- **Tests added:** 17 (Tests A/A2/B/C/D/E/E2/F/G/H/I/I2/J/K/L/M — 7 for Task 1, 10 for Task 2)

## Accomplishments

### Task 1 — Always-in-DOM search input + one-shot cold-load scroll-hide (commit afc5a98a)

- **Search input mount**: `<input type="search">` mounts as the FIRST child inside `.pv-panel-scroll`, wrapped in `.pv-search-container` (~40px height). Always mounts regardless of snapshot state (loading / empty / populated) per Ashley lock — search is always in the DOM at the top of the list.
- **UI shape chosen** (per plan `<output>` §(a)): placeholder text `"Search conversations"`; leading lucide `Search` icon (16px muted); explicit × clear affordance (lucide `X`, 14px) appearing only when `searchQuery.length > 0`; native `-webkit-search-*-decoration` pseudo-elements suppressed for cross-browser parity so only the explicit × renders. Test-ids: `pretty-conversations-search-container`, `pretty-conversations-search-input`, `pretty-conversations-search-clear`.
- **One-shot cold-load scroll-hide**: `useEffect(() => {...}, [])` runs once on mount; gated by sessionStorage sentinel `pv-conv-search-hidden-once`. First mount per browser session sets `scrollContainer.scrollTop = searchContainer.offsetHeight`, then writes the sentinel. StrictMode dev double-mount + any future panel remount both early-return on the second run. Silent try/catch on all sessionStorage reads/writes so SSR / private-mode Safari quota errors never crash the UI thread; falls through and still sets scroll on read failure (best-effort hide). Ashley verbatim: *"we make the effort on first load of the list to hide it and then don't mess with it after that."*
- **only=1 sessionStorage-bleed guard extension** (per plan `<output>` §(b)): conversation-store.ts's `hydrateActiveSetFromStorage()` extended to ALSO clear `pv-conv-search-hidden-once` when the URL hash contains `only=1` — same T-42-02-01 mitigation as the existing `pv-conv-active-set` clear (Move-to-new-window / Open-in-new-window flow drops `noopener`, child window inherits opener's sessionStorage; guard resets both keys so the new tab gets a fresh cold-load hide).
- **No auto-focus** on mount for either mobile OR desktop variant (Ashley lock #4 — uniform tap/click-to-focus, no auto-summoned keyboard).
- **CSS**: `.pv-search-container` (flex row, 40px, muted border, rgba white bg tint), `.pv-search-input` (transparent, palette color, appearance:none to suppress native shape), `.pv-search-icon` (muted fg), `.pv-search-clear` (24px × 24px button, hover fg brightening). All scoped to the `--color-pv-*` palette tokens.

### Task 2 — Label-only filter predicate + flat match render branch (commit 5466b91d)

- **matchesSearch predicate** (per plan `<output>` §(c)): resolves each row's visible text as `primary label + sublabel`. When identity resolves (`identitiesByKey.get(sessionMatchKey(row.targetTmuxSession))` returns a value) AND row is NOT RDP: `primary = identity.displayName ?? row.label`; `sublabel = identity.title ?? identity.displayName`. Otherwise (RDP rows OR non-RDP rows without a resolved identity): `primary = row.label`; `sublabel = row.host?.name ?? ""`. Both sides normalized via `.toLowerCase()` and matched via `.includes()` — substring, case-insensitive. Reproduces PrettyConversationRow.tsx:1003-1024's resolution verbatim so what the user sees IS what the filter searches. T-42-02-05 mitigation: no `new RegExp(query)`; no `dangerouslySetInnerHTML`.
- **searchMatches useMemo**: returns `null` when trimmed query is empty (three-zone view intact) OR a flat `ConversationRow[]` filtered from the union of `activeSetRows + pinned + middle + rdpGroup.rows`. **Hidden rows DELIBERATELY excluded** from the union (Ashley lock #3 — hiding is a user choice the filter respects; T-42-02-04 mitigation locked via Tests I + I2). Deduplicated by `row.id` — activeSet + pinned can overlap.
- **Flat match render branch**: render tree branches on `searchMatches !== null`. Flat branch renders ONE `<div className="pv-panel-group" data-search-flat-group="true">` container with NO divider chips (no `pinned-divider`, no `rdp-divider`, no `host-divider` — Ashley lock: section boundaries not preserved during search). Each row still carries `inActiveSet + pinned + hidden + deactivate/kill` handlers so all row-level actions work identically during filter (Pitfall 4 mitigation). RDP rows in the flat list use the no-op `togglePin` + no `subtitleMode` (their intrinsic contract) so pin behavior stays inert on RDP.
- **Clear restores three-zone view**: clicking the × clear button (or emptying the input any other way) sets `searchQuery = ""`, `searchMatches` returns `null`, the render branch flips back to the three-zone view exactly as it was pre-filter — no state loss (pinnedIds, hiddenIds, activeSet, snapshot all intact).
- **No message-body content search** anywhere in the code path (Ashley lock #10 — Test L locks this).

## Task Commits

1. **afc5a98a** — `plan(42-02): mount always-in-DOM search input + one-shot cold-load scroll-hide` (Task 1)
2. **5466b91d** — `plan(42-02): label-only filter predicate + flat match render branch` (Task 2)

## Files Created/Modified

- `src/ui/state/conversation-store.ts` — added `SEARCH_HIDDEN_SENTINEL_KEY = "pv-conv-search-hidden-once"` module constant; extended `hydrateActiveSetFromStorage()`'s `only=1` guard to also clear the new sentinel key alongside `ACTIVE_SET_STORAGE_KEY` (T-42-02-01 mitigation; matches the established pv-conv-* key registry pattern).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — imported `Search` + `X` from lucide-react; added module-scoped `SEARCH_HIDDEN_SENTINEL_KEY`; inside the component added `searchQuery` useState, `scrollContainerRef` + `searchContainerRef` useRefs, the one-shot scroll-hide useEffect, `matchesSearch` useCallback, `searchMatches` useMemo (with trimmed-query gate + hidden-rows-excluded union + dedupe by id); branched the render tree between the flat search-matches container (`data-search-flat-group="true"`) and the three-zone view (activeSet + pinned + middle + rdpGroup + Hidden); mounted the search input container (Search icon + input + conditional × clear button) as the FIRST child of `.pv-panel-scroll`.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — added scoped rules `.pv-search-container`, `.pv-search-input`, `.pv-search-icon`, `.pv-search-clear`; suppressed browser-default `-webkit-search-decoration/-cancel-button/-results-button/-results-decoration` pseudo-elements so only the explicit × affordance renders. Palette-scoped to `--color-pv-fg`, `--color-pv-fg-muted`, `--color-pv-fg-dim`, `--color-pv-border-quiet`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — added 17 new tests across 2 describe blocks: `PrettyConversationsPanel (Phase 42 Plan 02): search input mount + scroll-hide` (7 tests — A/A2/B/C/D/E/E2) and `PrettyConversationsPanel (Phase 42 Plan 02): filter predicate + flat match render` (10 tests — F/G/H/I/I2/J/K/L/M).

## Decisions Made

- **Two per-task commits** rather than a Plan 01-style joint atomic commit. Task 1 (input mount + scroll-hide + only=1 clear extension) leaves the panel fully working — searchQuery is unused in the render tree at that point, so the panel behaves exactly as pre-Task-1 apart from a new inert input at the top. Task 2 then wires the branch. Full-suite green after each commit.
- **Search input inside `.pv-panel-scroll`** (not inside `.pv-panel-header`) — required by the shape's "scrolling up reveals it" behavior. The header is opaque above; the input scrolls into visibility when the user pulls the list down past its clamp position.
- **sessionStorage sentinel value `"1"`** (not `"true"` or a timestamp) — matches the pv-conv-active-set JSON-array pattern of "presence = state" and keeps the guard's read as `getItem(key) === "1"` — a single string equality check with zero parsing.
- **matchesSearch reproduces the row-level resolution at the panel level** — rather than adding a `searchableText: string` field to `ConversationRow` at store-derivation time, the panel co-locates the resolution with the render branch. Rationale: (a) keeps `ConversationRow` shape unchanged; (b) avoids the fork's typical Plan-03-coupling risk (Plan 03 will land the recency signal but should NOT need to know about label-text resolution); (c) the row's `subtitleMode` branching per render site (identityTitle vs. hostname) makes a pre-computed field non-trivial — the panel's use of `identitiesByKey` at the predicate scope is simpler.
- **Trimmed-query gate on `searchMatches`** — `searchQuery.trim() === ""` (not `searchQuery === ""`) so whitespace-only queries don't briefly flip the render tree to an empty flat container. Defensive; user typing " " then a real character sees smooth 3-zone → flat matches transition without an interstitial empty flash.
- **RDP rows in the flat list use `undefined` subtitleMode** (defaults to `"hostname"` inside the row) — matches the RDP render site's contract in the three-zone view. Their `onTogglePin` uses the pre-existing `rdpNoopTogglePin` sentinel; `onToggleHide` + `onClone` set to `undefined` so no menu items appear that would violate the RDP contract.

## Deviations from Plan

**None** — plan executed exactly as written for Tasks 1 + 2.

Notes:
- The plan's `<action>` block for Task 1 says either extend the `only=1` guard at conversation-store.ts:154-168 OR duplicate the pattern in the panel component ("pick the smaller diff"). Store-side extension is 8 lines (a sibling try/catch + one removeItem call); panel-side duplication would require re-parsing `window.location.hash` in a mount effect + adding another try/catch + reproducing the URLSearchParams shape. Store-side won cleanly.
- The plan's `<action>` block for Task 2 recommends `useMemo` over `[searchQuery, activeSetRows, pinned, snapshot.middle, snapshot.rdpGroup, identitiesByKey]`. Implementation used `trimmedSearchQuery` as the memo dep (derived from `searchQuery.trim()` above the memo) and included `matchesSearch` (which itself carries `identitiesByKey` as a useCallback dep). Semantically equivalent, slightly cleaner dep list.

## Threat Model — Verification Matrix

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-42-02-01 | ✓ **Verified** — conversation-store.ts's `only=1` guard clears BOTH `pv-conv-active-set` AND `pv-conv-search-hidden-once`. Test D locks the extension. |
| T-42-02-02 | ✓ **Verified** — filter output renders through PrettyConversationRowLive → React default text-node escape. No `dangerouslySetInnerHTML` introduced. |
| T-42-02-03 | Accepted per plan. Fleet is ~20 sessions; per-keystroke re-render trivial. `useDeferredValue` deferred until fleet grows. |
| T-42-02-04 | ✓ **Verified** — `searchMatches` union walks `activeSetRows + pinned + middle + rdpGroup?.rows` and NOT `hiddenRows`. Tests I + I2 lock this. |
| T-42-02-05 | ✓ **Verified** — predicate uses `.includes()` on `.toLowerCase()` normalized strings. No `new RegExp(...)` code path exists. |

## Ashley Locks — Verification Matrix

| Lock | Test | Status |
|------|------|--------|
| Search input always in DOM at TOP of list | Test A, A2 (empty + populated snapshot) | ✓ Verified |
| One-shot scroll-hide gated by sessionStorage sentinel | Test B (first mount writes sentinel), Test C (subsequent mount no-ops) | ✓ Verified |
| only=1 new-window opener clears sentinel | Test D (real store module init with only=1 hash) | ✓ Verified |
| Typing flattens all three zones; NO divider chips during search | Test G (all pinned/rdp/host chips absent) | ✓ Verified |
| Filter matches label + sublabel | Test H (both "alpha" and "beta" match a row with identity displayName + title) | ✓ Verified |
| Hidden rows EXCLUDED from matches (lock #3) | Test I, I2 (transitioned-to-hidden row does not appear even from knownRowsRef) | ✓ Verified |
| Clearing restores three-zone view | Test J (× click restores dividers + rows) | ✓ Verified |
| No auto-focus on either mobile or desktop (lock #4) | Test E (desktop), Test E2 (mobile) | ✓ Verified |
| Case-insensitive substring match | Test K (mixed-case label matches lower + upper queries) | ✓ Verified |
| No message-body content search (lock #10) | Test L (query only in hypothetical content returns zero matches) | ✓ Verified |
| Dedupe by row.id | Test M (activeSet ∩ pinned overlap renders once) | ✓ Verified |

## Issues Encountered

- **Test D initially failed due to vi.mock shadowing the real conversation-store**: the test file mocks `@/state/conversation-store` at the top for all panel tests, so `await import("@/state/conversation-store")` inside Test D returned the mock, not the real module (whose init runs the only=1 guard). Fixed by using `vi.importActual` to bypass the top-level mock. This is the fork's established pattern for the same-file real-module-init exception (mirrors how other tests exercise real module hydrate paths).

## Self-Check

Per fork rule + step self_check:
- **tsc exit code:** 0 ✓
- **Full-suite vitest:** 188 test files passed, 2384 tests passed, 6 skipped, 1 todo, 0 failed, exit 0 ✓
- **npm run build:** exit 0, Vite bundle succeeded ✓
- **Search input mount test-id count:** grep `pretty-conversations-search-input` in PrettyConversationsPanel.tsx = 1 (source), in test file = 12 (uses) — verified via `grep -c` acceptance gate ≥ 3 ✓
- **sessionStorage sentinel usage:** grep `pv-conv-search-hidden-once` in PrettyConversationsPanel.tsx = 0 direct references (uses `SEARCH_HIDDEN_SENTINEL_KEY` constant), constant declared once + used once in effect body; in conversation-store.ts = 2 (declaration + removeItem in only=1 guard); in test file = 5 (Tests B/C/D + beforeEach + afterEach references) ✓
- **CSS scoping:** grep `pv-search-container|pv-search-input` in pretty-conversations.css = 4 selectors ✓
- **matchesSearch/searchMatches/searchQuery in panel .tsx:** grep count = 12 (well above the ≥5 acceptance gate — state + memo + predicate + controlled input + clear affordance + refs + render branch + trimmed query derivation) ✓
- **searchQuery in test file:** grep count = 5 (across the two describe blocks) ✓
- **hidden-exclusion assertion in test file:** Test I + I2 both assert hidden rows do not manifest — `grep -c hidden` in the test file returns 40+ (well above ≥1 gate) ✓

## User Setup Required

**None** — no external service configuration required. This plan is frontend-only + backend-inert (no backend routes added; no schema changes; no wire protocol changes; no nginx rules). No new npm packages installed.

Ashley will notice on the next deploy:
- A new search input appears just above the top row of the conversation list on cold-load first-render — scroll up to reveal it (it sits behind the panel header on initial load).
- Type any substring of a session label or identity title to filter — the list collapses to one flat container of matches; clearing (via the × button or backspacing to empty) restores the three-zone view.

## Next Phase Readiness

- **Plan 42-03 (fleet-status protocol extension + recency signal wiring)**: independent of Plan 42-02. Plan 03 will populate the `lastMessageAt` signal for the middle zone's compareByRecencyDesc via a backend fleet-status wire extension; the search input + filter is orthogonal (search operates on visible label text, not recency). No coupling to worry about.
- **Post-Phase-41 opportunities**: (a) if the fleet grows to >200 rows, add `useDeferredValue` + 100-150ms debounce on searchQuery per RESEARCH §Security Domain (T-42-02-03 acceptance path); (b) if Ashley requests filter to include hidden rows in future, flip the `searchMatches` union to also walk `hiddenRows` — one-line change; (c) potential "Cmd/Ctrl+F focuses search input" keyboard chord if Ashley finds she wants a quick-summon without scroll.

## Self-Check: PASSED

---
*Phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd*
*Completed: 2026-08-15*
