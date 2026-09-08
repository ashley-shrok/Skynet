# Shape: relay group conv — sub-slice B: session-model generalization + room-join materialization

**Opened:** 2026-09-08 (seed only — the sub-slice's `/open` conversation happens at the start of the session that picks this up)
**Vehicle:** `/build` (sub-slice of the parent multi-phase arc)
**Bounty:** `relay-session-model-generalization` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`).

> This is a SEED, written from the master shape as a running start for the sub-slice's `/build`. When the `/build` on this shape kicks off, its `/open` refines this into the final agreed shape file — grill remaining unknowns, adjust wording, close out.

## What this is

Skynet's back-end session model grows a second kind, sitting alongside the existing harness-backed session. All existing sessions stay intact and behave identically. The new kind's durable anchor is a room membership rather than a driving harness. When a user's relay identity joins a room by any route — created via the new-conversation flow from sub-slice C, invited from outside Skynet by another agent, or auto-joined by the receiver on a peer-agent invite — Skynet materializes a session record for that user + room and adds a sidebar entry. Backend-heavy slice; no visible pane rendering (that arrives in sub-slice D) and no create-room UI (that arrives in sub-slice C).

## Shape

Whatever object represents "a session" in Skynet's storage today grows a discriminator — a "kind" or "type" field — with a default of "harness" for the existing case, and a new "relay-room" case. Every existing session record, on migration, becomes kind=harness with no semantic change. New relay-room sessions carry the fields the room-backed kind needs: a room ID on the relay, the user this session record belongs to, whatever metadata is needed for the sidebar entry (title, recent activity timestamp, sort key), and nothing more. The room's members list and message history are NOT copied into Skynet — those stay on the relay as source of truth and are queried live.

The materialization pathway is: Skynet observes each user's relay-identity room memberships (the mechanism is a design question for this slice's `/open` — is it a poll, a subscription, or piggybacking on some existing membership-observation code path). When Skynet notices the user is a member of a room it doesn't yet have a session record for, it creates one. When Skynet notices the user is no longer a member (in v1 this is only possible by an external actor removing them, since leaving isn't v1), the session record's state adjusts appropriately (needs discussion in `/open`).

The existing session code path — read, list, open, close a harness-backed session — is completely untouched. Any code that reads a session record and behaves based on its shape either doesn't need to change (because it only touches the shared fields) or gets an explicit branch on the kind discriminator, with the existing behavior on the harness branch identical to today.

## Philosophy

The existing session type is inviolable. Every piece of new logic in this slice is additive; existing code paths get zero new behavior. The orthogonality invariant from the master shape (the two session types are truly parallel — bugs in one shouldn't propagate to the other) is enforced HERE, in this slice, by keeping the branching narrow and the shared fields minimal.

Skynet doesn't decide "you're in this room." The relay does. Skynet observes and mirrors. That means the source of truth for room membership is always the relay; Skynet's session records are a cached representation. If they ever disagree, the relay wins.

Materialization on join is what enables the "invited from outside" case cleanly. A user's receiver auto-joins invites already; the observation piece here is what turns that auto-join into a visible sidebar entry with no explicit user action.

## Prior context

Per the master shape: agents already have this substrate (their receivers watch every room they're a member of and wake on messages, auto-joining invites). What's being generalized is the SKYNET side of the story — the front-end sidebar and session-open flow — to know that a room the user's relay identity is a member of is a thing that can appear as a session.

Sub-slice A guarantees every user has a durable relay identity by the time this slice runs. Depend on that.

## What would make it wrong

- A fix or change to the existing harness-session code path bleeds behavior into the new relay-room case, or vice versa. The orthogonality invariant broke.
- A user joins a room externally, but no session record materializes and the room never appears in their sidebar. The observation loop missed a case.
- Session records get created for rooms the user has since left (in an external-actor-kicked scenario) and then dangle forever with no way to clean them up.
- Two session records get created for the same (user, room) pair because the observation loop races with the create-room flow from sub-slice C.
- The materialization logic queries the relay so aggressively that it becomes a load problem on the homeserver.

## Scope edges

**In.**
- Schema addition (kind discriminator + relay-room-specific fields).
- Session-record CRUD paths for the new kind (create, list, read, update, mark-inactive).
- Room-membership-observation → session-record materialization loop, however implemented.
- Enough coverage in the observation loop that ALL join paths get caught (new-conversation-flow create, external invite auto-joined by receiver, direct join by any other route).

**Out.**
- Front-end pane rendering (sub-slice D).
- The new-conversation modal (sub-slice C).
- Anything that pushes data BACK to the relay other than as needed for session-open bookkeeping.

**Deferred to a later revision.**
- Pruning session records for rooms the user has voluntarily left (leaving isn't v1, per master shape).
- Any per-session state beyond the minimum (unread markers, last-read timestamps, custom labels).

**Tempting but no.**
- Caching the room's member list or recent messages in the session record. Members and messages live on the relay; Skynet queries them live.
- Piggybacking any additional session concepts onto this discriminator (e.g. adding an RDP-session kind while we're here). One thing at a time; RDP is out of scope for this arc entirely.

## Vehicle notes

`/build` cycle. Depends on sub-slice A. Unblocks sub-slices C and D (which can then run sequentially or in parallel).

When the `/build` fires, its `/open` conversation should:
- Grill the observation mechanism (poll interval? subscribe? piggyback on some existing code path?).
- Grill the schema shape (single sessions table with a discriminator, or two peer tables?).
- Grill the failure mode when the relay is briefly unreachable (does materialization pause, retry, degrade?).
- Grill the race between new-conversation-flow create (sub-slice C) and observation-loop materialization — how do we avoid creating two session records for the same room.

Codebase touch points to look at during that discussion (not yet inspected):
- Skynet's session storage today (where a session record lives, its schema).
- Any existing Matrix-client code Skynet uses (from Telegram-bridge work or otherwise).
- Session lifecycle code paths (create, close, list).
