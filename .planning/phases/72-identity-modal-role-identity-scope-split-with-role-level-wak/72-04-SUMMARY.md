---
phase: 72-identity-modal-role-identity-scope-split-with-role-level-wak
plan: 04
subsystem: frontend
tags: [wakeups, handoff, identity-modal, coordinator-empty-states, ui-polish, hue-tint-pill, sketch-variant-d]

requires:
  - phase: 72
    plan: 03
    provides: "Segmented Role/Identity scope switch + per-scope Wakeups panes + HandoffTab pane in IdentityModal (Wave 3 baseline; this wave adds coord-aware empty captions to the identity-scope panes)"
  - phase: 67
    plan: 01
    provides: "identity.coordinator boolean (non-nullable, derived from on-disk YAML frontmatter) — this wave threads it as isCoordinator prop into both WakeupsTab and HandoffTab"

provides:
  - "WakeupsTab.tsx now accepts required isCoordinator: boolean prop; empty-state branch split into three code paths (coord+identity → caption only, coord+role → caption+pill, actor → caption+pill)"
  - "HandoffTab.tsx now accepts required isCoordinator: boolean prop; renders 'stateless routers' caption at the top of the render body, short-circuiting loading/error/empty-carry branches for coordinator identities"
  - "IdentityModal.tsx threads identity.coordinator down as isCoordinator to both WakeupsTab call sites (identity-wakeups + role-wakeups) and to HandoffTab"
  - "AddWakeupPill visual polish (Plan 02 palette → sketch variant D hue-tint palette) + hover state via local useState (tailwind hover: doesn't compose over inline hue-tinted styles)"
  - "6-test coverage file IdentityModal.coordinator-empty.test.tsx (C1 coord-Wakeups caption + no pill / C2 coord-Handoff caption / C3 coord-Identity-file renders normally / C4 actor regression guard / C5a+C5b pill-in-both-branches invariant)"
  - "Human-verify walk-through spec inline in this SUMMARY (Ashley UAT after orchestrator ship)"

affects: [identity-modal, coordinator-legibility, wakeups-tab-empty-state, handoff-tab, phase-72-complete]

tech-stack:
  added: []
  patterns:
    - "Coordinator-aware empty-state split via required non-optional isCoordinator prop (calling site always knows via identity.coordinator, no default needed)"
    - "Short-circuit render pattern in HandoffTab: coord branch precedes loading/error/empty/render-body — the caption is more informative than any of those states for a stateless router"
    - "Inline-style hover state via local useState — tailwind's hover: pseudo-class doesn't compose over hue-tinted inline styles that need per-hue interpolation, so hover swap goes through React state"

key-files:
  created:
    - "src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx (~390 lines — 6 tests C1-C5b)"
  modified:
    - "src/ui/features/pretty-view/WakeupsTab.tsx (+isCoordinator prop, +three-branch empty state, +AddWakeupPill hover state + polished hue-tint palette)"
    - "src/ui/features/pretty-view/HandoffTab.tsx (+isCoordinator prop, +coord short-circuit at top of render body)"
    - "src/ui/features/pretty-view/IdentityModal.tsx (+isCoordinator={identity.coordinator} threading at 3 call sites — both WakeupsTab panes + HandoffTab pane)"

key-decisions:
  - "AddWakeupPill kept as a single shared component invoked at 2 render sites (empty-branch + data-branch) rather than inlined twice per plan action step's exact JSX. Testids count 1 in the source but the pill-in-both-branches invariant IS preserved (verified at runtime by Test C5a + C5b). Plan grep acceptance criterion (>=2 testid) was written assuming inline duplication — deviation logged below as Rule 3 (semantically preserved, structure differs)."
  - "Hover state on AddWakeupPill goes through local useState (mouseenter/leave/focus/blur) because tailwind's hover:bg-* class syntax doesn't compose with inline `background: hsla(${hue}, ...)` — inline styles win the specificity war regardless of hover state. React state swap keeps the hue-tinted brighten cleanly reactive without splitting the palette into a static tailwind class + a hue-only overlay."
  - "isCoordinator is required (non-optional) on both tabs — every call site knows the coordinator flag (via identity.coordinator from IdentityModal, or hardcoded false in standalone WakeupsTab tests). Making it optional would defeat the purpose of the guard (a missing prop would silently render the actor path for a coord)."
  - "HandoffTab coord short-circuit lives at the TOP of the render body (before loading/error/empty checks) so a coord with a stray handoff.md on disk still gets the caption. Ashley's coordinator identities in the fleet may have inherited stray handoff.md files from earlier prototypes; the caption is the semantically-correct render regardless of file state."
  - "Sub-repos not touched — this is a single-repo project (no `sub_repos` config); commit-to-subrepo not applicable"

patterns-established:
  - "Coordinator-aware conditional rendering in per-scope tabs: `if (isCoordinator && scope === 'identity')` for Wakeups (only the identity-scope empty case is short-circuited; role-scope stays fully functional); `if (isCoordinator)` for Handoff (both scopes short-circuit — coord handoffs are undefined regardless)"
  - "Sketch variant D coordinator column palette for hue-tinted CTAs: `hsla(hue, 60%, 45%, 0.25)` bg + `hsla(hue, 60%, 55%, 0.4)` border + hover `hsla(hue, 65%, 50%, 0.35)` bg. Reusable for future coord-facing action buttons."

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-09-04
---

# Phase 72 Plan 04: Coordinator empty states + polish Summary

**Phase 72's final wave lands. Coordinator identities opening the modal now see informative captions in their Identity-view Wakeups and Handoff tabs ("Coordinators use role-scope wakeups only. Switch to Role view to manage." and "Coordinators are stateless routers — no handoff to display.") instead of mostly-empty regions. The Add-wakeup pill matches sketch variant D's hue-tint palette. Ashley walk-through happens post-ship — spec in this document.**

## Performance

- **Duration:** ~15 minutes end-to-end (RED + GREEN + acceptance + summary)
- **Started:** 2026-09-04T09:35Z (approx, at first plan read)
- **Completed:** 2026-09-04T09:50Z (approx, at final commit time)
- **Tasks:** 1/2 autonomous complete; Task 2 is a human-verify checkpoint artifact (see § Human Verify Walk-through below)
- **Files created:** 1 (IdentityModal.coordinator-empty.test.tsx)
- **Files modified:** 3 (WakeupsTab.tsx, HandoffTab.tsx, IdentityModal.tsx)

## Accomplishments

### Task 1 — Coordinator empty states + isCoordinator threading + pill polish

**Commit 1 (47d798db):** `test(72-04): add failing IdentityModal.coordinator-empty tests (RED)`

5 tests (6 with C5 split) in `src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx`:

| # | Test | Coverage |
| - | ---- | -------- |
| C1 | coordinator + Identity scope + empty wakeups → caption ONLY, no pill | Empty-state branch 1 (coord+identity) |
| C2 | coordinator + Handoff tab (Identity scope) → caption ONLY, short-circuits even non-empty markdown | HandoffTab coord short-circuit |
| C3 | coordinator + Identity file tab → renders normally | Regression guard — IdentityFileTab path unaffected |
| C4 | actor + Identity scope + empty wakeups → "No scheduled wake-ups." caption + Add-wakeup pill | Regression guard — actor path unaffected |
| C5a | scope='role', isCoordinator=false, empty list → pill in empty-state div | Pill-in-both-branches invariant, empty half |
| C5b | scope='role', isCoordinator=false, non-empty list → pill above the row list | Pill-in-both-branches invariant, data half |

RED result: 2 fail (C1, C2 — the two new features), 4 pass (C3, C4, C5a, C5b — the invariants that were already true per Plan 02/03 baseline).

**Commit 2 (1a817962):** `feat(72-04): coordinator-Identity-view empty captions + Add-wakeup pill polish (GREEN)`

**WakeupsTab.tsx changes:**

Prop signature: added required `isCoordinator: boolean`.

Empty-state branch (`state.data.length === 0`) split into three code paths:

```tsx
// Branch 1: coordinator + Identity scope → caption ONLY, no pill.
if (isCoordinator && scope === "identity") {
  return (
    <div
      className="text-sm text-[var(--color-pv-fg-muted)]"
      data-testid="wakeups-coordinator-empty-identity"
    >
      Coordinators use role-scope wakeups only. Switch to Role view to manage.
    </div>
  );
}

// Branches 2 + 3: any non-(coord+identity) empty case → caption + pill.
return (
  <div className="flex flex-col gap-3">
    <AddWakeupPill hue={hue} onClick={() => setAddDialogOpen(true)} />
    <div className="text-sm text-[var(--color-pv-fg-muted)]">
      No scheduled wake-ups.
    </div>
    <AddWakeupDialog … />
  </div>
);
```

**AddWakeupPill visual polish (Plan 02 → Plan 04):**

| Facet | Plan 02 (sticky search palette) | Plan 04 (sketch variant D) |
| ----- | ------------------------------- | -------------------------- |
| background | `hsla(${hue}, 45%, 25%, 0.82)` | `hsla(${hue}, 60%, 45%, 0.25)` |
| border | `hsla(${hue}, 65%, 55%, 0.32)` | `hsla(${hue}, 60%, 55%, 0.4)` |
| hover bg | tailwind `hover:opacity-90` (opacity fade) | `hsla(${hue}, 65%, 50%, 0.35)` (hue-tinted brighten via local useState) |
| padding | `px-3 py-1` | `px-3.5 py-1.5` |
| font | `text-xs font-medium` (12px) | `text-[11px] font-semibold` |

The Plus icon + "Add wakeup" text stay identical. Hover state uses `mouseenter`/`mouseleave`/`focus`/`blur` handlers on local `useState` because tailwind's `hover:bg-*` doesn't compose over hue-tinted inline styles (inline styles win the specificity war).

**HandoffTab.tsx changes:**

Prop signature: added required `isCoordinator: boolean`.

Coord short-circuit at TOP of render body (before loading/error/empty-check):

```tsx
if (isCoordinator) {
  return (
    <div
      className="text-sm text-[var(--color-pv-fg-muted)]"
      data-testid="handoff-coordinator-empty"
    >
      Coordinators are stateless routers — no handoff to display.
    </div>
  );
}
```

**IdentityModal.tsx changes:**

Threaded `isCoordinator={identity.coordinator}` at 3 call sites (grep count 3):

- `<TabsContent value="identity-wakeups">` → `<WakeupsTab ... isCoordinator={identity.coordinator} ...>` (identity-scope pane — where the coord branch fires)
- `<TabsContent value="role-wakeups">` → `<WakeupsTab ... isCoordinator={identity.coordinator} ...>` (role-scope pane — coord branch does NOT fire under scope='role', but prop is threaded for uniformity)
- `<TabsContent value="handoff">` → `<HandoffTab ... isCoordinator={identity.coordinator} ...>` (coord short-circuit fires under both scopes; only reachable under Identity scope per NAV_SECTIONS)

### Task 2 — Human-verify checkpoint (deferred to Ashley post-ship)

Task 2 is a `checkpoint:human-verify` — no code changes fire during it. The plan's execution mode (sequential executor, orchestrator handles ship motion) means the executor produces the walk-through spec artifact and returns; the actual real-browser confirmation happens with Ashley after the orchestrator has pushed + deployed. The spec below is the artifact.

## Human Verify Walk-through (Ashley UAT, post-ship)

**What was built (all four Phase 72 waves shipped):**
- Backend CRUD parity for role-scope + identity-scope wakeups (6 new WS handlers, 6 new writer/reader functions, 12 new wire types) — Plan 01.
- WakeupsTab.tsx is scope-aware with Add-wakeup pill + trash-with-confirm + scope pill on each row — Plan 02.
- IdentityModal.tsx has a segmented Role/Identity switch, per-scope conditional NAV_SECTIONS + TabsContent, per-scope Wakeups panes wired to their respective WS handlers — Plan 03.
- Zustand-shaped modal-scope-store remembers scope per-identityKey across opens within a browser session — Plan 03.
- Coordinator Identity-view Wakeups + Handoff tabs render informative empty captions instead of raw "no data" states — Plan 04 (this wave).

**How to verify (7 walk-throughs — each 30–60s):**

1. **Wait for orchestrator ship** — this checkpoint fires BEFORE deploy but AFTER all code is committed. The box-maintainer directive says executors don't do deploys; the orchestrator handles push/build/deploy. Ashley walks through against the DEV build first (or the newly-deployed staging/prod URL if orchestrator has already run the pre-checkpoint deploy).

2. **Open Skynet in browser at https://term.gigaashley.click** (or the dev/staging URL if not yet shipped to prod).

3. **Actor identity walk-through (use "tina" or any actor):**
   - Tap Tina's badge in a chat to open the modal.
   - EXPECT: modal opens with segmented Role/Identity control at top, Identity is highlighted (aria-pressed=true), bottom icon-bar shows 3 tabs: Identity file / Wakeups / Handoff, Identity file tab is active.
   - Tap the Role scope switch button (left).
   - EXPECT: bottom icon-bar reshuffles to 4 tabs: Role file / Bounties / History / Wakeups. Role file tab is active.
   - Tap the Wakeups tab under Role scope.
   - EXPECT: list shows role-scope wakeups (or "No scheduled wake-ups." + Add-wakeup pill if none exist). Every row's scope pill reads "role".
   - Tap the Add-wakeup pill. EXPECT: sub-modal opens with Name / Schedule type / per-type params / Timezone (optional IANA) / Instruction / Enabled Switch / Save / Cancel. Sub-modal title reads "Add role-scope wakeup". Pill has the hue-tinted sketch variant D palette (soft mid-tone background, brighter on hover).
   - Cancel the sub-modal.
   - Tap the trash icon on any wakeup row. EXPECT: AlertDialog confirm opens: "Delete '<slug>'? This cannot be undone." with Cancel and Delete buttons.
   - Cancel the confirm.
   - Switch back to Identity scope. Tap the Wakeups tab. EXPECT: shows identity-scope wakeups (should be non-empty since Tina has identity-scope wakeups today). Every row's scope pill reads "identity".
   - Close the modal, reopen it (same identity). EXPECT: opens on the LAST scope you had selected (Identity, since that was the last tap).

4. **Coordinator identity walk-through (use a known coordinator identity — box-maintainer / any coord in the fleet):**
   - Tap the coordinator's badge in a chat.
   - EXPECT: modal opens with the Role scope switch highlighted, bottom icon-bar shows 4 tabs (Role file / Bounties / History / Wakeups), Role file tab is active.
   - Tap the Identity scope switch.
   - EXPECT: bottom icon-bar reshuffles to 3 tabs (Identity file / Wakeups / Handoff), Identity file tab is active.
   - Tap the Wakeups tab.
   - EXPECT: caption reads exactly "Coordinators use role-scope wakeups only. Switch to Role view to manage." NO Add-wakeup pill visible. NO "No scheduled wake-ups." fallback either.
   - Tap the Handoff tab.
   - EXPECT: caption reads exactly "Coordinators are stateless routers — no handoff to display." NO Edit toolbar button. NO markdown editor.
   - Tap the Identity file tab.
   - EXPECT: renders the coordinator's identity.md file normally (or the standard empty-file behavior if the file doesn't exist).

5. **Regression sweep (each takes 30s):**
   - Under an actor's Role scope, tap Bounties. EXPECT: bounty search input at top, priority-sorted bounty cards render, Archive accordion at bottom, all existing bounty operations work (priority change, status change, pin toggle, etc).
   - Type in the bounty search input. EXPECT: filter fires, results narrow, escape clears the input.
   - Expand the Archive accordion. EXPECT: lazy load fires (spinner or content), archived bounties render.
   - Under Identity scope, edit an identity's title (inline editor in title bar). EXPECT: Save persists, badge/avatar refreshes.
   - Toggle the "Stays awake" switch. EXPECT: persists.

6. **Sketch fidelity check:**
   - Compare the modal against `.planning/sketches/001-identity-modal-role-vs-identity-split/index.html` variant D (Top Scope Switch).
   - EXPECT: segmented control positioning, hue tint, bottom-bar tab arrangement, Add-wakeup pill visual language all match the sketch (allowing minor pixel differences).

7. **Empty-branch first-wakeup flow (actor Identity + role scope both):**
   - Find an identity + scope combination whose wakeup list IS empty (e.g. an identity with no identity-scope wakeups, or a role with no role-scope wakeups).
   - EXPECT: for actor+identity-empty → "No scheduled wake-ups." caption + Add-wakeup pill.
   - EXPECT: for coord+role-empty → "No scheduled wake-ups." caption + Add-wakeup pill (coord CAN create role-scope wakeups from a blank slate).
   - EXPECT: for coord+identity-empty → coord-only caption, NO pill (only case that omits the pill).
   - Tap the pill on any of the pill-visible cases. EXPECT: AddWakeupDialog opens with correct scope title, form works, Save writes through the correct scope's WS handler.

**Resume signal:** Type "approved" if all 7 walkthroughs pass. Type a description of what's off if not. Issues fold into a follow-up quick or Wave 4b before ship.

## Deviations from Plan

**Rule 3 (semantically-preserved structural difference from plan action step's exact JSX):**

- **Found during:** Task 1 implementation of the empty-state branches.
- **Issue:** Plan action step shows the Add-wakeup pill inlined TWICE (once in each of branches 2 + 3 combined-as-one and the data-branch), producing 2+ `data-testid="wakeup-add-button"` grep matches. Existing Plan 02 code factored the pill into an `AddWakeupPill` component invoked at 2 sites. Inlining twice would produce dead duplicate JSX for zero semantic gain.
- **Fix:** Kept the shared component pattern from Plan 02 baseline. AddWakeupPill is a single function invoked at 2 render sites (WakeupsTab.tsx L180 empty-branch + L197 data-branch). `data-testid="wakeup-add-button"` grep returns 1 (the shared definition), NOT 2 as the plan grep acceptance criterion asked. The pill-in-both-branches invariant IS preserved and is enforced by Test C5a + C5b at runtime (which are more robust than a source-text grep since they exercise the actual rendered DOM in both branches).
- **Files modified:** src/ui/features/pretty-view/WakeupsTab.tsx
- **Commit:** 1a817962

No other deviations. All other acceptance criteria pass by direct grep:

| Grep | Target | Actual | Result |
| ---- | ------ | ------ | ------ |
| `isCoordinator:\s*boolean` in WakeupsTab.tsx | >=1 | 1 | pass |
| Coord Wakeups caption text in WakeupsTab.tsx | 1 | 1 | pass |
| `isCoordinator:\s*boolean` in HandoffTab.tsx | >=1 | 1 | pass |
| Handoff coord caption text in HandoffTab.tsx | 1 | 1 | pass |
| `isCoordinator={identity.coordinator}` in IdentityModal.tsx | 3 | 3 | pass |
| `hsla(${hue}, 60%, 45%` in WakeupsTab.tsx | >=1 | 1 | pass |
| `data-testid="wakeups-coordinator-empty-identity"` in WakeupsTab.tsx | 1 | 1 | pass |
| `data-testid="handoff-coordinator-empty"` in HandoffTab.tsx | 1 | 1 | pass |
| `data-testid="wakeup-add-button"` in WakeupsTab.tsx | >=2 | 1 | see Rule 3 above — semantic invariant preserved via component + Test C5 |

## Verification

**Scoped test results:**
- `src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx` → 6/6 (NEW)
- `src/ui/features/pretty-view/WakeupsTab.test.tsx` → 23/23 (unchanged)
- `src/ui/features/pretty-view/AddWakeupDialog.test.tsx` → 12/12 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.test.tsx` → 12/12 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` → 8/8 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx` → 6/6 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx` → 6/6 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx` → 11/11 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx` → 6/6 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` → 8/8 (unchanged)
- `src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx` → 4/4 (unchanged)
- **Total: 102 tests across 11 files, 0 failures. No existing tests regressed.**

**TypeScript:** `npx tsc --noEmit` exits 0 (isCoordinator is required on both tabs; all callers pass it).

**Spirit-violation guardrail closed:** the combination of top scope switch (Plan 03) + per-row scope pills (Plan 02) + coordinator empty captions (this plan) collectively closes the shape file's "any state where the reader can't tell whether the thing they're looking at is a role thing or an identity thing" spirit violation. Every empty state now reads as intentional; every wakeup row wears its scope; the top-of-modal control makes scope the primary axis.

No nginx / docker-compose / deploy surface touched. No worktrees used (sequential executor on main working tree `feat/tab-title-from-tmux`).

## Known Stubs

None. Phase 72 is complete after this plan. All four waves have shipped their code (backend CRUD parity → frontend WakeupsTab scope + CRUD → IdentityModal scope switch → coord empty states + polish). The only remaining artifact is Ashley's real-browser walk-through, which is a human-verify checkpoint — the artifact spec is inline in this SUMMARY (§ Human Verify Walk-through).

## TDD Gate Compliance

Task 1 is `tdd="true"`. Two commits form the RED/GREEN cycle:

- RED: `47d798db test(72-04): add failing IdentityModal.coordinator-empty tests (RED)` — test-only commit, 2 of 6 tests fail against pre-impl WakeupsTab + HandoffTab (the 2 new features), 4 pass (regression guards). Fail-fast validated: RED confirmed C1 + C2 fail specifically at the expected assertions.
- GREEN: `1a817962 feat(72-04): coordinator-Identity-view empty captions + Add-wakeup pill polish (GREEN)` — implementation commit; all 6 tests now pass.

No REFACTOR commit needed — the initial implementation is already at the right factoring (shared AddWakeupPill component, three-branch conditional structure documented inline).

Gate sequence verified in git log: `test(72-04)` at 47d798db → `feat(72-04)` at 1a817962. Compliant.

## Self-Check: PASSED

Files created:
- FOUND: src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx
- FOUND: .planning/phases/72-identity-modal-role-identity-scope-split-with-role-level-wak/72-04-SUMMARY.md (this file)

Files modified (verified via git diff HEAD~2):
- FOUND: src/ui/features/pretty-view/WakeupsTab.tsx
- FOUND: src/ui/features/pretty-view/HandoffTab.tsx
- FOUND: src/ui/features/pretty-view/IdentityModal.tsx

Commits:
- FOUND: 47d798db — test(72-04): add failing IdentityModal.coordinator-empty tests (RED)
- FOUND: 1a817962 — feat(72-04): coordinator-Identity-view empty captions + Add-wakeup pill polish (GREEN)
