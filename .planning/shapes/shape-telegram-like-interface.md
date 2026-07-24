# Shape: telegram-like-interface

**Opened:** 2026-07-21
**Vehicle:** GSD phase(s)

## What this is

Skynet reshaped around a conversation-list interface — the same interaction shape Telegram uses for chats. On mobile, a list of active conversations; tap one to view it, back button in the top-left to return to the list. On desktop, the list lives in a collapsible sidebar always visible on the left, and whichever conversation you click on fills the rest of the view. A conversation IS what Skynet already puts inside a tab today (pretty view for identity sessions, terminal view for plain SSH sessions, remote desktop for RDP hosts) — only the tab-strip metaphor around it is removed. The point is to admit that Ashley uses Skynet like a client for talking with agents, not like a tab manager, and to let the interface reflect that.

## Shape

- **The list.** A single flat scrollable list of every currently-active session. Rows are grouped visually by host with separators, mirroring how the current sidebar already presents them. Pinned conversations float to the top, above the grouped hosts. Below the pins, order follows Skynet's existing host-tree order — no new sort rule, no recency-shuffle. Sessions that end vanish from the list; the list only ever shows what's live right now.
- **The view.** Whichever conversation is currently selected takes the main real estate. Only one conversation is visible at a time. The internal experience of a conversation is unchanged — identity sessions still open into the pretty view, plain-SSH sessions still open into a terminal, RDP hosts still open into a remote desktop.
- **Session persistence.** Clicking a conversation for the first time in a page-load opens its underlying connection and mounts its view. Clicking a different conversation hides the previous one but does not tear it down; the connection stays alive and its state is preserved. Clicking back returns to the previous conversation instantly, with no reconnect. A full browser refresh resets everything from scratch — persistence is in-memory only, not stored.
- **Mobile.** The list and the view are two distinct screens. From the list, tapping a row navigates into that conversation. A back button in the top-left returns to the list. The bottom-of-screen navigation bar that mobile currently shows is gone entirely.
- **Desktop.** The sidebar holding the list is collapsible, exactly as it is today: a thin clickable strip when collapsed, expanding to show the list when clicked. Ashley collapses it often to maximize reading room. The expanded/collapsed state is a persisted preference, not a per-session toggle.
- **Pins.** Pinning is per-session, not per-host. Pinned sessions sit at the top of the list, above the host-grouped rows.
- **New session.** A visible button lives on the list view (on both desktop and mobile). Pressing it brings up a host picker; Ashley picks a host, names the session, and the new session opens. The exact shape of the picker (modal, slide-in, popover) and whether the name is mandatory up-front or auto-filled from the existing tab-title mechanism is a planning-phase detail, not a shape-file decision.
- **Settings and admin destinations.** The entries currently sitting in the mobile bottom navigation (host manager, credentials editor, and adjacent admin surfaces) do not disappear from the product, but they retreat to an unobtrusive place. On desktop, a small gear or settings icon in the sidebar header. On mobile, a settings row somewhere in the list view that doesn't compete with the pinned or active rows for attention. Ashley never uses these, so the constraint is: don't let them occupy real estate she actually cares about.

## Philosophy

The shape is admitting a reality that already exists. Ashley converses with a small stable set of identities across many machines; the product she reaches for on her phone and desktop when doing this is Telegram; Skynet has been drifting toward that same shape for months already (pretty view, expanding sidebar, mobile-only bottom-nav gate). This work names that drift and completes it.

The stance is minimal-additive, aggressive-subtractive. The internals of each conversation type are unchanged. The sidebar's fixed host grouping is unchanged. The desktop collapse behavior is unchanged. What we're removing is more than what we're adding — the tab strip goes, the mobile bottom-nav destinations shift somewhere quiet, and "opening a tab" is replaced by "selecting a conversation."

Deliberately not doing: no unread badges, no notification dots, no activity signals, no cross-conversation search, no persisted history of ended sessions, no folder hierarchy, no drag-to-reorder, no scrollback for sessions that have ended. Every one of these is a Telegram feature; every one of them is deferred (v2 or never) because Ashley has said she doesn't need them in the version that ships.

What would violate the spirit even if it passed a spec: adding any always-visible chrome (badges, indicators, navigation destinations) that competes for attention with the conversations themselves.

## Prior context

Skynet today is a tab-manager on top of a host tree. The sidebar shows a hierarchy of hosts and their existing sessions; clicking a session opens a new tab in the main area; multiple tabs can be open simultaneously; a tab strip along the top lets Ashley switch between them. Each tab hosts either a pretty view (for identity-attached claude sessions), a terminal (for plain SSH), or a remote-desktop canvas (for RDP).

Over the last several months, the product has been evolving in a Telegram-ward direction without anyone naming it as such. The pretty view was introduced and refined until Ashley stopped using the raw terminal view entirely for identity sessions. The sidebar became collapsible with a thin-strip idle state. The mobile bottom navigation bar was constrained to appear only on mobile, since desktop already had a better nav surface.

The current sidebar already groups sessions by host with visual separators, which is exactly the grouping shape this work wants — no restructuring is needed for the tree itself. The tab strip is the one piece that this work removes outright.

## What would make it wrong

- **Session-teardown on switch.** If switching from conversation A to conversation B disconnects A's underlying connection (drops the terminal, kills the live channel, unmounts the pretty view's state), the whole premise fails. Every switch incurs a reconnect delay, and Ashley experiences it as worse than the current tab model.
- **Attention-grabbing chrome.** If the interface starts showing badges, dots, red numbers, motion, or any always-visible signal beyond what Ashley has explicitly asked for, it has become a notification app instead of a conversation-list, and the spirit is broken.
- **An admin destination competing for prime real estate.** If the settings, host-manager, or credentials-editor surfaces end up pinned to the top of the list or occupy a persistent nav bar Ashley has to see, the wrong metaphor has won.
- **A version that keeps the tab strip alongside the new list.** If we ship the new list layout but leave the tab strip behind "for backward compatibility" or "because someone might want it," we haven't reshaped the product; we've bolted a new mode onto the old one. This is a full replacement, not an alternate mode.
- **A mobile experience that keeps the bottom navigation bar.** Same failure as above, applied to mobile.
- **A new-session flow hidden behind a hard-to-find gesture.** The button to start a new session must be visible on the list view, on both mobile and desktop — not tucked into a settings menu or discovered only through a keyboard shortcut.

## Scope edges

**In:**
- Removing the tab strip from the main area.
- Reshaping the sidebar into a single-select conversation list where selection determines the view.
- Preserving session state (live connection, pretty-view state, terminal buffer) when switching to another conversation and back within one page-load.
- Adding a per-session pin capability, with pinned sessions floating above the host-grouped rows.
- Adding a visible new-session button on the list view that opens a host picker.
- Mobile: list-vs-view navigation with a top-left back button when inside a conversation.
- Mobile: deletion of the bottom navigation bar as a surface.
- Moving the admin/settings destinations to an unobtrusive gear (desktop) or list row (mobile).

**Out (no v2 promise either):**
- Cross-conversation search.
- Reordering pins by drag.
- A folder or nested-grouping concept above the current host separators.

**Deferred to a later version (v2, worth having eventually):**
- Any per-conversation activity/unread signal, in any form — dots, badges, counts, motion, sound.

**Tempting but not in scope:**
- Persisting the current-selected conversation across browser refreshes.
- Auto-restoring the "last set of open conversations" on a fresh page load.
- Adding a per-session view toggle that flips pretty view to raw terminal for debugging (Ashley already has a desktop keyboard shortcut for this; mobile explicitly doesn't need it).
- Scrollback or history for sessions that have already ended.

## Vehicle notes

Vehicle is a GSD phase (or a small sequence of phases) inside the Skynet fork. The scope crosses too many surfaces to make sense as a single quick task or a sequence of quick tasks; the risk of shipping a partial state — new list layout without the tab-strip removal, or vice versa — is real and unacceptable. The full phase pipeline gives us spec / plan / execute / verify with the deadman rollback and pinning discipline that fork work already runs behind.

Phase decomposition — a starting sketch, not binding on planning:

1. **Sidebar reshape into conversation list.** The list layout, pins, single-select semantics, new-session button. Deploy-worthy on its own — Ashley can validate the list feel before we touch tab plumbing.
2. **Tab-strip removal and session-persistence contract.** The load-bearing engineering: sessions must stay mounted-but-hidden across switches. This is the plan where the whole shape either works or doesn't. Deploy-worthy after Ashley confirms switching feels right.
3. **Mobile flow.** List/view split, back button, bottom-navigation deletion.
4. **Settings surface migration.** The gear icon and its destinations, replacing the mobile bottom navigation's targets.

Planning may re-shape this decomposition. The important constraint from the shape: no phase ships a partial state where the tab strip and the new list coexist as parallel modes.

Bounty coupling: the bounty `telegram-like-interface` already exists under Tina's identity as the tracking artifact for this work. It moves from `on_deck` to `in_progress` when the first phase begins execution, and closes when the last phase pins and Ashley signs off on UAT.
