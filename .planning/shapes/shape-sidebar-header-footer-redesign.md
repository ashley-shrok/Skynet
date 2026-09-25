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
