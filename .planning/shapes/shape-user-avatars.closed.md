# Shape: user avatars

**Opened:** 2026-09-07
**Vehicle:** gsd phase

## What this is

Baseline backend support for users of Skynet having avatars. Right now Skynet's
human users have no avatar concept at all — accounts exist, log in, and are
faceless. This build teaches Skynet how to store an avatar for a user and
gives the account-creation entry point a way to accept one. The avatar must
be provided at account creation; it is not optional. Frontend consumption —
where an avatar actually appears in the interface, and any self-serve flow
for choosing or changing one — is deliberately out of scope here and belongs
to a downstream build. This is plumbing so that downstream build has
something to draw from.

## Shape

The users concept gains one new piece of state per user: a small pointer that
tells Skynet where to find that user's avatar image. The bytes of the image
itself live as a file on disk on the Skynet server (not on any managed host
Skynet talks to over the network), inside Skynet's own encrypted data area
alongside the other per-user state Skynet already keeps there. The pointer
on the user row is just enough to reconstruct the file's location; no
absolute paths and no external links live in the database.

Two entry points on the backend touch this state:

- **Account creation.** The existing create-a-user entry point is extended
  to receive the image bytes in the same request as the rest of the account
  info. Creating a user without avatar bytes is refused outright by the
  backend — mandatoriness is a real backend guarantee, not a frontend
  convention. On a successful create, the bytes are written to disk and the
  new user row's pointer is populated in the same operation.

- **Change avatar.** A dedicated entry point takes in image bytes for an
  existing user and replaces that user's avatar. This is the entry point
  the eventual self-serve change flow will hit, and it is the same entry
  point that ever accepts avatar bytes for an already-existing user (there
  is no other path to change one). It exists as of this build even though
  no frontend consumes it yet, because standing it up now avoids a second
  round of the same plumbing later.

The byte-work — validating that the incoming bytes are actually an image of
an accepted kind, enforcing a maximum incoming size, writing to disk, and
updating the row's pointer — is one shared internal helper that both entry
points call. Both entry points do the same thing to the bytes; only the
surrounding wrapping (create-a-user context vs. update-existing-user context)
differs.

A third entry point serves the bytes back out on request, keyed by user, so
the frontend (in the downstream build) can render an avatar without knowing
anything about the on-disk layout.

## Philosophy

**Boring standard.** This is not the place to invent. The chosen shape — file
on disk with a database pointer, single-request mandatory create, dedicated
change endpoint sharing an internal helper — is the go-to convention in
web apps that grew up needing avatars. Skynet gets it done the ordinary way
and moves on.

**Backend-enforced, not UI-enforced.** Mandatoriness is guaranteed by the
create endpoint refusing to run without bytes, not by the frontend hiding
a submit button. A direct API caller cannot end up producing a user with
no avatar.

**No pending states.** No two-step reservation dance where a user exists in
some interim "avatar not yet uploaded" limbo. A user either exists (with
an avatar) or does not.

**Not a face here yet.** Zero frontend surfaces get an avatar in this build.
No badges, no rows, no menus, no "here's where you see one" wire-in. That
work belongs to a downstream build and depends on this one having landed
first.

**No self-serve editing here.** No page or modal for a user to pick or
change their avatar as part of this build. The change entry point exists
on the backend, but nothing invokes it from the UI.

## Prior context

Identities (the agent side of Skynet) already have avatars: a small image
file lives sidecar to the identity's metadata on the box's disk, and the
front end already renders them (hue-tinted badges in the chat surface,
faces in the conversation list). Users — the humans who log in — have no
counterpart to any of this today, which is why front-end changes that
would rely on drawing a user's face are currently unable to.

The Skynet database, where user rows live, is decrypted into memory at
startup and only persists to disk on explicit save calls. That is a
load-bearing invariant of the system: every backend write to a user row
has to be paired with a save trigger or the write can be lost across
restarts. Storing avatar bytes as a column on the users row would inflate
what gets loaded into memory on every startup and complicate list queries;
storing them as a file on disk with just a small pointer on the row keeps
the row cheap.

Skynet's daily backup story is a snapshot of the whole disk volume, so
files placed inside the encrypted data area ride the existing backup with
no additional plumbing.

A separately-discussed question about where operator-editable config
should live (bind-mounted for hand-editing vs. inside the encrypted
volume) does not apply here — nobody hand-edits user avatars from the
command line, so the argument for a bind-mounted path doesn't carry.
Inside the encrypted data area is the right home.

Adding new backend entry points to Skynet has a repeated gotcha: each new
served path has to be reflected in the edge web-server config in more than
one place, or a browser request for that path silently falls through to
the app's index page and breaks. This build touches at least the serve
entry point and possibly the change entry point in that config surface.

## What would make it wrong

- **A user exists with no avatar.** If the system can ever produce a user
  row without a corresponding avatar file, mandatoriness has been violated.
  This includes partial-failure scenarios during create.

- **The database gets fat with image bytes.** If avatars end up living in
  the row itself, or if the change endpoint writes bytes into the row
  instead of to a file, this has missed the point.

- **A write to the row is not paired with a save.** If avatar-related row
  updates land in memory but not to disk, we have reintroduced the
  in-memory-SQLite trap that has already burned this project.

- **The new served path 200s an HTML shell.** If the edge web-server config
  isn't updated for the new entry points, requests for a user's avatar will
  fall through to the frontend's index page. Silent failure of exactly the
  shape this stack has been bitten by before.

- **Bytes go somewhere other than the Skynet server's own disk.** If avatar
  files end up on a managed host, on a network mount, on the operator config
  path, or anywhere other than Skynet's own encrypted data area, the
  storage model has been broken.

- **A frontend surface gains an avatar in this build.** If any part of the
  UI starts rendering user avatars as a result of this work, scope has
  bled. Downstream frontend work depends on this landing first, but no
  visible change should ship in this slice.

- **A change-avatar UI affordance shows up.** Same failure — the change
  entry point exists on the backend, but no user-facing way to invoke it
  belongs in this build.

## Scope edges

**In scope**
- One new small piece of state on the users concept: a pointer to where
  that user's avatar image lives on disk.
- On-disk storage lifecycle for avatar image files inside Skynet's
  encrypted data area on the Skynet server itself.
- Extension of the existing account-creation entry point to receive image
  bytes in the same request as the rest of the account info and refuse
  the create without them.
- A dedicated backend entry point for replacing an existing user's avatar.
- A shared internal helper doing the byte-work (validate, size-cap, write,
  update pointer) that both entry points call.
- A backend entry point that serves the bytes back out per user for the
  frontend to consume.
- Edge web-server config updated for any new served paths so requests
  don't fall through to the app shell.
- Pairing of every row write with the required save trigger.
- Acceptance of the standard common web image formats; a reasonable
  ceiling on incoming byte size.
- On user deletion, cleanup of that user's avatar file.

**Out of scope**
- Any frontend surface rendering a user avatar.
- Any UI affordance (form, modal, menu, drag-and-drop) for a user to
  choose or change their avatar.
- Any migration/backfill flow for users that exist today. They keep
  having empty pointers until some later mechanism gives them an avatar
  (which will be a downstream build's problem, not this one's).
- Image resizing, cropping, thumbnail generation, or any other transform
  beyond format+size validation on receive.
- Content moderation on avatar uploads.
- Cache headers, CDN considerations, or optimization work on the serve
  path.
- Multi-avatar-per-user or historical-avatar retention.
- Anything about the agent-side identity avatar system — those stay
  exactly as they are today.

**Tempting but no**
- "While we're in there, let's also add a route for the frontend to hit
  and start rendering avatars." No — this is the plumbing build; the
  rendering build is downstream and separate.
- "It'd be easy to also let users upload without an existing account and
  claim the avatar at signup." No — mandatory-at-create is the exact
  shape, don't invent alternative flows.

## Vehicle notes

**GSD phase.** Chosen because two Skynet-specific traps live in this build's
path, and both are the sort of thing a written plan catches before code
lands and a solo `/gsd:quick` can miss: (1) every backend write to the
users row must be paired with an explicit save trigger call or the write
is lost across restarts; (2) every new served path needs matching entries
in the edge web-server config in more than one place or it silently
returns the app shell instead. Phase planning surfaces both up front. The
size of the work — one small piece of user-row state, three backend entry
points, one shared helper, config touches, on-disk lifecycle — is on the
small side for a phase but the safety margin from having a plan doc is
worth the ceremony.

CONTEXT.md for the phase can be seeded directly from this shape file
rather than re-eliciting the same discussion. The shape file is the
agreement; the phase discussion should build on it, not restart it.

The identity currently working this is Tina (box-maintainer role for
t1000, the EC2 that runs the Skynet instance being modified).

Downstream: a separate future frontend build consumes this — it is the
piece that actually puts user avatars on screen and, later, adds the
self-serve change flow. That build depends on this one having landed
first; a heads-up to whoever picks it up is worthwhile once this ships.

---

## Close-Out

**Closed:** 2026-09-08
**Vehicle used:** gsd phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Users concept teaches Skynet how to store an avatar and gives account creation a way to accept one; frontend consumption intentionally not touched.
- **Shape: new pointer state on users** — present · avatarPath TEXT column on users; bare filename only, no absolute paths, no external links.
- **Shape: bytes live on disk in Skynet's encrypted data area** — present · USER_AVATARS_DIR is DATA_DIR/user-avatars — Skynet's own encrypted data area, rides existing daily-disk-snapshot backup.
- **Shape: account creation entry point accepts image bytes and refuses without them** — present · Password-registration create path receives multipart bytes in the same request and 400s without them; file written before row INSERT with rollback on failure.
- **Shape: dedicated change-avatar entry point** — present · PUT change endpoint present with own-or-admin guard; writes new file, updates row pointer, unlinks old file only when filename differs.
- **Shape: shared internal helper doing byte-work called by both entry points** — present · user-avatar-storage helper module owns validate/size-cap/write/pointer-derivation; both write endpoints and the serve endpoint call into it.
- **Shape: entry point that serves bytes back per user** — present · GET serve endpoint returns bytes with derived Content-Type; 404s for missing row, null pointer, or file-missing-on-disk.
- **Philosophy: boring standard** — present · File-on-disk plus DB pointer plus dedicated change endpoint sharing an internal helper — the ordinary web-app convention.
- **Philosophy: backend-enforced, not UI-enforced** — present · Presence check on the incoming file fires before any DB or file write; a direct API caller cannot produce a user without an avatar via the password-registration path.
- **Philosophy: no pending states** — present · File-then-row ordering with rollback on either failure — no interim 'avatar-not-yet-uploaded' user row can exist.
- **Philosophy: not a face here yet** — present · No frontend surface renders a user avatar; frontend register call is unchanged and does not send bytes.
- **Philosophy: no self-serve editing here** — present · No UI affordance (form, modal, menu) to pick or change an avatar; change endpoint exists on backend only.
- **Prior context: avatar-related row writes paired with save trigger** — present · Both create and change paths call the labeled save trigger after the row write.
- **Prior context: new served paths reflected in edge web-server config** — present · Existing catch-all /users location in both nginx configs already covers the new sub-paths; body-size cap raised to 6M in both files.
- **Prior context: bytes storage argument (disk file vs. row) settled correctly** — present · Bytes on disk, pointer on row — row stays cheap, list queries unaffected.
- **What would make it wrong: a user exists with no avatar** — drifted · Password-registration path enforces mandatoriness; OIDC-callback path creates a user with null pointer as an explicit carve-out. User endorsed this drift — OIDC is not used in this deployment.
- **What would make it wrong: the database gets fat with image bytes** — present · Bytes never touch the users row; only a bare filename is stored there.
- **What would make it wrong: a write to the row is not paired with a save** — present · Both avatar-related row writes call the labeled save trigger; failure to save is logged non-fatally so the request still succeeds while debounce catches the row on next flush.
- **What would make it wrong: the new served path 200s an HTML shell** — present · Both nginx configs already have a /users catch-all pointing at the backend; new sub-paths inherit that routing. Both files updated for the body-size cap.
- **What would make it wrong: bytes go somewhere other than Skynet server's own disk** — present · Write helper is hard-wired to Skynet's DATA_DIR/user-avatars — no managed-host, network-mount, or operator-config path involvement.
- **What would make it wrong: a frontend surface gains a user avatar** — present · No user-avatar UI code exists; identity-avatar surfaces are unrelated and unchanged.
- **What would make it wrong: a change-avatar UI affordance shows up** — present · No form, modal, or menu invokes the change endpoint from the UI.
- **Scope edge: cleanup of avatar file on user deletion** — present · Both admin-delete helper and self-serve delete-account path unlink the avatar file before deleting the row, ENOENT-tolerant.
- **Scope edge: standard common web image formats accepted** — present · PNG, JPEG, WebP accepted; GIF and SVG explicitly excluded — a defensible narrow reading of 'standard common web image formats'.
- **Scope edge: reasonable ceiling on incoming byte size** — present · 5 MB cap in the upload middleware; nginx body-size cap set to 6M to allow multipart framing headroom.
- **Scope edge: no migration/backfill for existing users** — present · avatar_path column is nullable; pre-existing rows keep null pointer, no backfill machinery.
- **Scope edge: no image resizing/cropping/thumbnails** — present · No transform code beyond format and size validation on receive.
- **Scope edge: no content moderation** — present · No moderation code.
- **Scope edge: no cache headers / CDN / serve-path optimization** — drifted · Serve endpoint adds ETag, If-None-Match / 304 short-circuit, and Cache-Control: no-store — user endorsed the drift in hindsight after being unable to reason about it herself; logged as a bounty for the downstream frontend build to revisit.
- **Scope edge: no multi-avatar or historical retention** — present · Single filename per user; change endpoint replaces in place.
- **Scope edge: identity-avatar system untouched** — present · Identity-avatar module is not imported by the new helper; user-avatar code is fully locally scoped.

### Additions (in the result, not in the shape)

- OIDC-callback path creates a users row with null avatar pointer — an implicit mandatoriness carve-out the shape did not sanction. — endorsed-as-drift
- Serve endpoint sets ETag, honors If-None-Match with a 304 short-circuit, and sets Cache-Control: no-store — cache-header behaviour the shape's Out-of-scope section calls out. — endorsed-as-drift

### Follow-ups

- Downstream frontend build should revisit whether it wants the cache-machinery-plus-no-store combination on the serve endpoint, or strip it back to plain bytes with Content-Type. — bounty

### Notes

Both divergences were additions rather than omissions — every commitment in the shape landed. The OIDC carve-out is inert in this deployment (user does not use OIDC) so it's a real drift with no practical consequence. The cache-header addition is a small defensive-plus-optimization slip that the implementer authorized via a CONTEXT.md 'trivial ok' softening without user greenlight; user accepted in hindsight but did not reason about it, hence the bounty for the downstream build to make a real call. Worth carrying forward: 'trivial ok' softenings in phase context docs can quietly widen shape scope; a light rule that any shape-Out-of-scope override needs an explicit user checkpoint would have caught this. Also: the shape's mandatoriness commitment was written without accounting for user-creation paths that don't go through a normal request/response with an upload opportunity (OIDC redirect); future shape docs touching account creation should either enumerate the paths or explicitly say 'every path a user row comes from.'
