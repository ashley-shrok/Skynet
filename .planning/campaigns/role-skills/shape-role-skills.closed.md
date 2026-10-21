# Shape: Turn role runbooks into role skills

**Opened:** 2026-10-21

## What this is

Runbooks become role skills. A role skill is a skill that belongs to a role: a folder in the role's own space whose main file is shaped exactly like a regular skill's — a name, and a short description of what it does and when an agent would reach for it — with any companion files alongside. Every existing runbook on every fleet box is converted into this shape and given a well-written description. The app's role window shows and edits role skills, and can now create one. An agent loading with a role is handed the list of that role's skills, with each one's description, without having to go look. Things that point at a runbook's old location keep working.

## Shape

- **The role skill.** Lives in the role's space under a "skills" area, one folder per role skill. The folder's name is the role skill's name. Its main file has the standard skill frontmatter (name matching the folder, and a description) followed by the steps. Companion files — scripts, checklists, state — sit in the same folder as before.

- **Conversion of what exists.** Every runbook on every fleet box, under every live role, becomes a role skill: its folder moves to the skills area, its main file (whichever of the two old naming conventions it used) becomes the standard main file, and frontmatter is added or repaired with a generated description. Companion files come along untouched. This runs as part of the fleet's regular per-box upkeep: safe to run again and again, quiet when there's nothing to do, and it does not set off "this file changed" notices to agents for the move itself.

- **Description quality.** Generated descriptions say, concisely, what the role skill does and when an agent would reach for it. They do not describe the underlying tools or technology, do not walk through how it's done, and do not pile up examples. One or two sentences.

- **Nothing breaks.** At each converted runbook's old location a forwarding link stays behind, so anything that names the old place — scripts run by sensors and wake-ups, notes, role files — still reaches the same content. These forwarding pieces are permanent for now. They never appear as role skills, and they don't clutter the role skill editor.

- **Clock-fired instructions are repointed.** Wake-up instructions and scheduled-task prompts that name a runbook's old location are rewritten to name the new location. Only the location changes; the surrounding words, including the word "runbook", are left as written.

- **What an agent sees at load.** Under each role it holds, the agent's load context lists every role skill: its name, its description, and where it lives, with the standing instruction to read and follow one when its description fits the situation. The full steps are not included. A role skill whose frontmatter can't be read still appears, as a line saying it exists but couldn't be read and should be opened and its frontmatter fixed. A role with none says so.

- **Change notices.** When a role skill is added, changed or deleted, or a role is gained or lost mid-session, the notices an agent receives speak of role skills and point at the new locations. A newly added role skill's notice includes its description.

- **In the app.** The role window's "Runbooks" tab becomes "Skills" and lists the role's skills. Opening one opens the role skill editor (same capabilities as today: edit files, add and delete files, rename, delete). New: a "new skill" action on the tab asks for a name and a required description and creates the role skill already in the standard shape, then opens it. Every user-visible mention of runbooks in the app says role skills / skills instead.

- **The id skill.** Its teaching about runbooks is rewritten to teach role skills: where they live, their standard shape, that they arrive in the load context with descriptions, when to use one, the role window's Skills tab including creation, and the same editing governance runbooks had.

## Philosophy

This is a rename plus a standard, not a new capability. Role skills are deliberately NOT placed into the harness's own skills list; agents know about them because the load context tells them. No invocation switches (user-invoked only / agent-invoked only) — kept simple on purpose, possibly revisited later. The conversion must be invisible to the work in flight: nothing that worked yesterday stops working today.

## Prior context

Runbooks today: named folders in a role's space, main file either "runbook" or named after the folder, no required frontmatter. Agents loading see only their names. The role window has a Runbooks tab that opens existing ones for editing but cannot create one. On the workstation, many wake-ups and scheduled tasks point at runbook locations by path, and some runbooks hold scripts that sensors run in place; some of those path references already point at runbooks that no longer exist. Runbooks exist on t1000, the workstation, thenasty and zoeybattlestation; the two laptops/beelink were unreachable during shaping.

## What would make it wrong

- A wake-up or scheduled task fires after the conversion and its instruction or script points at nothing.
- An agent gets a flood of "your runbook changed" notices because the move looked like edits.
- A generated description reads like a technical spec or a how-to instead of "what it does and when to reach for it".
- A role skill with broken frontmatter silently vanishes from what an agent is told.
- Anything user-facing in the app still says "runbook".
- The forwarding links show up to users or agents as if they were role skills.
- A box that was offline during rollout is never converted.

## Scope edges

- **In:** the rename across app, backend, load context, change notices and id skill; the standard shape; fleet-wide conversion with descriptions; forwarding links; repointing clock-fired instructions; creating a role skill from the app.
- **Out:** putting role skills in the harness skills list or making them typeable as commands; invocation switches; rewording free text in instructions, role files or notes.
- **Deferred (next shape, fresh session):** a focused pass replacing the word "runbook" with "role skill" wherever it means the concept — instructions, role files, notes — across the fleet.
- **Deferred:** ever removing the forwarding links.

## Handoff notes

Implemented by cardinal-box-maintainer-3 inside campaign role-skills. Box-maintainer rules apply: commit with scoped tests green, then stop — no push or deploy without the user's separate greenlight. Role-file wording changes (e.g. box-maintainer's own role file pointing at runbooks) are proposed to the user, not written silently. Any user-facing change also needs the id skill edit and a what's-new note whose text the user approves first.

---

## Close-Out

**Closed:** 2026-10-21
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The role skill** — present · Role skills live in the role's skills area, one folder each, standard frontmatter, companions alongside; every reader and writer uses that location.
- **Conversion of what exists** — drifted · Runs in per-box upkeep on both surfaces, handles every old shape, idempotent, quiet, retried on failure. The generated descriptions are not applied by the conversion itself; the user accepted applying them as a deploy-time step for the four reachable boxes, with unreached boxes left to the "add a description" flag.
- **Description quality** — present · 43 descriptions, one or two sentences each, "what it does / use when".
- **Nothing breaks (forwarding links)** — present · Relative links at every old path, permanent, retargeted on rename, excluded from listings, editor, load and watcher.
- **Clock-fired instructions are repointed** — present · Wake-up and scheduled-task specs repointed, path-only, JSON-validated.
- **What an agent sees at load** — present · Name, description, location and the standing instruction; unreadable ones flagged; "none" when empty.
- **Change notices** — present · Role-skill wording and new locations; added notice carries the description; baselines carried over.
- **In the app** — present · Skills tab, editor unchanged in capability, "+ New skill" with required description; no user-facing "runbook" wording.
- **The id skill** — present · Rewritten to teach role skills, the Skills tab and creation, same governance.
- **Philosophy: not in harness skills list, no invocation switches** — present.
- **Scope edges: deferred terminology sweep and link removal** — present.
- **Handoff notes: no push or deploy; what's-new note and role-file proposal pending approval** — cannot-verify · by design still pending.
- **What would make it wrong: A wake-up or scheduled task fires after the conversion and points at nothing** — present.
- **What would make it wrong: A flood of "your runbook changed" notices** — present.
- **What would make it wrong: A description reads like a spec or how-to** — present.
- **What would make it wrong: A role skill with broken frontmatter silently vanishes** — present.
- **What would make it wrong: Anything user-facing in the app still says "runbook"** — present.
- **What would make it wrong: Forwarding links show up as role skills** — present.
- **What would make it wrong: A box offline during rollout is never converted** — partial · Converted when next reached; arrives without descriptions and is flagged for its agents to fill in (accepted).

### Additions (in the result, not in the shape)

None.

### Follow-ups

- The role window's Files tab will show a folder named "runbooks" holding the forwarding links — accepted-as-drift (the user: fine to show it; it shouldn't be hidden).
- Descriptions for runbooks on the beelink and the laptop were never generated — accepted-as-drift (the load flag prompts their agents to add them).

### Notes

The description gap was the only divergence. Renaming a role skill retargets its forwarding links; every role gets an empty skills area; loose single-file runbooks are converted too; descriptions in the load listing are cut at 300 characters.
