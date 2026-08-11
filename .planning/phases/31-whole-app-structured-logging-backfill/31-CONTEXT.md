# Phase 31: Whole-app structured-logging backfill - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Instrument the whole Skynet app so remote maintainers can diagnose bugs from `/opt/skynet/console-forward-logs/console-forward.log` alone, using the user's bug report + the log trail as the primary diagnostic tool — without having to guess from code.

**What "whole-app" means:** frontend AND backend, across every subsystem where a bug could conceivably need diagnosis. Bias overtly toward overdo rather than underdo — logging is cheap in this app (batched to the server via existing console-forward endpoint) and cheap at runtime.

**Deliverable:** the app emits structured, actionable log lines at interaction/lifecycle/effect boundaries across the enumerated subsystems, plus a going-forward rule so every future patch adds instrumentation proactively at the same class of boundaries.

**What Phase 31 is NOT:** it is NOT the fix for any specific bug — instrumentation only. Two symptom bounties (`ws-pause-gate-stuck-connect-cycling`, `speak-button-broken-on-cellular`) are DEFERRED behind Phase 31. Once the logs land, those two bounties get diagnosed from real data and fixed in follow-up phase(s). Locked (a) instrumentation-only in discuss-phase per Ashley 2026-08-11.

</domain>

<decisions>
## Implementation Decisions

### Scope of the backfill (D-01..D-08)

- **D-01: Wide net.** Every subsystem where a bug could conceivably need diagnosis gets instrumented. Ashley 2026-08-11 verbatim: *"anywhere that can have an issue that might need to be diagnosed is fair game. And I would rather overdo it than underdo it, because … it's not expensive to add the lines, nor to have them be logging during runtime."*
- **D-02: Frontend surfaces confirmed in scope.** WS lifecycle (open / connected / sessionAttached / message-router / close / error), pause-gate (patches #367-#369 `!isVisible` handling), all 4 reopen-ladder paths individually attributed (setup-effect deps / onclose retry scheduler / visibilitychange handler / direct `connectToHost` callers), session-open flow (from user-click through terminal render), TTS/speak pipeline (fetch, blob decode, `audio.play()` promise, media events canplay/playing/error/stalled/suspend/ended), voice-recording lifecycle (record start/stop/error, MediaRecorder ondataavailable/onstop, feedback playback ordering per patch #382), PWA visibility handler + service worker events, compose/draft save+load, keyboard/tap handlers (extend existing `[tap-diag]`), pretty-view render lifecycle (extend existing DIAG-REPORT).
- **D-03: Backend included.** Skynet backend `console.*` currently hits Docker stdout only (`docker logs skynet`) — Phase 31 routes backend logs to the same console-forward stream as the frontend so there is ONE log file to grep. Cheapest unification path per Ashley 2026-08-11 defer-to-me. Surfaces: WS route accept/close on the backend side, tab lifecycle handlers, pane_state emitter (patch #383), session-file parser, host-database routes (host CRUD, session-kill), voice/transcribe endpoint, tmux-helper SSH execs, error middleware.
- **D-04: New patch discipline.** Every future patch that touches an interaction / lifecycle / effect boundary MUST add structured logs at that boundary as part of the patch — no exceptions. This is the going-forward rule that keeps the app instrumented as it evolves. Banked as § Standing directive on box-maintainer.md 2026-08-11.
- **D-05: Never `JSON.stringify(event)` on DOM Event objects.** Every WS/media/DOM event handler MUST extract fields explicitly (`event.code`, `event.reason`, `event.wasClean`, `event.type`, etc.). This trap has already burned us: current `[WebSocket] Error: {"isTrusted":true}` is the exact anti-pattern this phase eliminates.
- **D-06: `wasConnectedRef` and other load-bearing ref transitions get logged.** Refs whose value gates behavior (wasConnectedRef, isConnectingRef, isAttachingSessionRef, isVisibleRef, shouldNotReconnectRef) emit a structured line on every transition with old→new value + trigger context. Currently invisible; they're the whole state machine of the WS lifecycle.
- **D-07: Backfill first, then rule-going-forward.** Phase 31 does the initial pass across all D-02+D-03 surfaces AND establishes the going-forward rule. Both, not one.
- **D-08: If in doubt, log it.** When judging whether a boundary is worth instrumenting, err toward yes. Removing a log later is trivial; missing it during a live-fire diagnosis is expensive.

### Log schema and conventions (D-09..D-16)

- **D-09: My call, optimized for grepability and diagnosis speed.** Ashley 2026-08-11 verbatim: *"the conventions should be whatever makes it easiest for you to find and figure out issues, because I won't be looking at the logs, you will."*
- **D-10: Wire format = existing console-forward JSON envelope preserved** — `{ts, level, tabId, msg}`. Don't invent a new stream shape; work within what's already deployed and being batched.
- **D-11: `msg` field takes a STANDARDIZED SHAPE:** `[subsystem] event key1=val1 key2=val2 ...`. Prefix in brackets identifies subsystem (canonical taxonomy — see D-13). Event is a short verb-phrase describing what happened (`close`, `pause-entered`, `reopen-fired`, `play-attempt`, `handshake-completed`). Then space-separated key=value pairs for structured fields. Quoted values only when they contain spaces.
- **D-12: Standard fields present wherever applicable** — `hostId=N`, `sessionId=X` (tmux session name), `paneId=terminal:N:UUID` or `pretty-view:N:name`, `wsUrl=/ws/...`. Include IDs even in error paths — a log line without context IDs is unactionable when correlating across sessions.
- **D-13: Canonical subsystem prefix taxonomy** — CONSOLIDATE the current zoo (`[WebSocket]`, `[SkynetLog]`, `[voice-diag]`, `[compose-draft]`, `[tap-diag]`, `[DIAG-REPORT]`, ad-hoc names) into a stable set: `[ws]` (WebSocket lifecycle), `[ws-msg]` (backend→client messages), `[pause-gate]` (visibility pause), `[reopen]` (reconnect ladder, includes `path=` field), `[session]` (session-open flow, tmux attach, backend session routes), `[tts]` (speak/audio playback), `[voice]` (recording), `[pwa]` (visibility handler, service worker), `[compose]` (draft, submission), `[tap]` (tap-diag, keyboard, focus), `[render]` (DIAG-REPORT, render-cost, virtualization), `[pane-state]` (patch #383 emitter/parser), `[auth]` (login flow), `[host-db]` (host CRUD), `[relay]` (matrix relay wiring), `[fs]` (filestash). Old prefixes get remapped as part of this phase. New subsystems can add prefixes as needed following the same `[lowercase-hyphenated]` convention.
- **D-14: Log levels have specific semantics.** `info` = expected transitions (WS connected, pause entered, play started). `warn` = unexpected but not fatal (reconnect fired, dedup fallback taken, non-critical timeout). `error` = real failures (WS close with abnormal code, play() promise rejected with error, backend 5xx). NOT: `warn` for everything because we're not sure. NOT: `error` for expected close codes.
- **D-15: `wasConnectedRef` and load-bearing ref transitions log at `info`** with `edge=false→true` (or `true→false`) plus `trigger=<what caused the transition>`.
- **D-16: Backend log lines follow the same shape.** Backend `[ws-server]`, `[session-server]`, `[pane-state-emitter]`, etc. When the backend routes a message that will affect frontend state, log BOTH sides so I can correlate.

### Volume / throttle discipline (D-17..D-19)

- **D-17: Client-side dedup on hot loops** using the syslog "last message repeated N times" pattern. Ashley 2026-08-11 verbatim: *"any easy way to batch lines that are the same? … there'd be some way to have the line in there once with like a counter of how many times it happened … I'm sure there are standards for this kind of thing and so we probably just follow that."* Implementation sketch: log-key = `subsystem + event + hash of key=val fields`; if same key fires >N times in a rolling W-second window, collapse subsequent occurrences into `[subsystem] event <fields> ×N in Xs` summary emitted at window close. Sane defaults: N=3, W=5s. Applied selectively — hot paths (visibility flap, scroll, per-render effects, DIAG-REPORT ticks) get dedup; genuinely-per-event lines (WS close, play-attempt) do NOT (each one is diagnostic).
- **D-18: No per-render logs by default.** React effect boundaries that fire on every render are noise; either move to lifecycle-only logging (mount / unmount / meaningful-prop-change) OR dedup aggressively.
- **D-19: Batch-post budget is not a concern at expected volume.** Current console-forward stream handles hundreds of lines per minute with no visible perf cost; dedup keeps that comfortable even with the backfill expanding coverage.

### Testing (D-20)

- **D-20: Light testing only.** Smoke tests for the MOST critical log emissions — WS `close` event structured fields, pause-gate transitions, TTS play-attempt result — asserting the line fires with the expected shape. NOT contract tests on every log line. Ashley 2026-08-11 verbatim: *"testing is potentially helpful but probably not totally necessary."* Non-blocking: a missing smoke test doesn't fail the phase; a wrong-shape one does.

### Follow-on scope (D-21..D-22)

- **D-21: The two symptom bounties are DEFERRED behind Phase 31.** `ws-pause-gate-stuck-connect-cycling` and `speak-button-broken-on-cellular` don't get diagnosed or fixed IN this phase. After Phase 31 ships and Ashley reproduces, we open follow-up phase(s) informed by the log data.
- **D-22: Instrumentation-only phase scope.** Ashley 2026-08-11 locked (a) — Phase 31 does NOT bundle fixes for either symptom bounty, even if the root cause becomes visually obvious while adding logs. Discipline: if I notice a bug during the backfill, capture it as a bounty and file it — don't fix inline.

### Claude's Discretion
- Which specific hooks/components/files under each D-02 subsystem get touched — I'll enumerate during planning. Bias overdo per D-01.
- Exact rate-limit N and window W in D-17 — starting at N=3 W=5s but tunable per subsystem based on observed noise.
- Backend log-forward transport mechanism in D-03 — probably a small in-process buffer + periodic POST to the existing console-forward endpoint with a `source=backend` marker; details settled at plan time.
- Precise ordering of waves — likely groups by subsystem, but planning will chunk based on file overlap and rebase risk.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The logging philosophy (banked directive)
- `~/.claude/roles/box-maintainer/box-maintainer.md` § Standing directives — the "Logging is cheap and batched to the console-forward server" directive banked 2026-08-11 that motivates this phase. Load-bearing wording: log lines must be actionable in isolation with hostId, sessionId, event.code/reason/wasClean explicitly extracted — NEVER JSON.stringify(event).

### Bounties that DEPEND on Phase 31's output
- `~/.claude/roles/box-maintainer/bounties/ws-pause-gate-stuck-connect-cycling/bounty.json` — "Waiting for connection logs" + "Connection rejected by server" symptoms. Contains the 08:03-08:07 UTC 2026-08-11 log excerpt (116 error events, cyclical reconnect, `[WebSocket] Error: {"isTrusted":true}` anti-pattern). Reads as the empirical baseline for what the current logs fail to tell us.
- `~/.claude/roles/box-maintainer/bounties/speak-button-broken-on-cellular/bounty.json` — TTS speak-button silent on cellular. Names the exact TTS pipeline stages that need instrumentation.

### The empirical log baseline
- `/opt/skynet/console-forward-logs/console-forward.log` — the log file itself. Read a recent window to see the current instrumentation landscape (existing prefixes, log-line shapes, DIAG-REPORT structure, `[voice-diag]` pattern which is one of the better-instrumented current subsystems and a template for others).

### Existing structured-logging examples to model on
- `src/ui/features/voice-input/useVoiceRecording.ts` — `[voice-diag]` prefix, warn level, structured message format. One of the cleanest current examples of what we want everywhere.
- `src/ui/lib/diag-emitter.ts` and `src/ui/lib/diag-registry.ts` — DIAG-REPORT emission mechanism; useful pattern for periodic-tick observability.
- `src/backend/*` — the backend routes and their current logging (Docker stdout only today). All need the new console-forward pipe added.

### Recent patches that established the failure surface (context for the planner)
- Patches #367 / #368 / #369 (2026-08-09) — pause-hidden-terminal-WS + reopen-loop gates. The current pause-gate code and the 4 reopen-ladder paths are their surface.
- Patch #383 (2026-08-10) — Phase 30 pane_state authoritative emitter/parser + `usePaneResolvingMachine` 380→51 LOC rewire. Session-state plumbing that's freshly rewritten and needs its own instrumentation now.
- Patch #382 (2026-08-11) — voice-recording feedback-playback ordering fix. iOS Safari AudioSession shared-between-MediaRecorder-and-Audio finding is the load-bearing gotcha for the TTS pipeline instrumentation to surface if it re-appears.
- `~/.claude/roles/box-maintainer/skynet-patches.md` — the fork's 261-patch catalog; grep for `voice`, `websocket`, `pause`, `visibility`, `session`, `tts`, `audio`, `reconnect` to see the full history of surfaces this phase covers.

### GSD workflow and role-file governance
- `~/.claude/skills/id/SKILL.md` — role/identity discipline that governs how box-maintainer's directives get updated.
- `.planning/ROADMAP.md` § Phase 31 — the roadmap entry for this phase.
- `.planning/STATE.md` § Roadmap Evolution 2026-08-11 — the motivating narrative for Phase 31.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **console-forward endpoint** — already-deployed batched log forwarding from browser to server. Backend logging can piggyback the same endpoint with a `source=backend` marker.
- **`[voice-diag]` prefix pattern** in useVoiceRecording.ts — the closest existing example of the shape D-11 codifies; other subsystems can model on it.
- **DIAG-REPORT tick mechanism** (`src/ui/lib/diag-emitter.ts` + `diag-registry.ts`) — established periodic-observability mechanism; wraps `mountedPaneCount`, per-pane `isVisible`, `wsBytesSinceLast`, `messageCount`, `domNodeCount`. Extendable to more subsystems if we want periodic snapshots alongside event-based logs.
- **Existing `bounty-counts-store` inline error path** (already logs as `warn` with structured fields — one small example of the shape we want).

### Established Patterns
- **Zustand stores throughout** — most subsystems have a store. Instrumenting a store's mutators is one of the highest-signal-per-line-of-code spots; every consequential state change goes through it.
- **Ref-heavy WS lifecycle** in Terminal.tsx (~15 relevant refs). Ref transitions currently emit ZERO logs; instrumenting them is D-06+D-15's whole point.
- **Backend routes in `src/backend/`** use Express-style handlers with `console.log`/`console.error`. Replacing those calls in-place with structured emissions on the same endpoint is the mechanical bulk of D-03.
- **iOS Safari as PRIMARY runtime** — every log-line design decision must survive Ashley's iPhone PWA workflow. Instrumentation cost is real if it slows the phone; batched-post amortizes that. UA is captured in DIAG-REPORT and useful for cross-device correlation.

### Integration Points
- **console-forward log file** (`/opt/skynet/console-forward-logs/console-forward.log`) — the destination. Backend route to accept `source=backend` marker + persist to same file (or peer file if we prefer separation) — small server-side addition.
- **Existing log-line consumers** — none right now besides me grepping. No dashboards / alerting to break; free to reshape.
- **Batching layer** — already exists on the frontend; backend implementation should mirror (buffer, periodic flush, avoid per-log network cost).

</code_context>

<specifics>
## Specific Ideas

- **Model the log-line shape on the current `[voice-diag]` pattern** — it's the cleanest current example. Prefix + verb-phrase + key=value structured tail.
- **Keep the `msg` field a single string** rather than expanding the JSON envelope — preserves compat with the existing backend/consumer and keeps line-based grep working.
- **Dedup follows syslog** — "last message repeated N times" is Ashley's asked-for pattern verbatim, from her "I'm sure there are standards" comment.
- **Deferred fix discipline is a hard rule for this phase** — D-22 exists because the phase's WHOLE POINT is instrumentation and diagnosis independence; bundling fixes would blur scope and slow the follow-up phase that gets to work from real data.

</specifics>

<deferred>
## Deferred Ideas

- **Log-shipping to structured store / dashboards** — nothing currently consumes the console-forward log except me grepping. If Ashley ever wants Grafana/Loki-style dashboards, that's its own phase. Not this one.
- **Log rotation / retention policy** — related to the "container-writable-layer bloat follow-up (~10.7 GB across the 4 running containers)" already parked in the handoff from earlier session. Belongs in that bounty, not Phase 31.
- **Contract tests for every log line** — deferred per D-20. Only smoke tests for critical lines this phase; full contract testing is its own maturity investment.
- **User-facing log-viewer surface in the app** (browsing recent errors from the log via a panel) — nice, unrelated to Phase 31's diagnosis-support goal.
- **Fix for `ws-pause-gate-stuck-connect-cycling`** — deferred, becomes a phase after Phase 31 ships and Ashley reproduces on the instrumented app.
- **Fix for `speak-button-broken-on-cellular`** — deferred, likely bounty-shaped once Phase 31's TTS instrumentation lands.
- **Redesigning the reconnect ladder to a single canonical head-of-ladder** — the eventual fix Phase 31 enables us to design. Belongs in the follow-up phase.
- **Softening the fatal "Connection rejected by server" full-screen overlay UX** — a UX fix related to the WS symptom, folded into the same follow-up phase.

</deferred>

---

*Phase: 31-whole-app-structured-logging-backfill*
*Context gathered: 2026-08-11*
