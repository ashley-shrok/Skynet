---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: "04"
subsystem: ui
tags: [web-audio-api, streaming, riff-wav, pcm, state-machine, voice, frontend, react]

requires:
  - phase: 19-03
    provides: postSpeakStream fetch helper returning raw Response for streaming body reads
  - phase: 19-01
    provides: handleSpeakStream backend route that streams WAV chunks via Chatterbox /tts
  - phase: 19-02
    provides: nginx location /voice/speak-stream with proxy_buffering off

provides:
  - "riffPcmDecode.ts: pure parseRiffHeader() + decodePcmChunk() — zero Web Audio API dependency"
  - "webAudioStreamPlayer.ts: createWebAudioStreamPlayer factory — AudioContext + nextStartTime clock + reader loop"
  - "ChatMessage.tsx: speak handler swapped to postSpeakStream + WebAudioStreamPlayer; streaming audio begins ~30ms TTFB"
  - "21 new tests: 10 (riffPcmDecode) + 7 (webAudioStreamPlayer) + 4 (ChatMessage state machine)"

affects:
  - 19-05
  - pretty-view
  - voice

tech-stack:
  added: []
  patterns:
    - "Pure-function extraction for testability: RIFF parser + PCM decoder factored out of Web Audio scheduling so each is unit-testable without a mocked AudioContext"
    - "WebAudioStreamPlayer factory pattern: closure-based state machine encapsulating AudioContext + sources + reader; play/stop public API"
    - "nextStartTime running clock scheduling: AudioBufferSourceNode scheduled at nextStartTime, advanced by buffer.duration after each source — lifted from Nelly's Chatterbox demo"
    - "Module-level singleton pattern for cross-bubble preempt: currentPlayer/currentOwner replaces currentAudio/currentAudioUrl/currentAudioOwner"
    - "Streaming sentinel tolerance: 0xFFFFFFFF file-size field in RIFF header is intentionally not validated (Nelly's gotcha #2)"

key-files:
  created:
    - src/ui/features/pretty-view/riffPcmDecode.ts
    - src/ui/features/pretty-view/riffPcmDecode.test.ts
    - src/ui/features/pretty-view/webAudioStreamPlayer.ts
    - src/ui/features/pretty-view/webAudioStreamPlayer.test.ts
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/ChatMessage.test.tsx
    - src/ui/features/pretty-view/ChatMessage.speak.test.tsx

key-decisions:
  - "Fresh AudioContext per play() invocation (locked by 19-CONTEXT.md) to avoid sample-rate-mismatch bugs when voice changes between calls"
  - "onEnded fires only after BOTH reader done AND all sources ended — two-condition gate prevents premature idle state"
  - "stop() calls onEnded/onError NEVER — external stop is the caller's own action, no callback needed"
  - "No auto-toast on streaming errors: accepted tradeoff per 19-CONTEXT.md § Error handling (streaming errors != database-unreachable)"
  - "ChatMessage.speak.test.tsx updated from postSpeak+HTMLAudioElement mocks to postSpeakStream+createWebAudioStreamPlayer mocks (Rule 1 auto-fix: test file was broken by the swap)"
  - "Nelly's demo URL (https://gigaashley.click/tts-demo/) was auth-gated at execution time; RIFF/scheduling pattern was derived from the explicit specification in 19-CONTEXT.md § Frontend player which describes Nelly's approach verbatim"

patterns-established:
  - "Web Audio streaming pattern: accumulate bytes until header complete, then schedule each PCM chunk into AudioBufferSourceNode on nextStartTime clock"
  - "TDD pure-function extraction: factor pure RIFF/PCM functions from scheduling layer so decoder has no AudioContext dependency and can be unit-tested without mocks"

requirements-completed:
  - TTSSTR-05
  - TTSSTR-06

duration: 11min
completed: 2026-07-31
---

# Phase 19 Plan 04: Frontend Web Audio Player Summary

**Pure RIFF/PCM decoder + WebAudioStreamPlayer factory + ChatMessage speak-handler swap to streaming WebAudioAPI playback starting ~30ms TTFB, with 21 new unit tests and all 11 pre-Phase-19 tests preserved**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-31T23:39:58Z
- **Completed:** 2026-07-31T23:51:00Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `riffPcmDecode.ts`: Pure `parseRiffHeader()` + `decodePcmChunk()` with zero Web Audio dependency; handles Chatterbox's streaming sentinel (`0xFFFFFFFF` file size) without throwing; supports stereo deinterleave and partial-frame truncation
- `webAudioStreamPlayer.ts`: `createWebAudioStreamPlayer()` factory encapsulates AudioContext lifetime, nextStartTime scheduling clock, fetch reader loop, two-condition `onEnded` gate (reader done + all sources ended), idempotent `stop()`
- `ChatMessage.tsx`: speak handler swapped from `postSpeak → new Audio(blob) → play()` to `postSpeakStream → WebAudioStreamPlayer.play(response)`; cross-bubble singleton, state machine, unmount cleanup all adapted; `IdentityModal.tsx:783` `postSpeak(SAMPLE_PHRASE)` unchanged

## Test Counts

| File | Tests | Notes |
|------|-------|-------|
| riffPcmDecode.test.ts | 10 | New (Phase 19) |
| webAudioStreamPlayer.test.ts | 7 | New (Phase 19) |
| ChatMessage.test.tsx — Tests 18-21 | 4 | New (Phase 19) |
| ChatMessage.test.tsx — Tests 9-13, 14/14b/14c, G/H/I | 11 | Pre-existing, preserved verbatim |
| ChatMessage.speak.test.tsx | 6 | Adapted from patch #223 to patch #237 APIs |

**Total `it()` count in ChatMessage.test.tsx: 15** (11 pre-existing + 4 new — non-negotiable guard met)

## Regression Guards Verified

- `grep -c 'postSpeak(SAMPLE_PHRASE' src/ui/features/pretty-view/IdentityModal.tsx` = **1** (voice-preview unchanged)
- `grep -c 'HTMLAudioElement\|URL\.createObjectURL\|URL\.revokeObjectURL\|new Audio(' src/ui/features/pretty-view/ChatMessage.tsx` = **0** (old buffered artifacts fully removed)
- `grep -c 'postSpeak\b' src/ui/features/pretty-view/ChatMessage.tsx` = **0** (old import removed; `postSpeakStream` is used)
- `grep -cE 'it\("Test (9|10|11|12|13|14|14b|14c|[GHI])' ChatMessage.test.tsx` = **11** (per-name guard)
- `grep -cE 'it\("Test 1[4-7]' ChatMessage.test.tsx` = **3** (matches only 14, 14b, 14c — no new collision)
- `npm run build` exits 0 (Vite bundling)
- `npx tsc --noEmit` exits 0

## Task Commits

1. **Task 1: Create riffPcmDecode.ts (pure RIFF parser + PCM decoder) with unit tests** - `18baa00` (feat)
2. **Task 2: Create WebAudioStreamPlayer factory with mocked-AudioContext unit tests** - `7b560dd` (feat)
3. **Task 3: Swap ChatMessage.tsx speak handler + adapt singleton + add state-machine tests** - `5e08a4f` (feat)

## Files Created/Modified

- `/home/ubuntu/skynet/src/ui/features/pretty-view/riffPcmDecode.ts` — Pure `parseRiffHeader()` + `decodePcmChunk()` + `RiffHeader` type
- `/home/ubuntu/skynet/src/ui/features/pretty-view/riffPcmDecode.test.ts` — 10 unit tests (streaming sentinel, stereo deinterleave, partial truncation, error cases)
- `/home/ubuntu/skynet/src/ui/features/pretty-view/webAudioStreamPlayer.ts` — `createWebAudioStreamPlayer()` factory + `WebAudioStreamPlayer` + `WebAudioStreamPlayerOptions` interfaces
- `/home/ubuntu/skynet/src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` — 7 unit tests with mocked AudioContext
- `/home/ubuntu/skynet/src/ui/features/pretty-view/ChatMessage.tsx` — Speak handler swapped; singleton adapted; old buffered path fully removed
- `/home/ubuntu/skynet/src/ui/features/pretty-view/ChatMessage.test.tsx` — 4 new Phase 19 tests (18-21); all 11 pre-existing tests preserved
- `/home/ubuntu/skynet/src/ui/features/pretty-view/ChatMessage.speak.test.tsx` — Adapted from postSpeak+HTMLAudio mocks to postSpeakStream+WebAudioStreamPlayer mocks

## Decisions Made

- **AudioContext lifetime**: Fresh instance per `play()` invocation (locked by 19-CONTEXT.md) — avoids sample-rate-mismatch if Chatterbox voice changes between calls
- **onEnded two-condition gate**: Fires only when reader done AND all AudioBufferSourceNodes have fired `onended` — prevents premature idle transition when last chunk is still playing
- **No auto-toast on streaming errors**: Accepted per 19-CONTEXT.md § Error handling — dbHealthMonitor integration is axios-specific; streaming fetch errors are semantically different
- **Test numbering**: New tests numbered 18-21 per plan non-negotiable (avoids collision with existing Test 14/14b/14c)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated ChatMessage.speak.test.tsx to use new streaming API mocks**
- **Found during:** Task 3 (full pretty-view test run)
- **Issue:** `ChatMessage.speak.test.tsx` was the pre-existing patch #223 test file that mocked `postSpeak` + `HTMLAudioElement`. After the speak handler swap to `postSpeakStream` + `WebAudioStreamPlayer`, 4 of 6 tests in that file failed (they expected `postSpeak` to be called and `audio.pause()` to be invoked)
- **Fix:** Rewrote mock setup in that file to mock `postSpeakStream` + `createWebAudioStreamPlayer`; updated Test 3/4/5/6 assertions to match the new streaming behavior (stop() called instead of pause(), postSpeakStream called instead of postSpeak)
- **Files modified:** `src/ui/features/pretty-view/ChatMessage.speak.test.tsx`
- **Verification:** All 6 tests in `ChatMessage.speak.test.tsx` pass; full 28-file pretty-view suite passes
- **Committed in:** `5e08a4f` (Task 3 commit)

**2. [Note] Nelly's demo URL was auth-gated**
- `https://gigaashley.click/tts-demo/` returned a 302 redirect to auth during execution. The RIFF/scheduling pattern was derived from the explicit specification in 19-CONTEXT.md § Frontend player, which transcribes Nelly's approach verbatim (steps 1-5, including the streaming sentinel gotcha and the nextStartTime clock pattern). Implementation matches the spec exactly.

---

**Total deviations:** 1 auto-fixed (Rule 1 — broken test file updated to match new API), 1 noted (Nelly's demo auth-gated; spec in CONTEXT.md was sufficient)

## Issues Encountered

- Test 6 in `webAudioStreamPlayer.test.ts` (mid-stream reader error) initially caused an unhandled rejection warning because Node.js WHATWG ReadableStream propagates `controller.error()` as both a reader rejection AND a separate uncaught promise. Fixed by mocking the reader directly (fake `read()` method that rejects on second call) rather than using a stream with `pull()` that calls `controller.error()`.

## Known Stubs

None — all speak-button streaming functionality is fully wired. The player calls real Web Audio API in production; tests mock the AudioContext.

## Next Phase Readiness

- Phase 19 streaming TTS is fully implemented across all 4 plans (backend route, nginx config, frontend API helper, Web Audio player + ChatMessage swap)
- Phase 19 Plan 05 (ship checklist: `skynet-patches.md` entry for patch #237) can proceed
- End-to-end manual verification (click speak on long message → audio starts before synthesis completes, cross-bubble preempt, Stop button, iOS Safari) should be performed on next `docker compose up --force-recreate`

---
*Phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint*
*Completed: 2026-07-31*
