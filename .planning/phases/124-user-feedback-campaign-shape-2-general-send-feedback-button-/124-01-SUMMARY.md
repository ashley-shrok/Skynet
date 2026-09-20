---
phase: 123-user-feedback-campaign-shape-2-general-send-feedback-button-
plan: 01
subsystem: ui/feedback
tags: [ui, feedback, header, pretty-conversations, shape-2, phase-124]
dependency_graph:
  requires:
    - "Phase 122 shape-1 pipeline (FeedbackModal + feedback-store + feedback-api + AppShell L4041 modal mount + L352-L358 feedbackOpen state atom + dev-chord hook)"
    - "PrettyConversationsPanel header-actions row (L2304 pv-header-actions div; five existing sibling buttons)"
    - "lucide-react (MessageSquare export — already installed for MessagesSquare)"
  provides:
    - "Production-visible Send feedback trigger — first non-dev entry point for the shape-1 pipeline"
    - "onOpenFeedback callback contract on PrettyConversationsPanel — () => void"
    - "Reusable pattern for future header-button additions with an independent (non-showPencilButton) gate"
  affects:
    - "src/ui/AppShell.tsx (added one prop to PrettyConversationsPanel call site)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (import + hook subscription + prop + button JSX + header fragment split)"
tech_stack:
  added: []
  patterns:
    - "Leaf-level useSyncExternalStore subscription (bare useFeedbackEnabled() hook call, no wrapper/provider/prop-drill) — first production consumer of shape-1 feedback-store"
    - "PATTERNS.md placement 2 (split showPencilButton fragment) for independent-gate button placement in position 5 of 6"
    - "Colocated per-header-button test file (Analog A) — mirrors PrettyConversationsPanel.new-role-button.test.tsx"
    - "Optional-chaining call pattern for optional callback prop — `onClick={() => onOpenFeedback?.()}` — silent no-op if unwired"
key_files:
  created:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx"
  modified:
    - "src/ui/AppShell.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
decisions:
  - "Used PATTERNS.md placement 2 (split fragment) — DOM order SquarePen → FolderOpen → Drama → Globe → feedback-button → MoreVertical — satisfies D-02 'fifth of six' verbatim"
  - "Used Analog A (new colocated test file) rather than extending PrettyConversationsPanel.test.tsx — matches the sibling-file convention established by PrettyConversationsPanel.new-role-button.test.tsx (quick-260914-liu)"
  - "Optional-chaining pattern for the button onClick (`onOpenFeedback?.()`) so tests can render without wiring the callback; matches the plan's Type declaration (optional prop) and the JSDoc contract"
metrics:
  duration_minutes: 5
  completed_date: "2026-09-20"
  tasks_completed: 3
  files_created: 1
  files_modified: 2
  tests_added: 4
  tests_passing: 192
---

# Phase 124 Plan 01: Send feedback header button (Shape 2 wire-up) Summary

Adds the production-visible "Send feedback" trigger for the user-feedback
campaign: a sixth icon button in the conversation-list header row (position
5 of 6, between Globe and the MoreVertical kebab), wired to the
already-mounted FeedbackModal in general variant, with a `feedbackEnabled`
visibility gate that is deliberately INDEPENDENT of the header row's
`showPencilButton` gate.

Purpose: Phase 122 (shape 1) built the entire feedback pipeline (modal,
hook, POST route, backend transport, toast). This plan surfaces that
pipeline to real users through a durable production trigger, alongside the
dev-only Ctrl+Alt+F chord which stays unchanged. Zero new pipeline plumbing
— pure placement + wiring per D-18.

## What Landed

### Task 1 — AppShell wiring
**Commit:** `85787b56`
**File:** `src/ui/AppShell.tsx` (+8 lines, one prop addition + comment block)
**Lines touched:** L3050–L3058 (the `<PrettyConversationsPanel>` call site,
inside `sidebarPanelContent`)

Added a single prop `onOpenFeedback={() => setFeedbackOpen("general")}` to
the `<PrettyConversationsPanel>` render, placed immediately after
`onCloseSession={closeTab}`. Reuses the EXISTING `setFeedbackOpen` setter
from the L352–L358 state atom — no new state, no new modal mount, no new
imports, no changes to the L4041 FeedbackModal wiring, no changes to the
dev-chord hook at L363. Confirms D-07/D-08/D-18.

### Task 2 — PrettyConversationsPanel button + subscription
**Commit:** `96e89025`
**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
(+67, −13)
**Lines touched:**
- L67: extended the alphabetized lucide-react import with `MessageSquare`
  (singular; `MessagesSquare` plural untouched — per PATTERNS.md gotcha)
- L223–L228: added `useFeedbackEnabled` import from `@/feedback/feedback-store`
  with commentary
- L553–L562: added leaf-level `const feedbackEnabled = useFeedbackEnabled();`
  subscription next to `useBrandingConfig()` — first production consumer of
  the shape-1 feedback-store
- L550: added destructured `onOpenFeedback,` in the component signature
  (positioned last, after `onOpenApp`; no reordering of existing entries)
- L554–L565: added `onOpenFeedback?: () => void` in the props type block
  with a phase-scoped JSDoc citing D-07/D-08 and explaining the AppShell
  state-atom lift contract + the silent-no-op-if-unwired convention
- L2378–L2410: restructured the header row per PATTERNS.md **placement 2**
  (split the showPencilButton fragment). Kept SquarePen, FolderOpen, Drama,
  Globe inside a first `{showPencilButton && (<>...</>)}` fragment; added a
  NEW independent `{feedbackEnabled && (<button ... />)}` block; wrapped
  MoreVertical (kebab) in a second `{showPencilButton && (<button ... />)}`
  block so it retains its create-buttons gating.

DOM order now reads: SquarePen → FolderOpen → Drama → Globe →
**Send feedback** → MoreVertical (kebab). Satisfies D-02 "fifth of six"
verbatim.

Button chrome mirrors the sibling Drama button exactly:
`type="button"`, `className="pv-pencil"`,
`aria-label="Send feedback"`, `title="Send feedback"`,
`data-testid="pv-header-send-feedback-button"`, child
`<MessageSquare size={18} />`, `onClick={() => onOpenFeedback?.()}`.

Both `variant="desktop"` and `variant="mobile"` render the button
identically because `.pv-header-actions` is a single shared block across
both variants (verified: `grep -c pv-header-actions` = 1 in the file).

`npx tsc --noEmit` exits 0 after this task — the callback contract from
Task 1 (`() => void`) type-checks against the receiver end here.

### Task 3 — Colocated vitest suite (D-23)
**Commit:** `921f795b`
**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx`
(new, +314 lines)

Chose **Analog A** (new colocated sibling test file) over Analog B (extend
main suite) — matches the convention set by
`PrettyConversationsPanel.new-role-button.test.tsx` (quick-260914-liu),
which established "one header button per file" for header-button coverage.

Four `it(...)` cases per D-23:

| Test | Purpose | Assertion |
|------|---------|-----------|
| 1 | Chrome (D-01/D-03/D-04/D-05/D-06/D-22) | `useFeedbackEnabled → true`; assert button testid truthy, `.pv-pencil` class, `aria-label` + `title` both `"Send feedback"`, `type="button"`, tagName `BUTTON`. |
| 2 | Absent when disabled (D-11) | `useFeedbackEnabled → false`; assert `queryByTestId("pv-header-send-feedback-button")` returns `null` — the button is ABSENT from the DOM, not disabled and not hidden-via-CSS. |
| 3 | Click fires callback (D-07) | `useFeedbackEnabled → true`; render with `vi.fn()` as `onOpenFeedback`; `fireEvent.click` on the button; assert the callback was called exactly once with no arguments. |
| 4 | Independent-gate (D-12 — the important one) | `useFeedbackEnabled → true`; render WITHOUT `onCreateSession` so `showPencilButton === false`; assert all five sibling testids null AND the feedback button testid present. Behaviorally proves the gate divergence from the shared showPencilButton fragment. |

Mock preamble copied verbatim from
`PrettyConversationsPanel.new-role-button.test.tsx` (14 vi.mock blocks).
Two new Phase-123 mocks added: `@/feedback/feedback-store` (default `false`
so absent-when-disabled is the safe default per beforeEach reset) and
`@/feedback/FeedbackModal` (lightweight stub — defensive; the panel itself
does not mount FeedbackModal, AppShell does per D-08).

## D-01..D-23 Confirmation

Every locked decision satisfied. Explicit mapping:

- **D-01 (placement in conversation-list header row):** button lives in
  `.pv-header-actions` div at L2404 of PrettyConversationsPanel.tsx.
- **D-02 (fifth of six):** placement 2 (split fragment) gives DOM order
  SquarePen → FolderOpen → Drama → Globe → feedback-button → MoreVertical.
- **D-03 (MessageSquare, size 18):** imported at L67; used as
  `<MessageSquare size={18} />` at L2409.
- **D-04 (reuse .pv-pencil chrome):** `className="pv-pencil"` on the button.
- **D-05 (a11y):** `aria-label="Send feedback"` + `title="Send feedback"`.
- **D-06 (testid):** `data-testid="pv-header-send-feedback-button"`.
- **D-07 (click → general variant):** AppShell's callback closure calls
  `setFeedbackOpen("general")` — variant hardcoded, no-arg signature.
- **D-08 (no parallel modal mount):** button lifts the existing L352–L358
  state atom; no new useState, no second FeedbackModal.
- **D-09 (payload):** general branch of AppShell L4066 already sends
  `{ kind: "general", userNote }` — zero changes required (D-18).
- **D-10 (toast):** inherited unchanged from shape 1 D-14 via existing
  L4072 wiring.
- **D-11 (absent-when-disabled):** button JSX is wrapped in
  `{feedbackEnabled && (...)}` — completely absent from DOM when
  `useFeedbackEnabled() === false`. Test 2 verifies behaviorally.
- **D-12 (independent gate):** button JSX lives OUTSIDE any
  `{showPencilButton && (...)}` fragment — placement 2 splits the fragment
  to preserve fifth-of-six ordering. Test 4 verifies behaviorally.
- **D-13 (accept pop-in):** no reserved space, no fade-in trick, no
  disabled placeholder — button renders when the hook flips true.
- **D-14/D-15 (both variants):** `.pv-header-actions` is a single shared
  block across mobile and desktop variants — same JSX serves both.
- **D-16 (no role gate):** no `isAdmin` check on the button.
- **D-17 (no production keyboard shortcut):** no new hook, no chord
  binding — the dev-only Ctrl+Alt+F path at AppShell L363 is untouched.
- **D-18 (no shape-1 changes):** `git diff --name-only` against Phase 122
  files confirms zero changes to `src/ui/feedback/*`, feedback-routes,
  feedback-config, feedback-email, feedback-transport, dev-chord hook,
  the AppShell L4041 modal wiring block, or nginx configs.
- **D-19 (no interstitial UI):** button never reflects submit state — the
  click opens the modal and returns.
- **D-20 (no telemetry):** no click tracker, no measurement.
- **D-21 (no header redesign):** minimum-invasive change — just extends
  the existing `.pv-pencil` sibling row.
- **D-22 (no differentiator):** no accent color, no badge, no divider —
  button is indistinguishable in weight from its five siblings.
- **D-23 (test scope):** four cases landed exactly as specified, all pass.

## Verification Evidence

### Automated verify commands (from PLAN.md)

| Check | Result |
|-------|--------|
| `grep -n 'pv-header-send-feedback-button' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 match (want: 1) |
| `grep -c 'onOpenFeedback={() => setFeedbackOpen("general")}' src/ui/AppShell.tsx` | 1 (want: 1) |
| `grep -c '<FeedbackModal' src/ui/AppShell.tsx` | 1 (want: 1 — no duplicate mount) |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest related --run` on the scoped set | 192/192 tests pass across 8 files (56.28s) |
| `npm run build` | ✓ built in 16.75s, all bundles emitted |

### Fleet scope discipline

- ✓ NO `git push` executed.
- ✓ NO `docker build` / `docker compose up` / `docker logs` executed.
- ✓ NO HTTPS-endpoint verify executed.
- ✓ NO full-suite `npx vitest` run — scoped `related` only.
- ✓ NO git worktrees used — all work on `feat/tab-title-from-tmux` branch.
- ✓ NO files under `src/ui/feedback/` touched (verified with
  `git diff --name-only HEAD~3 HEAD`).
- ✓ NO `--no-verify` used; NO destructive git commands.

## Placement Option Used

**Placement 2 (split fragment)** per PATTERNS.md — the feedback button
lives OUTSIDE any `{showPencilButton && (<>...</>)}` fragment and is
positioned between the four leading siblings and the kebab. Trade-off
accepted vs placement 1 (button ends up 6th after kebab): placement 2
matches D-02 "fifth of six" verbatim, which is the locked ordering.

## Test File Convention Used

**Analog A (new colocated sibling test file)** —
`PrettyConversationsPanel.send-feedback-button.test.tsx`. Mirrors
`PrettyConversationsPanel.new-role-button.test.tsx` (277 lines) which
established the one-header-button-per-file convention for the
quick-260914-liu repoint. Not extending `PrettyConversationsPanel.test.tsx`
keeps the 25+ pre-existing tests in the main suite isolated from the
Phase 124 surface.

## D-23 Test Case Passage Confirmation

All four D-23 cases pass in the scoped vitest run:

- Test 1 (chrome): PASS
- Test 2 (absent-when-disabled): PASS
- Test 3 (click fires callback): PASS
- Test 4 (independent-gate — D-12): PASS

Total scoped run: 192/192 tests pass across 8 files (the 4 new + 188
pre-existing in the transitive relate set). No pre-existing failures
surfaced — fleet "never leave tests failing" rule trivially satisfied.

## Scope Confirmation

- **Zero shape-1 files touched:** no changes to `src/ui/feedback/*`, no
  changes to Phase 122's AppShell L4041 modal wiring block, no changes
  to feedback-routes / feedback-config / feedback-email /
  feedback-transport / dev-chord hook / nginx configs.
- **Zero deploy commands run:** no docker, no push, no HTTPS verify.
- **Zero full-suite test runs:** scoped `related` only.
- **Zero new package installs.**
- **Zero new CSS defined.**
- **Zero deferred idea leakage:** no role gate, no production keyboard
  shortcut, no telemetry, no header redesign, no interstitial UI, no
  accent/badge/divider.

## Deviations from Plan

None — plan executed exactly as written. All decisions from the
"Claude's Discretion" list in CONTEXT.md matched the PATTERNS.md
recommendations (placement 2 for D-02 verbatim, Analog A for test file
convention, leaf-level hook subscription for `useFeedbackEnabled`,
callback-prop plumbing for the button click).

## Follow-ups / Next Steps

None in-plan. Downstream in the campaign:
- Deploy motion (orchestrator-only per fleet rule) — this executor stops
  at code + commit + scoped tests green.
- Shape 3 (message thumbs on assistant messages) — separate phase, not
  in this plan's scope.

## Self-Check: PASSED

- ✓ `src/ui/AppShell.tsx` modified (commit `85787b56`)
- ✓ `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
  modified (commit `96e89025`)
- ✓ `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx`
  created (commit `921f795b`)
- ✓ All three commits present on `feat/tab-title-from-tmux` per
  `git log --oneline HEAD~3..HEAD`
- ✓ Overall phase verification (6 checks) all pass
- ✓ Scoped vitest 192/192 pass
- ✓ Frontend build clean
- ✓ Zero shape-1 files touched
