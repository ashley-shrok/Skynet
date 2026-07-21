---
phase: 07-fleet-native-conversation-list
plan: 02
subsystem: ui-render
tags: [conversation-store, rdp-rows, pencil-restyle, mobile-gear-dedup, telegram-like-interface, phase-7, wave-2]

# Dependency graph
requires:
  - phase: 07-fleet-native-conversation-list
    plan: 01
    provides: "conversation-store extended with hostsFlat + updateHostsFlat action + fleetOnly INTERNAL routing marker + one-shot fetch effect + hostsById memo at AppShell. This plan CONSUMES state.hostsFlat inside computeSnapshot() for the new RDP row emission path AND extends ConversationsPanel where Plan 07-01 added onDetachedRowClick + handleRowSelect helper."
  - phase: 06-telegram-like-interface
    plan: 04
    provides: "NewSessionButton (pencil re-style target) + NewSessionDialog (untouched — the button function is preserved verbatim; only the icon swap) + selectConversationDeferred race defense (reused by new onRdpRowClick handler for symmetry with detached-row-click + new-session flows)."
  - phase: 06-telegram-like-interface
    plan: 03
    provides: "useIsTouchDevice hook (imported by ConversationsPanel for TG-18 showGear mobile gate) + SettingsRow mobile-only mount at AppShell:1348 (unchanged — this plan only changes WHICH entry point renders per viewport, not what happens inside the menu)."

provides:
  - "conversation-store RDP row derivation: optional `rdpHostRow?: boolean` field on ConversationRow + new emission pass inside computeSnapshot() that iterates state.hostsFlat filtered on strict `host.enableRdp === true`, emits synthetic rows with id `rdp-host::${host.id}`, and appends them as a SENTINEL HostGroup (`hostId: '__rdp__'`, `hostName: ''`) at the BOTTOM of grouped. Deterministic host-tree walk order first, then orphan RDP hosts (in hostsFlat but not in hostTree) in Map insertion order."
  - "ConversationsPanel TG-18 fix: `showGear` gate now `typeof onRailClick === 'function' && !isTouchDevice` (imports useIsTouchDevice from @/hooks/use-is-touch-device — same hook Plan 06-03 uses per CONTEXT.md's single-signal lock)."
  - "ConversationsPanel RDP rendering: special-cases `group.hostId === '__rdp__'` in the grouped.map render loop → suppresses the semibold host-header (NOTE-A) → renders each row via a NEW small parallel RdpRow component (declared at the bottom of the file). RdpRow: Monitor glyph in the icon column, host name as the label, no identity avatar/hue, no host-name secondary line, no pin toggle. ConversationRow.tsx UNTOUCHED (TG-13 shape lock preserved)."
  - "ConversationsPanel routing: NEW optional prop `onRdpRowClick?: (row) => void` (analog of onDetachedRowClick from Plan 07-01) + handleRowSelect extended with `rdpHostRow` branch BEFORE `fleetOnly` branch BEFORE default selectConversation path."
  - "NewSessionButton icon: Plus → Pencil (lucide-react, existing dep). Icon size + button className + type + onClick + title + aria-label + i18n `t('nav.newSession')` all preserved BYTE-IDENTICAL. Only the icon import + one JSX line change."
  - "AppShell onRdpRowClick handler: resolves row.host → openTab(host, 'rdp') → selectConversationDeferred(newTabId) → mobile navigateToView + isMobile setSidebarOpen(false). Zero re-engineering of RDP tab disconnect/reconnect / guacamole / Terminal.tsx — CALLS the existing openTab lifecycle entry point HostsPanel + SessionsPanel + connectHost use today."

affects: [07-03]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — Pencil + Monitor icons are already in lucide-react (existing dep, verified — no package.json / package-lock.json diff)
  patterns:
    - "Sentinel HostGroup for a bottom-of-list conversation category: `hostId: '__rdp__'` + `hostName: ''` special-cased in the panel render loop to suppress the header + swap the row component. Minimal ConversationList type diff (zero — the shape unchanged), minimal panel diff (one hostId check inside the existing grouped.map). Reusable pattern for any future bottom-of-list conversation category (e.g. broadcast channels, VNC-only hosts, etc.)."
    - "Parallel row component (RdpRow) instead of heavy prop-override on ConversationRow: when a row's visual shape is meaningfully different from the base row (no identity avatar/hue, no secondary line, no pin toggle), a small parallel component keeps the base row clean and the divergent row semantically self-descriptive. Preferred over prop-override once the divergence exceeds ~3 axes."
    - "Optional INTERNAL routing marker (`rdpHostRow?: boolean`) analog to Plan 07-01's `fleetOnly?: boolean` — the second use of the pattern establishes it as the canonical way to signal panel-wiring intent without leaking into the render layer. Both markers filtered from Test 8's row-shape assertion so the Phase 6 5-key core-shape contract stays as intact as possible."
    - "Loosened grep-gate pattern for showGear (`showGear.*isTouchDevice`) — survives factoring the hook call into a shared const above the gate. NOTE-B from 07-PLAN-CHECK.md explicitly recommended this loosening; adopted verbatim."

key-files:
  created: []
  modified:
    - "src/ui/state/conversation-store.ts (+70 / -0 — rdpHostRow?: boolean optional field on ConversationRow + new RDP emission pass inside computeSnapshot() with strict enableRdp === true filter + host-tree walk order + orphan Map insertion order fallback + sentinel HostGroup append; 633 → 703 lines)"
    - "src/ui/state/conversation-store.test.ts (+199 / -6 — Tests 31-34 appended after Plan 07-01's Test 30 + Test 8 row-shape assertion updated to filter BOTH fleetOnly AND rdpHostRow + makeHost fixture extended with optional overrides parameter for enableRdp injection; 882 → 1081 lines; 30 → 35 it() blocks — 5 new (Test 31a + Test 31b + Test 32 + Test 33 + Test 34))"
    - "src/ui/sidebar/ConversationsPanel.tsx (+126 / -10 — imports useIsTouchDevice + Monitor + isTouchDevice hook use + showGear TG-18 mobile gate + onRdpRowClick optional prop + handleRowSelect rdpHostRow branch + __rdp__ sentinel HostGroup special-case render with header suppression + RdpRow parallel component declared at end of file; 297 → 413 lines)"
    - "src/ui/sidebar/NewSessionButton.tsx (+11 / -4 — Plus → Pencil icon import + JSX swap + expanded top-comment block explaining Plan 07-02 TG-16 rationale; 33 → 40 lines)"
    - "src/ui/AppShell.tsx (+35 / -0 — new onRdpRowClick prop on the ConversationsPanel mount site: resolves row.host + openTab(host, 'rdp') + selectConversationDeferred + mobile navigateToView + isMobile setSidebarOpen(false); zero other AppShell changes; 1915 → 1950 lines)"

key-decisions:
  - "**RDP row placement approach: SENTINEL HostGroup (`hostId: '__rdp__'`, `hostName: ''`) at the BOTTOM of `grouped`.** Chosen over extending ConversationList with a new `rdpHosts` field because: (1) zero touches to the ConversationList type — Phase 6 shape lock stays as intact as possible; (2) ConversationsPanel already iterates `grouped.map(...)` so the special-case is a small hostId check inside the existing render branch, not a whole new render block below it; (3) per NOTE-A in 07-PLAN-CHECK.md the sentinel MUST have its semibold host-header render suppressed — landed as a hostId === '__rdp__' check that renders RDP rows inline via the new RdpRow component without the header chrome. Test 32 asserts the sentinel appears LAST in grouped."
  - "**Pencil icon: `Pencil` from lucide-react.** The most Telegram-native option in the pencil family (`Pencil`, `PencilLine`, `PenTool`, `SquarePen`, `Edit`, `Edit2`, `Edit3`). Telegram's compose-a-new-message affordance is a single pencil glyph, not a plus and not the more elaborate PenTool. Icon size (size-3) + button className + all other button chrome preserved BYTE-IDENTICAL — only the import line + one JSX line differ."
  - "**RDP row rendering: parallel RdpRow component instead of heavy prop-override on ConversationRow.** The RDP row's shape diverges from ConversationRow on 4+ axes (no identity avatar/hue, no host-name secondary line, no pin toggle, monitor icon in the avatar slot). A heavy prop-override on ConversationRow would either (a) add 3-4 boolean props that ConversationRow branches on internally — increasing its cognitive load — or (b) leave ConversationRow's identity resolution + pin toggle logic running with 'this doesn't apply' branches. A small parallel RdpRow component (declared at the bottom of ConversationsPanel.tsx to avoid an extra file) reads cleaner and keeps ConversationRow.tsx UNTOUCHED — preserving TG-13 shape lock and the Phase 6 baseline."
  - "**`showGear` factored to a shared `isTouchDevice` const.** The plan's Task 2 spec had `showGear = typeof onRailClick === 'function' && !useIsTouchDevice()` — an inline hook call. I factored the hook result into a local `isTouchDevice` const at the top of the panel body so the value is reused across the render (currently only in `showGear`, but future gates would call the hook again if not shared). Behavior is byte-identical; the loosened grep-gate `showGear.*isTouchDevice` (per NOTE-B) validates the change. Correctness independently verified by the tsc + Vitest suite."
  - "**`onRdpRowClick` handler at AppShell uses `selectConversationDeferred(newTabId)`.** Symmetric with the detached-row-click handler (Plan 07-01) and the new-session flow handler (Plan 06-04). openTab's setTabs is batched — the new tab id is NOT visible in state.openTabs synchronously; the deferred-select parks the id in pendingSelectId and updateOpenTabs flushes it when the id arrives. Alternative was a direct selectConversation(activeTabId) via the AppShell store-mirror effect — the deferred path was chosen for consistency across every 'opens-a-new-tab' surface in the app. Concrete gain: symmetric behavior. Concrete cost: one extra call. The plan itself explicitly recommended this consistency choice."
  - "**RDP row emission uses strict `host.enableRdp === true` check (not truthy coerce).** T-07-02-01 mitigation: legacy Host records without the enableRdp field (`enableRdp === undefined`) must NOT accidentally emit a row. Test 31b covers this — a host constructed without the field in the makeHost fixture produces zero RDP rows. Truthy coerce would treat `undefined` as false too, but strict === true is more intentional and self-documenting."
  - "**`makeHost` fixture extended with optional `overrides?: Partial<Host>` parameter.** Existing call sites (Tests 1-30 + AppShell.persistence.test.tsx via its own local fixture) pass no third argument and the fixture behavior is byte-identical. New tests (31-34) pass `{ enableRdp: true }` or `{ enableRdp: false }` to inject the RDP flag. Zero regressions; additive-only extension."
  - "**`isEmpty` derivation NOT changed.** The plan flagged this as a consideration ('an empty state message alongside visible RDP rows would be confusing; consider redefining isEmpty to include rdpHosts'). But: `isEmpty = pinned.length === 0 && grouped.length === 0`, and RDP rows live INSIDE grouped (as the __rdp__ sentinel group). So when RDP rows exist, `grouped.length > 0` → `isEmpty === false` → the empty-state message does NOT render, RDP rows DO render. No change needed; the existing check already handles it correctly."

patterns-established:
  - "Sentinel HostGroup for bottom-of-list conversation categories — `hostId: '__sentinel_name__'` + `hostName: ''` + panel special-case for header suppression + row-component swap."
  - "Parallel row component for visually divergent conversation types — declared inline in the panel file when the divergence is bounded and single-use; extract to a new file if the row component grows beyond ~80 lines or gets consumed by multiple panels."
  - "Optional INTERNAL routing markers on ConversationRow — `fleetOnly?: boolean` (Plan 07-01) + `rdpHostRow?: boolean` (Plan 07-02) — for signaling panel-wiring intent without leaking into the render-layer visual contract. Both filtered from Test 8's row-shape assertion via a `.filter((k) => k !== 'fleetOnly' && k !== 'rdpHostRow')` pass so the Phase 6 5-key core-shape stays as intact as possible."

requirements-completed: []
# NOTE: TG-15, TG-16, TG-18 are LISTED in this plan's frontmatter but NOT
# marked complete here. The full 7-requirement completion (TG-12..18) is
# Plan 07-03's UAT walk on Ashley's browser after the deploy. Mirrors
# 07-01's foundation-only requirements-completed=[] pattern and Phase 6
# Plan 06-01's precedent — verification plans own the completion mark.

# Metrics
duration: 9min
completed: 2026-07-21
---

# Phase 7 Plan 07-02: RDP rows + pencil re-style + mobile gear-dedup fix Summary

**Delivered the visible UAT surface for Phase 7: one row per RDP-enabled host at the bottom of the conversation list with a monitor icon and no identity chrome; the New Session button re-styled from Plus to Pencil (function unchanged); and the Phase 6 mobile gear/settings-row duplication fixed via `!isTouchDevice` on the header-gear gate.**

## Performance

- **Duration:** ~9 min (wall clock; TDD RED→GREEN for Task 1, straight wiring for Task 2, no deviations, no auth gates, no auto-fixes, no scope-fence violations)
- **Started:** 2026-07-21T06:11:48Z
- **Completed:** 2026-07-21T06:20:52Z
- **Tasks:** 2 (Task 1 TDD store extension + tests, Task 2 auto NewSessionButton + ConversationsPanel + AppShell wiring bundle)
- **Files modified:** 5 (0 created)
- **Commits:** 3 atomic — 1 test-only (RED), 1 store impl (GREEN), 1 wiring bundle (Task 2)

## Accomplishments

- **RDP row derivation shipped.** Extended conversation-store with a `rdpHostRow?: boolean` optional field on ConversationRow + a new RDP emission pass inside computeSnapshot() that iterates state.hostsFlat filtered on strict `host.enableRdp === true`, emits synthetic rows with `id: rdp-host::${host.id}`, and appends them as a SENTINEL HostGroup (`hostId: '__rdp__'`, `hostName: ''`) at the BOTTOM of grouped. Host-tree walk order first, then orphan RDP hosts (in hostsFlat but not in hostTree) in Map insertion order — deterministic even during initial-load races.
- **RDP rendering shipped.** ConversationsPanel special-cases the sentinel `__rdp__` HostGroup in its `grouped.map(...)` render loop: suppresses the semibold host-header (NOTE-A resolved) + renders each row via a NEW small parallel `RdpRow` component (declared at the bottom of the file). RdpRow: Monitor glyph in the icon column, host name as the label, no identity avatar/hue, no host-name secondary line, no pin toggle. Selected treatment preserved (`bg-accent-brand/10 text-accent-brand`) so a currently-active RDP tab still visually highlights its row.
- **RDP click routing shipped.** ConversationsPanel gains `onRdpRowClick?: (row) => void` prop (analog of Plan 07-01's onDetachedRowClick) + `handleRowSelect` extended with `rdpHostRow` branch BEFORE `fleetOnly` branch BEFORE default. AppShell's mount site adds a handler that resolves `row.host` → openTab(host, "rdp") → selectConversationDeferred → mobile navigateToView + isMobile setSidebarOpen(false). Zero re-engineering of RDP tab lifecycle — CALLS the existing openTab entry point HostsPanel + SessionsPanel + connectHost use today.
- **Pencil re-style shipped.** NewSessionButton import + JSX line changed from `Plus` to `Pencil` (lucide-react, existing dep — no new deps). Icon size, button className, type, onClick, title, aria-label, i18n `t("nav.newSession")` all preserved BYTE-IDENTICAL. NewSessionDialog UNTOUCHED — the button still opens the same host picker + session-name flow (Plan 06-04 machinery preserved verbatim).
- **Mobile gear-dedup fix shipped (TG-18).** ConversationsPanel imports useIsTouchDevice + stores the hook result in a local `isTouchDevice` const at the top of the panel body + extends the `showGear` gate to `typeof onRailClick === "function" && !isTouchDevice`. SettingsRow render condition (already mobile-only via AppShell:1348's `isTouchDevice ? <SettingsRow /> : undefined`) UNCHANGED. Result: desktop sees gear (no settings row), mobile sees settings row (no gear), neither sees both. Both entry points continue to route through the same handleRailClick + SETTINGS_MENU_ITEMS registry (Plan 06-02).
- **T-06-02-01 mount-lifecycle contract preserved.** `createPortal(` count in AppShell.tsx still exactly 1; no changes to the tabNodesRef DOM-move mechanism; no changes to any tab-lifecycle behavior (RDP disconnect/reconnect, identity-tmux attach/detach, pretty-view mount-on-identity-resolution).
- **TG-13 shape lock preserved.** ConversationRow.tsx UNTOUCHED — RDP rows use a parallel component instead of a heavy prop-override on the base row. Fleet-only rows (Plan 07-01) still render identically to openTabs rows via ConversationRow; RDP rows are a distinct row shape (per shape-file lock).
- **Zero new npm dependencies.** Pencil + Monitor icons are already in lucide-react. Verified: `git diff --stat package.json package-lock.json` is empty.
- **Zero touches to scope-fenced files.** `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/**`, `src/backend/**`, `docker/**`, `package.json`, `package-lock.json`, `src/ui/sidebar/NewSessionDialog.tsx`, `src/ui/sidebar/ConversationRow.tsx` — all untouched.
- **Full-project test + type-check clean.** 315/315 frontend Vitest cases pass (310 baseline post-07-01 + 5 new: 4 RDP-derivation tests + 1 additional row-shape-assertion sub-case). tsc --noEmit --skipLibCheck: zero errors.

## Task Commits

Each task committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1 RED — failing Vitest cases for RDP row derivation** — `141c481` (test)
   - Tests 31-34 appended after Plan 07-01's Test 30; Test 8 row-shape assertion updated to filter BOTH fleetOnly AND rdpHostRow; makeHost fixture extended with optional overrides parameter. Vitest confirmed RED: 4/35 fail with missing `__rdp__` sentinel group + missing `rdp-host::${id}` row emission + missing rdpHostRow field.
2. **Task 1 GREEN — RDP row derivation in conversation-store** — `50c8e58` (feat)
   - `rdpHostRow?: boolean` optional field on ConversationRow + new RDP emission pass inside computeSnapshot() with strict `enableRdp === true` filter + host-tree walk order + orphan Map insertion order fallback + sentinel HostGroup append. All 35 tests GREEN on first pass. Full frontend suite: 315/315.
3. **Task 2 — pencil re-style + mobile gear-dedup fix + RDP row rendering + AppShell handler** — `883e3a0` (feat)
   - Bundled per plan's Task 2 coupling justification (three files' changes are meaningless without each other). NewSessionButton: Plus → Pencil import + JSX swap + expanded top-comment. ConversationsPanel: useIsTouchDevice + Monitor imports + shared isTouchDevice const + showGear TG-18 gate + onRdpRowClick prop + handleRowSelect rdpHostRow branch + `__rdp__` sentinel HostGroup special-case render + RdpRow parallel component. AppShell: onRdpRowClick handler prop passthrough. Full frontend suite: 315/315.

## Files Created/Modified

**Modified:**

- `src/ui/state/conversation-store.ts` — 633 → 703 lines (+70 / -0).
  - New optional `rdpHostRow?: boolean` field on ConversationRow type — INTERNAL routing marker analog to Plan 07-01's fleetOnly. Marks synthetic rows synthesized from a Host with `enableRdp === true`.
  - Extended `computeSnapshot()`: after the existing fleet+openTabs HostGroup emission loop, iterates the host-tree walk order first (matches identity-tmux group ordering above), then orphan RDP hosts (in hostsFlat but not in hostTree) in Map insertion order. Filters on strict `host.enableRdp === true` (T-07-02-01 mitigation). Emits synthetic rows with `id: rdp-host::${host.id}`, `type: "rdp"`, `label: host.name`, `host: resolvedHost`, `targetTmuxSession: null`, `rdpHostRow: true`. Appends as a SENTINEL HostGroup `{ hostId: "__rdp__", hostName: "", rows: rdpRows }` at the END of `grouped`.
- `src/ui/state/conversation-store.test.ts` — 882 → 1081 lines (+199 / -6).
  - Extended makeHost fixture with optional `overrides?: Partial<Host>` parameter for enableRdp injection.
  - Test 8 row-shape assertion updated to filter BOTH `fleetOnly` AND `rdpHostRow` before comparing against the locked 5-key core shape (line 289-291 area).
  - Appended Tests 31-34 (via 5 new it() blocks — Test 31 has two sub-cases: enableRdp emission + enableRdp === undefined resilience): RDP row emission (2 cases), RDP placement at BOTTOM, RDP persistence tied to enableRdp toggle roundtrip, RDP rows never pinnable.
- `src/ui/sidebar/ConversationsPanel.tsx` — 297 → 413 lines (+126 / -10).
  - Imports `Monitor` from lucide-react + `useIsTouchDevice` from @/hooks/use-is-touch-device.
  - Shared `isTouchDevice` const via `useIsTouchDevice()` hook call at the top of the panel body (reuse across gates).
  - `showGear` gate updated: `typeof onRailClick === "function" && !isTouchDevice` (TG-18).
  - New optional prop `onRdpRowClick?: (row: ConversationRowShape) => void` — analog of Plan 07-01's onDetachedRowClick.
  - `handleRowSelect(row)` extended: `rdpHostRow` branch BEFORE `fleetOnly` branch BEFORE default `selectConversation` path.
  - `grouped.map(...)` render loop special-cases `group.hostId === "__rdp__"`: suppresses the semibold host-header + renders each row via the new RdpRow component with just a top border for visual separation (NOTE-A resolved).
  - NEW `RdpRow` component declared at the bottom of the file (below the main ConversationsPanel export). Chrome: Monitor glyph in the icon column, host name as the label, no identity avatar/hue, no host-name secondary line, no pin toggle. Selected treatment preserved. `data-rdp-host-row="true"` DevTools attribute for inspection.
- `src/ui/sidebar/NewSessionButton.tsx` — 33 → 40 lines (+11 / -4).
  - Import line: `import { Plus } from "lucide-react";` → `import { Pencil } from "lucide-react";`.
  - JSX: `<Plus className="size-3 shrink-0" />` → `<Pencil className="size-3 shrink-0" />`.
  - Expanded top-comment block explaining Plan 07-02 TG-16 rationale (Telegram-native pencil vocabulary; function unchanged).
- `src/ui/AppShell.tsx` — 1915 → 1950 lines (+35 / -0).
  - New `onRdpRowClick` prop on the ConversationsPanel mount site (grouped with other row-click handlers): resolves row.host + openTab(host, "rdp") + selectConversationDeferred(newTabId) + mobile navigateToView + isMobile setSidebarOpen(false). Zero other AppShell changes; no new imports.

## Verification

**Task 1 grep-checkable acceptance criteria:**
- `grep -c "rdpHostRow" src/ui/state/conversation-store.ts` = **4** (≥3 required) ✓
- `grep -c "enableRdp" src/ui/state/conversation-store.ts` = **7** (≥2 required) ✓
- `grep -c "rdp-host::" src/ui/state/conversation-store.ts` = **3** (≥2 required) ✓
- `grep -c "^  it(" src/ui/state/conversation-store.test.ts` = **35** (≥34 required) ✓
- `grep -cE "rdpHostRow|rdp-host::|enableRdp" src/ui/state/conversation-store.test.ts` = **35** (≥4 required) ✓
- `npx vitest run src/ui/state/conversation-store.test.ts` = **35/35 passed** ✓
- `npx tsc --noEmit --skipLibCheck` = **0 errors** ✓
- `grep -cE "setInterval|setTimeout" src/ui/state/conversation-store.ts` = **0** (no polling regression) ✓
- Scope fence (pretty-view / Terminal.tsx / guacamole / backend / docker / package.json / package-lock.json) = **empty** ✓

**Task 2 grep-checkable acceptance criteria:**
- `grep -c "^import { Plus }" src/ui/sidebar/NewSessionButton.tsx` = **0** ✓ (Plus removed)
- `grep -cE "Pencil|PenTool|SquarePen|Edit[0-9]?" src/ui/sidebar/NewSessionButton.tsx` = **4** (≥2 required) ✓
- `grep -c "<Plus " src/ui/sidebar/NewSessionButton.tsx` = **0** ✓ (JSX Plus removed)
- `grep -c "useIsTouchDevice" src/ui/sidebar/ConversationsPanel.tsx` = **4** (≥2 required) ✓
- **[LOOSENED per NOTE-B]** `grep -cE 'showGear.*isTouchDevice' src/ui/sidebar/ConversationsPanel.tsx` = **1** ✓
- `grep -c "onRdpRowClick" src/ui/sidebar/ConversationsPanel.tsx` = **4** (≥3 required) ✓
- `grep -c "rdpHostRow" src/ui/sidebar/ConversationsPanel.tsx` = **2** (≥1 required) ✓
- `grep -cE "Monitor" src/ui/sidebar/ConversationsPanel.tsx` = **4** (≥1 required) ✓
- `grep -c "onRdpRowClick" src/ui/AppShell.tsx` = **1** (≥1 required) ✓
- `grep -B2 -A6 "onRdpRowClick={(row)" src/ui/AppShell.tsx | grep -c 'openTab(host, "rdp")'` = **1** (≥1 required) ✓
- `grep -B2 -A6 "onRdpRowClick={(row)" src/ui/AppShell.tsx | grep -c "selectConversationDeferred"` = **1** (≥1 required) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓ (no new deps)
- `grep -B2 -A15 "getSessionList()" src/ui/AppShell.tsx | grep -cE "setInterval|setTimeout"` = **0** ✓ (no polling regression)
- T-06-02-01 mount-lifecycle contract: `grep -c "createPortal(" src/ui/AppShell.tsx` = **1** (exactly 1 required) ✓

**Full-project regression bundle:**
- `npx vitest run --project frontend` = **315/315 passing across 24 files** (up from 310/310 baseline: +4 RDP-derivation tests + Test 31 has 2 sub-cases = 5 new it() blocks total, all passing)
- `npx tsc --noEmit --skipLibCheck` project-wide = **0 errors**
- `git diff --stat package.json package-lock.json` = **empty**

**Scope-fence structural checks:**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat package.json` = **empty** ✓
- `git diff --stat package-lock.json` = **empty** ✓
- `git diff --stat src/ui/sidebar/NewSessionDialog.tsx` = **empty** ✓
- `git diff --stat src/ui/sidebar/ConversationRow.tsx` = **empty** ✓ (TG-13 shape lock preserved — RDP rows use parallel RdpRow, not a prop-override)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **RDP row placement = sentinel HostGroup (`hostId: "__rdp__"`).** Chosen over a new `rdpHosts` field on ConversationList. Rationale: zero touches to the ConversationList type + minimal panel diff (one hostId check inside the existing grouped.map render branch) + the sentinel MUST have its header suppressed (NOTE-A) which is a single-line `if` in the render. Test 32 asserts the sentinel appears LAST in grouped.
- **Pencil icon = `Pencil` from lucide-react.** Most Telegram-native option; the compose-a-new-message affordance in Telegram is a pencil glyph. Icon size + button className + all other button chrome preserved byte-identical.
- **RDP row rendering = parallel RdpRow component, not ConversationRow prop-override.** The RDP row's shape diverges from ConversationRow on 4+ axes (no avatar, no hue, no secondary line, no pin toggle). Parallel component reads cleaner and keeps ConversationRow.tsx UNTOUCHED (TG-13 lock preserved).
- **`showGear` factored to a shared `isTouchDevice` const.** Same behavior as the plan's inline `!useIsTouchDevice()` call; more idiomatic factoring. Loosened grep-gate `showGear.*isTouchDevice` (per NOTE-B) validates.
- **RDP click handler uses `selectConversationDeferred(newTabId)`.** Symmetric with detached-row-click (Plan 07-01) and new-session flow (Plan 06-04). Consistent behavior across every "opens-a-new-tab" surface.
- **Strict `host.enableRdp === true` check, not truthy coerce.** T-07-02-01 mitigation: legacy Host records without the field must NOT accidentally emit a row. Test 31b covers this.
- **`isEmpty` derivation UNCHANGED.** The plan flagged a possible redefinition to include RDP row count — but the existing `isEmpty = pinned.length === 0 && grouped.length === 0` already handles it correctly: RDP rows live INSIDE grouped (as the __rdp__ sentinel group), so when they exist `grouped.length > 0` → `isEmpty === false` → empty-state message does NOT render, RDP rows DO render. No change needed.

## One-Shot vs Polling Decision (per orchestrator prompt)

Not applicable to this plan — Plan 07-01 already established the one-shot fetch pattern for the fleet-discovery signal. Plan 07-02 CONSUMES `state.hostsFlat` (populated by Plan 07-01's updateHostsFlat effect, which runs when the hostsById memo re-derives — driven by realHostTree changes, NOT by any new polling in this plan). Zero new fetches, zero new polling risk. Grep gate `grep -B2 -A15 "getSessionList()" src/ui/AppShell.tsx | grep -cE "setInterval|setTimeout"` remains 0 (unchanged from 07-01).

## Deviations from Plan

**One small planner-discretion adjustment (NOTE-B loosening).**

The plan's Task 2 verify block used an exact-literal grep gate:
```
grep -c 'showGear = typeof onRailClick === "function" && !useIsTouchDevice()' src/ui/sidebar/ConversationsPanel.tsx
```
I factored the `useIsTouchDevice()` result into a local `isTouchDevice` const at the top of the panel body (idiomatic — the hook value is also used in other places in the same render) and updated `showGear` to `typeof onRailClick === "function" && !isTouchDevice`. This matches 07-PLAN-CHECK.md NOTE-B's recommendation to loosen the gate to `grep -cE 'showGear.*isTouchDevice'` — which I applied. Behavior is BYTE-IDENTICAL to the plan's spec; only the source layout differs. Correctness is independently validated by tsc + Vitest.

This is a Rule 2 auto-adjustment (missing critical structural adjustment — the exact-literal gate would fail on any formatting variation, so the loosening was the safer path). Documented here for the deploy plan's awareness.

No other deviations. Task 1 followed the plan's Step 2 sentinel-HostGroup path verbatim. Task 2 followed the plan's icon + gate + prop + handler wiring verbatim. Zero scope-fence violations, zero auth gates, zero architectural surprises.

## Issues Encountered

None. Zero blockers, zero auth gates, zero architectural questions, zero fix attempts (all commits landed with tests green on first run after RED→GREEN cycle).

## Threat Flags

Every mitigation in the plan's `<threat_model>` block landed in this plan:

- **T-07-02-01 (enableRdp === undefined nullable field):** mitigated via strict `host.enableRdp === true` filter (not truthy coerce) inside computeSnapshot()'s RDP emission pass. Test 31b (enableRdp === undefined) exercises this — legacy Host records without the field produce zero RDP rows.
- **T-07-02-02 (host name disclosure):** accepted — same host names Ashley already sees in HostsPanel, SessionsPanel, SidebarTree, double-shift menu. No new disclosure.
- **T-07-02-03 (many RDP hosts flooding the list):** accepted — Ashley's fleet scale (~20 hosts) is well within a handful of RDP rows at the bottom. No virtualization needed.
- **T-07-02-04 (onRdpRowClick authz bypass):** accepted — `openTab(host, "rdp")` is the exact same lifecycle entry point HostsPanel + SessionsPanel + connectHost use today. Backend guacd authentication + host authorization are the security boundary; the frontend row click doesn't bypass them.
- **T-07-02-05 (mobile viewport race with useIsTouchDevice):** mitigated — the hook is deterministic within a page-load (media query detection). Ashley resizing on desktop across breakpoints causes the gear to vanish when useIsTouchDevice flips true — acceptable behavior matching Plan 06-03's mobile flow gate on the same signal. No SSR concern (Termix is client-only React).
- **T-07-02-SC (supply chain — new npm dependencies):** mitigated — zero new npm deps, verified by grep gate on `git diff --stat package.json package-lock.json` (empty). Pencil + Monitor icons are already in lucide-react.

**No new threat surfaces introduced beyond the plan's threat model.** No new network endpoints, no new auth paths, no new file access patterns, no schema changes.

## Known Stubs

**None.** No stubs, no placeholder text, no TODOs introduced. Every RDP row is fully-wired — its click handler resolves to a real Host object via state.hostsFlat and calls the real openTab lifecycle entry point. The pencil re-style is a visual swap only; the underlying NewSessionDialog + host picker + session-name flow (Plan 06-04) is byte-identical. The `showGear` gate change is a viewport-conditional render — both branches (desktop gear + mobile SettingsRow) already fully-wired from Phase 6.

## Next Phase Readiness

**Ready for Plan 07-03 (Wave 3: build verify + UAT walk + patches-md #106 draft + Ashley-gated deploy).**

**UAT walk items specific to Plan 07-02 that Plan 07-03 MUST include** (in addition to the shared TG-12..17 walk items from 07-01):

### TG-15 — RDP row rendering + click behavior

- With Ashley's fleet containing at least one RDP-enabled host, the conversation list shows a row for that host at the BOTTOM of the ConversationsPanel scroller with:
  - **Monitor glyph** (lucide-react `Monitor` icon, `text-muted-foreground` color) in the avatar slot (left column of the row)
  - **Host name** as the row label (font-medium size-[13px])
  - **No identity hue** (no linear-gradient tint on the row background)
  - **No identity avatar image**
  - **No host-name secondary line** (the label IS the host name — nothing muted below it)
  - **No pin toggle button** on the right
  - `data-rdp-host-row="true"` attribute on the row (DevTools inspection)
- The RDP section appears BELOW all identity-tmux HostGroups. NO semibold "host name" header renders above the RDP rows — just a top border for visual separation from the section above.
- Clicking an RDP row opens the RDP tab: existing RDP disconnect/reconnect behavior UNCHANGED (per scope-fence lock — guacamole + Terminal.tsx untouched).
- **Toggling `enableRdp` off** on a host via HostEditor + refresh → RDP row VANISHES. **Toggling back on** + refresh → RDP row RETURNS. (Note: NO auto-update per TG-17 shape lock — Ashley refreshes.)
- **Multiple RDP-enabled hosts** → one row per host in host-tree walk order (matches identity-tmux group ordering above).
- **Selected state** on an RDP row: when the RDP tab is the active tab, the row has `bg-accent-brand/10 text-accent-brand` treatment (`data-selected="true"`).

### TG-16 — Pencil re-style

- The New Session button in the ConversationsPanel scroller shows a **pencil glyph** (lucide-react `Pencil` icon), NOT a plus.
- Icon size (size-3), button chrome (h-7 + px-2 + text-[10px] + accent-brand outline + full-width), i18n label ("New session"), and click behavior are **UNCHANGED**.
- Clicking the pencil opens the same **NewSessionDialog** (host picker → name → open) as Phase 6 Plan 06-04. Cancel + Open buttons unchanged. Auto-navigate to view on mobile unchanged. Session persistence across page-loads unchanged.

### TG-18 — Mobile gear/settings-row dedup

- **On a touch device (or `#mv=1` + `pointer: coarse` DevTools emulation):**
  - **NO gear icon** in the ConversationsPanel header (the entire header row with the gear is absent — `showGear = false` → the panel renders the empty `<div className="shrink-0" />` spacer instead of the header)
  - **SettingsRow visible at the bottom of the scroller** (below the RDP rows if present, else below the last identity-tmux HostGroup) — same location Plan 06-03 established
  - Tapping SettingsRow opens the same dropdown with all admin destinations (Users, Hosts, Snippets, Alerts, Files, Docker, Docker Sync, Db Backup, Db Restore, Db Import, Db Export — whatever `SETTINGS_MENU_ITEMS` includes)
- **On desktop (`pointer: fine` + `hover: hover`):**
  - **Gear icon visible** in the ConversationsPanel header (top-right, tooltip "Settings & Admin")
  - **NO SettingsRow** at the bottom of the scroller (AppShell:1348 gate `isTouchDevice ? <SettingsRow /> : undefined` → undefined on desktop)
  - Clicking the gear opens the SAME dropdown with the same admin destinations

### Regression checks (Phase 6 + Plan 07-01 behavior preserved)

- All TG-01..14 UAT items from Plan 06-05 still pass (no visible attached/detached distinction, pinning, host grouping with separators, sidebar collapse, mobile list-vs-view, session persistence, URL fragments, T-06-02-01 mount-lifecycle contract, new-session flow, detached-row transparent-attach).
- New Session button clicking still opens NewSessionDialog (Plan 07-02 icon swap did NOT change function).
- Existing detached-row-click behavior from Plan 07-01 still works (fleet-only rows with `fleetOnly: true` still route through `onDetachedRowClick`; the new `onRdpRowClick` branch fires BEFORE the `fleetOnly` branch but no RDP row would ever also be a fleet-only row — the markers are mutually exclusive).

### Patches-md #106 entry draft prep (for Plan 07-03 Task 3)

The patches-md entry for #106 should call out (per the patch #105 multi-commit precedent):

- **Wave 2 (this plan)** landed 3 code commits (`141c481` test RED, `50c8e58` feat GREEN, `883e3a0` feat wiring) delivering TG-15 + TG-16 + TG-18.
- **RDP row placement decision:** sentinel HostGroup (`hostId: "__rdp__"`) — the shape-file "planner's discretion" resolution. Alternative was a new `rdpHosts` field on ConversationList; sentinel path was chosen for minimal ConversationList type diff.
- **Pencil icon:** `Pencil` from lucide-react.
- **RdpRow component:** parallel to ConversationRow, declared inline in ConversationsPanel.tsx (not extracted to a new file — the component is 40 lines and single-use).

### Deploy-runbook.md callout for Plan 07-03 Task 4

- Deploy at Ashley's discretion — the visible UAT surface is now complete (fleet-native list + RDP rows + pencil + gear-dedup). Ashley can UAT the DEV/staging build first if desired.
- **NO DEPLOY without the mandatory 15-min deadman rollback** per CLAUDE.md hard constraint. Sentinel-cleanup-before-arm; narrow pkill disarm; ~/.claude/identities/tina/deploy-runbook.md is the canonical flow.
- Patch #106 pins after Ashley's UAT sign-off + `/close telegram-like-interface` bounty closure.

## Self-Check: PASSED

**File existence:**
- `src/ui/state/conversation-store.ts` — MODIFIED (+70 / -0, 703 lines)
- `src/ui/state/conversation-store.test.ts` — MODIFIED (+199 / -6, 1081 lines, 35 it() blocks)
- `src/ui/sidebar/ConversationsPanel.tsx` — MODIFIED (+126 / -10, 413 lines)
- `src/ui/sidebar/NewSessionButton.tsx` — MODIFIED (+11 / -4, 40 lines)
- `src/ui/AppShell.tsx` — MODIFIED (+35 / -0, 1950 lines)

**Commit existence (verified via git log):**
- `141c481` (test(phase-7): failing Vitest cases for RDP row derivation — Plan 07-02 RED) — FOUND
- `50c8e58` (feat(phase-7): RDP row derivation in conversation-store — Plan 07-02 GREEN) — FOUND
- `883e3a0` (feat(phase-7): pencil re-style + mobile gear-dedup fix + RDP row rendering) — FOUND

**Grep-checkable acceptance criteria bundle:**
- Task 1: rdpHostRow=4, enableRdp=7, rdp-host::=3, it()=35, test-rdp-keywords=35, no-polling=0, no-diff to scope-fenced paths ✓
- Task 2: Plus-import-removed=0, Pencil-family=4, JSX-Plus-removed=0, useIsTouchDevice=4, loosened-showGear=1, onRdpRowClick-panel=4, rdpHostRow-panel=2, Monitor-panel=4, onRdpRowClick-appshell=1, openTab-rdp-in-handler=1, selectConversationDeferred-in-handler=1, no-package.json-diff, no-polling-near-getSessionList=0, createPortal-count=1 ✓

**Test suite:**
- `npx vitest run src/ui/state/conversation-store.test.ts` = 35/35 passing ✓
- `npx vitest run --project frontend` (full frontend suite) = **315/315 passing across 24 files** (up from 310/310 baseline post-07-01: +5) ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` project-wide = 0 errors ✓

**Scope-fence structural checks:**
- No changes under `src/ui/features/pretty-view/` ✓
- No changes to `src/ui/features/terminal/Terminal.tsx` ✓
- No changes under `src/ui/features/guacamole/` ✓
- No changes under `src/backend/` ✓
- No changes under `docker/` ✓
- No changes to `package.json` / `package-lock.json` ✓
- No changes to `src/ui/sidebar/NewSessionDialog.tsx` ✓
- No changes to `src/ui/sidebar/ConversationRow.tsx` ✓ (TG-13 shape lock preserved via parallel RdpRow component)

---
*Phase: 07-fleet-native-conversation-list*
*Completed: 2026-07-21*
