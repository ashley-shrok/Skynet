# Shape: Split role-level tabs out of the identity modal into their own role modal, reached from a new roles-list surface

**Opened:** 2026-09-09
**Vehicle:** GSD phase
**Bounty:** ~/.claude/roles/box-maintainer/bounties/role-management-modal-split/

## What this is

Today the identity modal — the thing you get from clicking an identity's badge — pools two scopes behind a segmented switch at the top: role scope and identity scope. Role scope carries four tabs; identity scope carries three. This build peels the role side out into its own dedicated role modal, addressed by role name rather than by identity, and adds a new roles-list surface as the front door to it.

The identity modal simplifies as a result — no more scope switch, no more role-scope tabs. It becomes purely identity-scoped. A small clickable treatment on the identity's title line (immediately under its display name) becomes the shortcut back up to the identity's own role, so the fast path from "editing this identity" to "editing this identity's role" is preserved.

## Shape

Three surfaces move. Two are new; one loses weight.

The **roles-list modal** is a new modal reached from the conversation-list three-dots menu, via a new "Edit roles…" entry. When opened, it shows every role in a vertical list. Each row is rendered in the same visual language as a conversation-list row — a tinted glass rectangle in the role's own colour, carrying the role's 40px round avatar, its pretty display name, and a subtle right-side chevron. Rows are alphabetical. Clicking a row closes the list and opens the role modal for that role (swap, not stack). A "+ New role" affordance sits in the modal's own header so the list surface is also where roles get created; the separate top-level "New role" entry in the three-dots menu goes away.

The **role modal** is a new modal that owns everything that used to live in the identity modal's role-scope tabs — the role file, runbooks, bounties, and wake-ups — but is addressed by role name and carries no identity context. Its chrome is tinted with the role's own hue, matching the row that opened it, so the visual thread from the list carries into the modal.

The **identity modal** loses two things: the top segmented scope switch, and the four role-scope tabs beneath it. It keeps identity file, wake-ups, and Telegram — the three identity-scope tabs it already carries. To preserve the fastest path from an identity to its role, the identity's title line (the small subtitle under its display name) gains a clickable treatment — a dotted underline in a slightly brighter tone, a chevron after the text, brighter and solid on hover. Clicking it closes the identity modal and opens the role modal for that identity's role. When an identity has no title set, the treatment lives on the display-name line instead. From the list, or from an identity, the role modal opens in the surface that made sense for how you got there — full-viewport when opened from the panel-header menu, in the pane's chat region when swapped in from the identity modal.

Behind these three surfaces sits one supporting piece: a way to enumerate every role on the box, along with each role's cosmetic frontmatter (avatar, hue, display name). The roles-list modal reads from that. Roles are expected to carry their own avatar and hue at role scope going forward — this build treats role-level cosmetics as first-class rather than as inheritable defaults for identities to fall back on.

## Philosophy

The load-bearing move here is separating "which identity are you looking at" from "which role does that identity hold." Today they're conflated inside one modal, and the segmented scope switch is the seam. That seam works but it hides the split behind a UI toggle — a wearer of a role has to know to flip scope, and a person browsing the fleet has no way to look at roles as first-class things at all. Splitting them into two modals makes both concepts visible at the top level.

The roles list is a **directory**, not a dashboard. It answers "which role" — nothing more. Rows carry only what's needed for recognition and routing: avatar, name, chevron. State of the fleet (bounty counts, identity counts, activity glances) does not live here; those belong to whatever surfaces already show them, or to later refinements once the routing shape settles. Getting recognition right is the whole job of this surface, which is why the rows adopt the same visual language as conversation-list rows — they're the shape you already scan every day.

The role modal is a **role-scope workspace**, not an identity-adjacent addendum. It doesn't need to remind you which identity you came from, and it doesn't carry identity-scope tabs. Its hue is the role's hue. Its content is the role's content.

The identity modal, once it drops the scope switch, is a **pure identity surface** — the thing this identity IS, plus the pointer up to the role it holds. The title-line treatment is deliberately quiet: it's a way home to the role, not a headline; the identity is still what the modal is about.

What would violate the spirit: turning the roles list into a dashboard; giving the role modal an identity picker; wiring the identity modal's title line to anything other than the role modal; adding a way to edit role scope from inside the identity modal after the split.

## Prior context

The identity modal already contains two scoped worlds today — the segmented switch on top flips between role tabs and identity tabs. Role scope has role file, runbooks, bounties, and wake-ups. Identity scope has identity file, wake-ups, and Telegram. The Runbooks tab was added recently under role scope; History and Handoff were dropped in the same pass. The scope memory is persisted per-identity so the wearer's last scope choice re-lands them there. This build's move is to elevate that same split from an intra-modal scope switch to a between-modals separation.

The three-dots menu at the top of the conversation list already carries four items — New agent, New role, Edit global files…, Edit skills… — with a matching visual chrome for its portalled entry list. This build inserts "Edit roles…" alongside those and removes "New role" once its capability lands inside the roles-list modal itself.

Role-level cosmetic fields (avatar, hue, display name, voice, title) already have first-class support in the identity file's frontmatter contract — identities inherit from the role when their own field is null, and the resolution flow is well-established. Some role files on this box carry these fields; some don't. The intent is that they always do. This build treats their presence as expected; the roles list reads them straight and falls back to a neutral placeholder only in the edge case of a hand-broken role file.

Avatars are managed by the fleet's avatar-flow runbook — that pipeline doesn't change here; only the surfaces that display them do.

## What would make it wrong

If a person opens the roles list and doesn't immediately recognise which role is which by its face and colour — the recognition-first goal has failed. This is why the row treatment matches conversation-list rows: it's the shape the eye is already trained on.

If the identity modal's title-line treatment is either invisible (people don't know they can click it and end up going through the three-dots menu instead) or too loud (it competes with the identity's name for attention), it has missed the point. The treatment is a way home, not a headline.

If the role modal ever needs to remember which identity you came from — a "back to Tabitha's identity" button, a persistent identity chip, a preserved scope memory — the split has been done wrong. The role modal is role-scope. Getting to it from an identity is a jump, not a nested navigation.

If any state that used to live in the identity modal's role scope goes missing after the split — a bounty that was visible under role scope but isn't in the new role modal, a wake-up that vanished, a runbook that isn't reachable — the move has lost content. The role modal must be a complete home for role-scope content, not a subset.

If clicking a row in the roles list stacks (opens the role modal on top of the still-open list) instead of swapping (closes the list, then opens the role modal), the surface has gained a nesting level that isn't warranted. One modal at a time.

If the role modal's chrome hue diverges from the row that opened it — a Box Maintainer row rendered in magenta-pink leading to a role modal in cool teal — the visual thread is broken. The modal carries the same hue the row did.

## Scope edges

**In scope.** The three surface changes (roles-list modal, role modal, identity modal refactor); the "Edit roles…" menu entry replacing "New role" in the three-dots menu; the "+ New role" affordance inside the roles-list modal; the title-line clickable treatment inside the identity modal; the enumerate-all-roles-with-cosmetics supporting piece behind the roles list; the swap-not-stack transition when a row in the list is clicked; the role modal's role-hue chrome; tests across the touched UI + the new supporting piece.

**Out of scope.** No changes to what content lives inside the role-scope tabs — the role file, runbooks, bounties, and wake-ups render the same content they render today, just under a role modal chrome instead of an identity modal scope. No changes to identity-scope tabs. No changes to the avatar-flow runbook. No changes to how role-level cosmetics are edited today (existing editors move with the tabs; no new editor UI for role-level avatar/hue in this phase — the presence of the fields is what's assumed, editing is untouched).

**Deferred.** Enriching the roles-list rows with state (identity counts, bounty glances, activity indicators) — the directory-not-dashboard stance is deliberate here, but a later refinement pass could add subtle right-side glances once the routing shape has settled and the recognition pattern is confirmed. Search inside the roles list — with typical fleet size (~10 roles) it's not warranted; if the list grows past ~20 the calculus changes.

**Tempting but no.** No "recently active" sort order — alphabetical is predictable and matches how people refer to roles. No "role picker chip" inside the identity modal beyond the title-line treatment. No sync of last-viewed role between the identity modal's jump-to-role and the roles-list's next open — each entry point is independent.

## Vehicle notes

This is a phase, not a quick. Multi-file work: two new modal components (roles-list and role), a refactor of the existing identity modal (drop scope switch, drop role-scope tabs, add title-line treatment), a new entry in the conversation-list three-dots menu, a new supporting piece to enumerate roles with their cosmetics, and tests across all of the above. Backend-touching (the enumerate-roles piece), visually substantive (hue-tinted role modal, swap-not-stack transitions, conversation-row-treatment rows), and data-model adjacent (formalising role-level cosmetics as expected).

Working identity: **tabitha** on t1000. Bounty workspace lives at `~/.claude/roles/box-maintainer/bounties/role-management-modal-split/`. The design tasting mocks are served at `http://t1000:8898/index.html` (static HTML on the tailnet) and remain a useful visual anchor through implementation — Shape 1 with the conversation-row treatment is the locked reference for the roles-list rows.

Two console snippets exist from the shape-tasting conversation for the identity-modal side:
- one that hides the scope switch and adds a pill (Ashley redirected away from this shape),
- one that hides the scope switch and decorates the identity's title line as clickable (this is the locked treatment).

Both live in the /open transcript; the second is the reference for the identity-modal side of the build.

Related side-effect the phase should handle: the "New role" entry in the three-dots menu is retired in this phase, so any existing tests that assert its presence need updating (there is one, per the recent Phase 88 drift commit).

Auto-proceed from vehicle-pick into `/gsd:discuss-phase` per the build skill; use this shape file as the seed for CONTEXT.md rather than re-eliciting the discovery.
