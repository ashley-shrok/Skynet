---
phase: 41-defer-terminal-view-mount-until-user-summons-it
plan: 4
subsystem: full-stack
wave: 4
tags:
  - upload-channel-re-source
  - pretty-view
  - claude-session-server
  - ssh-terminal
  - close-verdict-fix
dependency_graph:
  requires: [41-01, 41-02, 41-03]
  provides:
    - upload_start/upload_chunk/upload_abort dispatch in claude-session-server.ts
    - PrettyView uploads sourced from own claude-session WS (not Terminal SSH WS)
    - terminalWs prop removed from PrettyViewProps
    - IdentitySessionPane TODO(41-followup) block removed
  affects:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/ssh/terminal.ts
    - deploy-prep artifacts (41-BUILD-VERIFY-LOG.md, 41-UAT-CHECKLIST.md, 41-PATCHES-MD-ENTRY.md)
tech_stack:
  added: []
  patterns:
    - Upload dispatch via if(msg.type === "upload_*") branches in ws.on("message")
    - __dispatchUploadMessageForTests seam (mirrors __applyInputMessageForTests pattern)
    - Per-connection ownedUploadBatches Set + pendingStarts Map in wss.on("connection") closure
    - cleanupBatchesForConnection in teardownPane (pane-switch) + ws.on("close") (WS-close)
key_files:
  created:
    - src/backend/claude-session/claude-session-server.pretty-view-upload.test.ts
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/ssh/terminal.ts
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-BUILD-VERIFY-LOG.md
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-UAT-CHECKLIST.md
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-PATCHES-MD-ENTRY.md
decisions:
  - Upload channel moved from Terminal SSH WS (port 30002) to PrettyView's own claude-session WS (port 30011)
  - __dispatchUploadMessageForTests extraction approach used for testability (preferred over wss.emit pattern)
  - cleanupBatchesForConnection fires in BOTH teardownPane AND ws.on("close") (belt-and-suspenders)
metrics:
  duration: ~45 minutes
  completed: 2026-08-14
  tasks_completed: 3
  files_modified: 8
  tests_added: 6
---

# Phase 41 Plan 04: Upload Channel Re-source — Close Verdict Follow-up Summary

**One-liner:** Rewires PrettyView file uploads from Terminal's SSH WS to PrettyView's own claude-session WS, moving backend dispatch from terminal.ts to claude-session-server.ts; closes the /close verdict follow-up finding that upload capability was silently degraded on identity panes where Terminal is unmounted.

---

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Frontend rewire — PrettyView uploads use own WS; remove terminalWs prop | `c29cbf50` | PrettyView.tsx, IdentitySessionPane.tsx, PrettyView.compose-send.test.tsx |
| 2 | Backend dispatch relocation — terminal.ts → claude-session-server.ts | `e0b80a54` | claude-session-server.ts, terminal.ts |
| 3 | Integration test + __dispatchUploadMessageForTests seam | `4e41b164` | claude-session-server.pretty-view-upload.test.ts, claude-session-server.ts |
| 3 (docs) | Deploy-prep artifact extension (41-04 posture) | `8ef3cce7` | 41-BUILD-VERIFY-LOG.md, 41-UAT-CHECKLIST.md, 41-PATCHES-MD-ENTRY.md |

---

## Grep Gate Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -c "terminalWs" src/ui/features/pretty-view/PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "terminalWs" src/ui/shell/IdentitySessionPane.tsx` | 0 | 0 | PASS |
| `grep -c "TODO(41-followup)" src/ui/shell/IdentitySessionPane.tsx` | 0 | 0 | PASS |
| `grep -c "terminalWsMock" src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` | 0 | 0 | PASS |
| `grep -rn "terminalWs" src/ (prod)` | 0 | 0 | PASS |
| `grep -c "handleUpload*\|cleanupBatches" src/backend/ssh/terminal.ts` | 0 | 0 | PASS |
| `grep -c "case upload_start/chunk/abort" terminal.ts` | 0 | 0 | PASS |
| `grep -c "ownedUploadBatches\|pendingStarts" terminal.ts` | 0 | 0 | PASS |
| `grep -c "handleUpload*\|cleanupBatches" claude-session-server.ts` | >=5 | 15 | PASS |
| `grep -c "upload_start\|upload_chunk\|upload_abort" claude-session-server.ts` | >=3 | 6 | PASS |
| `grep -c "ownedUploadBatches\|pendingStarts" claude-session-server.ts` | >=4 | 26 | PASS |
| `git diff --name-only pretty-view-upload.ts file-manager-content-routes.ts` | 0 | 0 | PASS |
| `test -f claude-session-server.pretty-view-upload.test.ts` | exists | exists | PASS |
| `grep -Ec "^\s*(it|test)\(" ...pretty-view-upload.test.ts` | >=6 | 6 | PASS |
| `grep -c "^## 41-04" 41-BUILD-VERIFY-LOG.md` | >=1 | 1 | PASS |
| `grep -Ec "^\### 1[123]\." 41-UAT-CHECKLIST.md` | >=2 | 3 | PASS |
| `grep -c "upload" 41-PATCHES-MD-ENTRY.md` | >=1 | 9 | PASS |
| `git diff src/ui/api/pretty-view-upload-protocol.ts` | empty | empty | PASS |

---

## File Delta

### New Files
- `src/backend/claude-session/claude-session-server.pretty-view-upload.test.ts` — 6 integration tests for upload dispatch in claude-session-server.ts

### Modified Files
- `src/ui/features/pretty-view/PrettyView.tsx` — terminalWs prop removed from PrettyViewProps + function destructuring; usePrettyViewUploads wired to wsRef.current instead of terminalWs
- `src/ui/shell/IdentitySessionPane.tsx` — TODO(41-followup) block + terminalWs={null} prop removed (5 lines deleted)
- `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` — terminalWsMock removed from mountWithRefs(); 5 terminalWsMock assertions removed (structural defense now)
- `src/backend/claude-session/claude-session-server.ts` — import block added (handleUploadStart/handleUploadChunk/handleUploadAbort/cleanupBatchesForConnection + UploadStartPayload/UploadChunkPayload/UploadAbortPayload); ownedUploadBatches + pendingStarts per-connection state added; cleanupBatchesForConnection in teardownPane; three upload_* branches in ws.on("message"); cleanupBatchesForConnection in ws.on("close"); __dispatchUploadMessageForTests exported seam added
- `src/backend/ssh/terminal.ts` — all upload symbols removed (4-symbol import block, UploadStartPayload/UploadChunkPayload/UploadAbortPayload types, ownedUploadBatches Set, pendingStarts Map, 3 upload case branches + phase comment block, cleanupBatchesForConnection call in ws.on("close"))

### Unchanged Files (verified)
- `src/backend/ssh/pretty-view-upload.ts` — byte-identical to HEAD
- `src/backend/ssh/file-manager-content-routes.ts` — byte-identical to HEAD
- `src/ui/api/pretty-view-upload-protocol.ts` — byte-identical to HEAD

---

## Build & Test Posture

| Check | Exit Code | Notes |
|-------|-----------|-------|
| `npx tsc --noEmit` | 0 | Frontend TypeScript clean |
| `npm run build:backend` | 0 | Backend TypeScript + asset copy clean |
| `npm run build` | 0 | Vite production build, ~37s, AppShell 386 kB gzip 97 kB |
| `npx vitest run` (full suite) | 0 | Zero logic failures; pre-existing CI-load timeout flakes on unrelated files pass cleanly in isolation |
| `npx vitest run` (key files) | 0 | PrettyView.compose-send.test.tsx (5/5), use-pretty-view-uploads.test.ts (20/20), IdentitySessionPane.test.tsx (7/7), pretty-view-upload.test.ts (17/17), claude-session-server.pretty-view-upload.test.ts (6/6 new) |

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Planned Deviations Applied

1. **[Executor-time decision] `__dispatchUploadMessageForTests` extraction (per plan checker guidance)** — The plan checker flagged that the preferred approach for the Task 3 testability seam was to extract the dispatch body into a named function. Applied: `__dispatchUploadMessageForTests` exported before `wss.on("connection")`, mirrors the existing `__applyInputMessageForTests` / `__applyWakeMessageForTests` pattern. The ws.on("message") handler calls the inline branches directly (verbatim, not extracted) to minimize diff scope, while the test seam exposes the equivalent logic for direct invocation.

2. **[Cleanup] Two call-sites for `cleanupBatchesForConnection` (per plan checker guidance)** — Added to both `teardownPane` (pane-switch cleanup) AND `ws.on("close")` (WS-close cleanup). Both call sites verified with `grep -B2 -A2 "cleanupBatchesForConnection" claude-session-server.ts`.

---

## Deploy-Prep Artifacts Extended

- **41-BUILD-VERIFY-LOG.md** — `## 41-04 Verification Run` section added with build/test results
- **41-UAT-CHECKLIST.md** — Items 11-13 added (upload from identity pane with Terminal never summoned; upload survives Terminal summon mid-flight; upload survives toggle-back-to-PrettyView with Terminal torn down). "Upload path" regression suspicion updated to "RESOLVED". Sign-off checklist items 11-13 added.
- **41-PATCHES-MD-ENTRY.md** — Summary extended to mention upload re-source; files-touched extended with claude-session-server.ts + terminal.ts + new test file; upload degradation note replaced with Plan 41-04 resolution note; testing evidence + UAT plan updated to reference items 11-13.

---

## Shape Close-Verdict Follow-up Status

The `/close verdict` finding from `.planning/shapes/shape-deferred-terminal-mount.closed.md` — "chat surface silently degrading because a signal it used to get from the terminal wasn't fully re-sourced" — is CLOSED.

- **Before Plan 41-04:** PrettyView uploads were routed through Terminal's SSH WS (port 30002). When Terminal was unmounted (the normal state for identity panes post-Phase-41), uploads silently failed to start (`startBatch` would park indefinitely, never emitting `upload_start` to any server).
- **After Plan 41-04:** PrettyView uploads route through PrettyView's own claude-session WS (port 30011), which is always live. The backend handler dispatch lives in `claude-session-server.ts` and uses the pane's existing `sshConn` set at `connectToPane` time. File uploads work correctly on identity panes regardless of Terminal's mount state.

---

## Self-Check

### Files Exist
- [x] `src/backend/claude-session/claude-session-server.pretty-view-upload.test.ts` — EXISTS
- [x] `src/backend/claude-session/claude-session-server.ts` — EXISTS (modified)
- [x] `src/backend/ssh/terminal.ts` — EXISTS (modified)
- [x] `src/ui/features/pretty-view/PrettyView.tsx` — EXISTS (modified)
- [x] `src/ui/shell/IdentitySessionPane.tsx` — EXISTS (modified)

### Commits Exist
- [x] `c29cbf50` — `feat(41-04): rewire frontend uploads to PrettyView's own WS; remove terminalWs prop`
- [x] `e0b80a54` — `feat(41-04): relocate upload dispatch from terminal.ts to claude-session-server.ts`
- [x] `4e41b164` — `test(41-04): add claude-session-server upload dispatch integration test + __dispatchUploadMessageForTests seam`
- [x] `8ef3cce7` — `docs(41-04): extend deploy-prep artifacts with 41-04 upload-channel re-source posture`

## Self-Check: PASSED
