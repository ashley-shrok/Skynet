# AGENTS.md

## UI look

The app has one look: the **kit**. Build every new element from it; never copy an older screen's styling.

- **Parts:** `@/components/kit` (KitButton, KitIconButton, KitField / KitInput / KitTextarea / KitSelect / KitSearch, KitSwitch / KitCheckbox / KitSegmented / KitChip, KitSettingsGroup / KitSettingsRow / KitList, kitConfirm / kitPrompt / kitAlert). Windows: `@/components/modal`. If the kit lacks a part, add it to the kit.
- **Palette:** the `--k-*` variables in `src/ui/components/kit/kit.css`. Accent comes from the pane's `--pv-id-hue`.
- **Conversation view:** its own parts live in `src/ui/features/pretty-view/conversation.css` — `.pv-float` (pill / floating controls), `.pv-cbtn` (composer buttons), `.pv-status` + `StatusOverlay.tsx` (states over the messages), `.pv-wip-orb` (working).
- **Never:** `backdrop-filter` / blur, translucent "glass" gradients, the legacy `--color-pv-*` / `--radius-pv-*` tokens, or `@/components/button|textarea|input|label|tooltip` in new code. Don't run `npx shadcn add`.
- `src/ui/components/no-old-look.test.ts` enforces this. Its allowlists name the screens not yet restyled (login, SSH dialogs, terminal chrome); they only ever shrink.
