# Shape: Normalize sidebar affordances to kebab-only

**Opened:** 2026-10-01
**Vehicle:** inline

## What this is

The sidebar today has heterogeneous affordance patterns. Some section headers carry inline buttons for their primary action; project headers additionally carry a right-click menu for secondary actions; three section headers (pinned, flat conversations, remote-desktop) have no affordances at all; conversation rows carry a right-click menu (long-press on mobile) with up to five items; app tiles carry the same mechanic with two items. This shape normalizes all of it to one pattern: a kebab menu holding every action, revealed on hover on desktop and always-visible on mobile. Right-click and long-press as entry points are retired across the sidebar — the kebab becomes the sole gesture. Sections and rows with zero actions get no kebab. The remote-desktop section header, which still carries older typographic styling that the other section headers have been migrated away from, is normalized to match.

## Shape

A single shared kebab affordance across every sidebar surface that has at least one action to offer:

- The apps section header.
- Each project section header.
- Every conversation row (identity-backed, relay-room, fleet-only).
- Every remote-desktop row.
- Every app tile.

Visual language is the shared primitive — same icon shape, same prominence, same chip background on both headers and rows. There are no per-surface visual variants of the kebab.

Reveal behavior: hover-reveal on desktop (the kebab appears when the user hovers the parent header or row and disappears when the pointer leaves); always-visible on mobile (no hover state exists on touch). When a menu is open the kebab stays visible until the menu dismisses, regardless of hover.

Pinned, flat-conversations, and remote-desktop section headers get no kebab — they have zero actions, so a kebab would be noise.

Right-click on the desktop and long-press on mobile are retired entirely as sidebar entry points. The kebab tap or click is the sole way to open the menu. Any machinery today that opens the context menu on those gestures is removed from the sidebar surface.

The kebab menu preserves the drill-in submenu for the move-to-project action (project list with the currently-assigned project checked, followed by "remove from project" if the row is currently assigned). Flattening every project to a top-level kebab item would scale badly with many projects.

The remote-desktop section header's typographic styling is corrected to match the other section headers' current treatment: title-case label (not uppercase, no letter-spacing), warmer color matching the apps/pinned/projects/conversations headers, and matching icon weight.

### Per-surface kebab contents

What moves into each kebab, drawn from today's inline buttons and context menus:

- **Apps section header kebab:** archived-apps.
- **Project section header kebab:** new-conversation-in-this-project, edit-project-file, archive-project (danger-styled).
- **Pinned / flat-conversations / remote-desktop section headers:** no kebab.
- **Non-remote-desktop conversation row kebab:** pin or unpin, open-in-new-window (desktop only, and only when the row is URL-addressable), move-to-project (drill-in submenu as described above), kill (danger, gated to rows without an identity-backing where the gesture is appropriate), archive (danger, gated to identity-backed rows).
- **Remote-desktop row kebab:** pin or unpin, open-in-new-window.
- **App tile kebab:** open-in-new-tab, archive (danger).

## Philosophy

One affordance, one place. The sidebar today scatters actions across inline buttons, right-click menus, and long-press on mobile; the normalization makes the kebab the single reachable surface so there is nothing hidden and nothing to re-learn per surface.

Hover-reveal keeps the sidebar visually clean when the user isn't acting on a given row or header. The clutter cost of always-visible row kebabs across a long sidebar is the problem being avoided; the kebab appears exactly when the user's pointer is positioned to use it. Mobile pays a small visual-cleanliness cost by making the kebab always-visible, because there's no hover state — that's an unavoidable tradeoff.

The kebab visual is a single primitive, not a per-surface skin. If the apps header kebab and a conversation row kebab look different, the user has to re-learn the affordance each time. One look, one gesture.

Sections with no actions deserve nothing — a kebab-with-no-items would be noise, and a kebab-with-empty-popup would be worse. The sidebar reads correctly only when the presence of a kebab tells the user that there IS something to do.

No carve-outs in this shape. The entire pattern lands uniformly first; if any specific action feels wrong buried in the kebab after shipping (the archived-apps affordance introduced by this campaign's previous shape is a leading candidate), that is a follow-up conversation after the normalization is in daily use. Carving out one case before the uniform baseline is established would re-fragment what this shape exists to normalize.

## Prior context

The previous shape in this campaign (shape-unarchive-frontend-backend) introduced the archived-apps affordance as an always-visible inline button on the apps section header, following the per-project new-conversation inline button that existed before it. This shape moves both of those inline buttons into the kebab — the deliberate reversal is the point of the normalization. Both are leading candidates for the "pull back out as an exception" follow-up discussion after this ships.

The row-level kebab primitive already exists in the codebase. It was built as part of this campaign's previous phase of work for the three un-archive modals (the archived-apps modal, the roles-list modal, and the conversation-search modal), where it is already in production as the standard always-visible row affordance on modal rows. The sidebar extension reuses the same primitive.

A peer box-maintainer identity (Jinx) has an in-flight update to that shared primitive, improving visual prominence, redesigning the menu surface styling, and fixing a load-bearing portal-click-containment bug where menu-item onClicks were leaking to parent row onClicks (symptom seen during use: a row behind an archive-confirm dialog opening when the confirm was dismissed). That update is pending the user's greenlight and will land before this shape's execution. The portal-click-containment fix is directly load-bearing for this shape — every sidebar kebab is nested inside a clickable row or header, so without the fix every sidebar kebab becomes a trap.

The remote-desktop section header's older typographic styling is a leak from before the other section headers were migrated to the current treatment. No prior shape explicitly covered it; this shape absorbs the correction.

## What would make it wrong

- A kebab appearing on a sidebar surface that has no actions to put in it. The presence of a kebab must mean something; a kebab-no-ops teaches users to ignore the affordance everywhere.
- Different kebab visuals across sidebar surfaces. The whole normalization goal is the single learnable affordance; a per-surface skin defeats it.
- Right-click or long-press continuing to work on any sidebar surface after this ships. Hidden alternate gestures mean the normalization isn't real — users who know the old gesture never discover the new one, and the surface stays functionally bifurcated.
- Kebab-item onClicks leaking through to the parent row's onClick (the exact bug the peer-agent fix in the shared primitive addresses). Without portal-click-containment, every sidebar kebab is worse than the context menu it replaces.
- A migration that forgets to remove the previous inline button or right-click wiring from a surface — leaving two gestures mapped to the same action. Every surface the shape touches must be a clean removal, not an accumulation.
- Mobile users unable to reach a sidebar kebab because it rendered hover-only. Always-visible on mobile is a load-bearing invariant, not a nice-to-have.
- Sidebar search leaving an empty kebab-bearing section header visible when all its rows filter away. The existing "sections with zero visible rows disappear entirely" rule should continue to apply unchanged.

## Scope edges

**In:**
- Apps section header kebab (replacing the inline archived-apps button).
- Each project section header kebab (replacing the inline new-conversation button and the right-click secondary-action menu).
- All non-remote-desktop conversation row kebabs (replacing the row's right-click + long-press context menu).
- All remote-desktop row kebabs (same replacement).
- All app tile kebabs (replacing the tile's right-click context menu).
- Full retirement of right-click and long-press as context-menu entry points on every sidebar surface the shape touches.
- Remote-desktop section header typography correction (matching the other section headers' current treatment).
- Id-skill substrate edits documenting the sidebar normalization (sidebar sections, right-click retirement, kebab-as-single-affordance) in the same session the code lands. Standing distribution rule applies: edit the substrate source, not the distributed copy.

**Out:**
- Modal rows in the three un-archive modals already use the kebab pattern from the previous phase of this campaign — untouched.
- The conversation-view's own context menu and its badge right-click (upper-right of the open conversation) — out of scope for this shape; separate surface, separate conversation if normalizing it is worthwhile.
- The sidebar footer gear button and the sidebar-header icon cluster (pencil, folder-plus, drama-masks, clock, kebab-menu) — those are not section-header affordances; out of scope.
- Any other context menu in the app that isn't on a sidebar surface.

**Deferred:**
- Carve-outs. Any action that feels wrong buried in the kebab after shipping (archived-apps and new-conversation-in-this-project are the leading candidates to re-examine) is a follow-up conversation, not part of this shape. The uniform baseline lands first.

**Tempting but no:**
- Keyboard-focus-also-reveals the kebab. The right default for accessibility (focus-within on the parent revealing the kebab in parallel with hover) is an implementation detail of the hover-reveal mechanism, not a shape decision — bake it into the implementation without surfacing it as a shape item.
- Rebuilding or forking the row-kebab primitive. The shared primitive is correct; reuse it exactly.
- Normalizing other sidebar visual inconsistencies spotted along the way. The remote-desktop header typography fix is the one case in scope here because it's a header-affordance pattern leak that landed in this shape's path by discovery during taste; broader sidebar typography is a different conversation.

## Vehicle notes

Vehicle: inline. User's explicit call. Pieces of work tracked via harness tasks across the following roughly-sequenced steps:

1. Pull the peer agent's updated row-kebab primitive from origin once it lands.
2. Apps section header: inject the kebab, migrate the archived-apps affordance into it, remove the inline button and its related state wiring.
3. Project section header component: inject the kebab, migrate the new-conversation-in-this-project and the two right-click items into it, remove the inline button + the right-click handler + the long-press touch-timer, and clean up the component's unused props. Test file updates to match.
4. Conversation row component: inject the kebab in the row's right-side slot, migrate every current context-menu item into it, remove the right-click handler + the long-press touch-timer + any related state. Test file updates to match (including the row-level long-press tests).
5. App tile component: inject the kebab, migrate the two context-menu items into it, remove the right-click handler. Test file updates to match.
6. Remote-desktop section header typography correction (icon size, color, label textCase, letter-spacing).
7. Id-skill substrate edits: update the sidebar sections documentation to describe the kebab-as-single-affordance pattern, remove the right-click menu descriptions, note mobile always-visible behavior.
8. Scoped vitest runs on every touched surface at commit boundaries.

Deployment coordination carries over from the campaign's prior sessions:
- Deploy boundary stands: commits are pushed per fleet rule, but `docker compose build` + `--force-recreate` requires a separate per-deploy greenlight.
- The previous session's inline correction (shape 4 declaration + matrix-cred-location fix) + the peer's incoming row-kebab-primitive update are both already undeployed on this branch. This shape's commits will ride into the same next deploy.
- `git pull --rebase origin feat/tab-title-from-tmux` before every push and before every docker build (standing multi-identity rule).
- No worktrees; all work on `feat/tab-title-from-tmux`.
