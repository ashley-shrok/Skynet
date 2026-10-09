# Shape: affordances for dragging open apps and basic navigation of the iframes they reside in

**Opened:** 2026-10-09
**Vehicle:** inline
**Part of campaign:** app-pane-strip (shape 1 of 1)

## What this is

Every open app gets a bar across the top of its pane, always visible, whether the app fills the screen or is one leaf of a split. The whole bar is the app's drag handle — drag it to the sidebar to close the app, or to an edge of another pane to rearrange — exactly as a conversation's badge drags today. The bar's left end carries back, forward, and reload for the page inside the app; the app's icon and name sit centered. Alongside the bar, moving an app's pane stops reloading the app, so rearranging keeps the app on the page it was on with its history intact.

## Shape

**The bar.** A single row across the top of the app's pane, above the app. It wears the conversation task pill's glass look — a soft neutral-grey glass gradient, a faint light edge along the top, a fine border along the bottom, a gentle shadow — because the whole bar is something you grab, and the task pill is (soon to be) the thing you grab in conversations. Apps have no color of their own, so the glass is the neutral grey, not tinted. The app's own content area shrinks by the bar's height; the bar never covers the app.

**What's on it.** Left: back, forward, reload, as small icon buttons that brighten on hover and fade when unavailable. Center: the app's icon and its name — the same static title shown on its sidebar tile, never the app's live page title. Nothing else: no close button, no menu, no "open in new tab".

**Dragging.** The whole bar, except the three buttons, is the drag surface. A drag from the bar behaves exactly like a drag from a conversation's badge: the same coral drop previews on pane edges, the same drop-on-sidebar-to-close, the same close lane when the sidebar is collapsed, and the same ability to drop into another Skynet window. When the app is the only thing open, the only meaningful drop is closing it. Pressing a button never starts a drag.

**Back and forward.** They act only on the page inside the app, never on Skynet itself. Each is greyed out when there is nowhere to go. Skynet remembers where the app's history began when its pane opened, and back is unavailable at that point regardless of what the browser reports — an earlier page from some prior load must never be reachable through the bar, because stepping into it would move Skynet.

**Reload** reloads the page the app is currently on, not the app's start page.

**Selecting the pane.** Clicking the bar selects that pane, the same as clicking anywhere in a conversation pane. Clicks inside the app itself are unchanged.

**The floating sidebar toggle.** Skynet's sidebar-collapse button floats at the top-left of the content area. When an app's bar sits underneath it, the bar's contents shift right so the toggle never covers the back button.

**On a phone.** The bar shows with the buttons and the name, but it is not draggable (conversation badges aren't on phones either; there is no split view). Closing an app on the phone works as it does today.

**Moving a pane no longer reloads it.** Today, whenever Skynet moves a pane's content to a new spot in the layout — rearranging a split, or going from alone to split — any app in it reloads back to its start page and loses its history. The shared move is switched to the browser's newer move-in-place ability, for every kind of pane, not as an app-only exception. Where a browser lacks that ability, the move falls back to today's behavior (the app reloads). Other pane kinds don't change behavior except to keep slightly more state (like keyboard focus) through a move.

**Agents learn it.** The id skill's description of the app's interface gains the app bar: what's on it, that the whole bar drags like a conversation badge, that back/forward/reload act on the app, and that it isn't draggable on a phone.

## Philosophy

**Same vocabulary as conversations.** The bar is a pane handle like the badge, not a new kind of thing. Drag behavior is the existing pane-drag behavior; apps don't get their own branch in it.

**The app is still a black box.** The bar asks the browser about the app frame's history — never about the app's content. It shows the app's static name, not its live page title. Nothing tells the app it's in a pane.

**The bar never moves Skynet.** Any path where pressing back on the bar, or anything about the bar, changes Skynet's own page is a failure — that's the reason for the history-start guard.

**Use a newer browser ability only when it's there.** Both the history reporting and move-in-place are used when the browser offers them; otherwise behavior falls back to what exists today. Nothing breaks on an older browser.

## Prior context

The first-class-apps campaign made apps a pane content type and established the pane-is-transparent-to-the-app stance: no Skynet chrome inside the leaf beyond a title bar that showed the app's static title. Pane title bars were later removed for all pane kinds, so app panes have had no chrome and no handle: once open, an app could only be closed or moved from outside the pane. That campaign explicitly deferred a pane-level reload; this shape brings it in for apps specifically, alongside back and forward.

Conversation panes carry the identity badge as their handle — drag to rearrange, drag to the sidebar to close, drag across windows. The user plans to move that drag role from the badge to the task pill; the app bar's glass look is chosen to match the task pill so the two read as the same kind of grabbable thing.

Tasting: a live console snippet on the real app tried five bar styles, then three task-pill-inspired ones. The user picked the whole-bar glass treatment because the whole bar drags.

A browser test confirmed: the app frame can report and step only its own history; in one setup the browser counted an earlier page from a prior load as part of the frame's history and stepping into it moved the outer page (hence the guard); moving a frame the old way reloads it to its start page, and moving it with the newer ability keeps its page, state, and history.

## What would make it wrong

- Pressing back on the bar ever moves Skynet's own page, or reaches a page from before the app's pane opened.
- The bar covers part of the app, or the app's bottom edge is cut off by the bar's height.
- Dragging the bar behaves differently from dragging a conversation badge — different drop previews, can't close via the sidebar or close lane, can't cross windows.
- Pressing back, forward, or reload starts a drag, or a drag from the bar triggers a button.
- The bar shows the app's live page title, or anything else read from inside the app.
- Rearranging a split still sends an app back to its start page in a browser that supports moving in place.
- The move change breaks another pane kind — a conversation loses its scroll position, a terminal or remote desktop stops responding after a move.
- The sidebar toggle covers the back button.
- The bar is draggable on a phone.
- The id skill doesn't mention the bar, so agents can't tell the user about it.

## Scope edges

**In:**
- The always-visible glass bar on every app pane, desktop and phone, alone and in a split.
- Back, forward, reload with greyed states and the history-start guard.
- App icon and static name, centered.
- Whole-bar dragging with the full conversation-badge drag behavior, including cross-window.
- Clicking the bar selects the pane.
- Shifting the bar's contents clear of the floating sidebar toggle.
- Move-in-place for all pane kinds, with fallback.
- Structured logs at the bar's interactions (navigation actions, drag start, guard refusals) and at the move decision (moved in place vs fell back).
- The id skill update.
- Tests covering the above.

**Out:**
- A home / start-page button, an address display, copy-link, open-in-new-tab, any menu on the bar.
- Making clicks inside the app select its pane.
- Changing what conversation panes show, or moving their drag role to the task pill (the user's own planned follow-up).
- Rewriting the app's history to keep the phone's back gesture from stepping through app pages first.
- Any per-app color for the bar.

**Deferred:**
- Clicks inside the app selecting its pane (watching where the browser's focus goes) — possible follow-up.
- A bar menu, if the user finds herself reaching for one.

**Tempting but no:**
- Hiding the bar until hover to save space — the user chose always-visible.
- Peeking at the app's live title to show a richer name.
- Handling the reload-on-move problem with an app-only exception instead of fixing the shared move.

## Vehicle notes

Inline, worked by morpheus-box-maintainer-3 in this session, tracked with harness tasks. The campaign's "Other work" carries a separate fix for cross-window badge dragging, which the user reported broken; it is done in this session right after the bar is built, and the bar's cross-window drag is verified once that fix lands. The console snippet beside this file (strip-snippet.js) is the tasting record; the chosen treatment is its "Glass bar" variant. Deploy follows the role's ship protocol after the full suite, with the user's push and deploy greenlights.

---

## Close-Out

**Closed:** 2026-10-09
**Vehicle used:** inline (uncommitted working-tree changes on feat/tab-title-from-tmux, with unit tests alongside)
**Overall verdict:** closed-hit — the reviewer returned closed-partial on one gap (move decision logged only on fallback); the gap was fixed right after review (both outcomes now logged for every real move), and both additions were endorsed by the user.

### Shape features (conformance)

- **What this is** — present · Always-visible bar above every app pane, drags like a badge, back/forward/reload left, icon + name centered; shared pane move now moves in place.
- **Shape: The bar** — present · Glass gradient, top light edge, bottom border, shadow copied from the chosen "Glass bar" tasting; fixed-height row with the app filling the rest, so the bar never overlays the app.
- **Shape: What's on it** — present · Three icon buttons that brighten on hover and fade when disabled; static tile title (falls back to the tab label, then the slug); no close, menu, or new-tab.
- **Shape: Dragging** — present · Same payload and arming as the conversation badge plus an app descriptor; existing split, sidebar-close, close-lane paths consume it unchanged; other windows open the app from the descriptor; button-started drags cancelled.
- **Shape: Back and forward** — present · Frame-only history with a floor at the entry first seen; back refused at the floor even when the browser reports earlier entries; rechecked at click time.
- **Shape: Reload** — present · Reloads the current page.
- **Shape: Selecting the pane** — present · Bar click uses the same focus setter as pane clicks.
- **Shape: Floating sidebar toggle** — present · Measured clearance padding, re-measured on resize.
- **Shape: On a phone** — present · Bar renders, drag off.
- **Shape: Moving a pane no longer reloads it** — present · Single shared move site moves in place where supported; falls back for detached nodes, missing ability, or a throw; scroll preservation kept.
- **Shape: Agents learn it** — present · id skill gains the App bar entry; drag/split entry notes moving an app keeps its page.
- **Philosophy: Same vocabulary as conversations** — present · Only app-specific code is the cross-window open-from-descriptor, parallel to every other tab kind.
- **Philosophy: App is still a black box** — present · Reads only frame history and the static tile title.
- **Philosophy: Bar never moves Skynet** — present · Floor guard + frame-only stepping.
- **Philosophy: Newer browser ability only when there** — present · Greyed back/forward without history API; old move without move-in-place.
- **Scope In: Structured logs** — present (was partial at review; fixed) · Nav actions, guard refusals, failures, drag start, and now both move outcomes.
- **Scope In: Tests** — present · Nav state + floor guard, toggle clearance, bar render/title, buttons, drag payload, button-drag cancel, click-select, mobile no-drag, move helper fallbacks, app descriptor, outer drop ladder.
- **Scope Out / Tempting-but-no** — present · None of the excluded items appear.
- **What would make it wrong: Back moves Skynet's page or reaches a pre-pane page** — present · Floor guard + frame-only history, tested.
- **What would make it wrong: Bar covers the app / bottom edge cut off** — present · Column layout.
- **What would make it wrong: Bar drag differs from badge drag** — present · Same payload, arming, consumers, cross-window.
- **What would make it wrong: Buttons start a drag / drag triggers a button** — present · Buttons not draggable; button-started drag cancelled.
- **What would make it wrong: Bar shows live page title or app content** — present · Static title only.
- **What would make it wrong: Rearranging still resets the app where move-in-place is supported** — present · Shared move moves in place.
- **What would make it wrong: Move change breaks other pane kinds** — cannot-verify · Runtime question; carried into agent-side UAT.
- **What would make it wrong: Sidebar toggle covers back button** — present · Clearance applied.
- **What would make it wrong: Bar draggable on phone** — present · Drag off on mobile, tested.
- **What would make it wrong: id skill doesn't mention the bar** — present · App bar entry added.

### Additions (in the result, not in the shape)

- Cross-window drop fix for windows with no split open (campaign "Other work"), shipped in the same changes — endorsed-as-drift
- Letter placeholder in the icon slot when an app has no icon or it fails to load (matches the sidebar tile's existing fallback) — endorsed-as-drift

### Follow-ups

- Log the successful move-in-place case too — done right after review.
- Runtime check that conversations keep scroll and terminals / remote desktops still respond after a rearrange under the new move — deferred to agent-side UAT.

### Notes

The bar's glass carries the tasting variant's faint warm top edge; that is what the user picked. Clicking a nav button also selects the pane (the click reaches the bar), consistent with "clicking the bar selects that pane".

---

## Close-Out (re-close after code review)

**Closed:** 2026-10-09
**Vehicle used:** inline
**Overall verdict:** closed-hit

**Amendment approved by the user before re-close:** back and forward no longer step through the browser's shared history (code review found, and a browser test confirmed, that stepping one app frame back also rewound other app panes and Skynet's own page). Skynet keeps its own list of the pages each app pane visited and loads the previous/next page into that one app in place. Trade-off accepted: a page reached by back/forward loads fresh rather than being restored as left. Also fixed from review: a press beginning on a bar button never drags; cross-window app drops use the same identity checks as address-bar restore; toggle clearance re-measures as the toggle slides; the name can't overlap the buttons.

### Shape features (conformance)

- Every facet of the shape (as amended), every "what would make it wrong" item, and the scope edges — present, per the reviewer's facet-by-facet walk.
- **What would make it wrong: Move change breaks other pane kinds** — cannot-verify by reading; covered in agent-side UAT (below).

### Additions (in the result, not in the shape)

- Cross-window drop fix for windows with no split open — endorsed-as-drift (earlier close)
- Letter placeholder when an app has no icon — endorsed-as-drift (earlier close)
- Each pane's page list is capped at the newest 100 pages — pending user call
- The page list follows the browser's own back/forward (e.g. the phone's back gesture) when it lands on a neighbouring page — pending user call
- An app name arriving from another window is trimmed and capped at 128 characters — pending user call

### Follow-ups

- Agent-side UAT found that collapsing a split (closing one of two panes) still reloaded the remaining app, because the outgoing pane was torn down before the move; fixed by moving the content to a laid-out, invisible holding area just before teardown. A first version of that fix used a container that can be display:none and lost a conversation's scroll position on a swap; caught in UAT, fixed, re-verified.

### Notes

Agent-side UAT ran the new interface in a browser against the live backend (front-end swapped in; backend identical between live and this tree): two apps side by side — back/forward on one leaves the other and Skynet's address untouched and adds no history entries; dragging an app bar to rearrange shows the coral preview and keeps the app on its page in the same document with history; a press on a button never drags; bar-to-sidebar closes; collapsing the split keeps the remaining app's page; cross-window drop into a window with a conversation open splits the app in and closes the source window's copy; a conversation swapped with an app keeps its scroll position; the bar clears the sidebar toggle open and collapsed.
