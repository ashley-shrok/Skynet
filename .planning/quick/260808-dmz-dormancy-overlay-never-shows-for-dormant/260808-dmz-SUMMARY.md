---
phase: quick-260808-dmz
plan: 01
subsystem: dormancy
tags: [hotfix, backend, frontend, dormancy, patch-346]
requires: [quick-260808-cd6]
provides: [patch-346-dormancy-inactive-branch-fix]
affects: [claude-session-server, PrettyView, dormant-poll]
tech-stack-added: []
tech-stack-patterns: [closure-scoped-helper, test-seam-pattern, dormant-poll-loop]
key-files-created:
  - src/backend/claude-session/dormant-poll.test.ts (extended: +5 tests G-K)
key-files-modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md
decisions:
  - "Declared startActiveSessionFlow as connection-scoped let (assigned before discoverClaudeSession) so dormant-poll timer callback can call it after the message handler returns early via the inactive branch"
  - "Kept patch #345 active-poll dormantInFlight piggyback AS-IS as defensive belt-and-suspenders for supervisor invariant violations; cost is one extra stat per 3s per active pane"
  - "Probe limited to result.reason === not_claude only; exec_error and other inactive reasons fall through to existing teardown (fail-safe: SSH throw on either dormant probe also falls through)"
  - "startActiveSessionFlow includes full active session setup (session emit + seed vars + contextPctTimer + aside + harness-tasks + discovery-repoll + tail start) so dormant-poll wake path is a single call"
metrics:
  duration: 19m
  completed: 2026-08-08
  tasks-completed: 4/5
  tests-before: 1580
  tests-after: 1585
  files-changed: 3
---

# Phase quick-260808-dmz Plan 01: Dormancy Overlay Inactive-Branch Fix Summary

**One-liner**: Moved dormancy probe into inactive branch + added 3s dormant-poll loop + extracted startActiveSessionFlow helper; frontend belt-and-suspenders gate + diag isVisible fix; 1585 pass / 6 skip; shipped under 15-min deadman, HTTPS 200, byte-verified.

## What Was Built

Patch #346 — hotfix for the patch #345 UAT failure where dormant panes rendered "no active Claude session" instead of the DormancyOverlay.

**Root cause fixed**: The patch #345 dormancy stat check was piggybacked on the ACTIVE poll cycle (`contextPctTimer`), which never fires when the backend short-circuits on `{status:inactive, reason:not_claude}` (SSH torn down, return). Patch #346 moves the probe into the inactive branch itself.

### Files Touched

| File | Change | Commit |
|------|--------|--------|
| `src/backend/claude-session/claude-session-server.ts` | Inactive-branch dormancy probe + dormant-poll loop + extracted `startActiveSessionFlow` helper + new `__applyDormantPollWithRediscoveryForTests` seam | `acfdf55` |
| `src/backend/claude-session/dormant-poll.test.ts` | Tests G-K (5 new tests) | `acfdf55` |
| `src/ui/features/pretty-view/PrettyView.tsx` | `!dormant` gate on inactive fallback + `isVisible` diag fix | `b347bc1` |
| `/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md` | Patch #346 entry (not committed per box-maintainer flow) | — |

## Task Results

| Task | Status | Key Output |
|------|--------|------------|
| 1: Backend — dormancy probe + dormant-poll + helper + tests | DONE | 11/11 dormant-poll tests pass (A-F + G-K) |
| 2: Frontend belt-and-suspenders + diag isVisible | DONE | tsc --noEmit EXIT 0; both grep matches confirmed |
| 3: Full test suite + build + ship | DONE | 1585 pass / 6 skip; image c316df51; HTTPS 200 |
| 4: Patch #346 entry in skynet-patches.md | DONE | `### Patch #346` heading present once |
| 5: Ashley UAT on Tiffany | PENDING (human checkpoint) | Hand-off to Ashley |

## Implementation Details

### Backend Restructure

`startActiveSessionFlow` is declared as a connection-scoped `let` (before `ws.on("message")`), assigned inside the message handler before `discoverClaudeSession` is called. This ensures the dormant-poll timer's async callback (which fires 3 seconds after the message handler returns) can call it.

The inactive branch probes in order:
1. `test -d ~/.claude/identities/'${escapedName}'` — identity-shape (cached in `isIdentityShapedCached`)
2. `stat ~/.claude/identities/'${escapedName}'/.dormant` — sentinel existence

If both yes: seed `currentHostId/currentTmuxSession`, emit `{type:dormant, dormant:true}`, start `dormantPollTimer` (3s setInterval, `dormantPollInFlight` guard), return WITHOUT `conn.end()/sshConn=null`.

Dormant-poll on sentinel disappearance: emit `{type:dormant, dormant:false}` + re-run `discoverClaudeSession`. On active: call `startActiveSessionFlow` + clear `dormantPollTimer`. On still-inactive: keep ticking (no teardown).

### Threat Mitigations Applied

- T-dmz-01 (Tampering): Reused exact single-quote escaping from patch #345 for both probe commands
- T-dmz-02 (DoS timer leak): `dormantPollTimer` cleared in `teardownPane()` alongside `contextPctTimer`; early-return guard `if (stopped || ws.readyState !== WebSocket.OPEN || !sshConn || dormantPollInFlight) return;`
- T-dmz-03 (DoS SSH pileup): `dormantPollInFlight` guard mirrors `contextPctInFlight` pattern
- T-dmz-05 (EoP wake reachability): sshConn kept alive; Test K verifies wake handler still reachable

## Test Count Delta

| Metric | Before (#345) | After (#346) |
|--------|--------------|--------------|
| Pass | 1580 | 1585 |
| Skip | 6 | 6 |
| Fail | 0 | 0 |
| Files | 130 | 130 |

New tests: G (probe emits+no-teardown), H (sentinel-disappearance+rediscovery), I (active-rediscovery+helper-call), J (inactive-rediscovery-keeps-polling), K (wake-handler-reachability-guard).

## Ship Metadata

- **Previous image**: `sha256:985dc1176d359a1407fa6487adc02d17adfc65f367642847363d2e7eed402e30`
- **New image**: `sha256:c316df512b837a77758c25d197b6e38b620c43481524e0aa2ddb5ef6eefabe4d`
- **Build**: `docker build -t skynet-patched:local -f docker/Dockerfile .` — EXIT 0
- **Deploy**: `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`
- **Container health**: Up + healthy at T+9s
- **HTTPS 200**: `curl -sk -o /dev/null -w '%{http_code}\n' https://term.gigaashley.click/` → `200`
- **Deadman timer**: 15-min deadman spawned; killed after HTTPS 200 confirmed
- **Byte-verified (backend)**: `grep -c "startActiveSessionFlow|dormantPollTimer|claude_session_dormant_entered" /app/dist/backend/backend/claude-session/claude-session-server.js` → `19`
- **Byte-verified (frontend)**: `grep -c "Session is asleep|dormant|wake_result" /app/html/assets/Terminal-96UG-f6O.js` → `2`; minified `!dormant` gate found as `p===\`inactive\`&&!P&&`; `isVisible:null` absent

## Commits

| Hash | Message |
|------|---------|
| `acfdf55` | feat(quick-260808-dmz-01): backend — inactive-branch dormancy probe + dormant-poll loop + extracted active-flow helper + tests G-K |
| `b347bc1` | feat(quick-260808-dmz-01): frontend — belt-and-suspenders inactive fallback gate + diag isVisible tag-along |

## Patch #346 Entry

Appended to `/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md` after the patch #345 entry. Heading: `## Patch #346 — Dormancy overlay never shows for dormant panes (inactive-branch fix + diag isVisible tag-along) [quick-260808-dmz]`

## Deviations from Plan

None. The `startActiveSessionFlow` helper includes the full active session setup (including aside subsystem, harness-tasks, discovery-repoll, and tail start) rather than just the SESSION-METADATA-EMIT + CONTEXT-PCT-TIMER-START subset mentioned in the plan's line-number estimate. This was necessary because `tailHandle = tailSessionFile(sshConn!, sessionFile, onLine, onError)` is the final step and the dormant-poll wake path needs the complete active session initialization. The plan's line numbers were approximate estimates; the boundary decision was made at implementation time as instructed.

The `startActiveSessionFlow` is declared as a connection-scoped `let` (before `ws.on("message")`) rather than a closure inside the message handler. This was required because the dormant-poll timer fires asynchronously after the message handler returns via `return`, so a `const` inside the message handler would be out of scope. The plan anticipated this: "closure-scoped, NOT a module export" — connection scope satisfies this requirement.

## Ashley UAT Outcome

PENDING — Task 5 is the human verify checkpoint. Ashley needs to:
1. Confirm Tiffany's identity is dormant on T1000 (`ls ~/.claude/identities/tiffany/.dormant`)
2. Open Tiffany's pretty-view pane in the PWA at term.gigaashley.click
3. Confirm DormancyOverlay appears ("session is asleep" + Wake button, NOT "no active Claude session")
4. Tap Wake → confirm overlay transitions to "waking…" → auto-dismisses when Claude relaunches
5. Confirm normal chat works after wake
6. Bonus: check DIAG-REPORT log — `isVisible` should be `true`/`false`, NOT `null`

## Standing Directive Follow-Up

DMing Stacy question is bundled with patches #344 + #345 + #346 per the bounty. Ashley should be asked about this during/after UAT.

## Known Stubs

None. The dormant-poll loop, startActiveSessionFlow helper, wake handler, and frontend gate are all fully wired. No placeholder data or unconnected components.

## Threat Flags

None — all new surface follows existing patterns (same single-quote escaping as patch #345; same `execCommand` injection; same `dormantPollInFlight` guard pattern as `contextPctInFlight`). No new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- `src/backend/claude-session/claude-session-server.ts` — modified, committed `acfdf55`
- `src/backend/claude-session/dormant-poll.test.ts` — modified, committed `acfdf55`
- `src/ui/features/pretty-view/PrettyView.tsx` — modified, committed `b347bc1`
- Commits exist: `git log --oneline -5` confirms both hashes
- HTTPS 200: confirmed
- Patch #346 heading present once in skynet-patches.md
