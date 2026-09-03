---
phase: 70-branding-config
plan: 01
subsystem: backend
tags: [branding, express-routes, config-loader, path-safety, bundled-defaults]
dependency_graph:
  requires: []
  provides:
    - "docker/branding-defaults/ (bundled default JSON + 5 assets, image-baked)"
    - "src/backend/branding/branding-config-loader.ts (loadBrandingConfig, getBundledDefaults, resolveAssetPath, path helpers, BrandingConfig type)"
    - "src/backend/branding/branding-routes.ts (Express Router mounting GET /api/branding, /manifest.webmanifest, /branding/*)"
    - "brandingRoutes mount in src/backend/database/database.ts (BEFORE frontendDistPaths block)"
  affects:
    - "Backend Express request pipeline gains three new unauthenticated GET surfaces"
    - "The /manifest.webmanifest request path now hits the backend rather than falling through to Express-static — nginx-side plumbing in plan 70-02 still 404s these paths until it lands"
tech_stack:
  added: []
  patterns:
    - "Never-throws JSON loader (analog: global-files-config-loader.ts)"
    - "Unauthenticated Express Router (analog: usage.ts)"
    - "Per-file fallback: override in /etc/skynet/branding/, then bundled default in /app/branding-defaults/, then 404"
    - "Path-containment guard: path.resolve + startsWith(base + path.sep) on both override and default base dirs"
    - "Inline typeof/Array.isArray shape guard (no Zod)"
    - "sshLogger.error on every failure path"
key_files:
  created:
    - "docker/branding-defaults/branding.json"
    - "docker/branding-defaults/icon.png"
    - "docker/branding-defaults/wordmark.png"
    - "docker/branding-defaults/favicon.svg"
    - "docker/branding-defaults/pwa-icon-192.png"
    - "docker/branding-defaults/pwa-icon-512.png"
    - "src/backend/branding/branding-config-loader.ts"
    - "src/backend/branding/branding-routes.ts"
  modified:
    - "src/backend/database/database.ts (+1 import, +1 mount cluster with 8-line CLAUDE.md nginx caveat comment)"
decisions:
  - "Loader path helpers return fixed absolute paths (/etc/skynet/branding.json, /etc/skynet/branding, /app/branding-defaults) — no env override. Rationale: D-01 pins the mount points; global-files-config-loader.ts's DATA_DIR env pattern is inappropriate here."
  - "getBundledDefaults() is memoized on first call via readFileSync — the file is baked into the image at COPY time and never changes at runtime, so caching is safe and avoids re-reading on every request."
  - "resolveAssetPath() throws only on containment violation; ENOENT during fs.access is not an error, it just triggers the next fallback. Route handler catches the throw and returns 400 with empty body."
  - "background_color + theme_color in the /manifest.webmanifest response are hardcoded to #0a0b12 per CONTEXT.md deferred-ideas note ('Theme color / visual styling swaps — explicitly out of scope')."
  - "Import path in database.ts is `../branding/branding-routes.js` (branding/ is a sibling of database/ under src/backend/), not `./branding/branding-routes.js`."
metrics:
  duration: "~10 min"
  completed: "2026-09-03"
  tasks_completed: 2
  files_created: 8
  files_modified: 1
---

# Phase 70 Plan 01: Backend Branding Subsystem Summary

Bundled default branding assets + never-throws JSON+asset loader + three unauthenticated Express routes (GET /api/branding, /manifest.webmanifest, /branding/*) mounted before the frontend static middleware, wiring the backend half of the Phase 70 branding-config feature per D-01–D-06 and D-11–D-14.

## Tasks Executed

### Task 1: Create `docker/branding-defaults/` with branding.json + 5 asset files

**Commit:** `00c82dfe`
**Files created:** 6

| File | Source | Bytes |
|------|--------|-------|
| `docker/branding-defaults/branding.json` | Authored per D-03 (appName="Skynet" per D-14) | 361 |
| `docker/branding-defaults/icon.png` | `cp public/icon.png` — byte-for-byte | 12952 |
| `docker/branding-defaults/wordmark.png` | `cp public/skynet-wordmark.png` — byte-for-byte | 16608 |
| `docker/branding-defaults/favicon.svg` | `cp public/icon.svg` — byte-for-byte | 1186 |
| `docker/branding-defaults/pwa-icon-192.png` | `cp public/apple-touch-icon-192.png` — byte-for-byte | 7006 |
| `docker/branding-defaults/pwa-icon-512.png` | `cp public/apple-touch-icon-512.png` — byte-for-byte | 21029 |

**Verification:**
- `cmp -s public/icon.png docker/branding-defaults/icon.png` → exit 0 (identical)
- `cmp -s public/skynet-wordmark.png docker/branding-defaults/wordmark.png` → exit 0 (identical)
- `JSON.parse` succeeds; `appName === "Skynet"`; `pwaIcons.length === 2` — all pass.

**Note on favicon.svg:** Per the important-notes in the prompt, the codebase uses raster favicons (`/favicon-32.png` + `/favicon-16.png`) in `index.html`, but a modern vector `public/icon.svg` exists and is the cleanest default for a `faviconPath` in the config schema. Copied `public/icon.svg` → `docker/branding-defaults/favicon.svg` as originally specified in the plan action step (line 4 of Task 1). No placeholder images were generated.

### Task 2: Create loader + routes + mount in database.ts

**Commit:** `5e99d2fb`
**Files created:** 2, **modified:** 1

**`src/backend/branding/branding-config-loader.ts` (296 lines)**

Loader shape follows `global-files-config-loader.ts` verbatim, with these deltas noted in `<decisions>`:

| Concern | Analog (global-files) | Branding delta |
|---------|-----------------------|-----------------|
| Config path | `path.join(dataDir ?? DATA_DIR, "global-files.json")` | Fixed `/etc/skynet/branding.json` — no env override (D-01 pins) |
| Empty-state fallback | `{ hosts: {} }` | `getBundledDefaults()` reading `/app/branding-defaults/branding.json` |
| Bundled-defaults reader | (n/a) | Memoized synchronous `readFileSync` on first call + hardcoded last-resort fallback |
| Asset resolver | `getFilesForHost()` (config lookup, no I/O) | `resolveAssetPath()` (per-file fs.access with fallback, containment guards) |
| Size cap | 256 KB | 256 KB (identical) |
| Shape guard | Inline typeof / Array.isArray | Inline typeof / Array.isArray (including nested pwaIcons entry check) |
| Never-throws contract | Yes | Yes — `resolveAssetPath` throws only on path escape, which route wraps |

**Exports:** `BrandingConfig` (type), `BRANDING_CONFIG_FILENAME`, `getBrandingConfigPath`, `getBrandingAssetsDir`, `getBundledDefaultsDir`, `getBundledDefaults`, `loadBrandingConfig`, `resolveAssetPath`.

**`src/backend/branding/branding-routes.ts` (165 lines)**

Router shape follows `usage.ts` verbatim (unauthenticated variant — no AuthManager import). Module-header JSDoc contains the CLAUDE.md nginx caveat text covering all three routes with an explicit note that `/manifest.webmanifest` REPLACES the prior static-serve block.

| Handler | Cache-Control | Notes |
|---------|--------------|-------|
| GET /api/branding | `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` | Belt-and-suspenders try/catch → returns bundled defaults on any unexpected error |
| GET /manifest.webmanifest | `no-store, ...` + `Content-Type: application/manifest+json` | background_color + theme_color hardcoded `#0a0b12` per deferred-ideas note |
| GET /branding/* | `public, max-age=300` | Empty/root path → 404; containment violation → 400 (empty body); missing → 404; on sendFile err → 500 (only if headers not sent) |

Path-traversal defense: rejects any `..`-escape via `path.resolve` + `startsWith(base + path.sep)` on BOTH the override base (`/etc/skynet/branding`) AND the bundled-default base (`/app/branding-defaults`). Verified via grep: `path.resolve` appears 4 times, `startsWith` appears 2 times in the loader.

**`src/backend/database/database.ts` edits**

Import inserted at line 49 alongside other route imports (immediately after `relayPointerRoutes`):
```typescript
import brandingRoutes from "../branding/branding-routes.js";
```

Mount inserted at line 1892 (between `app.use("/voice", voiceRoutes);` at L1889 and `const frontendDistPaths` at L1894) with an 8-line JSDoc-style comment referencing the CLAUDE.md nginx caveat and explicitly stating the mount is BEFORE the express.static block per Pitfall 7 mount-order discipline:

```
Mount ordering check: brandingRoutes at line 1892 BEFORE frontendDistPaths at line 1894 → OK
```

## Verification

All Task 2 verify gate checks pass:

| Check | Expected | Actual |
|-------|----------|--------|
| `npx tsc --noEmit` | exit 0, zero output | exit 0, zero output |
| `grep -c "brandingRoutes" src/backend/database/database.ts` | ≥ 2 | 2 |
| `grep -c "loadBrandingConfig" src/backend/branding/branding-routes.ts` | ≥ 1 | 4 |
| `grep -c "path.resolve" src/backend/branding/branding-config-loader.ts` | ≥ 2 | 4 |
| `grep -c "startsWith" src/backend/branding/branding-config-loader.ts` | ≥ 2 | 2 |
| `grep -c "sshLogger.error" src/backend/branding/branding-config-loader.ts` | ≥ 3 | 12 |
| `grep -c "CLAUDE.md" src/backend/branding/branding-routes.ts` | ≥ 1 | 1 |
| `grep -c "res.status(400)" src/backend/branding/branding-routes.ts` | ≥ 1 | 1 |
| Mount ordering (brandingRoutes before frontendDistPaths) | b < f | b=1892 < f=1894 |
| `package.json` unchanged | true | true |
| Loader ≥ 120 lines | true | 296 |
| Routes ≥ 80 lines | true | 165 |

## Deviations from Plan

None — plan executed exactly as written.

Two minor implementation clarifications worth flagging (not deviations):

1. The plan action for `resolveAssetPath` specifies "route wraps in try" — implemented as such: the route catches the containment-violation `Error` thrown by the loader and returns 400 with empty body. ENOENT on either fallback tier does NOT throw; it flows through to the `"missing"` return value.
2. The `getBundledDefaults()` implementation uses synchronous `readFileSync` (not async `fs.promises.readFile`) so it can be called synchronously from failure paths inside `loadBrandingConfig()` without introducing an extra `await` layer or a lazy-async pattern. The file is tiny (~360 bytes) and read-once (memoized), so sync I/O is appropriate.

## Handoff Notes

**To Plan 70-02 (nginx plumbing):**
- The three backend routes are live at Express port 30001 but nginx will still 404 all three paths (`/api/branding`, `/branding/*`, `/manifest.webmanifest`) until location blocks are added in BOTH `docker/nginx.conf` and `docker/nginx-https.conf`.
- The existing `location = /manifest.webmanifest` block in both nginx configs (nginx.conf L71-78, nginx-https.conf L82-89 per 70-PATTERNS.md) must be REPLACED with `proxy_pass http://127.0.0.1:30001` — not just deleted.
- The `docker-compose.yml` bind-mount additions and Dockerfile `COPY docker/branding-defaults /app/branding-defaults` also land in plan 70-02.

**To Plan 70-03 (frontend store):**
- `GET /api/branding` returns the shape defined in the exported `BrandingConfig` type — the frontend store should use the same field names (`appName`, `shortName`, `iconPath`, `wordmarkPath`, `faviconPath`, `pwaIcons`) verbatim. Consider importing the type directly if possible, or mirroring it in the frontend module.
- Response `Cache-Control` is `no-store` — the frontend fetches once at boot and any subsequent refetch always hits the backend, not a cache.

**To Plan 70-04 (frontend surfaces):**
- The four surfaces per D-08 (tab title, favicon, conversation-list header, login screen header) consume `appName`, `faviconPath`, `iconPath`, `wordmarkPath` respectively — matches the field names now shipped in `BrandingConfig`.
- The fifth surface flagged in RESEARCH.md Open Question #1 (`Auth.tsx` L1314 `t("auth.loginTitle")` = "Login to SKYNET") is not addressed by this plan and remains a scope-question for the frontend plan.
- The bundled default `iconPath` resolves to `/branding/icon.png` (byte-identical to `public/icon.png`), so the conversation header switch from inline `<SkynetLogo>` SVG to `<img src={brandingConfig.iconPath}>` will visually swap SVG-rendered → PNG-rendered on t1000 no-config deploys. If pixel-perfect continuity of the conversation-header icon is required, plan 70-04 should either (a) accept this small visual delta, (b) generate a new bundled default from a rasterized `SkynetLogo` render, or (c) copy `public/icon.svg` to `docker/branding-defaults/icon.svg` and change the bundled `iconPath` to `/branding/icon.svg` (SVG in `<img>` renders fine in browsers).

## Threat Flags

None — no new security-relevant surface introduced beyond the three routes already covered by the plan's `<threat_model>` (T-70-01-01 through T-70-01-SC).

## Self-Check: PASSED

- Files created (all present):
  - `docker/branding-defaults/branding.json` — FOUND
  - `docker/branding-defaults/icon.png` — FOUND
  - `docker/branding-defaults/wordmark.png` — FOUND
  - `docker/branding-defaults/favicon.svg` — FOUND
  - `docker/branding-defaults/pwa-icon-192.png` — FOUND
  - `docker/branding-defaults/pwa-icon-512.png` — FOUND
  - `src/backend/branding/branding-config-loader.ts` — FOUND
  - `src/backend/branding/branding-routes.ts` — FOUND
- File modified (present in git log):
  - `src/backend/database/database.ts` — modified in commit 5e99d2fb
- Commits:
  - `00c82dfe` — FOUND (feat(70-01): add bundled default branding assets)
  - `5e99d2fb` — FOUND (feat(70-01): add branding config loader + Express routes)
