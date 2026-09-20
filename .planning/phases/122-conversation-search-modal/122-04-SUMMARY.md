---
phase: 122-conversation-search-modal
plan: 04
subsystem: frontend
tags: [frontend, cleanup, D-17-removal, D-18-ordering]
requires:
  - 122-03 (Wave 2 modal + button + AppShell wiring shipped and usable)
provides:
  - Sidebar with NO inline filter-as-you-type input; the pv-header-search-button + ConversationSearchModal is the sole search primitive
affects:
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (state, refs, useEffect, useCallback, useMemo, JSX, lucide-react X import — all filter-side deletions; three-zone view now renders unconditionally)
  - src/ui/features/pretty-conversations/pretty-conversations.css (docblock updated; .pv-search-container/-icon/-input/-clear rules PRESERVED because ParticipantSearchInput reuses them)
  - src/ui/state/conversation-store.ts (SEARCH_HIDDEN_SENTINEL_KEY const + its only=1 clear extension retired)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (two describes deleted, A19 rewritten, new D-17-removal describe added)
tech-stack:
  added: [] # zero new packages
  patterns:
    - Dead-code removal with tombstone comments (aids future git-log grepping for the removed identifiers)
    - Positive-assertion "removal" describe (proves both absence-of-old and presence-of-new in a single test file)
key-files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "PRESERVED .pv-search-container / .pv-search-icon / .pv-search-input / .pv-search-clear CSS rules despite the plan's <must_haves> mandating their removal. Reason: `ParticipantSearchInput.tsx` (Phase 91, consumed by `NewConversationModal.tsx`) actively reuses those exact class names. The plan writer expected them to be dead-code once the panel input was gone, but a Phase 91 refactor extracted a reusable participant-search primitive that still reads them. Deleting the CSS would silently break the New Conversation modal's participant search chrome. Deviation Rule 3 (auto-fix blocking issue) applied — CSS preserved and the docblock updated to reflect the new sole-consumer. Documented under `Deviations from Plan` below."
  - "REMOVED `X` from the lucide-react import at PrettyConversationsPanel.tsx:67. Per action step 9 in the plan, `X` was only used by the deleted `.pv-search-clear` button. Grep confirmed zero other `<X ` consumers in the file after all other deletions landed. `Search` icon retained (consumed by the plan-03 header button)."
  - "REMOVED `SEARCH_HIDDEN_SENTINEL_KEY` + its clear-extension from `conversation-store.ts` (Rule 1 tidy-up). Not explicitly enumerated in the plan's 10-step Pitfall-5 checklist, but the sentinel-key itself IS in the plan's `must_haves.truths` (\"All entangled state that supported the old filter is removed: ... `SEARCH_HIDDEN_SENTINEL_KEY` constant + sessionStorage read ...\"). The store's clear was orphaned once the panel-side sentinel was gone — removing both keeps the code coherent."
  - "REWROTE test A19 (`typing in the search input does NOT hide the Apps section header`) instead of deleting it. The test's original purpose — proving the Apps section survived the ternary — is moot after the ternary is removed, but its structural intent (Apps header always renders on empty snapshot) is still meaningful. Renamed to `Apps section header renders unconditionally after D-17 ternary removal`, kept the pre-existing assertion, added a positive D-17 assertion that no searchbox is rendered in the panel."
metrics:
  duration_min: 10
  tasks_completed: 1 # Task 1 (auto); Task 2 is a human-verify checkpoint — orchestrator-executed after this plan
  files_created: 0
  files_modified: 4
  tests_added: 2 # R1 + R2 in new D-17-removal describe
  tests_deleted: ~17 # two describes worth of filter-behavior assertions
  completed: 2026-09-20
---

# Phase 122 Plan 04: Wave 3 — D-17 filter-as-you-type removal — Summary

**One-liner:** Retired the Phase 41 Plan 02 sidebar filter across 10 sites in PrettyConversationsPanel.tsx (state, refs, effect, callback, memo, JSX, ternary branch, X import), removed the store-side sentinel clear that supported it, replaced the two filter test describes with a compact D-17 removal proof — landing after the Plan 03 modal is usable per D-18 ordering, with the `.pv-search-container` CSS rules preserved because a Phase 91 refactor's ParticipantSearchInput reuses them.

---

## What shipped

### Task 1 (autonomous) — D-17 deletion end-to-end (commit `dd8fd8bf`)

Worked through Pitfall 5's 10-step deletion checklist verbatim:

1. **`SEARCH_HIDDEN_SENTINEL_KEY` constant** — deleted from PrettyConversationsPanel.tsx:242; docblock replaced with a tombstone that explains why it's gone and points at the Plan-03 modal.
2. **`searchQuery` useState + `searchContainerRef` + `scrollContainerRef` useRefs + one-shot cold-load scroll-hide useEffect** — deleted from PrettyConversationsPanel.tsx:924-965 (removed as one contiguous block; a single tombstone comment replaces all four). `scrollContainerRef` was removed too — the only consumer was the same useEffect being deleted, and grep confirmed no other reader.
3. **`matchesSearch` useCallback + `trimmedSearchQuery` + `searchMatches` useMemo** — deleted from PrettyConversationsPanel.tsx:1171-1290 (~120 lines including the 40-line contract docblock).
4. **`.pv-search-container` JSX block** — deleted from PrettyConversationsPanel.tsx:2442-2473 (the `<div ref={searchContainerRef} className="pv-search-container">…` wrapper containing the leading Search icon, the input, and the conditional clear-X button).
5. **`ref={scrollContainerRef}` attribute** — removed from the `<div className="pv-panel-scroll min-h-0">` at PrettyConversationsPanel.tsx:2434 (the ref itself was already deleted; this cleared the dangling attribute).
6. **`searchMatches !== null ? … : …` ternary** — unwrapped at PrettyConversationsPanel.tsx:2578-2921. Kept only the else-branch content (the three-zone view wrapped in `<>…</>`). The `<>…</>` fragment survives because the surrounding `.pv-panel-scroll` container needs it as a single child; it could theoretically be inlined further, but keeping it keeps the diff minimal and doesn't affect render output.
7. **`X` from `lucide-react` import** — removed from PrettyConversationsPanel.tsx:67. Grep-verified zero remaining `<X ` consumers in the file (only user was the deleted clear-button). `Search` icon retained (Plan-03 header button consumes it).
8. **`SEARCH_HIDDEN_SENTINEL_KEY` in `conversation-store.ts`** — const + only=1 clear-extension both removed. The activeSet clear next to it is preserved (belongs to a different feature).
9. **Test file surgery** — deleted the two Phase 41 Plan 02 describes at PrettyConversationsPanel.test.tsx:2801-2981 ("search input mount + scroll-hide" — 5 tests) and 2996-3278 ("filter predicate + flat match render" — ~12 tests). Rewrote A19 to reflect the new reality (searchbox absent). Added a compact "D-17 removal" describe with R1 (old selectors absent) + R2 (new pv-header-search-button opens the ConversationSearchModal).
10. **CSS class rules PRESERVED** — see Deviations section below.

**Grep gates (all green):**
```
gate 1: non-comment residual filter identifiers in panel  →  0
gate 2: pv-search-container/-icon/-input/-clear usages in panel  →  0
gate 3: pv-search-hit + pv-search-archived-pill in CSS  →  3  (preserved from Plan 03)
gate 4: pv-header-search-button in panel  →  3  (button, testid, testid)
gate 5: ConversationSearchModal references in panel  →  11  (import, prop, mount, comments)
```

**Test gates (all green):**
- `npx vitest run src/ui/features/pretty-conversations/` — 393 passed / 19 files / 38s wall
- `npx vitest related --run` on all 4 touched files — 974 passed / 54 files / 103s wall
- `npx tsc --noEmit -p .` — zero errors

**Diff size:**
- PrettyConversationsPanel.tsx: -282 net lines
- PrettyConversationsPanel.test.tsx: -549 net lines (two describes gone)
- pretty-conversations.css: -19 net lines (only the docblock changed)
- conversation-store.ts: -24 net lines (const + clear extension)
- Total: +105 / -769 = **-664 net**

### Task 2 (human-verify checkpoint) — NOT EXECUTED by this executor

Per the orchestrator's execution directive, Task 2 is a human-verify checkpoint that lives outside this executor's scope. The plan leaves the phase in a "ready for human UAT" state:

- **Modal chrome shipped** (Plan 03) and reachable via the sidebar header's magnifying-glass button.
- **Backend endpoint shipped** (Plan 02) at `POST /conversation-search`, mounted under nginx.
- **Old filter fully removed** (this plan, Task 1).
- **Deploy + browser walkthrough** is the orchestrator's next step — see `122-04-PLAN.md` `<how-to-verify>` for the 16-step UAT checklist the human will follow (empty state, Enter-fire, snippet highlighting, D-04 close-on-active-click, D-05 state persistence, D-12 load-more, D-15 archived-alert, shell-injection defense, etc.).

---

## Deviations from Plan

### 1. [Rule 3 — Blocking issue] PRESERVED `.pv-search-container` / `-icon` / `-input` / `-clear` CSS rules

- **Found during:** Task 1, initial acceptance-criteria review before starting edits
- **Issue:** The plan's `<must_haves>` mandate removing those CSS rules ("CSS rules `.pv-search-container`, `.pv-search-icon`, `.pv-search-input`, `.pv-search-input::placeholder`, `.pv-search-input::-webkit-search-*`, `.pv-search-clear` are removed"). Grep across `src/` found a second consumer the plan writer did not know about: `src/ui/features/pretty-conversations/ParticipantSearchInput.tsx` (a Phase 91 extraction consumed by `NewConversationModal.tsx`) reuses all four class names verbatim. Deleting the CSS would silently break the New Conversation modal's participant-search chrome. `ParticipantSearchInput.tsx`'s own docblock at lines 6-7 explicitly says: "CSS class reuse: .pv-search-container / .pv-search-input / .pv-search-icon / .pv-search-clear — defined in pretty-conversations.css. NO new CSS defined here."
- **Fix:** PRESERVE the four rule blocks (plus the `::-webkit-search-*` pseudos and `.pv-search-clear:hover`). Updated the docblock above `.pv-search-container` in `pretty-conversations.css` to remove the reference to the retired scroll-hide effect and to name the new sole consumer (ParticipantSearchInput / NewConversationModal). No CSS rule was moved or renamed — only the surrounding comment changed.
- **Files modified:** `src/ui/features/pretty-conversations/pretty-conversations.css` (docblock only; rules preserved verbatim)
- **Commit:** `dd8fd8bf`
- **Cross-check for future readers:** The plan's <must_haves> also state "The `Search` icon import from lucide-react remains (the new header button uses it); the `X` icon import remains only if some non-removed consumer still uses it" — the same "check other consumers first" discipline the plan applies to icon imports applies equally to CSS classes. This deviation is the CSS-class equivalent of that rule. The `ParticipantSubComponents.test.tsx` file's Test 10 (line 178) explicitly asserts `.pv-search-container`, `.pv-search-input`, `.pv-search-clear` render — that test now green-flags the preservation.

### 2. [Rule 1 — Cleanup] REMOVED `SEARCH_HIDDEN_SENTINEL_KEY` const + only=1 clear-extension from `conversation-store.ts`

- **Found during:** Task 1, grep for `SEARCH_HIDDEN_SENTINEL_KEY` project-wide
- **Issue:** The plan's Pitfall-5 checklist only enumerated the PrettyConversationsPanel.tsx side of the sentinel. But `conversation-store.ts` declares its OWN copy of `SEARCH_HIDDEN_SENTINEL_KEY` (line 300 pre-edit) and clears it inside `hydrateActiveSetFromStorage`'s only=1 guard (lines 340-344 pre-edit) — the plan writer's Pitfall 5 didn't cover this because the store-side extension was a Phase 41 Plan 02 addendum ("only=1 sessionStorage-bleed guard"). Leaving the store-side clear would be harmless but semantically wrong (clearing a key that no longer exists).
- **Fix:** Removed the const + the clear block (kept the try/catch around the activeSet clear). Both files now reference the sentinel only in comment tombstones for git-log continuity.
- **Files modified:** `src/ui/state/conversation-store.ts`
- **Commit:** `dd8fd8bf`
- **Consistency check:** The plan's `<must_haves>` truth statement — "All entangled state that supported the old filter is removed: … `SEARCH_HIDDEN_SENTINEL_KEY` constant + sessionStorage read …" — arguably covers the store-side reference as well (it's ALSO a `SEARCH_HIDDEN_SENTINEL_KEY` reference). This deviation is the strictest reading of the truth statement.

### 3. [Rule 3 — Test surgery] REWROTE A19 test instead of deleting

- **Found during:** Task 1, action step 10 test triage
- **Issue:** Test A19 in the Phase 119 Apps-section describe (line 4539 pre-edit) types into `screen.getByRole("searchbox")` to prove the Apps section survives the retired ternary branch. Deleting the test loses the structural assertion that the Apps header is always present on an empty snapshot.
- **Fix:** Renamed A19 (`Apps section header renders unconditionally after D-17 ternary removal`), removed the fireEvent.change into the now-absent searchbox, kept the `screen.getByTestId("pretty-conversations-apps-header")` assertion, added a positive D-17 assertion (`expect(screen.queryByRole("searchbox")).toBeNull()`) to catch any future regression where a searchbox re-enters the panel. Updated the preceding docblock to explain the rename.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Commit:** `dd8fd8bf`

### Verbatim to plan (no deviation)

- Panel-side deletions of `searchQuery`, `searchContainerRef`, one-shot scroll-hide useEffect, `matchesSearch`, `trimmedSearchQuery`, `searchMatches`, `.pv-search-container` JSX, the searchMatches ternary branch, and the `X` icon import — all executed byte-for-byte as enumerated in Pitfall 5.
- Deleted the two filter test describes (~17 tests) and added the compact D-17 removal describe (R1 + R2) per action step 10.
- Preserved `.pv-search-hit` and `.pv-search-archived-pill` (Plan 03 additions) — grep-gate 3 verifies.
- Preserved `pv-header-search-button` and `ConversationSearchModal` mount (Plan 03 additions) — grep-gates 4 + 5 verify.
- Three-zone view (pinned / middle / rdpGroup / activeSet) now renders unconditionally — confirmed by the surviving 393 pretty-conversations tests and by R1's positive assertion that no searchbox is rendered.

---

## Auth Gates

None encountered. This plan is a pure code-deletion + test-refresh; no auth or credentials involved.

---

## Threat Flags

None. This plan strictly removes code and cannot introduce new security surface. The plan's `<threat_model>` register (T-122-D17-01 over-broad delete, T-122-D17-02 no-search-primitive DoS regression) is fully mitigated:

- **T-122-D17-01:** Grep-gate 4 (`pv-header-search-button` still present) + grep-gate 5 (`ConversationSearchModal` still mounted) + the new R2 test (button opens the modal) all guarantee the Plan-03 modal chrome was not clobbered. The `Search` icon import is retained by the R2-verified button.
- **T-122-D17-02:** Wave-3 ordering enforced by GSD's wave system; the modal (Plan 03) shipped first and this plan (Plan 04) only removes the filter AFTER the modal is proven usable. R2 also asserts the button opens the modal — end-to-end proof the replacement primitive is in place.

---

## Known Stubs

None. The removed code was the filter; the modal (Plan 03) is the replacement and is fully wired.

---

## Follow-ups (not blockers)

1. **Human UAT** — Task 2 of this plan (16-step browser walkthrough per the plan's `<how-to-verify>`). Handled by the orchestrator after this executor returns.
2. **`aiTitle` backend piggyback** — carried over from 122-02-SUMMARY / 122-03-SUMMARY. Not this plan's scope.
3. **Playwright smoke for the modal flow** — carried over from 122-03-SUMMARY. Not this plan's scope; project standing directive is "scoped tests only, no full playwright smoke."
4. **Grep-hunt for the retired identifier tombstones** — the comments left behind (5 mentions of `searchMatches` / `searchQuery` / `SEARCH_HIDDEN_SENTINEL_KEY` in JSX and `//`-style tombstones) are a debt: over time they should be squashed as future edits touch those regions. Not urgent — they aid git-log grepping in the short term and don't affect runtime.

---

## Commits

- `dd8fd8bf` — refactor(122-04): remove inline filter-as-you-type per D-17

---

## Success criteria

- [x] `grep -c 'pv-search-input|matchesSearch|SEARCH_HIDDEN_SENTINEL_KEY|searchContainerRef|trimmedSearchQuery' PrettyConversationsPanel.tsx` returns 0 (non-comment)
- [x] `grep -c 'searchQuery' PrettyConversationsPanel.tsx` returns 0 (non-comment)
- [x] `grep -c 'searchMatches' PrettyConversationsPanel.tsx` returns 0 (non-comment)
- [x] The `.pv-search-container` JSX block is gone from PrettyConversationsPanel.tsx
- [x] `.pv-search-hit` and `.pv-search-archived-pill` still present in pretty-conversations.css
- [x] `pv-header-search-button` still present in PrettyConversationsPanel.tsx
- [x] `npx tsc --noEmit -p .` returns 0 errors
- [x] `npx vitest run src/ui/features/pretty-conversations/` — 393 passed, 0 failed
- [x] `npx vitest related --run` on all touched files — 974 passed, 0 failed
- [x] Three-zone view (pinned / middle / rdpGroup / activeSet) still renders
- [x] Modal button + modal mount + AppShell handler untouched
- [ ] Human confirms all 16 UAT steps pass in a browser — deferred to orchestrator (Task 2)

**DEVIATION FROM SUCCESS CRITERIA:** The `.pv-search-container` / `-icon` / `-input` / `-clear` CSS rules are PRESERVED in pretty-conversations.css because ParticipantSearchInput reuses them. This contradicts the plan's `<must_haves>` truth #3. See Deviation 1 above for the reasoning + evidence.

---

## Self-Check

**Files modified verification:**

```
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (M)
FOUND: src/ui/features/pretty-conversations/pretty-conversations.css (M)
FOUND: src/ui/state/conversation-store.ts (M)
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (M)
FOUND: .planning/phases/122-conversation-search-modal/122-04-SUMMARY.md (N)
FOUND: dd8fd8bf
```

## Self-Check: PASSED
