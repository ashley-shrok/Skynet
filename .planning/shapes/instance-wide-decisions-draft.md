# Instance-wide roles & skills — running decisions (pre-shape-file)

Agreed with the user during /open discussion, 2026-10-09. Folded into
shape-instance-wide-roles-and-skills.md when written.

1. Master copy lives inside the app (with host list / app data), not on a
   designated host. Follow-up: agents need a path to edit instance-wide items
   on the user's behalf.
2. Distribution = immediate push on change + catch-up sweep every ~5 min
   (repairs offline/new hosts and hand-edited copies).
3. Sync status shown quietly per item: silent when all current, "N hosts behind"
   warning otherwise, click for which/why. No alerts.
4. Hosts not heard from recently are not counted as "behind"; skipped quietly,
   catch up on return.
5. Running agents: no special handling — role-file updates reach them via the
   existing file-change watcher; skills are re-read on use.
6. Instance-wide skills install to Claude Code's system-wide skills folder
   (/etc/claude-code/.claude/skills — verified on t1000: loaded for every user,
   appears as slash command, SILENTLY hides a same-name personal skill). Written
   via the distributor's existing sudo system-root path. Effectively locked;
   catch-up repairs edits. Skills window shows them as their own marked section;
   editing goes to the instance-wide editor, never a host copy.
7. Name clashes: on create/promote, app checks every host for a same-name
   personal skill and lists them before proceeding (proceed or rename). Later
   personal-skill creation with a clashing name warns it will be hidden.
   (Roles have no system-wide equivalent — handled in roles discussion.)
8. Admins only may create / edit / remove / promote / demote instance-wide
   items; everyone else sees + uses them read-only.
9. UI lives inside the existing skills (wrench) and roles (drama masks) windows
   as an "instance-wide" section — admins see edit controls, others read-only.
   Personal skills get an admin-only "Make instance-wide" menu item. NOT a
   separate crown/admin-panel section.
10. Promote (personal -> instance-wide) MOVES: personal copy removed from the
    source host once the instance-wide copy lands. The clash check offers to
    also remove same-name personal copies on other hosts as part of promotion.
11. NO demote. Out of scope. Removing an instance-wide item is its own action,
    with a confirmation naming how many hosts it comes off.
12. Recipients = every host flagged to receive the standard fleet files (the
    existing per-host flag). No per-host opt-out, no host targeting — deferred.
    Role `users:` visibility covers "only some people see this role".
13. /build & friends self-download retirement: OUT of shape; logged as campaign Other-work follow-up.
14. MASTER IS LAW for both skills and roles: any host-side change inside an
    instance-wide skill or role folder disappears on next distribution.
15. Role promotion = the whole folder, as-is. Blanket warning on promote (not
    content-based) that everything in the folder goes to every host.
16. Removing an instance-wide role deletes the whole role folder on every host.
17. Role "history" concept removed: drop mention from the id skill; DELETE the
    /role skill entirely (old concept); delete dead backend history read/write
    code. Existing history files on boxes left alone.
18. Agent edits = NATIVE, via two-way sync (supersedes "agents send edit requests
    to the app" proposal, rejected as non-native + id-skill bloat):
    - Admin-owned hosts write back: host change -> master -> everywhere.
      Non-admin hosts are reverted at next sync. Agents never know the difference.
    - On admin-owned hosts, instance-wide skill folders in the system area are
      owned by the agent's user so native edits work; locked elsewhere.
    - Detection: catch-up compares host vs master; if host differs and master
      unchanged since that host's last sync -> host wins. Existing role-file
      watcher can trigger an immediate sync for speed.
    - Conflicts (two admin hosts edit between syncs): master keeps first arrival;
      the other version saved beside the file on that host under a clear
      "conflict" name; sync-status shows "1 conflict". Nothing lost silently.
    - Single-file deletion on admin host propagates. Whole skill/role folder
      vanishing NEVER means remove-everywhere — removal is app-only; a missing
      folder is restored.
    - Junk travels (everything in the folder), except editor-backup / cache
      files ignored by name pattern. (the user thumbs-up'd the bundle incl. this.)
19. REVISES 6/7: instance-wide skills live in the regular harness skills folder
    (the agent user's personal skills location) on each host — NOT the system
    folder. Agents edit them natively where they already look. Name clash =
    same folder: promote lists hosts with a same-name skill and confirms before
    replacing (mirrors roles). Ownership trick from 18 dropped.
20. Roles: copies live in the normal roles location; appear in role picker on any
    host with the instance-wide marker; promote clash = list + confirm; app role
    windows on a host route edits to master for admins, read-only otherwise.
    (Proposed; no objection raised.)
21. Vehicle: inline (the user: "evaluating perf on new model and this is good for that").
