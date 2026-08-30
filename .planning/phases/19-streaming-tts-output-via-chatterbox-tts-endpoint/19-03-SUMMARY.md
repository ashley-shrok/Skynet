---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: "03"
subsystem: api
tags: [fetch, streaming, jwt, voice, tts, frontend, vitest]

requires:
  - phase: 19-01
    provides: POST /voice/speak-stream backend route (handleSpeakStream) that postSpeakStream POSTs to

provides:
  - postSpeakStream(text, voice?): Promise<Response> fetch helper in src/ui/api/voice-api.ts
  - 8 vitest unit tests covering URL, body, JWT-attach, no-JWT, Content-Type, non-2xx pass-through, unread-body

affects:
  - 19-04 (ChatMessage.tsx plan that calls postSpeakStream for Web Audio progressive decode)

tech-stack:
  added: []
  patterns:
    - "fetch() for streaming endpoints (not axios) — returns raw Response for caller-driven body.getReader()"
    - "Manual JWT attach via localStorage.getItem('jwt') matching main-axios.ts:343 interceptor pattern"
    - "Omit Authorization header when no JWT present (never send Bearer null)"

key-files:
  created:
    - src/ui/api/voice-api.test.ts
  modified:
    - src/ui/api/voice-api.ts

key-decisions:
  - "Use fetch() not axios for streaming — only fetch gives caller access to ReadableStream before body drains"
  - "Do not throw on non-2xx — pass raw Response through; caller inspects response.ok and surfaces error via toast"
  - "JWT key is 'jwt' (matching localStorage.getItem('jwt') at main-axios.ts:343)"
  - "Omit Authorization header entirely when no JWT — avoids Bearer null in server logs"

patterns-established:
  - "Streaming fetch helper pattern: fetch + manual JWT + raw Response pass-through (no axios)"

requirements-completed:
  - TTSSTR-04

duration: 8min
completed: 2026-07-31
---

# Phase 19 Plan 03: Frontend postSpeakStream Fetch Helper Summary

**fetch()-based postSpeakStream helper with manual JWT attach and 8 vitest tests covering streaming body pass-through contract**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-31T23:35:00Z
- **Completed:** 2026-07-31T23:37:50Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `postSpeakStream(text: string, voice?: string): Promise<Response>` export to `src/ui/api/voice-api.ts` alongside existing `postSpeak()` — preserves byte-for-byte unchanged
- Implemented manual JWT attach via `localStorage.getItem("jwt")` (same key as `main-axios.ts:343`); omits Authorization header when no JWT present
- Returns raw unread `Response` using `fetch()` (not axios) so caller can drive `response.body.getReader()` for Web Audio API progressive decode
- 8 vitest tests pass under jsdom: URL/method, body-with-voice, body-without-voice, JWT-present, no-JWT (defensive Bearer-null regression), Content-Type, non-2xx pass-through, unread-body guarantee

## Test Results

```
Test Files  1 passed (1)
     Tests  8 passed (8)
  Duration  2.01s
```

## postSpeak Preservation Verification

```
grep -c 'export async function postSpeak\b' src/ui/api/voice-api.ts  => 1
git diff --unified=0 src/ui/api/voice-api.ts | grep -E '^-' | grep -vE '^---'  => (empty)
```

No lines removed from existing `postSpeak`, `getVoices`, or `SAMPLE_PHRASE` exports.

## JSDoc Comment

The `postSpeakStream` function has a JSDoc comment covering:
- "Streaming variant of postSpeak (patch #237 / Phase 19)."
- "Returns the raw Response with an unread body — caller drives response.body.getReader() for Web Audio API progressive decode."
- "JWT is attached manually because fetch() is not routed through main-axios.ts's request interceptor."
- "Does NOT throw on non-2xx — caller inspects response.ok / response.status and surfaces errors via toast."

## Task Commits

1. **Task 1: Add postSpeakStream export to voice-api.ts** - `046447c` (feat)
2. **Task 2: Add postSpeakStream unit tests to voice-api.test.ts** - `dd68a95` (test)

## Files Created/Modified

- `/home/ubuntu/skynet/src/ui/api/voice-api.ts` — Added `postSpeakStream` function (30 lines including JSDoc); existing `postSpeak`, `getVoices`, `SAMPLE_PHRASE` unchanged
- `/home/ubuntu/skynet/src/ui/api/voice-api.test.ts` — Created; 95 lines, 8 tests in `describe("postSpeakStream (Phase 19 / patch #237)")`

## Decisions Made

- Used `localStorage.getItem("jwt")` with literal key `"jwt"` — confirmed by reading `main-axios.ts:343` where the axios interceptor uses the same literal (Electron branch reads `localStorage.getItem("jwt")` and sets `Authorization: Bearer ${jwt}`)
- Authorization header omitted entirely (not set to `Bearer null`) when `jwt` is falsy — prevents misleading 401 with a `null` token string
- No `AbortController` in the helper — caller (ChatMessage.tsx, Plan 04) can wrap if needed; backend already has 300s AbortController ceiling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `postSpeakStream` is ready for Plan 04 (ChatMessage.tsx Web Audio player) to import and call
- The helper's `Promise<Response>` contract is fully tested — caller can safely call `response.body.getReader()` after `await postSpeakStream(...)`
- No blockers

## Self-Check: PASSED

- `src/ui/api/voice-api.ts` — FOUND
- `src/ui/api/voice-api.test.ts` — FOUND
- Commit `046447c` — FOUND
- Commit `dd68a95` — FOUND
- `npx tsc --noEmit` — CLEAN (exit 0)
- `npx vitest run src/ui/api/voice-api.test.ts` — 8/8 PASSED

---
*Phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint*
*Completed: 2026-07-31*
