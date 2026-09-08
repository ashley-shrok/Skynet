---
phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session
plan: 06
subsystem: frontend
tags:
  [
    frontend,
    relay-pane,
    ws-hook,
    per-agent-badge,
    compose,
    optimistic-send,
    live-subscription,
    D-08,
    D-10,
    D-15,
    D-16,
    W-7-mqid-prefix,
    T-90-FE-01,
    Pitfall-2,
    Pitfall-4,
    wave-4,
    wave-0-consumer,
    tdd,
    slice-d,
  ]

# Dependency graph
requires:
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-00
    provides: Wave 0 useSessionContextPct hook + POST /agent-reset endpoint — CONSUMED by AgentBadgeWithAppendage for D-10 correctness (same read source + same write seam PrettyView uses)
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-02
    provides: ComposeBoxShell + OutboundBubble primitives — CONSUMED by RelayRoomPane compose region (D-04 upperArea + D-05 attachButton both undefined) and by RelayMessageList's outbound branch
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-04
    provides: WS server wire contracts (session / history_batch / live_event / send_ack / send_error / participants / error / inactive) + participants REST endpoint — CONSUMED by useRelayRoomStream frame dispatch
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-05
    provides: RelayRoomPane skeleton (participants fetch + error state + viewing-user hook) + IdentityBadgeRow (D-07 humans-first-alphabetical, D-09 humans-no-appendage, agent placeholder cell) + relay-room-api type contracts — CONSUMED as the skeleton this plan fills
  - phase: 34-fleet-status-cutover
    provides: session-working-store `${hostId}:${tmuxSessionName}` key convention — MIRRORED by AgentBadgeWithAppendage for D-10 correctness (Test 2 regression gate)
provides:
  - useRelayRoomStream hook — WS lifecycle + all 8 server-frame dispatch + pending-send FIFO with mqid==txnId correlation (Pitfall 4 / T-90-FE-01)
  - AgentBadgeWithAppendage — IdentityBadge + shrunk meter + reset appendage, sourced/dispatched via Wave 0 seams (D-10 by construction)
  - RelayRoomPane fully wired end-to-end (WS + ComposeBoxShell + AgentBadgeWithAppendage via IdentityBadgeRow swap)
  - IdentityBadgeRow now renders live per-agent affordances (Plan 05 AgentBadgeCellPlaceholder retired)
  - W#7 committed mqid prefix `relay-optim-` — distinct from PrettyView's send-path prefix, enforced by Test 3 (positive) + Test 4 (negative) regression gates in RelayRoomPane.test.tsx
affects:
  [
    Phase-90-Plan-07 (kind-discriminator wiring — mounts RelayRoomPane fully-live via the RelayRoomSessionPane wrapper for tab.sessionKind === "relay-room"),
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WS-lifecycle hook with pure-function reactive-state discipline: openRelayRoomSocket() → useEffect-owned WebSocket + retryKey re-trigger + reconnect scheduler (linear-with-cap, full-jitter per R-54-07, MAX_RECONNECT_ATTEMPTS=5). Mirrors PrettyView.tsx L1750-1830 patch #148 discipline without importing from it."
    - "Pending-send FIFO with mqid==txnId echo-back correlation: hook seeds pendingSends on sendMessage; live_event with sender===viewingUserMxid AND unsigned.transaction_id===mqid removes the pending + appends the real event. Timer-clear + list-remove happen inside a single setPendingSends callback so state stays consistent (no orphan timers)."
    - "D-10 correctness invariant by construction: the badge appendage subscribes to Wave 0 hooks (useSessionContextPct + useSessionIsWorking + useSessionIsRecycling with the EXACT ${hostId}:${tmuxSessionName} key format) AND dispatches through the Wave 0 /agent-reset endpoint. Zero-drift guarantee — same source + same seam PrettyView uses. Tests 2/3/8 in AgentBadgeWithAppendage.test.tsx are dedicated regression gates."
    - "AgentBadgeCell fleet-derived host resolution via useSyncExternalStore over conversation-store fleet-sessions snapshot, with a module-cached fleetRef guard to prevent React infinite update loops (returning a fresh Record every getSnapshot call would trip the useSyncExternalStore Object.is comparison)."
    - "Committed W#7 mqid prefix `relay-optim-` — distinct from PrettyView's send-path prefix. Cross-pane debugging visibility preserved via Matrix `unsigned.transaction_id` echo-back + structured logs. Grep gates enforce both positive presence (=3) and pretty-view-prefix absence (=0)."
    - "Comment-token hygiene per Plan 02 / Plan 05 precedent: docstrings paraphrase (a) 'pv-optim-' → 'PrettyView\\'s own send-path prefix', (b) 'AgentBadgeCellPlaceholder' → 'placeholder cell'. Preserves the literal `grep -c <token> == 0` acceptance-criterion contract without loss of readability."
    - "Test mock discipline for stores with many transitive consumers: importOriginal + partial override (only the specific hook the test cares about) instead of a full-shape override. Prevents `No 'X' export is defined on the '...' mock` failures when unrelated exports are pulled in by test-time imports."
    - "TDD RED/GREEN cadence: 3 tasks × 2 commits each (RED before GREEN). RED signal for a new module is a vitest import-resolution failure at transform time; RED signal for an existing-module extension is a set of failing test assertions on the yet-to-be-added behavior."

key-files:
  created:
    - src/ui/features/relay-room-pane/use-relay-room-stream.ts
    - src/ui/features/relay-room-pane/use-relay-room-stream.test.ts
    - src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx
    - src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx
  modified:
    - src/ui/features/relay-room-pane/RelayRoomPane.tsx (fills the compose slot with ComposeBoxShell + wires useRelayRoomStream + unifies error state with hook error)
    - src/ui/features/relay-room-pane/RelayRoomPane.test.tsx (Plan06-T1..T6 + updated Test 4 + Test 7 for the compose slot swap)
    - src/ui/features/relay-room-pane/IdentityBadgeRow.tsx (swaps the Plan 05 placeholder cell for the live AgentBadgeWithAppendage; adds useFleetIdentityHosts with cached-snapshot guard)
    - src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx (Test 3 updated to assert on data-appendage='true'; added stores mocks with importOriginal + buildIdentityHostsFromFleet override)

key-decisions:
  - "sendMessage fail-immediately when WS is not open (seed pending as state='failed'). Simpler than PrettyView's queued-send path; the relay pane has no dormant-analog concept per PATTERNS.md so a queued-send buffer would grow unbounded on a long-dormant WS."
  - "send_ack removes the matching pending (belt-and-suspenders with the live_event echo). Documented at the frame dispatch site: if the live_event correlated first, send_ack becomes a no-op via the pendingSendsRef.current.find guard; if send_ack correlates first, live_event's find returns nothing and appends normally."
  - "20s PENDING_SEND_TIMEOUT_MS_NORMAL is the ONLY variant (no dormant-analog). Documented at the constant declaration + hook JSDoc — relay-room panes have no session-dormant concept per PATTERNS.md § Don't Hand-Roll."
  - "Reset dispatch INTERNAL to AgentBadgeWithAppendage (no parent-supplied callback prop). Simpler than the prior revision that deferred the endpoint. The Wave 0 /agent-reset endpoint is available AND callable directly from the badge appendage; threading a callback would add drift risk (parent could pass a different endpoint URL for testing / debugging and silently violate D-10)."
  - "Meter well + reset visuals COPIED verbatim from ComposeBox.tsx L2287-2434 with `--meter-width` shrunk from 12rem to 6rem. Do NOT import from ComposeBox — the D-03 no-modification invariant on pretty-view is preserved by the copy discipline; shrinking a copy is the only path that keeps both surfaces byte-independent."
  - "Segment segments carry data-band + data-lit attributes for jsdom-stable test assertions (Plan 02 Deviation 2 precedent — jsdom normalizes hsla → rgba in style attributes; stable attributes avoid the normalization pitfall)."
  - "useFleetIdentityHosts caches the built map by fleet-array identity (module-scoped `let fleetIdentityHostsCache`). REQUIRED to prevent useSyncExternalStore infinite update loops when the snapshot function is called repeatedly by React's commit phase."
  - "Test discipline: importOriginal on identities-store / session-working-store / fleet-status-client mocks so unrelated exports (subscribeSessionWorkingStore, publishFleetStatusSessionState, etc.) stay accessible for transitive consumers. Two test files needed this update to prevent 'No X export is defined on the mock' errors."

patterns-established:
  - "WS-hook + pending-send FIFO template — reusable for any future WS surface that needs an echo-correlation-based optimistic-send lifecycle. Mirror this hook's structure: (a) WS opens on visibility, (b) frames dispatched via switch on parsed.type, (c) sendMessage inserts pending + arms timer, (d) live_event with correlated txnId removes pending + appends real, (e) unmount clears every pending timer."
  - "D-10 correctness invariant by construction: when two surfaces need to read from the same underlying per-agent state, BOTH must subscribe to the SAME hook (not two hooks over the same source) AND dispatch through the SAME endpoint (not two endpoints that route to the same handler). Test guards on the exact call arguments — Tests 2/3/8 in AgentBadgeWithAppendage.test.tsx are the dedicated regression gates."
  - "Committed prefix pattern for correlation ids that flow through independent channels (frontend mqid → Matrix txnId → live_event unsigned.transaction_id → structured logs): the prefix (a) makes cross-channel greppability trivial and (b) prevents cross-pane debugging confusion when two panes' pending-send state machines run in parallel. `relay-optim-` distinct from PrettyView's send-path prefix per W#7."
  - "useSyncExternalStore snapshot memoization by upstream-reference identity: cache the derived value keyed on the upstream store reference. When the reference is stable (no-op update), return the cached value; only rebuild on reference change. Prevents React infinite update loops with fresh-Object returns."

requirements-completed:
  [
    D-04,
    D-05,
    D-06,
    D-08,
    D-10,
    D-15,
    D-16,
    T-90-FE-01,
    Pitfall-2,
    Pitfall-4,
    W-7-mqid-prefix,
  ]

# Metrics
duration: 16 min
completed: 2026-09-08
---

# Phase 90 Plan 06: useRelayRoomStream WS hook + AgentBadgeWithAppendage (Wave 0 consumer) + compose + optimistic-send with mqid==txnId correlation

**Relay pane is now fully-wired end-to-end: useRelayRoomStream owns the WS lifecycle + all 8 server-frame dispatch + D-16 pending-send FIFO with Pitfall-4 correlation (T-90-FE-01 gate at Test 5); AgentBadgeWithAppendage consumes Wave 0's useSessionContextPct + POST /agent-reset for D-10 correctness by construction (Pitfall 2 mitigated by three dedicated regression tests — 2/3/8); RelayRoomPane fills the compose slot with ComposeBoxShell (D-04 no upper area + D-05 no attach) and generates W#7-committed `relay-optim-` mqids; IdentityBadgeRow swaps the Plan 05 placeholder for the live AgentBadgeWithAppendage. Every D-decision from the phase (D-01..D-20) is now realized. Zero pretty-view modification. Zero follow-up-endpoint deferrals.**

## Performance

- **Duration:** ~16 minutes (start 2026-09-08T21:51:14Z; final commit 2026-09-08T22:07:32Z)
- **Started:** 2026-09-08T21:51:14Z (plan-loaded)
- **Completed:** 2026-09-08T22:07:32Z (Task 3 GREEN commit)
- **Tasks:** 3 of 3 executed
- **Files created:** 4 (2 impl + 2 test)
- **Files modified:** 4 (RelayRoomPane.tsx + test; IdentityBadgeRow.tsx + test)

## Accomplishments

- **useRelayRoomStream hook lands** at `src/ui/features/relay-room-pane/use-relay-room-stream.ts`. Signature: `useRelayRoomStream({userId, roomId, viewingUserMxid, isVisible}) → {history, participants, error, pendingSends, hasOlder, loadOlderStatus, loadOlderError, sendMessage, fetchOlder}`. Owns the full WS lifecycle:
  - Opens via `openRelayRoomSocket()` on mount when `isVisible === true`; sends `connectToRoom { roomId }` on onopen.
  - Dispatches all 8 server frames (session / history_batch / live_event / send_ack / send_error / participants / error / inactive) via `switch (parsed.type)`.
  - Pending-send FIFO mirrors PrettyView shape verbatim per D-16: `sendMessage(body, mqid)` inserts pending + arms 20s timer (`PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000`); `live_event` with `sender === viewingUserMxid` AND `event.unsigned.transaction_id === pending.mqid` removes pending + appends real event (Pitfall 4 correlation / T-90-FE-01 regression gate at Test 5); 20s timer fires `flipToFailed(mqid, 'timeout')`; `send_error` flips to failed; `send_ack` removes pending as belt-and-suspenders.
  - Reconnect scheduler: linear-with-cap backoff (2s/4s/6s/8s/8s), MAX_RECONNECT_ATTEMPTS=5, full-jitter per R-54-07.
  - `isVisible` flip false → close + clear timers; flip back true → fresh WS opens.
  - Cleanup on unmount clears every pending timer + closes the WS.
  - Structured logging at every boundary via `console.info` with explicit fields (never JSON-serialized frame payloads or React SyntheticEvents).

- **AgentBadgeWithAppendage component lands** at `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx`. Renders the plain IdentityBadge (D-08 reuse) + a shrunk meter appendage + a reset button. D-10 correctness by construction — three dedicated regression gates:
  - **READ SIDE — Test 2 (working-state key):** `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)` — EXACT template literal shape PrettyView reads at PrettyView.tsx L1363. Inlined at each call site (not extracted to a local) so the grep gate on the exact template literal trips on any accidental reshaping.
  - **READ SIDE — Test 3 (contextPct source):** `useSessionContextPct(hostId, tmuxSessionName)` — the SAME Wave 0 hook PrettyView reads post D-03 mechanical swap. Positional-args match asserted via `vi.spyOn`.
  - **WRITE SIDE — Test 8 (reset endpoint URL):** click fires `authApi.post('/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}', {body: ''})` — the SAME Wave 0 endpoint PrettyView's reset button hits post Wave 0 rewire. Path-encoding tested with a spaces-in-tmux-session extra test (Test 8b).
  - Reset in-flight guard (Test 9) prevents double-fire; error handling (Test 10) logs structurally + never auto-retries.
  - Meter well + reset visuals COPIED verbatim from `ComposeBox.tsx` L2287-2434 with `--meter-width` shrunk from `12rem` to `6rem`. `SEG_COUNT=12` preserved for visual parity. Band thresholds green<45 / amber 45-77 / red≥78 preserved verbatim.
  - Segment `data-band` + `data-lit` attributes added for jsdom-stable test assertions (Plan 02 Deviation 2 precedent).

- **RelayRoomPane fully wired end-to-end** at `src/ui/features/relay-room-pane/RelayRoomPane.tsx`:
  - Instantiates `useRelayRoomStream` with viewingUserMxid from the W#8 hook.
  - Fills the Plan 05 `data-slot="compose-box"` placeholder with a real `ComposeBoxShell` invocation: `upperArea={undefined}` (D-04) + `attachButton={undefined}` (D-05) + controlled `value`/`onChange` + `onSend={handleSend}`.
  - `handleSend(body)` generates an mqid via `generateRelayMqid()` returning `` `relay-optim-${crypto.randomUUID()}` `` (W#7 committed prefix), calls `stream.sendMessage(body, mqid)`, clears the textarea, logs `console.info({operation: 'relay_room_send', mqid, roomId})` (never the body).
  - `stream.participants` (WS frame) takes precedence over the REST fetch fallback; falls back to REST for the transient window before the WS `participants` frame lands. Both flow through a single `displayParticipants` render.
  - Unified error state: REST 403/404/other + `stream.error === 'room-not-found'` both flip the pane to the D-18 `RelayRoomErrorState`. 401 → session-expired variant with different title copy.
  - `onLoadOlder` closure reads `stream.history[0]?.event_id ?? ""` as the cursor and calls `stream.fetchOlder(oldest)`.
  - `canSend={stream.error !== 'room-not-found'}` — protocol-level errors keep sends allowed (retry-able); room-not-found errors already render the error state instead.

- **IdentityBadgeRow swaps the Plan 05 placeholder for the live AgentBadgeWithAppendage** at `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx`:
  - New `useFleetIdentityHosts()` hook subscribes to the conversation-store fleet-sessions snapshot via `useSyncExternalStore` and returns the identityKey → hostId mapping built by `buildIdentityHostsFromFleet`. Cached module-scoped by fleet-array identity to prevent infinite React update loops.
  - New `AgentBadgeCell` component resolves `hostId` from the fleet map + `tmuxSessionName` from the agent's own identityKey (Skynet one-identity-one-tmux-session convention per `sessionMatchKey`), then mounts `<AgentBadgeWithAppendage>` with the resolved values.
  - Defensive edge case: agent identityKey not in fleet map → structured warn `{operation: 'agent_badge_no_host_mapping', identityKey}` + degraded render (plain badge, no appendage).
  - Reset dispatch is INTERNAL to AgentBadgeWithAppendage — no parent callback threading needed at this seam.

- **84/84 tests pass** across 8 test files in the relay-room-pane + viewing-user-store scope (15 use-relay-room-stream + 14 AgentBadgeWithAppendage + 17 RelayRoomPane + 7 IdentityBadgeRow + prior-plan tests all still green). `npx tsc --noEmit` clean on every touched file.

- **Zero pretty-view/ modification.** `git diff --name-only HEAD -- src/ui/features/pretty-view/` returns empty across all 6 commits (3 RED + 3 GREEN).

## Task Commits

Each TDD phase committed atomically (RED then GREEN per task):

1. **Task 1 RED (useRelayRoomStream tests)** — `ebb0c5eb` (test)
2. **Task 1 GREEN (useRelayRoomStream impl)** — `f041f543` (feat)
3. **Task 2 RED (AgentBadgeWithAppendage tests)** — `3d84c571` (test)
4. **Task 2 GREEN (AgentBadgeWithAppendage impl)** — `339eb8ac` (feat)
5. **Task 3 RED (RelayRoomPane wire-up + IdentityBadgeRow swap tests)** — `d3ddbbd8` (test)
6. **Task 3 GREEN (RelayRoomPane wire-up + IdentityBadgeRow swap impl)** — `4734ec07` (feat)

## Files Created/Modified

**Created (4):**

- `src/ui/features/relay-room-pane/use-relay-room-stream.ts` — WS lifecycle + all 8 server-frame dispatch + pending-send FIFO with mqid==txnId correlation. Reconnect with linear-with-cap backoff. Structured logging at every boundary.
- `src/ui/features/relay-room-pane/use-relay-room-stream.test.ts` — 15 tests covering all 15 planned behaviors, most importantly Test 5 (T-90-FE-01 Pitfall 4 correlation regression gate).
- `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` — IdentityBadge + shrunk meter (Wave 0 useSessionContextPct) + reset button (Wave 0 /agent-reset endpoint). D-10 correctness by construction.
- `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx` — 14 tests (13 planned + 1 extra 8b for spaces-in-tmux-session URL encoding), with Tests 2/3/8 as dedicated D-10 regression gates.

**Modified (4):**

- `src/ui/features/relay-room-pane/RelayRoomPane.tsx` — replaces the Plan 05 compose slot placeholder with a live `ComposeBoxShell` invocation; wires `useRelayRoomStream` for history / pendingSends / hasOlder / etc.; unifies error state with hook error; generates W#7 `relay-optim-` mqids via `generateRelayMqid()`.
- `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx` — 6 new Plan06 tests (T1..T6); Tests 4 + 7 updated to check for real ComposeBoxShell (textarea + Send) instead of the removed data-slot placeholder; importOriginal + partial mocks for the new transitive stores.
- `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` — swaps the Plan 05 placeholder cell for the live `AgentBadgeWithAppendage`; adds `useFleetIdentityHosts` hook with module-cached fleetRef guard; defensive edge case for missing fleet mapping.
- `src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx` — Test 3 updated to assert on `data-appendage='true'` (the AgentBadgeWithAppendage discriminator) instead of the removed data-slot placeholder; added importOriginal + partial mocks for the new transitive stores.

## Decisions Made

All 8 key decisions captured in the frontmatter `key-decisions` field. The three most consequential:

1. **sendMessage fail-immediately when WS is not open** (seed pending as `state='failed'`). Simpler than PrettyView's queued-send path; the relay pane has no dormant-analog concept per PATTERNS.md § Don't Hand-Roll ("relay-room 'dormant' is not a meaningful concept"), so a queued-send buffer would grow unbounded on a long-dormant WS with no bounded resumption event.

2. **Reset dispatch INTERNAL to AgentBadgeWithAppendage** (no parent-supplied callback prop). Simpler than the prior revision that deferred the endpoint. The Wave 0 /agent-reset endpoint is available AND callable directly from the badge appendage; threading a callback would add drift risk (parent could pass a different endpoint URL for testing/debugging and silently violate D-10). Test 8 asserts on the exact URL shape — any drift trips the gate.

3. **useFleetIdentityHosts caches the built map by fleet-array identity** via a module-scoped `let fleetIdentityHostsCache`. REQUIRED to prevent `useSyncExternalStore` infinite update loops. React's useSyncExternalStore compares snapshots with `Object.is`; returning a fresh Record on every getSnapshot call trips the comparison every render and enters an infinite loop. Caching keyed on the upstream fleet-array reference (which `updateFleetSessions` bumps on real mutation but keeps stable across no-ops per conversation-store's snapshotVersion discipline) returns the SAME Record identity when the fleet has not changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] jsdom hsla → rgba style normalization**

- **Found during:** Task 2 GREEN — Tests 5 (amber band), 6 (red band), 11 (recycling-all-neutral) failed
- **Issue:** My tests initially asserted on `style.background` containing `hsla(38,` / `hsla(0,` / `hsla(0,0%,100%,0.06)`. jsdom normalizes `hsla(...)` to `rgba(...)` when reading the style attribute (same class of bug documented in Plan 90-02 SUMMARY as Deviation 2). The literal-hsla assertions never matched.
- **Fix:** Added `data-band` (values: `"green" | "amber" | "red" | "neutral"`) and `data-lit` (values: `"true" | "false"`) attributes to every segment. Updated Tests 5/6/11 to assert on `getAttribute('data-band')` / `getAttribute('data-lit')` — plain strings, jsdom-stable.
- **Files modified:** `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` (+ 2 lines), `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx` (test assertion changes)
- **Verification:** All 14 tests pass.
- **Committed in:** `339eb8ac` (Task 2 GREEN)

**2. [Rule 3 — Blocking] Comment-token hygiene for grep gates (2 sites)**

- **Found during:** Task 2 + Task 3 GREEN acceptance-criteria checks
- **Issue:** Docstrings initially referenced (a) `onResetClicked` in AgentBadgeWithAppendage's "no parent-supplied reset-click callback" JSDoc, (b) `pv-optim-` in RelayRoomPane's generateRelayMqid JSDoc, and (c) `AgentBadgeCellPlaceholder` (twice) in IdentityBadgeRow's docstrings. The plan's acceptance criteria enforce `grep -c <token> == 0` on all three — literal comment mentions count.
- **Fix:** Paraphrased each mention per Plan 02 / Plan 05 precedent. Same information conveyed; grep counts drop to 0.
- **Files modified:** `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx`, `src/ui/features/relay-room-pane/RelayRoomPane.tsx`, `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx`
- **Verification:** All grep gates pass.
- **Committed in:** `339eb8ac` (Task 2), `4734ec07` (Task 3)

**3. [Rule 3 — Blocking] Grep-gate template-literal match discipline for D-10 correctness**

- **Found during:** Task 2 GREEN acceptance-criteria check
- **Issue:** Initial impl extracted `const sessionKey = \`${hostId}:${tmuxSessionName}\`;` then passed `sessionKey` to both `useSessionIsWorking` and `useSessionIsRecycling`. This is functionally identical to the plan's spec, but the acceptance-criteria grep specifically checks for the literal template literal at the call site: `grep -c 'useSessionIsWorking(\`\${hostId}:\${tmuxSessionName}\`)'` — returned 0 (call site was `useSessionIsWorking(sessionKey)`, not the template literal).
- **Fix:** Inlined the template literal at each call site. Documented at the code comment why (grep gate on the exact template literal shape trips on any accidental reshaping — cheaper regression trip-wire than a local variable).
- **Files modified:** `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx`
- **Verification:** Grep gate passes (=1).
- **Committed in:** `339eb8ac` (Task 2 GREEN)

**4. [Rule 3 — Blocking] React infinite update loop in useFleetIdentityHosts**

- **Found during:** Task 3 GREEN initial test run — `Error: Maximum update depth exceeded`
- **Issue:** My initial `useFleetIdentityHosts` implementation returned `buildIdentityHostsFromFleet(getFleetSessionsSnapshot())` from the getSnapshot function directly. `useSyncExternalStore` compares snapshots with `Object.is`; returning a fresh Record every getSnapshot call trips the comparison every render → infinite update loop.
- **Fix:** Added a module-scoped `fleetIdentityHostsCache: {fleetRef, map} | null` guard. When `fleetRef` matches the current fleet-sessions snapshot reference (stable across no-ops per conversation-store's snapshotVersion discipline), return the cached map; otherwise rebuild + cache.
- **Files modified:** `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` (+ 20 lines documenting the discipline)
- **Verification:** All 7 IdentityBadgeRow tests pass; no infinite-loop error.
- **Committed in:** `4734ec07` (Task 3 GREEN)

**5. [Rule 3 — Blocking] Test-time mock exports missing for transitive consumers**

- **Found during:** Task 3 GREEN initial test run for both IdentityBadgeRow.test.tsx and RelayRoomPane.test.tsx — `Error: [vitest] No "subscribeSessionWorkingStore" export is defined on the "@/state/session-working-store" mock. Did you forget to return it from "vi.mock"?` (and similar for `buildIdentityHostsFromFleet`)
- **Issue:** My initial mocks used the plain override pattern `vi.mock('X', () => ({...})` which fully replaces the module. Transitive test-time imports of unrelated exports (subscribeSessionWorkingStore, publishFleetStatusSessionState, etc.) then failed.
- **Fix:** Migrated all mocks to `vi.mock('X', async (importOriginal) => { const orig = (await importOriginal()) as Record<string, unknown>; return { ...orig, useSpecificHook: vi.fn(...) } })`. Only the specific hook the test cares about is overridden; unrelated exports pass through.
- **Files modified:** `src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx`, `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx`
- **Verification:** All 79 tests pass.
- **Committed in:** `d3ddbbd8` (Task 3 RED had first version; refined in `4734ec07` Task 3 GREEN)

**6. [Rule 3 — Blocking] Plan 05 Tests 4 + 7 obsolete after compose slot swap**

- **Found during:** Task 3 GREEN test run — Tests 4 + 7 failed (queried for `data-slot="compose-box"` which is now removed)
- **Issue:** Plan 05's Tests 4 + 7 asserted on the `data-slot="compose-box"` placeholder cell being present. Plan 06 removed the placeholder in favor of a real `ComposeBoxShell` invocation.
- **Fix:** Updated both tests to check for the real ComposeBoxShell — textarea + `button[aria-label="Send"]`. Documented at each test that "Plan 05's data-slot placeholder is REMOVED in Plan 06".
- **Files modified:** `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx`
- **Verification:** Tests 4 + 7 pass.
- **Committed in:** `4734ec07` (Task 3 GREEN)

---

**Total deviations:** 6 auto-fixed (all Rule 3 blocking — jsdom quirks / grep-gate hygiene / React invariant / test mock discipline / carrying-over-test-obsolescence).
**Impact on plan:** All fixes essential for the plan's own gates. Zero scope creep. Zero D-01/D-03 violations. Zero code deviations from the plan spec — same primitives + same wire shapes + same D-10 correctness invariant as PLAN.md's `<action>` sections.

## Threat Flags

None. Every new surface this plan introduces is enumerated in the plan's `<threat_model>` — useRelayRoomStream pending-send FIFO + optimistic-send correlation, AgentBadgeWithAppendage read/write seams, message body / participants rendering, structured logging on send. All 7 STRIDE-registered threats have code-level mitigations enforced by tests:

- **T-90-FE-01** (optimistic-send correlation) — Test 5 in use-relay-room-stream.test.ts (Pitfall 4 mqid==txnId echo-back match).
- **T-90-06-T1** (XSS) — RelayMessageList inherits Plan 05's React-text-children discipline; `dangerouslySetInnerHTML = 0` across all touched files.
- **T-90-06-I1** (info disclosure — structured send log) — `console.info({operation: 'relay_room_send', mqid, roomId})` NEVER includes the message body or mxid credentials. Only mqid + roomId. Grep gate `JSON.stringify(event = 0` verified in both use-relay-room-stream.ts and RelayRoomPane.tsx.
- **T-90-06-D1** (pending-send timer DoS) — every pending's timer is clearTimeout'd on live_event / send_ack / send_error match + on unmount. Test 15 in use-relay-room-stream.test.ts asserts unmount cleanup.
- **T-90-06-D2** (D-10 read-side drift) — Tests 2 + 3 in AgentBadgeWithAppendage.test.tsx are dedicated regression gates.
- **T-90-06-D3** (D-10 write-side drift) — Test 8 in AgentBadgeWithAppendage.test.tsx is the regression gate.
- **T-90-06-C1** (mqid prefix debugging confusion) — Tests Plan06-T3 (positive) + T4 (negative) in RelayRoomPane.test.tsx enforce the `relay-optim-` prefix + absence of pretty-view's send-path prefix.

## Known Stubs

None affecting Plan 06's goal. The relay pane is fully wired end-to-end. Plan 07 handles ONLY the last mile: the kind-discriminator branch at the tab-mount site + the RelayRoomSessionPane wrapper — documented as Plan 07 responsibility in the plan spec + this file's docstrings. No hardcoded empty values that flow to UI, no TODO/FIXME placeholders that gate the phase's goal.

Minor open item: the `userId` prop passed to `useRelayRoomStream` from RelayRoomPane is currently `0` with a TODO comment — the viewing-user-store carries mxid but not userId. This is a soft stub for structured-logging fields ONLY (not for the functional behavior of the WS — the backend derives userId from the JWT cookie). Threading the real userId requires widening viewing-user-store to fetch + cache it alongside mxid; deferred as a small follow-up. Does NOT affect D-10 correctness or the send round-trip.

## Issues Encountered

- **Pre-existing frontend TypeScript errors** in files under `src/ui/state/conversation-store.test.ts` and several other files — same TS 6.0.3 discriminated-union regression flagged by every Phase 90 SUMMARY. Out of scope per SCOPE BOUNDARY rule. My 4 new files + 4 modified files emit ZERO tsc errors.
- **jsdom normalizes hsla → rgba** in the style attribute — third time this trap has bit a Phase 90 test file (Plan 02 Deviation 2 first documented it, Plan 05 avoided it, Plan 06 re-hit it in AgentBadgeWithAppendage tests). Standard fix: assert on stable data attributes instead of parsed style values.
- **useSyncExternalStore infinite update loop** — first encounter of this trap in Phase 90. The `getSnapshot` function MUST return referentially-stable objects across no-op calls or React enters an infinite render cycle. Standard fix: module-cache the derived value keyed on the upstream store's snapshot identity.
- **vi.mock full-shape override breaks transitive consumers** — third file needed the importOriginal pattern this plan. Rule of thumb established: when mocking a store module (as opposed to a pure-function module), always use `async (importOriginal) => { const orig = await importOriginal(); return { ...orig, override }; }`.

## User Setup Required

None. Pure frontend code + test additions. No external service configuration. No env var changes. No infrastructure touches. No backend changes. Wave 0 already landed the backend seams (useSessionContextPct source + /agent-reset endpoint); this plan is a pure consumer of those seams from the frontend.

## Next Phase Readiness

- **Plan 90-07 (kind-discriminator wiring) unblocked.** Can now mount `RelayRoomPane` at the `tab.sessionKind === "relay-room"` branch of the tab dispatcher; the pane is fully live end-to-end. Only the last-mile work remains: (a) add `sessionKind + relayRoomId + relayRoomTitle` fields to `Tab` type; (b) branch in `tabUtils.tsx`'s `TerminalOrIdentitySessionPane` to select `RelayRoomSessionPane` (Plan 07 wrapper) vs the existing `IdentitySessionPane`; (c) thread `tab.sessionKind` from the sidebar row-click path through to the tab-creation site.
- **D-10 correctness fully realized** with no follow-up-endpoint deferrals:
  - READ side (contextPct meter) via Wave 0 `useSessionContextPct` hook — SAME source PrettyView reads post D-03 mechanical swap.
  - WRITE side (reset button) via Wave 0 `/agent-reset` endpoint — SAME seam PrettyView dispatches through post Wave 0 rewire.
  - Three dedicated regression tests (Tests 2/3/8 in AgentBadgeWithAppendage.test.tsx) trip if either side drifts.
- **W#7 mqid prefix committed** (`relay-optim-`). Cross-pane debugging preserved via distinct prefix; test regression gates enforce presence (Plan06-T3) + pretty-view-prefix absence (Plan06-T4).
- **T-90-FE-01 mitigated** with dedicated regression gate (Test 5 in use-relay-room-stream.test.ts). Matrix `unsigned.transaction_id` echo-back correlation working end-to-end.
- **All D-decisions from the phase (D-01..D-20) are now realized** somewhere in Plans 00-06. Plan 07 handles ONLY tab-mount wiring — no new D-decisions.

## Self-Check: PASSED

Verified all claims before proceeding to state updates:

- `src/ui/features/relay-room-pane/use-relay-room-stream.ts` exists ✓
- `src/ui/features/relay-room-pane/use-relay-room-stream.test.ts` exists ✓
- `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` exists ✓
- `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx` exists ✓
- Commit `ebb0c5eb` exists (Task 1 RED) ✓
- Commit `f041f543` exists (Task 1 GREEN) ✓
- Commit `3d84c571` exists (Task 2 RED) ✓
- Commit `339eb8ac` exists (Task 2 GREEN) ✓
- Commit `d3ddbbd8` exists (Task 3 RED) ✓
- Commit `4734ec07` exists (Task 3 GREEN) ✓
- All Task 1 grep gates pass: `PENDING_SEND_TIMEOUT_MS_NORMAL=20_000` = 1, `MAX_RECONNECT_ATTEMPTS=5` = 2, `openRelayRoomSocket` = 3, `unsigned.transaction_id` = 3, `send_message` = 2, `connectToRoom` = 1, `fetch_older_range` = 1, `participants` = 1, `JSON.stringify(event` = 0 ✓
- All Task 2 grep gates pass: `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)` = 1, `useSessionIsRecycling` = 3, `useSessionContextPct(` = 2, `import.*IdentityBadge` = 1, `role="meter"` = 1, `data-appendage="true"` = 1, `RotateCcw` = 2, `/agent-reset/` = 2, `authApi.post` = 2, `encodeURIComponent(tmuxSessionName)` = 1, `onResetClicked` = 0, `contextPct: number` = 0, `JSON.stringify(` = 0 ✓
- All Task 3 grep gates pass: `useRelayRoomStream(` = 1, `ComposeBoxShell` = 3, `upperArea={undefined}` = 1, `attachButton={undefined}` = 1, `AgentBadgeWithAppendage` = 6, `AgentBadgeCellPlaceholder` = 0, `stream.sendMessage(` = 2, `relay-optim-` = 3, `pv-optim-` = 0, `relay_room_send` = 1, `buildIdentityHostsFromFleet|identities-store` = 8, `onResetClicked|onAgentReset` = 0 ✓
- `git diff --name-only HEAD -- src/ui/features/pretty-view/` returns empty (D-01 + D-03 upheld) ✓
- `npx tsc --noEmit 2>&1 | grep -E 'relay-room-pane|viewing-user-store'` returns empty (zero tsc errors on touched files) ✓
- `npx vitest run src/ui/features/relay-room-pane/ src/ui/state/viewing-user-store.test.ts` → 84/84 passing across 8 test files ✓

## TDD Gate Compliance

All 3 tasks followed the RED/GREEN cycle with atomic commits:

- **Task 1:** Test commit `ebb0c5eb` (RED — vitest transform error "Failed to resolve import ./use-relay-room-stream") → Impl commit `f041f543` (GREEN — 15/15 pass).
- **Task 2:** Test commit `3d84c571` (RED — vitest transform error "Failed to resolve import ./AgentBadgeWithAppendage") → Impl commit `339eb8ac` (GREEN — 14/14 pass; 3 tests fixed after initial jsdom rgba-normalization + grep-gate hygiene sweeps).
- **Task 3:** Test commit `d3ddbbd8` (RED — 7 test failures for the new Plan06 behaviors) → Impl commit `4734ec07` (GREEN — 79/79 pass across 7 files; Tests 4 + 7 updated for the compose-slot swap; useFleetIdentityHosts infinite-loop guard added; store mocks migrated to importOriginal).

Zero REFACTOR commits needed — all three primitives landed clean.

---
*Phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session*
*Plan: 06*
*Completed: 2026-09-08*
