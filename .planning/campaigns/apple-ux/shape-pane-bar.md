# Shape: the bar across the top of app, remote-desktop and file panes

**Opened:** 2026-10-23

## What this is

The one shared bar that sits across the top of every pane that isn't a conversation — an app, a remote desktop, or a file dragged out of a chat — redrawn to belong to the same family as the redesigned sidebar and windows. Nothing it does changes; it looks and reads differently, and a file's bar shows only the file's name. The same "name only" rule reaches the file window's header.

## Shape

- **The bar.** A solid dark strip in the windows' palette, with one thin line along its bottom edge. No glassy gradient, no drop shadow. A little taller than today (44 instead of 40) on a computer; still taller again on touch devices (52).
- **Left buttons** (app: back, forward, reload; remote desktop: reconnect; file: reload, download). Larger, quiet until hovered, then filled with the soft hover grey. Back and forward carry heavier arrows; reload sits slightly apart from them; a button with nowhere to go fades well back.
- **Title, centred.** The pane's icon then its name. An app's own icon shows at full colour; a file or remote desktop shows its glyph on a small grey tile. The name is a touch bigger and bolder than today.
- **File bar: name only.** The second line (machine and folder) is gone. Where the file came from is not shown — no machine, no agent. The path is still reachable through **Copy path** in the menu.
- **Right side.** The menu button becomes the ⋯ used everywhere else in the redesigned app, and its menu takes the windows' menu look. A file's other right-hand controls (read aloud, view switch) sit beside it in the same quiet style.
- **Touch devices.** The round back-to-conversations button becomes a solid grey circle instead of a glassy one; the buttons beside it are larger to tap.
- **File window header (same rule).** The file window — opened from a chat bubble or a Files tab — loses its second line too: no machine and folder for chat files, no "Files › folder" for workspace files. Name only.

## Philosophy

The pane bar is chrome, not content: it should recede, read cleanly, and feel like the same app as the sidebar and the windows. It names the thing in the pane and offers its few actions — nothing more. Information you rarely need (where a file lives, which machine it's on) is not worth a permanent line; it stays one step away in the menu.

## Prior context

Ashley tasted the new bar as a console snippet over the live app (2026-10-23) on an app, a remote desktop and a markdown file: "clean", "looks fantastic", "visually, this is fantastic". Her one change: the file bar keeps only the file name — drop the path, and don't replace it with the machine or the agent it came from ("let's just do the file name for now"). She then extended the same to the file window. On a phone a file can't be opened into a pane (no dragging), so the file bar is a computer-only case; apps on a phone showed the touch version of the bar. The tasting lives at `workspace/tastings/panebar/`.

## What would make it wrong

- The bar draws attention to itself — glow, gradient, shadow, or anything that competes with the content below it.
- The three kinds of pane drift apart: one bar, one look.
- A file bar or file window still shows where the file lives under its name.
- The path becomes unreachable (Copy path must remain).
- Anything the bar does today stops working: dragging the whole bar, right-click menu, clicking to select the pane, clearing the floating sidebar arrow, the back-to-conversations button on touch.

## Scope edges

- **In:** the shared pane bar's look on all three pane kinds, computer and touch; the menu's look when opened from the bar; dropping the file bar's second line; dropping the file window's second line.
- **Out:** the floating sidebar arrow over the bar's left end (it belongs to the app's frame); the apps' own content; split-view focus indication.
- **Not doing:** any indicator of where a file came from (machine or agent) — Ashley said no to both for now.
- **Deferred:** overall depth and character — the look-adjustments shape after the campaign deploy.

## Handoff notes

Copper (copper-box-maintainer-2), inside campaign apple-ux. The tasting's stylesheet is the visual reference (`workspace/tastings/panebar/panebar.css`). Build the look into the shared bar itself rather than bolting on overrides; reuse the kit's colours, icon-button and menu pieces. The id skill's bar descriptions (app bar, remote-desktop bar, file bar, file window) need matching edits, including dropping "glassy" and the file bar's machine-and-folder line. Committed, not pushed, not deployed — campaign shipping rule.
