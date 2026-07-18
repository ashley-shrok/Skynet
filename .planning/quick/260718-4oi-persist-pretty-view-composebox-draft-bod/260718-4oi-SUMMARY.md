---
id: 260718-4oi
status: complete
date: 2026-07-18
description: persist pretty-view ComposeBox draft body server-side per pane (patch #57)
commit: 4579ca7f938d5b89e343e69876ffa256d48ae88b
---

# Patch #57: Persist ComposeBox draft body server-side per pane

## Overview

Extends the message-queue autosave/flush/retry discipline (patches
#39/#49/#55) to the pretty-view ComposeBox itself. Typed drafts are
now persisted server-side keyed on `(userId, hostId, tmuxSession)` —
one row per pane, tmuxSession nullable for non-tmux SSH hosts — so
the compose textarea survives page reload, Chrome crash, tab close,
and Wi-Fi flap mid-typing. Ashley routinely composes long multi-line
messages to Claude Code sessions across many parallel tabs; anything
that eats a mid-typing state loses real work. The message-queue
drawer has been battle-tested with the same state machine for months;
this patch mirrors it exactly, scoped to a single body per pane
instead of an array.

Ships as ONE atomic feature commit
(`feat(pretty-view): persist ComposeBox draft body server-side per pane`,
SHA `4579ca7`), followed by a separate docs commit for
PLAN.md/SUMMARY.md/STATE.md handled by the `/gsd:quick` finalize step.

## Backend Changes

### Schema (`src/backend/database/db/schema.ts`)

New Drizzle table `composeDrafts` added after `messageQueueItems`.
Columns: `userId` (text FK cascade users), `hostId` (integer FK cascade
ssh_data), `tmuxSession` (text, `NOT NULL DEFAULT ''` — see NULL-key
note below), `body` (text, default ''), `updatedAt` (text, default
CURRENT_TIMESTAMP). No `id` primary key column — composite PK is
enforced at the SQL layer.

### SQL bootstrap (`src/backend/database/db/index.ts`)

New `CREATE TABLE IF NOT EXISTS compose_drafts (...)` block plus
`CREATE INDEX IF NOT EXISTS idx_compose_drafts_user_host_session`
inserted immediately after the `message_queue_items` block in
`initializeCompleteDatabase()`. Brand-new table so no migrateSchema
work is needed (matches how patch #39 landed
`message_queue_items`).

**NULL-key rationale (load-bearing):** SQLite treats NULL as distinct
in a UNIQUE / PRIMARY KEY constraint. Two rows with the same non-null
`user_id` + `host_id` and NULL `tmux_session` would both be allowed,
and the `ON CONFLICT (user_id, host_id, tmux_session) DO UPDATE`
upsert path would silently miss the match. Table column is stored as
`TEXT NOT NULL DEFAULT ''` and the route layer coalesces nullable
request-level `tmuxSession` → `''` at the storage boundary. Client
wire type stays nullable; coalesce is server-side only. Documented in
a comment at the top of `routes/compose-drafts.ts`.

### Route (`src/backend/database/routes/compose-drafts.ts`, NEW)

Mirrors `message-queue.ts` structure and imports. Cookie-JWT auth via
`AuthManager.createAuthMiddleware()` on both endpoints (not the
`tmx_` API key path — this is per-user personal state).

- `GET /?hostId=<int>&tmuxSession=<str|omitted>` → 200
  `{body: string}`. Returns `{body: ""}` when no row exists (never
  404). First-time load on an empty pane is a normal success path.
- `PUT /` body `{hostId, tmuxSession?, body}` → 204. Raw SQL upsert
  via `db.run(sql\`INSERT ... ON CONFLICT ... DO UPDATE\`)`.
  drizzle-orm's `onConflictDoUpdate` typing against composite
  targets is fussy across versions; the raw form is the safest bet
  across upgrades. Do NOT delete the row on empty body — empty body
  is a state (cleared-on-send), keeping the row preserves the
  FK-cascade audit trail and matches the clear-on-send posture.

Validation helpers `parseHostId` and `parseTmuxSession` mirror
message-queue.ts. Body: `typeof req.body?.body === "string"`
otherwise empty string. No explicit size cap (matches message-queue).
Errors logged via `databaseLogger.error(...)` with
`operation: "load_compose_draft"` / `"save_compose_draft"` and the
`userId`.

### Mount (`src/backend/database/database.ts`)

Two-line additive edit: `import composeDraftsRoutes from
"./routes/compose-drafts.js";` alongside the existing
`messageQueueRoutes` import, and
`app.use("/compose-drafts", composeDraftsRoutes);` alongside the
existing `/message-queue` mount.

### Nginx (`docker/nginx.conf` + `docker/nginx-https.conf`)

Matching `location ~ ^/compose-drafts(/.*)?$` blocks added to BOTH
configs immediately after the existing `/message-queue` blocks,
proxying to `127.0.0.1:30001` with the same
`proxy_set_header` chain. Without matching blocks in BOTH configs,
requests would fall through to the SPA static handler → 200 with
`index.html` → frontend crash on `.map`. Same trap that has bit
patches #7 / #17 / #39 / #43.

## Frontend Changes

### API client (`src/ui/api/compose-drafts-api.ts`, NEW)

Three exports mirroring `message-queue-api.ts` conventions:

- `getComposeDraft(hostId, tmuxSession): Promise<{body: string}>`
  — axios GET, returns response body verbatim.
- `putComposeDraft(hostId, tmuxSession, body): Promise<void>`
  — axios PUT.
- `flushComposeDraftKeepalive(hostId, tmuxSession, body): void`
  — fire-and-forget `fetch({method:"PUT", credentials:"include",
  keepalive:true})`. Reads `authApi.defaults.baseURL`. Wrapped in
  try/catch so it never throws during page teardown. Response
  unreachable by design.

### ComposeBox rewrite (`src/ui/features/pretty-view/ComposeBox.tsx`)

New required props on `ComposeBoxProps`: `hostId: number`,
`tmuxSession?: string | null`.

**State machine additions** (mirrors patch #55's MessageQueueDrawer
plumbing, adapted for a single body instead of an array):

- `dirtyBodyRef: useRef<string | null>` — null means "no pending
  save"; a string (including "") means "this value has not been
  confirmed persisted". Written by every keystroke; read + cleared
  by `flushDirty()`.
- `debounceTimerRef: useRef<Timer | null>` — the pending 400ms
  autosave timer, or null if no autosave is queued.
- `latestBodyRef: useRef<string>` — synced to `text` on every
  render so async callbacks (interval tick, pagehide handler) read
  the freshest value without stale-closure surprises.

**Effects**:

1. **Load-on-mount**, keyed on `[hostId, tmuxSessionKey, clearDebounce]`.
   Resets local state, calls `getComposeDraft`, seeds textarea from
   response. On error: silently keeps the empty seed (no error UI on
   autoload failures). **Cleanup fires BEFORE the new run when the key
   changes**: any dirty body under the old key is flushed via
   `flushComposeDraftKeepalive` first, so a mid-typing pane switch
   doesn't silently drop the draft.

2. **pagehide + visibilitychange** keyed on `[hostId, tmuxSessionKey]`.
   Fires `flushComposeDraftKeepalive` only when `dirtyBodyRef.current
   !== null`. Idle panes cost zero unload-time bandwidth.

3. **10s setInterval retry** keyed on `[flushDirty]`. Catches the
   "user typed → PATCH failed → user walked away" case that patch #55
   already showed nothing else recovers from. Gate on
   `dirtyBodyRef.current !== null` inside the tick so idle panes
   don't spam PUTs.

**Input handling**:

- `handleTextChange(next)`: `setText(next)` + `scheduleAutosave(next)`
  which sets `dirtyBodyRef.current = next`, clears the pending timer,
  starts a fresh 400ms `setTimeout`.
- `handleBlur`: `clearDebounce()` + `void flushDirty()`.
- `flushDirty`: reads and clears `dirtyBodyRef`, awaits
  `putComposeDraft`; on error re-queues `latestBodyRef.current`
  (prefer newer edits over the snapshot we just tried to send).

**Clear-on-send in all three paths**:

- `handleSend`: on successful WS dispatch → `setText("")` +
  `clearAfterSend()`. On failed dispatch: preserve both textarea AND
  persisted draft.
- `handleResetSend`: same as handleSend semantics.
- `handleQuickSend("go ahead")`: on successful dispatch →
  `clearAfterSend()` (does NOT `setText("")` — the user's typed
  composition stays visible for continued editing, per plan spec).
  On failed dispatch: preserve everything.

`clearAfterSend()` cancels the pending debounce, clears
`dirtyBodyRef` + `latestBodyRef`, and fires a fire-and-forget
`putComposeDraft(..., "")`. Best-effort — the 10s retry loop will
recover if it fails.

**NO ERROR UI on failed autosave.** The `errorMessage` state stays
purpose-limited to send errors ("Not connected — try again in a
moment"). Failed autosave is invisible; retry loop is the recovery
mechanism. Matches patch #44's COMPOSE-04 HARD LOCK posture: no
ghost UI that lies about state.

### PrettyView wiring (`src/ui/features/pretty-view/PrettyView.tsx`)

Two-line additive edit at the `<ComposeBox />` mount site: threads
existing `hostId` (number) and `tmuxSession` (string) props into
ComposeBox. No signature change on PrettyViewProps.

## Verification

- `npm run build` exits 0 (verified before commit).
- `git diff-tree --name-only -r HEAD` matches exactly the 9 target
  files (verified — zero extras, zero misses).
- All plan-specified grep checks pass:
  - `grep -c compose_drafts src/backend/database/db/index.ts` → 3
  - `grep composeDrafts src/backend/database/db/schema.ts` → hit
  - `grep compose-drafts src/backend/database/database.ts` → hit
  - `grep 'location ~ \^/compose-drafts' docker/nginx.conf` → hit
  - `grep 'location ~ \^/compose-drafts' docker/nginx-https.conf` → hit
  - `src/backend/database/routes/compose-drafts.ts` exists
  - `getComposeDraft` / `putComposeDraft` /
    `flushComposeDraftKeepalive` / `keepalive` all present in
    `compose-drafts-api.ts`
  - ComposeBox contains `hostId`, `tmuxSession`, `dirtyBodyRef`,
    `pagehide`, `visibilitychange`, `setInterval`
  - PrettyView contains `hostId={hostId}` and `tmuxSession={tmuxSession}`

## Files touched (9)

1. `src/backend/database/db/schema.ts` — new `composeDrafts` Drizzle
   table.
2. `src/backend/database/db/index.ts` — `CREATE TABLE IF NOT EXISTS
   compose_drafts` + matching index inside
   `initializeCompleteDatabase()`.
3. `src/backend/database/database.ts` — import + `app.use` mount.
4. `src/backend/database/routes/compose-drafts.ts` (NEW) — express
   router with GET + PUT, cookie-JWT auth, NULL-key coalesce documented
   in header comment.
5. `src/ui/api/compose-drafts-api.ts` (NEW) — three axios/fetch
   helpers.
6. `src/ui/features/pretty-view/PrettyView.tsx` — thread `hostId` +
   `tmuxSession` into ComposeBox mount.
7. `src/ui/features/pretty-view/ComposeBox.tsx` — persistence state
   machine additions.
8. `docker/nginx.conf` — `/compose-drafts` location block.
9. `docker/nginx-https.conf` — `/compose-drafts` location block.

## Rebase risk

**MEDIUM on ComposeBox.tsx and PrettyView.tsx** — both are fork-hot
files that patches #43/#44/#45/#50/#51/#52 all touch, and the
compose-box neighborhood in particular has stacked feature layers
(the icon column has grown from 1 to 3 buttons across patches).
Every patch #57 addition is additive at natural extension points
(new props, new refs, new effects, new callbacks) so upstream
refactors should conflict resolvably.

**LOW on schema.ts / db/index.ts / database.ts** — Drizzle table
additions and mount-line additions are natural extension points
upstream rarely touches.

**LOW on route file + API client** — brand-new fork-only files with
no upstream analog.

**LOW on nginx configs** — new location block sits between two
existing fork-only blocks (`/message-queue` and `/sessions`); any
upstream nginx changes conflict at that neighborhood already.

## Cross-references

Mirrors the state machine established by:

- **Patch #39** — message-queue autosave baseline (server-side
  persistence + debounced PATCH on typing).
- **Patch #49** — debounced 400ms autosave via
  `debounceTimersRef` + `dirtyBodiesRef` + pagehide keepalive flush.
- **Patch #55** — keepalive DELETE + iterate `dirtyBodiesRef` (not
  `debounceTimersRef`) in flush loops + 10s setInterval retry.

Draft persistence is the same architectural pattern, adapted for a
single body per pane instead of an array of items.

## Patch story pointer

This will become **patch #57** in the fork's AGENTS.md numbered-patch
catalog. Per fork DEPLOY DISCIPLINE the AGENTS.md write-up happens at
PIN (post-deploy, after Ashley confirms the deploy holds), not at
commit — Ashley's deploy step is still pending and separate from
this commit.
