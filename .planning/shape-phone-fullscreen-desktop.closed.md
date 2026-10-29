# Shape: an agent's desktop opens full screen on a phone, like RDP sessions do

**Opened:** 2026-10-29
**Campaign:** mobile-remote-desktop (shape 2 of 3)

## What this is

On a phone, an agent's virtual desktop gets the whole screen, the way a session to one of Ashley's own machines already does. A slim bar sits on top with the controls it needs, and the desktop fills the rest. Today the only way to see it on a phone is the agent window's Desktop tab. There the desktop sits under the window's header, tabs and toolbar and gets a small part of the screen.

## Shape

- **Getting there.**
  - On a phone, the green monitor button beside the task pill opens the agent's desktop full screen directly, skipping the agent window.
  - The agent window's Desktop tab keeps its small live view. On a phone, its toolbar also has an **Open full screen** button, where computers have "Open beside conversation".
- **What's on screen.**
  - The slim bar is the same one the desktop gets beside a conversation on a computer.
    - Left: back, reconnect, then Take control, or Hand back to agent while in control. While in control, the touch-mode switch and the keyboard button follow.
    - Title: the agent's name. Under it: view only, under your control, or paused because someone else has control.
  - The desktop fills the rest of the screen. While you're in control, the key strip sits at the bottom, as shape 1 built.
- **How it starts.**
  - It opens view-only, as the desktop does everywhere else.
  - One exception: if you were already in control in the Desktop tab and tap Open full screen, you stay in control in the full-screen view. The agent may get control back for a moment during the switch, but you don't see it.
- **Turning the phone.**
  - The picture refits to the new screen shape, so holding the phone sideways gives a bigger desktop.
  - It stays full screen sideways: "phone" means a small screen, judged by its short side, not by its current width.
- **Leaving.**
  - Back returns to the conversation it was opened from, not to the conversation list. That's back in the bar, or the phone's own back gesture.
  - Leaving hands control back to the agent, the same as closing the desktop on a computer.
  - No swipe right to leave. A swipe on the desktop picture is input to the desktop. The bar doesn't take the app's swipe either: elsewhere that swipe slides the conversation list in, which would show the wrong place. (Changed during the build, with Ashley's agreement on 2026-10-29. The shape first had a swipe on the bar going back.)
- **When things go wrong.** If the desktop stops or the connection drops, the full-screen view behaves as the desktop does elsewhere: the "isn't running" notice with its Start button, or reconnect.

## Philosophy

- One full-screen remote view on phones, not a new kind of screen. The agent's desktop reuses what a session to Ashley's machines already does, and the bar the desktop already has beside a conversation on a computer.
- Opening the desktop is watching, not driving. Nothing about opening it pauses the agent, apart from carrying control over that you already held.
- A desktop opened from a conversation belongs to that conversation, so back returns there. Sessions to Ashley's machines go back to the conversation list. The two back buttons differ on purpose.
- Phones only. Tablets keep the agent window and Open beside conversation.

## Prior context

- Shape 1 (touch input) made the desktop usable by touch on every surface: two touch modes, pinch-zoom and pan, the phone's keyboard, and the key strip on agent desktops while in control. Its bar buttons appear on touch screens only, and on agent desktops only while in control. This shape reuses them.
- On a computer, the agent's desktop can already sit in its own pane beside the conversation, with that slim bar. Panes beside a conversation don't exist on a phone, which is why the agent window was the only route there.
- Sessions to Ashley's machines on a phone open full screen with the same kind of bar and its back-to-conversations button.

## What would make it wrong

- Opening the desktop on a phone pauses the agent without Ashley asking for it.
- Back from the full-screen desktop strands her on the conversation list when she came from a conversation.
- Leaving the full-screen desktop leaves the agent paused, because control wasn't handed back.
- Turning the phone sideways drops the full-screen view or swaps to a different layout.
- Swiping on the desktop picture throws her out of it instead of reaching the desktop.
- The desktop on a computer or tablet behaves any differently from today.
- Carrying control over to full screen fails silently, landing her view-only while she thinks she's driving. Or it leaves two holds on control so the agent stays paused after she hands back.

## Scope edges

- **In:**
  - the green button going full screen on a phone
  - Open full screen in the Desktop tab on a phone
  - the full-screen view with its bar
  - control carry-over
  - back (bar button and phone back gesture) to the conversation it came from
  - refit on rotation
- **Out:** tablets; split view; any change to sessions to Ashley's own machines, including their back going to the list.
- **Deferred:** the touch-first key strip redesign is shape 3.
- **Tempting but no:** taking control automatically on open; a new full-screen design separate from the existing bar; hiding the bar for an immersive view.

## Handoff notes

- Built by vesper-box-maintainer-6 inside the mobile-remote-desktop campaign. The shape ends committed, not pushed, not deployed.
- The id skill needs a brief mention: on a phone, the green button and the Desktop tab's Open full screen open the desktop full screen. The "Desktop only — there's no way to open one on a phone" lines for the desktop bar change accordingly.
- The phone test for "full screen" is the same small-screen rule shape 1 used for the default touch mode: short side under 600 pixels.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · On a phone the agent's desktop opens on its own screen with the existing slim bar. The Desktop tab is no longer the only way in.
- **Shape: Getting there (green button)** — present · On a phone the green monitor button opens the desktop full screen directly, skipping the agent window. A phone is a screen whose short side is under 600 pixels.
- **Shape: Getting there (Desktop tab Open full screen)** — present · On a phone the tab keeps its live view and shows Open full screen in place of Open beside conversation. Computers are unchanged.
- **Shape: What's on screen** — present · It's the existing desktop pane and bar: back, reconnect, take control or hand back, and the touch buttons and key strip while in control. On a phone, back reads "Back to conversation".
- **Shape: How it starts** — present · It opens view-only. If you held control in the tab, it's passed on rather than released, and full screen picks it up on connect.
- **Shape: Turning the phone** — present · The phone check uses the short side, so the phone stays full screen sideways. The picture scales to fill its box.
- **Shape: Leaving** — present · Opening adds a history step. The bar's back and the phone's back gesture both return to the agent's conversation, or to the list if it isn't open. The unreachable desktop is then closed, which hands control back. Swipe-to-list is off over it.
- **Shape: When things go wrong** — present · It reuses the pane's existing "isn't running" notice with Start, and reconnect.
- **Philosophy** — present · It reuses the existing pane and bar. Opening is view-only. The two back buttons differ on purpose. Phones only.
- **Prior context** — present · Shape 1's touch buttons and key strip are reused unchanged, and so is the short-side phone rule.
- **What would make it wrong: Opening pauses the agent unasked** — present · It opens view-only. Control is taken only when it was already held and passed on.
- **What would make it wrong: Back strands her on the list** — present · Back selects the agent's conversation, and goes to the list only when that conversation isn't open.
- **What would make it wrong: Leaving leaves the agent paused** — present · The unreachable desktop is closed, and closing hands control back.
- **What would make it wrong: Sideways drops the view or swaps layout** — present · Every phone check uses the short side.
- **What would make it wrong: Swiping on the picture throws her out** — present · Swipe-to-list is off over the full-screen desktop.
- **What would make it wrong: Computer or tablet behaves differently** — present · The reviewer found swipe-to-list turned off for a lone desktop on tablets too. It's now limited to phones, so tablets are unchanged.
- **What would make it wrong: Carry-over fails silently or leaves two holds** — present · A failed carry-over hands control back, says so, and reconnects view-only. An unclaimed carry-over is released after 10 seconds. Claiming it cancels that, so only one hold remains.
- **Scope edges** — present · Everything In is present. Out is untouched. No tempting-but-no item appears.
- **Handoff notes** — present · The agent-facing app description is updated.

### Additions (in the result, not in the shape)

- Swipe-to-list was off for a lone desktop on tablets too. Not intended; it's now limited to phones.
- The phone check treats a screen whose size can't be read as "not a phone". This guards against the test environment's zero-size screen and has no effect on real devices. Endorsed-as-drift (Ashley: "Keep it").

### Follow-ups

- A comment on the back signal still mentioned the dropped swipe on the bar. Fixed.

### Notes

The swipe on the bar was dropped mid-build with Ashley's agreement. The list sliding in would have shown the wrong place, and the shape text was amended before the close.

### After the code review (2026-10-29)

The fixes keep to the shape. Recorded here because a few of them sharpen behaviour the shape describes:

- Back now returns to the conversation the desktop was actually opened from. If that conversation isn't open, for example after a reload, back opens the agent's conversation again. Only when that can't be done does it go to the list. Leaving always closes the desktop, which hands control back.
- The phone's back gesture still works after a reload. The history entry is tied to the desktop rather than to a tab that a reload replaces, and it's put back if the app steps over it while loading.
- Opening the desktop twice reuses its history entry rather than stacking two.
- On a phone held sideways, the bar's menu (Move to new tab, Close) stays hidden, as it already was in portrait.
- "Phone" now means a touch phone everywhere. A small screen without touch isn't one.
- Carrying control over can no longer be undone by a view-only connection that lands late. If it fails, the release is waited on before reconnecting.
