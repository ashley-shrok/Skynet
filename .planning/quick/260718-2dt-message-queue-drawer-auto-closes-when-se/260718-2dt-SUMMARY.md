---
phase: 260718-2dt
plan: 01
subsystem: message-queue
tags: [ui, message-queue, drawer, ux]
requires: []
provides: [MQ-AUTO-CLOSE-ON-SEND]
affects: [src/ui/features/terminal/MessageQueueDrawer.tsx]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - src/ui/features/terminal/MessageQueueDrawer.tsx
decisions:
  - "Fire onClose from handleSend's success branch only — Trash / Retry-cleanup / connection-error paths deliberately keep the drawer open."
  - "Use functional-updater form (inline) rather than reading items from closure — avoids a race where a fast Add after Send sees stale local state."
  - "Add onClose to the useCallback deps array to keep react-hooks/exhaustive-deps quiet (warn-level but style-consistent with the rest of the file)."
  - "No Terminal.tsx change was needed: onClose is already a required prop wired at Terminal.tsx:2863 to setIsMessageQueueOpen(false). The planned design_locked note assumed we'd need to add both a prop and a wire-in — both already existed."
metrics:
  duration: ~90s
  tasks_completed: 1/1
  files_created: 0
  files_modified: 1
  completed_date: 2026-07-18
---

# Quick Task 260718-2dt: Message Queue Drawer Auto-Close on Send — Summary

Auto-close the per-pane message queue drawer when the Send button empties the queue. One three-line insert into `handleSend`, reusing the already-wired `onClose` prop.

## What Changed

Single-file change to `src/ui/features/terminal/MessageQueueDrawer.tsx`:

1. **`handleSend` success branch** (line 269-274): replaced the single-line functional updater `setItems((p) => p.filter((it) => it.id !== item.id))` with a form that captures the filtered array inside the updater and invokes `onClose?.()` when the result is empty. This fires exactly once, only when the send succeeded AND was the last item.

2. **`handleSend` useCallback deps** (line 292): added `onClose` to keep `react-hooks/exhaustive-deps` quiet.

### Exact Diff Hunk

```diff
diff --git a/src/ui/features/terminal/MessageQueueDrawer.tsx b/src/ui/features/terminal/MessageQueueDrawer.tsx
index 949d632..e49127a 100644
--- a/src/ui/features/terminal/MessageQueueDrawer.tsx
+++ b/src/ui/features/terminal/MessageQueueDrawer.tsx
@@ -267,7 +267,11 @@ export function MessageQueueDrawer({
       }
       try {
         await deleteMessageQueueItem(item.id);
-        setItems((p) => p.filter((it) => it.id !== item.id));
+        setItems((p) => {
+          const next = p.filter((it) => it.id !== item.id);
+          if (next.length === 0) onClose?.();
+          return next;
+        });
       } catch (e) {
         // WS send happened but server DELETE failed. Keep the row so it
         // doesn't come back as a ghost on reload; mark it sent-pending
@@ -285,7 +289,7 @@ export function MessageQueueDrawer({
         setSendingId(null);
       }
     },
-    [onSend, flushDirty],
+    [onSend, flushDirty, onClose],
   );
```

Net: 1 file, 6 insertions, 2 deletions.

## Why the design_locked Terminal.tsx Change Was Not Needed

The planning `<must_haves>` note assumed the plan might need to add a new `onClose` prop to `MessageQueueDrawerProps` AND wire it into `Terminal.tsx` at the drawer mount site. Discovery during planning + implementation confirmed:

- `MessageQueueDrawerProps.onClose` **already exists** at MessageQueueDrawer.tsx:19 as a **required** prop.
- `Terminal.tsx` **already wires** it at line 2863: `onClose={() => setIsMessageQueueOpen(false)}`.
- It's currently invoked from exactly one site — the drawer's explicit close (X) button at line 306.

All this plan does is add a second invocation site inside `handleSend`. Zero API surface change, zero Terminal.tsx change, zero prop-shape change. The `?.` optional-call guard on `onClose?.()` is belt-and-braces defensive against future prop-optionalization; harmless given the current `required` signature.

## Semantics Preserved

- **Send that empties the queue → drawer closes.** New behavior.
- **Send that leaves items behind → drawer stays open.** Unchanged (the `next.length === 0` gate is false).
- **Trash (delete) that empties the queue → drawer stays open.** Unchanged — `handleDelete` was not touched.
- **Retry-cleanup that empties the queue → drawer stays open.** Unchanged — `handleRetryCleanup` was not touched.
- **DELETE failure on the send path → row visible as sent-pending, drawer stays open.** Unchanged — the `catch` branch was not touched and doesn't call `setItems` at all (the item is kept locally, plus added to `sentPendingIds`).
- **Connection-error early-return (`if (!ok)`) → drawer stays open.** Unchanged.

## Build Outcome

`cd /home/ubuntu/termix && npm run build` → **PASS** (exit 0).

- `vite build` completed in 23.92s.
- `tsc -p tsconfig.node.json` clean.
- Backend `package.json` copy step succeeded.
- Only warnings emitted: pre-existing chunk-size advisories on `codemirror-*.js` and `file-preview-vendor-*.js` (unrelated to this change).

## Commit

- **Hash:** `5f209ff`
- **Message:** `feat(message-queue): auto-close drawer when send empties the queue`
- **Files:** `src/ui/features/terminal/MessageQueueDrawer.tsx`

## Deferred / Not Addressed

Per the plan objective and the design_locked note, the following corner case is **acknowledged and deliberately not fixed** in this pass:

- **Empty-body-draft residue after Send.** Patch #41 auto-primes an empty draft when the drawer opens on an empty-list. Sequence: open drawer on empty → auto-primed empty draft appears → user clicks Add → types real message → sends it → local remove leaves the auto-primed empty draft behind → `next.length === 1` (the empty draft) → drawer does NOT auto-close. This is niche and Ashley called it out as "acceptable for now, widen later if it bites." A future patch could tighten the gate to `next.every(it => it.body.trim().length === 0)` to close-when-only-empty-drafts-remain, but that's out of scope here.

## Self-Check

- [x] `src/ui/features/terminal/MessageQueueDrawer.tsx` — **FOUND**, contains the new setItems callback + onClose dep.
- [x] Commit `5f209ff` — **FOUND** in `git log`.
- [x] No other files modified.
- [x] `npm run build` exit 0.

## Self-Check: PASSED
