# Shape: make the identity modal's Desktop tab big enough to actually work in, and make taking control not break it

**Opened:** 2026-10-14

## What this is

The Desktop tab in an agent's identity modal shows the agent's own virtual desktop live, and lets Ashley take control of it. Today the picture is too small to be useful, and taking control breaks it: the agent's screen gets shrunk to the size of the little viewing box, so only its upper-left corner is visible and clicks land in the wrong place. This makes the identity modal grow to the large "editor" size whenever the Desktop tab is the active tab (the same way the Preferences modal grows for About you), lets the desktop picture fill that space, and makes sure the agent's screen size is never changed by the viewer — the picture only ever scales to fit.

## Shape

- **The modal grows for the Desktop tab.** Selecting the Desktop tab switches the identity modal to the large editor size (roughly 1200 wide, 85% of the screen tall). Leaving it for any other tab returns the modal to its normal size. Every other tab looks and behaves exactly as before.
- **The picture fills the space.** Inside the grown modal, the desktop picture takes all the room below the tab's small toolbar, scaled to fit while keeping the desktop's proportions — up or down. At typical screen sizes this is close to the desktop's real size.
- **The agent's screen size is fixed.** The viewer never asks the agent's desktop to change size — not while watching, not while in control, not when the modal grows or shrinks, not when the browser window resizes. Only the on-screen scaling changes. Because the scaling is the only thing that moves, the pointer and clicks always map to exactly where the cursor is shown.
- **The live view survives the size change.** The modal growing or shrinking does not reconnect or restart the live view.
- **Leaving the tab while in control hands back.** Switching to another tab while you have control hands control back to the agent (as today), and now says so with a brief "Handed back to agent" notice rather than silently.
- **Agent-facing docs.** The id skill's description of the identity modal is brought up to date: it lists the Git and Desktop tabs, and describes the Desktop tab's behavior (watching, take control, the modal growing).

## Philosophy

The agent's desktop belongs to the agent. The viewer is a window onto it, never a thing that reshapes it — whatever Ashley's window or modal does, the agent's apps stay laid out the way the agent left them. The fix is to give the picture room and scale it, not to resize the remote screen to fit the viewer. Keep the change contained: no new windows, no new modes, no full-screen button — just the existing modal giving the desktop the room it needs, using a pattern Skynet already has.

## Prior context

- The Desktop tab exists and works for watching; it only appears while the agent's desktop is running.
- Take control works as a mechanism (the agent's own desktop tools pause, Esc stops closing the modal while in control), but the moment control is taken the agent's 1280×800 screen gets resized to the small box's size, leaving windows laid out for the old size — you see only the upper-left, and clicks are offset. The read-only watching connection was masking this; the interactive one passes the resize through, and the desktop server accepts resize requests.
- The Preferences modal already switches to the large editor size for About you and back for other sections — the pattern to reuse.
- On a phone, every modal already fills the screen, so the growth is a no-op there.

## What would make it wrong

- The agent's screen changes size for any reason — watching, taking control, the modal growing or shrinking, the browser window resizing.
- A click lands anywhere other than where the cursor is shown.
- Opening the Desktop tab or switching tabs makes the live view reconnect or flicker more than once.
- Any other tab of the identity modal changes size or behavior.

## Scope edges

- **In:** modal grows for the Desktop tab; picture fills and scales (up or down) to fit; viewer never resizes the agent's screen; live view stable across the size change; "Handed back to agent" notice when leaving the tab mid-control; id-skill update for the identity modal's tabs.
- **Out:** a full-screen button (maybe later, if the grown modal still feels cramped); showing the tab when the desktop is off / a reachable "Start desktop"; touch control on phones; clipboard / copy-paste (that's shape 2 of this campaign); showing what the agent is doing beyond the picture; visual polish of the toolbar and empty states.
- **Deferred:** Ashley plans more desktop options and streamlining later — this is the "for right now" step.

## Handoff notes

Done in the camelot-box-maintainer-3 session on the Skynet repo. Three focused pieces — the viewer gets a "never resize the remote screen" mode; the identity modal picks its size from the active tab; the Desktop tab's layout lets the picture fill the space — plus the hand-back notice, tests alongside each, and the id-skill edit in the substrate source. Scoped tests during dev; commit, then stop for push/deploy greenlight per the role's deploy boundary.
