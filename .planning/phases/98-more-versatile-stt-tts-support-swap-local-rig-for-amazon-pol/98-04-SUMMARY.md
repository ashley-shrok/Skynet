---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 04
subsystem: voice
tags: [aws, polly, transcribe, ffmpeg, adapters, imds, tdd]

# Dependency graph
requires:
  - phase: 98-01
    provides: "@aws-sdk/client-polly + @aws-sdk/client-transcribe-streaming @ 3.1129.0 installed; ffmpeg in Dockerfile Stage 5"
  - phase: 98-02
    provides: "polly-voice-catalog + chunk-and-stitch + riff-header-builder pure kernels"
provides:
  - "isAwsAccessDenied(err) type guard for AccessDenied off-switch (shared, no SDK imports)"
  - "synthesizeToPcm(text, voiceId) → Promise<Readable> — Polly generative-engine PCM 16kHz mono adapter"
  - "transcribeBuffer(audio, mediaEncoding, sampleRateHz) → Promise<string> — Transcribe streaming adapter with IsPartial filter"
  - "webmToOggOpus(buf) → Promise<Buffer> — fast remux (-c:a copy) for MediaRecorder WebM → Ogg-Opus"
  - "webmToFlac(buf) → Promise<Buffer> — full-transcode fallback (-ar 16000 -ac 1 -f flac) for Chrome multi-channel edge case"
affects:
  - "98-06 (voice.ts route rewrite — handleTranscribe wires webmToOggOpus try / webmToFlac catch → transcribeBuffer; handleSpeak/handleSpeakStream wire packChunks → synthesizeToPcm → buildRiffHeader → res.pipe; catchall uses isAwsAccessDenied to route 503 vs 500)"

# Tech tracking
tech-stack:
  added: []  # AWS SDK + ffmpeg already installed in 98-01; no new deps
  patterns:
    - "AWS SDK v3 module-level singleton client (mirrors matrix-admin-client.ts convention)"
    - "IMDS-authenticated client via SDK default credential chain (region-only ctor, NO explicit credentials)"
    - "Duck-typed AWS error classifier (no SDK imports — reduces cross-module coupling)"
    - "Async-iterable audio push into Transcribe streaming (16 KB chunks, mirrors transcribe-flac.py reference)"
    - "IsPartial === false filter for streaming Transcribe results (Pitfall 3 defense)"
    - "child_process.spawn wrapper with stdin.end(buf) + stdout concat + close/error events (mirrors opkssh-auth.ts spawn shape)"
    - "vi.mock function-ctor pattern for AWS SDK v3 constructor spies (new-able mocks with observable calls)"
    - "TDD RED → GREEN gate sequence per task with distinct commit hashes"

key-files:
  created:
    - "src/backend/voice/aws-errors.ts (78 lines) — isAwsAccessDenied type guard"
    - "src/backend/voice/aws-errors.test.ts (94 lines, 10 assertions)"
    - "src/backend/voice/polly-adapter.ts (127 lines) — synthesizeToPcm + PollyClient singleton"
    - "src/backend/voice/polly-adapter.test.ts (124 lines, 7 assertions with mocked SDK)"
    - "src/backend/voice/polly-adapter.integration.test.ts (38 lines, 1 env-gated real-AWS test)"
    - "src/backend/voice/transcribe-adapter.ts (173 lines) — transcribeBuffer + TranscribeStreamingClient singleton"
    - "src/backend/voice/transcribe-adapter.test.ts (182 lines, 9 assertions with mocked SDK)"
    - "src/backend/voice/transcribe-adapter.integration.test.ts (57 lines, 1 env-gated real-AWS test)"
    - "src/backend/voice/audio-transcode.ts (159 lines) — webmToOggOpus + webmToFlac ffmpeg wrappers"
    - "src/backend/voice/audio-transcode.test.ts (170 lines, 8 assertions with mocked child_process)"
  modified: []

key-decisions:
  - "aws-errors.ts is DUCK-TYPED (no @aws-sdk imports) so both adapters + voice.ts can consume without redundant SDK coupling; AccessDeniedException name + \$metadata.httpStatusCode===403 are canonical AWS invariants — safe to key on"
  - "PollyClient + TranscribeStreamingClient constructors receive ONLY {region: 'us-east-1'} — NO credentials arg — so the SDK's default credential chain (which includes IMDS via @aws-sdk/credential-provider-node) resolves ambient EC2 identity; passing anything explicit would DISABLE the composite chain (Pitfall 2)"
  - "Both AWS clients are module-level singletons constructed once at load; per-request construction would add ~50-100ms latency and defeat SDK connection reuse"
  - "transcribe-adapter's audioChunkGenerator uses CHUNK_SIZE = 16 KB matching the transcribe-flac.py Python reference (chunk size not load-bearing on AWS side; matching reference keeps behavior parity easy to reason about)"
  - "IsPartial filter placed at the innermost loop before Alternatives read — mixed partial+final input yields ONLY the final segment (asserted by dedicated Pitfall 3 test)"
  - "audio-transcode uses a private runFfmpeg helper (not exported) so callers reach for semantically-named webmToOggOpus / webmToFlac wrappers instead of an untyped argv slot that could accept user-controlled args (threat T-98-04-04 mitigation)"
  - "Integration tests (real-AWS Polly + Transcribe) are opt-in via AWS_INTEGRATION_TESTS=1 so accidental CI runs never bill; both skip cleanly (test-file passes with 'skipped' status) without the env var"
  - "vi.mock uses function-ctor pattern (not arrow.mockImplementation) so `new PollyClient(...)` works in tests — arrow ctors reject `new` with TypeError"

patterns-established:
  - "AWS SDK v3 adapter shape: module docblock captures locked decisions + Pitfall 2 credential rule; module-level singleton client; single async exported function; SDK errors propagate unchanged (upstream owns classification via aws-errors.ts)"
  - "Real-AWS integration test naming: *.integration.test.ts + describe.skipIf(!process.env.AWS_INTEGRATION_TESTS) — new to repo, will spread as more AWS-touching modules land"

requirements-completed:
  - P98-STT-01
  - P98-STT-02
  - P98-TTS-01
  - P98-TTS-04
  - P98-OFF-01
  - Provider-choice
  - Provider-access
  - Backend-owned-orchestration

# Metrics
duration: ~10min
completed: 2026-09-10
---

# Phase 98 Plan 04: Polly + Transcribe adapters, audio-transcode, aws-errors Summary

**Four backend adapter modules — `aws-errors.ts` duck-typed AccessDenied guard, `polly-adapter.ts` PCM-16kHz generative TTS wrapper, `transcribe-adapter.ts` streaming STT with IsPartial filter, `audio-transcode.ts` ffmpeg webm→ogg-opus remux + FLAC fallback — plus 6 test files (4 mocked-SDK unit + 2 env-gated real-AWS integration) totaling 34 passing assertions with 2 clean skips.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-10T02:47:00Z (approximate)
- **Completed:** 2026-09-10T02:55:00Z (approximate)
- **Tasks:** 4 (all TDD RED → GREEN)
- **Files created:** 10 (4 source + 4 unit test + 2 integration test)
- **Files modified:** 0
- **Tests added:** 34 assertions passing + 2 env-gated real-AWS tests (skip cleanly without AWS_INTEGRATION_TESTS=1)

## Accomplishments

- Shipped the four AWS-side adapter modules that Plan 06 (voice.ts route rewrite) will call. The invariant client contract is now bridge-able to Polly + Transcribe streaming without touching frontend code.
- Locked the module-level singleton + IMDS-credentials pattern on both AWS clients — Pitfall 2 (no explicit `credentials` arg) enforced via mocked constructor assertions on both `polly-adapter.test.ts` and `transcribe-adapter.test.ts`.
- Enforced the Pitfall 3 IsPartial filter in `transcribe-adapter.ts` with a dedicated test that feeds mixed partial+final events and asserts only the final segment appears in the output (guards against hallucinated repeated transcripts).
- Delivered the `webmToOggOpus` (fast remux, `-c:a copy`) + `webmToFlac` (full transcode, `-ar 16000 -ac 1 -f flac`) fallback pair — Plan 06 will wire these as `try webmToOggOpus / catch → webmToFlac` per the plan's key_links contract.
- Kept `aws-errors.ts` duck-typed (no `@aws-sdk` imports) so voice.ts and both adapters consume it without redundant SDK coupling. Guard covers both `err.name === "AccessDeniedException"` AND `err.$metadata.httpStatusCode === 403` OR-combined for airtight AccessDenied detection.
- Followed strict TDD RED → GREEN gate sequence per task with distinct commit hashes for each phase.

## Task Commits

Each task was committed atomically with TDD RED + GREEN commits:

1. **Task 1 RED: aws-errors test** — `8fe78ae5` (test)
2. **Task 1 GREEN: aws-errors impl** — `b59f3d40` (feat)
3. **Task 2 RED: polly-adapter test + integration test** — `e6fa58ed` (test)
4. **Task 2 GREEN: polly-adapter impl (+ test-mock ctor pattern fix)** — `78cb6fd5` (feat)
5. **Task 3 RED: transcribe-adapter test + integration test** — `646e36fd` (test)
6. **Task 3 GREEN: transcribe-adapter impl** — `ecc98510` (feat)
7. **Task 4 RED: audio-transcode test** — `44e10e87` (test)
8. **Task 4 GREEN: audio-transcode impl** — `1dbd344f` (feat)

**Plan metadata:** pending (final docs commit after SUMMARY write)

_Note: All four tasks are TDD flows — each has a test commit followed by an implementation commit. No REFACTOR pass was needed on any task._

## Files Created/Modified

### Created (source)
- `src/backend/voice/aws-errors.ts` (78 lines) — Exports `isAwsAccessDenied(err: unknown): boolean`. Duck-typed guard (no `@aws-sdk` imports); matches on canonical AWS `AccessDeniedException` name OR `$metadata.httpStatusCode === 403`. Consumed by both adapters + voice.ts route handlers (Plan 06) to route AccessDenied to info-level 503 responses instead of error-level 500 spam.
- `src/backend/voice/polly-adapter.ts` (127 lines) — Exports `synthesizeToPcm(text: string, voiceId: string): Promise<Readable>`. Module-level `PollyClient` singleton (region us-east-1, NO credentials arg per Pitfall 2). Builds `SynthesizeSpeechCommand` with locked shape (Engine=generative, OutputFormat=pcm, SampleRate=16000). Returns the SDK's AudioStream Readable directly on success; throws `Polly returned no AudioStream` on missing field; SDK errors propagate unchanged.
- `src/backend/voice/transcribe-adapter.ts` (173 lines) — Exports `transcribeBuffer(audioBuffer: Buffer, mediaEncoding: "flac" | "ogg-opus" | "pcm" = "ogg-opus", sampleRateHz: number = 16000): Promise<string>`. Module-level `TranscribeStreamingClient` singleton (same IMDS/no-credentials rule). Internal `audioChunkGenerator` yields 16 KB `{AudioEvent: {AudioChunk}}` events. CRITICAL: filters `result.IsPartial === true` before accumulating (Pitfall 3). Joins finals with single space.
- `src/backend/voice/audio-transcode.ts` (159 lines) — Exports `webmToOggOpus(webmBuffer: Buffer): Promise<Buffer>` (fast remux: `-i pipe:0 -c:a copy -f ogg pipe:1`) and `webmToFlac(webmBuffer: Buffer): Promise<Buffer>` (full-transcode fallback: `-i pipe:0 -ar 16000 -ac 1 -f flac pipe:1`). Both wrap a private `runFfmpeg` helper that spawns ffmpeg with literal argv, pipes buffer to stdin via `.end(buf)`, collects stdout chunks, resolves on close(0), rejects on non-zero exit with stderr text OR on spawn error (ENOENT surfaces Pitfall 7 loudly). User data flows through stdin only — argv is literal-only (T-98-04-04 mitigation).

### Created (tests — mocked)
- `src/backend/voice/aws-errors.test.ts` (94 lines) — 10 assertions across positive matches (name AccessDeniedException, `$metadata.httpStatusCode === 403`, both) and negative matches (plain Error, null, undefined, number, {}, ThrottlingException, 500-status Error).
- `src/backend/voice/polly-adapter.test.ts` (124 lines) — 7 assertions via hoisted vi.fn() ctor spies. Function-ctor pattern in vi.mock enables `new PollyClient(...)` in the adapter. Asserts singleton (constructed exactly once at module load), region-only ctor without credentials, SynthesizeSpeechCommand shape (generative/pcm/16000/VoiceId), Readable passthrough on success, error on undefined AudioStream, SDK errors propagate unchanged.
- `src/backend/voice/transcribe-adapter.test.ts` (182 lines) — 9 assertions. Same hoisted-ctor pattern as polly. Includes a `fakeTranscriptStream` async-iterable helper that mimics the SDK response event shape. Three dedicated Pitfall 3 tests: mixed partial+final input → only final in output, partials-only input → empty string, multiple finals joined with single space.
- `src/backend/voice/audio-transcode.test.ts` (170 lines) — 8 assertions via a `FakeChildProcess` EventEmitter class (stdin.end spy, stdout/stderr emitters, top-level close/error events). Success path drives close(0) + data; failure paths drive close(1)/close(2) with stderr; spawn-error path emits 'error' event. Asserts exact argv for both webmToOggOpus and webmToFlac.

### Created (tests — real-AWS integration, env-gated)
- `src/backend/voice/polly-adapter.integration.test.ts` (38 lines) — `describe.skipIf(!process.env.AWS_INTEGRATION_TESTS === "1")` gates a single real-Polly synth test on "Hello.". Cost ~$0.0002 per run.
- `src/backend/voice/transcribe-adapter.integration.test.ts` (57 lines) — Same env gate. Uses the shortest bounty FLAC clip (`clip-01-short-77KB.flac`, 16 kHz mono) to verify a real transcript comes back non-empty. Cost ~$0.001 per run. Also `skipIf` on missing clip file (safe on fresh checkouts without the bounty samples).

## Decisions Made

- **`aws-errors.ts` deliberately has zero `@aws-sdk` imports.** Alternative was `import { AccessDeniedException } from "@aws-sdk/client-polly"` — rejected because that would pull the SDK into voice.ts route handler test contexts where the SDK is stubbed. Duck-typing on `err.name` + `err.$metadata.httpStatusCode` is safe because both are stable AWS API conventions, not SDK-internal representation.
- **Region hardcoded (`us-east-1`) in every adapter.** Alternative was `process.env.AWS_REGION`. Rejected per CONTEXT.md § Claude's-discretion decision — generative Polly isn't in all regions, hardcoding removes an operator failure mode. One-line change if a future region swap becomes needed.
- **Module-level singleton clients over per-request construction.** Per-request would add 50-100ms latency and defeat SDK connection reuse. Consequence: adapters cannot be re-configured after module load (region, credentials, etc.) — acceptable since region is hardcoded and credentials come from ambient IMDS.
- **vi.mock function-ctor pattern (not arrow).** Initial attempt used `vi.fn().mockImplementation(() => ({...}))` which rejected `new` with `TypeError: is not a constructor`. Fix: `function PollyClient(this, cfg) { ctorSpy(cfg); this.send = sendMock; }` — works as constructor AND observable via spy call log. Applied uniformly to polly-adapter, transcribe-adapter tests.
- **Private `runFfmpeg` helper in `audio-transcode.ts`.** Alternative was exporting a generic `runFfmpeg(buf, args)`. Rejected on threat-model grounds — an exported argv slot creates a code-review surface where a future caller could interpolate user-controlled args into `args` (T-98-04-04 command injection). Two semantically-named wrappers with literal argv is the safer shape.
- **`webmToFlac` fallback is REAL, not dead code.** Verified in 98-04-PLAN.md § key_links — Plan 06's `handleTranscribe` will `try webmToOggOpus / catch → webmToFlac`, switching `MediaEncoding` from `"ogg-opus"` to `"flac"` when the fallback fires. Documented explicitly in the module docblock so future maintainers don't remove it as "unused."

## Deviations from Plan

None — plan executed exactly as written.

Two minor procedural notes (NOT code deviations, NOT tracked under Rules 1-4):

1. **Test-mock ctor pattern fix (Task 2).** The initial polly-adapter.test.ts used `vi.fn().mockImplementation(() => ({ send: sendMock }))` for the PollyClient mock, which the vitest runtime rejected with `TypeError: is not a constructor` when the adapter did `new PollyClient(...)`. Fixed in the same commit as the GREEN implementation by switching to a `function PollyClient(this, cfg) {...}` pattern that supports `new`. This was a test-only correction to enable the plan's specified test contract — not a plan deviation. The corrected pattern was then applied prophylactically to transcribe-adapter.test.ts before its RED commit (no rework needed).

2. **`--reporter=basic` omitted from verify commands.** The plan's `<verify>` blocks specified `npx vitest run … --reporter=basic`, but vitest 4.1.8 does not accept that reporter (would need `default` or omission). Same tooling delta noted in Plan 02's SUMMARY — verification ran without the flag; tests themselves executed as specified.

## Issues Encountered

None substantive. One instructive moment on Task 2 (see Deviations note 1 above): the natural vi.fn ctor pattern doesn't support `new`, requiring the function-ctor workaround. Documented for future adapter tests in this phase.

## User Setup Required

None — no external service configuration required at this plan boundary. AWS credentials come from IMDS (already configured on t1000 via `termix-ssm-role/PollyTranscribeExploratory`). The `AWS_INTEGRATION_TESTS=1` env var is the ONLY thing that changes real-AWS test behavior, and it's opt-in for developers who want to bill Polly + Transcribe for validation.

## Next Phase Readiness

**Plan 06 (voice.ts route rewrite) unblocked** — all four adapters are ready to consume:

- **`handleTranscribe` wire-up:**
  ```
  raw multipart bytes → disk-bank write (unchanged) →
    try:  audioBuffer = await webmToOggOpus(raw); enc = "ogg-opus"
    catch: audioBuffer = await webmToFlac(raw);   enc = "flac"
  → transcript = await transcribeBuffer(audioBuffer, enc, 16000) →
  → applyServerSlashTransform(transcript) (unchanged) →
  → res.json({ text: transformed })
  Catchall: if (isAwsAccessDenied(err)) return res.status(503).json({...})
  ```

- **`handleSpeakStream` wire-up:**
  ```
  { text, voice } → isValidPollyVoice(voice) (from Plan 02) →
  → chunks = packChunks(splitIntoSentences(text)) (from Plan 02) →
  → for each chunk (with prefetch of chunk+1):
      readable = await synthesizeToPcm(chunk, voice)
      if first chunk: res.write(buildRiffHeader({channels:1, sampleRate:16000, bitDepth:16}))
      readable.pipe(res, { end: false })
    → res.end() on last chunk
  Catchall: if (isAwsAccessDenied(err)) return res.status(503).json({...})
  ```

- **`handleSpeak` (non-stream)** — same shape as first-chunk of stream: `synthesizeToPcm(text, voice)` → prepend `buildRiffHeader` → `readable.pipe(res)`.

- **`handleListVoices`** — either drop the route (frontend already inlines POLLY_VOICES per Plan 03) OR return `POLLY_VOICES` from polly-voice-catalog.ts directly. Plan 06 decides.

No blockers. No open questions. All four adapters expose stable in-process functions; upstream handlers stay thin.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/voice/aws-errors.ts`
- FOUND: `src/backend/voice/aws-errors.test.ts`
- FOUND: `src/backend/voice/polly-adapter.ts`
- FOUND: `src/backend/voice/polly-adapter.test.ts`
- FOUND: `src/backend/voice/polly-adapter.integration.test.ts`
- FOUND: `src/backend/voice/transcribe-adapter.ts`
- FOUND: `src/backend/voice/transcribe-adapter.test.ts`
- FOUND: `src/backend/voice/transcribe-adapter.integration.test.ts`
- FOUND: `src/backend/voice/audio-transcode.ts`
- FOUND: `src/backend/voice/audio-transcode.test.ts`

**Commits verified present in git log:**
- FOUND: `8fe78ae5` (test 98-04 aws-errors)
- FOUND: `b59f3d40` (feat 98-04 aws-errors)
- FOUND: `e6fa58ed` (test 98-04 polly-adapter)
- FOUND: `78cb6fd5` (feat 98-04 polly-adapter)
- FOUND: `646e36fd` (test 98-04 transcribe-adapter)
- FOUND: `ecc98510` (feat 98-04 transcribe-adapter)
- FOUND: `44e10e87` (test 98-04 audio-transcode)
- FOUND: `1dbd344f` (feat 98-04 audio-transcode)

**Test suite verified:** `npx vitest run src/backend/voice/aws-errors.test.ts src/backend/voice/polly-adapter.test.ts src/backend/voice/transcribe-adapter.test.ts src/backend/voice/audio-transcode.test.ts src/backend/voice/polly-adapter.integration.test.ts src/backend/voice/transcribe-adapter.integration.test.ts` → 4 test files passed + 2 skipped; 34 assertions passed + 2 skipped (integration tests skip cleanly without AWS_INTEGRATION_TESTS=1).

**TypeScript compile verified:** `npx tsc --noEmit -p tsconfig.node.json` → exit 0, no errors in new files.

**Acceptance-criteria greps:**
- `grep -c 'new PollyClient(' src/backend/voice/polly-adapter.ts` → 1 (singleton confirmed)
- `grep 'Engine.*generative' src/backend/voice/polly-adapter.ts` → matches (Engine locked)
- `grep 'OutputFormat.*pcm' src/backend/voice/polly-adapter.ts` → matches (PCM output locked)
- `grep -c 'new TranscribeStreamingClient(' src/backend/voice/transcribe-adapter.ts` → 1 (singleton confirmed)
- `grep 'IsPartial' src/backend/voice/transcribe-adapter.ts` → matches (partial filter present)
- `grep 'LanguageCode.*en-US' src/backend/voice/transcribe-adapter.ts` → matches (English-US locked)
- `grep -c 'spawn.*ffmpeg' src/backend/voice/audio-transcode.ts` → 3 (exceeds >=2 requirement)

## TDD Gate Compliance

All four tasks followed the RED → GREEN gate sequence with distinct commits:

| Task | RED (test) commit | GREEN (feat) commit | Assertions |
|------|-------------------|---------------------|------------|
| aws-errors | `8fe78ae5` | `b59f3d40` | 10 |
| polly-adapter | `e6fa58ed` | `78cb6fd5` | 7 (+ 1 integration) |
| transcribe-adapter | `646e36fd` | `ecc98510` | 9 (+ 1 integration) |
| audio-transcode | `44e10e87` | `1dbd344f` | 8 |

Each RED commit was verified to fail before the GREEN commit was made (module-not-found errors — tests could not resolve the source module because it did not yet exist). Each GREEN commit passed all assertions on first run (with the one-time test-mock ctor pattern fix on polly-adapter noted in Deviations above). No REFACTOR pass was needed for any task.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
