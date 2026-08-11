---
phase: 31-whole-app-structured-logging-backfill
plan: "08"
subsystem: backend-surface-instrumentation
tags: [d03-backend-surface, d05-silent-catch-elimination, d11-msg-shape, d13-taxonomy, d16-cross-side-correlation, ws-server, session-server, pane-state-emitter, session-parser, tmux-helper, host-db, voice-server]
dependency_graph:
  requires:
    - 31-07 (backend log transport — Logger.* now auto-writes to console-forward.log with source=backend)
  provides:
    - [ws-server] accept/close/error/send-failed log lines in claude-session-server.ts
    - [session-server] attach/detach log lines in claude-session-server.ts
    - 109 former silent-catch sites now emit structured [ws-server] send-failed warns
    - [pane-state-emitter] emit/emit-suppressed-dedupe log lines in pane-state-emitter.ts
    - [session-parser] classify log lines in session-file-parser.ts
    - [tmux-helper] exec/exec-failed/exec-nonzero log lines in tmux-helper.ts
    - [host-db] prefix on all 53 existing log calls in host.ts
    - [voice-server] prefix on all 14 log calls in voice.ts + new boundary lines
  affects:
    - 31-09 (grep verification — all enumerated prefix counts are now verifiable)
tech_stack:
  added: []
  patterns:
    - databaseLogger.warn with err.message extraction replacing silent catch sites (D-05 backend variant)
    - [prefix] verb-phrase key=value msg shape (D-11) applied to all 6 files
    - 1:1 wire-frame correlation via pane-state-emitter emit log (D-16)
key_files:
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/pane-state-emitter.ts
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/database/routes/host.ts
    - src/backend/database/routes/voice.ts
    - src/backend/ssh/tmux-helper.ts
decisions:
  - "pane-state-emitter.ts: added databaseLogger import despite module's 'pure' comment — logger.ts imports only chalk + console-forward-transport, no auth side-effects in test"
  - "session-file-parser.ts: hostId/sessionId not available (pure parsing function) — logged classification without these fields; noted in Known Data-in-Scope Gaps"
  - "claude-session-server.ts: converted ALL 109 silent-catch sites (104 catch{ignore} + 5 catch{ws may be mid-close}), plus 8 multi-line /* ignore */ blocks"
  - "tmux-helper.ts: hostId not a parameter of execCommand — logged command prefix only; callers who have hostId can correlate via sshLogger's session context"
  - "host.ts response JSON error strings restored to natural language after bulk replace accidentally updated them"
metrics:
  duration: "21 minutes"
  completed: "2026-08-11T12:31:44Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 6
---

# Phase 31 Plan 08: Backend Surface Instrumentation Summary

**One-liner:** Six backend files instrumented with D-11/D-13 structured log lines; 109 silent-catch sites in claude-session-server.ts converted to [ws-server] send-failed warns with err.message extraction; cross-side correlation wired via pane-state-emitter 1:1 emit logs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | claude-session-server.ts WS lifecycle + silent-catch elimination | 4ec5cb7 | claude-session-server.ts |
| 2 | pane-state-emitter, session-file-parser, tmux-helper | 6bb2f65 | pane-state-emitter.ts, session-file-parser.ts, tmux-helper.ts |
| 3 | host.ts + voice.ts prefix normalization | a503187 | host.ts, voice.ts |

## What Was Built

### Task 1: src/backend/claude-session/claude-session-server.ts

**WS lifecycle logs added:**
- `[ws-server] accept` at WS connection accept with userId + wsUrl
- `[ws-server] close` at WS close with hostId + tmuxSession + code + reason
- `[ws-server] error` at WS error handler with hostId + tmuxSession

**Session attach lifecycle logs added:**
- `[session-server] attach` at connectToPane handler entry with hostId + tmuxSession + userId
- `[session-server] detach` in teardownPane when pane was active

**Silent-catch site elimination (D-05 backend variant):**
- 104 inline `catch { /* ignore */ }` sites converted
- 5 `catch { /* ws may be mid-close */ }` sites converted
- 8 multi-line `catch { \n /* ignore */ \n }` blocks converted (tailHandle.stop, sshConn.end, ws.send, conn.end)
- **Total: 109 former silent-catch sites** now emit `databaseLogger.warn([ws-server] send-failed ...)` or equivalent with `err.message` extraction

**Catch site breakdown by type:**
- `try { ws.send(...) } catch` → `[ws-server] send-failed msgType=TYPE err=...` (63 inline + 22 multiline = 85 ws.send sites)
- `try { conn.end(); } catch` → `[ws-server] conn-end-failed err=...` (17 sites)
- `try { tailHandle.stop(); } catch` → `[ws-server] tail-stop-failed err=...` (2 sites)
- Outer try blocks → `[ws-server] send-failed err=...` (5 sites)

**New import:** `databaseLogger` added alongside existing `sshLogger` import.

### Task 2: Three backend files

**pane-state-emitter.ts (+3 lines, +1 import):**
- `[pane-state-emitter] emit state=X reason="Y" prevState=Z prevReason="W"` — fires on EVERY successful emit (after dedupe check passes)
- `[pane-state-emitter] emit-suppressed-dedupe state=X reason="Y"` — fires when dedupe gate suppresses a duplicate emit
- Provides 1:1 correlation between wire frame and log line (D-16)

**session-file-parser.ts (+5 log lines, +1 import):**
- `[session-parser] classify result=malformed bytesRead=N` — on JSON parse failure
- `[session-parser] classify result=relay_inbound room="X" eventId=Y` — on relay inbound detection
- `[session-parser] classify result=relay_outbound room="X" eventId=Y` — on relay outbound detection
- `[session-parser] classify result=image role=X imageCount=N eventId=Y` — on image classification
- `[session-parser] classify result=message role=X contentLen=N eventId=Y` — on message classification
- NOTE: hostId/sessionId NOT in scope (pure parsing function with no session context) — see Known Data-in-Scope Gaps

**tmux-helper.ts (+4 log lines, sshLogger already imported):**
- `[tmux-helper] exec command="..."` at execCommand entry (command truncated to 80 chars per T-31-20)
- `[tmux-helper] exec-failed command="..."` on SSH exec channel error callback
- `[tmux-helper] exec-failed command="..."` on stream.on("error") 
- `[tmux-helper] exec-nonzero command="..." code=N stderrLen=N` on non-zero exit with no stdout
- NOTE: hostId not a parameter of execCommand — logs command prefix only

### Task 3: host.ts + voice.ts

**host.ts:**
- 53 existing log calls prefixed with `[host-db]` and converted from sentence-form to verb-phrase form per D-11
- Example: `"Failed to save SSH host to database"` → `"[host-db] create-host-failed"`
- Full mapping: create-host-start/ok/failed, update-host-start/ok/failed, fetch-host*/delete-host*, quick-connect-failed, session-kill-*, export-host*, notify-stats-*, opkssh-*
- API response error strings restored to natural language (bulk replace accidentally overwrote them; fixed)

**voice.ts:**
- 6 existing error logs prefixed with `[voice-server]` + verb-phrase reshape
- 8 new boundary lines added (previously missing):
  - `[voice-server] transcribe-req byteSize=N mimetype=X` at handleTranscribe entry
  - `[voice-server] transcribe-ok status=200 textLen=N` at transcribe success
  - `[voice-server] speak-req textLen=N voice="X"` at handleSpeak entry
  - `[voice-server] speak-ok status=200 byteSize=N` at speak success
  - `[voice-server] speak-stream-req textLen=N voice="X"` at handleSpeakStream entry
  - `[voice-server] speak-stream-ok status=200` at stream pipe start
  - `[voice-server] list-voices-timeout` and `[voice-server] list-voices-proxy-error`

## Verification

```
npm run build:backend    → exit 0
npm run build            → exit 0 (frontend unaffected)
npx vitest run src/backend/  → 714 tests, all passed
```

**Prefix distribution:**
```
[ws-server]         120  (>= 20 ✓)
[session-server]      2  (>= 2 ✓)
[pane-state-emitter]  2  (>= 2 ✓)
[session-parser]      5  (>= 3 ✓)
[tmux-helper]         4  (>= 3 ✓)
[host-db]            53  (>= 20 ✓)
[voice-server]       14  (>= 4 ✓)
```

**Silent-catch elimination:**
```
git grep -v '^\s*//' src/backend/claude-session/claude-session-server.ts | grep -c 'catch { /* ignore */ }'
→ 0 ✓
```

## Known Data-in-Scope Gaps

**session-file-parser.ts — hostId/sessionId absent:**  
`parseSessionLine()` is a pure function with signature `(line: string): ParsedLine`. It has no access to hostId or tmuxSession — these are only available in the caller context (claude-session-server.ts). The `[session-parser] classify` log lines therefore omit the D-12 standard fields. To add them would require threading a `logContext: {hostId, tmuxSession}` parameter through `parseSessionLine`, which would change the public API of the module (affecting 7+ test files and all callers). This is a follow-up improvement if cross-side correlation to the classifier level is needed.

**tmux-helper.ts — hostId absent:**  
`execCommand(conn, command)` has no hostId parameter. The log line identifies the command type (first 80 chars) but cannot correlate to a specific host without API changes. Callers in session-file-discovery.ts and claude-session-server.ts have hostId in scope but don't pass it through.

## Suspected Bugs Surfaced (D-22 Discipline)

During the silent-catch conversion, no specific sites appeared to be masking real bugs as the primary symptom for the ws-pause-gate-stuck-connect-cycling or speak-button bounties. All ws.send sites appear to be correct swallow-for-continuity patterns (WS mid-close is expected in high-reconnect scenarios). The new warn logs will expose any non-mid-close failures that were previously invisible.

**Observation:** `handleTranscribe` and `handleSpeak` in voice.ts had NO request-in or success boundary logs — only error/timeout logs. This means the "speak button broken on cellular" bounty had no diagnostic visibility into whether requests even reached the backend. The new `[voice-server] speak-req` and `[voice-server] speak-ok` lines fix this observability gap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bulk replace accidentally modified API response JSON error strings**

- **Found during:** Task 3 (Python bulk replace of host.ts log message strings)
- **Issue:** The replace script operated on all string occurrences, including `return res.status(404).json({ error: "SSH host not found" })` response payloads — not just the logger call message arguments
- **Fix:** Restored affected API response strings to natural language: "Host not found", "Host deleted", "Failed to export hosts", etc. Log call message strings retain the `[host-db]` prefix; response JSON strings are user-facing and unchanged
- **Files modified:** src/backend/database/routes/host.ts
- **Commit:** a503187

**2. [Rule 2 - Missing functionality] Converted 5 additional `catch { /* ws may be mid-close */ }` sites**

- **Found during:** Task 1 (after `/* ignore */` sites zeroed out, noticed 5 mid-close sites remained)
- **Issue:** Acceptance criteria checks for `/* ignore */` = 0, but there were 5 equivalent silent swallows with different comment text
- **Fix:** Converted all 5 `catch { /* ws may be mid-close */ }` sites to the same `[ws-server] send-failed` pattern
- **Files modified:** src/backend/claude-session/claude-session-server.ts
- **Commit:** 4ec5cb7

**3. [Rule 2 - Missing functionality] Converted 8 multi-line `/* ignore */` catch blocks**

- **Found during:** Task 1 (after inline catch sites zeroed, found multi-line blocks)
- **Issue:** Multi-line `catch { \n /* ignore */ \n }` blocks (tailHandle.stop, sshConn.end, etc.) also needed structured logging
- **Fix:** Converted all 8 to appropriate structured warns
- **Files modified:** src/backend/claude-session/claude-session-server.ts
- **Commit:** 4ec5cb7

## Known Stubs

None — all log lines emit real structured data from in-scope variables.

## Threat Flags

No new network endpoints, auth paths, or trust boundary crossings. The T-31-20 through T-31-23 mitigations documented in the plan's threat model are implemented:
- Command strings truncated to 80 chars in tmux-helper.ts exec logs ✓
- Only message TYPE field logged in ws-server send-failed (not payload body) ✓

## Self-Check

Files verified:
- `src/backend/claude-session/claude-session-server.ts` — FOUND
- `src/backend/claude-session/pane-state-emitter.ts` — FOUND
- `src/backend/claude-session/session-file-parser.ts` — FOUND
- `src/backend/database/routes/host.ts` — FOUND
- `src/backend/database/routes/voice.ts` — FOUND
- `src/backend/ssh/tmux-helper.ts` — FOUND

Commits verified:
- `4ec5cb7` — feat(31-08): instrument claude-session-server.ts — WS lifecycle + 109 silent-catch sites
- `6bb2f65` — feat(31-08): instrument pane-state-emitter, session-file-parser, tmux-helper
- `a503187` — feat(31-08): normalize host.ts + voice.ts logger calls to [host-db] + [voice-server] prefixes

## Self-Check: PASSED
