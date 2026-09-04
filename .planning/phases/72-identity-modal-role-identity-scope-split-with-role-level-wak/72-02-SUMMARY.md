---
phase: 72-identity-modal-role-identity-scope-split-with-role-level-wak
plan: 02
subsystem: frontend
tags: [wakeups, ui, sub-modal, scope-pill, delete-confirm, wakeups-tab, add-wakeup-dialog, shared-helpers]

requires:
  - phase: 72
    plan: 01
    provides: "WakeupSpecWire wire type + 6 identity-scope/role-scope create/delete WS handlers (consumed by Wave 3, not this wave)"
  - phase: 17g
    provides: "WakeupsTab foundation (list + inline update) + Wakeup wire type"
  - phase: 65
    plan: 02
    provides: "day-chip UI + normalizeDays round-trip discipline (moved into WakeupFormShared)"

provides:
  - "WakeupsTab.tsx now accepts scope prop + onCreate + onDelete callbacks; renders Add-wakeup pill + AddWakeupDialog + per-row trash-with-confirm + per-row scope pill"
  - "AddWakeupDialog.tsx — new Radix Dialog-in-Dialog sub-modal with 6 CONTEXT.md-locked form fields including optional IANA Timezone override"
  - "WakeupFormShared.tsx — new co-located module with FormSchedule discriminated union + hydrate/build/validate helpers + RestrictToDaysChips (extracted from WakeupsTab in a non-behavior-change refactor)"
  - "IdentityModal.tsx L1905 call site patched with stub scope+onCreate+onDelete values (Wave 3 replaces with real wiring)"
  - "11 new WakeupsTab.test.tsx tests (13-23) + 12 new AddWakeupDialog.test.tsx tests (A-L)"

affects: [72-03, 72-04, identity-modal, wakeups-tab]

tech-stack:
  added:
    - "@radix-ui/react-alert-dialog (already present, first consumer in pretty-view)"
  patterns:
    - "Sub-component extraction to a co-located shared module for helpers consumed by 2+ siblings (WakeupFormShared)"
    - "Stub-values pattern for a required-prop transition (interim state between plan waves) — avoids @ts-expect-error diagnostic instability"
    - "Nested-button-safe UI: role='button' <span> with onClick + onKeyDown Enter/Space handlers, when the outer element is already a <button> (HTML disallows nested buttons)"
    - "AlertDialog description query-by-role scoping in tests (avoids matching header-row wakeup-name span with the same slug text)"

key-files:
  created:
    - "src/ui/features/pretty-view/AddWakeupDialog.tsx (~370 lines — Radix Dialog-in-Dialog sub-modal, 6 CONTEXT.md-locked fields)"
    - "src/ui/features/pretty-view/AddWakeupDialog.test.tsx (~270 lines — 12 tests A-L)"
    - "src/ui/features/pretty-view/WakeupFormShared.tsx (~230 lines — non-behavior-change extraction)"
  modified:
    - "src/ui/features/pretty-view/WakeupsTab.tsx (+scope prop, +onCreate/onDelete props, +Add-wakeup pill, +AddWakeupDialog mount, +trash icon + AlertDialog confirm, +scope pill on every row)"
    - "src/ui/features/pretty-view/WakeupsTab.test.tsx (+11 tests 13-23 covering the new affordances for both scopes)"
    - "src/ui/features/pretty-view/IdentityModal.tsx (L1905 call site now passes scope='identity' + no-op onCreate/onDelete stubs + TODO Wave 3 comment)"

key-decisions:
  - "Stub-values pattern at IdentityModal L1905 over @ts-expect-error suppression — three required props via three directives risks TS2578 (unused directive) if TS coalesces them; stubs are typecheck-stable and behavior-neutral for the interim"
  - "Trash icon + scope pill rendered as role='button' spans (not <button>) in view mode — the outer disclosure header is already a <button> and HTML disallows nested buttons"
  - "Add-wakeup pill rendered in BOTH data + empty-state branches so first-wakeup flow is always reachable (per plan action step 2)"
  - "AddWakeupDialog is scope-agnostic beyond a scope-labeled title (the parent chooses which callback to hand to onSubmit) — reinforces CONTEXT.md's 'no scope confusion' spirit-violation guardrail without coupling the dialog to WS-plumbing"
  - "AlertDialog description scoped via role='alertdialog' querySelector in test 17 to disambiguate from the wakeup-name span in the header row that also contains the slug text"
  - "Shared helpers extracted to a co-located .tsx module (WakeupFormShared.tsx) rather than a pure .ts + a separate .tsx — one import site is simpler and RestrictToDaysChips is small enough that co-location doesn't hurt tree-shakeability"
  - "Sub-repos not touched — this is a single-repo project (no `sub_repos` config); commit-to-subrepo not applicable"

patterns-established:
  - "Timezone override wiring: `const effectiveTz = tzDraft.trim() !== '' ? tzDraft.trim() : detectedTz;` — blank falls back to browser-detected, user string wins; passed to buildSchedule which OMITS timezone for interval per L167-172 (matches CONTEXT.md's 'applies to Daily/Weekly/One-shot only' lock)"
  - "Slug enablement gate: client-side normalizeSlug (kebab-case, matches backend's writeRoleWakeupCreate regex) used ONLY to disable Save when the name normalizes to empty — server owns authoritative slug derivation and client never sends its own slug (defense against slug/name mismatch)"

requirements-completed: []

# Metrics
duration: 40min
completed: 2026-09-04
---

# Phase 72 Plan 02: Frontend WakeupsTab scope + full CRUD affordances Summary

**WakeupsTab now supports full CRUD parity (list + inline update + add via sub-modal + delete via trash-confirm) and accepts a `scope: "role" | "identity"` prop; each row visibly wears its scope. Wave 3 will consume this component in two scoped tab panes with real WS-plumbing.**

## Performance

- **Duration:** ~40 minutes end-to-end (both tasks + 3 commits + regression sweep across all 6 IdentityModal test files)
- **Started:** 2026-09-04T08:02:11Z
- **Completed:** 2026-09-04T08:41:02Z (approx, at final commit time)
- **Tasks:** 2 / 2 completed
- **Files created:** 3 (AddWakeupDialog.tsx, AddWakeupDialog.test.tsx, WakeupFormShared.tsx)
- **Files modified:** 3 (WakeupsTab.tsx, WakeupsTab.test.tsx, IdentityModal.tsx)

## Accomplishments

### Task 1 — Shared helpers extraction + AddWakeupDialog + 12 tests

**Commit 1 (e7aa6e00):** `refactor(72-02): extract shared wakeup-form helpers to WakeupFormShared`

Non-behavior-change extraction of the following from `WakeupsTab.tsx` (was L44-273) into a new co-located module `src/ui/features/pretty-view/WakeupFormShared.tsx`:

| Symbol | Type | Purpose |
| ------ | ---- | ------- |
| `FormSchedule` | discriminated union type | interval/daily/weekly/one_shot per-type form state |
| `WEEKDAY_VALUES` / `Weekday` | tuple + type | mon..sun canonical values |
| `isWeekday` | type guard | Weekday narrowing |
| `normalizeDays` | function | wire-side days array → canonical mon→sun subset (drops empty + full-7) |
| `cap` | function | first-char uppercase for chip labels |
| `detectBrowserTimezone` | function | Intl.DateTimeFormat → tz string with America/New_York fallback |
| `pad2` | function | number → 2-digit zero-padded string |
| `toIsoWithOffset` | function | datetime-local → ISO+offset for one_shot |
| `hydrateFormSchedule` | function | wire schedule → FormSchedule (defensive) |
| `buildSchedule` | function | FormSchedule + tz → wire schedule (OMITS tz for interval) |
| `validateForm` | function | first validation error string or null |
| `RestrictToDaysChips` | component | day-chip toggle row (D-06 aria-label contract preserved) |

WakeupsTab.tsx re-imports these from the shared module. Existing `WakeupsTab.test.tsx` (12 tests including the Phase 65-02 day-chip round-trip suite) passes unchanged — proves the refactor is behavior-identical.

**Commit 2 (20f13402):** `feat(72-02): add AddWakeupDialog sub-modal + 12 tests`

New `src/ui/features/pretty-view/AddWakeupDialog.tsx` — Radix Dialog-in-Dialog sub-modal with 6 CONTEXT.md-locked form fields:

| # | Field | Notes |
| --- | ----- | ----- |
| 1 | Name | text input, required, placeholder `"e.g. morning-standup"`, label `"Name (becomes filename slug)"` |
| 2 | Schedule type | `<select>` with 4 options (Interval / Daily / Weekly / One-shot). Default: daily |
| 3 | Schedule params | Per-type: (interval: every+unit+RestrictToDaysChips) / (daily: time+RestrictToDaysChips) / (weekly: day+time+RestrictToDaysChips) / (one_shot: datetime-local) |
| 4 | **Timezone (optional)** | `data-testid="add-wakeup-tz-input"` text input, IANA name. Placeholder shows detected tz: `"America/New_York (leave blank to use)"`. Help text: `"Leave blank to use box-local. Applies to Daily/Weekly/One-shot."`. HIDDEN when schedule type is interval, VISIBLE for daily/weekly/one_shot |
| 5 | Instruction | textarea, required, placeholder `"What should the agent do when this fires?"` |
| 6 | Enabled | Switch component, default `true` |

**Save enablement gate:** `!saving AND nameDraft.trim() !== "" AND normalizeSlug(nameDraft) !== "" AND instructionDraft.trim() !== "" AND validateForm(formSchedule) === null`.

**Timezone override wiring:** `const effectiveTz = tzDraft.trim() !== "" ? tzDraft.trim() : detectedTz;` — user string wins; blank falls back to browser-detected. Passed to `buildSchedule` which OMITS timezone for interval (matches CONTEXT.md's "applies to Daily/Weekly/One-shot only" lock).

Component uses `DialogPrimitive.Root/Portal/Overlay/Content` directly (radix-ui/react-dialog — same import pattern as IdentityModal). Nested-modal-safe: `onInteractOutside` + `onPointerDownOutside` both preventDefault so parent modal stays mounted per Radix's stacked-modal semantics. Hue-tint gradient background matches IdentityModal's L1200-1205 palette.

Test coverage — `AddWakeupDialog.test.tsx` (12 tests A-L):
- A: dialog renders when open=true / hidden when open=false
- B: switching schedule type re-renders per-type param fields
- C/D/E: Save disabled when Name empty / Instruction empty / Name normalizes to empty slug (e.g. "!!!")
- F: Save fires onSubmit with correctly-shaped `WakeupSpecWire` payload
- G: Cancel calls onOpenChange(false) without emitting
- H: onSubmit rejection surfaces error inline; dialog stays open; Save re-enables
- I: Timezone HIDDEN for Interval, VISIBLE for Daily/Weekly/One-shot
- J: Timezone placeholder contains auto-detected tz (mocked to Europe/London)
- K: blank Timezone + Daily → `spec.schedule.timezone === detectedTz` (fallback)
- L: filled Timezone ("UTC") + Daily → `spec.schedule.timezone === "UTC"` (override wins)

### Task 2 — WakeupsTab scope prop + Add-wakeup + Trash + Scope pill + IdentityModal stub

**Commit 3 (0d485305):** `feat(72-02): WakeupsTab scope prop + Add-wakeup pill + trash-with-confirm + scope pill`

**WakeupsTab prop signature change:**

BEFORE:
```ts
{
  state: TabState<Wakeup[]>;
  hue: number;
  onUpdate: OnUpdate;
}
```

AFTER:
```ts
{
  state: TabState<Wakeup[]>;
  hue: number;
  scope: "role" | "identity";                             // NEW
  onUpdate: OnUpdate;                                     // existing
  onCreate: (spec: WakeupSpecWire) => Promise<void>;      // NEW
  onDelete: (slug: string) => Promise<void>;              // NEW
}
```

Same three new props threaded to `WakeupRow`.

**Locations of new affordances:**

| Affordance | File | Line range | Testid |
| ---------- | ---- | ---------- | ------ |
| Add-wakeup pill (AddWakeupPill component) | `WakeupsTab.tsx` | ~L34-58 (component def) + L127-129 (empty-state) + L142-144 (data branch) | `wakeup-add-button` |
| AddWakeupDialog mount | `WakeupsTab.tsx` | L131-137 (empty) + L163-169 (data) | `add-wakeup-dialog` (on Content) |
| Scope pill (view mode) | `WakeupsTab.tsx` | ~L379-388 | `wakeup-scope-pill` |
| Scope pill (edit mode) | `WakeupsTab.tsx` | ~L325-333 | `wakeup-scope-pill` |
| Trash icon (view mode) | `WakeupsTab.tsx` | ~L419-441 | `wakeup-delete-icon` |
| Trash icon (edit mode) | `WakeupsTab.tsx` | ~L357-366 | `wakeup-delete-icon` |
| AlertDialog delete-confirm | `WakeupsTab.tsx` | ~L458-495 | `wakeup-delete-confirm` (on confirm button) |
| Timezone input (AddWakeupDialog) | `AddWakeupDialog.tsx` | ~L328-350 | `add-wakeup-tz-input` |

Note: testids `wakeup-scope-pill` and `wakeup-delete-icon` appear TWICE in WakeupsTab.tsx grep — once in the view-mode header, once in the edit-mode header — so both are visible regardless of which mode the row is in. This satisfies test 16 (`getAllByTestId("wakeup-delete-icon").length === 2` for a two-wakeup fixture in view mode) and preserves the affordance during edit mode.

**View-mode-nested-button caveat (implementation decision, tracked here for Wave 3 reviewers):**

The view-mode header is a `<button>` (disclosure toggle). HTML disallows nested `<button>` elements. Task 2 adds the trash icon + scope pill AND preserves the existing enable-toggle "on/off" pill (patch #17g), so all three interactive children in view-mode are rendered as `<span role="button" tabIndex={0}>` with `onClick` + `onKeyDown` Enter/Space handlers — semantically identical to a button for a11y, HTML-legal inside the disclosure `<button>`. Same pattern the existing enable-toggle originally used before it too was rewritten here.

**WakeupsTab.test.tsx extended tests (11 new, indices 13-23):**

- 13: scope='identity' → Add-wakeup dialog opens with "Add identity-scope wakeup" title
- 14: scope='role' → dialog opens with "Add role-scope wakeup" title
- 15: onCreate fires with correctly-shaped spec on sub-dialog Save
- 16: trash icon renders on every wakeup row (count = wakeups.length)
- 17: trash click opens AlertDialog confirm; slug appears in description
- 18: confirm click calls onDelete(slug)
- 19: cancel click does NOT call onDelete
- 20: onDelete rejection surfaces error text; dialog stays open
- 21: scope='role' → every wakeup row's scope pill reads "role"
- 22: scope='identity' → every wakeup row's scope pill reads "identity"
- 23: empty-state branch still renders "No scheduled wake-ups." AND renders the Add-wakeup button (first-wakeup flow reachable)

**IdentityModal L1905 call-site patch (stub values, NOT @ts-expect-error):**

BEFORE:
```tsx
<WakeupsTab state={wakeupsState} hue={hue} onUpdate={updateWakeup} />
```

AFTER:
```tsx
{/* TODO Wave 3: replace stubs with real wiring (scope + onCreate + onDelete land in Plan 03 Task 2a) */}
<WakeupsTab
  state={wakeupsState}
  hue={hue}
  onUpdate={updateWakeup}
  scope="identity"
  onCreate={async () => {}}
  onDelete={async () => {}}
/>
```

Stub semantics documented in-plan and enforced by acceptance grep #7-9 (which all pass).

## Deviations from Plan

**None** — plan executed exactly as written for both tasks. Two minor test-side details worth flagging as build-notes (NOT deviations from the plan action steps):

1. **Test 17 slug-scoping**: Initial `screen.getByText(/daily-box-check/)` matched multiple elements because the header row's wakeup-name span also contains the slug text (they're identical for a fixture where `name === slug`). Fixed by scoping to the AlertDialog description via `screen.getByRole("alertdialog").querySelector('[data-slot="alert-dialog-description"]')` — the assertion strengthens rather than weakens the test (proves the slug is specifically in the confirm-dialog body, not just anywhere on screen).
2. **Test B day-select disambiguation**: `getByLabelText(/Day/i)` matched multiple accessible elements (the `<select>` label AND each `<option>` day name like "Sunday"). Switched to exact-match `getByLabelText("Day")`. Same-behavior fix.

## Verification

- **Task 1 grep acceptance:** all 7 criteria pass (AddWakeupDialog export, shared module exists, shared imports in WakeupsTab, hue-tint 5x, tz testid, tz help text, 4 testids present).
- **Task 2 grep acceptance:** all 9 criteria pass (scope prop 2x, onCreate/onDelete 10x, wakeup-add-button 1x, wakeup-delete-icon 2x, wakeup-scope-pill 2x, `<AddWakeupDialog` 2x, TODO Wave 3 comment 1x, NO @ts-expect-error 0x, stub trio 3x).
- **Scoped tests (all green):**
  - `WakeupsTab.test.tsx` → 23/23 (was 12; +11 new)
  - `AddWakeupDialog.test.tsx` → 12/12 (new file)
  - `IdentityModal.test.tsx` → 12/12 (no regression from stub patch)
  - `IdentityModal.role-tab.test.tsx` → 4/4
  - `IdentityModal.stays-awake.test.tsx` → 6/6
  - `IdentityModal.voice.test.tsx` → 8/8
  - `IdentityModal.bounties-filter.test.tsx` → 11/11
  - `IdentityModal.lazy-archive.test.tsx` → 6/6
- **TypeScript:** `npx tsc --noEmit` exits 0 (stub values cover WakeupsTab's new required props with no @ts-expect-error suppression).

No existing tests regressed. No nginx / docker-compose / deploy surface touched.

## Known Stubs

**IdentityModal L1905 WakeupsTab call site — stub `scope="identity"` + no-op async onCreate/onDelete.** This is INTENTIONAL and gated by the plan's Blocker #3 fix. Wave 3 (Plan 03 Task 2a) replaces the whole JSX block with real WS wiring (splits into `<TabsContent value="identity-wakeups">` + `<TabsContent value="role-wakeups">` panes, each with real create/delete callbacks). The TODO Wave 3 comment above the call site is the marker; grep for `TODO Wave 3: replace stubs with real wiring` finds it.

Behavior consequence during the pre-Wave-3 interim: if Ashley opens the modal, clicks Add-wakeup, fills the form, and clicks Save, the dialog closes but nothing is written to disk (no-op onCreate). Same for delete-confirm (no-op onDelete). This is the trade-off the plan explicitly chose over @ts-expect-error to keep TypeScript clean.

## Self-Check: PASSED

Files created:
- FOUND: src/ui/features/pretty-view/AddWakeupDialog.tsx
- FOUND: src/ui/features/pretty-view/AddWakeupDialog.test.tsx
- FOUND: src/ui/features/pretty-view/WakeupFormShared.tsx
- FOUND: .planning/phases/72-identity-modal-role-identity-scope-split-with-role-level-wak/72-02-SUMMARY.md (this file)

Commits:
- FOUND: e7aa6e00 — refactor(72-02): extract shared wakeup-form helpers to WakeupFormShared
- FOUND: 20f13402 — feat(72-02): add AddWakeupDialog sub-modal + 12 tests
- FOUND: 0d485305 — feat(72-02): WakeupsTab scope prop + Add-wakeup pill + trash-with-confirm + scope pill
