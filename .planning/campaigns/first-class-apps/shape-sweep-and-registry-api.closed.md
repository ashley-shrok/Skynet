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

---

## Close-Out

**Closed:** 2026-09-18
**Vehicle used:** GSD phase (Phase 118, plans 118-01 through 118-05, plus a post-code-review fix pass on 2026-09-18)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · the existing every-few-seconds look-around is extended to also enumerate apps on each managed box; Skynet holds the fleet-wide picture in memory and broadcasts it over the same live channel, filtered per user
- **Shape: where apps live** — present · sweep enumerates `~/fleet/apps/<slug>/`; reads the small metadata card; reads the systemd unit for the port; checks for an icon file
- **Shape: what the look-around learns (three checks + carve-out)** — present · three inclusion checks (card parses, unit exists, unit active) plus the exact carve-out for defined-but-inactive units with a short human-readable diagnostic
- **Shape: per-box findings the sweep emits** — present · every field the shape names is on the wire: which box, slug, title, description, port, has-icon, folder-created-at, is-healthy, health message
- **Shape: where the picture lives** — present · in-memory fleet-wide map, keyed by host and slug, sibling to the identity map; no database, no persistence, restart wipes it
- **Shape: how the picture stays fresh (reconciliation-on-success)** — present · reconciliation set (`lastTickLiveApps`) reconciled only at end of a successful per-host sweep; failure returns bypass the block; adopts the same `67b4a7ef` identity pattern
- **Shape: how clients read it** — present · snapshot on subscribe + delta frames on add/remove/health-change over the same live channel
- **Shape: how the pieces relate** — present · disk is the source of truth; sweep observes; in-memory picture reflects the most recent observation; wire broadcasts what the picture holds; Skynet writes nothing
- **Philosophy: disk is the truth** — present · no server-side authoring; no persistence tier; restart is safe
- **Philosophy: look-around cadence governs freshness** — present · no eager-refresh nudge or push mechanism; freshness IS the sweep cadence
- **Philosophy: not usable means not in the picture** — present · the three-check filter is functional (folder + card + unit-active), with the single defined-but-stopped carve-out
- **Philosophy: one health tier** — present · binary `is_healthy` + short message; no crash counters, no port-collision detection, no application-level probes
- **Philosophy: piggyback existing plumbing (four pieces)** — partial · sweep, in-memory picture, live channel, and reconciliation pattern all reuse the identity precedents; the fifth piece — the host-visibility filter — turned out not to exist at the identity-frame layer, so the material built a new one scoped to app frames only (endorsed as drift; separate bounty spun up)
- **Prior context: shape 1 disk convention** — present · sweep reads exactly what shape 1 lays down — app folder, `app.json`, systemd unit with `PORT=` env, `icon.webp`
- **What would make it wrong: ghost tiles** — present · reconciliation-on-success drops slugs the current picture doesn't contain; test P118-04-A2 locks the drop behaviour
- **What would make it wrong: silent absence for broken apps** — present · defined-but-stopped carve-out emits with `is_healthy=false` + the exact human string; test P118-04-A4 locks the health-flip
- **What would make it wrong: user seeing another user's apps** — present · an app-frame filter was built from scratch on top of the existing `checkHostAccess`; deny-by-default on unknown host and on error; per-frame + per-snapshot projection paths tested
- **What would make it wrong: Skynet writing app state** — present · no persistence — apps map is in-memory only, rebuilt from disk on next successful sweep after restart
- **What would make it wrong: sidebar flap on transient network** — present · sweep-null and schema-mismatch early-returns bypass the reconciliation block; test P118-04-A3 locks zero flap across a null-sweep tick
- **What would make it wrong: per-app permission model** — present · filter answers visibility purely via `checkHostAccess(hostId, user, 'read')` — no per-app logic anywhere
- **What would make it wrong: cadence assumptions leaking** — present · no client-visible timing coupling; no create-to-visible latency promise; snapshot-on-subscribe is the only ordering guarantee
- **Scope edges (IN)** — present · sweep extension, per-app findings, in-memory picture, reconciliation-on-success, new frame kinds on the existing channel, host-visibility filter application to app frames, tests at the parse and reconciliation layers — all present
- **Scope edges (OUT — sidebar surface, open/proxy, extra health signals, provenance, push, orphan-unit cleanup)** — present · no sidebar rendering built; no open-in-place or proxy; no additional health signals; no server-authored provenance; no push/registration on the app side; no orphan-unit cleanup
- **Scope edges (deferred — eager-refresh nudge, HTTP snapshot endpoint)** — present · no nudge/push; no HTTP endpoint alongside the WS channel
- **Scope edges (tempting but no — second health tier, per-user app state, grace window)** — present · none of these snuck in; `is_healthy` is binary; no favorites/hidden/labels; no was-up-recently grace

### Additions (in the result, not in the shape)

- A hard cap of 50 apps per box plus a 3-second cumulative wall-clock budget on the sweep's app enumeration, with a structured warn when either fires — endorsed-as-drift
- A 30-second per-(user, host) TTL cache in front of the app-frame filter's host-access check, trading a bounded revocation-staleness window for DB-pressure reduction — endorsed-as-drift
- A brand-new per-user host-visibility filter built specifically for app frames (`app-frame-filter.ts` + `fanOutApp` path), rather than reuse of an existing identity-frame filter which does not in fact exist — identity frames continue to fan out unfiltered — endorsed-as-drift

### Follow-ups

- General-policy bounty to audit and close metadata-visibility gaps across identity frames and any other host-scoped surfaces (identity fanOut is currently unfiltered — zero impact in the current effectively-single-user fleet but a real gap if the multi-user threat model changes) — bounty

### Notes

The material conforms strongly. Every named failure mode has a corresponding guard in the code and, in most cases, a dedicated test (P118-04-A1..A5 lock the reconciliation, transient-failure, health-flip, and schema-mismatch invariants). The three additions all trace to safety/perf hardening reviewed and accepted before land. One shape-level premise turned out to be inaccurate — the shape claimed an identity-frame host-visibility filter already existed and apps would piggyback it; in fact no such filter was in place, and the material built a fresh app-only filter. User has scoped the identity-frame gap into a separate bounty. Worth carrying forward: (1) the shape's assumption that an existing plumbing piece is in place is worth verifying before writing shape files, especially when the piece is load-bearing on a "what would make it wrong" item; (2) the `fanOut` path is now bifurcated (sync for identities, async-with-filter for apps) — future identity-filter work will need to unify this or duplicate the async-with-queue-window pattern the app path uses to preserve subscribe-time ordering.
