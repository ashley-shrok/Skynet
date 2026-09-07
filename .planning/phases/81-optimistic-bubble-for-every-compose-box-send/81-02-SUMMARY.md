---
phase: 81-optimistic-bubble-for-every-compose-box-send
plan: 02
subsystem: pretty-view / optimistic bubbles / attachment-send seed wiring
tags: [attachments, pending-bubble, seed-wiring, integration-tests, wave-2]
requires:
  - Phase 81 Plan 01 (type widening — PendingSend/handleOptimisticSend/onOptimisticSend + ChatMessage pending-with-attachments render branch)
  - Phase 50 optimistic-bubble machinery (PendingSend + FIFO head-match + 20s timer)
  - Phase 05 use-pretty-view-uploads (startBatch, upload_ready_to_inject event, batchId gate)
provides:
  - Seed call inside PrettyView.onUploadReadyToInject closure (Option B — RESEARCH.md)
  - attachments prop pass-through at pending render callsite
  - 10 integration tests locking seed + render + FIFO cleanup + failure regressions
  - 1 compose-send integration test locking seed-and-dispatch-in-same-closure semantics
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (seed call inserted + render prop threaded)
  - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (new describe block: 10 tests)
  - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx (Test 6 appended)
tech-stack:
  added: []
  patterns:
    - Option B plumbing (seed inside PrettyView's own onUploadReadyToInject callback closure, NOT in ComposeBox or the uploads hook)
    - mqid === messageQueueItemId === batchId invariant (Pitfall #2 defense — comment names the invariant at the seed site)
    - Seed-before-dispatch (Phase 50 D-01) — handleOptimisticSend fires as the FIRST statement in the closure, before formatInjectedUserTurn + onInjectedTurnReady
    - Test scaffolding: addEventListener-listener replay (usePrettyViewUploads attaches its message handler via addEventListener, not ws.onmessage — the WsStub records these on ws.addEventListener.mock.calls; tests must replay frames into every registered listener)
    - Real-timer stage+send followed by production WS-frame trigger for failure states (test A4 drives flipToFailed via send_keys_error WS frame instead of a 20s timer swap because fake timers deadlock the stageAndSend helper's real-timer waitFor)
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx (L1517-1546 closure + L3433 render prop)
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (new describe block at end-of-file, L1300-1725)
    - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx (Test 6 appended before Test 5, ~L450-590)
decisions:
  - "Insert the seed call inside PrettyView's EXISTING onUploadReadyToInject closure (Option B) rather than adding a new sibling callback prop to ComposeBox — Option B lets the seed fire on the receiving side (regardless of which trigger site started the batch: primary Send, queue-slot Send, cadence auto-fire, voice-into-slot). All four attachment-trigger paths converge into this one plumbing point (RESEARCH.md § Plumbing Options — Option B recommendation)."
  - "Pass messageQueueItemId (from the WS event) verbatim as the mqid arg to handleOptimisticSend — NOT a freshly minted pv-optim-* id. This is Pitfall #2: the backend Phase 56 wake gate + pv-send-watchdog key on the batchId; a fresh id would decorrelate frontend + backend logs. Test A9 explicitly locks this invariant by asserting the DOM's data-event-id === 'pending-' + batchId (not 'pending-pv-optim-*')."
  - "Fire the seed call BEFORE formatInjectedUserTurn + onInjectedTurnReady inside the closure — the FIFO head-match cleanup at PrettyView.tsx L1900 fires on the incoming harness user-role echo; if the pending record doesn't exist yet when the echo lands, the echo appends as a normal user message and the pending bubble orphans forever."
  - "Strip landingPath + uploadTimestamp from the attachment metadata mapped into the seed args — those are settled-bubble-only fields; the pending bubble's chip render doesn't display them (D-05 hard-lock UPLOAD-11 chip visual — filename + human size only). Keeps the PendingSend.attachments shape structurally minimal."
  - "Test A4 uses send_keys_error WS-frame injection to drive flipToFailed rather than fake timers + vi.advanceTimersByTime. Reason: stageAndSend uses waitFor which polls with real setTimeout; activating fake timers before stageAndSend deadlocks it, and activating after means the seed's own setTimeout was armed under real timers and vi.advanceTimersByTime won't fire it. The send_keys_error path drives the exact same code path (flipToFailed) via a production WS-frame handler."
  - "Extend the two existing test files inline (add nested describe + one new test) rather than creating a sibling PrettyView.optimistic-bubbles-attachments.test.tsx. RESEARCH.md § Test File Layout scored inline extension over sibling file at 200+ lines of scaffolding avoided — mount factory, WS stub, flipToStreaming, countPendingBubbles helpers all reused verbatim."
metrics:
  duration_min: 90
  completed: 2026-09-07
---

# Phase 81 Plan 02: Wire seed call inside onUploadReadyToInject closure Summary

Wired the load-bearing seed call for attachment-carrying pending bubbles by inserting `handleOptimisticSend({payload, mqid, immediateFailure: false, attachments})` as the FIRST statement inside PrettyView's existing `onUploadReadyToInject` callback closure (Option B per RESEARCH.md). Passed the widened `PendingSend.attachments` field through to ChatMessage at the render callsite. Added 11 new integration tests exercising the wiring end-to-end via mounted-PrettyView + WS-frame injection. Zero regression across the full pretty-view test suite (879 tests pass).

## Files Modified

### `src/ui/features/pretty-view/PrettyView.tsx` (2 edits, 23 insertions)

1. **Site D — seed call inside `onUploadReadyToInject` closure** (was L1517-1524, now L1517-1546): inserted `handleOptimisticSend({payload: caption, mqid: messageQueueItemId, immediateFailure: false, attachments: files.map(f => ({filename, size, mimetype}))})` as the FIRST statement inside the callback body. Preserves existing `formatInjectedUserTurn` → `onInjectedTurnReady?` → `uploads.resetBatch()` sequence verbatim after the seed. Added a doc comment above the seed call naming the two invariants: (a) mqid === messageQueueItemId === batchId (Pitfall #2), (b) seed MUST precede dispatch so FIFO head-match at L1900 finds the pending record when the harness echo returns (Phase 50 D-01).

2. **Site C — pending render prop pass-through** (L3433): added `attachments={p.attachments}` inside the `<ChatMessage>` element in `pendingSends.map(...)`. When `p.attachments` is undefined (text-only pending), the prop passes `undefined` → ChatMessage's Plan 01 branch condition `attachments && attachments.length > 0` is false → ReactMarkdown fallback fires. Zero regression on text-only pendings.

### `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` (new describe block appended, 553 insertions)

New `describe("PrettyView — attachment pending bubbles (Phase 81)", ...)` block at end-of-file. Ten `it()` cases (Test A1 through A10):

| Test | Verifies | Requirement |
|------|----------|-------------|
| A1 | `upload_ready_to_inject` with caption + one file → pending bubble seeds with caption + chip strip | D-02, D-05, D-11 |
| A2 | Empty caption + files → chip strip only, no `.pv-injected-caption` div | D-06 |
| A3 | Chip strip carries `data-readonly="true"` | Pitfall #6, D-07 |
| A4 | `send_keys_error` frame → whole-bubble red inline style + chips still visible | D-08 (Phase 76 D-06 inheritance) |
| A5 | Superseded batch never seeds (batchId gate drops non-current-batch frames) | D-13 |
| A6 | `upload_failed` frame → no seed ever fires | D-12 |
| A7 | Silent (no `upload_ready_to_inject`) → no seed | D-12 (ws_not_open equivalence) |
| A8 | FIFO head-match on user-role echo clears attachment pending | D-10 |
| A9 | `data-event-id === "pending-<batchId>"` (NOT `pending-pv-optim-*`) | Pitfall #2 mqid invariant |
| A10 | Caption with literal `---attached files---` substring still routes to pending-with-attachments branch | Pitfall #4 defense |

Two reusable test helpers added at the top of the new describe block:
- `stageAndSend(container, ws, caption, filename, size, mimetype)`: stages a File via the hidden file picker input, types the caption, clicks Send, and returns the batchId minted by `uploads.startBatch` (extracted from the `upload_start` frame on the WS mock).
- `fireUploadReadyToInject(ws, batchId, files, caption)`: injects an `upload_ready_to_inject` WS frame via BOTH `ws.onmessage` AND every handler registered via `ws.addEventListener("message", ...)` — the uploads hook uses `addEventListener` and the WsStub's `addEventListener` is a plain `vi.fn()` that only records calls without wiring the handler, so tests must manually replay into every registered listener to reach the hook's message handler.

### `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` (Test 6 appended, ~177 insertions)

New integration test `Test 6 (Phase 81): onUploadReadyToInject seeds pending bubble AND dispatches WS write frames in the same closure — both effects observable end-to-end`. Mounts PrettyView with `onInjectedTurnReady` wired, drives the full flow (stage attachment via file picker → type caption → click Send → capture batchId from `upload_start` → inject `upload_ready_to_inject`), and asserts:
- (A) The pending bubble appears in the DOM (proves the seed ran)
- (B) The bubble's `data-event-id === "pending-<batchId>"` (proves the same closure that received the event ran the seed with the batchId as mqid)
- (C) `onInjectedTurnReady` fired exactly once with the batchId (proves the WS-write dispatch also ran inside the same closure)

The strict "seed synchronously before onInjectedTurnReady" ordering guarantee is implicit in the code structure (both statements sit in the same function body with no intervening await) — assertion (B) + (C) together lock the invariant end-to-end.

Added `fireEvent` to the existing `@testing-library/react` import at the top of the file.

## Test Additions

**11 new tests total** (10 in optimistic-bubbles + 1 in compose-send). All pass.

**Regression check:** Full `src/ui/features/pretty-view/` test suite green — 75 test files, 879 tests pass, 9 skipped, 1 todo. Zero regressions across:
- `PrettyView.optimistic-bubbles.test.tsx` (state machine + interleaving — Phase 50 baseline)
- `PrettyView.compose-send.test.tsx` (Phase 35 ref-forwarding tests)
- `ComposeBox.test.tsx` + `ComposeBox.queued-attachment.test.tsx` (compose-side)
- `use-pretty-view-uploads.test.ts` (upload hook)
- `ChatMessage.*.test.tsx` (5 files including the 9 Plan 01 pending-with-attachments tests)
- `AttachmentChipStrip.test.tsx`
- All other pretty-view sibling test files

## Coverage Table

Every one of D-01, D-02, D-03, D-04, D-10, D-11, D-12, D-13, D-17, D-18 covered by at least one test:

| Requirement | Test(s) | What it locks |
|-------------|---------|---------------|
| D-01 (every compose-box send → bubble) | A1 (attachment path); A8 (echo cleanup for attachment path); Phase 50 baseline (text path) | Attachment send now produces a pending bubble via seed inside onUploadReadyToInject |
| D-02 (seed at upload_ready_to_inject, not Send press) | A6, A7 (no seed until event fires); A1 (seed fires when event arrives) | Compose chips continue to own the upload phase; pending bubble covers only the after-upload window |
| D-03 (text sends seed at dispatch time — unchanged) | Full existing optimistic-bubbles suite (byte-unchanged, all green) | Zero regression on text-only path |
| D-04 (upload-phase / harness-confirmation separated visually) | A1 + A6 + A7 together | Pending bubble only appears post-upload; upload failures stay in compose chips |
| D-10 (FIFO head-match clears attachment pending via harness echo) | A8 | Content equality not required — FIFO position + role + state gate alone clears attachment pendings same as text |
| D-11 (mqid === messageQueueItemId, minted at startBatch) | A9 | Locks Pitfall #2 mqid invariant explicitly (asserts DOM id shape) |
| D-12 (upload failures never seed pending bubble) | A6 (upload_failed frame); A7 (silent — generalizes to ws_not_open) | readyFiredRef + batchId gates in the hook naturally prevent seed for failed batches |
| D-13 (superseded batch never seeds) | A5 (batchId gate drops non-current-batch frames) | No pending-bubble cleanup logic needed because seed never fires for superseded |
| D-17 (voice-submit routes through primary handleSend — covered by attachment fix) | Test 6 (compose-send) + A1 all four trigger sites converge into onUploadReadyToInject | Voice-submit + attachments (both primary and queue-slot) inherit the attachment fix by transitivity — the same closure seeds regardless of which trigger started the batch |
| D-18 (5×2 trigger matrix — all 4 attachment sites converge to same seed) | Test 6 (compose-send) exercises primary-Send + attachment; A1-A10 cover the seed side for all attachment triggers | Option B places the seed on the receiving side, so all four attachment trigger sites (primary Send, queue-slot Send, cadence, voice-slot) get the seed by construction |

## Confirmations

- `git diff --name-only 9076e55c HEAD` returns exactly 3 files: `PrettyView.tsx` + the two test files. No unintended edits.
- `git diff --stat use-pretty-view-uploads.ts` → empty (hook byte-unchanged per RESEARCH.md § Option B lock).
- `git diff --stat AttachmentChipStrip.tsx` → empty (component reused verbatim).
- `git diff --stat ComposeBox.tsx` → empty (Plan 01's type widening preserved; no logic changes in Plan 02).
- `git diff --stat ChatMessage.tsx` → empty (Plan 01's render branch fires as-is; no Plan-02-side edits).
- `grep -c "Phase 81 D-02" src/ui/features/pretty-view/PrettyView.tsx` → 1 (invariant comment at seed site).
- `grep -c "handleOptimisticSend({" src/ui/features/pretty-view/PrettyView.tsx` → 1 (only the new seed callsite; the other reference is the prop wiring).
- `grep -c "attachments={p.attachments}" src/ui/features/pretty-view/PrettyView.tsx` → 1 (render pass-through at L3433).
- Seed call line-order-verified precedes `formatInjectedUserTurn`: `awk '/onUploadReadyToInject: /,/getBufferedAmount:/' | grep -n -E "handleOptimisticSend|formatInjectedUserTurn"` returns handleOptimisticSend BEFORE formatInjectedUserTurn.
- `npx tsc -p tsconfig.json --noEmit` exits 0.
- 11 new tests + regression suite green.
- No sibling test file created (`ls PrettyView.optimistic-bubbles-attachments.test.tsx` returns "No such file").

## Deviations from Plan

### [Rule 3 - Blocker fix] Test 6 assertion re-scoped from strict-ordering to end-to-end effects

- **Found during:** Task 2 test authoring
- **Issue:** Original plan asked Test 6 to assert `pendingCountAtCall === 1` inside `onInjectedTurnReady` — i.e. that the pending bubble was already in the DOM when the WS-write dispatched. But React batches state updates: even though `handleOptimisticSend` runs synchronously BEFORE `onInjectedTurnReady` inside the same closure, the `setPendingSends(...)` state update doesn't commit until React re-renders (after the closure finishes). So `pendingCountAtCall` observed via DOM `querySelectorAll` is always 0 at that point — even though the seed logically fired first. The strict-ordering assertion is unobservable through the DOM.
- **Fix:** Re-scoped Test 6 to assert BOTH effects happened (pending bubble in DOM eventually + `onInjectedTurnReady` called with the batchId), with a docstring noting the strict-ordering invariant is implicit in the code structure (no `await` between the two synchronous statements in the same function body). This preserves the plan's INTENT (regression test locks the wiring works end-to-end) without depending on unobservable microtask timing.
- **Files modified:** `PrettyView.compose-send.test.tsx` (Test 6 only)
- **Commit:** `88037f42`

### [Rule 3 - Blocker fix] Test A4 uses send_keys_error frame instead of fake-timer advance

- **Found during:** Task 2 test authoring
- **Issue:** Plan called for `vi.useFakeTimers()` + `vi.advanceTimersByTime(20001)` to trigger the 20s timeout flipToFailed on the attachment pending. But `stageAndSend` uses `waitFor` which polls with real `setTimeout` — activating fake timers BEFORE `stageAndSend` deadlocks it, and activating AFTER means the seed's `window.setTimeout(...)` was armed under real timers so `vi.advanceTimersByTime` doesn't touch it.
- **Fix:** Test A4 stages + sends + fires `upload_ready_to_inject` under real timers (yielding a seeded pending bubble), then injects a `send_keys_error` WS frame with the same mqid — this drives `flipToFailed` via the production WS handler at PrettyView.tsx L2456 (same code path the 20s timer would trigger via a different entry point). The resulting failed bubble carries the same whole-bubble-red style. Docstring on the test explains the timer-strategy tradeoff.
- **Files modified:** `PrettyView.optimistic-bubbles.test.tsx` (Test A4 body)
- **Commit:** `88037f42`

### [Rule 3 - Blocker fix] Send button aria-label is "Send", not "Send message"

- **Found during:** Task 2 test authoring (initial run — all 11 tests failed with `expect(sendBtn).not.toBeNull()`)
- **Issue:** Plan reference-block used a placeholder aria-label; the actual `<button aria-label={asideActive ? "Resume" : "Send"}>` at ComposeBox.tsx:2895 uses `"Send"`.
- **Fix:** Corrected the `button[aria-label="..."]` querySelectors in both test files to `"Send"`.
- **Files modified:** Both test files (single `replace_all`)
- **Commit:** `88037f42`

### [Rule 3 - Blocker fix] WsStub addEventListener is a plain vi.fn() — must replay handlers manually

- **Found during:** Task 2 test authoring (after aria-label fix — 7 tests still failed with `expected 0 to be 1` on pending bubble count)
- **Issue:** `usePrettyViewUploads` attaches its WS message handler via `ws.addEventListener("message", handler)` (use-pretty-view-uploads.ts:355-359), NOT via `ws.onmessage`. The existing WsStub has `addEventListener: vi.fn()` — a plain mock that records calls but does NOT wire the handler. Injecting frames via `ws.onmessage?.(...)` only reaches PrettyView's own top-level handler, not the uploads hook.
- **Fix:** `fireUploadReadyToInject` helper now reads `ws.addEventListener.mock.calls`, filters for `[type, handler]` pairs where type === `"message"`, and invokes each `handler(evt)` in turn — reaches both the PrettyView-level and uploads-hook-level subscribers. Same fix applied inline inside compose-send Test 6.
- **Files modified:** Both test files
- **Commit:** `88037f42`

## Pitfalls Encountered

- **Pitfall #2 (mqid invariant):** Locked at the seed site via inline comment naming the invariant. Test A9 explicitly asserts `pending-<batchId>` (not `pending-pv-optim-*`) to prevent copy-paste regression from `useComposeSend.send`.
- **Pitfall #4 (parseInjectedUserTurn on caption-only content):** Test A10 locks the defense — a caption containing the literal `---attached files---` substring without well-formed file lines returns `null` from `parseInjectedUserTurn`, so the pending-with-attachments branch fires (not the settled injected branch). No code mitigation needed.
- **Pitfall #6 (AttachmentChipStrip readOnly marker):** Test A3 asserts `data-readonly="true"` on the chip strip. Both the seed call and the render prop pass-through emit the correct chip metadata; the Plan 01 render branch always passes `readOnly={true}` verbatim.
- **Pitfall (test scaffolding, new):** The WsStub's `addEventListener` is a plain `vi.fn()`. When a test needs to reach a listener that was subscribed via `addEventListener` (rather than `ws.onmessage`), the helper must replay the frame into every recorded handler. Documented inline in both helpers.

## Threat Flags

None — the plan's `<threat_model>` covers all new surfaces. T-81-05 (spoofing via fake `upload_ready_to_inject`) is mitigated by the pre-existing batchId gate at use-pretty-view-uploads.ts:378 — unchanged. T-81-06 (repudiation) is mitigated by the Plan 01 log-marker `attachmentCount=${...}`. T-81-07 (session-rotation clear) inherits from existing `clearAllPendingSends("session-rotation")`. T-81-08 (retry-double-seed) is mitigated by the pre-existing `readyFiredRef` guard. No new threat surface introduced.

## Commits

- `65d70106` — Task 1: wire seed call inside onUploadReadyToInject + attachments prop pass-through
- `88037f42` — Task 2: 10 attachment-pending-bubble tests + 1 compose-send integration test

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` — MODIFIED (`git diff --stat` shows 23 insertions; grep finds 1 `Phase 81 D-02` marker + 1 seed callsite + 1 `attachments={p.attachments}` pass-through)
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — MODIFIED (`grep -cE 'it\("Test A[0-9]+' returns 10`; new describe block for "Phase 81" attachment bubbles)
- `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` — MODIFIED (`grep -cE 'it\("Test 6 \(Phase 81\)' returns 1`; fireEvent added to imports)
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` — UNCHANGED (`git diff --name-only` empty since 9076e55c)
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — UNCHANGED
- `src/ui/features/pretty-view/ComposeBox.tsx` — UNCHANGED (Plan 01's type widening preserved)
- `src/ui/features/pretty-view/ChatMessage.tsx` — UNCHANGED (Plan 01's render branch fires as-is)
- Commit `65d70106` — FOUND in `git log --oneline`
- Commit `88037f42` — FOUND in `git log --oneline`
- TypeScript compiles clean (`npx tsc -p tsconfig.json --noEmit` exits 0)
- Full pretty-view suite green: 75 test files / 879 tests pass / 9 skipped / 1 todo
- 11 new tests all pass
