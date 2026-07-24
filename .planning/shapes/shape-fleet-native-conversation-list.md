# Shape: fleet-native-conversation-list

**Opened:** 2026-07-21
**Vehicle:** GSD phase (Phase 7)

## What this is

The follow-up to Phase 6. Phase 6 reshaped Skynet's top-level navigation into a Telegram-style conversation-list interface, but the list's data source was scoped too narrowly — it mirrored only the browser-tab's currently-open Skynet tabs. On a fresh mobile page-load with no tabs open, that showed empty even when Ashley had running sessions across her fleet. This phase reshapes the list's data source so it mirrors the fleet: every running tmux session on every reachable host appears as a row automatically, whether or not Ashley has opened it as a Skynet tab in this browser. The Telegram-native experience Phase 6 aimed at only really lands with this data-source correction.

## Shape

- **The list is fleet-native, not browser-tab-native.** Rows are sourced from the same fleet-discovery signal the current sidebar host-tree and the double-shift menu already use — every tmux session on every reachable host. Ashley doesn't have to open a tab first to see a session; if it's running on a box, it's a row.

- **Row ordering, same as Phase 6.** Pinned sessions float at the top. Below the pins, identity-tmux sessions grouped by host with visual separators, in the current sidebar's host-tree order (no new sort rule, no recency shuffle). Below the identity sessions, remote-desktop host rows sit at the bottom — one row per RDP-enabled host.

- **Row states are invisible to Ashley.** Under the hood, a row can be "attached" (she has clicked it earlier this page-load, the underlying live connection is open, the pane is warm in memory) or "detached" (the session exists on the box but she hasn't clicked it yet this page-load). Clicking a detached row transparently attaches, mounts, and shows it. Clicking an attached row instantly shows it (same session-persistence contract Phase 6 established). No visual distinction between the two states — Telegram doesn't show which chats have been scrolled into this session, and this list follows the same principle.

- **The one creation button is the pencil.** Phase 6 shipped a "New Session" button; this phase re-styles it as the Telegram-native pencil-analog. Function is the same — pick a host, name the session, opens as an identity tmux row. Placement is planner's discretion (mobile floating action button in the bottom-right vs. top-of-list on desktop is the Telegram-per-viewport default, but consistent-both-viewports is also fine). This is the ONLY creation button, because the only time Ashley starts a new session is when she's starting a new identity; plain SSH one-off shells and RDP sessions don't have a "create" concept — RDP appears as a per-host row, plain SSH isn't in the list at all.

- **Remote-desktop rows are conceptually persistent, technically not.** Each Skynet RDP tab is a fresh remote-desktop session, but Ashley experiences the desktop as continuous because the remote OS state is. So the row exists as long as the host is RDP-enabled, whether or not she has an RDP tab open right now. The row renders with a monitor icon in the avatar slot — no identity hue, no identity name, just the host name + monitor glyph. Clicking behaves like any other row: attach + mount + show. Pin capability on RDP rows is planner's call (Ashley doesn't care either way).

- **No polling, no real-time push.** The list snapshots the fleet on page-load. If Ashley wants the latest state — because she created a session on another device, or a session died on a box she wasn't in — she refreshes the browser. Her own actions in this browser tab (creating a session via the pencil, closing one) update the list live because the tab machinery updates live. Ambient staleness for edge cases is acceptable; the simpler model wins.

- **The mobile gear duplication from Phase 6 gets fixed as part of this phase.** Currently on mobile, both a header gear and a bottom settings row render, both leading to the same menu. Fix: the gear renders on desktop only, the settings row renders on mobile only. No mobile duplication.

- **Everything else from Phase 6 stays verbatim.** Per-session pins, host grouping with separators, mobile list-vs-view two-screen flow with top-left back button, deleted tab strip, deleted mobile bottom navigation bar, sidebar collapse behavior on desktop, session persistence within a page-load. This phase is a data-source reshape and an RDP-row rendering addition, layered on top of Phase 6's chrome.

## Philosophy

Phase 6 named the metaphor (conversation-list); this phase makes the metaphor honest. The Telegram experience Ashley reached for isn't "you see conversations you've opened in this browser tab" — it's "you see the people you talk to, always." Rows are a rendering of the fleet's live tmux-session state, not a rendering of what happened to be open when the page loaded.

The stance stays minimal-additive, aggressive-subtractive. The plain-SSH row category from Phase 6 disappears — Ashley doesn't need them. The New Session button becomes the pencil — same function, different shape, matches the Telegram-native affordance. Real-time polling is deliberately NOT added — the simplest data model (snapshot on load + manual refresh) is enough because Ashley's own actions update the list live via the tab machinery, and edge cases are rare enough that a refresh handles them.

The scope-fence Ashley named during discussion is load-bearing: **the list is a new view onto the existing tab and session infrastructure. Tab lifecycle behaviors — how RDP tabs disconnect and reconnect, how identity-tmux sessions attach and detach, how pretty view mounts on identity resolution — all stay verbatim.** This phase changes how rows are sourced and rendered; it does NOT re-engineer any tab-lifecycle mechanism.

What would violate the spirit even if it passed a spec: adding any real-time polling / push / notification chrome; adding a plain-SSH row category; adding a "recently ended" section for tombstones; re-engineering the underlying tab lifecycle in service of the new rendering.

## Prior context

**Phase 6 shipped as patch #105 on 2026-07-21.** It removed the tab strip, wired a conversation-list into the sidebar, established the session-persistence contract (mounted-but-hidden across switches within a page-load), rewired mobile into a list-vs-view two-screen flow with a top-left back button, deleted the mobile bottom navigation bar, and added a New Session button. That much of the interface is working correctly on desktop. On mobile, two gaps surfaced during Ashley's post-deploy UAT:

1. A small chrome bug — a header gear icon and a bottom settings row both render on mobile, both routing to the same menu. Duplicate settings entry.
2. The bigger problem — on a fresh mobile page-load, the list shows "no active conversations" because it mirrors the browser-tab's open Skynet tabs, which is empty on fresh load. Ashley expected the list to show her fleet's running tmux sessions, the way the current sidebar host-tree and the double-shift menu do.

The current sidebar's host-tree already discovers fleet-wide tmux sessions and displays them under their host. The double-shift menu already presents the same. So the discovery signal exists in the current system — this phase points the conversation-list at it, in addition to (rather than instead of) the browser-tab's open-tab state.

The shape agreement for Phase 6 is at `.planning/shapes/shape-telegram-like-interface.md`. This phase inherits its scope-fence and philosophy verbatim. Only the data source, the RDP-row rendering, and the pencil re-style change.

## What would make it wrong

- **The list is still empty on fresh page-load.** If the fleet-discovery signal isn't reaching the list on load, the whole reshape has missed the point. Empty state after page-load should mean "you actually have no sessions running anywhere on your fleet" — never "you haven't clicked anything yet in this browser tab."
- **Attached vs. detached leaks visually.** Any visible indicator distinguishing "warm in memory" from "haven't clicked yet" — brightness, italic, dot, spinner-that-shows-only-for-detached — breaks the Telegram-native experience. Rows are rows.
- **Real-time chrome creeps in.** Any polling indicator, "syncing…" spinner, "5 new sessions" badge, live-count anywhere. The ambient-staleness-with-manual-refresh model was chosen deliberately. If the list starts showing you *how up-to-date it is*, it's become a monitoring tool instead of a conversation list.
- **Plain-SSH rows appear.** Ashley never wants to see plain-SSH-host rows. If the discovery signal accidentally surfaces them (e.g. a host with no running tmux gets a "raw shell" placeholder row), that's out of scope.
- **The RDP-at-bottom rows get identity hues, avatars, or per-row chrome that makes them visually collide with identity-tmux rows.** They're distinct from identity-tmux rows on purpose — monitor icon only, no hue, no name text beyond the host name.
- **Tab lifecycle mechanisms get re-engineered.** RDP tab disconnect/reconnect behavior, identity-tmux session lifecycle, pretty-view mount-on-identity-resolution — all stay verbatim. If a plan starts adjusting how tabs live and die "because the list changes their surface," scope has been violated.
- **A version that ships the fleet-native discovery but leaves the mobile gear duplication in place.** The gear-duplicate fix is part of this phase — a ship that punts it is incomplete.
- **A version that adds a second creation affordance for plain SSH ("just SSH in for a moment").** Ashley doesn't do that. The pencil is the ONLY creation button.

## Scope edges

**In:**
- Reshaping the list's data source from "browser-tab's open tabs" to "fleet-discovered tmux sessions unioned with browser-tab's open tabs, deduplicated by session identity."
- Rendering remote-desktop host rows at the bottom of the list, one per RDP-enabled host, with a monitor icon.
- Re-styling the existing New Session button as the pencil (Telegram-analog).
- Fixing the mobile gear/settings-row duplication from Phase 6 — gear desktop-only, settings-row mobile-only.
- Snapshot-on-page-load fleet discovery (no polling, no real-time push).
- Preserving all of Phase 6's chrome, session-persistence contract, mobile flow, pin behavior, and tab-strip absence verbatim.

**Out (no v2 promise):**
- Real-time polling, push, or notification chrome of any kind.
- Plain-SSH host rows in the list.
- Any visual attached-vs-detached distinction.
- A "recently ended" or "history" section.
- A second creation affordance for anything other than identity-tmux sessions.
- Any change to identity-tmux, RDP, or plain-SSH tab lifecycle behavior.
- Cross-device / cross-session state sync (a session created on Ashley's phone doesn't automatically show up on her desktop without a refresh).

**Deferred to a later version (v2, worth having eventually):**
- Any per-conversation activity/unread signal — dots, badges, counts, motion, sound. (Already deferred from Phase 6.)

**Tempting but not in scope:**
- Persisting the currently-selected conversation across browser refreshes.
- A pencil that also handles plain-SSH one-shot shells.
- Distinguishing "identity attached" from "identity not-yet-attached" for a newly-created row while Ashley is doing her setup inside the pane.
- Reusing the current sidebar's polling for the new list. Even if polling comes "for free" from the existing signal, the shape lock is snapshot-on-load; if the free polling manifests as visible list mutations after page-load, that violates the shape.

## Vehicle notes

Vehicle is a GSD phase (Phase 7) inside the Skynet fork — same track Phase 6 followed. The scope is smaller than Phase 6 (probably 2-3 plans: fleet-native data-source rewiring, RDP-row rendering + pencil re-style + gear-duplicate fix, deploy checkpoint) but crosses enough surfaces that a series of quick tasks would leave visible partial states between deploys (list mid-reshape, RDP rows missing, pencil half-applied).

Phase 6 established a strong integration pattern: shape file, then locked-decisions CONTEXT.md synthesized from the shape, then planner + plan-checker, then executor waves, then Ashley-gated deploy behind the mandatory 15-minute deadman rollback. Reuse verbatim. The gear-duplicate fix is bundled into this phase's deploy so it ships in one deadman cycle rather than two.

Bounty coupling: the bounty `telegram-like-interface` under Tina's identity is the tracker. It stays in-progress through this phase — Phase 6 shipped as patch #105 but the shape gap left the bounty open. On this phase's UAT sign-off, the bounty closes via `/close telegram-like-interface`. One arc, one bounty, two ship steps (patch #105 + this phase's patch, likely #106).
