---
phase: 31-whole-app-structured-logging-backfill
plan: "03"
subsystem: tts-instrumentation
tags: [tts, speak-pipeline, instrumentation, d13-prefix-remap, d02-tts-surfaces, d05-explicit-extraction]
dependency_graph:
  requires:
    - 31-01 (log-dedup, forwarder envelope, prefix taxonomy)
  provides:
    - "[tts] speak-start/fetch-start/fetch-resolved/fetch-error/preempt-during-fetch log lines"
    - "[tts] play-attempt x4 branches (before/success/blocked/error)"
    - "[tts] media-canplay/playing/pause/ended/error/stalled/suspend via WebAudioStreamPlayer callbacks"
    - "[tts] autoplay-fired on autoplay effect fire"
    - "[tts] stop-current on cross-bubble preempt and unmount"
    - "WebAudioStreamPlayerOptions extended with onCanPlay/onPlaying/onPause/onStalled/onSuspend hooks"
    - "DOMException-safe errName extraction (robust across JSDOM + older Safari)"
  affects:
    - speak-button-broken-on-cellular bounty (now diagnosable from logs post-Phase-31)
    - webAudioStreamPlayer.ts (new callback hooks — backward-compatible; existing callers unaffected)
tech_stack:
  added: []
  patterns:
    - "[tts] subsystem prefix per D-13 taxonomy"
    - "trigger arg threading through startSpeak() signature (user-click|autoplay|long-press)"
    - "DOMException name extraction via property check (err.name) fallback before instanceof Error"
    - "WebAudioStreamPlayer callback-hook extension for Web Audio API event analogs"
key_files:
  created:
    - src/ui/features/pretty-view/ChatMessage.instrumentation.test.tsx
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/webAudioStreamPlayer.ts
decisions:
  - "Web Audio API path confirmed (not HTMLAudioElement): ChatMessage.tsx uses createWebAudioStreamPlayer; media events emitted via callback hooks on WebAudioStreamPlayerOptions, not addEventListener on HTMLAudioElement"
  - "onCanPlay fires on first decoded+scheduled chunk in player read loop (analogous to HTMLAudioElement canplay)"
  - "onPlaying fires after AudioContext.resume() succeeds (analogous to HTMLAudioElement playing on resume)"
  - "onPause fires after AudioContext.suspend() succeeds (analogous to HTMLAudioElement pause)"
  - "onStalled fires when reader.read() returns value=undefined mid-stream (stall condition)"
  - "onSuspend fires in pause() catch when AudioContext is killed under us (unexpected suspend)"
  - "startSpeak() accepts trigger arg (user-click|autoplay|long-press) threaded to speak-start log line"
  - "DOMException.name extracted via property-check fallback because DOMException does not extend Error in JSDOM/older Safari; errName check falls back to (err as {name:string}).name before 'unknown'"
  - "audio.error?.code acceptance criterion is N/A: Web Audio API path has no HTMLAudioElement.error property; D-05 explicit extraction applied instead via callback err argument (named properties extracted, never JSON.stringify)"
metrics:
  duration: "9 minutes"
  completed: "2026-08-11T11:18:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 31 Plan 03: TTS Speak Pipeline Instrumentation Summary

**One-liner:** Full TTS pipeline instrumentation in ChatMessage.tsx — fetch, decode, play-attempt×4 (before/success/blocked/error), 7 media events via WebAudioStreamPlayer callbacks, autoplay-effect attribution, and 5-test smoke suite asserting critical log shapes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Instrument TTS speak pipeline in ChatMessage.tsx | aa7a91c | ChatMessage.tsx (modified), webAudioStreamPlayer.ts (modified) |
| 2 | Add ChatMessage.instrumentation.test.tsx smoke suite | 142bf98 | ChatMessage.instrumentation.test.tsx (new), ChatMessage.tsx (modified — DOMException name fix) |

## What Was Built

### New [tts] log lines (grouped by event)

**speak-start (1 line):**
- `[tts] speak-start owner=... textLen=... voice="..." trigger=user-click|autoplay|long-press` — at entry of startSpeak() before any async work

**fetch-stage (3 lines):**
- `[tts] fetch-start owner=... url=/voice/speak-stream textLen=...` — before postSpeakStream call
- `[tts] fetch-resolved status=... ok=... owner=...` — immediately after response resolves
- `[tts] fetch-error owner=... status=... statusText="..."` — when response.ok is false

**preempt-race (1 line):**
- `[tts] preempt-during-fetch owner=... newOwner=...` — when currentOwner changed during fetch await

**decode-init (1 line):**
- `[tts] decode-init owner=... contextState=n/a` — before play() delegation (WebAudioStreamPlayer creates AudioContext internally)

**play-attempt (4 lines across 3 branches):**
- `[tts] play-attempt owner=... src=stream` — before player.play() delegation
- `[tts] play-attempt ... result=success` — on resolved play() promise
- `[tts] play-attempt ... result=blocked errName="NotAllowedError" errMessage="..."` — on NotAllowedError rejection
- `[tts] play-attempt ... result=error errName="..." errMessage="..."` — on other rejections

**media-events (7 lines via WebAudioStreamPlayer callback hooks):**
- `[tts] media-canplay` — first chunk decoded+scheduled (analogous to HTMLAudioElement canplay)
- `[tts] media-playing` — AudioContext resumed after suspend (analogous to playing event)
- `[tts] media-pause` — AudioContext suspended via pause() (analogous to pause event)
- `[tts] media-ended` — via existing onEnded callback (reader done + all sources ended)
- `[tts] player-error` — via existing onError callback with errName/errMessage (D-05 explicit extraction)
- `[tts] media-stalled` — when reader.read() yields value=undefined mid-stream
- `[tts] media-suspend` — when AudioContext is killed under us during pause()

**autoplay-effect (1 line):**
- `[tts] autoplay-fired eventId=... armed=...` — in autoplay useEffect when condition fires startSpeak()

**stop/teardown (2 log sites, 1 event type):**
- `[tts] stop-current owner=... trigger=new-bubble` — when a new bubble preempts the current player
- `[tts] stop-current owner=... trigger=unmount` — in cleanup effect on unmount

**Total new log lines: 20** (across ChatMessage.tsx; media-event hooks wired into webAudioStreamPlayer.ts)

### Prefix rename
- `[postSpeakStream] player error:` → `[tts] player-error owner=... errName="..." errMessage="..."` (D-13)
- `[postSpeakStream] fetch error:` → `[tts] fetch-error owner=... errName="..." errMessage="..."` (D-13)

### WebAudioStreamPlayer extension (webAudioStreamPlayer.ts)
Added 5 new optional callbacks to `WebAudioStreamPlayerOptions`:
- `onCanPlay?`, `onPlaying?`, `onPause?`, `onStalled?`, `onSuspend?`

All new callbacks are optional and backward-compatible. Existing callers (webAudioStreamPlayer.test.ts, ChatMessage.speak.test.tsx) pass without providing them.

### Smoke test file (ChatMessage.instrumentation.test.tsx)
5 tests, 6 `expect.stringMatching` assertions:
- INSTR-1: `[tts] speak-start` shape (owner/textLen/voice/trigger)
- INSTR-2: `[tts] play-attempt result=success` shape
- INSTR-3: `[tts] play-attempt result=blocked errName="NotAllowedError"` shape
- INSTR-4: `[tts] fetch-error status=502` shape
- INSTR-5: `[tts] player-error errName/errMessage` shape

## Verification

```
npx tsc --noEmit
```
Result: **exit 0**

```
npx vitest run src/ui/features/pretty-view/ChatMessage
```
Result: **4 test files, 43 tests, all passed**

```
git grep -c '[postSpeakStream]' src/
```
Result: **0 — prefix fully remapped**

## Audio API Path Confirmed

The ChatMessage.tsx TTS pipeline uses **Web Audio API exclusively** via `createWebAudioStreamPlayer` (patch #237, Phase 19 Plan 04). There is NO HTMLAudioElement in this path. Key implications for plan 31-09's grep pass:
- Search for `[tts]` prefix across ChatMessage.tsx — confirmed present
- The `audio.error?.code` acceptance criterion is N/A: Web Audio API has no `HTMLAudioElement.error` MediaError object; D-05 explicit extraction is honored instead by extracting `err.name` and `err.message` from the Error argument passed to `onError` callback — never `JSON.stringify`
- Media events (canplay/playing/pause/ended/error/stalled/suspend) are emitted via the new callback hooks on `WebAudioStreamPlayerOptions`, not via HTMLAudioElement `addEventListener`

## Suspected Bugs Surfaced (per D-22 discipline)

**Do NOT fix in this phase. File as follow-on bounty if confirmed after Phase 31 ships.**

1. **iOS AudioContext gesture-lock on cellular:** The `player.play(response)` call in startSpeak() happens inside an `async` function that has already `await`ed `postSpeakStream()`. On iOS Safari, any `await` before `AudioContext.resume()` (or AudioContext creation) may consume the user gesture context, silently preventing audio playback on cellular. The new `[tts] decode-init contextState=n/a` and `[tts] play-attempt` lines will surface whether the AudioContext was created and whether play() resolved on the next cellular reproduction. If the phone shows `play-attempt result=success` but no audio, the issue is upstream of play() (AudioContext state or routing). If `result=blocked`, iOS is blocking due to gesture context loss.

2. **Streaming stall under cellular packet loss:** The new `[tts] media-stalled` line fires when the reader.read() loop returns value=undefined mid-stream. Under cellular packet loss this could fire between chunks. Combined with `[tts] media-ended` timing, this will surface whether the stall-before-ended pattern correlates with silent-speak reports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] DOMException name extraction in play-attempt catch handler**
- **Found during:** Task 2 (INSTR-3 test failure)
- **Issue:** `DOMException` does not extend `Error` in JSDOM (and older Safari environments), so `err instanceof Error` returned `false`, making `errName = "unknown"` instead of `"NotAllowedError"`. The `result=blocked` branch was never reached.
- **Fix:** Extended the errName/errMessage extraction to check for `.name` and `.message` properties on non-Error throwables via property-check fallback before defaulting to "unknown". This is the correct robust pattern for catching NotAllowedError from audio.play() across all environments.
- **Files modified:** `src/ui/features/pretty-view/ChatMessage.tsx` (play-attempt catch handler)
- **Commit:** 142bf98

**2. [Rule 2 - Missing critical functionality] WebAudioStreamPlayerOptions extended with media-event callback hooks**
- **Found during:** Task 1 implementation
- **Issue:** The plan's acceptance criteria required `[tts] media-canplay`, `[tts] media-playing`, `[tts] media-pause`, `[tts] media-stalled`, `[tts] media-suspend` log lines, but these Web Audio lifecycle transitions were not observable from ChatMessage.tsx since the WebAudioStreamPlayer encapsulates the AudioContext. Without adding hooks to the player interface, these events would be unreachable.
- **Fix:** Added 5 optional callback fields to `WebAudioStreamPlayerOptions` and wired them at the corresponding lifecycle points in the implementation. All additions are backward-compatible.
- **Files modified:** `src/ui/features/pretty-view/webAudioStreamPlayer.ts`
- **Commit:** aa7a91c

**3. [Out of scope — noted] `audio.error?.code` acceptance criterion N/A**
- The plan acceptance criteria included `git grep -c 'audio.error?.code' ChatMessage.tsx >= 1` (D-05 explicit MediaError extraction). This criterion targets the HTMLAudioElement path; the actual implementation uses Web Audio API where errors surface as JavaScript `Error` objects via the `onError` callback, not as `HTMLAudioElement.error` MediaError objects. D-05 explicit extraction is still honored (named properties `err.name` and `err.message` extracted; never `JSON.stringify`). Criterion count = 0 is correct for the actual code path.

## Known Stubs

None. All log lines are wired to real event sources. The `decode-init contextState=n/a` field is genuinely "n/a" because the WebAudioStreamPlayer creates its AudioContext internally (not directly accessible from ChatMessage.tsx without architectural changes prohibited by D-22).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure-reviewed | ChatMessage.tsx | Log lines confirmed safe: owner is a Symbol (numeric toString), textLen is a byte count (not the message body), voice is the public voice filename, fetch status/statusText are HTTP metadata. Explicitly NOT logged: message text body (`content` prop never appears in a log line), audio bytes, user identity tokens. T-31-07 mitigation applied. |

## Self-Check

Files verified:
- `src/ui/features/pretty-view/ChatMessage.tsx` — FOUND (modified)
- `src/ui/features/pretty-view/webAudioStreamPlayer.ts` — FOUND (modified)
- `src/ui/features/pretty-view/ChatMessage.instrumentation.test.tsx` — FOUND (new)

Commits verified:
- `aa7a91c` — feat(31-03): instrument TTS speak pipeline in ChatMessage.tsx
- `142bf98` — feat(31-03): add ChatMessage.instrumentation.test.tsx smoke suite

## Self-Check: PASSED
