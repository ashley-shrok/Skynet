# Campaign: communicate to sessions that are being resumed after a long time the length of time they were out

**Opened:** 2026-10-14
**Status:** in_progress
**Workspace:** .planning/campaigns/resume-gap-notice/

## Concept

An agent picking a conversation back up after a long silence has no idea how much time passed — a dormancy wake, a crash recovery, or an always-on agent left idle for days all look, from the inside, like the next turn arriving immediately. Fix that: whenever a message reaches an agent after a gap longer than a threshold since the conversation's previous activity, the agent is told — alongside that same message — how long it has been (duration plus from/to timestamps). Mechanism: a fleet-distributed Claude Code hook that runs on every incoming message (the same kind as the existing task-line reminder), so it covers every cause of a gap uniformly and lands atomically with the message that ended the gap.

## Success criteria

- Every agent that receives a message after a gap of 30 minutes or more since its conversation's last activity knows the length of that gap in that same turn — regardless of what caused the gap (dormancy, crash recovery, plain idleness) or what kind of message ended it (user, relay, scheduled wake-up, file-change event).
- Gaps under the threshold produce nothing.
- The note is a bare factual line, kept out of the user's chat view like the task-line reminder.
- No id-skill guidance is added (user: don't solve problems we don't have yet).

## Shapes

- **[declared] shape-resume-gap-notice** — per-message hook that tells the agent how long since its last activity when over 30 min; distributed to the fleet — closed

## Other work

## Lingerers (explicitly approved)

## Open questions
