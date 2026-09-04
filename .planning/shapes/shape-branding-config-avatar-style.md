# Shape: control style of avatar generation through branding config

**Opened:** 2026-09-04
**Vehicle:** GSD phase

## What this is

The branding config for a Skynet instance gains carrying capacity for aesthetic control over how avatars are generated. Currently every instance produces avatars in the same fleet-locked MOBA-champion / LoL-splash aesthetic, hardcoded in the app's avatar-generation pipeline. This build turns the aesthetic into a per-instance branding decision so a differently-branded deployment — say, a soft corporate world — can produce avatars that belong to its world instead of the founding fleet's aesthetic.

## Shape

The app's existing avatar-generation pipeline works in two stages: a chat model drafts an image-generation prompt from a shipped-in "aesthetic director" spec, then that drafted prompt gets sent to an image model three times in parallel. The director spec is currently a fixed constant in the code. This build moves it into the branding config as a required field. A companion numeric field carries the post-generation gamma default so aesthetics with different tonal needs can request more or less lift.

The palette-constraint mechanism, which currently mixes a mechanical hue-to-color-name fact with aesthetic instructions about how to use that hue, gets split: the mechanical fact stays app-owned and always gets injected when a hue is set; the instruction language moves into the director spec where the branding author owns it.

The instance refuses to boot if the aesthetic director spec is missing or empty. No silent fallback, no shipped-in default. Existing deployments get seeded with the current LoL-champion spec as part of the ship migration so no one's boot breaks. The manual avatar-generation runbook file gets deleted — everything in it is either duplicated in the app or intentionally retired.

## Philosophy

- The aesthetic belongs to the instance's world, not to the app.
- Trust the admin who writes the branding config. Presence check only, no content validation.
- No silent fallbacks. If the config is missing something the app needs, the app refuses to run rather than picking for the admin.
- The app owns mechanics. The config owns instructions. Where they mix today (the palette-constraint line), split them.
- File-only edit path. No settings UI. Aesthetic director specs get iterated on rarely, once per instance-world; a UI would be premature.

## Prior context

- The manual avatar-generation runbook was developed 2026-07-09 across ~6 hours with Ashley. Locked in the fleet aesthetic (MOBA-champion / LoL-splash portraits) and the 0.7 gamma default.
- The functionality was moved into the app a while ago and now runs as a batch endpoint: chat-model archetype draft → three parallel image-model calls → gamma lift → candidate cache → user pick.
- The director spec currently lives as a fixed constant in the backend, embedding the LoL-champion aesthetic. The runbook file has stayed on disk as reference only and is scheduled for deletion as part of this ship.
- A branding config already exists (from tiffany's earlier feature work); this build extends its schema.
- Two production deployments exist: this box (Skynet on t1000) and Stacy's box (AI+ on T800). Both need the migration seed committed to their branding configs at ship time or neither boots.

## What would make it wrong

- If any existing deployment refuses to boot after the ship because its branding config wasn't seeded with the aesthetic director spec. The migration seed has to be atomic with the code change.
- If a differently-branded instance still ends up producing MOBA-champion avatars because some part of the aesthetic language remains hardcoded outside the config. The split of the palette-constraint line is the load-bearing check here.
- If someone can create a valid-looking branding config that passes the presence check but produces nonsense avatars silently — trust-the-admin means we DON'T guard against this, but if the presence check ends up so loose (e.g. whitespace-only string passes) that it accepts obviously-broken input, the guardrail has missed its point.
- If the manual runbook file's deletion loses something that's still needed. Ashley confirmed all its outrigger content is retired, but a scope-check during execution should re-verify nothing has quietly become live-again.
- If the aesthetic director spec ends up read at avatar-generation time from a source other than the branding config (e.g. still falling back to the constant in code as a "just in case"), a stale fallback silently defeats the whole point.

## Scope edges

**In:**

- Add aesthetic director spec field (free text, required) and gamma default field (numeric, optional with a shipped fallback) to the branding config schema.
- Add boot-time validation on the aesthetic director spec: presence check only, refuse to boot if missing or empty.
- Wire the avatar-generation batch endpoint to read both fields from the branding config at request time instead of using hardcoded values.
- Split the palette-constraint line: mechanical hue-to-color-name fact stays app-owned and always-injected; instruction language moves into the seed director spec.
- Seed both existing deployments' branding configs (this box and the AI+ box) with the current LoL-champion director spec as part of the ship migration, so no boot breaks.
- Delete the manual avatar-generation runbook file and its associated per-identity prompt archive files from the local box's role folder.

**Out:**

- Any UI affordance for editing the aesthetic director spec. File-only edit for this ship.
- Model swappability for the drafter chat model or the image model. Both stay hardcoded.
- Content validation on the director spec beyond presence. No length checks, no forbidden-content filters, no prompt-injection guards.
- Any change to the Nelly handoff / Matrix media upload flow (retired with the runbook).
- Any change to the birth flow's colorHue picking (already app-side).

**Deferred:**

- A settings-panel UI for editing the aesthetic director spec, if it ever earns its keep.
- Model swappability, if a future need surfaces.
- Any per-user or per-namespace scoping of aesthetic control (branding config is per-instance).

**Tempting-but-no:**

- Shipping a shipped-in default director spec for missing-config resilience. Explicitly rejected — silent fallback defeats the point.
- Multiple named preset aesthetics (LoL-champion, corporate-soft, line-illustration, etc.). Free-text is the chosen shape; presets would over-engineer for capacity we don't have signal for.
- A structured multi-axis aesthetic (medium, palette-family, posture, etc.). Free-text is the chosen shape.

## Vehicle notes

- Vehicle is a GSD phase. Recommended by /build's execution-path directive because there are five coordinated pieces (schema extension, backend presence-check, boot-time validation, migration seed committed into both deployments' branding configs, runbook file deletion) and the failure mode is "both Skynet instances refuse to boot on deploy" — worth the plan + verify structure.
- Next step: `/gsd:phase add` to slot the phase into the roadmap, then `/gsd:discuss-phase` (auto-proceeds per /build's rule). This shape file seeds CONTEXT.md directly — no need for discuss-phase to re-elicit the shape.
- Cross-deployment migration: the AI+ box's branding config lives on Stacy's side. Coordination needs to include either (a) preparing the migration script such that Stacy applies it on her side as part of pulling the ship, or (b) my ship touches both configs directly. Which path lives inside the plan phase — the shape doesn't lock it.
- Runbook file to delete: the local box's role-folder runbook file for avatar-flow. This is per-box (local to this box's role folder), not distributed. The per-identity prompt archive files under the same role folder also become dead-history and go in the same ship.
- Identity doing the work: tina.
- The `/close <slug>` at the end of /build walks the shape's facets against what got built.
