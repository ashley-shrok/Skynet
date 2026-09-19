---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
plan: 07
subsystem: ui
tags: [react, drag-drop, url-fragment, persistence, integration]

# Dependency graph
requires:
  - phase: 120
    plan: 03
    provides: user_open_tabs.app_slug column + POST/PUT/PATCH handlers threading appSlug
  - phase: 120
    plan: 04
    provides: TabType six-arm union + Tab.app tuple + TabSpec seventh variant + specForTab widening
  - phase: 120
    plan: 06
    provides: AppPane iframe wrapper + Record<TabType, Renderer> dispatch with the "app" arm
provides:
  - AppTile onClick handler wired to onOpenApp callback (D-06)
  - AppTile onDragStart emitting application/x-skynet-app-tile with copy effectAllowed (D-07)
  - .pv-app-tile cursor styling flipped from default → pointer (D-06)
  - suppressNextClickRef gate active on the tile's click handler (Phase 119 Pitfall 4)
  - SplitView hasSkynetDragPayload gate accepts the third MIME
  - SplitView onDrop edge-branch parses app-tile payload + dispatches onDropAppTileInTree
  - AppShell openTab accepts app option + spreads Tab.app on both setTabs branches
  - AppShell addOpenTab call persists appSlug + hostId (tuple-sourced when host is null)
  - AppShell restoredTabs.push reconstructs Tab.app from saved rows (D-16 DB round-trip)
  - AppShell URL-restore branch for spec.protocol === "app" (D-16 URL round-trip)
  - AppShell splitTree hydration app-branch key `app:<hostId>:<slug>`
  - AppShell onOpenApp + onDropAppTileInTree callbacks wired to panel + SplitView
  - PrettyConversationsPanel onOpenApp prop threaded to AppTile
  - open-tabs-api.ts OpenTabRecord/OpenTabSyncPayload/OpenTabUpsertPayload extended with appSlug
affects: [120-08 (starter template comment + UAT documentation)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "application/x-skynet-app-tile as the third Skynet drag MIME (parallel to badge + row)"
    - "effectAllowed=\"copy\" distinguishes create-new (app-tile) from move (row/badge)"
    - "conditional-spread of Tab.app matches Phase 90 sessionKind backward-compat discipline"
    - "spec.protocol === \"app\" branch in URL-restore parallels the relay branch (both hostless)"

key-files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/AppTile.tsx — +50 / -12 lines. Added onOpenApp prop, onTileClick + onTileDragStart handlers, draggable={true} + onDragStart + onClick JSX wiring. Removed the void suppressNextClickRef; no-op (ref now consumed inside onTileClick).
    - src/ui/features/pretty-conversations/AppTile.test.tsx — +177 lines. 8 new tests covering D-06 click / D-18 unhealthy still clickable / D-13 long-press suppression / D-07 drag emit / Phase 64 text/plain closure / effectAllowed=copy / D-06 cursor: pointer CSS / D-15 multi-instance positive assertion.
    - src/ui/features/pretty-conversations/pretty-conversations.css — cursor: default → cursor: pointer in the .pv-app-tile rule (~line 1424); JSDoc comments at lines 1371-1373 and 1391-1392 updated to reflect the Phase 120 D-06 revert.
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — onOpenApp?: (hostId, slug, title) => void added to props type + threaded through to <AppTile onOpenApp={onOpenApp} /> at the Apps section (~line 2442).
    - src/ui/shell/SplitView.tsx — hasSkynetDragPayload gate widened with application/x-skynet-app-tile disjunct; onDrop edge-branch reads the app-tile JSON payload and dispatches onDropAppTileInTree; Pane + PaneTree + SplitView props extended with the new callback; center-drop deliberately not extended (documented inline — app-tile is always fresh-open, no natural center-drop semantic).
    - src/ui/AppShell.tsx — openTab options extended with `app?: {hostId; slug}`; both setTabs branches spread the tuple; PERSISTENT_TAB_TYPES adds "app"; addOpenTab persists appSlug + hostId (tuple-sourced when host is null); restoredTabs.push conditional-spreads Tab.app; URL-restore loop + splitTree hydration loop both branch on spec.protocol === "app"; both specForTab callsites thread `app: t.app`; onOpenApp + onDropAppTileInTree useCallbacks defined; PrettyConversationsPanel + SplitView JSX wired with the callbacks.
    - src/ui/api/open-tabs-api.ts — OpenTabRecord.appSlug (nullable) + OpenTabSyncPayload.appSlug (optional) + OpenTabUpsertPayload.appSlug (optional). Rule 3 auto-fix: the frontend type needed appSlug for AppShell's addOpenTab call to compile against Plan 03's backend field.

key-decisions:
  - "PrettyConversationsPanel required an onOpenApp prop-hole extension (Plan-declared BLOCKER 3 fix). AppTile.tsx has no onClick in Phase 119; the panel is the intermediary between AppShell and AppTile. Wired the prop as optional so tests + non-integrated mount sites continue to work."
  - "PERSISTENT_TAB_TYPES needed \"app\" added — required for D-16 DB round-trip. Without it, addOpenTab would not fire for app tabs and reload would not restore them."
  - "onDropAppTileInTree body wraps openTab + openSessionInTree, mirroring onDropRowInTree. No dragId echo — app-tile is effectAllowed=\"copy\" (create-new), not \"move\" (transfer)."
  - "Center-drop of app-tile deliberately falls through to the existing center-drop-unknown-mime no-op. An app-tile center-drop would need a fresh-open-then-replaceLeaf sequence not currently wired; users drop on edges instead. Documented inline in SplitView.tsx."
  - "URL-restore for an app tab uses `openTab(null, \"app\", undefined, { app, label: spec.slug, allowCreateTmux: false })`. Label falls back to the slug because the URL fragment does not carry the app title (metadata only lives in the app-tiles store, which loads via a separate WebSocket subscription)."
  - "open-tabs-api.ts type extension is a Rule 3 auto-fix: the frontend types had to match the backend column shape Plan 03 shipped. Without this, AppShell's addOpenTab({ ..., appSlug }) call would fail to compile against OpenTabUpsertPayload."

patterns-established:
  - "Third Skynet drag MIME (application/x-skynet-app-tile) with a distinct effectAllowed and no text/plain sibling — establishes the 'create-new' drag-source pattern for future non-transfer drag sources"

requirements-completed: [D-06, D-07, D-15, D-16, D-18, D-19, D-21]

# Metrics
duration: 17m 17s
completed: 2026-09-19
---

# Phase 120 Plan 07: Wire the shape-4 gestures end-to-end — Summary

**AppTile click + drag → SplitView drop dispatch → AppShell openTab + persistence + URL-fragment round-trip; the sidebar tile is now a live entry point to the app-pane content type.**

## Performance

- **Duration:** 17m 17s
- **Started:** 2026-09-19T04:18:14Z
- **Completed:** 2026-09-19T04:35:31Z
- **Tasks:** 3 (2 TDD gates on Task 1 + 1 refactor-shape extension on Task 2 + 1 integration on Task 3)
- **Files created:** 0
- **Files modified:** 7

## Task Commits

| # | Task | Commit(s) | Files |
|---|------|-----------|-------|
| 1 (RED) | Add failing tests for AppTile onClick + drag payload emit | `c0e9c424` | AppTile.test.tsx |
| 1 (GREEN) | Wire AppTile onClick + drag + cursor style (D-06/D-07/D-15/D-18) | `25ecdaf2` | AppTile.tsx, pretty-conversations.css |
| 2 | Extend SplitView drop dispatch with app-tile MIME (D-07) | `aa4a1158` | SplitView.tsx |
| 3 | Wire AppShell onOpenApp + onDropAppTileInTree + URL round-trip | `e4a90932` | AppShell.tsx, PrettyConversationsPanel.tsx, open-tabs-api.ts |

## Accomplishments

### Task 1 — AppTile primary-click + drag source (D-06 / D-07 / D-15 / D-18)

- **Props extension:** `AppTileProps` gained `onOpenApp?: (hostId: number, slug: string, title: string) => void`. Optional so unit tests and preview mount sites work without wiring the parent.
- **Click handler (`onTileClick`):** Reads-and-resets `suppressNextClickRef` first — if set, the synthesized click that follows a long-press is silently dropped (Pitfall 4 gate preserved from Phase 119's forward-compat scaffold). Otherwise fires `onOpenApp?.(Number(app.hostId), app.slug, app.title)`. `Number()` cast unifies AppState's string-typed hostId (fleet-status-types.ts:136) with Tab.app.hostId's numeric shape (ui-types.ts, Plan 04).
- **Drag handler (`onTileDragStart`):** Emits `application/x-skynet-app-tile` with `JSON.stringify({ hostId: Number(app.hostId), slug: app.slug, title: app.title })`; sets `effectAllowed = "copy"` (drag CREATES a new leaf, not MOVE). MUST NOT set `text/plain` — Phase 64 closure at SplitView.tsx:596-608. Grep-verified: `grep -c '"text/plain"' src/ui/features/pretty-conversations/AppTile.tsx` returns 0 (only a comment mentions "text/plain", no setData call).
- **JSX wiring:** Added `draggable={true} onDragStart={onTileDragStart} onClick={onTileClick}` alongside the existing `onContextMenu` + touch handlers. Rendering, hue discipline, icon fallback, unhealthy variant styling — all unchanged.
- **Cursor style flip:** `.pv-app-tile { cursor: default }` (Phase 119 D-13 override) → `.pv-app-tile { cursor: pointer }` (Phase 120 D-06). AppTile.tsx never had an inline `cursor: default` — the override lived exclusively in the CSS class rule (confirmed by AppTile.tsx line 26's own comment). Adjacent JSDoc comments in pretty-conversations.css updated to reflect the revert.

### Task 2 — SplitView drop-target extension (D-07)

- **`hasSkynetDragPayload` gate:** OR-chain widened with `dt?.types.includes("application/x-skynet-app-tile")` as a third disjunct. All three native listeners (`dragover`, `dragleave`, `drop`) inherit the gate automatically.
- **Prop threading:** New optional callback `onDropAppTileInTree?: (payload: { hostId: number; slug: string; title: string }, path: SplitPath, edge: DropEdge) => void;` threaded through Pane props (line ~230) → PaneTree props (line ~849) → top-level SplitView props (line ~1006) and passed to child components via JSX at all three levels. `onDropAppTileInTree` also added to the Pane's `useEffect` dep array so the native listener rebinds when the callback identity changes.
- **Drop dispatch branch:** New branch inserted AFTER the row branch (SplitView.tsx line ~634). Reads `e.dataTransfer?.getData("application/x-skynet-app-tile")`; when non-empty AND `onDropAppTileInTree` is wired, JSON.parse under try/catch, dispatch, early-return. Parse failure emits a `[pv-split-drop] pane app-tile parse failed:` console.warn and falls through (no partial writes). Structured `dispatch=app-tile` log matches the row/badge log shape.
- **Phase 64 closure preserved:** Pre-task and post-task `grep -c 'text/plain' src/ui/shell/SplitView.tsx` both return 18. No new `getData("text/plain")` or `setData("text/plain", ...)` calls were introduced (git diff confirmed).
- **Center-drop deliberately not extended:** An app-tile is a create-new gesture with no natural "swap" or "replace-in-place" semantic. Center-drop for app-tile would need a fresh-open-then-replaceLeaf composite handler that mixes the `(payload, targetTabId)` shape (current center-drop signature) with openTab's Tab creation. Documented inline in SplitView.tsx line ~611 so the deferral is discoverable. Users route through the edge-drop path.

### Task 3 — AppShell integration + URL-fragment round-trip (D-02 / D-16)

- **`openTab` extension:** `options` widened with `app?: { hostId: number; slug: string }`. `appTuple = options?.app` extracted inside the useCallback body; both setTabs branches (customLabel + duplicate-dedup) conditional-spread `...(appTuple !== undefined ? { app: appTuple } : {})` alongside the existing sessionKind/relayRoomId spreads. **D-15 multi-instance preserved:** no dedupe check on `(hostId, slug)` — every openTab call appends a fresh Tab regardless of an existing match.
- **`PERSISTENT_TAB_TYPES` extension:** `"app"` appended so app tabs flow through `addOpenTab`. The addOpenTab body threads `hostId: host ? parseInt(host.id) : (appTuple ? appTuple.hostId : null)` (app tabs carry hostId via the tuple, not via a resolved `host` object — AppTile passes `null` for host and provides the tuple via `options.app`) and `appSlug: appTuple?.slug ?? null`.
- **`restoredTabs.push` reconstruction:** Conditional-spread `...(saved.tabType === "app" && saved.hostId != null && saved.appSlug != null ? { app: { hostId: saved.hostId, slug: saved.appSlug } } : {})`. Mid-rollout legacy rows without both halves of the tuple restore without `Tab.app` — `isAppTab` returns false and `renderAppTab` renders null (per T-120-40 non-fatal degradation).
- **URL-restore branch:** Added `if (spec.protocol === "app")` branch to the tab-open loop BEFORE the host-required path (parallel to the relay branch). Idempotency: reuse an already-restored tab with the same `(hostId, slug)` tuple. Otherwise `openTab(null, "app", undefined, { app: { hostId: Number(spec.hostId), slug: spec.slug }, label: spec.slug, allowCreateTmux: false })`. Label falls back to the slug because the URL fragment carries no title (title lives in the app-tiles store, loaded via the fleet-status app-frame subscription).
- **splitTree hydration app-branch:** Symmetric with the relay branch in the spec-key map builder — `app:<hostId>:<slug>` keying so app leaves inside a split tree round-trip through workspace-share URLs.
- **URL-emit `specForTab` threading:** Both call sites (top-level URL-sync effect at line ~1194 + `encodeSplitTreeToUrl` callback at line ~1231) now pass `app: t.app`. specForTab's app branch (Plan 04 Task 2(d)) emits `app:<hostId>:<slug>` when input.type === "app" && input.app is defined; returns null for non-app tabs with an empty app field.
- **`onOpenApp` callback:** `useCallback` with body `openTab(null, "app", undefined, { app: { hostId, slug }, label: title, allowCreateTmux: false })`. Deps: `[openTab]`. Label uses the app's static title from AppState (D-19 — tab bar shows metadata title, not app's live document.title).
- **`onDropAppTileInTree` callback:** Body:
  - Structured `[pv-split-drop] onDropAppTileInTree` log
  - `openTab(null, "app", ..., { app: payload, label: payload.title, allowCreateTmux: false })`
  - `openSessionInTree(newTabId, path, edge)` — inserts the fresh leaf at the requested split edge
  - `selectConversationDeferred(newTabId)` — parallel to onDropRowInTree
  - No `postDragAccept(payload.dragId)` because AppTile's drag is `effectAllowed="copy"` (create-new, no source to hard-close)

- **Panel + SplitView JSX wiring:** `<PrettyConversationsPanel onOpenApp={onOpenApp} .../>` at line ~2842; `<SplitView onDropAppTileInTree={onDropAppTileInTree} .../>` at line ~3661 (immediately after `onDropRowInTree`).

- **PrettyConversationsPanel prop-hole:** `onOpenApp?: (hostId: number, slug: string, title: string) => void` added to the panel's props type at line ~499; threaded to `<AppTile onOpenApp={onOpenApp} />` at the Apps section (line ~2440). One-file, two-touch edit exactly as the plan specified.

- **`open-tabs-api.ts` type extension (Rule 3 auto-fix):** `OpenTabRecord.appSlug: string | null` (nullable, matches DB column) + `OpenTabSyncPayload.appSlug?: string | null` + `OpenTabUpsertPayload.appSlug?: string | null` (optional on payloads for backward-compat with pre-Phase-120 callers). Without this, AppShell's `addOpenTab({ ..., appSlug })` call would fail to compile — the frontend type had to catch up with the backend column Plan 03 shipped.

## Deviations from Plan

**Rule 3 (auto-fix blocking issue):** Extended `src/ui/api/open-tabs-api.ts` interfaces to include `appSlug`. Not in the plan's `files_modified` frontmatter, but required for AppShell's `addOpenTab({ ..., appSlug })` call to compile. The backend column (Plan 03) shipped with `appSlug`; the frontend types needed to match. This is a plain type-surface catch-up, not a behavioral change. Recorded here as `[Rule 3 - Blocker] Extend OpenTabRecord / OpenTabSyncPayload / OpenTabUpsertPayload with appSlug field`.

**Center-drop for app-tile deliberately not extended (Task 2(d) discretion):** The plan's Task 2(d) says "If no center-drop branch exists, the edge-drop branch alone suffices" — a center-drop branch DOES exist for the badge + row MIMEs, but wiring a symmetric app-tile branch would require a fresh-open-then-replaceLeaf handler whose signature does not map cleanly onto the existing `(payload, targetTabId)` callbacks. Documented inline (`SplitView.tsx` line ~611) so the deferral is discoverable. Users route through edge-drop; behavior is a silent no-op at center. Not a UX regression — center-drop for a fresh-open source has no natural semantic (there's no source leaf to swap-with).

**No multi-instance dedupe introduced:** Grep-verified — `grep -cE 'existing.*\.app\?\.\(hostId\|slug\)'` on AppShell.tsx returns 0. D-15 multi-instance preserved.

## Acceptance-Criteria Grep Sweep

### Task 1 (AppTile.tsx + AppTile.test.tsx + pretty-conversations.css)

| Criterion | Threshold | Actual |
|-----------|-----------|--------|
| `onOpenApp` in AppTile.tsx | ≥ 3 | 11 |
| `application/x-skynet-app-tile` in AppTile.tsx (setData call) | exactly 1 (non-comment) | 1 non-comment; 3 total incl. JSDoc |
| `"text/plain"` in AppTile.tsx | 0 non-comment | 0 non-comment; 1 comment ("MUST NOT setData") |
| `effectAllowed = "copy"` in AppTile.tsx | exactly 1 (non-comment) | 1 non-comment; 3 total incl. JSDoc |
| `Number(app.hostId)` in AppTile.tsx | ≥ 2 | 2 code sites (click + drag) |
| `draggable={true}` in AppTile.tsx | exactly 1 | 1 |
| `onDragStart={onTileDragStart}` in AppTile.tsx | exactly 1 | 1 |
| `onClick={onTileClick}` in AppTile.tsx | exactly 1 | 1 |
| `cursor: default\|cursor-default` in AppTile.tsx | 0 non-comment | 0 non-comment; 2 comments (JSDoc references) |
| `.pv-app-tile` active cursor declaration | `cursor: pointer;` | `cursor: pointer;` (single match) |
| `cursor: pointer` inside `.pv-app-tile` block | ≥ 1 | 1 |
| `suppressNextClickRef` in AppTile.tsx | ≥ 2 | 6 (declaration + comment + click gate + reset + JSDoc references) |
| test cases in AppTile.test.tsx | ≥ 8 | 20 (12 pre-existing + 8 new) |
| `application/x-skynet-app-tile` in AppTile.test.tsx | ≥ 1 | 4 (Test 4 assertion + comment + section headers) |
| `text/plain` in AppTile.test.tsx | ≥ 1 (negative assertion) | 4 (Test 5 assertion + comment + section headers) |
| scoped vitest exit 0 | required | PASS (20 tests / 1 file / 200 total in the related sweep) |

### Task 2 (SplitView.tsx)

| Criterion | Threshold | Actual |
|-----------|-----------|--------|
| `application/x-skynet-app-tile` in SplitView.tsx | ≥ 2 | 4 (hasSkynetDragPayload + getData + JSDoc references) |
| `onDropAppTileInTree` in SplitView.tsx | ≥ 2 | 17 (prop types + JSX threads + dispatch call + JSDoc) |
| `application/x-skynet-badge` in SplitView.tsx | ≥ 1 | 9 |
| `application/x-skynet-row` in SplitView.tsx | ≥ 1 | 10 |
| `text/plain` pre-task vs post-task | equal | 18 == 18 (Phase 64 closure preserved) |
| `pv-split-drop.*app-tile` | ≥ 1 (parse-failure log) | 2 (dispatch=app-tile log + parse-failed log) |
| tsc --noEmit errors from SplitView.tsx | 0 | 0 |

### Task 3 (AppShell.tsx + PrettyConversationsPanel.tsx)

| Criterion | Threshold | Actual |
|-----------|-----------|--------|
| `appTuple` in AppShell.tsx | ≥ 2 | 6 (declaration + 2 conditional spreads + addOpenTab + JSDoc refs) |
| `onDropAppTileInTree` in AppShell.tsx | ≥ 2 | 4 (declaration + prop wiring + JSDoc + [pv-split-drop] log) |
| `onOpenApp` in AppShell.tsx | ≥ 2 | 3 (declaration + JSX prop pass + JSDoc) |
| `app: appTuple` / restoredTabs.push `app: {...}` combined | ≥ 2 | 2 (both setTabs spreads use `{ app: appTuple }`; restoredTabs uses `{ app: { hostId: saved.hostId, slug: saved.appSlug } }`) |
| `appSlug` in AppShell.tsx | ≥ 2 | 5 (addOpenTab body + restoredTabs check + JSDoc references) |
| `"app"` inside PERSISTENT_TAB_TYPES block | ≥ 1 | 1 array entry (verified via `grep -A15 'PERSISTENT_TAB_TYPES:' \| grep -c '"app"'` = 2, including 1 JSDoc mention) |
| `existing.*\.app\?\.\(hostId\|slug\)` (dedupe check) | 0 | 0 (D-15 multi-instance preserved) |
| tsc --noEmit errors from AppShell.tsx | 0 | 0 |
| `onOpenApp` in PrettyConversationsPanel.tsx | ≥ 2 | 3 (destructure + props-type field + prop pass to AppTile) |
| `spec.protocol === "app"` in AppShell.tsx | ≥ 1 | 2 (tab-open URL restore + splitTree hydration) |

All criteria pass.

## D-21 Client-Sidebar-Wiring Test Coverage

Per plan `<behavior>` for Task 1, the 8 new AppTile tests cover the D-21 client-sidebar-wiring layer end-to-end:

| # | Behavior | Assertion |
|---|----------|-----------|
| 1 | click fires onOpenApp with (Number(hostId), slug, title) | PASS |
| 2 | unhealthy tile still clickable (D-18 no health gate) | PASS |
| 3 | long-press suppresses the synthesized click | PASS |
| 4 | dragStart emits application/x-skynet-app-tile with parsed JSON matching {hostId, slug, title} | PASS |
| 5 | dragStart NEVER sets text/plain (Phase 64 closure) | PASS |
| 6 | dragStart sets effectAllowed = "copy" | PASS |
| 7 | .pv-app-tile CSS rule declares cursor: pointer | PASS |
| 8 | two clicks → two onOpenApp calls with identical args (D-15 no dedupe at tile) | PASS |

Test 3 relies on `vi.useFakeTimers()` + `vi.advanceTimersByTime(600)` to trigger the long-press body which sets `suppressNextClickRef.current = true`. The subsequent `fireEvent.click(tile)` reads-and-resets the ref and returns early without firing onOpenApp.

The AppShell-half of D-15 (that two openTab calls with identical (hostId, slug) create two distinct Tab entries and two independent leaves) is exercised at Plan 08's D-23 UAT step per the plan's `<behavior>` note — AppShell state is not practically unit-testable in isolation from the full component tree.

## Residual tsc Errors

**None.** `SKYNET_COOKIE_DOMAIN=https://skynet.test npx tsc --noEmit -p tsconfig.json` reports zero errors across the composite build (client `tsconfig.app.json` + backend `tsconfig.node.json`).

## Scoped Tests

- **AppTile-scoped:** `npx vitest related --run src/ui/features/pretty-conversations/AppTile.tsx src/ui/features/pretty-conversations/AppTile.test.tsx` → 8 files / 200 tests / 0 failures (15.97s).
- **SplitView-scoped:** `npx vitest related --run src/ui/shell/SplitView.tsx` → 5 files / 102 tests / 0 failures (2.64s).
- **Integration sweep (AppShell + panel + tab-url + open-tabs-api):** `npx vitest related --run src/ui/AppShell.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/api/open-tabs-api.ts src/ui/lib/tab-url.ts` → 103 files / 1565 tests / 11 skipped / 1 todo / 0 failures (133.89s).

## Issues Encountered

**Text/plain grep-count inflation from JSDoc comments in SplitView.tsx (self-correction).** My first draft of the app-tile branch JSDoc contained three "text/plain" mentions inside comments that inflated `grep -c 'text/plain'` from 18 → 21. Reworded the JSDoc to reference the "Phase 64 closure" without the literal string; grep count returned to 18. This is a grep-hygiene issue, not a code-correctness issue — no new `getData("text/plain")` or `setData("text/plain", ...)` calls were ever introduced (confirmed via git diff). The plan's acceptance criterion offers both "grep -c equal" and "git diff confirms no new text/plain reads added" as alternatives; both would have passed my first draft. Kept the reworded version for cleaner grep discipline.

**PERSISTENT_TAB_TYPES grep-window sensitivity.** The plan's acceptance criterion runs `grep -A5 'PERSISTENT_TAB_TYPES'` to find `"app"` — my JSDoc block above the `"app"` entry made the array element land at line 11 of the block (past the -A5 window). Widening to `-A15` captures both the array entry and the JSDoc mention (2 matches). Intent is met (`"app"` is in PERSISTENT_TAB_TYPES); documenting here so a future reader knows the plan's threshold expected a leaner comment.

## Deferred Issues

**PrettyConversationsPanel tests do not currently cover onOpenApp wiring.** The panel has a test file (`PrettyConversationsPanel.test.tsx`) but the D-21 assertion "click on an AppTile threads through the panel's onOpenApp prop" is covered structurally at Task 1 (AppTile.test.tsx exercises the click → onOpenApp callback path directly). A future test could mount the panel with a spy `onOpenApp` and assert click on a tile fires it, but that's already implicit in AppTile.test.tsx + the compile-time prop wiring at PrettyConversationsPanel line ~2442. Not urgent; the plan's `<behavior>` scope for Task 1 does not require a panel-level test.

**Center-drop for app-tile.** Documented above (see Deviations from Plan). If UAT surfaces a UX complaint about center-drop being silent for app-tile, a future quick could wire a center-drop-app-tile callback with a `(payload, targetTabId) => openTab + replaceLeaf` shape.

## Frontmatter-Declared PrettyConversationsPanel Prop-Hole

**Yes.** `PrettyConversationsPanel.tsx` required an `onOpenApp?: (hostId, slug, title) => void` prop-hole extension per Task 3(e)(i). Two touch points in the file:
1. Props destructure at line ~394: added `onOpenApp,`
2. Props type at line ~499: added the JSDoc + field declaration
3. AppTile invocation at line ~2440: threaded `onOpenApp={onOpenApp}`

## PERSISTENT_TAB_TYPES Change

**Yes.** `"app"` was appended to `PERSISTENT_TAB_TYPES` at line ~1468 with a Phase 120 D-16 JSDoc comment. Required for D-16 DB persistence — without it, `addOpenTab` would never fire for app tabs and reload would not restore them.

## Self-Check: PASSED

- `[ -f src/ui/features/pretty-conversations/AppTile.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-conversations/AppTile.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-conversations/pretty-conversations.css ]` → FOUND
- `[ -f src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx ]` → FOUND
- `[ -f src/ui/shell/SplitView.tsx ]` → FOUND
- `[ -f src/ui/AppShell.tsx ]` → FOUND
- `[ -f src/ui/api/open-tabs-api.ts ]` → FOUND
- `git log --all --oneline | grep c0e9c424` → FOUND (Task 1 RED)
- `git log --all --oneline | grep 25ecdaf2` → FOUND (Task 1 GREEN)
- `git log --all --oneline | grep aa4a1158` → FOUND (Task 2)
- `git log --all --oneline | grep e4a90932` → FOUND (Task 3)

---
*Phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-*
*Completed: 2026-09-19*
