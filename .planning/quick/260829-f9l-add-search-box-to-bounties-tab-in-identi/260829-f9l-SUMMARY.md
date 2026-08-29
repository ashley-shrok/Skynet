---
phase: quick-260829-f9l
plan: 01
subsystem: frontend / IdentityModal
tags:
  - frontend
  - identity-modal
  - bounties
  - search
requirements:
  - QUICK-260829-f9l
dependency-graph:
  requires:
    - "existing Bounty wire type (src/ui/api/claude-session-api.ts:524) with fields slug/title/premise/keywords"
    - "existing lazy-archive fetch flow (quick 260823-80r) — the search predicate is orthogonal and does not disturb it"
  provides:
    - "client-side substring filter over Bounties tab open partitions AND (when loaded) archive body"
    - "sticky search input at top of Bounties-tab scroll region with X and Escape clear"
    - "query-driven empty state with archive-not-loaded hint when archive is unloaded"
  affects:
    - "src/ui/features/pretty-view/IdentityModal.tsx (Bounties tab render tree only)"
tech-stack:
  added:
    - "@/components/input (Input) — imported into IdentityModal.tsx for the search box"
  patterns:
    - "useMemo-backed normalized-query + useCallback predicate — no debounce (list is < 100 items per role)"
    - "sticky top-0 inside scroll container with backdrop-blur so the bar remains visible while scrolling the list"
key-files:
  created:
    - path: src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx
      purpose: 11-test vitest suite (A-K) covering per-field matches, empty state, archive-not-loaded hint, filter into loaded archive, X-clear, Escape-clear, no autofocus
  modified:
    - path: src/ui/features/pretty-view/IdentityModal.tsx
      purpose: add Input import, bountyQuery state + normalized query memo + bountyMatchesQuery predicate + hasOpenAfterFilter/hasArchiveAfterFilter derived booleans; wrap Bounties TabsContent with flex-col + inner scroll container hosting sticky search bar; filter OPEN_STATUS_ORDER partitions via filteredGroup; filter sortedArchive body via sortedArchive.filter(bountyMatchesQuery); add query-driven empty state block; gate existing pure-empty branch on bountyQueryNorm === ""
decisions:
  - "Filter applied to BOTH OPEN partitions AND (when loaded) archive body — the spec's <truths_from_read> #2 called out that only-one-site would silently omit half the matches."
  - "Archive accordion trigger label continues to show total archive count (not filtered count) — Ashley's ask centers on scanning matches; the count is the drawer-size signal."
  - "Keywords collapsed into hay via .join(' ') rather than .some() — keywords never straddle spaces so one .includes() beats per-keyword iteration for the small list size."
  - "Sticky bar rendered UNCONDITIONALLY inside the scroll container (not conditionally on loading/error branches) so keyboard focus is never yanked out of the input by branch swaps."
  - "The pre-existing 'truly nothing' empty state (line 1514 in original) gated on bountyQueryNorm === '' so a non-empty query yields the query-driven empty state instead of the 'no bounties at all' message."
metrics:
  duration_seconds: 6910
  completed_date: "2026-08-29"
---

# Quick 260829-f9l: Bounties-tab search box

Ashley's `tina` role has grown a long bounty list; scanning by eye was the bottleneck.
This quick adds a sticky, no-debounce, `useMemo`-backed substring filter over four
fields (title / premise / keywords / slug) at the top of the Bounties tab in
`IdentityModal`. Filter applies to open partitions AND (when loaded) the archive
accordion body. Typing does not force an archive fetch — when the archive is
unloaded and there are no open matches, the empty state carries a hint to expand.

## Tasks Executed

- **Task 1 (auto, tdd):** Add search state, filter predicate, and query-aware empty-state to the Bounties tab.
  - Added `Input` import to `IdentityModal.tsx`.
  - Added `bountyQuery` state near `archivedLoadState`.
  - Added `bountyQueryNorm` normalized query memo and `bountyMatchesQuery` predicate (case-insensitive substring against `[title, premise, slug, keywords.join(' ')].join(' ').toLowerCase()`).
  - Added `hasOpenAfterFilter` and `hasArchiveAfterFilter` derived booleans.
  - Restructured Bounties `TabsContent` into a flex-col with an inner scroll container so the search input can sit sticky at the top of the scroll region.
  - Sticky search input has `aria-label="Search bounties"`, an X clear button (`aria-label="Clear search"`) visible only when the query is non-empty, and `Escape` keydown clearing.
  - Filtered OPEN partitions via `filteredGroup = group.filter(bountyMatchesQuery)` (partition header hides when filtered group is empty).
  - Filtered archive via `sortedArchive.filter(bountyMatchesQuery).map(...)`.
  - Added query-driven empty state block between OPEN groups and Archive accordion; renders `no matches for "…"` and, when archive is not loaded, appends `archive not loaded — expand to include it`.
  - Gated the existing pure-empty branch on `bountyQueryNorm === ""` so it only fires when there's no query.
  - Verified with `npx tsc --noEmit` (clean) and `npx vitest run src/ui/features/pretty-view/IdentityModal` (all 35 pre-existing tests still pass).
- **Task 2 (auto, tdd):** Add `IdentityModal.bounties-filter.test.tsx` covering all locked filter behaviors.
  - Copied WsStub + module mocks + `renderModal` + `findSocketForRequestType` scaffolding from `IdentityModal.role-tab.test.tsx` (Ashley's fleet rule: one WS stub pattern).
  - Added 4 OPEN bounty fixtures (RDP, cert, dashboard, caddy) plus 1 archived (purge legacy) covering match paths for title / premise / keywords / slug.
  - 11 tests (A-K): Test A generic filter, B title match, C premise match, D keywords match, E slug match, F no-match empty state with loaded archive, G no-match with unloaded archive (WS-side-effect gate), H filter into loaded archive body, I X-button clear, J Escape clear, K no autofocus on tab open.
  - All 11 tests pass on first run.
- **Task 3 (auto):** Full-suite green + atomic commit.
  - Ran `npx vitest run` at repo root. Result: **216 test files, 3125 tests passed, 10 skipped, 1 todo, 0 failures.** (Duration ~67 min under parallel load from a sibling worktree's vitest run; the two runs contended for CPU cores so wall-clock was ~2× normal.)
  - Made ONE atomic commit `feat(quick-260829-f9l): add search box to Bounties tab in IdentityModal` containing exactly `src/ui/features/pretty-view/IdentityModal.tsx` and `src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx`.

## Commit

- `0eb127bb feat(quick-260829-f9l): add search box to Bounties tab in IdentityModal`
  - `src/ui/features/pretty-view/IdentityModal.tsx` — +143 / -5
  - `src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx` — +653 / -0 (new file)

## Verification

- **Type check:** `npx tsc --noEmit -p tsconfig.json` clean, no IdentityModal-related errors.
- **New tests:** `npx vitest run src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx` — 11/11 passed.
- **Existing IdentityModal tests:** `npx vitest run src/ui/features/pretty-view/IdentityModal` — 35/35 passed (no regressions from restructured Bounties `TabsContent`).
- **Full suite:** `npx vitest run` at repo root — 3125 / 3125 pass, 0 fail (10 skipped + 1 todo are pre-existing).
- **Diff scope:** Only `IdentityModal.tsx` + new test file. No backend, no wire-type, no WS-shape, no nginx, no docker.

Note on the vitest summary's `Errors 2 errors` line: these are captured async errors from unrelated tests (unhandled promise rejections during teardown) that do NOT affect test pass/fail. They existed pre-change on this branch — my patch didn't introduce them. Vitest still exits with all tests reported as passed.

## Deviations from Plan

None. The plan's action-level steps were followed literally (Input import, state placement near `archivedLoadState`, memoized `bountyQueryNorm`, `bountyMatchesQuery` predicate with joined-hay pattern, sticky bar inside scroll container with backdrop-blur, X + Escape clear affordances, both OPEN and archive filter sites, query-driven empty state between OPEN groups and Archive accordion, gate on pre-existing pure-empty branch).

The only implementation choice not explicit in the plan text: the sticky bar was rendered UNCONDITIONALLY (outside the loading/error/empty conditional chain) rather than only in the "populated" branch. This is a strict superset of the plan's behavior contract and prevents keyboard focus from being yanked out of the input when the parent branch swaps — a UX improvement consistent with the plan's spirit ("Ashley's keyboard focus is not stolen"). Locked-scope item #3 (no autofocus) is preserved because the `<Input>` element still carries no `autoFocus` prop.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-view/IdentityModal.tsx (modified)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx (new)
- FOUND commit: 0eb127bb

## Status: COMPLETE
