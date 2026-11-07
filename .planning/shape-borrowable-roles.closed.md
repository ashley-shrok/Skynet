# Shape: Roles an agent can borrow on its own, like a skill, without taking them on for good

**Opened:** 2026-11-07

## What this is

A role can be marked borrowable. Any agent on that box is told which borrowable roles exist, each with its one-line description, so when a request fits one it can pick that role up on its own for the work at hand, much as it picks up a skill. Borrowing never makes the role one of the agent's own roles, so it fades at the agent's next compaction instead of reloading. The user marks and unmarks roles as borrowable from the app. This is a first version to try out and learn from.

## Shape

- **The borrowable mark.** A setting a role carries. Roles are not borrowable unless marked. Unmarked roles behave exactly as they do today.
- **The list.** When an agent loads, and again after each compaction, it is handed a list of the borrowable roles on its box that it doesn't already hold, each with its one-line description and where to read the role. The list arrives as its own separate piece of the startup material, so it never takes room from the agent's own identity, roles or project. Each description in the list is cut to the same length the role-skills list already uses. When no roles are borrowable, or the agent already holds all of them, nothing appears.
- **Borrowing.** The id skill explains, as general guidance rather than rules, what borrowing is and how to do it: read the role's file and its role skills; work under that role's directives while doing its work, with the borrowed role combining with the agent's own roles the way held roles already combine; say in the conversation that you borrowed it; never add it to your own roles. Learnings about the borrowed role's domain are proposed to that role's file under the usual approval rule. When an agent notices it keeps coming back to the same borrowed role, it can offer to take that role on for good, and only does so if the user says yes. Taking a role on for good still happens only when the user asks.
- **The switch in the app.** A borrowable switch on the new-role form and on an existing role's page beside its colour and voice. A small "Borrowable" tag on those roles in the roles list. For roles kept on every host, the switch follows the same rule as that role's other settings: only admins can change it, and everyone else sees it read-only.

## Philosophy

Roles stay roles. This adds a second, lighter way to use one, not a merge of roles into skills. The user decides which roles are open to borrowing; the agent decides when one fits, the way it does with skills. Borrowing is temporary by nature: the compaction is what gives the role back. The guidance trusts agents' judgement and is written as general guidance, not counted thresholds or rigid rules.

## Prior context

Today an agent only knows a role exists if the user tells it or it goes looking, and the only way to use a role is to take it on, which writes it into the agent's own roles so it reloads after every compaction. A long-lived generalist agent at home would carry every domain forever that way; specialist agents at work are hand-picked on purpose and shouldn't grab roles. The startup material each agent receives is limited per piece, and files that don't fit already become read-this pointers; a separate piece gets its own full allowance.

## What would make it wrong

- An agent writes a borrowed role into its own roles without the user asking.
- An agent on a box with no borrowable roles sees anything new, or starts taking on roles by itself.
- The borrowable list crowds out the agent's own role, identity or project material at startup.
- A borrowed role is reloaded automatically after a compaction, or vanishes from the list after one.
- Roles the agent already holds show up as borrowable.
- Someone who can't change a role's other settings can flip its borrowable switch.
- The guidance reads as a rulebook of counts and triggers rather than general guidance.

## Scope edges

- **In:** the mark; the startup list on load and after compaction; the borrowing guidance in the id skill; the switch on the new-role form and on an existing role; the tag in the roles list.
- **Out:** any visible mark in a conversation showing that a role is being borrowed (the agent says it in its reply instead); loading a borrowed role's scheduled tasks or folder listing; letting borrowing happen in a separate helper agent.
- **Deferred:** opening up work roles, which is the user's call after trying this.
- **After deploy, not part of the build:** marking the media role borrowable on the home agent's box, with the user's go-ahead.

## Handoff notes

Worked by aster-box-maintainer-5 in its own workspace clone. The startup list and the id skill both ship through the app's substrate distribution, so the change reaches every box on the next distributor sweep after deploy. The roles window already saves each setting by merging one key into the role file's frontmatter; the switch follows that pattern. The id skill is a fleet-distributed skill; its edits go in the repo copy, never the installed copy.

---

## Close-Out

**Closed:** 2026-11-07
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The borrowable mark** — present · Only an explicit true counts; new roles start unmarked; unmarking removes the setting.
- **The list on load and after compaction** — present · Its own startup step on the same events as the agent's normal load, so it returns after every compaction.
- **List is its own separate piece of startup material** — present · Own allowance; a very large list drops descriptions first, then shortens; never takes room from the agent's own material.
- **List excludes held roles; name, description and where to read it** — present
- **Descriptions cut to the role-skills length** — present
- **Nothing appears when no roles are borrowable or all are held** — present · Also silent while a box still has an older load script.
- **Borrowing guidance in the id skill** — present · General guidance, no counts or triggers.
- **Switch on the new-role form** — present · Off to start; saved into the new role's file.
- **Switch on an existing role's page beside colour and voice** — present · Saves at once.
- **Borrowable tag in the roles list** — present
- **Shared roles: admin-only, read-only for others** — present
- **What would make it wrong: an agent writes a borrowed role into its own roles unasked** — present
- **What would make it wrong: a box with no borrowable roles sees anything new** — present
- **What would make it wrong: the list crowds out the agent's own material** — present
- **What would make it wrong: a borrowed role reloads after compaction or vanishes from the list** — present
- **What would make it wrong: held roles show up as borrowable** — present
- **What would make it wrong: someone who can't change other settings can flip the switch** — present
- **What would make it wrong: the guidance reads as a rulebook** — present
- **Out items** — present · None were built.
- **Deferred / after deploy** — present · Neither is in the material, as agreed.

### Additions (in the result, not in the shape)

- A one-line hint under both switches explaining what borrowable means — endorsed-as-drift
- The id skill's opening stance on roles now also mentions borrowing a listed role — endorsed-as-drift
- An over-long list drops descriptions, then ends with a count of the rest — endorsed-as-drift
- An existing id-skill line reworded from "borrowing one role's face" to "wearing one role's face" so the word isn't overloaded — endorsed-as-drift

### Follow-ups

None.

### Notes

No divergences needed the user's input.
