# Phase 77 — CONTEXT

**Seeded from:** `.planning/shapes/shape-telegram-bridge.md` (opened + locked 2026-09-05 via `/build` → `/open`; amended 2026-09-06 with humans-own-their-credentials philosophy + no-new-frontend-UI scope-out, greenlit `thumbs up` same session).

Per the `/build` skill convention on this box, `/gsd-discuss-phase` is seeded directly from the shape file — the shape already captures the why + what + constraints + scope edges that discuss-phase would otherwise re-elicit (precedent: Phase 58, 60, 63, 64, 65, 66, 67, 71, 72, 73, 74). Discuss-phase's job here is limited to any implementation decisions still open after the shape lands.

**Scope of THIS phase (Phase A of a two-phase build):** Only the Matrix admin foundation. The Telegram bridge substrate promotion + identity modal Telegram section belong to **Phase B**, which will be added to ROADMAP.md when Phase A completes.

**Related bounty:** `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/` — has parked `@skynet-admin` credentials Nicole minted on 2026-09-05 in `credentials.txt` (chmod 600). Phase A adopts this bounty; it either winds down or merges into the phase.

**Open flag for research (carried into `/gsd-plan-phase`):** the shape's Prior-context paragraph makes a load-bearing claim about Nina's bridge (that it stores each human's Matrix password on disk so it can re-log-in when the token dies). That claim was written during the /open discussion but has NOT been verified against `bridge.sh` directly. If the claim is wrong — if the bridge already gets by without human passwords — a big chunk of the "why this matters" security-surface story loses weight (though the "user owns their credentials" philosophy still stands on its own). The phase-researcher should ground-truth this against `/home/thenasty/.config/tg-bridge/bridge.sh` early.

## Locked implementation decisions from discuss-phase (2026-09-06)

Three questions surfaced during discuss-phase; all three resolved with Alice. Planner should treat these as decided:

**Q1 — Non-UI human-mxid registration mechanism: backend endpoint.**
A new admin-gated Skynet backend endpoint (shape: `POST /users/:id/mxid { mxid: "@name:homeserver" }` or similar — planner's call on exact URL shape). Same endpoint handles both cases: the new-user provisioning runbook calls it once per new user, and the one-shot import for the three pre-existing hand-made accounts (Alice, Zoe, Laura) is three calls against existing user rows. Consistent with Skynet's existing admin surface (`POST /users/create`, PATCH settings, admin cookie + TOTP gated). Rejected alternatives: (b) CLI script on the box, (c) config file entry per user.

**Q2 — Atomicity failure mode for Skynet-driven agent creation: partial tolerated + surface error, NO rollback.**
Rationale is a real race: agent-supervisor on the target host sees the on-disk identity folder as soon as Skynet writes it (step 1 of the 3-step sequence) and can start spinning up a tmux session for that identity before Skynet even knows step 2 (Matrix admin create) or step 3 (write relay.json to disk) failed. Rolling back the folder at that point would delete something the supervisor is already dealing with. The partial state is also already handled gracefully by the id skill's existing "carry on without relay.json, create it on next wake or by hand" failure mode. See § Storage → Failure mode below for the full sequence + rationale. Rejected alternatives: (a) full rollback, (c) retry-with-backoff then fallback.

**Q3 — Where the human mxid mapping lives: new column on Skynet's users table.**
New `mxid TEXT` column on the users table, alongside username / password hash / TOTP secret. Consistent with "users are Skynet's SQLite record"; mxid is an identifier (not a credential), so the disk-source-of-truth convention that governs agent relay creds doesn't apply the same way; small enough to be one column, not a new table. Rejected alternatives: (b) invent a new disk convention for humans, (c) separate SQLite table.

---

## What this is

Alice wants to hold her fleet from her wrist. Skynet has no watch app; Telegram does. The relay that already carries messages between Alice and her agents also already has a hand-built Telegram bridge running as a service on the same box — one bot per agent, two-way, media and voice included, half of the fleet is wired up today. This is the plan to promote that bridge from a hand-configured one-off into a first-class piece of Skynet: shipped by the fleet distributor, configured through the identity modal one identity at a time, running alongside the relay it depends on.

Underneath the bridge work is a bigger shift: Skynet stops being a downstream consumer of the relay and becomes its admin. That shift is what makes the bridge integration clean — and it unlocks other things too — but it is real work in its own right and lands first. **Phase 77 is this foundation.**

## Shape (Phase A scope only)

**The foundation: Skynet becomes Matrix admin of the relay.** Skynet holds an admin identity on the relay and treats those admin credentials the same way it treats every other secret — encrypted, on disk, managed by Skynet. With that admin power, creating a Skynet agent-identity also creates its relay identity in one operation, with the returned credentials landing on the target host's disk per the existing fleet convention (`~/.claude/identities/<name>/relay.json`) — see § Storage below for the three-tier detail. Humans keep ownership of their relay credentials so they can use their account outside Skynet if they ever want to (Element on a phone, another Matrix client); their accounts get created externally — the three hand-made accounts today (Alice, Zoe, Laura) are already done, and for future users it happens via runbook when the Skynet user is provisioned. Skynet stores only the Skynet-user-to-mxid mapping (see § Storage). When it needs to act as a human (inbound bridge traffic), it mints a token via admin — the human's password never sits on disk anywhere in Skynet or the bridge. Skynet can also create the DMs between agents and humans with exactly the shape the relay needs, and can force itself into rooms it didn't create so it can manage legacy rooms too.

(Phase B — Telegram bridge substrate promotion + identity modal Telegram section — is out of scope here; it gets added to the roadmap after Phase A completes.)

## Storage

Three tiers of credentials, three homes — chosen to preserve the existing disk-source-of-truth convention for agents, respect user ownership for humans, and give the admin account the single mutable secret it needs.

**The `@skynet-admin` account credentials.** Skynet's existing encrypted-secrets store (same pattern that holds host SSH keys today). One entry, used only by Skynet's Matrix admin client to make admin API calls. This is the ONLY relay credential that lives in Skynet's own storage.

**Agent relay credentials.** `~/.claude/identities/<name>/relay.json` on the target host's disk — the existing fleet convention (established with the id skill's self-register path). Skynet does NOT duplicate these anywhere else. When Skynet is the one creating an agent, it writes this file (via SSH to the target host) after minting the account through admin, following the same shape the id skill's self-register path already produces. When the id skill self-registers (agent-created, hand-created, or any other non-Skynet-driven path), that path is untouched — Skynet is the creator only when it drives the creation, and the reader in every other case (fleet-scan reads relay.json to know an existing agent's mxid).

**Human relay credentials.** Not stored anywhere in Skynet or on disk — owned entirely by the human. Only the **mxid** (an identifier, not a credential) has to be looked up by Skynet, and that goes into a new column on Skynet's users table (`mxid TEXT`, alongside username, password hash, TOTP secret). Users are already Skynet's SQLite record; mxid rides along in the same row. No new disk convention for humans, no duplicate storage.

### Failure mode for Skynet-driven agent creation

The Skynet-driven agent creation sequence is three steps on the target host:

1. Write the identity folder + `<name>.md` + frontmatter (SSH, existing Phase 66 pattern).
2. Call Matrix admin API on the relay to create the account (returns credentials).
3. Write `~/.claude/identities/<name>/relay.json` to disk on the target host (SSH).

If step 2 or 3 fails, Skynet does NOT roll back step 1. The identity folder stays on disk; Skynet surfaces a "relay account creation failed, identity exists but is not relay-reachable" error and offers a retry path.

The rationale is a real race: agent-supervisor on the target host sees the on-disk identity folder as soon as step 1 lands and can start spinning up a tmux session for that identity before Skynet even knows step 2 or 3 failed. Rolling back the folder at that point would delete something the supervisor is already dealing with — worse than leaving a partial state. The partial state is also already handled gracefully by the id skill's existing "carry on without relay.json, create it on next wake or by hand" failure mode; nothing new to invent.

## Philosophy (all apply to Phase A)

**The relay is Skynet's, not something Skynet consumes.** Every design fork that used to exist because Skynet had to detect a world it didn't own goes away because Skynet owns the world. If code ever needs to inspect the relay's state and react to what it finds, ask whether Skynet should have made that state directly. Usually yes.

**Wrist-reachability is per-identity opt-in.** Not every identity earns a Telegram bot; the human picks. Bots are a scarce resource (Telegram caps the count per account), and the whole point is that the human is deliberate about which agents get to interrupt them on the wrist. (This applies to Phase B; noted here as context for the foundation's design.)

**Zero message loss; single-digit-second delay is fine.** The reliability floor is that no wrist notification silently disappears. Delays measured in seconds are invisible to the user. Drops are not. (Phase B invariant; the admin foundation must not introduce a class of message-loss precondition — e.g. race between account-creation and first-message.)

**The bridge stays independent code.** Nina's bridge is not being absorbed into Skynet as source; it's being packaged, distributed, and configured by Skynet, but the bridge process runs on its own and can be reasoned about on its own. If Skynet is unhealthy, the bridge still bridges. (Phase B constraint; the Phase A admin client should not create a hard dependency the bridge later needs.)

**Each Skynet box is its own island.** Multiple Skynet deployments each stand up their own relay, their own bridge, their own admin. Nothing federates. Nothing shares. If the mental model of "one Skynet box, one relay, one bridge, all owned by this Skynet" ever breaks, the design has been violated.

**Humans own their relay credentials.** Skynet has admin over the relay and could trivially create accounts on humans' behalf, but doesn't — those credentials would be locked inside Skynet and the human couldn't use their account elsewhere. So human account creation stays external (runbook-driven for new users, already-done for the three existing accounts) and Skynet only holds the Skynet-user-to-mxid mapping. Agents don't have that concern, so Skynet creates and owns agent relay accounts as before.

## Prior context

The relay already runs on the box that hosts Skynet — a Matrix homeserver Alice set up before Skynet knew about the relay at all. Nelly built it; Nicole owns it now. Skynet consumes it (agents register on it, DM each other and Alice through it) but doesn't manage it. Half of the fleet's agents are already Telegram-bridged through Nina's hand-configured script; the other half aren't yet, and adding one today means editing a JSON file on the box by hand and restarting a service.

The bridge holds each human's Matrix password on disk so it can re-log-in that human's account when the token dies. **⚠️ This claim needs ground-truthing in discuss-phase against `/home/thenasty/.config/tg-bridge/bridge.sh` (see Open flag above).** If it holds, the admin foundation removes this load-bearing security surface: with admin, Skynet mints tokens on demand and no password ever needs to be stored anywhere except in the human's head.

Older DMs between agents and Alice exist on the relay in several shapes. Some are cleanly created by agents. Some were created by Alice through Element and are therefore encrypted. Some are frozen because their creator agent has been retired. This is the class of mess that "Skynet detects and reuses an existing room" would run into without the admin foundation underneath — Skynet couldn't cleanly manage those rooms without the ability to elevate itself into them.

The relay migrated from Continuwuity to Synapse earlier this year. Server-admin was mostly untouched during that migration. Nicole recently minted a Skynet-owned admin account and passed the credentials over on 2026-09-05; those credentials are parked in the `skynet-matrix-admin-integration` bounty's `credentials.txt` waiting for the code that consumes them to exist.

Skynet already knows about multiple humans. This box has three users; the company's box has seven. Sharing of identities across humans is not currently practiced, but the model supports it. The bridge's registry schema also supports one identity bridging to multiple humans; that capability is preserved in the bridge but not surfaced in Skynet's UI for the first version.

## What would make it wrong (for Phase A)

If configuring a new agent identity on Skynet does NOT atomically create its relay account (with rollback if either half fails and a clear failure mode surfaced to the caller), the design has failed. The whole point of the admin foundation is that identity lifecycle stops being two independent worlds.

If any human's Matrix password lands on disk anywhere in Skynet or the bridge, the design has failed. The whole point of the admin foundation is that Skynet mints tokens on demand. The old bridge did the password thing by necessity (if the ground-truth check confirms this); the new setup must not.

If Skynet still has to reason about "does this DM room exist, is it the right kind, can I use it" as a fork in the code path (from Phase B onward), the design has failed. That fork was the smoke telling us we needed the admin foundation; if it reappears in the built version we didn't actually build the foundation.

If two different Skynet boxes ever share a relay, a bridge, or an admin, the design has failed. Each box is its own island. Cross-box coupling defeats the deployment model.

## Scope edges

**In.**
- A Matrix admin client on the Skynet side that wraps the relay's admin API (`/_synapse/admin/v1` and `/_synapse/admin/v2`).
- Storage of the `@skynet-admin` account credentials in Skynet's existing encrypted-secrets pattern (see § Storage — this is the ONLY relay credential in Skynet's own storage).
- Skynet identity-creation propagating to relay-account creation for **agents** — Skynet mints the account via admin and writes `~/.claude/identities/<name>/relay.json` to disk on the target host per the existing fleet convention. Skynet does NOT duplicate the agent's credentials in its own DB or encrypted-secrets store. Failure mode is partial-tolerated (NOT rollback) — see § Storage → Failure mode.
- For **humans**, a **non-UI backend endpoint** (admin-gated, same pattern as `POST /users/create`) that registers an externally-created mxid against a Skynet user, landing it in a new `mxid` column on the users table. Same endpoint serves both the new-user provisioning runbook and the one-shot import for the three pre-existing hand-made accounts (Alice, Zoe, Laura). Human relay accounts are always created externally and remain owned by the human; Skynet stores only the mapping and mints tokens on demand via admin.
- Skynet ability to force-manage any relay room via the admin API (join, elevate self to admin in the room, cover legacy-room mess).

**Out.**
- The Telegram bridge itself — that's Phase B.
- The identity modal Telegram section — Phase B.
- Federation between Skynet boxes or shared relays across deployments.
- A Skynet UI for the Matrix admin itself (room management, invite/kick, human moderation through Skynet). This design touches the admin capability, not an admin UI on top of it — that's later, if ever.
- Any changes to how agents DM each other, which continues to be the existing relay path unchanged.
- A Skynet PWA or in-app notification story; this design specifically pivoted away from that.
- **Any new frontend UI at all in Phase A.** Relay accounts are not a Skynet frontend affordance: new humans get their account created externally at Skynet user provisioning via runbook, and the three existing hand-made accounts (Alice, Zoe, Laura) import their mxid via a backend/CLI path. No admin panel, no relay-account form, no "manage credentials" surface. (The single new UI in the entire build — the identity-modal Telegram section — is Phase B.)

**Deferred.**
- **Deletion propagation and rename propagation.** Skynet has no identity-deletion or -rename surface today, so there's nothing on the Skynet side to trigger them. When either surface gets built, its propagation gets added at that time.
- Automated migration of the legacy encrypted or frozen rooms — Phase B covers "Skynet-created rooms going forward"; legacy rooms remain reachable through their existing setup, and where a stale room is unbridgeable, a companion plaintext room can be created and both coexist.

**Tempting but no.** Reaching for the admin API to also manage the coordinator/actor dispatch mechanic — coordinators are their own concept in the fleet, and they get relay accounts the same way everyone else does; special-casing them here couples two unrelated things.

## Vehicle notes

GSD phase (this Phase 77) inside `/build telegram-bridge`. Sequential to Phase B.

**Phase A completion criterion:** creating a Skynet agent-identity creates its relay account in the same operation (atomic), human users have their externally-created relay mxid registered with Skynet via a non-UI provisioning path (both new-user runbook and import for the three existing accounts), and Skynet can force-manage any relay room via the admin API.

Phase B (Telegram bridge substrate promotion + identity modal Telegram section) sits on top of this and gets added to the roadmap after Phase A completes. The shape of Phase B assumes Phase A's admin client exists. If a natural split within Phase A becomes obvious during discuss-phase, decompose further at that time.

Related artifacts already on disk:
- `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/` — opened during the /open discussion. Parks the admin credentials Nicole minted (in `credentials.txt`, chmod 600) and tracks the foundation work. Phase A adopts this bounty; the bounty either winds down or merges into the phase.
- `substrate/skills/agent-relay/` in this repo — the fleet-distributed skill that documents the relay. May want light updates during Phase A to reflect Skynet's admin role once it lands.

Identity holding this phase: Tina, on t1000. She has the parked credentials, the /open discussion history, and the peer-coordination channels to Nelly / Nicole / Nina where the substrate side gets handled.
