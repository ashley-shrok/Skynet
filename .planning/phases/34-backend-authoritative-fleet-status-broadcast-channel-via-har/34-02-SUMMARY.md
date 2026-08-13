---
phase: 34-backend-authoritative-fleet-status-broadcast-channel-via-har
plan: 02
subsystem: backend/fleet-status
tags: [backend, websocket, zod, subscription-registry, jwt-auth, tailscale, port-30012]
requires: [zod (already in node_modules v4.4.3 as transitive), ws (already), drizzle-orm (already), AuthManager singleton, drizzle hosts table]
provides:
  - startFleetStatusServer (port 30012) with dual handshake modes
  - SubscriptionRegistry factory with snapshot + fan-out + gone semantics
  - Versioned zod wire protocol (FRAME_SCHEMA_VERSION=1) shared by watchers (Plan 04) and frontend (Plan 06)
  - resolveHostRecordByName(name) → HostRecord | null (case-insensitive)
affects:
  - src/backend/starter.ts (added startFleetStatusServer boot block after dashboard.js)
tech-stack:
  added: []
  patterns:
    - "JWT-cookie-or-bearer auth chain reused verbatim from src/backend/ssh/terminal.ts:129-160"
    - "WebSocketServer bound to fixed port (30012) — mirrors claude-session-server.js pattern"
    - "zod discriminatedUnion for frame schemas; per-schema literal schemaVersion for future gating"
    - "Set-based subscribers for idempotent subscribe; try/catch per-subscriber to isolate fan-out failures"
key-files:
  created:
    - src/backend/fleet-status/wire-protocol.ts (216 lines)
    - src/backend/fleet-status/wire-protocol.test.ts (121 lines, 6 tests)
    - src/backend/fleet-status/host-id-resolver.ts (61 lines)
    - src/backend/fleet-status/host-id-resolver.test.ts (77 lines, 1 test)
    - src/backend/fleet-status/subscription-registry.ts (134 lines)
    - src/backend/fleet-status/subscription-registry.test.ts (165 lines, 7 tests)
    - src/backend/fleet-status/fleet-status-server.ts (394 lines)
    - src/backend/fleet-status/fleet-status-server.test.ts (325 lines, 8 tests)
  modified:
    - src/backend/starter.ts (wire-in startFleetStatusServer block; 23 line addition after dashboard.js)
decisions:
  - "Path-based mode dispatch: /fleet-status/ws (frontend, JWT-gated) vs /fleet-status/watcher (watcher, Tailscale-gated). Chose paths over query params or subprotocols because path is the most-visible discriminator in nginx logs and access reasoning."
  - "Frontend clients must send an explicit {type:'subscribe'} first frame before receiving the snapshot. Rationale: allows future protocol negotiation on the same connection without spec drift, and gives the client control over when to start receiving traffic."
  - "publishSessionGone is a no-op when the key isn't in the state map. Rationale: watcher restart cycles will re-emit gone for stale sessions; without this guard, subscribers would see spurious gone frames for keys they never saw."
  - "hostId in log context renamed to fleetHostId to avoid collision with logger.ts's declared hostId?: number field. Local variable stays hostId for semantic clarity."
  - "resolveHostRecordByName uses SQL LOWER() for case-insensitive comparison against the hosts.name column — matches drizzle's parameter-binding style already used across the routes."
metrics:
  duration: "~45 minutes execution time (spanning two sessions due to orchestrator crash)"
  completed: 2026-08-13
  tasks: 3
  files_created: 8
  files_modified: 1
  test_count: 22
  full_suite_test_files: 159
  full_suite_tests_passed: 2012
---

# Phase 34 Plan 02: Skynet backend fleet-status broadcast WS server — Summary

**One-liner:** Backend fleet-status broadcast WebSocket server on port 30012 with dual handshake modes (frontend/watcher), versioned zod wire protocol, and in-memory subscription registry with snapshot + fan-out + gone semantics.

---

## What was built

This plan delivers the aggregator side of Phase 34's backend-authoritative topology. Plan 01 built the box-side watcher that consumes `~/.claude/sessions/<pid>.json` and emits SessionState events; Plan 02 builds the server the watcher publishes into and the frontend consumes from. Concrete surface:

1. **`src/backend/fleet-status/wire-protocol.ts`** — the single source of truth for every frame shape that crosses the fleet-status channel. Load-bearing for Plan 04 (watcher transport) and Plan 06 (frontend client) — both will import from here.

2. **`src/backend/fleet-status/host-id-resolver.ts`** — maps watcher-declared hostnames (`thenasty`, `workstation`, etc.) to Skynet DB host records so row keys used by the fleet-status channel align with the existing conversation-store `(host, tmuxSession)` convention.

3. **`src/backend/fleet-status/subscription-registry.ts`** — in-memory state map keyed on `${hostId}:${tmuxSession ?? ''}` plus a Set of frontend-connection sinks. Connect-time snapshot + incremental fan-out + gone semantics.

4. **`src/backend/fleet-status/fleet-status-server.ts`** — the WebSocketServer on port 30012 that ties the three above together. Two path-dispatched handshake modes with independent auth policies.

5. **`src/backend/starter.ts`** — wires the server into the backend boot sequence after `dashboard.js` initializes, reusing the singleton `AuthManager` instance created at line 117.

---

## Wire protocol frame shapes (Plan 04 + Plan 06 will import from here)

Every frame carries `schemaVersion: 1` (the exported `FRAME_SCHEMA_VERSION` constant). All frames are zod-validated on ingress.

### `SessionState` (the payload carried by watcher publishes and frontend snapshots)

```ts
{
  hostId: string;               // resolved Skynet host record id
  tmuxSession: string | null;   // null if Claude not running under tmux
  sessionId: string;            // from ~/.claude/sessions/<pid>.json
  pid: number;
  status: "busy" | "shell" | "idle" | "waiting";
  waitingFor?: string;          // present only when status === "waiting"
  backgroundTasks: BackgroundTask[];
  updatedAt: number;            // ms since epoch (matches session-JSON updatedAt)
}
```

`BackgroundTask` is a `z.union` over the seven known task types from the Stop-hook `background_tasks[]` field table (RESEARCH §1): `shell`, `subagent`, `monitor`, `workflow`, `teammate`, `cloud session`, `MCP task`, plus an unknown-type fallback so future harness additions do not break parsing.

### Watcher → Backend frames (`WatcherInboundFrame`, discriminated on `type`)

```ts
// Sent immediately after watcher WS connects
{ schemaVersion: 1, type: "hello", hostname: string }

// Sent whenever a session's state changes
{ schemaVersion: 1, type: "session_state", state: SessionState }

// Sent when a session's PID dies
{ schemaVersion: 1, type: "session_gone", tmuxSession: string | null, sessionId: string }
```

### Backend → Frontend frames (`FrontendOutboundFrame`, discriminated on `type`)

```ts
// Sent immediately after frontend subscribes; contains all currently-known state
{ schemaVersion: 1, type: "snapshot", states: SessionState[] }

// Sent when any watcher publishes a new SessionState
{ schemaVersion: 1, type: "update", state: SessionState }

// Sent when a watcher reports a session gone
{ schemaVersion: 1, type: "gone", hostId: string, tmuxSession: string | null, sessionId: string }

// Sent in response to a ping frame
{ schemaVersion: 1, type: "pong" }
```

### Frontend → Backend frames (`FrontendInboundFrame`, discriminated on `type`)

```ts
// Client requests the initial snapshot + registers as a subscriber
{ schemaVersion: 1, type: "subscribe" }

// Client heartbeat
{ schemaVersion: 1, type: "ping" }
```

Helper constructors are exported from `wire-protocol.ts`: `makeSnapshotFrame(states)`, `makeUpdateFrame(state)`, `makeGoneFrame(hostId, tmuxSession, sessionId)`, `makePongFrame()`. All stamp `schemaVersion` automatically.

---

## Path split: `/fleet-status/ws` vs `/fleet-status/watcher`

The server dispatches per-connection based on `req.url`:

| Path | Consumer | Auth policy | On failure |
|------|----------|-------------|------------|
| `/fleet-status/ws` | Frontend browser client | JWT via `Cookie: jwt=<token>` or `Authorization: Bearer <token>` — chain reused verbatim from `src/backend/ssh/terminal.ts:129-160` | Close 1008 + `fleet_status_auth_failed` log |
| `/fleet-status/watcher` | Per-box watcher process | No JWT; trusted via Tailscale network boundary. First frame MUST be `{type:"hello", hostname}`. Hostname MUST resolve via `resolveHostRecordByName` to a known Skynet host record. | Close 1008 + `fleet_status_watcher_host_unknown` log |
| anything else | — | — | Close 4000 (unknown path) |

Any inbound frame that fails zod parsing → close 1003 + `fleet_status_parse_error` log.

Rationale for path over query-param dispatch: path is the most-visible discriminator in nginx access logs, makes reverse-proxy `location` blocks trivially clear, and separates the two consumer models cleanly for future policy divergence (e.g. Watcher-specific rate limiting).

---

## Port choice: 30012

The server binds to port 30012, sitting alongside the existing per-pane WS servers:

- `30001` (guacd bridge)
- `30002` (terminal.ts — SSH terminal WS)
- `30003` (claude-session-server.js — Claude-session monitor WS)
- ... (other 300xx per-pane WSes)
- **`30012` (fleet-status-server.ts — this plan)**

The port is bound in-container by the Skynet backend, reached externally via nginx reverse proxy.

### Nginx implications for Plan 04

Plan 04 (watcher transport) will need to add `location` blocks for BOTH nginx configs per the CLAUDE.md Nginx caveat rule:

- `docker/nginx.conf` (HTTP)
- `docker/nginx-https.conf` (HTTPS/Caddy front)

The two proxy locations Plan 04 must add:

```nginx
location /fleet-status/ws {
    proxy_pass http://skynet:30012;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location /fleet-status/watcher {
    proxy_pass http://skynet:30012;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Note: Plan 02 does NOT edit any nginx configs — that is Plan 04's responsibility per the plan boundary. This SUMMARY documents the target so Plan 04's planner has the exact snippet.

---

## Wave 1 parallelism note

Per phase design, Plans 01, 02, and 03 run in Wave 1 on disjoint code surfaces:

- **Plan 01**: `src/fleet-status-watcher/**` — box-side Node watcher
- **Plan 02**: `src/backend/fleet-status/**` + one wire-in line in `src/backend/starter.ts` — THIS PLAN
- **Plan 03**: `src/ui/features/pretty-view/WaitingBubble.*` — frontend waiting bubble

Plan 02 touched only its declared surface. There are `src/ui/features/pretty-view/WaitingBubble.{ts,tsx}` files present as untracked artifacts from Plan 03's parallel session — they are NOT in Plan 02's `files_modified` list and were not touched by this executor.

---

## Verification results (all acceptance criteria met)

### Per-plan acceptance criteria

- `grep -c 'schemaVersion' src/backend/fleet-status/wire-protocol.ts` → **15** (required ≥ 5)
- `grep -rn 'systemLogger' src/backend/fleet-status/ | wc -l` → **31** (required ≥ 8; fleet-status-server.ts alone has 22)
- `grep -rn 'JSON.stringify(event)' src/backend/fleet-status/*.ts` → **0 matches in code** (only 1 match in a comment describing the anti-pattern)
- `grep -n 'startFleetStatusServer' src/backend/starter.ts` → **2 matches** (import + invocation)

### Test tally

| File | Tests |
|------|-------|
| wire-protocol.test.ts | 6 |
| host-id-resolver.test.ts | 1 |
| subscription-registry.test.ts | 7 |
| fleet-status-server.test.ts | 8 |
| **Plan 02 total** | **22** |

### Full-suite verification

- `npx vitest run` → **159 test files pass, 2012 tests pass, 6 skipped, 1 todo, 0 failures** (duration: 463s)
- `npx tsc --noEmit` (frontend) → exit 0, clean
- `npx tsc --noEmit -p tsconfig.node.json` (backend) → exit 0, clean (after fix commit `a60d30c`)
- `npm run build:backend` → exit 0, clean

There is one Vitest environment teardown warning ("Closing rpc while onUserConsoleLog was pending") originating in `src/ui/features/pretty-view/IdentityModal.test.tsx`. This file is (a) NOT touched by Plan 02, (b) last modified by commit `2a183df` predating Phase 34. It is a pre-existing test-infrastructure issue tracked as a deferred item (see Deferred Issues below), not a regression from this plan.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] hostId log field type collision in LogContext**

- **Found during:** Task 3 verification (backend tsc noEmit run)
- **Issue:** The shared `LogContext` interface in `src/backend/utils/logger.ts` declares `hostId?: number` (SSH host DB has integer ids). Fleet-status uses string hostIds resolved from `HostRecord.id`. Passing them as `hostId` in log context objects failed backend tsc with 5 × TS2322 errors ("Type 'string' is not assignable to type 'number'").
- **Fix:** Renamed the log field from `hostId` to `fleetHostId` at all 5 call sites in `fleet-status-server.ts`. The local variable stays `hostId` for semantic clarity — only the log field name changes. No behavior change.
- **Files modified:** `src/backend/fleet-status/fleet-status-server.ts`
- **Commit:** `a60d30c`

Auto-fix per Rule 3 (blocking issue: tsc won't compile). No architectural change; only field naming.

### Auth gates

None encountered during execution.

---

## Deferred Issues (out of scope)

**1. Vitest environment teardown warning in `IdentityModal.test.tsx`**

- **File:** `src/ui/features/pretty-view/IdentityModal.test.tsx`
- **Error:** `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`
- **Impact:** Warning only — the test file itself passes; the warning does not fail the run
- **Scope:** Frontend test infrastructure; NOT touched by Plan 02 (last modified in commit `2a183df` predating Phase 34)
- **Recommendation:** Track as a separate quick task; not a Plan 02 regression

Per SCOPE BOUNDARY (executor guardrail): pre-existing warnings in unrelated files are logged here and NOT fixed by this plan's executor.

---

## Commits (7 total, atomic per TDD gate)

Task 1 — Wire protocol + host-id resolver:
- `7f85f2f` — `test(34-02-01)`: RED — failing tests for wire-protocol + host-id-resolver
- `5744301` — `feat(34-02-01)`: GREEN — implement wire-protocol zod schemas + host-id-resolver

Task 2 — Subscription registry:
- `254b882` — `test(34-02-02)`: RED — failing tests for subscription-registry
- `43bfa3b` — `feat(34-02-02)`: GREEN — implement subscription-registry with snapshot + fan-out + gone semantics

Task 3 — WebSocket server + starter.ts wire-in:
- `848de8d` — `test(34-02-03)`: RED — failing tests for fleet-status-server WebSocket server
- `84d9d66` — `feat(34-02-03)`: GREEN — implement fleet-status WS server + wire into starter.ts
- `a60d30c` — `fix(34-02-03)`: rename hostId → fleetHostId in log calls for LogContext type safety (Rule 3 auto-fix)

TDD gate sequence: RED-then-GREEN pairs for each task, with the Task 3 GREEN commit followed by a type-safety fix. All commits atomic and independently revertable.

---

## Handoff to downstream plans

**Plan 04 (watcher-to-backend transport) must:**

1. Import `WatcherInboundFrame` / `FRAME_SCHEMA_VERSION` from `src/backend/fleet-status/wire-protocol.ts` in the watcher-side WebSocket client
2. Connect the watcher to `wss://term.gigaashley.click/fleet-status/watcher` (Tailscale-backed)
3. Send `{schemaVersion:1, type:"hello", hostname}` as the FIRST frame after connection open
4. Ensure the box's hostname (as reported to watcher) matches a Skynet DB `hosts.name` row (case-insensitive) — otherwise the connection is 1008-closed
5. Add nginx `location` blocks for `/fleet-status/ws` AND `/fleet-status/watcher` in BOTH `docker/nginx.conf` and `docker/nginx-https.conf` (see § Nginx implications above)

**Plan 06 (frontend cutover) must:**

1. Import `FrontendInboundFrame` / `FrontendOutboundFrame` / `FRAME_SCHEMA_VERSION` from `src/backend/fleet-status/wire-protocol.ts` (or set up a shared frontend/backend types package if easier)
2. Connect the frontend once at boot to `wss://<origin>/fleet-status/ws` (JWT already in cookie)
3. Send `{schemaVersion:1, type:"subscribe"}` as the first frame after connection open
4. Handle the `snapshot` frame by seeding `session-working-store.ts` state Map, then handle `update` and `gone` frames incrementally
5. Retire the two feeders (`publishSessionTtyBusy` from Terminal.tsx + `publishSessionHasBackgroundedWork` from PrettyView.tsx) per Phase 34 scope

---

## Self-Check

Verified all created files exist:

- src/backend/fleet-status/wire-protocol.ts — FOUND
- src/backend/fleet-status/wire-protocol.test.ts — FOUND
- src/backend/fleet-status/host-id-resolver.ts — FOUND
- src/backend/fleet-status/host-id-resolver.test.ts — FOUND
- src/backend/fleet-status/subscription-registry.ts — FOUND
- src/backend/fleet-status/subscription-registry.test.ts — FOUND
- src/backend/fleet-status/fleet-status-server.ts — FOUND
- src/backend/fleet-status/fleet-status-server.test.ts — FOUND
- src/backend/starter.ts — MODIFIED (wire-in block after dashboard.js)

Verified all 7 commits exist on `feat/tab-title-from-tmux`:

- 7f85f2f — FOUND
- 5744301 — FOUND
- 254b882 — FOUND
- 43bfa3b — FOUND
- 848de8d — FOUND
- 84d9d66 — FOUND
- a60d30c — FOUND

## Self-Check: PASSED
