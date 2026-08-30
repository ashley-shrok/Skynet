---
phase: 17-pretty-view-relay-bubbles-skynet-integration
plan: 01
subsystem: backend/session-parser + ws-server + client-types
tags:
  - pretty-view
  - relay
  - matrix
  - detection
  - backend
requires: []
provides:
  - detectRelayOutbound export (session-file-parser.ts)
  - detectRelayInbound export (session-file-parser.ts)
  - relay_outbound WS frame emission (claude-session-server.ts)
  - relay_inbound WS frame emission (claude-session-server.ts)
  - RelayOutboundEvent + RelayInboundEvent client types (claude-session-api.ts)
affects:
  - src/backend/claude-session/session-file-parser.ts
  - src/backend/claude-session/session-file-parser.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
tech-stack:
  added: []
  patterns:
    - 3-way regex conjunction for relay outbound detection (prototype-validated)
    - extractError field on detection success / extraction failure (RELAYBUB-05)
    - switch-on-kind in WS emission handler (replaces if-chains for extensibility)
key-files:
  created: []
  modified:
    - src/backend/claude-session/session-file-parser.ts (303 -> 568 lines)
    - src/backend/claude-session/session-file-parser.test.ts (474 -> 641 lines)
    - src/backend/claude-session/claude-session-server.ts (2858 -> 2908 lines)
    - src/ui/api/claude-session-api.ts (513 -> 552 lines)
decisions:
  - "Used switch(parsed.kind) in WS handler instead of extending if-chain — aligns with acceptance criteria + makes exhaustiveness visible"
  - "detectRelayInbound strips task-notification wrapper tags before regex so the INBOUND_REGEX matches the bare recv.sh event line inside"
  - "outbound detector runs on assistant turns before extractText so relay turns do not fall through to kind:message"
  - "inbound detector runs before harness_wrapper skip so relay task-notifications surface instead of being dropped"
metrics:
  duration: "~25 min"
  completed: "2026-07-28"
  tasks: 2
  files: 4
---

# Phase 17 Plan 01: Backend Relay Detection + WS Emission Summary

Backend session-file-parser relay detection for Matrix round-trips ported byte-for-byte from prototype.html 6/6 acceptance battery; WS emission via two new switch cases; client union extended with typed relay event aliases.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend session-file-parser with relay detection + unit tests | 7251d6d | session-file-parser.ts, session-file-parser.test.ts |
| 2 | Emit relay events over WebSocket + add client-side wire types | 4a74ebd | claude-session-server.ts, claude-session-api.ts |

## Regex Verbatim Confirmation

All four byte-verbatim acceptance criteria passed:

```
REGEX-CURL-VERBATIM-OK
REGEX-PUT-VERBATIM-OK
REGEX-URL-VERBATIM-OK
REGEX-INBOUND-VERBATIM-OK
```

Exact strings in session-file-parser.ts:
```typescript
const OUTBOUND_CURL_RE = /\bcurl\b/;
const OUTBOUND_PUT_RE = /-X\s+PUT\b/;
const OUTBOUND_URL_RE = /rooms\/[^\/\s'"]+\/send\/m\.room\.message\/[^\/\s'"`]+/;
const INBOUND_REGEX = /\[room\s+(\S+)\]\s*\[(\@\S+)\]\s*\(event\s+(\S+)\):\s*([\s\S]*?)(?:<\/event>|$)/;
```

## Test Count

- Before: 19 tests across 2 describe blocks
- After: 28 tests across 3 describe blocks (+9 new Phase 17 relay detection tests)
- All 28 pass; all 84 backend claude-session suite tests pass

## Wire Shape Snippet

```typescript
// RelayOutboundEvent — WS frame emitted when Bash tool_use is a Matrix send
export type RelayOutboundEvent = {
  type: "relay_outbound";
  room: string | null;
  body: string | null;
  extractError: string | null;
  rawCommand: string;
  eventId: string;
  ts: number;
};

// RelayInboundEvent — WS frame emitted when task-notification matches recv.sh format
export type RelayInboundEvent = {
  type: "relay_inbound";
  room: string;
  sender: string;
  matrixEventId: string;
  body: string;
  raw: string;
  eventId: string;
  ts: number;
};
```

## TSC Clean

`npx tsc --noEmit` exits 0 across the whole repo. PrettyView's non-exhaustive switch silently ignores the two new discriminator values until plan 17-03 adds the render handlers.

## PrettyView.tsx

NOT touched in this plan. `git diff --stat src/ui/features/pretty-view/PrettyView.tsx` shows 0 lines changed. Plan 17-03 owns the render dispatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing pattern] Converted if-chains to switch in WS handler**
- **Found during:** Task 2
- **Issue:** The plan's acceptance criteria required `grep -c 'case "relay_outbound"\|case "relay_inbound"'` to return 2. The existing emission code used `if (parsed.kind === ...)` chains, not a switch. Adding two more `if` blocks would fail the grep gate.
- **Fix:** Refactored the `parsed.kind` consumer block in `claude-session-server.ts` from independent `if` statements to a `switch (parsed.kind)` with `case "message"`, `case "image"`, `case "relay_outbound"`, and `case "relay_inbound"` branches. Behavior is identical; the switch form also makes exhaustiveness visible and extensibility clean for plan 17-03+.
- **Files modified:** `src/backend/claude-session/claude-session-server.ts`
- **Commit:** 4a74ebd

## Known Stubs

None. Detection is fully wired end-to-end from parser through WS emission. The client-side rendering in PrettyView.tsx is intentionally deferred to plan 17-03 (not a stub — the plan explicitly scopes it out and the union extension is complete).

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond what was planned. T-17-01-02 (rawCommand disclosure) was pre-analysed and accepted in the plan's threat model.

## Self-Check: PASSED

- [x] src/backend/claude-session/session-file-parser.ts exists and has 568 lines
- [x] src/backend/claude-session/session-file-parser.test.ts exists and has 641 lines
- [x] src/backend/claude-session/claude-session-server.ts modified
- [x] src/ui/api/claude-session-api.ts modified
- [x] Commit 7251d6d exists (Task 1)
- [x] Commit 4a74ebd exists (Task 2)
- [x] All 4 VERBATIM-OK regex checks pass
- [x] All 28 tests pass (19 pre-existing + 9 new)
- [x] tsc --noEmit exits 0
- [x] PrettyView.tsx unchanged
