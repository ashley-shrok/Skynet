# Shape: wake-ups modal — Skynet UI for managing wake-ups from the front end

**Opened:** 2026-09-21 (declared as part of retroactive campaign conversion)
**Settled:** 2026-09-23 (skills-out + host-in amendments + 11 grill decisions during /open)
**Vehicle:** GSD phase
**Status:** shape settled, ready for /gsd:discuss-phase
**Part of campaign:** `campaign-wake-ups-redesign.md`

## What this is

Shape 3 (final) of the wake-ups-redesign campaign. This is the user's path in. A new icon button in the conversation-list panel header opens a modal where the user sees every wake-up across the fleet, filters by role/host, creates new ones, edits/deletes existing ones, and toggles enable/disable. The modal's visual design was **tasting-settled during shape 1's /open session** — the prototype lives at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`. The behavioral shape (host picker, delete UX, error handling, toggle semantics, empty/loading states, click-row-to-edit) was **grilled-and-settled during shape 3's /open session on 2026-09-23**.

## Shape

**The header button.** A new icon in the conversation-list panel header alongside the existing Search / New / Project / Roles / Globe / More cluster. Uses the same `.pv-pencil` chrome pattern. Icon: clock/timer flavor with dashed accent (per prototype).

**The modal shell.** Reuses Skynet's existing glass-morphism modal chrome (per `ConversationSearchModal`'s recipe): 24px rounded, blue-hue gradient, backdrop blur, warm off-white text. Dimensions ~640×720 centered on desktop, inset-4 on mobile.

**List view** (default state when modal opens):
- Filter bar: free-text search over name/prompt + role dropdown + **host dropdown** (defaulting to "All hosts"). Role list populated from shape 2's role-enumeration endpoint; host list scoped to hosts the logged-in user has access to (matching every other user-scoped surface in Skynet).
- Scrollable rows, each showing:
  - Name as bold headline (from spec's `name` field).
  - Small dim metadata line: schedule kind + next-fire time.
  - Prompt as muted body text (2-line clamp).
  - Chip row: role chips (magenta accent). Skill chips (blue accent) render only if an agent hand-edited the spec on disk to include skills — the modal reads whatever's on disk truthfully, even for fields the form never lets you set.
  - Right side: enable-toggle + kebab menu.
- **Row click behavior.** Clicking anywhere on the row body (except the toggle or the kebab) opens the row in edit mode. Toggle and kebab stopPropagation so their clicks don't bubble to the row.
- **Enable-toggle is pessimistic.** The visual state waits for the API write to acknowledge. On failure, the toggle stays in its original position and an inline error banner surfaces at the top of the list view with the API message shown verbatim. No spinner on the toggle itself (Skynet has no streaming affordances).
- **Kebab menu contents.** Edit (opens same modal in edit mode with fields pre-filled) + Delete only. "Fire now" and "Duplicate" are natural follow-ups for a later phase but out of scope here (both would need endpoints shape 2 didn't ship).
- **Delete confirmation.** Native browser `confirm()` — trades chrome fidelity for zero build cost, matches Skynet's minimalism.
- **Loading state.** First fetch across all managed hosts fans out over SSH — during the wait, the modal reuses the same loading-text pattern the roles modal uses today. No skeleton, no spinner.
- **Empty state.** When the list has zero items (fleet-wide first-open, or a filter narrows to zero), the center of the list area shows a small dim helper line pointing at the "+" button in the modal header ("No wake-ups on any host. Click + to create one." for fleet-wide zero; "No wake-ups match this filter." for filtered zero).
- **Filter state.** Filter selections reset on modal close — no session persistence.
- Footer: count of specs + how many enabled.

**Create / edit form** (same modal shell, only header title changes: "New wake-up" vs "Edit wake-up"):
- **Name** — short text input at the top (single-line, the identifier).
- **Prompt** — larger textarea. Hint: "This becomes the first user message to a freshly-born agent. Assume it starts with no memory of prior fires — reference logs, role files, or bounties in the prompt if continuity matters."
- **Roles** — chip picker (multi-select from shape 2's role-enumeration endpoint). Hint: "The newborn agent takes on these roles. One or more."
- **Host** — single-select chip picker (mandatory). List scoped to hosts the logged-in user has access to (matching every other user-scoped surface). **On create**, user-picked. **On edit, host is read-only** — moving a wake-up between hosts is not supported (delete-and-recreate on the target host is the workflow if you need it).
- **Schedule** — segmented control for kind (Daily / Weekly / Interval / One-shot), with contextual detail fields per kind (a time + optional timezone for Daily/Weekly; a day picker for Weekly; every-N interval for Interval; an at-datetime for One-shot).
- Footer: Cancel (left-aligned) + Save (right, primary blue).
- **No skills picker in the form.** The scheduler + spawn-request path still support `skills: []` for agents hand-editing specs on disk, but the modal never populates it — per campaign discuss-phase D-04, a newborn identity carries a role + first-turn prompt and can invoke any skill available on the host it lands on.
- **Save error UX.** If the API returns an error (409 slug collision, 500 scheduler-parser rejection, network drop), an inline error banner appears at the top of the form body with the API message shown verbatim. The form stays open with all field values intact so the user can correct and retry. No auto-suffix on collision — the user renames + resaves.

**Two paths in, one truth out.** The modal reads and writes to shape 2's API. An agent that hand-edits `~/fleet/wakeups/<slug>/wakeup.json` on disk shows up in the modal on next refetch. Modal creates land on disk immediately. No caching that survives beyond a modal-open lifecycle. Modal refetches on open and after every write.

## Philosophy

**Trim, don't accrete.** Skynet's direction is chat-first, trimming top-level surfaces. This is why the wake-ups management goes in a modal reached from a header icon (matching the existing search/create-project/edit-roles/edit-global-files convention) rather than as a new sidebar section or top-level view.

**Match Skynet's existing chrome.** The tasting deliberately mirrored `ConversationSearchModal`'s modal recipe — same glass-morphism, same button/close-X styling, same `.pv-pencil` header integration. New surface should feel like it was there all along.

**Design settled before shape open.** The prototype iterated through several rounds with the user during shape 1's /open: rearrange list-item layout (schedule moved from leading to secondary), separate name from prompt for scannability, drop enabled toggle from form (list-only), drop delete from form (list-kebab-only), cancel left-aligned. These are locked design decisions; shape execution should not re-relitigate.

**No new surfaces built if an existing pattern works.** Delete uses native `confirm()`, not a custom modal-over-modal chrome. Loading state uses existing loading-text pattern, not a bespoke skeleton system. Error surface uses inline banners, not a toast infrastructure Skynet doesn't have. Shape 3 is a consumer of existing Skynet chrome, not a re-thinker of it.

**Governance-preserving.** The id-skill's "user-authorized-only" rule for wake-up creation applies at the disk layer regardless of the UI. The UI is one authorized-user path to creating a spec (obvious — she's the user, she's clicking Save); the agent-side rule stays as-is (agents may SUGGEST wake-ups, only user authorizes).

## Prior context

- Shape 1 landed the disk convention, scheduler, and fire path.
- Shape 2 lands the CRUD API this modal consumes (fleet-wide LIST + per-host CRUD + roles enumeration). Live locally on the same branch as of 2026-09-21; bundled ship of shapes 2+3 at the end of this shape.
- The modal's visual design is **tasting-settled** in the prototype at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`. Should be read as a design reference by whoever implements this shape.
- The modal's behavioral shape is **grilled-and-settled** in § Shape above as of 2026-09-23.
- Skynet's existing modals live at `src/ui/features/pretty-conversations/*.Modal.tsx` — `ConversationSearchModal.tsx` and `NewConversationModal.tsx` are the closest analogs for glass-chrome + Radix Dialog patterns.
- Skynet's `.pv-pencil` header-button chrome lives at `src/ui/features/pretty-conversations/pretty-conversations.css` and the button set is in `PrettyConversationsPanel.tsx` header cluster.
- The role modal (`RoleModal.tsx` — after shape 2's cleanup) is the reference for how the loading-text pattern renders today.

## What would make it wrong

- Modal renders a stale list because it caches beyond a modal-open lifecycle — "two paths in, one truth out" fails.
- Form treats any field as required-in-a-way-that-blocks-authoring: user should be able to think through name/prompt/roles/schedule without a field blocking them mid-thought; only Host is genuinely required-to-save.
- Delete/enable-toggle affordances end up in the form (both belong on the list view per the tasting).
- Modal has streaming-related affordances (spinners, "creating..." states that persist beyond acknowledgment) — Skynet has no streaming.
- Modal shows a wake-up as toggled-on/off while a failed write leaves the on-disk state opposite — pessimistic toggle handling prevents this specifically.
- Modal shows a host in the picker the user cannot write to — host list must be scoped to the user's access.
- Edit form lets the user change host, but nothing on the write path actually moves the spec — visible-edits-without-an-action is the wrong kind of wrong.
- Delete lands without confirmation and the user destroys a spec they meant to just toggle off.
- Save error is silent or eats the user's field values — the inline-banner + fields-intact rule prevents this.
- List view degrades past ~50 wake-ups without a clear virtualization path (design should not preclude it, but not required at v1 scale).
- Chrome doesn't match Skynet's existing modal recipe — feels bolt-on.

## Scope edges

**In:**
- New header icon button + associated `.pv-pencil` chrome + integration into the conversation-list header cluster's guarded fragment.
- Modal component with list view + create/edit form (single shell, two states).
- Filter bar: text search over name/prompt + role dropdown + host dropdown.
- Enable-toggle in list row (pessimistic) + kebab menu with edit/delete.
- Native `confirm()` for delete confirmation.
- Create/edit form fields per settled shape: name / prompt / roles (multi-select) / host (single-select, read-only on edit) / schedule.
- Save error inline banner + fields-intact behavior.
- Empty state + loading state (reuse role modal's loading-text pattern).
- Row-click-to-edit behavior with stopPropagation on toggle + kebab.

**Out:**
- Backend CRUD endpoints → shape 2 (dependency; already live locally).
- Any DB/schema work.
- Skills picker in the create/edit form (per shape 2 D-04 — the `skills: []` spec field stays supported by the scheduler + spawn-request path for agents hand-editing specs, but the modal never populates it).
- Editing host on an existing spec (delete-and-recreate on the target host is the workflow).
- History-of-past-fires view (deferred; add later as follow-up if wanted).
- Notifications when a wake-up fires (deferred; the newborn identity appearing in the conversation list IS the notification).
- Cross-host wake-up management surface (per-host stays per-host; the modal shows what shape 2 exposes).
- Duplicate-and-edit or "clone this wake-up" affordance (deferred).
- "Fire now" / test-trigger button in the kebab menu (would need a new shape 2 endpoint; natural side-bounty follow-up).
- Templates library (deferred).
- Session-persistent filter state (filters reset on close).
- Responsive header treatment for mobile (the 7th button accepts the same squeeze the existing 6 have; header responsiveness is a separate cross-cutting concern).
- Toast surface (Skynet has none; the modal is the whole surface for now).
- Deep-link / URL state for modal-open or edit-a-specific-wake-up (not for v1).

## Vehicle notes

Standard GSD phase, likely 1-2 plans (modal component + header-button wire-in + tests + nginx blocks for any new backend routes — probably zero new routes since shape 2 delivered them all, but planner confirms). Depends on shape 2 (CRUD API + enumeration endpoints must be live locally — they are, as of 2026-09-21 in the same branch). Container mutation required to deploy. No fleet-substrate changes. Bundled ship of shapes 2+3 at the end of this shape (per campaign authorization: *"yeah campaign ships at the end"*, 2026-09-21).

**Tasting artifact reminder:** `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` — the settled visual design. Read it before writing plan tasks; it's the authoritative reference for spacing, chip colors, filter arrangement, footer, form field ordering.

**Behavior reference:** § Shape above captures the 11 grill decisions settled during shape 3's /open on 2026-09-23. Anything in that section is a locked design decision; shape execution should not re-relitigate.

---

## Close-Out

**Closed:** 2026-09-24
**Vehicle used:** GSD phase (Phase 135 — 2 plans / 2 waves / 9 tasks — as declared at /open)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Modal is the user's path in; header button opens a fleet-wide list + create/edit surface as agreed.
- **Shape (header button)** — present · 7th button lands in `PrettyConversationsPanel.tsx` header cluster with `.pv-pencil` chrome; icon is clock-flavored.
- **Shape (modal shell)** — present · Radix Dialog + glass-morphism chrome mirroring `ConversationSearchModal`, 640×720 desktop / inset-4 mobile.
- **Shape (list view)** — present · Filter bar with text search + role dropdown + host dropdown; rows with name / schedule-metadata / prompt-clamp / role chips / toggle / kebab; footer count.
- **Shape (row click behavior)** — present · Row-body click opens edit mode; toggle + kebab stopPropagation.
- **Shape (pessimistic toggle)** — present · Visual state waits for API ack; inline error banner in list view on failure.
- **Shape (kebab menu = Edit + Delete)** — present · No Fire-now, no Duplicate.
- **Shape (native `confirm()` delete)** — present · Uses `window.confirm()`.
- **Shape (loading state)** — present · Skeleton bars matching the role modal's live pattern (RESEARCH Pitfall #1 corrected the shape's "loading-text" phrasing).
- **Shape (empty state)** — present · Centered helper line pointing at "+" button, two copies (fleet-wide zero vs filtered zero).
- **Shape (filter state resets on close)** — present.
- **Shape (create/edit form fields)** — present · Name / Prompt / Roles / Host / Schedule per D-20; NO skills picker; host chip-picker read-only on edit; Name field also disabled on edit per RESEARCH Pitfall #5 (endorsed as drift below).
- **Shape (save error UX)** — present · Inline error banner at top of form body, API message verbatim, fields intact, no auto-suffix on collision.
- **Shape (two paths in, one truth out)** — present · Refetch on open + refetch on every write; no cache surviving modal-open lifecycle; round-trip preservation of hand-editor fields (skills + schedule.timezone + schedule.days).
- **Philosophy (trim, don't accrete)** — present · Wake-ups management lives in a modal reached from a header icon, not a new sidebar section or top-level view.
- **Philosophy (match Skynet's existing chrome)** — present · Modal chrome mirrors sibling modals; header button matches sibling header buttons.
- **Philosophy (no new surfaces built if an existing pattern works)** — present · Native `confirm()` for delete; skeleton loading pattern reused; inline banners not a new toast surface.
- **Philosophy (governance-preserving)** — present · UI is one authorized-user path to creating a spec; agent-side authorization rule unaffected.
- **What would make it wrong: stale list from over-caching** — present · Refetch-on-open + refetch-on-write; no stale cache.
- **What would make it wrong: fields required in a way that blocks authoring** — partial · Save button is disabled when Name or Prompt is empty (endorsed as drift below — the greyed button doesn't block authoring, only submit).
- **What would make it wrong: delete/toggle affordances end up in the form** — present · Both are list-row-only.
- **What would make it wrong: streaming affordances** — present · No spinners, no typing indicators, no lingering "creating..." states.
- **What would make it wrong: visible on/off flip while disk state opposite** — present · Pessimistic toggle handling.
- **What would make it wrong: hosts in picker the user cannot write to** — present · Host list scoped to user's accessible hosts via existing user-scoping.
- **What would make it wrong: edit form lets user change host without a write path** — present · Host chip-picker read-only on edit.
- **What would make it wrong: delete without confirmation** — present · Native `confirm()` guard.
- **What would make it wrong: save error silent or eats fields** — present · Inline banner + fields intact + form stays open.
- **What would make it wrong: list degrades past ~50 wake-ups without a virtualization path** — present · Design does not preclude virtualization; not required at v1 scale (matches shape).
- **What would make it wrong: chrome doesn't match Skynet's existing modal recipe** — present · Mirrors `ConversationSearchModal` recipe.
- **Scope edges (In items — new header button, modal, filter bar, list-row affordances, native confirm, form fields, save error banner, empty + loading states, row-click)** — all present.
- **Scope edges (Out items — backend routes, DB work, skills picker, host-editing on edit, history view, notifications, cross-host management, duplicate, fire-now, templates, session-persistent filters, mobile header responsiveness, toast, deep-link)** — all honored; none crept in.

### Additions (in the result, not in the shape)

- Header button's prototype-dashed-accent dropped — endorsed-as-drift · Prototype's dashed border was a tasting affordance to draw the reviewer's eye; production doesn't need the emphasis and none of the sibling buttons carry it.
- Name field disabled on edit-mode — endorsed-as-drift · Shape 2's PATCH rejects name-vs-slug divergence with 400; allowing rename would create a broken write path. Same rationale as host-read-only; constraint was unknown at /open time.
- Escape-key in form mode returns to list (rather than closing modal) — endorsed-as-drift · Two-state modal implicitly needs some escape-transition; shape didn't specify. Escape → list is the reasonable choice.
- Auto-select single available host in create form — endorsed-as-drift-with-extension · User endorsed the intent AND extended it: hide the host picker entirely when only one accessible host exists (applied as an in-session /close fix — see Follow-ups).
- Delete-error banner UX — endorsed-as-drift · Reasonable derivation from the shape's Save-error banner pattern; silence on Delete failure would be worse.
- Save button disabled when Name or Prompt is empty — endorsed-as-drift · Shape's "only Host is genuinely required-to-save" was about not blocking authoring; a greyed Save button doesn't block authoring, only submit.

### Follow-ups

- **fu-1** (source: divergence #4): Hide the host chip-picker entirely in create mode when the user has access to only one host. — issue (in-session code fix, applied as commit `a565963c`)
- **fu-2** (source: divergence #6): Preserve `schedule.days` on edit-save round-trip. Modal reads it invisibly, holds it in state, writes it back untouched. Matches the shape's "two paths in, one truth out" spirit. — issue (in-session code fix, applied as commit `a565963c`)

### Notes

Phase 135 shipped code-complete-awaiting-bundled-ship with Phase 134 per campaign authorization (2026-09-21 verbatim: *"yeah campaign ships at the end"*). Local commit count on `feat/tab-title-from-tmux`: 13 commits added by shape 3 (2254d693 → a565963c) on top of shape 2's 24-commit stack; bundled ship gates on user "push it" + "ship it" greenlights per fleet-rule deploy discipline. RESEARCH Pitfall #1 corrected the shape's "loading-text" phrasing to skeleton bars mid-flight — the material matches the shipped pattern (which is what the user asked for), not the shape's literal words. The `days` round-trip preservation reversal (Option A → Option B) means the modal is now a strict subset of the on-disk spec surface — anything hand-editors add that the modal doesn't display survives round-trip.
