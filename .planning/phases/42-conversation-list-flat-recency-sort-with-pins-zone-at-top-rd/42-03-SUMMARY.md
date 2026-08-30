---
phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd
plan: 03
subsystem: fullstack
tags:
  - fullstack
  - wire-protocol
  - fleet-status
  - recency-signal
  - conversation-list
  - session-working-store

# Dependency graph
requires:
  - phase: 41
    plan: 01
    provides: "ConversationList three-zone shape (activeSet + pinned + middle + rdpGroup); compareByRecencyDesc with no-history-to-top + insertion-order fallback; ConversationRow.lastMessageAt optional field; __setLastMessageAtForTest test-only injection API (Plan 03 supersedes with wire-side signal but the test API SURVIVES for store unit tests)"
  - phase: 34
    plan: 06
    provides: "fleet-status WebSocket channel + session-working-store composite state (isWorking axis); publishFleetStatusSessionState entry point that Plan 03 now extends to also write lastMessageAt"
  - phase: 32
    plan: 01
    provides: "layer1-detect.ts JSONL path convention `~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl` (referenced by Plan 03's jsonlPathForSession helper — same convention, kept in sync intentionally)"
provides:
  - "SessionStateSchema.lastMessageAt: z.number().nullable().optional() — additive+optional wire extension; FRAME_SCHEMA_VERSION held at 1 (T-42-03-05)"
  - "ssh-poll-orchestrator.derivedLastMessageAt: JSONL-tail-based derivation per polled PID; message-bearing frames only ({message, image, relay_outbound, relay_inbound}); edge-triggered cache in PidCacheEntry.lastMessageAt so background activity does NOT bump the recency signal"
  - "session-working-store.lastMessageAt cache — per-session-key value alongside isWorking; getSessionLastMessageAt plain getter + useSessionLastMessageAt hook + subscribeSessionWorkingStore cross-store bridge"
  - "conversation-store.resolveLastMessageAt precedence chain: test-only injection map (Plan 01 __setLastMessageAtForTest) → working-store cache via sessionWorkingKeyForRow (mirrors PrettyConversationsPanel.tsx:127-130 verbatim)"
  - "conversation-store module-init bridge: subscribes to session-working-store; any working-store publish bumps conversation-store notify() → memoized snapshot invalidated → next getSnapshot() re-derives with fresh recency"
  - "Middle-zone sort observably re-orders on message activity via the real wire path (locked by Tests I, K in conversation-store.test.ts)"
affects:
  - post-Phase-41 fleet-native-panel-work (recency signal is now live end-to-end)
  - potential-per-row-last-activity-affordance (useSessionLastMessageAt hook available for future consumers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extend-in-place wire protocol: add an optional+nullable field to a shared zod schema without bumping FRAME_SCHEMA_VERSION — additive extensions never break pre-existing consumers (T-42-03-04, T-42-03-05)"
    - "Edge-triggered signal via PidCacheEntry: cache the derived value; only advance on a NEWER frame; a poll that reads a tail with no newer message-bearing turn leaves the cache alone — background chatter can NOT bump the row"
    - "Cross-store subscribe bridge: expose subscribe() from one store, subscribe() at another store's module init, bump its notify() on any upstream change — cheapest way to keep two memoized snapshots in sync without inverting ownership"
    - "Precedence chain for row-field resolution: check test-only injection map FIRST, fall through to production wire-side cache SECOND — keeps existing store unit tests deterministic (Plan 01 tests continue to pass unchanged) while wiring the real signal into the same code path"

key-files:
  created: []
  modified:
    - "src/backend/fleet-status/wire-protocol.ts — SessionStateSchema extended with `lastMessageAt: z.number().nullable().optional()`; block comment above the schema documents the semantics + the deliberate hold on FRAME_SCHEMA_VERSION = 1"
    - "src/backend/fleet-status/wire-protocol.test.ts — Tests A (omitted → undefined), B (numeric → preserved), C (null → preserved), A-guard (version NOT bumped)"
    - "src/backend/fleet-status/ssh-poll-orchestrator.ts — added `parseSessionLine` import from claude-session/session-file-parser; MESSAGE_BEARING_KINDS set + jsonlPathForSession helper + scanTailForNewestMessageAt helper; PidCacheEntry extended with lastMessageAt; processPid tails ~200 lines of the session JSONL per tick, filters via MESSAGE_BEARING_KINDS, advances the cached lastMessageAt only on newer frames, stamps derived value on SessionState; computeFingerprint now includes lastMessageAt so a fresher message publishes a state delta even without a status flip"
    - "src/backend/fleet-status/ssh-poll-orchestrator.test.ts — added databaseLogger to the utils/logger.js vi.mock (session-file-parser uses it internally); new describe block with Tests D (message-bearing filter locks tool_use + bg-task exclusion), E (zero message-bearing → null), F (user message alone floats — Ashley 'either direction' lock)"
    - "src/ui/api/fleet-status-types.ts — SessionState interface gains `lastMessageAt?: number | null` in lockstep with backend wire schema"
    - "src/ui/state/session-working-store.ts — WorkingRecord extended with lastMessageAt; publishFleetStatusSessionState now writes both axes and the no-op notify guard checks BOTH; getSessionWorkingSnapshot's return type widened to include lastMessageAt; new exports: getSessionLastMessageAt (plain getter), useSessionLastMessageAt (hook), subscribeSessionWorkingStore (cross-store bridge)"
    - "src/ui/state/conversation-store.ts — imports getSessionLastMessageAt + subscribeSessionWorkingStore from session-working-store; resolveLastMessageAt signature widened to (rowId, host, targetTmuxSession) and now falls through to the working-store cache after checking the test injection map; sessionWorkingKeyForRow helper (mirrors PrettyConversationsPanel.tsx:127-130); all four row-construction sites (rowFromTab, fleet-synthetic, RDP hostTree pass, RDP orphan pass) pass host + targetTmuxSession to resolveLastMessageAt; module-init bridge subscribes to session-working-store and bumps notify() on any publish"
    - "src/ui/state/conversation-store.test.ts — new describe block with Tests I (real wire publish → DESC by recency), J (mix of published + un-published → no-history to top), K (fresher publish moves the row to position 0), L (pinned zone unchanged under real recency data — Ashley lock #2 wire-path regression). Tests use REAL publishFleetStatusSessionState (no test-only injection), exercising the full frontend pipeline"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx — Rule 3 auto-fix: extended vi.mock('@/state/session-working-store', ...) to include the three new exports (getSessionLastMessageAt, useSessionLastMessageAt, subscribeSessionWorkingStore) so conversation-store's module-init subscribe bridge does not throw at test setup time"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx — same Rule 3 auto-fix to the working-store mock"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx — same Rule 3 auto-fix"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx — same Rule 3 auto-fix"

key-decisions:
  - "JSONL path derivation via `~/.claude/projects/<cwd.replace(/\\//g, '-')>/<sessionId>.jsonl` — matches the well-established Claude Code convention documented in layer1-detect.ts:76-78. Defense-in-depth check refuses paths containing single-quote or newline characters (which cannot appear on any Unix box the fleet runs on) so the single-quote-wrapped shell literal stays safe."
  - "Cold-start + hot-path both use `tail -n 200` — simpler than the plan's suggested `tail -c +<lastOffset+1>` optimization and bounded to well under 5ms of parse work per session per 2s tick. Byte-offset tracking is a later optimization if the parse cost ever becomes measurable. The edge-triggered cache advances the signal ONLY on strictly-newer frames, so re-scanning the same 200 lines each tick is idempotent and correct."
  - "Message-bearing filter uses the parser's `kind` enum directly — MESSAGE_BEARING_KINDS = {message, image, relay_outbound, relay_inbound}. tool_use, thinking, streaming ticks, lifecycle events, and background-task starts/stops all parse to `kind: 'skip'` or `kind: 'malformed'` and are automatically excluded. Reuses the existing session-file-parser as-is; no fork or copy of the classification logic."
  - "Edge-triggered cache in PidCacheEntry: `derivedLastMessageAt = cached ?? null`, then advance ONLY when scan returns a newer value. A poll that reads the same 200 tail lines does NOT wipe the cache; a JSONL fetch failure does NOT wipe it either (fail-open). This is what makes the signal 'edge-triggered on messages' rather than 'polled every tick regardless of activity'."
  - "computeFingerprint gains lastMessageAt so a NEW message either direction publishes a state delta even when status + backgroundTasks are unchanged. Critical: without this, an assistant turn completing with status:idle + a new message would NOT publish because status+bg fingerprint stays identical, and the frontend would never see the fresh recency signal. Null is normalized to '' so a first-time null publish still emits a distinct fingerprint."
  - "Frontend cross-store bridge subscribes UNCONDITIONALLY (fires on EVERY working-store publish including pure isWorking flips). This keeps the wiring dead simple; conversation-store's snapshot memoization is already lazy (getSnapshot re-derives only when accessed), so extra notify() bumps are cheap. If profiling ever shows measurable cost, working-store can be extended with per-axis subscribe granularity."
  - "resolveLastMessageAt precedence: test-injection FIRST, wire-cache SECOND. Plan 01's tests continue to work unchanged (they use __setLastMessageAtForTest); Plan 03's tests use the real publishFleetStatusSessionState path. Both signals feed the same comparator via the same row.lastMessageAt stamp — one code path, two entry points."
  - "sessionWorkingKeyForRow lives in conversation-store as a small duplicate of PrettyConversationsPanel.tsx:127-130's sessionWorkingKey helper. Extracting it to a shared module would add a new file for two lines; the duplication is documented at both sites with a cross-reference comment. If the key format ever changes, both sites need to be updated in lockstep — the comment enforces that discipline."
  - "No wire-protocol version bump. The new lastMessageAt field is `.optional().nullable()`, so a pre-Phase-41 watcher (if any deployed variant exists) sending frames without the field parses cleanly with `lastMessageAt: undefined` — downstream treats undefined identically to null (both flip the row to the no-history-to-top branch). Documented in wire-protocol.ts's block comment above SessionStateSchema."
  - "No nginx changes. The `/fleet-status/` route already exists in docker/nginx.conf and docker/nginx-https.conf (Phase 34 Plan 06). Plan 03's contract is to EXTEND the payload on that existing route — the new lastMessageAt field rides the existing WS frames. Verified: `git diff --name-only docker/nginx.conf docker/nginx-https.conf` returns empty at task completion."
  - "Two per-task atomic commits (Task 1 backend, Task 2 frontend) — Task 1 leaves the frontend inert (SessionState.lastMessageAt just goes unread), so full-suite is green between the commits. Task 2 wires the frontend end-to-end. Neither task introduces the joint-atomic coupling that Plan 42-01 had."

patterns-established:
  - "Additive+optional wire-schema extension without version bump — SessionStateSchema.lastMessageAt: z.number().nullable().optional() is the reference pattern. FRAME_SCHEMA_VERSION only bumps for BREAKING changes; back-compat additions ride the existing version. Documented in the block comment above the schema so future contributors follow the same discipline."
  - "Message-bearing frame filter via parser kind enum — MESSAGE_BEARING_KINDS set at the orchestrator level. Reuses the classifier the browser already trusts (session-file-parser); adding new classifications (e.g., a hypothetical 'voice_note' kind) auto-flows into the recency signal by adding one entry to the set. Alternative would be reimplementing the classification in the orchestrator — rejected as duplication."
  - "Edge-triggered signal via cached-max — orchestrator caches the derived value and only advances on strictly-newer frames. Reusable for any 'newest matching event across time' signal where the poll cadence exceeds the event cadence — the cache is idempotent under repeated identical polls."
  - "Cross-store subscribe bridge with module-init registration — subscribeSessionWorkingStore(() => notify()) at conversation-store's bottom. Cheapest coupling that keeps two memoized stores in sync without inverting ownership. Disposer intentionally discarded because both stores are session-lifetime singletons."
  - "Precedence-chain resolver for row-field values — resolveLastMessageAt checks test-injection map, then falls through to production cache. Lets Plan-01-era tests continue passing verbatim while wiring production data through the SAME code path. Reusable for any 'test override + production source' pattern."
  - "Test-mock fanout for cross-store bridges — when a store adds a new export that another store imports at module init, EVERY vi.mock of the exporting store must be updated to include the new export as a no-op stub. Grep pattern: `grep -rln 'vi.mock.*<store-name>'` to find all touch points. Rule-3 auto-fix touched 4 panel test files here."

requirements-completed: []

# Metrics
duration: ~50m
completed: 2026-08-15
---

# Phase 42 Plan 03: fleet-status protocol extension + recency-signal wiring Summary

**Backend fleet-status WebSocket protocol extended with an additive+optional `lastMessageAt: number | null` field on `SessionState`; ssh-poll-orchestrator derives the value per polled PID by tailing the session JSONL (~200 lines) on the same SSH channel used elsewhere in fleet-status polling, filtering for message-bearing kinds only ({message, image, relay_outbound, relay_inbound} — tool_use, thinking, lifecycle events, background-task starts/stops all EXCLUDED per Ashley's "activity = message either direction, and only that" lock); frontend mirrors the field on the `SessionState` interface and caches it in `session-working-store` alongside `isWorking`; `conversation-store`'s row derivation reads the cache via `getSessionLastMessageAt(sessionWorkingKey(row))` and stamps `row.lastMessageAt`; a module-init cross-store subscribe bridge bumps the conversation-store's `notify()` on any working-store publish so the memoized snapshot invalidates and the middle zone observably re-orders on message activity. Ashley lock #2 (pins do NOT shuffle) survives with real signal flowing (Test L). No wire-protocol version bump (additive+optional). No nginx changes (existing `/fleet-status/` route unchanged).**

## Performance

- **Duration:** ~50m (Task 1 backend TDD RED→GREEN + build: ~25m; Task 2 frontend TDD RED→GREEN + full-suite verify: ~25m)
- **Started:** 2026-08-15T02:19:00Z (approx.)
- **Completed:** 2026-08-15T02:47:00Z
- **Tasks:** 2 (Task 1 backend extension + JSONL derivation; Task 2 frontend mirror + working-store bridge + conversation-store wiring)
- **Files modified:** 12 (4 backend + 4 frontend source + 4 test mock fanout)
- **Commits:** 2 atomic task commits (21aabefe, 0611e08e)
- **Tests added:** 7 (Tests A/B/C/A-guard schema; Tests D/E/F orchestrator derivation; Tests I/J/K/L conversation-store wire path — 4+3+4 = 11 total assertions across two files, all green)

## Accomplishments

### Task 1 — Backend extension + JSONL derivation (commit 21aabefe)

- **`SessionStateSchema` extension**: added `lastMessageAt: z.number().nullable().optional()` after `updatedAt`. Block comment above the schema documents (a) unix-millis-of-newest-message-bearing-frame semantics, (b) either-direction message contract, (c) null-when-no-history convention, (d) undefined-when-pre-Phase-41-watcher fallback, (e) deliberate FRAME_SCHEMA_VERSION hold at 1 (additive+optional never bumps).
- **JSONL-tail derivation** in `ssh-poll-orchestrator.processPid`: builds path via `jsonlPathForSession(cwd, sessionId)` (Claude Code convention: `~/.claude/projects/<cwd-slashes-as-dashes>/<sessionId>.jsonl`), runs `tail -n 200 <path> 2>/dev/null || true` on the same SSH channel used for other fleet-status polling, parses each line via `parseSessionLine` (imported from `claude-session/session-file-parser`), filters for `kind ∈ {message, image, relay_outbound, relay_inbound}`, takes the newest `ts` — that's the derived `lastMessageAt` for this tick.
- **Edge-triggered cache**: `PidCacheEntry.lastMessageAt` is stamped after every publish. A poll that sees no newer message-bearing frame leaves the cache alone; background chatter (tool_use frames, thinking blocks) never bumps the row. This is what makes the signal "edge-triggered on messages" rather than "polled every tick regardless of activity" — the key correctness property Ashley locked.
- **Fingerprint delta**: `computeFingerprint` gained the `lastMessageAt` axis so a message-only advance (assistant turn completes with status:idle + new turn) publishes a state delta. Without this, the frontend would never see the fresh recency signal.
- **Fail-open**: JSONL exec returning null / empty / malformed → cached value stays. Missing JSONL file (fresh session with no writes yet) → same. No crash, no publish disruption; matches the fail-open discipline the fleet-status orchestrator already applies to the hook payload.
- **Tests D/E/F**: locked the message-bearing filter (D — user+tool_use+assistant+bg_task → newest message wins, tool_use + bg_task ignored), zero-history behavior (E — only tool_use + bg_task → null), and Ashley's "either direction" lock (F — user message alone counts). All three use realistic JSONL fixtures with ISO-timestamp lines that `parseSessionLine` accepts.

### Task 2 — Frontend mirror + working-store bridge + conversation-store wiring (commit 0611e08e)

- **`SessionState` interface mirror** at `ui/api/fleet-status-types.ts`: gained `lastMessageAt?: number | null` in lockstep with the backend schema. Comment cross-references the wire-protocol.ts extension.
- **`session-working-store` cache**: `WorkingRecord` extended with `lastMessageAt: number | null`. `publishFleetStatusSessionState` writes both axes; the no-op notify guard checks BOTH so a status-unchanged frame with a fresher `lastMessageAt` still publishes (critical: the frontend must see the update even when status+bg fingerprint is stable).
- **New public exports** on the working-store:
  - `getSessionLastMessageAt(sessionKey): number | null` — plain getter used by conversation-store's row derivation.
  - `useSessionLastMessageAt(sessionKey): number | null` — React hook parallel to `useSessionIsWorking`; available for future per-row consumers.
  - `subscribeSessionWorkingStore(cb): () => void` — cross-store bridge exposing the internal listener registry.
- **`conversation-store` row derivation**: `resolveLastMessageAt` signature widened to `(rowId, host, targetTmuxSession)` and now falls through to the working-store cache after checking the test-only injection map. Precedence: test-injection FIRST (Plan 01's `__setLastMessageAtForTest` API still works verbatim), wire-cache SECOND (Plan 03's production data). All four row-construction sites (rowFromTab, fleet-synthetic, RDP hostTree pass, RDP orphan pass) now pass `host + targetTmuxSession` to `resolveLastMessageAt`.
- **`sessionWorkingKeyForRow` helper** at conversation-store: mirrors `sessionWorkingKey` at PrettyConversationsPanel.tsx:127-130 verbatim. Comment at both sites documents that a change to one MUST mirror to the other.
- **Module-init cross-store bridge**: bottom of `conversation-store.ts` calls `subscribeSessionWorkingStore(() => notify())`. Any working-store publish invalidates conversation-store's memoized snapshot; next `getSnapshot()` re-derives with fresh recency. Disposer intentionally discarded (both stores are session-lifetime singletons).
- **Tests I/J/K/L**: locked the FULL wire-path contract using real `publishFleetStatusSessionState`. I (two rows publish real timestamps → DESC by recency), J (published + un-published → no-history floats to top), K (publishing a fresher timestamp for the currently-second row moves it to position 0 — the load-bearing "row jumps on message activity" gate), L (pinned zone stays label-ordered under fresh wire signal — Ashley lock #2 survives Plan 03 for real).
- **Rule 3 auto-fix** — cross-store bridge test-mock fanout: 4 panel test files (`PrettyConversationsPanel.test.tsx`, `PrettyConversationsPanel.chain.test.tsx`, `PrettyConversationsPanel.clone-dialog.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`) each mock `@/state/session-working-store`. Post-Task-2, conversation-store's module init imports `subscribeSessionWorkingStore` from that mock → the mock must include the new export or module init throws with "No export defined on the mock". Extended each mock to stub `subscribeSessionWorkingStore` (returns a no-op disposer), `getSessionLastMessageAt` (returns null), and `useSessionLastMessageAt` (returns null). Documented in each mock with a Phase 42 Plan 03 comment.

## Task Commits

1. **21aabefe** — `plan(42-03): extend SessionState wire schema + derive lastMessageAt from JSONL tail` (Task 1)
2. **0611e08e** — `plan(42-03): frontend mirror + session-working-store bridge for lastMessageAt` (Task 2)

## Files Created/Modified

**Backend (Task 1):**

- `src/backend/fleet-status/wire-protocol.ts` — `SessionStateSchema` gains `lastMessageAt: z.number().nullable().optional()` after `updatedAt`; block comment documents semantics + version-hold rationale.
- `src/backend/fleet-status/wire-protocol.test.ts` — Tests A/B/C/A-guard (Phase 42 Plan 03 schema back-compat + forward + null + version-not-bumped); imports `SessionStateSchema` for direct-parse assertions.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — imports `parseSessionLine` from `../claude-session/session-file-parser`; adds `MESSAGE_BEARING_KINDS` set + `jsonlPathForSession` helper + `scanTailForNewestMessageAt` helper; `PidCacheEntry.lastMessageAt` field; `processPid` derives lastMessageAt from a bounded JSONL tail on every tick and advances the cache only on strictly-newer frames; stamps `state.lastMessageAt` on the SessionState emitted through `publishSessionState`; `computeFingerprint` includes lastMessageAt.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — added `databaseLogger` mock to `../utils/logger.js` (session-file-parser uses it); new describe block with Tests D (message-bearing filter — tool_use + bg_task excluded), E (zero message-bearing → null), F (user message alone floats — Ashley lock).

**Frontend (Task 2):**

- `src/ui/api/fleet-status-types.ts` — `SessionState` interface gains `lastMessageAt?: number | null` in lockstep with the backend wire schema.
- `src/ui/state/session-working-store.ts` — `WorkingRecord` extended with `lastMessageAt`; `publishFleetStatusSessionState` writes both axes and the no-op notify guard checks BOTH; `getSessionWorkingSnapshot` return type widened; new exports `getSessionLastMessageAt` (plain getter), `useSessionLastMessageAt` (React hook), `subscribeSessionWorkingStore` (cross-store bridge).
- `src/ui/state/conversation-store.ts` — imports `getSessionLastMessageAt + subscribeSessionWorkingStore` from `./session-working-store`; `resolveLastMessageAt` signature widened to `(rowId, host, targetTmuxSession)` and falls through to working-store cache; `sessionWorkingKeyForRow` helper (mirrors PrettyConversationsPanel.tsx:127-130); all four row-construction sites pass host + targetTmuxSession; module-init bridge `subscribeSessionWorkingStore(() => notify())` at bottom.
- `src/ui/state/conversation-store.test.ts` — imports `publishFleetStatusSessionState + __resetForTest` from session-working-store + `SessionState` type; new describe block with Tests I (real wire publish → DESC), J (mix + no-history to top), K (publish moves row to position 0 — load-bearing "jumps on activity" gate), L (pinned zone unchanged — Ashley lock #2 wire-path regression).

**Test mock fanout (Task 2 Rule 3 auto-fix):**

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — extended `vi.mock("@/state/session-working-store", ...)` with `subscribeSessionWorkingStore` (no-op disposer) + `getSessionLastMessageAt` + `useSessionLastMessageAt`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — same extension.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — same extension.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` — same extension.

## Decisions Made

- **Two per-task commits rather than a single joint commit** — Task 1 is a clean backend addition that leaves the frontend inert (SessionState.lastMessageAt just goes unread). Full-suite green after Task 1's commit. Task 2 then wires the frontend. Neither introduces the joint-atomic coupling that Plan 42-01 had.
- **JSONL path via Claude Code convention** — `~/.claude/projects/<cwd-slashes-as-dashes>/<sessionId>.jsonl` per layer1-detect.ts:76-78. Encoded in `jsonlPathForSession(cwd, sessionId)`. Defense-in-depth: refuses paths containing single-quote or newline characters (impossible on Unix cwd/sessionId in practice, but the check keeps the single-quote-wrapped shell literal safe from any future path-shape drift).
- **`tail -n 200` on every tick, no byte-offset optimization yet** — simpler and bounded to well under 5ms of parse work per session per 2s tick. The edge-triggered cache is idempotent under repeated identical polls, so re-scanning the same 200 lines is correct. Byte-offset tracking (`tail -c +<lastOffset+1>`) is a later optimization if profiling ever shows measurable cost.
- **Cross-store subscribe bridge is unconditional** — fires on EVERY working-store publish including pure isWorking flips (not just lastMessageAt changes). Cheap: conversation-store's snapshot memoization is lazy, so extra notify() bumps just invalidate the cache; the next getSnapshot() re-derives with fresh values. Tightening to per-axis subscribe granularity is deferred.
- **`resolveLastMessageAt` precedence: test-injection FIRST, wire-cache SECOND** — lets Plan 01's tests continue passing verbatim (they use `__setLastMessageAtForTest` which populates the injection map). Plan 03's tests use `publishFleetStatusSessionState` and hit the wire-cache branch. Both signals feed the same comparator via the same `row.lastMessageAt` stamp — one code path, two entry points.
- **`sessionWorkingKeyForRow` duplicated at conversation-store rather than extracted to shared module** — extracting for two lines would add a new file. The duplication is documented at both sites with cross-reference comments enforcing lockstep updates.
- **No wire-protocol version bump** — `.optional().nullable()` field is additive; pre-Phase-42-03 watchers parse cleanly with `lastMessageAt: undefined`. Documented in the wire-protocol.ts block comment; asserted in Test A-guard.
- **No nginx changes** — extends payload on the existing `/fleet-status/` route (Phase 34 Plan 06). Verified: `git diff --name-only docker/nginx.conf docker/nginx-https.conf` returns empty at task completion.
- **`computeFingerprint` includes lastMessageAt** — a NEW message either direction must publish a state delta even when status + backgroundTasks are unchanged. Without this the frontend would never see the fresh recency signal on message-only advances (assistant turn completes → status:idle + new message → no publish).
- **No changes to session-file-parser** — reused as-is via the `kind` enum. Adding new message-bearing classifications in the future (e.g., a hypothetical 'voice_note' kind) auto-flows into the recency signal by adding one entry to `MESSAGE_BEARING_KINDS`. Zero fork of the classification logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended session-file-parser logger mock to include databaseLogger**
- **Found during:** Task 1 orchestrator test D/F RED verification
- **Issue:** `parseSessionLine` (imported by ssh-poll-orchestrator via `../claude-session/session-file-parser`) uses `databaseLogger` (aliased as `sessionParserLogger`) for per-line classify traces. The orchestrator test file's `vi.mock("../utils/logger.js", ...)` originally only stubbed `systemLogger` — post-import of parseSessionLine, calls to `sessionParserLogger.info()` on real message-bearing lines threw with "Cannot read properties of undefined (reading 'info')". Tests D and F failed with 0 published states (the throw aborted `processPid` before it emitted). Test E passed only because the tool_use + bg_task fixture's lines all early-return before hitting the classify-log path.
- **Fix:** Extended the vi.mock to also stub `databaseLogger` with the same shape as `systemLogger` (warn/info/error/success as vi.fn()).
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`
- **Verification:** Tests D and F both pass; parseSessionLine's `sessionParserLogger.info` calls no-op cleanly.
- **Committed in:** part of the Task 1 atomic commit

**2. [Rule 3 - Blocking] Extended vi.mock stubs in 4 panel test files for the new working-store exports**
- **Found during:** Task 2 full-suite verify
- **Issue:** conversation-store's module init imports `subscribeSessionWorkingStore` + `getSessionLastMessageAt` from `./session-working-store`. Four panel test files (`PrettyConversationsPanel.test.tsx` + 3 siblings) mock the working-store with only `useSessionIsWorking: () => false`. When conversation-store's module init runs during those tests, it looks up `subscribeSessionWorkingStore` in the mock → undefined → call throws "No 'subscribeSessionWorkingStore' export is defined on the mock". `PrettyConversationsPanel.test.tsx > Test D: only=1 hash clears the pv-conv-search-hidden-once sentinel via conversation-store module init` explicitly triggers real conversation-store module init via `vi.importActual` → this test fails first. The 3 sibling files would fail similarly if their tests exercised any code path that triggered a conversation-store module load.
- **Fix:** Extended all 4 mocks to include `subscribeSessionWorkingStore` (returns a no-op disposer), `getSessionLastMessageAt` (returns null), and `useSessionLastMessageAt` (returns null). Each mock now carries a Phase 42 Plan 03 comment documenting why the stubs are needed.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`, `PrettyConversationsPanel.chain.test.tsx`, `PrettyConversationsPanel.clone-dialog.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`
- **Verification:** All 4 files' tests pass; full-suite goes from 1 failed → 0 failed.
- **Committed in:** part of the Task 2 atomic commit

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking)
**Impact on plan:** Both auto-fixes were necessary to preserve full-suite green after the plan's actions landed. Neither extended scope beyond the plan's spirit — the logger mock extension follows the established fleet-status-orchestrator test setup pattern; the working-store mock fanout is the cross-store bridge cost documented in patterns-established.

## Threat Model — Verification Matrix

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-42-03-01 (Information Disclosure via lastMessageAt) | **Accepted per plan** — signal is per-session and only reaches the authenticated user who owns the session. No cross-user visibility. Meta-info leak surface is identical to the existing updatedAt field. |
| T-42-03-02 (Tampering via crafted JSONL line ts) | **Mitigated** — session-file-parser validates line shape and normalizes `ts` to a number (via `Date.parse`). Backend accepts any numeric value from the user's own file, so worst case is a self-inflicted "row jumps to a fake position in my own list". No cross-user impact. |
| T-42-03-03 (DoS via JSONL tail on large files) | **Mitigated** — `tail -n 200` ceiling per poll tick per session. Bounded work regardless of JSONL file size. Well under 5ms of parse work per tick. |
| T-42-03-04 (Pre-Phase-41 watcher without lastMessageAt) | **Accepted per plan** — schema field is `.optional().nullable()`, parses cleanly with `lastMessageAt: undefined`; downstream treats undefined identically to null. Locked by Test A (schema back-compat). |
| T-42-03-05 (Schema version stays at 1 while payload shape changes) | **Mitigated** — documented in wire-protocol.ts block comment above SessionStateSchema; asserted in Test A-guard (`FRAME_SCHEMA_VERSION === 1`). If a future breaking change lands, THAT change bumps the version. |
| T-42-03-06 (Frontend re-renders on every lastMessageAt update) | **Accepted per plan** — working-store publishes at fleet-status poll cadence (~2s per session). Adding one field to the same update stream does not change render frequency. Conversation-store's snapshot memoization is lazy; the subscribe bridge just invalidates a cache. |

## Ashley Locks — Verification Matrix

| Lock | Test | Status |
|------|------|--------|
| Recency signal source: EXTEND fleet-status protocol (not client-side, not Stop-hook mtime) | Schema field + orchestrator derivation via SSH poll channel | ✓ Verified |
| Activity = message either direction, ONLY that (tool_use/thinking/lifecycle events excluded) | Test D (tool_use + bg_task excluded), Test F (user-only counts) | ✓ Verified |
| No-history rows sort to TOP of middle | Test J (real wire path: un-published row floats above published) | ✓ Verified |
| Middle-zone sort observably re-orders on message activity | Test K (fresher publish moves row to position 0) | ✓ Verified |
| Pinned zone stays label-ordered under real recency data | Test L (wire-path regression of Ashley lock #2 from Plan 01) | ✓ Verified |
| No wire-protocol version bump (additive+optional) | Test A-guard (`FRAME_SCHEMA_VERSION === 1`), block comment in wire-protocol.ts | ✓ Verified |
| No nginx changes (extends payload on existing route) | `git diff --name-only docker/nginx.conf docker/nginx-https.conf` returns empty | ✓ Verified |

## Issues Encountered

- **JSONL sample fixture had to be hand-authored to match session-file-parser's shape**: parseSessionLine expects `{ type: "user"|"assistant", message: { role, content }, timestamp: <ISO string>, uuid: string }` for real message lines. `tool_use` lines have `message.content: [{type: "tool_use", ...}]` (array content, no textual body → skipped). Background-task lines use unknown top-level types → skipped by the isUser/isAssistant gate. The `jsonlMessageLine`/`jsonlToolUseLine`/`jsonlBackgroundTaskLine` helpers in the test file encode these shapes cleanly.
- **MockSshChannel's includes()-based response matching required a broad pattern** — the orchestrator's JSONL command form is `tail -n 200 ~/.claude/projects/-home-ubuntu/test-session-id.jsonl 2>/dev/null || true`. Matching on the filename fragment `test-session-id.jsonl` covers any tail-command variant the orchestrator picks (no need to over-specify the exact command).
- **Cross-store bridge fanout to 4 panel test files was the largest single mechanical change** — worth flagging in patterns-established because ANY future export from a heavily-mocked store will require the same fanout. Grep pattern `vi.mock.*<store-name>` finds all touch points quickly.

## Self-Check

Per fork rule + step self_check:
- **tsc exit code (frontend):** 0 ✓
- **build:backend exit code:** 0 ✓ (fork rule — backend TS builds independently and must be verified)
- **npm run build (frontend Vite bundle):** exit 0 ✓
- **Full-suite vitest:** 188 test files passed, 2400 tests passed, 6 skipped, 1 todo, 0 failed, exit 0 ✓
- **grep counts — wire-protocol.ts (lastMessageAt):** 2 (≥2 required) ✓
- **grep counts — wire-protocol.ts (z.number().nullable().optional()):** 1 (≥1 required) ✓
- **grep counts — wire-protocol.ts (FRAME_SCHEMA_VERSION = 1):** 1 (version not bumped, ≥1 required) ✓
- **grep counts — ssh-poll-orchestrator.ts (lastMessageAt):** 11 (≥3 required: derivation, cache, stamping) ✓
- **grep counts — wire-protocol.test.ts (lastMessageAt):** 12 (≥3 required for Tests A/B/C) ✓
- **grep counts — ssh-poll-orchestrator.test.ts (lastMessageAt):** 12 (≥3 required for Tests D/E/F) ✓
- **grep counts — fleet-status-types.ts (lastMessageAt):** 2 (≥1 required) ✓
- **grep counts — session-working-store.ts (lastMessageAt):** 19 (≥3 required) ✓
- **grep counts — session-working-store.ts (getSessionLastMessageAt/useSessionLastMessageAt):** 5 (≥1 required) ✓
- **grep counts — conversation-store.ts (lastMessageAt):** 36 (≥3 required) ✓
- **grep counts — conversation-store.test.ts (lastMessageAt):** 45 (≥4 required for Tests I/J/K/L) ✓
- **git diff --name-only docker/nginx.conf docker/nginx-https.conf:** empty ✓ (no nginx changes)
- **git worktree list:** main tree only ✓
- **nginx route exists check (baseline):** `grep -c "location.*fleet-status" docker/nginx.conf` = 1 (existing route present) ✓

## User Setup Required

**None** — no external service configuration required. This plan is full-stack but backend-additive (extended payload on an existing route) and frontend-mirror (extended existing store cache). No new npm packages, no new backend routes, no new nginx rules, no schema migrations, no environment variables.

Ashley will notice on the next deploy:
- The middle zone of the pretty-conversations panel now observably re-orders when messages flow (either direction). Previously (post-Plan-01, pre-Plan-03) the middle zone was insertion-order-fallback because every row's `lastMessageAt` was null; now the wire path populates real values from the backend JSONL derivation.
- Pinned zone still holds label order regardless of message activity (Ashley lock #2 wire-path regression locked by Test L).
- RDP zone still holds label order regardless of message activity.
- Rows with no message history (fresh sessions) still float to the top of the middle zone (Ashley no-history-to-top lock unchanged).

## Next Phase Readiness

- **Phase 42 fully closed.** All three plans (42-01 three-zone shape + ambient retirement; 42-02 search + one-shot scroll-hide + filter; 42-03 fleet-status protocol extension + recency signal wiring) have landed with full-suite green. The pretty-conversations panel now delivers the complete phase contract:
  - Middle zone: flat, recency-DESC with no-history-to-top exception, real signal flowing from backend.
  - Pinned zone: label-ordered stability, does not shuffle on activity.
  - RDP zone: label-ordered stability, hides entirely when zero RDP sessions.
  - Ambient-recession visual: retired; every row uniform.
  - Search: always-in-DOM input at top; one-shot cold-load scroll-hide; label-only flatten filter.
- **Post-Phase-41 opportunities**:
  - (a) Byte-offset optimization for the JSONL tail — track `lastOffset` per session and use `tail -c +<lastOffset+1>` to reduce parse work. Only worth doing if profiling shows the ~5ms/tick/session cost becoming measurable.
  - (b) Per-axis subscribe granularity on session-working-store — split `subscribe` into `subscribeIsWorkingChanges` + `subscribeLastMessageAtChanges` so conversation-store's cross-store bridge only fires on recency changes. Only worth doing if profiling shows conversation-store re-derivation cost becoming measurable.
  - (c) A per-row "last activity: 3m ago" affordance using the new `useSessionLastMessageAt` hook. Deferred per shape §Deferred Ideas ("recently active" badge is out-of-scope for Phase 42).

## Self-Check: PASSED

---
*Phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd*
*Completed: 2026-08-15*
