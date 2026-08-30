---
phase: quick-260810-n3a
plan: 01
subsystem: conversations-ui, backend-ssh
tags: [kill-session, context-menu, ssh, tmux, security]
dependency_graph:
  requires: []
  provides: [POST /host/:hostId/session/kill, Kill context-menu item, onKillRow wiring]
  affects: [src/backend/database/routes/host.ts, src/ui/api/sessions-api.ts, src/ui/AppShell.tsx, src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx]
tech_stack:
  added: []
  patterns: [connectOneShot+execCommand SSH one-shot, vi.mock test pattern from sessions.test.ts, PrettyConversationContextMenu danger:true styling]
key_files:
  created:
    - src/backend/database/routes/host.session-kill.test.ts
  modified:
    - src/backend/database/routes/host.ts (lines 1–6 imports, 2349–2470 new route)
    - src/ui/api/sessions-api.ts (lines 1–43 full file with new export)
    - src/ui/AppShell.tsx (line 67 import update, lines 1508–1530 onKillRow prop)
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (prop destructure + type + items[] builder)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (prop + type + handleRowKill + 5 render sites)
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (K1-K7 appended)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (K8-K10 appended)
decisions:
  - "onKill prop threaded to all 5 row render sites (active-set, pinned, RDP, grouped, hidden) — RDP rows receive it but the row's !isRdp gate filters it out, matching the unconditional onDeactivate pattern from quick-260804-uo4"
  - "PER_HOST_KILL_TIMEOUT_MS = 3000ms declared locally in host.ts, matching sessions.ts pattern"
  - "K7 uses toMatch(/rgb|hex/) because jsdom normalizes hex colors to rgb() in computed style"
metrics:
  duration: "~12 minutes"
  completed: "2026-08-10"
  tasks: 3
  files: 7
---

# quick-260810-n3a: Kill option in conversation-list context menu for non-identity sessions

**One-liner:** Backend SSH route (`POST /host/:hostId/session/kill`) + frontend API caller + AppShell wiring + panel confirm dialog + Row context-menu Kill item gated on `!isRdp && !identity && row.targetTmuxSession`.

## Files Touched

| File | Lines | Change |
|------|-------|--------|
| `src/backend/database/routes/host.ts` | 2350–2470 (new route) + imports | Added `router.post("/:hostId/session/kill", authenticateJWT, requireDataAccess, ...)` |
| `src/backend/database/routes/host.session-kill.test.ts` | 1–459 (new file) | 10 tests for backend route |
| `src/ui/api/sessions-api.ts` | 19–44 (new export) | `killTmuxSession(hostId, tmuxSession): Promise<void>` |
| `src/ui/AppShell.tsx` | 67 (import), 1508–1530 (prop) | Import killTmuxSession; add `onKillRow` closure on PrettyConversationsPanel |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` | ~138 (destructure), ~180 (prop type), ~990–1008 (items[]) | Add `onKill` prop; Kill item after Deactivate |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | ~148 (PrettyConversationRowLive type), ~192 (destructure), ~238 (type), ~681–696 (handleRowKill), 5 render sites | Add `onKillRow` prop + `handleRowKill` + thread `onKill` |
| `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | 2192–2372 (appended) | K1-K7 tests |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 2679–2868 (appended) | K8-K10 tests |

## Test Additions (K1-K10)

**PrettyConversationRow.test.tsx (K1-K7):**
- K1: non-RDP, no identity, targetTmuxSession set, onKill provided → Kill in menu
- K2: identity resolves → Kill NOT in menu (identity gate)
- K3: RDP row → Kill NOT in menu (isRdp gate)
- K4: targetTmuxSession = null → Kill NOT in menu
- K5: onKill NOT provided → Kill NOT in menu
- K6: all gates satisfied → click Kill → onKill called exactly once
- K7: Kill menuitem has danger styling (rgb(255, 154, 138) — PrettyConversationContextMenu danger branch)

**PrettyConversationsPanel.test.tsx (K8-K10):**
- K8: clicking Kill opens window.confirm with session name + host name in message
- K9: window.confirm returns false → onKillRow NOT called
- K10: window.confirm returns true → onKillRow called exactly once with the correct row

## Backend route line

```
router.post("/:hostId/session/kill", authenticateJWT, requireDataAccess, async (req: Request, res: Response) => {
```

No `upload.single` / multipart middleware on this route — only `authenticateJWT` + `requireDataAccess`.

## Vitest Results

- **Exit code:** 0
- **Test files:** 144 passed (144)
- **Tests:** 1843 passed, 7 skipped, 1 todo — **0 failures**

## Build Results

- **`npm run build:backend` exit code:** 0
- **`npm run build` exit code:** 0

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new network endpoints, auth paths, or trust boundary surfaces beyond the plan's declared scope. All mitigations in the threat register (T-n3a-01 through T-n3a-06) are implemented:

- T-n3a-01: `/^[A-Za-z0-9._-]+$/` allowlist before any shell interpolation; test 3 asserts connectOneShot call count = 0 on injection attempt
- T-n3a-02: authenticateJWT + requireDataAccess on route; test 9 asserts 401
- T-n3a-03: SSH error returns `{ error: <message> }` — raw host credentials not included in response body
- T-n3a-05: `sshLogger.info({ operation: "session_kill", hostId, tmuxSession, userId })` on success

## Self-Check

- [x] `src/backend/database/routes/host.ts` — exists with kill-session route
- [x] `src/backend/database/routes/host.session-kill.test.ts` — exists, 10 tests
- [x] `src/ui/api/sessions-api.ts` — killTmuxSession export present
- [x] `src/ui/AppShell.tsx` — onKillRow prop wired
- [x] `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — Kill item in items[] builder
- [x] `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — handleRowKill + 5 render sites
- [x] Commits: b5db760, bfc8778, 04cfc8b all present in git log

## Self-Check: PASSED
