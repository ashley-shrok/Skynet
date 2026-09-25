# Shape: Sidebar header/footer redesign

**Opened:** 2026-09-25
**Vehicle:** Inline — carefully, chunked commits, Ashley in-loop between chunks

## What this is

The conversation-list sidebar has one busy zone at the top — a row of icon buttons that has grown every time a new capability shipped. This redesign gives the sidebar a second zone at the bottom, a footer, that carries "things about me, the person using this." A few items migrate down (global files today, preferences later), leaving the top with only the things about acting on the conversation list itself. The top gets re-laid-out with the smaller set, given more room to breathe.

## Shape

Two zones instead of one.

**The top zone** is about acting on the conversation list — searching it, starting a new conversation in it, creating a project in it, checking or setting a wake-up, sending feedback about the app, and a catchall menu for less-common actions. Order: search, then the creation actions (new conversation, then create project), then wake-ups, then send feedback, then the catchall menu.

**The bottom zone** is about the person using the app. It's anchored by an initials circle in warm tan with the username next to it, followed by two icons: the global files affordance (files all of Ashley's agents see), and a placeholder for user preferences (rendered visibly but inert until the preferences service ships in a follow-on shape). The initials circle is decorative for now — no click behavior, no pointer cursor, no hover treatment.

**The catchall menu** hides three items that don't warrant top-level slots: create a group conversation, edit shared skills, edit shared roles. Order within the menu: new group conversation, then edit shared skills, then edit shared roles.

Both zones adopt the same visual treatment: same padding, same border-color, same typography, same button chrome. The footer mirrors the header's bottom hairline with a top hairline of its own. On mobile, sizes scale up per the existing app pattern.

## Philosophy

Two zones, two purposes. The top is action on the conversation list; the bottom is about the person. This split is what makes future crowding reversible — new capabilities can find the zone that matches their nature instead of piling onto whichever zone has room today.

Nothing that isn't real gets faked. If a click leads somewhere that doesn't exist yet (the initials circle, the preferences gear), it doesn't get a pointer cursor or hover treatment. Nothing lies about what's clickable.

The logo lockup at the top-left stays exactly as it is — small icon, wordmark, home-link behavior. That's part of the app's brand identity; the redesign works around it, not through it.

This is a step, not the destination. Ashley has a longer-term vision for this area that goes beyond what's in this shape. What's here should feel coherent as an interim state — not perfect, not final, but a clear improvement on today.

## Prior context

Before this redesign, the top zone holds seven items when everything is enabled: search, new conversation, create project, edit shared roles, edit global files, wake-ups (newly added by a peer identity mid-session), send feedback, and the catchall menu — plus the weekly usage meter underneath (admin-only). The catchall menu holds two items: new group conversation, edit shared skills. There's an existing hard-order rule on that pair; no one is allowed to reshuffle those two.

Every new capability has been landing in the top zone because it's the only zone available. The result reads visibly noisy, and there's no obvious rule for where a new capability belongs.

Two of the top-zone items are moving as part of this redesign: the global files affordance (down to the footer, because it's user-scope), and the edit-shared-roles action (into the catchall menu, because it's an occasional-use action that pairs semantically with edit shared skills). Nothing else moves. Send feedback stays visible because visible feedback matters during the beta the app is currently in.

The weekly usage meter stays exactly where it is — inside the top zone, below the button row. It's arguably about the person, but it also carries context (rate limits) that reads better next to the actions that trigger requests.

The mobile view of the sidebar scales button sizes up per an existing app pattern; the footer inherits the same pattern. The tasting discovered a runtime injection artifact where mobile footer placement got clipped by the sidebar's own clipping behavior — this is a tasting-time issue, not an implementation-time one, but the underlying layout constraint may still need a small touch so the footer sits naturally in the sidebar's vertical stack on mobile without needing a viewport-fixed escape hatch.

The project this ships to is the app's beta, not the primary distribution. Beta context matters for the send-feedback decision.

## What would make it wrong

- If the bottom zone starts to feel like "a place for miscellaneous stuff that didn't fit above." It's specifically about the person. Anything that goes there needs to earn its place by being about the user, not by being homeless.
- If the initials circle or the preferences gear develops a hover treatment or a pointer cursor without preferences being real. Faking clickability is the failure mode this shape rejects.
- If the top zone's re-lay-out is subtle enough that Ashley can't tell it's been decrowded. The point is a felt change; if it lands as invisible polish, the redesign missed.
- If the logo lockup gets replaced by text, moves elsewhere, or shrinks meaningfully. It's a fixed point.
- If the mobile treatment quietly hides the footer or renders it differently in a way that leaves mobile users without access to global files. Mobile users get the same affordances as desktop users, at the scaled size the app already uses.
- If the existing hard-order rule on the catchall menu's original pair is disturbed. The new item goes at the end of the menu; the existing pair stays exactly as it was.
- If the beta rationale for send-feedback's visibility gets lost as a note, and a future maintainer moves send feedback back into the catchall menu without realizing why it was surfaced.

## Scope edges

**In:**
- The two-zone split — top zone keeps its purpose, bottom zone is new.
- Global files migrates from top to bottom.
- Edit shared roles migrates from top to the catchall menu.
- Catchall menu gains one item; existing pair keeps its order.
- Wake-ups stays as a visible top-zone button, positioned before send feedback.
- Footer contains: initials-circle anchor + username + global files + inert preferences gear.
- Same visual treatment (padding, tokens, chrome) as the header.
- Mobile scaling per the existing app pattern.
- Test updates for the moved buttons' identifiers.

**Out (this shape):**
- The preferences modal and any actual preferences that live inside it. That's a follow-on shape.
- A user-avatar concept beyond initials — the app doesn't have per-user avatars today, and inventing one is not what this shape is about.
- Any change to what a click on the anchor does (nothing, for now).
- Any change to the weekly usage meter's position or behavior.
- Any change to how send-feedback is gated (still per-user via existing gating).
- Any restructure of the top zone's cluster spacing beyond removing two items and slotting the new one in — no separators, no compact-mode, no combo-plus affordances.

**Deferred (next shape):**
- Real preferences modal, with at least a TTS voice picker as the first setting. This is the shape that wires up the gear.

**Tempting but no:**
- Reducing the top zone further by folding wake-ups or feedback into the catchall menu.
- Moving the logo, changing the wordmark, or repurposing the home-link.
- Inventing a user-avatar concept just because the anchor slot exists.
- "Fixing" the tasting-time mobile clipping by escaping the footer to the document root in the real implementation. The real implementation should make the sidebar's layout accommodate the footer naturally.

## Vehicle notes

Inline in this session, carefully. Ashley picked inline over a phase because the shape is fully defined and the change surface is bounded — one main sidebar component, one stylesheet, several test files. Tradeoff accepted: no phase-planner review, no automatic parallelization; Ashley and I stay in the loop between chunks.

Ship plan:
- This shape file is the first artifact.
- An internal task list for the change chunks so nothing gets missed.
- Atomic commits by logical chunk: footer stylesheet scaffold → footer markup in the sidebar → top-zone button removals and reorder → catchall-menu reorder and guard-comment update → test updates.
- Scoped tests after each chunk using the standard scoped-test pattern for touched files.
- Stop at commit. No push, no build, no deploy without Ashley's explicit "push it" / "ship it" per fleet rule.
- Pivot to a phase if scope reveals itself larger than this shape — e.g., a peer identity is racing the same sidebar file, or the mobile layout fix turns into a deeper restructure of the sidebar's clipping behavior.

Beta context: the identity's project pointer moved to the beta project mid-session. This redesign ships to the beta; send feedback stays as a top-zone button specifically because it's beta.

Closed with `/close sidebar-header-footer-redesign` at the end.

---

## Close-Out

**Closed:** 2026-09-25
**Vehicle used:** Inline — chunked commits (footer CSS scaffold, footer JSX + Globe migration, Edit-roles migration to kebab), Ashley in-loop between chunks
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is — two-zone split (header for acting on the list; footer for the person)** — present · Two zones exist as siblings in the panel's flex column; header keeps its action-on-the-list role, footer carries the 'about me' role
- **Shape — top zone order (search → new conv → create project → wake-ups → send feedback → catchall)** — present · Order in the DOM matches the shape exactly
- **Shape — bottom zone anchored by initials circle + username, then global files + inert preferences gear** — present · Anchor slot renders only when username is populated; actions slot always renders
- **Shape — initials circle warm tan, decorative, no pointer/hover/click** — partial · Decorative behavior is honored (no cursor, no hover), but the actual color is a cool near-white tint at 8% opacity, not warm tan — the warm-tan intention got lost
- **Shape — catchall menu holds new group conv, edit shared skills, edit shared roles in that order** — present · Three items in exactly that order; Edit roles appended as the third item after the guarded pair
- **Shape — both zones share visual treatment (padding, border-color, typography, chrome); footer top hairline mirrors header bottom hairline** — present · Footer uses matching 14px 16px padding, same border-quiet hairline on top, footer-btn is chrome-identical to header pv-pencil
- **Shape — mobile sizes scale up per the existing app pattern** — present · Footer inherits the mobile treatment: 48x48 buttons, 24px icons, 40x40 initials, 15px username
- **Philosophy — two zones two purposes; nothing that isn't real gets faked** — present · Initials circle and preferences gear both render without cursor:pointer or hover treatment; preferences uses a semantic span not a button
- **Philosophy — logo lockup stays exactly as it is** — present · No changes to the header-logo / header-wordmark markup or CSS
- **Prior context — global files migrates from top to bottom** — present · Header Globe removed; footer Globe rendered with the new pv-footer-global-files-button test-id, click still opens GlobalFilesModal
- **Prior context — edit shared roles migrates into the catchall menu** — present · Header Edit-roles button retired; menu item appended as third entry
- **Prior context — send feedback stays visible (beta rationale)** — present · Button stays top-level, gating unchanged; the 'beta rationale' phrasing in the shape was a misread — real rationale is 'feedback should always be available'
- **Prior context — wake-ups stays visible in top zone, before send feedback** — present · Wake-ups renders between create-project and send-feedback
- **Prior context — weekly usage meter stays where it is** — present · No changes to usage-meter placement or gating
- **Prior context — hard-order rule on original catchall pair preserved** — present · New group conversation then Edit global skills — pair kept intact; Edit roles appended after them, deliberately not extending the guard to the third item
- **What would make it wrong: bottom zone becomes a miscellaneous drawer** — present · Footer holds only the anchor, global files (user-scope), and preferences placeholder (user-scope) — no non-user items snuck in
- **What would make it wrong: initials circle or preferences gear develops hover/pointer while inert** — present · Initials has no cursor and no :hover rule; preferences gear has cursor:default and its hover rule zeroes out all hover effects
- **What would make it wrong: top zone re-lay-out too subtle to feel decrowded** — drifted · Endorsed — decrowding-by-subtraction alone was Ashley's intent, consistent with the Out list excluding cluster-spacing changes
- **What would make it wrong: logo lockup replaced/moved/shrunk** — present · Logo markup and CSS untouched
- **What would make it wrong: mobile hides footer or leaves mobile users without global files** — present · Mobile media query bumps footer sizes; footer is a flex-shrink:0 sibling in the panel column, same as the header
- **What would make it wrong: existing hard-order rule on catchall's original pair disturbed** — present · Original pair keeps its order; guard-comment updated to note Edit roles was appended as the third item and the guard does NOT extend to it
- **What would make it wrong: beta rationale for send-feedback lost as a note** — drifted · Endorsed — the shape's beta framing was a misread; real rationale is general (feedback always available), no code note needed
- **Scope edges — In: two-zone split, migrations, catchall gains one item, wake-ups position, footer contents, matched visual treatment, mobile scaling, test updates** — present · All In items present in the material
- **Scope edges — Out: preferences modal not built; no avatar concept; anchor click still does nothing; usage meter untouched; send-feedback gating unchanged; no header cluster-spacing changes** — present · Nothing on the Out list crept in; preferences gear is a placeholder span; anchor has no onClick; no avatar work
- **Scope edges — Deferred: real preferences modal (next shape)** — present · Correctly left unbuilt
- **Scope edges — Tempting but no: no folding of wake-ups/feedback into catchall; no logo changes; no invented avatar; no viewport-fixed escape hatch** — present · Footer sits naturally in the panel's flex column, not fixed to the viewport

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Initials-circle background is a cool near-white tint, not warm tan — fix to actually render as warm tan — issue
- Send-feedback button's inline position comment is stale (says 'fifth of six, after Globe') — Globe migrated to the footer; update the note so a future maintainer isn't misled — issue

### Notes

Two clean commits split the work well (CSS scaffold → JSX + Globe migration → Edit-roles kebab migration), and test updates are proportionate to the surface change. One code-hygiene observation worth carrying forward: the header's enumeration block-comment (numbered 1..8) survived through several shape changes accumulating staleness — after each header-composition shape, that enumeration comment needs a pass, or it should be retired in favor of individual per-button comments. The stale send-feedback position note is the same category. Also worth noting: the shape's 'beta rationale' framing for send-feedback was itself a shape-time misread — a useful reminder that shape rationales sometimes describe an intent-adjacent story that isn't the real one, and close-out is the moment that surfaces.
