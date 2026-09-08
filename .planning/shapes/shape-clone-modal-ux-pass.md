# Shape: clone-modal-ux-pass

**Opened:** 2026-09-08
**Vehicle:** GSD quick

## What this is

Retirement of the separate clone modal. Instead of a distinct dialog for
"make an agent shaped like this one," the row context menu becomes a
shortcut into the existing new-agent modal with the source row's role
pre-filled. One less modal in the app, one less place for UX to drift.
The context-menu label rename that was already on the bounty — "Clone"
becoming "create new agent under this role" — is now the whole of the
user-visible surface change, because the modal it used to open no
longer exists.

## Shape

Two shipping surfaces, both small:

- **The clone modal goes away.** The dialog that opened when you picked
  "Clone" from a row's right-click menu is deleted outright, along with
  its scoped tests. Its data path was a subset of what the new-agent
  flow already supports, so nothing on the backend needs replacing —
  the create endpoint stays as it is.

- **The row context-menu item is relabeled and rewired.** Where the
  menu used to read "Clone" and open the retired dialog, it now reads
  *"create new agent under this role"* and opens the existing new-agent
  modal. The modal opens with the role picker pre-filled to the source
  row's role. Everything else about the modal — the title/header text,
  the name field's default behavior, the admin-only path split, the
  admin-only identity-mode checkbox, cosmetics inheritance from role
  with per-identity overrides — behaves identically to when the modal
  opens from the plus-button flow. The pre-filled role is the only
  visible signal that the modal was arrived at via context menu.

Nothing else in the sibling `create-agent-modal-ux-pass` bounty is
touched here — that bounty owns the new-agent modal's own UX pass and
ships separately.

## Philosophy

- **Post-cosmetics-migration, "clone" and "new-under-this-role" are
  the same operation.** The only thing that ever meaningfully differs
  between two agents under the same role is the agent's own name;
  everything else is inherited from the shared role with per-identity
  overrides layered on afterward. A separate clone modal was a relic
  of the era when cosmetics lived on the identity; now that they
  don't, the two flows have converged into one, and the app should
  reflect that.
- **The user-visible entry point stays.** People still want to be
  able to right-click an existing agent and say "make me another
  one like this." That mental model is fine; we're just refusing to
  build a whole separate dialog to serve it when a pre-fill on the
  existing dialog is enough.
- **No override carry-over from source to target.** A cloned-in-the-
  colloquial-sense agent starts at role defaults. If the user wants
  the new agent to visually match the source's per-identity overrides,
  they set those overrides afterward via the identity modal. Carrying
  them over silently would re-create the "clone is different from
  new" distinction we're deleting.
- **Same rows, same placement, same behavior model.** The context menu
  item is a pure label + wiring swap on the exact rows the old "Clone"
  item lived on. Not adding it to new row types, not gating it
  differently, not moving it around in the menu order.

## Prior context

- Bounty parked 2026-09-07 from Ashley's UX-pass digest as a small
  polish pass on the clone modal itself (strip "host" from the top
  description, remove the name-field placeholder, apply the admin-only
  path split from the sibling create-agent bounty, plus the context-
  menu label rename).
- Phase 86 (cosmetics-migrate-to-role) shipped push-complete this
  morning. That migration moved title, colorHue, voice, and avatar
  from identity-level to role-level with per-identity override
  semantics. It is the reason the bounty's shape shifts here from
  "polish the clone modal" to "retire the clone modal": every field
  the clone modal used to author lives on the role now, so there is
  nothing meaningful for the clone modal to do that the new-agent
  modal can't do with a role pre-fill.
- The three modal-side polish todos on the bounty (strip "host,"
  remove name placeholder, admin-only path) evaporate on their own
  once the modal is deleted — the blurb, placeholder, and path
  field belonged to a modal that no longer exists. The admin-only
  path split is already being done by the sibling bounty on the
  new-agent modal, so the flow gets that behavior for free once it
  routes through there.
- The sibling `create-agent-modal-ux-pass` bounty is shaped and
  deferred (execution waits on `cosmetics-migrate-to-role`, which
  is now landed, so it is executable in the campaign order).
  Sibling shape at `.planning/shapes/shape-create-agent-modal-ux-pass.md`.
- Ashley confirmed 2026-09-08: the row context menu is the only
  entry point into the current clone flow. No hover-button, keyboard
  shortcut, or other affordance also opens the clone modal.

## What would make it wrong

- **Deleting the clone modal but leaving a stale entry point anywhere.**
  If any button, menu item, keyboard shortcut, or link still routes
  to the retired dialog, the user hits a dead affordance. Every
  reference — including test scaffolding and translated strings — has
  to go with the modal.
- **The pre-filled role differs from the source row's role.** If the
  wiring picks the wrong role — a parent role, a default role, the
  currently-logged-in-user's role, empty — the whole point of the
  entry point is lost. The role that gets pre-filled is exactly the
  role of the row that was right-clicked, no substitution.
- **The pre-filled role is locked / disappears / behaves differently
  from a plain plus-button role selection.** The picker stays visible
  and stays editable; the user can change it before submitting if
  they want to. Any behavioral difference between "pre-filled from
  context menu" and "picked manually in plus-button flow" leaks the
  entry point into the modal's semantics, which is exactly what
  this bounty is deleting.
- **Silent carry-over of the source's per-identity cosmetic overrides
  into the new agent.** New agent starts at role defaults; no override
  copy-paste. If a future user asks for override carry-over, that's a
  new decision, not a bug to fix.
- **The modal's title/header/copy changes based on entry point.** The
  agreement is that the two entry points produce an identical modal
  experience aside from the pre-filled role. "New agent under <role>"-
  style header text was considered and rejected.

## Scope edges

**In:**
- Delete the clone modal source file and its scoped tests.
- Update the row context menu: relabel the item from "Clone" to
  "create new agent under this role," and change its action to open
  the new-agent modal with the source row's role pre-filled.
- Grep the codebase for any lingering references to the retired
  modal (imports, dynamic loads, string labels, tests, docs) and
  remove or update each one.
- Scoped tests covering the context-menu action: label reads
  correctly, click opens the new-agent modal, the role picker
  arrives pre-filled with the source row's role, the picker
  remains editable, submitting produces an agent whose role matches
  the picker's current value.

**Out (belongs elsewhere):**
- The sibling `create-agent-modal-ux-pass` bounty's own UX pass on
  the new-agent modal (header blurb, admin-only path split, admin-
  only identity-mode checkbox with inverted label). Ships separately
  in its own execution.
- Any change to the new-agent modal itself beyond making it
  accept a pre-filled role from this entry point. If pre-fill
  already works via the existing role-picker default mechanism,
  no modal-side change is needed at all.
- Backend changes to the create endpoint. The endpoint already
  supports every field the new-agent modal submits; retiring
  the clone modal removes callers, adds none.
- Any override carry-over from source to target agent.

**Deferred:**
- Nothing. The bounty ships whole in this build.

**Tempting-but-no:**
- Adding a visual hint that the role was pre-filled (a subtle
  highlight, an "auto-filled from <source>" tag). The agreement is
  that the pre-filled modal is indistinguishable from a manually-
  picked one aside from the initial picker value.
- Auto-suggesting the source agent's name plus a suffix (e.g.
  "vicky-2") in the name field. Whatever the new-agent modal does
  today for its name field, keep it. Introducing a "clone-flavored"
  name suggestion re-creates the mental model we're deleting.
- Extending the context menu item to row types it didn't live on
  before (role-header rows, group rows, etc.). Pure label + wiring
  swap on the exact same placement.
- Renaming the context-menu item to something more descriptive
  than "create new agent under this role." Ashley greenlit that
  specific text.

## Vehicle notes

**Vehicle:** GSD quick.

**Why this vehicle:** The work is a subtraction (delete the modal
+ its tests) plus a small re-pointing (context menu label + action).
GSD quick gives atomic commits so the delete and the rewire land as
separately reviewable steps, plus state tracking, without the full-
phase ceremony that would be overkill for the size. GSD phase would
be more than this needs; inline would leave the two changes as one
undifferentiated commit.

**Campaign constraint (holds across the whole UX-pass campaign,
Ashley 2026-09-07 verbatim):** push + scoped tests only per bounty;
no full test suite, no docker build, no `docker cp`, no
`docker compose up`, no deploy until ALL remaining bounties in the
campaign are done. The ship gate lives at the end of the campaign,
not per-bounty.

**Standing rule (Ashley 2026-09-07 verbatim):** *"after each build
for this plan, you're going to reset yourself and then invoke the
next build on the next bounty at the start of the next session."*

**Ashley delegated to tabitha (2026-09-07 verbatim):** *"you're in
charge of making sure that we continue with the plan and these
bounties go in the right order."*

**Campaign order (post-Phase-86, remaining):**
1. ~~`cosmetics-migrate-to-role`~~ — DONE (Phase 86, shipped push-
   complete 2026-09-08).
2. **`clone-modal-ux-pass`** — THIS BOUNTY.
3. `create-agent-modal-ux-pass` — sibling; shaped, ready to run
   after this or in parallel.
4. `runbooks-formal-concept`.
5. `identity-modal-tab-restructure` — also the natural home for
   the role-cosmetic-edit UI deferred out of Phase 86.
6. `composebox-buttons-and-queue-tab-redesign`.
7. `global-file-agents-may-edit-on-permission`.

**Also pending before campaign ship gate** (not in the ordered
sequence but must land before ship): (a) `identity-avatar-revert-
completes-end-to-end` — small backend patch flagged by Phase 86
/close; (b) `role-avatar-filename-regex-tightening` — defense-in-
depth from Phase 86 code review.

**Identity in charge:** tabitha (box-maintainer on t1000).

**Working tree:** `~/skynet-tabitha` on branch `feat/tab-title-from-tmux`.

**Handoff for the executor when it runs:** Read this shape file,
then read the sibling shape at `.planning/shapes/shape-create-agent-
modal-ux-pass.md` for the new-agent modal's shape as the sibling
bounty will land it — that sibling is what defines the modal this
bounty's context menu now routes into. Also worth a look: the
Phase 86 shape at `.planning/shapes/shape-cosmetics-migrate-to-
role.closed.md` for why "clone" and "new-under-this-role" have
converged into one operation.
