---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
plan: 03
subsystem: backend/claude-session + frontend/api-types
tags: [plan-mode, ws-frame, sftp-side-channel, tmux-send-keys, ink, raw-keystrokes, trust-boundary]

# Dependency graph
requires:
  - phase: 24-01
    provides: "isPlanPending + parsePlanFilePath pure helpers on `./plan-pending-parser.js`"
  - phase: 24-02
    provides: "fetchPlanFile async SFTP side-channel + path validation on `../ssh/plan-file-fetch.js`"
provides:
  - "extended `plan_pending` WS frame: `{planFilePath, planContent, contentError}` (all nullable) or null"
  - "async SFTP fetch trigger inside the pane-scrape setInterval, gated per (pending-window, planFilePath) pair"
  - "per-window content cache + in-flight tracker that invalidates on pane teardown, session_changed clean-slate, AND on transition-to-closed of the pending window"
  - "stale-fetch fail-closed guard (`planPendingLastSerialized === 'null'` short-circuit in async .then())"
  - "new `raw_keystrokes` WS client→server handler that writes bytes via `tmux send-keys -l` in ONE call (no split)"
  - "trust-boundary enforcement on raw_keystrokes handler: uses connection-captured currentTmuxSession, IGNORES msg-supplied fields (T-14-02-01 pattern)"
  - "widened frontend `PlanPendingEvent` wire type + new `RawKeystrokesPayload` client-outbound type"
affects: [24-04-plan-pending-bubble-expansion, 24-05-composebox-plan-pending-disable-and-prettyview-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Immediate-presence-emit-then-async-refetch: setInterval scrape emits the presence frame first (content=null), fires async fetch, then re-emits with content or error using the SAME de-dup sentinel to collapse duplicates. Enables sub-100ms bubble mount while the SFTP roundtrip completes in the background."
    - "Per-(pending-window, planFilePath) fetch idempotency: pair the content Map with an in-flight Set so identical setInterval ticks don't refetch and don't race. Both cleared on window-close so the same slug reappearing after resolution IS treated as fresh (per CONTEXT § cache scope)."
    - "Fail-closed stale-fetch guard: after the pending window has been marked closed (sentinel === 'null'), any late-arriving .then() drops its result silently instead of retro-emitting stale content (T-24-03-03)."
    - "Trust-boundary handler for client-supplied keystrokes: mirror aside_dismissed shape verbatim — connection-captured pane binding, shellQuote'd payload, `-l` (literal) flag on tmux send-keys so `1`, `3`, `\\r`, or any other byte in the payload is never interpreted as a tmux key-name (T-14-02-01 / T-24-03-01)."

key-files:
  created: []
  modified:
    - "src/backend/claude-session/claude-session-server.ts (+177/-15) — WS-FRAMES docblock widened; imports parsePlanFilePath + fetchPlanFile; declared planPendingContentByPath Map + planPendingFetchInFlightForPath Set; teardownPane and session_changed clean-slate both clear the new caches; JSONL-scan emit (~L1461) widened to match; pane-scrape emit (~L3355) replaced with presence-emit-then-async-fetch flow; raw_keystrokes handler inserted adjacent to aside_dismissed"
    - "src/ui/api/claude-session-api.ts (+30/-1) — PlanPendingEvent widened to `{planFilePath|null, planContent|null, contentError|null}` inner shape; new RawKeystrokesPayload client→server type with trust-boundary docblock mirroring AsideDismissedPayload"

key-decisions:
  - "Do NOT trigger the async SFTP fetch from the JSONL-scan emit site (~L1461). The pane-scrape (~L3355) is the authoritative live signal per patch #63 dead-detection docblock; the JSONL scan is a resolution-edge fallback that will always emit `planContent: null`. Adding a fetch trigger there would create two racing fetch owners for the same pending window without any benefit (the pane-scrape catches up within one CONTEXT_PCT_INTERVAL_MS tick)."
  - "Cache the ERROR result (not just success) so that a persistent SFTP failure doesn't re-fire the fetch on every setInterval tick until the pending window closes. Prevents a slow-drift error loop on a broken plan-file (permissions, missing, etc.) while still allowing a fresh attempt when the same slug reappears after window-close (the transition-to-closed branch clears both caches)."
  - "Narrow `sshConn` to non-null via a local `activeSshConn` alias INSIDE the fetch trigger's if-guard, then capture that alias in the async closure. Prevents a TDZ-ish issue where the .then() would see the outer `sshConn` after teardownPane set it to null — the closure holds a live reference to the SSH Client that was valid at fetch-launch time. Late reads of null-out sshConn only matter for late-arriving .then() results, which are ALREADY guarded by the stale-fetch short-circuit."
  - "Skip the outbound-message union extension in claude-session-api.ts. No such union exists in that file (the file's only union is `ClaudeSessionServerEvent`, which is inbound-only despite RelayOutboundEvent living in it — 'outbound' there refers to Matrix, not client-outbound). Plan 04 send-sites will inline the RawKeystrokesPayload type at `wsRef.current?.send(JSON.stringify(...))`."
  - "Do NOT touch PrettyView.tsx's state shape in this plan. Its state currently declares `{planFilePath: string} | null` but receives the widened shape via `setPlanPending(parsed.pending)`. Because this repo's tsconfig has `strict: false` (both tsconfig.app.json and tsconfig.node.json), the assignment compiles cleanly. Plans 04/05 widen this state declaration when they wire the props through to PlanPendingBubble — that's the correct plan-boundary per PATTERNS.md."

patterns-established:
  - "Async fetch inside a scrape-emit-on-diff loop: guard the fetch launch with three predicates (has-path, not-cached, not-in-flight), tag the (path) as in-flight synchronously BEFORE awaiting anything, remove the tag in BOTH .then() and .catch() branches, and reuse the same JSON-stringify sentinel for the re-emit so back-to-back identical frames still collapse."
  - "Widen-shape-only for legacy emit sites: when extending a WS frame shape and an old code path (JSONL scan) still emits it, widen the OBJECT LITERAL to match the new shape (with the missing fields set to null) rather than deleting the old path or leaving the frame shape inconsistent across emit sources. Frontend receives a uniform frame shape regardless of which backend path fired it."

requirements-completed: []

# Metrics
duration: 10min
completed: 2026-08-04
---

# Phase 24 Plan 03: WS `plan_pending` widening + async SFTP fetch wire-up + `raw_keystrokes` handler Summary

**WS `plan_pending` frame extended in-place from bare-presence `{planFilePath: string}` to `{planFilePath, planContent, contentError}` (all nullable) with an immediate-emit-then-async-refetch flow that uses the Plan-02 SFTP side-channel, a per-(pending-window, planFilePath) content cache with a stale-fetch fail-closed guard, and a new `raw_keystrokes` WS handler that writes bytes to the PTY in one shot via `tmux send-keys -l` (never the ComposeBox split-send) using connection-captured `currentTmuxSession` per the aside_dismissed T-14-02-01 trust-boundary pattern.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-04T20:14:00Z (approximate — recorded post-hoc from execution flow)
- **Completed:** 2026-08-04T20:24:00Z
- **Tasks:** 2 (both auto, no TDD; wire-up + type widening)
- **Files modified:** 2

## Accomplishments
- Extended `plan_pending` WS frame shape at BOTH emit sites (pane-scrape at ~L3355, JSONL-scan fallback at ~L1461) to carry `{planFilePath, planContent, contentError}` — pane-scrape owns the fetch trigger and re-emit; JSONL-scan is widen-shape-only (content always null on that path).
- Wired async `fetchPlanFile(sshConn, planFilePath)` (Plan 02) into the pane-scrape emit: immediate presence-emit with `planContent: null`, then re-emit after the SFTP roundtrip with populated `planContent` OR `contentError`. Both emits reuse the existing `planPendingLastSerialized` sentinel so identical frames collapse.
- Added `planPendingContentByPath: Map<string, {content|null, error|null}>` + `planPendingFetchInFlightForPath: Set<string>` per-connection caches. Cleared on pane teardown (~L1121), session_changed clean-slate (~L1805), AND on transition-to-closed of the pending window inside the setInterval. Same slug reappearing after a resolved-and-cleared window refetches (per CONTEXT § "cache keyed by pending window, not global").
- Fail-closed stale-fetch guard: after the pending window closes mid-fetch (sentinel === "null"), any late-arriving .then() drops its result silently. Prevents retro-emit of stale content onto a window that Ashley already resolved via the pane keyboard directly (T-24-03-03).
- Errored fetches ARE cached (not just successes) so a persistent SFTP failure doesn't re-fire on every 3s setInterval tick. Cache still clears on window-close so the retry loop is one-per-window, not one-per-tick.
- New `raw_keystrokes` WS handler inserted adjacent to `aside_dismissed`, verbatim shape: null-guard sshConn + currentTmuxSession, coerce `bytes` from `unknown`, empty-payload short-circuit, `execCommand(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`)`, log-and-swallow on failure. IGNORES any msg-supplied hostId/tmuxSession fields (T-14-02-01 mitigation).
- WS FRAMES docblock (~L85) updated in-place: `plan_pending` line rewritten to document the widened shape; new client→server `raw_keystrokes` entry added inline as an indented sub-item so the docblock stays a single visual stanza.
- Frontend `PlanPendingEvent` widened to match. New `RawKeystrokesPayload` client→server type added adjacent to `AsideDismissedPayload` with a trust-boundary docblock that explicitly names the T-14-02-01 pattern reuse and the patch #67 split-send anti-pattern.

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend wire-up (imports, cache decls, teardown resets, JSONL-scan widen, pane-scrape widen + async fetch trigger, raw_keystrokes handler, docblock)** — `5425238` (feat)
2. **Task 2: Frontend widen PlanPendingEvent + add RawKeystrokesPayload** — `d015203` (feat)

**Plan metadata:** _(see final commit below in State Updates section)_

## Files Created/Modified
- `src/backend/claude-session/claude-session-server.ts` — WS-FRAMES docblock stanza widened for `plan_pending` + new `raw_keystrokes` entry; imports gained `parsePlanFilePath` (co-located with `isPlanPending`) and `fetchPlanFile` (new import from `../ssh/plan-file-fetch.js`); per-connection state declarations gained `planPendingContentByPath` Map + `planPendingFetchInFlightForPath` Set alongside `planPendingLastSerialized`; teardownPane's plan-pending clean-block and session_changed transition's clean-slate both `.clear()` the two new collections; JSONL-scan emit (~L1461) widened to `{planFilePath, planContent: null, contentError: null}` shape with a docblock explaining why it does NOT trigger the fetch (pane-scrape is authoritative); pane-scrape emit (~L3355) replaced with the presence-then-async-refetch flow — 4 new blocks (transition-to-closed cache invalidation, cached-content lookup + shaped emit, de-dup guard preserved, fetch launch with in-flight tag + .then() re-emit + .catch() error-cache); raw_keystrokes handler inserted adjacent to aside_dismissed with connection-captured trust-boundary + shellQuote + `tmux send-keys -l` + log-and-swallow-on-failure.
- `src/ui/api/claude-session-api.ts` — `PlanPendingEvent.pending` non-null shape widened from `{planFilePath: string}` to `{planFilePath: string | null, planContent: string | null, contentError: string | null}` with a docblock enumerating the four render states the widened frame implies (skip-middle-when-path-null, loading, error, content) so Plan 04's bubble consumer has an unambiguous contract; new `RawKeystrokesPayload` type added adjacent to `AsideDismissedPayload` with a trust-boundary docblock naming T-14-02-01 + the split-send anti-pattern.

## Decisions Made

See frontmatter `key-decisions` for the full list. Summary of load-bearing calls:

- **Fetch-trigger ownership:** pane-scrape owns; JSONL-scan is widen-shape-only. Prevents racing fetches on the same window.
- **Cache errors, not just successes:** prevents 3s error-retry loops; still allows one fresh attempt per new pending window.
- **`activeSshConn` closure capture:** local narrow-non-null before await, held by the .then() closure so a teardownPane racing with in-flight fetch is safe (stale-fetch guard also short-circuits the emit).
- **Skip outbound-message union in api.ts:** no such union exists; Plan 04 sites inline the type on send.
- **Do NOT widen PrettyView.tsx state:** deferred to Plan 04/05 per plan boundary + PATTERNS.md; tsc passes under `strict: false`.

## Deviations from Plan

None. Plan 03 executed exactly as written across both tasks. All plan-defined verify greps returned expected counts on the first attempt; `npx tsc --noEmit -p tsconfig.json` exited 0 after each task's edits.

The only judgment call was the "widen PrettyView.tsx state" question — the plan explicitly limits Task 2's scope to `src/ui/api/claude-session-api.ts` ("Do NOT touch any other types in this file"), so PrettyView.tsx stays untouched here. See Decisions above for the reasoning that this is not a Rule 1/2/3 auto-fix (tsc passes; state widening is Plan 04/05's job by design).

---

**Total deviations:** 0
**Impact on plan:** Plan executed exactly as written.

## Issues Encountered

None material. The dual-emit-site widening (JSONL-scan L1461 + pane-scrape L3355) required care to keep the JSONL-scan path a widen-shape-only edit — trivially the right call once the CONTEXT § "any residual JSONL scan" note was factored in, but worth calling out as the ONE point where a less-careful reader might have added a redundant second fetch trigger.

## Testing

**Existing suites regression-checked:**
- `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts src/backend/ssh/plan-file-fetch.test.ts` → **25/25 passing** (11 parser + 14 fetch cases from Plans 01 and 02 respectively). Confirms the wire-up doesn't perturb the pure-helper contracts it consumes.

**New tests for Plan 03 wiring:** intentionally deferred.

- No existing test infrastructure exists for the WS session server (`claude-session-server.ts` is 3745 lines with no companion test file); the plan's testing note explicitly said "if existing session-server test infrastructure is thin, at least unit-test any helpers extracted."
- Plan 03 extracted zero new helpers — all logic is inline dispatch/emit-mutation on the existing setInterval + message-dispatch chain. There is nothing to unit-test in isolation without standing up a WS+SSH+SFTP integration harness, which the plan explicitly warns against ("Don't try to boil the ocean on integration tests").
- The behavior IS covered by the composition of already-tested helpers: `isPlanPending` + `parsePlanFilePath` (Plan 01 suite proves the detection + extraction contracts) + `fetchPlanFile` (Plan 02 suite proves the SFTP + path validation contract). The wiring here is: "call isPlanPending → call parsePlanFilePath → construct frame → send → if pending, call fetchPlanFile → on resolve, construct + send follow-up." Each ingredient is independently verified; the wiring is thin glue.
- Plan 04 will exercise the frontend consumer path against a mock WS; Plan 05's PrettyView wire-up + human-verification tick will exercise the full round-trip against a real live pane.

**Type-check:** `npx tsc --noEmit -p tsconfig.json` → 0 errors, exit 0 (repo-wide, clean, both after Task 1 and after Task 2).

## Threat Flags

None. The two files modified stay entirely within the surface enumerated in Plan 03's `<threat_model>` (T-24-03-01 raw_keystrokes tampering — mitigated by connection-captured currentTmuxSession + shellQuote + `-l` literal flag; T-24-03-02 fetch flood — mitigated by planPendingFetchInFlightForPath in-flight Set + planPendingContentByPath cache; T-24-03-03 stale fetch — mitigated by `planPendingLastSerialized === "null"` short-circuit in async .then()). No new network endpoints, no new auth paths, no schema changes.

## Next Phase Readiness

- **Plan 04** (PlanPendingBubble expansion) can now consume the widened `PlanPendingEvent` from `claude-session-api.ts` — pass `planFilePath`/`planContent`/`contentError` through as props and wire the Approve/Feedback buttons to fire `wsRef.current?.send(JSON.stringify({type: "raw_keystrokes", bytes: "1\\r"} satisfies RawKeystrokesPayload))` shape frames.
- **Plan 05** (ComposeBox planPendingActive prop + PrettyView wire-up) will need to widen `PrettyView.tsx`'s `planPending` state declaration to match the new inner shape when it wires the props through — deferred here per plan boundary; tsc currently allows the narrow-state-holds-wide-value pattern under `strict: false`.
- No blockers for downstream plans.

## Self-Check: PASSED

- FOUND: `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` (modified; contains import of parsePlanFilePath + fetchPlanFile, raw_keystrokes dispatch, tmux send-keys -l -t, planPendingContentByPath declared and referenced 9 times).
- FOUND: `/home/ubuntu/skynet/src/ui/api/claude-session-api.ts` (modified; PlanPendingEvent widened with planContent + contentError, RawKeystrokesPayload exported).
- FOUND: commit `5425238` (feat(24-03): widen plan_pending WS frame + wire async SFTP fetch + raw_keystrokes handler).
- FOUND: commit `d015203` (feat(24-03): widen PlanPendingEvent + add RawKeystrokesPayload wire types).
- Confirmed: `git log --oneline -5` shows both commits at the tip of `feat/tab-title-from-tmux`.
- Confirmed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- Confirmed: `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts src/backend/ssh/plan-file-fetch.test.ts` → 25/25 passing.

---
*Phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl*
*Completed: 2026-08-04*
