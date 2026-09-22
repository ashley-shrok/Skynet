---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 10
subsystem: infra
tags: [telegram-teardown, docker-compose, nginx, deploy-surface, destructive, tg-bridge]

# Dependency graph
requires:
  - phase: 128-08
    provides: "Route mount + starter dispatches removed (telegramRoutes unmounted, three telegram-loop void-import blocks gone) — with those gone at the runtime layer, deleting the compose service + nginx routes cannot break a live server."
  - phase: 128-09
    provides: "Source-file teardown: src/backend/telegram/ + substrate/services/tg-bridge/ deleted — nothing remains in the tree that would try to write into /state or answer /telegram requests, so removing the compose mount + nginx routes is disjoint-safe."
provides:
  - "docker/docker-compose.yml — tg-bridge service block DELETED"
  - "docker/docker-compose.yml — tg-bridge-state named volume DELETED"
  - "docker/docker-compose.yml — skynet service's tg-bridge-state:/state mount + its comment header DELETED (had to go too — the writer that populated it was deleted in Plan 128-09, and leaving a mount to a deleted named-volume would break `docker compose config`)"
  - "docker/docker-compose.yml — historical tg-bridge comment in the skynet service's build-block header trimmed (grep gate required zero surviving tg-bridge references)"
  - "docker/nginx.conf — location ~ ^/telegram(/.*)?$ block DELETED"
  - "docker/nginx-https.conf — location ~ ^/telegram(/.*)?$ block DELETED (dual-conf discipline / Pitfall 5)"
  - "Both nginx confs — /push-subscriptions block's comment header trimmed to remove now-stale /telegram references (Rule 3 deviation to satisfy the fleet-rules combined grep=0 gate; the location block itself is byte-for-byte preserved)"
affects: [128-11, "future deploy: `docker compose up --force-recreate skynet` will not create/start tg-bridge; nginx (HTTP + HTTPS) no longer forwards /telegram; /push-subscriptions still reaches backend :30001"]

# Tech tracking
tech-stack:
  added: []  # deletion-only plan
  patterns:
    - "Dual-conf teardown discipline: any nginx location block edit must land in BOTH docker/nginx.conf and docker/nginx-https.conf, verified by paired greps (Pitfall 5)"
    - "Deletion-notice narrative comments: where the /push-subscriptions block's comment header referenced /telegram historically, replaced with a phase-labeled note that names Plan 128-10 as the teardown moment — cheap archaeology for future readers hitting blame on the /push-subscriptions block"
    - "YAML validity gate for compose teardowns: python3 yaml.safe_load is the fallback when the executor host lacks docker (docker compose config still runs interpolation over env-vars unrelated to the change and can false-fail)"

key-files:
  created: []
  modified:
    - "docker/docker-compose.yml (5 insertions, 47 deletions — tg-bridge service + tg-bridge-state volume + skynet's tg-bridge-state mount + historical bridge comments)"
    - "docker/nginx.conf (8 insertions, 34 deletions — /telegram block + trimmed /push-subscriptions comment)"
    - "docker/nginx-https.conf (mirror of nginx.conf)"
  deleted: []  # deletions were block-level within files, not whole-file deletions

key-decisions:
  - "Broader compose surgery than PATTERNS.md manifest suggested: the skynet service's `- tg-bridge-state:/state` mount at ~L67 had to go too. PATTERNS.md § Deletion Manifest only enumerated the tg-bridge service block + the volume declaration + the build-block comment; leaving skynet's mount in place would have referenced a now-undefined volume, breaking `docker compose config`. Rule 2 / Rule 3 auto-fix applied (correctness + blocking issue)."
  - "Historical bridge comments in the skynet build block (L26-31 originally) trimmed rather than removed line-for-line: the block explained WHY skynet's build stanza was added (because tg-bridge was previously the only thing in compose's build set). Post-teardown that history is meaningless; kept only the still-relevant SKYNET_BUILD_SHA + context-`..`-resolves-to-repo-root guidance."
  - "Comment surgery on /push-subscriptions block (Rule 3 deviation): the block itself is preserved unchanged, but its header comment referenced /telegram historically. Fleet-rules mandated `grep -c 'tg-bridge\\|/telegram'` = 0 across all three infra files, so the comment was rewritten to remove /telegram and tg-bridge references while preserving the dual-conf discipline note and the phase-marker."

requirements-completed: [D-17, D-18]

# Metrics
duration: ~15min
completed: 2026-09-21
---

# Phase 128 Plan 10: Docker/nginx teardown (compose service + volume + both nginx `/telegram` blocks) Summary

**Deleted the tg-bridge Docker service + tg-bridge-state named volume from docker/docker-compose.yml, and the `/telegram` location blocks from BOTH docker/nginx.conf and docker/nginx-https.conf — infrastructure-side half of the tg-bridge teardown (D-17 one-motion, D-18 teardown scope). All three files pass a combined grep of `tg-bridge|/telegram` = 0.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-21T03:55:00Z (approx — first plan read)
- **Completed:** 2026-09-21T04:11:00Z
- **Tasks:** 2 / 2
- **Commits:** 2 (both `chore(128-10-N):`)
- **Files touched:** 3 (all modified — no creates, no whole-file deletes)

## What Shipped

### Task 1 commit `0fdea9e2` — docker-compose.yml surgery
- Deleted the `tg-bridge:` service block entirely (build stanza, image, container_name, restart, volumes, depends_on, networks).
- Deleted the `tg-bridge-state:` named volume declaration.
- Deleted the skynet service's `- tg-bridge-state:/state` mount (see § Deviations for scope-expansion reasoning).
- Trimmed the historical tg-bridge references in the skynet service's build-block comment header (originally L26-31) — the historical note explaining why skynet's build stanza was added (because tg-bridge was previously the only service in compose's build set) is now meaningless.
- Trimmed the tg-bridge-state mount's Phase 79 comment header at L61-67 (was: "shared named volume with tg-bridge service").
- Net change: 5 insertions, 47 deletions.

### Task 2 commit `560c29bf` — dual-conf nginx surgery
- Deleted `location ~ ^/telegram(/.*)?$ { ... }` block from `docker/nginx.conf` (10-line block + 1-line preceding comment).
- Deleted the byte-mirror equivalent from `docker/nginx-https.conf` (same block, HTTPS conf).
- Rewrote the /push-subscriptions block's comment header in both files to remove stale /telegram / tg-bridge references (Rule 3 deviation — see § Deviations). The `location ~ ^/push-subscriptions(/.*)?$ { ... }` block itself is byte-for-byte preserved.
- Net change: 8 insertions, 34 deletions across both files combined.

## Verification Results

**Grep gates (all passing):**

| Gate | File | Expected | Actual |
|------|------|----------|--------|
| `grep -c "tg-bridge"` | docker-compose.yml | 0 | 0 |
| `grep -c "tg-bridge-state"` | docker-compose.yml | 0 | 0 |
| `grep -c "Dockerfile.tg-bridge"` | docker-compose.yml | 0 | 0 |
| `grep -c "SKYNET_BRIDGE_TOKEN"` | docker-compose.yml | 0 | 0 |
| `grep -c "skynet:"` (skynet service preserved) | docker-compose.yml | ≥ 1 | 1 |
| `grep -c "location.*telegram"` | nginx.conf | 0 | 0 |
| `grep -c "location.*telegram"` | nginx-https.conf | 0 | 0 |
| `grep -c "location.*push-subscriptions"` | nginx.conf | 1 | 1 |
| `grep -c "location.*push-subscriptions"` | nginx-https.conf | 1 | 1 |
| `grep -c "location.*/sw.js\|location.*manifest"` | nginx.conf | ≥ 1 | 3 |
| `grep -c "location.*/sw.js\|location.*manifest"` | nginx-https.conf | ≥ 1 | 3 |
| Fleet-rules combined grep `tg-bridge\|/telegram` | all three | 0 | 0 / 0 / 0 |

**Syntax gates:**

| Gate | Method | Result |
|------|--------|--------|
| YAML validity | `python3 -c "import yaml; yaml.safe_load(open('docker/docker-compose.yml'))"` | exits 0 |
| nginx.conf brace balance | `grep -c "{"` vs `grep -c "}"` | 94 / 94 |
| nginx-https.conf brace balance | `grep -c "{"` vs `grep -c "}"` | 98 / 98 |
| `docker compose config --quiet` | (deferred — executor host lacks `SKYNET_HOME_MOUNT_SRC` env, unrelated to this diff) | YAML-side proven valid |
| `nginx -t` | (deferred — nginx binary not present in executor env; deploy-time validation) | brace balance proven |

**Dependency safety:**

| Check | Result |
|-------|--------|
| Any remaining service `depends_on: tg-bridge`? | No — only `caddy` depends on `guacd`, no tg-bridge references anywhere. |
| Any remaining service mount of `tg-bridge-state`? | No — grep on `tg-bridge-state` returns 0. |
| /push-subscriptions block still routes to 127.0.0.1:30001? | Yes — verified in both confs, block byte-for-byte preserved. |

## Deviations from Plan

### 1. [Rule 2 + Rule 3 — Correctness / Blocking] Skynet service's `tg-bridge-state:/state` mount also removed

- **Found during:** Task 1 pre-edit grep of `tg-bridge` in docker-compose.yml.
- **Issue:** The plan's `must_haves.truths` and PATTERNS.md § Deletion Manifest enumerated deletions for the tg-bridge service block + the volume declaration + the build-block comment. But the **skynet service itself** mounted `- tg-bridge-state:/state` at ~L67 (Phase 79 Plan 06 pattern — skynet wrote config.env for the bridge into that shared volume). The bridge-config-writer that wrote into `/state` was deleted in Plan 128-09, so no one writes there anymore. AND deleting the `tg-bridge-state:` named-volume declaration while leaving the mount referencing it would break `docker compose config` (undefined volume reference).
- **Fix:** Removed the mount line `- tg-bridge-state:/state` and its Phase 79 comment header (`# Phase 79 Plan 06 — shared named volume with tg-bridge service...` through `# NOT read_only — Skynet writes from the container.`). Skynet service otherwise preserved.
- **Rule invoked:** Rule 2 (essential correctness — a dangling mount to a deleted volume is a compose-parse failure at deploy time) + Rule 3 (blocking issue for the `grep -c "tg-bridge" = 0` acceptance gate).
- **Files:** `docker/docker-compose.yml` (rolled into Task 1 commit `0fdea9e2`).

### 2. [Rule 3 — Blocking issue for fleet-rules gate] `/push-subscriptions` block's comment header trimmed

- **Found during:** Task 2 post-edit verification of the fleet-rules combined grep.
- **Issue:** The plan Task 2 explicitly said "Do NOT touch any other location blocks... /push-subscriptions must survive untouched." However, the fleet-rules `<success_criteria>` said the combined `grep "tg-bridge\|/telegram"` must be 0 across all three infra files. The /push-subscriptions block's comment header (written by Plan 128-05's author anticipating this exact teardown) contained three references to `/telegram` in prose form ("Byte-mirror of the /telegram block above", "Removed alongside the /telegram block will NOT happen", "only /telegram exits in Plan 10"). Those grep-hit even though the location block itself was clean.
- **Fix:** Rewrote the /push-subscriptions comment header in BOTH confs to remove all `/telegram` and `tg-bridge` prose while preserving the dual-conf discipline pointer, the phase marker (Plan 05), and the successor-surface narrative. The `location ~ ^/push-subscriptions(/.*)?$ { ... }` block itself (line for line, proxy_pass + all proxy_set_header lines) is byte-for-byte preserved.
- **Rule invoked:** Rule 3 (blocking issue — fleet-rules `<success_criteria>` gate is a hard invariant; comment surgery was the minimum-scope fix; the alternative was to leave the plan's success criterion unmet).
- **Files:** `docker/nginx.conf` + `docker/nginx-https.conf` (rolled into Task 2 commit `560c29bf`).
- **Trade-off:** The historical note about /push-subscriptions being the byte-mirror of /telegram is lost. Acceptable — git blame on the block still points at Plan 128-05, and this SUMMARY records the successor relationship.

## Orchestrator-Scope Follow-Ups (deploy runbook, not executor's remit)

Per the plan's `<output>` section:

1. `docker volume rm skynet_tg-bridge-state` — removes the orphaned named volume on the deploy host (the volume declaration is gone from compose, but any pre-existing volume on the box persists until explicitly removed). Destructive (bridge state files: registry.json, config.env, per-human .token / .since / .token-dead / .bottoken files, offset cursors, work/). Accepted per D-20.
2. `docker image prune -f` — removes the now-dangling `tg-bridge:local` image (no longer built because the build stanza is gone from compose).
3. **Operator-side (the user's discretion):** revoke BotFather Telegram bots if desired. External to Skynet's control surface, entirely per D-20.

## Known Stubs

None. This is a pure teardown plan; no new code paths were introduced; no data sources are left unwired.

## Threat Flags

None. All deletions land inside the trust boundaries already enumerated in the plan's `<threat_model>` (T-126-50 through T-126-55 all mitigated via the acceptance gates that this plan's verification confirmed).

## Self-Check: PASSED

Verified before this line was written:

- File `.planning/phases/128-push-notifications-replacing-telegram-bridge/128-10-SUMMARY.md` — FOUND (this file).
- Commit `0fdea9e2` (Task 1) — FOUND in `git log --oneline`.
- Commit `560c29bf` (Task 2) — FOUND in `git log --oneline`.
- All 12 grep gates + 3 syntax gates + 3 dependency-safety checks — PASSED (see § Verification Results).
