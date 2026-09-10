# Phase 104 — CONTEXT

> Seeded from `/open` shape file at `.planning/shapes/shape-repo-stats-display.md` (opened 2026-09-10).
> The shape captures the WHY, WHAT, philosophy, prior context, failure modes, scope edges,
> detection semantics, visual decisions, and vehicle notes — everything `/gsd:discuss-phase`
> would otherwise re-elicit. Refinements below (if any) supplement rather than replace the shape.

---

# Shape: repo stats display — an at-a-glance signal for identities with trapped local work

**Opened:** 2026-09-10
**Vehicle:** GSD phase (single)

## What this is

A small visual indicator, per identity, that lights up when that identity has code work sitting locally in her working area that hasn't been shipped anywhere. The point is anti-orphaning: some identities go dormant, some get retired, and if there's work sitting on their disk when that happens, the work dies with them. This indicator makes trapped work visible so it can be shipped before the identity fades from attention.

The indicator is presence-based and self-hiding. It appears only for identities whose working area actually contains code repos with unshipped state; it's completely absent for identities that don't work in code at all. A user who never touches code never sees this feature — it doesn't take a pixel of their interface.

## Shape

Two mechanically-separate parts that only make sense together:

**The detector.** For a given identity, walk her working area to a bounded depth, find each version-tracked project inside it, and produce a single yes-or-no answer per identity: does this identity have unshipped local work? If yes anywhere across all her projects, the answer is yes. If no projects exist at all, the answer is silence — no signal produced, no indicator to render.

The working area is a formal, per-identity folder inside her identity directory — a standardized location that new identities get by convention. Identities that haven't adopted the standard yet quietly fall out of the detector's coverage, and that's accepted; they migrate whenever they migrate.

**The indicator.** Where the identity is visually represented in the interface, a small icon appears when the detector answers yes. Same icon, same placement pattern, both places the identity shows up in the interface today. Absent whenever the detector answers no or silence.

The indicator is binary and aggregated: one signal per identity, merging every flavor of trapped work into one presence-or-absence. It does not carry counts; it does not distinguish uncommitted from unpushed; it does not surface per-project detail. The whole point is a quiet, at-a-glance "there's something trapped here" that doesn't nag and doesn't demand attention beyond its own existence.

It is always shown, whether the identity is currently active or dormant. An active worker's tree may be dirty for perfectly good reasons, but the indicator's presence is honest about the fact that if the session ended right now, the work would be trapped until she came back. The signal doesn't distinguish "in flight" from "abandoned"; it distinguishes "shipped" from "not shipped."

## Philosophy

This is a **rescue-oriented signal, not a productivity one.** It exists to prevent forgotten local work from dying with a forgotten identity — not to encourage more commits, not to shame anyone for having a dirty tree, not to track velocity, not to be a to-do list.

It's **intent-based, not comprehensive.** The detector only counts work that was clearly meant to ship somewhere: a project with a remote configured, a branch with commits (whether or not the branch has an upstream), edits to tracked files, stashed changes. It deliberately ignores loose scratch that was never signaled as ship-intended: untracked files sitting in a project, projects that have no remote at all. Those are personal scratch, not trapped work.

It's **zero-cost for non-participants.** A user or an identity that doesn't work in code never sees this indicator anywhere. The self-hiding property has to hold at the data layer, not at the render layer — if the detector produces no signal, the frontend has literally nothing to render, and the feature is invisible.

Consistency across the two identity surfaces matters. The same icon in the same corner of the avatar reads as one signal, seen twice, wherever an identity is represented. Divergent treatments across surfaces would fragment the signal and dilute its meaning.

**What would violate the spirit even if it passed a test:**
- Nag copy, badges that pull attention beyond their own presence, notification-style urgency
- Counts, breakdowns, per-project detail (any of which would tip this back into productivity-tracker territory)
- Showing on identities that don't have code work (fires the false-alarm case the self-hiding is designed to prevent)
- Two-tone or multi-state variants that try to distinguish flavors of trapped work

## Prior context

Every identity today has a working area she operates in. For some identities the working area contains real code projects (the box-maintainer identities keep the Skynet source tree in theirs, for example); for most identities it does not. Today there is no visible signal anywhere about the state of trapped work — the only way to know is for the identity herself to remember to check, or for the user to ask.

The two identity surfaces where this signal belongs:

- **The conversation list row** — one row per identity conversation, showing an avatar with the identity's face, the identity's name, and a subtitle. This is the glance-level view of everyone the user is talking to.
- **The identity badge in the chat header** — the "here's who you're talking to" pill in the top-right of the active chat surface, showing a larger avatar with the identity's display name and title.

Both surfaces currently host visual affordances on the avatar corners. The conversation list row's avatar today carries two count-badges: one at the bottom-left showing role-level bounty counts, one at the bottom-right showing role-level needs-desk counts. Both are being removed as part of this work — they're role-scoped information smeared across identity rows (every identity that shares a role shows the same count), and their removal both cleans up the visual and frees the avatar corners for something with better signal-per-pixel.

The identity badge in the chat header does not have those two count-badges and needs no removal there — only the new indicator's addition.

The standardized per-identity working-area folder is a recent-or-forthcoming convention. Existing identities that predate the convention (specifically the identities currently maintaining Skynet) keep their working code in older locations that don't fit the new convention yet. Those identities silently fall out of detector coverage until they migrate; no override, no bandage.

## What would make it wrong

- **Firing on an identity that has no code work.** Any identity whose working area has no eligible projects should show no indicator, ever. If a plain-text-conversation identity ever renders the indicator, the self-hiding contract has broken and the feature has forgotten its own philosophy.
- **Rendering role-scoped state instead of per-identity state.** The old badges suffered this — five identities that shared a role showed the same badge value. If the new indicator ever aggregates trapped work across identities in a way that identical values appear on unrelated rows, that's the same anti-pattern in a new coat.
- **The signal drifting into productivity-tracker territory.** Copy or affordances that suggest "you should push more," per-project drill-downs surfaced by default, counts appearing anywhere, subtle nagging on dormant identities — any of these mean the feature has forgotten it's about rescuing forgotten work, not about tracking output.
- **Divergent visuals across the two surfaces.** If the conversation list uses one icon and the identity badge uses a different one, or one uses a corner and the other uses a chip, the signal fragments. Both surfaces speak the same visual sentence.
- **Detection cost creeping into the interactive path.** The detection runs in the background against per-identity workspaces on the identity's own box; it cannot ever block a UI interaction or slow the chat list's render. If the render ever waits on a fresh probe, the shape has been implemented wrong.

## Scope edges

**In:**
- Backend detector: per-identity workspace walk to bounded depth, per-project probe for eligible trapped-work state, aggregation to a single binary per identity.
- Removal of the two role-count avatar badges on conversation list rows.
- Addition of the trapped-work indicator on conversation list row avatars.
- Addition of the same indicator on the identity badge in the chat header.
- Tests for both the detection logic and the two frontend surfaces.
- A hover tooltip on the indicator explaining what it means for someone seeing it for the first time.

**Out:**
- Any surface where the identity is visually represented but is NOT one of the two named above (the identity modal header, expanded identity views, sidebar identity previews, etc.). Scope is deliberately narrow.
- Any per-project drill-down interface. The indicator has no click behavior beyond hover-for-tooltip; there is nowhere to "expand" or "see details."
- Any count of trapped items, anywhere. Binary all the way.
- Support for version control systems other than git.
- Nag copy, reminders, notifications, "you should ship this" prompts, dormancy-crossing alerts.
- Migration of existing pre-convention identities to the new workspace layout (separate concern; happens on its own timeline).
- Historical trapped-state tracking (how long has this been sitting), commit-frequency graphs, per-identity ship history.

**Deferred:**
- Extending detection to non-git repositories, if a real fleet need for that ever appears.
- Additional surfaces beyond the two named, if the signal proves valuable enough that other surfaces feel bare without it.
- Any drill-down UI that would surface per-project detail, if pure-binary proves to leave too much unsaid in practice.

**Tempting but no:**
- Distinguishing uncommitted from unpushed via two-tone icons or separate badges. Confirmed already: one signal.
- Providing an override for pre-convention identities to opt into detection against a custom path. Silent gap during migration is the accepted cost.
- Showing count in the tooltip. Tooltip is a hint for what-does-this-mean-for-a-first-time-viewer, not a stats readout.

## Detection semantics — the eligibility rules

For clarity in execution, the detector's rules pulled together in one place:

- **Eligible project**: a git repository with at least one remote configured. Projects without any remote are personal scratch and don't count.
- **Eligible trapped state within an eligible project** — any of:
  - Modifications to tracked files (staged or unstaged).
  - Local commits not reachable from any remote (whether a branch has an upstream or not — a local-only branch's commits fully qualify).
  - Stashes on the reflog.
- **Ignored (does not count as trapped)**:
  - Untracked files in a repo (loose scratch).
  - Nested repositories inside another repository's tree; only the outermost repo is probed. Submodules and nested clones are not treated as independent projects.
  - Anything in a repo without a remote configured.

## Visual decisions — the tasted specifics

Both surfaces use the same icon and the same placement pattern:

- **Icon**: git-pull-request-draft (lucide). Chosen after tasting for its literal "commit exists but not merged/pushed" meaning — the most semantically precise of the candidates evaluated.
- **Placement on the conversation list row avatar**: bottom-right corner of the avatar in a small pilled disc, occupying one of the two slots freed by the badge removals.
- **Placement on the identity badge (chat header)**: bottom-right corner of the larger 56px avatar in a proportional pilled disc, mirroring the conversation-list treatment for visual coherence across the two surfaces.
- **Color**: warm amber, in-family with the existing warm-cream / off-white palette; drop-shadow glow at ~40% intensity to lift it against varied hue-tinted row backgrounds.
- **Tooltip on hover** (desktop): a short hint sentence like "Unshipped local work" — copy can be wordsmithed during execution. Purpose is first-time-viewer orientation, not detail.
- **No click behavior**: hover-only affordance. There is no drill-in surface.

## Vehicle notes

**Vehicle: single GSD phase.**

The work fits comfortably in one phase — one shipping unit with meaningful backend + frontend motion that should land together (the badge removals and indicator addition are all part of the same visual redecoration and would look half-done if split). Two-phase slice (backend detection alone, then frontend visible changes) was considered and rejected: separating them adds coordination overhead for little gain, and there's no valuable intermediate demo point between "detection running silently, nothing rendered" and "everything visible."

**Detection runs where the workspace lives.** The identity's workspace is on the identity's own box, and the central app doesn't have direct filesystem access to peer boxes. The detector's probe piggybacks on the existing SSH-based fleet-status bundle that already runs on each box on a poll cycle — one more probe in the same bundle, results returned through the same channel, cached with the rest of the fleet-status data. That means the indicator lags reality by at most one poll cycle, which is fine for a glance-level indicator; no new plumbing needed.

**Aesthetic fidelity is the tasting bar.** During tasting, an initial generic mockup was rejected in favor of one built against the real pretty-view design tokens (hue-per-row gradients, glassmorphic panel, Inter font, actual avatar treatment). The executing agent should carry that same faithfulness forward — this indicator inherits the pretty-view visual language, not a generic dark-theme approximation.

**Tests must cover both the detection logic and both frontend surfaces.** Detection tests should include: no repos at all, one repo clean, one repo with each flavor of trapped state, multiple repos with mixed state (verifying binary aggregation), nested repos (verifying outermost-only rule), remote-less repo (verifying it's ignored), depth-limit boundary case. Frontend tests should include: indicator absent when detector returns silence, indicator present when detector returns yes, tooltip visible on hover, both surfaces render consistently, existing green ready-for-attention dot unchanged.

**Related artifacts:**
- Bounty folder for this work: `~/.claude/roles/box-maintainer/bounties/repo-stats-display/`.
- Tasting mockup: `~/.claude/roles/box-maintainer/bounties/repo-stats-display/tasting/index.html` — the served HTML that produced the icon + placement decisions locked above. Preserved for reference; not shipped.
- Existing pretty-view visual tokens: `src/ui/index.css` and `src/ui/features/pretty-conversations/pretty-conversations.css` — the executing agent should build against these tokens, not introduce new palette values for this indicator.
- The existing on-avatar bounty-badge machinery being retired here lives in `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx` and the corresponding CSS rules in `pretty-conversations.css` under the `.pv-avatar .pv-bounty-badge-wrap` selectors. Removing this cleanly is a scope motion, not a side effect.

**Executor scope stops at code + commit + local scoped tests green.** Per fleet directive: the deploy motion (rebase / coord post / push / build / recreate / verify) is orchestrator-only after the executor returns. No "ship" task at executor scope. Full-suite tests run at the deploy gate, not before push.
