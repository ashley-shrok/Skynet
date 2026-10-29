# Shape: the done-bell — "notify me / call me when it's done", right on the main button

**Opened:** 2026-10-29

## What this is

While an agent is working, the round main button in the composer becomes a bell. Tapping it offers two choices, Notify me and Call me. Picking one sends the matching skill to the agent, exactly as the Skills menu would, so the agent reaches the person the way they chose once the work is finished or it needs them — saying what happened, not only "done". The point is awareness: people sit watching the spinner because they forget, or never knew, that an agent can reach them. The bell puts that option where their eyes already are.

## Shape

- **The bell.** The main button shows a bell instead of the thumbs-up only while the agent is working and nothing is typed or attached. Typing turns it into Send, as today; an aside still shows Resume. When the agent stops working, the thumbs-up comes back. Relay rooms are untouched.
- **The menu.** Tapping the bell opens a small menu above it, in the Skills menu's look: two rows, **Notify me** and **Call me**, each with the same hint, "When it's done or needs you". Opened by pointer, no row is highlighted until hovered; opened from the keyboard, the first row takes focus. Escape or a click outside closes it.
- **Call me only for people with a phone number.** Only an admin can give someone a number, so without one the Call me row is simply absent.
- **Picking sends the skill.** Notify me sends the notify-me skill; Call me sends the call-me skill — the same send as the Skills menu, showing as the user's own message in the conversation. That message is the record that they asked. Nothing is tracked beyond it: no lit state, no cancel, no reminder. Sent mid-turn, the agent reads it when its turn ends, which is exactly when "finished or needs you" can be judged.
- **The Allow-prompt tie-in.** Picking Notify me brings up the browser's Allow prompt when: the person has no Telegram connected, this browser can show notifications, and it hasn't been asked here yet. Allow turns on "Notifications on this computer" for this browser, as the Preferences switch does; Block turns nothing on. The request is sent either way. Already blocked, or on a phone where it isn't offered: nothing pops up, the request just goes.
- **The two skills, distributed to every machine** with the rest of what Skynet sends, agent-invisible (only a person starts them):
  - **Notify me** — "When you're finished with what you're working on, or you hit something you need me for, notify me. Say what happened — what got done, or what you're stuck on — not just that you're done."
  - **Call me** — "When you're finished with what you're working on, or you hit something you need me for, call me. Say what happened — what got done, or what you're stuck on — not just that you're done. If I don't answer but the call went through, that's enough; don't call again."
  They name no tool; the agent's own guide already says how to notify and how to call.
- **The agent guide** gets a brief mention: the main button's bell while the agent works, and that its two choices arrive as the notify-me / call-me skills.

## Philosophy

- The agent decides when it's done or stuck and does the reaching; the app never fires anything on its own.
- Lean on what exists: the skills, the ordinary send, the existing notify and call paths. No new tracking, no new delivery path into a working agent.
- The work line under the last message gets no busier — the bell takes the thumbs-up's place, it doesn't add a control.
- No product name in anything a user sees; built for any user on any instance, not one person's setup.

## Prior context

- Ashley already had personal call-me and notify-me skills on some of her machines, saying "when you're finished or hit a blocker, reach me". She has since made both instance-wide on her instance.
- Shape 1 of this campaign added notifications on this computer (browser notifications) — the Allow-prompt tie-in turns those on.
- Mid-turn, the main button's thumbs-up sends "thumbs up", read when the turn ends. Nothing else relies on it; it stays as is whenever the agent isn't working.
- Skills Skynet distributes don't appear in the Skills menu or the slash list; typing the full name still runs them. The bell becomes the way in.
- On existing instances agents already know who their user is, so the skills need not carry it. A separate agent (myth) is auditing what Skynet puts on machines about the user.

## What would make it wrong

- The bell appears while the agent is idle, or replaces Send while something is typed.
- The app reaches the person itself (a notification or call not made by the agent), or nags the agent afterwards.
- What reaches the person says only "done" without what happened.
- Call me is offered to someone who has no phone number.
- The Allow prompt appears for someone who already has Telegram, on a phone, or again after they've answered it.
- Choosing Notify me ends up sending nothing because the person blocked the prompt.
- A menu row is lit before the pointer is on it.
- The work line or composer gains an extra control.
- A product name appears in user-facing text.

## Scope edges

- **In:** the bell on the main button while working; the two-choice menu; hiding Call me without a phone number; the Allow-prompt tie-in; the two distributed skills; the agent-guide mention; a What's-new note (text approved by Ashley before it's committed).
- **Out:** any lit or pending state, cancelling, reminders, delivery into the agent mid-step, attaching who the user is to the request.
- **Deferred:** whatever the user-info audit recommends.
- **Tempting but no:** a bell before the agent starts working, escalation (notify, then call), choosing a delay.

## Handoff notes

- Worked by sulfur-box-maintainer-4 inside campaign notify-when-done; ends committed, not pushed, not deployed.
- **Before the campaign's deploy:** delete Ashley's instance-wide call-me and notify-me (Ashley: "before deploying, it makes sense to like delete them"), so the distributed versions take their place.
- Tasting snippet used to settle the look: workspace/uat/bell-tasting.js.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · While the agent works, the main button is a bell offering Notify me / Call me, which send the matching skill the same way the Skills menu does.
- **Shape: The bell** — present · Bell shows only while working with nothing typed or attached; Send when there is a draft, Resume during an aside, thumbs-up when idle; relay rooms untouched.
- **Shape: The menu** — present · Pops up above the button in the Skills menu's look; two rows with the shared hint; pointer vs keyboard focus and closing handled by the menu.
- **Shape: Call me only for people with a phone number** — present · The row only shows when a number is on file; unknown counts as no number.
- **Shape: Picking sends the skill** — present · Sends notify-me or call-me through the same send as the Skills menu; nothing tracked afterwards.
- **Shape: The Allow-prompt tie-in** — present · Asks only when Telegram is unlinked, notifications are supported and off, and the browser hasn't been asked; the send happens either way.
- **Shape: The two skills, distributed, agent-invisible** — present · Agreed text verbatim, distributed, not agent-startable, no tool named.
- **Shape: The agent guide mention** — present · The composer paragraph describes the bell and its two skills.
- **Philosophy** — present · The app never reaches the person itself; reuses existing paths; the bell replaces the thumbs-up; no product name.
- **Prior context** — present · Thumbs-up unchanged when the agent isn't working; skills carry no user identity.
- **Scope edges** — drifted · Everything in scope present except the What's-new note, which Ashley chose not to have ("No note"); nothing from Out or Tempting-but-no built.
- **What would make it wrong: The bell appears while the agent is idle, or replaces Send while something is typed** — present · Guarded.
- **What would make it wrong: The app reaches the person itself, or nags the agent afterwards** — present · Guarded.
- **What would make it wrong: What reaches the person says only "done"** — present · Guarded by the skill text.
- **What would make it wrong: Call me offered without a phone number** — present · Guarded.
- **What would make it wrong: The Allow prompt appears with Telegram, on a phone, or again after answering** — present · Guarded.
- **What would make it wrong: Notify me sends nothing because the prompt was blocked** — present · Guarded.
- **What would make it wrong: A menu row is lit before the pointer is on it** — present · Guarded.
- **What would make it wrong: The work line or composer gains an extra control** — present · Guarded.
- **What would make it wrong: A product name appears in user-facing text** — present · Guarded.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- What's-new note for the bell not written; Ashley chose "No note" — accepted-as-drift
- Before the campaign's deploy, delete Ashley's instance-wide call-me and notify-me so the distributed versions take their place — deferred

### Notes

The commit also adds a planning-file line about the separate user-info audit agent — bookkeeping, not product behaviour. Menu open/close behaviour was judged from the menu component it uses, without running it.
