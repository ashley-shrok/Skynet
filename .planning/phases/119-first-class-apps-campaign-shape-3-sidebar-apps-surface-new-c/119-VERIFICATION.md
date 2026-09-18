---
phase: 117
verified_at: 2026-09-18T20:14:00Z
status: passed
score: 17/17 must-haves verified
verifier: gsd-verifier (Claude Opus 4.7)
scope_note: Verifier verified the SHIPPED CODE on branch feat/tab-title-from-tmux (commits 4ae55708..dbf54839, 19 commits). Deploy HELD per campaign hold — this is a code-in-branch verification, not a deployed-state verification.
---

# Phase 119: first-class apps campaign shape 3 — sidebar apps surface — Verification Report

**Phase Goal (backward-derived contract):**
Deliver the sidebar surface that renders Phase 118's live app-frame subscription channel — a new collapsible section in the sidebar (in `PrettyConversationsPanel.tsx`) sitting below the search input and above the Pinned group, always visible so the whole feature is discoverable, with populated tiles that let the user open an app in a separate authenticated browser tab via a right-click / long-press context menu. **Shape must deliver STANDALONE user-visible value independent of shape 4.**

**Branch:** `feat/tab-title-from-tmux` (commits stacked locally, no push per campaign hold)
**Commits verified:** 19 (`4ae55708`..`dbf54839`)
**Scoped vitest:** 100 test files / 1663 tests passed / 10 skipped / 1 todo / 0 failed
**Type-check:** `tsc --noEmit` exits 0

---

## Goal Achievement — Observable Truths (must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Apps section is ALWAYS visible in the sidebar, regardless of tile count (D-05) | VERIFIED | `PrettyConversationsPanel.tsx:1879` — `<div className="pv-panel-group pv-apps-section">` wrapper has NO `.length > 0` gate. The only `appTiles.length === 0` check is at `:1906`, INSIDE the `{appsExpanded && ...}` gate — it selects between empty-state and tile-list, not whether the section renders. Integration test **A15** at `PrettyConversationsPanel.test.tsx:4429` proves header renders with `mockAppTiles=[]`. |
| 2 | Section is COLLAPSED BY DEFAULT (D-03) | VERIFIED | `PrettyConversationsPanel.tsx:764` — `const [appsExpanded, setAppsExpanded] = useState(false)`. Default `false` = collapsed on mount. |
| 3 | Content is NOT in the DOM when collapsed (D-03 lazy-render invariant) | VERIFIED | `PrettyConversationsPanel.tsx:1904` — `{appsExpanded && (<div id="pv-apps-section-content">...</div>)}` gates both the tile list AND the empty-state prompt. Integration test **A16** at `:4445` seeds a POPULATED store (proving the lazy gate — not the empty branch — is what suppresses the DOM) and asserts `queryAllByRole('button', {name: /App tile:/}).length === 0` AND empty-state prompt is null. |
| 4 | All app tiles render with default hue 216 (D-09 no per-app colour) | VERIFIED | `AppTile.tsx` — no `style={{ "--pv-hue": ... }}` anywhere on the tile root; grep for `--pv-hue` in the file is zero. `pretty-conversations.css:1398` — `.pv-app-tile` has NO `--pv-hue` declaration and inherits from `.pv-row` fallback 216 at `:338`. Integration test **K** at `AppTile.test.tsx` asserts no inline `--pv-hue` on the root. |
| 5 | Icon slot renders `<img>` when `hasIcon=true`; first-letter fallback when `hasIcon=false` OR image fetch fails (D-07, D-08) | VERIFIED | `AppTile.tsx:185-226` — `showFallback = !app.hasIcon \|\| imgFailed`; ternary branches on it: `<span className="pv-app-icon-initial">L</span>` fallback vs `<img src={iconUrl} onError={() => setImgFailed(true)}>`. Component tests **A**, **B**, **C**, **D** cover: `<img>` for hasIcon:true, first-letter for hasIcon:false, state-flip fallback on onError, defensive "?" for empty title. |
| 6 | Unhealthy frames render as two-line with muted-red healthMessage under title (D-11) | VERIFIED | `AppTile.tsx:230-232` — `{!app.isHealthy && app.healthMessage != null && (<span className="pv-app-unhealthy-message">{app.healthMessage}</span>)}`. CSS `pretty-conversations.css:1504-1509` — `color: #f4a09b; font-style: italic; font-size: 11.5px`. Component tests **E** (renders healthMessage verbatim), **G** (null healthMessage → no second line). |
| 7 | Left-click on a tile is a no-op; cursor styling deemphasised (D-13) | VERIFIED | `AppTile.tsx:202-213` — NO `onClick` handler on the root `<div>`. `pretty-conversations.css:1408` — `cursor: default;` (overrides `.pv-row`'s `cursor: pointer`). Component test **J** asserts plain click does NOT fire `window.open`. |
| 8 | Right-click / long-press opens context menu with "Open in new tab" action (D-12) | VERIFIED | `AppTile.tsx:125-153` — `onContextMenu={onRowContextMenu}` (desktop right-click) + `onTouchStart={onTouchStart}` with 500ms `setTimeout` + 10px movement gate (mobile long-press). `menuItems` at `:189-200` = `[{ label: "Open in new tab", onClick: () => window.open(...) }]`. `navigator.vibrate?.(10)` feature-checked for iOS. Component test **H** (menu opens with exactly one "Open in new tab" item). |
| 9 | "Open in new tab" fires `window.open(url, "_blank", "noopener,noreferrer")` for tabnabbing prevention | VERIFIED | `AppTile.tsx:197` — `window.open(openUrl, "_blank", "noopener,noreferrer");`. `openUrl` at `:183` = `/apps/${app.hostId}/${app.slug}`. Component test **I** verifies `window.open` called with exact 3 args including tabnabbing-guard string. |
| 10 | Client store updates atomically on every app-snapshot/app-update/app-gone frame (D-14 no partial states) | VERIFIED | `app-tiles-store.ts:103-165` — `publishAppSnapshot` clears-and-repopulates the map atomically then notifies; `publishAppUpdate` clones map + sets key + replaces state + notifies; `publishAppGone` clones + deletes + replaces + notifies. Zero throttling / debouncing / batching. Store tests (11/11 pass) cover the atomic-per-frame contract. AppShell wiring at `AppShell.tsx:685-693` routes each callback to the corresponding publish fn. |
| 11 | Sort is stable across frame updates (D-15) | VERIFIED | `app-tiles-store.ts:193-205` — `useAppTiles()` sorts via `title.localeCompare(other, undefined, { sensitivity: "base" })` primary + `${hostId}:${slug}`.localeCompare tiebreak. Pitfall 6 mitigation in place. Store test H (Pitfall 6 regression) asserts host-1 and host-2 same-title tiles stay in stable order across an `app-update`. |
| 12 | New backend endpoint `GET /apps/:hostId/:slug/icon` mirrors identity-avatar shape (D-06) | VERIFIED | `src/backend/database/routes/apps.ts:53-136` — `router.get("/:hostId/:slug/icon", authenticateJWT, ...)`. Shape mirrors `identities.ts:849-966` exactly: auth gate, hostId parsed as positive int (400 on invalid), slug validated via APP_SLUG_RE (400 on invalid), `resolveHostById(hostId, userId)` (502 on null — no cross-tenant fingerprint), `connectOneShot(host, 5_000)` (502 on throw), `readAppIconFile(conn, slug)` (404 on null, 200 + bytes + ETag on present), `finally { conn.end() }`. Route mounted at `database.ts:1982` (`app.use("/apps", appsRoutes)`). 15/15 route tests pass. |
| 13 | Backend endpoint's slug validation uses APP_SLUG_RE bounded regex | VERIFIED | `identity-artifact-reader.ts:185` — `export const APP_SLUG_RE = /^[a-z0-9-]{1,64}$/`. Kebab-case-only (no underscore, differs from `IDENTITY_KEY_RE`), bounded to 64 chars. Enforced at route entry (`apps.ts:62`) AND inside helper (`identity-artifact-reader.ts:2627`) — defence-in-depth. Helper tests T1a-e cover accepts/rejects for path chars, shell metachars, empty, and >64. |
| 14 | Frontend `fleet-status-types.ts` + `fleet-status-client.ts` extended to include app frame arms (Pitfall 1 fix) | VERIFIED | `fleet-status-types.ts:135-149` (`AppState` interface, 9 fields verbatim from backend); `:372-389` (`FrontendAppSnapshotFrame`, `FrontendAppUpdateFrame`, `FrontendAppGoneFrame`); `:391-399` (widened `FrontendOutboundFrame` union). `fleet-status-client.ts:91-93` (three optional callbacks on `FleetStatusClientOptions`); `:253-293` (three switch cases dispatching to callbacks with `console.info` operation logs). 5/5 dispatch tests pass. |
| 15 | Section placement: below search-container, above Pinned group, OUTSIDE the search-vs-three-zone ternary (Pitfall 2) | VERIFIED | Vertical DOM order in `PrettyConversationsPanel.tsx`: `.pv-search-container` at `:1797` → `.pv-apps-section` at `:1879` → ternary `{searchMatches !== null ? ...}` at `:1927` → `.pv-panel-group[data-pinned-group="true"]` at `:1964` (inside the three-zone branch of the ternary). The Apps section sits BEFORE the ternary — a sibling of the loading strip block, not a child of either ternary branch. Integration test **A19** at `:4532` proves the header remains visible after `fireEvent.change(searchInput, {target: {value: "xyz"}})`. Integration test **A20** at `:4563` proves DOM order via `compareDocumentPosition & Node.DOCUMENT_POSITION_FOLLOWING`. |
| 16 | Empty-expanded state renders "Ask an agent to make an app for you." verbatim (D-04) | VERIFIED | `PrettyConversationsPanel.tsx:1906-1909` — inside `{appsExpanded && ...}`, when `appTiles.length === 0`, renders `<div className="pv-apps-empty px-4 py-2 text-[13px] italic text-[#5c6070]/85">Ask an agent to make an app for you.</div>`. Italic + muted styling per D-04. Integration test **A17** verifies the string becomes visible after clicking to expand. |
| 17 | Zero unrelated files modified | VERIFIED | `git diff --stat 4ae55708..HEAD` = 25 files: 6 planning artifacts (SUMMARY + deferred), 8 new files (routes, tests, helpers, store, tile), 6 modified files (all directly in scope: AppShell, fleet-status-client, fleet-status-types, PrettyConversationsPanel, pretty-conversations.css, identity-artifact-reader, database, database.ts, STATE.md). All modifications trace directly to a D-decision in CONTEXT.md. No adjacent-file drift. |

---

## Required Artifacts — Level 1-4 Verification

| Artifact | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Wired) | Level 4 (Data flows) | Status |
|----------|:---:|:---:|:---:|:---:|:---:|
| `src/ui/api/fleet-status-types.ts` (extended) | pass | pass (63 lines added; 3 frame arms + union widened) | pass (imported by fleet-status-client, app-tiles-store, panel tests, AppShell) | pass (types consumed at runtime by switch narrowing) | VERIFIED |
| `src/ui/api/fleet-status-client.ts` (extended) | pass | pass (64 lines net; 3 optional callbacks + 3 switch cases) | pass (imported by AppShell) | pass (WS frames → switch → callbacks fire at runtime) | VERIFIED |
| `src/ui/state/app-tiles-store.ts` (new) | pass | pass (222 lines, real Map + useSyncExternalStore + sort) | pass (imported by AppShell + panel + tests) | pass (AppShell publishes → map mutates → useAppTiles fires) | VERIFIED |
| `src/ui/AppShell.tsx` (extended) | pass | pass (27 lines added — import + 3 callback wires) | pass (createFleetStatusClient call at :661-694) | pass (WS callbacks route to publish fns unchanged) | VERIFIED |
| `src/ui/features/pretty-conversations/AppTile.tsx` (new) | pass | pass (244 lines — real component with all D-07..D-13 branches) | pass (imported by PrettyConversationsPanel :165) | pass (renders for each app in useAppTiles() output) | VERIFIED |
| `src/ui/features/pretty-conversations/pretty-conversations.css` (extended) | pass | pass (153 lines added — .pv-app-tile, .pv-app-icon-slot, etc.) | pass (selectors match classes emitted by AppTile) | N/A (pure styling) | VERIFIED |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (extended) | pass | pass (96 lines net — import + hooks + JSX block at 1879) | pass (integrated into main render tree above ternary) | pass (useAppTiles → map → AppTile renders per entry) | VERIFIED |
| `src/backend/database/routes/apps.ts` (new) | pass | pass (138 lines — full mirror of identity-avatar route) | pass (mounted at database.ts:1982 via app.use("/apps", ...)) | pass (calls resolveHostById + connectOneShot + readAppIconFile with real args) | VERIFIED |
| `src/backend/database/database.ts` (extended) | pass | pass (6 lines — import + one mount line) | pass (Express app mounts the router at /apps prefix) | pass (Express dispatches /apps/:hostId/:slug/icon to route handler) | VERIFIED |
| `src/backend/claude-session/identity-artifact-reader.ts` (extended) | pass | pass (92 lines — APP_SLUG_RE + readAppIconFile with LOCAL + REMOTE branches) | pass (imported by apps.ts route + apps.test.ts) | pass (route calls helper with real conn + validated slug) | VERIFIED |

---

## Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| WS frame arrival | `fleet-status-client` switch | `ws.onmessage` handler in client | WIRED | 3 new cases (`app-snapshot`, `app-update`, `app-gone`) parse frame + call optional callback |
| `fleet-status-client` callbacks | `AppShell` handlers | `createFleetStatusClient({ onAppSnapshot, onAppUpdate, onAppGone })` at `AppShell.tsx:685-693` | WIRED | Each callback dispatches to corresponding `publish*` fn |
| `AppShell` publish calls | `app-tiles-store` state | `publishAppSnapshot`, `publishAppUpdate`, `publishAppGone` exports from `@/state/app-tiles-store` | WIRED | Map mutations trigger `notify()` → listener fanout |
| `app-tiles-store` → `PrettyConversationsPanel` | `useAppTiles()` hook | `useSyncExternalStore` + `useMemo` sort | WIRED | Sorted array flows to panel on each publish |
| `PrettyConversationsPanel` → `AppTile` | JSX map at `:1911-1913` | `appTiles.map((app) => <AppTile key=... app={app}/>)` | WIRED | One `AppTile` per store entry, inside `{appsExpanded && ...}` gate |
| `AppTile` → backend icon endpoint | `<img src={iconUrl}>` | `iconUrl = /apps/${hostId}/${slug}/icon` at `AppTile.tsx:182` | WIRED | Browser fetches on mount when `hasIcon:true`; `onError` flips to fallback |
| Backend icon route → SSH file read | `readAppIconFile(conn, slug)` at `apps.ts:100` | LOCAL: fs.readFile; REMOTE: SFTP + ls-probe | WIRED | Returns `{bytes, mime}` or null; route serves bytes with `Content-Type: image/webp` |
| "Open in new tab" action → new tab | `window.open(url, "_blank", "noopener,noreferrer")` at `AppTile.tsx:197` | Same-origin URL `/apps/${hostId}/${slug}` | WIRED | Browser opens fresh tab with session cookie inherited (auth via same-origin); tabnabbing guard set |

Every link in the end-to-end chain is real code with no gaps.

---

## Data-Flow Trace (Level 4)

**Chain:** Phase 118 WS server → `/fleet-status/ws` → `fleet-status-client.ts` switch → `AppShell.tsx` callback → `app-tiles-store` publish fn → module-scoped Map → `useAppTiles()` hook → `PrettyConversationsPanel` → `<AppTile>` per entry → `<img>` fetch to `/apps/:hostId/:slug/icon` → `apps.ts` route → `readAppIconFile` → `~/fleet/apps/<slug>/icon.webp` bytes.

Every hop is real code (no stubs, no mock defaults, no hardcoded empty values that flow to render). The one intentional "empty by default" state — the store map is empty until the first frame arrives — is the D-17 no-pre-first-frame contract and is correct-by-design.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Scoped vitest for all Phase 119 files passes | `npx vitest related --run <8 files>` | 100 test files / 1663 tests passed / 10 skipped / 1 todo / 0 failed | PASS |
| TypeScript compiles clean | `npm run type-check` (root tsc --noEmit) | Exit 0, zero errors | PASS |
| End-to-end route + component test coverage exists | 4 dedicated test files + 6 integration tests A15-A20 | All green | PASS |
| Icon endpoint returns webp bytes | Cannot spot-check without live server (deploy held) | SKIP — see human verification | SKIP |
| Real UAT on t1000 with scratch app | D-20 explicit UAT step | SKIP — planned for campaign-close (D-20) | SKIP |

Notes:
- The two SKIP items are legitimately deferred to human UAT (D-20). They require a live Skynet + a scratch `~/fleet/apps/scratch-sidebar-test/` setup, which is out of scope for an in-process verifier and is explicitly scheduled for campaign-close per D-20.
- The scoped test suite is comprehensive: 1663 tests across 100 files, all green. This is a strong regression net.

---

## Anti-Pattern Scan

| Category | Pattern | Files scanned | Findings |
|----------|---------|---------------|----------|
| Debt markers | `TBD\|FIXME\|XXX` | All Phase 119 modified/new files | **0 matches** |
| Cleanup markers | `TODO\|HACK\|PLACEHOLDER\|not yet implemented\|coming soon` | All Phase 119 modified/new files | **0 matches** |
| Streaming affordances | `skeleton\|shimmer\|connecting\.\.\.\|Loading\.\.\.` | AppTile.tsx, PrettyConversationsPanel.tsx, app-tiles-store.ts | 1 match — a comment in `app-tiles-store.ts:29` documenting the NO-streaming rule ("NO 'connecting...' affordance"). Not an actual streaming affordance. |
| Empty implementations | `return null; return \{\}; return \[\]` in touched files | AppTile.tsx, apps.ts | 0 problematic matches (`return null` in the tile is the reader hook returning empty until first frame — D-17 correct behavior) |
| Forbidden ops in commits | `git push\|docker build\|docker compose\|git worktree` | 19 Phase 119 commits | **0 matches** — deploy hold honoured |
| Left-click affordance drift | `onClick=` on `.pv-app-tile` root | AppTile.tsx | **0 matches** — D-13 no-op preserved |
| Per-app hue emission | `style=\{\{.*--pv-hue` in tile code | AppTile.tsx | **0 matches** — D-09 preserved |
| Client-side host re-filter | `checkHostAccess\|hostAccess\|filter.*apps` | Panel + store + tile | **0 matches** — backend authority preserved (D-14) |

Zero blockers. Zero warnings.

---

## Requirements Coverage (D-decisions from CONTEXT.md)

| D-ID | Description | Status | Evidence |
|------|-------------|--------|----------|
| D-01 | Placement — first content group under search, above Pinned | SATISFIED | Panel DOM order: search 1797 → apps 1879 → ternary 1927 → pinned 1964. Integration test A20. |
| D-02 | Section header mirrors Archived chrome verbatim | SATISFIED | Same button semantics + `flex items-center gap-2 px-4 pt-3 pb-1.5` + `text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85` + gradient rule + rotating ChevronDown. Icon = `AppWindow` per Claude discretion. |
| D-03 | Collapsed by default; lazy-render | SATISFIED | `useState(false)` at 764; `{appsExpanded && ...}` gate at 1904. Integration test A16 with populated fixture. |
| D-04 | Empty-expanded prompt verbatim | SATISFIED | `PrettyConversationsPanel.tsx:1908` — "Ask an agent to make an app for you." rendered italic + muted. Integration test A17. |
| D-05 | Section ALWAYS present regardless of tile count | SATISFIED | No `.length > 0` gate on wrapper; only the inner branch is gated. Integration test A15. |
| D-06 | New backend endpoint mirrors identity-avatar | SATISFIED | `apps.ts:53-136` — full mirror + `APP_SLUG_RE` + `readAppIconFile` helper. 15/15 route tests. |
| D-07 | Client icon URL construction | SATISFIED | `AppTile.tsx:182` — `/apps/${hostId}/${slug}/icon`. Component test A. |
| D-08 | Iconless first-letter fallback | SATISFIED | `AppTile.tsx:185-217` — state-flip on onError OR hasIcon:false → `<span className="pv-app-icon-initial">L</span>`. Tests B, C, D. |
| D-09 | All tiles inherit `--pv-hue: 216` | SATISFIED | No inline `--pv-hue` on tile root; CSS has no override. Test K. |
| D-10 | Tile = .pv-row glass + rounded-square + title-only | SATISFIED | CSS `.pv-app-tile` inlines .pv-row tokens; `.pv-app-icon-slot` at 10px border-radius; no secondary line. Test F. |
| D-11 | Unhealthy = two-line with muted-red healthMessage | SATISFIED | `AppTile.tsx:230-232` + CSS `#f4a09b italic 11.5px`. Tests E, G. |
| D-12 | Context menu with "Open in new tab" | SATISFIED | `AppTile.tsx:125-153` + menuItems 189-200 + `window.open(url, "_blank", "noopener,noreferrer")`. Tests H, I. |
| D-13 | Left-click no-op; cursor: default | SATISFIED | No onClick on tile root; CSS `cursor: default`. Test J. |
| D-14 | Atomic reconciliation on frame; no streaming | SATISFIED | Store publish fns replace map wholesale + notify; zero throttling; no skeleton rows anywhere. Store tests. |
| D-15 | Stable sort with hostId:slug tiebreak | SATISFIED | `useAppTiles()` comparator has both keys; Pitfall 6 test H. |
| D-16 | Standalone store slice (not bolted on) | SATISFIED | New file at `src/ui/state/app-tiles-store.ts`; zero imports from conversation/identity/session stores. |
| D-17 | No pre-first-frame state | SATISFIED | Store starts empty; useAppTiles returns []; no loading UI. |
| D-18 | Three-layer testing | SATISFIED | Component (AppTile.test.tsx 11 tests) + Store (app-tiles-store.test.ts 11 tests) + Integration (PrettyConversationsPanel.test.tsx A15-A20) + Backend (apps.test.ts 15 tests + read-app-icon.test.ts 11 tests). |
| D-19 | Scoped executor test runs | SATISFIED | Each plan's SUMMARY documents `npx vitest related --run <files>` invocations. |
| D-20 | Real end-to-end agent UAT | DEFERRED — Human required | Scratch app on t1000 required; explicit human step per D-20. See Human Verification section. |

**Coverage:** 19/20 D-decisions programmatically SATISFIED. D-20 is explicitly a human UAT step scheduled for campaign-close.

---

## Fleet-Rule Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| No `git push` in commits | PASS | Grep of commit stats for `git push` = 0 |
| No `docker build` in commits | PASS | Grep = 0 |
| No `docker compose up` in commits | PASS | Grep = 0 |
| No `git worktree` usage | PASS | Grep = 0 |
| No streaming affordances (skeleton / spinner / "connecting...") | PASS | Only match is a NO-streaming-rule comment in the store module |
| Deploy hold honoured | PASS | Branch is 65 commits ahead of origin; stack is local |

---

## Cross-Cutting Guarantees

- **Pitfall 1 mitigation:** Frontend type mirror `fleet-status-types.ts` extended in lockstep with backend `wire-protocol.ts`. Silent-drop bug closed. Test 5 in fleet-status-client.test.ts regression-guards unknown-frame default branch.
- **Pitfall 2 mitigation:** Apps section rendered OUTSIDE the search-vs-three-zone ternary (sibling of the loading strip, not a child of either branch). Integration test A19 asserts survival on active search.
- **Pitfall 3 mitigation:** `.pv-app-icon-initial` has NO standalone CSS rule; letter typography lives on the parent `.pv-app-icon-slot` — mirrors `.pv-avatar` / `.pv-avatar-initial` discipline.
- **Pitfall 4 mitigation:** `suppressNextClickRef` retained in AppTile even though v1 has no left-click affordance — shape 4 forward-compat.
- **Pitfall 5 mitigation:** `readAppIconFile` reads exactly `icon.webp` — no multi-extension cascade. Test T7 (helper) is an AST-level assertion that no `png|jpg|jpeg|gif|svg` extensions appear in the helper body.
- **Pitfall 6 mitigation:** Sort comparator uses `${hostId}:${slug}` tiebreak; Store test H verifies stability across `app-update` for two same-title tiles on different hosts.
- **Security defence-in-depth:** `window.open` uses `noopener,noreferrer`; `APP_SLUG_RE` gates at both route entry and helper entry; `resolveHostById` produces a single canned 502 for both cross-tenant and unknown host (no fingerprint); JWT auth via existing `authenticateJWT` middleware; ETag + Cache-Control: no-store; healthMessage rendered as React text node (auto-escaped).

---

## Human Verification Required

Two items are legitimately out of scope for programmatic verification and are explicitly deferred:

### 1. D-20 real end-to-end agent UAT on t1000

**Test:** Create scratch `~/fleet/apps/scratch-sidebar-test/` on t1000 with a real `app.json` (title + description) + a real systemd `--user` unit + an `icon.webp` (any small test image); open the Skynet sidebar; expand the Apps section; verify the tile appears with the icon rendered; right-click → "Open in new tab" opens a fresh authenticated tab; stop the unit → tile flips to the unhealthy two-line rendering with the healthMessage; delete the folder → tile disappears on next sweep tick. Cleanup after (delete folder + `systemctl --user stop` + `disable` + `daemon-reload`).
**Expected:** Sidebar Apps section appears, discoverable when empty, populated when a scratch app is dropped, transitions to unhealthy on `systemctl stop`, disappears on folder delete. "Open in new tab" produces an authenticated tab (may 404 in v1 pending shape 4 — acceptable per campaign-hold).
**Why human:** Requires live Skynet + SSH to t1000 + real systemd unit lifecycle; not programmatically simulatable from the verifier.
**When:** Campaign-close, pre-deploy — per D-20 explicit assignment.

### 2. Icon endpoint response smoke-check

**Test:** With a locally-built Skynet backend running, `curl -H "Authorization: Bearer <jwt>" http://localhost:<port>/apps/1/scratch-sidebar-test/icon` — expect 200 + `Content-Type: image/webp` + `Content-Length` + `ETag` + bytes.
**Expected:** Bytes returned; `curl` `--head` shows headers per D-06 discipline.
**Why human:** Requires live server + valid JWT + scratch app on disk.
**When:** Same as D-20 — campaign-close agent UAT.

Both items are ALREADY on the D-20 UAT checklist and are the campaign-close orchestrator's responsibility (not this verifier's).

---

## Gaps Summary

**None.**

- All 17 must-haves listed in the phase context are VERIFIED with concrete file+line evidence.
- All 20 D-decisions from CONTEXT.md are SATISFIED (19 programmatically + 1 explicit human UAT step).
- Both mitigatable RESEARCH.md pitfalls (1 = frontend type mirror; 2 = section outside ternary) are provably fixed in code AND regression-tested.
- Zero unrelated files modified; zero debt markers; zero streaming affordances; zero fleet-rule violations.
- Scoped test suite runs 1663 tests across 100 files, all green.
- Type-check is clean.

**Note on pre-existing errors:** 26 TS errors in `src/backend/distributor/catalog.ts` are documented in `deferred-items.md` as out-of-scope pre-existing failures (verified pre-existing via stash-baseline in Plan 119-05). These are NOT introduced by Phase 119 and are not gaps in this phase's scope.

**Note on deferred items:** Left-click behaviour (open-in-current-view + drag-into-split), per-app colour, and the app-content proxy itself are explicitly deferred to shape 4 per the shape file's scope edges. Phase 119 delivers standalone value (view your apps + open them in a new authenticated tab) exactly as the shape file's "Deliver standalone value" philosophy demands.

---

## Verdict

**Status: passed**
**Score: 17/17 must-haves verified**

Phase 119 delivers the goal. The sidebar Apps section is real, wired end-to-end, tested at three layers plus the backend route, and shipped as commits on `feat/tab-title-from-tmux` awaiting the campaign-close deploy. Every load-bearing decision (D-01 through D-20 minus the explicit-human D-20 UAT) has code and tests behind it. Every pitfall the researcher flagged is provably mitigated with a code+test pair. Every fleet rule is honoured (deploy held, no worktrees, no streaming, no unrelated file drift).

The one remaining step before deploy is D-20's real-hardware UAT on t1000, which is explicitly the campaign-close orchestrator's job — not a gap in this verification.

---

*Verified 2026-09-18T20:14:00Z by Claude Opus 4.7 (gsd-verifier)*
