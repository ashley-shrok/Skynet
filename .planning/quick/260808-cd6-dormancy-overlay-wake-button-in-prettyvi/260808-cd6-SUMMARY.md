---
phase: quick
plan: 260808-cd6
subsystem: pretty-view
tags: [dormancy, overlay, wake, agent-supervisor, websocket, backend, frontend]
dependency_graph:
  requires: [patch-344-ws-pause-on-hidden]
  provides: [dormant-detection, wake-button, dormancy-overlay]
  affects: [claude-session-server, pretty-view, compose-box]
tech_stack:
  added: [DormancyOverlay component, dormant-poll test seams]
  patterns: [emit-only-on-change, test-seam export, reconnectingActive mirror]
key_files:
  created:
    - src/backend/claude-session/dormant-poll.test.ts
    - src/ui/features/pretty-view/DormancyOverlay.tsx
    - src/ui/features/pretty-view/DormancyOverlay.test.tsx
    - src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx
  modified:
    - src/ui/api/claude-session-api.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
decisions:
  - Trust boundary T-cd6-01: wake uses only connection-scoped currentTmuxSession, never client-supplied hostId/session
  - Trust boundary T-cd6-02: tmux session names validated to [A-Za-z0-9_-] before single-quote shell wrapping
  - Trust boundary T-cd6-03: rm path hard-coded to ~/.claude/identities/<name>/.dormant only
  - Test seam pattern used instead of full server spin-up for dormant-poll tests
  - dormantRef stale-closure guard mirrors statusRef pattern already in PrettyView
  - Live-frame auto-dismiss (any message/context_pct/etc) clears dormant overlay without waiting for explicit wake_result:ok
  - dormantActive is 1:1 mirror of reconnectingActive at all 18 sites (no collapsed prop)
  - Waking state keeps DormancyOverlay mounted but hides Wake button (spinner shows progress)
metrics:
  duration: 140m
  completed: 2026-08-08
  tasks_completed: 6
  files_created: 5
  files_modified: 5
---

# Quick 260808-cd6: Dormancy Overlay + Wake Button in PrettyView Summary

One-liner: DormancyOverlay + Wake button integrated with agent-supervisor DORMANCY sentinel via backend 3s-poll stat + WS wake message handler + ComposeBox dormantActive gate.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | DormantEvent + WakeResultEvent types | fa7e1d1 | claude-session-api.ts |
| 2 | Backend dormant poll + wake handler + tests | 0e8aa65 | claude-session-server.ts, dormant-poll.test.ts (NEW) |
| 3 | DormancyOverlay component + unit tests | eba72c6 | DormancyOverlay.tsx (NEW), DormancyOverlay.test.tsx (NEW) |
| 4 | ComposeBox dormantActive prop + disable tests | 7d0ac49 | ComposeBox.tsx, ComposeBox.dormant-disable.test.tsx (NEW) |
| 5 | PrettyView wiring + 4 integration tests | bced4fe | PrettyView.tsx, PrettyView.test.tsx |
| 6 | Full suite green + ship + patch #345 entry (auto-drive) | — | skynet-patches.md (outside repo) |

## Test Results

- **Baseline**: 1556 pass / 6 skip / 0 fail (after patch #344, commit a55f14a)
- **Final**: 1580 pass / 6 skip / 0 fail (across 130 files)
- **Delta**: +24 new tests (6 dormant-poll + 7 DormancyOverlay + 7 ComposeBox.dormant-disable + 4 PrettyView integration)

## Deploy

- Pre-deploy image digest: `sha256:7862e7a6276cb124cf8be933b5ee848705efe839c5ccf2ff3c9b0713215216f8`
- New image: `b4a0641f60b3` (built 2026-08-08, skynet-patched:local)
- Deadman timer: spawned (PID 3915717, 900s), killed after health check passed
- Health check: HTTPS 200 on first attempt (T+1s)
- Byte-verified: `dormantActive`, `wake_result`, `dormant` present in `/app/html/assets/Terminal-DvYiKZWH.js`

## Human Verify Hand-off (Ashley UAT)

Ashley should verify by opening a PrettyView pane for a dormant identity and confirming:
1. DormancyOverlay appears (moon glyph, "session is asleep", Wake button).
2. Send + Reset + ThumbsUp + Recap are disabled while overlay is visible; textarea and mic still work.
3. Tapping Wake sends the wake request; overlay transitions to "waking…" with elapsed hint at 15s.
4. When agent-supervisor relaunches Claude in the pane, any live frame (message/context_pct/etc) dismisses the overlay automatically.
5. If wake fails (supervisor not running), error card appears with retry Wake button.

## Deviations from Plan

None — plan executed exactly as written. All trust boundaries (T-cd6-01, T-cd6-02, T-cd6-03) applied as specified.

## Known Stubs

None. DormancyOverlay receives live props from PrettyView state that is driven by real WS events.

## Threat Flags

No new network endpoints or trust boundaries beyond those specified in the plan's threat model. T-cd6-01/02/03 applied as required.

## Self-Check: PASSED

Files confirmed present:
- /home/ubuntu/skynet/src/backend/claude-session/dormant-poll.test.ts — FOUND
- /home/ubuntu/skynet/src/ui/features/pretty-view/DormancyOverlay.tsx — FOUND
- /home/ubuntu/skynet/src/ui/features/pretty-view/DormancyOverlay.test.tsx — FOUND
- /home/ubuntu/skynet/src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx — FOUND

Commits confirmed:
- fa7e1d1 (types)
- 0e8aa65 (backend + tests)
- eba72c6 (DormancyOverlay + test)
- 7d0ac49 (ComposeBox prop + test)
- bced4fe (PrettyView wiring + integration tests)
