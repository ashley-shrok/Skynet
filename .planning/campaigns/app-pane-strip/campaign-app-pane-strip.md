# Campaign: affordances for dragging open apps and basic navigation of the iframes they reside in

**Opened:** 2026-10-09
**Status:** in_progress
**Workspace:** ~/fleet/identities/morpheus-box-maintainer-3/workspace/skynet/.planning/campaigns/app-pane-strip/

## Concept

Every open app gets a thin strip across the top of its pane, always visible, whether the app is the only thing open or one leaf of a split. The strip is the app's drag handle — drag it to the sidebar to close the app, or elsewhere in the split to rearrange, the same way a conversation's badge works — and it carries back, forward, and reload for the page inside the app.

## Success criteria

- An open app can be closed or moved by dragging its strip, with no detour through the sidebar.
- Back, forward, and reload act on the page inside the app, and never move the Skynet page itself.
- The strip looks and behaves the same whether the app is alone or in a split.
- The id skill describes the strip so agents can guide the user to it.

## Shapes

- **[declared] shape-app-pane-strip** — the always-visible strip on app panes: drag handle + back/forward/reload — closed

## Other work

- Fix cross-window badge dragging (user reported it not working on 2026-10-09; the app bar's cross-window drag rides the same machinery) — done (no-split target windows now resolve the badge descriptor; shipped with the bar)

## Lingerers (explicitly approved)

## Open questions
