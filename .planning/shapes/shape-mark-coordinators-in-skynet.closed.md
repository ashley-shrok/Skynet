# Shape: mark coordinators in Skynet

**Opened:** 2026-09-01
**Vehicle:** GSD phase (stacked — plan and execute now, ship together with the other pending items when the next ship happens)

## What this is

Every agent in the fleet is either an actor (does the role work) or a coordinator (routes on behalf of the role — the phone line to Alice through Telegram, the front face of the role). Skynet today shows all identities the same way: same color, same avatar, no visual distinction between actor and coordinator. This build adds a visible marker to identities that carry the coordinator flag in their on-disk identity file, so at a glance you know which one is the coordinator versus which are actors.

## Shape

The marker is a right-side watermark: a hub-and-spoke icon sitting in the empty space to the right of the identity's name and title, semi-transparent, sized oversize so it overflows the top, bottom, and right edges of its containing surface. It reads as an atmospheric mark rather than a button or badge — you know it's the coordinator without the mark fighting the primary elements.

It appears in three places:

1. Each row of the conversation list, when that row's identity is a coordinator.
2. The identity badge that sits at the top of chat bubbles in pretty view.
3. The header area of the identity modal (the panel that opens when you click a badge to see bounties, role, etc).

The watermark color derives from the identity's own hue, brightened — same color family as the row/badge's own tint, but a lighter and more saturated variant that sits comfortably against the darker gradient background. The coordinator marker for a red identity is a red-family tone; for a purple identity, a purple-family tone. It never fights the identity's own visual signature; it feels like an extra light coming from the same palette.

The coordinator status itself is read-only in Skynet — this build does not add a UI for toggling the flag. The source of truth is the identity's on-disk YAML frontmatter, read through the same disk-cosmetic pipeline that already reads other cosmetic fields (Phase 66's territory). When the frontmatter contains the coordinator flag set to true, Skynet renders the watermark; otherwise, nothing extra.

## Philosophy

The watermark is atmospheric, not a badge. It marks the identity as coordinator without adding a button, tag, or overlay that competes with existing elements (pin, needs-desk, working spinner, ready dot, unread state, selected state). The oversized bleed and the low opacity are both deliberate — it should feel like the identity IS partly a coordinator, not like the identity WEARS a coordinator badge.

Deriving color from the identity's own hue is the philosophical anchor. Any single fixed color would clash with some identity hues and match others — an anchor tied to the identity itself sidesteps that entirely. The identity's palette IS the identity's palette; the coordinator mark extends it rather than competes with it.

This is a read-only reflection of on-disk state. Skynet does not become the place to promote or demote coordinators; that stays as an identity-side action (edit the frontmatter on the box, or use the identity skill's editing flow). Skynet surfaces what IS; it does not manage what is.

## Prior context

The on-disk cosmetic pipeline that reads role, display name, title, color hue, voice, and avatar from each identity's YAML frontmatter is Phase 66's contribution — code-complete and verified but not yet shipped (Alice paused mid-ship). This build extends that reader by exactly one more field — the coordinator flag — and adds a rendering pass for it on the three named surfaces. The reader already routes through hostId to reach the correct box's disk; this piggybacks on that routing without introducing a new mechanism.

The two visible surfaces where identities render — pretty-view (chat bubbles, identity badge) and the conversation list (rows) — are already hue-driven at the chrome level. That is why the same-hue-brightened color logic integrates naturally: the watermark hue draws from the same value that already tints the row background, the badge background, the avatar disc, the border, and the glow.

The tasting arc that produced this shape ran five rounds and converged on: Material Design's hub-and-spoke icon (MdHub), moderate bleed (icon oversized enough that it visibly spills top, bottom, and right of its container), same-hue-brightened color logic (identity hue at approximately L=78% S=85%), and opacity in the 0.14–0.16 range.

## What would make it wrong

- If the watermark ever fights the primary elements — the display name, the title, the avatar, the pin badge, the needs-desk badge, the working spinner ring, the unread ready dot, the selected-row ring, or any other existing chrome. It sits behind the primaries in every case.
- If a single fixed color is used regardless of identity hue. That was the failure of the earlier coral-only rounds — coral against a warm red identity clashed badly. Color has to derive from the identity.
- If the marker screams "click me" or reads as a badge or overlay. It should feel atmospheric, like a light source, not an added element the eye tries to interact with.
- If the coordinator concept becomes editable from Skynet as part of this build. This is not that build. If Skynet grows a coordinator toggle later, it is a separate build.
- If the marker gets added to any identity surface that wasn't named. Exactly the three surfaces above — not other places identities happen to render.
- If the marker fails loudly when the on-disk file can't be read (offline box, missing file). It degrades to no marker — the same way Phase 66's other cosmetics degrade. Never a placeholder, never a "coordinator unknown" state.
- If the treatment on mobile screams broken or crops through the identity's name/title text. It's expected that mobile may want tuning; the failure is if it obviously breaks the mobile row, not if it looks slightly off.

## Scope edges

**In:**
- Rendering the watermark on: conversation-list row, pretty-view identity badge, identity-modal header.
- Backend extension of the disk-cosmetic reader to include the coordinator flag from the on-disk YAML frontmatter.
- Frontend identity type widening to carry the coordinator boolean through render.
- Hue-derived color logic (identity's own hue, brightened).
- Same treatment on both desktop and mobile.

**Out:**
- Any UI in Skynet for editing the coordinator flag.
- Any surface not among the three named (e.g., IdentitySessionPane, the click-badge sheet's identity list, any list of identities that appears elsewhere).
- Any change to how the coordinator role concept itself works — how coordinators route DMs, who becomes coordinator, how they announce themselves. That all remains outside Skynet.
- Any animation on the watermark. Static.
- Any semantic swap of the icon per-identity or per-role. One icon, MdHub, applied uniformly to all coordinators.

**Deferred:**
- Mobile-specific tuning if the desktop treatment scales awkwardly on mobile. Alice will iterate after seeing it live.
- Any additional coordinator affordances (bounty routing behaviors, sort-by-coordinator, filter-by-coordinator).

**Tempting-but-no:**
- Folding this into Phase 66 to save a ship gate. Growing Phase 66's scope would trigger re-verification and complicate the ship-pause state Alice is deliberately holding.
- Making the coordinator flag editable "while we're in there." That's a separate build.
- Extending the marker to also mark actors somehow (they get no marker; absence is information).

## Vehicle notes

**GSD phase, stacked.** Plan and execute independently now; the work commits locally alongside the other unshipped items (Phase 66, and the smaller items sitting on the branch). When Alice greenlights the next ship, this phase's commits go out in that same bundle. No independent ship gate for this phase.

The backend touches the same disk-cosmetic pipeline Phase 66 introduced. During implementation, read the Phase 66 code first, understand its cosmetic-reader shape, then extend it with the coordinator field as a natural extension of that pattern — not as a new mechanism. The plan should reflect that ordering.

Coupling caveat for the planning agent: Phase 66 is code-complete and verified but still-not-shipped and paused mid-ship. Do not disturb Phase 66's in-flight ship state (its bounty, its ship-gate artifacts, its verification report). Add on top; don't refactor its territory.

Tasting artifacts (mockups showing the visual decisions) were served on tailnet port 45235 during this open session. They may not still be running by the time the phase is planned; the shape file captures the load-bearing numbers.

Related surfaces the plan agent will need to touch:
- The disk-cosmetic reader Phase 66 introduced (backend).
- The pretty-conversations row component and its CSS.
- The pretty-view identity badge component.
- The identity modal component (specifically its header region).
- The identity type definition that carries cosmetic fields to render.

---

## Close-Out

**Closed:** 2026-09-01
**Vehicle used:** GSD phase (stacked, code-complete on `feat/tab-title-from-tmux`, unshipped)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — visible marker on identities carrying the coordinator flag from on-disk YAML** — present · Backend reader picks the coordinator boolean from frontmatter; wire type carries it non-nullable; watermark renders when true.
- **Shape — right-side hub-and-spoke watermark, semi-transparent, oversized bleed** — present · Absolute-positioned span with MdHub SVG mask; bleed spills top/bottom/right of container; opacity 0.14 on badge/modal, 0.16 on row.
- **Shape — three surfaces: conversation-list row, pretty-view identity badge, identity-modal header** — present · Row, badge inner fragment, modal DialogHeader — all wired.
- **Shape — watermark color from identity's own hue, brightened (~L=78% S=85%)** — present · All three surfaces use hsl(hue, 85%, 78%) exactly.
- **Shape — read-only in Skynet, no UI for toggling; sourced from disk-cosmetic pipeline** — present · PUT handler never touches the coordinator field; reader narrows the boolean; safe-default false when absent.
- **Philosophy — atmospheric mark, not a badge; sits behind primary elements** — present · z-index 0, pointer-events none, low opacity, aria-hidden — never fights avatar/text/pin/spinner/etc.
- **Philosophy — same-hue color anchor sidesteps clash across identities** — present · Hue variable read from the identity's own colorHue in every surface.
- **Philosophy — Skynet surfaces what IS, doesn't manage coordinator status** — present · No write path accepts the field; on-disk frontmatter is the sole source.
- **Prior context — extends Phase 66 cosmetic reader by exactly one field** — present · Reader grew a single boolean branch; publicIdentity grew a single overlay line; no new mechanism.
- **What would make it wrong: watermark fights primary elements** — present · z-index 0 + pointer-events:none + aria-hidden + low opacity; sits behind everything.
- **What would make it wrong: single fixed color regardless of identity hue** — present · Color derives from the identity's own hue in every surface.
- **What would make it wrong: reads as a badge or 'click me' overlay** — present · Oversize bleed + low opacity + non-interactive; no border, no fill, no hitbox.
- **What would make it wrong: coordinator concept becomes editable from Skynet** — present · No editing control exists; PUT handler ignores the field entirely.
- **What would make it wrong: marker added to surfaces not named** — drifted · Marker also rides the terminal-mode mount of the identity badge (IdentitySessionPane) — user endorsed: wherever the badge mounts, the marker rides along.
- **What would make it wrong: fails loudly when on-disk file unreachable** — present · Safe-defaults coordinator=false when the reader throws or returns empty; degrades to no marker, never a placeholder.
- **What would make it wrong: mobile crops through name/title** — cannot-verify · Static-only reading of code; mobile responsive behavior not testable without running.
- **Scope In — watermark on the three surfaces, backend reader extension, type widening, hue-derived color, desktop+mobile parity** — present · All in-scope items landed.
- **Scope Out — no editing UI, no other surfaces (per shape wording), no role-behavior changes, no animation, no icon swap** — drifted · Shape excluded IdentitySessionPane; user reclassified "anywhere the identity badge mounts" as intended. Other exclusions honored.

### Additions (in the result, not in the shape)

- Coordinator watermark also renders on the terminal-mode surface's identity badge (IdentitySessionPane mount of the shared identity badge component), which the shape had excluded — endorsed-as-drift

### Follow-ups

- Shape wording: coordinator marker follows the identity badge component wherever it mounts, not just the pretty-view mount — accepted-as-drift

### Notes

End-to-end trace clean: the reader picks the boolean; publicIdentity safe-defaults false; the wire type carries non-nullable coordinator; three named surfaces plus the shared-badge terminal-mode mount (per endorsed drift) render the MdHub mask at hsl(hue,85%,78%), opacity 0.14–0.16, oversized bleed matching the tasting-arc numbers. No write path anywhere accepts or emits the coordinator field. Grep sweep of the UI tree found coordinator references only in the four expected files plus their tests. The mobile-doesn't-crop failure mode is not statically verifiable — flagged cannot-verify per the shape's own deferred-tuning note.
