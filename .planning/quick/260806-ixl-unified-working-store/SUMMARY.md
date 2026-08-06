---
quick_id: 260806-ixl
slug: unified-working-store
date: 2026-08-06
status: complete
branch: feat/tab-title-from-tmux
base_commit: aa38697
final_commit: 06fac7c
---

# Quick 260806-ixl — Unified session-working store

## Outcome

Sidebar conversation-list dot and PrettyView's WipBubble now derive their working-state from ONE store hook (`useSessionIsWorking`). A single-line rule change in the hook now moves both surfaces in lockstep; the pre-existing contradiction (idle PTY + non-empty backgroundedShells → sidebar dot on AND WipBubble mounted) can no longer occur.

## Commits (atop `aa38697`)

| SHA       | Message                                                                                                            |
|-----------|--------------------------------------------------------------------------------------------------------------------|
| `a85606d` | refactor(session-working-store): composite `{ ttyBusy, hasBgWork }` shape + `useSessionIsWorking`                  |
| `3661cca` | refactor(terminal): rename `publishSessionWorking` → `publishSessionTtyBusy`                                       |
| `be63a68` | feat(pretty-view): publish `hasBgWork` + route WipBubble mount through `useSessionIsWorking`                       |
| `06fac7c` | refactor(pretty-conversations): swap `useSessionWorking` → `useSessionIsWorking` + update mocks                    |

## Files touched (per commit)

- **`a85606d`** — `src/ui/state/session-working-store.ts` + `.test.ts` (rewrite for composite record + 11 tests A–K)
- **`3661cca`** — `src/ui/features/terminal/Terminal.tsx` (single symbol rename)
- **`be63a68`** — `src/ui/features/pretty-view/PrettyView.tsx` (imports, key derivation, 2 WS-case publishes, 2 reset-path publishes, WipBubble mount rewire, `wipActive` dead-const removal)
- **`06fac7c`** — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` + 4 test-mock files (`PrettyConversationsPanel.test.tsx`, `.chain.test.tsx`, `.new-role-button.test.tsx`, `.clone-dialog.test.tsx`)

## Verification (HEAD `06fac7c`)

```
npx tsc --noEmit            → EXIT 0 (clean)
npm run build:backend       → EXIT 0 (clean)
npx vitest run              → EXIT 0 · 1491 passed / 6 skipped / 0 failed across 122 files
                              (+7 net-new tests vs baseline 1484/6/0)
git status --short          → clean (only untracked `.planning/quick/…` for this task)
```

## Design highlights

- **Store schema**: `Map<key, { ttyBusy: boolean|null; hasBgWork: boolean }>` — two independent input signals, one composite output.
- **Composite rule** (single source of truth): `state.ttyBusy === true || state.hasBgWork`. Null `ttyBusy` counts as not-working (preserves today's suppress-dot-until-first-emit semantics).
- **Per-field no-op notify guard**: publishing an unchanged `ttyBusy` does NOT re-notify even after an intervening `hasBgWork` publish (and vice versa). Prevents redundant re-renders across the sidebar row set.
- **PrettyView publish sites**: both `case "backgrounded_agents"` and `case "backgrounded_shells"` WS branches, plus both reset paths (fresh-pane mount + session_changed reset).
- **Sibling-array read inside WS closure** used the **functional-setter-as-reader trick** (`setBackgroundedShells(cur => { publish(...); return cur; })`) to read the other array's latest value without adding refs — chosen over explicit refs to match the surrounding code idiom.
- **`wipActive` const removed** (dead code — only reference was the old WipBubble mount).
- **Row prop shape preserved**: `PrettyConversationRow`'s `isWorking?: boolean|null` prop stays as-is (its strict-equals gates accept a plain boolean fine); narrowing happens naturally at the Panel boundary.

## Deviations from PLAN

- **Task 1 committed as a single atomic commit (store + tests together).** Consumers would break at the type level anyway pending Tasks 2–4; splitting store code from store tests would produce a red intermediate commit either way. Commit body documents intentional temporary app-wide typecheck red across Tasks 1–3, recovered at Task 4.
- **PrettyView WS-mock tests (Wip A–D) dropped per plan's escape hatch.** The existing 37 PrettyView test files use a complex WS stub infrastructure that would have required substantial rework to add backgrounded_agents/shells emission without breaking siblings. Task 1's store tests A–F already prove the composite OR logic at the store level.
- **Intermittent `EnvironmentTeardownError` in `IdentityModal.test.tsx`**: pre-existing Vitest teardown race (confirmed reproducible on baseline `aa38697`), unrelated to this change. When it fires, exit code is 1 but all 122 test files still pass with 0 failures. Final HEAD run exited 0 cleanly.

## Follow-ups

None required. `session-queue-pending-store.ts:93` JSDoc references `publishSessionWorking` as historical context — comment-only, not a code reference. Optional cosmetic update; not done.

## Ship status

**NOT pushed. NOT built. NOT deployed.** Per fleet rule "code work doesn't authorize ship." Ashley's ship queue is held pending more changes; this becomes commit 6 (through 9) in the batch atop origin `67c49dd`, waiting on explicit "ship it."
