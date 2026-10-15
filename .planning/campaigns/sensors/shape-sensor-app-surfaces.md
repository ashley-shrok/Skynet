# Shape: sensor app surfaces — see that a wake-up or scheduled task is sensor-fired, when it last fired, and whether its sensor is healthy

**Opened:** 2026-10-15

## What this is

The part of the sensors campaign the user actually sees. Shape 1 made sensors work and has every sensor quietly recording its own health; this shape shows that in the app. Wherever wake-ups and scheduled tasks are listed — the scheduled-tasks list and the wake-ups tab of an agent's identity modal — a sensor-fired one is clearly marked, says when it last fired, and says whether its sensor is healthy, broken, or something in between, with the reason visible when it's broken. Agents build sensors; the user watches them and switches them on and off with the switch every trigger already has. The id skill is updated to match.

## Shape

**The name is "Sensor".** Shown with the 📡 mark agents already see when a sensor fires. Every sensor-fired wake-up and scheduled task carries it, so it stands apart from clock-fired ones at a glance.

**The row, unopened.** A sensor row's schedule line reads like "📡 Sensor · Healthy · Last fired 3h ago". Sensors have no "next", so the sensor's status takes that slot. When broken, the status reads Broken, in red, in the same place. Error detail is not on the row.

**States the user can see.**
- *Healthy* — running or waiting for its next run, last run fine.
- *Broken* — crashing, last run failed, or its settings are invalid. Shows why when opened.
- *Running long* — a timed run still going when the next one was due.
- *Off* — the user switched the trigger off; the sensor is stopped. A choice, not a fault, shown calmly.
- *Not live yet* — an agent is still building it and hasn't published it. Normal mid-build, shown calmly.
- *Unknown* — the app can't read the sensor's status (its machine is offline, or the record is missing or unreadable). Grey; never claimed healthy or broken.

**Never fired.** A sensor that has never fired says "Never fired" — a plain fact, not a warning.

**Waiting fires.** When fires are being held (the trigger is off and its sensor had fired), the row shows how many are waiting, so switching it back on doesn't surprise anyone.

**The opened view.** Expanding a sensor wake-up, or opening a sensor scheduled task, shows a read-only sensor section: status (with the last error lines when broken), how it runs ("Always running" or its cadence in the same plain wording schedules already use), last ran, last fired, and waiting fires if any. Last ran and last fired are different things and both are shown.

**Last fired for every wake-up.** The wake-ups tab gains a last-fired time on every wake-up, clock ones included, so the list is consistent rather than half-filled. The scheduled-tasks list already has its Last time and keeps it.

**Staying current.** While either list is open, it re-checks every 30 seconds or so; nothing is checked while nothing is open.

**Control.** The trigger's existing on/off switch is the only control. Sensors cannot be created or edited from the app; the sensor section is read-only.

**Id skill.** The id skill's description of the wake-ups tab and the scheduled-tasks list is updated so agents know what the user sees.

## Philosophy

Show, don't tell: the user can see a sensor's health wherever they'd look for it, but the app does not alert, nag or interrupt. Honest states — never claim healthy when the app doesn't know, never call a deliberate off or a mid-build sensor broken. The app only reads what the scaffolding already records; it adds no checking of its own on the sensor's behalf. Agents build; the user watches and switches.

## Prior context

Shape 1 (deployed 2026-10-15) records for every sensor whether it is running, its last run time, whether that run worked, its last error lines and whether a timed run is overrunning; last fired is recorded at delivery, for clock and sensor triggers alike. Today the scheduled-tasks list shows each task's schedule plus Last / Next, loads on open and refreshes only when a Next time passes; a sensor task just says "Sensor" with no Next. The wake-ups tab shows name, on/off and schedule, with no last-fired time for any wake-up; sensor wake-ups say "Sensor" and their schedule is read-only. The scheduled-tasks list spans several machines.

## What would make it wrong

- If a broken sensor can look healthy — including when the app simply can't reach it.
- If a sensor the user switched off, or one still being built, shows as broken.
- If the app starts checking things on the sensor's behalf rather than reading what is already recorded.
- If an open list goes stale for minutes while a sensor breaks.
- If the user can create or edit sensor logic or settings from the app.
- If the wake-ups tab ends up showing last fired on some rows and nothing on others.
- If agents' picture of these screens (the id skill) doesn't match what the user sees.

## Scope edges

**In:** sensor marker, status, last fired, never fired, waiting-fire count on rows in both lists; read-only sensor section in the opened views; last fired for every wake-up; 30-second refresh while open; the id skill update.

**Out (shape 3):** moving Jarvis's sensors onto the system.

**Deferred (filed in the campaign's Other work, not built in this campaign):** being told when a sensor breaks — a mark on the clock icon or conversation, a phone notification, or a note from the owning agent.

**Out entirely:** creating or editing sensors from the app; any sensor control besides the trigger's existing on/off; viewing a sensor's full log or its code from the app.

## Handoff notes

- Health record per sensor: `<trigger folder>/.state/sensor-health.json` (see `sensor-contract.md` for fields and states). Last fired = the trigger's existing `.last` file. Pending fires = `<trigger folder>/fires/*.fire`. Run style = published `sensor/sensor.json`; a draft is `sensor.json.pending`.
- Map raw states to user states: running/starting/idle + healthy → Healthy; failed/restarting/invalid → Broken; overrunning → Running long; stopped or trigger disabled → Off; no published settings → Not live yet; unreachable/missing/unparseable → Unknown.
- Surfaces: the wake-ups tab in the identity modal (pretty-view), and the scheduled-tasks list + its edit form (pretty-conversations). Backend reads both over the existing per-host paths; the scheduled-tasks list spans hosts.
- Role directive: user-facing change rides with the id skill edit (`substrate/skills/id/SKILL.md`) in this shape.
- Work on `feat/tab-title-from-tmux`; no worktrees; commit + scoped tests; push and deploy each need their own greenlight. Personal-name test bans names in tracked files.
