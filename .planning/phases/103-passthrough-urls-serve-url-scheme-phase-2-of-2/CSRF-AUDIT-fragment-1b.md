# CSRF Audit — Fragment 1b: chat + room + relay routes

**Shard scope:** files matching `src/backend/database/routes/chat*.ts`, `src/backend/database/routes/room*.ts`, and `src/backend/database/routes/relay*.ts` (excluding `*.test.ts`).

**Note on empty globs:** no files match `chat*.ts` (empty) or `room*.ts` (empty) — chat + rooms surface lives outside `src/backend/database/routes/` (relay-room-stream server is a WebSocket surface under `src/backend/relay-room-stream/`, out of this shard's scope). Only `relay*.ts` files present.

## Files audited (shard 1b scope)

- `src/backend/database/routes/relay-pointer.ts`
- `src/backend/database/routes/relay-registry-backfill.ts`
- `src/backend/database/routes/relay-room-create.ts`
- `src/backend/database/routes/relay-room-participants.ts`

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
| GET /relay-pointer/ | relay-pointer.ts:158 | no (resolve relay-pointer by public id) | no | none-needed |
| POST /relay-room/backfill | relay-registry-backfill.ts:97 | yes (backfill relay-room registry rows) | yes (app-level bodyParser.json — no override) | none-needed |
| POST /relay-room/create | relay-room-create.ts:224 | yes (INSERT relay-room + Matrix room create) | yes (app-level bodyParser.json — no override) | none-needed |
| GET /relay-room/:roomId/participants | relay-room-participants.ts:159 | no (list participants) | no | none-needed |

**Row count (data rows):** 4 route rows.

## Fragment notes

- **Shard is small by design.** The `chat*.ts` and `room*.ts` globs match nothing under `src/backend/database/routes/` — chat/room state largely lives in Matrix (an external homeserver) rather than local Skynet routes. Relay-room lifecycle routes are all that surface here.
- **All POSTs preflight** via the app-level `bodyParser.json({ limit: "1gb" })` mounted in `src/backend/database/database.ts:285`. None of the relay routes install their own body parsers, so the app-level JSON parser (and its Content-Type: application/json expectation) is what makes them preflight-triggering.
- **No multipart endpoints** in shard 1b — no multer/busboy/formidable imports, no `multipart/form-data` handling. Zero remediations needed for this shard.
- **relay-room-stream WebSocket** lives at `src/backend/relay-room-stream/relay-room-stream-server.ts` — already guarded by `verifyClient` per Plan 06 (D-08). Out of scope for this HTTP-route audit; explicitly closed by Plan 06.
