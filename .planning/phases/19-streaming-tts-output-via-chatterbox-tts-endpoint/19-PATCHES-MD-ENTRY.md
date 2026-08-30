# Patch #237 — Streaming TTS output via Chatterbox /tts endpoint (Phase 19)

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`

**Paste timing:** Only after Ashley greenlights the batched deploy that includes patch #237. Patch #237 does NOT ship standalone — it rides the same rebuild + recreate as the pending #198→#236 queue (~57 unpushed-to-container commits per 19-CONTEXT.md § Deploy discipline).

**Ordinal position on paste:** The header line currently reads "TWO HUNDRED AND THIRTY-FIVE numbered patches" (line 17, verified by grep on 2026-07-31). On paste, update to "TWO HUNDRED AND THIRTY-SEVEN numbered patches" (or to the accurate count if additional patches landed between now and ship day — patch #237 is the next in sequence after #236, so the increment is +2 from #235 to #237). If the phrasing is out of date at paste time, normalize to the correct count.

**Grep to verify current count before pasting:**
```
grep -c "^## Patch #" ~/.claude/identities/tina/skynet-patches.md
```
(Returns 69 as of 2026-07-31 — the file has 69 titled entries but the header line says 235 numbered patches; not all patches have a full write-up entry. Both counts may have advanced by ship day.)

**No Co-Authored-By trailer** — fork convention (patterns from patches #232, #235, #236).

---

## Draft (paste-ready)

## Patch #237 — Streaming TTS output via Chatterbox /tts endpoint (Phase 19; pretty-view bubble speak-button; buffered /voice/speak route + IdentityModal voice-preview preserved byte-for-byte)

- **Motivation** (Ashley 2026-07-31, direct scope-lock session): Nelly's streaming Chatterbox demo (https://gigaashley.click/tts-demo/) starts playing audio within ~30ms of clicking; Skynet's current buffered TTS path (patch #223) waits for the entire WAV synthesis to complete before starting playback. On a long assistant message, that is the difference between "instant" and "seconds of dead air." Ashley heard the demo and said "night and day" vs the buffered path. Same-day iOS Safari Web Audio spike on her iPhone PWA passed — no iOS-specific workaround needed. Ashley scope-lock verbatim: "the message bubble speak button would stream, and I don't really feel like we have to have the voice preview stream."

- **Root cause vs previous approach**: Patch #223 (`handleSpeak` in `src/backend/database/routes/voice.ts`) does `Buffer.from(await response.arrayBuffer())` on the Chatterbox response, then `res.end(buf)`. Server-side full-buffer + client-side `URL.createObjectURL(blob)` + `new Audio(url).play()`. Chatterbox's `/tts` endpoint (NOT the OpenAI-compat `/v1/audio/speech` — different endpoint, different body schema; `stream:true` only works on `/tts`) supports chunked-transfer streaming with a `0xFFFFFFFF` sentinel in the RIFF file-size field. Piping the response through server-side and progressively decoding chunks on the client via Web Audio API preserves the streaming property end-to-end.

- **Fix summary — backend streaming route** (TTSSTR-01, TTSSTR-02): New `handleSpeakStream` function + `POST /voice/speak-stream` route in `src/backend/database/routes/voice.ts`, mirroring the structure of `handleSpeak` (patch #223) but replacing the `Buffer.from(await response.arrayBuffer()); res.end(buf)` block with `Readable.fromWeb(response.body).pipe(res)`. Sets response headers `Content-Type: audio/wav` and `X-Accel-Buffering: no` before the pipe starts (defense-in-depth against downstream reverse-proxy buffering). Request-body schema translation happens server-side: Skynet client sends `{text, voice?}` (same as buffered route); backend forwards to Chatterbox as `{text, voice_mode:"predefined", predefined_voice_id: voice ?? "Elena.wav", stream:true, split_text:true, chunk_size:80}`. Reuses existing `VOICE_FILENAME_RE` (`/^[A-Z][A-Za-z]+\.wav$/`) and `SPEAK_TEXT_MAX` (25000) constants. Default voice stays `Elena.wav` (unchanged from patch #223 — Ashley: "we're not gonna switch our default voice just because nelly picked a random one to do the demo with"). Upstream URL is `http://100.80.122.111:8001/tts` (NOT `/v1/audio/speech`).

- **Fix summary — security parity with patch #223** (TTSSTR-07): `authenticateJWT` middleware wired before `express.json` (T-16-04 pattern from `handleTranscribe`). 300s `AbortController` on the upstream fetch (matches patch #223 cap; TTS synthesis of long text can take minutes). Non-2xx upstream returns fixed shape `{error:"TTS stream non-2xx", status:<upstream.status>}` — no upstream body leak (T-16-03 analog). AbortError → 504 `{error:"TTS stream timeout", status:504}`. Other exceptions → 502 `{error:"TTS stream proxy error", status:502}`. Existing `handleSpeak` function and `POST /voice/speak` route preserved BYTE-FOR-BYTE; IdentityModal voice-preview at `src/ui/features/pretty-view/IdentityModal.tsx:783` continues to call `postSpeak()` — the one-shot 25-word sample does not benefit from streaming and the buffered path already works there.

- **Fix summary — nginx exact-match location** (TTSSTR-03): New `location = /voice/speak-stream` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (per CLAUDE.md caveat: matching location blocks required in both files, else the route 200s with index.html and crashes the frontend on `.map`). Block directives: `proxy_buffering off; proxy_request_buffering off; chunked_transfer_encoding on; proxy_read_timeout 300s;`. Exact-match `location =` takes priority over the pre-existing regex `location ~ ^/voice(/.*)?$` block used by `/voice/speak`, `/voice/transcribe`, `/voice/voices` — so the existing block stays byte-for-byte unchanged (patch #232's 300s tuning preserved). Caddy edge streams chunked-transfer by default.

- **Fix summary — frontend fetch helper** (TTSSTR-04): New `postSpeakStream(text: string, voice?: string): Promise<Response>` in `src/ui/api/voice-api.ts`. Uses `fetch()` (not axios — the streaming body reader requires the raw `Response` object). Returns `Promise<Response>` (caller drives the read loop). JWT manually attached via `Authorization: Bearer ${token}` header, token pulled from `localStorage.getItem("jwt")` (same source `main-axios.ts:343` axios interceptor uses). Existing `postSpeak()` axios/blob helper preserved unchanged (IdentityModal voice-preview keeps using it).

- **Fix summary — frontend Web Audio player** (TTSSTR-05, TTSSTR-06): `src/ui/features/pretty-view/ChatMessage.tsx` speak-button handler swapped from `postSpeak → URL.createObjectURL(blob) → new Audio(url).play()` to `postSpeakStream() → response.body.getReader()` loop → RIFF header parse (44 bytes; streaming sentinel `0xFFFFFFFF` in file-size field handled without validation failure) → per-chunk `AudioBuffer` allocation → `AudioBufferSourceNode` scheduled via running `nextStartTime` clock so consecutive chunks play back-to-back gaplessly. Pattern lifted from Nelly's demo view-source per her explicit permission. RIFF parser + PCM Int16→Float32 decoder extracted as pure functions in `riffPcmDecode.ts` with unit tests (10 cases including streaming sentinel, stereo deinterleave, partial-frame truncation). Web Audio scheduling encapsulated in a `createWebAudioStreamPlayer` factory in `webAudioStreamPlayer.ts` with 7 unit tests using a mocked AudioContext (patch #211 lesson: jsdom lies about Web Audio; keep the scheduling layer mockable). Cross-bubble Stop / new-bubble-preempt semantics preserved: module-level singleton adapted from `{currentAudio, currentAudioUrl, currentAudioOwner}` to `{currentPlayer, currentOwner}`; starting a new bubble stops the previous player's sources + cancels the reader + closes the AudioContext. Error handling: fetch and mid-stream errors abort scheduled sources + close context + revert `speakState` to idle without ugly click or trailing audio. NO auto-retry (would risk stuttering/doubled audio). Losing the `dbHealthMonitor.isBackendUnreachable` auto-toast integration on the streaming path is an accepted tradeoff — that integration is axios-specific and streaming errors are semantically different from database-unreachable.

- **Requirements delivered:** TTSSTR-01 (streaming latency), TTSSTR-02 (Chatterbox /tts streaming endpoint + schema translation), TTSSTR-03 (nginx location block), TTSSTR-04 (fetch helper + JWT), TTSSTR-05 (Web Audio progressive decode), TTSSTR-06 (cross-bubble preempt + stop), TTSSTR-07 (security parity + buffered path preserved byte-for-byte).

- **Request-body schema translation table:**

  | Field (client-side POST /voice/speak-stream) | Field (server-side POST http://100.80.122.111:8001/tts) | Value |
  |---|---|---|
  | text | text | (verbatim) |
  | voice (optional) | predefined_voice_id | voice ?? "Elena.wav" |
  | — | voice_mode | "predefined" |
  | — | stream | true |
  | — | split_text | true |
  | — | chunk_size | 80 |

- **Files touched:**
  - `src/backend/database/routes/voice.ts` — `+~60 lines` (handleSpeakStream function + TTS_STREAM_URL constant + POST /voice/speak-stream route)
  - `src/backend/database/routes/voice.test.ts` — `+~140 lines` (describe("handleSpeakStream") block, 11 tests SA/SA2/SB/SC/SD/SE/SF/SG/SH/SI/SJ + MockRes streaming shim: write/setHeader/on/once/emit no-ops for `Readable.pipe(res)`)
  - `docker/nginx.conf` — `+~15 lines` (`location = /voice/speak-stream` block; patch #237 comment header)
  - `docker/nginx-https.conf` — `+~15 lines` (identical block)
  - `src/ui/api/voice-api.ts` — `+~15 lines` (`postSpeakStream` export)
  - `src/ui/api/voice-api.test.ts` — `+~90 lines` (new file, 8 tests)
  - `src/ui/features/pretty-view/riffPcmDecode.ts` — new file, ~60 lines (pure `parseRiffHeader()` + `decodePcmChunk()` + `RiffHeader` type)
  - `src/ui/features/pretty-view/riffPcmDecode.test.ts` — new file, ~130 lines (10 tests)
  - `src/ui/features/pretty-view/webAudioStreamPlayer.ts` — new file, ~130 lines (`createWebAudioStreamPlayer` factory)
  - `src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` — new file, ~200 lines (7 tests, mocked AudioContext)
  - `src/ui/features/pretty-view/ChatMessage.tsx` — `~-30/+40 lines` (singleton adapted; imports swapped; onSpeakClick body rewritten; JSX untouched)
  - `src/ui/features/pretty-view/ChatMessage.test.tsx` — `+~120 lines` (new `describe("ChatMessage speak state machine (Phase 19 / patch #237)")` block with Tests 18, 19, 20, 21; all 11 pre-existing tests preserved unmodified — Tests 9, 10, 11, 12, 13 (Phase 05 chip-render), Tests 14, 14b, 14c (patch #107 quick-reply), Tests G, H, I (copy-button))
  - `src/ui/features/pretty-view/ChatMessage.speak.test.tsx` — adapted: mocks swapped from `postSpeak`+`HTMLAudioElement` to `postSpeakStream`+`createWebAudioStreamPlayer` (Rule 1 auto-fix: test file was broken by the speak-handler swap)

- **Test count summary (Phase 19 total across all four plans):**

  | File | Tests | Category |
  |------|-------|----------|
  | voice.test.ts (handleSpeakStream block) | 11 | Backend streaming route (Plans 01) |
  | voice-api.test.ts | 8 | Frontend fetch helper (Plan 03) |
  | riffPcmDecode.test.ts | 10 | Pure RIFF/PCM decoder (Plan 04) |
  | webAudioStreamPlayer.test.ts | 7 | Web Audio scheduling (Plan 04) |
  | ChatMessage.test.tsx Tests 18-21 | 4 | Speak state machine (Plan 04) |
  | ChatMessage.speak.test.tsx | 6 | Adapted from patch #223 path (Plan 04, Rule 1) |
  | **Phase 19 total** | **46** | All passing as of 2026-07-31 full suite run |

  Full suite as of commit `53640eb` (Plan 04 tip): **1016 passed / 6 skipped / 0 failed across 85 files** (`npx vitest run`, 2026-07-31T23:54:57Z).

- **Rebase risk:** LOW. Purely additive backend route, additive nginx block, additive frontend module + swap-one-caller. No upstream Skynet surfaces touched; the two files that DO change (`voice.ts` in the routes directory added by patch #155 fork-local, `ChatMessage.tsx` in the fork-local `pretty-view/` directory added by Phase 1) are both fork-local surfaces with no upstream diff.

- **Deploy note:** Bundles with the held #198→#236 queue (~57 unpushed-to-container commits per 19-CONTEXT.md § Deploy discipline). Rides the same `docker compose up -d --force-recreate skynet` whenever Ashley greenlights. Ashley pre-warns of the HTTP2_PROTOCOL_ERROR on first hard-refresh post-recreate (patch #232 discovery). No standalone deploy for patch #237.

- **UAT plan:** 7-item checklist covering TTSSTR-01..07, see `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md`. Summary: (1) TTSSTR-01/05 streaming latency perceptible on long messages, (2) TTSSTR-06 cross-bubble preempt, (3) TTSSTR-06 same-bubble stop, (4) TTSSTR-07 buffered path still works for IdentityModal voice preview, (5) TTSSTR-03 nginx routes /voice/speak-stream correctly (curl smoke test), (6) TTSSTR-04 JWT auth enforced on streaming route, (7) TTSSTR-01/02 default voice stays Elena.wav.

- **See also:** patch #223 (buffered TTS shipped — this patch preserves it byte-for-byte on the IdentityModal path), patch #231 (TTS timeout bump — 30s→300s that enables long-message synthesis without toast), patch #232 (nginx /voice proxy_read_timeout 60s→300s — the layer this streaming route's nginx block inherits its 300s timeout from).
