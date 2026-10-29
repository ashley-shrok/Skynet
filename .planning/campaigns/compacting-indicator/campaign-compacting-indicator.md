# Campaign: make the work-in-progress indicator show when condensing, and rename condensing to compacting across the board

**Opened:** 2026-10-29
**Status:** in_progress
**Workspace:** ~/fleet/identities/bifrost-box-maintainer-4/workspace/skynet/.planning/campaigns/compacting-indicator/

## Concept

While an agent's conversation is being compacted, the conversation should look busy: the working orb shows, with a fixed line saying the conversation is being compacted, instead of the conversation looking idle while only the memory pie hints at it. At the same time, everything a user can see that says "condense" / "condensing" / "condensed" says "compact" / "compacting" / "compacted" instead, and the agent-facing description of the app follows suit.

## Success criteria

- From the moment a compaction is asked for until the agent's follow-up turn begins, the conversation shows the working orb — never a stretch where it looks idle.
- Nowhere a user can see (labels, buttons, confirms, errors, the chat divider, screen-reader text) says condense/condensing/condensed.
- Every agent's description of the app uses the new word.

## Shapes

- **[declared] shape-compacting-indicator** — orb + fixed line while compacting; user-facing rename; agent-facing description — closed

## Other work

## Lingerers (explicitly approved)

## Open questions
