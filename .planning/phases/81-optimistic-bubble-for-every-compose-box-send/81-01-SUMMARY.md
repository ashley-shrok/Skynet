---
phase: 81-optimistic-bubble-for-every-compose-box-send
plan: 01
subsystem: pretty-view / optimistic bubbles / attachment render
tags: [type-widening, chatmessage, pending-bubble, attachments, no-behavior-change]
requires:
  - Phase 50 optimistic-bubble machinery (PendingSend + handleOptimisticSend + FIFO head-match)
  - Phase 68 useComposeSend funnel primitive
  - Phase 76 whole-bubble-red-on-failed visual (D-06)
  - Phase 05 AttachmentChipStrip readOnly render mode
provides:
  - PendingSend type carries optional attachments field
  - handleOptimisticSend accepts + threads optional attachments
  - onOptimisticSend callback contract widened with optional attachments
  - ChatMessage new pending-with-attachments render branch (D-15)
  - 9 unit tests locking new branch shape/ordering/red-inheritance/XSS-escape
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (PendingSend type + handleOptimisticSend widening + diag log marker)
  - src/ui/features/pretty-view/ComposeBox.tsx (onOptimisticSend prop-type widening only — no behavior change)
  - src/ui/features/pretty-view/ChatMessage.tsx (new attachments prop + new render branch)
  - src/ui/features/pretty-view/ChatMessage.test.tsx (9 new unit tests in new describe block)
tech-stack:
  added: []
  patterns:
    - Optional-field type widening with conditional spread (`...(attachments && attachments.length > 0 ? { attachments } : {})`)
    - Duplicate-inline render branch (RESEARCH.md § Share vs Duplicate — 8 lines of JSX, different data sources)
    - Synthetic React key for short-lived pending records (`pending-${filename}-${size}`)
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/ChatMessage.test.tsx
decisions:
  - "Duplicate the pending-with-attachments render branch inline in ChatMessage rather than extracting a shared helper with the settled `injected` branch — different caption source (raw content vs parsed injected.caption), different tempId source (synthetic vs landingPath), different upstream file-shape (PendingSend triple vs ParsedInjectedTurn); 8 lines of JSX total (RESEARCH.md § Share vs Duplicate)"
  - "Conditional-spread the attachments field on the pending record (`...(attachments && attachments.length > 0 ? { attachments } : {})`) so text-only records match the pre-Phase-80 shape byte-for-byte and no consumer needs a null-check dance for the common text-only path"
  - "Extend the existing [diag-dormant-send] arm log line with `attachmentCount=` marker rather than a separate log line — one-line change, post-ship grep can distinguish attachment seeds from text-only in a single log correlation (RESEARCH.md § Open Questions #1)"
  - "Test H uses substring-tolerant assertion (`bg.includes(\"hsla(0, 60%\") || bg.includes(\"hsl(0, 60%\") || bg.includes(\"143, 36, 36\")`) to tolerate jsdom's hsla→rgba normalization — matches the pattern the existing Test 4b uses at ChatMessage.test.tsx:419"
metrics:
  duration_min: 15
  completed: 2026-09-07
---

# Phase 81 Plan 01: Type contracts + ChatMessage render branch Summary

Widened three type surfaces (PendingSend, handleOptimisticSend, onOptimisticSend) to carry optional attachment metadata, and added the new pending-with-attachments render branch to ChatMessage with 9 unit tests locking its shape. Zero runtime behavior change — the new render path only fires when Plan 02 wires the seed call inside PrettyView's `onUploadReadyToInject` closure.

## Files Modified

### `src/ui/features/pretty-view/PrettyView.tsx` (3 edits within L1118–L1265)

1. **`PendingSend` type declaration** (was L1118–L1124, now L1118–L1134): appended optional `attachments?: Array<{filename: string; size: number; mimetype: string}>` field after the `timer` field, per D-14. Doc-comment references Phase 81 D-14 + Plan 02 wiring source.

2. **`handleOptimisticSend` signature + spread sites** (was L1182–L1258, now L1191–L1275):
   - Args typing gains optional `attachments?: Array<{...}>` (same triple shape).
   - Destructure includes `attachments` alongside `payload, mqid, immediateFailure`.
   - **Immediate-failure fallback record spread** conditionally includes `attachments` when present + non-empty (spread pattern: `...(attachments && attachments.length > 0 ? { attachments } : {})`). Not exercised in this phase per D-12 (attachment seeds gated behind upload success) but kept consistent so consumers never special-case.
   - **Primary seed record spread** identically conditional-spreads `attachments`.
   - Added comment referencing the invariant Plan 02 depends on: `// Phase 81 D-14/D-16: attachments carried on the pending record so ChatMessage renders caption+chip-strip via the new render branch (mqid === batchId === messageQueueItemId — RESEARCH.md Pitfall #2).`

3. **`[diag-dormant-send] arm` log line** (was L1240, now L1257): appended `attachmentCount=${attachments?.length ?? 0}` as an additional space-separated key=value pair. Post-ship grep can now answer "did an attachment bubble seed for this batchId?" from a single log line per RESEARCH.md § Open Questions #1.

### `src/ui/features/pretty-view/ComposeBox.tsx` (1 edit at L181–L206)

- **`onOptimisticSend` prop-type** widened per D-16 with optional `attachments?: Array<{filename: string; size: number; mimetype: string}>` field. Preserved the surrounding Phase 50 D-01/D-03/D-20 doc block verbatim; appended a Phase 81 D-16 block explaining why the widening is here even though the seed for attachment sends does not fire from ComposeBox (per RESEARCH.md § Option B).
- **Two existing funnel callsites at L471/L487 UNCHANGED** — they still call `onOptimisticSend?.({ payload, mqid, immediateFailure })` without the optional attachments field. Backward-compat verified — 86 tests across `PrettyView.optimistic-bubbles.test.tsx` + `ComposeBox.test.tsx` stay green.

### `src/ui/features/pretty-view/ChatMessage.tsx` (2 edits)

1. **Props declaration widened** (was L52–L87, now L52–L107): added optional `attachments?: Array<{filename: string; size: number; mimetype: string}>` to the destructure + type object, with a Phase 81 D-15 doc block explaining when the branch fires and what data flows through.

2. **New render branch** (inserted after L479–L509 `injected ?` branch, before the ReactMarkdown fallback; now sits at L525–L572): fires when `attachments && attachments.length > 0` AND the existing `injected` branch condition is false. Renders `<div className="pv-injected-caption whitespace-pre-wrap mb-2">{content}</div>` above `<AttachmentChipStrip readOnly={true} onRemove={() => {}} attachments={...}/>`. Chip strip receives synthesized `tempId: pending-${f.filename}-${f.size}`, file shape `{name: f.filename, size: f.size, type: f.mimetype}`, `status: "complete"`, `bytesUploaded: f.size`, `error: null`. Empty-content case (D-06) gates the caption div behind `content.length > 0`. Comment above the branch cites Phase 81 D-15 + Pattern 3 rationale + duplicate-inline decision.

### `src/ui/features/pretty-view/ChatMessage.test.tsx` (1 new describe block appended)

New `describe("ChatMessage pending-with-attachments (Phase 81)", ...)` with 9 tests (A–I):

| Test | Verifies |
|------|----------|
| A | renders caption above chip strip when both present |
| B | renders chip strip only when content is empty string (D-06) |
| C | chip strip carries `data-readonly="true"` attribute (Pitfall #6) |
| D | branch does NOT fire when `attachments` prop is undefined — existing markdown render fires |
| E | branch does NOT fire when `attachments` prop is empty array |
| F | settled `injected` branch fires FIRST when content is a valid injected-turn body — verifies ordering (settled wins over pending) |
| G | caption containing literal `---attached files---` (without valid file lines) renders as pending-with-attachments — Pitfall #4 defense |
| H | when `pendingState === "failed"`, outer bubble div carries whole-bubble-red inline style — Phase 76 D-06 inheritance |
| I | filename with `<script>` metacharacters is text-escaped — no live `<script>` element in DOM (T-81-01 mitigation) |

**Test H tolerance:** substring-tolerant assertion covers both hsla source form and jsdom's rgba-normalized form (matches existing Test 4b pattern at line 419).

## Test Additions

**New tests:** 9 (Tests A–I in new describe block `ChatMessage pending-with-attachments (Phase 81)` — ChatMessage.test.tsx L487–L689).

**Note on test-ID collision:** the existing quick-260730-ujq describe block already uses `Test G/H/I` for the copy-block tests. My 9 new tests reuse A–I inside the new describe block. `grep -c '^  it("Test [A-I]:' ChatMessage.test.tsx` returns 12 total (3 existing + 9 new) — not exactly 9. All 9 new tests exist, pass, and cover their acceptance criteria.

**All green:**
- `ChatMessage.test.tsx`: 35 tests pass (26 pre-existing + 9 new).
- `ChatMessage.autoplay.test.tsx` + `ChatMessage.speak.test.tsx` + `ChatMessage.editable-file.test.tsx` + `ChatMessage.instrumentation.test.tsx` + `PrettyView.optimistic-bubbles.test.tsx`: 57 tests total, all pass.
- `PrettyView.optimistic-bubbles.test.tsx` + `ComposeBox.test.tsx` (from Task 1 verification): 86 tests, all pass.

## No Behavior Change

Zero runtime behavior changed by this plan. The new pending-with-attachments render branch **never fires today** — its trigger condition (`attachments && attachments.length > 0` on a `ChatMessage`) is only true when the pending record carries attachments, and no code path currently populates that field. Plan 02 lights up the new branch by wiring the seed call in PrettyView's `onUploadReadyToInject` closure (per RESEARCH.md § Option B), passing `event.files` through `handleOptimisticSend({..., attachments: event.files.map(...)})`.

Verifying this claim:
- All 86 tests in `PrettyView.optimistic-bubbles.test.tsx` + `ComposeBox.test.tsx` stay green with the type widening only (Task 1 commit `f5829339`).
- All 35 tests in `ChatMessage.test.tsx` stay green after adding the new branch + tests (Task 2 commit `3937242a`) — 26 pre-existing + 9 new = 35, no regression.
- `git diff --name-only` for `use-pretty-view-uploads.ts` returns empty (hook untouched per RESEARCH.md § Option B).
- `git diff --name-only` for `AttachmentChipStrip.tsx` returns empty (component reused verbatim per Pitfall #6).

## Deviations from Plan

**None** — plan executed exactly as written.

Minor observation on acceptance-criterion literalism:
- Plan asserted `grep -c '^  it("Test [A-I]:' src/ui/features/pretty-view/ChatMessage.test.tsx returns exactly 9`. Actual count is 12 because the pre-existing quick-260730-ujq describe already uses `Test G/H/I` for copy-block tests. All 9 new Phase 81 tests exist inside the new `describe("ChatMessage pending-with-attachments (Phase 81)", ...)` block and pass. No mitigation needed — the intent of the acceptance criterion (9 new tests exist and pass) is satisfied.

## Pitfalls Encountered

- **Pitfall #4 (parseInjectedUserTurn on caption-only content):** Test G explicitly locks this defense — a caption containing the literal delimiter substring `---attached files---` without well-formed file lines still renders as pending-with-attachments (parseInjectedUserTurn returns null for non-well-formed input at protocol.ts:322-336). No code change needed; verified by Test G.
- **Pitfall #6 (AttachmentChipStrip requires truthy readOnly marker):** New branch always passes `readOnly={true}` verbatim. Test C asserts `data-readonly="true"` attribute (AttachmentChipStrip.tsx:107) on every chip in the pending render.

## Threat Flags

None — the plan's `<threat_model>` covers all render surfaces introduced. Test I locks T-81-01 (XSS-escape of filename `<script>` metacharacters via React default text-node escaping). Test A + G lock T-81-02 (caption XSS-escape via same React text-node treatment inside `<div className="pv-injected-caption">`). T-81-03 (spoofing) and T-81-04 (DoS) are `accept` disposition — no code surface introduced.

## Commits

- `f5829339` — Task 1: widen PendingSend + handleOptimisticSend + onOptimisticSend for attachments
- `3937242a` — Task 2: ChatMessage pending-with-attachments render branch + 9 unit tests

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` — MODIFIED (verified `git diff --stat` non-empty; grep finds 2 `attachments?: Array<{` matches + 1 `attachmentCount=` marker)
- `src/ui/features/pretty-view/ComposeBox.tsx` — MODIFIED (grep finds 1 `attachments?: Array<{` match)
- `src/ui/features/pretty-view/ChatMessage.tsx` — MODIFIED (grep finds 1 `attachments?: Array<{` match + 2 `Phase 81 D-15` matches)
- `src/ui/features/pretty-view/ChatMessage.test.tsx` — MODIFIED (grep finds 7 `pending-with-attachments` occurrences + 9 Phase-80 `Test A-I` entries in the new describe block)
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — UNCHANGED (`git diff --name-only` empty)
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` — UNCHANGED (`git diff --name-only` empty)
- Commit `f5829339` — FOUND in `git log --oneline`
- Commit `3937242a` — FOUND in `git log --oneline`
- TypeScript compiles clean (`npx tsc -p tsconfig.json --noEmit` exits 0 after both tasks)
- Test suites green: 86 (Task 1 verify) + 35 (ChatMessage.test after Task 2) + 57 (sibling regression check)
