# Shape: skill creation in the Edit Skills modal

**Opened:** 2026-09-17
**Vehicle:** GSD phase

## What this is

The Edit Skills modal today lets a user pick an existing skill on a host and
edit, add, or delete files within it — or delete the whole skill. It cannot
create a brand-new skill from scratch. This shape extends the modal so the
same surface covers the whole lifecycle: creating a new skill, filling in its
starter contents, and editing on. Along the way it moves the "add a file"
affordance from the header down to the tab strip where files actually live,
and hides the host picker when there is only one host to pick from.

## Shape

Three linked changes to one modal.

**A "New skill" button in the header, sitting after the skill picker.** Clicking
it walks the user through two prompts — a name, then a description. The name
is silently slugified into a canonical folder name; whatever the user typed
is treated as the source of the description. On success the host mints a
fresh skill folder containing a single SKILL.md sentinel file. The SKILL.md
body itself is empty; the file carries only frontmatter with the name and
description from the two prompts. The skill picker refreshes, auto-selects
the new skill, and the tab strip opens on the fresh SKILL.md ready to edit.

**The old "Add file" button leaves the header and becomes a "New file" tab
pinned to the right end of the horizontal tab strip at the bottom.** It looks
like a tab but behaves like an action — clicking it opens the same name prompt
that exists today, without ever becoming the selected tab. This is where the
new tab would appear anyway, so the affordance lives where the outcome lives.
The tab is present the moment a skill is picked, even before any files load,
so the affordance is consistent across empty and populated skills.

**The host picker hides itself when the user has exactly one host.** Today it
still shows, taking header space for a choice that has one option. The picker
should only appear when there is an actual choice to make.

Underneath all this, a rule the modal now enforces: **every skill has a
SKILL.md and it cannot be deleted through this surface.** New skills always
seed one. The delete-file affordance on the SKILL.md tab is hidden and the
underlying operation refuses. This applies forward-only — skills already on
the host that lack a SKILL.md are not migrated; they render whatever files
they have and can still land in the empty-body state.

## Philosophy

The modal is supposed to feel like one continuous canvas from "there is no
skill yet" through "this skill is ready." Every affordance lives near the
thing it affects: picking a skill is in the header, adding files lives in
the strip that shows files, chrome the user cannot use disappears rather
than sitting there greyed-out.

The SKILL.md-always-exists rule is a load-bearing floor, not decoration.
Skills are runtime-discovered by that sentinel file; a skill without one is
functionally broken. The modal is not a raw filesystem editor — it knows
what a skill is and preserves that invariant on the surfaces it touches.

Silent slugification reflects the same stance: the user thinks about the
skill in human words; the folder name is a machine concern the modal handles
without making the user see it.

## Prior context

The Edit Skills modal was built in Phase 44 as a byte-shape mirror of the
existing global-files modal, with an added skill dimension and horizontal
tab strip. Its scope comment explicitly names skill-creation-from-scratch
as out-of-scope for that cut. The backend router already has five endpoints
covering list/read/write/create-file/delete-file/delete-skill; the missing
piece is a create-skill endpoint that mints the folder plus the SKILL.md
sentinel.

The router already carries a two-layer path-safety gate — a strict skill-name
regex plus a post-compose prefix assertion — and a shell-escape helper for
every interpolation. Any new endpoint here inherits and extends that
posture; the skill-name gate governs whatever the client sends as the
slugified name.

Nginx config parity is a known trap from Phase 44 (patch #446 arc): both
the plain and TLS config files must carry matching location blocks, and the
same discipline applies to any route this shape adds.

A sibling global-files modal shares the header pattern that hides/shows
the host picker. That modal is outside this shape but the same
single-host-hides pattern would apply there if we want symmetry later.

## What would make it wrong

No deep philosophical failure mode — this is a straightforward additive
feature. The shallow ways it could go wrong are the usual ones for a
security-adjacent surface: a bad slugification collapsing to something the
name gate accepts but the filesystem doesn't like; a create-skill endpoint
that runs mkdir without inheriting the same two-layer path-safety gate the
rest of the router uses; the delete-file operation letting SKILL.md through
because the check was only on the frontend.

## Scope edges

**In.**
- New backend endpoint to create a skill folder plus SKILL.md with
  frontmatter carrying name + description.
- Backend guard on delete-file that refuses SKILL.md.
- Nginx config parity for the new route in both config files.
- Frontend New-skill button, chained name+description prompts, silent
  slugify, auto-select on success.
- Frontend New-file tab pinned to the right of the tab strip, replacing
  the header-level Add-file button.
- Frontend hides host picker when host list has exactly one entry.
- Frontend hides delete affordance on the SKILL.md tab.
- Tests covering new backend route (happy path, name gates, duplicate,
  path escape) and frontend behavior (button placement, chained-prompt
  flow, empty-description rejection, SKILL.md delete affordance hidden).

**Out.**
- Renaming a skill.
- Cloning or duplicating a skill.
- Template starter picker for new skills.
- Any marketplace / import / share flow.
- Retroactive migration of existing SKILL.md-less skills.
- Extending the single-host-hides pattern to the sibling global-files
  modal (worth a follow-up, not part of this shape).

**Deferred / tempting-but-no.**
- Upgrading the two-input prompt to a proper mini-dialog. The chained
  window.prompt is deliberately consistent with the existing add-file
  UX for now; a mini-dialog is a nicer future beat but not this shape.

## Vehicle notes

GSD phase. The work touches a net-new backend endpoint with security-gate
depth, nginx config parity across two files, frontend UI restructure with
new state transitions, and tests on both sides — phase-sized rather than
`/gsd:quick`. The auto-flow directive applies: once vehicle is picked,
`/gsd:discuss-phase` starts without a separate greenlight. Seed the
discuss-phase from this shape file rather than re-eliciting context.
