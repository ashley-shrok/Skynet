# Phase 128: Push notifications replacing Telegram bridge - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

**Sourced from:** `.planning/shapes/shape-notifications.md` — opened + greenlit 2026-09-21 via `/build → /open`. All decisions below extracted from that shape's grill. The shape file is the load-bearing agreement; this CONTEXT.md is its plan-phase-ready projection.

<domain>
## Phase Boundary

Replace the Telegram bridge that today delivers "an agent DMed you" notifications to Ashley's phone with real browser/PWA push notifications delivered by Skynet itself. Same trigger event; different delivery channel; the whole `tg-bridge` container + supporting infra comes out in the same shipping unit.

The load-bearing surface is the installed PWA on Ashley's phone (iOS). Desktop browsers get push as a natural side effect if they're subscribed, but they are not what makes or breaks this phase.

</domain>

<decisions>
## Implementation Decisions

### Trigger — what fires a push
- **D-01:** Trigger is a PER-EVENT shape check on incoming messages, not a stored designation. For each message arriving, ask: is the source room exactly two members, and is one of them a local agent (per agents-registry membership) and the other the human whose device is subscribed? If yes, push. If no, silent.
- **D-02:** Reuse the existing DM-classification concept — same underlying invariant as the `harness_dm` rule in `src/backend/relay-sessions/observation-loop-classifier.ts` and the `getSharedDMRoom` lookup in `src/backend/matrix/matrix-admin-client.ts`. Do NOT re-derive room-shape logic.
- **D-03:** Per-event shape check is deliberate over a cached "designated DM room per pair" mapping. If an agent ever creates or uses a second DM room by mistake, notifications must still land. Robustness beats efficiency.
- **D-04:** Only NEW messages from the agent side fire a push. Not edits, not reactions, not joins, not leaves, not system events. Ashley's own outbound messages (from any device) never push.
- **D-05:** No push when the app is currently open and displaying the target room. This is a soft signal — best-effort — not a load-bearing correctness invariant.

### Delivery — how a push reaches the device
- **D-06:** Standard web push machinery — service worker registered by the PWA + browser push service + iOS APNs relay for iOS PWAs. No custom transport.
- **D-07:** Content on the lock screen is `<agent display name>: <preview>` where `<preview>` is the same text the app's own message-row renders for that message type. A voice note reads whatever the row calls a voice note; an image reads whatever the row calls an image. No custom notification-body logic per message type.
- **D-08:** Tapping the notification opens the PWA directly into the DM room the message came from — deep link into that room, not just the app's default landing.
- **D-09:** One push per message. iOS handles visual grouping natively (stacked under the sender). No app-side coalescing or debouncing — coalescing loses per-message buzz which is the primary "something happened" signal, and it introduces a delay that makes push feel sluggish.

### Opt-in — how a device becomes subscribed
- **D-10:** Notification permission requires a user gesture — this is enforced by iOS for PWAs and by browsers generally. The opt-in flow presents an in-app surface (welcome/setup screen or an explicit "turn on notifications" button) that, when tapped, raises the OS permission sheet. NOT auto-prompted on first launch — iOS won't honor that for PWAs.
- **D-11:** After grant, the browser mints a subscription and the client posts it to Skynet's backend, which persists it per-user-per-device. Subscriptions live across restarts.
- **D-12:** No in-app off toggle. Turning off happens via iOS system settings for the PWA (or the browser's site-settings equivalent). System-level control is sufficient.
- **D-13:** Subscription lifecycle: register on grant, deliver on trigger, prune when the push provider reports the endpoint as `410 Gone` (or equivalent). No proactive per-device health checks.

### Multi-device — v1 scope
- **D-14:** Fire on every subscribed device. No cross-device smart routing ("she's on her laptop, don't buzz her phone"). Smart routing is deferred to a possible v2.

### Observability — v1 scope
- **D-15:** No status indicator, no "last delivered at" line, no health page, no self-test button. When the machinery breaks, Ashley will notice ("I haven't been pinged in a while") and complain. That is the intended feedback loop.
- **D-16:** Standard backend logs still capture per-attempt push results at the log level the rest of Skynet uses. No new observability surface — logs are the diagnostic tool of first resort (per role file standing directive).

### Tg-bridge teardown — same shipping unit
- **D-17:** The Telegram bridge and all its supporting infrastructure come out entirely in the same ship. Push landing and bridge leaving are ONE motion, not two ships. Rationale: leaving the bridge running "as a backup" defeats the consolidation goal — Ashley would get both a Skynet push AND a Telegram ping for every message.
- **D-18:** Teardown scope includes: all code under `src/backend/telegram/` (registry writer, bridge config writer, bot-token file writer, human-token writer, reconcilers, getme-proxy, routes, shared-volume, tokens-store, service-token minting), the `tg-bridge` Docker service in the compose file at `docker/docker-compose.yml`, any supporting endpoints on Skynet the bridge depends on, config env vars specific to the bridge (`SKYNET_BASE`, `SKYNET_BRIDGE_TOKEN`, `MATRIX_ROOT` in the bridge config.env — remove production references), the `tg-bridge-state` Docker volume, and any bridge-related columns/tables in Skynet's DB if they exist solely to support the bridge.
- **D-19:** The `getSharedDMRoom` helper in `src/backend/matrix/matrix-admin-client.ts` — used today by the bridge — is DELETED if no non-bridge caller remains. Planner: check for other callers before removing; if any exist, keep it.
- **D-20:** Bridge shutdown is destructive. On deploy, existing bridge subscriptions/tokens are dropped. Ashley knows this and accepts it (see shape file § What would make it wrong).

### Claude's Discretion
- Choice of web-push library or hand-rolled `Web Push Protocol` implementation on the backend (both are viable; VAPID key generation + push send is well-understood).
- Exact schema for the push subscriptions table (per-user, per-device, endpoint, keys, created_at, last_delivered_at). Planner picks.
- Which existing observation-loop hook to reuse for the trigger (there is already an observation loop consuming messages per user).
- Whether the service worker file is generated at build time or hand-written and served statically. Planner picks.
- Whether the PWA manifest already declares everything push needs, or requires additions.
- The specific in-app surface for the "turn on notifications" gesture — welcome dialog, settings screen, both. Planner picks based on where a first-time user would naturally see it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (LOAD-BEARING)
- `.planning/shapes/shape-notifications.md` — the shape file governing this phase. Read this first. Everything in this CONTEXT.md is derived from it; the shape file is the authoritative agreement. `/close notifications` at the end of the phase verifies the built result against it.

### Existing DM-classification concept (the trigger hooks into this)
- `src/backend/relay-sessions/observation-loop-classifier.ts` — pure decision tree that classifies rooms per-user. The `harness_dm` reason (D-08 rule) is the exact invariant the push trigger needs to match. Do NOT re-derive.
- `src/backend/relay-sessions/observation-loop.ts` — the runtime loop that consumes the classifier.
- `src/backend/relay-sessions/observation-loop-starter.ts` — how the loop is initialized per user.

### Existing Telegram-bridge assets (relevant to teardown + to the DM-room lookup convention)
- `src/backend/telegram/` — entire directory scope of the teardown. Especially `registry-writer.ts`, `bridge-config-writer.ts`, `routes.ts`, `shared-volume.ts`, `tokens-store.ts`.
- `src/backend/matrix/matrix-admin-client.ts` §`getSharedDMRoom` (~line 710) — the bridge's per-pair discovery function; useful reference for how the shape check is expressed against Matrix, even though the trigger side uses per-event classification not per-pair lookup.
- `docker/docker-compose.yml` — `tg-bridge` service definition + `tg-bridge-state` volume. Removed in teardown.

### PWA + web-push infrastructure surfaces
- `docker/nginx.conf` and `docker/nginx-https.conf` — nginx routing; may need entries for a new push-subscription endpoint and the service worker if not already served naturally.
- `src/ui/` — PWA manifest and service worker registration entry points (planner to locate; there's an existing service worker or there isn't — treat both as possible).

### Role + fleet governance
- `~/fleet/roles/box-maintainer/box-maintainer.md` — standing directives especially: deploy boundary (push ≠ ship), container-mutation serialization, subagents don't deploy, no message streaming, in-memory DB persistence via `DatabaseSaveTrigger.forceSave()`, backend TS errors need `npm run build:backend`, test discipline (scoped for dev, full suite only for deployment).

### No external specs
No ADR or PRD exists for this feature outside the shape file. The shape file plus this CONTEXT.md are the specification.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Observation loop + classifier** (`src/backend/relay-sessions/*`) — already observes messages arriving in the rooms Skynet knows about, per-user; already identifies the "you + one local agent" two-party DM shape. The trigger for push should be a new consumer of the same observation events, not a parallel observer.
- **Matrix admin client** (`src/backend/matrix/matrix-admin-client.ts`) — for anything needing member-count or membership introspection at push-send time (should be minimal — classifier already provides this).
- **DatabaseSaveTrigger.forceSave pattern** — required after any backend DB write per fleet standing directive. Applies to subscription registration/deletion.
- **Fleet-substrate distributor** — if any part of this phase's client bits need to reach managed boxes, use the substrate distributor (source in Skynet repo under `substrate/`, catalog at `src/backend/distributor/catalog.ts`). Push subscription is per-browser so this is unlikely to apply, but flag if planner discovers otherwise.

### Established Patterns
- **In-memory SQLite + DatabaseSaveTrigger** — backend DB writes reach RAM only unless `forceSave` is called. Push subscription rows are durable, so writes MUST call `forceSave` in a try/catch with warning-level failure logging.
- **Backend TS build gate** — `npm run build:backend && npm run build` catches errors that frontend `tsc --noEmit` misses. Required for any patch touching `src/backend/`.
- **Docker compose service removal** — removing `tg-bridge` from the compose file is a coordinated container mutation (per role file § container mutations serialize). Deploy step must go through orchestrator, not subagent executors.
- **Bridge-writer atomic-write pattern** (`registry-writer.ts:writeRegistry`) — tmp + rename, mode 0644 or 0600 as needed. Not directly reusable (bridge is coming out) but the pattern is standard in this repo if anything else needs atomic file writes.

### Integration Points
- **Where the trigger hooks in:** as a new consumer of the observation loop's per-message event stream, in `src/backend/relay-sessions/` (planner picks the specific insertion point).
- **Where subscriptions get persisted:** a new table in `src/backend/database/db/schema.ts` + a route module under `src/backend/database/routes/` for register/unregister endpoints.
- **Where the push is sent from:** a new module under `src/backend/notifications/` (or wherever the planner deems the right slice). It receives (userMxid, agentMxid, roomId, messageBody) from the trigger, resolves subscriptions for that user, and dispatches web push per subscription.
- **Where the client subscribes:** service worker registration + subscription-mint code lives on the frontend. UI surface for the opt-in gesture is a new component (or a small addition to existing onboarding/settings surfaces).
- **Where the bridge exits:** `src/backend/telegram/` deleted, `src/backend/database/database.ts` route mounts removed, nginx blocks removed, compose service + volume removed, any Skynet-side bridge endpoints removed.

</code_context>

<specifics>
## Specific Ideas

- **Ashley's stated motivation:** consolidation, not "Telegram is broken." She wants one fewer app in the loop — no complaint about Telegram's delivery quality.
- **iOS PWA constraint is real and named:** notification permission cannot be auto-raised on first launch. The setup flow MUST route through a user tap.
- **Non-text messages:** whatever the app row renders, verbatim. If the row calls a voice note "Voice message", the notification body says "Voice message". No custom logic per message type — do the easy thing.
- **Grouping behavior:** iMessage / WhatsApp / Telegram all send one push per message and let iOS group. Same here.
- **When Ashley is on the target room in the app:** no push. Best-effort skip, not a strict invariant.

</specifics>

<deferred>
## Deferred Ideas

### Explicitly deferred to a future phase
- **Cross-device smart routing.** "She's on her laptop, don't buzz her phone." Nicer UX; requires activity tracking per device + coordination at send time. Not v1.
- **Per-conversation mute / do-not-disturb / quiet hours.** No preference surface in v1.
- **Notifications for foreign-Skynet agents' messages or for group rooms.** Silent in v1 by design. If Ashley ever wants group-room pings or foreign-agent pings, that's a separate shape.
- **An in-app notifications on/off toggle.** iOS system settings handle this in v1.
- **A notifications health/status UI, a "last delivered" indicator, or a self-test button.** Reactive feedback loop is the design.
- **A rich notification-preferences settings panel.** Nothing in v1 requires it.
- **Sending a test push during onboarding.** Real messages arrive soon enough; observability isn't the game.
- **Caching a designated DM room per agent-human pair.** Explicitly rejected — the per-event shape check is by design to avoid the "notifications dropped because the app was looking at the wrong room" failure.

### Not deferred, just noted
None — discussion stayed inside the shape's scope edges throughout.

</deferred>

---

*Phase: 126-push-notifications-replacing-telegram-bridge*
*Context gathered: 2026-09-21*
