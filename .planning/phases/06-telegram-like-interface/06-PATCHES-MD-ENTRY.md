# Phase 6 termix-patches.md entry — DRAFT for pin time

**Instructions for Ashley at pin time:**

1. Assign the patch number — likely **`NNN. = 105.`** (check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/termix-patches.md | tail -3` — if an interstitial pin landed since Phase 5, bump to the next available integer).
2. Paste the entry BELOW (from the "```105.…```" fenced block) into `~/.claude/identities/tina/termix-patches.md` at the appropriate ordinal position (immediately after patch #104 — Phase 5 file uploads).
3. Bump the "ONE HUNDRED FOUR numbered patches" line near the top of the file to "ONE HUNDRED FIVE" (or actual new count).
4. Commit the pin.

**IMPORTANT — MULTI-COMMIT PATCH:** Unlike most patches (which typically ship as a single feature commit), patch #105 is a **MULTI-COMMIT patch** — Phase 6 shipped as 4 code-work waves + 1 verify wave, each wave containing 1-3 commits, all landing under this ONE patch number. The 9 code commits on `feat/tab-title-from-tmux` between `3cd3e35^..12a41a9` all belong to patch #105:

- `4bc6b2a` — feat(phase-6): conversation-store with pins + host-tree derivation + 14 tests (Plan 06-01 Task 1)
- `1f6ef65` — feat(phase-6): ConversationsPanel + ConversationRow with identity + pin toggle (Plan 06-01 Task 2)
- `d70ef63` — feat(phase-6): atomic swap — delete TabBar, wire ConversationsPanel (Plan 06-02 Task 1)
- `75338e8` — test(phase-6): persistence-contract smoke test — T-06-02-01 defense (Plan 06-02 Task 2)
- `bbc8c66` — feat(phase-6): mobile-flow module + tab-url mobileView extension (Plan 06-03 Task 1)
- `936ff3d` — feat(phase-6): wire mobile flow into AppShell, delete MobileBottomBar (Plan 06-03 Task 2)
- `56d74c0` — feat(phase-6): selectConversationDeferred + pendingSelectId race defense (Plan 06-04 Task 1)
- `2197282` — feat(phase-6): NewSessionButton + NewSessionDialog with host picker + client-side validation (Plan 06-04 Task 2)
- `12a41a9` — feat(phase-6): wire NewSessionButton + Dialog into ConversationsPanel + AppShell (Plan 06-04 Task 3)

Plus 5 planning-artifact commits (`docs(06-01)` through `docs(06-05)`) — those don't belong to the patch itself (they're the planning paper trail), so no pin action for them. Precedent: Phase 5 was similarly 8 code commits + 4 docs commits (see the "Files touched" note in patch #104 which references `e598643..71bf410`).

---

## Entry — ready to paste

```
   105. `feat(navigation): telegram-like interface — sidebar conversation
        list, tab strip removed, mobile list-vs-view flow, session
        persistence across switches` — Phase 6, shipped 2026-07-21.
        Reshapes Termix's top-level navigation model around a Telegram-
        style single-select conversation list. Sidebar becomes a flat
        list of currently-active sessions (grouped by host with
        separators, per-session pins float on top). Tab strip removed
        entirely. Mobile: list-vs-view two-screen flow with top-left
        back button; bottom navigation bar deleted. Admin destinations
        retreat to a gear icon on desktop and a settings row on mobile.
        Selection persistence preserved within a page-load — switching
        conversations is hide-not-unmount (WebSocket, terminal buffer,
        pretty-view scroll, ambient panels all preserved across
        switches; refresh resets from scratch). **Multi-commit patch
        (9 code commits landing across 4 waves + 1 verify wave under
        this one patch number)** — see git log
        `feat/tab-title-from-tmux 4bc6b2a..12a41a9` for the full sequence.

        * **Motivation** (from shape file). Termix has been drifting
          toward Telegram-shape for months (pretty view, expanding
          sidebar, mobile-bottom-nav gate). Ashley uses it like a chat
          client to talk to agents on remote boxes, not like a tab
          manager. This work names the drift and completes it — deletes
          the tab strip, collapses the mental model into "conversations,"
          and moves admin surfaces out of the way. Shape file lives in
          the repo at `.planning/shapes/shape-telegram-like-interface.md`
          (LOCKED 2026-07-21).

        * **New conversation-store (in-memory).** Module-scoped store
          (`src/ui/state/conversation-store.ts`) mirrors identities-store
          pattern (useSyncExternalStore + Set<() => void> listener
          registry + module-scoped Map/Set). Derives a `{pinned,
          grouped}` view from AppShell's live `tabs` + `realHostTree`.
          Order below pins is the existing sidebar host-tree order (no
          new sort rule, no recency shuffle — "the way it currently
          works is fine" — Ashley 2026-07-21). Pins are per-session;
          session-end clears pin along with the row. Single-select via
          `selectedId` with stale-pointer defense (T-06-01-01 — coerces
          to null when the id is no longer in tabs). No localStorage /
          sessionStorage / IndexedDB — persistence is page-load only
          per shape lock. **14 Vitest cases** in
          `conversation-store.test.ts` cover the semantics; Plan 06-04
          extended with 8 more (Tests 13-18) for the race defense.

        * **Tab strip DELETED.** `src/ui/shell/TabBar.tsx` removed from
          the repo entirely (620 lines gone). NO feature flag, NO user-
          facing toggle to restore, NO conditional rendering. AppShell's
          DOM-node-stability mechanism (patch #35's `tabNodesRef` +
          `normalViewRef` + DOM-move effect + `createPortal` loop)
          UNCHANGED in structure — only the "visible-inline" tab-id
          selector changes from `activeTabId` to `effectiveSelectedTabId
          = selectedConversationId ?? activeTabId`. Result: switching
          conversations is instant with zero reconnect because the DOM
          nodes stay mounted throughout, hidden via visibility toggle.
          The `isVisible` signal passed to each mounted pane continues
          to fire under the same semantics (WipBubble, PlanPendingBubble,
          MessageQueueDrawer, SessionHoldingOverlay all unaffected).
          **T-06-02-01 mount-lifecycle-regression contract is verified
          programmatically** by `src/ui/AppShell.persistence.test.tsx` —
          3 Vitest cases via a MountManager scaffold that reproduces
          the patch #35 mechanism in ~60 lines of test-only code and
          asserts DOM node identity + mount-count invariant + visibility
          toggle across A→B→A switches. Full-AppShell integration tests
          (URL sync, document.title effect, stale-id end-to-end) are
          deferred to UAT per plan-check NOTE-08 (AppShell's ~30 imports
          would produce a fragility-dominant test scaffold).

        * **Mobile flow.** `src/ui/lib/mobile-flow.ts` — small state
          machine keyed on a new `#mv=1` URL fragment key layered over
          patch #25's `#tab=` scheme. On touchscreen viewports
          (`useIsTouchDevice()` from patch #102 — SOLE mobile-vs-desktop
          signal per shape hard lock) the tree renders list-full-screen
          OR view-full-screen based on `useMobileScreen()`. Top-left
          back button (MobileViewHeader) calls `navigateToList()`;
          browser back gesture also works via popstate + a
          `{ __termixMobileView: true }` history-state sentinel that
          lets `navigateToList` prefer `history.back()` for a consistent
          back-stack when we own the entry. `mv=1` survives Chrome
          window-restore for the same reason `tab=` does — it lives in
          the fragment, not the query string (patch #25's Chrome-restore
          lesson generalized to a second key). `src/ui/lib/tab-url.ts`
          extended with `WorkspaceSpec.mobileView` optional field —
          `encodeWorkspaceSpec` writes `&mv=1`, `consumePendingWorkspace`
          parses with strict `=== '1'` boolean coerce (Test 10 asserts
          `mv=0`, `mv=yes`, `mv=true` all parse to false).
          `MobileBottomBar.tsx` DELETED (155 lines gone); its
          destinations (host-manager, credentials, connections,
          quick-connect, ssh-tools, snippets, history, split-screen,
          user-profile, admin-settings) migrated to a `SettingsRow`
          component mounted at the BOTTOM of the mobile ConversationsPanel
          via a new `settingsRowSlot` prop (position chosen so it doesn't
          compete with pinned or active rows for prime attention — TG-10
          lock). **11 Vitest cases** in `mobile-flow.test.ts` cover
          initial parse + navigate actions + encode/consume round-trip
          + malformed values + cross-device link portability.

        * **Settings surface — desktop gear + mobile row share ONE
          renderer.** Small gear icon in the ConversationsPanel header
          (unobtrusive per shape lock, admin-gated at the menu-render
          level via `isAdmin` prop filter — T-06-02-04 preserved).
          Dropdown routes via the existing `handleRailClick` to admin
          destinations. Mobile `SettingsRow` (`src/ui/sidebar/
          SettingsRow.tsx` — NEW file, isolated from ConversationsPanel
          per plan-check NOTE-07 clarification) exports both
          `SettingsRow` (mobile-mount component) and
          `renderSettingsMenuItems` (pure JSX-array helper). Desktop
          gear icon consumes `renderSettingsMenuItems` — ONE
          `SETTINGS_MENU_ITEMS` registry drives both surfaces so the
          10-destination menu can never drift between mobile and desktop.

        * **New-session button.** `src/ui/sidebar/NewSessionButton.tsx`
          (26 lines) + `NewSessionDialog.tsx` (256 lines) — visible
          full-width primary CTA at TOP of ConversationsPanel scroller
          ABOVE pins (both mobile and desktop). Click opens a Radix
          Dialog modal host picker: filterable flat host list from
          `realHostTree` (via inlined `collectAllHosts` DFS walker;
          case-insensitive substring match on name / username / ip),
          optional session-name input (empty = server auto-fills from
          tmux window title via the fork's `feat/tab-title-from-tmux`
          patch #1 behavior). Client-side name validation
          `SESSION_NAME_PATTERN = /^[\w-]{0,64}$/` as belt-and-suspenders
          (backend tmux path sanitization unchanged and remains the
          actual security boundary — T-06-04-01). On create:
          `openTab(host, "terminal", ..., { targetTmuxSession, label,
          allowCreateTmux: true })` then `selectConversationDeferred`
          (new store action) to auto-navigate the new session — the
          `pendingSelectId` state defends against the React setState-
          then-select race (T-06-04-04). **10 Vitest cases** in
          `NewSessionDialog.test.tsx` (9 in-isolation + 1 integration
          asserting button-before-rows DOM order via
          `data-conversation-id` selector).

        * **Race defense (T-06-04-04).** The naive
          `openTab(...) → selectConversation(newId)` sequence silently
          drops the selection because React batches the `setTabs` inside
          `openTab` and the immediate `selectConversation(newId)` call
          would no-op (id not yet in openTabs → T-06-01-01 stale-guard
          rejects). Deterministic fix: new public store action
          `selectConversationDeferred(id)` parks the id in a module-
          scoped `pendingSelectId` slot; `updateOpenTabs` flushes the
          pending id when it arrives in a subsequent tabs update.
          `selectConversation` restructured per plan-check NOTE-03
          re-decision (stale-guard FIRST so stale calls don't cancel
          pending; pending-clear BEFORE the no-change return so
          direct-same-id selects still cancel in-flight deferreds).
          Test 17's split (a: same-id clears pending; b: stale-id
          preserves pending) is the specific defense against the naive
          first-draft placement.

        * **Threat model addressed.** Path-traversal / injection
          surfaces are all indirect (session names → tmux → shell);
          client-side input validation + existing backend sanitization
          handle. URL scheme collision handled by keeping `mv=` short
          and reserved (T-06-03-01). Stale-selection defense
          (T-06-01-01) prevents "phantom active row" UX. Stranded-user
          defense (T-06-03-06) auto-returns mobile users to the list
          when their viewed conversation ends. Race defense (T-06-04-04)
          via `pendingSelectId`. Settings authorization (T-06-02-04)
          preserved via existing `isAdmin` gate at the menu-render
          level. Zero new supply-chain surface (T-*-SC) — no new npm
          dependencies added in any of the 4 plans.

        * **What we DIDN'T do** (deferred-to-v2 per shape lock):
          - Any activity/unread signal (dots, badges, counts, motion,
            sound) — Ashley 2026-07-21 "we can save it for version two"
          - Cross-conversation search — Ashley "I don't need it" — OUT
            entirely, not v2
          - Folder / nested-grouping above host separators — OUT
          - Drag-to-reorder for pins — OUT (simple pin-toggle only)
          - History / scrollback for ended sessions — OUT (rows vanish
            on session-end)
          - Persisting selected conversation across browser refreshes —
            OUT (in-memory only)
          - Auto-restoring "last set of open conversations" — OUT
          - A per-session view toggle to flip pretty view to raw
            terminal on mobile — Ashley "I don't need something on
            mobile to access the underlying session"
          - Keyboard tab-nav refinement (Ctrl+Shift+[/] still cycles
            all tabs including singletons) — deferred to a future
            bounty per plan-check NOTE-06; Ashley rarely uses this per
            user-profile inference

        * **Verify post-deploy invariants** (for future rebase smoke
          checks — Vite mangles most user-defined identifiers, so
          verifications lean on i18n key strings + URL-fragment
          literals + backend markers that survive minification):
          - `docker exec termix grep -oc 'nav.conversations' /app/dist/assets/AppShell-*.js` → ≥ 20 (i18n namespace — was 24 at ship)
          - `docker exec termix grep -oc 'newSession' /app/dist/assets/AppShell-*.js` → ≥ 8 (9 nav.newSession* keys + label — was 10 at ship)
          - `docker exec termix grep -oc 'settingsMenu' /app/dist/assets/AppShell-*.js` → ≥ 10 (10 SETTINGS_MENU_ITEMS keys)
          - `docker exec termix grep -oc 'backToList' /app/dist/assets/AppShell-*.js` → ≥ 1 (mobile back button aria + title)
          - `docker exec termix grep -oc 'mobileView' /app/dist/assets/AppShell-*.js` → ≥ 1 (URL scheme field name)
          - `docker exec termix grep -c 'MobileBottomBar\|TabBar' /app/dist/assets/*.js` → **0** (deletions confirmed — 0 across all chunks at ship)
          - `docker exec termix grep -oc 'appendChild' /app/dist/assets/AppShell-*.js` → ≥ 5 (patch #35 DOM-move — was 6 at ship; tabNodesRef identifier is mangled but appendChild semantic is preserved)
          - `docker exec termix grep -c 'message_queue_delete_on_send' /app/dist/backend/backend/ssh/terminal.js` → ≥ 1 (patch #60 preserved)
          - `docker exec termix grep -c 'ssh_input_delayed_enter' /app/dist/backend/backend/ssh/terminal.js` → ≥ 1 (patch #100 preserved)
          - `docker exec termix grep -oc 'pointer: coarse' /app/dist/assets/Terminal-*.js` → ≥ 1 (patch #102 preserved)
          - `docker exec termix grep -oc '/compose-drafts' /app/dist/assets/Terminal-*.js` → ≥ 3 (patch #57 preserved)

        * **Files touched** (16 source files: 8 NEW, 5 modified, 2
          DELETED, 1 i18n):
          - `src/ui/state/conversation-store.ts` — NEW (381 lines +
            52 lines Plan 06-04 extension = ~433 total), module-
            scoped store + hooks + test helpers
          - `src/ui/state/conversation-store.test.ts` — NEW (409 lines
            + 192 lines Plan 06-04 extension = ~601 total), 22 Vitest
            cases (14 core + 8 race-defense)
          - `src/ui/sidebar/ConversationsPanel.tsx` — NEW panel; ~279
            lines total including Plan 06-02's gear-icon extension
            (~82 lines) + Plan 06-03's `onConversationSelected` +
            `settingsRowSlot` props (~30 lines) + Plan 06-04's
            NewSession* wiring (~55 lines)
          - `src/ui/sidebar/ConversationRow.tsx` — NEW (150 lines),
            single-row component with identity avatar + hue tint (reuses
            TabBar.tsx renderTabIcon + tabTintStyle idiom verbatim) +
            pin toggle
          - `src/ui/sidebar/SettingsRow.tsx` — NEW (198 lines),
            SettingsRow component + `renderSettingsMenuItems` shared
            renderer + 10-entry SETTINGS_MENU_ITEMS registry
          - `src/ui/sidebar/NewSessionButton.tsx` — NEW (26 lines),
            primary CTA button with Plus icon
          - `src/ui/sidebar/NewSessionDialog.tsx` — NEW (256 lines),
            Radix Dialog wrapper + filterable host list + optional
            session-name input with client-side validation
          - `src/ui/sidebar/NewSessionDialog.test.tsx` — NEW (398 lines),
            10 Vitest cases
          - `src/ui/lib/mobile-flow.ts` — NEW (156 lines), subscribe
            store + useSyncExternalStore hook + navigateToView/List
            imperative actions
          - `src/ui/lib/mobile-flow.test.ts` — NEW (206 lines), 11
            Vitest cases
          - `src/ui/lib/tab-url.ts` — extended (+15/-1),
            `WorkspaceSpec.mobileView` field + `mv=1` encode/parse
          - `src/ui/sidebar/AppRail.tsx` — extended (+8/-0),
            `conversations` RailView + MessagesSquare icon + rail button
          - `src/ui/AppShell.tsx` — extensively edited (+296/-150 net
            across 3 plans): conversation-store imports + effects +
            `effectiveSelectedTabId` memo + store→AppShell mirror
            effect; TabBar import + mount + `refreshTab` +
            `onReorderTabs` wiring REMOVED; sidebarPanelContent gains
            `conversations` branch at top; sidebarTitle map extended;
            default railView `hosts` → `conversations`; DOM-placement
            effect activeInline calc swapped `activeTabId` →
            `effectiveSelectedTabId`; createPortal isVisible swapped;
            normal-view split-gate swapped; fit-on-active-change effect
            deps extended; mobile-flow imports; `isMobileListScreen`
            + `isMobileViewScreen` + `activeConversationLabel`
            derivations; URL-sync effect extended with `mobileView`
            field; T-06-03-06 stranded-user defense useEffect;
            `sidebarOpenBeforeMobile` auto-close gated on
            `!isTouchDevice`; desktop chrome (AppRail rail, inline
            sidebar, narrow-desktop Sheet, chevron-right reveal)
            additionally gated on `!isTouchDevice`; full-viewport
            list-screen `<div>` render on isMobileListScreen; main-
            content CSS-hidden (0-width flex-basis + aria-hidden) on
            list-screen so createPortal + normalViewRef stay mounted
            (patch #35 preservation); MobileBottomBar mount block
            removed; NewSession wiring (`hostTree={realHostTree}` +
            `onCreateSession` chaining openTab +
            selectConversationDeferred + navigateToView + setSidebarOpen)
          - `src/ui/AppShell.persistence.test.tsx` — NEW (383 lines),
            3 Vitest cases via MountManager scaffold — programmatic
            guard for T-06-02-01 mount-lifecycle-regression contract
          - `src/ui/shell/TabBar.tsx` — **DELETED** (620 lines gone)
          - `src/ui/shell/MobileBottomBar.tsx` — **DELETED** (155
            lines gone)
          - `src/ui/locales/en.json` — 21 additive i18n keys total
            across the 4 code plans (nav.conversations.{empty, pin,
            unpin, title, settings, backToList} + 10 settingsMenu*
            + 10 newSession* + common.open); zero JSON round-trips
            (targeted `Edit` tool only per Plan 06-01's hard-learned
            lesson about the file's 4 pre-existing duplicate `addHost`
            keys)

          Test suite: 22 conversation-store + 11 mobile-flow + 10
          NewSessionDialog + 3 AppShell.persistence = **46 new Vitest
          cases**. Grand total after Phase 6: **301/301 tests pass
          across 24 files** (was 255/255 pre-Phase-6 per Plan 06-01's
          baseline).

        * **Rebase risk**: **HEAVY on `src/ui/AppShell.tsx`** — this
          patch is the largest AppShell edit surface in the fork's
          history (single-file net +296/-150 across the 3 plans that
          touched it — 06-02, 06-03, 06-04). Upstream restructuring
          of any of AppShell's tab-manager territory (the DOM-move
          effect, `createPortal` loop, URL-sync effect, sidebar
          rendering, mobile viewport branch, RailView switch)
          requires careful re-apply. **Preservation invariants to
          hold on rebase**: (1) the byte-for-byte identity of patch
          #35's tabNodesRef DOM-move mechanism at the AppShell.tsx
          effect + createPortal loop — the ONLY value that should
          differ from pre-patch is `activeInline = tab.id ===
          effectiveSelectedTabId` (was `=== activeTabId`); (2) the
          `!isTouchDevice` guard on the sidebarOpenBeforeMobile
          effect; (3) the `!isTouchDevice` gates on AppRail +
          inline sidebar + narrow-Sheet + chevron-right reveal;
          (4) the mobileScreen === "view" gate + activeConversationLabel
          derivation for MobileViewHeader; (5) the T-06-03-06
          stranded-user defense useEffect; (6) the store→AppShell
          mirror effect (one-way only, NOT bidirectional). Verify
          `src/ui/AppShell.persistence.test.tsx` still passes after
          rebase — the MountManager scaffold reproduces the DOM-move
          mechanism verbatim, so a drift on rebase will trip it.
          **LOW on all new files** — fork-only, no upstream conflict
          surface (`conversation-store.ts`, `ConversationsPanel.tsx`,
          `ConversationRow.tsx`, `SettingsRow.tsx`, `NewSessionButton.tsx`,
          `NewSessionDialog.tsx`, `mobile-flow.ts`,
          `AppShell.persistence.test.tsx` + all their test files).
          **LOW-MEDIUM on `src/ui/lib/tab-url.ts`** — small surgical
          extension; upstream doesn't have this file (patch #25 own).
          **LOW on `src/ui/sidebar/AppRail.tsx`** — 8-line additive
          (new RailView + icon + button entry). **The TabBar +
          MobileBottomBar deletions are trivial to re-apply if the
          files reappear upstream** — `git rm` them again.

        * **Deploy note**: shipped behind the mandatory 15-min deadman
          per Ashley 2026-07-03 with explicit per-deploy green light
          per Ashley 2026-07-12 (see `deploy-runbook.md` under Tina's
          identity — "DEADMAN IS MANDATORY. NO EXCEPTIONS" + "BLANKET
          PRE-AUTHORIZATION ≠ PER-DEPLOY GREEN LIGHT"). This is a
          **substantial user-visible change** — the tab strip and
          mobile bottom nav are gone; the primary navigation model
          is different from every prior fork state. The deadman +
          narrow-`pkill` disarm-on-Ashley-engagement pattern is
          especially important here. Deploy sequence in the
          canonical runbook step 1-9 (arm before container recreate,
          disarm on Ashley's UAT green, let fire on failure). Zero
          new npm dependencies (`git diff --stat package.json
          package-lock.json` = empty). Zero new nginx location
          blocks (Phase 6 is frontend-only; no backend routes added).
          Standard `sudo bash /opt/termix/termix-patches/build-termix.sh`
          + `sudo docker compose up -d --force-recreate termix`.
          UAT checklist for the walk-through:
          `~/termix/.planning/phases/06-telegram-like-interface/
          06-UAT-CHECKLIST.md` (70 blocking gates covering TG-01..11
          + persistence + mobile flow + negative-space + regression
          smoke against patches #25/#35/#57/#60/#100/#102).
          Related bounty:
          `~/.claude/identities/tina/bounties/telegram-like-interface/`
          — close via `/close telegram-like-interface` after she
          signs off on UAT.
```

---

## Post-pin actions checklist

After paste + count-bump + commit:

- [ ] `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/termix-patches.md | tail -3` shows the new 105. entry at the appropriate position
- [ ] "ONE HUNDRED FOUR" → "ONE HUNDRED FIVE" (or actual count) bumped near top of file
- [ ] Pin commit landed on `~/.claude/identities/tina/` (the identities repo)
- [ ] `/close telegram-like-interface` closes the bounty
