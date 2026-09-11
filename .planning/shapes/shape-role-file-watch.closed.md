# Shape: Monitor for watching for edits to role file

**Opened:** 2026-09-06
**Vehicle:** gsd quick

## What this is

A fourth ambient watch that stands up alongside the existing three at the start of a session. It sits on the role file — the shared, permanent knowledge file for the role an identity is holding — and wakes the running agent when the file changes, so a directive added or removed by ONE identity of a multi-identity role becomes visible to the OTHER identities of that role while they are still running, instead of only being picked up on their next full recycle.

## Shape

- **What it watches.** Exactly one thing: the role file for whichever role this identity is holding. Nothing wider — not the deeper reference files that live next to it, not the identity's own slim pointer file, not the handoff. Just the role file.

- **What it does when the file changes.** Fires ONE wake event. The event carries the diff of what changed — inline in the event when the diff is small, and spilled to a file on disk with a pointer in the event when the diff is too large to fit under the harness's per-event character cap (same pattern used by the relay receiver for long inbound messages). No summarization, no interpretation — the diff itself is what the agent reads.

- **What the agent does with the event.** Reads the diff. If it recognizes the change as one it made itself (via `remember X` / `always X` / `forget X` / `never X` acting on the user's word), it ignores it. If the change came from another identity, it adopts it — the mental model updates in-session without needing a full re-read of the file.

- **How it decides what's new.** Each identity keeps its own persisted baseline of the last-seen state of the role file. On file change, the watcher diffs current-vs-baseline, emits the diff, updates the baseline. On the very first run for an identity — when no baseline exists yet — the watcher silently snapshots the current state as the baseline and does NOT fire, because a fresh identity has just read the file at load anyway.

- **Where the baseline lives.** Per-identity, on the same box, alongside the identity's other per-session state (siblings of the relay cursor). Not role-scoped — role-scoped would mean multiple identities on one box mutating one shared baseline, which needs locking; per-identity avoids that entirely.

- **When it starts.** As part of the on-wake sequence, once per session, right after the existing three ambient watches. Dies with the session; a fresh session restarts it.

- **Scope of applicability.** Fleet-wide, in the id skill body — every identity holding every role gets this fourth watch on wake. It's cheap enough that carrying it for identities on single-holder roles costs nothing, and the value shows up the moment a role becomes multi-holder.

## Philosophy

The watch is a **live-sync aid, not a source of truth.** The role file on disk remains the source of truth; the watcher just closes the mid-session gap where an agent's in-context copy of the role file has diverged from disk because another identity of the same role edited it. Every fresh identity load STILL reads the file from scratch and adopts the whole thing — the watch is an ADDITION to that, not a replacement.

The watch is **diff-first, not re-read-first.** The whole point of using a diff — inline when it fits, off-disk when it doesn't — is to avoid pulling the entire file back into context on every mid-session change. The relay receiver established this shape (short messages inline, long messages via file pointer) and it works; role-file changes get the same treatment.

The watch is **dumb, on purpose.** It doesn't know who made the edit, doesn't try to detect self-edits, doesn't decide what's important. The AGENT decides, from reading the diff, whether this is its own change or someone else's, whether to adopt or ignore. This keeps the watcher trivial and puts the judgment where the judgment already lives.

The watch is **symmetric with the existing three.** Same primitive (a persistent ambient monitor started on wake), same lifecycle (dies with the session, restarts on the next wake), same distribution channel (a shipped helper alongside the others, no per-box hand-authoring). If you know how the other three work, you know how this one works.

## Prior context

An identity on a multi-identity role today only learns about changes to its role file at the next full recycle: `remember X` said in another identity's session lands in the file immediately, but the running peer identities carry a now-stale in-context copy until they save + reload. In practice this shows up as agents making decisions based on directives that no longer exist, or missing directives that were added minutes ago. The load-bearing case is the box-maintainer role, which currently runs under multiple concurrent identities on the same box, all sharing one role file.

The existing three ambient watches all fire on events happening OUTSIDE the agent's process — a peer's message, a scheduled tick, a context-pressure threshold. This fourth watch is genuinely different from those in one way: the agent EDITS the watched file itself as part of its own normal operation, so the watcher can and will wake the agent on its own writes. That's why the diff-driven "look at the change and decide if it's mine" approach matters more here than for the other three, where the source of the event is inherently external.

The relay receiver's long-inbound-message handling — inline for short messages, file-pointer for long messages — is the exact template for handling diffs that exceed the harness's event character cap. Both problems have the same shape: "one event, but sometimes the payload is bigger than an event can carry."

## What would make it wrong

- **It wakes the agent on every self-edit and the agent gets confused.** If the diff-adoption story fails — if the agent can't reliably tell "that's my edit" from "that's someone else's edit" — then every `remember X` command produces a self-notification cascade and the noise floor drowns the real signal. The design bets the diff content itself is sufficient for this judgment; if that bet is wrong, this feature is worse than not having it.

- **It re-reads the whole file on every event.** The whole reason to use a diff is to keep incremental changes from pulling the entire file back into context. If in practice the diff is being ignored and agents just re-read the whole file on every fire, the feature has missed the point — we've paid for the monitor without getting the incremental-update benefit.

- **It doesn't fire on the case it exists for.** If two identities of the same role are running concurrently and one adds a `remember X`, the other identity's watch MUST fire. If that path is broken — timing, permissions, watching the wrong file, whatever — the feature is decorative.

- **The baseline gets corrupt or diverges.** If the persisted baseline somehow ends up disagreeing with what the agent's in-context copy actually is (e.g. the baseline captures a state the agent never saw), diffs stop making sense and every fire is confusing. Self-correcting on the next real edit, but any window where diffs are misleading is a bug.

- **The first-run rule fires anyway.** If an identity's very first `/id` load produces a spurious wake because the "have I seen this file before?" check misfires, we've broken the "silent on cold start" invariant Alice picked to keep fresh sessions clean.

- **It's expensive.** The premise is that this is cheap enough to run everywhere by default. If it turns out to consume real CPU or produce meaningful event traffic in the steady state (idle role file, nothing changing), the "fleet-wide default" call is wrong and we'd need to make it opt-in.

## Scope edges

**In:**
- Watches the role file for the identity's currently-held role.
- Persisted per-identity baseline; diffs against baseline on every change; updates baseline on emit.
- Inline diff when small enough for the harness event cap; file-pointer + off-disk read when larger.
- Silent on first-ever run for an identity (no baseline yet); fires on every subsequent run's post-cold catch-up as well as steady-state edits.
- Starts as a fourth ambient watch in the on-wake sequence, right after the existing three.
- Documented in the id skill body so every identity picks it up automatically.
- Fleet-wide default — no opt-in, no opt-out, symmetric with the other three.

**Out:**
- Watching the identity's slim pointer file, the handoff, or any of the deeper role-scoped reference files. Just the role file itself.
- Any smarts about who made the edit — no authorship detection, no filtering of self-writes at the watcher layer. All judgment lives in the agent reading the diff.
- Any coordination between identities — the watch is per-identity and their baselines are independent.
- Any change to how the role file is edited — the `remember` / `always` / `forget` / `never` grammar and the user-approval rule stay exactly as they are today.
- Any change to how `/id` load works — the on-wake full read of the role file remains; the watch is purely additive.
- Any handling of the redundant-fire window between recycle-request and the fresh session starting its new watch. Small, rare, harmless. Accepted, not designed around.

**Deferred:**
- Widening the watch net to include the deeper reference files. Not now — role file only. If the pattern proves valuable, that's a natural follow-up.
- Any auto-restart-on-crash for the watcher, matching what we do (or don't do) for the other three ambient watches.

**Tempting but no:**
- Making the watcher smart enough to detect self-edits at the watcher layer, so the agent never sees its own writes. Tempting because it would reduce noise, but it puts judgment in the wrong place and couples the watcher tightly to the id skill's edit paths. Diff-in-content-based recognition by the agent is cleaner.
- Coalescing rapid-fire edits (three `remember X` in a burst → one wake instead of three). Tempting for tidiness, but the relay receiver doesn't coalesce and neither does the wake scheduler, and keeping the four watches shape-symmetric is more valuable than optimizing burst cases that are already fine.

## Vehicle notes

`/gsd:quick`. Sized right for this shape: a new shipped helper alongside the other three ambient-watch helpers, a section addition to the id skill body's on-wake sequence, an update to the id-skill handoff document that lives in the box-maintainer role folder, and a distributor catalog entry so the new helper propagates to every managed host. Comparable in scope to recent distributor-related quick tasks and larger than inline warrants.

Full pipeline (GSD phase with spec/discuss/plan/execute/verify) is overkill — the shape is settled in this document and the change is coherent enough for a single atomic quick task. Inline is under-sized because this touches multiple substrate items and needs to propagate through the distributor.

Handoff notes for the implementer:
- The identity currently doing this work is the tanya identity of the box-maintainer role. Fleet-substrate ownership sits with this role per the recent transfer from nicole, so this change is in-lane.
- The four ambient watches all live under one owner now (this role), so no cross-role coordination is needed for the id-skill body edit.
- Follow the standing rule: build + commit locally, do NOT push, do NOT deploy — Alice greenlights push separately per the tightened deploy-window boundary rule.

---

## Close-Out

**Closed:** 2026-09-06
**Vehicle used:** gsd quick (`/gsd:quick` 260906-2aw)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · fourth ambient watch on the role file, wakes agents on peer-identity edits mid-session.
- **Shape: What it watches** — present · exactly the role file, no reference files, no identity pointer, no handoff.
- **Shape: What it does when the file changes** — present · one event per change, diff-carrying, inline when small and spilled-to-file with a pointer when large.
- **Shape: What the agent does with the event** — present · watcher emits raw diff, agent judges adopt-vs-ignore from content. No self-echo filtering at the watcher layer.
- **Shape: How it decides what's new** — present · persisted per-identity baseline, diff current-vs-baseline on every event, update baseline after emit.
- **Shape: Where the baseline lives** — present · per-identity under the identity's dir, sibling to the relay cursor; not role-scoped.
- **Shape: When it starts** — present · fourth ambient watch on the on-wake sequence, dies with the session.
- **Shape: Scope of applicability** — drifted (endorsed) · id skill body enrolls actor identities on wake; coordinator-mode section still lists only three. Alice: "Coordinators should not get this monitor because they don't read the role file and wouldn't need to know the updates." The shape's "every identity holding every role" language is superseded — the correct scope is every ACTOR identity holding every role. Coordinators are intentionally excluded.
- **Philosophy: live-sync aid, not source of truth** — present · `/id` load still reads the whole role file; the watch is purely additive.
- **Philosophy: diff-first, not re-read-first** — present · event carries diff, no re-read prompt.
- **Philosophy: dumb, on purpose** — present · watcher has no authorship detection, no self-edit filter, no importance judgment.
- **Philosophy: symmetric with the existing three** — present · same primitive (persistent Monitor), same lifecycle, same distribution channel.
- **Prior context: multi-identity role gap** — present · the design directly addresses the box-maintainer multi-identity case.
- **What would make it wrong: wakes on every self-edit and confuses the agent** — present · design bets diff-content is enough for self-vs-other recognition; ships as-designed, real-world verification is future UAT.
- **What would make it wrong: re-reads the whole file on every event** — present · design uses diff throughout; agent-side re-read is a behavioral risk not designed-around here.
- **What would make it wrong: doesn't fire on the case it exists for** — present · watcher targets the exact file path derived from identity frontmatter, inotify primary + mtime fallback covers the fire path.
- **What would make it wrong: baseline gets corrupt or diverges** — present · atomic baseline write via os.replace after each emit; self-correcting on next real edit.
- **What would make it wrong: first-run rule fires anyway** — present · script snapshots silently on missing baseline before entering the watch loop.
- **What would make it wrong: it's expensive** — present · inotify blocks with no CPU cost in steady state; polling fallback is 2s cadence; helper is stdlib-only.
- **Scope edges (In)** — present.
- **Scope edges (Out)** — present · no smarts, no coordination, no edit-grammar changes, no `/id` load changes, redundant-fire window accepted.
- **Scope edges (Deferred)** — present · wider watch net and auto-restart-on-crash both deferred as named.
- **Scope edges (Tempting but no)** — present · no watcher-layer self-edit filter, no burst coalescing.

### Additions (in the result, not in the shape)

- None found by the reviewer.

### Follow-ups

- Shape's "every identity holding every role" language is superseded by Alice's coord-exclusion call; if the shape ever gets re-read as source of truth, note the sharpening: "every actor identity holding every role." — accepted-as-drift

### Notes

The reviewer noted one belt-and-suspenders concern worth carrying forward as awareness: the script itself does not detect coordinator mode; if a coordinator accidentally starts the watch (e.g. hand-launched, or a future id-skill change re-adds it), the script will happily watch the role file. The id skill body is the sole gate on coord exclusion. Fine as-is per the shape's "dumb, on purpose" philosophy, but if coord identities ever start acquiring the monitor spuriously, the fix is to tighten the id skill's coord-mode section, not to add coord-mode detection into the script.
