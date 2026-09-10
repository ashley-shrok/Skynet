# Phase 103 CSRF Audit (D-09)

**Audited:** 2026-09-10
**Auditor:** tabitha (box-maintainer role, executing Plan 103-08)
**Scope:** All routes in `src/backend/database/routes/*.ts` (excluding `*.test.ts` / `*.integration.test.ts`)
**Method:** Sharded 4-way per W5. Fragments live at `CSRF-AUDIT-fragment-1{a,b,c,d}.md`; this document merges them.

## Summary

| Metric | Count |
|---|---|
| Total route files (excluding tests) | 65 |
| Files with zero routes (pure modules / helpers) | 10 |
| Files with routes | 55 |
| Total distinct route mounts (all methods, all files) | **186** |
| State-changing routes | 129 |
| Read-only (`state_changing=no`) routes | 57 |
| Preflight-triggering state-changing routes | 120 |
| **Non-preflight state-changing routes (multipart)** | **9** |
| Middleware / error-handler mounts (n/a) | 19 |
| Multipart remediations applied | **9** |

**Remediation strategy applied:**

- **Preflight-triggering state-changing routes (120)** — covered by Plan 02 `cors-config.ts` `SERVE_SUBDOMAIN_RE` reject at CORS preflight layer. No additional per-route work needed. Every JSON POST/PUT/PATCH, every DELETE, every route with `express.json()` middleware falls under this class.
- **Read-only routes (57)** — CSRF-inapplicable. GET/HEAD requests are CORS-simple and can be issued cross-origin, but the response is not readable cross-origin from `*.serve.term.<domain>` (browser blocks response). Nothing to forge; nothing to exfiltrate.
- **Non-preflight state-changing routes (9)** — all are multipart/form-data (multer `upload.single`). CORS-simple content-type means no preflight; the widened JWT cookie flows. **Remediated in Task 2 via `multipart-origin-guard.ts` applied per-endpoint** — see `## Multipart remediations` below.
- **GET-with-side-effects (2 identified)** — OIDC callback flows in `host-opkssh-routes.ts:552` and `users.ts:1121`. Both are non-CSRF-exploitable because OAuth state param gates the flow (attacker cannot forge state token). Also `users.ts:1028` OIDC authorize (issues state param) is analogous. Documented in `## Notes / edge cases`; no code change.

## Files audited

All 65 files under `src/backend/database/routes/*.ts` (excluding `*.test.ts` / `*.integration.test.ts`) are represented in this audit. Files with zero route mounts are listed here as "pure modules" — they contain helpers, constants, error handlers, or middleware factories but never register an HTTP route.

**Pure modules (no routes, no CSRF surface):**

- `delete-user-data.ts` — user-deletion cascade helper (called by users.ts DELETE handlers)
- `global-files-config-loader.ts` — config loader helper
- `host-normalizers.ts` — normalizer helpers
- `identity-birth-orchestrator.ts` — orchestrator state machine (called by identity-birth.ts)
- `identity-harness-start.ts` — harness-start helper (called by identity-birth.ts flow)
- `opkssh-html.ts` — HTML surface helpers (mounted by host-opkssh-routes.ts:723)
- `sessions-merge-helper.ts` — sessions merge helper
- `snippets-reorder.ts` — snippets reorder helper (called by snippets.ts PUT /reorder)
- `user-avatar-storage.ts` — multer instance + error handler factory (imported by users.ts)
- `user-oidc-utils.ts` — OIDC utility helpers (called by users.ts oidc-* handlers)

**Files with routes:** 55 (audited row-by-row in the `## Audit table` section below).

## Classification rubric

- **state_changing:** does the route write to DB / trigger side effects (SSH exec, external API call, filesystem write)? `yes` / `no`
- **preflight_triggering:**
  - JSON POST/PUT/DELETE/PATCH (`express.json()` / `bodyParser.json()` middleware present, or Content-Type: application/json enforced) → `yes` (browser preflights)
  - form-urlencoded POST → `no` (CORS-simple)
  - multipart/form-data POST (multer / busboy / formidable) → `no` (CORS-simple per D-10)
  - GET → `no`, but flag if it triggers side effects
- **remediation:**
  - `none-needed` — read-only OR already preflight-triggering (covered by Plan 02 CORS reject)
  - `added-origin-check ✓` — multipart-origin-guard applied in Task 2 of this plan
  - `added-csrf-token` — token required (unused in Phase 103)
  - `already-preflighting` — synonym for none-needed on state-changing JSON

## Audit table

<!-- Merged from CSRF-AUDIT-fragment-1a/1b/1c/1d.md; fragments retained in phase directory for provenance. -->

| Route (method + path) | File (path:line) | state_changing | preflight_triggering | remediation |
|---|---|---|---|---|
| POST /host/autostart/enable | host-autostart-routes.ts:45 | yes (INSERT hostAutostart + SSH cron write) | yes (express.json via app-level bodyParser) | none-needed |
| DELETE /host/autostart/disable | host-autostart-routes.ts:223 | yes (DELETE hostAutostart + SSH cron rm) | yes (DELETE always preflights) | none-needed |
| GET /host/autostart/status | host-autostart-routes.ts:281 | no (read status) | no | none-needed |
| PATCH /host/bulk-update | host-bulk-routes.ts:71 | yes (bulk UPDATE hosts) | yes (PATCH always preflights) | none-needed |
| POST /host/bulk-import | host-bulk-routes.ts:174 | yes (bulk INSERT hosts) | yes (express.json) | none-needed |
| GET /host/command-history/:hostId | host-command-history-routes.ts:35 | no (read history) | no | none-needed |
| DELETE /host/command-history | host-command-history-routes.ts:109 | yes (DELETE history) | yes (DELETE always preflights) | none-needed |
| GET /host/file_manager/recent | host-file-manager-bookmark-routes.ts:39 | no (read) | no | none-needed |
| POST /host/file_manager/recent | host-file-manager-bookmark-routes.ts:109 | yes (INSERT bookmark) | yes (express.json) | none-needed |
| DELETE /host/file_manager/recent | host-file-manager-bookmark-routes.ts:183 | yes (DELETE bookmark) | yes (DELETE always preflights) | none-needed |
| GET /host/file_manager/pinned | host-file-manager-bookmark-routes.ts:236 | no (read) | no | none-needed |
| POST /host/file_manager/pinned | host-file-manager-bookmark-routes.ts:307 | yes (INSERT pin) | yes (express.json) | none-needed |
| DELETE /host/file_manager/pinned | host-file-manager-bookmark-routes.ts:378 | yes (DELETE pin) | yes (DELETE always preflights) | none-needed |
| GET /host/file_manager/shortcuts | host-file-manager-bookmark-routes.ts:431 | no (read) | no | none-needed |
| POST /host/file_manager/shortcuts | host-file-manager-bookmark-routes.ts:502 | yes (INSERT shortcut) | yes (express.json) | none-needed |
| DELETE /host/file_manager/shortcuts | host-file-manager-bookmark-routes.ts:573 | yes (DELETE shortcut) | yes (DELETE always preflights) | none-needed |
| PUT /host/folders/rename | host-folder-routes.ts:59 | yes (UPDATE folder name) | yes (PUT always preflights) | none-needed |
| GET /host/folders | host-folder-routes.ts:148 | no (list) | no | none-needed |
| PUT /host/folders/metadata | host-folder-routes.ts:204 | yes (UPDATE folder metadata) | yes (PUT always preflights) | none-needed |
| DELETE /host/folders/:name/hosts | host-folder-routes.ts:290 | yes (UPDATE hosts in folder) | yes (DELETE always preflights) | none-needed |
| GET /host/db/host/internal | host-internal-routes.ts:25 | no (read own hosts) | no | none-needed |
| GET /host/db/host/internal/all | host-internal-routes.ts:119 | no (read all hosts, admin) | no | none-needed |
| POST /host/db/proxy/test | host-network-routes.ts:63 | no (SSH connectivity probe — no DB write) | yes (express.json) | none-needed |
| POST /host/db/host/:id/wake | host-network-routes.ts:94 | yes (WoL magic packet send — external effect) | yes (express.json) | none-needed |
| USE /host/opkssh-* (setupOpkSSHCallbackRoutes prelude) | host-opkssh-routes.ts:32 | n/a (middleware mount) | n/a | n/a |
| GET /host/opkssh-callback | host-opkssh-routes.ts:552 | yes (writes OPKSSH token to disk, DB update) | no (GET — OIDC callback flow gated by OAuth state param, not CSRF-exploitable) | none-needed |
| USE /host/* (opkssh-html mount) | host-opkssh-routes.ts:723 | n/a (middleware mount) | n/a | n/a |
| POST /host/db/host | host.ts:122 | yes (INSERT host + SSH key) | no (multer upload.single("key") = multipart/form-data) | added-origin-check ✓ |
| POST /host/quick-connect | host.ts:681 | yes (transient host register + connect) | yes (JSON body via app-level bodyParser.json; no multer middleware in chain — verified L681-698 reads req.body.ip/port/username directly) | none-needed |
| PUT /host/db/host/:id | host.ts:832 | yes (UPDATE host + optional SSH key) | no (multer upload.single("key") — multipart branch used when Content-Type header includes multipart/form-data; JSON branch preflights) | added-origin-check ✓ |
| GET /host/db/host | host.ts:1444 | no (list hosts) | no | none-needed |
| GET /host/db/host/:id | host.ts:1688 | no (read host) | no | none-needed |
| GET /host/db/host/:id/password | host.ts:1780 | no (read stored password) | no | none-needed |
| GET /host/db/host/:id/export | host.ts:1848 | no (export host record) | no | none-needed |
| GET /host/db/hosts/export | host.ts:2040 | no (export all hosts) | no | none-needed |
| DELETE /host/db/host/:id | host.ts:2200 | yes (DELETE host) | yes (DELETE always preflights) | none-needed |
| GET /host/transfer/recent | host.ts:2340 | no (read recent transfers) | no | none-needed |
| POST /host/transfer/recent | host.ts:2381 | yes (INSERT transfer record) | yes (express.json) | none-needed |
| DELETE /host/folders/:folderName/hosts | host.ts:2581 | yes (DELETE folder-hosts mapping) | yes (DELETE always preflights) | none-needed |
| GET /host/ssh/opkssh/token/:hostId | host.ts:2708 | no (read opkssh token) | no | none-needed |
| DELETE /host/ssh/opkssh/token/:hostId | host.ts:2790 | yes (DELETE opkssh token) | yes (DELETE always preflights) | none-needed |
| POST /host/:hostId/session/kill | host.ts:2855 | yes (kill SSH sessions on remote) | yes (express.json) | none-needed |
| USE /identities/avatar (express.json body parser) | identity-avatar-batch.ts:42 | n/a (middleware mount) | n/a | n/a |
| POST /identities/avatar/batch | identity-avatar-batch.ts:198 | yes (batch upsert identity avatars) | yes (express.json — see L42) | none-needed |
| POST /identities/avatar/candidate/manual | identity-avatar-batch.ts:424 | yes (INSERT candidate avatar) | no (manualUpload = multer memoryStorage → multipart/form-data) | added-origin-check ✓ |
| USE /identities/avatar (multer error middleware) | identity-avatar-batch.ts:453 | n/a | n/a | n/a |
| GET /identities/avatar/candidate/:id | identity-avatar-batch.ts:484 | no (read candidate) | no | none-needed |
| POST /identities/birth/ | identity-birth.ts:84 | yes (INSERT identity + orchestrator kickoff) | yes (express.json on L86) | none-needed |
| POST /identities/birth/retry/:key | identity-birth.ts:471 | yes (retry orchestrator step) | yes (express.json inline on L471) | none-needed |
| USE /identities/birth (mount) | identity-birth.ts:614 | n/a | n/a | n/a |
| POST /identities/clone/ | identity-clone.ts:279 | yes (INSERT clone request + orchestrator kickoff) | yes (express.json({limit:"64kb"}) on L290) | none-needed |
| USE /identities/clone (mount) | identity-clone.ts:837 | n/a | n/a | n/a |
| GET /identities/exists-on-host | identity-exists-on-host.ts:64 | no (SSH probe — read-shaped, not CSRF-usable target) | no | none-needed |
| USE /identities (mount) | identity-exists-on-host.ts:162 | n/a | n/a | n/a |
| GET /identities/:key/no-dormancy | identity-no-dormancy.ts:66 | no (read sentinel state) | no | none-needed |
| PUT /identities/:key/no-dormancy | identity-no-dormancy.ts:159 | yes (writes sentinel file over SSH) | yes (express.json on L161 + PUT preflights) | none-needed |
| USE /identities (mount) | identity-no-dormancy.ts:261 | n/a | n/a | n/a |
| GET /relay-pointer/ | relay-pointer.ts:158 | no (resolve relay-pointer by public id) | no | none-needed |
| POST /relay-room/backfill | relay-registry-backfill.ts:97 | yes (backfill relay-room registry rows) | yes (app-level bodyParser.json) | none-needed |
| POST /relay-room/create | relay-room-create.ts:224 | yes (INSERT relay-room + Matrix room create) | yes (app-level bodyParser.json) | none-needed |
| GET /relay-room/:roomId/participants | relay-room-participants.ts:159 | no (list participants) | no | none-needed |
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
| POST /users/create | users.ts:132 | yes (INSERT user + optional avatar) | no (userAvatarUpload.single("avatar") = multipart/form-data) | added-origin-check ✓ |
| USE /users/create (multer error handler mount) | users.ts:441 | n/a | n/a | n/a |
| PUT /users/:id/avatar | users.ts:505 | yes (UPDATE user avatar bytes) | no (userAvatarUpload.single("avatar") = multipart/form-data) | added-origin-check ✓ |
| GET /users/:id/avatar | users.ts:641 | no (read avatar) | no | none-needed |
| USE /users/:id/avatar (multer error handler) | users.ts:695 | n/a | n/a | n/a |
| POST /users/oidc-config | users.ts:713 | yes (UPSERT OIDC config) | yes (app-level bodyParser.json) | none-needed |
| DELETE /users/oidc-config | users.ts:867 | yes (DELETE OIDC config) | yes (DELETE always preflights) | none-needed |
| GET /users/oidc-config | users.ts:901 | no (read OIDC config) | no | none-needed |
| GET /users/oidc-config/admin | users.ts:950 | no (admin read OIDC config with secret) | no | none-needed |
| GET /users/oidc/authorize | users.ts:1028 | yes (redirect user to IdP; issues state param) | no (GET — OAuth authorize flow, browser-initiated) | none-needed |
| GET /users/oidc/callback | users.ts:1121 | yes (consumes IdP state param, mints session) | no (GET — OAuth callback, gated by state param) | none-needed |
| POST /users/login | users.ts:1686 | yes (mints session cookie) | yes (app-level bodyParser.json — expects JSON body) | none-needed |
| POST /users/logout | users.ts:1914 | yes (revokes session) | yes (app-level bodyParser.json) | none-needed |
| GET /users/me | users.ts:1955 | no (read own user) | no | none-needed |
| GET /users/me/token | users.ts:2018 | no (read own JWT — from cookie; CORS blocks cross-origin response reads) | no | none-needed |
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
| POST /agent-reset/:hostId/:tmuxSessionName | agent-reset.ts:128 | yes (drops sentinel + optional harness kill via SSH) | yes (app-level bodyParser.json) | none-needed |
| GET /alerts/ | alerts.ts:117 | no (list) | no | none-needed |
| POST /alerts/dismiss | alerts.ts:174 | yes (INSERT dismissed alert) | yes (app-level bodyParser.json) | none-needed |
| GET /alerts/dismissed | alerts.ts:225 | no (list dismissed) | no | none-needed |
| DELETE /alerts/dismiss | alerts.ts:274 | yes (DELETE dismissal) | yes (DELETE always preflights) | none-needed |
| GET /c2s-tunnel-presets/ | c2s-tunnel-presets.ts:50 | no (list) | no | none-needed |
| POST /c2s-tunnel-presets/ | c2s-tunnel-presets.ts:74 | yes (INSERT preset) | yes (app-level bodyParser.json) | none-needed |
| PUT /c2s-tunnel-presets/:id | c2s-tunnel-presets.ts:130 | yes (UPDATE preset) | yes (PUT always preflights) | none-needed |
| DELETE /c2s-tunnel-presets/:id | c2s-tunnel-presets.ts:210 | yes (DELETE preset) | yes (DELETE always preflights) | none-needed |
| GET /compose-drafts/ | compose-drafts.ts:226 | no (read draft) | no | none-needed |
| PUT /compose-drafts/ | compose-drafts.ts:237 | yes (UPSERT draft) | yes (PUT always preflights) | none-needed |
| POST /credentials/:id/deploy-to-host | credential-deploy-routes.ts:399 | yes (SSH exec install cred on host) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/detect-key-type | credential-key-routes.ts:94 | no (parse-only; classifies pasted key text) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/detect-public-key-type | credential-key-routes.ts:153 | no (parse-only) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/validate-key-pair | credential-key-routes.ts:215 | no (validate pair without persistence) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/generate-key-pair | credential-key-routes.ts:283 | no (generate; caller decides whether to persist via subsequent POST /credentials) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/generate-public-key | credential-key-routes.ts:351 | no (compute pubkey from private key text) | yes (app-level bodyParser.json) | none-needed |
| POST /credentials/ | credentials.ts:85 | yes (INSERT credential) | yes (app-level bodyParser.json) | none-needed |
| GET /credentials/ | credentials.ts:244 | no (list) | no | none-needed |
| GET /credentials/folders | credentials.ts:308 | no (list folders) | no | none-needed |
| GET /credentials/:id | credentials.ts:368 | no (read one) | no | none-needed |
| PUT /credentials/:id | credentials.ts:478 | yes (UPDATE credential) | yes (PUT always preflights) | none-needed |
| DELETE /credentials/:id | credentials.ts:646 | yes (DELETE credential) | yes (DELETE always preflights) | none-needed |
| POST /credentials/:id/apply-to-host/:hostId | credentials.ts:776 | yes (associate credential ↔ host; may SSH exec) | yes (app-level bodyParser.json) | none-needed |
| GET /credentials/:id/hosts | credentials.ts:883 | no (list hosts using this credential) | no | none-needed |
| PUT /credentials/folders/rename | credentials.ts:1006 | yes (UPDATE folder name across credentials) | yes (PUT always preflights) | none-needed |
| POST /debug/console-log | debug.ts:128 | yes (writes to console-forward log) | yes (app-level bodyParser.json) | none-needed |
| POST /global-files/read | global-files-read-write.ts:120 | no (SSH exec cat — read-only; scoped express.json 32kb) | yes (express.json inline) | none-needed |
| PUT /global-files/write | global-files-read-write.ts:282 | yes (SSH exec write remote file; scoped express.json 4mb) | yes (PUT always preflights + express.json) | none-needed |
| USE /global-files (error handler) | global-files-read-write.ts:510 | n/a (middleware mount) | n/a | n/a |
| GET /global-files/ | global-files.ts:46 | no (list global files) | no | none-needed |
| USE /global-files (error handler) | global-files.ts:89 | n/a (middleware mount) | n/a | n/a |
| GET /identities/ | identities.ts:271 | no (list identities) | no | none-needed |
| POST /identities/ | identities.ts:411 | no (returns 410 Gone — retired endpoint) | no (no body parsing before 410) | none-needed |
| PUT /identities/:identityKey | identities.ts:421 | yes (writes identity markdown + avatar over SSH) | no (upload.single("avatar") = multipart/form-data) | added-origin-check ✓ |
| GET /identities/:identityKey/avatar | identities.ts:781 | no (read avatar bytes over SSH) | no | none-needed |
| USE /identities (error handler) | identities.ts:897 | n/a (middleware mount) | n/a | n/a |
| GET /message-queue/ | message-queue.ts:40 | no (list queued messages) | no | none-needed |
| POST /message-queue/ | message-queue.ts:72 | yes (INSERT queued message) | yes (app-level bodyParser.json) | none-needed |
| PATCH /message-queue/:id | message-queue.ts:131 | yes (UPDATE queued message) | yes (PATCH always preflights) | none-needed |
| DELETE /message-queue/:id | message-queue.ts:179 | yes (DELETE queued message) | yes (DELETE always preflights) | none-needed |
| GET /network-topology/ | network-topology.ts:63 | no (read topology) | no | none-needed |
| POST /network-topology/ | network-topology.ts:145 | yes (UPSERT topology) | yes (app-level bodyParser.json) | none-needed |
| GET /open-tabs/ | open-tabs.ts:28 | no (list tabs) | no | none-needed |
| POST /open-tabs/ | open-tabs.ts:86 | yes (INSERT tab) | yes (app-level bodyParser.json) | none-needed |
| PUT /open-tabs/ | open-tabs.ts:187 | yes (bulk UPDATE tabs) | yes (PUT always preflights) | none-needed |
| PATCH /open-tabs/:id | open-tabs.ts:254 | yes (UPDATE tab) | yes (PATCH always preflights) | none-needed |
| DELETE /open-tabs/:id | open-tabs.ts:302 | yes (DELETE tab) | yes (DELETE always preflights) | none-needed |
| GET /open-tabs/active-sessions | open-tabs.ts:352 | no (list active sessions) | no | none-needed |
| POST /pretty-view/fetch-host-file | pretty-view-fetch-host-file.ts:567 | no (SSH SFTP fetch — read-only) | yes (scoped express.json 8kb) | none-needed |
| POST /pretty-view/fetch-tailnet-url | pretty-view-fetch-tailnet-url.ts:107 | no (fetch tailnet HTTP URL — read-only proxy) | yes (scoped express.json 2kb) | none-needed |
| POST /rbac/host/:id/share | rbac.ts:77 | yes (INSERT hostAccess grant) | yes (app-level bodyParser.json) | none-needed |
| DELETE /rbac/host/:id/access/:accessId | rbac.ts:325 | yes (DELETE hostAccess grant) | yes (DELETE always preflights) | none-needed |
| GET /rbac/host/:id/access | rbac.ts:397 | no (list grants) | no | none-needed |
| GET /rbac/shared-hosts | rbac.ts:481 | no (list) | no | none-needed |
| GET /rbac/roles | rbac.ts:540 | no (list rbac roles) | no | none-needed |
| POST /rbac/roles | rbac.ts:599 | yes (INSERT role) | yes (app-level bodyParser.json) | none-needed |
| PUT /rbac/roles/:id | rbac.ts:692 | yes (UPDATE role) | yes (PUT always preflights) | none-needed |
| DELETE /rbac/roles/:id | rbac.ts:784 | yes (DELETE role) | yes (DELETE always preflights) | none-needed |
| POST /rbac/users/:userId/roles | rbac.ts:881 | yes (assign role) | yes (app-level bodyParser.json) | none-needed |
| DELETE /rbac/users/:userId/roles/:roleId | rbac.ts:1031 | yes (revoke role) | yes (DELETE always preflights) | none-needed |
| GET /rbac/users/:userId/roles | rbac.ts:1121 | no (list) | no | none-needed |
| POST /rbac/snippet/:id/share | rbac.ts:1176 | yes (INSERT snippetAccess grant) | yes (app-level bodyParser.json) | none-needed |
| DELETE /rbac/snippet/:id/access/:accessId | rbac.ts:1318 | yes (DELETE snippetAccess) | yes (DELETE always preflights) | none-needed |
| GET /rbac/snippet/:id/access | rbac.ts:1367 | no (list) | no | none-needed |
| GET /rbac/shared-snippets | rbac.ts:1445 | no (list) | no | none-needed |
| PUT /rbac/host-access/:hostId/credential | rbac.ts:1528 | yes (UPDATE credential-of-access) | yes (PUT always preflights) | none-needed |
| POST /roles/ | roles-create.ts:275 | yes (INSERT role + optional avatar over SSH) | no (upload.single("avatar") = multipart/form-data) | added-origin-check ✓ |
| USE /roles (error handler) | roles-create.ts:619 | n/a (middleware mount) | n/a | n/a |
| GET /roles/ | roles-list-for-host.ts:108 | no (list roles for host) | no | none-needed |
| USE /roles (error handler) | roles-list-for-host.ts:282 | n/a (middleware mount) | n/a | n/a |
| GET /roles/:name/avatar | roles.ts:132 | no (read role avatar over SSH) | no | none-needed |
| POST /roles/:name/avatar | roles.ts:314 | yes (writes role avatar bytes over SSH) | no (upload.single("avatar") wrapped in async gate = multipart/form-data) | added-origin-check ✓ |
| USE /roles (error handler) | roles.ts:525 | n/a (middleware mount) | n/a | n/a |
| GET /runbooks-editor/runbooks | runbooks-editor.ts:250 | no (list runbooks) | no | none-needed |
| GET /runbooks-editor/files | runbooks-editor.ts:399 | no (list files) | no | none-needed |
| POST /runbooks-editor/read | runbooks-editor.ts:558 | no (SSH read of runbook file; scoped express.json 32kb) | yes (express.json inline) | none-needed |
| PUT /runbooks-editor/write | runbooks-editor.ts:750 | yes (SSH write runbook file; scoped express.json 4mb) | yes (PUT always preflights + express.json) | none-needed |
| POST /runbooks-editor/create | runbooks-editor.ts:987 | yes (SSH create new runbook; scoped express.json 32kb) | yes (express.json inline) | none-needed |
| DELETE /runbooks-editor/file | runbooks-editor.ts:1182 | yes (SSH rm file; scoped express.json 32kb — body carries path/hostId) | yes (DELETE always preflights + express.json) | none-needed |
| DELETE /runbooks-editor/runbook | runbooks-editor.ts:1355 | yes (SSH rmdir runbook; scoped express.json 32kb) | yes (DELETE always preflights + express.json) | none-needed |
| USE /runbooks-editor (error handler) | runbooks-editor.ts:1519 | n/a (middleware mount) | n/a | n/a |
| GET /skills-editor/skills | skills-editor.ts:248 | no (list skills) | no | none-needed |
| GET /skills-editor/files | skills-editor.ts:350 | no (list files) | no | none-needed |
| POST /skills-editor/read | skills-editor.ts:459 | no (SSH read; scoped express.json 32kb) | yes (express.json inline) | none-needed |
| PUT /skills-editor/write | skills-editor.ts:610 | yes (SSH write; scoped express.json 4mb) | yes (PUT always preflights + express.json) | none-needed |
| POST /skills-editor/create | skills-editor.ts:801 | yes (SSH create new skill; scoped express.json 32kb) | yes (express.json inline) | none-needed |
| DELETE /skills-editor/file | skills-editor.ts:959 | yes (SSH rm file; scoped express.json 32kb) | yes (DELETE always preflights + express.json) | none-needed |
| DELETE /skills-editor/skill | skills-editor.ts:1082 | yes (SSH rmdir skill; scoped express.json 32kb) | yes (DELETE always preflights + express.json) | none-needed |
| USE /skills-editor (error handler) | skills-editor.ts:1187 | n/a (middleware mount) | n/a | n/a |
| GET /snippets/folders | snippets.ts:131 | no (list folders) | no | none-needed |
| POST /snippets/folders | snippets.ts:189 | yes (INSERT folder) | yes (app-level bodyParser.json) | none-needed |
| PUT /snippets/folders/:name/metadata | snippets.ts:286 | yes (UPDATE folder metadata) | yes (PUT always preflights) | none-needed |
| PUT /snippets/folders/rename | snippets.ts:401 | yes (UPDATE folder name) | yes (PUT always preflights) | none-needed |
| DELETE /snippets/folders/:name | snippets.ts:509 | yes (DELETE folder) | yes (DELETE always preflights) | none-needed |
| PUT /snippets/reorder | snippets.ts:600 | yes (UPDATE snippet order) | yes (PUT always preflights) | none-needed |
| POST /snippets/execute | snippets.ts:694 | yes (SSH exec snippet on host) | yes (app-level bodyParser.json) | none-needed |
| GET /snippets/ | snippets.ts:942 | no (list snippets) | no | none-needed |
| GET /snippets/:id | snippets.ts:1035 | no (read snippet) | no | none-needed |
| POST /snippets/ | snippets.ts:1102 | yes (INSERT snippet) | yes (app-level bodyParser.json) | none-needed |
| PUT /snippets/:id | snippets.ts:1212 | yes (UPDATE snippet) | yes (PUT always preflights) | none-needed |
| DELETE /snippets/:id | snippets.ts:1311 | yes (DELETE snippet) | yes (DELETE always preflights) | none-needed |
| POST /terminal/command_history | terminal.ts:47 | yes (INSERT command history) | yes (app-level bodyParser.json) | none-needed |
| GET /terminal/command_history/:hostId | terminal.ts:135 | no (list history) | no | none-needed |
| POST /terminal/command_history/delete | terminal.ts:210 | yes (DELETE specific history rows) | yes (app-level bodyParser.json) | none-needed |
| DELETE /terminal/command_history/:hostId | terminal.ts:273 | yes (DELETE all history for host) | yes (DELETE always preflights) | none-needed |
| GET /terminal/session_settings | terminal.ts:328 | no (read settings) | no | none-needed |
| POST /terminal/session_settings | terminal.ts:384 | yes (UPSERT session settings) | yes (app-level bodyParser.json) | none-needed |
| GET /api/usage/ | usage.ts:41 | no (proxy to external usage aggregator) | no | none-needed |
| POST /voice/transcribe | voice.ts:432 | yes (external STT API call; caches transcript) | no (upload.single("file") = multipart/form-data) | added-origin-check ✓ |
| POST /voice/speak | voice.ts:463 | yes (external TTS API call) | yes (express.json inline) | none-needed |
| POST /voice/speak-stream | voice.ts:477 | yes (external TTS streaming call) | yes (express.json inline) | none-needed |

## Multipart remediations

The following endpoints were identified during Task 1a–1d as CORS-simple multipart/form-data POSTs (multer). Because they don't trigger a browser preflight, the widened JWT cookie from Plan 02 could be sent cross-origin by a page at `*.serve.term.<domain>` without the CORS reject firing. Each has been remediated in Task 2 via `multipart-origin-guard` (see `src/backend/utils/multipart-origin-guard.ts`):

| # | Endpoint | File:line | Applied |
|---|----------|-----------|---------|
| 1 | POST /host/db/host | host.ts:122 | ✓ |
| 2 | PUT /host/db/host/:id | host.ts:832 | ✓ |
| 3 | POST /identities/avatar/candidate/manual | identity-avatar-batch.ts:424 | ✓ |
| 4 | POST /users/create | users.ts:132 | ✓ |
| 5 | PUT /users/:id/avatar | users.ts:505 | ✓ |
| 6 | PUT /identities/:identityKey | identities.ts:421 | ✓ |
| 7 | POST /roles/ | roles-create.ts:275 | ✓ |
| 8 | POST /roles/:name/avatar | roles.ts:314 | ✓ |
| 9 | POST /voice/transcribe | voice.ts:432 | ✓ |

**Total multipart endpoints remediated: 9 across 7 files.**

_Correction from initial audit:_ POST `/host/quick-connect` (host.ts:681) was
originally listed as multipart but on re-read of the handler it accepts JSON
body only (`req.body.ip`, `req.body.port`, etc.) — no multer middleware in the
chain. Reclassified as preflight-triggering JSON; `none-needed` remediation.
Row corrected above in the `## Audit table` section too.

## Notes / edge cases

### GET-with-side-effects (OAuth callback flows)

Three GET routes have persistent side effects but are NOT CSRF-exploitable from `*.serve.term.<domain>`:

- **`host-opkssh-routes.ts:552 GET /opkssh-callback`** — invoked by the user's browser AFTER an OIDC IdP redirect, with an OAuth state param Skynet issued. A page at `*.serve.term.<domain>` cannot forge the state param (it doesn't have the corresponding server-side session state), so the callback rejects. Standard OAuth CSRF-defense (state param) gates the flow.
- **`users.ts:1028 GET /users/oidc/authorize`** — issues an OAuth state param + redirects to the IdP. Attacker can trigger this from any page, but the state param is bound to Skynet's session — attacker doesn't gain anything from causing the redirect (user just sees the IdP login page).
- **`users.ts:1121 GET /users/oidc/callback`** — companion to authorize; consumes the state param and mints the session cookie. Same state-param defense applies.

No remediation required for any of these; they're documented here for future auditors to skip re-analysis.

### Read-shaped SSH probes

`identity-exists-on-host.ts:64 GET /exists-on-host` runs an SSH stat call against a remote host. Classified `state_changing=no` because there's no persistent side effect. An attacker triggering this from a serve subdomain gains nothing (same-origin CORS blocks the response), and no target state changes.

### Cookie exfiltration via GET /users/me/token

`users.ts:2018 GET /users/me/token` returns the JWT session cookie value in a JSON response body. Because serve subdomains cannot read the response cross-origin (CORS blocks response reads too — Plan 02 D-07), this exfiltration path is not exploitable from `*.serve.term.<domain>`. Read-only classification stands.

### Dual-body-shape routes in `host.ts`

`host.ts:122 POST /db/host` and `host.ts:832 PUT /db/host/:id` both branch on `Content-Type` header (L131 + L844 check for `multipart/form-data`). The multipart branch (via multer `upload.single("key")`) is CORS-simple; the JSON branch preflights via app-level `bodyParser.json`. The `multipart-origin-guard` applies unconditionally — it rejects only when `Origin` matches `*.serve.term.<domain>`, orthogonal to Content-Type. JSON callers from any origin still preflight and get blocked by cors-config.ts. Both branches are safe post-remediation.

### Unauthenticated endpoints that intentionally have no login gate

`user-password-reset-routes.ts` (initiate/verify/complete-reset) + `user-totp-routes.ts:397 verify-login` + `users.ts:2038 setup-required` + `users.ts:1686 login` — all intentionally lack `authenticateJWT` because they are the entry points to auth flows. All use JSON body → preflight → CORS reject fires for serve-subdomain origins. Safe.

### Bash glob boundary — `identities.ts` (plural) sharding

The plan's Task 1a glob `identity*.ts` does NOT match plural `identities.ts` (bash literal wildcard). Consequently `identities.ts` (which has the multipart PUT `/:identityKey`) landed in shard 1d catch-all rather than 1a. Result is identical: it got audited, its multipart endpoint got remediated. Noted for future audit runs — if a re-audit wants `identities.ts` in the identity shard, use glob `identit*.ts` explicitly.

### Row-count sanity check on merge

- Fragment 1a: 39 route data rows + 8 `n/a` mounts = 47 markdown rows
- Fragment 1b: 4 route data rows (chat/room globs empty)
- Fragment 1c: 47 route data rows + 3 `n/a` mounts = 50 markdown rows
- Fragment 1d: 96 route data rows + 8 `n/a` mounts = 104 markdown rows
- **Merged audit table:** 186 distinct routes + 19 `n/a` middleware mounts = 205 data rows. All four fragments' `Fragment audit table` sections concatenated verbatim into `## Audit table` above (fragment headers dropped per plan). Grep counts data rows via pipe-delimited pattern.

### Preflight-triggering methods (browser CORS specification)

Per the Fetch standard, PUT / DELETE / PATCH always trigger preflight regardless of Content-Type. Only GET / HEAD / POST can be CORS-simple; POST is CORS-simple only when its Content-Type is `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`. This means:

- Every DELETE in the audit trivially preflights.
- Every PUT / PATCH trivially preflights.
- POST with `application/json` preflights.
- POST with `multipart/form-data` does NOT preflight — this is the class the audit's Multipart remediations target.
- POST with `application/x-www-form-urlencoded` does NOT preflight either — audit found ZERO such POSTs in the routes directory (every state-changing POST is either JSON or multipart).
