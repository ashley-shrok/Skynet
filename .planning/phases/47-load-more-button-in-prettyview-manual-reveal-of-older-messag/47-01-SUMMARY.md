---
phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag
plan: 01
subsystem: api
tags: [pretty-view, wire-contract, jsonl-reader, phase-47, ssh, typescript, backend, frontend-types]

# Dependency graph
requires:
  - phase: 45-post-hydration-cap-cleanup
    provides: locked `fetch_older` / `fetch_older_batch` type names as FORBIDDEN (hydration-cap Test H at PrettyView.hydration-cap.test.tsx:614-688); Phase 47 wire-shape MUST pick a fresh name
provides:
  - FetchOlderRangePayload wire type (client -> server, line-cursor shape: beforeLine + count)
  - FetchOlderRangeBatchEvent wire type (server -> client, messages + oldestLine + hasMore + error?)
  - FetchOlderRangeBatchEvent membership in ClaudeSessionServerEvent discriminated union
  - SessionMetaEvent widened with optional totalLines?: number for load-more-button initial-visibility gating
  - Five per-turn wire frames widened with optional line?: number (MessageEvent, ImageEvent, RelayOutboundEvent, RelayInboundEvent, MalformedLineEvent)
  - readSessionFileRange backend helper (LOCAL fs.readFile / REMOTE sed+wc -l pipeline, file-local execWithTimeout + shellEscape)
affects: [phase-47-load-more-button-plan-02-LoadMoreOlderButton-component, phase-47-load-more-button-plan-03-server-handler, phase-47-load-more-button-plan-04-PrettyView-mount]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "line-cursor request shape (beforeLine + count) — server does ONE bounded readSessionFileRange call per request, NO cursor-search"
    - "additive-only wire-type widening — every existing type keeps its byte-shape-compatible required field set; new fields are all optional"
    - "sentinel-split SSH exec pipeline (sed range + printf '\\n---TOTAL---\\n' + wc -l) — one round-trip returns both the sliced lines and the total line count"
    - "LOCKED comment convention (`// LOCKED: type tag must NOT be ... — see Test H`) inline at every forbidden-name touchpoint so future refactors preserve the ban"
    - "file-local execWithTimeout + shellEscape (COPY-NOT-SHARE) — seventh file-local execWithTimeout in the backend; migration deferred until a share point emerges"

key-files:
  created:
    - src/backend/claude-session/session-file-range-reader.ts
  modified:
    - src/ui/api/claude-session-api.ts

key-decisions:
  - "Line-cursor request shape (beforeLine: number) over eventId-cursor. An eventId-cursor would require the server to scan the JSONL to find the matching line, contradicting the reader's 200-line hard cap and crashing on any session larger than 200 lines. The line-cursor shape lets the handler do exactly one bounded readSessionFileRange call per request."
  - "Wire type names: `fetch_older_range` (request) and `fetch_older_range_batch` (response). The Phase 43 names `fetch_older` and `fetch_older_batch` are locked-forbidden by PrettyView.hydration-cap.test.tsx Test H (L614-688). Inline `// LOCKED` comments preserve the ban survivability across future refactors."
  - "Server hard cap for count: 200 (10x the CONTEXT.md batch-size lock of 20). Locked in readSessionFileRange's input-validation gate; T-47-02 defense against a malicious/buggy caller asking for millions of lines."
  - "REMOTE range-read timeout: RANGE_READ_TIMEOUT_MS = 10_000 (10 seconds). identity-artifact-reader.ts uses 3s for its bounty scans; range reads potentially scan more of the file, so we widen to 10s. T-47-22 mitigation."
  - "totalLines?: number widening on SessionMetaEvent (rather than a hasOlder: boolean). The client owns the comparison against WORKING_SET_CAP (at PrettyView.tsx:97) so no coupling of the server to a client constant."
  - "line?: number on every per-turn wire frame (5 types). The client tracks oldestLoadedLine as the smallest line seen from streaming-tail hydration onward, then uses it as beforeLine for the first fetch. Optional in the type for backward-compat with older backend builds; the client MUST tolerate absence."
  - "execWithTimeout and shellEscape declared FILE-LOCAL in session-file-range-reader.ts (not imported). This is the seventh file-local execWithTimeout in the backend (5 in src/backend/database/routes/, 1 in identity-artifact-reader.ts:261, and this one); creating a share point in isolation would require touching all 6 sibling sites, deferred until an organic share point emerges."
  - "readSessionFileRange returns RAW lines (no parseSessionLine call). Caller (Plan 03's handleFetchOlderRange) decides parse policy — reader stays reusable if a future feature wants raw lines for a different reason."

patterns-established:
  - "Pattern: line-cursor over eventId-cursor for bounded-read wire contracts — the client sends a line-number derived from the newest thing it has already, and the server returns the requested slice with no cursor-search."
  - "Pattern: additive widening of an existing per-turn wire frame family — one new optional field spread across every alternate of a discriminated union, with a shared JSDoc reference to the phase's context doc."
  - "Pattern: sentinel-split SSH exec pipeline for bounded reads that need both a slice and a metadata scalar (line count, byte count, etc.) — sed range + printf sentinel + wc -l in one round-trip, split on the sentinel in the caller."
  - "Pattern: LOCKED inline comment at every forbidden-name touchpoint — pinning the ban survivability so a refactor authored years from now still sees the ban text next to the type declaration."

requirements-completed: []

# Metrics
duration: 10min
completed: 2026-08-20
---

# Phase 47 Plan 01: Load-more wire types + JSONL range reader Summary

**Shared foundations for Phase 47 load-more button — new wire types (`fetch_older_range` / `fetch_older_range_batch`) with line-cursor semantics, additive widening of SessionMetaEvent + five per-turn frames, and a new backend helper `readSessionFileRange` that reads a bounded JSONL slice via a sentinel-split SSH exec pipeline (or `fs.readFile` on the LOCAL branch).**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-20T02:11:21Z
- **Completed:** 2026-08-20T02:21:27Z
- **Tasks:** 2
- **Files modified:** 1 (`src/ui/api/claude-session-api.ts`)
- **Files created:** 1 (`src/backend/claude-session/session-file-range-reader.ts`)

## Accomplishments

- Frontend/backend wire contract for Phase 47's load-more click flow ships type-clean on both sides (`npx tsc --noEmit` = 0 exit; `npm run build:backend` = 0 exit). Plans 03 (backend handler) and 04 (frontend integration) can now consume this contract in parallel.
- Cursor-search is architecturally impossible in the new wire shape: the request carries `beforeLine: number`, so the handler does exactly one bounded `readSessionFileRange` call and never scans the JSONL to resolve an eventId → line mapping. This eliminates the class of bugs that would have crashed on sessions > 200 lines.
- Phase 45 Test H's forbidden-name lock (`"fetch_older"` and `"fetch_older_batch"`) is preserved verbatim: zero occurrences of either literal in non-comment code in `claude-session-api.ts`, plus inline `// LOCKED` comments at every type-tag declaration so future refactors see the ban next to the type.

## Task Commits

Each task was committed atomically:

1. **Task 1: extend `claude-session-api.ts` with Phase 47 wire types** — `1533c2bb` (feat)
2. **Task 2: create `session-file-range-reader.ts` with LOCAL/REMOTE JSONL slice reader** — `c76f5772` (feat)

## Files Created/Modified

- `src/ui/api/claude-session-api.ts` (modified, +158 / -1)
  - `SessionMetaEvent` widened with `totalLines?: number` (Change A) — client compares against WORKING_SET_CAP for the button's initial visibility.
  - Five per-turn wire frames widened with `line?: number` (Change E, applied to `MessageEvent`, `ImageEvent`, `RelayOutboundEvent`, `RelayInboundEvent`, `MalformedLineEvent`) — client tracks `oldestLoadedLine` from streaming-tail hydration onward.
  - `FetchOlderRangePayload` new exported type (Change B) — client → server request, line-cursor shape (`beforeLine: number`, `count: number`).
  - `FetchOlderRangeBatchEvent` new exported type (Change C) — server → client response, carrying the bounded `messages[]` batch plus `oldestLine` / `hasMore` / `error?`.
  - `FetchOlderRangeBatchEvent` added to the `ClaudeSessionServerEvent` discriminated union (Change D).
  - The single removed line (`| MalformedLineEvent;` → `| MalformedLineEvent`) is a semicolon-migration, not a type-set narrowing — the trailing `;` moved to the new last alternate.
- `src/backend/claude-session/session-file-range-reader.ts` (created, +242)
  - `readSessionFileRange(conn, path, startLine, count)` — exported helper returning `{ lines, totalLines }`.
  - LOCAL branch (`conn === null`): `fs.readFile` + slice; ENOENT returns `{ lines: [], totalLines: 0 }` (mirrors `readIdentityFile` L332 posture).
  - REMOTE branch: `sed -n 'A,Bp' <path> && printf '\n---TOTAL---\n' && wc -l < <path>` in one exec pipeline, sentinel-split; missing sentinel returns empty response.
  - File-local `execWithTimeout` (Promise.race around `execCommand` from `tmux-helper.ts`) with `RANGE_READ_TIMEOUT_MS = 10_000` for T-47-22.
  - File-local `shellEscape` verbatim from `session-file-tail.ts:27-29`; invoked twice at each path interpolation (grep-visible defense-in-depth per T-47-01).
  - Input validation gate: `startLine >= 1`, `count in [1, 200]` (T-47-02 hard cap).

## Decisions Made

See the frontmatter `key-decisions` for the eight design decisions locked in this plan. Highlights:

1. **Line-cursor over eventId-cursor** (revised after checker feedback captured in the plan). Eliminates any server-side cursor-search that would contradict the 200-line hard cap.
2. **Wire type name lock** (`fetch_older_range` + `fetch_older_range_batch`). Preserves Phase 45's Test H forbidden-name gate with inline `// LOCKED` comments.
3. **Server hard cap `count <= 200`.** 10x the CONTEXT.md batch-size lock of 20.
4. **`totalLines?: number` (not `hasOlder: boolean`) on `SessionMetaEvent`.** Client owns the cap comparison; server does not depend on a client constant.
5. **`line?: number` on every per-turn wire frame** (5 types). Client tracks `oldestLoadedLine` forward-only from streaming-tail hydration.
6. **File-local `execWithTimeout` + `shellEscape`.** Follows the six sibling file-local copies convention; deferred share-point creation until it emerges organically.
7. **Reader returns raw lines** (no parse). Caller decides parse policy.
8. **10-second RANGE_READ_TIMEOUT_MS** (identity-artifact-reader.ts uses 3s; range reads can scan more file, warranting the widening; T-47-22 mitigation).

## Deviations from Plan

None substantive. Two minor implementation notes:

1. **`shellEscape` call-site count discipline.** The initial implementation extracted `const escapedPath = shellEscape(sessionFilePath)` and reused it twice in the command-string construction. This satisfied the SEMANTIC intent of acceptance criterion 9 ("both the sed path arg and the wc -l path arg go through shellEscape") but only produced ONE literal call site to `shellEscape(...)`. To satisfy the acceptance criterion's grep-count intent (>= 2 call sites) as well as documenting the T-47-01 defense-in-depth at every use point, the extracted variable was inlined into two explicit call sites. Net grep count now 4 (function declaration at L90 + JSDoc reference at L197 + two call sites at L208 and L210).

2. **`session-file-range-reader.ts` intentionally references `session-file-tail.ts` in its JSDoc** (3 mentions in comments citing the `shellEscape` copy-not-share precedent). Acceptance criterion 10 says "No import from session-file-tail.ts" — verified via `grep -cE "^import.*session-file-tail" ... = 0`. The doc-only mentions are the semantic intent (documenting the precedent) and do not constitute an import.

## Threat Flags

None. All new attack surface is covered by the plan's existing `<threat_model>` register (T-47-01 through T-47-22). Specifically:

- T-47-01 (Tampering, REMOTE-branch command construction): `shellEscape(sessionFilePath)` called at both path interpolations in the sed + wc -l pipeline.
- T-47-02 (DoS, unbounded `count`): `count > 200` throws before any I/O.
- T-47-03 (DoS, unbounded `startLine`): `startLine < 1` throws; `startLine > totalLines` returns empty naturally (sed clamps).
- T-47-04 (Info Disclosure, error strings): reader throws short, generic messages (e.g. `"session-file-range-reader: invalid range {\"startLine\":0,\"count\":20}"`); no stack traces or PII.
- T-47-05 (Tampering, wire-name reintroduction): grep-gated forbidden-name assertion (`grep -v '^\\s*\\(//\\|\\*\\|/\\*\\)' ... | grep -cE '"fetch_older"|"fetch_older_batch"' = 0`) preserves the Phase 45 Test H lock.
- T-47-22 (DoS, hung remote sed): `RANGE_READ_TIMEOUT_MS = 10_000` racing via `Promise.race`.

## Issues Encountered

**Worktree branch-base mismatch (spawn-time).** The worktree's per-agent branch (`worktree-agent-af00937f91e34966a`) was created off commit `2d5da043` (upstream v2.3.x tip) rather than off `feat/tab-title-from-tmux` where the Phase 47 plan artifacts and pretty-view codebase live. Recovery: `git reset --hard feat/tab-title-from-tmux` on the per-agent branch (safe — zero unique commits on the per-agent branch before the reset, verified via `git log worktree-agent-af00937f91e34966a --not feat/tab-title-from-tmux --oneline` = empty). Post-reset the worktree matched the intended base; execution proceeded normally. Root cause is in the orchestrator's worktree-spawn logic (should use the feature branch as base, not the main branch); reported here for the orchestrator to address in a future fix.

## Verification (final)

- `npx tsc --noEmit` → exit 0 (frontend TypeScript clean).
- `npm run build:backend` → exit 0 (backend TypeScript clean; CLAUDE.md standing directive — `tsc --noEmit` alone insufficient for backend TS).
- `grep -c 'FetchOlderRangePayload' src/ui/api/claude-session-api.ts` = 4 (definition + JSDoc references).
- `grep -c 'FetchOlderRangeBatchEvent' src/ui/api/claude-session-api.ts` = 2 (definition + union inclusion).
- `grep -c 'totalLines?:' src/ui/api/claude-session-api.ts` = 1 (SessionMetaEvent widening).
- `grep -c 'line?: number' src/ui/api/claude-session-api.ts` = 7 (5 field declarations + 2 JSDoc lines).
- `grep -c 'hasOlder' src/ui/api/claude-session-api.ts` = 0 (no lingering references to the pre-revision draft's field name).
- `grep -v '^\\s*\\(//\\|\\*\\|/\\*\\)' src/ui/api/claude-session-api.ts | grep -cE '"fetch_older"|"fetch_older_batch"'` = 0 (Phase 45 Test H forbidden-name lock preserved).
- `grep -c '^export async function readSessionFileRange' src/backend/claude-session/session-file-range-reader.ts` = 1.
- `grep -c '^async function execWithTimeout' src/backend/claude-session/session-file-range-reader.ts` = 1 (file-local).
- `grep -c '^function shellEscape' src/backend/claude-session/session-file-range-reader.ts` = 1 (file-local).
- `grep -c 'RANGE_READ_TIMEOUT_MS = 10_000' src/backend/claude-session/session-file-range-reader.ts` = 1.
- `grep -cE '^import.*execWithTimeout|^import.*shellEscape' src/backend/claude-session/session-file-range-reader.ts` = 0 (neither helper imported from anywhere).
- `grep -cE '^import.*session-file-tail' src/backend/claude-session/session-file-range-reader.ts` = 0 (no import of the sibling with the shellEscape origin; doc-only references OK).

## User Setup Required

None — this plan lands types + a helper module only. No new environment variables, no new HTTP routes (all traffic remains on the existing `/claude-session/websocket/` WS path per CLAUDE.md nginx-caveat check), no new external services. Container deploy is deferred to the orchestrator after Wave 2 completes.

## Next Phase Readiness

- Wave 2 plans (03 backend handler, 04 frontend integration) are unblocked. Both can import from `src/backend/claude-session/session-file-range-reader.ts` and `src/ui/api/claude-session-api.ts` respectively against a stable, tsc-clean contract.
- Plan 02 (the LoadMoreOlderButton component, executing in parallel on a sibling worktree during Wave 1) has no dependency on this plan's outputs and will land independently.
- No blockers or open questions handed to Wave 2.

## Self-Check: PASSED

- File `src/ui/api/claude-session-api.ts` exists in the worktree: FOUND.
- File `src/backend/claude-session/session-file-range-reader.ts` exists in the worktree: FOUND.
- Commit `1533c2bb` present in `git log --all --oneline`: FOUND.
- Commit `c76f5772` present in `git log --all --oneline`: FOUND.

---
*Phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag*
*Plan: 01*
*Completed: 2026-08-20*
