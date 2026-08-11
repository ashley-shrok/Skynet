# Phase 31: Whole-app structured-logging backfill - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** 15 subsystem representatives + 2 new files
**Analogs found:** 15 / 17

---

## Model / Golden-Copy File

Per CONTEXT.md § code_context, the ONE existing file whose logging pattern most other frontend surfaces MUST model on is:

**`src/ui/features/pretty-view/useVoiceRecording.ts`** (395 lines; actual path — CONTEXT.md § code_context references it as `src/ui/features/voice-input/useVoiceRecording.ts` but the real path is under `pretty-view/`)

Shape shown by this file (D-11 codifies it):
- Prefix in brackets identifies subsystem: `[voice-diag]`
- Short verb-phrase describes what happened: `stopRecording:`, `cancel: entry`, `transcribeBlob: POST`
- Space-separated key=value pairs after: `state=idle`, `blob=size=1234`, `status=200 ok=true`
- Explicit field extraction — no `JSON.stringify(event)`; every field named
- `console.warn` used for structured diagnostic lines (single level throughout for grepability of a single subsystem)

Representative excerpts (transferable pattern):

```typescript
// useVoiceRecording.ts:124 — early-return / gate log
console.warn("[voice-diag] stopRecording: recorderRef null, resolving null");

// useVoiceRecording.ts:136 — state gate rejection with structured context
console.warn(`[voice-diag] stopRecording: recorder.state=${recorder.state} (not recording), resolving null without touching onstop`);

// useVoiceRecording.ts:152 — success line with size + type key=value
console.warn(`[voice-diag] stopRecording: onstop fired, blob size=${blob.size} type=${type}`);

// useVoiceRecording.ts:165 — watchdog / timeout branch
console.warn("[voice-diag] stopRecording: WATCHDOG onstop never fired after 8s — forcing cleanup");

// useVoiceRecording.ts:196 — I/O boundary (fetch send) with URL + size
console.warn(`[voice-diag] transcribeBlob: POST ${TRANSCRIBE_URL} blobSize=${blob.size} ext=${ext}`);

// useVoiceRecording.ts:210 — response-received line with status + ok
console.warn(`[voice-diag] transcribeBlob: fetch resolved status=${res.status} ok=${res.ok}`);
```

Per D-13, **this phase RENAMES `[voice-diag]` to `[voice]`** as part of the taxonomy consolidation. The SHAPE is what carries forward.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/terminal/Terminal.tsx` | component | event-driven (WS) | `src/ui/features/pretty-view/useVoiceRecording.ts` | shape-transfer (no existing WS analog with structured logs) |
| `src/ui/features/pretty-view/ChatMessage.tsx` (TTS speak) | component | streaming | `src/ui/features/pretty-view/useVoiceRecording.ts` § `transcribeBlob` | role+flow match |
| `src/ui/features/pretty-view/ComposeBox.tsx` (compose/draft/tap) | component | CRUD + event-driven | Self (existing `[compose-draft]` + `[tap-diag]` prefixes) | exact (rename only) |
| `src/ui/features/pretty-view/useVoiceRecording.ts` | hook | streaming | Self (model file) | exact |
| `src/ui/hooks/use-service-worker.ts` | hook | event-driven | `src/ui/features/pretty-view/useVoiceRecording.ts` (event-hook pattern) | shape-transfer |
| `src/main.tsx` (PWA/visibility) | bootstrap | event-driven | `src/ui/lib/console-forwarder.ts` § visibilitychange handler | role+flow match |
| `src/ui/lib/console-forwarder.ts` | utility | batch | Self (add `hostId`/`sessionKey` fields per D-12) | exact |
| `src/ui/lib/diag-emitter.ts` | utility | pub-sub (periodic) | Self (rename `[DIAG-REPORT]` → `[render]`, D-13) | exact |
| `src/backend/claude-session/claude-session-server.ts` (WS route + tab lifecycle) | route | event-driven (WS) | `src/backend/claude-session/pane-state-emitter.ts` (pure-module + injected sender pattern) + `src/ui/features/pretty-view/useVoiceRecording.ts` (shape) | shape-transfer |
| `src/backend/claude-session/pane-state-emitter.ts` | service | event-driven | Self (add `[pane-state-emitter]`-prefixed lines on `emit`/`emitCurrent` — D-16) | shape-transfer |
| `src/backend/claude-session/session-file-parser.ts` | service | file-I/O (transform) | `src/ui/features/pretty-view/useVoiceRecording.ts` (shape) | shape-transfer |
| `src/backend/database/routes/host.ts` (host CRUD + session-kill) | route | CRUD | `src/backend/database/routes/voice.ts` § `handleTranscribe` error paths | role+flow match (backend) |
| `src/backend/database/routes/voice.ts` | route | request-response (proxy) | Self (extend existing `databaseLogger.error` sites to structured `[voice-server]` prefix + hostId/tabId per D-16) | exact |
| `src/backend/ssh/tmux-helper.ts` | utility | request-response (SSH exec) | `src/backend/database/routes/voice.ts` § error paths (Logger.error shape) | role match |
| `src/backend/utils/logger.ts` (error middleware / structured emitter) | utility | pub-sub | Self (add structured `msg` composer + forwarder-to-frontend-endpoint) | exact (extend) |
| **NEW** `src/ui/lib/log-dedup.ts` (D-17 syslog "repeated N times") | utility | transform | *no analog* | NEW |
| **NEW** `src/backend/utils/console-forward-transport.ts` (D-03 backend→forward-log buffer) | utility | batch | `src/ui/lib/console-forwarder.ts` (mirror MAX_BATCH + FLUSH_INTERVAL_MS + fetch/beacon pattern) | shape-transfer |

---

## Pattern Assignments

### `src/ui/features/terminal/Terminal.tsx` (component, event-driven WS)

**Analog:** `src/ui/features/pretty-view/useVoiceRecording.ts` (shape-transfer — Terminal has no existing structured logs; `[WebSocket]` warns are the anti-pattern D-05 exists to eliminate)

**Current anti-pattern to remove** (Terminal.tsx:1353):
```typescript
console.warn(
  "[WebSocket] Pong timeout - connection appears dead, closing",
);
// → NEW: [ws] pong-timeout hostId=N sessionId=X wsUrl=/ws/... readyState=1
```

**Ref-transition pattern to ADD** (per D-06, D-15). Currently at Terminal.tsx:1514 the ref transition is silent:
```typescript
wasConnectedRef.current = true;  // ← currently emits NOTHING
// → NEW: console.info(`[ws] wasConnectedRef-transition edge=false→true trigger=ws-open hostId=${hostId} sessionId=${sessionId}`)
```

Load-bearing refs enumerated in Terminal.tsx: `isAttachingSessionRef` (216), `isVisibleRef` (321), `shouldNotReconnectRef` (337), `isConnectingRef` (339), `wasConnectedRef` (340). ALL five need `edge=old→new trigger=<cause>` structured lines on every mutation.

**WS `close` event pattern** — model on `useVoiceRecording.ts:196` (POST fetch line) style:
```typescript
// Instead of: ws.onclose = (e) => { console.warn("[WebSocket] Error:", JSON.stringify(e)); }
ws.addEventListener("close", (e: CloseEvent) => {
  console.warn(`[ws] close hostId=${hostId} sessionId=${sessionId} code=${e.code} reason="${e.reason}" wasClean=${e.wasClean} isVisible=${isVisibleRef.current}`);
});
```

**Pause-gate pattern** — model on `useVoiceRecording.ts:294` (`cancel: entry state=${state}`):
```typescript
// Terminal.tsx:405 — currently `if (!isVisibleRef.current) return;`
if (!isVisibleRef.current) {
  console.warn(`[pause-gate] blocked-reconnect hostId=${hostId} reason=hidden trigger=setup-effect`);
  return;
}
```

**Reopen-ladder attribution** — per D-02, each of the 4 reopen paths needs a `path=` field:
- Setup-effect deps: `[reopen] fired hostId=N path=setup-effect-deps`
- onclose retry scheduler: `[reopen] fired hostId=N path=onclose-retry`
- visibilitychange handler: `[reopen] fired hostId=N path=visibilitychange`
- Direct `connectToHost` callers: `[reopen] fired hostId=N path=direct-caller callSite=<name>`

**Error handling pattern** (Terminal.tsx:1198, 1354) — replace bare `console.error("Terminal operation failed:", error)` with:
```typescript
console.error(`[ws] op-failed hostId=${hostId} sessionId=${sessionId} err="${error instanceof Error ? error.message : String(error)}"`);
```

---

### `src/ui/features/pretty-view/ChatMessage.tsx` (component, streaming — TTS/speak)

**Analog:** `src/ui/features/pretty-view/useVoiceRecording.ts` § `transcribeBlob` (both are fetch → response → play, with error-swallow branches at each stage)

**Current logs to restructure** (ChatMessage.tsx:132, 157):
```typescript
console.error("[postSpeakStream] player error:", err);
console.error("[postSpeakStream] fetch error:", err);
```

**New shape** — model on `useVoiceRecording.ts:210` (`fetch resolved status=${res.status} ok=${res.ok}`):
```typescript
// startSpeak entry — model on useVoiceRecording.ts:319 endAppend entry line
console.info(`[tts] speak-start owner=${owner.toString()} textLen=${text.length} voice="${identityVoice ?? 'default'}" trigger=${trigger}`);
// fetch resolved
console.info(`[tts] fetch-resolved status=${response.status} ok=${response.ok} owner=${owner.toString()}`);
// preempt-race check
console.warn(`[tts] preempt-during-fetch owner=${owner.toString()} newOwner=${currentOwner?.toString()}`);
// player events — cover D-02 canplay/playing/error/stalled/suspend/ended
console.warn(`[tts] player-error owner=${owner.toString()} err="${err instanceof Error ? err.message : String(err)}"`);
console.info(`[tts] player-ended owner=${owner.toString()}`);
```

**Autoplay effect** (ChatMessage.tsx:194 — patch #389 wiring) needs a line on every `startSpeak()` fire:
```typescript
console.info(`[tts] autoplay-fired eventId=${eventId} armed=${autoplayTargetEventId != null}`);
```

---

### `src/ui/features/pretty-view/ComposeBox.tsx` (component, CRUD + event-driven)

**Analog:** SELF — this file has TWO existing structured-log prefixes that already track the D-11 shape (partially). Phase 31 renames them per D-13:
- `[compose-draft]` → `[compose]` (ComposeBox.tsx:626, 765)
- `[tap-diag]` → `[tap]` (ComposeBox.tsx:897, 906, 910, 915, 919, 924)

**Existing pattern to preserve** (ComposeBox.tsx:626):
```typescript
console.warn(
  "[compose-draft] save hostId=%s tmuxSession=%s bodyLen=%d slotsLen=%d",
  hostId, tmuxSession, body.length, slots.length,
);
// → RENAME prefix to [compose] and normalize to template-literal shape matching useVoiceRecording (no printf placeholders):
console.warn(`[compose] draft-save hostId=${hostId} tmuxSession=${tmuxSession} bodyLen=${body.length} slotsLen=${slots.length}`);
```

**Existing tap pattern** (ComposeBox.tsx:897) — already close to D-11 shape but uses object literal instead of key=value string:
```typescript
console.log("[tap-diag] pointerdown", {
  client: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
  pointerType: e.pointerType,
  ...
});
// → RENAME [tap-diag] → [tap], flatten object into key=value pairs per D-11:
console.log(`[tap] pointerdown x=${Math.round(e.clientX)} y=${Math.round(e.clientY)} pointerType=${e.pointerType} target=${targetTag} selfTarget=${e.target === el}`);
```

**Compose submission** — new lines to add (currently silent) around the send handler.

---

### `src/ui/features/pretty-view/useVoiceRecording.ts` (hook, streaming)

**Analog:** SELF — this IS the model. Phase 31 changes:
1. Prefix `[voice-diag]` → `[voice]` throughout (per D-13).
2. Change `console.warn` to `console.info` for expected transitions (start/stop success), keep `warn` for unexpected (watchdog), promote to `error` for real failures (fetch threw, permission denied — currently at line 284 `setErrorMessage("mic denied...")` without a console log at all).
3. Add hostId/sessionId key=value tail per D-12 where the hook has access (currently doesn't — may need to accept a `logContext` prop).

**Pattern locked** (no change to shape, only prefix + level normalization):
```typescript
// useVoiceRecording.ts:196
console.warn(`[voice-diag] transcribeBlob: POST ${TRANSCRIBE_URL} blobSize=${blob.size} ext=${ext}`);
// → console.info(`[voice] transcribe-post url=${TRANSCRIBE_URL} blobSize=${blob.size} ext=${ext} hostId=${hostId}`)
```

---

### `src/ui/hooks/use-service-worker.ts` (hook, event-driven — PWA / SW)

**Analog:** `src/ui/features/pretty-view/useVoiceRecording.ts` (shape-transfer for the event-handler emissions)

**Current line to restructure** (use-service-worker.ts:69):
```typescript
console.error("[SW] Registration failed:", error);
// → console.error(`[pwa] sw-register-failed err="${error instanceof Error ? error.message : String(error)}"`)
```

**Silent transitions to log** (per D-06/D-15 — SW state is load-bearing):
- SW `statechange` at line 23: `[pwa] sw-statechange oldState=${prev} newState=${newWorker.state}`
- `controllerchange` at line 47: `[pwa] sw-controller-change shouldReload=${shouldReloadOnControllerChange}`
- `updatefound` at line 64: `[pwa] sw-update-found`

---

### `src/main.tsx` (bootstrap, event-driven — PWA visibility)

**Analog:** `src/ui/lib/console-forwarder.ts:168-173` (visibilitychange handler with structured tail — the existing pattern to model on for the PAGE-LEVEL visibility events)

**Existing pattern in console-forwarder.ts** (to model on for main.tsx):
```typescript
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushBeacon();
  }
});
window.addEventListener("pagehide", flushBeacon);
```

**New lines to add in main.tsx** (currently emits nothing at PWA lifecycle):
```typescript
window.addEventListener("visibilitychange", () => {
  console.info(`[pwa] visibility-change state=${document.visibilityState} hidden=${document.hidden}`);
});
window.addEventListener("pagehide", (e) => {
  console.info(`[pwa] pagehide persisted=${e.persisted}`);
});
window.addEventListener("pageshow", (e) => {
  console.info(`[pwa] pageshow persisted=${e.persisted}`);
});
```

---

### `src/ui/lib/console-forwarder.ts` (utility, batch)

**Analog:** SELF — the transport is already well-shaped; Phase 31 extends the envelope per D-12.

**Current envelope** (console-forwarder.ts:20-25):
```typescript
type LogEntry = {
  ts: string;
  level: LogLevel;
  tabId: string;
  msg: string;
};
```

**Phase 31 additions** — `hostId`/`sessionKey` (already accepted server-side per `src/backend/database/routes/debug.ts:34-37`). Extend `LogEntry` and `enqueueWithCallback` to accept optional hostId/sessionKey via a per-tab context. The `getTabId(): "no-tab"` TODO at line 38 should be resolved by wiring from AppShell active tab (as noted in comment).

---

### `src/ui/lib/diag-emitter.ts` (utility, pub-sub / periodic)

**Analog:** SELF — one-line change per D-13:

```typescript
// diag-emitter.ts:70
console.log("[DIAG-REPORT]", JSON.stringify(envelope));
// → console.log(`[render] tick`, JSON.stringify(envelope));  // per D-13 taxonomy
```

Semantic-transfer only. The DIAG-REPORT envelope shape stays intact (mountedPaneCount, per-pane snapshots, heap, ua) — it's the canonical periodic-tick observability output. Extension: additional subsystems can register into `diag-registry` to piggyback per-30s snapshots.

---

### `src/backend/claude-session/claude-session-server.ts` (route, event-driven WS)

**Analog:** `src/backend/claude-session/pane-state-emitter.ts` (per-connection factory closure pattern) + `useVoiceRecording.ts` shape

**Currently:** the file has ZERO structured logs matching D-11. Uses `console.log`/`console.error` sporadically (search returned 0 matches for `[bracket-prefixed]` structured lines).

**Backend log shape per D-16** — use prefix `[ws-server]` on the WS route:
```typescript
// wss.on("connection", ...) — accept event
console.log(`[ws-server] accept hostId=${hostId} tabId=${tabId} wsUrl=${url}`);
// connectToPane handler
console.log(`[session-server] attach hostId=${hostId} tmuxSession=${tmuxSession} paneId=${paneId}`);
// ws.on("close") — mirror front-side close, per D-16 "log BOTH sides"
console.log(`[ws-server] close hostId=${hostId} tabId=${tabId} code=${code} reason="${reason}"`);
// error paths
console.error(`[ws-server] send-failed hostId=${hostId} err="${err.message}"`);
```

**Anti-pattern to eliminate** (per D-05): the `try { ws.send(...) } catch { /* ignore */ }` at lines 755, 769, 777, 799, 803, 827, 843, 851 currently swallow errors silently. Every catch should emit `[ws-server] send-failed ...` with the error message.

---

### `src/backend/claude-session/pane-state-emitter.ts` (service, event-driven)

**Analog:** SELF — this is a pure module that emits wire frames. Phase 31 adds server-side observability at every `emit()` call so the wire-emit correlates 1:1 with a log line.

**Current:** zero logs (pane-state-emitter.ts). Every `emit(state, reason?)` call is silent.

**Add** (in `emit()` at line 144, after dedupe check passes):
```typescript
console.log(`[pane-state-emitter] emit state=${state} reason="${reason ?? ''}" prevState=${current?.state ?? 'null'} prevReason="${current?.reason ?? ''}"`);
```

Log dedupe suppression too (so we can see when a duplicate was collapsed):
```typescript
if (current !== null && current.state === state && current.reason === reason) {
  console.log(`[pane-state-emitter] emit-suppressed-dedupe state=${state} reason="${reason ?? ''}"`);
  return;
}
```

---

### `src/backend/claude-session/session-file-parser.ts` (service, file-I/O transform)

**Analog:** `useVoiceRecording.ts` shape (backend-adapted)

**Current:** zero logs. As the pane_state authoritative signal source (patch #383), every discovery-result classification is diagnostically valuable.

**Add** at each classification decision (holding, active, inactive, etc.):
```typescript
console.log(`[session-parser] classify hostId=${hostId} tmuxSession=${tmuxSession} result=${result.status} reason="${result.reason ?? ''}" pid=${pid ?? 'null'}`);
```

---

### `src/backend/database/routes/host.ts` (route, CRUD)

**Analog:** `src/backend/database/routes/voice.ts` § `handleTranscribe` (existing `databaseLogger.error(..., err, {operation})` shape — voice.ts:116, 123)

**Current pattern from voice.ts:116** (the target shape for all route error paths):
```typescript
databaseLogger.error("Voice STT request timed out", err, {
  operation: "voice_transcribe_timeout",
});
```

**Extend to host.ts routes** — currently the file has zero `console.*` or `logger.*` calls (verified). Every route handler needs:
- Request-in: `[host-db] req op=create-host userId=${userId} tabId=${tabId}`
- Success: `[host-db] ok op=create-host hostId=${created.id} durationMs=${dur}`
- Error: `databaseLogger.error("[host-db] failed", err, {operation: "create-host", userId, hostId})`

Per D-16, backend prefix `[host-db]` on the `msg` string. `databaseLogger.error` route (from `src/backend/utils/logger.ts:221`) already exists — reuse.

---

### `src/backend/database/routes/voice.ts` (route, request-response proxy)

**Analog:** SELF — the file has the two best backend error-log sites in the codebase (voice.ts:116, 123). Phase 31 extends coverage:

**Existing shape to preserve:**
```typescript
databaseLogger.error("Voice STT request timed out", err, {
  operation: "voice_transcribe_timeout",
});
```

**Phase 31 extensions:**
- Add request-in line: `databaseLogger.info("[voice-server] transcribe-req", {operation: "voice_transcribe", userId, byteSize: file.size, mimetype: file.mimetype})`
- Add success line: `databaseLogger.info("[voice-server] transcribe-ok", {operation: "voice_transcribe", status: 200, durationMs, textLen: sttJson.text?.length})`
- Normalize `msg` string to have `[voice-server]` prefix so D-13 grep works uniformly.

Same treatment for `handleSpeak` (voice.ts:131+).

---

### `src/backend/ssh/tmux-helper.ts` (utility, request-response SSH exec)

**Analog:** `src/backend/database/routes/voice.ts` (error-shape); `sshLogger` already imported at tmux-helper.ts:2

**Current:** the file imports `sshLogger` but the exported `execCommand`, `detectTmux` functions have zero log emissions today (verified — 0 `console.*` or `sshLogger.*` calls).

**Add** at every SSH exec boundary:
```typescript
sshLogger.info("[tmux-helper] exec", {operation: "tmux_exec", command: command.slice(0, 80)});
// on error:
sshLogger.error("[tmux-helper] exec-failed", err, {operation: "tmux_exec", command: command.slice(0, 80)});
// on close with non-zero code:
sshLogger.warn("[tmux-helper] exec-nonzero", {operation: "tmux_exec", code, stderrLen: stderr.length});
```

Per D-13 taxonomy the frontend-facing prefix should be `[session]` (part of session-open flow) but the backend module-local prefix `[tmux-helper]` distinguishes it within that subsystem.

---

### `src/backend/utils/logger.ts` (utility, pub-sub)

**Analog:** SELF — the Logger class already implements level-aware formatting, sensitive-field masking, and per-message rate limiting (logger.ts:180-204, ALREADY a form of D-17 dedup — RATE_LIMIT_MAX=10, RATE_LIMIT_WINDOW=60000ms).

**Existing dedup pattern to model D-17 on** (logger.ts:180-204):
```typescript
private shouldLog(level: LogLevel, message: string): boolean {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[globalLogLevel]) {
    return false;
  }
  const now = Date.now();
  const logKey = `${level}:${message}`;
  const logInfo = this.logCounts.get(logKey);
  if (logInfo) {
    if (now - logInfo.lastLog < this.RATE_LIMIT_WINDOW) {
      logInfo.count++;
      if (logInfo.count > this.RATE_LIMIT_MAX) {
        return false;  // ← currently DROPS silently; D-17 wants "×N in Xs" summary at window close
      }
    } else {
      logInfo.count = 1;
      logInfo.lastLog = now;
    }
  } else {
    this.logCounts.set(logKey, { count: 1, lastLog: now });
  }
  return true;
}
```

**Phase 31 extensions:**
1. Add a `structured(subsystem, event, fields)` method that composes `[subsystem] event key=value ...` per D-11 (currently the Logger only formats with a `formatMessage` that prepends `[SERVICE_ICON]` — mixes concerns with the D-11 shape).
2. Extend `shouldLog` dropped-line behavior to emit a `[subsystem] event ×N in Xs` summary at window-close per D-17 (not silent drop).
3. Wire a transport hook so lines can additionally flow to `console-forward-transport.ts` (the NEW backend forwarder module below).

---

### **NEW** `src/ui/lib/log-dedup.ts` (utility, transform)

**Analog:** *none in codebase* — closest conceptual precedent is `src/backend/utils/logger.ts:180-204` (message-key + count + window pattern), but the frontend has no equivalent module today. NEW file.

**Reference pattern from the backend logger** (see immediately above) is the syslog-style "same message key + rolling window" mechanism. D-17 explicit sketch:
- log-key = `subsystem + event + hash of key=val fields`
- if same key fires >N times in W-second window, collapse subsequent occurrences into `[subsystem] event <fields> ×N in Xs` summary at window close
- defaults: N=3, W=5s
- applied SELECTIVELY (opt-in per subsystem) — not all logs

Planner: enumerate hot-path callsites (visibility flap, scroll, per-render effects, `[render]` ticks) that opt-in; leave `[ws] close`, `[tts] play-attempt` opt-OUT.

---

### **NEW** `src/backend/utils/console-forward-transport.ts` (utility, batch)

**Analog:** `src/ui/lib/console-forwarder.ts` (mirror the frontend transport)

**Pattern to mirror from console-forwarder.ts:29-33, 59-76:**
```typescript
const buffer: LogEntry[] = [];
const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 500;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushFetch(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (buffer.length === 0) return;
  const entries = buffer.splice(0);
  fetch("/debug/console-log", { method: "POST", ... body: JSON.stringify({entries}) })
    .catch(() => {/* swallow — don't re-enqueue */});
}
```

**Backend variant differences** (per D-03 Claude's Discretion):
- No fetch to `/debug/console-log` — write DIRECTLY to `console-forward.log` file (or via the same in-process ring buffer at `src/backend/database/routes/debug.ts:56-58`). Same host, no HTTP hop.
- Add `source=backend` marker to each entry so a single `grep` can distinguish frontend vs backend lines.
- Buffer + periodic flush to avoid one-fsync-per-log-line cost.
- Wire from `src/backend/utils/logger.ts` so every `Logger.info/warn/error` call also enqueues here (in addition to its existing chalk-formatted console output).

---

## Shared Patterns

### Prefix taxonomy (D-13)

**Source:** CONTEXT.md § D-13 (locked)
**Apply to:** Every log line in every file this phase touches

Canonical prefixes: `[ws]` `[ws-msg]` `[pause-gate]` `[reopen]` `[session]` `[tts]` `[voice]` `[pwa]` `[compose]` `[tap]` `[render]` `[pane-state]` `[auth]` `[host-db]` `[relay]` `[fs]` + backend server-side variants: `[ws-server]` `[session-server]` `[pane-state-emitter]` `[voice-server]` `[host-db]` `[tmux-helper]` `[session-parser]`.

**Old prefixes to remap:**
- `[WebSocket]` → `[ws]`
- `[SkynetLog]` → subsystem-specific per context
- `[voice-diag]` → `[voice]`
- `[compose-draft]` → `[compose]`
- `[tap-diag]` → `[tap]`
- `[DIAG-REPORT]` → `[render]`
- `[SW]` → `[pwa]`
- `[postSpeakStream]` → `[tts]`

### Structured `msg` shape (D-11)

**Source:** `useVoiceRecording.ts:196` and surrounding
**Apply to:** Every log line — frontend AND backend

Format: `[subsystem] event key1=val1 key2=val2 ...`
- Prefix in brackets (from taxonomy above)
- Short verb-phrase event (no punctuation, hyphens for compound: `close`, `pause-entered`, `reopen-fired`, `play-attempt`, `handshake-completed`)
- Key=value pairs, quoted only when value contains spaces
- Explicit field extraction — NEVER `JSON.stringify(event)` on DOM Event objects (D-05)

### Standard fields (D-12)

**Source:** CONTEXT.md § D-12 (locked)
**Apply to:** Every log line where the field is in scope

Required-when-applicable fields:
- `hostId=N` (from useTerminalContext / route param)
- `sessionId=X` (tmux session name)
- `paneId=terminal:N:UUID` or `pretty-view:N:name`
- `wsUrl=/ws/...` (for WS lifecycle lines)

### Load-bearing ref transitions (D-06, D-15)

**Source:** CONTEXT.md § D-06/D-15
**Apply to:** Terminal.tsx (all 5 enumerated refs), any similarly-shaped ref in other files discovered during planning

Shape: `console.info(\`[subsystem] refName-transition edge=false→true trigger=<cause> <standard fields>\`)`

### Log-level semantics (D-14)

**Source:** CONTEXT.md § D-14 (locked)
**Apply to:** All emissions
- `info` = expected transitions (WS connected, pause entered, play started)
- `warn` = unexpected but not fatal (reconnect fired, dedup fallback taken)
- `error` = real failures (WS close with abnormal code, play() rejected, backend 5xx)

### Dedup discipline (D-17)

**Source:** D-17 + `src/backend/utils/logger.ts:180-204` (existing rate-limit precedent)
**Apply to:** Hot paths only (visibility flap, scroll, per-render effects, `[render]` ticks). Genuinely-per-event lines (`[ws] close`, `[tts] play-attempt`) opt OUT.

Shape after dedup: `[subsystem] event <fields> ×N in Xs` summary at window close.

### Backend→frontend log unification (D-03)

**Source:** D-03 + `src/backend/database/routes/debug.ts` (existing receiver)
**Apply to:** Every backend file this phase touches

Backend `Logger.*` calls flow through the NEW `console-forward-transport.ts` into `console-forward.log` alongside frontend lines. Add `source=backend` marker on backend entries so a single `grep` can filter/correlate.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/ui/lib/log-dedup.ts` (NEW) | utility | transform | No frontend dedup mechanism exists; closest is backend `Logger.shouldLog` (`src/backend/utils/logger.ts:180-204`) — reference-only, requires fresh implementation |
| `src/backend/utils/console-forward-transport.ts` (NEW) | utility | batch | Frontend has `console-forwarder.ts` (mirror-source for shape); no backend equivalent exists today |

Planner should use CONTEXT.md § D-17 explicit sketch (log-key = subsystem+event+hash-of-fields, N=3, W=5s defaults) and the frontend `console-forwarder.ts` batching pattern as construction references for these two NEW files.

---

## Metadata

**Analog search scope:**
- `src/ui/features/{terminal,pretty-view,voice-input}/`
- `src/ui/lib/` (console-forwarder, diag-emitter, diag-registry)
- `src/ui/hooks/` (use-service-worker)
- `src/backend/{claude-session,database/routes,ssh,utils}/`
- `src/main.tsx`

**Files scanned:** ~40
**Files opened for excerpt extraction:** 12
**Pattern extraction date:** 2026-08-11

**Key finding:** the codebase has ONE clean structured-logging example (`useVoiceRecording.ts` — 27 `[voice-diag]` lines, all matching the D-11 shape). Everything else is either silent (Terminal.tsx refs, pane-state-emitter, session-file-parser, tmux-helper, host.ts) or uses a partial shape (`[compose-draft]` printf-placeholder, `[tap-diag]` object-literal, `[WebSocket]` unstructured, `[SW]` unstructured). Phase 31's mechanical work is:
1. Normalize existing partial-shape lines to the D-11 template-literal form.
2. Rename old prefixes to D-13 canonical taxonomy.
3. Add NEW structured lines at every silent lifecycle/effect/event boundary enumerated in D-02 and D-03.
4. Build the two NEW utilities (log-dedup + backend console-forward-transport).
5. Wire `wasConnectedRef` and 4 other load-bearing refs to emit `edge=old→new trigger=<cause>` on every mutation.
