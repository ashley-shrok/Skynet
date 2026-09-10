# CSRF Audit — Fragment 1d: catch-all (skill + snippet + role + rbac + terminal + voice + credentials + tabs + misc)

**Shard scope:** all files under `src/backend/database/routes/*.ts` NOT covered by shards 1a-1c (excluding `*.test.ts` / `*.integration.test.ts`). This is the catch-all shard per plan Task 1d.

## Files audited (shard 1d scope)

- `src/backend/database/routes/agent-reset.ts`
- `src/backend/database/routes/alerts.ts`
- `src/backend/database/routes/c2s-tunnel-presets.ts`
- `src/backend/database/routes/compose-drafts.ts`
- `src/backend/database/routes/credential-deploy-routes.ts`
- `src/backend/database/routes/credential-key-routes.ts`
- `src/backend/database/routes/credentials.ts`
- `src/backend/database/routes/debug.ts`
- `src/backend/database/routes/delete-user-data.ts` — pure module (no routes)
- `src/backend/database/routes/global-files-config-loader.ts` — pure module (no routes)
- `src/backend/database/routes/global-files-read-write.ts`
- `src/backend/database/routes/global-files.ts`
- `src/backend/database/routes/identities.ts` (falls here because bash glob `identity*.ts` does NOT match `identities.ts`)
- `src/backend/database/routes/message-queue.ts`
- `src/backend/database/routes/network-topology.ts`
- `src/backend/database/routes/open-tabs.ts`
- `src/backend/database/routes/opkssh-html.ts` — HTML surface (no routes)
- `src/backend/database/routes/pretty-view-fetch-host-file.ts` — the router is defined but registers via `prettyViewFetchHostFileRoutes.post` (not `router.post`); still counted
- `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts`
- `src/backend/database/routes/rbac.ts`
- `src/backend/database/routes/roles-create.ts`
- `src/backend/database/routes/roles-list-for-host.ts`
- `src/backend/database/routes/roles.ts`
- `src/backend/database/routes/runbooks-editor.ts`
- `src/backend/database/routes/skills-editor.ts`
- `src/backend/database/routes/snippets-reorder.ts` — pure module (helper re-export; no routes)
- `src/backend/database/routes/snippets.ts`
- `src/backend/database/routes/terminal.ts`
- `src/backend/database/routes/usage.ts`
- `src/backend/database/routes/voice.ts`

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
| PUT /identities/:identityKey | identities.ts:421 | yes (writes identity markdown + avatar over SSH) | **no (upload.single("avatar") = multipart/form-data)** | **added-origin-check** |
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
| POST /roles/ | roles-create.ts:275 | yes (INSERT role + optional avatar over SSH) | **no (upload.single("avatar") = multipart/form-data)** | **added-origin-check** |
| USE /roles (error handler) | roles-create.ts:619 | n/a (middleware mount) | n/a | n/a |
| GET /roles/ | roles-list-for-host.ts:108 | no (list roles for host) | no | none-needed |
| USE /roles (error handler) | roles-list-for-host.ts:282 | n/a (middleware mount) | n/a | n/a |
| GET /roles/:name/avatar | roles.ts:132 | no (read role avatar over SSH) | no | none-needed |
| POST /roles/:name/avatar | roles.ts:314 | yes (writes role avatar bytes over SSH) | **no (upload.single("avatar") wrapped in async gate = multipart/form-data)** | **added-origin-check** |
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
| POST /voice/transcribe | voice.ts:432 | yes (external STT API call; caches transcript) | **no (upload.single("file") = multipart/form-data)** | **added-origin-check** |
| POST /voice/speak | voice.ts:463 | yes (external TTS API call) | yes (express.json inline) | none-needed |
| POST /voice/speak-stream | voice.ts:477 | yes (external TTS streaming call) | yes (express.json inline) | none-needed |

**Row count (data rows, excluding `n/a` middleware mounts):** 96 route rows + 8 `n/a` middleware mounts = 104 markdown table rows.

## Fragment notes

- **identities.ts:421 PUT /:identityKey — multipart (multer).** Uses the file-local `upload.single("avatar")` (defined at L49-52). Writes identity markdown + optional avatar to remote host via SSH. Multipart is CORS-simple → `added-origin-check` required.
- **roles-create.ts:275 POST / — multipart (multer).** File-local `upload.single("avatar")` at L146. Creates a role with optional avatar bytes; writes to remote host via SSH. Multipart → `added-origin-check`.
- **roles.ts:314 POST /:name/avatar — multipart (multer wrapped in async gate).** File-local `upload.single("avatar")` at L117; wrapping (L344) runs after roleName/hostId gates fire. Guard applies BEFORE the wrapped multer parse — Origin check is orthogonal to body-shape. `added-origin-check` required.
- **voice.ts:432 POST /transcribe — multipart (multer).** File-local `upload.single("file")` at L437. Uploads a voice clip for external STT. Multipart → `added-origin-check`.
- **credential-key-routes.ts POST endpoints — parse-only, no persistence.** L94-351 are all client-side helpers that classify or generate key material without hitting the DB. Classified as `state_changing=no` because there's no persistent side effect, but they DO carry sensitive input in the body — worth noting even though remediation is `none-needed`.
- **pretty-view-fetch-host-file.ts + pretty-view-fetch-tailnet-url.ts POSTs use scoped express.json** — small body budgets (2kb/8kb) plus JSON Content-Type mean they preflight normally. Read-only proxies (fetch remote file / URL, return bytes).
- **runbooks-editor + skills-editor** — every write path uses scoped `express.json({ limit: "32kb" })` or `express.json({ limit: "4mb" })` for the actual file body. Non-file paths (delete file, delete skill) also use scoped express.json but that's for the body carrying `{hostId, path}` metadata. All preflight.
- **usage.ts GET / is unauthenticated (no `authenticateJWT`)** — it proxies to an external usage endpoint and returns cached results. Read-only + no session context; CSRF is not applicable (nothing to forge that alters user state).
- **`identities.ts` (plural)** landed here because bash glob `identity*.ts` doesn't match plural `identities.ts`. Notable because its PUT is one of the multipart endpoints.
- **debug.ts POST /console-log** ingests structured log entries from the frontend into the server-side console-forward log. Writes to a filesystem log file (side effect). JSON body → preflights. Not exploitable target — an attacker forging log entries has no path to session mutation.
- **snippets.ts:694 POST /execute is high-value target** — SSH-exec of an arbitrary user-owned snippet on a user-owned host. JSON body → preflights → safe. Cross-checked: no urlencoded form body path.
- **agent-reset.ts:128 POST /:hostId/:tmuxSessionName** — drops sentinel files over SSH (context-recycle signal). JSON body → preflights → safe.
