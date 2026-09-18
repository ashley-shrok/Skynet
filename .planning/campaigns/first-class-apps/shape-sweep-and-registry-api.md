# Shape: sweep-and-registry-api

**Opened:** 2026-09-18
**Vehicle:** GSD phase
**Part of campaign:** first-class-apps (shape 2 of 4)

## What this is

The visibility half of first-class apps. The look-around Skynet already does every couple of seconds to notice which agents are alive on each managed box is extended to also notice which apps are alive on each managed box. Skynet holds the fleet-wide picture in memory, hands it to each connected client filtered by that client's user's host access, and updates it live as apps come and go. Nothing writes back — apps live on disk, and Skynet only observes.

## Shape

**Where apps live.** On each managed box, under a canonical location. Inside each app folder sits the small metadata card shape 1 wrote — title, one-line description. The systemd unit that runs the app names the port it listens on. Optionally, an icon file sits in the folder.

**What the look-around learns.** For each box the sweep can reach, it enumerates the canonical apps location and, for each folder found, checks three things: the card is present and parses, a corresponding systemd unit exists, and that unit is active. Any app that fails those three checks does not enter the picture — with one carve-out: if the folder + card + unit are all present and the unit is defined but currently not active, the app IS in the picture with an unhealthy flag and a short message the client can render. Every other kind of miss (no folder, no card, no unit) means the app simply isn't there.

**The per-box findings the sweep emits.** For each app that makes the cut:
- Which box it lives on
- Its slug (the folder name)
- Its title and description (from the card)
- Its port (from the unit)
- Whether it has an icon file present
- When the folder was created
- Whether it's healthy right now — and if not, a short human-readable reason

Everything is discoverable from disk + systemd; nothing is Skynet-authored.

**Where the picture lives.** Skynet holds a fleet-wide map of "which apps live on which box" in memory. Same discipline the identity picture already uses: no database, no schema, no migration. Restart wipes it, next look-around rebuilds it.

**How the picture stays fresh.** At the end of each successful per-box sweep, the same reconciliation pattern that keeps identity discovery honest also keeps app discovery honest: whatever the sweep saw this tick becomes the truth for that box; anything that was there last tick and isn't there this tick is removed from the picture and a "gone" signal goes out. Reconciliation only runs on sweep success — a box that can't be reached this tick keeps its last-known apps, so transient outages don't flap the sidebar.

**How clients read it.** The same live channel identity discovery already uses. When a client connects, it gets a snapshot of every app across every box its user can see. Every subsequent add/remove/health-change delivers a delta on the same channel. The per-user host-visibility filter that already gates identities gates apps identically — nothing new invented at that layer.

**How the pieces relate.** The canonical apps location on disk is the source of truth. The look-around observes it. The in-memory picture reflects the most recent observation. The live channel broadcasts what the picture holds. Every layer above disk is a cache.

## Philosophy

**Disk is the truth.** Skynet never writes app state. It observes. If disk changes, the picture reflects it on the next successful look-around. Nothing about an app's existence, health, or presence is authored server-side.

**The look-around's contract governs freshness.** The existing cadence is the app-visibility cadence. If a user wants "instant" reflection of a just-created app, that's a future nudge — not a redesign.

**"Not usable" means "not in the picture."** The three checks that decide inclusion (folder + card + unit-active) are functional, not structural. If a user cannot actually open and interact with the app, it does not appear as a tile — with the single carve-out that a defined-but-currently-stopped app appears in an unhealthy state, because that state is "this used to work, it's broken now, ask an agent" and the diagnostic is free.

**One health tier, not many.** Shape 2 exposes one binary health axis (healthy / not-healthy-because-unit-stopped) with a short message. It does not chase crash-loop counting, port collisions, application-level healthchecks, response-time thresholds, or any other failure surface. That door stays closed here; a future shape may open it.

**Piggyback the existing plumbing, don't invent parallel pipes.** The look-around, the in-memory-picture pattern, the live-channel wire, the host-visibility filter, the reconciliation-on-success pattern — all four already exist for identities. Apps use the same four, extended.

## Prior context

Shape 1 delivered the disk side of the picture: a canonical skill that provisions an app under the canonical location on the maintainer's own box, writes the metadata card, provisions the systemd unit that runs it. Everything shape 2 observes was put there by shape 1.

The look-around itself has existed for many phases. Its most recent evolution (from another maintainer's work that landed on the trunk just before shape 2 opened) is the reconciliation-on-success pattern for identities — Ashley's exact framing was quoted in the fix that added it: "if the cache is keeping identities that don't come back from the sweep then that would be the bug." Shape 2 adopts that same pattern for apps, unchanged in spirit.

The host-visibility filter is a single existing function used consistently across the codebase to answer "can this user see this box." Every other feature that displays per-box things routes through it; shape 2 does the same.

## What would make it wrong

- **Ghost tiles.** An app appears in a user's sidebar for something they can no longer use — a folder that was deleted, a unit that was uninstalled, a box they lost access to. If the tile survives the thing it represents, the picture has lied.
- **Silent absence for genuinely-broken apps.** A user provisioned an app, it was working, it crashed, and now it silently vanished from her sidebar with no explanation. She has no idea whether it was deleted, moved, or broken. That's the case the unhealthy carve-out exists to prevent.
- **A user seeing another user's apps.** If the visibility filter fails open — anywhere — the picture has leaked. The filter is the load-bearing check; shape 2 does not invent its own, it composes the existing one.
- **Skynet writing app state anywhere.** A database row, a config file, a sidecar cache. If Skynet remembers an app across restart from anywhere other than "the disk on the box said so this tick," the discipline is broken.
- **Sidebar flap on transient network.** The look-around fails to reach a box for one tick, and every app on that box drops out of the picture and reappears when the next tick succeeds. Ugly and misleading. The success-gated reconciliation prevents this.
- **A per-app permission model creeping in.** Any code that answers "can this user see this app" with logic other than "can this user see this box" is a wrong shape. Host access IS app access.
- **Cadence assumptions leaking outward.** Any client-visible timing coupling ("expected within 500ms of create") that assumes something beyond what the look-around's natural cadence provides. The freshness contract IS the look-around's cadence.

## Scope edges

**In:**
- Extending the per-box sweep to enumerate the canonical apps location, read each card, cross-check with systemd, and emit per-app findings inside the same one-shot exec that already carries identities.
- A new in-memory picture on the Skynet side, keyed by box and slug, populated by the parsed per-box findings.
- Per-host reconciliation-on-success for the new picture, matching the identity pattern.
- New frame types on the existing live channel: snapshot of all apps a client can see at subscribe time; delta on any add / remove / health-change.
- Application of the existing per-user host-visibility filter to app frames at the wire boundary.
- Tests at the parse layer (bad card, missing card, missing unit, inactive unit) and at the reconciliation layer (app disappears between ticks; box unreachable one tick then reachable the next).

**Out:**
- The sidebar surface itself, including tile visuals, empty-expanded state, context-menu actions, sidebar section header, and any user-side hidden/favorited state — that's shape 3.
- Opening an app in-place, opening it as a split-view leaf, and the proxy that routes browser requests through to the app — that's shape 4.
- Any additional health signals beyond "unit exists and is active" — crash counters, response-time probes, port-collision detection, application-level healthchecks.
- Server-authored provenance ("who made this app") — shape 1 does not capture it; shape 2 does not invent it.
- Any registration or push mechanism on the app side; disk stays the source of truth.
- Cleanup of orphan systemd units when an app folder is deleted; that lives on the disk-side flow that shape 1 owns.

**Deferred:**
- An eager-refresh nudge (agent touches a sentinel, or the create script pings the Skynet backend) to shrink the create-to-visible latency below the natural sweep cadence. Considered only if the cadence actually feels bad in shape 3's UAT.
- A plain read-only HTTP snapshot endpoint alongside the live channel, if a curl-driven client or non-WS surface ever needs one. YAGNI until asked.

**Tempting but no:**
- Building any second health tier now.
- Skynet-side per-user app state (favorites, hidden, custom-labels).
- A "was up recently" grace window for unhealthy apps.
- URL construction for icons on the backend side.

## Vehicle notes

**Why a GSD phase:** shape 2 spans two runtimes (the TypeScript orchestrator + subscription registry + wire protocol layer, and the Python per-box sweep script that ships via the substrate distributor), needs a full container deploy for the TS side plus a substrate distribution sweep for the Python side, and touches enough test surface (parse, reconciliation, filter application, wire) that phase-level structure earns its place.

**Seed for `/gsd:discuss-phase`.** This shape file IS the seed. Every "what + why + constraint + scope edge" the discuss step would otherwise re-elicit is already here; drop it in as CONTEXT.md or generate CONTEXT.md from it. Do not re-run the discovery.

**Phase-number rule (fleet-standard).** Whichever free phase number this shape takes when `/gsd:phase` slots it into ROADMAP.md is fine; if a peer identity races us to that slot mid-plan, the fleet's phase-collision auto-resolve kicks in — no user check needed for pure slot collisions.

**Cross-shape ordering (from the campaign):** shape 3 and shape 4 both depend on shape 2 landing and can proceed in parallel or in either order once it's in. Shape 3 delivers standalone value (sidebar visibility + open-in-new-tab) even before shape 4.
