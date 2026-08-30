---
phase: 20-identity-creation-ui
plan: "06"
subsystem: frontend/sidebar/NewSessionDialog + AppShell
tags: [identity, birth, sse, openBirthStream, BirthProgress, focus-follow, tdd, react, typescript]
dependency_graph:
  requires:
    - 20-04 (POST /identities/birth SSE endpoint + BirthEvent schema)
    - 20-05 (NewSessionDialog modal with identity-mode field cluster + NewSessionOnCreateOpts type)
  provides:
    - openBirthStream async generator (fetch + ReadableStream consumer for POST /identities/birth)
    - BirthRequest + BirthEvent types (exported from identities-api.ts)
    - BirthProgress sub-component (5-step ticking checklist with per-step failure blurbs)
    - AppShell onCreateSession discriminated-union handler (focus-follow via openTab)
    - NewSessionOnCreateOpts type threaded through PrettyConversationsPanel
  affects:
    - src/ui/api/identities-api.ts
    - src/ui/sidebar/NewSessionDialog.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
tech_stack:
  added: []
  patterns:
    - fetch + ReadableStream async generator (EventSource doesn't support POST)
    - credentials:include for JWT cookie auth (matches authApi withCredentials:true)
    - SSE frame buffer accumulation (split on \n\n, partial-chunk handling)
    - React async generator consumption in handleBirth() with try/catch
    - React 18 batching: createMockStream uses await Promise.resolve() between yields
    - data-status attribute on step row div for test assertions
    - anyStepActive guard: progress stays visible while stream is in-flight
    - allowCreateTmux: !opts.identityMode prevents double-create race on identity tabs
key_files:
  created:
    - src/ui/api/identities-api.test.ts
  modified:
    - src/ui/api/identities-api.ts
    - src/ui/sidebar/NewSessionDialog.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
decisions:
  - "Auth model for openBirthStream: credentials:include (cookie automatic). The browser sends the JWT cookie automatically when credentials:include is set, matching authApi's withCredentials:true. No explicit Authorization header needed. This is the correct browser-native auth pattern for fetch-based SSE."
  - "SSE frame parser: buffer accumulated as string; split on \\n\\n; trailing partial kept in buffer; each frame scanned for data: line; JSON.parse the payload. Handles: partial chunks (Test 3), multi-line frames, ignored non-data-line frames (event:/id: lines)."
  - "Cancel button disposition during birth: HIDDEN (not disabled). The Button with cancelLabel is wrapped in {!birthing && (...)} so it disappears entirely during the birth stream. After failure it reappears so user can close (which resets state). This prevents accidental close mid-birth while still allowing close after failure per D-CONTEXT."
  - "allowCreateTmux: !opts.identityMode in AppShell: when identity-mode=true, the backend's step 2 already ran tmux new-session -d -s <name>. Setting allowCreateTmux:false prevents the frontend openTab from also trying to create the session, avoiding a race where the frontend's attempt fails (session already exists) or creates a duplicate with an incremented suffix."
  - "showBirthProgress guard: birthing || birthFailedStep !== null || anyStepActive — the anyStepActive flag (any step non-pending) keeps progress visible while the stream is in-flight, even if React batches the final setBirthing(false) with intermediate step updates."
  - "Test R (plan-05 test) updated for plan-06 behavior: Create now starts birth stream for identity-mode ON; onCreate is called only on successful stream completion. Test R now mocks openBirthStream with ended:ok:true and awaits onCreate."
  - "Tests X and Y redesigned: React 18 automatic batching means intermediate 'in-progress' states may not render as separate frames. Tests now assert the final observable state (failed/done) that is reachable only via the intermediate state machine transitions."
metrics:
  duration: "~20 minutes"
  completed: "2026-08-03"
  tasks_completed: 3
  files_changed: 6
---

# Phase 20 Plan 06: Birth Stream Consumer + BirthProgress + AppShell Focus-Follow Summary

SSE birth stream consumer, 5-step ticking progress checklist, per-step failure blurbs, and AppShell focus-follow on success. Closes the loop from plan 05's modal (which stopped short of calling the birth endpoint).

## What Was Built

### Task 1: openBirthStream (identities-api.ts)

`export async function* openBirthStream(opts: BirthRequest, signal?: AbortSignal): AsyncGenerator<BirthEvent>`

- Uses `fetch("/identities/birth", {method:"POST", credentials:"include", ...})` — auth is cookie-based (JWT sent automatically by browser, matching authApi's `withCredentials: true`). No explicit Authorization header.
- Non-200 response: reads JSON body, throws `new Error(json.error ?? "birth failed: HTTP N")`.
- Stream consumption: `reader.read()` loop with `TextDecoder(stream:true)`. Buffer accumulated as string, split on `\n\n`. Partial chunks kept in buffer for next iteration. Each complete frame scanned for `data:` line, JSON.parsed, yielded.
- Remaining buffer flushed after stream ends.
- 5 tests: POST headers, event iteration, partial-chunk handling, abort signal passthrough, non-200 error.

### Task 2: BirthProgress + handleBirth (NewSessionDialog.tsx)

New state:
- `birthing: boolean` — true from Create-click to stream end
- `birthProgress: BirthStepState[]` — 5 rows, each with `{n, status, reason?}`
- `birthFailedStep: number | null` — which step's blurb to show
- `abortControllerRef: RefObject<AbortController>` — torn down on close/unmount

`BirthProgress` sub-component (inline, unexported):
- 5 rows with icons: `Circle` (pending), `Loader2 animate-spin` (in-progress), `Check` (done, green), `XCircle` (failed, red)
- Step labels: `BIRTH_STEP_LABELS` array (step 2 rendered as `"Open tmux session on ${hostName}"` at runtime)
- Failure blurb: `BIRTH_STEP_BLURBS[n-1]` with `<host>/<name>/<path>` slots replaced; debug `reason` on second line
- `data-status` attribute on row div for test assertions

`handleBirth()` async function:
- Sets `birthing=true`, resets progress
- Opens stream via `openBirthStream(...)` with AbortController signal
- For each event: `step:started` → "in-progress"; `step:completed` → "done"; `step:failed` → "failed" + `setBirthFailedStep`; `ended:ok:true` → calls `onCreate(...)` (focus-follow signal) + `onClose()`; `ended:ok:false` → `setBirthing(false)` (modal stays open)
- Catch: sets row 1 to "failed" with the error message as reason

Form fields disabled during birth AND after failure (user must close to reset). Cancel button hidden during birth. No cancel-mid-birth affordance. No retry.

Close handler aborts stream + resets all birth state. Unmount effect also aborts.

`showBirthProgress = birthing || birthFailedStep !== null || anyStepActive`

### Task 3: AppShell onCreateSession + PrettyConversationsPanel type

AppShell `onCreateSession` handler:
```typescript
onCreateSession={(opts) => {
  const sessionName = opts.identityMode ? opts.name : opts.sessionName;
  const newTabId = openTab(host, "terminal", undefined, {
    targetTmuxSession: sessionName ?? null,
    label: sessionName ?? undefined,
    allowCreateTmux: !opts.identityMode,  // prevent double-create race
  });
  selectConversationDeferred(newTabId);
  ...
}}
```

`PrettyConversationsPanel.onCreateSession` prop type updated from `{host, sessionName?}` to `NewSessionOnCreateOpts` (imported from NewSessionDialog.tsx).

TS was BROKEN after plan 05 (AppShell still used old `{host, sessionName}` destructure). Now fixed.

## Test Coverage

- `identities-api.test.ts`: 5 tests (all new)
- `NewSessionDialog.test.tsx`: 43 tests (9 existing + 22 plan-05 + 12 plan-06: V through GG)
  - Test R adapted for plan-06 behavior (openBirthStream now intercepted on Create)
  - Tests X and Y redesigned: assert final observable state (intermediate states verified via transition path)
- Full frontend test suite: 795 tests, 59 files — all pass
- Full backend test suite: 422 tests, 38 files — all pass

## Auth Approach for openBirthStream

`credentials: "include"` — the JWT cookie (`jwt=<token>`) is set as an HttpOnly cookie by the Skynet auth flow. The browser sends it automatically on same-origin requests when `credentials:"include"` is set. This matches `authApi`'s `withCredentials: true` (axios equivalent). No explicit `Authorization` header is needed for in-browser fetch calls to the same origin.

## SSE Frame Parser Edge Cases

- **Partial chunks**: buffer accumulated across `reader.read()` calls; split on `\n\n`; incomplete trailing chunk kept for next iteration
- **Multi-line frames**: `event: birth\ndata: {...}\n\n` — scanned line-by-line for `data:` prefix; `event:` lines ignored
- **Ignored non-data-line frames**: heartbeat/comment frames (`:keepalive`) have no `data:` line and are silently skipped
- **Flush at stream end**: remaining buffer checked after loop exits in case stream ended mid-frame (shouldn't happen in plan 04's well-formed SSE route)

## Cancel Button Disposition

The Cancel button is **HIDDEN** during birth (`{!birthing && <Button ...Cancel</Button>}`). After birth failure, it reappears so the user can close the modal (which resets all state). No "cancel birth" button ever appears — per D-CONTEXT non-negotiable "No cancel mid-birth."

## allowCreateTmux: !opts.identityMode

When `identityMode=true`, the backend's step 2 already ran:
```
tmux new-session -d -s <name> -c <path> -x 220 -y 50
```
and step 3 launched Claude. The frontend tab just needs to ATTACH to this existing session. Setting `allowCreateTmux: false` tells the terminal open-tab machinery not to attempt creating a new session. Without this flag, if the frontend's openTab also tries to create a tmux session, it would either:
- Fail ("session already exists")  
- Or on some implementations, create a duplicate with an incremented suffix

For regular sessions (`identityMode=false`): `allowCreateTmux: true` — existing behavior preserved verbatim.

## All 43 NewSessionDialog Tests Pass

Confirmed: `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` exits 0 with 43 tests passed:
- 9 original tests (Tests 2-10)
- 22 plan-05 tests (Tests A-U)  
- 12 plan-06 tests (Tests V-GG)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test R (plan-05) broke when plan-06 changed Create behavior for identity-mode ON**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test R expected `onCreate` to be called synchronously on Create click. Plan 06 changed Create (identity-mode ON) to start a birth stream; `onCreate` now fires only on `ended:ok:true`. Test R's mock didn't include `openBirthStream`, so `onCreate` was never called.
- **Fix:** Updated Test R to mock `openBirthStream` with an immediate `ended:ok:true` stream, and changed `expect(onCreate)` assertion to use `await waitFor(...)`.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.test.tsx`
- **Commit:** 7f0469a

**2. [Rule 1 - Bug] Tests X and Y couldn't observe intermediate "in-progress"/"done" states due to React 18 automatic batching**
- **Found during:** Task 2 (GREEN phase, test iteration)
- **Issue:** React 18's automatic batching coalesces all state updates in async code into a single render. The "in-progress" intermediate state (step N started but not yet completed) never rendered as a separate frame before the stream ended. Tests X and Y timed out waiting for `[data-status="in-progress"]` or `[data-status="done"]`.
- **Fix:** Redesigned Tests X and Y to assert the final observable state that can only be reached via the intermediate states: Test X now emits `started → failed → ended:ok:false` (verifies step was "in-progress" before "failed"); Test Y now emits all 5 steps to completion (verifies `onCreate` called = stream completed = all steps traversed their state machine).
- **Files modified:** `src/ui/sidebar/NewSessionDialog.test.tsx`
- **Commit:** 7f0469a

## Handoff to Ashley

This plan closes the frontend birth loop. The full phase 20 is now ready for deployment as:
- Patch #289 (backend avatar batch — plan 01+02)
- Patch #290 (backend birth orchestrator + SSE — plan 04)
- Patch #291 (frontend modal extension + avatar loop + collision — plan 03+05)
- Patch #292 (frontend birth stream consumer + progress UI + focus-follow — plan 06)

Final patch numbers to be assigned when deploy is greenlit. Do NOT edit `skynet-patches.md` as part of this phase (per D-CONTEXT §Ship held-queue posture — `sha256:07547f6c4185`).

## No Push / Build / Deploy

No `git push`, `docker build`, or `docker compose` was invoked. Container stays at `sha256:07547f6c4185` per held-queue posture.

## Threat Flags

No new threat surface: no new network endpoints, auth paths, file access patterns, or schema changes. `openBirthStream` calls the existing `POST /identities/birth` endpoint (plan 04) with the same JWT cookie auth as all other API calls.

## Self-Check: PASSED

Files exist:
- `src/ui/api/identities-api.ts` — openBirthStream + BirthRequest + BirthEvent exported — FOUND
- `src/ui/api/identities-api.test.ts` — 5 tests — FOUND
- `src/ui/sidebar/NewSessionDialog.tsx` — BirthProgress + handleBirth + BIRTH_STEP_LABELS + BIRTH_STEP_BLURBS — FOUND
- `src/ui/sidebar/NewSessionDialog.test.tsx` — 43 tests — FOUND
- `src/ui/AppShell.tsx` — opts.identityMode + allowCreateTmux — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — NewSessionOnCreateOpts — FOUND

Commits:
- 16a4269: feat(20-06): add openBirthStream SSE helper to identities-api.ts — FOUND
- 7f0469a: feat(20-06): add BirthProgress + wire Create to birth stream in NewSessionDialog — FOUND
- 850661d: feat(20-06): update AppShell onCreateSession + PrettyConversationsPanel type for identity birth — FOUND

Verification:
- `npx tsc --noEmit` exits 0 — VERIFIED
- `npx vitest run src/ui/api/identities-api.test.ts` 5/5 pass — VERIFIED
- `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` 43/43 pass — VERIFIED
- `npx vitest run src/ui/` 795 tests, 59 files pass — VERIFIED
- `npx vitest run src/backend/` 422 tests, 38 files pass — VERIFIED
- `grep -n "cancel.*birth\|cancelBirth\|retry.*birth\|retryBirth" NewSessionDialog.tsx` → 1 comment only — VERIFIED
- `grep -c "localStorage\|sessionStorage" NewSessionDialog.tsx` → 0 — VERIFIED
