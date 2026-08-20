# Shape: optimistic message bubbles

**Opened:** 2026-08-19
**Vehicle:** gsd phase

## What this is

When you press send in the chat, the current experience is a dead moment: the message box clears, then a long silence until the app notices the message has landed in the harness's session file and finally renders a bubble. This work makes the bubble appear the instant you press send, then confirms itself when the session file confirms the message got through, and only surfaces a failure state when a message genuinely didn't make it. A second, related fix is folded in: the retry that catches missed Enter presses today uses a noisy activity signal and still occasionally misses, so it gets replaced with the same specific session-file signal that drives the new bubble behavior.

## Shape

Three connected pieces.

**One — the bubble state on the front end.** The moment the user presses send, a bubble appears immediately with a small spinner indicating "in flight." When the app receives the session-file signal that the message has been accepted by the harness — whether it was processed straight away or slotted into the harness's own queue — the spinner clears and the bubble looks normal. If no signal arrives after roughly twenty seconds, the bubble turns red and the message box repopulates with the text so it can be edited and re-sent. Only the most recent sent bubble ever shows the spinner or the red state — older sends stay quiet — so the surface doesn't accumulate anxious indicators over a long conversation.

**Two — the back-end signal that makes this honest.** The harness writes to the session file the instant a message is accepted, in one of two shapes. If it processes the message right away, it appears as a regular user turn. If the harness is busy and queues the message, it still appears — as a distinct enqueue entry — within a couple hundred milliseconds of pressing send. The app currently only understands the first shape; the second is silently ignored for message-rendering purposes. This work teaches the app to treat both as first-class "message accepted" signals. The queued shape also appears a SECOND time later, when the harness eventually processes it as a normal user turn — the app has to know that second appearance is the same message and not render a duplicate bubble.

**Three — the missed-Enter retry, rebuilt on the same signal.** The existing retry logic watches for any activity coming back from the harness pane in the first few seconds after send and assumes silence means the Enter didn't register. Activity is noisy — the pane emits it for many unrelated reasons — so the existing retry sometimes concludes "we're fine" when we're not. The new retry watches for the specific session-file signal instead. At roughly two to three seconds without a signal, it fires another Enter. At roughly five to six seconds still without a signal, it clears the harness's message box, retypes the text, and hits Enter again — a full re-send, in case the text itself was lost. At roughly twenty seconds still without a signal, it gives up: the bubble goes red and the front end is told the send failed.

## Philosophy

Perceived responsiveness comes first. This isn't a delivery-guarantees system; it's about the chat feeling alive when you hit send.

Prefer specific signals over noisy ones. The current retry uses whatever bytes happen to come back from the pane as a proxy for "message got through" and pays for that with missed detections. The new signal — an entry in the session file that only appears for actual accepted messages — is specific to what we want to know. Any time a specific signal is available, use it, and only reach for a heuristic when it isn't.

Never falsely tell the user their message failed. The whole reason a fixed timeout is unusable naively is that a truly-queued message can sit for many minutes before the harness processes it. The signal being used here fires the instant the message hits the queue, so the timeout only trips when the message truly didn't make it — never on legitimately-slow processing. This precedent is load-bearing: even in future refinements, a message that we can see has been accepted must never be flipped to a failure state by a client-side clock.

Keep the surface quiet. Only the latest sent bubble carries indicators; older ones look plain. The spinner is small. There is no separate "processing now" visual state added just because a distinct signal is available — that would be noise without matching value. When in doubt, remove.

## Prior context

The app today has an explicit policy that forbids the front end from ever showing a bubble before the session file has confirmed the message. That policy exists because rendering ahead of the file has produced ghost bubbles and drift in the past. Undoing it deliberately, with a signal-driven state machine and a real failure affordance, is what this work is; the deletion of that policy is the pointer future readers should follow to understand why the file-first invariant existed.

The retry that catches missed Enters is a small watchdog added earlier during a paste-related bug. It fires an extra Enter at two-and-a-half seconds if the harness pane has been silent, and gives up at five seconds. It works most of the time but is known to occasionally conclude "we're fine" during an unrelated stream of activity from the pane; those cases are the exact reason this work exists.

The session-file parser already understands the enqueue-shape entry for one narrow purpose (background-agent completion notifications). Extending it to also treat normal-content enqueue entries as user-message-accepted signals is a natural continuation of what's already there, not a new mechanism grafted on.

The empirical basis for the design — that the harness writes both direct and queued messages to the session file within a couple hundred milliseconds, in the two distinct shapes described above — was confirmed during the opening discussion by directly reproducing a mid-turn queued message and inspecting the resulting file. Notes: send took ~91ms for a direct user turn; queued message enqueue took ~111ms; the same queued message appeared as a normal user turn a second time when the queue drained roughly two minutes later.

## What would make it wrong

- A message that is legitimately sitting in the harness's queue ever getting flipped to the red-failure state by the timer. This is the entire point of using the specific enqueue signal; if this happens, the design has been misimplemented.
- A single sent message ever rendering as two bubbles because the queued-then-consumed message appears twice in the session file and both appearances got emitted.
- The retry ever submitting an unintended message — a truncated version, a stale draft, a duplicate of a message that actually did make it through. The retry logic firing on a message that was actually accepted must be a safe no-op, never a duplicate submission.
- The spinner or red state visually loud enough that it competes with the chat content. This work should feel like a refinement of what's already there, not new chrome pasted on top.
- A build where the retry logic and the bubble state logic each maintain their own idea of "has this message been accepted" and drift apart. There is one signal; both features consume it.
- Any surviving fallback path that quietly renders a bubble without a corresponding session-file signal. If a bubble appears, either the session file has confirmed the message, or the bubble is in its optimistic-with-spinner state waiting for that confirmation. There is no third path.
- Spinner or red indicators appearing on older sends after a new send has been made. Only the latest sent bubble carries state.

## Scope edges

**In.** The optimistic bubble on send. The spinner state. The red failure state. The message box repopulating on failure. The session-file signal extended to cover the enqueue shape. The retry-Enter and full-resend replacing the existing activity-based watchdog. The dedup logic that prevents a queued message from rendering twice. In-process tests covering both the happy path (signal arrives, spinner clears) and the failure path (no signal, timer trips, red bubble).

**Out.** Any change to how the harness itself queues messages. Any change to how messages are ordered or rendered in the harness's own display. Any concept of "delivered" vs "read" states — those come from consumer-messenger prior art and don't apply here; there is no distinct "recipient read it" event. Any change to the session-file watching mechanism itself.

**Deferred.** Distinguishing "queued" from "actively being processed" as separate visual states on the bubble. The signal for this exists (a dequeue entry lands when the harness starts consuming a queued message), but adding it now would be visual noise without matching value. If a later need surfaces — a debugging affordance, a busy-state indicator — pick it up as its own change.

**Tempting-but-no.** Introducing a per-message identifier that would be attached to outgoing sends and echoed back in the session file, to guarantee perfect matching. First-in-first-out order plus content matching is enough for the cases this design actually cares about, and adding an identifier would require harness-side cooperation the app doesn't have. Also tempting-but-no: replacing the twenty-second outer timer with something that adapts to observed harness behavior. Fixed and honest beats clever and drifty.

## Vehicle notes

**Why a full phase.** Multi-file change on both the front end and the back end. Deliberately reverses a stated architectural policy (the file-first bubble invariant in the message-box component). Rips out and replaces an existing watchdog that lives on the send path in the terminal layer. Adds a distinct new emission from the session-file parser. Adds new state and rendering logic to the bubble component. In-process tests need to cover the state transitions on both paths and the retry sequencing.

**Files the implementer will touch.** Front end: the message box component (the file-first hard-lock lives near the send handler; the compose-04 comment marks it) and the chat message component (new spinner state, red state, latest-bubble-only rendering). The websocket-message handler that feeds the message list needs to route the new enqueue-shape emission and handle dedup. Back end: the session-file parser (the queue-operation branch around the task-notification handler; extend to also emit for normal-content enqueue entries) and the send-path terminal file (rip out the PV submit watchdog around lines 777-805; new retry logic keyed off the parser signal). Test files in the same directories.

**Branch state.** Working on feat/tab-title-from-tmux, the multi-identity shared branch. Two commits sit un-deployed on this branch from earlier this session (the identity-writes forceSave fix and the context-meter diagnostic instrument). Ashley approved shipping everything together at the end of this phase; do not deploy prematurely.

**Empirical data available.** The opening discussion for this shape reproduced the mid-turn queued message case in a throwaway harness session and captured concrete timings and JSONL shapes; the numbers cited in Prior context above come from that run. If the implementer wants to re-verify or extend, the reproduction pattern is: start a fresh session, send a message that forces the assistant into a long turn, immediately send a follow-up while the first is still processing, watch the session file for the two entries. The queued follow-up shows up within a couple hundred milliseconds as an enqueue-shape entry, then again as a normal user turn when the queue drains.

**Fleet constraints that apply.** Deploy after code + tests green is orchestrator-only, not the executor's job. Coord-room announce before and after any container mutation. Rebase before every push on the shared branch. No worktrees. Standard fleet rules — nothing bespoke to this work.

---

## Close-Out

**Closed:** 2026-08-20
**Vehicle used:** gsd phase (Phase 50, 4 sub-plans 50-01..50-04)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **Shape §1 — optimistic bubble on send (spinner, ~20s red, composebox repopulate)** — present · D-01/D-03 verified: ComposeBox seeds mqid + fires onOptimisticSend synchronously; PrettyView 20000ms timer flips to red and populates composeOverrideText; ChatMessage renders spinner and muted-red styling.
- **Shape §1 — 'only latest sent bubble ever shows spinner or red state'** — endorsed-drift · Latest-only applies to spinner (D-04) but red persists on ALL failed bubbles indefinitely — Ashley confirmed "fine as is" on both the primary and the sharpening question; accumulate-forever chosen intentionally, no clearing rule.
- **Shape §2 — backend signal (direct + queued both first-class, dedup on second appearance)** — present · D-02/D-09/D-10/D-11 verified: session-file-parser extends queue-operation branch for normal-content enqueue emitting kind:'message'; per-connection dedup Map keyed by sha256(content).slice(0,32) suppresses the later user-turn dequeue exactly once.
- **Shape §3 — retry rebuilt on the same signal (2-3s retry Enter, 5-6s full re-send, ~20s give up)** — present · pv-send-watchdog: RETRY_ENTER_MS=2500, FULL_RESEND_MS=5500, GIVE_UP_MS=20000; retry is bare send-keys Enter (D-16 safe no-op); full re-send is C-u + literal body + Enter scoped to harness pane (D-17); old activity-based watchdog DELETED.
- **Philosophy — one signal, both features consume it** — present · Backend notifyMatched (pv-send-watchdog + PrettyView case 'message') both consume the same session-file-parser emission; content-hash derivation byte-identical across all 6 sites.
- **Philosophy — never falsely tell the user their message failed** — present · D-05 enforced structurally: on match, entry is REMOVED from pendingSends array and its timer cleared; flipToFailed guards on state==='sending' — no code path can flip a matched bubble.
- **Philosophy — keep the surface quiet (small spinner, muted red, no processing-state)** — present · h-3 w-3 trailing-edge spinner; muted hsla borders and tints; deferred queue-vs-processing visual distinction NOT added.
- **Scope In — every listed item delivered** — present · Optimistic bubble, spinner, red, composebox repopulate, extended parser, watchdog replacement, dedup, in-process tests for both paths — all present with locking tests.
- **Scope Out — no harness changes, no delivered/read states, no watcher changes** — present · No modifications to harness queue behavior; no read-receipt concepts introduced; session-file watch mechanism unchanged.
- **Deferred — no queued-vs-processing visual distinction** — present · PendingSend state is only 'sending' | 'failed'; no third dequeue-triggered visual state added despite the signal being technically available.
- **Tempting-but-no — no wire-level per-message identifier, no adaptive timer** — present · D-08: mqid is client-scope only, never injected into JSONL; matching uses FIFO+content equality. 20s timer is a fixed constant, not adaptive.
- **What would make it wrong: legit queued msg flipped to red by timer** — prevented · Dedup Map ensures the enqueue-shape signal arrives ~200ms after send, matching + removing the pending and clearing the 20s timer long before it fires.
- **What would make it wrong: single sent message rendering as two bubbles** — prevented · Per-connection queueEnqueueDedup Map with single-shot delete on suppress; verified by integration test (b) with explicit T+120000ms dequeue and (g) asserting wsSend called exactly once.
- **What would make it wrong: retry submits unintended/duplicate/truncated message** — prevented · Retry Enter is bare send-keys Enter with no body — safe no-op if composebox already empty; full re-send starts with C-u to clear the harness composebox before typing.
- **What would make it wrong: spinner or red loud enough to compete with chat** — prevented · Muted hsla tokens and small spinner glyph; no new theme tokens introduced; feels like refinement, not chrome.
- **What would make it wrong: retry and bubble state each track 'accepted' independently and drift** — prevented · Single notifyMatched call drives BOTH backend watchdog cleanup AND (via wire) frontend spinner clear; content-hash derivation identical across all sites.
- **What would make it wrong: surviving fallback path that renders bubble without session-file signal** — prevented · PendingSend.state type is exactly 'sending' | 'failed'; matched entries removed from array; no third path in type system or render gate.
- **What would make it wrong: spinner or red on older sends after a new send** — partial (endorsed drift) · Spinner: latest-only enforced via strict identity check. Red: persists on all failed bubbles — Ashley confirmed "fine as is." See endorsed-drift facet above.

### Additions (in the result, not in the shape)

- send_keys_error fast-fail WS frame on backend execCommand throw (D-21) — not an addition; natural expression of shape · Shape philosophy says "only surface a failure state when a message genuinely didn't make it." An execCommand throw at ingress means zero keystrokes reached the pane — the paradigm case of a genuine non-delivery. Flipping to red immediately (rather than waiting 20s for a signal that provably cannot come) honors both the responsiveness principle and the "never falsely tell the user their message failed" invariant.
- immediateFailure:true synchronous WS.send-failure red path (D-20) — not an addition; natural expression of shape · Same reasoning: if the WebSocket is not open at Enter time, the send provably never left the browser.

### Follow-ups

None.

### Notes

One endorsed drift recorded: red state accumulates on all prior failed bubbles indefinitely (shape §1 could be read as scoping BOTH indicators to latest-only). Ashley picked accumulate-forever intentionally when asked — no caveat, no clearing rule. The impl (D-04) scopes latest-only only to the spinner path, and this is now the endorsed shape. All 23 D-IDs verified with locking tests; 7 acid tests green; 6 pass + 1 intentional-skip on integration suite; 0 fleet-directive violations. No genuine misses; no additions beyond the shape's philosophy; nothing to escalate.
