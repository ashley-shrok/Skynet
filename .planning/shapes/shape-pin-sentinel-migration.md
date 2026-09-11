# Shape: Pin sentinel migration — DB → on-disk `.pinned` per identity

**Opened:** 2026-09-09
**Vehicle:** GSD phase (Shape 1 of the id-skill-revamp multi-shape campaign)

## What this is

The chat app has a pin affordance in its UI — the user taps a toggle on a conversation row and it stays visible on the list regardless of activity. Today, that pinned-ness is stored as a row in the chat app's own database, and any process on the identity's host that wants to know whether the identity is pinned has to reach back into the app to ask. This work moves the pinned-ness out of the database and expresses it as the presence or absence of a small marker file inside the identity's own folder on its host — the same pattern already established for two prior pieces of per-identity intent, the "never let me go dormant" opt-out and the "please recycle me now" sentinel. After this ships, disk is the single source of truth for pinned-ness; the app's database no longer participates in the answer.

## Shape

The pinned-ness IS the marker file's presence. Present in the identity folder = pinned. Absent = not pinned. The file itself carries no content — no timestamp, no admin identifier, no state — and the file body is never read. Only the answer to "does this file exist" ever matters.

When the human toggles pin in the chat UI, the app performs a synchronous write over the same host file-touch mechanism it already uses to place per-identity files on hosts. Pinning writes the marker; unpinning removes it. The action succeeds or fails right now — success flips the row's rendered state on the next read, failure reuses whatever generic wire-error treatment the app already surfaces for other failable operations. No queue, no optimistic-then-reconcile UI, no shadow "desired state" store.

When the app renders a conversation row and needs to know whether to draw the pin indicator, it reads the sentinel the same way it already reads other per-identity disk fields (task, cosmetic fields) — on-demand from disk when serving the identity's metadata to the UI. There is no in-memory pin cache and no database pin mirror. Any host-side process that later needs to consult pin state (the per-host supervisor's future archive-idle-scan is the anticipated consumer) reads the sentinel locally with a bare presence check on the folder.

The chat app's database schema loses its pin table in the same code change. Migration for existing pinned identities is a manual per-box maintainer step — the box's maintainer touches the marker file in each currently-pinned identity's folder on that box, sequenced with the code deploy on that box in whatever order suits. No migration code participates.

## Philosophy

Host-local intent belongs on the host. Two prior sentinels already establish the pattern; matching them for pin rather than inventing a new mechanism is deliberate consistency, not novelty. One source of truth per fact — the disk state IS the pinned-ness, not a mirror of it, not a subordinate to a database flag, not something reconciled against a queue. The whole reason to move off the database is to eliminate the drift risk that comes from two records of the same fact; anything that reintroduces that risk (a shadow desired-state store, an in-memory cache the row-render trusts, a database table left dormant) violates the spirit of it.

Simplicity is the guardrail. The UI feel doesn't change. The failure UX doesn't get a bespoke treatment. Migration doesn't get a scheduler or a reconciliation loop. Deliberately minimal — the shape is a straight plumbing move, not a UX pass or an architecture rework.

## Prior context

Two sibling sentinel files already exist in each identity folder and are read by both the on-wake behavior documented in the id skill and the per-host supervisor: the "always-on" opt-out and the "recycle me now" request. Both use the same "presence is meaning" pattern this shape adopts.

The chat app's backend already has a proven host file-touch wire — the identity-birth flow uses it to place the relay credentials file into a new identity's folder at creation time, authenticated over the same auth path the app uses for its other host operations. That wire currently has one caller (identity-birth); this shape generalizes it into a per-identity file-touch primitive that the pin action also uses.

Recent architectural direction has moved identity-level state off the database and onto disk. The task field just shipped in a recent phase as a disk-only frontmatter entry; the cosmetic fields (title, hue, voice, avatar) migrated to role-level frontmatter in another recent phase; the identities database table was killed in an earlier phase. Pin is the natural next piece to move.

Downstream from this shape: the per-host supervisor gains an archive-idle-scan feature in Shape 2 of this campaign, which needs to skip pinned identities without any cross-service call. This shape exists partly to make that Shape 2 straightforward — the sentinel needs to exist before the supervisor can check for it.

## What would make it wrong

Any code path that reads pinned-ness from a source other than the sentinel file itself — an in-memory cache that could drift, a database shadow that outlives the migration, a re-derivation from ambient state. All are versions of the two-sources-of-truth failure this whole move exists to eliminate.

A write path outside the human's toggle in the UI. Auto-pinning from activity heuristics, background pin-syncing jobs, batch pin operations dispatched from a script — all would violate "the UI is the sole author of pin state." If the human didn't tap it, it doesn't get pinned.

The database pin table left as dead code after the schema migration doesn't drop it. Even unread, its existence invites a future maintainer to re-consult it and re-open the drift.

A pin action that "succeeds" in the UI when the wire actually failed. Silent success illusions are the exact failure the synchronous philosophy is designed to prevent.

Encoding anything into the sentinel's file contents. The moment the file body carries state (a pinned-at timestamp, a metadata blob), we're back to two things to keep in sync per identity — the file's existence and its contents.

## Scope edges

**In.** The pin action's write path retargeted from database to the host file-touch wire. Unpin symmetric. The chat app's per-identity metadata read path growing a pin-state field populated from disk-read at request time. The row-render consuming that field the way it already consumes other disk-read fields. The pin table's schema drop in the same code deploy. Generalizing the identity-birth wire into a per-identity file-touch primitive with two callers (birth + pin).

**Out.** The per-host supervisor's archive-idle-scan feature — that's Shape 2 of this campaign. Any change to the pin UX itself (visual treatment, batch pinning, per-role pinning). Any migration code — the database→disk sweep for existing pinned identities is a manual per-box step. Any new failure UX for wire errors — reuses whatever the app already surfaces for its other failable operations.

**Deferred.** Pin metadata beyond boolean (pinned-at, pinned-by, priority). Auto-pinning heuristics. Per-role or per-workspace pinning. A "pin all" or "unpin all" bulk action.

**Tempting but no.** A database mirror cache to speed up row-list rendering — reintroduces drift, and the per-identity disk-read pattern already runs cheaply enough at existing scales. A "desired state" store on the backend that reconciles disk against user intent over time — an eventually-consistent pattern that contradicts the synchronous philosophy this shape locks. Leaving the pin table dormant "just in case" — dead code invites future readers.

## Vehicle notes

GSD phase, one phase, slotted into the roadmap when the phase is allocated. This is Shape 1 of the id-skill-revamp multi-shape campaign; three subsequent shapes (Shape 2: supervisor archive extension, Shape 3: on-disk tree consolidation, Shape 4: substrate prose polish) each get their own `/open` pass and their own phase. Campaign hub bounty is at `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/`; that bounty's timeline and todos are the durable cross-session record, and the original whole-campaign shape file lives alongside as historical context.

The identity-birth wire this shape leans on ships from a recent phase (the telegram-bridge Matrix admin foundation) and its mechanics are proven at a live production identity-birth cadence. Generalizing it into a per-identity file-touch primitive rather than adding a second parallel wire keeps auth, error-handling, and connection lifecycle unified. That primitive lives in the chat app's backend, is called by both the identity-birth orchestrator and the pin action, and is the natural extension point for any future per-identity file-touch use case.

The manual migration step sequenced with deploy is the responsibility of each box's own maintainer on that box; no cross-box coordination code required. On this box, that's a one-shot `touch` per currently-pinned identity right before deploy.
