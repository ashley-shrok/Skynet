# Phase 85: User avatars — baseline backend support — Context

**Gathered:** 2026-09-07
**Status:** Ready for planning
**Source:** In-session `/build user avatars` → `/open` discussion with Ashley (greenlit `thumbs up` 2026-09-07). Shape file at `.planning/shapes/shape-user-avatars.md` — this CONTEXT.md is seeded FROM the shape per build-skill convention; the shape file remains the design contract, this file adds implementation-locked decisions and codebase context for downstream agents.

<domain>
## Phase Boundary

Add baseline backend support for Skynet's human users having avatars — a piece of plumbing so a downstream frontend build can start rendering them. Skynet's users concept currently has no avatar field at all; this phase adds one field on the users row, three backend entry points (mandatory-at-create, replace-later, serve-out), and the on-disk storage lifecycle behind them, inside Skynet's own encrypted data volume on the Skynet EC2 (`t1000`).

Frontend consumption — where avatars actually appear in the UI, and any self-serve UI for choosing or changing one — is DELIBERATELY out of scope and belongs to a downstream build. This phase adds no user-visible surface.

**Vehicle:** GSD phase (see shape file § Vehicle notes). Chosen for the two Skynet-specific traps (see § Traps below) that a written plan catches before code lands.

</domain>

<decisions>
## Implementation Decisions

### Storage location (LOCKED)

- **D-01:** Avatar bytes live as files on disk on the Skynet EC2 itself (Skynet's own `t1000` box), NOT on any managed host Skynet talks to over the network, NOT on a mounted operator-config path, NOT as bytes in a DB column.
- **D-02:** Files sit inside Skynet's own encrypted data volume — the same `skynet-data` docker volume that holds the encrypted SQLite DB and other per-user state. Path convention: a new dedicated subdirectory under `DATA_DIR` (`process.env.DATA_DIR || "./db/data"`; production mounts `skynet-data` at `/app/data`). Recommended: `${DATA_DIR}/user-avatars/`. Confirm exact subdir name during planning; the planner may pick a differently-named sibling of the existing data-dir contents if that improves consistency with prior conventions.
- **D-03:** Rides the existing daily EBS DLM snapshot backup story with no additional plumbing (whole-volume snapshot already covers the data dir).

### DB schema change (LOCKED)

- **D-04:** Add one small nullable text column to the `users` table (`src/backend/database/db/schema.ts` line 4). Column carries a pointer to the on-disk file — NOT bytes, NOT an absolute path, NOT an external URL. Just enough to reconstruct the file location from the users row.
- **D-05:** Exact column shape (name, contents — a bare filename with extension, or a hash, or the user id with extension) is a planner call. Constraint: the choice must be deterministic (given a row, the file location is unambiguous) and the row must not require app knowledge outside `DATA_DIR` to locate the file.
- **D-06:** Column is nullable at the schema level to support existing users (see D-13). New rows created via `POST /users/create` MUST have it populated — mandatoriness is enforced at the endpoint, not the schema.

### Mandatoriness (LOCKED)

- **D-07:** Mandatory-at-create is a real BACKEND guarantee, not a frontend convention. `POST /users/create` refuses to create a user without avatar bytes in the request. A direct API caller cannot end up producing a new user with no avatar.
- **D-08:** No pending state / no reservation dance / no ticket flow. A user either exists (with an avatar) or does not.

### Endpoint shape (LOCKED)

- **D-09:** `POST /users/create` (already exists in `src/backend/database/routes/users.ts:82`) is extended from `application/json` to `multipart/form-data`. Request carries the existing `username` + `password` fields alongside a required `avatar` file part. Refuses the create if the `avatar` file part is missing or the bytes don't validate.
- **D-10:** New dedicated endpoint takes bytes for an existing user and replaces that user's avatar file. Path lives under `/users/…` — planner picks the exact shape (e.g. `PUT /users/:id/avatar` or `POST /users/:id/avatar`), authenticated per the user's own credentials or admin. This is the endpoint the eventual self-serve change flow will hit AND the only path that ever accepts bytes for an already-existing user.
- **D-11:** New serve endpoint returns the bytes for a given user's avatar. Path also lives under `/users/…` (planner picks; e.g. `GET /users/:id/avatar`). Frontend calls it by user id and receives raw image bytes with the correct `Content-Type`. ETag header desirable if trivial (mirrors identity avatar pattern), but not required this phase.
- **D-12:** All three endpoints share ONE small internal helper that does the byte-work: validate format (see D-14), enforce size cap (see D-15), write bytes to disk atomically, update the users row's pointer, call the save trigger. Both write endpoints (create + change) call it; the serve endpoint reads through the same on-disk convention.

### Existing users (LOCKED)

- **D-13:** No migration / no backfill. Users that exist today keep an empty (null) pointer field until some downstream mechanism gives them an avatar. That downstream mechanism will use the D-10 change endpoint. This phase does NOT create it, invoke it, or ship any UI for it.

### Format + size cap (LOCKED)

- **D-14:** Accept the standard trio — `image/png`, `image/jpeg`, `image/webp`. This mirrors `identity-avatar-batch.ts:406-410` (the existing `ALLOWED_MANUAL_AVATAR_MIMES` set) and is the standard trio across the codebase for uploaded images.
- **D-15:** Incoming byte size cap: 5 MB (mirrors `identity-avatar-batch.ts:414` `fileSize: 5 * 1024 * 1024`). Rejection surfaces as HTTP 413.
- **D-16:** Reject uploads on either mime-mismatch OR oversize BEFORE any bytes touch disk. Multer's `memoryStorage()` + `limits.fileSize` + `fileFilter` handles all three checks (see `identity-avatar-batch.ts:412-422` for the exact pattern to mirror).

### DB write pairing (LOCKED — trap avoidance)

- **D-17:** Every users-table row mutation MUST be paired with `DatabaseSaveTrigger.forceSave("phase-85-user-avatar")` (or `triggerSave()` — either is acceptable, `forceSave` gives an explicit reason label per role-file convention). This includes the create path's INSERT (already present in the endpoint at line 137-165, currently uses raw SQL prepare/run — must add the save trigger call after the insert transaction commits) AND the new change endpoint's UPDATE.
- **D-18:** Failure to call the save trigger is the CROWN-JEWEL invariant this project has already been burned by (see load-bearing invariant in `~/.claude/roles/box-maintainer/box-maintainer.md`; historical bounties `identity-writes-not-flushed-to-disk`, `skynet-in-memory-db-wider-audit`). The save-trigger call is not optional and is not something the planner can defer.

### Nginx routing (LOCKED — trap avoidance)

- **D-19:** All three new endpoint paths live UNDER `/users/…`, which is already covered by the existing regex block `location ~ ^/users(/.*)?$ { … }` in both `docker/nginx.conf` and `docker/nginx-https.conf`. So no new location BLOCKS are strictly required.
- **D-20:** HOWEVER — the existing `/users` block has NO `client_max_body_size` directive and therefore uses nginx's 1 MB default. Multipart uploads carrying up to 5 MB avatar bytes (D-15) will 413 at nginx BEFORE reaching Express. The plan MUST either (a) add `client_max_body_size 6M;` (or similar, leaving headroom for multipart framing overhead above the 5 MB payload cap) to the existing `/users` block in BOTH config files, OR (b) add a MORE-SPECIFIC location block for the avatar-carrying paths above the general `/users` block, with the larger body size. Preferred: (a) — simpler, one directive per file, no ordering hazard.
- **D-21:** Both `docker/nginx.conf` AND `docker/nginx-https.conf` MUST get the edit. Missing the second file is the recurring gotcha that produces the "endpoint 200s the app shell instead" failure mode.

### On-user-delete cleanup (LOCKED)

- **D-22:** When a user is deleted, that user's avatar file is removed from disk. The plan MUST identify the existing user-delete path(s) and wire an avatar-file `fs.unlink` (or equivalent) into it, tolerant of a missing file (ENOENT is not an error for cleanup).
- **D-23:** No historical retention of avatars — replacement via the change endpoint (D-10) overwrites in place or writes the new file and unlinks the old.

### Claude's Discretion

- Exact column name on the users row (`avatar`, `avatarPath`, `avatarFilename`, etc.) — planner picks per fit with adjacent columns.
- Exact filename convention on disk (`${userId}.${ext}`, `${sha}.${ext}`, or other) — planner picks per D-05 constraints.
- Change-endpoint HTTP verb (PUT vs POST) and exact path shape — planner picks; standard REST leans PUT for replace-in-place.
- Whether the serve endpoint sets `Cache-Control`, `ETag`, or `Content-Disposition` headers beyond `Content-Type` — planner's call, keep minimal for this phase.
- Authorization model on the change endpoint — user changes their own avatar, admin can change anyone's; planner uses the existing `authenticateJWT` middleware + `requireAdmin` pattern already established in `users.ts` for adjacent operations.
- Whether to reuse the existing `manualUpload` multer instance from `identity-avatar-batch.ts:412` or declare a new scoped one for users routes — either is fine; new scoped one is cleaner separation but shares no state anyway.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract (LOAD-BEARING)

- `.planning/shapes/shape-user-avatars.md` — the /open shape file that is the design contract for this phase. All decisions above trace back to it. Read before planning.

### Load-bearing project invariants

- `CLAUDE.md` § Constraints — cites the in-memory-SQLite invariant AND the nginx-config duplication caveat (both are D-17/D-18 and D-19/D-20/D-21 above).
- `~/.claude/roles/box-maintainer/box-maintainer.md` § "Load-bearing invariants (never forget)" — the DatabaseSaveTrigger.forceSave rule with reference pattern at `host-autostart-routes.ts:173-181`.

### Existing code patterns to mirror

- `src/backend/database/routes/identity-avatar-batch.ts:395-486` — the `POST /candidate/manual` handler is the closest analog for what this phase builds: authenticateJWT → multer with memoryStorage + fileSize cap + fileFilter → Express error handler mapping multer errors to 400/413. This is the concrete pattern the planner should mirror for D-09/D-10.
- `src/backend/database/routes/identity-avatar-batch.ts:406-422` — the exact `ALLOWED_MANUAL_AVATAR_MIMES` set + multer config that satisfies D-14/D-15/D-16.
- `src/backend/database/routes/host-autostart-routes.ts:173-181` — reference pattern for the `DatabaseSaveTrigger.forceSave` call the planner must wire in per D-17.

### Existing endpoints to modify

- `src/backend/database/routes/users.ts:82-176` — the current `POST /users/create` handler. This is what D-09 extends from JSON to multipart.
- `src/backend/database/db/schema.ts:4-33` — the current `users` table schema. This is where D-04's new column lands.

### Nginx configs to edit

- `docker/nginx.conf` — production HTTP-inside-Caddy config. Existing `/users` block (around line 12 in the grep output) needs D-20's `client_max_body_size` edit.
- `docker/nginx-https.conf` — sister config, MUST get the same edit per D-21.

### Prior phase references

- Phase 75 (Matrix admin) — added the `mxid` column to `users` schema (line 32 of schema.ts). Precedent for adding one new nullable column to `users`; follow the same comment-block style annotating which phase added the field and why.
- Phase 82 (branding config: WIP indicator) — `.planning/phases/82-*/82-CONTEXT.md` — recent example of the LOCKED-decision style this file follows.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Multer + memoryStorage + PNG/JPEG/WebP filter + 5MB cap** — the exact upload configuration this phase needs is already implemented in `identity-avatar-batch.ts:412-422`. Copy the pattern verbatim (or extract to a shared helper if fit for one).
- **Multer error → HTTP status handler** — `identity-avatar-batch.ts:453-486` shows the Express error-handler pattern that turns `LIMIT_FILE_SIZE` → 413, `LIMIT_UNEXPECTED_FILE` → 400 "missing avatar field", mime-rejection → 400 with the mime error message. This should be repeated (or shared) for the users routes.
- **`DatabaseSaveTrigger`** — `src/backend/database/db/index.js` exports both `db` and `DatabaseSaveTrigger`. Reference call pattern in `host-autostart-routes.ts:174`: `await DatabaseSaveTrigger.triggerSave();` inside the mutation handler. Role-file convention prefers `forceSave("<reason>")` with an explicit reason label for grep-ability.
- **`nanoid` id generator** — already imported and used in `users.ts:135` for user id generation; reuse for filename generation if the planner picks a nanoid-based filename convention.
- **`authenticateJWT` + `requireAdmin` middleware** — established in `users.ts`; existing precedent for authenticating write ops against user records.

### Established Patterns

- **Raw SQL for users-table writes** — `users.ts:137-165` uses `db.$client.prepare(...).run(...)` for the create INSERT, not Drizzle's `db.insert(users).values(...).run()`. Reason unknown but consistent — planner should follow the same raw-SQL pattern for the new UPDATE in the change endpoint AND for the modified INSERT that adds the avatar pointer. Do not mix Drizzle-orm and raw-SQL writes in the same phase unless the planner explicitly justifies it.
- **Transaction wrapper** — the create INSERT is wrapped in `db.$client.transaction(() => { ... })` to atomically count-then-insert (line 137). The multipart change requires the file-write to happen INSIDE the same transactional window (or immediately before, with rollback semantics if the SQL fails after the file is written). Planner must think through the ordering: file-then-row (rollback the file on SQL failure) OR row-then-file (rollback the row on write failure) — probably file-then-row-with-rollback because the file write is more likely to fail (disk full, ENOSPC) than the SQL insert. Save trigger fires AFTER commit succeeds.
- **`allow_registration` gate** — `users.ts:83-98` — create endpoint gates on a `settings` row. Extending to multipart doesn't change this; the check happens before body parsing.
- **Per-router body parser scoping** — `identity-avatar-batch.ts:42` uses `router.use(express.json())` scoped to the router. The users router presumably relies on a global JSON parser; extending POST /users/create to multipart means multer runs BEFORE any JSON parsing for that specific route, and the surrounding router's JSON parser must not consume the multipart body first. Planner must verify.

### Integration Points

- **DB schema addition** → one Drizzle migration or hand-edit in `schema.ts` + `index.migration.test.ts` update.
- **Existing POST /users/create** → change from JSON body to multipart, add required-field check on `req.file`, extend the raw INSERT to populate the new column.
- **New change endpoint** → new `router.put(...)` (or `.post(...)`) call in `users.ts` (or a new sibling routes file if the planner prefers isolation for the avatar-handling code).
- **New serve endpoint** → new `router.get(...)` reading from disk, sending bytes with correct Content-Type.
- **Delete-user pipeline** → identify existing delete path(s) — grep for `delete.*users\|users.*delete` in `src/backend/database/routes/` returns `delete-user-data.ts` + likely admin-side deletion — wire avatar-file unlink into each.
- **Nginx configs** → edit `/users` regex block's `client_max_body_size` in both files.

### Storage path convention (from codebase scout)

- `DATA_DIR` defaults to `./db/data`; production mounts `skynet-data` docker volume at `/app/data` (`docker/docker-compose.yml`). SQLite DB lives at `${DATA_DIR}/db.sqlite`.
- Recommended avatar path: `${DATA_DIR}/user-avatars/${filename}`. Planner may pick a differently-named subdirectory to fit adjacent conventions the researcher discovers.
- Cross-container: no other service in the compose stack needs to read these files, so the encrypted-volume-only home is safe.

</code_context>

<specifics>
## Specific Ideas

- **"Boring standard"** (Ashley's phrase during /open discussion, verbatim: *"we are not doing anything crazy with these. you know this is about as standard as i think you can get for wanting avatar support for an app um so unless you can think of a reason to do otherwise i would ask what the standard go-to way would be for doing this and then we probably just go with that"*). The design shape traces to the standard web-app go-to convention. No invention.
- **Mandatoriness requirement** (Ashley verbatim: *"i want avatars to be mandatory. But if wanting them to be mandatory poses issues, then I'm willing to drop it"*). She was willing to give it up if it forced ugly infrastructure (pending states, ticket flows). It did NOT — the hybrid single-call-mandatory-create + separate-change-endpoint pattern satisfies mandatoriness cheaply. Mandatoriness stays.
- **Skynet-server-side disk, not managed-host disk** (Ashley verbatim: *"just to be clear, they would go on the machine that Skynet is running on, if they're going to go on disk, and not on hosts registered in Skynet"*). Explicitly captured because "disk" in a fleet-manager context is ambiguous.

</specifics>

<deferred>
## Deferred Ideas

- **Frontend rendering of user avatars.** The whole point of building this plumbing now is so a downstream frontend build can consume it — but that IS a downstream build, not part of this phase. Ashley's phrasing during /open: *"because they're going to start getting used in some of the front end changes that aren't part of this build."*
- **Self-serve avatar-change UI** (modal, form, drag-drop, upload picker, etc.). The backend endpoint (D-10) exists as of this phase but nothing invokes it from the UI. Ashley's phrasing: *"I know it would be tempting to add somewhere that it shows up right from the get go on the front end, and possibly UI affordances for changing avatars, but we are not going to do those things right now."*
- **Backfill for existing users.** Users that exist today keep null avatar pointers until the future frontend/self-serve flow gives them one. No migration script this phase.
- **Image transforms.** No resize, crop, thumbnail generation, color correction, EXIF-strip, etc. Bytes are stored as received (after format+size validation).
- **Content moderation.** No policy check on avatar content. Trust the admin / trust the users.
- **Cache / CDN headers on the serve path.** Planner may set Content-Type and (if trivial) ETag; deeper caching/CDN concerns wait for real-world demand.
- **Historical avatar retention or multi-avatar.** One avatar per user, replaced-in-place. No history.
- **Anything about identity avatars** (the agent side). Those work today, sidecar files on disk in identity folders, read over SSH by Skynet — this phase does not touch that system at all.
- **A rendering route added "while we're in there."** Explicitly listed as tempting-but-no in the shape file.
- **Letting users upload an avatar before an account exists** ("claim on signup" flow). Explicitly listed as tempting-but-no.

</deferred>

---

*Phase: 85-user-avatars*
*Context gathered: 2026-09-07*
