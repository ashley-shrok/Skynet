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
