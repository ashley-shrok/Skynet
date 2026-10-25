# Shape: rename DMs from agents to users — call it "notified"

**Opened:** 2026-10-25

## What this is

When an agent sends the user a one-on-one message over the relay to get their
attention, the user should see it as the agent having **notified** them, not
as a DM. The relay is just how it travels. The words the user sees change to
match, and no notification wording promises a phone. The instructions agents
read about the user's side get reframed around the same word. They keep "DM"
as the exact name for what the agent does, and spell out that a one-on-one DM
to the user is what notifying the user means. They also explain how the user
experiences it: it always stands out in the app, and when Telegram is set up
it reaches them there too.

## Shape

**What the user sees**

- The red envelope on a message an agent sent the user: its hover label reads
  "Notified you", followed by the time. It no longer says "Also sent to your
  phone".
- The red envelope on the agent's picture in the sidebar: its hover label reads
  "Notified you", replacing "Sent you a message".
- Preferences → Notifications: the line under the section name reads "When an
  agent notifies you, it arrives through Telegram."
- Nothing else visible changes. The envelope keeps its look, a message the
  agent sent the user stays an ordinary open bubble, and messages between
  agents keep calling themselves DMs.

**What agents read (the id skill)**

- The section now titled "Reaching the user by relay DM" becomes **"Notifying
  the user"**, presented in this order:
  - **What it is.** Notifying the user means DMing their relay account in a
    one-on-one room. Nothing else notifies them: a message in a room with
    three or more participants doesn't, and neither does an ordinary reply in
    the agent's own conversation.
  - **What the user experiences.** In the app it always stands out from an
    ordinary reply. The message carries a red envelope, and the agent's
    conversation gets the same envelope in the sidebar and moves to the top
    tier of the list until the user opens it. If the user has set up Telegram
    under Preferences → Notifications, it also arrives there, which is
    usually the more prominent of the two.
  - **The vocabulary bridge.** The app calls this being notified. When the
    user says "notify me when X", they mean DM them one-on-one when X
    happens.
  - **Rules of use.** Same substance as today: follow the user's
    notification preferences, and default to conservative. The muddled
    group-room bullet goes away, since a group room never notifies.
- Other places in the id skill that describe the envelope (the sidebar row
  description and the conversation view's messages description) use the
  "Notified you" wording, point at the renamed section, and drop any mention
  of a phone.
- The Preferences → Notifications entry in the id skill stops calling them
  phone notifications. It quotes the new hero line where it quotes UI text.
- Anywhere else the id skill refers to the old section by its old name, it
  points at the new name.
- Agent-to-agent wording stays "DM" throughout (peer-agent DMs, DMing
  another agent on the user's behalf, being woken by a relay DM).

## Philosophy

The user's vocabulary follows what the thing does for them; the agents'
vocabulary follows what they actually do. Neither word gets bent to fit the
other. Instead, the agent docs carry an explicit bridge between them. "DM"
stays unmistakable for agents. "Notify" gets one precise meaning for them,
not a fuzzy one. This is a wording change, not a behavior change: no
notification logic, sorting, or delivery changes.

## Prior context

Copper's conversation-view redesign already removed the folded card, the DM
tag and the "what's a DM" explainer from messages to the user. Those messages
are now open agent bubbles with a red envelope, so very little user-facing
"DM" wording is left. The Telegram notification itself never said DM. In the
code, notifications already fire only for one-on-one rooms between an agent
and a user. The current id skill section treats Telegram as the main
outcome, doesn't mention that the app itself always marks the conversation,
and implies a group room could be a notification.

## What would make it wrong

- An agent reads the new section and concludes that "notify" could mean
  something other than a one-on-one relay DM: a group-room post, a louder
  reply, or a phone call.
- Agents start describing agent-to-agent messages as notifications, or the
  word DM disappears from the agent-to-agent docs.
- Any user-facing notification wording still promises a phone.
- The change accidentally alters notification behavior, sorting, or which
  messages show the envelope.

## Scope edges

- **In:** the two envelope hover labels, the Preferences → Notifications line,
  and the id skill wording described above.
- **Out:** agent-to-agent wording; how notifications are delivered or sorted;
  the envelope's look; the phone-number (calls) preference, which is a
  separate feature.
- **No What's new note** (user's call, 2026-10-25).
- **Tempting but no:** renaming internal names in the code. Internally "dm"
  stays.

## Handoff notes

saturn-box-maintainer-3 is doing the work, on the shared branch. The id skill
edit goes in the substrate source, never the installed copy. Tests that pin
the old hover labels or the Preferences line need updating with the new
wording. Committed only; push and deploy wait for separate greenlights.

---

## Close-Out

**Closed:** 2026-10-25
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What the user sees: message envelope hover label** — present · Reads "Notified you" followed by the time; "Also sent to your phone" is gone.
- **What the user sees: sidebar envelope hover label** — present · Reads "Notified you", replacing "Sent you a message".
- **What the user sees: Preferences → Notifications line** — present · Reads exactly "When an agent notifies you, it arrives through Telegram."
- **What the user sees: nothing else visible changes** — present · Only label text and one line of copy changed; the remaining phone wording belongs to the out-of-scope phone-number preference.
- **id skill: section renamed to "Notifying the user", in the agreed order** — present · What it is, what she experiences, the vocabulary bridge, rules of use; group-room bullet removed. "Top of its section" paraphrases "top tier of the list".
- **id skill: other envelope descriptions** — present · Both say "Notified you", point at the renamed section, no phone.
- **id skill: Preferences → Notifications entry** — present · No longer "phone notifications"; quotes the new line.
- **id skill: old section name references updated** — present · No remaining references to the old name.
- **id skill: agent-to-agent wording stays DM** — present · Peer-agent DMs, DMing on her behalf, being woken by a DM all intact.
- **Scope: no What's new note** — present · None added.
- **Scope: internal names stay "dm"** — present · Unchanged.
- **Handoff: substrate source; tests updated; committed only** — present · Single local commit, tests cover all three strings.
- **What would make it wrong: "notify" read as something other than a one-on-one relay DM** — present · Avoided; explicitly rules out group rooms and ordinary replies.
- **What would make it wrong: agent-to-agent messages called notifications / DM dropped** — present · Avoided.
- **What would make it wrong: user-facing wording still promises a phone** — present · Avoided; a test guards the Preferences line.
- **What would make it wrong: notification behavior, sorting, or envelope rules changed** — present · Avoided; only strings, comments and tests changed.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

No divergences. The planning documents committed alongside are process records, not product features.
