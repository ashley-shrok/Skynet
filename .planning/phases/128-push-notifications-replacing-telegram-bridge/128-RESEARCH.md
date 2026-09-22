# Phase 128: Push notifications replacing Telegram bridge — Research

**Researched:** 2026-09-21
**Domain:** Web Push Protocol (backend Node.js) + PWA Service Worker + iOS 16.4+ push + Matrix per-message polling + Telegram-bridge teardown
**Confidence:** HIGH on library + protocol; HIGH on codebase surfaces (grepped); MEDIUM on iOS PWA subscription-lifetime edge cases (well-documented, no first-hand evidence in this session)

## Summary

Phase 128 replaces the `tg-bridge` Docker service with Skynet-native web push. The load-bearing infrastructure question is **how per-message events reach the push trigger** — Skynet does NOT currently maintain a per-user always-on Matrix event pump. The tg-bridge does, via its own per-human `/sync` long-poll inside the container. The observation loop that already exists (`src/backend/relay-sessions/observation-loop.ts`) polls joined-rooms + latest-event-timestamp every 10s per user, but it does NOT stream events; the per-message polling primitive (`fetchRoomHistory` with `dir:"f"` + cursor) is proven and used by `relay-room-stream-server.ts` but ONLY on-demand while a browser WS is attached. The trigger for push therefore requires a NEW per-user always-on live-event pump on the backend — parallel to (or grafted onto) the observation loop's `runObservationTick` — that consumes new events, filters them through the `harness_dm` classifier rule, and dispatches web push.

Standard stack: `web-push` (npm) 3.6.7 for backend VAPID + send; native `PushManager` on the client (no vite-plugin-pwa needed — Skynet already serves `/sw.js` + `/manifest.webmanifest` correctly). VAPID keys generated once and stored (env or DB). Every subscription persists in a new `push_subscriptions` table mirroring the `relay_room_sessions` shape (userId + endpoint uniqueness, `forceSave` on writes). Dead endpoints (`410 Gone`, `404 Not Found`) are pruned inline on send.

**Primary recommendation:** Add a new per-user always-on live-event pump (`push-trigger-loop.ts` under `src/backend/relay-sessions/` or a new `src/backend/notifications/` slice), started at boot alongside `startObservationLoopOnBoot`. It walks the same users and uses `fetchRoomHistory({dir:"f", beforeEventId:cursor, count:N})` per user with a per-user `.since` cursor stored in a new column on `users` OR a new `push_event_cursors` table. Filter new events through `classifyRoom` (reuse); when decision === `exclude` with reason === `harness_dm` AND sender is the local agent (not the human), dispatch push. Use `web-push` 3.6.7 with `TTL:60`, `urgency:"high"`, and inline `410`/`404` pruning.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger — what fires a push**
- **D-01:** Trigger is a PER-EVENT shape check on incoming messages, not a stored designation. For each message arriving, ask: is the source room exactly two members, and is one of them a local agent (per agents-registry membership) and the other the human whose device is subscribed? If yes, push. If no, silent.
- **D-02:** Reuse the existing DM-classification concept — same underlying invariant as the `harness_dm` rule in `src/backend/relay-sessions/observation-loop-classifier.ts` and the `getSharedDMRoom` lookup in `src/backend/matrix/matrix-admin-client.ts`. Do NOT re-derive room-shape logic.
- **D-03:** Per-event shape check is deliberate over a cached "designated DM room per pair" mapping. If an agent ever creates or uses a second DM room by mistake, notifications must still land. Robustness beats efficiency.
- **D-04:** Only NEW messages from the agent side fire a push. Not edits, not reactions, not joins, not leaves, not system events. the user's own outbound messages (from any device) never push.
- **D-05:** No push when the app is currently open and displaying the target room. This is a soft signal — best-effort — not a load-bearing correctness invariant.

**Delivery — how a push reaches the device**
- **D-06:** Standard web push machinery — service worker registered by the PWA + browser push service + iOS APNs relay for iOS PWAs. No custom transport.
- **D-07:** Content on the lock screen is `<agent display name>: <preview>` where `<preview>` is the same text the app's own message-row renders for that message type. A voice note reads whatever the row calls a voice note; an image reads whatever the row calls an image. No custom notification-body logic per message type.
- **D-08:** Tapping the notification opens the PWA directly into the DM room the message came from — deep link into that room, not just the app's default landing.
- **D-09:** One push per message. iOS handles visual grouping natively (stacked under the sender). No app-side coalescing or debouncing — coalescing loses per-message buzz which is the primary "something happened" signal, and it introduces a delay that makes push feel sluggish.

**Opt-in — how a device becomes subscribed**
- **D-10:** Notification permission requires a user gesture — this is enforced by iOS for PWAs and by browsers generally. The opt-in flow presents an in-app surface (welcome/setup screen or an explicit "turn on notifications" button) that, when tapped, raises the OS permission sheet. NOT auto-prompted on first launch — iOS won't honor that for PWAs.
- **D-11:** After grant, the browser mints a subscription and the client posts it to Skynet's backend, which persists it per-user-per-device. Subscriptions live across restarts.
- **D-12:** No in-app off toggle. Turning off happens via iOS system settings for the PWA (or the browser's site-settings equivalent). System-level control is sufficient.
- **D-13:** Subscription lifecycle: register on grant, deliver on trigger, prune when the push provider reports the endpoint as `410 Gone` (or equivalent). No proactive per-device health checks.

**Multi-device — v1 scope**
- **D-14:** Fire on every subscribed device. No cross-device smart routing.

**Observability — v1 scope**
- **D-15:** No status indicator, no "last delivered at" line, no health page, no self-test button.
- **D-16:** Standard backend logs still capture per-attempt push results at the log level the rest of Skynet uses.

**Tg-bridge teardown — same shipping unit**
- **D-17:** The Telegram bridge and all its supporting infrastructure come out entirely in the same ship. Push landing and bridge leaving are ONE motion.
- **D-18:** Teardown scope includes all code under `src/backend/telegram/`, the `tg-bridge` Docker service in `docker/docker-compose.yml`, any supporting endpoints on Skynet the bridge depends on, config env vars specific to the bridge, the `tg-bridge-state` Docker volume, and any bridge-related columns/tables in Skynet's DB if they exist solely to support the bridge.
- **D-19:** The `getSharedDMRoom` helper in `src/backend/matrix/matrix-admin-client.ts` is DELETED if no non-bridge caller remains. Planner: check for other callers before removing.
- **D-20:** Bridge shutdown is destructive. On deploy, existing bridge subscriptions/tokens are dropped. the user knows this and accepts it.

### Claude's Discretion

- Choice of web-push library or hand-rolled `Web Push Protocol` implementation on the backend.
- Exact schema for the push subscriptions table.
- Which existing observation-loop hook to reuse for the trigger.
- Whether the service worker file is generated at build time or hand-written and served statically.
- Whether the PWA manifest already declares everything push needs, or requires additions.
- The specific in-app surface for the "turn on notifications" gesture.

### Deferred Ideas (OUT OF SCOPE)

- Cross-device smart routing ("she's on her laptop, don't buzz her phone").
- Per-conversation mute / do-not-disturb / quiet hours.
- Notifications for foreign-Skynet agents' messages or for group rooms.
- An in-app notifications on/off toggle.
- A notifications health/status UI, a "last delivered" indicator, or a self-test button.
- A rich notification-preferences settings panel.
- Sending a test push during onboarding.
- Caching a designated DM room per agent-human pair.

## Phase Requirements

None registered — this phase was slotted via `/gsd:phase` without pre-existing requirement IDs. The 20 D-decisions above from CONTEXT.md serve as the requirement set; verification against them happens via `/close notifications` at end-of-phase per the shape file's Close arc.

## Project Constraints (from CLAUDE.md / project instructions)

**No CLAUDE.md or AGENTS.md exists at the workspace root** for skynet — verified by `ls`. Fleet-level rules propagated via the phase orchestrator (Additional Context in the research request):
- **No message streaming** anywhere, ever. Do NOT recommend streaming affordances for delivering messages to browser. (Push is FROM server TO browser via the browser's push service — that's not streaming, that's OS-level notification delivery, and is fine.)
- **In-memory SQLite** — every backend DB write MUST be paired with `DatabaseSaveTrigger.forceSave("<reason>")` in a try/catch with warning-level failure logging. Reference implementation: `src/backend/relay-sessions/relay-room-sessions-store.ts:93,145,197`.
- **Backend TS build gate:** `npm run build:backend && npm run build` — the frontend `tsc --noEmit` misses backend errors. Any patch touching `src/backend/` must be verified with the backend build command.
- **Observation loop + `harness_dm` classifier** are the trigger hook concept — do NOT re-derive room-shape logic.
- **Deploy is orchestrator-owned.** Researchers/planners only plan the code motion, not the deploy. Push and deploy are separate greenlights per fleet rule 2026-08-29.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VAPID key generation + storage | Backend server (Node) | — | Private key must never touch the browser; env var or DB. |
| Per-user always-on live-event pump | Backend server (Node) | — | Must fire while PWA is closed — cannot depend on browser WS subscription. Same tier as the observation loop. |
| Per-event shape classification (`harness_dm`) | Backend server (Node) | — | Reuses existing `classifyRoom` — pure module, already backend-tier. |
| Web push send (VAPID + payload encryption) | Backend server (Node) | — | Standard library boundary; `web-push` npm. |
| Subscription mint (`PushSubscription`) | Browser / Client (PWA) | — | Only the browser can mint a subscription via `PushManager.subscribe`. |
| Subscription POST to backend | Browser / Client (PWA) | Backend server (auth-gated POST route) | Standard REST + `authenticateJWT`. |
| Service worker registration | Browser / Client (PWA) | — | `navigator.serviceWorker.register("/sw.js")` — already wired via `useServiceWorker` hook. |
| `push` event handler + `showNotification` | Service worker (browser) | — | Browser-side; iOS enforces user-visible notification per push. |
| `notificationclick` deep-link (D-08) | Service worker (browser) | Client shell (route handling) | SW's `notificationclick` handler opens/focuses a window with a `?room=<roomId>` param the SPA reads. |
| Preview-text derivation (D-07) | Backend server (Node) | — | Push send is server-side; row-rendering logic currently exists only client-side and needs a server-side twin (there is no shared frontend/backend module today). |
| Sender display-name resolution | Backend server (Node) | — | Reuses `resolveIdentityAppearance` from `src/backend/fleet-status/identity-appearance.ts`; mxid local-part → identityKey → resolved displayName. |
| Dead-endpoint pruning (410/404) | Backend server (Node) | — | Inline on `web-push.sendNotification` catch of `WebPushError` with `statusCode` 410 or 404. |
| In-app "turn on notifications" opt-in surface | Client shell (PWA) | — | User-gesture-gated button; must call `Notification.requestPermission()` inside the click handler. |
| PWA manifest | Static asset served by backend | — | `/manifest.webmanifest` already served with `display:"standalone"` — no push-specific fields required beyond what's there. |
| Nginx routing for new endpoints | nginx conf | — | Every new HTTP prefix needs blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` per CLAUDE.md dual-conf caveat. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `web-push` | 3.6.7 [VERIFIED: npm registry — repository github.com/web-push-libs/web-push, official web-push-libs org] | VAPID key gen, subscription encryption, HTTP POST to push service | Canonical Node library for Web Push Protocol; maintained by web-push-libs org (3.5k stars); no hand-rolled crypto risk. [CITED: https://github.com/web-push-libs/web-push] |

### Supporting

Everything else is already in the codebase:

| Existing dep | Version | Purpose | Where already used |
|---|---|---|---|
| `express` | ^5.2.1 | Router for `/push-subscriptions/*` | Existing route pattern in `src/backend/database/routes/*.ts` |
| `drizzle-orm` | ^0.45.2 | Schema for `push_subscriptions` table | Existing patterns in `src/backend/database/db/schema.ts` |
| `better-sqlite3` | 12.9.0 | Underlying DB | Existing |
| `jsonwebtoken` | ^9.0.3 | (No new use — existing `authenticateJWT` middleware from `AuthManager.createAuthMiddleware()`) | Existing route auth |
| `zod` | ^4.4.3 | Subscription body validation on the POST route | Existing pattern |
| `nanoid` | ^5.1.9 | Row ids | Existing (relay-room-sessions-store.ts uses `randomUUID` — either works) |

**Frontend PWA plumbing is ALREADY in place — do NOT install `vite-plugin-pwa`:**
- Service worker file: `public/sw.js` (already served with `no-store` `Cache-Control` in `docker/nginx.conf:57-62` and again by Express at `src/backend/database/database.ts:2169-2178`).
- Manifest: `public/manifest.webmanifest` (already served by Express with `display: "standalone"` — an iOS PWA push prerequisite). Linked from `index.html:24`.
- `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, apple-touch-icons — all already declared in `index.html:10-21`.
- Service worker registration: `src/ui/hooks/use-service-worker.ts` (called from `src/main.tsx:16,251`).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `web-push` npm | Hand-rolled Web Push Protocol implementation | web-push handles ECDH ephemeral key gen, HKDF, AES-128-GCM/AES-GCM content-encoding, VAPID JWT signing, and TTL/Urgency header wiring. Hand-rolling is a real crypto surface with zero upside — CLAUDE.md's implicit fleet rule "never hand-roll crypto" applies. |
| Dedicated live-event pump | Bolt onto existing observation loop | The observation loop is a **per-user 10s poll** that already reads `getRoomLatestEventTs` per joined room. Bolting the push trigger onto it would need per-room event cursors + tighter cadence for fresh-message latency. A separate loop keeps concerns clean — observation loop is about DB reconciliation, push loop is about event dispatch. Both consume the same `users`-with-mxid enumeration; both share `classifyRoom`. Planner discretion — pick one based on where the code reads more naturally. |
| Poll `fetchRoomHistory dir=f` from backend | Bridge-style per-human Matrix long-poll (`/sync?timeout=25000`) | Long-poll is what tg-bridge does today (`bridge.sh:371`). Bridge-style long-poll is more responsive (~1s vs poll-cadence-bounded), BUT requires a per-user access token minted via `loginAsUser` (which the tg-bridge does via per-human `.token` files on the shared volume — that whole mechanism is being torn down). Polling with admin credentials via `fetchRoomHistory` reuses the observation-loop's existing admin-cred infrastructure. Latency is bounded by the poll cadence — 2s (matching `LIVE_EVENT_POLL_INTERVAL_MS`) feels responsive. |
| Vite PWA plugin (`vite-plugin-pwa`) | Hand-written `sw.js` + manifest | Skynet's `sw.js` and `manifest.webmanifest` are hand-written and already served; adding a plugin would rewrite the SW build pipeline and risk breaking the existing PWA install flow. No plugin needed for push — the SW code is just an additional `push` + `notificationclick` handler on the existing file. |

**Installation:**
```bash
npm install web-push
npm install --save-dev @types/web-push
```

**Version verification (executed 2026-09-21):**
```bash
$ npm view web-push version
3.6.7
$ npm view web-push time --json | tail
"3.6.7": "2024-01-16T13:48:01.065Z"
$ npm view web-push repository.url
git+https://github.com/web-push-libs/web-push.git
$ npm view @types/web-push version
3.6.4
```

`web-push` last publish 2024-01-16 (stable, ~18 months since last release — this library is feature-complete; Web Push Protocol is stable). Types package `@types/web-push` present.

## Package Legitimacy Audit

**slopcheck availability:** Not available in this session (`pip` not present on the researcher's system; graceful degradation applied per protocol).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `web-push` | npm | ~9 yrs (first release 2016) | ~500k/wk (public knowledge — not re-verified this session) | github.com/web-push-libs/web-push (3.5k stars, official web-push-libs org) | not run — unavailable | **Approved** with `[ASSUMED]` tag — planner MUST insert `checkpoint:human-verify` before `npm install web-push` per protocol Step-2 fallback |
| `@types/web-push` | npm | DefinitelyTyped mainline | high | github.com/DefinitelyTyped/DefinitelyTyped | not run | **Approved** with `[ASSUMED]` tag (bundled with DefinitelyTyped provenance) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. Both packages above are tagged `[ASSUMED]` and the planner MUST gate the install behind a `checkpoint:human-verify` task per the Package Legitimacy Gate protocol.*

**Postinstall audit (Node.js phase):**
```bash
$ npm view web-push scripts.postinstall
(no output — no postinstall script declared)
```
No postinstall script — low tampering risk.

## Architecture Patterns

### System Architecture Diagram

```
                   ┌─────────────────────────────────────────────┐
                   │            Matrix homeserver                 │
                   │      (Synapse — GET /messages?dir=f)         │
                   └─────────────────────┬───────────────────────┘
                                         │ admin creds
                                         │ per-user cursor
                                         ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                       Skynet backend                            │
   │                                                                 │
   │  ┌──────────────────────┐   ┌──────────────────────────────┐   │
   │  │ push-trigger loop    │──▶│ classifyRoom (reused)         │   │
   │  │ (NEW, per-user 2s)   │   │ pass: reason=='harness_dm'   │   │
   │  │ uses fetchRoomHistory│   │  AND sender!=userMxid         │   │
   │  │  dir=f + cursor      │   │  AND event.type=='m.room.msg' │   │
   │  └──────────┬───────────┘   │  AND !isEdit(event)           │   │
   │             │               └────────────────┬─────────────┘   │
   │             ▼                                ▼                 │
   │  ┌──────────────────────┐   ┌──────────────────────────────┐   │
   │  │ resolveIdentity      │   │ derivePreviewText             │   │
   │  │ Appearance           │   │ (NEW — msgtype→string map)    │   │
   │  │ (existing)           │   │ pattern: agent-relay/recv.sh  │   │
   │  │ displayName from     │   │  "image 🖼️" / "audio 🎤" / …  │   │
   │  │ mxid local-part      │   └────────────────┬─────────────┘   │
   │  └──────────┬───────────┘                    │                 │
   │             │                                │                 │
   │             └──────────────┬─────────────────┘                 │
   │                            ▼                                    │
   │  ┌──────────────────────────────────────────┐                  │
   │  │ push-sender: web-push.sendNotification    │                  │
   │  │ payload: {title, body, roomId, agentMxid} │                  │
   │  │ for each subscription of userId           │                  │
   │  │  catch 410/404 → prune row + forceSave    │                  │
   │  └────────────────┬─────────────────────────┘                  │
   │                   │                                             │
   │  ┌────────────────▼─────────────────────────┐                  │
   │  │ push_subscriptions table                  │                  │
   │  │  (userId, endpoint, keys.p256dh, .auth)   │                  │
   │  └───────────────────────────────────────────┘                  │
   │                   ▲                                             │
   │                   │ POST /push-subscriptions                    │
   │                   │ (auth-gated + zod-validated)                │
   └───────────────────┼─────────────────────────────────────────────┘
                       │                    │
                       │                    ▼ (browser's Push Service)
   ┌───────────────────┴────────────────────────────────────────────┐
   │                     Browser / iOS PWA                           │
   │                                                                 │
   │  ┌───────────────────────┐   ┌───────────────────────────────┐ │
   │  │ In-app opt-in surface │   │ /sw.js (extended)              │ │
   │  │ button (user gesture) │   │  addEventListener('push',      │ │
   │  │  → Notification.req…  │   │    e => showNotification(…))   │ │
   │  │  → pushManager.       │   │  addEventListener(             │ │
   │  │    subscribe(vapid)   │   │    'notificationclick',        │ │
   │  │  → POST endpoint+keys │   │    e => clients.openWindow(…)) │ │
   │  └───────────────────────┘   │  addEventListener(             │ │
   │                              │    'pushsubscriptionchange',   │ │
   │                              │    e => re-subscribe + POST)   │ │
   │                              └───────────────────────────────┘ │
   └────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/backend/
├── notifications/                      ← NEW slice
│   ├── push-sender.ts                  # web-push wrapper, dead-endpoint pruning
│   ├── push-sender.test.ts
│   ├── push-trigger-loop.ts            # per-user always-on live-event pump
│   ├── push-trigger-loop.test.ts
│   ├── push-trigger-starter.ts         # boot-time bootstrap (parallel to observation-loop-starter)
│   ├── preview-text.ts                 # msgtype → "image 🖼️" / "audio 🎤" / … / m.text body
│   ├── preview-text.test.ts
│   └── vapid-config.ts                 # loads VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT
├── database/
│   ├── db/schema.ts                    # + pushSubscriptions table
│   ├── db/index.ts                     # + CREATE TABLE push_subscriptions
│   ├── routes/
│   │   ├── push-subscriptions.ts       # POST (register), DELETE (self-unsubscribe unused per D-12), GET (fetch VAPID public key)
│   │   └── push-subscriptions.test.ts
│   └── database.ts                     # + app.use("/push-subscriptions", pushSubscriptionsRoutes)
├── relay-sessions/                     ← EXISTING — reuses classifier + agents-registry
│   └── observation-loop-classifier.ts  # (unchanged — imported by push-trigger-loop)
└── telegram/                           ← EXISTING — DELETED entirely per D-18
    (all 22 files removed)

src/ui/
├── features/notifications/             ← NEW slice
│   ├── EnableNotificationsButton.tsx   # user-gesture-gated opt-in button
│   ├── EnableNotificationsButton.test.tsx
│   └── push-subscription-api.ts        # GET vapid-public-key + POST subscription
├── hooks/
│   └── use-service-worker.ts           # (existing — unchanged)
public/
├── sw.js                               # + push handler + notificationclick + pushsubscriptionchange
└── manifest.webmanifest                # (existing — no changes needed)

docker/
├── docker-compose.yml                  # DELETE lines 194-216 (tg-bridge service) + 227-232 (tg-bridge-state volume)
├── nginx.conf                          # DELETE lines 252-262 (/telegram block); ADD /push-subscriptions block
└── nginx-https.conf                    # DELETE lines 263-273 (/telegram block); ADD /push-subscriptions block

substrate/services/tg-bridge/           ← DELETE entire directory
```

### Pattern 1: Route auth + validation + forceSave

Reference: `src/backend/database/routes/user-preferences.ts:1-8, 23-24, 400-407` (auth middleware + forceSave in try/catch).

```typescript
// Source: src/backend/database/routes/user-preferences.ts adapted
import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { z } from "zod";
import { randomUUID } from "crypto";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Zod validation for the subscription body from the browser.
const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,180}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{20,40}$/),
  }),
});

router.post("/", authenticateJWT, express.json({ limit: "8kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const parsed = SubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid subscription shape" });
      return;
    }
    const sub = parsed.data;
    const id = randomUUID();
    // ON CONFLICT DO NOTHING keyed on (user_id, endpoint) uniqueness
    const result = db.$client.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, endpoint) DO NOTHING
    `).run(id, authReq.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
    if (result.changes === 0) {
      res.status(200).json({ ok: true, alreadyRegistered: true });
      return;
    }
    try {
      await DatabaseSaveTrigger.forceSave("push-subscription-register");
    } catch (err) {
      databaseLogger.warn("push_subscriptions persistence flush failed", {
        operation: "push_subscription_force_save_failed",
        userId: authReq.userId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
    res.status(201).json({ ok: true });
  }
);
export default router;
```

### Pattern 2: web-push sendNotification with dead-endpoint pruning

```typescript
// Source: composed from github.com/web-push-libs/web-push README + web-push TypeScript types
import webpush from "web-push";
import { db, DatabaseSaveTrigger } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT } from "./vapid-config.js";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

export interface PushPayload {
  title: string;
  body: string;
  roomId: string;
  agentMxid: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const rows = db.$client.prepare(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
  ).all(userId) as Array<{id:string; endpoint:string; p256dh:string; auth:string}>;

  let prunedAny = false;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: 60, urgency: "high" }
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        db.$client.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(row.id);
        prunedAny = true;
        databaseLogger.info("[push] pruned dead subscription", {
          operation: "push_subscription_pruned", userId, endpoint: row.endpoint.slice(0, 40), statusCode,
        });
      } else {
        databaseLogger.warn("[push] send failed (non-410)", {
          operation: "push_send_failed", userId, statusCode,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }));

  if (prunedAny) {
    try {
      await DatabaseSaveTrigger.forceSave("push-subscription-prune-dead");
    } catch (err) {
      databaseLogger.warn("push subscription prune forceSave failed", {
        operation: "push_prune_force_save_failed", userId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}
```

### Pattern 3: Service worker push + notificationclick handler

```javascript
// Source: MDN Push API + Apple WebKit blog (webkit.org/blog/13878/...)
// Add these handlers to public/sw.js (existing file).

self.addEventListener("push", (event) => {
  // iOS 16.4+ REQUIRES showNotification() to be called for every push,
  // or the subscription silently gets invalidated after too many silent pushes.
  // event.waitUntil is REQUIRED — without it iOS terminates the SW early and
  // may cancel the subscription (Apple forum confirmed pattern).
  const payload = event.data ? event.data.json() : { title: "SKYNET", body: "" };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { roomId: payload.roomId, agentMxid: payload.agentMxid },
      tag: `room-${payload.roomId}`, // groups per-room; iOS stacks by tag
      // Do NOT use `renotify: false` — every message should fire a fresh buzz per D-09.
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  const targetUrl = roomId ? `/?openRoom=${encodeURIComponent(roomId)}` : "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Focus an existing window if any, then navigate it; otherwise open a new one.
    for (const client of clientsList) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Re-subscribe when the browser rotates the subscription.
  // iOS in particular does this silently after 1-2 weeks or after ~100 pushes.
  event.waitUntil((async () => {
    const oldOptions = event.oldSubscription ? event.oldSubscription.options : null;
    if (!oldOptions) return;
    const fresh = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: oldOptions.applicationServerKey,
    });
    await fetch("/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // JWT cookie
      body: JSON.stringify({
        endpoint: fresh.endpoint,
        keys: {
          p256dh: arrayBufferToBase64Url(fresh.getKey("p256dh")),
          auth: arrayBufferToBase64Url(fresh.getKey("auth")),
        },
      }),
    });
  })());
});

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

### Pattern 4: Per-user always-on live-event pump (new file)

```typescript
// Source: adapted from src/backend/relay-sessions/observation-loop.ts (createObservationLoop shape)
// combined with src/backend/relay-room-stream/relay-room-stream-server.ts (runLiveEventTick / fetchRoomHistory dir=f pattern)
import { fetchRoomHistory } from "../relay-room-stream/matrix-message-fetch.js";
import { classifyRoom } from "../relay-sessions/observation-loop-classifier.js";
import { getUserJoinedRooms, getRoomJoinedMembers } from "../matrix/matrix-admin-client.js";
import { sendPushToUser } from "./push-sender.js";
import { derivePreviewText } from "./preview-text.js";
import { resolveAgentDisplayName } from "./resolve-agent-display-name.js";
import { databaseLogger } from "../utils/logger.js";

const PUSH_TRIGGER_POLL_INTERVAL_MS = 2_000;   // matches LIVE_EVENT_POLL_INTERVAL_MS in relay-room-stream-server.ts
const PUSH_TRIGGER_BATCH_SIZE = 20;

interface PerUserState {
  userMxid: string;
  cursorByRoom: Map<string, string>;  // roomId -> Matrix sync-token
  inFlight: boolean;
}

// Pattern mirrors createObservationLoop's scanTick / per-user isolation
// / no-throw contract / debounced polling.
// ... (full implementation deferred to plan)
```

### Anti-Patterns to Avoid

- **Hand-rolling the Web Push Protocol crypto** — VAPID JWT + ECDH ephemeral keypair + HKDF + AES-128-GCM/AES-GCM content encoding. Use `web-push`. No exceptions.
- **Storing VAPID private key in code or committing it to repo** — env var or DB row (never repo). Match the pattern of `matrix_admin_creds` in `src/backend/database/db/schema.ts:717`.
- **Firing push without `event.waitUntil()` in the SW** — iOS terminates the service worker early. Documented failure mode per Apple forum thread 728796.
- **Calling `Notification.requestPermission()` outside a click handler** — silently blocked on iOS PWAs. Must be direct-user-interaction.
- **Sending a `push` event that does not result in `showNotification()`** — iOS silently invalidates the subscription after too many silent pushes. Every push MUST render a notification.
- **Assuming subscriptions live forever** — iOS PWAs rotate them every 1-2 weeks or after ~100 pushes (per Apple forum thread 728796). Handle `pushsubscriptionchange` + prune on 410/404.
- **Using `getSharedDMRoom` as the trigger** — that's ahead-of-time per-pair discovery; D-03 explicitly rejects it. Use per-event `classifyRoom` reason === `harness_dm`.
- **Only supporting one active subscription per user** — the user may have desktop + phone subscribed (D-14 fires on every subscribed device). Unique index on `(user_id, endpoint)` NOT on `user_id` alone.
- **Coalescing / debouncing pushes** — explicitly rejected in D-09. One push per message.
- **Adding a new nginx block only to `docker/nginx.conf`** — per CLAUDE.md caveat (referenced in `src/backend/database/database.ts:2033-2038, 2071-2073, 2100-2103, 2112-2115, 2123-2125` — repeated all over the codebase because it's caused real production incidents), every new HTTP prefix needs blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VAPID JWT signing | Custom JWT signer for VAPID's ES256 spec | `webpush.setVapidDetails()` | web-push handles the ES256 (P-256 ECDSA) signing, header assembly, and 12-hour expiration cap that browsers enforce. |
| Push payload encryption | Custom ECDH + HKDF + AES-128-GCM | `webpush.sendNotification(sub, payload)` | Encryption is spec-critical — a single byte off is undecryptable. web-push's aes128gcm content-encoding is spec-compliant. |
| Base64url encoding of push subscription keys | Custom byte→base64url loops | `arrayBufferToBase64Url` helper (see Pattern 3) + `webpush.encrypt` handles the wire format | Standard well-known encoding; a helper is fine but the wire encoding is web-push's responsibility. |
| Dead-endpoint detection | Custom HTTP status parsing | `err.statusCode === 410 \|\| err.statusCode === 404` on the caught `WebPushError` | web-push throws structured errors with `statusCode` field. |
| Matrix event polling | Custom `/sync` long-poll like tg-bridge does | `fetchRoomHistory({dir:"f", beforeEventId:cursor, count:N})` from `src/backend/relay-room-stream/matrix-message-fetch.ts` | Already implemented + tested + used by `relay-room-stream-server.ts:runLiveEventTick`. Reuses admin credentials — no per-user access tokens needed. |
| Room classification (harness_dm) | Re-derive shape check | `classifyRoom` from `src/backend/relay-sessions/observation-loop-classifier.ts` | Pure module, well-tested. D-02 explicitly says do not re-derive. |
| Sender display-name resolution | Custom mxid parsing | `resolveIdentityAppearance` from `src/backend/fleet-status/identity-appearance.ts` + mxid local-part lowercase → identityKey lookup (pattern mirrors `src/ui/features/pretty-view/relay-mxid-resolve.ts`) | Existing cascade; single-source appearance resolution. |

**Key insight:** Web Push Protocol is a spec-tight, crypto-critical wire format. web-push is 9 years old, maintained by web-push-libs org, and has 3.5k GitHub stars — canonically the Node choice. There is no shortcut.

## Runtime State Inventory

This is a rename/teardown phase (teardown of tg-bridge in the same shipping unit). Explicit inventory per protocol Step 2.5:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) `telegram_bot_tokens` table in Skynet DB (schema.ts:759 + CREATE TABLE at db/index.ts:347) — populated by `/telegram/activate`. Rows are (identityKey, botUsername, humanUserId, telegramChatId). Solely supports the bridge. (2) `tg-bridge-state` Docker volume (compose:231-232) contains `/state/registry.json`, `/state/config.env`, `<human>.token`, `<human>.since`, `<agent>.bottoken`, `<human>.token-dead` sentinels, `<agent>.pending-chat-id` sentinels. | **DROP** `telegram_bot_tokens` table via migration in `db/index.ts` (mirror the `runPinColumnDrop`/`runHiddenColumnDrop` pattern used in Phase 107/Phase 92). Docker: `docker volume rm skynet_tg-bridge-state` in the deploy runbook (orchestrator step, not code). **Data migration:** none — existing bridge subscriptions/tokens are intentionally dropped per D-20. |
| **Live service config** | (1) Telegram bot registrations at `api.telegram.org` — each activated identity has a real Telegram bot with a token issued by BotFather. Bridge shutdown does NOT revoke those tokens at Telegram's side. (2) Telegram chat IDs — the user's Telegram chat with each bot lives in Telegram's cloud; not managed by Skynet. | **No action in code** — the user accepts the destructive shutdown (D-20). Bots at Telegram's side are orphaned; she can revoke them at BotFather manually if she wants a clean sweep. Note in phase SUMMARY.md so it's visible to the deploy runbook. |
| **OS-registered state** | (1) `tg-bridge` Docker container name (compose:209). (2) `tg-bridge:local` Docker image tag (compose:208) built from `substrate/services/tg-bridge/Dockerfile.tg-bridge`. | Container disappears via `docker compose up` (or an explicit `docker compose stop tg-bridge && docker compose rm tg-bridge`). Image `tg-bridge:local` remains as a dangling image until `docker image prune` — orchestrator concern, not code. |
| **Secrets and env vars** | (1) `SKYNET_BRIDGE_TOKEN` — Bearer JWT written by `bridge-config-writer.ts` into `/state/config.env`; consumed by `bridge.sh`. Minted by `mintBridgeServiceToken` in `bridge-service-token.ts` — 30-day lifetime; never persisted anywhere except the shared volume. (2) `SKYNET_BASE`, `MATRIX_ROOT` in `/state/config.env` — no secrets, but bridge-scoped. (3) Per-human `.token` files under `/state/<human>.token` — minted by Skynet via `loginAsUser`; expire when the volume is dropped. | Code deletion: `bridge-service-token.ts` is deleted (only caller is `bridge-config-writer.ts`). The `tg-bridge-service` `userId` special case in `src/backend/database/routes/voice.ts:426-435` (`rejectBridgeServiceOnSpeak`) is deleted. **VAPID keys (NEW):** must be generated ONCE and stored. Recommend `matrix_admin_creds` table pattern (`schema.ts:717`) — a new `push_vapid_config` table with (id primary key, public_key, private_key, subject, created_at); planner can also decide env-var storage (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) if simpler for the deploy shape. |
| **Build artifacts / installed packages** | (1) `substrate/services/tg-bridge/` directory (bridge.sh, Dockerfile.tg-bridge, README.md, cursor-persistence-repro.sh). (2) `tg-bridge:local` Docker image. (3) Compose build stanza at docker-compose.yml:201-207 that builds `tg-bridge:local`. | Delete `substrate/services/tg-bridge/` entirely. Delete build stanza + service stanza in docker-compose.yml. Image `tg-bridge:local` becomes dangling after next deploy; orchestrator's `docker image prune -f` cleanup handles it. |

**The canonical question — "After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?"** — Answer:

- Deployed Skynet host has the `tg-bridge` running container until `docker compose up` reconciles.
- Deployed host has the `tg-bridge-state` named volume until `docker volume rm` (must be manual — `docker compose down -v` would sweep it but is not typical).
- Telegram's BotFather has the bot registrations (external state — the user's responsibility if she wants a real revoke).
- the user's phone still has the Telegram app installed (unrelated — outside scope).

## Common Pitfalls

### Pitfall 1: iOS silently rotates the push subscription every 1-2 weeks (or after ~100 pushes)

**What goes wrong:** Notifications work for a week then silently stop. Frontend never knows; backend keeps sending to a `410 Gone` endpoint.

**Why it happens:** Apple's push service rotates the endpoint token as a device-privacy measure; the browser's `pushsubscriptionchange` event fires but only if a `push` handler is registered AND the SW is alive at the time of rotation.

**How to avoid:** (a) implement `pushsubscriptionchange` per Pattern 3 above; (b) inline-prune on `410`/`404` per Pattern 2 above; (c) the opt-in surface should be reachable at any time (not one-shot onboarding) so the user can re-subscribe manually if the automatic path misses.

**Warning signs:** "I haven't been pinged in a while" complaint (which per D-15 is the intended feedback signal). Log grep: sudden spike of `push_subscription_pruned` entries.

[CITED: https://developer.apple.com/forums/thread/728796 — Apple forum thread confirming 1-2 week or ~100-notification rotation]
[CITED: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event — MDN pushsubscriptionchange reference]

### Pitfall 2: VAPID `subject` must be `mailto:...` or `https://...`

**What goes wrong:** Apple's push service returns `403 Forbidden` on every push if VAPID `subject` is anything else (e.g. a bare domain, no scheme, or an application ID).

**How to avoid:** Set `VAPID_SUBJECT` to `mailto:admin@example.com` (or any valid mailto/https). Validate at startup — fail fast if malformed.

[CITED: https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en — 2026 empirical PWA push guide]

### Pitfall 3: Every push MUST result in `showNotification()` on iOS

**What goes wrong:** iOS silently invalidates subscriptions that receive "silent" pushes (push events that don't trigger a user-visible notification).

**How to avoid:** Always call `self.registration.showNotification(...)` inside the `push` event handler, and wrap it in `event.waitUntil(...)`. If the payload is missing/malformed, still show a generic notification ("SKYNET: (empty message)") — never return silently from the handler.

[CITED: https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en]

### Pitfall 4: `Notification.requestPermission()` must be inside a click handler on iOS

**What goes wrong:** Calling it inside `useEffect`, `setTimeout`, `DOMContentLoaded`, or any non-user-gesture code path is silently blocked on iOS PWAs.

**How to avoid:** The `EnableNotificationsButton` component must call `Notification.requestPermission()` synchronously inside the `onClick` handler, then chain `.then(perm => perm === 'granted' && registration.pushManager.subscribe(...))`.

[CITED: MDN Push API guide (fetched during research)]

### Pitfall 5: nginx dual-conf caveat — new HTTP prefixes need blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`

**What goes wrong:** Adding `/push-subscriptions` only to `nginx.conf` means HTTPS deployments (which are all production deployments) fall through to the SPA fallback and return `index.html` on API POSTs. Real production incidents traced to this — patch #446 and again patches #232, #237, plus every subsequent phase's SUMMARY notes it.

**How to avoid:** Every new `app.use()` in `src/backend/database/database.ts` requires a matching `location ~ ^/<prefix>(/.*)?$ { proxy_pass http://127.0.0.1:30001; ... }` block in BOTH nginx conf files.

**Warning signs:** `location ~` regex-based blocks are the canonical shape here (grep for existing `^/telegram(/.*)?$` for the copy-paste template).

### Pitfall 6: In-memory SQLite — writes silently RAM-only unless `forceSave` fires

**What goes wrong:** Skynet's DB is in-memory SQLite; disk persist requires explicit `DatabaseSaveTrigger.forceSave("<reason>")` after backend writes. Without it, the push subscription is registered until the container restarts, then it's gone.

**How to avoid:** Mirror the `relay-room-sessions-store.ts` pattern (Pattern 1 above) — every INSERT/UPDATE/DELETE on `push_subscriptions` is followed by `await DatabaseSaveTrigger.forceSave("push-subscription-<op>")` in a try/catch with `.warn`-level logging on failure. Skip the save when `result.changes === 0` (the row was already in target state) — disk-sat hotfix 2026-09-09 documented in `relay-room-sessions-store.ts:88-90`.

### Pitfall 7: Manifest `display: "standalone"` is load-bearing for iOS PWA push

**What goes wrong:** Without `"display": "standalone"` (or `"fullscreen"`) in the manifest, iOS won't even expose `PushManager` inside the service worker.

**How to avoid:** Already handled — `public/manifest.webmanifest:6` has `"display": "standalone"`. Do NOT change it.

[CITED: https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en]

### Pitfall 8: The frontend's current message-row rendering silently drops non-text msgtypes

**What goes wrong:** D-07 says preview text mirrors the app's row rendering. But `src/ui/features/pretty-view/sources/use-relay-adapter.ts:162` filters out non-text events entirely (`if (msgtype !== "m.text" && msgtype !== undefined) return null;`). So "mirror what the app shows" for a voice note is technically "nothing" — the app row wouldn't render it today.

**How to avoid:** Two options for the planner: (a) fix the client to render voice/image/file msgtypes (out of scope for this phase — that's a UI slice), OR (b) implement server-side preview derivation directly in `src/backend/notifications/preview-text.ts` that mirrors the labels used by `substrate/skills/agent-relay/recv.sh:378-381`:
- `m.text` / undefined → `event.content.body` (truncate at 100 chars)
- `m.image` → `"image 🖼️"` (or with filename: `"image 🖼️ (screenshot.png)"`)
- `m.audio` → `"audio 🎤"`
- `m.video` → `"video 🎬"`
- `m.file` → `"file 📎"` (or with filename)
- any other msgtype → `event.content.body || "(message)"`

Recommend (b) — it's shipped-shape-agnostic and matches the pattern users already see in `recv.sh` inbound relay bubbles. Document explicitly in phase SUMMARY that when the pretty-view row rendering gets voice/image support in a future phase, the two derivations should be unified into a shared module (`src/shared/message-preview.ts` or similar).

### Pitfall 9: `sw.js` has an unhydrated `__SKYNET_SW_BASE_PATH__` placeholder

**What goes wrong:** `public/sw.js:2` has `const BASE_PATH = "__SKYNET_SW_BASE_PATH__";` — the placeholder is never replaced anywhere in the codebase (grep for `__SKYNET_SW_BASE_PATH__` in `src/` returns zero results). Today's STATIC_ASSETS cache-put still works because the file is served literally, but if push work touches this file it should be aware.

**How to avoid:** Out of scope to fix, but do NOT rely on `BASE_PATH` for any push-related paths. Use root-relative URLs (`/push-subscriptions`, `/`, etc.) directly. Flag in phase SUMMARY for a follow-up quick task if wanted.

### Pitfall 10: Skynet does NOT have a per-user always-on Matrix event pump today

**What goes wrong:** The existing `relay-room-stream-server.ts` only polls Matrix while a browser WS is connected to a given room. The observation loop polls joined-rooms + latest-event-timestamp but does NOT process per-message events. Without a new pump, push cannot fire when the PWA is closed — which IS the whole point of push.

**How to avoid:** Add `src/backend/notifications/push-trigger-loop.ts` as a NEW per-user always-on live-event pump, started at boot in `src/backend/starter.ts` alongside `startObservationLoopOnBoot` (see Pattern 4). Uses admin credentials via `fetchRoomHistory({dir:"f", ...})` — no per-user access tokens needed. Cadence 2s (matches existing `LIVE_EVENT_POLL_INTERVAL_MS`); each user has a `Map<roomId, sinceToken>` cursor. Per-user in-flight guard mirrors the observation-loop pattern (`observation-loop.ts:594-599, 691-705`).

## Code Examples

Included in Architecture Patterns above (Patterns 1-4). All patterns cite their existing codebase origins so the planner can locate and adapt directly without re-search.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Web Push via GCM sender ID + browser proprietary APIs | Standard Web Push Protocol via VAPID (RFC 8292) | ~2018 across browsers; iOS 16.4 (March 2023) | Interoperable; single library (web-push) covers all browsers. |
| Silent push allowed on some platforms | iOS 16.4+ REQUIRES visible notification per push | iOS 16.4 shipped | Every push MUST `showNotification()` or subscription is revoked. |
| Custom crypto for payload | Standard `aes128gcm` content-encoding (RFC 8291) | RFC 8291 finalized 2017 | web-push handles it — do not hand-roll. |
| Push subscription lifetime unbounded | Practical 1-2 week rotation on iOS | iOS 16.4+ observed | Must implement `pushsubscriptionchange` handler + inline 410 pruning. |

**Deprecated/outdated:**
- GCM (Google Cloud Messaging) sender IDs — replaced by VAPID. Do not use.
- `aesgcm` content-encoding (RFC 8188 earlier draft) — replaced by `aes128gcm` (RFC 8291). web-push defaults to `aes128gcm`; leave the default.
- Firebase Cloud Messaging (FCM) — not needed for standards-based Web Push; adds a Google account dependency the user doesn't want.
- Push notifications via a third-party service (OneSignal, Pusher) — not needed; standards-based Web Push is fully self-hostable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime | Skynet backend | ✓ | 22.12+ per package.json engines | — |
| npm | Install web-push | ✓ | 11+ per package.json engines | — |
| Matrix homeserver (Synapse) with admin credentials | fetchRoomHistory for the push-trigger loop | ✓ | Already deployed + used by observation loop | — |
| Docker + docker-compose | tg-bridge teardown motion | ✓ | Existing compose file | — |
| HTTPS in production | Web Push REQUIRES secure origin (except localhost) | ✓ | Caddy in docker-compose.yml + `nginx-https.conf` | — |
| Valid PWA install on iOS (home screen add) | Push works only for installed PWAs on iOS | Cannot verify from research — user-side | — | User instruction: "Add to Home Screen" from Safari share sheet before enabling notifications. |
| Push service reachability (fcm.googleapis.com, web.push.apple.com) | Delivery | Assumed reachable from Skynet's egress | — | If blocked (e.g. by corporate firewall) all pushes fail; not our concern. |

**Missing dependencies with no fallback:** none identified. All infrastructure is present.

**Missing dependencies with fallback:** none.

## Validation Architecture

**Skipped per config.json:** `workflow.nyquist_validation: false` in `.planning/config.json:20`. Test infrastructure notes captured below in Existing Tests section instead of a full validation architecture map.

**Existing test infrastructure** (relevant for the planner):
- Framework: `vitest ^4.1.8`. Config: `vitest.config.ts` at repo root. Setup: `vitest.setup.ts`.
- Quick run per-file: `npx vitest run <path>` (fast, ~1-2s per file for backend).
- Full backend: `npx vitest run src/backend/`.
- Backend TS gate: `npm run build:backend` — MUST pass before any commit touching `src/backend/*`.
- Full build: `npm run build` (includes frontend + backend).

**Reference test patterns to model after:**
- Route + auth + forceSave test shape: `src/backend/database/routes/user-preferences.test.ts` (801 lines; mocks `DatabaseSaveTrigger.forceSave` via `vi.fn`, uses `describe`/`it`/`expect`/`beforeEach`/`vi` imports from vitest).
- Store module test shape (INSERT + forceSave + no-op guard): `src/backend/relay-sessions/relay-room-sessions-store.test.ts` alongside the store itself.
- Observation-loop / dep-injection pattern for testing per-tick behavior: `src/backend/relay-sessions/observation-loop.test.ts` (mocks all deps via the `ObservationTickDeps` interface — no `vi.mock` needed; the pattern applies directly to `push-trigger-loop.test.ts`).
- Frontend hook test: `src/ui/hooks/use-service-worker.test.ts` — stubs `navigator.serviceWorker`, uses `renderHook`.
- No existing service-worker `push` event test in the repo — planner may need to write the first one; standard pattern is to test the exported handler functions with `mockPushEvent`/`mockNotificationEvent` fixtures. Consider deferring SW tests to manual UAT since the SW file is served literally without a build step and the handler code is small.

**Manual UAT required for iOS PWA push** (per D-15 no observability): after deploy, user installs the PWA on her iPhone, taps the enable-notifications button, sends herself a message from an agent, confirms lock-screen notification arrives with the agent display name + body. Repeat for a non-text msgtype if any msgtypes are expected in her DM traffic.

## Security Domain

`security_enforcement: true` per config (line 42). ASVS Level 1 per config (line 43); block-on `high` (line 44).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `AuthManager.createAuthMiddleware()` (`authenticateJWT`) — required on POST `/push-subscriptions` and any GET that returns subscription state. |
| V3 Session Management | yes | JWT cookie already handled by AuthManager; no new session state. |
| V4 Access Control | yes | Subscription rows are per-user (`user_id` FK). POST creates rows keyed to `req.authReq.userId` ONLY. No cross-user reads. |
| V5 Input Validation | yes | Zod schema on the subscription body (see Pattern 1). Endpoint URL must be `.url()` + length-capped; keys are base64url regex-capped. |
| V6 Cryptography | yes | web-push handles all crypto (VAPID JWT signing, ECDH ephemeral keypair, HKDF, AES-128-GCM). Do NOT hand-roll — this is the load-bearing "don't hand-roll" item. |
| V7 Error Handling | yes | Push send failures never crash the loop; log at `.warn`, prune on 410/404, continue. Boot-time VAPID config load failure MUST fail-fast at startup so the operator sees it (mirror `assertBrandingConfigAtBoot` pattern from `starter.ts:474-479`). |
| V8 Data Protection | yes | Subscription endpoint URLs are capability URLs (anyone with the URL + VAPID key can push). Store in DB (in-memory SQLite, encrypted at rest via `DatabaseFileEncryption`). NEVER log full endpoint URL — log truncated prefix only (see Pattern 2's `endpoint.slice(0, 40)`). |
| V9 Communication | yes | HTTPS in prod (via Caddy). Web Push requires secure origin. |
| V13 API | yes | Standard REST — no new API design concerns. |
| V14 Configuration | yes | VAPID private key MUST NOT be in git. Store in DB row (mirror `matrix_admin_creds`) or env var. Startup validation: refuse to start if `VAPID_PRIVATE_KEY` is missing or unparseable. |

### Known Threat Patterns for {web push infrastructure}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Attacker registers a subscription for another user's userId | Elevation of Privilege | POST route reads `userId` from JWT-verified auth (`authReq.userId`), NEVER from request body. `AuthManager.createAuthMiddleware` already handles this. |
| Attacker discovers subscription endpoint via log leak → sends unauthorized push | Spoofing | (1) Never log full endpoint URL — truncate to prefix. (2) VAPID JWT gate — recipient's push service validates the sender's ES256 signature against the pre-registered VAPID public key. |
| Malformed subscription body crashes the backend | Denial of Service | Zod validation + `express.json({limit:"8kb"})` cap on body size. |
| Attacker floods POST /push-subscriptions to fill the DB | Denial of Service | Consider adding per-user rate-limit (mirror `checkRateLimit` in `src/backend/relay-room-stream/relay-room-stream-server.ts:196-256`). Not required for v1 since auth-gated + the user is the sole user, but note for future multi-tenant. |
| Silent push storm to exhaust device battery / iOS revocation | Availability/DoS | D-09 = one push per message enforced by classifier. iOS invalidates over-pushy subs on its own. |
| VAPID private key leak | Spoofing (any attacker with the key can send push to any subscription registered under it) | Store in DB, never log, never commit. Rotate on suspicion (rotation = generate new VAPID pair + prune ALL existing subscriptions + push re-enrollment). Document rotation runbook. |
| Bridge JWT leftover from `bridge-service-token.ts` | Spoofing | Deleted in this phase (D-18) — `mintBridgeServiceToken` + the `tg-bridge-service` `userId` special case in `voice.ts:426-435` both go. |
| Subscription capability URL leak via `pushsubscriptionchange` fetch failure | Info Disclosure | The re-subscribe POST includes JWT cookie (`credentials: "include"`); if the fetch fails (JWT expired), the browser has no fallback but to prompt re-auth. Document in the opt-in UI: "if notifications stop arriving after a while, tap this button again to re-enable." |

## Sources

### Primary (HIGH confidence)
- **Codebase grep + read** (this session):
  - `src/backend/relay-sessions/observation-loop.ts` — per-user scheduler pattern, `ObservationTickDeps` shape, `createObservationLoop`.
  - `src/backend/relay-sessions/observation-loop-classifier.ts` — `classifyRoom` + `harness_dm` reason.
  - `src/backend/relay-sessions/observation-loop-starter.ts` — boot bootstrap pattern.
  - `src/backend/relay-sessions/relay-room-sessions-store.ts` — canonical `DatabaseSaveTrigger.forceSave` + `.warn` fallback pattern; no-op guard for disk-sat.
  - `src/backend/relay-room-stream/relay-room-stream-server.ts` — `runLiveEventTick`, `fetchLive` (`fetchRoomHistory dir=f`), per-room subscription lifecycle.
  - `src/backend/relay-room-stream/matrix-message-fetch.ts` — `fetchRoomHistory({dir, beforeEventId, count})`.
  - `src/backend/matrix/matrix-admin-client.ts` — `getSharedDMRoom` (~L710), `getUserJoinedRooms`, `getRoomJoinedMembers`.
  - `src/backend/telegram/*` — every file in the teardown scope.
  - `src/backend/database/database.ts` — route mount patterns (L1941-2127), telegram mount at L1950.
  - `src/backend/database/routes/user-preferences.ts` — canonical auth + forceSave pattern.
  - `src/backend/database/routes/voice.ts:420-435` — `tg-bridge-service` special case.
  - `src/backend/database/db/schema.ts:759, 881` — existing table patterns.
  - `src/backend/database/db/index.ts:592-643` — CREATE TABLE patterns.
  - `src/backend/starter.ts:355-472` — boot sequence for bridge writers + observation loop.
  - `src/ui/hooks/use-service-worker.ts` — SW registration.
  - `src/ui/features/pretty-view/sources/use-relay-adapter.ts:159-162` — current msgtype filtering.
  - `src/ui/features/pretty-view/relay-mxid-resolve.ts` — client-side mxid resolution pattern.
  - `public/sw.js`, `public/manifest.webmanifest`, `index.html` — current PWA plumbing.
  - `docker/docker-compose.yml:194-232` — tg-bridge service + volume.
  - `docker/nginx.conf:57-108, 252-262`, `docker/nginx-https.conf` — PWA-serving + telegram routing.
  - `substrate/services/tg-bridge/bridge.sh` — current per-human `/sync` long-poll implementation (for teardown context).
  - `substrate/skills/agent-relay/recv.sh:378-381` — labels used in existing agent-side inbound bubble rendering (source of truth for D-07 preview-text labels).
- **npm registry** (verified this session):
  - `npm view web-push version` → `3.6.7`
  - `npm view web-push repository.url` → `git+https://github.com/web-push-libs/web-push.git`
  - `npm view web-push scripts.postinstall` → (empty — no postinstall)
  - `npm view @types/web-push version` → `3.6.4`
- **Official docs (fetched this session):**
  - [web-push GitHub README](https://github.com/web-push-libs/web-push) — VAPID setup, sendNotification signature, TTL/urgency options.
  - [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) — client-side subscription flow, CSRF warning, capability-URL semantics.
  - [MDN pushsubscriptionchange event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event) — recommended re-subscribe pattern.
  - [web.dev Web Push Protocol reference](https://web.dev/articles/push-notifications-web-push-protocol) — TTL, Urgency, Topic, HTTP status codes (201/400/404/410/413/429).
  - [WebKit blog: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) — iOS 16.4+ requirements, standalone display, user gesture.

### Secondary (MEDIUM confidence)
- [Apple Developer Forum thread 728796 — PWA Push Notification Issues iOS 16.4+](https://developer.apple.com/forums/thread/728796) — empirical 1-2 week / ~100-notification subscription rotation; cache-clear invalidates; delete-and-reinstall requires re-subscribe. Multi-developer confirmation over time.
- [PWA Push on iOS 2026: What Really Works (webscraft.org)](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en) — current-year empirical guide: VAPID `mailto:`/`https://` requirement, `display: "standalone"` load-bearing, user-gesture enforcement, silent-push invalidation.

### Tertiary (LOW confidence)
- (none — all findings cross-verified against at least two sources, or grounded directly in codebase read.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `web-push` npm package (v3.6.7) is the canonical, non-slopsquatted library | Standard Stack, Package Legitimacy Audit | If a slopsquatted package is installed, we'd import malicious code that runs at build + runtime. **Mitigation:** planner MUST insert `checkpoint:human-verify` before `npm install web-push` per Package Legitimacy Gate protocol (slopcheck unavailable this session). Verify via https://www.npmjs.com/package/web-push showing web-push-libs org + github.com/web-push-libs/web-push repo. |
| A2 | `@types/web-push` (v3.6.4) is the canonical DefinitelyTyped types package | Standard Stack | Same as A1. Verify via https://www.npmjs.com/package/@types/web-push showing DefinitelyTyped provenance. |
| A3 | Reusing admin credentials via `fetchRoomHistory` is acceptable for a per-user always-on live-event pump | Architecture Patterns § Pattern 4 | If Synapse admin credentials have a rate limit or scope issue that surfaces only under sustained per-user polling, the pump degrades. Existing observation loop pattern (10s cadence per user with same admin creds + retry backoff) is proven — degrading to 2s cadence for message events should be fine but is not proven under load. **Mitigation:** re-uses the same backoff ladder (`BACKOFF_LADDER_MS`) if failures accumulate. |
| A4 | Storing VAPID keys in DB (mirror `matrix_admin_creds`) vs env var is a planner choice; either is acceptable | Standard Stack, Security Domain | If env-var storage is chosen and the deploy pipeline forgets to inject them, backend crashes at startup — which is fine per fail-fast principle. DB storage requires an operator-facing bootstrap route (mirror `/matrix-admin/ingest`) — extra scope. Planner picks. |
| A5 | The preview-text label taxonomy from `substrate/skills/agent-relay/recv.sh:378-381` ("image 🖼️", "audio 🎤", "video 🎬", "file 📎") is the reasonable server-side mirror for D-07 given the client currently drops non-text msgtypes | Common Pitfalls § Pitfall 8, Sources | If the user expects different labels (e.g. plain "Voice message" like Signal), notification body copy differs from her mental model. Low risk — she can complain and we adjust. **Mitigation:** put the label constants in one file (`preview-text.ts`) so a future edit is one-file. |
| A6 | The `notificationclick` deep-link URL shape `/?openRoom=<roomId>` will be picked up by AppShell / PrettyView on mount to open the specific room | Code Examples § Pattern 3 | Frontend does not currently handle a `openRoom` query param on load — the planner must add a small AppShell hook (or reuse existing `sessionKind: "relay-room"` open-tab mechanism) that reads the param on mount and opens the target room's pane. If not wired, tapping the notification opens the app to its default landing but does NOT jump to the room — D-08 half-broken. Low risk (planner will notice during implementation) but worth flagging. |
| A7 | Skynet's DM traffic (agent → the user) is primarily `m.text` in practice today, with `m.audio` (voice notes) and `m.image` occasionally when tg-bridge forwards Telegram media or an agent uses `agent-relay` to send media | Common Pitfalls § Pitfall 8 | If the user's DM stream is heavier on non-text than assumed, the "mirror row rendering" gap (client drops non-text) becomes user-visible faster. Server-side preview-text derivation covers this correctly regardless. |
| A8 | iOS PWA push subscription rotation is silent and cannot be reliably caught by `pushsubscriptionchange` in all cases — the inline `410 Gone` pruning path is the load-bearing recovery mechanism | Common Pitfalls § Pitfall 1 | If `pushsubscriptionchange` fires reliably, our belt is redundant; if it doesn't (per Apple forum), the suspenders (410 pruning) is the recovery mechanism. Belt-AND-suspenders wired means both are in place. |

## Open Questions

1. **VAPID key storage: env var vs DB row?**
   - What we know: both work; env-var is simpler for a single-tenant deploy; DB-row mirrors `matrix_admin_creds` and gives an operator bootstrap route.
   - What's unclear: which better fits Skynet's operator ergonomics for this instance.
   - Recommendation: Planner picks based on the shape of the deploy runbook. If env-var: add to `skynet.env` documentation + fail-fast in starter. If DB: add `push_vapid_config` table + `/push-vapid/ingest` admin-gated route + fail-fast in starter if row absent.

2. **`push-trigger-loop.ts` as a NEW loop vs a NEW consumer of `observation-loop.ts`?**
   - What we know: both work; separate loop keeps concerns clean; shared loop is fewer moving parts.
   - What's unclear: whether a fixup-batch on the observation loop (2s live-event pass alongside 10s membership pass) is cleaner than a new loop.
   - Recommendation: Planner picks. A separate `notifications/push-trigger-loop.ts` is my slight lean because the two loops have different cadences (2s vs 10s), different failure semantics (event-drop-on-failure vs no-destruction), and different per-user state (cursor-per-room vs. no cursor). Splitting keeps each loop's contract narrow.

3. **In-app opt-in surface: welcome-modal / settings-tab / floating banner?**
   - What we know: must be user-gesture-gated; must exist somewhere first-time users encounter it; must be reachable at any time (for re-enable after silent rotation per Pitfall 1).
   - What's unclear: which UI surface is the user's natural first-tap point.
   - Recommendation: Planner picks based on where a first-time PWA user's attention naturally lands. Two shipping-shape options: (a) settings/gear menu item labeled "Enable notifications" that also flips to "Notifications enabled" state (works but requires her to open the gear menu); (b) a soft banner that appears when notification permission is `default` AND no active subscription exists — dismisses on tap-to-enable OR tap-to-dismiss. Both are lightweight; the shape file says "welcome/setup moment inside the app" so a first-launch modal is also fair game.

4. **Does the notification deep-link require handling both cold-launch (`clients.openWindow`) and warm-focus (`clients.matchAll` + `client.focus() + client.navigate()`)?**
   - What we know: Pattern 3 above handles both — checks existing clients first, opens new if none.
   - What's unclear: whether iOS's `client.navigate()` is reliable inside a home-screen PWA context.
   - Recommendation: Ship Pattern 3 as-written; UAT confirms warm-focus deep-link. If broken, fall back to always `openWindow` (browser dedupes by URL).

5. **Should the tg-bridge teardown be a single sweep or staged?**
   - What we know: D-17 = "same ship". No staging. But the deploy runbook still needs an order-of-operations: apply migration to drop `telegram_bot_tokens` → deploy new backend (push endpoints alive) → deploy new frontend (opt-in surface alive) → `docker compose up` (drops tg-bridge service) → `docker volume rm skynet_tg-bridge-state` (drops volume).
   - What's unclear: whether a coordinated single-`docker compose up` handles the container stop-and-remove atomically or if separate `docker compose stop tg-bridge` + `docker compose rm -f tg-bridge` is safer.
   - Recommendation: Orchestrator-level deploy concern per fleet rule. Document the sequence in `SUMMARY.md` at end-of-phase; deploy runbook is outside the phase's code scope.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `web-push` is unambiguously canonical, npm-verified this session, and slopcheck-fallback is documented.
- Architecture: HIGH — codebase surfaces read directly; patterns exist and are cited; the only novel infrastructure piece (`push-trigger-loop.ts`) has a clear model in the existing observation loop and relay-room-stream.
- Pitfalls: HIGH on protocol/library pitfalls (cross-verified with MDN + web.dev + WebKit blog); MEDIUM on iOS-specific subscription-lifetime edge cases (well-documented empirically via Apple forum + 2026 empirical guide, no first-hand evidence).
- Teardown scope: HIGH — every file / route / config referenced was grepped and confirmed in the working tree.
- Preview-text derivation: MEDIUM — the label taxonomy from `recv.sh` is defensible but is a real UX decision the user may want to weigh in on (see Pitfall 8 + Assumption A5).

**Research date:** 2026-09-21
**Valid until:** 2026-10-21 (30 days) — web-push protocol + iOS 16.4+ push are stable; the only fast-moving surface is iOS PWA push edge cases (re-verify Apple forum threads if UAT surfaces new failure modes).
