---
phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice
plan: 04
subsystem: dashboard+features/shell
tags: [chore, refactor, deletion, phase-12, PURGE-07, tsc-clean-per-commit, cross-cutting-resolution]
requires:
  - "12-01 (STRIP-LIST Section E authoritative 17-file enumeration; FullScreenAppWrapper cross-cut disposition options a/b/c)"
  - "12-02 (4 dashboard-shared files relocated to features/session-launcher/; tabUtils.tsx network_graph case swapped to PrettyLandingCard)"
  - "12-03 (SessionsPanel — sole @/dashboard/sshHostToHost consumer outside FullScreenAppWrapper — deleted)"
provides:
  - "src/ui/dashboard/ directory does not exist (whole 17-file subtree gone)"
  - "FullScreenAppWrapper.tsx unauthenticated branch now renders <PrettyLandingCard /> instead of <Dashboard/>"
  - "handleAuthSuccess handler stripped (its sole consumer was Dashboard's onAuthSuccess prop)"
  - "src/types/ui-types.ts 'dashboard' TabType PRESERVED (Phase 11 load-bearing decision — URL restore + synthetic fallback)"
  - "src/ui/features/session-launcher/ PRESERVED (Plan 12-02 relocated files intact)"
  - "src/ui/features/keyboard/ PRESERVED (retained on-screen modifier bar)"
  - "src/ui/sidebar/NewSessionDialog.tsx PRESERVED (retained pretty-conversations pencil consumer)"
  - "PURGE-07 delivered — 17 files, 4118 lines removed"
affects:
  - "src/ui/features/FullScreenAppWrapper.tsx (Dashboard import → PrettyLandingCard import; render swap; handleAuthSuccess handler removed)"
tech_stack:
  added: []
  patterns:
    - "STRIP-LIST option-b resolution: mirror Phase 11 Plan 02 tabUtils <PrettyLandingCard/> swap onto a second cross-cutting surface (FullScreenAppWrapper unauthenticated branch)"
    - "Per-commit tsc + full-suite vitest baseline gate — never `--no-verify`"
    - "Atomic subtree deletion via `git rm -rf src/ui/dashboard/` after cross-tree consumer scrub"
key_files:
  created:
    - ".planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-04-SUMMARY.md"
  modified:
    - "src/ui/features/FullScreenAppWrapper.tsx (Dashboard import → PrettyLandingCard; render swap; handleAuthSuccess removed)"
  deleted:
    - "src/ui/dashboard/Dashboard.tsx (887 lines)"
    - "src/ui/dashboard/DashboardTab.tsx (20 lines)"
    - "src/ui/dashboard/SessionDashboard.tsx (222 lines)"
    - "src/ui/dashboard/NewSessionDialog.tsx (106 lines — Plan-12-02 leftover copy; session-launcher/NewSessionDialog.tsx is live)"
    - "src/ui/dashboard/NewSessionHostChips.tsx (62 lines — Plan-12-02 leftover copy)"
    - "src/ui/dashboard/RemoteHostChips.tsx (54 lines — Plan-12-02 leftover copy)"
    - "src/ui/dashboard/sshHostToHost.ts (57 lines — Plan-12-02 leftover copy)"
    - "src/ui/dashboard/cards/NetworkGraphCard.tsx (1364 lines)"
    - "src/ui/dashboard/cards/ServerOverviewCard.tsx (156 lines)"
    - "src/ui/dashboard/cards/ServerStatsCard.tsx (82 lines)"
    - "src/ui/dashboard/cards/RecentActivityCard.tsx (128 lines)"
    - "src/ui/dashboard/cards/QuickActionsCard.tsx (141 lines)"
    - "src/ui/dashboard/components/DashboardSettingsDialog.tsx (159 lines)"
    - "src/ui/dashboard/hooks/useDashboardPreferences.ts (138 lines)"
    - "src/ui/dashboard/panels/UpdateLog.tsx (222 lines)"
    - "src/ui/dashboard/panels/alerts/AlertCard.tsx (152 lines)"
    - "src/ui/dashboard/panels/alerts/AlertManager.tsx (168 lines)"
decisions:
  - "Chose STRIP-LIST Section E option (b) — swap <Dashboard/> for <PrettyLandingCard/> in FullScreenAppWrapper unauthenticated branch. Rationale: (i) Task 1 audit confirmed FullScreenAppWrapper is consumed by 6 retained feature *App.tsx wrappers (Terminal, FileManager, Docker, Tunnel, ServerStats, Guacamole) so Disposition B (delete FullScreenAppWrapper) unsafe; (ii) STRIP-LIST Section E explicitly recommends option (b); (iii) the objective prompt authorizes option (b) as the executor's disposition."
  - "Stripped handleAuthSuccess handler after the render swap — it had zero remaining consumers post-swap. Standard Rule-3 cleanup (blocking issue: unused const would produce tsc strict warning under noUnusedLocals in some configs; safer to remove atomically with the swap)."
  - "Preserved TabProvider / SidebarProvider / CommandHistoryProvider / Toaster wrapping AND the authenticated `children(hostConfig, loading)` branch (load-bearing for the alternate /host/<id> full-screen mount when consumer *App.tsx wrappers are reached via that route)."
  - "Preserved auth-state useState + session-expired handler + auth-check useEffect — these still gate the authenticated render branch's rendering behavior; only the unauthenticated-branch Dashboard render was swapped."
metrics:
  duration: "~15m wall-clock (single execution wave, no checkpoints)"
  completed: "2026-07-23T12:07:55Z"
  commits: 3
  files_deleted: 17
  lines_deleted: 4118
  files_modified: 1
  tests_passing: "524/526 (Phase 11 baseline; 2 pre-existing ComposeBox.test.tsx failures out of scope)"
---

# Phase 12 Plan 04: `src/ui/dashboard/` subtree deletion + FullScreenAppWrapper resolution — Summary

## One-liner

Deleted the entire `src/ui/dashboard/` subtree (17 files, 4118 lines) after resolving the FullScreenAppWrapper cross-cut per STRIP-LIST Section E option (b): swap `<Dashboard isAuthenticated={false} ... />` for `<PrettyLandingCard />` in FullScreenAppWrapper's unauthenticated branch, mirroring the Phase 11 Plan 02 `tabUtils "dashboard"`-case swap onto a second cross-cutting surface. Delivers PURGE-07.

## What landed

### Task 1 — FullScreenAppWrapper cross-cut disposition (commit `d6d3886`)

**Audit** (before touching anything):
- `grep -rn "FullScreenAppWrapper" src/` → 6 retained feature-app consumers (`GuacamoleApp`, `ServerStatsApp`, `TunnelApp`, `DockerApp`, `FileManagerApp`, `TerminalApp`) + 1 comment reference in `GuacamoleDisplay.tsx`. FullScreenAppWrapper itself is retained-UI.
- `grep -rn 'from "@/dashboard/Dashboard' src/` → single hit at `FullScreenAppWrapper.tsx:7`. No other cross-tree Dashboard consumer.
- Verdict: Disposition B (delete FullScreenAppWrapper) unsafe. STRIP-LIST Section E recommends Disposition A (option-b render swap). Executed.

**Changes**:
1. Import swap: `import { Dashboard } from "@/dashboard/Dashboard.tsx";` → `import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard.tsx";`
2. Unauthenticated-branch render swap: replaced the 6-prop `<Dashboard isAuthenticated={false} authLoading={authLoading} onAuthSuccess={handleAuthSuccess} isTopbarOpen={false} onSelectView={() => {}} />` element with the zero-prop `<PrettyLandingCard />`.
3. Stripped `handleAuthSuccess` handler (its only consumer was the removed `onAuthSuccess` prop; kept `setIsAuthenticated` — still consumed by the session-expired handler + auth-check effect).

**Preserved (deliberate scope guard)**:
- TabProvider / SidebarProvider / CommandHistoryProvider / Toaster wrapping
- Authenticated render branch `{children(hostConfig, loading)}` (load-bearing for `/host/<id>` full-screen mount)
- All auth-state hooks (`useState` for `isAuthenticated/authLoading/hostConfig`, session-expired listener, auth-check `useEffect`)

**Verify**:
- `grep -c 'from "@/dashboard/Dashboard' src/ui/features/FullScreenAppWrapper.tsx` = 0
- `grep -rn 'from "@/dashboard/Dashboard' src/` = 0
- `tsc --noEmit` exit 0

### Task 2 — `src/ui/dashboard/` subtree deletion (commit `090cdfb`)

**Pre-deletion gate** (both grep-verified zero):
- `grep -rn 'from "@/dashboard/' src/` (excluding dashboard-internal + comments) → 0
- `grep -rn 'NetworkGraphCard|DashboardTab|SessionDashboard|NewSessionHostChips|RemoteHostChips|sshHostToHost' src/` (excluding dashboard-internal + `features/session-launcher/` — the Plan 02 relocation destination — + comments) → 0 non-comment survivors. The one apparent survivor at `AppShell.tsx:1068` is a `//` history comment that the plan's regex failed to filter (grep pattern had a bug: `^[^:]*:[[:space:]]*//` needs a second `[^:]*:` to skip past `LINENO:`); verified by hand that it is a comment. The `CommandPalette.tsx` hits are the live post-relocation consumers of `features/session-launcher/{RemoteHostChips,NewSessionHostChips}` — expected artifact, not a survivor of the dying tree.

**Execution**:
- `git rm -rf src/ui/dashboard/` — 17 files deleted atomically, 4118 lines removed.

**Post-deletion gates** (all pass):
| Gate | Command | Result |
|------|---------|--------|
| Subtree gone | `test ! -d src/ui/dashboard` | PASS |
| Relocation target intact | `test -d src/ui/features/session-launcher` | PASS |
| On-screen keyboard bar intact | `test -d src/ui/features/keyboard` | PASS |
| Sidebar NewSessionDialog intact | `test -f src/ui/sidebar/NewSessionDialog.tsx` | PASS |
| Zero cross-tree `@/dashboard/` imports | `grep -rn 'from "@/dashboard/' src/ \| grep -v comments \| wc -l` | 0 |
| Dashboard TabType preserved | `grep -c '"dashboard"' src/types/ui-types.ts` | 1 (unchanged from Phase 11) |
| tsc | `npx tsc --noEmit` | exit 0 |
| vitest | `npx vitest run` | 524/526 pass (Phase 11 baseline) |

## Deviations from Plan

None — plan executed exactly as written under Disposition A (option-b render swap) explicitly authorized by both STRIP-LIST Section E recommendation and the objective prompt.

Two minor process notes:
- **Rule 3 (blocking issue) — handleAuthSuccess cleanup**: after the render swap, `handleAuthSuccess` was orphaned. Removed atomically in the same Task 1 commit. Not a plan deviation; a natural consequence of the swap.
- **Plan grep pattern quirk (documented, not fixed)**: the plan's Task 2 verify grep regex `^[^:]*:[[:space:]]*//` is missing a second `[^:]*:` to skip past `grep -rn`'s `LINENO:` output. A single `//` comment in `AppShell.tsx:1068` (`<DashboardTab onOpenSingletonTab={...}/> that was its only case-body user.`) showed as an apparent survivor; verified by inspection to be a comment. Left `AppShell.tsx` untouched (out of scope for this plan; comment is accurate historical context). If a future auditor wants comment-clean-vs-code separation in grep gates, the corrected pattern is `^[^:]*:[0-9]+:[[:space:]]*//`.

## Authentication Gates

None encountered.

## Known Stubs

None. `PrettyLandingCard` is a fully-styled warm-glass landing element with no data-source dependency; it renders identical content to the tabUtils `case "dashboard"` and `case "network_graph"` fallbacks established by Phase 11 Plan 02 and Phase 12 Plan 02.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes were introduced. FullScreenAppWrapper's auth-check surface is unchanged (same `getUserInfo` axios call, same session-expired event listener, same authenticated-branch mount).

## Self-Check: PASSED

**Commit hashes verified**:
- `git log --oneline | grep d6d3886` → `d6d3886 refactor(shell): swap FullScreenAppWrapper Dashboard render for PrettyLandingCard (Phase 12 Plan 04)` FOUND
- `git log --oneline | grep 090cdfb` → `090cdfb chore(ui): delete src/ui/dashboard/ subtree (Phase 12 PURGE-07)` FOUND

**Files verified**:
- `test ! -d src/ui/dashboard` → PASS (subtree gone)
- `test -f src/ui/features/FullScreenAppWrapper.tsx` → PASS (modified, not deleted)
- `test -f src/ui/features/pretty-view/PrettyLandingCard.tsx` → PASS (import target intact)
- `test -f src/ui/features/session-launcher/NewSessionDialog.tsx` → PASS (Plan 12-02 relocation retained)
- `test -f src/ui/features/session-launcher/sshHostToHost.ts` → PASS
- `test -f src/ui/features/session-launcher/RemoteHostChips.tsx` → PASS
- `test -f src/ui/features/session-launcher/NewSessionHostChips.tsx` → PASS
- `test -d src/ui/features/keyboard` → PASS
- `test -f src/ui/sidebar/NewSessionDialog.tsx` → PASS
