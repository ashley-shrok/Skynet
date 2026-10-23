# Shape: the sidebar — "just take a crack at it", header, footer and everything between, on phone and desktop

**Opened:** 2026-10-23

## What this is

The conversation list gets the same pass the windows got. It joins the windows' family: same calm dark surface and colours, no glows, tinted cards, uppercase labels or fading divider lines. Phone and desktop share one language (colours, unread mark, folders for projects, section titles) at different densities: desktop is a compact one-line list, the phone is grouped two-line lists like a messaging app. On the phone, the ⋮ on every row gives way to the gestures people already know: press-and-hold for the menu, swipe to archive. The sidebar also gets a little wider, to make room for the pictures beside each conversation.

## Shape

- **Surface.** The sidebar sits on its own slightly lifted dark surface with a hairline edge, in the windows' colours. The header and search box no longer have lines under them; the footer keeps a hairline above it.
- **Header.** The logo on the left; the new-conversation pencil on the right as a round, quiet button like the windows' buttons.
- **Search.** A filled rounded field like the windows' fields; focused, it gets the accent outline. "everywhere ↗" behaves as today.
- **Section titles** (Apps, Pinned, Projects, Conversations, Remote desktop). Sentence case, never uppercase, with no fading lines beside them. Desktop: 13px, semibold, faint. Phone: bold headings in full white over each group. Their arrows point right when closed and down when open.
- **Projects are folders.** Each project and sub-project is a row with an open/close arrow, a folder glyph and its name. Desktop: 14px, hover highlight, ⋮ on hover. Phone: a folder heading over its own group, ⋮ always shown. Sub-projects step in by 10 per level.
- **Desktop conversation rows.** One line: a 24px round picture with no coloured ring or glow, then the title at 14px. Read rows are softer, unread rows are bright and semibold. Rows are 34 tall with 2 between them. Hover is a faint neutral fill; the open conversation is tinted in that agent's own colour. The role in brackets stays, fainter. The pin glyph is gone (pinned rows already sit under Pinned). ⋮ appears on hover, and right-click opens the same menu.
- **Phone conversation rows.** Every run of rows sits on one rounded panel, with hairlines between rows that start where the text starts. Each row has a 46px picture, the title in bold, and the second line softer. Rows are 68 tall. A pressed row darkens. Remote-desktop rows have no "…" second line. No ⋮ on rows.
- **Unread.** A small dot in the agent's own colour at the end of the row, and a brighter title. The old coloured outline is gone. The red envelope for "sent you a message" stays, and still outranks the dot. On desktop the dot steps aside on hover for the ⋮.
- **Phone gestures.**
  - **Press-and-hold** on a conversation row opens its menu, with the same items as desktop. Holding never starts a drag, select text, or fire if the finger moves into a scroll.
  - **Swipe a conversation row sideways to archive it**, in one motion. The row slides away and a bar says **"Archived ‹name› · Undo"** for about 5 seconds. The archive only happens once the bar is gone; Undo puts the row back. No confirm dialog on the swipe. Rows that can't be archived (remote desktops, relay rooms) don't swipe.
  - **App icons:** press-and-hold opens the app's menu; the ⋮ in each icon's corner goes.
  - **Project headings and the Apps heading** keep their ⋮ on the phone.
  - **The menu's Archive** (hold on phone; ⋮ or right-click on desktop) keeps its confirm.
- **Apps grid.** Same grid; tiles move to the windows' colours (neutral icon wells, softer shadow, names in the softer text colour).
- **Footer.** Your picture and name, then the five round icon buttons, quiet until hovered. Your name fits instead of being cut short. Phone keeps 44px buttons.
- **Width.** The desktop sidebar starts at 300 wide and can't be dragged narrower than 300. Anyone already wider keeps their width; anyone narrower is brought up to 300. The widest stays 480.
- **Empty Conversations note:** "Start a conversation with the pencil at the top."
- **Readability floor.** Every piece of text meets the standard contrast for its size (4.5, or 3 for large bold), and icons meet 3. Every desktop click target is at least 24×24 (the Projects "+" included). Phone buttons stay at 32 or more.
- **Text size** on the phone follows the user's text-size setting, as today.

## Philosophy

- Apple's interfaces were the reference; the look is the windows' family, Skynet's own.
- Colour only where it means something: the agent's colour marks the open conversation and the unread dot. Rows, pictures and sections are otherwise neutral.
- One language across phone and desktop; density is the only thing that differs.
- On a phone, a list behaves like the lists in the apps people use every day: no clutter of buttons on every row, hold for options, swipe to get rid of something, quickly, with a way back.
- Sizes and spacing are checked, not just eyeballed: against the published accessibility standard and against well-funded design systems (GitHub, Atlassian, Microsoft, Google, Apple), and they land inside that range.

## Prior context

- Before: on desktop, bare one-line rows at 12.5px with tan uppercase section labels and fading hairlines. On the phone, big tinted glassy cards in each agent's colour, with a pin badge and a ⋮ on every row (Ashley: "very blocky", left over from before the redesign). Unread was a coloured outline around the row.
- The kebab-everywhere, no-press-and-hold rule came from an earlier sidebar shape, to stop bad situations: phone text selection, a hold turning into a drag, a scroll opening a menu. Right-click was added back on desktop later.
- Tasted as a console snippet over live on desktop and in the phone emulator; Ashley: "pretty much kicks ass". Her changes during tasting: conversations 14px and section titles 13px (what sites with bigger UX budgets use), a touch more spacing. A spacing switch (tight 32 / current 34 / roomy 40) settled on current.
- Checks run: contrast (the faintest grey failed at 3.6 and was brightened to about 5), click and tap sizes (the desktop Projects "+" was 20×20 and became 24×24), and reference measurements.
- Width: today's 266 is about ChatGPT's 260 and a little under Gemini's; the picture and its gap cost about 34, hence 300.
- Tasting files: the identity workspace's tastings folder for this shape (snippet, build script, audit script, reference measurements).

## What would make it wrong

- If any part of the sidebar still carries the old glows, tinted cards, uppercase labels or fading lines.
- If phone and desktop read as two different products rather than one at two densities.
- If a stray swipe can lose a conversation without a visible way back, or a swipe archives something before the Undo window is over.
- If press-and-hold misfires: during a scroll, by selecting text, or by dragging the row.
- If anything the sidebar can do today is lost: every menu item, right-click, drag into split view on desktop, collapsing sections, search, the DM envelope, the unpushed-work badge, unread state.
- If any text falls below the contrast standard, or a click target below 24×24 on desktop.
- If unread becomes louder than "sent you a message".

## Scope edges

- **In:** the sidebar on desktop and phone: header, search, every section and its heading, projects and sub-projects, conversation rows, remote-desktop rows, the apps grid, the footer, the phone gestures for rows and app icons, the desktop width limits, the empty-Conversations note. Also clearing out the conversation list's leftover unused row styles.
- **Out:** the bar across the top of app / remote-desktop / file panes (its own shape, next); the conversation view (last shape); the sidebar's open/close arrow beside the panes (the pane-bar shape); the windows the footer opens (done); what's inside an app.
- **Logged for the rest of the campaign:** on phones, lists use hold and swipe instead of a ⋮ on every row, everywhere in the app; the windows' own faintest grey may fail the same contrast check.
- **Deferred:** depth and character in the look (the look-adjustments shape, after the deploy); sizes of windows (the modal-sizing shape).

## Handoff notes

- Built by copper-box-maintainer-2 inside the apple-ux campaign; local only, not pushed, not deployed (campaign shipping rule).
- Visible to everyone: the id skill's sidebar descriptions (rows, phone gestures, swipe to archive with Undo, app icons, width) need updating in the same work.
- The tasting's measurements and colours are the starting point; the desktop browser used for previews reports no mouse hover, so check hover-only things by unit test or on a real screen.
- Upstream's un-archive changes (spinner on archived rows in full search, agent-side identity un-archive) arrive at the next rebase; port them into the redesigned search window.

---

## Close-Out

**Closed:** 2026-10-23
**Overall verdict:** closed-hit (every agreed feature present; one wording drift and four additions endorsed by Ashley)

### Shape features (conformance)

- **What this is** — present · windows' neutral family; glows, tinted cards, uppercase labels and fading lines gone; desktop one-line, phone grouped two-line; phone ⋮ replaced by hold and swipe; wider sidebar.
- **Surface** — present · own lifted dark surface with a hairline edge; no lines under header or search; footer hairline kept.
- **Header** — present · logo left, round quiet pencil right.
- **Search** — present · filled rounded field, accent outline on focus, "everywhere ↗" as before.
- **Section titles** — present · sentence case, no fading lines; desktop 13px semibold faint, phone bold white; arrows right when closed, down when open.
- **Projects are folders** — present · arrow, folder glyph, name; desktop 14px with hover and ⋮ on hover; phone heading with ⋮ shown; sub-projects step in by 10.
- **Desktop conversation rows** — present · one line, 24px plain picture, 14px title, read softer / unread bright, 34 tall with 2 between, neutral hover, open row in its agent's colour, fainter role, no pin glyph, ⋮ on hover plus right-click.
- **Phone conversation rows** — drifted · all present; a pressed row turns slightly lighter (as tasted) rather than darker — Ashley endorsed. The empty "…" line is hidden on every phone row without a second line, as tasted.
- **Unread** — present · dot in the agent's colour plus brighter title; outline gone; envelope kept; dot steps aside on desktop hover.
- **Phone gestures: press-and-hold** — present · 500ms hold opens the same menu; movement cancels; no drag, no text selection; the following tap ignored.
- **Phone gestures: swipe to archive with Undo** — present · no confirm; 5-second "Archived … · Undo" bar; archive only after the bar goes; Undo restores; non-archivable rows don't swipe.
- **Phone gestures: app icons** — present · hold opens the menu; corner ⋮ hidden.
- **Phone gestures: headings keep ⋮** — present.
- **Phone gestures: menu Archive keeps its confirm** — present.
- **Apps grid** — present · neutral wells, hairline, softer shadow, softer names.
- **Footer** — present · picture, name, five round quiet buttons; 30px desktop, 44px phone.
- **Width** — present · 300 start and minimum, 480 maximum; narrower saved widths brought up to 300.
- **Empty Conversations note** — present · exact copy.
- **Readability floor** — present · faint grey brightened to about 5:1; desktop targets ≥ 24; phone ⋮ and "+" 32.
- **Text size on phone** — present · relative to the user's setting; search field 16px minimum.
- **Scope: leftover row styles cleared** — present.
- **Scope OUT items** — present · pane bar, conversation view, sidebar open/close arrow, footer windows untouched.
- **Handoff: id skill updated** — present.
- **Handoff: upstream un-archive changes ported** — cannot-verify · arrives at the next rebase.
- **What would make it wrong: old glows / cards / uppercase / fading lines remain** — present (guarded).
- **What would make it wrong: phone and desktop read as two products** — present (guarded).
- **What would make it wrong: stray swipe loses a conversation / archives early** — present (guarded).
- **What would make it wrong: press-and-hold misfires** — present (guarded).
- **What would make it wrong: an existing capability is lost** — present (guarded).
- **What would make it wrong: contrast or desktop target below the floor** — present (guarded).
- **What would make it wrong: unread louder than "sent you a message"** — present (guarded).

### Additions (in the result, not in the shape)

- A red "Archive" strip shows behind a phone row while it's being swiped — endorsed-as-drift
- In a narrow desktop window (phone layout, mouse), rows show their ⋮ all the time — endorsed-as-drift
- Sidebar menus (rows, headings, app icons) take the windows' menu look — endorsed-as-drift
- An app icon's ⋮ still appears on keyboard focus — endorsed-as-drift

### Follow-ups

- Port upstream's un-archive changes into the redesigned search window at the next rebase — deferred
- Carry hold-and-swipe (no ⋮ on every row) to other phone lists — deferred (logged in the campaign)
- Brighten the windows' faintest grey in the post-deploy look pass — deferred (logged in the campaign)

### Notes

Conformance read only. Ashley endorsed all five divergences at once (2026-10-23).
