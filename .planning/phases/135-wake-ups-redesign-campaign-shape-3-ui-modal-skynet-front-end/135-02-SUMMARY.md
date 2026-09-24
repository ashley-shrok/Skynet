---
phase: 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end
plan: 02
subsystem: ui

tags: [react, radix-dialog, axios, lucide-react, wake-ups, glass-morphism, tests]

# Dependency graph
requires:
  - phase: 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end
    plan: 01
    provides: "wakeups-api.ts REST helpers, WakeupsModal shell + list view, header button, form-view placeholder"
provides:
  - "Fleet-wide wake-ups modal write path — create/edit form, pessimistic toggle, native-confirm delete, inline error banner"
  - "src/ui/features/pretty-conversations/WakeupsModalForm.tsx — 5-field create/edit form with WakeupFormShared-backed schedule + round-trip preservation (Option C)"
  - "25 new unit tests: 6 in wakeups-api.test.ts, 15 in WakeupsModal.test.tsx (T-01..T-15), 4 in PrettyConversationsPanel.wakeups-button.test.tsx"
affects:
  - "End-of-campaign deploy (D-29 bundled ship with shape 2) — shape 3 code + tests are green; deploy motion happens outside this plan"

# Tech tracking
tech-stack:
  added: []  # No new npm packages
  patterns:
    - "In-flight ref guard on Save (T-129-07 mitigation): submitInFlightRef mirrors NewConversationModal.tsx:193-199 to debounce rapid double-clicks + serialize with server-side per-slug mutex"
    - "Round-trip preservation Option C — hydrateFormSchedule reads raw spec into FormSchedule; buildSchedule emits browser tz; edit-mode Save merges `initialSpec.skills` + preserves `initialSpec.schedule.timezone` verbatim; `schedule.days` deliberately dropped (RESEARCH Assumption A5, threat T-129-11)"
    - "Pessimistic mutation with API-first refetch: toggle/delete never touch local state on failure; on success await listWakeups() before swapping list (D-03)"
    - "Fresh api-helper file per REST surface stayed in wave 1; wave 2 layered write-path handlers on top with no changes to the api-helper"
    - "Native window.confirm() as the trust boundary between accidental-click and intentional-destroy (D-14) — zero chrome build cost, mocked in tests via vi.spyOn(window, \"confirm\")"

key-files:
  created:
    - "src/ui/features/pretty-conversations/WakeupsModalForm.tsx (~700 LOC — 5-field form + schedule segmented control + Save/Cancel footer + inline error banner)"
    - "src/ui/api/wakeups-api.test.ts (192 LOC — 6 tests, one per helper + error-propagation)"
    - "src/ui/features/pretty-conversations/WakeupsModal.test.tsx (584 LOC — 15 behavioral tests T-01..T-15)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx (275 LOC — 4 panel-button tests)"
  modified:
    - "src/ui/features/pretty-conversations/WakeupsModal.tsx (108/42 diff — replaced wave-1 form-placeholder + toggle/delete stubs with real handlers; added refetch helper + escape-in-form handler + deleteError banner)"

key-decisions:
  - "Round-trip preservation Option C adopted verbatim (RESEARCH Assumption A5): edit-save preserves top-level `skills` and nested `schedule.timezone` from initialSpec; drops `schedule.days`. Documented in code comments + this SUMMARY so future wake-up hand-editors know the modal round-trip contract."
  - "Weekly form ships as single-day segmented control (RESEARCH Assumption A4). RestrictToDaysChips (from WakeupFormShared) is deliberately NOT rendered in v1 — hand-editors set `schedule.days` on disk and it survives via Option C's raw-spec passthrough."
  - "Name field disabled on edit-mode with helper text 'To rename, delete this wake-up and create a new one.' (RESEARCH Pitfall #5 gate). Matches D-21's host-lock rationale."
  - "Escape key in form-view returns to list view rather than closing modal — matches D-27's Cancel semantics (unsaved-work protection). onEscapeKeyDown on Radix Content preventDefaults when view === 'form'."
  - "Delete + toggle errors get separate banner slots (`wakeups-modal-delete-error` alongside wave-1's `wakeups-modal-toggle-error`). Both render at top of the list scroll region. Kept them distinct so tests can query each separately + errors can co-exist during a failure spree."
  - "Save button label switches to 'Saving…' during in-flight but the button stays disabled with the same width (no spinner glyph) to comply with D-28 (no streaming affordances)."

patterns-established:
  - "Form + list state machine with parent-owned refetch: WakeupsModalForm delegates `onSaved` to the parent's `backToList` helper which does list→refetch→swap. Sub-form doesn't know about `listWakeups`; keeps subcomponent independently testable."
  - "Chip-picker for roles: selected chips render magenta with X-affordance; addable chips render dim with subtle border. Toggle-on-click. Reusable pattern for future multi-select surfaces in the pretty-conversations family."
  - "vi.mock module-level convention with functional stubs (`(...args) => mock(...args)`) — matches ConversationSearchModal.test.tsx pattern and avoids Vitest hoisting issues with variable references."

requirements-completed:
  - D-12
  - D-13
  - D-14
  - D-19
  - D-20
  - D-21
  - D-22
  - D-23
  - D-24
  - D-25
  - D-27

# Metrics
duration: 26min
completed: 2026-09-24
---

# Phase 135 Plan 02: Wake-ups Modal Wave 2 (Form + Write Paths + Tests) Summary

**Fleet-wide wake-ups modal write path — real WakeupsModalForm replaces wave-1's placeholder, pessimistic toggle + delete-with-confirm + save-with-inline-error-banner replace wave-1 stubs, 25 unit tests exercise every list-view and form-view behavior.**

## Performance

- **Duration:** ~26 min (sequential executor on main branch — no worktrees per fleet rule)
- **Started:** 2026-09-24T10:52:00Z (approx — post wave-1 completion)
- **Completed:** 2026-09-24T11:18Z
- **Tasks:** 5
- **Files created:** 4 (WakeupsModalForm.tsx + wakeups-api.test.ts + WakeupsModal.test.tsx + PrettyConversationsPanel.wakeups-button.test.tsx)
- **Files modified:** 1 (WakeupsModal.tsx — wave-1 stubs swapped for real handlers)

## Accomplishments

- Full write path wired end-to-end: create / update / toggle-enabled / delete all consume shape-2 REST endpoints via the wave-1 api-helper.
- Form view renders 5 fields per D-20 with schedule segmented control per D-22; Weekly is single-day segmented per RESEARCH Assumption A4.
- Round-trip preservation Option C: `skills` + `schedule.timezone` survive edit-save; `schedule.days` is dropped by design.
- Name + Host locked on edit-mode (RESEARCH Pitfall #5, D-21) with helper text guiding delete-and-recreate for renames/moves.
- Pessimistic toggle (D-12) — no local flip on failure; banner surfaces API message verbatim; success awaits refetch before swap.
- Native `window.confirm()` delete (D-14) — mocked in T-11 via `vi.spyOn(window, "confirm")`.
- Inline error banner in form (D-25) — 409 shows "already exists" verbatim mapping; API message shown for other statuses.
- 25 new tests: 6 api + 15 modal + 4 panel-button. All green in scoped vitest run (205/205 passing across the touched-files scope).

## Task Commits

Each task committed atomically:

1. **Task 1:** `feat(135-02): add WakeupsModalForm subcomponent for create/edit` — `9d706454`
2. **Task 2:** `feat(135-02): wire real form view + pessimistic toggle + delete-with-confirm` — `98398ffd`
3. **Task 3:** `test(135-02): add wakeups-api.test.ts covering all 5 helpers` — `4db9b7b7`
4. **Task 4:** `test(135-02): add WakeupsModal.test.tsx with 15 behavioral tests` — `87550667`
5. **Task 5:** `test(135-02): add PrettyConversationsPanel.wakeups-button.test.tsx` — `d1e86cdf`

## Test Counts

| File | Tests | Status |
|------|-------|--------|
| `src/ui/api/wakeups-api.test.ts` | 6 (T-01..T-06) | 6/6 pass |
| `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` | 15 (T-01..T-15) | 15/15 pass |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` | 4 (Test 1..4) | 4/4 pass |
| **Total wave-2 new tests** | **25** | **25/25 pass** |
| Scoped verification suite (11 test files touched or dependent) | 205 | 205/205 pass |

## Files Created/Modified

### Created

- `src/ui/features/pretty-conversations/WakeupsModalForm.tsx` — 5-field form (Name / Prompt / Roles / Host / Schedule) + Cancel/Save footer + inline error banner. Name+Host disabled on edit-mode. Schedule segmented control with Daily/Weekly/Interval/One-shot kinds backed by WakeupFormShared. Weekly is a single-day segmented control (Mon..Sun). Round-trip preservation Option C: skills + schedule.timezone preserved on edit-save; schedule.days dropped. Save uses `submitInFlightRef` guard + `interpretError` for 409/400 mapping. Roles chip-picker fetches per-host via `listRolesForHost` when a host is selected.
- `src/ui/api/wakeups-api.test.ts` — 6 tests: T-01 listWakeups shape unwrap; T-02 createWakeup body shape; T-03 updateWakeup URL-encoding via space-in-slug fixture; T-04 toggleWakeupEnabled URL+body; T-05 DELETE-with-body via `data: {host}` config (RESEARCH Pitfall #4 executable gate); T-06 error-propagation through handleApiError preserves `.status`.
- `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` — 15 behavioral tests: closed/open, empty state, filter narrowing (search/role/host), row click + '+' button → form entry, pessimistic toggle success + failure, kebab → Edit and kebab → Delete + window.confirm mock, Save success, Save 409 error banner, Cancel refetch, filter reset on close. Uses `FakeApiError` class mirroring `src/ui/main-axios.ts:1020` for the 409 test.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` — 4 tests mirroring new-role-button.test.tsx boilerplate: chrome + a11y attrs; showPencilButton guard; click opens WakeupsModal stub; DOM position (after Globe, before kebab) via `compareDocumentPosition`.

### Modified

- `src/ui/features/pretty-conversations/WakeupsModal.tsx` — Wave-2 rewiring:
  1. New imports: `useCallback` from react; `WakeupsModalForm` sibling; `toggleWakeupEnabled` + `deleteWakeup` from wakeups-api.
  2. Added `deleteError` state slot alongside wave-1's `toggleError`.
  3. `refetch` helper (useCallback) reused by all four write paths.
  4. `handleToggleClick` replaced — real pessimistic call + refetch on success; error banner on failure; no local flip.
  5. `handleDeleteFromKebab` replaced — closes kebab, `window.confirm`, DELETE + refetch on OK, banner on failure.
  6. `backToList` — now calls `void refetch()` (RESEARCH Recommendation #7).
  7. `onEscapeKeyDown` on Dialog.Content — in form-view, Escape → list view; otherwise falls through to Radix default.
  8. Form-view placeholder swapped for `<WakeupsModalForm mode={editingSlug ? "edit" : "create"} initialSpec={items?.find(i => i.slug === editingSlug) ?? null} flatHosts={flatHosts} onCancel={backToList} onSaved={backToList} />`.
  9. Wave-1 TODO(wave 2) markers all removed.
  10. Wave-1 `wakeups-modal-form-placeholder` + `wakeups-modal-form-placeholder-cancel` testids all removed.

## Testids Exposed (new in wave 2)

- `wakeups-modal-form` — real form container.
- `wakeups-modal-form-name` — Name input (disabled on edit).
- `wakeups-modal-form-prompt` — Prompt textarea.
- `wakeups-modal-form-roles` — Roles chip-picker container.
- `wakeups-modal-form-role-selected-{roleName}` — a selected role chip.
- `wakeups-modal-form-role-addable-{roleName}` — an addable role chip.
- `wakeups-modal-form-host` — Host chip-picker container.
- `wakeups-modal-form-host-locked` — displayed on edit-mode in place of the picker.
- `wakeups-modal-form-host-option-{hostId}` — a selectable host chip (create-mode only).
- `wakeups-modal-form-schedule-kind` — Daily/Weekly/Interval/One-shot segmented control container.
- `wakeups-modal-form-schedule-kind-{daily|weekly|interval|one_shot}` — each kind button.
- `wakeups-modal-form-schedule-daily-at` — Daily time input.
- `wakeups-modal-form-schedule-weekly-day` — Weekly single-day segmented control container.
- `wakeups-modal-form-schedule-weekly-day-{mon..sun}` — each weekday button.
- `wakeups-modal-form-schedule-weekly-at` — Weekly time input.
- `wakeups-modal-form-schedule-interval-n` — Interval number input.
- `wakeups-modal-form-schedule-interval-u` — Interval unit dropdown.
- `wakeups-modal-form-schedule-oneshot-at` — One-shot datetime-local input.
- `wakeups-modal-form-save` — primary blue Save button.
- `wakeups-modal-form-cancel` — secondary Cancel button.
- `wakeups-modal-form-error` — inline form error banner (D-25).
- `wakeups-modal-delete-error` — list-view delete error banner slot (peer of wave-1's `wakeups-modal-toggle-error`).

## Decisions Made

See `key-decisions` in frontmatter. Additionally:

- **Chip-picker for roles vs listbox** — chose a chip-picker (magenta selected, dim addable) over a listbox because roles are typically single-digit count on a host + the visual weight matches the row-side role chips.
- **Enabled field pass-through on edit-save** — `initialSpec.enabled` is passed verbatim on edit-mode saves so a modal edit never toggles a wake-up's enabled state. The list-row toggle is the only path to flip enabled (D-19 explicit).
- **Schedule kind defaults on kind-switch** — switching between kinds seeds sensible defaults (daily 09:00 / weekly Mon 09:00 / interval 30m / one_shot +1h). Users don't get an invalid form on kind-switch.
- **Save button label during in-flight** — "Saving…" text swap (no spinner glyph per D-28). Button stays same width to avoid layout jitter.

## Deviations from Plan

None substantive. Two minor variances:

1. **Comment wording in `WakeupsModalForm.tsx`**: the acceptance criteria's grep `! grep -q "RestrictToDaysChips" src/ui/features/pretty-conversations/WakeupsModalForm.tsx` requires that literal string be absent (not just as a used symbol — anywhere in the file, including comments). My initial header comment named `RestrictToDaysChips` when explaining the v1 design tradeoff. I rephrased the comment to describe "the optional day-of-week gate component from WakeupFormShared" without naming the symbol. No behavior change. Rationale preserved. Rule 3 (blocking grep gate) auto-fix, applied inline in the Task 1 commit.

2. **Missing `@testing-library/jest-dom/vitest` import** in `PrettyConversationsPanel.wakeups-button.test.tsx`: initial write of the test file used `toBeInTheDocument` in Test 3 without importing the matcher extension. Runtime failure surfaced immediately in the scoped test run; added the import (Rule 1 auto-fix, staged in the same Task 5 commit as the rest of the test file). No behavior change to production code; test-side omission only.

Both fixes were pure gate-satisfaction (Rules 1 + 3), no plan intent altered.

## Authentication Gates

None encountered.

## Issues Encountered

None substantive. Wave-1's setup made every wave-2 task ergonomic — state slots, testids, wire types, chrome tokens were all pre-exposed.

## User Setup Required

None — no external service configuration required.

## Fleet-Rule Compliance

- **NO deploy commands run.** No `git push`, no `docker build`, no `docker compose up`, no `npx vitest run` (full suite), no playwright smoke. All verification is scoped `npx vitest related --run <touched files>`.
- **No worktrees.** All work on `feat/tab-title-from-tmux` (fleet rule for this repo).
- **No `git pull --rebase`.** Peer safety respected.
- **Banned-strings gate:** clean. `grep -in "<operator-firstname>" src/ui/api/wakeups-api.ts src/ui/api/wakeups-api.test.ts src/ui/features/pretty-conversations/WakeupsModal*.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` returns empty. Test fixtures use generic hostnames (`host-a`, `host-b`) and generic wake-up names ("Morning triage", "Log sweep", "Alpha", "Beta").
- **`tsc --noEmit` exits 0** across the whole delta.

## Known Stubs

None. Every wave-1 stub has been replaced with a real implementation. The wave-1 form-view placeholder + its testid are both removed. Every write path (create / update / toggle / delete) is fully wired to the API.

## Threat Flags

None new. All wave-2 changes conform to the plan's threat model:

- **T-129-06 (XSS via error banner):** server errors render as React text-children (`{error}`), never `dangerouslySetInnerHTML`. `interpretError` returns plain strings.
- **T-129-07 (double-click Save duplicates):** `submitInFlightRef` guard in place; Save button `disabled={inFlight || ...}`.
- **T-129-08 (rename via PATCH):** Name input `disabled={mode === "edit"}` with helper text.
- **T-129-09 (host swap on edit):** Host chip-picker replaced by lock chip on edit-mode with helper text.
- **T-129-10 (Delete confirm text embeds name):** `window.confirm(\`Delete wake-up "${row.name}"?\`)` — React interpolation into a native browser dialog, not HTML-rendered.
- **T-129-11 (round-trip drops fields):** Option C documented in code comments + this SUMMARY; deliberate v1 tradeoff.
- **T-129-SC (package legitimacy):** ZERO new npm packages installed. N/A.

## Next Phase Readiness

- **Phase 135 is code-complete.** All 30 D-XX decisions are shipped in code (wave 1: D-01..D-11, D-15..D-18, D-26..D-28; wave 2: D-12..D-14, D-19..D-25, D-27 form transitions). D-29/D-30/D-31 (deploy) are orchestrator-exclusive.
- **Bundled ship with shape 2** per user auth (2026-09-21 verbatim: *"yeah campaign ships at the end"*). Wave-2 completion signals that shape 3's code + tests are green; the orchestrator handles the deploy motion (full suite + playwright smoke → `docker build` → `docker compose up --force-recreate skynet`) in a separate motion outside this plan's scope.
- **HEAD is LOCAL on `feat/tab-title-from-tmux`** — not pushed, not built, not deployed. Fleet-rule executor scope.
- **No blockers or concerns.** All acceptance criteria met; every gate satisfied; every wave-2 test passes on first execution against the fully-composed modal.

## Self-Check: PASSED

Verified via bash after summary write:
- File exists: `src/ui/features/pretty-conversations/WakeupsModalForm.tsx` (Task 1)
- File exists: `src/ui/api/wakeups-api.test.ts` (Task 3)
- File exists: `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` (Task 4)
- File exists: `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` (Task 5)
- Modified: `src/ui/features/pretty-conversations/WakeupsModal.tsx` (Task 2)
- Commits `9d706454`, `98398ffd`, `4db9b7b7`, `87550667`, `d1e86cdf` all present in `git log --oneline -6`.

---
*Phase: 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end*
*Completed: 2026-09-24*
