---
phase: "91"
plan: "FIXUP"
subsystem: "pretty-conversations / relay-room-create"
tags: ["bugfix", "code-review-response", "relay", "modal", "backend"]
---

# Phase 91 Fixup Summary

Code-review response pass applying all MUST FIX / SHOULD FIX / WORTH FIXING
findings from the unbiased general-purpose code review of Slice C (new
conversation modal + relay-room-create route).

---

## Findings Applied

| ID | File(s) | What was fixed |
|----|---------|----------------|
| H1 | `NewConversationModal.tsx:334`, flow test | Removed `- (viewingUserMxid ? 1 : 0)` from `humansTotal`; server already self-excludes via `ne(users.id, userId)`. Flow test mock updated to return only non-viewer users (bob only). |
| H2 | `relay-room-create.ts:237-242` | Layer-1 grammar drops now emit structured logs with distinct op codes: `relay_room_create_dropped_invalid_grammar_human_mxid` / `_agent_mxid`. Test 9 updated to assert the log. |
| M1 | `useNewConversationForm.ts`, `NewConversationModal.tsx` | Added `reset()` method to hook. Modal calls `form.reset()` via `useEffect` when `open` transitions to `false`. Prevents stale roomName, picks, searchQuery, error across re-open cycles. Test 9 added to unit test. |
| M2 | `NewConversationModal.tsx:91-105` | Added `AbortController` per open cycle; `controller.abort()` in cleanup. State update suppressed when `controller.signal.aborted`. `basicUsers` cleared to `null` on close. |
| M4 | `relay-room-create.ts:315` | Filter `viewerMxid` out of `humanMxids` server-side after JWT lookup, before invite fan-out. Avoids unnecessary self-invite. Test 16 added. |
| M5 | `relay-room-create.ts:212` | Wrapped entire handler body in `try/catch`. On unhandled error: logs `relay_room_create_unhandled_error`, returns `500 { error: "internal_error" }`. DB error string never leaked. Test 17 added. |
| M6 | `relay-room-create.ts:109-130` | `lookupViewingUserMxid` now returns `ViewerMxidResult` discriminated union `{ ok:true, mxid } | { ok:false, reason: "no_mxid" | "db_error" }`. DB error → 500 `service_unavailable`; missing mxid → 400 `viewer_no_mxid`. Log op code `relay_room_create_lookup_viewer_mxid_db_error`. Test 18 added. |
| L1 | `NewConversationModal.flow.test.tsx:635-637` | Replaced brittle `/human.*\d.*of.*\d/` regex with exact string `.toContain("humans (1 of 1)")`. Applied alongside H1 (same commit). |
| L2 | `relay-room-create.ts:231-234` | Added `if (trimmed.length > 256) return 400 room_name_too_long` after trim check. Test 19 added. |
| L4 | `participant-types.ts`, `relay-room-create.ts` | `CreateRelayRoomResponse.sessionId` changed to `string | null`. Backend returns `null` (not `""`) when materialize failed. Test 13 assertion updated; inline types in `NewConversationModal.test.tsx` updated. |

---

## Findings Skipped

| ID | Reason |
|----|--------|
| M3 | `modal={false}` is intentional — documented as "Patch #111f discipline" in code comment. Not this pass. |
| M7 | N+1 `loginAsUser` calls — perf concern, not a correctness bug. Deferred. |
| L3, L5, L6, L7 | Defensive / cosmetic. Not landing in this pass. |
| N1–N5 | Nit-level. Not this pass. |
| PATTERNS OBSERVED | Informational. Not code-fixed. |

---

## Deviations

None. All findings were applied exactly as described. H1 and L1 were committed
together (one commit) because they are logically coupled — fixing the count
requires the test mock to change, and fixing the mock requires the count
assertion to tighten.

---

## Tests Added / Updated

### New tests

| Test | File | What it covers |
|------|------|----------------|
| useNewConversationForm Test 9 | `useNewConversationForm.test.ts` | `reset()` clears all state to initial values (M1) |
| relay-room-create Test 16 | `relay-room-create.test.ts` | viewerMxid in humanMxids is not passed to inviteToRoom (M4) |
| relay-room-create Test 17 | `relay-room-create.test.ts` | synchronous DB throw → 500 internal_error; no error string leaked (M5) |
| relay-room-create Test 18 | `relay-room-create.test.ts` | DB error in viewerMxid lookup → 500 service_unavailable, not 400 viewer_no_mxid (M6) |
| relay-room-create Test 19 | `relay-room-create.test.ts` | roomName > 256 chars → 400 room_name_too_long (L2) |

### Updated tests

| Test | File | What changed |
|------|------|--------------|
| flow test mock `getUsersListBasic` | `NewConversationModal.flow.test.tsx` | Returns only `[bob]` (not alice+bob) to match server self-exclusion contract (H1) |
| flow Test 8 assertion | `NewConversationModal.flow.test.tsx` | Regex → exact `.toContain("humans (1 of 1)")` (L1) |
| flow Test 6 comment | `NewConversationModal.flow.test.tsx` | Documents server-side vs client-side exclusion layers |
| backend Test 9 | `relay-room-create.test.ts` | Added Layer-1 log assertion (H2) |
| backend Test 13 assertion | `relay-room-create.test.ts` | `toBe("")` → `toBeNull()` (L4) |
| `renderOpen` type | `NewConversationModal.test.tsx` | `sessionId: string` → `sessionId: string | null` in helper (L4) |
| double-click test types | `NewConversationModal.test.tsx` | Inline promise type updated (L4) |

---

## Green Gate Output

```
 RUN  v4.1.8 /home/ubuntu/skynet-taylor

 Test Files  4 passed (4)
      Tests  54 passed (54)
   Start at  12:40:32
   Duration  9.54s (transform 4.48s, setup 156ms, import 8.71s, tests 5.17s, environment 4.09s)
```

Files run:
- `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx` — 8 tests
- `src/ui/features/pretty-conversations/NewConversationModal.test.tsx` — 18 tests
- `src/ui/features/pretty-conversations/useNewConversationForm.test.ts` — 9 tests
- `src/backend/database/routes/relay-room-create.test.ts` — 19 tests

---

## Commits

| Hash | Message |
|------|---------|
| `ec67368c` | `fix(91-fixup): H1 correct humansTotal count + L1 exact count assertion` |
| `067ed4f0` | `feat(91-fixup): H2 log Layer-1 grammar drops with distinct op codes` |
| `589e82b6` | `fix(91-fixup): M1 reset form state on modal close` |
| `207a6897` | `fix(91-fixup): M2 cancel in-flight getUsersListBasic on close/re-open` |
| `bffffaf2` | `fix(91-fixup): M4 server-side self-exclusion of viewerMxid from humanMxids` |
| `eeb7b1ac` | `fix(91-fixup): M5 top-level try/catch in handler prevents hanging requests` |
| `bef7f285` | `refactor(91-fixup): M6 discriminated viewer-mxid lookup — 500 on db_error vs 400 on no_mxid` |
| `b514a980` | `fix(91-fixup): L2 add 256-char max-length guard on roomName` |
| `ee6c24fc` | `fix(91-fixup): L4 sessionId wire type string | null; return null on partial success` |
