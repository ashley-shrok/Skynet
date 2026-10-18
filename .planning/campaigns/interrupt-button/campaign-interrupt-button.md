# Campaign: The interrupt button does one honest thing in each situation

**Opened:** 2026-10-17
**Status:** in_progress
**Workspace:** .planning/campaigns/interrupt-button/

## Concept

The interrupt button in pretty view does exactly one honest thing in each situation. While a message is still being delivered, it is unavailable. If the agent is stopped before it has done anything with the latest message, that message is cancelled: it disappears from the conversation, the agent never saw it, and the user gets their words back (into the compose box, or into a new queued-message box if they had already started typing something else). If the agent had already started, the button stops it: the message stays, a clear "Interrupted" bubble confirms the stop, and the work indicator goes off. The harness's own compose box is never left holding stale text that could ride along with the next send. Every decision is made from the session transcript alone, never by looking at the harness's screen, so the design survives a move to a headless harness.

## Success criteria

- One press always leaves the harness running with an empty compose box; it never exits the harness.
- What pretty view shows matches what the agent actually received, live and after a reload.
- Every press that does something gives visible feedback (bubble disappears for a cancel; "Interrupted" bubble for a stop).
- Cancelled text is never lost.

## Shapes

- **[declared] shape-interrupt-button** — all three cases end to end: unavailable while delivering; cancel with text returned; stop with Interrupted bubble and work indicator off; hiding cancelled messages after reload; interrupted line no longer counted as a delivery; decision-point logging; agents' app guide updated — closed

## Other work

## Lingerers (explicitly approved)

## Open questions

## Prior context

- Original design conversation: Xenon, 2026-10-05.
- Research and live proving run: Chorus, 2026-10-16. Proving kit (driver + 14 scenarios + logs) at `~/fleet/identities/chorus-box-maintainer-4/workspace/interrupt-proof/`. All scenarios pass on Opus with fleet launch flags.
- Settled: queued follow-ups are not cancelled by an interrupt (the harness starts them after the stop).
- Harness bug found and reported: a cancelled message is revived if the harness restarts before the next message (https://github.com/anthropics/claude-code/issues/103213). Decided: no stored cancellation note; the transcript decides after the live moment.
