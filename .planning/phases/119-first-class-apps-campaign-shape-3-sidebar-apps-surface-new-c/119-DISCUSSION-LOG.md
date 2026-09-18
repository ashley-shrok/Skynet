# Phase 119: First-class apps — sidebar surface (shape 3) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 119-first-class-apps-campaign-shape-3-sidebar-apps-surface
**Areas discussed:** icon-serving-path, unhealthy-tile-visual, iconless-slot-fallback, left-click-behaviour-in-v1

**Preamble.** This phase was seeded from a shape file at `.planning/campaigns/first-class-apps/shape-sidebar-apps-surface.md`. Per the /build skill rule, the shape file is the primary source of decisions and discuss-phase does NOT re-elicit what /open already agreed on. The four areas below are RESIDUAL gray areas that surfaced when reading the shape file against Phase 118's CONTEXT.md — decisions /open didn't explicitly cover.

---

## Icon serving path

| Option | Description | Selected |
|--------|-------------|----------|
| A | New small Skynet endpoint mirroring the identity-avatar serving pattern — decoupled from shape 4's coming proxy | ✓ |
| B | Skip icon rendering entirely in v1 — every tile shows the iconless fallback until shape 4 lands | |
| C | Block v1 on shape 4 | |

**User's choice:** A (implicit via the framing "how identities get their icons because i imagine it's going to be almost the same process").
**Notes:** Ashley pointed me at the existing identity-avatar route as the template — `GET /identities/:identityKey/avatar?hostId=<n>` at `identities.ts:849-`. New endpoint: `GET /apps/:hostId/:slug/icon`. Same auth gate, same hostId-in-URL discipline, same SSH-file-read shape. Captured as D-06 + D-07.

---

## Unhealthy tile visual

| Option | Description | Selected |
|--------|-------------|----------|
| A | Two-line tile: title on top, muted-red healthMessage below. Breaks title-only rule for the unhealthy case only. | ✓ |
| B | Same one-line tile, small red warning glyph on the right, healthMessage in tooltip on hover | |
| C | Same one-line tile, dimmed to ~55% opacity, healthMessage in tooltip on hover, no glyph | |

**User's choice:** A.
**Notes:** Choice made via a second tasting HTML prototype at `.planning/campaigns/first-class-apps/tasting-tile-details.html` (served on `Skynet-8899.serve.term.gigaashley.click`). All three unhealthy variants were rendered against the same "Recipe box" mock app with a healthy tile above and below for contrast. Ashley picked A after viewing. Captured as D-11.

---

## Iconless-slot fallback

| Option | Description | Selected |
|--------|-------------|----------|
| A | First-letter fallback (mirrors identity `.pv-avatar-initial` pattern) on the default-hue rounded square | ✓ |
| B | Generic app glyph (Lucide `AppWindow`) — same glyph for every iconless app | |
| C | Nothing — leave the icon slot empty (title-only tile for iconless apps) | |

**User's choice:** A (via the same tasting round-2 prototype, Q1 pick).
**Notes:** During discussion Ashley reframed the earlier "monogram fallback with hashed hue" language from the shape file as incompatible with the "no per-app colour for v1" rule locked during /open. Her framing verbatim: *"i don't know what you mean by monogram like to me there's a default color that identity list items in the conversation list take on when they don't have a color associated with them from the cosmetics that come over and these apps would just be that color because that's just the default that kind of exists within the sidebar to begin with"*. Interpreted as: the fallback square uses the sidebar's default `--pv-hue: 216`, and the first-letter (pattern already used by identity rows at `PrettyConversationRow.tsx:1214`) renders on top. Shape file was amended to reflect this reconciliation. Captured as D-08 + D-09.

---

## Left-click behaviour in v1 (shape 4 owns future click behaviour)

| Option | Description | Selected |
|--------|-------------|----------|
| A | Left-click is a no-op; cursor styling deemphasised; only context-menu works | ✓ |
| B | Left-click does the same as "Open in new tab" (right-click behaviour) | |
| C | Small toast explaining shape 4 will bring click-to-open later | |

**User's choice:** A (Ashley punted the decision — verbatim: *"if the future shape is going to be handling the left click then you can choose what to do for that one"*).
**Notes:** Chose A as the least-work-for-shape-4 answer — reserves the primary click action so shape 4 doesn't have to migrate the affordance from another mapping later. Captured as D-13.

---

## Claude's Discretion

Beyond the explicit "you decide" on left-click behaviour above, the following execution-time details are Claude's:

- The lucide-react icon glyph for the section header (planner picks — `AppWindow` reads most literally).
- Component / hook / store names (`AppTile`, `useAppTiles`, etc.) — pick coherent with existing conventions.
- Exact border-radius on the rounded-square icon slot (8-12px range; iOS-app-icon aesthetic).
- Exact muted-red colour token for the healthMessage (starting reference `#f4a09b`; a project-consistent token wins if one exists).
- The `APP_SLUG_RE` regex for slug validation — mirror `IDENTITY_KEY_RE`.
- Exact URL path the "Open in new tab" action opens — mirrors shape 2's per-app addressing shape.
- Whether the `<img onError>` fallback swaps via state flip or DOM structure.

## Deferred Ideas

Everything the shape file's `## Scope edges` marked as OUT / DEFERRED / TEMPTING-BUT-NO carries forward:
- Click-in-current-view + drag-to-split — shape 4's job.
- Per-app colour / theming — closed for v1.
- Description line under title — deferred.
- Grouping tiles by host — deferred.
- Additional context menu actions — deferred.
- App-management from the sidebar (create / delete / edit) — closed (agent-driven flow, not user-driven).
- Eager-refresh signal for freshly-created apps — carries forward from Phase 118's deferred list.
- Backend caching of icon bytes — deferred until visible cost surfaces.
- Warning-glyph or dimmed-only unhealthy variants (round-2 Q2 alternatives B + C) — rejected, not deferred.
- Hashed per-app hue for iconless fallback square — rejected during discuss-phase, not deferred.
