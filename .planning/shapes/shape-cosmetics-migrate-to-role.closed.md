# Shape: Cosmetics migrate from identity level to role level

**Opened:** 2026-09-07
**Vehicle:** GSD phase

## What this is

The four visible/audible traits an agent shows — its subtitle line, its color hue, its speaking voice, and its avatar image — currently live on each individual identity. This build moves them one level up: those four traits become defaults defined at the role level, and each identity may optionally override any of them. An identity that leaves its face unset wears its role's face; an identity that sets a value wears that instead. This makes cosmetics consistent with how directives and preferences already inherit through the substrate (role defines the baseline, identity narrows it) instead of being the one axis that stays per-identity.

## Shape

Four surfaces move together:

**The role file** gains a section for the four cosmetic values. It becomes the source of truth for what an agent of that role looks and sounds like by default. The avatar for a role is one shared image sitting alongside the role file, and every identity of that role picks it up automatically.

**The identity file** may still carry any of the four cosmetic fields, but their meaning changes from "this is my face" to "this is the face I picked instead of my role's default." An identity that leaves any field empty inherits from the role.

**The role-creation flow** grows a set of cosmetic controls — a color picker, a voice picker, an avatar generator with preview — because that flow is now where the family face gets defined. Someone creating a new role fills out the face for it in that moment.

**The agent-creation flow** (creating a new identity of an existing role) loses those same controls entirely. The face is already answered upstream. A newly-created agent just wears its role's face on landing.

**The identity-editing flow** keeps face controls, but each field wears a state badge. When a field is unset, the field shows a ghosted "inherited from role: <value>" so the wearer can see what they're currently displaying. When a field is set, the field carries a "revert to role default" affordance so the wearer can undo the override without hunting for the role's value. Two states per field, explicit both ways.

Two documents move alongside the code:

**The id-skill spec document** in the substrate updates to describe the new inheritance model — role-level cosmetic defaults, identity-level optional overrides, the exact same shape as how directives already work.

**The avatar-generation runbook** loses the step about uploading generated avatars to a Matrix homeserver — that step is no longer accurate and has been stale for a while.

## Philosophy

Cosmetics should behave like every other trait an agent inherits from its role: role defines the baseline, identity narrows it. Today they're the exception — cosmetics are the one axis that stays per-identity by default, forcing hand-configuration on every clone and letting siblings drift apart accidentally. Fixing that isn't inventing a new pattern; it's removing an inconsistency.

The override direction stays voluntary. An identity that wants to look and sound like its siblings does nothing. An identity that wants to look different for a real reason (a specialty, an intentional visual mark) fills in the override and it wins. Neither shape gets in the other's way.

Explicit is preferred over implicit for the edit surface. The wearer of an identity should always be able to see, at a glance, which cosmetic values are their own versus which they got from the role — and reversing either direction should be one action, not a hunt through documentation.

## Prior context

Every identity in the fleet today carries its own hand-generated cosmetics — subtitle, hue, voice, avatar file. When a new identity gets cloned off an existing one, either the operator re-generates all four by hand (tedious for a family that's meant to look and sound alike) or the identity inherits the seed's values in the moment but drifts away the first time anything gets touched. The role-level move is the fix.

This bounty was carved out during an earlier /open on the agent-creation modal, where it became clear that trying to redesign that modal without first moving cosmetics upstream would either duplicate work or bake in the wrong model. The other bounties that follow in the campaign — the agent-creation modal redesign, the clone-modal redesign, the identity-modal tab restructure — all depend on cosmetics already living at role level before they land.

## What would make it wrong

- If an identity that sets no cosmetics ends up wearing something other than its role's face. The whole point is default fall-through; missing that misses the point.
- If setting a cosmetic value on an identity fails to override the role's default. Overrides are the second half of the model; if they don't work, the model doesn't work.
- If the identity-editing surface leaves the wearer unable to tell whether a given cosmetic field is inherited or overridden. The explicit-state guarantee is load-bearing to the shape.
- If reverting an override requires editing the identity file by hand — the affordance in the edit surface is part of the deal.
- If the build somehow forces migration on existing identities (auto-wiping frontmatter, auto-lifting values to role level). Migration is manual and belongs to whoever deploys.
- If the spec document and the runbook don't update alongside the code — future maintainers reading the stale docs will believe the old model still holds.

## Scope edges

**In:**
- Role-file cosmetic fields (subtitle, hue, voice, avatar) as defaults.
- Backend loader that reads role cosmetics and overlays identity cosmetics.
- Role-creation flow grows cosmetic controls.
- Agent-creation flow loses cosmetic controls.
- Identity-edit flow gains explicit inherited/override affordances.
- Test coverage updated to match all four surface changes.
- Substrate id-skill spec document updated.
- Avatar-generation runbook updated (Matrix upload step removed).

**Out:**
- Migration of existing identity cosmetics to role level. Whoever deploys handles by hand — this build ships the mechanism, not the data motion.
- Any change to the identity's display-name field — that stays per-identity always (it IS the per-identity name).
- Redesign of the agent-creation modal, the clone modal, or the identity-modal tab structure — those are separate bounties in the campaign lineup that depend on this landing first.
- Fall-through-when-role-has-no-cosmetics — the flows enforce that roles always carry cosmetics, so there is no empty case to solve.

**Deferred / tempting-but-no:**
- Per-identity avatar generation within a role-defined style. Tempting for a family that wants sibling variation, but out of scope: one shared image per role.
- Auto-lift-first-identity's-values-to-role-level during deploy. Manual work; sits with the deployer.
- Any redesign of the color picker, voice picker, or avatar generator components themselves — reuse what already exists.

## Vehicle notes

**GSD phase.** Touches the id-skill spec, backend loader, two dialog surfaces, one edit surface, tests across those, and two role-owned documents (spec + runbook). Wants real planning before execution, and the standing fleet rule is that phase-sized work gets a phase — this qualifies. This shape file seeds the discuss-phase context document directly, and per the fleet rules the vehicle-pick → discuss-phase transition auto-proceeds without another greenlight.

Push + scoped tests only during the campaign — the ship gate lives at the end of ALL remaining campaign bounties, not per-bounty. No docker build, no docker cp, no deploy off this bounty. This bounty is #1b in the reordered lineup; the next one after this is the agent-creation modal redesign (shape already written, execution deferred until this lands).

---

## Close-Out

**Closed:** 2026-09-08
**Vehicle used:** GSD phase (86-cosmetics-migrate-to-role) — 7 plans, push-only per campaign constraint
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is — four cosmetic traits move from identity to role as defaults with per-identity overrides** — partial · Model is present end-to-end for title/voice/color; avatar move is present for defaulting and inheritance but the override-revert direction is one-way (can set, cannot clear via UI)
- **Shape — role file gains cosmetic section as source of truth** — present · Role frontmatter carries the four fields; role folder holds one shared avatar image; every identity of the role picks it up
- **Shape — identity file may still carry the four fields; unset inherits, set overrides** — present · Per-field identity ?? role ?? null merge landed in publicIdentity's fifth arg with per-host role-cosmetics memoization
- **Shape — role-creation flow grows cosmetic controls (color, voice, avatar generator with preview)** — present · CreateRoleDialog gained Title input, VoicePicker, ColorPicker, and inlined avatar generator + upload + 3-candidate carousel; all four required to submit
- **Shape — agent-creation flow loses cosmetic controls** — present · NewSessionDialog identity-mode stripped of title, brief, voice, color, avatar generator; birth stream passes null for the four cosmetic fields
- **Shape — identity-editing flow keeps face controls, each field wears a state badge (inherited-from-role or revert-to-role-default)** — partial · Warm "Inherited" chip + cool "Revert" button render for all four fields, but the avatar Revert click is a wire-only no-op — the backend PUT drops meta.avatar and the identity's own avatar stays sticky
- **Two docs — substrate id-skill spec doc updates to describe the new inheritance model** — present · id-skill-handoff.md added a Cosmetic-frontmatter section describing role defaults, identity overrides, per-field identity ?? role ?? null, and delete-to-revert semantics
- **Two docs — avatar-generation runbook loses the Matrix homeserver upload step** — present · avatar-flow.md has no Matrix upload step and gained a Post-Phase-86 note explaining when to omit identity-level cosmetics so the role's face wins
- **Philosophy — cosmetics behave like every other trait inherited from the role** — present · Same identity ?? role ?? null pattern used elsewhere in the substrate
- **Philosophy — override direction stays voluntary** — present · Identity that leaves cosmetics empty inherits from the role; identity that sets a value wins; explicit-null in PUT translates to frontmatter-key delete for title/voice/color
- **Philosophy — explicit-over-implicit on the edit surface, one-action reversal in both directions** — partial · Inherited + Revert visual chips are explicit for all four fields; but reversal is one-action for title/voice/color and hand-edit-only for avatar due to the backend gap
- **Prior context — bounty carved out of the create-agent-modal-ux-pass /open, dependency for downstream campaign bounties** — present · Campaign lineup preserved; this is item 1b as agreed
- **What would make it wrong — identity that sets no cosmetics ends up wearing something other than its role's face** — present · publicIdentity merge and GET /:key/avatar role-folder fallback both cover the default fall-through; identity-birth omits cosmetic keys when no override supplied
- **What would make it wrong — setting a cosmetic value on an identity fails to override the role's default** — present · identity ?? role ?? null merge puts identity presence ahead of role, including numerically-identical values
- **What would make it wrong — identity-editing surface leaves the wearer unable to tell whether a field is inherited or overridden** — present · Warm Inherited chip vs cool Revert button, both aria-labelled, render per-field in the edit block
- **What would make it wrong — reverting an override requires editing the identity file by hand** — missing · Confirmed unintentional gap — avatar Revert is a wire-only no-op; the backend PUT's IdentityMetadata type omits avatar so the identity's avatar frontmatter key is never deleted; the wearer still has to hand-edit the identity file to shed an avatar override
- **What would make it wrong — build forces migration on existing identities** — present · No auto-lift, no auto-wipe, no warning prompts; migration stays with whoever deploys per Ashley 2026-09-07
- **What would make it wrong — spec document and runbook don't update alongside the code** — present · Both role-owned docs updated in the same phase
- **Scope edges IN — role-file cosmetic fields as defaults** — present · title, colorHue, voice, avatar all optional in role frontmatter; role file without cosmetics still works
- **Scope edges IN — backend loader reads role cosmetics and overlays identity cosmetics** — present · readRoleFileByName + extractCosmeticsFromFrontmatter applied to role markdown; per-host memo prevents duplicate role reads across siblings
- **Scope edges IN — role-creation flow grows cosmetic controls** — present · CreateRoleDialog authoring surface
- **Scope edges IN — agent-creation flow loses cosmetic controls** — present · NewSessionDialog identity-mode stripped
- **Scope edges IN — identity-edit flow gains explicit inherited/override affordances** — partial · Visuals landed for all four fields; behavior complete for three (title/voice/color) and stubbed for avatar
- **Scope edges IN — test coverage updated across all four surface changes** — present · role-cosmetics + role-file + roles-create + identity-birth + identity-birth-orchestrator role-frontmatter + identities put-disk/get-disk + IdentityModal inherit-override + CreateRoleDialog + NewSessionDialog all covered
- **Scope edges IN — substrate id-skill spec doc updated** — present · id-skill-handoff.md updated
- **Scope edges IN — avatar-generation runbook updated (Matrix upload step removed)** — present · avatar-flow.md has no Matrix step
- **Scope edges OUT — migration of existing identity cosmetics** — present · No auto-migration code; deployer handles by hand
- **Scope edges OUT — displayName stays per-identity** — present · displayName excluded from the merge in publicIdentity; documented in id-skill-handoff.md
- **Scope edges OUT — redesign of the agent-creation, clone, or identity-modal tab structure** — present · Dialog structure unchanged beyond adding/removing the cosmetic control blocks; no tab restructure
- **Scope edges OUT — fall-through-when-role-has-no-cosmetics as a designed scenario** — present · CreateRoleDialog requires all four cosmetic fields to submit; empty-role-cosmetics remains a defensive backstop only
- **Deferred — per-identity avatar generation within a role-defined style** — present · One shared image per role; no per-identity variation surface
- **Deferred — auto-lift-first-identity's-values-to-role-level during deploy** — present · Not implemented; manual
- **Deferred — redesign of ColorPicker, VoicePicker, or avatar generator components** — present · Existing ColorPicker + VoicePicker reused as-is; avatar generator inlined in CreateRoleDialog per planner's discretion

### Additions (in the result, not in the shape)

None.

### Follow-ups

- identity-avatar-revert-completes-end-to-end — extend the backend PUT /identities/:key handler to accept meta.avatar = null (add avatar to IdentityMetadata + a delete branch in the overlay + hard-delete of the identity's avatar sibling file) so the IdentityModal's avatar Revert affordance completes end-to-end and no longer requires hand-editing the identity file — bounty

### Notes

The three-of-four completeness of the Revert affordance is a consequence of a single missing backend branch — the frontend wire already sends meta.avatar = null on click and the JSON.parse pass-through silently drops it because IdentityMetadata omits the avatar field. The 86-05 SUMMARY flagged this explicitly as a threat/partial-delete-semantics flag but the fix was deferred to a future backend patch and never scheduled. The follow-up bounty is small (add avatar?: string | null to IdentityMetadata, one overlay branch handling null-as-delete for the avatar key, one hard-delete of the sibling file, colocated test) and lands before the campaign's ship gate so the shape's revert-in-one-action guarantee is intact when the whole campaign deploys. Also worth carrying forward: the substrate id-skill-handoff.md now documents the delete-to-revert convention (absence = inherit, presence = override) — that convention becomes the reference contract when the backend gap gets closed. The avatar-flow.md runbook's Post-Phase-86 note about when to omit identity-level cosmetics is a nice pattern for future doc updates that need to reflect model shifts without rewriting the whole runbook.
