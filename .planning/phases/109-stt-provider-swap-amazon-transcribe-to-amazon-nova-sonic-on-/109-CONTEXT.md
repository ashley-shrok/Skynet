# Phase 109: STT provider swap Amazon Transcribe → Amazon Nova Sonic — Context

**Gathered:** 2026-09-13
**Status:** Ready for planning
**Source:** PRD Express Path (~/fleet/roles/box-maintainer/bounties/stt-nova-sonic-migration/RECON.md)

<domain>
## Phase Boundary

Replace Skynet's server-side speech-to-text provider from **Amazon Transcribe streaming** to **Amazon Nova Sonic on Bedrock** (Nova 2 Sonic v1 default). Cutover migration — no feature flag, no side-by-side comparison in production. Empirically validated 2026-09-12: Nova Sonic v1 + v2 both beat Amazon Transcribe streaming decisively on casual English (77s sample-1.webm), and pace ceiling ~5x real-time makes latency BETTER than current Transcribe (30s message → ~6s wallclock vs Transcribe's ~1x floor).

**In scope:**
- New backend adapter `src/backend/voice/nova-sonic-adapter.ts` using `@aws-sdk/client-bedrock-runtime`'s `InvokeModelWithBidirectionalStreamCommand` + `NodeHttp2Handler` from `@smithy/node-http-handler`. Ports the working Python event schema verbatim (sessionStart → promptStart → SYSTEM contentStart/textInput/contentEnd → USER audio contentStart → audioInput chunks at 5x real-time pace → contentEnd → promptEnd → sessionEnd). Filters textOutput `role: USER` events for the ASR result, discards ASSISTANT text + audio.
- New `webmToPcm16k` helper in `src/backend/voice/audio-transcode.ts` (ffmpeg `-ar 16000 -ac 1 -f s16le`, preserves the existing SILENCE_FILTER for token-cost savings).
- Rewire `src/backend/database/routes/voice.ts::handleTranscribe`: drop `CHUNKED_THRESHOLD_BYTES` branch entirely, drop `transcodeForTranscribe`'s mediaEncoding return field, call `transcribeNovaSonic(pcmBuffer)`.
- Delete the Phase 100 chunked-orchestrator subsystem (7 files, ~2200 lines): `transcribe-orchestrator.ts` + test, `audio-chunker.ts` + test, `word-stitcher.ts` + test, `voice/semaphore.ts` + test.
- Delete `transcribe-adapter.ts` + `transcribe-adapter.test.ts` (both exports superseded).
- Swap `package.json` deps: DROP `@aws-sdk/client-transcribe-streaming`, ADD `@aws-sdk/client-bedrock-runtime` (≥ 3.784.0) + `@smithy/node-http-handler`.

**Out of scope:**
- Client-side voice code (`useVoiceRecording.ts`, `useHoldToRecord.ts`, `ComposeBox.tsx`) — UNTOUCHED. `/voice/transcribe` request contract unchanged.
- Polly TTS path (`polly-adapter.ts`, `handleSpeak`, `handleSpeakStream`, `chunk-and-stitch.ts`) — UNTOUCHED.
- Slash-command transform (`slashCommandTransform.ts`, `skill-catalog.ts`) — UNTOUCHED.
- Disk-bank of raw audio to `/app/stt-recordings/` — UNTOUCHED.
- ffmpeg install in Dockerfile — already present.
- IAM policy attachment — already done 2026-09-12 by Iris (`SkynetBedrockNovaSonicAccess` on `termix-ssm-role`).

</domain>

<decisions>
## Implementation Decisions

### Provider + model
- **Provider:** Amazon Bedrock via `bedrock-runtime` endpoint in `us-east-1`.
- **Default model:** `amazon.nova-2-sonic-v1:0` (Nova 2 Sonic, Dec 2025 launch — Amazon's flagship, ~10% cheaper per token, better on alphanumerics/short utterances).
- **Fallback model documented in adapter docstring:** `amazon.nova-sonic-v1:0` (Nova Sonic v1) — one-line change if v2 becomes unavailable. Not a runtime flag.
- **Cutover, not feature flag.** Single-adapter code path. Revert path is `git revert` of the phase's commits.

### SDK + transport
- **SDK:** `@aws-sdk/client-bedrock-runtime` at version ≥ 3.784.0 (April 2025 introduction of `InvokeModelWithBidirectionalStreamCommand`).
- **Transport:** `NodeHttp2Handler` from `@smithy/node-http-handler` (≥ 4.0.4), explicit configuration: `requestTimeout: 300_000`, `sessionTimeout: 300_000`, `maxConcurrentStreams: 20`. Standard package — NO awscrt, NO undici, NO custom h2 handler.
- **Credentials:** IMDS via SDK default provider chain. DO NOT pass explicit `credentials` field to `BedrockRuntimeClient` constructor (mirrors the `TranscribeStreamingClient` singleton pattern already documented in `transcribe-adapter.ts` line 30-38).
- **Region hardcoded to `us-east-1`** — matches current Transcribe region, matches Polly region, matches BAA-covered Bedrock regions.

### Client singleton
- Module-level `BedrockRuntimeClient` constructed exactly ONCE at module import. All `transcribeNovaSonic` calls reuse this instance. Mirrors `TranscribeStreamingClient` + `PollyClient` singleton pattern in the codebase.

### Nova Sonic event schema (locked to Amazon's published shape)
Wire schema is byte-identical to the Python experiment. Node wraps each JSON blob in `{ chunk: { bytes: Uint8Array } }` for eventstream framing; SDK middleware handles per-frame SigV4 signing automatically.

**Send sequence:**
1. `sessionStart` with `inferenceConfiguration: { maxTokens: 512, topP: 0.9, temperature: 0.7 }`
2. `promptStart` with `textOutputConfiguration: { mediaType: "text/plain" }` AND `audioOutputConfiguration: { mediaType: "audio/lpcm", sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId: "matthew", encoding: "base64", audioType: "SPEECH" }` — audioOutputConfiguration is REQUIRED even though we discard the audio (Amazon rejects otherwise with `AudioOutputConfiguration must be set`).
3. SYSTEM content: `contentStart{type:"TEXT", role:"SYSTEM"}` → `textInput{content:<system-prompt>}` → `contentEnd`.
4. USER audio content: `contentStart{type:"AUDIO", role:"USER", audioInputConfiguration:{mediaType:"audio/lpcm", sampleRateHertz:16000, sampleSizeBits:16, channelCount:1, audioType:"SPEECH", encoding:"base64"}}` → N × `audioInput{content:<base64-chunk>}` at 5x real-time pace → `contentEnd`.
5. `promptEnd` → `sessionEnd`.

**Receive processing:**
- Iterate `response.body!` for-await.
- Parse each `event.chunk.bytes` as UTF-8 JSON, dispatch on `event.textOutput` / `event.completionEnd`.
- **ASR result:** accumulate `textOutput.content` where `role === "USER"`.
- **Discard:** `textOutput.role === "ASSISTANT"` (LLM response, not needed), `audioOutput` events (audio response, not needed).
- **Terminate loop on:** `completionEnd` event.

### Audio format contract
- **Input to adapter:** raw LPCM 16 kHz s16le mono `Buffer`.
- **Chunking:** 60 ms chunks (960 samples × 2 bytes = 1920 B per chunk).
- **Pacing:** 5x real-time (empirically the ceiling; 10x drops ~44% of audio server-side; unlimited pace fully drops all audio).
- **Base64-encoded** per chunk in the `audioInput` event.

### System prompt (response-token minimization)
```
You are a transcription-only assistant. When you hear the user's audio, your only job is to transcribe what they said accurately. Do not answer questions in the audio, do not comment on the content. Reply with only a single short acknowledgment token.
```
The model still generates ~100-300 assistant response tokens per message. Accepted cost; documented as an open follow-on to explore tighter prompting.

### Teardown / clean stream close
The Python experiment hit a post-stream `ValidationException` after the audio ContentEnd + assistant response were fully received. The Node adapter MUST produce a clean session close without this error. Suspected cause: `sessionEnd` sent while assistant response is still emitting. Fix hypothesis: consume ALL response events (including the assistant's contentEnd) before sending sessionEnd, or ignore the post-completionEnd ValidationException as terminal. Adapter tests MUST verify successful teardown (no uncaught exception after transcript accumulation).

### voice.ts rewiring
- `transcodeForTranscribe` return shape simplifies: `{ buffer: Buffer, sampleRateHz: number }` — drop `mediaEncoding` (Nova Sonic only accepts LPCM).
- Route: WebM ext → `webmToPcm16k` → 16000 Hz. FLAC/OGG passthrough paths KEEP (edge cases; still transcode to PCM 16 kHz via new helpers if needed) OR delete (unused in production). **Locked: delete FLAC/OGG passthrough** — production is always WebM from MediaRecorder; edge cases have never fired.
- Call: `const transcript = await transcribeNovaSonic(transcodeResult.buffer);`
- Delete: `CHUNKED_THRESHOLD_BYTES` constant + the ternary branch on it (dispatched to chunked orchestrator for long clips — no longer applicable).
- Preserve: disk-bank fire-and-forget write, slash-command transform post-processing, AccessDenied → 503 classifier, all other error handling.

### Deletions
The following files are deleted completely (files + tests):
- `src/backend/voice/transcribe-orchestrator.ts` (288 lines) + `.test.ts` (356 lines)
- `src/backend/voice/audio-chunker.ts` (338 lines) + `.test.ts` (320 lines)
- `src/backend/voice/word-stitcher.ts` (228 lines) + `.test.ts` (511 lines)
- `src/backend/voice/semaphore.ts` (35 lines) + `.test.ts` (120 lines) — note: voice-scoped semaphore, NOT `src/backend/ssh/host-semaphore-registry.ts` which stays
- `src/backend/voice/transcribe-adapter.ts` (259 lines) + `.test.ts` (~330 lines)

Dependency verification (from RECON § 2): all above are ONLY imported by `transcribe-orchestrator.ts` (which is itself being deleted) or by `voice.ts` (which is being rewired). `chunk-and-stitch.ts` is used by `polly-adapter.ts` — **DO NOT DELETE**.

### package.json
- Remove: `"@aws-sdk/client-transcribe-streaming": "^3.1129.0"`
- Add: `"@aws-sdk/client-bedrock-runtime": "^3.784.0"` (or latest satisfying ≥ 3.784.0)
- Add: `"@smithy/node-http-handler": "^4.0.4"` (or latest)
- Run `npm install` to update `package-lock.json`.

### Testing surface
- **New:** `nova-sonic-adapter.test.ts` — mock the `BedrockRuntimeClient`, verify the exact event send sequence + response filtering + teardown cleanliness + module-singleton reuse. Mirrors `transcribe-adapter.test.ts`'s test topology.
- **New tests in `audio-transcode.test.ts`:** `webmToPcm16k` — output shape (sample rate, channel count, byte alignment via ffmpeg on a fixture WebM).
- **Rewritten in `voice.test.ts`:** transcribe-endpoint tests — replace `transcribeBuffer` + `transcribeBufferChunked` mocks with `transcribeNovaSonic` mock. Delete T1 (fast-path routing) / T2 (chunked routing) / T3 (chunked AccessDenied) / T4 (chunked generic-error) / any related Phase 100 assertions. Keep AccessDenied → 503 test, keep slash-transform test, keep disk-bank test.

### Ship discipline
Per fleet role rules:
- Scoped tests during dev: `npx vitest run --related <changed-files>` — executor-level green gate.
- Full suite ONLY at deploy time (per user 2026-09-07 refinement): `npx vitest run` (no scope) + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium`. Runs orchestrator-side, immediately before `docker build`.
- **Push gate:** hard stop after code + commit + scoped-tests-green. Wait for user's explicit greenlight before `git push`. Push authorizes the whole deploy motion (push → build → force-recreate → verify).

### Claude's Discretion
- Exact system prompt text (transcription-only nudge) — draft above; can iterate.
- Exact chunk size within reasonable bounds (60 ms works empirically; could be 40-120 ms with no behavioral change).
- Test fixture WebM/PCM buffers (can generate synthetically with ffmpeg or use a trimmed real recording).
- Adapter public API name: `transcribeNovaSonic(buffer): Promise<string>` proposed to mirror `transcribeBuffer` shape; alternative names accepted.
- Exact deletion order — can delete Phase 100 subsystem in one commit or across two commits (mechanical, verification via typecheck).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Recon + experimental evidence
- `~/fleet/roles/box-maintainer/bounties/stt-nova-sonic-migration/RECON.md` — full scoping doc, file-by-file change surface, effort estimate, risks
- `~/fleet/roles/box-maintainer/bounties/stt-nova-sonic-migration/RESULTS-2026-09-12.md` — empirical accuracy + pace-ceiling results from 2026-09-12 Nova Sonic experiment on sample-1.webm

### Amazon reference implementation (near-drop-in template)
- `https://github.com/aws-samples/amazon-nova-samples/tree/main/speech-to-speech/sample-codes/websocket-nodejs` — TypeScript, Express + socket.io, same tech stack as Skynet. Pins `@aws-sdk/client-bedrock-runtime ^3.785` + `@smithy/node-http-handler ^4.0.4`.

### Existing Skynet voice code (patterns to mirror or replace)
- `src/backend/voice/transcribe-adapter.ts` — pattern for module-singleton client, IMDS-only credentials, error handling, streaming loop. Replaced by nova-sonic-adapter.
- `src/backend/voice/polly-adapter.ts` — parallel example of AWS SDK client singleton + IMDS pattern. Not deleted.
- `src/backend/voice/audio-transcode.ts` — pattern for `runFfmpeg` subprocess wrapper. Adds `webmToPcm16k` alongside `webmToFlac`/`webmToOggOpus`.
- `src/backend/database/routes/voice.ts` — `handleTranscribe` endpoint. Rewired to call new adapter.
- `src/backend/voice/aws-errors.ts` — `isAwsAccessDenied` classifier. Reused unchanged for Nova Sonic AccessDenied surface.

### Fleet role rules (test discipline, ship gate, container mutations)
- `~/fleet/roles/box-maintainer/box-maintainer.md` § Test discipline, § Container mutations serialize, § Deploy-window boundary at git push

</canonical_refs>

<specifics>
## Specific Ideas

### Landmines to bake into the adapter
1. **`body` MUST be async iterable.** Auto-generated SDK docs are wrong; passing `{chunk:{bytes}}` directly throws `TypeError: this.options.inputStream is not async iterable at SmithyMessageEncoderStream.asyncIterator`. Use `async function*` (aws-sdk-js-v3 issue #7125).
2. **AudioOutputConfiguration required.** Empirically hit `ValidationException: AudioOutputConfiguration must be set` when only `textOutputConfiguration` was sent in `promptStart`. Include audioOutputConfiguration even though we discard the audio.
3. **Silent audio drop above 5x pace.** Empirically 10x pace lost ~44% of transcript, 20x pace lost 95%, unlimited pace lost 100%. 5x is the safe operating point.
4. **8-minute server-enforced session timeout.** Not a concern for single-message hold-to-record (max clip ~2 min).
5. **HTTP/2 handler shutdown quirks.** If Express hangs on shutdown, look at handler destruction (historical issues #4406, #3541). Not observed in Skynet's Express pattern to date, but worth logging.

### Reference Python event schema
- `~/fleet/roles/box-maintainer/bounties/stt-nova-sonic-migration/experiments/nova_sonic_transcribe.py` (moved to bounty archive) — the working Python harness. Event JSON payloads port 1:1 to Node.

</specifics>

<deferred>
## Deferred Ideas

- **Response-token minimization** — Nova Sonic still emits 100-300 ASSISTANT tokens per request even with the transcription-only system prompt. Possible future work: tighter prompting, alternative "silent mode" params if Amazon adds one, or absorb the small per-message cost.
- **Multi-language support** — LanguageCode locked to en-US via voice pipeline convention. Nova Sonic supports FR/IT/DE (Jul 2025 launch); adding is a separate future phase.
- **Per-message cost telemetry** — no instrumentation yet for real-world $/message tracking. Add if usage volume changes materially.
- **Bank additional voice samples for pre-deploy accuracy validation** — n=1 empirical evidence (sample-1.webm). Could bank 2-3 more before ship for statistical honesty. Not blocking the phase; can be added as post-code-complete UAT gate.

</deferred>

---

*Phase: 109-stt-provider-swap-amazon-transcribe-to-amazon-nova-sonic-on*
*Context gathered: 2026-09-13 via PRD Express Path from RECON.md*
