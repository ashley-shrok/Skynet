# Phase 124: user-feedback campaign shape 2 — general "Send feedback" button - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `124-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-09-19
**Phase:** 123-user-feedback-campaign-shape-2-general-send-feedback-button
**Areas discussed:** Placement, Visual weight, Load-time flash, Mobile treatment, Icon, Vehicle

---

## Note on discovery path

Discussion for this phase happened during the `/open` beat of `/build shape-feedback-general-button`, not during `/gsd:discuss-phase`. Per the build-skill rule ("if the vehicle is a GSD phase, seed CONTEXT.md from the shape file — don't re-elicit ground /open already covered"), discuss-phase generated `124-CONTEXT.md` directly from `.planning/shapes/shape-feedback-general-button.md` without re-asking the user.

The log below summarizes the /open grill exchanges verbatim in outcome. See the shape file itself for the full picture; see `campaign-user-feedback.md` for cross-shape arc.

---

## Placement — where in the app shell does the button live?

| Option | Description | Selected |
|--------|-------------|----------|
| Top-bar corner (near settings) | Always in view, formal register, app-level feel | |
| Sidebar footer (near identity badge) | Quieter, meta register, doesn't compete with chat surface | |
| Overflow menu behind ellipsis | Deeply discoverable-but-not-loud, least visual weight | |
| Floating action button (bottom-right) | Most discoverable, most visually loud | |
| Conversation-list header row (peer to create-buttons) | Sits alongside new-conv / create-project / edit-roles / edit-global-files / kebab | ✓ |

**User's choice:** Conversation-list header row, as a new peer to the create-buttons.
**Notes:** Ashley: "i think right now it should just be added to the button that are at the top of the conversation list where you can make new conversations or new projects etc and so this one should be a pretty easy add and we won't even need a taste testing." Locked D-01 + D-02. Tasting page skipped since placement was picked before discussion needed alternatives.

---

## Visual weight — does the button match its siblings or stand quieter?

| Option | Description | Selected |
|--------|-------------|----------|
| Full peer | Same icon size, same button chrome, same visual weight as create-siblings | ✓ |
| Deliberately quieter | Smaller icon, less contrast, tucked at end — "…and there's also this" | |

**User's choice:** Full peer.
**Notes:** Ashley: "your choice" → then "it's just another button being added up there and the reason i'm not being particular is because i'm going to redesign the whole header pretty soon anyway." Locked D-04 + D-22 (no differentiator styling). Steer captured for planner: header is getting redesigned soon, don't gold-plate — match `.pv-pencil` class + 18px icon exactly.

---

## Load-time flash — how to handle the pop-in while the enabled signal resolves

| Option | Description | Selected |
|--------|-------------|----------|
| Accept the pop-in | Same as shape 1 hide-when-unconfigured lock — brief flash on configured deployments | ✓ |
| Reserve space, fade the button in | No layout reflow; button fades from invisible to visible when signal resolves | |
| Always render, disable on click if not resolved | Never a flash; click before signal resolves is a no-op | |

**User's choice:** Accept the pop-in.
**Notes:** Locked D-13. Matches shape 1's discipline; the fetch usually resolves in tens of milliseconds so the flash is nearly imperceptible; reserving space is over-engineering for something about to be redesigned.

---

## Mobile treatment — does the button appear on mobile? Does the modal need tweaks?

| Option | Description | Selected |
|--------|-------------|----------|
| Same as desktop, no special handling | Header row is structurally identical on both variants; button appears identically | ✓ |
| Mobile-specific home | Different placement on mobile (e.g., in a menu) | |
| Desktop-only for v1 | Button doesn't appear on mobile at all | |

**User's choice:** Same as desktop.
**Notes:** Ashley: "yeah i mean maybe you should take a look at it but i don't think mobile would be any different." Verified: `PrettyConversationsPanel.tsx` header row is structural variant branch (`variant: "mobile" | "desktop"`) but same content — five icon buttons on both. Adding a sixth is a paste-alike. Locked D-14 + D-15. Modal is Radix Dialog with responsive default — no shape-1-adjacent tweaks needed.

---

## Icon — which lucide-react icon fits "Send feedback"?

| Option | Description | Selected |
|--------|-------------|----------|
| `MessageSquare` | Speech bubble, reads as user-to-app communication | ✓ |
| `Send` | Paper-plane, reads as "send it out" | |
| `Megaphone` | Reads as "tell us" | |
| `MessageCircle` | Softer variant of speech bubble | |
| `Mail` | Reads as "email" — gives away the transport mechanism | |

**User's choice:** `MessageSquare`.
**Notes:** Matches the tone of the row (all abstract activity icons, not literal transport icons). Locked D-03.

---

## Vehicle — how does this work get done?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Do it right now in this session, no pipeline | |
| Plan mode | Single planned change | |
| GSD quick | One small tracked task | |
| GSD phase | Full pipeline (phase → discuss → plan → execute → close) | ✓ |
| Bounty | Park it, not building now | |

**User's choice:** GSD phase.
**Notes:** Consistent with shape 1's vehicle (Phase 122); follows the fleet rule that phase-shaped work uses a phase; integrates with campaign artifact tracking. Likely a single plan (much smaller than shape 1's 4 plans across 2 waves), but the framework still earns its place.

---

## Open questions raised during /open (all resolved)

1. **Role gating** — should the button be gated on user role? → **No gating in v1**, locked D-16. Skynet auth has no operator-vs-user distinction; deployments where this matters have small trusted user pools.
2. **Ordering within the row** — where in the row does the button sit? → **Position 5 of 6**, right before the kebab menu, locked D-02. My call ("your choice") since Ashley confirmed "not being particular."
3. **Divider vs no divider** between button and create-siblings → **No divider**, locked D-22. Ashley confirmed the button reads as "just another button up there."

---

## Deferred ideas (captured in CONTEXT.md deferred section)

- Role-based visibility gating (admin-only, env-flag toggle) — D-16
- Production keyboard shortcut sibling to dev chord — D-17
- Header redesign — D-21
- Rate limiting / telemetry — D-20 + shape 1 D-28
- Alternative placements (top-bar, floating action button, etc.) — rejected per D-01
