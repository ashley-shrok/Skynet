# Fleet-Status Scripts

## Purpose

One-off orchestrator tools for the Skynet fleet-status SSH-poll pipeline. These
scripts are NOT part of the running Skynet backend, are NOT unit-tested, and are
hand-run by tina (the orchestrator) as documented below.

The scripts live here so they are version-controlled alongside the backend modules
they exercise, but they are never `import()`ed by any backend module.

---

## Fail-open guarantee (LOCKED)

Per Ashley 2026-08-13 verbatim: *"just make sure that it fails open if the file
that the hook is supposed to generate isn't found"*.

**If the operator finds the payload file missing on a host AND the orchestrator is
still publishing SessionStates for that host's sessions, that is CORRECT behavior,
not a bug.** The dot may under-report background work on that host until the Stop
hook is (re-)installed, but the app stays functional. The orchestrator emits at
most ONE `operation: 'fleet_status_hook_payload_missing'` WARN per host per 60
seconds — search the backend log for this operation string to confirm the
orchestrator has noticed the missing file.

---

## How to install the Stop hook on a new identity-hosting host

The `ssh-poll-orchestrator` does NOT auto-install the Stop hook — the operator
must be explicit about touching `~/.claude/settings.json` on a managed host.

Run this `node -e` snippet (replace `<HOST_IP>`, `<USERNAME>`, and `<KEY_PATH>`):

```bash
node -e "
import('./dist/backend/fleet-status/remote-hook-install.js').then(async m => {
  const { Client } = await import('ssh2');
  const conn = new Client();
  conn.on('ready', async () => {
    const channel = {
      exec: (cmd) => new Promise((resolve) => {
        conn.exec(cmd, (err, stream) => {
          if (err) { resolve(null); return; }
          let out = '';
          stream.on('data', d => out += d);
          stream.stderr.on('data', () => {});
          stream.on('close', () => resolve(out));
        });
      })
    };
    try {
      const result = await m.installStopHook(channel);
      console.log('Install result:', result);
    } finally {
      conn.end();
    }
  });
  conn.connect({
    host: '<HOST_IP>',
    port: 22,
    username: '<USERNAME>',
    privateKey: require('fs').readFileSync('<KEY_PATH>'),
    hostVerifier: () => true,
  });
});
"
```

After install, confirm:
- `~/.claude/settings.json` on the target contains a `hooks.Stop[0].hooks[]` entry
  pointing at `~/.claude/hooks/skynet-fleet-status-stop.sh`.
- `~/.claude/hooks/skynet-fleet-status-stop.sh` exists and is executable.

---

## How to run verify-monitor-payload.sh

```bash
bash src/backend/fleet-status/scripts/verify-monitor-payload.sh <hostname>
```

**Expected exit codes:**
- `0` — OK. At least one `type: 'monitor'` entry was captured; payload printed.
- `2` — Payload file missing or empty on `<hostname>`. The Stop hook has not
  yet captured a payload (hook not installed, or no turn has completed since install).
  Install the hook, trigger a Stop event (any turn completion in a Claude Code session),
  then re-run.
- `3` — Payload captured but no `monitor`-type entries present. The last Stop event
  had no live Monitors. Launch a Monitor from the scratch identity's Claude Code
  session (e.g. `/use Monitor "sleep 60"`), trigger another Stop, then re-run.

**When to run:** Before scheduling Plan 06 (frontend cutover), run against the scratch
identity to close RESEARCH § OQ-2. Attach the captured raw JSON to `34-04-SUMMARY.md`
as evidence. If the `description_prefix` field shows `[ambient] ` for the persistent
Monitors, Plan 05 ambient tagging is already landed.

**Interpreting output:**
- `--- All background_tasks[] entries (raw) ---` — the full array from the Stop payload.
- `--- Monitor-type entries ---` — filtered to `type == "monitor"` entries only.
- `--- Field-presence check ---` — one JSON object per Monitor entry showing id, type,
  status, `has_description`, `description_prefix` (first 12 chars), `has_server`,
  `has_tool`. Compare against RESEARCH § 1 field table to confirm the payload shape
  matches expectations before Plan 06 ships the ambient filter.

---

## How to uninstall the Stop hook

```bash
node -e "
import('./dist/backend/fleet-status/remote-hook-install.js').then(async m => {
  const { Client } = await import('ssh2');
  const conn = new Client();
  conn.on('ready', async () => {
    const channel = {
      exec: (cmd) => new Promise((resolve) => {
        conn.exec(cmd, (err, stream) => {
          if (err) { resolve(null); return; }
          let out = '';
          stream.on('data', d => out += d);
          stream.stderr.on('data', () => {});
          stream.on('close', () => resolve(out));
        });
      })
    };
    try {
      await m.uninstallStopHook(channel);
      console.log('Hook uninstalled');
    } finally {
      conn.end();
    }
  });
  conn.connect({
    host: '<HOST_IP>',
    port: 22,
    username: '<USERNAME>',
    privateKey: require('fs').readFileSync('<KEY_PATH>'),
    hostVerifier: () => true,
  });
});
"
```

Note: uninstall intentionally leaves `~/.claude/fleet-status/last-stop-payload.json`
in place for post-mortem inspection.

---

## Log locations

The orchestrator logs to the standard Skynet backend log destination:
`/opt/skynet/console-forward-logs/console-forward.log`

All orchestrator log lines use `operation: 'fleet_status_*'` prefixes:

| operation | meaning |
|---|---|
| `fleet_status_orchestrator_started` | backend boot, orchestrator initialized |
| `fleet_status_poll_start` | 2s poll cycle started for a host |
| `fleet_status_poll_end` | 2s poll cycle ended for a host |
| `fleet_status_session_state_published` | SessionState delta published to registry |
| `fleet_status_stale_reap` | PID reaped as stale, session_gone published |
| `fleet_status_hook_payload_missing` | WARN — hook payload file missing/empty/malformed (rate-limited to 1 per 60s per host) |
| `fleet_status_host_ssh_unreachable` | WARN — SSH channel unavailable for a host |
| `fleet_status_sweep_run` | 30s stale sweep started |
| `fleet_status_hook_install_complete` | remote-hook-install: hook installed + settings updated |
| `fleet_status_hook_install_already_present` | remote-hook-install: idempotent no-op |
| `fleet_status_hook_install_settings_read_failed` | remote-hook-install: SSH read error |
| `fleet_status_hook_install_settings_invalid_json` | remote-hook-install: settings.json is invalid JSON |

The hook script itself (`stop-hook.sh`) writes ONLY to
`~/.claude/fleet-status/last-stop-payload.json` on the identity-hosting box.
No separate log file — the hook is fire-and-forget.

---

## What NOT to add here

Do NOT add:
- Per-box daemon scripts
- systemd unit templates
- Persistent install scripts (any script that starts a process that runs continuously)

The 2026-08-13 pivot (LOCKED) forbids all of those shapes. The watcher IS the Skynet
backend. Delivery is 2s SSH polling. The Stop hook is a one-time file drop.
