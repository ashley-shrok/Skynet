# Phase 14A Plan 01 — Strip-List

**Purpose:** Authoritative enumeration of every file/subtree/consumer to delete or retire in Wave A. Every claim is grep-verified against HEAD `8ad1f4e` on branch `feat/tab-title-from-tmux` on 2026-07-24.

**Contract:** Wave A commits 1-6 consume this list as their deletion-target contract. Anything absent here is out of scope; anything here is verified to have zero surviving retained-UI consumers OR is being retired in the same commit.

---

## Section A: `src/ui/features/file-manager/` subtree (Commit 1)

**Full recursive enumeration** (`find src/ui/features/file-manager -type f`):

| # | File | Lines |
|---|------|-------|
| 1 | `FileManager.tsx` | 2823 |
| 2 | `FileManagerApp.tsx` | 50 |
| 3 | `FileManagerContextMenu.tsx` | 598 |
| 4 | `FileManagerDialogs.tsx` | 134 |
| 5 | `FileManagerGrid.tsx` | 1282 |
| 6 | `FileManagerSidebar.tsx` | 796 |
| 7 | `FileManagerToolbar.tsx` | 349 |
| 8 | `SudoPasswordDialog.tsx` | 98 |
| 9 | `TransferMonitor.tsx` | 80 |
| 10 | `transferProgressMonitor.tsx` | 339 |
| 11 | `file-manager-types.ts` | 32 |
| 12 | `file-manager-utils.ts` | 17 |
| 13 | `file-manager-utils.test.ts` | 33 |
| 14 | `transferMetricsFormat.ts` | 74 |
| 15 | `transferNotificationStore.ts` | 52 |
| 16-31 | `components/*.tsx` (16 files) | ~4923 |
| 32-36 | `hooks/*.ts` (5 files) | ~920 |

**Total: 40 files, ~12,600 LOC.**

**External consumers (grep 2026-07-24):**

```
$ grep -rn "from \"@/features/file-manager" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/ui/features/file-manager"
src/ui/AppShell.tsx:64: TransferMonitor from "@/features/file-manager/TransferMonitor.tsx"
src/ui/AppShell.tsx:65: getPendingTransferIds from "@/features/file-manager/transferNotificationStore.ts"
src/ui/shell/tabUtils.tsx:22: FileManager from "@/features/file-manager/FileManager"
src/main.tsx:34-35: FileManagerApp lazy import
```

**Retirement in Commit 1:**

- **`src/ui/AppShell.tsx` line 64-65:** delete both imports.
- **`src/ui/AppShell.tsx` lines 1276-1289 (`needsTransferMonitor` memo):** delete entire memo block including preceding 8-line comment.
- **`src/ui/AppShell.tsx` line 1720 (`{needsTransferMonitor && <TransferMonitor />}` mount):** delete line.
- **`src/ui/AppShell.tsx` line 738 (`"files"` in PERSISTENT_TAB_TYPES):** delete entry.
- **`src/ui/AppShell.tsx` line 1282 comment referencing `"files"` tab:** deleted with memo.
- **`src/ui/shell/tabUtils.tsx` line 22 (`FileManager` import):** delete.
- **`src/ui/shell/tabUtils.tsx` line 100 (`case "files"` in `tabIcon`):** delete.
- **`src/ui/shell/tabUtils.tsx` lines 219-227 (`case "files"` in `renderTabContent`):** delete.
- **`src/main.tsx` FileManagerApp lazy declaration + `case "file-manager"` in FullscreenApp:** deferred to Commit 5 (grouped with other main.tsx changes).

## Section B: `src/ui/features/docker/` subtree (Commit 2)

**Enumeration:**

| # | File | Lines |
|---|------|-------|
| 1 | `DockerApp.tsx` | 53 |
| 2 | `DockerManager.tsx` | 836 |
| 3 | `components/ConsoleTerminal.tsx` | 596 |
| 4 | `components/ContainerCard.tsx` | 311 |
| 5 | `components/ContainerDetail.tsx` | 160 |
| 6 | `components/ContainerList.tsx` | 83 |
| 7 | `components/ContainerStats.tsx` | 240 |
| 8 | `components/LogViewer.tsx` | 233 |

**Total: 8 files, ~2,512 LOC.**

**External consumers:**

- `src/ui/shell/tabUtils.tsx:23` (DockerManager)
- `src/main.tsx:47-48` (DockerApp lazy import)

**Retirement in Commit 2:**

- **`src/ui/shell/tabUtils.tsx` line 23:** delete import.
- **`src/ui/shell/tabUtils.tsx` line 108 (`case "docker"` in `tabIcon`):** delete.
- **`src/ui/shell/tabUtils.tsx` lines 229-240 (`case "docker"` in `renderTabContent`):** delete.
- **`src/ui/AppShell.tsx` line 739 (`"docker"` in PERSISTENT_TAB_TYPES):** delete.
- **`src/main.tsx`:** deferred to Commit 5.

## Section C: `src/ui/features/tunnel/` subtree (Commit 3)

**Enumeration:**

| # | File | Lines |
|---|------|-------|
| 1 | `TunnelApp.tsx` | 76 |
| 2 | `TunnelInlineControls.tsx` | 156 |
| 3 | `TunnelModeSelector.tsx` | 78 |
| 4 | `TunnelTab.tsx` | 464 |
| 5 | `tunnel-form-utils.ts` | 62 |
| 6 | `tunnel-form-utils.test.ts` | 62 |

**Total: 6 files, ~898 LOC.**

**External consumers:**

- `src/ui/shell/tabUtils.tsx:27` (TunnelTab)
- `src/main.tsx:39-40` (TunnelApp lazy import)
- `src/ui/user/C2STunnelPresetManager.tsx:9` (uses `tunnel-form-utils.ts`) — also being retired same commit.

**Retirement in Commit 3:**

- **`src/ui/features/tunnel/` — delete all 6 files.**
- **`src/ui/user/C2STunnelPresetManager.tsx` — delete (0 external consumers, verified).**
- **`src/ui/shell/tabUtils.tsx` line 27:** delete import.
- **`src/ui/shell/tabUtils.tsx` line 110 (`case "tunnel"` in `tabIcon`):** delete.
- **`src/ui/shell/tabUtils.tsx` line 257 (`case "tunnel"` in `renderTabContent`):** delete.
- **`src/ui/AppShell.tsx` line 741 (`"tunnel"` in PERSISTENT_TAB_TYPES):** delete.
- **`src/ui/AppShell.tsx` line 796 (`"tunnel"` in hostlessTypes):** delete (leaves only `"dashboard"`).
- **`src/main.tsx`:** deferred to Commit 5.

## Section D: `src/ui/features/server-stats/` subtree (Commit 4)

**Enumeration:**

| # | File | Lines |
|---|------|-------|
| 1 | `ServerStats.tsx` | ? (retained-consumer only) |
| 2 | `ServerStatsApp.tsx` | ? |
| 3-13 | `widgets/*.ts(x)` (11 files) | ~880 |

**Grep verification:**

```
$ grep -rn "from \"@/features/server-stats" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/ui/features/server-stats"
src/ui/shell/tabUtils.tsx:24: ServerStats from "@/features/server-stats/ServerStats"
src/main.tsx:42-43: ServerStatsApp lazy import
```

**Retirement in Commit 4:**

- **`src/ui/features/server-stats/` — delete entire subtree (widgets + ServerStats.tsx + ServerStatsApp.tsx).**
- **`src/ui/shell/tabUtils.tsx` line 24:** delete import.
- **`src/ui/shell/tabUtils.tsx` line 98 (`case "stats"` in `tabIcon`):** delete.
- **`src/ui/shell/tabUtils.tsx` lines 242-255 (`case "stats"` in `renderTabContent`):** delete.
- **`src/ui/AppShell.tsx` line 740 (`"stats"` in PERSISTENT_TAB_TYPES):** delete.
- **`src/main.tsx`:** deferred to Commit 5.

## Section E: Stale TabType + FullscreenApp + conversation-store cleanup (Commit 5)

**Files touched:**

1. `src/ui/shell/tabUtils.tsx` — remove `tabIcon` cases: `host-manager`, `user-profile`, `admin-settings`, `network_graph`. Remove `renderTabContent` cases: `network_graph`, `host-manager`, `user-profile`, `admin-settings`. Remove unused Lucide imports: `Box`, `FolderSearch`, `Monitor` (wait — Monitor still used for RDP/VNC/telnet), `Network`, `Server`, `Settings`, `User`, `Activity`. Keep: `LayoutDashboard`, `Terminal`, `Monitor`, `TerminalSquare` (empty state icons).
2. `src/ui/AppShell.tsx` — no additional changes here beyond commits 1-4.
3. `src/types/ui-types.ts` — trim `TabType` union to `"dashboard" | "terminal" | "rdp" | "vnc" | "telnet"`. Delete `DockerContainerStatus`, `DockerContainer` types (0 retained-UI consumers verified). Retain `Tunnel`, `TunnelStatusValue`, `TunnelMode` (backend/main-axios still surface these).
4. `src/main.tsx` — remove `FileManagerApp`, `TunnelApp`, `ServerStatsApp`, `DockerApp` lazy declarations + their case branches in `FullscreenApp` switch.
5. `src/ui/state/conversation-store.ts` — remove `"files"`, `"docker"`, `"stats"` from `CONVERSATION_TAB_TYPES` Set. Update doc comment line 15-19.
6. `src/ui/state/conversation-store.test.ts` — update test cases referencing retired tab types.

## Section F: Locale purge (Commit 6)

**Locale files touched:** all 35 JSON files (`src/ui/locales/en.json` + `src/ui/locales/translated/*.json`).

**Top-level sections to strip** (verified zero retained-UI consumers of `t("<section>."`):

| Section | # keys (en.json est) | Consumer count post-14A |
|---------|----------------------|-------------------------|
| `docker` | ~40 | 0 (docker/ deleted Commit 2) |
| `fileManager` | ~150 | 0 (file-manager/ deleted Commit 1) |
| `serverStats` | ~30 | 0 (server-stats/ deleted Commit 4) |
| `tunnels` | ~50 | 0 (tunnel/ deleted Commit 3) |
| `transfer` | ~40 | 0 (transfer UI deleted with file-manager) |
| `networkGraph` | ~1 | 0 (dashboard/cards deleted Phase 12) |
| `dashboardTab` | ~1 | 0 (Phase 11+12 retirement) |
| `dashboard` | ~30 | 0 (Phase 11+12 retirement) |

**Retained sections (not touched):**

- `nav` — TabContext consumes `nav.docker/fileManager/serverStats/tunnels` (TabContext untouched Wave A).
- Everything else — see grep sweep in strip-list authoring.

## Section G: Deferred / out-of-scope

The following surfaces are IDENTIFIED as touched by deletion targets but NOT retired in Wave A. Documented in SUMMARY for future phase pickup:

1. **`src/ui/api/tunnel-api.ts`** — C2STunnelPreset functions become orphaned once C2STunnelPresetManager retires; other exports (`getTunnelStatuses`, `connectTunnel`, ...) still exist. Kept intact — main-axios re-exports still stable.
2. **`src/ui/api/docker-api.ts`**, **`src/ui/api/server-stats-api.ts`**, **`src/ui/api/file-manager-data-api.ts`**, **`src/ui/api/file-manager-metadata-api.ts`**, **`src/ui/api/ssh-file-operations-api.ts`** — all become orphan (0 retained UI consumers) but main-axios re-exports keep them in the graph. Kept intact.
3. **`src/ui/main-axios.ts`** — `dockerApi`, `statsApi`, `fileManagerApi`, `tunnelApi` axios instances kept intact (internal to main-axios).
4. **Backend routes** (`src/backend/ssh/file-manager*.ts`, `docker*.ts`, `tunnel*.ts`, `server-stats*.ts`, `docker-container-routes.ts`) — kept per objective's conservative directive.
5. **`src/types/index.ts`** — `TabContextTab.type`, `DockerContainer` interface, `TunnelMode` alias, `enableFileManager/enableTunnel/enableDocker` on SSHHost interface, `C2STunnelPreset` — all left intact (backend + TabContext consumers).
6. **`src/types/electron.d.ts`** — C2S tunnel Electron IPC API. Left intact.
7. **`src/ui/features/terminal/Terminal.tsx`** — dead `onOpenFileManager?` prop + `openFileManager` ref method. Wave B scope.
8. **`src/backend/ssh/pretty-view-upload.ts`** — retained (used by pretty-view chat).
