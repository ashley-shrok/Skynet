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
restarts, cadence, cleanup, health, and delivery of each fire — through the
fire controls you choose (keys, grouping, a rate limit; see Fire controls).
The box does none of the sensor's thinking — no polling for it, no reading of
findings. Checking, remembering what was already seen, and deciding to fire
are yours.

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

Each call drops one fire. Fire once per thing worth acting on (or once per
batch, if one batch is one thing), and exit quietly when there's nothing. By
default every fire is delivered, separately and in order; the fire controls
below change that.

How it arrives:

- **Wake-up** — a line in the identity's conversation:
  `📡 [sensor: <slug> @ <fire time UTC>] <instruction> — findings: <text>`.
  Long or multi-line findings are pointed at instead (`… findings (N chars) at
  <path> — Read it`). Off means off: fires still waiting when the wake-up is
  switched off are thrown away.
- **Scheduled task** — one fresh agent per fire; its first instruction is the
  task's prompt followed by a `## What the sensor found` section.

## Fire controls

Three controls sit between `sensor-fire` and delivery. Set them in
`sensor.json`, next to `run` and `command`; leave a field out for its default.

```json
{ "run": "cadence", "cadence": { "type": "interval", "every": "5m" }, "command": "python3 check.py",
  "keyMemory": "24h", "groupWindow": "1m", "maxPerHour": 10 }
```

- **Keys** — `sensor-fire --key <key> "findings"`. Give a key when your fires
  are about distinct things (an email id, a PR number, an alert id). A fire
  whose key is still waiting, or was delivered within `keyMemory`, is dropped
  and noted in `.state/sensor.log`. `keyMemory` is a duration (`"30m"`,
  `"24h"`, `"7d"`; default `"24h"`) or `"forever"`. Pick it for what "the same
  thing again" means for your sensor: "PR 12 changed" can recur next week; "a
  new email arrived" never should. No key, no de-duplication. Keys are the
  box's backstop, not a replacement for your own memory of what you've seen.
- **Grouping** — `groupWindow` (a duration; off unless set). The first waiting
  fire opens the window; every fire that lands before it closes is delivered
  with it as one bundle — one 📡 line or one agent, the findings of each fire
  one after another. Turn it on when a burst is really one event (twelve
  failures from one outage); leave it off when each fire needs handling on its
  own.
- **Rate limit** — `maxPerHour` (a whole number; default 10). Always on.
  Counts deliveries in any rolling hour — a bundle is one, a dropped duplicate
  none. The delivery that would go over it is not made: the box switches the
  trigger off (the app shows **Tripped**) and hands every waiting fire over in
  one heads-up instead — a `📡 [sensor tripped: …]` line to the wake-up's
  identity, or one agent for a scheduled task — saying it could be a real
  surge or a faulty sensor. Those fires are used up. Switching the trigger
  back on starts fresh. Raise the limit only for a sensor that legitimately
  fires a lot. The count is by delivery time, so a backlog delivered at once
  (say, after the box was down) counts all together.

An invalid control makes the sensor `invalid`, like any other bad setting.
One-time sensors deliver once, so the controls don't affect them.

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
Switched off, its waiting fire is thrown away like any sensor's.

Test it as a repeating sensor first and add `"once": true` just before
publishing (see Making one) — otherwise your own test fire is the one
heads-up and the trigger retires before the sensor ever goes live.

Never retire a trigger from inside the sensor (deleting its own folder): a fire
not yet delivered would be lost. There is no built-in expiry — if your sensor
should give up, fire with that as the findings (e.g. "gave up after 2 days").

## Making one

1. Get the user's go-ahead for the wake-up or scheduled task (governance above).
2. Create the trigger with `"schedule": {"type": "sensor"}` — for a wake-up,
   `wakeups/<slug>/wakeup.json`; its `instruction` says what to do with findings.
   For a one-time sensor, leave `"once"` off until step 5.
3. Write the logic in `<trigger>/sensor/`, plus `sensor.json.pending`.
4. Test by hand from inside `sensor/`: run the command yourself. `sensor-fire`
   works there too (it finds the trigger by walking up), so you can watch a real
   fire arrive.
5. For a one-time sensor, add `"once": true` to the schedule now — after
   testing, so a test fire doesn't retire it. Then publish:
   `mv sensor.json.pending sensor.json`. Within ~30s the box creates its
   service (and for "always", starts it).
6. Check `.state/sensor-health.json` shows it healthy.

## Running, changing, stopping

- **Health** — `.state/sensor-health.json`: `state` (`starting`, `running`,
  `idle`, `restarting`, `failed`, `overrunning`, `invalid`, `stopped`),
  `healthy`, last run/exit, `unhealthySince`, and the log tail when unhealthy.
  The full log is `.state/sensor.log`.
- **Breakage is reported for you** — once a sensor has been unhealthy for ten
  minutes, its wake-up's identity gets one
  `📡 [sensor broken: <slug> @ <since>] … — Read it` line pointing at the
  health record (woken from dormancy if needed); a scheduled task births one
  agent to look into it. Nothing more until it has been healthy again. So a
  sensor doesn't need its own failure firing — just exit non-zero (cadence) or
  crash (always) when it can't do its job.
- **Crashes** — "always" sensors are restarted forever, backing off to about a
  minute apart; fixing the code is enough for it to come back. A cadence run
  still going when the next one is due skips that slot (`overrunning`).
- **Code changes** — a cadence sensor picks them up on its next run. For an
  "always" sensor, restart it: `systemctl --user restart "$(cat .state/sensor.unit)"`.
  Changing `sensor.json` restarts it automatically.
- **Off / on** — the trigger's own `enabled` switch. Off stops the service and
  throws away fires still waiting; on starts fresh.
- **Tripped** — the box switched the trigger off because it went over
  `maxPerHour`; `.state/sensor-tripped.json` says when and what was handed over
  (the evidence file is in `fires/delivered/`). Fix the sensor if it was at
  fault, then switch the trigger back on (`"enabled": true`).
- **Removing** — delete the sensor's folder or the whole trigger. Archiving the
  identity, or deleting the scheduled task, stops its sensors automatically.
