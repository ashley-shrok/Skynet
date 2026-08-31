# Phase 65: Wake-up `days` gate — humanize + form-editor round-trip preservation — Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Source:** Direct-seeded from phase description in ROADMAP.md. Discuss-phase skipped per `/build` convention when the scope is small, the decisions are enumerable up front, and the discovery is done in-line (precedent: P53, P56, P57, P64). No shape file — this is a bug fix, not a `/build`-shaped feature.

## What this is

Two symmetric bugs in the Skynet identity-modal wake-up card, discovered 2026-08-31 when Ashley noticed that Aqua@Workstation's "weekdays at 23:00" schedule renders as **"Daily at 23:00"** in the identity modal. Root cause: the wake-up scheduler (`~/.claude/identities/*/wakeups/wakeup-scheduler.py` L117-122) accepts an optional `days: [...]` day-of-week gate alongside any schedule type, but two identity-modal surfaces don't know about it:

1. **DISPLAY bug** — `humanizeWakeupSchedule` at `src/backend/claude-session/identity-artifact-reader.ts:54-81` reads only `type` and `at` (and `day` for weekly). `s.days` is dropped on the floor, so a spec like `{type:"daily", at:"23:00", days:["mon","tue","wed","thu","fri"]}` renders as `"Daily at 23:00 (box-local)"` — indistinguishable from a true 7-day-a-week schedule.
2. **ROUND-TRIP bug (data loss)** — The form editor at `src/ui/features/pretty-view/WakeupsTab.tsx` has no `days` field on its `FormSchedule` discriminated union (L47-51) and no UI affordance to input one. `hydrateFormSchedule` (L89-131) drops `s.days`; `buildSchedule` (L135-147) never emits it. So opening a weekdays-only card in edit mode and pressing **Save** — even without touching any control — silently strips the gate off the wire, turning the spec into a plain daily/weekly one.

Both bugs are symmetric: the display is wrong AND round-tripping through the editor destroys the data. Fixing just one leaves the other. This phase fixes both together and adds unit tests on both sides.

## Discovery findings that shape the estimate

Read directly (2026-08-31):

**Discovery 1: The scheduler's `days` shape is a top-level, optional, always-lowercase-3-letter array.** `wakeup-scheduler.py` L117-122:

```python
# Optional day-of-week gate (box-local). e.g. "days": ["mon","tue","wed","thu","fri"]
# for weekdays-only. Missing = every day. Applies to any schedule type.
days = sch.get("days")
if days:
    today3 = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][now.weekday()]
    if today3 not in [str(d).lower()[:3] for d in days]:
        return None  # gated out today
```

Values are lowercased-3-letter — `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. **Missing OR empty-array = every day** (empty list is falsy in Python, so the `if days:` guard treats `[]` the same as absent). Order-insensitive (uses a set-membership check). The scheduler doesn't care about type — `days` applies to interval, daily, and weekly alike.

**Discovery 2: The humanizer is the single choke-point on the DISPLAY side.** `identity-artifact-reader.ts` calls `humanizeWakeupSchedule(parsed.schedule)` exactly twice (L584, L636), one branch per identity-file-reader path (bind-mount vs SSH). The frontend just renders `wakeup.scheduleHuman` verbatim (`WakeupsTab.tsx:376`). Fixing the humanizer fixes every render location.

**Discovery 3: The form editor's `FormSchedule` is a 4-way discriminated union with no shared fields.** Adding `days?: Weekday[]` requires adding it to the interval/daily/weekly variants (skip one_shot — a `days` gate on a fires-once spec is nonsensical). `hydrate`/`build`/`validate` all discriminate on `type` first. `WEEKDAY_VALUES` + `isWeekday` type-guard already exist (L53-58) — reuse for parsing `s.days` in hydrate.

**Consequence for effort:** Two plans, two waves. Plan 01 = backend humanizer + unit tests (standalone, no dependencies). Plan 02 = form editor `days` field on FormSchedule + chip UI on daily/weekly + hydrate/build/validate updates + component tests (depends on nothing but touches the same conceptual surface as 01, so wave-2 for clean ordering).

## In-scope this phase

### Plan 65-01 — Humanizer (backend + unit tests)

**File touched:** `src/backend/claude-session/identity-artifact-reader.ts` (humanizer only, L54-81).
**Tests touched:** existing tests in the same directory (grep for `humanizeWakeupSchedule` — see `identity-artifact-reader.test.ts` if present, else add new `humanize-wakeup-schedule.test.ts`).

Extend `humanizeWakeupSchedule` to render `s.days` when present. Prepend the day-gate label to the existing type-specific tail so the resulting phrase reads naturally:

- **Full-7 (or empty array or absent)** — treat as no gate; render exactly as today (`"Daily at 23:00 (box-local)"`, `"Every 2h"`, `"Weekly on Mon at 09:00 (box-local)"`). Full-7 = all of {mon,tue,wed,thu,fri,sat,sun} present in any order.
- **Weekdays exact set `{mon,tue,wed,thu,fri}`** — render as `"Weekdays at 23:00 (box-local)"` (replaces the "Daily" verb when the underlying type is daily; for interval → `"Weekdays every 2h"`; for weekly → the day-in-body is redundant with the gate, so still fall back to the standard weekly render for the type-safety edge case — see D-01 below).
- **Weekends exact set `{sat,sun}`** — render as `"Weekends at 23:00 (box-local)"` (same substitution as weekdays).
- **Any other subset (1..6 days that isn't weekdays or weekends)** — render as capitalized 3-letter abbreviations joined with `/`, in mon→sun canonical order: `"Mon/Wed/Fri at 23:00 (box-local)"`. Preserves scannability without a comma-list.

**Type-agnostic:** applies to interval / daily / weekly. one_shot is not gated by `days` in practice (spec is a datetime), but if a one_shot spec somehow carries `days`, treat as absent (don't prepend anything).

**Preserves box-local suffix on daily/weekly** and `Every ...` on interval — no other tail changes.

### Plan 65-02 — Form editor round-trip (frontend + component tests)

**File touched:** `src/ui/features/pretty-view/WakeupsTab.tsx`.
**Tests touched:** `WakeupsTab.test.tsx`.

1. **Extend `FormSchedule` discriminated union** (L47-51):
   - interval / daily / weekly each get `days?: Weekday[]` (undefined = "every day").
   - one_shot unchanged.
2. **`hydrateFormSchedule` (L89-131)** — after resolving the base fields, read `s.days` if present, filter through `isWeekday`, dedupe to a canonical mon→sun-ordered array, and attach as `days` on interval/daily/weekly variants. On empty result (all invalid), leave `days` undefined.
3. **`buildSchedule` (L135-147)** — if `fs.days` is defined AND non-empty AND not the full 7-day set, include `days: fs.days` in the emitted object (canonical mon→sun order). Skip the field entirely otherwise (absent = every day, matching scheduler semantics; full-7 = same behavior, so drop it to keep the wire clean).
4. **`validateForm` (L150-167)** — no new blocking check by default (a subset of 0 collapses to "every day" per D-04). Optionally warn on empty subset (see D-04 alternative).
5. **UI chips** — add "Restrict to days" row under the daily/weekly variant renders (not interval — out of scope per phase description). Seven toggleable chips (mon-sun) in canonical order. Selected chip = day is IN the gate; deselected = OUT. All 7 selected OR 0 selected = "every day" (build path drops the field). Chip style: match the existing on/off enabled chip (L354-362) family — small, glass, pill-shape, hue-tinted when selected. Label above: `"Restrict to days"` (same `text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold` style as the other labels).
6. **Live JSON preview** — already re-computes from `formSchedule` + `buildSchedule`, so the chip toggles show up in the preview automatically once the FormSchedule extension is in.

Focus/interaction behavior for the chips: clicking toggles that day's membership immediately — no separate apply. `setFormSchedule` sets the new state. No round-trip to server until Save (matches existing draft-then-save pattern).

## Out of scope (explicit)

- **Interval-type `days` UI.** The scheduler supports `days` on interval, but interval + day-gate is rare in practice (Ashley confirmed the use case is daily/weekly schedules that fire only on weekdays or weekends). Humanizer IS aware of `days` on interval (renders `"Weekdays every 2h"`) so if such a spec exists somewhere it still renders correctly — but the form editor does NOT surface a chip UI for it. If someone hand-edits an interval spec to add `days`, opening the card and pressing Save WILL preserve `days` (hydrate/build handle it), so round-trip fidelity holds — only the UI-driven CREATE path skips it. This matches the "leave humanizer-side aware but skip form UI" scope in the phase description.
- **`days` on one_shot.** Nonsensical (spec is a single datetime); ignored on both display and form sides.
- **Migration / backfill.** No existing specs are rewritten; `days` continues to be optional on the wire. Old specs without `days` continue to fire every day, unchanged.
- **Scheduler changes.** `wakeup-scheduler.py` already handles `days` correctly (L117-122); this phase does NOT touch it.
- **New schedule types.** No new `type` values; just teach the existing surfaces about the existing `days` field.

## Decisions (locked)

**D-01 · Weekly-type gate interaction — weekly + `days` gate is redundant.** If a weekly spec carries a `days` gate (e.g. `{type:"weekly", day:"mon", at:"09:00", days:["mon","fri"]}`), the SCHEDULER applies both filters (gate first, then weekly-slot filter), so the effective firing is the intersection. On DISPLAY, honor the same intersection precedence for correctness but keep the label simple: if `day ∈ days`, render as the days-gate-substituted form (`"Weekdays at 09:00"`) and drop the redundant "on Mon" (the weekly-slot info is already inside the days-gate); if `day ∉ days`, render as `"Weekly on Mon at 09:00 (box-local) — NEVER FIRES (weekly day excluded from days gate)"` (defensive: this is a malformed spec that will never fire; surface it visibly rather than silently). Note this is a rare edge case and can be a fallback-only branch; the mainline weekly case with no `days` is unchanged.

**D-02 · Full-7 = drop the field, don't render as "Every day at X".** When all 7 days are present in the array (in any order, deduplicated), treat semantically as "no gate" — humanizer renders as if `days` were absent, and the form editor's Save path drops the field entirely. Rationale: keeps the wire clean, avoids user confusion between "explicit every day" (visually verbose) and "no gate" (which the scheduler already treats identically). The scheduler doesn't care; the wire stays canonical.

**D-03 · Canonical order = mon→sun.** In both the humanizer's subset render (`"Mon/Wed/Fri at ..."`) and the form editor's `buildSchedule` emit, days are always in mon→sun order regardless of the order the user clicked chips or the order the raw spec had them. Rationale: deterministic wire shape, easy diff, mirrors the scheduler's own `["mon", "tue", "wed", "thu", "fri", "sat", "sun"]` list order. `hydrateFormSchedule` normalizes on read; `buildSchedule` normalizes on write.

**D-04 · Empty subset (0 days selected) = "every day" via drop-the-field (no validation error).** If the user deselects all 7 chips, `buildSchedule` drops the field entirely (same as full-7 per D-02) and the spec fires every day. `validateForm` does NOT block on this — 0 selected chips is a valid intermediate state during editing. Rationale: consistent with "absent = every day" scheduler semantics; validation errors during Q-editing are more disruptive than the mild oddity of "0 chips = every day." The chip UI could show a subtle hint when 0 are selected (e.g. dim text "= every day") but that's polish, not required for this phase.

**D-05 · Subset render style = `Mon/Wed/Fri` (capitalized 3-letter, `/` separator).** For 1..6 days that isn't weekdays or weekends, render as capitalized 3-letter abbreviations joined by `/` in mon→sun order. Rationale: scans faster than `"Mon, Wed, Fri"` at a glance, matches typical calendar shorthand, avoids parse-as-list ambiguity. Preserves the "(box-local)" suffix on daily/weekly and the "Every ..." verb on interval.

**D-06 · Chip UI = pill-shape toggle, hue-tinted-when-selected.** Match the existing on/off enabled-chip family (`WakeupsTab.tsx:354-362`): small `px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide border` pills. Selected = hue-tinted (`hsla(${hue}, 60%, 50%, 0.35)` fill + `hsla(${hue}, 60%, 50%, 0.55)` border matching the existing on-chip pattern), deselected = neutral (`bg-slate-500/10 text-slate-400 border-slate-500/25` matching the off-chip pattern). Labels are 3-letter capitalized (`Mon`, `Tue`, ...). 7 chips in a single flex-wrap row with `gap-1.5`. No individual aria-pressed state needed beyond the visual (already toggle-button-shaped). Container row has `aria-label="Restrict to days of week"` for screen readers.

**D-07 · Backward compat — no server / no wire migration.** The wire shape stays exactly what it is today (an optional top-level `days: string[]` field). Old specs without `days` continue to work unchanged. Old-client (unupgraded Skynet) fed a spec with `days` will silently drop it on any Save (which is what happens TODAY — this phase FIXES that regression for the upgraded path). No `days_v2` field, no schema version bump, no cache-key bump.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scheduler contract (source of truth for `days` semantics)
- `~/.claude/identities/tina/wakeups/wakeup-scheduler.py` L14-22 (schedule shape comment block), L117-122 (days-gate implementation) — the served script; identical copies live in every identity's wakeups dir.

### Humanizer + upstream consumers
- `src/backend/claude-session/identity-artifact-reader.ts` L54-81 (`humanizeWakeupSchedule` — the sole choke point for display).
- `src/backend/claude-session/identity-artifact-reader.ts` L580-590 + L630-640 (call sites — both branches call the humanizer once per spec).
- `src/backend/claude-session/claude-session-server.ts:4965` (wire type includes `scheduleHuman`).
- `src/ui/api/claude-session-api.ts:649` (frontend `Wakeup` type declaration — `scheduleHuman: string`).
- `src/ui/features/pretty-view/WakeupsTab.tsx:376` (sole render site — reads `wakeup.scheduleHuman` verbatim).

### Form editor (target of round-trip fix)
- `src/ui/features/pretty-view/WakeupsTab.tsx` L47-51 (`FormSchedule` type), L53-58 (`WEEKDAY_VALUES` + `isWeekday`), L89-131 (`hydrateFormSchedule`), L135-147 (`buildSchedule`), L150-167 (`validateForm`), L354-362 (existing chip-family reference for styling), L544-596 (existing weekly variant render — where new chip UI slots in), L519-543 (existing daily variant render — where new chip UI ALSO slots in).

### Tests to extend
- `src/ui/features/pretty-view/WakeupsTab.test.tsx` (existing component tests — extend with round-trip preservation + chip-toggle tests).
- Backend humanizer tests — grep for `humanizeWakeupSchedule` in `src/backend/claude-session/*.test.ts`; if none exist, create `identity-artifact-reader.humanize-wakeup.test.ts` alongside the existing family.

## Success Criteria

Phase is done when:

1. **Display fix** — a wakeup spec of `{type:"daily", at:"23:00", days:["mon","tue","wed","thu","fri"]}` renders as `"Weekdays at 23:00 (box-local)"` in the identity modal (verifiable via humanizer unit test + component test asserting on the `scheduleHuman` value).
2. **Round-trip fix** — opening that same spec in the WakeupsTab form editor, pressing "Edit schedule", then pressing Save without changing anything else emits back the identical spec (same `days` array in canonical order, same `type` + `at`). Verifiable via component test that captures the `onUpdate` payload and asserts equality on the schedule sub-object.
3. **Chip UI works** — starting from a plain `{type:"daily", at:"23:00"}` (no gate), toggling five chips (mon-fri) and pressing Save produces `{type:"daily", at:"23:00", timezone:"...", days:["mon","tue","wed","thu","fri"]}` on the wire. Verifiable via component test.
4. **Weekdays-substitution works** — humanizer test covers all four cases: `{type:"daily", days:weekdays}` → "Weekdays at ..."; `{type:"daily", days:weekends}` → "Weekends at ..."; `{type:"daily", days:full-7}` → "Daily at ..." (drops the field render); `{type:"daily", days:mon-wed-fri}` → "Mon/Wed/Fri at ...".
5. **Backwards compat** — a wakeup spec WITHOUT `days` renders identically to today (`"Daily at 23:00 (box-local)"`, `"Every 2h"`, etc.) — no regressions. Verifiable by keeping all existing humanizer tests green.
6. **Ship gate** — full-suite `npx vitest run` exit 0.

## Risk Summary

- **Low blast radius.** Two files, well-scoped changes, all-new logic gated on presence of `days` (absent = today's behavior unchanged).
- **Backend build risk = ~zero.** Humanizer takes `unknown`, already narrows via property reads; adding one more property read + branch is additive.
- **Frontend render-cycle risk = low.** New chip UI is stateless-mapping-over-day-list; no new hooks or effects; the existing `useMemo` on `livePreview` already recomputes on `formSchedule` change so preview stays live.
- **Test coverage risk = low.** Both files have existing test suites; extensions follow the same patterns.
- **The one real edge case: D-01 (weekly + days gate).** Rare in practice — Ashley confirmed the use case is daily/weekly WITHOUT weekly day-of-week (just "weekdays at X" or "weekends at X"). Handle defensively per D-01, but don't over-invest — a simple "intersect and label" implementation covers the correct cases and the malformed-spec case gets a visible "NEVER FIRES" warning rather than silent misrender.

## Deferred Ideas

- **Interval + days chip UI.** Scheduler supports it, humanizer will be aware of it, but the form editor doesn't surface chips for it. Future phase if a real use case shows up.
- **`days` on one_shot.** Nonsensical; not implemented anywhere.
- **Schema versioning / migration.** No — additive optional field, no migration needed.
- **Nicer "0 chips selected = every day" hint text under the chip row.** Polish; can add in follow-up if the raw behavior confuses.
- **Similar "weekdays / weekends" shorthand chips (macro buttons above the individual chips)** — e.g. a "Weekdays" quick-select button that flips mon-fri on and sat-sun off in one click. Nice-to-have; adds click-saving convenience but not required for correctness.

---

*Phase: 65-wake-up-days-gate-humanize-form-editor-round-trip-preservati*
*Context gathered: 2026-08-31 (direct-seeded, discuss-phase skipped per /build convention)*
