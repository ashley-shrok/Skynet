# Fix: Files tab row menu — right-click, "Show in folder", phone breadcrumb

**Opened:** 2026-10-14 (follow-up inside the files-search campaign; agreed in-session)

- **Observed:** In the Files tab (agent / role / project modals), right-clicking a file or folder gives the browser's own menu, not the row's menu; the row's three-dots menu is a one-off look unlike every other Skynet menu. Search results have no way to jump to the folder a result lives in. On a phone, a deep folder path squeezes the breadcrumb into a tall narrow column beside the toolbar buttons.
- **Correct after the fix:** Right-clicking any row — browsing or search results — opens the same menu as its three-dots button, at the cursor, using Skynet's standard row menu (same look and behavior as everywhere else; phone long-press stays native). Items unchanged: Rename, Download (files), Delete. Search results also get **Show in folder**: goes to the folder the result sits in, ends the search, and briefly highlights that item there. When a deep path doesn't fit beside the toolbar buttons (phone or narrow modal), the breadcrumb gets its own full-width line and the buttons wrap below.
- **Suspected files:** the shared Files-tab browser (row menu, row rendering, breadcrumb/toolbar layout); the app's standard row menu (reused, not changed); id skill Files bullet.

## Change made

- Files-tab rows use the app's standard row menu (same look as every other ⋮ in Skynet); right-clicking a row opens that same menu at the cursor, for folder listings and search results alike. Items: Rename, Download (files only), Delete — search results add **Show in folder** first.
- Show in folder opens the result's folder, ends the search, scrolls the item into view and rings it for about two seconds.
- The breadcrumb sizes to its one-line width, so when a path doesn't fit beside the toolbar buttons the buttons wrap below it and the path gets the whole line (phone and narrow modal both); a short path still shares the line with the buttons.
- id skill Files bullet mentions the right-click menu and Show in folder.

done: right-click opens the row menu at the cursor (browse + results); Show in folder lands in the right folder with the item ringed and the search cleared; deep paths get their own line at desktop-modal and phone widths — checked in a browser harness against this box's real folders, plus in-process tests.
