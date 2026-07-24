# Phase 12: Skynet transformation — purge dead frontend surfaces (second slice) — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Synthesized directly from Tina's bounty `skynet-transformation-purge-dead-surfaces` + tina.md § Skynet direction + Phase 11's shipped strip-list. Ashley 2026-07-23 authorized Phase 12 planning immediately after Phase 11 code-complete verification. Scope split from a plausible larger phase: this phase does frontend deletion only; backend routes serving now-dead UI become Phase 13 (different blast radius — needs live API/WS testing). **The scope is not to be re-litigated; the planner's job is HOW to enumerate + delete safely, not WHAT to delete.**

<domain>
## Phase Boundary

Phase 12 is the **second slice** of the multi-phase Ship-of-Theseus purge (Phase 11 = first slice; Phase 13 = backend routes if needed). Where Phase 11 stripped AppShell imports and deleted the 2 files directly mounted (AppRail + SettingsRow), Phase 12 deletes the ~30+ orphan files those imports pointed at, plus the transitive-orphan subtrees, plus dead locale strings.

This phase's slice covers:

1. **Sidebar panel file deletion.** All `src/ui/sidebar/*Panel.tsx` files that Phase 11 stripped imports of (HostsPanel, SessionsPanel, CredentialsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, ConnectionsPanel, UserProfilePanel, AdminSettingsPanel) plus the transitive-orphan sections files (AdminApiKeysSection, AdminIdentitiesSection, AdminManagementSections, AdminSettingsSections, AdminSettingsShared, AdminUserDialogs) plus the HostManager subtree (HostManager, HostManagerData, HostManagerTabs, HostShareModal, HostEditor + HostEditorData/FeatureTabs/GeneralTab/GuacamoleTabs/StatsTab, HostCredentialList, CredentialEditorView) plus SidebarTree. **KEEP**: `sidebar/NewSessionDialog.tsx` (used by pretty-conversations pencil button in the header) and anything it imports.
2. **Dashboard subtree deletion.** `src/ui/dashboard/` — DashboardTab.tsx (dead per Phase 11), Dashboard.tsx, SessionDashboard.tsx, NewSessionHostChips.tsx, RemoteHostChips.tsx, sshHostToHost.ts, plus its cards/components/hooks/panels/ subdirs. The "dashboard" TabType STAYS in `src/types/ui-types.ts` (Phase 11 preserved it as load-bearing for URL restore / synthetic fallback).
3. **Skynet tab bar chrome.** The top-level visible tab strip UI (whatever file is the visible chrome of the tab strip Ashley sees at the top of Skynet today but doesn't see in Skynet). The invisible tab plumbing — mount/unmount, WebSocket lifecycle, focus routing, `TabType` machinery — is untouched.
4. **Keyboard shortcut editor UI.** The visible editor surface under `src/ui/features/keyboard/` — whatever renders the "customize keyboard shortcuts" UI. The underlying keyboard shortcut handling for retained UI (Ctrl+Shift+O pretty-view toggle, ChordDropdown mechanics, other retained shortcuts) is preserved.
5. **Dead locale strings.** Across all ~34 `src/ui/locales/*.json` files: `pinAppRail` (from Phase 11 STRIP-LIST Section B item 7), `nav.dashboard`, `nav.hosts`, `nav.snippets`, `nav.admin`, `nav.credentials`, `nav.history`, and any transitively-dead key referencing deleted surfaces (planner enumerates via grep).

Phase 12 does NOT touch:

- **Backend routes, encrypted-SQLite schema, docker/caddy/nginx config.** All Phase 13 territory. This phase deletes UI only. If a backend route becomes obviously dead as a knock-on (e.g., an endpoint whose only frontend caller was the deleted HostManager UI), leave a note in the SUMMARY for Phase 13 planning, but do NOT delete backend code in this phase.
- **The "dashboard" TabType.** Load-bearing for URL restore + synthetic fallback per Phase 11's preservation decision. The FILE goes; the TYPE stays.
- **`sidebar/NewSessionDialog.tsx` and its dependency tree.** Used by pretty-conversations pencil.
- **`src/ui/features/pretty-view/` and `src/ui/features/pretty-conversations/`.** Retained UI, untouched.
- **`src/ui/features/terminal/`, `src/ui/features/guacamole/`.** Invisible-shell technical capability, untouched.
- **Any code the retained UI still imports.** If a util or hook in `src/ui/lib/` or `src/ui/hooks/` is imported ONLY by dead surfaces, it can be deleted; if it's also imported by retained UI, it stays. Grep-verify per file.
- **Test files for retained code.** Only delete test files for files being deleted (e.g., `HostManager.test.tsx` goes with `HostManager.tsx`).

</domain>

<decisions>
## Implementation Decisions

All items below are **LOCKED** by the bounty + tina.md § Skynet direction + Phase 11's shipped precedent — do NOT re-open them during planning.

### Enumeration-first plan pattern (mirror Phase 11 Plan 01)

- **Plan 12-01 is the enumeration pass** — a read-only audit that produces `12-01-STRIP-LIST.md` listing every deletion target grouped by category (sidebar panels, admin sections, HostManager subtree, dashboard subtree, tab bar chrome, shortcut editor UI, locale strings). Each target gets: (a) file path, (b) grep hit count for its identifier across `src/` (must be 0 for safe deletion), (c) confirmation it's not imported by pretty-view / pretty-conversations / terminal / guacamole / backend, (d) transitive-orphan analysis (files this file imports that become orphans post-deletion). No source edits in Plan 01 — doc-only commit, identical shape to Phase 11's Plan 01.
- **Subsequent plans consume the STRIP-LIST verbatim.** If Plan 02's deletion target isn't in the strip-list, that's a scope-fence violation — same discipline Phase 11 enforced.

### Atomic-commit ordering

- **One atomic commit per coherent deletion unit.** Guideline: one commit per subtree (e.g., "delete HostManager subtree" = one commit that removes HostManager + HostManagerData + HostManagerTabs + HostShareModal + HostEditor + Editor* + HostCredentialList + CredentialEditorView all at once, with grep-verified zero-import gate). Individual leaf files (one panel with no transitive dependencies) get their own commit.
- **Tsc-clean per commit.** If a deletion breaks tsc, the commit is wrong — fix in the same commit before landing. Broken intermediate state ships nothing.
- **Vitest per commit.** After each deletion commit, `npx vitest run` should be all-green (or match Phase 11's 2-baseline ComposeBox drift). If a test file referenced a deleted component, the test file goes with it in the same commit.
- **Deletion order matters for shared-import subtrees.** If File A imports from File B, and both are being deleted, delete A before B (or delete both in the same commit — the tsc-clean requirement forces this).

### Grep verification pattern

- **Pre-deletion grep gate:** `grep -rn "<identifier>" src/ --include="*.ts" --include="*.tsx"` returns 0 code hits (comments per Phase 10 Wave 4 policy = acceptable historical annotations).
- **Post-deletion grep gate:** re-run same grep, confirm still 0. Prevents the "we didn't delete the file we thought we deleted" failure mode.
- **Cross-file grep for transitive orphans:** after deleting the primary file, grep for identifiers used only within the deleted subtree — those files are now orphans and eligible for deletion in the same commit.

### Locale string deletion

- **One commit per removed key set.** Group `pinAppRail` + `nav.dashboard` + `nav.hosts` + `nav.snippets` + `nav.admin` + related nav.* keys as one atomic locale-strip commit (they were part of the same AppRail-driven nav surface).
- **Tsc-clean is the safety net.** Skynet uses typed i18n (the react-i18next TFunction generics resolve keys at compile time). If a consumer still uses a removed key, tsc fails — that's the load-bearing gate that no consumer was missed. Do NOT skip the tsc check per commit.
- **Across all ~34 JSON files simultaneously.** The `src/ui/locales/` directory has one JSON per language; every key removal touches every file. This is fine — one atomic multi-file commit.
- **Don't touch keys for retained UI.** Nav keys for pretty-conversations, pretty-view, terminal, RDP all stay.

### Skynet tab bar chrome (item 3) — identification

- **The visible chrome file is TBD until planner enumerates.** It's likely somewhere in `src/ui/shell/` (adjacent to `tabUtils.tsx`) or `src/ui/AppShell.tsx` (though Phase 11 didn't identify it). If it's already stripped from AppShell mount (Phase 11 stripped a lot), it's already dead and the FILE just needs deletion. If it's still mounted in AppShell, planner must strip the mount FIRST (same Phase 11 pattern — imports/mount before file).
- **What "tab bar chrome" means concretely:** the top-level tab-strip visible UI showing "which tab is active" via horizontal tabs at the top of the app. Skynet lands on the pretty-conversations panel with pretty-view chat + NO visible tab strip; tabs are managed via the conversation-list clicks instead. If Phase 11 didn't already retire the visible tab strip, Phase 12 does. If Phase 11 did, the enumeration confirms it and the file itself is deleted.

### Keyboard shortcut editor UI (item 4) — identification

- **The visible editor UI is TBD until planner enumerates.** Look under `src/ui/features/keyboard/` for a component named something like `KeyboardShortcutEditor.tsx` or `ShortcutsPage.tsx` — the surface Ashley never sees in Skynet. The underlying keyboard handling infrastructure (whatever registers Ctrl+Shift+O for pretty-view toggle, the ChordDropdown component) is retained.
- **If it's an unmounted-but-file-present situation** (Phase 11 stripped the AppShell mount already), just delete the file.
- **If it's still mounted somewhere,** the planner strips the mount first (dependency chain).

### Scope-fence discipline (Ashley's explicit lock)

- **Delete files rather than gate/hide them.** Ship-of-Theseus purge = wood is off the boat. No feature-flag hide, no CSS display:none.
- **Every deletion must have a proven zero-consumer grep BEFORE landing.** No "I think this is unused" — verify with grep first.
- **The retained-UI import graph is authoritative for what stays.** If pretty-conversations or pretty-view imports it, it stays, period.
- **NO backend edits.** Not `src/backend/**`, not `docker/**`, not `caddy/**`, not `nginx*`. Any backend cleanup is Phase 13 — mark those in the SUMMARY.
- **NO settings UI resurrected.** Ashley 2026-07-23: "we are not having settings at all." If the planner encounters a "we might need a settings pane for X" question, the answer is remove X (or move it to backend/env config) — never a UI.
- **Same landing behavior ships to both viewports.** No dual-mode ship.
- **Rebase risk HIGH — accept the divergence.** Same as Phase 11.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bounty + identity source-of-truth (authoritative)
- `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/bounty.json` — bounty premise; Phase 12+ todo enumeration; Ashley's UAT quote 2026-07-23.
- `~/.claude/identities/tina/tina.md` § Skynet direction — Ship of Theseus (dead-surfaces canonical list; palette authority `--color-pv-*`; "conversation list + pretty view is all Ashley sees" scope-decision heuristic; "no settings at all" lock; "it is ONE project, not a collection of bounties" fleet lock).

### Phase 11 shipped artifacts (this-phase's direct input)
- `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-STRIP-LIST.md` — Phase 11's enumeration pattern to mirror + Section G's explicit Phase 12+ deferrals (host manager UI, snippets, admin console, dashboard file itself, tab bar chrome, keyboard shortcut editor UI, dead pinAppRail locale strings).
- `.planning/phases/11-.../11-CONTEXT.md` — Phase 11's LOCKED decisions (same scope-fence discipline carries forward).
- `.planning/phases/11-.../11-01-SUMMARY.md` through `11-04-SUMMARY.md` — what Phase 11 shipped (AppShell surgery, PrettyLandingCard, dashboard TabType preservation, RDP preservation, 83% AppShell chunk shrink).
- `.planning/phases/11-.../11-VERIFICATION.md` — automated PASS verdict + 3 human UAT items pending.

### Retained-UI import graph (must NOT touch)
- `src/ui/features/pretty-view/**` — retained visible chat surface.
- `src/ui/features/pretty-conversations/**` — retained visible list surface.
- `src/ui/features/terminal/**` — retained tmux terminal renderer.
- `src/ui/features/guacamole/**` — retained RDP/VNC surface.
- `src/backend/**` — retained data + API layer (Phase 13 handles route cleanup).
- `src/ui/AppShell.tsx` — the shell that mounts the retained surfaces (Phase 11 already trimmed it; further changes only if a tab-bar-chrome or shortcut-editor mount is still there).

### AppShell + shell dir (enumeration entry point)
- `src/ui/AppShell.tsx` — the shell. Read to check for any residual tab-bar-chrome mount or shortcut-editor mount that survived Phase 11.
- `src/ui/shell/tabUtils.tsx` — tab utilities. May be adjacent to the tab bar chrome file.
- `src/ui/shell/` (whatever else is there) — enumerate.

### Requirements
- `.planning/REQUIREMENTS.md` § Dead-Surfaces Purge — Second Slice (Phase 12) — PURGE-06..PURGE-10.

### Fork operating baseline
- `~/.claude/identities/tina/box-map.md` — Skynet operational context.
- `~/.claude/identities/tina/deploy-runbook.md` — AUTHORITATIVE deploy policy (supersedes fork CLAUDE.md's stale 15-min deadman reference).
- `~/.claude/identities/tina/skynet-patches.md` — patch catalog through #137. Phase 12 patches will pick up from #139 (patch #138 = Phase 11).

</canonical_refs>

<specifics>
## Specific Ideas

- **Enumeration order (Plan 01):** Start with the sidebar panels since Phase 11's STRIP-LIST already named them. Then walk `src/ui/dashboard/` file by file. Then grep `src/ui/AppShell.tsx` for any residual mount of a "tabs" or "shortcut" or "keyboard editor" component (Phase 11 may have already stripped these — verify). Then walk `src/ui/features/keyboard/`. Then produce the locale strip list by grepping `pinAppRail` + `nav.dashboard` + related dead keys across `src/ui/locales/`.
- **Atomic-commit grouping suggestion (Plan 02+):** (a) sidebar panel simple leaves (HostsPanel, SessionsPanel, ..., UserProfilePanel — each is likely single-file with no transitive orphans if Phase 11 handled the AppRail-side imports); (b) AdminSettingsPanel subtree (AdminSettingsPanel + all Admin*Section + AdminUserDialogs — one commit); (c) HostManager subtree (HostManager + HostManagerData/Tabs + HostShareModal + HostEditor + Editor* + HostCredentialList + CredentialEditorView — one commit); (d) SidebarTree (verify orphaned, delete); (e) `src/ui/dashboard/` subtree (whole directory potentially — one commit); (f) tab bar chrome (if separate file); (g) keyboard shortcut editor (if separate file); (h) locale strings (all keys, all languages, one commit). Total ~6-8 code commits + summary. Planner may split further.
- **`sidebar/NewSessionDialog.tsx` protection:** Add an explicit grep gate to every plan: `grep -rn "sidebar/NewSessionDialog" src/` returns >0 (it's imported by pretty-conversations panel). If any deletion accidentally lands NewSessionDialog in scope, that's a BLOCKER.
- **Locale key discovery:** Use `grep -rn "\"nav\." src/ui/locales/en.json` to enumerate all nav.* keys, then check each for `grep -rn "t(\"nav.<key>\"" src/ --include="*.tsx" --include="*.ts"` — 0 consumers = safe to remove from all language files. Any key with a live consumer stays.
- **Bundle-size expectation:** Phase 11 shrank AppShell chunk 83% via import-stripping (code-splitting made deleted files async-chunk unreachable). Phase 12 removes those unreachable async chunks entirely. Modest bundle drop expected — the files were already de facto out of production; this removes them from the source tree.

</specifics>

<deferred>
## Deferred Ideas

- **Backend route cleanup.** In scope for Phase 13. Includes: `/host/db/*` endpoints that only served HostManager UI (if any — some also serve the pretty-conversations panel's host list), `/snippets/*` endpoints (fully dead), `/admin/*` endpoints (fully dead), any `/user/*` endpoints only used by UserProfilePanel. Phase 13's Plan 01 mirrors Phase 12's enumeration pattern: audit backend routes vs their frontend callers (pretty-conversations calls `/host/db/*` for the host list), enumerate dead routes, plan atomic deletion.
- **CLAUDE.md fork-update.** The `claude-md-15min-deadman-stale` bounty. Not in Phase 12 — Ashley should approve the CLAUDE.md content update separately (touches project onboarding, worth Ashley's eyes before landing).
- **Locale file structural cleanup.** After the dead-key strip, some language files may have orphan section headers or empty sub-objects. Cosmetic — deferred if it happens.
- **Any visual polish on retained UI** (bubble+badge refresh, ready-dot debugging, sidebar-scroll-padding) — separate bounties, all parked until purge completes.
- **Rebase against upstream Skynet.** Will be a manual pass at some point post-purge. Not this phase.

</deferred>

---

*Phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice*
*Context gathered: 2026-07-23 (no discuss-phase — synthesized from Phase 11 STRIP-LIST + tina.md + bounty)*
