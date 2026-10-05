# Phase 144 — upgrade guide for downstream Skynet instances

**Audience:** operators of Skynet instances OTHER than the one that shipped
this phase (e.g. Morgan on host-c / acme-cloud).

**What this phase does:** replaces the browser-push notification system with
self-hosted ntfy. Push notifications go through the ntfy iOS app via
Apple's push infrastructure (via the ntfy.sh wake-up relay). The browser
push-handler, VAPID keys, and `push_subscriptions` schema are all deleted.
Pure cutover.

**Why your instance needs operator action:** this phase introduces three
new pieces of infrastructure that each instance must provision on its own
side — a dedicated DNS record for ntfy, a new ntfy container inside the
compose stack, and five new env vars in your `skynet.env`. Without these,
the Skynet backend will refuse to start (fail-fast boot gate) and ntfy
will crash-loop (missing config). This guide walks the full checklist.

---

## 1. Add a DNS record (or tailnet hostname) for your ntfy subdomain

ntfy refuses to run on a sub-path — it must live at its own hostname. The
hostname only needs to be reachable from (a) your users' phones and
(b) outbound to ntfy.sh for the iOS wake-up relay. The ntfy server does
NOT need inbound reachability from the open internet.

**For instances with publicly reachable users:** pick a subdomain
(e.g. `push.your-domain.com`), add an A-record to your Skynet host's
public IP. Caddy will issue a Let's Encrypt certificate automatically on
first request via HTTP-01 — no manual cert work. Wait for DNS
propagation (`dig +short push.your-domain.com @8.8.8.8` returns the IP)
before continuing.

**For tailnet-only instances** (users only reach Skynet via Tailscale):
since those users already have Tailscale on their phone (otherwise they
can't reach the app at all), the ntfy server can live on a `.ts.net`
hostname with a Tailscale-provisioned cert — no public DNS record, no
Let's Encrypt. Steps:

1. Pick a tailnet hostname: `push-<instance>.<your-tailnet>.ts.net`.
2. Run `tailscale cert push-<instance>.<your-tailnet>.ts.net` on the host
   to provision the TLS cert (Tailscale auto-renews; cert files land in
   `/var/lib/tailscale/certs/` or similar depending on your setup).
3. Point your Caddy site block at the `.ts.net` hostname (same shape as
   the public setup, just the hostname differs) and configure Caddy to
   use the Tailscale-provisioned cert files directly (or route the
   traffic through `tailscale serve` as a reverse-proxy if that's
   simpler for your setup).
4. Users point the ntfy iOS app at the `.ts.net` URL. Content fetch
   travels tailnet; the APNs wake-up still goes out through ntfy.sh over
   the public internet (same metadata-visible-to-ntfy.sh tradeoff as
   the public setup — no way around this on iOS without building a
   native app).

**For hybrid instances** (some users via public domain, some via
tailnet): either run two ntfy deploys (one per hostname, each with its
own `NTFY_PUBLIC_URL` — not currently supported by the single-container
layout, would need a code change) OR pick one path and ask the
other-side users to switch (install Tailscale, or use the public
domain). Simpler: pick one path.

---

## 2. Generate ntfy credentials

On a trusted machine (or on the Skynet host directly), generate the four
credential values:

```sh
# Pick a username — any opaque string.
NTFY_ADMIN_USER=skynet-admin

# Generate a strong random password (keep server-side; needed for HTTP Basic auth).
NTFY_ADMIN_PASS=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)

# Bcrypt-hash the password for the auth-users config.
# Needs python-bcrypt OR htpasswd OR docker.
NTFY_ADMIN_PASS_BCRYPT=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt(rounds=10)).decode())" "$NTFY_ADMIN_PASS")
# or: NTFY_ADMIN_PASS_BCRYPT=$(htpasswd -nbBC 10 x "$NTFY_ADMIN_PASS" | cut -d: -f2)
# or: NTFY_ADMIN_PASS_BCRYPT=$(docker run --rm binwiederhier/ntfy:v2.28.0 user hash "$NTFY_ADMIN_PASS" | awk -F '"' '{print $2}')

# Generate the publishing bearer token. ntfy requires format: tk_ + 29 chars = 32 total.
NTFY_PUBLISH_TOKEN="tk_$(openssl rand -hex 15 | head -c 29)"
```

**Important: keep the plaintext `NTFY_ADMIN_PASS`.** Skynet's backend uses
it for HTTP Basic auth against the ntfy admin API. Lose it and you have
to regenerate from scratch.

---

## 3. Add env vars to your `skynet.env`

Append this block to your instance's `/opt/skynet/skynet.env` (or
wherever your deployment reads env from). Fill in the generated values.

```env
# Phase 144 — ntfy push notifications
NTFY_PUBLIC_URL=https://push.your-domain.com
NTFY_ADMIN_USER=skynet-admin
NTFY_ADMIN_PASS=<the-plaintext-password-you-generated>
NTFY_ADMIN_PASS_BCRYPT=<the-bcrypt-hash-you-generated>
NTFY_PUBLISH_TOKEN=<tk_...>
```

**Quote `NTFY_ADMIN_PASS` and `NTFY_ADMIN_PASS_BCRYPT` with single quotes**
if either contains `$` or special shell characters (bcrypt hashes DO
contain `$` separators). Example:

```env
NTFY_ADMIN_PASS='the$cret-password'
NTFY_ADMIN_PASS_BCRYPT='$2b$10$abcdef...'
```

---

## 4. Add `NTFY_PUBLIC_URL` to your compose-interpolation env file

If your instance uses a separate file for docker-compose-time variable
interpolation (on host-b that's `/opt/skynet/.env`, distinct from
`skynet.env` which is the container runtime env), also add `NTFY_PUBLIC_URL`
there. The ntfy service's `environment:` block in `docker-compose.yml`
uses `${NTFY_PUBLIC_URL:?...}` which is resolved at config-parse time
against the `--env-file` passed to `docker compose build` and `up`.

```env
# /opt/skynet/.env — compose-time interpolation
NTFY_PUBLIC_URL=https://push.your-domain.com
```

If your instance only uses one env file for both purposes, make sure the
file you pass as `--env-file` to compose has `NTFY_PUBLIC_URL` set.

---

## 5. Add the Caddy site block for your ntfy subdomain

The committed snippet at
`docker/caddy-config/Caddyfile.ntfy-additions.snippet` documents the
required Caddy site block. Append the equivalent block (with your real
subdomain) to your instance's live Caddyfile at
`/opt/skynet/caddy-config/Caddyfile` (or wherever Caddy reads config):

```caddy
push.your-domain.com {
    log { format json; output stdout }
    reverse_proxy ntfy:2586
}
```

Caddy will issue the Let's Encrypt cert on first request. No prior cert
work needed. The existing Skynet site block is unchanged — ntfy lives on
its own hostname, no restructuring required.

Validate the Caddyfile before reloading:

```sh
sudo docker exec caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 6. Pull, build, and recreate

Standard deploy flow:

```sh
cd ~/skynet-<your-identity>
git pull --rebase origin feat/tab-title-from-tmux

# Build (needs both env files on host-b — adjust for your instance if you
# only have one).
sudo -E docker compose --env-file /opt/skynet/.env --env-file /opt/skynet/skynet.env \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.host-systemd.override.yml \
  build

# Force-recreate all services (ntfy container is new; env change requires
# recreate for the Skynet backend).
sudo -E docker compose --env-file /opt/skynet/.env --env-file /opt/skynet/skynet.env \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.host-systemd.override.yml \
  up -d --force-recreate --remove-orphans
```

Note: the `docker-compose.host-systemd.override.yml` flag may not apply
to your instance (it's host-b-specific host-systemd integration). Drop it
if your instance's compose doesn't need it.

---

## 7. Verify the deploy

**ntfy container up:**

```sh
sudo docker ps --filter name=ntfy --format "table {{.Names}}\t{{.Status}}"
# expect: ntfy Up N seconds
```

If `Restarting`, check `sudo docker logs ntfy` — most likely cause is a
missing or malformed env var, or Caddy hasn't issued the cert yet.

**ntfy health endpoint:**

```sh
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://push.your-domain.com/v1/health
# expect: HTTP 200
```

**ntfy admin user exists (Basic auth as admin):**

```sh
sudo docker exec ntfy wget -qO- --header="Authorization: Basic $(printf '%s:%s' <NTFY_ADMIN_USER> <NTFY_ADMIN_PASS> | base64)" http://localhost:2586/v1/users
# expect: [{"username":"<NTFY_ADMIN_USER>","role":"admin"},{"username":"*","role":"anonymous"}]
```

**Skynet backend loaded ntfy config:**

```sh
sudo docker logs skynet 2>&1 | grep ntfy_config_boot_loaded
# expect: [ntfy] config loaded [op:ntfy_config_boot_loaded,baseUrl:https://push.your-domain.com]
```

---

## 8. Set up your phone (user-side action)

Each user on your instance who wants notifications:

1. Install the **ntfy** app from the App Store (free).
2. In Skynet, open **Preferences → Notifications**.
3. Tap **Set up notifications**. Skynet backend provisions a per-user
   ntfy account + topic; the pane displays four values:
   - Server address (e.g. `https://push.your-domain.com`)
   - Topic name (an opaque per-user string)
   - ntfy username (`skynet-reader-<user-id>`)
   - ntfy password (a 32-char hex, encrypted at rest server-side)
4. In the ntfy iOS app, add the subscription:
   1. Tap the **+** button in the upper-right.
   2. Enter the **topic name** (first field on this screen).
   3. Turn on the **Use another server** switch — this reveals a
      "server" field below it.
   4. Enter the **server address** in the server field.
   5. Tap **Subscribe** in the upper-right. This advances to a login
      screen (the topic's ACL requires auth).
   6. Enter the **ntfy username** and **ntfy password**.
   7. Tap the confirm button in the upper-right to finish.
5. Back in Skynet, tap **Send test notification**. Your phone should
   buzz.

ntfy iOS uses HTTP Basic auth on the login screen — the username +
password shown in the pane are what it wants there. Phase 144 originally
tried to surface a single bearer token, which the iOS login screen does
not accept; Phase 145 replaced it with the username+password pair.

If the test doesn't buzz, run through section 7's verifications on your
end first, then check iOS notification settings for the ntfy app.

> **Phase 145 migration note:** any existing `push_subscriptions` rows
> from an earlier Phase 144 build are dropped on upgrade — those stored
> `tk_...` tokens aren't useful under the new Basic-auth flow. Users
> re-click **Set up notifications** once to re-provision.

---

## 9. Deletion checklist (what came out)

For reference — the following are REMOVED from Skynet in Phase 144.
If your instance has any monitoring or integration pointing at these,
update it:

- `web-push` and `@types/web-push` npm dependencies (removed from `package.json`)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env vars (safe to
  remove from your `skynet.env` after this deploy — nothing reads them anymore)
- `src/backend/notifications/vapid-config.ts` and its test (deleted)
- `src/backend/notifications/push-sender.ts` shim (deleted)
- `src/ui/features/notifications/push-subscription-api.ts` + `push-support.ts` (deleted)
- `GET /push-subscriptions/vapid-public-key` route (deleted)
- `public/sw.js` `push`, `pushsubscriptionchange`, `notificationclick` handlers (deleted)
- `push_subscriptions` table columns `endpoint`, `p256dh`, `auth`
  (replaced by `topic_name`, `ntfy_username`, `reading_credential`).
  Existing rows are dropped at the schema migration — any users previously
  subscribed to browser push lose their subscription and must set up ntfy fresh.

---

## 10. Known gotchas

- **ntfy's YAML config loader does NOT interpolate `${VAR}` syntax.** The
  committed `docker/ntfy/server.yml` is a template with `${NTFY_ADMIN_USER}`,
  `${NTFY_ADMIN_PASS_BCRYPT}`, `${NTFY_PUBLISH_TOKEN}` placeholders in the
  `auth-users` and `auth-tokens` sections. The ntfy service's compose
  `command:` block renders the template via `sed` at container boot and
  execs `ntfy serve --config /tmp/ntfy-server.yml`. If you customize
  the compose, keep this entrypoint logic — otherwise ntfy starts with
  literal `${VAR}` strings in its auth tables.
- **The ntfy iOS app has no QR scanner.** The setup pane shows the three
  values for manual entry; there is no deep-link bootstrap.
- **ntfy.sh is a required third-party relay for iOS wake-ups.** When your
  self-hosted server receives a message, it sends a wake-up signal (message
  ID + topic hash — NO content) upstream to ntfy.sh, which pushes to Apple's
  push infrastructure. Content stays on your server; metadata is visible to
  ntfy.sh. iOS push reliability couples to ntfy.sh uptime.
- **The ntfy container has no published host port.** It's only reachable
  via the Caddy edge over your public hostname + via the internal
  `skynet-net` Docker network from the Skynet backend. Don't try to
  `curl localhost:2586` from the host — it won't work.
- **The publish token lives only in env, not in a DB table.** If you
  rotate it, change `NTFY_PUBLISH_TOKEN` in `skynet.env`, update the
  bcrypt-hashed admin password's `auth-tokens` entry in server.yml if
  needed, and restart the ntfy container to re-sync auth.db from the
  updated server.yml template.

---

## Questions?

Ping twister-box-maintainer on host-b or open an issue referencing
Phase 144. Shape file at `.planning/shapes/shape-ntfy-notifications.md`;
full implementation detail in the plans + SUMMARY.md artifacts under
`.planning/phases/144-ntfy-based-durable-notifications-replacing-browser-push-see-/`.
