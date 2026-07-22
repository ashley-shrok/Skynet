---
title: "Patch #119 — drafts belt-and-suspenders localStorage mirror"
task_id: 260722-ddg
slug: patch-119-drafts-belt-and-suspenders-loc
status: complete
created: 2026-07-22
completed: 2026-07-22
code_commit: 58d3c83
files_touched:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/terminal/MessageQueueDrawer.tsx
out_of_repo_files_touched:
  - ~/.claude/identities/tina/termix-patches.md
deploy_status: not deployed — local commit only, batch after bounties #3-5
---

# Patch #119 — Drafts Belt-and-Suspenders localStorage Mirror

## What shipped

- `src/ui/features/pretty-view/ComposeBox.tsx`:
  - Module-scope `composeDraftLsKey(hostId, tmuxSessionKey)` helper.
  - localStorage mirror on every keystroke (inside `scheduleAutosave`),
    on every successful `putComposeDraft` (inside `flushDirty` after the
    await), and on hydrate server-wins (inside the `getComposeDraft.then`
    block).
  - Hydrate-restore: `seed === "" && lsBody.length > 0` → use `lsBody`
    as `hydratedBody`, call `scheduleAutosave(hydratedBody)` so the
    server catches up on the next 400ms tick.
  - `removeItem` on submit-clear inside `clearAfterSend`.
  - Two diagnostic `console.warn` lines (`[compose-draft] load` +
    `[compose-draft] save`).

- `src/ui/features/terminal/MessageQueueDrawer.tsx`:
  - Module-scope `messageQueueDraftLsKey(itemId)` helper (keyed by
    server-generated UUID).
  - Extracted the previous inline 400ms debounce+PATCH block from
    `handleBodyChange` into `scheduleItemAutosave(id, body)` useCallback
    so the hydrate loop can reuse it.
  - localStorage mirror on every keystroke (inside `handleBodyChange`),
    on every successful `updateMessageQueueItem` (inside
    `scheduleItemAutosave` `.then`), and per-item on hydrate server-wins
    (inside the `listMessageQueueItems.then` map).
  - Hydrate-restore per item: server-empty + ls-non-empty → return
    `{...item, body: lsBody}`, mark dirty via `dirtyBodiesRef`, then loop
    after `setItems` to call `scheduleItemAutosave` for each restored id.
  - `removeItem` on all three delete paths (`handleDelete`,
    `handleRetryCleanup`, auto-cleanup-on-unmount empty-body branch).
  - Two diagnostic `console.warn` lines (`[message-queue-draft] load` +
    `[message-queue-draft] save`).

- `~/.claude/identities/tina/termix-patches.md` (outside repo):
  - Header patch count `ONE HUNDRED EIGHTEEN` → `ONE HUNDRED NINETEEN`.
  - Full per-patch entry for #119 (motivation, fix summary, key shape,
    hydrate policy, extraction sub-step, files touched, diagnostic
    strategy, rebase risk, deploy status, root-cause hunt notes).
  - Drift-caveat notes appended to both `ComposeBox.tsx` and
    `MessageQueueDrawer.tsx` file bullets.

## Verification

- `npx tsc --noEmit`: clean (exit 0, zero output).
- `git diff --stat` on `HEAD~1..HEAD`: exactly 2 files, +233/-16
  (ComposeBox.tsx +102 / MessageQueueDrawer.tsx +147).
- localStorage call audit:
  - ComposeBox.tsx: 5 calls (setItem×3, getItem×1, removeItem×1) — plan
    expected 5-6.
  - MessageQueueDrawer.tsx: 7 calls (setItem×3, getItem×1, removeItem×3)
    — plan expected 6-8.
- `console.warn` audit: exactly 4 across both files (2 per file: one
  `load`, one `save`) — matches plan spec.
- `latestBodyRef.current =` count in ComposeBox: 4 both pre- and
  post-edit (no add/remove of latestBodyRef writes; only ls mirrors added
  beside them). Plan's stated "3 assignment sites" was off by one; plan
  INTENT ("no writes added or removed") satisfied.
- No tests modified. localStorage additions are all `try/catch` wrapped
  and jsdom-compatible.

## Diagnostic strategy

Four `console.warn` sites (2 per surface) log `serverLen` vs `lsLen` on
every save and every load. Format is stable so the next post-restart
repro can be diffed against a baseline and reveal whether the
empty-body server response is "server-side data absent" or "load-key
mismatch returning the wrong row". LOAD-BEARING for the follow-up
root-cause bounty — do not strip.

## Deviations from plan

- Plan step 1b said "immediately after `latestBodyRef.current = text;`
  at line ~262 add localStorage.setItem". Line 262 is
  `latestBodyRef.current = text;` at module scope
  (mirror-on-every-render), not the keystroke handler. Placing the
  localStorage mirror there would double-fire during hydrate. Applied
  the intent of the plan by adding the localStorage mirror inside
  `scheduleAutosave` (which runs on every keystroke via
  `handleTextChange`) — same "per-keystroke" outcome, cleaner
  separation. Documented in the code comment.
- Plan step 5 expected `latestBodyRef.current =` count of 3; actual
  count both pre- and post-edit is 4. Zero net change — plan's stated
  number was off by one; plan's intent satisfied.
- `hostId` typed as `number` in `ComposeBoxProps`, not `string` as the
  plan's helper signature suggested. Changed helper to `hostId: number`;
  template literal handles the coercion.
- `handleSend` in MessageQueueDrawer does NOT get a `removeItem` call —
  the plan only called out clearing on `deleteMessageQueueItem`, not on
  the patch #60 WS-atomic delete path. Any stale ls key orphans
  harmlessly (server won't return a matching item after WS-atomic delete
  so the hydrate resurrection branch never fires for that id).
- Added `scheduleAutosave` to the ComposeBox mount effect's dependency
  array and `scheduleItemAutosave` to the MessageQueueDrawer mount
  effect's dependency array — both are stable useCallback refs across
  renders (deps: `[hostId, tmuxSessionKey]` transitively), so this is
  safe and satisfies react-hooks/exhaustive-deps.

## Deploy status

NOT DEPLOYED. Local commit only, per Ashley 2026-07-22 — batch deploy
deferred until after bounties #3-5. This is a client-side mitigation
only; the root cause of post-restart draft loss remains undiagnosed and
is filed as a follow-up bounty. The four `console.warn` diagnostics
ship expressly to feed that hunt.

## Commits

- Code: `58d3c83` — `feat(compose): patch #119 — localStorage mirror
  for compose + message-queue drafts (belt-and-suspenders)`
- Docs: filled in after the STATE.md + SUMMARY.md commit lands.
