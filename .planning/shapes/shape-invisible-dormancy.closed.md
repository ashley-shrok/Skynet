# Shape: invisible dormancy/wakes

**Opened:** 2026-08-23
**Vehicle:** GSD phase

## What this is

Right now, when a session goes to sleep after 30 minutes idle, the pretty view surfaces
that fact prominently — a bubble at the bottom of the message list says "This session is
asleep" and offers a Wake button. Clicking wake shows a progress bar filling over about
90 seconds until the session is back up, at which point the overlay dismisses and normal
compose is re-enabled. Sending a message while the session is asleep is blocked entirely;
the compose box is disabled until wake completes.

This shape removes all of that. The concept of a session being dormant or in the middle
of waking becomes an implementation detail with no user-facing surface. Whether a
session happens to be asleep or awake is invisible to whoever is looking at pretty view —
same conversation history, same enabled compose box, no bubble, no badge, no ambient
marker of any kind. If someone types into a session that happens to be dormant and hits
send, the send itself is what triggers the wake — the message threads into the freshly
woken session as its next prompt, and the only observable difference from a normal send
is that reconciliation takes about 90 seconds longer than usual while the harness comes
up. The failure-mode backstop is the existing one: if the message never lands within a
reasonable window, the optimistic bubble goes red — same mechanism as today, just with a
widened window when the send happened during dormancy.

## Shape

Three intertwined pieces make it work, plus one deletion.

**Send-while-dormant path.** When a message is sent, the backend already dispatches it
into the pane asynchronously — the send returns quickly and reconciliation happens later
against the session file on disk. Under this shape, if the pane is dormant when the send
handler runs, the backend drops the sentinel that agent-supervisor watches (exactly the
same drop the current wake button does), then waits for the "harness is up and ready to
accept a prompt" signal — a marker file that agent-supervisor writes when the freshly
launched claude has finished loading its identity — then does the normal tmux delivery
into the pane. Multiple sends arriving during the wake window naturally serialize: the
sentinel drop is idempotent, and the send-keys deliveries happen in order once the
harness is ready. If the marker never appears within the fallback window (about 90
seconds, same as today's wake timing expectation), delivery falls back to attempting the
send-keys anyway.

**Wake-detection signal.** The load-bearing piece — "is the harness up and ready" —
already exists. Agent-supervisor writes a marker file at the end of the identity load
sequence. Today's dormant-poll uses that marker as a freshness gate when the wake was
user-initiated. The send-while-dormant path reuses the same marker with the send time
as the wake trigger timestamp. No new detection mechanism.

**Reconciliation-backstop timing.** The existing watchdog that flips an optimistic
bubble red when reconciliation doesn't happen within its window keeps working. Its
window widens when the send was dispatched during dormancy — sized to accommodate the
~90-second wake latency on top of the normal-send reconciliation window. A single
branch on the same watchdog, not a new mechanism.

**Deletion.** The dormancy overlay (bubble + Wake button + progress bar), the wake
websocket message and its handler, the elapsed-seconds ticker feeding the progress bar,
the compose-box disable-when-dormant gate, and all related tests — deleted. The backend
still tracks dormant state internally (for send-path gating, for wip-indicator gating,
for fleet-status) — that concept doesn't disappear; only its surfacing does.

## Philosophy

**Dormancy is a hardware detail, not a user concept.** Whether a claude session happens
to be running right this second is a fact about the box, not about the conversation.
The user is talking to an agent. Whether that agent's process is currently in memory is
the operating system's business.

**Same affordance for dormant sessions as awake ones.** The compose box works the same
way regardless of state. The message optimistic-bubble looks the same. Reconciliation
works the same way. The failure mode surfaces through the same channel. There is no
"dormant mode" of the UI, because there is no dormancy visible to the user.

**Send is the only new wake trigger.** The other existing wake triggers — a Matrix
message arriving, a scheduled wake firing — still work exactly as they do today, and
they were already invisible. Send joins them as a third invisible trigger. There is no
wake-on-focus, no wake-on-scroll, no wake-on-any-implicit-attention. The user takes an
action; that action wakes the session as a side effect.

**Delete, don't hide.** The dormancy overlay is not preserved behind a debug flag or
kept as an "escape hatch when things go wrong." It's fully removed. The backend still
knows what state a pane is in; the UI does not.

## Prior context

**Today's dormancy overlay** is a rich in-flow bubble at the bottom of the message
list, mounted when the backend reports the pane state as dormant. Three variants:
"asleep" (Moon glyph + Wake button), "waking" (Moon + progress bar filling over ~90s,
no button), "error" (warm-red variant with retry). The overlay was intentionally
redesigned in mid-August from an earlier full-surface scrim to an in-flow bubble
specifically so prior message history would stay readable while asleep. Ashley has
never used the Wake button as an escape hatch when things got stuck — the button's
only real role has been "the way to un-sleep this session so I can talk to it."

**Today's send path** returns fast from the http request and reconciles the optimistic
bubble later against a message appearing in the session file. The compose box is
disabled when the pane is dormant, so a send while dormant is impossible today — the
user has to click Wake first, wait for wake, then type.

**Today's watchdog** flips an optimistic bubble red when a matching session-file entry
doesn't appear within its window. The window is sized for "normal send, session is up."

**Today's dormant-poll** watches for the `.dormant` sentinel to disappear (which happens
when agent-supervisor consumes a wake request), then transitions the pane back to active
flow. When the wake was user-initiated, it uses the `.resume-complete` marker's freshness
against the wake-trigger timestamp as the "harness is actually ready" gate, with a 90s
fallback for supervisors that pre-date the marker contract.

**Recycle is a different mechanism** — a full-surface scrim + centered card that appears
during a user-initiated session recycle (identity dropped `.recycle-requested`). Recycle
is out of scope. That overlay stays exactly as-is.

## What would make it wrong

**Any visible surface that names dormancy or waking to the user.** A banner, a badge, a
tooltip, a status pill, a subtle color shift, anything. If a user can tell that this
particular pane is currently asleep by looking at it, we missed the point.

**A dormant pane feeling broken when sent to.** If the optimistic bubble stays
un-reconciled with no explanation for 90 seconds and the user starts wondering if the
send got lost — that's a failure. The bubble's normal spinner during the reconciliation
window is the answer here (same as any slow reconciliation looks today), but the
watchdog window has to be wide enough that a healthy wake never trips the red-bubble
backstop.

**Any wake trigger other than send.** Wake-on-focus, wake-on-scroll, wake-on-hover,
wake-on-any-implicit-attention — all violate the shape. Wake happens because the user
did a thing that requires the session to be running (sent a message); it does not
happen because they merely looked.

**A message getting lost during the wake window.** If the send-keys fires too early
(before the harness REPL is actually up), the keys go to the shell or /id command's
output routing and vanish. The `.resume-complete` marker check exists specifically to
prevent this; the fallback path (90s window then attempt anyway) is a last resort, not
the primary strategy. If the marker check is bypassed or the fallback fires under
healthy wake conditions, sends will silently drop.

**Multiple sends landing out of order.** If she types two messages during dormancy,
they must arrive at the harness in send order. The natural sentinel-drop-then-wait
serialization gives us this, but if implementation-side we accidentally spawn parallel
send-handlers that race, ordering can break.

**Backend state leaking to the frontend.** Internal "waking" tracking on the backend is
fine and necessary — the send handler needs it, the watchdog window widening needs it.
But any emission that flows to the frontend and could get rendered — a pane-state event
saying "waking," a fleet-status field marking the pane as mid-wake, anything the UI
could latch onto — either stops being emitted or has to be explicitly ignored by the
frontend.

## Scope edges

**In:**
- Delete the dormancy overlay component and its full wire-up (the wake websocket
  message, the elapsed-seconds ticker, the frontend state that tracks waking).
- Un-gate the compose box so it stays enabled regardless of pane dormancy state.
- Teach the backend send-path to notice dormant state, drop the sentinel, wait for the
  `.resume-complete` marker (or its fallback), then do the normal delivery.
- Widen the optimistic-bubble reconciliation-watchdog window when the send happened
  during dormancy.
- Suppress or drop any pane-state event flowing to the frontend that would communicate
  "waking" as a user-facing signal.
- Update or delete tests tied to the deleted UI (dormancy overlay tests, compose-box
  dormant-disable test, wake-message handler tests) and add coverage for the new
  send-triggered wake path.

**Out:**
- Recycle mechanics and the SessionHoldingOverlay — different concept, stays as-is.
- Identity birth mechanics — separate code path with its own timing-based Enter train,
  not affected.
- Agent-supervisor itself — no changes to the supervisor script or the sentinel/marker
  contract. This shape rides on the existing contract.
- Wake-on-focus or any other new wake trigger. Send is the only new one.
- The existing Matrix-DM and scheduled-wake triggers — they already work invisibly and
  keep doing so.
- Any escape-hatch UI in pretty view for "session is stuck" — the tmux terminal view
  behind pretty view is the escape hatch for that case, and Ashley doesn't use the
  current wake button for escape today.
- Debug/observability UI surfaces. Backend logs stay as-is; no new user-facing telemetry.

**Deferred / tempting-but-no:**
- Any redesign of pv-send-watchdog beyond "widen its window for dormant-triggered
  sends." The mechanism doesn't need rework, just a branch on window sizing.
- A "just-in-time context" indicator that shows something happened during wake. The
  invisible principle is the whole point; don't add a tiny half-signal that partially
  violates it.
- Migrating the `.resume-complete` marker contract to something more general. Works
  fine for this; broader marker-protocol work is its own thing if it ever comes up.

## Vehicle notes

**Chosen vehicle: GSD phase.** Three intertwined surfaces (compose-box gate + send-path
teach + watchdog widening) plus a component deletion plus test overhaul, all of which
have to land coordinated or the intermediate states break the UI. Same scale as Phase
55 (tap-to-load-discovery-reuse) which shipped as a phase.

**Handoff.** Executed by identity `tina` at `~/skynet-tina/` on branch
`feat/tab-title-from-tmux`. Standard box-maintainer container-mutation protocol applies
for the deploy — full-suite ship-gate, coord-room BEFORE/AFTER, deadman-safe recreate.

**Seed CONTEXT.md from this shape file.** The /open discovery captured the why, what,
philosophy, and scope edges — discuss-phase shouldn't re-elicit them. Either drop this
shape file in as CONTEXT.md directly, or generate CONTEXT.md from it, then let
discuss-phase focus on the remaining implementation-level unknowns (exact watchdog
window numbers, exact send-path integration point in `claude-session-server.ts`, test
strategy).

**Reference files worth naming for the executor:**
- `src/ui/features/pretty-view/DormancyOverlay.tsx` — to delete.
- `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` — to delete.
- `src/backend/claude-session/claude-session-server.ts` — send path + wake handler +
  dormant-poll + `.resume-complete` freshness contract (search "resume-complete" and
  "applyWakeMessageForTests").
- `src/backend/claude-session/pv-send-watchdog.ts` — the reconciliation watchdog to
  widen.
- `src/backend/claude-session/sentinel-detect.ts` — dormant-state detection.
- `src/backend/claude-session/pane-state-emitter.ts` — pane-state event flow to
  audit for any "waking" emission that needs to stop.

---

## Close-Out

**Closed:** 2026-08-23
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is (dormancy invisible; send is the wake trigger)** — present · Dormant frame no longer mounts any bubble/badge; compose stays enabled; send into a dormant pane routes through the backend's invisible-wake path with no user-visible ceremony.
- **Shape — Send-while-dormant path** — present · Backend send handler checks dormant state at entry, drops the `.dormant` sentinel via `rm -f`, writes wake-trigger timestamp, polls `.resume-complete` marker in a 500ms loop until marker is fresh or 90s fallback elapses, then falls through to the normal split-send code path.
- **Shape — Wake-detection signal (reuses existing .resume-complete marker)** — present · No new detection mechanism. The send-path shares the same 90s fallback constant and marker-freshness contract as the pre-existing dormant-poll rediscovery seam.
- **Shape — Reconciliation-backstop timing (widened watchdog)** — present · Watchdog gained a dormant-send flag; when set, retry/full-resend/give-up timings become 92.5s / 95.5s / 120s — comfortably above a healthy ~90s wake. Wired at both split-send and retry-Enter-only arm sites.
- **Shape — Deletion (overlay + wake WS message + handler + progress bar + compose-disable + tests)** — present · DormancyOverlay component, its test, and the compose-box dormant-disable test all removed from disk. Backend wake WS handler deleted; frontend wake callback deleted; waking-timestamp field removed from dormant emit; wake-result wire type removed; wake-result frontend handler removed.
- **Philosophy — Same affordance for dormant as awake** — present · Compose has no dormant-active prop; send-disabled predicate has no dormant term; textarea and send button both enabled on dormant panes (Phase 60 Test 1 asserts).
- **Philosophy — Send is the only new wake trigger** — present · No focus/scroll/hover wake triggers introduced. Matrix DM + scheduled wake triggers untouched. Send-path is the only new invisible trigger.
- **Philosophy — Delete, don't hide** — present · No debug flag preserves the overlay. Files removed outright; only comments-and-tombstones remain in surrounding code as historical breadcrumbs.
- **Scope edges — In (component/test deletion, un-gate compose, teach send-path, widen watchdog, suppress waking emission, test overhaul)** — present · All in-scope items delivered. Waking-state React slots all deleted.
- **Scope edges — Out (recycle, identity birth, agent-supervisor, extra wake triggers, debug UI)** — present · SessionHoldingOverlay untouched by Phase 60. Identity birth path untouched. Sentinel-detect and pane-state-emitter untouched.
- **What would make it wrong: any visible surface names dormancy/waking** — present · No user-visible label containing "asleep" or "waking" or "wake" anywhere in the rendered pretty view. Backend still emits dormant frame for internal state, but nothing renders text or badge from it.
- **What would make it wrong: dormant pane feels broken when sent to** — present · Widened watchdog give-up window pushed to 120s — comfortably above a healthy ~90s wake, so the red-bubble backstop does not false-fire during normal invisible wake.
- **What would make it wrong: any wake trigger other than send** — present · No focus/scroll/hover/mouseenter wake wiring. Send is the only newly-added invisible wake trigger.
- **What would make it wrong: message lost during wake window** — present · Marker-freshness gate polls `.resume-complete` every 500ms and only falls through to send-keys when the marker is fresher than the send-trigger timestamp. The 90s fallback is a last resort per the shape and only fires after no marker for 90s.
- **What would make it wrong: multiple sends land out of order** — present · No parallel handlers introduced. Send handler is sequential per WS input frame. Test SWD-3 asserts that two rapid sends into a dormant pane land in send order with idempotent sentinel drop.
- **What would make it wrong: backend state leaks to frontend as user-visible signal** — present · Pane-state union has no "waking" variant. Waking-timestamp field removed from the dormant emit. Wake-result type removed. The remaining dormant frame carries only a boolean, no timestamp the UI could latch onto.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Notable preservations by design: (1) the dormant WS frame stays on the wire for backend-internal state tracking (WIP-indicator gating, live-frame auto-dismiss) — this matches the shape's "The backend still tracks dormant state internally... only its surfacing does"; (2) the compose-mount gate deliberately preserves the dormant OR-term so compose stays mounted on dormant panes, which is what allows the user to type and trigger the invisible wake; (3) an active OR-term was also added to the compose-mount gate specifically to prevent losing compose state (voice recording, textarea text) during the wake-transition unmount gap — this fixes a subtle wake regression rather than adding a new feature. The verifier's own artifact (60-VERIFICATION.md) walked the same facets independently and reached the same conclusion. One cosmetic follow-up flagged in the verification doc: Task 6 (cleanup of ~20 pre-Phase-56 DormancyOverlay mentions in JSDoc comments across peer files) was explicitly deferred as non-blocking cosmetic debt.
