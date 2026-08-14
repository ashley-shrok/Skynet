---
task: 260814-mhd-phase40-affordance-flicker-fix
status: complete
started: 2026-08-14T16:11:14Z
completed: 2026-08-14T16:15:00Z
base: 224b2d57
head: 38a876ea
branch: feat/tab-title-from-tmux
executor: gsd-executor
orchestrator: tiffany
---

# Summary — Phase 40 pencil affordance flicker + text jitter fix

## Problem

Ashley UAT report (verbatim): "all of the texts of the link of the file that you sent and all below it, like all the message bubbles and all the text in them, just jitters until I scroll, and it doesn't happen all the time. But the thing that seems to coincide with it is the pencil button kind of spazzing out and flipping between the pencil icon and the word edit."

Three independent bugs compounding:
- **A**: extra `<span>Edit</span>` text label rendered next to the pencil icon on desktop — spec violation (UI-SPEC L124, SHAPE-03 idiom, and the component's own docstring all specify BARE pencil).
- **B**: hydration flash — `useIsTouchDevice()` returns `false` on first render (state initialized to `undefined`), then flips to real value after useEffect runs. Every mount shows a one-frame "desktop" flash.
- **C**: remount storm — the ReactMarkdown `components` prop was defined inline in ChatMessage (new identity every render) AND the eligibility hook called `setEligibleUrls(new Set(...))` with a fresh Set every effect run (new identity even with same contents). Together these caused the affordance to remount repeatedly, which is what made bug B's one-frame flash happen over and over.

## Commits

| # | Hash | Subject |
|---|------|---------|
| 1 | `a52a4baf` | fix(40-followup): drop stray "Edit" text label from pencil affordance — spec violation |
| 2 | `9ea4ac22` | fix(hooks): read matchMedia synchronously in useIsTouchDevice — eliminates first-render flash |
| 3 | `38a876ea` | fix(40-followup): memoize ReactMarkdown components + dedupe eligibility Set updates — stops affordance remount storm |

## Files touched (5)

- `src/ui/features/pretty-view/EditableFileAffordance.tsx` — removed `<span>Edit</span>` (line 87 pre-fix). aria-label/title still read "Edit {filename}" (accessibility preserved).
- `src/ui/features/pretty-view/EditableFileAffordance.test.tsx` — flipped test 5 assertion from `.toContain("Edit")` to `.not.toContain("Edit")`.
- `src/ui/hooks/use-is-touch-device.ts` — lazy useState initializer reads `window.matchMedia(TOUCH_QUERY).matches` synchronously (SSR-guarded); return type tightened to `boolean`; useEffect retained for viewport change listener.
- `src/ui/features/pretty-view/ChatMessage.tsx` — extracted ReactMarkdown `components` object into `useMemo<Components>(..., [eventId, onOpenEditor, eligibleUrls])`. Added `type Components` import from `react-markdown` to preserve param inference under strict mode.
- `src/ui/features/pretty-view/use-editable-file-eligibility.ts` — `setEligibleUrls(eligible)` → functional-updater form with `prev`-return early-exit when contents match.

## Tests

Full `npx vitest run` after each commit: **188 files / 2361 passed / 6 skipped / 1 todo / 0 failed**. Exit 0. Fleet rule "never leave the suite red" honored across all three commits.

## Deviations from plan

1. **Task 2 grep gate** required `matchMedia(TOUCH_QUERY).matches` to appear twice; the prescribed code snippet only has that literal once (the useEffect uses the bound alias `mql.matches`). Executor followed the code snippet verbatim (source of truth); the other two Task 2 grep gates passed.
2. **Task 3 useMemo** — the plan's snippet omitted a type annotation. Standalone-useMemo loses the `Components` contextual typing that the inline `<ReactMarkdown components={...}>` prop provided, which would produce implicit-any errors on the destructured params under strict mode. Executor imported `type Components` from `react-markdown` and annotated as `useMemo<Components>(...)`. Preserves exact original param destructures. No behavior change, no new dependency.

## What was NOT done

Per fleet directive (Ashley 2026-08-08: "sub-agents should not do deploys"), executor scope stopped at "code done, tests green, commits landed":

- No `git push` (still local to tiffany tree).
- No `npm run build:backend` / `npm run build` / `docker build`.
- No `docker compose up --force-recreate`.
- No entry appended to `~/.claude/roles/box-maintainer/skynet-patches.md`.
- No coord-room announce.

Deploy motion is orchestrator (tiffany) scope — picked up after this SUMMARY lands.

## Coord-room context at hand-off

Tina shipped patch #447 (pretty-conversations idle-dot-on-ambient-rows) at HEAD `0707bbd8` during executor run. Origin has moved. `git pull --rebase origin feat/tab-title-from-tmux` required before push.
