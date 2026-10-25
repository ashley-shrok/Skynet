# AGENTS.md

## UI look

The app has one look: the **kit**. Build every new element from it; never copy an older screen's styling.

- **Parts:** `@/components/kit` (KitButton, KitIconButton, KitField / KitInput / KitTextarea / KitSelect / KitSearch, KitSwitch / KitCheckbox / KitSegmented / KitChip, KitSettingsGroup / KitSettingsRow / KitList, kitConfirm / kitPrompt / kitAlert). Windows: `@/components/modal`. If the kit lacks a part, add it to the kit.
- **Palette:** the `--k-*` variables in `src/ui/components/kit/kit.css`. Accent comes from the pane's `--pv-id-hue`.
- **Conversation view:** its own parts live in `src/ui/features/pretty-view/conversation.css` — `.pv-float` (pill / floating controls), `.pv-cbtn` (composer buttons), `.pv-status` + `StatusOverlay.tsx` (states over the messages), `.pv-wip-orb` (working).
- **Never:** `backdrop-filter` / blur, translucent "glass" gradients, the legacy `--color-pv-*` / `--radius-pv-*` tokens, or `@/components/button|textarea|input|label|tooltip` in new code. Don't run `npx shadcn add`.
- `src/ui/components/no-old-look.test.ts` enforces this. Its allowlists name the screens not yet restyled (login, SSH dialogs, terminal chrome); they only ever shrink.

## Security

- Anything that would let whoever holds a signed-in browser keep access or widen it — new keys or tokens, password or two-step changes, admin or sign-in settings, exporting secrets or credentials, putting keys onto hosts, redirecting notifications or calls — goes behind the confirm-it's-you check: put `requireRecentAuth` (`src/backend/utils/recent-auth.ts`) after the route's sign-in check, and add the route to `src/backend/utils/recent-auth.coverage.test.ts`. Access keys can never pass it.
- A route with no screen is still reachable by any signed-in browser. Having no screen is not protection.
