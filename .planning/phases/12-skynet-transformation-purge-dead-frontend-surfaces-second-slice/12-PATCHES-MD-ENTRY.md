# Patch #139 — Skynet transformation: purge dead frontend surfaces (second slice) — Phase 12

**Paste target:** `~/.claude/identities/tina/termix-patches.md`
**Paste timing:** Only after Ashley greenlights the batched Phase 11 + Phase 12 purge cluster deploy AND UAT passes on the 23 non-negotiable items in `12-UAT-CHECKLIST.md`. Post-deadman-retirement flow per current `~/.claude/identities/tina/deploy-runbook.md` (the 15-min deadman regime was retired 2026-07-21).
**Batch context:** Patch #139 is the SECOND Phase-12-cluster patch (patch #138 = Phase 11 first slice; #139 = this Phase 12 second slice). Per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23), it does NOT ship standalone. Batches with patch #138 (Phase 11) and any subsequent Phase 13+ backend-route purge patches into a single grouped-semantic-unit deploy ("the Termix-client-surface purge cluster") unless Ashley explicitly greenlights an earlier standalone Phase 12 deploy.

Explicit contract line for the fork-catalog integrity gate: **patch #139 batches with subsequent Phase 13+ backend-route purge patches.** No Co-Authored-By trailer per fork convention (also called out at the top of this file).
**Ordinal position on paste:** Update the count line near the top of `termix-patches.md` from "ONE HUNDRED THIRTY-SEVEN numbered patches" (pre-Phase-11 baseline) to "ONE HUNDRED THIRTY-NINE" — pin both patch #138 (Phase 11) and patch #139 (Phase 12) together at the batch-deploy moment. If patch #138 was already pinned earlier as a solo bump, bump from "ONE HUNDRED THIRTY-EIGHT" to "ONE HUNDRED THIRTY-NINE" here.
**No Co-Authored-By trailer** — fork convention (per 260723-bbt quick task pattern and Phase 10 + Phase 11 patches-md-entry precedents).

---

## Draft (paste-ready — matches the multi-commit-under-one-pin convention from patches #104, #105, #128, and #138)

   139. `feat(sidebar,dashboard,shell,locales): patch #139 — Skynet transformation:
        purge dead frontend surfaces (second slice) (Phase 12 — Ship-of-Theseus
        panel/subtree deletion + tab-bar-chrome deletion + PURGE-09 writer+reader
        atomic retirement + dead locale-key strip; presentation-only, backend
        untouched)`
        (committed 2026-07-23 to `feat/tab-title-from-tmux`; deploy batched
        with patch #138 (Phase 11 first slice) and subsequent Phase 13+
        backend-route purge patches per Ashley 2026-07-23 fleet-standing
        "batch patches into meaningful deploys" rule; not deployed standalone
        unless Ashley explicitly greenlights).

        * **Motivating gap** (Ashley's direct call-out, Phase 10 UAT 2026-07-23,
          same quote that motivated Phase 11 patch #138):
          "I really feel like we need to get away from this termix front end
          stuff before any of this is worth quibbling over." Phase 11 (patch
          #138) delivered the FIRST slice — landing swap + AppRail retirement
          + SettingsRow retirement + rail-view state-machine strip — stripping
          the AppShell mounts and deleting the two directly-mounted files.
          Phase 12 (this patch) delivers the SECOND slice — deletion of the
          ~30 orphan panel files those AppShell imports had pointed at, plus
          the transitive-orphan subtrees (Admin, HostManager), plus the
          `src/ui/dashboard/` tree, plus the `src/ui/shell/Tab.tsx` tab-bar
          chrome, plus the `commandPaletteShortcutEnabled` writer+reader
          pair, plus the dead `pinAppRail` + `nav.*` locale strings across
          all 35 language files. The Ship-of-Theseus purge is now
          substantially landed at the frontend layer; only backend routes
          serving the deleted UIs remain, and those are Phase 13 territory.

        * **Fix summary — sidebar panel + subtree deletion** (PURGE-06). Deleted
          30 files from `src/ui/sidebar/` across 4 atomic commits, per
          STRIP-LIST Sections A/B/C/D enumeration + Phase 12 CONTEXT.md:
          - **10 simple-leaf panels** (`fc283d2`): HostsPanel (735 LOC),
            SessionsPanel (133), CredentialsPanel (68), QuickConnectPanel (202),
            SshToolsPanel (262), SnippetsPanel (1436), HistoryPanel (176),
            SplitScreenPanel (352), ConnectionsPanel (392), UserProfilePanel
            (1646). Combined 5401 dead lines.
          - **7 Admin subtree files** (`d984cdd`): AdminSettingsPanel (835),
            AdminApiKeysSection (244), AdminIdentitiesSection (491),
            AdminManagementSections (494), AdminSettingsSections (547),
            AdminSettingsShared (55), AdminUserDialogs (498). Combined 3164
            dead lines. Inter-file import chain (Section B) died in one
            atomic commit — no intermediate tsc-broken state.
          - **12 HostManager subtree files** (`4080e9f`): HostManager (533),
            HostManagerData (120), HostManagerTabs (167), HostShareModal (317),
            HostEditor (1282), HostEditorData (290), HostEditorFeatureTabs (82),
            HostEditorGeneralTab (699), HostEditorGuacamoleTabs (1369),
            HostEditorStatsTab (296), HostCredentialList (413),
            CredentialEditorView (514). Combined 6082 dead lines. Additionally
            pruned 2 orphaned prop-interface declarations from `src/types/index.ts`
            (`HostManagerProps` + `SSHManagerHostEditorProps`, 16 lines) — Rule 1
            auto-fix for dead type declarations naming deleted components with
            zero external consumers.
          - **SidebarTree** (`8d46043`): 1508 LOC. Enabled by Plan 02 pre-flight
            `42e544b` (inline `isFolder` type-guard as module-private function
            in `sidebar/NewSessionDialog.tsx`, dropping the
            `import { isFolder } from "@/sidebar/SidebarTree"` line). Deletion-
            safe once the sole external consumer no longer referenced the
            source module.

        * **Fix summary — dashboard/ subtree deletion** (PURGE-07). Deleted
          `src/ui/dashboard/` wholesale across 2 atomic commits (per STRIP-LIST
          Section E + FullScreenAppWrapper cross-cut resolution):
          - **FullScreenAppWrapper unauthenticated-branch swap** (`d6d3886`):
            replaced the 6-prop `<Dashboard isAuthenticated={false}
            authLoading={authLoading} onAuthSuccess={handleAuthSuccess}
            isTopbarOpen={false} onSelectView={() => {}} />` element with the
            zero-prop `<PrettyLandingCard />`. Import swap:
            `import { Dashboard } from "@/dashboard/Dashboard.tsx"` →
            `import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard.tsx"`.
            Stripped `handleAuthSuccess` handler (its only consumer was the
            removed `onAuthSuccess` prop). Preserved: TabProvider /
            SidebarProvider / CommandHistoryProvider / Toaster wrapping,
            authenticated render branch `{children(hostConfig, loading)}`,
            all auth-state hooks. STRIP-LIST Section E option-b — mirror of
            Phase 11 Plan 02 tabUtils `dashboard`-case swap onto a second
            cross-cutting surface.
          - **`src/ui/dashboard/` subtree wholesale deletion** (`090cdfb`): all
            17 files, 4118 lines. Dashboard.tsx (887), DashboardTab.tsx (20),
            SessionDashboard.tsx (222), NewSessionDialog.tsx (106 — Plan 02
            copy-relocate leftover), NewSessionHostChips.tsx (62 — copy
            leftover), RemoteHostChips.tsx (54 — copy leftover),
            sshHostToHost.ts (57 — copy leftover), cards/NetworkGraphCard.tsx
            (1364), cards/ServerOverviewCard.tsx (156), cards/ServerStatsCard.tsx
            (82), cards/RecentActivityCard.tsx (128), cards/QuickActionsCard.tsx
            (141), components/DashboardSettingsDialog.tsx (159),
            hooks/useDashboardPreferences.ts (138), panels/UpdateLog.tsx (222),
            panels/alerts/AlertCard.tsx (152), panels/alerts/AlertManager.tsx
            (168). Enabled by Plan 02 pre-flight `11ffa95` (relocate 4
            CommandPalette-consumed files to new `src/ui/features/session-launcher/`)
            + `29b52ab` (swap `tabUtils.tsx case "network_graph"` from
            `<NetworkGraphCard/>` to `<PrettyLandingCard/>`, mirroring Phase
            11's `case "dashboard"` swap onto the second still-dead TabType).

        * **Fix summary — Termix tab bar chrome deletion** (PURGE-08). Deleted
          `src/ui/shell/Tab.tsx` (`5357279`), 442 lines. This was the top-of-
          window horizontal tab-strip visible UI showing per-tab-type icons
          (SSH/RDP/VNC/etc.), click-to-focus routing, X-close button, split
          icon. Phase 11's landing swap implicitly retired the mount (Phase
          11 stripped AppShell's tab-strip container conditional); Plan 05
          confirmed 0 non-comment import consumers via fresh grep gate and
          deleted the file wholesale. Single-atomic-commit — no accompanying
          import strip needed (retention held: TabContext.tsx + tabUtils.tsx
          + CommandPalette.tsx + SplitView.tsx untouched, invisible tab
          plumbing untouched).

        * **Fix summary — PURGE-09 (shortcut editor UI resolution via
          UserProfilePanel side-effect + AppShell reader retirement).** Per
          STRIP-LIST Section G's enumeration, **NO standalone shortcut editor
          UI file ever existed** — the "customize keyboard shortcuts UI"
          surface in CONTEXT.md's PURGE-09 description resolved to the
          `commandPaletteShortcutEnabled` toggle pair. The `features/keyboard/`
          subtree that CONTEXT.md item 4 pointed at is actually the on-screen
          modifier bar for Terminal + Guacamole (`Toolbar.tsx`, `sshAdapter.ts`,
          `sshAdapter.test.ts`, `guacamoleAdapter.ts`, `inputAdapter.ts`) —
          RETAINED as PROTECTED per Section J because it has 5 live consumers
          from retained-UI panes (Terminal + Guacamole). PURGE-09 delivered
          instead via Section G writer+reader atomic retirement discipline,
          both halves shipping in the SAME commit `fc283d2` (alongside the 10
          sidebar simple-leaf panel deletions):
          - **Writer half:** UserProfilePanel.tsx's FakeSwitch onChange
            handler (was lines 1025-1036) that wrote `commandPaletteShortcutEnabled`
            to localStorage and dispatched a `commandPaletteShortcutEnabledChanged`
            storage event; the localStorage read at lines 489-492 to seed the
            switch's initial state. Retired via the whole-file deletion.
          - **Reader half:** AppShell.tsx's useState declaration (lines 282-286)
            that seeded the `commandPaletteShortcutEnabled` state from
            localStorage; the `&& commandPaletteShortcutEnabled` clause in the
            double-shift gate expression at line 343 (now UNCONDITIONAL open
            per Section G.4 recommendation — user default was `true` and only-
            consumer was UserProfilePanel, so hardcoding `true`-equivalent
            behavior is byte-preserved); the effect dep array
            `[commandPaletteShortcutEnabled]` (now `[]`); the entire
            `commandPaletteShortcutEnabledChanged` storage-event listener
            `useEffect` block (lines 352-363).
          - **Preserved (Section G.4 retention gate):** `lastShiftTime` useRef,
            outer double-shift `useEffect`, `setCommandPaletteOpen` call chain
            — all intact (verified `grep -cE 'lastShiftTime' src/ui/AppShell.tsx`
            = 3 in build-verify log G55).
          - **Atomic-commit discipline:** No intermediate commit ever had an
            orphaned reader without a writer. Post-commit grep for both
            `commandPaletteShortcutEnabled` and `commandPaletteShortcutEnabledChanged`
            returns 0 non-comment code hits repo-wide (build-verify G53 + G54).
          - **General pattern:** established "orphan-reader-after-writer-death"
            discipline as the shared-state deletion contract for future purge
            phases.

        * **Fix summary — dead locale strings** (PURGE-10). Stripped ~918 dead
          locale entries from all 35 `src/ui/locales/*.json` files across 2
          atomic tsc-gated commits (per STRIP-LIST Section H + Phase 12 CONTEXT.md
          item 5):
          - **Batch-1** (`72a80b8`): removed `pinAppRail` + `pinAppRailDesc`
            from all 34 translated locale files (68 total entries). en.json
            unaffected — grep-confirmed neither key ever existed there (pre-
            Phase-11 dead upstream carryover only ever lived in the
            translations).
          - **Batch-2** (`5115bb9`): removed 25 dead `nav.*` leaf keys
            (`dashboard`, `hosts`, `snippets`, `admin`, `credentials`, `history`,
            `hostManager`, `sessions`, `userProfile`, `connections`,
            `quickConnect`, `sshTools`, `networkGraph`, `splitScreen`,
            `sshManager`, `refreshTab`, `roleAdministrator`, `roleUser`,
            `cannotSplitTab`, `openFileManager`, `copyPassword`,
            `copySudoPassword`, `passwordCopied`, `noPasswordAvailable`,
            `failedToCopyPassword`) plus 11 dead sub-keys inside the retained
            `nav.conversations` nested object (`settings`,
            `settingsMenuHostManager`, `settingsMenuCredentials`,
            `settingsMenuQuickConnect`, `settingsMenuSshTools`,
            `settingsMenuSnippets`, `settingsMenuHistory`,
            `settingsMenuSplitScreen`, `settingsMenuConnections`,
            `settingsMenuUserProfile`, `settingsMenuAdminSettings`), across
            all 35 locale files (en.json + 34 translated). 850 total batch-2
            entries removed.
          - **Preserved** (verified structurally against en.json's `nav`
            object post-strip):
            - Retained leaf `nav.*` keys with retained-UI consumers: `home`,
              `terminal`, `serverStats`, `fileManager`, `docker`, `tunnels`,
              `close`, `cancel`, `confirmClose`, `hostTabTitle`.
            - Session-launcher `nav.newSession*` keys (9 total, PROTECTED per
              Section J.4) consumed by `src/ui/sidebar/NewSessionDialog.tsx`.
            - `nav.conversations` object with 5 retained sub-keys (`title`,
              `empty`, `pin`, `unpin`, `backToList`) consumed by AppShell.tsx
              (5x `title`) + PrettyConversationsPanel + PinAction.
          - **Safety net held:** typed-i18n `TFunction` generics resolve keys
            at compile time; every locale-strip commit ran `npx tsc --noEmit`
            → exit 0. If a consumer still used a removed key, tsc would have
            failed. None did.

        * **Preserved verbatim** (PURGE-05 carryover + Phase 12 scope-fence
          discipline). Backend routes (`/host/db/*`, `/identities/*`, WebSocket
          routes for SSH terminal, RDP/guac, pretty-view session-file tail)
          UNCHANGED — zero `src/backend/**` files touched in the whole phase
          (verified `git log --name-only cbff367..HEAD | grep "^src/backend/" |
          wc -l` = 0, build-verify G70). The encrypted-SQLite `termix-data`
          volume untouched. RDP/VNC/Guacamole render paths preserved verbatim
          — `case "rdp"` in tabUtils.tsx count = 2 (baseline unchanged from
          Phase 11, build-verify G66); repo-wide `case "rdp"` = 6 (unchanged,
          G67); `onRdpRowClick` in AppShell.tsx = 1 (handler mounted on
          PrettyConversationsPanel with body verbatim, G68). Tab plumbing
          (openTab, doCloseTab, effectiveSelectedTabId, createPortal loop,
          tabNodesRef DOM-move mechanism from patch #35, T-06-02-01 mount-
          lifecycle contract) all untouched. `sidebar/NewSessionDialog.tsx`
          RETAINED as PROTECTED (Phase 12 CONTEXT.md § scope-fence — the
          pretty-conversations pencil consumer; grep-verified 2 consumer
          references — 1 live import from PrettyConversationsPanel.tsx:56 +
          1 comment citation from PrettyConversationRow.test.tsx:35 — build-
          verify G33-G34, G51). `features/keyboard/{Toolbar,sshAdapter,
          guacamoleAdapter,inputAdapter}` RETAINED as PROTECTED (5 consumer
          imports from Terminal + Guacamole — G35-G39, G52). The `dashboard`
          TabType identifier in `src/types/ui-types.ts` PRESERVED per Phase
          11 load-bearing decision (URL restore + synthetic fallback — G69).

        * **Preserved — new session-launcher retained-UI directory.** Plan 02
          Task 2 relocated 4 dashboard-shared files (NewSessionDialog.tsx —
          the DASHBOARD version, distinct from the retained sidebar/
          NewSessionDialog.tsx; sshHostToHost.ts; RemoteHostChips.tsx;
          NewSessionHostChips.tsx) to new `src/ui/features/session-launcher/`
          namespace, with `CommandPalette.tsx` imports rewired from
          `@/dashboard/*` to `@/features/session-launcher/*`. Old copies
          remained on disk until Plan 04 wholesale dashboard/ deletion
          (`090cdfb`) swept them. This preserves the fleet's double-shift
          CommandPalette open path (still shows NewSessionHostChips +
          RemoteHostChips filtered lists) while making the dashboard/ tree
          import-orphan for Plan 04's deletion. Post-deletion, `session-
          launcher/` is the sole home for these 4 modules.

        * **Bundle-size headline — Ship-of-Theseus purge landed in bytes,
          second wave.** AppShell chunk delta vs Phase 11 tip: **−1.19 kB
          / −1.58%** (Phase 11 tip: 75.43 kB → Phase 12 tip: 74.24 kB). Gzip
          delta: **−0.28 kB / −1.37%** (Phase 11 gzip: 20.49 kB → Phase 12
          gzip: 20.21 kB). AppShell delta is modest by design — Phase 11 had
          already async-code-split the deleted panels away via import-stripping
          (Rolldown couldn't reach them at bundle-graph traversal time), so
          the AppShell chunk itself is at its floor. The LOAD-BEARING headline
          is the **index chunk collapse: −124.63 kB / −38.9%** (Phase 11 tip
          index: 320.61 kB → Phase 12 tip index: 195.98 kB); gzip **−40.06 kB
          / −40.3%** (99.30 kB → 59.24 kB) — that's where Rolldown was
          previously async-chunking the dead sidebar panels, HostManager
          subtree, Admin subtree, dashboard subtree, and shell/Tab.tsx into
          unreachable async chunks. Phase 12 deletes the source files, so
          those async chunks collapse out of the Rolldown output entirely.
          **Cumulative Phase 11 + Phase 12 delta vs Phase 10 tip**:
          - AppShell chunk: 448.82 kB → 74.24 kB = **−374.58 kB / −83.4%**
          - AppShell gzip: 87.63 kB → 20.21 kB = **−67.42 kB / −76.9%**
          Ashley's Termix client now downloads ~125 kB less across first-load
          + code-split idle chunks compared to Phase 11 tip, on top of the
          Phase 11 −373 kB AppShell reduction. Ship-of-Theseus purge landed
          in two waves — patches #138 + #139 together tell the full "we
          deleted the Termix client surfaces" story.

        * **Scope fence held.** Zero touches to `src/backend/**`, docker/
          caddy/nginx config, the encrypted-SQLite schema, guacd/RDP/VNC
          render paths, terminal renderer (xterm.js), pretty-view internals
          (ChatMessage, ComposeBox, WipBubble, PlanPendingBubble,
          HarnessTasksPanel), message-queue drawer, identity-store, session-
          hue, or conversation-store logic (though `conversation-store.ts` +
          `conversation-store.test.ts` had 2 provenance-comment references
          to deleted `SessionsPanel` / `SidebarTree` — intentionally RETAINED
          as historical citations, not code dependencies, per Phase 10 Wave
          4 comment policy). Phase 12's boundary: sidebar panel + subtree
          deletion + dashboard/ subtree deletion + shell/Tab.tsx deletion +
          `commandPaletteShortcutEnabled` writer+reader pair retirement +
          dead locale-key strip + minor AppShell + types cleanup driven by
          direct-consequence-of-deletion Rule 1 hygiene. Nothing else.

        * **New test coverage** (net 0 tests over Phase 11 baseline).
          Phase 12 is pure DELETION — no new test files added; no tests
          pruned as ancillary test files (e.g., HostManager.test.tsx did not
          exist in the tree). The retained test suite continues to gate the
          retained UI: `NewSessionDialog.test.tsx` (9/9 passing) +
          `PrettyConversationsPanel.test.tsx` (14/14 passing) +
          `PrettyLandingCard.test.tsx` (4/4 passing) + `sshAdapter.test.ts`
          in the PROTECTED `features/keyboard/` subtree — all continued
          green through every Plan 02/03/04/05/06 commit boundary per each
          plan's per-commit targeted vitest gate.

        * **Data-store contract UNCHANGED.** `conversation-store.ts` +
          `conversation-store.test.ts` untouched apart from comment-only
          citations already noted. `identities-store.ts`, `session-hue.ts`
          untouched. `tabUtils.tsx` had the `network_graph` case-body swapped
          from `<NetworkGraphCard/>` to `<PrettyLandingCard/>` in Plan 02
          Task 3 (`29b52ab`) — analogous to Phase 11 Plan 02 Task 2's
          `dashboard` case-body swap. `network_graph` TabType identifier in
          `src/types/ui-types.ts` PRESERVED (load-bearing for exhaustive-
          switch safety). The `dashboard` TabType identifier PRESERVED per
          Phase 11 preservation decision (build-verify G69).

        * **Files touched** (all on `feat/tab-title-from-tmux`):
          - **Created**:
            - `src/ui/features/session-launcher/NewSessionDialog.tsx`
              (106 LOC — copied verbatim from `src/ui/dashboard/`; consumed
              by CommandPalette)
            - `src/ui/features/session-launcher/sshHostToHost.ts` (57 LOC)
            - `src/ui/features/session-launcher/RemoteHostChips.tsx` (54 LOC)
            - `src/ui/features/session-launcher/NewSessionHostChips.tsx`
              (62 LOC)
          - **Modified**:
            - `src/ui/sidebar/NewSessionDialog.tsx` (Plan 02 Task 1 — inline
              `isFolder` type-guard as module-private function; SidebarTree
              import stripped)
            - `src/ui/shell/CommandPalette.tsx` (Plan 02 Task 2 — 4 imports
              rewired from `@/dashboard/*` to `@/features/session-launcher/*`)
            - `src/ui/shell/tabUtils.tsx` (Plan 02 Task 3 — NetworkGraphCard
              import stripped; `case "network_graph"` case-body swapped to
              `<PrettyLandingCard/>` with Phase 11 comment-prefix pattern)
            - `src/ui/AppShell.tsx` (Plan 03 Task 1 — Section G writer+reader
              atomic retire: `commandPaletteShortcutEnabled` useState +
              double-shift gate clause + effect dep + storage-event listener
              `useEffect` all removed; stale JSX comment at lines 1607-1616
              trimmed; Plan 03 Task 3 — stale line comment at line 720
              rewritten to generic wording)
            - `src/types/index.ts` (Plan 03 Task 3 — Rule 1 auto-fix: pruned
              orphaned `HostManagerProps` + `SSHManagerHostEditorProps`
              interface declarations, 16 lines)
            - `src/ui/features/FullScreenAppWrapper.tsx` (Plan 04 Task 1 —
              Dashboard import → PrettyLandingCard import; unauthenticated-
              branch render swap; handleAuthSuccess handler removed)
            - `src/ui/locales/en.json` (Plan 06 Task 2 — 25 leaf nav.* keys
              + 11 nav.conversations sub-keys removed; +1 lossless
              addHost duplicate coalesced by JSON.parse round-trip)
            - `src/ui/locales/translated/*.json` (34 files — Plan 06 Task 1
              removed pinAppRail + pinAppRailDesc from 34 files; Plan 06
              Task 2 removed the same 25 nav.* leaf keys + 11
              nav.conversations sub-keys from 34 files. Combined ~918 dead
              entries across the batch)
          - **Deleted** (48 files, ~15,000 lines total gone):
            - 30 sidebar files: HostsPanel.tsx (735), SessionsPanel.tsx (133),
              CredentialsPanel.tsx (68), QuickConnectPanel.tsx (202),
              SshToolsPanel.tsx (262), SnippetsPanel.tsx (1436), HistoryPanel.tsx
              (176), SplitScreenPanel.tsx (352), ConnectionsPanel.tsx (392),
              UserProfilePanel.tsx (1646), AdminSettingsPanel.tsx (835),
              AdminApiKeysSection.tsx (244), AdminIdentitiesSection.tsx (491),
              AdminManagementSections.tsx (494), AdminSettingsSections.tsx (547),
              AdminSettingsShared.tsx (55), AdminUserDialogs.tsx (498),
              HostManager.tsx (533), HostManagerData.ts (120),
              HostManagerTabs.tsx (167), HostShareModal.tsx (317),
              HostEditor.tsx (1282), HostEditorData.ts (290),
              HostEditorFeatureTabs.tsx (82), HostEditorGeneralTab.tsx (699),
              HostEditorGuacamoleTabs.tsx (1369), HostEditorStatsTab.tsx (296),
              HostCredentialList.tsx (413), CredentialEditorView.tsx (514),
              SidebarTree.tsx (1508)
            - 17 dashboard files (whole subtree): Dashboard.tsx (887),
              DashboardTab.tsx (20), SessionDashboard.tsx (222), 4 Plan-02-
              leftover copies (279), 5 card files (1871), 1 components file
              (159), 1 hooks file (138), 3 panels files (542)
            - 1 shell file: Tab.tsx (442) — PURGE-08

        * **Verification** (per `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-BUILD-VERIFY-LOG.md`):
          `npx tsc --noEmit` exits clean (zero errors). `npx vitest run` reports
          **524 / 526 passing** — byte-identical Phase 11 baseline. The 2
          failures are the same pre-existing test-fixture drift in
          `ComposeBox.test.tsx` inherited from patch #121 (Send-button removal,
          stale `getByLabelText(/send 'yes'/i)` anchors) + patch #124 (ThumbsUp
          aria-label rename) — documented at
          `.planning/phases/10-.../deferred-items.md`, out of Phase 12 scope
          per GSD SCOPE BOUNDARY rule. Zero net-new Phase 12 regressions.
          `npm run build` succeeds in 17.14s; AppShell bundle delta vs Phase
          11 tip is **−1.19 kB / −1.58%** (raw) / **−0.28 kB / −1.37%** (gzip)
          — modest additional shrink; the load-bearing headline is the
          **index chunk −124.63 kB / −38.9%** (Rolldown async-chunk graph
          collapse post-deletion). Cumulative Phase 11 + Phase 12 vs Phase 10
          tip: AppShell **−374.58 kB / −83.4%** (raw), gzip **−67.42 kB /
          −76.9%**.

        * **Grep-hygiene gates** (70 total, all PASS per 12-BUILD-VERIFY-LOG.md
          § Section 4):
          - **K.1 file-existence deletion gates (32):** all 30 sidebar files
            + entire `src/ui/dashboard/` subtree + `src/ui/shell/Tab.tsx`
            confirmed absent (`test ! -f` / `test ! -d`).
          - **K.1 PROTECTED gates (7):** `src/ui/sidebar/NewSessionDialog.tsx`
            + `.test.tsx` sibling + `src/ui/features/keyboard/` dir +
            Toolbar.tsx + sshAdapter.ts + guacamoleAdapter.ts + inputAdapter.ts
            all confirmed present.
          - **K.1 RELOCATED gates (4):** all 4 `src/ui/features/session-
            launcher/*` files confirmed present at new path.
          - **K.2 identifier grep gates (12):** Section A (10 panels), B
            (Admin subtree — 7), C (HostManager subtree — 5), D (SidebarTree),
            E (dashboard identifiers), F (shell/Tab imports), PROTECTED
            (sidebar/NewSessionDialog + features/keyboard), PURGE-09 delivery
            (commandPaletteShortcutEnabled + commandPaletteShortcutEnabledChanged),
            double-shift path preservation (lastShiftTime ≥ 2 — observed 3).
            All PASS with 0 non-comment code hits (using improved awk-based
            comment filter that correctly anchors past the `path:LINENO:`
            grep-output prefix; the 15 raw hits under the plan's original
            filter are all inside `//` line-comments or `{/* */}` JSX block-
            comments — Phase 10 Wave 4 policy: acceptable historical
            annotations). Section E has 2 known non-panel residuals
            (`AlertCardProps` + `AlertManagerProps` orphan type-declarations
            in `src/types/index.ts`) flagged for a follow-up hygiene sweep;
            zero runtime impact (TypeScript erases them at build time).
          - **K.3 locale key gates (7):** pinAppRail + pinAppRailDesc = 0
            across all 35 files; 25 batch-2 nav.* keys structurally absent
            under `nav.*` (via Python JSON walk); 10 retained nav.* leaf
            keys still PRESENT in en.json; 5 retained nav.conversations.*
            sub-keys still PRESENT in en.json; 25 removed keys have 0 code
            consumers via `t("nav.<key>")` grep.
          - **K.4 toolchain gates (3):** tsc + vitest + npm run build all
            PASS (see Verification above).
          - **K.5 baseline preservation gates carried from Phase 11 (5):**
            `case "rdp"` in tabUtils.tsx = 2 (unchanged from Phase 11
            baseline); repo-wide `case "rdp"` = 6 (unchanged); `onRdpRowClick`
            in AppShell.tsx = 1 (handler preserved verbatim); `"dashboard"`
            TabType in ui-types.ts = 1 (preserved per Phase 11 load-bearing
            decision); backend touches during Phase 12 = 0 files.

        * **Design source-of-truth** (LOCKED, no re-litigation per CONTEXT.md):
          - `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-CONTEXT.md`
            — the phase boundary + scope-fence + LOCKED implementation
            decisions.
          - `~/.claude/identities/tina/tina.md` § Skynet direction — Ship
            of Theseus (dead-surfaces canonical list, palette authority,
            "conversation list + pretty view is all Ashley sees" heuristic,
            "no settings at all" lock, "it is ONE project, not a collection
            of bounties" fleet lock).
          - `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/`
            — the bounty premise, Ashley's UAT quote (same quote motivating
            patch #138), the todo set (Phase 11 handled first slice;
            Phase 12 handles second slice; Phase 13 backend routes if
            needed).
          - `.planning/phases/12-.../12-01-STRIP-LIST.md` — the 942-line
            audit-input contract Plans 02-06 consumed + Section K
            verification-gate contract Plan 07 executed.
          - `.planning/phases/11-.../11-PATCHES-MD-ENTRY.md` — patch #138
            precedent this draft mirrors.
          - `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)
            — the AUTHORITATIVE current deploy source (the fork CLAUDE.md's
            15-min deadman reference is STALE, retired 2026-07-21, separate
            `claude-md-15min-deadman-stale` bounty tracks the update).

        * **Rebase risk**: HIGH — accept the divergence per CONTEXT.md
          § scope-fence discipline. Upstream Termix keeps evolving the
          panel files this patch deletes; our fork just doesn't have them
          anymore. When we next rebase against upstream `main`, deleted-file
          conflicts resolve to "stays deleted" — this is intentional. The
          AppShell.tsx surgical Section G touches (commandPaletteShortcutEnabled
          reader teardown) + the `src/types/index.ts` orphan-interface prune
          + the `FullScreenAppWrapper.tsx` unauthenticated-branch swap + the
          `tabUtils.tsx` network_graph case-body swap + the `sidebar/
          NewSessionDialog.tsx` isFolder inline + the CommandPalette.tsx
          import rewires are targeted deltas that will likely conflict if
          upstream reworks the same regions; the resolutions are all
          mechanical (accept the strip / accept the swap / accept the inline
          + preserve any new upstream additions that don't reintroduce
          deleted surfaces). Grep for any of the 48 deleted files' identifiers
          in any post-rebase source tree to sanity-check that no upstream
          re-add survived the merge. The `src/ui/features/session-launcher/`
          directory is a fork-native creation not tracked by upstream — any
          upstream `src/ui/dashboard/` additions post-rebase should be
          evaluated for whether they're new surfaces (delete) or updates to
          the 4 session-launcher-relocated files (port the update).

        * **Commits** (all on `feat/tab-title-from-tmux`):
          - **Plan 01 (docs — strip-list)**: 1 commit
            - `c7ad644` `docs(12-01): enumerate strip-list for frontend
              deletion sweep + Section G PURGE-09 resolution (writer + reader)`
              (942-line 12-01-STRIP-LIST.md + 12-01-SUMMARY.md)
          - **Plan 05 (Wave 1 — shell/Tab.tsx delete)**: 2 commits
            - `5357279` `chore(shell): delete retired Tab.tsx (Phase 12
              PURGE-08 — Termix tab bar chrome retired implicitly by Phase
              11 landing swap)`
            - `e44272c` `docs(12-05): summary`
          - **Plan 02 (Wave 2 — pre-flight refactors)**: 4 commits
            - `42e544b` `refactor(sidebar): inline isFolder into
              NewSessionDialog (Phase 12 Plan 02 — pre-flight for SidebarTree
              deletion in Plan 03)`
            - `11ffa95` `refactor(session-launcher): relocate 4 dashboard-
              shared files consumed by CommandPalette to features/session-
              launcher/ (Phase 12 Plan 02 — pre-flight for dashboard/
              deletion in Plan 04)`
            - `29b52ab` `refactor(tabUtils): swap network_graph render to
              PrettyLandingCard (Phase 12 Plan 02 — pre-flight for
              dashboard/cards/ deletion in Plan 04)`
            - `df8e87a` `docs(12-02): summary`
          - **Plan 03 (Wave 3a — sidebar + PURGE-09)**: 5 commits
            - `fc283d2` `chore(sidebar): delete 10 dead panel files + AppShell
              commandPaletteShortcutEnabled reader — HostsPanel, SessionsPanel,
              CredentialsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel,
              HistoryPanel, SplitScreenPanel, ConnectionsPanel, UserProfilePanel;
              AppShell double-shift gate torn out (Phase 12 Plan 03 PURGE-06
              + PURGE-09 writer+reader atomic retirement)`
              — the heaviest Phase 12 commit; 10 file deletes + AppShell
              surgical excision, writer+reader in one atomic commit
            - `d984cdd` `chore(sidebar): delete Admin subtree —
              AdminSettingsPanel, AdminApiKeysSection, AdminIdentitiesSection,
              AdminManagementSections, AdminSettingsSections, AdminSettingsShared,
              AdminUserDialogs (Phase 12 Plan 03 PURGE-06)`
            - `4080e9f` `chore(sidebar): delete HostManager + HostEditor
              subtree — HostManager, HostManagerData, HostManagerTabs,
              HostShareModal, HostEditor, HostEditorData, HostEditorFeatureTabs,
              HostEditorGeneralTab, HostEditorGuacamoleTabs, HostEditorStatsTab,
              HostCredentialList, CredentialEditorView (Phase 12 Plan 03
              PURGE-06)`
            - `8d46043` `chore(sidebar): delete SidebarTree.tsx — isFolder
              inlined into NewSessionDialog in Plan 02 (Phase 12 Plan 03
              PURGE-06)`
            - `523cc87` `docs(12-03): summary`
          - **Plan 04 (Wave 3b — dashboard subtree + FullScreenAppWrapper)**:
            3 commits
            - `d6d3886` `refactor(shell): swap FullScreenAppWrapper Dashboard
              render for PrettyLandingCard (Phase 12 Plan 04)`
            - `090cdfb` `chore(ui): delete src/ui/dashboard/ subtree (Phase
              12 PURGE-07)`
            - `479ec07` `docs(12-04): summary`
          - **Plan 06 (Wave 4 — locale strip)**: 3 commits
            - `72a80b8` `chore(locales): remove dead pinAppRail +
              pinAppRailDesc keys from 34 translated locale files (Phase 12
              Plan 06 PURGE-10 batch-1)`
            - `5115bb9` `chore(locales): remove dead nav.* keys from 35
              locale files — dashboard, hosts, snippets, admin, credentials,
              history, hostManager, sessions, userProfile, connections,
              quickConnect, sshTools, networkGraph, splitScreen, sshManager,
              refreshTab, roleAdministrator, roleUser, cannotSplitTab,
              openFileManager, copyPassword, copySudoPassword, passwordCopied,
              noPasswordAvailable, failedToCopyPassword + nav.conversations
              dead sub-keys (Phase 12 Plan 06 PURGE-10 batch-2)`
            - `728beef` `docs(12-06): summary`
          - **Plan 07 (Wave 5 — docs: build-verify + UAT + this patches-md
            draft)**: 3 commits (see the docs commits landing this file, the
            12-BUILD-VERIFY-LOG.md, and the 12-UAT-CHECKLIST.md alongside the
            12-07-SUMMARY.md — SHAs `[Plan-07 build-verify SHA — fill in
            after commit]`, `[Plan-07 UAT+patches SHA — fill in after commit]`,
            `[Plan-07 summary SHA — fill in after commit]`).

          Total: 17 code + docs commits (1 Plan 01 + 2 Plan 05 + 4 Plan 02 +
          5 Plan 03 + 3 Plan 04 + 3 Plan 06 = 18 minus double-counted SUMMARY
          docs; ~10 pure-code + ~7 pure-docs commits, depending on how you
          bucket per-plan-SUMMARY commits) + 3 Plan 07 = ~20-21 total for
          the Phase 12 fork sequence.

        * **Deploy status**. Code-complete on `feat/tab-title-from-tmux` at
          `[Plan-07 tip SHA — fill in after commit]`. NOT YET pushed, NOT
          YET deployed, image NOT YET built. Batched with patch #138 (Phase
          11 first slice) and subsequent Phase 13+ backend-route purge
          patches per Ashley 2026-07-23 fleet-standing "batch patches into
          meaningful deploys" rule. Deploy sequence documented at
          `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-UAT-CHECKLIST.md`
          under "Post-UAT deploy runbook" (authoritative source cited:
          `~/.claude/identities/tina/deploy-runbook.md`, NOT the fork
          CLAUDE.md's stale 15-min deadman reference which is retired
          fleet-wide since 2026-07-21).

---

## Fill-in placeholders (before pasting)

Before pasting into termix-patches.md, replace the following (obtain from
`git rev-parse --short HEAD` immediately after the Plan 07 docs commits):

- `[Plan-07 build-verify SHA — fill in after commit]` — from
  `git rev-parse --short HEAD` right after the `docs(12-07): phase 12 build
  verification log` commit lands. Already known at paste-time: `500d788`.
- `[Plan-07 UAT+patches SHA — fill in after commit]` — from
  `git rev-parse --short HEAD` right after the `docs(12-07): phase 12 UAT
  checklist + patch #139 draft` commit lands.
- `[Plan-07 summary SHA — fill in after commit]` — from
  `git rev-parse --short HEAD` right after the `docs(12-07): summary`
  commit lands (the third and final Plan 07 commit).
- `[Plan-07 tip SHA — fill in after commit]` — same as the summary SHA
  (Plan 07 tip is the third docs commit).

The bundle-size delta values (−1.19 kB / −1.58% raw AppShell; −124.63 kB /
−38.9% raw index; cumulative Phase 11 + Phase 12 = −374.58 kB / −83.4% on
AppShell), vitest counts (524/526), and grep-gate results are all resolved
from `12-BUILD-VERIFY-LOG.md` and do not need further substitution.

## Post-paste bookkeeping

After pasting into termix-patches.md:

1. **Update the count line** near the top of the file. Current state depends
   on whether patch #138 was pinned before or alongside patch #139:
   - If patch #138 pinned earlier as a solo bump: current count line is
     "ONE HUNDRED THIRTY-EIGHT numbered patches"; bump to "ONE HUNDRED
     THIRTY-NINE".
   - If patches #138 + #139 pin together at batch-deploy moment: current
     count line is "ONE HUNDRED THIRTY-SEVEN"; bump to "ONE HUNDRED
     THIRTY-NINE".
   - Verify current count first with `grep "numbered patches"
     ~/.claude/identities/tina/termix-patches.md | head -3`; if an
     interstitial patch pinned first, adjust accordingly.
2. **Commit the pin.** Two possible flows:
   - Solo pin: `docs(patches): pin patch #139 — Skynet transformation
     second slice`.
   - Combined pin (recommended if patch #138 has not yet been pinned):
     `docs(patches): pin patches #138 + #139 — Skynet transformation first
     + second slices`.
3. **Do NOT `/close skynet-transformation-purge-dead-surfaces` yet** if
   Phase 13+ backend-route purge is still ahead in the bounty's todo set
   — the bounty's canonical dead-surfaces list includes items (backend
   routes serving now-dead UIs — `/host/db/*` HostManager consumers may
   have retained-UI callers via pretty-conversations' host list;
   `/snippets/*` fully dead; `/admin/*` fully dead; `/user/*` UserProfilePanel
   consumers) that Phase 12 explicitly deferred to Phase 13. Only close
   the bounty when all its todo items are landed. If Phase 12's "second
   slice" is deemed a milestone worth acknowledging without closing the
   bounty, add a comment to the bounty's `notes.md` or equivalent (per
   Tina's bounty catalog convention) noting "patches #138 + #139 land
   the first + second slices: landing swap + AppRail + SettingsRow +
   sidebar panels + dashboard subtree + tab bar chrome + shortcut editor
   UI + dead locale strings all retired at the frontend layer. Phase 13
   handles backend route cleanup + any remaining hygiene."
4. **Update `~/.claude/identities/tina/tina.md`** compact overview if
   warranted. Phase 12 is presentation-only + the AppShell orphan surface
   cleanup, so likely no tina.md update needed for the second slice. If
   Phase 13 lands the backend-route deletion + nginx.conf shrinkage, then
   tina.md's box-map may need a Termix operational-context adjustment
   (fewer routes served → smaller nginx.conf → note the reduction in the
   "Nginx caveat" line + potentially update the `~/.claude/identities/tina/box-map.md`
   Termix section to reflect the smaller API surface).
