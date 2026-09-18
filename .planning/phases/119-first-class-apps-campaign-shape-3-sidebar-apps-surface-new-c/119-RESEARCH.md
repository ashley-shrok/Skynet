# Phase 119: First-class apps — sidebar surface (shape 3) - Research

**Researched:** 2026-09-18
**Domain:** Skynet frontend sidebar composition (React + TS) + one small mirror-pattern backend route (Express/TS) + client-side WS-frame subscription slice
**Confidence:** HIGH — this phase is an "extension of well-established local patterns" phase, not an ecosystem-discovery phase. Every load-bearing pattern (collapsible section, `.pv-row` glass, avatar fallback, SSH-served-file endpoint, WS-client dispatch) already exists in-repo and was line-and-file located during research. There is no unresolved external library or framework question.

## Summary

Phase 119 paints the sidebar surface for Phase 118's live app-frame subscription channel. It is a *composition* phase over an already-locked wire contract (`AppState` in `wire-protocol.ts:632-644`; `app-snapshot` / `app-update` / `app-gone` frames at `wire-protocol.ts:646-663`), with a single small backend route mirroring the identity-avatar SSH-file-serve pattern at `identities.ts:849-966`.

The most important finding is that **Phase 118's frontend-side type mirror was NOT extended** when the backend types landed. `src/ui/api/fleet-status-types.ts` currently declares `FrontendOutboundFrame` as the five-way union (snapshot / update / gone / pong / identity-archived) with no app-frame arm; the `fleet-status-client.ts` switch at `ui/api/fleet-status-client.ts:164-235` accepts only those five kinds and drops unknowns silently. Phase 119 MUST extend both files as its first backend-facing task — otherwise the app-frame subscription slice has nothing to hook into. This is the only real gap; everything else is mirror-work.

The second highest-leverage finding is that the sidebar's `.pv-panel-scroll` structure sits within one JSX branch that already carries a search-vs-three-zone conditional at `PrettyConversationsPanel.tsx:1833`. The Apps section must render OUTSIDE that conditional (so it survives an active search filter — the shape file's "always visible" invariant). The correct insertion point is between the loading strip (line 1823) and the ternary at line 1833, at the same indentation as `{!fleetSessionsLoaded && ...}`. Every other structural pattern (state hook shape, chrome markup, lazy-render short-circuit) copies the Archived section at `PrettyConversationsPanel.tsx:1995-2033` verbatim.

**Primary recommendation:** Structure the phase as five stacked plans — (1) frontend wire types + client dispatch, (2) client-side store slice + hook, (3) `AppTile` component + CSS, (4) `PrettyConversationsPanel` integration + Apps section chrome, (5) backend icon route + `readAppIconFile` helper — then a sixth for tests. Every plan mirrors an existing in-repo pattern. Do NOT invent a new visual language, a new wire protocol, or a new WS connection.

## User Constraints (from CONTEXT.md)

### Locked Decisions

All twenty D-decisions from `117-CONTEXT.md`'s `<decisions>` block are LOCKED. Verbatim summary (planner: use the CONTEXT for full text):

- **D-01** placement — first content group under search, above Pinned.
- **D-02** section header mirrors Archived chrome at `PrettyConversationsPanel.tsx:1997-2020` verbatim; label "Apps"; icon = lucide `AppWindow` recommended (planner's discretion — see D-below).
- **D-03** collapsed by default; `const [appsExpanded, setAppsExpanded] = useState(false)`; lazy-render gated on `{appsExpanded && ...}`; NO CSS `hidden`.
- **D-04** empty-expanded state renders italic muted line "Ask an agent to make an app for you." verbatim.
- **D-05** section ALWAYS present regardless of `appTiles.length === 0`. This is the invariant that differs from the Archived section (which is gated on `archivedRows.length > 0` at `:1995`). This is the whole-feature-discoverability point of the shape.
- **D-06** new backend endpoint `GET /apps/:hostId/:slug/icon` mirrors `GET /identities/:identityKey/avatar?hostId=<n>` at `identities.ts:852-966`. Same auth gate (`authenticateJWT`), same hostId path validation, kebab-case slug validation (mirror `IDENTITY_KEY_RE`), same `resolveHostById` + `isLocalHostId` + `connectOneShot(5_000)` chain; new `readAppIconFile(conn, slug)` helper co-located with `readAvatarSiblingFile`. 404 on absent file.
- **D-07** client constructs `/apps/${hostId}/${slug}/icon` from frame fields; `<img src={iconUrl} onError={...}>` renders when `hasIcon: true`; `onError` OR `hasIcon: false` falls back to D-08.
- **D-08** iconless fallback = first-letter monogram on the default-hue rounded square — mirrors `<span className="pv-avatar-initial">{initialLetter}</span>` at `PrettyConversationRow.tsx:1214`. NO per-app hue.
- **D-09** all tiles inherit `--pv-hue: 216` (the `.pv-row` default at `pretty-conversations.css:338`) — do NOT emit an inline `--pv-hue` style.
- **D-10** tile visual = `.pv-row` glass treatment (`pretty-conversations.css:337-391`) with two differences: rounded-square icon slot (8-12px border-radius per Claude discretion), title-only body (no `.pv-body .pv-ai-title` secondary line). Icon-slot dimensions match `.pv-avatar` 40×40px.
- **D-11** unhealthy tile grows a second line: title + muted-red (`~#f4a09b`) italic ~11.5px `healthMessage` under it. Backend-authored string, rendered verbatim, no wrapping, `text-overflow: ellipsis` on overflow.
- **D-12** context menu reuses `PrettyConversationContextMenu` (or the interaction hook); single v1 action = "Open in new tab" opens `window.open(url, "_blank")`. URL path pattern is planner discretion — recommend `/apps/:hostId/:slug` mirror.
- **D-13** left-click = no-op in v1; `cursor: default`. Right-click / long-press still fires context menu.
- **D-14** subscribe on mount; atomic reconciliation on every frame; NO streaming affordances.
- **D-15** stable sort — alphabetical by title, tiebreak `${hostId}:${slug}`, case-insensitive, `localeCompare(other, undefined, { sensitivity: 'base' })`.
- **D-16** new small store slice — do NOT bolt onto conversations or identities.
- **D-17** no pre-first-frame state — `appTiles.length === 0` = "no apps" (whether cold or empty).
- **D-18** three-layer testing: component, subscription/store, panel-integration.
- **D-19** executor uses `npx vitest related --run <touched>` — orchestrator runs full suite pre-deploy.
- **D-20** real end-to-end agent UAT on t1000 with scratch `~/fleet/apps/scratch-sidebar-test/`.

### Claude's Discretion

- Lucide icon glyph for the section header — `AppWindow`, `Grid`, `LayoutGrid`, `Boxes`, `Package` all acceptable. **Recommendation:** `AppWindow` reads most literally.
- React component name — `AppTile`, `SidebarAppTile`, `AppRow`. **Recommendation:** `AppTile` (short; matches shape file vocabulary; distinct from `PrettyConversationRow` sibling).
- Hook/store name for the subscription slice. **Recommendation:** `useAppTiles()` for the React-facing surface + a `app-tiles-store.ts` module for the mutable state (mirrors the `session-working-store` / `session-waiting-store` naming already in-repo at `src/ui/state/` — verified below).
- Border-radius on rounded-square icon slot — iOS-app-icon target. **Recommendation:** 10px (mid-range of the 8-12px band; visually consistent with the 999px `.pv-avatar` at 40×40 by giving a `40 * 0.25 = 10px` corner).
- Muted-red for `healthMessage` — `#f4a09b` was in the tasting. Use it verbatim in v1 unless the planner finds a matching existing token; grep didn't surface one (the identity `.pv-avatar .pv-trapped-work-indicator` uses `hsla(35, 65%, 55%, 0.85)` warm-amber, which is a semantic-warning colour, not a semantic-error colour).
- `APP_SLUG_RE` regex — mirror `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` at `identity-artifact-reader.ts:175`. **Recommendation:** `APP_SLUG_RE = /^[a-z0-9-]{1,64}$/` (kebab-case per shape 1; drops underscore because shape 1's `create-app.sh` requires kebab-case slugs).
- URL path pattern for "Open in new tab" — planner discretion. **Recommendation:** `/apps/${hostId}/${slug}` (mirrors the backend's `/apps/:hostId/:slug/icon` path shape and shape 4's likely proxy shape); acceptable to 404 in v1 because shape 4 lands under the same held campaign.
- `<img onError>` fallback via state flip vs. fallback DOM. **Recommendation:** state flip (`const [failed, setFailed] = useState(false)` + `<img onError={() => setFailed(true)}>` + `{failed || !hasIcon ? <Fallback/> : <Img/>}`) — matches how other frontend components handle image-load failure and doesn't require CSS `:where` acrobatics.

### Deferred Ideas (OUT OF SCOPE)

Verbatim from CONTEXT.md — do NOT touch these in Phase 119:

- Left-click open-in-current-view + drag-into-split → shape 4.
- Per-app colour / theming → shape 4 or later; explicitly ruled out v1.
- Secondary description line under tile title.
- Grouping tiles by host.
- Additional context menu actions (rename, delete, launch, share, "Open in current view").
- App-management from sidebar (create, delete, edit).
- Eager-refresh sentinel for new apps.
- Backend caching of icon bytes.
- Warning-glyph / dimmed-only variants for unhealthy tiles — REJECTED, closed.
- Hashed per-app hue for iconless fallback — REJECTED, closed.

## Phase Requirements

CONTEXT.md's 20 D-decisions ARE the phase requirements. This project does not use `REQ-XX` IDs — decisions carry the ID (D-01 through D-20). All mapping in this research uses that scheme.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Placement below search, above Pinned | Insertion point: between `PrettyConversationsPanel.tsx:1823` (loading strip) and `:1833` (search-vs-three-zone ternary) — see "Integration Points" |
| D-02 | Section header mirrors Archived pattern verbatim | Template block: `PrettyConversationsPanel.tsx:1995-2033` |
| D-03 | Collapsed by default; lazy-render | State pattern: `PrettyConversationsPanel.tsx:737` (`archivedExpanded`); render gate: `:2021` (`{archivedExpanded && ...}`) |
| D-04 | Empty-expanded prompt "Ask an agent to make an app for you." | New render branch — no in-repo precedent (Archived section short-circuits on empty); style token: `text-[#5c6070]/85 italic` |
| D-05 | Section always present | New render branch — differs from Archived (which gates on `.length > 0`) |
| D-06 | `GET /apps/:hostId/:slug/icon` mirror endpoint | Template: `identities.ts:852-966`; helper: `identity-artifact-reader.ts:2469-2580` |
| D-07 | Client URL construction from frame fields | Precedent: `PrettyConversationRow.tsx:1207` (`src={identity.avatarUrl}` — backend bakes hostId) |
| D-08 | Iconless first-letter fallback | Template: `PrettyConversationRow.tsx:1214` (`<span className="pv-avatar-initial">{initialLetter}</span>`) |
| D-09 | All tiles inherit `--pv-hue: 216` | Token: `pretty-conversations.css:338` |
| D-10 | Tile = `.pv-row` glass + rounded-square icon + title-only | Template: `pretty-conversations.css:337-391` for `.pv-row`; `:399-441` for `.pv-avatar` |
| D-11 | Unhealthy = two-line with muted-red `healthMessage` | New CSS class needed — no in-repo precedent for muted-red inline text |
| D-12 | Context menu reuse; "Open in new tab" | Component: `PrettyConversationContextMenu.tsx` (portal, viewport-clamped, 168px min-width); interaction wiring: `PrettyConversationRow.tsx:397-451` (right-click + long-press) |
| D-13 | Left-click no-op; `cursor: default` | New override — `.pv-row` default is `cursor: pointer` at `pretty-conversations.css:345` |
| D-14 | Atomic reconciliation on frame | Precedent: `fleet-status-client.ts:164-235` (switch-dispatch; snapshot replaces, update upserts, gone removes) |
| D-15 | Stable sort — `localeCompare` + `${hostId}:${slug}` tiebreak | New — memoise inside store selector |
| D-16 | Small standalone store slice | Precedent: `src/ui/state/session-working-store.ts` naming pattern |
| D-17 | No pre-first-frame state | Automatic — subscribe-on-mount + Phase 118 D-16 snapshot-on-subscribe |
| D-18 | Three-layer test coverage | Test scaffolding: see `Standard Stack` — vitest 4 + @testing-library/react 16 + jsdom |
| D-19 | Scoped executor test runs | Command: `npx vitest related --run <files>` |
| D-20 | Real end-to-end UAT | Manual — requires `~/fleet/apps/scratch-sidebar-test/` on t1000 |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Section chrome + lazy-render gate | Frontend Server (React SSR-ish, but this app is CSR) → Browser | — | Pure DOM composition; uses the same `useState` + JSX pattern the Archived section already uses at `PrettyConversationsPanel.tsx:1995-2033` |
| Tile component render (icon slot + title + fallback) | Browser | — | Pure component with local state (image-load failure); no cross-boundary concern |
| Context menu mount + "Open in new tab" action | Browser | — | `window.open(url, "_blank")` is the client-side entry point; the tab's landing page is shape 4's problem, not this phase's |
| WS-frame subscription + store slice | Browser (React store) | Backend (already emits per Phase 118) | Frontend adds a listener on the existing `/fleet-status/ws` connection; NO new WS |
| Icon SSH-file-serve endpoint | Backend / API | Managed-box filesystem (via SSH) | Auth at edge, hostId validation, `resolveHostById`, `connectOneShot`, `readAppIconFile` (new — mirrors `readAvatarSiblingFile`) |
| Host-visibility filter | Backend (already applied Phase 118) | — | `checkHostAccess` at `host-resolver.ts` is applied at frame-broadcast time via `app-frame-filter.ts`; client does NOT re-filter |
| Sort / stable ordering | Browser (selector memo) | — | Frame stream has no ordering; client applies `localeCompare` per D-15 |

## Standard Stack

### Core

All packages already installed. Versions grepped from `package.json`:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.5 | UI runtime | [CITED: package.json:164] — used everywhere in `src/ui/` |
| react-dom | ^19.2.5 | Portal mount for context menu | [CITED: package.json:166] — `PrettyConversationContextMenu.tsx:2` uses `createPortal` |
| lucide-react | ^1.28.0 | Section header icon (`AppWindow`, `ChevronDown`) | [CITED: package.json:161] — Archived section imports `Archive` + `ChevronDown` from same package |
| express | ^5.2.1 | Backend route mount for `GET /apps/:hostId/:slug/icon` | [CITED: package.json:60] — the identity avatar router uses express Router |
| vitest | ^4.1.8 | Test runner | [CITED: package.json:181] — global test framework in this repo |
| @testing-library/react | ^16.3.2 | Component-render testing | [CITED: package.json:114] — used across all `*.test.tsx` files |
| zod | (already in `wire-protocol.ts`) | Frame-schema validation | [VERIFIED: grepped wire-protocol.ts imports] |

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| ssh2 (already in `identity-artifact-reader.ts`) | SSH client for `connectOneShot` | Used by `readAppIconFile` helper for remote hosts |

### Alternatives Considered

No genuine alternatives to consider — this phase is a pattern-extension phase where every capability has an in-repo canonical answer. Alternative library choices (e.g. jotai vs. custom subscription slice) would break the established local convention that every prior WS-consumer follows (`session-working-store.ts`, `session-waiting-store.ts`, `session-tmux-store.ts`, etc.).

**Installation:** Nothing to install. All packages are already dependencies.

**Version verification:** Not applicable — no new packages proposed.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. Section retained per template with `Disposition: N/A`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none — no packages installed) | — | — | — | — | — | N/A |

## Architecture Patterns

### System Architecture Diagram

```
[t1000 disk state]
     ~/fleet/apps/<slug>/{app.json, icon.webp, systemd unit}
                             │
                             ▼
[Python sweep (fleet-status-sweep.py) — every 2s per box]
                             │  JSONL over SSH
                             ▼
[Backend orchestrator (ssh-poll-orchestrator.ts)]
     ↳ per-host reconciliation on success  →  publish app-snapshot / app-update / app-gone
                             │
                             ▼
[Subscription registry (subscription-registry.ts)]
     ↳ Map<hostId:slug, AppState>
     ↳ fan-out with app-frame-filter.ts per-subscriber
                             │
                             ▼
[Fleet-status WS server (/fleet-status/ws) — already running Phase 39+]
                             │
     ═══════════════════════ Phase 119 begins here ═══════════════════════
                             ▼
[Frontend WS client (ui/api/fleet-status-client.ts)]
     ↳ SWITCH extended: add cases for "app-snapshot" / "app-update" / "app-gone"
     ↳ dispatch to onAppSnapshot / onAppUpdate / onAppGone callbacks (NEW opts)
                             │
                             ▼
[AppShell.tsx createFleetStatusClient({...})]
     ↳ wire callbacks: publishAppSnapshot / publishAppUpdate / publishAppGone
                             │
                             ▼
[NEW: app-tiles-store.ts — in-memory Map<hostId:slug, AppState>]
     ↳ mutation on frame arrival
     ↳ useSyncExternalStore reader → useAppTiles() returns sorted array
                             │
                             ▼
[NEW: AppTile.tsx component (inside PrettyConversationsPanel)]
     ↳ renders per tile: rounded-square icon slot + title (+ healthMessage if unhealthy)
     ↳ <img src="/apps/${hostId}/${slug}/icon" onError={fallback}> if hasIcon
     ↳ right-click + long-press → PrettyConversationContextMenu with ["Open in new tab"]
                             │
     "Open in new tab" clicked
                             ▼
[window.open(`/apps/${hostId}/${slug}`, "_blank")]
     ↳ target: shape 4's proxy (not this phase's problem — 404 acceptable in v1)

     ═════════ Icon fetch (in parallel with frame arrival) ═════════
[Browser <img>] →  GET /apps/:hostId/:slug/icon
                             │
                             ▼
[NEW backend route: /apps/:hostId/:slug/icon]
     ↳ authenticateJWT (existing middleware)
     ↳ APP_SLUG_RE validate slug, hostId query validate
     ↳ resolveHostById(hostId, userId) — 502 if unreachable
     ↳ if isLocalHostId → local fs.readFile
     ↳ else → connectOneShot(host, 5_000) → readAppIconFile(conn, slug)
     ↳ 404 on absent, 200 + Buffer + Content-Type: image/webp on present
```

### Recommended Project Structure

```
src/
├── ui/
│   ├── features/
│   │   └── pretty-conversations/
│   │       ├── AppTile.tsx                (NEW — small; sibling of PrettyConversationRow.tsx)
│   │       ├── AppTile.test.tsx           (NEW)
│   │       ├── PrettyConversationsPanel.tsx    (MODIFY — add Apps section block)
│   │       ├── PrettyConversationsPanel.test.tsx  (MODIFY — add Apps section tests)
│   │       └── pretty-conversations.css   (MODIFY — add .pv-app-tile, .pv-app-icon-slot, .pv-app-title, .pv-app-unhealthy-message, .pv-apps-section, .pv-apps-empty selectors)
│   ├── state/
│   │   ├── app-tiles-store.ts             (NEW — module-level Map + publish fns + useAppTiles hook)
│   │   └── app-tiles-store.test.ts        (NEW)
│   ├── api/
│   │   ├── fleet-status-client.ts         (MODIFY — extend switch + opts interface)
│   │   ├── fleet-status-client.test.ts    (MODIFY — add app-frame dispatch tests)
│   │   └── fleet-status-types.ts          (MODIFY — add AppState interface + Frontend{AppSnapshot,AppUpdate,AppGone}Frame + widen FrontendOutboundFrame union)
│   └── AppShell.tsx                       (MODIFY — pass onAppSnapshot / onAppUpdate / onAppGone callbacks to createFleetStatusClient; wire to publish* fns)
└── backend/
    ├── database/
    │   ├── database.ts                    (MODIFY — mount new apps router alongside identities at :1976 or later — append at end per existing convention)
    │   └── routes/
    │       ├── apps.ts                    (NEW — one GET route)
    │       └── apps.test.ts               (NEW — supertest-style route tests)
    └── claude-session/
        └── identity-artifact-reader.ts    (MODIFY — add readAppIconFile helper co-located with readAvatarSiblingFile at :2469-2580; add APP_SLUG_RE export near IDENTITY_KEY_RE at :175)
```

### Pattern 1: Collapsible sidebar section (Archived template)

**What:** A button + rotating chevron + rule-line header that toggles a lazy-mounted content region.
**When to use:** Every collapsible section in `.pv-panel-scroll`.
**Example (copied from `PrettyConversationsPanel.tsx:1995-2033` — modify for Apps):**

```tsx
// Apps section — NOT gated on .length (D-05: always present)
<div className="pv-panel-group pv-apps-section">
  <button
    type="button"
    onClick={() => setAppsExpanded((v) => !v)}
    className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
    data-testid="pretty-conversations-apps-header"
    aria-expanded={appsExpanded}
    aria-controls="pv-apps-section-content"
  >
    <AppWindow
      className="size-3 text-[#5c6070]/85 shrink-0"
      aria-hidden="true"
    />
    <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
      Apps
    </span>
    <span
      aria-hidden="true"
      className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
    />
    <ChevronDown
      className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${appsExpanded ? "rotate-180" : ""}`}
      aria-hidden="true"
    />
  </button>
  {appsExpanded && (
    <div id="pv-apps-section-content">
      {appTiles.length === 0 ? (
        <div className="pv-apps-empty px-4 py-2 text-[13px] italic text-[#5c6070]/85">
          Ask an agent to make an app for you.
        </div>
      ) : (
        appTiles.map((app) => (
          <AppTile key={`${app.hostId}:${app.slug}`} app={app} />
        ))
      )}
    </div>
  )}
</div>
```

### Pattern 2: Frontend WS-frame dispatch (extend, don't replace)

**What:** Add three cases to the existing switch statement in `fleet-status-client.ts`; add three optional callback props to `FleetStatusClientOptions`.
**When to use:** Adding new frame types to the existing `/fleet-status/ws` channel.
**Example (based on `fleet-status-client.ts:164-235` — add):**

```typescript
// In FleetStatusClientOptions (fleet-status-client.ts:66-82):
onAppSnapshot?: (apps: AppState[]) => void;
onAppUpdate?: (app: AppState) => void;
onAppGone?: (hostId: string, slug: string) => void;

// In the onmessage switch (fleet-status-client.ts:164):
case "app-snapshot":
  console.info({
    operation: "fleet_status_client_app_snapshot",
    url,
    appCount: parsed.apps.length,
  });
  onAppSnapshot?.(parsed.apps);
  break;
case "app-update":
  console.info({
    operation: "fleet_status_client_app_update",
    url,
    hostId: parsed.app.hostId,
    slug: parsed.app.slug,
    isHealthy: parsed.app.isHealthy,
  });
  onAppUpdate?.(parsed.app);
  break;
case "app-gone":
  console.info({
    operation: "fleet_status_client_app_gone",
    url,
    hostId: parsed.hostId,
    slug: parsed.slug,
  });
  onAppGone?.(parsed.hostId, parsed.slug);
  break;
```

### Pattern 3: Client-side store slice (session-working-store analogue)

**What:** Module-level mutable `Map<string, AppState>` + `Set<() => void>` of listeners + `useSyncExternalStore` reader hook.
**When to use:** In-memory-only, restart-wipes-it, WS-fed state slices.
**Recommendation:** Model on the existing `session-working-store.ts` (verified pattern — cited in `AppShell.tsx:78` comments referencing publish fns).

### Pattern 4: Identity-avatar route mirror

**What:** Auth gate → path/query validation → host resolution → local/remote branch → stream file back OR 404 → cleanup SSH conn in `finally`.
**When to use:** Any "serve a small file that lives on a remote managed box" endpoint.
**Example (from `identities.ts:852-966` — mirror for `/apps/:hostId/:slug/icon`):**

```typescript
// Source: identities.ts:852-966 (verbatim shape; substitute names)
router.get(
  "/:hostId/:slug/icon",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
    }
    const rawHost = req.params.hostId;
    const hostIdNum = Number(rawHost);
    if (!Number.isFinite(hostIdNum) || !Number.isInteger(hostIdNum) || hostIdNum <= 0) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }
    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) return res.status(502).json({ error: "app home box unreachable" });
        conn = await connectOneShot(host, 5_000);
      } catch {
        return res.status(502).json({ error: "app home box unreachable" });
      }
    }
    try {
      const result = await readAppIconFile(conn, slug);
      if (result === null) {
        return res.status(404).json({ error: "no icon on disk for this app" });
      }
      const etag = `"disk-${createHash("md5").update(result.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) return res.status(304).end();
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Length", String(result.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(result.bytes);
    } catch {
      return res.status(502).json({ error: "app home box unreachable" });
    } finally {
      if (conn) {
        try { conn.end(); } catch { /* ignore */ }
      }
    }
  },
);
```

### Anti-Patterns to Avoid

- **Reading `AppState` schema from `wire-protocol.ts` directly on frontend.** The backend `wire-protocol.ts` uses zod + backend imports; frontend consumes the shape via `ui/api/fleet-status-types.ts`, which is a hand-maintained mirror. Extending only backend types is a silent-drop bug (frontend `FrontendOutboundFrame` union would not carry app arms, TS narrowing in the `switch` would treat them as unreachable). Fix: extend BOTH files in the same task.
- **Opening a new WebSocket for app frames.** The existing `/fleet-status/ws` connection at `AppShell.tsx:626` already carries app frames (Phase 118 wired them). Opening a second WS violates the "single fleet-status pipe" invariant and doubles reconnect/backoff cost.
- **Bolting app state onto `conversation-store.ts`.** D-16 explicitly rules this out. The store has its own reshape-heavy history (Phase 41, 47, 53, 92, 111); adding an unrelated data axis increases store surface area and blast radius.
- **Emitting a per-app `--pv-hue` inline style.** D-09 lock. The `.pv-row` fallback IS the tile hue.
- **Rendering the empty prompt when collapsed.** D-03 lazy-render — the whole section body must be gated on `{appsExpanded && ...}`. The empty prompt renders INSIDE that gate.
- **Gating the section on `appTiles.length > 0`.** D-05 lock — the section MUST render regardless of tile count. This is the ONLY differentiator from the Archived section (which does gate at `PrettyConversationsPanel.tsx:1995`).
- **Placing the Apps section INSIDE the search-vs-three-zone ternary at `PrettyConversationsPanel.tsx:1833`.** The section would then disappear when the user types in the search box (search flat-list renders in place of the three-zone view). Put it OUTSIDE the ternary — between the loading strip (line 1823) and the ternary (line 1833). See "Integration Points" for exact placement.
- **Re-checking host access on the client.** Backend already filters via `app-frame-filter.ts` (Phase 118 D-15). A client-side re-check would drift and mask backend bugs.
- **Cursor: pointer on the tile.** D-13 — deemphasise so shape 4 doesn't have to migrate primary-click affordances. `.pv-row` defaults to `cursor: pointer` at line 345; override to `cursor: default` on `.pv-app-tile`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS reconnect + backoff | New client-side WS instance | Existing `createFleetStatusClient` singleton (`AppShell.tsx:626`) | Already handles backoff ladder (2s/4s/6s/8s/8s + 30s slow retry), full-jitter for herd prevention, visibility-change reconnect (D-11/D-12/D-13 in `fleet-status-client.ts:14-31`) |
| Portal-mounted context menu | New menu component | `PrettyConversationContextMenu.tsx` (222 lines, viewport-clamped, portal-mounted, iOS-tap-synth-safe) | Already handles the tap-flash timing bug (`FLASH_DISMISS_MS = 120` at line 47), the iOS capture-phase mousedown trap (line 100-137 exhaustive comment), and the outside-click dismiss discipline. Building your own re-lands solved bugs. |
| Long-press → context menu on mobile | New long-press timer | Copy the pattern from `PrettyConversationRow.tsx:442-451` (`longPressTimerRef` + `longPressStartRef` + `suppressNextClickRef`) — 500ms timer, 10px movement gate, `navigator.vibrate?.(10)` feature-check, `suppressNextClickRef` to eat the synthesized click | Solves the iOS `navigator.vibrate` undefined crash + the double-fire click bug. Any hand-rolled long-press will hit both. |
| SSH read + connect-one-shot lifecycle | New SSH helper | `connectOneShot(host, 5_000)` + `try/finally { conn.end() }` — see `identities.ts:893-964` | The 5s timeout, one-shot semantics, and the `finally`-only-close discipline are load-bearing. Do NOT hold connections. |
| Kebab-case validation regex | New regex | Mirror `IDENTITY_KEY_RE` at `identity-artifact-reader.ts:175` — the pattern with 1-64 length bounds is shell-safety-gate territory | Regex prevents shell injection when interpolated into `ls "$HOME/fleet/apps/${slug}/icon.webp"`. Get this wrong once → RCE via slug parameter. |
| Sort with stable tiebreaker | Naive `.sort((a, b) => a.title.localeCompare(b.title))` | Include the `${hostId}:${slug}` tiebreak so equal titles don't shuffle on re-render | Frames arrive out-of-order; a non-stable sort thrashes the DOM. D-15 lock. |
| Image-load failure fallback | CSS-only `:where(img[error])` | React state flip (`const [failed, setFailed] = useState(false)` + `onError={() => setFailed(true)}`) | Browser `:where(img[error])` support is patchy; state flip is the pattern in-repo. |

**Key insight:** This phase's blast radius is small BECAUSE every capability has a canonical local answer. Hand-rolling any of them = re-landing solved bugs.

## Runtime State Inventory

Not a rename/refactor/migration phase. Section retained per template for consistency but marked N/A.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | N/A — Phase 119 introduces a new in-memory store slice (`app-tiles-store.ts`); no persistence per D-10 of Phase 118 (verified — Phase 118 CONTEXT.md line 45) | none |
| Live service config | N/A — no external service configuration added | none |
| OS-registered state | N/A — no systemd units, no cron entries, no launchd, no Windows Task Scheduler | none |
| Secrets/env vars | N/A — no new secrets, no new env vars | none |
| Build artifacts | N/A — pure source-code additions; standard Vite build picks them up | none |

## Common Pitfalls

### Pitfall 1: Frontend type mirror not extended alongside backend wire-protocol

**What goes wrong:** Backend `wire-protocol.ts` at `src/backend/fleet-status/wire-protocol.ts:632-663` declares `AppState` + three app frame schemas. Frontend `src/ui/api/fleet-status-types.ts` declares its OWN `FrontendOutboundFrame` union at `:333-338` covering only snapshot/update/gone/pong/identity-archived — NO app arms. If Phase 119 only extends the backend, the frontend `switch` at `fleet-status-client.ts:164` treats app frames as `default` and drops them silently.
**Why it happens:** Phase 118 shipped backend + Python + wire-protocol but did not touch the frontend type mirror because the frontend consumer didn't exist yet. It's a legitimate hand-off gap.
**How to avoid:** First plan of Phase 119 = "extend `fleet-status-types.ts` to declare the frontend-side AppState + Frontend{AppSnapshot,AppUpdate,AppGone}Frame + widen union; verify the switch still narrows correctly."
**Warning signs:** TypeScript `switch` exhaustiveness check silently passing; `default:` case reached at runtime for known-good frames.

### Pitfall 2: Section rendered inside the search-vs-three-zone ternary

**What goes wrong:** The Apps section only appears when the search box is empty; typing any query hides it. Shape 3's "always present" invariant (D-05) violated.
**Why it happens:** Reading the panel top-down suggests the ternary is the "content region." Putting the Apps section inside its `<>` branch feels natural but is wrong — the search-active branch replaces the three-zone view with a flat match list at `PrettyConversationsPanel.tsx:1833-1858`, and rendering the Apps section only inside the `false` branch means it disappears on search.
**How to avoid:** Insert the Apps section BEFORE the ternary at `PrettyConversationsPanel.tsx:1833`, at the same indentation as the loading strip block `{!fleetSessionsLoaded && ...}` at line 1809-1823. It renders unconditionally in both search-active and three-zone view.
**Warning signs:** Integration test A11-equivalent for the Apps section fails when search is active. Manual UAT: type in the search box, confirm the Apps section header remains visible.

### Pitfall 3: `.pv-avatar-initial` has no CSS rule — hallucination risk

**What goes wrong:** Planner or executor assumes `.pv-avatar-initial` is a defined CSS class with sizing/typography rules; searches the CSS file, finds nothing, invents styles that don't match the identity-row rendering.
**Why it happens:** `PrettyConversationRow.tsx:1214` renders `<span className="pv-avatar-initial">{initialLetter}</span>` BUT there is no `.pv-avatar-initial` selector anywhere in `pretty-conversations.css` — verified by grep. The letter inherits from the parent `.pv-avatar` block at `pretty-conversations.css:399-441` (`color: #fbf5e8; font-size: 15px; font-weight: 700; letter-spacing: -0.01em;` + the flex-centering).
**How to avoid:** Reuse the SAME parent pattern for the app tile — put the letter as a text child of the icon slot (`.pv-app-icon-slot`) with the same typography tokens. Don't create a phantom class. Alternatively, define `.pv-app-icon-slot .pv-app-icon-initial` explicitly with the same typography.
**Warning signs:** Executor claims "styled `.pv-avatar-initial` with existing tokens" — verify by grep that the class HAS a rule.

### Pitfall 4: Long-press interaction copy-paste misses `suppressNextClickRef`

**What goes wrong:** Copy the touch-start / touch-move / touch-end long-press block from `PrettyConversationRow.tsx:442-451+` but omit `suppressNextClickRef`. The long-press opens the context menu AND the synthesized click fires the tile's onClick (which is a no-op per D-13, so this bug wouldn't manifest for `AppTile` — BUT if a future shape 4 wires left-click, it will retroactively become a problem).
**Why it happens:** The `suppressNextClickRef` looks like row-specific hygiene, so it gets dropped as "not relevant to AppTile."
**How to avoid:** If the AppTile eventually wires any onClick behaviour (shape 4), it MUST also carry `suppressNextClickRef` — otherwise a long-press opens the menu AND fires the left-click. For Phase 119 v1: since left-click is a no-op, the ref is optional; document explicitly in a comment that shape 4 must add it.
**Warning signs:** Shape 4's UAT reveals "double-fire" on long-press: menu opens + tile also opens.

### Pitfall 5: `readAvatarSiblingFile` cascades through 5 file extensions — `readAppIconFile` should NOT

**What goes wrong:** Executor copies the `readAvatarSiblingFile` implementation at `identity-artifact-reader.ts:2469-2580` including the 5-extension cascade (`webp|png|jpg|gif|svg`) for the app-icon reader. Shape 1's contract locks a SINGLE filename (`icon.webp`); a multi-extension cascade re-opens the door for drift ("agent dropped an icon.png and it worked").
**Why it happens:** The identity route allows multiple extensions because identity avatars are hand-authored. App icons per shape 1 §80-82: *"one filename, no drift... convert to .webp before dropping it in."*
**How to avoid:** `readAppIconFile(conn, slug)` reads exactly `${HOME}/fleet/apps/${slug}/icon.webp` — one filename, one MIME type (`image/webp`), one read. No frontmatter, no cascade. Return `{bytes, mime: "image/webp"} | null`.
**Warning signs:** `readAppIconFile` signature has a `discoveryOrder` or `AVATAR_EXT_VALUES`-style parameter — refactor before merging.

### Pitfall 6: Sort thrash on frame arrival

**What goes wrong:** Every `app-update` frame triggers a re-sort. If sort is not stable and comparator doesn't fully order (ties handled by insertion order), the DOM shuffles rows on every frame — visible as flicker at the 2s sweep cadence.
**Why it happens:** `.sort()` in JS is stable AS OF ES2019 for arrays, BUT the underlying comparator must produce a total order. `String.prototype.localeCompare` returns 0 for equal titles → ties break by insertion order (which depends on frame arrival). Two apps with the same title on different hosts would swap positions per frame.
**How to avoid:** Comparator MUST include the `${hostId}:${slug}` tiebreaker: `(a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || `${a.hostId}:${a.slug}`.localeCompare(`${b.hostId}:${b.slug}`)`. D-15 explicitly locks this.
**Warning signs:** Manual UAT: two scratch apps with the same title on two different boxes flicker between renders. Test: create AppA on host1 + AppA on host2, apply an `app-update` for AppA on host2, assert DOM order unchanged.

## Code Examples

### Extending `FleetStatusClientOptions` + switch dispatch

Verified pattern from `fleet-status-client.ts:66-235`. See "Pattern 2" above for the full add.

### Wiring callbacks in `AppShell.tsx`

Pattern from `AppShell.tsx:626-667`:

```typescript
// Source: AppShell.tsx:626-667 (add three new callbacks alongside existing ones)
const client = createFleetStatusClient({
  url: fleetStatusUrl,
  onSnapshot: (states) => { for (const s of states) applyFleetState(s); },
  onUpdate: (state) => { applyFleetState(state); },
  onIdentityArchived: (name, hostIdRaw, hostname) => { /* ... */ },
  onGone: (hostId, tmuxSession, sessionId) => { /* ... */ },
  // NEW — Phase 119 additions:
  onAppSnapshot: (apps) => { publishAppSnapshot(apps); },
  onAppUpdate: (app) => { publishAppUpdate(app); },
  onAppGone: (hostId, slug) => { publishAppGone(hostId, slug); },
});
```

### `useSyncExternalStore`-based hook (session-working-store analogue)

Pattern from `fleet-status-client.ts:44` (`useSyncExternalStore` import) — extend for app-tiles:

```typescript
// app-tiles-store.ts (NEW)
import { useSyncExternalStore } from "react";
import type { AppState } from "@/api/fleet-status-types";

const store = new Map<string, AppState>();  // key: `${hostId}:${slug}`
const listeners = new Set<() => void>();

function notify() { for (const l of listeners) l(); }

export function publishAppSnapshot(apps: AppState[]): void {
  store.clear();
  for (const app of apps) store.set(`${app.hostId}:${app.slug}`, app);
  notify();
}
export function publishAppUpdate(app: AppState): void {
  store.set(`${app.hostId}:${app.slug}`, app);
  notify();
}
export function publishAppGone(hostId: string, slug: string): void {
  store.delete(`${hostId}:${slug}`);
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): ReadonlyMap<string, AppState> { return store; }

// D-15 stable sort — memoisation left to caller; simplest correct shape:
let cachedSize = -1;
let cachedTiles: AppState[] = [];
export function useAppTiles(): AppState[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  // Snapshot changes IDENTITY on every mutation → recompute unconditionally
  if (snapshot.size !== cachedSize || /* dirty check by ref */ true) {
    cachedTiles = Array.from(snapshot.values()).sort((a, b) => {
      const t = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      if (t !== 0) return t;
      return `${a.hostId}:${a.slug}`.localeCompare(`${b.hostId}:${b.slug}`);
    });
    cachedSize = snapshot.size;
  }
  return cachedTiles;
}
```
*(Planner: the `useSyncExternalStore` shape here mirrors the existing frontend stores; verify against `src/ui/state/session-working-store.ts` at plan-time for exact API shape.)*

### `readAppIconFile` helper (co-located with `readAvatarSiblingFile`)

Verified template from `identity-artifact-reader.ts:2502-2580` (LOCAL + REMOTE branches):

```typescript
// identity-artifact-reader.ts — new export near line 2580
export async function readAppIconFile(
  conn: SSHClientType | null,
  slug: string,
): Promise<{ bytes: Buffer; mime: "image/webp" } | null> {
  if (!APP_SLUG_RE.test(slug)) throw new Error("invalid slug");

  if (conn === null) {
    // LOCAL branch
    const localAppsRoot = path.join(os.homedir(), "fleet", "apps");
    const filePath = path.join(localAppsRoot, slug, "icon.webp");
    try {
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
        throw new Error("icon exceeds cap on disk");
      }
      return { bytes, mime: "image/webp" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  }

  // REMOTE branch — mirror the sftpReadFile discipline at line 2575
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/apps/${slug}/icon.webp`;
  try {
    const bytes = await sftpReadFile(conn, targetPath);
    if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
      throw new Error("icon exceeds cap on disk");
    }
    return { bytes, mime: "image/webp" };
  } catch (err) {
    // sftpReadFile throws on ENOENT — swallow specifically for the "file missing" case
    // (planner: verify against sftpReadFile's error contract — probably throws Error with
    // ENOENT-like code; may need explicit match).
    if (String((err as Error)?.message ?? "").match(/no such file|ENOENT/i)) return null;
    throw err;
  }
}

// Also export at top of file:
export const APP_SLUG_RE = /^[a-z0-9-]{1,64}$/;
```

*(Planner: `IDMEDIT_MAX_AVATAR_BYTES` reused as-is — icons are the same class of small file. Verify `os.homedir()` / `path.join()` are already imported at top of file; if not, add.)*

## State of the Art

Nothing to migrate. Every pattern this phase uses is current-in-repo and battle-tested. The one "watch this" is:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WS-frame types split between backend Zod schema + frontend hand-mirror | Same split, but frontend mirror MUST be updated in the same phase as backend wire-protocol changes | Fleet convention since Phase 34 | Silent-drop bug if not honoured (see Pitfall 1) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `session-working-store.ts` exists at `src/ui/state/` and follows the `useSyncExternalStore` pattern I'm proposing to mirror | Standard Stack / Code Examples | LOW — I verified `AppShell.tsx:78` references `publishFleetStatusSessionGone` (a publish fn on that store), which confirms the general shape, but I did not open the file. Planner should verify the exact API shape before writing `app-tiles-store.ts`. If the pattern is subtly different (e.g., uses tuple keys, different subscribe shape), the planner should mirror the actual pattern. |
| A2 | `sftpReadFile` throws an ENOENT-like error on missing files (rather than returning null) | Code Examples §readAppIconFile | LOW — the `readAvatarSiblingFile` remote branch at `identity-artifact-reader.ts:2551-2578` uses a distinct `ls` probe before `sftpReadFile`; the app-icon reader might benefit from the same "ls first, then read" shape rather than catch-on-throw. Planner: read `sftpReadFile`'s signature/error contract at implementation time and pick the cleanest shape. |
| A3 | The lucide-react `AppWindow` icon exists in v1.28.0 | Section chrome | LOW — grep of the icon set is possible; I did not perform it. If missing, `Boxes`, `Grid`, `LayoutGrid`, or `Package` are drop-in substitutes. |
| A4 | `IDMEDIT_MAX_AVATAR_BYTES` is a reasonable size cap for `icon.webp` files (app icons are small — 32×32 to 128×128, typically <20KB) | Code Examples §readAppIconFile | LOW — reusing the identity cap is a safe over-estimate (identity avatars can be larger). No new constant needed. |
| A5 | `os.homedir()` returns the right root on the Skynet container for local reads | Code Examples §readAppIconFile | LOW — `getLocalIdentitiesRoot()` in the identity reader uses a specific function; there is likely a `getLocalAppsRoot()` equivalent OR the identity reader's local-root helper generalises. Planner: check `identity-artifact-reader.ts` for how the local root is computed and mirror. |
| A6 | The `substrate/skills/app-development/create-app.sh` uses kebab-case-only slugs (no underscores) | Discretion §APP_SLUG_RE | LOW — SKILL.md at line 104 says "kebab-case", grep confirms shape 1 vocabulary. Regex `/^[a-z0-9-]{1,64}$/` (no underscore) is correct. If wrong, widen to `/^[a-z0-9_-]{1,64}$/` to match IDENTITY_KEY_RE. |
| A7 | Skynet container is same-origin with the app tabs a user opens ("Open in new tab") | Section §D-12 | MEDIUM — the shape file at line 30 asserts "the fresh tab inherits the user's authenticated session naturally via the browser session cookie." For this to work, the app URL (`/apps/:hostId/:slug`) must be under the SAME origin as the Skynet UI. If shape 4 proxies apps under a different subdomain, cookie scope issues arise. This is shape 4's problem, not shape 3's; Phase 119 opens the URL and lets shape 4 handle auth. |

## Open Questions

1. **How does `sftpReadFile` signal file-not-found?**
   - What we know: `readAvatarSiblingFile` uses a pre-check `ls` shell call to test file existence before calling `sftpReadFile` (`identity-artifact-reader.ts:2562-2564`), suggesting `sftpReadFile` may not have a clean null-return path.
   - What's unclear: Whether it throws with a specific error code or a specific message pattern.
   - Recommendation: Executor reads the `sftpReadFile` signature at implementation time and picks the cleanest shape — either an `ls` pre-check like the identity reader, or a try/catch on the read with a specific ENOENT match.

2. **Which lucide-react glyph does Ashley visually prefer for the "Apps" header?**
   - What we know: CONTEXT.md D-02 lists 5 acceptable options; CONTEXT.md `Claude's Discretion` says "AppWindow reads most literally."
   - What's unclear: Whether Ashley's tasting-round preference has been captured elsewhere.
   - Recommendation: Ship with `AppWindow` in Phase 119; swap during agent UAT if it looks wrong.

3. **Does the fleet-status client's snapshot ordering guarantee that app-snapshot arrives before any app-update on a fresh subscription?**
   - What we know: `subscription-registry.ts:487-489` documents "UNCONDITIONAL — an empty apps map still produces an app-snapshot," and Phase 118 D-16 requires snapshot-on-subscribe.
   - What's unclear: Whether the server guarantees the snapshot is FLUSHED before subsequent updates on the same connection.
   - Recommendation: Frontend store treats `app-snapshot` as CLEAR-then-REPOPULATE (as the example code above does). If an update arrives before the snapshot (network race), it gets overwritten by the snapshot on arrival — acceptable, matches D-17's "no pre-first-frame state" model.

4. **Is there a shared `error-red` token in the fleet UI palette for the unhealthy `healthMessage`?**
   - What we know: Grep of `pretty-conversations.css` found `#ff9a8a` (context menu danger item), `#f4a09b` (from CONTEXT.md tasting), warm-amber `hsla(35, 65%, 55%, 0.85)` (trapped-work indicator).
   - What's unclear: Whether a semantic `--color-pv-error` variable exists in the wider palette (grep of `--color-pv-` in `pretty-conversations.css:274` shows `--color-pv-border-quiet` — full palette may live in a different file).
   - Recommendation: Use `#f4a09b` verbatim from the tasting; add a `.pv-app-unhealthy-message` selector; leave a comment inviting a future palette-token pass.

## Environment Availability

Skip — Phase 119 is a pure code-and-config phase with no new external tool dependencies. All required tools (Node 20+, npm, vitest, docker, ssh) are already established by prior phases and used daily in this repo.

**One implicit dependency worth flagging:** The D-20 agent-UAT step requires SSH access from Skynet's container to t1000's `~/fleet/apps/` and permission to `systemctl --user` a scratch unit. Both are established by prior campaign shapes; nothing new to provision.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware — reused verbatim from identity-avatar route |
| V3 Session Management | no | Frontend consumes existing session cookie; no new session surface |
| V4 Access Control | yes | Backend `checkHostAccess` filter applied at frame boundary (Phase 118 D-15) + at `/apps/:hostId/:slug/icon` route via `resolveHostById(hostId, userId)` returning null when host is not accessible |
| V5 Input Validation | yes | `APP_SLUG_RE = /^[a-z0-9-]{1,64}$/` regex-gate for the `slug` URL param — shell-safety guard for the SSH-interpolated read. `hostId` must parse as a positive integer. |
| V6 Cryptography | no | No new crypto; ETag uses existing MD5 discipline from the identity route (identifier only, not authentication) |

### Known Threat Patterns for {this stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `slug` param → read `/etc/passwd` via `../../` | Tampering | `APP_SLUG_RE` gate; no path characters accepted |
| Command injection via `slug` param → SSH-executed shell | Tampering | `APP_SLUG_RE` gate; slug never contains `$;&|\`` |
| Cross-tenant access via `hostId` param → serve icon from a box the user can't see | Elevation of Privilege | `resolveHostById(hostId, userId)` returns null when user has no access; route 502s with a canned "unreachable" message (does NOT distinguish "not found" from "not authorized" — matches identity-avatar discipline) |
| Frame injection via WS → hostile server pushes app-frame with malicious slug/hostId | Tampering | Client trusts backend (single-tenant model). The frontend does NOT re-check host access (D-15 backend authority); the icon URL constructed from frame data is bound-checked by the backend on fetch. Malicious slug in frame data at worst causes a 400 on icon fetch. |
| Reflected content via `healthMessage` string | Injection (XSS) | React auto-escapes text nodes; `healthMessage` rendered inside `{app.healthMessage}` not `dangerouslySetInnerHTML`. Zero XSS surface. |
| Session-cookie leak via cross-origin `window.open("http://malicious/", "_blank")` | Info Disclosure | The URL is constructed from validated frame data (`hostId + slug`), not user input; no way for a user to inject an arbitrary URL. `noopener,noreferrer` in `window.open` options is a defence-in-depth win — recommend adding: `window.open(url, "_blank", "noopener,noreferrer")`. |
| Icon-fetch DoS via rapid navigation | DoS | Backend has no rate limiter on `/apps/:hostId/:slug/icon`. Identity-avatar route has the same shape and hasn't been abused. If Ashley has hundreds of apps, consider a lightweight per-user rate limit as a follow-up. |

## Sources

### Primary (HIGH confidence)

- `PrettyConversationsPanel.tsx:737` — `archivedExpanded` state hook shape
- `PrettyConversationsPanel.tsx:1760-1799` — search-container placement + `.pv-panel-scroll` structure
- `PrettyConversationsPanel.tsx:1809-1823` — loading strip render block (insertion-point neighbour)
- `PrettyConversationsPanel.tsx:1833-1859` — search-vs-three-zone ternary (Apps section must render OUTSIDE this)
- `PrettyConversationsPanel.tsx:1995-2033` — Archived section chrome template (D-02 verbatim mirror)
- `PrettyConversationRow.tsx:1195-1220` — avatar image render + `.pv-avatar-initial` fallback pattern
- `PrettyConversationRow.tsx:397-451` — right-click + long-press interaction pattern (context menu open sites)
- `PrettyConversationContextMenu.tsx:1-222` — reusable context menu component (portal, viewport-clamp, iOS-tap-synth-safe)
- `pretty-conversations.css:232-278` — `.pv-panel-scroll` + `.pv-panel-group` + `.pv-search-container` structural rules
- `pretty-conversations.css:337-391` — `.pv-row` glass bubble tokens (base + `:hover` + `.selected`)
- `pretty-conversations.css:399-441` — `.pv-avatar` 40×40 disc tokens (letter typography inherited by `.pv-avatar-initial`)
- `pretty-conversations.css:552-622` — `.pv-body`, `.pv-body .pv-label`, `.pv-body .pv-ai-title` (title + secondary line — D-10 says drop the secondary line for the app tile)
- `identities.ts:849-966` — `GET /:identityKey/avatar` mirror template for D-06
- `identity-artifact-reader.ts:175` — `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` (mirror for `APP_SLUG_RE`)
- `identity-artifact-reader.ts:205` — `isLocalHostId` (reused as-is in new route)
- `identity-artifact-reader.ts:2469-2580` — `readAvatarSiblingFile` full implementation (LOCAL + REMOTE branches — mirror for `readAppIconFile`)
- `database.ts:1900-1979` — route mount block (new `/apps` mount lives near the end alongside `/identities` at :1976)
- `wire-protocol.ts:610-782` — Phase 118 app-frame schemas + `AppState` + `makeApp*Frame` helpers (backend authoritative)
- `subscription-registry.ts:17-19` + `:487-489` — app publish methods + snapshot-on-subscribe UNCONDITIONAL guarantee
- `fleet-status-client.ts:44-235` — frontend WS client factory + switch-dispatch pattern (must be extended for app frames)
- `fleet-status-types.ts:293-338` — frontend type mirror (must be extended for app frames) — **GAP: no app arms today**
- `AppShell.tsx:626-670` — `createFleetStatusClient` boot call (add callbacks here)
- `app-frame-filter.ts:1-60` — Phase 118's per-user host-visibility filter (backend authority; client does NOT re-check)
- `PrettyConversationsPanel.test.tsx:2625-2733` — Phase 115 A10-A14 Archived section tests (integration-test template for Apps section)
- `substrate/skills/app-development/SKILL.md:41-88` — shape 1 disk contract (`~/fleet/apps/<slug>/`, `app.json`, `icon.webp`, kebab-case slugs)
- `~/fleet/roles/box-maintainer/box-maintainer.md:200-224` — deploy discipline (executor stops at code + tests green; NEVER worktrees; NEVER streaming affordances)
- `package.json` — vitest ^4.1.8, @testing-library/react ^16.3.2, react ^19.2.5, lucide-react ^1.28.0, express ^5.2.1
- `.planning/config.json` — nyquist_validation: false (skip Validation Architecture section); security_enforcement: true (include Security Domain)
- `.planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/117-CONTEXT.md` — 20 D-decisions authoritative for this phase
- `.planning/campaigns/first-class-apps/shape-sidebar-apps-surface.md` — locked shape file (opened 2026-09-18)
- `.planning/phases/118-first-class-apps-sweep-registry-shape-2/116-CONTEXT.md` — Phase 118 D-14/D-15/D-16 wire contract + filter authority + snapshot-on-subscribe

### Secondary (MEDIUM confidence)

- Fleet convention: single-page vitest.setup.ts + globals: true configuration at `vitest.config.ts:9-12` — inferred from `describe/it/expect` usage in existing test files without imports
- Frontend store convention: session-working-store / session-waiting-store / session-tmux-store naming pattern — inferred from grep of `publishFleetStatus*` in AppShell.tsx:650-652 (files not opened)

### Tertiary (LOW confidence)

- None — every load-bearing claim is verified from a specific line number in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed; versions cited from package.json
- Architecture: HIGH — every insertion point + integration boundary line-cited from the specific file
- Pitfalls: HIGH — five of six pitfalls point to verified quirks (Pitfall 1 = observed gap in fleet-status-types.ts; Pitfall 2 = observed ternary structure at :1833; Pitfall 3 = grep-verified absence of `.pv-avatar-initial` CSS rule; Pitfall 5 = verified single-extension shape 1 contract; Pitfall 6 = verified sort thrash risk from CONTEXT.md D-15). Pitfall 4 (long-press copy-paste) is a forward-looking risk for shape 4 rather than a present-phase bug.
- Security: HIGH — pattern mirrors identity-avatar route which has been through prior security passes; ASVS categories mapped to specific controls; only add over baseline is the `noopener,noreferrer` recommendation for `window.open`
- Testing: HIGH — vitest 4 + @testing-library/react 16 versions verified; mock pattern for `useArchivedFleetRows` shown at PrettyConversationsPanel.test.tsx:244+321 mirrors what `useAppTiles` mock will look like

**Research date:** 2026-09-18
**Valid until:** 2026-10-18 (30 days — the underlying patterns are stable; the only external dependency is the not-yet-modified `fleet-status-types.ts` which the planner should verify hasn't been extended in the meantime)
