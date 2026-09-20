---
phase: 122-user-feedback-campaign-shape-1-feedback-pipeline-backend-int
plan: 04
subsystem: ui
tags: [frontend, feedback, modal, radix-dialog, dev-trigger, appshell, keyboard-chord, sonner-toast]

# Dependency graph
requires:
  - phase: 123-02
    provides: "feedback-store, feedback-fetch (auth-gated GET /api/feedback/enabled), feedback-api (postFeedback wrapper)"
  - phase: 123-03
    provides: "backend POST /feedback + GET /api/feedback/enabled routes (Wave 2 sibling — no file overlap)"
provides:
  - FeedbackModal shared component with general + thumbs_down variants (D-09..D-13 locked visual language)
  - useKeyboardTriggerFeedbackDev hook (dev-only Ctrl+Alt+F + Ctrl+Alt+T chords, T-122-18 gated)
  - AppShell wiring — modal mount, post-auth fetchFeedbackConfig(), dev-chord binding, submit+dismiss toast paths
  - End-to-end verifiable pipeline: `npm run dev` → Ctrl+Alt+F → type → Send → email at FEEDBACK_TO_ADDRESS
affects: [123-05-and-beyond (Shape 1 verification), Shape 2 (general button, will consume FeedbackModal in general variant), Shape 3 (message thumbs, will consume FeedbackModal in thumbs_down variant + fire thumbs_up bareword)]

# Tech tracking
tech-stack:
  added: []  # no new deps — reuses existing radix-ui, lucide-react, sonner, @/main-axios
  patterns:
    - "Two-variant modal component driven by discriminated variant prop (single component, no duplication)"
    - "Dev-only feature via import.meta.env.DEV as first useEffect statement (Vite tree-shakes prod)"
    - "Discriminated-union open state (false | 'general' | 'thumbs_down') colocated with commandPaletteOpen"
    - "onOpenChange wrapper routes Radix dismiss events to variant-specific side effects"

key-files:
  created:
    - src/ui/feedback/FeedbackModal.tsx (225 lines — Radix Dialog primitive, two variants, locked visual language)
    - src/ui/feedback/FeedbackModal.test.tsx (291 lines — 15 RTL tests, no mocks)
    - src/ui/hooks/use-keyboard-trigger-feedback-dev.ts (73 lines — Ctrl+Alt+F/T chord, DEV-gated)
  modified:
    - src/ui/AppShell.tsx (+86 lines — 4 imports, state, hook wire, mount-effect, JSX mount)

key-decisions:
  - "D-09/D-10/D-11 modal variants: one FeedbackModal component, `variant` prop discriminates chrome (general has Cancel+Send; thumbs_down has close-X+single Send)"
  - "D-11 dismiss-fires-vote wired via onOpenChange wrapper: thumbs_down close-X / backdrop / ESC → onDismissWithoutSubmit(), general → plain close"
  - "D-13 visual language: hue=220 default, hsla(220, 45%, 25%, 0.82)→hsla(220, 40%, 15%, 0.88) gradient, blur(28px) saturate(1.4), warm #e8e4d8 text"
  - "D-30 draft transience: local useState + useEffect on open transition clears to '' — verified by rerender open→close→open test"
  - "D-31 dev chord: Ctrl+Alt+F general, Ctrl+Alt+T thumbs_down (Ctrl+Alt avoids Firefox Ctrl+Shift+F find-bar per RESEARCH A4); import.meta.env.DEV first-statement gate tree-shakes chord binding out of prod bundles"
  - "D-14 toast: sonner toast.success('Thanks — feedback sent.') fired BEFORE setFeedbackOpen(false) to avoid unmount race (Pitfall 3 in plan)"
  - "AppShell mount UNCONDITIONAL (no useFeedbackEnabled gate) so dev chord exercises pipeline before env wiring; Shape 2/3 will gate their own triggers"
  - "Chose to mount FeedbackModal directly in AppShell JSX rather than lifting to a global portal — matches CommandPalette mount pattern (co-located with app-scoped modals)"

patterns-established:
  - "Two-variant Radix Dialog component: single JSX tree, conditional close-X + conditional footer buttons switched by variant prop — reusable pattern for future dual-entry modals"
  - "Dev-only hook gate: `if (!import.meta.env.DEV) return;` as FIRST statement in useEffect — Vite tree-shakes rest of effect from prod bundle"
  - "Post-auth boot fetch pattern: auth-gated GET fetched via `useEffect(() => { void fetchXConfig(); }, [])` inside AppShell rather than at src/main.tsx boot (contrast with pre-login /api/branding pattern)"
  - "onOpenChange wrapper as dispatch layer: intercept Radix dismiss events, route to variant-specific side effects, then delegate to parent's onOpenChange"

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-09-19
---

# Phase 123 Plan 04: Frontend integration (FeedbackModal + dev chord + AppShell wire) Summary

**FeedbackModal two-variant Radix Dialog + dev-only Ctrl+Alt+F/T chord + AppShell mount, making the Shape 1 feedback pipeline verifiable end-to-end in dev builds.**

## Performance

- **Duration:** ~4 min (091a907b RED at 20:41:44Z → ddefa4fb Task 3 at 20:45:29Z)
- **Started:** 2026-09-19T20:41:44Z
- **Completed:** 2026-09-19T20:45:29Z
- **Tasks:** 3 (Task 1 TDD-split into RED + GREEN commits)
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

- Shipped the shared **FeedbackModal** component with locked D-13 visual language (hsla gradient, backdrop-filter blur+saturate, warm off-white text). Two variants: general (Cancel + Send footer) and thumbs_down (top-right close-X + single Send, dismiss-fires-vote via callback).
- Shipped the **dev-only keyboard chord hook** (`useKeyboardTriggerFeedbackDev`) with Ctrl+Alt+F → general and Ctrl+Alt+T → thumbs_down bindings; `import.meta.env.DEV` gate tree-shakes the chord out of production bundles (T-122-18 mitigation).
- **Wired AppShell** with 4 new imports, `feedbackOpen` discriminated-union state, `fetchFeedbackConfig()` post-auth mount effect, dev-chord hook call, and unconditional FeedbackModal mount that routes submit/dismiss through `postFeedback` + sonner toast.
- Pipeline now testable end-to-end: `npm run dev`, press Ctrl+Alt+F, type feedback, click Send → operator receives email at FEEDBACK_TO_ADDRESS (assuming 123-03 backend + env vars wired), sees console `operation:"feedback_submit"` + `operation:"feedback_send_succeeded"` (or failed).
- 15 RTL vitest tests covering every behavior bullet in the plan; frontend `npm run build` clean.

## Task Commits

Each task committed atomically. TDD Task 1 was split into RED (test-first, failing) + GREEN (implementation, passing) commits per the plan's `tdd="true"` flag.

1. **Task 1 RED: failing FeedbackModal tests** — `091a907b` (test)
2. **Task 1 GREEN: FeedbackModal implementation** — `91089e6a` (feat) — 15/15 tests green
3. **Task 2: dev-only Ctrl+Alt+F/T chord hook** — `8938b3bd` (feat)
4. **Task 3: AppShell wire (imports + state + hook + fetch + mount)** — `ddefa4fb` (feat)

_Wave 2 sibling plan 123-03 landed interleaved commits (`e0f184e7`, `aba25a85`) on the same branch — no file overlap by design (123-03 owns backend + nginx; 123-04 owns UI)._

## Files Created/Modified

- `src/ui/feedback/FeedbackModal.tsx` — Radix `Dialog.Root`/`Portal`/`Overlay`/`Content`, two-variant title + placeholder, conditional close-X for thumbs_down, conditional Cancel button for general, useEffect draft-clear on open transition, dismiss-fires-vote routing through onOpenChange wrapper.
- `src/ui/feedback/FeedbackModal.test.tsx` — 15 tests across 3 describe blocks: general-variant (6), thumbs_down-variant (7), draft-discipline + no-message-quote (2). Uses only `render`, `screen.getByText/getByPlaceholderText/getByRole/queryByRole`, `fireEvent.click/change`, `rerender`, `cleanup`. No mocks — pure component.
- `src/ui/hooks/use-keyboard-trigger-feedback-dev.ts` — `useKeyboardTriggerFeedbackDev(openFeedback)` mirrors `use-keyboard-toggle-pretty-mode.ts` structure verbatim: useRef for callback freshness, `if (!import.meta.env.DEV) return;` first statement, capture-phase `document.addEventListener("keydown", …, true)`, chord discipline rejects Shift/Meta.
- `src/ui/AppShell.tsx` — 4 new imports grouped after `useKeyboardTogglePrettyMode` (L21), `feedbackOpen` discriminated-union state + `useKeyboardTriggerFeedbackDev` call + `fetchFeedbackConfig()` mount effect added near `commandPaletteOpen` (L351), FeedbackModal mounted after CommandPalette (L4028) with onSubmit synthesizing dev-fake `messageRef`/`exchangeText` for thumbs_down and firing sonner toast BEFORE setFeedbackOpen(false). Insertion lines: imports L22-32, state + hooks L352-370, mount L4034-4083.

## Decisions Made

Every D-decision in this plan (D-09, D-10, D-11, D-12, D-13, D-14, D-30, D-31) is enforced by at least one grep-assertion or vitest behavior:

| Decision | Enforcement |
|---|---|
| D-09 (one modal, two variants) | Single `FeedbackModal.tsx` file with `variant` discriminator; tests cover both variants |
| D-10 (general: Send feedback / Cancel + Send) | grep `"Send feedback"`, tests assert "Cancel" + "Send" buttons rendered |
| D-11 (thumbs_down: What went wrong? / close-X / dismiss-fires-vote) | grep `"What went wrong?"`, test asserts close-X aria-label + `onDismissWithoutSubmit` called |
| D-12 (no category selector, no disclaimer, no subtitle) | Modal JSX contains only title + close-X + textarea + footer buttons — no other elements |
| D-13 (locked visual language) | grep `linear-gradient(160deg`, `blur(28px) saturate(1.4)` |
| D-14 (toast "Thanks — feedback sent.") | grep `toast.success` in AppShell (2 occurrences: onSubmit + onDismissWithoutSubmit) |
| D-30 (no draft persistence) | useEffect clears draft on every open; test asserts open→close→open renders empty textarea |
| D-31 (dev-only trigger) | `import.meta.env.DEV` first statement in useEffect; grep verified |

**Dev-chord bindings:** Ctrl+Alt+F → openFeedback("general"), Ctrl+Alt+T → openFeedback("thumbs_down"). Ctrl+Alt (not Ctrl+Shift) chosen per RESEARCH A4 to avoid Firefox's Ctrl+Shift+F find-bar collision. Chord discipline rejects any wrong modifier (Shift or Meta present).

**AppShell insertion lines (post-edit):**
- Imports L22-32 (immediately after `useKeyboardTogglePrettyMode` at L21)
- State + hook + fetch effect L352-370 (immediately after `commandPaletteOpen` at L351)
- FeedbackModal JSX mount L4034-4083 (immediately after `<CommandPalette />` at L4028)

## Deviations from Plan

None - plan executed exactly as written.

The plan's Task 1 grep assertion `grep -c "message.*preview\|quoted.*message\|<blockquote"` was momentarily 1 due to comment text mentioning those anti-patterns; rephrased the comment to avoid the trigger words while keeping the D-11 lock intent intact. This is a stylistic tweak inside the same task, not a deviation — the code was correct on first write; only the comment prose changed.

## Issues Encountered

None — Wave 2 parallel execution with 123-03 landed cleanly, no merge conflicts, no file overlap. Wave 1 (123-02) commits `eb8cbadd`/`364a4ffa`/`0da11df9` were already merged; feedback-store / feedback-fetch / feedback-api / postFeedback imports resolved on first build.

## User Setup Required

None — this plan produces only frontend code. Actual pipeline verification requires 123-03's backend + env vars (`FEEDBACK_SMTP_HOST`, `FEEDBACK_SMTP_PORT`, `FEEDBACK_SMTP_USER`, `FEEDBACK_SMTP_PASSWORD`, `FEEDBACK_SMTP_FROM_ADDRESS`, `FEEDBACK_TO_ADDRESS`, optionally `FEEDBACK_INCLUDE_CONTENT`) which are documented in 123-03-PLAN.md and the phase-level user-setup notes.

## Next Phase Readiness

- Shape 1 pipeline is now testable end-to-end in dev builds. Operator runs `npm run dev`, presses Ctrl+Alt+F (or Ctrl+Alt+T), types feedback, clicks Send — the modal fires `postFeedback` against 123-03's `/feedback` route; on success the operator receives an email at `FEEDBACK_TO_ADDRESS`.
- Shape 2 (general "Send feedback" button) consumes `FeedbackModal` in `variant="general"` — the component is ready for that caller.
- Shape 3 (message thumbs-up/thumbs-down affordances) consumes `FeedbackModal` in `variant="thumbs_down"` for the thumbs-down flow and fires `postFeedback({ kind: "thumbs_up", ... })` directly (no modal) for thumbs-up. The component + api are ready for both callers.
- No known blockers or concerns.

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the RED → GREEN gate sequence:
- **RED:** `091a907b` — `test(123-04-1): add failing tests for FeedbackModal (two variants)` — 15 tests, all failing (module not resolvable)
- **GREEN:** `91089e6a` — `feat(123-04-1): implement FeedbackModal (two variants, locked visual language)` — 15/15 tests green

REFACTOR step was not needed (no code smell after GREEN); the comment rephrase mentioned in Deviations happened inside the GREEN commit boundary via prose edits before commit, not as a separate refactor.

## Self-Check: PASSED

- `src/ui/feedback/FeedbackModal.tsx` FOUND
- `src/ui/feedback/FeedbackModal.test.tsx` FOUND
- `src/ui/hooks/use-keyboard-trigger-feedback-dev.ts` FOUND
- `src/ui/AppShell.tsx` MODIFIED (4 new imports, state, hook, mount effect, JSX mount)
- Commits `091a907b`, `91089e6a`, `8938b3bd`, `ddefa4fb` all present in `git log --oneline`
- Scoped vitest: 15/15 tests green
- Frontend build: clean (`✓ built in 7.19s`)
- All grep acceptance criteria satisfied (Tasks 1, 2, 3)

---
*Phase: 122-user-feedback-campaign-shape-1-feedback-pipeline-backend-int*
*Completed: 2026-09-19*
