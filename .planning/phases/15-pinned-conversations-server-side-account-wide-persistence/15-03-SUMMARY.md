---
phase: 15-pinned-conversations-server-side-account-wide-persistence
plan: 3
subsystem: frontend
tags: [frontend, react, mount-effect, integration, panel, phase-15, wave-3, human-verify-pending]
requirements: [PIN-01, PIN-02, PIN-04, PIN-05]
dependency_graph:
  requires:
    - phase: 15-plan-1
      provides: "GET /user-preferences returning pinnedConversationIds + PUT echoing parsed array"
    - phase: 15-plan-2
      provides: "getPinnedIds() from @/api/user-preferences-api + hydratePinnedIdsFromServer(ids) from @/state/conversation-store"
  provides:
    - "PrettyConversationsPanel mount-effect that fetches server pins on mount + hydrates the Zustand store"
    - "Cancel-token guard against post-unmount hydrate for React 18 StrictMode double-mount + real navigate-away"
    - "Silent try/catch on GET failure — pinnedIds stays as-is; next remount refetches"
    - "One new integration test (Test 21) asserting the mount → fetch → hydrate round-trip"
  affects:
    - "End-to-end pin persistence: Ashley's pin now survives tab/PWA close and syncs across devices on next mount (pending deploy)"
tech_stack:
  added: []
  patterns:
    - "PATTERNS.md § 5 panel mount-effect (cancel-token + async IIFE + silent-catch)"
    - "Sibling-effect placement (immediately after L182-184 addToActiveSet effect — NO modification of the neighbor)"
    - "vi.mock('@/api/user-preferences-api') with per-test mockResolvedValueOnce for the fixture path"
key_files:
  created: []
  modified:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
decisions:
  - "First-render UX: empty pinned tier hydrates on fetch-complete (Option a — locked at plan time per CONTEXT.md § Claude's Discretion)"
  - "Retry cadence: no explicit retry inside the effect; next pin/unpin click (fires PUT with current in-memory set) OR next remount (fresh GET) is the retry surface"
  - "Cancel-token pattern: cancelled boolean captured in the effect closure; cleanup sets cancelled=true; resolve branch early-returns before hydrate"
  - "Mock strategy: getPinnedIds default resolves [] in beforeEach so pre-existing 26 tests observe unchanged empty pinned tier post-mount-fetch"
  - "Integration test (Test 21) uses waitFor() for the microtask flush after getPinnedIds resolves — asserts getPinnedIds called once + hydratePinnedIdsFromServer called once with fixture array"
metrics:
  duration: "~10 min"
  completed: "2026-07-27"
  commits: 1
  test_count_delta: "+1 (639 -> 640)"
  files_created: 0
  files_modified: 2
---

# Phase 15 Plan 3: Panel mount-effect + integration test (Wave 3 frontend) Summary

Landed the read-side plumbing for Phase 15: on `PrettyConversationsPanel` mount, an async `useEffect` fires `getPinnedIds()` (Wave 2 api-client) and, on success, calls `hydratePinnedIdsFromServer(ids)` (Wave 2 store setter). This completes the end-to-end round-trip — Wave 1 backend + Wave 2 store + Wave 3 panel = Ashley's pins now survive tab/PWA close and sync across devices on next mount (pending deploy). One new integration test (Test 21) asserts the mount → fetch → hydrate wiring.

**Human-verify checkpoint (Task 2) — pending.** Per plan §autonomous:false, the executor lands the code + integration test and stops. Ashley (or the dev operator) runs the 4-step UAT below to unblock the phase completion.

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-27T13:55:00Z
- **Completed (code):** 2026-07-27T14:00:00Z
- **Tasks:** 1 code task complete (Task 1); Task 2 is a human-verify checkpoint awaiting Ashley
- **Files created:** 0
- **Files modified:** 2

## Accomplishments (Task 1 — code + integration test)

- **New mount-effect in `PrettyConversationsPanel.tsx`** (28 lines including 15-line header comment): sibling of the L182-184 patch #144 `addToActiveSet(selectedId)` effect, NOT a modification. Empty-deps → fires once per mount. Async IIFE awaits `getPinnedIds()`; cancel-token (`let cancelled = false` in the effect closure) guards the resolve branch with `if (cancelled) return;` before calling `hydratePinnedIdsFromServer(ids)`. Cleanup returns `() => { cancelled = true; }` to catch React 18 StrictMode double-mount in dev + real navigate-away in production (T-15-13 + T-15-14 mitigations). Silent try/catch on failure — pinnedIds stays as-is; next remount refetches (T-15-12 mitigation).

- **Two new imports at the top of `PrettyConversationsPanel.tsx`**:
  - `hydratePinnedIdsFromServer` added to the existing `@/state/conversation-store` import block (alongside `addToActiveSet`, `removeFromActiveSet`, etc.)
  - `getPinnedIds` from `@/api/user-preferences-api` — new import line, matches the `@/*` alias convention used elsewhere in the file

- **New integration test (Test 21) in `PrettyConversationsPanel.test.tsx`** — describe block "PrettyConversationsPanel (Phase 15): server-hydration on mount":
  - Mocks `getPinnedIds` to `mockResolvedValueOnce(["fleet::1::work", "t-A"])`
  - Renders the panel with a minimal grouped snapshot
  - Asserts `getPinnedIds` was called exactly once synchronously on mount
  - Uses `waitFor()` to flush the resolve microtask; asserts `hydratePinnedIdsFromServer` was called exactly once with the fixture array

- **`vi.mock` for `@/api/user-preferences-api`** at test-file module top — default `getPinnedIds` resolves `[]`, matching the pre-Wave-3 observable behavior of the panel (empty pinned tier post-mount-fetch). This is why the 26 pre-existing panel tests remain green with zero modification.

- **`hydratePinnedIdsFromServer` added to the existing `vi.mock('@/state/conversation-store', ...)`** as a spy — mirrors the `addToActiveSet`/`removeFromActiveSet` spy pattern already established by patch #144 Fix (d) and quick-260727-gm3.

- **`beforeEach` re-arms the `getPinnedIds` default** with `mockResolvedValue([])` after `vi.clearAllMocks()` wipes it — necessary because `clearAllMocks` clears the resolved-value memoization too.

## Design decisions (locked per plan, honored during execution)

### Sibling-effect placement (not modification)

The new mount-fetch effect is added immediately AFTER the L182-184 patch #144 `useEffect(() => { if (selectedId) addToActiveSet(selectedId); }, [selectedId])` effect. The two effects are independent — different dependency arrays, different concerns, different lifetimes. Combining them (e.g. re-fetching on every `selectedId` change) would be over-eager and violate the "fetch on mount, not on every selection" locked design.

### First-render UX: Option (a) — empty pinned tier hydrates on fetch-complete

Per plan §objective (CONTEXT.md § Claude's Discretion): the panel renders immediately with an empty pinned tier and the fetch resolves in a microtask, popping pinned rows in when the response lands. Rationale: (1) perceived responsiveness, (2) matches the neighboring `addToActiveSet(selectedId)` effect at L182-184 which fires on mount without blocking render, (3) matches the flat conditional list pattern already used for `fleetSessions` and `openTabs`.

### Silent try/catch on failure

A failed GET (server unreachable, 500, 401 pre-auth race) does NOT crash the panel — `pinnedIds` stays as-is (empty on first mount, whatever's in memory on subsequent mounts). Natural retry surfaces: (a) any subsequent pin/unpin click fires a PUT with the current in-memory set (Wave 2 augmentation), (b) the next remount fires a fresh GET. Matches 15-CONTEXT.md § Deferred: "No offline queue / durable client-side retry beyond next-sync."

### Cancel-token pattern (T-15-13 + T-15-14 mitigations)

`let cancelled = false` is captured in the effect closure. On unmount, the cleanup function sets `cancelled = true`. The resolve branch checks `if (cancelled) return;` BEFORE calling `hydratePinnedIdsFromServer(ids)`, preventing a stale response from an unmounted effect from touching store state. Guards against React 18 StrictMode double-mount in dev + real navigate-away in production. No existing effect in this file uses the pattern (the addToActiveSet effect is synchronous), but it's standard React and mirrors PATTERNS.md § 5 verbatim.

### Mock strategy for the 26 pre-existing tests

`vi.mock('@/api/user-preferences-api', ...)` intercepts ALL calls from the panel. `getPinnedIds` defaults to `mockResolvedValue([])` — the mount effect fires on every render but resolves with an empty array, meaning `hydratePinnedIdsFromServer([])` is called. Since the mocked store's `hydratePinnedIdsFromServerSpy` is a no-op spy (doesn't touch snapshot), the panel's observable rendering is unchanged from pre-Wave-3. All 26 existing tests remain green with zero modification.

## Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean (exit 0, no output) |
| `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | **27 passed / 1 file** (26 baseline + 1 new = 27) |
| `npx vitest run` (full sweep) | **640 passed / 50 files** (639 baseline + 1 new = 640) |
| `npm run build` | clean (`✓ built in 4.67s`) |
| `grep -c "getPinnedIds" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 2 (import + one call inside the mount effect — matches ≥ 2) |
| `grep -c "hydratePinnedIdsFromServer" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 2 (import + one call in resolve branch — matches ≥ 2) |
| `grep -c "cancelled = true" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 (cleanup function — matches ≥ 1) |
| `grep -c "if (cancelled) return" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 (guard before hydrate — matches ≥ 1) |
| `grep -c "addToActiveSet(selectedId)" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 (L182-184 patch #144 neighbor effect UNCHANGED) |
| Files changed under `src/ui/features/pretty-conversations/` besides Panel.tsx / Panel.test.tsx | 0 (verified — PinAction.tsx, PrettyConversationRow.tsx, others UNTOUCHED) |

## Deviations from Plan

**None.** Plan executed as written. Zero deviations, zero surprises.

Minor mock-strategy detail worth documenting for future readers: the `beforeEach` needed to be `async` and re-arm `vi.mocked(getPinnedIds).mockResolvedValue([])` after `vi.clearAllMocks()` — because `clearAllMocks` wipes the resolved-value memoization along with call history. This is a Vitest gotcha rather than a plan deviation; the plan § Action explicitly said "reset the getPinnedIds mock (mockClear + mockResolvedValue empty array as the default)."

## Auth gates

None encountered. The vi.mock intercepts the axios layer entirely; no real auth flow is exercised at test time. Wave 3's human-verify (Task 2) will exercise the real auth path in the browser.

## Confirmation: no nginx changes were needed across all three plans

- **Wave 1 (backend):** grep-verified twice — `location ~ ^/user-preferences(/.*)?$` block already exists in both `docker/nginx.conf` L258 and `docker/nginx-https.conf` L265. Extending the existing endpoint (Option A) inherits the existing block.
- **Wave 2 (store):** no route changes at all — pure client-side wiring around Wave 1's endpoint contract.
- **Wave 3 (panel):** no route changes at all — pure component wiring around Wave 2's api-client + store surface.

`git diff --stat docker/` for the entire phase returns empty. **No nginx changes needed anywhere in Phase 15.**

## Handoff note for the deploy-orchestrator

This phase's patches batch with the pending **f9v + BTW + gm3 deploy queue** on `feat/tab-title-from-tmux` (currently three-deep per 15-CONTEXT.md § Bundle-mate discipline) OR ship as a solo deploy IF the pin-bug severity triggers #3 ("actively broken in production Ashley is hitting") — decision made at deploy-recommendation time by Ashley.

Standard pre-warn applies: `HTTP2_PROTOCOL_ERROR` on first hard-refresh after deploy; close+reopen the tab spawns a fresh H2 connection.

The phase does NOT trigger a database migration on boot beyond what Wave 1 already added (the `addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT")` migration is idempotent on existing volumes and picked up on fresh volumes via `CREATE TABLE IF NOT EXISTS`).

## UAT steps for Ashley (Task 2 human-verify — VERBATIM from plan)

Verify in a running dev Skynet instance (localhost or ashley's dev environment — Ashley picks). The deploy to term.gigaashley.click is intentionally NOT part of this phase — deploy is a separate step batched into the pending f9v + BTW + gm3 deploy queue per CONTEXT.md § Bundle-mate discipline.

### Step 1 — Backend contract check

1. Boot the backend (npm run dev or docker compose up as appropriate for the dev env). Confirm the pinned_conversation_ids column was added to user_preferences on boot: `sqlite3 /path/to/skynet-data/db.sqlite "PRAGMA table_info(user_preferences);"` — the row list must include `pinned_conversation_ids|TEXT|...`
2. `curl -s -X GET http://localhost:30001/user-preferences -H "Cookie: jwt=$YOUR_JWT" | jq .` returns JSON including `"pinnedConversationIds": []`
3. `curl -s -X PUT http://localhost:30001/user-preferences -H "Cookie: jwt=$YOUR_JWT" -H "Content-Type: application/json" -d '{"pinnedConversationIds":["test-1"]}' | jq .` returns `{success: true, ..., pinnedConversationIds: ["test-1"]}`
4. Follow-up GET returns `"pinnedConversationIds": ["test-1"]` (round-trip persisted)
5. Unauth curl (no cookie): `curl -s -X GET http://localhost:30001/user-preferences` returns 401 with `{error: "Missing authentication token"}`

### Step 2 — Frontend end-to-end (browser DevTools console open)

1. Open Skynet in the dev browser session; wait for the pretty-conversations panel to mount
2. Confirm mount fetch: DevTools Network tab shows exactly ONE `GET /user-preferences` request within the first second of mount, returning 200 with a pinnedConversationIds field
3. Pin any conversation via the panel's pin action (mobile swipe or desktop hover)
4. Confirm write: Network tab shows a `PUT /user-preferences` request with request body `{"pinnedConversationIds":[<the-id>]}`, response 200 with the echoed set
5. Hard-refresh the browser (Ctrl+Shift+R or Cmd+Shift+R)
6. After remount: the pinned conversation still appears in the pinned tier at the top of the panel — this proves PIN-01 (survives close/refresh)
7. Unpin the conversation via the pin action
8. Confirm write: Network tab shows PUT with `{"pinnedConversationIds":[]}` — the empty array persists (unpin-all is legal per Wave 1 validation)

### Step 3 — Desktop ↔ mobile sync (skip if no iPhone available in dev)

1. On desktop, pin conversation X
2. On iPhone PWA, pull-to-refresh or close+reopen the PWA
3. Conversation X appears in the pinned tier at the top on iPhone — proves PIN-02

### Step 4 — Error tolerance smoke

1. Stop the backend (Ctrl+C or docker compose stop skynet)
2. In the frontend (still-open browser), pin/unpin conversations rapidly
3. UI updates optimistically without hanging or crashing (proves PIN-05 optimistic-persists-on-error)
4. Restart backend
5. Trigger a remount (navigate away and back, or reload) — the panel refetches; the server pins from before the outage are restored (proves next-mount reconcile is the retry cadence)

### Resume signal

Type "approved" if all four steps pass. If a step fails, describe the specific step + observed vs expected behavior, and note whether it's a Wave 1 (backend), Wave 2 (store), or Wave 3 (panel) issue for revision routing.

## Commit trail

| SHA | Type | Description |
|-----|------|-------------|
| `4c09264` | feat(pretty-conversations) | mount-fetch server pins + integration test (Phase 15 Wave 3) |

## Self-Check: PASSED

- `.planning/phases/15-pinned-conversations-server-side-account-wide-persistence/15-03-PLAN.md`: FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`: FOUND (contains new mount-effect + both new imports; L182-184 addToActiveSet neighbor UNCHANGED)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`: FOUND (contains Test 21 integration test + vi.mock for user-preferences-api + hydratePinnedIdsFromServer spy)
- Commit `4c09264`: FOUND in git log

## Human-verify checkpoint status

**PENDING.** Task 2 (checkpoint:human-verify, gate="blocking") awaits Ashley (or dev operator) to run the 4-step UAT above and reply with "approved" or a wave-attributed failure description.

The executor has landed the code + integration test per plan §autonomous:false and returns control to the orchestrator for Ashley's verification step.

---
*Phase: 15-pinned-conversations-server-side-account-wide-persistence*
*Wave 3 code landed: 2026-07-27*
*Human-verify checkpoint: pending Ashley approval*
