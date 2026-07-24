# Phase 14A — CSS Purge Wave A: Deletions

**Date authored:** 2026-07-24
**Branch:** feat/tab-title-from-tmux (14 commits ahead of Phase 13 tip; last commit is Termix→Skynet rename `8ad1f4e`).
**Baseline:** `tsc --noEmit` = clean. `npx vitest run` = 524/526 (two pre-existing `ComposeBox.test.tsx` failures documented Phase 13).

## Objective

Delete dead UI subtrees Ashley never uses + retire every dangling import, switch-case, and integration exposed by these deletions.

Wave A is DELETION ONLY. Wave B (spawned separately) handles restyle work + AppShell sidebarHeader / mobile PinAction / xterm theme purges.

## Scope

### Subtrees deleted outright

1. `src/ui/features/file-manager/` — 40 files, ~13,000 LOC. Ashley uses Filestash at files.gigaashley.click.
2. `src/ui/features/docker/` — 8 files, ~2,500 LOC. Ashley uses `docker` command directly.
3. `src/ui/features/tunnel/` — 6 files, ~900 LOC. Ashley's fleet is on Tailscale.
4. `src/ui/features/server-stats/widgets/` — 11 files, ~880 LOC. Ashley checks health via SSH.
5. `src/ui/user/C2STunnelPresetManager.tsx` — 1 file, 1,203 LOC. Orphan already (0 callers pre-Phase-14A).

Also removed: retired-consumer-only files exposed by subtree deletions:

- `src/ui/features/server-stats/ServerStats.tsx` + `ServerStatsApp.tsx` — sole consumers were tabUtils + main.tsx; both retired here.
- `src/ui/features/docker/DockerApp.tsx` — sole consumer main.tsx (retired here).
- `src/ui/features/tunnel/TunnelApp.tsx` — sole consumer main.tsx (retired here).
- `src/ui/features/file-manager/FileManagerApp.tsx` — sole consumer main.tsx (retired here).

### Consumer retirements

Per objective: fix every dangling import + switch-case + integration.

- `src/ui/AppShell.tsx`: remove `TransferMonitor` + `getPendingTransferIds` imports, `needsTransferMonitor` memo, and mount site at line 1720. Trim `PERSISTENT_TAB_TYPES` to `["terminal", "rdp", "vnc", "telnet"]`. Trim `hostlessTypes` to `["dashboard"]`. Remove the `type === "files"` reference in the transfer-monitor gate (it's dead).
- `src/ui/shell/tabUtils.tsx`: remove imports of `FileManager`, `DockerManager`, `ServerStats`, `TunnelTab`. Remove `tabIcon` cases: `stats`, `files`, `host-manager`, `user-profile`, `admin-settings`, `docker`, `tunnel`, `network_graph`. Remove `renderTabContent` cases: `files`, `docker`, `stats`, `tunnel`, `network_graph`, `host-manager`, `user-profile`, `admin-settings`. Retain: `dashboard`, `terminal`, `rdp`, `vnc`, `telnet`. `hostToSSHHost` helper — strip fields that no longer flow (enableTunnel/enableFileManager/enableDocker/enableRdp/... are still on Host type — kept as-is, ui-types NOT touched Wave A except TabType union).
- `src/types/ui-types.ts`: retire `TabType` union members: `"files"`, `"docker"`, `"stats"`, `"host-manager"`, `"user-profile"`, `"admin-settings"`, `"tunnel"`, `"network_graph"`. Retain: `"dashboard"`, `"terminal"`, `"rdp"`, `"vnc"`, `"telnet"`. Delete `DockerContainerStatus`, `DockerContainer` types. Retain `TunnelStatusValue`, `TunnelMode`, `Tunnel` — main-axios `tunnelApi` still exists (external route + backend surface). Retain dashboard* types (still referenced by dashboard-api.ts which stays until Phase 14+).
- `src/main.tsx`: remove `FileManagerApp`, `TunnelApp`, `ServerStatsApp`, `DockerApp` lazy imports + `case` branches in `FullscreenApp` switch. Retain `TerminalApp` and `GuacamoleApp` cases.
- `src/ui/state/conversation-store.ts`: remove `"files"`, `"docker"`, `"stats"` from `CONVERSATION_TAB_TYPES`. Update comment on line 15-19 accordingly.
- `src/ui/state/conversation-store.test.ts`: update test cases that reference retired tab types.
- Locale files (35 total: 34 translated + en source): strip `docker`, `fileManager`, `serverStats`, `tunnels`, `transfer`, `networkGraph`, `dashboardTab`, `dashboard` top-level sections. Retain `nav.docker`, `nav.fileManager`, `nav.serverStats`, `nav.tunnels` (still consumed by TabContext — not touched Wave A).

### Preserve list (do not touch)

Per objective's `<preserve_scope>`:
- `src/ui/features/pretty-view/` — chat surface (LOCKED)
- `src/ui/features/pretty-conversations/` — conversation list
- `src/ui/features/terminal/` — xterm.js
- `src/ui/features/session-launcher/` — session creation flow
- `src/ui/features/guacamole/` — RDP/VNC (retained)
- `src/ui/features/keyboard/` — on-screen modifier bar for Terminal+Guacamole
- `src/ui/features/FullScreenAppWrapper.tsx` — still used by TerminalApp + GuacamoleApp
- `src/ui/ssh/`, `src/ui/auth/`, `src/ui/components/`, `src/ui/AppShell.tsx` beyond noted retirements
- `src/ui/shell/TabContext.tsx` — legacy TabContext with separate type universe; still consumed by tabUtils (`useTabsSafe` for `previewTerminalTheme`) and FullScreenAppWrapper
- The `dashboard` TabType member — load-bearing fallback per Phase 11
- 6 non-pv xterm color themes in index.css — Wave B
- `src/ui/api/*` and `src/ui/main-axios.ts` (mega-facade with mixed live/dead surface — Wave B or later phase)
- Backend routes (`src/backend/ssh/file-manager*.ts`, `docker*.ts`, `tunnel*.ts`, `server-stats*.ts`, `docker-container-routes.ts`) — best-effort exclusive-consumer analysis says these are dead, but per objective, LEAVE them and note in SUMMARY. A future backend-purge phase will address.

## Commit strategy

Atomic per subtree (Phase 12 precedent):

1. **Commit 1** — Delete `src/ui/features/file-manager/` subtree entirely (40 files) + retire AppShell TransferMonitor imports + memo + mount site + prune PERSISTENT_TAB_TYPES `"files"`. Remove `nav.docker/serverStats/tunnels/fileManager` (retained) unaffected. tabUtils `case "files"` + import removed.
2. **Commit 2** — Delete `src/ui/features/docker/` subtree entirely (8 files) + tabUtils `case "docker"` + import removed + AppShell PERSISTENT_TAB_TYPES `"docker"` pruned.
3. **Commit 3** — Delete `src/ui/features/tunnel/` subtree entirely (6 files) + tabUtils `case "tunnel"` + import removed + AppShell PERSISTENT_TAB_TYPES `"tunnel"` pruned + hostlessTypes `"tunnel"` pruned + C2STunnelPresetManager retired.
4. **Commit 4** — Delete `src/ui/features/server-stats/` subtree entirely (13 files: widgets + ServerStats.tsx + ServerStatsApp.tsx) + tabUtils `case "stats"` + import removed + AppShell PERSISTENT_TAB_TYPES `"stats"` pruned.
5. **Commit 5** — Retire remaining stale surfaces in tabUtils (case `network_graph`/`host-manager`/`user-profile`/`admin-settings` + `tabIcon` cases), retire main.tsx FullscreenApp routes, retire ui-types TabType union members + DockerContainer types, retire conversation-store CONVERSATION_TAB_TYPES entries.
6. **Commit 6** — Strip retired locale sections from 35 JSON files.

Each commit must pass `tsc --noEmit` and vitest baseline unchanged.

## Success criteria

Per objective:
- Deletions complete
- Grep for retired identifiers (FileManager, DockerManager, TunnelTab, C2STunnelPresetManager, TransferMonitor, transferNotificationStore, DockerContainer) returns 0 code hits
- `tsc --noEmit` exit 0
- `npx vitest run` unchanged from 524/526 baseline (or documented adjustment for removed test files)
- `npm run build` exit 0
- SUMMARY.md at `.planning/phases/14A-css-purge-wave-a-deletions/14A-SUMMARY.md`
