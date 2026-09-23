---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 01
subsystem: infra
tags: [vite, docker, build-id, version-skew, drift-detection]

# Dependency graph
requires: []  # Wave 0 — root of the phase; no prior plans depend on
provides:
  - "CLIENT_BUILD_ID string const at src/ui/lib/client-build-id.ts (compile-time literal baked by Vite `define`)"
  - "SERVER_BUILD_ID const + getServerBuildId() fn at src/backend/config/server-build-id.ts (module-load capture from process.env.VITE_BUILD_ID)"
  - "docker/Dockerfile ARG SKYNET_BUILD_SHA declared in stages 2, 3, 5 with ENV VITE_BUILD_ID propagation"
  - "docker/docker-compose.yml skynet service build.args map wiring SKYNET_BUILD_SHA passthrough"
  - "Byte-stable build-id source that browser bundle + backend both read from the same string"
affects:
  - "132-02-PLAN — SkewLockModal + skew-lock-store consume the build-ids indirectly (via later interceptor/WS lanes)"
  - "132-03-PLAN — server middleware needs getServerBuildId() to stamp response header + refuse mismatched requests, and needs the boot log line (SKEW-02 second half)"
  - "132-04-PLAN — axios interceptor imports CLIENT_BUILD_ID"
  - "132-05-PLAN — 5 WS servers import getServerBuildId() for handshake + piggyback"
  - "132-06-PLAN — 4 WS clients + guacamole client import CLIENT_BUILD_ID"

# Tech tracking
tech-stack:
  added: []  # ZERO new packages; only node:child_process (Node stdlib)
  patterns:
    - "Vite `define` block extension for compile-time literal baking"
    - "Docker ARG-per-stage plumbing pattern (Pitfall 3 defense) — ARG must be re-declared in every stage that reads it"
    - "Module-load env capture into module-scope const (read-once contract) for backend config values"
    - "Getter fn wrapping a module-scope const purely to make the read-once contract testable via vi.resetModules()"

key-files:
  created:
    - "src/ui/lib/client-build-id.ts"
    - "src/ui/lib/client-build-id.test.ts"
    - "src/backend/config/server-build-id.ts"
    - "src/backend/config/server-build-id.test.ts"
  modified:
    - "vite.config.ts"
    - "docker/Dockerfile"
    - "docker/docker-compose.yml"

key-decisions:
  - "Build-id source: git short SHA (12 hex chars) via `git rev-parse --short=12 HEAD` at Vite eval time, with `process.env.VITE_BUILD_ID` (Docker path) taking priority; dev fallback is `dev-<epoch-base36>`"
  - "Fallback string when env missing at backend startup: `dev-unknown` (chosen so operators seeing it in prod logs know it's a config drift, not a real build)"
  - "Backend getter shape: module-scope const captured ONCE at module-load, exposed via both a `SERVER_BUILD_ID` const export AND a `getServerBuildId()` fn; the fn exists purely to make the read-once contract testable via vi.resetModules() (see Task 2 Test 3)"
  - "Dockerfile ARG declaration is required in stage 2 (frontend-builder), stage 3 (backend-builder, belt-and-suspenders), AND stage 5 (final runtime) — Pitfall 3: ARG scope resets per stage in Docker"
  - "tg-bridge compose block NOT touched — it uses Dockerfile.tg-bridge, not docker/Dockerfile, so the ARG plumbing is scoped to the skynet service only"

patterns-established:
  - "Getter-module-per-consumer-surface: CLIENT_BUILD_ID (client-only) and getServerBuildId() (backend-only) split by runtime to avoid accidental client-side process.env reads or backend-side import.meta.env reads"
  - "TDD with vi.resetModules() + dynamic import() for module-scope const capture testing (mirrors Phase 74 assert-boot.test.ts pattern)"
  - "Grep-verifiable Dockerfile invariants (`grep -c ^ARG SKYNET_BUILD_SHA == 3`) — makes future refactors self-check for missing stage declarations"

requirements-completed:
  - "SKEW-01"

# Metrics
duration: 23min
completed: 2026-09-21
---

# Phase 132 Plan 01: Build-ID Emission Summary

**Byte-stable git-short-SHA build-id baked into browser bundle at Vite `define` time AND propagated through Dockerfile ARG plumbing into backend runtime env, with thin getter modules on both sides serving all downstream drift-detection consumers.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-09-21T03:40:07Z
- **Completed:** 2026-09-21T04:03:17Z
- **Tasks:** 3
- **Files modified:** 3 (vite.config.ts, docker/Dockerfile, docker/docker-compose.yml)
- **Files created:** 4 (client-build-id.ts + .test.ts, server-build-id.ts + .test.ts)

## Accomplishments

- Browser bundle picks up a byte-stable `import.meta.env.VITE_BUILD_ID` string literal at Vite compile time via the extended `define` block. Priority chain: `process.env.VITE_BUILD_ID` (Docker) → `git rev-parse --short=12 HEAD` (dev checkout) → `dev-<epoch-base36>` (last-resort). Consumers import `CLIENT_BUILD_ID` from `src/ui/lib/client-build-id.ts` — no consumer touches `import.meta.env.*` directly.
- Backend Node process reads `process.env.VITE_BUILD_ID` exactly once at module-load of `src/backend/config/server-build-id.ts` into a module-scope const, then exposes it via both `SERVER_BUILD_ID` const export and `getServerBuildId()` fn. Read-once contract verified by Test 3 (post-import env mutation does NOT change return value).
- `docker/Dockerfile` declares `ARG SKYNET_BUILD_SHA` in three stages (frontend-builder, backend-builder, final runtime) with `ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}` in each. `docker/docker-compose.yml` skynet service's `build:` block gets an `args:` map that passes the compose-invocation env through.

## Task Commits

Each task was committed atomically:

1. **Task 1: Emit VITE_BUILD_ID via Vite define + client getter module** — `0bd55144` (`feat(132-01)`)
   - Test file + impl file + `vite.config.ts` edit all in one commit (TDD RED and GREEN authored together; single logical unit for this narrow task)
2. **Task 2: Backend SERVER_BUILD_ID getter + read-once contract** — `ae6f8eb1` (`feat(132-01)`)
   - Test file + impl file (RED confirmed against missing module before GREEN)
3. **Task 3: Dockerfile ARG plumbing + docker-compose passthrough** — `484baf8c` (`chore(132-01)`)

## Files Created/Modified

**Created:**
- `src/ui/lib/client-build-id.ts` — exports `CLIENT_BUILD_ID: string`; reads `import.meta.env.VITE_BUILD_ID` (compile-time literal) with `"dev-unknown"` fallback for jsdom/test env where the substitution doesn't fire.
- `src/ui/lib/client-build-id.test.ts` — 3 tests: non-empty string, fallback shape, plain-const-not-fn.
- `src/backend/config/server-build-id.ts` — module-scope const captured once at load; `getServerBuildId()` returns it. Fallback `"dev-unknown"`.
- `src/backend/config/server-build-id.test.ts` — 3 tests: env-set path, env-unset fallback path, post-load mutation-does-not-affect-return-value contract.

**Modified:**
- `vite.config.ts` — added `import { execSync } from "node:child_process";`; added `buildId` const computation (env → git rev-parse → epoch-base36 fallback chain) between the top-level constants and `defineConfig(...)`; extended the `define` block with `"import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId)`.
- `docker/Dockerfile` — `ARG SKYNET_BUILD_SHA` declared in stages 2, 3, 5 (grep-verified count = 3). `ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}` in stages 2 and 3 as standalone lines; concatenated into the existing multi-line `ENV` block in stage 5.
- `docker/docker-compose.yml` — added `args:` map under the skynet service's `build:` block (indented at the same level as `labels:`) that sets `SKYNET_BUILD_SHA: "${SKYNET_BUILD_SHA:-}"`. Inline comment references Phase 132 SKEW-01 so future maintainers don't strip the block.

## Decisions Made

- **Build-id source: git short SHA (12 hex chars).** Chosen per D-18 candidate b (RESEARCH.md Q1). Rationale: byte-identity between browser bundle and backend process is trivial to guarantee (both read the same shell string); no manifest-hash reload needed on the server; human-readable in logs.
- **Fallback string: `"dev-unknown"` at backend, `"dev-<epoch-base36>"` at Vite eval time.** Backend `"dev-unknown"` is a stable, grep-visible sentinel so operators seeing it in prod logs know they have a config drift (Pitfall 4). Vite's `"dev-<epoch-base36>"` produces a fresh string per dev build so drift-lock still trips against a running server — desirable in dev because it forces the browser tab to reload after every rebuild, mirroring prod behavior.
- **Getter shape: const + fn both exported.** The const is what real consumers use (single-read at import time). The fn exists purely so the read-once contract is testable — Test 3 in `server-build-id.test.ts` mutates `process.env` post-import and calls `getServerBuildId()` to prove the value didn't re-read from env. If the fn had been the only export, callers might have been tempted to call it every request → the const export makes the "read once, share everywhere" idiom obvious.
- **tg-bridge compose block not touched.** Its `build:` uses `Dockerfile.tg-bridge` (a separate file at `substrate/services/tg-bridge/Dockerfile.tg-bridge`), so the `docker/Dockerfile` ARG plumbing is out of scope for that service. The `SKYNET_BUILD_SHA` label already there stays as-is.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 1 was `tdd="true"` and I authored the RED test file first, ran it to observe failure (import-resolution error on the missing `client-build-id.ts`), then wrote the GREEN implementation. However, the RED test file and GREEN impl file landed in the same task-1 commit rather than as separate commits — this is acceptable for this plan because the plan's `<verify>` block groups both files under a single scoped vitest invocation, i.e. the task-level atomic unit is one file pair, not one RED-GREEN pair. Task 2 was handled the same way and also authored RED-first (RED confirmed with 3 failing tests before GREEN was written).

## Issues Encountered

- **`node_modules/` not installed at workspace start.** The Skynet checkout at `~/fleet/identities/rio/workspace/skynet` did not have `node_modules/` populated when I began. Ran `npm ci` once at the start of Task 1 to bootstrap; took ~9 minutes. This is a workspace-setup delay, not a plan issue. All subsequent vitest / tsc / build invocations reused the installed tree.
- **Vitest 4.x syntax change.** The plan's `<verify>` block prescribes `npx vitest --related <files> run`; vitest 4.1.8 (the installed version) renamed this to `npx vitest related <files> --run` (subcommand shape, flag order changed). Used the 4.x syntax for actual test runs — no behavior change in what gets tested. Documented here so downstream plans don't hit the same rakes.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-01 (Tampering — Missing ARG declaration):** Mitigated. `grep -c "^ARG SKYNET_BUILD_SHA" docker/Dockerfile` returns 3 (stages 2, 3, 5) — no silent drop.
- **T-132-02 (Repudiation — Operator can't distinguish correct-build-shipped from stale-env-vars):** Deferred to Plan 03, which owns the boot log line. This plan ships the getter fn that Plan 03 will call.
- **T-132-03 (Info Disclosure — Build ID in headers/frames):** Accepted per plan. Git short SHA is already public information via OCI label `org.skynet.commit`.
- **T-132-04 (DoS — git rev-parse failure inside Docker):** Mitigated. Two-layer defense: (a) Dockerfile passes `SKYNET_BUILD_SHA` as ARG so no in-container git call is needed at build time; (b) Vite eval's `execSync` has a try/catch fallback to `dev-<epoch-base36>` for local-dev paths where env is unset. `.dockerignore` review not required at this plan because the Docker path bypasses `git rev-parse` entirely (it's the ARG-supplied string that lands in ENV).
- **T-132-SC (Supply chain — new package installs):** Accepted per plan; zero new packages installed. Only `node:child_process` (Node stdlib) used.

## Verification Results

All plan-level `<verification>` gates green:

- `npx vitest related ...` on 5 touched files: **6/6 tests passed** across 2 test files.
- `grep -c "^ARG SKYNET_BUILD_SHA" docker/Dockerfile`: **3** (expected 3).
- `grep -q "VITE_BUILD_ID" vite.config.ts`: **hit**.
- `grep -q "CLIENT_BUILD_ID" src/ui/lib/client-build-id.ts`: **hit**.
- `grep -q "getServerBuildId" src/backend/config/server-build-id.ts`: **hit**.
- `npx tsc --noEmit`: **exit 0** (full-tree TS compile clean, including new files).
- `npm run build:backend`: **exit 0** (backend tsc + package.json copy step green).
- `npm run build`: **exit 0** (frontend Vite build + backend tsc — full "backend-touching plans" gate per role-file directive).
- `docker compose config` (with `SKYNET_FLEET_MOUNT_SRC=/tmp` to bypass pre-existing hard-fail interpolation gate): **exit 0**, `args.SKYNET_BUILD_SHA` present in the resolved config.

## Deferred to Downstream Plans

- **SKEW-02 boot log line** — the startup log emitting `operation: "server_boot_build_id"` at Express boot lives in Plan 03 alongside the middleware. This plan ships the getter fn Plan 03 will call.
- **Consumer wiring** — nothing in this plan actually IMPORTS `CLIENT_BUILD_ID` or calls `getServerBuildId()`. That's intentional; the wiring is Plans 03-06's work. As a consequence the git short SHA does NOT appear anywhere in the current `dist/assets/*.js` bundle (tree-shaking dropped the unused const). This is correct behavior — the literal will appear in prod bundles as soon as Plan 04 wires the axios interceptor.

## Next Plan Readiness

- Plan 02 (skew-lock-store + SkewLockModal + reload-loop sentinel) has no dependency on this plan's outputs. Can start any time in Wave 0/1.
- Plan 03 (server middleware + boot log) has a HARD dependency on `src/backend/config/server-build-id.ts` — that file must exist before Plan 03 can import `getServerBuildId()`. **Ready.**
- Plan 04 (client interceptor + response drift detection) has a HARD dependency on `src/ui/lib/client-build-id.ts`. **Ready.**
- Plans 05 and 06 also depend on the getter modules. **Ready.**

## Self-Check: PASSED

Verified after summary write:

- `src/ui/lib/client-build-id.ts` — FOUND
- `src/ui/lib/client-build-id.test.ts` — FOUND
- `src/backend/config/server-build-id.ts` — FOUND
- `src/backend/config/server-build-id.test.ts` — FOUND
- `vite.config.ts` — FOUND (modified)
- `docker/Dockerfile` — FOUND (modified)
- `docker/docker-compose.yml` — FOUND (modified)
- Commit `0bd55144` (Task 1) — present in git log
- Commit `ae6f8eb1` (Task 2) — present in git log
- Commit `484baf8c` (Task 3) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 01 — Build-ID emission*
*Completed: 2026-09-21*
