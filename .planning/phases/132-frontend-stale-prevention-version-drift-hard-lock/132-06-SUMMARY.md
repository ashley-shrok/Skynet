---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 06
subsystem: ui
tags: [websocket, drift-detection, skew-lock, url-stamp, 4409-close, per-message-piggyback, guacamole, client-side]

# Dependency graph
requires:
  - "132-01 — CLIENT_BUILD_ID const from src/ui/lib/client-build-id.ts"
  - "132-02 — lockSkewedSession({reason, clientBuild, serverBuild}) + getSkewLockedSnapshot() from src/ui/state/skew-lock-store.ts"
  - "132-05 — Backend refuses ?build= handshake mismatch with 4409; 4 JSON servers piggyback `build` on outbound envelopes; guacamole emits SKYNET_STALE_CLIENT:<sha> error instruction"
provides:
  - "?build=<CLIENT_BUILD_ID> handshake stamp on all 4 JSON-envelope WS URLs"
  - "event.code === 4409 detection on all 4 WS onclose handlers firing lockSkewedSession({reason: 'ws_handshake_mismatch'}) + reconnect-suppression"
  - "parsed.build !== CLIENT_BUILD_ID per-message drift detection on all 4 WS onmessage handlers firing lockSkewedSession({reason: 'ws_message_tag_mismatch'}) and dropping the frame"
  - "SKYNET_STALE_CLIENT: prefix detection in GuacamoleApp.tsx's onError handler firing lockSkewedSession({reason: 'ws_handshake_mismatch'})"
  - "Reconnect-loop suppression: getSkewLockedSnapshot().locked check in fleet-status-client connect(), use-relay-adapter onclose, Terminal.tsx connectToHost (belt) — no reconnect after any lane trips the lock"
affects:
  - "Wave 1 phase completion — client half of D-01 lane B is now live for all 5 client-side WS surfaces. Idle browser tabs whose HTTP lane is quiet will detect drift the moment any server WS message arrives OR the socket is 4409-closed on reconnect after deploy."

# Tech tracking
tech-stack:
  added: []  # ZERO new packages
  patterns:
    - "Shared drift-detection listener attached via addEventListener on the socket-opening helper (openClaudeSessionSocket, openRelayRoomSocket) — coexists with per-caller .onmessage/.onclose assignments so ~10 downstream callers in claude-session-api and 1 in use-relay-adapter don't need per-site edits"
    - "typeof ws.addEventListener === 'function' test-mock compatibility guard — pre-existing tests stub WebSocket with only .onmessage/.onclose setters; production browser sockets always ship addEventListener"
    - "Inline URL-suffix pattern: `url.includes('?') ? '&build=…' : '?build=…'` — handles both existing-query-params (Electron ?token=…) and no-query paths in a single line without needing URL object"
    - "Structured close logs: extract event.code / event.reason / event.wasClean / isSkew / endpoint as explicit fields — never serialize the raw DOM CloseEvent (Pitfall 5 discipline, role-file directive)"
    - "getSkewLockedSnapshot().locked bail-out in reconnect entry points (connect() function in fleet-status-client, setRetryKey path in use-relay-adapter, connectToHost pre-open in Terminal.tsx) — prevents deploy-window reconnect storms against a still-stale server"
    - "SKYNET_STALE_CLIENT: prefix mirrors SKYNET_SUPERSEDED: takeover pattern for guacamole — GuacamoleApp.tsx's onError branches on the prefix, calls lockSkewedSession, and returns BEFORE setConnectionError so the per-pane overlay does NOT paint (shell-level modal takes over)"

key-files:
  created: []
  modified:
    - "src/ui/api/claude-session-api.ts"
    - "src/ui/api/fleet-status-client.ts"
    - "src/ui/api/fleet-status-client.test.ts"
    - "src/ui/api/guacamole-api.ts"
    - "src/ui/features/pretty-view/sources/relay-room-api.ts"
    - "src/ui/features/pretty-view/sources/use-relay-adapter.ts"
    - "src/ui/features/terminal/Terminal.tsx"
    - "src/ui/features/guacamole/GuacamoleApp.tsx"

key-decisions:
  - "Shared listener via addEventListener (not per-caller .onclose assignment). claude-session-api.ts has ~10 caller sites (probeIdentityTrappedWork, updateRoleFileByName, getRoleFileByName, listBountiesForRoleName, listRoleWakeupsByName, createRoleWakeupByName, updateRoleWakeupByName, deleteRoleWakeupByName, plus PrettyView.tsx's WS consumer) — instrumenting each site individually would be 10 diffs, not 1. addEventListener is additive: both handlers fire per DOM spec, so callers keep their .onclose = ... assignments untouched. Same shape for relay-room-api.ts. Fleet-status and Terminal have single-site consumers and got inline instrumentation."
  - "typeof ws.addEventListener check for test-mock compatibility. Every pre-existing WS test in the tree (fleet-status-client.test.ts, PrettyView.relay-veil.test.tsx, PrettyView.relay-source.test.tsx, use-relay-adapter.test.ts, claude-session-api.role-reads.test.ts, .role-wakeup-crud.test.ts, .trapped-work.test.ts, .update-role-file-by-name.test.ts) stubs WebSocket with just .onmessage/.onclose/.onopen setters. Real browser WebSockets always have addEventListener — the guard is a zero-cost no-op in production and keeps ~700 pre-existing tests green."
  - "fleet-status-client test URL updated to expect ?build=dev-unknown. Vitest jsdom does not run Vite's define pass, so import.meta.env.VITE_BUILD_ID is undefined and CLIENT_BUILD_ID falls back to 'dev-unknown' (Plan 01's fallback). Only one URL assertion in the test file (Test 1); comment cross-references SKEW-09. Mirrors the same pattern Plan 05 used for backend fleet-status test URLs."
  - "Reconnect-suppression at THREE entry points, not one. Plan's rationale ('do NOT reconnect after the store is locked') requires ALL reconnect ladders bail. fleet-status-client's connect() function checks at the top before opening a fresh WS. use-relay-adapter's onclose bails BEFORE scheduling setRetryKey. Terminal.tsx's connectToHost checks after URL construction (so we still bail on skew even from a fresh visibility-flip reopen)."
  - "Guacamole onError SKYNET_STALE_CLIENT: branch returns BEFORE setConnectionError. Two locks are semantically different — TAKEOVER_MARKER is a per-pane condition (another window won the race), SKYNET_STALE_CLIENT is a shell-level condition (whole tab is stale). Suppress the per-pane connection overlay so the SkewLockModal is the ONLY thing the user sees, and set takenOverRef.current=true so onDisconnect's auto-reconnect suppresses too."
  - "guacamole-api.ts got a comment ONLY, not code. It is HTTP-only (fetches the encrypted token via authApi.post), does not construct any WS URL, and does not observe any WS event. The comment documents WHY the guacamole WS URL is naked (buildId lives inside the encrypted token payload; Pitfall 1 forbids per-frame stamping). Detection lives where the takeover-pattern lives — GuacamoleApp.tsx."

requirements-completed:
  - "SKEW-09"
  - "SKEW-10"

# Metrics
duration: ~17min
completed: 2026-09-21
---

# Phase 132 Plan 06: Client WS Version-Drift Detection Summary

**Client half of the WS lane wired: every WS URL grows a `?build=<CLIENT_BUILD_ID>` handshake stamp; every JSON-envelope onclose detects 4409 and fires the shell lock (with reconnect suppression across three ladder entry points); every onmessage checks `parsed.build` and drops the frame on mismatch; guacamole's onError mirrors the SKYNET_SUPERSEDED: takeover pattern to detect SKYNET_STALE_CLIENT: prefixes and fire the same lock.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-09-21T05:48:43Z
- **Completed:** 2026-09-21T06:06:00Z
- **Tasks:** 2
- **Files modified:** 8 (4 WS-JSON files + 1 relay-adapter consumer + 1 fleet-status test + 2 guacamole files)
- **Files created:** 0

## Accomplishments

- **`claude-session-api.ts`** — `openClaudeSessionSocket()` appends `?build=<CLIENT_BUILD_ID>` and calls the new private `attachSkewLockListeners(ws, "claude-session")`. The listener attaches close + message handlers via `addEventListener`, coexisting with the ~10 per-caller `.onclose`/`.onmessage` assignments elsewhere in this file (`probeIdentityTrappedWork`, `updateRoleFileByName`, `getRoleFileByName`, `listBountiesForRoleName`, `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`, and PrettyView's consumer). Test-mock compatibility guard: `typeof ws.addEventListener === "function"` skips instrumentation for stub sockets, keeping pre-existing tests green.
- **`fleet-status-client.ts`** — Appends `&build=<CLIENT_BUILD_ID>` to `opts.url` at connect time (branching on `url.includes("?")` for the ?/& choice). `connect()` bails early if `getSkewLockedSnapshot().locked` is true so post-lock reconnects don't fire. `ws.onmessage` inspects `parsed.build` after successful JSON.parse (BEFORE the switch dispatch) and calls `lockSkewedSession({reason: "ws_message_tag_mismatch"})` on mismatch, then drops the frame. `ws.onclose` runs the 4409 check BEFORE the existing reconnect backoff — locking on skew and `return`ing suppresses the entire reconnect ladder.
- **`relay-room-api.ts`** — `openRelayRoomSocket()` appends `?build=<CLIENT_BUILD_ID>` and calls the new private `attachRelayRoomSkewLockListeners(ws)`. Companion edit to `use-relay-adapter.ts` in the pretty-view relay adapter: `ws.onclose` bails BEFORE the setTimeout-scheduled `setRetryKey` reconnect when `getSkewLockedSnapshot().locked` is true (belt-and-braces — the shared listener already fires the lock; this guard prevents even a millisecond of unnecessary reconnect).
- **`Terminal.tsx`** — Adds `&build=<CLIENT_BUILD_ID>` to `baseWsUrl` AFTER all three URL-construction branches (embedded/configured/default) so the append is central and each branch's `?token=…`-or-not shape is handled by a single `includes("?")` check. Pre-open guard: `getSkewLockedSnapshot().locked` short-circuits `connectToHost` so a fresh WS is never opened post-lock. Existing `ws.addEventListener("message", …)` and `("close", …)` handlers gain a 4409/parsed.build check at the top of each body; on skew, sets `shouldNotReconnectRef.current = true` and drops through without invoking `attemptReconnection()`.
- **`GuacamoleApp.tsx`** — New `STALE_CLIENT_MARKER = "SKYNET_STALE_CLIENT:"` constant mirrors the existing `TAKEOVER_MARKER = "SKYNET_SUPERSEDED:"` pattern (L36). The `<GuacamoleDisplay>` `onError` prop now branches on the STALE_CLIENT prefix, slices the suffix as `serverBuild`, calls `lockSkewedSession({reason: "ws_handshake_mismatch", clientBuild: CLIENT_BUILD_ID, serverBuild})`, sets `takenOverRef.current = true` (suppresses `onDisconnect`'s auto-reconnect), and `return`s BEFORE `setConnectionError` so the per-pane connection overlay never paints — the shell-level `SkewLockModal` takes over the viewport instead.
- **`guacamole-api.ts`** — Header comment documents WHY the guacamole WS URL is naked (buildId lives INSIDE the encrypted token payload per Plan 05 Task 4; guacamole-lite's client owns URL construction from the opaque token blob; Pitfall 1 forbids per-frame stamping on the guac wire protocol). No code changes — this file is HTTP-only.

## Task Commits

Each task committed atomically:

1. **Task 1: JSON-envelope WS callers — URL param + close/message drift detection** — `f3462879` (`feat(132-06)`)
   - 6 files: claude-session-api.ts, fleet-status-client.ts, fleet-status-client.test.ts, relay-room-api.ts, use-relay-adapter.ts, Terminal.tsx. 308 insertions, 6 deletions.
2. **Task 2: Guacamole client SKYNET_STALE_CLIENT: prefix detection** — `d238f8ba` (`feat(132-06)`)
   - 2 files: guacamole-api.ts (comment only), GuacamoleApp.tsx (STALE_CLIENT_MARKER + onError branch). 42 insertions.

## Files Created/Modified

**Modified:**

- `src/ui/api/claude-session-api.ts` — added 2 imports (CLIENT_BUILD_ID, lockSkewedSession), `openClaudeSessionSocket()` URL now carries `?build=…`, new private `attachSkewLockListeners(ws, endpoint)` function attached via `addEventListener` on close + message. Test-mock guard on `typeof ws.addEventListener`.
- `src/ui/api/fleet-status-client.ts` — added imports (CLIENT_BUILD_ID, lockSkewedSession, getSkewLockedSnapshot); `wsUrl` computed from `opts.url` with `?`/`&` branching; `connect()` bails when locked; `onmessage` checks `parsed.build` after parse; `onclose` runs 4409 branch BEFORE reconnect logic.
- `src/ui/api/fleet-status-client.test.ts` — one test URL assertion updated to expect `?build=dev-unknown` (vitest fallback). Comment cross-references SKEW-09.
- `src/ui/api/guacamole-api.ts` — 10-line header comment documenting why the guacamole WS URL is naked (build lives in encrypted token, not URL). No code changes.
- `src/ui/features/pretty-view/sources/relay-room-api.ts` — added 2 imports, `openRelayRoomSocket()` URL now carries `?build=…`, new private `attachRelayRoomSkewLockListeners(ws)` via `addEventListener`. Test-mock guard.
- `src/ui/features/pretty-view/sources/use-relay-adapter.ts` — 2-line addition: `import { getSkewLockedSnapshot }`, and the `ws.onclose` handler bails BEFORE the setTimeout-scheduled reconnect if the lock is tripped.
- `src/ui/features/terminal/Terminal.tsx` — added 5 imports (CLIENT_BUILD_ID, lockSkewedSession, getSkewLockedSnapshot); `baseWsUrl` append with `?`/`&` branching; pre-open `locked` guard; `ws.addEventListener("message")` handler gets parsed.build check right after `JSON.parse(event.data)`; `ws.addEventListener("close")` handler gets 4409 branch at the top with `shouldNotReconnectRef` flip.
- `src/ui/features/guacamole/GuacamoleApp.tsx` — added 2 imports (CLIENT_BUILD_ID, lockSkewedSession); new `STALE_CLIENT_MARKER` const; `<GuacamoleDisplay onError>` prop's callback branches on STALE_CLIENT prefix, slices serverBuild, fires the lock, sets `takenOverRef.current=true`, and returns before `setConnectionError`.

## Decisions Made

- **Shared listener via `addEventListener` (not per-caller `.onclose` assignment).** `claude-session-api.ts` has ~10 caller sites — instrumenting each individually would be ~10 diffs with high risk of missing one. `addEventListener` is additive per DOM spec: both handlers fire in registration order. Same shape for `relay-room-api.ts`. `fleet-status-client.ts` and `Terminal.tsx` have single-consumer handlers and got inline instrumentation instead of shared-listener treatment (the pattern would be architecturally awkward for `.onclose = fn` shape).
- **`typeof ws.addEventListener === "function"` test-mock compatibility guard.** Every pre-existing WS test in the tree stubs `WebSocket` with a minimal `{onmessage, onclose, onopen}` object — no `addEventListener`. The check is a zero-cost no-op in production and keeps ~700 pre-existing tests green. Alternative (updating every mock to a full DOM-shape) would be a huge test-file refactor with no behavior gain.
- **fleet-status-client test URL updated to expect `?build=dev-unknown`.** Under vitest jsdom, Vite's `define` pass does not fire, so `import.meta.env.VITE_BUILD_ID` is undefined and `CLIENT_BUILD_ID` falls back to `"dev-unknown"` (Plan 01's fallback contract). Only Test 1 has a URL assertion; comment cross-references SKEW-09. Mirrors the same pattern Plan 05 used for backend fleet-status tests.
- **Reconnect-suppression at THREE entry points.** The plan's rationale ("don't reconnect after the store is locked") requires ALL reconnect ladders bail. `fleet-status-client`'s `connect()` at the top before opening a WS; `use-relay-adapter`'s `ws.onclose` before scheduling the setTimeout retry; `Terminal.tsx`'s `connectToHost` after URL construction but before `new WebSocket()`. The three ladders have DIFFERENT shapes (setTimeout-with-attempt-counter, effect-key-bump, direct-recall) so each got its own guard.
- **Guacamole onError branch returns BEFORE `setConnectionError`.** TAKEOVER_MARKER is a per-pane condition (per-pane overlay is correct), STALE_CLIENT_MARKER is a shell-level condition (shell modal takes over). Suppressing `setConnectionError` prevents the per-pane overlay from painting alongside the shell modal — the user sees ONE modal, not two.
- **`guacamole-api.ts` got a documentation comment ONLY.** The file is HTTP-only (`authApi.post` for the token). It does not construct a WS URL, does not observe a WS event. The comment documents the design rationale (build inside encrypted token, not URL) so future maintainers understand why this file has no drift-detection code despite being in `files_modified`. Detection lives where the takeover-pattern lives — `GuacamoleApp.tsx`.

## Deviations from Plan

**1. [Rule 3 - Blocking] `relay-room-api.ts` handlers live in a different file**

- **Found during:** Task 1 (initial file inspection)
- **Issue:** Plan's `files_modified` lists `src/ui/features/pretty-view/sources/relay-room-api.ts` as the site for "URL param + onclose + onmessage drift detection", but that file only exports `openRelayRoomSocket(): WebSocket` and wire types. The actual `.onmessage`/`.onclose` handlers live in `src/ui/features/pretty-view/sources/use-relay-adapter.ts` L458 + L616.
- **Fix:** URL append + shared drift-detection listeners installed inside `openRelayRoomSocket()` in `relay-room-api.ts` (satisfies plan's "URL construction" language). Because `addEventListener` handlers coexist with `.onmessage`/`.onclose` (both fire per DOM spec), the plan's semantic intent — every message and close on this WS surface fires drift detection — is achieved without touching each consumer. A companion 2-line edit to `use-relay-adapter.ts` guards the reconnect-setTimeout branch behind `getSkewLockedSnapshot().locked` so the reconnect ladder bails post-lock. Both files were staged in the Task 1 commit.
- **Files modified:** `src/ui/features/pretty-view/sources/relay-room-api.ts`, `src/ui/features/pretty-view/sources/use-relay-adapter.ts`
- **Commit:** `f3462879`

**2. [Rule 3 - Blocking] Test-mock incompatibility with `addEventListener`**

- **Found during:** Task 1 (first scoped vitest run)
- **Issue:** 6 pre-existing test files stub `WebSocket` with a minimal object (only `.onmessage`/`.onclose`/`.onopen` setters, no `addEventListener` method). Attaching drift-detection listeners via `ws.addEventListener` crashed those tests with `TypeError: ws.addEventListener is not a function` — 44 failing tests total.
- **Fix:** Guard the shared listener attachment with `if (typeof ws.addEventListener !== "function") return;` in `attachSkewLockListeners` (claude-session) and `attachRelayRoomSkewLockListeners` (relay-room). Real browser WebSockets always implement `addEventListener` per DOM spec — the guard is a zero-cost no-op in production and keeps 713 pre-existing tests green.
- **Files modified:** `src/ui/api/claude-session-api.ts`, `src/ui/features/pretty-view/sources/relay-room-api.ts`
- **Commit:** `f3462879`
- **Verification:** After the fix, scoped vitest reported 713/713 pass (52 test files).

**3. [Rule 3 - Blocking] `fleet-status-client.test.ts` Test 1 URL assertion**

- **Found during:** Task 1 (second scoped vitest run, after fix #2)
- **Issue:** Test 1 asserted `expect(ws.url).toBe("ws://localhost/fleet-status/ws")` verbatim. After the SKEW-09 URL append, the actual URL is `ws://localhost/fleet-status/ws?build=dev-unknown` (vitest jsdom falls back to `"dev-unknown"` because Vite `define` doesn't run under vitest).
- **Fix:** Updated the assertion to expect the `?build=dev-unknown` suffix. Comment cross-references SKEW-09 so future maintainers understand why. Mirrors the same pattern Plan 05 used for backend fleet-status tests (`?build=dev-unknown` pinning).
- **Files modified:** `src/ui/api/fleet-status-client.test.ts`
- **Commit:** `f3462879`

**4. [Rule 3 - Blocking] `SKYNET_STALE_CLIENT:` detection lives in `GuacamoleApp.tsx`, not `guacamole-api.ts`**

- **Found during:** Task 2 (inspecting where `SKYNET_SUPERSEDED:` lives)
- **Issue:** Plan's `files_modified` lists `src/ui/api/guacamole-api.ts` for guacamole drift detection, but `guacamole-api.ts` is HTTP-only (fetches the encrypted token via `authApi.post("/guacamole/token")`). It has no WS surface, no error observation. The existing `SKYNET_SUPERSEDED:` takeover-detection pattern lives at `src/ui/features/guacamole/GuacamoleApp.tsx:36` (marker const) + L294 (onError branch).
- **Fix:** Mirrored the takeover pattern in `GuacamoleApp.tsx` — added `STALE_CLIENT_MARKER` const and a new branch in the `<GuacamoleDisplay onError>` callback that fires `lockSkewedSession` and returns before `setConnectionError`. Added a documenting comment to `guacamole-api.ts` explaining why the WS URL is naked (buildId inside encrypted token, not URL — Pitfall 1). Both files touched per plan spirit; detection routed to where the pattern actually lives per plan's Task 2 rationale ("wherever the existing SKYNET_SUPERSEDED: takeover pattern lives — grep-verifiable"). Assumption A3 (client-side takeover-detection pattern exists) verified — no fallback needed.
- **Files modified:** `src/ui/api/guacamole-api.ts` (comment only), `src/ui/features/guacamole/GuacamoleApp.tsx`
- **Commit:** `d238f8ba`

**5. [Rule 3 - Blocking] `JSON.stringify(event)` substring in doc comments tripped plan's grep**

- **Found during:** Task 1 (post-implementation grep verification)
- **Issue:** Two doc comments explaining the anti-pattern ("never JSON.stringify(event) on DOM CloseEvent") tripped the plan's strict-literal grep `grep -c "JSON.stringify(event)" == 0` acceptance criterion.
- **Fix:** Rephrased both comments to describe the discipline without the literal substring — "never serialize the raw DOM CloseEvent, circular refs + non-enumerable properties" and "never serialize the raw DOM CloseEvent (circular refs; role-file directive + Pitfall 5)". Same discipline conveyed, no anti-pattern substring. Mirrors the exact adaptation Plan 02 documented as its Deviations #2 and #3.
- **Files modified:** `src/ui/api/claude-session-api.ts`, `src/ui/features/terminal/Terminal.tsx`
- **Commit:** `f3462879` (rolled into Task 1 before it landed)

None of these deviations changed the wire contract, threat-model outcome, or user-visible behavior. #1 and #4 are file-location adaptations to the actual codebase shape. #2 is a test-mock compatibility guard. #3 and #5 are test/grep hygiene fixes.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-22 (Spoofing — malicious server sends `parsed.build = <wrong>` to force client reload):** Accepted per plan. Requires attacker to control the WS server — outside our trust boundary. Legitimate scenarios (drift + MITM) both correctly trigger reload.
- **T-132-23 (Tampering — Structured close log leaks reason/wasClean to console):** Accepted per plan. Non-sensitive; matches existing debug-log discipline. All 4 close-event logs use explicit-field extraction.
- **T-132-24 (Denial of Service — Reconnect storm if client keeps hitting a 4409 server):** Mitigated at THREE reconnect entry points as planned: `fleet-status-client.connect()` early bail on `getSkewLockedSnapshot().locked`, `use-relay-adapter`'s `ws.onclose` bail before setTimeout, `Terminal.tsx`'s `connectToHost` pre-open guard AND `shouldNotReconnectRef.current=true` inside the onclose 4409 branch. Reload-loop sentinel from Plan 02 additionally caps at 4 reloads/60s (belt-and-braces).
- **T-132-25 (Information Disclosure — `parsed.build` value in the error log reveals server's SHA):** Accepted per plan. Public info (same value in HTTP response headers per Plan 03).
- **T-132-SC (Tampering — Supply chain, new npm/pip/cargo installs):** Accepted per plan. **ZERO new packages installed.** Only DOM/browser APIs (WebSocket, URL semantics via string concat, console) + Plan 01/02 project imports (`CLIENT_BUILD_ID`, `lockSkewedSession`, `getSkewLockedSnapshot`).

## Known Stubs

None. Every wire the plan describes is now live end-to-end — the browser attaches `?build=` on every WS connect, detects `event.code === 4409` on close, checks `parsed.build` on every JSON envelope, and detects `SKYNET_STALE_CLIENT:` on guacamole error instructions. All hook into the already-live `lockSkewedSession` from Plan 02.

## Verification Results

All plan-level `<verification>` gates green:

- Both tasks pass their scoped vitest runs (Task 1: 713 tests / 52 files; Task 2 combined: 1401 tests / 94 files).
- `npm run build`: exit 0 (Vite frontend + backend tsc).
- `npx tsc --noEmit`: exit 0.
- `grep -rq "SKYNET_STALE_CLIENT" src/ui/`: hit.
- All 4 JSON-envelope WS files: `build=` URL param present, `4409` close-code detection present, `ws_handshake_mismatch`/`ws_message_tag_mismatch` lock reasons present.
- Zero `JSON.stringify(event)` occurrences in any of the 4 touched WS-JSON files.
- All 4 files' close-event logs use explicit-field extraction (`event.code`, `event.reason`, `event.wasClean`, plus `isSkew` and `endpoint`).

## Deferred to Downstream Plans

- **None from this plan.** Phase 132's client half of the WS lane is complete: idle-tab detection (D-01 lane B) is now airtight for all 5 client-side WS surfaces.
- Phase 132 as a whole may still have downstream plans (07+) for playwright smoke tests, deploy-runbook updates, etc. — this plan's outputs are ready inputs for whatever the phase's remaining plans want.

## Next Plan Readiness

- **Any downstream Phase 132 plan** — WS drift-detection is live end-to-end. HTTP lane (Plans 03 + 04) + backend WS lane (Plan 05) + client WS lane (this plan) all wired.

## Self-Check: PASSED

Verified after summary write:

- `src/ui/api/claude-session-api.ts` — FOUND (modified)
- `src/ui/api/fleet-status-client.ts` — FOUND (modified)
- `src/ui/api/fleet-status-client.test.ts` — FOUND (modified)
- `src/ui/api/guacamole-api.ts` — FOUND (modified)
- `src/ui/features/pretty-view/sources/relay-room-api.ts` — FOUND (modified)
- `src/ui/features/pretty-view/sources/use-relay-adapter.ts` — FOUND (modified)
- `src/ui/features/terminal/Terminal.tsx` — FOUND (modified)
- `src/ui/features/guacamole/GuacamoleApp.tsx` — FOUND (modified)
- Commit `f3462879` (Task 1) — present in git log
- Commit `d238f8ba` (Task 2) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 06 — Client WS drift detection (URL build stamp + 4409 close + parsed.build check + guacamole SKYNET_STALE_CLIENT: prefix)*
*Completed: 2026-09-21*
