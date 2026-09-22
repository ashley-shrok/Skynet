# Shape: Push notifications, replacing Telegram

**Opened:** 2026-09-21
**Vehicle:** GSD phase

## What this is

Real browser and PWA push notifications delivered by Skynet itself, replacing the Telegram bridge that currently handles this job. When one of the user's agents sends a message into the DM room she shares with them, her phone (as an installed PWA) rings — the same way any messaging app rings when someone messages you — without depending on Telegram being installed or on a bridge service running to translate between them.

## Shape

Three pieces fit together, and one piece comes out.

**The trigger.** Skynet already observes messages arriving in the rooms it knows about. For each incoming message, it asks a question about the room the message came from: is this a room with exactly two members, and is one of them a local agent and the other the human whose device we would push? If yes, that message should push. Group rooms don't qualify. Rooms involving foreign agents from another Skynet don't qualify. Rooms with any humans besides the one being notified don't qualify. Only genuine 1:1 you-and-your-agent DMs. Edits to older messages, reactions, joins, leaves, and other room activity don't count — only a fresh new message from the agent side.

**The delivery.** Push happens over the standard web push mechanism the platform provides. The installed PWA has granted notification permission (once, during onboarding), which registers a subscription with Skynet's server. When the trigger fires, Skynet hands the push to the browser's push service, which wakes the phone and displays the notification even if the PWA is closed. What appears on the lock screen is the sender's agent name plus a preview of what they sent — the same preview text the app's own message row would display, so a voice note reads however the app already labels voice notes, an image however the app labels images. Tapping the notification opens the PWA directly into the DM room the message came from.

**The opt-in.** Getting from "just installed the PWA" to "notifications enabled" is a one-time flow per device: a welcome or setup moment inside the app has a "turn on notifications" tap, and tapping it raises the OS permission sheet. This two-step (tap in the app, then tap in the system sheet) is required on iOS PWAs — the sheet cannot be raised without a user gesture, so an "on first launch, prompt automatically" pattern won't work there. Once granted, the device is subscribed and receives pushes until the user revokes permission through the phone's own system settings.

**And what comes out.** The whole Telegram bridge that today handles this same "message arrived, ping the human" job — the bridge service running in the container stack, its registry files, its bot tokens, its config env vars, its supporting endpoints on Skynet — comes out. Same shipping unit. Push landing and bridge leaving are one motion.

## Philosophy

**Consolidation over integration.** The value here is not "better notifications than Telegram had." Telegram notifications are fine. The value is one fewer app in the loop, one fewer separate thing to install, one fewer surface to check. If we ship push that works but leave the Telegram bridge running "as a backup," we've made things worse — both surfaces will ring, and now there's more infrastructure to keep alive, not less. The point is subtraction.

**Real notifications, not in-app.** These are OS-level, lock-screen, wake-your-phone notifications. Not badges. Not in-app toast messages. Not counter dots on a tab. The Telegram bridge worked because it woke the phone from the outside; anything that only works while the app is already open does not replace what's being removed.

**The trigger is the shape, not a stored mark.** No column in the database says "this room is designated as THE DM room." Every incoming message is checked against the shape rule (two members, one is a local agent, the other is you). This is deliberate — it means if an agent ever creates a second DM room by mistake, or the app's idea of a "primary" DM ever drifts, notifications still land. The alternative — cache a designated room per pair — is a small optimization at the cost of a real failure mode (notifications dropped because the app was looking at the wrong room).

**No proactive observability.** No "notifications last delivered at" indicator, no health status page, no self-test button. When the machinery breaks, the user will notice ("I haven't been pinged in a while") and complain, and then it gets fixed. That is the intended feedback loop; building status UI upfront would be effort spent on a problem the feedback loop already handles.

## Prior context

Today, when an agent messages the user in a 1:1 DM room, a Telegram bridge running as a container service on this box notices the message, matches it against a registry of (agent, human) pairs, and forwards the message text to the user's Telegram account via a bot. the user then sees a Telegram notification on her phone, taps into Telegram, reads the message, and — separately — opens Skynet if she wants to reply. This works. It has been working reliably. Its cost is that Telegram is a whole second app in the loop, and every human Skynet ever registers needs a Telegram account, needs a bridge bot set up, and needs to keep Telegram installed and current.

The bridge itself already knows how to identify "the DM room for this (agent, human) pair" — it does the same underlying shape check (find a two-party room shared by both) at registry-write time and stores the room in its config. So the room-identification logic is not new work in concept; only its packaging changes (per-event shape check on the receive side, rather than ahead-of-time discovery on the send side).

Skynet is a PWA-capable web app. iOS supports web push for PWAs installed to the home screen since iOS 16.4. Desktop browsers have supported web push for years. The infrastructure primitives needed for this feature exist in the platform; no exotic dependency is being introduced.

## What would make it wrong

- **A message from the user's own agent, in her DM room with them, does not push.** If it doesn't, this has missed the point entirely — this is exactly the replacement scope.
- **Non-DM traffic pushes.** A group room she is in, a foreign agent's message, a system event, an edit to a message from an hour ago — none of those should push. If they do, notifications become noise and get muted, which is the same as not having them.
- **Push works only when the browser tab is already open.** That is in-app notifications, not push. The whole point is her phone wakes from a locked, closed state.
- **The bridge is still running in production when the ship lands.** Even for a "safety" reason, leaving it running defeats the consolidation goal — she'd get both a Skynet push and a Telegram ping for every message, twice the buzz for the same event.
- **Turning on notifications requires her to know something technical.** If the setup flow says anything about service workers, subscription endpoints, tokens, or asks her to paste anything — wrong. It's a tap during onboarding and a system permission sheet, nothing else.
- **Content on the lock screen differs surprisingly from what the app shows.** If the app row for a voice note says "Voice message" but the notification says something unrelated or opaque, they've drifted apart and the notification stops feeling like the same conversation the app renders.

## Scope edges

**In:**
- Web push delivery from Skynet to any subscribed device — phone PWA is the load-bearing case; desktop browsers get it as a natural side effect if they're subscribed.
- Per-event shape-based trigger identifying eligible DM messages, reusing the app's existing DM-classification concept.
- One-time setup/opt-in flow inside the PWA that raises the OS permission prompt via a user tap.
- Backend subscription lifecycle: register on grant, deliver on trigger, tolerate dead subscriptions when the push service reports them as gone.
- Complete removal of the Telegram bridge — service, registry, tokens, config, related endpoints on Skynet.
- Whatever PWA-manifest and service-worker work is necessary to make the installed PWA a valid push target on iOS and desktop browsers.

**Out:**
- Cross-device smart routing ("she's on her laptop, don't buzz her phone"). Every subscribed device gets the push.
- Per-agent mute, do-not-disturb, or quiet hours.
- An in-app on/off toggle for notifications. iOS system settings handle this.
- A notifications health/status UI, a "last delivered" indicator, or a self-test button.
- Notifications for anything other than fresh DM messages from the agent side.
- Notifications for messages the user herself sends into her own DM rooms.

**Deferred:**
- Multi-device smart routing.
- Per-conversation mute and quiet hours.
- Anything that behaves differently for messages from foreign-Skynet agents or for group rooms — those categories stay silent in v1, and changing that is a separate shape.

**Tempting but no:**
- Building a rich notification-preferences settings panel "since we're in the neighborhood." Adds surface no one asked for and puts the app on the hook for maintaining preferences whose absence is exactly what v1's scope depends on.
- Sending a test push during onboarding to prove it worked. Nice UX polish, but a real message will land soon enough and observability is deliberately not the game here.
- Caching a designated DM room per agent-human pair for efficiency. The per-event shape check is by design; caching reintroduces the "notifications dropped because the app was looking at the wrong room" failure mode we deliberately chose to avoid.

## Vehicle notes

**Vehicle:** GSD phase. The work spans multiple subsystems (backend event observation and push send, browser service worker and subscription flow, PWA manifest, opt-in UI, bridge teardown) and has a real deploy-sensitive surface (subscriptions live across restarts; removing the bridge is destructive). That's phase-sized.

**Recommended pipeline:** `/gsd:phase` to slot the phase into the roadmap, then `/gsd:plan-phase` — which per the build skill's guidance should seed discuss-phase's CONTEXT.md from this shape file rather than re-eliciting the same ground.

**Related existing pieces the planner should be aware of:**
- The observation loop and per-user room classifier already exist and already know how to identify the "you + one local agent, two-party" room shape. The push trigger should hook into this classification, not re-derive it.
- The Telegram bridge lives in one identifiable area of the backend, one Docker service in the compose file, and a handful of endpoints on Skynet that support it. Its teardown scope is bounded but real, and should be visible in the phase plan as its own tasks.
- The current bridge uses a per-pair discovery function that scans for the shared 2-member room; that logic informs (but does not need to be reused by) the per-event trigger side.

**Identity doing the work:** `olympus-box-maintainer` on this box.

**Close arc:** `/close notifications` at the end verifies the built result matches this shape both ways (nothing in the shape missing from the build, nothing in the build that wasn't in the shape).

---

## Close-Out

**Closed:** 2026-09-21
**Vehicle used:** GSD phase
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is** — partial · Skynet-native push delivery to the installed PWA is present end-to-end, but the Telegram replacement is incomplete — Telegram is gone from the backend and container stack, but not from the PWA itself.
- **Shape — the trigger** — present · Per-event pipeline filters non-messages, self-sent, edits, and non-DM rooms; classifier is called per event with no cached DM designation.
- **Shape — the delivery** — present · Web Push via VAPID; service worker calls showNotification on every push; notification body is agent display name plus preview text derived server-side; tapping opens the PWA into the DM room via a deep-link param.
- **Shape — the opt-in** — present · Single tap raises the OS permission sheet inside the click gesture with no await before the request; button remains reachable at all times for re-subscription; no auto-prompt on mount.
- **Shape — and what comes out** — partial · Backend telegram directory, tg-bridge substrate service, docker service, nginx routes, bot-token table, voice-route bridge special-case, and admin-route migration handler are all gone — but the frontend Telegram tab, its API client, and its modal wiring remain live in the PWA. Same shipping unit was supposed to remove Telegram entirely.
- **Philosophy — consolidation over integration** — partial · Backend consolidation achieved; frontend still presents a Telegram tab to admins, so the "one fewer surface" promise is only half-kept on the visible surface.
- **Philosophy — real notifications, not in-app** — present · Push happens via the browser's push service inside the service worker's push event — wakes the device from a locked/closed state; not an in-app toast.
- **Philosophy — the trigger is the shape, not a stored mark** — present · Every event flows through the shape-based classifier; no per-pair designated DM room is cached; a second DM room would still push.
- **Philosophy — no proactive observability** — present · No last-delivered indicator, no health page, no self-test button; the button carries a status label but no delivery introspection.
- **Prior context — reuse existing DM classifier** — present · The push trigger calls the same classifier the observation loop uses; DM-shape logic is not re-derived.
- **What would make it wrong: DM message from the user's own agent does not push** — present · That is the exact positive path the pipeline is built around — sender is the local agent, room is two-member harness_dm, event is a fresh m.room.message.
- **What would make it wrong: non-DM traffic pushes** — present · Group rooms materialize (not push); admin rooms, solo rooms, non-member rooms, and rooms whose other member is not in the local agents registry all return a non-harness_dm classifier reason and are skipped.
- **What would make it wrong: edits, reactions, joins/leaves push** — present · Non-m.room.message events are filtered; edit events (m.replace relation) are explicitly filtered out; only fresh messages reach dispatch.
- **What would make it wrong: push works only when tab is open** — present · Delivery is via the service worker's push event and self.registration.showNotification with event.waitUntil — wakes the device even with the PWA closed.
- **What would make it wrong: the bridge is still running in production when the ship lands** — drifted · The bridge service and its backend endpoints are gone, but the Telegram tab is still in the PWA for admins — the visible Telegram surface has not fully left the shipping unit.
- **What would make it wrong: opt-in requires technical knowledge** — present · One tap, one system permission sheet; no service-worker, subscription, or token language surfaced to the user.
- **What would make it wrong: lock-screen content differs surprisingly from what the app shows** — present · Preview text derivation mirrors the substrate agent-relay recv taxonomy byte-for-byte (image/audio/video/file labels), with text messages passed through and truncated; documented as the intended shared source until a future unification.
- **Scope In — web push delivery to any subscribed device** — present · sendPushToUser dispatches to every subscription row for a user in parallel; no device-selection routing.
- **Scope In — per-event shape-based trigger reusing DM classification** — present · The loop's filter step delegates to the existing classifyRoom without re-deriving shape logic.
- **Scope In — one-time opt-in flow raising OS permission via a user tap** — present · Button click synchronously invokes Notification.requestPermission and, on grant, subscribes and posts to the backend.
- **Scope In — backend subscription lifecycle with dead-endpoint tolerance** — present · Register endpoint deduplicates on (user, endpoint); sender inline-prunes rows on 410/404 and force-saves only when a prune occurred.
- **Scope In — complete removal of the Telegram bridge (service, registry, tokens, config, related endpoints)** — missing · Backend and container removal is complete; frontend Telegram tab, API client, and modal wiring remain in the app, and a stale token-field entry remains in the field-crypto allowlist.
- **Scope In — PWA-manifest and service-worker work to make the PWA a valid push target** — present · Service worker registers push, notificationclick, and pushsubscriptionchange handlers; manifest declares standalone display with icons.
- **Scope Out — cross-device smart routing** — present · No routing logic; every subscription gets fired.
- **Scope Out — per-agent mute / DND / quiet hours** — present · No mute, DND, or quiet-hours surface.
- **Scope Out — in-app on/off toggle for notifications** — present · The button is enable-only; there is no in-app disable path.
- **Scope Out — notifications health/status UI, last-delivered indicator, self-test button** — present · None of these surfaces exist; only a per-button status label.
- **Scope Out — notifications for anything other than fresh DM messages from the agent side** — present · Filter pipeline restricts to exactly this.
- **Scope Out — notifications for messages the user herself sends** — present · Self-sent messages are filtered by sender-equality check.
- **Tempting-but-no — rich notification-preferences settings panel** — present · None was built.
- **Tempting-but-no — test push during onboarding** — present · None was built.
- **Tempting-but-no — caching a designated DM room per pair** — present · The loop deliberately re-classifies per event and does not cache a designated room.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Remove the frontend Telegram surface in the PWA — the Telegram tab in the identity modal, the telegram-api client, the associated tests, and the stale field-crypto allowlist entry — so the whole Telegram surface leaves in the same shipping unit as the backend teardown intended. — user directed to close in the SAME shipping unit (no later shape queued); folding fix into current phase and re-closing before deploy.

### Notes

The phase's own 128-09 summary explicitly flagged the untouched UI-side Telegram surface as a follow-up but no follow-up shape was ever opened. Post-teardown the frontend's Telegram calls hit 404s at the now-unmounted routes. The core push-notifications machinery matches the shape closely — per-event classifier reuse, no cached DM designation, no observability UI, one-tap gesture-gated opt-in, delivery via the browser push service with service-worker rehydration on rotation, and inline dead-endpoint pruning. The frontend teardown gap is the sole load-bearing miss.

---

## Close-Out (re-close after fix)

**Closed:** 2026-09-21
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Skynet-native push delivery to the installed PWA is present end-to-end, and the Telegram surface is fully gone from backend, container stack, substrate, and PWA in the same shipping unit.
- **Shape — the trigger** — present · Per-event pipeline filters non-messages, self-sent, edits, and non-DM rooms; the classifier runs on every event with no cached DM designation.
- **Shape — the delivery** — present · Web Push via VAPID; service worker calls showNotification on every push with agent display name plus server-derived preview; tapping opens the PWA into the DM room via a deep-link param, and a rotation handler silently re-subscribes.
- **Shape — the opt-in** — present · Single tap raises the OS permission sheet inside the click gesture with no await before the request; button remains reachable at all times for re-subscription; no auto-prompt on mount and no in-app disable path.
- **Shape — and what comes out** — present · Backend telegram directory, tg-bridge substrate service, docker service, nginx routes, bot-token table (dropped at boot), voice-route bridge special-case, admin-route migration handler, field-crypto allowlist entry, and the frontend TelegramTab + telegram-api client are all gone in the same ship.
- **Philosophy — consolidation over integration** — present · Whole Telegram surface leaves — both backend infrastructure and the visible PWA tab — so there is one fewer app in the loop.
- **Philosophy — real notifications, not in-app** — present · Push happens via the browser's push service inside the service worker's push event with event.waitUntil — wakes the device from a locked/closed state; not an in-app toast.
- **Philosophy — the trigger is the shape, not a stored mark** — present · Every event flows through the shape-based classifier; no per-pair designated DM room is cached; a second DM room would still push.
- **Philosophy — no proactive observability** — present · No last-delivered indicator, no health page, no self-test button; only a local click-outcome status on the enable button.
- **Prior context — reuse existing DM classifier** — present · The push trigger calls the same classifyRoom the observation loop uses; DM-shape logic is not re-derived.
- **What would make it wrong: DM message from the user's own agent does not push** — present · That is the exact positive path the pipeline is built around — sender is the local agent, room is two-member harness_dm, event is a fresh m.room.message.
- **What would make it wrong: non-DM traffic pushes** — present · Group rooms, admin rooms, solo rooms, non-member rooms, and rooms whose other member is not in the local agents registry all return a non-harness_dm classifier reason and are skipped.
- **What would make it wrong: edits, reactions, joins/leaves push** — present · Non-m.room.message events are filtered; edit events (m.replace relation) are explicitly filtered out; only fresh messages reach dispatch.
- **What would make it wrong: push works only when tab is open** — present · Delivery is via the service worker's push event and self.registration.showNotification with event.waitUntil — wakes the device even with the PWA closed.
- **What would make it wrong: the bridge is still running in production when the ship lands** — present · Bridge service, backend telegram directory, endpoints, bot-token table, substrate service payload, docker service, and the PWA-side Telegram tab and API client are all removed together — no both-surfaces-buzz risk.
- **What would make it wrong: opt-in requires technical knowledge** — present · One tap, one system permission sheet; no service-worker, subscription, or token language surfaced to the user.
- **What would make it wrong: lock-screen content differs surprisingly from what the app shows** — present · Preview text derivation mirrors the substrate agent-relay recv taxonomy byte-for-byte (image/audio/video/file labels), with text messages passed through and truncated at 100 chars.
- **Scope In — web push delivery to any subscribed device** — present · sendPushToUser dispatches to every subscription row for a user in parallel; no device-selection routing.
- **Scope In — per-event shape-based trigger reusing DM classification** — present · The loop's filter step delegates to the existing classifyRoom without re-deriving shape logic.
- **Scope In — one-time opt-in flow raising OS permission via a user tap** — present · Button click synchronously invokes Notification.requestPermission and, on grant, subscribes and posts to the backend.
- **Scope In — backend subscription lifecycle with dead-endpoint tolerance** — present · Register endpoint deduplicates on (user, endpoint); sender inline-prunes rows on 410/404 and force-saves only when a prune occurred.
- **Scope In — complete removal of the Telegram bridge (service, registry, tokens, config, related endpoints)** — present · Backend, container, substrate, endpoints, table, field-crypto entry, and the PWA-side surface are all removed.
- **Scope In — PWA-manifest and service-worker work to make the PWA a valid push target** — present · Service worker registers push, notificationclick, and pushsubscriptionchange handlers; manifest declares standalone display with icons.
- **Scope Out — cross-device smart routing** — present · No routing logic; every subscription gets fired.
- **Scope Out — per-agent mute / DND / quiet hours** — present · No mute, DND, or quiet-hours surface.
- **Scope Out — in-app on/off toggle for notifications** — present · The button is enable-only; there is no in-app disable path.
- **Scope Out — notifications health/status UI, last-delivered indicator, self-test button** — present · None of these surfaces exist; only a per-click status label on the enable button.
- **Scope Out — notifications for anything other than fresh DM messages from the agent side** — present · Filter pipeline restricts to exactly this.
- **Scope Out — notifications for messages the user herself sends** — present · Self-sent messages are filtered by sender-equality check.
- **Tempting-but-no — rich notification-preferences settings panel** — present · None was built.
- **Tempting-but-no — test push during onboarding** — present · None was built.
- **Tempting-but-no — caching a designated DM room per pair** — present · The loop deliberately re-classifies per event and does not cache a designated room.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Second pass after prior close-with-misses. The previously-flagged frontend Telegram surface (TelegramTab, telegram-api client, associated modal wiring, and stale field-crypto allowlist entry) has been fully removed in the same shipping unit as backend teardown; every reference to Telegram in the current tree is a historical comment explaining the removal. Two defensive behaviors that go slightly beyond what the shape spelled out but read as guardrails rather than added features: (1) cold-start suppression on the first tick per room to prevent boot-time push storms — protects the "only fresh new messages push" promise; (2) the enable-notifications button carries a local click-outcome label (idle/requesting/enabled/denied/failed) — this is opt-in gesture feedback, not delivery observability, and stays within the shape's opt-in-simplicity contract. Neither warrants raising to the user.
