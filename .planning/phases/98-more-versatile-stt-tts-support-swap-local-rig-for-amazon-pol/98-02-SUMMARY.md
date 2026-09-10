---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 02
subsystem: voice
tags: [polly, riff, pcm, tdd, pure-kernel, chunk-and-stitch]

# Dependency graph
requires:
  - phase: 98-01
    provides: "@aws-sdk/client-polly + @aws-sdk/client-transcribe-streaming installed; ffmpeg in Dockerfile Stage 5"
provides:
  - "POLLY_VOICES readonly const + POLLY_VOICE_IDS Set + isValidPollyVoice type guard (7 en-US generative voices)"
  - "splitIntoSentences + packChunks + CHUNK_MAX_CHARS (2900) for Polly per-call ceiling"
  - "buildRiffHeader (44-byte RIFF+PCM header) matching riffPcmDecode.ts consumer layout"
affects:
  - "98-03 (frontend VoicePicker inline catalog will mirror POLLY_VOICES shape)"
  - "98-04 (polly-adapter + transcribe-adapter — polly-adapter pairs with buildRiffHeader at first PCM chunk)"
  - "98-06 (voice.ts route rewrite — handleSpeakStream orchestrator wires packChunks → polly-adapter → buildRiffHeader → res.pipe)"
  - "98-XX identities.ts validator update — swaps IDENTITY_VOICE_RE for isValidPollyVoice"
  - "98-XX voice-migration.ts — uses POLLY_VOICE_IDS for idempotency guard"

# Tech tracking
tech-stack:
  added: []  # No new dependencies — all three kernels are pure (zero imports)
  patterns:
    - "readonly Foo[] static-const module (mirrors distributor/catalog.ts:98 FLEET_SUBSTRATE_CATALOG)"
    - "TDD RED → GREEN gate sequence per pure kernel (mirrors slashCommandTransform.ts + .test.ts pair)"
    - "truth-table test style: one it() per behavior contract row for grep-ability"
    - "Set-based exact-match validator over regex for whitelist-of-known-values inputs"

key-files:
  created:
    - "src/backend/voice/polly-voice-catalog.ts (95 lines) — POLLY_VOICES, POLLY_VOICE_IDS, isValidPollyVoice"
    - "src/backend/voice/polly-voice-catalog.test.ts (166 lines, 27 assertions)"
    - "src/backend/voice/chunk-and-stitch.ts (172 lines) — splitIntoSentences, packChunks, CHUNK_MAX_CHARS"
    - "src/backend/voice/chunk-and-stitch.test.ts (178 lines, 17 assertions)"
    - "src/backend/voice/riff-header-builder.ts (84 lines) — buildRiffHeader"
    - "src/backend/voice/riff-header-builder.test.ts (132 lines, 16 assertions)"
  modified: []

key-decisions:
  - "CHUNK_MAX_CHARS locked at 2900 (100-char safety margin under Polly 3000-billed ceiling) — do not tune upward"
  - "Abbreviation guard is hand-curated 17-entry Set (Mr, Mrs, Ms, Dr, Sr, Jr, Prof, St, Mt, vs, etc, e.g, i.e, a.m, p.m, U.S, U.K) — NOT an NLP tokenizer per RESEARCH § Anti-Patterns"
  - "isValidPollyVoice is exact-match, case-sensitive (Polly voice IDs are proper nouns per RESEARCH § V5)"
  - "Header dataSize default 0xFFFFFFFF (streaming sentinel); ChunkSize written unsigned (>>>0) so overflow is safe"
  - "Frontend will own its own copy of the 7-voice catalog — two-source-of-truth acceptable for 7 static strings (per D-Voice-catalog Claude's-discretion)"

patterns-established:
  - "Pure kernel with zero imports — validated via grep + tsc, safe for hot-path per-request calls"
  - "TDD flow for pure kernels: RED test-only commit → GREEN implementation commit, distinct commit hashes for gate compliance"
  - "Cross-reference to consumer in module docblock (riff-header-builder.ts references riffPcmDecode.ts to prevent drift)"

requirements-completed:
  - P98-CAT-01
  - P98-TTS-02
  - P98-TTS-04
  - Voice-catalog
  - Backend-owned-orchestration

# Metrics
duration: ~15min
completed: 2026-09-10
---

# Phase 98 Plan 02: Three pure kernels for Polly voice-out (catalog, chunk-and-stitch, RIFF header) Summary

**Three zero-dependency backend modules — POLLY_VOICES 7-voice generative catalog + isValidPollyVoice whitelist, splitIntoSentences + packChunks bounded at CHUNK_MAX_CHARS=2900, and buildRiffHeader synthesizing 44-byte RIFF+PCM headers for the Phase 19 client player — each shipped RED → GREEN with 60 total assertions passing.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-10T02:24:00Z (approximate)
- **Completed:** 2026-09-10T02:39:00Z (approximate)
- **Tasks:** 3
- **Files created:** 6 (3 source + 3 test)
- **Files modified:** 0
- **Tests added:** 60 assertions across 3 files (27 + 17 + 16)

## Accomplishments

- Shipped 3 dependency-free backend modules that unblock Wave 1 parallel work (Plans 03/04/06 can proceed without waiting on each other).
- Locked the 7-voice static catalog per D-Voice-catalog with a case-sensitive whitelist validator that will replace the old `.wav` regex in `identities.ts:51` (Phase 98-XX).
- Locked the Polly-ceiling chunk-and-stitch algorithm — greedy sentence packer with word-boundary fallback for over-length singletons — proving the 5000-char stress case produces multiple sub-chunks all under 2900 chars.
- Locked the RIFF+PCM header byte layout to match what the client-side `riffPcmDecode.ts` (Phase 19) already parses — keeping D-Verification-bar's "client player unchanged" invariant.
- Followed strict TDD RED → GREEN gate sequence per task with distinct commit hashes for each phase.

## Task Commits

Each task was committed atomically with TDD RED + GREEN commits:

1. **Task 1 RED: polly-voice-catalog test** — `ce648489` (test)
2. **Task 1 GREEN: polly-voice-catalog impl** — `324fa29d` (feat)
3. **Task 2 RED: chunk-and-stitch test** — `abdbdf4a` (test)
4. **Task 2 GREEN: chunk-and-stitch impl** — `58de18a5` (feat)
5. **Task 3 RED: riff-header-builder test** — `6d496cd6` (test)
6. **Task 3 GREEN: riff-header-builder impl** — `9b96b56a` (feat)

**Plan metadata:** pending (final docs commit after SUMMARY write)

_Note: All three tasks are TDD pure kernels — each has a test commit followed by an implementation commit. No REFACTOR pass was needed._

## Files Created/Modified

### Created (source)
- `src/backend/voice/polly-voice-catalog.ts` — Exports `POLLY_VOICES: readonly PollyVoice[]` (7 entries), `POLLY_VOICE_IDS: Set<string>`, `isValidPollyVoice(id: unknown): id is string`, `PollyVoice` interface. Pure module; consumed by identities validator + speak/speak-stream handlers + voice-migration idempotency guard.
- `src/backend/voice/chunk-and-stitch.ts` — Exports `splitIntoSentences(text: string): string[]`, `packChunks(sentences: string[]): string[]`, `CHUNK_MAX_CHARS: 2900`. Pure module; consumed by `handleSpeakStream` orchestrator (Phase 98 Plan 06). Abbreviation guard is module-local (mirrors `slashCommandTransform.ts` constant-privacy).
- `src/backend/voice/riff-header-builder.ts` — Exports `buildRiffHeader({channels, sampleRate, bitDepth, dataSize?}): Buffer`. Pure module; paired with `polly-adapter.ts` (Phase 98 Plan 04) — prepends 44-byte RIFF+PCM header to the first PCM chunk in a speak-stream response so the Phase 19 `riffPcmDecode.ts` client-side parser is unchanged.

### Created (tests)
- `src/backend/voice/polly-voice-catalog.test.ts` — 27 assertions across catalog-structure, POLLY_VOICE_IDS Set, and isValidPollyVoice (7 accept cases + 11 reject cases including old `.wav`, null/undefined/non-string, wrong-case).
- `src/backend/voice/chunk-and-stitch.test.ts` — 17 assertions across CHUNK_MAX_CHARS constant, splitIntoSentences edge cases (empty, single, multi, mixed terminators, newline), abbreviation guards (Dr / Mr+Mrs / Prof / St), packChunks basic behavior, and word-boundary fallback (5000-char stress test).
- `src/backend/voice/riff-header-builder.test.ts` — 16 assertions across length + ASCII markers (RIFF/WAVE/fmt /data), fmt subchunk numeric fields, dataSize default (streaming sentinel) + custom override, and two `{channels, sampleRate, bitDepth}` combinations (mono 16kHz 16-bit + stereo 48kHz 24-bit) sanity-checking byteRate/blockAlign math.

## Decisions Made

- **CHUNK_MAX_CHARS = 2900 (not 2999 or 3000).** Preserves 100-char safety margin so future SSML experimentation stays safe. Locked verbatim from RESEARCH § Pattern 3.
- **Abbreviation set is 17 entries + module-local (not exported).** Mirrors `slashCommandTransform.ts` constant-privacy convention. If the list needs > 5 new entries, that signals a genuine NLP need and should be a new phase decision rather than silent expansion.
- **isValidPollyVoice is case-sensitive.** Polly voice IDs are proper nouns; "Joanna" is legal, "joanna" is not. Rejecting wrong-case airtight prevents identity frontmatter drift.
- **buildRiffHeader writes ChunkSize as unsigned via `>>> 0`.** When the streaming sentinel `0xFFFFFFFF` is used, `dataSize + 36` overflows in 32-bit signed arithmetic; the unsigned right-shift keeps the byte pattern well-defined for the client's `getUint32(offset, true)` read.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<verify>` block specified `npx vitest run … --reporter=basic`. The installed vitest 4.1.8 does not accept `--reporter=basic` (would need `--reporter=default` or omission), so verification was run without the reporter flag. This is a verification-only tooling delta, not a code deviation; the tests themselves executed as specified and all 60 assertions pass. Not tracked as a deviation under Rules 1–4 because no code / behavior / plan intent was altered.

## Issues Encountered

None. All three tasks executed straight through the RED → GREEN cycle on the first attempt. Verification `grep -c 'getVoices\|@aws-sdk\|fetch('` returned 1 for polly-voice-catalog.ts because the module docstring mentions `getVoices()` as a cross-reference to the deleted endpoint (per D-Voice-catalog); the acceptance criterion's intent (no code-level SDK/proxy/fetch usage) is satisfied — a stricter code-only grep (`^import`, `require(`, `fetch(`) returns 0 as expected.

## User Setup Required

None — no external service configuration required. Plan 98-01 already installed the AWS SDK packages + ffmpeg; these three kernels have zero runtime dependencies.

## Next Phase Readiness

**Wave 1 unblocked for Plans 03, 04, 06:**

- **Plan 03 (frontend VoicePicker inline catalog):** Can import the same 7-voice list shape from `polly-voice-catalog.ts` for reference (frontend will own its own copy — two-source-of-truth accepted for 7 static strings). Shape: `{ voiceId, displayName, gender }`.
- **Plan 04 (polly-adapter):** `buildRiffHeader({channels:1, sampleRate:16000, bitDepth:16})` is ready to pair with the adapter's first-chunk PCM emission.
- **Plan 06 (voice.ts route rewrite):** `splitIntoSentences` + `packChunks(sentences)` is ready to slot into `handleSpeakStream` orchestrator between text-input and per-chunk Polly calls. `isValidPollyVoice` is ready to replace `IDENTITY_VOICE_RE` at `identities.ts:51`.

No blockers. No open questions. All three kernels are pure — safe to import from hot-path per-request handlers.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/voice/polly-voice-catalog.ts`
- FOUND: `src/backend/voice/polly-voice-catalog.test.ts`
- FOUND: `src/backend/voice/chunk-and-stitch.ts`
- FOUND: `src/backend/voice/chunk-and-stitch.test.ts`
- FOUND: `src/backend/voice/riff-header-builder.ts`
- FOUND: `src/backend/voice/riff-header-builder.test.ts`

**Commits verified present in git log:**
- FOUND: `ce648489` (test 98-02 polly-voice-catalog)
- FOUND: `324fa29d` (feat 98-02 polly-voice-catalog)
- FOUND: `abdbdf4a` (test 98-02 chunk-and-stitch)
- FOUND: `58de18a5` (feat 98-02 chunk-and-stitch)
- FOUND: `6d496cd6` (test 98-02 riff-header-builder)
- FOUND: `9b96b56a` (feat 98-02 riff-header-builder)

**Test suite verified:** `npx vitest run src/backend/voice/polly-voice-catalog.test.ts src/backend/voice/chunk-and-stitch.test.ts src/backend/voice/riff-header-builder.test.ts` → 3 test files passed, 60 assertions passed.

**TypeScript compile verified:** `npx tsc --noEmit -p tsconfig.node.json` → exit 0, no errors in new files.

## TDD Gate Compliance

All three tasks followed the RED → GREEN gate sequence with distinct commits:

| Task | RED (test) commit | GREEN (feat) commit | Assertions |
|------|-------------------|---------------------|------------|
| polly-voice-catalog | `ce648489` | `324fa29d` | 27 |
| chunk-and-stitch | `abdbdf4a` | `58de18a5` | 17 |
| riff-header-builder | `6d496cd6` | `9b96b56a` | 16 |

Each RED commit was verified to fail before the GREEN commit was made (module-not-found errors — tests could not resolve the source module because it did not yet exist). Each GREEN commit passed all assertions on first run. No REFACTOR pass was needed for any task.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
