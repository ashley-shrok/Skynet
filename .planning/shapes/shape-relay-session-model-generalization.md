# Shape: relay group conv — sub-slice B: session-model generalization + room-join materialization

**Opened:** 2026-09-08 (seeded) · refined + closed the same day into the final agreed shape below.
**Vehicle:** GSD phase (single phase — the slice is coherent as one). Full pipeline: phase → discuss (seeded from this shape) → plan → execute → verify. Auto-proceed plan→execute per the standing rule. Then unbiased general-purpose subagent code review, hand-off, hold at push per the deploy-window rule.
**Bounty:** `relay-session-model-generalization` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`).
**Close it out with:** `/close relay-session-model-generalization`

## What this is

Skynet grows a second kind of conversation-list entry, sitting alongside the existing harness-backed one. The existing kind — a session backed by a driving harness (a Claude session running in a tmux on some host) — stays exactly as it is today. The new kind is anchored to a room membership on the relay: when a user's relay identity is a member of a room, that room appears as an entry in the user's conversation list, unless the room is specifically the two-party (user + one agent) pattern that harness sessions already cover. Materialization happens by observation, driven by Skynet using its existing admin credential on the relay to poll each user's joined-rooms list on a short cadence; membership changes flow into a small stored table of relay-room entries which the conversation-list endpoint merges with the derived harness sessions before returning.

## Shape

**Two peer paths, not a discriminated single record.** Skynet has no stored session-record table for harness sessions today — the conversation list is derived at request time by SSH-polling hosts and enumerating tmux + on-disk session state. That derived pathway stays completely intact. The new relay-room kind gets its own small stored table (rows anchored to `(user, room)`, with room title, state, last-activity timestamp, and standard timestamps). The conversation-list endpoint gains a merge step: [derived harness sessions] + [stored relay-room rows in active state] → one flat list back to the frontend. Each item in the merged output carries a kind marker so the frontend knows how to open/render it.

**The observation loop.** Skynet, using its existing admin credential against the homeserver, polls per user on a short cadence (~10s target). Each tick asks two things for a user: (1) what rooms is this user's relay identity a member of, and (2) what is the latest event timestamp per those rooms. Membership diff against the stored table drives materialize / mark-inactive. Latest-event timestamps update each row's last-activity so the sidebar sort order tracks real recency, not just membership transitions. Per-user tick scheduling and per-user backoff state — one user's failing tick doesn't stall observations for other users.

**Race guard between this loop and sub-slice C's create-room flow.** Both paths call the same "materialize this room for this user" primitive. A database-level uniqueness constraint on `(user, room)` makes the second write a no-op regardless of order. No coordination logic between the paths — the schema is the coordinator.

**External-kick handling.** When a user is no longer a member of a room the stored table has an active row for, the row transitions to inactive state — it is NOT deleted. Listing filters on state. Keeping the row preserves history navigation, and if the user is re-invited later the same row flips back to active rather than a fresh row being created (which also protects the uniqueness constraint from having to be scoped to active-only).

**Agent vs. human identification — via registry rooms.** Two rooms on the relay: an "agents" registry room and a "humans" registry room. Skynet creates both, and joins each account it creates into the appropriate one at account-creation time (agents at identity birth, humans at user onboarding — Skynet is already the account-creator for both, so both hooks live on Skynet's side). The exclusion check on a two-party (user + one other) room becomes: is the other member's account a member of the agents registry room? Yes → exclude (harness-covered). Is it in the humans registry room? No → materialize (real human DM). In neither → materialize conservatively (foreign / unknown-origin account). Registry-room membership is homeserver-persistent — an agent can be offline for a week and the exclusion still works, closing the host-down failure mode of a disk-based check.

**The registry rooms themselves must not appear as conversation-list entries** (they have many members and would otherwise trigger the multi-member materialize rule). Skynet holds a small internal "admin rooms" ignore-list, populated with the registry rooms' IDs at the moment Skynet creates each one. The observation loop's materialization step skips any room whose ID is in this list. The ignore-list is Skynet-instance-owned (each Skynet's registry rooms have their own IDs), internal (no user-visible surface, no admin console — Skynet manages it), and general-purpose (future admin-purposes-only rooms can be added to it too).

**One-time backfill on rollout.** Existing agent and human accounts predate the registry rooms. Skynet enumerates its known agents (via the fleet-status roster it already maintains) and its known humans (from its own user record), and joins each into the appropriate registry room once. First-boot / deploy-time script, idempotent.

**Failure behavior when the relay is briefly unreachable.** A failing poll tick DOES NOT destroy or mark-inactive any existing session records — absence of observation is not evidence the user left the rooms. The tick backs off (10s → 30s → 60s, cap at ~5 min), retries. When a tick eventually succeeds, that tick reconciles — new memberships materialize, missing memberships transition to inactive. The sidebar shows what it last saw during the outage; no failure banners or grey-outs surface to users. Failures land in Skynet's logs, not in the UI.

## Philosophy

The harness pathway is inviolable — this slice is purely additive to it. Zero new behavior on the derived-at-request-time path; the new stored path lives beside it, orthogonal, and touches the harness pathway only at the merge point in the conversation-list endpoint.

The relay is the source of truth for room membership. Skynet observes, mirrors, caches. If Skynet and the relay disagree, the relay wins on the next reconciling tick.

Skynet already runs an admin account on the relay for other purposes; the observation loop rides that credential rather than introducing per-user Matrix sync clients or receiver-side observation hooks. Simpler substrate, one credential to keep healthy, no new persistent daemons.

Registry-room-based classification means the "is this an agent?" question survives host downtime, receiver failures, disk corruption, and account-name-format changes. The membership event on the homeserver is the durable, authoritative signal.

## Prior context

Per the master shape: agents already have receiver substrate (they watch every room they're a member of, wake on messages, auto-join invites). What's being generalized here is the SKYNET side — the sidebar and session-open backend — to know that a room the user's relay identity is a member of can appear as a conversation-list entry.

Sub-slice A guarantees every user has a durable relay identity by the time this slice runs; depend on that.

Skynet's session storage today is asymmetric — the conversation list is derived at request time by SSH-polling hosts (there is no session-record table for harness sessions), and identities are per-box disk folders rather than a Skynet-side registry. Skynet DOES create Matrix accounts today for both agents (via the identity-birth pathway, since Phase 75 landed the admin-side minting) and humans (via user onboarding), so the natural hook for registry-room joins is Skynet-side at account-creation time — no changes needed to the id-skill's own self-register block, which is now a legacy/fallback pathway.

Skynet already has an admin credential against the homeserver, used elsewhere; the observation loop rides it rather than adding new auth substrate.

## What would make it wrong

- **Bleed between the harness pathway and the relay-room pathway.** A fix or feature on one accidentally changes behavior on the other. Orthogonality broken.
- **A user joins a room externally but no entry materializes.** The observation loop's coverage of join paths is incomplete (new-conversation create from sub-slice C, external invite auto-joined by receiver, direct join by any other route — all must be caught).
- **A two-party (user + one agent) room shows up as a duplicate entry** because the agent's account wasn't in the agents registry room at check time. Registry membership is the load-bearing signal for exclusion; if it's wrong, duplicates leak into the sidebar.
- **A registry room itself appears in the conversation list.** The ignore-list missed it, or the ignore-list wasn't populated on the Skynet instance that created the room. Users see a giant many-member "agents" room in their sidebar.
- **A relay outage silently destroys session records.** The observation loop treated a failed poll as evidence the user left every room, and marked everything inactive. The sidebar goes empty; the user thinks the feature broke.
- **Two entries for the same (user, room) pair** — a race between the observation loop and the create-room flow slipped through because the uniqueness constraint wasn't enforced at the schema level.
- **Materialization is so aggressive it becomes a load problem on the homeserver.** Poll cadence is too tight, or per-user backoff isn't respected, and Skynet hammers the admin API.
- **A dangling stored row survives after external kick** in a way that lets a stale sidebar entry silently degrade UX — active-state filtering wasn't applied at the listing endpoint, or state transition didn't fire on the observed kick.

## Scope edges

**In.**
- New stored table for relay-room sessions, with the row shape agreed above.
- The uniqueness constraint on `(user, room)` and idempotent write semantics on both paths.
- The observation loop, with per-user ticks, per-user backoff, and same-tick fetch of membership + latest-event timestamps.
- The conversation-list endpoint's merge step: derived harness sessions + active stored relay-room rows.
- Two registry rooms (agents + humans), created by Skynet at first-boot / rollout.
- Skynet-side account-creation hooks that join each new account into the appropriate registry room.
- One-time backfill: enumerate existing agents + humans, join each into its registry room.
- The admin-rooms ignore-list (starts with the two registry rooms), consulted by the observation loop.
- The state transition on external kick (active → inactive), and re-invite reactivation (inactive → active on the same row).
- Failure semantics for the observation loop (no destruction on failure, backoff, per-user isolation).

**Out.**
- Frontend pane rendering of a relay-room session (sub-slice D).
- The new-conversation modal / create-room UI (sub-slice C).
- Anything that pushes data back to the relay other than what's needed for session bookkeeping (registry-room joins at account creation, registry-room creation on rollout).
- Migrating the harness pathway into stored records. The derived-at-request-time pathway stays derived; this slice does not turn harness sessions into stored rows.
- Any new persistent daemon or per-user Matrix sync client on the Skynet side.

**Deferred to a later revision.**
- Pruning inactive relay-room rows (they accumulate forever in v1; a cleanup pass is a later concern).
- Voluntary user leave from a room (not v1 per the master shape; the state transition is only on external kick).
- Per-session UI state beyond the minimum (unread markers, last-read timestamps, custom labels).
- User-visible admin surface for the ignore-list.

**Tempting but no.**
- Caching the room's member list or recent messages in the stored row. Members and messages live on the relay; Skynet queries them live as needed.
- Piggybacking additional session-kind concepts onto the same substrate (e.g. an RDP-session kind while we're here). One concern per slice.
- Real-time membership subscriptions from the homeserver. Polling at ~10s cadence is enough for the sidebar's UX; sync-client substrate is a bigger lift than warranted for the freshness gain.
- Per-user Matrix credentials for the observation loop. The existing admin credential covers all users cleanly and centralizes the auth story.

## Vehicle notes

GSD phase, coherent as one slice. Discuss-phase seeds from this file. Plan-phase produces a task breakdown; the natural plan slices are: (1) stored table + row primitive + uniqueness + state transitions, (2) registry-room creation + backfill script + ignore-list plumbing, (3) observation loop with per-user backoff + same-tick augmentation, (4) conversation-list endpoint merge + kind-marker on output. Execute auto-proceeds after plan-review. Verifier confirms goal achievement. Then the unbiased general-purpose code-review subagent per the /build pipeline; then hand-off; then hold at push per the deploy-window rule until Ashley greenlights.

Depends on sub-slice A (already landed as Phase 88). Unblocks sub-slices C and D — either sequential or parallel afterward.
