---
phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session
plan: 07
subsystem: frontend
tags:
  [
    frontend,
    shell,
    pane-wrapper,
    kind-branch,
    tab-router,
    sidebar-to-tab,
    wire-up,
    wave-close,
    correct-file-path,
    correct-dispatch-chain,
    blocker-3-fix,
    tdd,
    slice-d,
  ]

# Dependency graph
requires:
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-01
    provides: Tab widened with sessionKind + relayRoomId + relayRoomTitle + FleetSession widened with kind + roomId + roomTitle — CONSUMED at every seam this plan touches
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-05
    provides: RelayRoomPane component (fully wired end-to-end in Plan 06) — CONSUMED by RelayRoomSessionPane wrapper
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-06
    provides: RelayRoomPane fully wired end-to-end (WS + AgentBadgeWithAppendage + ComposeBoxShell) — the pane the RelayRoomSessionPane wrapper mounts is now live
provides:
  - RelayRoomSessionPane wrapper — peer of IdentitySessionPane; mounts RelayRoomPane inside the standard pane wrapper with forwardRef IdentityPaneHandle-shaped no-op surface
  - tabUtils.tsx TerminalOrIdentitySessionPane dispatcher grows a THIRD branch (placed FIRST — most-specific discriminator wins) for tab.sessionKind === "relay-room"; existing IdentitySessionPane + TerminalTabContent branches byte-unchanged
  - ConversationRow widened with kind + roomId + roomTitle passthrough from FleetSession at the synthetic-row build site (conversation-store.ts)
  - PrettyConversationsPanel handleRowSelect widened with a new priority branch (AFTER rdpHostRow + fleetOnly, BEFORE default selectConversation) that fires new onRelayRoomRowClick(row) callback prop
  - AppShell openTab first arg widened to accept `Host | null` (relay-room tabs have no Host) + options bag widened with sessionKind + relayRoomId + relayRoomTitle
  - AppShell onRelayRoomRowClick wiring at the PrettyConversationsPanel invocation site — the last mile that makes a relay-room-row click open the RelayRoomPane end-to-end
affects:
  [
    "Phase 90 slice D deliverable — every D-decision (D-01..D-20) is now realized end-to-end; Alice can UAT the relay pane by clicking a relay-room sidebar row",
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Most-specific-discriminator-wins dispatcher branch ordering: tabUtils's TerminalOrIdentitySessionPane places the sessionKind === 'relay-room' branch FIRST (source line 190) BEFORE isIdentityPane (line 222). Grep gate + source-order test guard against a future refactor that reorders branches. Backward-compat: any tab WITHOUT sessionKind (or with sessionKind === 'harness') falls through to the existing identity-pane / terminal branches byte-unchanged."
    - "Peer-wrapper pattern: RelayRoomSessionPane mirrors IdentitySessionPane's shell contract (forwardRef + IdentityPaneHandle-shaped useImperativeHandle) as no-ops so any polymorphic tab.terminalRef consumer keeps working as a benign no-op on relay panes. IdentitySessionPane byte-untouched (D-03 spirit)."
    - "Priority-slot row-click widening: handleRowSelect's new relay-room branch is placed AFTER rdpHostRow + fleetOnly (which gate on their own row-shape markers — a relay-room row is neither) BEFORE the default selectConversation path. Same discipline as the existing two branches: early-return + fire onConversationSelected alongside."
    - "Defensive fall-through on inconsistent state: both tabUtils (missing relayRoomId) and PrettyConversationsPanel (missing roomId) log-and-fall-through when the discriminator is present but the identity axis is missing. Never crash. Backend shouldn't emit this state per Plan 04 wire discipline; belt-and-suspenders."
    - "openTab first-arg widening `Host | Host | null`: relay-room tabs have NO Host (the room lives on the Matrix relay, not any fleet host). The signature widening is minimal (one nullable) with a `hostNameForId = host?.name ?? 'relay-room'` fallback for the id shape and a `hostName = host?.name ?? relayRoomTitle ?? relayRoomId ?? 'Relay room'` fallback for the label. Legacy callers pass a Host as before; no call-site diff for non-relay paths."
    - "Comment-token hygiene per Plan 02/05/06 precedent: acceptance criteria grep gates enforce literal `grep -c <token> == 0` on words like `Terminal`, `MessageQueueDrawer`, `IdentityModal`, `viewingUserMxid` inside RelayRoomSessionPane.tsx. Docstrings paraphrase (e.g., 'xterm.js surface' instead of 'Terminal') so the gates don't false-positive on descriptive comments."
    - "TDD RED/GREEN atomic-commit cadence: 3 tasks × 2 commits each (6 total). RED signal for a new module is a vitest import-resolution failure at transform time. RED signal for widening an existing module is a set of failing test assertions on the yet-to-be-added behavior."
    - "Rules-of-hooks hoist: the useIdentities() hook call in tabUtils's TerminalOrIdentitySessionPane was moved ABOVE the new conditional early return so hooks run unconditionally regardless of which branch fires. Minor pre-existing structural fix piggybacked in the same edit — no behavior change on the identity-branch path."

key-files:
  created:
    - src/ui/shell/RelayRoomSessionPane.tsx
    - src/ui/shell/RelayRoomSessionPane.test.tsx
    - src/ui/shell/tabUtils.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx
  modified:
    - src/ui/shell/tabUtils.tsx (import RelayRoomSessionPane + widen TerminalOrIdentitySessionPane with third branch placed FIRST; hoist useIdentities() above the branch for rules-of-hooks)
    - src/ui/state/conversation-store.ts (widen ConversationRow with optional kind + roomId + roomTitle fields; propagate them from FleetSession at fleetSyntheticRows build site)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (add onRelayRoomRowClick prop + widen handleRowSelect with new priority branch AFTER rdpHostRow + fleetOnly, BEFORE default selectConversation; defensive log-and-fall-through on missing roomId)
    - src/ui/AppShell.tsx (widen openTab first arg to Host|null + options bag with sessionKind/relayRoomId/relayRoomTitle; wire onRelayRoomRowClick at PrettyConversationsPanel invocation site mirroring onDetachedRowClick shape)

key-decisions:
  - "RelayRoomSessionPane exposes an IdentityPaneHandle-shaped surface with EVERY method as a no-op — even the TerminalHandle base methods (disconnect / reconnect / fit / sendInput / notifyResize / refresh / openFileManager) that relay panes have zero business acting on. Rationale: preserves polymorphism at tab.terminalRef call sites (existing code that reaches through .togglePrettyMode() etc. keeps working as a benign no-op). Alternative (expose a narrower handle type + narrow at call sites) would have required auditing every tab.terminalRef consumer — significantly more scope for the same UX outcome."
  - "onRelayRoomRowClick placed AFTER rdpHostRow + fleetOnly branches in handleRowSelect (not before). Rationale: a relay-room row is NEVER also rdpHostRow or fleetOnly (three mutually-exclusive row types), so the ordering is functionally equivalent BUT preserves the existing rdp + fleetOnly priority slots — no risk of a future ConversationRow shape edit accidentally routing a relay-room row through a wrong branch. Discipline matches the two branches above verbatim (early return + fire onConversationSelected alongside)."
  - "openTab first arg widened to `Host | null` rather than adding a second overload or a discriminated-union spawn helper. Rationale: one nullable at the call signature is the smallest diff that unlocks the relay-room path; only the AppShell onRelayRoomRowClick callback ever passes null (verified via grep). A second overload would have forced every existing call site to think about which shape to pick; the discriminated-union path would have cascaded into every openTab consumer. The nullable+fallback pattern (`hostNameForId = host?.name ?? 'relay-room'`) is the minimum-blast-radius option."
  - "Persistent-tab addOpenTab call passes `hostId: host ? parseInt(host.id) : null` for host-less relay-room tabs. Backend layer already tolerates null hostId for other tab types with no host binding (settings singletons, dashboard). Deferred to a follow-up: whether relay-room tabs should even PARTICIPATE in open-tab restore (they might not — a restored relay-room tab needs the room membership check to still pass on rehydrate, which is a Plan 89 concern). For now, they persist with null hostId; consumers reading persisted tabs can filter on hostId != null OR sessionKind === 'harness' if they want to exclude relay-room from restore."
  - "ConversationRow widened with optional kind + roomId + roomTitle rather than a discriminated-union split (HarnessRow | RelayRoomRow). Rationale: matches Plan 01's flat-optional-widening precedent for FleetSession + RemoteTmuxSession — keeps every existing row constructor working without narrow branches. openTab-derived rows and RDP synthetic rows never set the new fields; only fleet-synthetic relay-room rows do. Consumers reading kind treat undefined as harness (backward-compat rule)."
  - "onRelayRoomRowClick prop OMITTED from PrettyConversationsPanel → row falls through to selectConversation (matches rdpHostRow/fleetOnly semantics per Test 2b). Alternative (assert-fail when the prop is missing) was rejected because pre-Plan-07 test code that renders the panel without wiring any relay-room callbacks would break; and Plan 04 backend contract does emit relay-room rows only when the client has opted into the session-kind-branched sidebar merge (Phase 89) — legacy callers won't see relay-room rows in the first place."
  - "Defensive AppShell-side check on missing roomId ALSO fires (in addition to the panel-side check). Rationale: two layers of defense — the panel could theoretically be called from a non-AppShell consumer that doesn't run the same integrity check. The AppShell warn is a distinct message ('relay-room row missing roomId at AppShell') so the log source is unambiguous when triaging."
  - "Task 3 tests co-located as PrettyConversationsPanel.relay-room.test.tsx rather than extending the existing 4743-line PrettyConversationsPanel.test.tsx. Same precedent Plan 90-05 established (RelayRoomInboundBubble.test.tsx co-located rather than extended pretty-view test file). Keeps the new coverage isolated + easy to locate."

patterns-established:
  - "Peer-wrapper for shell-level pane types: when adding a new pane implementation (relay-room here, future TBD elsewhere) that needs to plug into tabUtils's dispatcher, create a shell wrapper that mirrors an existing peer's forwardRef + useImperativeHandle contract as no-ops. Keeps polymorphism at ref call sites intact without forcing every consumer to narrow."
  - "Most-specific-discriminator-wins branch ordering + source-order regression gate: for any conditional dispatcher that grows a branch on a new discriminator, place the new branch FIRST in source order AND add a test that asserts the source-order (via file read + string index comparison). Prevents a future refactor from silently reordering branches and misrouting."
  - "openTab first-arg widening to `Host | null` for host-less tab types: the fallback pattern (`hostNameForId = host?.name ?? '<type-slug>'` for the id + `hostName = host?.name ?? <label-source> ?? '<default>'` for the label) generalizes to any future host-less tab type (e.g., 'shared-notes', 'admin-panel'). One-nullable is a smaller diff than a discriminated-union spawn helper."
  - "Row-click callback prop-slot pattern: PrettyConversationsPanel now has three parallel row-type-specific callback props (onRdpRowClick, onDetachedRowClick, onRelayRoomRowClick) plus the catch-all selectConversation → onConversationSelected pair. Each row-type branch fires its specific callback + onConversationSelected. Future row types (e.g., a hypothetical 'shared-notes' row) can follow the same pattern: add the callback prop, add a priority branch in handleRowSelect, wire the callback at the AppShell invocation site."

requirements-completed:
  [
    D-15-consumption,
    D-18,
    Kind-Discriminator-Branch,
    Sidebar-To-Tab-Kind-Thread,
    BLOCKER-3-fix,
  ]

# Metrics
duration: 12 min
completed: 2026-09-08
---

# Phase 90 Plan 07: Kind-branch wiring — RelayRoomSessionPane wrapper + tabUtils third branch + sidebar row-click threading (BLOCKER #3 fix) Summary

**The last mile: sidebar click on a `kind: 'relay-room'` row now opens the RelayRoomPane end-to-end. RelayRoomSessionPane wrapper mirrors IdentitySessionPane's shell contract as a peer; tabUtils dispatcher grows a THIRD branch placed FIRST (most-specific discriminator wins) for tab.sessionKind === 'relay-room' with defensive fall-through on missing relayRoomId; PrettyConversationsPanel.handleRowSelect grows a new priority branch AFTER rdpHostRow + fleetOnly BEFORE default selectConversation, firing new onRelayRoomRowClick(row) prop; ConversationRow widened with kind + roomId + roomTitle passthrough from FleetSession at the synthetic-row build site; AppShell openTab first arg widened to `Host | null` + options bag with sessionKind/relayRoomId/relayRoomTitle; onRelayRoomRowClick wired at the PrettyConversationsPanel invocation site mirroring the shape of onDetachedRowClick. Every D-decision from Phase 90 (D-01..D-20) is now realized end-to-end. BLOCKER #3 fixed: correct file path (src/ui/features/pretty-conversations/, NOT src/ui/sidebar/) + correct dispatch chain (selectConversation + onConversationSelected, NOT openSessionInTree). D-01/D-03 upheld: pretty-view + backend + IdentitySessionPane byte-untouched.**

## Performance

- **Duration:** ~12 minutes (start 2026-09-08T22:17:32Z; final task GREEN commit 2026-09-08T22:28:XXZ)
- **Started:** 2026-09-08T22:17:32Z (plan-loaded)
- **Completed:** 2026-09-08T22:29:XXZ (final task committed)
- **Tasks:** 3 of 3 executed
- **Files created:** 4 (1 impl + 3 test — RelayRoomSessionPane + RelayRoomSessionPane.test + tabUtils.test + PrettyConversationsPanel.relay-room.test)
- **Files modified:** 4 (tabUtils.tsx + conversation-store.ts + PrettyConversationsPanel.tsx + AppShell.tsx)

## Accomplishments

- **RelayRoomSessionPane wrapper lands** at `src/ui/shell/RelayRoomSessionPane.tsx`. Peer of IdentitySessionPane. Mounts RelayRoomPane inside the standard pane wrapper (`h-full w-full relative flex flex-col`) with forwardRef exposing an IdentityPaneHandle-shaped useImperativeHandle whose every method (togglePrettyMode, toggleMessageQueue, disconnect, reconnect, fit, sendInput, notifyResize, refresh, openFileManager) is a no-op. Structured mount log via `console.info({operation: 'relay_room_session_pane_mount', tabId, roomId})` (never JSON.stringify on raw objects per PATTERNS.md § 2). NO viewingUserMxid prop threaded — Plan 05 W#8 resolution: the pane sources it internally via useViewingUserMxid. Zero mount of the pretty-view/terminal-mode primitives (grep gates enforce 0 counts on Terminal / MessageQueueDrawer / IdentityModal / viewingUserMxid in the file). D-01/D-03 upheld: pretty-view untouched; IdentitySessionPane byte-untouched.

- **tabUtils.tsx dispatcher grows a THIRD branch** at `src/ui/shell/tabUtils.tsx`. The existing `TerminalOrIdentitySessionPane` at L153-219 (per PATTERNS.md § tabUtils.tsx) grew a new branch placed FIRST (most-specific discriminator wins): `if (tab.sessionKind === "relay-room" && tab.relayRoomId) return <RelayRoomSessionPane ...>`. Defensive fall-through if `sessionKind` is 'relay-room' but `relayRoomId` is missing — `console.warn("relay-room tab missing relayRoomId", {tabId})` and falls through to the existing dispatcher rather than crash (belt-and-suspenders; tab-open path should always set both fields together). `useIdentities()` hoisted above the conditional early return so rules-of-hooks stays honored (hook must run unconditionally regardless of which branch fires — minor pre-existing structural fix piggybacked here, no behavior change on the identity-branch path). Existing IdentitySessionPane + TerminalTabContent branches byte-unchanged (Tests 1/1b/2 regression gates enforce). Source-order gate (Test 6): asserts via a file read + string index comparison that the relay-room branch appears BEFORE the identity-pane branch — trips any future refactor that accidentally reorders branches.

- **ConversationRow widened + FleetSession → row passthrough** at `src/ui/state/conversation-store.ts`. ConversationRow gains optional `kind` + `roomId` + `roomTitle` fields (Plan 01 widened the underlying FleetSession; Task 3 lands the row-side passthrough). At the `fleetSyntheticRows` build site (L~660), the three fields are propagated from FleetSession → syntheticRow. Undefined-vs-explicit distinction preserved on `kind` and `roomId` per Plan 01 reader-boundary discipline (consumers treat undefined as harness backward-compat). `roomTitle` uses the same `?? null` coerce as lastMessageAt + aiTitle. Non-relay-room paths never touch the new fields — pre-Phase-90 row constructors (openTab-derived rows, RDP synthetic rows) still typecheck.

- **PrettyConversationsPanel.handleRowSelect widened (BLOCKER #3 fix — CORRECT FILE PATH)** at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L980-1003. New `onRelayRoomRowClick?: (row: ConversationRowShape) => void` prop added alongside existing onDetachedRowClick / onRdpRowClick / onConversationSelected at L274-312. `handleRowSelect` grew a new priority branch placed AFTER rdpHostRow + fleetOnly (both are mutually-exclusive with relay-room rows, but preserving the existing priority slots protects against future ConversationRow shape edits accidentally routing wrong) BEFORE the default selectConversation path. Discipline mirrors the two branches above verbatim: early return + fire `onConversationSelected?.(row.id)` alongside. Defensive: missing `roomId` → `console.warn("relay-room row missing roomId", {rowId})` + fall through to default selectConversation. When `onRelayRoomRowClick` prop is omitted, relay-room rows fall through to selectConversation (matches rdpHostRow/fleetOnly semantics per Test 2b — silent-no-op at the store level).

- **AppShell.openTab widened + onRelayRoomRowClick wired (BLOCKER #3 fix — CORRECT DISPATCH CHAIN)** at `src/ui/AppShell.tsx`. `openTab` first arg widened to accept `Host | null` (relay-room tabs have NO Host — the room lives on the Matrix relay, not any fleet host) + options bag widened with optional `sessionKind` + `relayRoomId` + `relayRoomTitle`. Fallback `hostNameForId = host?.name ?? "relay-room"` for the id shape (stays greppable in logs) + `hostName = host?.name ?? relayRoomTitle ?? relayRoomId ?? "Relay room"` for the label. Persistent-tab addOpenTab call passes `hostId: null` for host-less tabs (backend already tolerates null for other host-less tab types). `onRelayRoomRowClick` callback wired at the PrettyConversationsPanel invocation site (~L2088-2115) mirroring the shape of onDetachedRowClick: constructs a Tab with `sessionKind: "relay-room"` + `relayRoomId: row.roomId` + `relayRoomTitle: row.roomTitle ?? null` + label sourced from `row.roomTitle ?? row.roomId`. Defensive AppShell-side check on missing roomId (distinct log message from the panel-side check for triaging unambiguity). `selectConversationDeferred + isTouchDevice/isMobile follow-ups` match the pattern of the sibling callbacks byte-for-byte.

- **17 new tests + zero regressions** — 5 RelayRoomSessionPane tests (render + no viewingUserMxid + handle no-ops + mount log + no unwanted primitives + props threading), 6 tabUtils tests (Test 1/1b/2 regression gates on existing branches + Test 3 relay-room dispatch + Test 4 defensive path + Test 6 source-order gate), 6 PrettyConversationsPanel.relay-room tests (Test 1a/1b harness regression + Test 2/2b relay-room dispatch + prop-omitted fallback + Test 3 defensive path + Test 5 integration mixed harness/relay-room). **All 136 tests pass across the 5 touched test files** (6 new + 112 existing PrettyConversationsPanel + 7 IdentitySessionPane + 6 tabUtils + 5 RelayRoomSessionPane). **446/446 tests pass across the full-loop scope** (pretty-conversations/ + shell/ + relay-room-pane/ + viewing-user-store — 27 test files total).

- **Zero pretty-view / backend modification.** `git diff --name-only HEAD~6 HEAD -- src/ui/features/pretty-view/ src/backend/` returns empty. D-01/D-03 upheld; D-04 no-modification-outside-scope respected.

- **Every D-decision (D-01..D-20) is now realized end-to-end.** The phase is deliverable for Alice UAT: a Skynet user with a running relay-room session on the fleet can click the sidebar row → PrettyConversationsPanel handleRowSelect fires new onRelayRoomRowClick(row) → AppShell openTab(null, "terminal", ..., {sessionKind: "relay-room", relayRoomId, relayRoomTitle}) → Tab persists → tabUtils's TerminalOrIdentitySessionPane dispatcher matches sessionKind='relay-room' branch (placed FIRST) → mounts RelayRoomSessionPane wrapper (Task 1) → mounts RelayRoomPane (Plan 06 wired) → presence row at top, message history in middle, compose box at bottom, per-agent context meters + reset on agent badges, sends go through viewing user's own relay identity via Wave 0 seams.

## Task Commits

Each TDD phase committed atomically (RED then GREEN per task):

1. **Task 1 RED (RelayRoomSessionPane wrapper tests)** — `004d781f` (test)
2. **Task 1 GREEN (RelayRoomSessionPane wrapper impl)** — `8b9f6621` (feat)
3. **Task 2 RED (tabUtils third-branch dispatcher tests)** — `15cfdec8` (test)
4. **Task 2 GREEN (tabUtils third-branch dispatcher impl)** — `81cf6e9d` (feat)
5. **Task 3 RED (PrettyConversationsPanel row-click widening tests)** — `f62a642c` (test)
6. **Task 3 GREEN (BLOCKER #3 fix — panel branch + store passthrough + AppShell wiring)** — `9ec36fb6` (feat)

## Files Created/Modified

**Created (4):**

- `src/ui/shell/RelayRoomSessionPane.tsx` — peer of IdentitySessionPane; forwardRef wrapper with IdentityPaneHandle-shaped no-op surface; mounts RelayRoomPane inside `h-full w-full relative flex flex-col`; structured mount log via console.info; NO viewingUserMxid prop (Plan 05 W#8).
- `src/ui/shell/RelayRoomSessionPane.test.tsx` — 5 tests (render + handle shape + mount log + no unwanted primitives + props threading).
- `src/ui/shell/tabUtils.test.tsx` — 6 tests (regression gates on existing branches + relay-room dispatch + defensive path + source-order gate).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx` — 6 tests co-located to isolate the new coverage from the existing 4743-line test file.

**Modified (4):**

- `src/ui/shell/tabUtils.tsx` — import RelayRoomSessionPane; widen `TerminalOrIdentitySessionPane` with third branch placed FIRST (most-specific-discriminator-wins). Defensive fall-through on missing relayRoomId. `useIdentities()` hoisted above the conditional early return for rules-of-hooks compliance (no behavior change on identity-branch path).
- `src/ui/state/conversation-store.ts` — widen `ConversationRow` with optional `kind` + `roomId` + `roomTitle` fields; propagate from FleetSession at `fleetSyntheticRows` build site (three-line spread using undefined-vs-explicit distinction discipline).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — add `onRelayRoomRowClick?: (row: ConversationRowShape) => void` prop; widen `handleRowSelect` at L980-1003 with new priority branch AFTER rdpHostRow + fleetOnly BEFORE default selectConversation. Defensive log-and-fall-through on missing roomId. Discipline mirrors the two existing branches (early return + fire onConversationSelected alongside).
- `src/ui/AppShell.tsx` — widen `openTab` first arg to `Host | null` (with hostNameForId + hostName fallback pattern) + options bag with sessionKind/relayRoomId/relayRoomTitle; wire `onRelayRoomRowClick` callback at the PrettyConversationsPanel invocation site mirroring the shape of onDetachedRowClick. Defensive AppShell-side check on missing roomId (distinct log message for triaging).

## Decisions Made

All 8 key decisions captured in the frontmatter `key-decisions` field. The three most consequential:

1. **RelayRoomSessionPane exposes an IdentityPaneHandle-shaped surface with EVERY method as a no-op** — preserving polymorphism at tab.terminalRef call sites. Alternative (narrower handle type) would have required auditing every consumer for the same UX outcome.

2. **onRelayRoomRowClick placed AFTER rdpHostRow + fleetOnly branches in handleRowSelect** — a relay-room row is never also rdpHostRow or fleetOnly (three mutually-exclusive types), so the ordering is functionally equivalent BUT preserves existing priority slots against future ConversationRow shape edits.

3. **openTab first arg widened to `Host | null` rather than a second overload or discriminated-union spawn helper** — one nullable at the signature is the smallest diff that unlocks the relay-room path; only the AppShell onRelayRoomRowClick callback ever passes null. Minimum-blast-radius option.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Comment-token hygiene for grep gates in RelayRoomSessionPane.tsx**

- **Found during:** Task 1 GREEN acceptance-criteria check
- **Issue:** My initial docstrings in `RelayRoomSessionPane.tsx` referenced `Terminal`, `MessageQueueDrawer`, `IdentityModal`, and `viewingUserMxid` by name to explain what the wrapper does NOT include. The plan's acceptance criteria enforce `grep -c <token> == 0` on all four (comment mentions count).
- **Fix:** Paraphrased each mention per Plan 02/05/06 precedent. Same information conveyed; grep counts drop to 0. E.g., "no Terminal" → "no xterm.js surface"; "MessageQueueDrawer" → "per-pane queue drawer"; "IdentityModal" → "identity edit modal"; "viewingUserMxid" → "the viewer's mxid".
- **Files modified:** `src/ui/shell/RelayRoomSessionPane.tsx` (docstring paraphrase; no code change)
- **Verification:** All grep gates now pass (all four counts = 0).
- **Committed in:** `8b9f6621` (Task 1 GREEN — fixed inline before commit)

**2. [Rule 3 — Blocking] Rules-of-hooks violation in initial tabUtils widening**

- **Found during:** Task 2 GREEN initial edit
- **Issue:** My first draft of the tabUtils widening placed the new `if (tab.sessionKind === "relay-room")` early-return BEFORE the `useIdentities()` hook call. If the relay-room branch fired, the hook would be skipped on subsequent renders — a React rules-of-hooks violation (hooks must run unconditionally in the same order every render).
- **Fix:** Hoisted `useIdentities()` above the conditional early return. Hook runs on every render regardless of which branch fires; the identity-branch logic that consumes the hook output is unchanged. No behavior change on the pre-existing identity-branch path.
- **Files modified:** `src/ui/shell/tabUtils.tsx` (one-line hoist, no logic change)
- **Verification:** All 6 tabUtils tests pass; existing IdentitySessionPane.test.tsx 7/7 pass (regression baseline intact).
- **Committed in:** `81cf6e9d` (Task 2 GREEN — fixed inline before commit)

**3. [Rule 3 — Blocking] npx vitest `--related` flag unavailable in vitest 4**

- **Found during:** Full-loop scoped test run (post-Task 3)
- **Issue:** The plan's verification step recommends `npx vitest run --related <files>`. Vitest 4 removed the `--related` flag (CACError: Unknown option `--related`).
- **Fix:** Substituted with an explicit file-list run: `npx vitest run src/ui/features/pretty-conversations/ src/ui/shell/ src/ui/features/relay-room-pane/ src/ui/state/viewing-user-store.test.ts`. Coverage is functionally equivalent (all the modules the plan touches + their consumers).
- **Files modified:** None (test-runner-invocation change only)
- **Verification:** 446/446 tests pass across 27 test files in the full-loop scope.
- **Committed in:** N/A (no code change)

### Fleet-rule Violation Log

None. No `git stash` this plan (prior Plan 05 documented one violation which was recovered cleanly; Plan 07 sequenced without needing to touch the stash). All work on `feat/tab-title-from-tmux` in the main working tree (no worktrees per fleet rule). No push/build/deploy per fleet rule.

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking — grep-gate hygiene / rules-of-hooks / vitest CLI flag drift).
**Impact on plan:** All fixes essential for the plan's own gates. Zero scope creep. Zero D-01/D-03 violations. Zero code deviations from the plan spec — same primitives + same wire shapes as PLAN.md's `<action>` sections.

## Threat Flags

None. Every new surface this plan introduces is enumerated in the plan's `<threat_model>` — tab dispatcher branch order (T-90-07-T1), defensive fall-through on missing identity axis (T-90-07-R1), sidebar-row-click threading (T-90-07-I1), regression on existing harness rows (T-90-07-D1), wrong-file-path / wrong-dispatch-chain BLOCKER #3 (T-90-07-P1). All 5 STRIDE-registered threats have code-level mitigations enforced by tests + grep gates:

- **T-90-07-T1** (branch order) — Test 6 in tabUtils.test.tsx is a dedicated source-order regression gate.
- **T-90-07-R1** (defensive fall-through) — Test 4 in tabUtils.test.tsx + Test 3 in PrettyConversationsPanel.relay-room.test.tsx are dedicated defensive-path regression gates.
- **T-90-07-I1** (info disclosure) — no new data exposure; new fields (kind + roomId + roomTitle) are already backend-gated per user via /sessions/list access-control.
- **T-90-07-D1** (regression on existing branches) — Test 1/1b/2 in tabUtils.test.tsx + Test 1a/1b + Tests 12/13/14/15 in PrettyConversationsPanel.test.tsx are dedicated regression gates. All pass; existing pretty-view + terminal flows unaffected.
- **T-90-07-P1** (BLOCKER #3 mitigation) — grep gate `openSessionInTree = 0 in the row-click branch` enforces the correct dispatch chain (selectConversation + onConversationSelected, NOT openSessionInTree). Confirmed via grep.

## Known Stubs

None. This plan is the last mile: every seam this touches is fully wired end-to-end. Every D-decision (D-01..D-20) from the phase is now realized somewhere in Plans 00-07. The end-to-end user flow works — Alice can click a `kind: 'relay-room'` sidebar row and land on the RelayRoomPane.

Minor open items (not stubs — deferred by design):
- Persisted relay-room tabs on refresh: currently `hostId: null` is written to the persistent-tabs table for relay-room tabs; whether relay-room tabs should PARTICIPATE in the on-login tab restore is a Plan 89 / follow-up concern (a restored relay-room tab needs the room membership check to still pass on rehydrate). For now, they persist; consumers filtering on `hostId != null OR sessionKind === 'harness'` can exclude them from restore if needed.
- `userId` prop threading for useRelayRoomStream: RelayRoomPane still passes `userId: 0` with a TODO — the viewing-user-store carries mxid but not userId. This was flagged in Plan 06 as a soft stub for structured-logging fields only (backend derives userId from the JWT cookie for the WS auth path). Deferred to a small follow-up. Does NOT affect D-10 correctness, the send round-trip, or Plan 07's row-click threading.

## Issues Encountered

- **Pre-existing frontend TypeScript errors** in `conversation-store.test.ts` and several other files — same TS 6.0.3 discriminated-union regression flagged by every Phase 90 SUMMARY. Out of scope per SCOPE BOUNDARY rule. My 4 modified files + 4 created files emit ZERO tsc errors.
- **Comment-token hygiene must be enforced at every plan** with literal `grep -c == 0` gates. Fourth Phase 90 SUMMARY to document this trap (Plans 02, 05, 06, 07). Standard fix: paraphrase in docstrings.
- **Rules-of-hooks** — the tabUtils widening initially placed the early-return before the `useIdentities()` hook call; hooks MUST run unconditionally. Standard fix: hoist the hook above the conditional early return.
- **vitest 4 dropped `--related` flag** — the plan's verification snippet needs updating for future Phase-90-like slices. Standard replacement: explicit file-list run scoped to the touched directories.

## User Setup Required

None. Pure frontend code + type additions. No external service configuration. No env var changes. No infrastructure touches. No backend changes. Existing users' pre-Phase-90 localStorage caches were already invalidated by Plan 01's `FLEET_CACHE_KEY` v3 → v4 bump — this plan requires no additional cache management.

## Next Phase Readiness

- **Phase 90 slice D deliverable for Alice UAT.** A Skynet user with a running relay-room session on the fleet can click the sidebar row and land on the RelayRoomPane end-to-end:
  1. Sidebar row-click → PrettyConversationsPanel.handleRowSelect fires new onRelayRoomRowClick(row) branch (Task 3 panel-side).
  2. onRelayRoomRowClick(row) → AppShell openTab(null, "terminal", ..., {sessionKind: "relay-room", relayRoomId, relayRoomTitle, label}) (Task 3 AppShell wiring).
  3. Tab persists in state with sessionKind + relayRoomId + relayRoomTitle set (Plan 01 Tab type widening).
  4. tabUtils.TerminalOrIdentitySessionPane dispatcher matches `sessionKind === "relay-room"` branch (placed FIRST — Task 2).
  5. RelayRoomSessionPane wrapper mounts (Task 1) with roomId + roomTitle threaded from Tab.
  6. RelayRoomSessionPane mounts RelayRoomPane (fully wired end-to-end via Plans 05 + 06).
  7. RelayRoomPane renders presence row at top (IdentityBadgeRow with per-agent AgentBadgeWithAppendage) + message history in middle (RelayMessageList with LoadMoreOlderButton) + compose box at bottom (ComposeBoxShell) — every D-decision honored.

- **Deploy is orchestrator-owned per fleet rule.** Executor's remit stops at code + commit + scoped tests green. Deploy is deferred to arc-close after slices C + E land + `/close relay-mediated-group-conversations` passes against the master shape.

- **Follow-ups (post-phase, non-blocking):**
  - Small quick to thread real userId into useRelayRoomStream (Plan 06 known stub — structured-log fields only, no correctness impact).
  - Small quick to decide whether relay-room tabs should participate in on-login tab restore (currently persist with hostId=null; consumers can filter).
  - Full-suite `npx vitest run` at deploy-gate per fleet rule (executor's remit stops at scoped-tests-green).

## Self-Check: PASSED

Verified all claims before proceeding to state updates:

- `src/ui/shell/RelayRoomSessionPane.tsx` exists ✓
- `src/ui/shell/RelayRoomSessionPane.test.tsx` exists ✓
- `src/ui/shell/tabUtils.test.tsx` exists ✓
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx` exists ✓
- Commit `004d781f` exists (Task 1 RED) ✓
- Commit `8b9f6621` exists (Task 1 GREEN) ✓
- Commit `15cfdec8` exists (Task 2 RED) ✓
- Commit `81cf6e9d` exists (Task 2 GREEN) ✓
- Commit `f62a642c` exists (Task 3 RED) ✓
- Commit `9ec36fb6` exists (Task 3 GREEN) ✓
- All Task 1 grep gates pass: `import.*RelayRoomPane=1`, `useImperativeHandle=3` (>=1), `togglePrettyMode: () => {}=1`, `relay_room_session_pane_mount=1`, `JSON.stringify(=0`, `Terminal=0`, `MessageQueueDrawer=0`, `IdentityModal=0`, `viewingUserMxid=0` ✓
- All Task 2 grep gates pass: `sessionKind === "relay-room"=1`, `RelayRoomSessionPane=2` (>=2 — import + JSX use), `relay-room tab missing relayRoomId=1`, source-order relay-line=190 BEFORE ident-line=222, `IdentitySessionPane` count unchanged, `TerminalTabContent` count unchanged ✓
- All Task 3 grep gates pass: `row.kind === "relay-room"=1`, `onRelayRoomRowClick=4` (>=2), `relay-room row missing roomId=1`, `openSessionInTree=0` in row-click branch (BLOCKER #3 fix), `sessionKind: "relay-room"=1` in AppShell, `onRelayRoomRowClick==1` in AppShell, `relayRoomId:=1` in AppShell ✓
- Existing rdpHostRow + fleetOnly branches at L1004/L1009 in PrettyConversationsPanel.tsx UNCHANGED (grep-verified) ✓
- `npx tsc --noEmit` → zero errors on Plan 07 touched files ✓
- `git diff --name-only HEAD~6 HEAD -- src/ui/features/pretty-view/ src/backend/` returns empty (D-01 + D-03 upheld) ✓
- `npx vitest run` (5 touched test files) → 136/136 passing ✓
- `npx vitest run src/ui/state/conversation-store.test.ts src/ui/state/conversation-store.cache.test.ts src/ui/AppShell.persistence.test.tsx` → 124/124 passing (regression baseline intact) ✓
- Full-loop scoped run `npx vitest run src/ui/features/pretty-conversations/ src/ui/shell/ src/ui/features/relay-room-pane/ src/ui/state/viewing-user-store.test.ts` → 446/446 passing across 27 test files ✓

## TDD Gate Compliance

All 3 tasks followed the RED/GREEN cycle with atomic commits:

- **Task 1:** Test commit `004d781f` (RED — vitest transform error "Failed to resolve import ./RelayRoomSessionPane") → Impl commit `8b9f6621` (GREEN — 5/5 pass).
- **Task 2:** Test commit `15cfdec8` (RED — 3 failing assertions on Tests 3/4/6 for the yet-to-be-added third branch) → Impl commit `81cf6e9d` (GREEN — 6/6 pass; existing IdentitySessionPane.test.tsx 7/7 pass).
- **Task 3:** Test commit `f62a642c` (RED — 3 failing assertions on Tests 2/3/5 for the yet-to-be-added onRelayRoomRowClick branch) → Impl commit `9ec36fb6` (GREEN — 6/6 pass; existing PrettyConversationsPanel.test.tsx 112/112 pass).

Zero REFACTOR commits needed — all three tasks landed clean.

---
*Phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session*
*Plan: 07*
*Completed: 2026-09-08*
