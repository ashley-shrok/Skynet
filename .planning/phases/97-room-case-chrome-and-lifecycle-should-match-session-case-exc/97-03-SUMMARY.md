---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 03
subsystem: ui/pretty-view
tags: [ui, relay, compose-box, placeholder, reflow, phase-97-finding-3, phase-97-finding-6]
requires:
  - Phase 93 D-11 (monolithic Row 1 + Paperclip hide on mode="relay")
  - Phase 93 Slice 3 Task 2 (ComposeBox mode-hide test infrastructure)
  - Phase 93 Slice 3 Task 3 (PrettyView relay-source test infrastructure)
provides:
  - Mode-gated pl-11 gutter (relay case: pl-11 absent — ghost gutter removed)
  - Relay-mode invisible Row 1 spacer skeleton (byte-identical vertical envelope to Row 1 for QueuePlusTab headroom)
  - Case-branched identityName prop at PrettyView ComposeBox mount (relay renders `Message room…`)
affects:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx (extended)
  - src/ui/features/pretty-view/PrettyView.relay-source.test.tsx (extended)
tech-stack:
  added: []
  patterns:
    - "mode-gate case-branch discipline (Phase 93 D-11): `mode !== \"relay\"` (or its inverse) applied to case-differentiated chrome tokens."
    - "Case-branch at the ComposeBox call site (Phase 93 D-17 spirit): concentrates case-branching at the boundary rather than inside the reusable component."
    - "Invisible spacer skeleton (aria-hidden=\"true\") as a byte-identical vertical envelope substitute — Option B from RESEARCH § Finding 3."
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx
    - src/ui/features/pretty-view/PrettyView.relay-source.test.tsx
decisions:
  - "Option B (invisible Row 1 spacer skeleton) chosen over Option A (mode-conditional pt-N on primary wrapper) per RESEARCH recommendation: preserves geometry byte-for-byte via matching mb-[3px] + min-h-[44px]/min-h-8 conditional; no fine-tune of pt-N needed against QueuePlusTab's -top-N offset."
  - "Shape A (case-branch at PrettyView call site) chosen over Shape B (case-branch inside ComposeBox placeholder template): concentrates case-branch discipline alongside adjacent case-branched props (onOptimisticSend, canSend, mode)."
  - "Placeholder capital-M `Message room…` locked (D-14 SOFT — matches harness template's `Message ${identityName}…` capitalization convention). Ashley's `message room` shorthand read as informal, not a design directive."
  - "U+2026 ellipsis preserved by construction: the case-branch passes a plain string that gets interpolated into ComposeBox's existing template — the ellipsis character lives inside the template at ComposeBox.tsx:2773 and is never touched."
metrics:
  duration_minutes: 7
  completed: 2026-09-10
---

# Phase 97 Plan 03: ComposeBox reflow + placeholder Summary

**One-liner:** Ships F-3 (ComposeBox visual parity for the relay case — ghost `pl-11` gutter gated on `mode !== "relay"`; invisible Row 1 spacer skeleton restores vertical envelope so QueuePlusTab pebble has headroom) and F-6 (placeholder reads `Message room…` in the relay case via a single-line case-branch at the PrettyView ComposeBox mount).

## What Was Built

Two tasks, two commits — both file-scoped fills of case-branches Phase 93 D-11's monolithic mode-hide left dangling.

### Task 1 — F-3 ComposeBox reflow (commit `a04e862d`)

Two atomic changes in `ComposeBox.tsx`, plus test extension.

**Change 1 — pl-11 mode-gate:** L2865 (was L2836 pre-plan) extended:
```tsx
// before:
showPaperclip && "pl-11",
// after:
showPaperclip && mode !== "relay" && "pl-11",
```
Same idiom as L2334 (Row 1 gate) and L2937 (Paperclip gate, was L2908). The `pl-11` (44px left padding) reserving space for a Paperclip that no longer renders in relay mode is now correctly gated.

**Change 2 — invisible Row 1 spacer skeleton:** New JSX block inserted immediately after Row 1's closing `)}` (as a sibling of Row 1, before Row 2):
```tsx
{mode === "relay" && (
  <div
    data-testid="compose-row-1-relay-spacer"
    aria-hidden="true"
    className={cn(
      "mb-[3px]",
      isTouchDevice ? "min-h-[44px]" : "min-h-8",
    )}
  />
)}
```
Byte-identical vertical envelope to Row 1's outer wrapper (same `mb-[3px]`, same `min-h-[44px]`/`min-h-8` conditional on `isTouchDevice`). Zero content. `aria-hidden="true"` keeps it out of the a11y tree — pure visual scaffolding. QueuePlusTab's `-top-N` absolute offset (positioned relative to the primary wrapper at L2695, function body at L3167-3210) now has the same headroom in relay mode as in harness mode.

**Test extension:** `ComposeBox.mode-hide.test.tsx` gained three tests:
- **Test 6:** `mode="relay"` + `showPaperclip=true` → textarea does NOT have `pl-11` class.
- **Test 7:** `mode="relay"` → spacer element exists with `aria-hidden="true"` + `mb-[3px]` + either `min-h-8` or `min-h-[44px]`.
- **Test 8:** `mode="harness"` regression floor → textarea HAS `pl-11` AND spacer does NOT exist.

9/9 tests pass (5 pre-existing + 3 new; Test 5's baseline unchanged — the file already had 6 tests including a 1b, hence 5+3=... actually 6+3=9). 68/68 pass across adjacent `ComposeBox.test.tsx` + `ComposeBox.queue-plus-tab.test.tsx`.

### Task 2 — F-6 placeholder case-branch (commit `bfc34e78`)

Single-line change in `PrettyView.tsx` at the ComposeBox mount block (line was L4249 in the plan; landed at L4288 due to Plan 97-02's peer-effect insertion shifting the file downward). Comment added above the prop to document the reasoning.

**Before:**
```tsx
identityName={pvIdentity?.displayName}
```

**After:**
```tsx
identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}
```

ComposeBox's template at `ComposeBox.tsx:2773` (was L2750) reads `` `Message ${identityName || "Claude"}…` `` — the case-branch passes `"room"` for relay, yielding `Message room…`. The `|| "Claude"` fallback still handles the harness path when `pvIdentity` is null.

**Test extension:** `PrettyView.relay-source.test.tsx` gained two tests:
- **Test 5c:** relay case → `textarea.getAttribute("placeholder")` strictly equals `"Message room…"` (U+2026 copied verbatim from the source template).
- **Test 5d:** harness case regression floor → if the ComposeBox mounts on initial render, its placeholder must NOT be `Message room…` and must retain the template shape (`Message ` prefix + `…` U+2026 suffix).

11/11 pass (was 9 → +2 new = 11).

## Visual Verification — Descriptive Before/After

Live browser verification was not performed as part of this executor run (no CHECKPOINT was gated on live visual per the plan's `<no_checkpoints>` clause; the plan's `<verification>` section states "Visual verification (during execute-plan run — live browser)" but the fleet constraint in this run's prompt is scoped-tests-only). Structural verification via grep + scoped tests is complete; visual verification is deferred to the phase-close human-verify checkpoint.

**Descriptive expected state (relay case, post-plan):**
- **ComposeBox textarea** — left padding matches the harness case's `px-4` alone (no `pl-11` 44px gutter). Text abuts the left edge with the standard 16px inset only.
- **QueuePlusTab pebble** — sits ~32px above the textarea's top edge (matches its harness-mode headroom against Row 1's outer envelope). Clip-path silhouette not clipped by the ComposeBox outer container.
- **ComposeBox total height** — bounding-rect height should match the harness case within 1px for the same viewport size (D-09 vertical parity — the invisible spacer replaces Row 1's outer envelope byte-for-byte).
- **Placeholder text** — `Message room…` (capital M, U+2026 ellipsis).

**Descriptive expected state (harness case, post-plan — regression floor):**
- **ComposeBox textarea** — `pl-11` still present (Paperclip button still renders inside the textarea at `left-1 bottom-0.5`).
- **Row 1** — full instrument bar renders normally (meter, ThumbsUp, Recap, etc.).
- **Placeholder text** — `Message <identityName>…` unchanged (`Message Claude…` when pvIdentity is null; `Message Tina…` when tina identity resolves; etc.).

## D-09 Vertical Parity — Satisfied by Construction

The invisible Row 1 spacer's vertical envelope is written to be byte-identical to Row 1's outer wrapper:

| Property | Row 1 (harness) | Invisible Spacer (relay) |
|----------|-----------------|--------------------------|
| Bottom margin | `mb-[3px]` | `mb-[3px]` |
| Min-height (desktop, `isTouchDevice=false`) | `min-h-8` (32px) | `min-h-8` (32px) |
| Min-height (touch, `isTouchDevice=true`) | `min-h-[44px]` (44px) | `min-h-[44px]` (44px) |
| Row 1 has content flex expansion? | Yes — instrument bar body flexes taller when meter well grows | No — empty div, height locked to min-h |

The one theoretical divergence: if Row 1's *body* ever grew taller than `min-h-8` (e.g. a meter well with more segments), Row 1 would be taller than the invisible spacer. In practice, the meter well is a fixed-height segmented well and Row 1 stays at exactly `min-h-8` (32px) desktop / `min-h-[44px]` (44px) touch. Verified by inspection at `ComposeBox.tsx:2334` — the row's `className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}` has no vertical-flex allowance beyond that min-height. D-09 parity is therefore satisfied by construction — no residual fine-tune required.

## U+2026 Ellipsis Confirmation

**Confirmed U+2026, not three dots.** Verification path:

1. `ComposeBox.tsx:2773` (source of truth): `placeholder={\`Message ${identityName || "Claude"}…\`}`
2. `od -An -tx1` on the line confirmed the byte sequence `e2 80 a6` (UTF-8 encoding of U+2026 HORIZONTAL ELLIPSIS).
3. `PrettyView.relay-source.test.tsx` Test 5c assertion string `"Message room…"` — the `…` character was copied verbatim from the ComposeBox.tsx source, not typed as three dots. Test 5c passes green (the assertion is `toBe("Message room…")` — a strict equality; if it were three dots the assertion would fail against the U+2026 template output).

**No ellipsis character was touched in this plan.** The case-branch at PrettyView.tsx passes a plain string `"room"` (no ellipsis) that gets interpolated into ComposeBox's existing template — the template owns the ellipsis, and the template was byte-unchanged.

## Deviations from Plan

Two minor deviations, both mechanical, both non-blocking:

### 1. Line numbers drifted from plan text

The plan quotes `L2836`, `L2334`, `L2908`, `L2695`, `L4249`, `L2750`. Actual line numbers post-Plan-97-02 (which added 18 lines to `PrettyView.tsx` via the new relay-veil peer effect) and post-Plan-97-03 (which added 23 lines to `ComposeBox.tsx` via the comment + spacer):

| Anchor | Plan-quoted line | Actual line (pre-97-03) | Actual line (post-97-03) |
|---|---|---|---|
| Row 1 mode-gate | L2334 | L2334 | L2334 (unchanged) |
| Textarea `pl-11` | L2836 | L2836 | L2865 (shifted by +29 via comment I added) |
| Paperclip mode-gate | L2908 | L2908 | L2937 |
| Primary wrapper | L2695 | L2695 | L2695 (unchanged — I only touched after Row 1's closing) |
| Placeholder template | L2750 | L2750 | L2773 |
| `identityName` prop (PrettyView) | L4249 | L4279 | L4288 |

No functional impact — every grep gate in the plan's `<acceptance_criteria>` matches on structural content, not on line numbers. Recorded here for traceability.

### 2. Substituted `--related` vitest flag with direct paths

The plan's `<verify><automated>` blocks use `npx vitest run --related <path>`. Same environmental note as Plan 97-02: vitest v4.1.8 in this repo does not support `--related`. Substituted with direct path targeting — `npx vitest run <file>` — which is the equivalent scoped mechanism.

No Rules-1-3 deviations. No auth gates. No architectural surprises.

## Verification Results

- **Task 1 grep gates (all pass):**
  - `showPaperclip && mode !== "relay" && "pl-11"` present (single occurrence).
  - `data-testid="compose-row-1-relay-spacer"` present.
  - `aria-hidden="true"` present.
  - `mode !== "relay"` count: 4 (Row 1 gate + comment I added + new pl-11 gate + Paperclip gate) — meets >=3 floor.
  - `mode === "relay"` count: 3 (2 pre-existing + 1 new spacer skeleton) — meets >=1 floor.
  - `min-h-8!` count: 3 (unchanged from baseline).
  - `data-testid="compose-row-1"` count: 1 (unchanged from baseline; the spacer uses a distinct testid `compose-row-1-relay-spacer`).
  - Primary wrapper `className="relative flex-1 self-stretch"` count: 2 (unchanged).
- **Task 2 grep gates (all pass):**
  - `identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}` present (single occurrence).
  - `identityName={pvIdentity?.displayName}` (un-branched) count: 0 (completely replaced).
  - ComposeBox placeholder template `` `Message ${identityName || "Claude"}…` `` unchanged.
- **Scoped Vitest runs (all green):**
  - `ComposeBox.mode-hide.test.tsx`: 9/9 pass (6 pre-existing + 3 new).
  - `ComposeBox.test.tsx` + `ComposeBox.queue-plus-tab.test.tsx`: 68/68 pass (adjacent-file regression floor).
  - `PrettyView.relay-source.test.tsx`: 11/11 pass (9 pre-existing + 2 new).
  - `PrettyView.test.tsx` + `PrettyView.relay-veil.test.tsx`: 42 passed / 1 skipped / 1 todo (unchanged from Plan 97-02 baseline).
  - **Aggregate scoped run** (all six files together): 130 passed / 1 skipped / 1 todo across 6 files.
- **`npx tsc --noEmit`:** clean (exit-0, zero errors project-wide) after both commits.

## Threat Flags

None. Plan's threat register (T-97-03-01, T-97-03-02, T-97-03-SC) mitigated as designed:

- **T-97-03-01** (harness ComposeBox chrome tampering): all new class tokens gated on `mode === "relay"` or `mode !== "relay"`. Regression floor Test 8 asserts harness path unchanged (pl-11 present, no spacer). `ComposeBox.mode-hide.test.tsx` Test 1, 1b, 5 also assert Row 1 + Paperclip present in default/harness modes.
- **T-97-03-02** (harness placeholder tampering): case-branch's false-branch is `pvIdentity?.displayName` — byte-identical to pre-plan. Regression floor Test 5d asserts harness placeholder must NOT be `Message room…` and must retain `Message ` + `…` template shape.
- **T-97-03-SC** (package installs): no packages installed. RESEARCH § Package Legitimacy Audit confirmed zero.

No new trust boundaries. Two Tailwind class token changes + one string-literal case-branch. No new endpoints, no user input parsing, no crypto surface. Severity: LOW / none-new (as planned).

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.tsx` — modified. Both changes present: `showPaperclip && mode !== "relay" && "pl-11"` at L2865; `data-testid="compose-row-1-relay-spacer"` block at L2683-2695. `[ -f src/ui/features/pretty-view/ComposeBox.tsx ] && grep -q ...` both succeed.
- `src/ui/features/pretty-view/PrettyView.tsx` — modified. Case-branch present at L4288.
- `src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx` — modified (Tests 6, 7, 8 added).
- `src/ui/features/pretty-view/PrettyView.relay-source.test.tsx` — modified (Tests 5c, 5d added).
- Commit `a04e862d` — present in `git log --oneline` (Task 1).
- Commit `bfc34e78` — present in `git log --oneline` (Task 2).
- Working tree clean at `git status --short` (zero output).
- `tsc --noEmit` exit-0 project-wide.
- 130/132 tests green across 6 scoped files (1 skipped + 1 todo carried unchanged from Plan 97-02 baseline).
