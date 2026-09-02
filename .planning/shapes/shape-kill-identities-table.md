# Shape: kill the identities table — disk becomes the sole source of truth

**Opened:** 2026-09-02
**Vehicle:** GSD phase

## What this is

Skynet currently keeps a roster of every fleet identity in its own database — a row per identity, holding an internal identifier, a name, an owning user, and two timestamps. This phase eliminates that roster entirely. Skynet learns which identities exist by asking every reachable fleet host what identities live on its disk, on every request. The identity IS its disk folder on some host, full stop; nothing about it lives inside Skynet's database anymore.

## Shape

- **Roster elimination.** Skynet keeps no local list. When the frontend asks "give me the fleet," Skynet fans out to every host the logged-in user has access to, reads what identities live on each host's disk, and returns the merged view. Every request, every time.

- **Name is the key.** The internal database identifier disappears. Everywhere the current system says "the identity in slot X," the new system says "the identity named X." The lowercase name is already fleet-unique by convention and is already how the frontend indexes identities internally — so the change is mostly a matter of switching the wire protocol from slot-id to name in the three URL patterns that still expose it (fetch avatar, edit cosmetics, and share — the last of which is being deleted anyway).

- **No cache.** Enumeration is synchronous per request. The list waits for reachable hosts (or their timeouts) before rendering.

- **Birth flow survives.** The user-facing "create a new identity" flow stays intact. The backend just does the disk-side work — create the folder on the target host, write the frontmatter, save the avatar bytes — instead of also inserting a row.

- **Clone flow survives.** Cloning a new identity from an existing one still works through the UI, and lands on the SAME host as the source, with source cosmetics copied into the new folder.

- **Share flow dissolves.** It existed to give one user the cosmetics another user had; that job goes away when disk is universal. Endpoint deleted.

- **Delete flow dissolves.** Not wired to the UI today, dead endpoint, removed as part of the cleanup.

- **The migration itself.** Physically drop the roster table. The name column, the internal identifier, the owning user, both timestamps — all gone.

## Philosophy

- **Disk is truth.** The identity's folder is the identity — its existence, its name, its cosmetics, its role artifacts. Skynet is a reader, not a bookkeeper.

- **Skynet gets out of the identity-metadata business entirely.** Ownership, uniqueness, freshness — all of it moves to disk. Phase 66 already moved cosmetics; this phase finishes the job by moving the roster itself.

- **What this deliberately isn't doing:** caching. Cross-host coordination. Solving the "same identity name on two different hosts" collision problem. Deriving timestamps from disk file mtimes just because we could. Those are all real questions but not for this phase.

## Prior context

Phase 66 moved cosmetics (title, colorHue, voice, avatar bytes) out of the roster table and onto disk. What was left was an ownership anchor — an identifier, an owning user, a name, two timestamps — with nothing meaningful in it anymore.

Phase 66's leftover surfaced live during the post-ship: identities created directly on-disk (never inserted into Skynet's roster) don't appear in the fleet list, and their sessions render as raw terminal panes instead of identity-attached chats. That's the bug this phase closes.

The frontend already keys internally on the identity name (lowercased) — the store's index is name→identity, list rendering uses the name, session-to-identity matching uses the name. The internal identifier was only ever a URL segment for mutation endpoints; nothing on the frontend depends on it logically.

The user column on the roster only ever routed cosmetics to the right user (some users had cosmetics for an identity, others didn't). With cosmetics on disk and everyone reading the same disk, that job doesn't exist anymore. The share flow existed for the same reason and becomes obsolete for the same reason.

Neither timestamp is read anywhere in the current codebase. "When created" is written at insert and never looked at. "When updated" gets bumped on cosmetic edits as a "something happened" signal, but the frontend doesn't read it. Both are dead weight.

## What would make it wrong

- **The user-visible flows regress.** Birth, clone, the identity picker, the badge on chat bubbles, the row in the conversation list, the edit-cosmetics modal, avatar renders — if any of those work differently from the user's perspective after the migration, something was broken that wasn't supposed to be.

- **The motivating bug doesn't actually close.** If a fresh identity created directly on some box's disk still doesn't show up in Skynet's fleet list on next enumeration, this phase hasn't done what it was created to do.

- **The mobile experience degrades beyond "the list takes a moment to load."** The no-cache decision assumes the fanout is fast enough on cellular for the delay to be tolerable. If it turns out not to be, that's the failure signal to revisit caching in a future phase — but if we ship and Skynet on cellular becomes noticeably painful, we've missed the point of the tradeoff.

## Scope edges

**In:**
- Drop the roster table.
- Enumerate identities by fanout to each enabled host per request.
- Migrate the three URL patterns that use the internal identifier to use the name instead.
- Clean up the wire type — drop the identifier, both timestamps, and owning user from responses and from the frontend's identity shape.
- Rewire the birth flow to disk-only.
- Rewire the clone flow to disk-only, same-host.
- Delete the share endpoint and everything that feeds it.
- Delete the delete endpoint (dead code).
- Physically drop the table via migration.

**Out:**
- Caching or background rolling poll of the roster.
- Cross-host collision detection (two hosts having a folder with the same name).
- Cross-host cosmetics sync (writes only reach the target host).
- Preserving anything from the existing table rows during the drop.

**Deferred:**
- If enumeration latency turns out to hurt on cellular in practice, revisit caching / progressive rendering in a later phase.
- If cross-host collisions start actually happening, address in a dedicated future session.

**Tempting but no:**
- Don't derive "when was this identity created" or "when last touched" from disk file mtimes just because we can. Nothing needs those.
- Don't try to solve the cross-host cosmetics-write-race here — it's not a new problem and it isn't what this phase is for.

## Vehicle notes

GSD phase. Full pipeline: discuss → plan → execute → verify. Anticipated slot is Phase 69 per the bounty, subject to auto-resolve if the number collides with another maintainer's in-flight phase.

Bounty at `~/.claude/roles/box-maintainer/bounties/kill-identities-table-phase-68/` holds the original premise Ashley greenlit on 2026-09-01, plus the call-site inventory list from ship-day.

Consumer inventory produced during this shape discussion (five backend endpoints, five frontend surfaces, timestamp read/write analysis, identityKey origin/consistency, cross-references to Phase 66 summaries) should seed discuss-phase — don't re-elicit facts that were already established here.

Identity holding this work: tina.
