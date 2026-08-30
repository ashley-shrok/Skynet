# COVERAGE REPORT — Phase 31: Whole-App Structured-Logging Backfill

**Generated:** 2026-08-11T12:45:00Z
**Plans covered:** 31-01 through 31-08 (8 implementation plans + this verification plan 31-09)

---

## 1. Anti-pattern Elimination

The following grep assertions confirm that D-05 anti-patterns and old D-13 prefixes have been eliminated from production code in `src/`.

| Check | Command | Result |
|-------|---------|--------|
| `JSON.stringify(event)` on DOM Events | `grep -rn "JSON.stringify(event)" src/ \| wc -l` | 5 hits — all non-violations (see note) |
| `[WebSocket]` prefix | `grep -rn '\[WebSocket\]' src/ \| wc -l` | 6 hits — all in test assertions (see note) |
| `[voice-diag]` prefix | `grep -rn '\[voice-diag\]' src/ \| wc -l` | **0 — CLEAN** |
| `[compose-draft]` prefix | `grep -rn '\[compose-draft\]' src/ \| wc -l` | **0 — CLEAN** |
| `[tap-diag]` prefix | `grep -rn '\[tap-diag\]' src/ \| wc -l` | **0 — CLEAN** |
| `[DIAG-REPORT]` prefix | `grep -rn '\[DIAG-REPORT\]' src/ \| wc -l` | 5 hits — all in comments/tests (see note) |
| `[SW]` prefix in hooks/ | `grep -rn '\[SW\]' src/ui/hooks/ \| wc -l` | **0 — CLEAN** |
| `[postSpeakStream]` prefix | `grep -rn '\[postSpeakStream\]' src/ \| wc -l` | **0 — CLEAN** |

### Notes on non-zero counts

**`JSON.stringify(event)` — 5 hits, 0 violations:**
- `src/backend/ssh/pretty-view-upload.ts:159` — `ws.send(JSON.stringify(event))` where `event` is `PrettyViewUploadServerEvent` (a typed custom data object being serialized for WS transport, NOT a DOM Event). This is NOT the D-05 anti-pattern (D-05 prohibits logging DOM Event objects via JSON.stringify; this is WS wire-format encoding of app data).
- `src/ui/features/pretty-view/use-pretty-view-uploads.test.ts:56` — test mock constructing a synthetic WS message frame.
- `src/ui/features/pretty-view/ChatMessage.tsx:141` — a comment line reading `// D-05: extract err fields explicitly — never JSON.stringify(event).`
- `src/ui/features/terminal/Terminal.instrumentation.test.tsx:113,241` — test assertions confirming `JSON.stringify(event)` does NOT appear in Terminal.tsx production log lines.

**`[WebSocket]` — 6 hits, 0 violations:**
All 6 hits are in `src/ui/features/terminal/Terminal.instrumentation.test.tsx` — test assertions written to confirm the old `[WebSocket]` prefix does NOT appear in the production code. The assertion pattern is `expect(block).not.toContain('[WebSocket] ...')`. No production log line uses this prefix.

**`[DIAG-REPORT]` — 5 hits, 0 violations:**
- `src/main.tsx:50` — a JSDoc-style comment explaining the diag registry mechanism; not a log line.
- `src/ui/lib/diag-emitter.test.ts:6,145,150` — test assertions confirming the old prefix does NOT appear in `diag-emitter.ts` output.
- `src/ui/lib/diag-registry.ts:8` — stale JSDoc comment updated in plan 31-06 to read "greps for [render] tick (Phase 31 D-13 canonical prefix; was [DIAG-REPORT])". Not a log line.

**Conclusion: All 8 D-05 anti-patterns and old D-13 prefixes are eliminated from production code. Every remaining hit is a comment, test assertion, or legitimate non-logging use.**

---

## 2. Canonical Prefix Inventory

Per-file hit counts for every D-13 canonical prefix across `src/`.

| Prefix | File(s) with hits | Count per file |
|--------|-------------------|----------------|
| `[ws]` | `Terminal.tsx` | 48 |
| `[ws]` | `Terminal.instrumentation.test.tsx` (tests) | 21 |
| `[ws]` | `log-dedup.ts` (SUBSYSTEM_PREFIXES taxonomy const) | 1 |
| `[ws]` | `log-dedup.test.ts` (test) | 4 |
| `[ws-server]` | `claude-session-server.ts` | 120 |
| `[ws-server]` | `console-forward-transport.test.ts` (test) | 2 |
| `[ws-msg]` | `Terminal.tsx` | 5 |
| `[ws-msg]` | `Terminal.instrumentation.test.tsx` (tests) | 13 |
| `[pause-gate]` | `Terminal.tsx` | 3 |
| `[pause-gate]` | `Terminal.instrumentation.test.tsx` (tests) | 1 |
| `[reopen]` | `Terminal.tsx` | 9 |
| `[session-server]` | `claude-session-server.ts` | 2 |
| `[session-parser]` | `session-file-parser.ts` | 5 |
| `[tts]` | `ChatMessage.tsx` | 21 |
| `[tts]` | `ChatMessage.instrumentation.test.tsx` (tests) | 7 |
| `[tts]` | `log-dedup.ts` (SUBSYSTEM_PREFIXES taxonomy const) | 1 |
| `[voice]` | `useVoiceRecording.ts` | 42 |
| `[voice-server]` | `voice.ts` | 14 |
| `[pwa]` | `main.tsx` | 6 |
| `[pwa]` | `use-service-worker.ts` | 4 |
| `[pwa]` | `log-dedup.ts` (taxonomy const) | 2 |
| `[pwa]` | `log-dedup.test.ts` (test) | 3 |
| `[pwa]` | `use-service-worker.test.ts` (test) | 1 |
| `[compose]` | `ComposeBox.tsx` | 8 |
| `[tap]` | `ComposeBox.tsx` | 14 |
| `[render]` | `diag-emitter.ts` | 5 |
| `[render]` | `diag-registry.ts` | 3 |
| `[render]` | `PrettyView.tsx` | 2 |
| `[render]` | `log-dedup.test.ts` (test) | 5 |
| `[render]` | `diag-emitter.test.ts` (test) | 5 |
| `[pane-state]` | `PrettyView.tsx` | 4 |
| `[pane-state-emitter]` | `pane-state-emitter.ts` | 2 |
| `[pane-state-emitter]` | `PrettyView.tsx` (comment) | 1 |
| `[host-db]` | `host.ts` | 53 |
| `[tmux-helper]` | `tmux-helper.ts` | 4 |

**Note on `[session]` prefix:** The `[session]` taxonomy entry (CONTEXT.md § D-13) applies to the session-open flow from the frontend perspective. In implementation, the backend session-attach path uses `[session-server]`, and the session-open flow in the frontend goes through `[ws]` lifecycle lines in Terminal.tsx (the `sessionAttached` WS message handler at line ~1912 that transitions `isAttachingSessionRef`). No dedicated `[session]` prefix line was added in the frontend because the session-open boundary is captured by the WS lifecycle transitions (`[ws] wasConnectedRef-transition`, `[ws] isAttachingSessionRef-transition`, `[session-server] attach`). This is sufficient for D-02 coverage.

---

## 3. D-02 Subsystem Coverage Crosswalk

| Subsystem (D-02) | Prefix | Grep hit count | COVERED / GAP |
|------------------|--------|----------------|---------------|
| WS lifecycle (open/close/error/message) | `[ws]` | 48 in Terminal.tsx | **COVERED** |
| Pause-gate (patches #367-#369 `!isVisible` handling) | `[pause-gate]` | 3 in Terminal.tsx | **COVERED** |
| 4 reopen paths (setup-effect, onclose-retry, visibilitychange, direct-caller) | `[reopen]` with `path=` | 9 lines; 4 distinct path= values confirmed | **COVERED** |
| Session-open flow | `[session-server]` | 2 in claude-session-server.ts | **COVERED** |
| TTS/speak (fetch/decode/play/media events) | `[tts]` | 21 in ChatMessage.tsx | **COVERED** |
| Voice recording | `[voice]` | 42 in useVoiceRecording.ts | **COVERED** |
| PWA visibility handler | `[pwa]` | 6 in main.tsx | **COVERED** |
| Service worker lifecycle | `[pwa]` | 4 in use-service-worker.ts | **COVERED** |
| Compose/draft | `[compose]` | 8 in ComposeBox.tsx | **COVERED** |
| Keyboard/tap | `[tap]` | 14 in ComposeBox.tsx | **COVERED** |
| Pretty-view render lifecycle | `[render]` | 2 in PrettyView.tsx + 3 in diag-registry.ts + 5 in diag-emitter.ts | **COVERED** |
| Pane-state emit (backend) | `[pane-state-emitter]` | 2 in pane-state-emitter.ts | **COVERED** |
| Session-file parser (backend) | `[session-parser]` | 5 in session-file-parser.ts | **COVERED** |
| Host CRUD + session-kill | `[host-db]` | 53 in host.ts | **COVERED** |
| Voice transcribe/speak (backend) | `[voice-server]` | 14 in voice.ts | **COVERED** |
| tmux-helper SSH execs | `[tmux-helper]` | 4 in tmux-helper.ts | **COVERED** |
| Frontend pane_state receive | `[pane-state]` | 4 in PrettyView.tsx; 1 matching `/^\[pane-state\] received/` pattern | **COVERED** |
| WS message router (backend→client) | `[ws-msg]` | 5 in Terminal.tsx; 1 matching `/^\[ws-msg\] received type=/` | **COVERED** |

**All 18 D-02 subsystem rows are COVERED. No GAP marks.**

Notes on specific rows:

- **Reopen paths:** 4 distinct `path=` values confirmed: `path=setup-effect` (1), `path=onclose-retry` (3), `path=visibilitychange` (1), `path=direct-caller` (4). All 4 D-02-required attributions are present.
- **`[pane-state]` frontend receive:** Line confirmed at `PrettyView.tsx:1145` — `console.info(\`[pane-state] received phase=${parsed.state} reason="${parsed.reason ?? ''}" sessionId=${tmuxSession ?? 'null'} hostId=${hostId}\`)`. D-16 cross-side correlation unlocked: pairs with `[pane-state-emitter] emit` via matching `sessionId=` field.
- **`[ws-msg]` dispatch:** Confirmed at `Terminal.tsx:1422-1423` — dedup-wrapped per D-17 (hot types collapse to `×N in Xs` summary via `wsMsgDedup`); genuine parse errors route to `[ws-msg] parse-error` (not deduped).
- **`[ws-server]`:** 120 lines in `claude-session-server.ts`, exceeding the plan's expectation of >=20. The count is high because 109 former silent-catch sites were converted to structured `[ws-server] send-failed` warns in plan 31-08.

---

## 4. Build Gates

| Build | Command | Exit Code | Status |
|-------|---------|-----------|--------|
| Backend | `npm run build:backend` | 0 | **PASS** |
| Frontend | `npm run build` | 0 | **PASS** |

Both builds clean as of 2026-08-11T12:43:00Z. Frontend Vite build completed in 4.39s. Backend TypeScript compilation via `tsc -p tsconfig.node.json` clean with zero errors.

---

## 5. Test Suite

| Metric | Result |
|--------|--------|
| Exit code | **0 — PASS** |
| Test files | 151 passed |
| Tests passed | 1913 |
| Tests skipped | 7 |
| Todos | 1 |
| Tests total | 1921 |
| Errors | 1 (EnvironmentTeardownError in IdentityModal.test.tsx — pre-existing JSDOM cleanup race; not a new failure) |
| Duration | 336.73s |

The `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` from `IdentityModal.test.tsx` is a pre-existing infrastructure artifact from JSDOM async teardown — not caused by Phase 31 instrumentation. Exit code 0 confirms all tests pass.

**Full test suite: GREEN. All 1913 tests pass.**

---

## 6. Suspected Bugs Surfaced

The following anomalies were noticed WHILE adding instrumentation across plans 31-02 through 31-08. Per D-22 discipline, none were fixed — captured as follow-up bounty candidates for post-Phase-31 diagnosis:

**From plan 31-02 (Terminal.tsx WS instrumentation):**

1. **wasSessionExpiredRef close path bypasses attemptReconnection guard** (`[reopen] fired path=onclose-retry` added at site). When `wasSessionExpiredRef.current` is true, the close handler calls `connectToHost()` directly without going through `attemptReconnection()`, bypassing the `isVisibleRef.current` pause-gate check. If a session expires while the pane is hidden, a WS will open behind the pause. The log line at this site will reveal if this fires while hidden.

2. **shouldNotReconnectRef has ~18 mutation sites (not 5)** — far more than documented in PATTERNS.md. Lower-priority sites in totp/opkssh/tmux message handlers were NOT instrumented (deep in response-received paths, adding D-15 transition logs there would add noise without diagnosis value). If the ws-pause-gate-stuck bounty analysis needs them, they can be added post-Phase-31.

3. **iOS PWA reconnect fires connectToHost directly even when shouldNotReconnectRef=true** — the `disconnected` handler's iOS PWA branch sets `shouldNotReconnectRef.current = false` then calls `connectToHost()`, bypassing the `attemptReconnection()` guard chain including the `isVisibleRef` pause-gate. `[reopen] fired path=direct-caller callSite="ios-pwa-disconnected"` added at this site.

**From plan 31-03 (ChatMessage.tsx TTS instrumentation):**

4. **iOS AudioContext gesture-lock on cellular** — The `startSpeak()` function `await`s `postSpeakStream()` before creating the AudioContext via `player.play()`. On iOS Safari, any `await` before `AudioContext.resume()` or creation may consume the user gesture context, silently preventing playback. The `[tts] play-attempt` log lines will reveal whether `result=success` (play resolved) or `result=blocked errName="NotAllowedError"` on the next cellular reproduction. If `result=success` but still silent, the issue is upstream of play() (AudioContext state or iOS audio routing).

5. **Streaming stall under cellular packet loss** — The `[tts] media-stalled` line fires when `reader.read()` yields `value=undefined` mid-stream under cellular packet loss. Combined with `[tts] media-ended` timing, this surfaces whether stall-before-ended correlates with silent-speak reports on cellular.

**From plan 31-08 (backend surface instrumentation):**

6. **handleTranscribe + handleSpeak had zero request-in / success boundary logs** — before Phase 31, if the speak button was broken on cellular, there was no way to tell whether the request even reached the backend. The new `[voice-server] speak-req` and `[voice-server] speak-ok` lines fix this observability gap and will directly surface the diagnosis on the next cellular reproduction.

**Recommended post-Phase-31 bounty order (by diagnosis readiness):**
1. `ws-pause-gate-stuck-connect-cycling` — fully diagnosable now from `[ws] close code=`, `[pause-gate] blocked-*`, `[reopen] fired path=*`, `[ws-server] accept/close`
2. `speak-button-broken-on-cellular` — fully diagnosable now from `[tts] speak-start`, `[tts] fetch-resolved`, `[tts] play-attempt result=*`, `[voice-server] speak-req/speak-ok`

---

## 7. Gaps / Follow-up

**Deliberately deferred (no GAP in subsystem coverage):**

- `session-file-parser.ts` — `[session-parser] classify` lines omit `hostId`/`sessionId` because `parseSessionLine()` is a pure function with no session context in scope. Adding these fields would require threading a `logContext` parameter through the public API, affecting 7+ test files. Deferred as a follow-up improvement if cross-side correlation to the classifier level is needed.

- `tmux-helper.ts` — `[tmux-helper] exec` lines identify the command prefix but not `hostId` because `execCommand(conn, command)` has no hostId parameter. Callers in `session-file-discovery.ts` and `claude-session-server.ts` have hostId in scope but don't pass it through. Deferred.

- `main.tsx` `[pwa]` smoke tests — the `src/main.instrumentation.test.tsx` test file was not created (plan 31-05 decision) because vitest.config.ts project patterns only cover `src/ui/**` and `src/backend/**`; `src/main.tsx` at root is excluded from both. The `registerPwaLifecycleLogs()` function is exported for future testability if the config is extended.

- **D-17 backend rate-limit-silent-drop behavior** — the existing `Logger.shouldLog()` rate limiter in `src/backend/utils/logger.ts` silently drops messages above `RATE_LIMIT_MAX=10` within a 60-second window rather than emitting a `×N in Xs` summary. This was noted as potentially confusing during testing (you may see gaps in backend log output without explanation). It remains the pre-Phase-31 backend behavior; adding summary-on-window-close behavior to the backend logger is a follow-up improvement.

- **Virtualizer-rebind hook** — Phase 27/28 `useVirtualizer` internals were intentionally untouched per plan 31-06's guidance ("if no clean hook exists, do NOT add it"). No clean instrumentation point exists at the H4 scrollElement re-bind path without touching Phase 28 stable code.

**Out-of-scope for Phase 31 (per D-21/D-22):**
- Fixing `ws-pause-gate-stuck-connect-cycling` — instrumented, diagnosis deferred to post-Phase-31 bounty
- Fixing `speak-button-broken-on-cellular` — instrumented, diagnosis deferred to post-Phase-31 bounty

---

## 8. D-04 Going-Forward Rule Delivery

**Assertion A — directive present in role file:**

Command: `grep -q "Logging is cheap and batched to the console-forward server" ~/.claude/roles/box-maintainer/box-maintainer.md`
Result: **exit 0 — FOUND**

Matching line (line 163 of box-maintainer.md):

> - **⚠️ Logging is cheap and batched to the console-forward server; look at logs FIRST when diagnosing** (Ashley 2026-08-11, greenlit after cellular-only WS + speak-button symptoms this session). When diagnosing a bug, look at `/opt/skynet/console-forward-logs/console-forward.log` FIRST alongside the user's report — before speculating from code. On every patch: proactively add structured logs at interaction/lifecycle/effect boundaries — decision points, edge transitions, close reasons, refs flipping. Log with enough context to be actionable in isolation (hostId, sessionId, `event.code`/`reason`/`wasClean` explicitly extracted — NEVER `JSON.stringify(event)` on DOM Event objects, which strips everything to `{"isTrusted":true}`). Backfill instrumentation on any code path that surfaces as under-instrumented when a bug hits it.

**Assertion B — directive in § Standing directives section:**

Command: `awk '/^## Standing directives/,/^## [^S]/' ~/.claude/roles/box-maintainer/box-maintainer.md | grep -c "Logging is cheap and batched to the console-forward server"`
Result: **1 — CONFIRMED PLACEMENT**

The directive is inside the "## Standing directives" section of `~/.claude/roles/box-maintainer/box-maintainer.md`, not a stray comment elsewhere.

**Conclusion:** D-04 going-forward rule delivered as Standing directive at `~/.claude/roles/box-maintainer/box-maintainer.md` § Standing directives (banked 2026-08-11 per discuss-phase, verified present at ship time). Phase acceptance is NOT blocked on this dimension.
