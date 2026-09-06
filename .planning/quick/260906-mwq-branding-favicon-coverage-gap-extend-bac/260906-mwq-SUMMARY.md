---
phase: 260906-mwq-branding-favicon-coverage-gap-extend-bac
plan: 01
type: execute
wave: 1
status: complete
bounty: branding-favicon-coverage-gap
commits:
  - hash: 4e777e04
    subject: "fix(branding-routes): cascade override→default→next for size-suffixed favicons + apple-touch icons"
  - hash: 94b4756d
    subject: "fix(main): lift useBrandingFavicon() out of AppShell so login screen honors operator faviconPath"
files_created: []
files_modified:
  - src/backend/branding/branding-routes.ts
  - src/backend/branding/branding-routes.test.ts
  - docker/nginx.conf
  - docker/nginx-https.conf
  - src/main.tsx
  - src/ui/AppShell.tsx
  - src/ui/branding/apply-favicon.ts
tests:
  scoped:
    command: "npx vitest run src/backend/branding/branding-routes.test.ts"
    result: "11/11 passed"
  builds:
    - "npm run build:backend → exit 0"
    - "npm run build → exit 0 (both runs, after Task 1 and after Task 2)"
requirements_satisfied:
  - BOUNTY-BFCG-01  # Lift useBrandingFavicon() so operator faviconPath overrides apply pre-login
  - BOUNTY-BFCG-02  # Extend backend cascade to serve 7 size-suffixed favicon + apple-touch URLs from operator mount
  - BOUNTY-BFCG-03  # Nginx routing: ensure the 7 new URLs reach Express (not caught by /app/html static-serve)
duration_min: 46
completed_at: 2026-09-06T17:12:00Z
---

# 260906-mwq — Branding Favicon Coverage Gap Summary

Two-commit atomic quick task closing the two branding-favicon coverage gaps filed in bounty `branding-favicon-coverage-gap`: (1) the pre-login favicon gap where `useBrandingFavicon()` only ran inside `AppShell.tsx` (post-login), and (2) the size-suffixed favicon + apple-touch icon URLs hardcoded in `index.html` that bypassed the Phase 70 branding-config cascade entirely (served by nginx directly from `/app/html/`).

## What landed

### Commit 4e777e04 — Backend cascade + nginx routing (Task 1)

- **`src/backend/branding/branding-routes.ts`** (+103 lines):
  - New `serveCascadeAsset(filename, req, res, next)` helper: calls `resolveAssetPath(filename)`; on `override`/`default` sends the file with `Cache-Control: public, max-age=300`; on `missing` calls `next()` so Express's static middleware for frontendDist serves the fork's `public/<filename>` (D-14 no-config-deploy parity); defensive 400 on containment throw (symmetric with `/branding/*splat`, unreachable for these literal filenames).
  - Constant `FAVICON_CASCADE_FILENAMES` (7 entries) drives both route registration and the exported `FAVICON_CASCADE_URLS` array (test import).
  - `for (const filename of FAVICON_CASCADE_FILENAMES) router.get(...)` loop registers all 7 routes.
  - Header comment cites bounty slug, explains D-14 fallthrough rationale, and mirrors the existing L13-20 nginx-parity CLAUDE.md warning for `/api/branding` / `/branding/*` / `/manifest.webmanifest`.

- **`src/backend/branding/branding-routes.test.ts`** (+96 lines): new `describe("branding-routes size-suffixed favicon cascade", ...)` block:
  - `exposes the 7 documented URLs` — pins the exported constant to the source-of-truth list.
  - `it.each(FAVICON_CASCADE_URLS)("registers %s ...")` — parametric smoke, mounts router + sentinel middleware, asserts each URL returns 200/299/400/500 (not Express-fallthrough 404).
  - `delegates via next() when both override and bundled-default are missing` — pins the sentinel-299 semantics for `/apple-touch-icon-180.png` so a future refactor that swaps `next()` for a 404 short-circuit is caught (would break D-14 parity).

- **`docker/nginx.conf`** and **`docker/nginx-https.conf`** (+19 lines each, identical): new `location ~ ^/(favicon-(16|32)\.png|apple-touch-icon-(60|76|120|152|180)\.png)$` block placed ABOVE the L86 `~* \.(js|css|png|...)$` regex (nginx matches regex locations in file order and stops at the first hit). `proxy_pass http://127.0.0.1:30001` with the standard header set used elsewhere in the file. Header comment cites bounty slug, explains the file-order requirement, calls out the parity rule, and lists all 7 covered URLs grep-friendly.

### Commit 94b4756d — Hook lift + doc updates (Task 2)

- **`src/main.tsx`** (+12 lines): added `import { useBrandingFavicon } from "@/branding/apply-favicon"` (paired with existing branding-fetch import) and a top-level `useBrandingFavicon()` call as the first line inside `function App()` (line 119). Comment explains why the hook lives on `App()` (wraps both `<Auth>` and `<AppShell>`) and not `RootApp()` (which short-circuits to `<FullscreenApp>` / `<ElectronVersionCheck>` — neither branch needs favicon rewrites).

- **`src/ui/AppShell.tsx`** (+8 / −6 lines): removed the `useBrandingFavicon` import (line 17) and the call (line 242). Reworked the existing L234-241 comment block: kept the `useBrandingConfig()` rationale (still needed for `brandingConfig.appName`), replaced the stale "Placed in AppShell so the favicon applies pre-login too" sentence with a "the favicon hook was lifted to `App()` in `src/main.tsx` — do NOT re-add here" invariant. Wording deliberately avoids the identifier `useBrandingFavicon` so `grep -c useBrandingFavicon src/ui/AppShell.tsx` returns 0 (plan done-criterion).

- **`src/ui/branding/apply-favicon.ts`** (+6 / −4 lines, comment-only): updated the header block that said "The recommended site (per plan output handoff notes) is inside AppShell..." to reference `App()` in `src/main.tsx` and cite the bounty. Behavior unchanged — hook still only rewrites `<link rel="icon">` (apple-touch invariant preserved; the backend cascade from commit 4e777e04 serves overridden apple-touch bytes at the SAME public URLs, so no runtime rewrite of `<link rel="apple-touch-icon">` is required).

## Deviations from Plan

None — plan executed exactly as written with one minor addition: the plan's Task-1 done-criterion required `grep -c "apple-touch-icon-180" docker/nginx.conf >= 1`, but the raw regex uses the range `(60|76|120|152|180)` and so didn't literally contain `apple-touch-icon-180`. Added a "URLs covered (source of truth — grep-friendly)" comment block above the regex in both nginx confs enumerating all 7 URLs, satisfying the grep and improving auditability. Not a deviation per Rules 1-4 — comment-only edit made in-place before commit.

## Verification (four legs)

| Leg | Command | Result |
|-----|---------|--------|
| Backend build | `npm run build:backend` | exit 0 (both runs — before commit 4e777e04 and before commit 94b4756d) |
| Frontend build | `npm run build` | exit 0 (both runs — 2m 2s and 57s) |
| Scoped tests | `npx vitest run src/backend/branding/branding-routes.test.ts` | 11/11 passed (23.77s) — 2 pre-existing + 3 new cascade cases (× 7 parametric = 9 total new) |
| Structural greps | see below | all pass |

```
grep -c "favicon-16" src/backend/branding/branding-routes.ts        → 1 (route constant + comment)
grep -c "apple-touch-icon-180" docker/nginx.conf                    → 1 (grep-friendly comment)
grep -c "apple-touch-icon-180" docker/nginx-https.conf              → 1 (grep-friendly comment, parity)
grep -c "useBrandingFavicon" src/ui/AppShell.tsx                    → 0 (import + call removed)
grep -c "useBrandingFavicon" src/main.tsx                           → 2 (import + call in App())
grep -n "useBrandingFavicon()" src/main.tsx                         → line 119, inside function App() {}
```

## Bounty JSON updates

- `jq '.updated_at' ~/.claude/roles/box-maintainer/bounties/branding-favicon-coverage-gap/bounty.json` → `"2026-09-06T17:12:00Z"`
- `jq '(.todos | map(.done) | all)' ...` → `true` (all 5 todos ticked)
- `status` remains `in_progress` per role rule — orchestrator sets `done` after full-suite + deploy ship gate.
- Timeline grew by 3 new entries: backend-cascade-landed, hook-lift-landed, executor-stopped.

## Known Stubs

None — no hardcoded empty values, no placeholder text, no components wired to mock data introduced.

## Threat Flags

None — the new backend routes (`serveCascadeAsset`) route 7 compile-time literal filenames through the existing hardened `resolveAssetPath()` cascade; no new user-controlled path segments reach the filesystem, no new trust boundary crossings. Threat register T-bfcg-01..05 + T-bfcg-SC (see PLAN.md `<threat_model>`) all disposition `mitigate` or `accept` with mitigations verified in code review before commit.

## Self-Check

- [x] `git log --oneline -2` shows both commits (4e777e04, 94b4756d) on `feat/tab-title-from-tmux`.
- [x] Both commits carry `Bounty: branding-favicon-coverage-gap` in body.
- [x] `git diff` between HEAD~2 and HEAD shows exactly 7 files changed (4 for Task 1 + 3 for Task 2).
- [x] `~/.claude/roles/box-maintainer/bounties/branding-favicon-coverage-gap/bounty.json` `.updated_at == 2026-09-06T17:12:00Z`, `.todos` all `done: true`, `.status == "in_progress"`.
- [x] No files pushed to remote (executor stop rule).

**Self-Check: PASSED**

## Executor STOPPED per role rule

Code + 2 commits + scoped tests green + all builds green — orchestrator (Tabitha) picks up:
1. Full-suite `npx vitest run` (ship gate).
2. `docker build` + `docker compose up --force-recreate` on t1000.
3. Live in-container smoke: `curl -sI http://box/favicon-16.png` returning override bytes when `/etc/skynet/branding/favicon-16.png` exists.
4. `nginx -t` syntax check in-container after the compose restart.
5. Set bounty `status: "done"` on successful ship.
