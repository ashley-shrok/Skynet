# Shape: one file window, wherever a file opens — each type opens the way you'd normally use it

**Opened:** 2026-10-22

## What this is

Every place a file opens to be read or edited becomes one file window that looks and behaves the same: a file an agent shared in a chat, and a file opened from an agent's, role's or project's Files tab. How a file opens follows its type, the way a computer picks a default app: things you look at just show, documents open for reading with an Edit button, and things you work on open ready to type. The markdown "Formatted / Plain text" switch stops sitting on a row of its own, everywhere it appears.

## Shape

- **One window for both places.** The chat file window and the Files-tab file window share one header and one set of behaviours. The only difference is what saving means: in a chat the button says **Send edited copy** (the edited version is attached to your next message; the agent's file is untouched); in a Files tab it says **Save** and writes the file in place.
- **The header says what you're looking at.** The file type's icon in a small tile, the name, and underneath, faintly, where it lives (machine and folder for a chat file; "Files › folder › …" for a Files-tab file). On the right: read aloud (prose files), the view switch, the main button (Edit, or Cancel + Save, or Save), the ⋯ menu, close. No footer.
- **Three ways a file opens, by type:**
  - **Look at / watch / listen** — pictures, video, audio, fonts, ebooks, slides, Excel spreadsheets, 3D models, databases, data files, emails, calendar files, contacts, diffs, diagram-tool files. The content fills the window; no Edit. Types that also have a text view (diff Raw, calendar and contacts Source) keep today's behaviour: switching to the text view shows Save, like any text file.
  - **Read first** — markdown, Word documents, PDFs, notebooks. Opens locked, with no editing tools. **Edit** brings the tools in and shows **Cancel** and **Save**; Save stays dimmed until something changes. Cancel asks first if there are unsaved changes, then returns to reading. After a successful save the window goes back to reading.
  - **Ready to work on** — code and plain text, CSV tables, subtitles, diagrams written as text, the drawing canvas. Opens editable; Save appears in the header, dimmed until something changes.
- **One place for view switches.** Markdown's Formatted / Plain text joins the other view switches (Table / Raw, Rendered / Source) in the header of the file window and the file pane's bar. In markdown editors inside other windows (agent file, role file, project file, About you, the instance file, skill files), the switch sits at the right end of the formatting toolbar; when there's no formatting toolbar (plain text, or a locked view) it sits in a slim toolbar bar of the same kind above the editor. When a file has markup the formatted view can't show, Formatted is greyed out with the reason — beside the switch in a toolbar bar, on hover in a header.
- **The ⋯ menu** holds the less-used actions: Download, and Copy path for chat files.
- **Phone:** the window fills the screen. The top row keeps the name, the main button, ⋯ and close; the view switch drops to its own row under the name; read aloud moves into the ⋯ menu.
- **The file pane** (a file dragged beside the conversation, view-only) gets the markdown switch in its bar like the other view switches; otherwise it stays as it is.
- **Leaving with unsaved changes** still asks first, as today.

## Philosophy

- Opening a file should feel like opening it on your own computer: the window does what you'd normally want to do with that kind of file, and editing tools appear only when editing is what you're doing.
- One window, one set of rules — not two near-identical windows differing in small arbitrary ways.
- The header is the one place for a file's controls; the content starts straight under it.
- This is the frame around the viewers, not the viewers themselves.

## Prior context

- Before: two separately built windows. Both opened straight into editing with Save always showing; only the Files-tab one had Download; only the chat one had a Close / Save footer; neither said where the file lives. A markdown file stacked three rows before its text (the switch alone on the right, the formatting toolbar, the document).
- The file pane already had the icon + name + "machine · folder" header this shape brings to the windows.
- The agent, role and project windows already read their own files first with an Edit button; this matches them.
- Tasted on a real preview build over the live app with real files (markdown, code, CSV, a picture, the agent file); Ashley: "Love it". Tasting files: the identity workspace's tastings folder for this shape.

## What would make it wrong

- If a picture, video or other look-at file ever shows an Edit or Save button.
- If a document ever opens straight into editing tools, or a code file opens locked behind Edit.
- If the two windows drift apart again in controls or behaviour, beyond what saving means.
- If the Formatted / Plain text switch sits on a row of its own anywhere it doesn't have to.
- If saving in a chat window could be mistaken for changing the agent's file.
- If anything a window can do today is lost — a text view that could be edited, Download, read aloud, unsaved-change protection, PDF markup saving.

## Scope edges

- **In:** both file windows, the file pane's switch, every markdown editor's switch placement, phone layout of the file window.
- **Out:** the inside of each viewer (spreadsheet row/column tools, PDF markup tools, drawing tools); image editing; Copy path for Files-tab files (the window doesn't know the full path) — logged in the campaign's Other work.
- **Deferred:** window sizes — the campaign's sizing shape.

## Handoff notes

- Built by copper-box-maintainer-2 inside the apple-ux campaign; local only, not pushed, not deployed (campaign shipping rule).
- Non-admin visible: the id skill's file-modal and file-pane descriptions need updating in the same work.
- The real-build preview needs the app's service worker cleared before the swapped build loads, and the local preview server restarted after each rebuild into its folder.

---

## Close-Out

**Closed:** 2026-10-22
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Both windows share one header, one action set and one rule for how each type opens; the old chat-only footer is gone; the markdown switch no longer sits on its own row.
- **One window for both places; only what saving means differs** — drifted · Ashley, at close: "maybe just go with save on the button, keep it simple. users will see the attachment after that and understand" — the chat window's button now says Save (it still attaches the copy to the next message and closes); Files-tab Save writes in place.
- **Header** — present · Icon tile, name, faint location line ("machine · folder" for chat files, "Files › folder" for Files-tab files); read aloud, view switch, main button, ⋯, close; no footer.
- **Look at / watch / listen** — present · No Edit; their text views (diff Raw, calendar/contacts Source) still offer Save.
- **Read first** — present · Opens locked; Edit brings tools + Cancel and Save; Save dimmed until a change; Cancel asks if unsaved; Files-tab save returns to reading; chat save closes as before.
- **Ready to work on** — present · Opens editable with Save dimmed until a change.
- **One place for view switches** — present · Header of window and pane; end of the formatting toolbar elsewhere; slim bar when there's no toolbar.
- **Formatted greyed out with the reason** — present · Reason beside the switch in a bar; in a header the reason was unreachable on hover (greyed-out segments take no pointer) — found at close and fixed by putting the reason on the whole switch.
- **⋯ menu** — present · Download in both; Copy path for chat files only.
- **Phone** — drifted · Window fills the screen and read aloud moves into ⋯, but the main buttons moved from the top row to the row under the name beside the view switch (wrapping under it on the narrowest screens), so Cancel + Save don't squeeze out the name; kept as built (Ashley answered the question by simplifying the save label).
- **File pane** — present · Markdown switch in its bar; otherwise unchanged.
- **Leaving with unsaved changes** — present
- **Philosophy** — present · Viewers only rebuilt when switching reading ↔ editing; nothing inside a viewer changed.
- **Prior context commitments** — present
- **What would make it wrong: a look-at file shows Edit or Save** — present
- **What would make it wrong: a document opens into editing, or code opens locked** — present
- **What would make it wrong: the two windows drift apart** — present · Remaining differences: send-and-close vs write-in-place, Copy path.
- **What would make it wrong: the switch on a row of its own where it needn't be** — present
- **What would make it wrong: saving in a chat mistaken for changing the agent's file** — drifted · Plain Save by Ashley's choice; the attachment chip that appears in the compose box is what tells the user where it went.
- **What would make it wrong: anything lost** — present · Editable text views, Download, read aloud, unsaved-change protection, PDF markup saving all remain.
- **Scope edges** — present · Viewer insides, image editing and sizes untouched; Files-tab Copy path logged in Other work.
- **Handoff: id skill updated** — present

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Greyed-out Formatted's hover reason couldn't show in a header — issue — fixed at close.
- Phone layout kept as built (buttons on the row under the name) — accepted-as-drift.

### Notes

Settled by reading the uncommitted change. Supporting pieces (compact switch size, hover text on switch options, read aloud from a menu item, rebuilding the viewer between reading and editing) all serve shaped features.
