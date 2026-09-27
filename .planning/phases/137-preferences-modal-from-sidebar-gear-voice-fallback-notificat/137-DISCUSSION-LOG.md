# Phase 137: Preferences modal from sidebar gear — voice fallback, notifications, avatar, about-you - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-27
**Phase:** 137 — Preferences modal from sidebar gear — voice fallback, notifications, avatar, about-you
**Areas discussed:** (see below — all discussion happened during `/open`, seeded from shape file)

---

## Note on the process

CONTEXT.md for this phase was **seeded from the shape file** `.planning/shapes/shape-preferences-modal.md` rather than re-elicited via a live `/gsd:discuss-phase` session, per the `/build` skill directive: *"If the vehicle is a GSD phase, seed discuss-phase from the shape file. Don't re-do the discovery work `/open` already did."*

The shape file was produced through an extensive `/open` session with 6 tasting-prototype iterations. That transcript IS the discussion log — reproducing it here would duplicate content the user already read live. The audit trail below summarizes the branch points and alternatives that were considered during `/open`, for retrospective reference.

---

## Preference set — what goes in the modal

| Option | Description | Selected |
|--------|-------------|----------|
| Only the currently-wired preference (reopen tabs on login) | Bring the one live preference from the fork into the UI | |
| Voice + notifications + avatar + about-you | Introduce the settings that meaningfully change app behavior today, retire the dead ones | ✓ |
| Voice + notifications + avatar + about-you + theme/font/color/language | Expose every DB-stored preference including inert ones | |

**User's choice:** Voice + notifications + avatar + about-you.
**Notes:** Reopen-tabs is dead fork code — deleted, not surfaced. Theme/font/color/language are stored but nothing reads them — deferred until each actually does something. "Don't surface inert preferences" is a load-bearing principle.

---

## Notifications entry — launcher vs fold-in

| Option | Description | Selected |
|--------|-------------|----------|
| Launcher | Preferences row opens the existing EnableNotificationsModal on top | |
| Fold-in | Move the entire body of EnableNotificationsModal into the preferences pane | ✓ |

**User's choice:** Fold-in.
**Notes:** Initial recommendation was launcher based on assumption the modal was multi-step. On reading `EnableNotificationsModal.tsx` it turned out to be paragraph + one button — trivial to inline. User pushed back on launcher; agent conceded. Load-bearing invariant preserved: `Notification.requestPermission()` MUST stay synchronous inside the button's onClick handler.

---

## Global files entry — launcher vs fold-in vs reframe

| Option | Description | Selected |
|--------|-------------|----------|
| Launcher | Preferences row opens existing GlobalFilesModal on top | |
| Fold in as "Files" section | Extract editor interior, embed in pane, keep "Files" name | |
| Fold in as "About you" (rebrand) | Extract editor, rebrand around the intent, treat multi-host/multi-file as rare admin fallbacks | ✓ |

**User's choice:** Fold in + rebrand to "About you."
**Notes:** Discovery in `/open`: live production `global-files.json` on t1000 has 10 hosts, each mapped to exactly one file (`~/.claude/CLAUDE.md`). Multi-file abstraction 100% unused. User's framing: "the user-wide file is essentially like what the user wants all of their agents to know automatically... similar to the section on Gemini/ChatGPT where you fill in an area that's like about you and preferences you have." Reframe adopted. Multi-host/multi-file cases stay in the code as fallbacks that only appear when the config demands them.

---

## Modal layout — single-column vs left-nav

| Option | Description | Selected |
|--------|-------------|----------|
| Single-column stacked rows | Simple list of preference rows, one after another | |
| Left-nav + content pane | Categories on left, per-category content on right (IdentityModal pattern) | ✓ |

**User's choice:** Left-nav.
**Notes:** User wanted the modal set up for future growth even though there are only 4 settings today. Left-nav communicates "there are categories" and follows the existing IdentityModal precedent, giving the modal a familiar family look.

---

## About-you editor — plain textarea vs shared MarkdownEditor

| Option | Description | Selected |
|--------|-------------|----------|
| Plain monospace textarea | Match the current GlobalFileTab implementation | |
| Shared MarkdownEditor (MDXEditor) | Match IdentityFileTab / RoleFileTab — WYSIWYG toolbar + prose-styled body | ✓ |

**User's choice:** Shared MarkdownEditor.
**Notes:** "If the editor for the files could be the actual markdown editor that other markdown files get in other modals, we would be golden on this." Phase 112 already consolidated the pretty markdown editor for identity/role files; About-you extends that consolidation to the user-wide personal-context file.

---

## Sidebar footer avatar — new capability

| Option | Description | Selected |
|--------|-------------|----------|
| No sidebar preview | Avatar only visible when opening preferences | |
| Sidebar footer initials-circle swaps to avatar image | Live-sync the footer preview when user uploads | ✓ |

**User's choice:** Live-sync footer preview.
**Notes:** "Since we are now giving a way to change [the avatar], maybe we can actually show their avatar down in the footer of the sidebar." Scope-expanded during tasting; agent added the mirror to the prototype in-session.

---

## Vehicle

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Do the work directly in the /open session | |
| /gsd:quick | One quick-task with atomic commits | |
| GSD phase or phases | Full pipeline; planner decides split | ✓ |

**User's choice:** GSD phase or phases.
**Notes:** "yeah phase or phases." Explicit greenlight for planner to split into 2 phases if warranted (candidate: foundation shell + About-you fold-in). Backend + frontend + cleanup surface is phase-sized per box-maintainer role directive.

---

## Claude's Discretion

- Phase split decision — whether Phase 137 stays as one phase or splits into two (planner call at `/gsd:plan-phase`).
- Modal open-state hoisting (PrettyConversationsPanel vs AppShell).
- Save-button placement within About-you pane.
- Icon choices for nav items.
- DB migration approach for `reopenTabsOnLogin` column drop (real ALTER vs stop-reading + leave archaeology).

## Deferred Ideas

- Additional user preferences (theme, font size, accent color, language) — surface only when they change app behavior.
- Extraction of shared "modal with left-nav" primitive shared between preferences and identity/role modals.
- Per-pane save button in Voice/Notifications/Avatar for consistency.
- Deep-linking gear-click to specific pane via URL/hash.
- Making extras-file case first-class (currently rare fallback).
- Rebrand of underlying `global-files.json` config schema or backend routes (UI reframe only).
