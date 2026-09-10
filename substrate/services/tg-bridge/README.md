# tg-bridge substrate service

Phase 79 Plan 05 — Telegram <-> Matrix bridge, deployed as a Docker Compose service alongside skynet / caddy / guacd / filestash.

## What this is

- `bridge.sh` — the Phase B rewrite of Nina's bridge, following the shape of `/home/thenasty/.config/tg-bridge/bridge.sh` (thenasty install, being retired; local snapshot at `.planning/refs/79-nina-bridge-snapshot.sh`) plus six load-bearing changes:
  1. Reads config from `/state/config.env` (never hardcodes IPs).
  2. Persists Matrix `since` cursor per human to `/state/{humanName}.since` (mirrors `substrate/skills/agent-relay/recv.sh` CURSOR GUARD pattern).
  3. Deletes the relogin / password-file code path — bridge no longer knows how to re-auth (Skynet's `matrix-admin-client.loginAsUser` mints tokens via admin, Plan 04).
  4. Writes `/state/{humanName}.token-dead` sentinel on Matrix 401 for that human; Skynet's reconcile pass (Plan 08) picks it up and re-mints.
  5. Reloads on registry change via `inotifywait -m /state/registry.json`.
  6. Reads bot tokens from `/state/{identityKey}.bottoken` files (blocker B-1 — Skynet writes these via Plan 04's bot-token-file-writer; registry.json in Phase B has no inline `bot_token`).
- `Dockerfile.tg-bridge` — small debian:bookworm-slim image with bash, curl, jq, inotify-tools.
- `cursor-persistence-repro.sh` — automated bash test that exercises the CURSOR GUARD invariant (blocker B-3).

## Filesystem layout inside the container

`/state/` is the shared named Docker volume `tg-bridge-state` (see `docker/docker-compose.yml` Plan 06). Both `skynet` and `tg-bridge` containers mount it at the same path.

Skynet writes:
- `/state/config.env` — MATRIX_ROOT + SKYNET_BASE + SKYNET_BRIDGE_TOKEN (Plan 04 startup + on config change; Phase 98 Plan 08 dropped the old direct-to-Chatterbox `STT_URL` write and swapped it for a bridge-scoped Bearer JWT that authenticates bridge → Skynet's `/voice/transcribe` — the bridge now routes voice-note STT through Skynet's backend and stays provider-agnostic per D-Telegram-bridge-STT locked 2026-09-10)
- `/state/registry.json` — agent+humans structure (Plan 04 on every activate/disconnect via `rewriteRegistryFromCurrentState`; also on startup one-shot)
- `/state/{humanName}.token` — Matrix tokens minted via admin loginAsUser
- `/state/{identityKey}.bottoken` — Telegram bot tokens (Plan 04 `bot-token-file-writer`, blocker B-1 fix)

Bridge writes:
- `/state/{humanName}.since` — Matrix cursor per human (load-bearing reliability)
- `/state/{humanName}.token-dead` — sentinel on Matrix 401 (Skynet reconciles + unlinks)
- `/state/offset.{agentSlug}` — Telegram getUpdates offset per bot
- `/state/work/` — scratch dir for in-flight media
- `/state/bridge.log` — human-readable ops log (rotates via Docker log driver, not the bridge)

## Expected steady-state log lines (blocker W-7)

Healthy first-boot log tail (from `docker logs tg-bridge --tail 20`):
- `[tg-bridge] waiting for /state/config.env (attempt 1/60)` — appears once at boot if Skynet hasn't yet written config
- `[tg-bridge] waiting for /state/config.env (attempt 10/60)` — appears IF wait extends past 50s; every-10-attempts milestone log
- `[tg-bridge] /state/config.env present — sourcing config` — appears once config arrives
- `[tg-bridge] config sourced: MATRIX_ROOT=... SKYNET_BASE=...` — sanity echo of resolved values (SKYNET_BRIDGE_TOKEN is intentionally NOT echoed — Bearer credential; STRIDE T-98-08-02)
- `[tg-bridge] starting main loop — spawning pollers + sync loops + reload watcher`
- `[tg-bridge] registry.json changed — re-exec` — appears each time Skynet writes registry.json (activate/disconnect)

Failure signals (loud):
- `[tg-bridge] FATAL: /state/config.env not present after 5 min; exiting.` — Skynet never wrote config; investigate Plan 04 ensureBridgeConfigWritten wiring
- `[tg-bridge] LOUD: <human> Matrix token dead — sentinel written at /state/<human>.token-dead` — Skynet reconcile should pick this up within 30s (Plan 08)
- `[tg-bridge] WARN: no .bottoken for <agent>` — Plan 04 bot-token-file-writer didn't run for this agent; check Plan 03's activate handler or Plan 04 syncAllBotTokenFiles
- `[tg-bridge] FATAL: curl not found on PATH — check Dockerfile.tg-bridge` (or jq, inotifywait) — Dockerfile drift, image needs rebuild

## Ops

- Image build: `docker build -t tg-bridge:local -f substrate/services/tg-bridge/Dockerfile.tg-bridge substrate/services/tg-bridge/`
- Logs: `docker logs tg-bridge` (Compose service name from Plan 06).
- Restart on registry change: automatic (inotifywait re-exec, <5s).
- Restart from operator: `docker restart tg-bridge`.
- Byte-level state inspection from the host: `sudo ls /var/lib/docker/volumes/tg-bridge-state/_data/`.
- Repro cursor persistence: `bash substrate/services/tg-bridge/cursor-persistence-repro.sh` (blocker B-3).

## Cutover from Nina's install

Nina's install at `/home/thenasty/.config/tg-bridge/` on thenasty (100.113.23.63) can be shut down AFTER Skynet's bridge is verified working (Plan 09 checkpoint). Bot tokens migrate through Skynet's `telegram_bot_tokens` table; per-human Matrix tokens re-mint via admin (Plan 08 migration endpoint). No BotFather work needed — bot tokens are portable.
