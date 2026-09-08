# Shape: create-agent modal UX pass

**Opened:** 2026-09-07
**Vehicle:** GSD phase (execution DEFERRED — runs after `cosmetics-migrate-to-role` lands)

## What this is

A polish pass on the modal that opens when you create an agent — the "New agent" dialog. Three concrete surface changes: a two-sentence header blurb explaining what an agent is (paired with a matching new blurb on the create-role modal), an admin/non-admin split on the path field, and an admin/non-admin split on the identity-mode checkbox with inverted opt-out language. Six of the nine items originally sorted into this bounty either turned out to already work correctly (three), dissolve because they belong to a separate cosmetics-migration bounty carved out of this /open conversation (two), or belong to a separate per-Skynet-instance settings bounty (one).

## Shape

Three shipping surfaces:

- **Header blurb pairing.** Both modals grow a two-sentence blurb at the top of the dialog explaining, in vocabulary-paired language, what a role is and what an agent is. Role blurb: *"Roles are the expertise your agents adopt. Every agent using this role inherits its goals, rules, and knowledge."* Agent blurb: *"Agents are the workers you chat with. Each one adopts a role that shapes what they know and how they help."* The role side REVISES the compact one-sentence blurb shipped four hours earlier — same field, new text. The verb "adopt" is shared across both sides deliberately.

- **Path field admin split.** The Path input is admin-only. Admins see it and it pre-fills to the home directory shorthand, which they can override to any path. Non-admins do not see the field at all; the backend uses a per-agent working directory under the user's home, named after the agent, as the default.

- **Identity-mode checkbox admin split + label inversion.** The checkbox at the bottom of the modal that historically read "Create with new identity" (default checked) is only visible to admins now, and the label flips to *"Just a shell — no agent"* (default unchecked). Admins can still choose to spawn a raw shell or plain tmux session by opting out; non-admins never see the checkbox and are always spawning an agent. The inversion reflects that Skynet has evolved from a terminal app that gained agents into an agent app where a raw shell is the exception.

## Philosophy

The bounty is small on the wire but load-bearing on stance:

- **Non-admin users' interaction model with the fleet is "manage agents," full stop.** They don't get raw shell access as a first-class UX. Every session they can spawn is an agent with an identity and a role. If they need shell, an admin creates it for them.
- **The paired blurbs establish that role and agent are matched concepts, not just two things that happen to have similar-looking modals.** Every user seeing one modal will eventually see the other; the language on both sides has to reinforce the relationship, not describe two things in unrelated vocabulary.
- **The path default for non-admins isn't a UX shortcut — it's a scoping choice.** Giving every non-admin agent its own directory named after itself keeps agents from stepping on each other in a shared home and keeps the operator's home clean.

## Prior context

- The create-role modal shipped its own UX pass four hours earlier (Phase 84, at HEAD `dfa5929e`). Its header blurb, paired-copy pattern, admin-only path field pattern, and single-host-hide primitive are the anchors this bounty pairs with. This bounty is the sibling of that one.
- Nine items were originally sorted into this bounty from Ashley's UX-pass digest 2026-09-07. During /open discussion, verification against the current code revealed:
  - **Three items were already working correctly** and needed no work (role pre-fill from create-role chain — Phase 22 wired + tested; role picker existence — Phase 22 shipped, coherent with current model; hide-host-when-1 — Phase 84 shipped).
  - **One item was a spec collision** that pointed at a separate structural change: cosmetics (title, colorHue, voice, avatar) should migrate from identity-level to role-level with per-identity override semantics, matching how directives already work in the id skill. That's now its own upstream bounty.
  - **Two items dissolved** as a consequence of that migration (title field is removed from create-agent because cosmetics live at role level; Brief field is removed because its sole purpose was seeding avatar generation which also moves).
  - **One item — TTS speed multiplier — was mis-sorted;** it's a per-Skynet-instance settings concern with no natural home on either modal.
- The identity-mode checkbox behavior (whether/how it should be visible and required based on admin status) has philosophical roots in Skynet's history: it started as a terminal-only app and grew identity/agent semantics later. The checkbox default of "checked = identity mode" reflected the "identity is opt-in" era; the world is now inverted.

## What would make it wrong

- **Ship agent-side blurb without updating role-side blurb.** Phase 84's one-sentence blurb + this bounty's two-sentence blurb side by side is visible inconsistency to any user who opens both. The change MUST land as a paired update to both files.
- **Non-admin sees the "Just a shell" checkbox.** The whole point of the split is that non-admins cannot bypass the identity gate. If plumbing of `isAdmin` fails and the checkbox renders for non-admins, the modal has leaked shell access. **Fail-closed:** default `isAdmin` prop to `false` when not passed.
- **Non-admin sees the Path field.** Same asymmetric risk shape as above; non-admins configuring their own path defeats the "each agent gets its own working directory" scoping.
- **This bounty ships BEFORE `cosmetics-migrate-to-role`.** Items removed from the modal (title, brief) can only be removed if their content has a home at the role level. Executing this bounty out of order strands users with an agent-modal that has no title/description/avatar fields and no role-side place to configure those either.
- **Executor gets clever and tries to keep the `identityMode` variable name but only flip the checkbox default.** If a downstream test or reader interprets `identityMode === true` as "checkbox is checked," semantics-vs-UI drift becomes a permanent trap. Either rename the variable or write a comment that pins the invariant.

## Scope edges

**In:**
- `CreateRoleDialog.tsx` blurb text change (revising the Phase-84-shipped one-sentence blurb to the new two-sentence one).
- `NewSessionDialog.tsx` changes: header blurb added; Path field admin-gated; identity-mode checkbox admin-gated + label inverted + default unchecked; Title field REMOVED; Brief field REMOVED; cosmetic pickers (color / voice / avatar) REMOVED (all conditional on `cosmetics-migrate-to-role` landing first).
- Prop plumbing to pass `isAdmin` from `PrettyConversationsPanel` into `NewSessionDialog`.
- Backend change to accept an empty/absent path in the birth payload and substitute `~/<agent-name>/` for non-admin submits (or equivalent — executor decides whether the default lives frontend-side or backend-side).
- Test updates to reflect the checkbox flip and the admin-conditional rendering.

**Out (moved to other bounties):**
- **Cosmetics migration itself** — title, colorHue, voice, avatar frontmatter fields moving from identity to role level with override semantics. Own bounty (`cosmetics-migrate-to-role`), upstream dependency.
- **TTS speed multiplier** as per-Skynet-instance config. Own bounty (`tts-speed-multiplier-per-instance`).
- **Agent working-directory auto-creation timing** (whether the backend `mkdir`s the working dir at birth vs lazy on first write). Whatever the current behavior is, stays.
- **Any rename of the `identityMode` state variable** — pure executor implementation detail.
- **The task-input textarea** (already added in Phase 80, out of scope).

**Deferred:**
- The whole bounty's execution is deferred until `cosmetics-migrate-to-role` lands.

**Tempting-but-no:**
- Adding a per-agent "description" or "notes" field on create-agent to replace the removed Brief. Ashley didn't ask for one; if it turns out to be needed later, it's a separate bounty.
- Renaming the modal from "New agent" to something else. Phase 84 already conformed the title; no re-open.
- Making the checkbox label something more clever than "Just a shell — no agent." Ashley greenlit that specific text.
- Adding an "Override cosmetics for this identity" affordance on create-agent as a per-identity opt-out. Post-cosmetics-migration, per-identity overrides are done via the identity modal after creation; the create-agent modal stays lean.

## Vehicle notes

**Vehicle:** GSD phase, execution **DEFERRED**.

**Why deferred:** Items #4 and #5 dissolve because cosmetics move to role level, and that migration is its own bounty upstream in the campaign. Executing THIS phase before `cosmetics-migrate-to-role` lands would strand the modal in an inconsistent state (title/brief fields removed here with no role-side home).

**Execution order** (Ashley's standing UX-pass campaign, reshuffled 2026-09-07 during this /open):
1. ~~`create-role-modal-ux-pass`~~ — DONE (Phase 84, at HEAD `dfa5929e`).
2. **`cosmetics-migrate-to-role`** — NEW upstream bounty, first up in the next `/build`.
3. **`create-agent-modal-ux-pass`** — THIS BOUNTY, third in order.
4. `clone-modal-ux-pass` — also benefits from #2 landing first (clones inherit from role).
5. `runbooks-formal-concept`.
6. `identity-modal-tab-restructure` — semantics of cosmetic fields shift to "override of role default"; benefits from #2.
7. `composebox-buttons-and-queue-tab-redesign`.
8. `global-file-agents-may-edit-on-permission`.

**Standing rule (Ashley 2026-09-07 verbatim, holds across the whole campaign):** *"after each build for this plan, you're going to reset yourself and then invoke the next build on the next bounty at the start of the next session."* Plus the campaign constraint: no full test suite, no docker build, no docker cp, no `docker compose up`, no deploy until ALL remaining bounties in the campaign are done. Push + scoped tests only per bounty.

**Ashley delegated to tabitha (2026-09-07 verbatim):** *"you're in charge of making sure that we continue with the plan and these bounties go in the right order."*

**Identity in charge:** tabitha (box-maintainer on t1000).

**Working tree:** `~/skynet-tabitha` on branch `feat/tab-title-from-tmux`.

**Handoff for the executor when it runs:** Read this shape file, then read the sibling shape at `.planning/shapes/shape-create-role-modal-ux-pass.closed.md` for the Phase 84 patterns to pair against. Also read the yet-to-be-written `.planning/shapes/shape-cosmetics-migrate-to-role.md` when that bounty is /opened — it will establish the exact fields removed from create-agent that this bounty finalizes the UI for.
