---
phase: 260906-mwq-branding-favicon-coverage-gap-extend-bac
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/branding/branding-routes.ts
  - src/backend/branding/branding-routes.test.ts
  - docker/nginx.conf
  - docker/nginx-https.conf
  - src/main.tsx
  - src/ui/AppShell.tsx
autonomous: true
requirements:
  - BOUNTY-BFCG-01  # Lift useBrandingFavicon() so operator faviconPath overrides apply pre-login
  - BOUNTY-BFCG-02  # Extend backend cascade to serve 7 size-suffixed favicon + apple-touch URLs from operator mount
  - BOUNTY-BFCG-03  # Nginx routing: ensure the 7 new URLs reach Express (not caught by /app/html static-serve)

must_haves:
  truths:
    - "On the login page (pre-login, unauthenticated), the browser tab icon reflects operator branding.faviconPath (not the fork's /favicon-32.png default) when a branding config is present."
    - "When /etc/skynet/branding/favicon-16.png (or favicon-32, apple-touch-icon-60/76/120/152/180) exists, the corresponding public URL serves the operator override bytes."
    - "When no operator override exists for a size-suffixed favicon / apple-touch-icon, the response is byte-identical to what nginx served pre-change from /app/html/<filename> (no visible change for no-config deployments — D-14 parity)."
    - "useBrandingFavicon() runs exactly once per app lifecycle (not double-rewriting head links)."
    - "apply-favicon.ts's 'apple-touch-icon links are intentionally left alone' invariant is preserved — the runtime hook still only rewrites <link rel='icon'>; the backend serves the overridden apple-touch bytes at the SAME public URL."
  artifacts:
    - path: "src/backend/branding/branding-routes.ts"
      provides: "7 new Express GET routes (/favicon-16.png, /favicon-32.png, /apple-touch-icon-{60,76,120,152,180}.png) that resolve via override → bundled-default → next() (nginx/static fallthrough)."
      contains: "resolveAssetPath"
    - path: "src/backend/branding/branding-routes.test.ts"
      provides: "Smoke coverage for the 7 new routes — either data-driven table test or per-URL cases; the test asserts (a) router matches (non-fallthrough-404 from Express) and (b) missing/present cascade branches behave as documented."
      contains: "favicon-16"
    - path: "docker/nginx.conf"
      provides: "New location block that proxies the 7 URLs to 127.0.0.1:30001 with priority over the L86 `\\.(js|css|png|...)$` static-serve regex."
      contains: "apple-touch-icon-"
    - path: "docker/nginx-https.conf"
      provides: "Mirror of the docker/nginx.conf block — CLAUDE.md parity rule."
      contains: "apple-touch-icon-"
    - path: "src/main.tsx"
      provides: "useBrandingFavicon() call site inside App() component so the hook mounts on BOTH the Auth (login) and AppShell (post-login) branches."
      contains: "useBrandingFavicon"
    - path: "src/ui/AppShell.tsx"
      provides: "AppShell.tsx no longer imports or calls useBrandingFavicon (call was lifted to main.tsx)."
      not_contains: "useBrandingFavicon"
  key_links:
    - from: "docker/nginx.conf (new favicon block, placed ABOVE line 86)"
      to: "127.0.0.1:30001 (Express)"
      via: "proxy_pass"
      pattern: "proxy_pass http://127.0.0.1:30001"
    - from: "src/backend/branding/branding-routes.ts (new handlers)"
      to: "resolveAssetPath in branding-config-loader.ts"
      via: "override → bundled-default cascade"
      pattern: "resolveAssetPath"
    - from: "src/backend/branding/branding-routes.ts (new handlers)"
      to: "Express static middleware for frontendDist (/app/html)"
      via: "next() when both override and bundled-default are missing"
      pattern: "return next\\(\\)"
    - from: "src/main.tsx App() component"
      to: "useBrandingFavicon hook"
      via: "top-level call inside App() — mounts on both Auth + AppShell branches"
      pattern: "useBrandingFavicon\\(\\)"
---

<objective>
Close the two branding-favicon coverage gaps filed in bounty `branding-favicon-coverage-gap` as a SINGLE atomic quick task:

**Gap 1 (frontend):** `useBrandingFavicon()` is called inside `AppShell.tsx` (line 242), which only mounts post-login — so on the login page, the fork's hardcoded `/favicon-32.png` wins over `branding.faviconPath`. Lift the hook up one level to `App()` in `src/main.tsx`, which wraps BOTH `<Auth>` and `<AppShell>`. Remove the redundant call from AppShell.

**Gap 2 (backend + nginx):** The existing Phase 70 `resolveAssetPath()` cascade only covers `/branding/*` URLs (base `faviconPath`, `iconPath`, `wordmarkPath`, pwa icons). The 7 size-suffixed URLs hardcoded in `index.html` (`/favicon-16.png`, `/favicon-32.png`, `/apple-touch-icon-{60,76,120,152,180}.png`) are served by nginx directly from `/app/html/` via the `\.(js|css|png|...)$` regex at `nginx.conf:86` — Express never sees them, so no operator override is possible. Extend the backend cascade to those 7 URLs AND add matching nginx location blocks in both `nginx.conf` + `nginx-https.conf` that proxy_pass to Express with priority over the L86 static-serve regex.

Purpose: Full operator rebrand of every favicon surface (including pre-login) without fork changes. Preserves D-14 parity — a no-operator-config deployment continues to serve the fork's `public/*.png` bytes byte-for-byte.

Output: 7 new Express routes + 2 nginx blocks + 1 hook-site move. No changes to `index.html`, no changes to `docker/branding-defaults/branding.json`, no changes to `apply-favicon.ts` semantics (apple-touch invariant preserved).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

## Executor scope + guardrails (READ BEFORE EDITING)

- **STOP LINE:** Code + commit + scoped tests green — STOP. NO `git push`, NO `docker build`, NO `docker compose up`. The bounty orchestrator picks up after.
- **Scoped tests only:**
  - `cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/branding/branding-routes.test.ts`
  - Do NOT run the full suite (that's the orchestrator's ship gate).
- **Backend typecheck gate (mandatory before commit — `tsc --noEmit` on frontend tsconfig is NOT enough):**
  - `cd /home/ubuntu/skynet-tabitha && npm run build:backend && npm run build`
  - Both must succeed. Backend changes have burned twice on this in prior work.
- **No worktrees.** Work in the main tree at `/home/ubuntu/skynet-tabitha` on the current branch `feat/tab-title-from-tmux`.
- **Commit style:** match recent log (see `git log --oneline -5`) — `fix(...)`, `feat(...)`, `copy(...)`. Cite bounty slug `branding-favicon-coverage-gap` in the commit BODY.
- **Bounty timeline updates:** as you work, append entries to `~/.claude/roles/box-maintainer/bounties/branding-favicon-coverage-gap/bounty.json` `timeline[]`, tick relevant `todos[]`, bump `updated_at` (use ISO8601 UTC — today is 2026-09-06). Do NOT set `status: "done"` unless every todo is ticked or explicitly deferred with rationale in the timeline.
</execution_context>

<context>
@.planning/quick/260906-mwq-branding-favicon-coverage-gap-extend-bac/260906-mwq-PLAN.md

# Bounty framing (required reading)
@$HOME/.claude/roles/box-maintainer/bounties/branding-favicon-coverage-gap/bounty.json

# Backend cascade — the pattern to extend
@src/backend/branding/branding-routes.ts
@src/backend/branding/branding-routes.test.ts
@src/backend/branding/branding-config-loader.ts

# Frontend hook site — the call to lift
@src/ui/branding/apply-favicon.ts
@src/main.tsx

# Hardcoded link tags (READ-ONLY — do not modify)
@index.html

# Nginx routing (critical — L86 regex catches all .png from /app/html)
@docker/nginx.conf
@docker/nginx-https.conf
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend backend cascade to 7 size-suffixed favicon + apple-touch URLs (with nginx routing + tests)</name>
  <files>
    src/backend/branding/branding-routes.ts,
    src/backend/branding/branding-routes.test.ts,
    docker/nginx.conf,
    docker/nginx-https.conf
  </files>
  <behavior>
    Per-URL cascade behavior for each of the 7 new routes (`/favicon-16.png`, `/favicon-32.png`, `/apple-touch-icon-60.png`, `/apple-touch-icon-76.png`, `/apple-touch-icon-120.png`, `/apple-touch-icon-152.png`, `/apple-touch-icon-180.png`):

    - **Test A (override present):** When `/etc/skynet/branding/<filename>` exists → response is 200 with `Cache-Control: public, max-age=300` (matches existing `ASSET_CACHE` for `/branding/*`) and the body is the override bytes. Use a temp dir + monkey-patch of `getBrandingAssetsDir` OR mount the router with a stubbed resolver — mirror whatever pattern already exists in the repo; if no pattern exists, keep the assertion at "route matched and returned 200/404-from-handler, not 404-from-express-fallthrough" (mirrors the existing `branding-routes.test.ts` smoke shape at line 32-61).
    - **Test B (both override and bundled-default missing):** Response FALLS THROUGH to the next Express middleware (via `next()`). The test asserts the route calls `next()` — the simplest realization: mount the router, then mount a sentinel middleware after it that returns a distinctive status (e.g. `res.status(299).end()`); a 299 response proves the branding route delegated correctly.
    - **Test C (smoke — route registration):** All 7 URLs are registered — extend the existing "imports and mounts without throwing" test OR add a parametric assertion that each URL matches the router (analogous to the existing `/branding/nonexistent.png` test at line 32).

    Nginx test is NOT in scope for vitest — the nginx block is verified by shape (grep + comment referencing bounty) and by the orchestrator's deploy smoke.
  </behavior>
  <action>
Implement the backend cascade + nginx routing in three sub-steps (all in one task, one commit):

**(1) Backend — extend `src/backend/branding/branding-routes.ts`:**

Add a single helper `serveCascadeAsset(filename, req, res, next)` that:
  - Calls `resolveAssetPath(filename)` (imported from `./branding-config-loader.js` — already imported at line 40-43).
  - If `resolved.source === "override"` OR `resolved.source === "default"` → set `Cache-Control: ASSET_CACHE`, `res.sendFile(resolved.path, ...)` with the same error-log-and-500 handler shape as the existing `/branding/*splat` handler (lines 153-165).
  - If `resolved.source === "missing"` → **call `next()`** so Express's downstream static middleware for `frontendDist` (`/app/html/`) serves the fork's baked-in `public/<filename>` copy. This preserves D-14 parity: no-config deploys behave exactly as before.
  - If `resolveAssetPath` throws (path-containment escape — cannot happen for these hardcoded filenames but keep parity with `/branding/*` handler): log via `sshLogger.error` and return `res.status(400).end()`. This branch is defensive; the 7 filenames are literals so escape is unreachable, but symmetry with the existing handler is the cheaper design.

Register the 7 routes as a compact loop OR seven explicit `router.get()` calls — either is fine, pick the shape that reads best next to the existing `/api/branding` + `/manifest.webmanifest` + `/branding/*splat` handlers. The filename list (source of truth for both routes and tests):

  - `favicon-16.png`
  - `favicon-32.png`
  - `apple-touch-icon-60.png`
  - `apple-touch-icon-76.png`
  - `apple-touch-icon-120.png`
  - `apple-touch-icon-152.png`
  - `apple-touch-icon-180.png`

Route path is the same as the filename with a leading `/` (e.g. `/favicon-16.png`). MIME type is set by `res.sendFile()` from the file extension (identical semantics to the existing `/branding/*splat` handler at lines 127-166 — no manual `Content-Type` needed).

Add a header block comment above the new routes explaining:
  - Why these 7 URLs need explicit routes (`index.html` hardcodes them at the root path — bypass the `/branding/*` pattern).
  - Why the missing-fallthrough is `next()` rather than 404: the fork ships `public/*.png` defaults that must remain the last-resort fallback for no-config deploys (D-14 parity).
  - The nginx-parity requirement: matching location blocks live in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` — updates to this route list REQUIRE nginx updates (mirrors the analogous CLAUDE.md warning already at lines 13-20 of the file for `/api/branding`, `/branding/*`, and `/manifest.webmanifest`).
  - Bounty slug citation: `branding-favicon-coverage-gap`.

**(2) Tests — extend `src/backend/branding/branding-routes.test.ts`:**

Add a new `describe("branding-routes size-suffixed favicon cascade", ...)` block. Structure:
  - A shared `FAVICON_URLS = [...]` array (source-of-truth match with the router file — 7 strings).
  - Test 1: parametric `it.each(FAVICON_URLS)("registers %s", ...)` — analog of the existing L32-61 smoke test. Mount the router in an Express app + issue a GET; assert the status is one of `[200, 400, 500, 299]` (the 299 sentinel proves next-fallthrough; other codes prove the branding handler responded). Fails ONLY on Express's default 404 (route didn't match).
  - Test 2: fallthrough sentinel — mount the router, then mount `(req, res) => res.status(299).end()`. For a URL where neither `/etc/skynet/branding/<filename>` nor `/app/branding-defaults/<filename>` exists (both are absent in the test environment — no fs mocking needed), assert the response is 299. This proves the cascade correctly delegates via `next()` in the missing branch.

Keep the test flat and small — mirror the existing 62-line file's minimalism. Do NOT introduce fs mocking, temp dirs, or module-mock harnesses unless a helper for that already exists in `src/backend/`.

**(3) Nginx — add matching location blocks to BOTH `docker/nginx.conf` and `docker/nginx-https.conf`:**

In `docker/nginx.conf`: add a new `location ~` block **ABOVE the existing extension regex at line 86** (`location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$`). Nginx evaluates regex `location` blocks in file order and stops at the first match, so file-order matters — the new block must appear FIRST. The block:

    # branding-favicon-coverage-gap: size-suffixed favicons + apple-touch icons
    # go through Express so the branding-config override cascade
    # (branding-routes.ts) can serve /etc/skynet/branding/<filename> when
    # present, falling back to the fork's /app/html/<filename> defaults via
    # Express static middleware (next() branch). MUST appear ABOVE the
    # `\.(js|css|png|...)$` regex below or nginx serves /app/html/*.png
    # directly and Express never sees these URLs. Mirror in nginx-https.conf.
    location ~ ^/(favicon-(16|32)\.png|apple-touch-icon-(60|76|120|152|180)\.png)$ {
        proxy_pass http://127.0.0.1:30001;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

Mirror the identical block into `docker/nginx-https.conf` in the analogous position (above the sibling `\.(js|css|png|...)$` regex). Both `.conf` files MUST stay in sync per CLAUDE.md's nginx parity rule.

Do NOT modify `location = /manifest.webmanifest` (already correct), do NOT modify `location ^~ /branding/` (already correct), do NOT modify `index.html`, do NOT modify `docker/branding-defaults/branding.json`, do NOT ship new files into `docker/branding-defaults/` — the fork's `public/*.png` files ARE the default-fallback layer (served by nginx via the extension regex once Express calls `next()`).

**(4) Verify + commit:**

Run `npm run build:backend && npm run build` — both must succeed. Run `npx vitest run src/backend/branding/branding-routes.test.ts` — all cases green. Commit with:

    fix(branding-routes): cascade override→default→next for size-suffixed favicons + apple-touch icons

    Extends the Phase 70 branding-config cascade to the 7 favicon URLs
    hardcoded in index.html (previously served straight from /app/html/
    with no operator-override path). Backend routes call next() on
    missing so the fork's public/*.png defaults remain the last-resort
    fallback (D-14 parity for no-config deploys). Adds matching nginx
    location blocks above the ~*\.png regex in both nginx.conf and
    nginx-https.conf so Express sees these URLs before the static-serve
    catches them.

    Bounty: branding-favicon-coverage-gap
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tabitha && npm run build:backend && npm run build && npx vitest run src/backend/branding/branding-routes.test.ts</automated>
  </verify>
  <done>
    - `npm run build:backend` exits 0.
    - `npm run build` exits 0.
    - `npx vitest run src/backend/branding/branding-routes.test.ts` — all describe/it blocks green (existing 2 + new cases).
    - `grep -c "apple-touch-icon-180" docker/nginx.conf` returns >= 1.
    - `grep -c "apple-touch-icon-180" docker/nginx-https.conf` returns >= 1.
    - `grep -n "favicon-16" src/backend/branding/branding-routes.ts` shows the new route(s) registered.
    - `git diff --stat` shows exactly 4 files changed (routes.ts, routes.test.ts, nginx.conf, nginx-https.conf).
    - Commit created with `fix(branding-routes): ...` subject and `Bounty: branding-favicon-coverage-gap` in body.
    - Bounty JSON `timeline[]` appended with a "backend cascade + nginx routing landed" entry; `todos[]` entries for backend-cascade + scoped-tests ticked; `updated_at` bumped.
  </done>
</task>

<task type="auto">
  <name>Task 2: Lift useBrandingFavicon() from AppShell (post-login only) to App() in main.tsx (pre + post login)</name>
  <files>
    src/main.tsx,
    src/ui/AppShell.tsx
  </files>
  <action>
Move the `useBrandingFavicon()` hook call from `src/ui/AppShell.tsx:242` up to the `App()` component in `src/main.tsx` so it mounts on BOTH the login screen (`<Auth>`) and the in-app screen (`<AppShell>`).

**(1) `src/main.tsx`:**

Add import near the existing branding import at line 20:

    import { useBrandingFavicon } from "@/branding/apply-favicon";

Inside the `App()` component (declared at line 107), add the hook call BEFORE the existing `useState`/`useRef` lines — hook order is preserved as long as the call is unconditional and top-level. The natural spot is line ~108, just after the `function App() {` opening brace:

    function App() {
      // branding-favicon-coverage-gap: called here (not inside AppShell) so
      // the operator's branding.faviconPath overrides <link rel="icon">
      // hrefs on BOTH the login (<Auth>) and post-login (<AppShell>)
      // branches. Previously scoped to AppShell → login page always
      // rendered the fork's hardcoded /favicon-32.png default.
      useBrandingFavicon();
      const stored = getStoredAuth();
      // ... existing body unchanged ...
    }

Do NOT put it in `RootApp()` — `RootApp` short-circuits to `<FullscreenApp>` for `?view=` URLs (line 243-249) and to `<ElectronVersionCheck>` for the Electron gate (line 251-256); neither branch needs favicon rewrites and calling the hook there would run it on those screens too (harmless but out of scope). `App()` is the correct mount site — it renders `<Auth>` + `<AppShell>` and nothing else.

`FullscreenApp` (line 90) does NOT need the hook — those `?view=terminal|rdp|vnc|telnet` popouts already render a bare full-screen surface; changing their favicon is out of scope for this bounty.

**(2) `src/ui/AppShell.tsx`:**

- Remove the import at line 17: `import { useBrandingFavicon } from "@/branding/apply-favicon";`
- Remove the call at line 242: `useBrandingFavicon();`
- Update the comment block at lines 234-241 — remove the "useBrandingFavicon() has no return value — it runs a useEffect keyed on faviconPath that rewrites <link rel='icon'> hrefs. Placed in AppShell so the favicon applies pre-login too (AppShell is mounted throughout the auth + post-auth lifecycle)." sentences (that claim is now false — AppShell only mounts post-login). Keep the sentences about `useBrandingConfig()` since that IS still used at line 241.
- Leave `useBrandingConfig()` at line 241 alone — it's independently needed for `brandingConfig.appName`.

Double-check no other AppShell code path calls `useBrandingFavicon()` — grep `useBrandingFavicon` in `src/ui/AppShell.tsx` after the edit should return 0 matches.

**(3) `src/ui/branding/apply-favicon.ts` — NO CODE CHANGE, but verify the header comment invariants:**

Read lines 30-31 of `src/ui/branding/apply-favicon.ts`. The comment says "The apple-touch-icon links are intentionally left alone per D-10 (deferred as low-value MVP scope)." — this invariant is preserved (we did NOT ask the hook to touch apple-touch links). The backend cascade in Task 1 serves overridden apple-touch bytes at the SAME public URLs, so runtime rewriting is unnecessary. Update the comment at lines 12-15 IF it references AppShell as the call site (currently says "The recommended site (per plan output handoff notes) is inside AppShell..." at line 12-14) — change to reference `App()` in `main.tsx` instead, cite bounty `branding-favicon-coverage-gap`. This is a documentation-only edit; adjust the `files` field of this task to include `src/ui/branding/apply-favicon.ts` if you make the comment edit.

**(4) Verify + commit:**

Run `npm run build` — must succeed (no `build:backend` needed for a frontend-only change; the previous task's backend commit already validated backend types). Run scoped tests IF `apply-favicon` or `AppShell` have any test files — `find /home/ubuntu/skynet-tabitha/src -name 'AppShell.test*' -o -name 'apply-favicon.test*' 2>/dev/null` returned zero at plan time, so likely no scoped tests exist for this leg; if the find still returns nothing after the edit, that's fine — the frontend build's tsc pass is the acceptance gate.

Commit:

    fix(main): lift useBrandingFavicon() out of AppShell so login screen honors operator faviconPath

    AppShell only mounts post-login, so useBrandingFavicon() there
    never runs on the /login route — the fork's hardcoded
    /favicon-32.png default won and no operator branding-config
    override reached the browser tab pre-auth. Lifting the call to
    App() in main.tsx (which wraps both <Auth> and <AppShell>) fixes
    the pre-login gap. AppShell's redundant call is removed to avoid
    double head-rewrites. apply-favicon.ts's apple-touch invariant
    is preserved — the backend cascade (previous commit) serves
    overridden apple-touch bytes at the SAME public URLs, so no
    runtime rewrite of <link rel='apple-touch-icon'> is needed.

    Bounty: branding-favicon-coverage-gap
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tabitha && npm run build && grep -c "useBrandingFavicon" src/ui/AppShell.tsx | grep -q '^0$' && grep -c "useBrandingFavicon" src/main.tsx | awk '$1 >= 2 { exit 0 } { exit 1 }'</automated>
  </verify>
  <done>
    - `npm run build` exits 0.
    - `grep -c "useBrandingFavicon" src/ui/AppShell.tsx` returns 0 (import + call both removed).
    - `grep -c "useBrandingFavicon" src/main.tsx` returns >= 2 (one import + one call).
    - `grep "useBrandingFavicon()" src/main.tsx` shows the call is inside `function App()` (not inside `RootApp` or `FullscreenApp`).
    - `git diff --stat` shows 2 files changed (main.tsx + AppShell.tsx) OR 3 if the apply-favicon.ts comment was also updated.
    - Commit created with `fix(main): ...` subject and `Bounty: branding-favicon-coverage-gap` in body.
    - Bounty JSON `timeline[]` appended with a "hook lifted to App() in main.tsx" entry; `todos[]` entry for the hook-lift + "verify apply-favicon.ts invariant" both ticked; `updated_at` bumped.
    - Every bounty `todos[]` entry now ticked EXCEPT the "Executor stops at code + commit + scoped tests green" one — that entry is ticked LAST as the final action before executor stops. All 5 todos ticked at handoff.
    - Executor STOPS here. Do NOT `git push`, do NOT `docker build`, do NOT `docker compose up`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → nginx (server) | Public HTTP/HTTPS request path — untrusted URL is the input to nginx location matching. |
| nginx → Express (127.0.0.1:30001) | Trusted internal proxy hop — Express receives the URL path as-is via `proxy_pass`. |
| Express → filesystem (fs.access + res.sendFile) | Trusted internal read; the input URL is one of 7 hardcoded regex-bounded filenames, not user-controlled. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-bfcg-01 | Tampering | New backend routes (path-containment escape via URL) | mitigate | The 7 route paths are LITERAL strings in `router.get()` calls — Express does not pass user-controlled path segments into `resolveAssetPath()` (unlike `/branding/*splat` where the wildcard IS user input). The filenames passed to `resolveAssetPath` are compile-time constants. Path-containment escape is unreachable by construction; the existing 400-on-throw branch is kept only for symmetry with the `/branding/*splat` handler. |
| T-bfcg-02 | Information Disclosure | New backend routes (leaking filesystem paths in errors) | mitigate | Match the existing `/branding/*splat` handler — `sshLogger.error` includes the resolved path server-side, but the response body on error is `res.status(500).end()` with NO body (no fs paths echoed to the client). Same pattern as branding-routes.ts:161. |
| T-bfcg-03 | Denial of Service | New backend routes (unbounded read) | accept | Each route serves a single file bounded by `res.sendFile` (which streams). The 7 filenames map to PNGs whose fork-shipped sizes are all <15 KB (verified `ls -la public/favicon-*.png public/apple-touch-icon-*.png` at plan time returns files <15 KB each). An operator who ships a 100 MB override is DoS'ing themselves — the operator-mount is a trust anchor per the Phase 70 threat model. `Cache-Control: public, max-age=300` further caps requests to 1-per-5-min per client. |
| T-bfcg-04 | Elevation of Privilege | Frontend hook lift (useBrandingFavicon on login screen) | accept | `useBrandingFavicon` runs `document.querySelectorAll('link[rel="icon"]').forEach(l => l.href = branding.faviconPath)`. `branding.faviconPath` is operator-controlled (trusted per Phase 70 threat model T-70-03-04). Setting `<link>.href` is not a script-injection sink — the browser interprets it as a URL, not HTML/JS. No new privilege boundary crossed by running this hook pre-login. |
| T-bfcg-05 | Spoofing | Nginx block matches unintended URLs | mitigate | Regex is anchored `^/(favicon-(16|32)\.png|apple-touch-icon-(60|76|120|152|180)\.png)$` — the trailing `$` prevents suffix-injection (e.g. `/favicon-16.png/../etc/passwd` fails to match). Only the 7 exact filenames route through Express; all other `.png` requests continue through the existing L86 static-serve regex unchanged. |
| T-bfcg-SC | Tampering | npm/pip/cargo installs | mitigate | No new package installs in this plan — all code is added to existing files using existing imports (express, fs, path, sshLogger, resolveAssetPath — all already present in the target files). No `npm install` step; slopcheck N/A. |
</threat_model>

<verification>
## End-to-end phase verification (all four legs, in order)

1. **Backend build:** `cd /home/ubuntu/skynet-tabitha && npm run build:backend` — exits 0.
2. **Frontend build:** `cd /home/ubuntu/skynet-tabitha && npm run build` — exits 0.
3. **Scoped tests:** `cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/branding/branding-routes.test.ts` — all cases green.
4. **Structural greps (proves both fixes landed):**
   - `grep -c "favicon-16" src/backend/branding/branding-routes.ts` >= 1 (backend route registered)
   - `grep -c "apple-touch-icon-180" docker/nginx.conf` >= 1 (nginx block landed)
   - `grep -c "apple-touch-icon-180" docker/nginx-https.conf` >= 1 (nginx-https block landed — parity)
   - `grep -c "useBrandingFavicon" src/ui/AppShell.tsx` == 0 (hook removed from AppShell)
   - `grep -c "useBrandingFavicon" src/main.tsx` >= 2 (import + call present in App())
5. **Git status:** `git log --oneline -3` shows the 2 new commits with `fix(...)` subjects citing `Bounty: branding-favicon-coverage-gap` in bodies.
6. **Bounty timeline:** `jq '.timeline | length, .todos[] | select(.done == false) | .text' ~/.claude/roles/box-maintainer/bounties/branding-favicon-coverage-gap/bounty.json` — timeline has grown by at least 2 entries; all 5 todos ticked (or `.done == false` returns nothing).

## NOT in scope (deferred to orchestrator's ship gate)

- Full test suite run.
- `docker build` / `docker compose up` / deploy to t1000.
- Live in-container HTTP check (`curl -sI http://box/favicon-16.png` returning override bytes) — requires deploy.
- Nginx `nginx -t` syntax check in-container — the diff is a copy-paste of an existing block pattern that already passes; risk is acceptable to defer.
</verification>

<success_criteria>
- Both commits landed on `feat/tab-title-from-tmux` locally (NOT pushed).
- All 7 new Express routes registered; each cascades override → bundled-default → next() on missing.
- Both nginx `.conf` files carry the new location block ABOVE the extension regex — parity confirmed by grep on both files.
- `useBrandingFavicon()` runs from `App()` in `main.tsx`; AppShell no longer imports or calls it.
- `apply-favicon.ts` unchanged in behavior (apple-touch invariant preserved); comment updates optional.
- `npm run build` + `npm run build:backend` both succeed.
- Scoped vitest passes.
- Bounty JSON timeline appended; all 5 todos ticked; `updated_at` bumped; `status` remains `in_progress` unless every todo is genuinely done (which it will be — set to `done` only after ticking the final "executor stops" todo).
- Executor STOPS. Orchestrator picks up for full-suite + deploy.
</success_criteria>

<output>
Create `.planning/quick/260906-mwq-branding-favicon-coverage-gap-extend-bac/260906-mwq-SUMMARY.md` when done, following the standard summary template. Include:
  - The two commit SHAs.
  - Confirmation that both `npm run build:backend` and `npm run build` passed.
  - Scoped vitest output tail (or "N tests passed" line).
  - Confirmation of bounty JSON updates (`jq '.updated_at, (.todos | map(.done) | all)'` output).
  - Explicit "Executor STOPPED per role rule — orchestrator to run full suite + deploy" line.
</output>
