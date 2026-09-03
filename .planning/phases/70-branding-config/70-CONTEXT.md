# Phase 70: branding-config - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add per-instance configurable branding to Skynet: a host-mounted config file + asset directory that lets a deployment swap its name, icon, wordmark, favicon, and PWA manifest without rebuilding the image. A deployment with no config file on the host behaves identically to today (Skynet defaults). The immediate consumer is Aither Intelligence Plus.

</domain>

<decisions>
## Implementation Decisions

### Config schema
- **D-01:** Config file is JSON at `/etc/skynet/branding.json` (mounted from host `/opt/skynet/branding.json`). Asset directory mounted at `/etc/skynet/branding/` (from host `/opt/skynet/branding/`).
- **D-02:** The logo entry in the config is split into **two separate paths** — `iconPath` (the small icon element, currently the inline SVG) and `wordmarkPath` (the wordmark text image, currently `/skynet-wordmark.png`). This lets the operator supply their own assets without having to reconstruct the existing two-part header layout. The header keeps its current two-element structure; both paths are independently swappable.
- **D-03:** Full config schema:
  ```json
  {
    "appName": "Aither Intelligence Plus",
    "shortName": "AI+",
    "iconPath": "/branding/icon.svg",
    "wordmarkPath": "/branding/wordmark.png",
    "faviconPath": "/branding/favicon.svg",
    "pwaIcons": [
      {"src": "/branding/pwa-icon-192.png", "sizes": "192x192", "type": "image/png"},
      {"src": "/branding/pwa-icon-512.png", "sizes": "512x512", "type": "image/png"}
    ]
  }
  ```
- **D-04:** Bundled defaults ship inside the container image (Skynet assets). Backend falls back to defaults if `/etc/skynet/branding.json` is absent. Per-file fallback: if the config is present but a specific asset file is missing from the branding directory, fall back to the bundled default for that specific file only — not a global failure.

### Backend endpoints
- **D-05:** Three new backend routes, all unauthenticated (branding is pre-login):
  - `GET /api/branding` — returns the parsed config JSON, falling back to bundled defaults if no file present
  - `GET /manifest.webmanifest` — dynamically generated from config; must be registered as a backend route BEFORE Express's static middleware so it intercepts before the static `public/manifest.webmanifest` file is served
  - `GET /branding/*` — serves asset files from the mounted branding directory, with per-file fallback to bundled defaults
- **D-06:** The branding routes live in a new routes module (`src/backend/branding/`) and are mounted in `database.ts` BEFORE the static file middleware block.

### Frontend
- **D-07:** Branding config is fetched once at app boot (before login). Stored in a React context / lightweight store accessible throughout the app.
- **D-08:** Four surfaces wired to the branding context:
  1. **Browser tab title** — `appName` replaces the hardcoded `"SKYNET"` fallback in AppShell (three locations: initial tab label, tab reset on close, `document.title` fallback)
  2. **Favicon** — `faviconPath` replaces the static favicon href in `index.html` (applied imperatively via DOM after config loads)
  3. **Conversation list header** — `iconPath` replaces the `<SkynetLogo>` SVG; `wordmarkPath` replaces the `/skynet-wordmark.png` img src
  4. **Login screen header** — same icon + wordmark as the conversation header (same assets, same `iconPath`/`wordmarkPath`)
- **D-09:** `index.html` gets `<link rel="manifest" href="/manifest.webmanifest">` wired (already present). The `<title>` in `index.html` can stay as "SKYNET" — it's overwritten by the branding fetch before any user sees it (or keep as a neutral placeholder).
- **D-10:** Apple-touch-icon links in `index.html` (5 sizes: 60/76/120/152/180px) are left as Skynet defaults for MVP. The PWA manifest icons (192/512px, served dynamically) are what drives the home screen icon for iPhone PWA installs — the apple-touch-icon links are a legacy mechanism and are not worth the added complexity.

### Docker / deployment
- **D-11:** `Dockerfile` copies bundled default branding assets into `/app/branding-defaults/` in the image.
- **D-12:** `docker-compose.yml` adds two bind-mount entries (both `:ro`): `/opt/skynet/branding.json` → `/etc/skynet/branding.json` and `/opt/skynet/branding/` → `/etc/skynet/branding/`. On t1000 these paths don't exist — the mounts are optional-style (backend checks existence, falls back to defaults). AI+ deployment gets the actual config + assets at provisioning time.
- **D-13:** No rebuild needed for branding changes — only a container restart. This is the whole point of the bind-mount approach.

### Migration / rollout
- **D-14:** Deploy to t1000 with NO config file on host. Backend serves bundled defaults = current Skynet behavior. Zero user-visible change on t1000.
- **D-15:** AI+ deployment: Ivy drops `/opt/skynet/branding.json` + assets into `/opt/skynet/branding/` at EC2 provisioning time.

### Claude's Discretion
- Implementation details of the branding config loader (TypeScript module structure, caching strategy, error handling for malformed JSON)
- Whether the frontend branding context is a Zustand store, React context, or a simple module-level singleton — whichever fits existing patterns in the codebase
- Exact bundled default asset filenames and directory structure inside the image

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Feature design (locked)
- `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-01-branding-config.md` — Full locked design (updated 2026-09-03 to fix spelling + add logo surfaces)
- `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/decisions.md` — Cross-cutting decisions for the full AI+ MVP project
- `.planning/shapes/shape-branding-config.md` — Shape file capturing the agreed philosophy and scope edges

### Key source files to read before planning
- `src/backend/database/database.ts` — Main Express server; static middleware at line ~1896; route registration block at lines ~1807-1879. New branding routes mount BEFORE the static middleware.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — Conversation list header; `SkynetLogo` import at line 135; two-element logo render at lines ~1489-1496.
- `src/ui/features/pretty-conversations/SkynetLogo.tsx` — Inline SVG icon component to be replaced by `<img>` from `iconPath`.
- `src/ui/AppShell.tsx` — Tab title hardcoded `"SKYNET"` at lines 232, 616, 1569.
- `src/ui/auth/LoginPage.tsx` — Login screen; icon+wordmark appear in same pattern as conversation header.
- `index.html` — Root HTML; `<title>SKYNET</title>`, favicon links, manifest link, apple-touch-icon links.
- `public/manifest.webmanifest` — Static manifest to be superseded by the dynamic `/manifest.webmanifest` backend route.
- `src/backend/database/routes/` — Pattern for new route modules (look at any existing route file for the established module shape).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ui/features/pretty-conversations/SkynetLogo.tsx` — Currently an inline SVG; the phase replaces its usage in the header with a configurable `<img src={brandingConfig.iconPath}>`. The SVG file itself can remain for the bundled default (served as a static asset).
- Existing route files in `src/backend/database/routes/` — All follow the same Express Router pattern; branding routes follow the same shape.

### Established Patterns
- Express route registration: import route module → `app.use("/path", routeModule)` in `database.ts`. New branding routes follow this pattern, but MUST be registered before the `express.static(frontendDist, ...)` block (around line 1896).
- Static asset serving with cache headers: the existing static middleware applies `max-age=31536000, immutable` for `assets/` and no-store for `index.html` / `manifest.json`. The new `/branding/*` endpoint should use short-lived or no-cache headers since assets are operator-controlled.
- Backend-served dynamic endpoints that intercept before static: this is the same pattern needed for `/manifest.webmanifest` — register the route before the static middleware, not after.

### Integration Points
- `database.ts` route registration block (~line 1807) + static middleware block (~line 1896): new branding routes go between these two, or before the static block.
- `AppShell.tsx` `document.title` effect and tab initialization: three `"SKYNET"` hardcoded strings to replace with `brandingConfig.appName`.
- `PrettyConversationsPanel.tsx` header render: `<SkynetLogo>` + `<img src="/skynet-wordmark.png">` → `<img src={brandingConfig.iconPath}>` + `<img src={brandingConfig.wordmarkPath}>`.
- `index.html` favicon `<link>` tags: updated via imperative DOM manipulation after branding config loads (React doesn't own `<head>`).

</code_context>

<specifics>
## Specific Ideas

- The conversation header keeps its current two-element structure (small icon + wordmark). The operator supplies both files separately — not a single combined logo. This preserves the existing visual layout without needing to redesign the header.
- t1000 deploy: drop the config file entirely. Backend falls back to bundled defaults. Behavior = identical to today.
- AI+ deploy: Ivy installs `/opt/skynet/branding.json` + branding assets at EC2 provisioning. No Skynet code involvement at provisioning time — it's just files on disk.
- The `common.appName` i18n key ("Skynet" in translation files) is used in some login flows but the actual login screen surfaces Ashley verified are: tab title + icon/wordmark. The i18n key does not need to be touched; the tab title is handled by the AppShell branding context and the logo surfaces are handled by `iconPath`/`wordmarkPath`.

</specifics>

<deferred>
## Deferred Ideas

- Apple-touch-icon swapping (5 sizes in index.html) — not worth MVP complexity; PWA manifest icons are what matters for home screen installs. Revisit if an operator specifically needs these swapped.
- Admin UI for branding config (edit via Skynet UI rather than file-on-disk) — out of scope for MVP.
- Theme color / visual styling swaps — explicitly out of scope (all deployments keep `#0a0b12`).

</deferred>

---

*Phase: 70-branding-config*
*Context gathered: 2026-09-03*
