# Phase 70: branding-config - Research

**Researched:** 2026-09-03
**Domain:** Per-instance branding via host-mounted config; Express routes + Vite frontend + Docker deploy
**Confidence:** HIGH (codebase-verified; nothing depends on training data)

## Summary

Phase 70 replaces hardcoded "SKYNET" branding with an operator-supplied config file so a single container image can deploy under different identities. The design (schema, endpoints, four surfaces) is locked in CONTEXT.md — this research is scoped to the mechanics of *how* to wire it into this codebase without breaking anything.

Two findings materially change what the plan must include beyond CONTEXT.md's file list:

1. **Nginx intercepts `/manifest.webmanifest` and `/api/*` BEFORE the backend ever sees them.** `docker/nginx.conf` L71-78 serves `/manifest.webmanifest` directly from `/app/html` with `try_files $uri =404`. It does not proxy to `http://127.0.0.1:30001`. The Express-static-middleware-ordering discussion in CONTEXT.md D-05 is necessary but NOT sufficient — the nginx `location = /manifest.webmanifest` block must be flipped to a `proxy_pass` (or deleted so it falls through to the generic `location /`). Same for `/api/branding` and `/branding/*`: they need their own `location` blocks proxied to the backend, or nginx will 404 them. This is a documented codebase convention — three prior routes (`/api/usage`, `/skills-editor`, `/relay-pointer`) all carry inline reminders that matching nginx blocks are **load-bearing** (see `src/backend/database/routes/usage.ts` L16-18 and `database.ts` L1858-1859, L1871-1872). Both `docker/nginx.conf` AND `docker/nginx-https.conf` must be updated in parallel.

2. **The "login screen icon" in CONTEXT.md D-08 is `/icon.png`, NOT `<SkynetLogo>` SVG.** `src/ui/auth/Auth.tsx` L1131 renders `<img src="/icon.png">` next to `<img src="/skynet-wordmark.png">`. The conversation header at `PrettyConversationsPanel.tsx` L1489-1497 uses `<SkynetLogo>` (inline SVG component) + `/skynet-wordmark.png`. Different icon assets today. CONTEXT.md D-08 says "same icon+wordmark as the conversation header" — the plan must decide whether to (a) unify both surfaces on `brandingConfig.iconPath` (natural per D-08 language) or (b) preserve the current split (login=`/icon.png`, conv=inline SVG default) with only the config-override path unifying them. Recommendation: (a) — CONTEXT.md's intent is clearly a single icon field, so replacing `<img src="/icon.png">` with `<img src={brandingConfig.iconPath}>` at Auth.tsx L1131 is the cleanest wire. The bundled default for `iconPath` should be a static PNG/SVG under `/branding-defaults/` that reproduces the current SkynetLogo look (or reuses `/icon.png` — see D-11 discretion).

**Primary recommendation:** Use the existing `global-files-config-loader.ts` pattern (module-header comment doc block, `fs.promises`, empty-state fallback, never-throws) as the direct template for the branding-config loader. Use `useSyncExternalStore` for the frontend branding store (matches `session-tmux-store.ts` verbatim — no Zustand in the codebase, no React Context wrapper needed). Mount the three new backend routes in `database.ts` between L1879 (`app.use("/voice", voiceRoutes)`) and L1881 (start of frontend static block) as a single tight cluster. Update BOTH nginx configs. Update the Dockerfile to `COPY` the bundled defaults into `/app/branding-defaults/` alongside the existing `--from=frontend-builder /app/dist /app/html` line.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Branding config file storage | Docker host (bind-mount) | — | Files-on-disk model deliberately keeps this out of DB/git |
| Bundled default assets | Docker image (COPY at build) | — | Ships with Skynet; used when no operator override present |
| Config parse + validation | Backend (Node / Express route) | — | Same pattern as `global-files-config-loader.ts` |
| `/api/branding` endpoint | Backend (Express route module) | Nginx (proxy_pass block) | Nginx routes `/api/*` — precedent: `/api/usage` |
| `/manifest.webmanifest` endpoint | Backend (Express route module) | Nginx (must retire static-serve block) | Nginx currently serves this file statically; must be flipped |
| `/branding/*` asset endpoint | Backend (Express route module) | Nginx (proxy_pass block) | Backend must decide bundle-vs-override per file |
| Frontend branding store | Browser (module singleton + `useSyncExternalStore`) | — | Matches `session-tmux-store.ts` codebase convention |
| Boot-time config fetch | Browser (early in App/main.tsx) | Backend `/api/branding` | Must resolve before AppShell renders header |
| Favicon imperative swap | Browser (DOM `document.querySelector`) | — | React doesn't own `<head>`; no react-helmet installed |
| Tab title reads | Browser (AppShell effect) | Branding store | Three call sites at AppShell.tsx L232, L616, L1569 |

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | 5.2.1 | Route handler for the 3 new endpoints | Already the backend framework |
| `react` | 19.x | Frontend rendering | Already the frontend framework |
| `useSyncExternalStore` (react built-in) | 19.x | Branding store subscription | Verbatim match to `session-tmux-store.ts` codebase pattern |
| `node:fs` (promises) | node 22 built-in | Config file read + asset existence check | Matches `global-files-config-loader.ts` |
| `node:path` | node 22 built-in | Path resolution + traversal defense | Matches `global-files-config-loader.ts` |

### No new dependencies needed
The phase is entirely a wiring exercise on top of the existing stack. Do not add `react-helmet`, `zustand`, or a JSON schema validator — the codebase already has patterns for all three concerns:
- `<head>` imperative updates: `document.title` assignment (`AppShell.tsx` L615), `document.querySelector` for `<link rel="icon">` updates (write inline in a `useEffect`).
- Store: `useSyncExternalStore` per `session-tmux-store.ts`.
- JSON validation: inline `typeof`/`Array.isArray` guards per `global-files-config-loader.ts` L122-137. Zod IS in the backend deps (`zod: ^4.4.3`) if the planner prefers a schema, but the loader-file's inline guard is the more common house style.

## Package Legitimacy Audit

Not applicable — no new package installs in this phase.

## Architecture Patterns

### Data Flow Diagram

```
Docker host                     Container                        Browser
───────────                     ─────────                        ───────
/opt/skynet/branding.json  ──►  /etc/skynet/branding.json  ┐
/opt/skynet/branding/*     ──►  /etc/skynet/branding/*     │
                                                            │
                            (bundled defaults, always present)
                            /app/branding-defaults/*        │
                                                            ▼
                             ┌────────────────────────────────────┐
                             │ Express (port 30001)                │
                             │  branding-routes.ts                 │
                             │  ┌──────────────────────────────┐   │
                             │  │ loadBrandingConfig()         │   │
                             │  │  1. read /etc/skynet/*.json  │   │
                             │  │  2. fallback → bundled defs  │   │
                             │  └──────────────────────────────┘   │
                             │  GET /api/branding                  │
                             │  GET /manifest.webmanifest          │
                             │  GET /branding/*    ─┐              │
                             │                     │              │
                             │              per-file fallback:    │
                             │              /etc/skynet/branding  │
                             │                → /app/branding-def │
                             └────────────────────────────────────┘
                                     ▲
                            nginx (/manifest.webmanifest, /api/branding,
                            /branding/*) — MUST proxy_pass instead of
                            static-serve
                                     │
                                     │ HTTPS/HTTP
                                     ▼
                                                          ┌──────────────────┐
                                                          │ main.tsx / App() │
                                                          │  ↓ boot fetch     │
                                                          │  /api/branding    │
                                                          │  ↓                │
                                                          │ brandingStore     │
                                                          │  (module singleton│
                                                          │   +useSyncExtStore│
                                                          │  ↓                │
                                                          │  ┌─ AppShell     │
                                                          │  │   document.    │
                                                          │  │   title use   │
                                                          │  ├─ PrettyConvs  │
                                                          │  │   header      │
                                                          │  ├─ Auth login   │
                                                          │  │   header      │
                                                          │  └─ favicon      │
                                                          │      DOM swap    │
                                                          └──────────────────┘
```

### Component Responsibilities

| File (new) | Purpose |
|------------|---------|
| `src/backend/branding/branding-config-loader.ts` | Read+parse `/etc/skynet/branding.json`; empty/malformed → bundled defaults. Never throws. Modeled on `global-files-config-loader.ts`. |
| `src/backend/branding/branding-routes.ts` | Express Router with 3 handlers: `GET /api/branding`, `GET /manifest.webmanifest`, `GET /branding/*`. All unauthenticated. |
| `src/backend/branding/asset-resolver.ts` (optional split) | Per-asset fallback: resolve request path to either `/etc/skynet/branding/<file>` (if present) or `/app/branding-defaults/<file>`. |
| `src/ui/branding/branding-store.ts` | Module-singleton with `useSyncExternalStore` — same shape as `src/ui/state/session-tmux-store.ts`. |
| `src/ui/branding/branding-fetch.ts` (or inline in `main.tsx`) | Boot-time fetch of `/api/branding` → `publishBrandingConfig(...)`. |
| `src/ui/branding/apply-favicon.ts` (optional split) | Effect: `document.querySelector('link[rel=icon]')` → set `href` from config. |
| `/branding-defaults/` (image build dir) | Bundled default assets — one PNG/SVG per config key. |

### Pattern 1: Express route module (unauthenticated)
**What:** Follow `usage.ts` (unauth) rather than `global-files.ts` (authed). Mount pattern is `app.use("/api/branding", brandingRoutes)` — single router with the three handlers, or three routers.

**Example (verified live in this codebase):**
```typescript
// Source: src/backend/database/routes/usage.ts L23-45 (verified 2026-09-03)
import express from "express";
const router = express.Router();
router.get("/", async (_req, res) => {
  // handler body
});
export default router;
```

**Mount site (verified):** Between `app.use("/voice", voiceRoutes)` at `database.ts` L1879 and the frontend static block starting at L1881. Insert the three `app.use()` calls BEFORE the `if (frontendDist) { app.use(express.static(...)) }` block or the static middleware will intercept `/manifest.webmanifest` first (though nginx will actually intercept first — see nginx finding above).

### Pattern 2: Frontend store (useSyncExternalStore singleton)
**What:** Module-level `state` variable, `listeners` Set, `publishX()` writer, `subscribe()` + `getSnapshot()` for React binding.

**Example (verified live):**
```typescript
// Source: src/ui/state/session-tmux-store.ts L32-63 (verified 2026-09-03)
import { useSyncExternalStore } from "react";
type State = { map: Map<string, TmuxRecord> };
let state: State = { map: new Map() };
let snapshotVersion = 0;
const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function publishFleetStatusTmuxSession(hostId: string, tmuxSession: string | null): void {
  // ... update state, notify
}
export function useSessionTmuxName(key: string | null): string | null {
  const getSnapshot = (): string | null => { /* ... */ };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

Adapt for branding: single global `BrandingConfig` (not a Map), single `publishBrandingConfig(config)` writer called once at boot, `useBrandingConfig()` hook returning the current config or a bundled-default sentinel while the fetch is in flight.

### Pattern 3: JSON config loader (never-throws, empty fallback)
**Example (verified live):**
```typescript
// Source: src/backend/database/routes/global-files-config-loader.ts L78-140 (verified 2026-09-03)
export async function loadGlobalFilesConfig(dataDir?: string): Promise<GlobalFilesConfig> {
  const configPath = getGlobalFilesConfigPath(dataDir);
  let raw: string;
  try {
    const stat = await fs.stat(configPath);
    if (stat.size > MAX_CONFIG_BYTES) {
      sshLogger.error("...", { operation: "..." });
      return { hosts: {} };
    }
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { hosts: {} };  // missing file is normal
    }
    sshLogger.error("...", { /* ... */ });
    return { hosts: {} };
  }
  // parse + shape-validate; return default on failure
}
```

Adapt for branding: same shape, but the "empty state" fallback should be the bundled-default JSON (read from `/app/branding-defaults/branding.json`), not `{}`. This is the "per-file fallback" from D-04 at the whole-config level: absent config → serve defaults; malformed config → serve defaults + log.

### Anti-Patterns to Avoid
- **DO NOT** install `react-helmet` / `react-helmet-async`. Codebase already has three imperative `document.title` assignments (AppShell.tsx L615, Auth.tsx L778, LoginPage.tsx multiple). Follow that pattern.
- **DO NOT** put branding config in a React Context. There are ZERO React Context providers used for app-scoped state in the codebase — all shared state is `useSyncExternalStore` singletons in `src/ui/state/`. Adding a Context would introduce a wrapper hierarchy for one value.
- **DO NOT** add auth to the branding routes. Pre-login surfaces need it (Auth.tsx login screen icon/wordmark, and the favicon+manifest before any user interaction). Match `usage.ts` unauthenticated pattern.
- **DO NOT** use `res.sendFile(path)` without a base-directory containment check for `/branding/*`. The request path arrives from an untrusted client — `path.resolve(brandingDir, req.params[0])` followed by `startsWith(brandingDir)` prevents directory traversal (`../../etc/passwd`). See threat model note below.
- **DO NOT** rely on Express-static-middleware ordering ALONE for `/manifest.webmanifest` interception. Nginx wins before Express is ever consulted.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PWA manifest generation | Custom string templating | JSON.stringify on a plain object with `res.setHeader("Content-Type", "application/manifest+json")` | The spec is small; JSON.stringify is correct |
| MIME type for assets | Manual switch statement | `express.static(dir, { fallthrough: true })` mounted at `/branding` OR `mime.getType()` from Express's built-in `res.type()` helper | Express handles image/svg/png MIME automatically |
| Path traversal defense | Reinvent | `path.resolve(baseDir, userInput)` + `.startsWith(baseDir + path.sep)` guard | Well-known one-liner; documented in Node.js docs |
| Fallback resolution | Complex retry logic | `fs.access(overridePath).then(...).catch(...)` — if override exists, serve it; else serve bundled default | Two-line pattern; no library needed |

**Key insight:** This phase is I/O plumbing on top of an already-mature Express + React stack. Every capability has an established pattern within this codebase (`usage.ts`, `global-files-config-loader.ts`, `session-tmux-store.ts`) — deviating adds risk without adding value.

## Runtime State Inventory

> This phase adds new state (branding config on disk, in-image defaults) but does not rename or migrate existing state. The relevant question is: what breaks if the config is added or removed at runtime?

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — branding config lives outside git and outside the SQLite DB. `/etc/skynet/branding.json` is bind-mounted read-only from host. | None. |
| Live service config | Nginx serves `/manifest.webmanifest` statically today (L71-78 of `docker/nginx.conf`, L82 of `docker/nginx-https.conf`). These blocks must be flipped to `proxy_pass` OR deleted (so requests fall through to the generic `location /` and hit index.html, which is wrong — deletion alone is NOT sufficient; must add proxy_pass). | Update both nginx configs. |
| OS-registered state | Service worker (`public/sw.js` → served as `/sw.js`) precaches `/favicon.ico`, `/icons/*.png` (L3-9). After rebrand, the cached favicon may persist across page loads until the SW updates (SW has `self.skipWaiting()` + cache-name versioning). | Note in plan: SW cache name (`skynet-static-v2` at L1) may need bump if bundled defaults are also changed. For a t1000 no-config deploy this doesn't matter (defaults are unchanged). For AI+ deploy, first PWA install picks up the new favicon; existing PWA installs need a hard cache clear (documented behavior, acceptable per D-14/D-15). |
| Secrets/env vars | None. Branding config contains only display names and asset paths — no secrets. | None. |
| Build artifacts | `dist/backend/branding/` will be new after build. `/app/branding-defaults/` in the image is a new COPY layer in Dockerfile. Both created fresh on next image build. | None (natural consequence of the change). |

**Nothing found in category:** As above — bind-mount config is the whole point of the design and there is no existing state to migrate.

## Common Pitfalls

### Pitfall 1: Nginx serves manifest.webmanifest before backend sees it
**What goes wrong:** Backend `/manifest.webmanifest` route is implemented, mounted correctly before Express static — but the browser never hits it because nginx returns the static file first.
**Why it happens:** `docker/nginx.conf` L71-78 has `location = /manifest.webmanifest { root /app/html; try_files $uri =404; }`. This is a static-file location with exact-match precedence over the generic `location /`. Requests never reach `proxy_pass http://127.0.0.1:30001`.
**How to avoid:** Change the block to `location = /manifest.webmanifest { proxy_pass http://127.0.0.1:30001; ...standard proxy headers... }`. Do the same in `docker/nginx-https.conf` L82 (verified — both files have parallel blocks). Precedent: `/api/usage` block at L902-909 of nginx.conf.
**Warning signs:** curl `-I http://localhost:8080/manifest.webmanifest` still returns headers with nginx's `Cache-Control: no-store...` (from the static block) rather than the backend's chosen headers. Response body still matches static file contents even after backend route is added.

### Pitfall 2: /api/branding + /branding/* have no nginx location block at all
**What goes wrong:** Backend route works when called directly at port 30001 but 404s when browser calls `https://<host>/api/branding` through nginx.
**Why it happens:** Nginx only proxies paths that have a matching `location` block. `/api/branding` and `/branding/*` are net-new prefixes not covered by any existing block. They fall through to the generic `location /` which returns index.html (SPA fallback) — the frontend sees HTML masquerading as JSON.
**How to avoid:** Add two new location blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`:
```nginx
location = /api/branding { proxy_pass http://127.0.0.1:30001; ...proxy headers... }
location ~ ^/branding(/.*)?$ { proxy_pass http://127.0.0.1:30001; ...proxy headers... }
```
**Warning signs:** JSON.parse errors in browser devtools on the branding fetch. `<link rel="icon" href="/branding/favicon.svg">` renders as broken image (nginx returned HTML).

### Pitfall 3: Path traversal via `/branding/*`
**What goes wrong:** Attacker requests `/branding/../../../etc/passwd` or `/branding/%2e%2e/config.json` and the backend serves an arbitrary file.
**Why it happens:** `req.params[0]` in `router.get("/*", ...)` is user-controlled. Naive `path.join(brandingDir, req.params[0])` does not prevent `..` escapes; `path.resolve` DOES normalize but the result can still escape the base dir if the input contains `..`.
**How to avoid:** After resolving, verify containment: `const resolved = path.resolve(brandingDir, requested); if (!resolved.startsWith(brandingDir + path.sep)) return res.status(400).end();`. This is ASVS V5 (Input Validation) territory.
**Warning signs:** Any 200 response for a requested path containing `..` or URL-encoded `..`.

### Pitfall 4: Config file trusted but assets not (or vice versa)
**What goes wrong:** Config JSON is trusted (operator-authored, read-only mount) but `iconPath` field references an absolute file path or a URL. The backend blindly serves whatever the config points at.
**Why it happens:** The schema in D-03 uses paths like `"iconPath": "/branding/icon.svg"` — a URL path, not a filesystem path. If the backend interprets this literally as a filesystem lookup it could read outside `/etc/skynet/branding/`.
**How to avoid:** The frontend consumes `iconPath` as a URL — it becomes `<img src="/branding/icon.svg">`. The backend `/branding/*` route interprets everything after `/branding/` as a relative filename within `/etc/skynet/branding/`. Config JSON is served AS-IS; the values are just strings the frontend uses in `src` attributes. Do NOT let the config's `iconPath` string itself dictate a filesystem lookup — the URL-to-file mapping is fixed by the `/branding/*` route's base dir.
**Warning signs:** A malicious config with `"iconPath": "/etc/shadow"` succeeds in serving something.

### Pitfall 5: Boot-time fetch race with AppShell mount
**What goes wrong:** AppShell renders before branding fetch resolves. First-paint shows "SKYNET" for a beat, then flashes to the AI+ name. Or worse — favicon fetch happens after service worker has already cached the wrong favicon.
**Why it happens:** `main.tsx` mounts `<App>` synchronously; `App` sets phase="verifying" and only kicks off `getUserInfo()` after `appReadyPromise`. The branding fetch has no natural gate.
**How to avoid:** Kick off the branding fetch as early as possible — in `main.tsx` BEFORE `createRoot(...).render(...)`, as part of the `prepareClientCacheVersion().finally(...)` chain, or as its own promise resolved in parallel with `appReadyPromise`. Use a sentinel (or the bundled-default values) as initial store state so first-paint is defensible even before the fetch lands.
**Warning signs:** Flash-of-wrong-brand visible for hundreds of milliseconds. Chrome devtools shows favicon request happening after DOMContentLoaded rather than during it.

### Pitfall 6: PWA manifest cached by service worker or browser
**What goes wrong:** After an AI+ deployment updates its `/opt/skynet/branding/pwa-icon-192.png`, iPhone home-screen icon still shows the old one.
**Why it happens:** `public/sw.js` L1 uses `CACHE_NAME = "skynet-static-v2"`. It precaches `/favicon.ico` and `/icons/*.png` (L3-9). Even though it doesn't currently precache the PWA icons at 192/512, the browser itself aggressively caches PWA manifests and icons at install time.
**How to avoid:** The backend `/manifest.webmanifest` should return `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` (matches nginx's current static-serve headers at L67, L76 of nginx.conf). The `/branding/*` route should return short-cache headers (e.g. `max-age=300`) since assets are operator-controlled and may change on the fly. Do NOT match the `max-age=31536000, immutable` that `/assets/*` uses. For iPhone PWA installs, a re-install may be required after the first rebrand — document this in D-15 rollout notes.
**Warning signs:** Stale favicon persists across restarts. `curl -I /manifest.webmanifest` returns long cache headers.

### Pitfall 7: The `/api/branding` route mount order (Express-side)
**What goes wrong:** After all the nginx work is done, requests reach the backend but hit the SPA fallback (`res.sendFile(path.join(frontendDist, "index.html"))` at database.ts L1927) instead of the branding router.
**Why it happens:** Express matches routes in registration order. `app.use()` calls after the static middleware (L1895-1919) or after the SPA-fallback middleware (L1921-1931) never fire for GET requests to unregistered paths.
**How to avoid:** Insert branding routes as a tight three-line cluster immediately after `app.use("/voice", voiceRoutes)` at L1879, BEFORE `const frontendDistPaths = [...]` at L1881. Do NOT insert inside the `if (frontendDist) { ... }` block.

### Pitfall 8: `common.appName` i18n key is `"Skynet"` in en.json (L83)
**What goes wrong:** CONTEXT.md `<specifics>` says "The `common.appName` i18n key ... does not need to be touched; the tab title is handled by the AppShell branding context and the logo surfaces are handled by iconPath/wordmarkPath." Grep confirms `t("common.appName")` is used at LoginPage.tsx L1137 for a giant marquee — BUT `LoginPage.tsx` is DEAD CODE. Confirmed via `grep -rn 'from.*LoginPage'` returning zero import sites; `main.tsx` L11 imports from `@/auth/Auth` (Auth.tsx), not LoginPage.tsx. So CONTEXT.md's specific claim holds — the i18n key IS untouched by any live UI. BUT: `en.json` L914 also has `"loginTitle": "Login to SKYNET"` and Auth.tsx L1314 uses `t("auth.loginTitle")` in a live surface (the "Login to SKYNET" `<h2>` above the login form).
**Why it matters:** This is a fifth user-facing "SKYNET" string not enumerated in CONTEXT.md D-08's four surfaces. The plan must decide: (a) leave it as-is (operator lives with "Login to SKYNET" on AI+ deploys), (b) fold into the branding surfaces (wire `t("auth.loginTitle")` through the branding config or replace with a hardcoded `t("common.login")` for stack-neutral phrasing), or (c) treat as deferred like the apple-touch-icons.
**Recommendation:** Recommend (b) as a small addition to the phase scope — the fix is one line in Auth.tsx (`t("auth.loginTitle")` → `t("common.login")` or similar) plus a locale-key deletion. But this is a scope-expansion decision for Ashley, not for research to lock. Flag it, don't decide it.

### Pitfall 9: Vite dev-server serves from `public/` differently than production
**What goes wrong:** In dev (`npm run dev`), Vite serves `public/manifest.webmanifest` directly and `public/skynet-wordmark.png` from the URL root. In production, these come out of `/app/html/` via nginx. If the plan makes changes that only work in one mode, testing gets confused.
**Why it happens:** Vite's dev server has its own static-file handling for `public/`. The dev proxy config (if any) determines what falls through to the backend.
**How to avoid:** Test both `npm run dev` and a Docker build. Do NOT rely on renaming or deleting `public/manifest.webmanifest` — even if the backend supersedes it, the file may be needed as a dev-time fallback. Simpler: leave `public/manifest.webmanifest` in place, serving the "bundled default" for dev, and rely on backend interception in prod. (Or COPY it into `/app/branding-defaults/` at build time.)

### Pitfall 10: `t("common.appName").toUpperCase()` in dead LoginPage.tsx is a red herring
**What goes wrong:** During grep-based enumeration a naive reviewer will find LoginPage.tsx and try to modify the giant marquee heading, wasting effort.
**Why it happens:** LoginPage.tsx is 1000+ lines of live-looking code with `document.title` writes at L691, L734, L766, L791, L805 — but no live import. Confirmed dead 2026-09-03: `grep -rn 'LoginPage' src --exclude LoginPage.tsx` returns only comment references.
**How to avoid:** Include a "dead code — do not touch" note in the plan for LoginPage.tsx.

## Code Examples

Verified live in this codebase:

### Existing document.title assignment (AppShell L615)
```typescript
// Source: src/ui/AppShell.tsx L613-616 (verified 2026-09-03)
const resolvedKey = (tmux ?? activeTab?.label ?? "").toLowerCase();
const identity = resolvedKey ? identitiesByKey.get(resolvedKey) : null;
document.title =
  identity?.displayName || tmux || activeTab?.label || "SKYNET";
```
Wire branding config as the last fallback: `... || brandingConfig.appName`.

### Existing pre-login fetch pattern (WeeklyUsageMeter L99)
```typescript
// Source: src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx L99 (verified 2026-09-03)
const res = await fetch("/api/usage");
```
Same pattern for branding: plain `fetch("/api/branding")` returning `Response`, no `authApi` (which requires JWT).

### Existing conversation header (target for rewire)
```tsx
// Source: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx L1489-1497 (verified 2026-09-03)
<SkynetLogo
  aria-hidden="true"
  className="pv-header-logo"
/>
<img
  src="/skynet-wordmark.png"
  alt="SKYNET"
  className="pv-header-wordmark"
/>
```
Rewire to:
```tsx
<img
  src={brandingConfig.iconPath}
  aria-hidden="true"
  className="pv-header-logo"
/>
<img
  src={brandingConfig.wordmarkPath}
  alt={brandingConfig.appName}
  className="pv-header-wordmark"
/>
```
Note: `SkynetLogo` (SVG component) becomes `<img>` (per D-02 wording "small icon element … `<img src={brandingConfig.iconPath}>`"). Preserve the CSS class `pv-header-logo` for styling continuity.

### Existing login screen header (target for rewire)
```tsx
// Source: src/ui/auth/Auth.tsx L1131-1142 (verified 2026-09-03)
<img
  src="/icon.png"
  alt=""
  className="h-12 w-12 shrink-0"
  draggable={false}
/>
<img
  src="/skynet-wordmark.png"
  alt="Skynet"
  className="h-8 w-auto"
  draggable={false}
/>
```
Same rewire — swap both `src`s to `brandingConfig.iconPath` / `brandingConfig.wordmarkPath`. Note that `/icon.png` today is NOT the same asset as the SkynetLogo SVG in the conversation header (see Summary finding #2).

### Bundled defaults directory in Dockerfile
```dockerfile
# Source pattern verified: Dockerfile L77 "COPY --chown=node:node --from=frontend-builder /app/dist /app/html"
# Add:
COPY --chown=node:node docker/branding-defaults /app/branding-defaults
```
Store bundled defaults in the repo at `docker/branding-defaults/` (or `branding-defaults/` at repo root — planner discretion). Copy at image-build time so they're always present.

### docker-compose bind-mount block (target for update)
```yaml
# Source: docker/docker-compose.yml L8-9 (verified 2026-09-03)
    volumes:
      - skynet-data:/app/data
# Add:
      - /opt/skynet/branding.json:/etc/skynet/branding.json:ro
      - /opt/skynet/branding:/etc/skynet/branding:ro
```
Note: Docker WILL fail to start the container if the host path doesn't exist (default behavior for bind mounts). Two approaches:
- **Approach A (recommended per D-14 "t1000 has no config file"):** Use `type: bind` with `create_host_path: true` in long-form syntax — Docker creates an empty dir/file if missing. Backend then reads empty file → falls back to defaults.
- **Approach B:** Document that t1000 must have empty placeholder files at `/opt/skynet/branding.json` (empty file → JSON parse fails → falls back to defaults per pitfall-tolerant loader) and empty `/opt/skynet/branding/` dir.

Prefer A. Verify Docker Compose version supports `create_host_path` (Compose spec 3.4+, present in modern Docker).

## State of the Art

Not applicable — this is standard Express + React work using patterns that have been in the codebase for months (`global-files` shipped Phase 23, `usage` shipped in 260729-1vd, `session-tmux-store` shipped Phase 41). No framework churn to worry about.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Docker Compose `create_host_path: true` under `type: bind` is available in the deploy env's Compose version | Bundled defaults section | Container fails to start on t1000; workaround is placeholder files on host |
| A2 | Backend Express matches routes in registration order (L1807-L1879 mount order matters) | Anti-Patterns, Pitfall 7 | This is Express default behavior; verified by code comments at database.ts L1818-L1824 explaining the pattern for /identities routes |
| A3 | PWA on iPhone re-picks-up new manifest on next PWA install (not on hot-reload of existing install) | Pitfall 6 | Existing AI+ PWA users may see stale branding briefly; acceptable per D-15 |
| A4 | The comment at CONTEXT.md `<specifics>` about `common.appName` being safe-to-leave is correct because LoginPage.tsx is dead code | Pitfall 8, Pitfall 10 | Verified 2026-09-03 via grep — no live imports of LoginPage. |

**All other claims in this document are `[VERIFIED: codebase-grep]` at the referenced file:line.**

## Open Questions

1. **Should `t("auth.loginTitle")` = "Login to SKYNET" (Auth.tsx L1314) be part of Phase 70 scope?**
   - What we know: It's a live user-facing string surfacing "SKYNET" on the login screen — a fifth surface not in CONTEXT.md D-08's four.
   - What's unclear: Whether Ashley considers this in-scope or deferred.
   - Recommendation: Flag to Ashley in planning phase; if in-scope, add a single-line change: replace with a stack-neutral phrase (e.g., `t("common.login")` = "Login") OR wire through branding config (`Login to ${brandingConfig.appName.toUpperCase()}`).

2. **Should the bundled-default `iconPath` unify the conversation-header and login-screen icons?**
   - What we know: Currently different assets (`SkynetLogo` SVG vs `/icon.png`).
   - What's unclear: Which one is the "canonical" Skynet icon per Ashley — or whether the two are BOTH intentional (icon.png is a photo/detailed version; SVG is a stylized simplified version).
   - Recommendation: Keep the current visual as-is by picking `/icon.png` as the bundled default (the design-mock-authoritative version, per the wordmark file that lives next to it). Rewire `PrettyConversationsPanel` header to use the same `iconPath` for consistency with D-08's "same icon+wordmark as the conversation header" claim.

3. **What are the exact bundled-default asset filenames + directory structure inside the image?** (Marked as Claude's Discretion in CONTEXT.md)
   - Recommendation:
     ```
     /app/branding-defaults/
     ├── branding.json           # {"appName":"Skynet","shortName":"Skynet","iconPath":"/branding/icon.png",...}
     ├── icon.png                # copy of public/icon.png
     ├── wordmark.png            # copy of public/skynet-wordmark.png
     ├── favicon.svg             # or copy public/favicon.ico
     ├── pwa-icon-192.png        # copy of public/apple-touch-icon-192.png
     └── pwa-icon-512.png        # copy of public/apple-touch-icon-512.png
     ```
   - Files live at `docker/branding-defaults/` in the repo, `COPY`'d in Dockerfile.

4. **Should the SW cache name (`skynet-static-v2` at public/sw.js L1) be bumped to invalidate the cached `/favicon.ico`?**
   - What we know: SW precaches `/favicon.ico`. After the branding change, the favicon URL changes from `/favicon-32.png` (index.html L22) to `/branding/favicon.svg` (dynamic).
   - What's unclear: Whether keeping the old `/favicon.ico` cached matters (it may never be requested again since index.html changes).
   - Recommendation: Leave SW cache name alone in this phase; if operators report favicon staleness, follow up separately.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime | Backend routes | ✓ | 22-slim (Dockerfile L2) | — |
| Express | Backend routes | ✓ | 5.2.1 (package.json) | — |
| React | Frontend store + surfaces | ✓ | 19.x | — |
| Docker Compose (with bind mount support) | Deployment | ✓ | — (host-side) | Approach B (placeholder files) |
| `docker/branding-defaults/` directory in repo | Bundled defaults | ✗ (does not exist yet) | — | Create it as part of Wave 0 of the plan |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `docker/branding-defaults/` — must be created as a plan task. Not a blocker; it's part of the phase's own build product.

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false`.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`. `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Branding routes are intentionally unauthenticated (pre-login surface) |
| V3 Session Management | No | Stateless GETs; no session interaction |
| V4 Access Control | No | Config file is bind-mounted read-only from host; no user-role gating needed |
| V5 Input Validation | **YES** | `/branding/*` route accepts user-controlled path segments — path traversal defense required |
| V6 Cryptography | No | No secrets, no signing, no crypto in scope |
| V7 Error Handling | Yes (lightweight) | Malformed config → log + fallback, never throw to client. Missing asset → 404, not 500 |
| V8 Data Protection | No | No PII, no secrets, all values are display strings |
| V12 Files & Resources | **YES** | Filesystem read from a user-provided path segment — must contain within base dir |
| V13 API & Web Service | Yes | JSON response for `/api/branding`, `application/manifest+json` for `/manifest.webmanifest` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `/branding/../../../etc/passwd` | Tampering / Information Disclosure | `path.resolve` + `.startsWith(baseDir + path.sep)` guard; reject with 400 on escape |
| Symbolic link escape from within `/etc/skynet/branding/` | Information Disclosure | `fs.realpath` after resolve, re-check containment; OR mount `:ro` and refuse to follow symlinks in the route handler |
| Config JSON containing untrusted `iconPath` values | Tampering | Values are TREATED as URL strings by the frontend, not as filesystem paths by the backend. `/branding/*` route uses its own base dir; config's `iconPath` is opaque data. |
| Denial-of-service via huge config file | Denial of Service | `fs.stat` first, refuse if `size > 256 KB` (matches `MAX_CONFIG_BYTES` in `global-files-config-loader.ts` L50) |
| Denial-of-service via huge asset directory | Denial of Service | Per-asset `fs.stat` size check; refuse assets larger than a reasonable threshold (e.g., 2 MB for images) |
| Unauthenticated exposure of internal filesystem shape | Information Disclosure | Route returns 404 (not 403) for missing files; no directory listing; no filesystem paths in error responses |
| Response-header injection via config values | Cross-cutting | JSON.stringify before `res.send` for `/api/branding`; static string content-types elsewhere; do not echo config values into headers |

## Sources

### Primary (HIGH confidence) — all verified in this codebase
- `src/backend/database/database.ts` L1807-1932 — route registration + static middleware structure
- `src/backend/database/routes/global-files-config-loader.ts` (full file) — canonical JSON config loader pattern
- `src/backend/database/routes/global-files.ts` (full file) — Router pattern (authenticated variant)
- `src/backend/database/routes/usage.ts` (full file) — Router pattern (unauthenticated variant, with nginx caveat doc)
- `src/ui/state/session-tmux-store.ts` (full file) — `useSyncExternalStore` module-singleton store pattern
- `src/ui/state/identities-store.ts` L1-80 — Store variant with async initial fetch
- `docker/nginx.conf` L57-78, L886-909 — static-file interception vs proxy_pass patterns
- `docker/docker-compose.yml` (full file) — current volume-mount block structure
- `docker/Dockerfile` (full file) — multi-stage build; COPY sites for new assets
- `docker/entrypoint.sh` (full file) — runtime path setup
- `src/ui/AppShell.tsx` L232, L613-624, L1569 — three "SKYNET" hardcoded call sites
- `src/ui/auth/Auth.tsx` L1131-1142 — login screen icon+wordmark render (LIVE surface)
- `src/ui/auth/Auth.tsx` L1314 — `t("auth.loginTitle")` "Login to SKYNET" (LIVE surface, not in CONTEXT.md D-08)
- `src/ui/auth/LoginPage.tsx` (dead code — verified no imports)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L135, L1489-1497 — SkynetLogo + wordmark render
- `src/ui/features/pretty-conversations/SkynetLogo.tsx` (full file) — inline SVG component
- `index.html` (full file) — `<title>`, favicon links, manifest link, apple-touch-icons
- `public/manifest.webmanifest` and `public/manifest.json` — static PWA manifests
- `public/sw.js` (full file) — SW precache list including `/favicon.ico`
- `src/ui/locales/en.json` L83, L914 — `common.appName` and `auth.loginTitle` i18n values
- `src/ui/main.tsx` (full file) — auth flow phasing; where boot-time branding fetch should go
- `src/ui/api/global-files-api.ts` — frontend API-helper pattern (authApi variant, contrast with unauthed usage-meter pattern)
- `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx` L99 — precedent for unauthenticated pre-login `fetch("/api/...")`

### Secondary (MEDIUM confidence)
- CLAUDE.md-nginx-caveat inference from three matching in-code comments (usage.ts L16-18, database.ts L1858-1859, database.ts L1871-1872). Rule: any new backend route with a URL prefix not covered by existing nginx `location` blocks needs matching blocks added in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.

### Tertiary (LOW confidence)
- None — all critical claims verified in codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in-use; no new deps
- Architecture: HIGH — three prior parallel features (`global-files`, `usage`, `skills-editor`) map cleanly onto this phase's shape
- Pitfalls: HIGH — nginx interception (P1, P2) and path traversal (P3) are the two load-bearing ones and both are documented codebase conventions
- Runtime state: HIGH — nothing to migrate; bind-mount is the whole point
- Security: HIGH for input validation and path containment; the phase surface is small (3 GET routes, no user-provided data mutation)

**Research date:** 2026-09-03
**Valid until:** 2026-10-03 (30 days — the codebase patterns referenced are stable, not fast-moving)
