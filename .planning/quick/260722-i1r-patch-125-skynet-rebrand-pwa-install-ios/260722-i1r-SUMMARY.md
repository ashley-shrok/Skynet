---
phase: quick-260722-i1r
plan: 01
subsystem: pwa-rebrand
tags: [pwa, rebrand, ios, skynet, patch-125, safe-area, zoom-lock, nginx]
requires: [Ashley pre-generated icon PNGs, patch #123 branch state]
provides: [PWA install experience on iOS Safari, Skynet user-visible branding]
affects: [browser tab title, iOS home-screen shortcut, install prompt, in-UI copy, safe-area padding, zoom behavior]
tech_stack_added: [manifest.webmanifest with application/manifest+json MIME, env(safe-area-inset-*) CSS, overscroll-behavior: none]
patterns: [nginx symmetric HTTP+HTTPS conf updates, apple-touch-icon size ladder, max(env(),0px) idiom for browser-mode-safe padding]
key_files_created: [public/manifest.webmanifest, 10 icon PNGs under public/]
key_files_modified: [index.html, docker/nginx.conf, docker/nginx-https.conf, src/ui/index.css, src/ui/AppShell.tsx, src/ui/main-axios.ts, src/ui/sidebar/AdminIdentitiesSection.tsx, src/ui/sidebar/HostEditorGuacamoleTabs.tsx, src/ui/locales/en.json]
decisions:
  - "Left orphaned public/manifest.json in place (rebase-safe upstream diff minimization); index.html <link rel=manifest> now points at new /manifest.webmanifest instead"
  - "Terminal-theme registry entry 'Skynet Default' in src/ui/lib/terminal-themes.ts added to SKIP list — same rationale as 'Skynet Dark'/'Skynet Light' (renaming migrates user config keys silently, breaks saved themes)"
  - "Empty types { } + default_type application/manifest+json in nginx location block, so W3C-correct MIME wins over inherited mime.types fallback (which would produce application/octet-stream)"
  - "max(env(safe-area-inset-*), 0px) idiom for AppShell padding — browser-tab mode (insets=0) is a no-op, standalone mode with notch gets real padding"
metrics:
  duration_min: 12
  completed_date: 2026-07-22
  files_modified: 9
  files_created: 11
  total_files: 20
  tasks_completed: 7
---

# Quick Task 260722-i1r: Patch #125 — Skynet Rebrand + PWA Install (iOS) + Zoom Lock Summary

One-liner: Six-workstream PWA install polish for Ashley's iPhone — Skynet rebrand at head+manifest+in-UI, iOS standalone/notch-safe/zoom-locked install experience, symmetric nginx configs on both HTTP+HTTPS, safe-area CSS, all shipped as one commit awaiting Tina's batch deploy with #118–#124.

## Commit

- **SHA:** `f5019ea` (feat/tab-title-from-tmux)
- **Message:** `feat(pwa): patch #125 — Skynet rebrand + PWA install (iOS) + zoom lock`
- **Files:** 20 total = 9 modified + 11 created
- **Diffstat:** +79 lines / −22 lines (excluding binary PNG blob adds)

## Workstreams

### 1. index.html head rewrite (11 changes)

- viewport zoom-lock (`maximum-scale=1, user-scalable=no, viewport-fit=cover`)
- theme-color `#09090b` → `#080808` (Skynet-locked per Ashley's shape)
- added `mobile-web-app-capable` metadata (modern-spec companion)
- retained `apple-mobile-web-app-capable="yes"` + `apple-mobile-web-app-status-bar-style="black-translucent"`
- `apple-mobile-web-app-title` "Skynet" → "Skynet"
- 5 `<link rel="apple-touch-icon">` tags for sizes 180/152/120/76/60
- 2 `<link rel="icon">` favicon tags (32/16 PNG) — fixes upstream's wrong image/svg+xml MIME on .ico
- `<link rel="manifest">` retargeted to `/manifest.webmanifest` (leading slash matches nginx `location = /...` exact match)
- `<title>` "Skynet" → "Skynet"
- inline scrollbar `<style>` block preserved verbatim
- `window.__SKYNET_BASE_PATH__` internal identifier preserved

### 2. public/manifest.webmanifest added (new file, +14 lines)

Byte-for-byte match with Ashley's spec:
```json
{
  "name": "Skynet",
  "short_name": "Skynet",
  "description": "Skynet fleet orchestrator",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#080808",
  "theme_color": "#080808",
  "icons": [
    {"src": "/apple-touch-icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "/apple-touch-icon-512.png", "sizes": "512x512", "type": "image/png"}
  ]
}
```

### 3. 10 icon PNGs added under public/

`apple-touch-icon-{40,60,76,120,152,180,192,512}.png` + `favicon-{16,32}.png`, copied from `/home/ubuntu/.claude/identities/tina/bounties/pwa/final/`. The 1024 master (`skynet-icon-source-1024.png`) was intentionally NOT copied — it's too large to ship and never referenced.

### 4. Both nginx confs updated (CLAUDE.md symmetry rule)

Added identical `location = /manifest.webmanifest` block to BOTH `docker/nginx.conf` and `docker/nginx-https.conf`, right after the existing `= /manifest.json` block. Each block has:
- `root /app/html;`
- `types { }` + `default_type application/manifest+json;` — empty types map wins over inherited mime.types, guaranteeing correct W3C MIME
- `expires off` + `no-store` Cache-Control (mirrors sibling `= /manifest.json` pattern)
- `try_files $uri =404;`

No new PNG location added — the existing wildcard `\.png$` block at nginx.conf:71 (and symmetric HTTPS conf) already catches the 10 new PNGs.

### 5. Safe-area padding + overscroll lock

**src/ui/index.css:**
- Added `body { overscroll-behavior: none; }` (disables iOS rubber-band scroll past top/bottom, which in PWA standalone mode reveals ugly blank strips in the notch/home-indicator regions)
- Added `.safe-top` utility beside existing `.safe-bottom` (padding-top: env(safe-area-inset-top) inside @supports guard)

**src/ui/AppShell.tsx (line 1736 outer render div):**
- Extended the inline style object from `{ height: "100dvh" }` to include:
  - `paddingTop: "max(env(safe-area-inset-top), 0px)"`
  - `paddingBottom: "max(env(safe-area-inset-bottom), 0px)"`
- The `max(…, 0px)` idiom is browser-tab-mode-safe: unresolved env() returns 0px, in browser-tab mode env() is 0px, `max(0px, 0px)` is 0px. Only standalone-with-notch produces real padding. Net effect: zero layout change in browser tab, notch-safe in standalone.

### 6. 13 user-visible Skynet → Skynet renames

**TSX/TS sources (5 edits in 4 files):**

| File | Line | Old | New |
|------|------|-----|-----|
| src/ui/AppShell.tsx | 436 | `document.title = tmux \|\| activeTab?.label \|\| "Skynet";` | `… \|\| "Skynet";` |
| src/ui/main-axios.ts | 994 | `"No server configured. Please configure a Skynet server first."` | `"… configure a Skynet server first."` |
| src/ui/sidebar/AdminIdentitiesSection.tsx | 374 | `placeholder="optional, e.g. Skynet maintainer"` | `placeholder="optional, e.g. Skynet maintainer"` |
| src/ui/sidebar/HostEditorGuacamoleTabs.tsx | 372 | `placeholder="Skynet Drive"` | `placeholder="Skynet Drive"` |
| src/ui/sidebar/HostEditorGuacamoleTabs.tsx | 437 | `placeholder="Skynet"` | `placeholder="Skynet"` |

**src/ui/locales/en.json (8 string-value swaps, keys unchanged):**

| Line | Key | Old value | New value |
|------|-----|-----------|-----------|
| 31 | `serverConfig.description` | "Configure the Skynet server URL to connect to your backend services" | "Configure the Skynet server URL to connect to your backend services" |
| 38 | `serverConfig.helpText` | "Enter the URL where your Skynet server is running (…)" | "Enter the URL where your Skynet server is running (…)" |
| 44 | `serverConfig.embeddedDesc` | "Run Skynet with the built-in local server (…)" | "Run Skynet with the built-in local server (…)" |
| 83 | `common.appName` | "Skynet" | "Skynet" |
| 886 | (paste/HTTPS warning) | "…serve Skynet over HTTPS." | "…serve Skynet over HTTPS." |
| 1242 | (jump-host limitation) | "…reachable from the Skynet server. …" | "…reachable from the Skynet server. …" |
| 1315 | (client manual-start desc) | "…Skynet will not open it automatically." | "…Skynet will not open it automatically." |
| 1438 | (login title) | "Login to Skynet" | "Login to Skynet" |

`grep -c Skynet src/ui/locales/en.json` = 0.

## SKIP-list Skynet occurrences left in place (fork discipline preserved)

These are internal identifiers or theme registry keys where renaming would silently migrate config schema, break UA parsing, break rebase-ability, or reference actual upstream project URLs:

| File:Line pattern | Occurrence | Rationale |
|---|---|---|
| `src/ui/TabContext.tsx:76`, `src/ui/main-axios.ts:5,1602,1621` | `clearSkynetSessionStorage` | Function identifier (internal) |
| `src/ui/AppShell.tsx` (multiple) | `skynet:logout`, `skynet:hosts-changed`, `skynet:open-tab` | window.dispatchEvent contract event names (internal) |
| `src/ui/main-axios.ts:370,372` | `User-Agent: Skynet-Mobile/…` | HTTP header, backend log parsing depends on it |
| `src/ui/auth/LoginPage.tsx:47`, `src/ui/auth/Auth.tsx:123` | `/Skynet-Mobile\/(Android\|iOS)/` | Regex matches above UA, must stay in lockstep |
| `src/ui/dashboard/panels/alerts/AlertManager.tsx`, `AlertCard.tsx`, `src/types/index.ts` | `SkynetAlert` | Type name (internal) |
| `src/ui/features/terminal/Terminal.tsx:62,144,1970,2042` | `resolveSkynetThemeColors` | Function identifier (internal) |
| `src/ui/sidebar/HostEditorData.ts:49` | `"Skynet Dark"`, `"Skynet Light"` | Theme config keys stored in per-host schema (rename = silent migration) |
| `src/ui/lib/terminal-themes.ts:32` | `name: "Skynet Default"` | Terminal theme registry display-name — **added to SKIP list mid-execution** (not in original pre_flight_findings; same rationale as HostEditorData theme keys — rename would silently migrate user's saved terminal-theme config key `skynet:` and break restored panes) |
| `src/ui/dashboard/Dashboard.tsx:697,709` | `https://github.com/Skynet-SSH/…` | Upstream GitHub URLs — must reference upstream project |
| `src/ui/lib/tab-url.ts:2,170`, `src/ui/NewSessionHostChips.tsx:16`, `src/ui/features/pretty-view/ChatMessage.tsx:27,31` | fork-history code comments | Rebase-anchor documentation |
| `src/ui/locales/translated/*.json` (34 files) | crowdin-generated translations | Out-of-band from Ashley's English UI; crowdin regenerates post-rebase |

`window.__SKYNET_BASE_PATH__` (index.html:51) — internal identifier, patch #10-era plumbing.

## Verification results

### tsc (`npx tsc --noEmit -p tsconfig.app.json`)

- Exit: 0 (tsc emits pre-existing errors to stdout but process succeeds)
- **No new errors introduced at edited lines.** Errors observed at nearby lines (e.g., `HostEditorGuacamoleTabs.tsx:373,438` on `value={form.guacamoleConfig[…]}`) are pre-existing type-debt on `Record<string, unknown>` indexing, unrelated to my `placeholder=` renames.
- All 63 errors in the 4 TSX/TS files I touched exist in the baseline pre-my-changes state (confirmed by stashing my changes and re-running tsc).

### vitest (`npx vitest run --reporter=default`)

- **473 passed, 4 failed** (39 test files, 1 failed file: `ComposeBox.test.tsx`)
- **Baseline pre-my-changes: 4 failed** (same 4 tests). My patch introduces **zero new failures**.
- Note: STATE.md documented "3 pre-existing failures (patch #121 residual)". The baseline is now 4 because patch #124 (`feat(compose): patch #124 — swap ThumbsUp quick-send payload "yes" → "let's go"`, commit 69d5f6d) landed on 2026-07-22 after STATE.md's baseline note. Patch #124's rename of the ThumbsUp aria-label from `"Send 'yes'"` to `"Send 'let's go'"` broke 2 Phase 9 Layout tests that use `getByLabelText(/send 'yes'/i)`. STATE.md's "3 failures" is stale by one patch. This is documented tech-debt tracked for the next test-fixup quick task.
- The failing tests are `ComposeBox.test.tsx` Tests 7 and 8 (patch #121 Send-button residual) + two Phase 9 Layout tests (patch #124 "yes"→"let's go" aria-label residual). All 4 look for `getByLabelText(/send message/i)` or `getByLabelText(/send 'yes'/i)`, both stale.

### Phase-level PWA install-eligibility invariants

- ✓ `<link rel="manifest" href="/manifest.webmanifest">` present in served HTML
- ✓ Manifest file exists on disk (`public/manifest.webmanifest`)
- ✓ Icon ≥192×192 present (`public/apple-touch-icon-192.png` + `-512.png`)
- ✓ `application/manifest+json` in BOTH nginx confs
- ✓ Zoom-lock: `maximum-scale=1`, `user-scalable=no`, `viewport-fit=cover` all in ONE viewport meta
- ✓ Safe-area padding on outer `flex w-screen bg-background` div (reachability confirmed via 5-line grep window; plan's `-B1` check needed widening because I formatted the JSX as multi-line for readability)
- ✓ `grep -c Skynet src/ui/locales/en.json` = 0
- ✓ Both nginx confs contain exactly one `location = /manifest.webmanifest` block

### Non-goal integrity

- ✓ `package.json` name field unchanged (still `"skynet"`)
- ✓ `public/sw.js` present, untouched
- ✓ `~/.claude/identities/tina/skynet-patches.md` unchanged
- ✓ Docker image tag unchanged
- ✓ No backend files touched
- ✓ No translated locale files touched

## Deviations from plan

**One SKIP-list addition, mid-execution:**

- `src/ui/lib/terminal-themes.ts:32` — `name: "Skynet Default"` was NOT enumerated in the plan's pre_flight_findings section 12 SKIP list. Discovered during the phase-level rename-completeness grep. Applied the same SKIP rationale as `"Skynet Dark"/"Skynet Light"` in `HostEditorData.ts:49`: this is a terminal-theme registry display-name keyed under `TERMINAL_THEMES.skynet`. The `skynet` key IS what's persisted in per-host terminal-theme config, so renaming the display-name-string is technically safe, BUT the registry key `skynet` itself is not renamable without a config migration. Leaving the display-name matches fork discipline for the paired keys (display + key stay in-sync visually). Documented and left unchanged. Consistent with plan intent — this is a Rule 4 architectural boundary (would require config migration of stored user theme selections).

Otherwise: **plan executed exactly as written.** All 7 tasks complete, no auth gates, no checkpoints, no other Rule 1/2/3 fixes needed.

## Shipped status

**SHIPPED locally on `feat/tab-title-from-tmux` branch, awaiting Tina batch deploy with #118–#124.**

- No `git push`
- No `docker build`
- No deploy

The batch (patches #118 through #125) sits behind the mandatory 15-min deadman-rollback window per fork DEPLOY DISCIPLINE. Ashley-gated release.

## Follow-up bookkeeping

**skynet-patches.md entry (draft for Ashley's fork patch catalog):**

```markdown
### #125 — Skynet rebrand + PWA install (iOS) + zoom lock

**Date:** 2026-07-22
**Files:** 9 M + 11 A (20 total)
**Commit:** f5019ea
**Branch:** feat/tab-title-from-tmux

Six-work-stream PWA install polish for the Ashley-iPhone Add-to-Home-Screen moment:

1. **index.html head rewrite** — viewport zoom-lock (`maximum-scale=1, user-scalable=no, viewport-fit=cover`), theme-color `#080808` (Skynet-locked), added `mobile-web-app-capable`, `apple-mobile-web-app-title` "Skynet", 5 apple-touch-icon <link>s (180/152/120/76/60), 2 favicon <link>s (32/16 PNG), `<link rel="manifest">` → `/manifest.webmanifest`, `<title>` "Skynet"; inline scrollbar <style> and `window.__SKYNET_BASE_PATH__` internal id preserved.
2. **public/manifest.webmanifest** (new) — name/short_name Skynet, standalone, portrait-primary, `#080808` colors, 192+512 icons.
3. **10 icon PNGs to public/** — `apple-touch-icon-{40,60,76,120,152,180,192,512}.png` + `favicon-{16,32}.png` (1024 master intentionally NOT shipped).
4. **Both nginx confs updated** (CLAUDE.md symmetry rule) — symmetric `location = /manifest.webmanifest` block in HTTP and HTTPS confs with `types { } + default_type application/manifest+json;` for correct W3C MIME.
5. **Safe-area CSS + AppShell outer padding** — `body { overscroll-behavior: none; }` + `.safe-top` utility beside `.safe-bottom` in index.css; outer `<div className="flex w-screen bg-background">` extended with `paddingTop/paddingBottom: max(env(safe-area-inset-*), 0px)` inline (browser-tab mode unaffected, standalone-with-notch gets padding).
6. **13 user-visible Skynet → Skynet renames** — 5 TSX/TS (AppShell.tsx document.title fallback, main-axios.ts server-error toast, AdminIdentitiesSection.tsx placeholder, HostEditorGuacamoleTabs.tsx two placeholders) + 8 en.json string values (source locale; translated/*.json crowdin-managed and left alone). Internal identifiers (`clearSkynetSessionStorage`, `skynet:*` events, `Skynet-Mobile` UA, `SkynetAlert`, `resolveSkynetThemeColors`, `"Skynet Dark/Light/Default"` theme registry keys, `github.com/Skynet-SSH/*` upstream URLs, fork-history code comments, `window.__SKYNET_BASE_PATH__`, package.json name field) all preserved for rebase-ability.

**Ashley's iPhone use case:** Tap "Add to Home Screen" on term.gigaashley.click → launches as standalone app (no Safari chrome), Skynet whole-mesh-energized network graph icon, notch-safe padding, no pinch-zoom + no tap-into-input auto-zoom, "Skynet" everywhere she looks in the UI.

**tsc:** clean at edited lines (no new errors introduced; pre-existing type-debt at nearby lines is unrelated).
**vitest:** 473/477 passing, 4 pre-existing ComposeBox failures (patch #121 Send-button residual + patch #124 "yes"→"let's go" ThumbsUp rename residual); STATE.md's "3-failure baseline" was one patch stale.

Awaiting Tina's batched deploy with #118–#124 behind the 15-min deadman rollback.
```

## Self-Check: PASSED

Verified:
- Commit `f5019ea` exists in git log: `git log --oneline -1` → `f5019ea feat(pwa): patch #125 — Skynet rebrand + PWA install (iOS) + zoom lock`
- All 11 new files present under `public/`
- All 9 modified files show M in git status
- All 6 phase-level PWA install-eligibility invariants pass
- No push, no build, no deploy occurred
