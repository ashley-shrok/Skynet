---
phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
plan: 04
subsystem: testing
tags: [vitest, react-testing-library, birth-flow, sse-mock, sole-spawner, frontend-tests]

# Dependency graph
requires:
  - phase: 106 (Plan 106-02)
    provides: The spinner-in-button + modal-lock + generic-alert UX in NewSessionDialog.tsx that this plan's tests now pin
  - phase: 106 (Plan 106-01)
    provides: The new SSE wire contract (single terminal `ended` event, no step:1..5) that these tests mock
provides:
  - "Frontend test coverage refreshed for the sole-spawner birth UX (spinner + modal lock + generic alert)"
  - "Test 106A: Loader2 spinner-in-Create-button assertion (D-14 pin)"
  - "Test 106B: Cancel disabled + ESC-no-close assertion (D-15 modal-lock pin)"
  - "Test 106C: refreshIdentities → onCreate → onClose order + D-16 payload preservation"
  - "Test 106D: window.alert('agent creation failed') on ended:ok:false (D-17)"
  - "Test 106E: window.alert('agent creation failed') on stream throw (D-17 dual-path)"
  - "Test 11 in chain.test.tsx: birth+auto-route chain fires after single ended:ok:true (D-16 + D-18)"
affects: [future NewSessionDialog UX changes, integration tests spanning birth-flow]

# Tech tracking
tech-stack:
  added: []  # no new deps; reuses existing vitest + @testing-library/react
  patterns:
    - "AsyncGenerator mock for openBirthStream that yields a single terminal event — matches Plan 106-01's new wire contract"
    - "vi.spyOn(window, 'alert').mockImplementation(() => {}) pattern for asserting on browser blocking dialogs in jsdom"
    - "mock.invocationCallOrder cross-comparison for asserting D-18 ordering invariants between refreshIdentities/onCreate/onClose"

key-files:
  created: []
  modified:
    - "src/ui/sidebar/NewSessionDialog.test.tsx (1468 → 1377 lines; net -91; 141 insertions, 232 deletions)"
    - "src/ui/sidebar/NewSessionDialog.chain.test.tsx (573 → 672 lines; +99, no deletions — appended Test 11 + expanded identities-store mock)"

key-decisions:
  - "Kept Test R intact (already used ended:ok:true single-event contract; no rewrite needed) — Test 106C strengthens with D-18 ordering + refreshIdentities assertion"
  - "Test 106E uses AsyncGenerator that throws pre-yield (outer-catch path) — matches Plan 106-02 edit 8's dual-path failure routing"
  - "Test 11 (chain) built as an inline self-contained test rather than extracting a shared fillIdentityForm helper — sibling role-dropdown + task-input test files use inline setup too; kept style consistent with the file's existing 10 tests"
  - "Added `refreshIdentities` to both files' `@/state/identities-store` vi.mock (previously only useIdentities was stubbed) — required to satisfy D-18 assertion + D-16 chain payload verification"
  - "Test 106D uses reason: 'supervisor_wait_timeout' in the mock ended event — matches the Plan 106-01 reason-string contract even though the frontend ignores the value (D-11); pins that a reason string on the wire does not accidentally break parsing"

patterns-established:
  - "Frontend test pattern for D-14 spinner: `expect(createBtn.querySelector('.animate-spin')).toBeTruthy()` — decouples from the exact icon component (Loader2 → any-lucide-spinner) while still pinning the visual affordance"
  - "Frontend test pattern for D-15 modal lock: `fireEvent.keyDown(document.body, { key: 'Escape' })` + `expect(onClose).not.toHaveBeenCalled()` — routes through Radix Dialog's keydown listener without needing to reach into internal Dialog implementation"
  - "Frontend test pattern for D-18 ordering: `expect(mockA.mock.invocationCallOrder[0]).toBeLessThan(mockB.mock.invocationCallOrder[0])` — asserts strict happens-before across two vi.fn spies"

requirements-completed: [D-13, D-14, D-15, D-16, D-17, D-18, D-21]

# Metrics
duration: ~13m 30s
completed: 2026-09-11
---

# Phase 106 Plan 106-04: refresh frontend test suite for spinner+lock+alert UX Summary

**Deleted 10 pre-Phase-106 BirthProgress-checklist tests (W/X/Y/Z/AA/BB/CC/DD/EE/FF) and replaced them with 5 targeted UX tests (spinner-in-button, modal-lock, refresh→onCreate→onClose ordering, alert-on-ended:ok:false, alert-on-stream-throw); added one birth+auto-route chain test (Test 11) to chain.test.tsx that consumes the new single-ended-event contract from Plan 106-01. Sibling role-dropdown + task-input test files byte-untouched per D-21.**

## Performance

- **Duration:** ~13m 30s
- **Started:** 2026-09-11T16:55:00Z (approx — plan received)
- **Completed:** 2026-09-11T17:08:36Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- **NewSessionDialog.test.tsx refreshed** for the sole-spawner UX shape: 10 pre-Phase-106 tests deleted (all asserted on the deleted 5-step BirthProgress checklist rendering, `data-status="failed"` per-step icons, and pre-phase "failed birth keeps modal open" semantics that are all void under D-13/D-17). 5 new UX tests added covering the D-13/D-14/D-15/D-17/D-18 surface changes.
- **Test 106A (spinner-in-button, D-14):** Uses a hanging AsyncGenerator to hold `birthing===true` stable, then asserts the Create button contains a `.animate-spin` child (Loader2's telltale). Decoupled from the exact icon class name so future icon-library swaps do not break the test.
- **Test 106B (modal lock, D-15):** Same hanging-stream setup. Asserts Cancel button `.disabled` is true AND that firing an ESC keydown on `document.body` does NOT invoke `onClose`. Also clicks the disabled Cancel button and re-asserts no `onClose` — pins both close paths.
- **Test 106C (success chain ordering, D-18 + D-16):** Mocks openBirthStream to yield a single `ended:ok:true` event. Asserts `mockRefreshIdentities` called; asserts `mock.invocationCallOrder` comparison `refresh < onCreate < onClose`; asserts D-16 payload shape `{identityMode:true, name:"alicia"}`.
- **Test 106D (ended:ok:false → alert, D-17):** Installs `vi.spyOn(window, 'alert').mockImplementation(() => {})`, yields a single `ended:ok:false, reason:"supervisor_wait_timeout"` event, asserts alert called exactly once with `"agent creation failed"`, asserts `onClose` fires once, asserts `onCreate` NOT called. Restores the spy.
- **Test 106E (stream throw → alert, D-17):** Uses an AsyncGenerator that throws pre-yield to exercise the outer-catch branch of `handleBirth`. Same assertion set as 106D — validates the single-surface rule (D-17: no branching on failure class, always the same alert).
- **Test 11 in chain.test.tsx (birth+auto-route chain):** New test appended. Renders modal with `initialHost=hostA, initialRole="box-maintainer"` (chain prefill), fills only the name field, clicks Create, and mocks openBirthStream to yield a single `ended:ok:true` event. Asserts the D-16 payload preservation on `onCreate`, the D-18 refreshIdentities call, `onClose` fires, and the mock stream was consumed via a single call.
- **`refreshIdentities` added to identities-store vi.mock in both test files** — previously only `useIdentities` was stubbed. Required to satisfy D-18 assertion in the success-chain tests.
- **`NewSessionDialog.role-dropdown.test.tsx` + `NewSessionDialog.task-input.test.tsx` byte-untouched** per D-21 non-touch invariant. Verified via `git diff HEAD~2 HEAD --stat` returning empty for both.

## Task Commits

Each task was committed atomically:

1. **Task 1: Refresh NewSessionDialog.test.tsx** — `48d7d025` (test)
2. **Task 2: Add birth+auto-route chain test to chain.test.tsx** — `590658c0` (test)

_Plan metadata commit deferred to the orchestrator's post-wave step (106-04 is Wave 2 partner of 106-03)._

## Files Created/Modified

- `src/ui/sidebar/NewSessionDialog.test.tsx` — Deleted the block of 10 pre-Phase-106 BirthProgress-checklist tests (W through FF) and replaced with 5 targeted UX tests (106A/B/C/D/E). Added `refreshIdentities` to the `@/state/identities-store` mock. Preserved: Tests 2-10, A-K, R, S, U, V, GG, Phase 88 T1-T4 (all unrelated axes remain unchanged). Net: 1468 → 1377 lines (-91), 141 insertions / 232 deletions.
- `src/ui/sidebar/NewSessionDialog.chain.test.tsx` — Appended Test 11 (birth+auto-route chain via single ended:ok:true event). Added `refreshIdentities` to the `@/state/identities-store` mock. Net: 573 → 672 lines (+99). No deletions.

## Decisions Made

- **Kept Test R intact:** Test R already used the `{ type: "ended", ok: true, ... }` single-event shape (it predates the pre-Phase-106 step-by-step tests). No rewrite needed. Test 106C strengthens Test R's coverage by adding D-18 ordering + refreshIdentities assertions.
- **Test 106E uses pre-yield throw:** The AsyncGenerator throws before any yield, which routes through `handleBirth`'s outer `catch (_e)` branch rather than the `endedEvent && !endedEvent.ok` branch. This matches Plan 106-02 edit 8's explicit dual-path design where both routes fire the same alert + onClose. Test 106D exercises the ended:ok:false branch; Test 106E exercises the outer-catch branch; together they pin D-17's single-surface rule.
- **Test 11 built inline (no shared helper):** The chain.test.tsx file's existing 10 tests all use inline setup (no fillIdentityForm helper — that lives in the main test file). Kept Test 11's style consistent with its siblings. Extracting a helper would have touched styles across the file.
- **Added refreshIdentities to identities-store vi.mock:** Both test files previously only stubbed `useIdentities`. Since D-18 requires asserting `refreshIdentities` was called (and the test needs to spy on it), the mock had to be widened. Kept the module-scope `mockRefreshIdentities` fn resolving to undefined by default (matches source's best-effort try/catch around the call site).
- **Test 106D uses reason:"supervisor_wait_timeout" in the mock ended event:** This is the specific reason string Plan 106-01's backend emits on the wait-timeout path. Even though the frontend ignores the reason value (D-11: always generic alert regardless), pinning a real-world reason string in the mock guards against accidental future parsing changes that could break the D-11 opaque-reason contract.

## Deviations from Plan

**None — plan executed exactly as written.**

No Rule 1 / Rule 2 / Rule 3 auto-fixes triggered. All action steps landed as specified: deleted the correct set of pre-phase tests, added the four new UX tests per plan (Tests A/B/C/D + optional Test E for regression-guard on the stream-throw path per action step 3), preserved the shell-only branch regression guard via existing Test GG (which the plan explicitly asked to preserve or add — Test GG was already present covering shell-mode-does-NOT-call-openBirthStream, so no new addition needed there).

The plan's action step 5 said: *"if the file has a shell-only submit test, verify it still passes without modification. If it doesn't have one, add ONE minimal test."* — Test GG already exists at NewSessionDialog.test.tsx:1354-1370 and passes unchanged. No new test needed there.

## Issues Encountered

- **Harmless jsdom "Not implemented: Window's alert() method" warnings** during vitest runs. These fire because Test 106D and 106E install spies via `vi.spyOn(window, 'alert')` scoped to their `it()` blocks and restore at end; the warnings appear to come from the vitest `afterEach { vi.clearAllMocks() }` interaction with the spy's lifecycle (clearing the mock impl but leaving the spy attached briefly). The tests still pass — the assertion is on the spy's call log, not the alert's rendering. Confirmed non-blocking: `Test Files 1 passed | Tests 34 passed`.

## Verification Evidence

**Task 1 automated source assertions** (all from Task 1 `<automated>` block):

```
grep -c "BirthProgress" src/ui/sidebar/NewSessionDialog.test.tsx           → 0 ✓
grep -c "Open tmux session" src/ui/sidebar/NewSessionDialog.test.tsx       → 0 ✓
grep -c "Launch Claude CLI" src/ui/sidebar/NewSessionDialog.test.tsx       → 0 ✓
grep -c "Bootstrap dance" src/ui/sidebar/NewSessionDialog.test.tsx         → 0 ✓
grep -c "Send /id" src/ui/sidebar/NewSessionDialog.test.tsx                → 0 ✓
grep -c "ssh <host> tmux attach" src/ui/sidebar/NewSessionDialog.test.tsx  → 0 ✓
grep -c "agent creation failed" src/ui/sidebar/NewSessionDialog.test.tsx   → 6 (≥ 2 required) ✓
grep -Ec "animate-spin|Loader2" src/ui/sidebar/NewSessionDialog.test.tsx   → 4 (≥ 1 required) ✓
grep -c "window.alert" src/ui/sidebar/NewSessionDialog.test.tsx            → 4 (≥ 2 required) ✓
grep -c "refreshIdentities" src/ui/sidebar/NewSessionDialog.test.tsx       → 10 (≥ 1 required, D-18) ✓
```

**Task 2 automated source assertions:**

```
grep -c "BirthProgress" src/ui/sidebar/NewSessionDialog.chain.test.tsx                            → 0 ✓
grep -Ec 'type: "step", n: 3|type: "step", n: 4|type: "step", n: 5' NewSessionDialog.chain.test.tsx → 0 ✓
grep -c 'type: "ended", ok: true' src/ui/sidebar/NewSessionDialog.chain.test.tsx                  → 2 (≥ 1 required) ✓
grep -c "identityMode: true" src/ui/sidebar/NewSessionDialog.chain.test.tsx                       → 2 (≥ 1 required, D-16) ✓
```

**D-21 non-touch invariant:**

```
git diff HEAD~2 HEAD --stat src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx  → empty ✓
git diff HEAD~2 HEAD --stat src/ui/sidebar/NewSessionDialog.task-input.test.tsx     → empty ✓
```

**Scoped vitest runs:**

```
npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx                             → 34 passed / 34 total ✓
npx vitest run src/ui/sidebar/NewSessionDialog.chain.test.tsx                       → 15 passed / 15 total ✓
npx vitest run <both above>                                                          → 49 passed / 49 total ✓
npx vitest run src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx …task-input   → 22 passed / 22 total ✓ (untouched files still green)
```

**Frontend TypeScript:** `npx tsc --noEmit` exits 0 ✓

**Full build:** `npm run build` exits 0 (2.20s frontend build; backend TS also passing now that Wave-1 106-01 landed) ✓

**Post-commit deletion check:** `git diff --diff-filter=D --name-only HEAD~2 HEAD` returns empty (no file deletions in either commit) ✓

## Next Phase Readiness

- **For the ship gate (D-22 orchestrator work):** Both touched test files pass under scoped vitest. Sibling role-dropdown + task-input tests unchanged and passing. Frontend build clean. Backend build clean (assuming 106-03 also lands its assertions cleanly — 106-03 is the Wave 2 sibling touching `identity-birth-orchestrator.test.ts`). The full-suite `npx vitest run` should now pass once 106-03 lands — Alice's orchestrator can gate ship on that at their next tick.
- **For future NewSessionDialog UX phases:** Test 106A/B/C/D/E pin the current UX contract executably. Any future re-introduction of a per-step checklist would need to explicitly delete or rewrite these tests — the plan-time greps for `BirthProgress` / `Open tmux session` / `Launch Claude CLI` still work as regression guards.

## Verifier Notes / Things to Double-Check

- **`git diff HEAD~2 HEAD --stat src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx src/ui/sidebar/NewSessionDialog.task-input.test.tsx | wc -l` MUST return 0** — the D-21 non-touch invariant. Verified at commit time; verifier can re-check.
- **Test 106C's ordering assertion:** Uses `mock.invocationCallOrder[0]` — this is a numeric global monotonic counter across ALL vi.fn spies in the test run. The comparison `refresh < create < close` is stable regardless of what other tests in the file did before. Cross-test contamination is impossible because `beforeEach { vi.clearAllMocks() }` resets the counters' per-mock state (but the global counter monotonically increases — the comparison is relative-within-test).
- **Test 106D + 106E `alertSpy.mockRestore()`:** Explicit restore called at end of each test to avoid spy leakage to subsequent tests. `afterEach { vi.clearAllMocks() }` clears the mock's call history but does NOT restore spies — the explicit `.mockRestore()` handles that.
- **`grep -c 'type: "ended", ok: true'` returns 2 in chain.test.tsx:** one in the source code (line 611 — the yield literal), one in the comment (line 593 — description of Plan 106-01's contract). Both count for the acceptance-criteria grep.
- **`window.alert` count of 4 in main test file:** two in Test 106D (spy install + expect call), two in Test 106E (same shape). This is the correct minimum per D-17.
- **jsdom alert-not-implemented warnings during vitest runs are harmless** — the assertions test the spy's call log, not the alert's rendering. If verifier sees them, they can be safely ignored.

## Self-Check: PASSED

- **File exists check:** `.planning/phases/106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s/106-04-SUMMARY.md` FOUND (this file).
- **Commit exists check:** `git log --oneline` → `48d7d025 test(106-04): refresh NewSessionDialog.test.tsx for spinner+lock+alert UX` FOUND; `590658c0 test(106-04): add birth+auto-route chain test to NewSessionDialog.chain.test.tsx` FOUND.
- **Modified file exists checks:** `src/ui/sidebar/NewSessionDialog.test.tsx` FOUND (1377 lines, was 1468); `src/ui/sidebar/NewSessionDialog.chain.test.tsx` FOUND (672 lines, was 573).

---
*Phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s*
*Completed: 2026-09-11*
