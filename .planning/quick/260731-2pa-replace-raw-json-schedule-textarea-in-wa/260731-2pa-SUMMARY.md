---
phase: quick-260731-2pa
plan: 01
subsystem: pretty-view / identity-modal
tags: [wakeups, form-editor, identity-modal, patch-220]
requires: [patch-154-wakeup-write-path, patch-17g-wakeups-tab-origin]
provides: [wakeup-form-editor-ui, wakeup-write-path-name-instruction]
affects: [WakeupsTab.tsx, IdentityModal.tsx, identity-artifact-reader.ts, claude-session-server.ts, claude-session-api.ts]
tech-stack:
  added: []
  patterns:
    - "Discriminated-union form state (FormSchedule) + hydrate/build helpers for round-trip"
    - "Silent browser timezone detect via Intl.DateTimeFormat().resolvedOptions().timeZone with fallback"
    - "Live JSON preview via useMemo — updates every keystroke, matches wire payload shape"
    - "Client-side shallow validation blocks Save; server remains authoritative on write"
    - "Type-widen-only backend extension (WakeupUpdate + WS filtered) with matching wire type"
key-files:
  created:
    - src/ui/features/pretty-view/WakeupsTab.test.tsx
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/WakeupsTab.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - "Two atomic commits (backend widen, then frontend rewrite) so the wire type widening lands before the form-editor rewrite depends on it."
  - "Preserve patch #154's always-visible enabled chip + one-click toggleEnabled untouched — the form's Enabled checkbox is a secondary path."
  - "Interval schedules OMIT timezone from the emitted schedule (scheduler no-ops it per tina.md § Scheduled wake-ups)."
  - "Client-side shallow validation blocks Save on obvious errors (bad `every`, bad `at`, bad `day`, invalid one_shot) but the server remains authoritative — validation logic is a shallow feedback-loop improvement, not the source of truth."
  - "Remote-branch python one-liner in writeIdentityWakeupUpdate needs no change — `for k,v in u.items(): d[k]=v` already merges any key generically."
  - "hydrateFormSchedule falls back to {type: 'daily', at: '09:00'} on unrecognized inputs — an old hand-edited fifth-type schedule would silently convert to daily/09:00 on Save. Acceptable trade for a simple entry path."
metrics:
  duration: "~30 minutes"
  completed: 2026-07-31
  tasks_completed: 3
  files_touched: 6
  commits: 2
  tests_added: 7
  full_suite_delta: "+7 (887 vs 880 baseline)"
---

# Quick 260731-2pa: WakeupsTab form-based schedule editor Summary

Replaced the raw JSON schedule textarea in `WakeupsTab.tsx` (patch #154) with a
form-based editor: schedule-type dropdown (interval/daily/weekly/one_shot) +
per-type fields + live JSON preview on ≥620px viewports + silent browser
timezone detection. Backend `identity:update-wakeup` write path extended to
also accept `name?` and `instruction?` (both were displayable but not
editable before). Preserves patch #154's always-visible enabled chip and
one-click `toggleEnabled` handler intact.

## Objective (met)

Ashley pinned bounty `identity-modal-wakeup-form-editor` verbatim: "a proper
form UI for editing wakeup schedules inside the identity modal — not a
text-edit-the-JSON situation." Shipped exactly per the Ashley-signed-off
prototype at `~/.claude/identities/tina/bounties/identity-modal-wakeup-form-editor/prototype.html`:

- Dropdown → per-type fields swap: interval → number + unit (s/m/h/d); daily →
  time picker; weekly → day-of-week + time; one_shot → datetime-local + past-
  fire warning ("⚠ that datetime is in the past — the scheduler will fire
  this immediately on first sight.").
- Silent timezone detect via `Intl.DateTimeFormat().resolvedOptions().timeZone`
  with fallback `America/New_York`. Shown as a muted hint on
  daily/weekly/one_shot; OMITTED from the emitted schedule on interval
  (scheduler no-ops timezone on interval).
- Live JSON preview on the right column shows exactly what will be PUT to
  `~/.claude/identities/<name>/wakeups/<slug>.json` on Save.
- Round-trip: entering edit-mode on a daily wakeup hydrates the time input
  from the existing `at` value; changing the type dropdown swaps the fields
  underneath.

## Tasks executed

1. **Task 1: Backend extension for name + instruction** — commit `1bfffc0`.
   Widened `WakeupUpdate` type in `identity-artifact-reader.ts`; local-branch
   writer gained explicit `parsed.name` + `parsed.instruction` assignments
   (remote python one-liner is generic — no change). WS handler in
   `claude-session-server.ts` validates + threads both new fields into
   `filtered`; "no updates" guard now considers all four fields.
   `IdentityUpdateWakeupPayload.updates` wire type widened.
2. **Task 2: Frontend rewrite + IdentityModal wiring + 7-case test suite** —
   commit `8b1989e`. Full `WakeupRow` rewrite: module-scoped helpers
   (`detectBrowserTimezone`, `pad2`, `toIsoWithOffset`, `hydrateFormSchedule`,
   `buildSchedule`, `validateForm`) + discriminated-union `FormSchedule` type +
   draft state slots + `useEffect` reset on wakeup identity change +
   validation-blocks-Save + Cancel-re-hydrates. `IdentityModal.updateWakeup`
   signature widened to accept name/instruction. New test file exercises
   view render, hydrate-on-enter-edit, type-swap-no-tz-on-interval, past-
   datetime hint, tz hint on daily/weekly/one_shot, Save shape (interval-
   omits-tz vs daily-includes-tz), Cancel-and-re-open re-hydration.
3. **Task 3: Bookkeeping** — patch #220 entry added to
   `~/.claude/identities/tina/skynet-patches.md` (header line bumped from
   "TWO HUNDRED AND NINETEEN" to "TWO HUNDRED AND TWENTY"); bounty.json
   `status: "done"` + timeline entry citing commit `8b1989e`; bounty
   directory moved to `bounties/archive/`. No git commits in the skynet repo
   for Task 3 (files live outside the tree).

## Deviations from Plan

**Rule 1 (Bug) — Test 4's `getByText` matcher for the past-datetime hint.**

The plan's test 4 spec called for `screen.getByText(/fires this immediately/i)`
to locate the past-datetime hint. First run of the test suite showed the hint
renders correctly in the DOM but `getByText` with a regex on the full phrase
misses it because the hint has an inline `<b>immediately</b>` — the phrase is
split across children, and `getByText`'s default full-node text matcher only
matches on leaf text nodes. Fixed by asserting the two fragments separately:
`getByText(/that datetime is in the past/i)` for the text-node fragment and
`getByText("immediately")` for the `<b>` inner text. Same assertion — the
hint IS present and visible — just using two matcher calls that respect the
DOM's actual structure. First auto-fix attempt (a `getByText(matcherFn)`
predicate) fired on multiple nodes so I switched to the two-fragment
approach. Fix landed in the test file; no source change needed.

## Auth gates / checkpoints

None. Plan had no checkpoints; all three tasks executed autonomously.

## Verification

- `npx tsc --noEmit` — EXIT 0 (after both commits).
- `npx vitest run src/ui/features/pretty-view/WakeupsTab.test.tsx --reporter=verbose` — **7/7 passed** (3.20s).
- `npx vitest run` (full suite) — **887 passed / 6 skipped / 0 failed** across 79 files
  (121.75s). Baseline was 880/6/0 (patch #219 landing); +7 delta is exactly the new
  `WakeupsTab.test.tsx` file. Zero new failures elsewhere.
- Task 3 verify block: `test -f archive/.../bounty.json && grep '"status": "done"' && grep "TWO HUNDRED AND TWENTY" && grep "^## Patch #220"` — all OK. Source bounty dir removed; archive dir has bounty.json + prototype.html.

## Success criteria (met)

- [x] `npx vitest run src/ui/features/pretty-view/WakeupsTab.test.tsx` passes 7/7.
- [x] `npx tsc --noEmit` shows no new errors.
- [x] WakeupsTab pencil click now opens the form editor (not a raw JSON textarea);
  always-visible enabled chip in the header still toggles via `toggleEnabled`;
  saving persists `{name, enabled, schedule, instruction}` via the widened
  `identity:update-wakeup` write path.
- [x] `skynet-patches.md` contains a patch #220 entry (header line bumped to
  "TWO HUNDRED AND TWENTY"); bounty archived to `bounties/archive/`
  with `status: "done"` + shipped-commit timeline entry.
- [x] tina.md § Domain 10K-foot-view patch count NOT bumped (convention: bump
  at deploy time; deploy is HELD per fleet rule).
- [x] No push to skynet-ec2; no docker compose recreate.

## Known Stubs

None. The form editor writes the full spec `{name, enabled, schedule, instruction}`
via the extended write path; no placeholder or "not available" text remains.
The raw JSON textarea from patch #154 has been fully removed.

## Commits

- `1bfffc0` — feat(260731-2pa-01): extend identity:update-wakeup write path to accept name + instruction (3 files, +67/-6)
- `8b1989e` — feat(260731-2pa-02): replace raw JSON schedule textarea in WakeupsTab.tsx with form-based editor (3 files, +741/-62)

## Self-Check: PASSED

- `git log --oneline -6` shows both `1bfffc0` and `8b1989e` present on `feat/tab-title-from-tmux`.
- Files exist:
  - `src/ui/features/pretty-view/WakeupsTab.test.tsx` — FOUND (new).
  - `src/ui/features/pretty-view/WakeupsTab.tsx` — FOUND (rewritten).
  - `src/ui/features/pretty-view/IdentityModal.tsx` — FOUND (updateWakeup widened).
  - `src/backend/claude-session/identity-artifact-reader.ts` — FOUND (WakeupUpdate widened).
  - `src/backend/claude-session/claude-session-server.ts` — FOUND (WS handler widened).
  - `src/ui/api/claude-session-api.ts` — FOUND (wire type widened).
- Bookkeeping (outside repo):
  - `~/.claude/identities/tina/bounties/archive/identity-modal-wakeup-form-editor/bounty.json` — FOUND (`status: done`).
  - `~/.claude/identities/tina/bounties/identity-modal-wakeup-form-editor/` — absent (moved to archive).
  - `~/.claude/identities/tina/skynet-patches.md` — header updated to "TWO HUNDRED AND TWENTY"; patch #220 entry present.
