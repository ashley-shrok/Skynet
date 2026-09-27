# Phase 137: Preferences modal from sidebar gear — voice fallback, notifications, avatar, about-you - Context

**Gathered:** 2026-09-27
**Status:** Ready for planning
**Source:** Seeded from `.planning/shapes/shape-preferences-modal.md` — the shape file was extensively grilled in `/open` and captures the full agreement. This CONTEXT.md distills implementation decisions from that shape without re-elicitation, per the `/build` skill directive: *"If the vehicle is a GSD phase, seed discuss-phase from the shape file. Don't re-do the discovery work `/open` already did."*

<domain>
## Phase Boundary

Skynet's sidebar footer today has a decorative gear placeholder that hovers "coming soon." This phase wires that gear to open a new preferences modal — the user's single home for user-scope preferences and personal-context editing. Four categories in a left-nav layout: **General** (avatar upload + sidebar footer preview), **Voice** (per-user fallback voice picker), **Notifications** (folded-in enable-notifications flow), **About you** (folded-in user-wide personal-context markdown editor, rebranded from "global files").

Ships adjacent cleanups: retire the dead `reopenTabsOnLogin` preference (fork holdover), remove the Globe button in the sidebar footer (preferences becomes single entry for global-files), remove the "Enable notifications…" kebab menu item.

</domain>

<decisions>
## Implementation Decisions

### Modal chrome + layout

- **D-01:** Modal uses the same chrome pattern as `IdentityModal` — DialogPrimitive-based, portal-mounted, radial-gradient background (`hsla(220, 45%, 25%, 0.82)` → `hsla(220, 40%, 15%, 0.88)`), glass close button, ~24px border radius. Matches every other modal in the app.
- **D-02:** Left-nav + content-pane layout, following `IdentityModal`'s `NAV_SECTIONS` precedent. Nav is ~180px wide on desktop; content pane fills the rest. Nav items are: General, Voice, Notifications, About you.
- **D-03:** Default modal size: ~760×600. Grew from the initial ~480×360 pattern to accommodate the About-you editor without cramping.
- **D-04:** Escape, X button, and backdrop-click all close. Same as existing modals.
- **D-05:** Default open tab: **General**. Panes remember their state within a session but reset on modal close.
- **D-06:** No `<h3>` pane titles inside the panes — the nav item IS the title, so repeating it would be redundant. General also has NO blurb (avatar's meaning is self-evident); Voice, Notifications, About-you each have a one-line blurb under the top of the pane.
- **D-07:** No per-pane save button EXCEPT About-you. Voice/notifications/avatar autosave on change; About-you has an explicit Save button (matches existing markdown-editor UX in IdentityFileTab/RoleFileTab, and typing-during-autosave is a bad experience).

### Gear button wiring

- **D-08:** Replace the current inert `<span>` in `PrettyConversationsPanel.tsx`'s footer (data-testid `pv-footer-preferences-placeholder`, `pv-footer-btn-inert` class, aria-hidden) with a real `<button>` that opens the preferences modal. Reuse the existing `pv-footer-btn` class treatment.
- **D-09:** Modal open/close state lives in `PrettyConversationsPanel.tsx` (or lifted to `AppShell.tsx` if that pattern is more consistent — planner decides).

### General pane — avatar

- **D-10:** Avatar upload UI: file input (accept image/\*), current-avatar preview circle (~72px), "Choose image…" button and "Remove" button. Live-preview the selected file locally before upload.
- **D-11:** Upload wire: PUT `/users/:id/avatar` (route already exists per Phase 85). Remove: DELETE the avatar file + null-out `avatarPath` (backend already supports this).
- **D-12:** After successful upload, the sidebar footer's `pv-footer-initials` circle swaps to render the user's avatar image (via same-origin URL served by the existing avatar route). Initials fall back when `avatarPath` is null. This live-sync is load-bearing per shape §What would make it wrong.
- **D-13:** Failure UX: on upload error, revert the preview to the previous state and show an inline error message. No toast.

### Voice pane — fallback voice

- **D-14:** Add a new `fallbackVoice` field to the `userPreferences` DB row + backend GET/PUT + frontend type. Nullable string; when null, backend falls back to `DEFAULT_VOICE = "Joanna"` (unchanged behavior).
- **D-15:** Frontend picker reuses the existing `VoicePicker` component from `src/ui/features/pretty-view/pickers/VoicePicker.tsx` — same dropdown of the 7 Polly voices (Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen) + sample-play button. First option: "(default)" = null.
- **D-16:** Voice resolution in the speak flow: when an agent/identity/role has no voice bound (`identityVoice === null`), the frontend passes the user's `fallbackVoice` preference to `postSpeakStream(text, voice)` before falling back to backend `DEFAULT_VOICE`. This is a frontend-side resolution — no backend voice route changes needed.
- **D-17:** Autosave on picker change — write via PUT `/user-preferences` on each dropdown change.

### Notifications pane — folded-in

- **D-18:** Fold the entire body of the existing `EnableNotificationsModal` (paragraph explainer + single button + status text) into the Notifications pane. Delete the modal component AFTER wiring (or keep as an internal helper — planner decides).
- **D-19:** **LOAD-BEARING:** The `Notification.requestPermission()` call MUST fire synchronously inside the button's `onClick` — no await boundary before it. iOS PWAs silently block permission requests that don't sit directly inside a user gesture. This invariant carries over from the retired `EnableNotificationsModal.tsx` (Pitfall 4).
- **D-20:** Feature-gated on `pushNotificationsSupported()`. When the browser can't subscribe (old Safari, in-app WebViews), the Notifications nav item still renders but the pane shows an "Push notifications aren't supported in this browser" message.
- **D-21:** Remove the "Enable notifications…" kebab menu item from `PrettyConversationsPanel.tsx` (and the `setEnableNotificationsModalOpen` state if no longer needed) once the fold-in ships.

### About-you pane — folded-in editor

- **D-22:** Rebrand from "Global files" to "About you." Nav item, pane blurb ("Tell your agents anything you want them to know about you — how you work, your preferences, anything.") — all reframe around personal context, not files.
- **D-23:** Rationale: live production `global-files.json` config on t1000 has every one of 10 hosts mapped to exactly ONE file — `~/.claude/CLAUDE.md`. Multi-file/multi-host abstraction is 100% unused. The user-facing framing should match reality (99% single-host, single-file).
- **D-24:** Reuse Skynet's shared `MarkdownEditor` component (`src/ui/features/pretty-view/MarkdownEditor.tsx`) — the same WYSIWYG editor `IdentityFileTab` and `RoleFileTab` use. Do NOT reuse `GlobalFileTab`'s raw-monospace-textarea (per Phase 112 D-08 consolidation, markdown surfaces use the pretty editor).
- **D-25:** Explicit Save button in the pane (matches existing markdown-editor UX). Show "unsaved" / "saved" status hint near the button.
- **D-26:** Preserve the existing mtime-optimistic-concurrency save flow from `GlobalFileTab` — 409 mtime conflict handling stays. This is a wire-level invariant.
- **D-27:** **Multi-host fallback** — when the current user has access to 2+ hosts, show a compact host picker (dropdown) in the pane's top-right. Single-host users never see it. Host defaults to the currently-focused session's host, matching existing `GlobalFilesModal` behavior.
- **D-28:** **Multi-file fallback** — when the resolved host has 2+ configured files, show a tab strip above the editor. First tab is "About you" (the CLAUDE.md, treated specially with the friendly label). Other tabs use their filename or configured label. Single-file hosts never see the tab strip.
- **D-29:** Remove the Globe button from the sidebar footer (data-testid `pv-footer-global-files-button`). Preferences modal is the single entry point for global-files editing.

### Sidebar footer avatar preview

- **D-30:** `pv-footer-initials` renders as an `<img>` when `user.avatarPath` is non-null, sourced from the existing avatar-serve route; renders as the initial-letter `<span>` (current behavior) when null. Live-sync driven by whatever state atom holds the current user's avatar path — planner picks the least-invasive integration.

### Reopen-tabs cleanup

- **D-31:** Delete the `reopenTabsOnLogin` field from the `userPreferences` schema + backend GET/PUT + frontend type + `AppShell.tsx:1606` read site + initial state seed at `AppShell.tsx:361-362`. The tab-restoration mechanism is now driven differently and this preference is dead code from the fork.
- **D-32:** DB migration for the column drop — planner decides whether to run a real `ALTER TABLE DROP COLUMN` or just stop reading/writing the column and leave it as archaeology. Skynet's in-memory SQLite pattern (rebuild-from-disk on startup) is relevant here.

### Claude's Discretion

- **Phase split** — Shape file names this as "GSD phase (or phases)"; plan-phase decides whether it fits in one phase or wants to split (candidate split: foundation shell + General/Voice/Notifications in phase 137, About-you fold-in as its own phase). Planner has full discretion here based on task-graph size.
- **Modal state hoisting** — Preferences modal open state could live in `PrettyConversationsPanel.tsx` (owns the footer button) or `AppShell.tsx` (owns most modals). Planner picks based on existing conventions.
- **Save-button placement in About-you** — Above the editor, below the editor, or in the pane's top-right corner alongside the host picker. Prototype shows bottom-right; planner may adjust for consistency with other pretty-editor sites.
- **Icon choices** for nav items — Prototype uses User/Volume/Bell/Sparkles from lucide-react. Planner may swap if a better match exists.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement
- `.planning/shapes/shape-preferences-modal.md` — the source-of-truth agreement from `/open`. All decisions in this CONTEXT.md derive from that shape. Every part of "In scope" is contractually included; every part of "Out of scope" MUST be respected.

### Tasting prototype
- `~/fleet/identities/fable-box-maintainer/workspace/prototype-preferences/index.html` — standalone HTML prototype of the modal, captures agreed layout, category ordering, chrome treatment, and both multi-host + multi-file fallback behaviors. Reference for the shape/feel; NOT the implementation.

### No external specs
No ADRs or PRDs for this work — the shape file + this CONTEXT.md are the complete agreement.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/ui/features/pretty-view/MarkdownEditor.tsx`** — shared pretty markdown editor (MDXEditor-based), used by `IdentityFileTab` and `RoleFileTab`. About-you pane MUST use this (D-24).
- **`src/ui/features/pretty-view/pickers/VoicePicker.tsx`** — dropdown + sample-play button for the 7 Polly voices. Voice pane reuses verbatim (D-15).
- **`src/backend/database/routes/user-preferences.ts` + `src/ui/api/user-preferences-api.ts`** — existing user_preferences GET/PUT infrastructure. Add `fallbackVoice` slice here (D-14).
- **`src/backend/database/routes/users.ts` + `user-avatar-storage.ts`** — full avatar upload/store/serve backend already built (Phase 85). Frontend UI is the only missing piece (D-10, D-11).
- **`src/ui/features/pretty-view/IdentityModal.tsx`** — `NAV_SECTIONS` pattern for left-nav + content-pane modals. Copy the pattern (D-02).
- **`src/ui/features/pretty-view/GlobalFilesModal.tsx`** — the interior file-editor logic (host picker, per-file lazy-load, mtime-optimistic save) that About-you pane folds in. Extract the interior, drop the DialogPrimitive wrap.
- **`src/backend/database/routes/global-files-config-loader.ts`** — `IMPLICIT_GLOBAL_FILE = { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" }` is always included per host, always. This is what "About you" points to in the single-file case.
- **`src/backend/database/routes/voice.ts:38`** — `export const DEFAULT_VOICE = "Joanna"`. The current app-wide hardcoded fallback. User's `fallbackVoice` preference resolves to this if null.

### Established Patterns

- **Modal chrome recipe** (from `EnableNotificationsModal.tsx`, `GlobalFilesModal.tsx`, `IdentityModal.tsx`): DialogPrimitive.Root + Portal + Overlay (z-110) + Content (z-120) + specific radial gradient background + glass X close button. Verbatim reuse.
- **Autosave-on-change** for user preferences: fire PUT on each change with debounce if needed. `putPinnedIds` in `user-preferences-api.ts` is the shape reference.
- **`DatabaseSaveTrigger.forceSave("<reason>")`** — MANDATORY after any backend write to user_preferences or users.avatarPath. Per role-file invariant: "Direct `db.insert/update/delete().run()` writes reach RAM only; after backend writes, call `DatabaseSaveTrigger.forceSave(...)` wrapped in try/catch."
- **Version-drift hard-lock** — every request stamped with `X-Skynet-Client-Build`; if new WS routes are added, they gate at handshake. Applies here only if new WS routes are needed (unlikely — REST covers everything).
- **Feature-gating pattern** (from `pushNotificationsSupported()`) — call the detection function, hide/replace UI based on result. Same pattern for the notifications fallback message (D-20).

### Integration Points

- **Sidebar footer** (`PrettyConversationsPanel.tsx:3067-3125`): current placeholder `<span>` becomes real `<button>`; Globe button removed; initials-circle becomes conditional `<img>` (D-08, D-12, D-29, D-30).
- **Sidebar kebab menu** (`PrettyConversationsPanel.tsx:3439`): remove "Enable notifications…" entry (D-21).
- **Speak flow** (`ChatMessage.tsx:256`): frontend voice resolution — `postSpeakStream(text, identityVoice ?? userPrefs.fallbackVoice ?? undefined)` (D-16).
- **AppShell state** (`AppShell.tsx:361-362`): remove `reopenTabsOnLogin` seed; remove the `AppShell.tsx:1606` read site (D-31).
- **DB schema** (`src/backend/database/db/schema.ts`): add `fallbackVoice` column to userPreferences; remove `reopenTabsOnLogin` column per D-32 decision.

</code_context>

<specifics>
## Specific Ideas

- **Nav category names:** General / Voice / Notifications / About you. Rejected alternatives: "Personal" / "Profile" / "You" for General; "Files" / "Notes" for About-you; "Custom instructions" for About-you (too technical for the user register).
- **Voice section wording:** "The voice your agents use to speak." — verbatim user phrasing (2026-09-27). Do NOT call it "fallback voice" — the user register is intent-based, not architecture-based.
- **About-you blurb:** "Tell your agents anything you want them to know about you — how you work, your preferences, anything." Matches ChatGPT/Gemini "custom instructions" framing.
- **General pane** deliberately has NO blurb — one control on the page, blurb would be noise.
- **Reference for editor feel:** The pretty markdown editor already used by IdentityFileTab / RoleFileTab is the touchpoint — same toolbar, same prose-styled body, same save UX. Users get muscle-memory reuse.
- **Multi-host case ordering:** Host picker top-right of pane (compact, easy to miss when you don't need it — that's the point).

</specifics>

<deferred>
## Deferred Ideas

- **Additional user preferences** (theme, font size, accent color, language). The DB already has these fields but nothing in the app reads them. Add them to the preferences modal WHEN they actually change app behavior — never before.
- **Extraction of a shared "modal with left-nav" primitive** that both this modal and IdentityModal/RoleModal could use. Nice-to-have refactor; not in scope.
- **Per-pane save button** in Voice/Notifications/Avatar for consistency with About-you. Rejected — autosave is the right default for single-action controls.
- **Deep-linking gear-click to a specific pane** via URL/hash. Would need a reason.
- **Making the extras-file case first-class** rather than a rare fallback. Live config says nobody uses it; revisit if that changes.
- **Any changes to how identity or role voice binding works.** This shape strictly adds a user-level fallback; identity/role editing stays untouched.
- **Rename of the underlying `global-files.json` config schema or backend routes.** The reframe is UI-only; backend keeps its current shape.

</deferred>

---

*Phase: 137 - Preferences modal from sidebar gear — voice fallback, notifications, avatar, about-you*
*Context gathered: 2026-09-27*
