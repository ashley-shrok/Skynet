# MANUAL VERIFICATION — Phase 31 Post-Ship Procedure

**Purpose:** Phase 31 shipped instrumentation only (D-22 — no bugs fixed). The two deferred symptom bounties (`ws-pause-gate-stuck-connect-cycling`, `speak-button-broken-on-cellular`) are unblocked once Ashley reproduces on the instrumented app and confirms the new log trail lands as expected. This document is the post-ship verification procedure.

---

## 1. Purpose

Phase 31 added structured log lines to every major subsystem in the Skynet frontend and backend. The instrumentation makes the following previously-invisible information visible in `console-forward.log`:

- Which WS close code + reason + wasClean value fired on each disconnect (vs the old `{"isTrusted":true}` anti-pattern)
- Which ref transitions (wasConnectedRef, isConnectingRef, isVisibleRef, etc.) fired and why
- Which reopen-ladder path triggered each reconnect attempt
- Whether the pause-gate fired and blocked a reconnect while the pane was hidden
- TTS fetch resolution, play-attempt result (success / blocked / error), and each media event
- Backend WS accept/close events paired with frontend events for cross-side correlation

Phase 31 cannot diagnose or fix the root causes — it can only confirm the log trail lands where we put it. This runbook specifies how to confirm that in one 5-minute session per symptom.

---

## 2. Prerequisites

- Skynet deployed with all Phase 31 commits on the server (plans 31-01 through 31-09 merged; box-maintainer "Subagents don't do deploys" directive applies — deploy is orchestrator-only, not part of this plan).
- iPhone PWA opened at `term.gigaashley.click`.
- Cellular connection active (WiFi disabled on iPhone) — this matches the 08:03-08:07 UTC 2026-08-11 empirical baseline where both symptoms were observed.
- SSH access to skynet-ec2 for tailing the log file in a terminal session.

---

## 3. Reproduction A — WS Reconnect Cycle

**Targets:** `ws-pause-gate-stuck-connect-cycling` bounty — symptom "Waiting for connection logs..." / "Connection rejected by server"

### Step 1: Start the log tail on skynet-ec2

Open an SSH session to skynet-ec2 and run:

`sudo tail -F /opt/skynet/console-forward-logs/console-forward.log | grep -E '(\[ws\]|\[ws-msg\]|\[pause-gate\]|\[reopen\]|\[ws-server\]|\[pane-state\]|\[pane-state-emitter\]|\[session-server\])'`

Leave this running. Every relevant event from both frontend and backend will appear in real time.

### Step 2: Reproduce the symptom on iPhone

Open the Skynet PWA on iPhone with WiFi disabled. Either:

- Open a new session (fresh tmux session on a fleet host), or
- Open 2-3 sessions in a single PWA lifecycle until "Waiting for connection logs..." hangs appear (the symptom that first appeared 2026-08-11 after several rapid session-opens).

Wait up to 60 seconds for the symptom to reproduce or for normal connection to succeed.

### Step 3: Confirm the log trail

The log stream MUST contain, at minimum:

**On every WS disconnect:** `[ws] close code=<N> reason="<...>" wasClean=<true|false> hostId=<N> sessionId=<X>` — this replaces the old `[WebSocket] Error: {"isTrusted":true}` anti-pattern. If you see `code=1006` and `wasClean=false`, that is an abnormal close (connection dropped, not cleanly closed by the server). If you see `code=1000` or `code=1005`, the server initiated a clean close.

**On every ref flip:** `[ws] wasConnectedRef-transition edge=false→true trigger=<what>` on each change of `wasConnectedRef`; similarly for `isConnectingRef`, `isAttachingSessionRef`, `isVisibleRef`, `shouldNotReconnectRef`. If the reconnect cycle is spinning, you should see these flipping back and forth with trigger context naming the cause.

**On every reconnect attempt:** `[reopen] fired hostId=<N> path=<setup-effect|onclose-retry|visibilitychange|direct-caller>` — the `path=` field identifies WHICH of the four reopen-ladder paths fired. If you see the same path firing repeatedly without a corresponding `[ws] open` succeeding, that path is looping.

**If the pause-gate fires:** `[pause-gate] blocked-<caller> hostId=<N> reason=hidden` — appears when the pane is hidden and a reconnect was suppressed. If this line appears repeatedly while the user sees "Waiting for connection logs...", the pause-gate is correctly blocking reconnects for a hidden pane; the diagnosis question becomes whether the pane ever becomes visible again to trigger a fresh connect.

**From the backend, on every WS accept:** `[ws-server] accept userId=<U> wsUrl=<URL>` — confirms the backend saw the connection. If you see `[ws] open` on the frontend but no matching `[ws-server] accept`, the connection attempt didn't reach the backend (network layer failure).

**From the backend, on every WS close:** `[ws-server] close hostId=<N> tmuxSession=<X> code=<N> reason="<...>"` — backend close, paired with frontend `[ws] close`. If the codes differ, the close was not clean and the server may have logged additional context.

**On pane_state delivery:** `[pane-state] received phase=<state> sessionId=<X> hostId=<N>` on the frontend PrettyView.tsx side, PAIRED WITH `[pane-state-emitter] emit state=<state>` on the backend with matching `sessionId=`. If the backend emits but the frontend never receives a `[pane-state]` line, the log trail names the exact WS gap (pane_state frame sent but not delivered).

### Step 4: Confirmation criteria

Within ONE reproduction event, the log stream MUST unambiguously name:

- WHICH refs flipped (wasConnectedRef edge=, isConnectingRef edge=)
- WHICH reopen path fired (path= attribution)
- WHAT the close code was (code=, wasClean=)
- WHETHER the pause-gate blocked any reconnect attempt (blocked-* line present or absent)

If the reconnect cycle NEVER produces `[ws-msg] received type=<...>` lines, the "connect-then-nothing" symptom is confirmed: the WS is establishing but no messages flow after connection. This pattern — `[ws] open` followed immediately by `[ws] close` without any `[ws-msg]` — is the precise shape needed to distinguish "server closed immediately" from "connection dropped during handshake" from "connected but pane_state never delivered."

---

## 4. Reproduction B — TTS Speak Silence

**Targets:** `speak-button-broken-on-cellular` bounty — speak button pressed, no audio plays

### Step 1: Start the log tail on skynet-ec2

Open an SSH session to skynet-ec2 and run:

`sudo tail -F /opt/skynet/console-forward-logs/console-forward.log | grep '\[tts\]\|[voice-server]'`

Leave this running.

### Step 2: Reproduce the symptom on iPhone

Open Skynet PWA on iPhone with WiFi disabled. Navigate to a pretty-view conversation with a recent assistant message. Tap the speak button on a message. If audio plays, the symptom is NOT reproducing — verify you are on cellular and the correct message has content. If no audio plays after 10+ seconds, that is the reproduction.

### Step 3: Confirm the log trail

The log stream MUST contain, at minimum:

**At tap:** `[tts] speak-start owner=<N> textLen=<N> voice="..." trigger=user-click` — confirms the speak-button handler ran to the point of calling startSpeak(). If this line is ABSENT, the issue is in the tap handler or autoplay effect, not the TTS pipeline.

**After fetch:** `[tts] fetch-start owner=<N> url=/voice/speak-stream textLen=<N>` followed by `[tts] fetch-resolved status=<N> ok=<true|false> owner=<N>`. If `ok=false`, the backend returned an error — check the backend `[voice-server] speak-stream-req` and `[voice-server] speak-stream-ok` lines to confirm whether the request reached the backend. If `fetch-resolved` is ABSENT after 30+ seconds, the fetch timed out or the network dropped it.

**At play attempt:** `[tts] play-attempt owner=<N> src=stream` followed by one of:
- `[tts] play-attempt ... result=success` — AudioContext play() resolved. If this appears but no audio is heard, the issue is in iOS audio routing or the AudioContext state (not a TTS pipeline failure).
- `[tts] play-attempt ... result=blocked errName="NotAllowedError" errMessage="..."` — iOS blocked the audio play due to gesture context loss. This is the iOS AudioContext gesture-lock issue noted in plan 31-03.
- `[tts] play-attempt ... result=error errName="..." errMessage="..."` — an unexpected error on play().

**Media events (if play started):** `[tts] media-canplay` (first chunk decoded), `[tts] media-playing` (AudioContext resumed), `[tts] media-stalled` (reader.read() returned undefined mid-stream), `[tts] media-ended` (all chunks played). If `media-canplay` appears but `media-playing` never fires, the AudioContext may be suspended under cellular constraints.

**Backend counterpart:** `[voice-server] speak-stream-req textLen=<N> voice="<X>"` confirms the request reached the backend. `[voice-server] speak-stream-ok status=200` confirms the backend started streaming. If neither appears, the request never reached the backend (network failure on cellular before the HTTP request completed).

### Step 4: Confirmation criteria

Within ONE reproduction event, the log stream MUST unambiguously name WHICH stage failed:

- `speak-start` absent → tap handler didn't fire (input/event-binding issue)
- `fetch-start` absent after `speak-start` → startSpeak() early-returned (preempt-race or gate condition)
- `fetch-resolved ok=false` → backend returned error; check `[voice-server]` lines
- `fetch-resolved` absent → network dropped the fetch before response (cellular timeout)
- `play-attempt result=blocked errName="NotAllowedError"` → iOS gesture-lock (AudioContext blocked)
- `play-attempt result=success` but no audio → iOS audio routing issue (not a TTS pipeline failure)
- `media-stalled` before `media-ended` → cellular packet loss during streaming

---

## 5. What to Do With the Observations

**If Reproduction A/B confirms the log trail lands as expected** (all listed log lines appear and name the failure stage):

Phase 31 is verified as shipped correctly. Open one or two follow-up bounty(-ies) to diagnose and fix the root cause using the new log data:

- For WS reconnect cycling: use the `path=`, `code=`, `wasClean=`, and ref-transition lines to determine whether the root cause is the pause-gate interaction with the reopen ladder, or the Phase 30 cleanup path (usePaneResolvingMachine rewire). The log trail will disambiguate the two prime suspects documented in the bounty.
- For TTS silence: use the `play-attempt result=` line to determine whether iOS gesture-lock is the cause, vs network-level failure, vs AudioContext routing.

**If the log trail is MISSING an expected line** (e.g., `[pause-gate] blocked-*` never appears despite the symptom being a pause-gate stall, or `[tts] speak-start` never appears despite the button being tapped):

Phase 31 has a coverage gap. File a revision back to the responsible plan:

- Missing `[pause-gate]` lines → revise plan 31-02 (Terminal.tsx instrumentation)
- Missing `[tts]` lines → revise plan 31-03 (ChatMessage.tsx instrumentation)
- Missing `[ws-server]` lines → revise plan 31-08 (backend claude-session-server.ts instrumentation)
- Missing `[voice-server]` lines → revise plan 31-08 (backend voice.ts instrumentation)

**If the log trail's lines are structurally malformed** (e.g., `code=undefined`, `reason="[object CloseEvent]"`, `hostId=NaN`):

File a revision back to the responsible plan to fix the field extraction.

---

## 6. Ashley's Role

1. After Phase 31 is deployed, reproduce ONE instance of each symptom on her iPhone PWA on cellular (this is the whole point of Phase 31 — ambient-signal collection from the instrumented app).
2. Open an SSH session to skynet-ec2 and run the `sudo tail -F ... | grep` commands from sections 3 and 4 (5-10 minutes of log watching per symptom).
3. Capture the log output from the reproduction window (or share the skynet-ec2 grep output).
4. Report back with either "log trail lands as expected — opening bounty for diagnosis" or "log trail missing X — revising Phase 31."

The grep commands above are designed to produce a self-contained log excerpt that contains everything needed for diagnosis, without requiring Ashley to understand the log format.

---

## 7. Silence-Is-Success Rule

Per box-maintainer.md convention: if Ashley doesn't reproduce and report back within a reasonable window (several days post-deploy), Phase 31 is assumed verified. This runbook is not a blocking gate — it is a preferred path that unlocks faster diagnosis of the deferred bounties.

The alternative path is: Phase 31 ships, a new symptom appears in a later session, and the log trail surfaces the diagnosis at that point automatically. Phase 31 still delivered value — it just didn't get an explicit "log trail confirmed" signal before the diagnosis opportunity arose.
