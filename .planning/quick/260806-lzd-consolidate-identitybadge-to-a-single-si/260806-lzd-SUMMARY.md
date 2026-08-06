---
phase: 260806-lzd
plan: 01
subsystem: pretty-view / terminal (IdentityBadge affordance)
tags: [identity-badge, long-press, pretty-view, terminal, refactor, ui]
requires:
  - src/ui/features/terminal/IdentityBadge.tsx
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
provides:
  - "IdentityBadge single-variant contract (no `size` prop)"
  - "IdentityBadge onLongPress primitive (500ms pointerdown timer + cancel + click-suppression)"
  - "Terminal-mode IdentityModal parity (tap-to-open)"
  - "Long-press-to-toggle-pretty-view path on both surfaces"
affects:
  - AppShell.tsx (Ctrl+Shift+O — UNTOUCHED; still valid)
  - PrettyView.test.tsx / PrettyView.aside.test.tsx (mock IdentityBadge as () => null — no changes needed)
tech-stack:
  added: []
  patterns:
    - "useRef-backed timer + fired-flag for gesture disambiguation"
    - "single-variant component (drop the `size` prop entirely)"
key-files:
  created:
    - src/ui/features/terminal/IdentityBadge.test.tsx
  modified:
    - src/ui/features/terminal/IdentityBadge.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "Long-press timer = 500ms setTimeout (per Ashley's plan brief). Any pointermove while armed cancels — deliberate press only, no hover-slide."
  - "IdentityModal in terminal mode portals to document.body (container={null}). The xterm surface has no equivalent of PrettyView's chatRegionEl; app-modal z-[500] already sits above the terminal surface, so root-body portal is behaviorally correct."
  - "PrettyView.onTogglePrettyMode is OPTIONAL. When omitted (tests, standalone previews), the pretty-view badge simply doesn't wire long-press — IdentityBadge falls back to plain-click-target semantics automatically."
  - "AppShell.tsx (Ctrl+Shift+O) UNTOUCHED. Long-press flips setIsPrettyMode(v => !v) directly; Ctrl+Shift+O flips it via the imperative handle. Both hit the same state atom, no divergence risk."
metrics:
  duration: ~2h (baseline vitest ~8min + editor + full-suite verify ~10min + tsc)
  completed: 2026-08-06
  tasks: 2
  files-changed: 4  # 1 new test file + 3 modified sources
  commits: 3        # RED test, GREEN impl, Task 2 wiring
  baseline-tests: 1491 pass / 6 skipped / 122 files (before this plan)
  final-tests: 1498 pass / 6 skipped / 123 files (after this plan)
  delta: +7 tests / +1 file (matches Task 1 count exactly)
---

# Phase 260806-lzd Plan 01: Consolidate IdentityBadge to a Single Size Summary

Consolidated `IdentityBadge` to one visual treatment (the former `lg` glass pill), dropped the `size` prop entirely, removed the patch #38 hover-opacity-fade behavior, added a `onLongPress` primitive with a 500ms pointerdown timer (cancel on move/up/cancel, click-suppression after a completed long-press), and wired both call sites — terminal-mode surface (Terminal.tsx line ~3111) and pretty-view surface (PrettyView.tsx line ~1244) — for tap-to-open-modal + long-press-to-toggle-pretty-view. Terminal.tsx now also mounts `<IdentityModal>` in terminal mode, giving the identity modal parity across both surfaces.

## What Shipped

**IdentityBadge.tsx (Task 1):** Deleted the entire `md` branch (patch #17/#38 terminal-pane treatment — 120px pill, 80px round avatar, hover-opacity-fade). Only the former `lg` treatment renders now: glass pill, 56px avatar left, name+title right, hue-driven rim/glow (`identity.colorHue ?? 35`), `pv-identity-breathe` 5s animation. Visual bytes (className / inline style / avatar block) carried over byte-identical from the surviving branch — no visual redesign inside the surviving treatment. Added `onLongPress?: () => void` to `IdentityBadgeProps`. When provided, pointer handlers arm a `setTimeout(onLongPress, 500)` on pointerdown; pointermove / pointerup / pointercancel clear the timer; a `longPressFiredRef` gate on the trailing onClick swallows the synthetic click after a completed long-press so long-press and tap are mutually exclusive. Timer id + fired-flag live in `useRef` (survives re-renders without triggering them). `useEffect` cleanup on unmount clears any armed timer (T-260806-lzd-01 mitigation). Added `data-testid="identity-badge-root"` to both the button and div branches for the unit-test suite.

**IdentityBadge.test.tsx (Task 1, new file):** Seven tests defending the primitive contract with `vi.useFakeTimers()`:

- **A** — onLongPress fires after 500ms of held pointerdown.
- **B** — pointermove before 500ms cancels the timer.
- **C** — pointerup before 500ms cancels the timer AND onClick fires (tap semantics).
- **D** — pointercancel clears the timer.
- **E** — a completed long-press suppresses the trailing onClick (no double-fire).
- **F** — hover-fade class (`hover:opacity-0`) is GONE from the rendered root (anti-regression gate for patch #38 removal).
- **G** — when `onClick` is omitted, root is a non-interactive `<div aria-hidden="true">` (backward-compat).

**Terminal.tsx (Task 2):** Added `isIdentityModalOpen` state alongside existing `isPrettyMode` state. Imported `IdentityModal` from `@/features/pretty-view/IdentityModal`. The IdentityBadge at line ~3111 now passes `onClick={() => setIsIdentityModalOpen(true)}` and `onLongPress={() => setIsPrettyMode(v => !v)}`. Mounted `<IdentityModal>` inside the same `!isPrettyMode && identityKey` render branch, guarded additionally by `hostConfig.id != null` and `identitiesByKey.get(identityKey)` non-null (Modal needs both). Portals to `document.body` via `container={null}` — the terminal surface has no equivalent of PrettyView's chatRegionEl and app-modal z-[500] already sits above the xterm surface. The `<PrettyView>` mount at line ~3000 now passes `onTogglePrettyMode={() => setIsPrettyMode(v => !v)}` so the pretty-view-surface badge can flip back to terminal mode via the same tap-and-hold gesture.

**PrettyView.tsx (Task 2):** Added `onTogglePrettyMode?: () => void` to `PrettyViewProps`; destructured in the component signature. The IdentityBadge at line ~1244 drops `size="lg"` (no longer exists) and forwards `onLongPress={onTogglePrettyMode}` — when the parent doesn't wire the prop (tests, standalone previews), IdentityBadge falls back to plain-click-target semantics automatically. AppShell.tsx (Ctrl+Shift+O) UNTOUCHED — it still routes through `handle.togglePrettyMode()` to the same state atom.

## Verification Evidence

**Type-check:** `npx tsc --noEmit` — EXIT 0.

**Full test suite:** `npx vitest run` — 123 test files pass (baseline: 122), 1498 tests pass (baseline: 1491), 6 skipped (unchanged). Delta = +1 file / +7 tests, exactly matching Task 1's new IdentityBadge.test.tsx count. **Zero regressions** in unrelated suites (Terminal.wiring.test.ts 19/19, PrettyView.test.tsx family all green with props-ignored IdentityBadge stub).

**Grep gates (all from PLAN.md `<verification>` block):**

- `grep 'size:' src/ui/features/terminal/IdentityBadge.tsx | grep -v '^#' | wc -l` = 0 ✓
- `grep 'hover:opacity-0' src/ui/features/terminal/IdentityBadge.tsx | wc -l` = 0 ✓
- `grep 'size="md"' src/ | wc -l` = 0 ✓
- `grep 'size="lg"' src/ | wc -l` = 0 ✓
- `grep 'onLongPress' src/ui/features/terminal/IdentityBadge.tsx | wc -l` = 12 ≥ 1 ✓
- `grep 'onLongPress' src/ui/features/terminal/Terminal.tsx | wc -l` = 1 ≥ 1 ✓
- `grep 'onLongPress' src/ui/features/pretty-view/PrettyView.tsx | wc -l` = 1 ≥ 1 ✓
- `grep 'onTogglePrettyMode' src/ui/features/pretty-view/PrettyView.tsx | wc -l` = 3 ≥ 2 (interface + destructure + prop pass-through in JSX) ✓

## Commits (all on `feat/tab-title-from-tmux`)

| # | Hash    | Type     | Summary                                                             |
| - | ------- | -------- | ------------------------------------------------------------------- |
| 1 | e95a9cd | test     | Add failing IdentityBadge unit tests (RED, 7/7 fail on old source)  |
| 2 | 91c5893 | feat     | Consolidate IdentityBadge + add onLongPress (GREEN, 7/7 pass)       |
| 3 | 52d7be5 | feat     | Wire tap+long-press at both call sites (Terminal.tsx + PrettyView.tsx) |

## Deviations from Plan

None substantive. Two small choices worth naming for the record:

- **Task 2 committed as a single commit, not split per file.** The plan permitted "1 or 2 commits for the two call-site files"; I chose one commit because Terminal.tsx and PrettyView.tsx form one atomic wiring change (adding `onTogglePrettyMode` on the PrettyView mount is meaningless without the corresponding destructure in PrettyView.tsx, and vice versa).
- **`IdentityModal` `container` prop for terminal-mode = `null` (document.body portal).** The plan's `<behavior>` block for Task 2 named this as an acceptable choice explicitly: *"If the container-portal semantic is non-trivial to replicate, pass `null` (portals to document.body) — the modal is app-modal at z-[500], overlay at z-[110], both above the terminal surface, so root-body portal is behaviorally correct."* Chosen.

## Auth Gates

None. This plan touched only frontend UI code with no external services.

## Known Stubs

None. All wiring is live; no placeholder or hardcoded-empty values were introduced.

## Threat Flags

None. This plan closes patch #38's hover-fade (accessibility improvement — Ashley wants the badge visible, not hidden by hover) and adds a pointer-gesture primitive with explicit unmount cleanup for the timer. No new network surface, no new auth path, no schema change. The threat model in PLAN.md's `<threat_model>` fully covers the changed surface; all `mitigate` dispositions are honored (T-260806-lzd-01 via useEffect cleanup, T-260806-lzd-03 via `longPressFiredRef` gate + Test E).

## Constraints Honored

- Committed on `feat/tab-title-from-tmux` (no new branch, no worktree).
- NOT pushed / NOT docker built / NOT docker cp'd / NOT deployed. Stops at "committed on branch, local tests green" per fleet constraint.
- ROADMAP.md untouched (quick task).
- STATE.md not touched by executor (quick tasks don't advance the phase counter).
- Relay bubble files untouched (RELAYBUB-06 locked constraint — grep confirms `<IdentityBadge` under `src/ui/features/pretty-view/` matches exactly `PrettyView.tsx:1244`).
- AppShell.tsx (Ctrl+Shift+O) untouched.

## Self-Check: PASSED

Files created:

- `.planning/quick/260806-lzd-consolidate-identitybadge-to-a-single-si/260806-lzd-SUMMARY.md` — this file
- `src/ui/features/terminal/IdentityBadge.test.tsx` — 7 passing tests (A-G)

Files modified:

- `src/ui/features/terminal/IdentityBadge.tsx` — single-variant refactor + onLongPress
- `src/ui/features/terminal/Terminal.tsx` — state + IdentityModal mount + badge props + PrettyView.onTogglePrettyMode
- `src/ui/features/pretty-view/PrettyView.tsx` — onTogglePrettyMode prop, drops `size="lg"`, forwards onLongPress

Commits verified in git log:

- e95a9cd (RED) ✓
- 91c5893 (GREEN) ✓
- 52d7be5 (wiring) ✓

TDD gate sequence: `test(...)` → `feat(...)` → `feat(...)` (RED → GREEN → wiring). Cycle honored.
