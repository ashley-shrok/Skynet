# Phase 144: ntfy-based Durable Notifications — Research

**Researched:** 2026-10-02
**Domain:** ntfy self-hosted push notifications, Docker Compose, Caddy reverse proxy, SQLite schema migration
**Confidence:** HIGH (all primary technical claims verified against official ntfy docs and live source code)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Infrastructure**
- Each Skynet instance runs its own ntfy server inside its own Docker compose stack. No shared ntfy infrastructure.
- Caddy routes a path prefix on the instance's existing public hostname to the ntfy container — no dedicated subdomain, no additional TLS certificate, no new DNS record.
- ntfy server's `base-url` derives from the instance's existing hostname configuration (`SKYNET_PUBLIC_URL` env var).
- Publishing from Skynet backend to ntfy happens over the internal Docker network only.
- ntfy server config includes `upstream-base-url: "https://ntfy.sh"` for iOS wake-up relaying.

**Credentials**
- One Skynet-held publishing credential, write-only, lives in encrypted backend storage.
- One per-user reading credential, read-only, also stored encrypted on backend. Surfaced to user via preferences pane for manual entry into ntfy iOS app.
- Hard credential rotation on regenerate — old credential invalidates immediately, no overlap window.

**Topic model**
- One topic per user (not per-agent). Agent identity rides in the payload.
- Topic names are unguessable (opaque per-user identifier).

**Trigger (UNCHANGED from Phase 128)**
- Keep `push-trigger-loop.ts`, `resolve-agent-display-name.ts`, `preview-text.ts`, `open-harness-deep-link.ts`.

**Publishing path**
- Replace `webpush.sendNotification()` in `push-sender.ts` with HTTP POST to local ntfy server.
- Mirror current error-handling posture: log on failure, drop notification, no retry. Fire-and-forget-with-logs.
- One push per DM — no coalescing.

**Data model**
- Replace `push_subscriptions` table shape: drop p256dh + auth columns.
- New shape: user_id, topic_name, reading_credential (encrypted).
- Migration: existing rows discarded. No bridge table, no dual-write.

**Preferences pane rebuild**
- Delete "grant browser permission" button flow.
- Replace with setup pane: server address, topic name, reading credential values for the user to enter in ntfy iOS app.
- "Send test notification" button — only ground truth for delivery health.
- "Regenerate credential" button — invalidates current reading credential immediately.
- Honest state: "set up" means a credential has been issued for this user. Nothing more.

**Service worker cleanup**
- Delete `push` event handler (sw.js lines 99-131).
- Delete `pushsubscriptionchange` rotation handler (sw.js lines 180-244).
- `notificationclick` handler also deleted (unused without browser push landing — the whole push surface in SW goes away).

**Deletion scope**
- Remove `web-push` and `@types/web-push` from package.json.
- Remove `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env vars from skynet.env and config loaders.
- Remove GET /push-subscriptions/vapid-public-key endpoint.
- Remove any VAPID-specific test infrastructure.
- Remove `assertVapidConfigAtBoot()` from `src/backend/starter.ts`.
- Audit for and remove orphan browser-push code paths.

**No instance-specific hardcoding**
- All URLs derive from `SKYNET_PUBLIC_URL` env var (already established in codebase).

### Claude's Discretion
- Final ntfy server configuration file structure.
- Final `push_subscriptions` table schema after column drop/rename — exact column names, index strategy.
- The specific Caddy configuration syntax for path-prefix proxying.
- Credential generation algorithm (opaque string, reasonable entropy).
- Specific logging format for publish failures (match existing log patterns in the codebase).
- Split-vs-one phase decision — the planner's call based on scope.

### Deferred Ideas (OUT OF SCOPE)
- Per-agent topics as a path to per-agent muting UX.
- A Skynet system Matrix identity for non-agent notifications.
- Desktop push via ntfy's web client or native desktop clients.
- Coalescing or priority tiers.
- Any migration ceremony for existing browser-push subscribers.
- QR-code bootstrap flow.
- Proactive drift detection / heartbeat / background delivery probes.
- Durability queue or retry logic for ntfy publishing failures.

</user_constraints>

---

## Summary

Phase 144 is a pure transport swap: replace the Phase 128 browser-push system (web-push / VAPID / service worker push handler) with a self-hosted ntfy server per Skynet instance. The trigger loop, display-name resolution, preview composition, and deep-link routing all stay untouched. Only the publishing step, the subscription data model, and the preferences pane change.

The ntfy server runs as a Docker container joining the existing `skynet-net` network. Caddy proxies a path prefix (`/ntfy`) on the existing public hostname to the ntfy container, stripping the prefix before forwarding. The ntfy iOS app, pointed at `https://<instance-hostname>/ntfy` with the user's reading credential and topic, receives push notifications that arrive natively via Apple's infrastructure (routed through ntfy.sh as an upstream relay). Content never transits ntfy.sh — only a wake-up signal (message ID + topic hash) goes upstream.

**Critical finding:** ntfy does NOT natively support running at a subpath. The ntfy web interface and some internal URL parsing break when `base-url` contains a path component. However, the ntfy iOS native app is unaffected — it constructs topic URLs as `normalizeBaseUrl(serverUrl) + "/" + topic`, so a user-entered server URL of `https://term.gigaashley.click/ntfy` yields `https://term.gigaashley.click/ntfy/<topic>`. The Caddy proxy strips the `/ntfy` prefix before forwarding to the container, and the ntfy container sees root-relative paths. The ntfy server's own `base-url` config must be set to the full path-prefixed URL (`https://term.gigaashley.click/ntfy`) so that upstream relay poll requests include the correct externally-reachable URL.

**Primary recommendation:** One phase, structured as ~4 sequenced plans: (1) Docker/Caddy infra, (2) backend swap + schema migration, (3) frontend pane rebuild + service worker cleanup, (4) browser-push deletion sweep. Plans 1-2 and 3-4 can form two wave pairs with plan 2 depending on plan 1 (ntfy must exist before the backend tries to reach it at boot-time assertion).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| iOS push delivery | External (ntfy.sh + Apple APNs) | ntfy container (self-hosted) | APNs cert is held by ntfy project, not Skynet; wake-up signal routes through ntfy.sh |
| Notification trigger (DM detection) | Backend (Node.js push-trigger-loop) | — | Unchanged from Phase 128; Matrix polling + harness_dm classification |
| Notification publish | Backend (ntfy HTTP POST over internal Docker net) | — | Replaces webpush.sendNotification; fire-and-forget-with-logs |
| Topic + credential management | Backend (SQLite, encrypted fields) | — | push_subscriptions table rebuilt; FieldCrypto encrypts reading_credential |
| ntfy credential provisioning | ntfy container (declarative server.yml) | — | auth-users + auth-tokens in config, synced from Skynet env at container start |
| Caddy path routing | Caddy container (handle_path + strip_prefix) | — | Strips /ntfy prefix before forwarding; ntfy container sees root-relative paths |
| Preferences UI (setup display + test + regenerate) | Frontend (PreferencesNotificationsPane.tsx) | Backend (new ntfy routes) | Pane rebuilt; backend provides GET ntfy-setup + POST ntfy-test + POST ntfy-regenerate |
| Service worker cleanup | Frontend (public/sw.js) | — | Delete push + pushsubscriptionchange handlers; browser push surface eliminated |

---

## Standard Stack

### Core (ntfy)
| Library / Component | Version | Purpose | Why Standard |
|---------------------|---------|---------|--------------|
| `binwiederhier/ntfy` Docker image | `v2.28.0` | Self-hosted ntfy server | Official image; `v2.28.0` is current release [VERIFIED: hub.docker.com/r/binwiederhier/ntfy] |
| node:crypto `randomBytes` | built-in | Credential + topic generation | Already used in codebase (identity-birth-orchestrator.ts:675); no new dep |

### Removed (this phase)
| Package | Version in package.json | Removal Action |
|---------|------------------------|----------------|
| `web-push` | `^3.6.7` | Remove from `dependencies` [VERIFIED: npm registry — 3.6.7 is latest] |
| `@types/web-push` | `^3.6.4` | Remove from `devDependencies` [VERIFIED: npm registry] |

No new npm packages required. The ntfy publish API is a plain HTTP POST using Node.js's built-in `fetch` (available Node 18+, used elsewhere in codebase).

**Installation (none required):** ntfy runs as a Docker container. No npm packages added. `web-push` and `@types/web-push` are deleted.

---

## Package Legitimacy Audit

> This phase adds no new npm packages. It removes `web-push` and `@types/web-push`.
> The only new external component is the `binwiederhier/ntfy` Docker image.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `web-push` (REMOVED) | npm | ~11 yrs | ~750K/wk | github.com/web-push-libs/web-push | n/a | Being deleted |
| `binwiederhier/ntfy` | Docker Hub | ~4 yrs | — | github.com/binwiederhier/ntfy | n/a (Docker image) | Approved — well-established project, verified at hub.docker.com |

*slopcheck was unavailable at research time. No new npm packages are added; only removal occurs. The ntfy Docker image is confirmed via Docker Hub API and GitHub. No slopcheck gate needed.*

---

## Q1: ntfy Server Configuration Shape

[VERIFIED: docs.ntfy.sh/config]

ntfy server uses a YAML config file at `/etc/ntfy/server.yml` inside the container (or env vars with `NTFY_` prefix).

**Concrete reference config for Skynet:**

```yaml
# /etc/ntfy/server.yml (mounted or baked into container)
# OR equivalently via env vars in docker-compose.yml

base-url: "https://term.gigaashley.click/ntfy"   # derived from SKYNET_PUBLIC_URL + "/ntfy"
listen-http: ":2586"                               # internal port; Caddy proxies from outside
behind-proxy: true                                 # ntfy uses X-Forwarded-For for rate-limiting
upstream-base-url: "https://ntfy.sh"              # iOS wake-up relay
cache-file: "/var/lib/ntfy/cache.db"              # message cache (named volume)
auth-file: "/var/lib/ntfy/auth.db"                # user + token database (named volume)
auth-default-access: "deny-all"                   # no anonymous access

# Declarative user + token provisioning (synced from Skynet env at container start).
# auth-users creates/updates users on startup; removed entries delete the user.
# auth-tokens pre-provisions tokens; removed entries delete the token.
auth-users:
  - "skynet-publisher:<bcrypt-hash-of-publish-password>:admin"  # write-only via admin role
  - "skynet-reader-<user_id>:<bcrypt-hash>:user"               # per-user read-only account
auth-tokens:
  - "skynet-publisher:tk_<publish-token>"          # Skynet backend uses this token to publish
  - "skynet-reader-<user_id>:tk_<reading-token>"  # surfaced to user in preferences pane
```

**Alternative approach (simpler for Skynet's one-publisher model):**

Use the `admin` role for the Skynet-held publisher (one token, write to any topic). Use `user` role with ACL for the per-user reader. Skynet generates credentials at first boot / on regenerate using `randomBytes`, stores them encrypted in the DB, then writes them into the ntfy container config via a docker exec call or by reconstructing the server.yml from env vars.

**Simpler yet (recommended — Docker-native):** Pass config entirely via environment variables in docker-compose.yml. Dollar signs in bcrypt hashes must be escaped as `$$` in compose YAML.

```yaml
environment:
  NTFY_BASE_URL: "${SKYNET_PUBLIC_URL}/ntfy"
  NTFY_LISTEN_HTTP: ":2586"
  NTFY_BEHIND_PROXY: "true"
  NTFY_UPSTREAM_BASE_URL: "https://ntfy.sh"
  NTFY_CACHE_FILE: "/var/lib/ntfy/cache.db"
  NTFY_AUTH_FILE: "/var/lib/ntfy/auth.db"
  NTFY_AUTH_DEFAULT_ACCESS: "deny-all"
```

**Data persistence:** Two files that must survive container recreation:
- `/var/lib/ntfy/cache.db` — message cache (12h default retention)
- `/var/lib/ntfy/auth.db` — user/token database

Both should live in a named Docker volume (`ntfy-data`) alongside `skynet-data`, `caddy-data`, `synapse-data`.

---

## Q2: ntfy HTTP Publish API Shape

[VERIFIED: docs.ntfy.sh/publish]

**Skynet's publish call (HTTP POST, no external library):**

```typescript
// Inside ntfy-sender.ts — replaces webpush.sendNotification()
// Internal Docker network: ntfy container has service name "ntfy" on skynet-net
const NTFY_INTERNAL_URL = "http://ntfy:2586";

const response = await fetch(
  `${NTFY_INTERNAL_URL}/${encodeURIComponent(topicName)}`,
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${publishToken}`,  // Skynet-held write-only token
      "Title": payload.title,                      // agent display name (40-char cap)
      "Click": clickUrl,                           // deep-link URL: /?openHarness=...&host=...
      "Content-Type": "text/plain",
    },
    body: payload.body,                            // message preview text
    signal: AbortSignal.timeout(5000),             // 5s timeout; fire-and-forget on abort
  }
);
if (!response.ok) {
  databaseLogger.warn("[ntfy] publish failed", {
    operation: "ntfy_publish_failed",
    userId,
    statusCode: response.status,
  });
}
```

**Headers used:**
- `Authorization: Bearer <token>` — preferred over Basic auth; token starts with `tk_`
- `Title: <agent-display-name>` — notification title line (lock screen header)
- `Click: <deep-link-url>` — URL opened when user taps notification in iOS app
- Body (plain text): message preview

**NOT used:** `X-Tags`, `X-Priority` (no priority tiers in v1 per locked decisions), `X-Attach`.

**URL structure:** `POST http://ntfy:2586/<topic-name>`
- topic-name is an opaque per-user identifier (not the username, not the user_id)
- URL-encode the topic name (it's a random hex string, so no special chars expected, but defensive encoding is correct)

---

## Q3: ntfy Auth Model

[VERIFIED: docs.ntfy.sh/config]

**User and token provisioning — two approaches:**

**Option A: Declarative via config (recommended for Docker):**
- `auth-users` in server.yml pre-provisions users with bcrypt-hashed passwords.
- `auth-tokens` in server.yml pre-provisions access tokens.
- Both keys are synced to the auth.db on server startup. Entries removed from config are deleted from the database.
- Generates: `ntfy user hash <password>` → bcrypt hash for the password field.
- Token format: `tk_` prefix + 29 random alphanumeric chars, 32 chars total (e.g. `tk_AgQdq7mVBoFD3dEqa78e2cjou7pC`).

**Option B: CLI inside running container:**
```bash
docker exec ntfy ntfy user add --role=admin skynet-publisher
docker exec ntfy ntfy token add skynet-publisher        # returns token
docker exec ntfy ntfy user add --role=user skynet-reader-<user_id>
docker exec ntfy ntfy access skynet-reader-<user_id> <topic-name> ro
docker exec ntfy ntfy token add skynet-reader-<user_id>  # returns token
```

**For Skynet, the right model:**

Skynet owns credential generation. On first boot (or on regenerate):
1. Backend generates: publish token (`tk_` + 28 hex chars from `randomBytes(14).toString("hex")`), per-user topic name (`randomBytes(16).toString("hex")`), per-user reading credential (`tk_` + 28 hex chars from `randomBytes(14).toString("hex")`).
2. These are stored encrypted in the push_subscriptions table (reading credential) and in a new ntfy_config singleton table (publish token).
3. They are passed to the ntfy container via environment variables in docker-compose.yml (read from skynet.env) and consumed by ntfy's `auth-tokens` config.
4. On container restart, ntfy syncs the auth.db from the config — no runtime CLI calls needed.

**ACL model:** Skynet publisher uses the `admin` role (blanket write to all topics). Per-user reader uses the `user` role with ACL entry `ro` for that user's specific topic. This means the reading credential cannot read anyone else's topic.

**Token revocation:** Remove the token from `auth-tokens` config + restart container. Old token immediately invalid (ntfy syncs auth.db from config on startup). The "hard rotation, no overlap window" decision is naturally implemented by this mechanism.

---

## Q4: ntfy iOS App Subscription Flow

[VERIFIED: ntfy-ios source — github.com/binwiederhier/ntfy-ios, Helpers.swift and SubscriptionAddView.swift]

**Exact fields in the ntfy iOS "Add subscription" dialog:**

1. **Topic name** — free text field. Placeholder: "Topic name, e.g. phil_alerts". User enters the opaque topic string.
2. **"Use another server" toggle** — off by default (uses ntfy.sh). Must be toggled ON for self-hosted.
3. **Service URL** — appears when toggle is on. Placeholder: "Service URL, e.g. https://ntfy.home.io". User enters `https://term.gigaashley.click/ntfy` (the path-prefixed URL).
4. **Username + password** — a separate "Login" screen appears if the topic requires authentication. User enters the reading credential's username and password.

**How the iOS app constructs the subscription URL:**
```swift
// From Helpers.swift (verified in ntfy-ios source):
func topicUrl(baseUrl: String, topic: String) -> String {
    return "\(normalizeBaseUrl(baseUrl))/\(topic)"
}
func normalizeBaseUrl(_ baseUrl: String) -> String {
    var normalized = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    while normalized.hasSuffix("/") { normalized.removeLast() }
    return normalized
}
```

So: user enters `https://term.gigaashley.click/ntfy` → app polls `https://term.gigaashley.click/ntfy/<topic>/json`.

**This is why path prefix routing works for the iOS native app:** The app treats the entire path-prefixed URL as the "base URL" and appends topic name after it. The Caddy proxy strips `/ntfy` before forwarding to the container, so the ntfy container sees `/<topic>/json` — which is what it expects.

**HTTPS requirement:** Yes — the iOS app requires HTTPS for self-hosted servers (the existing Caddy cert for `term.gigaashley.click` covers this; no new cert needed).

**Authentication in the app:** After adding the subscription, if the server returns 401, the app shows the login view. The user enters username (`skynet-reader-<user_id>`) and password (the reading credential plaintext). The app stores this credential and reuses it for future polls. Alternatively, if Skynet surfaces a token directly, the user can configure the app's default server with a token in Settings (more complex; username/password flow is simpler for UX).

---

## Q5: Caddy Path-Prefix Routing to ntfy

[VERIFIED: Caddy docs + live /opt/skynet/caddy-config/Caddyfile inspected]

**Current Caddyfile structure** (live on t1000):
```
{
    email ahbarnum@gmail.com
}

term.gigaashley.click {
    log { format json; output stdout }
    reverse_proxy skynet:8080 {
        transport http { response_header_timeout 5m; read_timeout 5m }
    }
}
```

**Required addition — path prefix block for ntfy:**

Caddy's `handle_path` directive matches a path prefix AND strips it before proxying. This is the correct primitive for ntfy's path-prefix routing.

```caddyfile
term.gigaashley.click {
    log { format json; output stdout }

    # Phase 144 — ntfy path-prefix routing.
    # handle_path strips /ntfy from the path before forwarding,
    # so ntfy container sees root-relative paths (/<topic>/json etc.)
    # ntfy handles WebSocket (SSE/long-poll) automatically; Caddy proxies
    # both HTTP and WS without explicit upgrade headers needed.
    handle_path /ntfy/* {
        reverse_proxy ntfy:2586
    }

    # Existing Skynet catchall — must come AFTER the ntfy block.
    handle {
        reverse_proxy skynet:8080 {
            transport http { response_header_timeout 5m; read_timeout 5m }
        }
    }
}
```

**Key points:**
- `handle_path /ntfy/*` matches any path starting with `/ntfy/` and strips the prefix.
- `handle { ... }` is the fallback block for everything else (replaces the current `reverse_proxy skynet:8080` since you can only have one top-level reverse_proxy when using `handle` blocks).
- Caddy automatically handles WebSocket upgrades — no explicit `header_up Upgrade` needed (unlike nginx).
- The ntfy container is named `ntfy` on the `skynet-net` network — Caddy reaches it at `ntfy:2586`.
- Trailing slash handling: `handle_path /ntfy/*` does NOT match `/ntfy` without a trailing slash. A `redir /ntfy /ntfy/` entry can be added if needed, but since only the iOS app and Skynet backend (not a human browser) will ever hit this path, it's low priority.

**Important:** The existing `reverse_proxy skynet:8080` top-level directive must be converted to `handle { reverse_proxy skynet:8080 { ... } }` because Caddy doesn't allow mixing bare `reverse_proxy` with `handle` blocks in the same site block. This is a minor but required Caddyfile restructuring.

---

## Q6: Skynet's Existing Hostname Configuration

[VERIFIED: live source code in src/backend/distributor/run-bootstrap.ts and local-fleet-install.ts]

**The env var:** `SKYNET_PUBLIC_URL`

- Used today in `run-bootstrap.ts:312` and `local-fleet-install.ts:1370` for writing `~/fleet/host/parent` on managed hosts.
- Format: HTTPS URL without trailing slash (e.g. `https://term.gigaashley.click`).
- Lives in `/opt/skynet/skynet.env` on the deployment host.
- Not validated/required at boot today (processes warn and skip if missing/malformed — no `assertAtBoot` gate).

**Derivation rule for ntfy config:**
- ntfy `base-url`: `${SKYNET_PUBLIC_URL}/ntfy`
- Server address shown in preferences pane: `${SKYNET_PUBLIC_URL}/ntfy`
- URL Skynet backend publishes to (over internal network): `http://ntfy:2586/<topic>`

**The new ntfy-config module** (replacing vapid-config.ts) should read `SKYNET_PUBLIC_URL` at boot and assert it's present and well-formed. This follows the same fail-fast discipline as `assertVapidConfigAtBoot` / `assertBrandingConfigAtBoot`. If `SKYNET_PUBLIC_URL` is missing, ntfy base-url cannot be computed and the preferences pane would show empty server address — appropriate to fail fast.

---

## Q7: Deploy Sequencing for Pure Cutover

The atomic swap for a pure cutover — no dual-transport window — requires this sequence within a single `docker compose up`:

1. **ntfy container starts** (new in compose stack) — ntfy creates its auth.db from config, starts listening on `ntfy:2586`.
2. **Caddy container restarts** (Caddyfile updated) — now routes `/ntfy/*` to ntfy:2586.
3. **Skynet container restarts** (new image) — on boot:
   a. `assertNtfyConfigAtBoot()` (new) passes — publish token env var present.
   b. `migrateSchema()` runs — drops old push_subscriptions table, creates new schema.
   c. Browser-push code entirely absent (deleted in same image).
   d. ntfy-sender.ts module is the new publishing module.

**Schema migration is single-step:** The old `push_subscriptions` table has no data worth preserving (per locked decision: "existing browser-push rows are discarded in the cutover"). The migration is:
1. `DROP TABLE IF EXISTS push_subscriptions` (plus drop the UNIQUE INDEX).
2. `CREATE TABLE IF NOT EXISTS push_subscriptions` with new columns.
3. `CREATE TABLE IF NOT EXISTS ntfy_publish_config` (singleton for publish token + base-url).
4. `DatabaseSaveTrigger.forceSave("phase-144-ntfy-schema")`.

No two-step dance required. The "existing rows are discarded" acceptance from CONTEXT.md makes this straightforward.

**The docker-compose.yml change** adds the `ntfy` service and `ntfy-data` volume. The `caddy` service is unchanged in compose (it reads the Caddyfile from the bind mount, which is updated on the host separately from the repo). The existing forceSave + try/catch pattern applies to all schema mutations.

---

## Q8: Web-Push Deletion Checklist

[VERIFIED: live source code audit]

Complete list of what needs to die:

**npm packages:**
- `web-push` from `dependencies` in package.json
- `@types/web-push` from `devDependencies` in package.json

**Source files to delete entirely:**
- `src/backend/notifications/vapid-config.ts` — VAPID env loader and `assertVapidConfigAtBoot`. Replace with `ntfy-config.ts`.

**Source files to gut or replace:**
- `src/backend/notifications/push-sender.ts` — replace `webpush.sendNotification()` with ntfy HTTP POST. Rename to `ntfy-sender.ts` (or keep the name; planner's discretion).
- `src/backend/database/routes/push-subscriptions.ts` — rebuild for ntfy data model (remove VAPID public key endpoint, remove browser-specific subscription CRUD, add ntfy topic/credential CRUD).
- `src/backend/database/db/schema.ts:904-916` — replace `pushSubscriptions` table definition (drop p256dh, auth; add topic_name, reading_credential_encrypted).
- `src/ui/features/notifications/push-subscription-api.ts` — rebuild for ntfy setup API (GET setup values, POST test, POST regenerate).
- `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` — rebuild (remove browser permission flow, add setup display + test + regenerate buttons).

**Lines to delete in surviving files:**
- `public/sw.js` lines 99-131: `push` event handler (DELETE).
- `public/sw.js` lines 133-178: `notificationclick` handler (DELETE — ntfy iOS app handles its own click routing).
- `public/sw.js` lines 180-244: `pushsubscriptionchange` rotation handler (DELETE).
- `public/sw.js` lines 246-254: `arrayBufferToBase64Url` helper (DELETE — only used by pushsubscriptionchange).
- `src/backend/starter.ts` ~line 17: `import { assertVapidConfigAtBoot }` (DELETE).
- `src/backend/starter.ts` ~line 430-433: `void import("./notifications/push-trigger-starter.js")` — KEEP (trigger loop stays). Update the import to point to the new ntfy-based starter if needed.
- `src/backend/starter.ts` ~line 464-470: `assertVapidConfigAtBoot()` call (DELETE; replace with `assertNtfyConfigAtBoot()` call).
- `src/backend/database/db/index.ts:619-640`: `CREATE TABLE push_subscriptions` + UNIQUE INDEX in top-of-init block (REPLACE with new schema).
- `src/backend/database/db/index.ts:1771-1803`: belt-and-suspenders migration probe for push_subscriptions (REPLACE with new migration that drops old table + creates new).
- `src/backend/database/db/index.ts:1831+`: Phase 128 forceSave comment/call for push_subscriptions (UPDATE label to phase-144).
- `src/backend/database/db/schema.ts:897-916`: `pushSubscriptions` Drizzle export (REPLACE with new schema).
- `src/backend/utils/field-crypto.ts:ENCRYPTED_FIELDS`: Add `push_subscriptions` entry with `Set(["reading_credential"])` for the new encrypted reading credential column.

**Env vars to remove from skynet.env:**
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

**Env vars to add to skynet.env:**
- `NTFY_PUBLISH_TOKEN` — the Skynet-held write-only token (or generated at first boot and stored in DB).

**VAPID-specific test infrastructure:**
- Search for `vapid-config.test.ts`, `push-subscriptions.test.ts` — rebuild or delete test files.
- Search for `push-support.ts` in `src/ui/features/notifications/` (the `pushNotificationsSupported` check) — delete or replace with ntfy equivalent.

---

## Q9: Service Worker Simplification

[VERIFIED: live source code at public/sw.js]

**What sw.js contains today:**
- Lines 1-97: `install`, `activate`, `fetch` event handlers (caching strategy). KEEP entirely.
- Lines 99-131: `push` event handler. DELETE.
- Lines 133-178: `notificationclick` handler. DELETE (taps are handled by the ntfy iOS app, not the browser SW; this handler is dead weight after the push handler is gone).
- Lines 180-244: `pushsubscriptionchange` rotation handler. DELETE.
- Lines 246-254: `arrayBufferToBase64Url` helper function. DELETE (only used by pushsubscriptionchange).
- Lines 256+: `BASE_PATH` constant and `CACHE_NAME` constant at top of file. KEEP (used by caching).

**After deletion:** sw.js contains only `install`, `activate`, `fetch` (cache-first) handlers. No dead code, no stale references.

**The `notificationclick` handler specifically:** CONTEXT.md notes "also delete it (the whole push surface in SW goes away since ntfy pushes land in the ntfy iOS app)." Correct — the `notificationclick` handler fires when the user taps a notification displayed via `showNotification()`. Since `showNotification()` is only called from the `push` handler (being deleted), there are no remaining browser-side notifications to click. The tap action is handled by the ntfy iOS app natively (it opens the `click` URL). The handler is dead weight.

---

## Q10: ntfy Container Image + Resource Footprint

[VERIFIED: hub.docker.com/r/binwiederhier/ntfy — v2.28.0 confirmed to exist]

**Docker image:** `binwiederhier/ntfy:v2.28.0`
- Pin to a specific version tag, not `latest` — same discipline as `guacamole/guacd:1.6.0` in the existing compose stack.

**Container in docker-compose.yml:**
```yaml
  ntfy:
    image: binwiederhier/ntfy:v2.28.0
    container_name: ntfy
    restart: unless-stopped
    volumes:
      - ntfy-data:/var/lib/ntfy
    environment:
      NTFY_BASE_URL: "${SKYNET_PUBLIC_URL}/ntfy"
      NTFY_LISTEN_HTTP: ":2586"
      NTFY_BEHIND_PROXY: "true"
      NTFY_UPSTREAM_BASE_URL: "https://ntfy.sh"
      NTFY_CACHE_FILE: "/var/lib/ntfy/cache.db"
      NTFY_AUTH_FILE: "/var/lib/ntfy/auth.db"
      NTFY_AUTH_DEFAULT_ACCESS: "deny-all"
      # Publish token and per-user tokens injected at container creation
      # from skynet.env. See Q3 for the auth-tokens format.
    command: serve
    networks:
      - skynet-net
    expose:
      - "2586"
```

**Volume:** A single named volume `ntfy-data:/var/lib/ntfy` holds both `cache.db` and `auth.db`. Lives alongside `skynet-data`, `caddy-data`, `synapse-data` — add `ntfy-data` to the `volumes:` block at the bottom of docker-compose.yml.

**Resource footprint:** ntfy is extremely lightweight — single Go binary, < 20MB RAM under normal load, negligible CPU. No resource limits needed.

**No published ports** — the container is on `skynet-net` only; Caddy reaches it via internal DNS (`ntfy:2586`). The container never exposes ports to the host.

**`command: serve`** — required to start the ntfy server (unlike Docker images that default to serving).

---

## Q11: Phase 128 "New + Delete in One Ship" Pattern

[VERIFIED: Phase 128 PLAN files and SUMMARY files in .planning/phases/128-*/]

Phase 128 replaced the Telegram bridge with browser push. The deletion happened in Plan 09 (Wave 4), after the new system (browser push) was fully live (Waves 1-3). The pattern:
1. Waves 1-3: build new system (new tables, new routes, new service worker handlers, new trigger loop).
2. Wave 4: tear down old system in parallel plans (Plan 09: source code deletion; Plan 10: Docker/nginx teardown; both depend on Plan 08 which unmounted the old routes from the running server).
3. Wave 5 (Plan 11): verification sweep.

**The pure-cutover constraint for Phase 144 is tighter** — CONTEXT.md rejects any dual-transport window. The approach:
- Deploy new image: ntfy container + Caddy update + new Skynet image in one `docker compose up`.
- The new Skynet image has ALL browser-push code deleted and ALL ntfy code live. No intermediate state.
- The schema migration (drop + recreate push_subscriptions) happens at boot time in the same new image.
- This is achievable because there's only one Skynet instance affected (the user is her own only subscriber) and zero tolerance for dual-transport is explicitly accepted.

**Implementation shortcut:** Unlike Phase 128's 11-plan structure, Phase 144 does not need a "unmount old routes first" step. Browser-push code and ntfy code touch disjoint files and modules. The whole swap can happen in one set of plans sequenced by dependency — ntfy infra first, then backend swap, then frontend rebuild, then verification.

---

## Q12: ntfy.sh Upstream Reliability Signals

[ASSUMED] ntfy server logs upstream relay failures. When `upstream-base-url` is configured, ntfy logs any failed `poll_request` forwarding attempts to stdout (Docker logs). The Skynet operator can inspect these via `docker logs ntfy`.

ntfy v2.28.0's log output includes structured JSON (if configured) or plain text. A failed upstream relay attempt does not cause the local publish to fail — the message is stored locally and served to direct subscribers; only the iOS wake-up fails. This is the right behavior per the locked "fire-and-forget" posture.

**Operational signal:** `docker logs ntfy 2>&1 | grep -i "upstream\|poll_request\|relay"` — this is the manual triage command. No automated monitoring is in scope for Phase 144.

---

## Architecture Patterns

### System Architecture Diagram

```
[Matrix homeserver]
       |
       | (2s poll per user, harness_dm filter)
       v
[push-trigger-loop.ts]  ──────────────────────────────────────────────────────
       |                                                                        |
       | sendPushToUser(userId, {title, body, agentMxid, agentHostId})         |
       v                                                                        |
[ntfy-sender.ts]                                                               |
  HTTP POST http://ntfy:2586/<topic>                                           |
  Headers: Authorization: Bearer <publish-token>                               |
           Title: <agent-display-name>                                         |
           Click: /?openHarness=<mxid>&host=<hostId>                          |
  Body: <preview-text>                                                         |
       |                                                                        |
       v                                                                        |
[ntfy container :2586] ── internal Docker network (skynet-net)                 |
       |                                                                        |
       |── stores message in cache.db                                           |
       |                                                                        |
       |── sends poll_request (msgId + topicHash) ──> [ntfy.sh upstream relay]
       |                                                      |
       |                                                      | Apple APNs
       |                                                      v
       |                                              [iOS device wake-up]
       |                                                      |
       |<───── phone fetches actual message content ──────────
       v
[ntfy iOS app] displays notification; tap → opens /?openHarness=...&host=...
       |
       v
[Skynet PWA / browser] → deep-link parser → opens harness for that agent

---

[Browser / PreferencesNotificationsPane.tsx]
  GET /ntfy-setup → backend returns {serverAddress, topicName, readingCredential}
  POST /ntfy-test → backend posts test message to ntfy
  POST /ntfy-regenerate → backend rotates reading credential
       |
       v
[push-subscriptions.ts routes (rebuilt)]
  reads/writes push_subscriptions table (new schema)
  FieldCrypto.encryptField for reading_credential column
```

### Recommended Project Structure

```
src/backend/notifications/
├── push-trigger-loop.ts      KEEP — unchanged
├── push-trigger-starter.ts   KEEP — unchanged (or minor update for ntfy)
├── push-sender.ts            REPLACE — webpush → ntfy HTTP POST
├── ntfy-config.ts            NEW — replaces vapid-config.ts
├── vapid-config.ts           DELETE
├── preview-text.ts           KEEP
└── resolve-agent-display-name.ts  KEEP

src/backend/database/routes/
└── push-subscriptions.ts     REBUILD — ntfy data model, no VAPID endpoint

src/backend/database/db/
├── schema.ts                 PATCH — push_subscriptions new columns
└── index.ts                  PATCH — drop old / create new migration

src/ui/features/notifications/
├── push-subscription-api.ts  REBUILD — ntfy setup API calls
├── push-support.ts           DELETE or repurpose
└── open-harness-deep-link.ts KEEP

src/ui/features/pretty-view/
└── PreferencesNotificationsPane.tsx  REBUILD

public/sw.js                  PATCH — delete push + rotation + click handlers

docker/docker-compose.yml     PATCH — add ntfy service + ntfy-data volume
/opt/skynet/caddy-config/Caddyfile  PATCH — handle_path /ntfy/* block
/opt/skynet/skynet.env        PATCH — remove VAPID vars, add NTFY_PUBLISH_TOKEN
```

### Pattern 1: ntfy-config.ts — Boot-time Assert (mirrors vapid-config.ts)

```typescript
// Source: mirrors assertVapidConfigAtBoot discipline from vapid-config.ts
// + assertBrandingConfigAtBoot from branding/assert-boot.ts

export function assertNtfyConfigAtBoot(): void {
  const publicUrl = (process.env.SKYNET_PUBLIC_URL ?? "").trim();
  if (!publicUrl || !publicUrl.startsWith("https://")) {
    throw new Error(
      "SKYNET_PUBLIC_URL env var is missing or not an HTTPS URL. " +
      "Set it in skynet.env before boot (e.g. https://term.gigaashley.click). " +
      "ntfy base-url cannot be derived without it."
    );
  }
  systemLogger.info("[ntfy] config loaded", {
    operation: "ntfy_config_boot_loaded",
    baseUrl: `${publicUrl}/ntfy`,
  });
}

export function getNtfyBaseUrl(): string {
  return `${(process.env.SKYNET_PUBLIC_URL ?? "").trim()}/ntfy`;
}

export function getNtfyInternalPublishUrl(): string {
  return "http://ntfy:2586";  // internal Docker network, never traverses public internet
}
```

### Pattern 2: ntfy-sender.ts — Replace webpush.sendNotification

```typescript
// Source: mirrors push-sender.ts never-throws contract + databaseLogger.warn shape
// New: single HTTP POST replaces Promise.all over multiple subscription rows

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,   // same interface — title, body, agentMxid, agentHostId
): Promise<void> {
  // Read user's topic from push_subscriptions (one row per user now)
  const row = db.$client
    .prepare("SELECT topic_name FROM push_subscriptions WHERE user_id = ?")
    .get(userId) as { topic_name: string } | undefined;

  if (!row) return;  // silent no-op: user hasn't set up ntfy yet

  const publishToken = getPublishToken();  // from ntfy-config.ts / env
  const clickUrl = buildClickUrl(payload.agentMxid, payload.agentHostId);
  const topicUrl = `${getNtfyInternalPublishUrl()}/${encodeURIComponent(row.topic_name)}`;

  try {
    const response = await fetch(topicUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${publishToken}`,
        "Title": payload.title,
        "Click": clickUrl,
        "Content-Type": "text/plain",
      },
      body: payload.body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      databaseLogger.warn("[ntfy] publish failed", {
        operation: "ntfy_publish_failed",
        userId,
        statusCode: response.status,
      });
    }
  } catch (err) {
    // Matches existing push-sender.ts never-throws posture (T-128-09)
    databaseLogger.warn("[ntfy] publish threw", {
      operation: "ntfy_publish_threw",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
```

### Pattern 3: Schema Migration — Drop + Recreate push_subscriptions

```typescript
// Source: mirrors runTelegramBotTokensTableDrop + migrateSchema pattern in db/index.ts

export function runPushSubscriptionsRebuild(sqliteDb: Database.Database): void {
  try {
    // Drop UNIQUE INDEX first (SQLite requires explicit drop before table drop
    // when the index is a separate CREATE UNIQUE INDEX, not an inline constraint).
    sqliteDb.exec("DROP INDEX IF EXISTS push_subscriptions_user_endpoint_unique;");
    sqliteDb.exec("DROP TABLE IF EXISTS push_subscriptions;");
  } catch (dropErr) {
    databaseLogger.warn("[phase-144] push_subscriptions drop failed (non-fatal)", {
      operation: "schema_migration_drop_table",
      table: "push_subscriptions",
      error: dropErr,
    });
  }
  // New schema: one row per user (topic_name + encrypted reading credential)
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        topic_name TEXT NOT NULL UNIQUE,
        reading_credential TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
    `);
  } catch (createErr) {
    databaseLogger.warn("[phase-144] push_subscriptions rebuild failed", {
      operation: "schema_migration_create_table",
      table: "push_subscriptions",
      error: createErr,
    });
  }
}
```

**Important schema changes:**
- `UNIQUE(user_id)` replaces `UNIQUE(user_id, endpoint)` — one row per user, not per device.
- `topic_name UNIQUE` — each topic is globally unique (unguessable random string; collision probability negligible with 32-char hex).
- `reading_credential` — bcrypt-hashed? No — stores the plaintext credential encrypted via FieldCrypto (the backend needs to surface it to the user in the preferences pane; bcrypt is one-way). Add `push_subscriptions: Set(["reading_credential"])` to FieldCrypto's `ENCRYPTED_FIELDS`.
- Drop `p256dh`, `auth`, `endpoint`, `last_delivered_at` columns — all browser-push-specific.

### Pattern 4: Credential Generation

```typescript
// Source: mirrors api-key-routes.ts:88 "tmx_" + randomBytes(32).toString("hex")
//         and identity-birth-orchestrator.ts:675 randomBytes(24).toString("hex")

import { randomBytes } from "node:crypto";

// Topic name: opaque 32-char hex string (128-bit entropy)
export function generateTopicName(): string {
  return randomBytes(16).toString("hex");  // e.g. "a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6"
}

// ntfy access token: "tk_" prefix + 28 hex chars (112-bit entropy after prefix)
// ntfy expects tokens exactly 32 chars starting with "tk_" (3 + 29 = 32 total).
// Use hex encoding: 29 hex chars = randomBytes(15) → 30 hex chars (trim to 29) — simpler:
// use randomBytes(16).toString("hex").slice(0, 29) → 29 hex chars after "tk_" = 32 total.
export function generateNtfyToken(): string {
  return "tk_" + randomBytes(16).toString("hex").slice(0, 29);
  // Result: "tk_" (3) + 29 hex chars = 32 chars total — matches ntfy's requirement
}
```

**Note:** ntfy token format per docs: must start with `tk_` and be exactly 32 characters. The above generates compliant tokens with ~112-bit entropy.

### Anti-Patterns to Avoid

- **Don't hard-code `term.gigaashley.click`** — all URLs derive from `SKYNET_PUBLIC_URL`. The no-hardcoding posture is enforced by the `no-personal-strings.test.ts` grep gate already in the codebase.
- **Don't use a subdomain for ntfy** — the locked decision explicitly rejects this (no new DNS, no new TLS cert).
- **Don't pass message content through ntfy.sh** — the upstream relay receives only message ID + topic hash. Title and body go in the POST to the local ntfy container only. The `upstream-base-url` configuration handles this correctly by design — ntfy.sh only gets the poll_request, not the content.
- **Don't use bcrypt one-way hash for the reading credential** — the backend must be able to surface the plaintext credential to the user in the preferences pane. Use FieldCrypto (reversible AES-256-GCM) for the reading_credential column.
- **Don't call ntfy CLI at runtime** — use declarative `auth-users` + `auth-tokens` in server config. Container restart syncs auth.db.
- **Don't forget `command: serve`** in the ntfy Docker service — the image doesn't serve by default.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iOS push certificate handling | custom APNs integration | ntfy.sh upstream relay (built into ntfy) | APNs cert is held by ntfy project; building your own iOS app was explicitly rejected |
| HTTP auth for ntfy | custom auth middleware | ntfy's built-in auth-users/auth-tokens system | ntfy handles user DB, ACL, token lifecycle |
| WebSocket upgrade in Caddy | manual Upgrade/Connection headers | Caddy `reverse_proxy` (auto-handles WS) | Caddy proxies WS automatically; nginx needs explicit headers |
| Token generation | UUID or incrementing IDs | `randomBytes(16).toString("hex")` from node:crypto | Already used in codebase; correct entropy for unguessable tokens |
| Field encryption | custom cipher | FieldCrypto.encryptField / decryptField | Already in codebase; established pattern for reversible credential storage |

---

## Common Pitfalls

### Pitfall 1: ntfy Web App Breaks at Path Prefix (Web UI — Not iOS App)
**What goes wrong:** ntfy's web UI (the browser SPA bundled with the server) breaks when `base-url` contains a path component like `/ntfy`. The web app interprets its URL path as a topic name.
**Why it happens:** ntfy's web app is built for root-level deployment. GitHub issue #1009 confirms this is a known limitation, not a bug fix scheduled for release.
**How to avoid:** Do not expose ntfy's web UI. The `web-root` config can be set to an empty directory, or the web UI can be ignored entirely — Skynet's preferences pane is the only management surface needed. iOS app users subscribe via the ntfy iOS app, not the web UI. The publishing API and iOS app API (JSON/SSE/poll endpoints) work correctly with path-prefix stripping.
**Warning signs:** User navigates to `https://term.gigaashley.click/ntfy` in a browser and sees garbage. This is expected and not a bug in the Skynet implementation.

### Pitfall 2: Caddy handle vs bare reverse_proxy Conflict
**What goes wrong:** Adding `handle_path /ntfy/* { reverse_proxy ntfy:2586 }` to a site block that also has a bare `reverse_proxy skynet:8080` causes a Caddy config parse error. Caddy doesn't allow mixing bare directives with `handle`/`handle_path` blocks.
**Why it happens:** The existing Caddyfile has `reverse_proxy skynet:8080` as a top-level directive. Adding `handle_path` requires converting the whole site to use `handle` blocks.
**How to avoid:** Wrap the existing `reverse_proxy skynet:8080 { transport ... }` in a `handle { ... }` block (or `handle_path /* { ... }` for explicit path matching). Both the ntfy `handle_path /ntfy/*` and the Skynet `handle { ... }` fallback must coexist in the same site block.

### Pitfall 3: ntfy Token Format Violated
**What goes wrong:** Token that doesn't start with `tk_` or isn't exactly 32 chars is rejected by ntfy with "token too short" or similar error.
**Why it happens:** ntfy enforces a specific token format per its source code.
**How to avoid:** Always generate tokens as `"tk_" + randomBytes(16).toString("hex").slice(0, 29)` (exactly 32 chars).

### Pitfall 4: SKYNET_PUBLIC_URL Not Set at ntfy Container Start
**What goes wrong:** `NTFY_BASE_URL` resolves to `"/ntfy"` (no hostname) if `SKYNET_PUBLIC_URL` is unset when compose interpolates env vars. ntfy starts but iOS upstream relay sends malformed poll_request URLs.
**Why it happens:** Docker compose interpolates `${SKYNET_PUBLIC_URL}` at config-parse time. If not in the environment when `docker compose up` runs, the variable is empty.
**How to avoid:** Add ntfy's `base-url` assertion to `assertNtfyConfigAtBoot()` in starter.ts. Also use the same fail-loud guard pattern as `SKYNET_HOME_MOUNT_SRC` in docker-compose.yml: `${SKYNET_PUBLIC_URL:?SKYNET_PUBLIC_URL must be set — ...}`.

### Pitfall 5: bcrypt Hashes in docker-compose.yml YAML Need `$$` Escaping
**What goes wrong:** Bcrypt hashes contain `$` characters (e.g., `$2a$10$...`). Docker compose YAML interprets `$` as the start of a variable interpolation and silently corrupts the hash.
**Why it happens:** Compose variable substitution is `$VAR` or `${VAR}`. A bare `$2a` is treated as a variable reference, substituted with empty string.
**How to avoid:** Use `$$` to escape each `$` in bcrypt hashes: `$$2a$$10$$...`. The official ntfy docs mention this explicitly. Since Skynet generates tokens programmatically (not bcrypt passwords for the backend-facing admin credential), this pitfall only applies if bcrypt passwords are used. Prefer token-based auth (`auth-tokens`) over password-based auth for Skynet's publish credential — tokens don't contain `$`.

### Pitfall 6: `push_subscriptions` DROP Not Followed by forceSave
**What goes wrong:** Schema drop happens in RAM. If container restarts before an unrelated write fires the debounced save, the old schema survives in the encrypted DB and the next boot re-runs the migration (idempotent, but confusing).
**Why it happens:** Skynet's SQLite is in-memory with deferred disk sync via `DatabaseSaveTrigger`. Every schema mutation must be followed by `forceSave`.
**How to avoid:** Wrap the DROP + CREATE in `runPushSubscriptionsRebuild` and call `DatabaseSaveTrigger.forceSave("phase-144-ntfy-schema")` immediately after in `migrateSchema`. Same pattern as every prior schema migration in db/index.ts.

### Pitfall 7: Trailing Slash in ntfy base-url
**What goes wrong:** ntfy's upstream relay constructs poll_request URLs with a trailing slash doubling: `https://term.gigaashley.click/ntfy//topic`. iOS app polling breaks.
**Why it happens:** GitHub issue #370 documents this: trailing slash in `base-url` causes doubled slashes in downstream URL construction.
**How to avoid:** Ensure `SKYNET_PUBLIC_URL` has no trailing slash (it doesn't today per existing convention) and the derivation is `${SKYNET_PUBLIC_URL}/ntfy` (not `${SKYNET_PUBLIC_URL}/ntfy/`).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegram bridge (Skynet Phase 1-127) | Browser Web Push (Phase 128) | 2026-09-21 | Replaced with native push |
| Browser Web Push (Phase 128) | ntfy self-hosted (Phase 144) | This phase | Replaces rotting iOS PWA subscriptions with native iOS app delivery |
| Declarative ntfy config via CLI commands | Declarative via `auth-users` + `auth-tokens` in server.yml | ntfy v2.x | Eliminates need for runtime docker exec during provisioning |

**Deprecated in this phase:**
- `web-push@3.6.7`: removed entirely. No replacement npm package — plain `fetch` suffices.
- VAPID key infrastructure: deleted. No ntfy analog needed.
- Browser push subscription rotation (`pushsubscriptionchange` SW handler): deleted. ntfy iOS app manages its own subscription lifecycle.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ntfy iOS app supports path-prefix server URLs (e.g., `https://term.gigaashley.click/ntfy`) at the networking level — the app constructs `baseUrl + "/" + topic` | Q4, Q5, Pitfall 1 | LOW — verified directly from ntfy-ios Helpers.swift source code. The app uses `normalizeBaseUrl` (strip trailing slashes) + append topic. Caddy stripping the prefix is the correct pairing. |
| A2 | ntfy.sh upstream relay reliability is sufficient for Ashley's use case | Q12 | MEDIUM — ntfy.sh is a free public service. If it goes down, iOS wake-up pushes fail but direct subscribers still work. Accepted risk per shape. |
| A3 | ntfy logs upstream relay failures to stdout/stderr | Q12 | LOW — standard Go HTTP client behavior; confirmed as LOW by general knowledge. Not verified against ntfy source. |
| A4 | `SKYNET_PUBLIC_URL` is already set in `/opt/skynet/skynet.env` on the live deployment | Q6 | LOW — confirmed used in run-bootstrap.ts; would fail distributor bootstrap if absent. But worth verifying at deploy time. |
| A5 | ntfy v2.28.0 Docker image passes a slopsquat check | Q10 | LOW — confirmed at hub.docker.com/r/binwiederhier/ntfy; official project with 4+ years history and active GitHub repo (github.com/binwiederhier/ntfy). |

**If this table had been empty:** all claims would be fully verified — but A2/A3 rely on accepted-risk posture and general knowledge respectively.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | ntfy container deployment | ✓ | 29.5.0 | — |
| Caddy | Path-prefix routing | ✓ | Running in compose stack | — |
| `SKYNET_PUBLIC_URL` env var | ntfy base-url derivation | ✓ (assumed) | — | Assert at boot; fail loudly |
| ntfy.sh (external) | iOS wake-up relay | ✓ (external service) | — | Accepted risk; iOS pushes fail if ntfy.sh is down; direct subscribers unaffected |
| Node.js `fetch` API | ntfy HTTP POST from backend | ✓ | Built-in (Node 18+) | — |
| `randomBytes` from node:crypto | Credential/topic generation | ✓ | Built-in | — |
| `FieldCrypto` (src/backend/utils/field-crypto.ts) | Encrypt reading credential at rest | ✓ | In codebase | — |

**Missing dependencies with no fallback:** None.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | ntfy token-based auth (`Bearer tk_...`); admin role for publisher, user+ACL for reader |
| V3 Session Management | no | ntfy tokens are long-lived credentials, not session tokens; rotation via regenerate button |
| V4 Access Control | yes | admin role = write all topics; user role + ro ACL = read own topic only; publish credential never distributed |
| V5 Input Validation | yes | Zod validation on ntfy setup endpoints (topic name, credential format); same discipline as existing push-subscriptions.ts |
| V6 Cryptography | yes | FieldCrypto (AES-256-GCM) for reading credential at rest; randomBytes (CSPRNG) for token generation |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Publish credential leaked to agent context | Information Disclosure | Publish token read from env/DB by backend only; never passed to any API response or agent context |
| Reading credential stored in plaintext | Information Disclosure | FieldCrypto.encryptField on `reading_credential` column in push_subscriptions |
| Content leaking through ntfy.sh | Information Disclosure | ntfy.sh only receives message ID + topic hash (protocol design); body/title never in upstream poll_request |
| Topic enumeration / unguessable requirement | Elevation of Privilege | Topic names are randomBytes(16).toString("hex") — 128-bit entropy, unguessable |
| VAPID keys left as dead env vars | Information Disclosure (minor) | Deletion checklist (Q8) removes VAPID vars from skynet.env at deploy time |
| Old push_subscriptions rows surviving in DB | Data Residue | Schema migration drops + recreates the table; forceSave persists the change |

---

## Sources

### Primary (HIGH confidence)
- `docs.ntfy.sh/config/` — ntfy server configuration: base-url, listen-http, upstream-base-url, behind-proxy, auth-users, auth-tokens, auth-default-access, cache-file, auth-file [VERIFIED]
- `docs.ntfy.sh/publish/` — ntfy HTTP publish API: POST URL structure, Authorization header, Title/Click headers, JSON vs header approach [VERIFIED]
- `docs.ntfy.sh/config/#ios-instant-notifications` — upstream relay privacy model (poll_request contains msgId + topic hash only) [VERIFIED]
- `docs.ntfy.sh/config/#users-and-roles` — ntfy token format (tk_ prefix, 32 chars), token generation, ACL commands [VERIFIED]
- `docs.ntfy.sh/config/#static-user-and-token-configuration` — declarative auth-users + auth-tokens config; Docker-native provisioning [VERIFIED]
- `github.com/binwiederhier/ntfy-ios` — SubscriptionAddView.swift: exact iOS subscription dialog fields (topic, use-another-server toggle, baseUrl); Helpers.swift: `topicUrl` = `normalizeBaseUrl(baseUrl) + "/" + topic` [VERIFIED: via gh API]
- Live codebase: `src/backend/distributor/run-bootstrap.ts`, `local-fleet-install.ts` — `SKYNET_PUBLIC_URL` env var as the existing public hostname signal [VERIFIED]
- Live codebase: `public/sw.js` — lines 99-244 confirmed as the push/click/rotation handlers to delete [VERIFIED]
- Live codebase: `src/backend/notifications/push-sender.ts`, `vapid-config.ts`, `push-subscriptions.ts`, `schema.ts:904-916` — confirmed current state of what's being replaced [VERIFIED]
- Live codebase: `docker/docker-compose.yml` — existing service structure, volume naming convention, network name [VERIFIED]
- Live codebase: `/opt/skynet/caddy-config/Caddyfile` — confirmed current Caddyfile structure; no existing `handle_path` blocks [VERIFIED]
- Live codebase: `src/backend/utils/field-crypto.ts` — FieldCrypto.encryptField / ENCRYPTED_FIELDS map for adding push_subscriptions entry [VERIFIED]

### Secondary (MEDIUM confidence)
- `hub.docker.com/r/binwiederhier/ntfy` — Docker image tags: v2.28.0, v2.28, v2, latest confirmed [VERIFIED via Docker Hub API]
- `github.com/binwiederhier/ntfy/issues/398` — path prefix requires proxy to strip prefix; ntfy does not natively handle subpath [VERIFIED via WebFetch]
- `github.com/binwiederhier/ntfy/issues/1009` — ntfy web UI at subpath is broken / feature-request-level support [VERIFIED via WebFetch]
- `docs.ntfy.sh/config/#caddy` — Caddy `reverse_proxy` syntax for ntfy; no explicit path-stripping example [VERIFIED via WebFetch]

### Tertiary (LOW confidence — general knowledge / not verified against official ntfy docs)
- ntfy logs upstream relay failures to stdout [ASSUMED — A3]
- ntfy.sh service is sufficiently reliable for Ashley's use case [ASSUMED — A2, accepted risk per shape]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — ntfy docs read directly; Docker image confirmed; no new npm packages
- Architecture: HIGH — live Caddyfile, live docker-compose.yml, and ntfy-ios source code verified
- Pitfalls: HIGH — path-prefix issue confirmed via GitHub issues; bcrypt escaping confirmed in docs; token format confirmed in docs
- iOS app behavior: HIGH — verified from ntfy-ios Swift source (SubscriptionAddView.swift + Helpers.swift)
- Credential encryption: HIGH — FieldCrypto already in codebase and pattern established

**Research date:** 2026-10-02
**Valid until:** 2026-11-02 (ntfy is mature/stable; iOS app behavior unlikely to change; 30-day horizon)
