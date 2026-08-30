# Phase 19: Streaming TTS output via Chatterbox /tts endpoint - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Source:** Direct scope-lock session with Ashley (no discuss-phase needed — every decision was captured verbatim in this session's message log and in bounty `stream-tts-output-via-chatterbox/bounty.json`)

<domain>
## Phase Boundary

Replace the buffered TTS path on the pretty-view bubble speak-button with a progressive Web Audio player, so audio starts within ~30ms of clicking (before synthesis completes) instead of after the whole WAV is done. Ashley heard Nelly's streaming Chatterbox demo (https://gigaashley.click/tts-demo/) 2026-07-31 and said "night and day" vs the buffered path. iOS Safari Web Audio verified working on her iPhone PWA via same-day spike — no iOS-specific workaround required.

**In scope** (the bubble speak-button, one caller):
- `src/backend/database/routes/voice.ts` — new `handleSpeakStream` route + `POST /voice/speak-stream` wiring on port 30001
- `src/ui/api/voice-api.ts` — new `postSpeakStream(text, voice?)` fetch helper (not axios)
- `src/ui/features/pretty-view/ChatMessage.tsx` — speak handler switches from `postSpeak → new Audio(URL.createObjectURL(blob)).play()` to `postSpeakStream() → Web Audio API progressive decode`
- `docker/nginx.conf` + `docker/nginx-https.conf` — new `location /voice/speak-stream` block (both configs)
- Tests: backend route unit tests + frontend Web Audio tests (with AudioContext mock or skip-in-jsdom pattern)
- Ship: patch #237 + `skynet-patches.md` entry + human-verify end-to-end

**Out of scope** (deliberate, Ashley-confirmed):
- `POST /voice/speak` (patch #223 buffered route) — preserved BYTE-FOR-BYTE
- `postSpeak()` axios/blob helper — preserved unchanged
- `IdentityModal.tsx` voice-preview surface — keeps calling `postSpeak()` (one-shot 25-word sample, no benefit from streaming)
- Aside-bubbles, voice-mode replies, any other speak surface — Skynet doesn't have them (see "Ashley's scope clarification" below)
- Default voice change — stays `Elena.wav` (Ashley: "we're not gonna switch our default voice just because nelly picked a random one to do the demo with")
- Buffered-path fallback / dual-path routing — the two routes coexist; the bubble caller picks the streaming one, the preview caller picks the buffered one. No conditional / feature-flag logic.

</domain>

<decisions>
## Implementation Decisions

### Backend route shape
- **New route, not a replacement.** `POST /voice/speak-stream` sits alongside the existing `POST /voice/speak`. Both handlers live in `voice.ts`. The buffered route stays for IdentityModal voice-preview.
- **Pipe-through, no server-side buffering.** `Readable.fromWeb(response.body).pipe(res)` (or equivalent WHATWG→Node stream bridge). Grep-verifiable rule: `await response.arrayBuffer()`, `.text()`, `.blob()` on the Chatterbox response inside `handleSpeakStream` = plan-checker BLOCK.
- **Response headers:** `Content-Type: audio/wav` + `X-Accel-Buffering: no` (defense-in-depth against downstream reverse-proxy buffering).
- **Upstream endpoint:** `http://100.80.122.111:8001/tts` (Chatterbox streaming). NOT `/v1/audio/speech` — the OpenAI-compat endpoint has no `stream` flag.
- **AbortController on the upstream fetch:** 300s ceiling (same as patch #223 `handleSpeak`). Reasoning captured in `voice.ts:145-150` — TTS synthesis of long text can take minutes, shorter caps produce false-positive `database-connection-degraded` toasts.

### Request body schema translation
Client sends the SAME shape as the buffered route:
```json
{"text": "...", "voice": "Elena.wav"}  // voice optional
```

Server translates to Chatterbox:
```json
{
  "text": "...",
  "voice_mode": "predefined",
  "predefined_voice_id": voice ?? "Elena.wav",
  "stream": true,
  "split_text": true,
  "chunk_size": 80
}
```

Reuses existing `VOICE_FILENAME_RE` (`/^[A-Z][A-Za-z]+\.wav$/`) and `SPEAK_TEXT_MAX` (25000) constants from `voice.ts:30-32`.

### Security parity with patch #223
- **JWT auth:** wire `authenticateJWT` middleware BEFORE the body parser (T-16-04 pattern from `handleTranscribe`).
- **T-16-03 no-body-leak on non-2xx:** fixed error shape `{error: "TTS stream non-2xx", status: response.status}` — do NOT forward Chatterbox's response body on error.
- **Error paths:** 504 (AbortError → timeout), 502 (any other exception → proxy error). Mirror patch #223 shape verbatim.
- **No new shell/injection surfaces.** Request body is JSON in, JSON out on error, WAV bytes on success.

### Nginx configuration
- **NEW `location /voice/speak-stream`** block in `docker/nginx.conf` AND `docker/nginx-https.conf` (per CLAUDE.md caveat: "Every new backend route needs matching location blocks in BOTH configs, else it 200s with index.html and crashes the frontend on .map").
- Block contents:
  ```
  location /voice/speak-stream {
      proxy_pass http://skynet:30001;
      proxy_http_version 1.1;
      proxy_buffering off;
      proxy_request_buffering off;
      chunked_transfer_encoding on;
      proxy_read_timeout 300s;
      # Preserve JWT auth header, plus any headers the existing /voice/speak block preserves
  }
  ```
  Exact directives to match the existing `/voice/speak` block header handling (see current `docker/nginx.conf` for the pattern).
- **Existing `/voice/speak` block untouched.**
- **Caddy edge:** streams chunked-transfer by default. Verify with `curl -N https://term.gigaashley.click/voice/speak-stream ...` post-deploy — chunks should arrive as they synthesize, not batched.

### Frontend API helper
- **NEW `postSpeakStream(text, voice?)` in `voice-api.ts`.**
- Uses `fetch()` (NOT axios) — the streaming body reader requires the raw `Response` object.
- Returns `Promise<Response>` (caller drives the read loop).
- **JWT auth manually attached:** `Authorization: Bearer ${token}` header, token pulled from the same source `main-axios.ts` uses (grep for how the axios interceptor reads it; likely localStorage). No unauthenticated fallback.
- **`postSpeak()` untouched.**

### Frontend player — Web Audio API progressive decode
- **Replaces the entire speak-button handler body** in `ChatMessage.tsx:97-124` (currently `postSpeak → URL.createObjectURL(blob) → new Audio(url).play()`).
- **Pattern (reference: view-source at https://gigaashley.click/tts-demo/ — Nelly said lift wholesale):**
  1. `const response = await postSpeakStream(text, voice)` — throws if response.ok is false, surface as toast.
  2. `const reader = response.body.getReader()`
  3. Accumulate `Uint8Array` chunks until the first 44 bytes are collected — parse RIFF/WAV header (sample rate, channels, bit depth, sample format).
  4. Once header parsed: for each subsequent chunk of PCM data:
     - Compute frame count = chunk.byteLength / (channels * (bit_depth/8))
     - Allocate `AudioBuffer(channels, frames, sampleRate)`
     - Copy PCM samples in with bit-depth conversion (Int16 → Float32 normalized to [-1, 1], etc.)
     - Create `AudioBufferSourceNode`, connect to `AudioContext.destination`
     - Schedule via `sourceNode.start(nextStartTime)` where `nextStartTime` = running clock (initialized to `AudioContext.currentTime + smallEpsilon`; advanced by `buffer.duration` after each schedule)
- **AudioContext lifecycle:** create fresh per speak invocation. Close on completion or teardown.

### Cross-bubble Stop / new-bubble-preempt semantics
- **Current** (`ChatMessage.tsx:87-93`): module-level `currentAudio` singleton, `.pause()` + `URL.revokeObjectURL()` + null-out.
- **New:** singleton tracks `{ ctx: AudioContext, sources: AudioBufferSourceNode[], reader: ReadableStreamDefaultReader | null, owner: bubbleId }`.
- **Teardown (called on new bubble start OR user clicks Stop):** iterate `sources`, call `.stop()` on each; call `.cancel()` on `reader`; call `.close()` on `ctx`; null-out.
- **`speakState` transitions:** `idle` → `loading` (fetch in-flight) → `playing` (first buffer scheduled) → `idle` (last source ended OR error OR teardown). Preserve the current state machine's observable behavior — the speak-button icon changes should look identical.

### Error handling
- **fetch-level errors** (non-2xx response, network failure before body reader starts): toast + revert to `idle`. Mirror the current `try/catch` from `ChatMessage.tsx:119-124`.
- **mid-stream errors** (network blip drops the body, Chatterbox restarts mid-response, container `--force-recreate`): reader `.read()` rejects; teardown scheduled sources + AudioContext, revert to `idle`, no ugly click or trailing partial audio. NO auto-retry (would risk stuttering / doubled audio).
- **Accepted tradeoff:** losing the `voice-api.ts:11-12` `dbHealthMonitor.isBackendUnreachable` auto-toast integration on the streaming path. That integration is axios-specific (matches "timeout" substring in axios error messages); reproducing it for fetch stream errors is out of scope. Streaming errors are semantically different from database-unreachable anyway.

### Testing
- **Backend unit tests** (matching `voice.test.ts` pattern for `handleSpeak`):
  - Happy path: 200 + audio/wav content-type + non-buffered response (mock a chunked upstream body, verify pipe-through)
  - JWT auth: 401 for missing/invalid JWT (middleware ordering)
  - Body validation: 400 for missing/empty `text`, 400 for `text` exceeding `SPEAK_TEXT_MAX`, 400 for invalid `voice` format
  - Non-2xx upstream: fixed error shape `{error, status}` — no upstream body leak (T-16-03 analog)
  - AbortController: 504 on timeout (mock a slow upstream)
  - Body-schema translation: verify Chatterbox request body matches spec (`voice_mode:"predefined"`, `stream:true`, etc.)
- **Frontend tests:**
  - Web Audio API is unreliable in jsdom (patch #211 lesson: even HTMLAudioElement is fake). Options:
    - (a) Mock `AudioContext` / `AudioBufferSourceNode` at the test-suite level — complex but comprehensive
    - (b) Skip Web-Audio-path tests in jsdom, add a Playwright integration test for the real browser path
    - (c) Extract the RIFF header parser + PCM chunk decoder into pure functions with their own unit tests, mock the AudioContext scheduling layer
  - Recommend (c) — RIFF parse + PCM decode are pure and deterministic; AudioContext scheduling is small and mockable.
- **End-to-end manual verify** (part of the ship checklist, not a plan task per se):
  - Click speak on a long assistant message (multiple sentences) in production Skynet
  - Confirm audio begins playing well before synthesis completes (perceptible latency << full-buffer latency)
  - Confirm bubble-to-bubble preempt works (start speaking bubble A, click speak on bubble B, A stops cleanly)
  - Confirm Stop button (existing) tears down the stream cleanly
  - Repeat on iPhone PWA (iOS Safari)

### Ship as numbered patch #237
- Full `skynet-patches.md` entry with the standard shape: motivation, root cause vs previous approach, request-body-schema translation table, files touched, rebase risk (LOW), deploy note.
- Deploy note: bundles with the held #198→#236 queue (~57 unpushed-to-container commits). This patch rides the same rebuild + recreate whenever Ashley greenlights.

### Claude's Discretion
- **Exact task/plan wave breakdown** — planner's call. Suggest ~4-5 plans covering: (1) backend route + tests, (2) nginx config, (3) frontend voice-api helper, (4) frontend ChatMessage.tsx player + Stop semantics + tests, (5) skynet-patches.md entry + deploy checklist.
- **Whether to extract a `WebAudioPlayer` helper class** in `src/ui/features/pretty-view/` vs inlining logic into `ChatMessage.tsx`. If the logic exceeds ~80 lines or would be reused, extract. Otherwise inline.
- **Exact RIFF-parse and PCM-copy implementations** — Nelly's demo view-source is the reference; planner should not re-invent.
- **Test framework specifics** — follow existing `voice.test.ts` + `ChatMessage.test.tsx` patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reference implementations (patch #223 — the buffered path we're mirroring)
- `src/backend/database/routes/voice.ts` — full `handleSpeak` (L128-199) and `handleTranscribe` (L58-126) implementations; JWT wiring, AbortController pattern, T-16-03 no-body-leak, error shape. `handleSpeakStream` mirrors this structure but pipes instead of buffers.
- `src/ui/api/voice-api.ts` — existing `postSpeak` (L5-21) shape. `postSpeakStream` mirrors the auth + timeout intent but with fetch + streaming Response.
- `src/ui/features/pretty-view/ChatMessage.tsx:80-124` — current speak-handler body, module-level `currentAudio` singleton, `speakState` state machine, error handling pattern.

### Reference documentation (external)
- Nelly's streaming Chatterbox demo — https://gigaashley.click/tts-demo/ (view-source has the ~50-line JS reference for RIFF parse + AudioBufferSourceNode scheduling; Nelly explicitly said lift wholesale).
- Chatterbox voice list — `GET https://gigaashley.click/tts-api/v1/audio/voices` (28 predefined voices; not needed for this phase since default stays Elena, but noted for future voice-picker work).

### Nginx / CLAUDE.md conventions
- `docker/nginx.conf` — existing `location /voice/speak` block (find via grep for `speak`); new streaming block matches its shape + adds `proxy_buffering off; proxy_request_buffering off; chunked_transfer_encoding on;`.
- `docker/nginx-https.conf` — same pattern; both files MUST be updated (CLAUDE.md line 42 caveat, patch #232 lesson: patch #232 tuned nginx `proxy_read_timeout` for TTS specifically because the OpenAI-compat route was returning 404 through the proxy).
- `CLAUDE.md` root — "Every new backend route needs matching location blocks in BOTH docker/nginx.conf AND docker/nginx-https.conf, else it 200s with index.html and crashes the frontend on .map".

### Patches this phase depends on / touches
- **Patch #223** (2026-07-25): TTS shipped; `handleSpeak` + `postSpeak` + IdentityModal voice-preview. This phase preserves #223 byte-for-byte on the buffered path.
- **Patch #232** (2026-07-31): nginx `/voice` `proxy_read_timeout 60s → 300s` — lesson for the streaming route's timeout tuning.
- **Patch #211** (~2026-07-XX): "NEVER bare audio.play().catch(...) — jsdom returns undefined" — reminder that jsdom lies about audio APIs; Web Audio API tests need pure-function extraction or explicit mocks.

### Bounty (authoritative record of this phase's requests + scope decisions)
- `~/.claude/identities/tina/bounties/stream-tts-output-via-chatterbox/bounty.json` — Nelly's DM captured verbatim, full spec, Ashley's 2026-07-31 scope decisions (streaming replaces bubble speak-button only; IdentityModal voice-preview stays buffered; default voice stays Elena; iOS spike passed; vehicle = plan-phase).

</canonical_refs>

<specifics>
## Specific Ideas

### Ashley's scope clarification 2026-07-31 (verbatim from this session)
When asked about scope (which surfaces stream, keep buffered fallback, default voice), Ashley said:

> "Yeah, well, the iOS spike did succeed, so that was great. And then, yeah, I feel like the message bubble speak button would stream, and I don't really feel like we have to have the voice preview stream. And I don't know what you mean by voice mode, because this app doesn't have a voice mode, and we're not gonna switch our default voice just because nelly picked a random one to do the demo with"

Concretely:
1. iOS Safari Web Audio verified via her iPhone PWA spike of Nelly's demo — passing. No iOS-specific workaround needed.
2. Bubble speak-button streams; IdentityModal voice preview does not.
3. There is no "voice mode" in Skynet — Tina's earlier fuzzy mention was wrong; the ONLY two speak-callers are the bubble button and the IdentityModal preview. Grep-confirmed (`grep -rn "postSpeak" src/ui | grep -v test`).
4. Default voice stays `Elena.wav`.

### Ashley's greenlight (verbatim, session end):
> "Yeah, this seems good. Let's go."

### Nelly's endpoint spec (verbatim from DM 2026-07-31, event $Piv-9UsNx5LjDfpXbDnspf_8TMTmLQyX4XKO49i4ZC8):
See bounty `stream-tts-output-via-chatterbox/bounty.json § premise` for the full DM text. Load-bearing extract:

> Endpoint (HTTPS via my proxy, mixed-content safe from a browser page):
>   POST https://gigaashley.click/tts-api/tts
> Body (JSON):
>   {"text":"...", "voice_mode":"predefined", "predefined_voice_id":"Adrian.wav",
>    "stream":true, "split_text":true, "chunk_size":80}
>
> Returns audio/wav — ONE continuous WAV whose RIFF header carries the 0xFFFFFFFF unknown-length sentinel, chunked-transfer as each text chunk is synthesized. TTFB ~30ms through the proxy.
>
> Two gotchas that make this NOT a drop-in for /v1/audio/speech:
> 1. Different endpoint, different body schema. stream:true only works on /tts. The OpenAI-compat /v1/audio/speech has no stream flag.
> 2. output_format is ignored when streaming — you get WAV, period (not mp3/opus). Fine for <audio> or a raw pipe; for progressive in-browser playback use Web Audio API — parse RIFF header from first bytes, decode each incoming PCM chunk into an AudioBuffer, schedule back-to-back via AudioBufferSourceNode so audio starts on the first samples not on stream end.

**Tina uses the tailnet IP directly for the backend proxy** (`http://100.80.122.111:8001/tts`, not `https://gigaashley.click/tts-api/tts`) because the backend already sits inside Skynet's docker network with tailnet access. The public HTTPS URL is only relevant for the client-side / view-source reference.

### Deploy discipline
- **Do not push / rebuild / recreate without Ashley's explicit ship word.** Deploy queue #198→#236 (~57 commits) is held; this patch #237 will ride the same bundle whenever she greenlights.
- **skynet-ec2 recreate warning** (patch #232 discovery): the `--force-recreate` sequence causes a HTTP2_PROTOCOL_ERROR on the first hard-refresh — Ashley pre-warns on ship day, standard workflow.

</specifics>

<deferred>
## Deferred Ideas

- **Voice-picker for streaming.** IdentityModal has a voice-preview surface with the 28-voice list; the streaming route accepts any predefined voice via the same `voice` parameter, so no UI change is needed to support per-identity voices already stored in the DB. But surfacing a "test the new voice on streaming" affordance in IdentityModal is out of scope — the preview surface stays buffered.
- **Extraction to a general-purpose `WebAudioStreamPlayer` module.** If a second streaming caller emerges later (e.g. aside-bubble narration), factor out. For now, inline in `ChatMessage.tsx` or extract as `src/ui/features/pretty-view/webAudioStreamPlayer.ts` per planner's call — but no "future-proofing for hypothetical callers."
- **Replacing the buffered `/voice/speak` route entirely.** Not in scope. IdentityModal voice-preview would need to be rewritten to use the streaming path first (currently reads the response as a Blob for one-shot playback of a 25-word sample, no benefit). Revisit only if the buffered route becomes a maintenance burden.
- **Auto-toast integration on stream errors** (recreating `dbHealthMonitor.isBackendUnreachable` for fetch stream errors). Out of scope — Ashley confirmed the tradeoff.
- **iOS-specific tuning.** Spike passed on Ashley's iPhone PWA; no workaround needed. If a specific iOS Safari behavior surfaces post-ship (e.g. AudioContext auto-suspend on tab background), file a follow-up.

</deferred>

---

*Phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint*
*Context gathered: 2026-07-31 via direct scope-lock session with Ashley (no discuss-phase; every decision captured verbatim in session log + bounty `stream-tts-output-via-chatterbox/bounty.json`)*
