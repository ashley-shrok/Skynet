---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: "01"
subsystem: backend
tags:
  - backend
  - streaming
  - tts
  - voice
  - node-stream
  - jwt
dependency_graph:
  requires: []
  provides:
    - handleSpeakStream exported function in voice.ts
    - POST /speak-stream route on Express router (port 30001)
  affects:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
tech_stack:
  added:
    - node:stream Readable.fromWeb WHATWG→Node stream bridge (built-in, no new npm package)
  patterns:
    - Pipe-through streaming proxy (no server-side buffering)
    - Chatterbox body-schema translation (voice_mode/predefined_voice_id/stream/split_text/chunk_size)
    - MockRes streaming shim (write/setHeader/on/once/emit no-ops) for Readable.pipe() in-process testing
key_files:
  modified:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
decisions:
  - Used dynamic import("node:stream") for Readable.fromWeb to avoid adding a top-level import (either form acceptable per plan; dynamic chosen for minimal diff to surrounding code style)
  - Return type is Promise<void> (not Promise<Response | void>) — success path is fire-and-forget pipe; error paths call res.status().json() then return without returning res
  - beforeEach vi.useRealTimers() inside handleSpeakStream describe block overrides global fake timers (ReadableStream microtask scheduling requires real event loop)
  - Multiline router.post() format matches existing /speak and /transcribe wiring patterns in voice.ts
metrics:
  duration: 203s
  completed: "2026-07-31T23:30:00Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 19 Plan 01: Backend Streaming Route + Unit Tests Summary

New `handleSpeakStream` function and `POST /speak-stream` route that pipe-proxies Chatterbox `/tts` chunks to the browser via `Readable.fromWeb(response.body).pipe(res)` with zero server-side buffering, plus 11 unit tests (SA through SJ) covering all critical behaviors.

## What Was Built

### Task 1: handleSpeakStream + POST /speak-stream (commit `2d08bbe`)

Added to `src/backend/database/routes/voice.ts`:

1. **`TTS_STREAM_URL` constant** (`"http://100.80.122.111:8001/tts"`) — separate from existing `TTS_URL` (`/v1/audio/speech`). Both constants coexist per TTSSTR-07.

2. **`handleSpeakStream(req, res): Promise<void>`** — mirrors `handleSpeak` structure exactly:
   - Same three body-validation blocks (missing/empty text → 400, text > SPEAK_TEXT_MAX → 400, invalid voice format → 400)
   - Same `AbortController` with 300s timeout
   - Same `try/catch` shape with AbortError → 504 and generic → 502
   - **Replaced:** fetch URL, Chatterbox body schema, success branch
   - **Not replaced:** any of the existing handleSpeak code

3. **Chatterbox body schema** per 19-CONTEXT.md:
   ```json
   {"text": "...", "voice_mode": "predefined", "predefined_voice_id": "<voice ?? Elena.wav>", "stream": true, "split_text": true, "chunk_size": 80}
   ```

4. **Streaming success branch:**
   - Guard: `if (!response.body) throw new Error(...)` → falls into 502 path
   - Headers set BEFORE pipe: `res.status(200); res.setHeader("Content-Type", "audio/wav"); res.setHeader("X-Accel-Buffering", "no")`
   - Pipe: `Readable.fromWeb(response.body).pipe(res)` — fire-and-forget

5. **Route wiring:** `router.post("/speak-stream", authenticateJWT, express.json({ limit: "64kb" }), handler)` — JWT before body parser (T-19-01/T-16-04)

### Task 2: 11 Unit Tests SA–SJ (commit `a1fd87b`)

Added to `src/backend/database/routes/voice.test.ts`:

- `handleSpeakStream` added to existing import line
- `MockRes` extended with: `_writes: Uint8Array[]`, `_streamedEnded: boolean`, `setHeader`, `write`, `on`/`once`/`emit` no-op stubs, `end()` updated to accept `Uint8Array`
- `makeStreamingTtsResponse(status, chunks)` helper using WHATWG `ReadableStream`
- `describe("handleSpeakStream")` with `beforeEach(() => vi.useRealTimers())` to override global fake timers

**Test results:**

| Test | Behavior | Result |
|------|----------|--------|
| SA | 400 when body.text missing | PASS |
| SA2 | 400 when body.text empty string | PASS |
| SB | 400 when body.text > SPEAK_TEXT_MAX | PASS |
| SC | 400 when body.voice invalid format | PASS |
| SD | 200 pipe-through, Content-Type audio/wav, X-Accel-Buffering no, bytes match | PASS |
| SE | Chatterbox body schema all 6 keys match when voice omitted | PASS |
| SF | predefined_voice_id = provided voice, not DEFAULT_VOICE | PASS |
| SG | non-2xx → fixed error shape, _writes.length === 0 (T-19-04 no-body-leak) | PASS |
| SH | AbortError → 504 {error:"TTS stream timeout"} | PASS |
| SI | generic Error → 502 {error:"TTS stream proxy error"} | PASS |
| SJ | fetch URL exactly "http://100.80.122.111:8001/tts", not /v1/audio/speech | PASS |

## Plan Verification Evidence

**1. `tsc --noEmit`:** EXIT 0 — clean.

**2. `npx vitest run voice.test.ts`:** 29 passed, 0 failed (18 existing + 11 new).

**3. No server-side buffering inside handleSpeakStream:**
```
grep -cE '\.(arrayBuffer|text|blob)\(\)' [within handleSpeakStream awk-extracted body] = 0
```

**4. Both routes coexist (TTSSTR-07 preservation):**
- `/speak` route: present (line 358)
- `/speak-stream` route: present (line 370)

**5. handleSpeak NOT modified:**
```
git diff HEAD~2 ... | grep deletions matching handleSpeak region = 0
```

## Grep Counts (Acceptance Criteria Evidence)

| Pattern | Count | Notes |
|---------|-------|-------|
| `handleSpeakStream` in voice.ts | 4 | export decl + comment + 2 in route wiring |
| `Readable.fromWeb` in voice.ts | 2 | comment + use inside handler |
| `X-Accel-Buffering` in voice.ts | 2 | setHeader call + comment |
| `TTS_STREAM_URL` in voice.ts | 3 | const decl + comment + fetch call |
| `export async function handleSpeak\b` in voice.ts | 1 | original handleSpeak preserved |
| `it("Test S[A-J]` in voice.test.ts | 11 | SA SA2 SB SC SD SE SF SG SH SI SJ |

## handleSpeak Preservation Confirmation

```
git diff HEAD~2 src/backend/database/routes/voice.ts | grep '^-' | grep -v '^---' | grep -E '(export async function handleSpeak\b|const TTS_URL|...)' = 0 matches
```

Result: `OK: no regressions in handleSpeak region` — existing `handleSpeak` function and `POST /speak` route are byte-for-byte untouched.

## Deviations from Plan

None. Plan executed exactly as written.

- `router.post("/speak-stream", ...)` uses the same multiline format as the existing `/speak` route in the file (the plan's inline example was illustrative; the actual wiring pattern in voice.ts is multiline for all routes). The functional effect is identical — `authenticateJWT` before `express.json` before handler.
- Dynamic `import("node:stream")` chosen over static top-level import (plan explicitly permits either form).
- Return type `Promise<void>` (plan permitted either `Promise<void>` or `Promise<Response | void>`).

## Known Stubs

None. The implementation is complete and functional. No hardcoded empty values, placeholders, or TODO markers in the new code.

## Threat Flags

No new security surfaces introduced beyond what the plan's threat model covers. The `TTS_STREAM_URL` constant is hardcoded to the internal tailnet IP (`100.80.122.111:8001`) — no client-controlled URL. All T-19-01 through T-19-07 mitigations are implemented as specified.

## Self-Check

PASSED — verified below.
