# Campaign: Sensors — wake-ups and scheduled tasks that fire on logic, not the clock

**Opened:** 2026-10-14
**Status:** in_progress
**Workspace:** `/home/ubuntu/fleet/identities/solstice-box-maintainer-2/workspace/skynet/.planning/campaigns/sensors/`

## Concept

Wake-ups and scheduled tasks gain a new trigger type alongside daily, weekly, interval and one-time: a **sensor**. A sensor is free-form logic an agent writes — it can do anything (check something every few minutes, stay running and listen, accept a webhook, whatever the job needs). When the sensor decides, it fires the wake-up or scheduled task it belongs to and hands over what it found. What firing *does* is unchanged: a wake-up wakes the identity it belongs to; a scheduled task births a fresh agent. Skynet provides the scaffolding around sensors the same way it does for apps — a standard on-disk home, a service the logic runs inside, lifecycle (start, stop, archive), one standard "fire now, here's what I found" handoff, and first-class visibility in the app — but Skynet does none of the sensor's work itself: no polling, no deduplication, no memory on the sensor's behalf. That is the sensor's own business.

## Success criteria

- An agent can build a sensor writing only the logic — the service, lifecycle and fire handoff come for free, no plumbing reinvented per sensor.
- A firing sensor's wake-up lands on its identity, or its scheduled task births a fresh agent, carrying what the sensor found.
- Nothing about a sensor bakes in an identity path or name beyond the wake-up/scheduled task it belongs to — renaming or moving work never means editing sensor code.
- In the app, the user can see that a wake-up or scheduled task is sensor-triggered, when it last fired, and whether its sensor is healthy or broken.
- Archiving an identity stops and archives its wake-ups' sensors; archiving a scheduled task does the same for its sensor. No orphaned sensor services.
- Footprint stays sane on the target minimum host (4 GB arm64): the scaffolding itself adds no meaningful always-on cost per sensor beyond what the sensor's own logic chooses to use.
- Jarvis's two existing sensors (delivery emails, payday) run on the new system.

## Shapes

Ordered; each depends on the previous.

- **[declared] shape-sensor-scaffolding** — where sensors live on disk, how they run as services, the fire handoff into wake-ups and scheduled tasks (with the sensor's findings), cleanup on identity/scheduled-task archive, and the sensor-building skill that teaches agents to make one (the app-development skill's counterpart). — closed (deployed 2026-10-15, ae645761)
- **[declared] shape-sensor-app-surfaces** — the sensor trigger type shown wherever wake-ups and scheduled tasks are shown in the app (scheduled-tasks list, the identity modal's wake-ups tab): sensor-triggered marker, last fired, healthy/broken state; plus the matching id-skill update. — closed (2026-10-15, closed-hit; not yet deployed)
- **[discovered] shape-one-time-sensors** — a sensor trigger that retires itself once its first fire has been *delivered* (the sensor-fired counterpart of a one-time wake-up): the machine stops its sensor and removes the trigger only after delivery, so the fire is never lost. Requested via Cerulean (orchestrator) for "let me know when <agent> is done"; today the orchestrator deletes the wake-up by hand after the first 📡. User placed it after shape 2, before the Jarvis migration (2026-10-15). — closed (2026-10-15, closed-hit; not yet deployed)
- **[declared] shape-migrate-jarvis-sensors** — move Jarvis's delivery-email and payday sensors onto the new system as the proof it works end to end; retire their hand-rolled timers and wake-up writers. — declared

## Other work

- **Wake-up folder conversion on the beelink (100.124.193.5) and the laptop (100.102.28.73)** — both unreachable at deploy 2026-10-15 (beelink SSH timeout; laptop offline 11d). When each is back: confirm the distributor installed the new scheduler, then run `.planning/campaigns/sensors/migrate-wakeups-to-folders.py` (dry run, then `--apply`) as the fleet user. — open
- **Push + deploy shape 2 (sensor app surfaces)** — closed and reviewed 2026-10-15, local commits `d28323ca`..`a4d80de5` (plus shape-1 docs commit `e9f77232`) not pushed, not deployed. The user moved on to the next shape without a push/deploy go-ahead; each still needs its own greenlight. — open
- **Being told when a sensor breaks** (mark on the clock icon or conversation, phone notification, or a note from the owning agent) — a broader "how Skynet alerts the user" question; sensors would be its first case. — deferred (user call 2026-10-15, shape 2; not built in this campaign)

## Lingerers (explicitly approved)

(empty)

## Open questions

- ~~Can the user create or edit a sensor from the app?~~ Answered (shape 2): agent-built, user-controlled — the trigger's existing on/off is the only control.
- ~~Exact naming in the app?~~ Answered (shape 2): "Sensor", with the 📡 mark.

## Prior context

- Inspiration: Jarvis's reminders app and his two sensors (no-AI tripwire that wakes the agent only when there's something to judge). Jarvis's own critique: every sensor reinvents its timer, its memory and its wake-up writer, and the identity path is hard-coded in several places (renaming Blizzard → Jarvis meant editing and rebuilding all of them). Relay DM with Jarvis: room `!QEfoqKdhcXoSJshrDx:t1000.taild9b663.ts.net`.
- The reminders app stays out of scope — it's an app that happens to do a sensor-like thing.
- Considered and rejected: a standalone "sensors" concept parallel to apps with its own target settings — collapsed into a new trigger type on the existing wake-ups/scheduled tasks. Also rejected: Skynet polling or running the logic on the sensor's behalf — the logic is free-form, like an app.
