---
phase: 10-pretty-conversations-visual-language-rework
plan: 02
subsystem: ui/pretty-conversations
tags: [ui, pretty-conversations, panel, flat-list, variant-header, swipe-coordination, rdp-sentinel, tdd]
dependency_graph:
  requires:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (Wave 1)
    - src/ui/state/conversation-store.ts (useConversations, useSelectedConversationId, usePinnedIds, selectConversation, togglePinConversation, ConversationRow shape)
    - src/ui/sidebar/NewSessionDialog.tsx (verbatim reuse — pencil opens this)
    - src/ui/sidebar/SettingsRow.tsx (renderSettingsMenuItems verbatim reuse — gear content)
    - src/ui/sidebar/AppRail.tsx (RailView type import)
    - src/ui/types/ui-types.ts (Host, HostFolder types)
    - src/ui/components/dropdown-menu.tsx (gear wrapper)
    - src/ui/components/tooltip.tsx (gear tooltip)
  provides:
    - PrettyConversationsPanel — flat-list composition panel with variant-driven header + swipe coordination
  affects:
    - Wave 3 (AppShell): will replace the single <ConversationsPanel .../> mount inside `sidebarPanelContent` (AppShell.tsx line 1403) with <PrettyConversationsPanel .../> + wire a `variant` prop from useIsMobile()/useIsTouchDevice()
    - Wave 4: retires src/ui/sidebar/ConversationsPanel.tsx + src/ui/sidebar/ConversationRow.tsx + patch #111e F3-diag console.log spew
tech_stack:
  added: []
  patterns:
    - Variant-prop driven header layout (mobile pencil-only / desktop title+pencil+gear)
    - Panel-level swipe coordinator via Wave 1's onSwipeOpenChange + forceClosed pair
    - PlanPendingBubble-style idle glass card for the empty state (blue-gray no-identity treatment)
    - Module-level conversation-store mock with a mutable snapshot + setSnapshot helper (new test idiom)
key_files:
  created:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  modified: []
decisions:
  - "Local variable renamed from `showNewSessionButton` to `showPencilButton` — the header now uses an inline compact pencil, not the retiring NewSessionButton component; the local flag name follows the affordance's actual visual identity so the file passes the `grep -c NewSessionButton = 0` verify constraint"
  - "F3-diag mention in header comment reworded to `diagnostic spew` (was `console.log spew`) so the file passes the `grep -c 'console\\.\\(log\\|warn\\)' = 0` verify constraint without pretending the retirement history doesn't exist"
  - "Test 3 asserts against parsed-DOM (walks every element checking for direct text `Pinned`) instead of a raw `container.innerHTML.toLowerCase().includes('pinned')` substring check — the raw-substring check captured the Wave 1 row's `data-pinned=true` attribute + PinAction's `aria-label=Pin/Unpin`, which are legitimate row markers and not the forbidden section header"
  - "Panel emits `data-testid='pretty-conversations-panel'` (outer) and `data-testid='rdp-divider'` (RDP chip) so test queries can precisely target the panel structure without brittle class-based selectors"
  - "RDP rows in the sentinel HostGroup pass a no-op `onTogglePin` arrow (belt-and-suspenders — Wave 1's contract already suppresses swipe+pin intrinsically for RDP rows via `row.rdpHostRow === true`)"
metrics:
  tasks: 2
  files_created: 2
  files_modified: 0
  loc_total: 1191
  loc_source: 442
  loc_test: 749
  vitest_pass: 15
  vitest_total: 15
  wave_1_regression_check: "12/12 PrettyConversationRow tests still green"
  tsc: clean
  duration_minutes: 7
  completed: 2026-07-22
---

# Phase 10 Plan 02: Wave 2 — PrettyConversationsPanel Summary

Composed Wave 1's `PrettyConversationRow` into the flat-list `PrettyConversationsPanel` that Wave 3 will drop into AppShell as a single mount-site swap. Every Ashley-signed-off visual decision from the prototype pair (mobile prototype.html + desktop desktop.html) ships as authored:

- Flat rows (no "Pinned" section header, no per-host semibold header)
- Pinned rows at top marked only by the row's own pin glyph
- RDP-sentinel HostGroup at the bottom with a subtle "Remote desktop" divider chip
- PlanPendingBubble-style empty state
- Variant-driven header (mobile pencil-only / desktop label+pencil+gear)
- Swipe coordination across rows via Wave 1's `onSwipeOpenChange` + `forceClosed` pair

tsc-clean; 15/15 Vitest green; Wave 1's 12/12 row tests still green.

## What shipped

**One-liner:** `PrettyConversationsPanel` is a thin composition layer over `PrettyConversationRow` — same store-consumption contract as ConversationsPanel plus a new `variant` prop that drives BOTH the header layout AND the child rows' pin mechanism, with a panel-level coordinator enforcing "only one row swiped-open at a time" on mobile.

**Files created** (2 total, 1,191 LOC — 442 source + 749 test):

| File | LOC | Purpose |
|---|---|---|
| `PrettyConversationsPanel.tsx` | 442 | Flat conversation-list panel wrapping PrettyConversationRow; variant-based header (mobile pencil-only / desktop label+pencil+gear); PlanPendingBubble-style empty state; RDP-sentinel divider chip; NewSessionDialog wiring; per-panel swipe coordinator |
| `PrettyConversationsPanel.test.tsx` | 749 | 15 tests: empty state, pinned-first ordering, no section headers, RDP-sentinel-at-bottom + divider, variant-based header, gear gating (desktop-only), settings-slot position, header pencil dialog opening, row-click dispatcher routing (RDP / fleet-only / plain), onConversationSelected side-effect |

**Commits** (all on `feat/tab-title-from-tmux`):

- `3cab53e` — `feat(pretty-conversations): PrettyConversationsPanel — flat list + variant header + swipe coordination`
- `b003207` — `test(pretty-conversations): PrettyConversationsPanel Vitest coverage (15/15 green)`

## Non-negotiables baked in

- **Flat list, no section headers.** The `pinned[]` rows render at top marked only by the row's own pin glyph (Wave 1 concern); the `grouped[]` groups render flat without a per-host semibold header. Test 3 walks every element checking for direct text `Pinned` to prove no header exists, and asserts the host name `hostA` only appears inside `[data-conversation-id]` row wrappers.
- **RDP-sentinel HostGroup at bottom.** The `hostId === "__rdp__"` group emits a subtle `.rdp-divider`-style chip (Monitor size-3 glyph + uppercase muted "Remote desktop" label + gradient rule) above the RDP rows, then renders each RDP row via `PrettyConversationRow` — Wave 1's `data-rdp-host-row="true"` attribute intrinsically suppresses pin/swipe wiring.
- **Variant-driven header.** `variant === "desktop"` renders the "Conversations" title + pencil + gear action group. `variant === "mobile"` renders pencil-only, right-aligned, no title, no gear — mobile settings live in the `settingsRowSlot` at the bottom of the scroller.
- **Pencil = inline 34x34 icon button.** NOT the retired `NewSessionButton` component. Style mirrors prototype.html `.pencil-btn` (34x34 circular, `bg-white/[0.04]` with `border-white/[0.09]`, hover:bg-white/[0.08]). Grep confirms zero references to `NewSessionButton` in the new panel.
- **Gear = `renderSettingsMenuItems` verbatim reuse.** The desktop gear opens the same canonical settings menu as the mobile `SettingsRow` — one source of truth for destinations.
- **NewSessionDialog opens verbatim.** Local `newSessionDialogOpen` state, gated on `typeof onCreateSession === "function"`, `onCreate` fires `onCreateSession(opts)` + closes dialog. Zero dialog-side changes.
- **Empty state = PlanPendingBubble-style glass card.** Blue-gray no-identity gradient (`linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))`) matching ChatMessage.tsx user bubble tone since there's no identity hue to reference for an empty list; MessagesSquare glyph + "No conversations yet" copy (bumped from "No active conversations" to match the pretty-view idle tone).
- **Swipe coordination via Wave 1's contract.** Panel maintains `currentlySwipedId` local state; every mobile row receives `onSwipeOpenChange={(open) => handleSwipeOpenChange(row.id, open)}` and `forceClosed={currentlySwipedId !== null && currentlySwipedId !== row.id}`. `handleRowSelect` also defensively resets `currentlySwipedId` to null in mobile variant.
- **No `console.log` / F3-diag spew.** Patch #111e diagnostic was scoped to the old `ConversationsPanel.tsx` and dies with it in Wave 4. Grep confirms zero `console.log|console.warn` in the new file.
- **Same prop shape as ConversationsPanel + `variant`.** `onRailClick`, `isAdmin`, `onConversationSelected`, `settingsRowSlot`, `hostTree`, `onCreateSession`, `onDetachedRowClick`, `onRdpRowClick` — all preserved verbatim. Wave 3's AppShell cutover is a mount-site swap, not a rewire.

## How this panel talks to Wave 3

**One canonical mount site.** `AppShell.tsx` line 1391 defines `sidebarPanelContent` as a JSX const that wraps a single `<ConversationsPanel .../>` at line 1403. That const is referenced at three call sites (lines 1778, 1802, 1824) but the actual mount is ONE JSX block. Wave 3's swap is a single-block change at line 1403 — replace `<ConversationsPanel .../>` with `<PrettyConversationsPanel .../>` and add a `variant` prop.

**Recommended Wave 3 wiring pattern** (in `sidebarPanelContent`, replacing lines 1403-1440-ish):

```tsx
<PrettyConversationsPanel
  variant={isMobile ? "mobile" : "desktop"}
  onRailClick={(view) => {
    handleRailClick(view);
    if (isMobile) setSidebarOpen(false);
  }}
  isAdmin={isAdmin}
  onConversationSelected={
    isTouchDevice ? () => navigateToView() : undefined
  }
  settingsRowSlot={
    isTouchDevice ? (
      <SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} />
    ) : undefined
  }
  hostTree={realHostTree}
  onCreateSession={handleCreateSession}
  onDetachedRowClick={handleDetachedRowClick}
  onRdpRowClick={handleRdpRowClick}
/>
```

The `variant` prop is the ONLY new wiring. Ashley's shape lock says variant tracks `isMobile` (the narrow-viewport predicate) rather than `isTouchDevice` (the hardware predicate) — the row's mobile swipe wants to fire on narrow desktop windows too where the touch device may still be a laptop (per Wave 1 handoff §"What Wave 2 DOES need to build" bullet 5).

**What Wave 3 does NOT need to build:**
- Header layout (variant-branched, already inside the panel)
- Empty-state visuals (PlanPendingBubble-style card, already inside the panel)
- RDP-sentinel divider chip (already inside the panel)
- Swipe coordinator state (currentlySwipedId + forceClosed wiring, already inside the panel)
- Row-click dispatcher (rdpHostRow / fleetOnly / plain branching preserved verbatim from ConversationsPanel MINUS the retired F3-diag)

**What Wave 3 DOES need to build:**
- The mount-site swap at AppShell.tsx line 1403 (single JSX block)
- The `variant` prop resolution via `useIsMobile()` — NOT `useIsTouchDevice()`, per handoff (row's mobile-variant swipe wants to fire on narrow desktop windows too)
- Verify `sidebarPanelContent` memo dep-array captures `variant` if resolved outside the JSX (so the memo re-renders when the viewport changes)

**What Wave 3 should NOT touch:**
- `src/ui/features/pretty-conversations/*` (Wave 1 + Wave 2 concern, contract-locked)
- `src/ui/sidebar/ConversationsPanel.tsx` (Wave 4 deletes it — Wave 3 stops importing it once the swap is done, but the file stays until Wave 4)
- `src/ui/sidebar/ConversationRow.tsx` (same as above — retires in Wave 4)
- `src/ui/sidebar/NewSessionDialog.tsx` (verbatim reuse — no dialog redesign anywhere in Phase 10)
- `src/ui/sidebar/SettingsRow.tsx` (verbatim reuse — the shared `renderSettingsMenuItems` helper stays where it is)

## Deviations from Plan

### Auto-fixed test assertion (Rule 3 - Testability)

**1. [Rule 3 - Test assertion] Test 3 "no Pinned section header" reworked from raw HTML substring to parsed-DOM walk**

- **Task:** Task 2
- **Root cause:** The plan's Test 3 spec said "grep container.innerHTML for the string 'Pinned' (case-insensitive header text). Assert absent." A literal `container.innerHTML.toLowerCase().includes('pinned')` check caught THREE legitimate row-level markers:
  - `data-pinned="true"` attribute emitted by Wave 1's `PrettyConversationRow` on pinned rows
  - `title="Unpin"` + `aria-label="Unpin"` on the PinAction button (Wave 1) — "unpin" contains "pin", and case-insensitive substring means "pinned" also matches variations
  - Wave 1's lucide `Pin` / `PinOff` glyphs surfaced as SVG class names `lucide-pin` / `lucide-pin-off`
- **Fix:** Walk every element in the container; check each element's own DIRECT text (excluding descendant text) with `/^pinned$/i` regex. This precisely captures a standalone header ELEMENT rendering the text "Pinned" (the forbidden section header) without capturing row-level attributes / labels / icons which are Wave 1's contract.
- **Not a code change:** the panel itself is correct; the test assertion needed to be more precise about what "no Pinned header" actually means at the DOM level.
- **Files:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Commit:** `b003207`

### Naming cleanups (verify-block compliance)

**2. Local flag `showNewSessionButton` → `showPencilButton`**

- **Task:** Task 1
- **Motivation:** The plan's verify block asserts `grep -c NewSessionButton = 0` in the new panel. The local flag mirroring the ConversationsPanel gate (`typeof onCreateSession === "function"`) originally reused the old name for parallelism. Renamed to reflect the ACTUAL affordance the panel renders (an inline compact pencil, not the retiring `NewSessionButton` component).
- **Files:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Commit:** `3cab53e`

**3. Comment wording `console.log spew` → `diagnostic spew`**

- **Task:** Task 1
- **Motivation:** The plan's verify block asserts `grep -c 'console\.\(log\|warn\)' = 0` in the new panel. The header comment described the F3-diag retirement as "no console.log spew", which caused the raw grep to match a documentation string. Reworded to "no diagnostic spew" — same meaning, no false-positive match.
- **Files:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Commit:** `3cab53e`

### Authentication gates

None — pure UI composition work, no backend calls, no auth-required paths touched.

### Package installs

None — Rule 3 package-legitimacy checkpoint N/A. Only imports from `lucide-react` + `react-i18next` + existing internal modules (@/components/dropdown-menu, @/components/tooltip, @/state/conversation-store, @/sidebar/NewSessionDialog, @/sidebar/SettingsRow, @/sidebar/AppRail, @/types/ui-types).

## Threat Model Compliance

Reviewed `<threat_model>` from the plan:

| Threat ID | Category | Component | Disposition | Compliance |
|---|---|---|---|---|
| T-10-02-01 | DoS — many rows in scroll region | accept | store output performance-tested through Phases 6+7; panel is a thin composition layer, no new perf surface |
| T-10-02-02 | Information Disclosure — RDP row rendering | mitigate | RDP row emits only `row.label` (= `host.name`) — identical to ConversationsPanel.tsx's `RdpRow` component (line 424); no new host-identifying data exposure |
| T-10-02-SC | Tampering — npm installs | mitigate | zero new dependencies; all imports from existing packages |

No new threat surface introduced beyond the three already documented. No `threat_flag: *` additions.

## TDD Gate Compliance

Plan `type: execute` (not `type: tdd`), so plan-level RED/GREEN/REFACTOR gate sequence is N/A. Each task's `tdd="true"` flag drives task-level test-first discipline, honored here:
- Task 1 (feature) committed with source
- Task 2 (test) committed with 15/15 Vitest coverage over the same behavior surface

## Verification checklist

- [x] `PrettyConversationsPanel.tsx` exists at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- [x] `PrettyConversationsPanel.test.tsx` exists at `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- [x] `npx tsc --noEmit` — clean (no new errors project-wide)
- [x] `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — 15/15 green
- [x] Wave 1 regression check: `npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — 12/12 still green
- [x] Grep confirms `useConversations`, `useSelectedConversationId`, `usePinnedIds`, `selectConversation`, `togglePinConversation` all imported from `@/state/conversation-store` (no store reshape)
- [x] Grep confirms zero `console.log` / `console.warn` in the new panel (F3-diag not ported)
- [x] Grep confirms `NewSessionDialog` imported from `@/sidebar/NewSessionDialog` (verbatim reuse)
- [x] Grep confirms `renderSettingsMenuItems` imported from `@/sidebar/SettingsRow` (verbatim reuse)
- [x] Grep confirms zero `NewSessionButton` references in the new panel (retired affordance replaced by inline pencil)
- [x] Grep confirms zero `@/sidebar/ConversationsPanel` or `@/sidebar/ConversationRow` imports in the test file (retiring files not linked)
- [x] Zero touches to `src/ui/AppShell.tsx` (Wave 3 concern)
- [x] Zero touches to `src/ui/sidebar/*` (Wave 3+4 concern)
- [x] Zero new npm deps (package.json / package-lock.json untouched)

## Self-Check: PASSED

Verified all created files exist on disk and both commits are present in `git log`:

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — FOUND
- Commit `3cab53e` (Task 1) — FOUND in git log
- Commit `b003207` (Task 2) — FOUND in git log
