---
phase: 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end
verified: 2026-09-24T11:15:00Z
status: human_needed
score: 28/28 must-haves verified (executor scope) + 3 D-XX deferred to orchestrator (D-29/D-30/D-31)
overrides_applied: 0
human_verification:
  - test: "Open the WakeupsModal in a real browser after deploy: click the AlarmClock header button in a PrettyConversationsPanel with showPencilButton enabled, confirm the glass-morphism 640×720 modal actually renders at those dimensions on a real desktop viewport (Radix Portal + Tailwind arbitrary-values render as expected)."
    expected: "Modal opens centered at ~640×720 with backdrop blur, blue-hue gradient, warm off-white text; the AlarmClock icon appears between Globe and Feedback+kebab; keyboard focus is trapped inside the modal."
    why_human: "Radix Dialog + Tailwind arbitrary-value classes cannot be truly exercised in JSDOM; visual chrome fidelity + focus-trap behavior needs a real browser."
  - test: "Real fleet-wide LIST fetch — with shape 2's endpoints live locally, open the modal and verify that GET /wakeups actually returns items from every managed host (fan-out via SSH)."
    expected: "Rows render for every host that has a wake-up spec on disk; scheduleHuman displays the humanized next-fire; host chip in metadata line matches the on-disk host."
    why_human: "Backend fan-out over SSH cannot be exercised in unit tests; only a running fleet with shape-2 endpoints can verify the wire contract end-to-end."
  - test: "Toggle enable/disable in-browser and confirm pessimistic semantics — the visual state does NOT flip until the backend acknowledges. Trigger a failure (e.g. by disconnecting a host) and confirm the inline banner surfaces the server message verbatim while the toggle stays in its original position."
    expected: "On success: toggle text swaps 'On' ↔ 'Off' after a fresh listWakeups. On failure: banner shows API message; toggle text is unchanged."
    why_human: "Pessimistic timing behavior is asserted in unit tests via mocks, but the real network-latency case + real 502 propagation needs live verification."
  - test: "Delete flow via native window.confirm — click kebab → Delete on a real row, confirm the browser's native confirmation dialog appears, click OK, and verify the row disappears from the list after the refetch."
    expected: "window.confirm dialog reads 'Delete wake-up \"<name>\"?'; on OK the DELETE with body {host} hits shape 2 and the spec is removed on disk; on Cancel nothing happens."
    why_human: "window.confirm() is a browser-native dialog; JSDOM does not render it. Unit tests mock it — real UX confirmation needs a live click."
  - test: "Create + edit flow — fill out a new wake-up on a real host, save, verify it lands on disk (~/fleet/wakeups/<slug>/wakeup.json on the target host). Then edit it, verify Name + Host are disabled with helper text, change the prompt/schedule, save, and confirm the on-disk file was updated."
    expected: "Create → POST /wakeups → 201 with server-derived slug; disk file exists. Edit → PATCH /wakeups/:slug → 200; disk file updated. Name field disabled with 'To rename, delete + recreate' helper text; Host chip locked with 'Delete and recreate on the target host' helper text."
    why_human: "End-to-end file-on-disk verification requires SSH access to a managed host; only a live smoke can prove the write path actually mutates the target filesystem."
  - test: "Filter reset on modal close — set filter search to non-empty, close the modal (via X or Escape), reopen, and confirm search is empty. Also verify role + host dropdowns reset to 'All'."
    expected: "Every modal-open starts with an unfiltered list (search='', role='ALL', host='ALL' sentinels)."
    why_human: "Unit tests exercise filter reset for search input only; role + host dropdown reset is asserted indirectly. A live click-through in real Radix Portal environment confirms the reset covers all three controls."
  - test: "Full test suite pre-deploy — orchestrator runs `npx vitest run` (full suite) + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` before docker build per D-30/D-31 fleet rule."
    expected: "Both suites green with `SKYNET_TEST_CREDS` + `PLAYWRIGHT_BASE_URL` from `~/fleet/roles/box-maintainer/playwright-smoke.creds`."
    why_human: "Executor scope is `npx vitest related --run <touched>` only; the full suite + playwright smoke is deploy-gate discipline, not executor scope. Requires orchestrator + user greenlight."
  - test: "Deploy motion — bundled ship of shapes 2+3 per D-29. `git pull --rebase` + `docker build` + `docker compose up --force-recreate skynet`."
    expected: "Container rebuilt with the wave-1+wave-2 code baked in; live Skynet UI shows the new AlarmClock button and functional wake-ups modal."
    why_human: "Deploy commands are orchestrator-exclusive per fleet rule; user coordinates the container-mutation serialization step manually."
---

# Phase 135: wake-ups-redesign campaign shape 3 (UI modal) Verification Report

**Phase Goal:** Skynet front-end modal for managing wake-ups fleet-wide, reached from a new conversation-list header button. Two coupled surfaces: (1) new AlarmClock header button in PrettyConversationsPanel's header cluster; (2) Radix Dialog modal with glass-morphism chrome, list view (fetch-on-open, filter bar, rows, skeleton loading, empty state, footer count) + create/edit form (name/prompt/roles/host/schedule) + pessimistic enable-toggle + native-confirm delete + inline error banner. Consumes shape 2's REST endpoints (zero new backend routes). Bundled ship with shape 2 at end-of-campaign.

**Verified:** 2026-09-24T11:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement Summary

The code delivers the goal end-to-end within executor scope. All 28 executor-scope D-XX decisions map to concrete, verified code. Three D-XX decisions (D-29 container mutation, D-30 serialization, D-31 pre-deploy full-suite) are orchestrator-exclusive and correctly deferred — no deploy commands are baked into the phase's commits. 25/25 new unit tests pass; the wider scoped verification suite (11 files, 205 tests including 25 new + 180 pre-existing) passes green. `npx tsc --noEmit` exits 0.

Verification identified 8 items that cannot be exercised from the codebase alone (real-browser chrome / focus-trap, live SSH fan-out, pessimistic timing, native window.confirm, on-disk write verification, filter-reset visual smoke, and the two orchestrator-exclusive deploy gates). These are surfaced as human_verification items above.

## Observable Truths (Must-Haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New AlarmClock header button renders in PrettyConversationsPanel between Globe and More/kebab, gated by showPencilButton | ✓ VERIFIED | PrettyConversationsPanel.tsx:2314-2323 — `.pv-pencil` class, `data-testid="pv-header-wakeups-button"`, inside `showPencilButton && (<>...</>)` guard; AlarmClock icon imported at line 67; docstring updated (2229-2244) documents 8-button cluster with Wake-ups at position 6 |
| 2 | Clicking the header button opens a WakeupsModal shell using ConversationSearchModal's glass-morphism chrome at 640×720 desktop / inset-4 mobile (D-06) | ✓ VERIFIED | WakeupsModal.tsx:348-366 — `md:max-w-[640px] md:max-h-[720px]`, inset-4, backdrop-blur + linear-gradient + border chrome mirroring ConversationSearchModal; PrettyConversationsPanel.tsx:2995-2999 mounts modal with controlled open state and hostTree threaded |
| 3 | Modal fetches GET /wakeups on every open and renders resulting rows (D-03, D-08) | ✓ VERIFIED | WakeupsModal.tsx:147-178 — `useEffect(open)` calls `listWakeups()` on open, resets on close (D-17 discipline preserved); WakeupsModalRow subcomponent renders each row |
| 4 | Filter state (search / role / host) narrows visible rows client-side; state resets on modal close (D-10, D-17) | ✓ VERIFIED | WakeupsModal.tsx:120-124 filter state; 220-237 visibleItems memo (case-insensitive search on name/prompt, role .includes, hostId match); 148-160 reset on close; T-04/T-05/T-06/T-15 tests pass |
| 5 | Row click (excluding toggle/kebab) enters edit mode; toggle/kebab stopPropagation (D-11, D-27) | ✓ VERIFIED | WakeupsModal.tsx:248-252 handleRowClick sets view="form"; WakeupsModalRow.tsx:104 row onClick, 203-204 toggle stopPropagation, 221-222 kebab stopPropagation, 249-250 edit menuitem stopPropagation, 262-263 delete menuitem stopPropagation (4 stopPropagations — exceeds D-11 minimum) |
| 6 | Loading state = 3 stacked Skeleton bars (RESEARCH Pitfall #1) | ✓ VERIFIED | WakeupsModal.tsx:544-550 — three `<Skeleton className="h-24 w-full ...">` bars while items===null |
| 7 | Empty state = centered dim helper text for both fleet-wide-zero + filter-narrows-to-zero (D-16) | ✓ VERIFIED | WakeupsModal.tsx:551-562 — dim `data-testid="wakeups-modal-empty-state"` with two copies: "No wake-ups on any host. Click + to create one." / "No wake-ups match this filter."; T-03 test asserts fleet-wide zero copy |
| 8 | Footer shows live count of visible rows + how many enabled (D-18) | ✓ VERIFIED | WakeupsModal.tsx:591-597 — `data-testid="wakeups-modal-footer-count"`, "N wake-ups · M enabled" unfiltered, "N of T · M enabled" when filtered |
| 9 | User can click '+' in modal header (list view) and land in create form (Name/Prompt/Roles/Host/Schedule empty) (D-19, D-20, D-27) | ✓ VERIFIED | WakeupsModal.tsx:380-395 '+' button; 295-298 enterCreateMode swaps view; WakeupsModalForm.tsx renders empty fields on `mode="create"` with `initialSpec=null`; T-08 test asserts empty Name (value === "") + enabled |
| 10 | Row click OR kebab-Edit lands in edit form pre-filled from row spec; Name + Host are read-only (D-11, D-21, RESEARCH Pitfall #5) | ✓ VERIFIED | WakeupsModal.tsx:606-614 renders `<WakeupsModalForm mode="edit" initialSpec={...find(slug)...}>`; WakeupsModalForm.tsx:377-378 `nameDisabled = hostDisabled = mode === "edit"`; 444-448 helper text "To rename, delete..." for Name; 547-565 helper "Host cannot be changed on an existing wake-up..." with `wakeups-modal-form-host-locked` chip; T-07/T-10 tests assert prefilled + disabled |
| 11 | User can fill form, click Save, and see modal refetch LIST + return to list view; on 409/500/network failure, inline banner shows API message verbatim + form stays open with values intact (D-19, D-25) | ✓ VERIFIED | WakeupsModalForm.tsx:245-353 onSave with in-flight guard (submitInFlightRef); 79-91 interpretError maps 409→"already exists" verbatim, 400→server msg, else generic; 394-416 banner `role="alert"` with `data-testid="wakeups-modal-form-error"` and dismiss X; WakeupsModal.tsx:300-304 backToList refetches + swaps to list; T-12 success test + T-13 409 error test both pass |
| 12 | Toggle click flips only after API PATCH acknowledges (pessimistic D-12); failure surfaces banner + no local flip | ✓ VERIFIED | WakeupsModal.tsx:257-267 handleToggleClick — awaits toggleWakeupEnabled, then refetch; on failure setToggleError + NO local flip (comment explicit); 491-504 banner renders `wakeups-modal-toggle-error` at top of list; T-09 test asserts both success (toggle text flips after refetch) + failure (banner + toggle text unchanged) |
| 13 | Kebab Delete → native window.confirm → API DELETE on OK → refetch (D-13, D-14) | ✓ VERIFIED | WakeupsModal.tsx:281-293 — window.confirm(`Delete wake-up "${row.name}"?`), then deleteWakeup + refetch on OK, banner on failure; T-11 test asserts confirmSpy called with exact string, DELETE called with slug+hostId, row disappears after refetch |
| 14 | Schedule segmented control offers Daily/Weekly/Interval/One-shot; Weekly single-day; round-trip via hydrateFormSchedule + buildSchedule (D-22, D-23, D-24) | ✓ VERIFIED | WakeupsModalForm.tsx:607-658 segmented control with 4 kinds; 682-737 weekly single-day segmented control (uses WEEKDAY_VALUES from WakeupFormShared); 45-56 imports hydrateFormSchedule/buildSchedule/validateForm/detectBrowserTimezone/WEEKDAY_VALUES/Weekday; NO RestrictToDaysChips (grep confirms absence) |
| 15 | Hand-edited spec fields (skills, schedule.timezone) survive edit-save; schedule.days is dropped (Option C / Pitfall #6) | ✓ VERIFIED | WakeupsModalForm.tsx:280-330 — buildSchedule emits browser tz; on edit-mode with existing `rawSched.timezone` (non-interval), preserves that verbatim; preservedSkills = initialSpec.skills on edit (empty on create); enabledPassthrough = initialSpec.enabled on edit; schedule.days never merged (explicit Option C dropping) |
| 16 | wakeups-api.ts covers all 5 helpers + 2 wire types with DELETE-with-body via axios data: config and error propagation | ✓ VERIFIED | wakeups-api.ts:75-170 — 5 async helpers, all wrap in try/catch → handleApiError; DELETE at line 166 uses `authApi.delete(url, { data: { host } })` (Pitfall #4); GlobalWakeupSpecWire type at :55 is fresh (Pitfall #2); no `instruction` string in the file (grep confirms) |
| 17 | 6 tests in wakeups-api.test.ts cover each helper + error propagation | ✓ VERIFIED | wakeups-api.test.ts:99-192 — T-01 listWakeups shape unwrap, T-02 createWakeup body, T-03 URL-encoding (slug with space → %20), T-04 toggleWakeupEnabled URL+body, T-05 DELETE-with-body (`data: { host: 1 }`), T-06 error propagation (409 → .status=409); all 6 pass in scoped vitest run |
| 18 | 15 tests in WakeupsModal.test.tsx (T-01..T-15) cover full behavioral surface | ✓ VERIFIED | WakeupsModal.test.tsx has `it("T-01`...`it("T-15` — closed/open, empty, filter narrow (search/role/host), row click + '+' → form, pessimistic toggle success + failure, kebab Edit + Delete + window.confirm, Save success + 409 banner, Cancel refetch, filter reset on close; all 15 pass |
| 19 | 4 tests in PrettyConversationsPanel.wakeups-button.test.tsx cover render + guard + click + position | ✓ VERIFIED | PrettyConversationsPanel.wakeups-button.test.tsx:208-275 — Test 1 chrome/a11y, Test 2 showPencilButton guard, Test 3 click opens WakeupsModal stub, Test 4 compareDocumentPosition confirms globe→wakeup→kebab order; all 4 pass |
| 20 | D-01 Consumer of shape 2's endpoints, no new backend surface | ✓ VERIFIED | `git diff --name-only` across 11 phase commits shows only .planning + src/ui/* — no src/backend/, no docker/, no nginx changes |
| 21 | D-02 Nginx paired blocks N/A — no new routes | ✓ VERIFIED | No docker/nginx.conf or docker/nginx-https.conf modifications (git diff --name-only) |
| 22 | D-03 No client cache — refetch on open + every write | ✓ VERIFIED | WakeupsModal.tsx:147-178 fetches on open + resets on close; 184-193 refetch helper called by handleToggleClick, handleDeleteFromKebab, backToList (form onSaved+onCancel) |
| 23 | D-05 Mobile — accept the squeeze | ✓ VERIFIED | No responsive breakpoints or media-query specific header consolidation added; button uses same .pv-pencil chrome as siblings |
| 24 | D-07 Component lives in src/ui/features/pretty-conversations/ (peer of ConversationSearchModal); WakeupsTab.tsx untouched | ✓ VERIFIED | New files at src/ui/features/pretty-conversations/WakeupsModal*.tsx; git diff --name-only shows no changes to src/ui/features/pretty-view/WakeupsTab.tsx |
| 25 | D-09 Host indicator per row = small subtle chip in metadata line | ✓ VERIFIED | WakeupsModalRow.tsx:45-49 HOST_CHIP_STYLE (subtle grey-blue tokens); 137-148 renders inside metadata `<div>` next to scheduleHuman |
| 26 | D-26 Modal is Radix Dialog controlled state lifted to PrettyConversationsPanel | ✓ VERIFIED | PrettyConversationsPanel.tsx:913 `useState(false)` for wakeupsModalOpen; :2995-2999 mount with `open={wakeupsModalOpen}` and `onOpenChange={setWakeupsModalOpen}` |
| 27 | D-27 Two internal states — list (default) and form (create OR edit) with correct transitions | ✓ VERIFIED | WakeupsModal.tsx:129-130 view + editingSlug state; 248-304 handlers: handleRowClick / handleEditFromKebab → form(edit); enterCreateMode → form(create); backToList → list + refetch; onEscapeKeyDown returns to list in form-view |
| 28 | D-28 No streaming affordances (no spinners lingering beyond writes) | ✓ VERIFIED | grep for `Loader2\|streaming\|typing indicator` finds only comment references explaining D-28; toggle uses "On"/"Off" text pill (no spinner glyph); Save button shows "Saving…" text swap (no animated glyph) per D-28 |
| 29 | D-29 Container mutation to deploy | ⚠️ DEFERRED (orchestrator scope) | Executor deliberately did NOT run docker build / push / compose up. Correct — this is D-30/D-31 discipline. See human_verification #8 |
| 30 | D-30 Standard fleet-rule serialization on container mutations | ⚠️ DEFERRED (orchestrator scope) | Executor did not push, did not deploy. `feat/tab-title-from-tmux` local only. See human_verification #7-8 |
| 31 | D-31 Full test suite green pre-deploy | ⚠️ DEFERRED (orchestrator scope) | Executor ran scoped `npx vitest related --run` per fleet rule "scoped during dev, full suite ONLY at deployment". Full suite is deploy-gate for orchestrator. See human_verification #7 |

**Executor score:** 28/28 verified. **Orchestrator-deferred:** 3 (D-29, D-30, D-31) — appropriate deferral per fleet-rule discipline; not gap.

## D-XX Coverage Table

| D-XX | Description (abbreviated) | Wave | Verified? | Evidence pointer |
|------|--------------------------|------|-----------|------------------|
| D-01 | Consumer of shape 2 endpoints, no new backend | 1 | ✓ | git diff — src/ui only |
| D-02 | Nginx paired blocks N/A | 1 | ✓ | No docker/nginx changes |
| D-03 | No client cache — refetch on open + write | 1 | ✓ | WakeupsModal.tsx:147, 184, 261, 289, 303 |
| D-04 | Header button in PrettyConversationsPanel, after Globe, before More | 1 | ✓ | PrettyConversationsPanel.tsx:2314-2323 |
| D-05 | Mobile squeeze accepted | 1 | ✓ | No responsive overrides added |
| D-06 | Chrome mirrors ConversationSearchModal recipe, 640×720 | 1 | ✓ | WakeupsModal.tsx:348-366 |
| D-07 | New component in pretty-conversations/, WakeupsTab.tsx untouched | 1 | ✓ | git diff — no WakeupsTab.tsx |
| D-08 | Default state on open is list; row shape name/meta/prompt/chips/actions | 1 | ✓ | WakeupsModal.tsx + WakeupsModalRow.tsx:127-191 |
| D-09 | Host chip in metadata line (subtle) | 1 | ✓ | WakeupsModalRow.tsx:141-148 |
| D-10 | Filter bar: search + role + host, left-to-right; no skill dropdown | 1 | ✓ | WakeupsModal.tsx:415-488 |
| D-11 | Row click enters edit; toggle + kebab stopPropagation | 1 | ✓ | WakeupsModalRow.tsx:203, 221, 249, 262 (4 stopPropagations) |
| D-12 | Pessimistic toggle; failure banner + no local flip | 2 | ✓ | WakeupsModal.tsx:257-267 + T-09 test |
| D-13 | Kebab = Edit + Delete only | 2 | ✓ | WakeupsModalRow.tsx:245-270 |
| D-14 | Delete confirmation = native window.confirm | 2 | ✓ | WakeupsModal.tsx:284 + T-11 test |
| D-15 | Loading = same as RoleModal pattern (3 Skeleton bars) | 1 | ✓ | WakeupsModal.tsx:544-550 |
| D-16 | Empty state — dim helper both fleet-wide + filtered | 1 | ✓ | WakeupsModal.tsx:551-562 |
| D-17 | Filter state resets on close | 1 | ✓ | WakeupsModal.tsx:148-160 + T-15 test |
| D-18 | Footer = count + how many enabled | 1 | ✓ | WakeupsModal.tsx:591-597 |
| D-19 | Form footer = Cancel left + Save right primary blue | 2 | ✓ | WakeupsModalForm.tsx:810-846 |
| D-20 | 5 fields Name/Prompt/Roles/Host/Schedule (NO skills picker) | 2 | ✓ | WakeupsModalForm.tsx:418-807; grep confirms no `wakeups-modal-form-skills` |
| D-21 | Host read-only on edit | 2 | ✓ | WakeupsModalForm.tsx:378, 547-565 |
| D-22 | Schedule = Daily/Weekly/Interval/One-shot | 2 | ✓ | WakeupsModalForm.tsx:607-802 |
| D-23 | Validation matches wakeup-scheduler.py parser exactly | 2 | ✓ | Uses validateForm from WakeupFormShared (which is scheduler-parity) |
| D-24 | Weekly single-day segmented (per parser) | 2 | ✓ | WakeupsModalForm.tsx:682-737 single-day only |
| D-25 | Save error UX = inline banner, verbatim message, form stays open | 2 | ✓ | WakeupsModalForm.tsx:394-416 + interpretError:79-91 + T-13 test |
| D-26 | Radix Dialog controlled state lifted to PrettyConversationsPanel | 1 | ✓ | PrettyConversationsPanel.tsx:913, 2995-2999 |
| D-27 | Two internal states list/form with correct transitions | 1+2 | ✓ | WakeupsModal.tsx:129, 248-304 |
| D-28 | No streaming affordances | 1+2 | ✓ | No Loader2 in modal; toggle text pill; Save "Saving…" text swap |
| D-29 | Container mutation to deploy | 1+2 | ⚠️ DEFERRED (orchestrator) | Human item #8 |
| D-30 | Fleet-rule serialization | 1+2 | ⚠️ DEFERRED (orchestrator) | Human items #7-8 |
| D-31 | Full test suite pre-deploy | 1+2 | ⚠️ DEFERRED (orchestrator) | Human item #7 |

**D-XX coverage: 28/28 executor-scope decisions VERIFIED. D-29/D-30/D-31 correctly deferred to orchestrator per fleet rule "Test discipline: scoped during dev, full suite ONLY at deployment".**

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/api/wakeups-api.ts` | 5 REST helpers + 2 wire types (GlobalWakeupSpecWire fresh, no `instruction`) | ✓ VERIFIED | 170 LOC. listWakeups (line 75), createWakeup (91), updateWakeup (113), toggleWakeupEnabled (139), deleteWakeup (164). Types WakeupListItem (38) + GlobalWakeupSpecWire (55). DELETE uses `data: { host }` axios config at line 166. No `instruction` string in file (Pitfall #2 gate). |
| `src/ui/features/pretty-conversations/WakeupsModal.tsx` | Radix Dialog shell + list view + real form-view via WakeupsModalForm + pessimistic toggle + delete-with-confirm | ✓ VERIFIED | 622 LOC. onInteractOutside preventDefault (Pitfall #7). md:max-w-[640px]. useEffect fetch-on-open with AbortController. Real WakeupsModalForm mount replaces wave-1 placeholder. handleToggleClick + handleDeleteFromKebab wired to API. Wave-1 TODO(wave 2) markers removed. |
| `src/ui/features/pretty-conversations/WakeupsModalRow.tsx` | Presentational row: name / meta+host chip / 2-line prompt / role+skill chips / toggle + kebab with stopPropagation | ✓ VERIFIED | 277 LOC. Pure presentation (no API calls). 4 stopPropagations. testids: row, row-host, row-toggle, row-kebab, row-edit, row-delete. 2-line clamp via -webkit-line-clamp:2. |
| `src/ui/features/pretty-conversations/WakeupsModalForm.tsx` | 5-field create/edit form (Name/Prompt/Roles/Host/Schedule) + Cancel/Save + inline error banner + submitInFlightRef guard + Option C round-trip preservation | ✓ VERIFIED | 851 LOC. All 5 fields per D-20 order. Name+Host disabled on edit-mode with helper text. Roles chip-picker (magenta selected / dim addable). Schedule segmented with 4 kinds; Weekly single-day segmented. Option C: preserves initialSpec.skills + initialSpec.schedule.timezone (non-interval), drops schedule.days. interpretError maps 409→"already exists" verbatim. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 5 surgical additions: AlarmClock import, WakeupsModal import, useState, header button, modal mount, docstring update | ✓ VERIFIED | AlarmClock added to lucide import (line 67). WakeupsModal import (160). wakeupsModalOpen useState (913). Header button (2314-2323, position between Globe and feedback/kebab). Modal mount (2995-2999). Docstring updated to 8-button cluster with Wake-ups at position 6. |
| `src/ui/api/wakeups-api.test.ts` | 6 tests (5 helpers + error propagation) with module-level vi.mock | ✓ VERIFIED | 192 LOC. T-01..T-06 all pass in scoped vitest. T-05 asserts `data: { host: 1 }` axios call arg (Pitfall #4 executable gate). T-03 asserts space-in-slug → %20 URL encoding. |
| `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` | 15 behavioral tests T-01..T-15 | ✓ VERIFIED | 584 LOC. All 15 pass. Covers closed/open, empty, filter narrow, row click + '+' → form, pessimistic toggle success + failure, kebab Edit + Delete with window.confirm mock, Save success + 409 banner, Cancel refetch, filter reset. FakeApiError class mirrors main-axios ApiError shape. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` | 4 panel-button tests | ✓ VERIFIED | 275 LOC. All 4 pass. Test 4 uses compareDocumentPosition to prove globe→wakeup→kebab order. Mock boilerplate mirrors new-role-button.test.tsx pattern. |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| PrettyConversationsPanel.tsx | WakeupsModal.tsx | `import { WakeupsModal }` + `<WakeupsModal open={wakeupsModalOpen} onOpenChange={setWakeupsModalOpen} hostTree={hostTree ?? null} />` | ✓ WIRED | Line 160 import; :2995-2999 mount |
| WakeupsModal.tsx | wakeups-api.ts | `import { listWakeups, toggleWakeupEnabled, deleteWakeup }` + `useEffect(open)` fetch + write handlers | ✓ WIRED | Lines 53-58 imports; :164-176 fetch; :260 toggle call; :288 delete call |
| WakeupsModal.tsx | WakeupsModalForm.tsx | `import { WakeupsModalForm }` + `<WakeupsModalForm mode initialSpec flatHosts onCancel onSaved>` | ✓ WIRED | Line 60 import; :605-615 mount with mode/initialSpec/flatHosts/callbacks |
| WakeupsModalForm.tsx | WakeupFormShared.tsx | `import { hydrateFormSchedule, buildSchedule, validateForm, detectBrowserTimezone, WEEKDAY_VALUES }` | ✓ WIRED | Lines 45-56; used in hydration at :194, buildSchedule at :285, validateForm at :264, detectBrowserTimezone at :284 |
| WakeupsModalForm.tsx | wakeups-api.ts | `import { createWakeup, updateWakeup }` used in Save handler | ✓ WIRED | Lines 57-62; :333 createWakeup; :335 updateWakeup |
| WakeupsModalForm.tsx | identities-api.ts | `listRolesForHost` for the form's Roles chip-picker | ✓ WIRED | Line 63; :232 useEffect(selectedHost) fetch |
| wakeups-api.ts | GET /wakeups | `authApi.get("/wakeups")` returning `{items: WakeupListItem[]}` | ✓ WIRED | :77 helper call; :107 test asserts URL |
| wakeups-api.ts | POST /wakeups | `authApi.post("/wakeups", { host, spec })` | ✓ WIRED | :96; T-02 test asserts URL+body |
| wakeups-api.ts | PATCH /wakeups/:slug | `authApi.patch(\`/wakeups/${encodeURIComponent(slug)}\`, { host, spec })` | ✓ WIRED | :119; T-03 test asserts URL-encoding |
| wakeups-api.ts | PATCH /wakeups/:slug/toggle-enabled | `authApi.patch(url, { host, enabled })` | ✓ WIRED | :145; T-04 test asserts URL+body |
| wakeups-api.ts | DELETE /wakeups/:slug | `authApi.delete(url, { data: { host } })` (body via axios data:) | ✓ WIRED | :166; T-05 test asserts `data: { host }` config (Pitfall #4 executable gate) |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| WakeupsModal.tsx | `items` state | `listWakeups()` → `authApi.get("/wakeups")` → `{items: WakeupListItem[]}` | Yes — real HTTP fetch against shape-2 endpoint (which SSH fan-outs across managed hosts) | ✓ FLOWING |
| WakeupsModalRow.tsx | `row` prop | Passed from `WakeupsModal.tsx`'s `visibleItems.map` | Yes — flows from items state | ✓ FLOWING |
| WakeupsModalForm.tsx | `initialSpec` prop | Passed from WakeupsModal.tsx: `items?.find(i => i.slug === editingSlug) ?? null` (edit) or `null` (create) | Yes — either resolved from list state or null for create | ✓ FLOWING |
| WakeupsModalForm.tsx | `availableRoles` state | `listRolesForHost(selectedHost.id)` — real GET /roles?hostId=... call | Yes — depends on host selection | ✓ FLOWING |
| WakeupsModalForm.tsx | `formSchedule` state | On create: default `{type: "daily", at: "09:00"}`; on edit: `hydrateFormSchedule(initialSpec.schedule)` | Yes — hydrated from spec on edit or seeded on create | ✓ FLOWING |
| PrettyConversationsPanel.tsx | `hostTree` prop threading | Panel receives hostTree from parent; passes through to WakeupsModal | Yes — real user-scoped host tree via existing panel prop pipeline | ✓ FLOWING |

No hollow-prop / disconnected-data findings.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type-check all touched files | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Run scoped test suite for phase 129 files (wave 1 + wave 2 + panel test) | `npx vitest related --run <7 files>` | 11 test files, 205 tests passed | ✓ PASS |
| Grep — banned strings ("ashley", "gigaashley", "ashleycook") across new files | `grep -Rni "ashley\|gigaashley\|ashleycook" <7 files>` | no output | ✓ PASS |
| Grep — no debt markers (TBD/FIXME/XXX) in touched files | `grep -n "TBD\|FIXME\|XXX" <7 files>` | no output | ✓ PASS |
| Grep — no wave-1 stubs remain in WakeupsModal.tsx | `grep -n "TODO(wave 2)\|wakeups-modal-form-placeholder" WakeupsModal.tsx` | no output | ✓ PASS |
| Grep — no `instruction` in wakeups-api.ts (Pitfall #2 gate) | `grep -n "instruction" src/ui/api/wakeups-api.ts` | no output | ✓ PASS |
| Grep — no RestrictToDaysChips in form (D-24 Assumption A4) | `grep -n "RestrictToDaysChips" WakeupsModal*.tsx` | no output | ✓ PASS |
| Grep — no `Loader2` spinner or streaming affordances (D-28) | `grep -n "Loader2\|typing indicator\|streaming" WakeupsModal*.tsx wakeups-api.ts` | only comment references explaining D-28 policy | ✓ PASS |
| Git — 11 commits on feat/tab-title-from-tmux, no deploy/docker/nginx changes | `git log --oneline 2254d693^..29dbbe94 \| grep -iE "docker\|deploy\|push\|nginx\|no-verify"` | no output; all commits are frontend + planning docs | ✓ PASS |
| Git — no `--no-verify` flag used | `git log --format=%B 2254d693^..29dbbe94 \| grep no-verify` | no output | ✓ PASS |

**All 10 spot-checks PASS.**

## Requirements Coverage

Phase 135 is a D-XX-driven phase (RESEARCH.md § Phase Requirements: "This phase is not covered by REQUIREMENTS.md ... The D-XX decisions ARE the requirements"). Full D-XX coverage documented above.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | (none) | — | — |

Zero anti-patterns found in the new/modified files. No debt markers, no unreferenced TODOs, no hardcoded empty data flowing to rendering, no console.log-only implementations, no `dangerouslySetInnerHTML`, no query-param DELETE misuse, no reuse of retired WakeupSpecWire.

## Human Verification Required

See YAML frontmatter `human_verification:` block for 8 items detailed above. Summary:

1. **Real-browser chrome + focus-trap** — Radix Portal + Tailwind arbitrary-values need a real desktop viewport (unit tests can't cover chrome fidelity).
2. **Live fleet-wide LIST fetch over SSH** — shape 2's backend fan-out needs a running fleet.
3. **Pessimistic toggle timing under real network latency** — unit tests mock timing.
4. **Native window.confirm() in real browser** — JSDOM does not render this dialog.
5. **On-disk verification of create + edit round-trip** — needs SSH to a managed host to verify `~/fleet/wakeups/<slug>/wakeup.json` writes.
6. **Filter reset visual smoke — all three controls (search + role + host)** — unit tests exercise search directly; role/host reset is indirect.
7. **Orchestrator: full test suite pre-deploy** (D-31 fleet-rule discipline) — `npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium`.
8. **Orchestrator: deploy motion** (D-29) — `git pull --rebase` + `docker build` + `docker compose up --force-recreate skynet`, bundled ship with shape 2 per campaign auth.

## Gaps Summary

**None within executor scope.** All 28 executor-scope D-XX decisions are shipped in code with proper wiring and test coverage. All 7 RESEARCH pitfalls are mitigated (verified individually). Banned-strings gate clean. No deploy commands committed. No `--no-verify` flags. All 11 commits on the correct branch. Full 205-test scoped verification suite green. `tsc --noEmit` clean.

The 3 remaining D-XX decisions (D-29 deploy, D-30 serialization, D-31 pre-deploy full-suite) are orchestrator-exclusive per fleet-rule discipline and correctly deferred. These are the items in the human_verification block, not gaps.

**Verdict: VERIFICATION PASSED (human_needed).** Code delivers the phase goal end-to-end within executor scope; the remaining human-eyes items (browser chrome smoke, SSH fan-out live, deploy motion) are the expected orchestrator surface after wave-2 code completion.

---

*Verified: 2026-09-24T11:15:00Z*
*Verifier: Claude (gsd-verifier)*
