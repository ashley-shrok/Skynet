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

- **[declared] shape-sensor-scaffolding** — where sensors live on disk, how they run as services, the fire handoff into wake-ups and scheduled tasks (with the sensor's findings), cleanup on identity/scheduled-task archive, and the sensor-building skill that teaches agents to make one (the app-development skill's counterpart). — closed (pushed; deploy pending)
- **[declared] shape-sensor-app-surfaces** — the sensor trigger type shown wherever wake-ups and scheduled tasks are shown in the app (scheduled-tasks list, the identity modal's wake-ups tab): sensor-triggered marker, last fired, healthy/broken state; plus the matching id-skill update. — declared
- **[declared] shape-migrate-jarvis-sensors** — move Jarvis's delivery-email and payday sensors onto the new system as the proof it works end to end; retire their hand-rolled timers and wake-up writers. — declared

## Other work

(empty)

## Lingerers (explicitly approved)

(empty)

## Open questions

- Can the user create or edit a sensor's trigger from the app, or is that agent-only (as with apps) with the user controlling on/off? Lean: agent-built, user-controlled; settle in shape 2.
- Exact naming in the app — "sensor" as the trigger type's label vs. something else. Settle in shape 2.

## Prior context

- Inspiration: Jarvis's reminders app and his two sensors (no-AI tripwire that wakes the agent only when there's something to judge). Jarvis's own critique: every sensor reinvents its timer, its memory and its wake-up writer, and the identity path is hard-coded in several places (renaming Blizzard → Jarvis meant editing and rebuilding all of them). Relay DM with Jarvis: room `!QEfoqKdhcXoSJshrDx:t1000.taild9b663.ts.net`.
- The reminders app stays out of scope — it's an app that happens to do a sensor-like thing.
- Considered and rejected: a standalone "sensors" concept parallel to apps with its own target settings — collapsed into a new trigger type on the existing wake-ups/scheduled tasks. Also rejected: Skynet polling or running the logic on the sensor's behalf — the logic is free-form, like an app.
