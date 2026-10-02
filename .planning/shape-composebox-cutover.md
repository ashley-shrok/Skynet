# Shape: composebox compose-send switches onto the agent-supervisor inbox path

**Opened:** 2026-10-02
**Vehicle:** inline
**Campaign:** composebox-via-agent-supervisor (artifact at
`.planning/campaign-composebox-via-agent-supervisor.md`)
**Depends on:** shape-agent-supervisor-inbox (must be live and proven in
production before this shape starts)

## What this is

The browser-facing side of the app stops delivering compose-send
messages to agents by writing directly into their terminal panes over
SSH. Instead, it drops request files into the per-identity inbox that
the agent-supervisor's ambient watcher now watches (installed by Shape
1). The ambient watcher takes it from there, pastes through its shared
lock, and the message lands in the pane with the same discipline that
watcher events use today.

The round-trip signal the frontend relies on (transcript-echo match on
user-turn append, send-order per pane) is unchanged. The watchdog
window sizing (active-send 20s give-up, dormant-send 120s give-up) is
unchanged. The sending-bubble UX is unchanged. The transport under
these mechanisms is what changes.

Old code (the dormancy-wait block, split-send body-then-Enter dance,
retry-Enter escalation, full-resend escalation) is retired entirely —
not left behind a flag.

## Shape

The compose-send handler on the browser-facing side becomes small:

1. Receive a compose-send WS frame from the frontend carrying a
   message-id and body text.
2. Check whether the target identity is currently dormant.
3. Drop a request file into that identity's inbox on the target box
   via the mechanism Shape 1 installed. If dormant, also drop the
   wake-sentinel using the same primitive that today's send-path uses.
4. Arm the round-trip watchdog with the active-send window or the
   dormant-send window, matching current logic.
5. Return. No blocking wait, no synchronous delivery return.

Delivery itself happens asynchronously in the ambient watcher on the
target box. The round-trip completes when the harness consumes the
paste and the transcript parser matches the user-turn append back to
the message-id in send-order — same mechanism as today. Failure
surfaces through the same timeout the watchdog uses today.

## Philosophy

This shape is the user-facing cutover. The property Shape 1 installed
(every pane-writer goes through the shared lock) is only true in
practice if every real pane-writer uses it. This shape is what makes
the composebox a real user of the substrate.

Deliberately keeping all the user-observable behavior identical to
today: bubble states, timings, failure signals. The user should not
notice a transport change under normal conditions. The only thing that
changes for the user is the elimination of a corruption class that has
been intermittent and hard to attribute until now.

Deliberately removing old code. Leaving a flag-gated fallback path
behind sounds safe but creates dead-code drift risk — the fallback
quietly rots as the primary evolves and if ever actually used would
surprise everyone. Shape 1's dwell window is the de-risk; this shape
commits to the new path.

Deliberately preserving the browser-side dormancy probe. The watchdog
window selection (active vs dormant) depends on dormancy status at
drop time; losing that check would mean dormant sends get the shorter
window and false-fail. The probe is cheap and this shape keeps it.

What would violate the spirit even if it passed a test:

- Keeping the old send-path alive behind any flag or branch, "just in
  case." The point is the cutover.
- Any observable UX change in the sending-bubble under normal
  conditions. The transport changed; the round-trip did not.
- Adding a synchronous ACK channel from the ambient watcher back to
  the browser-facing side. The whole architecture Shape 1 installed
  is async-by-design.
- Routing anything other than compose-send through the new path in
  this shape. The terminal-view live-keystroke path is deliberately
  untouched.

## Prior context

Shape 1 is production-live and has been exercised under manual drive.
The ambient watcher's fifth child is proven to handle: file arrival
on active identities, catch-up on startup for dormant identities, in-
order processing of multiple pending files, refused-delivery logging
and file discard.

The browser-facing compose-send handler today has three distinct
behavioral branches: non-dormant direct-send, dormant-send with
blocking marker-wait, and oversize-payload refuse. All three merge
back into a split-send pattern (body write, 1000ms delay, Enter write)
with mqid-tracked watchdog arming. Shape 2 collapses all of this into
a single branchless drop-file-and-arm-watchdog path.

The watchdog module (`pv-send-watchdog.ts`) today also owns three
escalations: T+2500ms retry-Enter, T+5500ms full-resend, T+GIVE_UP
emit paste_send_failed. The dormant variant pushes retry-Enter and
full-resend out past the marker-wait window. All three escalations
exist to compensate for typed-key send-keys being lossy under the
harness's render loop; bracketed-paste through the ambient watcher
does not have that property, so the first two escalations are
redundant and should be dropped. Only the final give-up-emission
timeout remains meaningful.

## What would make it wrong

- The sending-bubble UX observably changes for users under normal
  conditions. The whole cutover is supposed to be invisible to them.
- A compose-send message under worst-case interleaving with watcher
  events corrupts a turn. Shape 1 closed the collision class; Shape
  2 must actually use the closed path.
- A compose-send to a dormant identity falls through the cracks. The
  wake-sentinel drop + inbox drop combination must result in reliable
  catch-up delivery.
- The old send-path code remains in the tree in any form — commented
  out, flagged, or behind a dead branch. Scope is "removed, not
  deprecated."
- The dormant-vs-active watchdog window selection is lost. Dormant
  sends with the short window will false-fail; the probe must stay.
- Any new user-visible state ("waking", "pending") is introduced
  "while we're there." Deferred category.

## Scope edges

**In**:
- Compose-send WS handler in the browser-facing side (claude-session
  server) rewritten to drop a request file + wake-sentinel + arm
  watchdog + return.
- Request-file dropping mechanism — SSH write of the request file
  into the target identity's inbox on the target box.
- Dormancy probe retained for watchdog window selection.
- Old send-path code (split-send dance, dormancy marker-wait block,
  retry-Enter escalation, full-resend escalation) removed.
- Tests covering: active-send file-drop path, dormant-send file-drop
  + wake-sentinel path, watchdog window selection unchanged, old-path
  code no longer present, transcript-echo round-trip still works
  end-to-end under the new transport.
- Fleet-wide deploy: this touches the app backend, so docker build +
  docker-compose up on t1000. Gated on explicit greenlight per the
  standing directive.

**Out**:
- The terminal-view live-keystroke path. Separate codepath, untouched.
- The watchdog window values themselves (active-send 20s, dormant-send
  120s). Those stay as-is.
- Watcher-event delivery. That path is untouched (Shape 1 added
  alongside it, not into it).
- Any new frontend bubble state. Current states are sufficient.

**Tempting but no**:
- Repurposing the inbox substrate for terminal-view keystrokes too
  while we're here. Different mechanism (live stream vs discrete
  messages), different latency budget, different frame.
- Building out an eventually-consistent delivery-status surface in the
  app. If the dwell window from Shape 1 proved we need faster
  failure visibility than the timeout gives, the open question in the
  campaign artifact resolves that separately.

## Vehicle notes

**Inline** (per the campaign's shape-session convention). The identity
holding this work will have the campaign artifact, Shape 1's shape
file, and this shape file in context from load. Shape 1's actual
implementation details will inform exact drop semantics; this file
captures only what Shape 2 commits to.

Related files the implementing side will touch:
- `src/backend/claude-session/claude-session-server.ts` — the
  compose-send handler.
- `src/backend/claude-session/pv-send-watchdog.ts` — drop the two
  mid-flight escalations; keep the give-up emission.
- Tests under `src/backend/claude-session/` that cover compose-send,
  dormancy, and watchdog arming.

Deploy sequence: `git pull --rebase` + full test suite + `docker
compose build` + `docker compose up --force-recreate skynet` + log
tail. Gated on explicit greenlight per the standing directive.

`/close composebox-cutover` closes the arc at the end.
