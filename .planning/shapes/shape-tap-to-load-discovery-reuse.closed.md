# Shape: kill the ~5-second wait when jumping into a conversation you weren't already in

**Opened:** 2026-08-23
**Vehicle:** gsd phase

## What this is

When Ashley taps a conversation that isn't already loaded, the pane sits with a loading overlay for about five seconds before her message bubbles appear. Under the hood, most of that wait is the box asking the target host a long series of small questions — one at a time, over the network — in order to figure out which conversation file to start reading from. Only after that whole investigation completes does the pane actually start streaming her bubbles.

The change: make that jump-in feel effectively instant when the answer is already known, and much faster than today when it isn't.

## Shape

There are two independent machines on the box today. The first is the always-on background poller that decides, for every identity in her fleet, whether it currently deserves a "ready for attention" dot in her conversation list. To make that decision, that poller is already asking the target host — every couple of seconds, forever — exactly the same series of questions the jump-in path re-asks from scratch. The second is the on-demand jump-in path: the moment she taps, it starts its own investigation from zero, ignoring everything the ready-dot poller has already learned.

The shape has three moves:

- **A shared, always-current answer.** The ready-dot poller is taught to leave its most recent finding — the resolved conversation file for each (host, identity) pair — in a spot on the box where the jump-in path can read it. That spot has no lifecycle of its own; it's just wherever the freshest answer lives.

- **Jump-in reads the shared answer first.** When she taps, the jump-in path checks the shared spot. If there's an answer there, it uses it immediately, skips the investigation, and jumps straight to streaming her bubbles. Nothing else changes in what she sees; the pane just loads on the order of a heartbeat instead of five seconds.

- **The fallback is fast too.** When the shared answer isn't there — first tap after a fresh backend, a conversation the ready-dot poller doesn't cover, whatever — the jump-in path falls through to a fresh investigation. That fresh investigation gets its own upgrade: all the small questions that today happen one-at-a-time over the network get rolled into a single question. Same information, one round-trip instead of ten-plus. Fresh investigation goes from ~4 seconds to ~400 milliseconds.

Every jump-in also leaves a log line naming which path it took (shared-answer hit, fresh-investigation, or full fallback) and how long the load-in actually took. So if it ever stops feeling fast again, the log answers "which part is slow" without any new instrumentation.

## Philosophy

**Two systems, one direction of coupling, opportunistic reuse.** The ready-dot machinery is unchanged. It doesn't know or care that the jump-in path is reading its output. The jump-in path reads if there's something to read, and does its own thing if not. If the ready-dot machinery ever stalled entirely, jump-in would silently degrade to fresh (still-batched) investigation — no user-facing failure.

**Speed over correctness-in-the-worst-case, because correctness recovers itself.** The shared answer can occasionally be stale — the target's conversation file rotated in the last couple of seconds and the ready-dot poller hasn't caught up. In that unlucky-timed tap, the jump-in path briefly starts on the wrong file. Downstream recovery already handles this on both sides (the ongoing repoll notices the mismatch and swaps files; the frontend detects a rotated file on the next metadata frame and resets). The user might see a brief flicker on the order of a couple seconds, then it's right. This is a fair trade for making the common case instant.

**No new "cache lifecycle" concept.** The shared answer is just whatever the ready-dot poller most recently wrote. No TTL, no eviction, no invalidation protocol. If it's there, use it; if not, fall through. The ready-dot poller already owns freshness.

**The polling side stays exactly as it is today.** Same rate, same coverage, same shape. No changes proposed to how often it runs or what it looks at. Only its output gets a new consumer.

## Prior context

Today, when Ashley taps a conversation she hasn't loaded yet, the box connects to the target and runs roughly ten small SSH questions in series: what process is running the pane, what does that process's own state record say, what conversation file does it point at, does that file exist. Each question is one network round-trip; total wall time is ~4 seconds. Only when that investigation completes does the pane's file-following start, and only when the first "attached" signal comes back does the loading overlay disappear.

Meanwhile, the ready-dot polling machinery has been walking that exact same investigation, for every identity in her fleet, every couple of seconds, since Phase 34. It has a very recent answer for every conversation the ready-dot cares about — but nothing else consults that answer.

The reason it works this way is historical, not by design. The two subsystems grew up at different times, for different reasons, and nobody noticed they were solving the same problem twice.

An instrumented tap earlier in this session (Ashley pressed a hotkey before and after a real jump-in) put a hard number on it: total load-in was 6.4 seconds; ~4 of those seconds were the serial investigation loop, the rest was network handshake and file-attach setup. The batching and the reuse are the two levers that shrink that number to near-zero (reuse) or ~500ms (batch).

## What would make it wrong

- **If jump-in ever waits on the ready-dot machinery to do work.** The whole shape is opportunistic read. If there's ever a code path where jump-in blocks pending a ready-dot tick, or actively pokes the ready-dot poller to hurry up, we've missed the point. Jump-in either finds an answer already there and uses it, or it does its own thing.

- **If tearing down or restarting the ready-dot polling breaks jump-in.** Jump-in must survive the shared answer being missing, empty, ancient, or unresponsive. If disabling the ready-dot polling for any reason (debugging, backend restart, some other subsystem) causes jump-in to slow down catastrophically or fail, the two systems are coupled tighter than the shape allows.

- **If it's fast for identity conversations but slower for anything else.** Bare host terminals — connections to hosts that aren't running an identity — have never gone through this discovery path and never will. But any change to shared plumbing that accidentally regresses their attach cost is a violation. The bar is "same or faster than today for every pane type."

- **If the log doesn't tell us why a slow tap was slow.** The point of the observability line is that Ashley (or a future maintainer) can look at the log after a "why did that feel slow?" moment and see path-taken + time. If the log line lands but doesn't distinguish the three paths, or omits the total time, it's not doing its job.

- **If the frontend needs to change to get the benefit.** The whole change is server-side. The frontend's jump-in behavior is unchanged; the metadata frame arrives faster, the file-following starts sooner, the loading overlay comes down sooner. No new frontend states, no new frames, no new configuration.

## Scope edges

**In:**
- Teach the ready-dot machinery to leave its resolved conversation-file answer somewhere the jump-in path can read.
- Teach the jump-in path to consult that spot before doing its own investigation.
- Roll the jump-in path's fresh-investigation questions into one remote script (single round-trip).
- Add a log line per jump-in naming path + duration.
- Test coverage that the shared-answer path is used when a fresh answer exists, that the fallback runs when it doesn't, and that a stale shared answer's downstream recovery still fires as expected.

**Out:**
- No changes to the ready-dot polling rate, coverage, or shape.
- No changes to the frontend jump-in behavior, wire schema, or overlay logic.
- No client-side persistent cache of message bubbles (a separately reasonable idea for a different day).
- No handling of the dormant-identity wake path (a different bottleneck; different fix).
- No changes to bare host terminal panes' attach path (they don't go through this).

**Deferred:**
- Making the ready-dot poll rate adjustable (out-of-scope; if we ever want fresher answers, that's a separate call).
- Any pre-warming ("on backend startup, immediately populate the shared answer for every active-set identity"). Nice-to-have but the fallback is already fast enough.

**Tempting-but-no:**
- Merging the ready-dot machinery and the jump-in machinery into one subsystem. They're distinct concerns with different lifecycle assumptions; keeping them independent is exactly what makes this change safe.
- Adding a max-age / TTL / freshness threshold on the shared answer. Simpler is "trust whatever's there, let downstream recovery correct." Bounded staleness is a hedge; the recovery already handles it.

## Vehicle notes

Vehicle: **GSD phase.** This is phase-sized — backend surface change, two subsystems reaching a shared spot, a new remote script for the batched fallback, tests, observability, ship-gate. Not one-file. Not one-shot. `/gsd:spec-phase` → discuss-phase → plan-phase → execute-phase.

**Seed discuss-phase from this shape file.** Per the `/build` skill's guidance: this shape file already captures the "why + what + constraints + scope edges" that discuss-phase would otherwise re-elicit. Either drop this in as CONTEXT.md directly, or generate CONTEXT.md from it. Don't re-do the discovery.

**Related open work to keep in mind during planning:**
- The frontend session-file rotation-reset (committed today as `3e0f7c54`) is downstream defense against a rare stale-cache read. That defense stays regardless — this shape doesn't replace it.
- The Phase 34 fleet-status backend is the "ready-dot machinery" referenced throughout — its polling code is the natural home for the writer side of the shared spot.
- The `startActiveSessionFlow` path in the Claude-session server is where the jump-in reader logic goes.

**Closing:** `/close tap-to-load-discovery-reuse` at the end.

---

## Close-Out

**Closed:** 2026-08-23
**Vehicle used:** GSD phase (55-tap-to-load-discovery-reuse-teach-claude-session-attach-to-c)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Cold jump-in on an unloaded conversation now consults a pre-resolved answer; when there isn't one, the fresh investigation is a single remote script instead of a chain.
- **Shape — shared always-current answer** — present · The ready-dot poller (source A of the ssh-poll-orchestrator) writes the resolved (host, identity) → session-file answer into a shared module-level Map after each successful poll; guarded so nothing writes when either key is unresolved; source B never writes.
- **Shape — jump-in reads the shared answer first** — present · Cache is consulted before any discovery call; on hit, the code jumps straight into the streaming setup (session metadata + tail) with the cached identifiers and returns.
- **Shape — fallback is fast too (single round-trip investigation)** — present · Cache-miss calls a new batched discovery that collapses the old serial chain into one main remote script plus one existence check; same failure taxonomy preserved.
- **Shape — one log line per jump-in naming path + duration** — present · Endorsed as drift: two named paths (shared-hit, batched-fresh) rather than the shape's imprecise three-name enumeration; each carries durationMs. Matches the real code branches.
- **Philosophy — two systems, one direction of coupling, opportunistic reuse** — present · Reader is a synchronous Map read returning null on absent; no awaits on the poller, no pokes, no cross-system messaging.
- **Philosophy — speed over correctness-in-the-worst-case; recovery already exists** — present · Discovery-repoll timer still fires inside the active-session flow after a cache-hit start; frontend rotation-reset unchanged and untouched.
- **Philosophy — no new cache lifecycle concept** — present · No TTL, no timers, no eviction, no invalidation protocol; last-writer-wins overwrite only.
- **Philosophy — polling side stays exactly as it is today** — present · Poller diff is additive: an import and one guarded write call; no changes to rate, coverage, or the SessionState it publishes.
- **Prior context — writer side lives in Phase 34 fleet-status polling code** — present · Write call is inside processPid in the ssh-poll-orchestrator (source A only).
- **Prior context — reader side lives in the Claude-session attach path** — present · Reader is in the connectToPane handler in claude-session-server, before any discovery call.
- **What would make it wrong: jump-in ever waits on the ready-dot machinery** — present · Cache read is synchronous; no await, no cross-subsystem signalling, no poll-hurry poke.
- **What would make it wrong: tearing down / restarting fleet-status breaks jump-in** — present · Cache read returns null on empty; the null branch falls straight into batched-fresh — no dependency on the poller being alive.
- **What would make it wrong: identity fast, other pane types slower** — present · No terminal / ssh-* / bare-host files touched by any phase-55 commit. Shared plumbing (SSH connection setup) unmodified.
- **What would make it wrong: log fails to tell us why a slow tap was slow** — present · Every attach emits exactly one path log with a distinguishing label and total elapsed ms; endorsed as drift on the number of labels being two rather than three.
- **What would make it wrong: frontend needs to change to get the benefit** — present · Zero src/ui files in any phase-55 commit; no new wire types, no new overlay states, no new frames.
- **Scope — in: teach poller to leave resolved answer for reader** — present · Done via new session-file-cache module + source-A write call.
- **Scope — in: reader consults shared spot before its own investigation** — present · Cache read is the first thing after the SSH connection is up.
- **Scope — in: rolled-up single-round-trip fresh investigation** — present · Batched discovery is one main script + one existence check, replacing the old chain.
- **Scope — in: per-attach observability log line (path + duration)** — present · Both branches emit the path log with durationMs.
- **Scope — in: test coverage for hit / miss / stale-recovery** — present · 10 cache unit tests, 6 orchestrator-write tests, 10 batched-discovery tests, 3 integration tests covering the wire-up and cache-miss fallthrough.
- **Scope — out: no changes to fleet-status polling rate/coverage/shape** — present · Poller diff is additive-only; the SessionState it publishes is unchanged.
- **Scope — out: no frontend changes** — present · No src/ui files touched.
- **Scope — out: no client-side persistent message-bubble cache** — present · None introduced; cache is server-side only, holds session-file identifiers, not bubbles.
- **Scope — out: dormant-identity wake path untouched** — present · Dormant-poll seam still calls the legacy serial discovery — batched is only used on cold attach.
- **Scope — out: bare-host terminal attach path untouched** — present · No terminal / ssh-* files in the phase-55 diff.
- **Tempting-but-no: merging the two subsystems** — present · Subsystems kept independent; coupling is one-directional through a shared Map.
- **Tempting-but-no: TTL / max-age / freshness threshold on the shared answer** — present · No TTL logic; a writtenAt timestamp is stamped but documented as observability-only and never consumed.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Shape language: "full fallback" as a third named path was imprecise — two paths (cache-hit, batched-fresh) is what the behaviour actually calls for. Worth carrying forward as a pattern note for future shapes. — accepted-as-drift

### Notes

Two minor surface details in the cache module are worth noting without flagging as additions: (a) the host-scoped clear function is exported and covered by tests but never called from production code — plausible future-use scaffolding; (b) the cache entry carries a `writtenAt` timestamp that is never read anywhere, documented in-module as "observability only, no TTL logic". Neither creates a lifecycle concept, neither couples the subsystems tighter — but if anyone later wants to hang staleness logic off `writtenAt`, that would be a shape violation and worth catching at review. The batched discovery script has a nice property worth remembering: it inlines the whole PID→JSONL derivation into one shell script with a single follow-up existence check, so the round-trip count is now dominated by that existence check rather than by the walk. A future "even faster" pass could fuse the two into one exec if the existence check moved inside the main script.
