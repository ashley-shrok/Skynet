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

**What FAILURE looks like:**
- A and B playing simultaneously (singleton teardown not working).
- A does not stop (old `currentAudio` singleton logic leaked — regression from Plan 04).

---

## Item 3 (TTSSTR-06) — Same-bubble Stop works

**What to do:**
1. Click speak on assistant message A. Wait for audio to start (Loader2 → speak icon transitions to a playing/stop state — same icon behavior as pre-#237).
2. Click the SAME speak button again.

**What must be TRUE:**
- Audio stops cleanly (no click, no trailing fragment).
- The speak icon returns to its resting state.
- Clicking speak again on the same bubble restarts playback from the beginning.

**What FAILURE looks like:**
- Audio keeps playing after the second click (stop() not wiring to AudioBufferSourceNode.stop()).
- Icon stays stuck in "playing" state (speakState not reverting to idle on stop).

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
- Voice preview streams (means IdentityModal was accidentally swapped to postSpeakStream — regression, but only detectable if you are listening carefully; the sample phrase is short enough that streaming vs buffered is imperceptible).

**Why this matters:** Plan 04's ChatMessage.tsx swap must NOT have touched IdentityModal.tsx line 783. The acceptance grep during Plan 04 verified `grep -c 'postSpeak(SAMPLE_PHRASE' src/ui/features/pretty-view/IdentityModal.tsx` = 1, but this item confirms it in production.

---

## Item 5 (TTSSTR-03) — Nginx routes /voice/speak-stream correctly

**What to do:**
1. From a terminal (Skynet's terminal pane or a local terminal), run:
   ```
   curl -N -X POST https://term.gigaashley.click/voice/speak-stream \
        -H "Authorization: Bearer <YOUR_JWT>" \
        -H "Content-Type: application/json" \
        -d '{"text":"Testing streaming from curl.","voice":"Elena.wav"}' \
        --output /tmp/stream-test.wav
   ```
   (Grab your JWT from browser devtools: `localStorage.getItem("jwt")` in the devtools console at term.gigaashley.click.)
2. Watch the curl progress bar. Bytes should arrive over a period of ~1-3 seconds (not batched at the very end).
3. Play the output: `afplay /tmp/stream-test.wav` (macOS) or `aplay /tmp/stream-test.wav` (Linux).

**What must be TRUE:**
- curl completes with HTTP 200 and non-empty `.wav` output.
- Bytes arrive incrementally (chunked-transfer visible in curl progress or `-v` output showing `Transfer-Encoding: chunked`).
- Output plays back as "Testing streaming from curl." in Elena's voice.

**What FAILURE looks like:**
- HTTP 404: the `location = /voice/speak-stream` block is missing or nginx config not reloaded after recreate (container start should pick up the updated config from docker/nginx.conf).
- HTTP 200 but all bytes arrive at once at the end: proxy buffering is on somewhere — check `proxy_buffering off` + `proxy_request_buffering off` in the nginx block + `X-Accel-Buffering: no` header in the backend response.
- HTTP 401: JWT is wrong or expired.

---

## Item 6 (TTSSTR-04) — JWT auth enforced on streaming route

**What to do:**
1. Run the same curl as Item 5 but WITHOUT the Authorization header:
   ```
   curl -N -X POST https://term.gigaashley.click/voice/speak-stream \
        -H "Content-Type: application/json" \
        -d '{"text":"Testing without auth.","voice":"Elena.wav"}'
   ```

**What must be TRUE:**
- Response is HTTP 401 with a JSON error shape (matches existing `/voice/speak` behavior — the same `authenticateJWT` middleware is wired on the streaming route).

**What FAILURE looks like:**
- HTTP 200 with audio returned (auth middleware not wired — security regression, immediate rollback).
- Any non-401 response (500, 404, etc.) — means auth is failing in unexpected ways.

---

## Item 7 (TTSSTR-01, TTSSTR-02) — Default voice stays Elena.wav

**What to do:**
1. In a pretty-view assistant message, click speak WITHOUT changing anything (use default identity without a custom voice override).
2. Listen — the voice should sound like Elena (the pre-#237 default), not any other voice.

**What must be TRUE:**
- Default voice is Elena (unchanged from patch #223). The streaming route did NOT switch the default to Adrian or any Nelly-demo voice.

**Why this matters:** The Chatterbox demo Nelly showed used `Adrian.wav`; the plan explicitly locked `Elena.wav` as the Skynet default (Ashley: "we're not gonna switch our default voice just because nelly picked a random one to do the demo with"). The backend's `predefined_voice_id: voice ?? "Elena.wav"` fallback should produce Elena on any message where no identity voice override is set.

---

## Bonus — iOS Safari on PWA

**What to do:**
1. On Ashley's iPhone PWA, repeat Item 1 (streaming latency on a long message).

**What must be TRUE:**
- iOS Safari Web Audio API plays the streaming response. (Verified via the same-day spike of Nelly's demo on 2026-07-31; this bonus item confirms Skynet's implementation retains the property end-to-end through Caddy + nginx + Express + Chatterbox on the real production stack.)

**Note:** The spike confirmed iOS Web Audio works with the streaming pattern; this is a belt-and-suspenders check for the full production path, not a known risk.

---

## Rollback plan

If ANY item 1-7 fails and the failure cannot be quickly diagnosed:

1. Fleet-standard 15-minute deadman rollback timer (per CLAUDE.md § Deploy safety — no exceptions, even at keyboard).
2. Patch #237 is additive-only — specific surgical reverts are possible without touching other patches in the #198→#236 queue:
   - **Fastest revert (nginx-only, degrades gracefully):** Remove `location = /voice/speak-stream` from both `docker/nginx.conf` and `docker/nginx-https.conf`. The frontend will get a 404/index.html on `postSpeakStream` and revert `speakState` to `idle` cleanly — the speak button becomes a no-op (degraded but not broken; IdentityModal voice preview continues to work via the buffered path).
   - **Full patch #237 revert:** `git revert <sha1>..<shaN>` on the Phase 19 commit range (Plans 01-04 commits). Restores `ChatMessage.tsx` to the pre-#237 buffered path. Rebuilds required.
3. Specific failure-routing guidance:
   - Item 1 fails (audio doesn't start early): likely proxy buffering — check `proxy_buffering off` in nginx block + `X-Accel-Buffering: no` in backend response headers.
   - Item 2/3 fails (preempt/stop broken): stop() not tearing down AudioBufferSourceNode — check `webAudioStreamPlayer.ts` stop() + singleton in ChatMessage.tsx.
   - Item 4 fails (IdentityModal preview broken): ChatMessage.tsx swap accidentally touched IdentityModal — check the Plan 04 commit for IdentityModal.tsx changes (there should be none).
   - Item 5 returns 404: nginx location block not loaded — `docker exec skynet grep -n speak-stream /tmp/nginx/nginx.conf` to confirm the block is in the runtime config.
   - Item 6 returns 200 (no auth): auth middleware regression — immediate rollback required.

Sign-off (Ashley): __________ Date: __________
