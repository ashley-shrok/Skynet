# Phase 16: Voice input in ComposeBox - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Source:** Manual authorship by tina — prototype UAT already passed on iOS PWA (`~/.claude/identities/tina/bounties/add-voice-input/prototype.html` served at `https://gigaashley.click/tina-voice-prototype/prototype.html`). Ashley response: "holy shit that just worked 100%, in a add-to-home-screen PWA". Design pins locked in bounty; nelly-owned STT contract verified live. This CONTEXT.md replaces a discuss-phase round because the prototype IS the discussion.

<domain>
## Phase Boundary

**What this phase delivers:** Voice input in the Skynet pretty-view ComposeBox. A mic-glyph button lives inside each ComposeBox textarea. Tapping it starts recording audio via `MediaRecorder`. While recording, the mic button is swapped OUT of that slot and three action buttons swap IN in its place: `cancel` (drop the clip, no changes), `end + append` (stop recording, transcribe, append the transcript to whatever is already in the textarea), `end + send` (stop recording, transcribe, append, send the full contents through the existing send path). The audio blob is POSTed to a NEW Skynet backend endpoint that reverse-proxies to the tailnet faster-whisper STT service on GigaAshleyPC, receives the transcript, and returns it to the client.

**What this phase does NOT deliver:**
- No changes to the existing send path (existing textarea send, thumbs-up, queue, reset all UNCHANGED).
- No changes to the terminal / RDP / Guacamole / conversation-list / pretty-conversations surfaces.
- No new state persistence (transcripts flow through the textarea like typed text).
- No streaming STT (faster-whisper backend is batch-only per Nelly's contract).
- No level meter, waveform, or recording-time counter (Ashley explicitly declined — the three-button record state IS the recording indicator).
- No swipe-to-cancel gesture (Ashley chose a plain cancel BUTTON).
- No multi-language or model selection (server ignores the `model` param and always uses `large-v3`).
- No audio persistence — the blob is transient; only the transcript enters the textarea.

**In-scope surface files:**
- `src/ui/features/pretty-view/ComposeBox.tsx` — mic button + record-state swap + MediaRecorder wiring + fetch to backend transcribe endpoint.
- New icon/component sub-files as the planner sees fit (e.g. `MicButton.tsx`, `RecordingControls.tsx`) — keep them local to `pretty-view/`.
- Backend: new `POST /voice/transcribe` endpoint in the Skynet Node/Express server that forwards multipart audio to `http://100.80.122.111:8000/v1/audio/transcriptions` over tailnet and returns `{text}`. Location: wherever existing pretty-view routes live (planner reads existing patterns).
- `docker/nginx.conf` AND `docker/nginx-https.conf` — mandatory nginx `location` block additions per CLAUDE.md Nginx caveat (else the route 200s with index.html and crashes the frontend on `.map`). Planner MUST include this.
- Tests: unit tests for the backend endpoint (multipart passthrough, STT-error surface, timeout); frontend integration test for the record → transcribe → append flow with a mocked backend.
</domain>

<decisions>
## Implementation Decisions

### Locked design pins (Ashley 2026-07-27, prototype UAT)

- **Mic button lives INSIDE the textarea slot** — same visual precedent as the existing send button (patch #78-adjacent). Forward-compatible with the queued `message-queue-in-pretty-view` bounty where the ComposeBox will host multiple textareas, each with its own controls.
- **Tap-to-record swaps the mic button OUT of its slot and swaps in three action buttons** in the same slot: `cancel` | `end + append` | `end + send`. The three-button state IS the recording indicator — no separate signal element, no level meter, no timer.
- **Bare-glyph aesthetic** per pretty-view visual language (§ pretty-view: bubble = content, bare-glyph = indicator). Use lucide-react icons: `Mic` (idle), `X` (cancel), a down-arrow-into-line glyph (append — use `ArrowDownToLine` or similar), `Send` / paper-plane (send). Cancel is red-tinted per pv palette danger accent; end+send is coral-tinted per pv-coral accent.
- **Cancel is a BUTTON, not a swipe gesture.** Explicit user rejection of iOS-Messages-style drag-to-cancel.
- **Palette is `--color-pv-*` tokens** — do NOT draw color from Skynet's `--background`/`--foreground` tokens. See `src/ui/index.css:117-146` for the token set. In particular: warm off-white text `#e8e4d8`, warm coral accent `#ffb896`, cool off-black gradient base.
- **After transcript arrives, the textarea gets the transcript with a single-space glue** if the existing contents don't already end in whitespace (`if (cur && !/\s$/.test(cur)) glue=' '`). Append-mode leaves send to the user. Send-mode calls the SAME existing send handler the current send button uses (do not invent a parallel send path).

### Locked STT contract (Nelly 2026-07-27, verified live)

- **Service:** self-hosted faster-whisper on GigaAshleyPC, tailnet-only.
- **URL:** `http://100.80.122.111:8000/v1/audio/transcriptions` — direct STT endpoint.
- **Shape:** OpenAI-compatible. `POST` multipart/form-data with field name `file` (NOT `audio`); optional `model` param IGNORED by server, always uses `large-v3`.
- **Accepted formats:** mp4/m4a/webm/mp3/wav/ogg via ffmpeg on the backend — iOS Safari's `audio/mp4` MediaRecorder output decodes fine. Chrome/Android `audio/webm` also fine.
- **Response:** `{"text": "..."}` — OpenAI shape.
- **Auth:** none (tailnet-only).
- **Latency:** ~0.4s for a 1s silent clip; ~1-2s round-trip for a 10s spoken clip.
- **Streaming:** NO — batch only. Single POST → final text.
- **Ground-truth probe verified by Nelly:** `curl -F "file=@silent.wav" http://100.80.122.111:8000/v1/audio/transcriptions` → `{"text":""}` HTTP 200 in 0.31s.

### Production audio path — cannot be client-direct

Ashley's phone (and any browser) reaches Skynet over the **public internet** at `term.gigaashley.click`, NOT over the tailnet. The STT service is tailnet-only. Therefore the production path MUST be `PWA → Skynet backend → tailnet STT → transcript back → client`. The Skynet backend reverse-proxies the multipart body to the STT endpoint and returns the JSON.

**Do NOT try to have the client fetch the STT URL directly.** That worked in the prototype only because Nelly added a Caddy proxy on `https://gigaashley.click/stt/*` bypassing Authelia for tailnet clients — that path serves the prototype which is on the tailnet. Production Skynet users are NOT on the tailnet.

**Backend endpoint contract (proposed — planner refines):**
- `POST /voice/transcribe` (route path in the backend router; nginx.conf + nginx-https.conf must both proxy it).
- Accepts multipart/form-data with a `file` field (browser sends this shape identically to how STT expects it).
- Forwards the multipart body untouched to `http://100.80.122.111:8000/v1/audio/transcriptions` using a Node HTTP client (fetch/undici/axios — planner picks based on existing patterns in the codebase).
- Returns the STT's JSON response verbatim (or wraps errors with a stable shape).
- On STT error (non-2xx): return `{error: string, status: number}` with the STT's HTTP status code.
- On STT timeout: apply a reasonable server-side timeout (~30s — a 30s clip transcribes in ~3-5s, so 30s is generous headroom).
- Auth: use existing Skynet session auth (no new auth surface; endpoint sits behind the same middleware as other pretty-view routes).

### iOS Safari MediaRecorder constraints (locked from prototype + Nelly warning)

- **`getUserMedia({audio: true})` MUST be called SYNCHRONOUSLY inside the tap handler with NO `await` before it.** Any await before the getUserMedia call causes iOS Safari to silently swallow the mic permission prompt. This is Nelly's warning, verified in the prototype. The code path in ComposeBox MUST preserve this — the tap handler kicks off the getUserMedia call as its first action, then awaits.
- Format: iOS Safari's `MediaRecorder` defaults to `audio/mp4`. Do not pass a `mimeType` option — let the browser pick its default. Backend + STT decode both mp4 and webm fine.
- Permission is granted once per origin; PWA installed on the home screen retains the grant.
- Denied permission: surface a UX state (grey mic button + tooltip explaining how to re-enable in iOS Settings). Non-blocking — the textarea still accepts typed input.

### Testing constraints

- Backend tests: assert multipart passthrough (body bytes unchanged), assert STT `{text}` response is returned intact, assert 5xx errors surface as `{error, status}`. Use a mocked STT endpoint or the fork's existing HTTP client mocking pattern (planner reads existing test files to match).
- Frontend tests: assert the button state machine (idle → recording → transcribing → idle after each action), assert `getUserMedia` is called synchronously in the tap handler (mock it — return a stubbed stream), assert the transcribe fetch is called with the recorded blob, assert append vs send actions call the right downstream handlers (append updates textarea, send calls the existing ComposeBox send).
- iOS Safari behavior is not unit-testable — flag as a manual-verification step in the plan's verification section (Ashley already verified on her PWA in the prototype UAT).

### Fleet-directive constraints

- **Do NOT touch any of the dead surfaces** listed in tina's identity file: settings, AppRail, dashboard, snippets manager, host manager UI pages, admin console, file manager UI, Skynet top-level tab bar chrome, keyboard shortcut editor. Voice input is a pretty-view-INTERIOR feature; scope stays inside `src/ui/features/pretty-view/` on the frontend.
- **Update `~/.claude/identities/tina/skynet-patches.md` in the same commits as the code** — new fleet directive from Ashley 2026-07-27: docs/catalog updates happen inline with work, never queued, never awaiting greenlight. The planner should include a task at the end of each PLAN.md to update this catalog file.
- **No `caddy reload` recommended during deploy** — Skynet only, nginx reload handled by the compose recreate.
- **Deploy discipline** (per identity file): planner should NOT include a deploy task in the plan. Deploys are a separate Ashley-greenlit event per patch #35 rule ("every build → deploy is a new may-I moment"). Plan ends at "code + tests + commit landed."
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ComposeBox and pretty-view precedents
- `src/ui/features/pretty-view/ComposeBox.tsx` — the file being modified. Read current implementation of the send button embedded in the textarea (patch #78-adjacent). Match its structure for the new mic button.
- `src/ui/features/pretty-view/PrettyView.tsx` — parent surface; understand the props flowing into ComposeBox.
- `src/ui/index.css:117-146` — pretty-view palette tokens (`--color-pv-*`). Use these for mic/cancel/append/send button colors.
- `src/ui/features/pretty-view/` directory — enumerate existing sub-components to match naming/structure conventions.

### Backend route precedents
- Wherever the existing pretty-view WebSocket + REST routes live in the backend (planner discovers via grep of `POST` handlers referenced by pretty-view). New endpoint must sit alongside them behind the same session-auth middleware.
- Existing multipart-handling routes in the backend (if any) — search for `multer`, `busboy`, or `Content-Type: multipart` handling to match the fork's HTTP client conventions.
- `claude-session-server.ts` — heavy backend file for pretty-view session tail + BTW handling; contains most current pretty-view backend logic. Read to understand middleware chain and error handling patterns.

### Nginx routing (MANDATORY)
- `docker/nginx.conf` — add a `location` block for the new backend endpoint.
- `docker/nginx-https.conf` — add the SAME `location` block. Both files must have it or the frontend 200s with `index.html` on the endpoint and crashes on `.map`. This is a load-bearing fork gotcha from CLAUDE.md.

### Prototype reference (what UAT-passed on iOS PWA)
- `~/.claude/identities/tina/bounties/add-voice-input/prototype.html` — 340-line self-contained HTML with the exact button state machine, MediaRecorder wiring, and fetch flow that Ashley UAT-passed. Planner should MIRROR the state machine and error-handling shape here. In particular the `startRecording` / `stopRecording` / `transcribe` functions and the `setState('idle'|'recording'|'transcribing', msg)` pattern.

### Bounty tracker (source of truth for design decisions)
- `~/.claude/identities/tina/bounties/add-voice-input/bounty.json` — full design + collaboration history. Read the timeline for context.

### Fork-wide constraints (identity + CLAUDE.md)
- `~/.claude/identities/tina/tina.md` — Standing directives, learned preferences. Specifically: pretty-view visual language, palette authority, dead-surfaces canonical list, scope discipline, docs-inline rule.
- `/home/ubuntu/skynet/CLAUDE.md` — nginx caveat, deploy safety, rebase-ability. Note: some content in this file is stale (42 patches count, deadman references) — planner should NOT rely on those figures. The nginx caveat IS current and load-bearing.
</canonical_refs>

<specifics>
## Specific Ideas

### Frontend state machine (mirror the prototype)

```
IDLE:
  - textarea + mic button (single button in the slot)
  - tap mic → RECORDING

RECORDING:
  - textarea + [cancel | end+append | end+send] (three buttons in the slot)
  - tap cancel → drop audio, IDLE
  - tap end+append → stopRecording() → TRANSCRIBING → append text → IDLE
  - tap end+send → stopRecording() → TRANSCRIBING → append text + send → IDLE

TRANSCRIBING:
  - textarea + status line ("transcribing…")
  - buttons hidden or non-interactive
  - on success → IDLE
  - on error → IDLE (with error surfaced in status or a toast)
```

### Recommended file additions (planner refines)

- `src/ui/features/pretty-view/MicButton.tsx` — the single mic button (idle state).
- `src/ui/features/pretty-view/RecordingControls.tsx` — the three-button record state.
- `src/ui/features/pretty-view/useVoiceRecording.ts` — a hook that owns the state machine + MediaRecorder + fetch, exposes `{state, start, cancel, endAppend, endSend}` to the ComposeBox. Keeps the ComposeBox render clean.
- Backend: extend the appropriate router file with a new route handler. If a `voice.ts` or `transcribe.ts` doesn't exist, create a small new file.

### iOS Safari sync-getUserMedia pattern (locked)

```typescript
function handleMicTap() {
  // MUST call getUserMedia SYNCHRONOUSLY on the tap — no await before it
  const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });
  // Now safe to await
  streamPromise.then(stream => {
    // set up MediaRecorder, start recording, transition to RECORDING state
  }).catch(err => {
    // surface permission-denied state
  });
}
```

The hook should encapsulate this so ComposeBox just calls `voice.start()` in its tap handler.

### skynet-patches.md write-up

Per Ashley's 2026-07-27 fleet directive (docs inline, never queued), the plan MUST include a task in the final wave that updates `~/.claude/identities/tina/skynet-patches.md` with the patch number and full write-up (motivation, root cause n/a, fix summary, files touched, rebase risk). The write-up should be complete before the last commit lands.
</specifics>

<deferred>
## Deferred Ideas

Explicitly out of scope for Phase 16 — do NOT include:

- **Streaming STT** — deferred until faster-whisper backend adds it (currently batch-only).
- **Voice input inside the message-queue textareas** — will layer on when `message-queue-in-pretty-view` ships. The mic-inside-textarea design is forward-compatible so this drop-in should be trivial.
- **Multi-language / model selection** — server always uses `large-v3`; no UX to pick.
- **Waveform / level meter / recording timer** — Ashley explicitly declined.
- **Swipe-to-cancel gesture** — Ashley chose a plain cancel BUTTON.
- **Audio persistence** — the blob is transient; only transcripts enter the textarea.
- **Auto-punctuation editing UI / TTS confirmation** — user reads the transcript in the textarea and edits by hand if needed.
- **Reconnect / retry on transcribe error** — first version surfaces the error and lets the user retry manually. Auto-retry can layer on later if flakiness is observed in real use.
- **Deploy** — planning ends at "code + tests + commit landed." Deploy is a separate Ashley-greenlit event (patch #35 rule).
- **Retiring the prototype hosting** — the prototype at `https://gigaashley.click/tina-voice-prototype/prototype.html` and the `/stt/*` Caddy proxy on gigaashley.click stay up until the integrated version is deployed and UAT-verified. That retirement is a follow-up ping to Nelly, not a plan task.
</deferred>

---

*Phase: 16-voice-input-in-composebox-mic-button-tap-to-record-stt-via-s*
*Context authored: 2026-07-27 by tina (manual, prototype-informed)*
