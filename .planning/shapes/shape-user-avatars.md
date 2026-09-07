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
