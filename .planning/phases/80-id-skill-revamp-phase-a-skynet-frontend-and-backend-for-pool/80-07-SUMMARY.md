---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 07
subsystem: frontend/pretty-view
tags: [ui, chat-surface, task-pill, identity, glass-treatment, phase-80]
requires:
  - 80-05  # frontend Identity.task type
provides:
  - task-pill-on-chat-surface
  - dom-testid-pv-task-pill
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (additive JSX sibling to IdentityBadge)
tech-stack:
  added: []
  patterns:
    - inline-style-glass-treatment-mirroring-IdentityBadge
    - data-testid-based-integration-test
    - configurable-per-test-session-identity-mock
key-files:
  created:
    - src/ui/features/pretty-view/PrettyView.task-pill.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - inline pill JSX rather than TaskPill.tsx extraction (executor discretion; single call site, ~38 lines)
  - data-testid="pv-task-pill" for stable test selection (avoids over-coupling tests to full text content)
metrics:
  duration: ~14min
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  commits: 2
  tests_added: 5
  completed_date: 2026-09-06
---

# Phase 80 Plan 07: Task Pill on PrettyView Chat Surface Summary

## Overview

Ships the chat-surface half of the phase's "task pill on chat" scope (D-02, D-06): a hue-tinted glass-treatment pill mounted as a sibling to `IdentityBadge` in the PrettyView top bar, centered horizontally, rendered iff `pvIdentity?.task` is truthy AND the identity resolves for the pane. When absent → no pill (D-06 fallback: legacy identities, pre-Phase-80 identities, coord-spawned identities without task all keep the current surface unchanged).

One-liner: **Additive JSX + 5-case test file. Zero backend, zero CSS, zero IdentityBadge changes. Pill inherits IdentityBadge's glass formula verbatim (hsla ratios + blur + border) with smaller padding/shadow so it reads as a subordinate sibling.**

## Delivered

### Task 1 — task-pill JSX sibling to IdentityBadge in PrettyView

- **File:** `src/ui/features/pretty-view/PrettyView.tsx`
- **Commit:** `b3b01b6e` — `feat(80-07): add task pill sibling to IdentityBadge on PrettyView chat surface`
- **Location:** immediately after the existing `IdentityBadge` mount block (previously at L3070-3078, now flanked by the new pill JSX starting at L3079).
- **Render gate:** `pvIdentityKey && pvIdentity?.task` — the pill piggybacks on the same identity-resolution the badge already uses (`useSessionIdentity(tmuxSession)`), so a fresh pane pre-hydration and any anonymous/legacy session both keep the existing no-pill surface.
- **Positioning:** `absolute top-4 left-1/2 -translate-x-1/2 z-[100]` — the `top-4` matches the badge's own top offset; `left-1/2 -translate-x-1/2` centers horizontally within the PrettyView root; `z-[100]` sits one below the badge's `z-[101]` so any badge drag or click gesture wins the hit-test.
- **Glass treatment (mirrors IdentityBadge.tsx L101-116 verbatim):**
  - `borderRadius: 20` (pill capsule, tighter than badge's 36).
  - `padding: "6px 14px"` (compact; badge is `8 18 8 8`).
  - `background: linear-gradient(160deg, hsla(<hue>, 45%, 25%, 0.72), hsla(<hue>, 40%, 15%, 0.82))` — same hsla ratios as badge.
  - `backdropFilter: "blur(24px) saturate(1.4)"` + WebkitBackdropFilter — identical to badge.
  - `border: 1px solid hsla(<hue>, 65%, 55%, 0.4)` — identical to badge.
  - `boxShadow: 0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.14), 0 0 24px hsla(<hue>, 65%, 55%, 0.24)` — smaller drop-shadow and glow than the badge (0/4/12 vs 0/8/24 dropshadow; 0/0/24 vs 0/0/40 glow; 0.14 vs 0.18 inset alpha) so the pill visually reads as a subordinate.
  - `color: "#e8e4d8"`, `fontSize: 13`, `fontWeight: 500` — same cream text color as badge; text scaled down from the badge's implicit size.
  - `whiteSpace: nowrap; overflow: hidden; textOverflow: ellipsis; maxWidth: 50%` — long tasks clip cleanly rather than wrapping.
  - `animation: "pv-identity-breathe 5s ease-in-out infinite"` — same keyframes as badge (defined in existing pretty-view CSS). Pill and badge breathe in sync.
- **Hue source:** `pvIdentity.colorHue ?? 35` — mirrors IdentityBadge L101 fallback to keep visual coherence when colorHue is null.
- **Text content:** `{pvIdentity.task}` — plain React child (auto-escaped). No `dangerouslySetInnerHTML`. This is the T-80-07-01 mitigation for the XSS threat register entry.
- **testid:** `data-testid="pv-task-pill"` (added for stable test selection).

### Task 2 — PrettyView.task-pill.test.tsx

- **File:** `src/ui/features/pretty-view/PrettyView.task-pill.test.tsx` (new)
- **Commit:** `6d99eeab` — `test(80-07): lock task-pill render gate + hue tint + XSS safety in PrettyView`
- **Framework:** `vitest` + `@testing-library/react` + `jsdom` (existing project scaffolding).
- **Scaffolding pattern:** copied from `PrettyView.aside.test.tsx` (closest existing analog): WS stub factory feeding `wsStubs[]`, `openClaudeSessionSocket` mocked, `compose-drafts-api` mocked, `useSessionIdentity` + `sessionMatchKey` mocked per-test via `.mockReturnValue()`, `IdentityBadge` stubbed to `null`, `ResizeObserver` stub for jsdom.
- **Test cases (all 5 pass; local run 86.97s):**
  1. `Test 1` — pill renders with correct task text + hsla(200, ...) gradient + z-[100] class when `pvIdentity.task="build the pool endpoint"` + `colorHue=200`.
  2. `Test 2` — no pill when `pvIdentity.task=null` (D-06).
  3. `Test 3` — no pill when `pvIdentity.task=""` (falsy gate).
  4. `Test 4` — pill background falls back to `hsla(35, ...)` when `colorHue=null`.
  5. `Test 5` — XSS safety: task `"<img src=x onerror=alert(1)>"` renders as literal text; no `<img>` element injected under the pill (T-80-07-01 mitigation).

## Verification

- Acceptance-criteria greps (Task 1):
  - `grep -c 'pvIdentity?.task\|pvIdentity.task' PrettyView.tsx` = 2 (render gate + text content).
  - `grep -c 'z-\[100\]' PrettyView.tsx` = 2 (className + comment).
  - `grep -c 'linear-gradient(160deg, hsla' PrettyView.tsx` = 1 (new pill inline style).
  - `grep -c 'pv-identity-breathe' PrettyView.tsx` = 2 (className + animation property; increase from prior baseline).
  - `grep -c 'top-4 left-1/2 -translate-x-1/2' PrettyView.tsx` = 1 (pill positioning).
  - `grep -c 'dangerouslySetInnerHTML' PrettyView.tsx` = 0 (unchanged from baseline).
  - `git diff --stat src/ui/features/terminal/IdentityBadge.tsx` = empty (badge byte-untouched).
  - `git diff --stat src/ui/features/pretty-view/*.css` = empty (no CSS file changes).
  - `npx tsc --noEmit` = 0 new errors in PrettyView.tsx.
- Acceptance-criteria greps (Task 2):
  - Test count: `grep -cE "^\s*(it|test)\(" PrettyView.task-pill.test.tsx` = 5.
  - Presence/absence assertions: 8 (`queryByText | queryByTestId | toBeNull` occurrences).
  - Hue assertions: 2 (`hsla(200` + `hsla(35`).
- Full test file run: **5/5 pass, 86.97s** (`npx vitest run src/ui/features/pretty-view/PrettyView.task-pill.test.tsx`).
- Sibling regression check: `PrettyView.aside.test.tsx` runs green (4 pass, 8 skipped as expected per file's own `Test 3/4/7/8/9 skipped` comment for `AUTO_ASIDE_ARM_ENABLED=false`).

## Deviations from Plan

None material.

**Small stylistic adjustment:** the plan's `<action>` referenced adding a comment justifying the plain-text child. My initial comment used the phrase "NOT dangerouslySetInnerHTML" for clarity, but that string tripped the plan's own `grep -c 'dangerouslySetInnerHTML' = 0` acceptance criterion. Rewrote the comment to "no raw-HTML injection path" — same meaning, zero-count preserved. Not a plan deviation, just an inline word swap.

## Decisions Made

- **Inline JSX, no TaskPill.tsx extraction.** The plan explicitly allowed extraction as executor discretion. Chose inline: (a) single call site, (b) 38 lines total including the comment block, (c) test file directly exercises PrettyView behavior end-to-end (mount → identity mock → DOM query), (d) extraction would have required rewriting the test scaffolding to import a smaller unit and would have added an import round-trip without visible benefit. If a future phase adds a second call site (e.g., mobile compact layout), extract at that point.
- **`data-testid="pv-task-pill"` for test selection.** Considered `queryByText(taskString)` only, but adding a testid gives the tests a stable selector even if a future refactor changes the pill's textContent formatting (e.g., wraps in nested spans). Testid names follow existing project convention (`data-pv-root`, `data-testid="drop-overlay-drag"`, etc.).
- **Configurable `sessionMatchKey` mock.** The pill's render gate is `pvIdentityKey && pvIdentity?.task`, so both `sessionMatchKey` AND `useSessionIdentity` must be non-default. The existing analog test files mock only `useSessionIdentity` — I extended that pattern with a paired `sessionMatchKey` mock to fully exercise the gate.

## Threat Model Coverage

Per the plan's `<threat_model>`:

- **T-80-07-01 (XSS via task string) — mitigated.** Task rendered as `{pvIdentity.task}` (plain React child). Test 5 locks the behavior with a real `<img onerror=…>` payload — asserts `textContent` equals the source string AND no `<img>` element gets injected under `[data-testid='pv-task-pill']`.
- **T-80-07-02 (info disclosure) — accepted per plan.** No implementation action needed. Task is intentionally visible on the chat surface — that's the feature.
- **T-80-07-03 (malformed colorHue) — mitigated.** `pvIdentity.colorHue ?? 35` fallback keeps the hsla numeric slot valid. Test 4 asserts the fallback path (`colorHue=null` → `hsla(35, ...)` in the pill background).

## Files Changed

| File | Change | Lines | Commit |
|------|--------|-------|--------|
| `src/ui/features/pretty-view/PrettyView.tsx` | additive JSX block sibling to IdentityBadge | +38 | b3b01b6e |
| `src/ui/features/pretty-view/PrettyView.task-pill.test.tsx` | new test file, 5 cases | +236 | 6d99eeab |

## Follow-ups / Non-Goals

- **Manual visual UAT** (orchestrator ship-gate scope, not executor): open a chat surface for an identity whose frontmatter carries `task: "…"` → confirm the pill appears centered at the top, hue-tinted to match the badge, breathes in sync. Confirm identity without task → no pill.
- **Conversation-list task-primary display** (Plan 80-08 scope, separate plan file exists).
- **Long-task pixel tuning** (executor discretion at ship): if 50% max-width truncates too aggressively for common task strings, bump to 60% or 65%. Adjustable in a single inline `maxWidth: "50%"` value.
- **TaskPill.tsx extraction** — deferred until a second call site emerges.

## Self-Check: PASSED

Verified via bash after writing this SUMMARY:

```
[ -f src/ui/features/pretty-view/PrettyView.task-pill.test.tsx ] → FOUND
[ -f src/ui/features/pretty-view/PrettyView.tsx ] → FOUND
git log --oneline --all | grep -q 'b3b01b6e' → FOUND (Task 1 commit)
git log --oneline --all | grep -q '6d99eeab' → FOUND (Task 2 commit)
```

All 4 items verified present.
