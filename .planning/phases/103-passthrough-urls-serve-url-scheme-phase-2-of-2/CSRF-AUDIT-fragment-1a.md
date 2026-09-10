# CSRF Audit — Fragment 1a: host + identity routes

**Shard scope:** files matching `src/backend/database/routes/host*.ts` and `src/backend/database/routes/identity*.ts` (excluding `*.test.ts`). Note: `identities.ts` (plural) does NOT match `identity*.ts` and is audited in shard 1d catch-all.

## Files audited (shard 1a scope)

- `src/backend/database/routes/host-autostart-routes.ts`
- `src/backend/database/routes/host-bulk-routes.ts`
- `src/backend/database/routes/host-command-history-routes.ts`
- `src/backend/database/routes/host-file-manager-bookmark-routes.ts`
- `src/backend/database/routes/host-folder-routes.ts`
- `src/backend/database/routes/host-internal-routes.ts`
- `src/backend/database/routes/host-network-routes.ts`
- `src/backend/database/routes/host-normalizers.ts` — pure module (no routes)
- `src/backend/database/routes/host-opkssh-routes.ts`
- `src/backend/database/routes/host.ts`
- `src/backend/database/routes/identity-avatar-batch.ts`
- `src/backend/database/routes/identity-birth-orchestrator.ts` — pure module (no routes)
- `src/backend/database/routes/identity-birth.ts`
- `src/backend/database/routes/identity-clone.ts`
- `src/backend/database/routes/identity-exists-on-host.ts`
- `src/backend/database/routes/identity-harness-start.ts` — pure module (no routes)
- `src/backend/database/routes/identity-no-dormancy.ts`

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
| GET /host/opkssh-callback | host-opkssh-routes.ts:552 | yes (writes OPKSSH token to disk, DB update) | no (GET — but with meaningful side effect from OAuth callback flow) | none-needed (external callback from IdP redirect; not user-driven cross-origin. Origin is IdP not browser JS; CSRF from serve subdomains cannot forge OIDC callback state param) |
| USE /host/* (opkssh-html mount) | host-opkssh-routes.ts:723 | n/a (middleware mount) | n/a | n/a |
| POST /host/db/host | host.ts:122 | yes (INSERT host + SSH key) | **no (multer upload.single("key") = multipart/form-data)** | **added-origin-check** |
| POST /host/quick-connect | host.ts:681 | yes (transient host register + connect) | **no (multer upload.single("key") = multipart/form-data)** | **added-origin-check** |
| PUT /host/db/host/:id | host.ts:832 | yes (UPDATE host + optional SSH key) | **no (multer upload.single("key") — multipart branch used when Content-Type header includes multipart/form-data; JSON branch preflights)** | **added-origin-check** (multipart branch; JSON branch already preflights) |
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
| POST /identities/avatar/candidate/manual | identity-avatar-batch.ts:424 | yes (INSERT candidate avatar) | **no (manualUpload = multer memoryStorage → multipart/form-data)** | **added-origin-check** |
| USE /identities/avatar (multer error middleware) | identity-avatar-batch.ts:453 | n/a | n/a | n/a |
| GET /identities/avatar/candidate/:id | identity-avatar-batch.ts:484 | no (read candidate) | no | none-needed |
| POST /identities/birth/ | identity-birth.ts:84 | yes (INSERT identity + orchestrator kickoff) | yes (express.json on L86) | none-needed |
| POST /identities/birth/retry/:key | identity-birth.ts:471 | yes (retry orchestrator step) | yes (express.json inline on L471) | none-needed |
| USE /identities/birth (mount) | identity-birth.ts:614 | n/a | n/a | n/a |
| POST /identities/clone/ | identity-clone.ts:279 | yes (INSERT clone request + orchestrator kickoff) | yes (express.json({limit:"64kb"}) on L290) | none-needed |
| USE /identities/clone (mount) | identity-clone.ts:837 | n/a | n/a | n/a |
| GET /identities/exists-on-host | identity-exists-on-host.ts:64 | no (SSH probe for identity existence — no DB write, but SSH exec is a side effect) | no | none-needed (GET with SSH probe — read-shaped; not CSRF-usable target since attacker gains nothing from triggering a stat call) |
| USE /identities (mount) | identity-exists-on-host.ts:162 | n/a | n/a | n/a |
| GET /identities/:key/no-dormancy | identity-no-dormancy.ts:66 | no (read sentinel state) | no | none-needed |
| PUT /identities/:key/no-dormancy | identity-no-dormancy.ts:159 | yes (writes sentinel file over SSH) | yes (express.json on L161 + PUT preflights) | none-needed |
| USE /identities (mount) | identity-no-dormancy.ts:261 | n/a | n/a | n/a |

**Row count (data rows only, excluding `n/a` middleware mounts):** 39 route rows + 8 `n/a` mount rows = 47 markdown table rows.

## Fragment notes

- **host.ts:832 PUT /db/host/:id — dual-body-shape route.** The handler branches on `Content-Type` header (L844: `if (req.headers["content-type"]?.includes("multipart/form-data"))`). The multipart branch (multer `upload.single("key")` at L836) is CORS-simple; the JSON branch preflights via app-level `bodyParser.json`. Applying `multipart-origin-guard` unconditionally is safe — it rejects only when `Origin` matches `*.serve.term.<domain>`, orthogonal to Content-Type. JSON callers from any origin still preflight and get blocked by cors-config.ts. Recorded as `added-origin-check` because the guard MUST apply to close the multipart branch's non-preflight hole.
- **host.ts:122 POST /db/host — dual-body-shape route.** Same branching pattern as PUT (L131 checks multipart). Guard applies unconditionally.
- **host.ts:681 POST /quick-connect — multipart via multer.single("key").** Same pattern; guard applies unconditionally.
- **identity-avatar-batch.ts:424 POST /candidate/manual — pure multipart-only.** Uses `manualUpload` (a dedicated multer instance, L412). Guard applies straight.
- **host-opkssh-routes.ts:552 GET /opkssh-callback — GET-with-side-effect BUT not CSRF-exploitable.** The callback is invoked by the user's browser AFTER an OIDC IdP redirect, with an OAuth state param that Skynet issued. A page at `*.serve.term.<domain>` cannot forge that state param — the OAuth flow itself gates the callback. Classified as `state_changing=yes, preflight_triggering=no, remediation=none-needed` with this rationale noted.
- **identity-exists-on-host.ts:64 GET /exists-on-host — read-shaped SSH probe.** No DB writes, no persistent state change. An attacker triggering this from a serve subdomain would only cause the backend to run a stat call over SSH — no exfiltration back to the attacker's page (same-origin response blocks read); no state change on the target. Classified as read-only.
- **identities.ts (plural) is NOT in this shard** — `identity*.ts` bash glob doesn't match `identities.ts`. It falls to shard 1d catch-all.
