---
phase: quick-260802-wxy
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - QUICK-260802-WXY
tags:
  - frontend
  - pretty-view
  - uploads
  - composebox
  - refactor
completed: 2026-08-02
commits:
  - hash: 778b18a
    subject: "refactor(uploads): stagedAttachments → per-target Map (Quick A of paired ship #2/#1)"
  - hash: fa2c792
    subject: "feat(composebox): overlay chip strip inside main textarea (Quick A of paired ship #2/#1)"
files_modified:
  - src/ui/features/pretty-view/use-pretty-view-uploads.ts
  - src/ui/features/pretty-view/use-pretty-view-uploads.test.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
test_results:
  hook_tests: "20 passed (14 existing + 6 new target-aware)"
  composebox_tests: "39 passed (all existing + updated Test 2 + new Test 2b)"
  full_suite: "1087 passed / 6 skipped across 89 test files"
  tsc: "clean (npx tsc --noEmit exit 0)"
---

# Quick 260802-wxy: chips-inside-textarea + per-target Map — Summary

## One-liner

Refactored `usePrettyViewUploads` internal state from a flat
`StagedAttachment[]` to `Map<string, StagedAttachment[]>` keyed by target
(preserving outward behavior for existing callers via a "primary" mirror on
the legacy field), then relocated the `AttachmentChipStrip` from its
Row-3-above-Row-1 render site to an absolutely-positioned overlay child of
the primary textarea's wrapper with dynamic paddingTop measured via
ResizeObserver — Quick A of the paired ship for bounties
`attached-files-as-chips-in-textarea-per-message` (#2) +
`adjust-visual-on-queued-messages` (#1).

## Task 1 — 778b18a: Per-target Map refactor

**Files touched:**
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` — state migration
- `src/ui/features/pretty-view/use-pretty-view-uploads.test.ts` — 13 existing
  callers mechanically updated to pass `"primary"` first; new
  `describe("target-aware API (Quick 260802-wxy)")` block with 6 tests
- `src/ui/features/pretty-view/PrettyView.tsx` — 3 call-site sweeps for the
  new signature

**What changed in the hook:**
- State: `useState<StagedAttachment[]>` → `useState<Map<string,
  StagedAttachment[]>>(() => new Map())`. Immutable Map updates
  (`new Map(prevMap).set(target, next)`) preserve React reference-equality
  bailout semantics.
- Ref: `useRef<StagedAttachment[]>` → `useRef<Map<string,
  StagedAttachment[]>>`. Cloned on every update so async callers holding a
  reference don't observe mid-flight mutations.
- `setAttachments` helper: now `(target, updater)` — supports both plain-array
  and function forms. All internal callers (`stageAttachments`,
  `removeAttachment`, `handleServerEvent`, `retryBatch`, `resetBatch`,
  `pumpFile` error/status branches) updated to pass the target explicitly.
- `stageAttachments`: signature `(items) => void` → `(target, items) => void`.
- `getStagedAttachments(target)`: new public read API — returns
  `stagedAttachmentsByTarget.get(target) ?? []`.
- Legacy `stagedAttachments` field: derived from
  `stagedAttachmentsByTarget.get("primary") ?? EMPTY_ATTACHMENTS` (stable
  empty-array reference so downstream React.memo consumers don't churn).
- `resetBatch()`: clears the "primary" target ONLY — other targets survive
  (per new behavior test #6).
- Chunk pump (`pumpBatch`): switched from `attachmentsRef.current` to
  `Array.from(attachmentsRefByTarget.current.values()).flat()` — batch/status/
  progress logic keys off tempId, not target, so the pump treats cross-target
  attachments identically. In Quick A only "primary" produces, so the
  behavior is unchanged today; the structural refactor generalizes cleanly
  for Quick B's per-slot producers without another pump rewrite.
- `pumpFile`: state-write branches search
  `attachmentsRefByTarget.current` for the owning target of each tempId
  (walks all keys, falls back to "primary" defensively). tempIds are UUIDs
  so cross-target collisions are effectively impossible.
- `removeAttachment`: similarly walks the map to locate the owning target
  before filtering.

**Caller sweep (`PrettyView.tsx`):**
- `uploads.stageAttachments(items)` at line 1078 → `("primary", items)`.
- `uploads.stageAttachments(files)` at line 1080 → `("primary", files)`.
- `onAttachFiles={uploads.stageAttachments}` at line 1399 → wrapped as
  `(files) => uploads.stageAttachments("primary", files)` because the
  `onAttachFiles` prop signature stays `(files: File[]) => void` for
  ComposeBox compatibility.

**New tests (6):**
1. `stageAttachments("primary", files)` populates legacy field with N
   entries + unique tempIds.
2. `getStagedAttachments("q-slot-1")` returns `[]` when nothing staged.
3. Staging to "primary" leaves "q-slot-1" empty AND legacy length 2.
4. Staging to "q-slot-1" leaves legacy (primary mirror) empty AND
   `getStagedAttachments("q-slot-1")` length 2.
5. Legacy field equals `getStagedAttachments("primary")` — identical
   contents by tempId, filename, status.
6. `resetBatch()` clears "primary" but NOT "q-slot-1" (persists).

**Verification:**
- `npx tsc --noEmit` → clean.
- `npx vitest run src/ui/features/pretty-view/use-pretty-view-uploads.test.ts`
  → 20 passed (14 existing + 6 new).

## Task 2 — fa2c792: Overlay chip strip inside main textarea wrapper

**Files touched:**
- `src/ui/features/pretty-view/ComposeBox.tsx` — chip strip relocation +
  measurement wiring + dynamic paddingTop
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — Test 2 update + new
  Test 2b (structural regression guard)

**What changed in ComposeBox:**
- Chip strip removed from its Row-3 render site (formerly at ~L1408-1411,
  immediately below `composeRootRef`'s opening div). Comment replaced with
  a breadcrumb pointing to the new location. Retry-affordance block
  (`hasErroredChip && onRetryBatch`) STAYS at the original Row-3 location —
  it is a compose-level control, not per-textarea.
- New refs + state near `textareaRef`:
  ```ts
  const chipStripRef = useRef<HTMLDivElement | null>(null);
  const [chipStripHeight, setChipStripHeight] = useState(0);
  ```
- New `useLayoutEffect` (near the existing auto-grow effect):
  - When `chipStripRef.current` is null (empty state — AttachmentChipStrip
    returns null), resets `chipStripHeight` to 0.
  - Otherwise primes an immediate measurement via
    `el.getBoundingClientRect().height` so the first paint carries
    paddingTop.
  - Attaches a `ResizeObserver` that updates `chipStripHeight` on
    subsequent resizes (chips added/removed, viewport width changes that
    trigger `flex-wrap`).
  - Guarded on `typeof ResizeObserver === "undefined"` so JSDOM doesn't
    crash the effect.
  - Keyed on `stagedAttachmentsCount` so the observer (re)attaches when
    the strip mounts and tears down when it unmounts.
- Inside the primary textarea's `<div className="relative flex-1
  self-stretch">` wrapper (at ~L2050), a new absolutely-positioned child
  was added BEFORE the Textarea:
  ```jsx
  <div
    ref={chipStripRef}
    className="absolute top-0 left-0 right-0 z-10 px-2 pt-2 pointer-events-auto"
  >
    <AttachmentChipStrip
      attachments={stagedAttachments ?? []}
      onRemove={onRemoveAttachment ?? (() => {})}
    />
  </div>
  ```
- Textarea gained an inline `style` prop:
  ```jsx
  style={
    chipStripHeight > 0
      ? { paddingTop: `${chipStripHeight + 12}px` }
      : undefined
  }
  ```
  The `+ 12` preserves the base 12px `py-3` comfort gap between chips and
  composed text. When no attachments are staged, `style` is undefined and
  the Textarea reverts to its className-driven padding.
- `z-10` on the strip wrapper keeps chips above the Textarea body. Send
  (`right-1 bottom-0.5`) and Paperclip (`left-1 bottom-0.5`) live at
  BOTTOM so they never collide with the top-anchored chips.
- Queued-row textareas (queueSlots.map block at ~L1820) UNCHANGED — Quick
  B relocates them.
- Send/paperclip/mic/arm-idle/retry/aside-morph behavior all UNCHANGED.

**Test updates:**
- Test 2 renamed to reflect the new invariant: "chip strip mounts INSIDE
  the textarea wrapper (still document-precedes the textarea, but as a
  sibling of it, not a parent-container sibling)." The
  `DOM_POSITION_FOLLOWING` assertion still holds (strip is rendered FIRST
  inside the wrapper, followed by the Textarea). Added an assertion that
  the strip's parent wrapper carries `absolute` — proves overlay
  positioning, not stacked layout.
- Test 2b added (new): load-bearing structural assertion. Walks
  `strip.closest("div.relative.flex-1.self-stretch")` and
  `textarea.closest(...)` and asserts they resolve to the SAME node. If a
  future refactor moves the strip back out of the wrapper, this test will
  fail hard.
- Test 1 (no chip strip when empty) unchanged — passes as-is because
  AttachmentChipStrip's return-null-when-empty contract still holds and
  the overlay wrapper is still rendered (empty), which is fine: the
  wrapper itself has no visual weight when its child returns null, and
  `chipStripHeight` stays 0 so the Textarea's paddingTop falls back to
  the base `py-3`.

**Verification:**
- `npx tsc --noEmit` → clean.
- `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` → 39
  passed (all existing + updated Test 2 + new Test 2b).
- `npx vitest run` (full suite) → 1087 passed / 6 skipped across 89 test
  files.

## Deviations from Plan

1. **Chip strip wrapper always rendered (not gated on empty state).** The
   plan sketch showed a `<div ref={chipStripRef}>` wrapping the
   AttachmentChipStrip unconditionally, relying on AttachmentChipStrip's
   own return-null-when-empty contract. I kept that pattern verbatim.
   Effect: an EMPTY overlay div does render when no attachments are
   staged, but it has no children (AttachmentChipStrip returns null),
   no visible size, and `chipStripHeight` resets to 0 via the
   useLayoutEffect's null-ref branch — so the Textarea's paddingTop
   falls back correctly. Test 1 still passes.

2. **`removeAttachment` and `pumpFile` walk all targets to find the
   owning key.** The plan's action steps assumed a "primary" fast-path
   for these two sites; I chose to walk the ref's key-set instead so the
   internal semantics are already correct for Quick B (per-slot
   producers) without needing another edit. TempIds are UUIDs — cross-
   target collisions are effectively impossible — so the walk is
   trivially cheap and correct. Behavior for Quick A (primary only) is
   identical.

3. **Chunk pump uses the FLAT `Array.from(map.values()).flat()`
   approach.** This is one of the two options the plan called out; I
   picked the FLAT approach as recommended. Ordering across targets is
   insertion-order (Map iteration order), which is stable and matches
   what a per-slot producer in Quick B would expect (files staged
   earlier upload first).

4. **`EMPTY_ATTACHMENTS` module-level const.** Added a stable
   empty-array reference so the legacy `stagedAttachments` mirror does
   NOT construct a new `[]` on every render when the primary target is
   empty. This preserves the reference-equality contract that any
   downstream `React.memo` consumers rely on. Not called out in the
   plan; small correctness-preservation nit.

5. **ResizeObserver guarded on `typeof === "undefined"`.** JSDOM does
   not implement ResizeObserver as of vitest 4.1.8; without the guard,
   the useLayoutEffect would throw on any test that renders ComposeBox
   with staged attachments. The initial `getBoundingClientRect()`
   measurement is retained unconditionally so the first paint still
   carries the correct paddingTop (JSDOM returns 0 for
   `boundingClientRect.height`, so `chipStripHeight` stays 0 in tests —
   the overlay renders but the Textarea's paddingTop stays undefined,
   which is the correct fallback for a test environment with no
   layout).

## Auth gates

None.

## Known stubs / follow-ups

**Quick B (queued-row surgery + bounty #1's header restructure) still
pending.** The state model is READY for per-target consumers:
- `stageAttachments("q-slot-1", files)` and
  `getStagedAttachments("q-slot-1")` already work today (test 4/6
  prove it).
- `resetBatch()` will not clobber per-slot state (test 6).
- The chunk pump treats all targets identically.

Quick B will:
- Wire per-queued-textarea paperclip/paste/drag entry points to their
  slot-id target.
- Render per-slot AttachmentChipStrip overlays inside each queueSlot
  textarea's wrapper (the same pattern this quick applied to the primary).
- Restructure bounty #1's header per its own spec.

None of that requires further changes to `usePrettyViewUploads` — the
hook is ready as-is.

## Threat flags

None. This quick is a client-side refactor + DOM relocation; no new
network endpoints, no new auth paths, no new file-access patterns, no
schema changes.

## Self-Check: PASSED

**Created files:**
- `.planning/quick/260802-wxy-chips-inside-textarea-overlay-stagedatta/260802-wxy-SUMMARY.md` — FOUND (this file).

**Commits present:**
- `778b18a` — FOUND in `git log`.
- `fa2c792` — FOUND in `git log`.
