# Shape: touch input for remote desktops

**Opened:** 2026-10-29
**Campaign:** mobile-remote-desktop (shape 1 of 3)

## What this is

On a phone or tablet, a remote desktop can be driven by touch. This covers the user's own machines (RDP, VNC, telnet) and an agent's desktop once she has taken control of it. Today touches are thrown away and there's no way to type. After this shape, touch drives the remote mouse in one of two modes she can switch between, she can pinch to zoom and move around a zoomed-in desktop, she can bring up the phone's keyboard and type into the desktop, and agent desktops get the same key strip her machines already have.

## Shape

**Two touch modes, one switch.**
- *Trackpad mode* (phone default):
  - one finger slides the remote cursor;
  - tap is a left click, two-finger tap a right click;
  - double-tap-and-hold then drag is a drag;
  - two fingers sliding scrolls.
- *Direct mode* (tablet default):
  - tap clicks where the finger is;
  - press and hold is a right click;
  - a one-finger drag is a drag;
  - two fingers sliding scrolls.
- A mode switch flips between them. The choice is remembered on that device and applies to every remote desktop.

**Zoom and moving the view.**
- Pinch zooms in and out, in either mode.
- Zooming out stops when the whole desktop fits; zooming in stops at four times that.
- Zoom holds for the session, through reconnects. Opening the desktop fresh starts fitted.
- Moving around a zoomed-in desktop:
  - in trackpad mode, pushing the cursor toward an edge carries the view along, and two fingers always scroll;
  - in direct mode, two fingers move the view while zoomed in and scroll when not zoomed.
- While touching the desktop, the page underneath never scrolls or zooms, and the swipe back to the list never starts.

**Keyboard.**
- A keyboard button raises the phone's keyboard, and what's typed arrives on the remote.
- The key strip's modifiers (Ctrl, Alt, Shift, Win) combine with phone typing, so Ctrl then "c" sends a copy.
- While the keyboard is up, the desktop shrinks to fit the space above it. When zoomed in, the view follows the mouse pointer. The remote's text cursor can't be seen from Skynet, so the pointer is the stand-in.

**Where the controls sit.**
- The mode switch and keyboard button are buttons in the bar at the top of each surface:
  - the remote-desktop bar, for the user's machines;
  - the desktop bar and the Desktop tab's toolbar, for agent desktops.
- They show only on touch screens, and on agent desktops only while she has control.

**Key strip on agent desktops.** While she has control of an agent's desktop on a touch screen, the existing key strip (the same one her machines and terminals use, unchanged) is there.

**Her machines' screen size on a phone.**
- An RDP or VNC session from a phone gets a laptop-sized remote screen, about 1280 across and shaped like the phone held sideways, instead of a phone-sized one.
- Rotating the phone refits the picture and never resizes the remote.
- Agent desktops keep the fixed size they already have.

**Telnet.** Being text only, telnet gets just the keyboard button and finger scrolling: no mode switch, no zoom.

## Philosophy

- A touch should never do something she didn't mean. When a gesture is ambiguous, nothing happens: a pinch never turns into a click or a drag partway through. Safety over cleverness.
- Mouse and keyboard stay exactly as they are. A desktop browser, or a tablet with a real mouse and keyboard, behaves as it does today; touch support is added beside it, not in place of it.
- Agent desktops stay view-only until control is taken. Touch doesn't change who is allowed to drive.
- The key strip is reused as-is. Its redesign is a later shape.

## Prior context

- Today, touching any remote desktop does nothing at all: the input layer deliberately ignores touch-made mouse events, and nothing else listens for touches.
- There is no way to raise the phone's keyboard for a remote desktop.
- On a touch screen, her machines' sessions open full screen with the remote-desktop bar and a floating key strip. Agent desktops are watched in the agent window's Desktop tab or a desktop pane (desktop only). Taking control there already pauses the agent and hands back when she leaves.
- Her machines' sessions currently resize the remote to whatever is showing them. Agent desktops never resize; they're shrunk to fit.

## What would make it wrong

- A pinch, scroll or two-finger gesture that also clicks or drags something on the remote.
- A tap that lands somewhere other than where the finger (direct) or cursor (trackpad) was.
- The page or the app's own swipe-back moving while she's working the desktop.
- Typing on the phone keyboard that drops characters, doubles them, or ignores the strip's held modifiers.
- Anything changing for mouse-and-keyboard users.
- An agent's desktop accepting touch input while she hasn't taken control.
- Her machine's Windows desktop shuffling its windows every time she rotates the phone.

## Scope edges

- **In:**
  - both touch modes and the switch;
  - pinch zoom and moving the view;
  - the keyboard button with the modifiers;
  - shrinking the desktop above the keyboard;
  - the controls in each surface's bar;
  - the key strip on agent desktops;
  - the laptop-sized remote screen for her machines on a phone;
  - telnet's reduced set.
- **Out, in later shapes of this campaign:**
  - opening an agent's desktop full screen on a phone (shape 2, which reuses these controls);
  - the touch-first key-strip redesign (shape 3).
- **Out:** sending real multi-touch to the remote (Windows touch gestures). The remote only ever sees a mouse and a keyboard.
- **Tempting but no:** a custom on-screen keyboard. The phone's own keyboard plus the existing strip is the agreement.

## Handoff notes

- Work in the user's Skynet repo on the shared branch; in a campaign, a shape ends at committed, not pushed, not deployed.
- User-visible change, so the id skill's description of the remote-desktop bar, desktop bar and Desktop tab needs a brief mention, and a what's-new note needs the user's approval of its exact wording.
- Log mode switches, keyboard raise/lower and zoom changes per the role's logging directive.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit (all agreed features present; three additions endorsed by the user as drift)

### Shape features (conformance)

- **What this is** — present · touch drives the remote mouse in two switchable modes, pinch zoom, phone keyboard, key strip on agent desktops
- **Trackpad mode** — present · slide, tap, two-finger tap, double-tap-hold drag, two-finger scroll; phone default
- **Direct mode** — present · tap under finger, hold for right click, one-finger drag, two-finger scroll; tablet default
- **Mode switch remembered per device, applies everywhere** — present
- **Pinch zoom in either mode, fitted to 4×** — present · not in telnet
- **Zoom holds through reconnects, fresh open starts fitted** — present
- **Moving the zoomed view** — present · trackpad edge-follow, two fingers always scroll; direct two fingers pan when zoomed
- **Page never scrolls/zooms, swipe-back never starts** — present
- **Keyboard button raises phone keyboard, typing arrives** — present
- **Strip modifiers combine with phone typing** — present
- **Desktop shrinks above keyboard; zoomed view follows pointer** — present
- **Controls in each surface's bar** — present
- **Touch screens only; agent desktops only while in control** — present
- **Key strip on agent desktops, unchanged** — present
- **Laptop-sized remote screen on a phone; rotation never resizes** — present
- **Agent desktops keep fixed size** — present
- **Telnet reduced set** — present
- **Philosophy: ambiguous gesture does nothing** — present
- **Philosophy: mouse and keyboard unchanged** — present
- **Philosophy: agent desktops view-only until control** — present
- **Philosophy: key strip reused as-is** — present
- **What would make it wrong: gesture also clicks or drags** — present (guarded)
- **What would make it wrong: tap lands off target** — present (guarded)
- **What would make it wrong: page or swipe-back moving** — present (guarded)
- **What would make it wrong: phone typing drops/doubles or ignores modifiers** — present (guarded)
- **What would make it wrong: anything changing for mouse users** — present (guarded)
- **What would make it wrong: agent desktop accepting touch without control** — present (guarded)
- **What would make it wrong: Windows reshuffling on rotation** — present (guarded)
- **Scope edges: out items** — present · none of them appear
- **Handoff: id skill mention** — present
- **Handoff: logging** — present
- **Handoff: what's-new note** — deferred · one note for the whole campaign, approved at campaign close (campaign Other work)
- **Handoff: ends at committed** — committed after code review

### Additions (in the result, not in the shape)

- During a pinch, finger drift moves the view too (all modes) — endorsed-as-drift
- Touching the desktop gives a tablet's hardware keyboard to it — endorsed-as-drift
- Hardware shortcuts with the phone keyboard up go to the remote, Command as Ctrl — endorsed-as-drift

### Follow-ups

- What's-new note with the user's approved wording — deferred (campaign close)

### Notes

No omissions. Additions were confirmed with the user on 2026-10-29 ("Keep it" ×3).
