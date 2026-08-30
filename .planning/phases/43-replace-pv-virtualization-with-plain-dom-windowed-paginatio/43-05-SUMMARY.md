---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 05
subsystem: api
tags: [websocket, type-guard, tdd, phase-43, fetch-older, pretty-view]

# Dependency graph
requires:
  - phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
    provides: "Plan 43-03: FetchOlderPayload + FetchOlderBatchEvent wire types + historyWindow connect option (grep-clean anchorLine=0 lock)"
  - phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
    provides: "Plan 43-04: backend handleFetchOlder + historyWindow handshake parse (wire counterpart the frontend runtime now calls into)"
provides:
  - "sendFetchOlder(ws, payload): boolean — readyState-gated + throw-safe JSON send on an already-open pretty-view WS"
  - "isFetchOlderBatchEvent(x): x is FetchOlderBatchEvent — minimal-shape runtime guard for PrettyView's onmessage switch"
  - "TDD coverage locking readyState gate (OPEN/CONNECTING/CLOSING/CLOSED), send-throw safety, and the empty-frames+error guard-true path (plan-checker LOW-2)"
affects: [43-07b, pretty-view, ClaudeSessionServerEvent-union-narrowing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One-shot runtime helper on an already-open pretty-view WS (vs countIdentityBounties's own-socket pattern)"
    - "Minimal-shape type-guard: `type` discriminator + `Array.isArray` on the primary collection field; optional fields do NOT gate narrowing"

key-files:
  created:
    - "src/ui/api/claude-session-api.test.ts (14 specs)"
  modified:
    - "src/ui/api/claude-session-api.ts (+52 lines: sendFetchOlder + isFetchOlderBatchEvent)"

key-decisions:
  - "sendFetchOlder returns boolean (not void) so Plan 43-07b's debounced scroll handler can no-op / retry-on-next-scroll without wrapping the call in try/catch"
  - "isFetchOlderBatchEvent narrows on {type + Array.isArray(frames)} only — reachedBeginning and error are optional and MUST NOT gate the guard, otherwise PrettyView cannot clear its loading indicator on server-signalled failure (Phase 43 CONTEXT § Fetch failure handling)"
  - "Helpers clustered directly under FetchOlderBatchEvent (post-L924) and before countIdentityBounties (pre-L940) — keeps wire-type + runtime helper adjacency so a Wave 3 reader lands on the full contract in one region"
  - "Test file named claude-session-api.test.ts (as plan frontmatter names it) — plan explicitly permitted extending an existing file, but none of the extant sibling files (aside.test / count-bounties.test) matched that name, so created new"

patterns-established:
  - "Runtime type-guard for WS event narrowing: discriminated-union `type` check + primary-collection Array.isArray; keep optional-field checks OUT of the guard so error/reachedBeginning/etc. server-signalled shapes still narrow true"
  - "Send-helper on an existing WS: readyState-check + try/catch around JSON.stringify+send; return boolean so callers wire it into event handlers without try/catch at the call site"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-08-18
---

# Phase 43 Plan 05: Frontend runtime helpers `sendFetchOlder` + `isFetchOlderBatchEvent` Summary

**Two small runtime helpers landed on top of Plan 43-03's frozen wire types: `sendFetchOlder(ws, payload)` for the outbound fetch_older request path and `isFetchOlderBatchEvent(x)` type-guard for the inbound batch response — Wave 3 PrettyView plan (43-07b) is now a two-line import contract.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-18T17:10:41Z
- **Completed:** 2026-08-18T17:18:00Z (approx)
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **`sendFetchOlder(ws, payload)`** — readyState-gated + throw-safe JSON send on an ALREADY-OPEN pretty-view WS. Unlike `countIdentityBounties` (which opens its own one-shot socket), this helper reuses the existing session-bound connection. Returns `false` on CONNECTING/CLOSING/CLOSED or when `ws.send` throws (mid-close race); returns `true` when the payload was handed to `ws.send`. Never throws — designed to slot into a debounced scroll handler.
- **`isFetchOlderBatchEvent(x)`** — minimal-shape runtime guard: `type === "fetch_older_batch"` AND `Array.isArray(frames)`. Optional fields (`reachedBeginning`, `error`) do NOT gate the guard, so PrettyView's Wave 3 onmessage switch can safely narrow on server-signalled failure shapes (`{ type, frames: [], error: "…" }`) and clear its loading indicator.
- **14 vitest specs** locking every branch: OPEN happy path, CONNECTING/CLOSING/CLOSED gates, send-throw returns false, and three guard-true cases (minimal empty-frames, populated frames + reachedBeginning, empty frames + error — the plan-checker LOW-2 path) plus six guard-false cases (null / undefined / string / wrong-type / missing frames / non-array frames).
- **Zero premature wiring** — `grep -rn "sendFetchOlder\|isFetchOlderBatchEvent" src/ --include="*.ts" --include="*.tsx" | grep -v claude-session-api` returns 0 hits. Plan 43-07b is the sole future consumer.
- **Zero touch on 43-03's frozen contract** — `grep -c anchorLine src/ui/api/claude-session-api.ts` still returns 0; `FetchOlderPayload` + `FetchOlderBatchEvent` shapes unchanged; `openClaudeSessionSocket({historyWindow})` unchanged; `countIdentityBounties` unchanged.
- **Both builds green** — `npm run build:backend` exit 0, `npm run build` exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing tests for both helpers** — `288335e9` (test)
   - Created `src/ui/api/claude-session-api.test.ts` with 14 failing specs
   - All 14 failed with `TypeError: sendFetchOlder is not a function` / `isFetchOlderBatchEvent is not a function` as expected

2. **Task 2: GREEN — implement both helpers** — `536c5c9a` (feat)
   - Added `sendFetchOlder` + `isFetchOlderBatchEvent` to `src/ui/api/claude-session-api.ts` (+52 lines, additive only)
   - All 14 specs pass; both builds exit 0; no premature wiring; anchorLine lock preserved

**Plan metadata:** _(next commit — this SUMMARY.md + STATE.md + ROADMAP.md)_

## Files Created/Modified

- **Created** `src/ui/api/claude-session-api.test.ts` (174 lines) — vitest coverage for both helpers under the frontend jsdom project; uses the global `WebSocket` constant for readyState numeric constants; ws-stub is a minimal `{ readyState, send: vi.fn() }` shape (helper only touches those two fields).
- **Modified** `src/ui/api/claude-session-api.ts` (+52 lines, one region — L927..L979) — inserted `sendFetchOlder` + `isFetchOlderBatchEvent` between the `FetchOlderBatchEvent` type declaration (from Plan 43-03) and the `countIdentityBounties` function. No other exports touched.

## Decisions Made

- **`sendFetchOlder` returns `boolean`** (not `void`) — Plan 43-07b's debounced near-top scroll handler needs a signal to know whether to arm a "no in-flight" latch or to no-op and let the next scroll event retry. Returning boolean gives that signal without requiring the caller to wrap the call in try/catch.
- **Minimal-shape guard, optional fields NOT gated** — per Phase 43 CONTEXT.md § "Fetch failure handling", the server ALWAYS emits a `fetch_older_batch` event, error-shape included, so the client can clear its loading indicator. If the guard required `frames.length > 0` or absence of `error`, PrettyView's handler could not narrow on the failure shape and loading spinners would leak. The plan-checker LOW-2 note in the success criteria explicitly called this out.
- **Placement: helpers directly under `FetchOlderBatchEvent`, before `countIdentityBounties`** — CONTEXT.md § "Backend contract additions" carved out this region for Phase 43 wire additions. Keeping runtime helpers adjacent to wire types means a Wave 3 reader lands on the full request/response/guard contract in one region.
- **Test file name: `claude-session-api.test.ts`** — the plan's `files_modified` frontmatter names this exact path, and the plan's `<action>` block permitted extending an existing file if one matched. None of the extant sibling files (`claude-session-api.aside.test.ts`, `claude-session-api.count-bounties.test.ts`) matched the plan's chosen name, so created new. The file is scoped to Plan 43-05's helpers only — future plans that add helpers to `claude-session-api.ts` can either extend this file or add their own sibling.

## Deviations from Plan

None — plan executed exactly as written. Neither Rule 1 (bug), Rule 2 (missing critical), Rule 3 (blocking), nor Rule 4 (architectural) applied. Test count exceeded the plan's minimum acceptance criteria (10 sendFetchOlder mentions ≥ 2 required; 13 isFetchOlderBatchEvent mentions ≥ 4 required) because the executor added CLOSING-state and send-throw specs that the plan's `<behavior>` block mentioned parenthetically but did not enumerate — these are extra guardrails, not scope creep.

**Total deviations:** 0
**Impact on plan:** None. Plan-checker LOW-2 note (empty-frames + error field as valid guard-true path) explicitly honored in `isFetchOlderBatchEvent > returns true for empty frames + error field (server-signalled failure path)`.

## Issues Encountered

None. Two-task TDD cycle ran clean:
- RED: 14 specs, all `TypeError: X is not a function`, no import/module-resolution issues.
- GREEN: 14 specs pass on first implementation attempt; both builds exit 0 on first attempt.

## User Setup Required

None — no external service configuration; helpers are pure client-side runtime.

## Next Phase Readiness

- **Plan 43-05: DONE.** Wave 2 (backend 43-04 + frontend 43-05) is now COMPLETE. Wave 3 (PrettyView plans 43-07a and 43-07b) can begin — 43-07b in particular will import `sendFetchOlder` + `isFetchOlderBatchEvent` as a two-line contract without hand-rolling JSON send or hand-rolling type-narrowing.
- **No blockers.** The wire contract from 43-03 remains frozen (`anchorLine=0` grep-lock preserved); the backend `handleFetchOlder` from 43-04 is the server-side counterpart of these helpers; the frontend `openClaudeSessionSocket({historyWindow})` from 43-03 is what will carry the connect-time bound that these helpers extend to the fetch-older-time bound.
- **Wave 3 kickoff notes for downstream planner:**
  - Import path: `import { sendFetchOlder, isFetchOlderBatchEvent } from "@/api/claude-session-api"` (adjust for extension).
  - `sendFetchOlder` returns boolean — callers should treat `false` as "not sent this tick" and let the debounced trigger retry on the next scroll event.
  - `isFetchOlderBatchEvent` narrows to `FetchOlderBatchEvent` whose `frames` field is typed `unknown[]` at this scaffolding stage (per 43-03 SUMMARY.md deferred-narrowing note); 43-07b is the plan-authorized narrowing point where `frames` becomes `Array<MessageEvent | ImageEvent | RelayOutboundEvent | RelayInboundEvent | MalformedLineEvent>`.

## Self-Check: PASSED

- [x] `src/ui/api/claude-session-api.test.ts` exists — FOUND
- [x] `src/ui/api/claude-session-api.ts` modified (+52 lines) — FOUND
- [x] Commit `288335e9` (RED) exists in git log — FOUND
- [x] Commit `536c5c9a` (GREEN) exists in git log — FOUND
- [x] `grep -c anchorLine src/ui/api/claude-session-api.ts` returns 0 — VERIFIED (43-03 lock preserved)
- [x] `grep -c "export function sendFetchOlder"` returns 1 — VERIFIED
- [x] `grep -c "export function isFetchOlderBatchEvent"` returns 1 — VERIFIED
- [x] `grep -c "fetch_older_batch"` returns 6 (>= 2) — VERIFIED
- [x] `grep -rn "sendFetchOlder\|isFetchOlderBatchEvent" src/ | grep -v claude-session-api` returns 0 — VERIFIED (no premature wiring)
- [x] 14/14 tests PASS under `npx vitest run src/ui/api/claude-session-api.test.ts` — VERIFIED
- [x] `npm run build` exit 0 — VERIFIED
- [x] `npm run build:backend` exit 0 — VERIFIED

---
*Phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio*
*Completed: 2026-08-18*
