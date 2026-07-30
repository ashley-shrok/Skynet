---
phase: 260730-lur-stt-transcribing-spinner
plan: 01
subsystem: frontend/compose-box/voice
tags: [ui, compose-box, voice, stt, spinner, lucide, patch-130-guard, phase-16-followup]
requires: [phase-16-plan-03-voice-flow, patch-130-paper-plane-svg]
provides: [in-button-spinner-during-stt-round-trip]
affects:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
tech-stack:
  added: []
  patterns: [lucide-react-Loader2, animate-spin-tailwind, ternary-icon-branch, byte-preserved-inline-svg]
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
decisions:
  - "Loader2 spinner size matches paper-plane 24×24 slot (className='size-6') — no layout shift when the icon swaps."
  - "Extended the existing #130 comment block (rather than replacing) so patch #130's byte-preservation warning stays in-line with the ternary that gates it."
  - "Never-resolving fetch stub in Test 11 (vi.fn(() => new Promise(() => {}))) is the cleanest way to freeze voice.state === 'transcribing' — no timers, no fake-timer plumbing, and afterEach's vi.unstubAllGlobals() cleans up automatically."
metrics:
  duration: 3m
  completed: 2026-07-30
requirements: [260730-lur-01]
---

# Quick 260730-lur Plan 01: STT Transcribing Spinner — Summary

## One-liner

Swap ComposeBox send-button icon from static paper-plane to spinning `Loader2` while `voice.state === "transcribing"` so Ashley gets in-button feedback that her Send-transcript tap registered during the 1-3s `/voice/transcribe` round-trip.

## What Changed

### `src/ui/features/pretty-view/ComposeBox.tsx`

- **Line 2** (import): Added `Loader2` to the existing `lucide-react` named import in alphabetical position between `ListPlus` and `Paperclip`. Single import line (not split).
- **Lines 1807-1823** (button icon branch): Replaced the raw `<svg>…</svg>` block inside the `else` of `asideActive ? … : (…)` with a ternary picking `<Loader2 className="size-6 animate-spin" aria-hidden="true" />` when `showTranscribingSend === true` and falling back to the verbatim paper-plane SVG (path `M14.536 21.686…`) otherwise. Comment block extended with a `Quick 260730-lur` reference explaining the spinner gate.
- **Preserved (no changes):** the `asideActive` X-icon branch, the `<button>` `className`, `disabled` predicate, `onClick`, `aria-label`, `title`, and the `right-1 bottom-0.5 / p-2` positioning. Paper-plane SVG path is byte-identical (grep verified: `grep -c "M14.536 21.686"` = 1).

### `src/ui/features/pretty-view/ComposeBox.voice.test.tsx`

- **Lines 358-403** — Test 11: While STT fetch is in flight (`voice.state === "transcribing"`), the Send button contains a spinning `Loader2` (`svg.animate-spin`), does NOT contain the paper-plane path (`path[d^="M14.536 21.686"]`), is `disabled`, and keeps `aria-label="Send"`. Freezes transcribing state via `vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))` (afterEach's `vi.unstubAllGlobals()` cleans up).
- **Lines 405-418** — Test 12: Idle regression guard proving the paper-plane inline SVG is byte-preserved (`path[d^="M14.536 21.686"]` non-null) and no `animate-spin` leaks outside the transcribing branch.
- **Preserved (no changes):** Tests 1-10, header comment (lines 1-23), beforeEach/afterEach infrastructure, helpers.

## Commit

- **Branch:** `feat/tab-title-from-tmux`
- **SHA:** `686f455`
- **Message:** `feat(260730-lur-01): render Loader2 spinner in send button during voice.state === "transcribing"`

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Type check clean | `npx tsc --noEmit` | exit 0 (no output) |
| Voice test suite green | `npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx` | **12 passed / 0 failed** (was 10 before this plan) |
| Sibling ComposeBox suites — no regressions | `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` | **4 files / 51 passed / 0 failed** |
| Loader2 grep gate | `grep -c "Loader2" src/ui/features/pretty-view/ComposeBox.tsx` | 3 (import + JSX + comment reference) — ≥ 2 as required |
| Paper-plane grep gate | `grep -c "M14.536 21.686" src/ui/features/pretty-view/ComposeBox.tsx` | 1 (preserved byte-for-byte, not duplicated) |
| Diff footprint | `git diff --name-only HEAD~1 HEAD` | `src/ui/features/pretty-view/ComposeBox.tsx`, `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` — exactly two files |

## Scope Guardrails — All Honored

- **NO files touched under `src/backend/`** — frontend-only patch as required.
- **NO files touched under `~/.claude/identities/tina/`** — no `skynet-patches.md`, no bounty status/archive edits, no `tina.md`. Identity-side bookkeeping is orchestrator's job.
- **NO push, NO `docker build`, NO `docker compose up`, NO `docker cp`, NO skynet-ec2 or container access.** Stopped cleanly at the `git commit` boundary per the plan's terminal-step rule.
- **Paper-plane SVG NOT reformatted** — inline path attribute, whitespace, and attribute order all byte-identical to the pre-patch markup (`grep "M14.536 21.686"` returns exactly 1 hit).

## Deviations from Plan

None — plan executed exactly as written. Both edits landed in a single atomic commit as specified. Only micro-deviation from the `<output>` section: SUMMARY.md path per the top-level constraints (`260730-lur-SUMMARY.md`) rather than the plan's `<output>` block (`260730-lur-01-SUMMARY.md`), because constraints override plan output-field wording per the executor prompt.

## Self-Check: PASSED

- **Files exist:**
  - `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND (modified)
  - `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` — FOUND (modified)
- **Commit exists:** `686f455` — FOUND in `git log`.
- **Grep gates pass:** Loader2 count = 3 (≥ 2), paper-plane path count = 1 (exact).
- **All 12 voice tests pass; 51 sibling ComposeBox tests still green; tsc clean.**
