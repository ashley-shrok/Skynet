# Patch #138 — Skynet transformation: purge dead Skynet surfaces (first slice) — Phase 11

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** Only after Ashley greenlights the batched Phase 11 + Phase 12+ purge cluster deploy AND UAT passes on the 22 non-negotiable items in `11-UAT-CHECKLIST.md`. Post-deadman-retirement flow per current `~/.claude/identities/tina/deploy-runbook.md` (the 15-min deadman regime was retired 2026-07-21).
**Batch context:** Patch #138 is the FIRST Phase 11 patch. Per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23), it does NOT ship standalone. Batches with subsequent Phase 12+ purge patches (dashboard/panel-file deletion, backend-route deletion, dead-locale-string sweep) into a single grouped-semantic-unit deploy ("the visible-surface purge cluster") unless Ashley explicitly greenlights an early Phase 11 standalone.

Explicit contract line for the fork-catalog integrity gate: **patch #138 batches with subsequent Phase 12+ purge patches.** No Co-Authored-By trailer per fork convention (also called out at the top of this file).
**Ordinal position on paste:** Update the "ONE HUNDRED THIRTY-SEVEN numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED THIRTY-EIGHT".
**No Co-Authored-By trailer** — fork convention (per 260723-bbt quick task pattern and Phase 10 `10-PATCHES-MD-ENTRY.md`).

---

## Draft (paste-ready — matches the multi-commit-under-one-pin convention from patches #104, #105, and #128)

   138. `feat(app-shell,sidebar): patch #138 — Skynet transformation: purge dead
        Skynet surfaces (first slice) (Phase 11 — Ship-of-Theseus landing swap +
        AppRail retirement + SettingsRow retirement + rail-view state-machine
        strip; presentation-only, backend untouched)`
        (committed 2026-07-23 to `feat/tab-title-from-tmux`; deploy batched
        with subsequent Phase 12+ purge patches per Ashley 2026-07-23 fleet-
        standing "batch patches into meaningful deploys" rule; not deployed
        standalone unless Ashley explicitly greenlights).

        * **Motivating gap** (Ashley's direct call-out, Phase 10 UAT 2026-07-23):
          "I really feel like we need to get away from this skynet front end
          stuff before any of this is worth quibbling over." Long-term Ashley
          sees only two visible frontend surfaces in Skynet: the pretty-
          conversations panel (sidebar) and the PrettyView chat surface (main
          pane). Everything else in today's Skynet UI — the Skynet dashboard,
          the AppRail icon column with its 11+ entry points (Dashboard,
          Hosts, Sessions, Credentials, Connections, Quick-Connect, SSH Tools,
          Snippets, History, Split Screen, Network Graph, User Profile, Admin
          Settings), the SettingsRow mobile gear entry point, the host-manager
          panels, the admin console, every settings surface — is dead weight
          going away in the Ship-of-Theseus purge. This first slice covers
          the two surfaces called out most directly: (a) desktop landing swap
          (dashboard → PrettyLandingCard), (b) AppRail retirement + the
          SettingsRow cascade + the rail-view state machine strip. Subsequent
          Phase 12+ patches will delete the dead panel FILES on disk (they
          stay on disk per the Phase 11 scope-fence — the visible-UI entry
          points are all closed here, the file deletion follows in a
          follow-up).

        * **Fix summary — landing swap** (PURGE-01). Replaced the desktop
          default landing render — `<DashboardTab>` at `case "dashboard"` in
          `src/ui/shell/tabUtils.tsx`'s `renderTabContent` — with a new
          prop-less `<PrettyLandingCard/>` component under
          `src/ui/features/pretty-view/PrettyLandingCard.tsx`. The card is a
          warm-glass idle empty-landing card mirroring Phase 10's
          `PrettyConversationsPanel` empty-state visual language: the same
          `linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))`
          background, `rgba(240,235,224,0.9)` warm-cream text color,
          `rgba(255,220,170,0.10)` inset warm-glow highlight, and 20px
          backdrop-blur. Palette values declared inline via `style={{...}}`
          per Phase 10 patch #133 shadcn-free precedent — JSDOM-verifiable
          without computed-CSS resolution (patterns-established:
          "inline-style palette-authority for JSDOM-testable palette-authority
          contract"). Zero animation, zero data-fetching, zero side effects,
          zero shadcn primitives, zero lifecycle hooks — motion + info-
          disclosure guardrails per Ashley's motion-quiet lock. The
          `"dashboard"` TabType identifier is PRESERVED in ui-types.ts as a
          load-bearing fallback for `effectiveSelectedTabId` + `doCloseTab` +
          `hostlessTypes` machinery (minimal-blast-radius per CONTEXT.md
          § Deletion, not gating). Only the RENDER path swaps. Both
          synthetic-fallback-tab creation sites (initial useState seed at
          old AppShell.tsx:185 + doCloseTab fallback at old AppShell.tsx:1187)
          got their `label:` renamed from `t("nav.dashboard")` to
          `t("nav.conversations.title", { defaultValue: "Conversations" })`
          — same i18n key surviving code already used, no new translation
          keys added.

        * **Fix summary — AppRail retirement** (PURGE-02). Deleted
          `src/ui/sidebar/AppRail.tsx` (283 lines). Stripped every import of
          `@/sidebar/AppRail` from `src/`; stripped the AppRail mount from
          `src/ui/AppShell.tsx` (old lines 1826-1847); stripped every
          transitive knock-on: 10 sibling sidebar-panel imports (HostsPanel,
          SessionsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel,
          HistoryPanel, SplitScreenPanel, UserProfilePanel, AdminSettingsPanel,
          CredentialsPanel — plus ConnectionsPanel making 11 total),
          `railView` useState declaration + all 11 dead `{railView === "X"}`
          panel-branch conditionals inside `sidebarPanelContent` (plus the
          `${railView==="conversations" ? "" : "hidden"}` outer toggle on the
          surviving branch — no purpose when there's only one possible
          content), `sidebarTitle: Record<RailView, string>` const,
          `handleRailClick` + `editHostInManager` helper functions,
          `openSingletonTab` function entirely (per Plan 01 §E.6 disposition
          protocol — post-strip grep confirmed all 3 caller-sites died in
          this same plan; `tabUtils.tsx`'s `onOpenSingletonTab?` optional-
          prop signature stays for undefined-safe compat, AppShell now
          passes `undefined`), and `profileDropdownOpen` useState + setter
          (per Plan 01 §E.2 safety-gate protocol — post-mount-removal grep
          returned zero non-comment survivors before the deletion, so
          confirmed AppRail-only state). `sidebarHeader` hardcodes
          `{t("nav.conversations.title", { defaultValue: "Conversations" })}`
          in place of `{sidebarTitle[railView]}`. Net AppShell.tsx delta:
          386 lines deleted, 46 added, **net −340 lines**.

        * **Fix summary — SettingsRow retirement** (Ashley's total-not-partial
          "no settings" lock — CONTEXT.md § scope-fence discipline "we are
          not having settings at all"). Deleted `src/ui/sidebar/SettingsRow.tsx`
          (198 lines). Stripped the `settingsRowSlot` prop from
          `PrettyConversationsPanel.tsx` (destructure, TypeScript type field,
          JSX render site), and stripped the `import type { ReactNode }` from
          `PrettyConversationsPanel.tsx`'s react import since `settingsRowSlot`
          was its sole consumer. `PrettyConversationsPanel.test.tsx` Test 11
          (settingsRowSlot mobile position) pruned; file-header comment index
          at line 13 updated in place to `//  11)  RETIRED — settingsRowSlot
          prop dropped in Phase 11 (Ashley's "no settings" lock)`. Test count:
          15 → 14 for that file; no renumber per Phase 10 Wave 4 precedent.
          Deletion ordered BEFORE AppRail.tsx deletion because SettingsRow.tsx
          line 42 had `import type { RailView } from "@/sidebar/AppRail"` —
          reversing the order would tsc-break SettingsRow in the intermediate
          commit; tsc-clean per commit boundary per Phase 10 Wave 4 precedent.

        * **Fix summary — every visible-UI entry point to dead surfaces is
          gone** (PURGE-03). Post-strip, there is NO click path, NO keyboard
          shortcut, NO menu item, NO gear icon anywhere in the visible UI
          that leads to the Skynet dashboard, host manager, snippets manager,
          admin console, or any settings surface. The Ship-of-Theseus purge
          landed: the wood is off the boat. Direct-hash-fragment navigation
          to `#hosts` / `#admin` / `#snippets` / `#dashboard` yields either a
          404-equivalent (blank / error / fallback) OR the new PrettyLandingCard
          warm-glass empty card — both outcomes are acceptable, the load-
          bearing requirement is that the corresponding dead-surface panel
          (HostManagerPanel / AdminSettingsPanel / SnippetsPanel / DashboardTab)
          MUST NOT render (per UAT checklist item 9 walk).

        * **Preserved verbatim** (PURGE-04 + PURGE-05). Backend routes
          (`/host/db/*`, `/identities/*`, WebSocket routes for SSH terminal,
          RDP/guac, pretty-view session-file tail) UNCHANGED — zero
          `src/backend/**` files touched in the whole phase, `git log
          --name-only --since="Phase 11 start"` returns 0 for backend paths.
          The encrypted-SQLite `skynet-data` volume is untouched. RDP/VNC/
          Guacamole render paths preserved verbatim — `case "rdp"` /
          `case "vnc"` / `case "telnet"` blocks in `tabUtils.tsx` untouched
          (baseline hit-count `grep -rn 'case "rdp"' src/ | wc -l` = 6,
          matches pre-Phase-11 exactly). The `onRdpRowClick` handler in
          `AppShell.tsx` preserved verbatim through the sidebarPanelContent
          rewrite; PrettyConversationsPanel's RDP-host-sentinel rows continue
          to open Guacamole panes. Tab plumbing (openTab, doCloseTab,
          effectiveSelectedTabId, createPortal loop, tabNodesRef DOM-move
          mechanism from patch #35, T-06-02-01 mount-lifecycle contract) all
          untouched.

        * **Bundle-size headline — Ship-of-Theseus purge landed in bytes.**
          AppShell chunk delta vs Phase 10 tip: **−373 kB / −83%** (Phase 10
          tip AppShell = 448.82 kB, Phase 11 tip AppShell = 75.43 kB). Gzip'd
          first-load delta: **−67 kB on the wire** (Phase 10 gzip = 87.63 kB,
          Phase 11 gzip = 20.49 kB). The reduction comes from AppRail.tsx +
          SettingsRow.tsx deletions (481 LOC + Lucide-icon dep chains gone),
          11 sidebar-panel imports removed from AppShell (Rolldown code-splits
          them away into async chunks that no code path loads), the
          `case "dashboard"` → PrettyLandingCard swap (DashboardTab's host-
          list-fetching cards + chart libs + stats-panels subtree
          code-splits away), and the 340-line net strip from AppShell.tsx.
          Ashley's Skynet client now downloads 373 kB less code on first-load
          for the same landing surface.

        * **Scope fence held.** Zero touches to `src/backend/**`,
          `src/ui/dashboard/**` (deferred to Phase 12+ deletion — files stay
          on disk, just unreachable), the 11 sidebar-panel FILES
          (deferred to Phase 12+ deletion — files stay on disk), the
          34 locale JSON files carrying dead `pinAppRail` translation
          strings (Phase 12+ hygiene sweep), guacd/RDP/VNC render paths,
          terminal renderer (xterm.js), pretty-view internals (ChatMessage,
          ComposeBox, WipBubble, PlanPendingBubble, HarnessTasksPanel),
          message-queue drawer, identity-store, session-hue, or
          conversation-store. Phase 11's boundary: landing render swap +
          AppRail deletion + SettingsRow deletion + AppShell rail-view
          state machine strip. Nothing else.

        * **New test coverage** (net +3 tests over Phase 10 baseline):
          - `PrettyLandingCard.test.tsx` — 4 cases (all passing): data-
            attribute presence (`[data-pv-landing-card="true"]`), centering
            classes (`flex flex-col items-center justify-center`), inline-
            style palette-authority marker (regex match against warm-cream
            `rgba(240, 235, 224, ...)` OR warm-glow `rgba(255, 220, 170, ...)`
            OR any `hsla(...)` for future-proof palette tweaks), no motion
            (no `animate-*`, no `aria-busy`, no animated SVGs in the rendered
            subtree).
          - `PrettyConversationsPanel.test.tsx` Test 11 pruned (net −1);
            Tests 12-15 preserved with no renumber.

        * **Data-store contract UNCHANGED.** `conversation-store.ts` +
          `conversation-store.test.ts` untouched. `identities-store.ts`,
          `session-hue.ts` untouched. `tabUtils.tsx` case-body swap for
          `"dashboard"` is the only tabUtils.tsx change — its
          `onOpenSingletonTab?` optional prop signature stays intact for
          undefined-safe compat with the AppShell caller that now passes
          `undefined`.

        * **Files touched** (all on `feat/tab-title-from-tmux`):
          - Created:
            - `src/ui/features/pretty-view/PrettyLandingCard.tsx` (77 LOC)
            - `src/ui/features/pretty-view/PrettyLandingCard.test.tsx` (58 LOC)
          - Modified:
            - `src/ui/shell/tabUtils.tsx` (1 import removed, 1 import added,
              `case "dashboard"` case-body swapped from `<DashboardTab>` to
              `<PrettyLandingCard/>`; `case "rdp"/vnc/telnet` blocks
              preserved verbatim)
            - `src/ui/AppShell.tsx` (net −340 lines: 386 deleted, 46 added.
              Rail-view state machine + AppRail/SettingsRow imports + 10
              dead-panel-branches + ConnectionsPanel import + openSingletonTab
              function + profileDropdownOpen state + handleRailClick +
              editHostInManager helpers + sidebarTitle Record + 2 label
              renames)
            - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
              (15 deleted, 6 added: settingsRowSlot prop + type + JSX render
              site + ReactNode import all retired)
            - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
              (29 deleted, 2 added: Test 11 describe block gone; file-header
              comment index updated in place)
          - Deleted:
            - `src/ui/sidebar/AppRail.tsx` (283 LOC — PURGE-02)
            - `src/ui/sidebar/SettingsRow.tsx` (198 LOC — Ashley's "no
              settings" lock)

        * **Verification** (per `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-BUILD-VERIFY-LOG.md`):
          `npx tsc --noEmit` exits clean (zero errors). `npx vitest run`
          reports **524 / 526 passing**. The 2 failures are pre-existing
          test-fixture drift in `ComposeBox.test.tsx` inherited from patch
          #121 (Send-button removal, stale `getByLabelText(/send 'yes'/i)`
          anchors) + patch #124 (ThumbsUp aria-label rename) — documented at
          `.planning/phases/10-pretty-conversations-visual-language-rework/deferred-items.md`,
          out of Phase 11 scope per GSD SCOPE BOUNDARY rule. Zero net-new
          Phase 11 regressions. All 4 new PrettyLandingCard tests green.
          `npm run build` succeeds in 10.94s; AppShell bundle delta vs
          Phase 10 tip is −373 kB (−83%). Full-suite delta from Phase 10
          tip: +25 tests / +23 passing (+3 net-new from Phase 11 + 2
          pre-Phase-11 ComposeBox fixes + 20 tests from intervening in-flight
          patches #129-#137).

        * **Grep-hygiene gates** (17 total, all passing per 11-BUILD-VERIFY-LOG.md
          § Section 4):
          - `grep -rn 'from "@/sidebar/AppRail"' src/ | wc -l` → 0
          - `grep -rn 'from "@/sidebar/SettingsRow"' src/ | wc -l` → 0
          - `grep -rn "renderSettingsMenuItems" src/ | wc -l` → 0
          - `railView`, `handleRailClick`, `sidebarTitle`, `RailView` code
            hits → 0 (7 residuals all inside `//` line-comment historical
            annotations; Phase 10 Wave 4 policy: acceptable)
          - `profileDropdownOpen` code hits → 0 (1 comment-only residual;
            per Plan 01 §E.2 safety-gate — AppRail-only state stripped in
            Plan 03 Task 2)
          - `openSingletonTab` code hits → 0 (2 comment-only residuals)
          - `settingsRowSlot` code hits → 0 (1 JSX block-comment residual)
          - `DashboardTab` code hits outside `src/ui/dashboard/` → 0 (1
            comment-only residual; `src/ui/dashboard/` tree stays on disk
            per scope-fence)
          - `test ! -f src/ui/sidebar/AppRail.tsx` — passes (file GONE)
          - `test ! -f src/ui/sidebar/SettingsRow.tsx` — passes (file GONE)
          - `test -f src/ui/features/pretty-view/PrettyLandingCard.tsx` —
            passes (file EXISTS)
          - `grep -c "PrettyLandingCard" src/ui/shell/tabUtils.tsx` → 2
            (import + JSX render call)
          - `grep -rn 'case "rdp"' src/ | wc -l` → 6 (baseline unchanged
            from Phase 10 — PURGE-05 preserved)
          - `grep -c "onRdpRowClick" src/ui/AppShell.tsx` → 1 (handler
            preserved verbatim — PURGE-05)
          - `git log --name-only --since="Phase 11 start" | grep
            "^src/backend/" | wc -l` → 0 (PURGE-04 backend untouched)

        * **Design source-of-truth** (LOCKED, no re-litigation per CONTEXT.md):
          - `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-CONTEXT.md`
            — the phase boundary + scope-fence
          - `~/.claude/identities/tina/tina.md` § Skynet direction — Ship
            of Theseus (dead-surfaces canonical list, palette authority,
            "conversation list + pretty view is all Ashley sees" heuristic,
            "it is ONE project, not a collection of bounties" fleet lock)
          - `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/`
            — the bounty premise, Ashley's UAT quote, the todo set
            (landing-surface swap, AppRail retirement, per-surface
            enumeration + prove-dead + delete-with-atomic-commits)
          - `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-STRIP-LIST.md`
            — the audit-input contract Plans 02 + 03 consumed
          - `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)
            — the AUTHORITATIVE current deploy source (the fork CLAUDE.md's
            15-min deadman reference is STALE, retired 2026-07-21, separate
            `claude-md-15min-deadman-stale` bounty tracks the update)

        * **Rebase risk**: HIGH — accept the divergence per CONTEXT.md
          § scope-fence discipline. Upstream Skynet keeps evolving the
          AppRail + dashboard + host-manager + admin-console surfaces this
          patch deletes; our fork just doesn't have them anymore. When we
          next rebase against upstream `main`, deleted-file conflicts
          resolve to "stays deleted" — this is intentional. AppShell.tsx's
          rail-view state machine + panel-imports strip is a big surgical
          delta; if upstream reworks the same region there will be a textual
          merge conflict but the resolution is mechanical (accept the strip
          + preserve any new upstream sidebarPanelContent-adjacent additions
          that don't reintroduce AppRail). Grep for `AppRail` in any post-
          rebase `AppShell.tsx` to sanity-check that no upstream re-add
          survived the merge.

        * **Commits** (all on `feat/tab-title-from-tmux`):
          - **Plan 01 (docs — strip-list)**: 1 commit
            - `b19fc20` `docs(11-01): enumerate strip-list for landing-
              surface swap + AppRail retirement`
              (SUMMARY at `af347d1`'s predecessor `197c069`
              `docs(11): begin phase execution`)
          - **Plan 02 (landing swap)**: 3 commits
            - `8ae9baf` `feat(11-02): add PrettyLandingCard component`
              (src/ui/features/pretty-view/PrettyLandingCard.tsx +
              PrettyLandingCard.test.tsx — 4 tests, all passing)
            - `22b5cfb` `feat(11-02): swap dashboard render to
              PrettyLandingCard in tabUtils`
              (src/ui/shell/tabUtils.tsx — `case "dashboard"` case-body
              swapped, DashboardTab import removed)
            - `425ba1f` `feat(11-02): rename dashboard nav labels to
              conversations` (src/ui/AppShell.tsx — 2 label lines)
            - `af347d1` `docs(11-02): summary` (SUMMARY only)
          - **Plan 03 (retirement — post B-3 split into 5 atomic tasks)**:
            5 commits
            - `b68a821` `test(pretty-conversations): prune Test 11
              (settingsRowSlot mobile position — Phase 11 retires settings
              surface)`
            - `cf7fe27` `refactor(app-shell): strip rail-view state machine
              + AppRail/SettingsRow mounts + 10 dead panel branches +
              profileDropdownOpen (Phase 11 PURGE-02, PURGE-03)`
              — the heaviest single commit; 386 lines deleted, 46 added,
              net −340
            - `992bee3` `refactor(pretty-conversations): drop vestigial
              settingsRowSlot prop (Phase 11 PURGE-03)`
            - `c3c84be` `chore(sidebar): delete retired SettingsRow.tsx
              (Phase 11 PURGE-03 — Ashley's "no settings" lock)`
              (198 lines deleted)
            - `c386068` `chore(sidebar): delete retired AppRail.tsx
              (Phase 11 PURGE-02)` (283 lines deleted)
            - `cbff367` `docs(11-03): summary — AppRail + SettingsRow
              retirement + rail-view state-machine strip complete`
          - **Plan 04 (docs — build-verify + UAT + this patches-md draft)**:
            1 commit (see the docs commit landing this file, the
            11-BUILD-VERIFY-LOG.md, and the 11-UAT-CHECKLIST.md alongside
            the 11-04-SUMMARY.md — SHA `[Plan-04 docs SHA — fill in after
            commit]`).

        * **Deploy status**. Code-complete on `feat/tab-title-from-tmux` at
          `[Plan-04 tip SHA — fill in after commit]`. NOT YET pushed, NOT
          YET deployed, image NOT YET built. Batched with subsequent Phase
          12+ purge patches per Ashley 2026-07-23 fleet-standing "batch
          patches into meaningful deploys" rule. Deploy sequence documented
          at `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-UAT-CHECKLIST.md`
          under "Post-UAT deploy runbook" (authoritative source cited:
          `~/.claude/identities/tina/deploy-runbook.md`, NOT the fork
          CLAUDE.md's stale 15-min deadman reference which is retired
          fleet-wide since 2026-07-21).

---

## Fill-in placeholders (before pasting)

Before pasting into skynet-patches.md, replace the following (obtain from `git rev-parse --short HEAD` immediately after the Plan 04 docs commit):

- `[Plan-04 docs SHA — fill in after commit]` — from `git rev-parse --short HEAD` right after the Plan 04 docs commit lands (the single commit including 11-BUILD-VERIFY-LOG.md + 11-UAT-CHECKLIST.md + 11-PATCHES-MD-ENTRY.md + 11-04-SUMMARY.md per Plan 04 orchestrator prompt: three separate commits per the plan text — `docs(11-04): phase 11 build verification log`, `docs(11-04): phase 11 UAT checklist + patch #138 draft`, `docs(11-04): summary`. The SHA to record here is the third and final commit).
- `[Plan-04 tip SHA — fill in after commit]` — the same SHA (Plan 04 tip is the third docs commit).

The bundle-size delta values (−373 kB / −83%), vitest counts (524/526), and grep-gate results are all resolved from `11-BUILD-VERIFY-LOG.md` and do not need further substitution.

## Post-paste bookkeeping

After pasting into skynet-patches.md:

1. Update the count line near the top of the file from "ONE HUNDRED THIRTY-SEVEN numbered patches" to "ONE HUNDRED THIRTY-EIGHT numbered patches" (verify current count first with `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3` — if an interstitial patch pinned first, adjust accordingly).
2. Commit the pin: `docs(patches): pin patch #138 — Skynet transformation first slice`.
3. Do NOT `/close skynet-transformation-purge-dead-surfaces` yet if Phase 12+ is still ahead in the bounty's todo set — the bounty's canonical dead-surfaces list includes items (host manager UI pages, snippets manager, admin console, dashboard/ tree file deletion, backend-route deletion, dead-locale-string sweep) that Phase 11 explicitly deferred. Only close the bounty when all its todo items are landed. If Phase 11's "first slice" is deemed a milestone worth acknowledging without closing the bounty, add a comment to the bounty's `notes.md` or equivalent (per Tina's bounty catalog convention) noting "patch #138 lands the first slice: landing swap + AppRail + SettingsRow retirement. Phase 12+ handles the follow-up sweep."
4. Update `~/.claude/identities/tina/tina.md` compact overview if warranted: Phase 11 is presentation-only and the "Ship of Theseus" section already anticipates it, so likely no tina.md update needed for the first slice. The moment Phase 12+ lands the dashboard/ tree deletion + backend-route deletion, tina.md's box-map may need a Skynet operational-context adjustment (fewer routes served → smaller nginx.conf → note the reduction in the "Nginx caveat" line).
