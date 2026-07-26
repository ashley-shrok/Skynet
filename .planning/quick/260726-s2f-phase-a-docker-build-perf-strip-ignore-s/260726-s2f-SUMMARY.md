---
phase: 260726-s2f
plan: 01
subsystem: docker-build
tags: [docker, buildkit, npm, performance, native-modules, perf]
dependency_graph:
  requires: []
  provides: [optimized-dockerfile, build-timing-logs, bounty-timeline-entry]
  affects: [docker/Dockerfile]
tech_stack:
  added: []
  patterns: [BuildKit cache mounts, postinstall-script-access]
key_files:
  created: []
  modified:
    - docker/Dockerfile
metrics:
  duration: ~40min (including 2 full cold builds + investigation)
  completed: "2026-07-26T20:57:00Z"
  tasks_completed: 2
  files_changed: 1
decisions:
  - "Rule 3 auto-fix: added COPY for all four postinstall patch scripts (patch-app-builder-lib, patch-better-sqlite3, patch-nan) into deps + production-deps stages — required because package.json postinstall runs all four, but only patch-guacamole-lite.cjs was previously COPYed into those stages; without --ignore-scripts the postinstall now runs and fails on the missing scripts"
  - "cpu-features@0.0.10 (ssh2 dependency) has no prebuild-install — always compiles from source via node-gyp rebuild; this is the primary remaining time sink; Phase B (base-image caching) should address it"
  - "better-sqlite3 now uses prebuild-install successfully — node-v137-linux-x64 prebuilt exists and downloads in seconds"
---

# Phase 260726-s2f Plan 01: Docker Build Perf — Strip --ignore-scripts + BuildKit Cache Summary

**One-liner:** Stripped `--ignore-scripts` from both npm ci calls and added BuildKit `--mount=type=cache,target=/root/.npm` to cut fresh Docker build from 11min to 6m41s; warm build now completes in 2s via full layer cache.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Patch docker/Dockerfile | bc8779e | docker/Dockerfile |
| 2 | Measure fresh + warm builds, update bounty timeline | bc8779e | /tmp/deploy-perf-phase-a-build.log, /tmp/deploy-perf-phase-a-build-warm.log, bounty.json |

## Four Dockerfile Edits Applied

**Edit 1 — deps stage npm ci:** Removed `--ignore-scripts`, added `--mount=type=cache,target=/root/.npm`
```
Before: RUN npm ci --ignore-scripts && \
After:  RUN --mount=type=cache,target=/root/.npm npm ci && \
```

**Edit 2 — backend-builder stage:** Deleted `RUN npm rebuild better-sqlite3` (redundant — prebuild-install now runs during npm ci in the deps stage that backend-builder inherits from)

**Edit 3 — production-deps stage npm ci:** Removed `--ignore-scripts`, added `--mount=type=cache,target=/root/.npm`, deleted `npm rebuild better-sqlite3 bcryptjs ssh2` continuation line
```
Before: RUN npm ci --omit=dev --ignore-scripts && \
            node scripts/patch-guacamole-lite.cjs && \
            npm rebuild better-sqlite3 bcryptjs ssh2 && \
            npm cache clean --force
After:  RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && \
            node scripts/patch-guacamole-lite.cjs && \
            npm cache clean --force
```

**Edit 4 (Rule 3 auto-fix) — COPY all four patch scripts into deps + production-deps stages:** The package.json `postinstall` script runs all four patch scripts (`patch-app-builder-lib.cjs`, `patch-guacamole-lite.cjs`, `patch-better-sqlite3.cjs`, `patch-nan.cjs`). Without `--ignore-scripts`, the postinstall now runs and was failing with `MODULE_NOT_FOUND` because only `patch-guacamole-lite.cjs` was COPYed into those isolated stages. Added three additional COPY lines to both stages.

## Build Timings

| Measurement | Time | Log |
|-------------|------|-----|
| Baseline (original Dockerfile) | 11min | /tmp/deploy-14-build.log |
| Fresh (cache-cold) build Phase A | **6m41s real** | /tmp/deploy-perf-phase-a-build.log |
| Cache-warm build Phase A | **2s real** | /tmp/deploy-perf-phase-a-build-warm.log |

**Target ~2-3min fresh: MISSED** — improvement of ~4.5min vs baseline (11min → 6m41s).

## Why Target Was Missed

`cpu-features@0.0.10` (a dependency of `ssh2`) has no `prebuild-install` mechanism — its install script is `node buildcheck.js > buildcheck.gypi && node-gyp rebuild` which always compiles from source. This accounts for approximately 4-5 minutes of the fresh build time.

`better-sqlite3@12.10.0` now successfully uses `prebuild-install` to download the prebuilt `node-v137-linux-x64` binary (Node 24 ABI 137) — this changed from ~5min compilation to seconds.

The `python3 make g++` layer in `deps` and `production-deps` stages is still needed for `cpu-features` compilation. Phase B (base-image caching) should pre-bake node_modules including compiled native modules to address this.

## Verification Confirmed

- `grep -c -- '--ignore-scripts' docker/Dockerfile` returns 0
- No `RUN npm rebuild ...` line remains in docker/Dockerfile
- Exactly two `--mount=type=cache,target=/root/.npm` occurrences, both on npm ci RUN lines
- `docker image inspect skynet-patched-test:local` succeeds (113MB image)
- `docker ps` does NOT show `skynet-patched-test:local` running — build-only, no deploy
- Production container `skynet` running `skynet-patched:local` is healthy and UNCHANGED
- Bounty timeline updated with Phase A measured entry; bounty.json valid JSON

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Added COPY for missing patch scripts in deps + production-deps stages**
- **Found during:** Task 2 (first fresh build attempt failed)
- **Issue:** `npm ci` with `--ignore-scripts` removed triggers `package.json` postinstall which runs `node scripts/patch-app-builder-lib.cjs && ...` — but only `patch-guacamole-lite.cjs` was COPYed into those isolated stages. First build failed with `Error: Cannot find module '/app/scripts/patch-app-builder-lib.cjs'`
- **Fix:** Added `COPY scripts/patch-app-builder-lib.cjs ./scripts/`, `COPY scripts/patch-better-sqlite3.cjs ./scripts/`, `COPY scripts/patch-nan.cjs ./scripts/` to both deps and production-deps stages
- **Files modified:** docker/Dockerfile (included in same commit bc8779e)
- **Note:** The patch scripts handle absent node_modules gracefully (fs.existsSync guards), so adding them to stages where the corresponding dev packages aren't installed is safe

### Fresh Build Time vs Target

The plan targeted ~2-3min fresh build. Actual was 6m41s. This is documented honestly in the bounty timeline with the root cause: `cpu-features@0.0.10` compiles from source unconditionally. Phase B addresses this.

## Known Stubs

None — this plan modifies only the Dockerfile and bounty.json.

## Self-Check: PASSED

- [x] docker/Dockerfile exists and is modified (`git show bc8779e:docker/Dockerfile` confirms changes)
- [x] /tmp/deploy-perf-phase-a-build.log exists, non-empty, contains `real 6m41.000s`
- [x] /tmp/deploy-perf-phase-a-build-warm.log exists, non-empty, contains `real 0m2.000s`
- [x] bounty.json has Phase A measured entry and updated_at bumped to 2026-07-26T20:57:00Z
- [x] `docker image inspect skynet-patched-test:local` succeeds
- [x] `docker ps` does NOT show skynet-patched-test:local running
- [x] Production `skynet` container untouched (still running skynet-patched:local, Up 54+ min, healthy)
- [x] Commit bc8779e verified in git log
