---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/voice.ts
  - src/backend/database/routes/voice.test.ts
autonomous: true
requirements:
  - TTSSTR-01
  - TTSSTR-02
  - TTSSTR-07
tags:
  - backend
  - streaming
  - tts
  - voice
  - node-stream
  - jwt

must_haves:
  truths:
    - "POST /voice/speak-stream returns HTTP 200 with Content-Type: audio/wav and X-Accel-Buffering: no when Chatterbox returns 200"
    - "handleSpeakStream pipes upstream response body to the Express res object without ever calling arrayBuffer/text/blob on the upstream response (grep-verifiable)"
    - "Missing or empty body.text returns 400; body.text over SPEAK_TEXT_MAX returns 400; body.voice not matching VOICE_FILENAME_RE returns 400"
    - "Chatterbox request body is exactly {text, voice_mode:'predefined', predefined_voice_id: voice ?? 'Elena.wav', stream:true, split_text:true, chunk_size:80}"
    - "Chatterbox request URL is http://100.80.122.111:8001/tts (not /v1/audio/speech)"
    - "Non-2xx upstream returns fixed {error:'TTS stream non-2xx', status:<upstream.status>} — no upstream body leak (T-16-03)"
    - "AbortController with 300_000 ms timeout wraps the upstream fetch; AbortError returns 504 {error:'TTS stream timeout', status:504}"
    - "Any other exception returns 502 {error:'TTS stream proxy error', status:502}"
    - "Route is wired with authenticateJWT before express.json body parser (T-16-04 pattern from handleTranscribe/handleSpeak)"
    - "Existing handleSpeak function body is untouched (byte-for-byte) — new handler is additive"
  artifacts:
    - path: src/backend/database/routes/voice.ts
      provides: "handleSpeakStream exported function + POST /speak-stream route wired on the existing router"
      contains: "export async function handleSpeakStream"
    - path: src/backend/database/routes/voice.test.ts
      provides: "Unit tests for handleSpeakStream mirroring the handleSpeak Test A-H shape"
      contains: "describe(\"handleSpeakStream\""
  key_links:
    - from: "src/backend/database/routes/voice.ts:handleSpeakStream"
      to: "http://100.80.122.111:8001/tts"
      via: "fetch() with AbortController and JSON body"
      pattern: "100\\.80\\.122\\.111:8001/tts"
    - from: "src/backend/database/routes/voice.ts:handleSpeakStream"
      to: "res (Express Response)"
      via: "Readable.fromWeb(response.body).pipe(res)"
      pattern: "Readable\\.fromWeb\\(.*\\)\\.pipe\\(res\\)"
    - from: "router.post(\"/speak-stream\", ...)"
      to: "authenticateJWT middleware"
      via: "middleware chain before express.json()"
      pattern: "\"/speak-stream\",\\s*authenticateJWT"
---

<objective>
Add a new `POST /voice/speak-stream` backend route on the existing Skynet Express server (port 30001) that reverse-proxies the tailnet Chatterbox `/tts` streaming endpoint by piping chunks through to the browser WITHOUT server-side buffering — implementing TTSSTR-01, TTSSTR-02, and the security-parity half of TTSSTR-07. The existing `POST /voice/speak` (patch #223, buffered) handler stays byte-for-byte untouched; IdentityModal voice-preview continues to call it.

Purpose: Replace the "audio starts only after full WAV bytes are buffered on the server" latency with "audio starts within ~30ms of the click" by preserving Chatterbox's chunked-transfer streaming end-to-end.

Output:
- `handleSpeakStream(req, res): Promise<void>` in `src/backend/database/routes/voice.ts` (mirrors the structure of `handleSpeak` L128-199 but replaces the arrayBuffer+end block with `Readable.fromWeb(response.body).pipe(res)`).
- `POST /speak-stream` route wired via the same middleware pattern as `POST /speak` — `authenticateJWT` → `express.json({limit:"64kb"})` → handler.
- `describe("handleSpeakStream")` block in `voice.test.ts` covering the eight critical behaviors (body validation × 3, Chatterbox body-schema translation, pipe-through happy path, non-2xx no-body-leak, AbortError timeout, generic exception proxy error).

Non-negotiables (from 19-CONTEXT.md § Backend route shape + § Security parity, and TTSSTR-01/02/07):
- The buffered `handleSpeak` and `POST /speak` route are PRESERVED byte-for-byte.
- `arrayBuffer()` / `.text()` / `.blob()` MUST NOT appear anywhere inside `handleSpeakStream`.
- Default voice stays `Elena.wav` (reuse the existing `DEFAULT_VOICE` constant).
- Upstream URL is `http://100.80.122.111:8001/tts` (NOT `/v1/audio/speech`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
@CLAUDE.md
@src/backend/database/routes/voice.ts
@src/backend/database/routes/voice.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add handleSpeakStream export + POST /speak-stream route to voice.ts</name>
  <files>src/backend/database/routes/voice.ts</files>

  <read_first>
    - `src/backend/database/routes/voice.ts` in full — you MUST see the exact structure of `handleSpeak` (L128-199) that this task mirrors, plus the existing `DEFAULT_VOICE`, `SPEAK_TEXT_MAX`, `VOICE_FILENAME_RE` constants (L29-32), the `authenticateJWT` middleware setup (L36-37), and the existing `POST /speak` router wiring (L256-263).
    - `src/backend/database/routes/voice.test.ts` L84-95 (the `makeTtsFetchResponse` helper) — Task 2 will extend this helper for streaming; understanding the current shape prevents you from redesigning it needlessly.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Backend route shape, § Request body schema translation, § Security parity — the exact request body schema translation table and error-shape strings are LOCKED there.
    - `.planning/REQUIREMENTS.md` § Streaming TTS Output — TTSSTR-01, TTSSTR-02, TTSSTR-07 (the exact wording of these requirements).
    - `CLAUDE.md` (root) — nginx caveat + deploy safety asymmetry (context for why this route is additive-only).
  </read_first>

  <behavior>
    - handleSpeakStream returns 400 on missing/empty body.text (mirrors handleSpeak Test A/A2)
    - handleSpeakStream returns 400 on body.text.length > SPEAK_TEXT_MAX (mirrors Test B)
    - handleSpeakStream returns 400 on invalid body.voice format (mirrors Test C)
    - handleSpeakStream POSTs to http://100.80.122.111:8001/tts with the Chatterbox body schema on happy path
    - handleSpeakStream pipes response body via Readable.fromWeb(...).pipe(res) — no arrayBuffer
    - handleSpeakStream sets response headers Content-Type: audio/wav and X-Accel-Buffering: no BEFORE the pipe starts (headers must be flushed before body bytes)
    - handleSpeakStream returns 504 {error:"TTS stream timeout", status:504} on AbortError
    - handleSpeakStream returns 502 {error:"TTS stream proxy error", status:502} on other exceptions
    - handleSpeakStream returns {error:"TTS stream non-2xx", status:<upstream.status>} without body leak on non-2xx upstream
  </behavior>

  <action>
    Add ONE new exported function `handleSpeakStream(req: Request, res: Response): Promise<void>` to `src/backend/database/routes/voice.ts`, placed AFTER the existing `handleSpeak` function (approximately after line 199, before the `handleListVoices` function). Then add ONE new router.post entry after the existing `/speak` route wiring (approximately after line 263, before the `/voices` GET route).

    Follow the exact structural pattern of handleSpeak (voice.ts L128-199), replacing ONLY the parts that must change for streaming:

    Structural elements to REPLICATE verbatim from handleSpeak:
    - The three body-validation blocks (a) body.text is required non-empty string → 400; (b) body.text.length > SPEAK_TEXT_MAX → 400; (c) body.voice if provided must match VOICE_FILENAME_RE → 400. Use the EXACT same error message strings as handleSpeak so error UX is unified.
    - The `const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 300_000);` pattern.
    - The `try { ... } catch (err: unknown) { clearTimeout(timeoutId); ... }` shape.
    - The AbortError → 504 branch shape (change error string to "TTS stream timeout", status stays 504).
    - The catch-all → 502 branch shape (change error string to "TTS stream proxy error", status stays 502).
    - The `databaseLogger.error(...)` call inside each catch branch (change operation strings to `voice_speak_stream_timeout` and `voice_speak_stream_proxy` respectively).

    Structural elements to REPLACE:
    - Change the fetch URL from `TTS_URL` to a new module-level constant `TTS_STREAM_URL = "http://100.80.122.111:8001/tts"` (define this constant near line 27 alongside TTS_URL — do NOT modify TTS_URL).
    - Change the fetch body from `{model:"tts-1", input, voice}` to the Chatterbox streaming schema per 19-CONTEXT.md § Request body schema translation:
      keys: `text` (from req.body.text), `voice_mode` ("predefined"), `predefined_voice_id` (req.body.voice ?? DEFAULT_VOICE), `stream` (true), `split_text` (true), `chunk_size` (80). Serialize with JSON.stringify. Content-Type header stays `application/json`.
    - Change the non-2xx error string to `"TTS stream non-2xx"` (analog to `"TTS non-2xx"` in handleSpeak).
    - REPLACE the entire success-branch block `const buf = Buffer.from(await response.arrayBuffer()); res.status(200).set("Content-Type", "audio/wav"); res.end(buf); return res;` with the streaming pipe pattern:
      1. Guard against a missing body: if `!response.body` throw a new Error to fall into the 502 branch.
      2. Set response headers BEFORE the pipe starts: `res.status(200); res.setHeader("Content-Type", "audio/wav"); res.setHeader("X-Accel-Buffering", "no");`
      3. Bridge WHATWG ReadableStream to Node stream and pipe: `const { Readable } = await import("node:stream"); Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);` (dynamic import keeps the module top-level dependency graph unchanged; you may also add a top-of-file `import { Readable } from "node:stream";` and skip the dynamic form — either is acceptable as long as no `arrayBuffer` / `.text()` / `.blob()` appears).
      4. Return `undefined` (Promise<void>) — do NOT await the pipe; the pipe writes chunks to res as they arrive; res.end is called by the stream on upstream close.

    Router wiring: `router.post("/speak-stream", authenticateJWT, express.json({ limit: "64kb" }), (req, res) => { void handleSpeakStream(req, res); });`

    Change signature difference from handleSpeak: handleSpeak returns `Promise<Response>` and its handler always calls `return res.status(...).json(...)`. For handleSpeakStream, the streaming success path cannot return the Response object because the pipe is fire-and-forget — the return type is `Promise<void>` and error branches still `return res.status(...).json(...); return;` before falling out. Alternatively keep the return type `Promise<Response | void>` if it simplifies TypeScript inference — planner's discretion, but strict-mode compilation with `tsc --noEmit` MUST pass.

    Notes:
    - The new `TTS_STREAM_URL` constant is separate from the existing `TTS_URL` (used by handleSpeak). Do NOT rename or remove TTS_URL — the two routes coexist per TTSSTR-07.
    - `DEFAULT_VOICE`, `SPEAK_TEXT_MAX`, `VOICE_FILENAME_RE` are reused as-is; do not duplicate them.
    - `authenticateJWT` is the same middleware factory instance used by `/speak` and `/transcribe` — do NOT create a second `AuthManager.getInstance().createAuthMiddleware()` call.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit && npx vitest run src/backend/database/routes/voice.test.ts 2>&1 | tail -30</automated>
    <automated>cd /home/ubuntu/skynet && grep -v '^\s*//' src/backend/database/routes/voice.ts | awk '/export async function handleSpeakStream/,/^}/' | grep -cE '\.(arrayBuffer|text|blob)\(\)' && echo "ARRAYBUFFER_LEAK_DETECTED" || echo "OK: no server-side buffering inside handleSpeakStream"</automated>
    <automated>cd /home/ubuntu/skynet && grep -q 'Readable\.fromWeb' src/backend/database/routes/voice.ts && grep -q '100\.80\.122\.111:8001/tts' src/backend/database/routes/voice.ts && grep -q 'X-Accel-Buffering' src/backend/database/routes/voice.ts && grep -q '"/speak-stream"' src/backend/database/routes/voice.ts && grep -q 'authenticateJWT,\s*express\.json' src/backend/database/routes/voice.ts && echo "OK: streaming route wired" || echo "FAIL: missing streaming route wiring"</automated>
    <automated>cd /home/ubuntu/skynet && git diff --unified=0 src/backend/database/routes/voice.ts | awk '/^@@/{h=$0; next} /^-/ && !/^---/ {print h; print}' | grep -E '^-\s*(export async function handleSpeak\b|const TTS_URL|const DEFAULT_VOICE|const SPEAK_TEXT_MAX|VOICE_FILENAME_RE|router\.post\("/speak"|await response\.arrayBuffer\(\)|res\.end\(buf\))' && echo "REGRESSION: existing handleSpeak/routes/constants were modified" || echo "OK: handleSpeak preserved byte-for-byte"</automated>
  </verify>

  <acceptance_criteria>
    - `tsc --noEmit` exits 0 (no TypeScript regressions repo-wide).
    - `grep -c 'export async function handleSpeakStream' src/backend/database/routes/voice.ts` = 1.
    - `grep -c 'export async function handleSpeak\b' src/backend/database/routes/voice.ts` = 1 (existing handleSpeak still present; the `\b` word-boundary excludes handleSpeakStream).
    - `grep -c '\.arrayBuffer()\|\.blob()\|\.text()' src/backend/database/routes/voice.ts` within the handleSpeakStream function body (extracted via awk-between-braces) = 0. Verification command shown above uses awk to bracket the extract; `grep -c` on the extracted body must return 0.
    - `grep -c 'Readable\.fromWeb' src/backend/database/routes/voice.ts` >= 1.
    - `grep -c '100\.80\.122\.111:8001/tts' src/backend/database/routes/voice.ts` >= 1 (may match the constant declaration line only; that is sufficient).
    - `grep -c 'X-Accel-Buffering' src/backend/database/routes/voice.ts` >= 1.
    - `grep -c 'router\.post("/speak-stream"' src/backend/database/routes/voice.ts` = 1.
    - `git diff --unified=0 src/backend/database/routes/voice.ts` shows NO deleted lines (`-` prefix, excluding `---` diff headers) matching any of: `export async function handleSpeak\b`, `const TTS_URL`, `router.post("/speak"`, `await response.arrayBuffer()`, `res.end(buf)`. Only additions permitted for existing handleSpeak surface.
    - New `TTS_STREAM_URL` constant is grep-findable: `grep -c 'TTS_STREAM_URL' src/backend/database/routes/voice.ts` >= 2 (declaration + one use inside handleSpeakStream).
  </acceptance_criteria>

  <done>
    Executor has added `handleSpeakStream` function and `POST /speak-stream` route to `voice.ts` following the exact structural template of `handleSpeak`, using `Readable.fromWeb(response.body).pipe(res)` for streaming pipe-through, with `Content-Type: audio/wav` + `X-Accel-Buffering: no` response headers, JWT auth wired before express.json, Chatterbox body-schema translation applied, error shapes matching the CONTEXT.md spec, and zero modification to the existing handleSpeak function or its route. `tsc --noEmit` passes. Task 2 will add the corresponding unit tests; test failures at this stage are expected and covered there.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add handleSpeakStream unit tests to voice.test.ts</name>
  <files>src/backend/database/routes/voice.test.ts</files>

  <read_first>
    - `src/backend/database/routes/voice.test.ts` in full — you MUST understand the existing MockRes shape (L19-57), the `makeSpeakReq` helper (L97-99), the `makeTtsFetchResponse` helper (L84-95), and the exact structural pattern of `handleSpeak` Tests A-H (L247-393). Task 2's tests mirror that structure.
    - `src/backend/database/routes/voice.ts` — specifically the just-added handleSpeakStream function (from Task 1) so tests match its actual export and error strings.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Testing (Backend unit tests bullet list — 6 test cases named there).
  </read_first>

  <behavior>
    - Test SA: returns 400 when body.text is missing (mirrors handleSpeak Test A)
    - Test SA2: returns 400 when body.text is empty string (mirrors Test A2)
    - Test SB: returns 400 when body.text.length > SPEAK_TEXT_MAX (mirrors Test B)
    - Test SC: returns 400 when body.voice is invalid format (mirrors Test C)
    - Test SD: happy path — upstream 200 pipes chunks through as res.write() calls, sets Content-Type: audio/wav + X-Accel-Buffering: no, does not call res.json
    - Test SE: request body sent to Chatterbox matches locked schema {text, voice_mode:"predefined", predefined_voice_id:"Elena.wav", stream:true, split_text:true, chunk_size:80} when voice omitted
    - Test SF: when body.voice is provided, predefined_voice_id equals that voice
    - Test SG: upstream non-2xx returns {error:"TTS stream non-2xx", status:<n>} — upstream response body NOT forwarded (T-16-03 analog)
    - Test SH: fetch throwing AbortError returns 504 {error:"TTS stream timeout", status:504}
    - Test SI: fetch throwing generic Error returns 502 {error:"TTS stream proxy error", status:502}
    - Test SJ: fetch URL used is http://100.80.122.111:8001/tts (NOT /v1/audio/speech)
  </behavior>

  <action>
    Add a new `describe("handleSpeakStream", () => { ... })` block at the end of `voice.test.ts` (after the `handleListVoices` describe block ending near line 461). Import `handleSpeakStream` in the existing import line at L13: change `import { handleTranscribe, handleSpeak, handleListVoices, DEFAULT_VOICE, SPEAK_TEXT_MAX } from "./voice.js";` to add `handleSpeakStream` to the import list.

    Extend the MockRes type + `makeRes` factory to also support the streaming path. The existing MockRes has `set`, `status`, `end`, `json`. Add:
    - `_writes: Uint8Array[]` — accumulates chunks written by the pipe.
    - `_streamedEnded: boolean` — flips true when the pipe closes.
    - `setHeader: (key, value) => MockRes` — captures `res.setHeader("X-Accel-Buffering", "no")` (the existing `.set()` handles `res.status(200).set("Content-Type", ...)`; Node's `Readable.pipe` uses `res.write(chunk)` + `res.end()` and can also drive `setHeader` — accept both).
    - `write: (chunk: Buffer | Uint8Array) => boolean` — pushes into `_writes`, returns true (mimics Node writable.write high-water-mark == not-backpressured).
    - `on: (event, cb) => MockRes` — no-op stub returning `this`; Node's `Readable.pipe` may attach `error`/`close`/`drain` listeners on the writable and expects an event-emitter-shaped res. Return `this` (chainable) so pipe doesn't throw.
    - `once: (event, cb) => MockRes` — no-op stub returning `this` (same reason).
    - `emit: (event, ...args) => boolean` — no-op stub returning `true`.
    - Extend `end(chunk?)`: if `chunk` is a Buffer/Uint8Array, push it to `_writes` before flipping `_streamedEnded = true`.

    Add a helper `makeStreamingTtsResponse(status, chunks)`:
    - Returns a Response-like object with `ok`, `status`, `body: new ReadableStream({ start(controller) { for (const c of chunks) controller.enqueue(c); controller.close(); } })`.
    - When status is non-2xx, `body` should still be present but the caller should not read it — the handler must return the fixed error shape without piping.

    Write eleven tests SA, SA2, SB, SC, SD, SE, SF, SG, SH, SI, SJ following the naming and structure of the existing handleSpeak Tests A-H. Guidance per test:
    - SA/SA2/SB/SC: identical to A/A2/B/C but call `handleSpeakStream` instead of `handleSpeak`. Reuse existing `makeSpeakReq`.
    - SD: stub fetch with `makeStreamingTtsResponse(200, [new Uint8Array([82,73,70,70,1,2,3,4]), new Uint8Array([5,6,7,8])])`. After awaiting the handler (which returns before the pipe drains), give the microtask queue a tick with `await new Promise((r) => setImmediate(r))` (or `await vi.advanceTimersByTimeAsync(0)` if fake timers are active — note that this describe block should NOT use fake timers for pipe tests because Readable stream scheduling depends on real microtasks; wrap the SD test in `it("Test SD: ...", async () => { vi.useRealTimers(); ... })` or move the fake-timer beforeEach to be per-describe rather than global). Assert `res._headers["Content-Type"]` === "audio/wav", `res._headers["X-Accel-Buffering"]` === "no" (or check via `setHeader` capture), `res._writes.length` >= 1, concatenated `_writes` equals concatenated input chunks, and `res._streamedEnded === true`.
    - SE: stub fetch to capture the outgoing body via `capturedBody = JSON.parse(opts.body)`; assert every key/value pair in the locked schema — `capturedBody.text === "Hello"`, `capturedBody.voice_mode === "predefined"`, `capturedBody.predefined_voice_id === "Elena.wav"`, `capturedBody.stream === true`, `capturedBody.split_text === true`, `capturedBody.chunk_size === 80`.
    - SF: same as SE but `req.body.voice = "Marcus.wav"`; assert `predefined_voice_id === "Marcus.wav"` and DEFAULT_VOICE is NOT the value.
    - SG: stub fetch with `{ok:false, status:503, body: ... }`; assert `res._status === 503`, `res._body === {error:"TTS stream non-2xx", status:503}`, `res._writes.length === 0` (upstream body was NOT piped).
    - SH: stub fetch to throw `new DOMException("aborted", "AbortError")`; assert `res._status === 504` and `res._body.error === "TTS stream timeout"`.
    - SI: stub fetch to throw `new Error("upstream socket closed")`; assert `res._status === 502` and `res._body.error === "TTS stream proxy error"`.
    - SJ: stub fetch capturing the URL argument; call handler; assert captured URL equals `"http://100.80.122.111:8001/tts"` (exact string match; must NOT be `.../v1/audio/speech`).

    Real vs fake timers: the existing top-level `beforeEach(() => vi.useFakeTimers())` interferes with ReadableStream microtask scheduling. Inside the new describe block, add `beforeEach(() => vi.useRealTimers())` to override (Vitest applies innermost-first). Restore afterEach behavior for other tests by keeping the top-level `afterEach(() => vi.useRealTimers())` unchanged.

    Add `vi.stubGlobal("fetch", ...)` per test as the existing tests do; the SH AbortError path may still need a manual `controller.abort()` timing dance if you want to actually exercise the timeout — matching the shape of handleSpeak Test H (which stubs fetch to throw directly, not to test the setTimeout race) is acceptable and simpler.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/backend/database/routes/voice.test.ts 2>&1 | tail -60</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it("Test S[A-J]' src/backend/database/routes/voice.test.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -q 'describe("handleSpeakStream"' src/backend/database/routes/voice.test.ts && grep -q 'handleSpeakStream' src/backend/database/routes/voice.test.ts && echo "OK: handleSpeakStream tests wired" || echo "FAIL: describe or import missing"</automated>
  </verify>

  <acceptance_criteria>
    - `npx vitest run src/backend/database/routes/voice.test.ts` exits 0 with all handleTranscribe + handleSpeak + handleListVoices tests still passing (regression guard) AND all 11 new handleSpeakStream tests passing.
    - `grep -c 'it("Test S[A-J]' src/backend/database/routes/voice.test.ts` = 11 (SA, SA2, SB, SC, SD, SE, SF, SG, SH, SI, SJ — SA2 matches the `S[A-J]` character class via its leading `SA`).
    - Existing handleSpeak tests A-H still exist and pass unmodified: `grep -c 'it("Test [A-H]' src/backend/database/routes/voice.test.ts` >= 8.
    - SD's captured writes concatenate to the same bytes as the streamed input chunks (byte-equality assertion in test body).
    - SG's captured `_writes.length === 0` (assertion in test body proves T-16-03 no-body-leak on error path).
    - SJ asserts URL is EXACTLY `"http://100.80.122.111:8001/tts"` (assertion in test body).
  </acceptance_criteria>

  <done>
    All handleSpeakStream tests (SA through SJ) pass under `npx vitest run src/backend/database/routes/voice.test.ts`. Existing voice tests still pass (regression-free). MockRes gained the minimal streaming shim (write, setHeader, on/once/emit no-ops) needed for `Readable.pipe(res)` to work in-process. Tests demonstrate: body validation, Chatterbox request-body schema translation, pipe-through of chunks, T-16-03 no-body-leak on non-2xx, AbortError → 504, generic error → 502, and correct upstream URL.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → nginx → Express | Untrusted JSON body enters at the /voice/speak-stream endpoint (client-controlled `text` and `voice` fields). JWT gate before parse. |
| Express → tailnet Chatterbox | Trusted tailnet hop (100.80.122.111 is an internal peer). Body constructed server-side; no client bytes reach Chatterbox without validation. |
| Chatterbox → Express → browser | Upstream WAV bytes piped through unmodified. On non-2xx, upstream body is DISCARDED (T-16-03 analog). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-01 | Spoofing | POST /voice/speak-stream | mitigate | `authenticateJWT` middleware wired BEFORE `express.json` per handleSpeak/handleTranscribe pattern (T-16-04 analog); unauthenticated request returns 401 before body parse. |
| T-19-02 | Tampering | body.text and body.voice fields | mitigate | Reuse existing `SPEAK_TEXT_MAX` (25000) length cap + `VOICE_FILENAME_RE` (`/^[A-Z][A-Za-z]+\.wav$/`) format check from voice.ts; return 400 on violation BEFORE upstream fetch. `body.text` type-checked as string; `body.voice` type-checked as string when present. |
| T-19-03 | Repudiation | Streaming route usage | accept | Skynet doesn't audit-log per-request voice traffic (matches handleSpeak posture); `databaseLogger.error` on timeout/proxy-error paths only, no per-request success logging (matches handleSpeak). |
| T-19-04 | Information Disclosure | Non-2xx upstream body leak | mitigate | On `!response.ok`, return fixed `{error:"TTS stream non-2xx", status:<upstream.status>}` shape WITHOUT reading or forwarding upstream body (T-16-03 analog). Test SG asserts `res._writes.length === 0` on this path. |
| T-19-05 | Denial of Service | Unbounded upstream fetch | mitigate | `AbortController` with 300_000 ms (5 min) timeout on the upstream fetch, matching handleSpeak's cap; AbortError branch returns 504 within a bounded window. Body-size cap on client input via `express.json({ limit: "64kb" })`. |
| T-19-06 | Denial of Service | Client disconnect leaks upstream socket | accept | If browser aborts the streaming response mid-flight, Node's pipe will emit an error on res and Chatterbox's connection may hold until its own timeout (~30s per prior probing). Acceptable for v1; a `res.on("close", () => controller.abort())` upgrade is deferred (would add ~3 lines but complicates the "mirror handleSpeak structure" acceptance). Documented for follow-up. |
| T-19-07 | Elevation of Privilege | JWT bypass via body-parser ordering | mitigate | Route wired as `router.post("/speak-stream", authenticateJWT, express.json(...), handler)`. Test coverage: unauthenticated wire test is verified by construction (same middleware chain as `/speak`); handler-level tests do not exercise the middleware but the route wiring is grep-verifiable (`grep 'authenticateJWT,\s*express\.json'` acceptance criterion in Task 1). |
| T-19-SC | Tampering | npm installs | accept | No new npm packages added by this plan (Node built-ins `node:stream` and existing `express`, `vitest` only). Package legitimacy gate not triggered. |
</threat_model>

<verification>
Run at plan completion:
1. `cd /home/ubuntu/skynet && npx tsc --noEmit` — clean.
2. `cd /home/ubuntu/skynet && npx vitest run src/backend/database/routes/voice.test.ts` — all tests pass (existing handleTranscribe/handleSpeak/handleListVoices tests unmodified + 11 new handleSpeakStream tests: SA, SA2, SB, SC, SD, SE, SF, SG, SH, SI, SJ).
3. `grep -c '\.arrayBuffer()\|\.blob()\|\.text()' src/backend/database/routes/voice.ts | awk-scoped-to-handleSpeakStream` = 0 — NO server-side buffering.
4. `grep -q 'router.post("/speak"' src/backend/database/routes/voice.ts && grep -q 'router.post("/speak-stream"' src/backend/database/routes/voice.ts` — both routes coexist (TTSSTR-07 preservation guard).
5. `git diff` on `src/backend/database/routes/voice.ts` shows ADDITIONS only for the handleSpeak block region; no deletions inside the existing handleSpeak function or its route.
</verification>

<success_criteria>
Requirements satisfied by this plan:
- TTSSTR-01: New `handleSpeakStream` function + `POST /voice/speak-stream` route pipe-through Chatterbox with `Readable.fromWeb(response.body).pipe(res)`; `Content-Type: audio/wav` + `X-Accel-Buffering: no` headers set; NO server-side buffering.
- TTSSTR-02: Backend-side request body translation to Chatterbox schema (`voice_mode:"predefined"`, `predefined_voice_id: voice ?? "Elena.wav"`, `stream:true`, `split_text:true`, `chunk_size:80`); reuses `VOICE_FILENAME_RE` + `SPEAK_TEXT_MAX`; default voice stays `Elena.wav`.
- TTSSTR-07 (security parity half): JWT auth wired before parser; 300s AbortController; T-16-03 no-body-leak on non-2xx; 504 on AbortError; 502 on other exceptions; existing handleSpeak preserved byte-for-byte. (The "ship as patch #237 + skynet-patches.md entry + end-to-end verify" half of TTSSTR-07 is handled in Plan 05.)
</success_criteria>

<output>
Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-01-SUMMARY.md` when done, using the template in `$HOME/.claude/get-shit-done/templates/summary.md`. Summary must include:
- Grep counts for `handleSpeakStream`, `Readable.fromWeb`, `X-Accel-Buffering`, `TTS_STREAM_URL`.
- Confirmation that `handleSpeak` was NOT modified (git diff excerpt or grep-baseline comparison).
- All 11 new tests passing (SA, SA2, SB, SC, SD, SE, SF, SG, SH, SI, SJ — paste `npx vitest run src/backend/database/routes/voice.test.ts` summary line).
- Any deviation from the CONTEXT.md spec (there should be none; if any, flag for Plan 05 patch note).
</output>
