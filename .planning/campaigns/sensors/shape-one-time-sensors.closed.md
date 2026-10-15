# Shape: one-time sensors — a sensor trigger that retires itself once its first fire is delivered

**Opened:** 2026-10-15

## What this is

A sensor-fired wake-up or scheduled task can be marked one-time. Its sensor runs as usual; the first time it fires, the machine hands that fire over (wakes the identity, or births the agent), and only then removes the trigger. The sensor's service stops on its own because its trigger is gone. It is the sensor-fired counterpart of a one-time wake-up, built for "let me know when this agent is done": one heads-up, then the trigger is gone without anyone having to remember to delete it.

## Shape

- **The one-time mark lives on the trigger**, beside "this is fired by a sensor" — not in the sensor's own settings. The trigger is what retires; the sensor's logic is the same whether it is one-time or repeating.
- **Retire only after delivery.** The machine delivers the first waiting fire exactly as for any sensor, then removes the trigger. Nothing is removed before the fire has been handed over, so the fire can never be lost.
- **Several fires waiting at once:** only the oldest is delivered; the trigger retires and the rest go with it. One-time means one heads-up.
- **Switched-off trigger:** its fire waits, like any sensor's; when switched back on, the fire is delivered and the trigger retires.
- **The sensor's service stops on its own** — the machine already stops a sensor whose trigger is gone, within about half a minute. Nothing new there.
- **A one-time wake-up's folder lingers a day**, as a fired one-time wake-up's does today, so a findings file the 📡 line points at stays readable.
- **The 📡 line says so.** A one-time sensor's wake line carries a short note that the wake-up has now retired, so the agent knows not to delete it by hand and that no more fires are coming. A scheduled task's newborn gets no such note — it doesn't own the trigger.
- **In the app:** a one-time sensor trigger is labelled "📡 Sensor · once" wherever sensor triggers are shown (the identity's wake-ups tab, the scheduled-tasks list). The mark is shown, not editable; editing a sensor trigger's name, instruction or on/off from the app keeps it intact.
- **Skills:** the sensor-building skill teaches the one-time mark; the id skill describes the label and that one-time sensors retire after their first delivered fire.

## Philosophy

The machine does only the retiring — the one thing a sensor cannot safely do itself, because it can't know when its fire has been delivered. Everything else stays the sensor's business: when to fire, what to report, when to give up. No expiry, no "give up after N days"; a sensor that wants a deadline fires with "gave up" as its findings, which retires it the normal way.

Agent-built, user-controlled: the app's only control over a sensor trigger stays on/off.

## Prior context

- Sensors (shapes 1 and 2) are live: free-form agent logic fires a wake-up or scheduled task; the machine delivers fires oldest first and shows sensor triggers in the app as "📡 Sensor" with health and last fired.
- One-time wake-ups already exist on the clock: after firing, the spec is removed and the folder cleared a day later; a one-time scheduled task is removed after it births its agent.
- Requested via Cerulean (orchestrator), whose "follow" sensor fires each time a followed agent ends a turn. For "tell me when Willa's done", the orchestrator today deletes the wake-up by hand after the first 📡 — which relies on the agent remembering. Cerulean noted that having the sensor delete its own trigger is unsafe: the fire could still be waiting undelivered and would be lost.

## What would make it wrong

- A fire is lost — the trigger is removed before its fire was handed over.
- A one-time sensor delivers more than one heads-up.
- The sensor has to do anything different (or know it is one-time) to retire.
- A sensor service is left running after its one-time trigger is gone.
- Editing a one-time trigger in the app silently turns it into a repeating one.
- The machine starts deciding anything on the sensor's behalf (timeouts, expiry, filtering findings).

## Scope edges

- **In:** the one-time mark on sensor-fired wake-ups and scheduled tasks; retire-after-first-delivery; the retired note on the 📡 line; the "Sensor · once" label in both app surfaces; validation accepting the mark wherever sensor schedules are checked; sensor-building skill + id skill updates.
- **Out:** expiry or give-up timers; changing the mark from the app; creating sensors from the app; a note to a scheduled task's newborn.
- **Deferred:** none.
- **Tempting but no:** a general "fire N times" count for sensors — one-time is the asked-for case.

## Handoff notes

- Identity: solstice-box-maintainer-2, inside the sensors campaign (shape 3 of 4). Campaign artifact and the sensor on-disk contract sit beside this file; extend the contract with the one-time mark.
- Delivery lives in the wake-up scheduler (both the per-identity and scheduled-tasks modes); model the retire step on its existing one-time handling (spec removed after firing; per-identity folder swept a day later). The sensor runner already stops a sensor whose trigger spec is gone.
- The schedule validator exists in both the scheduler and the app backend — both must accept the mark on sensor schedules and still reject anything else.
- Tell Cerulean when this lands (stakeholder step).

---

## Close-Out

**Closed:** 2026-10-15
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The one-time mark lives on the trigger** — present · An optional true/false mark beside the sensor type on the trigger's schedule; the sensor's own settings and code are unchanged.
- **Retire only after delivery** — present · The fire is handed over first, then marked delivered, then a "has fired" marker is written and the spec removed; a failed removal is retried and the marker blocks a second delivery.
- **Several fires waiting at once: only the oldest is delivered** — present · Oldest first; delivery stops after one for a one-time trigger; the rest go with the folder.
- **Switched-off trigger: its fire waits, then is delivered and the trigger retires** — present · Switched-off triggers aren't loaded; once switched back on, the normal path delivers and retires.
- **The sensor's service stops on its own** — present · The sensor runner only runs sensors whose trigger spec exists; unchanged.
- **A one-time wake-up's folder lingers a day** — present · The existing day-later sweep covers retired one-time sensor wake-ups.
- **The 📡 line says so; a scheduled task's newborn gets no note** — present · Retired note on both line forms; none for tasks.
- **In the app: "Sensor · once" in both surfaces; shown, not editable; edits keep the mark** — present · Wake-ups tab and scheduled-tasks list, row and details; both edit forms send the schedule back unchanged (tested).
- **Validation accepts the mark wherever sensor schedules are checked** — present · Both validators accept only true/false and still reject anything else; shared conformance cases.
- **Skills** — present · Sensor-building skill gained a one-time section; id skill describes the label and retirement.
- **Handoff: contract extended** — present · One-time section added to the on-disk contract.
- **Handoff: both delivery modes** — present · One path for wake-ups and scheduled tasks; marker in the trigger's own folder.
- **Out: expiry/give-up timers** — present · None added.
- **Out: changing the mark from the app** — present · Display only.
- **Out: creating sensors from the app** — present · Nothing added.
- **Out: a note to a scheduled task's newborn** — present · None.
- **Tempting but no: "fire N times" count** — present · Mark is true/false only.
- **What would make it wrong: A fire is lost** — present · Removal only after hand-over.
- **What would make it wrong: More than one heads-up** — present · One per trigger; marker blocks later deliveries.
- **What would make it wrong: The sensor has to do anything different** — present · Retiring is entirely the machine's.
- **What would make it wrong: A service left running** — present · Spec gone ⇒ runner stops it.
- **What would make it wrong: An app edit turns it repeating** — present · Schedule passed through untouched.
- **What would make it wrong: The machine decides on the sensor's behalf** — present · No timeouts or expiry; findings untouched.

### Additions (in the result, not in the shape)

- A retired one-time sensor scheduled task's leftover folder (sensor included) is cleared a day later, like a wake-up's — endorsed-as-drift (user, 2026-10-15: keeps a findings file readable for the newborn, avoids orphaned sensor folders)
- A one-time trigger re-created under the same name after retiring counts as a fresh trigger — endorsed-as-drift
- A sensor-status refresh test given a longer wait so it stops timing out under a loaded full run — endorsed-as-drift (test upkeep)

### Follow-ups

None.

### Notes

Telling Cerulean happens after deploy (stakeholder step).
