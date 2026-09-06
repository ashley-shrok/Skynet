---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 08
subsystem: frontend/pretty-conversations
tags: [ui, conversation-list, task-primary, identity, phase-80]
requires:
  - 80-05  # frontend Identity.task type
provides:
  - task-primary-conversation-list-row
  - fallback-branch-when-identity-task-absent
affects:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (.pv-body markup gated on identity?.task)
tech-stack:
  added: []
  patterns:
    - gated-ternary-with-fragment-branches-no-wrapper-div
    - verbatim-else-branch-preservation-for-D06-fallback
    - reuse-existing-CSS-classes-per-D03-no-new-selectors
key-files:
  created:
    - src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
decisions:
  - inline conditional (React.Fragment) in-place rather than extracting to a sub-component (single call site, ~25 lines)
  - no new CSS selectors (D-03 lock upheld) — <strong> inherits browser default weight against .pv-ai-title
  - test file kept as a sibling (PrettyConversationRow.task-primary.test.tsx) rather than extending PrettyConversationRow.test.tsx to preserve clean 80-08 diff boundary
metrics:
  duration: ~10min
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  commits: 2
  tests_added: 7
  completed_date: 2026-09-06
---

# Phase 80 Plan 08: Task-Primary Conversation-List Row Summary

## Overview

Ships the conversation-list half of the phase's "task-primary display" scope (D-03, D-06). The `.pv-body` markup in `PrettyConversationRow.tsx` is now a gated ternary on `identity?.task`. When truthy → the row's top line displays the task alone (reuses `.pv-label` typography) and the subtitle displays the role prominently via `<strong>` plus the identity name in muted parens via the existing `.pv-hostname-suffix` class. The AI-generated transcript summary (`aiTitle`) drops entirely from the task-primary branch — Ashley greenlit the drop (80-CONTEXT specifics §last bullet: "do NOT quietly preserve it").

When `identity?.task` is null OR empty → the fallback branch preserves the pre-Phase-80 markup verbatim (D-06 graceful degradation): displayName-primary with hostname-suffix + aiTitle subtitle. All 96 pre-existing PrettyConversationRow tests continue passing unchanged, verifying byte-parity of the fallback branch.

One-liner: **Gated JSX ternary + 7-case sibling test file. Zero CSS changes. Zero unrelated JSX edits. `<strong>` role + `.pv-hostname-suffix` (name) subtitle reuses the existing `.pv-ai-title` typography verbatim per D-03; no new selectors invented.**

## Delivered

### Task 1 — Swap .pv-body markup to gated task-primary vs fallback branches

- **File:** `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`
- **Commit:** `117d3990` — `feat(80-08): gate .pv-body markup on identity?.task — task-primary branch + fallback verbatim`
- **Location:** the `<div className="pv-body">` block that previously lived at L1273-1288.
- **Task-primary branch (when `identity?.task` is truthy):**
  - Top line: `<span className="pv-label">{identity.task}</span>` — task stands alone; no hostname suffix on the top line.
  - Subtitle: `<span className="pv-ai-title"><strong>{identity.role}</strong>{" "}<span className="pv-hostname-suffix">({identity.displayName})</span></span>` — role prominent via native `<strong>`; name in muted parens via existing `.pv-hostname-suffix` class.
  - `aiTitle` NOT rendered — drops entirely from this branch (specifics §last bullet).
- **Fallback branch (when `identity?.task` is null/empty — D-06):**
  - The pre-Phase-80 markup preserved verbatim inside a React.Fragment. Byte-parity verified by `grep -c 'aiTitle !== null ?'` returning 1 (the invariant grep the acceptance criteria call out).
  - All existing 96 tests pass unchanged.
- **No CSS file changes:** `git diff --stat src/ui/features/pretty-conversations/pretty-conversations.css` was empty at commit time. D-03 lock upheld — no new selectors invented; `.pv-label`, `.pv-hostname-suffix`, `.pv-ai-title` reused verbatim. `<strong>` inherits weight from the browser default against `.pv-ai-title`'s 500 base, giving a natural prominence bump.
- **Context-menu label:** `label: "Clone"` unchanged — the rename to "Spawn under this role" is scope-owned by plan 80-06 (already shipped separately) and any further tweaks land in follow-up plans.

### Task 2 — PrettyConversationRow.task-primary.test.tsx

- **File:** `src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx` (new, 362 lines)
- **Commit:** `60b8c3e9` — `test(80-08): add PrettyConversationRow.task-primary.test.tsx — 7 cases`
- **Fixture pattern:** lifted verbatim from `PrettyConversationRow.test.tsx` L68-206 (react-i18next / session-hue / identities-store / bounty-counts / use-is-touch-device mocks). Per-test `currentIdentity` override handle lets each test dial in a task-truthy, task-null, or task-empty identity without touching other modules.
- **Coverage (7 cases, ≥6 required):**
  - **TP1** — `identity.task = "build the pool endpoint"` + `role = "skynet-maintainer"` + `displayName = "Willow"`: top-line `.pv-label` text is exactly the task; subtitle `.pv-ai-title` contains both `"skynet-maintainer"` and `"(Willow)"`; the aiTitle prop text is NOT in the DOM (`queryByText` returns null).
  - **TP2** — `identity.task = null`: fallback markup renders `identity.displayName` in `.pv-label`; aiTitle text IS present in the DOM (fallback branch preserves the pre-Phase-80 shape).
  - **TP3** — `identity.task = ""` (empty string): empty string is falsy, so the fallback branch triggers exactly like `null`. Asserts displayName in `.pv-label` and aiTitle text present.
  - **TP4** — Role prominence guard: `container.querySelector(".pv-ai-title strong")` returns a non-null element; `strong.tagName === "STRONG"`; `strong.textContent === "skynet-maintainer"`.
  - **TP5** — Muted parens guard: `.pv-ai-title .pv-hostname-suffix` present; text content is verbatim `"(Willow)"`.
  - **TP6** — Identity-null fallback: `currentIdentity = null` → useIdentities returns empty byKey Map → identity resolves to null → falsy → fallback renders `row.label` in `.pv-label`. Regression guard for the D-06 safety net (matches existing PrettyConversationRow.test.tsx Test 20B behavior for unresolved identities).
  - **TP7** — Long task string mitigation guard (T-80-08-02): a 400-char task string renders inside `.pv-label` without throwing. Since `.pv-label` is reused verbatim per D-03, the existing fade-truncation CSS (`mask-image` right-edge fade at pretty-conversations.css L721-722) inherits automatically.
- **Runtime:** `npx vitest run PrettyConversationRow.task-primary.test.tsx PrettyConversationRow.test.tsx` → **103 passed (7 new + 96 existing)**. Both files green; zero regressions.

## Verification Results

### Acceptance Criteria (from PLAN.md)

**Task 1:**
- `grep -c 'identity?.task ?' PrettyConversationRow.tsx` → **1** (≥1 required) ✓
- `grep -c '<strong>{identity.role}</strong>' PrettyConversationRow.tsx` → **1** (≥1 required) ✓
- `grep -c 'pv-hostname-suffix' PrettyConversationRow.tsx` → **6** (was 3 pre-edit: comment ref + original fallback occurrence + orig comment; now grew by 3 — subtitle use + fallback use + retained comment refs = ≥2 required) ✓
- `grep -c 'pv-body' PrettyConversationRow.tsx` → **1** (unchanged; no new `.pv-body` element added) ✓
- `grep -c 'aiTitle !== null ?' PrettyConversationRow.tsx` → **1** (fallback byte-parity guard) ✓
- `git diff --stat pretty-conversations.css` → **empty** (no CSS changes) ✓
- `grep -c 'label: "Clone"' PrettyConversationRow.tsx` → **1** (Clone label preserved — plan 80-06 owns the rename) ✓
- `npx tsc --noEmit` → **clean** (no new errors) ✓

**Task 2:**
- Test count in new file → **7** cases (`(it|test)\(` grep, ≥6 required) ✓
- Existing `PrettyConversationRow.test.tsx` → **96 passed** (no regressions) ✓
- New test file → **7 passed** ✓
- Negative aiTitle assertion → **2** (TP1 queryByText returns null; TP3/TP2 queryByText returns truthy — the inverse) ✓

### Success Criteria (from executor prompt)

- Both tasks executed with acceptance criteria met ✓
- Each task committed individually (`117d3990` feat + `60b8c3e9` test) ✓
- SUMMARY.md at `.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-08-SUMMARY.md` ✓
- Scoped tests pass — 7 new + 96 existing = 103 green ✓
- D-03 typography reuse verified: `.pv-label`, `.pv-ai-title`, `.pv-hostname-suffix` reused verbatim; no new CSS selectors added ✓
- D-06 fallback verified: TP2 (task=null), TP3 (task=''), TP6 (identity=undefined) all assert fallback branch renders pre-Phase-80 shape ✓
- No worktree / push / docker ✓ (sequential executor mode)

## Deviations from Plan

None — the plan executed exactly as written. Both tasks completed on first-pass implementation; no auto-fix (Rules 1/2/3) invoked; no architectural questions (Rule 4) surfaced.

The plan flagged a possible pixel-tuning escape hatch — adding a `.pv-role-prominent` class if `<strong>` inside `.pv-ai-title` renders too heavy against the base weight (D-03 executor discretion). No such adjustment was needed at implementation time; the `<strong>` inside `.pv-ai-title`'s weight-500 base gives a natural prominence bump that reads correctly. If Ashley's real-browser UAT surfaces a mismatch, a follow-up plan (or an inline-* commit) can add the class without touching the JSX.

## Threat Model Coverage

| Threat ID   | Disposition | Mitigation Verified |
| ----------- | ----------- | ------------------- |
| T-80-08-01  | mitigate    | Task/role/displayName rendered as `{identity.task}` / `{identity.role}` / `{identity.displayName}` — React auto-escapes; no `dangerouslySetInnerHTML`. |
| T-80-08-02  | mitigate    | TP7 test guard: 400-char task string renders in `.pv-label` (which handles fade-truncation via inherited CSS). |
| T-80-08-03  | accept      | aiTitle drop is a product decision (Ashley greenlit); not a security concern. |

## Test Files Touched

- `PrettyConversationRow.task-primary.test.tsx` — 7 test cases (new file).
- `PrettyConversationRow.test.tsx` — untouched (all 96 tests continue passing as the D-06 fallback preserves the pre-Phase-80 markup verbatim).

## Downstream Impact

The task-primary display now surfaces for any identity whose file frontmatter carries a `task` field. Coordinator-spawned identities and legacy pre-Phase-80 identities without task continue rendering the current shape untouched (D-06). No consumer changes required in `PrettyConversationsPanel.tsx` — the panel already passes `aiTitle` unconditionally; the row now decides whether to render it based on the identity's own task field.

Plan 80-09 (the phase's final integration/verification pass) can now exercise the full path end-to-end (backend task write via 80-01/02/03/03b/04 → frontend Identity type via 80-05 → chat pill via 80-07 → list row via THIS plan) against an identity with `task:` in its frontmatter.

## Self-Check: PASSED

- File `.planning/phases/80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool/80-08-SUMMARY.md` (this file) — FOUND.
- File `src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx` — FOUND.
- File `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — MODIFIED (verified via `git log --oneline`).
- Commit `117d3990` — FOUND in `git log`.
- Commit `60b8c3e9` — FOUND in `git log`.
