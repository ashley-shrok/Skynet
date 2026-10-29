# Campaign: notify or call when done

**Opened:** 2026-10-29
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/sulfur-box-maintainer-4/workspace/skynet/.planning/

## Concept

People end up sitting and watching the spinner because they forget, or never knew, that an agent can reach them when it's done. While an agent is working, the composer's main button becomes a **bell** offering to notify you or call you. Tapping it hands the agent the request right away, while it's still working, and the bell stays lit as a visible promise you can cancel. When the work finishes or gets stuck needing you, the agent reaches you the way you chose and says what happened. Separately, notifications can now arrive as **browser notifications** while any Skynet tab is open, so people without Telegram or a phone setup get them too.

## Success criteria

- Someone who has never heard of the feature finds it just by waiting on an agent that's working.
- After tapping the bell, they can walk away and trust they'll be reached, whether the agent finished or got stuck.
- What reaches them says what happened, not only "done".
- A desktop user with Skynet open in a background tab gets a system notification, with no Telegram.
- The work line under the last message gets no busier.

## Decisions from concept-open

- The **agent** decides when the work is done (or blocked) and does the reaching; the app never fires on its own.
- Blocked or needing a decision counts, as well as finished.
- The bell offers two plain choices, notify me or call me. No escalation ladder.
- The bell appears **as soon as the agent is working** (v1). No delay.
- **No safety-net reminder:** if the agent stops with a promise still open, the app does not nudge it.
- Browser notifications are **Level 1 only**: the browser's Notifications API, drawn by the operating system, fired by an open Skynet tab (it can be in the background) from the live connection it already holds. No Push API, no service-worker push, nothing that works with every tab closed.
- Tie-in: tapping **Notify me** when the user has no way of being reached outside the app (no Telegram, no browser permission) brings up the browser's Allow prompt right then.

## Shapes

- **[declared] shape-browser-notifications** — Level 1 browser notifications, turned on in Preferences → Notifications next to Telegram, firing for every notification (not only bell ones) — closed (shape-browser-notifications.closed.md; commits 24a3f2c5, 19911b32, 19db2c55)
- **[declared] shape-done-bell** — the bell on the main button while the agent works, the notify/call choice, the lit promise and cancel, delivering the request to the agent mid-work, the agent following through (finished or blocked, saying what happened), the Allow-prompt tie-in, and the matching id skill text — in_progress

## Other work

- Ask about notifications at sign-in (an in-app "Turn on / Not now" that leads to the browser's prompt) — dropped for now; Ashley: "maybe we add that later"
- What's-new note for browser notifications — dropped; Ashley: "no note"
- Audit what Skynet puts on hosts about the user (e.g. their relay ID) and what's missing — handed to a separate agent, myth-box-maintainer-2 (Ashley: "we should spawn a new agent to audit the standard info that's provided to the hosts"); reports to Ashley directly, outside this campaign
- Browser notifications always show the full message, even when Telegram is set to "only show who messaged" — done (Ashley: "Full message")

## Lingerers (explicitly approved)

## Open questions

- **Call with no phone number on file:** hide the call choice, or show it with a pointer to Preferences (better for discovery)? Raised, not answered. Settle in shape-done-bell.
- **Several open tabs:** only one of them may show a given browser notification. — Answered: one chosen tab per browser shows it; a standby tab steps in if the chosen one never got it.
- **Looking at it already:** should a browser notification be skipped when the user is actively viewing that conversation? — Answered: skipped only when a focused window has that conversation on screen.
- **Mid-work delivery rail:** today a message sent mid-turn reaches the agent only when its turn ends. The bell's request has to arrive between the agent's steps, the way file-change notices already do. Confirm the mechanism in shape-done-bell.
- **Thumbs-up mid-turn:** with the bell appearing right away, the main button's mid-turn thumbs-up goes away. Confirm nothing relies on it.
- **Company machines:** IT policy can block notification permission outright. Settings should say so plainly rather than looking broken. — Answered: the setting says the browser is blocking it, how to undo it, and that a company may have turned it off.
