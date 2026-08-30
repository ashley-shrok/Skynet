# Phase 12 Plan 01 — Strip-List

**Purpose:** Authoritative enumeration of every file, subtree, locale key, and writer/reader pair slated for deletion in Plans 02-06 of Phase 12. Every claim is grep-verified against the working tree at HEAD `320e15f` on branch `feat/tab-title-from-tmux` at authoring time 2026-07-23.

**Contract:** Plans 02-06 consume this list as their deletion-target contract. Anything absent here is out of scope; anything here is grep-verified with the exact command + observed hit list. Section I is the pre-flight refactor input contract for Plan 02; Section J is the retained-UI protection list that binds every downstream plan; Section K is Plan 07's phase-boundary verification-gate list.

**Requirements addressed:** PURGE-06 (sidebar simple-leaf + Admin + HostManager subtree + SidebarTree), PURGE-07 (`src/ui/dashboard/` subtree deletion — the FILES, not the TabType), PURGE-08 (Skynet tab bar chrome = `shell/Tab.tsx`), PURGE-09 (keyboard shortcut editor UI resolution → the `commandPaletteShortcutEnabled` writer+reader pair, not the on-screen modifier bar), PURGE-10 (dead locale strings across 35 locale JSON files).

**Baseline grep evidence at authoring:**

```
$ git log -1 --format="%h %s"
320e15f docs(12): begin phase execution

$ find src/ui/dashboard -type f | wc -l
17

$ ls src/ui/features/keyboard/
Toolbar.tsx  guacamoleAdapter.ts  inputAdapter.ts  sshAdapter.test.ts  sshAdapter.ts

$ ls src/ui/locales/translated/*.json | wc -l
34   # plus src/ui/locales/en.json = 35 locale JSON files total
```

Note on locale count: Phase 12 CONTEXT.md referenced "~34" locale files. Precise count is 35 (34 translated + 1 en source). Plan 06 authors against 35; every dead-key removal touches every one of the 35 files in a single atomic commit.

---

## Section A: Sidebar simple-leaf panel files (PURGE-06 · Plan 03 input)

Enumerated from `ls src/ui/sidebar/*Panel.tsx`. All 11 sidebar panel files were Phase-11-stripped from AppShell imports (`grep -n "^import" src/ui/AppShell.tsx | head -70` confirms — no `from "@/sidebar/*Panel"` remains). The files themselves sit orphaned on disk and are Plan 03's deletion targets.

**Grep evidence (2026-07-23 authoring, run against HEAD `320e15f`):**

```
$ for f in HostsPanel SessionsPanel CredentialsPanel QuickConnectPanel SshToolsPanel \
           SnippetsPanel HistoryPanel SplitScreenPanel ConnectionsPanel UserProfilePanel; do
    grep -rn "from.*\"@/sidebar/$f\"\|from.*'@/sidebar/$f'" src/ --include="*.ts" --include="*.tsx"
  done
(zero hits — all 11 panels have 0 non-comment code consumers post-Phase-11)
```

| # | File | Lines | Non-comment consumers | Test file present? |
|---|------|-------|-----------------------|--------------------|
| 1 | `src/ui/sidebar/HostsPanel.tsx` | 735 | 0 | no |
| 2 | `src/ui/sidebar/SessionsPanel.tsx` | 133 | 0 | no |
| 3 | `src/ui/sidebar/CredentialsPanel.tsx` | 68 | 0 (imports `HostManager` — Section C) | no |
| 4 | `src/ui/sidebar/QuickConnectPanel.tsx` | 202 | 0 | no |
| 5 | `src/ui/sidebar/SshToolsPanel.tsx` | 262 | 0 | no |
| 6 | `src/ui/sidebar/SnippetsPanel.tsx` | 1436 | 0 | no |
| 7 | `src/ui/sidebar/HistoryPanel.tsx` | 176 | 0 | no |
| 8 | `src/ui/sidebar/SplitScreenPanel.tsx` | 352 | 0 | no |
| 9 | `src/ui/sidebar/ConnectionsPanel.tsx` | 392 | 0 | no |
| 10 | `src/ui/sidebar/UserProfilePanel.tsx` | 1646 | 0 | no |

**Transitive-import notes (deletion-order consequences for Plan 03):**

- **HostsPanel.tsx** imports (line 16) `import { SidebarTree, isFolder } from "@/sidebar/SidebarTree";` — dies with SidebarTree.tsx (Section D). Also imports `HostManager` (line 17) and `HostShareModal` (line 18) — dies with HostManager subtree (Section C).
- **SessionsPanel.tsx** imports (line 7) `import { sshHostToHost } from "@/dashboard/sshHostToHost";` — dies with dashboard/sshHostToHost.ts after Plan 02 relocates it (Section E + Section I.2).
- **CredentialsPanel.tsx** imports (line 4) `import { HostManager } from "@/sidebar/HostManager";` — dies with HostManager subtree (Section C). Delete in same commit as HostManager subtree OR strictly before Section C's commit lands.
- **UserProfilePanel.tsx** contains the `commandPaletteShortcutEnabled` WRITER at lines 489-492 (state seed reads localStorage) + lines 1025-1036 (FakeSwitch `onChange` writes localStorage + dispatches `commandPaletteShortcutEnabledChanged` event) — see Section G for the writer+reader retire discipline.

**Zero-consumer-in-retained-UI verification (grep across retained tree):**

```
$ grep -rn "HostsPanel\|SessionsPanel\|CredentialsPanel\|QuickConnectPanel\|SshToolsPanel\|SnippetsPanel\|HistoryPanel\|SplitScreenPanel\|ConnectionsPanel\|UserProfilePanel" \
    src/ui/features/pretty-conversations/ src/ui/features/pretty-view/ \
    src/ui/features/terminal/ src/ui/features/guacamole/ \
    src/ui/shell/CommandPalette.tsx src/ui/shell/TabContext.tsx \
    src/ui/shell/SplitView.tsx src/ui/shell/tabUtils.tsx \
    2>/dev/null | wc -l
0
```

**Plan 03 commit grouping suggestion:** one atomic commit per panel file (leaves), plus a linked commit that also deletes HostsPanel + CredentialsPanel + SessionsPanel IN THE SAME commit as their transitive dependencies (SidebarTree — Section D — and HostManager subtree — Section C — and the relocated dashboard/sshHostToHost via Plan 02 pre-flight). See Section I ordering.

**PURGE-09 delivery trigger:** Section A's UserProfilePanel.tsx deletion is HALF of PURGE-09. The other half (AppShell reader) MUST retire in the same atomic commit — see Section G.

---

## Section B: Admin subtree files (PURGE-06 · Plan 03 input)

Enumerated from `ls src/ui/sidebar/Admin*.tsx`. All 7 files. Cross-imports below force same-commit deletion; if split across commits the intermediate state fails tsc.

| # | File | Lines |
|---|------|-------|
| 1 | `src/ui/sidebar/AdminSettingsPanel.tsx` | 835 |
| 2 | `src/ui/sidebar/AdminApiKeysSection.tsx` | 244 |
| 3 | `src/ui/sidebar/AdminIdentitiesSection.tsx` | 491 |
| 4 | `src/ui/sidebar/AdminManagementSections.tsx` | 494 |
| 5 | `src/ui/sidebar/AdminSettingsSections.tsx` | 547 |
| 6 | `src/ui/sidebar/AdminSettingsShared.tsx` | 55 |
| 7 | `src/ui/sidebar/AdminUserDialogs.tsx` | 498 |

**Inter-section import chain (2026-07-23 grep):**

```
$ grep -rn "from.*\"./Admin" src/ui/sidebar/
src/ui/sidebar/AdminSettingsPanel.tsx:46:} from "./AdminManagementSections";
src/ui/sidebar/AdminSettingsPanel.tsx:53:} from "./AdminSettingsSections";
src/ui/sidebar/AdminSettingsPanel.tsx:54:import { AdminApiKeysSection } from "./AdminApiKeysSection";
src/ui/sidebar/AdminSettingsPanel.tsx:55:import { AdminIdentitiesSection } from "./AdminIdentitiesSection";
src/ui/sidebar/AdminSettingsPanel.tsx:60:} from "./AdminUserDialogs";
src/ui/sidebar/AdminApiKeysSection.tsx:9:import { AccordionSection } from "./AdminSettingsShared";
src/ui/sidebar/AdminApiKeysSection.tsx:10:import type { AdminUser } from "./AdminManagementSections";
src/ui/sidebar/AdminIdentitiesSection.tsx:7:import { AccordionSection } from "./AdminSettingsShared";
src/ui/sidebar/AdminManagementSections.tsx:23:import { AccordionSection } from "./AdminSettingsShared";
src/ui/sidebar/AdminSettingsSections.tsx:7:import { AccordionSection, AdminToggle } from "./AdminSettingsShared";
src/ui/sidebar/AdminUserDialogs.tsx:20:import { AdminToggle } from "./AdminSettingsShared";
src/ui/sidebar/AdminUserDialogs.tsx:21:import type { AdminUser } from "./AdminManagementSections";
```

**Dependency graph:**

- `AdminSettingsPanel.tsx` → imports from every other Admin* file (top of chain).
- `AdminApiKeysSection.tsx`, `AdminIdentitiesSection.tsx`, `AdminManagementSections.tsx`, `AdminSettingsSections.tsx`, `AdminUserDialogs.tsx` → all import from `AdminSettingsShared.tsx`.
- `AdminApiKeysSection.tsx` + `AdminUserDialogs.tsx` → also import `AdminUser` type from `AdminManagementSections.tsx`.

**External consumer verification:**

```
$ grep -rn "AdminSettingsPanel\|AdminApiKeysSection\|AdminIdentitiesSection\|AdminManagementSections\|AdminSettingsSections\|AdminSettingsShared\|AdminUserDialogs" src/ \
    --include="*.ts" --include="*.tsx" | grep -v "^src/ui/sidebar/Admin"
(zero hits)
```

**Plan 03 commit shape:** ONE atomic commit deletes all 7 files together (`git rm` × 7). Any single-file split breaks tsc mid-sequence.

---

## Section C: HostManager subtree files (PURGE-06 · Plan 03 input)

Enumerated from `ls src/ui/sidebar/Host*.tsx` + `ls src/ui/sidebar/*.ts`. All 12 files.

| # | File | Lines |
|---|------|-------|
| 1 | `src/ui/sidebar/HostManager.tsx` | 533 |
| 2 | `src/ui/sidebar/HostManagerData.ts` | 120 |
| 3 | `src/ui/sidebar/HostManagerTabs.tsx` | 167 |
| 4 | `src/ui/sidebar/HostShareModal.tsx` | 317 |
| 5 | `src/ui/sidebar/HostEditor.tsx` | 1282 |
| 6 | `src/ui/sidebar/HostEditorData.ts` | 290 |
| 7 | `src/ui/sidebar/HostEditorFeatureTabs.tsx` | 82 |
| 8 | `src/ui/sidebar/HostEditorGeneralTab.tsx` | 699 |
| 9 | `src/ui/sidebar/HostEditorGuacamoleTabs.tsx` | 1369 |
| 10 | `src/ui/sidebar/HostEditorStatsTab.tsx` | 296 |
| 11 | `src/ui/sidebar/HostCredentialList.tsx` | 413 |
| 12 | `src/ui/sidebar/CredentialEditorView.tsx` | 514 |

**Inter-file import chain (2026-07-23 grep):**

```
$ grep -rn "from.*\"./HostManager\|from.*\"./HostEditor\|from.*\"./HostCredentialList\|from.*\"./CredentialEditorView" src/ui/sidebar/
src/ui/sidebar/HostManager.tsx:22: CredentialEditorView from "./CredentialEditorView";
src/ui/sidebar/HostManager.tsx:23: HostEditor from "./HostEditor";
src/ui/sidebar/HostManager.tsx:24: mapCredentials, sshHostToHost from "./HostManagerData";
src/ui/sidebar/HostManager.tsx:25: HostCredentialList from "./HostCredentialList";
src/ui/sidebar/HostManager.tsx:26: makeCredentialTabs, makeHostTabs, TabStrip from "./HostManagerTabs";
src/ui/sidebar/HostEditor.tsx:48: (types) from "./HostEditorData";
src/ui/sidebar/HostEditor.tsx:49: HostDockerTab, HostFilesTab from "./HostEditorFeatureTabs";
src/ui/sidebar/HostEditor.tsx:50: HostEditorGeneralTab from "./HostEditorGeneralTab";
src/ui/sidebar/HostEditor.tsx:55: (guacamole tabs) from "./HostEditorGuacamoleTabs";
src/ui/sidebar/HostEditor.tsx:56: HostStatsTab from "./HostEditorStatsTab";
src/ui/sidebar/HostEditorFeatureTabs.tsx:6: HostEditorForm type from "./HostEditorData";
src/ui/sidebar/HostEditorGuacamoleTabs.tsx:18: HostEditorForm type from "./HostEditorData";
src/ui/sidebar/HostEditorGeneralTab.tsx:18: HostEditorForm, HostProtocols types from "./HostEditorData";
src/ui/sidebar/HostEditorStatsTab.tsx:14: HostEditorForm type from "./HostEditorData";
```

**Dependency graph:**

- Top-of-tree: `HostManager.tsx` (imports HostEditor + HostCredentialList + CredentialEditorView + HostManagerData + HostManagerTabs).
- `HostEditor.tsx` (imports HostEditorData + HostEditorFeatureTabs + HostEditorGeneralTab + HostEditorGuacamoleTabs + HostEditorStatsTab).
- All 4 HostEditor* tab files import `HostEditorForm` type from HostEditorData.ts.

**External consumers (2026-07-23):**

```
$ grep -rn "from.*\"@/sidebar/HostManager\|from.*\"@/sidebar/HostShareModal" src/ --include="*.ts" --include="*.tsx"
src/ui/sidebar/HostsPanel.tsx:17:import { HostManager } from "@/sidebar/HostManager";
src/ui/sidebar/HostsPanel.tsx:18:import { HostShareModal } from "@/sidebar/HostShareModal";
src/ui/sidebar/CredentialsPanel.tsx:4:import { HostManager } from "@/sidebar/HostManager";
```

All 3 external consumers are themselves dying in Section A. Zero surviving retained-UI consumers.

**Plan 03 commit shape:** ONE atomic commit deletes all 12 files together. HostsPanel + CredentialsPanel (Section A) MAY delete in the same commit OR strictly before this commit; either way is tsc-clean.

---

## Section D: SidebarTree.tsx handling (PURGE-06 · Plan 03 input · gated by Plan 02 §I.1)

**File:** `src/ui/sidebar/SidebarTree.tsx` — 1508 lines.

**Exports (grep `^export` in SidebarTree.tsx):**

```
54:  export function isFolder(item: Host | HostFolder): item is HostFolder
219: export function HostItem(...)
840: export function FolderItem(...)
1026: export function SidebarTree(...)
```

Also exports `collectAllHosts` implicitly at line 145 (unexported helper — used internally by SidebarTree itself, no external consumer).

**Consumers of each export (2026-07-23 grep `isFolder\|HostItem\|FolderItem\|collectAllHosts` excluding SidebarTree.tsx itself):**

| Export | Consumer | Status |
|--------|----------|--------|
| `isFolder` | `src/ui/sidebar/HostsPanel.tsx:16, 67, 68, 96, 145, 150` | Dies with HostsPanel (Section A) |
| `isFolder` | `src/ui/sidebar/NewSessionDialog.tsx:38, 52` | **PROTECTED — pre-flight refactor Plan 02 §I.1 inlines the 3-line body** |
| `HostItem` | (0 external consumers — only used inside SidebarTree.tsx `SidebarTree` component render) | Dies with the file |
| `FolderItem` | (0 external consumers) | Dies with the file |
| `SidebarTree` | `src/ui/sidebar/HostsPanel.tsx:16` (only) | Dies with HostsPanel (Section A) |
| `collectAllHosts` (unexported) | (module-internal only) | Dies with the file |

**HostCredentialList's `CredentialFolderItem` (line 149) is NOT the same identifier as SidebarTree's `FolderItem`** — see `src/ui/sidebar/HostCredentialList.tsx:149` and `src/ui/sidebar/HostCredentialList.tsx:359`. Local component in a Section-C-dying file.

**Blocking gate for SidebarTree deletion:** NewSessionDialog.tsx (PROTECTED — Section J) imports `isFolder` on line 38. Deletion of SidebarTree.tsx while NewSessionDialog still imports from it breaks tsc.

**Pre-flight refactor (Plan 02 §I.1 — details in Section I below):** inline the 3-line `isFolder` body from `SidebarTree.tsx:54-56` directly into `NewSessionDialog.tsx`. After that refactor, NewSessionDialog imports zero symbols from `@/sidebar/SidebarTree` and SidebarTree can delete atomically. Verified NewSessionDialog already inlined `collectAllHosts` itself (comment in the file at lines 46-48: `// Local copy of SidebarTree.collectAllHosts — small enough to inline, keeps / this file self-contained`) — Plan 02 §I.1 mirrors the same pattern for `isFolder`.

**Plan 03 commit shape:** SidebarTree.tsx deletion goes in the SAME commit as HostsPanel.tsx deletion (both die together for tsc-clean intermediate state), AFTER Plan 02 lands the isFolder inline into NewSessionDialog.

---

## Section E: `src/ui/dashboard/` subtree deletion (PURGE-07 · Plan 04 input)

**Full recursive enumeration** (`find src/ui/dashboard -type f`, 17 files):

| # | File | Lines |
|---|------|-------|
| 1 | `src/ui/dashboard/Dashboard.tsx` | 887 |
| 2 | `src/ui/dashboard/DashboardTab.tsx` | 20 |
| 3 | `src/ui/dashboard/SessionDashboard.tsx` | 222 |
| 4 | `src/ui/dashboard/NewSessionDialog.tsx` | 106 |
| 5 | `src/ui/dashboard/NewSessionHostChips.tsx` | 62 |
| 6 | `src/ui/dashboard/RemoteHostChips.tsx` | 54 |
| 7 | `src/ui/dashboard/sshHostToHost.ts` | 57 |
| 8 | `src/ui/dashboard/cards/NetworkGraphCard.tsx` | 1364 |
| 9 | `src/ui/dashboard/cards/ServerOverviewCard.tsx` | 156 |
| 10 | `src/ui/dashboard/cards/ServerStatsCard.tsx` | 82 |
| 11 | `src/ui/dashboard/cards/RecentActivityCard.tsx` | 128 |
| 12 | `src/ui/dashboard/cards/QuickActionsCard.tsx` | 141 |
| 13 | `src/ui/dashboard/components/DashboardSettingsDialog.tsx` | 159 |
| 14 | `src/ui/dashboard/hooks/useDashboardPreferences.ts` | 138 |
| 15 | `src/ui/dashboard/panels/UpdateLog.tsx` | 222 |
| 16 | `src/ui/dashboard/panels/alerts/AlertCard.tsx` | 152 |
| 17 | `src/ui/dashboard/panels/alerts/AlertManager.tsx` | 168 |

**Total subtree: 17 files, 4118 lines.**

**Retained-UI consumer analysis (2026-07-23 grep across `src/ui/shell/`, `src/ui/features/`, `src/ui/AppShell.tsx`):**

```
$ grep -rn "from.*\"@/dashboard/" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/ui/dashboard/"
src/ui/shell/CommandPalette.tsx:9:  from "@/dashboard/NewSessionDialog";
src/ui/shell/CommandPalette.tsx:10: from "@/dashboard/sshHostToHost";
src/ui/shell/CommandPalette.tsx:14: from "@/dashboard/RemoteHostChips";
src/ui/shell/CommandPalette.tsx:19: from "@/dashboard/NewSessionHostChips";
src/ui/shell/tabUtils.tsx:28:    from "@/dashboard/cards/NetworkGraphCard";
src/ui/sidebar/SessionsPanel.tsx:7: from "@/dashboard/sshHostToHost";
src/ui/features/FullScreenAppWrapper.tsx:7: import { Dashboard } from "@/dashboard/Dashboard.tsx";
```

**Live retained-UI consumers of dashboard/ files:**

| Retained file | Consumes dashboard file | Resolution |
|---------------|------------------------|------------|
| `src/ui/shell/CommandPalette.tsx:9` | `dashboard/NewSessionDialog.tsx` | **Pre-flight relocate — Plan 02 §I.2 → `features/session-launcher/NewSessionDialog.tsx`** |
| `src/ui/shell/CommandPalette.tsx:10` | `dashboard/sshHostToHost.ts` | **Pre-flight relocate — Plan 02 §I.2 → `features/session-launcher/sshHostToHost.ts`** |
| `src/ui/shell/CommandPalette.tsx:11-14` | `dashboard/RemoteHostChips.tsx` | **Pre-flight relocate — Plan 02 §I.2 → `features/session-launcher/RemoteHostChips.tsx`** |
| `src/ui/shell/CommandPalette.tsx:15-19` | `dashboard/NewSessionHostChips.tsx` | **Pre-flight relocate — Plan 02 §I.2 → `features/session-launcher/NewSessionHostChips.tsx`** |
| `src/ui/shell/tabUtils.tsx:28` | `dashboard/cards/NetworkGraphCard.tsx` | **Pre-flight replace — Plan 02 §I.3 → warm-glass `<PrettyLandingCard />` fallback in the `case "network_graph"` render at tabUtils.tsx:278-279** |
| `src/ui/sidebar/SessionsPanel.tsx:7` | `dashboard/sshHostToHost.ts` | **No relocate needed** — SessionsPanel dies in Section A. Update the import to `@/features/session-launcher/sshHostToHost` in Plan 02's relocate commit IFF SessionsPanel outlives Plan 02 in the commit sequence; simpler: land Section A leaves BEFORE Plan 02's relocate, then SessionsPanel is already gone. |
| `src/ui/features/FullScreenAppWrapper.tsx:7` | `dashboard/Dashboard.tsx` | **CROSS-CUTTING — see below.** |

**FullScreenAppWrapper → Dashboard chain (unresolved; Plan 04 executor decides):**

`src/ui/features/FullScreenAppWrapper.tsx:7` imports `Dashboard` from `@/dashboard/Dashboard.tsx`. FullScreenAppWrapper itself is consumed by ServerStatsApp, TunnelApp, DockerApp, GuacamoleApp, FileManagerApp, TerminalApp (all retained-UI feature wrappers). Deleting `dashboard/Dashboard.tsx` breaks FullScreenAppWrapper which breaks 6 retained feature apps. Options for Plan 04 executor:

- **(a)** Delete FullScreenAppWrapper too. Requires Phase 13 audit — does the backend route `/host/<id>` full-screen surface reach FullScreenAppWrapper in Skynet? If backend routing renders these `*App` wrappers directly (bypassing AppShell tabs), the `<Dashboard>` inside is dead too and the whole chain can retire. If Ashley uses only the AppShell tabs, `/host/<id>` routes are dead — deletion safe.
- **(b)** Refactor FullScreenAppWrapper to render a warm-glass landing placeholder instead of `<Dashboard/>` (mirror the `PrettyLandingCard` swap from Phase 11 Plan 02 — same "delete not gate" pattern applied to a second surface).
- **(c)** Defer entire `dashboard/` deletion to Phase 13 (couples the frontend deletion to the backend route audit).

**Recommendation:** option (b) — swap `<Dashboard/>` in FullScreenAppWrapper for `<PrettyLandingCard/>`. Plan 04 executor's call; Section G's writer+reader retire discipline applies to this chain too (Dashboard is the "writer" for FullScreenAppWrapper's landing render; there is no "reader" of Dashboard state elsewhere in the retained tree — safe to swap).

**Internal `src/ui/dashboard/` cross-imports (all die together as a subtree):**

```
$ grep -rn "from.*\"@/dashboard/\|from.*\"\.\./\|from.*\"\./" src/ui/dashboard/
src/ui/dashboard/SessionDashboard.tsx:8:  from "@/dashboard/NewSessionDialog";
src/ui/dashboard/SessionDashboard.tsx:9:  from "@/dashboard/sshHostToHost";
src/ui/dashboard/SessionDashboard.tsx:13: from "@/dashboard/RemoteHostChips";
src/ui/dashboard/SessionDashboard.tsx:18: from "@/dashboard/NewSessionHostChips";
src/ui/dashboard/Dashboard.tsx:34:      from "@/dashboard/cards/NetworkGraphCard";
```

Sub-directory dependency graph:

- `Dashboard.tsx` imports `NetworkGraphCard` from `cards/`. All 5 cards + `panels/UpdateLog.tsx` + `panels/alerts/*` + `hooks/useDashboardPreferences` + `components/DashboardSettingsDialog` are Dashboard-internal — grep confirms zero non-Dashboard consumers.
- `SessionDashboard.tsx` imports 4 sibling files at the subtree root (all Plan 02 §I.2 relocate targets).
- `DashboardTab.tsx` (20 lines) is the wrapper Phase 11 kept referenced by the old `case "dashboard"` render in tabUtils.tsx that Phase 11 already replaced with `PrettyLandingCard` at line 194 — DashboardTab is 100% orphaned already.

**Plan 04 commit shape:**

- **Prerequisite:** Plan 02 §I.2 landed (4 files relocated to `features/session-launcher/`). Plan 02 §I.3 landed (tabUtils.tsx no longer imports NetworkGraphCard).
- **Prerequisite:** FullScreenAppWrapper resolution landed (option a/b/c from above — Plan 04 executor picks; deferred is fine if (c)).
- **Commit:** ONE atomic `git rm -r src/ui/dashboard/` (17 files, 4118 lines) OR split into two commits (Dashboard.tsx + `cards/` + `panels/` + `hooks/` + `components/` in one; the 4 relocate-donor files `SessionDashboard.tsx` + `DashboardTab.tsx` in a second) — executor's call, both are tsc-clean when the prerequisites are in place.

**PRESERVED (Phase 11 decision, per CONTEXT.md `<domain>` item 2):** The `"dashboard"` TabType in `src/types/ui-types.ts` line 150 (union member) + line 234 (secondary reference) STAYS. Phase 11 established this as load-bearing for URL restore + synthetic fallback in `effectiveSelectedTabId` + `doCloseTab`. Phase 12 deletes the FILES; the TYPE stays. `case "dashboard": return <PrettyLandingCard />` in `src/ui/shell/tabUtils.tsx:187-194` stays too. `tabIcon` case `"dashboard"` at `tabUtils.tsx:89-90` stays.

---

## Section F: Skynet tab bar chrome — `src/ui/shell/Tab.tsx` (PURGE-08 · Plan 05 input)

**File:** `src/ui/shell/Tab.tsx` — 442 lines.

**Grep evidence for orphan status (2026-07-23):**

```
$ grep -rn "from.*\"@/shell/Tab\"\|from.*\"@/shell/Tab\.tsx\"\|from.*'./Tab'\|from.*\"./Tab\"" src/ --include="*.ts" --include="*.tsx" | grep -v "TabContext\|tabUtils"
(zero hits)
```

Phase 11's landing swap (11-02) implicitly retired the Skynet top-of-app tab strip's mount point. `shell/Tab.tsx` is the visible chrome file: it consumes `nav.admin`, `nav.userProfile`, `nav.splitScreen`, `nav.cannotSplitTab`, `nav.openFileManager`, `nav.copyPassword`, `nav.copySudoPassword`, `nav.passwordCopied`, `nav.noPasswordAvailable`, `nav.failedToCopyPassword`, `nav.sshManager`, `nav.terminal`, `nav.serverStats`, `nav.fileManager`, `nav.docker`, `nav.tunnels` — the tab-strip renderer that shows tab titles + close buttons + right-click menu items.

**No sibling test file:**

```
$ ls src/ui/shell/Tab.test.*
(no matches)
```

**Plan 05 commit shape:** ONE atomic `git rm src/ui/shell/Tab.tsx`. Zero import stripping needed (already orphaned). Verify with post-delete grep `grep -rn "from.*shell/Tab\"" src/` → 0.

**KEEP (do not confuse):**

- `src/ui/shell/TabContext.tsx` (different file — tab-state provider consumed by AppShell.tsx line 22 area + CommandHistoryProvider + retained tab renderers).
- `src/ui/shell/CommandPalette.tsx` (retained double-shift fleet search).
- `src/ui/shell/SplitView.tsx` (retained split-view mechanism).
- `src/ui/shell/tabUtils.tsx` (retained tab render dispatcher — Plan 02 §I.3 modifies the `network_graph` case only).

**Locale side-effect:** Section H batches the nav.* keys that die with `shell/Tab.tsx` — `nav.admin`, `nav.userProfile`, `nav.splitScreen`, `nav.cannotSplitTab`, `nav.openFileManager`, `nav.sshManager` all become 0-code-consumer once Tab.tsx is deleted.

---

## Section G: PURGE-09 resolution — `commandPaletteShortcutEnabled` writer + reader retire (Plan 03 Task 1 input)

**Resolution premise (documented Phase 12 CONTEXT.md item 4):** the "keyboard shortcut editor UI" referenced in PURGE-09 is NOT `src/ui/features/keyboard/` — that subtree is the on-screen modifier bar for Terminal + Guacamole (RETAINED — see Section J and evidence below). The "editor UI" is the `commandPaletteShortcutEnabled` toggle inside UserProfilePanel.tsx AND its state-machine READER inside AppShell.tsx.

### G.1 — `src/ui/features/keyboard/` is RETAINED, not deleted

**Evidence (2026-07-23 grep):**

```
$ grep -rn "features/keyboard/Toolbar\|features/keyboard/sshAdapter\|features/keyboard/guacamoleAdapter\|features/keyboard/inputAdapter" src/ --include="*.ts" --include="*.tsx"
src/ui/features/guacamole/GuacamoleApp.tsx:16:import { Toolbar } from "@/features/keyboard/Toolbar.tsx";
src/ui/features/guacamole/GuacamoleApp.tsx:17:import { makeGuacamoleAdapter } from "@/features/keyboard/guacamoleAdapter.ts";
src/ui/features/terminal/Terminal.tsx:66:import { Toolbar } from "@/features/keyboard/Toolbar.tsx";
src/ui/features/terminal/Terminal.tsx:67:import { makeSshAdapter } from "@/features/keyboard/sshAdapter.ts";
src/ui/features/terminal/Terminal.tsx:71:} from "@/features/keyboard/inputAdapter.ts";
```

All 5 files in `src/ui/features/keyboard/` are consumed by retained-UI (Terminal.tsx + GuacamoleApp.tsx). Zero deletion candidates in this subtree.

**Files (5 total, 1043 lines, all RETAINED):**

| File | Lines | Consumer |
|------|-------|----------|
| `Toolbar.tsx` | 577 | Terminal.tsx (line 66) + GuacamoleApp.tsx (line 16) |
| `sshAdapter.ts` | 111 | Terminal.tsx (line 67) |
| `sshAdapter.test.ts` | 181 | (test file for sshAdapter — stays with sshAdapter) |
| `guacamoleAdapter.ts` | 106 | GuacamoleApp.tsx (line 17) |
| `inputAdapter.ts` | 48 | Terminal.tsx (line 71) |

Section J lists all 5 as PROTECTED with rationale.

### G.2 — WRITER: `src/ui/sidebar/UserProfilePanel.tsx` (dies in Section A)

**Grep evidence (2026-07-23):**

```
$ grep -rn "commandPaletteShortcutEnabled" src/ui/sidebar/UserProfilePanel.tsx
489:  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => {
490:    const v = localStorage.getItem("commandPaletteShortcutEnabled");
491:    return v !== null ? v === "true" : true;
492:  });
1025:              <FakeSwitch
1026:                checked={commandPaletteEnabled}
1027:                onChange={(v) => {
1028:                  setCommandPaletteEnabled(v);
1029:                  localStorage.setItem(
1030:                    "commandPaletteShortcutEnabled",
1031:                    v.toString(),
1032:                  );
1033:                  window.dispatchEvent(
1034:                    new Event("commandPaletteShortcutEnabledChanged"),
1035:                  );
1036:                }}
1037:              />
```

**Writer semantics:** UserProfilePanel reads `localStorage["commandPaletteShortcutEnabled"]` on mount (line 490), renders a `<FakeSwitch>` bound to internal `commandPaletteEnabled` state, and on toggle (lines 1027-1036) writes back to localStorage + dispatches the `commandPaletteShortcutEnabledChanged` cross-component event.

**Death timing:** UserProfilePanel.tsx dies as part of Section A's simple-leaf deletion. When the panel file is `git rm`'d, the writer disappears.

### G.3 — READER: `src/ui/AppShell.tsx` (Plan 03 Task 1 tears out in SAME commit as G.2)

**Grep evidence (2026-07-23):**

```
$ grep -rn "commandPaletteShortcutEnabled" src/ui/AppShell.tsx
282:  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
283:    useState<boolean>(() => {
284:      const v = localStorage.getItem("commandPaletteShortcutEnabled");
285:      return v !== null ? v === "true" : true;
286:    });
343:        if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
350:  }, [commandPaletteShortcutEnabled]);
354:      const v = localStorage.getItem("commandPaletteShortcutEnabled");
357:    window.addEventListener("commandPaletteShortcutEnabledChanged", handler);
360:        "commandPaletteShortcutEnabledChanged",
```

**Reader semantics (verified by reading AppShell.tsx lines 280-363):**

1. **State variable** at lines 282-286 (`useState<boolean>`) — reads localStorage seed on mount, defaults to `true` (per line 285: `v !== null ? v === "true" : true`). Ashley's Skynet users default to enabled.
2. **Gate expression** at line 343 inside the double-shift handler `useEffect`:
   ```
   if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
     setCommandPaletteOpen((prev) => !prev);
   ```
   The `&& commandPaletteShortcutEnabled` clause gates the CommandPalette open. Since the user default is `true` and the writer (UserProfilePanel) is being deleted — meaning no one can toggle it off — the gate becomes hardcoded-true which is equivalent to removing it.
3. **Effect dependency** at line 350: `}, [commandPaletteShortcutEnabled]);` — the `useEffect` re-registers the key handler whenever the gate flips. Once the gate is removed, this becomes `}, []);` (mount-only), which is what we want.
4. **Storage-event listener useEffect** at lines 352-363: subscribes to the `commandPaletteShortcutEnabledChanged` custom event so live toggles from UserProfilePanel propagate. With the writer dying, this entire `useEffect` becomes dead code and must be removed.

**Line-drift discipline for the executor (Plan 03 Task 1b):** Between authoring (2026-07-23) and Plan 03 execution, surrounding shell code may shift line numbers. Before editing, re-run:

```
grep -n "commandPaletteShortcutEnabled\|lastShiftTime" src/ui/AppShell.tsx
```

And confirm the file still contains the same 4 code sites (state declaration, gate expression, effect dep, storage-event listener). Line numbers may drift ±20 lines — trust the identifier grep, not the cited numbers.

### G.4 — Atomic-commit discipline: same-commit writer + reader retire

**MANDATORY:** Plan 03 Task 1's atomic commit deletes UserProfilePanel.tsx AND removes the four reader sites in AppShell.tsx (lines 282-286, gate-expression clause on line 343, effect dep on line 350, storage-event listener useEffect at lines 352-363) IN THE SAME commit.

Retention gate (what STAYS):

- **`lastShiftTime` `useRef`** at AppShell.tsx:281 — RETAINED. Load-bearing for double-shift detection.
- **Double-shift `useEffect`** at AppShell.tsx:333-350 — the OUTER useEffect stays; the `&& commandPaletteShortcutEnabled` clause on line 343 is removed, and the effect dep on line 350 changes from `[commandPaletteShortcutEnabled]` to `[]`.
- **`setCommandPaletteOpen`** (referenced on line 344) — RETAINED. This is the CommandPalette open-state setter defined elsewhere in AppShell; the double-shift path still calls it.
- **Storage-event listener useEffect** at lines 352-363 — DELETED entirely (no writer means no event to listen for).

**Result after commit:** Double-shift → open CommandPalette becomes UNCONDITIONAL. Ashley's user default was `true`, only accessible through the UserProfilePanel toggle that no longer exists → hardcoding it removes the gate without changing observable behavior.

**Intermediate-state invariant:** After the atomic commit, no code path anywhere in `src/` references `commandPaletteShortcutEnabled` or `commandPaletteShortcutEnabledChanged`. Verified by Section K gates:

```
grep -rn "commandPaletteShortcutEnabled" src/ --include="*.ts" --include="*.tsx" | wc -l    # expected 0
grep -rn "commandPaletteShortcutEnabledChanged" src/ --include="*.ts" --include="*.tsx" | wc -l  # expected 0
```

### G.5 — General pattern: writer + reader parity as a phase discipline

**Rule for future phases:** When deleting a file that WRITES to shared state (localStorage key, custom event dispatch, module singleton, atom, store, Zustand, Jotai, Context), the planner MUST grep for READERS of the same state in the same phase. Options:

- **(a)** Delete writer AND reader in the same atomic commit (Section G.4's approach — PURGE-09).
- **(b)** Explicitly retain the reader with a hardcoded default that survives the writer's absence (e.g., localStorage key becomes an environment constant).
- **(c)** Defer the deletion until the reader is also purge-scoped.

Never leave a reader orphaned by a writer's deletion — the reader will silently read a stale/empty localStorage value forever and its behavior will subtly diverge from the pre-deletion state.

This Section G resolution establishes the "orphan-reader-after-writer-death" discipline for Phase 13+ future purge phases.

---

## Section H: Dead locale strings (PURGE-10 · Plan 06 input)

**Full nav.* key inventory** (via `python3 -c "import json; d=json.load(open('src/ui/locales/en.json')); print('\n'.join(sorted(d['nav'].keys())))"`, 2026-07-23):

```
admin, cancel, cannotSplitTab, close, confirmClose, connections, conversations,
copyPassword, copySudoPassword, credentials, dashboard, docker, failedToCopyPassword,
fileManager, history, home, hostManager, hostTabTitle, hosts, networkGraph,
newSession, newSessionDescription, newSessionHostList, newSessionNameError,
newSessionNameLabel, newSessionNamePlaceholder, newSessionNoHosts, newSessionSearchHosts,
newSessionTitle, noPasswordAvailable, openFileManager, passwordCopied, quickConnect,
refreshTab, roleAdministrator, roleUser, serverStats, sessions, snippets, splitScreen,
sshManager, sshTools, terminal, tunnels, userProfile
```

**Per-key consumer analysis (2026-07-23 grep `t("nav.<key>"` + `t('nav.<key>'` across `src/`):**

| Key | Code hits | Consumer files | Post-Plan-03/04/05 status | Batch |
|-----|-----------|----------------|---------------------------|-------|
| `pinAppRail` (root, not `nav.`) | 0 | (none — dead pre-Phase-11) | Safe to delete | **batch-0 (AppRail cleanup)** |
| `pinAppRailDesc` (root) | 0 | (none) | Safe to delete | **batch-0** |
| `nav.dashboard` | 0 | (none) | Safe to delete (Phase 11 stripped last consumer) | **batch-1** |
| `nav.hosts` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.snippets` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.credentials` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.history` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.hostManager` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.sessions` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.connections` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.quickConnect` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.sshTools` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.networkGraph` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.conversations` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.refreshTab` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.roleAdministrator` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.roleUser` | 0 | (none) | Safe to delete | **batch-1** |
| `nav.admin` | 1 | `src/ui/shell/Tab.tsx:369` | Safe AFTER Section F | **batch-2 (post-Tab.tsx delete)** |
| `nav.userProfile` | 1 | `src/ui/shell/Tab.tsx:223` | Safe AFTER Section F | **batch-2** |
| `nav.splitScreen` | 1 | `src/ui/shell/Tab.tsx:302` | Safe AFTER Section F | **batch-2** |
| `nav.cannotSplitTab` | 1 | `src/ui/shell/Tab.tsx:302` | Safe AFTER Section F | **batch-2** |
| `nav.openFileManager` | 1 | `src/ui/shell/Tab.tsx:285` | Safe AFTER Section F | **batch-2** |
| `nav.sshManager` | 1 | `src/ui/shell/Tab.tsx:333` | Safe AFTER Section F | **batch-2** |
| `nav.noPasswordAvailable` | 1 | `src/ui/shell/Tab.tsx:129` | Safe AFTER Section F | **batch-2** |
| `nav.copyPassword` | 3 | `src/ui/shell/Tab.tsx:125` + `src/ui/sidebar/SidebarTree.tsx:610, 678` | Safe AFTER Sections D + F | **batch-2** |
| `nav.copySudoPassword` | 3 | `src/ui/shell/Tab.tsx:127` + `src/ui/sidebar/SidebarTree.tsx:619, 686` | Safe AFTER Sections D + F | **batch-2** |
| `nav.passwordCopied` | 3 | `src/ui/shell/Tab.tsx:91, 102` + `src/ui/sidebar/SidebarTree.tsx:281` | Safe AFTER Sections D + F | **batch-2** |
| `nav.failedToCopyPassword` | 4 | `src/ui/shell/Tab.tsx:85, 104` + `src/ui/sidebar/SidebarTree.tsx:275` | Safe AFTER Sections D + F | **batch-2** |
| `nav.home` | 2 | `src/ui/shell/TabContext.tsx:105, 236` | **STAYS** — retained-UI consumer | RETAINED |
| `nav.terminal` | 2 | `src/ui/shell/TabContext.tsx:122` + `src/ui/shell/Tab.tsx:226` | **STAYS** (TabContext survives; Tab.tsx consumer dies but TabContext keeps the key alive) | RETAINED |
| `nav.serverStats` | 2 | `src/ui/shell/TabContext.tsx:115` + `src/ui/shell/Tab.tsx:215` | **STAYS** (TabContext retained) | RETAINED |
| `nav.fileManager` | 2 | `src/ui/shell/TabContext.tsx:117` + `src/ui/shell/Tab.tsx:217` | **STAYS** (TabContext retained) | RETAINED |
| `nav.docker` | 2 | `src/ui/shell/TabContext.tsx:121` + `src/ui/shell/Tab.tsx:221` | **STAYS** (TabContext retained) | RETAINED |
| `nav.tunnels` | 2 | `src/ui/shell/Tab.tsx:219` + `src/ui/shell/TabContext.tsx:119` | **STAYS** (TabContext retained) | RETAINED |
| `nav.hostTabTitle` | 1 | `src/ui/shell/TabContext.tsx:336` | **STAYS** (TabContext retained) | RETAINED |
| `nav.close` | 1 | `src/ui/AppShell.tsx:1130` | **STAYS** (AppShell retained) | RETAINED |
| `nav.cancel` | 1 | `src/ui/AppShell.tsx:1134` | **STAYS** (AppShell retained) | RETAINED |
| `nav.confirmClose` | 1 | `src/ui/AppShell.tsx:1127` | **STAYS** (AppShell retained) | RETAINED |
| `nav.newSession` | 2 | `src/ui/sidebar/NewSessionDialog.tsx:119` + `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:221` | **STAYS** (both consumers PROTECTED — see Section J) | RETAINED |
| `nav.newSessionTitle` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:120` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionDescription` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:123` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionSearchHosts` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:126` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionNameLabel` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:132` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionNamePlaceholder` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:129` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionNameError` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:135` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionNoHosts` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:141` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |
| `nav.newSessionHostList` | 1 | `src/ui/sidebar/NewSessionDialog.tsx:175` | **STAYS** (NewSessionDialog PROTECTED) | RETAINED |

**Batch-0 (AppRail cleanup):** `pinAppRail` + `pinAppRailDesc` — Phase 11 Section B item 7 documented these as already-dead. Plan 06 landing this commit first is a simple hygiene sweep.

**Batch-1 (0-consumer nav.* keys):** 15 nav.* keys with 0 code consumers. Safe to strip in one atomic commit landing BEFORE Plan 03/04/05 (batch order independent — the keys are already dead).

**Batch-2 (post-deletion-triggered dead keys):** 12 nav.* keys that become dead ONLY after Sections D + F land. Plan 06 lands this commit AFTER Plans 03/04/05.

**Locale file scope:** every batch's commit touches all 35 JSON files (`src/ui/locales/en.json` + `src/ui/locales/translated/*.json` — 34 files):

```
$ ls src/ui/locales/*.json
src/ui/locales/en.json
$ ls src/ui/locales/translated/*.json | wc -l
34
```

Single atomic multi-file commit per batch. Type-safety net = react-i18next TFunction generics resolve keys at compile time — if a live consumer remains for a removed key, `npx tsc --noEmit` fails.

---

## Section I: Pre-flight refactor targets (Plan 02 input contract)

Three refactors MUST land BEFORE any deletion plan (03/04/05/06) runs, otherwise deletion plans fail the tsc-clean-per-commit invariant.

### I.1 — Inline `isFolder` from SidebarTree.tsx into sidebar/NewSessionDialog.tsx

**Source (SidebarTree.tsx:54-56, 3 lines):**

```typescript
export function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
```

**Target:** `src/ui/sidebar/NewSessionDialog.tsx`.

**Refactor:**

1. Insert the 3-line `isFolder` body directly into NewSessionDialog.tsx (append after the existing `collectAllHosts` inline at lines 46-59, or place adjacent to `SESSION_NAME_PATTERN` at line 44). Since NewSessionDialog already carries the inline-helper pattern for `collectAllHosts` with a matching comment ("Local copy of SidebarTree.collectAllHosts — small enough to inline, keeps this file self-contained"), mirror that convention.
2. Remove the import at line 38: `import { isFolder } from "@/sidebar/SidebarTree";` → strip the entire line.
3. Type import stays: `import type { Host, HostFolder } from "@/types/ui-types";` (line 39 — Host/HostFolder types are load-bearing).

**Post-refactor verification:**

```
$ grep -n "from \"@/sidebar/SidebarTree\"" src/ui/sidebar/NewSessionDialog.tsx
(zero hits)

$ grep -n "isFolder" src/ui/sidebar/NewSessionDialog.tsx
(local definition + call sites at existing lines 52-53, no imports)
```

Plan 02 commit message suggestion: `refactor(12-02): inline SidebarTree.isFolder into sidebar/NewSessionDialog.tsx (Section I.1 pre-flight for SidebarTree deletion)`

### I.2 — Relocate 4 dashboard-shared files consumed by CommandPalette

**Source paths (dashboard subtree — see Section E):**

- `src/ui/dashboard/NewSessionDialog.tsx` (106 lines)
- `src/ui/dashboard/sshHostToHost.ts` (57 lines)
- `src/ui/dashboard/RemoteHostChips.tsx` (54 lines)
- `src/ui/dashboard/NewSessionHostChips.tsx` (62 lines)

**Target directory:** `src/ui/features/session-launcher/` (NEW — Plan 02 creates it). This subtree is a retained-UI feature module owned by CommandPalette. Naming rationale: the 4 files together implement the "session launcher" flow behind the CommandPalette + double-shift; naming the new module by function (not by "dashboard-adjacent") lets Phase 13+ readers reason about it without the historical baggage.

**Target paths:**

- `src/ui/features/session-launcher/NewSessionDialog.tsx` (was `dashboard/NewSessionDialog.tsx`)
- `src/ui/features/session-launcher/sshHostToHost.ts`
- `src/ui/features/session-launcher/RemoteHostChips.tsx`
- `src/ui/features/session-launcher/NewSessionHostChips.tsx`

**FILENAME COLLISION WARNING:** `dashboard/NewSessionDialog.tsx` and `sidebar/NewSessionDialog.tsx` are DIFFERENT files. The dashboard version is being relocated to `features/session-launcher/`; the sidebar version is PROTECTED (Section J, consumed by PrettyConversationsPanel pencil button). Plan 02 executor must NOT confuse them. Grep verification pattern:

```
$ grep -rn "sidebar/NewSessionDialog" src/     # must survive
$ grep -rn "dashboard/NewSessionDialog" src/   # must reach 0 after relocate + Section E deletion
$ grep -rn "features/session-launcher/NewSessionDialog" src/   # emerges from Plan 02
```

**CommandPalette.tsx import updates** (`src/ui/shell/CommandPalette.tsx` lines 9-19 as authored 2026-07-23):

```
Before:
  9: import { NewSessionDialog } from "@/dashboard/NewSessionDialog";
 10: import { sshHostToHost } from "@/dashboard/sshHostToHost";
 11-14: import { RemoteHostChips, isProtocolHost } from "@/dashboard/RemoteHostChips";
 15-19: import { NewSessionHostChips, isAutoTmuxHost, isSshLaunchableHost } from "@/dashboard/NewSessionHostChips";

After:
  9: import { NewSessionDialog } from "@/features/session-launcher/NewSessionDialog";
 10: import { sshHostToHost } from "@/features/session-launcher/sshHostToHost";
 11-14: import { RemoteHostChips, isProtocolHost } from "@/features/session-launcher/RemoteHostChips";
 15-19: import { NewSessionHostChips, isAutoTmuxHost, isSshLaunchableHost } from "@/features/session-launcher/NewSessionHostChips";
```

**SessionsPanel.tsx** (`src/ui/sidebar/SessionsPanel.tsx:7`) also imports from `@/dashboard/sshHostToHost` — but SessionsPanel dies in Section A (Plan 03). Ordering options:

- **(a)** Plan 03 lands SessionsPanel deletion BEFORE Plan 02 lands the relocate — then no import update needed (the consumer is gone).
- **(b)** Plan 02 updates SessionsPanel.tsx line 7 too as part of the relocate commit — then Plan 03 later `git rm`s SessionsPanel.
- **(c)** Update SessionsPanel line 7 in the same commit that also `git rm`s it (Plan 03's leaf sweep).

**Recommendation:** option (a) — Plan 03's Section-A leaf sweep lands FIRST for the low-risk simple leaves (SessionsPanel is one of them). Then Plan 02's relocate lands. Then Plan 04's dashboard subtree deletion lands.

**SessionDashboard.tsx** (`src/ui/dashboard/SessionDashboard.tsx` — a Section E deletion target) imports all 4 of the relocate donors internally. This is IRRELEVANT because SessionDashboard dies as part of the dashboard/ subtree; the internal imports never see the relocated files — they simply disappear with their consumer.

**Internal cross-references between the 4 relocated files** — verify each after move:

```
$ grep -n "from \"@/dashboard" src/ui/features/session-launcher/
(expected zero — all internal refs use "./sibling" or relative)
```

Plan 02 commit message suggestion: `refactor(12-02): relocate CommandPalette-consumed dashboard files → features/session-launcher/ (Section I.2 pre-flight for dashboard/ deletion)`

### I.3 — Replace tabUtils.tsx `network_graph` render + strip NetworkGraphCard import

**Target file:** `src/ui/shell/tabUtils.tsx`.

**Import strip** at line 28:

```
Before:
 28: import { NetworkGraphCard } from "@/dashboard/cards/NetworkGraphCard";

After:
 28: (removed — NetworkGraphCard no longer imported)
```

**Render replacement** at lines 278-279:

```
Before:
278:    case "network_graph":
279:      return <NetworkGraphCard embedded={false} />;

After:
278:    case "network_graph":
279:      return <PrettyLandingCard />;
```

`PrettyLandingCard` is already imported at line 26 (Phase 11 landing swap). Same "delete not gate" pattern — the `case "network_graph"` render becomes the warm-glass idle card. The `network_graph` TabType stays in `src/types/ui-types.ts:162` + line 234 as an unused-but-safe union member; Phase 13 may audit and strip.

**Icon case at lines 113-114** (`tabIcon` function):

```
Before:
113:    case "network_graph":
114:      return <Network className="size-3.5" />;
```

**KEEP** — the Network icon is a lucide-react import (line 7) already present, does not reach `dashboard/`. If Phase 13 strips the `network_graph` TabType, this case dies naturally.

Post-refactor verification:

```
$ grep -n "NetworkGraphCard" src/ui/shell/tabUtils.tsx
(zero hits)

$ grep -n "network_graph" src/ui/shell/tabUtils.tsx
113:    case "network_graph":
278:    case "network_graph":
```

Plan 02 commit message suggestion: `refactor(12-02): replace tabUtils.tsx network_graph render with PrettyLandingCard (Section I.3 pre-flight for dashboard/cards deletion)`

### I.4 — Plan 02 commit ordering (recommended)

1. **Commit I.1** — Inline `isFolder` into NewSessionDialog.
2. **Commit I.2** — Create `src/ui/features/session-launcher/`, move 4 files, update CommandPalette imports.
3. **Commit I.3** — Replace tabUtils.tsx `network_graph` render + strip NetworkGraphCard import.

All three commits are tsc-clean, vitest-clean.

---

## Section J: Retained-UI protection list

**Every file below MUST NOT be touched by any Phase 12 plan.** One-line rationale per file. If a downstream plan's action would modify one of these files (beyond the surgical touches enumerated in Section I), the executor MUST route back to the planner.

### J.1 — Retained feature subtrees (whole directories)

- **`src/ui/features/pretty-conversations/**`** — retained visible list surface; NewSessionDialog pencil consumer lives here at `PrettyConversationsPanel.tsx:56` (imports `sidebar/NewSessionDialog`).
- **`src/ui/features/pretty-view/**`** — retained visible chat surface; `PrettyLandingCard.tsx` lives here (Phase 11 landing card + Section I.3 replacement target for tabUtils.tsx `network_graph` case).
- **`src/ui/features/terminal/**`** — retained tmux terminal renderer; `Terminal.tsx` consumes `features/keyboard/{Toolbar,sshAdapter,inputAdapter}`.
- **`src/ui/features/guacamole/**`** — retained RDP/VNC surface; `GuacamoleApp.tsx` consumes `features/keyboard/{Toolbar,guacamoleAdapter}`.
- **`src/ui/features/keyboard/**`** — on-screen modifier bar for Terminal + Guacamole (NOT the shortcut editor UI — see Section G.1). 5 files: `Toolbar.tsx`, `sshAdapter.ts`, `sshAdapter.test.ts`, `guacamoleAdapter.ts`, `inputAdapter.ts`. Every file has a live Terminal.tsx or GuacamoleApp.tsx consumer per Section G.1 grep.
- **`src/ui/features/file-manager/**`, `src/ui/features/server-stats/**`, `src/ui/features/docker/**`, `src/ui/features/tunnel/**`, `src/ui/features/sessions/**`** — retained tab renderers behind TabType. `tabUtils.tsx` renderTabContent switch consumes each.

### J.2 — FullScreenAppWrapper (cross-cutting concern — flagged for Plan 04 executor)

- **`src/ui/features/FullScreenAppWrapper.tsx`** — retained wrapper consumed by ServerStatsApp, TunnelApp, DockerApp, GuacamoleApp, FileManagerApp, TerminalApp. **BUT** imports `Dashboard` from `@/dashboard/Dashboard.tsx` at line 7 — see Section E "FullScreenAppWrapper → Dashboard chain" for the (a)/(b)/(c) resolution options. Plan 04 executor's decision surface, not a hard-protection listing.

### J.3 — Retained shell files

- **`src/ui/shell/CommandPalette.tsx`** — retained double-shift fleet search. Section I.2 updates its imports (dashboard → features/session-launcher); Section I.2 is a surgical touch, not a scope-fence violation.
- **`src/ui/shell/TabContext.tsx`** — retained tab-state provider consumed by CommandHistoryProvider + retained tab renderers. Uses `nav.home`, `nav.terminal`, `nav.serverStats`, `nav.fileManager`, `nav.docker`, `nav.tunnels`, `nav.hostTabTitle` locale keys — all keys stay per Section H.
- **`src/ui/shell/SplitView.tsx`** — retained split-view mechanism used by AppShell.
- **`src/ui/shell/tabUtils.tsx`** — retained tab render dispatcher. Section I.3 updates the `network_graph` case + strips the `NetworkGraphCard` import; a surgical touch.

### J.4 — CRITICALLY PROTECTED (deletion would break TG-09 new-session flow)

- **`src/ui/sidebar/NewSessionDialog.tsx`** — RETAINED. Consumed by:
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:56` (pencil button imports `NewSessionDialog`).
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:417` (JSX mount inside the panel).
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx:422` (Test 5: pencil opens dialog).
  - `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx:35` (fixture reference).

  **File collision guard:** the DASHBOARD version at `src/ui/dashboard/NewSessionDialog.tsx` is a DIFFERENT file (dies in Section E after Plan 02 §I.2 relocates it). Section K includes explicit `grep -rn "sidebar/NewSessionDialog" src/` expecting >0 code hits and `grep -rn "dashboard/NewSessionDialog" src/` expecting 0.

  Plan 02 §I.1 touches this file (inlines `isFolder` — surgical touch, not deletion).

- **`src/ui/sidebar/NewSessionDialog.test.tsx`** — RETAINED test file (400 lines, 8 describe blocks) for the retained NewSessionDialog. Any deletion action targeting this file is a scope-fence violation.

### J.5 — Retained shell + type surface

- **`src/ui/AppShell.tsx`** — retained shell. Plan 03 Task 1 tears out the `commandPaletteShortcutEnabled` reader (lines 282-286, 343 gate clause, 350 effect dep, 352-363 storage-event listener) per Section G.4. NO other touches allowed by any deletion plan in Phase 12. `nav.close`, `nav.cancel`, `nav.confirmClose` locale keys AT AppShell.tsx:1127, 1130, 1134 stay per Section H.
- **`src/types/ui-types.ts`** — the `dashboard` TabType at line 150 + line 234 STAYS (Phase 11 load-bearing decision — Section E note). `network_graph`, `host-manager`, `user-profile`, `admin-settings` TabTypes STAY (tabUtils.tsx switch cases still reference them; deletion candidate for Phase 13 audit).

### J.6 — Retained backend (Phase 13 territory)

- **`src/backend/**`** — Phase 13 owns route cleanup. If a Phase 12 plan notices a backend route becomes obviously dead (e.g., `/admin/*` endpoints whose only frontend caller was AdminSettingsPanel), record the observation in the plan's SUMMARY.md deferred-items section for Phase 13. Zero backend edits.

---

## Section K: Verification gates (Plan 07 input contract)

Every gate below is a shell one-liner Plan 07 runs at the phase boundary. Expected values are asserted; any mismatch is a Phase-12 failure surface.

### K.1 — File-existence gates

```bash
# Sidebar simple-leaf deletions (Section A)
for f in HostsPanel SessionsPanel CredentialsPanel QuickConnectPanel SshToolsPanel \
         SnippetsPanel HistoryPanel SplitScreenPanel ConnectionsPanel UserProfilePanel; do
  test ! -f "src/ui/sidebar/$f.tsx" && echo "PASS: $f.tsx deleted" || echo "FAIL: $f.tsx still present"
done

# Admin subtree (Section B)
for f in AdminSettingsPanel AdminApiKeysSection AdminIdentitiesSection \
         AdminManagementSections AdminSettingsSections AdminSettingsShared AdminUserDialogs; do
  test ! -f "src/ui/sidebar/$f.tsx" && echo "PASS" || echo "FAIL: $f.tsx still present"
done

# HostManager subtree (Section C)
for f in HostManager.tsx HostManagerData.ts HostManagerTabs.tsx HostShareModal.tsx \
         HostEditor.tsx HostEditorData.ts HostEditorFeatureTabs.tsx \
         HostEditorGeneralTab.tsx HostEditorGuacamoleTabs.tsx HostEditorStatsTab.tsx \
         HostCredentialList.tsx CredentialEditorView.tsx; do
  test ! -f "src/ui/sidebar/$f" && echo "PASS" || echo "FAIL: $f still present"
done

# SidebarTree (Section D)
test ! -f src/ui/sidebar/SidebarTree.tsx && echo "PASS: SidebarTree deleted" || echo "FAIL"

# Dashboard subtree (Section E)
find src/ui/dashboard -type f | wc -l    # expected 0 (or documented Phase-13-deferred count)

# Skynet tab bar chrome (Section F)
test ! -f src/ui/shell/Tab.tsx && echo "PASS: shell/Tab.tsx deleted" || echo "FAIL"

# PROTECTED files (Section J)
test -f src/ui/sidebar/NewSessionDialog.tsx && echo "PASS: sidebar/NewSessionDialog PROTECTED" || echo "FAIL: BREAKS TG-09"
test -f src/ui/sidebar/NewSessionDialog.test.tsx && echo "PASS: test file PROTECTED" || echo "FAIL"
test -d src/ui/features/keyboard && echo "PASS: features/keyboard PROTECTED" || echo "FAIL: BREAKS Terminal + Guacamole"
test -f src/ui/features/keyboard/Toolbar.tsx && echo "PASS" || echo "FAIL"
test -f src/ui/features/keyboard/sshAdapter.ts && echo "PASS" || echo "FAIL"
test -f src/ui/features/keyboard/guacamoleAdapter.ts && echo "PASS" || echo "FAIL"
test -f src/ui/features/keyboard/inputAdapter.ts && echo "PASS" || echo "FAIL"

# Pre-flight relocate targets (Section I.2)
test -f src/ui/features/session-launcher/NewSessionDialog.tsx && echo "PASS: relocated" || echo "FAIL"
test -f src/ui/features/session-launcher/sshHostToHost.ts && echo "PASS: relocated" || echo "FAIL"
test -f src/ui/features/session-launcher/RemoteHostChips.tsx && echo "PASS: relocated" || echo "FAIL"
test -f src/ui/features/session-launcher/NewSessionHostChips.tsx && echo "PASS: relocated" || echo "FAIL"
```

### K.2 — Identifier grep gates (non-comment code hits)

```bash
# Sidebar panels — zero code hits (Section A)
grep -rn "HostsPanel\|SessionsPanel\|CredentialsPanel\|QuickConnectPanel\|SshToolsPanel\|SnippetsPanel\|HistoryPanel\|SplitScreenPanel\|ConnectionsPanel\|UserProfilePanel" \
  src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | grep -v "^[^:]*:[[:space:]]*\*" | wc -l    # expected 0

# Admin subtree — zero code hits (Section B)
grep -rn "AdminSettingsPanel\|AdminApiKeysSection\|AdminIdentitiesSection\|AdminManagementSections\|AdminSettingsSections\|AdminSettingsShared\|AdminUserDialogs" \
  src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | grep -v "^[^:]*:[[:space:]]*\*" | wc -l    # expected 0

# HostManager subtree — zero code hits (Section C)
grep -rn "HostManager\|HostEditor\|HostShareModal\|HostCredentialList\|CredentialEditorView" \
  src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | grep -v "^[^:]*:[[:space:]]*\*" | wc -l    # expected 0

# SidebarTree — zero code hits (Section D)
grep -rn "SidebarTree\b" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | wc -l    # expected 0

# Dashboard files — zero code hits (Section E)
grep -rn "DashboardTab\|SessionDashboard\|NewSessionHostChips\|RemoteHostChips\|NetworkGraphCard\|ServerOverviewCard\|ServerStatsCard\|RecentActivityCard\|QuickActionsCard\|DashboardSettingsDialog\|useDashboardPreferences\|UpdateLog\|AlertCard\|AlertManager" \
  src/ --include="*.ts" --include="*.tsx" | grep -v "^src/ui/features/session-launcher/" \
  | grep -v "^[^:]*:[[:space:]]*//" | wc -l    # expected 0
# NOTE: `Dashboard` alone would false-positive on FullScreenAppWrapper if option (b) leaves a `PrettyLandingCard` comment; Plan 07 executor greps carefully.

# Dashboard imports from retained UI — zero hits (Section E consumer scrub)
grep -rn "from.*\"@/dashboard/" src/ --include="*.ts" --include="*.tsx" | wc -l    # expected 0

# NewSessionDialog PROTECTED (Section J)
grep -rn "sidebar/NewSessionDialog" src/ | grep -v "\.md$" | wc -l    # expected >0 (currently 4-5 hits)

# Keyboard subtree PROTECTED (Section J)
grep -rn "features/keyboard/Toolbar\|features/keyboard/sshAdapter\|features/keyboard/guacamoleAdapter\|features/keyboard/inputAdapter" \
  src/ --include="*.ts" --include="*.tsx" | wc -l    # expected >=5 (Terminal + Guacamole consumers)

# PURGE-09 delivery gate (Section G) — writer + reader both retired
grep -rn "commandPaletteShortcutEnabled" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | grep -v "^[^:]*:[[:space:]]*\*" | wc -l    # expected 0
grep -rn "commandPaletteShortcutEnabledChanged" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "^[^:]*:[[:space:]]*//" | grep -v "^[^:]*:[[:space:]]*\*" | wc -l    # expected 0

# Double-shift path preservation (guards against G.4 surgery over-removing)
grep -cE "lastShiftTime" src/ui/AppShell.tsx    # expected >=2 (declaration + comparison)
```

### K.3 — Locale key gates (per Section H)

For each removed locale key (batch-0 + batch-1 + batch-2):

```bash
# JSON residence gate — key must be absent from every locale file
for key in pinAppRail pinAppRailDesc; do
  grep -rn "\"$key\"" src/ui/locales/en.json src/ui/locales/translated/*.json | wc -l   # expected 0
done

for key in dashboard hosts snippets credentials history hostManager sessions connections \
           quickConnect sshTools networkGraph conversations refreshTab roleAdministrator roleUser; do
  grep -rn "\"$key\":" src/ui/locales/en.json src/ui/locales/translated/*.json | wc -l   # expected 0
done

for key in admin userProfile splitScreen cannotSplitTab openFileManager sshManager \
           noPasswordAvailable copyPassword copySudoPassword passwordCopied failedToCopyPassword; do
  grep -rn "\"$key\":" src/ui/locales/en.json src/ui/locales/translated/*.json | wc -l   # expected 0
done

# Code-consumer gate — no source file references the removed keys
for key in nav.dashboard nav.hosts nav.snippets nav.credentials nav.history nav.hostManager \
           nav.sessions nav.connections nav.quickConnect nav.sshTools nav.networkGraph \
           nav.conversations nav.refreshTab nav.roleAdministrator nav.roleUser \
           nav.admin nav.userProfile nav.splitScreen nav.cannotSplitTab nav.openFileManager \
           nav.sshManager nav.noPasswordAvailable nav.copyPassword nav.copySudoPassword \
           nav.passwordCopied nav.failedToCopyPassword; do
  grep -rn "t(\"$key\"\|t('$key'" src/ --include="*.ts" --include="*.tsx" | wc -l   # expected 0
done
```

### K.4 — Toolchain gates

```bash
npx tsc --noEmit     # expected exit 0

npx vitest run       # expected: Phase 11 baseline (524/526 or better).
                     # The 2 pre-existing ComposeBox failures ARE inherited baseline, not new.
                     # Phase 12 may drop tests IFF a test file's target component is deleted
                     # (e.g., no known Phase 12 test deletions — sidebar panels have no test siblings per Section A table).

npm run build        # expected exit 0
```

### K.5 — Bundle-size headline (informational)

```bash
# Bundle-size baseline: Phase 11 AppShell chunk = 75.43 kB (per 11-04-SUMMARY.md).
# Phase 12 expected further shrink from Rolldown code-splitting graph reduction as
# now-fully-deleted dashboard/ + sidebar panels + shell/Tab.tsx + Admin* + HostManager*
# subtree files no longer contribute to the async-chunk graph.

npm run build 2>&1 | tee /tmp/phase12-build.log
grep -E "AppShell" /tmp/phase12-build.log    # capture size delta vs 75.43 kB baseline
```

Modest additional bundle shrink expected. Not a fail gate — informational for Ashley's UAT review.

---

## Cross-plan hand-off summary

| Plan | Input contract from this document | Output |
|------|-----------------------------------|--------|
| **Plan 02 (pre-flight refactor)** | Section I (3 refactors: inline isFolder, relocate 4 files to features/session-launcher/, replace tabUtils.tsx network_graph render) + Section J (retained-UI graph — DO NOT MODIFY) | isFolder inlined; 4 session-launcher files at new location; tabUtils.tsx no longer imports NetworkGraphCard. tsc-clean per commit. |
| **Plan 03 (sidebar + PURGE-09)** | Sections A + B + C + D + G (writer+reader retire) + Section J (protection) | 10 sidebar simple leaves + 7 Admin subtree + 12 HostManager subtree + SidebarTree deleted; AppShell.tsx `commandPaletteShortcutEnabled` reader half retired in same commit as UserProfilePanel deletion (PURGE-09 delivered). tsc-clean per commit. |
| **Plan 04 (dashboard/)** | Section E (17-file subtree + FullScreenAppWrapper resolution options) | `src/ui/dashboard/` empty (or documented Phase-13-deferred). FullScreenAppWrapper resolved per (a)/(b)/(c). tsc-clean. |
| **Plan 05 (tab bar chrome)** | Section F (shell/Tab.tsx orphan status) | `src/ui/shell/Tab.tsx` deleted. tsc-clean. |
| **Plan 06 (locale strip)** | Section H (batch-0 + batch-1 + batch-2 key groupings + retained-key list) | ~30 locale keys removed from 35 JSON files across 3 atomic commits. tsc-clean per commit (react-i18next TFunction generics are the safety net). |
| **Plan 07 (verify)** | Section K (file-existence + identifier grep + locale key + toolchain gates) | Phase-boundary verdict + human-UAT input. |

*Enumeration pass complete. This document is the authoritative deletion-target contract for Plans 02-06 and the phase-boundary verification-gate list for Plan 07. Zero source-tree modifications made during authoring.*
