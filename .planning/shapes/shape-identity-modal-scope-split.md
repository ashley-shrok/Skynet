# Shape: Identity modal — role-scope and identity-scope split (with role-level wakeups)

**Opened:** 2026-09-04
**Vehicle:** GSD phase
**Sketch:** `.planning/sketches/001-identity-modal-role-vs-identity-split/` (variant D — Top Scope Switch, chosen)

## What this is

The identity modal — the panel that opens when you tap an identity's badge in a chat — is being reorganized so the two worlds it currently mixes together are visible as two worlds. Some of what the modal shows belongs to the role (shared across every identity of that role); some belongs to just this one identity. Right now those live in one flat strip of six tabs and you have to remember which is which. In the new shape, the modal has a Role view and an Identity view; you switch between them with one control at the top, and the tabs at the bottom change to match. A second thing the modal was missing is fixed at the same time: schedules that belong to the role — rather than to a specific identity — can now be listed, edited, added, and disabled from inside the Role view. Before this, those schedules had no interface at all, which was especially painful for coordinator identities whose only meaningful state is those role-level schedules.

## Shape

Open the modal on any identity. At the top, just under the modal title, sits a single two-position control: **Role** on the left, **Identity** on the right. Tap one, tap the other; it switches which view is showing. The view fills the middle of the modal, and the icon bar along the bottom shows only the tabs that belong to that view.

- **Role view** — shows things that belong to the role (shared across every identity holding it). Its tabs: the role's own description document, the shared list of active work items, the shared chronological log, and the role-scoped schedules.
- **Identity view** — shows things that belong to this specific instance of the role. Its tabs: this identity's own document, this identity's schedules, and this identity's where-we-left-off carry.

When the modal opens for an ordinary actor identity, it defaults to the Identity view (that's what the current modal effectively already does — identity file is the "you" view). When the modal opens for a coordinator identity — an identity that only routes and holds no actor state — it defaults to the Role view, because that's where its meaningful content lives.

Schedules are the load-bearing new capability: the schedules tab under Role view lists role-scoped schedules, lets you edit / disable / add them, and reads/writes the role's shared schedules folder on disk. The schedules tab under Identity view continues to do what it does today for this-identity-only schedules. Each schedule visibly wears its scope so you never confuse the two, and adding a new one from either tab lands it in the correct scope by construction.

## Philosophy

The redesign is about **legibility of scope**, not more features. The current flat six-tab strip works — you can reach everything — but it forces the reader to hold a mental map of "which of these six things is a role thing and which is a me thing." The scope switch makes that split explicit and hands the mental map to the UI. Two focused views, each smaller and cleaner, beat one blended view with everything on offer at once.

What this is deliberately doing:
- Making scope readable at a glance, not through label archaeology.
- Filling the role-scope schedule interface gap that has always been there and finally biting hard because coordinators exist.
- Letting coordinator identities render as what they actually are — a router, not a broken actor.

What this is deliberately not doing:
- Not showing role and identity content simultaneously (variant B/E were on the table, ruled out).
- Not moving to a left-side navigation (variant C — sacrifices the mobile-first bottom-bar language, which is already the chosen shape of the app).
- Not collapsing wakeups back to one tab with a scope picker — the scope split at the top is enough; each view gets its own dedicated schedules tab in its own scope, which is cleaner than a picker-in-a-tab.
- Not touching how the underlying files are stored, laid out on disk, or synced. That layer is fine; the modal just gains a second window into it.
- Not redesigning anything else in the pretty-view chat surface. Modal only.

What would violate the spirit of it even if it passed a test: any state where you're reading the modal and can't immediately tell whether the thing you're looking at is a role thing or an identity thing. That's the ONE failure mode this is designed to close; nothing that reintroduces the ambiguity ships.

## Prior context

The modal today has six tabs in one strip at the bottom of the modal (a Telegram-style icon bar chosen deliberately over other nav patterns because Skynet is iPhone-primary and bottom-bar wins mobile ergonomics). The tabs left-to-right are the role's document, the identity's document, the shared work list, the chronological log, the schedules, and the where-we-left-off carry. The schedules tab currently reads only from the identity's own schedules folder — role-scoped schedules aren't surfaced. That was fine before coordinator identities existed as a first-class thing; it's not fine now.

Coordinator identities were added later in the fleet substrate. A coordinator has no role document loaded, doesn't touch the shared work list in the normal way, has no meaningful where-we-left-off carry, and its ONE meaningful piece of state is the role-scoped schedules that fire on it (and get routed to picked actors). Open the current modal on a coordinator and five of six tabs are near-empty and the one tab that should carry its whole reason for existing is truthfully empty — "no scheduled wakeups" — because that tab reads the wrong folder.

Ashley pitched the redesign in-conversation as "divide the identity modal into role level and identity level." Five layout options were sketched (grouped strip, stacked sections, left rail, top scope switch, dashboard cards) and compared side-by-side with actor vs coordinator states. Variant D — top scope switch — was chosen.

Design system notes worth carrying:
- The modal's visual language is the pretty-view palette, not the general Skynet dark-mode tokens.
- Per-identity hue drives glass tints, selected-tab pill background, and mid-gradient surfaces.
- The bottom bar is a chosen shape (patch #191); this redesign keeps it and just changes what tabs live in it based on scope.

## What would make it wrong

- The scope split reads as "another decoration" — the reader can't tell just by looking whether they're in the Role view or the Identity view. If someone has to hunt for the selected state of the segmented control to know where they are, the whole point is lost.
- Role-scoped schedules and identity-scoped schedules bleed together — a role schedule appearing in the identity view or vice versa. The scope of each schedule must be inherent to which tab it's viewed and edited in.
- Coordinator identities open the modal and see MOSTLY empty regions with no explanation of why. The redesign has to make the coordinator case read as intentional — "you're looking at a router; there's nothing on the identity side because there isn't supposed to be" — not as broken.
- The switch has surprising memory. If tapping between two identities in quick succession loses the scope you were on, the switch becomes friction. Defaults + persistence for the switch have to feel like the app has been doing this all along.
- Any of the current modal's already-working behaviors (bounty search, archive lazy-load, live pinned-count invalidation, the inline title/avatar/hue/voice editors, staying-awake switch) regresses.
- The role-scope schedule editing surface is missing an obvious CRUD action (add, edit, enable/disable, delete) — parity with the identity-scope surface is expected, not aspirational.

## Scope edges

**In:**
- Segmented Role/Identity switch at the top of the modal body, above the current icon bar.
- Icon bar reshuffles based on selected scope: Role view = role file / bounties / history / role-schedules; Identity view = identity file / identity-schedules / handoff.
- Role-scope schedule listing, editing, add, enable/disable, delete — full parity with the existing identity-scope schedule surface, but reading/writing the role's shared folder.
- Coordinator identities default to Role view on open.
- Actor identities default to Identity view on open (matches current default behavior of the "identity" tab).
- Scope switch position is remembered across opens of the same identity within a session.
- Every schedule visibly declares its scope (existing badge design from the sketch works).

**Out:**
- Storage / on-disk layout of schedules (already correct; UI is catching up).
- Cross-role or cross-identity schedule browsing.
- Any redesign of the badge or the chat surface around the modal.
- Any redesign of the bounty card, history entry, or handoff renderers themselves.
- Changing which tabs exist WITHIN each scope beyond the split (the tab list per scope is fixed by what's on disk).

**Deferred:**
- Global schedule dashboard (view all schedules across roles/identities at once).
- Schedule scope conversion (move a schedule from identity-scope to role-scope or vice versa without recreating it).
- Coordinator dispatch history tab (would be a new artifact; not part of this shape).

**Tempting-but-no:**
- Dropping the coordinator-defaults-to-Role-view behavior in favor of a universal default. Every reasonable read of the coordinator case says default to Role; universalizing the default costs coordinators a click every time for no benefit.
- Adding a picker-in-tab as a fallback for anyone who preferred one tab with two scopes. The scope switch at top is the single mechanism; dual mechanisms confuse.
- Consolidating the two schedule tabs into one "Schedules" tab under a third top-level control. Two tabs, one per view, is cleaner and cheaper.
- Auto-collapsing scope-empty tabs to make the coordinator modal look less sparse. Empty-with-caption is more informative than hidden.

## Vehicle notes

**Vehicle: GSD phase.** Reasoning:
- New backend wire capability required (role-scope schedule read + CRUD paths, mirroring the existing identity-scope wakeup CRUD).
- New top-of-modal control + view-mode state + tab-list conditional derivation from that state — a real structural change to the modal, not a tweak.
- Coordinator branching adds a code-path fork worth planning explicitly.
- Existing modal has four test files (identity modal core, voice, role tab, stays-awake); at least two of them plus a new schedules-role-scope test are in the blast radius.
- Standing fleet directive: "If the work is phase-sized, the phase entry is table stakes, not a fork."

**Handoff to implementing agent:**
- The sketch is the design contract for layout. When the phase plan is drafted, ground the visual + interaction spec in `variant D` from `.planning/sketches/001-identity-modal-role-vs-identity-split/index.html`, not from a re-derivation.
- Palette + hue system already in use — no new tokens.
- Existing modal is a single ~2000-line file; the plan should either split it into sub-components as it lands the scope-switch structure OR keep the file whole and add the switch/reshuffle logic in place. Either is defensible; the planner picks based on what a plan-checker pass says about testability and blast radius.
- Coordinator detection already exists in the id skill (frontmatter `coordinator: true`). The modal will need to know this for the "default scope on open" behavior — the identity object surfaced to the modal today already carries enough to derive it, or a small addition to the identity API can carry the flag through cleanly.

**Next step:** `/gsd:phase` to add the phase to the roadmap, then `/gsd:discuss-phase` (which will pull this shape file straight in as CONTEXT), then `/gsd:plan-phase`, then `/gsd:execute-phase`. `/close identity-modal-scope-split` closes the arc at the end.
