---
phase: 109-stt-provider-swap-amazon-transcribe-to-amazon-nova-sonic-on
plan: "03"
subsystem: voice
tags:
  - stt
  - nova-sonic
  - bedrock
  - cutover
  - integration
dependency_graph:
  requires:
    - 109-01  # nova-sonic-adapter.ts + transcribeNovaSonic export
    - 109-02  # audio-transcode.ts + webmToPcm16k export
  provides:
    - voice.ts handleTranscribe wired to transcribeNovaSonic (D-CUTOVER landed)
  affects:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
tech_stack:
  added: []
  patterns:
    - single-adapter STT path (no feature flag; revert path is git revert)
    - adapter-facade mock pattern in route tests (matches polly-adapter approach)
key_files:
  created: []
  modified:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
decisions:
  - "D-CUTOVER: single-adapter call — transcribeNovaSonic(pcmBuf) — no ternary, no feature flag. Revert path is git revert of this commit."
  - "D-REWIRE: FLAC/OGG passthrough branches deleted from transcodeForTranscribe (never hit in production). ext param retained in signature for disk-bank filename builder but marked void in body."
  - "D-TESTS: Phase 100 chunked-path describe block (T1-T6) deleted entirely. Equivalent behavioral coverage (AccessDenied → 503, slash-transform, disk-bank ordering, 502 on transcode throw) ported to new single-path tests."
  - "fakeTranscriptStream helper deleted (dead after transcribe-streaming mock factory removed)."
metrics:
  duration: ~15 minutes
  completed: "2026-09-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 109 Plan 03: STT cutover — rewire handleTranscribe to Amazon Nova Sonic Summary

One-liner: Replaced the Transcribe streaming two-path dispatch (chunked/single ternary + CHUNKED_THRESHOLD_BYTES) with a single `transcribeNovaSonic(pcmBuf)` call preceded by `webmToPcm16k` transcode; deleted the Phase 100 chunked-path tests (T1-T6) and re-mocked the remaining route tests against the new adapter facade.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewire voice.ts::handleTranscribe | bb72e9d1 | src/backend/database/routes/voice.ts |
| 2 | Rewrite voice.test.ts | 42d3e015 | src/backend/database/routes/voice.test.ts |

## What Was Built

### Task 1 — voice.ts rewired (bb72e9d1)

- **Imports removed:** `transcribeBuffer` (transcribe-adapter.js), `transcribeBufferChunked` (transcribe-orchestrator.js), `webmToFlac` (audio-transcode.js).
- **Imports added:** `transcribeNovaSonic` (nova-sonic-adapter.js), `webmToPcm16k` (audio-transcode.js).
- **Constant deleted:** `CHUNKED_THRESHOLD_BYTES` export + 4-line comment block.
- **`transcodeForTranscribe` simplified:** return type drops `mediaEncoding` field; body drops FLAC/OGG passthrough branches; single path is `webmToPcm16k(buf)` → `{ buffer: pcmBuf, sampleRateHz: 16000 }`. `ext` param retained (disk-bank filename builder uses it upstream) but marked `void ext` in the body.
- **`handleTranscribe` ternary replaced:** 11-line chunked/single ternary becomes one line: `const transcript = await transcribeNovaSonic(transcodeResult.buffer);`
- **Success log trimmed:** dropped `mediaEncoding=... path=...` fields; now `textLen=<n>` only (T-109-03-07 preserved).
- **Preserved verbatim:** disk-bank fire-and-forget (mkdir + writeFile before transcode), slash-transform block (WAKE_WORD_REGEX + fetchSkillCatalog + applyServerSlashTransform), AccessDenied → 503 catch classifier, generic → 502 catch branch, all Polly code, multer 25 MB cap, authenticateJWT middleware order, multipartOriginGuard.

### Task 2 — voice.test.ts rewritten (42d3e015)

- **vi.hoisted block:** removed `transcribeClientCtor`, `startStreamCmdCtor`, `transcribeSendMock`; added `transcribeNovaSonicMock`.
- **vi.mock factories:** deleted `@aws-sdk/client-transcribe-streaming` factory; deleted `transcribe-orchestrator.js` factory; replaced `webmToFlac` stub with `webmToPcm16k` stub in `audio-transcode.js` mock; added `nova-sonic-adapter.js` mock returning `transcribeNovaSonicMock`.
- **Imports:** removed `CHUNKED_THRESHOLD_BYTES`, `webmToFlac`, `transcribeBufferChunked`; added `webmToPcm16k`, `transcribeNovaSonic`.
- **`beforeEach`:** swapped `transcribeSendMock`/`startStreamCmdCtor`/`webmToFlac`/`transcribeBufferChunked` resets for `transcribeNovaSonicMock`/`webmToPcm16k` resets.
- **`fakeTranscriptStream` helper deleted** (dead code after transcribe-streaming mock removed).
- **handleTranscribe describe block rewritten:** renamed to "Amazon Nova Sonic on Bedrock"; 6 tests ported (happy path, missing-file 400, disk-bank ordering D-14, webmToPcm16k throw → 502, AccessDenied → 503, slash-transform hit + miss).
- **Phase 100 describe block deleted** (T1-T6 — all coverage ported to single-path tests above).
- **Polly blocks (handleSpeak, handleSpeakStream) untouched.**
- **Result:** 24 tests pass green.

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep -c "transcribeNovaSonic" voice.ts` ≥ 2 | 3 |
| `grep -c "webmToPcm16k" voice.ts` ≥ 2 | 4 |
| `grep -cE "\btranscribeBuffer\b" voice.ts` = 0 | 0 |
| `grep -c "transcribeBufferChunked" voice.ts` = 0 | 0 |
| `grep -c "webmToFlac" voice.ts` = 0 | 0 |
| `grep -c "CHUNKED_THRESHOLD_BYTES" voice.ts` = 0 | 0 |
| `grep -c "mediaEncoding" voice.ts` = 0 | 0 |
| `grep -c "isAwsAccessDenied" voice.ts` ≥ 2 | 4 |
| `grep -cE "applyServerSlashTransform|fetchSkillCatalog|WAKE_WORD_REGEX" voice.ts` ≥ 3 | 6 |
| `grep -cE "STT_RECORDINGS_DIR|transcribe-bank-write" voice.ts` ≥ 2 | 3 |
| `grep -cE "handleSpeak|handleSpeakStream" voice.ts` ≥ 4 | 8 |
| `npx tsc --noEmit` exits 0 | PASS |
| `grep -c "transcribeNovaSonic" voice.test.ts` ≥ 8 | 14 |
| `grep -c "webmToPcm16k" voice.test.ts` ≥ 4 | 14 |
| All removed symbols in test.ts = 0 | 0 |
| `npx vitest run src/backend/.../voice.test.ts` exits 0 | 24/24 PASS |

Note: `grep -cE '"flac"|"ogg-opus"' voice.ts` returns 1 (the `extFromMimetype` helper's `return "flac"` line). This is intentional: `extFromMimetype` is preserved verbatim per plan (used by disk-bank filename builder). The FLAC/OGG passthrough *branches* in `transcodeForTranscribe` are gone; only the extension-detector string remains.

## Deviations from Plan

None — plan executed exactly as written. The `--related` vitest flag is not supported by vitest v4.1.8; the alternative scoped command (`npx vitest run src/backend/database/routes/voice.test.ts`) was used as the primary green gate per the fleet test-discipline rule. All 24 tests pass.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All existing trust boundaries and STRIDE mitigations preserved verbatim. T-109-03-01 through T-109-03-07 verified as implemented.

## Known Stubs

None. `transcribeNovaSonic` is a real adapter (shipped in Plan 01). `webmToPcm16k` is a real helper (shipped in Plan 02). No placeholder or hardcoded empty values in the modified files.

## Self-Check: PASSED

- `src/backend/database/routes/voice.ts` — exists, verified
- `src/backend/database/routes/voice.test.ts` — exists, verified
- Commit bb72e9d1 — verified (`git log --oneline | grep bb72e9d1`)
- Commit 42d3e015 — verified (`git log --oneline | grep 42d3e015`)
- `transcribe-adapter.ts` still exists on disk (unimported) — Plan 04 deletes it
- `transcribe-orchestrator.ts` still exists on disk (unimported) — Plan 04 deletes it
