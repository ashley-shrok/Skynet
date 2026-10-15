# Fix: nobody is told when a sensor breaks

**Opened:** 2026-10-15 (user agreed to fix size instead of a shape)

- **Observed:** a broken sensor only shows "Broken" in the app; every sensor has to build its own failure firing (Jarvis did, for both of his).
- **Correct after fix:** once a sensor has been unhealthy for ten minutes, a wake-up's agent gets one 📡 "sensor broken" line pointing at the health record (woken from dormancy if needed); a scheduled task births one agent to look into it. Nothing more until it has recovered and broken again. No phone notification, no new app marks.
- **Suspected files:** wake-up scheduler (delivery), sensor-runner (health), supervisor wake peek.

## Change

- sensor-runner records `unhealthySince` in the health record, carried forward while unhealthy.
- The scheduler's sensor pass checks a shared due-test (fresh health, unhealthy ≥10 min, not already told for that `unhealthySince`), records `.broken` before telling, and forgets it when healthy. Wake-up: one `📡 [sensor broken: …]` line; task: one birth with a fix-it prompt and task line `📡 <Name> — sensor broken`.
- The supervisor's wake peek uses the same due-test, so a dormant identity is woken.
- Docs: sensor contract, sensor-development skill, id skill.

done: scheduler SA-G19, peek T-23, runner SR05 additions pass; related vitest suites green.
