# Shape: Stop self file edits from injecting events to the harness

**Opened:** 2026-09-27
**Vehicle:** inline

## What this is

The agent runs alongside a small background watcher whose job is to notice when certain load-bearing text files change on disk — the role file, the identity file, and any role-scope runbook files. Any time one of those files diverges from a saved copy the watcher keeps, the watcher fires a wake into the agent's session prompting it to re-read the change.

Today the watcher is deliberately blind to WHO changed the file. When the agent uses its own editing tools to update, say, its own identity file, the watcher notices the change and wakes the agent with the diff — even though the agent is the one who just wrote it. The agent has to look at the diff, recognize its own handwriting, and move on. Wasted turn.

This work makes the watcher stop firing events for changes the agent itself just made, while still firing normally for changes made by anyone else — peer identities of the same role, a human editing directly, another process on the box.

## Shape

The watcher already keeps a "saved copy" of each watched file in a well-known state directory. Its normal loop: notice the file changed → compare the file to the saved copy → if they differ, fire an event and refresh the saved copy.

Two moving pieces get added.

**A post-tool sync step.** Right after every agent tool call that could have touched disk, a small script runs. Its job: look inside the watcher's state directory, find each saved-copy file, derive which real file it corresponds to from the filename convention the watcher already uses, read that real file, and if it differs from the saved copy, overwrite the saved copy with the real content. Alongside the saved copy, it also writes a small marker file recording a fingerprint (hash) of exactly the content it just synced.

**A settle delay and hash guard in the watcher.** When the watcher is woken by the operating system's file-change notification, it pauses briefly before doing its comparison — long enough for the post-tool sync step to have finished if it was going to. Then at comparison time, it does a two-way check:

- Does the file's current content match the fingerprint the sync step just recorded? If yes: the sync step ran, the file is exactly what the agent just wrote, and nothing else has changed since — silent, no event, consume the fingerprint.
- If not: either the sync step didn't run (someone other than the agent made the change), or the content changed AGAIN after the sync ran (a peer edit landed during the settle window). Either way, real signal — fire the event as normal, refresh the saved copy, discard any stale fingerprint.

The result: the agent's own edits are absorbed silently at the source, but any change the agent didn't make still reaches the agent — including the concurrent case where a peer edit lands at almost exactly the same moment as an edit of the agent's own.

## Philosophy

Move the filtering to where the events are born, not where they're consumed. Today the watcher is dumb and the agent is expected to recognize its own echoes at read time. That's the failure mode we're removing — self-edit events cost the agent turns of attention for information it already has. Push the responsibility upstream, and free the agent from doing this bookkeeping in-context.

Keep the watcher SIMPLE at its center. The fundamental "compare current to saved, fire if different" loop stays exactly what it is. The two additions — a short settle pause, and a fingerprint check — are small, surgical, and aimed at this specific problem. No general-purpose "who edited this file?" machinery. No parsing of shell commands to guess what they'll write. No log of edits with process IDs and timestamps. The mechanism does its whole job through the state directory the watcher already keeps.

Zero configuration duplication. The list of watched files lives in ONE place — the watcher's state directory. The post-tool sync step discovers that list by reading the directory, not by carrying its own copy of the list. If the watcher ever expands (or contracts) which files it covers, the sync step adapts automatically.

Graceful degradation matters. If the post-tool script fails, is delayed past the settle window, or doesn't fire at all, the watcher's normal comparison finds a real diff and emits — exactly today's behavior. The optimization is a best-effort layer, not a hard dependency. It cannot make the watcher WORSE than today; it can only make it better.

## Prior context

The watcher was originally shipped with a documented invariant that self-edit filtering was the agent's job at read time. The id skill spells out three cases the agent should distinguish from a diff — own echo (ignore), peer's edit (adopt), user's edit (treat as a user directive) — and tells it to judge from content. That invariant existed because there was no clean way to identify the writer of a file at the kernel level without elevated privileges.

We verified that constraint still holds on this box. Every user-accessible mechanism for identifying the writer of a file requires root or an equivalent capability — the kernel's fine-grained file-notification interface, the audit subsystem, and the tracing subsystem all refuse unprivileged access. The watcher runs unprivileged; escalating it just for this would be substrate-wide scope creep.

So the fix happens at the agent-cooperation layer instead. Two things the box already provides make this practical: the harness's post-tool hook mechanism, which fires a script after every tool call the agent makes; and an environment variable the fleet supervisor already sets on the agent's process, naming the identity. That's enough for the post-tool script to find the right state directory without any additional configuration.

Runbook files are also watched (added mid-2026 after a canonical-command drift incident). The sync step covers them uniformly — the state directory holds one saved copy per runbook alongside the role and identity ones, and the sync loop iterates over everything it finds there.

## What would make it wrong

- **A peer edit gets silently absorbed.** If a change made by anyone other than the agent doesn't reach the agent, the mechanism has failed at its most load-bearing job. The whole point of the watcher is mid-session visibility of non-agent changes. The hash guard is what prevents this in the concurrent-edit case; if that turns out to leak, we've regressed the watcher's core value.
- **A self-edit still leaks a wake through.** Not a hard failure — the agent handles today's noise fine — but it means the mechanism isn't earning its complexity.
- **The saved copy gets corrupted.** Any content write to a saved-copy file has to be atomic (temp file + rename), same convention the watcher already uses. A partial write during a crash would leave the watcher comparing the real file against garbage.
- **The settle delay is tuned wrong.** Too short and self-edits leak through. Too long and legitimate events feel sluggish. The delay is exposed as a knob so it can be adjusted without redeploy.
- **Shell-command edits are handled differently from direct-editing-tool edits.** The whole point of doing the sync post-hoc is that it observes the state after the fact, uniformly across every tool that could have touched disk. Any asymmetry would be a design smell.

## Scope edges

**In:**
- The three watched surfaces the file-change watcher currently covers: role file, identity file, runbook files.
- The five tool call types that can produce file writes: the four direct file-editing tools plus shell commands. The post-tool script fires for all of them.
- Docs update to the id skill: the "your own echo" case in the agent-side reading protocol goes away, because it's now handled upstream instead of by the agent at read time.

**Out:**
- Any file the watcher is not currently watching. If the watcher grows to cover additional surfaces later, the mechanism generalizes automatically without changes here.
- Any tool that can't produce file changes (read-only tools, network tools, etc.).
- Any change made by a fully external process — a separate shell login, a git operation from another session, an editor started outside the harness. Those still fire events, which is what we want.

**Deferred:**
- Metrics or logging of how often the mechanism catches self-edits vs how often events still leak through. Useful for future tuning but not needed to ship.

**Tempting but no:**
- A general-purpose "who wrote this file?" surface. Would require root-level substrate additions and is disproportionate to the problem.
- Making the post-tool sync do more than sync — e.g., emitting proactive summaries of what the agent just did. The sync's job is silence, nothing more.

## Vehicle notes

Inline, tracked through harness tasks. The moving pieces:

- The file-change watcher script gains two small additions: a settle delay before its comparison, and a hash-guard check that validates whether the current content matches what the sync step recorded.
- A new small post-tool script lives in the substrate. It reads the identity name from an environment variable, walks the watcher's state directory, and for each saved-copy file reads the corresponding real file, atomically refreshes the saved copy if needed, and writes a fingerprint marker.
- The harness settings file gains one new hook entry on the post-tool boundary, firing on the five relevant tool call types.
- The fleet substrate distributor's catalog gains the new script so it propagates to every box that runs agent substrate.
- The id skill's docs get updated: the "your own echo" case in the agent-side reading protocol is removed, and the description of the file-change watch mentions that self-edits are now absorbed at the source.

The settle delay is exposed as an environment variable knob (default 200 milliseconds) so operators can tune without a redeploy.

Deploy is the distributor's normal propagation cycle — no container restart, no rollout dance. The new watcher and hook script are picked up on next agent session start.

---

## Close-Out

**Closed:** 2026-09-27
**Vehicle used:** inline
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · watcher stops firing on the agent's own edits while non-agent edits still reach the agent
- **Shape — post-tool sync step** — present · self-edit-baseline-sync.sh walks the state dir, derives real files from the watcher's filename convention (last-snapshot.role|.identity|.runbook.<slug>), atomically overwrites the baseline on drift, and writes a sha256 marker alongside
- **Shape — settle delay + hash guard** — present · SELF_EDIT_SETTLE_MS sleep before diff; _is_self_edit compares sha256(current) against marker; consumes marker regardless of match so stale can't linger
- **Philosophy — filtering at source** — present · core compare/fire loop unchanged; two surgical additions (sleep + hash check) only
- **Philosophy — zero configuration duplication** — present · sync script discovers watched surfaces by listing the state dir; no separate list
- **Philosophy — graceful degradation** — present · script always exits 0; every FS op best-effort; timeout 2 wrap; missing FLEET_IDENTITY / state dir → clean no-op; watcher's normal diff+emit unchanged in fallback
- **Prior context — post-tool hook + FLEET_IDENTITY env var** — present · hook wired via settings.json PostToolUse; FLEET_IDENTITY sourced from env
- **Prior context — runbook coverage** — present · sync-loop iterates last-snapshot.runbook.* uniformly; watcher's _handle_runbook_event + cold-start pass both call _is_self_edit
- **Failure mode — peer edit silently absorbed** — present · hash-guard covers the me-edit → peer-edit → my-sync-fires race; T-S6 test explicitly verifies mismatched marker still fires the event
- **Failure mode — self-edit still leaks** — present · T-S5 test verifies matching marker produces silent absorption
- **Failure mode — saved-copy corruption / atomic writes** — present · sync script uses .tmp.$$+mv for both baseline and marker; watcher's _atomic_write_baseline uses tmp+os.replace
- **Failure mode — settle-delay tuning knob** — present · ROLE_WATCH_SELF_EDIT_SETTLE_MS env, default 200ms, per the shape
- **Failure mode — shell edits treated same as tool edits** — present · PostToolUse matcher is Write|Edit|MultiEdit|NotebookEdit|Bash — all five uniformly
- **Scope In — three watched surfaces + five tool types** — present · role file, identity file, runbook.md files all handled; matcher covers the exact five
- **Scope In — id skill docs update** — present · 'your own echo' case removed from the agent-side reading protocol; new paragraph documents upstream self-edit suppression
- **Scope In — distributor catalog row** — present · self-edit-baseline-sync bundled row added; catalog and run-sweep test counts updated in lockstep
- **Scope Out — no general 'who wrote it' machinery** — present · no PID logging, no command parsing, no audit-subsystem calls; mechanism uses only the state dir the watcher already keeps
- **Deferred — no metrics/logging of catch rate** — present · correctly absent

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Small realizations beyond the letter of the shape but consistent with its spirit: (a) sync script wraps its work in `timeout 2` and always exits 0 — explicit realization of the 'cannot make watcher WORSE' invariant; (b) runbook slug regex validation on the sync side mirrors the watcher's own defensive slug check; (c) the sync script parses `role:` from the identity YAML frontmatter to reconstruct role/runbook paths (necessary to obey the watcher's filename convention); (d) new-runbook-created events are also suppressed when the marker confirms agent authorship — consistent extension of the same principle to the 'added' event kind; (e) cold-start pass also consumes markers so a marker outliving a watcher restart still counts. Test driver (self-edit-baseline-sync.test.sh) covers T-S1..T-S7 including the load-bearing peer-edit-during-settle case.
