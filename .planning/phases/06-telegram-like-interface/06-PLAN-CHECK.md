# Phase 6 Plan Check — Telegram-like Interface

**Checked:** 2026-07-21
**Checker:** gsd-plan-checker (goal-backward verification)
**Plans reviewed:** 06-01, 06-02, 06-03, 06-04, 06-05
**Repo state:** `/home/ubuntu/skynet` @ `feat/tab-title-from-tmux`
**Authoritative sources:** shape-telegram-like-interface.md + 06-CONTEXT.md (both LOCKED)

## Overall verdict: **PASS_WITH_NOTES**

All five plans, executed in wave order 1→5, would deliver every one of the ten success criteria in CONTEXT.md §Success Criteria and every TG-01..11 requirement. The load-bearing engineering commitments — patch #35 `tabNodesRef` DOM-move mechanism preservation, patch #25 URL-fragment approach for mobile-view survival across Chrome window-restore, `useIsTouchDevice()` as the single mobile-detection surface, zero touches to `src/ui/features/pretty-view/**`, zero new npm deps, zero backend/docker/nginx changes — are all correctly named and enforced by acceptance-criteria grep gates.

Notes (non-blocking) center on: (1) an internal contradiction in 06-01/06-02's coupling story vs. the executor's shipping expectations, resolved by 06-05 owning the actual deploy but worth flagging so the executor doesn't ship 06-01 alone; (2) `useKeyboardTabNav` cycling behavior after tab-strip deletion needs the follow-up 06-04 refinement the plan already acknowledges but doesn't own; (3) a small race between 06-04 Test 10 (button-before-rows DOM ordering) and 06-02's assumption that ConversationsPanel headers can be empty; (4) the 06-05 build-verify's patch #35 grep gate for `tabNodesRef` in a minified bundle is unreliable and the plan flags this candidly with a fallback; (5) missing explicit rebase/absorption of 06-04's `NewSessionButton` at "top-of-list ABOVE pins" into ConversationsPanel's Plan-06-01 sketch (which currently doesn't reserve the slot); and (6) `useConversations()` derivation triggering on every host-tree poll may cause visible thrash if the store re-emits reference-inequal snapshots.

## Per-plan verdicts

| Plan | Wave | Tasks | Files | Verdict | Notes |
|------|------|-------|-------|---------|-------|
| 06-01 | 1 | 2 (both auto, one tdd) | 4 (2 NEW src + 1 NEW test + 1 NEW component) | **PASS** | Foundation is genuinely foundation — no user-visible change; 12-test coverage of store; identities-store pattern reused; scope-fence enforced via grep gates on `localStorage`/`sessionStorage`/`zustand`/etc. |
| 06-02 | 2 | 2 (auto + tdd) | 4 (AppShell + AppRail + ConversationsPanel + DELETED TabBar) | **PASS_WITH_NOTES** | The load-bearing plan. Patch #35 preservation is correctly framed as "swap `activeTabId` → `effectiveSelectedTabId` in TWO places, byte-otherwise-identical." Persistence smoke test in Task 2 has a candid fallback path when full-AppShell-mock proves too fragile. Notes: `useKeyboardTabNav` deferral, `refreshTab` orphan handling deferred to executor discretion, and `SettingsRow` may live in ConversationsPanel.tsx OR a new file — this ambiguity flows to 06-03 which mounts it. |
| 06-03 | 3 | 2 (auto + tdd) | 5 (AppShell + DELETED MobileBottomBar + NEW mobile-flow + extension to tab-url + NEW test) | **PASS_WITH_NOTES** | Fragment-scheme extension is correct and honors patch #25's ground-truth. The "stranded user" defense (T-06-03-06) is called out and wired. Note: `mv=1` on desktop-loaded URL is deliberately IGNORED (T-06-03-05) — this is correct but the UAT checklist in 06-05 doesn't call it out as a cross-device deep-link test. Also: the Step D "single-outer-div-with-hidden-children" vs "extracted-TabPortalRoot" decision is left as executor discretion with a recommendation — this is prudent given the DOM-move fragility, but the wave-3 executor is inheriting a genuinely hard tree-restructuring judgment call. |
| 06-04 | 4 | 3 (auto + tdd + auto) | 7 (2 NEW components + 1 NEW test + extension to ConversationsPanel + extension to conversation-store + extension to store test + extension to AppShell) | **PASS_WITH_NOTES** | Race defense (`selectConversationDeferred` + `pendingSelectId`) is well-motivated: React batches the `setTabs` inside `openTab` and the immediate `selectConversation(newId)` call would no-op because the id isn't in openTabs yet. Test 17 correctness question: the plan first says "at the top of `selectConversation`" then re-decides "AFTER the guard but BEFORE the no-change return" — the re-decision is correct; executor must land the re-decision. Note: Test 10 (button-before-rows) requires 06-01's ConversationsPanel to have reserved the top-of-scroller slot; 06-01 leaves the panel header "empty or with a Separator" and does NOT explicitly reserve the button slot at the TOP of the scroller (button sits above pins per 06-04, not inside the header). 06-04's ConversationsPanel extension in Step B inserts `<NewSessionButton>` at the top of the scroller with a bordered wrapper — this is a chrome addition 06-01's scroller layout allows for, so it will fit, but the interaction with the pins-at-top layout (also at scroller top) needs the executor to place them in the correct DOM order. |
| 06-05 | 5 | 3 auto + 1 checkpoint | 3 (all .md — zero source diffs) | **PASS_WITH_NOTES** | Matches Phase 5's 05-04-PLAN pattern verbatim. Build verify + UAT checklist + patches-md-entry draft + explicit deadman-armed deploy per deploy-runbook.md. Note: The Task 1 grep gate for `tabNodesRef` in `dist/assets/*.js` is candidly acknowledged as unreliable (minifier may mangle) and offers `appendChild` as a fallback with subjective read — this is appropriate honesty but the plan should probably grep for a distinctive body string in patch #35's territory instead of the ref name. |

## Requirement coverage matrix (TG-01..11 → covering plan)

| Req | Description (abbrev.) | 06-01 | 06-02 | 06-03 | 06-04 | 06-05 | Status |
|-----|-----------------------|-------|-------|-------|-------|-------|--------|
| TG-01 | Flat list, host-grouped, session-end vanishes | ✓ (store + panel) | | | | ✓ (UAT) | COVERED |
| TG-02 | Per-session pin, floats above host groups | ✓ (store + row) | | | | ✓ (UAT) | COVERED |
| TG-03 | Single view, tab strip gone | | ✓ (TabBar DELETED + selectedId as source of truth) | | | ✓ (UAT) | COVERED |
| TG-04 | Internal experience unchanged | | ✓ (zero-touch fence enforced) | | | ✓ (UAT) | COVERED |
| TG-05 | Persistence: hide-not-unmount | | ✓ (tabNodesRef reuse + persistence smoke test) | | | ✓ (UAT) | COVERED |
| TG-06 | Mobile list-vs-view + back button + browser back | | | ✓ (mobile-flow + MobileViewHeader + popstate) | | ✓ (UAT) | COVERED |
| TG-07 | Mobile bottom nav DELETED | | | ✓ (file removed + AppShell mount site removed) | | ✓ (UAT) | COVERED |
| TG-08 | Desktop sidebar collapse preserved verbatim | ✓ ("drop-in for HostsPanel content slot" — AppShell sidebar-width/collapse untouched) | | | | ✓ (UAT) | COVERED |
| TG-09 | Visible new-session button + host picker + auto-navigate | | | | ✓ (NewSessionButton + Dialog + AppShell.onCreateSession) | ✓ (UAT) | COVERED |
| TG-10 | Admin destinations retreat to gear (desktop) + row (mobile) | | ✓ (gear icon + SettingsRow COMPONENT) | ✓ (SettingsRow mounted on mobile via settingsRowSlot) | | ✓ (UAT) | COVERED |
| TG-11 | Full replacement, no toggle, tabs unconditionally gone | | ✓ (TabBar deleted, no feature flag, no conditional) | | | ✓ (UAT) | COVERED |

**Coverage: 11/11 requirements — every TG-NN appears in ≥1 plan's `requirements` frontmatter AND is discharged by concrete task(s).** No unmapped requirements. Every requirement has ≥1 UAT check.

## Success Criteria coverage (CONTEXT.md §Success Criteria items 1-10)

The 10 numbered items in CONTEXT.md's success-criteria block:

| SC | Description (abbrev.) | Proven by | Verified in |
|----|-----------------------|-----------|-------------|
| SC1 | Sidebar shows flat list, host-grouped, pins on top, rows disappear on session-end | Plan 06-01 (store derivation + panel render + Test 5 session-end coercion) + Plan 06-02 (mounts panel under new RailView) | 06-05 UAT Desktop happy-path (TG-01, TG-02) |
| SC2 | Clicking a row displays that conversation; only one at a time | Plan 06-02 (selectedId → effectiveSelectedTabId in DOM-move effect + createPortal loop; TabBar deleted → no side-by-side chrome) | 06-05 UAT TG-03 |
| SC3 | Click away + back = instant, no reconnect, all state preserved | Plan 06-02 Task 2 persistence smoke test (Tests 1-3 assert DOM node identity + mount-count invariant + visibility toggle) | 06-05 UAT TG-05 (scroll-position + terminal-buffer manual walk) |
| SC4 | Refresh resets everything from scratch | Plan 06-01 (in-memory Set/Map, no persistence primitives, grep gate on `(local\|session)Storage`) + Plan 06-05 UAT | 06-05 UAT "refresh resets everything" |
| SC5 | Mobile — tap row → full-screen view + back button | Plan 06-03 (mobile-flow list-vs-view branch + MobileViewHeader + navigateToList) | 06-05 UAT Mobile flow section |
| SC6 | Mobile browser-back returns list → list-back leaves Skynet | Plan 06-03 (popstate handler + navigateToList → history.back() with sentinel state) | 06-05 UAT "browser back gesture" |
| SC7 | Visible new-session button + host picker + auto-navigate | Plan 06-04 Tasks 1-3 (deferred-select + Dialog + AppShell.onCreateSession wiring + mobile navigateToView) | 06-05 UAT TG-09 |
| SC8 | Admin destinations via gear (desktop) + row (mobile) not competing for attention | Plan 06-02 (gear icon) + Plan 06-03 (SettingsRow mounted at bottom of mobile list via `settingsRowSlot`) | 06-05 UAT TG-10 |
| SC9 | Pin per-session floats to top; unpin drops back; session-end clears | Plan 06-01 store (Tests 3, 4, 5) + ConversationRow pin toggle | 06-05 UAT TG-02 |
| SC10 | Deployed behind mandatory 15-min deadman | Plan 06-05 Task 4 (references deploy-runbook.md verbatim; steps 1-9 mirror the runbook including the narrow-pkill disarm pattern) | 06-05 Task 4 itself is the checkpoint |

**Coverage: 10/10 Success Criteria — every SC has an implementation plan AND a UAT verification path AND (SC10) a deploy checkpoint.**

## HARD LOCK / LOCKED decision checks

CONTEXT.md `<decisions>` block was audited task-by-task against every plan. All LOCKED items honored:

- ✅ **Full-replacement, not additive mode (TG-11 / D-scope-fence #2)** — Plan 06-02 Step A DELETES `src/ui/shell/TabBar.tsx` outright (preferred over gutting-to-stub). No feature flag, no conditional rendering, no user-facing toggle to restore. Grep gate: zero imports of `@/shell/TabBar` in `src/ui/` post-plan.
- ✅ **`useIsTouchDevice()` is the SOLE mobile-vs-desktop signal** — Plan 06-03 explicitly names patch #103 as the source hook, does NOT introduce viewport-width tests, and Plan 06-02 preserves the existing `isTouchDevice = useIsTouchDevice()` at AppShell line 241. No plan grep-matches `window.innerWidth`, `matchMedia('(max-width:`, `navigator.userAgent`.
- ✅ **Persistence is page-load scoped, in-memory only** — Plan 06-01 acceptance criterion enforces `grep -cE "(local|session)Storage" src/ui/state/conversation-store.ts` returns 0. Grep also enforced on ConversationsPanel + ConversationRow. Plan 06-04's `pendingSelectId` addition is also module-scoped (no persistence).
- ✅ **Session-end vanishes + clears pin (TG-01 subset)** — Plan 06-01 Test 5 asserts `updateOpenTabs(nextTabs where t2 is removed)` clears both the row and the pin. T-06-01-01 stale-selection defense wired.
- ✅ **Pin per-session, not per-host** — Plan 06-01 Test 4 explicitly asserts pinning `t1` does NOT pin `t3` even though both on hostA1.
- ✅ **Order below pins = existing sidebar host-tree order** — Plan 06-01 Test 2 asserts host-tree traversal order preserved, NOT insertion / alphabetical.
- ✅ **Desktop sidebar collapse preserved verbatim** — Plan 06-01 truths says "AppShell's sidebar-width, sidebar-collapse, sidebar-header, and thin-strip-when-collapsed mechanisms are UNTOUCHED." Plan 06-02 explicitly does NOT modify lines 218 (`sidebarOpen`), 226 (`sidebarWidth`), 1348-1377 (`sidebarHeader`) structurally — only injects a new `railView === "conversations"` branch into `sidebarPanelContent`.
- ✅ **Mobile bottom nav DELETED entirely** — Plan 06-03 Step A `git rm src/ui/shell/MobileBottomBar.tsx` + delete import at AppShell line 19 + delete mount site at AppShell lines 1534-1541.
- ✅ **URL fragment approach for mobile-view survives Chrome window-restore** — Plan 06-03 uses `#mv=1` in the hash (patch #25's lesson), NOT a query param. Test 11 asserts the fragment survives.
- ✅ **New-session button visible on list view, both mobile and desktop** — Plan 06-04 Step B mounts `<NewSessionButton>` inside ConversationsPanel; both viewports render the same panel; button-before-rows DOM ordering tested (Test 10).
- ✅ **Auto-navigate to new session on create** — Plan 06-04 AppShell onCreateSession calls `selectConversationDeferred(newTabId)` (which becomes selected once the tabs update lands) + `navigateToView()` on mobile.
- ✅ **No parallel-mode ship / no partial state** — Plan 06-01 is foundation-only (produces zero user-visible change). Plan 06-02 lands the atomic swap (TabBar deletion + ConversationsPanel wiring + selectedId as source of truth) all in ONE plan. Plan 06-05 gates the deploy on both being present in dist (grep for `ConversationsPanel` ≥ 1 AND `MobileBottomBar` == 0). No plan attempts to deploy 06-01 alone.
- ✅ **No history / scrollback for ended sessions** — Plan 06-01 explicitly documents "session-end vanishes; NO tombstones, no grey-out, no recently-closed, no re-open gesture" and lists the anti-features not to implement.
- ✅ **No activity/unread signal placeholder chrome** — No plan mentions dots, badges, counts, motion, sound, or a "if flag enabled" branch. ConversationRow's `<action>` block enumerates only: label, session-type badge, identity avatar+tint, pin toggle affordance. Nothing else.
- ✅ **Deploy behind mandatory 15-min deadman** — Plan 06-05 Task 4 how-to-verify block references `~/.claude/identities/tina/deploy-runbook.md` explicitly and walks steps 1-9 mirroring the runbook including: sentinel-cleanup-before-arm, `nohup sudo -b bash -c 'sleep 900; [ ! -f /tmp/skynet-keep-patched] && bash /opt/skynet/.tmp-revert.sh'`, and the narrow-pkill disarm pattern `sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'`.

No HARD LOCK / LOCKED decision violations detected.

## Scope fence checks

CONTEXT.md `<scope_fence>` (10 enumerated items) was audited against every plan's `files_modified` and `<action>` bodies:

1. ✅ **No touches to `src/ui/features/pretty-view/**`** — Every plan has an acceptance criterion `git diff --stat src/ui/features/pretty-view/` returns empty. 06-02 explicitly reads PrettyView.tsx for confirmation-only (no modify) to verify the `isVisible` signal continues to work under the new pane-visibility-signal contract. There is NO plan touching pretty-view for signal wiring — the signal path is already there (patch #NN) and only the value passed to it changes at the AppShell layer.
2. ✅ **No parallel-mode ship** — Plan 06-02 is atomic swap (TabBar deletion + ConversationsPanel wiring landed together). Plan 06-05 gates deploy on TabBar's absence from `dist/assets/*.js`.
3. ✅ **Sidebar reshape ships WITH persistence contract** — Both landed in Plan 06-02 (single plan). Not split across two plans that could ship separately.
4. ✅ **Mobile bottom nav DELETED in any form** — Plan 06-03 `git rm`s the file. Zero imports remain in src/ui/. UAT explicitly negative-space-checks its absence.
5. ✅ **No activity/unread placeholder chrome** — No plan mentions this. UAT includes explicit negative-space check "NO activity/unread indicators anywhere."
6. ✅ **No second mobile-vs-desktop detection mechanism** — Plan 06-03 reuses `useIsTouchDevice`. No plan grep-matches `matchMedia`, `window.innerWidth`, `navigator.userAgent` for viewport detection.
7. ✅ **No changes to desktop sidebar collapse behavior** — See "Desktop sidebar collapse preserved verbatim" above.
8. ✅ **No history / scrollback / ended-session persistence** — Plan 06-01 explicitly enumerates the anti-features. UAT negative-space-checks "NO history / scrollback for ended sessions."
9. ✅ **No reordering of sidebar** — Plan 06-01 Test 2 asserts existing host-tree order preserved; unpin restores to original position, NOT appended (Test 3).
10. ✅ **Every deploy step references `deploy-runbook.md` and enforces the deadman** — Plan 06-05 Task 4 has 11 references to `deploy-runbook` and walks the runbook step-by-step including the `skynet-keep-patched` sentinel and narrow `pkill`.

No scope-fence violations detected.

## Coupled-deploy verification (focus area 5)

The critical concern: 06-01 and 06-02 must ship together in the same container so no intermediate "half-shipped" state exists where the tab strip and the new list coexist as parallel modes.

**Analysis:**
- ✅ **06-01 lands NO user-visible change.** 06-01 truth #5 explicitly says "This plan produces NO user-visible change on production yet — the ConversationsPanel is a new mountable panel but AppShell does not wire it into the RailView options in this plan; Plan 06-02 is where the actual navigation model swap happens." The panel is a new file; AppShell is untouched. If 06-01 were deployed alone, users would see the current tab strip + current sidebar (Hosts) unchanged.
- ✅ **06-02 is the atomic swap.** 06-02 Step A deletes TabBar.tsx AND Step G wires ConversationsPanel into `railView === "conversations"` AND Step I changes default RailView to `"conversations"` — all in one plan's single task (Task 1). There is no intermediate commit within 06-02 where TabBar is deleted but ConversationsPanel is not mounted (or vice versa).
- ✅ **06-05 gates deploy on both being present in dist.** 06-05 Task 1 acceptance criteria include: `dist/assets/*.js` contains `ConversationsPanel` (≥1) AND does NOT contain `MobileBottomBar` (0). If 06-01's ConversationsPanel exists but 06-02's TabBar deletion didn't land, the build would still contain `TabBar` — and 06-05 Task 1 Step C's grep gate would catch it.
- ✅ **No intermediate deploy possible.** 06-05 Task 4 is the ONLY plan with a deploy step. Plans 06-01, 06-02, 06-03, 06-04 all have `autonomous: true` and produce zero deploys. The deploy is gated on 06-05 which depends on 06-02, 06-03, 06-04. And 06-02 depends on 06-01.

Verdict: **The coupling story is verifiable and safe.** The one gotcha to flag for the executor: if the executor is doing `/gsd-execute-phase` with commit-after-each-plan, and if they commit 06-01 to a branch that gets pushed to production before 06-02 lands, they would ship dead code (ConversationsPanel unmounted) — but no user-visible change. Only 06-05 is authorized to run the actual `docker compose up -d --force-recreate skynet`. See NOTE-01 below.

## Persistence contract (focus area 4)

**Analysis:**
- ✅ **Patch #35 `tabNodesRef` explicitly named as reuse point.** 06-02 truth #2 says "the tab-manager's existing per-tab DOM-node ref pattern (`tabNodesRef` + `normalViewRef` DOM-move mechanism at AppShell.tsx lines 280-293 and 1133-1176) is REUSED to hide non-selected conversation views without unmounting them." Verified against actual codebase: `tabNodesRef` at AppShell.tsx line 280, `normalViewRef` at line 281, `getTabNode` at line 283, DOM-placement effect at lines 1133-1176. Line numbers cross-checked.
- ✅ **Contract is truly zero-reconnect, zero-teardown, zero-buffer-loss, zero-scroll-loss, zero-WS-teardown.** 06-02 truth #3 enumerates all five zeros. Programmatic defense in 06-02 Task 2 (persistence smoke test) asserts DOM node identity across switches (Test 1), mount-count invariant (Test 2), and visibility-toggle applied (Test 3). Tests 4-6 assert URL-sync, stale-id no-op, and document-title effect firing.
- ✅ **Per-pane visibility signal preserved.** 06-02 truth #4 explicitly names `WipBubble`, `PlanPendingBubble`, `MessageQueueDrawer`, `SessionHoldingOverlay` as continuing consumers. The signal change is just `paneConversationId === selectedId` instead of `paneConversationId === activeTabId`.
- ✅ **Keyboard focus routing to xterm.js and guacd canvas preserved.** 06-02 confirms `Terminal.tsx isVisible prop pathway (lines 80, 109, 293, 489-490, 530, 2357, 2741-2776)` continues to work under the new value assignment. The plan explicitly avoids touching Terminal.tsx.
- ✅ **Canvas resize on show.** The DOM-move mechanism doesn't unmount, so no re-measure is triggered by unmount/remount; the existing xterm.js `fit()` on active-tab-change effect (AppShell line 442) is preserved and its dep list is extended to fire on selectedConversationId AND activeTabId (whichever drives the visible view).
- ✅ **Persistence smoke test names the fallback path.** 06-02 Task 2 candidly acknowledges that mocking AppShell's 30 imports may be too fragile and offers a fallback: extract the ONE new hook (`useEffectiveSelectedTabId`) into a separate file and unit-test that + defer Tests 4-6 to UAT. This is prudent engineering — the correctness contract (Tests 1-3: DOM node identity + mount-count + visibility toggle) is the load-bearing part; Tests 4-6 are secondary integration.

Verdict: **The persistence contract is fully accounted for.** The reference to patch #35 is not aspirational — it names concrete line numbers, and the plan's edit is minimal (swap `activeTabId` → `effectiveSelectedTabId` in exactly two places).

## Race defense — selectConversationDeferred + pendingSelectId (focus area 7)

**Analysis:**
- ✅ **The race is real.** In 06-04's onCreateSession flow: `openTab(host, ...)` calls React `setTabs([...prev, newTab])` which is batched; it does NOT synchronously mutate `tabs`. If the code then immediately calls `selectConversation(newTabId)`, the store's `selectConversation` action would fire, but 06-01 Test 6's guard says "no-op if id is not in openTabs" — so the selection would silently drop. When React commits the tabs update, `updateOpenTabs` fires and prunes/coerces — but the selection is already null.
- ✅ **The defense is testable — 6 new tests appended.** 06-04 Task 1 defines Tests 13-18 covering: deferred-select with id not in tabs (13), deferred applies on updateOpenTabs (14), deferred with id never arriving (15), deferred with id already in tabs applies immediately (16), direct select clears pending (17), multiple deferred (18).
- ✅ **Documented as an extension of 06-01's store, not silent addition.** 06-04 Task 1 explicitly extends `src/ui/state/conversation-store.ts` and `src/ui/state/conversation-store.test.ts` — both listed in `files_modified`. Test file appends Tests 13-18 to the existing file, not a parallel test file. The extension is called out in 06-04's `must_haves.truths` as "extended with selectConversationDeferred(id) action + module-scoped pendingSelectId."
- ⚠️ **NOTE-02: 06-01 does not cross-reference the eventual extension.** 06-01 does not mention that 06-04 will extend the store with `selectConversationDeferred`. This is fine because 06-04 does the extension work explicitly, but a small reader-friendly cross-reference in 06-01's outputs (e.g., "the summary should record extension points that 06-04 will add") would prevent future confusion. Not a blocker.

Verdict: **The race defense is well-scoped and testable.** The internal contradiction about placement of the `pendingSelectId = null` guard in `selectConversation` (Task 1 Step 4 says "at the top" then re-decides "AFTER the guard but BEFORE the no-change return") — the re-decision is correct semantics; the executor must land the re-decided version, not the first draft. See NOTE-03.

## Mobile URL fragment `#mv=1` (focus area 6)

**Analysis:**
- ✅ **Fragment scheme survives Chrome window-restore by construction.** Because `mv=1` lives in `window.location.hash` (the URL fragment), and fragments survive whole-window restore in Chrome (patch #25's ground-truth learning), the survival property is a definitional consequence, not something the plan needs to test-verify. Plan 06-03 acknowledges this in truth #2 ("the mobile flow's key MUST also live in the fragment, NOT the query string, for the same reason") and Test 11 asserts a URL with `#tab=terminal:hostA&active=0&mv=1` parses correctly (round-trip idempotent).
- ✅ **Wired to both browser back gesture and top-left back button.** Plan 06-03 Task 1 Step B implements `navigateToView` via `history.pushState` (which registers a new history entry), and `navigateToList` via `history.back()` when the state's `__skynetMobileView` sentinel is present. Browser back gesture fires popstate → the listener recomputes screen from location. Top-left back button (implemented in Task 2 Step D via `MobileViewHeader`) calls `navigateToList()` directly.
- ✅ **Deletes MobileBottomBar unconditionally (no feature flag, no per-user opt-in).** Plan 06-03 Step A: `git rm src/ui/shell/MobileBottomBar.tsx`. AppShell import deleted at line 19; mount site at lines 1534-1541 deleted. No conditional preserving the mount.

Verdict: **The mobile fragment scheme is correctly designed for cross-device link portability and Chrome window-restore.** T-06-03-05 (desktop-loaded URL with `mv=1` is IGNORED) is documented as intentional.

## Threat model coverage

Every plan has a `<threat_model>` block with STRIDE register:

| Plan | Threats Enumerated | Notable |
|------|-------------------|---------|
| 06-01 | T-06-01-01 (stale selection), 02 (unbounded pin set), 03 (pin state exposure), SC (supply chain) | T-06-01-01 is the load-bearing one — protects Plan 06-02 from mis-mounting a nonexistent conversation view |
| 06-02 | T-06-02-01 (mount lifecycle regression), 02 (URL-sync feedback loop), 03 (URL disclosure), 04 (settings authorization bypass), 05 (URL-scheme collision under 06-03), SC | T-06-02-01 explicitly names the defense: "Do NOT change the tabNodesRef getTabNode / DOM-move effect. The ONLY change is what selects the 'active-inline' pane" — this is the correct programmatic defense, tested by Task 2 |
| 06-03 | T-06-03-01 (URL scheme collision), 02 (popstate re-entry), 03 (URL disclosure), 04 (malformed mv value), 05 (cross-device deep-link), 06 (stranded user on ended session), SC | T-06-03-06 is a subtle failure mode the plan defends against — Ashley shouldn't get stuck on an empty view when a session ends mid-view |
| 06-04 | T-06-04-01 (session-name injection to shell), 02 (host list flood), 03 (host list disclosure), 04 (setState-then-select race), SC | T-06-04-01 client-side character-set validation as belt-and-suspenders; backend tmux path unchanged |
| 06-05 | T-06-05-01 (dangling import to deleted TabBar), 02 (deadman fires but rollback fails — not Phase-6 concern), 03 (patches-md secrets), 04 (regression to load-bearing prior patches), SC | T-06-05-04 explicitly names patches #25/#35/#57/#60/#100/#102 and Task 1 greps for each in dist |

**Total threats: 26 (including SC), all mitigated or accepted with rationale.** T-06-02-01 (mount lifecycle regression) is called out in 06-02's threat register with an explicit programmatic defense — matches the focus-area 8 requirement. Every threat has an "Assets Protected" note tying it to a load-bearing property of the phase.

Note: No plan-level threat register mentions the subtle risk that **06-02's `sidebarPanelContent` insertion of `railView === "conversations"` branch AT THE TOP (before the hosts branch) could conflict with any prior custom RailView ordering.** Verified against AppShell.tsx (post-Plan-05 state) — no user-configurable RailView order exists; the insertion is safe. Non-blocking.

## must_haves derivation check

All five plans have a `must_haves` block with `truths`, `artifacts`, and `key_links`:

| Plan | Truths Count | User-observable? | Artifacts Map to Truths? | Key Links Wire Artifacts? |
|------|-------------|------------------|--------------------------|---------------------------|
| 06-01 | 5 | Mostly — truth #1 (ordering rules), #2 (single-select semantics), #3 (session-end vanishes) are user-observable via the panel; #4 (drop-in for HostsPanel slot) is implementation-focused but documents a scope-fence property; #5 (no user-visible production change) is INTENTIONALLY implementation-focused because this plan is foundation-only | Yes — each artifact provides a specific capability tied to a truth | Yes — key_links wire ConversationsPanel → conversation-store hooks, ConversationRow → tabUtils tabIcon + identity tint |
| 06-02 | 8 | All 8 are user-observable (tab strip deleted → visible; switch A→B→A instant → observable; internal experience unchanged → observable; gear icon in sidebar header → visible; new-session flow → observable) | Yes | Yes — key_links wire AppShell.selection-state → conversation-store.selectedId, DOM-node-stability → tabNodesRef reuse, TabBar deletion → AppShell mount removal, gear icon → railView swap via handleRailClick |
| 06-03 | 6 | All 6 user-observable (mobile 2-screen flow, browser back, MobileBottomBar gone, useIsTouchDevice as sole signal, desktop untouched, URL fragment survives Chrome window-restore) | Yes | Yes — key_links wire AppShell mobile branch → useMobileScreen, conversation row tap → navigateToView, browser back → navigateToList, bottom-nav destinations → SettingsRow dropdown |
| 06-04 | 5 | 4/5 user-observable (button visible + at top; picker modal opens; auto-navigate on create; name validation shows error); truth #5 (button distinct from gear) is a UX property, observable but not testable via automation | Yes | Yes — key_links wire button click → dialog, dialog onCreate → openTab + selectConversationDeferred + navigateToView, host picker → realHostTree, race defense → pendingSelectId |
| 06-05 | 6 | 3/6 user-observable (Ashley sees dist artifacts land; UAT walk validates end-to-end; deploy checkpoint runs); 3/6 are process-focused (build clean, prior-patch bytes intact, no source-diff creep) which is appropriate for a verification/deploy plan | Yes — UAT checklist + patches-md entry + build-verify log all provide capabilities tied to the truths | Yes — key_links wire UAT walk → TG-01..11 pass/fail, deploy green-light → deadman rollback, plan checkpoint → deploy-runbook.md |

Verdict: **must_haves are well-derived from the phase goal.** No vacuous truths ("plan is complete when tasks are done"). No implementation-only truths that fail to restate observable success criteria. The 06-01 "no user-visible production change" truth is a special case — it's intentionally an anti-truth (documenting what does NOT happen) which is appropriate for a foundation-only plan.

## Cross-plan concerns

### Integration risks

1. **NOTE-01: 06-01/06-02 coupling and the executor's shipping expectation.** 06-01's summary says "Zero user-visible production change: this plan lands the foundation, not the swap; production still shows tabs + the current sidebar. That is intentional per phase decomposition — Plan 06-02 lands the swap in a coupled deploy sequence." However, only Plan 06-05 owns the deploy checkpoint. If the executor uses `/gsd-execute-phase 6` and it commits after each plan, 06-01 lands on the branch alone briefly — this is fine because the branch isn't pushed to prod until Plan 06-05. But if the executor is confused and thinks 06-01 → deploy is authorized, they might try to deploy after wave 1. **The plans are internally consistent and safe; the risk is executor confusion. Fix: 06-01's `<output>` block should explicitly say "Do NOT deploy after this plan. The tab strip is still live; deployment happens in 06-05 after 06-02 replaces it."** (Warning-severity, non-blocking, easily addressable in executor prompt.)

2. **NOTE-02: 06-01's ConversationsPanel does not reserve the top-of-scroller slot for 06-04's NewSessionButton.** 06-01 Task 2 Step B "Header row: NO new-session button in this plan (Plan 06-04); NO gear icon in this plan (Plan 06-02 owns the settings surface); leave header empty or with a `<Separator />`" — this defers header content to later plans. 06-04 Step B inserts the button "at the TOP of the scroller (above the pinned section render)" via a bordered wrapper div. This works because 06-01 leaves the scroller unencumbered at its top. But the interaction between "button at top of scroller" (06-04) and "pins at top of scroller" (06-01) means the button sits ABOVE the pins in DOM order. 06-04 Test 10 asserts button-before-rows DOM order — this passes. **No blocker; just verify the executor renders NewSessionButton in a wrapper that precedes the pinned section's DOM emission.**

3. **NOTE-03: 06-04 Task 1 has an internal re-decision on `pendingSelectId = null` placement in `selectConversation`.** Step 4 first says "at the top of `selectConversation`" then re-decides "AFTER the guard but BEFORE the 'no change' return." The re-decision is correct (clears pending even on same-id selects). Executor must land the re-decided version. **No blocker; the re-decision is clearly the correct one and the acceptance criterion (Test 17) will fail if the wrong version lands.**

4. **NOTE-04: 06-05 Task 1's grep gate for `tabNodesRef` in minified dist is unreliable.** The plan candidly acknowledges this: "Patch #35's tabNodesRef marker is the most likely to be minified beyond recognition; use the fallback: `grep -c 'appendChild' dist/assets/*.js`..." Recommended improvement: grep for a distinctive body string that Vite is less likely to mangle, e.g., the exact class name string used in `getTabNode`'s created div (something like `"pretty-view-tab-node"` if one exists) or the `position: absolute` style string. **No blocker; the fallback is documented.**

5. **NOTE-05: `useConversations()` reactive updates may thrash on host-tree polling.** 06-01 Task 1's `updateHostTree(realHostTree)` is called on every AppShell `realHostTree` change (via 06-02 Step C's effect). If `getSSHHosts` polls and returns a NEW reference each poll (even with same data), `updateHostTree` will bump `snapshotVersion` and every ConversationsPanel consumer will re-render. 06-01 Step 1 mentions "Idempotent by reference-equality; if `tree === state.hostTree` no emit" — but this ONLY works if `getSSHHosts` returns stable references. Verified against AppShell.tsx: `realHostTree` is a rebuilt object each time `buildHostTree` is called. **This may cause visible thrash; not user-blocking but polish-degrading.** Recommend 06-01 or 06-04 add a deep-equality check in `updateHostTree` (small edit; not a re-plan). Non-blocking.

6. **NOTE-06: `useKeyboardTabNav` cycling behavior after tab-strip deletion is left as documented deferral.** 06-02 Step B "Decision: keep `useKeyboardTabNav` as-is for this plan (it operates on the tabs array; cycling through singleton tabs remains harmless). Plan 06-04 or a follow-up may refine to cycle only through conversation-store's ordered list." 06-04 does NOT own this refinement (it owns new-session flow). The refinement thus lives in "a follow-up" — meaning a future bounty. Ashley's Ctrl+Shift+[/] behavior after this ships will cycle through all tabs including singletons (host-manager, credentials, admin-settings), which may feel slightly wrong. **Non-blocking (Ashley rarely uses keyboard tab cycling per user profile inference from prior GSD phases), but worth surfacing in the summary.**

7. **NOTE-07: `SettingsRow` component location is ambiguous.** 06-02 truth #6 says "Mobile settings-row component is created here (mounted by Plan 06-03) so 06-03 can drop it into its mobile-list layout without owning the routing logic." Then Step F says "Also export a `SettingsRow` functional component from ConversationsPanel.tsx (or a new file `src/ui/sidebar/SettingsRow.tsx` if planner prefers isolation — recommend new file for testability)." 06-03 Task 2 assumes `SettingsRow` is importable (imports it into AppShell via the settingsRowSlot mount). If the executor picks the "export from ConversationsPanel.tsx" path, the import path becomes `@/sidebar/ConversationsPanel` which is unusual (usually a file exports one primary component). If the executor picks the "new file" path, `@/sidebar/SettingsRow.tsx` is the import path. Both work; the ambiguity is fine but the executor must record their choice in 06-02-SUMMARY for 06-03 to import correctly. **Non-blocking; both plans handle both cases.**

8. **NOTE-08: The persistence smoke test may not fire under CI-scope Vitest with jsdom.** 06-02 Task 2's fallback path acknowledges that mocking AppShell's 30 imports is fragile. If Tests 4-6 (URL-sync + document title + integration) are deferred to UAT per the fallback, the load-bearing correctness (Tests 1-3) still ships as programmatic guards. This is prudent, but the UAT items in 06-05 must then explicitly cover Tests 4-6's semantics. 06-05 UAT DOES cover the persistence contract (TG-05 walkthrough with scroll-position preservation) but does NOT explicitly walk "URL fragment reflects selectedConversationId change" as a separate check. **Non-blocking; the observable result is the same.**

### Sequencing / dependency graph

Verified dependency graph (from frontmatter):
```
06-01 (wave 1, no deps)
  └─ 06-02 (wave 2, depends on 06-01)
       ├─ 06-03 (wave 3, depends on 06-02)
       ├─ 06-04 (wave 4, depends on 06-02 AND 06-03)
       └─ 06-05 (wave 5, depends on 06-02, 06-03, 06-04)
```

- ✅ No cycles.
- ✅ No forward references.
- ✅ Wave numbers = max(deps) + 1 for every plan.
- ⚠️ 06-04's `depends_on: [06-02, 06-03]` — 06-04 could technically run in parallel with 06-03 (both depend on 06-02, and 06-04's substantive dependency on 06-03 is only for `navigateToView` import used in `onCreateSession`). Given 06-03 ships mobile-flow which 06-04 consumes, the sequential dependency is correct. **Non-blocking.**

### Coupled deploy verification

- ✅ Only 06-05 owns the deploy checkpoint (Task 4 checkpoint:human-verify).
- ✅ 06-05's Task 4 how-to-verify references `deploy-runbook.md` and walks the mandatory deadman flow.
- ✅ 06-05's Task 1 acceptance criteria gate on dist artifacts (ConversationsPanel present, MobileBottomBar absent, TabBar absent, mv literal present, patch #60/#100/#102 markers intact).
- ✅ No intermediate "half-shipped" state — 06-01 lands foundation only; 06-02 lands atomic swap; 06-05 gates deploy on both being present.

## Rebase-worthiness check (fork constraint from CLAUDE.md)

CLAUDE.md constraint: "Every fork commit must survive rebases against upstream `main`." Analysis:

- Plans 06-01, 06-04 add NEW files under `src/ui/state/`, `src/ui/sidebar/`, `src/ui/lib/` — LOW rebase risk (no upstream conflict surface).
- Plan 06-02 edits `src/ui/AppShell.tsx` extensively (DOM-move effect swap + createPortal loop swap + ConversationsPanel mount insertion + TabBar deletion + settings surface wiring). This is the largest edit surface. Rebase risk: MEDIUM — upstream restructuring of AppShell's tab-manager territory would require careful re-apply. The plan documents this in 06-05's patches-md entry: "MEDIUM on `src/ui/AppShell.tsx`."
- Plan 06-03 extends `src/ui/lib/tab-url.ts` (adds `mobileView` field + `mv=1` encode/parse). The file is fork-only per 06-05's patches-md entry ("upstream doesn't have this file"). LOW risk.
- Plans 06-02 and 06-03 DELETE `src/ui/shell/TabBar.tsx` and `src/ui/shell/MobileBottomBar.tsx`. Deletions are trivial to re-apply if the files reappear upstream (delete again).
- Zero new npm dependencies — no package.json diff, no lockfile diff. Rebase-friendly.
- Zero backend / docker / nginx changes — no CLAUDE.md "Nginx caveat" trap (Phase 6 is frontend-only).

Verdict: **Rebase-worthy.** The largest single edit (AppShell.tsx) is documented as MEDIUM risk in the patches-md entry, which is honest and appropriate for a fork commit that will need to survive future upstream rebases.

## Verdict rationale

Every one of the 10 numbered success criteria in CONTEXT.md maps to a covering task in ≥1 plan, and every task has a verify step + acceptance criteria + a UAT walk in 06-05. Every LOCKED decision in CONTEXT.md `<decisions>` is honored. Every scope-fence item is enforced by grep gate. The load-bearing engineering commitments — patch #35 preservation, patch #25 URL-fragment for Chrome window-restore, `useIsTouchDevice()` as sole mobile signal, zero touches to pretty-view / terminal / guacamole / backend / docker / package.json — are all correctly named and enforced. The persistence contract (TG-05) has both a programmatic smoke test (06-02 Task 2) and a UAT walk (06-05). The mobile flow (TG-06/07) has both unit tests (06-03 Task 1, 11 tests) and a UAT walk (06-05). The new-session race defense (06-04's `selectConversationDeferred`) has both unit tests (Tests 13-18) and a UAT walk. The deploy checkpoint (06-05 Task 4) references `deploy-runbook.md` explicitly and walks the mandatory 15-min deadman flow.

The 8 notes are all non-blocking design tensions or executor-facing clarifications that improve quality but do not risk phase-goal delivery. The most substantive is NOTE-01 (06-01 executor confusion risk) which is easily addressed with a one-line addition to 06-01's output block.

Phase 6 plans are ready for Ashley's execution green-light.

## Action items (optional, non-blocking)

If Ashley wants the planner to strengthen the plans before executing, here are the small revisions worth batching:

1. **06-01 `<output>` block**: add explicit "Do NOT deploy after this plan. The tab strip is still live; deployment happens in Plan 06-05 after Plan 06-02 replaces the tab strip." (Addresses NOTE-01.)
2. **06-01 Task 2 Step B**: add note "Task 2's ConversationsPanel scroller will accept a NewSessionButton insertion at its TOP in Plan 06-04. Do not consume the top-of-scroller slot with an unnecessary Separator." (Addresses NOTE-02.)
3. **06-01 Task 1 Step 1 (`updateHostTree`)**: strengthen the idempotency guard from reference-equality to a shallow deep-equality on `hostTree.children` OR document that AppShell must memoize `realHostTree` before passing it in. (Addresses NOTE-05.)
4. **06-04 Task 1 Step 4**: delete the "at the top" first draft and keep only the re-decided "AFTER the guard but BEFORE the 'no change' return" version. (Addresses NOTE-03.)
5. **06-05 Task 1 Step D**: replace the `grep -c 'tabNodesRef'` gate with a grep for a more mangle-resistant marker (e.g., a distinctive style string used in `getTabNode`'s created div, or a data-attribute string that Vite preserves). (Addresses NOTE-04.)
6. **06-02 Task 1 Step F**: pick one — either `SettingsRow` is exported from `ConversationsPanel.tsx` OR it lives in its own `src/ui/sidebar/SettingsRow.tsx`. Lock the choice so 06-03 has an unambiguous import path. (Addresses NOTE-07.)

None are blockers. All can be deferred to executor discretion with summary-recording.

---

## Summary

- **Verdict:** PASS_WITH_NOTES
- **Blockers:** 0
- **Needs-revision:** 0
- **NOTE-severity findings:** 8 (NOTE-01 through NOTE-08)
- **Coverage:** 11/11 TG requirements + 10/10 Success Criteria + all 10 scope-fence items + all 3 focus-area load-bearing contracts (persistence via patch #35 tabNodesRef, mobile URL fragment via patch #25 lesson, new-session race defense via selectConversationDeferred)
- **Ready for execution:** Yes
