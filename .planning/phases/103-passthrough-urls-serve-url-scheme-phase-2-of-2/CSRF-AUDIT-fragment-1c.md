# CSRF Audit — Fragment 1c: auth + user + session routes

**Shard scope:** files matching `src/backend/database/routes/auth*.ts`, `src/backend/database/routes/user*.ts`, and `src/backend/database/routes/session*.ts` (excluding `*.test.ts`).

**Note on empty glob:** no files match `auth*.ts` — authentication is not a top-level route module (auth flows live under `user-password-reset-routes.ts`, `user-totp-routes.ts`, `user-oidc-account-routes.ts`, and the `POST /users/login` endpoint in `users.ts`).

## Files audited (shard 1c scope)

- `src/backend/database/routes/sessions-merge-helper.ts` — pure module (no routes)
- `src/backend/database/routes/sessions.ts`
- `src/backend/database/routes/user-admin-routes.ts`
- `src/backend/database/routes/user-api-key-routes.ts`
- `src/backend/database/routes/user-avatar-storage.ts` — pure module (multer instance + error handler; no routes)
- `src/backend/database/routes/user-data-access-routes.ts`
- `src/backend/database/routes/user-oidc-account-routes.ts`
- `src/backend/database/routes/user-oidc-utils.ts` — pure module (no routes)
- `src/backend/database/routes/user-password-reset-routes.ts`
- `src/backend/database/routes/user-preferences.ts`
- `src/backend/database/routes/user-session-routes.ts`
- `src/backend/database/routes/user-settings-routes.ts`
- `src/backend/database/routes/user-totp-routes.ts`
- `src/backend/database/routes/users.ts`

## Classification rubric (identical across all four shards)

- **state_changing:** does the route write to DB / trigger side effects (SSH exec, external API call, filesystem write)? `yes` / `no`
- **preflight_triggering:**
  - JSON POST/PUT/DELETE/PATCH (`express.json()` / `bodyParser.json()` middleware present, or Content-Type: application/json enforced) → `yes` (browser preflights)
  - form-urlencoded POST → `no` (CORS-simple)
  - multipart/form-data POST (multer / busboy / formidable) → `no` (CORS-simple per D-10)
  - GET → `no`, but flag if it triggers side effects
- **remediation:**
  - `none-needed` — read-only OR already preflight-triggering
  - `added-origin-check` — multipart-origin-guard applied (Task 2)
  - `added-csrf-token` — token required (unused in this fragment)
  - `already-preflighting` — synonym for none-needed on state-changing JSON

## Fragment audit table

| Route (method + path) | File (path:line) | state_changing | preflight_triggering | remediation |
|---|---|---|---|---|
| GET /sessions/list | sessions.ts:294 | no (list active sessions for user) | no | none-needed |
| GET /users/list | user-admin-routes.ts:56 | no (admin list users) | no | none-needed |
| GET /users/list-basic | user-admin-routes.ts:113 | no (basic list of users) | no | none-needed |
| POST /users/make-admin | user-admin-routes.ts:171 | yes (UPDATE users.isAdmin=true) | yes (app-level bodyParser.json) | none-needed |
| POST /users/:id/mxid | user-admin-routes.ts:306 | yes (UPDATE users.mxid) | yes (app-level bodyParser.json) | none-needed |
| POST /users/remove-admin | user-admin-routes.ts:426 | yes (UPDATE users.isAdmin=false) | yes (app-level bodyParser.json) | none-needed |
| POST /users/api-keys | user-api-key-routes.ts:54 | yes (INSERT userApiKey) | yes (app-level bodyParser.json) | none-needed |
| GET /users/api-keys | user-api-key-routes.ts:141 | no (list keys) | no | none-needed |
| DELETE /users/api-keys/:keyId | user-api-key-routes.ts:191 | yes (DELETE userApiKey) | yes (DELETE always preflights) | none-needed |
| POST /users/unlock-data | user-data-access-routes.ts:42 | yes (mark user-data unlock, session-scoped) | yes (app-level bodyParser.json) | none-needed |
| GET /users/data-status | user-data-access-routes.ts:105 | no (read lock status) | no | none-needed |
| POST /users/link-oidc-to-password | user-oidc-account-routes.ts:54 | yes (UPDATE users linking OIDC to password identity) | yes (app-level bodyParser.json) | none-needed |
| POST /users/unlink-oidc-from-password | user-oidc-account-routes.ts:254 | yes (UPDATE users unlinking OIDC) | yes (app-level bodyParser.json) | none-needed |
| POST /users/initiate-reset | user-password-reset-routes.ts:64 | yes (INSERT reset code, external email/matrix send) | yes (app-level bodyParser.json) | none-needed |
| POST /users/verify-reset-code | user-password-reset-routes.ts:166 | yes (mints temp token; consumes reset code state) | yes (app-level bodyParser.json) | none-needed |
| POST /users/complete-reset | user-password-reset-routes.ts:302 | yes (UPDATE users.password) | yes (app-level bodyParser.json) | none-needed |
| GET /user-preferences/ | user-preferences.ts:324 | no (read user prefs) | no | none-needed |
| PUT /user-preferences/ | user-preferences.ts:357 | yes (UPSERT user prefs) | yes (PUT always preflights) | none-needed |
| GET /users/sessions | user-session-routes.ts:34 | no (list user sessions) | no | none-needed |
| DELETE /users/sessions/:sessionId | user-session-routes.ts:124 | yes (DELETE session) | yes (DELETE always preflights) | none-needed |
| POST /users/sessions/revoke-all | user-session-routes.ts:208 | yes (DELETE all sessions) | yes (app-level bodyParser.json) | none-needed |
| GET /users/guacamole-settings | user-settings-routes.ts:44 | no (read setting) | no | none-needed |
| PATCH /users/guacamole-settings | user-settings-routes.ts:89 | yes (UPDATE user setting) | yes (PATCH always preflights) | none-needed |
| GET /users/log-level | user-settings-routes.ts:147 | no (read setting) | no | none-needed |
| PATCH /users/log-level | user-settings-routes.ts:177 | yes (UPDATE log-level setting) | yes (PATCH always preflights) | none-needed |
| GET /users/session-timeout | user-settings-routes.ts:216 | no (read setting) | no | none-needed |
| PATCH /users/session-timeout | user-settings-routes.ts:248 | yes (UPDATE session-timeout setting) | yes (PATCH always preflights) | none-needed |
| POST /users/totp/setup | user-totp-routes.ts:48 | yes (write TOTP setup state) | yes (app-level bodyParser.json) | none-needed |
| POST /users/totp/enable | user-totp-routes.ts:114 | yes (UPDATE users.totp_enabled) | yes (app-level bodyParser.json) | none-needed |
| POST /users/totp/disable | user-totp-routes.ts:219 | yes (UPDATE users.totp_enabled=false) | yes (app-level bodyParser.json) | none-needed |
| POST /users/totp/backup-codes | user-totp-routes.ts:310 | yes (rotate backup codes) | yes (app-level bodyParser.json) | none-needed |
| POST /users/totp/verify-login | user-totp-routes.ts:397 | yes (mints session, consumes temp token) | yes (app-level bodyParser.json) | none-needed |
| USE /users/ (structured-log middleware) | users.ts:59 | n/a (middleware mount) | n/a | n/a |
| POST /users/create | users.ts:132 | yes (INSERT user + optional avatar) | **no (userAvatarUpload.single("avatar") = multipart/form-data)** | **added-origin-check** |
| USE /users/create (multer error handler mount) | users.ts:441 | n/a | n/a | n/a |
| PUT /users/:id/avatar | users.ts:505 | yes (UPDATE user avatar bytes) | **no (userAvatarUpload.single("avatar") = multipart/form-data)** | **added-origin-check** |
| GET /users/:id/avatar | users.ts:641 | no (read avatar) | no | none-needed |
| USE /users/:id/avatar (multer error handler) | users.ts:695 | n/a | n/a | n/a |
| POST /users/oidc-config | users.ts:713 | yes (UPSERT OIDC config) | yes (app-level bodyParser.json) | none-needed |
| DELETE /users/oidc-config | users.ts:867 | yes (DELETE OIDC config) | yes (DELETE always preflights) | none-needed |
| GET /users/oidc-config | users.ts:901 | no (read OIDC config) | no | none-needed |
| GET /users/oidc-config/admin | users.ts:950 | no (admin read OIDC config with secret) | no | none-needed |
| GET /users/oidc/authorize | users.ts:1028 | yes (redirect user to IdP; issues state param) | no (GET; but flow is browser-initiated OAuth start — see notes) | none-needed |
| GET /users/oidc/callback | users.ts:1121 | yes (consumes IdP state param, mints session) | no (GET; OAuth callback from IdP redirect — see notes) | none-needed (OAuth state param gate) |
| POST /users/login | users.ts:1686 | yes (mints session cookie) | yes (app-level bodyParser.json — expects JSON body) | none-needed |
| POST /users/logout | users.ts:1914 | yes (revokes session) | yes (app-level bodyParser.json) | none-needed |
| GET /users/me | users.ts:1955 | no (read own user) | no | none-needed |
| GET /users/me/token | users.ts:2018 | no (read own JWT — from cookie) | no | none-needed (see notes) |
| GET /users/setup-required | users.ts:2038 | no (probe setup state) | no | none-needed |
| GET /users/count | users.ts:2070 | no (count users) | no | none-needed |
| GET /users/db-health | users.ts:2103 | no (admin db health probe) | no | none-needed |
| GET /users/registration-allowed | users.ts:2127 | no (read setting) | no | none-needed |
| PATCH /users/registration-allowed | users.ts:2168 | yes (UPDATE setting) | yes (PATCH always preflights) | none-needed |
| GET /users/oidc-auto-provision | users.ts:2194 | no (read setting) | no | none-needed |
| PATCH /users/oidc-auto-provision | users.ts:2210 | yes (UPDATE setting) | yes (PATCH always preflights) | none-needed |
| GET /users/password-login-allowed | users.ts:2258 | no (read setting) | no | none-needed |
| PATCH /users/password-login-allowed | users.ts:2299 | yes (UPDATE setting) | yes (PATCH always preflights) | none-needed |
| GET /users/password-reset-allowed | users.ts:2338 | no (read setting) | no | none-needed |
| PATCH /users/password-reset-allowed | users.ts:2379 | yes (UPDATE setting) | yes (PATCH always preflights) | none-needed |
| DELETE /users/delete-account | users.ts:2433 | yes (DELETE own user + cascades) | yes (DELETE always preflights) | none-needed |
| POST /users/change-password | users.ts:2574 | yes (UPDATE users.password) | yes (app-level bodyParser.json) | none-needed |
| POST /users/change-username | users.ts:2634 | yes (UPDATE users.username) | yes (app-level bodyParser.json) | none-needed |
| DELETE /users/delete-user | users.ts:2716 | yes (admin DELETE user + cascades) | yes (DELETE always preflights) | none-needed |

**Row count (data rows, excluding `n/a` middleware mounts):** 47 route rows + 3 `n/a` mounts = 50 markdown table rows.

## Fragment notes

- **users.ts:132 POST /users/create — multipart (multer).** Uses `userAvatarUpload.single("avatar")` (imported from `user-avatar-storage.ts`). Registration flow accepts an optional avatar file alongside username/password fields. Multipart is CORS-simple → `added-origin-check` required.
- **users.ts:505 PUT /users/:id/avatar — multipart (multer).** Avatar rotation for existing user. Same `userAvatarUpload.single("avatar")`. `assertOwnOrAdminForAvatarChange` runs before multer per T-16-04 pattern; guard applies unconditionally (it rejects on Origin, not body-shape).
- **users.ts:1028 GET /users/oidc/authorize + L1121 GET /users/oidc/callback — OAuth flow.** Both are state-changing (authorize issues an OAuth state param + redirects; callback consumes the state param and mints a session cookie). Classified as `state_changing=yes, preflight_triggering=no, remediation=none-needed` because CSRF from serve subdomains cannot forge the state param — an attacker at `*.serve.term.<domain>` can't guess the state token issued during the authorize step (which itself requires the user's browser to hit `/authorize`). Standard OAuth CSRF-defense (state param) already gates this.
- **users.ts:2018 GET /users/me/token — cookie read.** Returns the JWT session cookie value in a JSON response. Since serve subdomains cannot read the response cross-origin (CORS blocks response reads too — Plan 02 D-07), this exfiltration path is not exploitable from `*.serve.term.<domain>`. Read-only from the auth-state perspective.
- **users.ts:1686 POST /users/login — JSON body.** No dedicated body parser mounted; relies on app-level `bodyParser.json` (L285 of database.ts). Preflights on Content-Type: application/json.
- **users.ts:64 POST /users/create edge case.** Login flow itself (`POST /users/login`) uses JSON; only the CREATE path (registration + avatar) is multipart. Login is safely preflight-triggering.
- **user-password-reset-routes.ts routes are unauthenticated by design** (no `authenticateJWT`) — anyone can initiate reset for any username. This is standard password-reset flow (rate-limited by external channels). Because bodies are JSON they preflight; CSRF from serve subdomains cannot invoke against a still-authenticated user's session (login state is not required).
- **user-totp-routes.ts:397 verify-login is unauthenticated** — expected (validates temp token from prior login step). Preflights via app-level JSON parser.
- **user-oidc-account-routes.ts:254 was called with multi-arg signature** — router.post( on one line, path on next. Confirmed JSON POST.
- **All PATCH routes preflight** trivially — PATCH is not a CORS-simple method (only GET/HEAD/POST are), so it always triggers preflight regardless of Content-Type.
