---
phase: quick-260808-fgf
plan: 01
subsystem: dormancy
tags: [backend, dormancy, supervisor-coordination, nelly, patch-348, patch-349]
requires: [quick-260808-dmz, quick-260808-cd6]
provides: [patch-349-resume-complete-marker-consumption]
affects: [claude-session-server, dormant-poll]
tech-stack-added: []
tech-stack-patterns: [closure-scoped-getter-accessor, injectable-clock-dep, seam-extension-pattern]
key-files-created: []
key-files-modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/dormant-poll.test.ts
  - /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md
decisions:
  - "Natural-resume path (wakeTriggerTs null) short-circuits freshness check entirely — preserves all prior G H I J behavior without any changes to those test setups"
  - "wakeTriggerTs recorded AFTER seam awaits (post-SSH-exec success moment) via wsSend interception rather than modifying __applyWakeMessageForTests — preserves Tests E/F/K shape contract"
  - "markerCommand uses cat ... || echo rather than cat ... 2>/dev/null to ensure empty output on absent file; collapsed to null downstream so absent == empty == error at dismiss logic"
  - "Patch numbers renumbered: #347 was already taken (status-text-centering fix) so copy polish became #348 and marker consumption became #349 to preserve chronological ordering"
metrics:
  duration: 60m
  completed: 2026-08-08
  tasks-completed: 3/3
  tests-before: 1585
  tests-after: 1589
  files-changed: 2
---

# Phase quick-260808-fgf Plan 01: Skynet Consumes .resume-complete Marker Summary

**One-liner**: Extended dormant-poll seam with Nelly's freshness contract (marker_ts > wake_trigger_ts, 90s fallback) plus 4 tests L-O; shipped with copy polish 06bcb4d riding along; 1589 pass / 6 skip / 0 fail; HTTPS 200 sustained.

## What Was Built

Patch #349 — Skynet-side consumption of Nelly's `.resume-complete` supervisor-hands-off marker. Closes the interleave window where patch #345's live-frame auto-dismiss fired DURING the supervisor's Ctrl-C train + bracketed-paste + nudge Enter sequence.

### Files Touched

| File | Change | Commit |
|------|--------|--------|
| `src/backend/claude-session/claude-session-server.ts` | `MARKER_FALLBACK_MS` constant + `wakeTriggerTs` closure + wake handler recording + seam signature extension + sentinel-gone branch rewrite + production wiring | `6b94b26` |
| `src/backend/claude-session/dormant-poll.test.ts` | Tests L M N O (4 new marker-consumption tests) + updated G H I J with new seam deps | `6b94b26` |
| `/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md` | Patch #348 (copy polish, standalone) + Patch #349 (marker consumption, full entry) | not committed per box-maintainer flow |

## Task Results

| Task | Status | Key Output |
|------|--------|------------|
| 1: Backend seam extension + wakeTriggerTs + freshness logic | DONE | tsc EXIT 0; all 4 identifier grep counts met |
| 2: Tests L M N O + update G H I J | DONE | 15/15 dormant-poll tests; 1589 pass / 6 skip full suite |
| 3: Ship + deadman + HTTPS 200 + patch entries | DONE | Container healthy; HTTPS 200; #348 + #349 appended; deadman disarmed |

## Implementation Details

### Freshness Contract Logic

The sentinel-gone branch in `__applyDormantPollWithRediscoveryForTests` now:

1. Reads `triggerTs = state.wakeTriggerTs()`
2. If `triggerTs === null` (natural resume, no user Wake click): falls through to prior dismiss-plus-rediscover behavior unchanged (Tests G H I J preserved)
3. If `triggerTs !== null` (user-initiated wake path):
   - Calls `markerCommand(conn, name)` to cat `.resume-complete`
   - If body parseable AND `marker_ts > triggerTs`: `markerFresh = true`
   - Else: computes `elapsed = now() - triggerTs`; if `>= 90_000`: `markerFresh = true`, `fellBack = true`
   - If `markerFresh === false`: returns early (keep polling — give supervisor time to write marker)
   - If `fellBack`: logs `dormancy_marker_fallback` info entry
   - Falls through to emit dormant:false + rediscover + maybe startActiveFlow

### wakeTriggerTs Lifecycle

- Declared: connection scope alongside `dormantPollTimer`
- Set: wake handler, after `__applyWakeMessageForTests` resolves, if intercepted `wake_result.ok === true`
- Cleared: inside `startActiveFlow` callback (belt-and-suspenders — handles within-single-WS pane rediscover cycles)
- Natural reset: closure on WS close

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Patch numbers renumbered (#347→#348, #348→#349)**
- **Found during:** Task 3 STEP D (writing patch entries)
- **Issue:** Plan specified #347 for copy polish and #348 for marker consumption, but `## Patch #347` was already present in skynet-patches.md (a status-text-centering fix committed earlier today, not related to this quick task)
- **Fix:** Copy polish written as #348; marker consumption written as #349 to preserve strict chronological ordering of the patch catalog
- **Files modified:** `/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md`
- **Commit:** N/A (patches file not committed per box-maintainer flow)

**2. [Rule 3 - Blocking] Docker build cache returned stale backend bundle**
- **Found during:** Task 3 STEP C (byte-verify after first deploy)
- **Issue:** `docker compose build skynet` with build cache hit an old `tsc` compilation layer; container had 3870-line claude-session-server.js with no MARKER_FALLBACK token
- **Fix:** Rebuilt with `docker build --no-cache` which forced fresh `npm run build:backend` inside the container; new image sha256:cd31395fea412d84b7b9df1d7df965911d65c7995accae8d14ce554067633a5a shows correct 4297-line output with all tokens present
- **Files modified:** None (deploy fix only)

## Test Count Delta

| Metric | Before (post-06bcb4d) | After (#349) |
|--------|----------------------|--------------|
| Pass | 1585 | 1589 |
| Skip | 6 | 6 |
| Fail | 0 | 0 |
| Files | 130 | 130 |

New tests: L (fresh-marker → dismiss+startActiveFlow), M (stale-marker → keep-polling), N (absent-marker + 91s → fallback-dismiss), O (absent-marker + 30s → keep-polling).

## Ship Metadata

- **Previous image**: `sha256:c316df512b837a77758c25d197b6e38b620c43481524e0aa2ddb5ef6eefabe4d` (patch #346)
- **New image**: `sha256:cd31395fea412d84b7b9df1d7df965911d65c7995accae8d14ce554067633a5a`
- **Build**: `docker build --no-cache -t skynet-patched:local -f docker/Dockerfile .` — EXIT 0
- **Deploy**: `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`
- **Container health**: Up + healthy (T+12s on second deploy)
- **HTTPS 200**: `curl -sk -o /dev/null -w '%{http_code}\n' https://term.gigaashley.click/` → `200`
- **Deadman timer**: 15-min deadman armed before each build; both disarmed cleanly after HTTPS 200 confirmed (no rollback fired)
- **Backend byte-verify**: `MARKER_FALLBACK|wakeTriggerTs` → 14; `resume-complete` → 7; `dormancy_marker_fallback` → 1
- **Frontend byte-verify**: `This session is asleep|Waking up` in Terminal-CEeXZwdk.js → 1 (copy polish confirmed)

## Ashley UAT Pending

Ashley UAT is the human-verify hand-off:

1. Open Tiffany's PWA pane while dormant. DormancyOverlay shows.
2. Click Wake. Overlay stays up through entire Ctrl-C train (~10s, Nelly reduced from 20s) + bracketed-paste + final Enter.
3. Overlay dismisses ONLY after Nelly's `.resume-complete` marker appears with `marker_ts > wake_trigger_ts`.
4. Confirm typing during the wait window is safe (no interleave with supervisor paste).
5. On a pre-marker supervisor box: overlay dismisses after 90s fallback; `dormancy_marker_fallback` appears in logs.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. SSH commands are limited to `cat` on a known path with single-quote-wrapped identity name (same escaping pattern as all prior dormancy commands).

## Self-Check: PASSED

- `src/backend/claude-session/claude-session-server.ts` modified: confirmed (290 lines added)
- `src/backend/claude-session/dormant-poll.test.ts` modified: confirmed (155 lines added)
- Commit `6b94b26` exists: confirmed (`git log --oneline -5`)
- Container Up + healthy: confirmed
- HTTPS 200: confirmed
- Patch #348 and #349 headings in skynet-patches.md: confirmed (`grep -c "^## Patch #34[89]"` → 2)
