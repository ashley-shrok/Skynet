---
name: sensor-development
description: |
  Builds a sensor: agent-written logic that fires a wake-up or a scheduled task
  when it decides to, instead of on the clock, and hands over what it found.
  Use when a wake-up or scheduled task should be triggered by something
  happening (an email arriving, a page changing, a value crossing a line) rather
  than by a time, or when editing or fixing an existing sensor.
distributed: true
---

# sensor-development

## What a sensor is

A sensor is a **trigger type** for wake-ups and scheduled tasks, next to
interval/daily/weekly/one-shot. A trigger whose schedule is `{"type": "sensor"}`
is never fired by the clock — its sensor fires it. Firing does what it always
does: a **wake-up** wakes the identity it belongs to (from dormancy if needed);
a **scheduled task** births a fresh agent. What the sensor found rides along.

You write only the logic. The box supplies the rest: the service it runs in,
restarts, cadence, cleanup, health, and delivery of each fire. The box does
none of the sensor's thinking — no polling for it, no memory, no de-duplication.
Checking, remembering what was already seen, and deciding to fire are all yours.

**Governance is unchanged.** A sensor-triggered wake-up or scheduled task is
still a wake-up or scheduled task: only the user authorizes creating one (she
asks, or says yes to your suggestion). Agents never self-schedule.

## Where it lives

The sensor lives inside the folder of the trigger it fires:

```
~/fleet/identities/<you>/wakeups/<slug>/      a wake-up
  wakeup.json                                 {"name": ..., "enabled": true,
                                               "schedule": {"type": "sensor"},
                                               "instruction": "what to do with the findings"}
  sensor/                                     your logic + your own memory files
    sensor.json.pending  →  sensor.json       settings; renaming publishes (goes live)
  fires/                                      pending fires (written by sensor-fire)
    delivered/                                fires already handed over
  .state/                                     box-written: health, log, unit name

~/fleet/scheduled-agents/<slug>/              a scheduled task — same shape, with
  scheduled-agent.json                        "schedule": {"type": "sensor"} and its `prompt`
  sensor/  fires/  .state/
```

Your code never names an identity, a task or a path to fire: the folder it sits
in decides which trigger it fires. Keep your memory (watermarks, last-seen ids)
in files inside `sensor/`.

## The two ways to run

- `"run": "always"` — started once and kept running; restarted if it dies. For listeners (push connections, watching a socket, serving a webhook).
- `"run": "cadence"` — started on a schedule, runs, exits; nothing runs between runs. For checks.

```json
{ "run": "always",  "command": "bun run sensor.mjs" }
{ "run": "cadence", "cadence": { "type": "interval", "every": "5m" }, "command": "python3 check.py" }
```

`cadence` takes any repeating schedule a wake-up can have (interval with
`window`/`days`, daily, weekly, monthly, yearly, `timezone`, …). The first
cadence slot after publishing anchors; the first run is one cadence later.

`command` runs through `/bin/sh` inside `sensor/`, as you, with your normal
access. Environment: `SENSOR_DIR`, `SENSOR_TRIGGER_DIR`, and a `PATH` that has
`~/.local/bin` and `~/.bun/bin`. Anything it prints goes to `.state/sensor.log`.

## Firing

```sh
sensor-fire "3 candidate delivery emails: ..."     # findings as arguments
some-check | sensor-fire                           # or on stdin (verbatim, multi-line is fine)
sensor-fire                                        # fire with no findings
```

Each call drops one fire. Every fire is delivered, separately and in order —
nothing is merged or dropped, so fire once per thing worth acting on (or once
per batch, if one batch is one thing). Exit quietly when there's nothing.

How it arrives:

- **Wake-up** — a line in the identity's conversation:
  `📡 [sensor: <slug> @ <fire time UTC>] <instruction> — findings: <text>`.
  Long or multi-line findings are pointed at instead (`… findings (N chars) at
  <path> — Read it`). Fires that land while the wake-up is switched off wait
  and are delivered, with their original fire time, when it's switched on.
- **Scheduled task** — one fresh agent per fire; its first instruction is the
  task's prompt followed by a `## What the sensor found` section.

## One-time sensors

For "tell me once, then go away" (e.g. "let me know when that agent is done"),
mark the trigger one-time: `"schedule": {"type": "sensor", "once": true}`. The
sensor itself is written exactly as usual — it doesn't know or care.

After the box delivers the **first** fire, it retires the trigger: the
wake-up's or task's spec is removed, its sensor is stopped within ~30s, and the
rest of the folder goes a day later (so a findings file the 📡 line points at
stays readable). Only the oldest waiting fire is delivered; any others go with
the trigger. A one-time wake-up's 📡 line ends with
`(one-time sensor — this wake-up has now retired)` — nothing to delete by hand.
While switched off, its fire waits like any sensor's.

Never retire a trigger from inside the sensor (deleting its own folder): a fire
not yet delivered would be lost. There is no built-in expiry — if your sensor
should give up, fire with that as the findings (e.g. "gave up after 2 days").

## Making one

1. Get the user's go-ahead for the wake-up or scheduled task (governance above).
2. Create the trigger with `"schedule": {"type": "sensor"}` (add `"once": true`
   for a one-time sensor) — for a wake-up, `wakeups/<slug>/wakeup.json`; its
   `instruction` says what to do with findings.
3. Write the logic in `<trigger>/sensor/`, plus `sensor.json.pending`.
4. Test by hand from inside `sensor/`: run the command yourself. `sensor-fire`
   works there too (it finds the trigger by walking up), so you can watch a real
   fire arrive.
5. Publish: `mv sensor.json.pending sensor.json`. Within ~30s the box creates
   its service (and for "always", starts it).
6. Check `.state/sensor-health.json` shows it healthy.

## Running, changing, stopping

- **Health** — `.state/sensor-health.json`: `state` (`starting`, `running`,
  `idle`, `restarting`, `failed`, `overrunning`, `invalid`, `stopped`),
  `healthy`, last run/exit, and the log tail when unhealthy. The full log is
  `.state/sensor.log`.
- **Crashes** — "always" sensors are restarted forever, backing off to about a
  minute apart; fixing the code is enough for it to come back. A cadence run
  still going when the next one is due skips that slot (`overrunning`).
- **Code changes** — a cadence sensor picks them up on its next run. For an
  "always" sensor, restart it: `systemctl --user restart "$(cat .state/sensor.unit)"`.
  Changing `sensor.json` restarts it automatically.
- **Off / on** — the trigger's own `enabled` switch. Off stops the service.
- **Removing** — delete the sensor's folder or the whole trigger. Archiving the
  identity, or deleting the scheduled task, stops its sensors automatically.
