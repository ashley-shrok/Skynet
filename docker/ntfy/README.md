# docker/ntfy — ntfy server operator notes

This directory contains the committed repo artifact `server.yml`, which is
bind-mounted read-only into the ntfy container at `/etc/ntfy/server.yml`.
ntfy syncs the `auth-users` and `auth-tokens` entries into its SQLite
`auth.db` at container startup.

## 1. Generate NTFY_ADMIN_PASS_BCRYPT (one-time setup)

ntfy requires bcrypt-hashed passwords in its `auth-users` config. To generate
the hash for your admin account's plaintext password, run:

```sh
docker run --rm binwiederhier/ntfy:v2.28.0 user hash <your-plaintext-password>
```

The command prints a bcrypt hash like `$2a$10$abc...xyz`. Store it in
`/opt/skynet/skynet.env` as:

```env
NTFY_ADMIN_PASS_BCRYPT=$2a$10$abc...xyz
NTFY_ADMIN_PASS=<your-plaintext-password>
```

Keep the plaintext `NTFY_ADMIN_PASS` alongside the hash — Skynet's backend
uses it for HTTP Basic auth against the ntfy admin API (`POST /v1/users`,
`POST /v1/users/access`, etc.).

## 2. The $$ escaping rule — and why it does NOT apply here

Bcrypt hashes contain `$` characters (e.g. `$2a$10$...`). When a bcrypt hash
is placed **directly inline** in a docker-compose.yml `environment:` block,
each `$` must be escaped as `$$` to prevent Docker Compose from treating it as
a variable interpolation (`$2a` → empty string → corrupted hash).

**This project does NOT inline the hash in docker-compose.yml.** Instead:
- The hash lives in `skynet.env` (an `env_file` source).
- `server.yml` references it as `${NTFY_ADMIN_PASS_BCRYPT}` — ntfy reads this
  directly from the container's environment at startup.
- Docker's `env_file` loading does NOT perform `$VAR` re-interpolation on the
  values it reads. The value arrives in the container environment verbatim,
  and ntfy substitutes it into the YAML config without any `$$`-escaping step.

**TL;DR:** No `$$` escaping is needed anywhere in this setup.

## 3. Generate NTFY_PUBLISH_TOKEN (one-time setup)

The publish token is a 32-character opaque string with the `tk_` prefix
(ntfy's required token format). Generate one with Node.js:

```sh
node -e 'console.log("tk_" + require("crypto").randomBytes(16).toString("hex").slice(0, 29))'
```

Store it in `/opt/skynet/skynet.env` as:

```env
NTFY_PUBLISH_TOKEN=tk_<29-hex-chars>
```

Skynet's backend reads this token from env at boot time (`assertNtfyConfigAtBoot`)
and uses it as `Authorization: Bearer <token>` when publishing DM notifications
via `POST http://ntfy:2586/<topic>` on the internal Docker network.

## 4. Full skynet.env section

Add these entries to `/opt/skynet/skynet.env`:

```env
# Phase 144 — ntfy push notifications
NTFY_ADMIN_USER=skynet-admin
NTFY_ADMIN_PASS=<your-plaintext-password>
NTFY_ADMIN_PASS_BCRYPT=$2a$10$<rest-of-bcrypt-hash>
NTFY_PUBLISH_TOKEN=tk_<29-hex-chars>
```

## 5. Credential rotation

- **Publish token rotation:** Change `NTFY_PUBLISH_TOKEN` in skynet.env and
  restart the ntfy container (`docker compose restart ntfy`). ntfy syncs the
  new token from `auth-tokens` in server.yml into auth.db on startup. The old
  token is immediately invalid.

- **Admin password rotation:** Re-hash the new password with `ntfy user hash`,
  update `NTFY_ADMIN_PASS_BCRYPT` and `NTFY_ADMIN_PASS` in skynet.env, restart
  the ntfy container.

- **Per-user reading credential rotation:** Use the ntfy HTTP admin API
  (Plan 02's `POST /ntfy-regenerate` route). No container restart needed —
  the admin API handles token revocation and re-issuance at runtime.
