---
phase: 260731-khv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/voice.ts
  - src/backend/database/routes/voice.test.ts
  - src/backend/database/routes/identities.ts
  - src/backend/database/db/schema.ts
  - src/backend/database/db/index.ts
  - src/ui/api/identities-api.ts
  - src/ui/api/voice-api.ts
  - src/ui/features/pretty-view/ChatMessage.tsx
  - src/ui/features/pretty-view/ChatMessage.speak.test.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
  - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
autonomous: true
requirements:
  - patch-223-backend-speak-route
  - patch-223-backend-voices-route
  - patch-223-identity-voice-column
  - patch-223-frontend-bubble-speaker
  - patch-223-frontend-identity-picker

must_haves:
  truths:
    - "Authenticated POST /voice/speak returns audio/wav bytes for a valid text payload"
    - "Authenticated GET /voice/voices returns the Chatterbox predefined-voices list"
    - "Identities table has a nullable voice column; PUT /identities/:id round-trips voice through the multipart data field"
    - "A speaker button renders on assistant bubbles in pretty-view and never on user bubbles"
    - "Clicking the speaker button plays synthesized audio, and a second click on the same bubble stops it"
    - "IdentityModal shows a voice dropdown seeded from getVoices() plus a sample button that plays the currently-selected voice with the fixed sample phrase"
    - "Saving the IdentityModal persists the selected voice (or null for default) to the server"
  artifacts:
    - path: "src/backend/database/routes/voice.ts"
      provides: "handleSpeak + handleListVoices handlers, POST /speak + GET /voices routes, DEFAULT_VOICE + SPEAK_TEXT_MAX + SAMPLE_PHRASE constants"
      contains: "handleSpeak"
    - path: "src/backend/database/routes/voice.test.ts"
      provides: "handleSpeak + handleListVoices vitest coverage mirroring handleTranscribe pattern"
      contains: "handleSpeak"
    - path: "src/ui/api/voice-api.ts"
      provides: "postSpeak(text, voice?) -> Blob and getVoices() -> {display_name, filename}[]"
      exports: ["postSpeak", "getVoices"]
    - path: "src/ui/features/pretty-view/ChatMessage.speak.test.tsx"
      provides: "assistant-only rendering + click-to-speak + concurrent-playback test coverage"
    - path: "src/ui/features/pretty-view/IdentityModal.voice.test.tsx"
      provides: "voice dropdown + sample button + save-payload test coverage"
  key_links:
    - from: "src/backend/database/routes/voice.ts"
      to: "http://100.80.122.111:8001/v1/audio/speech"
      via: "fetch with AbortController 30s + audio/wav passthrough"
      pattern: "100\\.80\\.122\\.111:8001"
    - from: "src/backend/database/db/index.ts"
      to: "identities table voice column"
      via: "addColumnIfNotExists(\"identities\", \"voice\", \"TEXT\")"
      pattern: "addColumnIfNotExists\\(\"identities\", \"voice\""
    - from: "src/ui/features/pretty-view/ChatMessage.tsx"
      to: "src/ui/api/voice-api.ts"
      via: "postSpeak(text, identityVoice ?? undefined) inside SpeakButton click handler"
      pattern: "postSpeak\\("
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/features/pretty-view/ChatMessage.tsx"
      via: "identityVoice={pvIdentity?.voice ?? null} on the ChatMessage render site"
      pattern: "identityVoice="
    - from: "src/ui/features/pretty-view/IdentityModal.tsx"
      to: "src/ui/api/voice-api.ts + src/ui/api/identities-api.ts"
      via: "getVoices() on mount + postSpeak(SAMPLE_PHRASE, selected) for sample + updateIdentity meta.voice on save"
      pattern: "getVoices\\(|postSpeak\\("
---

<objective>
Ship patch #223 (speak-messages): a per-bubble click-to-speak affordance on assistant messages in pretty-view, wired to a new authenticated `POST /voice/speak` reverse-proxy in front of the tailnet Chatterbox TTS server, plus a per-identity voice override + tasting-sample button in the IdentityModal Identity tab.

Purpose: Give Ashley a one-click "hear this bubble" affordance in every pretty-view conversation, and let each identity claim a distinct voice (with a sample button to A/B voices while editing). Backend follows the patch #155 STT-proxy pattern (auth-gate → 30s AbortController → fixed error shape → no upstream body leak). Frontend follows the patch #211 lesson (`Promise.resolve(audio.play()).catch(() => {})` — never bare `audio.play().catch`).

Output: One backend route module extension (`/voice/speak` + `/voice/voices`), one identities schema/route extension (nullable `voice` column + PUT plumbing), one frontend voice-api client, one SpeakButton affordance in `ChatMessage.tsx` gated to `role === "assistant"`, and one voice picker + sample button in `IdentityModal.tsx`. Test coverage for all three surfaces.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# Backend siblings — the STT-proxy pattern this patch mirrors
@src/backend/database/routes/voice.ts
@src/backend/database/routes/voice.test.ts
@src/backend/database/routes/identities.ts
@src/backend/database/db/schema.ts

# Frontend siblings — bubble render + identity modal + api client
@src/ui/api/identities-api.ts
@src/ui/features/pretty-view/ChatMessage.tsx
@src/ui/features/pretty-view/ChatMessage.test.tsx
@src/ui/features/pretty-view/IdentityModal.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend — POST /voice/speak + GET /voice/voices + identities voice column</name>
  <files>
    src/backend/database/routes/voice.ts,
    src/backend/database/routes/voice.test.ts,
    src/backend/database/routes/identities.ts,
    src/backend/database/db/schema.ts,
    src/backend/database/db/index.ts
  </files>
  <behavior>
    handleSpeak (new named export in voice.ts):
    - Test A: returns 400 {error} when body.text is missing or empty
    - Test B: returns 400 {error} when body.text length exceeds SPEAK_TEXT_MAX (25000)
    - Test C: returns 400 {error} when body.voice is provided and does not match /^[A-Z][A-Za-z]+\.wav$/
    - Test D: returns 200 with content-type "audio/wav" and forwards the upstream response body bytes when Chatterbox returns 200 with a wav payload (mock fetch returns { ok:true, status:200, headers:{ get:()=>"audio/wav" }, arrayBuffer:async()=>new Uint8Array([...]).buffer })
    - Test E: when body.voice is omitted, the outgoing fetch body JSON has voice === DEFAULT_VOICE ("Elena.wav")
    - Test F: when body.voice is provided and valid, the outgoing fetch body JSON forwards that voice verbatim
    - Test G: upstream non-2xx returns res.status(upstream.status).json({ error, status }) — no upstream body leak (T-16-03 analog)
    - Test H: fetch throwing DOMException("...", "AbortError") returns 504 { error:"TTS timeout", status:504 }

    handleListVoices (new named export in voice.ts):
    - Test I: returns the upstream JSON array verbatim on 200
    - Test J: upstream non-2xx returns { error, status } with the upstream status code
    - Test K: AbortError returns 504 { error:"voices timeout", status:504 }

    identities voice column:
    - Test L (in existing identities test file if one exists, else inline in voice.test.ts as a schema-side smoke): after migrateSchema() runs, `PRAGMA table_info(identities)` includes a "voice" TEXT column
    - Test M: parseMultipartMetadata accepts { voice: "Elena.wav" } and the PUT handler writes it to updates.voice (mirror colorHue conditional-block pattern)
    - Test N: PUT /identities/:id with meta.voice === null clears the column to null
    - Test O: publicIdentity(row) response includes row.voice
  </behavior>
  <action>
    Extend `src/backend/database/routes/voice.ts` (do NOT rewrite the file — add sibling code to the existing STT-proxy):
    - Add top-of-file constants: `const TTS_URL = "http://100.80.122.111:8001/v1/audio/speech";` and `const VOICES_URL = "http://100.80.122.111:8001/get_predefined_voices";` and `export const DEFAULT_VOICE = "Elena.wav";` and `export const SPEAK_TEXT_MAX = 25000;` and `export const SAMPLE_PHRASE = "Hi, this is your voice.";` and `const VOICE_FILENAME_RE = /^[A-Z][A-Za-z]+\.wav$/;`. Place these next to the existing STT_URL constant.
    - Add `export async function handleSpeak(req, res)` mirroring handleTranscribe's structure: (a) validate req.body.text is a non-empty string of length 1..SPEAK_TEXT_MAX (400 if not); (b) if req.body.voice is provided, validate against VOICE_FILENAME_RE (400 if not); (c) build `AbortController` with 30_000ms timeout; (d) fetch TTS_URL with method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"tts-1", input:req.body.text, voice: req.body.voice ?? DEFAULT_VOICE }), signal; (e) clearTimeout; (f) on !response.ok return res.status(response.status).json({ error:"TTS non-2xx", status:response.status }) — do NOT forward upstream body (T-16-03 analog); (g) on 2xx: `res.status(200).set("Content-Type","audio/wav")` then send the `Buffer.from(await response.arrayBuffer())` via `res.end(buf)`; (h) catch AbortError → 504 { error:"TTS timeout", status:504 }; other → 502 { error:"TTS proxy error", status:502 }. Log via databaseLogger.error with operation strings "voice_speak_timeout" / "voice_speak_proxy".
    - Add `export async function handleListVoices(req, res)` with the same AbortController 30s + fixed-shape error pattern. Fetch VOICES_URL with method:"GET". On 2xx: forward `await response.json()` verbatim as JSON. On non-2xx: `{ error:"voices non-2xx", status }`. AbortError → 504 { error:"voices timeout", status:504 }; other → 502.
    - Mount new routes AFTER the existing POST /transcribe: `router.post("/speak", authenticateJWT, express.json({ limit: "64kb" }), (req, res) => { void handleSpeak(req, res); });` — using a scoped `express.json()` middleware keeps the 25KB text cap enforced by JSON body size (belt + suspenders: the length check inside handleSpeak is the primary gate). And `router.get("/voices", authenticateJWT, (req, res) => { void handleListVoices(req, res); });`.
    - Do NOT modify the existing handleTranscribe function or the /transcribe route wiring.

    Extend `src/backend/database/routes/voice.test.ts` — add a second `describe("handleSpeak", () => { ... })` block and a third `describe("handleListVoices", () => { ... })` block covering behaviors A-K above. Reuse the makeReq/makeRes/makeFetchResponse helpers already in the file. For the audio/wav byte-forward test, extend makeRes with an `_endedBuf: Buffer | undefined` slot and an `end(buf?)` that captures the buffer; extend makeFetchResponse to accept an optional `headers` + `arrayBuffer` override for the TTS case. Do NOT hit the real Chatterbox endpoint — vi.stubGlobal("fetch", ...) per test, same as the existing STT tests.

    Extend `src/backend/database/db/schema.ts` at line ~654 (the `identities` sqliteTable): add `voice: text("voice"),` between `colorHue` and `avatarMime`. Also add `voice TEXT` to the `CREATE TABLE IF NOT EXISTS identities` block in `src/backend/database/db/index.ts` at line ~466 (between `color_hue INTEGER,` and `avatar_mime TEXT NOT NULL,`) so fresh installs get it.

    Extend `src/backend/database/db/index.ts` `migrateSchema()` at line ~685-689 (the identities addColumnIfNotExists block): add `addColumnIfNotExists("identities", "voice", "TEXT");` after the existing `color_hue` line. Follows patch #221's inline mechanism — do NOT create a migrations/ folder.

    Extend `src/backend/database/routes/identities.ts`:
    - Extend the `IdentityMetadata` type (line 33) to add `voice?: string | null;` after `colorHue`.
    - In the POST handler (line ~114-149 insert block), add `voice: meta.voice ?? null,` to the `db.insert(identities).values({...})` object next to `colorHue`.
    - In the PUT handler (line ~202 conditional block), add a `voice` conditional AFTER the `colorHue` block mirroring the colorHue shape: `if (meta.voice !== undefined) { if (meta.voice === null) { updates.voice = null; } else if (typeof meta.voice !== "string" || !/^[A-Z][A-Za-z]+\.wav$/.test(meta.voice)) { return res.status(400).json({ error: "voice must match [A-Z][A-Za-z]+\\.wav" }); } else { updates.voice = meta.voice; } }`.
    - Extend `publicIdentity(row)` (line ~49) to include `voice: row.voice,` next to `colorHue`.

    Type-check + verify:
    - MANDATORY per Fleet rule: `npm run build:backend && npm run build` (both). Frontend `tsc --noEmit` alone does NOT catch backend TS errors (patch #154 lesson).
    - Run `npm test -- src/backend/database/routes/voice.test.ts` and confirm all handleSpeak / handleListVoices tests pass.
    - Run the full backend suite and grep the log per patch #211 lesson: `npm test 2>&1 | tee /tmp/patch223-t1.log; grep -E "FAIL|failed|✗" /tmp/patch223-t1.log`. Zero failed AND grep returns no matches (empty exit-1) or explicitly-benign lines only.
    - Commit as one atomic backend commit: `git add -p` the five files, then `git commit -m "patch #223: backend /voice/speak + /voice/voices + identities voice column"`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run build:backend &amp;&amp; npm run build &amp;&amp; npm test -- src/backend/database/routes/voice.test.ts 2>&amp;1 | tee /tmp/patch223-t1.log &amp;&amp; ! grep -E "FAIL|failed|✗" /tmp/patch223-t1.log | grep -v -E "^\s*(0 failed|passed with 0 failed|✓)"</automated>
  </verify>
  <done>
    handleSpeak + handleListVoices exist as named exports in voice.ts; POST /speak + GET /voices are mounted with authenticateJWT; identities.voice column exists in both the drizzle schema AND the CREATE TABLE block AND migrateSchema(); IdentityMetadata + parseMultipartMetadata + POST + PUT + publicIdentity all handle voice; voice.test.ts covers all 11 backend behaviors (A-K); both `npm run build:backend` and `npm run build` succeed; the target vitest file is 0-failed; commit landed on feat/tab-title-from-tmux.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Frontend — voice-api client + ChatMessage speaker button on assistant bubbles</name>
  <files>
    src/ui/api/voice-api.ts,
    src/ui/api/identities-api.ts,
    src/ui/features/pretty-view/ChatMessage.tsx,
    src/ui/features/pretty-view/PrettyView.tsx,
    src/ui/features/pretty-view/ChatMessage.speak.test.tsx
  </files>
  <behavior>
    voice-api.ts:
    - postSpeak(text, voice?) resolves to a Blob (audio/wav) when the server returns 200 with wav bytes
    - postSpeak omits the voice field from the request body when the caller omits it (server-side default applies)
    - getVoices() resolves to { display_name, filename }[] on 200

    ChatMessage.speak.test.tsx:
    - Test 1: role="assistant" renders exactly one button with aria-label /speak/i inside the bubble
    - Test 2: role="user" renders NO speak button (queryByLabelText(/speak/i) is null)
    - Test 3: clicking the speak button calls postSpeak with the bubble's text content
    - Test 4: while postSpeak is pending, the button renders the Loader2 spinner (icon swap); after resolution, it returns to Volume2
    - Test 5: clicking the same button a second time while its audio is playing calls audio.pause() and releases the URL (concurrent-playback guard)
    - Test 6: clicking a DIFFERENT assistant bubble while one is playing pauses the first and starts the second

    Mocking rules (per patch #211 lesson):
    - MUST mock HTMLAudioElement globally with a play() that returns Promise.resolve() (jsdom's Audio returns undefined and tanks tests via unhandled rejection on `.catch`)
    - MUST mock fetch / axios blob response
  </behavior>
  <action>
    Create `src/ui/api/voice-api.ts`:
    - Import `authApi` and `handleApiError` from `@/main-axios` (mirror `identities-api.ts` line 1).
    - Export `async function postSpeak(text: string, voice?: string): Promise&lt;Blob&gt;`. Body: `try { const body: { text: string; voice?: string } = { text }; if (voice) body.voice = voice; const response = await authApi.post("/voice/speak", body, { responseType: "blob" }); return response.data as Blob; } catch (error) { handleApiError(error, "speak message"); }`.
    - Export `async function getVoices(): Promise&lt;{ display_name: string; filename: string }[]&gt;`. Body: `try { const response = await authApi.get("/voice/voices"); return response.data as { display_name: string; filename: string }[]; } catch (error) { handleApiError(error, "list voices"); }`.
    - Export `const SAMPLE_PHRASE = "Hi, this is your voice.";` — colocated here so both the bubble and the modal import it from the same module (single source of truth mirroring the backend constant; do NOT drift the two strings).

    Extend `src/ui/api/identities-api.ts`:
    - Add `voice: string | null;` to the `Identity` interface (line 3-14) after `colorHue`.
    - Add `voice?: string | null;` to the `IdentityInput` interface (line 16-21) after `colorHue`.

    Extend `src/ui/features/pretty-view/ChatMessage.tsx`:
    - Add prop `identityVoice?: string | null` to the ChatMessage signature (line 38-44). Default handling: `identityVoice: identityVoice = null` in destructure.
    - Import `Volume2, Loader2` from `lucide-react` (extend the existing `import { ThumbsUp } from "lucide-react";` line — combine into one import).
    - Import `postSpeak` from `@/api/voice-api`.
    - Add a module-scoped ref pattern to track single-active playback across all bubble instances: at the top of the file, add `let currentAudio: HTMLAudioElement | null = null; let currentAudioUrl: string | null = null; let currentAudioOwner: symbol | null = null;` (module-level, NOT React state — one-active-playback is a page-global invariant).
    - Inside the ChatMessage function body BEFORE the `return`, define `const bubbleIdRef = React.useRef(Symbol("speak-bubble"));` and `const [speakState, setSpeakState] = React.useState&lt;"idle" | "loading" | "playing"&gt;("idle");`. (Add `import React from "react"` or `import { useRef, useState } from "react"` at the top — check what the file already imports; extend rather than duplicate.)
    - Add an `async function onSpeakClick(e)` handler that: (a) `e.stopPropagation();` (b) if speakState === "playing" AND currentAudioOwner === bubbleIdRef.current → pause + revoke + reset state + return; (c) if currentAudio → pause + revoke + null it out; (d) setSpeakState("loading"); (e) derive text: prefer `containerRef.current?.innerText ?? processedContent` — add a `const containerRef = useRef&lt;HTMLDivElement&gt;(null);` attached to the inner bubble div; (f) `const blob = await postSpeak(text, identityVoice ?? undefined);` (omit voice when null so backend uses DEFAULT_VOICE); (g) `const url = URL.createObjectURL(blob); const audio = new Audio(url); currentAudio = audio; currentAudioUrl = url; currentAudioOwner = bubbleIdRef.current; audio.onended = () => { URL.revokeObjectURL(url); if (currentAudioOwner === bubbleIdRef.current) { currentAudio = null; currentAudioUrl = null; currentAudioOwner = null; setSpeakState("idle"); } };`; (h) `Promise.resolve(audio.play()).catch(() =&gt; {});` — CRITICAL patch #211 lesson: NEVER `audio.play().catch(...)` directly (jsdom returns undefined; `.catch` on undefined throws); (i) setSpeakState("playing"). Wrap in try/catch — on error, setSpeakState("idle") and null out the module refs.
    - Add `useEffect(() =&gt; () =&gt; { if (currentAudioOwner === bubbleIdRef.current) { currentAudio?.pause(); if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl); currentAudio = null; currentAudioUrl = null; currentAudioOwner = null; } }, [])` for unmount cleanup.
    - Render the button ONLY when `!isUser`: inside the inner bubble div (the one with all the class chains, line ~82-131), ensure it has `style={{ position: "relative" }}` (add inline if not present — verify the existing className doesn't already do this via a tailwind class; if `relative` is already in the className chain, skip). Attach `ref={containerRef}` to that same div. After the ternary render (line ~190, after the closing `}` of the `injected ? ... : ( ... )` block), add:
      `{!isUser && (<button type="button" onClick={onSpeakClick} aria-label={speakState === "playing" ? "Stop speaking" : "Speak message"} style={{ position: "absolute", right: 6, bottom: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,220,170,0.72)", opacity: 0.62, cursor: "pointer", transition: "opacity 120ms, background 120ms, transform 80ms" }} className="hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]">{speakState === "loading" ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}</button>)}`
    - Verify lucide-react version compatibility: the file/repo is pinned to lucide-react 1.28.0 per full task context — Volume2 + Loader2 are stable in that version; use default `size={16}` prop rather than className width/height tokens that may not exist in older versions.

    Extend `src/ui/features/pretty-view/PrettyView.tsx` at the `<ChatMessage role={m.role} content={m.content} />` call site (line ~1261-1264): add `identityVoice={pvIdentity?.voice ?? null}`. `pvIdentity` is already destructured from `useSessionIdentity(tmuxSession)` on line 509. This is the only PrettyView change.

    Create `src/ui/features/pretty-view/ChatMessage.speak.test.tsx` (new file):
    - `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"; import { render, screen, fireEvent, waitFor } from "@testing-library/react"; import { ChatMessage } from "./ChatMessage";`
    - vi.mock the `@/api/voice-api` module: `vi.mock("@/api/voice-api", () =&gt; ({ postSpeak: vi.fn(async () =&gt; new Blob([new Uint8Array([1,2,3])], { type: "audio/wav" })), getVoices: vi.fn(async () =&gt; []), SAMPLE_PHRASE: "Hi, this is your voice." }));`
    - Global Audio mock in beforeEach: `vi.stubGlobal("Audio", class MockAudio { src: string; onended: (() =&gt; void) | null = null; constructor(src: string) { this.src = src; } play() { return Promise.resolve(); } pause() {} });` and `vi.stubGlobal("URL", { createObjectURL: vi.fn(() =&gt; "blob:mock"), revokeObjectURL: vi.fn() });` — do NOT rely on jsdom's built-in Audio (returns undefined from .play(); see patch #211).
    - Cover behaviors 1-6 above using getByLabelText / queryByLabelText matches on /speak|stop/i and vi mock call assertions.

    Verify:
    - MANDATORY per Fleet rule (this task also touches types shared with the backend via the transport contract; the safety net is cheap): `npm run build:backend && npm run build`. Frontend `tsc --noEmit` alone insufficient (patch #154 lesson).
    - `npm test -- src/ui/features/pretty-view/ChatMessage.speak.test.tsx` — all 6 tests pass.
    - Full suite + grep guard: `npm test 2>&1 | tee /tmp/patch223-t2.log; grep -E "FAIL|failed|✗" /tmp/patch223-t2.log` returns no non-benign hits.
    - Commit atomically: `git commit -m "patch #223: frontend voice-api + ChatMessage speak button on assistant bubbles"`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run build:backend &amp;&amp; npm run build &amp;&amp; npm test -- src/ui/features/pretty-view/ChatMessage.speak.test.tsx 2>&amp;1 | tee /tmp/patch223-t2.log &amp;&amp; ! grep -E "FAIL|failed|✗" /tmp/patch223-t2.log | grep -v -E "^\s*(0 failed|passed with 0 failed|✓)"</automated>
  </verify>
  <done>
    voice-api.ts exports postSpeak + getVoices + SAMPLE_PHRASE; identities-api.ts Identity + IdentityInput carry `voice`; ChatMessage renders a Volume2 speaker button only on assistant bubbles with the exact visual spec (rgba(0,0,0,0.28) bg / 62% opacity / hover-to-100%); click behavior uses `Promise.resolve(audio.play()).catch(() =&gt; {})` — verified by grep to appear literally in ChatMessage.tsx; concurrent-playback module-level refs are wired; PrettyView threads `identityVoice={pvIdentity?.voice ?? null}` to ChatMessage; ChatMessage.speak.test.tsx passes all 6 tests; both builds green; commit landed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Frontend — IdentityModal voice picker + tasting-sample button + save-payload wiring</name>
  <files>
    src/ui/features/pretty-view/IdentityModal.tsx,
    src/ui/features/pretty-view/IdentityModal.voice.test.tsx
  </files>
  <behavior>
    - Test 1: on modal open, getVoices() is called exactly once and the returned list populates the &lt;select&gt; options (in addition to a leading "(default)" option with value="")
    - Test 2: the &lt;select&gt;'s current value reflects `identity.voice` on mount (null → "(default)"; a filename string → that filename)
    - Test 3: changing the dropdown updates local state without immediately calling updateIdentity
    - Test 4: clicking the sample button calls postSpeak(SAMPLE_PHRASE, currentDropdownValue || undefined) — omit voice when "(default)" is selected
    - Test 5: clicking Save with a changed voice calls updateIdentity(id, { ..., voice: "Elena.wav" }, avatarFile) — the voice appears in the multipart "data" JSON
    - Test 6: clicking Save with the dropdown reset to "(default)" calls updateIdentity with `voice: null` in the meta object (explicit-clear semantics mirror colorHue)
  </behavior>
  <action>
    Extend `src/ui/features/pretty-view/IdentityModal.tsx`:
    - Import `Volume2` from lucide-react (extend the existing lucide import — do NOT add a duplicate import line).
    - Import `postSpeak, getVoices, SAMPLE_PHRASE` from `@/api/voice-api`.
    - Add new state (near line 168-173, in the identity-editor-state cluster):
      `const [voices, setVoices] = useState&lt;{ display_name: string; filename: string }[]&gt;([]);`
      `const [voiceDraft, setVoiceDraft] = useState&lt;string&gt;(identity.voice ?? "");`  // "" == "(default)"
      `const [committedVoice, setCommittedVoice] = useState&lt;string | null&gt;(identity.voice ?? null);`
    - Add a new useEffect near the existing `useEffect(() =&gt; { ... }, [open, identity.id, identity.title]);` block (line ~361) — mount-scoped voices fetch:
      `useEffect(() =&gt; { if (!open) return; let cancelled = false; getVoices().then((list) =&gt; { if (!cancelled) setVoices(list); }).catch(() =&gt; { if (!cancelled) setVoices([]); }); return () =&gt; { cancelled = true; }; }, [open]);`
    - Add reset of voiceDraft + committedVoice inside the existing open-reset useEffect (line ~361-371): `setVoiceDraft(identity.voice ?? ""); setCommittedVoice(identity.voice ?? null);` and extend the effect's dep array to include `identity.voice`.
    - Add a shared sample-playback ref at the top of the component: `const sampleAudioRef = useRef&lt;HTMLAudioElement | null&gt;(null); const sampleUrlRef = useRef&lt;string | null&gt;(null);`. Add unmount cleanup useEffect that pauses + revokes.
    - Define `async function onSampleClick() { try { if (sampleAudioRef.current) { sampleAudioRef.current.pause(); if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current); sampleAudioRef.current = null; sampleUrlRef.current = null; } const blob = await postSpeak(SAMPLE_PHRASE, voiceDraft || undefined); const url = URL.createObjectURL(blob); const audio = new Audio(url); sampleAudioRef.current = audio; sampleUrlRef.current = url; audio.onended = () =&gt; { URL.revokeObjectURL(url); if (sampleAudioRef.current === audio) { sampleAudioRef.current = null; sampleUrlRef.current = null; } }; Promise.resolve(audio.play()).catch(() =&gt; {}); } catch { /* swallow — handleApiError already logs */ } }`. CRITICAL: `Promise.resolve(audio.play()).catch(...)` — patch #211 lesson.
    - In the Identity tab render body around line ~908 (BETWEEN the Title input block and the inline-error block), insert a new "Voice" row:
      ```
      <div className="mb-3">
        <label className="block text-xs text-[var(--color-pv-fg-muted)] mb-1" htmlFor="identity-voice-select">Voice</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            id="identity-voice-select"
            value={voiceDraft}
            onChange={(e) =&gt; setVoiceDraft(e.target.value)}
            disabled={saving}
            style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(220,225,245,0.15)", borderRadius: 6, padding: "6px 10px", color: "#f0ebe0", fontSize: "0.875rem", outline: "none" }}
          >
            <option value="">(default)</option>
            {voices.map((v) =&gt; (<option key={v.filename} value={v.filename}>{v.display_name}</option>))}
          </select>
          <button
            type="button"
            aria-label="Sample voice"
            onClick={() =&gt; { void onSampleClick(); }}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,220,170,0.72)", opacity: 0.62, cursor: "pointer" }}
            className="hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
          >
            <Volume2 size={16} />
          </button>
        </div>
      </div>
      ```
    - In `onSave` (line ~643-671), extend the meta-diff block: after the existing `if (titleDraft !== committedTitle) { meta.title = ...; }` line, add:
      `if ((voiceDraft || null) !== committedVoice) { meta.voice = voiceDraft === "" ? null : voiceDraft; }`.
      After the `setCommittedTitle(newTitle);` line, add: `setCommittedVoice(updated.voice ?? null); setVoiceDraft(updated.voice ?? "");`.
    - In the Save-disabled predicate (line ~922-925), extend: change `titleDraft === committedTitle && avatarFile === null` to `titleDraft === committedTitle && avatarFile === null && (voiceDraft || null) === committedVoice`.
    - In `onCancel` (line ~675-683), add: `setVoiceDraft(committedVoice ?? "");`.

    Create `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` — test the six behaviors above using `render(<IdentityModal open={true} identity={mockIdentity} ... />)` with vi.mock of `@/api/voice-api` and `@/api/identities-api`, plus the same Audio + URL globals stubbed as in ChatMessage.speak.test.tsx. Mock `getVoices` to return `[{ display_name: "Elena", filename: "Elena.wav" }, { display_name: "Marcus", filename: "Marcus.wav" }]`. Mock `updateIdentity` to record its args for assertion. Mount identity fixtures with `voice: null` (Test 2 default case) and `voice: "Elena.wav"` (Test 2 preselected case).

    Note on IdentityModal test harness: the modal has substantial WS/artifact-fetch machinery in its mount effect. If a bare render fails due to missing hostId / openClaudeSessionSocket, follow the pattern in any existing IdentityModal test file (grep for `IdentityModal.*test`) and reuse its mocks. If no existing test file, mock `openClaudeSessionSocket` from wherever it's imported to return a minimal stub with `onopen/onmessage/onerror/onclose/send/close` no-ops.

    Verify:
    - MANDATORY per Fleet rule: `npm run build:backend && npm run build`.
    - `npm test -- src/ui/features/pretty-view/IdentityModal.voice.test.tsx` — all 6 tests pass.
    - Full suite + grep guard: `npm test 2>&1 | tee /tmp/patch223-t3.log; grep -E "FAIL|failed|✗" /tmp/patch223-t3.log` returns no non-benign hits.
    - Commit atomically: `git commit -m "patch #223: IdentityModal voice picker + sample button"`.
    - After commit lands, bare `git push origin feat/tab-title-from-tmux` per Ashley's fork-refinement authorization (2026-07-30). Do NOT trigger any build/deploy motion — Ashley batches deploys separately (#198→#222+ held).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run build:backend &amp;&amp; npm run build &amp;&amp; npm test -- src/ui/features/pretty-view/IdentityModal.voice.test.tsx 2>&amp;1 | tee /tmp/patch223-t3.log &amp;&amp; ! grep -E "FAIL|failed|✗" /tmp/patch223-t3.log | grep -v -E "^\s*(0 failed|passed with 0 failed|✓)"</automated>
  </verify>
  <done>
    IdentityModal renders a Voice row (dropdown + 32px sample button) in the Identity tab between Title and the inline-error slot; getVoices() is called once on modal open and populates the &lt;select&gt;; a leading "(default)" option exists with value=""; the current selection reflects `identity.voice`; sample button plays SAMPLE_PHRASE with the currently-selected value (voice omitted when "(default)"); Save posts `voice` (or `null`) in the multipart "data" field via updateIdentity's meta; Save button disabled predicate accounts for voiceDraft changes; onCancel reverts voiceDraft; IdentityModal.voice.test.tsx passes all 6 tests; both builds green; commit landed; bare push to origin succeeded.
  </done>
</task>

</tasks>

<verification>
Cross-task phase-level checks — run AFTER Task 3 commits land:

1. Full test suite is green AND log-grep clean:
   ```
   npm test 2>&1 | tee /tmp/patch223-final.log
   grep -E "FAIL|failed|✗" /tmp/patch223-final.log
   ```
   The grep must return no matches (or only benign "0 failed" summary lines). Patch #211 lesson: an unhandled rejection from a bad audio.play() catch chain can tank tests silently despite "0 failed" in the summary line.

2. Both TypeScript builds green (backend + frontend — patch #154 lesson that frontend `tsc --noEmit` alone is insufficient):
   ```
   npm run build:backend && npm run build
   ```
   Exit code 0 for the combined command.

3. Sanity greps to confirm the patch #211 anti-pattern was avoided AND the play() pattern was used:
   ```
   grep -n "audio\.play()\.catch" src/ui/features/pretty-view/ChatMessage.tsx src/ui/features/pretty-view/IdentityModal.tsx
   ```
   MUST return zero matches (the bare-catch anti-pattern).
   ```
   grep -n "Promise\.resolve(audio\.play())\.catch" src/ui/features/pretty-view/ChatMessage.tsx src/ui/features/pretty-view/IdentityModal.tsx
   ```
   MUST return two matches (one per file — the correct pattern).

4. Sanity grep to confirm the identities voice column landed in all three places:
   ```
   grep -n "voice" src/backend/database/db/schema.ts src/backend/database/db/index.ts | grep -v "^#"
   ```
   MUST show `voice` in the drizzle identities table, the CREATE TABLE identities block, and an addColumnIfNotExists("identities", "voice", "TEXT") line in migrateSchema().

5. Route wiring check:
   ```
   grep -n "router\.(post|get)" src/backend/database/routes/voice.ts
   ```
   MUST show three routes: `/transcribe` (existing), `/speak` (new), `/voices` (new).

6. Git log — three atomic commits in order:
   ```
   git log --oneline -3
   ```
   Should show (newest first): IdentityModal voice picker → frontend speak button → backend /voice/speak.

7. NO deploy/build motion on skynet-ec2 (per Ashley's greenlight-only-for-code rule). Ashley batches deploys separately.
</verification>

<success_criteria>
- Backend: POST /voice/speak returns 200 audio/wav for a valid { text, voice? } body; returns 400 for missing/oversize text or bad-shape voice; returns upstream-status for TTS non-2xx (no body leak); returns 504 for AbortError. GET /voice/voices returns the Chatterbox list verbatim on 200. Both routes are authenticateJWT-gated.
- Schema: identities.voice column exists as nullable TEXT in the drizzle schema, the CREATE TABLE block, AND migrateSchema()'s addColumnIfNotExists call (all three places — fresh installs AND existing installs pick it up).
- Identity route: parseMultipartMetadata + POST + PUT + publicIdentity all round-trip voice through the multipart "data" field (mirroring colorHue's conditional-block pattern with a regex validator).
- Frontend api: postSpeak(text, voice?) returns Blob; getVoices() returns { display_name, filename }[]; SAMPLE_PHRASE constant is a single source of truth.
- ChatMessage: SpeakButton renders on assistant bubbles only (never on user bubbles); click plays audio via `Promise.resolve(audio.play()).catch(() =&gt; {})`; concurrent-playback via module-level refs; loading state swaps Volume2 ↔ Loader2; visual spec matches the console-snippet-scratch (rgba(0,0,0,0.28) bg, 62% opacity, hover-to-100%, 28x28 button).
- IdentityModal: voice dropdown seeded from getVoices() with a leading "(default)" option; current selection reflects identity.voice; sample button plays SAMPLE_PHRASE with the currently-selected voice (omit when default); Save posts voice (or null) in the multipart data field; Save disabled predicate correctly gates on voiceDraft changes.
- Tests: voice.test.ts covers 11 backend behaviors; ChatMessage.speak.test.tsx covers 6 frontend behaviors; IdentityModal.voice.test.tsx covers 6 modal behaviors. All pass. Full suite is 0-failed AND grep-clean.
- Both `npm run build:backend` and `npm run build` succeed.
- Three atomic commits landed on feat/tab-title-from-tmux; bare push to origin succeeded. No worktree used (Ashley fleet rule).
- NO deploy/build/recreate motion on skynet-ec2 (greenlight-only-for-code-work rule).
</success_criteria>

<output>
Create `.planning/quick/260731-khv-patch-223-speak-messages-click-to-speak-/260731-khv-SUMMARY.md` when done (per /gsd:quick output convention).
</output>
