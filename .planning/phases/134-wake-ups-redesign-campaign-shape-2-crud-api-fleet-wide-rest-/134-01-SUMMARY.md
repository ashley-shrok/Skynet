---
phase: 128-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-
plan: 01
subsystem: skynet-backend-rest
tags:
  - wakeups
  - crud-api
  - rest
  - ssh-fan-out
  - atomic-write
  - nginx
dependency_graph:
  requires:
    - Phase 127: global on-disk wake-up spec convention (~/fleet/wakeups/<slug>/wakeup.json)
    - identity-artifact-reader.ts primitives (isLocalHostId, humanizeWakeupSchedule, IDENTITY_SLUG_RE, writeMarkdownFileAtomic)
  provides:
    - GET /wakeups fleet-wide LIST endpoint (aggregated fan-out)
    - POST /wakeups per-host CREATE
    - PATCH /wakeups/:slug per-host UPDATE
    - PATCH /wakeups/:slug/toggle-enabled per-host enable-bit flip
    - DELETE /wakeups/:slug per-host hard-delete + .fired sentinel cleanup
    - getLocalWakeupsRoot() helper + exported normalizeWakeupSlug
  affects:
    - src/backend/database/database.ts (mounts)
    - docker/nginx.conf + docker/nginx-https.conf (paired location blocks per D-17)
tech_stack:
  added: []
  patterns:
    - fleet fan-out over SSH (Promise.all + per-host Promise.race([work, timeout]) + .catch(() => []))
    - LOCAL/REMOTE branch selection via isLocalHostId(hostId)
    - delimiter-batched SSH one-liner cat for aggregated read
    - atomic write via SFTP writeFile(.tmp) + ext_openssh_rename (REMOTE) / fs.writeFile(.tmp) + fs.rename (LOCAL)
    - per-host semaphore serialization via getHostSemaphore(hostId).run(...)
    - JWT + resolveHostById(hostId, userId) per-user host isolation
    - trailing catch-all error middleware returning generic {error:"internal"}
key_files:
  created:
    - src/backend/database/routes/wakeups-list.ts (309 lines)
    - src/backend/database/routes/wakeups-list.test.ts (497 lines, 12 test cases)
    - src/backend/database/routes/wakeups-write.ts (786 lines)
    - src/backend/database/routes/wakeups-write.test.ts (494 lines, 16 test cases)
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts (added getLocalWakeupsRoot + exported normalizeWakeupSlug)
    - src/backend/database/database.ts (imports + two chained /wakeups mounts)
    - docker/nginx.conf (paired /wakeups location block)
    - docker/nginx-https.conf (paired /wakeups location block)
decisions:
  - D-01 HTTP REST endpoint style (chained routers at /wakeups)
  - D-02 fleet-wide sweep on LIST; host param on writes
  - D-03 thin API — no DB shadow; files stay the source of truth
  - D-05 atomic writes via writeMarkdownFileAtomic
  - D-06 HARD DELETE + combined .fired sentinel cleanup in ONE execCommand
  - D-07 kebab-case slug via normalizeWakeupSlug; 409 on collision
  - D-08 validation MIRRORS wakeup-scheduler.py _load_specs_global exactly
  - D-15 SSH fan-out with delimiter one-liner
  - D-16 skynet host in fan-out via LOCAL branch (bind mount, not loopback SSH)
  - D-17 nginx paired blocks in BOTH docker/nginx.conf AND docker/nginx-https.conf
metrics:
  duration: ~50 minutes
  completed_date: 2026-09-21
requirements: []
---

# Phase 134 Plan 134-01: Skynet REST CRUD API for global wake-ups — Summary

REST HTTP surface over `~/fleet/wakeups/<slug>/wakeup.json` — fleet-wide LIST fan-out + per-host CREATE/UPDATE/TOGGLE/DELETE, plus paired nginx blocks and helper additions to identity-artifact-reader.ts. Purely additive; no code removed.

## What Landed

**New Express routers (mounted at `/wakeups` chained):**

1. `src/backend/database/routes/wakeups-list.ts` — `GET /wakeups`
   - JWT-gated fleet-wide fan-out.
   - Host projection scoped by `userId + enableSsh + autoTmux` (mirrors `conversation-search.ts:542-563`).
   - Per-host `Promise.race([work, timeout(15s)]) + .catch(() => [])` — one slow/down host contributes `[]`, does not stall the aggregate (T-128-03).
   - LOCAL branch (`isLocalHostId(hostId)` true) reads via `fs/promises` against `getLocalWakeupsRoot()` — Skynet's own host uses the container bind mount, not loopback SSH (D-16).
   - REMOTE branch runs one delimiter-batched SSH exec:
     `cd "$HOME/fleet/wakeups" 2>/dev/null && for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/wakeup.json" 2>/dev/null; done`
   - Poisoned JSON entries are `sshLogger.warn`'d and skipped; one bad file never poisons the aggregate for that host.
   - Response shape: `200 {items: WakeupListItem[]}` where each item carries `slug, host, hostId, name, enabled, schedule, scheduleHuman, prompt, roles[], skills[]` (populates the shape-3 modal contract).

2. `src/backend/database/routes/wakeups-write.ts` — `POST / PATCH /:slug / PATCH /:slug/toggle-enabled / DELETE /:slug`
   - All four handlers JWT-gated + wrapped in `getHostSemaphore(hostId).run(...)` (T-128-05 concurrent-CREATE race mitigation).
   - `express.json({limit:"64kb"})` on every write path (T-128-04 DoS defense; parity with nginx `client_max_body_size 64k`).
   - Validation via `validateGlobalWakeupSpec` MIRRORS `wakeup-scheduler.py::_load_specs_global` at L224-248 EXACTLY (D-08). Accepts iff dict-shaped with truthy `prompt` + truthy `schedule` object + `schedule.type ∈ {interval, daily, weekly, one_shot}` + type-specific required fields. NO extra gates.
   - CREATE: existence probe via `[ -e "$HOME/fleet/wakeups/${slug}/wakeup.json" ] && echo EXISTS || echo OK`; 409 on collision; atomic write via `writeMarkdownFileAtomic` (LOCAL: null-conn + `fs.writeFile(.tmp) + fs.rename`; REMOTE: SFTP `writeFile(.tmp) + ext_openssh_rename`). Inline comment: "writeMarkdownFileAtomic is byte-agnostic despite the name — JSON body passes through unchanged."
   - UPDATE: full-spec overwrite via the same atomic-write primitive; no clobber probe.
   - TOGGLE: reads current spec, flips `enabled`, atomic-writes. Missing spec → 404.
   - DELETE: single `execCommand` with `rm -rf "$HOME/fleet/wakeups/${slug}" && rm -f "$HOME/fleet/wakeups/.state/${slug}.fired"` (D-06 + Pitfall #2 — orphan sentinel would inherit "already fired" state onto a future spec with the same slug).
   - Every handler routes `conn.end()` through `finally`. Every SSH-touching path returns generic 5xx bodies (`"SSH connect failed" / "SSH exec failed" / "SFTP write failed"`); upstream detail goes to `sshLogger` only (T-128-08).

**Helpers added to `src/backend/claude-session/identity-artifact-reader.ts`:**

- `getLocalWakeupsRoot()` — new export, mirrors `getLocalIdentitiesRoot` / `getLocalRolesRoot` / `getLocalProjectsRoot`. Precedence: `WAKEUPS_HOST_DIR` env override → `<home>/fleet/wakeups`. Test escape hatch matches the pattern established for identities/roles/projects.
- `normalizeWakeupSlug` — was module-private; now exported (byte-identical body). Referenced by `wakeups-write.ts` on POST (D-07 slug derivation).

**Wiring:**

- `src/backend/database/database.ts` — imports both routers, adds two chained `app.use("/wakeups", ...)` mounts immediately after the `/roles` chain and before the `/global-files` mounts.
- `docker/nginx.conf` — new `location ~ ^/wakeups(/.*)?$` block (proxy_pass 127.0.0.1:30001, HTTP/1.1, standard proxy headers, proxy_read_timeout 15s, client_max_body_size 64k).
- `docker/nginx-https.conf` — paired block, byte-shape identical to the HTTP conf (D-17 — missing this file means /wakeups 200-returns index.html and crashes the SPA on `.map` in production).

## Test Coverage

**Scoped `npx vitest related --run`:**

| File | Cases | Result |
|------|-------|--------|
| `wakeups-list.test.ts` | 12 | ✅ all pass |
| `wakeups-write.test.ts` | 16 | ✅ all pass |
| `identity-artifact-reader` regression | 1457 (84 test files) | ✅ all pass (1 pre-existing skip) |

**Total scoped:** 46 tests pass across the three primary touched files (`wakeups-list.ts`, `wakeups-write.ts`, `database.ts`).

**wakeups-list.test.ts coverage:** 401 without JWT, 2-host happy fan-out, one-host connectOneShot failure, one-host exec failure, LOCAL branch via fs/promises, REMOTE delimiter-shape assertion, poisoned JSON skipped, empty dir, cross-user projection, humanizeWakeupSchedule field populated, enableSsh=false + autoTmux:false filtered, multi-slug delimiter batch.

**wakeups-write.test.ts coverage:** 401 without JWT, 400 on missing host, 404 on unknown host, 400 on empty slug, 400 on missing prompt/schedule/unknown-type (scheduler-parity gates), 409 clobber, happy CREATE REMOTE with writeMarkdownFileAtomic assertion, happy CREATE LOCAL (null-conn), semaphore serializes concurrent CREATEs (exactly one 201 + one 409), PATCH happy, TOGGLE happy, TOGGLE 404 on missing, DELETE 204, DELETE regression-pin (single execCommand contains BOTH `rm -rf` AND `rm -f .fired` — D-06 / Pitfall #2), sftp.rename throwing trap asserted NEVER called on any happy path (Pitfall #1).

## Build Results

- `npm run build:backend` — clean (0 errors).
- `npm run build` — clean (0 errors).

## Deviations from Plan

**None substantive.** One inline `String(req.params.slug ?? "")` coercion was needed to satisfy Express v5's `string | string[]` type at the callsite — surfaced by `tsc` on first Task 4 build; fixed inline before commit (Rule 3 auto-fix; blocker to task completion). No architectural changes, no plan-scope changes.

## Banned-strings Gate

`grep -rin '\buser\b' src/backend/database/routes/wakeups-*.ts` — 0 matches. All references to the operator in code + docs use "the user" per fleet convention.

## Signal for Plan 134-02

D-14 sequencing satisfied: this plan is green (scoped tests + backend build + frontend build all clean). Plan 134-02 (per-role wake-up CRUD removal — RoleModal tab, WS handlers, service functions, test files) is now safe to execute. The new global-CRUD surface is live and testable before any removal begins, so the fleet is never in an interim state where role-scope UI is gone but the new global surface isn't in place.

## Commits

| Commit | Task |
|--------|------|
| `0057fc4c` | Task 1 — feat(134-01): add getLocalWakeupsRoot() + export normalizeWakeupSlug |
| `a8016297` | Task 2 — feat(134-01): GET /wakeups fleet-wide LIST router + 12-case tests |
| `9bf67631` | Task 3 — feat(134-01): POST/PATCH/DELETE /wakeups per-host writes + 16-case tests |
| `83b77b08` | Task 4 — feat(134-01): wire /wakeups routers + add paired nginx location blocks |

## Self-Check: PASSED

- Files verified present:
  - src/backend/database/routes/wakeups-list.ts ✓
  - src/backend/database/routes/wakeups-list.test.ts ✓
  - src/backend/database/routes/wakeups-write.ts ✓
  - src/backend/database/routes/wakeups-write.test.ts ✓
- Commits verified in git log: 0057fc4c, a8016297, 9bf67631, 83b77b08 all present on feat/tab-title-from-tmux.
