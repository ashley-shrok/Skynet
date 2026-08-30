---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: 05
type: execute
wave: 4
depends_on:
  - 19-01
  - 19-02
  - 19-03
  - 19-04
files_modified:
  - .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md
  - .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md
  - .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md
autonomous: false
requirements:
  - TTSSTR-01
  - TTSSTR-02
  - TTSSTR-03
  - TTSSTR-04
  - TTSSTR-05
  - TTSSTR-06
  - TTSSTR-07
tags:
  - deploy
  - patches-md
  - uat
  - build-verify
  - human-verify
  - voice

must_haves:
  truths:
    - "Full `npm run build` (Vite production build) succeeds with the Phase 19 changes — output captured to 19-BUILD-VERIFY-LOG.md"
    - "Full test suite (`npx vitest run`) passes across the whole repo — regression-free"
    - "TypeScript check (`npx tsc --noEmit`) is clean repo-wide"
    - "19-UAT-CHECKLIST.md walks all 7 TTSSTR requirements as end-to-end verifiable items for Ashley to check post-deploy on production Skynet"
    - "19-PATCHES-MD-ENTRY.md is a paste-ready patch #237 entry for `~/.claude/identities/tina/skynet-patches.md` following the exact shape of recent entries (#231, #232, #235, #236)"
    - "Deploy is EXPLICITLY HELD until Ashley greenlights — no `docker compose up -d --force-recreate skynet` runs in this plan"
    - "Human-verify checkpoint captures Ashley's pre-deploy signoff on the UAT plan (not the deployed result — that's post-ship)"
  artifacts:
    - path: .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md
      provides: "paste-ready patch #237 entry"
      contains: "Patch #237"
    - path: .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md
      provides: "end-to-end verification checklist covering TTSSTR-01..07"
      contains: "TTSSTR-01"
    - path: .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md
      provides: "captured output of `npm run build`, `npx tsc --noEmit`, and `npx vitest run`"
  key_links:
    - from: "19-PATCHES-MD-ENTRY.md"
      to: "~/.claude/identities/tina/skynet-patches.md"
      via: "manual paste at deploy time (Ashley or executor pastes)"
      pattern: "Patch #237"
    - from: "19-UAT-CHECKLIST.md"
      to: "Ashley's post-deploy walkthrough on production Skynet"
      via: "manual UAT after `docker compose up -d --force-recreate skynet`"
      pattern: "TTSSTR-0[1-7]"
---

<objective>
Wrap Phase 19 for ship: run the full build + typecheck + test suite to verify no regressions from Plans 01-04, author the paste-ready `skynet-patches.md` entry for patch #237, author the end-to-end UAT checklist Ashley will walk after deploy, and gate on a human-verify checkpoint for Ashley's pre-deploy signoff on the UAT plan. Deploy itself (`docker compose up -d --force-recreate skynet`) is HELD per the phase context — patch #237 rides the same rebuild whenever Ashley greenlights the pending #198→#236 queue.

Purpose: The bundle from Plans 01-04 is only useful once (a) Ashley has a verifiable checklist to walk after deploy, (b) the patch has a proper skynet-patches.md entry (fork catalog integrity requires numbered ledger — Skynet is a Ship-of-Theseus fork with 236 numbered patches on top of upstream v2.3.x), and (c) the build actually produces a working Vite bundle without regressions. This plan produces those three artifacts + a checkpoint before Ashley greenlights ship.

Output:
- `19-BUILD-VERIFY-LOG.md` — captured output of the build/typecheck/test triad, timestamped.
- `19-PATCHES-MD-ENTRY.md` — paste-ready entry for `~/.claude/identities/tina/skynet-patches.md`, following the shape of #232 (companion nginx patch to a backend patch — the closest analog).
- `19-UAT-CHECKLIST.md` — 7-11 item numbered checklist covering all TTSSTR-01..07 requirements as things Ashley can observe in production Skynet.
- Human-verify checkpoint: Ashley reviews all three artifacts, confirms the UAT plan is complete, greenlights the executor to hand off to her ship workflow.

Non-negotiables (from 19-CONTEXT.md § Deploy discipline + CLAUDE.md § Deploy safety + TTSSTR-07):
- NO deploy commands run in this plan. `docker compose up -d --force-recreate skynet` is Ashley's word; the executor does NOT touch it.
- Patch #237 rides the pending #198→#236 bundle; the entry text should note batched deployment (not standalone).
- No new files added to `src/` — this plan is documentation + verification only.
- 15-min deadman rollback timer is Ashley's post-deploy responsibility per CLAUDE.md; not part of this plan's mechanics.
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
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run full build + typecheck + test suite, capture output to 19-BUILD-VERIFY-LOG.md</name>
  <files>.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md</files>

  <read_first>
    - `package.json` (root) — confirm the build command is `npm run build` and identify the Vite build script; note the `test` script if present. If the project uses a different runner (e.g., `pnpm build`), use whatever the project's canonical build command is.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Deploy discipline (deploy is HELD).
    - Recent phase build-verify logs for shape reference: `.planning/phases/10-pretty-conversations-visual-language-rework/10-BUILD-VERIFY-LOG.md` (if exists) or the pattern used in `.planning/phases/09-compose-box-redesign-2-tall-shell/`.
    - `docker/nginx.conf` and `docker/nginx-https.conf` (both updated by Plan 02) — the nginx-syntax validation step below runs `nginx -t` against each; both files must pass. If Docker is unavailable in the executor's sandbox, escalation path is below (Command 4 acceptance criterion).
  </read_first>

  <action>
    Run the three verification commands from the repo root and capture their output into a new file `19-BUILD-VERIFY-LOG.md`. Use the Bash tool for each command; the output will stream to your context, and you'll paste the relevant tails into the log.

    Commands to run (in order):

    1. `cd /home/ubuntu/skynet && date -u +"%Y-%m-%dT%H:%M:%SZ" && npx tsc --noEmit 2>&1 | tail -30 && echo "TSC_EXIT=$?"`
    2. `cd /home/ubuntu/skynet && date -u +"%Y-%m-%dT%H:%M:%SZ" && npx vitest run 2>&1 | tail -60 && echo "VITEST_EXIT=$?"`
    3. `cd /home/ubuntu/skynet && date -u +"%Y-%m-%dT%H:%M:%SZ" && npm run build 2>&1 | tail -60 && echo "BUILD_EXIT=$?"`

    Note: `npm run build` may take 30-120s. Set the Bash timeout to at least 180000ms.

    Write `19-BUILD-VERIFY-LOG.md` with this structure:

    ```
    # Phase 19 Build Verification Log

    **Executor:** Claude (executor for Plan 05)
    **Timestamp:** <ISO 8601 timestamp from the first `date -u` output>
    **Branch:** feat/tab-title-from-tmux

    ## Command 1: TypeScript strict-mode check

    ```
    $ cd /home/ubuntu/skynet && npx tsc --noEmit
    <last 30 lines of output>
    TSC_EXIT=<0 or non-zero>
    ```

    **Result:** <PASS if exit 0, FAIL otherwise>

    ## Command 2: Full vitest suite

    ```
    $ cd /home/ubuntu/skynet && npx vitest run
    <last 60 lines of output showing test counts, failed tests if any, and final summary line>
    VITEST_EXIT=<0 or non-zero>
    ```

    **Result:** <PASS if exit 0>
    **Test count summary:** <parse the vitest summary line — e.g., "Test Files 42 passed | Tests 318 passed">

    ## Command 3: Vite production build

    ```
    $ cd /home/ubuntu/skynet && npm run build
    <last 60 lines showing the built asset table + "built in Xs" line>
    BUILD_EXIT=<0 or non-zero>
    ```

    **Result:** <PASS if exit 0>
    **Assets emitted:** <parse the built-asset summary — sizes for the main JS/CSS bundles>

    ## Command 4: Nginx syntax validation

    ```
    $ docker run --rm -v $PWD/docker/nginx.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine nginx -t
    <output>
    NGINX_HTTP_EXIT=<0 or non-zero>

    $ docker run --rm -v $PWD/docker/nginx-https.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine nginx -t
    <output>
    NGINX_HTTPS_EXIT=<0 or non-zero>
    ```

    **Result:** <PASS if both exit 0 AND both print `syntax is ok` + `test is successful`; DOCKER_UNAVAILABLE if the docker binary is missing/unreachable here — see escalation note; FAIL if either config has a syntax error>

    <If DOCKER_UNAVAILABLE: "ESCALATED — Ashley MUST run `nginx -t` on skynet-ec2 against both configs BEFORE ship-day `docker compose up -d --force-recreate skynet`. Blocking prerequisite for Task 4 checkpoint approval.">

    ## Overall verdict

    - [ ] TypeScript check: PASS / FAIL
    - [ ] Test suite: PASS / FAIL
    - [ ] Production build: PASS / FAIL
    - [ ] Nginx syntax (both configs): PASS / FAIL / DOCKER_UNAVAILABLE-escalated

    <If all four PASS: "Ready for deploy — hand off to Ashley for greenlight per deploy-runbook.">
    <If any FAIL: "BLOCKING — fix failures before continuing to Task 2/3. Details above.">
    <If Nginx is DOCKER_UNAVAILABLE-escalated but the other three PASS: "PARTIAL — proceed to Task 2/3 for artifact prep; Ashley MUST run nginx -t on skynet-ec2 as a blocking prerequisite before Task 4 signoff.">
    ```

    If any command fails, STOP this plan and route the failure back to the responsible plan:
    - `tsc` fails → check which file's types are broken; if in Plan 01/03/04's file, that plan's executor mis-implemented and needs a revision pass (`/gsd-plan-phase 19 --revise`).
    - `vitest` fails → identify the failing test file; if pre-Phase-19 test, that means Plan 04's ChatMessage.tsx swap regressed the Phase 05 sender-side chip tests → route back to Plan 04.
    - `npm run build` fails → Vite bundling issue; check for any dynamic import syntax errors introduced by Plan 04's `await import("node:stream")` — but that's server-side only and shouldn't reach Vite; if it does, refactor to a top-level import in Plan 01's file.
    - `nginx -t` fails on either config → nginx syntax error; route back to Plan 02 with the exact error line from the nginx output. If DOCKER_UNAVAILABLE, escalate per the note above (do NOT block plan progression, but Task 4 must surface it to Ashley).
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md && grep -c 'TSC_EXIT=0\|VITEST_EXIT=0\|BUILD_EXIT=0' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'PASS\|FAIL' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -cE 'NGINX_(HTTP|HTTPS)_EXIT=0|DOCKER_UNAVAILABLE' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md</automated>
  </verify>

  <acceptance_criteria>
    - `19-BUILD-VERIFY-LOG.md` exists.
    - `grep -c 'TSC_EXIT=0'` in the log >= 1 (TypeScript pass).
    - `grep -c 'VITEST_EXIT=0'` in the log >= 1 (test suite pass).
    - `grep -c 'BUILD_EXIT=0'` in the log >= 1 (Vite build pass).
    - **Nginx syntax validation** (Warning A): `grep -cE 'NGINX_(HTTP|HTTPS)_EXIT=0'` in the log = 2 (both nginx configs pass `nginx -t`) OR `grep -c 'DOCKER_UNAVAILABLE'` in the log >= 1 (docker unavailable in sandbox — escalated to Ashley pre-ship). One of these two conditions MUST hold; both being false is a hard FAIL.
    - Final "Overall verdict" section has all four checkboxes marked (PASS/FAIL/ESCALATED as applicable).
    - If TSC/Vitest/Build fails, the log MUST have "BLOCKING" in the overall verdict AND the executor MUST NOT proceed to Task 2 (routing back to the responsible earlier plan for revision).
    - If Nginx is DOCKER_UNAVAILABLE-escalated but the other three PASS, the log MUST have "PARTIAL" in the overall verdict AND the executor MAY proceed to Task 2/3 (artifact prep is valuable regardless), but Task 4 checkpoint text MUST explicitly surface the nginx-ec2 prerequisite to Ashley for pre-ship sign-off.
  </acceptance_criteria>

  <done>
    All four verification commands executed (tsc, vitest, npm run build, nginx -t × 2) and their output captured to `19-BUILD-VERIFY-LOG.md`. If all four PASS, the executor proceeds to Task 2. If any of TSC/Vitest/Build FAIL, the executor stops and reports back to the orchestrator with a routing recommendation. If Nginx validation is DOCKER_UNAVAILABLE, the executor proceeds to Task 2/3 but flags the ec2-side `nginx -t` as a Task 4 blocking prerequisite for Ashley.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author 19-PATCHES-MD-ENTRY.md (paste-ready patch #237 entry)</name>
  <files>.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</files>

  <read_first>
    - `~/.claude/identities/tina/skynet-patches.md` — specifically the recent entries #231 (backend TTS timeout bump), #232 (nginx companion for #231 — closest structural analog to patch #237's pattern of adding a location block adjacent to an existing one), #235 (per-account feature addition), #236 (mic + paperclip during recycle — a small polish patch). Use `Read` with offset to pull lines around each. Cite exact commit-message-shape conventions from these entries.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Ship as numbered patch #237 (motivation + shape + deploy note guidance).
    - `.planning/phases/11-skynet-transformation-purge-dead-surfaces-first-slice/11-PATCHES-MD-ENTRY.md` — an existing phase's patches-md-entry file for structural reference (Paste target, Paste timing, Batch context, Ordinal position on paste, Draft body sections).
    - `.planning/REQUIREMENTS.md` § Streaming TTS Output — the TTSSTR-01..07 wording is source-of-truth for the "requirements delivered" section of the entry.
  </read_first>

  <action>
    Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md` with this structure. Adapt the wording to Skynet's fork-catalog voice (present-tense, third-person description of what the patch does; no `Co-Authored-By` trailer per fork convention).

    ```
    # Patch #237 — Streaming TTS output via Chatterbox /tts endpoint (Phase 19)

    **Paste target:** `~/.claude/identities/tina/skynet-patches.md`

    **Paste timing:** Only after Ashley greenlights the batched deploy that includes patch #237. Patch #237 does NOT ship standalone — it rides the same rebuild + recreate as the pending #198→#236 queue (~57 unpushed-to-container commits per 19-CONTEXT.md § Deploy discipline).

    **Ordinal position on paste:** Update the "TWO HUNDRED THIRTY-SIX numbered patches" (or current count) line near the top of skynet-patches.md to reflect the new count (+1 per this patch).

    **No Co-Authored-By trailer** — fork convention (patterns from patches #232, #235, #236).

    ---

    ## Draft (paste-ready)

    ## Patch #237 — Streaming TTS output via Chatterbox /tts endpoint (Phase 19; pretty-view bubble speak-button; buffered /voice/speak route + IdentityModal voice-preview preserved byte-for-byte)

    * **Motivation** (Ashley 2026-07-31, direct scope-lock session): Nelly's streaming Chatterbox demo (https://gigaashley.click/tts-demo/) starts playing audio within ~30ms of clicking; Skynet's current buffered TTS path (patch #223) waits for the entire WAV synthesis to complete before starting playback. On a long assistant message, that's the difference between "instant" and "seconds of dead air." Ashley heard the demo and said "night and day" vs the buffered path. Same-day iOS Safari Web Audio spike on her iPhone PWA passed — no iOS-specific workaround needed.

    * **Root cause vs previous approach**: Patch #223 (`handleSpeak` in `src/backend/database/routes/voice.ts`) does `Buffer.from(await response.arrayBuffer())` on the Chatterbox response, then `res.end(buf)`. Server-side full-buffer + client-side `URL.createObjectURL(blob)` + `new Audio(url).play()`. Chatterbox's `/tts` endpoint (NOT the OpenAI-compat `/v1/audio/speech` — different endpoint, different body schema; `stream:true` only works on `/tts`) supports chunked-transfer streaming with a `0xFFFFFFFF` sentinel in the RIFF file-size field. Piping the response through server-side and progressively decoding chunks on the client via Web Audio API preserves the streaming property end-to-end.

    * **Fix summary — backend streaming route** (TTSSTR-01, TTSSTR-02): New `handleSpeakStream` function + `POST /voice/speak-stream` route in `src/backend/database/routes/voice.ts`, mirroring the structure of `handleSpeak` (patch #223) but replacing the `Buffer.from(await response.arrayBuffer()); res.end(buf)` block with `Readable.fromWeb(response.body).pipe(res)`. Sets response headers `Content-Type: audio/wav` and `X-Accel-Buffering: no` before the pipe starts (defense-in-depth against downstream reverse-proxy buffering). Request-body schema translation happens server-side: Skynet client sends `{text, voice?}` (same as buffered route); backend forwards to Chatterbox as `{text, voice_mode:"predefined", predefined_voice_id: voice ?? "Elena.wav", stream:true, split_text:true, chunk_size:80}`. Reuses existing `VOICE_FILENAME_RE` (`/^[A-Z][A-Za-z]+\.wav$/`) and `SPEAK_TEXT_MAX` (25000) constants. Default voice stays `Elena.wav` (unchanged from patch #223 — we did not switch to Adrian just because Nelly's demo used it). Upstream URL is `http://100.80.122.111:8001/tts` (NOT `/v1/audio/speech`).

    * **Fix summary — security parity with patch #223** (TTSSTR-07): `authenticateJWT` middleware wired before `express.json` (T-16-04 pattern from `handleTranscribe`). 300s `AbortController` on the upstream fetch (matches patch #223 cap; TTS synthesis of long text can take minutes). Non-2xx upstream returns fixed shape `{error:"TTS stream non-2xx", status:<upstream.status>}` — no upstream body leak (T-16-03 analog). AbortError → 504 `{error:"TTS stream timeout", status:504}`. Other exceptions → 502 `{error:"TTS stream proxy error", status:502}`. Existing `handleSpeak` function and `POST /voice/speak` route preserved BYTE-FOR-BYTE; IdentityModal voice-preview at `src/ui/features/pretty-view/IdentityModal.tsx:783` continues to call `postSpeak()` — the one-shot 25-word sample doesn't benefit from streaming and the buffered path already works there.

    * **Fix summary — nginx exact-match location** (TTSSTR-03): New `location = /voice/speak-stream` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (per CLAUDE.md caveat: matching location blocks required in both files, else the route 200s with index.html and crashes the frontend on `.map`). Block directives: `proxy_buffering off; proxy_request_buffering off; chunked_transfer_encoding on; proxy_read_timeout 300s;`. Exact-match `location =` takes priority over the pre-existing regex `location ~ ^/voice(/.*)?$` block used by `/voice/speak`, `/voice/transcribe`, `/voice/voices` — so the existing block stays byte-for-byte unchanged (patch #232's 300s tuning preserved). Caddy edge streams chunked-transfer by default.

    * **Fix summary — frontend fetch helper** (TTSSTR-04): New `postSpeakStream(text: string, voice?: string): Promise<Response>` in `src/ui/api/voice-api.ts`. Uses `fetch()` (not axios — the streaming body reader requires the raw `Response` object). Returns `Promise<Response>` (caller drives the read loop). JWT manually attached via `Authorization: Bearer ${token}` header, token pulled from `localStorage.getItem("jwt")` (same source `main-axios.ts:343` axios interceptor uses). Existing `postSpeak()` axios/blob helper preserved unchanged (IdentityModal voice-preview keeps using it).

    * **Fix summary — frontend Web Audio player** (TTSSTR-05, TTSSTR-06): `src/ui/features/pretty-view/ChatMessage.tsx` speak-button handler swapped from `postSpeak → URL.createObjectURL(blob) → new Audio(url).play()` to `postSpeakStream() → response.body.getReader()` loop → RIFF header parse (44 bytes; streaming sentinel `0xFFFFFFFF` in file-size field handled without validation failure) → per-chunk `AudioBuffer` allocation → `AudioBufferSourceNode` scheduled via running `nextStartTime` clock so consecutive chunks play back-to-back gaplessly. Pattern lifted from Nelly's demo view-source per her explicit permission. RIFF parser + PCM Int16→Float32 decoder extracted as pure functions in `riffPcmDecode.ts` with unit tests (10 cases including streaming sentinel, stereo deinterleave, partial-frame truncation). Web Audio scheduling encapsulated in a `createWebAudioStreamPlayer` factory in `webAudioStreamPlayer.ts` with 7 unit tests using a mocked AudioContext (patch #211 lesson: jsdom lies about Web Audio; keep the scheduling layer mockable). Cross-bubble Stop / new-bubble-preempt semantics preserved: module-level singleton adapted from `{currentAudio, currentAudioUrl, currentAudioOwner}` to `{currentPlayer, currentOwner}`; starting a new bubble stops the previous player's sources + cancels the reader + closes the AudioContext. Error handling: fetch and mid-stream errors abort scheduled sources + close context + revert `speakState` to idle without ugly click or trailing audio. NO auto-retry (would risk stuttering/doubled audio). Losing the `dbHealthMonitor.isBackendUnreachable` auto-toast integration on the streaming path is an accepted tradeoff — that integration is axios-specific and streaming errors are semantically different from database-unreachable.

    * **Files touched:**
      - `src/backend/database/routes/voice.ts` — `+~60 lines` (handleSpeakStream function + TTS_STREAM_URL constant + POST /speak-stream route)
      - `src/backend/database/routes/voice.test.ts` — `+~140 lines` (describe("handleSpeakStream") block, 11 tests SA/SA2/SB/SC/SD/SE/SF/SG/SH/SI/SJ + MockRes streaming shim: write/setHeader/on/once/emit no-ops for `Readable.pipe(res)`)
      - `docker/nginx.conf` — `+~15 lines` (location = /voice/speak-stream block)
      - `docker/nginx-https.conf` — `+~15 lines` (identical block)
      - `src/ui/api/voice-api.ts` — `+~15 lines` (postSpeakStream export)
      - `src/ui/api/voice-api.test.ts` — `+~90 lines` (new file, 8 tests)
      - `src/ui/features/pretty-view/riffPcmDecode.ts` — new file, ~60 lines
      - `src/ui/features/pretty-view/riffPcmDecode.test.ts` — new file, ~130 lines (10 tests)
      - `src/ui/features/pretty-view/webAudioStreamPlayer.ts` — new file, ~130 lines
      - `src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` — new file, ~200 lines (7 tests)
      - `src/ui/features/pretty-view/ChatMessage.tsx` — `~-30/+40 lines` (singleton adapted; imports swapped; onSpeakClick body rewritten; JSX untouched)
      - `src/ui/features/pretty-view/ChatMessage.test.tsx` — `+~120 lines` (new `describe("ChatMessage speak state machine (Phase 19 / patch #237)")` block with Tests 18, 19, 20, 21; all 11 pre-existing tests preserved unmodified — Tests 9, 10, 11, 12, 13 (Phase 05 chip-render), Tests 14, 14b, 14c (patch #107 quick-reply), Tests G, H, I (copy-button))

    * **Request-body schema translation table:**

      | Field (client-side POST /voice/speak-stream) | Field (server-side POST http://100.80.122.111:8001/tts) | Value |
      |---|---|---|
      | text | text | (verbatim) |
      | voice (optional) | predefined_voice_id | voice ?? "Elena.wav" |
      | — | voice_mode | "predefined" |
      | — | stream | true |
      | — | split_text | true |
      | — | chunk_size | 80 |

    * **Rebase risk:** LOW. Purely additive backend route, additive nginx block, additive frontend module + swap-one-caller. No upstream Skynet surfaces touched; the two files that DO change (`voice.ts` in the routes directory added by patch #155 fork-local, `ChatMessage.tsx` in the fork-local `pretty-view/` directory added by Phase 1) are both fork-local surfaces with no upstream diff.

    * **Deploy note:** Bundles with the held #198→#236 queue (~57 unpushed-to-container commits per 19-CONTEXT.md § Deploy discipline). Rides the same `docker compose up -d --force-recreate skynet` whenever Ashley greenlights. Ashley pre-warns of the HTTP2_PROTOCOL_ERROR on first hard-refresh post-recreate (patch #232 discovery). No standalone deploy for patch #237.

    * **UAT plan:** 7-item checklist covering TTSSTR-01..07, see `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md`.
    ```

    Notes:
    - Get the current patch count from `~/.claude/identities/tina/skynet-patches.md`. `grep -c '^## Patch #' ~/.claude/identities/tina/skynet-patches.md` gives the count (currently 69 per Wave 1 discovery); update the Ordinal position line accordingly (~/.claude/identities/tina/skynet-patches.md's line naming "TWO HUNDRED THIRTY-SIX numbered patches" may be stale — verify by grepping the file for the "numbered patches" phrase and reporting the current line contents in the entry). If the count phrasing is out of date, note it in the entry and Ashley will normalize on paste.
    - Fork-catalog integrity gate: mention explicitly that patch #237 batches (does not ship standalone) — this is a required line per the pattern seen in `11-PATCHES-MD-ENTRY.md`.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md && wc -l .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'TTSSTR-0[1-7]' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'Patch #237' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'BYTE-FOR-BYTE\|byte-for-byte' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'Elena\.wav' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md</automated>
  </verify>

  <acceptance_criteria>
    - `19-PATCHES-MD-ENTRY.md` exists.
    - File length >= 80 lines (a substantial entry, matching the ~150-line-plus shape of #232 / #235).
    - `grep -c 'TTSSTR-0[1-7]'` >= 7 (every requirement cited by ID at least once).
    - `grep -c 'Patch #237'` >= 2 (title + at least one reference).
    - `grep -c 'byte-for-byte'` (case-insensitive) >= 1 (buffered path preservation callout is present).
    - `grep -c 'Elena\.wav'` >= 1 (default-voice callout present).
    - Draft body contains a Files touched section, a Request-body schema translation table, a Rebase risk line, and a Deploy note.
  </acceptance_criteria>

  <done>
    `19-PATCHES-MD-ENTRY.md` is a paste-ready draft matching the shape of recent skynet-patches.md entries. Ashley can paste it at the top of `~/.claude/identities/tina/skynet-patches.md` at ship time with no editing beyond confirming the ordinal count line.
  </done>
</task>

<task type="auto">
  <name>Task 3: Author 19-UAT-CHECKLIST.md (7-item end-to-end verification for Ashley post-deploy)</name>
  <files>.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md</files>

  <read_first>
    - `.planning/REQUIREMENTS.md` § Streaming TTS Output — TTSSTR-01..07 verbatim wording.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Testing (End-to-end manual verify bullet list — the reference for what "end-to-end" means for this phase).
    - Recent phase UAT-CHECKLIST files for shape reference: `.planning/phases/06-telegram-like-interface/06-UAT-CHECKLIST.md` (if exists) or the pattern used in `10-UAT-CHECKLIST.md` mentioned in ROADMAP.md line 345.
  </read_first>

  <action>
    Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md` with this structure:

    ```
    # Phase 19 UAT Checklist — Streaming TTS Output via Chatterbox /tts (patch #237)

    **Target:** Ashley
    **Timing:** After `docker compose up -d --force-recreate skynet` completes AND the HTTP2_PROTOCOL_ERROR first-hard-refresh known-issue (patch #232 discovery) has been cleared.
    **URL:** https://term.gigaashley.click
    **Estimated duration:** ~5 minutes

    ---

    ## Prep

    - [ ] Skynet container recreated successfully; term.gigaashley.click loads without a 502.
    - [ ] Hard-refresh once to clear the HTTP2 known-issue if it appears.
    - [ ] Have a live tmux pane with a Claude Code session open in pretty view mode (Ctrl+Shift+O to flip from tmux to pretty). Any identity is fine — the streaming route is identity-agnostic; identity determines voice but not streaming behavior.
    - [ ] Confirm the identity's `voice` field is set (or absent — default is Elena.wav either way). If unsure, IdentityModal → check the voice preview surface works before starting.

    ---

    ## Item 1 (TTSSTR-01, TTSSTR-05) — Streaming latency perceptible

    **What to do:**
    1. Find or elicit a LONG assistant message in pretty view — ideally 3+ sentences, or 200+ characters. A short one-liner won't show a perceptible difference vs the buffered path.
    2. Click the speak button (Volume2 icon, bottom-right of the assistant bubble).
    3. Listen for how quickly the first audio starts.

    **What must be TRUE:**
    - First audio starts within ~1 second of the click — noticeably faster than pre-#237, which would wait for the entire message to synthesize before starting.
    - Audio plays continuously through to the end without stuttering, gaps, or repeated segments.

    **What FAILURE looks like:**
    - Audio takes as long as the pre-#237 buffered path to start (proxy buffering not disabled — check nginx configs).
    - Audio starts then cuts out mid-message (scheduling clock drift or reader error).
    - Robot-voice / garbled audio (RIFF header misparse or sample-rate mismatch).

    ---

    ## Item 2 (TTSSTR-06) — Cross-bubble preempt works

    **What to do:**
    1. Click speak on assistant message A. Wait for audio to start.
    2. While A is playing, click speak on a DIFFERENT assistant message B (higher or lower in the conversation).
    3. Listen.

    **What must be TRUE:**
    - A stops cleanly (no click, no trailing fragment).
    - B starts within ~1 second.
    - Only B is audible at any point after the second click.

    ---

    ## Item 3 (TTSSTR-06) — Same-bubble Stop works

    **What to do:**
    1. Click speak on assistant message A. Wait for audio to start (Loader2 → Volume2 icon transitions to a "stop" state — same icon changes as pre-#237).
    2. Click the SAME speak button again.

    **What must be TRUE:**
    - Audio stops cleanly (no click, no trailing fragment).
    - The speak icon returns to its resting state.
    - Clicking speak again on the same bubble restarts playback from the beginning.

    ---

    ## Item 4 (TTSSTR-07) — Buffered path still works for IdentityModal voice preview

    **What to do:**
    1. Open IdentityModal (click the identity avatar in a pretty-view pane).
    2. Change the voice dropdown to a non-default voice.
    3. Click the voice preview button (plays "Hi, this is your voice." in the selected voice).
    4. Confirm the sample plays.
    5. Save and cancel out of the modal.

    **What must be TRUE:**
    - The voice preview plays the sample phrase in the selected voice.
    - Playback works identically to pre-#237 (this surface still uses the buffered `/voice/speak` route unchanged).

    **What FAILURE looks like:**
    - Voice preview stops working entirely (means IdentityModal was accidentally swapped to postSpeakStream — a Plan 04 regression).
    - Voice preview streams (means IdentityModal was accidentally swapped to postSpeakStream — regression, but only detectable if you're listening carefully; the sample phrase is short enough that streaming vs buffered is imperceptible).

    ---

    ## Item 5 (TTSSTR-03) — Nginx routes /voice/speak-stream correctly

    **What to do:**
    1. From a terminal (Skynet's terminal pane or a local terminal), run:
       ```
       curl -N -X POST https://term.gigaashley.click/voice/speak-stream \
            -H "Authorization: Bearer $(cat ~/.jwt || echo REPLACE_ME)" \
            -H "Content-Type: application/json" \
            -d '{"text":"Testing streaming from curl.","voice":"Elena.wav"}' \
            --output /tmp/stream-test.wav
       ```
       (Replace the JWT source with wherever your token is; grabbing from browser devtools localStorage is fine.)
    2. Watch the curl progress bar. Bytes should arrive over a period of ~1-3 seconds (not batched at the very end).
    3. Play the output: `afplay /tmp/stream-test.wav` (macOS) or `aplay /tmp/stream-test.wav` (Linux).

    **What must be TRUE:**
    - curl completes with HTTP 200 and non-empty `.wav` output.
    - Bytes arrive incrementally (chunked-transfer visible in curl progress or `-v` output — `Transfer-Encoding: chunked` header).
    - Output plays back as "Testing streaming from curl." in Elena's voice.

    ---

    ## Item 6 (TTSSTR-04) — JWT auth enforced on streaming route

    **What to do:**
    1. Run the same curl as Item 5 but WITHOUT the Authorization header.

    **What must be TRUE:**
    - Response is HTTP 401 with a JSON error shape (matches existing `/voice/speak` behavior — the same middleware wired).

    ---

    ## Item 7 (TTSSTR-01, TTSSTR-02) — Default voice stays Elena.wav

    **What to do:**
    1. In a pretty-view assistant message, click speak WITHOUT changing anything.
    2. Listen — the voice should sound like Elena (the pre-#237 default), not any other voice.

    **What must be TRUE:**
    - Default voice is Elena (unchanged from patch #223). The streaming route did NOT switch the default to Adrian or any Nelly-demo voice.

    ---

    ## Bonus — iOS Safari on PWA

    **What to do:**
    1. On Ashley's iPhone PWA, repeat Item 1 (streaming latency).

    **What must be TRUE:**
    - iOS Safari Web Audio API plays the streaming response. (Verified via the same-day spike of Nelly's demo on 2026-07-31; this bonus item confirms Skynet's implementation retains the property.)

    ---

    ## Rollback plan

    If ANY item 1-7 fails and the failure cannot be quickly diagnosed:
    1. Fleet-standard 15-minute deadman rollback timer (per CLAUDE.md § Deploy safety).
    2. Alternate: since patch #237 is additive-only (new backend route + new nginx block + new frontend fetch helper + swap-one-caller in ChatMessage.tsx), the specific reverts are:
       - Revert the two nginx location blocks (remove `location = /voice/speak-stream` from both files); the frontend will get a 404 on postSpeakStream and revert to `idle` cleanly (though the user's click becomes a no-op — degraded but not broken).
       - Full patch #237 revert: `git revert <sha1>..<shaN>` on the Phase 19 commit range.

    Sign-off (Ashley): __________ Date: __________
    ```

    Notes:
    - The checklist walks the SEVEN requirements in order that maps to natural user flow (start with the win — Item 1 = the whole point of the phase; end with the sanity checks).
    - Item 5 (curl smoke test) is optional-if-Ashley-is-in-a-hurry but STRONGLY recommended — it's the only way to prove nginx isn't buffering vs "it feels fast" subjective judgment.
    - Item 4 (buffered path preservation) is the regression guard — a Plan 04 mistake could accidentally swap IdentityModal to streaming; Item 4 catches it.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md && wc -l .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c '^## Item [1-7]' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'TTSSTR-0[1-7]' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'What must be TRUE' .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md</automated>
  </verify>

  <acceptance_criteria>
    - `19-UAT-CHECKLIST.md` exists.
    - File length >= 100 lines.
    - `grep -c '^## Item [1-7]'` = 7 (all seven items present as top-level sections).
    - `grep -c 'TTSSTR-0[1-7]'` >= 7 (every requirement cited).
    - Every item has a "What must be TRUE" section (grep count >= 7 across the file).
    - Rollback plan section present.
    - Ashley sign-off line present at the end.
  </acceptance_criteria>

  <done>
    `19-UAT-CHECKLIST.md` is a 7-item end-to-end verification walk covering all TTSSTR requirements as observable behaviors Ashley can check on production Skynet after deploy. Includes a curl smoke test (Item 5) to confirm nginx streaming is actually working, a regression guard on IdentityModal (Item 4), and a rollback plan.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Ashley signoff on the ship bundle (Plans 01-04 artifacts + Plan 05 docs) before ship-day handoff</name>
  <what-built>
    Phase 19 is code-complete and documentation-complete. Backend streaming route + tests, nginx location blocks in both configs, frontend fetch helper + tests, RIFF decoder + tests, Web Audio player + tests, ChatMessage swap + tests, plus the ship-day artifacts (build-verify log, patches-md draft, UAT checklist). All autonomous work is done. The next action — actually shipping — is Ashley's word.

    **Special-case: nginx-ec2 prerequisite** — If `19-BUILD-VERIFY-LOG.md` § Command 4 says DOCKER_UNAVAILABLE-escalated (Warning A escalation path — docker not available in this executor's sandbox to run `nginx -t`), Ashley MUST run `sudo nginx -t` on skynet-ec2 against BOTH configs before the ship-day `docker compose up -d --force-recreate skynet`. Executor: surface this prominently at the top of your Task 4 message to Ashley.

    What Ashley should review here:
    - Skim `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md` — confirm the three checkboxes are all PASS.
    - Skim `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md` — confirm the tone matches recent entries and no essential facts are wrong.
    - Skim `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md` — confirm the 7 items are the ones she wants to verify post-deploy.
    - Optionally spot-check any Plan 01-04 SUMMARY.md files if she wants to see the per-plan grep-count evidence.
  </what-built>
  <how-to-verify>
    1. Open `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md` — confirm TSC/Vitest/Build all PASS.
    2. Open `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md` — read the draft.
    3. Open `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md` — read the 7 items.
    4. Optional: run `git diff --stat` on the branch to see the aggregate scope of the Phase 19 change set.
    5. Optional: locally run `docker compose up -d --force-recreate skynet` on a non-production Skynet instance (if one exists) to smoke-test the streaming route end-to-end via Item 5 curl before greenlighting production.

    Reply "approved" to greenlight patch #237 for ship (via the standard fleet deploy workflow — Ashley's word, 15-min deadman timer, batches with #198→#236 queue).

    Reply with issues if any artifact needs revision — the executor will route back to the responsible plan (Plan 05 for artifact edits, or Plan 01-04 if a functional regression is caught).
  </how-to-verify>
  <resume-signal>
    Type "approved" to accept the ship bundle and hand off to Ashley's deploy workflow.
    Type "revise: <plan-nn>: <what's wrong>" to route back to a specific plan for revision.
    Type any other feedback to open a discussion before greenlighting.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| planner/executor artifacts → skynet-patches.md | Documentation, not code — no runtime attack surface. |
| documentation → Ashley's deploy decision | Ashley reads the artifacts and decides to ship; social/process trust boundary, not technical. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-D01 | Tampering | 19-PATCHES-MD-ENTRY.md misrepresents what was shipped | mitigate | The entry is drafted from the verified TTSSTR-01..07 requirements + the code changes actually made in Plans 01-04. Ashley reviews the draft at Task 4 checkpoint before paste. Any drift between the entry and the actual code is caught at review time. |
| T-19-D02 | Information Disclosure | UAT checklist reveals internal endpoint/paths in public docs | accept | `.planning/` is not published; the checklist stays in-repo. If Skynet's repo were opened, `100.80.122.111:8001/tts` is a tailnet-only IP — not reachable from the public internet. Same disclosure posture as patches #231/#232. |
| T-19-D03 | Denial of Service | Bad build-verify results still get greenlit | mitigate | Task 1 acceptance criterion enforces the three PASS checkboxes; if any FAIL, Task 4 checkpoint cannot proceed because the "what-built" text would need to say "BLOCKING" and Ashley wouldn't approve. |
| T-19-D04 | Elevation of Privilege | Executor pushes/rebuilds/recreates without Ashley's word | mitigate | This plan explicitly has NO deploy commands. `autonomous: false` at plan level forces the human checkpoint. CLAUDE.md § Deploy safety is unambiguous: 15-min deadman + Ashley's word are mandatory. |
| T-19-SC | Tampering | Package installs | accept | No package installs. |
</threat_model>

<verification>
Run at plan completion:
1. `test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-BUILD-VERIFY-LOG.md` — exists.
2. `test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-PATCHES-MD-ENTRY.md` — exists.
3. `test -f .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-UAT-CHECKLIST.md` — exists.
4. All three files pass their acceptance-criteria greps (see individual tasks).
5. Task 4 checkpoint status: Ashley approved (or the plan is paused pending her review; the executor MUST wait, not proceed).
6. `git diff --stat` on the phase-19 change set — sanity-check scope matches what the patch entry claims.
</verification>

<success_criteria>
Requirements confirmed by this plan (via aggregation — Plans 01-04 delivered the code; Plan 05 confirms + ships-prep):
- TTSSTR-01..07 — every requirement has a UAT-checklist item verifying its production behavior; all seven cited in the patch-md entry and the UAT checklist.

Deploy is NOT part of this plan's success criteria — that's Ashley's post-checkpoint word.
</success_criteria>

<output>
Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-05-SUMMARY.md` when done, using the template. Summary must include:
- Build-verify results: three PASS/FAIL lines.
- Confirmation the three artifact files exist and pass acceptance greps.
- Ashley's checkpoint disposition (approved / revise-routing / open-for-discussion).
- If approved: pointer to Ashley's deploy-runbook for the actual ship (not this executor's responsibility).
- If any Plan 01-04 issue surfaced during build-verify: routing recommendation back to that plan.
</output>
