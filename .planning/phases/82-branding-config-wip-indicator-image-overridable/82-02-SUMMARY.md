---
phase: 82-branding-config-wip-indicator-image-overridable
plan: 02
subsystem: infra
tags: [branding, assets, docker, git-mv, bundled-defaults]

# Dependency graph
requires:
  - phase: 70-branding-config
    provides: "docker/branding-defaults/ bundled-defaults directory + Dockerfile L78 COPY --chown=node:node docker/branding-defaults /app/branding-defaults + resolveAssetPath() bundled-default fallback branch"
provides:
  - "docker/branding-defaults/wip-cube.webp bundled default asset — 1119530 bytes byte-identical to previous public/wip-cube.webp, rename history preserved"
  - "Real file backing Plan 82-01's HARDCODED_FALLBACK.wipIndicatorPath = /branding/wip-cube.webp (resolves via resolveAssetPath() → bundled-default branch instead of returning { source: missing } → 404)"
affects: [82-03-loader-shape-guard, 82-04-wipbubble-rewire]

# Tech tracking
tech-stack:
  added: []
  patterns: ["git mv (not cp+rm) preserves rename history for `git log --follow` walk-through"]

key-files:
  created:
    - docker/branding-defaults/wip-cube.webp
  modified: []
  moved:
    - "public/wip-cube.webp → docker/branding-defaults/wip-cube.webp (git rename, R prefix)"

key-decisions:
  - "Used `git mv` (not cp + git rm) to preserve rename detection — `git log --follow docker/branding-defaults/wip-cube.webp` will walk through the move commit into the pre-move history (Patch #260 / 2026-09-05 canvas→WebP swap)"
  - "Did NOT edit docker/Dockerfile — existing L78 `COPY --chown=node:node docker/branding-defaults /app/branding-defaults` glob-copies the whole directory, so the relocated asset is picked up automatically on next image build"
  - "Did NOT edit any nginx config — `/branding/*` already routes to backend per Phase 70; the SPA fallback path for `/wip-cube.webp` becomes unreachable once Plan 82-04 rewires WipBubble src to `/branding/wip-cube.webp`"

patterns-established:
  - "Relocating a public/-served static asset into docker/branding-defaults/ to make it flow through resolveAssetPath() (override → bundled-default) instead of nginx SPA static-fallback: single `git mv`, zero code/config edits, existing Dockerfile COPY handles container inclusion"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-09-07
---

# Phase 82 Plan 02: Relocate wip-cube.webp to branding-defaults Summary

**Moved `public/wip-cube.webp` → `docker/branding-defaults/wip-cube.webp` via `git mv` to give Plan 82-01's `wipIndicatorPath: "/branding/wip-cube.webp"` default a real file backing the bundled-default branch of `resolveAssetPath()`.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-09-07T10:20:23Z
- **Completed:** 2026-09-07T10:22:00Z
- **Tasks:** 1
- **Files modified:** 1 (rename, byte-identical)

## Accomplishments
- Single atomic `git mv` staged with `R` rename-detection prefix (not `D`+`A` split)
- Byte-count identical pre/post: 1119530 bytes on both sides of the move
- Destination directory (`docker/branding-defaults/`) confirmed to already contain sibling branding assets (branding.json, favicon.svg, icon.png, pwa-icon-192.png, pwa-icon-512.png, wordmark.png) — new asset joins that group cleanly
- Zero Dockerfile edit needed — existing L78 `COPY --chown=node:node docker/branding-defaults /app/branding-defaults` glob-copies the whole directory so relocated file will land at `/app/branding-defaults/wip-cube.webp` inside the container on next image build
- Zero nginx config edit needed — `/branding/*` already routes to backend per Phase 70; both `docker/nginx.conf` and `docker/nginx-https.conf` untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: git mv public/wip-cube.webp → docker/branding-defaults/wip-cube.webp (preserve rename history)** — see final commit hash (chore: 82-02)

**Plan metadata:** SUMMARY.md + STATE.md + ROADMAP.md updates committed in final metadata commit.

## Files Created/Modified

- `docker/branding-defaults/wip-cube.webp` — bundled default WIP indicator asset (moved from `public/wip-cube.webp`, byte-identical 1119530 bytes, git rename history preserved)
- `public/wip-cube.webp` — removed (relocated via `git mv`; no longer exists on disk)

## Decisions Made

None — followed plan as specified. All three "Claude's Discretion" items in 82-CONTEXT.md were for Plan 82-01/03 (schema/loader/test surface), not this plan.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria from `<verify>` and `<acceptance_criteria>` blocks satisfied on first attempt:

- `test -f docker/branding-defaults/wip-cube.webp` → exit 0
- `test ! -e public/wip-cube.webp` → exit 0
- `stat -c '%s' docker/branding-defaults/wip-cube.webp` → 1119530
- `git status --short | grep -c '^R  public/wip-cube.webp -> docker/branding-defaults/wip-cube.webp$'` → 1
- `docker/Dockerfile` not modified (verified — not in git status)
- `docker/nginx.conf` / `docker/nginx-https.conf` not modified (verified — not in git status)

## Issues Encountered

None. Pre-flight checks (source tracked via `git ls-files`, dest dir exists, dest file absent) all passed on first inspection; `git mv` succeeded on first invocation with expected `R` rename prefix in `git status --short`.

## User Setup Required

None — no external service configuration required. Change ships in the next Docker image build with no operator action.

## Next Phase Readiness

**Ready for Plan 82-03 (loader/shape-guard extension) and Plan 82-04 (WipBubble.tsx rewire):**

- The bundled default asset is in place. Once Plan 82-01 lands `HARDCODED_FALLBACK.wipIndicatorPath = "/branding/wip-cube.webp"` and Plan 82-03 wires the shape guard, `GET /branding/wip-cube.webp` will hit `resolveAssetPath("wip-cube.webp")` → override check at `/etc/skynet/branding/wip-cube.webp` (not present on stock deploys) → bundled-default branch → serve `/app/branding-defaults/wip-cube.webp` (this file).
- Once Plan 82-04 flips `WipBubble.tsx` src from hardcoded `/wip-cube.webp` (currently served by nginx SPA static fallback out of `public/`) to `wipIndicatorPath` from `useBrandingConfig()`, the WIP indicator continues to work byte-identically on stock deployments AND becomes operator-overridable.
- No blockers. Zero-risk plan; no code paths touched.

## Self-Check: PASSED

- `docker/branding-defaults/wip-cube.webp` — verified present (`test -f`)
- `public/wip-cube.webp` — verified absent (`test ! -e`)
- Rename detection — verified (`git status --short` shows `R ` prefix, single entry)
- Byte-count — verified (1119530 both sides)

---
*Phase: 82-branding-config-wip-indicator-image-overridable*
*Completed: 2026-09-07*
