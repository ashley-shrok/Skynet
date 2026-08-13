# @skynet/fleet-status-watcher

Per-managed-box fleet-status watcher daemon. Reads `~/.claude/sessions/<pid>.json` files via inotify, cross-checks PID liveness via `/proc/<pid>/stat` field 22, resolves PID to tmux session name, and consumes Claude Code Stop hook payloads to merge background tasks.

## Architecture

```
~/.claude/sessions/<pid>.json  ──inotify──>  session-json-watcher.ts
                                                   |
                                          isPidAlive() [liveness-check.ts]
                                          resolveTmuxSession() [pid-to-tmux.ts]
                                                   |
/tmp/fleet-status-hook-<uid>.sock  ──socket──>  stop-hook-socket.ts
                                                   |
                                          filterAmbientTasks()
                                                   |
                                         index.ts (merge + emit)
                                                   |
                                          stdout (one JSON line per event)
                                          [Plan 04: replace stdout with WS client]
```

## Subpackage Layout

```
src/fleet-status-watcher/
  package.json              — @skynet/fleet-status-watcher, type: module
  tsconfig.json             — strict, NodeNext, ES2022
  vitest.config.ts          — standalone vitest config (separate from Skynet root)
  README.md                 — this file
  src/
    types.ts                — SessionState, BackgroundTask, SessionJson, StopHookPayload
    logger.ts               — watcherLogger (structured JSON, explicit field extraction)
    liveness-check.ts       — isPidAlive(), readProcStart() via /proc/<pid>/stat
    pid-to-tmux.ts          — resolveTmuxSessionForPid() + per-PID cache
    session-json-watcher.ts — inotify watcher + initial scan + 30s liveness sweep
    stop-hook-socket.ts     — Unix domain socket server + filterAmbientTasks()
    index.ts                — entrypoint: wires all modules, stdout transport
    *.test.ts               — unit tests for every non-trivial module
  dist/                     — compiled output (gitignored)
```

## Build

```bash
cd src/fleet-status-watcher
npm install
npm run build        # tsc → dist/
```

## Run Locally

```bash
node dist/index.js
```

Environment variables:
- `HOME` — location of `~/.claude/sessions/` (default: current user home)
- `FLEET_HOST_ID` — override hostname for the `hostId` field in emitted JSON
- `FLEET_SOCK_PATH` — override Unix socket path (default: `/tmp/fleet-status-hook-<uid>.sock`)

Logs go to **stderr** as one JSON line per lifecycle event. Session state frames go to **stdout** as one JSON line per event. This separation allows the orchestrator (Plan 04) to pipe stdout to a WS connection while letting stderr flow to journald.

## Test

```bash
cd src/fleet-status-watcher
npm test                        # all tests
npx vitest run src/types.test.ts src/logger.test.ts       # Task 1 subset
npx vitest run src/liveness-check.test.ts src/pid-to-tmux.test.ts  # Task 2 subset
npx vitest run src/session-json-watcher.test.ts src/stop-hook-socket.test.ts  # Task 3 subset
```

## Update Mechanism

The watcher lives in its own subpackage so it can be deployed/updated independently of a Skynet redeploy:

1. Build on skynet-ec2: `npm run build` in this directory → produces `dist/index.js`
2. Upload to each identity box via SCP: `scp -r dist/ <box>:~/.local/lib/fleet-status-watcher/`
3. Restart the systemd user service: `ssh <box> systemctl --user restart fleet-status-watcher`

This is a Plan 04 task — the deploy script and systemd unit template are created there.

## Signal Sources

### Primary: `~/.claude/sessions/<pid>.json` (inotify)
- Updated by Claude Code harness on every status change (`busy`, `shell`, `idle`, `waiting`)
- Contains `procStart` for PID-reuse detection
- Contains `sessionId` for Skynet conversation row correlation

### Complementary: Stop hook (Unix socket)
- Claude Code fires the Stop hook at end of each turn
- Delivers `background_tasks[]` with ambient Monitor entries filtered by `[ambient]` description prefix
- Hook registered in `~/.claude/settings.json` at `hooks.Stop[0]`

### Liveness sweep (30s periodic)
- Re-checks `/proc/<pid>/stat` field 22 vs `procStart` for all tracked PIDs
- Reaps any that have died since last inotify event (catches SIGKILL victims)

## Unix Socket Path Convention

`/tmp/fleet-status-hook-<uid>.sock` where `<uid>` is the numeric UID of the user running the watcher.

The Stop hook script (deployed by Plan 04) writes to this path. Example for uid=1000:
```
/tmp/fleet-status-hook-1000.sock
```

## SessionState Wire Shape

The following JSON shape is emitted to stdout for each live session event:

```json
{
  "hostId": "skynet-ec2",
  "tmuxSession": "tina",
  "sessionId": "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
  "pid": 3941934,
  "status": "busy",
  "waitingFor": "approve Bash",
  "backgroundTasks": [],
  "updatedAt": 1786577996976
}
```

Note: `waitingFor` is only present when `status === "waiting"`. `tmuxSession` is `null` if the Claude process is not running inside tmux.

## Log Destination

Per-box watcher logs to stderr → captured by systemd journal (Plan 04 systemd unit). View with:
```bash
journalctl --user -u fleet-status-watcher -f
```
