---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
plan: 06
subsystem: ui
tags: [react, iframe, discriminated-union-dispatch, refactor, snapshot-tests]

# Dependency graph
requires:
  - phase: 120
    plan: 04
    provides: Six-arm TabType, Tab.app tuple, isAppTab predicate
  - phase: 120
    plan: 05
    provides: /apps/:hostId/:slug/pane/* proxy route (AppPane.iframe.src target)
provides:
  - AppPane iframe wrapper component (src/ui/shell/AppPane.tsx)
  - TAB_ICONS Record<TabType, ElementType> lookup with six arms (exported)
  - RENDERERS Record<TabType, Renderer> lookup with six arms (exported)
  - renderAppTab renderer mounting AppPane behind isAppTab guard
  - D-21 client-dispatch layer test coverage (14 new tests)
affects: [120-07 (AppTile onClick wires openTab({type:"app",...}); AppShell integration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Record<TabType, ...> lookup replaces switch-with-fall-through (D-03/D-04)
    - Iframe-as-pane-content pattern established (no existing precedent — GuacamoleApp mounts a React wrapper, not an iframe directly)
    - toMatchInlineSnapshot as byte-equivalence gate for dispatch refactors

key-files:
  created:
    - src/ui/shell/AppPane.tsx (74 lines) — iframe wrapper for tab.type === "app"
    - src/ui/shell/AppPane.test.tsx (116 lines) — 10 attribute-discipline tests
  modified:
    - src/ui/shell/tabUtils.tsx — dispatch refactor (§97-131 tabIcon + §321-499 renderTabContent); +174 / -80 lines; net +94
    - src/ui/shell/tabUtils.test.tsx — +246 / -1 lines; 14 new D-21 tests + AppPane mock + import extension

key-decisions:
  - "isVisible prop threaded into AppPane props but INTENTIONALLY UNUSED inside the component body — matches GuacamoleApp integration convention (parent Pane manages visibility one layer up via CSS display:none)"
  - "AppPane uses `type { ReactElement }` (newer import convention) rather than the default React import — checked existing shell components; both conventions live in the codebase, ReactElement is the tighter import"
  - "Snapshot format for tabIcon() captures the lucide component NAME in the snapshot (<AppWindow>, <Monitor>, <Terminal>, <LayoutDashboard>) — stronger byte-equivalence proof than a generic <ForwardRef(LucideIcon)> snapshot would give"
  - "TAB_ICONS and RENDERERS are exported (planner's Task 3(f) discretion) so the exhaustiveness test can assert Object.keys(...).length === 6 directly — safer than an indirect assertion via calling each dispatch function"

patterns-established:
  - "Iframe-as-pane-leaf-content — first Skynet-pane usage of a raw <iframe> as full leaf content (GuacamoleApp is React-wrapped)"
  - "Record<TabType, ...> compile-time-exhaustive dispatch replaces switch"

requirements-completed: [D-03, D-04, D-05, D-19, D-20, D-21]

# Metrics
duration: 7m 46s
completed: 2026-09-19
---

# Phase 120 Plan 06: Client-side dispatch refactor + AppPane iframe wrapper

**Byte-equivalent Record<TabType, ...> refactor of both dispatch surfaces in tabUtils.tsx, plus a new AppPane iframe wrapper mounted by the sixth renderer arm — the client-side surface for tab.type === "app".**

## Performance

- **Duration:** 7m 46s
- **Started:** 2026-09-19T04:04:53Z
- **Completed:** 2026-09-19T04:12:39Z
- **Tasks:** 3
- **Files created:** 2 (AppPane.tsx + AppPane.test.tsx)
- **Files modified:** 2 (tabUtils.tsx + tabUtils.test.tsx)

## Accomplishments

- **AppPane (D-05)**: single-purpose `<iframe>` wrapper at `src/ui/shell/AppPane.tsx`. `src` uses `encodeURIComponent` on BOTH hostId and slug (T-120-32 mitigation, defence-in-depth atop backend's APP_SLUG_RE). No sandbox attribute (T-120-34 accepted trade-off). `referrerPolicy="no-referrer"` (D-20). `loading="eager"`. `title="App ${slug}"` for accessibility. `data-app-hostid` / `data-app-slug` / `data-tab-id` for downstream test/debug identification. No Suspense wrapper, no loading placeholder, no skeleton, no spinner (fleet rule — no message streaming ever, anywhere; iframe naturally shows a blank frame until first paint, and tunnel failures render Phase 103's interstitial inside the frame via the proxy per D-17).
- **tabIcon (D-03)**: refactored from a five-arm switch to `TAB_ICONS: Record<TabType, React.ElementType>` lookup. Sixth arm `app: AppWindow` (already used by Phase 119's PrettyConversationsPanel — coherent icon story from sidebar section header to leaf tab-bar glyph). Byte-equivalent for the five existing arms (snapshot-tested in Tests 1-5).
- **renderTabContent (D-04)**: refactored from switch-with-fall-through to `RENDERERS: Record<TabType, Renderer>` lookup. Three explicit rows for `rdp`/`vnc`/`telnet` all pointing at `renderGuacamoleTab` — replacing the fall-through pattern per D-04 cleanup (the fall-through was a subtle readability hazard; three explicit rows pointing at the same helper is easier to modify safely). Renderer bodies extracted to module-scope arrow functions: `renderDashboard`, `renderTerminalTab`, `renderGuacamoleTab`, `renderAppTab`. Body copies are VERBATIM from the pre-refactor switch cases — same JSX, same prop wiring, same inline logic — with only the closure-captured deps threaded through a `RendererDeps` object. The `renderAppTab` uses `isAppTab()` narrowing before accessing `tab.app.hostId` / `tab.app.slug`.
- **D-21 client-dispatch layer tests (14 new tests)**: six tabIcon snapshot tests (Tests 1-6) with inline snapshots capturing the lucide component name (`<AppWindow>`, `<Monitor>`, `<Terminal>`, `<LayoutDashboard>` — stronger byte-equivalence proof than a generic snapshot); six renderTabContent dispatch tests (Tests 7-12) exercising each of the six kinds through the new RENDERERS lookup with mocks for heavy inner components; one defensive test (Test 13) for the `app: undefined` fall-through; one exhaustiveness test (Test 14) asserting `Object.keys(TAB_ICONS).length === 6` and `Object.keys(RENDERERS).length === 6`.

## Task Commits

1. **Task 1a (RED — AppPane failing tests):** `5c127ad8` (test)
2. **Task 1b (GREEN — AppPane implementation):** `0b13495b` (feat)
3. **Task 2 (dispatch refactor):** `d282dc03` (refactor)
4. **Task 3 (D-21 tests):** `e3c784d3` (test)

## Files Created/Modified

### Created (2)

- `src/ui/shell/AppPane.tsx` — 74 lines. Exports `AppPane` React function component + `AppPaneProps` interface. Single `<iframe>` element with the exact set of attributes named in D-05 + D-20. No auxiliary chrome, no Suspense, no callback props (D-05 explicitly forbids `onClose` / `onFocus` — Skynet draws no chrome inside the leaf).
- `src/ui/shell/AppPane.test.tsx` — 116 lines. 10 attribute-discipline tests covering: exactly one iframe rendered; src template with encodeURIComponent on hostId + slug; space + forward-slash slug URL-encoding (T-120-32 mitigation); no `sandbox` attribute (D-05 anti-pattern); `referrerPolicy="no-referrer"` (D-20); `loading="eager"`; `title="App ${slug}"`; three `data-*` identification attributes; `className="h-full w-full border-0"`.

### Modified (2)

- `src/ui/shell/tabUtils.tsx` — +174 / -80 lines (net +94).
  - Added imports: `AppWindow` (lucide-react), `type { ReactNode }` (react), `isAppTab` (types/ui-types), `AppPane` (./AppPane).
  - Deleted the two switches (§97-110 tabIcon + §339-404 renderTabContent).
  - Added `TAB_ICONS: Record<TabType, React.ElementType>` (six arms; exported).
  - Added module-scope renderer functions (`renderDashboard`, `renderTerminalTab`, `renderGuacamoleTab`, `renderAppTab`) with verbatim case bodies from the pre-refactor switch.
  - Added `RENDERERS: Record<TabType, Renderer>` (six arms; three explicit rdp/vnc/telnet rows pointing at renderGuacamoleTab; exported).
  - Rewired `renderTabContent`'s body to `RENDERERS[tab.type](tab, deps)`. Signature and parameter list UNCHANGED — byte-equivalent from every call site.
- `src/ui/shell/tabUtils.test.tsx` — +246 / -1 lines.
  - Extended imports: added `tabIcon`, `TAB_ICONS`, `RENDERERS` alongside the existing `renderTabContent`.
  - Added `vi.mock("./AppPane", ...)` — mock renders a real `<iframe>` with the same src template as the production component so Test 12 can assert on `src="/apps/1/todo/pane/"` without exercising AppPane internals (those live in AppPane.test.tsx).
  - Added `describe("Phase 120 D-21 — tabIcon dispatch (six-arm Record<TabType, ...>)", ...)` (6 tests).
  - Added `describe("Phase 120 D-21 — renderTabContent dispatch (six-arm Record<TabType, Renderer>)", ...)` (8 tests).

## Decisions Made

- **`isVisible` prop kept in AppPane signature but unused in the body.** Mirrors GuacamoleApp's integration convention: the parent Pane one layer up manages visibility via CSS (`display: none` / `hidden` styling), and the iframe stays mounted so its state (browser history, form entries, WebSocket connections) is preserved when the user swaps between leaves. Removing `isVisible` from the prop list would force Task 3's Test 12 to omit the prop assertion. The eslint-disable-next-line escape ensures the intentional-unused pattern doesn't trigger a lint failure.
- **Snapshot format captured the lucide component NAME.** Vitest's serializer surfaces `<AppWindow>`, `<Monitor>`, `<Terminal>`, `<LayoutDashboard>` rather than a generic `<ForwardRef(LucideIcon)>` — first snapshot run reported the actual names. Adopting these names as the canonical snapshot form gives a stronger byte-equivalence gate: if a future edit accidentally swaps a lucide icon (say `Terminal` → `TerminalSquare` for the `terminal` arm), the snapshot fails immediately with a diff naming both components.
- **Exported TAB_ICONS and RENDERERS.** Task 3(f) offered planner discretion between exporting the tables and asserting exhaustiveness indirectly. Direct export is safer: `Object.keys(TAB_ICONS).length === 6` catches a silent arm-drop that an indirect assertion (calling each dispatch function on all six kinds) could miss if one arm happens to alias another's renderer.
- **Renderer body copies are VERBATIM.** Per Task 2(e) discipline — the extracted `renderTerminalTab`, `renderGuacamoleTab`, and `renderDashboard` bodies are identical to the pre-refactor switch case bodies (same JSX shapes, same prop wiring, same `!host && tab.sessionKind !== "relay-room"` gate, same `Suspense fallback` wrapping). Only the closure-captured deps are threaded through a fresh `RendererDeps` argument instead of the flat parameter list. The pre-existing 9 test suite (including Phase 93 Slice 4's regression + source-order assertions) passes unchanged — the byte-equivalence gate held.
- **`type { ReactNode }` import in tabUtils.tsx.** Added specifically for the `Renderer` type alias — `React.ReactNode` was not previously available as a named import in this file (the file uses `import { lazy, Suspense } from "react"` which doesn't include `ReactNode`). The type-only import keeps the runtime import list clean.

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria grep gates met or exceeded threshold:

**Task 1 (AppPane.tsx):**
- `grep -c 'encodeURIComponent(hostId)'` = 1 (exactly 1 required) ✓
- `grep -c 'encodeURIComponent(slug)'` = 1 (exactly 1 required) ✓
- `grep -c 'sandbox'` = 0 (0 required — anti-pattern discipline) ✓
- `grep -c 'referrerPolicy="no-referrer"'` = 1 (exactly 1 required) ✓
- `grep -c 'loading="eager"'` = 1 (exactly 1 required) ✓
- `grep -c 'data-app-hostid'` = 1 (exactly 1 required) ✓
- `grep -c 'data-app-slug'` = 1 (exactly 1 required) ✓
- `grep -c 'data-tab-id'` = 1 (exactly 1 required) ✓
- src template match = 1 (exactly 1 required) ✓
- streaming primitives = 0 (0 required) ✓
- tsc errors from AppPane.tsx = 0 ✓

**Task 2 (tabUtils.tsx refactor):**
- `TAB_ICONS: Record<TabType` = 1 ✓
- `RENDERERS: Record<TabType` = 1 ✓
- Six arms in both tables = 6 unique keys ✓
- `app: AppWindow` = 1 (exactly 1 required — code only, no JSDoc mention) ✓
- `app: renderAppTab` = 1 (exactly 1 required — code only, no JSDoc mention) ✓
- Three explicit rdp/vnc/telnet renderGuacamoleTab rows = 3 ✓
- `switch (tab.type)` = 0 ✓
- Top-level `switch (type)` at tabIcon = 0 ✓
- `isAppTab` = 3 (renderAppTab guard + import + comment; ≥ 1 required) ✓
- `from "./AppPane"` = 1 ✓
- tsc errors from tabUtils.tsx = 0 ✓

**Task 3 (tabUtils.test.tsx):**
- Test cases: 23 total (9 pre-existing + 14 new; ≥ 14 required) ✓
- `/apps/1/todo/pane/` = 3 (Test 12 + mock template + assertion; ≥ 1 required) ✓
- `isAppTab` OR `app: undefined` = 3 (≥ 1 required) ✓
- Six kinds appear in test names/scenarios = 6 unique matches ✓
- `toMatchInlineSnapshot` = 6 (≥ 5 required — one per existing kind + one for the new app kind) ✓
- Scoped vitest run: **23/23 tests pass** ✓
- Byte-equivalence: existing 9 tests (relay-room dispatcher rewire regression suite) pass unchanged after the refactor ✓

## Byte-equivalence Proof

The dispatch refactor is byte-equivalent for the five existing tab kinds:

1. **Pre-existing 9-test suite (Phase 93 Slice 4 relay-room rewire) passes unchanged.** These tests exercise the terminal-kind path across `sessionKind: "harness"`, `sessionKind: "relay-room"`, host-null gate widening, source-order enforcement, and impl-file grep assertions. All pass post-refactor.
2. **New tabIcon snapshots capture the exact lucide component names.** Any accidental icon swap (e.g. `Terminal` → `TerminalSquare` for the terminal arm) would fail the snapshot diff immediately with both component names surfaced.
3. **Reference-equality assertions on icon components** — `TAB_ICONS.vnc === TAB_ICONS.rdp` and `TAB_ICONS.telnet === TAB_ICONS.terminal` — confirm the same-icon-across-arms discipline the pre-refactor switch had.
4. **Broader `vitest related` sweep across 11 test files: 318/318 tests pass.** Downstream consumers of `renderTabContent` and `tabIcon` (SplitView, tab-bar components, workspace-restore paths) see no behavioral drift.

## Exhaustiveness Guarantee

Test 14 asserts `Object.keys(TAB_ICONS).length === 6` and `Object.keys(RENDERERS).length === 6`, plus full-key equality against the expected TabType arm list `[dashboard, terminal, rdp, vnc, telnet, app]`. Compile-time exhaustiveness via `Record<TabType, ...>` is the primary safety — if `TabType` grew to seven arms, tsc would error on the missing key immediately. The runtime assertion is defence-in-depth against a future silent-drop of an arm (e.g. someone deletes a row and TypeScript lets it slide if the removed key is later added back with a wrong renderer).

## Residual tsc Errors

**None.** `SKYNET_COOKIE_DOMAIN=https://skynet.test npx tsc --noEmit -p tsconfig.json` reports zero errors originating from `AppPane.tsx` or `tabUtils.tsx`. The Plan 04 concern about "unresolved switch(tab.type) sites" is closed by Task 2's refactor — the `Record<TabType, ...>` surfaces compile-time exhaustiveness natively.

## Scoped Tests

`npx vitest related --run src/ui/shell/tabUtils.tsx src/ui/shell/tabUtils.test.tsx src/ui/shell/AppPane.tsx src/ui/shell/AppPane.test.tsx` → **11 test files / 318 tests / all passing** (22.11s). Direct AppPane + tabUtils suite: **2 files / 33 tests / all passing** (2.75s).

## Issues Encountered

None. The AppPane mock in tabUtils.test.tsx renders a real `<iframe>` (not a data-testid div) so Test 12's `iframe.getAttribute("src")` assertion works without pulling in AppPane's actual iframe implementation. This keeps the dispatch test focused on the RENDERERS lookup shape (Task 3's stated intent) while still exercising the prop wiring end-to-end.

## Next Phase Readiness

- **Plan 07 (AppTile handlers wire onOpenApp; AppShell integration):** UNBLOCKED. `AppPane` is exported and importable. `RENDERERS[tab.type]` includes an `app` entry ready to mount when Plan 07's AppShell wiring creates a `Tab` with `type: "app"` and `app: { hostId, slug }`. The `openTab(null, "app", ..., { app: { hostId, slug }, label })` call site referenced in the plan's success criteria will land through this dispatch layer without any further changes here.
- **No downstream cross-plan dependency changes.** The `renderTabContent` function signature is byte-identical — every existing call site continues to work unchanged.

## Self-Check: PASSED

- `[ -f src/ui/shell/AppPane.tsx ]` → FOUND
- `[ -f src/ui/shell/AppPane.test.tsx ]` → FOUND
- `[ -f src/ui/shell/tabUtils.tsx ]` → FOUND (modified)
- `[ -f src/ui/shell/tabUtils.test.tsx ]` → FOUND (modified)
- `git log --all | grep 5c127ad8` → FOUND (Task 1a RED)
- `git log --all | grep 0b13495b` → FOUND (Task 1b GREEN)
- `git log --all | grep d282dc03` → FOUND (Task 2 refactor)
- `git log --all | grep e3c784d3` → FOUND (Task 3 tests)

---
*Phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-*
*Completed: 2026-09-19*
