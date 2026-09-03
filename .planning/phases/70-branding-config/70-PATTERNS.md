# Phase 70: branding-config - Pattern Map

**Mapped:** 2026-09-03
**Files analyzed:** 15 new / modified
**Analogs found:** 15 / 15

All new files map cleanly onto existing codebase patterns. Every new file has an exact-role analog; the planner should copy the analog's shape verbatim (module-header doc block, imports, error handling, log lines) and only swap the domain-specific parts.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/branding/branding-config-loader.ts` | backend loader (config parse) | file-I/O, never-throws | `src/backend/database/routes/global-files-config-loader.ts` | exact |
| `src/backend/branding/branding-routes.ts` | backend route module (unauthed) | request-response (JSON + files) | `src/backend/database/routes/usage.ts` | exact (unauth variant) |
| `src/backend/branding/asset-resolver.ts` (optional split) | backend utility (path containment + fallback) | file-I/O with fallback | `src/backend/database/routes/global-files-config-loader.ts` (getFilesForHost) | role-match |
| `src/ui/branding/branding-store.ts` | frontend store (module singleton) | pub-sub | `src/ui/state/session-tmux-store.ts` | exact |
| `src/ui/branding/branding-fetch.ts` (or inline in `main.tsx`) | frontend boot-time fetch | request-response | `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx` L96-111 | role-match (unauthed pre-login fetch) |
| `src/ui/branding/apply-favicon.ts` (optional split) | frontend imperative DOM effect | one-shot side-effect | `src/ui/AppShell.tsx` L613-624 (document.title effect) | role-match |
| `docker/branding-defaults/branding.json` (new) | bundled default config | static asset | `public/manifest.webmanifest` | analog for shape only |
| `docker/branding-defaults/*` assets (new) | bundled default images | static asset | `public/icon.png`, `public/skynet-wordmark.png` | analog for placement |
| `docker/nginx.conf` (modify) | nginx routing | request-routing | Existing `/api/usage` block L900-909 + `/manifest.webmanifest` block L71-78 | exact |
| `docker/nginx-https.conf` (modify) | nginx routing | request-routing | Existing `/api/usage` block L884-893 + `/manifest.webmanifest` block L82-89 | exact |
| `docker/Dockerfile` (modify) | image build | COPY layer | Existing `COPY --from=frontend-builder /app/dist /app/html` at L77 | exact |
| `docker/docker-compose.yml` (modify) | deploy bind-mount | volumes | Existing `skynet-data:/app/data` at L8-9 | exact |
| `src/backend/database/database.ts` (modify) | route registration | mount site | Existing `app.use("/api/usage", usageRoutes)` L1877 | exact |
| `src/ui/AppShell.tsx` (modify) | tab-title wire-through | consume store | L232, L616, L1569 – three "SKYNET" fallbacks | (this file is itself the target) |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (modify) | header wire-through | consume store | L1489-1497 (SkynetLogo + wordmark img) | (target) |
| `src/ui/auth/Auth.tsx` (modify) | login header wire-through | consume store | L1131-1142 (icon.png + wordmark img) | (target) |
| `index.html` (modify) | root HTML meta | static | L16 (`apple-mobile-web-app-title`), L22-23 (favicon links) — kept as neutral defaults, may keep as-is per D-09 | (target) |
| `public/manifest.webmanifest` (leave in place) | dev-mode fallback | static | keep for Vite dev-server per Pitfall 9 | (unchanged) |

## Pattern Assignments

### `src/backend/branding/branding-config-loader.ts` (loader, file-I/O, never-throws)

**Analog:** `src/backend/database/routes/global-files-config-loader.ts` (verified 2026-09-03)

**Copy the module-header doc-block shape** (lines 1-29):
- Purpose one-liner
- Where the config file lives (host path + container path)
- Error-handling contract table (ENOENT → defaults, parse-error → defaults + log, size-cap → defaults + log, never-throws)
- Pure-I/O statement so any context can import

**Imports pattern** (lines 31-33):
```typescript
import { promises as fs } from "node:fs";
import path from "node:path";
import { sshLogger } from "../../utils/logger.js";
```
Note: `sshLogger` is at `src/backend/utils/logger.ts` (verified). Same import path from `src/backend/branding/` will be `"../utils/logger.js"` (one `..` fewer since branding is one level shallower than `database/routes/`).

**Constants pattern** (lines 47-50):
```typescript
export const BRANDING_CONFIG_FILENAME = "branding.json";
/** Byte cap: reject files >256KB — config file should be tiny. */
const MAX_CONFIG_BYTES = 256 * 1024;
```

**Path helper** (lines 56-68):
```typescript
export function getBrandingConfigPath(): string {
  return "/etc/skynet/branding.json";  // fixed mount point per D-01
}
export function getBrandingAssetsDir(): string {
  return "/etc/skynet/branding";       // fixed mount point per D-01
}
export function getBundledDefaultsDir(): string {
  return "/app/branding-defaults";     // Dockerfile COPY target per D-11
}
```
(Adapt: unlike `global-files` which uses `DATA_DIR` env, branding uses fixed absolute paths since D-01 pins them.)

**Loader pattern** (lines 74-140 verbatim — this is the template):
```typescript
export async function loadBrandingConfig(): Promise<BrandingConfig> {
  const configPath = getBrandingConfigPath();
  let raw: string;
  try {
    const stat = await fs.stat(configPath);
    if (stat.size > MAX_CONFIG_BYTES) {
      sshLogger.error("branding-config-loader: config file exceeds size cap", {
        operation: "branding_config_size",
        error: `Config file is ${stat.size} bytes (max ${MAX_CONFIG_BYTES}) — returning defaults`,
        path: configPath,
      });
      return getBundledDefaults();
    }
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing file is normal for deployments that don't override.
      return getBundledDefaults();
    }
    sshLogger.error("branding-config-loader: config file read error", {
      operation: "branding_config_read",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return getBundledDefaults();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    sshLogger.error("branding-config-loader: JSON parse error", {
      operation: "branding_config_parse",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return getBundledDefaults();
  }

  // Validate shape: { appName: string, shortName: string, iconPath: string, ... }
  if (!isValidBrandingShape(parsed)) {
    sshLogger.error("branding-config-loader: unexpected config shape", {
      operation: "branding_config_parse",
      error: "Config does not have expected shape",
      path: configPath,
    });
    return getBundledDefaults();
  }

  return parsed as BrandingConfig;
}
```

**Shape guard pattern** (lines 122-137 style):
```typescript
function isValidBrandingShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.appName === "string"
      && typeof o.shortName === "string"
      && typeof o.iconPath === "string"
      && typeof o.wordmarkPath === "string"
      && typeof o.faviconPath === "string"
      && Array.isArray(o.pwaIcons);
}
```
(Style: inline `typeof`/`Array.isArray` guards, no Zod — matches L122-137 house style. Research L48-49 explicitly allows Zod as an alternative but flags the inline guard as "the more common house style".)

**Adaptation notes vs. analog:**
- Empty state is NOT `{ hosts: {} }` — it's `getBundledDefaults()` (reads `/app/branding-defaults/branding.json`, which is always present because Dockerfile COPYs it at build time). Keep `getBundledDefaults` itself synchronous or memoized after first call to avoid re-reading the same file on every request.
- Add a second exported helper `resolveAssetPath(requested: string): { path: string; source: "override" | "default" }` that implements per-file fallback for D-04. Shape mirrors `getFilesForHost` at L158-198 of the analog (single-purpose resolver, dropped-entry logging).

---

### `src/backend/branding/branding-routes.ts` (route module, unauthenticated)

**Analog:** `src/backend/database/routes/usage.ts` (verified 2026-09-03)

**Copy the module-header doc-block shape** (lines 1-21 of analog):
- What the route surfaces and to whom
- **The CLAUDE.md nginx caveat reminder** (lines 16-18 verbatim — this is load-bearing convention):
```typescript
/**
 * ...
 * Per CLAUDE.md nginx caveat: matching location blocks MUST exist in
 * BOTH docker/nginx.conf AND docker/nginx-https.conf for:
 *   - /api/branding
 *   - /branding/*
 *   - /manifest.webmanifest  (existing static block must be REPLACED with proxy_pass)
 * ...
 * Mounted at: app.use(brandingRoutes) in database.ts (three routers, or one router with all three paths)
 */
```

**Router pattern** (lines 23-25):
```typescript
import express from "express";
const router = express.Router();
```

**Handler pattern (adapt from L41-61 shape):**
```typescript
router.get("/api/branding", async (_req, res) => {
  try {
    const config = await loadBrandingConfig();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    return res.status(200).json(config);
  } catch {
    // loadBrandingConfig never-throws, but belt-and-suspenders
    return res.status(200).json(getBundledDefaults());
  }
});
```
(Cache-Control matches nginx's existing static-serve headers for `/manifest.webmanifest` at nginx.conf L76 — no-store, so operator asset swaps take effect on next page load.)

**Path-containment guard for `/branding/*` (from Pitfall 3 and analog logger idiom):**
```typescript
router.get("/branding/*", async (req, res) => {
  const requested = req.params[0]; // path after /branding/
  const baseDir = getBrandingAssetsDir(); // /etc/skynet/branding
  const resolved = path.resolve(baseDir, requested);
  // ASVS V5/V12: reject any path that escapes the base dir
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    return res.status(400).end();
  }
  // Per-file fallback per D-04
  try {
    await fs.access(resolved);
    return res.sendFile(resolved, {
      headers: { "Cache-Control": "public, max-age=300" }, // short cache; operator-controlled
    });
  } catch {
    // Fallback to bundled default
    const defaultPath = path.resolve(getBundledDefaultsDir(), requested);
    if (!defaultPath.startsWith(getBundledDefaultsDir() + path.sep)) {
      return res.status(400).end();
    }
    try {
      await fs.access(defaultPath);
      return res.sendFile(defaultPath, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    } catch {
      return res.status(404).end();  // NOT 500 — per Pitfall 7-adjacent, no filesystem paths in error responses
    }
  }
});
```

**No auth** — do NOT import `AuthManager` / `authenticateJWT`. Match `usage.ts` L23-25 (no auth imports at all). Contrast with `global-files.ts` L28-39 which DOES pull in `AuthManager.getInstance().createAuthMiddleware()` — the branding routes are pre-login surfaces so they follow `usage.ts` not `global-files.ts`.

**Export pattern** (line 63 of analog):
```typescript
export default router;
```

---

### `src/ui/branding/branding-store.ts` (frontend module singleton, pub-sub)

**Analog:** `src/ui/state/session-tmux-store.ts` (verified 2026-09-03)

**Copy the module-header comment-block shape** (lines 1-30 of analog):
- Purpose ("module-scoped in-memory store for the branding config; sourced exclusively from the /api/branding fetch at boot")
- Storage layer (in-memory only, page refresh triggers a re-fetch)
- Notify-guard note (single writer at boot, so the guard is trivial — one publish per lifecycle)

**Imports pattern** (line 32):
```typescript
import { useSyncExternalStore } from "react";
```
(No React Context wrappers. Research L46, L201 says: "There are ZERO React Context providers used for app-scoped state in the codebase — all shared state is `useSyncExternalStore` singletons in `src/ui/state/`. Adding a Context would introduce a wrapper hierarchy for one value.")

**State + listeners pattern** (lines 34-62 verbatim):
```typescript
type BrandingConfig = {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
};

// Initial value: bundled-default sentinel so first-paint is defensible even
// before the fetch lands (Pitfall 5 mitigation).
let state: BrandingConfig = {
  appName: "Skynet",
  shortName: "Skynet",
  iconPath: "/branding/icon.png",
  wordmarkPath: "/branding/wordmark.png",
  faviconPath: "/branding/favicon.svg",
  pwaIcons: [
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};

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
```

**Publish pattern** (adapted from L83-112 shape — simpler because there's one global object, not a Map):
```typescript
export function publishBrandingConfig(next: BrandingConfig): void {
  // Reference-equality no-op: if the fetched config is identical to the
  // current state, skip notify. Prevents notify storm from any refresh path.
  // (Compare by JSON.stringify or deep-eq helper; branding config is tiny.)
  if (JSON.stringify(state) === JSON.stringify(next)) return;

  console.info({
    operation: "branding_config_publish",
    previous: state.appName,
    next: next.appName,
  });

  state = next;
  notify();
}
```

**Hook pattern** (adapted from L156-164 shape):
```typescript
export function useBrandingConfig(): BrandingConfig {
  const getSnapshot = (): BrandingConfig => state;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```
Note: unlike `useSessionTmuxName(key)` which is per-key, this is a single global read — same `useSyncExternalStore` shape but with a trivial `getSnapshot` returning the whole object.

**Test-only helper** (lines 188-193 style):
```typescript
export function __resetForTest(): void {
  state = getBundledDefaultsSentinel();
  notify();
}
```

**Adaptation notes vs. analog:**
- The analog uses a Map (many entries, per-key notify). Branding is a single global object → no Map, just replace `state` wholesale.
- The analog has separate `publish` and `publishGone` writers. Branding has only `publishBrandingConfig` — the config never "goes away" (fallback is a bundled default, not absence).
- Structured `console.info` on every transition per fleet-directive T-41-04 (analog L100-106).

---

### `src/ui/branding/branding-fetch.ts` (or inline in `main.tsx`)

**Analog:** `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx` L96-111 (verified 2026-09-03)

**Pre-login fetch pattern:**
```typescript
async function fetchBrandingConfig(): Promise<void> {
  try {
    const res = await fetch("/api/branding");
    if (!res.ok) return;  // non-2xx: retain bundled defaults, do not clear
    const json = (await res.json()) as BrandingConfig;
    publishBrandingConfig(json);
  } catch {
    // Network error: silently retain bundled defaults
  }
}
```
(Plain `fetch()`, no `authApi` — matches `WeeklyUsageMeter.tsx` L99 which also runs pre-login. Contrast with `global-files-api.ts` which uses `authApi` because it's authenticated.)

**Where to call it — `src/main.tsx` L261 (verified):**
Current shape:
```typescript
prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(<StrictMode>...</StrictMode>);
});
```

Adaptation: kick off branding fetch in parallel with `prepareClientCacheVersion()`. Do NOT gate render on it (that would delay first paint) — the store's initial state is the bundled-default sentinel, so first paint is already defensible.

```typescript
// Kick off in parallel; do NOT await before render (initial state = defaults sentinel).
void fetchBrandingConfig();

prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(...);
});
```

Alternatively (safer for iOS PWA install / first-paint favicon consistency):
```typescript
Promise.all([prepareClientCacheVersion(), fetchBrandingConfig()]).finally(() => {
  createRoot(...).render(...);
});
```
Planner picks; both are viable. Recommendation per research L263: parallel with `prepareClientCacheVersion`.

---

### `src/ui/branding/apply-favicon.ts` (optional split)

**Analog:** `src/ui/AppShell.tsx` L613-624 (verified — document.title effect pattern)

**Existing pattern (AppShell L615):**
```typescript
document.title =
  identity?.displayName || tmux || activeTab?.label || "SKYNET";
```
Direct imperative DOM assignment inside an effect. No `react-helmet`.

**Adaptation for favicon:**
```typescript
export function useBrandingFavicon(): void {
  const branding = useBrandingConfig();
  useEffect(() => {
    // Update all <link rel="icon"> tags in <head>.
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    for (const link of links) {
      link.href = branding.faviconPath;
    }
  }, [branding.faviconPath]);
}
```
Call from a top-level component that's always mounted (e.g. `App()` in `main.tsx`, or `AppShell`). Do NOT put in a route-specific component — the favicon must apply pre-login too.

---

### `docker/branding-defaults/*` (bundled assets)

**Analogs:** `public/icon.png`, `public/skynet-wordmark.png`, `public/manifest.webmanifest` (existing static assets)

**Recommended structure (research L412-420):**
```
docker/branding-defaults/
├── branding.json           # {"appName":"Skynet","shortName":"Skynet",...}
├── icon.png                # copy of public/icon.png
├── wordmark.png            # copy of public/skynet-wordmark.png
├── favicon.svg             # copy or convert public/favicon.ico
├── pwa-icon-192.png        # copy of public/apple-touch-icon-192.png
└── pwa-icon-512.png        # copy of public/apple-touch-icon-512.png
```

**branding.json contents (mirrors `public/manifest.webmanifest` shape, extended per D-03):**
```json
{
  "appName": "Skynet",
  "shortName": "Skynet",
  "iconPath": "/branding/icon.png",
  "wordmarkPath": "/branding/wordmark.png",
  "faviconPath": "/branding/favicon.svg",
  "pwaIcons": [
    {"src": "/branding/pwa-icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "/branding/pwa-icon-512.png", "sizes": "512x512", "type": "image/png"}
  ]
}
```

---

### `docker/nginx.conf` (modify — 2 new blocks + 1 existing block flipped)

**Analog block 1 (proxy_pass):** existing `/api/usage` at L900-909 (verified):
```nginx
# WEEKLY-METER-03 (plan 260729-1vd): usage collector proxy — same block in nginx-https.conf.
# Proxied to the Node backend; the backend proxies tailnet-only 100.113.23.63:9421.
location = /api/usage {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Analog block 2 (path-prefix proxy):** existing `/users/sessions` at L105-112:
```nginx
location ~ ^/users/sessions(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
}
```

**Three edits required:**

1. **Add `= /api/branding` block** (place next to `/api/usage` at L900+):
```nginx
# Phase 70: branding config JSON — mirrors block in nginx-https.conf.
location = /api/branding {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

2. **Add `~ ^/branding(/.*)?$` block** (place adjacent):
```nginx
# Phase 70: branding assets — mirrors block in nginx-https.conf.
location ~ ^/branding(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

3. **REPLACE existing `= /manifest.webmanifest` block at L71-78** — currently serves static; flip to proxy_pass:
```nginx
# Phase 70: dynamic manifest — replaces prior static-serve block.
# Backend generates from branding config; nginx must proxy_pass rather than
# try_files. Mirrors block in nginx-https.conf.
location = /manifest.webmanifest {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
(Old lines 71-78 to be deleted and replaced with the above. Cache-Control is now set by the backend, which returns `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` — same value as the old static-serve headers at L67, L76.)

---

### `docker/nginx-https.conf` (modify — parallel edits)

**Same three edits as `docker/nginx.conf`**, at parallel locations:
- Add `= /api/branding` block next to existing `/api/usage` at L884-893
- Add `~ ^/branding(/.*)?$` block adjacent
- Replace existing `= /manifest.webmanifest` block at L82-89 with proxy_pass form (identical to nginx.conf edit)

**Comment convention** (mirrors L884 in nginx-https.conf and L900 in nginx.conf):
```nginx
# Phase 70: branding config JSON — mirrors nginx.conf block exactly.
```

**Load-bearing note:** BOTH files must be edited in the same commit. Precedent — three prior features all encoded this in comments:
- `usage.ts` L16-18
- `database.ts` L1858-1859 (skills-editor)
- `database.ts` L1871-1872 (relay-pointer)

---

### `docker/Dockerfile` (modify — add COPY layer)

**Analog:** existing `COPY --chown=node:node --from=frontend-builder /app/dist /app/html` at L77 (verified).

**Add one COPY line** in Stage 5 (Final image) after the existing `COPY --from=frontend-builder` at L77:
```dockerfile
COPY --chown=node:node docker/branding-defaults /app/branding-defaults
```
(No stage dependency — the branding-defaults dir is source-tree state, not a build product. Copy directly from build context.)

---

### `docker/docker-compose.yml` (modify — add bind-mount volumes)

**Analog:** existing `skynet-data:/app/data` at L8-9 (verified). Current shape:
```yaml
    volumes:
      - skynet-data:/app/data
```

**Add two bind-mounts** using long-form syntax to enable `create_host_path: true` (per research Approach A, L377-381):
```yaml
    volumes:
      - skynet-data:/app/data
      - type: bind
        source: /opt/skynet/branding.json
        target: /etc/skynet/branding.json
        read_only: true
        bind:
          create_host_path: true
      - type: bind
        source: /opt/skynet/branding
        target: /etc/skynet/branding
        read_only: true
        bind:
          create_host_path: true
```
Rationale: t1000 has no config file, but Docker default behavior is to fail-start when a bind source is missing. `create_host_path: true` (Compose spec 3.4+) creates an empty file/dir on first start; backend then reads it, gets ENOENT-or-empty, falls back to bundled defaults per the loader pattern above.

---

### `src/backend/database/database.ts` (modify — mount branding routes)

**Analog:** existing mount line `app.use("/api/usage", usageRoutes);` at L1877.

**Insert three lines** between `app.use("/voice", voiceRoutes);` (L1879) and `const frontendDistPaths = [...]` (L1881), matching the comment idiom of `/api/usage` (L1875-1876):
```typescript
// Phase 70: branding config + assets — unauthenticated (pre-login surface).
// Matching /api/branding, /branding/*, and /manifest.webmanifest nginx blocks
// in BOTH docker/nginx.conf AND docker/nginx-https.conf (see CLAUDE.md nginx caveat).
app.use(brandingRoutes);
```
(Assumes `branding-routes.ts` mounts all three paths on a single router with absolute paths. Alternatively three `app.use()` calls with specific mounts.)

**Do NOT insert inside the `if (frontendDist) { ... }` block** at L1891 — must be BEFORE the static middleware or Express-static would intercept `/branding/*` files if the operator happens to place a file named `branding/…` under `/app/html/` (unlikely but per Pitfall 7 the ordering discipline is load-bearing).

**Import addition (top of database.ts, alongside existing route imports):**
```typescript
import brandingRoutes from "./branding/branding-routes.js";
```

---

### `src/ui/AppShell.tsx` (modify — three "SKYNET" replacements)

**Target sites (verified):**

1. **L232** — initial dashboard tab label:
```typescript
label: "SKYNET",
```
Replace with:
```typescript
label: brandingConfig.appName,
```

2. **L616** — document.title fallback chain:
```typescript
document.title =
  identity?.displayName || tmux || activeTab?.label || "SKYNET";
```
Replace `"SKYNET"` with `brandingConfig.appName`.

3. **L1569** — tab reset on close:
```typescript
label: "SKYNET",
```
Replace with `brandingConfig.appName`.

**How to source `brandingConfig`:** Add near the top of the `AppShell` function (~L225):
```typescript
const brandingConfig = useBrandingConfig();
```

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (modify — header wire-through)

**Target site (verified L1489-1497):**
```tsx
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

**Replace with (per research L328-339):**
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

**Remove `SkynetLogo` import at L135:**
```typescript
import SkynetLogo from "./SkynetLogo";  // DELETE if no other uses
```
(Verify with grep — file has other components but confirm SkynetLogo isn't used elsewhere in this file before deleting the import.)

**Source `brandingConfig`:** add at top of `PrettyConversationsPanel` function:
```typescript
const brandingConfig = useBrandingConfig();
```

**Preserve** CSS classes `pv-header-logo` and `pv-header-wordmark` for styling continuity (research L340).

---

### `src/ui/auth/Auth.tsx` (modify — login header wire-through)

**Target site (verified L1131-1142):**
```tsx
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

**Replace with:**
```tsx
<img
  src={brandingConfig.iconPath}
  alt=""
  className="h-12 w-12 shrink-0"
  draggable={false}
/>
<img
  src={brandingConfig.wordmarkPath}
  alt={brandingConfig.appName}
  className="h-8 w-auto"
  draggable={false}
/>
```

**Source `brandingConfig`:** add at top of the component holding this render (probably `AuthContent` or similar). Adding `const brandingConfig = useBrandingConfig();` inside the component that owns the L1131 render is enough; branding-store is a pre-login surface so no auth gating needed.

**Note:** Unlike the conversation-header switch (SVG → img), the login switch is img → img (just changes the `src`). Bundled default should be a copy of `public/icon.png` per research L406-408 recommendation — this preserves the current login look on a no-config deploy while allowing operator override.

**DO NOT touch** `LoginPage.tsx` — verified dead code (research L288-291 and Pitfall 10). All the "SKYNET" strings and `document.title` writes in LoginPage.tsx are red herrings.

---

### `index.html` (modify — minimal; per D-09 mostly untouched)

**Target sites (verified):**
- L16: `<meta name="apple-mobile-web-app-title" content="SKYNET" />` — leave; static, only affects PWA install screens; apple-touch-icon deferred per D-10
- L17-21: apple-touch-icon links — leave (D-10 deferred)
- L22-23: `<link rel="icon" ... href="/favicon-32.png?v=logov2" />` — leave hrefs; will be overwritten imperatively by `apply-favicon` effect after boot fetch
- L24: `<link rel="manifest" href="/manifest.webmanifest" />` — leave, already present per D-09
- L25: `<title>SKYNET</title>` — leave per D-09 ("overwritten by branding fetch before any user sees it")

**No edits required to index.html** for MVP scope — the branding wire-through works entirely through the imperative DOM updates from the branding store.

---

## Shared Patterns

### Module-header doc-block convention
**Source:** `src/backend/database/routes/global-files-config-loader.ts` L1-29, `src/backend/database/routes/usage.ts` L1-21
**Apply to:** All new backend files
**Shape:**
```typescript
/**
 * Phase [X] ([FEATURE-TAG]): [One-line purpose].
 *
 * [What it reads/writes, where paths live, mount point.]
 *
 * Error handling:
 *   - [ENOENT / missing → normal state description]
 *   - [Parse error → log + fallback]
 *   - [This function never throws; all failure modes return the safe default.]
 *
 * [Auth statement, if applicable.]
 * [CLAUDE.md nginx caveat reminder, if applicable.]
 *
 * Mount: app.use("/[path]", [routerName]) in database.ts.
 */
```

### Structured logging via `sshLogger`
**Source:** `src/backend/utils/logger.ts` (verified live), used throughout `global-files-config-loader.ts` L88-92, L102-106, L114-118, L131-135
**Apply to:** All new backend files (loader + routes)
**Shape:**
```typescript
sshLogger.error("<file-name>: <what-failed>", {
  operation: "<snake_case_op_name>",
  error: err instanceof Error ? err.message : String(err),
  path: configPath,   // or other relevant context
});
```
Never throw to the client — log + return safe default. This is the recovery contract Phase 23 established and every subsequent backend file follows it.

### Frontend structured `console.info` on state transitions
**Source:** `src/ui/state/session-tmux-store.ts` L100-106, L133-138
**Apply to:** `src/ui/branding/branding-store.ts`
**Shape:**
```typescript
console.info({
  operation: "<snake_case_op_name>",
  previous: <old-value>,
  next: <new-value>,
  // ...other context
});
```
Console-forwarder (`src/main.tsx` L24) picks these up automatically and batches them to `/debug/console-log` — no additional logger setup needed.

### CLAUDE.md nginx caveat (load-bearing convention)
**Source:** In-code comments at three sites, all identical shape:
- `src/backend/database/routes/usage.ts` L16-18
- `src/backend/database/database.ts` L1858-1859 (skills-editor route)
- `src/backend/database/database.ts` L1871-1872 (relay-pointer route)

**Apply to:** Every new backend route module AND the mount site in database.ts

**Rule:** Any new backend route with a URL prefix not already covered by an nginx `location` block requires matching blocks added in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` in the same commit. Encode this in a comment adjacent to the mount + at the top of the route file so future maintainers cannot miss it.

**Recommended comment text (adapts existing convention):**
```typescript
// Phase 70: matching /api/branding, /branding/*, and /manifest.webmanifest
// location blocks in BOTH docker/nginx.conf AND docker/nginx-https.conf are
// load-bearing — the last one REPLACES the prior static-serve block.
```

### Never-throws + empty-state fallback contract
**Source:** `src/backend/database/routes/global-files-config-loader.ts` full file
**Apply to:** `src/backend/branding/branding-config-loader.ts`, `src/backend/branding/branding-routes.ts`
**Rule:** Backend loaders return a well-formed default on any error (ENOENT / parse-error / shape-invalid / size-cap). Backend routes wrap the loader in a try that also has a fallback (belt-and-suspenders). Frontend surfaces render defensibly even when the fetch fails or is in-flight (initial store state = bundled-default sentinel).

### Path-containment defense for user-controlled path segments
**Source:** Research Pitfall 3, Security Domain V5/V12; no existing analog in-repo (this is a new pattern for Phase 70)
**Apply to:** `src/backend/branding/branding-routes.ts` `/branding/*` handler
**Rule:**
```typescript
const resolved = path.resolve(baseDir, userInput);
if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
  return res.status(400).end();
}
```
Standard `path.resolve` + `startsWith` guard. Reject with 400 on escape. No filesystem paths in error responses (V13).

### Cache-Control headers by route type
**Source:** Existing patterns in `docker/nginx.conf` L60, L67, L87, L95; `database.ts` L1903, L1912
**Apply to:** All new branding routes

| Route | Cache-Control | Reason |
|-------|--------------|--------|
| `/api/branding` | `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` | Operator may swap; short TTL |
| `/manifest.webmanifest` | `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` | Matches prior static-serve headers; PWA install pickup |
| `/branding/*` | `public, max-age=300` | Short cache (5 min) — operator-controlled; do NOT use `immutable` |

Do NOT match the `max-age=31536000, immutable` used for `/assets/*` in database.ts L1903 — branding assets are mutable at operator will.

---

## No Analog Found

**None.** Every file has an exact-role or role-match analog. This phase is entirely a wiring exercise on top of the existing stack (research L215).

The only new pattern that is truly new to the repo is the path-containment guard for `/branding/*` (V5/V12 defense), but that is a well-documented Node.js one-liner and does not require an in-repo analog.

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` (loader + route module patterns)
- `src/ui/state/` (frontend store patterns)
- `src/ui/features/pretty-conversations/` (pre-login fetch + header render targets)
- `src/ui/auth/` (login header render target)
- `src/ui/AppShell.tsx` (tab-title fallback chain, document.title effect)
- `src/main.tsx` (boot-time fetch integration point)
- `docker/` (Dockerfile, nginx configs, docker-compose.yml)
- `public/` (existing static asset filenames for bundled-default sourcing)
- `index.html` (root HTML target)

**Files scanned:** 15 analog files read; 3 grep passes for cross-reference (t/loginTitle, SKYNET literals, useSyncExternalStore imports).

**Pattern extraction date:** 2026-09-03

**Sources verified in this pass:**
- `src/backend/database/routes/global-files-config-loader.ts` (full file)
- `src/backend/database/routes/usage.ts` (full file)
- `src/ui/state/session-tmux-store.ts` (full file)
- `src/ui/state/identities-store.ts` L1-100 (variant with async initial fetch)
- `src/backend/database/routes/global-files.ts` L1-60 (authed variant, contrast)
- `src/backend/database/database.ts` L1800-1932 (route mounts + static middleware structure)
- `docker/nginx.conf` L50-140, L895-916 (static-file blocks + /api/usage proxy)
- `docker/nginx-https.conf` L70-100, L880-901 (parallel structure)
- `docker/Dockerfile` (full file)
- `docker/docker-compose.yml` (full file)
- `index.html` (full file)
- `public/manifest.webmanifest` (full file)
- `src/ui/AppShell.tsx` L225-240, L608-624, L1560-1580 (three SKYNET target sites)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L130-140, L1483-1502 (header render target + import)
- `src/ui/features/pretty-conversations/SkynetLogo.tsx` (full file — the SVG being replaced)
- `src/ui/auth/Auth.tsx` L1125-1145, L1308-1320 (login header target; confirmed no live `auth.loginTitle` usage in Auth.tsx)
- `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx` L90-120 (pre-login fetch pattern)
- `src/main.tsx` (full file — boot integration point)
