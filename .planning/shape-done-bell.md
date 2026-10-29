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
