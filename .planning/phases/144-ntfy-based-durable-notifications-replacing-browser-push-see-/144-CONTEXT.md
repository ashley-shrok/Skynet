# Phase 144: ntfy-based durable notifications - Context

**Gathered:** 2026-10-02
**Status:** Ready for planning
**Source:** Seeded from shape file `.planning/shapes/shape-ntfy-notifications.md` (per fleet rule — the shape's /open discussion beat captured all design decisions; do not re-elicit)

<domain>
## Phase Boundary

Replace Skynet's current browser-based push notification system end-to-end
with a self-hosted ntfy server that publishes to a per-user topic, received
by the ntfy iOS app via Apple's push infrastructure. Pure cutover — the
Phase 128 browser-push system (web-push library, VAPID keys, service worker
push handler + rotation handler, PushManager flow in preferences) deletes
in the same ship as ntfy goes live. No dual-transport window.

The triggering event stays the same (a 1:1 DM from an agent to the user).
The notification content stays the same (agent display name, message
preview, deep-link tap-through to the specific conversation). The matrix
polling loop, display-name resolution, and preview composition are
unchanged. Only the transport layer swaps.

Audit of the existing pipeline (performed during /open against
skynet-tina HEAD `013e1d6b`) confirmed:
- `src/backend/notifications/push-trigger-loop.ts` — 2s matrix polling,
  harness_dm classification via `observation-loop-classifier`
- `src/backend/notifications/push-sender.ts` — web-push publishing with
  VAPID; 410/404 prune, non-410 log-and-retry-next-tick
- `src/backend/notifications/vapid-config.ts` — VAPID env + boot assertion
- `src/backend/notifications/preview-text.ts` — msgtype handling (text,
  image, audio, video, file), never-empty guard
- `src/backend/notifications/resolve-agent-display-name.ts` — identity +
  role file read, 40-char cap
- `src/backend/database/routes/push-subscriptions.ts` — subscription
  CRUD + VAPID public key endpoint
- `src/backend/database/db/schema.ts:907-933` — push_subscriptions table
  (id, user_id, endpoint, p256dh, auth, created_at, last_delivered_at)
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` — the
  current preferences pane (lines 62-71 is the "lie" — reads
  `Notification.permission` only, no backend-truth check)
- `src/ui/features/notifications/push-subscription-api.ts` — frontend
  subscription registration + rotation
- `src/ui/features/notifications/open-harness-deep-link.ts:40-108` —
  deep-link parser (KEEP — unchanged for ntfy transport)
- `public/sw.js` — service worker push handler (lines 99-131, DELETE),
  notificationclick (lines 133-178, KEEP), pushsubscriptionchange rotation
  handler (lines 180-244, DELETE)

</domain>

<decisions>
## Implementation Decisions (LOCKED by shape)

### Infrastructure
- Each Skynet instance runs its own ntfy server inside its own Docker
  compose stack. No shared ntfy infrastructure across instances.
- Caddy routes a path prefix on the instance's existing public hostname
  to the ntfy container — no dedicated subdomain, no additional TLS
  certificate, no new DNS record.
- The ntfy server's config field for its public base URL is derived from
  the instance's existing hostname configuration (Skynet already knows
  its own hostname somewhere; reuse that signal).
- Publishing from Skynet backend to ntfy happens over the internal
  Docker network only — never traverses the public internet.
- ntfy server config includes `upstream-base-url: "https://ntfy.sh"` for
  iOS wake-up relaying (see ntfy.sh dependency below).

### Credentials
- One Skynet-held publishing credential, write-only, lives in encrypted
  backend storage. Never distributed to hosts, never lands in any agent's
  context.
- One per-user reading credential, read-only, also stored encrypted on
  backend. Surfaced to the user via the preferences pane for manual
  entry into the ntfy iOS app.
- Hard credential rotation on regenerate — old credential invalidates
  immediately, no overlap window.

### ntfy.sh upstream relay
- iOS wake-ups route through ntfy.sh as a necessary third-party relay.
  The ntfy iOS app's APNs certificate is held by the ntfy project; we
  can't bring our own without building our own iOS app (rejected).
- When Skynet publishes a message, our ntfy server sends a "poll request"
  (message ID + topic hash, NO content) upstream to ntfy.sh. ntfy.sh
  pushes an Apple wake-up to the phone. The phone's ntfy app then fetches
  the actual message body directly from our self-hosted server.
- Content stays private (never transits ntfy.sh). Metadata (that a
  notification happened, when, which topic hash) is visible to ntfy.sh.
- iOS push reliability couples to ntfy.sh's uptime.

### Topic model
- One topic per user (not per-agent). Agent identity rides in the
  payload as it does today.
- Topic names are unguessable (opaque per-user identifier).

### Trigger (UNCHANGED from Phase 128)
- Keep `push-trigger-loop.ts` as-is (2s polling, harness_dm classification).
- Keep `resolve-agent-display-name.ts` as-is.
- Keep `preview-text.ts` as-is (including never-empty guard).
- Keep `open-harness-deep-link.ts` as-is (deep-link parser).

### Publishing path
- Replace `webpush.sendNotification()` call in `push-sender.ts` with an
  HTTP POST to the local ntfy server over the internal Docker network.
- Mirror the current error-handling posture exactly: log on failure,
  drop the notification, no retry, no queue, no circuit breaker, no
  buffered notifications. Fire-and-forget-with-logs.
- One push per DM — no coalescing, no priority tiers, no quiet hours.

### Data model
- Replace the existing `push_subscriptions` table shape (p256dh + auth
  are browser-push-specific crypto fields; delete those columns).
- New shape should carry: user_id, topic_name, reading_credential_hash
  (or similar — final shape in planner's hands).
- Migration: existing browser-push rows are discarded in the cutover;
  users re-set-up via the new flow. No bridge table, no dual-write.

### Preferences pane rebuild
- Delete the current "grant browser permission" button flow entirely.
- Replace with a setup pane showing three values for the user to enter
  in the ntfy iOS app: server address (instance hostname + path prefix),
  topic name, reading credential.
- Add a "Send test notification" button. Tapping it publishes a test
  message to the user's topic. If the phone buzzes, setup works. The
  test button is the ONLY ground truth for delivery health — no passive
  "last delivery was N seconds ago" indicator, no heartbeat, no silent
  drift detection.
- Add a "Regenerate credential" button. Tapping it invalidates the
  current reading credential immediately and issues a new one. The
  user must re-enter the new values in the ntfy app.
- Honest state signaling: "set up" state means a credential has been
  issued for this user. Nothing more. No lies.

### Service worker cleanup
- Delete the `push` event handler in `public/sw.js` (lines 99-131).
- Delete the `pushsubscriptionchange` rotation handler (lines 180-244).
- KEEP the `notificationclick` handler (lines 133-178) — unused after
  deletion, so also delete it. (Actually the whole push surface in SW
  goes away since ntfy pushes land in the ntfy iOS app, not the browser
  background worker.)

### Deletion scope
- Remove `web-push` and `@types/web-push` from package.json.
- Remove `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env
  vars from skynet.env and any config loaders.
- Remove the GET /push-subscriptions/vapid-public-key endpoint.
- Remove any VAPID-specific test infrastructure.
- Remove `assertVapidConfigAtBoot()` from `src/backend/starter.ts`.
- Audit for and remove orphan browser-push code paths.

### No instance-specific hardcoding
- All URLs — ntfy's `base-url` config, the server address shown in the
  preferences pane, the URL the ntfy iOS app points at — derive from
  the instance's own existing public-hostname configuration.
- Code that works on `term.gigaashley.click` must work identically on
  `skynet.aithercloud.com` and any future instance.

### What's deliberately NOT in this phase
- System-generated notifications (deploy alerts, login warnings,
  task-done pings). Current trigger pipeline only handles agent DMs;
  same for ntfy. Deferred.
- Per-agent muting, coalescing, priority tiers, quiet hours. Deferred.
- Desktop push of any flavor. Deferred.
- A native iOS Skynet wrapper app. Rejected.
- The ntfy server as a general-purpose box service for anything
  outside Skynet. Rejected.
- Proactive drift detection / heartbeat / background delivery probes.
  Rejected.
- Durability queue or retry logic for ntfy publishing failures. Rejected.
- QR-code bootstrap flow (ntfy iOS app has no QR scanner). Rejected.
- Migration ceremony for existing browser-push subscribers (there's
  only one real user affected, and she's shipping this; ceremony
  is noise).

### Claude's Discretion
- Final ntfy server configuration file structure (ntfy's docs are the
  reference).
- Final `push_subscriptions` table schema after column drop/rename —
  exact column names, index strategy.
- The specific Caddy configuration syntax for path-prefix proxying.
- Credential generation algorithm (opaque string, reasonable entropy).
- Specific logging format for publish failures (match existing log
  patterns in the codebase).
- Split-vs-one phase decision — the planner's call based on scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (primary source of truth)
- `.planning/shapes/shape-ntfy-notifications.md` — The full design shape
  from /open. Contains Philosophy, Prior context, What-would-make-it-wrong,
  and Scope edges sections not duplicated here.

### Existing notification system (what gets modified or deleted)
- `src/backend/notifications/push-trigger-loop.ts` — matrix polling + 1:1
  DM classification. KEEP.
- `src/backend/notifications/push-sender.ts` — publishing path. REPLACE
  the `webpush.sendNotification()` call with ntfy HTTP POST.
- `src/backend/notifications/vapid-config.ts` — VAPID env + boot
  assertion. REPLACE with ntfy-config equivalent.
- `src/backend/notifications/preview-text.ts` — msgtype handling. KEEP.
- `src/backend/notifications/resolve-agent-display-name.ts` — identity
  display-name resolution. KEEP.
- `src/backend/database/routes/push-subscriptions.ts` — subscription
  CRUD. REBUILD for ntfy data model.
- `src/backend/database/db/schema.ts:907-933` — push_subscriptions
  table definition. REPLACE columns.
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` — the
  current preferences pane. REBUILD per shape UX.
- `src/ui/features/notifications/push-subscription-api.ts` — frontend
  subscription API. REBUILD.
- `src/ui/features/notifications/open-harness-deep-link.ts` — deep-link
  parser. KEEP (unchanged).
- `public/sw.js` — service worker. DELETE push + rotation + click
  handlers (click handler is useless without pushes landing here).

### Phase 128 shape (historical context for what's being replaced)
- `.planning/shapes/shape-notifications.md` — the original browser-push
  shape (olympus, 2026-09-21).

### ntfy external docs
- https://docs.ntfy.sh/config/ — ntfy server configuration reference.
- https://docs.ntfy.sh/config/#ios-instant-notifications — iOS upstream
  relay setup (the ntfy.sh dependency).
- https://docs.ntfy.sh/publish/ — publishing API (HTTP POST shape).
- https://docs.ntfy.sh/subscribe/phone/ — iOS app subscription flow.

### Running infrastructure (reference, not modify)
- `docker/docker-compose.yml` — the compose stack ntfy container joins.
- `caddy/Caddyfile` (or wherever Caddy config lives) — reference for
  how path-prefix routing is configured on this instance.

</canonical_refs>

<specifics>
## Specific Implementation Points

- The audit in /open noted that `push-sender.ts` uses `web-push`'s
  parallel `Promise.all()` over all subscription rows for a user. For
  ntfy with one-topic-per-user, there's a single POST per publish; the
  parallel pattern collapses to a single call.
- The `PreferencesNotificationsPane.tsx:84` synchronous `requestPermission()`
  invariant (no await boundary before the permission call, D-19) does
  NOT apply to the new flow — ntfy setup doesn't require a browser
  permission at all. The new pane has no permission dialog.
- The `pushsubscriptionchange` handler at `public/sw.js:180-244` existed
  specifically because iOS silently rotated the web-push subscription.
  No analog needed for ntfy — the ntfy iOS app handles its own
  subscription lifecycle with ntfy.sh / Apple.
- Deep-link format stays: `/?openHarness=<agent-mxid>&host=<host-id>`.
  The ntfy payload carries these in the click_url field; the ntfy iOS
  app opens the URL on tap.

</specifics>

<deferred>
## Deferred Ideas

- Per-agent topics as a path to per-agent muting UX.
- A Skynet-system Matrix identity for non-agent notifications (deploy,
  login, task-done) flowing through this same pipeline.
- Desktop push via ntfy's web client or native desktop clients.
- Coalescing / priority tiers if real storms become a pain in practice.
- Any migration ceremony for existing browser-push users.

</deferred>

---

*Phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-*
*Context seeded 2026-10-02 from shape file (per fleet rule — no discuss-phase round)*
