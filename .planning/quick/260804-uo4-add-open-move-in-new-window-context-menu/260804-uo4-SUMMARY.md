---
phase: 260804-uo4
plan: 01
subsystem: pretty-conversations / sidebar row context menu
tags: [context-menu, rdp, new-window, tab-url, multi-window]
dependency_graph:
  requires: []
  provides: [Open-in-new-window context menu item, RDP row full context menu, RDP touch handlers]
  affects: [PrettyConversationRow, PrettyConversationsPanel, PrettyConversationRow.test]
tech_stack:
  added: [specForTab, encodeWorkspaceSpec from tab-url.ts]
  patterns: [items[] builder gate, popup-blocker safety branch, label bifurcation on inActiveSet]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
decisions:
  - "Open/Move in new window uses window.open('#'+encodeWorkspaceSpec({tabs:[spec],activeIndex:0,only:true}), '_blank', 'noopener')"
  - "Popup-blocker safety: onDeactivate only called when window.open returns non-null Window handle"
  - "Mobile suppression: !isMobile gate in items[] builder prevents the item rendering on mobile variant"
  - "handleRowDeactivate in Panel is safe for RDP rows: targetTmuxSession null makes fleet-id purge a no-op"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-04T22:20:26Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 260804-uo4 Plan 01: Add Open/Move in new window context-menu item Summary

Added a "Open in new window" / "Move to new window" context-menu item to all sidebar rows (including RDP), reachable via desktop right-click and mobile long-press, with popup-blocker safety and label bifurcation on inActiveSet.

## Files Modified

- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — Import added, 6 isRdp gates dropped, new items[] entry inserted, comments updated
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — `onDeactivate` threaded for RDP group render site, comment updated
- `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — Test 7b and TL4 rewritten; 6 new tests (UO1-UO6) appended

## Key Changes

### Task 1 — PrettyConversationRow.tsx

**Import added:**
```ts
import { specForTab, encodeWorkspaceSpec } from "@/lib/tab-url";
```

**Three JSX prop gates dropped:**
```tsx
// BEFORE:
onContextMenu={!isMobile && !isRdp ? onRowContextMenu : undefined}
onTouchStart={isMobile && !isRdp ? onTouchStart : undefined}
onTouchMove={isMobile && !isRdp ? onTouchMove : undefined}
onTouchEnd={isMobile && !isRdp ? onTouchEnd : undefined}
onTouchCancel={isMobile && !isRdp ? onTouchEnd : undefined}

// AFTER:
onContextMenu={!isMobile ? onRowContextMenu : undefined}
onTouchStart={isMobile ? onTouchStart : undefined}
onTouchMove={isMobile ? onTouchMove : undefined}
onTouchEnd={isMobile ? onTouchEnd : undefined}
onTouchCancel={isMobile ? onTouchEnd : undefined}
```

**Three handler-body early-return guards dropped:**
```ts
// BEFORE: if (isRdp || !isMobile) return;
// AFTER:  if (!isMobile) return;
```

**Portal render gate dropped:**
```tsx
// BEFORE: {ctxMenu !== null && !isRdp && (
// AFTER:  {ctxMenu !== null && (
```

**New items[] entry (between Clone and Deactivate):**
```ts
if (!isMobile) {
  const spec = specForTab({ type: row.type, host: row.host, targetTmuxSession: row.targetTmuxSession });
  if (spec !== null) {
    items.push({
      label: inActiveSet ? "Move to new window" : "Open in new window",
      onClick: () => {
        const payload = encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true });
        const w = window.open("#" + payload, "_blank", "noopener");
        if (w !== null && inActiveSet) {
          onDeactivate?.();
        }
      },
    });
  }
}
```

### Task 2 — PrettyConversationsPanel.tsx

**RDP group onDeactivate threading:**
```tsx
// BEFORE:
<PrettyConversationRowLive
  key={row.id}
  row={row}
  selected={row.id === selectedId}
  pinned={false}
  variant={variant}
  onSelect={() => handleRowSelect(row)}
  onTogglePin={rdpNoopTogglePin}
  inActiveSet={activeSet.has(row.id)}
  sessionKey={sessionWorkingKey(row)}
/>

// AFTER:
<PrettyConversationRowLive
  key={row.id}
  row={row}
  selected={row.id === selectedId}
  pinned={false}
  variant={variant}
  onSelect={() => handleRowSelect(row)}
  onTogglePin={rdpNoopTogglePin}
  onDeactivate={() => handleRowDeactivate(row)}
  inActiveSet={activeSet.has(row.id)}
  sessionKey={sessionWorkingKey(row)}
/>
```

`handleRowDeactivate` is safe for RDP rows: `row.targetTmuxSession` is null for RDP rows so the fleet-id purge branch (`if (row.host && row.targetTmuxSession)`) cleanly no-ops.

### Task 3 — PrettyConversationRow.test.tsx

**Test 7b rewritten** (desktop RDP context menu now opens):
- Old assertion: `expect(screen.queryByRole("menu")).toBeNull()`
- New assertion: `expect(screen.getByRole("menu")).toBeTruthy()`

**TL4 rewritten** (mobile RDP long-press now opens menu):
- Old assertion: `expect(screen.queryByRole("menu")).toBeNull()`
- New assertion: `expect(screen.getByRole("menu")).toBeTruthy()`

**New tests UO1-UO6 added** (describe: "PrettyConversationRow: Open/Move-in-new-window context-menu item"):
- UO1: desktop inActiveSet non-RDP → "Move to new window" + window.open + onDeactivate called
- UO2: desktop !inActiveSet non-RDP → "Open in new window" + window.open + onDeactivate NOT called
- UO3: desktop RDP inActiveSet → menu opens + "Move to new window" + window.open + onDeactivate called
- UO4: popup-blocked (window.open returns null) → window.open called, onDeactivate NOT called
- UO5: mobile long-press → menu opens (Pin present) but no new-window items
- UO6: mobile RDP long-press → menu opens (gate relaxed) + Pin present + no new-window items

## Deviations from Plan

### Pre-existing failures in PrettyConversationsPanel.test.tsx (not caused by this quick)

Tests 5, 8, 23-28 in PrettyConversationsPanel.test.tsx were already failing before this change landed (verified by reverting source files to pre-change state and confirming 8 failures). These are pre-existing test regressions outside the scope of this quick.

### Fixed post-executor: Test (g) in PrettyConversationsPanel.test.tsx

Test (g) hard-coded the pre-uo4 menu order as `[Pin, Hide, Deactivate]` at indices 0/1/2. After this quick's change the order became `[Pin, Hide, Move to new window, Deactivate]` for a non-hidden active-set row without an identity (Clone auto-hidden). This test was passing before uo4 and newly failed after.

Same invariant-inversion class as the plan's Test 7b / TL4 rewrites in `PrettyConversationRow.test.tsx` — the executor's "out-of-scope" reasoning was wrong (a test broken by the invariant this quick inverts IS in scope), so the orchestrator (Tina) fixed it as commit `3a1cd31`: updated the assertion to the new 4-label order.

Post-fix panel-suite result: `8 failed | 42 passed (50)`. All 8 remaining failures are documented pre-existing failures (terminology commit + patch #317 pinned-bounty filter temp-hide) — none caused by this quick.

## Verification Results

```
npx tsc --noEmit        → CLEAN (no errors)

npm test -- src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
→ Test Files  1 passed (1)
→ Tests  40 passed (40)
   (34 pre-existing + Test 7b rewritten + TL4 rewritten + UO1-UO6 new = 40)

grep -c "!isRdp" src/ui/features/pretty-conversations/PrettyConversationRow.tsx
→ 2  (isAmbient derivation: `!isRdp && !inActiveSet` + class-composition comment — both
      are not gate patterns; all 6 sidebar row-level gate occurrences removed)

grep -c "Move to new window" src/ui/features/pretty-conversations/PrettyConversationRow.tsx → 1
grep -c "Open in new window" src/ui/features/pretty-conversations/PrettyConversationRow.tsx → 1

git diff --name-only HEAD~3 HEAD → exactly 3 files:
  src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx

git diff HEAD -- src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx → empty
```

## Commits

| Task | Commit  | Message |
|------|---------|---------|
| 1    | d064b5e | feat(260804-uo4-01): add Open/Move-in-new-window item + relax isRdp gates in PrettyConversationRow |
| 2    | d1ceaec | feat(260804-uo4-01): thread onDeactivate for RDP rows in PrettyConversationsPanel |
| 3    | bd002dd | test(260804-uo4-01): add UO1-UO6 tests + rewrite Test 7b and TL4 in PrettyConversationRow.test.tsx |
| —    | 3a1cd31 | test(260804-uo4-01): update Panel Test (g) for new-window item (orchestrator followup) |

## Self-Check: PASSED

- [x] PrettyConversationRow.tsx exists and modified: `git show d064b5e --name-only | grep PrettyConversationRow.tsx` → found
- [x] PrettyConversationsPanel.tsx exists and modified: `git show d1ceaec --name-only | grep PrettyConversationsPanel.tsx` → found
- [x] PrettyConversationRow.test.tsx exists and modified: `git show bd002dd --name-only | grep PrettyConversationRow.test.tsx` → found
- [x] TypeScript: `npx tsc --noEmit` → clean
- [x] Row test suite: 40 passed, 0 failed
- [x] Commits d064b5e, d1ceaec, bd002dd exist in git log
