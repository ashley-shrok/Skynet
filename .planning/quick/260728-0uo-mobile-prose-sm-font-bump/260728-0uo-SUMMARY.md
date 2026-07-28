---
quick_id: 260728-0uo
slug: mobile-prose-sm-font-bump
status: complete
completed: 2026-07-28
commit: 368a9aa
---

# 260728-0uo — SUMMARY

## What shipped

Added a `@media (max-width: 768px)` block to `src/ui/index.css` (between the `html.fs-xl` rule and the safe-area `@supports` blocks) that bumps `.prose-sm` on mobile viewports:

```css
@media (max-width: 768px) {
  .prose-sm {
    font-size: 1.3125rem !important;
    line-height: 1.55 !important;
  }
}
```

Effect: every `.prose-sm` reading surface — ChatMessage bubbles, HandoffTab, AsideBubble, IdentityFileTab — renders at 21px on mobile (matching Ashley's Telegram-parity target confirmed via `?fonttune=1` live tuner), with a tighter 1.55 line-height for Telegram-like message density. Composebox textarea, buttons, sidebar, and conversation-list rows are untouched (no html-level cascade).

## Files

- `src/ui/index.css` — media query added, 21 lines (4 CSS + 17 lines of context comment).

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 62 files / **715 passed / 6 skipped** (baseline 715 from wd0, zero regressions).

## Method-of-arrival — how we landed on 1.3125rem

Ashley's original ask was verbatim: "make the font bigger across the board on mobile, because Telegram's is bigger, and I like the size of that, if you can find out what it is." Five prototype iterations (v1 → v5, all served on tailnet 8899) walked the answer:
- v1/v2/v3 proved font swap (Inter vs SF Pro) was NOT the delta on Ashley's phone — pairs looked identical at every candidate size.
- v4 gave hard measurements (Skynet coded 14px, Telegram = iOS body 17px, ratio 1.214× at prototype viewport 440×796).
- v5 loaded Skynet's actual compiled CSS bundle (docker-cp'd out of the running container) so bubble A was byte-identical to the deployed app — Ashley still saw A as MUCH bigger than her real Skynet, ruling out class-list divergence.
- Final diagnostic (`?fontdiag=1` injected into the running container's index.html) revealed Ashley's real Skynet renders at viewport 587×1061 while the prototype at 440×796 — a 1.334× viewport delta explaining the perceived shrinkage even though computed font-size was identical (14px).
- `?fonttune=1` live tuner (buttons for html font-size 16/18/20/22/24/26/28/30/32 that mutated `document.documentElement.style.fontSize` in real-time on the running app) let Ashley pick html=24 as her Telegram match. That cascades .prose-sm to 21px.
- She flagged composebox buttons as too big at html=24 — motivating the surgical .prose-sm-only fix instead of an html-level bump.

Learned-preferences hits during this workflow:
- "Prefer serve-from-tailnet HTML prototypes over build/deploy cycles for frontend iteration" — five prototype revs cost zero deploys.
- "shadcn wrapper components with dark: variants beat plain arbitrary overrides on specificity" (patch #81 lesson) — informed the choice to use `!important` here instead of hoping source-order wins the cascade.

## Deployment note

Ashley separately greenlit deploy in the same turn as the `/gsd:quick` authorization. Deploy happens next in the outer flow (not part of this quick task):
- Batches with `260727-wd0` (Archive button) — both ship as patches #161 + #162 in one recreate.
- Pre-warn Ashley about first-hard-refresh HTTP2_PROTOCOL_ERROR per learned preference (close+reopen the tab).
- `skynet-patches.md` write-ups for both #161 and #162 land inline with the recreate per fleet inline-docs directive.

Closes carrying-forward relevance for the `mobile-font-size-bigger-match-telegram` pinned bounty — after deploy verifies, bounty closes + archives (no UAT check-in per fleet rule).
