# Phase 44: Fix convo-list recency signal — switch dormant + live paths to /id-first-turn JSONL discovery, retire no-history-to-top

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Source:** Authored from operator ↔ Ashley conversation 2026-08-18 (no separate /gsd:discuss-phase run — decisions locked inline before planning).

<domain>
## Phase Boundary

**In scope:**
- `/sessions/list` route (`src/backend/database/routes/sessions.ts`) — extend response shape with per-session `lastMessageAt` derived from JSONL discovery + tail scan.
- `ssh-poll-orchestrator.ts` (`src/backend/fleet-status/`) — swap the current `~/.claude/sessions/<pid>.json → sessionJson.cwd + sessionId` JSONL-path derivation for `discoverIdentitySessionFile(conn, tmuxSession)`. Keep everything else (PID enumeration for status/backgroundTasks/waitingFor, `livenessMap`, `isStaleFromStat` reaping, hook-payload parsing) intact.
- `session-working-store.ts` (`src/ui/state/`) — accept a seed API from `/sessions/list` payload; WS updates from the orchestrator overlay on top. Reconciliation rule: max-wins (value only ever advances).
- `conversation-store.ts` (`src/ui/state/`) — thread `lastMessageAt` through `state.fleetSessions[i]` if we choose to seed at that layer OR wire the working-store seed call from AppShell's fleet-sessions fetch path. Retire Rule 1 in `compareByRecencyDesc` so `lastMessageAt == null` rows sort to the BOTTOM of middle (or intermix as 0), not the top.
- Wire type surface (`src/ui/api/*.ts` fleet-session shape) — add optional `lastMessageAt: number | null` to the returned session row.
- Test coverage for all of the above (wire parse, orchestrator swap, seed reconciliation, comparator flip).

**Out of scope:**
- No UI-side changes to the panel (`PrettyConversationsPanel.tsx`, CSS). Behavior fix only — the visible list improvement comes from correct data.
- No new virtualization / scroll-anchor work (deferred to Phase 27 if still wanted after this lands).
- No fleet-status wire-protocol version bump — `lastMessageAt` is already additive+optional per Phase 41 Plan 03; we're changing its DERIVATION source server-side, not its wire shape.
- No changes to Phase 32's `discoverIdentitySessionFile` module — consumed as-is.
- No changes to the active-flow session-file discovery (`discoverClaudeSession` at `session-file-discovery.ts`) — that stays on its current mechanism per Phase 32 D-09.
- No RDP tier changes; pinned tier alphabetical sort unchanged.

</domain>

<decisions>
## Implementation Decisions

### Recency signal — two feeds, one map, max-wins

- **Primary source for dormant identities**: `/sessions/list` returns `lastMessageAt` inline on each session row. Frontend consumes on fetch and seeds `session-working-store` via a new `seedSessionLastMessageAt(hostId, tmuxSession, ts)` API.
- **Primary source for live identities**: fleet-status WS `SessionState.lastMessageAt` (already wired in Phase 41 Plan 03). Continues to flow via `publishFleetStatusSessionState` → `session-working-store` map.
- **Reconciliation rule**: value in `session-working-store` map ONLY EVER ADVANCES. When either source writes a value, compare against the existing cached value — if the new value is > existing (or existing is null), replace; else no-op + no-notify. This is the whole reconciliation contract. No priority ordering between sources; whichever produces the freshest value wins. Codified as `advanceSessionLastMessageAt(key, ts)` (internal helper); both `seedSessionLastMessageAt` and the WS publish path funnel through it.
- **Fetch cadence**: `/sessions/list` is fetched by AppShell on mount and on hostTree changes (existing behavior). We do NOT add a periodic re-fetch; live sessions' recency updates flow via WS as they do today, and dormant sessions' recency is bounded by "last message before dormancy" which doesn't change while dormant. If Ashley opens the UI, refetches happen naturally.

### Server-side JSONL discovery — reuse Phase 32 mechanism

- **The discovery function**: `discoverIdentitySessionFile(conn, identityName)` from `src/backend/claude-session/discover-identity-session-file.ts`. Returns the mtime-newest JSONL under `~/.claude/projects/*/` whose first user-role line matches `<command-name>/id</command-name><command-args><identity><delim>`. Byte-pattern grep, one-round-trip shell script, ~100ms bound, fail-safe null on any error.
- **The "identity name" the orchestrator passes**: the tmux session name (`session.sessionName` from `/sessions/list`, or the resolved `tmuxSession` from the orchestrator's PID pipeline). Fleet convention is `identity name === tmux session name === /id target`, which holds for every identity on this fleet.
- **Fallback semantics**: if `discoverIdentitySessionFile` returns null (identity doesn't send `/id` as its first turn, or SSH error, or projects dir empty), `lastMessageAt` is null for that session — same as today for the affected class, not a regression.
- **Tail scan step**: identical to the current orchestrator — `tail -n 200 <discovered-path>`, filter by `MESSAGE_BEARING_KINDS` (`message`, `image`, `relay_outbound`, `relay_inbound`), take max `ts`. Same 200-line bound.

### `/sessions/list` route extension

- **Response shape gets `lastMessageAt: number | null`** on each `TmuxSessionRow`. Field is optional in the TypeScript shape but always emitted by the server (null when no message-bearing history found). This mirrors Phase 41 Plan 03's wire-protocol optionality treatment.
- **Discovery + tail scan dispatched per-session in parallel** within the same already-open SSH conn per host. Existing `resolveRoleForIdentity` pattern at `sessions.ts:108` is the template — `Promise.all(rows.map(async (row) => { ... }))`. Each per-session block wraps its own `Promise.race(PER_HOST_TIMEOUT_MS)` and try/catch so one slow discovery doesn't kill the host's row set. On per-session failure: `row.lastMessageAt = null`, log debug, continue.
- **Cost**: per-host bump from `1 × tmux list-sessions + N × frontmatter reads` to `1 × tmux list-sessions + N × (frontmatter read + discovery + tail)`. Parallel dispatch keeps the wall-clock close to a single per-session cost (~200-300ms observed for role resolve; discovery + tail should add ~100-200ms on top, dominated by the SSH round-trip cost, not the shell work).

### `ssh-poll-orchestrator.ts` swap

- **What changes**: the JSONL path derivation at `ssh-poll-orchestrator.ts:357-360` (`jsonlPathForSession(sessionJson.cwd, sessionJson.sessionId)`) is replaced by a call to `discoverIdentitySessionFile(conn, tmuxSession)` — where `tmuxSession` is the resolved-or-cached value from the same processPid pass (`cached?.tmuxSession ?? await resolvePidToTmuxSession(...)`). The `channel.exec(tail -n 200 ${jsonlPath} 2>/dev/null || true)` step stays but reads from the discovered path.
- **What stays**: `~/.claude/sessions/*.json` enumeration for PID discovery, `sessionJson.status`/`waitingFor`/`updatedAt` for status axes, `isStaleFromStat` for reaping, hook-payload parsing for backgroundTasks, fingerprint delta gating.
- **Timing**: discovery fires once per PID on the FIRST tick where we resolve tmuxSession, then caches the JSONL path in `PidCacheEntry` (new field: `jsonlPath: string | null`) so subsequent ticks just re-tail the cached path. Re-discovery only if the cached path returns a stale tail (unchanged mtime) for N consecutive ticks — defensive against Claude Code JSONL rotation mid-session. Practical: never re-discovers in most cases; a rotation event triggers rediscovery within ~10s of poll ticks.
- **Fallback if discovery returns null**: keep `lastMessageAt` at the cached-or-null value. Same fail-open semantics as today.

### Comparator change — retire no-history-to-top

- **Current Rule 1** (`conversation-store.ts:539-542`): `lastMessageAt == null` sorts BEFORE rows with any real timestamp. Retire this branch.
- **New Rule 1**: `lastMessageAt == null` sorts AFTER any real timestamp, with insertion-order-key stability among null-lastMessageAt rows. This means genuinely-no-history rows (fresh session pre-first-message; discovery failed; identity never invoked `/id`) sink to the bottom of the middle zone.
- **Alternative considered**: treat null as `lastMessageAt = 0` and intermix. Rejected — inserting no-history rows anywhere in the middle of the recency-sorted band would be more disorienting than a stable bottom band.
- **Rule 3** (real timestamps DESC) unchanged. **Rules 2/4** (insertion-order-key fallback for ties) unchanged.

### Non-goals / explicitly deferred

- Scroll-anchor engineering in the panel. Once the source is correct, the tier-flip churn drops sharply and the browser's default `overflow-anchor: auto` should suffice for the residual case. Revisit only if Ashley reports lingering scroll lurches after this ships.
- Any change to the message-bearing kind filter (still `message`, `image`, `relay_outbound`, `relay_inbound`). Ashley's Phase 42 lock — "activity = message either direction, and only that" — stands.
- Wire-protocol version bump. `lastMessageAt` already optional; source change is invisible to the wire.
- Retirement of the `~/.claude/sessions/<pid>.json → sessionJson.cwd + sessionId` machinery in the orchestrator entirely. The PID pipeline still owns status/backgroundTasks; only the JSONL PATH DERIVATION swaps. Leaving the PID-enumeration axis in place preserves the isWorking signal quality for live sessions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 32 discovery mechanism (consumed as-is)
- `src/backend/claude-session/discover-identity-session-file.ts` — the `discoverIdentitySessionFile()` function + `__matchesIdentityFirstTurnForTests` predicate + `DISCOVERY_EXEC_TIMEOUT_MS`. Read the header block for the WHY-BYTE-PATTERN + WHY-ONE-ROUND-TRIP + CALL-SITE-SCOPE rationale.
- `src/backend/claude-session/session-file-parser.ts` — `parseSessionLine`, `MESSAGE_BEARING_KINDS`-eligible shapes (`message`, `image`, `relay_outbound`, `relay_inbound`).

### Current failure-mode surface (what we're replacing)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` L100-115 (PidCacheEntry shape — add `jsonlPath`), L146-206 (message-bearing filter + scanTail helper), L342-386 (JSONL path derivation + tail scan block — the swap site).
- `src/backend/fleet-status/wire-protocol.ts` L82-112 (SessionState + optional `lastMessageAt`).

### /sessions/list route
- `src/backend/database/routes/sessions.ts` L40-160 (the handler, `TmuxSessionRow` shape, per-session parallel Promise.all pattern with resolveRoleForIdentity).

### Working-store + comparator
- `src/ui/state/session-working-store.ts` L44-100 (WorkingRecord + notify + subscribe), L279+ (`getSessionLastMessageAt`).
- `src/ui/state/conversation-store.ts` L473-509 (`compareByHostRoleLabel`), L511-553 (`compareByRecencyDesc` — Rule 1 retirement site), L555+ (`computeSnapshot`).

### Wire consumer + fleet-session state
- `src/ui/state/conversation-store.ts` L140-155 (`FleetSession` type), L938-1000 (`updateFleetSessions`, `removeFleetSession`).
- `src/ui/AppShell.tsx` fleet-sessions fetch call site (invokes `/sessions/list` and calls `updateFleetSessions`).

### Consuming panel (READ-ONLY reference; no changes)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L264-267 (`useConversations` destructure), L1088 (`.pv-panel-scroll` container).

### Phase 42 SUMMARY (context on current wire contract, comparator, no-history-to-top lock)
- `.planning/phases/42-conversation-list-*/42-CONTEXT.md`
- `.planning/phases/42-conversation-list-*/42-03-SUMMARY.md` (Plan 03 landed the lastMessageAt wire; Rule 1 lock was set here)

</canonical_refs>

<specifics>
## Specific Ideas

### Reconciliation helper (working-store API surface)

```ts
// src/ui/state/session-working-store.ts additions

/**
 * Advance the cached lastMessageAt for a session. Value-only-advances contract:
 * if the new ts is <= cached, no-op + no-notify. If cached is null or ts > cached,
 * write + notify.
 *
 * Called from BOTH the WS publish path (via publishFleetStatusSessionState) AND
 * the /sessions/list seed path (via seedSessionLastMessageAt). Single reconciliation
 * chokepoint.
 */
function advanceSessionLastMessageAt(key: string, ts: number | null): void { ... }

/**
 * Seed lastMessageAt from a /sessions/list payload row. Wrapper around
 * advanceSessionLastMessageAt that also creates a WorkingRecord if none exists
 * (isWorking defaults false — dormant sessions never touch the isWorking axis).
 */
export function seedSessionLastMessageAt(
  hostId: number,
  tmuxSession: string,
  ts: number | null,
): void { ... }
```

The existing `publishFleetStatusSessionState` internal write of `lastMessageAt` should be refactored to call `advanceSessionLastMessageAt` so both paths funnel through the same reconciliation.

### AppShell seed call site

After `updateFleetSessions(sessions)` in AppShell.tsx's `/sessions/list` handler, iterate `sessions` and call `seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null)`. Fits alongside the existing update.

### PidCacheEntry extension

```ts
interface PidCacheEntry {
  sessionId: string;
  tmuxSession: string | null;
  procStart: string;
  lastPublishedFingerprint: string;
  lastMessageAt: number | null;
  // NEW: cached JSONL path from discoverIdentitySessionFile.
  // Populated on first successful discovery; reused across ticks.
  // Set back to null to trigger re-discovery (rare — only if tail mtime
  // stops advancing for N consecutive ticks).
  jsonlPath: string | null;
}
```

### Comparator flip

```ts
// src/ui/state/conversation-store.ts:compareByRecencyDesc
// OLD:
if (aTs === null && bTs !== null) return -1;  // null-to-top
if (aTs !== null && bTs === null) return 1;
// NEW:
if (aTs === null && bTs !== null) return 1;   // null-to-bottom
if (aTs !== null && bTs === null) return -1;
```

Test file `conversation-store.test.ts` around L2789+ has the existing Rule 1 tests. Update them to match the flipped semantics; add coverage for the max-wins reconciliation (seed then WS advance; WS then seed with older value; identical ts no-op).

</specifics>

<deferred>
## Deferred Ideas

- Virtualization of the middle zone (Phase 27 territory). Only warranted if scroll performance regressions surface after this lands.
- Scroll-anchor explicit engineering. Same rationale — try correct-data-source first.
- Retiring the PID-enumeration axis of the orchestrator entirely (moving fully to tmux-session-based enumeration). Meaningful architectural shift; not needed for the recency signal fix.
- Broader message-bearing kind expansion. Ashley's lock stands.

</deferred>

<scope_fence>
## Scope Fence

**HARD BLOCKS (do not touch in this phase):**
- `src/backend/claude-session/discover-identity-session-file.ts` — Phase 32 module, consumed as-is.
- `src/backend/fleet-status/wire-protocol.ts` schema — no wire version bump; `lastMessageAt` already exists per Phase 41 Plan 03.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — no visible/interaction change.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — no scroll-container CSS changes.
- `~/.claude/sessions/<pid>.json` enumeration or `resolvePidToTmuxSession` — the PID pipeline stays intact.
- Fleet-status subscription lifecycle (Phase 39 presence-driven poller start/stop) — no changes.
- Any active-flow session-file discovery (`discoverClaudeSession` in `session-file-discovery.ts`).

**AREAS THAT MAY EXPAND (allowed in this phase):**
- `session-working-store.ts` API surface — new `seedSessionLastMessageAt` + `advanceSessionLastMessageAt` helpers.
- `TmuxSessionRow` shape in `sessions.ts` + downstream `FleetSession` type — additive optional field.
- `PidCacheEntry` in `ssh-poll-orchestrator.ts` — additive `jsonlPath` field.
- Test files for all touched modules.

</scope_fence>

---

*Phase: 44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i*
*Context authored: 2026-08-18 from operator ↔ Ashley conversation (no discuss-phase run — decisions locked inline).*
