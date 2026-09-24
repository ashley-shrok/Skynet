# Phase 135: wake-ups-redesign campaign shape 3 (UI modal) — Skynet front-end modal for managing wake-ups fleet-wide — Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Shape 3 (final) of the three-phase `wake-ups-redesign` campaign. This phase delivers the **Skynet front-end modal** the shape-1 on-disk convention (`~/fleet/wakeups/<slug>/wakeup.json` per host) and shape-2 REST CRUD API (fleet-wide LIST + per-host CRUD + roles enumeration) both roll up into. It is the user's path in for viewing, filtering, creating, editing, deleting, and toggling wake-ups across every managed host from a single browser modal.

Two coupled surfaces in one phase:

1. **New header icon button** in `PrettyConversationsPanel`'s header cluster (7th button, alongside search / new-conversation / project / roles / globe / more). Uses the `.pv-pencil` chrome pattern; clock/timer-flavored icon with dashed accent (per tasting prototype).

2. **The wake-ups modal itself** — Radix Dialog + glass-morphism chrome mirroring `ConversationSearchModal`, ~640×720 desktop / inset-4 mobile, with two internal states (list / create-edit form) inside a single shell. Consumes shape 2's REST endpoints for all reads and writes.

**Depends on Phase 134 (shape 2) being live locally** — shape 2's endpoints are already coded on the same branch (24 local commits ahead), and shape 3 ships bundled with shape 2 at end-of-campaign per user auth 2026-09-21 verbatim: *"yeah campaign ships at the end"*.

**The shape file at `.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md` is the authoritative source** for both the visual design (tasting-settled 2026-09-21 with prototype at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`) and the 11 behavioral decisions settled during shape-3's /open on 2026-09-23. Required reading for every downstream agent.

</domain>

<decisions>
## Implementation Decisions

### API integration (with shape 2's REST surface)

- **D-01:** **Consumer of shape 2's endpoints, no new backend surface** (barring the exception in D-02). The modal reads from `GET /wakeups` (fleet-wide fan-out) and roles enumeration (`GET /roles?hostId=...`); writes via `POST /wakeups` / `PATCH /wakeups/<slug>` / `DELETE /wakeups/<slug>` / `PATCH /wakeups/<slug>/toggle-enabled` (whichever shape 2 shipped — planner reads shape 2's routes files to confirm exact URLs / verbs / query-vs-body param placement). Phase 135 owns zero backend routes.

- **D-02:** **Nginx paired-blocks discipline may not apply**, but the planner MUST confirm. Shape 2 delivered the paired `location` blocks in both `docker/nginx.conf` and `docker/nginx-https.conf` per phase 128 D-17. Phase 135 adds no new backend routes, so no nginx changes expected. Planner audits: if a route is added incidentally (e.g., a new host-enumeration endpoint the modal needs but shape 2 didn't ship), the D-17 rule applies to it — paired blocks in both files.

- **D-03:** **Refetch discipline — no client cache surviving beyond modal-open lifecycle.** Per shape file § Shape "Two paths in, one truth out": the modal refetches the LIST on every modal-open and after every successful write (create/update/delete/toggle). No stale-while-revalidate, no persistent client cache. An agent hand-editing a spec on disk shows up in the modal on next refetch; the modal never renders a spec the disk no longer has (once refetched).

### Header button

- **D-04:** **Header-button integration site is `PrettyConversationsPanel.tsx`'s header cluster** (guarded fragment). Position: after the "Edit global files" globe button, before the "More" kebab. Same `.pv-pencil` chrome as neighbors; visual accent (color + dashed border) per prototype section A. Icon: clock/timer-flavored (planner picks the exact Lucide/etc icon that matches the prototype's aesthetic).

- **D-05:** **Mobile — accept the squeeze; no special responsive treatment.** Adding a 7th button to a header that already carries 6 accepts the same density behavior the existing 6 already have. Responsive header consolidation is a separate cross-cutting concern out of scope here (per shape file § Scope edges).

### Modal shell + shared chrome

- **D-06:** **Chrome mirrors `ConversationSearchModal`'s recipe.** Glass-morphism (24px rounded, blue-hue gradient, backdrop blur, warm off-white text), Radix Dialog for accessibility/focus-trap/escape-to-close. Dimensions ~640×720 centered on desktop, inset-4 on mobile. The modal is one shell with two internal states (list ↔ create-edit form); state swap toggles the header title ("Wake-ups" / "New wake-up" / "Edit wake-up") and body content, everything else stays.

- **D-07:** **New component lives alongside existing modals in `src/ui/features/pretty-conversations/`.** File naming mirrors `ConversationSearchModal.tsx` / `NewConversationModal.tsx` (i.e., `WakeupsModal.tsx` or similar; planner picks exact name). **Do NOT reuse `WakeupsTab.tsx`** — that component stays intact for IdentityModal's per-identity wake-up mount per phase 128 D-09; shape 3's modal is a peer of `ConversationSearchModal`, not a re-mount of `WakeupsTab`.

### List view

- **D-08:** **Default state on modal-open is the list.** Filter bar at top, scrollable rows below, footer with count. Row shape (in order): name headline (bold) / metadata line (small dim: schedule kind + next-fire humanized + **host chip**) / prompt body (2-line clamp muted) / chip row (role chips magenta accent + skill chips blue accent only if hand-edited into spec) / right-side enable-toggle + kebab menu. See D-09 for the host-chip decision specifically.

- **D-09:** **Host indicator per row = small chip in the metadata line** (alongside schedule kind + next-fire). Fleet-wide LIST needs a per-row host affordance so the user can see which host owns each spec at a glance. Chip styling: subtle (same visual weight as the schedule text, not attention-grabbing like the magenta role chips) — planner picks exact tokens. This was NOT explicit in the shape file's prototype (which was drafted pre-fleet-wide-LIST); adding it is a straightforward consequence of shape 2's fan-out design. If user disagrees at plan-review, easy to move to another slot.

- **D-10:** **Filter bar contents.** Free-text search input (searches over spec's `name` + `prompt` fields, case-insensitive substring match) + role dropdown (populated from shape 2's `/roles?hostId=...` enumeration endpoint; planner picks whether to enumerate roles fleet-wide or per-selected-host) + **host dropdown** (defaulting to "All hosts", populated from the same user-scoped host list every other Skynet surface uses). Order left-to-right: search / role / host. Skill dropdown is NOT in the filter bar (per campaign D-04 skills-out ruling).

- **D-11:** **Row click behavior — clicking anywhere on the row body (except toggle or kebab) opens edit mode.** Toggle and kebab `event.stopPropagation` so their clicks don't bubble to the row. Matches Skynet's conversation-list-row-opens-conversation pattern; whole row is `cursor: pointer`.

- **D-12:** **Enable-toggle is pessimistic.** Visual state waits for API write to acknowledge; on failure, toggle stays in original position and an inline error banner surfaces at the top of the list view with the API message verbatim. No spinner on the toggle itself (Skynet has no streaming affordances per fleet rule). Toggle write hits the shape-2 `PATCH /wakeups/<slug>/toggle-enabled` endpoint (or generic PATCH — planner confirms shape 2's exact wire shape).

- **D-13:** **Kebab menu content = Edit + Delete only.** "Fire now", "Duplicate", "Copy prompt", "Show last-fired info" all deferred to future shapes (out of scope per shape file). "Fire now" specifically would need a new shape-2 endpoint that wasn't shipped.

- **D-14:** **Delete confirmation = native browser `confirm()`.** Trades chrome fidelity for zero build cost — per shape file "no new surfaces built if an existing pattern works". Standard `window.confirm(\`Delete wake-up "${name}"?\`)` on Delete-menu-click; on OK, fire the shape-2 DELETE; on Cancel, no-op.

- **D-15:** **Loading state = reuse the same loading-text pattern `RoleModal.tsx` uses today.** Planner reads `RoleModal.tsx` (post-shape-2 cleanup) to identify the exact loading affordance (a centered "Loading..." dim text block or similar) and mirrors it. No skeleton rows, no spinner.

- **D-16:** **Empty state — centered helper line pointing at "+" button.** Fleet-wide zero: "No wake-ups on any host. Click + to create one." Filtered zero (no matches): "No wake-ups match this filter." Both dim, centered in the list scroll area, no illustration. Filter bar remains visible above.

- **D-17:** **Filter state resets on modal close.** No session persistence, no URL state, no per-user preference. Every modal-open starts with search empty + role "All" + host "All hosts".

- **D-18:** **Footer content = count of specs + how many enabled.** e.g., "6 wake-ups · 5 enabled" — dim, small. When a filter narrows the visible list, the count reflects the filtered visible count (planner picks exact copy: "6 shown / 12 total" vs "6 wake-ups").

### Create / edit form

- **D-19:** **Same modal shell, header title swaps ("New wake-up" / "Edit wake-up"), body replaces list with form-fields column, footer replaces list-footer with Cancel (left-aligned) + Save (right, primary blue).** No enabled-toggle in the form (list-row is the only path per D-08). No delete-in-form (list-row kebab is the only path per D-13). Cancel returns to list view; Save persists + refetches + returns to list view.

- **D-20:** **Form fields (in order):** Name (text input, single-line, becomes the spec's slug via kebab-case normalization on save per shape 2 D-07) / Prompt (textarea, min ~96px, becomes the newborn identity's first-turn user message — hint copy per prototype) / Roles (chip-picker, multi-select, populated from shape 2's role-enumeration endpoint) / **Host (chip-picker, single-select, mandatory; on create user-picked; on edit READ-ONLY per D-21)** / Schedule (segmented control per D-22). **NO Skills picker** (per campaign D-04 — skill enumeration endpoint was explicitly not built; a newborn identity carries a role + first-turn prompt and can invoke any skill available on the host).

- **D-21:** **Host is read-only on edit.** Moving a wake-up between hosts is not supported (delete-and-recreate on the target host is the workflow). Rationale: shape 1's per-host philosophy + shape 2 D-06 rejected cross-host management; showing a mutable host field with no write path behind it would be visible-edits-without-an-action, the wrong kind of wrong.

- **D-22:** **Schedule segmented control has 4 kinds:** Daily / Weekly / Interval / One-shot. Contextual detail fields per kind:
  - **Daily:** time picker (HH:MM) + optional timezone dropdown (IANA names; defaults to box-local).
  - **Weekly:** day-of-week picker (single day or multi-select; planner picks based on scheduler parser — see D-24) + time picker + optional timezone.
  - **Interval:** every-N number input + unit dropdown (minutes / hours / days). Matches `wakeup-scheduler.py`'s `interval` accepted units.
  - **One-shot:** datetime-local input for the `at` value (ISO datetime — offset-bearing or naive). Fires once, spec self-deletes on fire (per phase 127's on-disk convention).

- **D-23:** **Validation matches `wakeup-scheduler.py`'s parser exactly** (mirrors phase 128 D-08). No opinions added at the API layer or the UI layer beyond what the scheduler accepts. If a schedule shape is malformed, the API returns 500 with the scheduler's rejection reason and the form surfaces that message verbatim (see D-25). Client-side form validation is minimal — required fields (name / prompt / roles / host / schedule kind + its required detail fields), no other blocks.

- **D-24:** **Weekly day-picker shape — planner reads `wakeup-scheduler.py` first.** The scheduler's parser dictates whether Weekly accepts a single day, an array of days, or a comma-string. UI mirrors what the parser expects. If the parser accepts multiple days, picker is multi-select (chip picker or grid); if single, picker is a segmented control (Mon/Tue/.../Sun).

- **D-25:** **Save error UX = inline error banner at top of form body.** On 409 (slug/name collision), 500 (parser rejection or filesystem error), or network failure, an error-red banner surfaces at the top of the form body with the API error message shown verbatim. Form stays open, field values intact so the user corrects and retries. No auto-suffix on collision — user renames + resaves (matches phase 128 D-07). Banner is dismissible; clears automatically on successful save.

### State semantics

- **D-26:** **Modal is Radix Dialog controlled state, lifted up to `PrettyConversationsPanel` or wherever the sibling modals (`ConversationSearchModal`, `NewConversationModal`) hold their open/close state.** Follows the same pattern; planner picks the exact site by reading the sibling modals' mount pattern.

- **D-27:** **Two internal states — `list` (default on open) and `form` (create OR edit).** State transitions:
  - Modal open → `list` (with refetch).
  - Click "+" in header → `form` (create-mode, all fields empty except host defaulting to nothing).
  - Click a row → `form` (edit-mode, fields pre-filled from the row's spec, host disabled).
  - Cancel in form → back to `list` (no refetch, unless a mid-form change happened — planner picks; simpler is always-refetch-on-close-of-form).
  - Save success in form → back to `list` (with refetch).
  - Close modal (X button or Escape or backdrop click) → dismount, filter state resets.

- **D-28:** **No streaming affordances anywhere.** Skynet has no streaming per fleet rule. No spinners that linger beyond the resolve of the specific write, no typing indicators, no auto-expand-as-you-type behaviors, no "creating..." states that hold visual state past acknowledgment. Loading states are all bounded (see D-15).

### Deploy

- **D-29:** **Container mutation required.** Backend has no new code, but frontend build is baked into `skynet-patched:local` image. Standard `docker build` + `docker compose up --force-recreate skynet` motion. No fleet-substrate changes. **Bundled ship with shape 2** at end of shape 3 per user auth (2026-09-21 verbatim: *"yeah campaign ships at the end"*).

- **D-30:** **Standard fleet-rule serialization on container mutations** — user coordinates manually; do NOT post coord announcements. Full test suite is the pre-deploy gate (`npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium`) — orchestrator-only step BEFORE `docker build`, per fleet rule "Test discipline: scoped during dev, full suite ONLY at deployment". **New fleet rule adopted 2026-09-23:** ALWAYS `git pull --rebase` before `docker build` even if you just rebased before push (peers can push in the gap between your push and your build).

- **D-31:** **Full test suite must be green pre-deploy.** No red suites at ship time. Full playwright smoke via `SKYNET_TEST_CREDS` + `PLAYWRIGHT_BASE_URL` from `~/fleet/roles/box-maintainer/playwright-smoke.creds`. During-dev tests are scoped (`npx vitest related --run <touched files>`).

### Claude's Discretion

- **Exact URL for shape 2's endpoints** — planner reads `src/backend/database/routes/wakeups-*.ts` (or wherever shape 2 landed them) to confirm exact `/wakeups` or `/api/wakeups` prefix, per-endpoint path shapes, and whether host is query-param vs body vs path segment.
- **Exact icon choice for header button** — clock/timer flavored, matching prototype's aesthetic; planner picks Lucide/other icon lib entry (Skynet's other header buttons use Lucide).
- **Exact naming of the modal component** — `WakeupsModal.tsx` is the natural name; planner confirms by pattern with sibling modals.
- **Wave decomposition** — probably one plan (modal + header button + tests), possibly two if the planner splits form component from list component. Bar for splitting: only if two waves genuinely have parallel-safe files. If sequential file dependencies chain the work, one plan is right.
- **Host-chip visual token** — subtle, small, in the metadata line. Planner picks exact CSS tokens matching the shape file's aesthetic.
- **Filter-narrowed count copy** — "6 shown / 12 total" vs "6 wake-ups match filter" — planner picks based on visual weight in the footer.
- **Cancel-form refetch discipline** — always refetch on form close vs refetch only when a change was made — simpler is always-refetch; planner picks based on how the sibling modals handle it.
- **`WakeupsSpec` type or wire-payload shape naming** — reuse `WakeupSpecWire` from `src/ui/api/claude-session-api.ts` (still present per phase 128 D-12: "WakeupSpecWire stays — still used by per-identity + upcoming global wake-up API"). If additional wire types are needed for the fleet-wide LIST response, planner names them.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Whole-arc campaign + shape (foundation for shape 3)

- `.planning/campaigns/wake-ups-redesign/campaign-wake-ups-redesign.md` — the campaign artifact naming shape 1 (closed) + shape 2 (this ships bundled) + shape 3 (this phase) + side-bounties + sequencing.
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md` — **the shape agreement for shape 3 (settled 2026-09-23 during /open, greenlit by the user)**. Carries the tasting-settled visual design + 11 behavioral decisions + scope edges + what-would-make-it-wrong list. Every D-XX in this CONTEXT.md traces back to a section in this shape file.
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-crud-api.md` — shape 2's shape (settled 2026-09-21). Describes the REST endpoints this shape consumes.
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-backend.closed.md` — shape 1's closed shape. Describes the on-disk convention the API layers over.

### Prior phase CONTEXT.md files (immediate predecessors)

- `.planning/phases/134-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-/134-CONTEXT.md` — Phase 134's context. **Load-bearing: D-01 (REST style), D-02 (fleet-wide sweep + host param), D-04 (skills-out, roles-only enumeration), D-05 (atomic writes), D-06 (hard delete), D-07 (409 on slug collision), D-08 (validation = scheduler-parser parity), D-17 (nginx paired blocks) all constrain how shape 3 consumes shape 2's API.**
- `.planning/phases/127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-/127-CONTEXT.md` — Phase 127's context. D-04 (spec field shape: name / roles / skills / prompt / schedule / enabled) is the spec shape shape 3's form fields marshal to/from.

### Tasting artifact (visual design source of truth)

- `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` — the settled visual design (tasting-settled during shape 1's /open, refined during shape 2 discuss, further amended during shape 3 /open on 2026-09-23 for skills-out + host-in). Authoritative reference for spacing, chip colors, filter arrangement, footer, form field ordering, header-button placement (section A) + list view (section B) + create-form (section C).

### Existing Skynet frontend modals (must be understood before building)

- `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` — direct chrome pattern reference. Glass-morphism modal shell, Radix Dialog, header w/ close button, body scroll, footer. Shape 3's `WakeupsModal.tsx` mirrors this shape.
- `src/ui/features/pretty-conversations/NewConversationModal.tsx` — second glass-modal analog. Same chrome family.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the panel that hosts the modal + owns the header cluster where the new button lands. Shape 3's changes: add 7th header button + hook modal open/close state.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — `.pv-pencil` header-button chrome class. Every header button in the cluster uses it.
- `src/ui/features/pretty-view/RoleModal.tsx` — reference for the **loading-text pattern** shape 3's modal reuses per D-15. Also reference for chip-picker component (magenta role chips already exist here — either extract or mirror).
- `src/ui/features/pretty-view/WakeupsTab.tsx` — **DO NOT REUSE OR MODIFY.** Per-identity wake-ups mount inside IdentityModal is still live (phase 128 D-09). Shape 3's modal is a peer of `ConversationSearchModal`, NOT a re-mount of `WakeupsTab`. Read it once to understand the field shape (name/prompt/roles/skills/schedule inputs) — that's it.

### Shape 2 backend + frontend surface (what shape 3 consumes)

- `src/backend/database/routes/wakeups-list.ts` — the fleet-wide LIST endpoint shape 3 hits on every modal-open + refetch. Read the header docstring for the return shape (`host` per item, `schedule` humanized or raw, `roles`, `skills`, `enabled`, `next-fire`).
- `src/backend/database/routes/wakeups-write.ts` — POST / PATCH / DELETE / TOGGLE-ENABLED. Read for exact URL paths + param shapes + response codes.
- `src/backend/database/routes/roles-list-for-host.ts` — the roles-enumeration endpoint the form's role chip-picker hits (per phase 128 D-04). Also the JWT + `resolveHostById(hostId, userId)` security pattern to mirror for any new endpoint (though shape 3 shouldn't add any).
- `src/ui/api/claude-session-api.ts` — frontend API surface. `WakeupSpecWire` type still exported (per phase 128 D-12). Shape 3 adds new frontend helpers for the global wake-up API (if not already added by shape 2 wave 1 — planner audits).

### Scheduler script (validation source of truth per D-23)

- `substrate/scripts/wakeup-scheduler.py` — the on-host scheduler. **Its spec parser is the API's validation source of truth** (phase 128 D-08). Header docstring documents current spec shape, schedule kinds, firing semantics, DoW rules for weekly. Shape 3's form fields must produce a spec the parser accepts; any UI-side gate beyond what the parser gates is a "two paths in fail" (shape file § What would make it wrong).

### Fleet-substrate + deploy discipline

- `PROJECT.md` § Constraints — deploy discipline (docker compose up --force-recreate, deadman timer, container-mutations-serialize rule).
- `~/fleet/roles/box-maintainer/box-maintainer.md` — role file. **Standing directives that apply to shape 3's ship:** test discipline (D-31 mirrors), container mutation coordination (D-30 mirrors), banned-strings gate (redact operator's first name in docs/planning/code before commit), frontend `tsc --noEmit` doesn't catch backend TS errors → pre-push `npm run build:backend && npm run build`, `git pull --rebase` before every push AND before every docker build, deploy-hard-down rule (fix immediately, don't surface-and-wait).
- `~/fleet/roles/box-maintainer/banned-strings.txt` — banned-strings source of truth. Check every commit touching docs/planning/tests.
- `~/fleet/roles/box-maintainer/playwright-smoke.creds` — canonical location of `SKYNET_TEST_CREDS` + `PLAYWRIGHT_BASE_URL` for playwright smoke.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`ConversationSearchModal.tsx`** — direct chrome pattern to mirror for the new `WakeupsModal.tsx`. Radix Dialog, glass-morphism, header/body/footer skeleton, close-X + escape behavior.
- **`NewConversationModal.tsx`** — second chrome analog. Two modal siblings gives shape 3's implementer two reference points to triangulate the pattern.
- **`WakeupsTab.tsx`'s field shape** — the per-identity mount already has form fields for name / prompt / roles / skills / schedule. Read for field naming + validation shape (but DO NOT reuse the component — it stays intact per D-07).
- **`RoleModal.tsx`'s chip-picker + loading-text pattern** — reference for both the multi-select chip-picker component (magenta roles) and the loading-text-during-fetch pattern shape 3 mirrors per D-15.
- **Radix Dialog primitives** — accessibility / focus-trap / escape-to-close built in. Every existing Skynet modal uses this.
- **`WakeupSpecWire` type + `humanizeWakeupSchedule` helper** — both still exported per phase 128 D-12 + D-14. Shape 3's list-row metadata uses `humanizeWakeupSchedule` (which was updated in phase 128 to handle one_shot, commit `e34ae421`).
- **Fleet-status host list + user-scoped host access** — the existing per-user host list Skynet already scopes every host-picker surface with. Host dropdown in filter bar + host chip-picker in create form reuse this pattern (planner reads the host-picker mount site in `NewConversationModal.tsx` or wherever else host-picking already happens to mirror the shape).

### Established Patterns

- **`.pv-pencil` header-button chrome class** — mandatory for the new header button. Applies to every button in the cluster.
- **Radix Dialog for modals** — every Skynet modal is Radix Dialog. No exceptions.
- **Glass-morphism modal aesthetic** — 24px rounded, blue-hue gradient, backdrop blur, warm off-white text (specific tokens in `src/ui/index.css`).
- **Multi-state modal via single shell** — the sibling modals swap header + body content on internal state; shape 3 follows this pattern for list ↔ form.
- **Pessimistic writes with inline error banners on failure** — established in `RoleModal.tsx` and elsewhere. Shape 3 D-12 + D-25 mirror this pattern.
- **Refetch-on-open + refetch-on-write** — same pattern the existing per-role/per-identity wake-up mount already uses (before shape 2's cleanup). Shape 3 D-03 mirrors this.
- **JWT-gated + `resolveHostById(hostId, userId)`** — every existing endpoint uses this security pattern (established in every routes/ file). If shape 3 needs any new endpoint (per D-02 audit), it mirrors this shape.

### Integration Points

- **`PrettyConversationsPanel.tsx` header cluster** — new 7th button lands in the guarded fragment alongside the existing 6.
- **`PrettyConversationsPanel.tsx` modal mount site** — new modal mount alongside the existing sibling modals (`ConversationSearchModal` etc). Open state lifted to the panel.
- **`src/ui/api/claude-session-api.ts`** — new frontend helpers for the fleet-wide LIST + per-host CRUD if shape 2 wave 1 didn't already add them. Planner audits.
- **Shape 2's REST endpoints** — the modal's entire read/write path goes through these. If shape 2 wave 1 added frontend helpers to `claude-session-api.ts`, shape 3 imports them; if not, shape 3 adds them and mirrors the JWT + user-scoping conventions.

</code_context>

<specifics>
## Specific Ideas

- The tasting prototype at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` iterated through several rounds with the user during shape 1's /open (rearrange list-item layout, separate name from prompt for scannability, drop enabled toggle from form, drop delete from form, cancel left-aligned). **These are locked design decisions; shape execution should not re-relitigate.**
- User's verbatim call on the campaign ship strategy (2026-09-21): *"yeah campaign ships at the end"* — shape 3 code + tests land, then bundled ship of shapes 2+3 together.
- User's verbatim call on skills-out (during shape 2 discuss, applied to shape 3 during /open 2026-09-23): *"i think you pick roles only right now. we may allow picking skills later, but the reality is that an identity born for a wakeup will be able to invoke any skill available to it just like any other, so if you schedule a wakeup that says something like 'check my gmail and give me a digest' then that identity is obviously going to reach for the gmail skill, assuming it exists, so it is no problem."*
- User's verbatim call on host being read-only on edit (2026-09-23): thumbs-up on "baked in at create, read-only in edit — moving = delete-and-recreate on the target host."
- User's verbatim call on delete UX (2026-09-23): *"yeah can we just do a javascript modal"* — native `window.confirm()`, no custom chrome.
- User's verbatim call on loading state (2026-09-23): *"let's just do loading text like the role modal does"* — reuse existing pattern, no skeleton system to design.

</specifics>

<deferred>
## Deferred Ideas

### Deferred within this campaign (shape-3-scope discussion surfaced them)

- **"Fire now" / test-trigger button in kebab menu** — genuinely useful, but needs a new shape-2 endpoint (spawn-request drop on-demand without waiting for the schedule). Natural side-bounty follow-up under `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/`.
- **"Duplicate this wake-up" affordance** — deferred at campaign concept-open time.
- **"Show last-fired info" / history-of-past-fires view** — needs history data that doesn't exist in the on-disk convention today.
- **Session-persistent filter state** — filters reset on close in v1 (D-17); if usage shows users re-filtering the same way repeatedly, that's the signal for a per-user preference follow-up.
- **Responsive header treatment for mobile** — the 7th button accepts the same squeeze the existing 6 have (D-05); header consolidation is a separate cross-cutting shape.
- **Toast surface** — Skynet has none; the modal is the whole surface for now. If Skynet grows a toast surface later, the save-error banner (D-25) can be swapped to a toast then.
- **Deep-link / URL state for modal-open or edit-a-specific-wake-up** — not for v1; if wake-ups management becomes a common enough entry-point that shareable URLs matter, revisit.
- **Skills picker in the create/edit form** — explicitly deferred per shape 2 D-04 + shape 3 /open ruling. If demand emerges, adds a `/skills?hostId=` endpoint reading `~/.claude/skills/*/SKILL.md` and a chip-picker in the modal form.
- **Templates library** — pre-canned wake-up shapes ("daily standup", "hourly log sweep") — deferred at campaign concept-open.

### Deferred / considered but excluded

- **Cross-host wake-up management** (moving a spec from host A to host B) — rejected per shape 1's per-host philosophy; delete-and-recreate is the workflow.
- **Server-side auto-suffix on slug collision** — rejected per phase 128 D-07. 409 + client-re-prompts on collision matches existing wake-up UX.
- **DB shadow of wake-up specs** — rejected per phase 128 D-03. Files stay the truth.
- **Streaming / websocket for spec-change notifications** — rejected per fleet rule (Skynet has no streaming). Modal refetches on write + on open.

</deferred>

---

*Phase: 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end*
*Context gathered: 2026-09-23*
