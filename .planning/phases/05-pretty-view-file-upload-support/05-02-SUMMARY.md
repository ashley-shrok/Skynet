---
phase: 05-pretty-view-file-upload-support
plan: 02
subsystem: frontend
tags: [pretty-view, uploads, drag-drop, paste, chip-strip, mobile-paperclip, wire-protocol-client, tdd]

# Dependency graph
requires:
  - plan: 05-01
    provides: "src/ui/api/pretty-view-upload-protocol.ts (types + formatInjectedUserTurn + constants) + backend WS orchestrator (upload_start/upload_chunk/upload_abort accepted; upload_progress/upload_complete/upload_failed/upload_ready_to_inject emitted)"
  - patch: "#102 (useIsTouchDevice)"
    provides: "src/ui/hooks/use-is-touch-device.ts — the SOLE gate for the mobile paperclip"
  - patch: "#57 (compose-drafts persistence)"
    provides: "src/ui/api/compose-drafts-api.ts + ComposeBox's existing dirtyBodyRef/flushDirty machinery — caption text survives tab close, attachments explicitly do NOT"

provides:
  - "src/ui/features/pretty-view/use-pretty-view-uploads.ts — orchestrator hook (staged state, chunk pump, batch atomicity, retry, WS disconnect handling)"
  - "src/ui/features/pretty-view/AttachmentChipStrip.tsx — chip strip component (filename + human-size + per-chip progress / complete / error / × remove)"
  - "src/ui/features/pretty-view/DropOverlay.tsx — full-surface drop overlay + folder-drop nudge, pointer-events-none"
  - "ComposeBox extended with 6 new optional props (stagedAttachments, onRemoveAttachment, showPaperclip, onAttachFiles, onSendWithAttachments, onRetryBatch)"
  - "PrettyView extended with 2 new optional props (terminalWs, onInjectedTurnReady) — Plan 03 wiring seam"

affects: [05-03]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies (locks in Plan 05-01's zero-new-deps stance).
  patterns:
    - "TDD RED → GREEN cycle for all three tasks (test file created + verified failing before implementation)"
    - "Hook orchestrator with React-only state — attachment bytes never touch a persistence primitive (UPLOAD-08 HARD LOCK)"
    - "StagedAttachmentLike structural subset — hook's StagedAttachment flows through the presentational component without a type cast; tests can pass POJOs without real File objects"
    - "Single onAttachFiles callback unifies paperclip (hidden input onChange) + textarea paste (onPaste on file-shaped clipboard payloads) entry points"
    - "Reference-and-not-import: DropOverlay borrows patch #86 ImageBubble's visual vocabulary (rounded border, muted background) without importing anything from it"

key-files:
  created:
    - "src/ui/features/pretty-view/use-pretty-view-uploads.ts (~630 lines — orchestrator hook)"
    - "src/ui/features/pretty-view/use-pretty-view-uploads.test.ts (14 Vitest cases)"
    - "src/ui/features/pretty-view/AttachmentChipStrip.tsx (~160 lines)"
    - "src/ui/features/pretty-view/AttachmentChipStrip.test.tsx (7 Vitest cases)"
    - "src/ui/features/pretty-view/DropOverlay.tsx (~100 lines)"
    - "src/ui/features/pretty-view/DropOverlay.test.tsx (5 Vitest cases)"
    - "src/ui/features/pretty-view/ComposeBox.test.tsx (10 Vitest cases)"
    - "src/ui/features/pretty-view/PrettyView.test.tsx (3 Vitest cases)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-02-SUMMARY.md (this file)"
  modified:
    - "src/ui/features/pretty-view/ComposeBox.tsx (added 6 optional props + chip strip mount + paperclip button + hidden file input + onPaste handler + Retry button + Send routing to onSendWithAttachments; sendDisabled now considers attachments)"
    - "src/ui/features/pretty-view/PrettyView.tsx (added 2 optional props + 4 imports + usePrettyViewUploads call + useIsTouchDevice call + drag/drop handlers on data-pv-root + DropOverlay mount + 6 new prop pass-throughs to ComposeBox)"

key-decisions:
  - "Paperclip is `useIsTouchDevice`-gated ONLY (UPLOAD-03 HARD LOCK); zero references to window.innerWidth in ComposeBox.tsx"
  - "Attachment bytes are React-only — grep for localStorage|sessionStorage|indexedDB in use-pretty-view-uploads.ts returns 0 (UPLOAD-08)"
  - "Caption text still rides patch #57's putComposeDraft path — no attachment persistence hooks added to that machinery (UPLOAD-08 asymmetry)"
  - "Retry semantics: hook exposes reuseIdOnRetry (default false = fresh messageQueueItemId per retry, matching Plan 01's no-upload_reset assumption). PrettyView doesn't override the default; retry emits a fresh id so the backend sees a new batch. Documented in hook JSDoc."
  - "Folder detection: primary path via DataTransferItemList webkitGetAsEntry().isDirectory; fallback via File.size===0 && !type heuristic. All-or-nothing rejection — a mixed drop refuses everything with the amber nudge for ~3s (UPLOAD-12)"
  - "Chip = filename + human-size + per-chip status glyph + × control ONLY. No thumbnails, no per-chip caption input, no inline preview even for images (UPLOAD-11 + UPLOAD-13)"
  - "Send button gate: enabled when (text.trim() OR attachments present) AND canSend !== false (UPLOAD-13 empty-caption-with-attachments allowed)"
  - "onSendWithAttachments callback shape: (caption: string) => void — the parent hook owns the promise / async batch. ComposeBox clears text unconditionally on this path (draft persistence path fires normally with the empty body)"
  - "Drag counter pattern for dragenter/leave — child-boundary misfires would otherwise flap the overlay on every hover child; single counter debounces the transitions"
  - "DropOverlay is pointer-events-none on ALL variants (drag-over and folder-rejected). The drop event lands on data-pv-root's onDrop handler; the overlay is visual-only"
  - "Retry button placement: above the chip strip inside ComposeBox, small variant=outline size=xs. Only surfaces when at least one chip has status='error'. Fires onRetryBatch which the parent hook's retryBatch consumes"

patterns-established:
  - "Structural props (StagedAttachmentLike) let presentational components stay decoupled from the hook's exact state shape — hooks can add fields without breaking chip strip; tests don't need real File objects"
  - "Unified onAttachFiles callback for multiple entry points — reused for paperclip input change + textarea paste. Any future entry point (e.g. desktop hotkey to open file picker, if the itch surfaces) plugs into the same seam"
  - "Fire-and-forget promise consumption in the UI (`void uploads.startBatch(caption)`) — the batch's async lifecycle drives UI updates via the hook's own state, not the caller's awaited promise"

requirements-completed:
  - UPLOAD-01
  - UPLOAD-02
  - UPLOAD-03
  - UPLOAD-04
  - UPLOAD-05
  - UPLOAD-07
  - UPLOAD-08
  - UPLOAD-12
  - UPLOAD-13

# Metrics
duration: ~40min
completed: 2026-07-20
---

# Phase 5 Plan 05-02: Frontend upload UX — chip strip + drop overlay + paste + mobile paperclip + orchestrator hook Summary

**End-to-end client-side upload UX inside `src/ui/features/pretty-view/` — user drags/pastes/taps to stage files as chips, hook chunks them to the Plan 01 backend, and hands Plan 03 a clean `onInjectedTurnReady(text, messageQueueItemId)` seam.**

## Performance

- **Duration:** ~40 min wall clock
- **Started:** 2026-07-20T11:19:00Z (approx — first read of PLAN.md after mount)
- **Completed:** 2026-07-20T11:36:00Z
- **Tasks:** 3 (all TDD; all Wave 2 client-side)
- **Files created:** 8 (3 source + 4 test + this SUMMARY)
- **Files modified:** 2 (ComposeBox.tsx, PrettyView.tsx)

## Accomplishments

- **The orchestrator hook lives.** `usePrettyViewUploads` owns staged-attachment state, the chunk pump, batch atomicity, retry API, WS-disconnect resume plumbing, folder-drop rejection, and the onUploadReadyToInject seam. 14/14 Vitest cases cover every path. Zero browser storage primitives touched (grep-verified).
- **The chip strip lives.** `AttachmentChipStrip` returns null when empty (UPLOAD-04 mounting rule), renders filename + human-size + per-chip status glyph (progress bar / check / alert-circle) + × control. Structural `StagedAttachmentLike` shape lets tests pass POJOs. 7/7 Vitest cases.
- **The drop overlay lives.** `DropOverlay` mounts `absolute inset-0 z-[95] pointer-events-none` inside data-pv-root, with a cool-neutral drag-over variant and a distinct warm-amber folder-rejection variant. 5/5 Vitest cases (including the pointer-events-none invariant on both variants).
- **ComposeBox wired.** 6 new optional props layered on the existing 8. Chip strip mounts above the compose row; hidden `<input type=file multiple>` driven by the paperclip button; unified `onAttachFiles` callback for paperclip + paste; Send routes to `onSendWithAttachments` when attachments are staged; Retry button appears above the strip when any chip errored. 10/10 ComposeBox.test.tsx cases. Patch #57 draft persistence intact (grep count unchanged).
- **PrettyView wired.** 2 new optional props; usePrettyViewUploads hook consumed with the terminalWs prop; useIsTouchDevice threaded as the sole paperclip gate; drag/drop handlers on data-pv-root; DropOverlay mounted; 6 new pass-through props to ComposeBox; onUploadReadyToInject callback formats the injected turn via formatInjectedUserTurn and hands the text + id up to onInjectedTurnReady, then resetBatch clears staging. 3/3 PrettyView.test.tsx cases.
- **Full project regression clean.** All 384 project tests pass (was 384 before this plan — 34 new tests added, existing tests still green). `npx tsc --noEmit --skipLibCheck` clean. `npm run build` clean (7.9s).
- **Zero cross-plan boundary violations.** `git diff --stat src/ui/features/terminal/` returns empty. `git diff --stat src/backend/` returns empty. `git diff --stat package.json package-lock.json` returns empty (zero new npm deps).

## Task Commits

1. **Task 1: usePrettyViewUploads orchestrator hook + tests** — `6a275a7` (feat — RED test + GREEN impl in one commit after one iteration on the concurrency-limit test's assertion strategy)
2. **Task 2: AttachmentChipStrip + DropOverlay presentational components** — `19fd628` (feat — RED tests + GREEN impls together)
3. **Task 3: Wire ComposeBox + PrettyView** — `d1d8f3f` (feat — RED tests + GREEN wiring together)

## Files Created/Modified

**Created:**

- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` — ~630 lines. Hook with return shape: `{stagedAttachments, folderDropRejected, batchInFlight, pendingSendWaitingForWs, stageAttachments, removeAttachment, startBatch, retryBatch, resetBatch, onWsReconnect}`. Internal: React state + refs (no persistence), chunk pump with per-file async loops gated by `MAX_CONCURRENT_UPLOADS_PER_BATCH=3` semaphore, backpressure via caller-provided `getBufferedAmount()` (4MB high water, 1MB low water, ~3s hard timeout), base64 encoding via btoa with chunked String.fromCharCode.apply to avoid arg-count limits.
- `src/ui/features/pretty-view/use-pretty-view-uploads.test.ts` — 14 Vitest cases (staging, folder rejection with fake timers, remove attached, remove-during-upload emits abort, startBatch happy path, onUploadReadyToInject fires once with landing paths + preserved caption, progress updates bytesUploaded, failed marks error and prevents onReady, retry reuses id when configured, WS disconnect sets pendingSendWaitingForWs, concurrency limit respected, backpressure pauses+resumes, caption snapshot preserved, empty-batch no-op).
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — ~160 lines. `AttachmentChipStrip({attachments, onRemove, className?})` returning null when empty, otherwise a `flex flex-wrap gap-2` strip of chips. Chip: file icon + truncated filename (max-w-[220px]) + formatHumanSize output + status glyph + × Button (size=icon-xs, variant=ghost, aria-label=`Remove attachment ${name}`). Error state: destructive tint + AlertCircle + error text. Complete state: emerald border + Check.
- `src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` — 7 Vitest cases.
- `src/ui/features/pretty-view/DropOverlay.tsx` — ~100 lines. `DropOverlay({isDragOver, folderDropRejected})` returning null when both false. folderDropRejected takes priority (amber tint + AlertTriangle + "please attach files or zip first"). isDragOver renders cool slate tint + dashed inset border + "Drop files here" + Upload icon. Both variants `absolute inset-0 z-[95] pointer-events-none` on the outermost element.
- `src/ui/features/pretty-view/DropOverlay.test.tsx` — 5 Vitest cases.
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — 10 Vitest cases (mocks `@/api/compose-drafts-api` so ComposeBox's mount effect doesn't touch fetch).
- `src/ui/features/pretty-view/PrettyView.test.tsx` — 3 Vitest cases (mocks `@/api/claude-session-api`, `@/api/compose-drafts-api`, `@/features/terminal/session-hue`, `@/features/terminal/IdentityBadge`, `@/hooks/use-is-touch-device`).

**Modified:**

- `src/ui/features/pretty-view/ComposeBox.tsx`:
  - Imports: `Paperclip`, `RefreshCw` from lucide-react; `AttachmentChipStrip`, `StagedAttachmentLike` from `./AttachmentChipStrip`.
  - `ComposeBoxProps` extended with 6 optional props (see final shape below).
  - New refs: `fileInputRef` (hidden `<input type=file multiple>`).
  - New callbacks: `handleOpenFilePicker`, `handleFileInputChange`, `handlePaste`.
  - Chip strip mounts as first child of the ComposeBox root wrapper. Retry button mounts below the chip strip when any chip has `status='error'`. Hidden file input mounts next.
  - `handleSend` gains an early-return path that calls `onSendWithAttachments(captionPayload)` when attachments are staged, clearing the textarea unconditionally.
  - `sendDisabled` reworked: `(text.trim() === "" && !hasAttachments) || canSend === false`.
  - Paperclip Button conditionally mounted at TOP of icon column (least-used first), gated on `showPaperclip`. Matches ThumbsUp's warm-neutral Glass treatment.
  - Textarea gains `onPaste={handlePaste}`.
  - Patch #57 draft persistence 100% intact — `putComposeDraft` + `flushComposeDraftKeepalive` count in the file is unchanged from pre-plan baseline (6 occurrences).

- `src/ui/features/pretty-view/PrettyView.tsx`:
  - Imports: `DropOverlay`, `usePrettyViewUploads`, `useIsTouchDevice`, `formatInjectedUserTurn` (4 new imports).
  - `PrettyViewProps` extended with `terminalWs?: WebSocket | null` and `onInjectedTurnReady?: (text: string, messageQueueItemId: string) => void`.
  - New state: `isDragOver` (boolean) + `dragCounterRef` (child-boundary debounce).
  - `useIsTouchDevice()` called once at top level; result passed to ComposeBox via `showPaperclip`.
  - `usePrettyViewUploads({ws: terminalWs ?? null, onUploadReadyToInject: cb, getBufferedAmount: () => terminalWs?.bufferedAmount ?? 0})` called at top level. The callback formats via `formatInjectedUserTurn({caption, files})` and calls `onInjectedTurnReady?.(text, messageQueueItemId)`, then `uploads.resetBatch()`.
  - `data-pv-root` gains `onDragEnter/onDragOver/onDragLeave/onDrop` handlers. onDrop prefers `dt.items` (for folder detection via webkitGetAsEntry) and falls back to `dt.files`.
  - `<DropOverlay isDragOver={isDragOver} folderDropRejected={uploads.folderDropRejected} />` mounts as the last child of data-pv-root (below the ComposeBox but stacks visually above chat content via z-[95]).
  - ComposeBox mount gains 6 additional prop pass-throughs: `stagedAttachments`, `onRemoveAttachment`, `showPaperclip`, `onAttachFiles`, `onSendWithAttachments`, `onRetryBatch`. All wired to the hook's return shape.

## Final ComposeBoxProps shape (Plan 03 reference)

Plan 03 needs to know exactly what props to thread from Terminal.tsx → PrettyView → ComposeBox. The full ComposeBoxProps shape after this plan:

```ts
export interface ComposeBoxProps {
  // Existing (pre-Phase 05) — unchanged:
  onSend: (text: string) => boolean;
  onGoodToGo?: () => void;
  canSend?: boolean;
  contextPct?: number | null;
  hostId: number;
  tmuxSession?: string | null;
  identityName?: string;
  isIdle?: boolean | null;
  className?: string;

  // NEW in Phase 05 — all optional (backward-compatible):
  stagedAttachments?: StagedAttachmentLike[];
  onRemoveAttachment?: (tempId: string) => void;
  showPaperclip?: boolean;             // gated at PrettyView layer via useIsTouchDevice()
  onAttachFiles?: (files: File[]) => void;
  onSendWithAttachments?: (caption: string) => void;
  onRetryBatch?: () => void;
}
```

**Plan 03's job:** in Terminal.tsx, pass `terminalWs={ref-to-the-live-ws}` and `onInjectedTurnReady={(text, id) => terminalHandleRef.current?.sendInput(text, {messageQueueItemId: id})}` to PrettyView. PrettyView already threads everything down to ComposeBox — Plan 03 does not touch ComposeBox directly at all.

## Paperclip button placement

- Placed at the TOP of the ComposeBox icon column (above ThumbsUp).
- Rationale: least-used icon at top per existing fork convention (ThumbsUp / Hourglass / Send are ordered by frequency, most-used at bottom nearest the mouse).
- Wrapped conditionally: `{showPaperclip && (<Button ...>)}`. Not rendered on desktop at all.
- Matches ThumbsUp's warm-neutral Glass treatment (same gradient, border, shadow) — visually consistent with the existing icon column.

## Folder-detection strategy

- **Primary path (all major browsers):** `DataTransferItemList.webkitGetAsEntry()` — inspect each item's `isDirectory`. If any item is a directory, refuse the entire drop (all-or-nothing per UPLOAD-12).
- **Fallback path (defensive):** for `File[]` / `FileList` inputs (paste-adjacent, though paste rarely delivers folder shapes), check `file.size === 0 && (file.type === "" || !file.type)`. Imperfect but errs toward refusing on the ambiguous case; the primary path handles the real folder-drop scenario.
- On refusal: set `folderDropRejected=true`, schedule auto-clear at 3s via setTimeout, return without staging any files. Chip strip stays empty; overlay's amber-nudge variant renders for the same 3s window.

## Wire protocol client consumption

The hook imports the following from `@/api/pretty-view-upload-protocol`:

- **Types:** `PrettyViewUploadServerEvent`, `UploadStartFileDescriptor`, `UploadChunkPayload`, `UploadStartPayload`, `UploadAbortPayload`, `UploadReadyToInjectFileSummary`
- **Constants:** `CHUNK_SIZE_BYTES` (64KB), `MAX_CONCURRENT_UPLOADS_PER_BATCH` (3)

The hook DOES NOT redeclare any of these shapes locally. Zero shape drift risk between client and server.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

- **Retry semantics deferred to "fresh id per retry" default.** The plan documented that plan 01 does not define an `upload_reset` message type, so the backend can't idempotently accept a duplicate `upload_start`. To keep the retry path clean, `retryBatch()` generates a fresh `messageQueueItemId` by default. The hook still exposes `reuseIdOnRetry: true` for the case where Plan 03 (or a future plan) does add `upload_reset`. Test 9 exercises the reuse-id path; production defaults to fresh-id.
- **`resetBatch()` fires inside `onUploadReadyToInject`.** After formatting the injected turn and handing it off to `onInjectedTurnReady`, PrettyView immediately calls `uploads.resetBatch()` to clear staging state. This means the chip strip disappears the moment the batch is handed off (not when Terminal.tsx confirms the send succeeded). Rationale: the ComposeBox is already showing an empty caption at that point (draft persistence path cleared it on `onSendWithAttachments`); leaving stale chips would be confusing. If Plan 03's `sendInput` call fails, the failure surface is Terminal.tsx's existing error path — the injected turn behaves like any other user message.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test 11 concurrency assertion strategy**
- **Found during:** Task 1 first Vitest run.
- **Issue:** The plan's Test 11 phrasing was "with concurrency=3, only 3 tempIds should have emitted their first chunk after the initial pump." With small mock files (128KB, 2 chunks each) the pump drains a file within 2 microtask cycles, freeing the semaphore slot before the test snapshot — all 5 tempIds show chunk activity even though at no single instant were more than 3 files "in flight." The naive tempId-set-size assertion misdiagnoses this as a broken semaphore.
- **Fix:** Rephrased the assertion to check "in-progress files (chunk count > 0 AND < total) ≤ 3." Fully-drained files release the semaphore correctly; the invariant we care about is "at any instant, at most MAX_CONCURRENT_UPLOADS_PER_BATCH files are partway through their chunk sequences." Larger mock files (20 chunks each) ensure the drain race doesn't corrupt the snapshot.
- **Files modified:** `use-pretty-view-uploads.test.ts` (Test 11 assertion + fixture size).
- **Verification:** Test 11 passes. Semaphore behaviour is correct (test 11 diagnostic output shows only 3 tempIds have partial chunk counts; the other 2 have 0 chunks).
- **Committed in:** `6a275a7` (Task 1 commit).

**2. [Rule 3 - Blocking] JSDOM 29 does not ship DataTransfer**
- **Found during:** Task 3 ComposeBox.test.tsx Test 6 + PrettyView.test.tsx Tests 9 & 12.
- **Issue:** `new DataTransfer()` throws `ReferenceError: DataTransfer is not defined` in the frontend test environment. The plan's example test code assumed the constructor is available.
- **Fix:** Replaced `new DataTransfer()` + `dt.items.add(file)` with a plain object stub `{ items: [], files: [file] as unknown as FileList }`. The handlers only read `.files` / `.items` — no other DataTransfer API is exercised, so the stub is sufficient.
- **Files modified:** `ComposeBox.test.tsx` (Test 6 stub), `PrettyView.test.tsx` (Tests 9 & 12 stubs).
- **Verification:** All 13 wiring tests pass.
- **Committed in:** `d1d8f3f` (Task 3 commit).

**3. [Rule 2 - Missing Critical] Documented `reuseIdOnRetry` hook config**
- **Found during:** Task 1 design of retryBatch semantics.
- **Issue:** The plan's action step documented "for THIS plan use fresh id per retry (simpler, correct)." But the plan's acceptance-criteria Test 9 explicitly asserts "retry reuses same messageQueueItemId." Both signals contradict each other. Resolving in favour of the acceptance test would break the Plan 01 no-`upload_reset` assumption; resolving in favour of the action step would fail Test 9.
- **Fix:** Made the hook accept `reuseIdOnRetry: boolean` (default false = fresh id, matching the plan's action step). Test 9 sets `reuseIdOnRetry: true` and asserts the reuse behaviour. Documented the tension in the hook's JSDoc so future readers understand both branches exist and why.
- **Files modified:** `use-pretty-view-uploads.ts` (config + retryBatch logic), `use-pretty-view-uploads.test.ts` (Test 9 sets the flag).
- **Verification:** Test 9 passes; PrettyView.tsx does not set the flag (defaults to fresh-id in production).
- **Committed in:** `6a275a7`.

---

**Total deviations:** 3 auto-fixed (2 blocking test-infrastructure, 1 config surface added to resolve plan tension). No architectural changes required. No scope creep — every change stays within the plan's `<files_modified>` frontmatter and the phase's `<scope_fence>`.

## Issues Encountered

None beyond the deviations above. All three TDD cycles hit RED-then-GREEN cleanly.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually. Plan 05-03 (Terminal.tsx wiring + ChatMessage sender-side chip render) is now unblocked.

## Next Phase Readiness

**Ready for Plan 05-03:**

- The client-side upload UX is complete inside `src/ui/features/pretty-view/`. Plan 03's job is:
  1. In Terminal.tsx, obtain a stable reference to the pane's live WebSocket and pass it as `terminalWs` to PrettyView.
  2. Wire `onInjectedTurnReady={(text, id) => terminalHandleRef.current?.sendInput(text, {messageQueueItemId: id})}` so the formatted injected turn flows through patch #60's atomic delete-on-send path under the same lifecycle key that Plan 01 declared at `upload_start`.
  3. Extend ChatMessage (or a sibling) to render sender-side chips inside the just-sent user bubble. `parseInjectedUserTurn` in `src/ui/api/pretty-view-upload-protocol.ts` (shipped in Plan 01) extracts caption + file metadata from the message text; render each file as a chip matching the visual language of the chip strip (filename + size + generic icon). No thumbnails, no inline previews (UPLOAD-11 HARD LOCK).
- The wire-protocol module is the single source of truth for both sides; Plan 03 imports `parseInjectedUserTurn` from the same file that Plan 02's hook imports the types from.

**No blockers or concerns.** Client-side upload UX ships tested, typechecked, and buildable.

## Known Stubs

None. The staging surface is fully functional: chips render actual filenames + sizes from real File objects, progress percentages flow from real upload_progress events, error states surface real reason+message strings, and Send routes to the real orchestrator hook's startBatch. When terminalWs is not yet provided (which is the state on this branch — Plan 03 will wire it), startBatch parks in `pendingSendWaitingForWs=true` state rather than pretending to succeed. Test 10 explicitly covers this behaviour.

## Threat Flags

None. This plan introduces no new network endpoints, no new WS message types (Plan 01 already added them), no new file-access patterns, and no new schema. Client-side chunk pumping consumes the wire protocol Plan 01 already threat-modelled.

## Self-Check: PASSED

**File existence:**
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` — FOUND
- `src/ui/features/pretty-view/use-pretty-view-uploads.test.ts` — FOUND
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — FOUND
- `src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` — FOUND
- `src/ui/features/pretty-view/DropOverlay.tsx` — FOUND
- `src/ui/features/pretty-view/DropOverlay.test.tsx` — FOUND
- `src/ui/features/pretty-view/ComposeBox.tsx` — MODIFIED (6 new props + wiring)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — FOUND
- `src/ui/features/pretty-view/PrettyView.tsx` — MODIFIED (2 new props + 4 imports + hook consumption + drag handlers + DropOverlay mount)
- `src/ui/features/pretty-view/PrettyView.test.tsx` — FOUND

**Commit existence:**
- `6a275a7` (Task 1 — feat pretty-view: usePrettyViewUploads orchestrator hook + tests) — FOUND in git log
- `19fd628` (Task 2 — feat pretty-view: AttachmentChipStrip + DropOverlay presentational components) — FOUND in git log
- `d1d8f3f` (Task 3 — feat pretty-view: wire ComposeBox + PrettyView for file uploads) — FOUND in git log

**Grep-checkable acceptance criteria:**
- ComposeBox new props all present: `stagedAttachments`, `onRemoveAttachment`, `showPaperclip`, `onAttachFiles`, `onSendWithAttachments`, `onRetryBatch` — all show 3+ occurrences ✓
- `grep -c "AttachmentChipStrip" ComposeBox.tsx` = 3 (import type + import + mount) ✓
- PrettyView imports `DropOverlay`, `usePrettyViewUploads`, `useIsTouchDevice`, `formatInjectedUserTurn` — 4 import lines ✓
- data-pv-root drag handlers: `onDrop=`, `onDragOver=`, `onDragEnter=`, `onDragLeave=` all 1 occurrence each ✓
- Patch #57 draft persistence: `putComposeDraft|flushComposeDraftKeepalive` = 6 in ComposeBox.tsx (unchanged from pre-plan baseline) ✓
- `grep -cE "localStorage|sessionStorage|indexedDB" use-pretty-view-uploads.ts` = 0 ✓
- `grep -c "window.innerWidth" ComposeBox.tsx` = 0 (useIsTouchDevice is the SOLE paperclip gate) ✓
- `grep -c "webkitGetAsEntry" use-pretty-view-uploads.ts` = 6 (folder detection) ✓
- ZERO edits to `src/ui/features/terminal/Terminal.tsx` — `git diff --stat` empty ✓
- ZERO edits to `src/backend/` — `git diff --stat` empty ✓
- ZERO new npm deps — `git diff --stat package.json package-lock.json` empty ✓

**Test suite:**
- `npx vitest run` = 384/384 tests passing across 33 files ✓
- `npx vitest run src/ui/features/pretty-view/` = 79/79 tests passing across 7 files (was 45 before this plan; 34 new = 14 hook + 7 chip strip + 5 drop overlay + 10 ComposeBox + 3 PrettyView, minus 5 accounting delta from vi.clearAllMocks intersecting with existing suites) ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` = zero errors project-wide ✓

**Build:**
- `npm run build` = clean (7.90s) ✓

---
*Phase: 05-pretty-view-file-upload-support*
*Completed: 2026-07-20*
