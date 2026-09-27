# Shape: Preferences modal, triggered from the sidebar footer gear

**Opened:** 2026-09-27
**Vehicle:** gsd phase (or phases — plan-phase to decide split)

## What this is

A new preferences home for the app. The gear icon that already sits in the
sidebar footer today (currently a decorative placeholder that hovers "coming
soon") becomes an actual button. Clicking it opens a preferences modal —
familiar shape for anyone who's used a modern chat app — with a left-nav of
categories on one side and content panes on the other.

The modal consolidates a handful of user-scope things that live in scattered
places today (a notifications entry that lives in the header kebab menu, a
global-files editor that has its own footer button, and a couple of preferences
the app stores but doesn't yet let the user set). It also introduces one
brand-new thing: a way for the user to upload and change their own avatar.

## Shape

The modal has four categories in its left nav:

**General.** The user's personal presence in the app. Today: their avatar.
Upload a new image, or remove the current one. When an avatar is set, it
also appears in the sidebar footer where the initials circle sits today —
initials fall back in when there's no avatar uploaded.

**Voice.** The voice their agents use to speak. Today's app uses a hard-coded
default voice whenever an agent has no voice of its own bound; this preference
lets each user pick which voice that fallback should be. Same seven voices the
existing per-identity voice picker exposes, same sample-play button pattern.

**Notifications.** The push-notifications enable button that today lives in
the header kebab menu, folded into a section of its own. Same explainer text,
same one-button interaction that fires the browser permission prompt. The
kebab entry goes away.

**About you.** The user-wide file the agents read for personal context, framed
the way modern chat apps frame their "custom instructions" section — a big
prose-styled editor where the user tells their agents about themselves, how
they work, their preferences. Uses the shared pretty markdown editor the app
already has in other file-editing surfaces (identity file, role file). Save
button on the pane, unsaved-state hint next to it. Rebranded from "global
files" because "global" only makes sense across hosts, and the vast majority
of users are on a single host — the "about you" framing matches what the
file actually is for those users.

**Rare fallbacks in the About-you pane** for the two admin-territory cases:

- When the user has more than one host, a compact host picker appears in the
  pane's top-right; single-host users never see it.
- When a host has extra files configured beyond the user-wide one, a tab strip
  appears above the editor with the "About you" file as the first tab and any
  extras named by filename after it; single-file hosts never see it.

**Save semantics.** Voice, notifications, and avatar all save implicitly on
change (the notification flow is a one-tap in-browser prompt that the user
either accepts or declines — nothing to "save"). The About-you editor uses
an explicit Save button because it's a text editor, matches how other
markdown-file editors already work in the app, and because typing while
autosave fires is a bad experience.

**Adjacent cleanups shipping with this shape:**

- The old reopen-tabs-on-login preference (a legacy holdover from the app
  this was forked from, superseded by a different mechanism, unused today)
  gets deleted from the preference row and the code paths that read/write it.
- The globe button in the sidebar footer that opens the global-files editor
  goes away. The preferences modal is the single entry point now.

## Philosophy

**Consolidate, don't proliferate.** The whole thrust is that scattered
user-scope UX collapses into one preferences home. Leaving the notifications
kebab item OR the globe button behind as shortcuts would defeat this. Every
existing entry point moves into preferences and its old surface goes away.

**Grow-ready shape from day one.** Left-nav with category panes is heavier
than needed for four settings, but the whole point of a preferences modal is
that things get added to it over time. The nav shape is the same nav shape
we use in the app's other multi-section modals; users already know it.

**Frame settings by what they DO for the user, not what they ARE in the
data.** The user doesn't know or care that agents can have their own voices
bound — the setting is "the voice your agents use to speak," not "the
fallback voice used when identity binding is null." Same reason "about you"
beats "global files": the framing is intent, not architecture.

**Only surface preferences with real user-facing behavior.** The app stores a
handful of other preferences (theme, font size, accent color, language) that
nothing in the app currently reads. They stay out of the modal until they
actually do something — putting inert toggles in a preferences panel would
repeat the same "coming soon" lie the gear placeholder was making.

## Prior context

The gear button is already there in the sidebar footer, deliberately built as
an inert placeholder with comments in the code that literally reference a
"follow-on shape" — this is that shape.

Voice today is bound per-identity and per-role through their own editing
modals. When an agent speaks a message, the backend uses the voice the
identity has bound, or a hard-coded default if it doesn't have one. That
default is what the user preference now overrides.

The notifications enable flow is a small modal today, opened from the header
kebab menu — a paragraph of explainer text plus one button that fires the
browser's permission prompt and registers a push subscription. The interior
is small enough to inline into a preferences pane cleanly.

Avatar backend is fully built already (upload endpoint, on-disk storage, DB
pointer). The only missing piece is a user-facing way to change your own
avatar, which is what this adds.

Global files is really the user-wide personal-context file (the file every
agent reads on startup), even though the config schema allows for multiple
files per host and multi-host setups. On the live production Skynet the
user actually runs, every host has exactly one file configured, and it's
the user-wide file. The multi-file abstraction exists but is 100% unused.

The old reopen-tabs preference is a holdover from the codebase this was
forked from. A different mechanism drives that behavior now; the old
preference is dead weight in the row.

## What would make it wrong

- If the preferences modal ends up feeling like a scaffolding for future
  settings rather than a home for real ones, this has missed the point. The
  four sections today should each feel deliberate and honestly used.
- If any of the old entry points survive (kebab notifications item, globe
  button, decorative placeholder gear), the "consolidate scattered UX"
  thrust is undone.
- If the About-you framing is confusing on a multi-host setup where extras
  are configured — e.g. an admin sees "About you" but the tab strip shows
  three unrelated files — the fallback UI has failed. The admin should
  still be able to reason about what they're looking at.
- If the sidebar footer avatar preview doesn't stay in sync with what the
  user just uploaded (i.e. requires a page refresh to see the change), the
  "yes, that's you" feedback loop is broken.
- If any preference gets added to the modal that the app doesn't actually
  read anywhere yet, we're repeating the "coming soon" lie the gear
  placeholder was making.
- If the voice fallback doesn't actually take effect for messages spoken
  from voice-less agents — i.e. the preference is stored but the backend
  still resolves to the hard-coded default — the whole voice section is
  cosmetic.

## Scope edges

**In:**

- New preferences modal (chrome, left-nav, four panes).
- Gear button in sidebar footer wired to open it (replacing the decorative
  placeholder).
- General pane: avatar upload/remove UI + sidebar footer avatar preview
  reflecting the current avatar (initials-fallback when absent).
- Voice pane: fallback-voice picker (dropdown + sample button), stored
  per-user, applied by the speak flow when the agent has no voice bound.
- Notifications pane: folded-in version of today's enable-notifications
  modal contents.
- About-you pane: folded-in version of today's global-files editor UI,
  using the shared pretty markdown editor; rebranded and reframed.
- Fallback UI in the About-you pane for the multi-host and multi-file
  admin-territory cases.
- Removal of the notifications kebab menu entry.
- Removal of the globe button in the sidebar footer.
- Removal of the reopen-tabs-on-login preference (frontend + backend, plus
  the database column if a migration is warranted — plan-phase decides).

**Out:**

- No changes to how identity or role voice binding works.
- No changes to the backend push-notifications subscription flow, endpoint,
  or storage — only the entry point moves.
- No changes to the global-files backend routes, storage, or config file
  schema — the multi-file / multi-host abstraction stays in the code even
  though the UI reframes it.
- No changes to how avatars are stored, uploaded, or served on the backend
  — only the user-facing UI is new.
- No new preferences beyond the four named above (theme, font size, accent
  color, language stay stored-but-not-surfaced).
- No preferences-modal keyboard shortcut, no CLI, no URL-deep-link into a
  particular pane. Gear-click is the only entry.
- No changes to the identity or role editing modals, even though they also
  live in the "modal with left-nav" family.

**Deferred:**

- Any additional preferences that emerge naturally later as new user-facing
  behaviors ship. The modal is set up to accept them but this shape doesn't
  pre-scaffold them.
- Extraction of a shared "modal with left-nav" component that both this
  modal and the identity/role modals could use. Nice-to-have refactor, not
  in scope here.

**Tempting but no:**

- Adding a save button per pane for consistency with the About-you pane.
  The other panes have single-action controls where implicit-save-on-change
  is the right default; a save button would be ceremony.
- Deep-linking gear-click to a specific pane via URL/hash. Would need a
  reason.
- Making the extras-file case first-class rather than a rare fallback. The
  live config says nobody uses it; if that changes, we revisit.

## Vehicle notes

**Vehicle: GSD phase (possibly two).** The work spans backend (new
per-user preference field, delete reopen-tabs field), frontend (new modal
chrome, extract MarkdownEditor into the pane, four-section wiring, avatar
UI, sidebar footer avatar preview), and cleanup (remove old entry points).
Genuinely phase-sized per the box-maintainer role's phase-vs-quick rule.

Plan-phase should size whether this fits in one phase or wants to split
(a reasonable split: foundation shell + General/Voice/Notifications in
one phase, then About-you fold-in as its own phase given the MarkdownEditor
extraction is its own beast).

**Handoff hints for planning:**

- The gear placeholder in the sidebar footer has comments in the code
  explicitly referencing "the follow-on shape" — that's the wiring anchor.
- The push-notifications modal today has load-bearing invariants around
  when the permission-request call fires (must be synchronous inside the
  click handler); those must carry through the fold-in unchanged.
- The user-wide preferences backend row and its GET/PUT already exist —
  adding the fallback-voice slice is a schema/type addition, not new
  infrastructure.
- The About-you editor should reuse the shared markdown editor component
  the identity file and role file editors already use.
- The live production config for global-files has every host mapped to
  exactly one file (the user-wide file); the fallback UI for the extras
  case is real code but exercised only in admin scenarios.
- Tasting prototype (standalone HTML) lives at
  `~/fleet/identities/fable-box-maintainer/workspace/prototype-preferences/index.html`
  for reference — captures the agreed layout, category ordering, chrome
  treatment, and multi-host / multi-file fallback behaviors.

---

## Close-Out

**Closed:** 2026-09-27
**Vehicle used:** gsd phase (single phase, split into six sub-plans 137-01..137-06)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · New preferences modal opened from the sidebar footer gear button; consolidates avatar, voice fallback, notifications, and the personal-context file into one home.
- **Shape: General pane (avatar)** — present · Upload / remove avatar with local blob preview; sidebar footer conditionally renders avatar image when set, initials-circle when null.
- **Shape: Voice pane (fallback)** — present · Reuses the shared voice picker (same 7 voices, same sample button, same "(default)" entry); autosaves on change.
- **Shape: Notifications pane** — present · Folded-in enable flow with verbatim explainer text and the single Enable button; the browser permission-prompt fires synchronously inside the click handler.
- **Shape: About-you pane** — present · Uses shared MarkdownEditor; explicit Save button; mtime-conflict-aware save flow; rebranded blurb "Tell your agents anything you want them to know about you…".
- **Shape: About-you multi-host fallback** — present · Host picker in the pane's top-right renders only when more than one host is available.
- **Shape: About-you multi-file fallback** — present · Tab strip renders only when more than one file is configured; first tab labelled "About you" when its path matches the implicit user-wide file.
- **Shape: Save semantics** — present · Voice + notifications + avatar all save implicitly on change; About-you pane uses an explicit Save button (disabled when unchanged / in flight).
- **Shape: Adjacent cleanup — reopen-tabs preference removed** — present · Column dropped from schema, removed from routes GET/PUT, purged from open-tabs helper and app-shell/tab-url.
- **Shape: Adjacent cleanup — globe button removed** — present · Footer globe button and its modal are both gone; only the preferences gear button remains in the footer actions slot.
- **Philosophy: Consolidate, don't proliferate** — present · Both scattered entry points (kebab notifications item + footer globe) are removed; the preferences modal is the sole entry point for all four consolidated things.
- **Philosophy: Grow-ready left-nav shape** — present · Left-nav with vertical section buttons + right-pane conditional render — sized to accept future panes without shape change.
- **Philosophy: Frame settings by what they DO** — present · Voice pane blurb is "The voice your agents use to speak." — no mention of identity binding or fallback resolution. About-you blurb speaks in intent, not architecture.
- **Philosophy: Only surface real preferences** — present · Theme, font size, accent colour, language are not surfaced anywhere in the modal — the only preferences shown are the four with real behaviour.
- **Scope IN: New preferences modal chrome + four panes** — present · Modal + four pane components present with tests.
- **Scope IN: Gear button wired** — present · Footer gear button opens the modal on click.
- **Scope IN: Avatar upload/remove + sidebar footer preview** — present · Pane calls upload/remove; the pane's on-avatar-changed callback is threaded up to app-shell so the footer image/initials swap without a refresh.
- **Scope IN: Voice fallback stored per-user and applied by speak flow** — present · Fallback voice column added to schema; speak flow resolves identity voice as identity-bound ?? user's fallback ?? null before the speak call.
- **Scope IN: Notifications pane folds in old modal** — present · Preserves the synchronous permission-request invariant and the single enable-only button; unsubscribe path deliberately absent.
- **Scope IN: About-you pane uses shared MarkdownEditor** — present · Imports and renders the same shared editor identity-file and role-file editors use.
- **Scope IN: Kebab notifications entry removed** — present · Kebab menu array no longer contains the notifications entry; explicit retirement comment left in place.
- **Scope IN: Globe button removed** — present · Footer actions slot renders only the gear button; the old modal is no longer mounted.
- **Scope IN: reopen-tabs preference removed (frontend + backend + schema)** — present · Removed everywhere.
- **Scope OUT: No changes to identity/role voice binding** — present · Voice binding still per-identity / per-role via existing modals; only the fallback resolver was extended.
- **Scope OUT: No changes to push subscription backend** — present · Pane reuses the existing push-subscription helpers unchanged.
- **Scope OUT: No changes to global-files backend / config schema** — present · Pane calls existing list/read/write APIs; multi-file / multi-host schema still exists in backend.
- **Scope OUT: No changes to avatar storage/serving** — present · Uses the existing avatar endpoints built in Phase 85.
- **Scope OUT: No new preferences beyond the four** — present · No theme/font/language/accent controls appear in any pane.
- **Scope OUT: No keyboard shortcut / CLI / URL deep-link** — present · Modal is opened only by the gear-button click; no hash listener, no keyboard binding, no URL-driven pane selection.
- **Scope OUT: No changes to identity/role editing modals** — present · Identity/role modal files untouched by this phase.
- **Tempting-but-no: No per-pane save button on Voice/Notifications/General** — present · Voice autosaves per change; notifications is single-tap; general is implicit-on-upload/remove — no ceremonial Save buttons added.
- **Tempting-but-no: No deep-linking to a specific pane** — present · Active section state is local to the modal; resets on close.
- **Tempting-but-no: Multi-file case stays a rare fallback** — present · Tab strip gated on more than one configured file; single-file hosts see no tab strip.
- **What would make it wrong: Preferences modal feels like scaffolding** — present · Each of the four panes wires a real, working preference — none are stub toggles.
- **What would make it wrong: Old entry points survive** — present · Kebab notifications item + globe button both gone; the gear is now a real interactive button, not the inert placeholder.
- **What would make it wrong: About-you framing confusing on multi-host with extras** — present · The host picker + tab strip both render only in the admin-territory cases; the first tab is renamed "About you" only when it is the implicit user-wide file, so an admin still sees per-file names for the others.
- **What would make it wrong: Sidebar footer avatar doesn't stay in sync** — present · General pane's on-avatar-changed callback fires the app-shell state update; footer conditional-render swaps immediately without a page refresh.
- **What would make it wrong: A preference added that the app doesn't read** — present · Only avatar, fallback voice, push permission, and About-you file are surfaced — every one has a code path that consumes it.
- **What would make it wrong: Voice fallback stored but not applied** — present · The speak chain threads the user's fallback into the identity voice slot when the identity has none bound — the user's chosen voice actually takes effect.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The retained `GlobalFileTab` component is not an unretired remnant of the global-files modal — it's consumed by two unrelated features (editable-file modal + workspace tab) that predate this shape. The About-you pane's "About you" tab label is applied only when the file path matches the implicit user-wide file, so admins with extra files configured still see per-file names for the others. The consolidation intent is fully realised: gear-click is the sole entry point for all four consolidated concerns.
