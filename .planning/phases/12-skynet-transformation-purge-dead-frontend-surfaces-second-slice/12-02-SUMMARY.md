---
phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice
plan: 02
subsystem: shell+sidebar+features
tags: [refactor, pre-flight, phase-12, PURGE-06, PURGE-07, tsc-clean-per-commit, retained-ui-preservation]
requires:
  - "12-01 (STRIP-LIST enumeration — sections identifying isFolder consumer, 4 dashboard-shared files, and network_graph render call site)"
provides:
  - "sidebar/NewSessionDialog.tsx imports zero @/sidebar/SidebarTree symbols (SidebarTree becomes deletion-safe in Plan 03)"
  - "shell/CommandPalette.tsx imports zero @/dashboard/ files (dashboard/ becomes deletion-safe in Plan 04)"
  - "shell/tabUtils.tsx imports zero @/dashboard/cards/ files (dashboard/cards/ becomes deletion-safe in Plan 04)"
  - "New src/ui/features/session-launcher/ retained-UI directory housing NewSessionDialog + sshHostToHost + RemoteHostChips + NewSessionHostChips (CommandPalette consumer path)"
affects:
  - "src/ui/sidebar/NewSessionDialog.tsx (isFolder inlined; SidebarTree import stripped)"
  - "src/ui/features/session-launcher/ (new dir; 4 files copied verbatim from dashboard/)"
  - "src/ui/shell/CommandPalette.tsx (4 imports redirected to session-launcher/)"
  - "src/ui/shell/tabUtils.tsx (NetworkGraphCard import stripped; network_graph case renders PrettyLandingCard)"
tech_stack:
  added: []
  patterns:
    - "Ship-of-Theseus pre-flight refactor: relocate shared modules to retained-UI namespaces so the dying subtree is import-orphan before its deletion plan lands"
    - "Phase 11 dashboard-swap pattern reused verbatim for network_graph case (comment prefix + PrettyLandingCard fallback)"
key_files:
  created:
    - "src/ui/features/session-launcher/NewSessionDialog.tsx (106 lines — copied verbatim from src/ui/dashboard/NewSessionDialog.tsx)"
    - "src/ui/features/session-launcher/sshHostToHost.ts (57 lines — copied verbatim from src/ui/dashboard/sshHostToHost.ts)"
    - "src/ui/features/session-launcher/RemoteHostChips.tsx (54 lines — copied verbatim from src/ui/dashboard/RemoteHostChips.tsx)"
    - "src/ui/features/session-launcher/NewSessionHostChips.tsx (62 lines — copied verbatim from src/ui/dashboard/NewSessionHostChips.tsx)"
    - ".planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-02-SUMMARY.md"
  modified:
    - "src/ui/sidebar/NewSessionDialog.tsx (isFolder inlined as local module-private function; @/sidebar/SidebarTree import stripped)"
    - "src/ui/shell/CommandPalette.tsx (4 imports redirected from @/dashboard/* to @/features/session-launcher/*)"
    - "src/ui/shell/tabUtils.tsx (NetworkGraphCard import stripped; network_graph render case swapped to PrettyLandingCard with Phase 11 comment-prefix pattern)"
  deleted: []
decisions:
  - "Interpreted the plan's `git mv` mention (Task 2 line 136 + threat T-12-02-04) against its 'OLD copies remain on disk as dead code (0 consumers)' invariant (Task 2 line 148) as: use copy semantics, not mv, because the OLD copies must survive so SessionsPanel.tsx (dies in Plan 03) and dashboard/SessionDashboard.tsx (dies in Plan 04) keep tsc-cleaning until their deletion plans land. Effectively `cp` + `git add` for the four new session-launcher files, leaving the four dashboard originals untouched. This preserves tsc-clean-per-commit across Wave 2→Wave 3 hand-off."
  - "Task 3 comment intentionally rewrote 'the retired NetworkGraphCard from src/ui/dashboard/cards/' to 'the retired graph card from src/ui/dashboard/cards/' to avoid any literal `NetworkGraphCard` identifier in the file even inside a comment. Rule 1 self-check safety net per PLAN.md Task 3 guidance."
metrics:
  duration_min: 4
  tasks_completed: 3
  files_created: 4
  files_modified: 3
  files_deleted: 0
  commits: 3
  completed_date: 2026-07-23
---

# Phase 12 Plan 02: Pre-Flight Refactors for Wave 3 Deletion Plans Summary

Three atomic pre-flight refactors that leave the retained UI byte-identical in behavior while making the Wave 3 deletion plans (03/04/05) able to run tsc-clean-per-commit: (1) inlined `isFolder` type-guard into `sidebar/NewSessionDialog.tsx` so `SidebarTree.tsx` is deletion-safe; (2) copied the 4 dashboard-shared files that `CommandPalette.tsx` consumes into new `src/ui/features/session-launcher/` and redirected the palette imports; (3) swapped `tabUtils.tsx`'s `network_graph` render case from `NetworkGraphCard` to `PrettyLandingCard` and stripped the dashboard/cards/ import.

## What Was Built (Refactor Edition)

Zero behavior change. Three coherent refactors, one commit each, tsc-clean and vitest-green (Phase 11 baseline 524/526) after every commit.

### Task 1 — Inline isFolder (commit 42e544b)

- **Read `src/ui/sidebar/SidebarTree.tsx` lines 54-56 verbatim:**
  ```ts
  export function isFolder(item: Host | HostFolder): item is HostFolder {
    return "children" in item;
  }
  ```
- **Stripped** `import { isFolder } from "@/sidebar/SidebarTree";` (was line 38).
- **Added** a module-private `function isFolder` (not exported) with the exact same signature and body, plus a leading comment `// Local type-guard inlined from src/ui/sidebar/SidebarTree.tsx (Phase 12 Plan 02 — enables SidebarTree deletion in Plan 03).`
- All other imports, JSX, effects, session-name validation logic untouched.

### Task 2 — Relocate 4 dashboard-shared files (commit 11ffa95)

- **Copied verbatim** (not moved) from `src/ui/dashboard/` to a new `src/ui/features/session-launcher/`:
  - `NewSessionDialog.tsx` (106 lines)
  - `sshHostToHost.ts` (57 lines)
  - `RemoteHostChips.tsx` (54 lines)
  - `NewSessionHostChips.tsx` (62 lines)
- **Verified** none of the 4 imports another of the 4 via `@/dashboard/` alias — they are self-contained. Only cross-imports are `lucide-react`, `@/components/*`, `@/types/*`, `@/main-axios`, which resolve identically from the new path.
- **Rewired** all 4 `CommandPalette.tsx` imports from `@/dashboard/{NewSessionDialog,sshHostToHost,RemoteHostChips,NewSessionHostChips}` to `@/features/session-launcher/{NewSessionDialog,sshHostToHost,RemoteHostChips,NewSessionHostChips}`.
- **Left the OLD dashboard-tree copies in place** — they still have 2 consumers (`sidebar/SessionsPanel.tsx` line 7 for `sshHostToHost`, `dashboard/SessionDashboard.tsx` lines 8/9/13/18 for all four) that die with their own files in Plans 03 and 04 respectively. After Plan 04 lands, `src/ui/dashboard/` is deleted wholesale and the old copies vanish with it.

### Task 3 — Swap network_graph render (commit 29b52ab)

- **Stripped** `import { NetworkGraphCard } from "@/dashboard/cards/NetworkGraphCard";` (was line 28).
- **Swapped** `case "network_graph": return <NetworkGraphCard embedded={false} />;` to `case "network_graph": return <PrettyLandingCard />;` with a leading multi-line comment matching the Phase 11 dashboard-case pattern.
- **Preserved** the `case "network_graph": return <Network className="size-3.5" />;` inside the `tabIcon` switch (lucide-react `Network`, no dashboard dep).
- **Preserved** the `network_graph` TabType in `src/types/ui-types.ts` for exhaustive-switch safety.

## Tasks Completed

| Task | Name                                                              | Commit  | Files                                                                                                                                           |
| ---- | ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Inline isFolder into sidebar/NewSessionDialog.tsx                 | 42e544b | src/ui/sidebar/NewSessionDialog.tsx                                                                                                             |
| 2    | Relocate 4 dashboard-shared files + update CommandPalette imports | 11ffa95 | src/ui/features/session-launcher/{NewSessionDialog.tsx, sshHostToHost.ts, RemoteHostChips.tsx, NewSessionHostChips.tsx}; src/ui/shell/CommandPalette.tsx |
| 3    | Swap tabUtils network_graph render to PrettyLandingCard           | 29b52ab | src/ui/shell/tabUtils.tsx                                                                                                                       |

## Verification Gates

All PLAN.md `<verify>` blocks passed for every task, plus final baseline vitest.

### Task 1 gates

| Gate                                                              | Result       |
| ----------------------------------------------------------------- | ------------ |
| `grep -c 'from "@/sidebar/SidebarTree"' src/ui/sidebar/NewSessionDialog.tsx` = 0 | PASS (0)     |
| `grep -cE '^\s*function isFolder\s*\(' src/ui/sidebar/NewSessionDialog.tsx` = 1 | PASS (1)     |
| `npx tsc --noEmit`                                                | exit 0       |
| `npx vitest run NewSessionDialog.test.tsx`                        | 9/9 pass     |
| `npx vitest run PrettyConversationsPanel.test.tsx`                | 14/14 pass   |

### Task 2 gates

| Gate                                                              | Result       |
| ----------------------------------------------------------------- | ------------ |
| `test -f src/ui/features/session-launcher/NewSessionDialog.tsx`   | PASS         |
| `test -f src/ui/features/session-launcher/sshHostToHost.ts`       | PASS         |
| `test -f src/ui/features/session-launcher/RemoteHostChips.tsx`    | PASS         |
| `test -f src/ui/features/session-launcher/NewSessionHostChips.tsx`| PASS         |
| `grep -c 'from "@/dashboard/' src/ui/shell/CommandPalette.tsx` = 0 | PASS (0)     |
| `grep -c 'from "@/features/session-launcher/' src/ui/shell/CommandPalette.tsx` = 4 | PASS (4)     |
| `npx tsc --noEmit`                                                | exit 0       |
| `npx vitest run PrettyConversationsPanel.test.tsx`                | 14/14 pass   |

### Task 3 gates

| Gate                                                              | Result       |
| ----------------------------------------------------------------- | ------------ |
| `grep -c 'from "@/dashboard/cards/NetworkGraphCard"' src/ui/shell/tabUtils.tsx` = 0 | PASS (0)     |
| `grep -cE 'case "network_graph"' src/ui/shell/tabUtils.tsx` (>=1) | PASS (2 — tabIcon + tabContent) |
| `grep -q 'PrettyLandingCard' src/ui/shell/tabUtils.tsx`           | PASS         |
| Non-comment `NetworkGraphCard` occurrences in tabUtils.tsx (grep -v '^\s*//' -v '^\s*\*') = 0 | PASS (0)     |
| `npx tsc --noEmit`                                                | exit 0       |
| `npx vitest run PrettyLandingCard.test.tsx`                       | 4/4 pass     |

### Final phase-wide vitest sanity check

| Gate                                                              | Result       |
| ----------------------------------------------------------------- | ------------ |
| `npx vitest run` (full suite)                                     | 524 passed, 2 failed (exact Phase 11 baseline drift — ComposeBox `send 'yes'` locator, pre-existing) |

## Deviations from Plan

### Interpretation call — copy vs. `git mv` (Task 2)

The PLAN.md action text contains two directives in tension:

- Line 130: "copy the 4 files verbatim from `src/ui/dashboard/`"
- Line 136: "Use `git mv` for a clean history if none of the four files transitively import each other via relative paths"
- Line 148: "the OLD copies remain on disk as dead code (0 consumers) — this is acceptable per Phase 10 Wave 4 precedent"
- Threat T-12-02-04: "Executor MUST use exact-path `git mv src/ui/dashboard/NewSessionDialog.tsx src/ui/features/session-launcher/NewSessionDialog.tsx`"

Executing `git mv` fully removes the dashboard originals. But that immediately breaks tsc-clean-per-commit because `src/ui/sidebar/SessionsPanel.tsx` line 7 still imports `@/dashboard/sshHostToHost` (and it dies in Plan 03, not this plan) and `src/ui/dashboard/SessionDashboard.tsx` lines 8/9/13/18 all still import the four originals (dies in Plan 04, not this plan). The plan explicitly instructs "Do NOT relocate `src/ui/sidebar/SessionsPanel.tsx`'s import" (line 150) and "Do NOT modify … SessionDashboard.tsx" (line 154) — which is inconsistent with `git mv`.

**Resolution chosen:** honor the tsc-clean-per-commit invariant + the explicit "OLD copies remain on disk" line (which is unambiguous) + the explicit "Do NOT relocate SessionsPanel's import" + the explicit "Do NOT modify SessionDashboard.tsx". Use copy semantics: the four dashboard originals stay in place, four new copies land under `src/ui/features/session-launcher/`. The Plan 04 dashboard subtree deletion sweeps the originals in one commit alongside SessionDashboard etc. — matching Phase 10 Wave 4 precedent for "leave orphan copies until the subtree deletion plan lands".

**Category:** Rule 3 (blocking issue) — a literal `git mv` execution would have shipped a tsc-broken intermediate commit and violated the plan's own must_haves invariant #5 ("TypeScript compiles clean after every commit"). Fixed by choosing the semantics that preserve tsc-clean-per-commit.

**Zero behavior change:** the retained CommandPalette wire now goes through `session-launcher/*` (verified), and the OLD dashboard copies remain byte-identical (verified — `git status` shows no modifications to `src/ui/dashboard/{NewSessionDialog,sshHostToHost,RemoteHostChips,NewSessionHostChips}.*` after Task 2).

### Comment-text hygiene (Task 3)

The plan's Rule 1 self-check note in Task 3 called out that mentioning `NetworkGraphCard` even inside a `//` comment could risk tripping the verify grep depending on regex nuance. Chose the safest phrasing: rewrote the leading comment's "the retired NetworkGraphCard from src/ui/dashboard/cards/" to "the retired graph card from src/ui/dashboard/cards/" — file now contains zero occurrences of the literal identifier `NetworkGraphCard` anywhere (verified: `grep -c NetworkGraphCard src/ui/shell/tabUtils.tsx` = 0).

## Threat Model Coverage

| Threat ID  | Mitigation Applied                                                    | Verification                                             |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| T-12-02-01 | SidebarTree.tsx:54-56 read verbatim before inlining; signature preserved | PASS — NewSessionDialog.test.tsx 9/9; PrettyConversationsPanel.test.tsx 14/14 |
| T-12-02-02 | 4 CommandPalette imports rewritten in one commit; post-commit grep 0 `@/dashboard/` and 4 `@/features/session-launcher/` | PASS — tsc-clean; grep gates PASS                        |
| T-12-02-03 | Phase 11 dashboard-swap pattern reused; PrettyLandingCard reused; TabType union preserved | PASS — PrettyLandingCard.test.tsx 4/4; non-comment NetworkGraphCard count = 0 |
| T-12-02-04 | Task 1 modified sidebar/NewSessionDialog.tsx (retained/protected), Task 2 copied dashboard/NewSessionDialog.tsx (relocated); two files never conflated | PASS — `git log -p 42e544b -- src/ui/features/session-launcher/` empty; `git log -p 11ffa95 -- src/ui/sidebar/NewSessionDialog.tsx` empty; PrettyConversationsPanel.tsx line 56 `import from "@/sidebar/NewSessionDialog"` intact |
| T-12-02-05 | Enumerated imports in each of the 4 relocated files pre-move; none use `@/dashboard/` alias, so no rewrite needed | PASS — grep gate confirmed clean                         |
| T-12-02-06 | Zero new npm deps                                                     | PASS — no install commands run                           |
| T-12-02-SC | Zero package installs                                                 | PASS                                                     |

## Threat Flags

None — this plan is a pure refactor with zero behavior change. No new endpoints, auth paths, file access patterns, or trust boundaries introduced.

## Known Stubs

None — refactor-only plan, no placeholder data or "coming soon" text introduced. The `case "network_graph"` render now returns `PrettyLandingCard` — but that's not a stub, it's the same landing card already used for the `dashboard` case per Phase 11 (well-established retained visual).

## Retained-UI Preservation Ledger

Load-bearing retained-UI files verified untouched or verified still-functional:

| File                                                              | Status                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/ui/sidebar/NewSessionDialog.tsx`                             | MODIFIED (isFolder inlined — module-private, no external contract change); test-verified |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Untouched; line 56 `import { NewSessionDialog } from "@/sidebar/NewSessionDialog"` still resolves; test-verified 14/14 |
| `src/ui/features/pretty-view/PrettyLandingCard.tsx`               | Untouched; still consumed by `tabUtils.tsx` for both `dashboard` and now `network_graph` cases; test-verified 4/4 |
| `src/ui/shell/CommandPalette.tsx`                                 | MODIFIED (4 import lines only); the fleet double-shift search behavior byte-preserved; retained-UI-safe |
| `src/ui/shell/tabUtils.tsx`                                       | MODIFIED (network_graph case + import); other 20+ cases untouched; TabType union preserved |
| `src/ui/features/keyboard/**`                                     | Untouched (protection lock)                                  |
| `src/backend/**`                                                  | Untouched (Phase 13 territory)                               |

## Requirements Delivered

- **PURGE-06 (partial — pre-flight):** SidebarTree.tsx deletion-safe (the sole isFolder consumer no longer references it).
- **PURGE-07 (partial — pre-flight):** `src/ui/dashboard/` deletion-safe (CommandPalette.tsx and tabUtils.tsx no longer reference any files under it).

Full PURGE-06/07 satisfaction happens when Plans 03/04 execute the actual file deletions; this plan enabled that by removing the tsc-blocking cross-imports.

## Downstream Enablement

- **Plan 03** (SidebarTree deletion): can now safely `rm src/ui/sidebar/SidebarTree.tsx` — the `isFolder` symbol is no longer imported anywhere in retained UI. Verified: post-plan grep `grep -rn "isFolder" src/` returns only the retained sidebar/NewSessionDialog.tsx module-private definition + SidebarTree.tsx's own definition + a handful of dying `sidebar/*Panel.tsx` files (all die in Plan 03).
- **Plan 04** (dashboard subtree deletion): can now safely `rm -rf src/ui/dashboard/` — CommandPalette + tabUtils are import-orphan of dashboard/. Verified: `grep -rn "from \"@/dashboard/" src/ui/shell/` returns 0 (both CommandPalette.tsx and tabUtils.tsx are clean).
- The Wave 3 tsc-clean-per-commit invariant is now achievable.

## Key Findings

- **No surprises.** The 4 relocated files were fully self-contained (no cross-imports among themselves via `@/dashboard/` alias, no imports of other dashboard/ files). Straightforward copy.
- **CommandPalette had exactly the 4 imports the plan enumerated** — no hidden additional `@/dashboard/` reference to sweep.
- **The `case "network_graph"` in `tabIcon`** (line 113-114) uses lucide-react's `Network` icon (already imported), so leaving it intact per the plan's directive posed no risk.
- **Vitest baseline held identical** to the Phase 11 reference (524 passed, 2 ComposeBox failures pre-existing) — no test drift caused by this plan.

## Self-Check: PASSED

- Created files verified: `src/ui/features/session-launcher/{NewSessionDialog.tsx, sshHostToHost.ts, RemoteHostChips.tsx, NewSessionHostChips.tsx}` — all FOUND
- Modified files verified: `src/ui/sidebar/NewSessionDialog.tsx`, `src/ui/shell/CommandPalette.tsx`, `src/ui/shell/tabUtils.tsx` — all reflect intended edits
- Commits verified: `42e544b`, `11ffa95`, `29b52ab` all present on tip of `feat/tab-title-from-tmux` (via `git log --oneline`)
- SUMMARY.md file present at `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-02-SUMMARY.md`
- OLD dashboard files still on disk (as required for tsc-clean-per-commit across the Wave 2→Wave 3 seam): `src/ui/dashboard/{NewSessionDialog.tsx, sshHostToHost.ts, RemoteHostChips.tsx, NewSessionHostChips.tsx}` — all FOUND (unchanged; die with Plan 04 dashboard subtree deletion)
