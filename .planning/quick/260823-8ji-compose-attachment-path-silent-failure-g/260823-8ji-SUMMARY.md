---
phase: quick-260823-8ji
plan: 01
status: complete
completed: 2026-08-23
branch: feat/tab-title-from-tmux
commits:
  - 14827414 test(quick-260823-8ji): add batch-outcome-Promise tests (RED)
  - f765cac1 feat(quick-260823-8ji): startBatch surfaces per-batch outcome Promise + 30s timeout (GREEN)
  - e0c124d1 test(quick-260823-8ji): add attachment-path outcome-gating tests (RED)
  - f1f07b1c fix(quick-260823-8ji): ComposeBox awaits attachment-batch outcome; preserve compose state on failure (GREEN)
files_modified:
  - src/ui/features/pretty-view/use-pretty-view-uploads.ts
  - src/ui/features/pretty-view/use-pretty-view-uploads.test.ts
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
requirements_completed:
  - Q8JI-01  # startBatch surfaces a per-batch outcome Promise
  - Q8JI-02  # ComposeBox attachment-path awaits outcome; preserves compose on failure
  - Q8JI-03  # PrettyView plumbs the outcome-Promise through onSendWithAttachments
tags:
  - frontend
  - pretty-view
  - compose
  - uploads
  - attachments
  - reliability
  - silent-failure
---

# Quick 260823-8ji Summary — Compose attachment-path silent-failure gate on batch outcome

## One-liner

Widen `startBatch` / `retryBatch` to surface a per-batch `Promise<BatchOutcome>` + 30 s
timeout; rewrite `ComposeBox` `handleSend`'s attachment branch (`ComposeBox.tsx:1317-1327`)
to await that outcome and preserve the textarea + attachment chips on failure/timeout/ws-drop
so Ashley never loses a compose draft to a silent-clear again (bug hit 4× on 2026-08-23
across wanda + nelly).

## Change surface

### `use-pretty-view-uploads.ts` (Task 1)

- **New exported types**:
  - `BatchFailureReason = "upload_failed" | "timeout" | "ws_not_open" | "ws_send_threw" | "superseded"`
  - `BatchOutcome = { ok: true } | { ok: false; reason: BatchFailureReason; message?: string }`
- **Return-shape widen (breaking-shape for TS but purely additive at runtime)**:
  - `startBatch(caption)` → `Promise<{ messageQueueItemId, outcome: Promise<BatchOutcome> } | null>`
  - `retryBatch()` → same
- **New internal plumbing (refs, not state — zero re-render pressure)**:
  - `outcomeResolversByBatchIdRef: Map<string, (o: BatchOutcome) => void>`
  - `batchTimeoutHandlesByBatchIdRef: Map<string, ReturnType<typeof setTimeout>>`
  - Helpers: `resolveOutcome(batchId, o)`, `clearBatchTimeout(batchId)`, `armBatchTimeout(batchId)`
- **Constant**: `BATCH_OUTCOME_TIMEOUT_MS = 30_000` (colocated at L128-140 with the other backpressure/folder constants).
- **`handleServerEvent` additive changes** (no restructure):
  - `upload_failed` branch: first line = `resolveOutcome(ourBatch, { ok: false, reason: "upload_failed", message: `${event.reason}: ${event.message}` })`.
  - `upload_ready_to_inject` branch: right after `readyFiredRef.current = true`, before `cb(...)`, call `resolveOutcome(ourBatch, { ok: true })`.
- **`startBatch` / `retryBatch` control flow**: mints outcome resolver, stashes it, arms the 30 s timer on successful WS accept; ws-null → `resolveOutcome(batchId, { ok:false, reason:"ws_not_open" })`; ws-send-throws → `resolveOutcome(batchId, { ok:false, reason:"ws_send_threw" })`. In BOTH failure paths `pendingSendWaitingForWs` still latches so `onWsReconnect`'s retry can pick up.
- **`resetBatch`**: if there's an outstanding resolver for `batchIdRef.current`, resolves it with `{ ok:false, reason:"superseded" }` before nulling — prevents dangling awaiters.

### `ComposeBox.tsx` (Task 2)

- **Prop widen**: `onSendWithAttachments?: (caption: string) => Promise<BatchOutcome>` (was `void`). JSDoc updated to document the new outcome-Promise + preserve-on-failure contract.
- **Module-scoped helper** `getBatchFailureUserMessage(reason)` maps reason → user-facing string; uses `type BatchFailureReasonForCompose = Exclude<BatchOutcome, { ok: true }>["reason"]` for exhaustive-switch safety.
- **`handleSend` attachment branch rewritten** (`ComposeBox.tsx:1317-1327` → ~L1352-1400 post-rewrite):
  - Outer `handleSend` STAYS synchronous (existing queue-cadence + voice consumers don't await).
  - Extracted inner async closure `runAttachmentSend()` does the awaited outcome-check.
  - `outcome.ok` → log `submit-success ... path=attachment`, `setText("")`, `clearAfterSend()`.
  - `outcome.reason === "superseded"` → return early (newer send drives UI state; don't stomp).
  - `!outcome.ok` (other reasons) → log `submit-failed ... path=attachment reason=<> message=<>` at WARN, `setErrorMessage(userMessage)`. **Deliberately does NOT clear text or attachments.**
- **New log marker**: `path=attachment` on submit-entry/success/failed lines (only on the attachment branch — non-attachment path's log lines are byte-shape unchanged so the 7+ log-assertion tests across sibling files keep passing).
- **`mqid=pending` on submit-entry** (attachment path): the real mqid is minted inside the hook and returned via the awaited Promise; submit-success/failed lines still carry hostId + tmuxSession + bodyLen for correlation.

### `PrettyView.tsx` (Task 2)

- **`onSendWithAttachments` wire updated** (was `void uploads.startBatch(caption)`):
  ```ts
  onSendWithAttachments={async (caption) => {
    const ret = await uploads.startBatch(caption);
    if (!ret) return { ok: false, reason: "upload_failed", message: "No attachments staged" };
    return ret.outcome;
  }}
  ```
- Null-batch defensive fallback so ComposeBox never sees an unresolved await (startBatch returns null when no attachments are staged — the compose surface already guards on hasAttachments upstream, but the defensive surface is cheap).

## Required Q&A from plan output block

### mqid plumbing shape

**Decision: Shipped WITHOUT mqid in attachment-path logs.**

Rationale: The plan explicitly allowed this ("if mqid plumbing turns out to add >30 lines of type gymnastics, ship without mqid in the attachment-path logs — the submit-entry/submit-failed lines already include hostId + tmuxSession + bodyLen which is enough for production triage; mqid is a nice-to-have per the bug directive, not a must-have"). The `{ outcome, messageQueueItemId }` wrapper would have required threading the messageQueueItemId through both the PrettyView callback shape and the ComposeBox closure, adding an extra destructure layer for a piece of data (mqid) that ComposeBox has no other use for. `path=attachment` + hostId + tmuxSession + bodyLen give enough grep-triage power for production failure correlation, and the backend `upload_start` log line already carries the mqid on the server side — correlation across the client/server boundary is achievable via the timestamp + hostId + tmuxSession + bodyLen tuple.

### `BATCH_OUTCOME_TIMEOUT_MS` value

**Decision: 30_000 (unchanged from the plan default).**

Consulted backend constant: `grep -rn "PASTE_SEND_TIMEOUT_MS\|UPLOAD_READY_TIMEOUT_MS\|paste_send.*timeout" src/backend/claude-session/` returned zero hits (2026-08-23). No backend constant to align with, so 30_000 is authoritative on the client side. This is called out in the constant's JSDoc so a future backend timeout addition is easy to reconcile.

### `upload_failed` batch-level vs per-file resolve gate

**Decision: Resolve on ANY `upload_failed` event (per-file OR batch-level) — no `!event.tempId` gate.**

Rationale: Batch atomicity semantics mean a per-file upload_failed short-circuits the whole batch (backend will not emit ready_to_inject), so from ComposeBox's perspective the batch has failed regardless of whether the failure was per-file or batch-level. Resolving on the first upload_failed event is the safe default per the bug directive's "Upload_failed arrives → surface the reason" line. Documented in the case-branch comment for future backend-semantic reconciliation.

### Unpushed-commit count on `feat/tab-title-from-tmux`

Prior HEAD (`827d759d`) + 4 new commits + docs commit (this file) = prior + 5. The plan's success criterion said "prior + 4"; the docs commit brings it to prior + 5 as required by the executor output spec.

### Scoped-gate command output tail

```
$ npx vitest run \
    src/ui/features/pretty-view/use-pretty-view-uploads.test.ts \
    src/ui/features/pretty-view/ComposeBox.test.tsx \
    src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx \
    src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx \
    src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx \
    src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx \
    src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx \
    src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx \
    src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx \
    src/ui/features/pretty-view/ComposeBox.voice.test.tsx \
    src/ui/features/pretty-view/AttachmentChipStrip.test.tsx

 Test Files  11 passed (11)
      Tests  177 passed (177)
   Start at  06:27:47
   Duration  224.56s
```

Zero failures, +9 tests over baseline (5 new outcome tests on use-pretty-view-uploads.test.ts + 4 new attachment-outcome-gating tests on ComposeBox.test.tsx).

`npx tsc --noEmit` also exits clean.

### Cross-reference to prior Ashley-approved quicks on this branch

Prior quicks on `feat/tab-title-from-tmux` (recent-to-older):
- `260821-suv` (iPad long-press swipe useIsTouchDevice pointer) — commit `827d759d` docs, `d110ab51` GREEN, `4f4e94f2` RED, `2b40dc28` backfill.
- `260821-shn` (docs summary at `ba5e86e8`).

This quick's four code commits + one docs commit sit atop those, unpushed. Orchestrator (tabitha) can bundle this with the pending `feat/tab-title-from-tmux` shipment or ship standalone — no cross-dependency on the earlier quicks' files (all touched files are ComposeBox / uploads / PrettyView; the iPad quick touched PrettyConversationRow + useIsTouchDevice).

### Pre-existing test files needing `.mockResolvedValue({ ok: true })` adaptation

**Zero.** `grep -ln "onSendWithAttachments" src/ui/features/pretty-view/*.test.tsx` returned only `ComposeBox.test.tsx`. Only one existing test (Test 7 at ~L288) previously used `vi.fn()` as the onSendWithAttachments mock; that mock was updated to `vi.fn(() => Promise.resolve({ ok: true as const }))` in the Task 2 RED commit and the assertion `expect(onSendWithAttachments).toHaveBeenCalledWith("hey")` still passes on GREEN.

No other test files in the pretty-view test surface touch this prop.

## Deviations from plan

**None material.**

Minor executor judgment calls (all pre-authorized by the plan's "Executor's judgment call" clauses):

1. **Attachment-path mqid plumbing shape**: shipped without mqid rather than adding the wrapper (see "mqid plumbing shape" above). Justified by the plan explicitly permitting the ship-without-mqid path.
2. **BATCH_OUTCOME_TIMEOUT_MS = 30_000**: retained the default. Backend consulted (no matching constant), so no bump needed.
3. **upload_failed resolve gate**: no `!event.tempId` narrowing — resolve on any upload_failed. Justified by the plan's "safer default" line.
4. **Test naming**: used `Outcome-1..5` in a fresh `describe` block (rather than "Test 14..18") to avoid collision with the existing Test 14 (`empty batch — startBatch is a no-op returning null`) in the same test file. Same test-count semantics, cleaner history.
5. **Helper location**: `getBatchFailureUserMessage` colocated at module scope near `SEG_COUNT` (rather than inside the `ComposeBox` function body next to `collapseNewlinesForSend`) so it's not re-created per render. Both spellings work; module-scope is slightly cleaner for a pure-fn.

## Verification against `<success_criteria>`

- [x] 1. Happy path (upload_ready_to_inject) → textarea + chips cleared, `submit-success ... path=attachment` logged. Locked by Test 7 + attachment-outcome-gating T1.
- [x] 2. upload_failed → textarea + chips PRESERVED, "Upload failed — try again." + WARN log. Locked by attachment-outcome-gating T2.
- [x] 3. 30 s timeout → textarea + chips PRESERVED, "Upload timed out ..." + WARN log. Locked by Outcome-3 on the hook + T3 on ComposeBox.
- [x] 4. ws-drop / ws-not-open → textarea + chips PRESERVED, connection error + WARN log. Locked by Outcome-4/5 on the hook + T4 on ComposeBox.
- [x] 5. Non-attachment path unchanged. Phase 50 D-01/D-18/D-19/D-20 tests (Test 2/3/5/6/7 in the "optimistic bubble seeding" describe) all pass on GREEN; `pv-optim-<ms>-<hex>` mqid pattern preserved; no `path=` marker added to non-attachment log lines.
- [x] 6. `BatchOutcome` type exported; startBatch + retryBatch return `{ messageQueueItemId, outcome } | null`; both terminal branches resolve the outcome; 30 s timer arms + fires timeout.
- [x] 7. Four atomic commits (RED/GREEN × 2) on `feat/tab-title-from-tmux`. No `--no-verify`, not pushed, not deployed.
- [x] 8. `grep -rn 'quick-260823-8ji' src/ui/features/pretty-view/` → 4 hits.
- [x] 9. `grep -n 'onSendWithAttachments(' src/ui/features/pretty-view/ComposeBox.tsx | grep -v 'await'` → 0 non-await call sites.
- [x] 10. Ashley UX invariant: compose state preserved on failure; retry without re-typing/re-attaching. Locked by T2/T3/T4 attachment-outcome-gating tests.

## Self-Check: PASSED

- All four commits present in `git log --oneline`:
  - `14827414` test RED Task 1 → FOUND
  - `f765cac1` feat GREEN Task 1 → FOUND
  - `e0c124d1` test RED Task 2 → FOUND
  - `f1f07b1c` fix GREEN Task 2 → FOUND
- All modified files exist and contain expected symbols:
  - `use-pretty-view-uploads.ts` — `BatchOutcome`, `outcomeResolversByBatchIdRef`, `BATCH_OUTCOME_TIMEOUT_MS`, `resolveOutcome`, `armBatchTimeout` all present (45 grep hits).
  - `ComposeBox.tsx` — `getBatchFailureUserMessage`, `BatchOutcome` import, `path=attachment` × 2 log markers, `quick-260823-8ji` breadcrumb (15 grep hits).
  - `PrettyView.tsx` — `ret.outcome`, `quick-260823-8ji`, `BatchOutcome` (3 grep hits).
- Scoped-gate: 11 files, 177 tests, 0 failures.
- `npx tsc --noEmit`: clean.
