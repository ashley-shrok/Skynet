# Campaign: Instance-wide roles and skills

**Opened:** 2026-10-09
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/emerald-box-maintainer-2/workspace/skynet/.planning/shapes/

## Concept

Skills and roles can be marked instance-wide. Instead of living on one host and
being copied around by hand, they are authored once and the app keeps every
host's copy in step — new ones appear, updates propagate, removals disappear,
and hosts that come online later catch up. Two motivating cases: an operator
with many hosts who wants a skill generally available without babysitting
copies, and a company instance (one employee per host) that wants to hand every
employee the same role or skill — e.g. a technical-support agent — and have
updates reach everyone. Skills and roles ride the same mechanism; they diverge
mainly in the admin interface and in what part of a role is shared.

## Success criteria

- Authoring, updating or removing an instance-wide skill or role once in the app
  results in every agent-running host having the current version, without manual
  copying; offline or newly added hosts catch up on their own.
- Agents read and edit instance-wide skills and roles natively, in the usual
  places; edits on admin-owned hosts reach everyone, edits elsewhere are undone.
- No edit is ever lost silently, and no accidental local deletion removes an
  item everywhere.
- An admin can always see whether an item has reached every host.
- A company-style instance can roll a role (e.g. a support agent) out to every
  employee's host, push updates to it, and employees cannot alter it.

## Shapes

- **[declared] shape-instance-wide-roles-and-skills** — the shared distribution
  mechanism plus the skills and roles surfaces on top of it — in_progress

## Other work

- After shipping: consider promoting /build, /campaign, /open, /close to instance-wide and retiring their self-download from thenasty (watch for non-instance consumers of the thenasty endpoint, e.g. Stacy) — deferred follow-up, out of shape scope

## Lingerers (explicitly approved)

## Open questions

All resolved in the shape's /open — see shape-instance-wide-roles-and-skills.md
and instance-wide-decisions-draft.md. Original list kept for the record:

- Where the master copy lives (app-side store vs. a designated host).
- Distribution timing: push on change + catch-up sweep for offline/new hosts.
- Are distributed copies locked on hosts; how are they marked in the app.
- Who may author/promote instance-wide items (admin-only?).
- Name clash with a local item of the same name.
- Promote local → instance-wide, and demote back.
- Which hosts receive them (all fleet-substrate hosts? opt-out?).
- Whether /build, /campaign, /open, /close stop self-downloading from thenasty.
- Roles: what's shared (definition) vs. kept per host (history / accumulated state).
- Roles: what an agent does when it wants to edit an instance-wide role file.
- Roles: keeping credentials out of distributed role folders.
- Roles: picking an instance-wide role when starting a conversation on any host.
