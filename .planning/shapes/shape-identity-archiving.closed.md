# Shape: identity archiving from the front end

**Opened:** 2026-09-17
**Vehicle:** GSD phase

## What this is

Add an "archive" action to the unified context menu that lives on both the sidebar conversation row and the identity badge on a session. It is the counterpart to the existing "kill" action — where kill is end-of-life for a session with no identity behind it, archive is end-of-life for a session that does. It replaces the existing "hide" action in the same context menus: front-end experience stays the same as hide feels today (row falls out of the live list and appears in the archived section), but the back-end gesture is real — the identity is genuinely retired on the host, not just visually filtered.

## Shape

Three moving parts, in order of where they live:

**Context menu (surface).** In the unified menu shared by the sidebar row and the identity badge, the "hide" item is renamed to "archive" and styled red like kill. A confirmation prompt guards the click: "archive `<identity>`? this can't be undone." Confirmed clicks close the visible session if one is open (existing hide behavior, preserved) and drop an archive sentinel on the identity's on-disk folder — the frontend does no further work than that. Existing hide-related menu logic goes away with the rename.

**Sentinel (the signal).** A one-shot intent sentinel on the identity's folder — same category as the existing recycle-request sentinel — is the entire contract between the frontend and the supervisor. The frontend drops it; the supervisor consumes it. The current `hidden` sentinel concept goes away entirely.

**Supervisor (the actor).** The agent-supervisor picks up the sentinel on its normal reconcile tick and runs the retire flow — a graceful, ordered shutdown of the identity — locally on the host. When the retire flow finishes, the sentinel is deleted (it was a signal, not a state). Nothing about this touches Skynet's server code; the frontend never talks about "how to retire an identity," it just says "please retire this one."

The retire flow itself, in order:
1. **Deactivate the Matrix account** on the identity's homeserver first. This stops new inbound messages from arriving during teardown so the relay receiver has nothing new to catch on the way out.
2. **Gracefully exit the harness** — the same "send `/exit` to the pane, wait, SIGTERM survivors" pattern the recycle flow already uses. When the harness dies, the per-identity ambient monitor notices via its harness-watch and shuts down its four watcher children cleanly, including flushing the relay receiver's message cursor. This is the graceful path the current retire order skips.
3. **Kill the tmux session** — at this point the pane should already be empty; this is a cleanup step, not the load-bearing kill.
4. **Move the identity folder** from the live tree to the sibling archive tree. Once the folder is out of the live tree, the ambient-monitor's reconcile loop stops trying to spawn watchers for it on future ticks — the identity is fully gone.

**Archived section.** The sidebar keeps its archived section (visible when expanded). For it to have any content, the fleet-status sweep needs to also enumerate the archive tree — today it only walks the live tree. Rows sourced from the archive tree are tagged as archived and appear in the archived section only. The archived section lazy-loads: rows below the fold don't hit the DOM until the section is expanded (this may already be the behavior for hidden rows today; verify and preserve if so).

**Archived rows are inert.** No context menu, no interactions. They exist for visibility ("this identity was retired") and nothing else in v1.

## Philosophy

Archive is a real end-of-life gesture, not a fig leaf. Hide today looks final (row disappears) but isn't (identity still running, watchers still firing, harness still consuming resources). Archive delivers on the promise the gesture visually implies: the identity is genuinely gone from this host after the action completes. Confirmation exists because the action has real weight and can't be undone.

The graceful-shutdown ordering is deliberate. Every step is chosen so that the layer being torn down has already had its chance to flush and exit cleanly — Matrix first so no new work arrives during teardown, harness second so the ambient monitor's own graceful shutdown path runs, tmux third as cleanup, folder move last so nothing tries to read state that just vanished. The alternative order (fold folder move to the front to stop the watchers by starving them) works mechanically but is a hard stop, not a graceful one.

The supervisor is the sole actor on the retire flow. The frontend expresses intent (drop the sentinel) and the supervisor does the work. This keeps Skynet's server free of "how to retire" logic entirely.

Reversal is deliberately out of scope for v1. The Matrix deactivation makes real reversal expensive (a new account under a new mxid, not a resurrection of the old one), and the shape works better with reversal-as-a-later-conversation than with a half-reversible v1.

## Prior context

- The frontend already has a unified context menu across sidebar rows and identity badges — the two entry points share their action set. Kill already lives in it as a destructive red action, but is deliberately hidden for identity-backed rows.
- Hide today drops a `.hidden` sentinel on the identity's folder; the fleet-status sweep reads the sentinel and tags the row; the sidebar filters accordingly. Hide is reversible via un-hide.
- The archive folder location — a sibling of the live identities tree — already exists on hosts (empty). It was created for the retire flow described below.
- The supervisor already has a full retire flow implemented, but it's gated behind 180-day dormancy on a daily-scan cadence. That code path has **never fired in production** because the app hasn't existed for 180 days. It has to be treated as untrusted and revalidated end-to-end as part of this work — not shipped on trust.
- The retire flow as currently written does its three steps in a different order (folder move → tmux kill → Matrix deactivate). The ordering is being changed as part of this work; the current order is not sacred.
- The per-identity ambient monitor supervises four watcher children (relay receiver, wake-up scheduler, context watch, role-file watch) and has an explicit "graceful shutdown when the harness dies" design — this is what the new retire ordering leans on.
- Recycle already uses a "graceful exit paste + Enter, SIGTERM survivors" pattern for ending harness processes. The retire flow will use the same pattern in its harness-exit step rather than re-inventing it.
- Existing skip guards on the 180-day retire (pinned, no-dormancy, coordinator frontmatter) exist to prevent surprise automated retires. User-initiated archive overrides all three — the guards protect against automation, not against direct intent.
- Migration of existing `.hidden` sentinels is manual and outside this work's code scope. The maintainer will convert them on each host after the code lands.

## What would make it wrong

- Clicking archive causes a visual retreat (row disappears from the sidebar) but the harness keeps running, the relay account stays live, the watchers keep firing. Same failure mode as hide today. If archive doesn't actually retire the identity, we've done nothing.
- The retire flow completes on paper but the Matrix account is left live because the deactivation call was skipped or silently failed. the operator pays for a homeserver seat forever for a retired identity. Silent failure on Matrix deactivate is unacceptable — this step must either succeed or be loudly surfaced.
- The retire kills the tmux session before the harness has had a chance to save. Any in-flight work in that harness is lost with no warning. The graceful order exists to prevent this; if it's skipped for expediency, the feature is worse than hide.
- Archive shows the confirmation prompt but a bug lets a click through without confirmation. Given the irreversibility, an accidental archive is a real user cost — the prompt has to actually gate the action.
- The archive sentinel gets dropped but the supervisor never notices it (bug in the reconcile loop, wrong path, permissions), and the identity sits with a stale sentinel forever. If the sentinel isn't picked up quickly, the frontend and the actual world diverge.
- The retire flow completes but the archived section doesn't show the row (sweep doesn't enumerate the archive tree). The user has no way to know retire actually happened — they see "row disappeared" but no confirmation the identity was archived rather than lost.
- Two clicks in quick succession, or a supervisor mid-processing when a second sentinel appears, produce a broken half-state — folder half-moved, tmux killed but Matrix still live, or worse. The retire flow needs to be safe against re-entry.
- Testing rides on the assumption that the existing 180-day retire works "because the code is there." It's never run. If the tests are only unit-level or only test the new sentinel-drop path, we ship a retire flow that first runs in production against a real identity the operator cares about.

## Scope edges

**In scope:**
- Renaming hide → archive in the unified context menu, both entry points.
- Red styling on the archive item, matching kill.
- Confirmation dialog on click.
- Sentinel-drop on confirmed click (replacing the current `.hidden` sentinel drop).
- Supervisor changes: sentinel scan on reconcile tick; retire flow reordered per this shape; retire triggered immediately by user-initiated sentinel, bypassing the 180-day gate and the pinned/no-dormancy/coordinator skip guards.
- Fleet-status sweep changes: enumerate the archive tree and tag those rows as archived.
- Archived section in the sidebar preserved; verify and preserve lazy-loading.
- End-to-end tests against the actual retire path — real folder move, real tmux teardown, real (mock or throwaway) Matrix deactivate — treating the existing 180-day retire code as untrusted.

**Out of scope:**
- Un-archive / reversal of any kind. Deferred to a later conversation.
- Any interactions on archived rows in the sidebar beyond viewing them. No context menu on archived rows in v1.
- Migration of existing `.hidden` sentinels on already-deployed hosts. Handled manually by the maintainer after this ships.
- Changing how the 180-day dormancy retire fires (its cadence, its own trigger). This work only adds a second trigger path; the daily-sweep path keeps working the same way after (with the reordered retire steps applying to it too, since it shares the retire flow).
- Changes to the `.dormant` concept or watcher behavior for still-live identities.

**Tempting but not for now:**
- A "restore" or "un-archive" affordance in the archived section. Genuinely tempting because it feels like a natural counterpart, but the Matrix deactivation makes it a much bigger conversation and pulling it in here would bloat the shape.
- A "permanently delete" action for rows already in the archive tree. Also tempting, also its own decision to be made later.

## Vehicle notes

Full GSD phase (`/gsd:plan-phase` → discuss → plan → execute → verify).

Chosen because the work spans multiple codebases (Skynet frontend TS/React, fleet-substrate bash supervisor, fleet-status sweep Python), involves a code path that has never fired in production and must be revalidated end-to-end, and has real ordering-correctness concerns in the retire flow that deserve planning-level attention rather than being decided during a rush. The "never actually run" untested-in-practice code is the load-bearing reason `/gsd:quick` isn't right here — that path deserves real test coverage, and the phase structure earns its place by making that a first-class deliverable rather than a "hopefully we remember" note.

This shape file is complete enough to seed `/gsd:discuss-phase` directly — the why, what, philosophy, prior context, failure modes, and scope edges are all above. The discuss phase can drill into implementation-level ambiguities (exact test structure, exact sentinel filename beyond "archive-requested," how to safely handle mid-turn harness archive requests) without re-eliciting the shape.

Repo tree: `~/skynet-wren` on `feat/tab-title-from-tmux`. All three codebases live in this repo (the fleet substrate scripts are at `substrate/scripts/`; the distributor pushes them to every managed host). The archived section lazy-loading verification and the fleet-status sweep both live in the same tree — one repo, one phase.

`/close identity-archiving` closes the arc after the phase ships.

---

## Close-Out

**Closed:** 2026-09-17
**Vehicle used:** GSD phase (Phase 115, plans 115-01 through 115-07)
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is** — present · Archive action lands in the unified context menu on both entry points; replaces hide as the real end-of-life gesture for identity-backed rows
- **Shape: Context menu (surface)** — present · Archive item on sidebar row and identity badge; red danger styling; window.confirm guard with exact copy `archive <name>? this can't be undone.`; confirmed clicks close the visible pane and fire the archive request
- **Shape: Sentinel (the signal)** — present · `.archive-requested` sentinel is the sole contract; allowlist includes it; `.hidden` retired
- **Shape: Supervisor (the actor)** — present · reconcile-tick sentinel scan invokes retire immediately (~15s cadence, not gated by 24h) and bypasses pinned/no-dormancy/coordinator guards
- **Shape: Retire flow order (matrix → graceful exit → tmux kill → folder move)** — present · retire is reordered per D-13: matrix deactivate → graceful `/exit` paste + SIGTERM survivors + `GRACE_WAIT` for ambient-monitor cleanup → tmux kill-session → sentinel delete → folder move to archive tree
- **Shape: Archived section** — present · inert archived-row component rendered under a collapsible "Archived" group; fed by a distinct `identity-archived` wire message pool; sweep enumerates both live tree and archive tree
- **Shape: Archived rows are inert** — present · no onClick / onContextMenu / onSelect / no context menu portal; inert lock explicitly commented
- **Philosophy: real end-of-life gesture, not a fig leaf** — present · sentinel drives a real retire; not a visual filter
- **Philosophy: graceful-shutdown ordering** — present · matrix-first / harness-graceful-second / tmux-third / folder-move-last matches the shape's stated deliberate order
- **Philosophy: supervisor is the sole actor** — present · Skynet route only writes the sentinel; no retire logic on the server; supervisor consumes
- **Philosophy: reversal out of scope for v1** — present · no un-archive endpoint, no restore affordance; guard-tests lock the absence
- **Prior context: unified context menu across sidebar rows and identity badges** — present · both entry points share the Archive item and use the same confirmation copy resolver
- **Prior context: archive folder location sibling of live tree** — present · archive-tree location resolved via the same environment sibling; sweep walks both roots
- **Prior context: user-initiated archive overrides the pinned/no-dormancy/coordinator guards** — present · sentinel-scan branch bypasses all three per D-11; guard-bypass test locks it
- **Prior context: reuse recycle's `/exit` + SIGTERM pattern for graceful harness exit** — present · step 2 reuses the recycle pattern verbatim per D-13/D-14
- **What would make it wrong: visual retreat only, harness still runs** — present · retire flow actually kills the identity, not just a filter
- **What would make it wrong: Matrix deactivate skipped or silently failed** — present · step 1 aborts on any non-idempotent Matrix failure with LOUD `ERROR:` log lines and retains the sentinel; retire-fail counter drives to retire-stuck on the 3rd consecutive fail
- **What would make it wrong: tmux killed before harness saves** — present · step 2 (graceful harness exit) precedes step 3 (tmux kill); step-order test and ambient-monitor observability test lock the ordering
- **What would make it wrong: prompt bypassed by a bug** — present · both entry points wrap the fire-and-forget call in `window.confirm`; early return on false; identical copy resolver
- **What would make it wrong: sentinel dropped but supervisor never notices it** — present · sentinel scan runs on the fast reconcile tick (~15s), not the daily 24h gate
- **What would make it wrong: retire completes but archived section doesn't show the row** — present · sweep enumerates archive tree with `archived=true`; distinct `identity-archived` wire frame routes to the archived-rows store; Archived section renders from that pool
- **What would make it wrong: two clicks / mid-processing produce broken half-state** — present · retire is idempotent at each step (folder-move retry-from-partial; step 1 fallback for archdir/relay.json on partial resume; per-tick fail counter; collision aborts). Sentinel is a single filename so a second write is a no-op
- **What would make it wrong: testing rides on the untested 180-day path being trusted** — partial · E2E tests exercise real folder move + real Matrix deactivate against a stub homeserver + log-ordering assertions; ambient-monitor cascade at minimal (log-line + marker) level. Real-tmux-session step-3 teardown NOT exercised — file itself notes SIGTERM fanout is "the deferred deeper-coverage case." the operator's disposition: minimal ambient-monitor is accepted-as-drift; real-tmux teardown is a real gap and must land as follow-up before deploy.
- **Scope edges (In): rename hide → archive in unified menu, both entry points** — present · renamed on both row and identity-badge menu
- **Scope edges (In): red styling matching kill** — present · `danger: true` on the Archive menu item at both entry points
- **Scope edges (In): confirmation dialog on click** — present · `window.confirm` at both entry points with byte-identical copy
- **Scope edges (In): sentinel-drop replacing the .hidden sentinel drop** — present · writes `.archive-requested`; `.hidden` removed from allowlist
- **Scope edges (In): supervisor sentinel scan on reconcile tick; retire reordered; user-initiated bypasses the guards** — present · all three landed and locked by tests
- **Scope edges (In): fleet-status sweep enumerates archive tree and tags rows as archived** — present · sweep walks both roots; archived flag set from disk root
- **Scope edges (In): archived section preserved with lazy-loading** — present · lazy short-circuit renders rows only when the section is expanded; D-19 invariant explicit in code
- **Scope edges (In): end-to-end tests against actual retire path treating 180-day code as untrusted** — partial · real folder move + real Matrix deactivate (stub) + log-ordering assertions present; real-tmux-session step-3 teardown NOT exercised. the operator: real-tmux test must land as follow-up; minimal ambient-monitor cascade accepted-as-drift.
- **Scope edges (Out): un-archive / reversal** — present · no endpoint or affordance; guard-test locks the absence
- **Scope edges (Out): interactions on archived rows beyond viewing** — present · archived-row component attaches no handlers
- **Scope edges (Out): migration of existing .hidden sentinels** — present · no migration code path; consistent with shape's "manual, outside this work"
- **Scope edges (Out): changing 180-day dormancy retire cadence or trigger** — present · daily-cadence gate still runs on 24h; daily-path guard-respect test locked
- **Scope edges (Out): changes to .dormant concept or watcher behavior for still-live identities** — present · no changes to `.dormant` handling or the four watcher children
- **Scope edges (Tempting-but-no): restore / un-archive affordance in archived section** — present · not implemented
- **Scope edges (Tempting-but-no): permanently-delete action for archive-tree rows** — present · not implemented

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Add a real-tmux-session test to plan 115-07's harness: spawn a real tmux session, drive user-initiated archive, assert `tmux has-session` returns non-zero after retire completes. — new-shape
- Deeper ambient-monitor cascade coverage — 4 stub children observing SIGTERM fanout via killpg — deferred as CI-fragile future work. — accepted-as-drift

### Notes

The shape was executed with high fidelity across all three codebases. The retire-flow reorder, sentinel contract, guard-bypass semantics, wire-frame separation for archived rows, and lazy-loaded archived section all match the shape verbatim with D-XX rationale marks at every load-bearing seam. Small cleanup opportunity: the Hide/Unhide branch remains as dead code inside the sidebar-row menu builder (gated on a prop the panel no longer supplies) — user-invisible but worth a future janitor pass. The one substantive gap: the shape's literal "real tmux teardown" wording is not honored by the tests as landed — every retire test runs against a scratch tree with no tmux session, so step 3's actual tmux kill-session against a live session is not exercised. The plan-check pre-approved a MINIMAL variant of the ambient-monitor observability, which the operator confirmed as accepted drift; the real-tmux-session gap is a distinct issue that surfaced only in this close-out because the plan-check's MINIMAL scope elided it. The `tmux has-session` signal is deterministic and not CI-fragile, so the follow-up test is cheap and should land before this arc is considered fully closed.
