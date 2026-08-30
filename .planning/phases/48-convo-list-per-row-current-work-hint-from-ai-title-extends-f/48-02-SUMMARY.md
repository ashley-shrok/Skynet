---
phase: 47-convo-list-per-row-current-work-hint-from-ai-title-extends-f
plan: 02
subsystem: backend/database/routes/sessions.ts (dormant /sessions/list REST) + backend/fleet-status/ssh-poll-orchestrator.ts (live WS publish)
tags: [backend, ai-title, jsonl-scraper, sessions-list, ssh-poll-orchestrator, wire-emit, fingerprint-axis, tail-width-bump]
requires:
  - Phase 48 Plan 01 (wire-type surface — SessionState + RemoteTmuxSession + FleetSession all carry optional nullable aiTitle; consumed as-is here)
  - Phase 44 Plan 01 (mirror-source for the /sessions/list route dispatch shape — recencySignalsBlock evolved from Phase 44's lastMessageAtBlock)
  - Phase 44 Plan 02 (mirror-source for the orchestrator processPid pipeline + PidCacheEntry cache shape + shared jsonlPath discovery)
  - Phase 32 discoverIdentitySessionFile mechanism (already consumed by both backend read paths — untouched here)
provides:
  - "/sessions/list route emits `aiTitle: string | null` on every TmuxSessionRow — LAST occurrence of `{\"type\":\"ai-title\",\"aiTitle\":\"…\",\"sessionId\":\"…\"}` in the discovered JSONL's tail (or null on any failure path)"
  - "ssh-poll-orchestrator publishes `SessionState.aiTitle` on every WS frame — derived from the SAME per-PID cached JSONL tail-read that feeds lastMessageAt (ONE exec, TWO scans, ZERO duplicate discovery)"
  - "computeFingerprint includes aiTitle as a distinct 6th axis so a topic-drift-only change (ai-title differs, everything else identical) STILL triggers publishSessionState"
  - "Tail width bumped from `tail -n 200` (line-count) to `tail -c 262144` (256KB byte-count) on BOTH backend read paths — captures ai-title lines older than the last ~200 message-bearing lines"
  - "PidCacheEntry gains `aiTitle: string | null` — passenger on the same jsonlPath cache Phase 44 Plan 02 owns; no independent stale-tick counter"
  - "New scanTailForLatestAiTitle helper in BOTH backend files (hand-mirrored per 48-CONTEXT.md 'no new shared module' scope decision inherited from Phase 43/44)"
  - "Per-row failure isolation preserved on BOTH paths — sessions.ts wraps in Promise.race(PER_HOST_TIMEOUT_MS); orchestrator inherits jsonlPath cache invalidation from Phase 44 Plan 02"
affects:
  - src/backend/database/routes/sessions.ts (interface + helper + row-init + consolidated recencySignalsBlock with tail-c-262144 shared buffer)
  - src/backend/database/routes/sessions.test.ts (jsonlAiTitleLine fixture + 7 new tests in Phase 48 Plan 02 describe + aiTitle assertions on 10 pre-existing tests)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (PidCacheEntry field + AI_TITLE_LINE_PREFIX + scanTailForLatestAiTitle helper + processPid derivation + SessionState composition + fingerprint 6th axis + 2 livenessMap.set sites + tail width bump)
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts (jsonlAiTitleLine fixture + 6 new tests in Phase 48 Plan 02 describe + tail-n-200 → tail-c-262144 in 5 assertions + aiTitle assertions on pre-existing Test G/I/J/K)
tech-stack:
  added: []
  patterns:
    - "OPTION A tail consolidation: one discoverIdentitySessionFile call + one tail exec → BOTH scanTailForNewestMessageAt AND scanTailForLatestAiTitle run over the same buffer (no duplicate I/O per row)"
    - "Substring pre-filter + in-process JSON.parse pattern (not `jq` shell subprocess) — matches Phase 44 Plan 01's scanTailForNewestMessageAt / parseSessionLine shape; module-scope AI_TITLE_LINE_PREFIX constant in the orchestrator holds the substring for grep-ability"
    - "Fingerprint axis addition: 6th axis appended (`|${state.aiTitle ?? ''}`) with same null-normalization as lastMessageAt so a first-time null publish is distinguishable from unpopulated cache entries"
    - "Last-wins reconciliation for aiTitle (distinct from lastMessageAt's max-wins) — fresh non-null scan overwrites cache; scan returning null preserves cache (fail-open on transient SSH hiccup)"
    - "Passenger-on-shared-cache pattern: PidCacheEntry.aiTitle rides on the jsonlPath cache Phase 44 Plan 02 owns; no independent stale-tick counter (aiTitle inherits invalidation via shared cached path)"
    - "Hand-mirrored helper across two backend read paths (scanTailForLatestAiTitle in sessions.ts + ssh-poll-orchestrator.ts) — CONTEXT.md 'no new shared module' scope decision inherited from Phase 43/44"
    - "Tail-width bump as a load-bearing architecture change: `tail -n 200` (line-count) → `tail -c 262144` (256KB byte-count) so an ai-title line older than the last ~200 message-bearing lines is still captured; symmetric across both backend files"
key-files:
  created: []
  modified:
    - src/backend/database/routes/sessions.ts
    - src/backend/database/routes/sessions.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - "OPTION A (consolidated tail read) chosen over OPTION B (two parallel tail execs) per 48-02-PLAN.md Task 1 <action>: sessions.ts's lastMessageAtBlock was renamed to recencySignalsBlock, discovery + tail happen ONCE per row, BOTH scanners consume the same buffer, single catch wipes both signals on failure. Operation string renamed `sessions_list_last_message_at_skip` → `sessions_list_recency_signals_skip` to reflect the consolidated scope."
  - "Tail width bumped from `tail -n 200` (line-count) to `tail -c 262144` (256KB byte-count) on BOTH backend read paths per 48-CONTEXT.md § Backend scraper mechanics. Rationale: ai-title lines may be older than the last 200 message-bearing lines (topic-drift markers can precede many turns), so a line-count bound risks missing them. The two backend read paths stay aligned on the same tail shape so behavior is symmetric across dormant REST + live WS."
  - "scanTailForLatestAiTitle uses in-process JSON.parse (NOT `jq` shell subprocess) — matches the parseSessionLine in-process pattern the Phase 44 Plan 01 scanner uses. Cheaper (one shell exec instead of jq subprocess) and consistent with the surrounding scanTailForNewestMessageAt. The 48-CONTEXT.md shell pipeline `jq -r '.aiTitle // empty'` was one implementation option; in-process was chosen for perf + consistency."
  - "AI_TITLE_LINE_PREFIX module-scope constant in ssh-poll-orchestrator.ts holds the substring `\"type\":\"ai-title\"` for the cheap pre-filter (avoids JSON.parse on every message-bearing line). Not extracted to a shared module — CONTEXT.md § domain scope decision inherits from Phase 43's 'no new shared module' rule (hand-mirrored across the two backend files instead)."
  - "aiTitle in PidCacheEntry rides on the SAME jsonlPath cache Phase 44 Plan 02 owns — no independent stale-tick counter. Rationale: the STALE_TAIL_REDISCOVERY_THRESHOLD was designed as a rotation-defense for lastMessageAt (fresh tail failing to advance a NON-NULL cached value → rediscover); the ai-title signal inherits this invalidation for free because both scans consume the same cached path. If the JSONL rotates and the cache invalidates, the next discovery + scan picks up the new aiTitle too."
  - "Last-wins reconciliation for aiTitle in the orchestrator's tail-scan branch: `if (scannedAiTitle !== null) { derivedAiTitle = scannedAiTitle; }`. Non-null scan overwrites cache; null scan preserves cache. Matches lastMessageAt's fail-open semantics on transient SSH hiccups. A truly-no-ai-title session's cache starts at null and stays null forever (Test 3 lock in the orchestrator + Test 4 lock in sessions.ts)."
  - "computeFingerprint appends aiTitle as the 6th and last axis to preserve deterministic ordering (status | waitingFor | bgKey | updatedAt | lastMessageAt | aiTitle). Null-normalization to `\"\"` matches lastMessageAt so first-time null publish is distinguishable from an unpopulated cache entry."
  - "aiTitle assertions extended onto ALL pre-existing tests in both test files (10 in sessions.test.ts, plus Test G/I/J/K + K in orchestrator.test.ts) — locks the 'server always emits aiTitle on every row/frame' contract as a pinch-point invariant. Contract lock explicit in sessions.test.ts Test 7 and asserted via `expect('aiTitle' in row).toBe(true)` for every row in the response."
metrics:
  duration: ~35min (Task 1 RED+GREEN + Task 2 RED+GREEN + full-suite verification)
  completed: 2026-08-20
---

# Phase 48 Plan 02: Backend JSONL scraper on BOTH read paths — Summary

Land the backend scraper for the Phase 48 ai-title signal on BOTH backend read paths — the dormant `/sessions/list` REST route and the live ssh-poll-orchestrator WS publish path — mirroring the architecture Phase 44 established for `lastMessageAt`. The `/sessions/list` route consolidates the Phase 43 lastMessageAtBlock with the new aiTitle derivation into a single tail read (OPTION A: one discovery + one `tail -c 262144` feeds BOTH scans). The orchestrator publishes aiTitle on every SessionState frame with fingerprint-based delta semantics — an ai-title-only change is now a publish-trigger. Failure isolation, cache invalidation, and stale-tick semantics preserved verbatim from Phase 44.

## What Landed

### Task 1 — `/sessions/list` route with per-session aiTitle derivation

**`src/backend/database/routes/sessions.ts`:**
- `TmuxSessionRow` interface gained `aiTitle: string | null;` (required-on-server, null-when-unknown — matches Phase 44 Plan 01's invariant for lastMessageAt).
- New module-scope helper `scanTailForLatestAiTitle(tailContents: string): string | null` after `scanTailForNewestMessageAt`:
  - Substring pre-filter `line.includes('"type":"ai-title"')` before JSON.parse (cheap avoidance of parsing every message line).
  - In-process `JSON.parse(line)` then typeof check on the aiTitle field (`typeof === "string"`).
  - Sticky `latest` variable updates on every valid match → returns the LAST match in file order (last-wins per CONTEXT.md § working-store third axis — topic drifts across a session).
  - Malformed JSON, missing field, wrong-type value → silently skipped (best-effort sampling, not validation).
- Row-init object gained `aiTitle: null as string | null` alongside `lastMessageAt: null as number | null`.
- **OPTION A tail consolidation**: the pre-existing `lastMessageAtBlock` was renamed to `recencySignalsBlock` and refactored to run ONE discovery + ONE tail read → BOTH `scanTailForNewestMessageAt` AND `scanTailForLatestAiTitle` consume the same buffer. Tail width bumped from `tail -n 200` to `tail -c 262144` (256KB) per 48-CONTEXT.md § Backend scraper mechanics.
- The `Promise.race` inner-body now returns `{ lastMessageAt: number | null; aiTitle: string | null; }`; on any failure path (discovery null, tail empty, timeout, throw) the outer catch block wipes BOTH signals via `row.lastMessageAt = null; row.aiTitle = null;` and logs `operation: "sessions_list_recency_signals_skip"` (renamed from `sessions_list_last_message_at_skip` to reflect consolidated scope).

**`src/backend/database/routes/sessions.test.ts`:**
- New fixture helper `jsonlAiTitleLine(sessionId: string, aiTitle: string): string` emits the `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` line shape (48-CONTEXT.md § Backend scraper mechanics).
- New `describe("GET /sessions/list — aiTitle derivation (Phase 48 Plan 02)", ...)` block with 7 tests:
  - **Test 1 (happy path)**: single ai-title line in tail → `row.aiTitle === "Fix bug X"`.
  - **Test 2 (last-wins)**: three ai-title lines at different points in the tail → row's aiTitle equals the LAST one in file order (`"Reviewing test coverage"`).
  - **Test 3 (discovery-null cascade)**: one row has discovery + ai-title, sibling has discovery null → sibling `aiTitle: null`, first row keeps its string; no cross-row leakage.
  - **Test 4 (no ai-title lines)**: tail has messages + tool_use only → `aiTitle: null` on row with successful discovery.
  - **Test 5 (malformed JSON)**: three lines matching `"type":"ai-title"` substring but each fails validation (unparseable, missing aiTitle field, wrong-type value) → `aiTitle: null`, no throw.
  - **Test 6 (timeout)**: discovery hangs → `Promise.race(PER_HOST_TIMEOUT_MS)` trips → row `aiTitle: null`; sibling row's discovery succeeded → sibling `aiTitle: "Debugging websocket"`; response bounded < 8s.
  - **Test 7 (contract lock)**: every row in the response has `"aiTitle" in row === true` and the value is `null` when discovery returns null. Locks the server-always-emits invariant.
- All 10 pre-existing tests (4 role-resolution + 6 Phase 43 Plan 01 lastMessageAt) extended with aiTitle presence assertions.
- Test count: **17/17 pass** (was 10/10 pre-plan → +7 new tests).

### Task 2 — ssh-poll-orchestrator publishes aiTitle on every SessionState frame

**`src/backend/fleet-status/ssh-poll-orchestrator.ts`:**
- `PidCacheEntry` gained `aiTitle: string | null` field with a load-bearing docblock explaining: (a) passenger on shared jsonlPath cache — no independent stale-tick counter, (b) last-wins semantics, (c) publishes iff computeFingerprint sees a change.
- New module-scope constant `AI_TITLE_LINE_PREFIX = '"type":"ai-title"'` for the substring pre-filter.
- New module-scope helper `scanTailForLatestAiTitle(tailContents: string): string | null` (hand-mirrored from sessions.ts per Phase 43/44 "no new shared module" scope decision — the two backend read paths keep local copies).
- In `processPid`:
  - Tail command bumped from `tail -n 200 ${jsonlPath} ...` to `tail -c 262144 ${jsonlPath} ...`. Docblock at the swap site cites 48-CONTEXT.md § Backend scraper mechanics.
  - AFTER the existing `scanned = scanTailForNewestMessageAt(tailRaw)`, added `scannedAiTitle = scanTailForLatestAiTitle(tailRaw)` — reuses the SAME `tailRaw` buffer, no duplicate exec.
  - Last-wins reconciliation branch: `if (scannedAiTitle !== null) { derivedAiTitle = scannedAiTitle; }`. Preserves cache when scan returns null (fail-open on transient SSH hiccup).
- `SessionState` composition gained `aiTitle: derivedAiTitle,` after `lastMessageAt: derivedLastMessageAt,`. Comment above cites Phase 48 Plan 02 + last-wins semantics.
- `computeFingerprint` return string extended: `...|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}`. Docblock addition explains aiTitle as a distinct 6th axis with same null-normalization pattern as lastMessageAt.
- Both `livenessMap.set(...)` sites (initial publish + non-publish-updates) extended with `aiTitle: derivedAiTitle,` alongside the lastMessageAt fields.
- Old `tail -n 200` reference in the docblocks fully retired — three comments updated to reference the new `tail -c 262144` shape.

**`src/backend/fleet-status/ssh-poll-orchestrator.test.ts`:**
- New fixture helper `jsonlAiTitleLine(sessionId: string, aiTitle: string): string` (hand-mirrored from sessions.test.ts).
- All 5 pre-existing `channel.countCallsMatching("tail -n 200")` assertions updated to `channel.countCallsMatching("tail -c 262144")` + a corresponding `expect(channel.countCallsMatching("tail -n 200")).toBe(0)` guard to lock the retirement.
- Pre-existing Phase 44 Plan 02 tests G/I/J/K extended with `expect(p.state.aiTitle).toBeNull()` assertions (no ai-title lines in those fixtures).
- New `describe("Phase 48 Plan 02 — aiTitle derivation and publish", ...)` block with 6 tests:
  - **Test 1 (happy path)**: single ai-title line + messages → published `state.aiTitle === "Auth refactor"`.
  - **Test 2 (last-wins)**: three ai-title lines with intervening messages → published aiTitle equals the LAST one (`"Final topic wins"`).
  - **Test 3 (no ai-title in tail)**: messages only, no ai-title → `state.aiTitle === null`; corroborates with `lastMessageAt === 2000` (proves both scans ran over the same buffer).
  - **Test 4 (discovery null)**: badDiscovery fixture with mismatched identity → `discoverIdentityJsonlPathViaChannel` returns null → tail skipped → aiTitle stays null; `countCallsMatching("tail -c 262144") === 0`.
  - **Test 5 (aiTitle-change publish trigger — LOAD-BEARING)**: tick 1 publishes aiTitle="Topic A"; tick 2 has SAME lastMessageAt, SAME status, SAME backgroundTasks, SAME updatedAt, but DIFFERENT aiTitle ("Topic B (drifted)"); publish count MUST increase from tick 1 → tick 2 (fingerprint change on aiTitle alone). This locks the fingerprint 6th-axis addition.
  - **Test 6 (cache preserves across ticks)**: tick 1 publishes "Original topic"; tick 2 identical tail → NO new publish (fingerprint unchanged, cache preserved); tick 3 appends new ai-title → last-wins picks it up → new publish with "Fresh topic".
- Test count: **32/32 pass** (was 26 pre-plan → 26 pre-existing (some updated) + 6 new = 32).

## Verification Results

- `npx vitest run src/backend/database/routes/sessions.test.ts` — **17/17 pass** (10 pre-existing + 7 new Phase 48 Plan 02 tests).
- `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — **32/32 pass** (26 pre-existing (5 updated for tail-c-262144 + 3 for aiTitle-null) + 6 new Phase 48 Plan 02 tests).
- `npx vitest run src/backend/fleet-status/` — **10 files, 141 tests, all pass** (was 130 pre-plan → +6 new = 141 with pre-existing tests still green).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0.
- **Full-suite `npx vitest run` — 198 files / 2591 pass / 9 skipped / 1 todo / 1 failed. Duration 980s.** The 1 failed test is `src/ui/features/pretty-view/pickers/VoicePicker.test.tsx` — a frontend UI picker test with no dependency on Phase 48 Plan 02's backend changes. Passes cleanly in isolation (`npx vitest run src/ui/features/pretty-view/pickers/VoicePicker.test.tsx` → 7/7 pass, 13.31s). This is the same pre-existing timing-flake pattern documented in Phase 44 Plan 02 SUMMARY.md § Issues Encountered (UI test timeouts under CPU contention that pass in isolation).

## Acceptance Criteria Grep Verification

### Task 1 (sessions.ts + sessions.test.ts)

| Criterion | Target | Actual |
|---|---|---|
| `grep -c 'aiTitle' src/backend/database/routes/sessions.ts` | >= 5 | 19 ✓ |
| `grep -n 'function scanTailForLatestAiTitle' src/backend/database/routes/sessions.ts` | == 1 | 1 (L84) ✓ |
| `grep -A 15 'interface TmuxSessionRow' src/backend/database/routes/sessions.ts \| grep -c 'aiTitle: string \| null'` | >= 1 | 1 ✓ |
| `grep -c '"type":"ai-title"' src/backend/database/routes/sessions.ts` | >= 1 | 2 ✓ |
| `grep -c 'aiTitle' src/backend/database/routes/sessions.test.ts` | >= 14 | 71 ✓ |
| `grep -c 'describe.*Phase 48 Plan 02' src/backend/database/routes/sessions.test.ts` | >= 1 | 1 ✓ |
| `grep -c 'jsonlAiTitleLine' src/backend/database/routes/sessions.test.ts` | >= 4 | 7 ✓ |
| `npx vitest run src/backend/database/routes/sessions.test.ts` | exit 0 (17/17) | exit 0 (17/17) ✓ |
| `npm run build:backend` | exit 0 | exit 0 ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |
| `grep -c 'as any\|@ts-expect-error' src/backend/database/routes/sessions.{ts,test.ts}` | == 0 | 0 ✓ |
| `grep -n 'Promise.race' src/backend/database/routes/sessions.ts \| wc -l` | >= 2 | 4 ✓ (outer host + roleResolveBlock + recencySignalsBlock inner race + outer wrap) |

### Task 2 (ssh-poll-orchestrator.ts + ssh-poll-orchestrator.test.ts)

| Criterion | Target | Actual |
|---|---|---|
| `grep -c 'aiTitle' src/backend/fleet-status/ssh-poll-orchestrator.ts` | >= 8 | 15 ✓ |
| `grep -n 'function scanTailForLatestAiTitle' src/backend/fleet-status/ssh-poll-orchestrator.ts` | == 1 | 1 (L288) ✓ |
| `grep -Fc 'state.aiTitle' src/backend/fleet-status/ssh-poll-orchestrator.ts` | >= 1 | 1 ✓ (fingerprint axis) |
| `grep -Fc 'aiTitle: derivedAiTitle' src/backend/fleet-status/ssh-poll-orchestrator.ts` | >= 3 | 3 ✓ (state composition + 2 livenessMap.set sites) |
| `grep -Fc 'tail -c 262144' src/backend/fleet-status/ssh-poll-orchestrator.ts` | >= 1 | 4 ✓ (1 exec + 3 doc/comment refs) |
| `grep -Fc 'tail -n 200' src/backend/fleet-status/ssh-poll-orchestrator.ts` | == 0 | 0 ✓ (all doc refs updated to the new shape) |
| `grep -c 'aiTitle' src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | >= 10 | 43 ✓ |
| `grep -c 'describe.*Phase 48 Plan 02' src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | >= 1 | 1 ✓ |
| `grep -c 'jsonlAiTitleLine' src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | >= 4 | 12 ✓ |
| `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | exit 0 (32/32) | exit 0 (32/32) ✓ |
| `npx vitest run src/backend/fleet-status/` | exit 0 (~130+6 tests) | exit 0 (141/141) ✓ |
| `npm run build:backend` | exit 0 | exit 0 ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |
| `grep -c 'as any\|@ts-expect-error' src/backend/fleet-status/ssh-poll-orchestrator.{ts,test.ts}` | == 0 | 0 ✓ |

## Deviations from Plan

**None.** Plan executed exactly as written. Both tasks landed OPTION A tail consolidation, both tests describe blocks landed with the exact test counts specified, no auto-fix scope invoked, no architectural decisions surfaced, no auth gates.

Minor implementation choices worth noting (not deviations):

1. **Old `tail -n 200` references in docblocks scrubbed** — three comments in ssh-poll-orchestrator.ts still referenced the historical shape in a purely descriptive context. The acceptance criterion `grep -Fc 'tail -n 200' == 0` was strict, so all three comments were rephrased to reference the new `tail -c 262144` shape (e.g. "Phase 48 Plan 02: `tail -c 262144`" instead of "`tail -n 200` bumped to `tail -c 262144`"). No semantic change, just satisfies the grep spec strictly.

2. **`Promise.race` count in sessions.ts = 4** (not the plan's suggested "may be 2"). The count reflects the pre-existing per-block races: the outer host-level `Promise.race` for `execCommand(tmux list-sessions)`, the `roleResolveBlock` inner race for the frontmatter cat, and the `recencySignalsBlock` inner race for the discovery + tail. Failure isolation preserved — one hung discovery on one row does NOT kill sibling rows or the whole host.

## Auth Gates

None. No external service auth required. All test mocks are in-process (`vi.mock`).

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `041b7d27` | `feat(48-02): extend /sessions/list route with per-session aiTitle derivation` |
| 2 | `9f792710` | `feat(48-02): publish aiTitle on every SessionState frame via ssh-poll-orchestrator` |

## Known Stubs

None. Both backend read paths now fully derive `aiTitle` end-to-end — the /sessions/list REST response carries it per row, and the fleet-status WS `SessionState` frame carries it per publish. The wire types accepted the field via Phase 48 Plan 01 (already landed). Downstream consumer wiring lives in Plans 48-03 (working-store third axis) and 48-04 (AppShell seed).

## Threat Flags

None. This plan extends two pre-existing backend surfaces (already covered by Phase 34 trust-boundary review): the `/sessions/list` REST route + fleet-status WS. No new endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries. The tail-width bump `tail -n 200` → `tail -c 262144` is a shell-argument change on a pre-existing shell exec against a pre-existing discovered path (bounded to 256KB — no unbounded read introduced). The aiTitle field flows the SAME transport surfaces the lastMessageAt field already established — attack surface unchanged.

## Downstream Blockers Unblocked

- **Plan 48-03** (working-store third axis): can consume `SessionState.aiTitle` from the fleet-status WS payload with confidence that it's derived symmetrically from the same JSONL as `lastMessageAt`.
- **Plan 48-04** (AppShell seed): can consume `RemoteTmuxSession.aiTitle` from `/sessions/list` response with confidence that every row emits the field (server-always-emits contract).
- **Plan 48-05** (row redesign): downstream — consumes the working-store hook exposed by Plan 48-03.

## TDD Gate Compliance

Both Task 1 and Task 2 had `tdd="true"`. Full plan-level cycle:

- **Task 1 RED gate**: Wrote 7 new tests + extended assertions on 10 pre-existing tests BEFORE modifying sessions.ts source; ran `npx vitest run src/backend/database/routes/sessions.test.ts` → **16 failed / 1 passed / 17 total**. RED gate confirmed (source lacked the aiTitle interface field + row-init + scanner + block).
- **Task 1 GREEN gate**: Extended TmuxSessionRow interface, added scanTailForLatestAiTitle helper, extended row-init with `aiTitle: null`, refactored lastMessageAtBlock → recencySignalsBlock with OPTION A shared-buffer consolidation + tail-c-262144 bump; ran the same test file → **17/17 pass**. RED→GREEN transition verified.
- **Task 2 RED gate**: Wrote 6 new tests + updated 5 tail-n-200 assertions + extended pre-existing Tests G/I/J/K with aiTitle assertions BEFORE modifying ssh-poll-orchestrator.ts source; ran `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → **11 failed / 21 passed / 32 total**. RED gate confirmed.
- **Task 2 GREEN gate**: Extended PidCacheEntry, added AI_TITLE_LINE_PREFIX + scanTailForLatestAiTitle helper, bumped tail command, added aiTitle derivation in processPid, extended SessionState + fingerprint + both livenessMap.set sites; ran the same test file → **32/32 pass**. RED→GREEN transition verified.
- **REFACTOR gate**: One minor post-GREEN edit on Task 2 — three docblock comments in ssh-poll-orchestrator.ts that referenced the historical `tail -n 200` shape were rephrased to reference `tail -c 262144` to satisfy the strict acceptance criterion `grep -Fc 'tail -n 200' == 0`. All 32 tests re-verified green after the doc edits.

Per-task git-log gate sequence (each task combines TDD RED+GREEN in one commit per the plan's `tdd="true"` scope, matching the Phase 48 Plan 01 pattern):
- Task 1 commit `041b7d27`: `feat(48-02): extend /sessions/list route with per-session aiTitle derivation`.
- Task 2 commit `9f792710`: `feat(48-02): publish aiTitle on every SessionState frame via ssh-poll-orchestrator`.

## Self-Check: PASSED

- **Files present:**
  - `src/backend/database/routes/sessions.ts` — modified, present (TmuxSessionRow gained aiTitle; scanTailForLatestAiTitle at L84; recencySignalsBlock with shared tail buffer; operation `sessions_list_recency_signals_skip`).
  - `src/backend/database/routes/sessions.test.ts` — modified, present (jsonlAiTitleLine fixture; 7 new tests in Phase 48 Plan 02 describe; aiTitle assertions on 10 pre-existing tests).
  - `src/backend/fleet-status/ssh-poll-orchestrator.ts` — modified, present (PidCacheEntry.aiTitle + AI_TITLE_LINE_PREFIX + scanTailForLatestAiTitle at L288 + processPid derivation + SessionState + fingerprint 6th axis + 2 livenessMap.set sites + tail -c 262144 exec).
  - `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — modified, present (jsonlAiTitleLine fixture; 6 new tests in Phase 48 Plan 02 describe; 5 tail-n-200 → tail-c-262144 updates; aiTitle assertions on pre-existing Tests G/I/J/K).
  - `.planning/phases/48-convo-list-per-row-current-work-hint-from-ai-title-extends-f/48-02-SUMMARY.md` — created, present.
- **Commits present in git log:** `041b7d27` (Task 1) + `9f792710` (Task 2) — verified via `git log --oneline -5`.
- **Full-suite tests:** 198 files / 2591 pass / 9 skipped / 1 todo / 1 pre-existing UI-picker flake (VoicePicker.test.tsx — passes 7/7 in isolation; unrelated to backend changes; identical timing-flake pattern documented in Phase 44 Plan 02 SUMMARY.md).
- **Backend + frontend builds green:** `npm run build:backend && npm run build` → both exit 0.
- **Scope fence honored:** only 4 files modified (matches plan's `files_modified` list exactly). No edits to wire-protocol.ts, fleet-status-types.ts, conversation-store.ts, session-working-store.ts, AppShell.tsx, or any pretty-conversations file — Plan 48-01 owns the wire types; Plans 48-03 through 48-05 own downstream consumer wiring.
- **No type-safety escape hatches added:** `grep -c 'as any\|@ts-expect-error'` across all 4 modified files returns 0.
