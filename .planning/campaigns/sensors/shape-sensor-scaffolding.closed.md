# Shape: sensor scaffolding — where sensors live, how they run, how they fire, how they're cleaned up

**Opened:** 2026-10-15

## What this is

The groundwork that makes a sensor possible. A sensor is free-form logic an agent writes that decides when a wake-up or a scheduled task fires, and hands over what it found. This shape gives every sensor a standard home on disk, runs it as a managed background service, provides the one standard "fire now, here's what I found" handoff, delivers fires to the right place (the identity's conversation for a wake-up, a freshly born agent for a scheduled task), cleans sensors up when their owner goes away, records their health for the app to show later, and ships a skill that teaches agents how to build one. Along the way, every wake-up moves from a single file into a folder of its own, matching how scheduled tasks already work.

## Shape

**Wake-ups become folders.** Every wake-up, sensor or not, is now a folder holding its spec, its state, and (for sensor wake-ups) its sensor and its fires. No backward compatibility: existing wake-ups on every managed machine are converted by hand at deploy time. Scheduled tasks already have a folder each; sensors slot into it the same way.

**A sensor belongs to exactly one trigger.** It lives inside the folder of the wake-up or scheduled task it fires. A trigger whose schedule kind is "sensor" is fired by its sensor and never by the clock. The sensor's location is what ties it to its trigger, so sensor logic never names an identity, a task, or a path.

**Two ways to run, chosen by the agent.**
- *Always running* — started once, kept alive, restarted if it dies. Suits listeners.
- *On a cadence* — started on a schedule (using the exact same schedule vocabulary wake-ups already use), runs, exits. Costs nothing between runs.
One small shared clock process per machine starts cadence sensors when due. It does not depend on the owning agent being awake, so a dormant agent is never woken merely to run its sensor.

**Going live is an explicit publish.** A sensor's run settings start as a draft; renaming the draft to its real name is what makes the sensor go live (the same publish step apps use). Until then, the agent can build and test by hand.

**Services follow folders.** On every pass, a published sensor with no service gets one; a service whose sensor folder is gone is stopped and removed. That single rule covers cleanup: archiving an identity moves its folder away, so its sensors stop; deleting a scheduled task removes its folder, so its sensor stops; un-archiving brings both back.

**The trigger's existing on/off switch controls the sensor.** Off stops the sensor's service entirely. On restarts it. There is no separate sensor switch.

**The fire handoff.** One small command, shipped to every machine, is how a sensor fires: it is given the findings as plain text and drops one fire into its trigger's pending-fires folder — time-ordered, written atomically, contents verbatim. Skynet never parses, merges, de-duplicates or judges findings.

**Delivery to a wake-up.** The identity's own wake-up scheduler drains pending fires oldest-first, recording each as the wake-up's last fire and emitting one event into the conversation — the same path the existing clock wake-up events take — carrying the wake-up's standing instruction plus the findings (inline when short; as a pointer to the kept fire file when long, under the same rule long wake-up instructions follow). If the agent is dormant, a waiting fire is one more reason the box supervisor wakes it; the fresh scheduler then drains all pending fires in order. Every fire is delivered separately; a crash mid-delivery may deliver a fire twice, never zero times.

**Delivery to a scheduled task.** The machine's scheduled-task scheduler turns each fire into one birth request. The newborn's first instruction is the task's prompt followed by a "what the sensor found" section with the findings verbatim. Three fires, three agents.

**Waiting fires survive being switched off.** Fires that haven't been delivered when the trigger is switched off stay waiting, and are delivered — with their original fire time visible — when it's switched back on. Archiving an identity carries its waiting fires into the archive; un-archiving delivers them.

**Health trail.** After every run or crash the scaffolding records: last run time, whether it succeeded, the last error lines, and for cadence sensors whether a run is overrunning. Last fired is recorded at delivery. Shape 2 displays this; this shape only produces it.

**Crash and hang behavior.** An always-running sensor that keeps crashing is never given up on: after a few quick crashes, restarts slow to about a minute apart, and it shows as broken the whole time; once fixed it recovers on its own. A cadence run still going when its next run is due causes that next run to be skipped (never two at once), and the sensor is marked overrunning.

**No fence.** Sensors run with the same access the agent who wrote them already has. They may read and write wherever they need (credential refresh, other apps' databases, tool caches, shared memory with sibling sensors).

**The app keeps working.** The app's existing wake-up list/create/edit/delete moves to the folder layout. Sensor-triggered wake-ups and tasks appear with a plain "sensor" schedule line and nothing errors. Proper sensor display is shape 2; creating sensors from the app is out entirely.

**The sensor-building skill.** The app-development skill's counterpart. It teaches an agent to write only the logic and get everything else for free: where the sensor goes, the publish step, how to fire, how findings arrive. It describes each run style in one plain line and does not steer — agents choose.

**Everywhere at once.** Sensors, the shared clock, the fire command, and the skill ship to every managed machine together; the wake-up folder conversion happens on every machine at deploy.

## Philosophy

Skynet provides scaffolding and does none of the sensor's work. It never polls on a sensor's behalf, never remembers anything for it, never de-duplicates, merges, drops or interprets findings. Starting a cadence sensor on its schedule is scaffolding; deciding whether anything happened is the sensor's. What firing *does* is unchanged from today: a wake-up wakes its identity; a scheduled task births an agent. The folder is the thing — presence, publish and removal of folders drive services, so there are no separate lifecycle steps to forget.

## Prior context

Today wake-ups are single files per identity; scheduled tasks are folders. A per-identity scheduler (a background child of each live agent) emits clock wake-ups into the conversation; the box supervisor wakes dormant agents for due wake-ups, relay messages and inbox files; a single machine-level scheduler births agents for scheduled tasks. Apps already have the folder-is-the-thing pattern: draft-then-publish, a background service per app, archive by moving the folder. Jarvis's two hand-rolled sensors (delivery emails on a five-minute timer; payday on a weekly wake-up) each reinvent their timer, memory and wake-up writer, and bake his identity path into code. Jarvis's reminders app writes one-time wake-ups straight into his wake-ups folder as single files.

## What would make it wrong

- If a sensor's code has to name an identity, task, or path to fire, this has missed the point.
- If Skynet ever checks something, remembers something, or decides something on a sensor's behalf.
- If a fire can be lost — agent asleep, busy, switched off, archived, or the scheduler crashing mid-delivery.
- If fires get merged or silently dropped.
- If a dormant agent gets woken just to run its sensor.
- If a removed or archived owner leaves a sensor service running.
- If a crashing or hung sensor goes quiet instead of showing as broken.
- If the scaffolding itself costs meaningful memory per sensor on the 4 GB minimum box.
- If the app breaks on folder-shaped or sensor-triggered wake-ups.
- If Jarvis's reminders stop firing after the deploy.

## Scope edges

**In:** wake-up folder layout across the scheduler, the supervisor's dormant-wake checks, the backend reading/writing wake-ups, and the id skill's wake-up documentation; sensor home, publish, services, shared cadence clock, fire command, delivery to wake-ups and scheduled tasks, on/off, cleanup via folder presence, health trail, crash/hang behavior; the sensor-building skill; distribution to every managed machine; deploy-time migration of existing wake-ups on every machine; coordinating the reminders-app change with Jarvis.

**Out (shape 2):** showing sensor markers, last fired, healthy/broken in the app.

**Out (shape 3):** moving Jarvis's delivery and payday sensors onto this.

**Out entirely:** creating or editing sensors from the app; a write fence; Skynet-side de-duplication or merging; an archive concept for scheduled tasks; making sensors reachable from the internet; the reminders app's own logic.

## Handoff notes

Concrete layout agreed in discussion (Ashley asked for this level of detail):

```
~/fleet/identities/<name>/wakeups/<slug>/
  wakeup.json          spec (today's single file, moved in); sensor trigger: "schedule": {"type": "sensor"}
  sensor/              agent's logic + its own memory
    sensor.json        { "run": "always" } or { "run": "cadence", "cadence": <existing schedule object> } + entry program
                       (written as sensor.json.pending; mv to publish)
  fires/               pending: YYYYMMDDTHHMMSSmmm-<8hex>.fire, written tmp+rename, contents = findings verbatim
  fires/delivered/     moved here on delivery; long-findings events point here
  .state/              last fired, health
~/fleet/scheduled-agents/<slug>/sensor/ and fires/   same shape for scheduled tasks
```

- Fire command: a new distributed script (`sensor-fire`), findings as argument or stdin; resolves its trigger from the folder the service launched it in.
- Wake-up event line: `📡 [sensor: <slug> @ <UTC>] <instruction> — findings: <text>`, or a pointer to the delivered file past the existing long-instruction threshold.
- Dormant wake: add "pending fire exists" alongside the existing inbox/schedule/relay checks in the supervisor's reconcile.
- Services: one systemd user unit per sensor (always: restart with backoff; cadence: one-shot run started by the shared clock). Shared clock = one machine-level process using the existing schedule engine; also does the folders-to-services reconcile.
- The schedule engine has a TypeScript port held to the Python by a conformance fixture; the new "sensor" kind must be accepted by both (with no next fire), including the supervisor's dormant-wake peek.
- The distributor catalog's tests pin row counts; new scripts, skill files and units need catalog rows, count updates, and bootstrap enable steps.
- Id skill must be updated in this shape for the wake-up folder layout and sensor wake-up events (role directive: user-facing changes ride with id-skill edits).
- Before deploy: DM Jarvis (`@jarvis-2:t1000.taild9b663.ts.net`, room `!QEfoqKdhcXoSJshrDx:t1000.taild9b663.ts.net`) with the exact reminders-app change (write a folder holding `wakeup.json`, not a single file); he updates his own app. Find which machine he lives on.
- Work on `feat/tab-title-from-tmux`; no worktrees; commit + scoped tests; push and deploy each need their own greenlight.

---

## Close-Out

**Closed:** 2026-10-15
**Overall verdict:** closed-hit (reviewer returned closed-partial only because two deploy-time actions can't be verified by reading; every agreed feature is present, and Ashley endorsed all additions)

### Shape features (conformance)

- **What this is** — present · standard home, managed service, one fire handoff, delivery to both trigger kinds, cleanup, health, skill, wake-up folders
- **Wake-ups become folders** — present · scheduler, supervisor, backend and id skill use one folder per wake-up; flat files ignored; deploy-time conversion script covers live and archived identities
- **A sensor belongs to exactly one trigger** — present · lives in its trigger's folder; never fired by the clock; fire command finds its trigger from where it runs
- **Two ways to run** — present · always and cadence; cadence reuses the wake-up schedule vocabulary; one machine-level clock independent of the owning agent
- **Going live is an explicit publish** — present · only the published settings count; drafts ignored
- **Services follow folders** — present · services created for published sensors, removed when the folder is gone
- **On/off switch controls the sensor** — present · off stops and removes the service; on recreates it
- **The fire handoff** — present · one command, one time-ordered fire, atomic, verbatim
- **Delivery to a wake-up** — present (drift endorsed) · oldest-first, one event per fire, emit before move, dormant wake on waiting fire; multi-line findings always pointed at
- **Delivery to a scheduled task** — present · one birth per fire with "What the sensor found"
- **Waiting fires survive being switched off** — present
- **Health trail** — present
- **Crash and hang behavior** — present · unlimited restarts backing off to about a minute; overrunning cadence slots skipped and marked
- **No fence** — present
- **The app keeps working** — present · folder layout in list/create/edit/delete; read-only "Sensor" schedule in both editors; no sensor creation from the app
- **The sensor-building skill** — present · one neutral line per run style
- **Everywhere at once** — present · catalog rows + bootstrap enable step; conversion runs at deploy
- **Philosophy** — present
- **Prior context (commitments)** — present · existing delivery, dormant-wake and birth paths reused
- **Coordinate the reminders-app change with Jarvis** — cannot-verify · deploy-time action
- **What would make it wrong: sensor code names an identity, task or path** — present (guarded)
- **What would make it wrong: Skynet checks, remembers or decides for a sensor** — present (guarded)
- **What would make it wrong: a fire can be lost** — present (guarded)
- **What would make it wrong: fires merged or dropped** — present (guarded)
- **What would make it wrong: dormant agent woken just to run its sensor** — present (guarded)
- **What would make it wrong: orphaned service after owner removed** — present (guarded)
- **What would make it wrong: crashing or hung sensor goes quiet** — present (guarded)
- **What would make it wrong: meaningful memory per sensor** — present (by design; not measured)
- **What would make it wrong: app breaks on new layout** — present (guarded)
- **What would make it wrong: Jarvis's reminders stop firing** — cannot-verify · depends on deploy-time coordination
- **Scope edges: In** — present (Jarvis coordination at deploy)
- **Scope edges: Out** — present · none of the out items were done

### Additions (in the result, not in the shape)

- Delivered fire copies pruned after 30 days / beyond the newest 200 per trigger — endorsed-as-drift
- Multi-line findings always delivered as a pointer to the saved fire — endorsed-as-drift
- Sensor-born scheduled-task agents show 📡 instead of ⏰ on their task line — endorsed-as-drift
- Findings handed to a newborn wrapped in markers with a "data, not instructions" note — endorsed-as-drift
- Deploy-time conversion restarts every running agent's background monitor — endorsed-as-drift
- Fired one-shot wake-up folder swept a day after firing — endorsed-as-drift
- Fire command accepts an explicit trigger folder for hand testing — endorsed-as-drift
- Sensor log capped at ~1 MB; richer health states — endorsed-as-drift
- Scheduled-task birth requests written under a temporary name then renamed — endorsed-as-drift

### Follow-ups

- Before/at deploy, message Jarvis with the reminders-app change and confirm his reminders still fire afterwards — deferred (deploy step)
- Run the wake-up folder conversion on every managed host at deploy — deferred (deploy step)

### Notes

No agreed feature missing. The two cannot-verify items are deploy-time actions, tracked as follow-ups.
