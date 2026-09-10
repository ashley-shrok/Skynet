---
phase: 95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling
plan: 03
subsystem: pretty-view frontend / plan-pending UI stack
tags: [phase-95, part-b, frontend, wave-2, plan-pending-removal, comment-cleanup]
dependency_graph:
  requires:
    - "95-02: backend plan-pending stack deleted + contextPctTimer simplified to JSONL-only"
  provides:
    - "frontend with zero plan-pending references (state, handlers, render, wire-types, comments)"
    - "Wave 2 build fully green — tsc + frontend test suite both pass after both 95-02 + 95-03"
  affects:
    - "PrettyView.tsx: zero planPending state, zero plan_pending case, zero PlanPendingBubble render"
    - "ComposeBox.tsx: zero planPendingActive prop references (both primary and QueueSlot component)"
    - "claude-session-api.ts: PlanPendingEvent + RawKeystrokesPayload types gone from discriminated union"
tech_stack:
  added: []
  patterns:
    - "WaitingBubble as natural aesthetic sibling replacement in comment anchors (replacing PlanPendingBubble references)"
key_files:
  created: []
  modified:
    - "src/ui/features/pretty-view/PrettyView.tsx (15 sites: import, state, handlers, render, props)"
    - "src/ui/features/pretty-view/ComposeBox.tsx (14 sites in primary + duplicate sites in QueueSlot inner component)"
    - "src/ui/api/claude-session-api.ts (6 sites: types, docblocks, union members)"
    - "src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx (comment only)"
    - "src/ui/features/pretty-view/RelayInboundBubble.tsx (comment only)"
    - "src/ui/features/pretty-view/AsideBubble.tsx (comment only)"
    - "src/ui/features/pretty-view/SessionHoldingOverlay.tsx (2 comment sites)"
    - "src/ui/features/pretty-view/WaitingBubble.tsx (docblock rewrite: 5 sites)"
    - "src/ui/features/pretty-view/use-auto-scroll.ts (comment only)"
    - "src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx (comment only)"
    - "src/ui/AppShell.tsx (comment only)"
    - "src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx (test docblock)"
    - "src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (2 test comment sites)"
    - "src/ui/features/pretty-view/WaitingBubble.test.tsx (test description)"
    - "src/ui/features/pretty-view/AsideBubble.test.tsx (test docblock)"
  deleted:
    - "src/ui/features/pretty-view/PlanPendingBubble.tsx (276 lines)"
    - "src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx (355 lines)"
decisions:
  - "G7 resolution: PlanPendingBubble.tsx L14-L21 Ink Plan Mode split-send lesson captured verbatim in SUMMARY.md (see section below). Plan mode is dead fleet-wide post-Part-A; the lesson is preserved here for any future re-implementation."
  - "ComposeBox.tsx L3219+ cluster is a second inner React component (QueueSlot render function) that has its own ComposeBoxProps interface and destructure — NOT a duplicate prop chain in the same component. Applied identical planPendingActive removals to both the primary ComposeBox and the QueueSlot inner component."
  - "Task 2 scope extended beyond the 9 source-file list to cover 4 test files (ComposeBox.reconnecting-disable.test.tsx, PrettyView.plain-dom.test.tsx, WaitingBubble.test.tsx, AsideBubble.test.tsx) and 2 additional inline comments in PrettyView.tsx + 3 concept references in ComposeBox.tsx that plan verification grep caught. Zero-hit target achieved."
metrics:
  duration: "~35 minutes execution time"
  completed_date: "2026-09-10"
  tests_added: 0
  tests_deleted: 2
  lines_deleted_approximately: 631
---

# Phase 95 Plan 03: Frontend plan-pending stack deletion Summary

**One-liner:** Deleted PlanPendingBubble.tsx + its test file, gutted planPendingActive from ComposeBox, removed all plan_pending state/handlers/render from PrettyView, excised PlanPendingEvent + RawKeystrokesPayload wire types from claude-session-api.ts, and cleaned every comment reference across 15 files — Wave 2 build is fully green.

## Lessons preserved from deleted file PlanPendingBubble.tsx

### G7: Ink Plan Mode split-send lesson (verbatim from L14-L21)

The following text is preserved verbatim from `PlanPendingBubble.tsx` lines 14–21, which is now deleted. This is the critical Phase 24 lesson about ComposeBox split-send and Ink Plan Mode:

```
// Mounted by PrettyView.tsx as a sibling of WipBubble at the tail of
// the content wrapper when the claude-session WebSocket reports
// {type:"plan_pending", pending: {...}} with a non-null pending
// object. Unmounted when the session returns pending: null (Claude
// Code recorded the plan-mode reply's tool_result).
//
// The visual is intentionally compact and text-light: a
// ClipboardList glyph in an assistant-aligned bubble matching
// ChatMessage's assistant treatment, plus a single line stating
// that a plan is waiting for approval. Copy DELIBERATELY does NOT
// mention typing "1" or "2" (patch #67 correction): those keys are
// consumed by Claude Code's Ink Plan Mode prompt directly in the
// tmux pane, NOT by pretty view's ComposeBox. The ComposeBox's
// split-send (patch #44) writes a body event + a separate \r event
// with a 60ms gap, which Ink does NOT recognize as a plan-mode
// selection. So do NOT surface "reply 1/2" copy — it's misleading
// (Ashley verified 2026-07-18 by trying it). This bubble is a
// pure PRESENCE indicator; the reply UI lives in the tmux pane
// (which she can flip to with Ctrl+Shift+O — patch #44).
```

**Summary of lesson:** ComposeBox's split-send (body event + separate \r event, 60ms apart) is NOT recognized by Ink Plan Mode as a plan-mode selection. If plan mode is ever re-implemented, replies MUST use `tmux send-keys -l` as a single call — not the split-send path. Do NOT surface "reply 1/2" UI in ComposeBox.

## Deleted files

| File | Lines | Rationale |
|------|-------|-----------|
| `src/ui/features/pretty-view/PlanPendingBubble.tsx` | 276 | Sole UI consumer of `plan_pending` WS frame and sole sender of `raw_keystrokes` frames; plan mode dead fleet-wide post-Part-A |
| `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` | 355 | Tests for planPendingActive OR-in prop chain; prop chain deleted in this plan |
| **Total** | **631** | |

## Primary file edits

### PrettyView.tsx — 15 sites

| Site | What removed |
|------|-------------|
| L35 | `import { PlanPendingBubble }` |
| L184 | PlanPendingBubble from bubble-type comment |
| L632–L659 | planPending state block (~28 lines + docblock) |
| L1878 | `setPlanPending(null)` teardown reset |
| L2125 | `setPlanPending(null)` transitionToActiveNew reset |
| L2491–L2494 | `case "plan_pending": { setPlanPending(parsed.pending); break; }` |
| L2554 | `/ plan_pending` from asideText comment |
| L2596 | `setPlanPending(null)` in session_changed handler |
| L2646 | planPending mention from wire_boot docblock |
| L2942 | `planPending/` from state-preservation comment |
| L3646 | PlanPendingBubble from bubble-type comment |
| L3740–L3747 | PlanPendingBubble from pre-Phase-43 rendering comment |
| L3751–L3756 | `{planPending && (<PlanPendingBubble ... />)}` conditional render |
| L3572–L3576 | Historical sibling list comments (Task 2 cleanup) |
| L3968–L3982 | `handlePlanApprove` + `handlePlanFeedback` handlers + planPendingActive prop |

**Rule 2 deviation (auto-fix):** handlePlanApprove + handlePlanFeedback were not in the plan's Task 1 step list but were detected during edits as dead code sending the now-deleted `raw_keystrokes` wire-type frames. Deleted as missing cleanup.

### ComposeBox.tsx — 14 primary + 7 QueueSlot inner component sites

The L3219+ cluster is a **second inner React component** (QueueSlot render function) with its own `ComposeBoxProps` interface and destructure — not a duplicate prop chain. Applied identical planPendingActive removals to both:

**Primary component sites:** prop + docblock, destructure, 2× if-guards, Enter key guard, sendDisabled, showPrimaryArmButton, Reset button, 2× aux button disabled, prop-drill.

**QueueSlot inner component sites:** prop + interface, destructure, slotSendDisabled, showSlotArmButton.

### claude-session-api.ts — 6 sites

- PlanPendingEvent docblock deleted
- PlanPendingEvent type export deleted
- `plan_pending` removed from SessionHoldingClearedEvent comment
- `| PlanPendingEvent` removed from ClaudeSessionServerEvent discriminated union
- RawKeystrokesPayload docblock deleted
- RawKeystrokesPayload type deleted (raw_keystrokes union member gone)

## Comment-only cleanup (Task 2)

9 planned source files + 4 test files + 2 additional PrettyView.tsx + 3 ComposeBox.tsx concept references:

| File | Before | After |
|------|--------|-------|
| PrettyViewLoadingOverlay.tsx L95 | "than PlanPendingBubble" | "than WipBubble" |
| RelayInboundBubble.tsx L18 | "PlanPendingBubble, ImageBubble, DormancyOverlay" | "ImageBubble, DormancyOverlay" |
| AsideBubble.tsx L6 | "PlanPendingBubble / WipBubble" | "WipBubble" |
| SessionHoldingOverlay.tsx L29 | "`PlanPendingBubble` / `WipBubble` treatment" | "`WipBubble` treatment" |
| SessionHoldingOverlay.tsx L140 | "mirrors PlanPendingBubble aesthetic" | "mirrors WipBubble aesthetic" |
| WaitingBubble.tsx (docblock rewrite) | Contrastive framing referencing PlanPendingBubble throughout | Self-standing description of WaitingBubble purpose |
| use-auto-scroll.ts L341 | "PlanPendingBubble, AsideBubble" | "AsideBubble" |
| AgentBadgeWithAppendage.tsx L215 | "no aside/recycle/plan-pending" | "no aside/recycle" |
| AppShell.tsx L2923 | "PrettyView's WipBubble, PlanPendingBubble" | "PrettyView's WipBubble, WaitingBubble" |
| ComposeBox.reconnecting-disable.test.tsx L5 | "recycleActive / planPendingActive disable pattern" | "recycleActive disable pattern" |
| PrettyView.plain-dom.test.tsx L25, L453 | PlanPendingBubble layout references | WaitingBubble |
| WaitingBubble.test.tsx L45 | "matches PlanPendingBubble alignment" | "assistant-aligned, same slot as WipBubble" |
| AsideBubble.test.tsx L6 | "PlanPendingBubble / WipBubble" | "WipBubble" |
| PrettyView.tsx L3573, L3669 | Historical "PlanPendingBubble sibling was deleted" | Anonymized "retired bubble sibling" |
| ComposeBox.tsx L3377, L3501, L3591 | "plan-pending" concept in disable-gate comments | Removed from enumerations |

## Post-plan grep

`grep -rn "PlanPendingBubble\|plan-pending\|planPending\|plan_pending" src/ui/ --include='*.ts' --include='*.tsx'` → **ZERO hits**.

## Verification

- `test ! -f src/ui/features/pretty-view/PlanPendingBubble.tsx` → PASS (deleted)
- `test ! -f src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → PASS (deleted)
- `grep -rn "PlanPendingBubble\|plan-pending\|planPending\|plan_pending" src/ui/` → ZERO
- `npx tsc --noEmit` → PASS (zero errors)
- `npx vitest run src/ui/features/pretty-view/` → 82 files, 962 tests pass (9 skipped, 1 todo)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing cleanup] Deleted handlePlanApprove + handlePlanFeedback from PrettyView.tsx**
- **Found during:** Task 1 Step 3
- **Issue:** These two handlers send `raw_keystrokes` WS frames (the wire type deleted in this plan). They were called only by PlanPendingBubble (now deleted) and were not enumerated in the plan's 15-site list.
- **Fix:** Deleted both handlers as missing cleanup — leaving dead code sending a deleted wire-type frame would be a Rule 2 violation (security surface area with no consumer).
- **Files modified:** `src/ui/features/pretty-view/PrettyView.tsx`

**2. [Rule 2 - Missing cleanup] Extended Task 2 scope to 4 test files + 5 additional source comment sites**
- **Found during:** Task 2 final grep verification
- **Issue:** The plan listed 9 sibling source files but the verification grep caught additional references in test files (ComposeBox.reconnecting-disable.test.tsx, PrettyView.plain-dom.test.tsx, WaitingBubble.test.tsx, AsideBubble.test.tsx) and inline comments in PrettyView.tsx L3573/L3669 and ComposeBox.tsx L3377/L3501/L3591.
- **Fix:** Cleaned all remaining hits. Zero-hit target achieved.
- **Files modified:** 4 test files, PrettyView.tsx (2 sites), ComposeBox.tsx (3 sites)

## Commits

- **`1f195ede`** — `refactor(pretty-view): delete PlanPendingBubble + planPendingActive prop chain + wire-type (Phase 95 Part B frontend)` — Task 1 (substantive UI deletion)
- **`5d1e124c`** — `refactor(pretty-view): comment cleanup after plan-pending removal (Phase 95 Part B tidy)` — Task 2 (comment housekeeping across 15 files)

## Self-Check: PASSED

- `test ! -f src/ui/features/pretty-view/PlanPendingBubble.tsx` → PASS (deleted)
- `test ! -f src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → PASS (deleted)
- `grep -rn "PlanPendingBubble|plan-pending|planPending|plan_pending" src/ui/ --include='*.ts' --include='*.tsx'` → ZERO hits
- `npx tsc --noEmit` → PASS (zero errors)
- `npx vitest run src/ui/features/pretty-view/` → 82 files, 962 tests pass
- `git log --oneline | grep 1f195ede` → FOUND
- `git log --oneline | grep 5d1e124c` → FOUND
