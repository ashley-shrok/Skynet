---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: 04
type: execute
wave: 3
depends_on:
  - 19-03
files_modified:
  - src/ui/features/pretty-view/riffPcmDecode.ts
  - src/ui/features/pretty-view/riffPcmDecode.test.ts
  - src/ui/features/pretty-view/webAudioStreamPlayer.ts
  - src/ui/features/pretty-view/webAudioStreamPlayer.test.ts
  - src/ui/features/pretty-view/ChatMessage.tsx
  - src/ui/features/pretty-view/ChatMessage.test.tsx
autonomous: true
requirements:
  - TTSSTR-05
  - TTSSTR-06
tags:
  - frontend
  - web-audio-api
  - streaming
  - riff-wav
  - pcm
  - state-machine
  - voice

must_haves:
  truths:
    - "Clicking the speak button on a pretty-view bubble starts playback via Web Audio API within perceptible latency well before the response body finishes downloading (streaming, not buffered)"
    - "The bubble's speak icon transitions through the same idle→loading→playing→idle observable states as pre-Phase-19 (patch #223 behavior preserved from the user's POV)"
    - "Clicking speak on bubble A while bubble B is playing: bubble B stops cleanly (no ugly click, no trailing audio), bubble A begins loading (cross-bubble preempt)"
    - "Clicking the speak icon on the currently-playing bubble stops playback cleanly (Stop semantics preserved)"
    - "On the response finishing (last chunk played), the singleton clears and speakState reverts to idle"
    - "Fetch errors (non-2xx response, network failure before body reader starts) surface as a caught exception and revert speakState to idle without leaving state stuck at loading/playing"
    - "Mid-stream errors (reader.read() rejection) tear down any scheduled sources + close AudioContext + revert to idle"
    - "The RIFF-WAV header parser (44-byte little-endian format-chunk parse: sampleRate, channels, bitDepth, PCM data offset) is a pure function with its own unit tests"
    - "The PCM chunk decoder (Int16 → Float32 [-1, 1] normalized samples, per-channel deinterleave) is a pure function with its own unit tests"
    - "IdentityModal voice-preview at src/ui/features/pretty-view/IdentityModal.tsx:783 STILL calls postSpeak() (unchanged — grep-verifiable) — the streaming swap is scoped to ChatMessage.tsx only"
    - "Existing ChatMessage.test.tsx Test 9-13 (Phase 05 sender-side chip render tests) still pass unmodified — regression guard"
  artifacts:
    - path: src/ui/features/pretty-view/riffPcmDecode.ts
      provides: "pure functions parseRiffHeader(bytes: Uint8Array) and decodePcmChunk(bytes: Uint8Array, format)"
      exports: ["parseRiffHeader", "decodePcmChunk", "RiffHeader"]
    - path: src/ui/features/pretty-view/riffPcmDecode.test.ts
      provides: "unit tests for RIFF parse + PCM decode covering little-endian header, sample-rate extraction, Int16→Float32 conversion, mono/stereo deinterleave"
    - path: src/ui/features/pretty-view/webAudioStreamPlayer.ts
      provides: "WebAudioStreamPlayer class or factory encapsulating AudioContext + scheduled sources + reader; play(response) + stop() + onended callback"
      exports: ["WebAudioStreamPlayer", "createWebAudioStreamPlayer"]
    - path: src/ui/features/pretty-view/webAudioStreamPlayer.test.ts
      provides: "unit tests exercising play/stop/onended state transitions with a mocked AudioContext"
    - path: src/ui/features/pretty-view/ChatMessage.tsx
      provides: "speak handler swapped to postSpeakStream + WebAudioStreamPlayer; module-level singleton tracks player instead of HTMLAudioElement"
      contains: "postSpeakStream"
    - path: src/ui/features/pretty-view/ChatMessage.test.tsx
      provides: "existing Test 9-13 preserved; new tests for speak state machine covering (loading→playing→idle happy path via mocked player) and (cross-bubble preempt calls stop on the previous singleton)"
  key_links:
    - from: "src/ui/features/pretty-view/ChatMessage.tsx:onSpeakClick"
      to: "postSpeakStream from voice-api"
      via: "async fetch call returning Response"
      pattern: "postSpeakStream\\("
    - from: "src/ui/features/pretty-view/ChatMessage.tsx:onSpeakClick"
      to: "WebAudioStreamPlayer.play(response)"
      via: "handoff of Response to player which drives the read loop"
      pattern: "\\.play\\(.*response"
    - from: "webAudioStreamPlayer.ts:play loop"
      to: "riffPcmDecode.ts:parseRiffHeader and decodePcmChunk"
      via: "chunk-by-chunk parse + decode + schedule"
      pattern: "parseRiffHeader|decodePcmChunk"
---

<objective>
Replace the speak-button handler in `src/ui/features/pretty-view/ChatMessage.tsx` (currently L72-125 — `postSpeak → URL.createObjectURL(blob) → new Audio(url).play()`) with a Web Audio API progressive-decode player fed by `postSpeakStream()` (added in Plan 03). Preserve the observable state machine (idle/loading/playing icon transitions), preserve the module-level cross-bubble singleton for Stop / new-bubble-preempt semantics (adapted from `HTMLAudioElement` to a Web Audio player object), and factor the two pure algorithms (RIFF header parse + PCM chunk decode to Float32) into a stand-alone module with unit tests so the Web Audio scheduling layer can be mocked in tests per the CONTEXT.md § Testing recommendation (option c). Implements TTSSTR-05 and TTSSTR-06.

Purpose: Move from "click → wait ~500-2000ms for full synthesis → hear first sample" to "click → hear first sample within ~30ms" without changing what the user sees in the icon, without breaking bubble-to-bubble preempt, without touching IdentityModal's voice preview, and without breaking any of the existing Phase 05 sender-side chip render tests.

Output:
1. `src/ui/features/pretty-view/riffPcmDecode.ts` — pure functions `parseRiffHeader(bytes)` and `decodePcmChunk(bytes, format)` with types.
2. `src/ui/features/pretty-view/riffPcmDecode.test.ts` — 10+ unit tests covering RIFF parse edge cases + PCM Int16→Float32 conversion + stereo deinterleave.
3. `src/ui/features/pretty-view/webAudioStreamPlayer.ts` — factory `createWebAudioStreamPlayer({onEnded, onError})` returning `{play(response), stop()}` — encapsulates the AudioContext + running `nextStartTime` clock + scheduled `AudioBufferSourceNode` list + fetch reader loop.
4. `src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` — 4+ unit tests using a mocked AudioContext (via `vi.stubGlobal`) to exercise play/stop/onended transitions.
5. `src/ui/features/pretty-view/ChatMessage.tsx` — speak handler rewired to use `postSpeakStream` + `createWebAudioStreamPlayer`; module-level singleton adapted from `{currentAudio, currentAudioUrl, currentAudioOwner}` to `{currentPlayer, currentOwner}`.
6. `src/ui/features/pretty-view/ChatMessage.test.tsx` — Phase 05 tests preserved; add 3-4 new tests for speak state machine (mocked player).

Non-negotiables (from 19-CONTEXT.md § Frontend player + § Cross-bubble Stop + § Error handling + § Testing, and TTSSTR-05/06):
- Reference the ~50 lines of JS at view-source of https://gigaashley.click/tts-demo/ (Nelly's demo) for the RIFF-parse + AudioBufferSourceNode scheduling recipe. Executor MUST fetch this URL during Task 2 to lift the reference implementation. Nelly explicitly permitted lift-wholesale.
- Preserve observable behavior of the speakState state machine (icon transitions look identical to pre-Phase-19).
- Preserve the cross-bubble preempt + Stop semantics (module-level singleton pattern).
- IdentityModal.tsx:783 continues to call `postSpeak` — do NOT swap it to `postSpeakStream`.
- Extract RIFF parser + PCM decoder as pure functions per CONTEXT.md § Testing option (c).
- No auto-retry on mid-stream errors (CONTEXT.md § Error handling — retry would risk stuttering/doubled audio).
- Losing the `voice-api.ts:11-12` `dbHealthMonitor.isBackendUnreachable` auto-toast integration on the streaming path is ACCEPTABLE per CONTEXT.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
@src/ui/features/pretty-view/ChatMessage.tsx
@src/ui/features/pretty-view/ChatMessage.test.tsx
@src/ui/api/voice-api.ts
@src/ui/features/pretty-view/IdentityModal.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create riffPcmDecode.ts (pure RIFF parser + PCM decoder) with unit tests</name>
  <files>src/ui/features/pretty-view/riffPcmDecode.ts, src/ui/features/pretty-view/riffPcmDecode.test.ts</files>

  <read_first>
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Frontend player (steps 3-4 describe the parse+decode contract).
    - Nelly's demo view-source at `https://gigaashley.click/tts-demo/` — fetch this URL. Execute one of: (a) `curl -s https://gigaashley.click/tts-demo/ | grep -A 500 '<script>' | head -600`, or (b) use the WebFetch tool with the prompt "extract the JavaScript that parses the RIFF/WAV header from the first bytes of a streamed response and the JavaScript that decodes each PCM chunk into an AudioBuffer for AudioBufferSourceNode scheduling — copy the code verbatim". You MUST see the reference implementation before writing your own — Nelly's version handles the streaming WAV's `0xFFFFFFFF` unknown-length sentinel (per CONTEXT.md § Nelly's endpoint spec) which a naive parser would trip on.
    - RIFF-WAV format primer (if unfamiliar): the first 44 bytes are the "RIFF" chunk header (12 bytes) + "fmt " subchunk (24 bytes: format code, channels @ offset 22, sample rate @ offset 24, byte rate, block align, bits-per-sample @ offset 34) + "data" subchunk header (8 bytes: "data" magic + size, `0xFFFFFFFF` sentinel for streaming). PCM samples start at byte 44 for the standard header. Little-endian encoding throughout.
    - No existing files in `src/ui/features/pretty-view/` named `riffPcmDecode*` — this is a greenfield module.
  </read_first>

  <behavior>
    - parseRiffHeader accepts a Uint8Array >= 44 bytes and returns `{ sampleRate, channels, bitDepth, formatCode, pcmDataOffset }` — sampleRate at byte offset 24 (little-endian uint32), channels at offset 22 (little-endian uint16), bitDepth at offset 34 (little-endian uint16), formatCode at offset 20 (uint16 — typically 1 for PCM), pcmDataOffset = 44 for the standard header (or the byte after the "data" subchunk header when non-standard fmt chunk sizes are present — advanced feature; v1 assumes 44)
    - parseRiffHeader throws (or returns null — planner's discretion) when input is < 44 bytes
    - parseRiffHeader throws when "RIFF" magic (bytes 0-3) is not present, or when "WAVE" magic (bytes 8-11) is not present — the streaming sentinel `0xFFFFFFFF` at bytes 4-7 for the file-size field is NORMAL and must NOT trigger validation failure (this is Nelly's gotcha #2 — a naive parser rejects this)
    - decodePcmChunk accepts a Uint8Array of raw PCM bytes + format (channels, bitDepth) and returns Float32Array[] (one Float32Array per channel), samples normalized to [-1.0, 1.0]
    - decodePcmChunk supports bitDepth === 16 (Int16 → Float32 / 32768). Other bit depths may throw "unsupported bit depth" — Chatterbox streams 16-bit PCM so 16 is the required minimum; 8-bit and 24-bit support is out of scope
    - decodePcmChunk supports channels === 1 (mono — one Float32Array in the returned array) and channels === 2 (stereo — two Float32Arrays, deinterleaved: sample[0] = ch0, sample[1] = ch1, sample[2] = ch0, ...)
    - decodePcmChunk handles a byte-length not evenly divisible by (channels * bitDepth/8) by truncating (drop trailing partial frame) — do NOT throw; a partial chunk mid-stream is a normal case
    - Both functions are pure (no side effects, deterministic output for input, no AudioContext dependency)
  </behavior>

  <action>
    Create `src/ui/features/pretty-view/riffPcmDecode.ts`:

    Export a type:
    ```
    export interface RiffHeader {
      sampleRate: number;
      channels: number;
      bitDepth: number;
      formatCode: number;
      pcmDataOffset: number;
    }
    ```

    Export `parseRiffHeader(bytes: Uint8Array): RiffHeader`. Implementation:
    1. Guard: if `bytes.byteLength < 44` throw `new Error("RIFF header requires at least 44 bytes")`.
    2. Create a DataView over the underlying ArrayBuffer: `const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)`.
    3. Validate "RIFF" magic bytes 0-3: read as ASCII from `bytes[0..3]` — if not `"RIFF"`, throw `new Error("Not a RIFF file (missing RIFF magic)")`.
    4. Skip file-size field (bytes 4-7) WITHOUT validating — the streaming sentinel `0xFFFFFFFF` is normal per Nelly's gotcha #2 (CONTEXT.md § Nelly's endpoint spec).
    5. Validate "WAVE" magic bytes 8-11 similarly — if not `"WAVE"`, throw.
    6. Extract fields using little-endian DataView reads (second arg `true` on `getUint16`/`getUint32`):
       - `formatCode = dv.getUint16(20, true)`
       - `channels = dv.getUint16(22, true)`
       - `sampleRate = dv.getUint32(24, true)`
       - `bitDepth = dv.getUint16(34, true)`
       - `pcmDataOffset = 44`
    7. Return the header object.

    Export `decodePcmChunk(bytes: Uint8Array, header: Pick<RiffHeader, "channels" | "bitDepth">): Float32Array[]`. Implementation:
    1. Guard: if `header.bitDepth !== 16` throw `new Error("Unsupported bit depth: only 16-bit PCM implemented")`.
    2. Compute `bytesPerSample = header.bitDepth / 8` (= 2 for 16-bit).
    3. Compute `frameBytes = header.channels * bytesPerSample`.
    4. Compute `frameCount = Math.floor(bytes.byteLength / frameBytes)` (truncate partial trailing frame).
    5. Allocate one Float32Array per channel: `const channels = Array.from({length: header.channels}, () => new Float32Array(frameCount))`.
    6. Create DataView over input for little-endian sample reads.
    7. Loop `for (let frame = 0; frame < frameCount; frame++)` and for each channel `for (let ch = 0; ch < header.channels; ch++)`:
       - `const sampleByteOffset = frame * frameBytes + ch * bytesPerSample`
       - `const int16 = dv.getInt16(sampleByteOffset, true)` (signed, little-endian)
       - `channels[ch][frame] = int16 / 32768` (normalize to [-1, 1); positive max is 32767/32768 ~ 0.99997)
    8. Return `channels` array.

    Add a JSDoc comment above each export citing Nelly's demo view-source URL and the CONTEXT.md § Frontend player section as the reference. Also note the streaming sentinel gotcha in the parseRiffHeader JSDoc.

    Create `src/ui/features/pretty-view/riffPcmDecode.test.ts`:

    Use vitest imports (`describe, it, expect`). Tests:

    - **Test 1 — parseRiffHeader happy path**: Construct a 44-byte Uint8Array with "RIFF" at bytes 0-3, arbitrary size at 4-7 (e.g., 0x100), "WAVE" at 8-11, "fmt " at 12-15, fmt chunk size 16 at 16-19 (uint32 LE), formatCode 1 (PCM) at 20-21, channels 1 at 22-23, sampleRate 24000 at 24-27, byteRate 48000 at 28-31, blockAlign 2 at 32-33, bitDepth 16 at 34-35, "data" at 36-39, size 0 at 40-43. Assert returned header matches the input fields.

    - **Test 2 — parseRiffHeader streaming sentinel**: Same as Test 1 but set bytes 4-7 to `0xFF 0xFF 0xFF 0xFF` (streaming size sentinel). Assert the function returns the same header WITHOUT throwing.

    - **Test 3 — parseRiffHeader stereo 48kHz 16-bit**: Construct a header with channels=2, sampleRate=48000, bitDepth=16. Assert extracted fields.

    - **Test 4 — parseRiffHeader missing RIFF magic**: First byte is `0x00`; expect the function to throw `/RIFF/i`.

    - **Test 5 — parseRiffHeader missing WAVE magic**: RIFF present but bytes 8-11 are `"XYZW"`; expect throw `/WAVE/i`.

    - **Test 6 — parseRiffHeader too short**: 30-byte input; expect throw `/44 bytes|too short/i`.

    - **Test 7 — decodePcmChunk mono Int16**: Input `Uint8Array([0x00, 0x00, 0xFF, 0x7F, 0x00, 0x80])` (three samples: 0, +32767, -32768). Header `{channels: 1, bitDepth: 16}`. Expect `[Float32Array([0, 32767/32768, -1])]` (one channel, three frames). Assert numerical equality within 1e-6.

    - **Test 8 — decodePcmChunk stereo Int16 deinterleave**: Input represents 2 stereo frames: `[ch0=0, ch1=+32767, ch0=-32768, ch1=+16384]`. Header `{channels: 2, bitDepth: 16}`. Expect two Float32Arrays: `[[0, -1], [32767/32768, 16384/32768]]`. Assert per-channel deinterleaving is correct.

    - **Test 9 — decodePcmChunk truncates partial frame**: Mono, 5-byte input (2 full frames + 1 orphan byte). Assert result has 2 frames (5 bytes / 2 bytes-per-frame = 2.5 → floor to 2).

    - **Test 10 — decodePcmChunk unsupported bit depth throws**: `{channels: 1, bitDepth: 8}`; expect throw `/bit depth|unsupported/i`.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit</automated>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/riffPcmDecode.test.ts 2>&1 | tail -30</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it(' src/ui/features/pretty-view/riffPcmDecode.test.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -cE 'export (function|interface|const) (parseRiffHeader|decodePcmChunk|RiffHeader)' src/ui/features/pretty-view/riffPcmDecode.ts</automated>
  </verify>

  <acceptance_criteria>
    - `npx vitest run src/ui/features/pretty-view/riffPcmDecode.test.ts` exits 0 with all 10 tests passing.
    - `grep -c 'it(' src/ui/features/pretty-view/riffPcmDecode.test.ts` >= 10.
    - `grep` for exports `parseRiffHeader`, `decodePcmChunk`, `RiffHeader` finds all three (count >= 3).
    - `tsc --noEmit` exits 0.
    - `grep -c 'AudioContext\|AudioBuffer' src/ui/features/pretty-view/riffPcmDecode.ts` = 0 (pure functions have zero Web Audio dependencies).
    - Test 2 explicitly proves the streaming-sentinel case does NOT throw (Nelly's gotcha #2 handled).
  </acceptance_criteria>

  <done>
    `riffPcmDecode.ts` exports `parseRiffHeader`, `decodePcmChunk`, and `RiffHeader` as pure functions with zero side effects. `riffPcmDecode.test.ts` covers 10 cases including the streaming-sentinel edge case, stereo deinterleave, partial-frame truncation, and unsupported-bit-depth error. All tests pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create WebAudioStreamPlayer factory with mocked-AudioContext unit tests</name>
  <files>src/ui/features/pretty-view/webAudioStreamPlayer.ts, src/ui/features/pretty-view/webAudioStreamPlayer.test.ts</files>

  <read_first>
    - `src/ui/features/pretty-view/riffPcmDecode.ts` (created in Task 1) — use `parseRiffHeader` and `decodePcmChunk` verbatim; do NOT reimplement.
    - Nelly's demo view-source at `https://gigaashley.click/tts-demo/` — re-fetch if not cached from Task 1. Focus specifically on the `nextStartTime` scheduling clock pattern (initialized to `AudioContext.currentTime + smallEpsilon`; advanced by `buffer.duration` after each `sourceNode.start(nextStartTime)` call). Lift the scheduling recipe wholesale per Nelly's permission.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Frontend player (steps 1-5), § Cross-bubble Stop / new-bubble-preempt semantics, § Error handling.
    - `src/ui/features/pretty-view/ChatMessage.tsx:60-70` (existing cleanup useEffect) — the singleton teardown pattern that this player object must fit into via its `.stop()` method (called from ChatMessage's unmount/click-preempt).
    - Web Audio API primer (if unfamiliar): `AudioContext.createBuffer(channels, frames, sampleRate)` creates an AudioBuffer; `buffer.getChannelData(ch).set(float32Array)` fills it; `AudioBufferSourceNode` from `audioContext.createBufferSource()` connects to `audioContext.destination` and plays at `sourceNode.start(when)` on the AudioContext's own clock (`audioContext.currentTime`). Each source node is single-use — call `.start()` once, `.onended` fires when done.
    - No existing `webAudioStreamPlayer*` files — greenfield.
  </read_first>

  <behavior>
    - createWebAudioStreamPlayer({onEnded, onError}) returns an object with methods play(response: Response): Promise<void> and stop(): void
    - play(response) reads response.body chunks via response.body.getReader() until done, feeds each PCM chunk through decodePcmChunk, allocates an AudioBuffer, creates an AudioBufferSourceNode, schedules it via .start(nextStartTime), advances nextStartTime by buffer.duration, and moves on
    - The FIRST chunk contains the 44-byte RIFF header + some PCM — parseRiffHeader is called ONCE at the start; subsequent chunks are treated as pure PCM
    - If chunks straddle the 44-byte boundary, play() accumulates bytes until it has at least 44 before parsing the header (defensive against small initial packets)
    - The FIRST source's onended callback advances state to "first-buffer-completed"; the LAST source's onended (after upstream reader done AND all scheduled sources finished) fires the caller's onEnded callback
    - Simpler model acceptable: fire onEnded when the reader signals `done` AND `scheduledSources.every(s => s._ended)` — track a per-source `ended` flag; onEnded fires once, then never again
    - stop() calls .stop() on every scheduled source (wrapped in try/catch in case source already ended — .stop() on an ended source throws InvalidStateError), calls reader.cancel() if reader exists, calls audioContext.close() (returns a Promise; player should not await it), and nullifies internal references. Idempotent — calling stop() twice is safe
    - If fetch response is not ok (response.ok === false), play() invokes onError with an Error carrying response.status and does NOT start any playback
    - Mid-stream reader errors (reader.read() rejects) call stop() internally (teardown scheduled sources + close context) then invoke onError with the caught error
    - The player creates its OWN AudioContext per play() invocation — CONTEXT.md § Frontend player locked this; a fresh context per invocation avoids sample-rate-mismatch bugs when the Chatterbox voice's sample rate differs across calls
    - Player never invokes onEnded AND onError for the same session — one or the other; stop() called externally invokes NEITHER (external stop is the caller's own action, no callback needed)
  </behavior>

  <action>
    Create `src/ui/features/pretty-view/webAudioStreamPlayer.ts`:

    Export a factory:
    ```
    export interface WebAudioStreamPlayerOptions {
      onEnded?: () => void;
      onError?: (err: Error) => void;
    }

    export interface WebAudioStreamPlayer {
      play(response: Response): Promise<void>;
      stop(): void;
    }

    export function createWebAudioStreamPlayer(
      opts: WebAudioStreamPlayerOptions = {},
    ): WebAudioStreamPlayer { ... }
    ```

    Internal state (closure variables inside the factory):
    ```
    let audioContext: AudioContext | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const sources: AudioBufferSourceNode[] = [];
    let endedSources = 0;
    let readerDone = false;
    let stopped = false;
    let onEndedFired = false;
    let onErrorFired = false;
    ```

    play(response) implementation:
    1. Guard: if `!response.ok` invoke `opts.onError?.(new Error(\`postSpeakStream returned ${response.status}\`))`; set `onErrorFired = true`; return early.
    2. Guard: if `!response.body` invoke `opts.onError?.(new Error("Response has no body"))`; return early.
    3. Instantiate `audioContext = new AudioContext();` (or `new (window.AudioContext || (window as any).webkitAudioContext)()` for iOS Safari — patch #211 lesson; but modern iOS 14.5+ Safari has standard AudioContext, and the CONTEXT.md iOS spike already passed on Ashley's iPhone PWA, so plain `new AudioContext()` is sufficient unless typecheck complains).
    4. `reader = response.body.getReader();`
    5. Declare `let headerBytes: Uint8Array | null = null; let header: RiffHeader | null = null; let nextStartTime = audioContext.currentTime + 0.02;` (20ms epsilon — small enough to be imperceptible, large enough to prevent underrun on the very first schedule).
    6. Enter async loop:
       ```
       while (true) {
         if (stopped) return;
         const { done, value } = await reader.read();
         if (done) { readerDone = true; maybeFireEnded(); return; }
         if (!value) continue;
         // Accumulate header bytes if not yet parsed
         let pcmChunk: Uint8Array;
         if (header === null) {
           headerBytes = headerBytes ? concat(headerBytes, value) : value;
           if (headerBytes.byteLength < 44) continue;
           header = parseRiffHeader(headerBytes);
           pcmChunk = headerBytes.subarray(header.pcmDataOffset);
           headerBytes = null;
         } else {
           pcmChunk = value;
         }
         if (pcmChunk.byteLength === 0) continue;
         scheduleChunk(pcmChunk, header, audioContext, () => onSourceEnded());
       }
       ```
    7. Wrap the whole loop in a try/catch. On catch: if `!stopped && !onErrorFired`, set `onErrorFired = true`, call internal `teardown()`, then `opts.onError?.(err instanceof Error ? err : new Error(String(err)))`.

    scheduleChunk helper (private inside the factory):
    ```
    function scheduleChunk(pcmChunk: Uint8Array, hdr: RiffHeader, ctx: AudioContext, onSourceEndedCb: () => void) {
      const channelData = decodePcmChunk(pcmChunk, hdr);
      if (channelData[0].length === 0) return;
      const buffer = ctx.createBuffer(hdr.channels, channelData[0].length, hdr.sampleRate);
      for (let ch = 0; ch < hdr.channels; ch++) buffer.getChannelData(ch).set(channelData[ch]);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = onSourceEndedCb;
      // If we're behind (nextStartTime <= currentTime), reset to now + epsilon to avoid stacking backlog
      if (nextStartTime < ctx.currentTime) nextStartTime = ctx.currentTime + 0.02;
      source.start(nextStartTime);
      nextStartTime += buffer.duration;
      sources.push(source);
    }
    ```

    onSourceEnded helper:
    ```
    function onSourceEnded() {
      endedSources += 1;
      maybeFireEnded();
    }

    function maybeFireEnded() {
      if (readerDone && endedSources >= sources.length && !onEndedFired && !stopped) {
        onEndedFired = true;
        teardown();
        opts.onEnded?.();
      }
    }
    ```

    teardown helper (called by stop() and by maybeFireEnded / error path):
    ```
    function teardown() {
      if (reader) {
        try { reader.cancel(); } catch { /* ignore */ }
        reader = null;
      }
      for (const s of sources) {
        try { s.stop(); } catch { /* already ended */ }
      }
      sources.length = 0;
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
      audioContext = null;
    }
    ```

    stop() implementation:
    ```
    function stop() {
      if (stopped) return;
      stopped = true;
      teardown();
    }
    ```

    concat helper (private):
    ```
    function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
      const out = new Uint8Array(a.byteLength + b.byteLength);
      out.set(a, 0);
      out.set(b, a.byteLength);
      return out;
    }
    ```

    Return the public object `{ play, stop }`.

    Type notes:
    - `RiffHeader` imported from `./riffPcmDecode`.
    - `ReadableStreamDefaultReader<Uint8Array>` is a global DOM type.
    - `AudioContext`, `AudioBufferSourceNode`, `AudioBuffer` are global DOM types.

    Length check: if the file exceeds ~180 lines, the planner's discretion allows leaving inline in ChatMessage.tsx per CONTEXT.md § Claude's Discretion — but the tests are much easier to write against an extracted module, so extraction is strongly preferred. Given the acceptance criteria below, extract as specified.

    Create `src/ui/features/pretty-view/webAudioStreamPlayer.test.ts`:

    Mock the AudioContext family via `vi.stubGlobal`. The mock needs to record calls to createBuffer, createBufferSource, source.start, source.stop, and provide a way to synthetically fire `source.onended`. Suggested shape:

    ```
    interface MockSource {
      buffer: any;
      onended: (() => void) | null;
      _started: boolean;
      _startedAt: number;
      _stopped: boolean;
      start(when: number): void;
      stop(): void;
      connect(dest: any): void;
    }

    let mockCtx: {
      currentTime: number;
      state: "running" | "closed";
      destination: object;
      sources: MockSource[];
      buffers: Array<{ channels: number; frames: number; sampleRate: number }>;
      createBuffer(ch: number, fr: number, sr: number): any;
      createBufferSource(): MockSource;
      close(): Promise<void>;
    };
    let ctxInstances: typeof mockCtx[] = [];

    beforeEach(() => {
      ctxInstances = [];
      vi.stubGlobal("AudioContext", class {
        constructor() {
          mockCtx = { /* factory that populates sources / buffers / etc */ };
          ctxInstances.push(mockCtx);
          return mockCtx;
        }
      });
    });
    ```

    Fetch chunks in tests: construct a mock Response via `new Response(new ReadableStream({...}))` with controllable enqueue timing. For simplicity, enqueue synchronously in one go:
    ```
    function makeMockResponse(chunks: Uint8Array[], ok = true, status = 200): Response {
      const stream = new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      });
      return new Response(stream, { status, headers: { "Content-Type": "audio/wav" } });
    }
    ```

    Helper to build a valid 44-byte RIFF header + some PCM:
    ```
    function makeWavChunk(pcmBytes: Uint8Array, opts = { channels: 1, sampleRate: 24000, bitDepth: 16 }): Uint8Array {
      // 44-byte header + pcmBytes
      const buf = new Uint8Array(44 + pcmBytes.byteLength);
      const dv = new DataView(buf.buffer);
      // "RIFF"
      buf.set([0x52, 0x49, 0x46, 0x46], 0);
      dv.setUint32(4, 0xFFFFFFFF, true); // streaming sentinel
      buf.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
      buf.set([0x66, 0x6D, 0x74, 0x20], 12); // "fmt "
      dv.setUint32(16, 16, true); // fmt chunk size
      dv.setUint16(20, 1, true); // PCM
      dv.setUint16(22, opts.channels, true);
      dv.setUint32(24, opts.sampleRate, true);
      dv.setUint32(28, opts.sampleRate * opts.channels * opts.bitDepth / 8, true);
      dv.setUint16(32, opts.channels * opts.bitDepth / 8, true);
      dv.setUint16(34, opts.bitDepth, true);
      buf.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
      dv.setUint32(40, 0xFFFFFFFF, true); // streaming sentinel
      buf.set(pcmBytes, 44);
      return buf;
    }
    ```

    Tests:

    - **Test 1 — play() calls createBuffer + createBufferSource on happy-path chunk**: Response containing one chunk (header + 4 bytes of PCM = 2 mono frames at 16-bit). Call `await player.play(response)` then flush microtasks. Assert `ctxInstances[0].buffers.length === 1`, buffer.channels === 1, buffer.frames === 2, buffer.sampleRate === 24000. Assert `sources.length === 1`, `sources[0]._started === true`, `sources[0]._startedAt >= ctx.currentTime`.

    - **Test 2 — play() schedules multiple chunks back-to-back**: Response with 3 chunks: [header + 4 PCM bytes], [4 more PCM bytes], [4 more PCM bytes]. Assert `sources.length === 3`. Assert start times are monotonically non-decreasing.

    - **Test 3 — play() fires onEnded after reader done AND all sources ended**: Set up an onEnded spy. Play a 1-chunk response. Reader closes; source has NOT yet fired onended → onEnded spy NOT called yet. Then manually call `mockCtx.sources[0].onended()`. Now `onEnded` spy should be called exactly once.

    - **Test 4 — stop() stops all sources and closes AudioContext**: Play a multi-chunk response. Before it fires onEnded, call `player.stop()`. Assert every source has `_stopped === true` and `mockCtx.state === "closed"` (or `close` was called). Assert calling `player.stop()` again is a no-op (idempotent).

    - **Test 5 — non-ok response fires onError, does NOT create AudioContext**: `makeMockResponse([], false, 503)`. Play. Assert onError called with an Error whose message contains "503". Assert `ctxInstances.length === 0` (no context ever created).

    - **Test 6 — mid-stream reader error fires onError**: Response body throws in the middle:
      ```
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(makeWavChunk(new Uint8Array([0,0,0,0])));
        },
        pull() { throw new Error("network blip"); },
      });
      ```
      Play. Assert onError called. Assert all created sources are stopped.

    - **Test 7 — split header across chunks (defensive)**: Chunks: [20 bytes of the header], [remaining 24 bytes + 4 PCM bytes]. Player must accumulate the header before parsing. Assert playback proceeds normally (`sources.length === 1`, correct sample rate).
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit</automated>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/webAudioStreamPlayer.test.ts 2>&1 | tail -40</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it(' src/ui/features/pretty-view/webAudioStreamPlayer.test.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -cE 'export (function|interface) (createWebAudioStreamPlayer|WebAudioStreamPlayer|WebAudioStreamPlayerOptions)' src/ui/features/pretty-view/webAudioStreamPlayer.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'parseRiffHeader\|decodePcmChunk' src/ui/features/pretty-view/webAudioStreamPlayer.ts</automated>
  </verify>

  <acceptance_criteria>
    - `npx vitest run src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` exits 0 with all 7 tests passing.
    - `grep -c 'it(' src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` >= 7.
    - `grep` for factory + interfaces finds all three: `createWebAudioStreamPlayer`, `WebAudioStreamPlayer`, `WebAudioStreamPlayerOptions` (count >= 3).
    - `grep -c 'parseRiffHeader\|decodePcmChunk' src/ui/features/pretty-view/webAudioStreamPlayer.ts` >= 2 (proves the pure functions are used, not re-implemented).
    - `tsc --noEmit` exits 0.
    - Player file does NOT import from `ChatMessage.tsx` (dependency arrow goes ChatMessage → player, not back).
    - Test 3 explicitly proves onEnded fires ONLY after both reader-done AND all sources ended (the two-condition gate).
    - Test 4 explicitly proves stop() is idempotent.
    - Test 5 explicitly proves the guard against creating an AudioContext on non-ok response (resource-leak prevention).
  </acceptance_criteria>

  <done>
    `webAudioStreamPlayer.ts` exports `createWebAudioStreamPlayer` factory and the two interface types. The factory encapsulates AudioContext + running-clock scheduling + reader loop + teardown; imports pure decoders from `riffPcmDecode.ts`. 7 unit tests pass with a mocked AudioContext, covering happy path, multi-chunk scheduling, onEnded gating, stop() idempotency, non-ok guard, mid-stream error teardown, and split-header accumulation.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Swap ChatMessage.tsx speak handler + adapt singleton + add state-machine tests</name>
  <files>src/ui/features/pretty-view/ChatMessage.tsx, src/ui/features/pretty-view/ChatMessage.test.tsx</files>

  <read_first>
    - `src/ui/features/pretty-view/ChatMessage.tsx` in full (309 lines) — you MUST see the EXACT existing shape of the module-level singleton (L12-14: `currentAudio`, `currentAudioUrl`, `currentAudioOwner`), the cleanup useEffect (L60-70), and the onSpeakClick handler (L72-125). Task 3 replaces these three regions and NOTHING else.
    - `src/ui/features/pretty-view/webAudioStreamPlayer.ts` (created in Task 2) — the factory API this task consumes.
    - `src/ui/api/voice-api.ts` (updated in Plan 03) — `postSpeakStream` is the fetch call replacing `postSpeak` inside onSpeakClick.
    - `src/ui/features/pretty-view/ChatMessage.test.tsx` in full (169 lines) — you MUST see the EXACT existing test names and count so you can (a) confirm those tests still pass unmodified after your changes and (b) add new tests without breaking the file's structure OR colliding with existing test numbers. The file currently contains **11 `it(...)` tests**: Test 9, Test 10, Test 11, Test 12, Test 13 (Phase 05 chip-render), Test 14 + Test 14b + Test 14c (patch #107 quick-reply thumbs-up variants), and Test G + Test H + Test I (copy-button behaviors in a second describe block). Your new tests MUST use unused numbers — Tests 18, 19, 20, 21 (this plan) — to avoid duplicate `it(...)` names that vitest treats as ambiguous or double-runs. Do NOT delete, rename, or reorder any of the 11 pre-existing tests.
    - `src/ui/features/pretty-view/IdentityModal.tsx:783` — `postSpeak(SAMPLE_PHRASE, voiceDraft || undefined)` — MUST remain unchanged. Grep-verifiable.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Cross-bubble Stop / new-bubble-preempt semantics (the state-transition spec).
  </read_first>

  <behavior>
    - Clicking speak on an assistant bubble transitions state: idle → loading → playing → idle (icon changes visible to the user)
    - Clicking speak while already loading is a no-op (guard); alternatively acceptable: treated as "stop current, do nothing else" — mirror the current behavior which does NOT explicitly guard loading (current onSpeakClick can be spammed during loading — preserve that observable behavior or explicitly improve it, planner's discretion but document choice in code comment)
    - Clicking speak on bubble A while bubble B is currently playing: bubble B's singleton is stopped (WebAudioStreamPlayer.stop()) BEFORE bubble A starts its fetch — no overlapping audio
    - Clicking the speak icon on the currently-playing bubble stops playback and returns state to idle (same-bubble stop, mirrors L76-84 current behavior)
    - Player onEnded callback transitions state back to idle and clears the singleton (only if this bubble still owns the singleton — guard against a race where a new bubble already took ownership)
    - Player onError callback transitions state back to idle without an alert/toast dialog (CONTEXT.md accepted tradeoff — no auto-toast integration). A `console.error(err)` is acceptable for observability
    - Unmount cleanup fires stop() on the singleton if this bubble owns it (mirrors current useEffect L60-70)
    - IdentityModal voice-preview surface is UNCHANGED — grep verifies `postSpeak(SAMPLE_PHRASE, ...)` call in IdentityModal.tsx:783 still exists
    - All 11 pre-existing ChatMessage.test.tsx tests still pass unmodified — Tests 9, 10, 11, 12, 13 (chip-render), Tests 14, 14b, 14c (quick-reply), Tests G, H, I (copy-button) — regression guard
  </behavior>

  <action>
    Modify `src/ui/features/pretty-view/ChatMessage.tsx`:

    **Step 1 — Change the import at L10** from `import { postSpeak } from "@/api/voice-api";` to `import { postSpeakStream } from "@/api/voice-api";`.

    **Step 2 — Add import for the player** at the top imports block: `import { createWebAudioStreamPlayer, type WebAudioStreamPlayer } from "./webAudioStreamPlayer";`.

    **Step 3 — Replace the module-level singleton** (currently L12-14):
    Old:
    ```
    let currentAudio: HTMLAudioElement | null = null;
    let currentAudioUrl: string | null = null;
    let currentAudioOwner: symbol | null = null;
    ```
    New:
    ```
    // Patch #237 (Phase 19): singleton now tracks a WebAudioStreamPlayer instance
    // instead of an HTMLAudioElement. The player encapsulates the AudioContext,
    // scheduled AudioBufferSourceNodes, and the fetch reader loop. See
    // ./webAudioStreamPlayer.ts. Cross-bubble Stop / new-bubble-preempt semantics
    // preserved: starting on bubble A while bubble B plays stops B first;
    // clicking Stop on the playing bubble stops it; unmount cleanup stops if
    // this bubble owns the singleton.
    let currentPlayer: WebAudioStreamPlayer | null = null;
    let currentOwner: symbol | null = null;
    ```

    **Step 4 — Replace the cleanup useEffect** (currently L60-70):
    Old:
    ```
    useEffect(() => {
      return () => {
        if (currentAudioOwner === bubbleIdRef.current) {
          currentAudio?.pause();
          if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
          currentAudio = null;
          currentAudioUrl = null;
          currentAudioOwner = null;
        }
      };
    }, []);
    ```
    New:
    ```
    useEffect(() => {
      return () => {
        if (currentOwner === bubbleIdRef.current) {
          currentPlayer?.stop();
          currentPlayer = null;
          currentOwner = null;
        }
      };
    }, []);
    ```

    **Step 5 — Replace onSpeakClick body** (currently L72-125). Preserve the function signature (`async function onSpeakClick(e: React.MouseEvent)`), the `e.stopPropagation()` call, and the state-machine transitions. The rewrite:
    ```
    async function onSpeakClick(e: React.MouseEvent) {
      e.stopPropagation();

      // If this bubble is currently playing, stop it (same-bubble stop).
      if (speakState === "playing" && currentOwner === bubbleIdRef.current) {
        currentPlayer?.stop();
        currentPlayer = null;
        currentOwner = null;
        setSpeakState("idle");
        return;
      }

      // If another bubble is playing (or loading), stop it first (cross-bubble preempt).
      if (currentPlayer) {
        currentPlayer.stop();
        currentPlayer = null;
        currentOwner = null;
      }

      setSpeakState("loading");
      const owner = bubbleIdRef.current;

      const player = createWebAudioStreamPlayer({
        onEnded: () => {
          // Only clear if this bubble still owns the singleton — guard against
          // a race where a NEW speak-click already replaced the singleton
          // (setSpeakState on the OLD bubble would flash "idle" briefly and
          // race the new bubble's "loading" render).
          if (currentOwner === owner) {
            currentPlayer = null;
            currentOwner = null;
            setSpeakState("idle");
          }
        },
        onError: (err) => {
          // Patch #237: accepted tradeoff per 19-CONTEXT.md § Error handling —
          // no auto-toast on streaming errors. Log for observability; UI
          // recovers by returning to idle so the user can retry.
          console.error("[postSpeakStream] player error:", err);
          if (currentOwner === owner) {
            currentPlayer = null;
            currentOwner = null;
            setSpeakState("idle");
          }
        },
      });

      // Install the singleton BEFORE the fetch so a same-tick preempt from
      // another bubble sees a non-null currentPlayer and can stop us cleanly.
      currentPlayer = player;
      currentOwner = owner;

      try {
        const text = containerRef.current?.innerText ?? content;
        const response = await postSpeakStream(text, identityVoice ?? undefined);
        // Race check: if another bubble preempted us during the fetch,
        // currentOwner has changed. Bail out before scheduling any audio.
        if (currentOwner !== owner) return;
        if (!response.ok) throw new Error(`postSpeakStream returned ${response.status}`);
        setSpeakState("playing");
        // Fire-and-forget: play() drives its own read loop; we hear the callbacks.
        void player.play(response);
      } catch (err) {
        console.error("[postSpeakStream] fetch error:", err);
        if (currentOwner === owner) {
          currentPlayer = null;
          currentOwner = null;
          setSpeakState("idle");
        }
      }
    }
    ```

    Do NOT modify any other part of ChatMessage.tsx — the JSX (L160-307), the injected-turn detection (L138-153), the quick-reply detection (L147-153), the ThumbsUp render, the AttachmentChipStrip render, the speak button JSX (L274-304), the Loader2/Volume2 icons, the identity-hue Glass treatment classes — all UNTOUCHED.

    Modify `src/ui/features/pretty-view/ChatMessage.test.tsx`:

    Preserve every existing test (Tests 9-13 minimum — read the full file to see the exact count and names, do not delete or restructure them). Add a new `describe("ChatMessage speak state machine (Phase 19 / patch #237)", () => { ... })` block after the existing describe block(s). To make these tests deterministic, mock the `webAudioStreamPlayer` module and the `voice-api` module.

    New tests:

    - **Test 18 — clicking speak transitions loading → playing on successful response**:
      Mock `postSpeakStream` to return `new Response(new ReadableStream({...}), { status: 200 })`.
      Mock `createWebAudioStreamPlayer` to return a `{ play: vi.fn(), stop: vi.fn() }` mock, but do NOT invoke callbacks from within the mock.
      Render `<ChatMessage role="assistant" content="hello" />`.
      Find the speak button (`aria-label="Speak message"`), click it.
      Assert the button's aria-label transitions to "Stop speaking" (proves state moved to "playing").
      Assert the Loader2 spinner appeared during the loading window (may be too fast to observe reliably; alternative assertion: `mockPlay` was called with the response object).

    - **Test 19 — clicking speak on a currently-playing bubble stops it**:
      Set up: first click puts state in "playing" (as above).
      Click the same button again.
      Assert the mocked player's `stop()` was called.
      Assert the button's aria-label reverts to "Speak message".

    - **Test 20 — mocked player onError callback reverts state to idle**:
      Mock createWebAudioStreamPlayer to CAPTURE the onError callback (store it in a test-scope variable when the mock is invoked): `let capturedOnError: ((err: Error) => void) | undefined; createWebAudioStreamPlayer = vi.fn((opts) => { capturedOnError = opts.onError; return { play: vi.fn(), stop: vi.fn() }; });`.
      Click speak; wait for postSpeakStream to resolve and state to become "playing".
      Call `capturedOnError?.(new Error("mid-stream blip"));` inside `act(() => ...)`.
      Assert the button's aria-label reverts to "Speak message" (state === "idle").

    - **Test 21 — non-ok response from postSpeakStream reverts state to idle**:
      Mock `postSpeakStream` to return `new Response(null, { status: 503 })`.
      Click speak. Await pending microtasks.
      Assert the button's aria-label is "Speak message" (state ended at "idle" — the try/catch caught the `!response.ok` throw).
      Assert the mocked player's `play` was NOT called (fast-fail happened before player.play).

    Mock setup guidance for tests:
    ```
    import { vi } from "vitest";

    vi.mock("@/api/voice-api", () => ({
      postSpeakStream: vi.fn(),
      SAMPLE_PHRASE: "Hi, this is your voice.",
    }));

    vi.mock("./webAudioStreamPlayer", () => ({
      createWebAudioStreamPlayer: vi.fn(),
    }));

    beforeEach(() => {
      // Reset mocks so per-test setup is deterministic.
      vi.clearAllMocks();
    });
    ```
    Import the mocked functions with `import { postSpeakStream } from "@/api/voice-api"; import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";` and cast to `vi.MockedFunction<typeof postSpeakStream>` for type-safe stubbing.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit</automated>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx 2>&1 | tail -40</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'postSpeakStream' src/ui/features/pretty-view/ChatMessage.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'postSpeak\b' src/ui/features/pretty-view/ChatMessage.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'createWebAudioStreamPlayer\|WebAudioStreamPlayer' src/ui/features/pretty-view/ChatMessage.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'HTMLAudioElement\|URL\.createObjectURL\|URL\.revokeObjectURL\|new Audio(' src/ui/features/pretty-view/ChatMessage.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'postSpeak(SAMPLE_PHRASE' src/ui/features/pretty-view/IdentityModal.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it("Test 9\|it("Test 10\|it("Test 11\|it("Test 12\|it("Test 13' src/ui/features/pretty-view/ChatMessage.test.tsx</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it("Test 1[4-7]' src/ui/features/pretty-view/ChatMessage.test.tsx</automated>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/ 2>&1 | tail -20</automated>
    <automated>cd /home/ubuntu/skynet && npm run build 2>&1 | tail -15</automated>
  </verify>

  <acceptance_criteria>
    - `tsc --noEmit` exits 0.
    - `npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx` exits 0 with all 11 pre-existing tests (Tests 9, 10, 11, 12, 13, 14, 14b, 14c, G, H, I) still passing AND all 4 new tests (18, 19, 20, 21) passing.
    - `grep -c 'postSpeakStream' src/ui/features/pretty-view/ChatMessage.tsx` >= 2 (import + call).
    - `grep -c 'postSpeak\b' src/ui/features/pretty-view/ChatMessage.tsx` = 0 (old buffered import removed; `\b` excludes `postSpeakStream`).
    - `grep -c 'createWebAudioStreamPlayer\|WebAudioStreamPlayer' src/ui/features/pretty-view/ChatMessage.tsx` >= 2 (import + call/type).
    - `grep -c 'HTMLAudioElement\|URL\.createObjectURL\|URL\.revokeObjectURL\|new Audio(' src/ui/features/pretty-view/ChatMessage.tsx` = 0 (old buffered-path artifacts fully removed).
    - `grep -c 'postSpeak(SAMPLE_PHRASE' src/ui/features/pretty-view/IdentityModal.tsx` = 1 (IdentityModal voice-preview UNCHANGED — regression guard for TTSSTR-07 preservation).
    - **Total-count preservation guard:** `grep -c '^  it(' src/ui/features/pretty-view/ChatMessage.test.tsx` = **15** (11 pre-existing + 4 new). If this count is 14 or lower, a pre-existing test was deleted; if 16 or higher, a duplicate `it(...)` name was introduced. Executor MUST record the pre-count from the initial file read in the summary for a delta check.
    - **Per-name preservation guard:** `grep -cE 'it\("Test (9|10|11|12|13|14|14b|14c|[GHI])' src/ui/features/pretty-view/ChatMessage.test.tsx` = **11** (every pre-existing test name is still literally present in the file — catches renames as well as deletes).
    - **New-tests-present guard:** `grep -c 'it("Test 1[8-9]\|it("Test 2[0-1]' src/ui/features/pretty-view/ChatMessage.test.tsx` = **4** (Tests 18, 19, 20, 21 added; no accidental reuse of Test 14/15/16/17 which would collide with pre-existing Test 14 / 14b / 14c).
    - **No test-number collision guard:** `grep -cE 'it\("Test 1[4-7]' src/ui/features/pretty-view/ChatMessage.test.tsx` = **3** (matches ONLY pre-existing Test 14, 14b, 14c — proves the new tests did NOT reuse 14/15/16/17 as originally drafted).
    - `npx vitest run src/ui/features/pretty-view/` (full directory) — every existing test in the directory passes (regression-free across all pretty-view components).
    - `npm run build` exits 0 (Vite bundling regression guard — catches missing peer deps, dynamic-import shape issues, or module-resolution errors in `riffPcmDecode.ts` / `webAudioStreamPlayer.ts` at wave-3 execute time rather than surfacing them in Plan 05's ship-prep build).
  </acceptance_criteria>

  <done>
    ChatMessage.tsx uses `postSpeakStream` and `createWebAudioStreamPlayer` in place of `postSpeak` and `HTMLAudioElement`; the module-level singleton is adapted to track a WebAudioStreamPlayer instance; the observable state machine (idle/loading/playing icon transitions) is preserved; cross-bubble Stop / new-bubble-preempt / same-bubble-Stop / unmount-cleanup semantics all mirror the original patch #223 behavior. IdentityModal.tsx:783 is untouched. All 11 pre-existing ChatMessage.test.tsx tests (Tests 9, 10, 11, 12, 13, 14, 14b, 14c, G, H, I) still pass; 4 new tests (Tests 18, 19, 20, 21) cover the state machine transitions and error paths. Full pretty-view test suite green. `npm run build` passes (Vite bundling regression guard).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user click → ChatMessage.onSpeakClick → postSpeakStream | User-initiated, JWT-gated backend call. No new attack surface. |
| Response body → WebAudioStreamPlayer → AudioContext | Untrusted bytes over trusted channel; treated as PCM data. AudioBuffer.getChannelData is safe from malformed data — worst case is buzzing noise, not code execution. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-C01 | Tampering | Malformed WAV response causes decoder to allocate huge AudioBuffer | mitigate | `parseRiffHeader` extracts sampleRate/channels/bitDepth from the first 44 bytes only. `decodePcmChunk` allocates one Float32Array per input chunk with size proportional to chunk size (bounded by upstream chunked-transfer chunk size ~KB-scale). No allocation is proportional to a length-field from the response body (the streaming sentinel `0xFFFFFFFF` for the fake "file size" is IGNORED, not used as an allocation input). Backend AbortController caps total upstream time at 300s. |
| T-19-C02 | Denial of Service | Adversarial upstream never sends 44 bytes | mitigate | Backend authenticates upstream URL (100.80.122.111:8001/tts is a trusted tailnet peer). Frontend player accumulates bytes without a self-imposed cap for the header — but the backend AbortController + reader loop terminates when upstream closes/aborts. Worst case: player holds ~50 bytes indefinitely; browser tab uses trivial memory. |
| T-19-C03 | Information Disclosure | Web Audio API side-channel timing attack | accept | AudioContext scheduling is subject to browser high-resolution-timer mitigations already in place (Cross-Origin-Isolation, timer coarsening). Skynet does not host cross-origin content; standard posture. |
| T-19-C04 | Denial of Service | Rapid speak-button spam creates many AudioContexts | mitigate | Each new speak invocation stops the previous singleton BEFORE creating a new player. The player's teardown closes AudioContext. Same posture as pre-Phase-19 (which created a new HTMLAudioElement per click). |
| T-19-C05 | Elevation of Privilege | Malicious voice_hint from identity somehow injects into player | mitigate | `identityVoice` is validated backend-side by `VOICE_FILENAME_RE` (`/^[A-Z][A-Za-z]+\.wav$/`) — 400 rejected if invalid. Frontend passes it through untransformed. No code-path where identityVoice reaches a `eval`, `Function()`, or DOM insertion — it's a JSON field only. |
| T-19-C06 | Repudiation | User claims audio played that didn't | accept | No audit-log requirement in Skynet; matches pre-Phase-19 posture. |
| T-19-C07 | Spoofing | Fake postSpeakStream module intercepts fetch | mitigate | Same-origin same-bundle module resolution. Frontend build is served by nginx from the container image; supply-chain integrity is the docker image build's responsibility. No inline eval, no dynamic import from external URLs. |
| T-19-SC | Tampering | Package installs | accept | No new npm packages installed by this plan (uses vitest and Web Audio API globals only). |
</threat_model>

<verification>
Run at plan completion:
1. `cd /home/ubuntu/skynet && npx tsc --noEmit` — clean across the whole repo.
2. `cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/` — every test in the pretty-view directory passes (both new Phase 19 tests AND all pre-existing Phase 05 sender-side chip tests + any others in the dir).
3. `cd /home/ubuntu/skynet && npx vitest run src/ui/api/voice-api.test.ts src/backend/database/routes/voice.test.ts src/ui/features/pretty-view/riffPcmDecode.test.ts src/ui/features/pretty-view/webAudioStreamPlayer.test.ts src/ui/features/pretty-view/ChatMessage.test.tsx` — all Phase 19 tests plus dependent-file regressions pass in one run.
4. `grep -c 'postSpeak(SAMPLE_PHRASE' src/ui/features/pretty-view/IdentityModal.tsx` = 1 (IdentityModal unchanged — TTSSTR-07 preservation guard).
5. `grep -c 'HTMLAudioElement\|URL\.createObjectURL' src/ui/features/pretty-view/ChatMessage.tsx` = 0 (old buffered-path artifacts fully removed from the streaming caller).
6. `grep -c 'postSpeak\b' src/ui/features/pretty-view/ChatMessage.tsx` = 0 (old import removed).
</verification>

<success_criteria>
Requirements satisfied by this plan:
- TTSSTR-05: ChatMessage.tsx speak-button handler is Web Audio API progressive decode — `postSpeakStream()` → `response.body.getReader()` loop → RIFF header parse → per-PCM-chunk `AudioBuffer` allocation → `AudioBufferSourceNode` scheduling via running `nextStartTime` clock so consecutive chunks play back-to-back gaplessly. Audio starts BEFORE synthesis completes.
- TTSSTR-06: Cross-bubble Stop / new-bubble-preempt semantics preserved via adapted module-level singleton tracking `WebAudioStreamPlayer` instance. Starting a new bubble stops the previous player's sources + reader + AudioContext. Error handling: fetch and mid-stream errors abort scheduled sources + close context + revert state to idle without ugly click or trailing audio. Losing the `dbHealthMonitor.isBackendUnreachable` auto-toast on streaming path is accepted (documented in code comment).
</success_criteria>

<output>
Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-04-SUMMARY.md` when done, using the template. Summary must include:
- All test counts (riffPcmDecode: 10, webAudioStreamPlayer: 7, ChatMessage new: 4, ChatMessage preserved: 5+ (Tests 9-13)).
- Confirmation that IdentityModal.tsx:783 still calls `postSpeak(SAMPLE_PHRASE, ...)` unchanged.
- Confirmation that `HTMLAudioElement`, `URL.createObjectURL`, `URL.revokeObjectURL`, `new Audio(` do NOT appear in ChatMessage.tsx (grep counts = 0).
- The Nelly-demo view-source URL was fetched and the RIFF/scheduling pattern was lifted per her permission.
- Any deviation from CONTEXT.md spec (there should be none; document in Plan 05 patch note if any).
</output>
