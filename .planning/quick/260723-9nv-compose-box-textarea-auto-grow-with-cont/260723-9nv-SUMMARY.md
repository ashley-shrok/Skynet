---
phase: quick-260723-9nv
plan: 01
subsystem: pretty-view/compose
tags: [compose-box, textarea, auto-grow, ux, patch-135]
requirements: [PATCH-135]
files-modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
commit-sha: 53b1c7b6538056eae7febf7286bdf45e6c1f2c91
branch: feat/tab-title-from-tmux
completed: 2026-07-23
---

# Quick 260723-9nv — Patch #135: ComposeBox textarea auto-grows with contents

## One-liner

Replaced the newline-count `rows` heuristic in the pretty-view ComposeBox with a `useLayoutEffect` that drives `el.style.height` off `scrollHeight` (capped at 6 line-heights), so the textarea grows with wrapped visual lines — not just with `\n` characters.

## Files diffed (2)

- **`src/ui/features/pretty-view/ComposeBox.tsx`** — code change (35 insertions, 7 deletions net):
  - Imported `useLayoutEffect` from React (line 1).
  - Added `maxHeightPxRef = useRef<number | null>(null)` alongside `textareaRef` (line ~258) — cache of the 6-line-height cap computed once on mount.
  - Deleted the dead `const rows = Math.min(6, Math.max(1, text.split("\n").length));` derivation and its 2-line comment (previously ~lines 515-517).
  - Added a new `useLayoutEffect` on `[text]` (just above `handleTextChange`, ~line 622) that:
    1. Reads `textareaRef.current`.
    2. Lazy-computes `maxHeightPxRef.current` from `parseFloat(getComputedStyle(el).lineHeight) × 6` with 144px fallback for JSDOM/`normal`-keyword branch.
    3. Sets `el.style.height = 'auto'` (required — without it, `scrollHeight` only grows, never shrinks).
    4. Reads `el.scrollHeight`, clamps to `maxHeightPxRef.current`, sets `el.style.height = clamped + 'px'`.
    5. Sets `el.style.overflowY = clamped >= maxHeightPxRef.current ? 'auto' : 'hidden'` — scrollbar only appears at the cap.
  - Changed `<Textarea rows={rows}>` → `<Textarea rows={1}>` (SSR/initial-paint fallback).
  - Updated the surrounding comment about the `rows={rows}` mechanism to reference the new `useLayoutEffect (patch #135)`.
  - Untouched: `min-h-8!`, `resize-none`, `bg-[rgba(10,12,20,0.5)]!`, `border`, `focus-ring`, `pr-10`, all aux buttons, meter well, queueArmed overlay, inside-textarea Send button, handlers.

- **`src/ui/features/pretty-view/ComposeBox.test.tsx`** — test change (37 insertions):
  - Added a new `describe("ComposeBox — patch #135 auto-grow", ...)` block at end of file, with `beforeEach` that clears mocks and `localStorage` (patch #129 test hygiene).
  - Test A: `"auto-grow: on mount with empty text, textarea height is at or below the min-h-8 floor"` — mounts ComposeBox, asserts `parseFloat(textarea.style.height || '0') <= 32`. In JSDOM `scrollHeight=0` so height becomes `'0px'`, which satisfies ≤32.
  - Test B: `"auto-grow: on text change, style.height is driven off scrollHeight (JSDOM scrollHeight mock)"` — mounts ComposeBox, mocks `HTMLTextAreaElement.scrollHeight = 100` via `Object.defineProperty` on the element, fires a `change` event, asserts `style.height === '100px'` and `overflowY === 'hidden'` (100 < 144 fallback MAX_PX).

## Commit SHA (patch #135)

**`53b1c7b6538056eae7febf7286bdf45e6c1f2c91`** — `fix(compose-box): patch #135 — textarea auto-grows with contents, not just newlines`

At HEAD of `feat/tab-title-from-tmux`. No `Co-Authored-By` trailer (fork convention verified against `git log -5`). Not pushed.

## Vitest before/after (ComposeBox.test.tsx)

| Run     | Passed | Failed | Notes                                                                                                                     |
| ------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Before  | 16     | 2      | Baseline. Two pre-existing patch #124 ThumbsUp aria-label residuals: `getByLabelText(/send 'yes'/i)` — current label is `Send 'let's go'`. Same 2 failures at `:393` and `:452`. Documented in STATE.md 2026-07-23. |
| After   | 18     | 2      | Baseline + 2 new tests, both green. Exact same 2 failures at `:393` and `:452` — no new regressions. Failure sites and messages byte-identical to baseline. |

Delta: +2 passing tests (the new auto-grow tests), 0 new failures, 0 fixed pre-existing failures (this patch was not tasked with the #124 residuals).

## Typecheck

`npx tsc --noEmit` — exit 0, zero errors involving `ComposeBox.tsx` (baseline unchanged).

## Explicit confirmation of what was NOT done

- **`npm run build` was NOT run.** No build step was invoked in this quick task.
- **No deploy was performed.** `docker compose up` / container recreate / any tina-side deploy machinery was NOT touched.
- **`~/.claude/identities/tina/skynet-patches.md` was NOT touched.** That file is tina's at deploy time.
- **No branch was created or switched.** All work landed as a single commit on `feat/tab-title-from-tmux` (the current branch).
- **No changes outside the 2 planned files** (`ComposeBox.tsx` + `ComposeBox.test.tsx`). Verified via `git diff --cached --stat` before commit.

## Deviations from plan

None. Executed exactly as written. All Task 1 done-criteria greps returned expected counts:
- `useLayoutEffect` appears 4× (import + 2 usages + 1 comment reference).
- Dead `text.split("\n").length` derivation: 0 hits (removed cleanly).
- `el.style.height = 'auto'`: 1 hit (the new effect).
- `maxHeightPxRef`: 5 hits (declaration + 4 read/writes across the effect).
- `rows={rows}`: 0 hits (replaced).
- `rows={1}`: 2 hits (the JSX prop + one comment reference to the `rows={1}` prop in the shadcn base-className explanation).

## Success criteria (from plan)

- [x] Long single-line messages will visibly grow the textarea in the real browser (JSDOM can't confirm layout; Test B proves the mechanism reads scrollHeight on text change).
- [x] Deleting text shrinks the textarea back (guaranteed by `el.style.height = 'auto'` reset before each `scrollHeight` read).
- [x] 6-row cap enforced via `Math.min(el.scrollHeight, maxHeightPxRef.current)`.
- [x] Empty textarea renders at the min-h-8 floor (Test A confirms `height <= 32`).
- [x] Shift-Enter still inserts a newline; plain Enter still submits (patch #118 handler untouched).
- [x] Inside-textarea Send button at right-1 bottom-0.5 lines up correctly — position is anchored to the wrapper, not the textarea, so no adjustment needed (as noted in plan).
- [x] One commit — patch #135 — on `feat/tab-title-from-tmux`, ready for tina's next deploy batch.

## Self-Check: PASSED

- Files exist: `src/ui/features/pretty-view/ComposeBox.tsx` FOUND, `src/ui/features/pretty-view/ComposeBox.test.tsx` FOUND.
- Commit exists: `53b1c7b` FOUND at HEAD via `git log --oneline -1`.
- Working tree clean (except intentional `.planning/quick/260723-9nv-.../` untracked, per fork convention — quick planning docs stay untracked until Ashley or tina decides to snapshot them).
