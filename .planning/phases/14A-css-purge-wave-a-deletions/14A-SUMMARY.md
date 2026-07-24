---
phase: 14A
plan: 01
subsystem: skynet-css-purge
tags: [deletion, cleanup, dead-code, ui-purge, phase-14a, css-purge-wave-a]
requires:
  - Phase 8ad1f4e (the standalone rename complete)
provides:
  - clean tabUtils.tsx surface (5 TabTypes only)
  - AppShell TransferMonitor / needsTransferMonitor retired
  - locale files stripped of retired-feature sections
tech-stack:
  removed: [prior fork's built-in file manager, Docker container UI, SSH tunnel UI, server-stats widgets, C2S tunnel presets]
  patterns: [atomic per-subtree deletion + immediate consumer retirement, Phase 12 precedent]
key-files:
  deleted:
    - src/ui/features/file-manager/ (40 files)
    - src/ui/features/docker/ (8 files)
    - src/ui/features/tunnel/ (6 files)
    - src/ui/features/server-stats/ (13 files)
    - src/ui/user/C2STunnelPresetManager.tsx
  modified:
    - src/ui/AppShell.tsx (imports + memo + mount site + PERSISTENT_TAB_TYPES + hostlessTypes)
    - src/ui/shell/tabUtils.tsx (imports + tabIcon + renderTabContent cases + lucide imports)
    - src/main.tsx (FullscreenApp lazy imports + switch cases)
    - src/types/ui-types.ts (TabType union collapsed + DockerContainer types deleted)
    - src/ui/state/conversation-store.ts (CONVERSATION_TAB_TYPES trimmed)
    - src/ui/state/conversation-store.test.ts (2 tests retired)
    - src/ui/locales/en.json + 34 translated locale JSONs
decisions:
  - "Retain nav.docker/fileManager/serverStats/tunnels locale keys because TabContext.tsx (Wave A scope-fence) still consumes them"
  - "Retain dashboard TabType member (load-bearing fallback per Phase 11)"
  - "Retain Tunnel/TunnelStatusValue/TunnelMode types (backend/main-axios still surface these)"
  - "Backend routes for file-manager/docker/tunnel/server-stats LEFT INTACT per objective's conservative directive — future backend-purge phase"
metrics:
  duration: ~2h authoring+execution wall-clock
  completed_date: 2026-07-24
---

# Phase 14A: CSS Purge Wave A — Deletions Summary

Skynet's post-rename cleanup: delete dead UI subtrees Ashley never uses + retire every dangling import, switch-case, and integration these deletions expose. Wave A shipped 6 atomic commits per Phase 12 precedent, deleting 68 UI files and ~15,000 LOC of dead React code, plus stripping ~24,500 LOC of dead locale strings across 35 JSON files. Total diff: 105 files, 43,533 lines deleted, 15 added.

## Wave A commits

| # | Hash | Description | Files | Deletions |
|---|------|-------------|-------|-----------|
| 1 | 7ad4480 | delete src/ui/features/file-manager/ subtree | 39 | 12,466 |
| 2 | 6e05e85 | delete src/ui/features/docker/ subtree | 10 | 2,530 |
| 3 | 0553568 | delete src/ui/features/tunnel/ subtree + C2STunnelPresetManager | 9 | 2,108 |
| 4 | ec9ea1e | delete src/ui/features/server-stats/ subtree | 15 | 1,752 |
| 5 | 58f6f45 | retire stale TabType union + DockerContainer + dead switch cases | 4 | 92 |
| 6 | 894afce | strip retired-feature locale sections from all 35 JSON files | 35 | 24,570 |

**Grand total: 105 files changed, 43,533 deletions, 15 insertions.**

## Deletions in detail

### src/ui/features/file-manager/ (Commit 1)

Full recursive subtree deletion, 40 files including `FileManager.tsx` (2,823 LOC), `FileManagerGrid.tsx` (1,282 LOC), `TransferToHostDialog.tsx` (1,076 LOC), 16-file components/ subdir, 5-file hooks/ subdir, and the transfer-notification store.

Consumer retirements bundled into same commit:
- `AppShell.tsx`: `TransferMonitor` + `getPendingTransferIds` imports (lines 64-65 pre-edit), `needsTransferMonitor` useMemo (13 lines incl. 8-line comment), mount site at former line 1720, and `"files"` entry in `PERSISTENT_TAB_TYPES`.
- `shell/tabUtils.tsx`: `FileManager` import (line 22), `tabIcon` case `"files"`, `renderTabContent` case `"files"`, unused `FolderSearch` lucide import.
- `main.tsx`: eagerly retired ALL four dead-feature lazy imports (FileManagerApp, TunnelApp, ServerStatsApp, DockerApp) + all four `case` branches in `FullscreenApp` switch. Bundling this here made Commits 2-4 cleaner (they no longer need to touch main.tsx).

### src/ui/features/docker/ (Commit 2)

Subtree deletion, 8 files including `DockerManager.tsx` (836 LOC), `ConsoleTerminal.tsx` (596 LOC), 6 components. Consumer retirements: tabUtils.tsx DockerManager import + tabIcon/renderTabContent `case "docker"` + unused `Box` lucide import; AppShell PERSISTENT_TAB_TYPES `"docker"`.

### src/ui/features/tunnel/ + C2STunnelPresetManager (Commit 3)

Subtree deletion, 6 files including `TunnelTab.tsx` (464 LOC), plus `src/ui/user/C2STunnelPresetManager.tsx` (1,203 LOC) which was already orphan pre-Wave-A. C2STunnelPresetManager was the sole in-repo consumer of tunnel-form-utils outside the tunnel/ subtree — batched into same commit for tsc-cleanliness. Consumer retirements: tabUtils.tsx TunnelTab import + tabIcon/renderTabContent `case "tunnel"`; AppShell PERSISTENT_TAB_TYPES `"tunnel"` + hostlessTypes trimmed to `["dashboard"]`.

### src/ui/features/server-stats/ (Commit 4)

Full subtree deletion, 13 files: `ServerStats.tsx`, `ServerStatsApp.tsx`, 10 widget files + widgets/index.ts. Consumer retirements: tabUtils.tsx ServerStats import + tabIcon/renderTabContent `case "stats"` + unused `Activity` lucide import; AppShell PERSISTENT_TAB_TYPES `"stats"`.

### TabType union + dead switch cases + DockerContainer types (Commit 5)

- `src/types/ui-types.ts`: `TabType` union collapsed from 13 → 5 members (dashboard | terminal | rdp | vnc | telnet). `DockerContainer` + `DockerContainerStatus` types deleted (0 retained-UI consumers post-Commit-2; backend `src/types/index.ts::DockerContainer` interface is a separate type universe left intact per strip-list Section G).
- `src/ui/shell/tabUtils.tsx`: 4 dead `tabIcon` cases retired (host-manager, user-profile, admin-settings, network_graph); 4 dead `renderTabContent` cases retired (network_graph landing-card + 3 null-return singletons); unused lucide imports removed (Network, Server, Settings, User).
- `src/ui/state/conversation-store.ts`: `CONVERSATION_TAB_TYPES` Set trimmed from 7 → 4 (terminal/rdp/vnc/telnet); doc comment updated.
- `src/ui/state/conversation-store.test.ts`: Tests 10 + 11 retired ("settings singletons excluded" + "tunnel tabs excluded"). The exclusion is now enforced by the TabType union; nothing to test.

### Locale purge (Commit 6)

Applied uniformly to all 35 locale JSON files (`en.json` + 34 translated). Top-level sections removed (each verified zero retained-UI `t()` consumers post-Wave-A):
- `docker` (~40 keys/locale)
- `fileManager` (~150 keys/locale)
- `serverStats` (~30 keys/locale)
- `tunnels` (~50 keys/locale)
- `transfer` (~40 keys/locale)
- `networkGraph` (1 key/locale)
- `dashboardTab` (1 key/locale)
- `dashboard` (~30 keys/locale)

Retained per strip-list Section F: `nav.docker`, `nav.fileManager`, `nav.serverStats`, `nav.tunnels` — TabContext.tsx (Wave A scope-fence — legacy Tab type universe not touched here) still calls `t("nav.<X>")` for these keys.

Deletion done via a Python `json` roundtrip preserving insertion order + UTF-8 fidelity + newline terminator.

## Deviations from plan

**None material.** The strip-list drafted at the start covered every retirement that materialized. Two minor sequencing tweaks made during execution:

1. **[Rule 2 - eager main.tsx cleanup]** Commit 1 retired ALL four `FullscreenApp` case branches + lazy imports for file-manager/tunnel/server-stats/docker at once. Strip-list had this deferred to Commit 5. Rationale: leaving main.tsx dangling references to file-manager during Commits 2-4 would fail tsc (main.tsx `case "file-manager"` referenced `FileManagerApp` which was deleted in Commit 1). Fixing that inline in Commit 1 preserved the tsc-clean-per-commit invariant.

2. **[Rule 2 - eager AppShell PERSISTENT_TAB_TYPES pruning]** Same commit pruned only the `"files"` member in Commit 1. Later commits pruned the corresponding members (`docker`, `tunnel`, `stats`). This is what the strip-list intended; noted here for clarity.

Both are trivial reorderings within the same overall scope.

## Threat Flags

None. Wave A is pure deletion; no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Deferred / follow-up

Documented for future phases per strip-list Section G:

1. **API layer orphans** — `src/ui/api/tunnel-api.ts` (C2S preset functions), `src/ui/api/docker-api.ts`, `src/ui/api/server-stats-api.ts`, `src/ui/api/file-manager-data-api.ts`, `src/ui/api/file-manager-metadata-api.ts`, `src/ui/api/ssh-file-operations-api.ts` — all become orphan (0 retained UI consumers) but `main-axios.ts` re-exports keep them in the graph. Left intact per objective's conservative directive.
2. **main-axios internals** — `dockerApi`, `statsApi`, `fileManagerApi`, `tunnelApi` axios instances remain declared. Internal to main-axios; tsc-clean.
3. **Backend routes** — `src/backend/ssh/file-manager*.ts`, `docker*.ts`, `tunnel*.ts`, `server-stats*.ts`, `docker-container-routes.ts` all become orphan retained-UI-wise. Kept per objective's conservative directive. A future backend-purge phase should address.
4. **Legacy type universes** — `src/types/index.ts::TabContextTab.type` union still lists retired tab types (`server_stats`, `file_manager`, `tunnel`, `docker`, `admin`, `user_profile`); `src/types/index.ts::DockerContainer` interface remains; `enableFileManager`/`enableTunnel`/`enableDocker` boolean fields remain on SSHHost interface. All wire into backend routes / TabContext — out of Wave A scope.
5. **Electron IPC** — `src/types/electron.d.ts` still declares C2S tunnel IPC APIs. Electron integration is separate from browser SSH surface; leave for Electron-specific cleanup.
6. **Terminal dead-prop** — `src/ui/features/terminal/Terminal.tsx` has an inert `onOpenFileManager?` prop + `openFileManager` ref-handle method with no upstream caller. Wave B scope (Terminal is a protected feature).
7. **Fossil dashboard-cards constants** — `src/ui/lib/theme.ts::DASHBOARD_CARDS` has 0 consumers (Phase 11/12 dashboard subtree deletion left it fossil). Not Wave A scope.

## Rebase risk

**None.** Skynet is now a standalone repo (no upstream after the 2026-07-24 rename severance). Wave A is pure deletion; no upstream rebase concern.

## Verification

- `npx tsc --noEmit` — exit 0 at every commit
- `npx vitest run` — 505 passing / 2 failing (baseline: 524/526 — the 2 failures are the same pre-existing `ComposeBox.test.tsx` failures; 21-test delta = 3 deleted test files (file-manager-utils.test.ts, useFileSelection.test.ts, tunnel-form-utils.test.ts) + 2 conversation-store test entries)
- `npm run build` — exit 0 clean production build
- Grep sweeps for retired identifiers (`FileManager<Component>`, `DockerManager`, `TunnelTab`, `C2STunnelPresetManager`, `TransferMonitor`, `transferNotificationStore`, `DockerContainer<TabType>` context) — 0 code hits in retained src/ui/. The `enableFileManager` / `enableTunnel` / `enableDocker` fields on Host / SSHHost persist because backend host CRUD still uses them — out of scope per objective.

## Self-Check: PASSED

Files deleted-and-referenced-in-summary:
- src/ui/features/file-manager/ (40 files): FOUND (all files show as `D` in `git log --diff-filter=D`)
- src/ui/features/docker/ (8 files): FOUND
- src/ui/features/tunnel/ (6 files): FOUND
- src/ui/features/server-stats/ (13 files): FOUND
- src/ui/user/C2STunnelPresetManager.tsx: FOUND (deletion tree)

Commits verified via `git log --oneline 8ad1f4e..HEAD`:
- 7ad4480: FOUND
- 6e05e85: FOUND
- 0553568: FOUND
- ec9ea1e: FOUND
- 58f6f45: FOUND
- 894afce: FOUND
