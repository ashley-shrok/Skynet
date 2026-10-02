---
phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-
plan: 01
subsystem: infra
tags: [ntfy, docker-compose, caddy, push-notifications, env-assertion, boot-gate]

# Dependency graph
requires: []
provides:
  - "ntfy container service in docker-compose.yml with binwiederhier/ntfy:v2.28.0"
  - "docker/ntfy/server.yml: declarative admin user + publish token provisioning (HC-2 bootstrap fix)"
  - "ntfy-data named volume for cache.db + auth.db persistence"
  - "Caddyfile.ntfy-additions.snippet: ship-prep artifact documenting handle_path /ntfy/* + restructured fallback"
  - "assertNtfyConfigAtBoot() boot-time env gate mirroring assertVapidConfigAtBoot shape"
  - "getNtfyBaseUrl(), getNtfyInternalPublishUrl(), getNtfyPublishToken(), getNtfyAdminUser(), getNtfyAdminPassword() getters"
  - "docker/skynet.env.example: documented NTFY_ADMIN_USER/PASS/PASS_BCRYPT/PUBLISH_TOKEN vars"
affects:
  - "144-02: HTTP admin API client authenticates against the pre-provisioned admin user from server.yml"
  - "144-03: frontend preferences pane reads ntfy base URL from getNtfyBaseUrl()"
  - "144-04: plan 04 removes assertVapidConfigAtBoot from starter.ts (this plan adds assertNtfyConfigAtBoot alongside it)"

# Tech tracking
tech-stack:
  added: ["binwiederhier/ntfy:v2.28.0 (Docker container — no npm package)"]
  patterns:
    - "ntfy auth-users + auth-tokens declarative provisioning in server.yml (synced to auth.db at container start)"
    - "env-var-interpolated YAML config: ${VAR} in server.yml, resolved from env_file at container startup"
    - "fail-loud compose guard: ${SKYNET_PUBLIC_URL:?...} matches existing SKYNET_HOME_MOUNT_SRC pattern"
    - "TDD RED/GREEN: test file committed first, implementation second"

key-files:
  created:
    - docker/ntfy/server.yml
    - docker/ntfy/README.md
    - docker/caddy-config/Caddyfile.ntfy-additions.snippet
    - src/backend/notifications/ntfy-config.ts
    - src/backend/notifications/ntfy-config.test.ts
    - docker/skynet.env.example
  modified:
    - docker/docker-compose.yml
    - src/backend/starter.ts

key-decisions:
  - "HC-2 fix: admin user provisioned declaratively in server.yml auth-users at compose up — not via HTTP admin API (which would require credentials that don't exist yet)"
  - "One identity for both roles: same NTFY_ADMIN_USER used in auth-users (admin role) AND auth-tokens (publish token); avoids skynet-publisher vs admin confusion (HC-1)"
  - "Publish token is env-var-only (not DB-stored): NTFY_PUBLISH_TOKEN in skynet.env; no ntfy_publish_config singleton table (HC-3 is deliberately NOT built)"
  - "Caddyfile snippet is ship-prep-only: executor never touches live /opt/skynet/caddy-config/Caddyfile (MC-1 gate verified)"
  - "assertNtfyConfigAtBoot co-exists with assertVapidConfigAtBoot in starter.ts during cutover; plan 04 removes the VAPID gate"
  - "env_file pattern for server.yml interpolation: Docker's env_file does not re-interpolate values, so $$ escaping is NOT needed for bcrypt hashes (Pitfall 5)"

patterns-established:
  - "ntfy-config.ts: mirrors vapid-config.ts shape — readNtfyEnv() private + public assertNtfyConfigAtBoot() + individual getters"
  - "Server config YAML with ${VAR} interpolation from env_file: no literal credentials in git"

requirements-completed: []

# Metrics
duration: 35min
completed: 2026-10-02
---

# Phase 144 Plan 01: Infra Foundation Summary

**ntfy container + declarative admin/token provisioning via server.yml (closing HC-2 bootstrap gap), Caddyfile path-prefix snippet, and boot-time ntfy config assertion module mirroring the VAPID gate shape**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-10-02T22:10:00Z
- **Completed:** 2026-10-02T22:24:00Z
- **Tasks:** 4 (Task 4 was TDD: RED + GREEN)
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- Created `docker/ntfy/server.yml` with `auth-users` + `auth-tokens` entries that provision the ntfy admin user and publish token at container startup, closing the HC-2 bootstrap circularity (HTTP admin API in plan 02 has a credential to authenticate with at first boot)
- Added `ntfy` service to `docker-compose.yml` with `binwiederhier/ntfy:v2.28.0`, `ntfy-data` named volume, server.yml bind mount, `env_file` for credential interpolation, and fail-loud `SKYNET_PUBLIC_URL:?` guard
- Created `Caddyfile.ntfy-additions.snippet` documenting the BEFORE/AFTER edit to the live Caddyfile (handle_path /ntfy/* + restructured handle {} fallback); explicitly flagged ship-prep-only, live Caddyfile untouched (MC-1 gate passes)
- Created `ntfy-config.ts` with 6 exports mirroring `vapid-config.ts` shape; `assertNtfyConfigAtBoot()` wired into `starter.ts` alongside `assertVapidConfigAtBoot()` (double-gate during cutover); 14/14 TDD tests pass; backend typecheck passes

## Task Commits

1. **Task 1: docker/ntfy/server.yml + README** — `99e98ee3` (feat)
2. **Task 2: ntfy service + volume in docker-compose.yml** — `90d325e3` (feat)
3. **Task 3: Caddyfile.ntfy-additions.snippet** — `492f7e1f` (feat)
4. **Task 4: ntfy-config tests (RED)** — `62ce1617` (test)
5. **Task 4: ntfy-config.ts + starter.ts + env.example (GREEN)** — `2791dc90` (feat)

## Files Created/Modified

- `docker/ntfy/server.yml` — declarative ntfy server config with auth-users + auth-tokens (HC-2 fix); all values via ${VAR} interpolation, no literal credentials
- `docker/ntfy/README.md` — operator notes: bcrypt-hashing step, $$ escaping rule (and why it doesn't apply with env_file), NTFY_PUBLISH_TOKEN generation command
- `docker/docker-compose.yml` — added ntfy service (binwiederhier/ntfy:v2.28.0), ntfy-data volume, env_file, fail-loud NTFY_BASE_URL guard
- `docker/caddy-config/Caddyfile.ntfy-additions.snippet` — ship-prep-only Caddyfile diff artifact; documents BEFORE/AFTER site block shapes
- `src/backend/notifications/ntfy-config.ts` — 6 exports: assertNtfyConfigAtBoot, getNtfyBaseUrl (trailing-slash-safe), getNtfyInternalPublishUrl, getNtfyPublishToken, getNtfyAdminUser, getNtfyAdminPassword
- `src/backend/notifications/ntfy-config.test.ts` — 14 TDD tests covering NC-01..NC-09 (happy path, missing env vars, doubled-slash prevention, internal URL, getter trimming)
- `src/backend/starter.ts` — import + call assertNtfyConfigAtBoot() after assertVapidConfigAtBoot() (plan 04 removes VAPID)
- `docker/skynet.env.example` — new file documenting all NTFY_* vars + generation commands; no real credentials committed (T-144-01 verified)

## Decisions Made

- **HC-2 resolution:** Admin user goes in `server.yml` auth-users, not provisioned via HTTP admin API at runtime. This is the only correct approach — the HTTP admin API requires an authenticated admin to call, creating a circular dependency if the admin isn't pre-provisioned.
- **One identity model:** `NTFY_ADMIN_USER` appears in both `auth-users` (admin role) and `auth-tokens` (publish token). This matches the Q3-ADDENDUM "simpler yet" architecture from RESEARCH.md — one identity for both admin API calls (Basic auth) and publish calls (Bearer token).
- **No ntfy_publish_config DB table:** HC-3 flag — publish token is env-only by design. The table was considered in RESEARCH.md Q7 but the plans deliberately omit it.
- **env_file interpolation:** `$$ escaping` for bcrypt hashes is a docker-compose inline env concern only. Since `server.yml` reads from `${NTFY_ADMIN_PASS_BCRYPT}` which arrives via `env_file` (not inline compose env), no escaping is needed. Documented in README.md to prevent operator confusion.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `vitest` binary not installed in node_modules (no node_modules directory existed). Ran `npm install` to install dependencies before RED phase. Not a deviation — standard project setup step.
- `ugrep` (aliased as `grep` in the shell) returns exit code 1 when the pattern contains leading `-` chars. Worked around by using `grep -F` for fixed-string patterns with special characters.

## Known Stubs

None — this plan creates infrastructure and a boot-gate module. No UI components, no data-rendering paths.

## Threat Flags

None — all threat mitigations from the plan's `<threat_model>` are implemented:
- T-144-01: `docker/skynet.env.example` contains only placeholders, no real tokens
- T-144-02: `${SKYNET_PUBLIC_URL:?...}` fail-loud guard in docker-compose.yml
- T-144-03: `ntfy-data` named volume ensures auth.db + cache.db persist across container recreation
- T-144-05: `assertNtfyConfigAtBoot` throws on any missing NTFY_* env var
- T-144-21 (HC-2): `server.yml` auth-users entry provisions admin user at compose up
- T-144-22: `server.yml` uses only `${VAR}` interpolation, verified by no bcrypt literal grep

## Next Phase Readiness

- Plan 02 (HTTP admin API client + `ensureSkynetPublisherUserExists`) can proceed: the admin user credential exists in auth.db at compose up, satisfying the bootstrap requirement
- Plan 03 (frontend pane) can proceed in parallel with plan 02: `getNtfyBaseUrl()` and `getNtfyInternalPublishUrl()` are available
- Caddy path-prefix routing is ship-prep-ready: the Caddyfile snippet documents the exact edit needed; the orchestrator applies it at deploy time

## Self-Check: PASSED

- `docker/ntfy/server.yml` exists: VERIFIED
- `docker/ntfy/README.md` exists: VERIFIED
- `docker/caddy-config/Caddyfile.ntfy-additions.snippet` exists: VERIFIED
- `src/backend/notifications/ntfy-config.ts` exists with 6 exports: VERIFIED
- `src/backend/notifications/ntfy-config.test.ts` exists with 14 passing tests: VERIFIED
- `src/backend/starter.ts` has assertNtfyConfigAtBoot import + call: VERIFIED
- `docker/skynet.env.example` documents all NTFY_* vars: VERIFIED
- All commits present: `99e98ee3`, `90d325e3`, `492f7e1f`, `62ce1617`, `2791dc90`: VERIFIED

---
*Phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-*
*Completed: 2026-10-02*
