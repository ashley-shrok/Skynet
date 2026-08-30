---
phase: 13-skynet-transformation-conversation-list-lift-from-mock
plan: 03
subsystem: pretty-conversations
tags: [ui, css, pretty-conversations, lift-from-mock, pin-action, phase-13]
dependency_graph:
  requires:
    - phase: 13-01
      provides: pretty-conversations.css `.pv-row` + `.pv-meta` + `.pv-pin` + hide-on-unpinned-pin-glyph selectors (Wave 1's foundation)
    - src/ui/index.css (--color-pv-* palette tokens for the RDP defensive override + focus-visible outline)
    - prototype.html mock v4 lines 333-337 (Ashley-locked 2026-07-23)
  provides:
    - PinAction desktop button rendered as bare icon with hue-cream fill + hue-drop-shadow (SHAPE-03 mock recipe)
    - `.pv-pin-action-desktop` CSS class contract — usable by any future component that wants the mock's bare-icon-with-hue-glow treatment inside a `.pv-row`
    - Hide-on-unpinned-desktop-non-hovered-non-focused rule — the mock's `.row:not(.pinned) .meta .pin { display: none }` translated to the fork's `.pv-pin-action-desktop` selector (class-based, keyboard-nav friendly)
  affects:
    - Wave 4 (13-04): post-lift verification/UAT — pin appearance now matches mock v4 across all identity hues
    - Master `skynet-transformation` bounty: closes SHAPE-03 ("The pin buttons are totally obnoxious" — Ashley 2026-07-23)
tech_stack:
  added: []
  patterns:
    - class-toggle-driven bare-icon button (no JS-computed CSSProperties for color or filter)
    - `var(--pv-hue, 216)` fallback for hue-null rows (CSS-native default without JS branching)
    - Combined `:not(.pinned):not(:hover):not(:focus-within)` selector for the hide-on-unpinned rule — allows keyboard-nav pinning without breaking the mock's visual invariant
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PinAction.tsx (124 → 113 lines, -11)
    - src/ui/features/pretty-conversations/pretty-conversations.css (472 → 533 lines, +61)
decisions:
  - "Combined the source rewrite (PinAction.tsx) and CSS augmentation (pretty-conversations.css) into a single atomic commit c2e48de. Plan explicitly allowed either 1 or 2 commits ('Combine into ONE commit if the executor judges the split unnecessary'). Chose one because the two edits are semantically coupled (source references the new class name; CSS declares the new class name) and splitting would leave a temporarily-broken visual state (source uses class-that-doesn't-exist-yet or CSS declares class-nobody-uses-yet). Both files' tests + tsc green after the single commit."
  - "Retained the existing Wave 1 `.pv-row.pv-row--desktop:not(.pinned):not(:hover) .pv-meta [data-testid=\"pin-action\"] { opacity: 0 }` rule as-is. It targets the pin-action button by data-testid — the new PinAction still emits that data-testid, so the rule still works. Adding the new class-based hide rule (`.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within) .pv-pin-action-desktop { display: none }`) makes the invariant more explicit and adds `:focus-within` for keyboard-nav (a strict superset of the opacity behavior). Keeping both is defense-in-depth; specificity resolves as the newer rule sets `display: none` while the older rule sets `opacity: 0` — both are 'hidden' outcomes."
  - "Chose `var(--pv-hue, 216)` CSS fallback (216 = neutral blue) over a JS-side `hue == null` branch. Plan explicitly allowed either — the CSS fallback is one line, no JS state, and matches how `.pv-row { --pv-hue: 216; }` already declares its own fallback for hue-null rows. Component signature (hue: number | null) unchanged."
  - "Kept `data-testid={dataTestId ?? 'pin-action'}` verbatim. Test 8 (desktop pin click stopPropagation) queries the button by that testid; changing it would break the test without changing behavior."
  - "Retired icon size classes (`w-3.5 h-3.5` on <Pin>/<PinOff>) in favor of CSS `.pv-pin-action-desktop svg { width: 14px; height: 14px; stroke-width: 2 }` — matches the mock's raw-CSS approach and keeps all visual definition in the CSS file."
  - "Added `:hover` glow boost (drop-shadow from 4px/0.55 to 6px/0.75) and `:focus-visible` hue-tinted outline (a11y — the retired Skynet chrome had `hover:bg-white/[0.06]` as the only affordance signal; the new bare-icon needs its own hover + focus signals). Both are palette-consistent additions the mock didn't cover but that Ashley's fork requires for keyboard-nav accessibility."
  - "RDP row override (`.pv-row.rdp .pv-pin-action-desktop { color: var(--color-pv-fg-muted); filter: none }`) declared defensively even though RDP rows never render PinAction per the Row's contract. Costs nothing (2 lines) and preempts a class of visual bugs if a future refactor allows RDP pinning."
requirements_completed: [SHAPE-03]
metrics:
  duration: 10min
  started: "2026-07-23T15:07:00Z"
  completed: "2026-07-23T15:17:26Z"
  tasks: 1
  commits: 1
  files_changed: 2
  lines_added: 87
  lines_deleted: 35
  net_lines: +52
---

# Phase 13 Plan 03: Skynet Transformation — PinAction Bare-Icon-with-Hue-Glow Lift-from-Mock Summary

**PinAction desktop branch rebased to the mock v4 bare-icon-with-hue-drop-shadow treatment — `color: hsla(var(--pv-hue), 80%, 70%, 0.95)` + `filter: drop-shadow(0 0 4px hsla(var(--pv-hue), 80%, 60%, 0.55))` — retiring the last 2 Skynet theme-class hits in the conversation-list subtree and delivering SHAPE-03 verbatim per Ashley's "totally obnoxious" callout.**

## One-Liner

Desktop pin now renders as a bare icon with hue-cream fill + hue-drop-shadow (no `w-6 h-6 rounded-md bg-transparent border-0 hover:bg-white/[0.06]` chrome, no `text-muted-foreground/60` fill); mobile 48x48 swipe-reveal disc preserved verbatim; last 2 `text-muted-foreground` hits in `src/ui/features/pretty-conversations/` purged — subtree is 100% palette-tokenized.

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-23T15:07:00Z
- **Completed:** 2026-07-23T15:17:26Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- PinAction desktop branch renders `<button className="pv-pin-action-desktop">` — bare button, no wrapper chrome. CSS class handles all visual definition.
- `pretty-conversations.css` augmented with `.pv-pin-action-desktop` selector block (61 net new lines, appended after the existing desktop hover-reveal block):
  - Base: 20x20 inline-flex, transparent bg, border 0, hue-cream fill `hsla(var(--pv-hue, 216), 80%, 70%, 0.95)`, drop-shadow `hsla(var(--pv-hue, 216), 80%, 60%, 0.55)` — verbatim from prototype.html mock v4 lines 333-337
  - Icon size: `.pv-pin-action-desktop svg { width: 14px; height: 14px; stroke-width: 2 }` — replaces the retired `w-3.5 h-3.5` Tailwind classes
  - `:hover`: glow boost to `drop-shadow(0 0 6px hsla(var(--pv-hue, 216), 80%, 60%, 0.75))` — accessibility affordance since the button chrome (former hover:bg-white/[0.06] visual signal) is retired
  - `:focus-visible`: 2px hue-tinted outline for keyboard-nav accessibility
  - RDP defensive override: `color: var(--color-pv-fg-muted); filter: none` (RDP rows never render PinAction per Row contract, but the override costs nothing)
  - Hide-on-unpinned rule: `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within) .pv-pin-action-desktop { display: none }` — mock invariant lifted verbatim, with `:focus-within` added for keyboard-nav pinning
- Mobile branch (`size='mobile'`) preserved byte-for-byte in code — only comments annotated with "UNCHANGED by Phase 13 Plan 03" to make the parallel-safety with Ashley's iPhone swipe workflow explicit. The 48x48 hue-tinted disc treatment (bg, borderColor, box-shadow) is identical to pre-Phase-13.
- Purged the last 2 Skynet theme-class hits in the conversation-list subtree — PinAction.tsx:97,98,101 (`text-muted-foreground/60`, `hover:text-foreground`). Full-subtree grep for `text-muted-foreground|hover:text-foreground|bg-background|bg-card|text-foreground|border-border|muted-foreground` now returns 0 non-comment hits.
- `npx tsc --noEmit` exits 0 after the commit.
- `npx vitest run src/ui/features/pretty-conversations/` all 34 tests pass (14 panel + 20 row) — Test 8 (desktop pin click stopPropagation) continues to pass since click event forwarding is preserved verbatim.
- Scope-lock preserved: `git diff --name-only HEAD~1 HEAD` returns exactly the two files declared in the plan's `files_modified`. No touch of `PrettyConversationRow.tsx`, `PrettyConversationsPanel.tsx`, `AppShell.tsx`, `pretty-view/`, `components/`, `ssh/`, or `terminal/`.

## Task Commits

1. **Task 1 (source + CSS combined):** `c2e48de` — `feat(13-03): rewrite PinAction desktop to mock's bare-icon-with-hue-glow`

Plan's suggested split (1 or 2 commits at Claude's discretion) resolved as 1. See Decisions section for rationale.

## Files Modified

- `src/ui/features/pretty-conversations/PinAction.tsx` (124 → 113 lines):
  - Retired: `iconColorStyle` derivation (JS-computed hue color), `iconClassBase` derivation (JS-computed Skynet theme-class string), Tailwind chrome classes (`w-6 h-6 rounded-md bg-transparent border-0 hover:bg-white/[0.06] transition-colors duration-100 cursor-pointer`), inline `style={iconColorStyle}` prop on the button, icon size classes (`w-3.5 h-3.5` on <Pin>/<PinOff>).
  - Preserved: all imports (Pin, PinOff, useTranslation, MouseEvent type), prop shape (`hue`, `pinned`, `size`, `onClick`, `data-testid`), label derivation (`t("nav.conversations.unpin"...)` / `t("nav.conversations.pin"...)`), mobile branch (lines 57-91 in new file, byte-equivalent to old lines 48-83), onClick forward semantics, data-testid default.
  - Added: header comment block updated to cite prototype.html mock v4 lines 333-337 as the source-of-truth for the desktop treatment; comment block documenting the CSS-driven hide-on-unpinned-non-hovered-non-focused invariant.
- `src/ui/features/pretty-conversations/pretty-conversations.css` (472 → 533 lines):
  - Appended: `DESKTOP PIN ACTION — Phase 13 Plan 03 (SHAPE-03)` header block with 6 CSS rules (`.pv-pin-action-desktop`, `.pv-pin-action-desktop svg`, `.pv-pin-action-desktop:hover`, `.pv-pin-action-desktop:focus-visible`, `.pv-row.rdp .pv-pin-action-desktop`, `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within) .pv-pin-action-desktop`).
  - Preserved: every Wave 1 + Wave 2 selector unchanged. Verified via `git diff` — the appended block sits at the end of the file; all prior selectors are byte-equivalent to their post-Wave-1 state.

## Decisions Made

- **Single atomic commit vs. 2-commit split:** Plan explicitly allowed either. Chose single because the source references the new CSS class name — splitting would leave a temporarily-broken visual state (source uses class-that-doesn't-exist-yet or CSS declares class-nobody-uses-yet). Both files' tests + tsc green after the single commit; commit boundary matches the semantic unit.
- **Retain existing Wave 1 opacity rule as-is:** The pre-existing `.pv-row.pv-row--desktop:not(.pinned):not(:hover) .pv-meta [data-testid="pin-action"] { opacity: 0 }` rule targets the button by data-testid — the new PinAction still emits that data-testid, so the rule still fires. The new class-based hide rule (`display: none`) is a strict superset (adds `:focus-within` for keyboard-nav) and supersedes the opacity rule visually. Kept both for defense-in-depth; different selectors, non-conflicting outcomes ("hidden" either way).
- **`var(--pv-hue, 216)` CSS fallback vs. JS `hue == null` branch:** Chose CSS. One line, no JS state, matches how `.pv-row { --pv-hue: 216 }` already declares its own fallback. Component signature unchanged.
- **Retained icon size in CSS, retired inline Tailwind:** `.pv-pin-action-desktop svg { width: 14px; height: 14px; stroke-width: 2 }` — matches the mock's raw-CSS approach and keeps all visual definition in the CSS file. Component just emits `<Pin/>` / `<PinOff/>` with no size class.
- **Added `:hover` glow boost + `:focus-visible` outline:** Not in the mock (which is a static HTML mock without hover/focus signals). The retired Skynet chrome had `hover:bg-white/[0.06]` as the only hover affordance signal; the new bare-icon needs its own hover + focus signals for accessibility. Both use `hsla(var(--pv-hue), ...)` to stay palette-consistent.
- **RDP defensive override:** `.pv-row.rdp .pv-pin-action-desktop { color: var(--color-pv-fg-muted); filter: none }` declared even though RDP rows never render PinAction per Row contract. Costs 2 lines; preempts a future-refactor bug class.
- **Comment-only annotation of mobile branch:** Mobile branch code is byte-equivalent pre and post. Only added the "UNCHANGED by Phase 13 Plan 03" annotation in the mobile section's comment so future readers see the parallel-safety with Ashley's iPhone swipe-reveal affordance made explicit. No behavior change.

## Deviations from Plan

None. All work stayed within the plan's stated scope. Single-commit-vs-2-commit split was explicitly allowed by the plan text; no rule (1/2/3/4) was triggered.

## Auth Gates

None. Pure UI CSS + React component rewrite — no network endpoints, no auth paths, no credentials or secrets touched.

## Rule 4 (Architectural) Decisions

None escalated. All work stayed within the class-toggle-state-variant architecture Ashley locked in `13-CONTEXT.md`.

## Issues Encountered

- **Baseline pre-existing failure (out of scope):** `src/ui/features/pretty-view/ComposeBox.test.tsx` has 2 failing tests as documented in the 13-02 summary. Confirmed still failing at same 2 tests — same as baseline. Not in this plan's scope (SHAPE-06 lockout — `src/ui/features/pretty-view/` is off-limits). This plan's scoped verification (`npx vitest run src/ui/features/pretty-conversations/`) is 34/34 green.
- No auth-gate encounters. No package installs. No architectural (Rule 4) escalations.

## Acceptance Criteria Rundown

| Criterion | Status |
|-----------|--------|
| PinAction.tsx desktop branch uses `className='pv-pin-action-desktop'` | PASS |
| PinAction.tsx contains no non-comment lines with `text-muted-foreground/60`, `hover:text-foreground`, `rounded-md bg-transparent border-0 hover:bg-white/[0.06]` | PASS |
| PinAction.tsx mobile branch (size='mobile') UNCHANGED — `git diff` shows changes only in the desktop branch region + comments | PASS |
| pretty-conversations.css contains `.pv-pin-action-desktop` selector | PASS |
| pretty-conversations.css contains `hsla(var(--pv-hue` (color + drop-shadow filter reference — 6 hits) | PASS |
| pretty-conversations.css contains a hide-on-unpinned rule for `.pv-pin-action-desktop` on non-hovered non-focused desktop rows | PASS |
| Full grep `grep -rE 'text-muted-foreground\|hover:text-foreground\|bg-background\|bg-card\|text-foreground\|border-border\|muted-foreground' src/ui/features/pretty-conversations/` returns 0 non-comment hits | PASS |
| `npx tsc --noEmit` exits 0 | PASS |
| `npx vitest run src/ui/features/pretty-conversations/` all green (34/34) | PASS |
| No edits under `src/ui/features/pretty-view/`, `src/ui/components/`, `src/ui/ssh/`, `src/ui/features/terminal/`, `PrettyConversationRow.tsx`, `PrettyConversationsPanel.tsx`, `AppShell.tsx` | PASS |
| 1 atomic commit landed (source + CSS combined per plan discretion) | PASS (c2e48de) |

## Known Stubs

None. All data flows preserved (hue, pinned, onClick, data-testid unchanged). All button-chrome + Skynet theme classes replaced by equivalent CSS-class-driven treatment. No hardcoded empty values, no placeholder text, no "coming soon" markers. The RDP defensive override is a deliberately-narrow class-based fallback, not a stub.

## Threat Flags

No new security-relevant surface. This plan is pure UI CSS + JSX text refactoring — no network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. STRIDE register mitigations applied as designed:

- **T-13-03-01 (Tampering — accidental mobile branch change):** `git diff src/ui/features/pretty-conversations/PinAction.tsx` inspected pre-commit. Non-comment code lines in the mobile branch (lines 57-91 of new file, was lines 48-83 of old file) are byte-equivalent. Comment additions are non-functional documentation.
- **T-13-03-02 (Denial of Service — row hue not inherited into pin button):** CSS declares `var(--pv-hue, 216)` fallback so the pin renders SOMETHING even if inheritance fails. Wave 4 (13-04) UAT walkthrough will verify hue propagation across 3+ identities.
- **T-13-03-03 (Repudiation — which layer purged the last Skynet theme-class hit):** Task 1's final grep gate returned 0 non-comment hits. Purge is definitively this plan's work — PinAction.tsx lines 97/98/101 in the pre-plan file were the only remaining hits, and they are gone from the post-plan file.
- **T-13-03-04 (Denial of Service — pinned vs. hide CSS rule collision):** Wave 1's `.pv-row:not(.pinned) .pv-meta .pv-pin { display: none }` targets the pin GLYPH (a `.pv-pin`-classed lucide svg — not currently emitted; the fork's PinAction subsumes it). This plan's `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within) .pv-pin-action-desktop { display: none }` targets the pin-ACTION button (the `<button className="pv-pin-action-desktop">`). Different elements, different class names, no collision. Verified by grep — both selectors present, neither modified by this plan except the augmentation described.
- **T-13-03-SC (Supply chain — package installs):** Zero installs. Pure CSS + JSX text edit.

## Test Suite Status

**Panel + Row + PinAction scoped (this plan's scope):**
- Before: 34 tests (20 row + 14 panel) all green.
- After: 34 tests all green — no test file touched by this plan. Test 8 (desktop pin click stopPropagation) passes as before since click event forwarding + data-testid are preserved verbatim.

**Global regression check:**
- Baseline (post-13-02): 42 test files, 524 passing + 2 failing (pretty-view ComposeBox).
- After this plan: 42 test files, same 2 baseline failures (verified — not touching pretty-view).
- **Regressions caused by this plan: 0.**

## Downstream Enablement

This plan closes the last SHAPE requirement in Wave 3, freeing Wave 4 (13-04) for post-lift verification:

- **Wave 4 (13-04) — post-lift verification / UAT:** With the pin-button chrome retired and the mock's bare-icon-with-hue-glow treatment applied, Ashley can walk through 3+ active sessions with distinct hues and verify that (a) the pin appears/disappears correctly based on pinned/hover/focus state, (b) the hue tracks the row's identity color, (c) the mobile swipe-reveal 48x48 disc is unchanged. All three SHAPE requirements (SHAPE-01 dot, SHAPE-02 header, SHAPE-03 pin, SHAPE-04 chevron) now match mock v4 verbatim on the surfaces Ashley called out.
- **Wave 5 (13-05) — Build-verify + UAT checklist + patch draft:** All conversation-list-surface Skynet theme classes purged. The subtree is 100% `--color-pv-*`/`.pv-*`-scoped. Build-verify + upstream-rebase-diff can proceed cleanly.

## Follow-up Candidates for Master Bounty

None require sibling bounties. Everything in this plan flows through the master `skynet-transformation` bounty:

- The pin-focus-visible outline (`outline: 2px solid hsla(var(--pv-hue, 216), 70%, 60%, 0.6); outline-offset: 2px`) is an a11y addition not in the mock. If UAT reveals the outline is too aggressive or clashes with the drop-shadow, tune down to `outline-width: 1px` or `outline-color: rgba(220, 225, 245, 0.4)` (palette-tokened) — candidate for a follow-up patch inside the master bounty.
- The pin-hover glow boost (`drop-shadow(0 0 6px hsla(var(--pv-hue, 216), 80%, 60%, 0.75))`) similarly is an a11y-driven addition. Tune-down candidate if UAT feedback flags it as too pulsing/distracting.

## Self-Check: PASSED

- **Files verified exist and are modified as declared:**
  - FOUND: `src/ui/features/pretty-conversations/PinAction.tsx` (113 lines, references `pv-pin-action-desktop`, no Skynet theme classes)
  - FOUND: `src/ui/features/pretty-conversations/pretty-conversations.css` (533 lines, `.pv-pin-action-desktop` selector block present, `hsla(var(--pv-hue` + `drop-shadow(0 0 4px hsla(var(--pv-hue` both present)
- **Commit verified exists:**
  - FOUND: `c2e48de` (feat(13-03): rewrite PinAction desktop to mock's bare-icon-with-hue-glow)
- **Test suite green (this plan's scope):** 34/34 pretty-conversations tests pass; `npx tsc --noEmit` exits 0 after the commit.
- **Skynet theme-class purge verified:** `grep -rE 'text-muted-foreground|hover:text-foreground|bg-background|bg-card|text-foreground|border-border|muted-foreground' src/ui/features/pretty-conversations/` returns 0 non-comment hits.
- **Scope-lock preserved:** `git diff --name-only HEAD~1 HEAD` returns exactly `src/ui/features/pretty-conversations/PinAction.tsx` + `src/ui/features/pretty-conversations/pretty-conversations.css`. No pretty-view / components / ssh / terminal / PrettyConversationRow / PrettyConversationsPanel / AppShell touched.
