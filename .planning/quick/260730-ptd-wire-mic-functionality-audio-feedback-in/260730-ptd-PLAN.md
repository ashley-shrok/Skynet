---
phase: 260730-ptd-wire-mic-functionality-audio-feedback-in
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/assets/sounds/mic/start.mp3
  - src/ui/assets/sounds/mic/stop.mp3
  - src/ui/assets/sounds/mic/cancel.mp3
  - src/ui/assets/sounds/mic/error.mp3
  - src/ui/assets/sounds/mic/CREDITS.md
  - src/ui/features/pretty-view/useVoiceRecording.ts
  - src/ui/features/pretty-view/useVoiceRecording.test.ts
autonomous: true
requirements:
  - QUICK-260730-ptd

must_haves:
  truths:
    - "start.mp3 plays when MediaRecorder init succeeds (recording actually begins)"
    - "start.mp3 does NOT play on getUserMedia rejection (permission-denied path stays silent)"
    - "stop.mp3 plays when endAppend/endSend is invoked, BEFORE the STT fetch runs"
    - "cancel.mp3 plays when cancel() is invoked, BEFORE the recorder is torn down"
    - "error.mp3 plays on STT fetch failure, non-ok HTTP status, or invalid response"
    - "A failed .play() Promise never breaks the recording flow (silent .catch)"
    - "Existing 8 vitest cases in useVoiceRecording.test.ts still pass unchanged (or updated to accommodate Audio mock without altering their behavioral assertions)"
  artifacts:
    - path: "src/ui/assets/sounds/mic/start.mp3"
      provides: "Material Design confirm-down sound"
    - path: "src/ui/assets/sounds/mic/stop.mp3"
      provides: "Material Design confirm-up sound"
    - path: "src/ui/assets/sounds/mic/cancel.mp3"
      provides: "Material Design navigation-cancel sound"
    - path: "src/ui/assets/sounds/mic/error.mp3"
      provides: "Material Design alert_error-02 sound"
    - path: "src/ui/assets/sounds/mic/CREDITS.md"
      provides: "CC-BY-SA 4.0 attribution + filename mapping"
    - path: "src/ui/features/pretty-view/useVoiceRecording.ts"
      provides: "Voice-recording hook with 4 audio-feedback playback points"
    - path: "src/ui/features/pretty-view/useVoiceRecording.test.ts"
      provides: "Extended vitest coverage for the 4 sound-playback assertions"
  key_links:
    - from: "src/ui/features/pretty-view/useVoiceRecording.ts"
      to: "src/ui/assets/sounds/mic/*.mp3"
      via: "Vite ?url imports"
      pattern: "import .*Url from .*sounds/mic/.*\\.mp3\\?url"
    - from: "useVoiceRecording start() .then callback"
      to: "startAudio.play()"
      via: "played after recorder.start() and setState('recording')"
      pattern: "startAudio\\.play\\(\\)"
    - from: "useVoiceRecording cancel()"
      to: "cancelAudio.play()"
      via: "played BEFORE await stopRecording()"
      pattern: "cancelAudio\\.play\\(\\).*stopRecording"
---

<objective>
Wire 4 Google Material Design audio-feedback sounds (start/stop/cancel/error) into the existing useVoiceRecording hook so the compose-box voice-recording flow gives immediate auditory feedback to the user at the four meaningful state transitions.

Purpose: UX polish for the mic-tap flow — the four sounds tell the user their action registered without them needing to look at the UI. Assets are pre-staged in /tmp/mic-audition-v2-eiNaAj/ and licensed CC-BY-SA 4.0 (unmodified from Google Material Design Sound Resources on archive.org).

Output:
- 4 .mp3 files in src/ui/assets/sounds/mic/
- CREDITS.md attribution file in the same dir
- useVoiceRecording.ts wired with lazy-initialized Audio instances and .play() at 4 transitions
- useVoiceRecording.test.ts extended with 4 new assertions (Audio-mock-based)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-view/useVoiceRecording.ts
@src/ui/features/pretty-view/useVoiceRecording.test.ts
@vite.config.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Stage the 4 .mp3 assets and write CREDITS.md attribution</name>
  <files>src/ui/assets/sounds/mic/start.mp3, src/ui/assets/sounds/mic/stop.mp3, src/ui/assets/sounds/mic/cancel.mp3, src/ui/assets/sounds/mic/error.mp3, src/ui/assets/sounds/mic/CREDITS.md</files>
  <action>
    Create the directory `src/ui/assets/sounds/mic/` (and any missing parents — `src/ui/assets/` and `src/ui/assets/sounds/` do not yet exist in the repo). Then copy exactly these 4 files from `/tmp/mic-audition-v2-eiNaAj/` using `cp` (do NOT re-encode, do NOT modify — the CC-BY-SA 4.0 attribution requires unmodified files):

    - `md-start-state-change_confirm-down.mp3`  → `src/ui/assets/sounds/mic/start.mp3`
    - `md-stop-state-change_confirm-up.mp3`     → `src/ui/assets/sounds/mic/stop.mp3`
    - `md-cancel-navigation-cancel.mp3`         → `src/ui/assets/sounds/mic/cancel.mp3`
    - `md-error-alert_error-02.mp3`             → `src/ui/assets/sounds/mic/error.mp3`

    Write `src/ui/assets/sounds/mic/CREDITS.md` with attribution containing:
    - Heading: "Mic Audio Feedback — Attribution"
    - Source: Google Material Design Sound Resources — https://archive.org/details/material-design-sound-resources
    - License: CC-BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/
    - Explicit note: "Files are unmodified from the source."
    - A filename-mapping table:
      | Our filename | Original filename |
      | start.mp3    | md-start-state-change_confirm-down.mp3 |
      | stop.mp3     | md-stop-state-change_confirm-up.mp3    |
      | cancel.mp3   | md-cancel-navigation-cancel.mp3        |
      | error.mp3    | md-error-alert_error-02.mp3            |

    Do NOT add a UI-visible attribution surface (About page, Settings, etc.) — CREDITS.md in the sounds dir is enough for source-tree compliance per the task brief.
  </action>
  <verify>
    <automated>test -f src/ui/assets/sounds/mic/start.mp3 && test -f src/ui/assets/sounds/mic/stop.mp3 && test -f src/ui/assets/sounds/mic/cancel.mp3 && test -f src/ui/assets/sounds/mic/error.mp3 && test -f src/ui/assets/sounds/mic/CREDITS.md && cmp -s /tmp/mic-audition-v2-eiNaAj/md-start-state-change_confirm-down.mp3 src/ui/assets/sounds/mic/start.mp3 && cmp -s /tmp/mic-audition-v2-eiNaAj/md-stop-state-change_confirm-up.mp3 src/ui/assets/sounds/mic/stop.mp3 && cmp -s /tmp/mic-audition-v2-eiNaAj/md-cancel-navigation-cancel.mp3 src/ui/assets/sounds/mic/cancel.mp3 && cmp -s /tmp/mic-audition-v2-eiNaAj/md-error-alert_error-02.mp3 src/ui/assets/sounds/mic/error.mp3 && grep -q "CC-BY-SA 4.0" src/ui/assets/sounds/mic/CREDITS.md && grep -q "unmodified" src/ui/assets/sounds/mic/CREDITS.md</automated>
  </verify>
  <done>
    All 4 .mp3 files exist in `src/ui/assets/sounds/mic/` with byte-identical contents to the source files in `/tmp/mic-audition-v2-eiNaAj/`. `CREDITS.md` contains the CC-BY-SA 4.0 license reference, "unmodified" statement, source URL, and the 4-row filename-mapping table.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire 4 audio-feedback playback calls into useVoiceRecording + extend vitest coverage</name>
  <files>src/ui/features/pretty-view/useVoiceRecording.ts, src/ui/features/pretty-view/useVoiceRecording.test.ts</files>
  <behavior>
    New test assertions (add to existing describe block, do NOT modify or delete the 8 existing tests):

    - Test A "start.mp3 plays after MediaRecorder init succeeds": spy on `new Audio()` and each instance's `.play()`. Call `start()`, await `state === "recording"`. Assert the Audio instance created with the start.mp3 URL had `.play()` called exactly once AFTER `recorder.start()` completed. Verify by checking mock call ordering (recorder.start called before startAudio.play).

    - Test B "start.mp3 does NOT play on getUserMedia rejection": reuse the Test 7 permission-denied setup. After `errorMessage` matches /mic denied/, assert the start.mp3 Audio's `.play()` was NEVER called.

    - Test C "stop.mp3 plays before STT fetch in endAppend/endSend": call `start()`, await recording. Call `endAppend("text")`. Assert the stop.mp3 Audio `.play()` was called AND that its call happened BEFORE `fetch` was called (compare `mock.invocationCallOrder` or use a call-order counter). Repeat for `endSend`.

    - Test D "cancel.mp3 plays before recorder teardown in cancel()": call `start()`, await recording. Call `cancel()`. Assert cancel.mp3 Audio `.play()` was called AND its call happened BEFORE `recorder.stop()` was called.

    - Test E "error.mp3 plays on STT HTTP 500": reuse the Test 6 fetch-500 setup. After `endAppend` resolves null, assert error.mp3 Audio `.play()` was called exactly once. Also add a variant asserting error.mp3 plays on fetch throw (network error).

    - Test F "failed .play() Promise does not throw": stub one Audio instance's `.play` to `vi.fn().mockRejectedValue(new Error("NotAllowedError"))`. Trigger start(). Assert no unhandled rejection reaches the test (the hook's .catch swallowed it) AND that state still transitions to "recording" normally.

    Mock strategy for Audio: in `beforeEach`, replace the global Audio constructor with a `vi.fn()` that returns objects with `{ src, currentTime, play: vi.fn().mockResolvedValue(undefined) }`. Store instances on a module-scope array so tests can retrieve them by src-suffix match (e.g., the instance whose src ends in `start.mp3`). Since vite's `?url` imports return string URLs at build time and jsdom won't resolve them, you can either (a) mock the `?url` module resolution in vitest.config.ts, or (b) let vitest resolve them as opaque strings and match by suffix in the tests. Choose (b) — simpler and doesn't touch build config.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/useVoiceRecording.ts`:

    1. **Add 4 `?url` imports at the top of the file** (after the `import { useRef, useState } from "react";` line):
       ```
       import startUrl from "../../assets/sounds/mic/start.mp3?url";
       import stopUrl from "../../assets/sounds/mic/stop.mp3?url";
       import cancelUrl from "../../assets/sounds/mic/cancel.mp3?url";
       import errorUrl from "../../assets/sounds/mic/error.mp3?url";
       ```
       Vite's `?url` suffix is built-in — no `vite.config.ts` change required (confirmed against the existing config, which has no url-plugin gating).

    2. **Inside `useVoiceRecording()`, immediately after the two `useState` calls, lazy-init 4 Audio instances** via `useRef` initializers so they persist across renders without reconstruction:
       ```
       const startAudioRef = useRef<HTMLAudioElement | null>(null);
       const stopAudioRef  = useRef<HTMLAudioElement | null>(null);
       const cancelAudioRef = useRef<HTMLAudioElement | null>(null);
       const errorAudioRef = useRef<HTMLAudioElement | null>(null);
       if (!startAudioRef.current)  startAudioRef.current  = new Audio(startUrl);
       if (!stopAudioRef.current)   stopAudioRef.current   = new Audio(stopUrl);
       if (!cancelAudioRef.current) cancelAudioRef.current = new Audio(cancelUrl);
       if (!errorAudioRef.current)  errorAudioRef.current  = new Audio(errorUrl);
       ```
       Hook-mount initialization is safe because the mic-tap gesture that mounts ComposeBox / triggers the hook satisfies Safari's autoplay policy (documented in the task brief).

    3. **Add a helper `playSound(audio: HTMLAudioElement | null)`** near the other internal helpers (`stopRecording`, `transcribeBlob`, `applyGlue`). It must reset `currentTime = 0` before calling `.play()`, and must `.catch()` the returned Promise silently. Example directive shape (do NOT copy the code — write it in your own style, but do exactly this):
       - Guard against null.
       - Set `audio.currentTime = 0` so rapid-fire replays work.
       - Call `audio.play()` and attach `.catch(() => {})` — audio failure is UX polish, MUST NOT break recording. Do NOT log to console (silent failure per the task brief; console noise is not desired).

    4. **Insert the 4 .play() calls at these EXACT locations** in the existing state machine — reference the line regions from your Read of the current file:

       - **start.mp3** — inside `start()`'s `.then((stream) => { ... })` callback (currently ~lines 184-199), placed AFTER `recorder.start()` and `setState("recording")`, but BEFORE `setErrorMessage(null)`. Rationale: only plays on the success path — the `.catch` on line 200 handles permission-denied without invoking playSound, so no sound on mic-denied.

       - **stop.mp3** — inside BOTH `endAppend()` (currently ~lines 224-244) AND `endSend()` (currently ~lines 252-272). Placement: as the very FIRST statement inside each function AFTER the `if (state !== "recording") return null;` guard, BEFORE `const blob = await stopRecording();`. Rationale: fires immediately on the stop-button gesture, before the STT round-trip introduces latency.

       - **cancel.mp3** — inside `cancel()` (currently ~lines 211-216). Placement: as the very FIRST statement AFTER the `if (state !== "recording") return;` guard, BEFORE `await stopRecording();`. Rationale: immediate feedback on cancel-tap, before teardown.

       - **error.mp3** — inside `transcribeBlob()` (currently ~lines 115-150). Placement: play error.mp3 in ALL THREE failure branches:
         - The `catch (err)` block after the `fetch` call (~line 131), before `setErrorMessage`.
         - The `if (!res.ok)` block (~line 138), before `setErrorMessage`.
         - The `catch` block after `res.json()` (~line 146), before `setErrorMessage`.
         Additionally: in `endAppend` and `endSend`, if `transcript === null` returned from `transcribeBlob` and the transcript is empty string (`""`), play error.mp3. Handle this by checking `transcript === ""` after the null-guard, before the applyGlue call — empty transcript is a "recording-flow failure" per the task brief (STT returned empty). If `transcript === ""`, play error.mp3 and still return the `{transcript: "", glued}` shape (do NOT change the return contract; the sound is the user cue).

       Do NOT play error.mp3 for the mic-denied path — that path already surfaces `errorMessage` to the caller, and playing an error sound BEFORE the user has interacted with the page (first mic-tap could be the interaction) risks a rejected .play() on Safari. The permission-denied error message alone is the UX signal there.

    Edit `src/ui/features/pretty-view/useVoiceRecording.test.ts`:

    5. **Add Audio mock infrastructure** in `beforeEach` (below the existing MediaRecorder + navigator + fetch setup, before the closing `});` of `beforeEach`):
       - Reset a module-scope `audioInstances: Array<{src: string, currentTime: number, play: Mock}>` array.
       - Assign a mock Audio constructor to `globalThis.Audio` that pushes a new instance to the array and returns it. The mock instance's `.play` should default to `vi.fn().mockResolvedValue(undefined)`.
       - Provide a helper `getAudioBySrc(suffix: string)` that finds the instance whose `.src` ends with the suffix (e.g., `"start.mp3"`).

    6. **Add the 6 tests described in `<behavior>`** as new `it(...)` blocks appended to the existing `describe("useVoiceRecording", ...)` block. Do NOT modify the 8 existing tests. If any existing test now fails because the hook constructs Audio instances at mount, adjust ONLY the beforeEach/afterEach mock plumbing — do NOT alter existing test assertions.

    7. Use `vi.fn().mock.invocationCallOrder` to assert cross-mock call ordering (e.g., stopAudio.play was called before fetch, cancelAudio.play was called before recorder.stop). This is the standard vitest idiom for ordering assertions.

    Do NOT touch: any file outside `src/ui/features/pretty-view/useVoiceRecording.ts`, `src/ui/features/pretty-view/useVoiceRecording.test.ts`, or the sounds dir from Task 1. Do NOT modify `ComposeBox.tsx` — the hook change is transparent to consumers (return shape unchanged).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/useVoiceRecording.test.ts 2>&1 | tail -30 && npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <done>
    - All 8 pre-existing vitest cases in `useVoiceRecording.test.ts` still pass.
    - 6 new vitest cases (A-F above) pass.
    - `npx tsc --noEmit` exits 0.
    - `useVoiceRecording.ts` has 4 `?url` imports for the mic sound assets.
    - The hook's `start()` .then callback contains `startAudioRef.current` `.play()` invocation AFTER `recorder.start()`.
    - The hook's `cancel()`, `endAppend()`, `endSend()` each contain their respective `.play()` invocation BEFORE their `await stopRecording()` call (for cancel/stop) or before/after fetch failure (for error).
    - No `console.log`, `console.warn`, or `console.error` added — silent failure only.
  </done>
</task>

</tasks>

<verification>
- `test -f src/ui/assets/sounds/mic/{start,stop,cancel,error}.mp3` all pass
- `test -f src/ui/assets/sounds/mic/CREDITS.md` passes with CC-BY-SA 4.0 + filename mapping
- `npx vitest run src/ui/features/pretty-view/useVoiceRecording.test.ts` — 14 tests pass (8 existing + 6 new)
- `npx vitest run` — full suite green (regression check)
- `npx tsc --noEmit` exits 0
- Grep confirms: `grep -n "\.play()" src/ui/features/pretty-view/useVoiceRecording.ts | grep -v '^#' | wc -l` returns >= 4 (one per sound; error may appear multiple times for the 3 failure branches + empty-transcript)
</verification>

<success_criteria>
- User taps mic → hears start.mp3 the instant recording begins (assets in place, hook wired, tests prove ordering)
- User taps stop → hears stop.mp3 immediately, then waits for STT (no perceived latency in audio feedback)
- User taps cancel → hears cancel.mp3 immediately, then recorder tears down silently
- STT fails → user hears error.mp3 in addition to seeing the error message
- Mic permission denied → NO sound plays (verified by Test B)
- A rejected .play() Promise (Safari autoplay-block, first-load edge case) does NOT break recording (verified by Test F)
- Ready to atomic-commit on `feat/tab-title-from-tmux` — NO push, NO docker build, NO docker compose up
</success_criteria>

<output>
Create `.planning/quick/260730-ptd-wire-mic-functionality-audio-feedback-in/260730-ptd-SUMMARY.md` when done.
</output>
