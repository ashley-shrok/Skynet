# Campaign: proper RDP / desktop support on mobile

**Opened:** 2026-10-28
**Status:** in_progress
**Workspace:** ~/fleet/identities/vesper-box-maintainer-6/workspace/skynet/.planning/

## Concept

Remote desktops in Skynet should be usable from a phone or tablet, not just watchable. That covers both kinds: sessions to Ashley's own machines (RDP, VNC, telnet) and an agent's own virtual desktop when she takes control of it. Today touches are thrown away, so nothing reaches the desktop, and there's no way to type. After this campaign, touch drives the mouse in one of two modes she can switch between. Trackpad mode (slide a cursor, tap to click) is the default on phones, and direct mode (tap where you want to click) is the default on tablets. She can pinch to zoom and pan around a desktop too big for the screen, and she can bring up the phone's keyboard and type into it. Agent desktops get the same key strip her machines already have, and they open full screen on a phone the way RDP sessions do. Tablets with a real mouse and keyboard keep working as they do now. Once all that works, the key strip itself gets a touch-first redesign.

## Success criteria

- On a phone, after taking control of an agent's desktop, she can click, right-click, drag and scroll by touch, and the agent's desktop responds.
- The same holds for an RDP or VNC session to one of her machines.
- She can switch between trackpad and direct touch modes. Phones start in trackpad mode and tablets in direct mode.
- She can pinch to zoom in on a desktop and pan around it while zoomed, without the page itself scrolling or zooming underneath.
- She can bring up the phone's keyboard and what she types arrives on the remote desktop (agent desktops, RDP/VNC, and telnet).
- Agent desktops have the key strip (modifiers, Esc/Tab, arrows, F-keys) that RDP sessions have.
- On a phone, an agent's desktop can be opened full screen, not only inside the agent window's Desktop tab.
- With a mouse and keyboard (desktop browser, or a tablet with a mouse), everything behaves as it does today.
- The key strip has a touch-first version that's comfortable to use with fingers on a phone.

## Shapes

- **[declared] shape-touch-input** — touch becomes mouse input (trackpad and direct modes plus a switch), pinch-zoom and pan, a keyboard button that raises the phone's keyboard, and the existing key strip on agent desktops. Covers agent desktops and RDP/VNC/telnet alike. — closed (2026-10-29, shape-touch-input.closed.md)
- **[declared] shape-phone-fullscreen-desktop** — an agent's desktop opens full screen on a phone, like RDP sessions do, with the controls it needs. — closed (2026-10-29, shape-phone-fullscreen-desktop.closed.md)
- **[declared] shape-touch-key-strip** — a touch-first redesign of the shared key strip (terminal, RDP/VNC, agent desktops). — in_progress

## Other work

- **What's-new note for the whole campaign** — one note covering every shape, shown to Ashley for approval of its exact wording at `/campaign close`, before the deploy. — open

- **Real-phone check at hand-off** — touch input was checked in-process and in emulated Android Chrome and iPhone Safari, not on a real phone. Emulated Safari also disagreed with a real iPhone on one point (the key strip's taps, which work for Ashley on iOS 18). The campaign-close hand-off should ask Ashley to try it on her iPhone. That includes the full-screen agent desktop from shape 2: the green button, back to the conversation, and the phone's own back gesture, including after a reload. — open

## Lingerers (explicitly approved)

## Open questions

- ~~Where the touch-mode switch and keyboard button live in each surface~~ — settled in shape-touch-input: buttons in each surface's bar (remote-desktop bar, desktop bar, Desktop tab toolbar), touch screens only, agent desktops only while in control. shape-phone-fullscreen-desktop reuses them.
