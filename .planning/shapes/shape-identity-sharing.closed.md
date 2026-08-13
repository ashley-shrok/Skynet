# Shape: identity-sharing — hand one of your identities to another Skynet user from inside the identity modal

**Opened:** 2026-08-13
**Vehicle:** GSD phase

## What this is

A way for a Skynet user to hand one of their identities to another Skynet user in one tap. The affordance lives in the header strip of the identity modal — the one you get when you tap the identity's avatar-and-name badge in a chat. Pick a user from a picker up there, and that identity now appears in the recipient's identity picker too. No exports, no auth juggling, no "log into my account" workaround.

The point is collaboration on the same running agent, not distribution of a template. Both users' picker entries route into the same underlying agent on the actual box — same running tmux, same open bounties, same relay account. Sharing lets a second person drive that agent alongside the first.

## Shape

There is one new affordance and one new hand-over action.

**The affordance.** A picker in the header strip of the identity modal, sitting alongside the existing header elements. Opening it lists the other Skynet users on this deployment. Selecting one is the hand-over — no confirmation dialog, no separate screen.

**The hand-over.** Under the covers, this creates a fresh identity card for the chosen user, carrying the same displayed name, title, color hue, voice, avatar image, and underlying identifier as the source card. It appears in the recipient's picker on their next look. The two cards are independent from that moment on — the source can rename the identity later and the recipient's card will not follow. But because the underlying identifier is the same, both cards resolve to the same running agent on the actual host box.

**What propagation looks like.** Any user who has an identity in their picker — whether they created it or received it via share — can share it onward to yet another user. Sharing is not restricted to the original creator. The identity can spread through the userbase however users choose.

**What re-picking looks like.** Sharing the same identity to the same recipient a second time is a silent no-op on the backend — no error, no duplicate row, just no change.

**What the picker looks like when the deployment has only one user.** No affordance shown at all. Nothing to click, nothing to hover, no empty-list state — it renders only when there is at least one other user to hand to.

**What already-shared recipients look like in the picker.** They appear in the list with a small "shared" marker but stay selectable, so re-picking them (which no-ops) is still allowed and the user can see at a glance who they have already handed the identity to.

## Philosophy

- **Multiplayer on one agent, not distribution of a template.** The mental model is "let someone else drive Tina too," not "give someone a Tina they can fork." If a user wants to fork and diverge, that's a different feature and out of scope.
- **No ceremony.** No approve/accept step on the recipient side, no notification round-trip, no expiring links, no revoke workflow. A Skynet user hands another Skynet user an identity, and it appears in the recipient's picker.
- **Trust the small userbase.** The deployments this actually runs on have a handful of users who know each other. Fine-grained permissions (only-creator-can-share, per-share expiries, audit trails) would be over-engineered for the actual usage.
- **The word "share" is close enough.** It doesn't textbook-embody "share" (no keep-in-sync, no revoke), but it's the natural verb and readers of this feature will pick up the actual semantics from using it. Deliberately not picking a more awkward-but-precise verb.
- **On-disk isolation is a separate problem.** The multi-user-on-disk story (where per-user Unix accounts vs shared-ubuntu vs per-user containers is the deeper split) is parked as a future phase and does not gate this feature. Sharing an identity means multiple users land in the same on-disk identity folder today; that is the current model.

## Prior context

Right now every identity in Skynet is single-owner. If someone else wants to drive an identity you created, they log in as you. That is the workaround this replaces.

There is prior thinking on adjacent territory: the archived "clone identities OR role/identity paradigm" discussion explored right-click Clone in the conversation list to spawn additional sessions of the same identity. That resulted in the id-skill's current role-vs-identity split (multiple identities can share a role), which is a fleet-side concept. This feature is different — it is Skynet-side, about which users' pickers can see an identity, not about how many parallel sessions an identity can run.

There is also an existing per-user credential-sharing pattern in the codebase that re-encrypts shared items with the target user's key. That precedent is more elaborate than this feature needs — identities have no secrets in them, so a plain duplicate suffices.

## What would make it wrong

- **If a recipient's copy silently stays in sync with the source's edits.** The whole model is copy-and-diverge; if a rename on the source side leaks to the recipient's card, the mental model breaks.
- **If sharing is treated as a permissioned action.** If anyone reads "share" and starts thinking "only the creator can share" and builds gates around it, that is the wrong model for this feature.
- **If the recipient has to accept.** Any workflow that adds a pending-invitation state, an inbox item, or a notification round-trip has missed the "no ceremony" point.
- **If re-sharing to the same user errors, duplicates, or otherwise misbehaves.** Users will re-click; the backend has to be safe against it.
- **If deleting an identity on the source side removes it from recipients.** Once shared, the recipient's copy is theirs. Nothing on the source side should reach into their picker.
- **If the picker shows the current user in the list.** You cannot share an identity to yourself; that entry should not appear.

## Scope edges

**In**
- The header picker on the identity modal, listing other Skynet users.
- The hand-over action: on select, duplicate the identity row onto the target user (silent no-op if that user already has it).
- Already-shared recipients shown with a marker in the list, still selectable.
- Empty-state: picker hides when there are no other users.
- Behind-the-scenes route to fetch the list of Skynet users for the picker.

**Out**
- Revoke / un-share. Recipients keep their copy indefinitely. If they want to be rid of it, whatever normal "get this identity off my picker" path exists (or gets built) is the answer, not something in this feature.
- Provenance display. No "shared by Ashley" tag on the recipient's card, no "shared with N users" tag on the source's card.
- Multi-select. One recipient per pick; re-open the picker to hand it to another.
- Recipient-side notification. The identity just appears next time they open their picker.
- Sync of any kind between source and recipient after the hand-over.

**Deferred**
- The multi-user-on-disk isolation story on managed hosts (per-user Unix accounts vs shared-ubuntu vs per-user containers). Parked as a separate future phase; sharing an identity means both users' sessions land in the same on-disk identity folder today.

**Tempting but not this**
- Making this a "clone / fork" feature that gives the recipient a truly independent Tina. That is a different mental model and would land poorly next to this one; not this feature.
- Building the recipient-side accept flow now "just in case." No ceremony is a philosophy commitment, not an omission.
- Encrypting anything for the target. Identities carry no secrets; the credential-sharing precedent does not apply.

## Vehicle notes

**GSD phase**, two waves.

- **Wave 1 (backend).** New endpoint that takes a source identity plus a target user, duplicates the row onto the target user, and safely no-ops if the target already has it. Confirm (or add) a route the frontend can use to list Skynet users for the picker's population. Tests cover happy-path hand-over, no-op-on-repeat, target-is-self rejection, and target-does-not-exist.
- **Wave 2 (frontend).** Picker component in the header strip of the identity modal. Populated from the users list. Hides when empty. Shows already-shared recipients with a small marker. On select, calls the hand-over endpoint and gives lightweight visible confirmation. Tests cover empty-state hiding, populated-state selection, already-shared marker rendering, and self-exclusion from the list.

Fleet-directive notes for the implementing agent:
- Executors do not do deploys. Code + commit + tests green is the executor's stop point; orchestrator picks up rebase + coord announce + build + recreate + verify + push + patch catalog + bounty archive.
- Multi-identity working trees on this box mean rebase past origin before push; announce container mutations in the coord room.

Handoff pointers:
- The affordance lives in the header strip of the identity modal — same strip that already carries the identity avatar and the existing pencil affordance for name/color edits.
- The identity DB row structure and the existing per-user credential-share precedent are the relevant reads. The credential-share pattern is a precedent for the "targetUser" endpoint shape, not for the crypto (identities have no secrets).
- The archived "clone identities OR role/identity paradigm" shape is the closest prior discussion, though the resolution went a different direction (role-vs-identity on the fleet side, not user-share on the Skynet side).

---

## Close-Out

**Closed:** 2026-08-13
**Vehicle used:** GSD phase, two waves (backend Wave 1 + frontend Wave 2)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Row-duplicate hand-over via header-strip picker; copied identityKey resolves to same underlying agent as agreed.
- **Shape: the affordance (header-strip picker on identity modal)** — present · ShareIdentityPicker mounted in DialogHeader alongside Stays-awake switch, pencil, close button; dropdown lists users on open; no confirmation dialog.
- **Shape: the hand-over (duplicate row with same name/title/hue/voice/avatar/identifier, fresh id+timestamps, independent afterward)** — present · Backend insert copies exactly the presentation columns + identityKey; fresh nanoid id and timestamps; no sharedFromId column so no sync path exists.
- **Shape: propagation (recipients can re-share onward, not restricted to creator)** — present · Only permission gate is (id, userId=requester); no creator check; Test 10 exercises share-onward path.
- **Shape: re-picking (silent no-op on backend)** — present · Detected via (targetUserId, identityKey); returns 200 shared:false with existing id; no duplicate insert.
- **Shape: empty-state (picker hidden when only one user)** — present · Backend list-basic returns [] on single-user deployment; picker returns null on null-or-empty users.
- **Shape: already-shared marker (visible but still selectable)** — present · Small Check + "shared" text next to already-shared rows; row is not aria-disabled and click still fires shareIdentity (Test 5 + Test 7).
- **Philosophy: multiplayer on one agent, not template distribution** — present · Copied row shares identityKey which is the underlying identifier that routes to the same running agent.
- **Philosophy: no ceremony (no accept/notification/revoke/expiry)** — present · Endpoint returns success immediately; recipient sees identity next time they open picker; no pending state, no notification.
- **Philosophy: trust the small userbase (no per-user permissions)** — present · Any authenticated user who can see an identity can share it; no admin gate, no audit table.
- **Prior context: no re-encryption for target (identities carry no secrets)** — present · Plain row copy with no key derivation or re-encryption; identities schema carries no secret columns.
- **Scope edge OUT: revoke/un-share not implemented** — present · No delete-share endpoint or UI affordance.
- **Scope edge OUT: provenance display absent** — present · No "shared by X" tag on recipient rows; no "shared with N users" tag on source; schema has no sharedFromId column.
- **Scope edge OUT: multi-select absent (one recipient per pick)** — present · DropdownMenuItem onSelect handles one user per click; menu closes after selection.
- **Scope edge OUT: recipient-side notification absent** — present · Endpoint returns to requester only; no push, no inbox entry.
- **Scope edge OUT: no sync between source and recipient** — present · Rows are independent after insert; no propagation of edits.
- **What would make it wrong: recipient's copy silently stays in sync with source's edits** — present · Guarded — no sync mechanism exists in the schema or router.
- **What would make it wrong: sharing is treated as a permissioned action (only creator can share)** — present · Guarded — explicit block comment locks against creator gating; Test 10 asserts non-creator can share onward.
- **What would make it wrong: recipient has to accept** — present · Guarded — no pending/accept table, no notification round-trip; identity just appears.
- **What would make it wrong: re-sharing to the same user errors or duplicates** — present · Guarded — silent no-op detection at (targetUserId, identityKey); Test 9 asserts 200 shared:false with no insert.
- **What would make it wrong: deleting on source removes from recipient** — present · Guarded — no cascade or FK from recipient row back to source; the two rows only share identityKey which is a value, not a reference.
- **What would make it wrong: picker shows the current user** — present · Guarded — server-side ne(users.id, userId) in /users/list-basic; picker does no re-filtering (documented intentional single-source-of-truth).

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Clean pass. Frontend deliberately owns the alreadySharedUserIds Set as session-scoped state (not cross-session persisted), which matches the shape's decision not to build a provenance-display feature. The picker's identityKey prop is currently unused in render logic and marked as future-proofing hook — cosmetic dead-prop but not a shape divergence. Live surface not yet deployed per handoff notes; review was source-only as instructed.

---

## Close-Out (re-close after post-review fixes)

**Closed:** 2026-08-13
**Vehicle used:** GSD phase, two waves (backend Wave 1 + frontend Wave 2) + three post-close hardening fixes (URL-encode source id, UNIQUE-constraint race fallback, Set reset on identity switch)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — one-tap hand-over from identity modal header** — present · ShareIdentityPicker mounted in DialogHeader alongside stays-awake, pencil, close; POST /identities/:id/share duplicates row onto target user; same identityKey → same underlying agent.
- **Shape — the affordance (header-strip picker, no confirmation dialog)** — present · Share2 button in DialogHeader opens Radix DropdownMenu of other users; onSelect fires shareIdentity immediately, no confirm modal.
- **Shape — the hand-over (fresh row with same name/title/hue/voice/avatar/identifier, independent after)** — present · identity-share.ts step 6 copies identityKey/displayName/title/colorHue/voice/avatarMime/avatarData/avatarEtag; fresh nanoid id + timestamps; no sharedFromId column exists → rows structurally independent after insert.
- **Shape — propagation (any holder can re-share, not restricted to creator)** — present · Only permission gate is (id, userId=requester); Test 10 explicitly exercises non-creator sharing onward and expects shared:true.
- **Shape — re-picking is silent no-op on backend** — present · No-op detection at (targetUserId, identityKey) returns 200 shared:false with existing id; Test 9 pins no insert; race path (Test 11 + fix e3314ba) also returns 200 shared:false on UNIQUE constraint hit.
- **Shape — picker hidden when only one user (empty state)** — present · Backend list-basic returns [] via ne(users.id, requester); picker returns null when users === null || users.length === 0.
- **Shape — already-shared recipients shown with 'shared' marker but still selectable** — present · Check icon + 'shared' text inside DropdownMenuItem; row is not aria-disabled and click still fires shareIdentity; Tests 4, 5, 7 confirm.
- **Philosophy — multiplayer on one agent, not template distribution** — present · identityKey is copied verbatim; that value is what routes to the underlying agent — both users land on the same running agent.
- **Philosophy — no ceremony (no accept/notification/revoke/expiry)** — present · No pending/accept table anywhere; no notification code path; no revoke/un-share endpoint or UI; endpoint responds to requester only.
- **Philosophy — trust the small userbase (no per-user permissions)** — present · Any authenticated user who can see an identity in their scope may share it onward; no admin gate; no audit table.
- **Prior context — no re-encryption for target (identities carry no secrets)** — present · Plain row copy; no key derivation, no re-encryption; identities schema has no secret columns.
- **Wrong — recipient's copy silently stays in sync with source edits** — present · Guarded — no sync mechanism exists in schema or router; rows are independent after insert.
- **Wrong — sharing is treated as a permissioned (creator-only) action** — present · Guarded — explicit comment locks against creator-only gating; Test 10 asserts non-creator can share onward.
- **Wrong — recipient has to accept** — present · Guarded — no pending/accept path; identity appears in recipient's picker next open.
- **Wrong — re-sharing to same user errors or duplicates** — present · Guarded — silent no-op on (targetUserId, identityKey); Test 9 (SELECT-detect path) + Test 11 (UNIQUE-constraint race path) both assert 200 shared:false.
- **Wrong — deleting on source removes from recipient** — present · Guarded — no FK or cascade from recipient row back to source; rows only share identityKey as a value.
- **Wrong — picker shows current user** — present · Guarded — server-side ne(users.id, userId) in /users/list-basic; picker does no re-injection.
- **Scope OUT — revoke/un-share** — present · No delete-share endpoint, no UI affordance.
- **Scope OUT — provenance display** — present · No shared-by tag, no shared-with count; alreadySharedUserIds is session-scoped in memory and resets on identity switch (fix c6fbb8c).
- **Scope OUT — multi-select** — present · DropdownMenuItem onSelect handles one user; menu closes on selection.
- **Scope OUT — recipient-side notification** — present · Endpoint responds to requester only; no push/inbox entry.
- **Scope OUT — sync between source and recipient** — present · Rows independent after insert; no propagation of subsequent edits.
- **Scope IN — behind-the-scenes users list route** — present · GET /users/list-basic in user-admin-routes.ts returns {id, username} for every user except requester; nginx.conf + nginx-https.conf both catch under existing /users(/.*)?$ location.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Re-close after three post-close hardening fixes (27a85b1 URL-encode source id in client; e3314ba UNIQUE-constraint race fallback to shared:false; c6fbb8c reset alreadySharedUserIds Set on identity switch). All three are pure hardening of behaviors already agreed in the shape (URL-safe path, silent-no-op-on-repeat under race, session-scoped marker correctness). No new features, no new UI surfaces, no schema additions. Backend UNIQUE(user_id, identity_key) constraint is present in db/index.ts CREATE TABLE. Nginx routing for both new endpoints is covered by pre-existing /users(/.*)?$ and /identities(/.*)?$ locations in both nginx.conf and nginx-https.conf. Clean pass in both directions.
