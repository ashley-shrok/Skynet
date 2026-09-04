---
name: next-bounty
description: Initiates work on a pinned bounty — random by default, or a named one if given as argument.
---

# next-bounty

The user is about to start work on a bounty. Do these two steps this turn, consecutively:

1. **Pick.**
   - **If an argument was given**, treat it as a bounty identifier: try an exact match on slug (the bounty folder name under `~/.claude/roles/<role>/bounties/`) first, then a substring match against slug or `.title`. The named bounty does NOT need to be pinned. If nothing matches, tell the user + list the closest candidates and STOP — do not fall through to a random pick.
   - **If no argument was given**, list the current role's pinned bounties — bounty.json files under `~/.claude/roles/<role>/bounties/` where `.pinned == true`. CHOOSE RANDOMLY AND DO NOT ASK THE USER WHICH ONE TO CHOOSE.

2. After reading the bounty for yourself, do whatever code reading, research, or other read-only investigation you need to do to get familiar with the bounty.

3. **Set context via /explain.** Once picked, use /explain skill on that bounty — cover the **premise** (why + what), **where it has gone** (timeline entries so far), and **current state** (todos still open, status, any blocker). Context-setting because work is about to begin; the user needs the full mental model before we start.
