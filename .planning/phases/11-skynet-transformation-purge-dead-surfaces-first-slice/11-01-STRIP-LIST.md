# Phase 11 Plan 01 — Strip-List

**Purpose:** Authoritative enumeration of every file, import, mount, and state-machine field slated for deletion in Plan 02 (landing-surface swap) and Plan 03 (AppRail + SettingsRow retirement).

**Contract:** Every claim is grep-verified against the working tree at HEAD `e753af9` on branch `feat/tab-title-from-tmux` on 2026-07-23. Line numbers are absolute in the cited files. Plans 02 and 03 consume this list as their deletion-target contract — nothing in Plan 03's deletion action is absent here; nothing here is expanded past its scope-fence.

**Grep evidence baseline (run at strip-list authoring):**

```
grep -rn "AppRail" src/ | grep -v "\.md$"
```
Yields (as of authoring): 6 lines in code — `src/ui/AppShell.tsx:20,21,1835`, `src/ui/sidebar/AppRail.tsx:115` (the file itself), `src/ui/sidebar/SettingsRow.tsx:42` (RailView type import), `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:24` (comment-only historical note in file header).

```
grep -rn "SettingsRow\|renderSettingsMenuItems" src/ | grep -v "\.md$"
```
Yields (as of authoring): 11 hits — 5 in `src/ui/sidebar/SettingsRow.tsx` (definition + internal references), 1 import + 1 mount + 3 comment-only history annotations in `src/ui/AppShell.tsx` (lines 83, 1439, 1432, 1832, 1895, 2056).

---

## Section A: Landing-surface swap targets (Plan 02 input)

Enumerate the exact code sites Plan 02 modifies:

1. **`src/ui/AppShell.tsx:180-188`** — initial `useState<Tab[]>` seed containing `{id:"dashboard", type:"dashboard", label: t("nav.dashboard"), ...}`. Plan 02 replaces the seed with an empty array `[]` OR replaces the "dashboard" tab type with a new "landing" type — enumerate BOTH options here; Plan 02 executor picks based on which minimizes knock-on effects to `effectiveSelectedTabId` (line 526-534), URL restore logic (line 780-830, particularly line 830's `hostlessTypes` reference), and closeTab fallback (line 1175 + 1181-1190).
2. **`src/ui/AppShell.tsx:189`** — `useState("dashboard")` for `activeTabId`. Consequence of the initial-tab decision above (if seed → empty, this defaults to empty string or first-restored-tab-id).
3. **`src/ui/AppShell.tsx:1175`** — `remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard"` fallback in `doCloseTab`.
4. **`src/ui/AppShell.tsx:1181-1190`** — the `if (next.length === 0) return [{id:"dashboard", type:"dashboard", label: t("nav.dashboard"), openedAt: Date.now()}]` synthetic-dashboard-tab creation in `doCloseTab`.
5. **`src/ui/AppShell.tsx:830`** — `const hostlessTypes: TabType[] = ["dashboard", "tunnel"]` in URL restore path — cited because it depends on the dashboard tab type being preserved as a valid `TabType` for restore. Plan 02 executor decides whether to keep or strip; if strip, ALSO remove `"dashboard"` from `src/types/ui-types.ts:150` (verified via `grep -n '"dashboard"' src/types/ui-types.ts` → single hit at line 150 inside the `TabType` union).
6. **`src/ui/shell/tabUtils.tsx:187-193`** — `case "dashboard": return <DashboardTab onOpenSingletonTab={onOpenSingletonTab!} onOpenTab={onOpenTab!} />` render site. Plan 02 replaces with a warm-glass empty-landing card scoped to `src/ui/features/pretty-view/` per palette authority (`--color-pv-*`) from CONTEXT.md `<decisions>` § Palette authority.
7. **`src/ui/shell/tabUtils.tsx:26`** — `import { DashboardTab } from "@/dashboard/DashboardTab"` — becomes unused when line 187-193 is replaced.
8. **`src/ui/shell/tabUtils.tsx:89-90`** — `case "dashboard": return <LayoutDashboard className="size-3.5" />` in `tabIcon` function. Plan 02 may keep this for TabType safety (if `"dashboard"` remains a valid TabType) or strip if the `"dashboard"` TabType is removed from the union in item 5 above. `LayoutDashboard` import at `tabUtils.tsx:5` becomes unused if this case is stripped.

**DEFERRED to Phase 12+ (do NOT list as Plan 02/03 deletion targets):**
- `src/ui/dashboard/DashboardTab.tsx`, `src/ui/dashboard/Dashboard.tsx`, `src/ui/dashboard/SessionDashboard.tsx`, `src/ui/dashboard/cards/**`, `src/ui/dashboard/panels/**` — file-tree deletion belongs to Phase 12+ per phase-scope-fence (`11-CONTEXT.md` `<deferred>`).

**Recommendation for Plan 02:** Create a new `src/ui/features/pretty-view/PrettyLandingCard.tsx` component (warm-glass idle card matching the pretty-conversations empty-state visual language, using `--color-pv-*` tokens per palette authority). Rendered inline in `tabUtils.tsx` where `case "dashboard"` used to render `<DashboardTab>`. This preserves the `"dashboard"` TabType as a load-bearing fallback in `effectiveSelectedTabId` / `closeTab` logic while removing every UI path to the Skynet dashboard component tree. This IS the "delete not gate" pattern applied minimally: the `<DashboardTab>` render site is REMOVED (the import too), a new landing card replaces it, `DashboardTab.tsx` becomes dead code slated for Phase 12+.

---

## Section B: AppRail deletion targets (Plan 03 input)

1. **File to delete: `src/ui/sidebar/AppRail.tsx`** (283 lines). Verified no test file exists at `src/ui/sidebar/AppRail.test.tsx`:
   ```
   $ ls src/ui/sidebar/AppRail*
   -rw-rw-r-- 1 ubuntu ubuntu 8829 Jul 21 02:09 src/ui/sidebar/AppRail.tsx
   ```
   (single file only — no `.test.tsx` sibling)
2. **Import to remove — `src/ui/AppShell.tsx:20`:** `import { AppRail } from "@/sidebar/AppRail";`
3. **Import to remove — `src/ui/AppShell.tsx:21`:** `import type { RailView } from "@/sidebar/AppRail";`
4. **Mount to remove — `src/ui/AppShell.tsx:1834-1847`:** the `{sidebarOpen && !isTouchDevice && <AppRail railView={railView} sidebarOpen={sidebarOpen} splitMode={splitMode} username={username} isAdmin={isAdmin} profileDropdownOpen={profileDropdownOpen} onProfileDropdownChange={setProfileDropdownOpen} onRailClick={handleRailClick} onOpenTab={openSingletonTab} onLogout={onLogout} />}` JSX block.
5. **Import to remove — `src/ui/sidebar/SettingsRow.tsx:42`:** `import type { RailView } from "@/sidebar/AppRail";` (becomes unused when SettingsRow itself is deleted per Section C, but if the executor chose to delete AppRail.tsx BEFORE SettingsRow.tsx in the commit sequence, this import would be a tsc-break in the intermediate state — mandating a single-commit deletion of both files, OR the SettingsRow deletion strictly before AppRail deletion).
6. **Grep-verification command Plan 03 must run POST-deletion:**
   ```
   grep -rn "AppRail" src/ | grep -v "\.md$" | grep -v "pinAppRail"
   ```
   **Expected result: zero hits in code files.** Comment-only reference at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:24` (`// AppRail on desktop.`) is out of scope — Plan 03 executor may strip this comment or leave it as history per Phase 10 Wave 4 precedent (10-04-SUMMARY.md decision: "Comment-only reference preservation policy").
7. **`pinAppRail` translation-string carve-out.** Enumerated for scope-fence honesty:
   ```
   $ grep -l 'pinAppRail' src/ui/locales/translated/*.json | wc -l
   34
   $ grep -rn "pinAppRail" src/ | grep -v "\.json$"
   (zero hits — no production code references)
   ```
   Every "pinAppRail" / "pinAppRailDesc" appears ONLY in locale JSON files. These are already-dead translation strings for an upstream Skynet "Pin App Rail" setting that no production code consumes today; they were dead before Phase 11. **Out of scope for Phase 11 — dead-string sweep is a follow-up hygiene task.** Do NOT delete these in Plan 03.

---

## Section C: SettingsRow deletion targets (Plan 03 input)

Ashley 2026-07-23 lock: *"we are not having settings at all — this is total, not partial"* means SettingsRow MUST die with AppRail.

1. **File to delete: `src/ui/sidebar/SettingsRow.tsx`** (198 lines). Verified no test file exists at `src/ui/sidebar/SettingsRow.test.tsx`:
   ```
   $ ls src/ui/sidebar/SettingsRow*
   -rw-rw-r-- 1 ubuntu ubuntu 6413 Jul 21 02:10 src/ui/sidebar/SettingsRow.tsx
   ```
   (single file only — no `.test.tsx` sibling)
2. **Import to remove — `src/ui/AppShell.tsx:83`:** `import { SettingsRow } from "@/sidebar/SettingsRow";`
3. **Mount to remove — `src/ui/AppShell.tsx:1437-1441`:** the `settingsRowSlot={isTouchDevice ? <SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} /> : undefined}` JSX prop-passing block on `PrettyConversationsPanel`. Plan 03 removes the entire `settingsRowSlot={...}` prop line (not just the `<SettingsRow>` inside — the slot itself dies with the prop per Section D).
4. **Comment-only history annotations** (Plan 03 executor may leave or strip per Phase 10 Wave 4 precedent):
   - `src/ui/AppShell.tsx:1432` — `// header (Plan 06-02). SettingsRow lives at the BOTTOM of the`
   - `src/ui/AppShell.tsx:1832` — `// mobile flow's SettingsRow (inside ConversationsPanel) is where`
   - `src/ui/AppShell.tsx:1895` — `// renders the same content (with the mobile SettingsRow slot filled`
   - `src/ui/AppShell.tsx:2056` — `// admin-settings) migrated to the SettingsRow component`
5. **Grep-verification command Plan 03 must run POST-deletion:**
   ```
   grep -rn "SettingsRow\|renderSettingsMenuItems" src/ | grep -v "\.md$"
   ```
   **Expected result: zero hits in code files.** Any surviving hits are comment-only from item 4 (executor decides retain vs. strip); if a non-comment hit surfaces, Plan 03 executor MUST route back to Plan 01 for re-audit.

---

## Section D: PrettyConversationsPanel `settingsRowSlot` prop deletion targets (Plan 03 input)

With SettingsRow gone, the `settingsRowSlot` prop on `PrettyConversationsPanel` is orphaned. Enumerate:

1. **Type field to remove — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:121`:** `settingsRowSlot?: ReactNode;` (inside the panel's props type — verified via `grep -n "settingsRowSlot" .../PrettyConversationsPanel.tsx` yielding line 121).
2. **Destructure field to remove — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:105`:** `settingsRowSlot,` (inside the destructuring at the top of the panel function signature).
3. **JSX render site to remove — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:418`:** `{settingsRowSlot}` (rendered at the bottom of the scroll region, inside the flat-list container).
4. **Test to prune — `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx:520-548`:** Test 11 `describe("PrettyConversationsPanel: mobile settings slot position", () => { ... })`. The entire `describe` block (lines 524-549 including the closing `});` on line 549) deletes. Header-comment index in the file's top-of-file comment (line 13: `//  11)  settingsRowSlot renders at BOTTOM of scroll region on mobile`) ALSO updates in the same commit — the 15-test enumeration in the file header comment drops line 11 (and Test 12-15 renumber to 11-14, or the plan preserves the numbering with a "12) — placeholder" note; executor decision, precedent from 10-04-SUMMARY.md is to renumber cleanly).
5. **`ReactNode` import** — grep confirms `ReactNode` is used EXCLUSIVELY for `settingsRowSlot`:
   ```
   $ grep -n "ReactNode" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
   43:import { useState, type ReactNode } from "react";
   121:  settingsRowSlot?: ReactNode;
   ```
   (2 hits total — one import, one usage.) Plan 03 strips `type ReactNode` from the import at line 43, leaving `import { useState } from "react";`.

**Comment-only strip candidates in the same file** (executor discretion, precedent = retain historical context):
- Line 18: `//                             (mobile settings live in settingsRowSlot`
- Line 23: `//     shadcn-free; settings surfaces via settingsRowSlot on mobile and the`
- Line 24: `//     AppRail on desktop.`

---

## Section E: Rail-view state machine + AppRail-only state deletion targets (Plan 03 input)

The `railView` state machine becomes dead once AppRail + SettingsRow are gone (nothing invokes `handleRailClick`, nothing sets `setRailView` other than dead-surface `openSingletonTab` branches). AppRail also owns a profile-dropdown open/close state field on the AppShell side that is fed to it as a prop pair and has no other consumer. Enumerate every field:

### E.1 — Rail-view state declaration
**`src/ui/AppShell.tsx:233`:** `const [railView, setRailView] = useState<RailView>("conversations");`

### E.2 — `profileDropdownOpen` (AppRail-only state, MUST strip alongside AppRail deletion)

**`src/ui/AppShell.tsx:234`:** `const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);`

**Grep-verified consumer analysis (2026-07-23 authoring):**

```
$ grep -rn 'profileDropdownOpen\|setProfileDropdownOpen' src/
src/ui/AppShell.tsx:234:  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
src/ui/AppShell.tsx:1841:            profileDropdownOpen={profileDropdownOpen}
src/ui/AppShell.tsx:1842:            onProfileDropdownChange={setProfileDropdownOpen}
src/ui/sidebar/AppRail.tsx:121:  profileDropdownOpen,
src/ui/sidebar/AppRail.tsx:132:  profileDropdownOpen: boolean;
src/ui/sidebar/AppRail.tsx:245:            open={profileDropdownOpen}
```

**Analysis (6 hits, all AppRail-only):**
- `src/ui/AppShell.tsx:234` — the useState declaration itself.
- `src/ui/AppShell.tsx:1841` — `profileDropdownOpen={profileDropdownOpen}` in the AppRail mount JSX (dies with the AppRail mount, per Section B item 4).
- `src/ui/AppShell.tsx:1842` — `onProfileDropdownChange={setProfileDropdownOpen}` in the AppRail mount JSX (dies with the AppRail mount).
- `src/ui/sidebar/AppRail.tsx:121` — destructure of `profileDropdownOpen` prop (dies when AppRail.tsx is deleted).
- `src/ui/sidebar/AppRail.tsx:132` — `profileDropdownOpen: boolean;` in AppRailProps type (dies with the file).
- `src/ui/sidebar/AppRail.tsx:245` — `open={profileDropdownOpen}` in the `<DropdownMenu>` JSX (dies with the file).

**Conclusion:** `profileDropdownOpen` is EXCLUSIVELY an AppRail-driven state. Zero surviving consumers exist post-AppRail-mount-removal — the useState declaration at line 234 becomes dead. **Plan 03 Task 1b strips line 234 (declaration) as part of Commit B alongside the other AppShell surgery.**

**Safety gate for Plan 03 Task 1b executor** (run POST-AppRail-mount-removal but PRE-line-234-deletion):

```
grep -rn 'profileDropdownOpen\|setProfileDropdownOpen' src/ | grep -v "^src/ui/sidebar/AppRail.tsx" | grep -v "^src/ui/AppShell.tsx:234:"
```

**Expected result: ZERO hits.** If ANY hit survives (a new live consumer discovered mid-revision that wasn't in this Plan 01 grep), the executor MUST NOT delete line 234 — instead:
1. Route back to Plan 01 to re-audit the new consumer.
2. Remove `profileDropdownOpen` from Plan 03's deletion action for this commit.
3. Document the surviving consumer in an updated strip-list section.

### E.3 — Rail-view label lookup
**`src/ui/AppShell.tsx:333-346`:** `const sidebarTitle: Record<RailView, string> = { ... };` (14 lines including the closing `}`). Becomes dead (no more RailView). When railView is stripped, `sidebarHeader` (see E.7) shows only the "Conversations" title.

### E.4 — Rail-click handler
**`src/ui/AppShell.tsx:1264-1272`:** `function handleRailClick(view: RailView) { if (railView === view && sidebarOpen) { setSidebarOpen(false); } else { if (view !== railView) setSidebarEditing(false); setRailView(view); setSidebarOpen(true); } }` — becomes dead (no caller once AppRail + SettingsRow + panel-branch strip completes).

### E.5 — Host-manager edit handler
**`src/ui/AppShell.tsx:1274-1282`:** `function editHostInManager(host: Host) { setSidebarOpen(true); setRailView("hosts"); setTimeout(() => { window.dispatchEvent(new CustomEvent("host-manager:edit-host", { detail: host.id })); }, 0); }` — becomes dead (its only consumer `<HostsPanel onEditHost={editHostInManager} />` at line 1549 is stripped along with the `{railView==="hosts"}` branch).

### E.6 — `openSingletonTab` disposition (unresolved-in-context ambiguity — Plan 03 Task 1b executor must re-grep and decide)

`openSingletonTab` is defined at `src/ui/AppShell.tsx:1095`. Grep at Plan 01 authoring time:

```
$ grep -rn "openSingletonTab" src/
src/ui/AppShell.tsx:1095:  const openSingletonTab = useCallback(
src/ui/AppShell.tsx:1096:    function openSingletonTab(type: TabType, pendingEvent?: string) {
src/ui/AppShell.tsx:1658:                openSingletonTab(record.tabType as TabType);
src/ui/AppShell.tsx:1844:            onOpenTab={openSingletonTab}
src/ui/AppShell.tsx:2037:                      openSingletonTab,
```

**Current call sites (5 hits, 3 caller-sites once definition + inner function-name are excluded):**
- Definition at 1095-1096.
- **1658 — `ConnectionsPanel` `onReopenTab` callback.** Dies when the `{railView === "connections"}` panel-branch is stripped in Task 1b (per Section E.8 item 11: ConnectionsPanel branch → dead).
- **1844 — AppRail `onOpenTab` prop.** Dies with the AppRail mount removal in Task 1b.
- **2037 — passed as 3rd arg to `renderTabContent(tab, openSingletonTab, openTab, closeTab, ...)`.** Consumed inside `tabUtils.tsx` `renderTabContent` — specifically the `case "dashboard"` block at line 187-193 which passes `onOpenSingletonTab!` to `<DashboardTab>`. Plan 02 REPLACES the `case "dashboard"` render with `<PrettyLandingCard/>` (a prop-less component per Section A recommendation). So AFTER Plan 02 lands, `onOpenSingletonTab` in tabUtils becomes an unused-but-optional prop.

**Disposition decision tree for Plan 03 Task 1b executor:**

Run this grep AFTER the AppRail mount + ConnectionsPanel panel-branch strip lands (BEFORE line-234 deletion / cleanup pass):

```
grep -rn "openSingletonTab" src/
```

**IF** the surviving hits are the definition (1095-1096) + the pass-through at 2037 + `tabUtils.tsx` prop signature (currently at `tabUtils.tsx:168`: `onOpenSingletonTab?: (type: TabType) => void`), AND `tabUtils.tsx` no longer invokes `onOpenSingletonTab` for any surviving TabType (verify by reading every `case` block in `renderTabContent` — post-Plan-02, only rdp/vnc/telnet/terminal/tunnel/files/docker/stats/network_graph/host-manager/user-profile/admin-settings render; NONE of them consume `onOpenSingletonTab` today — verified at `tabUtils.tsx` lines 186-284), **THEN** mark `openSingletonTab` + its pass-through at line 2037 + the `tabUtils.tsx` prop for strip in the SAME Commit B.

**IF** any live consumer surfaces mid-revision (URL-restore path, `deepLinkOpen`, an event handler, a re-introduced singleton-open path), **KEEP** the function with an inline comment `// load-bearing: <exact consumer file:line>` naming what still uses it. **Do NOT strip on suspicion.** This resolves the earlier fork ambiguity that noted `openSingletonTab` as "possibly dead."

### E.7 — Sidebar header (consumes `sidebarTitle[railView]`)

**`src/ui/AppShell.tsx:1691-1725`:** `const sidebarHeader = ( <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0"> <span className="flex-1 text-base font-bold tracking-tight text-foreground px-3 pl-12"> {sidebarTitle[railView]} </span> ... </div> );` — the header consumes `sidebarTitle[railView]` on line 1699. When `railView` + `sidebarTitle` are stripped, replace with a hardcoded i18n lookup: `t("nav.conversations.title", { defaultValue: "Conversations" })`.

(Note: the plan text at authoring time referenced this range as 1697-1725; verified actual `const sidebarHeader = (` opens at 1691. The strip-list's line-number citations are the authoritative source; the plan text drift is flagged.)

### E.8 — Sidebar panel content (11 `{railView === "X"}` conditionals)

**`src/ui/AppShell.tsx:1399-1687`** (verified: `const sidebarPanelContent = (` at line 1400, closing `);` at 1688): the `sidebarPanelContent` currently renders 11 sibling `{railView === "X"}` conditionals. Enumerate all 11 branches with line ranges:

| # | Branch | Line range | Panel | Post-Plan-03 disposition |
|---|--------|-----------|-------|--------------------------|
| 1 | `railView === "conversations"` | 1409-1539 | `<PrettyConversationsPanel/>` | **KEEP** — drop the `hidden` class toggle at 1410 since it's the only survivor; drop the outer `<div className="flex flex-col flex-1 min-h-0 ${... hidden}">` wrapper. |
| 2 | `railView === "hosts"` | 1541-1555 | `<HostsPanel/>` | DELETE |
| 3 | `railView === "credentials"` | 1557-1564 | `<CredentialsPanel/>` | DELETE |
| 4 | `railView === "quick-connect"` | 1566-1573 | `<QuickConnectPanel/>` | DELETE |
| 5 | `railView === "ssh-tools"` | 1575-1582 | `<SshToolsPanel/>` | DELETE |
| 6 | `railView === "snippets"` | 1584-1591 | `<SnippetsPanel/>` | DELETE |
| 7 | `railView === "history"` | 1593-1597 | `<HistoryPanel/>` | DELETE |
| 8 | `railView === "sessions"` | 1599-1608 | `<SessionsPanel/>` | DELETE |
| 9 | `railView === "split-screen"` | 1610-1621 | `<SplitScreenPanel/>` | DELETE |
| 10 | `railView === "connections"` | 1623-1669 | `<ConnectionsPanel/>` | DELETE |
| 11 | `railView === "user-profile"` | 1671-1680 | `<UserProfilePanel/>` | DELETE |
| 12 | `railView === "admin-settings" && isAdmin` | 1682-1686 | `<AdminSettingsPanel/>` | DELETE |

(Twelve conditionals total — 11 non-conversations + the conversations survivor. The plan brief said "11 sibling conditionals"; verified count is 12 total, 11 to delete.)

### E.9 — Eleven panel imports (become unused when their branches are stripped)

**Verified via `grep -n "^import " src/ui/AppShell.tsx`** — the 11 panel imports and their line numbers:

| # | Line | Import statement |
|---|------|------------------|
| 1 | 22 | `import { HostsPanel } from "@/sidebar/HostsPanel";` |
| 2 | 23 | `import { SessionsPanel } from "@/sidebar/SessionsPanel";` |
| 3 | 24 | `import { QuickConnectPanel } from "@/sidebar/QuickConnectPanel";` |
| 4 | 25 | `import { SshToolsPanel } from "@/sidebar/SshToolsPanel";` |
| 5 | 26 | `import { SnippetsPanel } from "@/sidebar/SnippetsPanel";` |
| 6 | 27 | `import { HistoryPanel } from "@/sidebar/HistoryPanel";` |
| 7 | 28 | `import { SplitScreenPanel } from "@/sidebar/SplitScreenPanel";` |
| 8 | 29 | `import { UserProfilePanel } from "@/sidebar/UserProfilePanel";` |
| 9 | 30 | `import { AdminSettingsPanel } from "@/sidebar/AdminSettingsPanel";` |
| 10 | 31 | `import { CredentialsPanel } from "@/sidebar/CredentialsPanel";` |
| 11 | 59 | `import { ConnectionsPanel } from "@/sidebar/ConnectionsPanel";` |

Plan 03 removes ALL 11 import lines. **The panel FILES themselves STAY on disk for Phase 12+ per scope-fence (Section G).**

---

## Section F: Verification gate (mandatory for BOTH Plan 02 and Plan 03)

Every deletion plan MUST close its atomic commit sequence with these gates. Paste the exact commands and their expected values into each plan's `<verify>` block:

```bash
# Plan 03 gates:
grep -rn "AppRail" src/ | grep -v "\.md$" | grep -v "pinAppRail" | wc -l
# Expected: 0 after Plan 03 (comment-only survivor at PrettyConversationsPanel.tsx:24 permitted per Section B item 6 policy; grep it out if the executor left the comment)

grep -rn "SettingsRow\|renderSettingsMenuItems" src/ | grep -v "\.md$" | wc -l
# Expected: 0 after Plan 03 (comment-only history annotations at AppShell.tsx:1432,1832,1895,2056 permitted; grep them out separately if left in place)

grep -rn "profileDropdownOpen\|setProfileDropdownOpen" src/ | grep -v "\.md$" | wc -l
# Expected: 0 after Plan 03 Task 1b + Task 4

grep -rn "railView\|handleRailClick\|sidebarTitle\|editHostInManager" src/ | grep -v "\.md$" | wc -l
# Expected: 0 after Plan 03 Task 1b (no rail-view state machine survives)

# Plan 02 gates:
grep -rn "DashboardTab" src/ | grep -v "\.md$" | grep -v "src/ui/dashboard/" | wc -l
# Expected: 0 outside src/ui/dashboard/ after Plan 02 (the dashboard/ tree itself stays for Phase 12+)

# Toolchain gates (both plans):
npx tsc --noEmit
# Expected exit 0

npx vitest run
# Expected: no NEW failures beyond the documented pre-existing 4 ComposeBox failures (deferred-items.md). Plan 03 also drops Test 11 in PrettyConversationsPanel.test.tsx per Section D item 4 — expect the test count to drop by 1.

npm run build
# Expected exit 0 (run once at the Plan 04 boundary, not per-commit)
```

---

## Section G: What is EXPLICITLY out of scope for Phase 11

Per `11-CONTEXT.md` `<deferred>`, mirror the exclusions here so the executor of Plans 02 + 03 has a bright line. If Plan 02 or Plan 03 encounters a stray reference to any file below and is tempted to delete it, the executor MUST route back to the planner instead of expanding scope.

**Sidebar panel files (Phase 12+):**
- `src/ui/sidebar/HostsPanel.tsx`
- `src/ui/sidebar/HostManager.tsx`
- `src/ui/sidebar/HostCredentialList.tsx`
- `src/ui/sidebar/HostEditor*.tsx` (any file matching this glob)
- `src/ui/sidebar/HostShareModal.tsx`
- `src/ui/sidebar/CredentialEditorView.tsx`
- `src/ui/sidebar/CredentialsPanel.tsx`
- `src/ui/sidebar/SessionsPanel.tsx`
- `src/ui/sidebar/SnippetsPanel.tsx`
- `src/ui/sidebar/SplitScreenPanel.tsx`
- `src/ui/sidebar/SshToolsPanel.tsx`
- `src/ui/sidebar/QuickConnectPanel.tsx`
- `src/ui/sidebar/HistoryPanel.tsx`
- `src/ui/sidebar/UserProfilePanel.tsx`
- `src/ui/sidebar/AdminSettingsPanel.tsx`
- `src/ui/sidebar/AdminApiKeysSection.tsx`
- `src/ui/sidebar/AdminIdentitiesSection.tsx`
- `src/ui/sidebar/AdminManagementSections.tsx`
- `src/ui/sidebar/AdminSettingsSections.tsx`
- `src/ui/sidebar/AdminSettingsShared.tsx`
- `src/ui/sidebar/AdminUserDialogs.tsx`
- `src/ui/sidebar/ConnectionsPanel.tsx`
- `src/ui/sidebar/SidebarTree.tsx`

**Dashboard component tree (Phase 12+):**
- `src/ui/dashboard/**` — every file. The dashboard TabType and rendering-case will be stripped in Plan 02 (Section A) but the file tree itself stays on disk as dead code.

**Backend + data layer (untouched per PURGE-04):**
- `/host/db/*` routes.
- `/identities/*` routes.
- Encrypted-SQLite data layer + skynet-data volume + migrations.

**Terminal + protocol panes (untouched per PURGE-05):**
- Terminal (xterm.js) renderer, tab plumbing, WebSocket lifecycle.
- RDP / VNC / Telnet / Guacamole panes.
- Pretty-view session-file tail internals.

**Locale JSON `pinAppRail` strings (out of scope):**
- 34 locale files carry `pinAppRail` + `pinAppRailDesc` translation strings — see Section B item 7. These are dead upstream-Skynet carryovers, already unused pre-Phase-11. A dead-string sweep is a follow-up hygiene task, NOT part of Plans 02/03.

---

## Cross-plan hand-off summary

| Plan | Input contract from this document | Output |
|------|-----------------------------------|--------|
| **Plan 02 (landing-surface swap)** | Section A (8 code-site targets, TabType safety notes, `PrettyLandingCard` recommendation) | Dashboard render path replaced with warm-glass landing card; `<DashboardTab>` import + case stripped from `tabUtils.tsx`; `--color-pv-*` palette respected. |
| **Plan 03 (AppRail + SettingsRow + rail-view state retirement)** | Sections B + C + D + E (files to delete, imports to strip, state fields to drop, `settingsRowSlot` prop cascade, 11 panel imports, disposition protocols for `profileDropdownOpen` and `openSingletonTab`) | AppRail.tsx + SettingsRow.tsx removed from disk; every AppShell mount + import + state field consuming them stripped; PrettyConversationsPanel's orphan prop removed; Test 11 pruned. |
| **Both plans** | Section F verification gates | tsc-clean, vitest-clean (minus the documented Test 11 drop), and grep-verified zero surviving references at Plan 04 boundary. |
| **Neither plan** | Section G scope-fence | Everything listed in Section G stays untouched — Phase 12+ owns those deletions. |

*Enumeration pass complete. This document is the authoritative deletion-target contract for Plans 02 and 03.*
