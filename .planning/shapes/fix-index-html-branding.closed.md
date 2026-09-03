# Fix: index.html tab title + iOS install label hardcoded to Skynet

**Opened:** 2026-09-03
**Mode:** fix (follows /close of shape-branding-config with closed-with-misses)

- **Observed wrong:** `index.html` has `<title>SKYNET</title>` and `<meta name="apple-mobile-web-app-title" content="SKYNET" />`. Both are user-visible on rebranded deployments — the browser tab flashes "SKYNET" before the app mounts and swaps `document.title`, and the iOS legacy Add-to-Home-Screen path uses "SKYNET" as the home-screen label.
- **Correct behavior after fix:** Both strings come from the operator's branding config (`appName`) at request time. On a vanilla t1000 deploy with no host config, they resolve to "Skynet" (unchanged). On a rebranded deploy where the config supplies `appName: "Aither Intelligence Plus"`, both strings serve that.
- **Suspected file(s):** `src/backend/database/database.ts` (add index.html interception before the existing SPA fallback + adjust the static middleware to not intercept `index.html` directly). Do not change `index.html` — leave the two "SKYNET" strings as the template source so the file remains valid standalone.

---

## Change made

Created `src/backend/branding/branding-template.ts` — never-throws `getBrandedIndexHtml(frontendDist)` that reads and mtime-caches index.html, then applies the operator's `BrandingConfig.appName` (HTML-escaped) to the two user-visible literals: `<title>SKYNET</title>` and `<meta name="apple-mobile-web-app-title" content="SKYNET" />`. Both substitutions are exact-string, no regex — the internal `window.__SKYNET_BASE_PATH__` on line 59 is deliberately not touched.

Wired into `src/backend/database/database.ts`:
- Added the import.
- Set `index: false` on the frontend `express.static` middleware so `/` no longer serves raw index.html.
- Changed the SPA-fallback middleware from `res.sendFile(index.html)` to `getBrandedIndexHtml(frontendDist)` with a raw-file fallback if the template function returns empty (defense against a missing dist directory).

Added `src/backend/branding/branding-template.test.ts` with 3 tests: substitution happens, no-SKYNET-literals HTML passes through unchanged, missing file returns empty string.

## done

- **Verified locally:** `npx tsc --noEmit` clean; `npx vitest run src/backend/branding/branding-template.test.ts` = 3/3 pass. Substitution is confirmed via unit test; the compiled-in default `appName` = "Skynet" flows through correctly, and a config supplying `appName: "Aither Intelligence Plus"` would flow that string into both surfaces at request time.
- **NOT verified** (deferred to ship gate, same rationale as Plan 70-05): behavior against a running container serving the real dist bundle, or against an actual iOS home-screen install. The unit test proves the templating mechanism; runtime proof of the two user-visible surfaces waits for `docker compose up -d --build` on t1000.
