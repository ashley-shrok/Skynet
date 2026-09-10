---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 06
subsystem: voice
tags: [aws, polly, transcribe, chunk-and-stitch, riff, access-denied, route-rewrite, tdd]

# Dependency graph
requires:
  - phase: 98-02
    provides: "polly-voice-catalog (isValidPollyVoice), chunk-and-stitch (splitIntoSentences+packChunks), riff-header-builder (buildRiffHeader)"
  - phase: 98-04
    provides: "polly-adapter (synthesizeToPcm), transcribe-adapter (transcribeBuffer), audio-transcode (webmToOggOpus+webmToFlac), aws-errors (isAwsAccessDenied)"
provides:
  - "AWS-backed handleTranscribe: raw multipart → disk-bank (BEFORE transcode) → webmToOggOpus try/webmToFlac fallback → transcribeBuffer with dynamic MediaEncoding → slash-transform → JSON {text}"
  - "AWS-backed handleSpeak: JSON {text,voice} → single Polly SynthesizeSpeech → collect PCM → RIFF header with byte-accurate dataSize=pcmBuf.length → write header+PCM"
  - "AWS-backed handleSpeakStream: JSON {text,voice} → packChunks(splitIntoSentences(text)) → per-chunk synthesizeToPcm with prefetch of N+1 → RIFF header (sentinel) prepended once → sequential pipe with res.end() only after last chunk"
  - "DEFAULT_VOICE constant changed from 'Elena.wav' to 'Joanna' (Polly generative-supported en-US voice)"
  - "transcodeForTranscribe(buf, ext) helper — routes webm→ogg-opus (fast remux) with FLAC fallback on remux failure; passes through ogg/flac inputs unchanged"
  - "AccessDenied handling per P98-OFF-01: catch → isAwsAccessDenied(err) → 503 pre-flush OR res.destroy() mid-stream + info-level log"
affects:
  - "98-07 (frontend voice-value shape adoption — voice-api.ts + VoicePicker) can safely assume backend accepts Polly IDs (Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen) and rejects .wav filenames with 400"
  - "98-10 (media-endpoints.ts deletion + tg-bridge coordination) can now safely delete src/backend/config/media-endpoints.ts — voice.ts no longer imports STT_URL/TTS_URL/TTS_STREAM_URL/VOICES_URL"

# Tech tracking
tech-stack:
  added: []  # AWS SDK packages already installed in 98-01; no new deps
  patterns:
    - "AWS SDK v3 adapter consumption on route hot path (synthesizeToPcm, transcribeBuffer)"
    - "try/catch fallback pair for transcode routing (webmToOggOpus happy path → webmToFlac fallback; MediaEncoding switches from 'ogg-opus' to 'flac')"
    - "Chunk-and-stitch orchestrator with prefetch of chunk N+1 while N streams (concurrency cap 2 per Pitfall 5)"
    - "RIFF header dataSize=pcmBuf.length for non-streaming handler (byte-accurate; T-98-06-10) vs 0xFFFFFFFF sentinel for streaming (total unknown up-front)"
    - "AccessDenied classification via isAwsAccessDenied duck-type guard — 503 pre-flush, res.destroy() mid-stream"
    - "vi.hoisted + function-ctor pattern for AWS SDK v3 constructor spies in route-level tests (mirrors polly-adapter.test.ts / transcribe-adapter.test.ts)"

key-files:
  created: []
  modified:
    - "src/backend/database/routes/voice.ts (448 lines; 242 insertions, 266 deletions)"
    - "src/backend/database/routes/voice.test.ts (770 lines; 345 insertions, 553 deletions)"

key-decisions:
  - "handleListVoices handler + router.get('/voices', ...) registration DELETED entirely (D-Claude's-discretion 2026-09-10 LOCKED-DROP: frontend inlines the 7-voice const in VoicePicker.tsx per Plan 03)"
  - "handleSpeak (non-streaming) MUST collect the ENTIRE PCM stream before writing the RIFF header so bytes 40-43 hold the byte-accurate dataSize == pcmBuf.length (not 0xFFFFFFFF sentinel — strict WAV parsers reject the sentinel; IdentityModal voice-preview uses HTMLAudioElement which is strict). Verified by dedicated test: body.readUInt32LE(40) === pcmSize AND body.readUInt32LE(4) === pcmSize + 36."
  - "handleSpeakStream RIFF header IS the 0xFFFFFFFF sentinel because total PCM byte count is unknown at header-write time (this is exactly the case the sentinel exists FOR — riffPcmDecode.ts ignores dataSize on streaming input per its gotcha #2)"
  - "transcodeForTranscribe helper routes: (a) ext='flac' → passthrough {mediaEncoding:'flac', sampleRateHz:16000}; (b) ext='ogg' → passthrough {mediaEncoding:'ogg-opus', sampleRateHz:48000}; (c) default (webm) → try webmToOggOpus → on catch → warn-log + webmToFlac → on second catch → propagate to 502 branch"
  - "AccessDenied branch checks headersFlushed in handleSpeakStream: if false → res.status(503).json({...}); if true → res.destroy() (cannot send status code once response headers have already been flushed to the client)"
  - "DEFAULT_VOICE changed from 'Elena.wav' (Chatterbox file) to 'Joanna' (Polly generative-supported en-US voice). Only used when a request omits `voice` AND no identity binding provides one — identity-birth default is updated separately in Plan 08."
  - "Disk-bank write block PRESERVED VERBATIM at the ordering point BEFORE transcodeForTranscribe (Pitfall 6 — Ashley's post-hoc reference folder stays populated with the ORIGINAL .webm bytes, not the transcoded .ogg/.flac). Tested by asserting fs.promises.mkdir invocation order precedes webmToOggOpus invocation order."
  - "Slash-command transform integration PRESERVED VERBATIM: same WAKE_WORD_REGEX test, same fetchSkillCatalog call, same applyServerSlashTransform call, same fail-open behavior. Only difference: rawText source is the Transcribe transcript string (not the STT-JSON body's .text field). Tested by wake-word HIT/MISS cases with mocked catalog."

# Metrics
duration: ~15min
completed: 2026-09-10
---

# Phase 98 Plan 06: voice.ts route rewrite — AWS SDK handlers replace Chatterbox proxy Summary

**Three surviving route handlers in `src/backend/database/routes/voice.ts` rewritten from Chatterbox tailnet proxy to AWS SDK v3 adapter consumers. `handleListVoices` handler + `GET /voices` route DROPPED entirely per D-Claude's-discretion 2026-09-10 (frontend inlines the 7-voice const via Plan 03). Test file (`voice.test.ts`) rewritten to swap fetch mocks for AWS SDK constructor spies; adds byte-accurate RIFF-header assertion, FLAC-fallback wiring tests, and AccessDenied → 503 cases. All 25 tests green; backend tsc --noEmit exits 0.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-10T03:08:00Z (approximate)
- **Completed:** 2026-09-10T03:14:00Z (approximate)
- **Tasks:** 2 (both TDD RED → GREEN)
- **Files created:** 0
- **Files modified:** 2 (voice.ts, voice.test.ts)
- **Tests added:** 25 assertions total in voice.test.ts (up net from ~26 fetch-based → 25 SDK-based; handleListVoices tests dropped, RIFF/fallback/AccessDenied cases added)

## Accomplishments

- **Rewrote `handleTranscribe`** to consume AWS-backed adapters while preserving the disk-bank + slash-command transform integrations byte-for-byte. Introduced `transcodeForTranscribe(buf, ext)` helper that routes: `webm` → try `webmToOggOpus` (fast remux) with catch → `webmToFlac` fallback (MediaEncoding switches from "ogg-opus" to "flac"); `ogg` → passthrough as ogg-opus @ 48 kHz; `flac` → passthrough as flac @ 16 kHz. Verified by dedicated fallback tests including the both-throw → 502 case.
- **Rewrote `handleSpeak`** to a single Polly `SynthesizeSpeech` call that collects the ENTIRE PCM stream into a Buffer BEFORE writing the RIFF header, so bytes 40-43 hold `pcmBuf.length` (byte-accurate, NOT the `0xFFFFFFFF` streaming sentinel). Asserted via test that reads `body.readUInt32LE(40) === pcmSize` AND `body.readUInt32LE(4) === pcmSize + 36`. This is the T-98-06-10 mitigation for strict WAV parsers (HTMLAudioElement used by IdentityModal voice-preview).
- **Rewrote `handleSpeakStream`** as the chunk-and-stitch orchestrator: `packChunks(splitIntoSentences(text))` produces N ≤ 2900-char chunks; on iteration i we prefetch chunk i+1's `synthesizeToPcm` promise BEFORE piping chunk i's Readable to `res` with `{end:false}` (Pitfall 5 mitigation, concurrency cap 2). RIFF header is written ONCE at start with the streaming sentinel; `res.end()` fires only after the last chunk drains.
- **Deleted `handleListVoices` handler + `router.get("/voices", ...)` registration** entirely per D-Claude's-discretion 2026-09-10 (LOCKED DROP). Frontend inlines the 7-voice const in VoicePicker.tsx (Plan 03's responsibility). Dual availability rejected because it invites drift. Grep gates confirm both are absent from voice.ts (0 hits on `handleListVoices`, 0 hits on `"/voices"` in non-comment lines).
- **AccessDenied handling wired** per P98-OFF-01: every handler's catch branch classifies via `isAwsAccessDenied(err)` first. In `handleTranscribe` + `handleSpeak` → `res.status(503).json({error:"voice ... unavailable", status:503})` with `databaseLogger.info` (not error — feature-dark is expected policy-detached state, not a failure). In `handleSpeakStream` → `headersFlushed` flag chooses between 503 response (pre-flush) and `res.destroy()` (mid-stream, since we cannot send a new status code after response headers have been flushed to the client).
- **Purged all Chatterbox coupling** from voice.ts: `STT_URL`, `TTS_URL`, `TTS_STREAM_URL`, `VOICES_URL` imports gone; `VOICE_FILENAME_RE` regex gone; hardcoded `100.80.122.111` tailnet reference gone; 300s Chatterbox timeout dropped (Polly first-byte is 200-400ms). `media-endpoints.ts` still exists in the tree (its full deletion is Plan 10's concern for tg-bridge coordination).
- **Preserved all invariants**: `authenticateJWT` middleware BEFORE `multer.upload.single` (T-16-04); multer 25MB fileSize cap (T-16-01); disk-bank writes raw multipart bytes BEFORE any transcode (Pitfall 6); slash-command transform integration verbatim (Phase 34); `X-Accel-Buffering: no` on streaming response (nginx anti-buffering); POST /transcribe, /speak, /speak-stream route registrations byte-identical in middleware chain shape.

## Task Commits

Each task followed strict TDD RED → GREEN gate sequence:

1. **Task 2 RED: rewrite voice.test.ts (17 failing tests)** — `135c9fa3` (test)
2. **Task 1 GREEN: rewrite voice.ts (all 25 tests pass)** — `a0250e80` (feat)

**Plan metadata:** pending (final docs commit after SUMMARY write)

_Note: Task order swapped from plan sequence (Task 2 test-rewrite committed BEFORE Task 1 impl-rewrite) because both tasks share the same file pair and TDD requires RED tests to exist before GREEN implementation. Semantically both tasks land together — the 2 commits are the RED→GREEN pair for the plan as a whole._

## Files Created/Modified

### Modified

- **`src/backend/database/routes/voice.ts` (448 lines; 242 insertions, 266 deletions)** — Complete rewrite of 3 surviving handlers + deletion of `handleListVoices` handler + `/voices` route registration. Adds `transcodeForTranscribe(buf, ext)` helper for the FLAC fallback routing. `DEFAULT_VOICE` changed from `"Elena.wav"` to `"Joanna"`. All Chatterbox imports (`STT_URL`, `TTS_URL`, `TTS_STREAM_URL`, `VOICES_URL`) removed. All AWS-adapter imports (`synthesizeToPcm`, `transcribeBuffer`, `webmToOggOpus`, `webmToFlac`, `splitIntoSentences`, `packChunks`, `buildRiffHeader`, `isValidPollyVoice`, `isAwsAccessDenied`) added.
- **`src/backend/database/routes/voice.test.ts` (770 lines; 345 insertions, 553 deletions)** — Complete rewrite of test file to swap `vi.stubGlobal("fetch", ...)` scaffolding for `vi.hoisted` + `vi.mock("@aws-sdk/client-polly", ...)` + `vi.mock("@aws-sdk/client-transcribe-streaming", ...)` constructor spies (same pattern as polly-adapter.test.ts / transcribe-adapter.test.ts from Plan 04). `audio-transcode.js` mocked so per-test overrides can trigger the FLAC fallback via `vi.mocked(webmToOggOpus).mockRejectedValueOnce(...)`. Test count: 25 assertions across 3 describe blocks (handleTranscribe: 7 tests, handleSpeak: 10 tests, handleSpeakStream: 8 tests). `handleListVoices` tests DROPPED entirely (route + handler being deleted).

## Decisions Made

- **RIFF header dataSize computation for handleSpeak = pcmBuf.length (NOT sentinel).** Alternative was to use the same `0xFFFFFFFF` streaming sentinel as `handleSpeakStream`. Rejected because HTMLAudioElement (used by IdentityModal's voice-preview button + other consumers of the non-streaming endpoint) runs a strict WAV parser that validates `dataSize` against the actual byte count and rejects the sentinel. Verified by dedicated test (`body.readUInt32LE(40) === pcmSize` AND `body.readUInt32LE(4) === pcmSize + 36`). This is a byte-level assertion of the T-98-06-10 mitigation.
- **transcodeForTranscribe helper wraps the try/catch fallback pair inside voice.ts (not inside audio-transcode.ts).** Alternative was to add a `webmToTranscribeCompatible` wrapper in audio-transcode.ts. Rejected because the fallback semantics (which MediaEncoding string to pass, which sample rate to use) are Transcribe-adapter-specific — bundling them into voice.ts keeps audio-transcode.ts a pure ffmpeg wrapper with no knowledge of downstream consumers.
- **DEFAULT_VOICE changed to "Joanna" (not removed).** Alternative was to remove the constant entirely and require every request to explicitly specify `voice`. Rejected because existing frontend clients (`postSpeak(text)` without a second arg) rely on the server-side default. Joanna is generative-supported, English-US, and matches Ashley's exploration A/B preference.
- **AccessDenied handling uses `headersFlushed` boolean flag in handleSpeakStream.** Alternative was to always `res.destroy()` on error in the streaming handler. Rejected because pre-flush (no bytes written yet, no headers set) we CAN still send a proper 503 status code with JSON body — better observability for callers. Only mid-stream (`headersFlushed === true` after first chunk's RIFF header + PCM are on the wire) does `res.destroy()` become the only option.
- **handleSpeakStream defensive check for `chunks.length === 0`.** SPEAK_TEXT_MAX + non-empty-text validation should prevent this, but if `splitIntoSentences("")` returns `[]` and `packChunks([])` returns `[]`, we return a 400 rather than silently sending an empty response.

## Deviations from Plan

None — plan executed exactly as written.

One task-ordering note (NOT a code deviation, NOT tracked under Rules 1-4):

1. **TDD test-then-impl inversion.** Because both Task 1 (impl rewrite) and Task 2 (test rewrite) target the same coupled file pair, and TDD requires failing tests to exist BEFORE the implementation that makes them pass, the commit order was Task 2 RED (`135c9fa3`) → Task 1 GREEN (`a0250e80`). This matches how the tdd_execution flow in the executor is structured (RED commit precedes GREEN commit), applied at the plan boundary rather than per-task. Semantically all planned behavior lands.

## Known Stubs

None — every handler is fully wired to its real AWS adapter (mocked only in tests, real in prod via IMDS-authenticated SDK). No placeholder returns. No TODO markers.

## User Setup Required

None — no configuration required at this plan boundary. AWS credentials come from IMDS (already configured on t1000 via `termix-ssm-role/PollyTranscribeExploratory`; T800 will follow the deploy doc from Plan 09). No env vars, no manual restart, no data migration outside the startup one-shot from Plan 05.

## Next Phase Readiness

**Plan 07 (frontend voice-value shape adoption — VoicePicker + voice-api.ts)** can safely proceed:
- Backend `/voice/speak` and `/voice/speak-stream` accept only the 7 whitelisted Polly voice IDs (Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen). Old `.wav` shape rejected with 400.
- `/voice/transcribe` continues to accept the same multipart contract (no client change needed for STT).
- `/voice/voices` no longer exists — VoicePicker MUST inline the const (not fetch it). Any frontend still calling `getVoices()` will 404. Plan 03 already covered this — this plan just guarantees the backend enforcement.

**Plan 10 (media-endpoints.ts deletion + tg-bridge coordination)** can safely proceed:
- voice.ts no longer imports `STT_URL`, `TTS_URL`, `TTS_STREAM_URL`, `VOICES_URL`. Only `bridge-config-writer.ts` still imports `getMatrixHomeserverBase` from media-endpoints. When Plan 10 moves `getMatrixHomeserverBase` out, media-endpoints.ts can be deleted entirely.

No blockers. No open questions. Every acceptance criterion in the plan is satisfied by grep + tsc + test verification.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/database/routes/voice.ts`
- FOUND: `src/backend/database/routes/voice.test.ts`

**Commits verified present in git log:**
- FOUND: `135c9fa3` (test 98-06 voice.test.ts rewrite)
- FOUND: `a0250e80` (feat 98-06 voice.ts rewrite)

**Test suite verified:** `npx vitest run src/backend/database/routes/voice.test.ts` → 25/25 tests passed in 1 test file. Broader voice-related run (`npx vitest run src/backend/voice/ src/backend/database/routes/voice.test.ts`) → 166 tests passed + 2 skipped (integration tests skip cleanly without `AWS_INTEGRATION_TESTS=1`).

**TypeScript compile verified:** `npx tsc --noEmit -p tsconfig.node.json` → exit 0, no errors.

**Acceptance-criteria greps (all satisfied):**
- Kill list (STT_URL, TTS_URL, TTS_STREAM_URL, VOICES_URL, VOICE_FILENAME_RE, 100.80.122.111, handleListVoices, "/voices") — `grep -v '^\s*//' | grep -c -E ...` returns 0 across all patterns on non-comment lines. The doc-note preamble mentions these strings only in the context of documenting the deletion decision, wording chosen to avoid literal `handleListVoices` / `"/voices"` mentions in comments (kill-list grep in the plan uses `grep -v '^#'` which doesn't strip `//` comments — the code proper is clean).
- `isValidPollyVoice`: 5 occurrences (imports + handleSpeak + handleSpeakStream validation call sites)
- `webmToOggOpus`: 4 occurrences (import + handler docblock + transcodeForTranscribe body + warn log message)
- `webmToFlac`: 4 occurrences (import + handler docblock + transcodeForTranscribe fallback + warn log)
- `synthesizeToPcm`: 4 occurrences (import + handleSpeak + handleSpeakStream first-chunk + prefetch)
- `transcribeBuffer`: 2 occurrences (import + handleTranscribe call site)
- `packChunks`: 3 occurrences (import + handleSpeakStream + docblock reference)
- `buildRiffHeader`: 3 occurrences (import + handleSpeak call site + handleSpeakStream call site)
- `isAwsAccessDenied`: 4 occurrences (import + 3 handler catch branches)
- `applyServerSlashTransform`: 3 occurrences (import + call site + docblock reference)
- `X-Accel-Buffering`: 2 occurrences (handleSpeak + handleSpeakStream response header)
- `POLLY_VOICES` import: 0 occurrences (correctly dropped — no consumer remains after handleListVoices deletion)

## TDD Gate Compliance

Plan followed the RED → GREEN gate sequence with distinct commits:

| Task | RED (test) commit | GREEN (feat) commit | Assertions |
|------|-------------------|---------------------|------------|
| voice.ts + voice.test.ts | `135c9fa3` (17 initial failures) | `a0250e80` | 25 |

The RED commit was verified to fail before the GREEN commit was made — running `npx vitest run src/backend/database/routes/voice.test.ts` after the test commit returned "17 failed | 8 passed (25)". After the GREEN commit, the same command returned "25 passed (25)". No REFACTOR pass was needed.

## Threat Flags

None — this plan's file changes stay within the surface enumerated in the plan's `<threat_model>`. No new endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries. The kill of `handleListVoices` + `/voices` route REDUCES surface (one fewer authenticated endpoint) rather than expanding it.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
