# Shape: A pass replacing the word "runbook" with "role skill"

**Opened:** 2026-10-22

## What this is

Runbooks became role skills in the first shape of this campaign, but the old word is still written all over the fleet: in role files, in the role skills themselves, in wake-up instructions and scheduled-task prompts, in agents' notes, in archived agents and roles, and in a few history comments in the app's code. This pass replaces it everywhere it means the concept, so nobody — agent or person — reading anything later is left wondering whether a runbook is something different from a role skill. Old locations written in prose move to the new locations too.

## Shape

- **One pass, box by box**, over every reachable fleet box: t1000, workstation, thenasty, zoeybattlestation. On each box it covers role folders (role files, role skills, reference files, history write-ups, logs, scratch), live agents' folders (their notes, wake-up instructions, other notes files), scheduled-task prompts, apps' notes, and the archives of retired agents and roles.
- **The swap.** "Runbook" meaning a role's skill becomes "role skill" — or "skill" where the role is already plain from context, such as a role skill referring to itself ("this skill"). Section headings and titles follow ("Runbooks" → "Role skills"). An old location written down (a role's old runbooks folder, an old main-file name) becomes the role skill's real location.
- **The app's code.** History-only comments get the new term. Places where the code is actually handling the old thing — the conversion itself, the forwarding links at old locations, the old web address still accepted from tabs opened before the rename — keep "runbook", because there it is the accurate name of what is being handled.
- **Running machinery is listed, not changed, in this pass.** Scripts, timers and sensors that start things by an old location keep working through the forwarding links. After the renaming is done, the user gets the complete list of what still runs from an old location, and decides what happens to each.
- **Pre-approved.** The user approved every edit up front, as long as it stays a straight terminology swap. Lines where it was a judgment call whether "runbook" meant the concept are listed in the wrap-up.

## Philosophy

Rewrite history on purpose: a session log or a design write-up that says "runbook" is just as likely to confuse a future reader as a live instruction is, so records get the new term too. This is a terminology swap, not an edit of meaning — nothing gets reworded beyond what the swap needs, and no instructions change what they say to do.

## Prior context

The first shape converted every runbook on the four reachable boxes into a role skill and left forwarding links at the old locations so nothing pointing at them broke. The app, the load listing, change notices and the guide every agent reads already speak of role skills. A scan before this shape found roughly a few hundred remaining mentions across the four boxes, most on workstation, and only history comments in the app's code.

## What would make it wrong

- Any mention of the concept still saying "runbook" outside the exceptions, on a reachable box.
- Ordinary English uses of the word changed — "the deploy runbook" meaning a deploy procedure, a compliance team's runbook documents that are not role skills.
- An edit that changes what an instruction tells an agent to do, rather than only what it calls things.
- A running script, timer or sensor broken by this pass.
- A rewritten location that points somewhere that does not exist.
- Files whose owner or permissions change as a side effect, or a forwarding link replaced by a copy of the file instead of the real file being edited.
- Running machinery still on old locations left unmentioned to the user.

## Scope edges

- **In:** everything above, on the four reachable boxes, including archives.
- **Out:** the old planning documents in the app's repository (the one place the user is fine with "runbook" staying); places in the code that handle the old thing; ordinary English uses; the two pipeline guides that use the word loosely to mean "instructions".
- **Deferred:** the beelink and laptop boxes, which are unreachable and whose runbooks have not been converted yet; what to do about running machinery on old locations (the user decides from the list).
- **Tempting but no:** removing the forwarding links — that depends on the machinery decision.

## Handoff notes

- Worked by cardinal-box-maintainer-3 inside the role-skills campaign. Committed, not pushed, not deployed — the code part ships at campaign close.
- A scan script that lists mentions on a box lives in this identity's workspace; it reads only a fixed set of kinds of file, so a wider search is needed for notes files, scratch and archives.
- Peer boxes are reached as root over the tailnet; files there belong to each box's own user and must stay that way.
- The test that bans the user's name in tracked files covers this folder — write "the user".

---

## Close-Out

**Closed:** 2026-10-22
**Overall verdict:** closed-with-misses at review; every miss fixed afterwards, and the user endorsed the remaining divergences (2026-10-22, "Okay, seems good").

### Shape features (conformance)

- **One pass, box by box** — partial at review · all four boxes covered; bounty records kept as data files were skipped (fixed in a second pass); one live agent's folder (copper, mid-port of this feature) exempted, which the user endorsed.
- **The swap** — partial at review · one live role skill (aithercloud deploy) and a few archive lines shielded by an over-broad exception (fixed in the second pass).
- **The app's code** — present · history-only comments changed; code that handles the old thing keeps the word. Some comments were shortened rather than swapped (endorsed: a straight swap would have been untrue).
- **Running machinery is listed, not changed** — drifted · the list was given to the user, who chose to have Jarvis, Mitzi, Aqua and a new WorkSpaces agent change it. Intended.
- **Pre-approved; judgment calls listed** — present · listed to the user in the wrap-up.
- **Philosophy** — partial at review · history rewritten on purpose; one meaning drift (wake-up procedure files treated as role skills), repaired.
- **Scope edges** — present.
- **What would make it wrong: concept still saying runbook** — partial at review · fixed in the second pass, except copper (endorsed).
- **What would make it wrong: ordinary English changed** — present · not triggered.
- **What would make it wrong: instruction meaning changed** — drifted · three wake-ups briefly pointed at a missing file; fixed by their agents.
- **What would make it wrong: running machinery broken** — drifted · same three wake-ups, about 18 minutes; repaired.
- **What would make it wrong: rewritten location points nowhere** — drifted · already-dead pointers swapped like for like (archives accepted); the two live ones repointed to where the procedures really live.
- **What would make it wrong: owner/permission changed or link replaced** — present.
- **What would make it wrong: machinery left unmentioned** — present · the list was handed to the user.

### Additions (in the result, not in the shape)

- Machinery changes done by Jarvis, Mitzi, Aqua and a WorkSpaces agent — endorsed-as-drift (the user's decision from the list).
- App history comments shortened instead of swapped — endorsed-as-drift.
- One wake-up spec re-saved with different spacing — endorsed-as-drift.

### Follow-ups

- Remove the forwarding links at the old locations now that the machinery is repointed — deferred (campaign close / later).

### Notes

The rule that turned an old main-file name into the new one also caught procedure files inside wake-up folders that were never role skills. Next time, confine location rewrites to role folders. Copper's notes still use the old names for its own in-flight code.
