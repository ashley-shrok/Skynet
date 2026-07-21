# Phase 7 Plan Check — Fleet-native Conversation List

**Checked:** 2026-07-21
**Checker:** gsd-plan-checker (goal-backward verification)
**Plans reviewed:** 07-01, 07-02, 07-03
**Repo state:** `/home/ubuntu/termix` @ `feat/tab-title-from-tmux`
**Authoritative sources:** shape-fleet-native-conversation-list.md + 07-CONTEXT.md (both LOCKED)
**Reference precedent:** 06-PLAN-CHECK.md (Phase 6 pattern)

## Overall verdict: **PASS_WITH_NOTES**

All three plans, executed in wave order 1 → 2 → 3, would deliver every one of the 10 numbered success criteria in CONTEXT.md §Success Criteria and every TG-12..18 requirement. The load-bearing engineering commitments — fleet ∪ openTabs union with openTabs-entry-wins dedup, `fleetOnly` internal-only marker with zero visual distinction from openTabs rows, one-shot `getSessionList()` fetch with empty-dep-array useEffect and explicit non-wiring to `termix:hosts-changed`, `allowCreateTmux: false` on detached-row click (attach not create), RDP row derivation from `state.hostsFlat` filtered on `enableRdp === true` at BOTTOM of grouped output, `showGear` gated on `!useIsTouchDevice()`, NewSessionButton Plus→Pencil icon swap with function preserved, T-06-02-01 mount-lifecycle contract byte-preserved, zero touches to `src/ui/features/pretty-view/**` / `Terminal.tsx` / `guacamole/**` / `src/backend/**` / `docker/**` / `package.json`, mandatory 15-min deadman rollback per `deploy-runbook.md`, patch #106 numbering following patch #105 precedent — are all correctly named and enforced by acceptance-criteria grep gates.

Notes (non-blocking) center on: (1) `updateHostsFlat` snapshotVersion bump creates cross-plan invariant drift between 07-01 (says hostsFlat is "rendering-only lookup, does NOT affect derived ConversationList") and 07-02 (uses `state.hostsFlat` inside `computeSnapshot` to emit RDP rows); (2) RDP-sentinel-HostGroup approach requires special-casing the semibold host-header render in ConversationsPanel — currently that render is unconditional; (3) small fragility in the `showGear` grep gate (exact literal match with double-quoted `"function"`); (4) fetch-race between `getSessionList` and `loadHosts` may briefly render fleet rows with fallback host names before hostsFlat populates — plan accepts this via fallback but doesn't UAT it explicitly; (5) NewSessionButton file line count in 07-02 Task 2 `read_first` (34 lines) is off by one (actual 33); (6) Test 30 (fleet-only rows never pinned) is redundant with existing pinConversation guard at conversation-store.ts:348-358 but harmless as a regression test; (7) 07-03 UAT checklist is comprehensive but doesn't explicitly walk the fleet-row-with-undefined-host resilience case (T-07-01-06); (8) 07-01/07-02 do NOT explicitly memoize the `hostsById` Map's constituent Host objects — new Host references on every buildHostTree rebuild will cause `updateHostsFlat` to detect mutation via per-value ref-inequal check and trigger a rerender (matches Phase 6 NOTE-05 pattern, pre-existing).

## Per-plan verdicts

| Plan | Wave | Tasks | Files | Verdict | Notes |
|------|------|-------|-------|---------|-------|
| 07-01 | 1 | 2 (both auto, both tdd) | 5 (extends store + test + panel + AppShell + persistence test) | **PASS_WITH_NOTES** | Data-source reshape + detached-click plumbing. Union+dedup semantics correctly specified with the `hostId (number) → String(hostId)` normalization to align with `Host.id` (string) — matches SessionsPanel.tsx:47 precedent. One-shot fetch effect has explicit empty-dep-array + cancelled-guard + silent try/catch. `allowCreateTmux: false` distinction from Plan 06-04's `true` is correct (attach ≠ create). `hostsById` memo keys on `stableHostTreeKey` reusing NOTE-05 thrash-guard. Task 2 correctly bundles panel + AppShell + persistence-test extension together because splitting them per-file would break the coupling — the click-handler pipeline is meaningless with any piece missing. NOTES: (a) Task 1 says hostsFlat is "rendering-only lookup" — statement becomes stale once 07-02 uses it in computeSnapshot; (b) Test 30 (fleet-only never pinnable) duplicates existing pinConversation guard — regression test is defensible. |
| 07-02 | 2 | 2 (1 tdd + 1 auto) | 5 (extends store + test + panel + NewSessionButton + AppShell) | **PASS_WITH_NOTES** | RDP row derivation + pencil re-style + TG-18 mobile gear fix. RDP row identity `rdp-host::${host.id}` correctly deterministic per host. `showGear` gate exactly matches CONTEXT.md §decisions §TG-18 fix specification. Pencil icon choice left to executor within Telegram-native vocabulary (`Pencil`, `PenTool`, `SquarePen`). RDP row placement decision (sentinel HostGroup vs new `rdpHosts` field) explicitly left to executor with recommendation — legitimate discretion per shape-file §Shape bullet 4. `onRdpRowClick` handler in AppShell reuses `openTab(host, "rdp") + selectConversationDeferred(newTabId)` — symmetric with Plan 07-01's detached-row-click and Plan 06-04's onCreateSession patterns. NOTES: (a) sentinel-HostGroup approach requires ConversationsPanel to special-case `hostId === "__rdp__"` to suppress the semibold host-header render (currently unconditional at ConversationsPanel.tsx:208-215) — Task 2 flags this in behavior but the executor MUST land it; (b) `showGear` grep gate is a fragile exact-literal match with double-quoted `"function"` — an executor using single quotes fails the gate; (c) NewSessionButton line count claim (34) is 33 in reality — cosmetic. |
| 07-03 | 3 | 4 (3 auto + 1 checkpoint:human-verify) | 3 (all .md — zero source diffs) | **PASS_WITH_NOTES** | Matches Plan 06-05's pattern verbatim. Build verify (Task 1) has explicit fallbacks for minifier-mangled markers (`fleet::` string literal survives; pencil icon may mangle → `nav.newSession` i18n key fallback; `updateFleetSessions` identifier may mangle → `/sessions/list` URL literal fallback). UAT checklist (Task 2) walks all 7 TG-12..18 sections + 11-item Phase 6 regression walk + Plan 07-01 additional items + explicit deadman disarm sentinel+pkill instructions verbatim from deploy-runbook.md. Patches-md #106 draft (Task 3) follows patch #105 precedent (multi-commit format under one PIN). Deploy checkpoint (Task 4) is Ashley-gated with explicit resume-signal enumeration including refusal-to-deploy-without-deadman. NOTES: (a) UAT checklist doesn't explicitly walk the fleet-row-with-undefined-host resilience race (T-07-01-06); (b) Task 1 `git diff --stat` scope fence uses `grep -qE "\\|"` — matches any pipe character in `git diff --stat` output (typical format: `path/to/file | 42 +++`); works but relies on `git diff --stat`'s consistent format. |

## Requirement coverage matrix (TG-12..18 → covering plan)

| Req | Description (abbrev.) | 07-01 | 07-02 | 07-03 | Status |
|-----|-----------------------|-------|-------|-------|--------|
| TG-12 | Fleet-native list — fleet ∪ openTabs dedup, fresh page-load shows running sessions | ✓ (store extension + one-shot fetch + hostsFlat + dedup semantics) | | ✓ (UAT) | COVERED |
| TG-13 | Attached vs detached visually indistinguishable | ✓ (fleetOnly is INTERNAL routing marker; ConversationRow renders identically) | | ✓ (UAT — inspect CSS parity) | COVERED |
| TG-14 | Click detached row transparently attaches (no dialog) | ✓ (onDetachedRowClick handler = openTab + selectConversationDeferred; allowCreateTmux: false) | | ✓ (UAT) | COVERED |
| TG-15 | RDP host rows at bottom with monitor icon, no identity hue, no name beyond host | | ✓ (rdpHostRow derivation from state.hostsFlat + Monitor icon + no ConversationRow identity resolution) | ✓ (UAT — enableRdp toggle roundtrip) | COVERED |
| TG-16 | Pencil re-style (function unchanged) | | ✓ (NewSessionButton import + JSX one-line swap; dialog unchanged) | ✓ (UAT) | COVERED |
| TG-17 | Snapshot-on-load, no polling | ✓ (empty-dep useEffect + NOT wired to termix:hosts-changed + grep gates on setInterval/setTimeout) | | ✓ (UAT — DevTools Network tab shows single request) | COVERED |
| TG-18 | Mobile no duplicate settings (gear desktop-only, SettingsRow mobile-only) | | ✓ (showGear += !useIsTouchDevice(); SettingsRow gate at AppShell:1348 already correct) | ✓ (UAT — mobile + desktop parity) | COVERED |

**Coverage: 7/7 requirements — every TG-12..18 appears in exactly one implementation plan's `requirements` frontmatter AND is discharged by concrete task(s).** No unmapped requirements. Every requirement has ≥1 UAT check in 07-03. Planner's stated split (TG-12/13/14/17 → 07-01, TG-15/16/18 → 07-02, TG-12..18 UAT walk → 07-03) matches the actual plan bodies.

## Success Criteria coverage (CONTEXT.md §Success Criteria items 1-10)

| SC | Description (abbrev.) | Proven by | Verified in |
|----|-----------------------|-----------|-------------|
| SC1 | Fresh mobile page-load shows fleet's running tmux sessions | Plan 07-01 (store fleetSessions input + one-shot fetch + union derivation) | 07-03 UAT §TG-12 |
| SC2 | Attached and detached rows visually indistinguishable | Plan 07-01 (fleetOnly is INTERNAL; ConversationRow render path unchanged; hard_constraint enforces NO visual distinction) | 07-03 UAT §TG-13 (DevTools CSS inspection) |
| SC3 | Clicking a detached row transparently attaches | Plan 07-01 (onDetachedRowClick → openTab + selectConversationDeferred, no dialog) | 07-03 UAT §TG-14 |
| SC4 | RDP host rows at bottom, monitor icon, no identity hue | Plan 07-02 (rdpHostRow derivation + Monitor icon override + no identity resolution) | 07-03 UAT §TG-15 (bottom scroll + click + enableRdp toggle roundtrip) |
| SC5 | New Session button re-styled as pencil | Plan 07-02 (Plus → Pencil icon swap; function preserved) | 07-03 UAT §TG-16 |
| SC6 | Mobile no duplicate settings entry points | Plan 07-02 (showGear += !useIsTouchDevice(); SettingsRow gate unchanged) | 07-03 UAT §TG-18 (both viewports) |
| SC7 | List does NOT auto-update after page-load | Plan 07-01 (empty-dep useEffect + not wired to hosts-changed + grep gates) | 07-03 UAT §TG-17 (DevTools Network tab) |
| SC8 | Every Phase 6 behavior preserved verbatim | Plans 07-01 + 07-02 (additive-only extensions; T-06-02-01 mount-lifecycle contract explicitly preserved; scope-fence grep gates) | 07-03 UAT §Phase 6 regression (TG-01..11) |
| SC9 | Every tab lifecycle behavior preserved verbatim | Plans 07-01 + 07-02 (openTab CALLED not modified; PERSISTENT_TAB_TYPES / terminalRefs / tabNodesRef untouched) | 07-03 UAT (regression walk) |
| SC10 | Deployed behind mandatory 15-min deadman rollback | Plan 07-03 Task 4 (references deploy-runbook.md; sentinel-cleanup-before-arm; nohup + narrow-pkill disarm) | Task 4 itself is the checkpoint |

**Coverage: 10/10 Success Criteria — every SC has an implementation plan AND a UAT verification path AND (SC10) a deploy checkpoint.**

## HARD LOCK / LOCKED decision checks

CONTEXT.md `<decisions>` block audited task-by-task:

- ✅ **Fleet-native input added to the conversation-store, existing inputs preserved.** Plan 07-01 Task 1 Step 8 explicitly says "Preserve every existing action verbatim: `updateHostTree`, `updateOpenTabs`, `selectConversation`, `selectConversationDeferred`, `pinConversation`, `unpinConversation`, `togglePinConversation`, `__subscribeForTest`, `__getSnapshotForTest`, `__getPendingSelectIdForTest`. Preserve every existing hook... Do NOT change any of their signatures."
- ✅ **Session identity for dedup uses (host id, tmux session name) pair.** Plan 07-01 Task 1 Step 6 defines `dedupKey(hostIdStr: string, sessionName: string)` with null-byte separator; explicit normalization `String(parseInt(tab.host.id))` on the openTabs side to match the numeric `RemoteTmuxSession.hostId` on the fleet side. Matches SessionsPanel.tsx:47's `parseInt(h.id)` precedent verbatim.
- ✅ **openTabs entry wins on dedup.** Plan 07-01 Task 1 Step 6 sub-bullet 3: "if the key is in the openTabs session-identity set, SKIP (openTabs-entry-wins)". hard_constraint #7 states "openTabs-entry-wins on dedup: when a session appears in BOTH inputs, the openTabs entry is authoritative". Test 24 asserts this specifically.
- ✅ **Snapshot on page-load, no polling.** Plan 07-01 hard_constraint #3 explicit: "NO polling. The fleet-discovery `getSessionList()` fires ONCE on mount (empty dep array useEffect). No setInterval, no setTimeout retry loop, no window focus/visibility listener, no periodic refetch. The `termix:hosts-changed` event listener that already exists for realHostTree is NOT extended to re-fetch sessions." Grep gates enforce absence of `setInterval|setTimeout` near `getSessionList()` and NOT wired to `termix:hosts-changed`.
- ✅ **No attached/detached visual distinction (TG-13).** Plan 07-01 hard_constraint #4 + must_haves.truths[1] + explicit fleetOnly is INTERNAL routing marker only. Plan 07-01 Task 1 Step 5: "Ashley-facing: `fleetOnly` is INTERNAL — ConversationRow renders identically regardless (Plan 07-02 renders it identically visually)."
- ✅ **Click-a-detached = transparent attach + mount + show (TG-14).** Plan 07-01 Task 2 onDetachedRowClick handler: `openTab(host, "terminal", undefined, { targetTmuxSession: sessionName, label: sessionName, allowCreateTmux: false }); selectConversationDeferred(newTabId); if (isTouchDevice) navigateToView(); if (isMobile) setSidebarOpen(false);` — reuses Plan 06-04's openTab + selectConversationDeferred mechanism verbatim. NO new dialog, NO confirmation, NO separate connect step.
- ✅ **allowCreateTmux: false distinction on detached-attach.** Correctly distinguishes attach (session already exists on the box, backend must NOT auto-create) from create (Plan 06-04's onCreateSession uses `allowCreateTmux: true`). This is a critical distinction — attach against a nonexistent tmux session should ERROR, not resurrect as an empty pane per the Tab type comment at AppShell.tsx:919-922.
- ✅ **One row per RDP-enabled host (TG-15).** Plan 07-02 Task 1 Step 2: iterate hostsFlat, filter `host.enableRdp === true` (strict identity check per T-07-02-01 mitigation), emit one row per matching host.
- ✅ **RDP row content: monitor icon + host name, no identity hue, no identity name.** Plan 07-02 hard_constraint on RDP row: "NO identity hue, NO identity avatar, NO identity name. Per shape file: monitor icon in the avatar slot, host name as the row label. ConversationRow's existing identity resolution (via useIdentities + sessionMatchKey) MUST be bypassed for RDP rows."
- ✅ **RDP row placement: bottom of the list.** Plan 07-02 Task 1 Step 2: "After the existing fleet+openTabs HostGroup emission loop... emit... at the end of `grouped`" (sentinel-HostGroup) OR "after `{grouped.map(...)}` and BEFORE `{settingsRowSlot}`" (new rdpHosts field). Both approaches place RDP rows below the identity-tmux section.
- ✅ **RDP row persistence tied to enableRdp flag, NOT tab state.** Plan 07-02 must_haves.truths[1] + Test 33 (enableRdp toggle roundtrip).
- ✅ **Click RDP row uses existing tab lifecycle.** Plan 07-02 Task 2 AppShell handler: `openTab(host, "rdp")` — same entry point HostsPanel + SessionsPanel + connectHost use today. Zero RDP lifecycle re-engineering.
- ✅ **Pencil re-style: same button, different visual.** Plan 07-02 Task 2 NewSessionButton changes: import Plus → Pencil; JSX `<Plus className="size-3 shrink-0" />` → `<Pencil className="size-3 shrink-0" />`. Preserve size + shrink-0 verbatim. All other button chrome (type, onClick, title, aria-label, className, i18n label) UNCHANGED.
- ✅ **This is the ONLY creation button.** Plan 07-02 Task 2 NewSessionButton: only the icon changes. No second creation button introduced. No plain-SSH creation added.
- ✅ **Mobile gear/settings-row dedup fix.** Plan 07-02 Task 2 ConversationsPanel: `showGear = typeof onRailClick === "function" && !useIsTouchDevice()`. SettingsRow gate at AppShell.tsx:1348 already correct (`isTouchDevice ? <SettingsRow /> : undefined`) — no change needed there. Verified against current code.
- ✅ **Tab lifecycle UNTOUCHABLE.** Plan 07-01 hard_constraint #2 + Plan 07-02 hard_constraint #2 + grep gates on `openTab` signature preservation + PERSISTENT_TAB_TYPES / tabNodesRef / normalViewRef untouched. `createPortal(` count enforced at exactly 1 in both plans.
- ✅ **Pretty-view / Terminal.tsx / guacamole / backend / docker / package.json UNTOUCHABLE.** All three plans have `git diff --stat` grep gates asserting empty on all six scope-fenced paths. Additional gate on `src/ui/sidebar/NewSessionDialog.tsx` (unchanged per hard_constraint).
- ✅ **No new npm dependencies.** Plans 07-01 + 07-02 both include `git diff --stat package.json package-lock.json` empty gates. Pencil + Monitor icons are already in lucide-react (verified — existing dep).
- ✅ **Deploy behind mandatory 15-min deadman.** Plan 07-03 Task 4 how-to-verify block references `~/.claude/identities/tina/deploy-runbook.md` explicitly, includes sentinel-cleanup-before-arm (`sudo rm -f /tmp/termix-keep-patched`), the exact `nohup sudo -b bash -c 'sleep 900; [ ! -f /tmp/termix-keep-patched ] && bash /opt/termix/.tmp-revert.sh'` pattern, and the narrow-pkill disarm `sudo pkill -f 'sleep 900; \[ ! -f /tmp/termix-keep-patched'`.
- ✅ **Deploy is Ashley-gated.** Task 4 is `checkpoint:human-verify gate="blocking"`. Resume-signal enumerates all four states including explicit refusal path: `deploy without deadman → executor REFUSES — deadman is mandatory per CLAUDE.md, no exceptions; escalate`.

No HARD LOCK / LOCKED decision violations detected.

## Scope fence checks

CONTEXT.md `<scope_fence>` (10 enumerated items) audited against every plan's `files_modified` and `<action>` bodies:

1. ✅ **No change to identity-tmux, RDP, or plain-SSH tab lifecycle behavior.** No plan modifies `openTab`, `PERSISTENT_TAB_TYPES`, `terminalRefs`, `addOpenTab`, or the RDP tab component. All CALL existing lifecycle entry points; none MODIFY them.
2. ✅ **No real-time polling / push mechanism on fleet-discovery input.** Plan 07-01 hard_constraint #3 + T-07-01-02 threat mitigation + explicit grep gates (`setInterval|setTimeout` count near `getSessionList` = 0; NOT wired to `termix:hosts-changed`).
3. ✅ **No visual distinction between attached and detached rows.** Plan 07-01 hard_constraint #4 + fleetOnly is INTERNAL routing marker only + ConversationRow render path unchanged.
4. ✅ **No plain-SSH host row category.** Plan 07-01 hard_constraint #5: "Hosts with no running tmux MUST NOT get placeholder rows." Fleet discovery returns `RemoteTmuxSession[]` (existing tmux sessions), not host records without sessions.
5. ✅ **No second creation button beyond the pencil.** Plan 07-02 Task 2 NewSessionButton is a re-style of the SAME button, not a new one. No plan adds any other button.
6. ✅ **No change to desktop sidebar collapse behavior.** No plan touches `sidebarOpen`, `sidebarWidth`, `sidebarHeader`, or the collapse-to-thin-strip mechanism (Phase 6 lock preserved).
7. ✅ **No change to mobile list-vs-view flow, back button, or bottom-nav-deletion state.** No plan touches `mobile-flow.ts`, `MobileViewHeader`, `useMobileScreen`, or the `#mv=1` URL fragment scheme.
8. ✅ **No history / scrollback / ended-session persistence.** No plan mentions tombstones, greyed-out rows, recently-closed, or session-file replay. Fleet-only rows for dead sessions naturally vanish on next refresh (matches TG-17 staleness model).
9. ✅ **Every deploy step references deploy-runbook.md + mandatory deadman.** Plan 07-03 Task 4 references the runbook explicitly 5+ times and mirrors its step-by-step verbatim.
10. ✅ **No touches to `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/**`, `src/backend/**`, `docker/**`, `package.json`.** All three plans have `git diff --stat` empty gates on these paths. Plan 07-03 Task 1 additionally allows a small `src/ui/sidebar/ConversationRow.tsx` diff IF the executor picks the icon-override prop path for RDP rendering (documented as reportable outcome, not a violation).

No scope-fence violations detected.

## Load-bearing contract: fleet-native + openTabs union (focus area 4)

**Analysis:**
- ✅ **`fleetSessions` is a NEW input alongside existing openTabs, hostTree, pinnedIds.** Plan 07-01 Task 1 Step 2: extends the existing `type State` with two new fields (`fleetSessions: FleetSession[]` and `hostsFlat: Map<number, Host>`), initial values `[]` and `new Map()`. Step 8 explicitly enumerates the preserved existing state fields, actions, and hooks.
- ✅ **Row derivation is `fleet ∪ openTabs` deduplicated by session identity.** Plan 07-01 Task 1 Step 6 defines the union+dedup logic: compute openTabs identity set → iterate fleetSessions → skip if key in openTabs set → emit synthetic fleet row otherwise.
- ✅ **openTabs wins for pin/selection/metadata; fleetSessions contributes only "this exists on the box".** Plan 07-01 hard_constraint #7 explicit: "openTabs-entry-wins on dedup: when a session appears in BOTTOM inputs, the openTabs entry is authoritative (preserves the id, pin state, all Phase 6 semantics). The fleet entry only contributes 'this exists on the box' — if the openTabs entry is present, the fleet entry is silently dropped from the fleet-derived rows." Test 24 asserts this specifically (openTabs id wins, `fleetOnly` undefined on the surviving row).
- ✅ **One-shot fetch on page-load, no polling anywhere.** Plan 07-01 Task 2 AppShell effect: `useEffect(() => { ...await getSessionList()...updateFleetSessions(...) }, []);` — empty dep array. Silent try/catch. Cancelled-guard for unmount race. Not wired into `termix:hosts-changed` (explicit grep gate: `grep -B2 -A5 "termix:hosts-changed" src/ui/AppShell.tsx | grep -c "getSessionList\|updateFleetSessions") -eq 0`).
- ✅ **Reused sidebar host-tree signal comes without polling attached.** Verified against actual code: `getSessionList()` is the fleet-discovery signal (from `@/api/sessions-api`, currently consumed by SessionsPanel with a manual Refresh button, no auto-poll). AppShell already has a hosts-changed listener that calls `loadHosts` (not `getSessionList`). Plan 07-01 correctly does NOT wire `getSessionList` into that listener. TG-17 shape-lock protected.

Verdict: **The fleet ∪ openTabs contract is correctly designed and enforced.**

## Load-bearing contract: click-detached-row transparent attach (focus area 5)

**Analysis:**
- ✅ **Click transparently calls `openTab(host, type, sessionName, opts)` + `selectConversationDeferred(newTabId)`.** Plan 07-01 Task 2 AppShell handler explicit:
  ```
  onDetachedRowClick={(row) => {
    const host = row.host;
    if (!host) return;
    const sessionName = row.targetTmuxSession;
    if (!sessionName) return;
    const newTabId = openTab(host, "terminal", undefined, {
      targetTmuxSession: sessionName,
      label: sessionName,
      allowCreateTmux: false,
    });
    selectConversationDeferred(newTabId);
    if (isTouchDevice) navigateToView();
    if (isMobile) setSidebarOpen(false);
  }}
  ```
  Reuses Plan 06-04's mechanisms verbatim.
- ✅ **No dialog, no confirmation, no separate connect step.** The handler is single-click → openTab → selectConversationDeferred → mobile navigate. Zero intermediate UI.
- ✅ **Row's transition from detached to attached is invisible visually.** Under the hood, once `openTab` returns, `setTabs` batches; on the next React commit `updateOpenTabs` fires; the store's dedup logic now finds a matching openTabs entry for the (hostId, sessionName) pair and the row emits from the openTabs path (no `fleetOnly` marker) with the SAME visual chrome as before (per hard_constraint #4, `fleetOnly` is INTERNAL routing marker only; ConversationRow renders identically). `selectConversationDeferred` sets pendingSelectId; when the new tab arrives in updateOpenTabs, selection promotes; the mounted pane becomes visible via the standard tabNodesRef DOM-move mechanism (T-06-02-01 contract preserved).
- ✅ **allowCreateTmux: false is the correct distinction from Plan 06-04's create flow.** Plan 07-01 Task 2 explicit comment: "detached-attach is ATTACH, not create — session already exists on the box". If Ashley clicks a detached row for a tmux session that died between page-load and click (rare — snapshot-on-load contract), backend correctly errors instead of resurrecting an empty pane.

Verdict: **The click-detached-row transparent-attach path is correctly designed and reuses Phase 6 machinery verbatim.**

## Load-bearing contract: RDP rows at bottom (focus area 6)

**Analysis:**
- ✅ **One row per RDP-enabled host.** Plan 07-02 Task 1 Step 2: iterate `state.hostsFlat.entries()`, filter `host.enableRdp === true` (strict identity check — hosts with `enableRdp === undefined` on legacy records don't accidentally emit rows per T-07-02-01 mitigation), emit one row per host.
- ✅ **Monitor icon + host name only, no identity hue, no identity name.** Plan 07-02 Task 2 Step 6: "Use `Monitor` icon from lucide-react for the RDP avatar slot" + explicit "Do NOT render the semibold host-header line for the __rdp__ group (there's no meaningful group name — the shape file said 'just the host name + monitor glyph')". No identity resolution path (ConversationRow's `useIdentities` + `sessionMatchKey` bypassed either via prop or inline render).
- ✅ **Placement at the bottom of the list.** Plan 07-02 Task 1 Step 2: RDP rows emit "at the BOTTOM of the ConversationList (below all identity-tmux HostGroups, below all fleet-only rows)".
- ✅ **Row exists as long as host is RDP-enabled (fleet fact, not tab state).** Plan 07-02 must_haves.truths[1] explicit + Test 33 (enableRdp toggle roundtrip). Independent of whether an RDP tab is currently open.
- ✅ **Click reuses existing RDP tab lifecycle.** Plan 07-02 Task 2 AppShell handler: `openTab(host, "rdp")` — same lifecycle entry point HostsPanel + SessionsPanel + connectHost use today. Zero re-engineering.
- ✅ **Row-shape decision explicit (sentinel HostGroup vs new rdpHosts field).** Plan 07-02 Task 1 Step 2 enumerates both options with recommendation (sentinel-HostGroup for smaller ConversationList type diff) and explicit "CHOOSE ONE approach and commit. Document the choice in the SUMMARY." This matches shape-file "planner's discretion" for row-shape details.

**NOTE-A (non-blocking):** If the executor picks the sentinel-HostGroup approach (`hostId: "__rdp__"`), the current ConversationsPanel render loop at lines 208-215 renders a semibold host-header row unconditionally for every HostGroup. The plan flags this in Task 2 Step 5 ("Do NOT render the semibold host-header line for the __rdp__ group") but the executor MUST land the special-case. If they don't, RDP rows render with an EMPTY semibold header row above them — visible chrome-bug. Test 32's ordering assertion doesn't catch this (it asserts row order, not chrome rendering). Recommend adding a positive assertion to Test 32 or a new Test 34a that the `__rdp__` group's header render is suppressed. Non-blocking; the executor will catch it on UAT.

Verdict: **The RDP-rows-at-bottom contract is correctly designed with legitimate planner discretion on placement approach, one non-blocking chrome-render defense to land.**

## Load-bearing contract: pencil re-style (focus area 7)

**Analysis:**
- ✅ **Existing NewSessionButton is re-styled, NOT replaced or duplicated.** Plan 07-02 Task 2 NewSessionButton changes: ONE import swap + ONE JSX line swap. All other button chrome (`type`, `onClick`, `title`, `aria-label`, `className`, i18n `t("nav.newSession")`) UNCHANGED. Verified against current NewSessionButton.tsx (33 lines — plan claims 34, off by one, cosmetic).
- ✅ **Function unchanged.** NewSessionDialog untouched (plan hard_constraint #5 asserts "NO changes to NewSessionDialog"). Host picker + session-name capture + Cancel/Open flow preserved. `onCreateSession` handler at AppShell:1363-1372 preserved.
- ✅ **Icon choice left to executor discretion within the pencil family.** Plan 07-02 Task 2 read_first section: "Pick ONE that reads as Telegram-native pencil and commits. Plausible names: `Pencil`, `PencilLine`, `PenTool`, `SquarePen`, `Edit`, `Edit2`, `Edit3`. Recommend `Pencil` as the most Telegram-native." Grep gate is generous: `-cE 'Pencil|PenTool|SquarePen|Edit[0-9]?'`.
- ✅ **Placement decision explicit (per-viewport vs consistent-both-viewports).** Shape file allows both defaults. Plan 07-02 must_haves.artifacts["NewSessionButton"].provides mentions "Icon size + button className preserved verbatim to keep visual weight consistent with Plan 06-04's placement." — implicitly commits to consistent-both-viewports (current Plan 06-04 placement is preserved). This is a valid planner-discretion resolution.

Verdict: **The pencil re-style contract is minimal and correct. NewSessionDialog is untouched.**

## Load-bearing contract: mobile gear-dedup fix (focus area 8)

**Analysis:**
- ✅ **`showGear` is gated on `!useIsTouchDevice()` in addition to `onRailClick` typeof check.** Plan 07-02 Task 2 explicit: change `const showGear = typeof onRailClick === "function";` to `const showGear = typeof onRailClick === "function" && !useIsTouchDevice();`. Grep gate asserts the exact literal.
- ✅ **No second detection mechanism introduced (only `useIsTouchDevice()`).** Plan 07-02 imports `useIsTouchDevice` from `@/hooks/use-is-touch-device` — the SAME hook Plan 06-03 and Plan 06-02 already use (single canonical mobile-vs-desktop signal per CONTEXT.md §specifics + Phase 6 hard lock). No plan grep-matches `window.innerWidth`, `matchMedia`, or `navigator.userAgent` for viewport detection.
- ✅ **SettingsRow render condition (already mobile-only) unchanged.** Plan 07-02 explicit: "The SettingsRow's existing render condition (mobile-only, via Plan 06-03's `isTouchDevice` gate in AppShell) stays unchanged." Verified against AppShell.tsx:1348: `settingsRowSlot={isTouchDevice ? <SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} /> : undefined}` — already correctly gated. No change needed there.
- ✅ **Both entry points continue to route to the same menu.** Plan 07-02 hard_constraint #4: "NO changes to what the settings menu contains or does. The SETTINGS_MENU_ITEMS registry from Plan 06-02 (SettingsRow.tsx) is untouched. This plan only changes WHICH entry point renders where, not the menu contents."

**NOTE-B (non-blocking):** The `showGear` grep gate uses `grep -c 'showGear = typeof onRailClick === "function" && !useIsTouchDevice()'` with double-quoted `"function"` — an exact-literal match. If the executor uses single quotes (`'function'`), or double quotes but with a different spacing style (extra whitespace), or Prettier reformats the line, the grep fails. Recommend loosening the grep to `grep -cE 'showGear.*useIsTouchDevice\(\)'`. Non-blocking; the executor's TypeScript build will still pass and Vitest will still validate the runtime behavior — only the grep-gate would produce a false negative.

Verdict: **The mobile gear-dedup fix is correctly minimal. One fragile grep gate but the correctness is independently tested.**

## `must_haves` derivation check

All three plans have `must_haves` blocks with `truths`, `artifacts`, and `key_links`:

| Plan | Truths Count | User-observable? | Artifacts Map to Truths? | Key Links Wire Artifacts? |
|------|-------------|------------------|--------------------------|---------------------------|
| 07-01 | 6 | 5/6 user-observable (fleet visibility on fresh load, attached/detached indistinguishable, click-detached transparent attach, no polling, dedup single-row); truth #6 (Phase 6 behavior preserved verbatim) is a regression property, observable via the Phase 6 regression walk in 07-03 UAT | Yes — each artifact provides a specific capability tied to a truth | Yes — key_links wire AppShell → getSessionList, AppShell → updateFleetSessions, ConversationsPanel → onDetachedRowClick, conversation-store → session-identity dedup |
| 07-02 | 8 | All 8 user-observable (RDP rows at bottom + monitor icon + no hue + no name; RDP row persistence tied to enableRdp; RDP click uses existing tab lifecycle; pencil re-style; mobile no gear; desktop no SettingsRow; both entry points route to same menu; Phase 6+07-01 preserved) | Yes | Yes — key_links wire computeSnapshot → state.hostsFlat + enableRdp filter, ConversationsPanel → useIsTouchDevice, NewSessionButton → lucide-react Pencil, AppShell → openTab("rdp") |
| 07-03 | 3 | 2/3 user-observable (build carries Phase 7 signals into dist; deploy behind mandatory 15-min deadman); truth #2 (UAT checklist exists) is a process artifact but appropriate for a verification/deploy plan | Yes — UAT checklist + patches-md entry + build-verify log all provide capabilities tied to the truths | Yes — key_links wire dist/*.js → grep-detectable Phase 7 markers, deploy invocation → deploy-runbook.md, UAT checklist → every TG-12..18 requirement |

Verdict: **must_haves are well-derived from the phase goal.** No vacuous truths. No implementation-only truths that fail to restate observable success criteria. The `fleetOnly` marker is correctly framed as INTERNAL (not user-observable) in Plan 07-01 hard_constraint #4 — this is the correct anti-truth for TG-13.

## STRIDE threat model coverage

Every plan has a `<threat_model>` block:

| Plan | Threats Enumerated | Notable |
|------|-------------------|---------|
| 07-01 | T-07-01-01 (dedup key collision), 02 (accidental polling regression), 03 (fleet-session list disclosure), 04 (malformed getSessionList response), 05 (detached-row-click bypass), 06 (race between hostsFlat update and fleet-row click), SC (supply chain) | T-07-01-02 is the load-bearing one for TG-17 — grep gates on `setInterval|setTimeout` + NOT wired to `termix:hosts-changed` are the concrete defenses. Directly addresses shape-file "even free polling that manifests as visible list mutations violates the shape." |
| 07-02 | T-07-02-01 (enableRdp undefined nullable field), 02 (host name disclosure), 03 (many RDP hosts flooding list), 04 (onRdpRowClick authz bypass), 05 (mobile viewport race with useIsTouchDevice), SC | T-07-02-01 is the correct defense against legacy Host records without the `enableRdp` field — strict `=== true` comparison, not truthy coerce. Prevents accidental RDP-row emission for hosts that were created before the enableRdp field was added. |
| 07-03 | T-07-03-01 (bad build wedges Termix container), 02 (deadman not armed before docker compose up), 03 (deploy without Ashley's approval), 04 (deploy exposes Phase 7 code), SC | T-07-03-02 the critical one — sentinel-cleanup-before-arm step (`sudo rm -f /tmp/termix-keep-patched`) is the belt-and-braces defense against a stale sentinel from a prior deploy neutralizing the new deadman. |

**Total threats: 18 (including 3 SC), all mitigated or accepted with rationale.** T-07-01-02 (polling regression) is the phase-goal-critical threat and has explicit programmatic defense (grep gates) — this is the primary shape-lock enforcement. Every threat has an explicit disposition.

**NOTE-C (non-blocking):** Plan 07-02's threat register does NOT enumerate the "sentinel-HostGroup empty-header chrome bug" as a T-07-02-XX entry (see NOTE-A). Would be a Tampering-adjacent chrome-integrity concern. Non-blocking because the plan flags the defense in Task 2 behavior; adding it to the threat model would improve completeness but wouldn't change the executor's action.

## Task 2 coupling justification (focus area 11)

Plan 07-01 Task 2 combines panel + AppShell wiring + persistence-test extension in ONE task rather than splitting per-file. Planner's justification: "the coupling makes both files' changes meaningless without the other."

**Analysis:**
- ConversationsPanel gains an `onDetachedRowClick?` prop AND wires `handleRowSelect(row)` to route through it based on `row.fleetOnly`. Without the prop being wired at the AppShell mount site, `row.fleetOnly` rows would silently fall through to `selectConversation(row.id)` — which would then be rejected by the T-06-01-01 stale-guard (the fleet id `fleet::1::work` is not in openTabs), silently doing nothing when Ashley clicks a detached row. This is invisible correctness rot — no error, no test failure at the ConversationsPanel level, just Ashley's click doing nothing.
- Conversely, without the ConversationsPanel routing the click to the new prop, the AppShell handler is dead code — no test failure, no visual regression, just an unused prop.
- The persistence-test extension (Test 4) asserts the STORE contract for the click handler's inputs — proves that after `updateHostsFlat + updateFleetSessions`, the store snapshot contains a fleet-derived row with the expected shape (host resolved, id `fleet::1::work`, fleetOnly: true). This is a valuable regression-catch for future refactors that might accidentally break the resolution chain.

Verdict: **The coupling justification is sound.** Splitting into two tasks would either leave the phase in a "wired-but-not-consumed" state or a "consumed-but-not-wired" state mid-plan. Either partial state is a phase-incomplete condition. Bundling forces atomic delivery.

## 07-01 persistence test extension (focus area 12)

Plan 07-01 claims ONE new test added to `AppShell.persistence.test.tsx` (Test 4 for fleet-derived row shape), Tests 1-3 preserved verbatim (Plan 06-02's T-06-02-01 MountManager scaffold contract).

**Analysis:**
- ✅ **Verified against actual file:** `AppShell.persistence.test.tsx` currently has 3 tests (Test 1 DOM node identity, Test 2 mount-count invariant, Test 3 visibility toggle). Plan 07-01 grep gate: `test $(grep -c "^  it(" src/ui/AppShell.persistence.test.tsx) -eq 4` — exactly 4 tests post-plan.
- ✅ **Test 4 does NOT restructure the MountManager scaffold.** The scaffold is a minimal ~60-line MountManager component that reproduces the tabNodesRef DOM-move mechanism. Test 4 uses the REAL conversation-store (no mocks) and asserts the store snapshot shape after `updateHostsFlat + updateFleetSessions` — it does NOT touch the MountManager or its Tests 1-3. Grep gates additionally assert `createPortal(` count remains 1 (T-06-02-01 mount-lifecycle contract).
- ✅ **Test 4 does NOT call openTab.** Plan 07-01 Task 2 explicit: "The test does NOT actually call openTab (that's an AppShell integration concern deferred to Plan 07-03 UAT); it proves the store's contract for the click handler's inputs is met." This is the correct scope split — programmatic tests own the deterministic store-level contract; UAT owns the integration walk.

Verdict: **The persistence-test extension is minimal and correct. Tests 1-3 are preserved verbatim per the T-06-02-01 mount-lifecycle contract.**

## Deploy discipline (focus area 13)

Plan 07-03 Task 4 how-to-verify block audited against `~/.claude/identities/tina/deploy-runbook.md` requirements:

- ✅ **References `~/.claude/identities/tina/deploy-runbook.md` explicitly.** Task 4 how-to-verify: "mirrors `~/.claude/identities/tina/deploy-runbook.md`". Also referenced in hard_constraints, verification block, and multiple <what-built>/<how-to-verify> sub-sections.
- ✅ **Mandatory 15-min deadman.** Explicit `nohup sudo -b bash -c 'sleep 900; [ ! -f /tmp/termix-keep-patched ] && bash /opt/termix/.tmp-revert.sh'` pattern. Wall-clock time noted.
- ✅ **Sentinel cleanup BEFORE deadman arm.** Step c: `sudo rm -f /tmp/termix-keep-patched` — belt-and-braces defense per T-07-03-02.
- ✅ **Narrow pkill disarm.** Step h: `sudo pkill -f 'sleep 900; \[ ! -f /tmp/termix-keep-patched'` — narrow pattern-match on the deadman-specific sleep loop, not a broad `pkill sleep`.
- ✅ **Check-before-recreate compose file safety.** Not explicit as a "check-before" step, but the plan does specify container health check (`docker compose ps termix` → healthy) AFTER the recreate — the sentinel-cleanup-before-arm handles the state hygiene concern. Not a blocker.
- ✅ **Ashley-gated resume-signal enumeration.** Task 4 resume-signal enumerates all four states: `approved`, `approved but I'll UAT tomorrow`, `wait, [issue]`, `deploy without deadman → REFUSE`. Matches the fork DEPLOY DISCIPLINE + CLAUDE.md 2026-07-03 lock.

**NOTE-D (non-blocking):** Task 4 step (a) says "Push the branch to the deploy remote (`git push origin feat/tab-title-from-tmux`) OR sync via the fork's existing deploy path (whichever is fresh in Ashley's box-map.md)." The "OR" leaves the executor a choice; the deploy-runbook.md canonical path should be preferred (deployer must consult it at Task 4 execution time). Not a blocker; the checkpoint's blocking nature and Ashley's oversight will catch any deviation.

Verdict: **Deploy discipline matches Phase 6's pattern and the deploy-runbook.md canonical flow.**

## Patch numbering (focus area 14)

Plan 07-03 uses patch #106 draft.

**Analysis:**
- ✅ **Termix-patches.md verified — patch #105 is the highest.** `grep -in "105\|106" ~/.claude/identities/tina/termix-patches.md` shows patch #105 at line 7213 as the most recent entry (`feat(navigation): telegram-like interface — sidebar conversation list, tab strip removed, mobile list-vs-view flow, session persistence across switches — Phase 6, shipped 2026-07-21`).
- ✅ **Patches-md entry format follows patch #105 precedent.** Plan 07-03 Task 3 explicit: "structured for post-UAT paste into `~/.claude/identities/tina/termix-patches.md`" with the sections What-it-does / motivating-gap / changed-files / constraints-preserved / deploy / follow-ups. Multi-commit format under one PIN (matches patch #105's "Multi-commit patch (9 code commits landing across 4 waves + 1 verify wave under this one patch number)" precedent).
- ✅ **Bounty closure line references the shared Phase 6 + Phase 7 arc.** Task 3 patches-md draft: "Bounty `telegram-like-interface` (Tina's identity) tracks Phase 6 + Phase 7 as one arc across two ship steps. Closed via `/close telegram-like-interface` after this patch's UAT sign-off." Matches CONTEXT.md §"Bounty tracker: SAME as Phase 6."

Verdict: **Patch numbering + bounty closure are correct.**

## Cross-plan concerns

### Integration risks

1. **NOTE-A: RDP sentinel-HostGroup empty-header chrome bug (Plan 07-02 Task 2 Step 5).** If executor picks sentinel-HostGroup approach with `hostId: "__rdp__"` and `hostName: ""`, ConversationsPanel's existing render loop (lines 208-215) will render an EMPTY semibold header row above the RDP rows. Plan 07-02 flags this in Task 2 Step 5 ("Do NOT render the semibold host-header line for the __rdp__ group") but the executor MUST land the special-case. **Non-blocking; the executor will catch it on manual visual inspection during Task 1 verify or UAT.** Recommend adding a positive Vitest assertion — e.g., render ConversationsPanel with an `hostId === "__rdp__"` group and assert `queryByText("")` for the header row returns null.

2. **NOTE-B: `showGear` grep gate fragility (Plan 07-02 Task 2 verify block).** Exact-literal match with double-quoted `"function"`. If executor uses single quotes or Prettier reformats, the grep fails. Recommend loosening to `grep -cE 'showGear.*useIsTouchDevice\(\)'`. **Non-blocking; the correctness is independently validated by TypeScript build + runtime behavior in UAT.**

3. **NOTE-C: Plan 07-01/07-02 `hostsFlat` invariant drift.** Plan 07-01 Task 1 Step 4 says "hostsFlat does NOT affect the derived ConversationList shape (rendering-only lookup)." Plan 07-02 Task 1 Step 2 uses `state.hostsFlat` inside `computeSnapshot` to emit RDP rows — after Plan 07-02 lands, the 07-01 statement is stale. **Non-blocking documentation drift; both plans bump snapshotVersion correctly.** Recommend updating 07-01 Task 1 Step 4's language to "hostsFlat's initial purpose is fleet-row Host enrichment; Plan 07-02 extends its use for RDP row emission."

4. **NOTE-D: Fetch race between `getSessionList` and `loadHosts` (Plan 07-01 Task 2).** Both fire on mount. If `getSessionList` resolves BEFORE `loadHosts`, the first snapshot renders fleet rows with `host: undefined` (host resolution falls back to `session.hostName` for the group header and leaves `row.host === undefined`). When `loadHosts` completes and updates `realHostTree` → `hostsById` memo → `updateHostsFlat`, snapshot re-emits with resolved hosts. User MAY see a brief flash of fleet rows without a proper Host object (row.host === undefined means no host-name secondary line in ConversationRow at lines 113-117). Plan 07-01 handles this via fallback (T-07-01-06). **Non-blocking; race is milliseconds and the fallback is a semantic no-op (session name still shows).** Recommend 07-03 UAT §Plan 07-01 additional adds an explicit walk: "load Termix and immediately click a fleet row before the sidebar host-tree finishes populating — the click either works or silent no-ops, but never crashes."

5. **NOTE-E: hostsFlat rebuild on host-poll thrash.** `hostsById` memo is keyed on `stableHostTreeKey` (JSON snapshot of realHostTree — the NOTE-05 thrash-guard from Phase 6). But `buildHostTree` reconstructs Host objects on every rebuild, so even a content-equal poll produces reference-inequal Host references. `updateHostsFlat`'s per-value ref-inequal check will detect this as a mutation → snapshotVersion bumps → all ConversationsPanel consumers re-render. Matches Phase 6's known NOTE-05 pattern. **Non-blocking (pre-existing behavior).** Recommend either (a) deep-equal Host comparison in `updateHostsFlat`, or (b) memoize Host object identities across buildHostTree rebuilds. Both are future-optimization concerns.

6. **NOTE-F: NewSessionButton line-count claim off by one (Plan 07-02 Task 2 read_first).** Plan says "34 lines"; actual file is 33 lines. **Cosmetic; doesn't affect execution.**

7. **NOTE-G: Test 30 redundant with existing pinConversation guard (Plan 07-01 Task 1).** The store's pinConversation at conversation-store.ts:348-358 already rejects any id not in openTabs. Fleet-only row ids never appear in openTabs. Test 30 asserts the pin action no-ops. **Non-blocking; defensible as regression test — a future refactor of pinConversation that accidentally relaxed the guard would need Test 30 to catch it.**

### Sequencing / dependency graph

Verified dependency graph (from frontmatter):
```
07-01 (wave 1, no deps)
  └─ 07-02 (wave 2, depends on 07-01)
       └─ 07-03 (wave 3, depends on 07-01 AND 07-02)
```

- ✅ No cycles.
- ✅ No forward references.
- ✅ Wave numbers = max(deps) + 1 for every plan.
- ✅ Plan 07-02 correctly depends on 07-01 (it extends the store's computeSnapshot which 07-01 established; adds to conversation-store.test.ts after 07-01's Tests 23-30; extends ConversationsPanel where 07-01 added onDetachedRowClick + handleRowSelect; extends AppShell where 07-01 added hostsById + updateHostsFlat).
- ✅ Plan 07-03 correctly depends on both 07-01 and 07-02 (build verify gates on both being present in dist; UAT walks all TG-12..18 which requires both plans landed).

### Coupled-deploy verification

- ✅ **Only Plan 07-03 owns the deploy checkpoint (Task 4).**
- ✅ **Plans 07-01, 07-02 have `autonomous: true` and produce ZERO deploys.**
- ✅ **Plan 07-03 Task 1 gates on Phase 7 signals present in dist AND Phase 6 signals still present (regression).** `fleet::` + `rdp-host::` markers, `sessions/list` URL literal, plus retention of `nav.conversations` (Phase 6 marker), plus absence of `TabBar` + `MobileBottomBar` (Phase 6 deletions). No intermediate half-shipped state possible.
- ✅ **No plan attempts to deploy 07-01 or 07-02 alone.** Both are explicitly foundation for 07-03's deploy checkpoint.

## Rebase-worthiness check (fork constraint from CLAUDE.md)

CLAUDE.md constraint: "Every fork commit must survive rebases against upstream `main`." Analysis:

- Plans 07-01, 07-02 extend fork-only files: `conversation-store.ts` + `conversation-store.test.ts` (added in patch #105, fork-only), `ConversationsPanel.tsx` (added in patch #105, fork-only), `NewSessionButton.tsx` (added in patch #105, fork-only), `AppShell.persistence.test.tsx` (added in patch #105, fork-only). LOW rebase risk on these — upstream doesn't have them.
- Plan 07-01 + 07-02 edit `src/ui/AppShell.tsx` (patch #35 territory + patch #105 conversation-store wiring). MEDIUM rebase risk on AppShell — upstream restructuring of tab-manager or sidebar-panel territory would require careful re-apply. This risk was already documented for patch #105 (see 06-PLAN-CHECK.md rebase-worthiness section).
- Zero new npm dependencies — no package.json diff, no lockfile diff. Rebase-friendly.
- Zero backend / docker / nginx changes — no CLAUDE.md "Nginx caveat" trap (Phase 7 is frontend-only, matching Phase 6 pattern).

Verdict: **Rebase-worthy.** The AppShell edit surface is documented as MEDIUM risk following the patch #105 precedent, which is honest and appropriate for a fork commit that will need to survive future upstream rebases.

## Verdict rationale

Every one of the 10 numbered success criteria in CONTEXT.md maps to a covering task in ≥1 plan, and every task has a verify step + acceptance criteria + a UAT walk in 07-03. Every LOCKED decision in CONTEXT.md `<decisions>` is honored. Every scope-fence item is enforced by grep gate. The load-bearing engineering commitments — fleet ∪ openTabs union with openTabs-entry-wins dedup, `fleetOnly` INTERNAL routing marker (zero visual distinction), one-shot getSessionList fetch not wired to hosts-changed, `allowCreateTmux: false` on detached-row-click (attach ≠ create), RDP row derivation from `state.hostsFlat` filtered on strict `enableRdp === true`, RDP click reusing existing openTab lifecycle, pencil re-style as one-line NewSessionButton icon swap with NewSessionDialog untouched, `showGear` gated on `!useIsTouchDevice()` as the SOLE mobile detection signal, T-06-02-01 mount-lifecycle contract byte-preserved, zero touches to pretty-view / Terminal.tsx / guacamole / backend / docker / package.json, mandatory 15-min deadman rollback per deploy-runbook.md, patch #106 numbering following patch #105 precedent, bounty closure via `/close telegram-like-interface` after Ashley's UAT sign-off — are all correctly named and enforced.

The 7 notes (NOTE-A through NOTE-G) are all non-blocking design tensions or executor-facing clarifications that improve quality but do not risk phase-goal delivery. The most substantive is NOTE-A (RDP sentinel-HostGroup empty-header chrome bug) which is called out in the plan behavior but the executor MUST land the special-case; NOTE-B (fragile showGear grep gate) which the executor's TypeScript build + UAT will catch independently; NOTE-D (fetch race) which is a semantic no-op with fallback in place; and NOTE-E (hostsFlat rebuild thrash) which is pre-existing Phase 6 behavior.

Phase 7 plans are ready for Ashley's execution green-light.

## Action items (optional, non-blocking)

If Ashley wants the planner to strengthen the plans before executing, here are the small revisions worth batching:

1. **Plan 07-02 Task 2 Step 5**: if executor picks sentinel-HostGroup approach, add positive Vitest assertion that the `hostId === "__rdp__"` group's semibold header row does NOT render. (Addresses NOTE-A.)
2. **Plan 07-02 Task 2 verify block**: loosen the `showGear` grep gate from exact-literal match to `grep -cE 'showGear.*useIsTouchDevice\(\)'`. (Addresses NOTE-B.)
3. **Plan 07-01 Task 1 Step 4**: update the "hostsFlat does NOT affect the derived ConversationList shape (rendering-only lookup)" language to acknowledge Plan 07-02's extended use for RDP row emission. (Addresses NOTE-C.)
4. **Plan 07-03 Task 2 UAT checklist**: add explicit walk under §"Phase 7 additional" for the fetch-race resilience — click a fleet-only row before the sidebar host-tree finishes populating; verify the click either works or silent no-ops (never crashes). (Addresses NOTE-D.)
5. **Plan 07-02 Task 2 read_first**: correct NewSessionButton line count from "34 lines" to "33 lines". (Addresses NOTE-F, cosmetic.)

None are blockers. All can be deferred to executor discretion with summary-recording.

---

## Summary

- **Verdict:** PASS_WITH_NOTES
- **Blockers:** 0
- **Needs-revision:** 0
- **NOTE-severity findings:** 7 (NOTE-A through NOTE-G)
- **Coverage:** 7/7 TG requirements (TG-12..18) + 10/10 Success Criteria + all 10 scope-fence items + all 5 load-bearing contracts (fleet ∪ openTabs union with openTabs-entry-wins dedup; click-detached transparent attach reusing openTab + selectConversationDeferred; RDP rows at bottom with monitor icon + no hue + no identity name; pencil re-style with NewSessionDialog untouched; mobile gear-dedup fix via `showGear += !useIsTouchDevice()`)
- **Ready for execution:** Yes
