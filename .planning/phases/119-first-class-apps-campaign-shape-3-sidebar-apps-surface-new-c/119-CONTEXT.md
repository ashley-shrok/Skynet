# Phase 119: First-class apps — sidebar surface (shape 3) - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning
**Source:** Shape file at `.planning/campaigns/first-class-apps/shape-sidebar-apps-surface.md` (opened + greenlit 2026-09-18 via /build → /open). This CONTEXT.md is seeded from that shape file per the build-skill rule "seed discuss-phase from the shape file — do not re-do the discovery /open already did." Discuss-phase surfaced four residual gray areas /open did not cover (icon serving path, unhealthy tile visual, iconless-slot fallback, left-click behaviour in v1); those decisions land as D-06 through D-13 below. The shape file's `## Scope edges` and `## Philosophy` sections are the locked ruleset for everything else.

<domain>
## Phase Boundary

Deliver the sidebar surface that renders Phase 118's live app-frame subscription channel: a new collapsible section in the sidebar (`PrettyConversationsPanel.tsx`) positioned below the search input and above the Pinned group, always visible so the whole feature is discoverable. Populated tiles let the user open an app in a separate authenticated browser tab via a right-click / long-press context menu. Data comes from Phase 118's channel; backend already applies per-user host-visibility filtering, so the client renders whatever the channel delivers without a second layer of filtering.

**Cross-repo scope:** Skynet frontend (TS/React: sidebar section chrome + tile component + subscription consumer + client-side store slice + context menu wiring) + Skynet backend (TS: one new endpoint that serves the raw icon file for a given app, mirroring the identity-avatar serving pattern). All files live in this repo (`~/skynet-vision`). No fleet-substrate changes — the Python sweep script and its wire schema are Phase 118's job and are already complete.

**Relation to prior phases and adjacent shapes.** Phase 118 (shape 2 of this campaign, `.planning/phases/116-*/`) delivered the app-frame subscription channel — `app-snapshot` on subscribe, `app-update` on state change, `app-gone` on removal, per-user filtered at the wire boundary via `checkHostAccess`. Phase 119 subscribes to that channel and paints tiles. Phase 115 landed the collapsible archived-section pattern (`archivedExpanded` state, lazy-render when collapsed, `pv-archived-section` chrome at `PrettyConversationsPanel.tsx:1996-2033`) — Phase 119's Apps section mirrors it. Phase 68 established the identity-avatar serving pattern (`GET /identities/:identityKey/avatar?hostId=<n>` at `identities.ts:849-`) — the new icon-serving endpoint (D-06) mirrors it. Shape 1 of the first-class-apps campaign (closed 2026-09-18) locked the `icon.webp` filename convention in `~/fleet/apps/<slug>/`; Phase 119's backend reads that specific filename. Shape 4 (app-pane content type + proxy) depends on Phase 119 landing and is not this phase's concern; the shape file's `## Scope edges` explicitly reserves left-click behaviour and drag-into-split for shape 4.

</domain>

<decisions>
## Implementation Decisions

### Section chrome + placement

- **D-01: Placement — below search, above the Pinned group.** The Apps section is the first content group under the search input, pushing Pinned + main list + Archived one slot down in the vertical order. Search stays first-in-scroll so the cold-load hide-search-above-viewport effect at `PrettyConversationsPanel.tsx:766-781` isn't disturbed. Rationale: apps are the campaign's headline feature; putting them first-content maximises discoverability (Ashley 2026-09-18, /open Q3 leaning + thumbs-up).

- **D-02: Section header mirrors the Archived pattern at `PrettyConversationsPanel.tsx:1997-2020` verbatim.** Same button semantics (`onClick` toggles state, `aria-expanded`, `aria-controls`), same layout (`flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left`), same typography (`text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85`), same rule-line (`bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]`), same rotating `ChevronDown` (`transition-transform ${expanded ? "rotate-180" : ""}`). Label text: **"Apps"** (title-case source, rendered uppercase via CSS per the pattern — matches "Archived"). Icon glyph: the planner picks a coherent lucide-react icon at plan time (`Grid`, `LayoutGrid`, `AppWindow`, `Boxes`, and `Package` are all reasonable; `AppWindow` reads most literally as "apps"). Rationale: reuse-not-reinvent — the shape file's `## Philosophy` section is explicit.

- **D-03: Collapsed by default on every mount, with lazy-render when collapsed.** Copy the archived section's exact discipline at `PrettyConversationsPanel.tsx:737` — `const [appsExpanded, setAppsExpanded] = useState(false)` and gate the tile-list rendering on `{appsExpanded && ...}`. Do NOT use a CSS `hidden` class or aria-only approach; content stays out of the DOM until expanded. Rationale: matches D-19 invariant Phase 115 locked; a many-tile mount into a collapsed section is wasted layout work.

- **D-04: Empty-expanded state.** When `appsExpanded && appTiles.length === 0`, render a single italic muted line: **"Ask an agent to make an app for you."** — verbatim. Styling matches the muted `#5c6070/85` tone the section header uses; keep it italic and low-emphasis. Rationale: the whole reason the section is always-visible is discoverability; the empty prompt is what makes an unfamiliar user understand what the section is for (shape file `## Philosophy`).

- **D-05: The section is always in the sidebar, regardless of whether apps exist.** Never gate the section header on `appTiles.length > 0`. A user with zero apps still sees the collapsed "Apps" section; expanding it shows the D-04 prompt. Rationale: this is the load-bearing discoverability invariant — omitting it defeats the campaign's premise. Explicitly called out because the natural instinct is to hide-when-empty.

### Icon serving + iconless fallback

- **D-06: New backend endpoint `GET /apps/:hostId/:slug/icon`, mirroring `GET /identities/:identityKey/avatar?hostId=<n>` shape at `identities.ts:849-`.** Backend authenticates via `authenticateJWT`, validates `hostId` as a positive integer, validates `slug` against a kebab-case regex (mirror `IDENTITY_KEY_RE` — the plan can either reuse it or define an `APP_SLUG_RE` parallel; slugs are kebab-case per shape 1). Resolves the host via `resolveHostById(hostId, userId)` — reuses the same auth/visibility gate the identity endpoint uses. For local (`isLocalHostId`) reads directly; for remote uses `connectOneShot(host, 5_000)` + a `readAppIconFile(conn, slug)` helper that shells to `cat ~/fleet/apps/<slug>/icon.webp` on the target box (parallel to `readAvatarSiblingFile`). 404 on absent file; the client's `<img onError>` renders the iconless fallback. Rationale: Ashley 2026-09-18 verbatim on the icon serving question: *"i would ask how identities get their icons because i imagine it's going to be almost the same process"* — confirmed the mirror-the-existing-pattern approach.

- **D-07: Client icon URL construction.** Because the backend endpoint bakes `hostId` into the URL path (matching the identity URL's discipline of baking hostId into the URL), the client constructs `/apps/${hostId}/${slug}/icon` from the frame's `hostId + slug` fields and renders `<img src={iconUrl} ...>` when `hasIcon: true`. If `hasIcon: false` OR the image fetch fails (server 404, network error), the tile falls back to D-08. Rationale: mirrors Phase 68 Plan 04's "backend bakes hostId into the URL string, frontend renders directly" discipline — no helper function needed.

- **D-08: Iconless fallback — first-letter on the default-hue square.** Mirrors the identity-row pattern at `PrettyConversationRow.tsx:1213-1215` (`<span className="pv-avatar-initial">{initialLetter}</span>`). The rounded-square icon slot fills with the same neutral tile hue (default `--pv-hue: 216`, see D-09); the first letter of the app title renders inside in the same warm off-white the tile's text uses. NO per-app hashed hue on the fallback square — that would reintroduce per-app colour and violates D-09. Rationale: Ashley 2026-09-18 tasting-round-2 Q1 pick "A" (first-letter fallback); wording: *"there's a default color that identity list items in the conversation list take on when they don't have a color associated with them from the cosmetics that come over and these apps would just be that color"* — the neutral hue IS the sidebar's default.

- **D-09: All app tiles share the sidebar's default hue (`--pv-hue: 216`) in v1.** No per-app colour, no per-host colour, no hashed hue on any surface (tile, icon slot, fallback square). Locked from /open Q1 (Ashley 2026-09-18: *"i would say we don't try to color them for version one"*). The `.pv-row` fallback hue at `pretty-conversations.css:338` IS the token; app tiles do NOT emit a per-app `--pv-hue` override. Rationale: Ashley's explicit call; the tile treatment is ready to receive per-app hue later if the decision ever flips, without any structural change.

### Tile visual + interaction

- **D-10: Tile visual is variant A from tasting round 1** — full glass bubble matching `.pv-row` conversation-row treatment (padded rectangle, gradient, hover lift, drop shadow), with two deliberate differences from a conversation row: (a) the icon slot is a rounded square (~10px border-radius) not a 999px round disc, and (b) the body is single-line title-only, no `.pv-body` secondary/hostname line. Locked from /open (Ashley 2026-09-18: *"we basically just take the way an identity conversation shows up in the conversation list already except make the icon more square and just only do the name of the app"*). Icon-slot dimensions match the avatar disc dimensions of `.pv-avatar` (40×40px) for visual weight parity.

- **D-11: Unhealthy tile visual — two-line tile, muted-red healthMessage under title.** When the incoming frame carries `isHealthy: false` (Phase 118 D-02 emits this for `unit exists but currently stopped`), the tile grows a second line: title on top, `healthMessage` string rendered verbatim in a muted red (approximately `#f4a09b`, italic, small — around 11.5px) below. Breaks the D-10 title-only rule for the unhealthy case only. Backend authors the string (Phase 118 D-03); frontend renders it verbatim without wrapping (single line, `text-overflow: ellipsis` if it overflows). Rationale: Ashley 2026-09-18 tasting-round-2 Q2 pick "A" (two-line with inline message); alternatives B (warning glyph + tooltip) and C (dimmed only) rejected in favour of A's legibility.

- **D-12: Context menu — reuse the existing right-click / long-press interaction pattern used by `PrettyConversationContextMenu.tsx`, with a single action in v1: "Open in new tab."** The action opens the app's Skynet-served URL in a fresh browser tab via `window.open(url, "_blank")` — because the tab is same-origin (Skynet domain), the browser inherits the user's session cookie naturally, so the tab lands authenticated without any handshake. **Important:** shape 4 (`shape-app-pane-content-type`) owns the actual proxy design for serving an app's content back to the client; Phase 119's "Open in new tab" is the ONLY entry point to that URL in v1. The URL construction (path pattern the app is served at) is Claude's discretion at plan time — recommended shape mirrors shape 2's per-app addressing (`/apps/:hostId/:slug` or similar). The action does NOT need to wait on shape 4's proxy being in place; a temporary handler that opens the URL and lets the browser hit shape-4's-eventual endpoint is fine (which today would 404 gracefully — acceptable state in v1 because shape 4 lands under the same campaign hold).

- **D-13: Left-click on a tile is a no-op in v1.** Cursor styling deemphasised (e.g., `cursor: default` not `cursor: pointer`) so users understand the tile is not primary-clickable yet; the whole tile IS still clickable in the sense that right-click / long-press opens the context menu (which the browser respects regardless of cursor styling). Rationale: shape 4 will own left-click for "open in current view / drag into split leaf"; reserving primary-click now means shape 4 doesn't have to migrate an affordance from another mapping later. Ashley 2026-09-18: *"if the future shape is going to be handling the left click then you can choose what to do for that one"* — punted to me, this is the least-work-for-shape-4 answer.

### Data source + rendering

- **D-14: Client subscribes to Phase 118's app-frame channel on mount, applies deltas atomically.** On first frame (`app-snapshot`), populate the client-side app-list store with the full picture. On subsequent frames: `app-update` upserts by `${hostId}:${slug}` key; `app-gone` removes by the same key. Full-list re-render on every frame — atomic paint, no partial states, no skeleton rows, no "connecting…" affordances (fleet no-streaming rule, D-15 of the shape file's What-would-make-it-wrong). Rationale: shape file `## Philosophy` — "render atomically on frame arrival."

- **D-15: Stable client-side sort — alphabetical by title, then by `${hostId}:${slug}` as tiebreak.** Case-insensitive, locale-aware collation via `String.prototype.localeCompare(other, undefined, { sensitivity: 'base' })`. Same sort key applies whether the tile is healthy or unhealthy — no health-based grouping, no unhealthy-at-bottom special treatment. Rationale: shape file `## Shape` — "leaning alphabetical by title." Stable sort matters because the frame stream provides no ordering; a naive sort would reshuffle on every frame and thrash the visible list (`.pv-panel-scroll` layout does not soft-transition row reorders).

- **D-16: Client-side store slice is a new small module.** A new hook or store slice (`useAppTiles()`, `appTilesStore`, or similar — name at planner discretion) subscribes to the Phase 118 WS channel and exposes the sorted app list as a memoised value. The sidebar panel consumes it as a plain array. Do NOT bolt app-tile state onto an existing store slice used for conversations or identities — different data shape, different lifecycle. Rationale: keep concerns separate; a rendering surface that mixes app + conversation state is where regressions hide.

- **D-17: No pre-first-frame state distinction.** The section renders D-04 empty-prompt when `appTiles.length === 0`, regardless of whether the reason is "we haven't received the first frame yet" or "you legitimately have no apps." This is correct-by-design: no "loading" state (fleet no-streaming), the section defaults to collapsed anyway, and by the time a user expands the section the first frame has arrived (subscribe-on-mount + Phase 118 emits `app-snapshot` on subscribe). Rationale: eliminates a class of loading-UI bugs; matches how the conversation list handles cold subscription.

### Testing

- **D-18: Test at three layers — component rendering, store/subscription wiring, integration with the sidebar panel.** Coverage required:
  - **Component:** tile rendering with an icon (renders `<img>`), without an icon (renders first-letter fallback in the default-hue square), unhealthy state (renders two-line with the healthMessage), context menu attach behaviour, ordering stability across multiple frame updates.
  - **Store/subscription:** `app-snapshot` populates the store, `app-update` upserts an existing key, `app-update` inserts a new key, `app-gone` removes by key, unknown-frame types are ignored not thrown on, unmount cleans up the subscription.
  - **Integration:** the Apps section appears in `PrettyConversationsPanel` above the Pinned group, empty state shows D-04 prompt, populated state shows sorted tiles, expanding + collapsing works, tiles are not in the DOM when the section is collapsed (D-03 lazy-render invariant).

- **D-19: Executor uses scoped test runs, deploy uses full suite.** Per fleet directive 2026-09-07: executor's green gate is `npx vitest related --run <touched files>` OR targeted paths under `src/ui/features/pretty-conversations/`. Full suite + Playwright smoke are the ORCHESTRATOR's pre-deploy gate, NOT baked into executor prompts. Standard fleet rule; called out so the planner doesn't seed a full-suite invocation into an executor prompt.

- **D-20: Real end-to-end integration test on this box during agent-side UAT.** Pre-deploy verification: create scratch `~/fleet/apps/scratch-sidebar-test/` on t1000 with a real `app.json` (title + description) + a real systemd `--user` unit + an `icon.webp` (any small test image); open the sidebar, expand the Apps section, verify the tile appears with the icon rendered, verify right-click shows "Open in new tab" and the action opens a fresh tab that lands on the app; stop the unit, verify the tile flips to the unhealthy two-line rendering with the healthMessage; delete the folder, verify the tile disappears on next sweep tick. Cleanup after. This is agent-side UAT (per /build step 6), NOT a CI-runnable test.

### Claude's Discretion (planner + executor decide)

- The lucide-react icon glyph for the section header (`AppWindow`, `Grid`, `LayoutGrid`, `Boxes`, `Package` all plausible — `AppWindow` reads most literally).
- The exact React component name (`AppTile`, `SidebarAppTile`, `AppRow`) — pick something coherent with existing sibling names (`PrettyConversationRow`, `PrettyArchivedRow`).
- The exact hook/store name for the subscription slice (`useAppTiles`, `useAppRegistry`, `appTilesStore`) — pick per existing conventions.
- The exact border-radius on the rounded-square icon slot (target visual is "iOS app icon" — 8-12px range).
- The exact muted-red colour token for the healthMessage — `#f4a09b` was used in the tasting; a project-consistent token is fine if one exists.
- The `APP_SLUG_RE` regex for the icon endpoint's slug validation — mirror `IDENTITY_KEY_RE` (kebab-case, bounded length).
- The exact URL path pattern the "Open in new tab" action opens — mirrors shape 2's per-app addressing shape; the planner may propose the specific path.
- Whether the `<img onError>` fallback path renders the D-08 first-letter fallback via state flip or via a fallback DOM structure that swaps on `img` failure — either works.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/campaigns/first-class-apps/shape-sidebar-apps-surface.md` — the LOCKED agreement from the /open pass 2026-09-18 (amended 2026-09-18 with discuss-phase corrections to the iconless-fallback description). All D-01..D-20 above derive from it or the discuss-phase gray-area answers. **Read first.**
- `.planning/campaigns/first-class-apps/campaign-first-class-apps.md` — the campaign artifact naming the four-shape arc + cross-shape sequencing. Shape 3 delivers standalone user-visible value; shape 4 depends on it.
- `.planning/campaigns/first-class-apps/shape-app-runtime-and-skill.closed.md` — the closed shape 1 artifact defining the disk-side conventions this phase observes (`~/fleet/apps/<slug>/` layout, `app.json` shape, `icon.webp` filename convention).
- `.planning/campaigns/first-class-apps/shape-sweep-and-registry-api.closed.md` — the closed shape 2 artifact defining the app-frame wire protocol this phase consumes.
- `.planning/campaigns/first-class-apps/tasting-tile-visuals.html` and `tasting-tile-details.html` — the two tasting artifacts used during /open + discuss-phase to lock the visual decisions (variant A, iconless first-letter fallback, unhealthy two-line rendering). Served on `Skynet-8899.serve.term.gigaashley.click` during shape work; safe to shut down after plan-phase consumes them.

### Prior phase context (heavy relevance)
- `.planning/phases/118-first-class-apps-sweep-registry-shape-2/116-CONTEXT.md` — the DIRECT precursor. All 23 D-decisions (especially D-01/D-02 inclusion filter, D-03 healthMessage backend-authoring, D-05 seven-field emit shape, D-06 hasIcon boolean, D-14 three frame types, D-15 host-visibility filter, D-16 snapshot-on-subscribe) describe the wire this phase consumes. **Read immediately after the shape file.**
- `.planning/phases/115-identity-archiving-from-the-frontend/115-CONTEXT.md` — establishes the archived-section chrome + lazy-render invariant (D-19 there) that Phase 119 mirrors for the Apps section.

### The Skynet-side sidebar code being extended
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the sidebar panel. Phase 119 adds a new `pv-panel-group pv-apps-section` group under the search input, above the Pinned group. Reference block for the collapsible-group pattern: the Archived section at lines 1996-2033 (state hook at 737, chrome block starting at 1996). Reference block for the mount + search + panel scroll: lines 232-278.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — the existing conversation-row bubble component. Phase 119's `AppTile` component adopts the `.pv-row` glass treatment. Reference block for the avatar fallback pattern (first-letter): lines 1200-1220 (`<span className="pv-avatar-initial">{initialLetter}</span>` at 1214).
- `src/ui/features/pretty-conversations/pretty-conversations.css` — the styling tokens for the sidebar. Phase 119 adds new selectors under a shared `.pv-apps-section` namespace and reuses the existing `--pv-hue` fallback (line 338 for the default hue 216). Reference block for the row bubble treatment: lines 337-391 (`.pv-row` + `:hover` + `.selected`).
- `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` — the existing context menu component + its interaction pattern (right-click + long-press). Phase 119's tile reuses this component or its interaction hook. Read to understand the mount + dispatch shape.

### The backend endpoint being added (mirror pattern)
- `src/backend/database/routes/identities.ts` §849-960 (the `GET /:identityKey/avatar` route) — this IS the template for D-06's new `GET /apps/:hostId/:slug/icon` endpoint. Copy the shape verbatim: auth gate, hostId validation, slug validation, host resolution, SSH fallback for remote, stream the file bytes back, 404 on absent. **Read before implementing the endpoint.**
- `src/backend/database/database.ts` §1900-1950 — where the identities router is mounted. The new apps router mounts alongside (either as `app.use("/apps", appIconRoutes)` or as an extension of the existing router — planner decides).
- `src/backend/database/routes/*.ts` for the `readAvatarSiblingFile` helper (grep for its definition) — parallel `readAppIconFile(conn, slug)` helper for the app icon.

### The wire protocol + subscription channel being consumed
- `src/backend/fleet-status/wire-protocol.ts` — the frame type declarations for `AppSnapshotFrame` / `AppUpdateFrame` / `AppGoneFrame` (added by Phase 118, D-14 there). The client-side subscription slice consumes these directly.
- `src/backend/fleet-status/subscription-registry.ts` — the WS-client subscription surface. Phase 118 added `Map<hostId:slug, AppState>` + publish methods. Phase 119 subscribes as a client; does NOT modify the registry.
- `src/backend/fleet-status/fleet-status-server.ts` — the WS server that emits frames to subscribed clients. Phase 119 is a client of this server. Reference for the subscribe path + snapshot-on-subscribe timing.
- The existing frontend WS-client for the fleet-status channel (grep for the WS-client bootstrap under `src/ui/` or `src/frontend/`) — Phase 119's new subscription slice hooks into the existing client rather than opening a new WS.

### Host visibility (already enforced at the wire boundary)
- `src/backend/database/host-resolver.ts` — `checkHostAccess(hostId, userId, hostUserId, requiredPermission)`. Phase 118 applies this to app frames before broadcast. Phase 119 does NOT re-check visibility on the client — the shape file's `## What would make it wrong` calls out that "tiles leak apps the user doesn't have access to" is a spec-violation, but the CLIENT enforces nothing; backend is the sole authority.

### Files this phase MODIFIES

**Skynet frontend (TypeScript / React):**
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — add the new `.pv-apps-section` group (state hook `appsExpanded`, chrome block mirroring the Archived pattern), position it above the Pinned group in the panel scroll structure. Add the subscription hook mount + tile-list rendering + empty-state rendering.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — new selectors under `.pv-apps-section` for the tile bubble (`.pv-app-tile` or similar), icon slot, first-letter fallback, unhealthy two-line variant. Reuse existing `--pv-hue: 216` default.
- New file: an `AppTile.tsx` component under `src/ui/features/pretty-conversations/` (or a subdirectory if the planner prefers a small feature folder — `src/ui/features/pretty-conversations/apps/`).
- New file: the client-side subscription hook / store slice (`useAppTiles.ts` or similar). Location per existing store conventions in the codebase.

**Skynet backend (TypeScript):**
- One new route file (either `src/backend/database/routes/apps.ts` or an extension of an existing file — planner decides) implementing `GET /apps/:hostId/:slug/icon`. Wire it into `src/backend/database/database.ts` alongside the identity routes.
- Small helper: `readAppIconFile(conn, slug)` — parallel to `readAvatarSiblingFile`, colocated with it.

**Tests:**
- New: `AppTile.test.tsx` — component rendering coverage per D-18.
- New: subscription hook test — store/subscription wiring coverage per D-18.
- Extend `PrettyConversationsPanel.test.tsx` — integration coverage per D-18 (Apps section presence, empty state, populated state, lazy-render invariant).
- New backend route test — the icon endpoint (auth gate, hostId validation, slug validation, 404 on absent file, 200 with bytes on present).

### Files this phase READS (contract references, no changes)
- `.planning/phases/68-*/68-CONTEXT.md` (or Plan artifacts) — where the identity-avatar URL-baking-hostId discipline was established. The new icon endpoint mirrors it.
- `substrate/skills/app-development/templates/app-starter/` — the shape 1 starter template. Confirms `icon.webp` filename + `~/fleet/apps/<slug>/` layout the backend endpoint reads.

### Fleet-wide standing rules
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Standing directives" — especially the container-mutation serialization rule (Ashley 2026-09-12), the executor-scope test discipline (Ashley 2026-09-07), the deploy-boundary-at-push rule (Ashley 2026-08-29), and the no-worktrees rule (Ashley 2026-07-31). Planner and executor must honour these.
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Load-bearing invariants" — DatabaseSaveTrigger discipline (learned 2026-08-19). **Not applicable to this phase** — the sidebar surface is client-state-only and the icon endpoint is a read-only stream — but flagged so the executor doesn't accidentally introduce a DB write.
- Fleet no-streaming rule (Ashley 2026-08-29) — Skynet has NO message streaming ever, anywhere. No skeleton tiles, no "connecting…" spinner, no shimmer. Tiles render atomically on frame arrival.
- Deploy hold for the whole first-class-apps campaign (Ashley 2026-09-18) — Phase 119's commits stack on Phase 118's held commits (which stack on Phase 115's shape-1 held commits) on `~/skynet-vision`'s `feat/tab-title-from-tmux` branch. `git push` + `docker build` + `docker compose up --force-recreate` all held until the campaign-close greenlight.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The Archived-section chrome at `PrettyConversationsPanel.tsx:1996-2033`** — IS the template for D-02 + D-03. Same button semantics, same styling tokens, same lazy-render discipline. Copy the shape; swap "Archived" → "Apps" and the icon.
- **The `.pv-row` glass bubble treatment at `pretty-conversations.css:337-391`** — the tile visual (D-10) reuses this. Same padded rectangle, same gradient formula (parameterised on `--pv-hue`), same hover lift, same drop shadow. Difference: rounded-square icon slot instead of `.pv-avatar` (999px round).
- **`--pv-hue: 216` fallback at `pretty-conversations.css:338`** — the default hue that carries the whole tile (D-09). No override needed; app tiles just don't emit an inline `--pv-hue` style, so they inherit the default.
- **The `.pv-avatar-initial` first-letter fallback at `PrettyConversationRow.tsx:1214`** — IS the pattern for D-08. Same span + inline text, same font sizing.
- **`GET /identities/:identityKey/avatar?hostId=<n>` at `identities.ts:849-`** — the mirror-template for D-06. Same auth gate, same hostId validation, same host resolution via `resolveHostById`, same SSH fallback via `connectOneShot`, same stream-file-back discipline.
- **`readAvatarSiblingFile` helper** (co-located with the identity avatar route) — the mirror for `readAppIconFile`. Shells to cat/read a specific file on the target box; guards path with a pre-validated identifier.
- **`PrettyConversationContextMenu.tsx`** — the existing right-click / long-press context menu component + interaction hook. Phase 119's tile reuses this for the "Open in new tab" action.
- **The fleet-status WS-client bootstrap** (frontend side of Phase 118's channel) — Phase 119's subscription hook attaches to the existing client; does NOT open a second WS connection.

### Established Patterns
- **Icon serving via SSH-based file read** — the identity-avatar route is the fleet's convention for "serve a small file that lives on a remote managed box." Auth at the edge, hostId validation, resolve-host, connect-SSH, read-file, stream. No caching intermediary; the fetch is cheap and the file is small.
- **Lazy-render sections in the sidebar panel** — Phase 115 established D-19 (rows not in DOM until section expanded). Phase 119 follows verbatim.
- **Collapsed-by-default new groups** — every new sidebar group ships collapsed. Rationale: additions to the sidebar must not visually reflow the user's existing view on next load.
- **In-memory-only client store for live-subscription data** — the existing frontend store for conversations does NOT persist to localStorage. Phase 119's app-tiles store follows suit — first frame after mount populates, subsequent frames patch. Restart of the tab = fresh subscribe from cold.
- **`--pv-hue` inline emission for hue-bearing rows** — the pattern rows use to override the fallback hue. Phase 119 does NOT emit; the fallback IS the target.
- **URL path with hostId baked in for per-host resource fetches** — matches Phase 68 Plan 04 discipline. No client-side URL-construction helper needed.

### Integration Points
- **PrettyConversationsPanel `.pv-panel-scroll` → new `.pv-apps-section` group** — the group inserts between the search-container (line 265-278) and the existing first content group (currently Pinned). The scroll behaviour + gap rhythm is set by `.pv-panel-scroll { gap: 8px }` at line 244; the new group inherits it automatically.
- **Fleet-status WS-client (frontend) → Phase 119 subscription hook** — the WS-client is already receiving app frames (Phase 118 wired them). Phase 119 adds a subscriber that filters the frame stream by type (`app-snapshot` / `app-update` / `app-gone`) and forwards to the app-tiles store.
- **Icon endpoint → backend database router mount point** at `src/backend/database/database.ts` §1900-1950 — the new apps router mounts here, alongside the identities router. Mount order matters if there's route-overlap (there isn't — `/apps/:hostId/:slug/icon` doesn't overlap any existing prefix), so append at the end for consistency with recent additions.
- **Container-mutation serialization** (Ashley 2026-09-12) — applies to the eventual deploy motion, NOT to Phase 119's planning or executor phases.

### Test Considerations
- **The existing `PrettyConversationsPanel.test.tsx` is a heavy integration test file** — Phase 119's integration cases add to it rather than creating a new file, mirroring how Phase 115's archived-section tests landed.
- **Component tests for `AppTile` use jsdom + React Testing Library** — mock the icon endpoint via `fetch` mock or `<img>` load event; assert the fallback path when the mock 404s.
- **Subscription hook tests mock the WS-client** — inject a controllable frame stream, assert the store transitions per each frame type.
- **The backend route test uses supertest** against the mounted Express app — the same pattern the identity-avatar route test uses. Grep for the identity avatar test as a template.
- **Real-icon-file agent UAT (D-20)** requires creating a scratch app on t1000 — the app doesn't need to actually serve content (just needs the folder + `app.json` + a systemd unit that starts something trivial like `sleep infinity` + a small `icon.webp`). Cleanup discipline: delete the folder + `systemctl --user stop` the unit + `systemctl --user disable` the unit + `systemctl --user daemon-reload`.

</code_context>

<specifics>
## Specific Ideas

- **Section label copy: exactly "Apps"** (title-case source, rendered uppercase via CSS matching the Archived pattern). Ashley 2026-09-18: *"the header itself would just be icon plus title which would just say app"* — plural per convention.
- **Empty-state copy: exactly "Ask an agent to make an app for you."** Ashley 2026-09-18 confirmed "seems fine" with no better suggestion; I offered no alternative.
- **Icon endpoint URL shape mirrors identity-avatar verbatim.** `GET /apps/:hostId/:slug/icon` — hostId in the URL path, slug in the URL path, no query params, no body. Auth via the same JWT gate the identity route uses.
- **Tile visual is variant A from the round-1 tasting** with two refinements from Ashley: (1) icon slot is rounded-square not round, (2) title-only, no secondary line. Locked from /open. All app tiles use default `--pv-hue: 216`.
- **Iconless fallback is variant A from the round-2 tasting** — first-letter on the default-hue rounded-square (mirrors identity `.pv-avatar-initial`).
- **Unhealthy tile is variant A from the round-2 tasting** — two-line, muted-red healthMessage under title.
- **Left-click behaviour deferred to shape 4** — Phase 119 explicitly no-ops left-click and deemphasises cursor, so shape 4 owns primary-click for open-in-current-view + drag-into-split without a migration friction.

</specifics>

<deferred>
## Deferred Ideas

- **Left-click opens in current view + drag to split leaf** — belongs to shape 4 (`shape-app-pane-content-type`). Explicitly out of Phase 119's scope; the tile's left-click is a no-op in v1 (D-13).
- **Per-app colour / theming / hue** — Ashley 2026-09-18 verbatim: *"i would say we don't try to color them for version one"*. Deferred; the tile treatment leaves room for it without a structural rewrite.
- **Secondary description line under the title** — deferred to a future enhancement if titles alone prove ambiguous. Not shape-sized; adds one line to `AppTile` when the time comes.
- **Grouping tiles by host** — deferred to a follow-up if titles alone become insufficient when the fleet has many boxes each with apps. Flat is the v1 answer.
- **Additional context menu actions** (rename, delete, launch on a specific host, share, "Open in current view") — v1 has just "Open in new tab". Future actions plug into the existing context-menu component.
- **App-management from the sidebar** (create, delete, edit) — app creation is an agent-driven flow (the `app-development` skill), not a user-driven sidebar affordance. Explicitly ruled out.
- **Eager-refresh signal for freshly-created apps** — carries forward from Phase 118's deferred list. If create-to-visible latency (up to 2s per sweep cadence) feels laggy in UAT, a sentinel-file nudge is a small follow-up.
- **Backend caching of icon bytes** — the SSH fetch is cheap per icon and per hit, and the browser will cache normally. If a fleet grows to hundreds of icons or the SSH cost becomes visible, a small in-memory cache with mtime invalidation is a follow-up.
- **Warning glyph or tooltip-only variants for unhealthy tiles** (tasting round-2 Q2 variants B + C) — rejected in favour of A. Not deferred — closed.
- **Hashed per-app hue for the iconless fallback square** — rejected during discuss-phase as violating the no-per-app-colour rule (D-09). Not deferred — closed.

</deferred>

---

*Phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c*
*Context gathered: 2026-09-18*
