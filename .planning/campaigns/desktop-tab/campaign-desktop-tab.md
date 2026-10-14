# Campaign: a better desktop tab in the identity modal

**Opened:** 2026-10-09
**Status:** in_progress
**Workspace:** .planning/campaigns/desktop-tab/

## Concept

The Desktop tab in an agent's identity modal is where Ashley watches, and can take over, the agent's own virtual desktop. Today it is too small to see or work in, and taking control breaks it: the agent's screen gets shrunk to the size of the little panel, so only its upper-left corner is visible and clicks land in the wrong place. This makes the desktop usable: the identity modal growing to give the desktop real room, a take-control mode where the agent's screen keeps its size and the pointer lands where you point, and copy-paste that works between Ashley's computer and the agent's desktop while she's in control.

## Success criteria

- Ashley can see the agent's desktop large enough to read and work in, without leaving the identity modal.
- Taking control never changes the agent's screen size; the whole desktop stays visible, scaled to fit.
- In control, the pointer and clicks land exactly where the cursor is shown, at any scale.
- In control, Ashley can copy on her computer and paste on the agent's desktop, and copy on the agent's desktop and paste on her computer.

## Shapes

- **[declared] shape-desktop-tab-usable** — expand-to-full-window view + take control that keeps the screen intact and the pointer accurate — in_progress
- **[discovered] shape-desktop-copy-paste** — copy-paste between Ashley's computer and the agent's desktop while in control, both directions (added by Ashley 2026-10-14) — not started

## Other work

## Lingerers (explicitly approved)

## Open questions

- The viewer already carries some clipboard plumbing (pushes the local clipboard on hover, receives the remote clipboard) — how much of it actually works for the agent's desktop is unknown; shape 2 starts by finding out.
