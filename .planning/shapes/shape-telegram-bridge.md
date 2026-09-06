# Shape: Telegram bridge — wrist-reachable fleet, riding on Skynet becoming Matrix admin

**Opened:** 2026-09-05
**Vehicle:** GSD phases, sequential — two minimum (Matrix admin foundation, then Telegram bridge substrate + identity modal integration)

## What this is

Ashley wants to hold her fleet from her wrist. Skynet has no watch app; Telegram does. The relay that already carries messages between Ashley and her agents also already has a hand-built Telegram bridge running as a service on the same box — one bot per agent, two-way, media and voice included, half of the fleet is wired up today. This is the plan to promote that bridge from a hand-configured one-off into a first-class piece of Skynet: shipped by the fleet distributor, configured through the identity modal one identity at a time, running alongside the relay it depends on.

Underneath the bridge work is a bigger shift: Skynet stops being a downstream consumer of the relay and becomes its admin. That shift is what makes the bridge integration clean — and it unlocks other things too — but it is real work in its own right and lands first.

## Shape

Two layers, built in that order.

**The foundation: Skynet becomes Matrix admin of the relay.** Skynet holds an admin identity on the relay and treats its credentials the same way it treats every other credential — encrypted, on disk, managed by Skynet. With that admin power, creating a Skynet agent-identity also creates its relay identity in one operation. Humans keep ownership of their relay credentials so they can use their account outside Skynet if they ever want to (Element on a phone, another Matrix client); their accounts get created externally — the three hand-made accounts today (Ashley, Zoe, Laura) are already done, and for future users it happens via runbook when the Skynet user is provisioned. Skynet stores only the Skynet-user-to-mxid mapping. When it needs to act as a human (inbound bridge traffic), it mints a token via admin — the human's password never sits on disk anywhere in Skynet or the bridge. Skynet can also create the DMs between agents and humans with exactly the shape the relay needs, and can force itself into rooms it didn't create so it can manage legacy rooms too.

**On top: the Telegram bridge as first-class Skynet substrate.** The existing bridge script gets folded into the fleet distributor and shipped alongside the other managed services on the box. The identity modal gains a new section — a Telegram section — for each identity. The human owner of an identity pastes a bot token into that section; Skynet writes it into the bridge's configuration; the bridge restarts and the identity is bridged. The bridge itself grows one small improvement — its Matrix-side cursor persists to disk (mirroring an existing pattern already used elsewhere in the same skill) so a restart never drops a message.

The activation flow the human walks:

1. Open the identity modal for the identity they want on their wrist.
2. Click connect in the Telegram section.
3. Paste the bot token from the Telegram bot they created.
4. Follow Skynet's on-screen instruction to open Telegram, find the bot by name, and send /start.
5. Bridge learns the human's Telegram identifier from that first inbound message and the identity is bridged. Two-way from that point on.

Reply direction round-trips: text typed on Telegram lands in Matrix as the human; the agent's reply lands in Telegram via the bot; both sides look like normal conversations to their respective clients.

## Philosophy

**The relay is Skynet's, not something Skynet consumes.** Every design fork that used to exist because Skynet had to detect a world it didn't own goes away because Skynet owns the world. If code ever needs to inspect the relay's state and react to what it finds, ask whether Skynet should have made that state directly. Usually yes.

**Wrist-reachability is per-identity opt-in.** Not every identity earns a Telegram bot; the human picks. Bots are a scarce resource (Telegram caps the count per account), and the whole point is that the human is deliberate about which agents get to interrupt them on the wrist.

**Zero message loss; single-digit-second delay is fine.** The reliability floor is that no wrist notification silently disappears. Delays measured in seconds are invisible to the user. Drops are not.

**The bridge stays independent code.** Nina's bridge is not being absorbed into Skynet as source; it's being packaged, distributed, and configured by Skynet, but the bridge process runs on its own and can be reasoned about on its own. If Skynet is unhealthy, the bridge still bridges.

**Each Skynet box is its own island.** Multiple Skynet deployments each stand up their own relay, their own bridge, their own admin. Nothing federates. Nothing shares. If the mental model of "one Skynet box, one relay, one bridge, all owned by this Skynet" ever breaks, the design has been violated.

**Humans own their relay credentials.** Skynet has admin over the relay and could trivially create accounts on humans' behalf, but doesn't — those credentials would be locked inside Skynet and the human couldn't use their account elsewhere. So human account creation stays external (runbook-driven for new users, already-done for the three existing accounts) and Skynet only holds the Skynet-user-to-mxid mapping. Agents don't have that concern, so Skynet creates and owns agent relay accounts as before.

## Prior context

The relay already runs on the box that hosts Skynet — a Matrix homeserver Ashley set up before Skynet knew about the relay at all. Nelly built it; Nicole owns it now. Skynet consumes it (agents register on it, DM each other and Ashley through it) but doesn't manage it. Half of the fleet's agents are already Telegram-bridged through Nina's hand-configured script; the other half aren't yet, and adding one today means editing a JSON file on the box by hand and restarting a service.

The bridge holds each human's Matrix password on disk so it can re-log-in that human's account when the token dies. That's a load-bearing security surface that the admin foundation removes: with admin, Skynet mints tokens on demand and no password ever needs to be stored anywhere except in the human's head.

Older DMs between agents and Ashley exist on the relay in several shapes. Some are cleanly created by agents. Some were created by Ashley through Element and are therefore encrypted. Some are frozen because their creator agent has been retired. This is the class of mess that "Skynet detects and reuses an existing room" would run into without the admin foundation underneath — Skynet couldn't cleanly manage those rooms without the ability to elevate itself into them.

The relay migrated from Continuwuity to Synapse earlier this year. Server-admin was mostly untouched during that migration. Nicole recently minted a Skynet-owned admin account and passed the credentials over; those credentials are parked on Skynet's box waiting for the code that consumes them to exist.

Skynet already knows about multiple humans. This box has three users; the company's box has seven. Sharing of identities across humans is not currently practiced, but the model supports it. The bridge's registry schema also supports one identity bridging to multiple humans; that capability is preserved in the bridge but not surfaced in Skynet's UI for the first version.

## What would make it wrong

If a wrist notification ever silently disappears, the design has failed. Delays are tolerated; losses are not. The whole point is that Ashley trusts her wrist to reflect her fleet, and any bug that swallows a message ships as a P0.

If configuring a new agent for wrist access requires editing anything on the box by hand, the design has failed. The whole promotion is about moving out of "hand-tuned by Nelly" territory and into "the human clicks a thing in the identity modal." If a step in the flow still requires a shell, that step is the actual problem, not something to document around.

If Skynet still has to reason about "does this DM room exist, is it the right kind, can I use it" as a fork in the code path, the design has failed. That fork was the smoke telling us we needed the admin foundation; if it reappears in the built version we didn't actually build the foundation.

If any human's Matrix password lands on disk anywhere in Skynet or the bridge, the design has failed. The whole point of the admin foundation is that Skynet mints tokens on demand. The old bridge did the password thing by necessity; the new setup must not.

If two different Skynet boxes ever share a relay, a bridge, or an admin, the design has failed. Each box is its own island. Cross-box coupling defeats the deployment model.

If a human accidentally opens their identity modal, misclicks something, and their wrist connection dies without a clear recovery path visible in the same section, the design has failed. The identity modal is human-facing; recovery from bad clicks has to be built in.

## Scope edges

**In.** A Matrix admin client on the Skynet side that wraps the relay's admin API. Storage of Matrix admin credentials in Skynet's existing encrypted-secrets pattern. Skynet identity-creation propagating to relay-account creation for **agents** (Skynet creates + owns the agent's relay account, since agents don't need external Matrix access). For **humans**, a **non-UI** path — backend/CLI/config — to register their externally-created mxid with Skynet, whether at initial user provisioning (via runbook) or as an import step for the three accounts that pre-date this work. Human relay accounts are always created externally and remain owned by the human; Skynet stores the mapping and mints tokens on demand via admin. A new Telegram section in Skynet's identity modal per the activation-flow shape above. Nina's bridge folded into the fleet distributor as a managed service, treated the same way agent-supervisor is. Disk-persisted Matrix-side cursor state in the bridge so restarts don't lose messages. Skynet writing the bridge's registry when the human configures a bot, and restarting the bridge to activate.

**Out.** Federation between Skynet boxes, or shared relays across deployments. A Skynet UI for the Matrix admin itself (room management, invite/kick, human moderation through Skynet). This design touches the admin capability, not an admin UI on top of it — that's later, if ever. Rewriting Nina's bridge in another language; it's fine as it is. Any changes to how agents DM each other, which continues to be the existing relay path unchanged. A Skynet PWA or in-app notification story; this design specifically pivoted away from that. **Any new frontend UI beyond the identity-modal Telegram section.** Relay accounts are not a Skynet frontend affordance: new humans get their account created externally at Skynet user provisioning via runbook, and the three existing hand-made accounts (Ashley, Zoe, Laura) import their mxid via a backend/CLI path. No admin panel, no relay-account form, no "manage credentials" surface.

**Deferred.** The ability to reload the bridge's configuration without restarting it (a signal-driven re-registration). Real, worth doing later, but not v1 given the persistence fix makes the restart acceptable. Surfacing the multi-humans-per-identity capability in the identity modal — the bridge supports it, but v1 UI does not. Migrating the co-located relay + bridge stack from the current shared box onto the Skynet box itself. Ashley wants this eventually and it fits the "each Skynet is its own island" philosophy, but it is not part of the first version. Automated migration of the legacy encrypted or frozen rooms — v1 covers "Skynet-created rooms going forward"; legacy rooms remain reachable through their existing setup, and where a stale room is unbridgeable, a companion plaintext room can be created and both coexist. **Deletion propagation and rename propagation.** Skynet has no identity-deletion or -rename surface today, so there's nothing on the Skynet side to trigger them. When either surface gets built, its propagation gets added at that time.

**Tempting but no.** Making every identity wrist-reachable by default. The bot cap and the opt-in philosophy specifically argue against this. Storing bot tokens somewhere other than Skynet's existing encrypted-secrets pattern. Consistency wins over creativity here. Surfacing the bridge as its own separate app or admin panel inside Skynet; the identity modal is the right home, and splitting it off would lose the clean per-identity mental model. Reaching for the admin API to also manage the coordinator/actor dispatch mechanic — coordinators are their own concept in the fleet, and they get relay accounts the same way everyone else does; special-casing them here couples two unrelated things.

## Vehicle notes

GSD phases, sequential, two minimum.

Phase A: Skynet Matrix admin integration. The credential store, the admin client library, the identity-to-relay-account lifecycle wiring. Completes when creating a Skynet agent-identity creates its relay account in the same operation, human users have their externally-created relay mxid registered with Skynet via a non-UI provisioning path, and Skynet can force-manage any relay room via the admin API.

Phase B: Telegram bridge substrate promotion + identity modal Telegram section. Packaging the bridge for the fleet distributor, adding the Matrix-cursor persistence, writing the identity modal's new section, wiring the activation flow, and the write-registry-then-restart mechanism.

Phase A must land before Phase B is planned; the shape of Phase B assumes Phase A's admin client exists. If a natural split within either becomes obvious during discuss-phase, decompose further at that time.

Related artifacts already on disk:
- `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/` — opened during the /open discussion. Parks the admin credentials Nicole minted (in `credentials.txt`, chmod 600) and tracks the foundation work. Phase A adopts this bounty; the bounty either winds down or merges into the phase.
- `/home/thenasty/.config/tg-bridge/bridge.sh` on the relay box — Nina's current bridge script. Read this during Phase B's discuss-phase to ground the packaging work in what actually exists.
- `substrate/skills/agent-relay/` in this repo — the fleet-distributed skill that documents the relay. May want light updates during Phase A to reflect Skynet's admin role once it lands.

Identity holding this shape: Tina, on t1000. She has the parked credentials, the /open discussion history, and the peer-coordination channels to Nelly / Nicole / Nina where the substrate side gets handled.
