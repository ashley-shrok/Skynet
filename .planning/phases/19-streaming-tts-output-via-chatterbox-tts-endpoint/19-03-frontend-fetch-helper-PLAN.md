---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: 03
type: execute
wave: 2
depends_on:
  - 19-01
files_modified:
  - src/ui/api/voice-api.ts
  - src/ui/api/voice-api.test.ts
autonomous: true
requirements:
  - TTSSTR-04
tags:
  - frontend
  - api-helper
  - fetch
  - streaming
  - jwt
  - voice

must_haves:
  truths:
    - "`postSpeakStream(text: string, voice?: string): Promise<Response>` is exported from src/ui/api/voice-api.ts"
    - "postSpeakStream uses `fetch()` (NOT axios) and returns the raw Response object with an unread body — the caller drives the read loop"
    - "postSpeakStream POSTs to `/voice/speak-stream` with body `{text}` when voice is undefined, or `{text, voice}` when voice is provided"
    - "postSpeakStream attaches JWT via `Authorization: Bearer ${jwt}` header, reading the token from `localStorage.getItem('jwt')` (matching the source used by main-axios.ts:343)"
    - "postSpeakStream omits the Authorization header entirely when no JWT is present in localStorage (do NOT send `Bearer null` or `Bearer undefined`)"
    - "postSpeakStream sets `Content-Type: application/json` and serializes the body via JSON.stringify"
    - "Existing `postSpeak()` axios helper is unchanged (byte-for-byte — IdentityModal voice-preview keeps using it per TTSSTR-07)"
    - "Existing `getVoices()` and `SAMPLE_PHRASE` exports are unchanged"
    - "The returned Response object is passed through even on non-2xx status — the caller decides how to surface the error (matches the streaming contract; the fetch helper does NOT throw on response.ok=false to preserve caller-side error handling)"
  artifacts:
    - path: src/ui/api/voice-api.ts
      provides: "postSpeakStream function added, postSpeak/getVoices/SAMPLE_PHRASE preserved"
      contains: "export async function postSpeakStream"
    - path: src/ui/api/voice-api.test.ts
      provides: "unit tests for postSpeakStream URL, body, headers, and JWT attachment"
      contains: "describe(\"postSpeakStream\""
  key_links:
    - from: "src/ui/api/voice-api.ts:postSpeakStream"
      to: "fetch('/voice/speak-stream', { method: 'POST', ... })"
      via: "browser fetch API with JSON body"
      pattern: "fetch\\(\"/voice/speak-stream\""
    - from: "src/ui/api/voice-api.ts:postSpeakStream"
      to: "localStorage.getItem('jwt')"
      via: "JWT token attach"
      pattern: "localStorage\\.getItem\\(\"jwt\"\\)"
---

<objective>
Add a `postSpeakStream(text: string, voice?: string): Promise<Response>` fetch-based helper to `src/ui/api/voice-api.ts` that (a) POSTs to the new backend `/voice/speak-stream` route with the same `{text, voice?}` body shape as the existing `postSpeak()` axios helper, (b) manually attaches the JWT via `Authorization: Bearer ${jwt}` header (axios interceptors don't apply to raw `fetch`), and (c) returns the raw `Response` object so the ChatMessage.tsx caller (Plan 04) can drive `response.body.getReader()` for progressive decode — implementing TTSSTR-04. The existing `postSpeak()` axios helper stays byte-for-byte unchanged; IdentityModal voice-preview continues calling it.

Purpose: axios's default response handling (via `main-axios.ts`) automatically buffers the entire response body into `response.data` (as Blob or JSON). Streaming requires access to the raw `ReadableStream` before the body is drained, which is only available via the WHATWG fetch API. Extracting this as a helper keeps the JWT-attach and URL/body logic in ONE place (the shape mirrors `postSpeak`'s intent) without polluting ChatMessage.tsx with auth details.

Output:
- `postSpeakStream(text, voice?): Promise<Response>` exported from `src/ui/api/voice-api.ts` (added after `postSpeak`; existing exports preserved).
- `voice-api.test.ts` describing 6 behaviors (URL, body-with-voice, body-without-voice, JWT-when-present, no-Authorization-when-absent, Response passthrough on non-2xx).

Non-negotiables (from 19-CONTEXT.md § Frontend API helper + TTSSTR-04):
- Uses `fetch`, NOT axios.
- Existing `postSpeak()` byte-for-byte unchanged.
- Returns `Promise<Response>` (unread body) — caller drives the stream.
- JWT attached manually from `localStorage.getItem("jwt")` (same source as main-axios.ts:343 axios interceptor).
- Does NOT throw on `response.ok === false` — passes the Response through so the caller surfaces the error semantics (matches how the streaming client wants error handling: read the status, show a toast, do NOT surface as a "database unreachable" false-positive per CONTEXT.md § Error handling).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
@src/ui/api/voice-api.ts
@src/ui/main-axios.ts
@src/backend/database/routes/voice.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add postSpeakStream export to voice-api.ts</name>
  <files>src/ui/api/voice-api.ts</files>

  <read_first>
    - `src/ui/api/voice-api.ts` in full (31 lines) — you MUST see the exact shape of `postSpeak` (L5-21) that `postSpeakStream` sits beside, and confirm no other helpers exist that would clash.
    - `src/ui/main-axios.ts` L343-348 — the axios request interceptor that reads `localStorage.getItem("jwt")` and sets `config.headers["Authorization"] = "Bearer ${jwt}"`. `postSpeakStream` must replicate this JWT-attach logic exactly (same localStorage key, same header format).
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Frontend API helper — the locked spec.
    - `.planning/REQUIREMENTS.md` § Streaming TTS Output — TTSSTR-04.
    - `src/backend/database/routes/voice.ts` (updated by Plan 01) — specifically the new `/speak-stream` route validation rules (Plan 01 Task 1) so postSpeakStream's body shape matches what the backend accepts. Body is `{text: string, voice?: string}` — same as existing `postSpeak`.
  </read_first>

  <action>
    Add a new exported async function `postSpeakStream(text: string, voice?: string): Promise<Response>` to `src/ui/api/voice-api.ts`, placed AFTER the existing `postSpeak` function (approximately after line 21, before `getVoices` on line 23). Do NOT modify `postSpeak`, `getVoices`, or `SAMPLE_PHRASE`.

    Function body:
    1. Construct the JSON body: `const body: { text: string; voice?: string } = { text }; if (voice) body.voice = voice;` (mirrors postSpeak L6-8 exactly).
    2. Read the JWT from `localStorage.getItem("jwt")` — the same key `main-axios.ts:343` uses. Store in a local const.
    3. Build the headers object:
       ```
       const headers: Record<string, string> = { "Content-Type": "application/json" };
       if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
       ```
       Do NOT set the Authorization header when jwt is null/empty — sending `Bearer null` or `Bearer ` would cause the backend to reject with 401 in a misleading way.
    4. Call `fetch("/voice/speak-stream", { method: "POST", headers, body: JSON.stringify(body) })` and return the resulting Response directly. Do NOT `await` a body-read method; do NOT throw on non-ok; the caller drives the read loop and inspects `response.status` / `response.ok` itself.

    Full function signature and body should be under ~20 lines, matching postSpeak's terseness. Add a brief JSDoc comment above the function explaining:
    - "Streaming variant of postSpeak (patch #237 / Phase 19)."
    - "Returns the raw Response with an unread body — caller drives response.body.getReader() for Web Audio API progressive decode."
    - "JWT is attached manually because fetch() is not routed through main-axios.ts's request interceptor."
    - "Does NOT throw on non-2xx — caller inspects response.ok / response.status and surfaces errors via toast."

    Import considerations: NO new imports needed at the top of the file. `fetch` is a global; `localStorage` is a global; `Response` type is a global (built-in DOM type in TypeScript's `lib.dom.d.ts`). The existing `import { authApi, handleApiError } from "@/main-axios";` line stays for the sake of `postSpeak`.

    Notes:
    - The URL is `/voice/speak-stream` (relative). This resolves to the current origin, which nginx routes to the backend via the exact-match location block from Plan 02.
    - Type-safety: the `body` type annotation matches postSpeak's; TypeScript will validate that `text` is a string and `voice` (when present) is a string.
    - No AbortController on this side: the caller (ChatMessage.tsx, Plan 04) can wrap the fetch with an AbortController if it wants; the backend already has its own 300s AbortController on the upstream fetch. Keeping the helper simple avoids leaking abort semantics into the helper API — v1 does not need caller-side abort.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'export async function postSpeakStream' src/ui/api/voice-api.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'export async function postSpeak\b' src/ui/api/voice-api.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'export async function getVoices' src/ui/api/voice-api.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'export const SAMPLE_PHRASE' src/ui/api/voice-api.ts</automated>
    <automated>cd /home/ubuntu/skynet && awk '/export async function postSpeakStream/,/^}/' src/ui/api/voice-api.ts | grep -cE '(fetch\("/voice/speak-stream"|localStorage\.getItem\("jwt"\)|Bearer \$\{jwt\}|Content-Type.*application/json|JSON\.stringify)'</automated>
    <automated>cd /home/ubuntu/skynet && git diff src/ui/api/voice-api.ts | grep -E '^-' | grep -vE '^---' | head</automated>
  </verify>

  <acceptance_criteria>
    - `tsc --noEmit` exits 0 (no TypeScript regressions).
    - `grep -c 'export async function postSpeakStream' src/ui/api/voice-api.ts` = 1.
    - `grep -c 'export async function postSpeak\b' src/ui/api/voice-api.ts` = 1 (existing postSpeak preserved; `\b` excludes postSpeakStream).
    - `grep -c 'export async function getVoices' src/ui/api/voice-api.ts` = 1 (unchanged).
    - `grep -c 'export const SAMPLE_PHRASE' src/ui/api/voice-api.ts` = 1 (unchanged).
    - `awk`-scoped grep inside postSpeakStream body finds all 5 expected tokens: `fetch("/voice/speak-stream"`, `localStorage.getItem("jwt")`, `` Bearer ${jwt} ``, `Content-Type` + `application/json`, `JSON.stringify` — count >= 5.
    - `git diff src/ui/api/voice-api.ts | grep -E '^-' | grep -vE '^---'` returns empty (no lines removed from existing postSpeak/getVoices/SAMPLE_PHRASE).
    - Function returns `Promise<Response>` (verifiable in the type signature — `Promise<Response>` string appears in the file: `grep -c 'Promise<Response>' src/ui/api/voice-api.ts` >= 1).
  </acceptance_criteria>

  <done>
    `postSpeakStream(text, voice?): Promise<Response>` is exported from `voice-api.ts`, uses fetch with the correct URL / body / headers, attaches JWT from localStorage exactly as `main-axios.ts` does, does not throw on non-ok, and returns the raw Response for the caller to drive. Existing `postSpeak`, `getVoices`, and `SAMPLE_PHRASE` exports are unchanged. Task 2 adds tests.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add postSpeakStream unit tests to voice-api.test.ts</name>
  <files>src/ui/api/voice-api.test.ts</files>

  <read_first>
    - `src/ui/api/voice-api.ts` after Task 1 completed — so tests match the exported function signature and behavior.
    - `src/ui/api/pretty-view-upload-protocol.test.ts` — an existing test file in the same directory that uses vitest + jsdom conventions; use as the reference for imports, `describe/it` structure, and `beforeEach/afterEach` teardown.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Frontend API helper (implicit test coverage: URL, body-with-voice, body-without-voice, JWT-attach, no-JWT branch).
  </read_first>

  <behavior>
    - Test 1: postSpeakStream POSTs to "/voice/speak-stream" with method:"POST"
    - Test 2: When voice is undefined, request body is JSON.stringify({text})
    - Test 3: When voice is provided, request body is JSON.stringify({text, voice})
    - Test 4: When localStorage has "jwt" key, Authorization header is "Bearer ${jwt}"
    - Test 5: When localStorage has no "jwt" key, Authorization header is NOT present
    - Test 6: Content-Type header is "application/json"
    - Test 7: Returns the raw Response even when response.ok is false (does NOT throw)
    - Test 8: Returns the raw Response with an unread body (response.bodyUsed is false when helper returns)
  </behavior>

  <action>
    Create a new file `src/ui/api/voice-api.test.ts`. Use vitest imports (`describe, it, expect, beforeEach, afterEach, vi`) — this is a Node/jsdom test that mocks `fetch` and `localStorage` globals.

    Test file structure:

    ```
    import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
    import { postSpeakStream } from "./voice-api";

    describe("postSpeakStream (Phase 19 / patch #237)", () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;

      beforeEach(() => {
        capturedUrl = undefined;
        capturedInit = undefined;
        vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(new Uint8Array([82, 73, 70, 70]), {
            status: 200,
            headers: { "Content-Type": "audio/wav" },
          });
        });
        // jsdom provides a localStorage stub already — start clean each test.
        window.localStorage.clear();
      });

      afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
      });

      // Test 1..8 below.
    });
    ```

    Individual tests:

    - **Test 1 — URL**: Call `postSpeakStream("hello")`. Assert `capturedUrl === "/voice/speak-stream"` and `capturedInit?.method === "POST"`.

    - **Test 2 — body without voice**: Call `postSpeakStream("hello")`. Assert `JSON.parse(capturedInit?.body as string)` equals `{ text: "hello" }` (no `voice` key present — `expect(parsed).not.toHaveProperty("voice")`).

    - **Test 3 — body with voice**: Call `postSpeakStream("hello", "Marcus.wav")`. Assert `JSON.parse(capturedInit?.body as string)` equals `{ text: "hello", voice: "Marcus.wav" }`.

    - **Test 4 — JWT present**: `window.localStorage.setItem("jwt", "eyJhbGciOiJIUzI1NiJ9.abc.def")`; call `postSpeakStream("hi")`. Assert `capturedInit?.headers` (accessed as `(capturedInit!.headers as Record<string,string>)["Authorization"]` OR via `new Headers(capturedInit!.headers).get("Authorization")`) equals `"Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"`.

    - **Test 5 — JWT absent**: (localStorage is cleared in beforeEach); call `postSpeakStream("hi")`. Assert `new Headers(capturedInit!.headers).get("Authorization")` is `null` (i.e., no Authorization header sent).

    - **Test 6 — Content-Type**: Call `postSpeakStream("hi")`. Assert `new Headers(capturedInit!.headers).get("Content-Type")` equals `"application/json"`.

    - **Test 7 — non-ok Response passes through**: Override the fetch stub in this test with `vi.stubGlobal("fetch", async () => new Response(JSON.stringify({error: "TTS stream non-2xx", status: 503}), { status: 503, headers: { "Content-Type": "application/json" } }))`. Call `await postSpeakStream("hi")`. Assert the returned value has `response.ok === false`, `response.status === 503`. The call must NOT throw. Optionally assert `await response.json()` equals `{ error: "TTS stream non-2xx", status: 503 }`.

    - **Test 8 — Response body is unread**: Call `await postSpeakStream("hi")`. Assert `response.bodyUsed === false` (the helper does not drain the body — the caller controls it).

    Notes:
    - `window.localStorage` is available in jsdom by default; no additional setup needed. If the test environment is Node-only (not jsdom), guard with a vitest config check or stub `globalThis.localStorage` manually. The existing `pretty-view-upload-protocol.test.ts` uses jsdom (via `@testing-library/react`), so vitest.config already has jsdom for `src/ui/api/`.
    - `Headers` and `Response` are globals in jsdom (undici polyfill via Node 18+). The tests do not need explicit imports for these types.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/api/voice-api.test.ts 2>&1 | tail -30</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'it(' src/ui/api/voice-api.test.ts</automated>
    <automated>cd /home/ubuntu/skynet && grep -q 'describe("postSpeakStream' src/ui/api/voice-api.test.ts && echo "OK" || echo "FAIL: describe missing"</automated>
  </verify>

  <acceptance_criteria>
    - `npx vitest run src/ui/api/voice-api.test.ts` exits 0 with 8 tests passing.
    - `grep -c 'it(' src/ui/api/voice-api.test.ts` = 8.
    - `grep -q 'describe("postSpeakStream'` returns success.
    - Test 5 explicitly asserts NO Authorization header when localStorage is clean (defensive coverage: prevents `Bearer null` regression).
    - Test 7 explicitly asserts non-ok Response passes through without throw (defensive coverage: prevents accidental `if (!response.ok) throw` regression that would break the caller's toast semantics).
  </acceptance_criteria>

  <done>
    `voice-api.test.ts` exists with 8 passing tests covering URL, body-with-voice, body-without-voice, JWT-when-present, no-Authorization-when-absent, Content-Type, non-ok pass-through, and unread-body-guarantee for `postSpeakStream`. All tests green under `npx vitest run src/ui/api/voice-api.test.ts`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser code → localStorage | Trusted (same-origin) but localStorage can be manipulated by any script running on the origin. |
| browser fetch → same-origin backend | Same-origin request; nginx routes it to the Express backend on port 30001. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-F01 | Spoofing | localStorage JWT read | mitigate | Trust posture inherited from main-axios.ts:343 (Skynet-wide auth model). No new attack surface introduced by this helper — it reads the same key from the same source. If an XSS existed on Skynet origin, that's a broader problem not scoped to this plan. |
| T-19-F02 | Tampering | Attacker intercepts fetch and modifies body | accept | Same-origin request over HTTPS in production (Caddy edge). TLS is the mitigation; this helper adds no fresh MITM surface. |
| T-19-F03 | Information Disclosure | JWT leak via Authorization header logging | mitigate | Test 5 explicitly asserts `Authorization` header is ABSENT when no JWT exists (defensive — a `Bearer null` string in server logs would be embarrassing but not a security issue; still worth catching). No client-side logging of the JWT. |
| T-19-F04 | Denial of Service | Frontend spams postSpeakStream without user consent | accept | Callers gate the invocation (Plan 04 wires it behind a click). No rate-limiting in the helper itself; that's a backend concern (deferred — Skynet doesn't rate-limit any endpoint currently and this route is JWT-gated). |
| T-19-F05 | Elevation of Privilege | Missing JWT allows request through | mitigate | Backend `authenticateJWT` middleware (Plan 01) rejects unauthenticated requests at 401; frontend helper preserving the "no header when no JWT" behavior means server-side auth is the sole gate — same posture as every other Skynet API call. |
| T-19-F06 | Repudiation | Frontend cannot prove a request was sent | accept | Standard axios/fetch client posture in Skynet; not addressed. |
| T-19-SC | Tampering | Package installs | accept | No new npm packages added by this plan. |
</threat_model>

<verification>
Run at plan completion:
1. `cd /home/ubuntu/skynet && npx tsc --noEmit` — clean.
2. `cd /home/ubuntu/skynet && npx vitest run src/ui/api/voice-api.test.ts` — all 8 tests pass.
3. `grep -c 'export async function postSpeak\b' src/ui/api/voice-api.ts` = 1 (postSpeak unchanged).
4. `grep -c 'export async function postSpeakStream' src/ui/api/voice-api.ts` = 1 (new export exists).
5. `git diff --unified=0 src/ui/api/voice-api.ts | grep -E '^-' | grep -vE '^---'` empty (no removed lines from existing exports).
</verification>

<success_criteria>
Requirement satisfied by this plan:
- TTSSTR-04: `postSpeakStream(text, voice?): Promise<Response>` exported from `src/ui/api/voice-api.ts`; uses fetch (not axios); manually attaches JWT via `Authorization: Bearer ${token}` header from `localStorage.getItem("jwt")`; existing `postSpeak()` axios/blob helper preserved unchanged.
</success_criteria>

<output>
Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-03-SUMMARY.md` when done, using the template. Summary must include:
- Confirmation that postSpeak was not modified (grep-baseline diff).
- 8 postSpeakStream tests passing (paste vitest summary line).
- Confirmation that JSDoc comment is present and matches the intent bullets from the action section.
</output>
