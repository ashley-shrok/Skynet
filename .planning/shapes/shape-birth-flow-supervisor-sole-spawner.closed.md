# Shape: birth-flow rework — supervisor becomes sole spawner

**Opened:** 2026-09-11
**Vehicle:** GSD phase

## What this is

When a new identity is born on a target box today, two parties do overlapping work. The main app writes the identity's files to disk on that box — its folder, its identity file, its avatar, its blank workspace, its blank handoff — and mints the identity's Matrix relay account. Then, on the same request, it also opens a terminal session on the box, launches the agent process inside it, and pilots it through the first-run keystrokes that get it fully alive. The always-running supervisor on that box does exactly the same second half of the job any time it notices a new identity on disk that has no session yet. Chunk 3 retires the duplicate: the main app stops doing the second half. It just writes to disk and mints the relay account, then stops. The supervisor picks up the identity from disk on its next scan tick and brings it alive — the way it already does for every other identity that gets there any other way.

Because the app can no longer report on the launch beats (they're happening in a different party's timeline now), the modal that ran the birth also changes shape: the five-tick progress checklist goes away, replaced by a single undifferentiated spinner. And because we don't want the user to be left staring at a sidebar wondering when their new agent will show up, the modal waits until the agent is actually alive on the box before closing, then routes the user straight into that agent's chat surface.

## Shape

**The birth flow, end to end after the change:**

1. User fills in the new-identity form (name, host, role, task, admin-only working directory) and hits create.
2. The Create button's label becomes a spinner. All form fields go disabled. The modal's close affordance is disabled — the user is fully locked in until this resolves one way or the other.
3. The app does its remaining work on the target box, over the network: checks the name isn't already in use, writes the identity's folder tree and files, writes the avatar sibling file (or leaves the identity pointing at the role's avatar when the user didn't pick one), and mints the Matrix relay account. All of this is fast — seconds.
4. The app then waits, polling the target box, for a signal that the supervisor has picked the identity up and the agent process has finished its own first-run boot. The signal is: a session transcript file for the new identity exists on the box's filesystem, with the identity's own load command as its first entry. This is the same shape of signal the app already uses elsewhere to distinguish a live agent session from a bare shell, so we're reusing an existing sensor rather than inventing coordination.
5. On success: the modal closes, and the user lands directly in the new agent's chat surface, ready to talk to it.
6. On failure of the supervisor-pickup wait (the transcript file never appears within a generous window — think a couple of minutes to be safely past a supervisor cycle plus normal agent boot time): the app logs the problem, leaves the on-disk identity + relay account exactly where they are, closes the modal, and pops the browser's blocking alert saying "agent creation failed."
7. On failure of any of the earlier app-side work (the disk write broke, the Matrix mint broke): same failure surface as above — same alert, no distinction between "the app broke" and "the box didn't respond." One generic surface.

**What lives where after the change:**

- The app's job on a birth request: check the name, write the files, mint the account, wait for the transcript signal, close the modal + route (success) or log + alert (failure).
- The supervisor's job on every box: unchanged — it was already watching disk and bringing new identities alive; it just becomes the sole party doing so.
- The agent itself on the box, once launched by the supervisor: unchanged — it reads its role, its handoff, its task, spins up its ambient monitors, and prints its introduction.

## Philosophy

**One party owns tmux + agent lifecycle on every box: the supervisor.** The current setup has the app also opening tmux and launching agents from across the network. That means two parties can race on the same identity — the supervisor might notice it on disk while the app is still finishing its own keystroke train, and the two can end up fighting over the same session. Retiring the app's copy of the work means there's only ever one party responsible for tmux + agent process lifecycle on any given box. The app writes the identity's existence to disk and stops.

**Same completion criterion the user cares about, honored by a different means.** Users don't care whether the app or the supervisor spun up the tmux session — they care that when the "creating" spinner goes away, the agent is actually alive and they can talk to it. The old flow honored that by having the app do the launch itself. The new flow honors it by having the app wait for the supervisor's work to visibly complete on disk before closing the modal. The end-state guarantee is the same; the mechanism is different.

**Simplify the failure surface where the user has nothing to act on.** The old modal's per-step failure blurbs told the user how to attach the box's tmux session and finish the birth by hand. Those instructions were useful when the app was the party doing the launch — the user could pick up where the app dropped it. Under the new shape the app isn't doing the launch, so it can't hand the user meaningful "attach and continue from step 3" instructions. Rather than construct a fake per-step failure surface with no real per-step meaning, the modal admits it: one generic "agent creation failed" alert, and the log is where the actual diagnosis lives.

**Don't rollback partial state on the box.** The supervisor may already be dealing with the identity's on-disk presence at any moment. Deleting the folder + Matrix account on a timeout would risk stepping on work the supervisor is actively doing — same reason today's code carries a hard no-rollback rule. So the leave-partial-state policy stays: on timeout, the identity is on disk, might still get picked up shortly after by the supervisor, and shows up in the sidebar behind the user's back. The alert is honest that the app gave up waiting; the log is the trail if the eventual appearance needs to be investigated.

## Prior context

**What was already shipped before this chunk.** The rework broke into four chunks after the user's onboarding rehearsal on the downstream deployment surfaced three related bugs. Chunks 1 and 2 already landed:

- Chunk 1 retired the supervisor's legacy behavior of only handling a static list of identities baked in at start time. Its single behavior now is: walk the identities folder on disk every reconcile tick, act on any new identity found. This is what makes the sole-spawner arrangement possible — the supervisor now reliably notices any identity Skynet writes to disk.
- Chunk 2 fixed a related workdir-path bug in the app's birth flow where an empty user-supplied path fell through to a stale default. That fix is still-correct-for-now but becomes moot after Chunk 3 lands, since the app no longer uses the path field for its own tmux launch (only the supervisor uses it, and the supervisor already had its own fallback).

Chunk 4 as originally scoped — per-step visible checkmarks + error toast — dissolves under this shape, since there are no per-step ticks anymore. The birth-flow rework arc becomes 3 chunks, not 4.

**What the current birth flow looks like from the operator's perspective.** The user hits create; a five-item checklist appears; each item ticks green sequentially over ten or twenty seconds, or one of them fails with a text blurb telling the user how to SSH into the box and finish by hand. On success, the modal closes and the identity appears in the sidebar — but the user has to notice it, click into it, and wait for the agent to actually be ready. There's an awkward gap between "modal closed successfully" and "I can actually talk to this thing."

**What the new flow looks like from the same perspective.** The user hits create; the button label turns into a spinner; nothing else visible happens for maybe fifteen seconds; then the modal closes and the user is looking at the new agent's chat surface, ready to type. Or, in the rare failure case, the spinner runs for a couple of minutes and then the modal closes with a blocking alert saying it failed — and the user knows to check what happened, maybe try a different name.

**How the app's shell-only mode is affected.** The same modal has a second branch, admin-only, where the operator checks "shell only," fills in a working directory, and gets a bare terminal session on the box with no identity attached. That branch does not birth an identity, does not touch the supervisor, and does not need any wait. It stays exactly as it is today — this whole shape only applies to the identity-birth branch of the modal.

**How retries interact with the leave-partial-state policy.** If the user gets the failure alert and immediately tries again with the same name, the app's name-collision check will see the failed attempt's on-disk identity and refuse the name as already in use. This is existing collision behavior; no new machinery is added for it. The user picks a different name or waits to see whether the original one comes alive on its own.

## What would make it wrong

- **If the modal closes on the app's own completion, not on the agent being alive.** The whole point of the wait is that the user doesn't get dumped back into the sidebar with a still-booting agent they can't type to. Closing before the transcript signal exists on the box misses the point — even if the eventual state is fine, the intermediate state is worse UX than what we have today.

- **If the modal ever ends up with the create button spinning forever with no timeout.** The wait must have a bound. Users must not be able to end up watching a spinner indefinitely because a supervisor crashed on the box or the transcript file schema changed underfoot. If the wait can hang, the shape has missed the point.

- **If the auto-route lands the user somewhere other than the new agent's chat surface.** "Route into the frontend session for that agent" means the same surface the user would reach by clicking the identity's row in the sidebar after it appears. Anywhere else — a raw terminal view, a different tab, the sidebar itself — misses the point.

- **If the app tries to clean up the partial state on timeout.** The whole no-rollback rationale is that the supervisor might be actively working on the identity at that moment. Deleting on timeout re-introduces exactly the race the existing rule was written to prevent. Silence, log, alert, leave it — cleanup is not the app's call to make.

- **If the failure alert distinguishes "we broke" vs "the box didn't respond."** Same alert regardless, deliberately. The point of the generic surface is that the user's next action is the same in both cases (check the log, decide what to do), so exposing a distinction gains nothing and complicates the UX.

- **If the launch mechanism drifts back into the app "just for edge cases."** The whole point of the sole-spawner arrangement is that there is one party responsible for tmux + agent lifecycle on any box. Any conditional in the app that says "well, in this case we'll also launch" reintroduces the race the retirement was meant to end.

- **If the transcript-file signal is checked by inventing a new detection pattern.** The existing detection pattern for "this is a live agent session, not a bare shell" is what to reuse. Building a second, slightly-different sensor that then drifts from the first would silently miss real completions or fire on things that aren't real completions.

- **If shell-only mode gets swept into this and starts waiting for a transcript file that will never exist.** Shell-only doesn't birth an identity; there IS no transcript file to wait for. Applying the wait to shell-only would leave the modal spinning forever on every shell-only create.

## Scope edges

**In scope for Chunk 3:**

- The app's identity-birth request stops opening tmux and launching the agent on the target box. It writes files, mints the relay account, waits for the supervisor's transcript signal, and either routes the user into the agent's chat surface (success) or logs + alerts (failure).
- The birth-progress wire contract collapses accordingly — no more per-step events for launch beats that don't happen anymore.
- The frontend modal loses its five-item progress checklist. The Create button's label becomes a spinner during the wait. Fields disabled. Close disabled. Timeout fires the blocking alert. Success closes the modal and routes into the new agent's chat surface.
- Backend and frontend tests for the birth flow update to match — the ones that today count five step events, the ones that assert per-step failure surfacing, the ones that mock the launch helper.

**Out of scope for Chunk 3:**

- The other places the launch helper is used from — the identity-clone flow still calls it, unchanged. This chunk only stops the birth path from using it; the helper itself stays in the module.
- The supervisor's own behavior. It's already doing exactly what we need it to do (Chunk 1 was the change that got it there); nothing supervisor-side changes in this chunk.
- The shell-only branch of the same modal — unchanged in every respect.
- Any downstream deployment coordination (pull-through to the downstream box's fork). That happens after all remaining chunks in the arc land, as one coherent pull, per the user's earlier direction.

**Tempting but no:**

- Deleting the launch helper entirely because "we can always inline it if clone needs it again." No — clone still uses it, deleting it is a coordinated change with clone that's not part of this chunk.
- Sneaking the workdir-field cleanup into this chunk. The field remains needed for the shell-only branch (that's its actual reason for being visible to admins); removing it would break that flow. Its role in the identity branch becomes vestigial but harmless; leave it.
- Adding a "retry" button on the failure alert. The alert is generic and blocking; the user picks their own next action. A retry button implies we know what to retry and how, which — under the "we don't know if the failure was ours or the box's" model — we deliberately don't.
- Making the timeout adjustable per host or per role. One conservative fixed timeout is enough.

**Deferred (not this chunk, may or may not ever be):**

- Any improvement to the failure log's diagnostic value. The log exists; making it richer or exposing it to the operator through some UI is a separate concern.
- Any coordination between multiple in-flight births of the same name from different tabs. Existing collision handling covers the on-disk case; multiple simultaneous submits are a UX corner not addressed here.

## Vehicle notes

**Why GSD phase.** This is a coordinated multi-file change spanning the backend orchestrator (retire two step blocks, rework the wire contract, add the wait-for-transcript logic), the frontend modal (drop the checklist component, spinner-in-button, auto-route on success, timeout alert on failure), and the tests that pin down both. The wait-for-transcript logic in particular is genuinely new behavior that wants a planning pass — how the poll is shaped, how the timeout is enforced, how it composes with the existing SSH connection lifecycle. Phase-shaped work per the standing fleet directive; a single quick would be routing around ceremony that earns its place here.

**Handoff notes for the implementing identity.**

- Bounty for this arc: birth-flow-supervisor-sole-spawner, in the box-maintainer role's shared pool. It carries the arc's premise, the chunks-1-and-2 commit references, the todos, and any timeline entries from prior sessions.
- Related bounty: newsessiondialog-ux-per-step-visible was the placeholder for the old Chunk 4. Under this shape it dissolves; mark it done or dropped when this chunk closes.
- Existing sensor for the "live agent session" signal: whatever code already distinguishes a Claude session from a bare shell by looking at the transcript file with the /id invocation as the first entry — reuse that shape rather than inventing a second sensor.
- Downstream coordination: the user will let the downstream deployment's maintainer know to pull the full birth-flow rework arc after this chunk lands, not incrementally. Do not DM the downstream maintainer mid-chunk; batch the pull notification for when the arc is complete.
- Container-mutation coordination applies as normal (the standing role rule) — coord-room announce before deploy, git pull --rebase past origin before push, full test-suite gate at ship time, orchestrator-not-executor does the actual deploy motion.

---

## Close-Out

**Closed:** 2026-09-11
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Skynet's birth request now only writes files and mints the relay account, then waits for the supervisor to bring the agent alive; modal closes and routes into the new agent's chat surface on success, or fires a generic browser alert on failure.
- **Shape step 1 — user submits form** — present · agent-mode branch enters the birth-handling path.
- **Shape step 2 — Create becomes spinner, all fields disabled, close disabled** — present · birthing state gates form-disabled; Create renders a spinner; Cancel disabled; dialog close no-ops while birthing.
- **Shape step 3 — app writes files + mints relay account only** — present · orchestrator retains only the collision probe, folder/file/avatar writes, and the admin-mint + relay.json write; harness bootstrap steps retired.
- **Shape step 4 — poll for transcript-file signal on the target box** — present · wait-poll runs every 2 seconds up to 120 seconds after the mint completes; success breaks out of the loop, timeout emits failure with a supervisor-wait-timeout reason plus a structured warn log.
- **Shape step 5 — success closes modal + auto-routes into agent's chat surface** — present · on success the modal refreshes the identity store then calls the create callback with identity-mode; the shell layer opens the tab (attach-not-create) and moves focus to it.
- **Shape step 6 — supervisor-wait failure surface: log + generic browser alert; on-disk state left alone** — present · timeout path logs, emits, and the frontend fires the browser alert; no filesystem or Matrix cleanup.
- **Shape step 7 — earlier app-side failures use the same generic alert** — present · both terminal-event failure and stream-throw branches call the identical alert literal; no distinction on the user surface.
- **What lives where** — present · app writes/mints/waits/closes; supervisor untouched; agent untouched.
- **Philosophy — one party owns tmux + agent lifecycle on every box** — present · zero references to the launch primitives anywhere in the birth orchestrator; no conditional "app also launches" branch.
- **Philosophy — same completion criterion honored by different means** — present · modal only closes after the on-disk transcript signal fires within the timeout.
- **Philosophy — simplify failure surface where the user has nothing to act on** — present · single generic alert replaces the previous per-step failure blurbs; backend structured log is the diagnosis surface.
- **Philosophy — no rollback of partial state on the box** — present · timeout and step-failure paths carry no-rollback comments; no remove/unlink anywhere in those branches.
- **Prior context — helper still used by clone; clone flow untouched** — present · the launch helper module still exports its function; the clone route is byte-identical to the phase's starting commit and still imports + invokes it.
- **Prior context — Chunk 4 (per-step visible checkmarks) dissolves** — present · the previous per-step checklist scaffolding is gone; only a spinner remains.
- **Shell-only branch untouched** — present · shell-only takes the else branch and calls onCreate synchronously with identity-mode false; the birth-handling path is never entered so no wait-for-transcript can apply.
- **What would make it wrong: modal closes on Skynet's own completion, not agent-alive** — present · success emit is downstream of the wait-poll break; modal only closes after the transcript signal appears.
- **What would make it wrong: spinner runs forever with no timeout** — present · 120-second hard ceiling; while loop terminates and emits failure on timeout; SSE keepalive keeps the wire warm through proxy idle-timeouts so the frontend actually receives the terminal event.
- **What would make it wrong: auto-route lands elsewhere** — present · the create callback sends the user into the same chat surface a sidebar click would; the shell handler is byte-untouched from the phase's starting commit.
- **What would make it wrong: app cleans up partial state on timeout** — present · timeout branch contains only log-warn + emit; no filesystem or Matrix side-effects.
- **What would make it wrong: failure alert distinguishes failure class** — present · both failure branches call the identical literal alert; the reason string on the wire is log-forensic only and the frontend explicitly ignores it.
- **What would make it wrong: launch mechanism drifts back into app** — present · zero references to the launch primitives in the orchestrator; no conditional fallback path.
- **What would make it wrong: new detection pattern invented for transcript signal** — present · wait-poll uses the shared existing helper — the same one the fleet-status and dormant-derivation paths rely on.
- **What would make it wrong: shell-only swept into wait-for-transcript** — present · shell-only branch never invokes the birth-handling path; wait-poll code path is unreachable in that branch.
- **Scope edges — helper preserved for clone; workdir field left in place; no retry button; single fixed timeout** — present · helper module retained; admin-only Path field remains rendered; no retry button on the failure alert; timeout is a single fixed constant, not per-host or per-role.
- **Scope edges — no downstream deployment coordination this chunk** — present · no cross-repo pull or notification attempted; verification report explicitly defers this to the orchestrator after arc close.

### Additions (in the result, not in the shape)

- None.

### Follow-ups

- None.

### Notes

Two ancillary changes sit in the same shape family and are worth naming so future readers don't mistake them for scope creep: (a) the spawn-request queue worker got the discovery dep wired into its dep-injection object — a mechanical compile-fix consequence of widening the shared dep interface, labelled a Rule 3 auto-fix with zero behavior change in the phase's plan-01 summary; (b) an optional sanitized reason string is now carried on failure terminal events across every failure branch — log-forensic-only, the frontend explicitly ignores it and always shows the generic alert. Neither surfaces to the user; both keep the shape's actual commitments honest across every existing entry point into the birth path. Also: a 30-second SSE keepalive was added to both the birth route and the retry route — required plumbing because the up-to-120-second wait window would otherwise be killed by proxy default idle timeouts, defeating the shape's own timeout bound. Retry route was already present pre-Phase-106; only the keepalive + reason field are new on it.
