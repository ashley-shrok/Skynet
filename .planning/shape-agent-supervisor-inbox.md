# Shape: agent-supervisor gains an inbox-based message delivery substrate

**Opened:** 2026-10-02
**Vehicle:** inline
**Campaign:** composebox-via-agent-supervisor (artifact at
`.planning/campaign-composebox-via-agent-supervisor.md`)

## What this is

The agent-supervisor's ambient watcher — the process that already runs
alongside every live agent and serializes watcher-event injections into
the agent's terminal pane — gains a new ability: receiving message
requests from the local filesystem and delivering them into the pane
through the same discipline it uses for watcher events today.

A per-identity inbox folder lives inside each identity's folder on the
box. Anything that wants to deliver a message to that identity drops a
small file into that inbox. The ambient watcher's new fifth child
subprocess watches the inbox for file arrivals, surfaces the file
contents up to the parent process's paste path, and the parent pastes
through its existing shared lock. The watcher-event path and the
inbox-message path share one lock, one paste discipline, and one failure
log stream.

Only the agent-supervisor side changes in this shape. The composebox
backend continues to deliver messages the way it does today, writing
directly to the terminal pane over SSH. Nothing in this shape affects
real user traffic. The point of shipping this shape alone is that the
delivery substrate becomes exercisable in production under manual drive
— drop a file by hand, watch it land in the pane — before any user
traffic is routed onto it.

## Shape

Four moving parts, in the order a dropped request crosses them:

1. **Per-identity inbox** — a subfolder named `inbox` inside the
   identity's folder on the box. Created on-demand by the dropper if
   absent (part of the dropper contract — see below). Request filenames
   are a compact UTC timestamp with millisecond precision, a dash, a
   short random hex suffix, and a `.msg` extension — so lexical sort of
   the filenames equals arrival order, modulo arbitrary-but-stable
   tiebreak among same-millisecond drops. File body is the raw message
   bytes, verbatim — no wrapping, no encoding, no escaping.

2. **Fifth ambient-watcher child subprocess** — follows the same
   subprocess pattern as the existing four children (relay receiver,
   wake-up scheduler, context-pressure watch, role/identity-file watch).
   Watches the inbox via inotify. On file arrival, if the filename
   matches the final shape (timestamp + hex + `.msg`), surfaces the
   file's filesystem path up through the parent's wake-emission channel.
   Files whose names do NOT match the final shape — including mid-write
   temp files, operator notes, stray artifacts — are ignored. This
   filter is what makes the write-and-rename contract load-bearing. The
   fifth child does NOT read the file bytes itself and does NOT delete
   the file; both belong to the parent (see next point) so the raw bytes
   never need to travel through the line-oriented child-to-parent IPC
   channel.

3. **Parent-side read + paste + delete** — the parent reads the file
   bytes directly off disk by the path the fifth child surfaced, grabs
   the shared lock, pastes bare text (no envelope — this is user
   speech, not a watcher event, so the "not from the user" envelope
   semantics do not apply), does separate Enter with retries matching
   the existing paste discipline, and removes the file from the inbox
   folder regardless of paste outcome (success or refusal). The parent
   owns delete because it is the one that knows the paste outcome, and
   because a parent crash between surface and paste then leaves the
   file in the inbox for the next startup's catch-up sweep to pick up.

4. **Agent-supervisor dormant-wake path** — the supervisor's existing
   periodic reconcile tick (30-second default) gains a fourth wake kind
   alongside its existing three (matrix peek, schedule peek, sentinel
   delete). On every tick, for each identity whose harness is NOT running
   (per the same liveness check the existing hot path uses), the
   supervisor additionally checks whether the identity's inbox folder
   contains any files. If so, it triggers the wake through the same
   mechanism its existing sentinel-driven wakes use — brings the harness
   and a fresh instance of the ambient watcher up. The fresh watcher's
   startup catch-up sweep sees the pending files in the inbox and
   processes them in sort order, after the existing startup delay.

The dropper's responsibility ends at writing the file. The dropper does
not know, and does not have to know, whether the recipient agent is
alive or dormant. Everything from the file onward — detection, wake if
needed, catch-up, paste — belongs to the agent-supervisor and its
children.

Refused deliveries (harness gone mid-flight, pane at a shell prompt
rather than a Claude harness, tmux write failed, file body is zero
bytes) are logged loudly on the ambient watcher's existing stderr
diagnostic surface with enough context (identity, filename, refuse
reason) to be useful during the manual-drive exercise window, and the
request file is discarded. No retry, no dead-letter folder. This posture
is specifically a Shape-1 stance; see Scope edges.

## Dropper contract

The public interface this shape exposes to anything that ever drops a
message into an identity's inbox. This shape, Shape 2's browser-facing
composebox send-path, and any future dropper all follow it the same way.

The contract is six conceptual steps, really three if the pedantry
collapses:

1. **Build the payload** — the raw message bytes. For Shape 1 that is
   literally the message text with no wrapping. Zero-byte payloads are
   refused + discarded by the watcher; do not drop them.

2. **Compute the final filename** — current UTC time formatted as a
   compact ISO-style timestamp with millisecond precision
   (`YYYYMMDDTHHMMSSmmm`), then a dash, then a short random hex suffix
   (8 characters, 32 bits of entropy), then the `.msg` extension.

3. **Ensure the recipient's inbox folder exists** — create it on demand
   if absent (`mkdir -p` on the inbox path inside the recipient's
   identity folder). The folder is not pre-provisioned; dropper owns
   creation.

4. **Write the payload to a temp name** inside the inbox folder — any
   name that does NOT match the final filename shape. Simplest
   convention: the final filename plus a `.tmp` suffix. The temp file
   may be partially-written at this point; the watcher's name-filter
   ignores it.

5. **Atomically rename the temp file to the final filename.** The
   rename is the moment the file becomes visible to the watcher (and to
   the supervisor's reconciler in the dormant case).

6. **Done.** No sentinel drop, no wake probe, no liveness check, no
   response wait. The dropper walks away.

### Randomness mechanism — mandatory

The 8-hex-char suffix MUST be sourced from a real random source — a
kernel CSPRNG, a language secrets module, or equivalent. An LLM
generating hex characters by eyeball does NOT satisfy this requirement
and is explicitly forbidden; LLM-eyeball "random" is biased and
collision-prone.

The canonical shell one-liner (works on every Linux box in the fleet,
no install needed) is `openssl rand -hex 4`. Programmatic droppers use
their runtime's native CSPRNG (Python's secrets module, Node's crypto
module, equivalent). Fallbacks if openssl is unavailable:
`head -c 4 /dev/urandom | xxd -p` or
`python3 -c 'import secrets; print(secrets.token_hex(4))'`.

### Concrete worked example

An agent wants to send the message "ping" to the identity named `stacy`
at 02 October 2026, 14:30:22.123 UTC:

```
ts=$(date -u +%Y%m%dT%H%M%S%3N)              # 20261002T143022123
hex=$(openssl rand -hex 4)                   # e.g. a7f3b2c1
name="${ts}-${hex}.msg"                      # 20261002T143022123-a7f3b2c1.msg
mkdir -p ~/fleet/identities/stacy/inbox
printf 'ping' > ~/fleet/identities/stacy/inbox/${name}.tmp
mv ~/fleet/identities/stacy/inbox/${name}.tmp ~/fleet/identities/stacy/inbox/${name}
```

A human operator during the manual-drive exercise window can skip the
timestamp+hex ceremony entirely and type any name ending in `.msg`
(provided they do the write-to-`.tmp`-then-`mv` dance so the watcher
only sees complete files).

## Philosophy

This shape is the uniform-lock property moved into reality. The ambient
watcher is already the single serializer for every event source inside
its own process; this shape makes it the single serializer for inbound
message delivery too. All future pane-writers to the identity's terminal
MUST go through this watcher process — that is the invariant the shape
installs, and the fifth-child pattern is how it is enforced.

The dropper's contract is deliberately set-it-and-forget-it. The dropper
does not probe liveness, does not drop wake sentinels, does not retry on
failure, does not wait for acknowledgement. One atomic write-and-rename
is the entire interaction. This is what lets the browser-facing
composebox code become structurally simple in Shape 2 (no dormancy
branching on the client side at all) and what lets peer agents, cron
jobs, and manual-drive operators all deliver messages through the exact
same primitive.

The raw-bytes body is deliberately as simple as a message carrier can
be. There is only one piece of data in a message (the text), so JSON
wrapping would add ceremony with no benefit and a new parse-failure
surface. If a future shape ever genuinely needs structured bodies, it
comes in via a NEW filename extension (`.json` or whatever), and the
watcher's filter rule gains a second accepted extension. The extension
IS the schema handle.

Deliberately keeping the existing four-children subprocess pattern.
Threading the inotify handler directly into the parent would be fewer
lines of code, but it would break the uniformity of the pattern. If we
ever change how children surface events to the parent, we want to make
one change that applies to all five, not four and a special case.

Deliberately not changing the browser-facing side in this shape. The
whole point of shipping this slice alone is that the delivery substrate
is exercisable in isolation. Nobody's user traffic is routed through
this on day one. Operators drop files manually, verify the mechanism
works end-to-end — including under dormancy, including under worst-case
interleaving with watcher events, including under refused-delivery
conditions — before Shape 2 commits.

Deliberately not building a response channel back to anyone who drops
a request file. The inbox is write-and-forget on the dropper's side.
Failure visibility lives in the ambient watcher's stderr log. The
dropper, if it needs correlation, uses the filename it generated as
its own correlation handle — the filename is unique by construction and
already encodes a sent-timestamp. Shape 2 will arm its own round-trip
watchdog using the already-existing transcript-echo mechanism; this
shape does not need to anticipate that.

What would violate the spirit even if it passed a test:

- Any pane-writer added anywhere that bypasses the ambient watcher's
  lock — re-opening the collision hole.
- A response/ACK channel built into this shape "just in case Shape 2
  needs it." If Shape 2 proves it does, add it then; adding it
  prematurely couples the substrate to a specific consumer.
- A dropper that requires knowledge of recipient liveness. The whole
  point of the amended dormancy story is that the dropper has one
  responsibility (write the file) and the supervisor handles everything
  else.
- Envelope-wrapping the pasted text in a watcher-event-style envelope.
  Inbox messages come from an actual user; the watcher-event envelope
  carries "not from the user" semantics.
- Wrapping the message body in JSON (or any other structure) when the
  content is a single piece of data. The body carries exactly what gets
  pasted.

## Prior context

The ambient watcher is a Python script distributed by the fleet
substrate to every box that hosts identities. It launches four children,
each a subprocess that writes events into stdout; the parent pumps those
events through a module-level lock and bracketed-paste delivery into the
target identity's tmux pane. The parent's own code contains a comment
that honestly names the hole this campaign closes: "two writers, one
pane, no shared lock — our lock serializes us against ourselves only."

The parent's startup delay (5 seconds, environment-overridable) is a
narrowing of the current race — it moves the watcher's first paste past
the moment Skynet's dormant-send path releases its own paste. The delay
is NOT a closure of the race; it narrows the window. The delay's whole
rationale evaporates in Shape 2, once the browser-facing side moves
onto the inbox path and there is no second writer to the pane anymore.

The wake-sentinel mechanism — a sentinel file dropped in the identity's
folder, picked up by the agent-supervisor's reconciler, triggering a
harness resume — already exists and is idempotent under concurrent
drops. The supervisor already walks every identity folder on each
reconcile tick for various sentinel scans (archive, un-archive, pin,
no-dormancy, recycle, and more). The reconcile cadence is 30 seconds by
default. The supervisor already has a liveness-check function (used
on the hot path) that answers "is this identity's harness currently
running." The inbox-wake path is additive: one more check per identity
per tick, reusing the existing liveness function and the existing
wake machinery. No new liveness probe, no new reconciler pattern.

Worst-case latency for a dormant-agent inbox message to land in the
terminal, so the number is on record for Shape 2 UX discussions: up to
30 seconds (reconcile cadence) plus harness boot time (a few seconds)
plus the ambient watcher's 5-second startup delay plus sub-second paste
— roughly 35 to 40 seconds total. Inside the existing dormant-send
watchdog window (120 seconds) with slack. Shape 2 may want to revisit
the reconcile cadence or the startup delay to tighten this; not
deciding here.

## What would make it wrong

- A request file arrives, the identity is active, and the fifth child
  does not pick it up. inotify-watch delivery is load-bearing; any
  edge case where a file sits unprocessed is a shape-level failure.
- A request file arrives for a dormant identity, the supervisor's
  reconciler does NOT notice it, and the identity sits dormant with
  the file waiting. Supervisor-side detection is load-bearing for the
  set-it-and-forget-it contract; silent inattention voids the contract.
- A request file arrives for a dormant identity, the wake happens, the
  fresh ambient watcher starts, but the pending file is not caught up.
  Catch-up-on-startup is the whole dormancy story.
- A refused delivery results in the request file sitting silently in
  the inbox. Refused deliveries must log loudly and discard the file.
- Multiple request files arriving close together are processed out of
  order. Sort order comes from the timestamp-prefixed filename; the
  fifth child must honor that order.
- The ambient watcher's own four-children behavior changes in any
  observable way as a side effect. The fifth child is additive; it
  does not perturb the existing four.
- A request file written by a mid-write dropper (half the bytes
  flushed, half not) is processed as if complete. The dropper must
  write-and-rename, and the fifth child must only process files whose
  name matches the final shape.
- A dropper that works correctly against a live recipient but fails or
  requires extra ceremony against a dormant recipient. The contract is
  identical in both cases; a divergence here means the dropper's
  responsibility bled into territory the supervisor owns.
- An LLM-dropper that generates "random" hex characters by eyeballing
  them rather than invoking a real CSPRNG. The randomness-mechanism
  rule is a hard requirement; LLM-biased "random" produces collisions
  and skewed distributions.

## Scope edges

**In**:
- Ambient watcher Python script gains the fifth child subprocess.
- Per-identity inbox folder is created on-demand by the dropper when
  absent (part of the write-and-rename contract).
- Request-file naming convention: compact UTC timestamp with
  millisecond precision + dash + 8 random hex chars + `.msg`, with a
  write-and-rename discipline so partial writes are never picked up.
- File body is raw bytes, verbatim — no JSON wrapping, no encoding.
- Zero-byte files are refused and discarded (same code path as other
  refused deliveries).
- Agent-supervisor reconciler gains a fourth dormant-wake kind:
  identity's harness is not running AND identity's inbox folder is
  non-empty. Triggers wake through the existing wake machinery, reusing
  the existing liveness check. Operates on the existing 30-second
  reconcile tick; no new timer.
- Refused-delivery logging on the ambient watcher's existing stderr
  surface, with enough context (identity, filename, refuse reason) to
  be useful during the dwell-window exercise.
- Substrate distribution so the updated ambient watcher and the updated
  agent-supervisor land on every box that hosts identities.
- Tests covering: inotify pickup of a dropped file, order preservation
  under multiple files, catch-up-on-startup of files already in the
  inbox when the watcher launches, refused-delivery stderr log plus
  file discard (including zero-byte case and name-shape-mismatch case),
  supervisor's reconciler waking a dormant identity whose inbox has
  files, five-children startup wiring unchanged in its existing
  four-children behavior.
- Documentation for the manual-drive exercise path (which commands to
  run, which log stream to tail, which folder to inspect) so the
  dwell-window exercise is reproducible by anyone.

**Out**:
- Any change to the browser-facing compose-send handler. That is
  Shape 2.
- Any change to the composebox frontend. That is Shape 2 (if at all).
- Any change to the four existing children's internal behavior.
- Any change to the parent's shared lock or paste discipline. The
  fifth child reuses them unchanged.
- A dead-letter folder for refused deliveries. Deferred to future
  shapes if the dwell window surfaces a need for forensic retention.
- A response channel back to the dropper. Shape 2 may need one;
  resolve then if so.
- Any change to the ambient watcher's 5-second startup delay. Shape 2
  may revisit (the delay's rationale evaporates once the browser-facing
  direct-send path is gone), but Shape 1 inherits the delay unchanged.
- Any change to the supervisor's 30-second reconcile cadence. Shape 2
  may revisit if dormant-agent delivery latency surfaces as a UX
  problem under real user traffic.

**Deferred to Shape 2 or later**:
- Routing real user traffic through the inbox.
- Removal of old browser-facing send-path code.
- Revisiting refused-delivery semantics for real user traffic. The
  Shape 1 posture of discard-plus-loud-stderr is correct for
  manual-drive-exercise under operator attention, and NOT a cemented
  long-run answer for the browser-facing composebox-send case where
  a user has typed a message and expects it not to vanish. Shape 2
  decides whether to add retry, a dead-letter folder, user-visible
  send-failure feedback, or some combination.
- Revisiting the ambient-watcher startup delay now that no second
  writer to the pane exists.
- Revisiting the supervisor reconcile cadence if the ~35-second
  worst-case dormant-delivery latency surfaces as a UX problem.

**Tempting but no**:
- Threading the inotify handler into the parent process directly.
  Breaks the four-children pattern.
- Adding structured JSON log output to the fifth child specifically.
  Match the existing stderr pattern for now; divergence can come later
  if needed.
- Wrapping message bodies in JSON for forward-compat. The filename
  extension is the schema handle if structure is ever genuinely needed;
  pre-emptive JSON wrapping adds ceremony with no benefit for Shape 1
  and risks cementing a schema the actual Shape 2 does not want.
- Requiring the dropper to probe liveness or drop a wake sentinel. The
  whole dormancy story is that the dropper does not need to care; the
  supervisor handles it.

## Vehicle notes

**Inline** (per the campaign's shape-session convention — one shape per
session, inline execution). The identity holding this work
(hyperion-box-maintainer) has the campaign artifact and this shape file
in context from load, and the session's work is bounded by the shape's
scope edges above.

Pieces of work will be tracked via harness tasks as execution proceeds.
Design ambiguities surface for mid-flight discussion with the user.

Related files the implementing side will touch:
- The ambient watcher script under `substrate/scripts/ambient-monitor.py`
  (the fifth child's spec and its subprocess entry point).
- The agent-supervisor script under `substrate/scripts/agent-supervisor.sh`
  (the fourth dormant-wake kind: inbox-has-files + harness-down).
- Substrate distributor catalog if the new child's entry point needs
  declaring (likely not, since it ships inside the existing ambient
  watcher's distribution).
- Tests under the substrate's own test surface, matching whatever
  shape the existing four children's tests take.

Because this touches the ambient watcher and the agent-supervisor
(both substrate-distributed to every box) AND the distributor catalog
(which tells the distributor what substrate files to push), the deploy
sequence IS a full docker-compose cycle after all: catalog.ts changes
are only picked up by the running Skynet backend after `docker compose
build` + `docker compose up --force-recreate`. The distributor's next
sweep after that cycle pushes the new ambient-monitor + agent-supervisor
+ inbox-watcher.py to every managed box. Deploy is gated on explicit
greenlight per the standing directive.

`/close agent-supervisor-inbox` closes the arc at the end.
