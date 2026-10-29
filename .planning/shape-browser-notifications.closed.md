# Shape: browser notifications

**Opened:** 2026-10-29
**Campaign:** notify-when-done (shape 1 of 2)

## What this is

A way for notifications from agents to reach someone through their computer's own notification system, with no Telegram and no phone setup. It's switched on in Preferences → Notifications, next to Telegram. From then on, whenever an agent notifies them, an open tab of the app in that browser asks the computer to show a notification: the agent's name, then the message. Clicking it brings the app forward with that agent's conversation open.

## Shape

- **The setting.** It sits in Preferences → Notifications beside the Telegram setup and is off until turned on. Turning it on brings up the browser's Allow prompt. It belongs to this browser on this computer, not to the account: switching it on at work leaves the home browser as it was. A **Send a test notification** button sits with it. One short line under it says it works while a tab of the app is open in this browser.
- **When the browser says no.** If the user or their company's IT has blocked notifications, the setting says so plainly ("Your browser is blocking notifications from this site", plus how to undo it where they can). It never looks switched on when nothing can arrive.
- **What arrives.** For every notification from an agent, not only the ones the later bell asks for: the agent's name as the title, then the same message text Telegram would carry. It follows the computer's usual notification behaviour, so it isn't held on screen and gets no special sound. Clicking it focuses the app's tab and opens that agent's conversation.
- **How it gets there.** Every open tab already hears, the moment it happens, that an agent has notified the user (that's what raises the red envelope). That same live signal now also carries the words to show. No new server push.
- **One notification, however many tabs.** With several tabs open in the browser, exactly one of them shows it.
- **Quiet when it's already in front of you.** If the app's window is focused on that agent's conversation, no notification: the red bubble is right there. On another conversation, in another app, or with the tab in the background, it fires.
- **Desktop only.** On a phone a background tab loses its connection almost immediately, so the option is hidden there. Phones keep Telegram.
- **Telegram's wording.** Telegram notifications' "Open in Skynet" button, and the bot's own replies (connected, disconnected, link expired, "reply to agents in…"), use the instance's own name. (Extended from the button to the replies during the build, under the no-product-name rule.)
- **No product name in user-facing text.** Anything user-facing that needs to name the app uses the instance's own name, as What's new does. Otherwise the wording stays generic.

## Philosophy

The point is reach for people who can't use Telegram: an employee on a company laptop with the app in a background tab. It adds a delivery route. It doesn't change when agents notify or what counts as a notification. The setting is honest about its limits: it works only while a tab is open, and it can be blocked. It never stays switched on while nothing can arrive.

## Prior context

Browser push once existed and was removed because iOS silently drops push subscriptions. Telegram replaced it. This shape deliberately doesn't revive push: nothing works with every tab closed. The red bubble, the red sidebar envelope and Telegram all stay as they are, and browser notifications sit beside them.

## What would make it wrong

- Two tabs both show the same notification.
- The setting reads as on while the browser is blocking it, or on a phone where nothing would arrive.
- The notification says less than Telegram would ("New message"), or says something different.
- Clicking it opens the app but not the conversation.
- It fires for the conversation the user is looking at right now.
- Turning it on in one browser makes notifications appear in another.
- The word "Skynet" appears in anything the user sees.

## Scope edges

- **In:** the setting and its blocked and test states, live delivery to an open tab, one-per-browser deduplication, the in-focus skip, click-to-open, Telegram's wording, the What's-new note (once its text is approved), and a brief id-skill mention.
- **Out:** anything that works with no tab open, phones, an "only notify when away" option, changing when agents notify.
- **Deferred to the bell shape:** bringing up the Allow prompt from the bell when the user has no way to be reached outside the app.

## Handoff notes

- Worked by sulfur-box-maintainer-4 inside campaign notify-when-done. The shape ends committed, not pushed, not deployed; the deploy happens once, at campaign close.
- The live signal is the per-user "an agent notified you" signal that already sets the sidebar envelope. The message text is built in the same place as Telegram's, so the two stay identical.
- The id skill's Preferences → Notifications paragraph currently says "No desktop push"; update it.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The setting** — present · "This computer" group above Telegram; off until on; Allow prompt; stored per browser; test send once on; open-tab line in the instance's name
- **When the browser says no** — present · switch off and disabled, plain blocked line with how to undo it and the work-computer note
- **What arrives** — present · agent's name, same preview text as Telegram, normal OS behaviour, click opens the conversation
- **How it gets there** — present · same live connection, same moment as the envelope mark, same text as Telegram (its own message type beside the envelope one)
- **One notification, however many tabs** — present · one tab holds the job; same label folds repeats as a fallback
- **Quiet when it's already in front of you** — present · a focused tab on that conversation skips and tells the others
- **Desktop only** — present · hidden on touch devices and where unsupported
- **Telegram's wording** — present · button and every bot reply use the instance's own name
- **No product name in user-facing text** — present
- **Philosophy** — present · adds a route; when agents notify is unchanged
- **Prior context** — present · no revived push; envelope and Telegram unchanged
- **Scope In: What's-new note** — deferred · text proposed to the user; awaiting approval before commit
- **Scope In: id-skill mention** — present
- **Scope Out items** — present
- **Deferred to the bell shape** — present (correctly absent)
- **What would make it wrong: two tabs both show it** — present (guarded)
- **What would make it wrong: reads as on while blocked / on a phone** — present (guarded)
- **What would make it wrong: says less than Telegram** — present (guarded)
- **What would make it wrong: click opens the app but not the conversation** — present (guarded)
- **What would make it wrong: fires for the conversation being looked at** — present (guarded)
- **What would make it wrong: on in one browser shows in another** — present (guarded)
- **What would make it wrong: "Skynet" in user-facing text** — present (guarded)

### Additions (in the result, not in the shape)

- Notifications' top line reworded (now "Where notifications from agents reach you outside the app.") — endorsed-as-drift
- "This computer" / "Telegram" group headings and a one-line description under the switch — endorsed-as-drift
- Feedback line after the test button — endorsed-as-drift
- Browser notifications show the full message even when Telegram is set to "only show who messaged" — endorsed-as-drift (user: "Full message"; that switch stays Telegram-only)

### Follow-ups

- Add the What's-new note once the user approves its text — deferred

### Notes

The words travel as their own live message beside the envelope one, not as extra fields on it; same moment, same text, so the user-facing intent holds.
