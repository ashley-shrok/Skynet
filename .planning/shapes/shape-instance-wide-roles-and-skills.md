# Shape: Instance-wide roles and skills

**Opened:** 2026-10-09
**Vehicle:** inline

## What this is

An admin can make a skill or a role instance-wide. The app then holds the master
copy and keeps every agent-running host's copy in step — additions, edits and
removals arrive everywhere, and hosts that were offline or are newly added catch
up on their own. On the hosts, these skills and roles sit in exactly the places
agents already use, so agents read and edit them natively and never need to know
which ones are instance-wide. Edits an agent makes on an admin's host flow back
into the master copy and out to everyone; edits on anyone else's host are undone
at the next sync. Two motivating uses: an operator with many hosts who wants a
skill or role available everywhere without copying it around by hand, and a
company instance (one employee per host) that hands every employee's agents the
same role — say, a technical-support agent — and pushes updates to it.

## Shape

**The master copy.** Lives inside the app, alongside its other data. No host is
special; losing or retiring a box loses nothing. It holds whole skill folders and
whole role folders — every file in them.

**Where copies land on a host.** Instance-wide skills go in the regular skills
folder of the host's agent user — the same folder personal skills live in.
Instance-wide roles go in the regular roles location. Nothing new for agents to
learn about where things are.

**Which hosts.** Every host already flagged to receive the standard agent files.
No per-host opt-out, no targeting.

**Distribution — two-way sync.**
- Saving, adding or removing an item in the app pushes it to every reachable
  host immediately.
- A catch-up every five minutes compares each host's copies against the master
  and settles differences. This covers offline hosts, newly added hosts, and
  changes made on hosts.
- When a host's copy differs from the master:
  - if the host is owned by an admin and the master has not changed since that
    host last synced, the host's version wins — it becomes the master and goes
    out to everyone;
  - otherwise the master wins and the host's copy is put back.
- The existing watcher that notices role-file changes can prompt an immediate
  sync, so admin-host edits travel in seconds rather than minutes.
- Conflict: two admin hosts change the same file between syncs. The master keeps
  whichever arrived first. The other version is not thrown away — it is saved
  beside the file on that host under a clearly-named conflict name, and the item
  shows a conflict in its sync status.
- Deleting a single file inside an item on an admin host deletes it everywhere.
  But a whole skill or role folder going missing from a host never means
  "remove it everywhere" — it is simply restored. Removal is an app action only.
- Everything in a folder travels, except editor-backup and cache files, which
  are ignored by name pattern.

**Who can change things.** Only admins create, edit, remove or promote
instance-wide items in the app, and only hosts owned by admins write back. Everyone
else can see and use them but cannot change them.

**In the app.**
- The skills window and the roles window each get an instance-wide section,
  separate from the selected host's own items, with a clear marker. Admins see
  editing controls there; everyone else sees it read-only.
- Each instance-wide item shows a quiet sync status: silent when every host is
  current; a short warning ("2 hosts behind", "1 conflict") otherwise; clicking
  it shows which hosts and why. No alerts or messages. Hosts the app has not
  heard from recently are not counted as behind — they catch up when they return.
- When an admin opens an instance-wide role or skill through a particular host's
  view, edits go to the master copy; non-admins see it read-only.
- The role picker for a new conversation shows instance-wide roles on every
  host, with the same marker.

**Promote.** An admin-only "make instance-wide" action on a personal skill or a
local role. It takes the whole folder as-is, with a blanket warning that
everything in the folder will go to every host. Before proceeding, the app checks
every host for an existing skill or role with the same name and lists them; the
admin confirms (those copies will be replaced) or backs out to rename. The
original becomes the instance-wide copy in place — there is no leftover personal
duplicate.

**Remove.** Its own admin action, with a confirmation naming how many hosts it
comes off. Removing deletes the whole skill or role folder on every host.

**Running agents.** Nothing special. Updated role files already reach running
agents through the existing role-file-change notice; skills are re-read when used.

**Retiring role history.** "History" is an old role concept that would collide
with the master copy being law. Remove its mention from the identity skill, delete
the role-creation skill entirely (and take its installed copies off every host),
and delete the backend's dead history read/write code. Existing history files on
boxes are left alone.

**Identity skill.** Updated in the same piece of work to describe the
instance-wide sections, markers, sync status, promote and remove — what the user
sees. Agents need only a short note, if any; the native-editing design means they
do not need instructions for editing instance-wide items.

## Philosophy

- The master copy is law. Whatever is on a host is either the master or about to
  be replaced by it — except where an admin's own host is the one changing it.
- Native first. Agents keep using the filesystem exactly as they do today; nothing
  in this design asks them to file requests or learn special paths.
- One mechanism for skills and roles. They differ only in the windows that
  manage them.
- Quiet when healthy, visible when not. No alerts, but "did my update land
  everywhere?" is always answerable.
- Never lose work silently: conflicts are kept aside, and a missing folder is
  restored, never interpreted as a removal.

## Prior context

- Today every role and every skill lives on exactly one host. The skills and roles
  windows ask for a host and show only that host's items; starting an agent fails
  if the role folder is not on that host.
- Copying a skill to another host is manual (e.g. light-review copied to thenasty
  by hand this session).
- The app already pushes a fixed set of built-in files (the identity skill, the
  phone skill, the instance-wide policy file) to every host flagged for standard
  agent files, including writes that need admin rights on the host. But that push
  runs once per app start and only carries files baked into the app.
- Hosts have owners and users have an admin flag, so "admin-owned host" is
  determinable.
- Some role folders hold credentials, backups and scratch; under whole-folder
  promotion those travel too — hence the blanket warning.
- An earlier proposal — agents send edits to the app as requests — was rejected:
  non-native, and it would bloat the identity skill for hosts that cannot use it.
- An earlier proposal — put instance-wide skills in Claude Code's system-wide
  skills folder — was rejected: agents would not know where to edit them.

## What would make it wrong

- An agent's edit to an instance-wide item on an admin's host silently fails to
  propagate, or silently gets reverted.
- A non-admin's host changes an instance-wide item for everyone.
- Two edits collide and one simply vanishes with no trace.
- A box being rebuilt or a folder being deleted by accident removes a role or
  skill from every host.
- An admin updates something and has no way to tell whether it reached
  everywhere.
- Agents need to be taught about instance-wide items in order to work with them.
- The sync becomes noisy — alerts, pings, or "behind" warnings for laptops that
  are simply off.
- A host that was offline comes back and stays stale.

## Scope edges

**In:** the master store; two-way sync with immediate push, five-minute catch-up,
admin-host write-back, conflict keeping, removal guard and ignore patterns;
instance-wide sections and markers in the skills and roles windows; sync status;
admin-only promote and remove with clash check and blanket warning; role picker
marker; identity skill update; removal of role history, the role-creation skill
and the dead history code.

**Out:** demoting an instance-wide item back to personal; per-host opt-out or host
targeting; non-admins suggesting changes for admin approval.

**Deferred:** promoting /build, /campaign, /open and /close to instance-wide and
retiring their self-download from thenasty (tracked as follow-up in the campaign).

**Tempting but no:** content-aware credential detection on promote; a separate
admin-panel section for instance-wide items; notifying running agents of updates.

## Vehicle notes

Inline, worked by emerald-box-maintainer-2 in this session, with harness tasks
tracking the pieces. Ashley is evaluating the new model's performance on this
work, so it stays inline rather than going through a GSD phase. The running
decision log with the reasoning behind each point is
`instance-wide-decisions-draft.md` beside this file. Box-maintainer rules apply:
scoped tests during development, full suite only at the deploy gate; commit
without pushing until Ashley gives the word; any user-facing change must update
the identity skill in the same piece of work.
