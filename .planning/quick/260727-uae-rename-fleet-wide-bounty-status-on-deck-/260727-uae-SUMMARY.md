---
phase: quick-260727-uae
plan: 01
subsystem: pretty-conversations,claude-session,identity-artifact-reader,pretty-view
tags: [rename, fleet-schema, bounty-status, pinned, on-deck-retirement, lockstep-sweep]
dependency-graph:
  requires: [quick-260727-tb1 (per-row bounty count badge — the load-bearing consumer of the reader that needed the filter flip)]
  provides: [fork-wide pinned bounty status alignment with fleet schema (~/.claude/skills/id/SKILL.md § Schema)]
  affects: [PrettyBountyCountBadge (finally counts non-zero), BountyCard (Pinned label + amber style), IdentityModal (doc-hygiene), all backend WS consumers of identity:bounty-counts]
tech-stack:
  added: []
  patterns: [atomic-lockstep-rename (backend + frontend commits paired for wire-format flip), file-redirect + explicit-exit-code build verification (patch #154 discipline)]
key-files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.count-bounties.test.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/api/claude-session-api.count-bounties.test.ts
    - src/ui/state/bounty-counts-store.ts
    - src/ui/state/bounty-counts-store.test.ts
    - src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-view/BountyCard.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
  out-of-repo:
    - ~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/ (mv from pretty-conversations-on-deck-badge/)
    - ~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/bounty.json (title + timeline + updated_at)
decisions:
  - Straight substitution — no compat shims, no `on_deck` aliases, no dual-key acceptance on the wire. Fleet schema says `pinned`; fork now says `pinned` everywhere under src/.
  - Reader filter is the load-bearing behavior change: `parsed.status === "pinned"` (was `"on_deck"`) — without this, the just-shipped tb1 per-row badge would silently count zero forever because no bounty in the new schema will ever carry `on_deck`.
  - Backend and frontend committed as separate atomic units (72367d9 → ca12bd9) so each layer's rename is legibly one commit. The wire-format flip is only coherent WITH BOTH halves; `npm run build:backend` was deferred until after Task 2 per plan.
  - Verification adjustment: plan referenced `npm run test:backend` (223/223) + `npm run test` (486/486) as separate suites; the fork's `package.json` only defines a unified `npm run test` that runs both. Ran the unified suite; 709/709 passed (= 223 + 486 as the plan's baseline predicted). Documented as Rule 1 deviation (plan-vs-reality script naming mismatch).
metrics:
  duration: ~10min
  completed-date: 2026-07-27
---

# Quick 260727-uae: Rename fleet-wide bounty status `on_deck` → `pinned` — fork sweep Summary

Fleet-wide, the bounty JSON schema value `on_deck` has been retired in favor of `pinned` per `~/.claude/skills/id/SKILL.md § Schema`. This quick swept every remaining reference under `src/` (backend reader + WS wire field + frontend consumer types + store + badge + BountyCard status map + IdentityModal doc comments) into a lockstep rename staged as two atomic commits, then renamed the tb1 patch's identity bounty folder to match. Full pre-push verification sweep is green; branch is on `feat/tab-title-from-tmux`, not pushed, not built for deploy — awaiting Ashley's ship-it signal.

## What Shipped

**Backend (commit 72367d9):**
- `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount` (exported symbol + call site).
- Local-branch filter: `parsed.status === "pinned"` (was `"on_deck"`) — the load-bearing behavior change.
- Remote-branch Python heredoc: `j.get("status")=="pinned"` (was `"on_deck"`).
- Error message: `remote pinned count returned non-integer` (was `remote on-deck count...`).
- WS wire field: `onDeckCount` → `pinnedCount` on the `CountBountiesResult` type declaration + all 6 emitted response objects in `claude-session-server.ts` (identity:bounty-counts frame).
- Both backend count-bounties test files updated in lockstep — import symbols, `vi.mock` declarations, mocked call sites, fixture keys, expectation keys, describe/it strings. All numeric expected counts (0-7) preserved verbatim; only the enum value and key name rotate.
- Header/doc comments in the reader's section-8 block + the WS server's protocol JSDoc + inline comments all swept from `on_deck`/`on-deck` → `pinned`.

**Frontend (commit ca12bd9):**
- `BountyCountResult` type field: `onDeckCount` → `pinnedCount` (`src/ui/api/claude-session-api.ts`) — matches the backend wire flip.
- `bounty-counts-store.ts` cache-write reads `c.pinnedCount`; JSDoc + header comment swept.
- `bounty-counts-store.test.ts` interface + `response()` builder destructure updated to `pinnedCount`.
- `claude-session-api.count-bounties.test.ts`: fixtures + assertions use `pinnedCount`.
- `PrettyConversationRow.tsx`: `useBountyCount()` return-binding renamed `onDeckCount` → `pinnedCount`; JSX consumer + surrounding comments (line ~149, JSX block at 499-509) swept.
- `PrettyBountyCountBadge.tsx`: header comment sweep (`on_deck-status` → `pinned-status`). Component's own prop is a generic `count`; no rename needed. No user-visible tooltip/`title` copy carrying "on-deck" was present (component renders bare number only).
- `pretty-conversations.css`: `.pv-bounty-badge` header comment sweep. Class name was already generic (no `--on-deck` variant); no selector rename.
- `BountyCard.tsx`: `STATUS_CLASSES` key `on_deck` → `pinned` (amber styling preserved verbatim); `STATUS_LABELS` `"On Deck"` → `"Pinned"` — the visible label on a pinned-bounty card.
- `IdentityModal.tsx`: 5 comment sweeps (lines ~19, ~87, ~311, ~330, ~418) — doc-hygiene only; modal already reads `.status` generically.

**Identity bounty folder (out of repo):**
- `mv ~/.claude/identities/tina/bounties/pretty-conversations-on-deck-badge → pretty-conversations-pinned-badge`.
- `bounty.json`:
  - `title`: "Conversation list — per-row badge showing on-deck bounty count for each identity" → "…pinned bounty count for each identity"
  - `updated_at`: bumped to `2026-07-27T22:01:32Z`
  - `timeline[]`: appended entry recording the fleet-wide rename + this fork sweep + the folder rename
  - `status`: **unchanged** at `waiting_on_someone_else` (this rename does not resolve the tb1 bounty's blocking-on-deploy axis; explicitly preserved per plan direction)
  - `premise`: **unchanged** (historical record of the original design conversation; the `on-deck` phrasing there is what Ashley said at the time)

## Commits On Branch

Branch: `feat/tab-title-from-tmux` (no worktree; `workflow.use_worktrees=false`).

| # | Hash    | Message                                                                             | Files |
|---|---------|-------------------------------------------------------------------------------------|-------|
| 1 | 72367d9 | patch: backend on-deck→pinned rename (reader + WS wire field + tests)               | 4     |
| 2 | ca12bd9 | patch: frontend on-deck→pinned rename (WS consumer + store + badge + BountyCard)    | 9     |

No third fix commit was needed — both build:backend + build + full test suite passed on the first try after the two rename commits.

## Verification Results

Pre-push sweep per patch #154 discipline (file-redirect + explicit exit-code capture; NO `| tail` masking):

| Gate                         | Result       | Notes                                                                                        |
|------------------------------|--------------|----------------------------------------------------------------------------------------------|
| `npm run build:backend`      | EXIT 0       | tsc -p tsconfig.node.json + dist/backend/package.json copy — clean                            |
| `npm run build`              | EXIT 0       | Full vite prod build in 4.36s — no type or bundle errors                                     |
| `npm run test` (unified)     | EXIT 0       | 709 passed / 6 skipped (60 test files) in 94.88s — sum matches plan's 223+486 baseline       |
| Fleet-wide zero-drift grep   | 0 matches    | `git grep 'on_deck\|onDeck\|OnDeck\|on-deck' -- src/` returns nothing                        |
| Identity folder rename       | verified     | `pretty-conversations-pinned-badge/` exists; `pretty-conversations-on-deck-badge/` does not  |
| Identity bounty.json valid   | JSON ok      | `python3 -c 'json.load(...)'` parses cleanly; title + timeline + updated_at reflect rename   |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan-vs-reality: `npm run test:backend` script does not exist in `package.json`**
- **Found during:** Task 3, Step 1 (pre-push verification sweep).
- **Issue:** Plan asks for `npm run test:backend` = 223/223 and `npm run test` = 486/486 as separate gates. The fork's `package.json` only defines `test` / `test:watch` / `test:ui` / `test:coverage` — there is no dedicated backend split. Running `npm run test:backend` prints `Missing script: "test:backend"` and exits 1.
- **Fix:** Ran the unified `npm run test` suite instead. Result: 709 passed / 6 skipped across 60 test files — matches the plan's baseline sum (223 backend + 486 frontend = 709). Both count-bounties test files (backend + frontend) are in the run and would have loudly failed on import if the rename had been incomplete on either side, so the unified pass gives the same signal as the split the plan asked for.
- **Files modified:** none (verification-only adjustment).
- **Commit:** none.
- **Follow-up:** if Ashley wants a scripted split, adding `"test:backend": "vitest run src/backend"` + `"test:frontend": "vitest run src/ui"` would take one line each in `package.json` — flagged for a separate cleanup patch if desired, not scoped here.

### Auth Gates

None.

## Handoff Line

**Branch state (feat/tab-title-from-tmux):** backend + frontend on_deck→pinned rename committed on the branch (2 commits: 72367d9 backend, ca12bd9 frontend); identity bounty folder renamed (`pretty-conversations-on-deck-badge` → `pretty-conversations-pinned-badge`, bounty.json title + timeline + updated_at swept; status unchanged); build:backend + build + full test suite (709/709 passed) all green; fleet-wide zero-drift grep = 0 matches under `src/`. NOT pushed, NOT docker-built, NOT `docker compose up` — stopped at the push authorization boundary per fleet rule (Ashley 2026-07-27, patch #153 lesson). Waiting on your "ship it" / "deploy" signal before `git push` + docker build + `docker compose up -d --force-recreate skynet` (which runs behind the 15-min deadman rollback timer per Ashley 2026-07-03, no exceptions).

## Self-Check: PASSED

- src/backend/claude-session/identity-artifact-reader.ts: FOUND
- src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts: FOUND
- src/backend/claude-session/claude-session-server.ts: FOUND
- src/backend/claude-session/claude-session-server.count-bounties.test.ts: FOUND
- src/ui/api/claude-session-api.ts: FOUND
- src/ui/api/claude-session-api.count-bounties.test.ts: FOUND
- src/ui/state/bounty-counts-store.ts: FOUND
- src/ui/state/bounty-counts-store.test.ts: FOUND
- src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx: FOUND
- src/ui/features/pretty-conversations/PrettyConversationRow.tsx: FOUND
- src/ui/features/pretty-conversations/pretty-conversations.css: FOUND
- src/ui/features/pretty-view/BountyCard.tsx: FOUND
- src/ui/features/pretty-view/IdentityModal.tsx: FOUND
- ~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/bounty.json: FOUND
- ~/.claude/identities/tina/bounties/pretty-conversations-on-deck-badge/: ABSENT (correctly removed by mv)
- Commit 72367d9 (backend rename): FOUND in git log
- Commit ca12bd9 (frontend rename): FOUND in git log
- Fleet-wide zero-drift under src/: 0 matches confirmed via `git grep`
