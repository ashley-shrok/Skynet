# Shape: Rebuild the "is-this-agent-working" affordance on top of harness lifecycle hooks

**Opened:** 2026-08-30
**Vehicle:** GSD phase (recommended — `/build` will re-confirm and route on next-session pick-up)

## What this is

The conversation-list affordance that tells Ashley "this agent is currently working, don't interrupt" (equivalently: the absence of that affordance means "ready for your next instruction, safe to click") is unreliable today. On agents that are heavily active — long turns, lots of tool use, always-on — it stays lit even when the agent is idle. The affordance's whole job is to steer where Ashley clicks next; while it lies, it can't do that job. This work retires the current guessing-based mechanism entirely and rebuilds it on a direct signal from the harness itself.

## Shape

The current mechanism infers whether an agent is working by combining two indirect signals: a state label the harness writes to its own status file, and a per-tick observation of what command owns the terminal pane. Both of those oscillate multiple times inside a single normal turn, so a heuristic gate was layered on top to smooth them. The gate false-positives on any agent whose lifecycle naturally cycles through those states — which is every real agent in production use. That is the bug.

The replacement stops inferring and instead asks the harness to tell us directly. The harness already fires named lifecycle notifications at every meaningful moment — turn beginning, tool call beginning, turn ending, error ending a turn, permission decision needed, and many others. We install a very small subset of those as hooks on each managed box. Each installed hook does one thing: touch a well-known marker file. There are two such marker files per running agent session — an "activity" marker and a "stopped" marker.

The lifecycle moments that touch the activity marker are the ones that mean real work is starting: Ashley submitted a prompt, or the agent began invoking a tool. The lifecycle moments that touch the stopped marker are the ones that mean the affordance should NOT be lit: turn finished cleanly, turn ended in an error, agent is blocked waiting on Ashley for a permission decision. That last one is a deliberate design choice — from the affordance's perspective, "agent is waiting on you" is the same as "agent is done": both mean the row deserves Ashley's attention right now.

The backend predicate that decides whether to show the affordance collapses to a single comparison: is the activity marker's modification time more recent than the stopped marker's? If yes, the agent is working (affordance lit). If no, the agent is not (affordance off). No state machine, no smoothing, no oscillation to fight.

The old guessing-based machinery — the state-label enum, the pane-command polling for this purpose, the heuristic gate, the derived transition timestamp that fed it — comes out entirely.

## Philosophy

The mechanism should NOT try to be clever about lifecycle. Don't paper over noisy signals with heuristics; instead, subscribe to authoritative signals and read them directly. Where the harness has already done the work of knowing when something is happening, we consume that; we don't re-derive it from side-channels.

The affordance's only job is to answer one question: "should Ashley look at this row?" Every design choice serves that question. That's why waiting-on-permission is treated the same as done — from the answering-the-question perspective they are the same. That's why long-running tool execution counts as working — the row isn't calling for Ashley's attention during it. That's why we're willing to accept a small cosmetic wart in the rare permission-approval window — the wart doesn't lie about the question the affordance is answering, it just briefly under-reports on an already-rare code path.

What would violate the spirit: reintroducing heuristics to "smooth" the two markers, or adding a second inference layer alongside the direct signal to "catch cases the hooks miss." If a case is missed, that means we picked the wrong set of hooks; the fix is to change which hooks we subscribe to, not to layer a second guessing mechanism.

## Prior context

The affordance was originally driven by a status enum the harness writes to a per-session state file, plus per-tick polling of the pane's current-command. Those together were supposed to indicate work-in-progress. A patch shipped 2026-08-26 added a "shell-idle gate" heuristic to try to distinguish "in a genuinely new tool call" from "stale state after a turn ended" — the gate compared a derived status-transition timestamp against the last stop-hook mtime. The gate fixed some cases but false-positives on any agent whose state naturally oscillates during work. The current session (2026-08-30) verified this empirically on Nelly (in-harness, actively working, always-on, four ambient monitors): her state cycles busy ↔ shell across every turn, and each cycle back into shell resets the transition timestamp to now, keeping the "just entered shell after last stop" condition perpetually true.

Also relevant: a stop-hook installer already exists on each managed box, added by an earlier phase for the stop-side of the current predicate. The new work extends that installer to add several more hook events but reuses the same install infrastructure and settings-merge shape. And a related earlier patch closed a cross-identity leak in a different signal (the background-tasks list) that also feeds the affordance — that fix is orthogonal to this work and stays as-is.

Ashley reported the Nelly false-positive symptom during UAT and asked whether a Start-hook + Stop-hook direct-signal approach would collapse the whole problem. The design was worked out together across the session, including confirming with the harness documentation exactly which lifecycle hooks fire for turn-start, turn-start-via-tool, turn-end, error, and permission-pending — and confirming the documented ordering of pre-tool and permission events.

## What would make it wrong

- The affordance lies in the OTHER direction — false-idle instead of false-working. An agent is actively mid-turn and the affordance says "ready for your instruction." Ashley clicks into it and interrupts real work. Worse failure than today's bug, and the whole approach would have missed the point.
- The lifecycle signals we chose miss an important trigger of real work — e.g. async wakes from monitor events don't produce any of our activity hooks, so an agent woken by another agent's DM looks idle even while responding. If this happens, the fix is to expand the hook set, not to layer inference back in.
- The predicate re-introduces state or smoothing across the two marker files. The point is one comparison; anything more is the shape of the old bug creeping back.
- The migration breaks agents whose managed box hasn't been updated yet — those show permanently-idle (or permanently-working) because the backend expects markers that aren't being touched. Rollout has to consider "what does the affordance show on an unupgraded box" as a real design question, not a footnote.
- The rare-permission-flow wart is worse than described. If real permission approvals routinely last long enough for Ashley to notice the affordance is missing during the approve → tool-completes window, the accepted-wart assumption breaks and we need to revisit.

## Scope edges

**In:**
- Extending the existing hook installer to add the four new hook events (turn-start via user prompt, turn-start via tool, turn-end error, permission-pending). The existing stop hook stays.
- New backend predicate reading the two marker files' modification times.
- Removing the current status-enum decision logic, the derived transition timestamp, the shell-idle gate, and any pane-command polling that only exists to feed the WIP predicate.
- Per-identity rollout order — start with the reproducer (Nelly on thenasty) to confirm before propagating.

**Out:**
- The dormant-sentinel mechanism (identity folder sentinel file) — unrelated axis, stays as-is.
- The background-tasks list mechanism and its ambient-tag filtering — separate signal, unrelated to WIP-vs-idle, stays as-is.
- Pane-command polling for OTHER purposes than WIP (if any exist) — only the WIP-purpose polling is retired.

**Deferred:**
- Closing the accepted cosmetic wart in the permission-approve window. Only revisit if operational experience shows the wart matters.
- Any hook additions beyond the five agreed lifecycle events. If we find gaps (e.g. async wakes silently work with no hook firing), we add hooks then — not preemptively.

**Tempting but no:**
- Adding a "smoothing" layer over the two markers to "avoid flicker." The oscillation the current mechanism has doesn't recur here — the markers only move in the direction they're meant to. Any smoothing would be re-inventing the current gate.
- Migrating boxes automatically as a side-effect of the deploy. Install has to be an explicit act per identity so we control rollout.

## Vehicle notes

GSD phase is the right shape. The work spans a hook installer change, a backend predicate rewrite, deletion of a chunk of existing machinery, tests across two subsystems, and a per-identity migration story with real "what if the target box isn't upgraded yet" thinking. That's not one-shot inline work and it's not `/gsd:quick`-sized; it warrants the discuss + plan + execute + verify phases.

The next session picks this back up by re-invoking `/build` pointing at this shape file. `/build` will confirm the vehicle, then route into the GSD phase pipeline — seed a `/gsd:discuss-phase` from this file (per the build skill's guidance to not re-elicit what `/open` already captured), plan, execute, verify.

Nothing else in the pipeline needs to know about the design work that happened in this session — it's all here. The reset in between is deliberate: fresh context for the phase-planning work, this file carries the agreement across.

---

## Close-Out

**Closed:** 2026-08-30
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · affordance rebuilt on harness lifecycle hooks — activity-hook + stopped-hook touch per-session marker files, backend reads mtimes
- **Shape** — present · 5 lifecycle events wired (UserPromptSubmit + PreToolUse → activity marker; Stop + StopFailure + PermissionRequest → stopped marker); single-comparison predicate activityMtime > stoppedMtime on upgraded boxes
- **Philosophy** — present · direct-signal branch is grounded on marker mtimes alone; no smoothing between the two markers; bg dropped from the upgraded-box composition; PermissionRequest deliberately treated as stopped per the affordance's one-question framing
- **Prior context** — present · existing installer extended to add new hooks with reused install infrastructure and settings-merge shape; background-tasks-list ambient-tag filtering left orthogonally intact
- **What would make it wrong: false-idle lie** — present · predicate is true when activityMtime > stoppedMtime; only-activity yields true; only-stopped yields false; equal collapses to false — no path introduces a false-idle across a real activity event
- **What would make it wrong: missed lifecycle trigger** — present · the two hooks are wired to the five agreed lifecycle events verbatim; failure would only arise from harness-side hook coverage, which the shape defers as an add-hooks-not-inference fix
- **What would make it wrong: predicate re-introduces state/smoothing across the two markers** — present · the direct-signal branch is a single strict > comparison with no smoothing layer between the two markers; the retained Phase 59 fallback is a completely separate branch that only fires when both new markers are absent — endorsed as bounded change-of-mind, not a smoothing layer over the two markers
- **What would make it wrong: migration breaks unupgraded boxes** — present · explicitly handled — sessions on unupgraded boxes fall through to the retained Phase 59 predicate byte-for-byte, so no permanent-idle / permanent-working failure mode on boxes pending re-install
- **What would make it wrong: rare-permission-flow wart is worse than described** — cannot-verify · operational observation gate — cannot be settled by reading the material; deferred by the shape until rollout evidence
- **Scope edges: In — installer extended for four new hook events, existing stop hook stays** — present · installer merges six settings.json hook entries (existing Stop plus the four new events plus stopped-hook also on Stop)
- **Scope edges: In — new backend predicate reading two marker files' mtimes** — present · orchestrator reads activity + stopped marker mtimes per PID per tick with fail-open cache preservation; frontend consumes the two mtimes and computes the predicate
- **Scope edges: In — remove status-enum decision logic, derived transition timestamp, shell-idle gate, WIP-purpose pane-command polling** — drifted · endorsed intended change of mind — the shell-idle gate and derived transition timestamp are retained as a per-session fallback ONLY on unupgraded boxes; pane-command polling for the WIP purpose is not present; retention is bounded by the follow-up bounty recorded below
- **Scope edges: In — per-identity rollout order starts with Nelly on thenasty** — present · documented in phase SUMMARY as the first identity to prove the fix; the rollout itself is downstream of the reviewed material per the review instructions
- **Scope edges: Out — dormant sentinel mechanism stays as-is** — present · dormant axis untouched; ambient-filter.ts and dormant reads remain orthogonal
- **Scope edges: Out — background-tasks list mechanism stays as-is** — present · backgroundTasks[] stays on the wire; bg dropped only from the upgraded-box direct-signal composition; ambient filter unchanged
- **Scope edges: Out — pane-command polling for other purposes** — present · only tmux name resolution remains, which is identity resolution not WIP inference
- **Scope edges: Deferred — permission-approve cosmetic wart** — present · not addressed in this arc as agreed
- **Scope edges: Deferred — hook additions beyond the five agreed events** — present · hook set is exactly the five agreed events
- **Scope edges: Tempting but no — smoothing layer over the two markers** — present · no smoothing layer between the two markers exists; the strict > comparison is the whole direct-signal predicate
- **Scope edges: Tempting but no — automatic migration as deploy side-effect** — present · install remains an explicit per-identity operational act, not a deploy hook

### Additions (in the result, not in the shape)

- Two-branch predicate structure with a per-session fallback to the retained Phase 59 shell-idle-gate predicate on managed boxes where both new marker mtimes are null (Option-1 rollout) — endorsed-as-drift

### Follow-ups

- Retire the Phase 59 shell-idle-gate fallback branch (backend derivation of lastStatusChangeAt, lastStopAt per-session Stop-file mtime read, and the frontend fallback branch itself) once per-identity rollout of the new hooks is confirmed complete across every managed box. Currently un-tracked in ROADMAP/phase/bounty artifacts; Ashley to open as a bounty after /close returns. — bounty

### Notes

The shape's "comes out entirely" language for the old machinery was overridden during planning by the shape's own rollout-is-a-real-design-question requirement — Option 1 (retain as per-session fallback bounded by a follow-up phase) was chosen because Option 2 (default-on) and Option 3 (distinct unknown-state affordance) each had worse failure modes not authorized by the shape. The intent behind "comes out entirely" (no perpetual coexistence) is preserved by the follow-up commitment now recorded here. Worth carrying forward as a pattern: when a shape's removal language collides with its own rollout-safety failure mode, capture the bounded retention and the retirement follow-up in the same close-out.
