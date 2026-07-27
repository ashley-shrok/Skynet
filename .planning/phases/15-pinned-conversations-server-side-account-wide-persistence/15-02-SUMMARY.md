---
phase: 15-pinned-conversations-server-side-account-wide-persistence
plan: 2
subsystem: frontend
tags: [frontend, zustand, api, conversation-store, optimistic-ui, phase-15, wave-2]
requirements: [PIN-03, PIN-04, PIN-05, PIN-08]
dependency_graph:
  requires:
    - phase: 15-plan-1
      provides: "PUT /user-preferences accepting pinnedConversationIds + response body echoing parsed array"
  provides:
    - "getPinnedIds() / putPinnedIds() api-client wrappers around authApi (@/api/user-preferences-api)"
    - "pinConversation/unpinConversation fire fire-and-forget PUT on every non-idempotent call"
    - "hydratePinnedIdsFromServer(ids) — server-authoritative reconciliation setter with same-content guard"
    - "__resetPinnedIdsForTest() helper for beforeEach isolation"
    - "SC6 rollout scaffold: console.warn on server-echo mismatch (JSON-endpoint equivalent of patch #77 GET-verify)"
  affects:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (Wave 3 will import getPinnedIds + hydratePinnedIdsFromServer for panel-mount effect)"
tech_stack:
  added: []
  patterns:
    - "compose-drafts-api.ts JSON-wrapper shape (authApi + handleApiError + validated array extraction)"
    - "Variant B store mutator augmentation (addToActiveSet:713-722 silent-catch mirror)"
    - "Same-content guard (updateFleetSessions L611-625 mirror) for gratuitous-notify avoidance"
    - "vi.importActual scope-bypass to test the real api-client while the module is otherwise mocked"
key_files:
  created:
    - "src/ui/api/user-preferences-api.ts"
  modified:
    - "src/ui/state/conversation-store.ts"
    - "src/ui/state/conversation-store.test.ts"
decisions:
  - "Variant B (Task 1 Action) locked: try/catch around void putPinnedIds([...nextPinnedIds]) BEFORE state mutation, mirroring addToActiveSet:713-722 literally"
  - "New file src/ui/api/user-preferences-api.ts created (not co-located in open-tabs-api.ts) — matches per-domain naming convention of debug/compose-drafts/message-queue"
  - "SC6 rollout scaffold runs on EVERY put — deep-compare echoed vs input, console.warn on divergence, do NOT throw (server authoritative)"
  - "Test 30p uses vi.importActual to bypass the module mock and exercise the real putPinnedIds against a mocked authApi.put"
  - "Info #7 no-module-init guard satisfied: hydratePinnedIdsFromServer appears exactly once in conversation-store.ts (only the declaration line — never called from module top-level)"
metrics:
  duration: "~20 min"
  completed: "2026-07-27"
  commits: 2
  test_count_delta: "+7 (632 -> 639)"
  files_created: 1
  files_modified: 2
---

# Phase 15 Plan 2: Store integration for server-side pinned conversation IDs (Wave 2 frontend) Summary

Wired the Zustand conversation-store to the /user-preferences endpoint from Wave 1. Every pinConversation/unpinConversation call now fires a fire-and-forget PUT with the optimistic post-mutation set; failures leave the UI intact and reconcile on next natural sync. A new hydratePinnedIdsFromServer setter accepts the server-authoritative array with a same-content guard, ready for Wave 3's panel-mount effect to call.

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-27T13:35:00Z
- **Completed:** 2026-07-27T13:50:00Z
- **Tasks:** 2 (Task 1 api client, Task 2 store augmentation + tests)
- **Files created:** 1 (`src/ui/api/user-preferences-api.ts`)
- **Files modified:** 2 (`src/ui/state/conversation-store.ts`, `src/ui/state/conversation-store.test.ts`)

## Accomplishments

- **`getPinnedIds()` + `putPinnedIds()` client wrappers** land at `src/ui/api/user-preferences-api.ts` (55 lines) with `handleApiError` rethrow parity to `compose-drafts-api.ts` and defensive `Array.isArray + typeof string` validation on both extraction paths. The response echo is what `putPinnedIds` returns — Wave 3 can reconcile from the PUT response alone.
- **`pinConversation` and `unpinConversation` fire the network write** via a silent try/catch around `void putPinnedIds([...nextPinnedIds])` immediately BEFORE state mutation + notify(), mirroring `addToActiveSet` at conversation-store.ts:713-722 verbatim. `togglePinConversation` inherits the persistence side-effect via existing delegation — no change needed.
- **`hydratePinnedIdsFromServer(ids)` reconciles from server** with a same-content guard (size + membership) that mirrors `updateFleetSessions` at L611-625. Wave 3's panel-mount effect can call this after a successful GET without worrying about gratuitous re-renders on identity responses.
- **PIN-05 optimistic-persists-on-error semantics verified** by Test 30n: when `putPinnedIds` rejects, `state.pinnedIds` still contains the id after the microtask queue flushes.
- **SC6 rollout scaffold** (plan-checker Blocker #1 fix) lands in `putPinnedIds`: deep-compare input vs echoed on every PUT; on divergence, `console.warn("[pin-persistence] server echo mismatch", {sent, echoed})`. This is the JSON-endpoint equivalent of the patch #77 GET-verify-after-PUT lesson generalized — silent-drop regressions in the /user-preferences echo path get an alarm; server is authoritative and the client just logs.
- **Test count grew by 7** (Tests 30j through 30p) — the full frontend + backend suite goes from 632 to **639 passing / 50 files**.

## Task Commits

Each task was committed atomically:

1. **Task 1: user-preferences-api client** — `2e4178b` (feat)
2. **Task 2: store augmentation + tests 30j-30p** — `26c8df5` (feat, TDD-adjacent — mutator behavior + tests landed together per plan §4)

## Files Created/Modified

- **CREATED** `src/ui/api/user-preferences-api.ts` (+55 lines) — thin `getPinnedIds()` + `putPinnedIds()` wrappers around `authApi` with SC6 echo-mismatch warn scaffold in `putPinnedIds`.
- **MODIFIED** `src/ui/state/conversation-store.ts` (+49 lines) — added `putPinnedIds` import; wired `pinConversation` + `unpinConversation` with silent-catch fire-and-forget PUT; added `hydratePinnedIdsFromServer` setter with same-content guard; added `__resetPinnedIdsForTest` test helper.
- **MODIFIED** `src/ui/state/conversation-store.test.ts` (+208 lines) — added `vi.mock("@/api/user-preferences-api", ...)` at module top; wired `__resetPinnedIdsForTest()` + spy `mockClear` into `beforeEach`; added `hydratePinnedIdsFromServer` + `__resetPinnedIdsForTest` + `UserPreferencesApi` imports; added `describe("conversation-store (Phase 15): pinnedIds ↔ server persistence", ...)` with Tests 30j-30p (7 tests).

## Design decisions (locked per plan, honored during execution)

### Variant B locked (store mutator shape)

Chose Variant B from PATTERNS.md §4 — try/catch around `void putPinnedIds([...nextPinnedIds])` BEFORE state mutation + notify(). Rationale (from plan §objective): literal parallelism to `addToActiveSet:713-722` — one convention across all persistence-augmented mutators. Variant A (fire-and-forget after state mutation) would produce identical UI semantics but diverge stylistically from the sessionStorage precedent.

### Import path hardcoded (Warning #4)

Used exactly `import { putPinnedIds } from "@/api/user-preferences-api";` in the store and `import { authApi, handleApiError } from "@/main-axios";` in the api file — byte-for-byte matches the convention across identities-api.ts, compose-drafts-api.ts, sessions-api.ts, settings-api.ts. Zero conditional resolution.

### SC6 rollout scaffold placement (Blocker #1 fix)

The `console.warn("[pin-persistence] server echo mismatch", {sent, echoed})` runs inside `putPinnedIds` on every put — not gated on a rollout-window flag. Rationale: the warn is cheap (single deep-equal compare on a bounded array), only fires on actual mismatch, and provides the substrate the SC6 rollout window relies on to detect silent-drop regressions. Server is authoritative — the return value is always the echoed array (falls back to input if the response shape is malformed).

### Test 30p uses vi.importActual (bypass module mock)

The api-client is mocked at module top for the store tests (so `pinConversation` doesn't fire real HTTP). But Test 30p needs the REAL `putPinnedIds` to exercise its comparison logic. Solution: `vi.importActual<typeof import("@/api/user-preferences-api")>("@/api/user-preferences-api")` inside the test scope, combined with `vi.spyOn(authApi, "put").mockResolvedValueOnce({data: {pinnedConversationIds: ["b", "a"]}})` to control the response. This pattern is already used elsewhere in the codebase (see `src/backend/database/routes/user-preferences.test.ts:139`).

### Info #7 no-module-init guard satisfied

`hydratePinnedIdsFromServer` appears exactly once in `conversation-store.ts` — only the declaration line at L809 (`export function hydratePinnedIdsFromServer(ids: string[]): void`). It is NEVER called from module top-level. Wave 3 will invoke it via named import from PrettyConversationsPanel's mount effect. This prevents the "local-cache anti-pattern" CONTEXT.md § "No sessionStorage/localStorage fallback layer" forbids.

## Test 30j ordering guard (Warning #5 fix)

Test 30j asserts `expect(putSpy).toHaveBeenCalledWith(["t-A"])` with the comment `// ordering guard: put must receive the post-mutation set (["t-A"]), NOT the pre-mutation set ([])` — a future refactor that swaps compute-then-put ordering (passing `state.pinnedIds` instead of `nextPinnedIds`) would silently drift pins on the server. The test's expected value distinguishes post-mutation from pre-mutation by content.

## Test 30p SC6 warn assertion

Test 30p passes: given `authApi.put` returns `{data: {pinnedConversationIds: ["b", "a"]}}` for input `["a", "b"]`, `putPinnedIds` returns the echoed `["b", "a"]` (server authoritative) AND `console.warn` was called exactly once with `"[pin-persistence] server echo mismatch"` + a payload containing `{sent: ["a", "b"], echoed: ["b", "a"]}`.

## Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean (exit 0, no output) |
| `npx vitest run src/ui/state/conversation-store.test.ts` | **55 passed / 1 file** (48 baseline + 7 new = 55) |
| `npx vitest run` (full sweep) | **639 passed / 50 files** (632 baseline + 7 new = 639) |
| `npm run build` | clean (`✓ built in 4.25s`) |
| `grep -c "putPinnedIds" src/ui/state/conversation-store.ts` | 3 (import + pinConversation + unpinConversation call — matches plan ≥ 3) |
| `grep -c "hydratePinnedIdsFromServer" src/ui/state/conversation-store.ts` | 1 (declaration only — see § "Deviations" below for spec-vs-baseline note) |
| `grep -n "hydratePinnedIdsFromServer" src/ui/state/conversation-store.ts` | 1 hit at L809 (declaration line — never called from module top-level; Info #7 guard passes) |
| `grep -n "@/main-axios" src/ui/api/user-preferences-api.ts` | 1 (L1 — import line byte-exact) |
| `grep -n "server echo mismatch" src/ui/api/user-preferences-api.ts` | 1 (L46 — the console.warn string) |
| `grep -c "\[pin-persistence\] server echo mismatch" src/ui/api/user-preferences-api.ts` | 1 (Blocker #1 scaffold present) |
| `grep -v '^//' src/ui/api/user-preferences-api.ts \| grep -c "console.warn"` | 1 (only the mismatch warn — no other console noise) |
| `grep -c "__resetPinnedIdsForTest" src/ui/state/conversation-store.ts` | 1 (the export) |
| `grep -c "__resetPinnedIdsForTest()" src/ui/state/conversation-store.test.ts` | 1 (called in beforeEach) |
| `grep -n "ordering guard" src/ui/state/conversation-store.test.ts` | 1 (Warning #5 assertion in Test 30j) |
| `grep -n "pin-persistence\|server echo mismatch" src/ui/state/conversation-store.test.ts` | 2 (Test 30p — describe name + assertion) |
| Regression: `conversation-store (Patch #149 A): fleet-only rows are pinnable` | passes (single test run, 1 passed / 54 skipped) |

## Deviations from Plan

### Grep-count imprecisions (intent-satisfied, no code change)

**1. [Plan-vs-baseline note] `handleApiError` grep count expected 2 but returns 3.**
- **Found during:** Task 1 acceptance-criteria verification.
- **Issue:** Plan §Task 1 acceptance says `grep -c "handleApiError" src/ui/api/user-preferences-api.ts` returns exactly 2 (used in both function try/catches). Actual returns 3 — the import line also matches. The analog `compose-drafts-api.ts` returns the same 3 (`import` + 2 catches).
- **Intent satisfied:** Both function try/catches wrap `handleApiError(error)` — the count matches compose-drafts-api.ts convention verbatim.
- **No code change made.** Documented for Wave 3 executor as spec imprecision mirror of Wave 1's `authenticateJWT` note.

**2. [Plan-vs-baseline note] `hydratePinnedIdsFromServer` grep count expected ≥ 2 but returns 1.**
- **Found during:** Task 2 acceptance-criteria verification.
- **Issue:** Plan §Task 2 acceptance says `grep -c "hydratePinnedIdsFromServer" src/ui/state/conversation-store.ts` returns at least 2 (function declaration + export). Actual returns 1 — the declaration IS the export (`export function hydratePinnedIdsFromServer(ids: string[]): void`), so it counts as 1 line / 1 grep hit. A separate `export {hydratePinnedIdsFromServer}` block would give 2 hits but is redundant.
- **Intent satisfied:** The function IS exported (verified by the test file successfully importing it — see Test 30m / Test 30o import block at test.ts:23 and calls at test.ts:1632, test.ts:1681, and successful typecheck).
- **Bonus: Info #7 no-module-init guard MORE strictly satisfied** — exactly 1 occurrence means the function is ONLY the declaration line; never called from module top-level. If a future refactor tried to add a module-init call, the grep count would jump to 2+ and this assertion would flag it.
- **No code change made.**

### No functional deviations

Plan executed as written. Variant B mutator shape, hardcoded import paths, SC6 scaffold placement, Test 30j ordering guard, Test 30p vi.importActual pattern — all implemented per plan §Action.

**Total deviations:** 2 spec-vs-baseline grep-count notes (intent-satisfied, no code change)
**Impact on plan:** Zero — both are documentation-precision observations. Runtime behavior matches plan exactly.

## Issues Encountered

None.

## Auth gates

None encountered. All work is client-side + no new API calls required auth at development time; the mocked `authApi` in tests bypasses any real auth flow. Wave 3's end-to-end UAT will exercise the real auth path.

## Surprises for Wave 3 executors

1. **`hydratePinnedIdsFromServer` returns early on same-content input.** If Wave 3's mount effect fires on remount (StrictMode double-mount) and the server response is identical, `notify()` won't fire — this is intentional (prevents gratuitous re-renders) but means Wave 3 should NOT assume `hydratePinnedIdsFromServer(ids)` always bumps snapshotVersion. Use `__getSnapshotForTest().pinnedIds` for imperative reads if needed.

2. **`putPinnedIds` return value is server-authoritative.** Wave 3 does NOT need to call `putPinnedIds` — the store already fires the write on every pin/unpin. But if Wave 3 (or a future scope) DOES call `putPinnedIds` directly, the return value is the echoed array from the server, not the input. On divergence, `console.warn` fires — check DevTools console during rollout.

3. **`getPinnedIds` returns `[]` on missing/malformed field.** Defensive against a partial response. Wave 3's mount effect can safely feed the result directly into `hydratePinnedIdsFromServer(ids)` without null-checks.

4. **Test 30p uses `vi.importActual` — pattern for future api-tests.** If Wave 3 adds api-layer tests that need to bypass a module mock, use `const actual = await vi.importActual<typeof import("@/path")>("@/path")` inside the test scope. This works because vi.mock hoists module-wide but importActual is scope-local.

5. **The `vi.mock("@/api/user-preferences-api", ...)` at conversation-store.test.ts top intercepts ALL calls from the store.** If Wave 3 adds a store test that needs to observe getPinnedIds behavior, spy on the mocked module directly via `vi.mocked(UserPreferencesApi.getPinnedIds)`.

## Confirmation: Wave 3 can import hydratePinnedIdsFromServer + getPinnedIds

Both are exported and importable:

```typescript
// From src/ui/state/conversation-store.ts
export function hydratePinnedIdsFromServer(ids: string[]): void { ... }

// From src/ui/api/user-preferences-api.ts
export async function getPinnedIds(): Promise<string[]> { ... }
export async function putPinnedIds(ids: string[]): Promise<string[]> { ... }
```

Wave 3's panel-mount effect should:

```typescript
import { getPinnedIds } from "@/api/user-preferences-api";
import { hydratePinnedIdsFromServer } from "@/ui/state/conversation-store";

useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const ids = await getPinnedIds();
      if (cancelled) return;
      hydratePinnedIdsFromServer(ids);
    } catch {
      // Silent — server unreachable, pinnedIds stays empty
    }
  })();
  return () => { cancelled = true; };
}, []);
```

## Commit trail

| SHA | Type | Description |
|-----|------|-------------|
| `2e4178b` | feat(pin-persistence) | add user-preferences-api client with getPinnedIds/putPinnedIds |
| `26c8df5` | feat(store) | wire pinConversation/unpinConversation to server + hydrate setter |

## Self-Check: PASSED

- `.planning/phases/15-pinned-conversations-server-side-account-wide-persistence/15-02-PLAN.md`: FOUND
- `src/ui/api/user-preferences-api.ts`: FOUND (contains `getPinnedIds` + `putPinnedIds` + SC6 warn scaffold)
- `src/ui/state/conversation-store.ts`: FOUND (contains `putPinnedIds` import + augmented pin/unpin + `hydratePinnedIdsFromServer` + `__resetPinnedIdsForTest`)
- `src/ui/state/conversation-store.test.ts`: FOUND (contains Tests 30j-30p in describe "conversation-store (Phase 15): pinnedIds ↔ server persistence")
- Commit `2e4178b`: FOUND in git log
- Commit `26c8df5`: FOUND in git log

## Next Phase Readiness

- **Wave 3 (panel mount effect + UAT) is unblocked.** `hydratePinnedIdsFromServer` and `getPinnedIds` are exported and typed; the panel-mount effect can wire them in one useEffect block.
- **No blockers.** All 639 tests passing; build clean; no nginx changes needed (Wave 1 confirmed).
- **Rollout window active.** SC6 scaffold logs any server-echo divergence in DevTools console — Wave 3 UAT should verify zero warns fire during normal use.

---
*Phase: 15-pinned-conversations-server-side-account-wide-persistence*
*Completed: 2026-07-27*
