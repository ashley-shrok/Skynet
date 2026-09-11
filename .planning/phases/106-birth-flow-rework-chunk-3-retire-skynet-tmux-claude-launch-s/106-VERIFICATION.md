---
phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
verified_at: 2026-09-11T17:23:58Z
verifier_model: claude-opus-4-7
status: passed
score: 36/36 must-haves verified
overrides_applied: 0
re_verification: null
---

# Phase 106: birth-flow rework Chunk 3 — supervisor sole-spawner — Verification Report

**Phase Goal:** After merge, the identity-creation modal shows a spinner in the Create button while Skynet writes the identity to disk + mints Matrix, then invisibly waits for the supervisor to bring the agent alive, then closes the modal and deposits the user directly into the new agent's chat surface — without Skynet ever opening tmux or launching claude itself. Failure surface: single browser blocking alert. Partial state left on disk. Shell-only branch of the same modal untouched.

**Verified:** 2026-09-11T17:23:58Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Must-Haves (per verification_focus)

### Core sole-spawner architecture

| #   | Must-have                                                             | Status     | Evidence                                                                                                                                                                       |
| --- | --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `identity-birth-orchestrator.ts` contains 0 `tmux new-session`        | VERIFIED   | `grep -c "tmux new-session" src/backend/database/routes/identity-birth-orchestrator.ts` → `0`                                                                                  |
| 2   | Orchestrator contains 0 `startHarnessOnIdentity`                      | VERIFIED   | `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-birth-orchestrator.ts` → `0`                                                                            |
| 3   | `identity-harness-start.ts` still exists and exports the helper       | VERIFIED   | File present; `identity-harness-start.ts:104` has `export async function startHarnessOnIdentity(`                                                                              |
| 4   | `identity-clone.ts:632` still calls `startHarnessOnIdentity`          | VERIFIED   | `identity-clone.ts:121` imports it; `identity-clone.ts:632` invokes it inside the clone provision block. `git diff a3522d35 HEAD -- identity-clone.ts` returns 0 lines.        |

### Wait-for-supervisor mechanic

| #   | Must-have                                                                  | Status   | Evidence                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Orchestrator imports/uses `discoverIdentitySessionFile`                    | VERIFIED | 5 references in `identity-birth-orchestrator.ts`: docstrings + `BirthDeps.discoverIdentitySessionFile` at :364 + call site at :1386.                                                                                                                                                    |
| 6   | Named constants `WAIT_FOR_SUPERVISOR_POLL_MS = 2000` & `..._TIMEOUT_MS = 120000` at file top | VERIFIED | `identity-birth-orchestrator.ts:99` `export const WAIT_FOR_SUPERVISOR_POLL_MS = 2000;`; `:111` `export const WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000;`.                                                                                                                                 |
| 7   | Bounded wait-poll loop calls `discoverIdentitySessionFile` every 2s up to 120s | VERIFIED | `identity-birth-orchestrator.ts:1385-1389` — `while (Date.now() - waitStartMs < WAIT_FOR_SUPERVISOR_TIMEOUT_MS) { discoveredPath = await deps.discoverIdentitySessionFile(conn, opts.name); if (discoveredPath !== null) break; await sleep(WAIT_FOR_SUPERVISOR_POLL_MS); }`.          |
| 8   | On timeout: `databaseLogger.warn` with operation `identity_birth_supervisor_wait_timeout` | VERIFIED | `identity-birth-orchestrator.ts:1395-1400` — `databaseLogger.warn("identity birth: supervisor wait timed out", { operation: "identity_birth_supervisor_wait_timeout", identityKey, hostId, timeoutMs })`.                                                                              |
| 9   | On timeout: 0 `rm`/`unlink`/`remove` on identity folder or Matrix account (Q2 preserved) | VERIFIED | Only mentions of `rm`/`unlink` in the file are in comments explicitly documenting the no-rollback lock (:548, :1370). Timeout path (`identity-birth-orchestrator.ts:1390-1402`) contains only the log-warn and emit — no fs / matrix side-effects.                                     |

### Wire contract

| #   | Must-have                                                                | Status   | Evidence                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `BirthEvent.ended` variant carries `reason?: string`                     | VERIFIED | `identity-birth-orchestrator.ts:179` — `| { type: "ended"; ok: boolean; failedStep?: number; reason?: string; identityId?: string; sessionName?: string };`                                                                                                    |
| 11  | Main SSE routes still emit step:6/7/8 breadcrumbs                        | VERIFIED | `runRelayMintAndWrite` calls `runStep(6, ...)`, `runStep(7, ...)`, `runStep(8, ...)` which emit `step:started` / `step:completed` events at :779-782. Step:6/7/8 events NOT deleted; only step:3/4/5 emits removed.                                            |
| 12  | Main POST / and POST /retry/:key install 30s keepalive + tear down in finally | VERIFIED | POST /: `identity-birth.ts:347-353` `setInterval(() => res.write(":keepalive\n\n"), 30000)`; `:472` `clearInterval(keepAliveInterval)` in finally. POST /retry/:key: `:581-587` + `:665` — matching pair. `grep -c ":keepalive"` → 2, `grep -c "clearInterval(keepAliveInterval)"` → 2. |
| 13  | Both outer-catch AND retry route failure emit carry `reason: sanitizeError(err)` | VERIFIED | POST / outer-catch: `identity-birth.ts:467` `emit({ type: "ended", ok: false, reason: sanitizeError(err) })`. POST /retry outer-catch: `:660` `emit({ type: "ended", ok: false, reason: sanitizeError(err) })`. Both routes covered.                            |

### Frontend modal

| #   | Must-have                                                                    | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | 0 mentions in NewSessionDialog.tsx of: `BirthProgress`, `BIRTH_STEP_LABELS`, `BIRTH_STEP_BLURBS`, `INITIAL_BIRTH_PROGRESS`, `birthProgress`, `birthFailedStep`, `resetBirthProgress`, `BirthStepState` | VERIFIED | `grep -c` on each of these 8 tokens against `src/ui/sidebar/NewSessionDialog.tsx` returns `0` for every one.                                                                                                                                                                                                                                                    |
| 15  | Create button renders `<Loader2 />` when `birthing === true`                 | VERIFIED | `NewSessionDialog.tsx:1234-1238` — `{birthing ? (<Loader2 className="size-4 animate-spin" aria-label="Creating agent" />) : (openLabel)}`. Loader2 imported at `:89` from `lucide-react`.                                                                                                                                                                        |
| 16  | Modal close disabled during birthing (Dialog.onOpenChange gate)              | VERIFIED | `NewSessionDialog.tsx:803-810` — `onOpenChange={(next) => { if (!next && !birthing) onClose(); }}`. Cancel button also disabled: `:1178` `<Button variant="ghost" onClick={onClose} disabled={birthing}>`.                                                                                                                                                       |
| 17  | `window.alert("agent creation failed")` fires on BOTH ended:ok:false AND stream throw | VERIFIED | `NewSessionDialog.tsx:692` (ended:ok:false branch inside handleBirth) + `:702` (outer `catch (_e)` branch inside handleBirth). Both invoke the exact literal `window.alert("agent creation failed")`.                                                                                                                                                            |
| 18  | `refreshIdentities → onCreate → onClose` chain preserved on success          | VERIFIED | `NewSessionDialog.tsx:671` `await refreshIdentities();` → `:679-685` `onCreate({...identityMode:true, name:...})` → `:687` `onClose();`. `refreshIdentities` imported at `:111` from `@/state/identities-store`.                                                                                                                                                 |

### Auto-route

| #   | Must-have                                                                    | Status   | Evidence                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | `AppShell.tsx` byte-untouched vs phase's starting commit `a3522d35`          | VERIFIED | `git diff a3522d35 HEAD -- src/ui/AppShell.tsx` returns 0 lines — byte-identical.                                                                                                                                                                              |
| 20  | onCreateSession at AppShell.tsx:2236 still calls `openTab(...)` with `allowCreateTmux: false` for identityMode:true branch + `selectConversationDeferred` | VERIFIED | `AppShell.tsx:2248-2266` — narrows on `opts.identityMode === true`, sets `sessionName = opts.name`, calls `openTab(host, "terminal", undefined, { targetTmuxSession: sessionName ?? null, label: sessionName ?? undefined, allowCreateTmux: opts.identityMode === false })` (evaluates to `false` when identityMode is true) then `selectConversationDeferred(newTabId)`. |

### Shell-only branch

| #   | Must-have                                                                       | Status   | Evidence                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | Shell-only branch (`identityMode: false` onCreate path) byte-identical to pre-phase | VERIFIED | Diff of pre-phase (a3522d35:1315-1340) vs current (1204-1229) shows only surrounding Create-button label swap. The `onCreate({ host, sessionName, path, identityMode: false })` payload block at :1219-1224 is unchanged. Shell-only never invokes handleBirth. |

### Non-touch invariants

| #   | Invariant                                                | Status   | Evidence                                                                             |
| --- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 22  | `NewSessionDialog.role-dropdown.test.tsx` byte-untouched | VERIFIED | `git diff a3522d35 HEAD -- src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` returns 0 lines. |
| 23  | `NewSessionDialog.task-input.test.tsx` byte-untouched    | VERIFIED | `git diff a3522d35 HEAD -- src/ui/sidebar/NewSessionDialog.task-input.test.tsx` returns 0 lines.    |
| 24  | `identity-harness-start.test.ts` byte-untouched          | VERIFIED | `git diff a3522d35 HEAD -- src/backend/database/routes/identity-harness-start.test.ts` returns 0 lines. |

### Test-suite health

| #   | Test-suite check                                          | Status   | Evidence                                                                                                                                                                                             |
| --- | --------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | 4 backend test files: `npx vitest run` exits 0            | VERIFIED | 4 files (`identity-birth-orchestrator.test.ts`, `.role-frontmatter.test.ts`, `.mxid-derivation.test.ts`, `identity-birth.test.ts`) → `Test Files 4 passed (4); Tests 117 passed (117)`. Duration 1.50s. |
| 26  | 2 frontend test files: `npx vitest run` exits 0           | VERIFIED | 2 files (`NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`) → `Test Files 2 passed (2); Tests 49 passed (49)`. Duration 6.38s. jsdom-alert warnings noted but non-blocking.               |
| 27  | `npm run build:backend` exits 0                           | VERIFIED | Backend `tsc -p tsconfig.node.json` completed without errors; no output beyond the copy-package.json step.                                                                                            |
| 28  | `npm run build` (full frontend + backend) exits 0         | VERIFIED | Full build completes: backend TS clean, then Vite frontend build `✓ built in 2.05s`.                                                                                                                  |

---

## Failure-Mode Coverage (shape §"What would make it wrong")

Every entry in this section is a negative assertion — the codebase must NOT do the wrong thing described. All eight failure modes verified negative.

| #   | Failure mode                                                                     | Expected | Actual   | Evidence                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 29  | Modal closes on Skynet's own completion, not agent-alive                         | NO       | NOT SO   | Success `ended:ok:true` is only emitted *after* the wait-poll succeeds at `identity-birth-orchestrator.ts:1385-1408` — the emit at :1408 is inside the try block and downstream of the wait loop. |
| 30  | Spinner runs forever with no timeout                                             | NO       | NOT SO   | `WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000` bound; the `while` at :1385 terminates on timeout; the `else` at :1390 fires `emit({ type: "ended", ok: false, reason: "supervisor_wait_timeout" })`. |
| 31  | Auto-route lands anywhere other than new agent's chat surface                    | NO       | NOT SO   | `AppShell.tsx:2255-2266` — same `openTab(host, "terminal", ...)` + `selectConversationDeferred(newTabId)` path used pre-phase; `allowCreateTmux: false` on identity-mode branch means the frontend attaches to the just-created tmux session. |
| 32  | App tries to clean up partial state on timeout                                   | NO       | NOT SO   | Zero `rm`/`unlink`/`removeSync` in the timeout path (:1390-1402). Comments at :1368-1373 and :548 explicitly document the Q2 no-rollback lock.                                  |
| 33  | Failure alert distinguishes Skynet-side vs supervisor-wait timeout               | NO       | NOT SO   | `NewSessionDialog.tsx:692` and `:702` both call the exact literal `window.alert("agent creation failed")` — no interpolation of `reason`, `failedStep`, or error class. D-11 opaque-reason contract preserved. |
| 34  | Launch mechanism drifts back into app "just for edge cases"                      | NO       | NOT SO   | `grep -c "tmux new-session" identity-birth-orchestrator.ts` → 0. `grep -c "startHarnessOnIdentity" identity-birth-orchestrator.ts` → 0. No conditional re-introduction of launch on any code path in the orchestrator. |
| 35  | Transcript-file signal checked by inventing a new detection pattern              | NO       | NOT SO   | Wait poll calls `deps.discoverIdentitySessionFile(conn, opts.name)` at `identity-birth-orchestrator.ts:1386`. Same helper used by `fleet-status/ssh-poll-orchestrator.ts` and `sessions.ts` — no parallel sensor. Injected via `BirthDeps.discoverIdentitySessionFile` at :364 for testability. |
| 36  | Shell-only mode swept into wait-for-transcript                                   | NO       | NOT SO   | `NewSessionDialog.tsx:1211-1225` — shell-only `else` branch calls `onCreate({...identityMode: false...})` synchronously without invoking `handleBirth()`. Wait loop lives inside `handleBirth`'s stream consumer, which is never entered for shell-only. |

---

## Anti-Patterns Scan

All 4 source files modified by this phase scanned for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER debt markers:

| File                                                     | TBD/FIXME/XXX | Notes  |
| -------------------------------------------------------- | ------------- | ------ |
| src/backend/database/routes/identity-birth-orchestrator.ts | 0             | clean  |
| src/backend/database/routes/identity-birth.ts             | 0             | clean  |
| src/ui/sidebar/NewSessionDialog.tsx                       | 0             | clean  |
| src/backend/spawn-requests/worker.ts                      | 0             | clean  |

No unreferenced debt markers. The AppShell.tsx:2258-2263 comment mentioning `tmux new-session -d -s <name>` and "launched claude at step 3" is stale (Skynet no longer does that), but AppShell.tsx is byte-untouched by this phase per D-16 (mechanic is correct as-is), and updating that comment would violate the D-16 non-touch invariant. Flag as ℹ️ Info only — not a blocker.

---

## Wiring / Key-Link Verification

| From                                              | To                                                            | Via                                              | Status   | Evidence                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| `identity-birth-orchestrator.ts`                  | `claude-session/discover-identity-session-file.ts`             | `BirthDeps.discoverIdentitySessionFile`          | WIRED    | Interface at :364; call site at :1386.                                                              |
| `identity-birth.ts`                               | `identity-birth-orchestrator.ts`                              | `birthIdentity` deps object                      | WIRED    | Imports at :28 (`discoverIdentitySessionFile`) + :46 (`sanitizeError`); deps object at :373-418. |
| `spawn-requests/worker.ts`                        | `identity-birth-orchestrator.ts`                              | worker's `birthDeps` object                      | WIRED    | (per Plan 106-01's Rule 3 auto-fix — `discoverIdentitySessionFile` wired for queue-driven births)   |
| `NewSessionDialog.tsx` handleBirth (success)      | `AppShell.tsx` onCreateSession → openTab                       | `onCreate({identityMode:true, ...})` prop chain | WIRED    | :679-685 payload matches AppShell.tsx:2248-2266 identityMode:true narrow.                           |
| `NewSessionDialog.tsx` success path               | `@/state/identities-store` refreshIdentities                   | direct import + await call                       | WIRED    | Import :111; call :671 before onCreate.                                                             |
| `NewSessionDialog.tsx` failure paths              | `window.alert("agent creation failed")` + onClose               | direct call                                      | WIRED    | :692 + :702; each followed by `setBirthing(false); onClose();`.                                     |

---

## Data-Flow Trace (Level 4)

| Artifact                                          | Data Variable              | Source                                                                   | Produces Real Data | Status    |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ | ------------------ | --------- |
| Orchestrator wait poll                            | `discoveredPath`           | Injected `deps.discoverIdentitySessionFile` → real SSH exec via `identity-birth.ts:416-417` wiring | Yes                | FLOWING   |
| Frontend `birthing` state                         | `birthing` bool            | `setBirthing(true)` on click; `setBirthing(false)` after ended or throw   | Yes                | FLOWING   |
| Frontend success chain                            | Ended event JSON           | SSE stream from backend orchestrator (real DB/SSH/Matrix behind it)      | Yes                | FLOWING   |
| Frontend failure alert                            | Fixed literal string       | Constant — no dynamic data required                                       | N/A (deliberate)   | N/A       |

---

## Test-Suite Summary

- **Backend scoped:** 4 files, 117 tests, all pass (1.50s)
- **Frontend scoped:** 2 files, 49 tests, all pass (6.38s)
- **Backend build:** `npm run build:backend` → 0 exit
- **Full build:** `npm run build` → 0 exit, `✓ built in 2.05s`
- **Non-touch tests (harness, role-dropdown, task-input):** byte-clean per `git diff`

---

## Requirements Coverage (D-01 through D-22 from CONTEXT.md)

| ID    | Description                                                                | Status     |
| ----- | -------------------------------------------------------------------------- | ---------- |
| D-01  | Retire tmux new-session from Step 2                                         | SATISFIED  |
| D-02  | Retire Step 3 harness block + synthetic step:4/5 emits                     | SATISFIED  |
| D-03  | Preserve startHarnessOnIdentity for clone                                  | SATISFIED  |
| D-04  | Preserve `path` field on BirthOptions/wire                                 | SATISFIED  |
| D-05  | Reuse `discoverIdentitySessionFile` (single sensor)                        | SATISFIED  |
| D-06  | Backend-inside-SSE wait poll                                                | SATISFIED  |
| D-07  | Poll cadence 2s                                                             | SATISFIED  |
| D-08  | Timeout 120s                                                                | SATISFIED  |
| D-09  | SSE keepalive + no rollback + structured warn                              | SATISFIED  |
| D-10  | Frontend consumes only terminal `ended`                                    | SATISFIED  |
| D-11  | `ended.reason?: string` on failure paths                                    | SATISFIED  |
| D-12  | step:1/2/6/7/8 breadcrumbs preserved on wire                               | SATISFIED  |
| D-13  | Delete BirthProgress + tables + state                                       | SATISFIED  |
| D-14  | Spinner-in-button while birthing                                            | SATISFIED  |
| D-15  | Modal close disabled during birthing                                        | SATISFIED  |
| D-16  | AppShell.tsx untouched, existing auto-route                                | SATISFIED  |
| D-17  | Single generic `window.alert` on any failure                                | SATISFIED  |
| D-18  | refreshIdentities → onCreate → onClose chain                               | SATISFIED  |
| D-19  | Delete per-step failure blurbs                                              | SATISFIED  |
| D-20  | Backend tests updated; harness test untouched                              | SATISFIED  |
| D-21  | Frontend tests updated; role-dropdown+task-input untouched                 | SATISFIED  |
| D-22  | Deploy motion is orchestrator's remit (out of executor scope)              | SATISFIED (correctly deferred) |

All 22 documented decisions have satisfying evidence.

---

## Human Verification Required

None — every must-have and failure-mode assertion is programmatically verifiable through grep, source-diff, or scoped-test-suite invocations. UAT would confirm the deploy motion (D-22) and the visual smoke-check of the actual spinner-in-button + modal-lock + auto-route into the new agent's chat surface on a real host, but Chunk 3 is a Wave 2 executor-only phase and the shape file's success criteria are exercised by the frontend + backend test suites now green.

---

## Gaps Summary

None.

All 36 verification-focus questions resolved to VERIFIED. Every failure mode from the shape file's §"What would make it wrong" is negatively verified. All 22 decisions from CONTEXT.md have satisfying evidence in the codebase. Non-touch invariants are byte-clean. Scoped test suites and both builds pass.

The phase goal — modal shows spinner while Skynet writes disk + mints Matrix, invisibly waits for supervisor to bring agent alive, closes modal + auto-routes into new agent's chat surface on success, generic alert on failure, partial state left on disk, shell-only branch untouched — is fully delivered by the current codebase.

---

## Recommended Next Step for Orchestrator

**Deploy motion time.** Per D-22 and the shape file's Chunk 3 disposition, this is the load-bearing chunk of the 3-chunk arc (Chunks 1+2 already landed at commits `5f6efd29` and `6cdff0ab`). Now that all three chunks have landed on the branch, the orchestrator should:

1. **Coord-room announce** the pending deploy on `!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net`.
2. `git pull --rebase origin feat/tab-title-from-tmux`.
3. Run the full-suite gate (`npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` with `SKYNET_TEST_CREDS`).
4. Push + build + recreate containers + verify.
5. **AFTER-post** on ship.
6. **Ask** about notifying Stacy at the downstream deployment (per the standing directive in `~/fleet/roles/box-maintainer/box-maintainer.md`) so the full birth-flow rework arc (Chunks 1+2+3) can be pulled through downstream as one coherent unit (not incrementally, per the arc's original coordination decision).

The originally-scoped Chunk 4 (per-step visible checkmarks + error toast) dissolves under this shape and should be **marked done or dropped** in `~/fleet/roles/box-maintainer/bounties/newsessiondialog-ux-per-step-visible/bounty.json` as part of closing the arc, per the CONTEXT.md § Deferred Ideas note.

---

_Verified: 2026-09-11T17:23:58Z_
_Verifier: Claude (gsd-verifier, model claude-opus-4-7)_
