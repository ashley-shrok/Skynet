# Campaign: Turn role runbooks into role skills

**Opened:** 2026-10-21
**Status:** in_progress
**Workspace:** ~/fleet/identities/cardinal-box-maintainer-3/workspace/skynet/.planning/campaigns/role-skills/

## Concept

Runbooks were only ever called that to keep them from being confused with regular skills, which have their own fixed place on disk. What they really are is skills that belong to a role. This campaign renames them to role skills everywhere and gives them the same standard shape a regular skill has — a folder whose main file carries a name and a short description of what it does and when to reach for it — so they can be listed, understood and created consistently. They are not wired into the harness's own skills list; agents learn about them when they load.

## Success criteria

- Nothing anywhere still treats runbooks as a separate concept: the app, what an agent is shown at load, change notices, and the id skill all speak of role skills.
- Every existing runbook on every fleet box is now a role skill in the standard shape, with a well-written description.
- Nothing that used to work by pointing at a runbook's old location stops working.
- A user can create a new role skill from the role's own window in the app.
- An agent loading with a role is told, without having to go look, every role skill that role has and when to use each — and is told plainly when one couldn't be read.

## Shapes

- **[declared] shape-role-skills** — rename + standard shape + fleet-wide conversion + load listing + create from the app — closed
- **[discovered] shape-runbook-terminology-sweep** — after shape 1 closes, a fresh-session focused pass replacing the word "runbook" with "role skill" wherever it means the concept (fleet files, instructions, role files, notes) — in_progress

## Other work

- Write the 43 drafted descriptions (workspace/role-skill-descriptions.json) into the converted role skills on t1000, workstation, thenasty and zoeybattlestation at deploy, right after each box's sweep converts (workspace/apply-role-skill-descriptions.py, JSON lines on stdin) — done (2026-10-22, all 43)
- What's-new note — dropped (the user: not needed)
- Box-maintainer role-file wording that points at runbooks — folded into shape-runbook-terminology-sweep

## Lingerers (explicitly approved)

## Open questions
