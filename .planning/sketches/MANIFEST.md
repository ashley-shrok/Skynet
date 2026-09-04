# Sketch Manifest

## Design Direction

Skynet PrettyView identity modal — clean up the flat 6-tab strip that mixes role-scope
and identity-scope content into a modal shape that (a) makes the scope split legible at
a glance, (b) supports both wakeup scopes, and (c) works for coordinator identities where
most identity-scope content is empty by design. Grounded in the actual pretty-view visual
language: hue-tinted glassy surfaces, warm off-white text, patch #191 Telegram-shape
bottom icon-bar as the current baseline.

## Reference Points

- Current identity modal: `src/ui/features/pretty-view/IdentityModal.tsx` (patch #191 bottom icon-bar, 6 fixed tabs)
- Palette: `src/ui/index.css:117-146` `--color-pv-*` tokens
- iOS Settings (for scope-toggle inspiration in variant D)
- Discord / Slack settings (for left-rail inspiration in variant C)

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | identity-modal-role-vs-identity-split | How should the identity modal separate role-scope from identity-scope content, and where should role-level wakeups live? | **D · Scope Switch** | identity-modal, layout, pretty-view, coordinator-support, wakeups |
