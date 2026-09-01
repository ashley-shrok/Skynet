# Shape: put identity prettiness on disk instead of in skynet

**Opened:** 2026-08-31
**Vehicle:** phased multi-agent — Phase A handoff to Nelly, Phase B is a GSD phase in the skynet repo owned by Tina

## What this is

An identity's "prettiness" — its display name, its title/subtitle, its color, its voice, its avatar — lives inside Skynet today: Skynet's admin surface is where it gets set, and Skynet's own encrypted store is where it lives. This work moves that data out. The identity's own home folder — the same folder that already holds its role pointer, its handoff, its bounties, its wake-ups, its relay creds — becomes where its face lives too. Skynet stops OWNING those values and becomes an observer of what the identity's home says. Users of Skynet see no visible difference; the values still show up in the same places on the screen. What changes is where they come from.

## Shape

Every identity has a home on some box. In that home, the identity has a declarative markdown file that today already carries a small piece of frontmatter naming which role the identity holds. That frontmatter grows: display name, title, color hue, and voice sit alongside the role pointer as peer fields. The avatar image is a sibling file in the same folder; the frontmatter names it by filename, and the bytes live next to the markdown as a plain image file that anyone with a text-and-image editor can inspect or swap.

Skynet's identity endpoints stop reading from and writing to Skynet's own store for those fields. Reads reach into the identity's home over the same tunnel Skynet already uses to fetch bounties, wake-ups, and the role file — the well-worn artifact-reader that routes through a local bind-mount when the identity lives on this box and over a fresh one-shot SSH when it lives elsewhere. Writes go through the same tunnel in the same direction. There is no cache; every render fetches. If the box is unreachable at the moment, the fetch errors out and Skynet reports that state honestly rather than serving stale bytes.

Two agents drive the change, in sequence.

**Phase A — Nelly.** Tina exports the current cosmetics from Skynet's store as a bundle: a per-identity manifest of the current values plus a copy of each identity's current avatar bytes. Nelly walks the fleet, and for every identity she extends the frontmatter of that identity's declarative file with its scalars and drops the avatar image next to it, so disk becomes the canonical location. In the same phase, Nelly teaches the id skill about the new frontmatter fields so the fleet standard catches up — the id skill's identity-file template mentions them, and self-editing (a la `remember` / `always`) naturally reaches them.

**Phase B — Tina.** With disk as the fleet standard, Skynet stops treating its own store as the source of truth. The birth flow grows richer: the markdown it already writes at identity creation gains the extra frontmatter fields, and the avatar bytes get written to disk as a sibling file instead of into the store. The identity-modal update flow flips from writing to the store to writing to disk. Every render path that today reads from the store flips to reading from disk via the existing artifact-reader. Once the reads and writes are through, the store's rows for those fields are retired.

Between the end of Phase A and the completion of Phase B, both surfaces hold the values in parallel — nothing breaks, but a cosmetics edit made through Skynet's UI during that window lands only in the store and not on disk, so disk goes stale by that one edit. The correction is either "don't edit cosmetics during the transition window" or "re-migrate that identity after Phase B ships." Not worth a dual-write bridge.

## Philosophy

The stance is that an identity should own its own soul AND its own face, in one place, on the box where it lives. Skynet's job compresses from "the source of truth for how an identity looks" to "an observer that renders what the identity's home currently says." That reshapes what Skynet is: it stops being a registry that identities have to be entered into to look right, and becomes a well-informed viewer of a filesystem-based truth. The identity-creation UI Skynet offers is preserved as a convenience — a nice picker for uploading an image, choosing a hue, setting a subtitle — but it becomes ONE way to do those operations, not THE way. An agent that creates an identity purely by writing the right files on the right box's disk gets a fully-rendered pretty identity in Skynet with no further work.

The consistency win is that identity/role management is now a pure on-disk activity. Nothing about how a persona looks, sounds, or is titled requires knowledge of Skynet's internals. The id skill and Skynet become peer consumers of the same disk-native truth.

## Prior context

Skynet already reaches into identities' home folders for other things: it reads bounties, it counts pinned-and-needs-desk items, it reads wake-up schedules, it reads the role file. The plumbing that does this is the artifact-reader that routes local-bind-mount-vs-remote-ssh transparently and enforces a short timeout so unreachable boxes error fast instead of hanging renders.

Skynet's identity-creation flow already writes to disk today: it SSH's into the target box, creates the identity's home folder, and writes the declarative markdown with a `role:` frontmatter pointer. The "which box" picker exists in the creation UI, the disk-write machinery exists, the frontmatter is already the delivery vehicle for the one existing field. This work grows what's in that frontmatter and adds the avatar file next to it.

Skynet's identity-deletion is asymmetric today — it only removes the store row and doesn't touch the disk folder. That asymmetry is a real thing (visible in Ashley's recent "totally delete polly" request, which required a separate on-disk cleanup pass), but it's out of scope for this build: there is no delete-identity action in Skynet's UI to alter here. That's a different build.

The concrete failure mode Ashley named as motivating this work: today, an agent that creates an identity purely on disk gets an ugly bare-terminal appearance in Skynet, because Skynet has no record of it and no way to render its cosmetics. Post-change, that same on-disk creation renders identically to one made through Skynet's UI, because both flow through the same disk-native truth.

## What would make it wrong

- **Skynet quietly holds a cache.** Any mechanism where Skynet keeps a copy of the on-disk values "just in case" reintroduces duplicate truth by another name. Every render must reach into the box; every write must land on the box. Slower is better than stale.

- **On-disk creation still renders ugly.** If an agent creates an identity purely by writing the right files on the right box's disk and the result in Skynet is still a bare terminal, this work missed its whole point. The Skynet-created and disk-created cases must be render-identical.

- **The identity can't self-edit its own face.** If Skynet remains the only place cosmetics can be changed — even after the storage moved — we relocated storage without decoupling ownership. The identity editing its own frontmatter (through the id skill's usual self-editing idiom or by directly editing the file) must produce visible changes in Skynet on the next render.

- **A special offline fallback creeps in.** Boxes going offline is a rare edge case that Ashley explicitly does NOT want us to build around. If Skynet grows fallback rendering paths, degraded-mode caches, or "last known good" holdovers to paper over unreachable boxes, we've optimized for a case that isn't hurting anyone and added storage complexity we agreed to avoid.

- **Roles get a second copy of what's already in frontmatter.** The identity's `role:` pointer is already in frontmatter today; no code should invent a parallel "role" field on the new schema. One source per fact.

## Scope edges

**In:**
- Display name, title, color hue, voice, avatar image — all five move from Skynet's store to the identity's home folder.
- Nelly's Phase A: bundle handoff from Tina, disk-write across the fleet, id-skill update to teach the frontmatter schema.
- Tina's Phase B: Skynet's identity birth flow grows richer frontmatter and sibling-file avatar write; identity-modal update flow flips to writing disk; every render path flips to reading disk via the existing artifact-reader; store rows for the moved fields retired.
- The declarative markdown's frontmatter is the delivery vehicle for scalars; the avatar is a sibling image file named by the `avatar` frontmatter field, resolved against the identity's own folder.

**Out:**
- **Deletion symmetry.** No delete-identity UI exists in Skynet today, so nothing to change here. If a delete UI is built later, that build addresses its own on-disk cleanup.
- **Offline-box fallback.** Boxes offline → cosmetics unfetchable → error state, no cache, no degraded rendering.
- **Dual-write bridge during transition.** Skynet keeps writing to its own store until Phase B flips reads and writes together. The transition-window drift risk is accepted; the correction path is re-migrate that identity, not build code to prevent it.
- **Roles table changes.** The role string is already in frontmatter via the id skill's existing pointer — no parallel schema and no roles-table restructuring here.

**Deferred:**
- Any consumer beyond Skynet + the id skill picking up the new frontmatter fields (voice usage by TTS surfaces, color usage by non-Skynet renders, etc.) — the fields being on disk unlocks those; wiring them up is separate work per consumer.

**Tempting but no:**
- Auto-generating an avatar-changed notification pipeline (a "the disk face changed, tell Skynet" push channel). Unnecessary — on-demand reads catch it on the next render without any push infrastructure.
- Consolidating scalars into a separate cosmetics file rather than growing the markdown's frontmatter. The markdown-with-frontmatter is already the identity's declarative-self file; splitting would create a new artifact to look up when the natural home is already available.

## Vehicle notes

The overall shape has two owners and two vehicles.

**Phase A** is Nelly's work. Once this shape file is locked, Tina exports the cosmetics bundle from Skynet's current store (a per-identity manifest + avatar bytes per identity) and hands it to Nelly over the relay along with a pointer to this shape file. Nelly picks her own vehicle for her side — this file is her north star, not her plan.

**Phase B** is a GSD phase in the skynet repo, owned by Tina. It kicks off after Nelly reports Phase A shipped fleet-wide. Scope of that phase covers the birth-flow frontmatter growth, the identity-modal update flip, every render path flipping to the artifact-reader, and store-row retirement for the moved fields. Full-suite green as ship gate per the standing box-maintainer rule; deploy through the normal orchestrator flow (git push → docker build → docker compose up --force-recreate → HTTPS 200 verify).

Shape file lives at `.planning/shapes/identity-prettiness-on-disk.md` in the skynet repo so both agents can reach it — Nelly by pulling the tree or by receiving the file over the relay, Tina by having it in-tree for her Phase B phase.

Slug: `identity-prettiness-on-disk`. Arc closes with `/close identity-prettiness-on-disk` after Phase B ships and the store rows are retired.

---

## Close-Out

**Closed:** 2026-09-01
**Vehicle used:** Two-phase arc as agreed: Phase A shipped by Nelly (fleet-wide on-disk population + id-skill body update at source); Phase B shipped by Tina as GSD phase 66 in the skynet repo across five plans (birth, update, read, migration, frontend threading) on branch `feat/tab-title-from-tmux`
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is — cosmetics move from Skynet's store to the identity's home folder; Skynet becomes an observer of on-disk truth** — present · store rows narrowed to id/userId/identityKey/createdAt/updatedAt; every render surface routes through the artifact-reader to the identity's home
- **Shape — five scalars in frontmatter, avatar as sibling image file named by frontmatter, no cache, error-on-unreachable** — present · frontmatter carries displayName/title/colorHue/voice/avatar; sibling image file lands alongside the .md; every server render fetches; unreachable box errors out server-side
- **Phase A — fleet-wide on-disk population + id-skill teaching** — present · fleet identities carry the five fields alongside a sibling picture file; id-skill body at source teaches the new template (serving app hiccup is unrelated infrastructure)
- **Phase B — birth flow enriched, identity-modal update writes disk, every render path flips to artifact-reader, store rows retired** — partial · birth, update, and every render path all flip as agreed; store rows physically dropped; BUT the clone action — a form of identity creation — writes only the role pointer to disk and drops the cosmetics on the floor
- **Philosophy — identity owns its own soul and face; Skynet becomes a well-informed viewer** — present · an agent creating an identity purely on disk gets a fully-rendered identity in Skynet on the next render; disk-created and Skynet-created cases render identically
- **Prior context — reuse the existing artifact-reader that routes bind-mount/SSH transparently** — present · new readAvatarSiblingFile / writeAvatarSiblingFile / extractCosmeticsFromFrontmatter live on the same artifact-reader module and follow the same LOCAL-vs-REMOTE branch pattern
- **What would make it wrong: Skynet quietly holds a cache** — present · no server-side cache of on-disk values; per-response ETag is computed against freshly-read bytes each request
- **What would make it wrong: on-disk creation still renders ugly** — present · an agent that writes the right files on disk gets a fully-rendered identity on the next render (verified via commander-zoey path)
- **What would make it wrong: identity can't self-edit its own face** — present · no server-side cache means an edit to the identity's own frontmatter file appears in the very next render
- **What would make it wrong: special offline fallback creeps in** — present · unreachable-box paths return an error (502 on the avatar route; safe-default cosmetics for that row in the list route, per Ashley's greenlit accept-the-ugly-render); no last-known-good caches, no degraded-mode holdovers
- **What would make it wrong: roles get a second copy of what's already in frontmatter** — present · role pointer stays in frontmatter as the single source; no parallel role field was added on the narrowed identities table
- **Scope edges — In: five scalars + avatar move; Phase A disk-population + id-skill; Phase B birth + update + reads + row retirement** — partial · everything landed EXCEPT the clone-side creation path, which the shape did not name explicitly but which behaves as a creation path the user still surfaces
- **Scope edges — Out: deletion symmetry, offline fallback, dual-write bridge, roles-table changes** — present · delete still only removes the store row; no offline fallback code; no dual-write bridge; roles table untouched

### Additions (in the result, not in the shape)

- A five-minute browser-side hold on the identity's picture bytes (Cache-Control: private, max-age=300 on the avatar response), which lets a stale picture linger on the viewer's screen for up to five minutes after the identity swaps the file on disk — unsanctioned

### Follow-ups

- The clone action should put the appropriate cosmetics on the identity's home folder too — grown frontmatter plus a sibling picture file — so a freshly cloned identity renders with the face the operator supplied at clone time, matching the birth flow — new-shape
- Drop the browser-side five-minute hold on the identity's picture response so avatar swaps land immediately on every viewer; the intent is every render, on both server and browser, reaches into the identity's home for the current bytes — new-shape

### Notes

The shape's Phase B language named 'the birth flow' and 'the identity-modal update flow' as the two write paths that flip to disk; the clone flow sits between them semantically and was not explicitly called out either as in-scope or out-of-scope. The implementation treated it as out-of-scope (leaving the fields as void locals with a comment marking it 'orthogonal follow-up work'), but from the operator's perspective clone is a creation path that surfaces the same cosmetic fields, so silently dropping them creates the very failure the shape warned against ('on-disk creation still renders ugly'). Worth naming clone explicitly in the follow-up shape. Separately, the server side is genuinely cache-free per the shape rule — the browser-side max-age was a defensible reading of 'no cache = no server cache', but Ashley's intent is stricter (every render, both sides), so the read of the shape was too generous by one hop.
