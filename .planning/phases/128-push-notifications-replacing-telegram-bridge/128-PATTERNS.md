# Phase 128: Push notifications replacing Telegram bridge — Pattern Map

**Mapped:** 2026-09-21
**Files to create:** 15 new (backend + frontend + SW additions) · 22 delete (Telegram teardown) · 6 modify (compose/nginx/starter/database.ts/schema/voice.ts)
**Analogs found:** 13 of 15 new files have a strong in-repo analog · 2 files are novel-territory (`push-sender.ts` + `preview-text.ts`) — pattern comes from library docs + `recv.sh` label taxonomy

Purpose: give the planner a per-file "copy this exact pattern from this exact line range" map. RESEARCH.md already carries the *why*; this file carries the *from where*.

---

## File Classification

### New backend files (`src/backend/notifications/` — new slice)
| Target | Role | Data Flow | Closest Analog | Match |
|--------|------|-----------|----------------|-------|
| `src/backend/notifications/push-trigger-loop.ts` | service (per-user scheduler) | event-driven / poll | `src/backend/relay-sessions/observation-loop.ts` + `src/backend/relay-room-stream/relay-room-stream-server.ts` | composite (role-match) |
| `src/backend/notifications/push-trigger-loop.test.ts` | test | dep-injection unit | `src/backend/relay-sessions/observation-loop.test.ts` | exact |
| `src/backend/notifications/push-trigger-starter.ts` | boot bootstrap | request-response (invoked once) | `src/backend/relay-sessions/observation-loop-starter.ts` | exact |
| `src/backend/notifications/push-sender.ts` | service (I/O to push service) | fire-and-forget | **no analog — novel** (web-push npm) | `web-push` README canonical shape |
| `src/backend/notifications/push-sender.test.ts` | test | mock-lib unit | `src/backend/relay-sessions/relay-room-sessions-store.test.ts` (store + forceSave shape) | role-match |
| `src/backend/notifications/preview-text.ts` | utility (pure) | transform | **no perfect analog** — copy label taxonomy from `substrate/skills/agent-relay/recv.sh:379-381` | pattern-only |
| `src/backend/notifications/preview-text.test.ts` | test | pure-function unit | any small pure-utility test in `src/backend/utils/` | role-match |
| `src/backend/notifications/vapid-config.ts` | config loader | fail-fast boot | `src/backend/branding/assert-boot.ts` (fail-fast at boot pattern cited in RESEARCH.md § V7) | role-match |
| `src/backend/notifications/resolve-agent-display-name.ts` | utility (composition wrapper over existing appearance resolver) | transform | `src/backend/fleet-status/identity-appearance.ts` (`resolveIdentityAppearance`) | role-match |

### New backend routes
| Target | Role | Data Flow | Closest Analog | Match |
|--------|------|-----------|----------------|-------|
| `src/backend/database/routes/push-subscriptions.ts` | controller (route) | CRUD | `src/backend/database/routes/user-preferences.ts` | exact |
| `src/backend/database/routes/push-subscriptions.test.ts` | test | route unit | `src/backend/database/routes/user-preferences.test.ts` | exact |

### New / modified schema + DB
| Target | Role | Data Flow | Closest Analog | Match |
|--------|------|-----------|----------------|-------|
| `src/backend/database/db/schema.ts` (add `pushSubscriptions` + optional `pushVapidConfig`) | model | CRUD | `relayRoomSessions` (line 881) for shape; `matrixAdminCreds` (line 717) for VAPID-config singleton if planner picks DB storage | exact |
| `src/backend/database/db/index.ts` (`CREATE TABLE push_subscriptions` + drop-column migration for `telegram_bot_tokens`) | migration | schema mutation | existing `CREATE TABLE` blocks in `db/index.ts:592-643` per research; `runPinColumnDrop`/`runHiddenColumnDrop` pattern for the telegram-table drop | exact |

### New frontend files (`src/ui/features/notifications/` — new slice)
| Target | Role | Data Flow | Closest Analog | Match |
|--------|------|-----------|----------------|-------|
| `src/ui/features/notifications/EnableNotificationsButton.tsx` | component (opt-in gesture surface) | user-gesture / request-response | `src/ui/feedback/FeedbackModal.tsx` (button-driven modal shape) OR settings-menu button — planner picks | role-match |
| `src/ui/features/notifications/EnableNotificationsButton.test.tsx` | test | RTL unit | `src/ui/hooks/use-service-worker.test.ts` (mocking `navigator.*`) | role-match |
| `src/ui/features/notifications/push-subscription-api.ts` | client (fetch wrapper) | request-response | any `src/ui/**/api.ts` fetch wrapper (planner picks — many exist) | role-match |

### Modified frontend files
| Target | Role | Data Flow | Analog for reference |
|--------|------|-----------|----------------------|
| `public/sw.js` (append `push` + `notificationclick` + `pushsubscriptionchange` handlers) | service worker | event-driven | **existing SW file** at `/public/sw.js:1-97` — 97-line file; new handlers append after the existing `fetch` handler (line 97). Do not modify existing install/activate/fetch logic |
| `src/ui/hooks/use-service-worker.ts` | hook | request-response | **already registered** — NO changes needed unless planner wants to expose the `ServiceWorkerRegistration` for the enable-button to reach `.pushManager.subscribe()`. If exposed, mirror the existing `useState` shape at lines 11-16 |
| `src/main.tsx` (unchanged — `useServiceWorker()` at line 251 already covers SW registration) | — | — | — |

### Modified infra
| Target | Change | Analog for the copy-paste |
|--------|--------|---------------------------|
| `docker/nginx.conf` | DELETE lines 252-262 (`/telegram` block); ADD equivalent block for `/push-subscriptions` | Copy-paste template = the existing `/telegram` block at `docker/nginx.conf:253-262` verbatim, s/telegram/push-subscriptions/ |
| `docker/nginx-https.conf` | Same as above at lines 263-273 | Same block, in the HTTPS conf |
| `docker/docker-compose.yml` | DELETE build stanza + `tg-bridge` service (lines 26-31, 195-216) + `tg-bridge-state` volume (lines 227-232) | — (deletion only) |
| `src/backend/starter.ts` | DELETE the three telegram-loop `void import(...)` blocks (lines 361-378, 398-419, 421-443); ADD a push-trigger-starter `void import(...)` block after the observation-loop starter (line 455-472) | Copy-paste template = the observation-loop-starter block at `src/backend/starter.ts:455-472` verbatim, s/observation-loop-starter/push-trigger-starter/ |
| `src/backend/database/database.ts` | DELETE `import telegramRoutes from "../telegram/routes.js"` (line 56) + `app.use("/telegram", telegramRoutes)` (line 1950); ADD `app.use("/push-subscriptions", pushSubscriptionsRoutes)` alongside other route mounts (research cites L1941-2127 range) | Copy-paste template = any adjacent `app.use("/<prefix>", ...)` mount |
| `src/backend/database/routes/voice.ts` | DELETE the `rejectBridgeServiceOnSpeak` block at lines 420-435 (`tg-bridge-service` userId special case) | — (deletion only) |

### Deletions (Telegram teardown — no analog needed)
All of `src/backend/telegram/*` (22 files): `bot-token-file-writer.{ts,test.ts}`, `bridge-config-writer.{ts,test.ts}`, `bridge-service-token.{ts,test.ts}`, `getme-proxy.{ts,test.ts}`, `human-token-writer.{ts,test.ts}`, `reconcile-dead-tokens.{ts,test.ts}`, `reconcile-pending-chat-ids.{ts,test.ts}`, `registry-writer.{ts,test.ts}`, `routes.{ts,test.ts}`, `shared-volume.{ts,test.ts}`, `tokens-store.{ts,test.ts}`.

Plus `substrate/services/tg-bridge/` (4 files): `bridge.sh`, `Dockerfile.tg-bridge`, `README.md`, `cursor-persistence-repro.sh`.

Plus (conditional per D-19): `getSharedDMRoom` helper in `src/backend/matrix/matrix-admin-client.ts:~710` — planner MUST `grep -r "getSharedDMRoom" src/` before removing; delete only if zero non-telegram callers remain.

Plus (schema): drop the `telegram_bot_tokens` table (schema.ts:759 + CREATE TABLE in db/index.ts:~347) via a mirror of the `runPinColumnDrop` / `runHiddenColumnDrop` migration pattern.

---

## Pattern Assignments (concrete excerpts)

### 1. `src/backend/notifications/push-trigger-loop.ts` — per-user always-on live-event pump

**Analog A (scheduler shape):** `src/backend/relay-sessions/observation-loop.ts:590-784` — `createObservationLoop` + `PerUserState` + `scanTick` + `start(users)` + backoff ladder + in-flight guard.

**Preserve verbatim from analog A:**
- `PerUserState` interface shape (lines 594-599) — but ADD `cursorByRoom: Map<string, string>` for the sinceToken cursor. Keep `inFlight` + `nextRunAt` + `backoffIndex`.
- `scanTick()` — per-user isolation, in-flight-guard skip with debug log (lines 691-733). Do NOT await inside the loop.
- `start(users)` — thundering-herd jitter (lines 744-757); INITIAL_TICK_JITTER_MS ~500ms defense; idempotent-reset-on-restart (lines 735-741).
- `stop()` — clear + empty (lines 772-781).
- `scheduleNext(userId, ok)` — success resets backoff + applies ±20% jitter; failure advances `BACKOFF_LADDER_MS` (lines 645-689).

```typescript
// Copy this exact shape from observation-loop.ts:594-599, ADD cursorByRoom:
interface PerUserState {
  userMxid: string;
  nextRunAt: number;
  backoffIndex: number;
  inFlight: boolean;
  cursorByRoom: Map<string, string>;   // ADDED — Matrix dir=f sinceToken per joined room
}
```

**Analog B (per-message poll primitive):** `src/backend/relay-room-stream/relay-room-stream-server.ts:1137-1154` — the `fetchLive` closure that calls `fetchRoomHistory({dir:"f", beforeEventId: sinceToken, count})`.

```typescript
// Copy this exact shape from relay-room-stream-server.ts:1142-1154:
fetchLive: async (roomId: string, sinceToken: string, count: number) => {
  const result = await fetchRoomHistory(roomId, {
    dir: "f",
    beforeEventId: sinceToken,
    count,
  });
  if (result.ok === false) return result;
  return {
    ok: true as const,
    events: result.events,
    nextSinceToken: typeof result.end === "string" ? result.end : null,
  };
},
```

**Cadence:** import `LIVE_EVENT_POLL_INTERVAL_MS` (2_000) from `relay-room-stream-server.ts:122`. Do NOT invent a new constant.

**Filtering pipeline (novel — assemble from decisions):** for each new event returned by `fetchLive`, apply in order:
1. `event.type === "m.room.message"` (D-04 excludes edits/reactions/joins/leaves — check `event.content["m.relates_to"]?.rel_type !== "m.replace"` for edits).
2. `event.sender !== userMxid` (D-04 no self-push).
3. `classifyRoom(...)` from `src/backend/relay-sessions/observation-loop-classifier.ts` — pass ONLY if `decision === "exclude"` AND `reason === "harness_dm"` (D-02).
4. Then dispatch to `sendPushToUser(userId, {title, body, roomId, agentMxid})`.

**No-throw contract:** mirror the "runObservationTick's contract is no-throw, but defense-in-depth" comment + catch at `observation-loop.ts:714-724`. Push-send failures MUST NOT stall the loop for other users or other rooms.

---

### 2. `src/backend/notifications/push-trigger-starter.ts` — boot bootstrap

**Analog:** `src/backend/relay-sessions/observation-loop-starter.ts:1-174` (entire file).

**Preserve verbatim:**
- Module docblock structure — steps 1/2/3 comment format.
- Best-effort discipline (lines 34-40 comment): "Every step is wrapped so a downstream failure logs + continues rather than throwing back to the caller."
- User enumeration query (lines 123-129):
```typescript
users = db.$client
  .prepare("SELECT id AS userId, mxid AS userMxid FROM users WHERE mxid IS NOT NULL AND mxid != ''")
  .all() as Array<{ userId: string; userMxid: string }>;
```
- Zero-users no-op log (lines 140-147).
- Module-level scheduler reference for future hot-reload (lines 82-85).
- Discriminated-union `Start*Result` return type (lines 76-78).

**Adapt:** replace `ensureRegistryRoomsExist` gate (lines 103-114) with `assertVapidConfigLoaded()` from `vapid-config.ts` — if VAPID keys missing, log warn + return `{ok:false, reason:"vapid_missing"}` cleanly (fail-safe, not fail-fast, mirroring the observation loop's degraded-mode-avoidance).

---

### 3. `src/backend/notifications/push-sender.ts` — web-push wrapper

**No analog in repo — novel dependency.** Copy shape from `web-push` npm README (canonical example from https://github.com/web-push-libs/web-push):

```typescript
webpush.setVapidDetails(subject, publicKey, privateKey);
await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60, urgency: "high" });
```

**Adapt from local patterns:**
- `DatabaseSaveTrigger.forceSave(...)` + try/catch + `.warn` fallback logging when pruning dead endpoints — mirror `src/backend/relay-sessions/relay-room-sessions-store.ts:92-105` verbatim. Skip the save when `result.changes === 0` (disk-sat guard — lines 86-90).
- Log with `endpoint.slice(0, 40)` prefix — never full URL (Security V8).
- The full assembled example is already in RESEARCH.md § Pattern 2 (lines 358-415). Planner copies directly from there.

---

### 4. `src/backend/notifications/preview-text.ts` — msgtype → preview string

**No analog in repo — pure utility.** Copy label taxonomy from `substrate/skills/agent-relay/recv.sh:379-381`:

```bash
# recv.sh:379-381 — source of truth for the taxonomy
case "$mtype" in
  m.image) klabel="image 🖼️";; m.video) klabel="video 🎬";;
  m.audio) klabel="audio 🎤";;   *) klabel="file 📎";; esac
```

**Translate to TS:**
```typescript
export function derivePreviewText(event: { content?: { msgtype?: string; body?: string; filename?: string } }): string {
  const msgtype = event.content?.msgtype;
  const body = event.content?.body ?? "";
  const filename = event.content?.filename;
  switch (msgtype) {
    case "m.image": return filename ? `image 🖼️ (${filename})` : "image 🖼️";
    case "m.audio": return "audio 🎤";
    case "m.video": return "video 🎬";
    case "m.file":  return filename ? `file 📎 (${filename})` : "file 📎";
    case "m.text":
    case undefined: return truncate(body, 100);
    default:        return body || "(message)";
  }
}
```

**Test pattern:** any small pure-function test in `src/backend/utils/` — describe/it/expect from vitest. See RESEARCH.md § Existing Tests for the vitest boilerplate.

---

### 5. `src/backend/notifications/vapid-config.ts` — VAPID key loader (fail-fast)

**Analog:** `src/backend/branding/assert-boot.ts` — `assertBrandingConfigAtBoot()` pattern cited in RESEARCH.md § V7. Fail-fast at startup with a structured error the operator sees BEFORE any HTTP route mounts.

Called from `starter.ts` at the SAME insertion point pattern as `assertBrandingConfigAtBoot` (starter.ts:474-481) — placed BEFORE route mounts so a missing VAPID key aborts boot cleanly instead of running degraded.

**Two storage options (planner picks — see RESEARCH.md § Open Question 1):**
- **Env-var path:** read `process.env.VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`; validate subject starts with `mailto:` or `https://` (Pitfall 2); throw at boot if missing/malformed.
- **DB-row path:** mirror `matrixAdminCreds` singleton (schema.ts:717-749) — add a `pushVapidConfig` table with `id: integer primaryKey`, `publicKey`, `privateKey`, `subject`, timestamps. Add an admin-gated `/push-vapid/ingest` route (mirror of `/matrix-admin/ingest`).

---

### 6. `src/backend/notifications/resolve-agent-display-name.ts` — sender display-name resolution

**Analog:** `src/backend/fleet-status/identity-appearance.ts` — `resolveIdentityAppearance` cited in RESEARCH.md § Architecture Responsibility Map. Also mirror the client-side cascade in `src/ui/features/pretty-view/relay-mxid-resolve.ts` (mxid local-part lowercase → identityKey lookup → appearance).

Small wrapper module — pattern is "call `resolveIdentityAppearance(identityKey)`, fall back to the mxid local-part, return a display string ≤ 40 chars".

---

### 7. `src/backend/database/db/schema.ts` — add `pushSubscriptions` table

**Analog:** `relayRoomSessions` at `src/backend/database/db/schema.ts:881-896` — nearly identical shape (user_id FK cascade, timestamps default CURRENT_TIMESTAMP).

```typescript
// Copy this exact shape from schema.ts:881-896, adapt columns:
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastDeliveredAt: text("last_delivered_at"),   // nullable
});
// UNIQUE INDEX on (user_id, endpoint) — added via db/index.ts CREATE TABLE + CREATE UNIQUE INDEX
```

**VAPID-config table (if planner picks DB-row storage over env-var):** mirror `matrixAdminCreds` at `schema.ts:717-749` — singleton with `id: integer primaryKey`.

---

### 8. `src/backend/database/routes/push-subscriptions.ts` — POST/GET route

**Analog:** `src/backend/database/routes/user-preferences.ts:1-24, 469-509`.

**Copy exact top-of-file boilerplate (lines 1-24):**
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Copy exact auth + `forceSave` + try/catch discipline from `user-preferences.ts:398-418`:**
```typescript
try {
  await DatabaseSaveTrigger.forceSave("push_subscription_register");
} catch (saveErr) {
  databaseLogger.warn("Force-save after push subscription register failed", {
    operation: "push_subscription_register_save_failed",
    userId,
    error: saveErr instanceof Error ? saveErr.message : "Unknown error",
  });
}
```

**Copy route-handler shape from `user-preferences.ts:504-506`:**
```typescript
router.post("/", authenticateJWT, express.json({ limit: "8kb" }),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    // ...
  }
);
```

**userId comes from JWT, NEVER from body** (Security V4 threat pattern). Mirror `user-preferences.ts:470, 505` line.

**Full assembled example is in RESEARCH.md § Pattern 1** (lines 296-353) — planner copies verbatim.

---

### 9. `public/sw.js` — append push/notificationclick/pushsubscriptionchange handlers

**Analog:** the existing `public/sw.js:1-97` (already understood — 97 lines with install/activate/fetch handlers using `event.waitUntil` correctly).

**Preserve intact:** lines 1-97 unchanged. New handlers append starting at line 98.

**Copy handler shapes from RESEARCH.md § Pattern 3 verbatim** (research already assembled them from MDN + WebKit blog). Non-negotiables:
- `event.waitUntil(...)` around every async body (matches existing install/activate pattern in sw.js:12, 25).
- Every `push` event MUST call `self.registration.showNotification(...)` — silent pushes get subscriptions revoked on iOS (Pitfall 3).
- Deep-link URL shape `/?openRoom=<roomId>` in `notificationclick` — see Assumption A6 in RESEARCH.md (frontend AppShell must be wired to read this param on mount).

**Do NOT touch** the `__SKYNET_SW_BASE_PATH__` placeholder at line 2 (Pitfall 9 — placeholder is unhydrated but harmless; out of scope to fix).

---

### 10. `src/ui/features/notifications/EnableNotificationsButton.tsx` — opt-in gesture surface

**Analog candidates (planner picks based on where a first-time user's attention lands — RESEARCH.md § Open Question 3):**
- `src/ui/feedback/FeedbackModal.tsx` — modal shape with title + body + footer buttons (Radix DialogPrimitive at line 49). Good analog if planner picks the welcome-modal approach.
- `src/ui/sidebar/NewSessionDialog.tsx` / `src/ui/sidebar/CreateRoleDialog.tsx` — settings-side dialog invocation pattern.

**Non-negotiable (Pitfall 4):** `Notification.requestPermission()` MUST fire **synchronously inside** the button's `onClick` handler — not inside `useEffect`, not inside `setTimeout`, not after any `await` boundary. iOS silently blocks it otherwise.

**Skeleton:**
```typescript
async function onClick() {
  const perm = await Notification.requestPermission();  // ← inside onClick, synchronously called
  if (perm !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await fetch("/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: {
        p256dh: arrayBufferToBase64Url(sub.getKey("p256dh")),
        auth:   arrayBufferToBase64Url(sub.getKey("auth")),
      },
    }),
  });
}
```

**Reachable-at-any-time discipline (Pitfall 1):** the button MUST be reachable AFTER first grant too — subscriptions rotate silently every 1-2 weeks on iOS; user needs a way to re-subscribe.

---

### 11. `src/ui/features/notifications/push-subscription-api.ts` — client fetch wrapper

**Analog:** any small `src/ui/**/api.ts` fetch module. Two functions: `getVapidPublicKey()` (GET) + `postSubscription(sub)` (POST with `credentials: "include"`).

---

### 12. Frontend subscription-mint + POST-to-backend flow — glue

**Analog for SW-registration awareness:** `src/ui/hooks/use-service-worker.ts:11-107` (already registered at `src/main.tsx:251`).

**Non-changes:** `useServiceWorker` hook does not need modification IF the `EnableNotificationsButton` calls `await navigator.serviceWorker.ready` directly. If planner wants the button to consume registration state from the hook, expose a `registration` field alongside the existing `state` object (lines 11-16 shape).

---

### 13. Modified `docker/nginx.conf` + `docker/nginx-https.conf`

**Analog for the ADD:** the existing `/telegram` block at `docker/nginx.conf:253-262` is the exact template.

```nginx
location ~ ^/push-subscriptions(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_set_header X-Forwarded-Port $proxy_x_forwarded_port;
    proxy_set_header X-Forwarded-Host $proxy_x_forwarded_host;
}
```

**Dual-conf caveat (Pitfall 5):** the block MUST land in BOTH `nginx.conf` and `nginx-https.conf`. Not one, not either — both. Real production incidents traced to single-file changes.

**DELETE the existing `/telegram` block** at `nginx.conf:252-262` AND `nginx-https.conf:263-273`.

---

### 14. Modified `src/backend/starter.ts` — add push-trigger-starter, remove three telegram loops

**Analog for the ADD:** the existing observation-loop-starter block at `src/backend/starter.ts:455-472` is the exact template — copy verbatim, s/observation-loop-starter/push-trigger-starter/, s/[phase-89]/[phase-126]/, adjust operation strings.

```typescript
// Copy this exact shape from starter.ts:455-472:
void import("./notifications/push-trigger-starter.js")
  .then((m) => {
    m.startPushTriggerLoopOnBoot().catch((err) => {
      systemLogger.warn("[phase-126] push-trigger bootstrap failed at startup", {
        operation: "push_trigger_bootstrap_error",
        error: err instanceof Error ? err.message : "unknown",
      });
    });
  })
  .catch((err) => {
    systemLogger.warn("startPushTriggerLoopOnBoot module load failed", {
      operation: "push_trigger_bootstrap_module_load_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  });
```

**DELETE:**
- Lines 361-378 (bridge-config-writer block).
- Lines 398-419 (reconcile-dead-tokens block).
- Lines 421-443 (reconcile-pending-chat-ids block).

**Ordering:** the new push-trigger-starter block goes AFTER the observation-loop-starter block (both consume `users WHERE mxid IS NOT NULL`; both are fire-and-forget best-effort; symmetry with the existing observation-loop start).

---

### 15. Modified `src/backend/database/database.ts`

**DELETE:**
- Line 56: `import telegramRoutes from "../telegram/routes.js";`
- Line 1950: `app.use("/telegram", telegramRoutes);`

**ADD (adjacent to other route mounts in the L1941-2127 range):**
```typescript
import pushSubscriptionsRoutes from "./routes/push-subscriptions.js";
// ...
app.use("/push-subscriptions", pushSubscriptionsRoutes);
```

Also serve the VAPID public key GET endpoint via the same router (or a sibling `/push-vapid/public-key` route mounted here).

---

### 16. Modified `src/backend/database/routes/voice.ts`

**DELETE:** the `rejectBridgeServiceOnSpeak` block at lines 420-435. This special-cases `userId === "tg-bridge-service"` — no longer needed after the bridge is gone.

---

## Shared Patterns (apply to multiple new files)

### S1. Auth on backend routes
**Source:** `src/backend/database/routes/user-preferences.ts:22-24, 469-505`
**Apply to:** `push-subscriptions.ts` route file
```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
router.post("/", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;   // NEVER from body
});
```

### S2. `DatabaseSaveTrigger.forceSave` + try/catch + `.warn` fallback
**Source:** `src/backend/relay-sessions/relay-room-sessions-store.ts:86-105` (with the disk-sat `result.changes === 0` early return)
**Apply to:** every INSERT/UPDATE/DELETE on `push_subscriptions` in `push-subscriptions.ts` route AND in `push-sender.ts`'s dead-endpoint pruning
```typescript
if (result.changes === 0) return;   // disk-sat hotfix 2026-09-09
try {
  await DatabaseSaveTrigger.forceSave("push-subscription-<op>");
} catch (err) {
  databaseLogger.warn("push_subscriptions persistence flush failed — write persisted to RAM only", {
    operation: "push_subscription_<op>_force_save_failed",
    userId,
    error: err instanceof Error ? err.message : "unknown",
  });
}
```

### S3. Fire-and-forget boot startup with two-layer catch
**Source:** `src/backend/starter.ts:455-472` (observation-loop-starter dispatch)
**Apply to:** the new `push-trigger-starter` dispatch in starter.ts
Both the `.catch()` on the promise AND the `.catch()` on the dynamic-import are load-bearing. Do NOT drop either.

### S4. Per-user isolation with in-flight guard
**Source:** `src/backend/relay-sessions/observation-loop.ts:594-599, 691-733`
**Apply to:** `push-trigger-loop.ts`
A failing tick for user A CANNOT delay or block user B. Backoff ladder + `inFlight` boolean per user.

### S5. Thundering-herd defenses
**Source:** `src/backend/relay-sessions/observation-loop.ts:744-757` (boot-spread) + `645-668` (per-tick ±20% jitter)
**Apply to:** `push-trigger-loop.ts`
Without both, N users lock-step-fire against Synapse every 2s forever.

### S6. Dual-nginx-conf discipline
**Source:** cited all over the codebase (research references `src/backend/database/database.ts:2033-2038, 2071-2073, 2100-2103, 2112-2115, 2123-2125`)
**Apply to:** every route mount added to `database.ts`
Every new HTTP prefix requires a `location ~ ^/<prefix>(/.*)?$ { proxy_pass ... }` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Copy from the existing `/telegram` block template.

### S7. Backend TS build gate
**Source:** RESEARCH.md § Project Constraints
**Apply to:** every patch touching `src/backend/*`
Run `npm run build:backend && npm run build` — the frontend `tsc --noEmit` misses backend errors. Load-bearing before any commit.

### S8. Test-file colocation + dep-injection pattern
**Source:** `src/backend/relay-sessions/observation-loop.test.ts` (per-tick unit tests via `ObservationTickDeps` interface — no `vi.mock` needed)
**Apply to:** `push-trigger-loop.test.ts`, `push-sender.test.ts`, `preview-text.test.ts`, `push-subscriptions.test.ts`
Deps-as-interface is the canonical shape. `vi.mock` is a fallback, not the default.

---

## No Analog Found (novel territory)

| File | Role | Why no analog | Reference |
|------|------|---------------|-----------|
| `src/backend/notifications/push-sender.ts` | web-push wrapper | Skynet has never sent web push before — `web-push` npm is a new dependency | `web-push` README (https://github.com/web-push-libs/web-push) + RESEARCH.md § Pattern 2 (already assembled) |
| `src/backend/notifications/preview-text.ts` | pure utility for msgtype→string | No shared frontend/backend message-preview module exists today; the frontend row-renderer drops non-text msgtypes (Pitfall 8) | Label taxonomy from `substrate/skills/agent-relay/recv.sh:379-381`; assemble as small pure module |

Both are documented in RESEARCH.md with fully-assembled example code. Planner copies directly from the research doc.

---

## Deletion Manifest (no analog needed — teardown surface)

Enumerated cleanly here so the planner can slice teardown tasks:

**Directory deletions:**
- `src/backend/telegram/` — all 22 files (11 `.ts` + 11 `.test.ts`)
- `substrate/services/tg-bridge/` — 4 files (`bridge.sh`, `Dockerfile.tg-bridge`, `README.md`, `cursor-persistence-repro.sh`)

**File-level deletions inside kept files:**
- `src/backend/database/database.ts:56` (telegram routes import) + `:1950` (`/telegram` mount)
- `src/backend/database/routes/voice.ts:420-435` (`rejectBridgeServiceOnSpeak` special-case for `tg-bridge-service` userId)
- `src/backend/starter.ts:361-378, 398-419, 421-443` (three telegram-loop dispatches)
- `src/backend/matrix/matrix-admin-client.ts:~710` (`getSharedDMRoom` — ONLY if no non-telegram caller found; grep before removing per D-19)
- `docker/nginx.conf:252-262` (`/telegram` block)
- `docker/nginx-https.conf:263-273` (`/telegram` block)
- `docker/docker-compose.yml:26-31, 195-216, 227-232` (build stanza + `tg-bridge` service + `tg-bridge-state` volume)

**Schema deletion:**
- `src/backend/database/db/schema.ts:759-...` (`telegramBotTokens` table export)
- `src/backend/database/db/index.ts:~347` (CREATE TABLE `telegram_bot_tokens`) — replace with drop-column migration mirroring `runPinColumnDrop`/`runHiddenColumnDrop` shape (research cites Phase 107 / Phase 92)

**Runtime state (docker/orchestrator concern, out of code scope but flag in SUMMARY.md):**
- `skynet_tg-bridge-state` docker volume — deploy runbook `docker volume rm` step
- `tg-bridge:local` dangling image — deploy runbook `docker image prune -f` step
- Telegram BotFather bot registrations — Ashley's manual concern per D-20

---

## Metadata

**Analog search scope:** `src/backend/relay-sessions/`, `src/backend/relay-room-stream/`, `src/backend/database/`, `src/backend/telegram/`, `src/backend/starter.ts`, `src/backend/branding/`, `src/ui/hooks/`, `src/ui/features/`, `src/ui/feedback/`, `src/ui/sidebar/`, `public/`, `docker/`, `substrate/`.

**Files scanned for pattern extraction:** 12 (observation-loop.ts, observation-loop-starter.ts, relay-room-stream-server.ts, relay-room-sessions-store.ts, user-preferences.ts, schema.ts, sw.js, use-service-worker.ts, starter.ts, FeedbackModal.tsx, nginx.conf, recv.sh).

**Pattern extraction date:** 2026-09-21

**Cross-reference:** every non-novel pattern in this file traces to a specific file:line in the running codebase. RESEARCH.md carries the fully-assembled example code for the two novel modules (`push-sender.ts` § Pattern 2, sw.js handlers § Pattern 3, `push-trigger-loop.ts` § Pattern 4, `push-subscriptions.ts` route § Pattern 1). This PATTERNS.md tells the planner WHICH analog to copy from and WHICH excerpt-range within it; RESEARCH.md carries the finished pattern text.
