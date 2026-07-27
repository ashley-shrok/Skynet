# Phase 15: Pinned conversations — server-side account-wide persistence - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Source:** Conversational agreement between Ashley and Tina 2026-07-27 (this session) after Ashley UAT-hit the bug: "pins are not working. they last only until i close the app." Followup-2 to patch #149 A/B/C. Tracker bounty: `~/.claude/identities/tina/bounties/skynet-transformation/` (folded into master per Ashley's one-project rule — conversation-list feature work is master, not sibling).

<domain>
## Phase Boundary

Move Ashley's pinned conversation IDs from Zustand in-memory state onto **server-side account-wide persistence** in the `skynet-data` SQLite volume, keyed to her authenticated user account. Fixes the concrete bug she hit 2026-07-27: pin a conversation, close the app (or the PWA on iPhone), reopen — pin is gone.

### What broke (root cause, verified in source)

`pinConversation` and `unpinConversation` at `src/ui/state/conversation-store.ts:755-780` mutate `state.pinnedIds` in-memory only — no `localStorage`, no `sessionStorage`, no server write. Patch #137 wrapped a sessionStorage persistence layer around `activeSet` (`ACTIVE_SET_STORAGE_KEY` at conversation-store.ts:107-146, plus persist calls in `selectConversation`/`removeFromActiveSet`) but pinnedIds got NO persistence layer at all. Result: pinnedIds dies on tab close, browser close, hard-refresh, and PWA close — every one of Ashley's normal daily actions.

### What this phase delivers

- **Server-side account-wide storage** for pinnedIds keyed to Ashley's authenticated user, living in the `skynet-data` SQLite volume alongside the existing user/identity records.
- **A per-user endpoint** for reading + writing the pinnedIds set (GET returns current, PUT/POST replaces or mutates).
- **Client-side store integration** in `conversation-store.ts`: fetch on init/mount, write on every `pinConversation`/`unpinConversation` call, optimistic UI, error-tolerant retry.
- **Cross-device sync**: pinning on desktop shows up on iPhone (and vice versa) within one natural mount/poll cycle. No manual reload.
- **No new UI surface.** Pin button, unpin button, and Deactivate action all already exist and render correctly (patch #149 A + gm3). This phase is a plumbing-and-persistence change, not a visual one — the plan-checker should NOT expect a UI-SPEC.md.

### What this phase does NOT deliver (scope fences)

- **No pin-ordering, pin-groups, pin-labels, or pin-metadata.** pinnedIds stays a flat Set of conversation IDs (fleet-row IDs from `fleetRowId(hostId, sessionName)` OR openTab IDs). Order in the pinned tier is determined by `computeSnapshot` iteration order as today, not by user drag/reorder.
- **No multi-user features.** The endpoint contract must not assume single-tenant (401 for other users), but there's no admin view, no pin-sharing, no per-user isolation UI. Ashley is the only user.
- **No new visual affordances.** Existing pin action UI at `PinAction.tsx` and the tier rendering in `PrettyConversationsPanel.tsx` are untouched.
- **No garbage collection of orphaned pinnedIds server-side (v1).** Orphaned IDs (host removed, session gone) are inert client-side per patch #149 A's snapshot iteration skip. Server can grow the set slowly; a v2 cleanup pass is deferred.
- **No offline queue / durable client-side retry beyond "next mount / next mutation."** If the server is down when a pin fires, the optimistic UI update stands and the mutation retries on the next natural sync. No IndexedDB-backed queue, no exponential-backoff retry loop.
- **No sessionStorage/localStorage fallback layer.** Server is authoritative; client never trusts a stale local cache. First render on mount waits for the server fetch OR shows an empty pinned tier that hydrates on fetch-complete — planner picks the specific UX (both are acceptable; see § Claude's Discretion).

</domain>

<decisions>
## Implementation Decisions

Locked from the 2026-07-27 conversation — do not re-litigate.

### Bug + fix intent (Ashley greenlit both)

- The bug is real and reproducible: pins die on tab/PWA close. Root cause is in-memory-only `pinnedIds` (conversation-store.ts:755-780).
- The fix is **server-side account-wide persistence**, not a localStorage stopgap. Ashley explicitly rejected the stopgap ("Let's do it right") — localStorage-only would have been a throwaway patch superseded by this work, and would not have synced desktop ↔ iPhone.
- The fix is **followup-2 to patch #149**. Patch #149 A made fleet-row pinning legal (removed openTabs-only guard); patch #149 B+C added the three-tier sort so pinned rows surface at the top. Followup-1 was the pruner fleet-aware fix (patch #150 A, shipped) and the URL-restore multi-tab glow (patch #150 C, shipped). This is the last piece: persistence.

### Data key + auth (locked)

- The server-side pinnedIds set is keyed to the **authenticated Skynet user** via the existing identity auth (cookie jar / JWT bearer). This is the same auth path used by `/identities`, `/host/db/host`, `/user-preferences`, and every other authenticated Skynet endpoint.
- Because Skynet is currently single-tenant (Ashley only), the practical set-size is one — but the endpoint contract MUST treat pinnedIds as per-user, not global. This future-proofs against multi-user + matches the existing user-preferences pattern.

### Storage lives in `skynet-data` SQLite volume (locked)

- The pinnedIds set is stored in the `skynet-data` docker volume — the same encrypted SQLite that holds host creds, SSH keys, identity records, and user preferences. NOT in a new volume, NOT in a JSON file on the filesystem.
- **Exact schema (table vs. column vs. JSON-blob-on-user-record) is Claude's Discretion** — see below.

### Persistence semantics (locked)

- Every `pinConversation(id)` and `unpinConversation(id)` call writes to the server. No debounce, no batching, no local-only mode. The write can be optimistic (UI updates immediately, mutation posts async) but the write MUST fire on every action.
- On PrettyConversationsPanel mount (and on any auth/identity change), the client fetches the current server-side pinnedIds and reconciles it into the local Zustand store. The server is authoritative; client never trusts a stale local cache.
- If the server is unreachable when the mutation fires, the UI still updates optimistically AND the mutation is retried on the next sync opportunity (next mount, next pin/unpin action). A pin action never leaves the UI stuck.

### Verification discipline (locked — learned from patch #77)

- If the chosen endpoint shape is multipart/form-data (extending `/identities` PUT would inherit this shape), every PUT MUST be followed by a GET-verify during the client's initial rollout window to prove the write stuck. Patch #77 caught the silent-200 no-op the hard way: a multipart PUT with the wrong field name or wrong Content-Type returns HTTP 200 with an unchanged response body and the write silently drops.
- If the endpoint shape is JSON (a new `/user/pins` GET+PUT would use this), the response body echoes the persisted state; optimistic reconciliation is safe from the response alone (no separate GET needed on each write).

### No sessionStorage/localStorage fallback layer (locked)

- Server is the single source of truth. No local persistence cache that could go stale relative to the server, no "warm cache from localStorage while waiting for server fetch" pattern. First-render behavior on mount is either (a) empty pinned tier that hydrates on fetch-complete or (b) fetch-blocking initial render — planner picks (both are acceptable; (a) is preferred for perceived responsiveness).

### Bundle-mate discipline (locked — batch-until-triggers rule)

- This phase's patches DO NOT ship immediately when the code lands. They batch with the pending `f9v + BTW + gm3` deploy queue (currently three-deep on `feat/tab-title-from-tmux`) OR ship as a solo deploy IF the pin bug is severe enough to trigger #3 ("actively broken in production Ashley is hitting") — TBD at deploy-recommendation time.
- Standard pre-warn applies (`HTTP2_PROTOCOL_ERROR` on first hard-refresh, close+reopen the tab spawns a fresh H2 connection).

### Anti-scope-creep held (per identity file § Skynet direction dead-surfaces canonical list)

- This phase does NOT touch: settings modal, AppRail, dashboard, snippets manager, host manager UI, admin console, file manager UI, top-level tab bar chrome, keyboard shortcut editor. Backend touches: `skynet-data` schema, one new (or extended) API route, one JWT-auth check reusing the existing middleware pattern. Frontend touches: `conversation-store.ts` (mutators + init hook + fetch), plus the panel mount effect wire-up. Nothing else.

</decisions>

<claude_discretion>
## Claude's Discretion

The following design decisions are for the planner to lock during plan-phase. Reasonable options are enumerated so the planner reasons across trade-offs before choosing.

### Storage shape (planner picks A vs. B)

- **Option A — New `pinned_conversations` table** (or equivalent Drizzle schema entry): rows are `(user_id, conversation_id, pinned_at)`. Endpoint reads via `WHERE user_id = ?` scan, writes via INSERT/DELETE. Natural for future extensions (pin timestamps, ordering, groups) but adds a schema migration.
- **Option B — JSON column on the existing user/identity row**: pinnedIds stored as `TEXT` (JSON-serialized array) on the existing user record. No schema migration if the row already has a `preferences` or similar JSON field. Writes are read-modify-write on the whole set. Simpler infrastructure; less natural for future per-pin metadata.

**Planner should pick based on:** what the existing user row already carries (see `src/backend/database/schema.ts` or equivalent Drizzle schema file), how the existing user-preferences endpoint at `/user-preferences` stores its blob (line 1793 in `database.ts` per patch #146 write-up), and whether the identity table has a JSON-shaped column that pinnedIds can slot into without a migration.

### Endpoint shape (planner picks A vs. B vs. C)

- **Option A — Extend the existing `/user-preferences` endpoint** (if pinnedIds fits naturally as another preference key alongside whatever's already there). Zero new routes, reuses existing auth middleware + JSON body contract. Silent-200 no-op risk depends on the endpoint's existing shape.
- **Option B — New `/user/pins` GET + PUT** with JSON body `{pinnedIds: string[]}`. Isolates the endpoint contract from other preferences; response echoes persisted state for optimistic reconciliation without a follow-up GET.
- **Option C — Extend the identity API** (`/identities/:id` PUT) with a `pinnedIds` field. Rejected by inspection: the identity endpoint is multipart/form-data with `parseMultipartMetadata` (see identity file § learned preference — the silent-200 no-op trap). Any extension inherits the multipart shape and its verification burden. If chosen anyway, the client MUST GET-verify every PUT.

**Planner should pick based on:** existing user-preferences endpoint contract shape, whether the identity table already carries a per-user preferences JSON blob, and defensive isolation (a new `/user/pins` route can be reasoned about, tested, and verified in isolation from other user data).

### Client-side integration pattern (planner picks)

- **Where does the fetch live?** — a `useEffect` in `PrettyConversationsPanel.tsx` on mount, OR an init function in `conversation-store.ts` called from the module top level, OR both (module init for the earliest fetch + a mount-time reconcile for auth/identity changes).
- **Optimistic-update reconciliation** — on server error, do we roll back the UI (revert `pinnedIds` to pre-mutation state) or leave the optimistic update and retry? Locked semantics: leave the optimistic update; retry on next sync opportunity. Planner picks the retry mechanism (a `pendingMutations` list in the store, OR fire-and-forget with next-mount reconcile as the retry cadence).
- **First-render UX** — see § "No sessionStorage/localStorage fallback layer" above. Prefer empty pinned tier that hydrates on fetch-complete (perceived-responsiveness win) unless there's a compelling reason to fetch-block the initial render.

### Migration of existing pinned state (planner locks)

- Ashley's currently-in-memory pinnedIds are ALREADY dead per her report ("pins are not working"). There is no live data to migrate — first pin post-deploy writes fresh.
- On rollout, the server-side pinnedIds set starts empty for her user; first pin writes creates the row/column. No migration script needed.

### Test coverage (planner scopes)

- Backend: endpoint tests covering GET-empty, GET-populated, PUT-add, PUT-remove, 401-unauthenticated, malformed-body-400, plus (if multipart) the field-name-drop silent-200 trap.
- Frontend: store tests covering fetch-on-mount, pin-writes-to-server, unpin-writes-to-server, error-tolerant retry, optimistic-update-persists-on-server-error, first-render-empty-then-hydrate.
- Integration: existing panel tests should keep passing unchanged (no visual regression); one new integration test proves the round-trip end-to-end at the store level.
- Baseline vitest count pre-phase: **619/619** (post-gm3, from handoff). Planner must state target and verify green.

</claude_discretion>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Client state + mutators (the bug lives here)

- `src/ui/state/conversation-store.ts` — Zustand store. `pinConversation` (L755-770), `unpinConversation` (L771-778), `togglePinConversation` (L779-782). Current in-memory-only implementation. Also holds the `activeSet` sessionStorage pattern (L107-146, `selectConversation` at L698-720, `removeFromActiveSet` at L722-753) that is the reference model for how the store's mutators can be augmented with persistence.
- `src/ui/state/conversation-store.test.ts` — companion test file. Baseline 44+ tests post-#150 A/C; contains beforeEach reset patterns to mirror.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — panel mount site. Currently subscribes to `usePinnedIds()`; will need to trigger the initial fetch on mount and reconcile.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — panel tests that assert pin/unpin flows; existing tests must remain green.
- `src/ui/features/pretty-conversations/PinAction.tsx` — UI component for the pin button. NOT modified in this phase (visual is done).

### Backend infrastructure (where the new endpoint slots in)

- `src/backend/database/database.ts` — main Express app wiring. Route registration site (see `app.use("/debug", debugRoutes)` at ~L1793 per patch #146 write-up for the pattern). Auth middleware imported from existing JWT setup.
- `src/backend/database/routes/` — router directory. Existing per-feature routers include `host-file-manager-bookmark-routes.ts`, per patch write-ups also `user-preferences.ts` (if it exists — planner verifies) and Phase 14's `debug.ts`. Add a new file here for the pins endpoint OR extend `user-preferences.ts`.
- `src/backend/database/schema.ts` (or equivalent Drizzle schema entry — planner locates) — schema definitions. If pinnedIds gets a new table, the entry goes here.
- Auth pattern — existing JWT/cookie middleware. Planner reads one existing authenticated route (e.g. `user-preferences.ts`, host CRUD in `host/db/host`) to mirror the middleware invocation.

### Nginx caveat (CLAUDE.md constraint, load-bearing)

- `docker/nginx.conf` AND `docker/nginx-https.conf` — if a new route path is added under a fresh top-level prefix (e.g. `/user/pins/*`), matching `location` blocks are required in BOTH files. Missing either causes the endpoint to 200 with `index.html` and crashes the frontend on the `.map` file. Extending an existing prefix that ALREADY has a `location` block (e.g. adding an endpoint under `/user-preferences`) does not need new nginx entries.

### Existing endpoint patterns for reference

- `src/backend/database/routes/debug.ts` — recent (patch #146) example of a new authenticated router: auth check, POST handler, function-level exported handler for direct testing (avoids AuthManager 5s singleton timeout in test harness). Test file `debug.test.ts` mirrors the pattern.
- Any `user-preferences.ts` router (planner verifies existence) — the CLOSEST-shape analog. If pinnedIds fits under `/user-preferences`, this is the natural extension.
- Identity API PUT — `src/backend/database/database.ts` `router.put("/identities/:id", ...)` — DO NOT extend for pins (multipart trap). Read only to understand what to AVOID.

### Patch history to consult (skynet-patches.md)

- **Patch #77** (multipart silent-200 no-op) — the verification-discipline lesson. Read before deciding endpoint shape.
- **Patch #137** (`activeSet` sessionStorage persistence) — the reference pattern for augmenting a Zustand mutator with a persistence layer. This phase adds an equivalent server-side pattern.
- **Patch #146** (log-forwarder debug endpoint) — recent example of adding a new authenticated router with nginx wiring in both configs.
- **Patch #149 A + B + C** (fleet-row pinning legal + three-tier sort) — the shipping-context patches that make server-side pinning worth the effort.

### Bounty tracker

- `~/.claude/identities/tina/bounties/skynet-transformation/bounty.json` — master bounty for the Ship-of-Theseus movement (per Ashley's one-project rule). This phase's timeline entries land here, NOT in a sibling bounty.

</canonical_refs>

<specifics>
## Specific Ideas

- **Optimistic UI pattern** — mirror the sessionStorage silent-catch pattern already used in `selectConversation` (conversation-store.ts:698-720): try/catch around the server call so a network failure doesn't crash the store; UI update fires first, server write follows, response reconciled if successful.
- **Fetch-on-mount** — reuse the existing panel mount `useEffect` at `PrettyConversationsPanel.tsx:162-164` (the one that calls `addToActiveSet(selectedId)` per patch #144) as the reference site for where the pin fetch effect goes. It fires on selectedId change AND initial mount, which is the right cadence.
- **Auth middleware reuse** — read `src/backend/database/routes/debug.ts` (patch #146) as the recent reference for how a new router bolts into the existing auth flow. Do NOT reinvent auth.
- **Function-level handler export** — mirror patch #146's `handleConsoleLog()` extraction so backend tests can hit the handler directly, bypassing the AuthManager 5s singleton init timeout in the Express test harness.
- **Response body echoes persisted state** — if the endpoint returns the current pinnedIds set on every PUT response, the client can reconcile from the response body alone (no separate GET-verify per write). This is the JSON-body advantage over multipart.
- **Store test harness** — reuse `conversation-store.test.ts` beforeEach reset patterns. New tests slot in as `Test 30j`+ following the numbering convention.

</specifics>

<deferred>
## Deferred Ideas

Not v1 — earned their way in later if pin usage patterns demand them.

- **Pin ordering / drag-to-reorder.** pinnedIds stays a flat Set; iteration order is `computeSnapshot`'s natural order.
- **Pin groups / pin labels / pin metadata.** A pinned conversation is a bare ID; no per-pin data.
- **Server-side garbage collection of orphaned pinnedIds.** Client already skips orphans in snapshot iteration; server can accumulate.
- **Offline-queue / durable client-side retry beyond next-sync.** No IndexedDB backing store, no exponential-backoff retry loop.
- **Pin-sharing across users.** Skynet is single-tenant; endpoint contract is per-user for defense-in-depth but no sharing UI.
- **Migration script for existing pinnedIds.** Ashley's in-memory pinnedIds are dead per her report; no live data to migrate.
- **Real-time push (WebSocket) for cross-device sync.** v1 syncs on next mount / next mutation; if desktop ↔ iPhone latency proves intolerable, a WebSocket push on pinnedIds change is a natural v2 (the pretty-view WSS at port 30011 in `claude-session-server.ts` is the obvious vehicle).

</deferred>

---

*Phase: 15-pinned-conversations-server-side-account-wide-persistence*
*Context gathered: 2026-07-27 via conversational session with Ashley + Tina after Ashley UAT-hit the pin-persistence bug*
