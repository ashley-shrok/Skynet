# Shape: server-side substrate bootstrap (system-owned credentials + startup-driven install pass)

**Opened:** 2026-09-05
**Vehicle:** one GSD phase (slotted into AI+ MVP sequencing)

## What this is

Skynet distributes a small set of background helper scripts (the "substrate") to hosts flagged to run them. Today, that distribution only happens when a person with those hosts assigned to them opens the app in a browser — the install pass is welded into the machinery that runs while a browser session is subscribed to live host status. Consequences: freshly-provisioned hosts owned by users who have never opened the app can't be bootstrapped; substrate updates rolled out in a Skynet deploy don't reach existing hosts until their owner logs in with live status open; and every host's credentials are locked to their individual owner's session, so the system itself has no way to log in on its own.

This work reshapes distribution to be system-driven: the install pass runs at Skynet startup and on new host add, retries unreachable hosts periodically, and the credentials for substrate hosts are held by the system so no person needs to be present.

## Shape

- On Skynet startup, the system itself walks every substrate host **serially** and runs the install pass against each. No browser required, no subscription required.
- On **new host add** (with the substrate flag on), the same install pass fires immediately for that one host as a fire-and-forget background job. The host-create response does not wait for it.
- Any host that fails during a pass (unreachable, credential problem, etc.) is not marked done and gets retried by the next opportunity. **Retry piggybacks on the existing 30-second host-list refresh cadence** — no new timer, and a host that comes back up gets picked up within about half a minute.
- After a host fails a **small number of consecutive times**, the system emits a **distinctive, loud, structured log line** marking it as needing operator attention. Retries continue in the background forever; the loud alert is what surfaces the persistent failure.
- The **browser-driven install-pass hook goes away**. It is redundant with the server-side path, and removing it simplifies the code and eliminates a whole class of "why hasn't this update rolled out yet" surprises tied to who happens to be logged in.
- For hosts flagged to run substrate, the SSH credentials are **locked with the system's own key** from the moment they are stored (at host create, on flag flip to on, on credential update). The install pass reads through the system's key. If the owner opens a browser terminal to that host, that also reads through the system's key. **One representation, one place the credential lives.**
- Non-substrate hosts keep the per-person lock exactly as today. Nothing about their credential handling changes.
- A **one-shot migration** ships with this work: an operator-run script, provided with the necessary key material for every existing substrate-host owner on the instance, that walks each existing substrate host, unwraps using the appropriate person's key, re-wraps with the system's key, and updates the record. Retired after the ship is complete. Feasible today because both live instances have small, known user populations and the operator has all the credentials.

## Philosophy

The install pass is a **system-scheduled thing, not a person-triggered thing**. Nobody being logged in should be irrelevant to whether the system's own management of its hosts happens.

This work deliberately relaxes the "credentials are locked so the system itself cannot read them without a person" property, but only for the specific class of credentials where that property is already at odds with what the system needs to do (unattended install passes). The stronger property stays intact for every other credential in the system. This is the **standard backend-secrets pattern** applied narrowly, not a broad security-posture change — most apps do exactly this, most of the time, for everything. Skynet does it deliberately for one class of credentials.

Spirit-of-it violations, even if a test passes:
- Any code path where the install pass is gated on a browser session or a subscription.
- Adding a per-user opt-in step for the install pass — the substrate flag is already the opt-in signal; nothing else is needed.
- Storing the system's copy of a substrate credential alongside a separate "owner also has a copy" — one representation is the point.
- A retry loop that quietly gives up on hard-failing hosts without surfacing them.
- Relaxing the per-person credential lock for hosts that are NOT substrate hosts.
- Leaving the browser-driven install-pass hook in place "just in case."

## Prior context

Today the install pass fires inside the machinery that only exists during a live browser subscription to host status. When the last subscriber leaves, the machinery shuts down entirely. When someone opens the app, it restarts fresh and re-runs the pass for their hosts, once per subscription lifetime, idempotently. Container restart clears everything and it re-fires on next subscription.

For a given person's hosts, the sweep only runs when THAT person is subscribed, because the credentials that decrypt to log in are locked to their session. An admin session can see other users' hosts in the list but cannot do anything with them — the credential will not unlock for anyone but the owner.

The per-item idempotence in the current distribution pass is preserved and load-bearing here — each item in the catalog independently checks whether it is up to date on the host and only writes if it isn't. That's why the shape needs no per-host "already bootstrapped" marker; the distributor's per-item check answers that question naturally.

Substrate cannot change without a Skynet container restart, because the bundle is baked into the container image. That means the container restart is the natural sync point for updates, and periodic mid-uptime sweeps would have nothing to do.

The system-managed key infrastructure that this work extends already exists and is in production use for a narrow case (one person handing a credential to another). This work extends that existing capability, not builds a new one from scratch.

This work is **blocking Stacy's exec-onboarding runbook on the T800 (Aither AI+) box** — the moment where the runbook waits for the freshly-provisioned host to be picked up by the install pass hangs forever today, because the just-created user has never opened the app in a browser.

## What would make it wrong

- If a freshly-provisioned host still requires someone to open the app in a browser before it gets its substrate installed, this has missed the point.
- If a substrate update ships in a deploy and existing hosts do not pick it up until their owners happen to log in, this has missed the point.
- If a host that was briefly unreachable at startup never gets a second chance until someone logs in, this has missed the point.
- If a dead-forever host (bad credential, decommissioned, DNS gone) fails silently in a way an operator cannot distinguish from a live host, this has missed the point.
- If the change ships forward-only and existing substrate hosts stay stuck in the old model until manually re-created, this has missed the point.
- If the strengthened security posture (per-person credential lock) is relaxed for hosts that are NOT substrate hosts, this has missed the point — the relaxation is deliberately scoped.
- If the browser-driven install-pass hook stays around after this work, this has missed the point — its removal is part of the shape.
- If the initial startup pass fires all hosts in parallel and spikes SSH load, this has missed the point — serial was the deliberate choice.

## Scope edges

**In:**
- System-side install pass, running at Skynet startup, walking every substrate host serially.
- Immediate install pass on new substrate host add (fire-and-forget from the host-create path).
- Retry loop for hosts that fail the pass, piggybacking on the existing 30-second host-list refresh cadence.
- Loud, structured alerting for hosts that fail repeatedly (after a small number of consecutive failures).
- Removal of the browser-driven install-pass hook.
- System-key credential wrap for substrate hosts, applied at host create, on the substrate-flag flip to on, and on credential update.
- One-shot operator-run migration script for existing substrate hosts on both live instances.
- Test coverage for the above (in-process where the codebase supports it, unit tests for the crypto swap and migration, integration coverage for the startup pass and the on-add trigger).

**Out:**
- Any change to non-substrate host credential handling.
- Any change to the per-item idempotence contracts in the substrate catalog.
- Any change to the substrate catalog composition itself (still an independent piece of work — feature 02 territory).
- Periodic mid-uptime sweeps for substrate updates (unnecessary because substrate cannot change without a container restart).

**Deferred:**
- Substrate-flag-toggle-off (going from substrate to non-substrate on an existing host). Rare in practice. Left un-handled for now: the credential stays system-key-wrapped, the install pass just stops running for that host. If a case emerges where we want to unwind that, address it then.
- Extension of the same model to future classes of hosts that might benefit from system-owned credentials — this work is scoped to the substrate case only.

**Tempting but not:**
- Making every host's credentials system-key-wrapped and dropping the per-person lock entirely. That is a fleet-wide security-posture change, not what is being asked.
- Adding a UI affordance for triggering the install pass manually. If the automatic triggers are right, a manual button is a smell. Only add if operators are actually reaching for one.
- Recording a full history of past install-pass runs in the DB. Structured logs at lifecycle boundaries are enough.
- Parallelizing the initial startup pass. Not worth the coordination cost at current substrate size and host counts; revisit only if the serial pass becomes a real user-visible startup delay.

## Vehicle notes

**One GSD phase.** The work has real surface (crypto swap + a new orchestrator lifecycle + a host-create hook + a retry loop + a one-shot migration + tests), it is coherent (all pieces of the same reshape), and it slots into the AI+ MVP sequencing because it unblocks feature 07's onboarding runbook Moment 7.

**Files the planner should read before planning:**
- The current fleet-substrate install-pass code and its once-per-instance gating (fleet-status orchestrator).
- The current per-user credential wrap infrastructure and the existing system-managed key infrastructure.
- The host-create endpoint (where the on-add trigger hooks in).
- The AI+ MVP feature-07 doc (for the Moment 7 requirement this unblocks).
- The Stacy DM thread on the Skynet-side relay account (for her diagnostic context that seeded the work).

**Migration is a real deliverable in this phase, not a follow-up.** Ship the code and the migration script in the same phase so that on deploy, the migration runs and every existing substrate host is transitioned in one motion.

**Coordination with Stacy after ship.** Because the T800 instance mirrors this instance, once this ships and the migration runs on this instance, the code needs to flow to Stacy's fork-consumer via her normal pull-and-build path, and she needs a briefing on running the migration on her side with her instance's user credentials. Post-ship, follows the standing Stacy-briefing convention in the role file.

**Identity doing the work.** tabitha (this identity), holding the box-maintainer role, working in the tabitha working tree on the shared feat/tab-title-from-tmux branch. Same coordination rules apply (`git pull --rebase` before push, container-mutation coord-room announces, orchestrator-only deploys, etc.).
