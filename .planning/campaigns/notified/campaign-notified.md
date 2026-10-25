# Campaign: rename DMs from agents to users — call it "notified"

**Opened:** 2026-10-25
**Status:** closed
**Workspace:** .planning/campaigns/notified/

## Concept

When an agent messages the user one-on-one over the relay to get their
attention, the app calls it a notification, never a DM. The relay is just
how it travels, and the user doesn't need to know that. Agents keep "DM" as
the exact word for the mechanism. What agents read about the user's side
explains that a one-on-one DM to the user is what the user sees as being
notified, and that "notify me" from the user means exactly that. Where the
notification ends up (phone, desktop app) isn't named anywhere, because it
depends on how the user set up their bot.

## Success criteria

- Nothing the user sees calls an agent-to-user message a DM; it reads as the agent having notified them.
- Nothing the user sees about notifications promises a phone.
- Agents can still tell, without ambiguity, that notifying the user means a one-on-one relay DM to the user's account.
- Agent-to-agent messaging keeps the word DM everywhere.

## Shapes

- **[declared] shape-notified** — user-facing wording becomes "notified", agent docs bridge DM ↔ notify, no phone mentions — closed

## Other work

- Collapsed project/Projects-header envelopes' screen-reader label also changed to "An agent notified you" (review finding; same envelope) — done
- Envelope shows on a message while its send is still pending (pre-existing; the shape kept envelope rules out of scope) — noted-only, offered to the user as a possible follow-up

## Lingerers (explicitly approved)

## Open questions
