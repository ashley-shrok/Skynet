# Shape: Multi-tenant fleet-status orchestrator — each logged-in user watches their own machines

**Opened:** 2026-09-23
**Vehicle:** inline

## What this is

Skynet has a background service that keeps an eye on every managed machine — polling for identity presence, session activity, and installed apps — and streams what it sees into every logged-in user's sidebar in real time. Today that service runs from a single vantage point: whoever logs into Skynet first "sets" it, and from that moment on it only watches the machines that first user has access to. Everyone else who logs in gets whatever falls out of that user's vantage, and their own machines go unwatched.

This shape gives each logged-in user their own private vantage. When a user connects, Skynet starts watching their machines from their own perspective and streams the results to their sidebar only. When they disconnect, that vantage retires. Two users logged in at once = two vantages running in parallel, each private to its own user. Ten users, 100 users, same shape.

## Shape

Take the current single-vantage watcher — the whole setup that today runs once at server boot — and wrap the entire thing into a factory that produces one instance per logged-in user. Track instances by user identity: the first browser tab a user opens spawns their instance; the last tab they close retires it. Multiple tabs from the same user share one instance.

Each instance opens its own connections to the machines that user has access to, runs its own polling loop, and publishes what it sees scoped to that user. Nothing is shared across instances at the failure-path level — one user's watcher hitting a connection problem, timeout, or credential failure has no effect on any other user's watcher.

The per-frame access check that already sits on the outbound path stays exactly where it is. Today that check is what separates users on a shared broadcast; in the new world it becomes belt-and-suspenders — the watcher only ever produces frames for machines its user has access to, so the check never has anything to strip out, but if any future change accidentally crosses wires between users, the check catches the leak instead of letting it slip silently onto someone else's sidebar.

## Philosophy

This is deliberately a replication, not a rewrite. The current watcher works well for a single user; the fix is to give every user their own copy of that working thing, not to make one instance smarter about serving many users. Keep what works, run more of it.

Preserving current behavior is the point. Lifecycle timing (when a watcher starts, when it stops), what defines "the user's set of machines" (whichever machines they have access to today, whether owned directly or accessed via sharing), the polling cadence, the shape of the frames produced — all inherit from the current single-vantage watcher, applied per user.

Failure isolation is load-bearing. Each user's watcher runs independently — its own connections, its own error handling, its own retry cadence. No shared error path, no global circuit breaker, no fleet-wide throttle that could let one user's flakiness affect another's. This must survive future cleanup impulses.

## Prior context

The current watcher was built as a single instance because the app grew up serving one user. As soon as a second and third user were added, the shared-vantage model started papering over gaps — mostly invisibly, because the same set of machines was in play for everyone and every user piggybacked on the first user's vantage. Nobody noticed because the picture happened to be right.

The failure became visible when a new app appeared on the second user's machine and only the first user's sidebar showed the tile for it. That's because apps flow through the shared watcher; identities and sessions reach users through separate paths that already work per-user, and those paths were quietly compensating for the shared watcher's blindness. The invisible half of the problem has been hidden all along — the visible half is just apps.

The imminent 100-user deployment (each user with their own personal machine) makes the pattern fatal: those users' machines would never be watched at all, because whichever user connected first would "win" the single vantage and everyone else's stuff would fall off. Apps would be the visible break; identities and sessions would keep working through their non-watcher paths, hiding how broken the underlying picture is.

## What would make it wrong

- **Any shared failure path across users.** If one user's connection problem, credential issue, or network hiccup delays or breaks another user's watcher, the isolation guarantee has been violated.
- **Cross-user frame leakage.** If a frame produced by one user's watcher reaches a subscriber belonging to a different user, the per-user scoping has failed. The existing outbound access check is the last line of defense; the watcher itself must not produce frames destined for another user in the first place.
- **Silent regression on the visible symptom.** If after this ships, the second user still can't see the app tile on their own machine despite being logged in and having the machine on their access list, the fix hasn't landed.
- **Lifecycle leaks.** Watchers that don't retire when their user disconnects, or watchers that get orphaned across a server restart, waste connections and mask real failures behind stale state.
- **Behavior change on paths that currently work.** Anything a user can see on their sidebar today must still be there after this ships — the fix is additive for users beyond the first, not a rebuild of what the first user already sees.

## Scope edges

**In:**
- Per-user watcher instances, one per logged-in user, tracked by user identity and lifecycle-scoped to that user's active tabs.
- Per-user machine-connection lifecycle (open on the user's first subscription, close on their last).
- Failure isolation across per-user watchers, named as a load-bearing property.
- Verification after deploy that the visible symptom is fixed for the second user, without regressing anything the first user currently sees.
- Tests covering per-user lifecycle and isolation between users.

**Out:**
- Any change to the frontend. Each browser session already subscribes per-user; the fix is entirely on the server side.
- Any change to the per-frame outbound access check. It stays as belt-and-suspenders.
- Any change to the non-watcher paths that today deliver identity and session data to users. Those work; leave alone.
- Any change to the downstream fork consumed by the sister deployment. It picks up the change on the next pull; that deployment is single-user so behavior is identical for it.
- Feature-flagged rollout. Hard cut on deploy — today's behavior is broken for anyone-but-first, so there's no working state to protect.
- Pre-deploy 100-user load test. The mechanism is linear-per-user; correctness is what we're testing, not throughput.

**Tempting-but-no:**
- Consolidating identity and session data onto the watcher-only path, retiring the non-watcher paths that currently deliver that data. Tempting because "one canonical source" — out because those paths work and touching them is separate risk.
- De-duplicating machine-connections when two users have their own separate accounts pointing at the same physical box. Tempting for efficiency at scale — out because the user framing ("keep what works, replicate it") explicitly accepts this duplication cost, and going after it would violate the preserve-current-behavior spirit.
- Refactoring the now-redundant access check into a cleaner form. Out because the check stays as-is.

## Vehicle notes

Chosen: **inline**, tracked with harness tasks along the way.

Considered a GSD phase for blast-radius reasons — this subsystem is what every user sees on their sidebar and a mid-refactor break would take down real-time visibility fleet-wide — but the code shape is genuinely a replication of the current well-understood single-user path, not exploratory work. User greenlit inline with a "I believe in you" framing.

Executor discipline the agent owns manually (not delegated to a GSD executor):
- Careful commits — each meaningful chunk (factory extraction, subscriber tracking, tests) lands as its own commit so a mid-refactor break has a bisect-friendly history.
- Verify locally between chunks (typecheck, scoped tests on touched paths) before moving on.
- After deploy, tail server logs for warnings/errors — subsystems can fail silently even when health checks pass.
- Goal-backward check before ship: read the "What would make it wrong" section and confirm the built result doesn't do any of those things.

Not covered by GSD phase discipline this run: no automatic per-task atomic commits from a subagent executor, no plan-checker goal-backward pass, no plan-review from a peer AI. Fresh-eyes review still happens at `/close` (unbiased general-purpose subagent) plus a step-5 code review after `/close` per the `/build` pipeline.
